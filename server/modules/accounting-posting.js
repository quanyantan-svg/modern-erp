// Accounting & Analytics Domain Closure — AA-W1 / AA-W3 canonical posting layer.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.1 (AA-W1),
//   §35.4.3 (AA-27 凭证纠错 / AA-28 出纳复核)
// Design:    docs/design/accounting-analytics.md §31.1.3 / §31.3.2 / §31.3.3
//
// Single responsibility: 凭证过账、出纳复核、冲销 / 补记的统一入口。
//
// Boundaries enforced by this module:
//   - It never invents a second ledger. Every write goes through the existing
//     `accounting_vouchers` / `accounting_entries` tables.
//   - `createSystemVoucher` semantics are unchanged. This module only adds the
//     optional cash-flow dimension and the voucher-correction bookkeeping.
//   - Cashier review is a **pre-posting gate**. A voucher that requires review
//     cannot reach POSTED before the reviewer approves it.
//   - SOD: the cashier reviewer must differ from the voucher creator and from
//     the voucher approver. Violations are rejected by the backend.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { createSystemVoucher, reverseSystemVoucher } from './financial-inventory.js';

export const CASHIER_REVIEW_STATUSES = Object.freeze([
  'NOT_REQUIRED',
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

// Cash-flow categories allowed on a voucher entry (AA-29).
export const CASH_FLOW_CATEGORIES = Object.freeze(['OPERATING', 'INVESTING', 'FINANCING']);

function accountPeriod(voucher) {
  const date = voucher.business_date || voucher.voucher_date || '';
  return String(date).slice(0, 7);
}

export function isPeriodClosed(db, period) {
  if (!period) return false;
  return Boolean(db.prepare("SELECT 1 FROM period_closures WHERE period=? AND status='CLOSED'").get(period));
}

function assertPeriodOpen(db, voucher, operation) {
  const period = accountPeriod(voucher);
  if (isPeriodClosed(db, period)) {
    throw new HttpError(409, '会计期间 ' + period + ' 已结账，禁止' + operation, { code: 'PERIOD_CLOSED' });
  }
}

/**
 * AA-W3.6 — decide whether a voucher needs cashier review.
 *
 * A voucher needs review when the template explicitly declares it, or when any
 * of its entries touches a cash / bank / treasury account role. The decision is
 * derived from the authoritative account-role mapping, never from a
 * hardcoded subject code.
 */
export function requiresCashierReview(db, voucherId) {
  const explicit = db.prepare("SELECT 1 FROM accounting_vouchers WHERE id=? AND cashier_review_status<>'NOT_REQUIRED'").get(voucherId);
  if (explicit) return true;
  const treasuryRoles = db.prepare(
    "SELECT DISTINCT m.role_code FROM accounting_entries e JOIN account_role_mappings m ON m.subject_id=e.subject_id WHERE e.voucher_id=? AND (m.role_code LIKE '%CASH%' OR m.role_code LIKE '%BANK%' OR m.role_code LIKE '%TREASURY%')",
  ).all(voucherId);
  return treasuryRoles.length > 0;
}

/**
 * AA-W1.3 / AA-W2.7 — post a system voucher for one accounting event and
 * write the event back-fill inside the **same** transaction.
 *
 * The event write and the voucher write are intentionally *not* in one
 * transaction (see §31.1.3): the event is committed first so that an
 * ungenerated business fact is always visible. This helper is called inside
 * the voucher's own transaction and therefore commits the voucher + the
 * event back-fill atomically.
 */
export function postEventVoucher(db, { event, entries, actorId, businessDate, remark }) {
  const voucherId = createSystemVoucher(db, {
    sourceType: event.source_type,
    sourceId: event.source_id,
    businessDate,
    actorId,
    remark: remark || '',
    entries,
  });
  if (!voucherId) {
    throw new HttpError(409, '凭证分录为空，未生成凭证', { code: 'ACCOUNTING_VOUCHER_EMPTY' });
  }
  db.prepare('UPDATE accounting_events SET status=?, voucher_id=?, attempt_count=attempt_count+1, last_error_code=NULL, last_error_message=NULL, updated_at=? WHERE id=?')
    .run('GENERATED', voucherId, new Date().toISOString(), event.id);
  db.prepare("INSERT INTO accounting_event_attempts(id,event_id,attempt_no,outcome,error_code,error_message,voucher_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id(), event.id, Number(event.attempt_count || 0) + 1, 'SUCCESS', null, null, voucherId, new Date().toISOString());
  return voucherId;
}

// ---------------------------------------------------------------------------
// AA-W3.3 — unified reversal path (manual + system share one implementation)
// ---------------------------------------------------------------------------

function loadVoucherEntries(db, voucherId) {
  return db.prepare('SELECT subject_id subjectId,direction,amount_cents amountCents,summary FROM accounting_entries WHERE voucher_id=? ORDER BY line_no,id').all(voucherId);
}

function mirrorEntries(entries, prefix) {
  return entries.map((entry) => ({
    ...entry,
    direction: entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
    summary: prefix + (entry.summary || ''),
  }));
}

/**
 * AA-W3.1 / AA-W3.2 / AA-W3.3 — the single canonical reversal entry point.
 *
 * Both manual and system vouchers are reversed here so the semantics are
 * identical. The mirrored entries are amount- and direction-exact; a voucher
 * that is not POSTED, already reversed, or in a closed period is rejected.
 */
export function reverseVoucher(db, { voucherId, actorId, reason, businessDate }) {
  const original = db.prepare('SELECT * FROM accounting_vouchers WHERE id=?').get(voucherId);
  if (!original) throw new HttpError(404, '凭证不存在', { code: 'VOUCHER_NOT_FOUND' });
  if (original.status !== 'POSTED') {
    throw new HttpError(409, '只有已过账凭证可以冲销', { code: 'VOUCHER_NOT_POSTED' });
  }
  const alreadyReversed = db.prepare('SELECT 1 FROM accounting_vouchers WHERE reversal_of_id=?').get(voucherId);
  if (alreadyReversed) {
    throw new HttpError(409, '凭证已被冲销', { code: 'VOUCHER_ALREADY_REVERSED' });
  }
  assertPeriodOpen(db, original, '冲销');

  const entries = loadVoucherEntries(db, voucherId);
  if (!entries.length) {
    throw new HttpError(409, '凭证没有分录，无法冲销', { code: 'VOUCHER_HAS_NO_ENTRIES' });
  }
  const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + Number(entry.amountCents), 0);
  const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + Number(entry.amountCents), 0);
  if (debit !== credit) {
    throw new HttpError(409, '原凭证借贷不平衡，拒绝冲销', { code: 'VOUCHER_NOT_BALANCED' });
  }

  const effectiveDate = businessDate || original.business_date || original.voucher_date;
  const reversalId = transaction(db, () => {
    const reversed = createSystemVoucher(db, {
      sourceType: original.voucher_origin === 'SYSTEM' ? 'SYSTEM_REVERSAL' : 'MANUAL_REVERSAL',
      sourceId: original.id,
      businessDate: effectiveDate,
      actorId,
      reversalOfId: original.id,
      remark: reason,
      entries: mirrorEntries(entries, '冲销 ' + (original.voucher_no || original.id) + ' '),
    });
    db.prepare('INSERT INTO voucher_corrections(id,original_voucher_id,correction_type,correction_voucher_id,difference_json,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(), original.id, 'REVERSAL', reversed, null, reason, actorId, new Date().toISOString());
    db.prepare("UPDATE accounting_events SET status='REVERSED', updated_at=? WHERE voucher_id=? AND status='GENERATED'")
      .run(new Date().toISOString(), original.id);
    audit(db, actorId, 'VOUCHER_REVERSE', 'ACCOUNTING_VOUCHER', original.id, '冲销凭证 ' + reason);
    return reversed;
  });
  return reversalId;
}

/**
 * AA-W3.4 — supplement (补记) voucher linked to the original voucher so the
 * difference stays comparable.
 */
export function supplementVoucher(db, { voucherId, actorId, entries, reason, businessDate }) {
  const original = db.prepare('SELECT * FROM accounting_vouchers WHERE id=?').get(voucherId);
  if (!original) throw new HttpError(404, '凭证不存在', { code: 'VOUCHER_NOT_FOUND' });
  if (original.status !== 'POSTED') {
    throw new HttpError(409, '只有已过账凭证可以补记', { code: 'VOUCHER_CORRECTION_NOT_ALLOWED' });
  }
  assertPeriodOpen(db, original, '补记');
  const normalized = (entries || [])
    .filter((entry) => Number(entry.amountCents) !== 0)
    .map((entry) => ({ ...entry, amountCents: Math.abs(Number(entry.amountCents)) }));
  if (!normalized.length) {
    throw new HttpError(400, '补记分录不能为空', { code: 'VOUCHER_SUPPLEMENT_ENTRIES_REQUIRED' });
  }
  const debit = normalized.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + Number(entry.amountCents), 0);
  const credit = normalized.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + Number(entry.amountCents), 0);
  if (debit !== credit) {
    throw new HttpError(409, '补记凭证借贷不平衡', { code: 'VOUCHER_NOT_BALANCED' });
  }
  const effectiveDate = businessDate || original.business_date || original.voucher_date;
  const supplementId = transaction(db, () => {
    const created = createSystemVoucher(db, {
      sourceType: 'SUPPLEMENT',
      sourceId: original.id,
      businessDate: effectiveDate,
      actorId,
      remark: reason || '补记凭证',
      entries: normalized,
    });
    db.prepare('UPDATE accounting_vouchers SET correction_of_id=? WHERE id=?').run(original.id, created);
    db.prepare('INSERT INTO voucher_corrections(id,original_voucher_id,correction_type,correction_voucher_id,difference_json,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id(), original.id, 'SUPPLEMENT', created, JSON.stringify(normalized), reason || '', actorId, new Date().toISOString());
    audit(db, actorId, 'VOUCHER_SUPPLEMENT', 'ACCOUNTING_VOUCHER', original.id, '补记凭证：' + (reason || ''));
    return created;
  });
  return supplementId;
}

// ---------------------------------------------------------------------------
// AA-W3.5 / AA-W3.6 / AA-W3.7 — cashier review
// ---------------------------------------------------------------------------

/**
 * AA-W3.5..AA-W3.7 — mark / approve / reject the cashier review node.
 *
 * SOD: reviewer must differ from both the voucher creator and the voucher
 * approver. The check is server-side and cannot be bypassed by configuration.
 */
export function cashierReview(db, { voucherId, actorId, action, reason, roleCode }) {
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id=?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在', { code: 'VOUCHER_NOT_FOUND' });
  const now = new Date().toISOString();

  if (action === 'MARK') {
    if (voucher.cashier_review_status && voucher.cashier_review_status !== 'NOT_REQUIRED') {
      throw new HttpError(409, '凭证已标记出纳复核', { code: 'VOUCHER_CASHIER_REVIEW_ALREADY_MARKED' });
    }
    transaction(db, () => {
      db.prepare("UPDATE accounting_vouchers SET cashier_review_status='PENDING', updated_at=? WHERE id=?").run(now, voucherId);
      audit(db, actorId, 'VOUCHER_CASHIER_REVIEW', 'ACCOUNTING_VOUCHER', voucherId, '标记出纳复核');
    });
    return 'PENDING';
  }

  if (action === 'APPROVE' || action === 'REJECT') {
    if (voucher.cashier_review_status !== 'PENDING') {
      throw new HttpError(409, '只有待复核凭证可以复核', { code: 'VOUCHER_CASHIER_REVIEW_NOT_PENDING' });
    }
    if (voucher.creator_id === actorId) {
      throw new HttpError(403, '出纳复核人不得是制单人', { code: 'VOUCHER_CASHIER_REVIEW_SOD_VIOLATION' });
    }
    if (voucher.approver_id && voucher.approver_id === actorId) {
      throw new HttpError(403, '出纳复核人不得是审核人', { code: 'VOUCHER_CASHIER_REVIEW_SOD_VIOLATION' });
    }
    const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    transaction(db, () => {
      db.prepare('UPDATE accounting_vouchers SET cashier_review_status=?, cashier_reviewed_by=?, cashier_reviewed_at=?, cashier_review_reason=?, updated_at=? WHERE id=?')
        .run(nextStatus, actorId, now, reason || '', now, voucherId);
      audit(db, actorId, 'VOUCHER_CASHIER_REVIEW', 'ACCOUNTING_VOUCHER', voucherId,
        (action === 'APPROVE' ? '出纳复核通过' : '出纳复核驳回') + (reason ? '：' + reason : ''));
    });
    return nextStatus;
  }

  throw new HttpError(400, '不支持的出纳复核动作：' + String(action), { code: 'VOUCHER_CASHIER_REVIEW_ACTION_INVALID' });
}

/**
 * AA-W3.6 — posting gate. A voucher that still requires cashier review must
 * not reach POSTED.
 */
export function assertCashierReviewCleared(voucher) {
  const status = voucher.cashier_review_status || 'NOT_REQUIRED';
  if (status !== 'NOT_REQUIRED' && status !== 'APPROVED') {
    throw new HttpError(409, '凭证尚未通过出纳复核，禁止过账', { code: 'VOUCHER_CASHIER_REVIEW_REQUIRED' });
  }
}

/**
 * AA-W3.1 — the correction chain of one voucher (reversals + supplements).
 */
export function listCorrections(db, voucherId) {
  return db.prepare('SELECT * FROM voucher_corrections WHERE original_voucher_id=? ORDER BY created_at,id').all(voucherId);
}

// ---------------------------------------------------------------------------
// AA-W3 HTTP surface
// ---------------------------------------------------------------------------

/**
 * AA-W3.5 / AA-W3.6 / AA-W3.7 — the cashier review node.
 *
 * The node is **explicit**: a voucher enters it when it is marked here or
 * when its generating template declares the requirement. The legacy manual
 * voucher flow is not auto-marked, because §31.12.1 requires the existing
 * 录入 → 提交 → 审核 → 过账 chain to keep working unchanged.
 */
async function postCashierReview(db, req, res, actor, voucherId) {
  allow(actor, 'VOUCHER_CASHIER_REVIEW');
  const body = await readJson(req);
  const action = requiredText(body.action, '复核动作', 20).toUpperCase();
  const reason = body.reason === undefined ? '' : requiredText(body.reason, '复核意见', 500);
  const status = cashierReview(db, {
    voucherId,
    actorId: actor.id,
    action,
    reason,
    roleCode: actor.roleCode,
  });
  const voucher = db.prepare('SELECT cashier_review_status cashierReviewStatus,cashier_reviewed_by cashierReviewedBy,cashier_reviewed_at cashierReviewedAt,cashier_review_reason cashierReviewReason FROM accounting_vouchers WHERE id=?').get(voucherId);
  return send(res, 200, { id: voucherId, status, review: voucher });
}

/**
 * AA-W3.1 / AA-W3.2 / AA-W3.3 — the unified reversal entry point.
 *
 * Manual and system vouchers share this implementation, so the reversal
 * semantics (mirrored direction, mirrored amount, one reversal per voucher)
 * are identical for both.
 */
async function postReverse(db, req, res, actor, voucherId) {
  allowAny(actor, ['VOUCHER_SUBMIT', 'VOUCHER_APPROVE']);
  const body = await readJson(req);
  const reason = requiredText(body.reason, '冲销原因', 500);
  const reversalId = reverseVoucher(db, {
    voucherId,
    actorId: actor.id,
    reason,
    businessDate: body.businessDate || null,
  });
  const voucher = db.prepare('SELECT id,voucher_no voucherNo,status,reversal_of_id reversalOfId,source_type sourceType,source_id sourceId FROM accounting_vouchers WHERE id=?').get(reversalId);
  return send(res, 201, { id: reversalId, ...voucher });
}

/**
 * AA-W3.4 — the supplement (补记) entry point. The new voucher is linked to
 * the original through `correction_of_id` and the difference stays
 * comparable in `voucher_corrections`.
 */
async function postSupplement(db, req, res, actor, voucherId) {
  allowAny(actor, ['VOUCHER_SUBMIT', 'VOUCHER_APPROVE']);
  const body = await readJson(req);
  const reason = requiredText(body.reason, '补记原因', 500);
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const supplementId = supplementVoucher(db, {
    voucherId,
    actorId: actor.id,
    entries,
    reason,
    businessDate: body.businessDate || null,
  });
  const voucher = db.prepare('SELECT id,voucher_no voucherNo,status,correction_of_id correctionOfId FROM accounting_vouchers WHERE id=?').get(supplementId);
  return send(res, 201, { id: supplementId, ...voucher });
}

/**
 * AA-W3.4 — the correction chain of one voucher.
 */
function getCorrections(db, res, actor, voucherId) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'VOUCHER_CASHIER_REVIEW', 'ACCOUNTING_PERIOD_END_MANAGE']);
  const voucher = db.prepare('SELECT id,voucher_no voucherNo,status,source_type sourceType,source_id sourceId FROM accounting_vouchers WHERE id=?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在', { code: 'VOUCHER_NOT_FOUND' });
  return send(res, 200, { voucher, corrections: listCorrections(db, voucherId) });
}

export const accountingPostingHandlers = {
  postCashierReview,
  postReverse,
  postSupplement,
  getCorrections,
};
