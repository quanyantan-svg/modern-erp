// Procurement parameter wiring (Active Design §26.2 / Requirement §31.3.1 PRC-01).
//
// Every procurement parameter is a live business switch: the parameter row is
// the single authority and the check lives next to the business fact it
// governs. A parameter change therefore takes effect on the next business
// action and never rewrites history.
//
// This module is also the single home of the **source control** rule
// (PRC-04 / OUT-02). Purchase and outsourcing consume the very same
// implementation: the only difference is the `source_type` of the source list
// entry that must be effective at the business date. Writing two copies of
// the rule would let the two domains drift apart silently, which is exactly
// what AGENTS.md §6 forbids.

import { HttpError } from '../lib/http.js';
import { getActiveParameters } from './procurement-parameters.js';

export function procurementParameters(db) {
  return getActiveParameters(db);
}

/** PO Change 是参数控制的正式业务单据：关闭时既不得申请也不得应用。 */
export function assertPoChangeEnabled(db) {
  if (!getActiveParameters(db).poChangeEnabled) {
    throw new HttpError(409, '采购订单变更当前已被采购参数关闭', { code: 'PO_CHANGE_DISABLED_BY_PARAMETER' });
  }
}

/** 请购策略 SOURCE_REQUIRED 时，请购单必须带来源指令。 */
export function assertRequisitionSourcePolicy(db, body) {
  if (getActiveParameters(db).requisitionPolicy === 'SOURCE_REQUIRED' && !body?.sourceInstructionId) {
    throw new HttpError(409, '请购策略要求请购单必须带来源指令', { code: 'REQUISITION_SOURCE_REQUIRED' });
  }
}

/** 退货策略 REQUEST_REQUIRED 时，采购退货必须挂在已转换的退货申请上。 */
export function assertReturnRequestPolicy(db, { returnRequestId } = {}) {
  if (getActiveParameters(db).returnPolicy === 'REQUEST_REQUIRED' && !returnRequestId) {
    throw new HttpError(409, '退货策略要求采购退货必须来自退货申请', { code: 'RETURN_REQUEST_REQUIRED' });
  }
}

/**
 * 货源类型归一化（PRC-04 / OUT-02）。
 *
 * The source list carries exactly two source types. Both the purchase path and
 * the outsourcing path share this enumeration so a domain can never invent a
 * third source type behind the resolver's back.
 */
export function normalizeSourceType(value, label = '货源类型') {
  const text = String(value ?? '').trim().toUpperCase();
  if (text !== 'PURCHASE' && text !== 'OUTSOURCE') throw new HttpError(400, `${label}不正确`);
  return text;
}

/**
 * The single source-control resolver (PRC-04 / OUT-02).
 *
 * A supplier may be used on a business date when it has **either**
 *   - an effective source list entry for the product and source type, or
 *   - an effective, ACTIVE source list override for the same triple.
 *
 * The override is bounded by its own date window (PRC-04): it releases the
 * supplier on the specified business dates only, never permanently.
 *
 * The function returns the proof it used so the caller can freeze it onto the
 * document it writes; it never mutates anything.
 */
export function resolveEffectiveSource(db, { supplierId, productId, sourceType, businessDate }) {
  const type = normalizeSourceType(sourceType);
  const source = db.prepare(`SELECT id, version, effective_from, effective_to FROM source_list_entries
    WHERE supplier_id=? AND product_id=? AND source_type=? AND enabled=1
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) LIMIT 1`)
    .get(supplierId, productId, type, businessDate, businessDate);
  if (source) {
    return { kind: 'SOURCE_LIST', sourceType: type, sourceId: source.id, version: Number(source.version || 1), effectiveFrom: source.effective_from, effectiveTo: source.effective_to || null };
  }
  const override = db.prepare(`SELECT id, effective_from, effective_to FROM source_list_overrides
    WHERE supplier_id=? AND product_id=? AND source_type=? AND status='ACTIVE'
      AND effective_from<=? AND effective_to>=? LIMIT 1`)
    .get(supplierId, productId, type, businessDate, businessDate);
  if (override) {
    return { kind: 'OVERRIDE', sourceType: type, sourceId: override.id, version: null, effectiveFrom: override.effective_from, effectiveTo: override.effective_to };
  }
  return null;
}

/**
 * 货源控制启用时，没有有效货源的供应商不得被静默使用。
 *
 * 该检查落在「选择供应商」的路径上：请购转采购订单的分组转换与委外订单
 * 创建。手工采购订单是采购员已经作出商业决定的结果，不在此处二次裁决
 * 货源。
 *
 * `sourceType` 决定被查询的货源类型：采购为 `PURCHASE`，委外为
 * `OUTSOURCE`（OUT-02）。两者共用同一份实现与同一套参数开关。
 */
export function assertSourceControl(db, { supplierId, productId, businessDate, sourceType = 'PURCHASE' }) {
  if (!getActiveParameters(db).sourceControlEnabled) return null;
  const type = normalizeSourceType(sourceType);
  const proof = resolveEffectiveSource(db, { supplierId, productId, sourceType: type, businessDate });
  if (!proof) {
    const label = type === 'OUTSOURCE' ? '委外' : '采购';
    throw new HttpError(409, `该供应商在业务日期没有有效${label}货源`, { code: type === 'OUTSOURCE' ? 'OUTSOURCE_SOURCE_REQUIRED' : 'PURCHASE_SOURCE_REQUIRED' });
  }
  return proof;
}

/**
 * 采购侧货源控制（PRC-04）。保留既有函数名作为采购域的语义入口；委外域
 * 使用同一个 `assertSourceControl`，不存在第二份规则。
 */
export function assertPurchaseSourceControl(db, { supplierId, productId, businessDate }) {
  return assertSourceControl(db, { supplierId, productId, businessDate, sourceType: 'PURCHASE' });
}

/**
 * 配额控制启用时，按配额比例分配给供应商的数量不得超过配额比例。
 *
 * 分配器是确定性的有理解算器（`allocateProportional`）；这里只把它接到真实
 * 的请购转采购订单路径上。
 */
export function assertPurchaseQuotaControl(db, { supplierId, productId, businessDate, quantity }) {
  if (!getActiveParameters(db).quotaEnabled) return;
  const quotas = db.prepare(`SELECT proportion_num, proportion_den FROM quota_assignments
    WHERE supplier_id=? AND product_id=? AND source_type='PURCHASE'
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY version DESC LIMIT 1`)
    .all(supplierId, productId, businessDate, businessDate);
  if (!quotas.length) {
    throw new HttpError(409, '该供应商在业务日期没有有效采购配额', { code: 'PURCHASE_QUOTA_NOT_CONFIGURED' });
  }
  const quota = quotas[0];
  const allowed = Number(quota.proportion_num) * Number(quantity) / Number(quota.proportion_den);
  if (quantity > allowed + 1e-9) {
    throw new HttpError(409, `本次分配数量 ${quantity} 超过该供应商的配额上限 ${allowed}`, { code: 'PURCHASE_QUOTA_EXCEEDED' });
  }
}

// ---------------------------------------------------------------------------
// PRC-02 — Supplier Procurement Profile drives the documents.
// ---------------------------------------------------------------------------

/**
 * 供应商品类语义（PRC-02）。
 *
 * The category enumeration is owned by `procurement-profiles.js`
 * (`GENERAL | STRATEGIC | TRANSACTIONAL | OUTSOURCE`). This module only reads
 * the value; it never invents a category and never rewrites one.
 *
 * 品类是**委外业务的前置声明**，不是互斥的业务开关：
 *
 * - `OUTSOURCE` —— 委外加工商。可以承接委外订单与委外加工费采购订单。
 * - 其他品类（`GENERAL` / `STRATEGIC` / `TRANSACTIONAL`）—— 常规供应源，
 *   **不得**承接委外业务。
 *
 * 品类**不**限制普通采购订单：普通采购由采购资质门禁（`procurement_enabled`
 * + 有效采购资质）独立把关。现实业务里「既是物料供应商、又是委外加工商」的
 * 供应商是常态；把品类做成互斥开关会让这种供应商无法存在，而普通采购侧的
 * 门禁本来就完整（采购资质 + 权威价格 + 货源控制），不会因为放开品类而失去
 * 保护。
 *
 * 委外侧仍受三道正交门禁约束：品类声明、委外资质（`outsourcing_enabled` +
 * 有效资质）与 OUTSOURCE 货源（OUT-02）。
 */
const OUTSOURCE_CATEGORY = 'OUTSOURCE';

export function assertSupplierCategoryAllows(db, { supplierId, businessType }) {
  const supplier = db.prepare('SELECT id,supplier_category FROM suppliers WHERE id=?').get(supplierId);
  if (!supplier) throw new HttpError(409, '供应商不存在');
  const category = String(supplier.supplier_category || 'GENERAL').trim().toUpperCase();
  const outsourcingSide = businessType === 'OUTSOURCE_PROCESSING' || businessType === 'OUTSOURCE';
  if (outsourcingSide && category !== OUTSOURCE_CATEGORY) {
    throw new HttpError(409, '该供应商品类不是委外类，不得承接委外业务', { code: 'SUPPLIER_CATEGORY_NOT_OUTSOURCE' });
  }
  return category;
}

/**
 * 采购订单付款天数的权威来源（PRC-02）。
 *
 * The client may state the payment terms days; when it does not, the supplier
 * procurement profile's `default_payment_terms_days` drives the document. The
 * resolved origin is returned so the caller can freeze it onto the order as a
 * snapshot — a later profile change never rewrites a historical order.
 *
 * `clientSpecified` is the authoritative "did the client state it?" signal.
 * When the caller cannot distinguish "the client said 0 days" from "the
 * client said nothing", it must pass `clientSpecified: false` explicitly so a
 * 0 never silently becomes the document's payment terms.
 */
export function resolvePaymentTermsDays(db, { supplierId, clientPaymentTermsDays, clientSpecified = null }) {
  // `clientSpecified === null` means the caller cannot tell "the client said
  // 0 days" from "the client said nothing". In that case 0 is treated as
  // "not stated", so the supplier profile default drives the document. A
  // caller that CAN tell passes an explicit boolean; an explicit `true`
  // honours a stated 0.
  const stated = clientSpecified === null
    ? (clientPaymentTermsDays !== undefined && clientPaymentTermsDays !== null
      && clientPaymentTermsDays !== '' && Number(clientPaymentTermsDays) !== 0)
    : clientSpecified;
  if (stated && clientPaymentTermsDays !== undefined && clientPaymentTermsDays !== null && clientPaymentTermsDays !== '') {
    return { paymentTermsDays: Number(clientPaymentTermsDays), source: 'CLIENT' };
  }
  const supplier = db.prepare('SELECT default_payment_terms_days FROM suppliers WHERE id=?').get(supplierId);
  const profileValue = supplier?.default_payment_terms_days;
  if (profileValue === null || profileValue === undefined) {
    return { paymentTermsDays: null, source: 'NONE' };
  }
  return { paymentTermsDays: Number(profileValue), source: 'SUPPLIER_DEFAULT' };
}
