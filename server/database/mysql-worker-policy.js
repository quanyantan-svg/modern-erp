// The recovery policy of the MySQL Worker.
//
// It lives in its own module so that the policy has exactly one source of
// truth while the Worker entry point keeps its side effects. A test fixture
// Worker can therefore share the production classifiers without also loading
// the production Worker, whose `parentPort` registration would start a second
// (real) MySQL client inside the fixture's Worker thread.

// Codes that indicate a transport-level connection problem we can recover
// from by establishing a fresh MySQL session. Anything else (SQL constraint
// errors, parse errors, deadlock retries handled by the application layer)
// must not silently trigger a reconnect.
export const RECOVERABLE_CONNECTION_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_PACKETS_OUT_OF_ORDER',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export function isRecoverableConnectionError(error) {
  if (!error) return false;
  if (typeof error.code === 'string' && RECOVERABLE_CONNECTION_CODES.has(error.code)) {
    return true;
  }
  // mysql2 sometimes surfaces a wrapped error without `code` but with `errno`
  // for protocol-level conditions.
  const message = String(error.message || '');
  if (/Connection lost|Connection terminated|Server has gone away|Packets out of order/i.test(message)) {
    return true;
  }
  return false;
}

// Conservative read-only classifier. Anything we cannot prove is a read is
// considered a write and is NOT auto-retried after a recoverable error.
export function isReadOnlySql(sql) {
  if (typeof sql !== 'string') return false;
  const head = sql.trim().replace(/^[\s(]+/, '').toUpperCase();
  return /^(SELECT|WITH)\b/.test(head)
    || /^SHOW\b/.test(head)
    || /^DESCRIBE\b/.test(head)
    || /^DESC\b/.test(head)
    || /^EXPLAIN\b/.test(head);
}

export function classifyExecStatement(sql) {
  const head = String(sql || '').trim().replace(/;\s*$/, '').replace(/^[\s(]+/, '').toUpperCase();
  if (/^BEGIN\b/.test(head) || /^START\s+TRANSACTION\b/.test(head)) return 'BEGIN';
  if (/^COMMIT\b/.test(head)) return 'COMMIT';
  if (/^ROLLBACK\b/.test(head)) return 'ROLLBACK';
  return 'OTHER';
}
