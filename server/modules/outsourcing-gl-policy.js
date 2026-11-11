// M1C-WP0-R1 — source-level Business Policy Guard for outsourcing-sourced
// supplier bills.
//
// Contract source: MC-REQ-15 (docs/requirements/procurement-outsourcing.md
// §31.13) and the M1-Core Active Design §9.4.
//
// The judgement is source-based, never route-based and never operator-based:
// a supplier bill is an outsourcing processing-fee bill when ANY of its lines
// carries commercial_source_type = 'OUTSOURCING_RECEIPT_ITEM'. The bill header
// column supplier_bills.commercial_source_type is NOT written by the
// outsourcing writer (its value stays NULL), so reading only that column would
// miss the case.
//
// The guard must run before any state mutation, so that a rejection leaves the
// bill, the AP subledger, the vouchers and the outsourcing cost evidence
// byte-identical. It is therefore called OUTSIDE the surrounding transaction:
// the rejection audit row is committed on its own and survives the throw.
//
// The same guard serves the outsourcing specific entry point and the shared
// supplier-bill entry points, so an admin who inherits every permission is
// rejected exactly like a finance user.
//
// ---------------------------------------------------------------------------
// C-P02 / C-P04 变更（本轮由业务所有者裁定「真正实现正式过账」）
// ---------------------------------------------------------------------------
//
// 过账**不再**被无条件拒绝。委外加工费账单现在走**同一套 canonical 财务原语**
// （`ensurePayableSource` + `recognizeFinanceExposure` + `createSystemVoucher`），
// 但**科目角色码必须来自已批准的会计档案**：
//
//   `outsourcing_processing_fee_accounting_profiles`
//
// 档案缺位、档案未批准、或档案引用的角色码没有 `account_role_mappings` 映射时，
// 过账**仍然 fail closed**（409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`），并且拒绝
// 发生在任何状态、AP、凭证与成本证据写入之前。
//
// 共享入口（`POST /api/supplier-bills/:id/post`、`:id/match`）的**边界不变**：
// 判定依据仍是账单行的商业来源，不是路由、不是操作人、也不是账单级单一列；
// 普通采购账单（来源为 `purchase_receipt_items`）的既有行为**完全不受影响**。

import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';

export const OUTSOURCING_GL_POLICY_CODE = 'OUTSOURCING_GL_POLICY_NOT_APPROVED';
export const OUTSOURCING_GL_PROFILE_CODE = 'OUTSOURCING_GL_PROFILE_NOT_APPROVED';

const OUTSOURCING_SOURCE_TYPE = 'OUTSOURCING_RECEIPT_ITEM';

export function isOutsourcingSourcedSupplierBill(db, billId) {
  return Boolean(db.prepare(
    'SELECT 1 FROM supplier_bill_items WHERE bill_id=? AND commercial_source_type=? LIMIT 1',
  ).get(billId, OUTSOURCING_SOURCE_TYPE));
}

/**
 * Resolve the approved accounting profile for an outsourcing processing-fee
 * bill (C-P02). The profile is the **only** source of account role codes for
 * the processing fee; the business code never hardcodes a subject code.
 *
 * Resolution order:
 *   1. supplier-scoped APPROVED profile effective on the bill date;
 *   2. the GLOBAL APPROVED profile effective on the bill date.
 *
 * Returns `null` when no usable profile exists — the caller then fails closed.
 */
export function resolveProcessingFeeAccountingProfile(db, bill) {
  const date = String(bill?.bill_date || '');
  const rows = db.prepare(`SELECT * FROM outsourcing_processing_fee_accounting_profiles
    WHERE approval_state='APPROVED'
      AND (effective_from<=? )
      AND (effective_to IS NULL OR effective_to>=?)
    ORDER BY (scope='SUPPLIER') DESC, effective_from DESC, id`).all(date || '9999-12-31', date || '0000-01-01');
  const matched = rows.find((row) => row.scope === 'SUPPLIER' && row.supplier_id === bill.supplier_id)
    || rows.find((row) => row.scope === 'GLOBAL');
  if (!matched) return null;
  // Every role the profile names must actually resolve to an active subject.
  const roles = [matched.processing_fee_role, matched.input_tax_role, matched.variance_role].filter(Boolean);
  for (const role of roles) {
    const mapping = db.prepare(`SELECT 1 FROM account_role_mappings m JOIN accounting_subjects s
      ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?`).get(role);
    if (!mapping) return null;
  }
  return matched;
}

/**
 * `action` names the entry point that attempted the write so the rejection
 * audit stays attributable; `actorId` may be null for internal service calls
 * that carry no operator.
 *
 * 这是**唯一**的来源级 Guard。判定依据是**账单行的商业来源**
 * （`supplier_bill_items.commercial_source_type`），不是路由、不是操作人、
 * 也不是账单级单一列；普通采购账单（来源为 `purchase_receipt_items`）完全放行。
 *
 * **C-P04 跨域边界：按入口区分放行条件**
 *
 *   - `POST_SUPPLIER_BILL` / `MATCH_SUPPLIER_BILL` —— **共享入口**
 *     （`POST /api/supplier-bills/:id/post`、`:id/match`，以及普通采购入库
 *     的内部自动过账路径）：委外来源账单一律拒绝。共享入口是**普通采购**的
 *     公共通道；委外加工费的会计口径（借方走加工费科目、不走 GRNI）不得
 *     污染它。
 *   - `POST_PROCESSING_FEE_BILL` —— **委外专属入口**
 *     （`POST /api/procurement/outsourcing/processing-fee-bills/:id/post`）：
 *     委外来源账单在**存在已批准会计档案**（C-P02）时放行；档案缺位 /
 *     未批准 / 角色映射缺位时仍然 409 拒绝，且拒绝发生在任何状态、AP、
 *     凭证与成本证据写入之前。
 *
 * 两种模式的**拒绝**都发生在任何写入之前，判定依据完全相同。
 */
export function assertSupplierBillGlPostable(db, billId, actorId, action) {
  if (!isOutsourcingSourcedSupplierBill(db, billId)) return;
  if (action === 'POST_PROCESSING_FEE_BILL') {
    const bill = db.prepare('SELECT id,supplier_id,bill_date FROM supplier_bills WHERE id=?').get(billId);
    const profile = bill ? resolveProcessingFeeAccountingProfile(db, bill) : null;
    if (profile) return;
    audit(
      db,
      actorId ?? null,
      'REJECT',
      'SUPPLIER_BILL',
      billId,
      `${action} 拒绝：委外加工费会计档案未获批 ${OUTSOURCING_GL_PROFILE_CODE}`,
    );
    throw new HttpError(409, '委外加工费账单的会计档案未获批', {
      code: OUTSOURCING_GL_PROFILE_CODE,
    });
  }
  audit(
    db,
    actorId ?? null,
    'REJECT',
    'SUPPLIER_BILL',
    billId,
    `${action} 拒绝：委外加工费账单来源级业务策略未获批 ${OUTSOURCING_GL_POLICY_CODE}`,
  );
  throw new HttpError(409, '委外加工费账单的正式过账与匹配尚未获批', {
    code: OUTSOURCING_GL_POLICY_CODE,
  });
}
