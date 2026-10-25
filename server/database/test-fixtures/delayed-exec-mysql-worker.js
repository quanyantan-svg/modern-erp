// Test-only Worker for the Transaction Lifecycle Safety tests
// (document.md §5.4.1-§5.4.2, solution.md §37.31). It never opens a real
// MySQL connection, so it proves control flow and Worker/adapter contract —
// never real InnoDB behaviour.
//
// Control surface:
//   * every 'exec' is delayed by EXEC_DELAY_MS so the adapter can be forced
//     deterministically into the request-timeout path;
//   * every received message is reported to the parent as 'request-received',
//     so a test can prove that a quarantined adapter dispatches no further
//     message instead of sleeping;
//   * a completed 'exec' is reported as 'exec-completed', so a test can await
//     the late completion of an abandoned request without sleeping.

import { parentPort } from 'node:worker_threads';
import { encodeWorkerResponse } from '../mysql-worker-protocol.js';

const EXEC_DELAY_MS = 150;
const SESSION_EPOCH = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classify(sql) {
  const head = String(sql || '').trim().replace(/^[\s(]+/, '').toUpperCase();
  if (/^BEGIN\b/.test(head) || /^START\s+TRANSACTION\b/.test(head)) return 'BEGIN';
  if (/^COMMIT\b/.test(head)) return 'COMMIT';
  if (/^ROLLBACK\b/.test(head)) return 'ROLLBACK';
  return 'OTHER';
}

if (parentPort) {
  parentPort.on('message', async ({ action, payload, shared, requestId }) => {
    parentPort.postMessage({ event: 'request-received', action, requestId });
    try {
      if (action === 'connect') {
        encodeWorkerResponse(shared, requestId, { connected: true, sessionEpoch: SESSION_EPOCH });
        return;
      }
      if (action === 'close') {
        encodeWorkerResponse(shared, requestId, { closed: true, sessionEpoch: SESSION_EPOCH });
        return;
      }
      if (action === 'exec') {
        const classification = classify(payload?.sql);
        await sleep(EXEC_DELAY_MS);
        encodeWorkerResponse(shared, requestId, {
          ok: true,
          inTransaction: classification === 'BEGIN',
          classification,
          sessionEpoch: SESSION_EPOCH,
        });
        parentPort.postMessage({ event: 'exec-completed', requestId, classification });
        return;
      }
      if (action === 'query') {
        encodeWorkerResponse(shared, requestId, { rows: [], sessionEpoch: SESSION_EPOCH });
        return;
      }
      throw new Error(`Unknown fixture MySQL worker action: ${action}`);
    } catch (error) {
      encodeWorkerResponse(shared, requestId, {
        message: error?.message || String(error),
        code: error?.code,
        sessionEpoch: SESSION_EPOCH,
      }, 2);
    }
  });
}
