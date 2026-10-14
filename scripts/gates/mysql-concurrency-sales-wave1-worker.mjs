// Sales & Customer Wave 1 — real MySQL concurrency worker.
//
// Each spawned worker holds an INDEPENDENT MySqlSyncAdapter and therefore
// an independent MySQL connection / session. The main process can spawn
// several workers, ask each for its canonical CONNECTION_ID, drive them
// through a control-session + IPC synchronization protocol, and observe
// real database-level contention on the Wave 1 canonical writers.
//
// `action` is one of:
//   - register                       reports connection id + process id
//   - hold-gate                      opens a transaction that locks
//                                    mysql_transaction_gates FOR UPDATE
//                                    and waits for an external release
//   - release-gate                   commits the held transaction
//   - create-customer-extension
//   - create-salesperson-membership
//   - create-sellable-scope-rule
//   - close
//
// Synchronization protocol:
//
//   1. Test spawns three workers (alpha, beta, control) on independent
//      MySQL sessions. Each reports its CONNECTION_ID via `register`.
//   2. Test invokes `hold-gate` on the control worker. The control
//      worker opens its own transaction and acquires the canonical
//      mysql_transaction_gates FOR UPDATE row. The transaction stays
//      open until `release-gate` is received.
//   3. Test invokes the race-write action on alpha and beta in
//      parallel. Both workers run the canonical `transaction(db, work)`
//      writer; their gate SELECT FOR UPDATE blocks because the control
//      worker holds the gate. Both transactions remain open and
//      queued at the gate simultaneously.
//   4. Test polls information_schema.PROCESSLIST for alpha and beta
//      CONNECTION_IDs to confirm both threads are observable in MySQL
//      (this is the LOCK_WAIT_OBSERVED condition — both writers are
//      parked at the canonical gate). No fixed sleep substitutes for
//      this observation.
//   5. Test invokes `release-gate` on the control worker. The control
//      transaction commits, releasing the gate.
//   6. Alpha and beta unblock at the gate. The first to acquire it
//      runs its business mutation; the second acquires it after the
//      first commits, runs work, and the canonical writer throws the
//      domain-specific conflict (CUSTOMER_COMMERCIAL_INTERVAL_OVERLAP
//      / SALESPERSON_DEFAULT_GROUP_INVALID /
//      SELLABLE_SCOPE_INTERVAL_OVERLAP).
//   7. Test verifies HTTP 201 / 409 outcomes, distinct CONNECTION_IDs,
//      exact conflict code, and atomic audit.

import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { createCustomerCommercialExtension, saveSellableScopeRule } from '../../server/modules/sales-commercial-foundation.js';
import { saveSalespersonMembership } from '../../server/modules/sales-foundation.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);

function connectionId() {
  return Number(db.prepare('SELECT CONNECTION_ID() id').get().id);
}

// The control worker holds the canonical transaction gate row in a
// long-lived transaction. `release-gate` commits that transaction.
let gateTransactionOpen = false;

function execute(command) {
  if (command.action === 'register') {
    return { dialect: db.dialect, connectionId: connectionId(), processId: process.pid };
  }
  if (command.action === 'hold-gate') {
    // Open BEGIN and lock the canonical transaction gate row FOR UPDATE.
    // The transaction stays open until `release-gate` arrives.
    db.exec('START TRANSACTION');
    const row = db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
    if (!row) {
      db.exec('ROLLBACK');
      throw new Error('mysql_transaction_gates row must exist');
    }
    gateTransactionOpen = true;
    return { held: true, connectionId: connectionId(), processId: process.pid };
  }
  if (command.action === 'release-gate') {
    if (!gateTransactionOpen) {
      return { released: false, note: 'no open gate transaction' };
    }
    db.exec('COMMIT');
    gateTransactionOpen = false;
    return { released: true, connectionId: connectionId(), processId: process.pid };
  }
  if (command.action === 'create-customer-extension') {
    const req = {
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(command.body)); },
    };
    const res = {
      statusCode: 0, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value) { this.body = value ? JSON.parse(value) : null; },
    };
    const actor = { id: command.actorId, permissions: ['SALES_FOUNDATION_MANAGE', 'SALES_COMMERCIAL_MANAGE'] };
    return createCustomerCommercialExtension(db, req, res, actor)
      .then(() => ({ status: res.statusCode, body: res.body, connectionId: connectionId(), processId: process.pid }))
      .catch((error) => ({
        status: error.status || 500,
        code: error.code,
        message: error.message,
        connectionId: connectionId(),
        processId: process.pid,
        transactionRetryExhausted: Boolean(error.transactionRetryExhausted),
        transactionAttempts: error.transactionAttempts,
        errno: error.errno,
        sqlState: error.sqlState,
      }));
  }
  if (command.action === 'create-salesperson-membership') {
    const req = {
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(command.body)); },
    };
    const res = {
      statusCode: 0, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value) { this.body = value ? JSON.parse(value) : null; },
    };
    const actor = { id: command.actorId, permissions: ['SALES_FOUNDATION_MANAGE', 'SALES_COMMERCIAL_MANAGE'] };
    return saveSalespersonMembership(db, req, res, actor)
      .then(() => ({ status: res.statusCode, body: res.body, connectionId: connectionId(), processId: process.pid }))
      .catch((error) => ({
        status: error.status || 500,
        code: error.code,
        message: error.message,
        connectionId: connectionId(),
        processId: process.pid,
        transactionRetryExhausted: Boolean(error.transactionRetryExhausted),
        transactionAttempts: error.transactionAttempts,
        errno: error.errno,
        sqlState: error.sqlState,
      }));
  }
  if (command.action === 'create-sellable-scope-rule') {
    const req = {
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(command.body)); },
    };
    const res = {
      statusCode: 0, headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(value) { this.body = value ? JSON.parse(value) : null; },
    };
    const actor = { id: command.actorId, permissions: ['SALES_FOUNDATION_MANAGE', 'SALES_COMMERCIAL_MANAGE'] };
    return saveSellableScopeRule(db, req, res, actor)
      .then(() => ({ status: res.statusCode, body: res.body, connectionId: connectionId(), processId: process.pid }))
      .catch((error) => ({
        status: error.status || 500,
        code: error.code,
        message: error.message,
        connectionId: connectionId(),
        processId: process.pid,
        transactionRetryExhausted: Boolean(error.transactionRetryExhausted),
        transactionAttempts: error.transactionAttempts,
        errno: error.errno,
        sqlState: error.sqlState,
      }));
  }
  if (command.action === 'close') {
    if (gateTransactionOpen) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      gateTransactionOpen = false;
    }
    db.close();
    return { closed: true };
  }
  throw new Error(`Unknown action: ${command.action}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    const result = await execute(request.command);
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request?.id, ok: false, error: {
      message: error.message, code: error.code,
      errno: error.errno, sqlState: error.sqlState, sqlMessage: error.sqlMessage,
      transactionRetryExhausted: error.transactionRetryExhausted || false,
      transactionAttempts: error.transactionAttempts,
    } })}\n`);
  }
});
lines.on('close', () => { try { db.close(); } catch { /* ignore */ } });