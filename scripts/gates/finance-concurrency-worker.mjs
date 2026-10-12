// V22 — Finance Operations Domain real MySQL race worker.
//
// Each worker opens its own MySQL connection and executes one finance
// action per stdin request. The orchestrator
// (server/mysql-finance-operations-concurrency.integration.js) spawns
// N workers and races actions through Promise.allSettled so each
// scenario commits against the *real* MySQL engine, never the
// in-memory SQLite fallback.
//
// The MySQL dialect is asserted on bootstrap. If the gate silently
// degraded to SQLite this worker would still complete every action and
// mask a real concurrent regression — exactly what the orchestrator's
// positive `db.dialect === 'mysql'` assertion is there to detect.

import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { transaction, id } from '../../server/db.js';
import { applyTreasuryMovement } from '../../server/modules/finance-treasury-movement.js';
import { recordSettlementMovement } from '../../server/modules/financial-controls.js';
import { convertProvisionalToFinancial } from '../../server/modules/finance-provisional-conversion.js';
import { postCounterpartyTransfer } from '../../server/modules/finance-counterparty-transfer.js';
import { closeBusiness, reopenBusiness } from '../../server/modules/finance-business-close.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
if (db.dialect !== 'mysql') {
  process.stdout.write(`${JSON.stringify({ id: 'boot', ok: false, error: { message: `finance race worker expects db.dialect='mysql' but got '${db.dialect}'` } })}\n`);
  process.exit(2);
}

const ACTOR = { id: 'finance-race-actor', role: 'role-accounting', permissions: ['AR_VIEW', 'COLLECTION_MANAGE', 'AP_VIEW', 'PAYMENT_MANAGE', 'FINANCE_INVOICE_MANAGE', 'FINANCE_TREASURY_MANAGE', 'FINANCE_CLOSE_MANAGE', 'FINANCE_TRANSFER_MANAGE', 'FINANCE_WRITE_OFF_MANAGE', 'FINANCE_RECONCILE_MANAGE', 'ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW'] };

function isoNow() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function applyCollectionAllocate(db, command) {
  // Race-action: insert a CONFIRMED collection allocation against an
  // existing FINAL AR open item. Uses FOR UPDATE on the open item row
  // to serialize concurrent allocations, exactly like
  // recordSettlementMovement does in production.
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT id, open_amount_cents, item_kind, conversion_state FROM finance_open_items WHERE id=?${lock}`).get(command.openItemId);
    if (!row) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
    if (row.item_kind !== 'FINAL') throw Object.assign(new Error('NOT_FINAL'), { code: 'NOT_FINAL' });
    if (row.conversion_state !== 'OPEN') throw Object.assign(new Error('CONVERTED'), { code: 'CONVERTED' });
    if (Number(row.open_amount_cents) < command.amountCents) throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
    const collectionId = randomUUID();
    db.prepare(`INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
      VALUES(?,?,?,?,?,?,?,?,?,?,'CONFIRMED',?,0,'NONE',?,0,0)`)
      .run(collectionId, command.collectionNo || `RACE-${collectionId.slice(0, 8)}`, command.customerId, command.openItemId,
           command.amountCents, command.paymentMethod || 'BANK', command.businessDate, command.reason || '',
           ACTOR.id, isoNow(), '', command.settlementAccountId);
    db.prepare(`INSERT INTO payment_collection_items(id, collection_id, receivable_id, amount_cents, open_before_cents, open_after_cents)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), collectionId, command.openItemId, command.amountCents,
        Number(row.open_amount_cents), Number(row.open_amount_cents) - command.amountCents);
    const movementId = recordSettlementMovement(db, {
      accountId: command.settlementAccountId,
      sourceType: 'COLLECTION',
      sourceId: collectionId,
      direction: 'IN',
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      actorId: ACTOR.id,
    });
    db.prepare(`UPDATE finance_open_items SET open_amount_cents=open_amount_cents-?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    return { collectionId, movementId, openAfter: Number(row.open_amount_cents) - command.amountCents };
  });
}

function applyPaymentAllocate(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT id, open_amount_cents, item_kind, conversion_state FROM finance_open_items WHERE id=?${lock}`).get(command.openItemId);
    if (!row) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
    if (row.item_kind !== 'FINAL') throw Object.assign(new Error('NOT_FINAL'), { code: 'NOT_FINAL' });
    if (row.conversion_state !== 'OPEN') throw Object.assign(new Error('CONVERTED'), { code: 'CONVERTED' });
    if (Number(row.open_amount_cents) < command.amountCents) throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
    const paymentId = randomUUID();
    db.prepare(`INSERT INTO payment_disbursements(id, disbursement_no, supplier_id, payable_id, amount_cents, payment_method, disbursement_date, remark, creator_id, created_at, status, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
      VALUES(?,?,?,?,?,?,?,?,?,?,'CONFIRMED',?,0,'NONE',?,0,0)`)
      .run(paymentId, command.disbursementNo || `PAY-${paymentId.slice(0, 8)}`, command.supplierId, command.openItemId,
           command.amountCents, command.paymentMethod || 'BANK', command.businessDate, command.reason || '',
           ACTOR.id, isoNow(), '', command.settlementAccountId);
    db.prepare(`INSERT INTO payment_disbursement_items(id, disbursement_id, payable_id, amount_cents, open_before_cents, open_after_cents)
      VALUES(?,?,?,?,?,?)`).run(randomUUID(), paymentId, command.openItemId, command.amountCents,
        Number(row.open_amount_cents), Number(row.open_amount_cents) - command.amountCents);
    const movementId = recordSettlementMovement(db, {
      accountId: command.settlementAccountId,
      sourceType: 'PAYMENT',
      sourceId: paymentId,
      direction: 'OUT',
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      actorId: ACTOR.id,
    });
    db.prepare(`UPDATE finance_open_items SET open_amount_cents=open_amount_cents-?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    return { paymentId, movementId, openAfter: Number(row.open_amount_cents) - command.amountCents };
  });
}

function reverseSettlement(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const cfg = command.kind === 'AR' ? { table: 'payment_collections', srcTable: 'finance_open_items', fk: 'collection_id', openItemId: 'receivable_id', reverseState: 'REVERSED', verifyStatus: 'CONFIRMED' } : { table: 'payment_disbursements', srcTable: 'finance_open_items', fk: 'disbursement_id', openItemId: 'payable_id', reverseState: 'REVERSED', verifyStatus: 'CONFIRMED' };
    const document = db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?${lock}`).get(command.documentId);
    if (!document) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (document.status !== 'CONFIRMED') throw Object.assign(new Error('STATUS_NOT_CONFIRMED', { status: document.status }), { code: 'STATUS_NOT_CONFIRMED' });
    db.prepare(`UPDATE ${cfg.table} SET status='REVERSED', reversed_amount_cents=amount_cents, reversal_status='CONFIRMED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.documentId);
    const items = db.prepare(`SELECT * FROM ${command.kind === 'AR' ? 'payment_collection_items' : 'payment_disbursement_items'} WHERE ${cfg.fk}=?${lock}`).all(command.documentId);
    let openRestored = 0;
    for (const item of items) {
      db.prepare(`UPDATE finance_open_items SET open_amount_cents=open_amount_cents+?, updated_at=? WHERE id=?`)
        .run(item.amount_cents, isoNow(), item[cfg.openItemId]);
      openRestored += Number(item.amount_cents);
    }
    return { reversedId: command.documentId, openRestored };
  });
}

function applyBalanceApplication(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const balance = db.prepare(`SELECT * FROM settlement_unapplied_balances WHERE id=?${lock}`).get(command.balanceId);
    if (!balance) throw Object.assign(new Error('BALANCE_NOT_FOUND'), { code: 'BALANCE_NOT_FOUND' });
    if (Number(balance.remaining_cents) < command.amountCents) throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { code: 'INSUFFICIENT_BALANCE' });
    const openItem = db.prepare(`SELECT * FROM finance_open_items WHERE id=?${lock}`).get(command.openItemId);
    if (!openItem) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
    if (Number(openItem.open_amount_cents) < command.amountCents) throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
    const applicationId = randomUUID();
    db.prepare(`INSERT INTO balance_applications(id, application_no, side, balance_kind, balance_id, target_open_item_id, amount_cents, business_date, reason, creator_id, created_at, status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'CONFIRMED')`)
      .run(applicationId, `RACE-APP-${applicationId.slice(0, 8)}`, command.side, balance.balance_type,
           balance.id, command.openItemId, command.amountCents, command.businessDate, command.reason || '',
           ACTOR.id, isoNow());
    db.prepare(`UPDATE settlement_unapplied_balances SET remaining_cents=remaining_cents-?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), balance.id);
    db.prepare(`UPDATE finance_open_items SET open_amount_cents=open_amount_cents-?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    return { applicationId, remainingAfter: Number(balance.remaining_cents) - command.amountCents };
  });
}

function refundFromBalance(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const balance = db.prepare(`SELECT * FROM settlement_unapplied_balances WHERE id=?${lock}`).get(command.balanceId);
    if (!balance) throw Object.assign(new Error('BALANCE_NOT_FOUND'), { code: 'BALANCE_NOT_FOUND' });
    if (Number(balance.remaining_cents) < command.amountCents) throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { code: 'INSUFFICIENT_BALANCE' });
    const refundId = randomUUID();
    const refundNo = `RACE-REF-${refundId.slice(0, 8)}`;
    db.prepare(`INSERT INTO financial_refunds(id, refund_no, side, party_id, settlement_account_id, amount_cents, business_date, reason, status, creator_id, created_at)
      VALUES(?,?,?,?,?,?,?,?,'CONFIRMED',?,?)`)
      .run(refundId, refundNo, balance.side, balance.party_id, command.settlementAccountId,
           command.amountCents, command.businessDate, command.reason || '', ACTOR.id, isoNow());
    const direction = balance.side === 'CUSTOMER' ? 'OUT' : 'IN';
    recordSettlementMovement(db, {
      accountId: command.settlementAccountId,
      sourceType: 'FINANCIAL_REFUND',
      sourceId: refundId,
      direction,
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      actorId: ACTOR.id,
    });
    db.prepare(`UPDATE settlement_unapplied_balances SET remaining_cents=remaining_cents-?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), balance.id);
    return { refundId, refundNo };
  });
}

function writeOffOpenItem(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const open = db.prepare(`SELECT * FROM finance_open_items WHERE id=?${lock}`).get(command.openItemId);
    if (!open) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
    if (Number(open.open_amount_cents) !== command.openAmountCents) throw Object.assign(new Error('STATE_DRIFT'), { code: 'STATE_DRIFT' });
    const writeOffId = randomUUID();
    db.prepare(`INSERT INTO financial_write_offs(id, writeoff_no, side, party_id, source_open_item_id, open_item_kind, business_date, amount_cents, reason, status, confirmed_by, confirmed_at, creator_id, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`)
      .run(writeOffId, `RACE-WO-${writeOffId.slice(0, 8)}`, command.side, command.partyId, command.openItemId,
           open.item_kind, command.businessDate, command.amountCents,
           command.reason || '', ACTOR.id, isoNow(), ACTOR.id, isoNow());
    db.prepare(`UPDATE finance_open_items SET open_amount_cents=0, updated_at=? WHERE id=?`)
      .run(isoNow(), command.openItemId);
    return { writeOffId };
  });
}

function postInvoice(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT id, status FROM ${command.table} WHERE id=?${lock}`).get(command.invoiceId);
    if (!row) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (row.status !== 'DRAFT') throw Object.assign(new Error('STATUS_NOT_DRAFT'), { code: 'STATUS_NOT_DRAFT', status: row.status });
    db.prepare(`UPDATE ${command.table} SET status='POSTED', posted_at=?, updated_at=? WHERE id=?`)
      .run(isoNow(), isoNow(), command.invoiceId);
    return { posted: true };
  });
}

function matchSupplierBill(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT id, status, matched_amount_cents FROM supplier_bills WHERE id=?${lock}`).get(command.billId);
    if (!row) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (row.status === 'MATCHED') return { matched: 'ALREADY' };
    if (row.status !== 'WAITING_MATCH') throw Object.assign(new Error('STATUS_NOT_WAITING_MATCH'), { code: 'STATUS_NOT_WAITING_MATCH', status: row.status });
    db.prepare(`UPDATE supplier_bills SET status='MATCHED', matched_amount_cents=?, matched_at=?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), isoNow(), command.billId);
    return { matched: true };
  });
}

function convertProvisional(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const source = db.prepare(`SELECT * FROM finance_open_items WHERE id=? AND item_kind='PROVISIONAL'${lock}`).get(command.sourceOpenItemId);
    if (!source) throw Object.assign(new Error('PROVISIONAL_NOT_FOUND'), { code: 'PROVISIONAL_NOT_FOUND' });
    if (source.conversion_state !== 'OPEN') throw Object.assign(new Error('CONVERTED'), { code: 'CONVERTED' });
    const final = db.prepare(`SELECT * FROM finance_open_items WHERE id=? AND item_kind='FINAL'${lock}`).get(command.finalOpenItemId);
    if (!final) throw Object.assign(new Error('FINAL_NOT_FOUND'), { code: 'FINAL_NOT_FOUND' });
    if (final.conversion_state !== 'OPEN') throw Object.assign(new Error('FINAL_NOT_OPEN'), { code: 'FINAL_NOT_OPEN' });
    // Direct SQL realization of the conversion. The canonical helper
    // postCounterpartyTransfer() handles the same flow in production; we
    // mirror its end-state here so the race scenario does not depend on
    // HTTP request bodies.
    db.prepare(`UPDATE finance_open_items SET conversion_state='CONVERTED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.sourceOpenItemId);
    db.prepare(`UPDATE finance_open_items SET conversion_state='CONVERTED', matched_provisional_id=?, updated_at=? WHERE id=?`)
      .run(command.sourceOpenItemId, isoNow(), command.finalOpenItemId);
    return { converted: true };
  });
}

function transferOpenItem(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const source = db.prepare(`SELECT * FROM finance_open_items WHERE id=?${lock}`).get(command.sourceOpenItemId);
    if (!source) throw Object.assign(new Error('SOURCE_NOT_FOUND'), { code: 'SOURCE_NOT_FOUND' });
    if (Number(source.open_amount_cents) !== command.amountCents) throw Object.assign(new Error('STATE_DRIFT'), { code: 'STATE_DRIFT' });
    db.prepare(`UPDATE finance_open_items SET open_amount_cents=0, updated_at=? WHERE id=?`)
      .run(isoNow(), command.sourceOpenItemId);
    const targetId = randomUUID();
    db.prepare(`INSERT INTO finance_open_items(id, side, source_type, source_id, customer_id, supplier_id, item_kind, conversion_state, amount_cents, open_amount_cents, business_date, due_date, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(targetId, command.side, 'COUNTERPARTY_TRANSFER', command.transferId || randomUUID(),
           command.targetCustomerId || null, command.targetSupplierId || null,
           'FINAL', 'OPEN',
           Number(source.amount_cents || source.open_amount_cents),
           Number(source.amount_cents || source.open_amount_cents),
           command.businessDate, command.dueDate || command.businessDate, isoNow(), isoNow());
    return { clearedSourceId: command.sourceOpenItemId, targetId };
  });
}

function postTreasuryTransfer(db, command) {
  return transaction(db, () => {
    const fromMovementId = applyTreasuryMovement(db, {
      settlementAccountId: command.fromAccountId,
      direction: 'OUT',
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      sourceType: 'TREASURY_TRANSFER',
      sourceId: command.transferId,
      movementGroupId: command.movementGroupId || command.transferId,
      idempotencyKey: command.idempotencyKey || `TREASURY_TRANSFER:${command.transferId}:${nowMs()}`,
      createdBy: ACTOR.id,
    });
    const toMovementId = applyTreasuryMovement(db, {
      settlementAccountId: command.toAccountId,
      direction: 'IN',
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      sourceType: 'TREASURY_TRANSFER',
      sourceId: command.transferId,
      movementGroupId: command.movementGroupId || command.transferId,
      idempotencyKey: command.idempotencyKey ? `${command.idempotencyKey}:TO` : `TREASURY_TRANSFER:${command.transferId}:TO:${nowMs()}`,
      createdBy: ACTOR.id,
    });
    return { fromMovementId, toMovementId };
  });
}

function reconcileStatementLine(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const line = db.prepare(`SELECT * FROM bank_statement_items WHERE id=?${lock}`).get(command.statementLineId);
    if (!line) throw Object.assign(new Error('LINE_NOT_FOUND'), { code: 'LINE_NOT_FOUND' });
    if (line.matched_cents >= line.amount_cents) throw Object.assign(new Error('ALREADY_MATCHED'), { code: 'ALREADY_MATCHED' });
    const bookMovement = db.prepare(`SELECT * FROM finance_treasury_movements WHERE id=?${lock}`).get(command.bookMovementId);
    if (!bookMovement) throw Object.assign(new Error('BOOK_NOT_FOUND'), { code: 'BOOK_NOT_FOUND' });
    if (Number(bookMovement.amount_cents) < (Number(line.matched_cents) + command.amountCents)) {
      throw Object.assign(new Error('BOOK_INSUFFICIENT'), { code: 'BOOK_INSUFFICIENT' });
    }
    db.prepare(`UPDATE bank_statement_items SET matched_cents=matched_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.statementLineId);
    return { statementMatchedAfter: Number(line.matched_cents) + command.amountCents };
  });
}

function closeBusinessDate(db, command) {
  return transaction(db, () => {
    const lock = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?${lock}`).get(command.closeType);
    if (!row) throw Object.assign(new Error('ANCHOR_MISSING'), { code: 'ANCHOR_MISSING' });
    if (row.closed_through_date && row.closed_through_date >= command.closedThroughDate) {
      throw Object.assign(new Error('ALREADY_CLOSED'), { code: 'ALREADY_CLOSED', through: row.closed_through_date });
    }
    db.prepare(`UPDATE finance_business_close_state SET closed_through_date=?, updated_at=?, updated_by=? WHERE close_type=?`)
      .run(command.closedThroughDate, isoNow(), ACTOR.id, command.closeType);
    return { closedThroughDate: command.closedThroughDate };
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function execute(command) {
  if (command.action === 'collection-allocate') return applyCollectionAllocate(db, command);
  if (command.action === 'payment-allocate') return applyPaymentAllocate(db, command);
  if (command.action === 'settlement-reverse') return reverseSettlement(db, command);
  if (command.action === 'balance-application') return applyBalanceApplication(db, command);
  if (command.action === 'refund') return refundFromBalance(db, command);
  if (command.action === 'write-off') return writeOffOpenItem(db, command);
  if (command.action === 'invoice-post') return postInvoice(db, command);
  if (command.action === 'supplier-bill-match') return matchSupplierBill(db, command);
  if (command.action === 'provisional-convert') return convertProvisional(db, command);
  if (command.action === 'counterparty-transfer') return transferOpenItem(db, command);
  if (command.action === 'treasury-transfer') return postTreasuryTransfer(db, command);
  if (command.action === 'statement-reconcile') return reconcileStatementLine(db, command);
  if (command.action === 'business-close') return closeBusinessDate(db, command);
  if (command.action === 'hold') { sleep(command.ms); return { heldMs: command.ms }; }
  throw new Error(`Unknown action: ${command.action}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
    const result = execute(request.command);
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id: request?.id, ok: false, error: {
      message: error.message, code: error.code || null,
      status: error.status,
      conflict: error.code === 'INSUFFICIENT_OPEN' || error.code === 'CONVERTED' || error.code === 'NOT_DRAFT' || error.code === 'ALREADY_CLOSED' || error.code === 'ALREADY_MATCHED' || error.code === 'STATE_DRIFT' || error.code === 'STATUS_NOT_DRAFT',
    } })}\n`);
  }
});
lines.on('close', () => db.close());
