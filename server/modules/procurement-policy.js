// Procurement parameter wiring (Active Design §26.2 / Requirement §31.3.1 PRC-01).
//
// Every procurement parameter is a live business switch: the parameter row is
// the single authority and the check lives next to the business fact it
// governs. A parameter change therefore takes effect on the next business
// action and never rewrites history.

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
 * 货源控制启用时，没有有效货源的供应商不得被静默使用。
 *
 * 该检查落在「选择供应商」的路径上：请购转采购订单的分组转换。手工采购订单
 * 是采购员已经作出商业决定的结果，不在此处二次裁决货源。
 */
export function assertPurchaseSourceControl(db, { supplierId, productId, businessDate }) {
  if (!getActiveParameters(db).sourceControlEnabled) return;
  const source = db.prepare(`SELECT 1 FROM source_list_entries
    WHERE supplier_id=? AND product_id=? AND source_type='PURCHASE' AND enabled=1
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) LIMIT 1`)
    .get(supplierId, productId, businessDate, businessDate);
  if (!source) {
    throw new HttpError(409, '该供应商在业务日期没有有效采购货源', { code: 'PURCHASE_SOURCE_REQUIRED' });
  }
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
