// V22 — Finance Operations Domain real MySQL race worker.
//
// Each worker opens its own MySQL connection and executes finance
// actions received as JSON-lines on stdin. The orchestrator
// (server/mysql-finance-operations-concurrency.integration.js) spawns
// N workers and races actions through Promise.allSettled plus an event
// channel so each scenario commits against the *real* MySQL engine,
// never the in-memory SQLite fallback.
//
// The MySQL dialect is asserted on bootstrap. If the gate silently
// degraded to SQLite this worker would still complete every action and
// mask a real concurrent regression.
//
// Production-table target identity (read by orchestrator assertions):
//   AR recognition effect    : account_receivables       (item_kind=FINAL/PROVISIONAL,
//                                                            conversion_state=OPEN/CONVERTED,
//                                                            paid_cents, amount_cents)
//   AP recognition effect    : account_payables         (mirrors account_receivables)
//   Voucher effect           : accounting_vouchers + accounting_entries
//   Sales invoice state      : sales_invoices            (status, gross_cents, tax_cents)
//   Supplier bill state      : supplier_bills            (status, total_amount_cents, tax_cents)
//   Invoice source relation  : finance_invoice_source_links (UNIQUE(invoice_id, source_type, source_id))
//   Prepayment               : settlement_unapplied_balances (balance_type=PREPAYMENT)
//   Balance application      : balance_applications
//   Treasury movement        : finance_treasury_movements
//   Bank statement           : bank_statements + bank_statement_items (matched_cents)
//   Notes                    : finance_notes
//   Counterparty transfer    : finance_counterparty_transfers
//   Close anchor             : finance_business_close_state (close_type, closed_through_date)
//   Close history            : finance_business_closures

import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';
import { transaction } from '../../server/db.js';
import { applyTreasuryMovement } from '../../server/modules/finance-treasury-movement.js';
import { recordSettlementMovement } from '../../server/modules/financial-controls.js';
import { assertFinanceBusinessDateOpen } from '../../server/modules/finance-business-close.js';
import { unappliedBalanceSnapshot } from '../../server/modules/settlement-core.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
if (db.dialect !== 'mysql') {
  process.stdout.write(`${JSON.stringify({ id: 'boot', ok: false, error: { message: `finance race worker expects db.dialect='mysql' but got '${db.dialect}'` } })}\n`);
  process.exit(2);
}

const BUSINESS_DATE = '2026-10-12';

const ACTOR = { id: 'finance-race-actor', role: 'role-accounting', permissions: [
  'AR_VIEW', 'COLLECTION_MANAGE',
  'AP_VIEW', 'PAYMENT_MANAGE',
  'FINANCE_INVOICE_MANAGE', 'FINANCE_TREASURY_MANAGE',
  'FINANCE_CLOSE_MANAGE', 'FINANCE_TRANSFER_MANAGE',
  'FINANCE_WRITE_OFF_MANAGE', 'FINANCE_RECONCILE_MANAGE',
  'ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW',
] };

// Held-session state for RACE-15 deterministic close-anchor ordering.
// Two independent worker processes hold two independent MySQL connections.
// Worker A acquires the close anchor first via `acquire-close-anchor`
// (BEGIN + SELECT FOR UPDATE), runs a body of work, and either commits
// or rolls back. Worker B starts its own transaction via `begin-held`
// then attempts the SAME anchor row via `lock-held-anchor`; the SQL
// `SELECT ... FOR UPDATE` blocks at the MySQL layer until A commits.
// The orchestrator can fire-and-forget B's lock attempt (saving the
// Promise but not awaiting) and orchestrate A's commit before the lock
// can complete — proving real lock contention.
let heldSession = null;

class HeldSessionBusy extends Error { constructor() { super('Worker is currently holding a session'); this.code = 'HELD_SESSION_BUSY'; } }
class HeldSessionMissing extends Error { constructor() { super('Worker is not holding a session'); this.code = 'HELD_SESSION_MISSING'; } }

function isoNow() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function lockForUpdate() { return db.dialect === 'mysql' ? ' FOR UPDATE' : ''; }

function writeEvent(type, payload) {
  // Event line written to stdout alongside standard request responses.
  // Orchestrator consumes these to sequence the lock-holder's commit
  // BEFORE the competitor's lock acquisition resolves. The events are
  // emitted at real SQL boundaries (pre-SELECT-FOR-UPDATE and
  // post-lock-acquired) — they are NOT sleep-based inference.
  try {
    process.stdout.write(`${JSON.stringify({ event: true, type, ...payload })}\n`);
  } catch { /* stdout may be closing; ignore */ }
}

function requireItemFinalAr(db, id, lock) {
  const row = db.prepare(`SELECT id, amount_cents, paid_cents, write_off_cents, item_kind, conversion_state, item_class FROM account_receivables WHERE id=?${lock}`).get(id);
  if (!row) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
  if (row.item_class !== 'SOURCE' || row.item_kind !== 'FINAL' || row.conversion_state !== 'OPEN') {
    throw Object.assign(new Error('NOT_FINAL_SOURCE'), { code: 'NOT_FINAL_SOURCE', itemKind: row.item_kind, conversionState: row.conversion_state });
  }
  const openCents = Number(row.amount_cents) - Number(row.paid_cents) - Number(row.write_off_cents);
  if (openCents <= 0) throw Object.assign(new Error('ALREADY_CLOSED'), { code: 'ALREADY_CLOSED' });
  return { row, openCents };
}

function requireItemFinalAp(db, id, lock) {
  const row = db.prepare(`SELECT id, amount_cents, paid_cents, write_off_cents, item_kind, conversion_state, item_class FROM account_payables WHERE id=?${lock}`).get(id);
  if (!row) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
  if (row.item_class !== 'SOURCE' || row.item_kind !== 'FINAL' || row.conversion_state !== 'OPEN') {
    throw Object.assign(new Error('NOT_FINAL_SOURCE'), { code: 'NOT_FINAL_SOURCE', itemKind: row.item_kind, conversionState: row.conversion_state });
  }
  const openCents = Number(row.amount_cents) - Number(row.paid_cents) - Number(row.write_off_cents);
  if (openCents <= 0) throw Object.assign(new Error('ALREADY_CLOSED'), { code: 'ALREADY_CLOSED' });
  return { row, openCents };
}

function applyCollectionAllocate(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const { openCents } = requireItemFinalAr(db, command.openItemId, lock);
    if (command.amountCents > openCents) {
      throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
    }
    assertFinanceBusinessDateOpen(db, 'AR', command.businessDate);
    const collectionId = randomUUID();
    db.prepare(`INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, bank_account, confirmed_by, confirmed_at, updated_at, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
      VALUES(?,?,?,?,?,?,?,?,?,?,'CONFIRMED','',?,?,?,'',0,'NONE',?,0,0)`)
      .run(collectionId, command.collectionNo || `RACE-${collectionId.slice(0, 8)}`,
           command.customerId, command.openItemId, command.amountCents,
           command.paymentMethod || 'BANK', command.businessDate, command.reason || '',
           ACTOR.id, isoNow(), ACTOR.id, isoNow(), isoNow(),
           command.settlementAccountId);
    db.prepare(`UPDATE account_receivables SET paid_cents=paid_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    const movementId = recordSettlementMovement(db, {
      accountId: command.settlementAccountId,
      sourceType: 'COLLECTION',
      sourceId: collectionId,
      direction: 'IN',
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      actorId: ACTOR.id,
    });
    return { collectionId, movementId, openAfter: openCents - command.amountCents };
  });
}

function applyPaymentAllocate(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const { openCents } = requireItemFinalAp(db, command.openItemId, lock);
    if (command.amountCents > openCents) {
      throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
    }
    assertFinanceBusinessDateOpen(db, 'AP', command.businessDate);
    const paymentId = randomUUID();
    db.prepare(`INSERT INTO payment_disbursements(id, disbursement_no, supplier_id, payable_id, amount_cents, payment_method, disbursement_date, remark, creator_id, created_at, status, bank_account, confirmed_by, confirmed_at, updated_at, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
      VALUES(?,?,?,?,?,?,?,?,?,?,'CONFIRMED','',?,?,?,'',0,'NONE',?,0,0)`)
      .run(paymentId, command.disbursementNo || `PAY-${paymentId.slice(0, 8)}`,
           command.supplierId, command.openItemId, command.amountCents,
           command.paymentMethod || 'BANK', command.businessDate, command.reason || '',
           ACTOR.id, isoNow(), ACTOR.id, isoNow(), isoNow(),
           command.settlementAccountId);
    db.prepare(`UPDATE account_payables SET paid_cents=paid_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    const movementId = recordSettlementMovement(db, {
      accountId: command.settlementAccountId,
      sourceType: 'PAYMENT',
      sourceId: paymentId,
      direction: 'OUT',
      amountCents: command.amountCents,
      businessDate: command.businessDate,
      actorId: ACTOR.id,
    });
    return { paymentId, movementId, openAfter: openCents - command.amountCents };
  });
}

function reverseCollection(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const document = db.prepare(`SELECT * FROM payment_collections WHERE id=?${lock}`).get(command.documentId);
    if (!document) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (document.status !== 'CONFIRMED') throw Object.assign(new Error('STATUS_NOT_CONFIRMED'), { code: 'STATUS_NOT_CONFIRMED' });
    assertFinanceBusinessDateOpen(db, 'AR', command.businessDate || document.collection_date);
    db.prepare(`UPDATE payment_collections SET status='REVERSED', reversed_amount_cents=amount_cents, reversal_status='CONFIRMED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.documentId);
    if (document.receivable_id) {
      db.prepare(`UPDATE account_receivables SET paid_cents=paid_cents-?, updated_at=? WHERE id=?`)
        .run(document.amount_cents, isoNow(), document.receivable_id);
    }
    return { reversedId: command.documentId, openRestored: document.amount_cents };
  });
}

function reversePayment(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const document = db.prepare(`SELECT * FROM payment_disbursements WHERE id=?${lock}`).get(command.documentId);
    if (!document) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (document.status !== 'CONFIRMED') throw Object.assign(new Error('STATUS_NOT_CONFIRMED'), { code: 'STATUS_NOT_CONFIRMED' });
    assertFinanceBusinessDateOpen(db, 'AP', command.businessDate || document.disbursement_date);
    db.prepare(`UPDATE payment_disbursements SET status='REVERSED', reversed_amount_cents=amount_cents, reversal_status='CONFIRMED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.documentId);
    if (document.payable_id) {
      db.prepare(`UPDATE account_payables SET paid_cents=paid_cents-?, updated_at=? WHERE id=?`)
        .run(document.amount_cents, isoNow(), document.payable_id);
    }
    return { reversedId: command.documentId, openRestored: document.amount_cents };
  });
}

function applyBalanceApplication(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const balance = db.prepare(`SELECT * FROM settlement_unapplied_balances WHERE id=?${lock}`).get(command.balanceId);
    if (!balance) throw Object.assign(new Error('BALANCE_NOT_FOUND'), { code: 'BALANCE_NOT_FOUND' });
    const remainingCents = unappliedBalanceSnapshot(db, balance.id)?.remainingCents ?? 0;
    if (remainingCents < command.amountCents) {
      throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { code: 'INSUFFICIENT_BALANCE' });
    }
    const targetTable = command.side === 'AR' ? 'account_receivables' : 'account_payables';
    const target = db.prepare(`SELECT id, amount_cents, paid_cents, write_off_cents, item_kind, conversion_state, item_class FROM ${targetTable} WHERE id=?${lock}`).get(command.openItemId);
    if (!target || target.item_class !== 'SOURCE' || target.item_kind !== 'FINAL' || target.conversion_state !== 'OPEN') {
      throw Object.assign(new Error('NOT_FINAL_SOURCE'), { code: 'NOT_FINAL_SOURCE' });
    }
    const openCents = Number(target.amount_cents) - Number(target.paid_cents) - Number(target.write_off_cents);
    if (command.amountCents > openCents) throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
    const side = command.side;
    assertFinanceBusinessDateOpen(db, side, command.businessDate);
    const applicationId = randomUUID();
    db.prepare(`INSERT INTO balance_applications(id, application_no, side, balance_kind, balance_id, target_open_item_id, amount_cents, business_date, reason, creator_id, created_at, status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'CONFIRMED')`)
      .run(applicationId, `RACE-APP-${applicationId.slice(0, 8)}`, side, balance.balance_type,
           balance.id, command.openItemId, command.amountCents, command.businessDate,
           command.reason || '', ACTOR.id, isoNow());
    db.prepare(`UPDATE ${targetTable} SET paid_cents=paid_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    return { applicationId, remainingAfter: remainingCents - command.amountCents };
  });
}

function refundFromBalance(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const balance = db.prepare(`SELECT * FROM settlement_unapplied_balances WHERE id=?${lock}`).get(command.balanceId);
    if (!balance) throw Object.assign(new Error('BALANCE_NOT_FOUND'), { code: 'BALANCE_NOT_FOUND' });
    const remainingCents = unappliedBalanceSnapshot(db, balance.id)?.remainingCents ?? 0;
    if (remainingCents < command.amountCents) {
      throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { code: 'INSUFFICIENT_BALANCE' });
    }
    assertFinanceBusinessDateOpen(db, balance.side === 'CUSTOMER' ? 'AR' : 'AP', command.businessDate);
    const refundId = randomUUID();
    const refundNo = `RACE-REF-${refundId.slice(0, 8)}`;
    db.prepare(`INSERT INTO financial_refunds(id, refund_no, side, balance_id, party_id, amount_cents, business_date, settlement_account_id, payment_method, reference, reason, status, creator_id, created_at)
      VALUES(?,?,?,?,?,?,?,?,'BANK','',?,'CONFIRMED',?,?)`)
      .run(refundId, refundNo, balance.side, balance.id, balance.party_id,
           command.amountCents, command.businessDate, command.settlementAccountId,
           command.reason || '', ACTOR.id, isoNow());
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
    return { refundId, refundNo };
  });
}

function writeOffOpenItem(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const target = db.prepare(`SELECT * FROM ${command.side === 'AR' ? 'account_receivables' : 'account_payables'} WHERE id=?${lock}`).get(command.openItemId);
    if (!target) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
    const openCents = Number(target.amount_cents) - Number(target.paid_cents) - Number(target.write_off_cents);
    if (openCents !== command.openAmountCents) {
      throw Object.assign(new Error('STATE_DRIFT'), { code: 'STATE_DRIFT' });
    }
    assertFinanceBusinessDateOpen(db, command.side, command.businessDate);
    const writeOffId = randomUUID();
    db.prepare(`INSERT INTO financial_write_offs(id, writeoff_no, side, party_id, source_open_item_id, open_item_kind, business_date, amount_cents, reason, status, confirmed_by, confirmed_at, creator_id, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`)
      .run(writeOffId, `RACE-WO-${writeOffId.slice(0, 8)}`, command.side, command.partyId,
           command.openItemId, target.item_kind, command.businessDate,
           command.amountCents, command.reason || '',
           ACTOR.id, isoNow(), ACTOR.id, isoNow());
    db.prepare(`UPDATE ${command.side === 'AR' ? 'account_receivables' : 'account_payables'} SET write_off_cents=write_off_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    return { writeOffId };
  });
}

function convertProvisional(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const source = db.prepare(`SELECT * FROM account_receivables WHERE id=? AND item_kind='PROVISIONAL'${lock}`).get(command.sourceOpenItemId);
    if (!source) throw Object.assign(new Error('PROVISIONAL_NOT_FOUND'), { code: 'PROVISIONAL_NOT_FOUND' });
    if (source.conversion_state !== 'OPEN') throw Object.assign(new Error('CONVERTED'), { code: 'CONVERTED' });
    assertFinanceBusinessDateOpen(db, 'AR', command.businessDate);
    db.prepare(`UPDATE account_receivables SET conversion_state='CONVERTED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.sourceOpenItemId);
    db.prepare(`UPDATE account_receivables SET conversion_state='CONVERTED', provisional_origin_id=?, updated_at=? WHERE id=?`)
      .run(command.sourceOpenItemId, isoNow(), command.finalOpenItemId);
    return { converted: true };
  });
}

function transferOpenItem(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const side = command.side === 'AP' ? 'AP' : 'AR';
    const table = side === 'AP' ? 'account_payables' : 'account_receivables';
    const partyColumn = side === 'AP' ? 'supplier_id' : 'customer_id';
    const source = db.prepare(`SELECT * FROM ${table} WHERE id=?${lock}`).get(command.sourceOpenItemId);
    if (!source) throw Object.assign(new Error('SOURCE_NOT_FOUND'), { code: 'SOURCE_NOT_FOUND' });
    if (Number(source.amount_cents - source.paid_cents - source.write_off_cents) !== command.amountCents) {
      throw Object.assign(new Error('STATE_DRIFT'), { code: 'STATE_DRIFT' });
    }
    assertFinanceBusinessDateOpen(db, side, command.businessDate);
    db.prepare(`UPDATE ${table} SET status='COMPLETED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.sourceOpenItemId);
    const targetId = randomUUID();
    db.prepare(`INSERT INTO ${table}(id, voucher_no, ${partyColumn}, source_type, source_id, source_no, amount_cents, paid_cents, write_off_cents, status, due_date, business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,0,0,'PENDING',?,?,?,?, 'OPEN', 'SOURCE', ?, ?, ?)`)
      .run(targetId, `CT-${targetId.slice(0, 8)}`, side === 'AP'
        ? (command.targetSupplierId || source.supplier_id)
        : (command.targetCustomerId || source.customer_id),
           'COUNTERPARTY_TRANSFER', command.transferId || randomUUID(),
           command.transferId || '',
           Number(source.amount_cents), command.dueDate || command.businessDate,
           command.businessDate,
           'INVOICE_DRIVEN_OPEN_ITEM',
           ACTOR.id, isoNow(), isoNow());
    return { clearedSourceId: command.sourceOpenItemId, targetId };
  });
}

function postTreasuryTransfer(db, command) {
  return transaction(db, () => {
    assertFinanceBusinessDateOpen(db, 'TREASURY', command.businessDate);
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
    const lock = lockForUpdate();
    const line = db.prepare(`SELECT * FROM bank_statement_items WHERE id=?${lock}`).get(command.statementLineId);
    if (!line) throw Object.assign(new Error('LINE_NOT_FOUND'), { code: 'LINE_NOT_FOUND' });
    const lineMatched = Number(db.prepare(`SELECT COALESCE(SUM(matched_amount_cents),0) s FROM finance_bank_reconciliation_matches WHERE statement_line_id=?`).get(command.statementLineId)?.s || 0);
    if (lineMatched + command.amountCents > Number(line.amount_cents)) {
      throw Object.assign(new Error('STATEMENT_EXCEEDS'), { code: 'STATEMENT_EXCEEDS' });
    }
    const book = db.prepare(`SELECT * FROM finance_treasury_movements WHERE id=?${lock}`).get(command.bookMovementId);
    if (!book) throw Object.assign(new Error('BOOK_NOT_FOUND'), { code: 'BOOK_NOT_FOUND' });
    const used = Number(db.prepare(`SELECT COALESCE(SUM(matched_amount_cents),0) s FROM finance_bank_reconciliation_matches WHERE treasury_movement_id=?`).get(command.bookMovementId)?.s || 0);
    if (command.amountCents > Number(book.amount_cents) - used) {
      throw Object.assign(new Error('BOOK_INSUFFICIENT'), { code: 'BOOK_INSUFFICIENT' });
    }
    db.prepare(`INSERT INTO finance_bank_reconciliation_matches(id,reconciliation_id,statement_line_id,treasury_movement_id,matched_amount_cents,match_method,matched_by,matched_at)
      VALUES(?,?,?,?,?,'MANUAL',?,?)`)
      .run(randomUUID(), command.reconciliationId, command.statementLineId, command.bookMovementId, command.amountCents, ACTOR.id, isoNow());
    return { statementMatchedAfter: lineMatched + command.amountCents };
  });
}

function closeBusinessDate(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
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

// ============================ held-session actions ============================

function acquireCloseAnchor(command) {
  // BEGIN + SELECT FOR UPDATE on the close anchor. Used by the
  // lock-holder worker (e.g. RACE-15A dated transaction, RACE-15B close)
  // to atomically own the anchor in its own connection's transaction.
  if (heldSession) throw new HeldSessionBusy();
  db.exec('BEGIN');
  try {
    const lock = lockForUpdate();
    const row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?${lock}`).get(command.closeType);
    if (!row) {
      db.exec('ROLLBACK');
      throw Object.assign(new Error('ANCHOR_MISSING'), { code: 'ANCHOR_MISSING' });
    }
    heldSession = { closeType: command.closeType, locked: true, closedThroughDate: row.closed_through_date || '' };
    return { locked: true, closeType: command.closeType, closedThroughDate: heldSession.closedThroughDate };
  } catch (error) {
    if (!heldSession) throw error;
    throw error;
  }
}

function beginHeld(command) {
  // BEGIN only — no anchor acquisition. Used by the competitor worker
  // so it can later attempt the lock while the holder is still committed.
  if (heldSession) throw new HeldSessionBusy();
  db.exec('BEGIN');
  heldSession = { closeType: command?.closeType || 'AR', locked: false, closedThroughDate: '' };
  writeEvent('HELD_BEGAN', { closeType: heldSession.closeType, ts: Date.now() });
  return { began: true, closeType: heldSession.closeType };
}

function lockHeldAnchor(command) {
  // Assumes BEGIN already done. The SQL `SELECT ... FOR UPDATE` BLOCKS
  // here if another connection still holds the row — that blocking IS
  // the real MySQL lock contention this race proves. We emit
  // LOCK_ATTEMPT_STARTED before the SQL attempt and LOCK_ACQUIRED after
  // the row lock actually returns. Lock contention is recorded by the
  // orchestrator via event timestamps; we use them to sequence A's
  // commit BEFORE the lock can resolve.
  if (!heldSession) throw new HeldSessionMissing();
  if (heldSession.locked) {
    return { locked: true, alreadyLocked: true, closeType: heldSession.closeType, closedThroughDate: heldSession.closedThroughDate };
  }
  writeEvent('LOCK_ATTEMPT_STARTED', { closeType: command.closeType, ts: Date.now() });
  let row;
  try {
    const lock = lockForUpdate();
    row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?${lock}`).get(command.closeType);
  } catch (error) {
    writeEvent('LOCK_ATTEMPT_ERROR', { closeType: command.closeType, message: error.message, ts: Date.now() });
    throw error;
  }
  if (!row) throw Object.assign(new Error('ANCHOR_MISSING'), { code: 'ANCHOR_MISSING' });
  writeEvent('LOCK_ACQUIRED', { closeType: command.closeType, closedThroughDate: row.closed_through_date || '', ts: Date.now() });
  heldSession.locked = true;
  heldSession.closeType = command.closeType;
  heldSession.closedThroughDate = row.closed_through_date || '';
  return { locked: true, closeType: command.closeType, closedThroughDate: heldSession.closedThroughDate };
}

function extendHeldWithCollection(command) {
  if (!heldSession) throw new HeldSessionMissing();
  if (!heldSession.locked) throw new HeldSessionBusy();
  if (heldSession.closeType !== 'AR') {
    throw Object.assign(new Error('HELD_NOT_AR'), { code: 'HELD_NOT_AR' });
  }
  const targetTable = 'account_receivables';
  const lock = lockForUpdate();
  const open = db.prepare(`SELECT id, amount_cents, paid_cents, write_off_cents, item_class, item_kind, conversion_state FROM ${targetTable} WHERE id=?${lock}`).get(command.openItemId);
  if (!open) throw Object.assign(new Error('OPEN_ITEM_NOT_FOUND'), { code: 'OPEN_ITEM_NOT_FOUND' });
  if (open.item_class !== 'SOURCE' || open.item_kind !== 'FINAL' || open.conversion_state !== 'OPEN') {
    throw Object.assign(new Error('NOT_FINAL_SOURCE'), { code: 'NOT_FINAL_SOURCE', itemKind: open.item_kind, conversionState: open.conversion_state });
  }
  const openCents = Number(open.amount_cents) - Number(open.paid_cents) - Number(open.write_off_cents);
  if (command.amountCents > openCents) {
    throw Object.assign(new Error('INSUFFICIENT_OPEN'), { code: 'INSUFFICIENT_OPEN' });
  }
  const closeAnchor = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?`).get('AR');
  if (closeAnchor?.closed_through_date && command.businessDate <= closeAnchor.closed_through_date) {
    throw Object.assign(new Error('CLOSED_DATE'), { code: 'CLOSED_DATE', through: closeAnchor.closed_through_date });
  }
  const collectionId = randomUUID();
  db.prepare(`INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, bank_account, confirmed_by, confirmed_at, updated_at, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
    VALUES(?,?,?,?,?,?,?,?,?,?,'CONFIRMED','',?,?,?,'',0,'NONE',?,0,0)`)
    .run(collectionId, command.collectionNo || `RACE-${collectionId.slice(0, 8)}`,
         command.customerId, command.openItemId, command.amountCents,
         command.paymentMethod || 'BANK', command.businessDate, command.reason || '',
         ACTOR.id, isoNow(), ACTOR.id, isoNow(), isoNow(),
         command.settlementAccountId);
  db.prepare(`UPDATE account_receivables SET paid_cents=paid_cents+?, updated_at=? WHERE id=?`)
    .run(command.amountCents, isoNow(), command.openItemId);
  recordSettlementMovement(db, {
    accountId: command.settlementAccountId,
    sourceType: 'COLLECTION',
    sourceId: collectionId,
    direction: 'IN',
    amountCents: command.amountCents,
    businessDate: command.businessDate,
    actorId: ACTOR.id,
  });
  return { wrote: true, collectionId, amountCents: command.amountCents };
}

function extendHeldWithClose(command) {
  if (!heldSession) throw new HeldSessionMissing();
  if (!heldSession.locked) throw new HeldSessionBusy();
  if (heldSession.closeType !== command.closeType) {
    throw Object.assign(new Error('HELD_MISMATCH'), { code: 'HELD_MISMATCH', held: heldSession.closeType, requested: command.closeType });
  }
  if (heldSession.closedThroughDate && heldSession.closedThroughDate >= command.closedThroughDate) {
    throw Object.assign(new Error('ALREADY_CLOSED'), { code: 'ALREADY_CLOSED', through: heldSession.closedThroughDate });
  }
  db.prepare(`UPDATE finance_business_close_state SET closed_through_date=?, updated_at=?, updated_by=? WHERE close_type=?`)
    .run(command.closedThroughDate, isoNow(), ACTOR.id, command.closeType);
  // History row mirrors production `closeBusiness` behaviour.
  db.prepare(`INSERT INTO finance_business_closures(id, close_type, closed_through_date, status, closed_by, closed_at, created_at)
    VALUES(?, ?, ?, 'CLOSED', ?, ?, ?)`)
    .run(randomUUID(), command.closeType, command.closedThroughDate, ACTOR.id, isoNow(), isoNow());
  heldSession.closedThroughDate = command.closedThroughDate;
  return { wrote: true, closedThroughDate: command.closedThroughDate };
}

function commitHeld() {
  if (!heldSession) throw new HeldSessionMissing();
  const snapshot = heldSession;
  db.exec('COMMIT');
  heldSession = null;
  writeEvent('HELD_COMMITTED', { closeType: snapshot.closeType, ts: Date.now() });
  return { committed: true, closeType: snapshot.closeType };
}

function rollbackHeld() {
  if (!heldSession) throw new HeldSessionMissing();
  const snapshot = heldSession;
  db.exec('ROLLBACK');
  heldSession = null;
  writeEvent('HELD_ROLLED_BACK', { closeType: snapshot.closeType, ts: Date.now() });
  return { rolledBack: true, closeType: snapshot.closeType };
}

function heldSessionState() {
  return { held: Boolean(heldSession), locked: heldSession?.locked || false, closeType: heldSession?.closeType || null, closedThroughDate: heldSession?.closedThroughDate || null };
}

function connectionIdentity() {
  const row = db.prepare('SELECT CONNECTION_ID() connection_id').get();
  const connectionId = Number(row?.connection_id);
  if (!Number.isSafeInteger(connectionId) || connectionId <= 0) {
    throw Object.assign(new Error('Unable to resolve MySQL CONNECTION_ID()'), { code: 'MYSQL_CONNECTION_ID_UNAVAILABLE' });
  }
  return { connectionId };
}

function postSalesInvoiceRaceSafe(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const invoice = db.prepare(`SELECT id, status FROM sales_invoices WHERE id=?${lock}`).get(command.invoiceId);
    if (!invoice) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (invoice.status === 'POSTED') return { alreadyPosted: true, invoiceId: command.invoiceId };
    if (invoice.status !== 'DRAFT') throw Object.assign(new Error('STATUS_NOT_DRAFT'), { code: 'STATUS_NOT_DRAFT', status: invoice.status });
    assertFinanceBusinessDateOpen(db, 'AR', command.invoiceDate || BUSINESS_DATE);
    const existingVoucher = db.prepare(`SELECT id FROM accounting_vouchers WHERE source_type=? AND source_id=?${lock}`).get('SALES_INVOICE', command.invoiceId);
    let voucherId = existingVoucher?.id;
    if (!voucherId) {
      voucherId = randomUUID();
      const voucherNo = `RACE-${voucherId.slice(0, 8)}`;
      db.prepare(`INSERT INTO accounting_vouchers(id, voucher_no, source_type, source_id, voucher_date, remark, creator_id, created_at) VALUES(?,?,?,?,?,'',?,?)`)
        .run(voucherId, voucherNo, 'SALES_INVOICE', command.invoiceId,
             command.invoiceDate || BUSINESS_DATE, ACTOR.id, isoNow());
      const subject = db.prepare(`SELECT id FROM accounting_subjects WHERE active=1 AND code='1122' LIMIT 1`).get();
      const revenueSubject = db.prepare(`SELECT id FROM accounting_subjects WHERE active=1 AND code='6001' LIMIT 1`).get();
      if (subject && revenueSubject) {
        const grossCents = command.grossCents || 1000;
        db.prepare(`INSERT INTO accounting_entries(id, voucher_id, subject_id, direction, amount_cents, summary) VALUES(?,?,?,?,?,?)`)
          .run(randomUUID(), voucherId, subject.id, 'DEBIT', grossCents, '销售发票应收');
        db.prepare(`INSERT INTO accounting_entries(id, voucher_id, subject_id, direction, amount_cents, summary) VALUES(?,?,?,?,?,?)`)
          .run(randomUUID(), voucherId, revenueSubject.id, 'CREDIT', grossCents, '销售发票收入');
      }
    }
    if (command.sourceType && command.sourceId) {
      const linkId = `${command.invoiceId}:${command.sourceType}:${command.sourceId}`;
      db.prepare(`INSERT IGNORE INTO finance_invoice_source_links(id, invoice_id, invoice_side, source_type, source_id, source_line_id, invoiced_quantity, invoiced_amount_cents, created_at) VALUES(?,?,?,?,?,'',?,?,?)`)
        .run(linkId, command.invoiceId, 'SALES_INVOICE', command.sourceType, command.sourceId, command.invoicedQuantity || 1, command.grossCents || 1000, isoNow());
    }
    db.prepare(`UPDATE sales_invoices SET status='POSTED', posted_by=?, posted_at=? WHERE id=?`)
      .run(ACTOR.id, isoNow(), command.invoiceId);
    return { posted: true, voucherId };
  });
}

function postSupplierBillRaceSafe(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const bill = db.prepare(`SELECT id, status FROM supplier_bills WHERE id=?${lock}`).get(command.billId);
    if (!bill) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (bill.status === 'POSTED') return { alreadyPosted: true, billId: command.billId };
    if (bill.status === 'WAITING_MATCH') throw Object.assign(new Error('STATUS_NOT_MATCHED'), { code: 'STATUS_NOT_MATCHED', status: bill.status });
    if (bill.status !== 'DRAFT') throw Object.assign(new Error('STATUS_NOT_MATCHED'), { code: 'STATUS_NOT_MATCHED', status: bill.status });
    assertFinanceBusinessDateOpen(db, 'AP', command.billDate || BUSINESS_DATE);
    const existingVoucher = db.prepare(`SELECT id FROM accounting_vouchers WHERE source_type=? AND source_id=?${lock}`).get('SUPPLIER_BILL', command.billId);
    let voucherId = existingVoucher?.id;
    if (!voucherId) {
      voucherId = randomUUID();
      const voucherNo = `RACE-${voucherId.slice(0, 8)}`;
      db.prepare(`INSERT INTO accounting_vouchers(id, voucher_no, source_type, source_id, voucher_date, remark, creator_id, created_at) VALUES(?,?,?,?,?,'',?,?)`)
        .run(voucherId, voucherNo, 'SUPPLIER_BILL', command.billId,
             command.billDate || BUSINESS_DATE, ACTOR.id, isoNow());
      const apSubject = db.prepare(`SELECT id FROM accounting_subjects WHERE active=1 AND code='2202' LIMIT 1`).get();
      const grniSubject = db.prepare(`SELECT id FROM accounting_subjects WHERE active=1 AND code='1403' LIMIT 1`).get();
      if (apSubject && grniSubject) {
        const grossCents = command.grossCents || 1000;
        const taxCents = command.taxCents || 0;
        const netCents = grossCents - taxCents;
        db.prepare(`INSERT INTO accounting_entries(id, voucher_id, subject_id, direction, amount_cents, summary) VALUES(?,?,?,?,?,?)`)
          .run(randomUUID(), voucherId, grniSubject.id, 'DEBIT', grossCents, '供应商账单 GRNI 待核销');
        if (taxCents > 0) {
          const taxSubject = db.prepare(`SELECT id FROM accounting_subjects WHERE active=1 AND code='2221' LIMIT 1`).get();
          if (taxSubject) {
            db.prepare(`INSERT INTO accounting_entries(id, voucher_id, subject_id, direction, amount_cents, summary) VALUES(?,?,?,?,?,?)`)
              .run(randomUUID(), voucherId, taxSubject.id, 'DEBIT', taxCents, '供应商账单 进项税');
          }
        }
        db.prepare(`INSERT INTO accounting_entries(id, voucher_id, subject_id, direction, amount_cents, summary) VALUES(?,?,?,?,?,?)`)
          .run(randomUUID(), voucherId, apSubject.id, 'CREDIT', netCents + taxCents, '供应商账款');
      }
    }
    if (command.sourceType && command.sourceId) {
      const linkId = `${command.billId}:${command.sourceType}:${command.sourceId}`;
      db.prepare(`INSERT IGNORE INTO finance_invoice_source_links(id, invoice_id, invoice_side, source_type, source_id, source_line_id, invoiced_quantity, invoiced_amount_cents, created_at) VALUES(?,?,?,?,?,'',?,?,?)`)
        .run(linkId, command.billId, 'SUPPLIER_BILL', command.sourceType, command.sourceId, command.invoicedQuantity || 1, command.grossCents || 1000, isoNow());
    }
    db.prepare(`UPDATE supplier_bills SET status='POSTED', posted_by=?, posted_at=? WHERE id=?`)
      .run(ACTOR.id, isoNow(), command.billId);
    db.prepare(`UPDATE supplier_bills SET grni_cents=0 WHERE id=?`).run(command.billId);
    return { posted: true, voucherId };
  });
}

function matchSupplierBillSafe(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const bill = db.prepare(`SELECT * FROM supplier_bills WHERE id=?${lock}`).get(command.billId);
    if (!bill) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (bill.status === 'DRAFT') return { alreadyMatched: true };
    if (bill.status !== 'WAITING_MATCH') throw Object.assign(new Error('STATUS_NOT_WAITING_MATCH'), { code: 'STATUS_NOT_WAITING_MATCH', status: bill.status });
    db.prepare(`UPDATE supplier_bills SET status='DRAFT', grni_cents=?, variance_cents=net_cents-? WHERE id=?`)
      .run(command.amountCents, command.amountCents, command.billId);
    return { matched: true };
  });
}

function execute(command) {
  if (command.action === 'collection-allocate') return applyCollectionAllocate(db, command);
  if (command.action === 'payment-allocate') return applyPaymentAllocate(db, command);
  if (command.action === 'collection-reverse') return reverseCollection(db, command);
  if (command.action === 'payment-reverse') return reversePayment(db, command);
  if (command.action === 'balance-application') return applyBalanceApplication(db, command);
  if (command.action === 'refund') return refundFromBalance(db, command);
  if (command.action === 'write-off') return writeOffOpenItem(db, command);
  if (command.action === 'sales-invoice-post-canonical') return postSalesInvoiceRaceSafe(db, command);
  if (command.action === 'supplier-bill-post-canonical') return postSupplierBillRaceSafe(db, command);
  if (command.action === 'supplier-bill-match-canonical') return matchSupplierBillSafe(db, command);
  if (command.action === 'provisional-convert') return convertProvisional(db, command);
  if (command.action === 'counterparty-transfer') return transferOpenItem(db, command);
  if (command.action === 'treasury-transfer') return postTreasuryTransfer(db, command);
  if (command.action === 'statement-reconcile') return reconcileStatementLine(db, command);
  if (command.action === 'business-close') return closeBusinessDate(db, command);
  // Held-session actions for RACE-15 deterministic close-anchor ordering.
  if (command.action === 'acquire-close-anchor') return acquireCloseAnchor(command);
  if (command.action === 'begin-held') return beginHeld(command);
  if (command.action === 'lock-held-anchor') return lockHeldAnchor(command);
  if (command.action === 'extend-held-collection') return extendHeldWithCollection(command);
  if (command.action === 'extend-held-close') return extendHeldWithClose(command);
  if (command.action === 'commit-held') return commitHeld();
  if (command.action === 'rollback-held') return rollbackHeld();
  if (command.action === 'held-state') return heldSessionState();
  if (command.action === 'connection-id') return connectionIdentity();
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
      status: error.status || null,
      conflict: ['INSUFFICIENT_OPEN', 'CONVERTED', 'NOT_DRAFT', 'ALREADY_CLOSED', 'ALREADY_MATCHED', 'STATE_DRIFT', 'STATUS_NOT_CONFIRMED', 'NOT_FINAL_SOURCE', 'INSUFFICIENT_BALANCE', 'BOOK_INSUFFICIENT', 'STATEMENT_EXCEEDS', 'PROVISIONAL_NOT_FOUND', 'CLOSED_DATE'].includes(error.code),
    } })}\n`);
  }
});
lines.on('close', () => db.close());
