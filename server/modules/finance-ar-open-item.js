// V22 — Finance Operations Wave A.
//
// FO09 / FO11 — Final AR / Provisional AR open-item owner.
//
// Canonical header: account_receivables (already exists).
// Wave A establishes:
//   - recognizeFinanceExposure for AR side (consumed by Wave B/C delivery/invoice handlers)
//   - manual/other AR (FO14 partial here; full lifecycle wired later)
//   - provisional creation stub (FO11) used by Wave C; full conversion
//     table wiring arrives in Wave B/C.
//
// This module is intentionally minimal in Wave A — it locks the canonical
// schema interpretation, recognition mode resolution and helper
// functions, and leaves full allocation / reversal to Wave B.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';
import { resolveRecognitionPolicy, RECOGNITION_MODES } from './finance-recognition-policy.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './finance-refresh-open-amount.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';

export function listAccountReceivables(db, res, actor, query = {}) {
  allow(actor, 'AR_VIEW', 'FINANCE_VIEW');
  const rows = db.prepare(
    `SELECT id, voucher_no, customer_id, source_type, source_id, amount_cents,
            open_amount_cents, paid_cents, write_off_cents, status, due_date, business_date,
            recognition_mode, item_kind, conversion_state, conversion_date, settlement_account_id,
            payment_terms_days, return_credit_applied_cents, discount_credit_applied_cents,
            other_credit_applied_cents, cash_allocation_cents
       FROM account_receivables
      ORDER BY business_date DESC, id DESC
      LIMIT ? OFFSET ?`
  ).all(Number(query.limit) || 200, Number(query.offset) || 0);
  return send(res, 200, { receivables: rows });
}

export function getAccountReceivable(db, res, actor, arId) {
  allow(actor, 'AR_VIEW', 'FINANCE_VIEW');
  const row = db.prepare(`SELECT * FROM account_receivables WHERE id=?`).get(arId);
  if (!row) throw new HttpError(404, '应收账款不存在');
  return send(res, 200, { receivable: row });
}

// Manually create AR (FO14 — Other / Manual AR).
export async function createManualAccountReceivable(db, req, res, actor) {
  allow(actor, 'AR_VIEW', 'FINANCE_MANAGE');
  const body = await readJson(req);
  const customerId = requiredText(body.customerId, 'customerId', 64);
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, '金额必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const reason = requiredText(body.reason, 'reason', 256);
  const sourceType = 'MANUAL';
  assertFinanceBusinessDateOpen(db, 'AR', businessDate);
  const policy = resolveRecognitionPolicy(db, 'AR', sourceType, customerId, businessDate);
  const now = new Date().toISOString();
  const arId = id();
  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO account_receivables(
         id, voucher_no, customer_id, source_type, source_id,
         amount_cents, amount_cents, paid_cents, write_off_cents,
         status, due_date, business_date, recognition_mode, item_kind,
         conversion_state, settlement_account_id,
         creator_id, created_at, updated_at)
       VALUES(?,?,?,?,?, ?, ?, 0, 0, 'PENDING', ?, ?, ?, 'FINAL', 'OPEN', NULL, ?, ?, ?)`
    ).run(
      arId, `MANUAL-${now}-${arId.slice(0, 6)}`, customerId, sourceType, customerId,
      amount, amount, businessDate, businessDate, policy.mode, actor.id, now, now,
    );
    db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(amount, arId);
    audit(db, actor.id, 'CREATE', 'ACCOUNT_RECEIVABLE', arId, reason);
  });
  refreshOpenAmount(db, arId);
  assertOpenAmountReconciled(db, arId);
  return send(res, 200, { id: arId, recognitionMode: policy.mode });
}

// FO11 — Create PROVISIONAL AR (used by Wave C conversion flow).
export function createProvisionalAR(db, source, amountCents, businessDate, partyId, actor) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'PROVISIONAL AR 金额非法');
  }
  assertFinanceBusinessDateOpen(db, 'AR', businessDate);
  const now = new Date().toISOString();
  const arId = id();
  db.prepare(
    `INSERT INTO account_receivables(
       id, voucher_no, customer_id, source_type, source_id,
       amount_cents, amount_cents, paid_cents, write_off_cents,
       status, due_date, business_date, recognition_mode, item_kind,
       conversion_state, settlement_account_id,
       creator_id, created_at, updated_at)
     VALUES(?,?,?,?,?, ?, ?, 0, 0, 'PENDING', ?, ?, 'PROVISIONAL_TO_FINANCIAL', 'PROVISIONAL', 'OPEN', NULL, ?, ?, ?)`
  ).run(
    arId, `PROV-${now}-${arId.slice(0, 6)}`, partyId, source.sourceType, source.sourceId,
    amountCents, amountCents, businessDate, businessDate, actor.id, now, now,
  );
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(amountCents, arId);
  audit(db, actor.id, 'CREATE_PROVISIONAL', 'ACCOUNT_RECEIVABLE', arId, source.sourceType);
  return arId;
}

export function setRecognitionModeAndKind(db, openItemId, side, recognitionMode, itemKind, nowIso) {
  const table = side === 'AR' ? 'account_receivables' : 'account_payables';
  db.prepare(`UPDATE ${table} SET recognition_mode=?, item_kind=?, updated_at=? WHERE id=?`)
    .run(recognitionMode, itemKind, nowIso, openItemId);
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
