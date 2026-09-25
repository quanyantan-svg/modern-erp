import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';

test('a timed-out MySQL response cannot satisfy a later synchronous request', () => {
  const adapter = new MySqlSyncAdapter({}, {
    workerUrl: new URL('./database/test-fixtures/delayed-mysql-worker.js', import.meta.url),
    requestTimeoutMs: 2_000,
  });

  try {
    // Worker startup is intentionally outside the short operation timeout so
    // this stays deterministic when the full test suite runs concurrently.
    adapter.requestTimeoutMs = 100;
    assert.throws(
      () => adapter.prepare('FIRST_REQUEST').all(150),
      /timed out/,
    );
    const rows = adapter.prepare('SECOND_REQUEST').all(75);
    assert.deepEqual(rows, [{ request: 'SECOND_REQUEST' }]);
  } finally {
    adapter.close();
  }
});
