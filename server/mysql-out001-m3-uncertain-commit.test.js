// OUT-001 M3 — uncertain-COMMIT offline regression.
//
// Design      : docs/design/procurement-outsourcing.md §26.34.14.3（R1～R5 恢复条件）、
//               §26.34.16.3（M3 验证方法）
// Requirement : document.md §31.14.2
//
// These cases are **deterministic and offline**. They never open a real MySQL
// connection, so they prove the control flow, the Worker/adapter contract and
// the transport-level behaviour of the COMMIT-withholding proxy. They prove
// nothing about real InnoDB behaviour; the protected real-server evidence is
// the OUT-001 M3 case in server/mysql-out001.integration.js, which runs only
// through the guarded Gate runner.
//
// The twelve obligations of this file:
//   M3-O01  MySQL packet parser: split packets and coalesced packets
//   M3-O02  only a COM_QUERY carrying exactly `COMMIT` is recognised
//   M3-O03  non-COMMIT traffic is forwarded unchanged
//   M3-O04  the server's COMMIT OK is withheld and reported
//   M3-O05  the proxy fails closed when the COMMIT acknowledgement times out
//   M3-O06  an abnormal proxy close leaks no socket
//   M3-O07  an uncertain COMMIT never enters settleTransactionRollback
//   M3-O08  an uncertain COMMIT opens no new Worker session
//   M3-O09  the named-lock registry is cleared only after TERMINATION_CONFIRMED
//   M3-O10  TERMINATION_FAILED keeps the quarantine and the registry
//   M3-O11  createWipTransfer never records an uncertain COMMIT as a rejection
//   M3-O12  the transaction work always runs exactly once

import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, test } from 'node:test';

import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import {
  createMySqlPacketParser,
  createCommitWithholdingProxy,
  isCommitQueryPayload,
  isErrPayload,
  isOkPayload,
  readHandshakeConnectionId,
} from './database/test-fixtures/mysql-commit-withholding-proxy.js';
import { isUncertainCommitOutcome, transaction } from './db.js';
import { createWipTransfer } from './modules/outsourcing-finance.js';
import { createProcurementFixture, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';

const m3WorkerUrl = new URL('./database/test-fixtures/out001-m3-uncertain-commit-worker.js', import.meta.url);

// ---------------------------------------------------------------------------
// Minimal MySQL server used by the proxy cases. It speaks just enough of the
// protocol to prove the proxy's framing and withholding behaviour.
// ---------------------------------------------------------------------------

function encodePacket(sequenceId, payload) {
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = sequenceId;
  return Buffer.concat([header, payload]);
}

function buildHandshake(connectionId) {
  const version = Buffer.from('8.0.37-m3-fixture\0', 'utf8');
  const payload = Buffer.alloc(128);
  let offset = 0;
  payload.writeUInt8(10, offset); offset += 1;
  version.copy(payload, offset); offset += version.length;
  payload.writeUInt32LE(connectionId, offset); offset += 4;
  offset += 8;
  payload.writeUInt8(0, offset); offset += 1;
  payload.writeUInt16LE(0x0fff, offset); offset += 2;
  payload.writeUInt8(0, offset); offset += 1;
  payload.writeUInt16LE(2, offset); offset += 2;
  payload.writeUInt16LE(0, offset); offset += 2;
  payload.writeUInt8(21, offset); offset += 1;
  offset += 10;
  Buffer.from('caching_sha2_password\0', 'utf8').copy(payload, offset); offset += 15;
  return payload.subarray(0, offset);
}

function buildOk() {
  return Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
}

/**
 * A tiny MySQL-shaped server.
 *
 * `respondToCommit` decides whether the COMMIT is answered. When it is false
 * the server stays silent, which is exactly the situation the proxy has to
 * fail closed on.
 */
async function startFakeMySqlServer({ connectionId = 4242, respondToCommit = true } = {}) {
  const parser = createMySqlPacketParser();
  const seen = { statements: [], commits: 0 };
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write(encodePacket(0, buildHandshake(connectionId)));
    socket.on('data', (chunk) => {
      for (const packet of parser.push(chunk)) {
        if (packet.payload[0] !== 0x03) continue;
        const statement = packet.payload.subarray(1).toString('utf8').trim();
        seen.statements.push(statement);
        if (/^COMMIT$/i.test(statement)) {
          seen.commits += 1;
          if (!respondToCommit) return;
        }
        socket.write(encodePacket(packet.sequenceId + 1, buildOk()));
      }
    });
  });
  await new Promise((resolveListen) => { server.listen(0, '127.0.0.1', resolveListen); });
  return {
    port: server.address().port,
    seen,
    async close() {
      for (const socket of [...sockets]) socket.destroy();
      await new Promise((resolveClose) => { server.close(() => resolveClose()); });
    },
  };
}

/** A raw client that speaks the MySQL framing, used to drive the proxy. */
function createRawMySqlClient(port) {
  const parser = createMySqlPacketParser();
  const received = [];
  const socket = net.connect({ host: '127.0.0.1', port });
  socket.on('data', (chunk) => {
    for (const packet of parser.push(chunk)) received.push(packet);
  });
  return {
    socket,
    received,
    waitFor(predicate, timeoutMs = 5000) {
      return new Promise((resolveWait, rejectWait) => {
        const timer = setTimeout(() => {
          clearInterval(poll);
          rejectWait(new Error('M3_PROXY_CLIENT_WAIT_TIMEOUT'));
        }, timeoutMs);
        const poll = setInterval(() => {
          const found = received.find(predicate);
          if (found) { clearTimeout(timer); clearInterval(poll); resolveWait(found); }
        }, 5);
      });
    },
    close() { socket.destroy(); },
  };
}

// ---------------------------------------------------------------------------
// M3-O01 / M3-O02 — framing and COMMIT recognition
// ---------------------------------------------------------------------------

describe('OUT-001 M3 离线回归：COMMIT 拦截代理', () => {
  test('M3-O01 MySQL packet parser 正确处理分包与粘包', () => {
    const packets = [
      { sequenceId: 0, payload: buildHandshake(4242) },
      { sequenceId: 1, payload: Buffer.from([0x03, ...Buffer.from('COMMIT')]) },
      { sequenceId: 2, payload: buildOk() },
    ];
    const stream = Buffer.concat(packets.map((packet) => encodePacket(packet.sequenceId, packet.payload)));

    // 粘包：三个包一次性送入，必须完整解出三个包。
    const coalesced = createMySqlPacketParser();
    const coalescedResult = coalesced.push(stream);
    assert.equal(coalescedResult.length, 3);
    assert.deepEqual(
      coalescedResult.map((packet) => packet.payload.length),
      packets.map((packet) => packet.payload.length),
    );
    assert.deepEqual(
      coalescedResult.map((packet) => packet.sequenceId),
      [0, 1, 2],
    );

    // 分包：逐字节送入，必须解出完全相同的三个包。
    const split = createMySqlPacketParser();
    const splitResult = [];
    for (const byte of stream) splitResult.push(...split.push(Buffer.from([byte])));
    assert.equal(splitResult.length, 3);
    assert.deepEqual(
      splitResult.map((packet) => packet.raw.toString('hex')),
      coalescedResult.map((packet) => packet.raw.toString('hex')),
      '分包与粘包必须解出完全相同的字节',
    );
    assert.deepEqual(
      splitResult.map((packet) => packet.payload.toString('utf8')),
      coalescedResult.map((packet) => packet.payload.toString('utf8')),
    );
    assert.equal(split.pendingBytes, 0, '解析器不得残留半个包');
  });

  test('M3-O02 只识别 COM_QUERY 的 COMMIT 语句', () => {
    const comQuery = (sql) => Buffer.concat([Buffer.from([0x03]), Buffer.from(sql)]);
    assert.equal(isCommitQueryPayload(comQuery('COMMIT')), true);
    assert.equal(isCommitQueryPayload(comQuery('commit')), true);
    assert.equal(isCommitQueryPayload(comQuery('  COMMIT  ')), true);
    assert.equal(isCommitQueryPayload(comQuery('COMMIT;')), true);
    assert.equal(isCommitQueryPayload(comQuery('ROLLBACK')), false);
    assert.equal(isCommitQueryPayload(comQuery('COMMIT AND CHAIN')), false);
    assert.equal(isCommitQueryPayload(comQuery('COMMIT WORK')), false);
    assert.equal(isCommitQueryPayload(comQuery('SELECT 1')), false);
    assert.equal(isCommitQueryPayload(comQuery('INSERT INTO t VALUES (1)')), false);
    // 预处理语句的执行报文也携带 SQL 文本，但它不是 COM_QUERY。
    assert.equal(isCommitQueryPayload(Buffer.concat([Buffer.from([0x17]), Buffer.from('COMMIT')])), false);
    assert.equal(isCommitQueryPayload(Buffer.from([0x01])), false);
    assert.equal(isCommitQueryPayload(Buffer.alloc(0)), false);
    assert.equal(isCommitQueryPayload(null), false);
    assert.equal(isOkPayload(buildOk()), true);
    assert.equal(isErrPayload(Buffer.from([0xff, 0x2a, 0x00])), true);
    assert.equal(isOkPayload(Buffer.from([0xff])), false);
    assert.equal(readHandshakeConnectionId(buildHandshake(4242)), 4242);
    assert.equal(readHandshakeConnectionId(buildOk()), null);
  });

  test('M3-O03 非 COMMIT 数据被原样透传', async () => {
    const server = await startFakeMySqlServer();
    const events = [];
    const proxy = createCommitWithholdingProxy({
      upstreamHost: '127.0.0.1', upstreamPort: server.port, onEvent: (event) => events.push(event.name),
    });
    await proxy.listen();
    const client = createRawMySqlClient(proxy.port);
    try {
      await client.waitFor((packet) => packet.payload[0] === 10);
      client.socket.write(encodePacket(1, Buffer.concat([Buffer.from([0x03]), Buffer.from('SELECT 1')])));
      const answer = await client.waitFor((packet) => packet.payload[0] === 0x00);
      assert.equal(answer.payload[0], 0x00, '非 COMMIT 语句必须收到服务端的原始应答');
      assert.deepEqual(server.seen.statements, ['SELECT 1']);
      assert.equal(proxy.stats.commitsForwarded, 0);
      assert.equal(proxy.stats.commitsWithheld, 0);
      assert.ok(!events.includes('COMMIT_RESPONSE_WITHHELD'));
    } finally {
      client.close();
      await proxy.close();
      await server.close();
    }
  });

  test('M3-O04 服务端的 COMMIT OK 被暂存并上报，客户端收不到确认', async () => {
    const server = await startFakeMySqlServer();
    const events = [];
    const proxy = createCommitWithholdingProxy({
      upstreamHost: '127.0.0.1', upstreamPort: server.port, onEvent: (event) => events.push(event),
    });
    await proxy.listen();
    const client = createRawMySqlClient(proxy.port);
    try {
      await client.waitFor((packet) => packet.payload[0] === 10);
      client.socket.write(encodePacket(1, Buffer.concat([Buffer.from([0x03]), Buffer.from('COMMIT')])));
      const withheld = await waitForEvent(events, 'COMMIT_RESPONSE_WITHHELD');
      assert.equal(withheld.connectionId, 4242, '必须记录服务端分配的真实 connection id');
      assert.equal(server.seen.commits, 1, 'COMMIT 必须被真实转发给服务端');
      assert.equal(proxy.stats.commitsForwarded, 1);
      assert.equal(proxy.stats.commitsWithheld, 1);
      // 服务端已经应答，但客户端在暂存期间不得收到任何应答包。
      await new Promise((resolveWait) => setTimeout(resolveWait, 120));
      assert.equal(
        client.received.filter((packet) => packet.payload[0] === 0x00).length,
        0,
        'COMMIT OK 不得被转发给客户端',
      );
      assert.ok(events.some((event) => event.name === 'COMMIT_FORWARDED'));
    } finally {
      client.close();
      await proxy.close();
      await server.close();
    }
  });

  test('M3-O05 服务端不确认 COMMIT 时代理超时并 fail closed', async () => {
    const server = await startFakeMySqlServer({ respondToCommit: false });
    const events = [];
    const proxy = createCommitWithholdingProxy({
      upstreamHost: '127.0.0.1',
      upstreamPort: server.port,
      commitAckTimeoutMs: 150,
      onEvent: (event) => events.push(event),
    });
    await proxy.listen();
    const client = createRawMySqlClient(proxy.port);
    try {
      await client.waitFor((packet) => packet.payload[0] === 10);
      client.socket.write(encodePacket(1, Buffer.concat([Buffer.from([0x03]), Buffer.from('COMMIT')])));
      const failure = await waitForEvent(events, 'PROXY_FAILED_CLOSED');
      assert.equal(failure.reason, 'MYSQL_PROXY_COMMIT_ACK_TIMEOUT');
      await new Promise((resolveWait) => setTimeout(resolveWait, 60));
      assert.equal(client.socket.destroyed, true, 'fail closed 必须关闭客户端 socket');
      assert.equal(proxy.liveSessions, 0, 'fail closed 之后不得残留会话');
    } finally {
      client.close();
      await proxy.close();
      await server.close();
    }
  });

  test('M3-O06 代理异常关闭后不残留 socket 与监听端口', async () => {
    const server = await startFakeMySqlServer();
    const proxy = createCommitWithholdingProxy({ upstreamHost: '127.0.0.1', upstreamPort: server.port });
    await proxy.listen();
    const client = createRawMySqlClient(proxy.port);
    await client.waitFor((packet) => packet.payload[0] === 10);
    assert.equal(proxy.liveSessions, 1);
    const port = proxy.port;
    await proxy.close();
    client.close();
    await server.close();

    assert.equal(proxy.liveSessions, 0, '关闭后不得残留会话');
    // 端口必须真正释放：再次连接必须被拒绝。
    await assert.rejects(
      () => new Promise((resolveConnect, rejectConnect) => {
        const probe = net.connect({ host: '127.0.0.1', port });
        probe.once('connect', () => { probe.destroy(); resolveConnect(); });
        probe.once('error', rejectConnect);
      }),
      '代理关闭后端口必须不可连接',
    );
  });
});

async function waitForEvent(events, name, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find((event) => event.name === name);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`M3_PROXY_EVENT_TIMEOUT:${name}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
}

// ---------------------------------------------------------------------------
// M3-O07 / M3-O08 — the transaction-level disposition
// ---------------------------------------------------------------------------

describe('OUT-001 M3 离线回归：不确定 COMMIT 的事务处置', () => {
  test('M3-O07 / M3-O08 不确定 COMMIT 不进入 ROLLBACK、不建立新会话、业务体只执行一次', async () => {
    const adapter = new MySqlSyncAdapter({}, { workerUrl: m3WorkerUrl, requestTimeoutMs: 5000 });
    const sessions = [];
    const statements = [];
    adapter.worker.on('message', (message) => {
      if (message?.event === 'session') sessions.push(message.count);
      if (message?.event === 'statement') statements.push(message.classification);
    });
    try {
      let workCalls = 0;
      let caught = null;
      try {
        transaction(adapter, () => {
          workCalls += 1;
          // 在事务内布置一次可恢复的连接错误：随后的 COMMIT 会失败，且结果未知。
          adapter.prepare('SELECT 1 FROM __m3_inject_op_error WHERE code = ?').run('PROTOCOL_CONNECTION_LOST');
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught, '不确定 COMMIT 必须抛出原异常');
      assert.equal(workCalls, 1, 'M3-O12：业务体始终只执行一次');
      assert.equal(isUncertainCommitOutcome(caught), true, '原异常必须携带不确定 COMMIT 标记');
      assert.equal(caught.sessionLost, true, '原异常必须保留 sessionLost 标记');
      assert.equal(caught.classification, 'COMMIT', '原异常必须保留 COMMIT classification');
      assert.equal(caught.uncertainCommitClassification, 'COMMIT');
      assert.equal(caught.code, 'PROTOCOL_CONNECTION_LOST', '原始错误码不得被改写');
      assert.equal(adapter.quarantined, true, '不确定 COMMIT 必须立即隔离适配器');
      assert.equal(adapter.quarantineState.reason, 'uncertain_commit');
      assert.equal(
        adapter.quarantineState.state,
        'TERMINATION_PENDING',
        '终止确认之前适配器不得被当作可复用会话',
      );
      assert.notEqual(adapter.sessionState, 'IDLE_TRUSTED');
      // The adapter blocks the main thread with `Atomics.wait` while a request
      // is in flight, so the Worker's reports are only delivered once the
      // event loop runs again.
      await new Promise((resolveTick) => setTimeout(resolveTick, 50));
      assert.equal(sessions.length > 0, true, 'Worker 必须报告过它使用的会话');
      assert.deepEqual(
        [...new Set(sessions)],
        [1],
        `M3-O08：不确定 COMMIT 不得建立新的 Worker 会话，实际会话：${JSON.stringify(sessions)}`,
      );
      assert.equal(adapter.sessionEpoch, 1, '会话 epoch 不得变化：不得建立替代会话');
      assert.ok(
        !statements.includes('ROLLBACK'),
        `M3-O07：不确定 COMMIT 不得发出 ROLLBACK，实际执行：${JSON.stringify(statements)}`,
      );
      assert.ok(statements.includes('COMMIT'), 'COMMIT 必须真的发出过');
      // 被隔离的适配器不得再执行任何语句。
      assert.throws(
        () => adapter.prepare('SELECT 1').get(),
        (error) => error.code === 'MYSQL_SESSION_QUARANTINED',
      );
    } finally {
      adapter.close();
    }
  });

  test('M3-O09 只有 TERMINATION_CONFIRMED 之后才清理命名锁登记', async () => {
    const db = createFakeMySqlDb({ terminationOutcome: 'TERMINATION_CONFIRMED' });
    db._idempotencyLocks.add('erp-idem-m3-o09');
    const uncertain = Object.assign(new Error('connection lost'), { sessionLost: true, classification: 'COMMIT' });
    db.commitError = uncertain;
    let caught = null;
    try {
      transaction(db, () => 'work');
    } catch (error) {
      caught = error;
    }
    assert.equal(isUncertainCommitOutcome(caught), true);
    assert.equal(
      db._idempotencyLocks.size,
      1,
      '终止尚未确认时命名锁登记必须保留：会话可能仍然存活',
    );
    await db.quarantineState.termination;
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
    assert.equal(db.quarantineState.state, 'TERMINATION_CONFIRMED');
    assert.equal(db._idempotencyLocks.size, 0, '终止确认后命名锁登记必须被清理');
    assert.ok(
      !db.events.some((event) => String(event).startsWith('RELEASE_LOCK')),
      '清理不得对被销毁的会话发出任何 SQL',
    );
  });

  test('M3-O10 TERMINATION_FAILED 时保持隔离，命名锁登记不得清理', async () => {
    const db = createFakeMySqlDb({ terminationOutcome: 'TERMINATION_FAILED' });
    db._idempotencyLocks.add('erp-idem-m3-o10');
    const uncertain = Object.assign(new Error('connection lost'), { sessionLost: true, classification: 'COMMIT' });
    db.commitError = uncertain;
    let caught = null;
    try {
      transaction(db, () => 'work');
    } catch (error) {
      caught = error;
    }
    assert.equal(isUncertainCommitOutcome(caught), true);
    await db.quarantineState.termination;
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
    assert.equal(db.quarantineState.state, 'TERMINATION_FAILED');
    assert.equal(db.quarantined, true, '终止失败必须保持隔离');
    assert.equal(
      db._idempotencyLocks.size,
      1,
      '终止失败时不得冒充 SESSION_DESTROYED，命名锁登记必须保留',
    );
    assert.ok(
      !db.events.some((event) => String(event).startsWith('RELEASE_LOCK')),
      '终止失败时不得发出任何锁释放语句',
    );
  });

  test('M3-O07b 普通业务错误仍然走 ROLLBACK，且不被标记为不确定 COMMIT', () => {
    const db = createFakeMySqlDb();
    const businessError = new Error('business rule blocked');
    let caught = null;
    try {
      transaction(db, () => { throw businessError; });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught, businessError, '原始异常实例必须保持不变');
    assert.equal(isUncertainCommitOutcome(caught), false);
    assert.ok(db.events.includes('ROLLBACK'), '普通业务错误仍然必须回滚');
    assert.equal(db.quarantined, false);
  });
});

// ---------------------------------------------------------------------------
// M3-O11 — the WIP transfer handler must not turn an uncertain COMMIT into a
// business rejection.
// ---------------------------------------------------------------------------

describe('OUT-001 M3 离线回归：WIP 转移的不确定 COMMIT 处置', () => {
  let fixture;
  let seq = 0;

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-out001-m3-');
    await qualifyOutsourceSupplier(fixture);
  });
  after(async () => { if (fixture) await fixture.close(); });

  test('M3-O11 不确定 COMMIT 不写普通拒绝审计，保留原异常，不产生第二笔业务事实', async () => {
    const source = await createOrderWithMaterial(fixture, () => { seq += 1; return seq; });
    const target = await createOrderWithMaterial(fixture, () => { seq += 1; return seq; });
    await issueWip(fixture, source, 5);
    const idempotencyKey = `out001-m3-offline-${Date.now()}`;
    const body = {
      sourceOrderId: source.orderId,
      targetOrderId: target.orderId,
      materialListId: source.materialRow.id,
      quantity: 3,
      transferDate: isoDate(0),
      idempotencyKey,
    };

    const rejectionBefore = Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_ORDER'",
    ).get().n);
    const successAuditBefore = Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='TRANSFER' AND entity_type='OUTSOURCING_WIP_TRANSFER'",
    ).get().n);
    const transfersBefore = Number(fixture.db.prepare(
      'SELECT COUNT(*) n FROM outsourcing_wip_transfers',
    ).get().n);

    const uncertainError = Object.assign(new Error('simulated uncertain COMMIT'), {
      sessionLost: true,
      classification: 'COMMIT',
    });
    const db = createUncertainCommitDb(fixture.db, uncertainError);
    const actor = { id: 'user-admin', permissions: ['OUTSOURCING_MATERIAL_EXECUTE'] };

    let caught = null;
    try {
      await createWipTransfer(db, createJsonRequest(body), createResponseStub(), actor);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, '不确定 COMMIT 必须向上抛出');
    assert.equal(caught, uncertainError, '必须保留原始异常实例');
    assert.equal(isUncertainCommitOutcome(caught), true);
    assert.equal(db.quarantined, true, '适配器必须被隔离');
    assert.equal(db.quarantineReason, 'uncertain_commit');
    assert.equal(
      Number(fixture.db.prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_ORDER'",
      ).get().n),
      rejectionBefore,
      '不确定 COMMIT 不得被记为普通业务拒绝',
    );
    assert.equal(
      Number(fixture.db.prepare(
        "SELECT COUNT(*) n FROM audit_logs WHERE action='TRANSFER' AND entity_type='OUTSOURCING_WIP_TRANSFER'",
      ).get().n),
      successAuditBefore,
      '不确定 COMMIT 不得产生成功审计',
    );
    assert.equal(
      Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n),
      transfersBefore,
      '不确定 COMMIT 不得产生第二笔转移事实',
    );
    assert.equal(
      Number(fixture.db.prepare(
        'SELECT COUNT(*) n FROM idempotency_records WHERE operation_type=? AND idempotency_key=?',
      ).get('OUTSOURCING_WIP_TRANSFER', idempotencyKey).n),
      0,
      '不确定 COMMIT 的幂等记录未提交时不得被伪造',
    );
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function qualifyOutsourceSupplier(fixture) {
  const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
    outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
    qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
  });
  assert.equal(result.status, 200, result.data.error);
  fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,100000,?)
    ON CONFLICT(balance_key) DO NOTHING`).run(new Date().toISOString());
}

async function createOrderWithMaterial(fixture, nextSeq) {
  const seq = nextSeq();
  const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 10, unit: 'PCS' }], `out001-m3-${seq}`);
  const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
    supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(0), bomId,
  });
  assert.equal(order.status, 201, order.data.error);
  await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
  await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
  const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
    items: [{ productId: 'product-001', requiredQuantity: 10, unit: 'PCS', sourceWarehouseId: 'warehouse-001' }],
  });
  assert.equal(snapshot.status, 200, snapshot.data.error);
  const materialRow = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?')
    .get(order.data.id, 'product-001');
  return { orderId: order.data.id, materialRow };
}

async function issueWip(fixture, source, quantity) {
  const now = new Date().toISOString();
  fixture.db.prepare(`UPDATE inventory SET quantity=quantity+1000, updated_at=?
    WHERE warehouse_id='warehouse-001' AND product_id=? AND owner_type='ENTERPRISE' AND owner_id IS NULL
      AND stock_status='AVAILABLE' AND lot_id IS NULL AND serial_id IS NULL AND active=1`)
    .run(now, source.materialRow.product_id);
  fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
    VALUES(?,'MOVING_AVERAGE',?,'warehouse-001',NULL,NULL,1000,1000000,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity, value_cents=excluded.value_cents, updated_at=excluded.updated_at`)
    .run(`NONE:warehouse-001:${source.materialRow.product_id}`, source.materialRow.product_id, now);
  const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${source.orderId}/issues`, fixture.tokens.admin, {
    materialListId: source.materialRow.id, quantity, issuedDate: isoDate(0), idempotencyKey: `issue-m3-${source.orderId}-${quantity}`,
  });
  assert.equal(issued.status, 201, issued.data.error);
}

/**
 * A MySQL-shaped facade over the real SQLite fixture.
 *
 * Only three things differ from the real adapter: the dialect (so the MySQL
 * transaction branch is taken), the statements SQLite cannot express (the
 * named locks and the `FOR UPDATE` transaction gate) and the COMMIT — which
 * fails with an uncertain outcome after the underlying transaction has been
 * rolled back, i.e. the "the commit never became durable" variant. Every
 * business statement is executed by the real SQLite engine, so the WIP
 * transfer body under test is the production one.
 */
function createUncertainCommitDb(sqliteDb, uncertainError) {
  const db = {
    dialect: 'mysql',
    isTransaction: false,
    sessionState: 'IDLE_TRUSTED',
    sessionEpoch: 1,
    quarantined: false,
    quarantineReason: null,
    quarantineState: null,
    admissionRefusalCount: 0,
    _idempotencyLocks: new Set(),
    _idempotencyLockEpoch: null,
    exec(sql) {
      const text = String(sql || '').trim();
      if (/^COMMIT\b/i.test(text)) {
        // The COMMIT never becomes durable: the underlying transaction is
        // rolled back and the client is left with an unknown outcome.
        try { sqliteDb.exec('ROLLBACK'); } catch { /* no open transaction */ }
        db.isTransaction = false;
        throw uncertainError;
      }
      if (/^BEGIN\b/i.test(text)) { sqliteDb.exec('BEGIN IMMEDIATE'); db.isTransaction = true; return { ok: true }; }
      if (/^ROLLBACK\b/i.test(text)) { try { sqliteDb.exec('ROLLBACK'); } catch { /* ignore */ } db.isTransaction = false; return { ok: true }; }
      return { ok: true };
    },
    prepare(sql) {
      const text = String(sql || '');
      if (/GET_LOCK/i.test(text)) return { get: () => ({ acquired: 1 }) };
      if (/RELEASE_LOCK/i.test(text)) return { get: () => ({ released: 1 }) };
      if (/mysql_transaction_gates/i.test(text)) return { get: () => ({ gate_id: 1 }) };
      return sqliteDb.prepare(sql);
    },
    quarantine(reason) {
      db.quarantined = true;
      db.quarantineReason = reason;
      db.sessionState = 'QUARANTINED';
      db.quarantineState = {
        reason,
        state: 'TERMINATION_CONFIRMED',
        termination: Promise.resolve(),
      };
      return db.quarantineState;
    },
  };
  return db;
}

function createJsonRequest(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { yield payload; },
  };
}

function createResponseStub() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    end(chunk) { this.body = chunk ? String(chunk) : ''; },
  };
}

/**
 * A minimal MySQL adapter contract used by the transaction-level cases. It
 * records every statement so a test can prove that no ROLLBACK was issued.
 */
function createFakeMySqlDb({ terminationOutcome = 'TERMINATION_CONFIRMED' } = {}) {
  const events = [];
  const db = {
    dialect: 'mysql',
    isTransaction: false,
    sessionState: 'IDLE_TRUSTED',
    sessionEpoch: 1,
    quarantined: false,
    quarantineReason: null,
    quarantineState: null,
    admissionRefusalCount: 0,
    _idempotencyLocks: new Set(),
    _idempotencyLockEpoch: null,
    commitError: null,
    events,
    exec(sql) {
      events.push(sql);
      const head = String(sql).trim().toUpperCase();
      if (head.startsWith('BEGIN')) { db.isTransaction = true; db.sessionState = 'ACTIVE'; return { ok: true }; }
      if (head.startsWith('COMMIT')) {
        if (db.commitError) { const error = db.commitError; db.commitError = null; throw error; }
        db.isTransaction = false;
        db.sessionState = 'IDLE_TRUSTED';
        return { ok: true };
      }
      if (head.startsWith('ROLLBACK')) { db.isTransaction = false; db.sessionState = 'IDLE_TRUSTED'; return { ok: true }; }
      return { ok: true };
    },
    prepare(sql) {
      events.push(sql);
      return {
        get(...params) {
          if (/GET_LOCK/i.test(sql)) { events.push(`GET_LOCK:${params[0]}`); return { acquired: 1 }; }
          if (/RELEASE_LOCK/i.test(sql)) { events.push(`RELEASE_LOCK:${params[0]}`); return { released: 1 }; }
          if (/mysql_transaction_gates/i.test(sql)) { events.push('GATE_ACQUIRED'); return { gate_id: 1 }; }
          return {};
        },
      };
    },
    quarantine(reason) {
      db.quarantined = true;
      db.quarantineReason = reason;
      db.sessionState = 'QUARANTINED';
      const state = {
        reason,
        state: 'TERMINATION_PENDING',
        termination: null,
      };
      db.quarantineState = state;
      state.termination = Promise.resolve().then(() => {
        state.state = terminationOutcome;
      });
      return state;
    },
  };
  return db;
}
