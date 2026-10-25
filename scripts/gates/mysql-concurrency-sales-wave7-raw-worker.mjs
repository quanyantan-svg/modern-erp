// Gate A A-RAW worker. This process deliberately does not call production
// transaction(): it proves only the approved L1/L6/L7/L8 InnoDB row-lock graph.

import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';

const { backend: _backend, ...config } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(config);
let inTransaction = false;

const lockSql = Object.freeze({
  parent: 'SELECT id FROM settlement_unapplied_balances WHERE id=? FOR UPDATE',
  result: 'SELECT id FROM sales_prepayment_gate_results WHERE id=? FOR UPDATE',
  requirement: 'SELECT id FROM sales_prepayment_requirements WHERE id=? FOR UPDATE',
  order: 'SELECT id FROM sales_orders WHERE id=? FOR UPDATE',
});

function execute(command) {
  if (command.action === 'register') {
    return {
      connectionId: Number(db.prepare('SELECT CONNECTION_ID() id').get().id),
      version: String(db.prepare('SELECT VERSION() version').get().version),
      isolation: String(db.prepare('SELECT @@transaction_isolation isolation').get().isolation),
    };
  }
  if (command.action === 'begin') {
    if (inTransaction) throw Object.assign(new Error('raw transaction already active'), { code: 'RAW_TRANSACTION_ACTIVE' });
    db.exec('START TRANSACTION'); inTransaction = true; return { begun: true };
  }
  if (command.action === 'lock') {
    if (!inTransaction) throw Object.assign(new Error('raw transaction is not active'), { code: 'RAW_TRANSACTION_MISSING' });
    const sql = lockSql[command.target];
    if (!sql) throw Object.assign(new Error(`unsupported raw lock target: ${command.target}`), { code: 'RAW_LOCK_TARGET_INVALID' });
    const row = db.prepare(sql).get(command.id);
    if (!row) throw Object.assign(new Error(`raw lock row missing: ${command.target}/${command.id}`), { code: 'RAW_LOCK_ROW_MISSING' });
    return { target: command.target, id: row.id };
  }
  if (command.action === 'commit' || command.action === 'rollback') {
    if (inTransaction) db.exec(command.action === 'commit' ? 'COMMIT' : 'ROLLBACK');
    inTransaction = false; return { completed: command.action };
  }
  if (command.action === 'close') {
    if (inTransaction) { try { db.exec('ROLLBACK'); } catch {} }
    inTransaction = false; db.close(); return { closed: true };
  }
  throw Object.assign(new Error(`unknown raw worker action: ${command.action}`), { code: 'RAW_ACTION_INVALID' });
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let envelope;
  try {
    envelope = JSON.parse(line);
    const result = execute(envelope.command);
    process.stdout.write(`${JSON.stringify({ id: envelope.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: envelope?.id, ok: false, error: {
      message: error?.message, code: error?.code, errno: error?.errno, sqlState: error?.sqlState,
    } })}\n`);
  }
});
lines.on('close', () => { try { if (inTransaction) db.exec('ROLLBACK'); db.close(); } catch {} });
