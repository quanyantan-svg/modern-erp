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

import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { HttpError, allowAny, assertAllowedFields, readJson, requiredText, send } from '../lib/http.js';
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

// ---------------------------------------------------------------------------
// C-P02 会计档案的维护面
// ---------------------------------------------------------------------------
//
// 档案是**委外加工费过账的唯一科目来源**（Requirement §31.19.3 / Design §26.39.8）。
// 维护面只做三件事：
//
//   1. 列出档案（读）；
//   2. 建立一套新档案（写）；
//   3. 改变档案的**批准状态**（APPROVED / SUSPENDED）。
//
// 维护面**不**改写既有档案的科目、税率与有效期：档案是会计政策，改政策就是
// 换一套档案。历史档案与历史过账事实都不被改写。
//
// 职责分离：维护权限是财务侧的过账权限（`SUPPLIER_BILL_MANAGE`），委外业务
// 侧**不得**定义科目。缺档案或档案未批准时过账一律 fail closed（见
// `resolveProcessingFeeAccountingProfile`）。

const PROFILE_SCOPES = new Set(['GLOBAL', 'SUPPLIER']);
const PROFILE_TAX_MODES = new Set(['NO_TAX', 'EXCLUSIVE', 'INCLUSIVE']);
const PROFILE_APPROVAL_STATES = new Set(['APPROVED', 'SUSPENDED']);
const PROFILE_VIEWS = ['SUPPLIER_BILL_MANAGE', 'OUTSOURCING_MANAGE'];
const PROFILE_MANAGE = ['SUPPLIER_BILL_MANAGE'];

export const OUTSOURCING_GL_PROFILE_CODES = Object.freeze({
  ROLE_UNRESOLVED: 'OUTSOURCING_GL_PROFILE_ROLE_UNRESOLVED',
  OVERLAP: 'OUTSOURCING_GL_PROFILE_OVERLAP',
  NOT_FOUND: 'OUTSOURCING_GL_PROFILE_NOT_FOUND',
  INVALID: 'OUTSOURCING_GL_PROFILE_INVALID',
  STATE_INVALID: 'OUTSOURCING_GL_PROFILE_STATE_INVALID',
});

function profileRow(row) {
  return {
    id: row.id,
    scope: row.scope,
    supplierId: row.supplier_id || null,
    profileCode: row.profile_code,
    taxMode: row.tax_mode,
    processingFeeRole: row.processing_fee_role,
    inputTaxRole: row.input_tax_role || null,
    varianceRole: row.variance_role || null,
    approvalState: row.approval_state,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 角色码必须解析到**启用**科目，否则档案不可用（fail closed）。 */
function assertProfileRolesResolvable(db, { processingFeeRole, inputTaxRole, varianceRole }) {
  const roles = [processingFeeRole, inputTaxRole, varianceRole].filter(Boolean);
  for (const role of roles) {
    const mapping = db.prepare(`SELECT 1 FROM account_role_mappings m JOIN accounting_subjects s
      ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?`).get(role);
    if (!mapping) {
      throw new HttpError(409, `会计档案引用的角色码 ${role} 没有对应的启用科目`, {
        code: OUTSOURCING_GL_PROFILE_CODES.ROLE_UNRESOLVED,
      });
    }
  }
  return true;
}

/** 同一范围（供应商级按供应商）不得存在窗口重叠的**已批准**档案。 */
function assertNoProfileOverlap(db, { scope, supplierId, effectiveFrom, effectiveTo, excludeId = null }) {
  const rows = db.prepare(`SELECT * FROM outsourcing_processing_fee_accounting_profiles
    WHERE approval_state='APPROVED' AND scope=?
      AND (scope='GLOBAL' OR supplier_id=?)
      AND id<>?`).all(scope, scope === 'GLOBAL' ? null : supplierId, excludeId || '');
  for (const row of rows) {
    const rowTo = row.effective_to || '9999-12-31';
    const to = effectiveTo || '9999-12-31';
    if (effectiveFrom <= rowTo && row.effective_from <= to) {
      throw new HttpError(409, `该范围内已存在生效中的加工费会计档案 ${row.profile_code}`, {
        code: OUTSOURCING_GL_PROFILE_CODES.OVERLAP,
      });
    }
  }
  return true;
}

export function listProcessingFeeAccountingProfiles(db, res, actor) {
  allowAny(actor, PROFILE_VIEWS);
  const rows = db.prepare(`SELECT * FROM outsourcing_processing_fee_accounting_profiles
    ORDER BY scope, supplier_id, effective_from DESC, id`).all();
  return send(res, 200, { processingFeeAccountingProfiles: rows.map(profileRow) });
}

export async function createProcessingFeeAccountingProfile(db, req, res, actor) {
  allowAny(actor, PROFILE_MANAGE);
  const body = await readJson(req);
  assertAllowedFields(body, [
    'scope', 'supplierId', 'profileCode', 'taxMode', 'processingFeeRole', 'inputTaxRole', 'varianceRole',
    'approvalState', 'effectiveFrom', 'effectiveTo',
  ]);
  const scope = String(body.scope || '').trim().toUpperCase();
  if (!PROFILE_SCOPES.has(scope)) {
    throw new HttpError(400, '会计档案范围不正确', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
  }
  const supplierId = body.supplierId ? String(body.supplierId).trim() : null;
  if (scope === 'SUPPLIER' && !supplierId) {
    throw new HttpError(400, '供应商级档案必须指定供应商', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
  }
  if (scope === 'GLOBAL' && supplierId) {
    throw new HttpError(400, '全局档案不得指定供应商', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
  }
  if (supplierId) {
    const supplier = db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplierId);
    if (!supplier) {
      throw new HttpError(409, '供应商不存在', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
    }
  }
  const profileCode = requiredText(body.profileCode, '档案编码', 100);
  const taxMode = String(body.taxMode || 'NO_TAX').trim().toUpperCase();
  if (!PROFILE_TAX_MODES.has(taxMode)) {
    throw new HttpError(400, '税务口径不正确', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
  }
  const approvalState = String(body.approvalState || 'APPROVED').trim().toUpperCase();
  if (!PROFILE_APPROVAL_STATES.has(approvalState)) {
    throw new HttpError(400, '批准状态不正确', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
  }
  const processingFeeRole = requiredText(body.processingFeeRole, '加工费借方角色码', 100);
  const inputTaxRole = body.inputTaxRole ? String(body.inputTaxRole).trim() : null;
  const varianceRole = body.varianceRole ? String(body.varianceRole).trim() : null;
  assertProfileRolesResolvable(db, { processingFeeRole, inputTaxRole, varianceRole });
  const effectiveFrom = requiredText(body.effectiveFrom, '生效起始日', 32);
  const effectiveTo = body.effectiveTo ? String(body.effectiveTo).trim() : null;
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new HttpError(400, '生效结束日不得早于生效起始日', { code: OUTSOURCING_GL_PROFILE_CODES.INVALID });
  }
  if (approvalState === 'APPROVED') {
    assertNoProfileOverlap(db, { scope, supplierId, effectiveFrom, effectiveTo });
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_processing_fee_accounting_profiles(
        id,scope,supplier_id,profile_code,tax_mode,processing_fee_role,input_tax_role,variance_role,
        approval_state,effective_from,effective_to,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, scope, supplierId, profileCode, taxMode, processingFeeRole, inputTaxRole, varianceRole,
      approvalState, effectiveFrom, effectiveTo, actor.id, now, now,
    );
    audit(db, actor.id, 'CREATE', 'OUTSOURCING_PROCESSING_FEE_PROFILE', id,
      JSON.stringify({ scope, supplierId, profileCode, taxMode, processingFeeRole, inputTaxRole, varianceRole, approvalState, effectiveFrom, effectiveTo }));
  });
  return send(res, 201, {
    processingFeeAccountingProfile: profileRow(
      db.prepare('SELECT * FROM outsourcing_processing_fee_accounting_profiles WHERE id=?').get(id),
    ),
  });
}

export async function changeProcessingFeeAccountingProfileState(db, req, res, actor, profileId) {
  allowAny(actor, PROFILE_MANAGE);
  const body = await readJson(req);
  assertAllowedFields(body, ['approvalState', 'reason']);
  const approvalState = String(body.approvalState || '').trim().toUpperCase();
  if (!PROFILE_APPROVAL_STATES.has(approvalState)) {
    throw new HttpError(400, '批准状态不正确', { code: OUTSOURCING_GL_PROFILE_CODES.STATE_INVALID });
  }
  const row = db.prepare('SELECT * FROM outsourcing_processing_fee_accounting_profiles WHERE id=?').get(profileId);
  if (!row) {
    throw new HttpError(404, '会计档案不存在', { code: OUTSOURCING_GL_PROFILE_CODES.NOT_FOUND });
  }
  if (row.approval_state === approvalState) {
    throw new HttpError(409, `会计档案已处于 ${approvalState} 状态`, {
      code: OUTSOURCING_GL_PROFILE_CODES.STATE_INVALID,
    });
  }
  if (approvalState === 'APPROVED') {
    // 重新批准前必须重读权威科目：科目被停用后不得让档案复活。
    assertProfileRolesResolvable(db, {
      processingFeeRole: row.processing_fee_role,
      inputTaxRole: row.input_tax_role,
      varianceRole: row.variance_role,
    });
    assertNoProfileOverlap(db, {
      scope: row.scope, supplierId: row.supplier_id,
      effectiveFrom: row.effective_from, effectiveTo: row.effective_to, excludeId: row.id,
    });
  }
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE outsourcing_processing_fee_accounting_profiles SET approval_state=?,updated_at=? WHERE id=?')
      .run(approvalState, now, profileId);
    audit(db, actor.id, approvalState === 'APPROVED' ? 'APPROVE' : 'SUSPEND',
      'OUTSOURCING_PROCESSING_FEE_PROFILE', profileId,
      JSON.stringify({ approvalState, reason: body.reason ? String(body.reason).slice(0, 200) : null }));
  });
  return send(res, 200, {
    processingFeeAccountingProfile: profileRow(
      db.prepare('SELECT * FROM outsourcing_processing_fee_accounting_profiles WHERE id=?').get(profileId),
    ),
  });
}
