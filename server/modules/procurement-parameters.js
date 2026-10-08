import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, assertAllowedFields, readJson, send } from '../lib/http.js';

const BILLING_MODES = new Set(['SEPARATE', 'LEGACY_DIRECT', 'AUTO_BILL']);
const TOLERANCE_POLICIES = new Set(['STRICT', 'SOFT_BAND']);
const REQUISITION_POLICIES = new Set(['OPEN', 'SOURCE_REQUIRED']);
const RETURN_POLICIES = new Set(['STANDARD', 'REQUEST_REQUIRED']);
const NUMBERING_POLICIES = new Set(['PERIOD_SEQ']);

function booleanFlag(value, label) {
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  throw new HttpError(400, `${label}必须为布尔值`);
}

function enumValue(value, values, label) {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!values.has(normalized)) throw new HttpError(400, `${label}不正确`);
  return normalized;
}

function dto(row) {
  return {
    id: row.id,
    sourceControlEnabled: Boolean(row.source_control_enabled),
    quotaEnabled: Boolean(row.quota_control_enabled),
    requisitionPolicy: row.requisition_policy,
    defaultReceiptBillingMode: row.default_receipt_billing_mode,
    poChangeEnabled: Boolean(row.po_change_enabled),
    receivingTolerancePolicy: row.receiving_tolerance_policy,
    returnPolicy: row.return_policy,
    prepaymentRequiredDefault: Boolean(row.prepayment_required_default),
    numbering: row.numbering,
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at,
  };
}

export function getActiveParameters(db) {
  const row = db.prepare("SELECT * FROM procurement_parameters WHERE id='DEFAULT'").get();
  if (!row) throw new HttpError(500, '采购参数尚未初始化');
  return dto(row);
}

export function getProcurementParameters(db, res, actor) {
  allowAny(actor, ['PROCUREMENT_CONFIG_VIEW', 'PROCUREMENT_CONFIG_MANAGE']);
  return send(res, 200, { parameters: getActiveParameters(db) });
}

export async function updateProcurementParameters(db, req, res, actor) {
  allow(actor, 'PROCUREMENT_CONFIG_MANAGE');
  const body = await readJson(req);
  assertAllowedFields(body, [
    'sourceControlEnabled', 'quotaEnabled', 'requisitionPolicy', 'defaultReceiptBillingMode',
    'poChangeEnabled', 'receivingTolerancePolicy', 'returnPolicy',
    'prepaymentRequiredDefault', 'numbering',
  ]);
  const before = getActiveParameters(db);
  const next = {
    sourceControlEnabled: body.sourceControlEnabled === undefined ? Number(before.sourceControlEnabled) : booleanFlag(body.sourceControlEnabled, '货源控制'),
    quotaEnabled: body.quotaEnabled === undefined ? Number(before.quotaEnabled) : booleanFlag(body.quotaEnabled, '配额控制'),
    requisitionPolicy: body.requisitionPolicy === undefined ? before.requisitionPolicy : enumValue(body.requisitionPolicy, REQUISITION_POLICIES, '请购策略'),
    defaultReceiptBillingMode: body.defaultReceiptBillingMode === undefined ? before.defaultReceiptBillingMode : enumValue(body.defaultReceiptBillingMode, BILLING_MODES, '默认收货开票模式'),
    poChangeEnabled: body.poChangeEnabled === undefined ? Number(before.poChangeEnabled) : booleanFlag(body.poChangeEnabled, '采购订单变更开关'),
    receivingTolerancePolicy: body.receivingTolerancePolicy === undefined ? before.receivingTolerancePolicy : enumValue(body.receivingTolerancePolicy, TOLERANCE_POLICIES, '收货容差策略'),
    returnPolicy: body.returnPolicy === undefined ? before.returnPolicy : enumValue(body.returnPolicy, RETURN_POLICIES, '退货策略'),
    prepaymentRequiredDefault: body.prepaymentRequiredDefault === undefined ? Number(before.prepaymentRequiredDefault) : booleanFlag(body.prepaymentRequiredDefault, '默认预付款要求'),
    numbering: body.numbering === undefined ? before.numbering : enumValue(body.numbering, NUMBERING_POLICIES, '编号策略'),
  };
  const now = new Date().toISOString();
  transaction(db, () => {
    const authoritative = getActiveParameters(db);
    db.prepare(`UPDATE procurement_parameters SET
      source_control_enabled=?,quota_control_enabled=?,requisition_policy=?,default_receipt_billing_mode=?,
      po_change_enabled=?,receiving_tolerance_policy=?,return_policy=?,prepayment_required_default=?,numbering=?,
      updated_by=?,updated_at=? WHERE id='DEFAULT'`).run(
      next.sourceControlEnabled, next.quotaEnabled, next.requisitionPolicy, next.defaultReceiptBillingMode,
      next.poChangeEnabled, next.receivingTolerancePolicy, next.returnPolicy, next.prepaymentRequiredDefault,
      next.numbering, actor.id, now,
    );
    audit(db, actor.id, 'UPDATE', 'PROCUREMENT_PARAMETER', 'DEFAULT', JSON.stringify({ before: authoritative, after: next }));
  });
  return send(res, 200, { parameters: getActiveParameters(db) });
}
