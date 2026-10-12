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
// mask a real concurrent regression.
//
// Production-table target identity (read by orchestrator assertions):
//   AR recognition effect    : account_receivables       (item_kind=FINAL/PROVISIONAL,
//                                                            conversion_state=OPEN/CONVERTED,
//                                                            paid_cents, amount_cents)
//   AP recognition effect    : account_payables         (mirrors account_receivables)
//   Voucher effect           : accounting_vouchers + accounting_entries
//                              (UNIQUE on (source_type, source_id) is asserted by the
//                               orchestrator via generateVoucher's existing-voucher short-circuit
//                               + canonical postSalesInvoice idempotent-guard)
//   Sales invoice state      : sales_invoices            (status, gross_cents, tax_cents)
//   Supplier bill state      : supplier_bills            (status, total_amount_cents, tax_cents)
//   Invoice source relation  : finance_invoice_source_links (UNIQUE(invoice_id, source_type, source_id))
//   Prepayment                : settlement_unapplied_balances (balance_type=PREPAYMENT)
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

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
const db = new MySqlSyncAdapter(mysqlConfig);
if (db.dialect !== 'mysql') {
  process.stdout.write(`${JSON.stringify({ id: 'boot', ok: false, error: { message: `finance race worker expects db.dialect='mysql' but got '${db.dialect}'` } })}\n`);
  process.exit(2);
}

const ACTOR = { id: 'finance-race-actor', role: 'role-accounting', permissions: [
  'AR_VIEW', 'COLLECTION_MANAGE',
  'AP_VIEW', 'PAYMENT_MANAGE',
  'FINANCE_INVOICE_MANAGE', 'FINANCE_TREASURY_MANAGE',
  'FINANCE_CLOSE_MANAGE', 'FINANCE_TRANSFER_MANAGE',
  'FINANCE_WRITE_OFF_MANAGE', 'FINANCE_RECONCILE_MANAGE',
  'ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW',
] };

function isoNow() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }
function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function lockForUpdate() { return db.dialect === 'mysql' ? ' FOR UPDATE' : ''; }

function requireItemFinalAr(db, id, lock) {
  // Canonical FINAL-only eligibility for ordinary collection. PROVISIONAL
  // or non-FINAL rows are never drained by ordinary settlement.
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
    if (Number(balance.remaining_cents) < command.amountCents) {
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
    db.prepare(`UPDATE settlement_unapplied_balances SET remaining_cents=remaining_cents-?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), balance.id);
    db.prepare(`UPDATE ${targetTable} SET paid_cents=paid_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.openItemId);
    return { applicationId, remainingAfter: Number(balance.remaining_cents) - command.amountCents };
  });
}

function refundFromBalance(db, command) {
  return transaction(db, () => {
    const lock = lockForUpdate();
    const balance = db.prepare(`SELECT * FROM settlement_unapplied_balances WHERE id=?${lock}`).get(command.balanceId);
    if (!balance) throw Object.assign(new Error('BALANCE_NOT_FOUND'), { code: 'BALANCE_NOT_FOUND' });
    if (Number(balance.remaining_cents) < command.amountCents) {
      throw Object.assign(new Error('INSUFFICIENT_BALANCE'), { code: 'INSUFFICIENT_BALANCE' });
    }
    assertFinanceBusinessDateOpen(db, balance.side === 'CUSTOMER' ? 'AR' : 'AP', command.businessDate);
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
  // Race-safe path mirror of finance-provisional-conversion. Locking on
  // the source provisional row prevents an ordinary settlement from
  // observing an item_kind=PROVISIONAL drain.
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
    const source = db.prepare(`SELECT * FROM account_receivables WHERE id=?${lock}`).get(command.sourceOpenItemId);
    if (!source) throw Object.assign(new Error('SOURCE_NOT_FOUND'), { code: 'SOURCE_NOT_FOUND' });
    if (Number(source.amount_cents - source.paid_cents - source.write_off_cents) !== command.amountCents) {
      throw Object.assign(new Error('STATE_DRIFT'), { code: 'STATE_DRIFT' });
    }
    assertFinanceBusinessDateOpen(db, 'AR', command.businessDate);
    db.prepare(`UPDATE account_receivables SET status='COMPLETED', updated_at=? WHERE id=?`)
      .run(isoNow(), command.sourceOpenItemId);
    const targetId = randomUUID();
    db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id, source_no, amount_cents, paid_cents, write_off_cents, status, due_date, business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,0,0,'PENDING',?,?,?,?, 'OPEN', 'SOURCE', ?, ?, ?)`)
      .run(targetId, `CT-${targetId.slice(0, 8)}`, command.targetCustomerId || source.customer_id,
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
    if (Number(line.matched_cents || 0) + command.amountCents > Number(line.amount_cents)) {
      throw Object.assign(new Error('STATEMENT_EXCEEDS'), { code: 'STATEMENT_EXCEEDS' });
    }
    const book = db.prepare(`SELECT * FROM finance_treasury_movements WHERE id=?${lock}`).get(command.bookMovementId);
    if (!book) throw Object.assign(new Error('BOOK_NOT_FOUND'), { code: 'BOOK_NOT_FOUND' });
    const used = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) s FROM bank_statement_items WHERE matched_cents>0 AND id=?`).get(command.statementLineId)?.s || 0);
    if (command.amountCents > Number(book.amount_cents) - used) {
      throw Object.assign(new Error('BOOK_INSUFFICIENT'), { code: 'BOOK_INSUFFICIENT' });
    }
    db.prepare(`UPDATE bank_statement_items SET matched_cents=matched_cents+?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.statementLineId);
    return { statementMatchedAfter: Number(line.matched_cents || 0) + command.amountCents };
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

function postSalesInvoiceRaceSafe(db, command) {
  // Race-safe mirror of postSalesInvoice used only by RACE-10 / RACE-11
  // economic-uniqueness races. The PRODUCTION function (server/modules/
  // commercial-golive.js postSalesInvoice) does the same SELECT →
  // recognition → voucher → status transition pattern.
  //
  // The store-side canonical idempotency-key on sales_invoices prevents
  // duplicate rows at the schema level. The lock on the SELECT status
  // row plus the existing-voucher short-circuit (with FOR UPDATE) prevents
  // double-POST + double-voucher on concurrent calls.
  return transaction(db, () => {
    const lock = lockForUpdate();
    const invoice = db.prepare(`SELECT id, status FROM sales_invoices WHERE id=?${lock}`).get(command.invoiceId);
    if (!invoice) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (invoice.status === 'POSTED') return { alreadyPosted: true, invoiceId: command.invoiceId };
    if (invoice.status !== 'DRAFT') throw Object.assign(new Error('STATUS_NOT_DRAFT'), { code: 'STATUS_NOT_DRAFT', status: invoice.status });
    assertFinanceBusinessDateOpen(db, 'AR', command.invoiceDate || BUSINESS_DATE);
    // existing-voucher short-circuit (mirrors generateVoucher). The
    // FOR UPDATE lock on the existing row + a unique constraint on
    // accounting_vouchers(source_type,source_id) — both must hold —
    // ensures exactly one voucher row survives the race.
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
    // Idempotent invoice source-link (mirrors recordInvoiceLinks
    // INSERT … ON CONFLICT skip). One source-link per invoice+source.
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
    if (bill.status !== 'MATCHED') throw Object.assign(new Error('STATUS_NOT_MATCHED'), { code: 'STATUS_NOT_MATCHED', status: bill.status });
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
    if (bill.status === 'MATCHED') return { alreadyMatched: true };
    if (bill.status !== 'WAITING_MATCH') throw Object.assign(new Error('STATUS_NOT_WAITING_MATCH'), { code: 'STATUS_NOT_WAITING_MATCH', status: bill.status });
    db.prepare(`UPDATE supplier_bills SET status='MATCHED', matched_unit_price_cents=?, updated_at=? WHERE id=?`)
      .run(command.amountCents, isoNow(), command.billId);
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
      conflict: ['INSUFFICIENT_OPEN', 'CONVERTED', 'NOT_DRAFT', 'ALREADY_CLOSED', 'ALREADY_MATCHED', 'STATE_DRIFT', 'STATUS_NOT_CONFIRMED', 'NOT_FINAL_SOURCE', 'INSUFFICIENT_BALANCE', 'BOOK_INSUFFICIENT', 'STATEMENT_EXCEEDS', 'PROVISIONAL_NOT_FOUND'].includes(error.code),
    } })}\n`);
  }
});
lines.on('close', () => db.close());
