// V22 — Finance Operations Wave B.
//
// FO23 / FO24 / FO25 / FO26 — Unapplied balance truth.
//
// Existing mature primitives (settlement_unapplied_balances + balance_applications
// + financial_refunds) are convergent. This module exposes Finance canonical
// façade methods that:
//   1. assertFinanceBusinessDateOpen
//   2. delegate to canonical source-table writes
//   3. refreshOpenAmount / assertOpenAmountReconciled
//
// FO23 = advance receipt / prepayment (PREPAYMENT balance_type).
// FO24 = unapplied credit (CREDIT balance_type from credit adjustment chain).
// FO25 = balance application to eligible FINAL open item.
// FO26 = unapplied balance refund (FO26 only — NOT settlement reversal).

import { HttpError, allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './finance-refresh-open-amount.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';

export async function postAdvanceReceipt(db, req, res, actor) {
  // FO23 customer-side prepayment. Side=CUSTOMER, balance_type=PREPAYMENT.
  allow(actor, 'COLLECTION_MANAGE');
  const body = await readJson(req);
  const customerId = requiredText(body.customerId, 'customerId', 64);
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const now = new Date().toISOString();
  const balanceId = id();
  runInTransaction(db, () => {
    assertFinanceBusinessDateOpen(db, 'AR', businessDate);
    // create a payment_collections header (existing mature path) with explicit_unapplied=1
    db.prepare(
      `INSERT INTO payment_collections(id, collection_no, customer_id, receivable_id, amount_cents, payment_method, collection_date, remark, creator_id, created_at, status, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
       VALUES(?,?,?,NULL,?, 'CASH', ?, ?, ?, ?, 'CONFIRMED', '', 0, 'NONE', NULL, ?, 1)`
    ).run(
      balanceId, `ADVANCE-${now.slice(0, 10)}-${balanceId.slice(0, 6)}`, customerId, amount, businessDate, '', actor.id, now, amount,
    );
    db.prepare(
      `INSERT INTO settlement_unapplied_balances(id, side, balance_type, party_id, source_type, source_id, source_no, original_amount_cents, business_date, settlement_account_id, status, created_by, created_at)
       VALUES(?, 'CUSTOMER', 'PREPAYMENT', ?, 'PAYMENT_COLLECTION', ?, ?, ?, ?, NULL, 'OPEN', ?, ?)`
    ).run(
      id(), customerId, balanceId, `ADVANCE-${now.slice(0, 10)}-${balanceId.slice(0, 6)}`, amount, businessDate, actor.id, now,
    );
    audit(db, actor.id, 'ADVANCE_RECEIPT', 'FINANCE_UNAPPLIED_BALANCE', balanceId, 'PREPAYMENT');
  });
  return send(res, 200, { balanceId });
}

export async function postBalanceApplication(db, req, res, actor) {
  // FO25 — apply unapplied balance to eligible FINAL open item.
  const body = await readJson(req);
  const balanceId = requiredText(body.balanceId, 'balanceId', 64);
  const targetOpenItemId = requiredText(body.openItemId, 'openItemId', 64);
  const side = requiredText(body.side, 'side', 4);
  allow(actor, side === 'AR' ? 'COLLECTION_MANAGE' : 'PAYMENT_MANAGE');
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const now = new Date().toISOString();
  runInTransaction(db, () => {
    assertFinanceBusinessDateOpen(db, side, businessDate);
    // delegate to balance_applications (existing mature primitive)
    db.prepare(
      `INSERT INTO balance_applications(id, application_no, side, balance_kind, balance_id, target_open_item_id, amount_cents, business_date, reason, status, creator_id, created_at)
       VALUES(?,?,?, 'PREPAYMENT', ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)`
    ).run(
      id(), `APPLY-${now.slice(0, 10)}-${id().slice(0, 6)}`, side, balanceId, targetOpenItemId, amount, businessDate, '', actor.id, now,
    );
    refreshOpenAmount(db, targetOpenItemId);
    assertOpenAmountReconciled(db, targetOpenItemId);
    audit(db, actor.id, 'BALANCE_APPLICATION', 'FINANCE_BALANCE_APPLICATION', targetOpenItemId, balanceId);
  });
  return send(res, 200, { targetOpenItemId, balanceId });
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  return transaction(db, fn);
}
