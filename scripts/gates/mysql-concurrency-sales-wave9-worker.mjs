// Wave 9 Credit Lock Anchor — MySQL-native concurrency worker.
//
// One spawned process owns one MySqlSyncAdapter, which is one dedicated mysql2
// connection, so every worker here is an independent MySQL session. The SQLite
// worker in server/test-utils/wave9-anchor-worker.js cannot prove MySQL Anchor
// convergence: it opens a node:sqlite DatabaseSync over a file path.
//
// ensureCreditLockAnchor is the unmodified production function. Only the
// surrounding transaction wrapper differs, and only because the canonical
// transaction() in server/db.js takes the global mysql_transaction_gates row
// first, which would serialize every session and hide the unique-key
// contention this worker exists to provoke:
//   - ensure-anchor-contended : raw START TRANSACTION, so sessions genuinely
//     race the uq_credit_lock_anchors_anchor_key unique index;
//   - ensure-anchor-gated     : the canonical transaction() wrapper.

import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { transaction } from '../../server/db.js';
import { ensureCreditLockAnchor } from '../../server/modules/credit-anchor.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
let held = false;
let lastDeadlock = null;

const connectionId = () => Number(db.prepare('SELECT CONNECTION_ID() id').get().id);

function invoke(work) {
  try {
    return { status: 200, data: work(), connectionId: connectionId() };
  } catch (error) {
    return {
      status: error.status || 500,
      code: error.code,
      errno: error.errno,
      message: error.message,
      connectionId: connectionId(),
    };
  }
}

function ensureHeld() {
  db.exec('START TRANSACTION');
  held = true;
}

function execute(command) {
  if (command.action === 'register') {
    return { dialect: db.dialect, connectionId: connectionId(), processId: process.pid };
  }
  // Taken before the racing INSERT. A session that observes the key absent and
  // still ends up holding the canonical identity can only have reached it
  // through the duplicate-key branch of ensureCreditLockAnchor.
  if (command.action === 'probe-anchor') {
    return { existed: Boolean(db.prepare('SELECT id FROM credit_lock_anchors WHERE anchor_key=?').get(command.anchorKey)) };
  }
  if (command.action === 'ensure-anchor-contended') {
    lastDeadlock = null;
    const result = invoke(() => {
      ensureHeld();
      const anchor = ensureCreditLockAnchor(db, command.shape);
      if (!command.hold) {
        db.exec('COMMIT');
        held = false;
      }
      return { id: anchor.id, anchorKey: anchor.anchor_key, held };
    });
    if (result.code === 'ER_LOCK_DEADLOCK' && result.errno === 1213) {
      lastDeadlock = {
        status: result.status,
        code: result.code,
        errno: result.errno,
        message: result.message,
        connectionId: result.connectionId,
        shape: JSON.stringify(command.shape),
      };
    }
    return result;
  }
  if (command.action === 'recover-anchor-after-deadlock') {
    return invoke(() => {
      if (!lastDeadlock || lastDeadlock.shape !== JSON.stringify(command.shape)) {
        throw new Error('Anchor recovery requires a matching recorded ER_LOCK_DEADLOCK victim');
      }
      const originalDeadlock = { ...lastDeadlock };
      delete originalDeadlock.shape;
      const beforeCleanup = {
        workerHeld: held,
        adapterInTransaction: db.isTransaction,
        connectionId: connectionId(),
      };

      // InnoDB has already rolled back the deadlock victim on the server, but
      // the synchronous adapter and this worker still carry their pre-error
      // transaction flags. ROLLBACK is therefore mandatory state cleanup; the
      // recovery below starts a new complete canonical transaction and never
      // retries only the failed INSERT statement.
      const rollbackResult = db.exec('ROLLBACK');
      held = false;
      const afterCleanup = {
        workerHeld: held,
        adapterInTransaction: db.isTransaction,
        rollbackAcknowledged: rollbackResult?.ok === true,
        connectionId: connectionId(),
      };
      if (beforeCleanup.connectionId !== originalDeadlock.connectionId
        || afterCleanup.connectionId !== originalDeadlock.connectionId) {
        throw new Error(`Deadlock recovery changed MySQL connection: ${JSON.stringify({ beforeCleanup, afterCleanup, originalDeadlock })}`);
      }
      if (afterCleanup.workerHeld || afterCleanup.adapterInTransaction || !afterCleanup.rollbackAcknowledged) {
        throw new Error(`Deadlock victim cleanup did not end the transaction: ${JSON.stringify(afterCleanup)}`);
      }

      let anchor;
      transaction(db, () => { anchor = ensureCreditLockAnchor(db, command.shape); });
      const afterRecovery = {
        workerHeld: held,
        adapterInTransaction: db.isTransaction,
        connectionId: connectionId(),
      };
      if (afterRecovery.workerHeld || afterRecovery.adapterInTransaction
        || afterRecovery.connectionId !== originalDeadlock.connectionId) {
        throw new Error(`Canonical deadlock recovery did not finish cleanly: ${JSON.stringify(afterRecovery)}`);
      }
      lastDeadlock = null;
      return {
        id: anchor.id,
        anchorKey: anchor.anchor_key,
        held: false,
        recovery: {
          mode: 'NEW_CANONICAL_TRANSACTION',
          harnessAttempts: 1,
          originalDeadlock,
          beforeCleanup,
          afterCleanup,
          afterRecovery,
        },
      };
    });
  }
  if (command.action === 'ensure-anchor-gated') {
    return invoke(() => {
      let anchor;
      transaction(db, () => { anchor = ensureCreditLockAnchor(db, command.shape); });
      return { id: anchor.id, anchorKey: anchor.anchor_key, held: false };
    });
  }
  if (command.action === 'commit') {
    if (held) { db.exec('COMMIT'); held = false; }
    return { committed: true };
  }
  if (command.action === 'rollback') {
    if (held) { db.exec('ROLLBACK'); held = false; }
    return { rolledBack: true };
  }
  if (command.action === 'close') {
    if (held) db.exec('ROLLBACK');
    held = false;
    db.close();
    return { closed: true };
  }
  throw new Error(`Unknown Wave 9 anchor worker action: ${command.action}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let envelope;
  try {
    envelope = JSON.parse(line);
    const result = execute(envelope.command);
    process.stdout.write(`${JSON.stringify({ id: envelope.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: envelope?.id, ok: false, error: { message: error.message, code: error.code } })}\n`);
  }
});
lines.on('close', () => {
  try { if (held) db.exec('ROLLBACK'); } catch {}
  try { db.close(); } catch {}
});
