// Test-only MySQL transport proxy that withholds the acknowledgement of a
// real COMMIT.
//
// Why it exists
// -------------
// "COMMIT 结果未知" (the COMMIT outcome is unknown) can only be produced
// against a real server: the server must actually commit, and the client must
// not receive the acknowledgement. A mock worker can only prove a code path.
// This proxy produces the real thing:
//
//   1. the client authenticates against the real MySQL through the proxy;
//   2. the client sends `COMMIT` as a real COM_QUERY;
//   3. the proxy forwards it **verbatim** to the real server;
//   4. the real server commits and answers with a real OK packet;
//   5. the proxy **withholds** that OK packet and reports
//      `COMMIT_RESPONSE_WITHHELD`;
//   6. the session is then terminated, so the client observes a genuine
//      connection loss while the server has already committed.
//
// Safety boundaries
// -----------------
//   · the listener binds 127.0.0.1 only — it is never reachable from outside
//     the machine;
//   · it connects to exactly one already-authorised MySQL host/port;
//   · it never logs an authentication packet, a password, a SQL statement or
//     any raw payload — only non-sensitive event names and byte counts;
//   · it adds no npm dependency (node:net only);
//   · it never negotiates TLS. A TLS-protected target cannot be inspected
//     safely, so the caller must fail closed before the proxy is created.
//
// This file is a test fixture. It is never loaded by the production server.

import net from 'node:net';

export const MYSQL_COM_QUIT = 0x01;
export const MYSQL_COM_QUERY = 0x03;
export const MYSQL_PACKET_HEADER_BYTES = 4;
export const MYSQL_MAX_PAYLOAD_BYTES = 0xffffff;
export const MYSQL_PROTOCOL_VERSION_10 = 10;

/**
 * A minimal MySQL packet framer.
 *
 * TCP is a byte stream: one read may deliver half a packet, several packets,
 * or a packet boundary in the middle of a chunk. The parser therefore keeps a
 * buffer and only emits **complete** packets.
 */
export function createMySqlPacketParser() {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      const packets = [];
      for (;;) {
        if (buffer.length < MYSQL_PACKET_HEADER_BYTES) break;
        const payloadLength = buffer.readUIntLE(0, 3);
        if (payloadLength === MYSQL_MAX_PAYLOAD_BYTES) {
          // A payload of exactly 0xffffff is continued in the next packet.
          // Resuming that continuation is not needed by this fixture and a
          // wrong guess would silently corrupt the stream, so it fails closed.
          throw new Error('MYSQL_PROXY_UNSUPPORTED_CONTINUATION_PACKET');
        }
        const total = MYSQL_PACKET_HEADER_BYTES + payloadLength;
        if (buffer.length < total) break;
        const raw = buffer.subarray(0, total);
        packets.push({
          sequenceId: raw[3],
          payload: raw.subarray(MYSQL_PACKET_HEADER_BYTES),
          raw: Buffer.from(raw),
        });
        buffer = buffer.subarray(total);
      }
      return packets;
    },
    reset() { buffer = Buffer.alloc(0); },
    get pendingBytes() { return buffer.length; },
  };
}

/**
 * True only for a COM_QUERY whose statement is exactly `COMMIT`. MySQL 8 may
 * negotiate CLIENT_QUERY_ATTRIBUTES; mysql2 then prefixes even an empty
 * attribute set with parameter_count=0 and parameter_set_count=1.
 *
 * A prepared-statement execution (COM_STMT_EXECUTE) carries SQL text too and
 * must never be treated as a COMMIT; neither may `ROLLBACK`, `COMMIT AND
 * CHAIN` or a statement that merely contains the word.
 */
export function isCommitQueryPayload(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 2) return false;
  if (payload[0] !== MYSQL_COM_QUERY) return false;
  const body = payload.subarray(1);
  const sql = body.length >= 3 && body[0] === 0 && body[1] === 1 ? body.subarray(2) : body;
  const statement = sql.toString('utf8').trim().replace(/;+\s*$/, '').trim();
  return /^COMMIT$/i.test(statement);
}

/** The MySQL OK packet (server → client) starts with 0x00. */
export function isOkPayload(payload) {
  return Buffer.isBuffer(payload) && payload.length > 0 && payload[0] === 0x00;
}

/** The MySQL ERR packet (server → client) starts with 0xff. */
export function isErrPayload(payload) {
  return Buffer.isBuffer(payload) && payload.length > 0 && payload[0] === 0xff;
}

/**
 * HandshakeV10 carries the server-assigned connection id directly behind the
 * NUL-terminated server version string — the same offset the MySQL client
 * itself uses (`1 + strlen(server_version) + 1`).
 */
export function readHandshakeConnectionId(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 9) return null;
  if (payload[0] !== MYSQL_PROTOCOL_VERSION_10) return null;
  const versionEnd = payload.indexOf(0, 1);
  if (versionEnd < 1) return null;
  const offset = versionEnd + 1;
  if (payload.length < offset + 4) return null;
  return payload.readUInt32LE(offset);
}

function destroySocket(socket) {
  if (!socket) return;
  socket.removeAllListeners();
  socket.destroy();
}

/**
 * Create the COMMIT-withholding proxy.
 *
 * The returned handle owns the listener and every proxied socket. `close()`
 * releases all of them; a proxy that cannot prove its sockets are gone is a
 * failed test, not a cleanup best-effort.
 */
export function createCommitWithholdingProxy({
  upstreamHost,
  upstreamPort,
  onEvent = () => {},
  commitAckTimeoutMs = 30_000,
  connectTimeoutMs = 30_000,
} = {}) {
  const host = String(upstreamHost ?? '').trim();
  const port = Number(upstreamPort);
  if (!host) throw new Error('MYSQL_PROXY_INVALID_UPSTREAM_HOST');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('MYSQL_PROXY_INVALID_UPSTREAM_PORT');
  }

  const sessions = new Set();
  const listeners = [];
  const emitted = [];
  const eventWaiters = [];
  const stats = {
    sessionsOpened: 0,
    commitsForwarded: 0,
    commitsWithheld: 0,
    commitsRejected: 0,
    bytesClientToServer: 0,
    bytesServerToClient: 0,
  };
  let closed = false;

  function emit(name, detail = {}) {
    const event = { name, ...detail };
    emitted.push(event);
    try { onEvent(event); } catch { /* an observer must never break the transport */ }
    for (const waiter of [...eventWaiters]) {
      if (waiter.name !== name) continue;
      clearTimeout(waiter.timer);
      eventWaiters.splice(eventWaiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  }

  function writeClient(session, chunk) {
    if (session.closed || session.clientSocket.destroyed) return false;
    stats.bytesServerToClient += chunk.length;
    return session.clientSocket.write(chunk);
  }

  function writeUpstream(session, chunk) {
    if (session.closed) return false;
    stats.bytesClientToServer += chunk.length;
    if (!session.upstreamSocket || !session.upstreamReady) {
      session.pendingUpstream.push(chunk);
      return true;
    }
    return session.upstreamSocket.write(chunk);
  }

  function failClosed(session, reason) {
    if (session.closed) return;
    session.closed = true;
    if (session.commitTimer) { clearTimeout(session.commitTimer); session.commitTimer = null; }
    emit('PROXY_FAILED_CLOSED', { reason: String(reason || 'unknown') });
    destroySocket(session.clientSocket);
    destroySocket(session.upstreamSocket);
    sessions.delete(session);
  }

  function createSession(clientSocket) {
    const session = {
      clientSocket,
      upstreamSocket: null,
      upstreamReady: false,
      pendingUpstream: [],
      clientParser: createMySqlPacketParser(),
      serverParser: createMySqlPacketParser(),
      awaitingCommitOk: false,
      commitTimer: null,
      connectionId: null,
      closed: false,
    };
    stats.sessionsOpened += 1;
    sessions.add(session);

    const upstream = net.connect({ host, port });
    session.upstreamSocket = upstream;
    upstream.setNoDelay(true);

    const connectTimer = setTimeout(() => {
      failClosed(session, 'MYSQL_PROXY_UPSTREAM_CONNECT_TIMEOUT');
    }, connectTimeoutMs);
    upstream.once('connect', () => {
      clearTimeout(connectTimer);
      session.upstreamReady = true;
      for (const chunk of session.pendingUpstream) upstream.write(chunk);
      session.pendingUpstream = [];
    });

    upstream.on('data', (chunk) => {
      if (session.closed) return;
      let packets;
      try {
        packets = session.serverParser.push(chunk);
      } catch (error) {
        failClosed(session, error?.message);
        return;
      }
      for (const packet of packets) {
        if (session.connectionId === null) {
          const handshakeId = readHandshakeConnectionId(packet.payload);
          if (handshakeId !== null) {
            session.connectionId = handshakeId;
            emit('SESSION_HANDSHAKE', { connectionId: handshakeId });
          }
        }
        if (session.awaitingCommitOk) {
          session.awaitingCommitOk = false;
          if (session.commitTimer) { clearTimeout(session.commitTimer); session.commitTimer = null; }
          if (isOkPayload(packet.payload)) {
            if (stats.commitsWithheld === 0) {
              // The server really committed. The acknowledgement is withheld so
              // the client can never learn the outcome. Only the first COMMIT
              // is withheld: the fixture proves one uncertain COMMIT, and a
              // later COMMIT on the same session would otherwise deadlock the
              // request for no additional evidence.
              stats.commitsWithheld += 1;
              emit('COMMIT_RESPONSE_WITHHELD', { connectionId: session.connectionId });
              continue;
            }
          } else if (isErrPayload(packet.payload)) {
            // The server rejected the COMMIT: the outcome is known, so the
            // error is forwarded verbatim and no uncertainty is created.
            stats.commitsRejected += 1;
            emit('COMMIT_RESPONSE_REJECTED', { connectionId: session.connectionId });
          }
        }
        writeClient(session, packet.raw);
      }
    });

    upstream.on('end', () => { if (!session.closed) failClosed(session, 'MYSQL_PROXY_UPSTREAM_ENDED'); });
    upstream.on('error', (error) => { failClosed(session, error?.code || 'MYSQL_PROXY_UPSTREAM_ERROR'); });
    upstream.on('close', () => { if (!session.closed) failClosed(session, 'MYSQL_PROXY_UPSTREAM_CLOSED'); });

    clientSocket.setNoDelay(true);
    clientSocket.on('data', (chunk) => {
      if (session.closed) return;
      let packets;
      try {
        packets = session.clientParser.push(chunk);
      } catch (error) {
        failClosed(session, error?.message);
        return;
      }
      for (const packet of packets) {
        if (isCommitQueryPayload(packet.payload)) {
          stats.commitsForwarded += 1;
          session.awaitingCommitOk = true;
          emit('COMMIT_FORWARDED', { connectionId: session.connectionId });
          session.commitTimer = setTimeout(() => {
            failClosed(session, 'MYSQL_PROXY_COMMIT_ACK_TIMEOUT');
          }, commitAckTimeoutMs);
        }
        writeUpstream(session, packet.raw);
      }
    });

    clientSocket.on('end', () => { if (!session.closed) failClosed(session, 'MYSQL_PROXY_CLIENT_ENDED'); });
    clientSocket.on('error', (error) => { failClosed(session, error?.code || 'MYSQL_PROXY_CLIENT_ERROR'); });
    clientSocket.on('close', () => {
      if (session.closed) return;
      session.closed = true;
      if (session.commitTimer) { clearTimeout(session.commitTimer); session.commitTimer = null; }
      destroySocket(session.upstreamSocket);
      sessions.delete(session);
    });

    return session;
  }

  const server = net.createServer((clientSocket) => {
    if (closed) { destroySocket(clientSocket); return; }
    createSession(clientSocket);
  });
  server.on('error', (error) => { emit('PROXY_LISTENER_ERROR', { reason: error?.code || 'unknown' }); });

  return {
    host: '127.0.0.1',
    port: 0,
    upstream: Object.freeze({ host, port }),
    stats,
    get liveSessions() { return sessions.size; },
    /**
     * Await a transport event. Events that were already emitted resolve
     * immediately, so the caller never has to register a listener before the
     * fact.
     */
    waitForEvent(name, timeoutMs = 60_000) {
      const already = emitted.find((event) => event.name === name);
      if (already) return Promise.resolve(already);
      return new Promise((resolveEvent, rejectEvent) => {
        const waiter = { name, resolve: resolveEvent, reject: rejectEvent, timer: null };
        waiter.timer = setTimeout(() => {
          const index = eventWaiters.indexOf(waiter);
          if (index >= 0) eventWaiters.splice(index, 1);
          rejectEvent(new Error(`MYSQL_PROXY_EVENT_TIMEOUT:${name}`));
        }, timeoutMs);
        eventWaiters.push(waiter);
      });
    },
    async listen() {
      await new Promise((resolveListen, rejectListen) => {
        const onError = (error) => { server.off('listening', onListening); rejectListen(error); };
        const onListening = () => { server.off('error', onError); resolveListen(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
      });
      this.port = server.address().port;
      return this.port;
    },
    /**
     * Deliberately destroy the live session.
     *
     * It triggers **one session replacement of the client that owns it**: the
     * victim's own MySQL Worker reconnects on its next request, opens a new
     * MySQL session and receives a new connection id. That is the only thing
     * it proves, and it proves it about the victim alone.
     *
     * It says nothing about any other adapter. The session epoch is a
     * per-Worker counter and is never compared across adapters, so this
     * fixture deliberately models no epoch at all.
     */
    dropSession(reason = 'M3_VICTIM_SESSION_REPLACED') {
      let dropped = 0;
      for (const session of [...sessions]) {
        session.closed = true;
        if (session.commitTimer) { clearTimeout(session.commitTimer); session.commitTimer = null; }
        destroySocket(session.clientSocket);
        destroySocket(session.upstreamSocket);
        sessions.delete(session);
        dropped += 1;
      }
      emit('SESSION_DROPPED', { reason, dropped });
      return dropped;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const waiter of eventWaiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('MYSQL_PROXY_CLOSED'));
      }
      for (const session of [...sessions]) {
        session.closed = true;
        if (session.commitTimer) { clearTimeout(session.commitTimer); session.commitTimer = null; }
        destroySocket(session.clientSocket);
        destroySocket(session.upstreamSocket);
        sessions.delete(session);
      }
      await new Promise((resolveClose) => { server.close(() => resolveClose()); });
      for (const listener of listeners.splice(0)) listener();
    },
  };
}
