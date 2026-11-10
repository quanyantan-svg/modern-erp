#!/usr/bin/env node

// M2 fixture: one process owns exactly one HTTP server and one MySQL adapter.
// It never bootstraps or cleans the schema; the protected Root owns those
// operations. The parent receives only the loopback URL and test login tokens.
//
// M3 addition (OUT-001 real uncertain COMMIT): the victim application process
// routes its MySQL session through the loopback COMMIT-withholding proxy, so
// the child also answers two probes over the existing IPC channel:
//
//   CONNECTION_ID — the victim's real MySQL connection id, account identity
//                   (CURRENT_USER() / DATABASE()) and session epoch;
//   TRANSFER      — a real WIP transfer POST, plus the adapter's own verdict
//                   about the failure (quarantine, termination, and the
//                   original error's classification).
//
// The child never inspects or rewrites the MySQL traffic itself: the proxy
// owns the transport, and this process only reports what its own adapter
// observed.

import { createProcurementFixture } from '../../server/test-support/procurement-http-fixture.js';

let fixture;
const diagnostics = { lastError: null, sessionStateAtQuarantine: null, requestCount: 0 };

try {
  fixture = await createProcurementFixture(`modern-erp-out001-app-${process.pid}-`);
  installAdapterDiagnostics(fixture.db);
  process.send?.({ type: 'READY', baseUrl: fixture.baseUrl, tokens: fixture.tokens, pid: process.pid });
} catch (error) {
  process.send?.({ type: 'ERROR', message: error?.message || String(error) });
  throw error;
}

/**
 * Observe the adapter without changing its behaviour.
 *
 * The original error instance is kept (not a snapshot) so that the markers
 * added further up the call chain — the uncertain-COMMIT marker in
 * particular — are visible in the report.
 */
function installAdapterDiagnostics(db) {
  if (typeof db?._request === 'function') {
    const originalRequest = db._request.bind(db);
    db._request = (action, payload = {}) => {
      diagnostics.requestCount += 1;
      try {
        return originalRequest(action, payload);
      } catch (error) {
        diagnostics.lastError = error;
        throw error;
      }
    };
  }
  if (typeof db?.quarantine === 'function') {
    const originalQuarantine = db.quarantine.bind(db);
    db.quarantine = (reason) => {
      if (diagnostics.sessionStateAtQuarantine === null) {
        diagnostics.sessionStateAtQuarantine = db.sessionState ?? null;
      }
      return originalQuarantine(reason);
    };
  }
}

function serializeLastError() {
  const error = diagnostics.lastError;
  if (!error) return null;
  return {
    code: error?.code ?? null,
    message: error?.message ?? null,
    classification: error?.classification ?? null,
    sessionLost: error?.sessionLost === true,
    mysqlRequestTimeout: error?.mysqlRequestTimeout === true,
    uncertainCommit: error?.uncertainCommit === true,
  };
}

async function handleProbe(message) {
  const probe = String(message?.probe || '');
  try {
    if (probe === 'CONNECTION_ID') {
      // The victim's own session identity. `CURRENT_USER()` is the account
      // that actually authenticated this session (`user@host`); `DATABASE()`
      // is the schema this session is bound to. Both are reported so that the
      // parent can compare them with the observer's without ever comparing a
      // `CURRENT_USER()` value against a `PROCESSLIST.USER` value.
      const row = fixture.db.prepare(
        'SELECT CONNECTION_ID() id, CURRENT_USER() currentUser, DATABASE() databaseName',
      ).get();
      process.send?.({
        type: 'PROBE_RESULT',
        probe,
        ok: true,
        connectionId: Number(row?.id ?? 0),
        currentUser: String(row?.currentUser ?? ''),
        database: String(row?.databaseName ?? ''),
        sessionEpoch: fixture.db.sessionEpoch ?? null,
        sessionState: fixture.db.sessionState ?? null,
      });
      return;
    }
    if (probe === 'TRANSFER') {
      const response = await fetch(`${fixture.baseUrl}/api/procurement/outsourcing/wip-transfers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${fixture.tokens.admin}`, 'content-type': 'application/json' },
        body: JSON.stringify(message?.body ?? {}),
      });
      const data = await response.json().catch(() => ({}));
      const adapter = fixture.db;
      // The termination is settled by the adapter itself; the report waits for
      // it so that R1 can be judged on a confirmed state.
      if (adapter.quarantineState?.termination) await adapter.quarantineState.termination;
      process.send?.({
        type: 'PROBE_RESULT',
        probe,
        ok: true,
        status: response.status,
        data,
        adapter: {
          quarantined: adapter.quarantined === true,
          sessionState: adapter.sessionState ?? null,
          quarantineReason: adapter.quarantineState?.reason ?? null,
          quarantineState: adapter.quarantineState?.state ?? null,
          sessionEpoch: adapter.sessionEpoch ?? null,
        },
        diagnostics: {
          sessionStateAtQuarantine: diagnostics.sessionStateAtQuarantine,
          requestCount: diagnostics.requestCount,
          lastError: serializeLastError(),
        },
      });
      return;
    }
    process.send?.({ type: 'PROBE_RESULT', probe, ok: false, error: `OUT001_UNKNOWN_PROBE:${probe}` });
  } catch (error) {
    process.send?.({ type: 'PROBE_RESULT', probe, ok: false, error: error?.message || String(error) });
  }
}

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try { await fixture?.close(); } finally { process.exit(0); }
}

process.on('message', (message) => {
  if (message?.type === 'STOP') void close();
  if (message?.type === 'PROBE') void handleProbe(message);
});
process.on('disconnect', () => void close());
