import { createInterface } from 'node:readline';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { confirmServiceFulfillmentCommand } from '../../server/modules/service-fulfillment.js';
import { returnConsignmentLineCommand, settleConsignmentLineCommand } from '../../server/modules/consignment.js';
import { createCommercialCreditNote, postSalesInvoice, reverseCommercialCreditNote, voidPostedInvoice } from '../../server/modules/commercial-golive.js';

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
const actor = { id: 'wave8-race-actor', roleCode: 'ADMIN', isSystemAdmin: true, permissions: [] };
let gateHeld = false;
const connectionId = () => Number(db.prepare('SELECT CONNECTION_ID() id').get().id);

function invoke(work) {
  try { return { status: 200, data: work(), connectionId: connectionId() }; }
  catch (error) { return { status: error.status || 500, code: error.code || error.details?.code, message: error.message, connectionId: connectionId() }; }
}

function execute(command) {
  if (command.action === 'register') return { dialect: db.dialect, connectionId: connectionId(), processId: process.pid };
  if (command.action === 'hold-gate') { db.exec('START TRANSACTION'); db.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get(); gateHeld = true; return { held: true }; }
  if (command.action === 'release-gate') { if (gateHeld) db.exec('COMMIT'); gateHeld = false; return { released: true }; }
  if (command.action === 'confirm-service') return invoke(() => confirmServiceFulfillmentCommand(db, command.id, command.version, actor, command.key));
  if (command.action === 'settle-consignment') return invoke(() => settleConsignmentLineCommand(db, command.id, command.body, actor, command.key));
  if (command.action === 'return-consignment') return invoke(() => returnConsignmentLineCommand(db, command.id, command.body, actor, command.key));
  if (command.action === 'post-invoice') return invoke(() => postSalesInvoice(db, command.id, actor.id));
  if (command.action === 'credit-invoice') return invoke(() => createCommercialCreditNote(db, { ...command.body, actorId: actor.id }));
  if (command.action === 'reverse-credit') return invoke(() => reverseCommercialCreditNote(db, {
    id: command.id, reversalDate: command.body.reversalDate, reason: command.body.reason,
    actorId: actor.id, idempotencyKey: command.key,
  }));
  if (command.action === 'void-invoice') return invoke(() => voidPostedInvoice(db, 'AR', command.id, actor.id, command.reason || 'Wave 8 race'));
  if (command.action === 'close') { if (gateHeld) db.exec('ROLLBACK'); gateHeld = false; db.close(); return { closed: true }; }
  throw new Error(`Unknown Wave 8 worker action: ${command.action}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let envelope;
  try { envelope = JSON.parse(line); const result = execute(envelope.command); process.stdout.write(`${JSON.stringify({ id: envelope.id, ok: true, result })}\n`); }
  catch (error) { process.stdout.write(`${JSON.stringify({ id: envelope?.id, ok: false, error: { message: error.message, code: error.code } })}\n`); }
});
lines.on('close', () => { try { if (gateHeld) db.exec('ROLLBACK'); db.close(); } catch {} });
