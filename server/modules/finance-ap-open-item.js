// V22 — Finance Operations Wave A.
//
// FO10 / FO12 — Final AP / Provisional AP open-item owner.
// Symmetric to finance-ar-open-item.js.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';
import { resolveRecognitionPolicy } from './finance-recognition-policy.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './finance-refresh-open-amount.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';

export function listAccountPayables(db, res, actor, query = {}) {
  allow(actor, 'AP_VIEW', 'FINANCE_VIEW');
  const rows = db.prepare(
    `SELECT id, voucher_no, supplier_id, source_type, source_id, amount_cents,
            open_amount_cents, paid_cents, write_off_cents, status, due_date, business_date,
            recognition_mode, item_kind, conversion_state, conversion_date, settlement_account_id,
            payment_terms_days, return_credit_applied_cents, discount_credit_applied_cents,
            other_credit_applied_cents, cash_allocation_cents
       FROM account_payables
      ORDER BY business_date DESC, id DESC
      LIMIT ? OFFSET ?`
  ).all(Number(query.limit) || 200, Number(query.offset) || 0);
  return send(res, 200, { payables: rows });
}

export function getAccountPayable(db, res, actor, apId) {
  allow(actor, 'AP_VIEW', 'FINANCE_VIEW');
  const row = db.prepare(`SELECT * FROM account_payables WHERE id=?`).get(apId);
  if (!row) throw new HttpError(404, '应付账款不存在');
  return send(res, 200, { payable: row });
}

export async function createManualAccountPayable(db, req, res, actor) {
  allow(actor, 'AP_VIEW', 'FINANCE_MANAGE');
  const body = await readJson(req);
  const supplierId = requiredText(body.supplierId, 'supplierId', 64);
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, '金额必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const reason = requiredText(body.reason, 'reason', 256);
  const sourceType = 'MANUAL';
  assertFinanceBusinessDateOpen(db, 'AP', businessDate);
  const policy = resolveRecognitionPolicy(db, 'AP', sourceType, supplierId, businessDate);
  const now = new Date().toISOString();
  const apId = id();
  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO account_payables(
         id, voucher_no, supplier_id, source_type, source_id,
         amount_cents, amount_cents, paid_cents, write_off_cents,
         status, due_date, business_date, recognition_mode, item_kind,
         conversion_state, settlement_account_id,
         creator_id, created_at, updated_at)
       VALUES(?,?,?,?,?, ?, ?, 0, 0, 'PENDING', ?, ?, ?, 'FINAL', 'OPEN', NULL, ?, ?, ?)`
    ).run(
      apId, `MANUAL-${now}-${apId.slice(0, 6)}`, supplierId, sourceType, supplierId,
      amount, amount, businessDate, businessDate, policy.mode, actor.id, now, now,
    );
    db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(amount, apId);
    audit(db, actor.id, 'CREATE', 'ACCOUNT_PAYABLE', apId, reason);
  });
  refreshOpenAmount(db, apId);
  assertOpenAmountReconciled(db, apId);
  return send(res, 200, { id: apId, recognitionMode: policy.mode });
}

export function createProvisionalAP(db, source, amountCents, businessDate, partyId, actor) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'PROVISIONAL AP 金额非法');
  }
  assertFinanceBusinessDateOpen(db, 'AP', businessDate);
  const now = new Date().toISOString();
  const apId = id();
  db.prepare(
    `INSERT INTO account_payables(
       id, voucher_no, supplier_id, source_type, source_id,
       amount_cents, amount_cents, paid_cents, write_off_cents,
       status, due_date, business_date, recognition_mode, item_kind,
       conversion_state, settlement_account_id,
       creator_id, created_at, updated_at)
     VALUES(?,?,?,?,?, ?, ?, 0, 0, 'PENDING', ?, ?, 'PROVISIONAL_TO_FINANCIAL', 'PROVISIONAL', 'OPEN', NULL, ?, ?, ?)`
  ).run(
    apId, `PROV-${now}-${apId.slice(0, 6)}`, partyId, source.sourceType, source.sourceId,
    amountCents, amountCents, businessDate, businessDate, actor.id, now, now,
  );
  db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(amountCents, apId);
  audit(db, actor.id, 'CREATE_PROVISIONAL', 'ACCOUNT_PAYABLE', apId, source.sourceType);
  return apId;
}

function runInTransaction(db, fn) {
  if (db.inTransaction && db.inTransaction()) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
