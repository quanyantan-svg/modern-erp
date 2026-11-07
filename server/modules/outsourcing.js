import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit, auditBusinessRejection } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';
import { executeOutsourcingBackflush, executeOutsourcingMove } from './outsourcing-inventory.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { createPurchaseOrderDraftCanonical } from './procurement-orders.js';

const VIEW_PERMISSIONS = ['OUTSOURCING_VIEW', 'OUTSOURCING_MANAGE', 'OUTSOURCING_RELEASE'];
const MATERIAL_PERMISSIONS = ['OUTSOURCING_MATERIAL_EXECUTE'];

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'OUTSOURCING_MANAGE'); }
function assertReleasePermission(actor) { allowAny(actor, ['OUTSOURCING_RELEASE', 'OUTSOURCING_MANAGE']); }
function assertMaterialPermission(actor) { allowAny(actor, MATERIAL_PERMISSIONS); }
function assertReceivingPermission(actor) { allow(actor, 'OUTSOURCING_RECEIVING_MANAGE'); }

function businessConflict(code, message) {
  return new HttpError(409, message, { code });
}

// 加工费金额输入口径（M1C-WP2–WP6-R1 / P1）：复用既有“安全整数分 + 非负”规则，
// 并拒绝非法字符串的隐式转换。NaN / Infinity / 负数 / 非安全整数 / 溢出都必须
// 在进入收货与成品估值之前被拒绝；未提供时沿用既有收货合同按 0 处理。
function outsourcingAmountCents(value, label) {
  if (value === undefined || value === null) return 0;
  let candidate;
  if (typeof value === 'number') {
    candidate = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    candidate = Number(value);
  } else {
    throw new HttpError(400, `${label}必须是非负安全整数分`, { code: 'OUTSOURCING_RECEIPT_AMOUNT_INVALID' });
  }
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new HttpError(400, `${label}必须是非负安全整数分`, { code: 'OUTSOURCING_RECEIPT_AMOUNT_INVALID' });
  }
  return candidate;
}

/**
 * OUTSOURCE 完工通知行的剩余容量占用（M1C-WP2–WP6-R1 / P0-01）。
 *
 * 权威口径（Active Design §5.2.2、Requirement MC-REQ-02 / MC-REQ-09）：
 *   通知行数量 ≥ 同一通知行的历史有效收货占用量 + 本次拟收货量
 *
 * - 按**真实通知行 ID** 逐行累计，不按整个订单粗略分配；
 * - 待检（`PENDING_INSPECTION`）与已生效（`EFFECTED`）都仍占用来源容量，
 *   只有 `CANCELLED` 不占用；
 * - 历史收货若无法证明其通知行来源（`source_notice_item_source_id` 为 NULL 或
 *   指向已不存在的通知行），该通知行的剩余容量**不可证明** ⇒ fail closed。
 */
function outsourcingNoticeLineUsage(db, orderId) {
  const rows = db.prepare(`SELECT ori.source_notice_item_source_id notice_item_id,
      SUM(ori.quantity) quantity,
      MAX(CASE WHEN rni.id IS NULL THEN 1 ELSE 0 END) unprovable
    FROM outsourcing_receipt_items ori
    JOIN outsourcing_receipts orc ON orc.id = ori.receipt_id
    LEFT JOIN receipt_notice_items rni ON rni.id = ori.source_notice_item_source_id
    WHERE orc.order_id=? AND orc.business_status<>'CANCELLED'
    GROUP BY ori.source_notice_item_source_id`).all(orderId);
  const usage = new Map();
  let unprovable = false;
  for (const row of rows) {
    if (Number(row.unprovable) > 0 || !row.notice_item_id) {
      unprovable = true;
      continue;
    }
    usage.set(row.notice_item_id, Number(row.quantity));
  }
  return { usage, unprovable };
}

function auditRejectedBusinessRule(db, actor, entityType, entityId, action, error) {
  auditBusinessRejection(db, actor, { entityType, entityId: entityId || null, action }, error);
}

const LIFECYCLE_NEXT = {
  DRAFT: 'PLAN_CONFIRMED',
  PLAN_CONFIRMED: 'RELEASED',
  RELEASED: 'COMPLETED',
  COMPLETED: 'CLOSED',
};

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    supplierId: row.supplier_id,
    productId: row.product_id,
    orderQuantity: row.order_quantity,
    requiredQuantity: row.required_quantity,
    unit: row.unit,
    sourceType: row.source_type,
    planningHandoffId: row.planning_handoff_id,
    status: row.status,
    businessDate: row.business_date,
    expectedCompletionDate: row.expected_completion_date,
    bomId: row.bom_id,
    bomVersion: row.bom_version,
  };
}

function rowToMaterialList(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    requiredQuantity: row.required_quantity,
    unit: row.unit,
    issuedQuantity: row.issued_quantity,
    supplementedQuantity: row.supplemented_quantity,
    returnedQuantity: row.returned_quantity,
    backflushedQuantity: row.backflushed_quantity,
    bomSnapshot: row.bom_snapshot_json ? JSON.parse(row.bom_snapshot_json) : null,
    supplierWipRemaining: Math.max(0, Number(row.issued_quantity) + Number(row.supplemented_quantity) - Number(row.returned_quantity) - Number(row.backflushed_quantity)),
  };
}

export function listOutsourcingOrders(db, res, actor, url) {
  assertViewPermission(actor);
  const status = url.searchParams.get('status');
  const where = [];
  const params = [];
  if (status) { where.push('status=?'); params.push(status); }
  const orders = db.prepare(`SELECT * FROM outsourcing_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 100`).all(...params).map(rowToOrder);
  return send(res, 200, { outsourcingOrders: orders });
}

export function getOutsourcingOrder(db, res, actor, orderId) {
  assertViewPermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(orderId).map(rowToMaterialList);
  const issues = db.prepare("SELECT * FROM outsourcing_issues WHERE order_id=?").all(orderId);
  const supplements = db.prepare("SELECT * FROM outsourcing_supplements WHERE order_id=?").all(orderId);
  const returns = db.prepare("SELECT * FROM outsourcing_returns WHERE order_id=?").all(orderId);
  const receipts = db.prepare("SELECT * FROM outsourcing_receipts WHERE order_id=?").all(orderId);
  return send(res, 200, { outsourcingOrder: rowToOrder(order), materials, issues, supplements, returns, receipts });
}

/**
 * OUT-05: Consume one `planning_outsource_handoffs` row exactly-once.
 *
 * Authoritative invariants:
 *   - handoff.status MUST be 'PENDING' on consume (else 409 already consumed)
 *   - no row may exist in `outsourcing_orders` where planning_handoff_id = id (UNIQUE)
 *   - handoff.status is moved to 'CONSUMED' with target_outsourcing_order_id,
 *     consumed_at, consumed_by set
 *   - For PLANNING source orders, the canonical product / quantity / need_date
 *     are derived from the handoff row, NOT from client-supplied values.
 *
 * Returns the authoritative handoff row plus caller-supplied order fields.
 * Re-throws HTTP 404 / 409 for missing / already-consumed handoffs.
 */
function consumePlanningHandoff(db, { handoffId, actor, supplierId, bodyOrderId, bodyOrderNo, bodyBusinessDate, bodyExpectedCompletionDate, bodyBomId, bodyBomVersion, bodyRemark }) {
  // Lock handoff row for atomic consume (works on both SQLite BEGIN IMMEDIATE
  // and MySQL SELECT ... FOR UPDATE rows once wrapped in `transaction(db, …)`).
  db.prepare(`UPDATE planning_outsource_handoffs SET id=id WHERE id=?`).run(handoffId);
  const handoff = db.prepare('SELECT * FROM planning_outsource_handoffs WHERE id=?').get(handoffId);
  if (!handoff) throw new HttpError(404, '计划移交单不存在');
  if (handoff.status !== 'PENDING') {
    throw new HttpError(409, `handoff 已不可消费：status=${handoff.status}`);
  }
  const existingOrder = db.prepare('SELECT id FROM outsourcing_orders WHERE planning_handoff_id=?').get(handoffId);
  if (existingOrder) {
    throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
  }
  // Authoritative product / quantity / need_date come from the handoff.
  // Client-supplied values for these fields are IGNORED on PLANNING source.
  const orderId = bodyOrderId;
  const orderNo = bodyOrderNo;
  const now = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO outsourcing_orders(id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,planning_handoff_id,status,business_date,expected_completion_date,bom_id,bom_version,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?)`).run(
      orderId, orderNo, supplierId, handoff.product_id, Number(handoff.quantity), Number(handoff.quantity), 'EA',
      'PLANNING', handoffId, bodyBusinessDate || now.slice(0, 10), bodyExpectedCompletionDate || handoff.need_date || null,
      bodyBomId || null, bodyBomVersion || null, bodyRemark || '', actor.id, now, now,
    );
  } catch (err) {
    if (/UNIQUE constraint failed: outsourcing_orders.planning_handoff_id/i.test(String(err.message))) {
      throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
    }
    throw err;
  }
  // Mark the handoff CONSUMED. Even if the order is later CANCELLED, the
  // handoff must remain CONSUMED — Planning truth is immutable; produce a
  // fresh planned order → fresh handoff if a new ORDER is needed.
  db.prepare(`UPDATE planning_outsource_handoffs
    SET status='CONSUMED', target_outsourcing_order_id=?, consumed_at=?, consumed_by=?
    WHERE id=? AND status='PENDING'`).run(orderId, now, actor.id, handoffId);
  audit(db, actor.id, 'CONSUMED', 'PLANNING_OUTSOURCE_HANDOFF', handoffId, `→ ${orderId}`);
  return { handoff };
}

/**
 * Create outsourcing order.
 *
 *   source_type='PLANNING': consume `planning_outsource_handoffs(id)` exactly-once.
 *                           Authoritative product / quantity / need_date are
 *                           taken from the handoff row.
 *   source_type='MANUAL':   planning_handoff_id MUST be NULL; client supplies
 *                           all canonical order fields.
 */
export async function createOutsourcingOrder(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'orderQuantity', 'unit', 'planningHandoffId', 'businessDate', 'expectedCompletionDate', 'remark', 'bomId']);
  const hasHandoff = Boolean(body.planningHandoffId);
  const sourceType = hasHandoff ? 'PLANNING' : 'MANUAL';
  if (sourceType === 'MANUAL' && hasHandoff) throw new HttpError(400, 'MANUAL 订单不允许携带 planningHandoffId');
  // Supplier must be qualified for outsourcing.
  const supplier = db.prepare('SELECT id, qualification_status, qualification_valid_from, qualification_valid_to FROM suppliers WHERE id=? AND outsourcing_enabled=1').get(body.supplierId);
  if (!supplier) throw new HttpError(409, '供应商未启用委外资质');
  const today = new Date().toISOString().slice(0, 10);
  if (supplier.qualification_status !== 'QUALIFIED' || (supplier.qualification_valid_to && supplier.qualification_valid_to < today)) {
    throw new HttpError(409, '委外供应商资质无效或已过期');
  }
  const orderId = randomUUID(); const now = new Date().toISOString();
  const orderNo = 'OS-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    if (sourceType === 'PLANNING') {
      consumePlanningHandoff(db, {
        handoffId: body.planningHandoffId, actor,
        supplierId: body.supplierId,
        bodyOrderId: orderId, bodyOrderNo: orderNo,
        bodyBusinessDate: body.businessDate, bodyExpectedCompletionDate: body.expectedCompletionDate,
        bodyBomId: body.bomId, bodyBomVersion: body.bomVersion, bodyRemark: body.remark,
      });
    } else {
      // MANUAL source: canonical fields come from the client body.
      try {
        db.prepare(`INSERT INTO outsourcing_orders(id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,planning_handoff_id,status,business_date,expected_completion_date,bom_id,bom_version,remark,creator_id,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,NULL,'DRAFT',?,?,?,?,?,?,?,?)`).run(
          orderId, orderNo, body.supplierId, body.productId, Number(body.orderQuantity), Number(body.orderQuantity), body.unit || 'EA',
          sourceType, body.businessDate || today, body.expectedCompletionDate || null,
          body.bomId || null, body.bomVersion || null, body.remark || '', actor.id, now, now,
        );
      } catch (err) {
        if (/UNIQUE constraint failed: outsourcing_orders.planning_handoff_id/i.test(String(err.message))) {
          throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
        }
        throw err;
      }
      audit(db, actor.id, 'CREATE', 'OUTSOURCING_ORDER', orderId, orderNo);
    }
  });
  return send(res, 201, { id: orderId, orderNo });
}

export async function transitionOutsourcingOrder(db, req, res, actor, orderId) {
  assertReleasePermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const body = await readJson(req);
  const action = String(body.action || '').toUpperCase();
  const next = LIFECYCLE_NEXT[order.status];
  if (!next) throw new HttpError(409, '当前状态不可推进');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE outsourcing_orders SET status=?,updated_at=? WHERE id=?').run(next, now, orderId);
    audit(db, actor.id, action || next, 'OUTSOURCING_ORDER', orderId, next);
  });
  return send(res, 200, { ok: true, status: next });
}

export async function cancelOutsourcingOrder(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (!['DRAFT', 'PLAN_CONFIRMED'].includes(order.status)) throw new HttpError(409, '当前状态不可取消');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE outsourcing_orders SET status=?,updated_at=? WHERE id=?').run('CANCELLED', now, orderId);
    audit(db, actor.id, 'CANCEL', 'OUTSOURCING_ORDER', orderId, order.order_no);
  });
  return send(res, 200, { ok: true });
}

const PROCESSING_PO_BUSINESS_FIELDS = ['unitPriceCents', 'orderDate', 'expectedDeliveryDate', 'paymentTerms',
  'supplierContactName', 'supplierContactPhone', 'supplierAddress', 'remark'];

// 加工费 PO 创建的规范化 fingerprint（Active Design §6）：
// 只含路由委外订单 ID 与规范化商业输入；可选文本 trim 后缺省为空，
// 日期统一 YYYY-MM-DD|null，单价为安全整数；不含 actor/tenant 与服务端主数据快照。
function normalizeProcessingPoFingerprint(orderId, body) {
  const text = (value) => (value === undefined || value === null ? '' : String(value).trim());
  const date = (value) => {
    const raw = text(value);
    return raw === '' ? null : raw;
  };
  const unitPriceCents = Number(body.unitPriceCents);
  return {
    outsourcingOrderId: String(orderId),
    unitPriceCents: Number.isSafeInteger(unitPriceCents) ? unitPriceCents : null,
    orderDate: date(body.orderDate),
    expectedDeliveryDate: date(body.expectedDeliveryDate),
    paymentTerms: text(body.paymentTerms),
    supplierContactName: text(body.supplierContactName),
    supplierContactPhone: text(body.supplierContactPhone),
    supplierAddress: text(body.supplierAddress),
    remark: text(body.remark),
  };
}

export async function createOutsourcingProcessingPurchaseOrder(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, PROCESSING_PO_BUSINESS_FIELDS);
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key 必填');
  const unitPriceCents = Number(body.unitPriceCents);
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new HttpError(400, '加工费单价必须为非负安全整数分');
  const fingerprint = requestFingerprint(normalizeProcessingPoFingerprint(orderId, body));
  const operation = 'OUTSOURCING_PROCESSING_PO_CREATE';
  try {
    const replay = idempotencyReplay(db, operation, orderId, idempotencyKey, fingerprint);
    if (replay) return send(res, 200, { ...replay, replayed: true });
  } catch (error) {
    if (error?.status !== 409) throw error;
    const conflict = new HttpError(409, error.message, { code: 'PROCESSING_PO_IDEMPOTENCY_CONFLICT' });
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '创建加工费采购订单', conflict);
    throw conflict;
  }
  let result;
  try {
    transaction(db, () => {
      db.prepare('UPDATE outsourcing_orders SET updated_at=updated_at WHERE id=?').run(orderId);
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      if (!order) throw new HttpError(404, '委外订单不存在');
      if (order.status !== 'RELEASED') throw businessConflict('PROCESSING_PO_SOURCE_STATE_INVALID', '只有已下达委外订单可以创建加工费采购订单');
      if (db.prepare('SELECT id FROM purchase_orders WHERE source_outsourcing_order_id=?').get(orderId)) {
        throw businessConflict('OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS', '该委外订单终身已创建加工费采购订单，不得重建');
      }
      const supplier = db.prepare(`SELECT * FROM suppliers WHERE id=? AND active=1 AND outsourcing_enabled=1`).get(order.supplier_id);
      const today = new Date().toISOString().slice(0, 10);
      if (!supplier || supplier.qualification_status !== 'QUALIFIED'
        || (supplier.qualification_valid_from && supplier.qualification_valid_from > today)
        || (supplier.qualification_valid_to && supplier.qualification_valid_to < today)) {
        throw businessConflict('PROCESSING_PO_SUPPLIER_NOT_QUALIFIED', '委外供应商资质无效');
      }
      const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(order.product_id);
      if (!product) throw businessConflict('PROCESSING_PO_PRODUCT_INVALID', '委外成品不存在或已停用');
      const quantity = Number(order.order_quantity);
      const amountCents = Math.round(quantity * unitPriceCents);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(amountCents)) {
        throw new HttpError(400, '委外数量或加工费金额无法精确表示');
      }
      const unitCode = String(product.base_uom_code || product.unit || order.unit || 'EA').toUpperCase();
      const quantityNum = Number.isSafeInteger(quantity) ? quantity : null;
      if (quantityNum === null) throw businessConflict('PROCESSING_PO_QUANTITY_UNSUPPORTED', '首期加工费采购订单仅支持整数基础数量');
      result = createPurchaseOrderDraftCanonical(db, actor, {
        supplierId: order.supplier_id, totalCents: amountCents, businessType: 'OUTSOURCE_PROCESSING',
        sourceOutsourcingOrderId: order.id, orderDate: body.orderDate || today,
        expectedDeliveryDate: body.expectedDeliveryDate || order.expected_completion_date || null,
        paymentTerms: body.paymentTerms || '', paymentTermsDays: supplier.default_payment_terms_days ?? null,
        supplierContactName: body.supplierContactName || supplier.contact || '',
        supplierContactPhone: body.supplierContactPhone || supplier.phone || '', supplierAddress: body.supplierAddress || supplier.address || '',
        supplierContactSnapshot: `${body.supplierContactName || supplier.contact || ''}|${body.supplierContactPhone || supplier.phone || ''}`,
        supplierAddressSnapshot: body.supplierAddress || supplier.address || '', paymentTermsSnapshot: body.paymentTerms || '',
        remark: body.remark || '', auditDetail: `由委外订单 ${order.order_no} 创建加工费采购订单草稿`,
        items: [{ productId: order.product_id, quantity, unitPriceCents, amountCents, lineNo: 1,
          documentUomCode: unitCode, documentQuantityNumerator: quantityNum, documentQuantityDenominator: 1,
          conversionNumerator: 1, conversionDenominator: 1, baseQuantityNumerator: quantityNum, baseQuantityDenominator: 1 }],
      });
      saveIdempotency(db, operation, orderId, idempotencyKey, fingerprint, result);
    });
  } catch (error) {
    if (/source_outsourcing_order_id|uq_purchase_orders_source_outsourcing/i.test(String(error.message))) {
      error = businessConflict('OUTSOURCING_PROCESSING_PO_ALREADY_EXISTS', '该委外订单终身已创建加工费采购订单，不得重建');
    }
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '创建加工费采购订单', error);
    throw error;
  }
  return send(res, 201, result);
}

export async function snapshotMaterialList(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const body = await readJson(req);
  assertAllowedFields(body, ['items']);
  const bindings = Array.isArray(body.items) ? body.items : [];
  if (!order.bom_id) throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外订单未绑定已批准 OUTSOURCE BOM');
  const bom = db.prepare(`SELECT * FROM boms WHERE id=? AND product_id=? AND status='ACTIVE'
    AND approval_status='APPROVED' AND purpose='OUTSOURCE'
    AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?)`).get(
    order.bom_id, order.product_id, order.business_date, order.business_date,
  );
  if (!bom || (order.bom_version != null && Number(order.bom_version) !== Number(bom.version))) {
    throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外 BOM 未批准、未生效、用途不符或版本不一致');
  }
  const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no,id').all(bom.id);
  if (!bomItems.length) throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外 BOM 没有有效用料行');
  const bindingByProduct = new Map(bindings.map((item) => [item.productId, item]));
  for (const item of bomItems) {
    if (Number(item.scrap_rate || 0) !== 0
      || Number(item.conversion_numerator || 1) !== 1
      || Number(item.conversion_denominator || 1) !== 1) {
      throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '首期不支持 BOM 损耗或单位换算');
    }
    const product = db.prepare('SELECT base_uom_code,unit FROM products WHERE id=? AND active=1').get(item.product_id);
    const unit = String(item.uom_code_snapshot || product?.base_uom_code || product?.unit || 'EA').toUpperCase();
    const base = String(product?.base_uom_code || product?.unit || 'EA').toUpperCase();
    if (!product || unit !== base) throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', 'BOM 用料单位与产品基础单位不一致');
    const binding = bindingByProduct.get(item.product_id);
    if (!binding?.sourceWarehouseId) throw businessConflict('OUTSOURCING_WIP_SOURCE_WAREHOUSE_UNPROVEN', `物料 ${item.product_id} 缺少来源仓绑定`);
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(binding.sourceWarehouseId)) {
      throw businessConflict('OUTSOURCING_WIP_WAREHOUSE_MISSING', `物料 ${item.product_id} 来源仓不存在或已停用`);
    }
  }
  const now = new Date().toISOString();
  try {
    transaction(db, () => {
      if (db.prepare('SELECT 1 FROM outsourcing_material_list WHERE order_id=? LIMIT 1').get(orderId)) {
        throw businessConflict('OUTSOURCING_MATERIAL_SNAPSHOT_IMMUTABLE', '委外用料快照已建立，不得随 BOM 变化重写');
      }
      const stmt = db.prepare(`INSERT INTO outsourcing_material_list(
        id,order_id,product_id,required_quantity,unit,bom_snapshot_json,source_warehouse_id,legacy_unverified_wip_quantity,identity_evidence_state,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,0,'NONE',?,?)`);
      bomItems.forEach((item) => {
        const product = db.prepare('SELECT base_uom_code,unit FROM products WHERE id=?').get(item.product_id);
        const unit = String(item.uom_code_snapshot || product.base_uom_code || product.unit || 'EA').toUpperCase();
        const perUnitQuantity = Number(item.quantity);
        const requiredQuantity = perUnitQuantity * Number(order.order_quantity);
        stmt.run(randomUUID(), orderId, item.product_id, requiredQuantity, unit,
          JSON.stringify({ bomId: bom.id, bomVersion: bom.version, bomItemId: item.id, per_unit_quantity: perUnitQuantity, required_quantity: requiredQuantity }),
          bindingByProduct.get(item.product_id).sourceWarehouseId, now, now);
      });
      audit(db, actor.id, 'SNAPSHOT', 'OUTSOURCING_MATERIAL_LIST', orderId, `OUTSOURCE BOM ${bom.id} 快照 ${bomItems.length} 行`);
    });
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '建立委外用料快照', error);
    throw error;
  }
  return send(res, 200, { ok: true, count: bomItems.length });
}

// 委外材料动作的规范化 fingerprint：可选身份字段缺省与 null 等价，
// 键序固定，避免等价请求被误判为"同键异内容"。
function normalizeMaterialFingerprint(body) {
  const identity = (value) => (value === undefined || value === null ? '' : String(value).trim());
  return {
    materialListId: String(body.materialListId || ''),
    quantity: Number(body.quantity),
    lotId: identity(body.lotId),
    serialId: identity(body.serialId),
  };
}

// 历史物料行的 `legacy_unverified_wip_quantity` 为 NULL 表示"历史不可验证"
// （Active Design §10）；这类行不得被新的负向动作（退料/倒冲）消费。
function assertWipHistoryProvable(material) {
  if (material.legacy_unverified_wip_quantity === null || material.legacy_unverified_wip_quantity === undefined) {
    throw businessConflict('OUTSOURCING_WIP_HISTORY_UNPROVEN', '该委外物料行的历史 WIP 不可证明，不得被新的转出或倒冲消费');
  }
}

export async function issueMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'issuedDate', 'idempotencyKey', 'lotId', 'serialId']);
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_ISSUE';
  const fingerprint = requestFingerprint(normalizeMaterialFingerprint(body));
  let replay;
  try {
    replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外发料', error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const id = randomUUID(); const now = new Date().toISOString(); const businessDate = body.issuedDate || now.slice(0, 10);
  try {
    transaction(db, () => {
      const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
      if (!order) throw new HttpError(404, '委外订单不存在');
      if (!['RELEASED'].includes(order.status)) throw businessConflict('OUTSOURCING_ORDER_STATE_INVALID', '只有下达状态可发料');
      const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
      if (!material) throw new HttpError(404, '物料清单行不存在');
      const movement = executeOutsourcingMove(db, { actor, order, material, sourceType: 'OUTSOURCING_ISSUE', eventType: 'ISSUE', eventId: id, quantity: qty, businessDate, identityInput: body, direction: 'SUPPLY' });
      db.prepare(`INSERT INTO outsourcing_issues(id,order_id,material_list_id,quantity,issued_date,from_warehouse_id,to_warehouse_id,business_status,idempotency_key,creator_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`).run(id, orderId, body.materialListId, qty, businessDate, movement.fromWarehouseId, movement.toWarehouseId, body.idempotencyKey, actor.id, now, now);
      db.prepare("UPDATE outsourcing_material_list SET issued_quantity=issued_quantity+?,identity_evidence_state='VERIFIED',updated_at=? WHERE id=?").run(qty, now, body.materialListId);
      audit(db, actor.id, 'ISSUE', 'OUTSOURCING_ISSUE', id, `${orderId}:${body.materialListId}:${qty}`);
      saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { id });
    });
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外发料', error);
    throw error;
  }
  return send(res, 201, { id });
}

export async function supplementMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'reason', 'supplementDate', 'idempotencyKey', 'lotId', 'serialId']);
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_SUPPLEMENT';
  const fingerprint = requestFingerprint(normalizeMaterialFingerprint(body));
  let replay;
  try {
    replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外补料', error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const id = randomUUID(); const now = new Date().toISOString(); const businessDate = body.supplementDate || now.slice(0, 10);
  try { transaction(db, () => {
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    if (!['RELEASED'].includes(order.status)) throw businessConflict('OUTSOURCING_ORDER_STATE_INVALID', '只有下达状态可补料');
    const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
    if (!material) throw new HttpError(404, '物料清单行不存在');
    const movement = executeOutsourcingMove(db, { actor, order, material, sourceType: 'OUTSOURCING_SUPPLEMENT', eventType: 'SUPPLEMENT', eventId: id, quantity: qty, businessDate, identityInput: body, direction: 'SUPPLY' });
    db.prepare(`INSERT INTO outsourcing_supplements(id,order_id,material_list_id,quantity,reason,supplement_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, orderId, body.materialListId, qty, body.reason || '', businessDate, actor.id, now);
    db.prepare("UPDATE outsourcing_material_list SET supplemented_quantity=supplemented_quantity+?,identity_evidence_state='VERIFIED',updated_at=? WHERE id=?").run(qty, now, body.materialListId);
    audit(db, actor.id, 'SUPPLEMENT', 'OUTSOURCING_SUPPLEMENT', id, body.reason || '');
    saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { id });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外补料', error); throw error; }
  return send(res, 201, { id });
}

export async function returnMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'returnDate', 'idempotencyKey', 'lotId', 'serialId']);
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_RETURN';
  const fingerprint = requestFingerprint(normalizeMaterialFingerprint(body));
  let replay;
  try {
    replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  } catch (error) {
    auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外退料', error);
    throw error;
  }
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const id = randomUUID(); const now = new Date().toISOString(); const businessDate = body.returnDate || now.slice(0, 10);
  try { transaction(db, () => {
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
    if (!material) throw new HttpError(404, '物料清单行不存在');
    assertWipHistoryProvable(material);
    const wipRemaining = Number(material.issued_quantity) + Number(material.supplemented_quantity)
      - Number(material.returned_quantity) - Number(material.backflushed_quantity);
    if (qty > wipRemaining + 1e-9) throw businessConflict('OUTSOURCING_WIP_INSUFFICIENT', '退料数量超过供应商 WIP 剩余');
    const movement = executeOutsourcingMove(db, { actor, order, material, sourceType: 'OUTSOURCING_RETURN', eventType: 'RETURN', eventId: id, quantity: qty, businessDate, identityInput: body, direction: 'CONSUME' });
    db.prepare(`INSERT INTO outsourcing_returns(id,order_id,material_list_id,quantity,from_warehouse_id,to_warehouse_id,return_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, orderId, body.materialListId, qty, movement.fromWarehouseId, movement.toWarehouseId, businessDate, actor.id, now);
    db.prepare('UPDATE outsourcing_material_list SET returned_quantity=returned_quantity+?, updated_at=? WHERE id=?').run(qty, now, body.materialListId);
    audit(db, actor.id, 'RETURN', 'OUTSOURCING_RETURN', id, `${orderId}:${body.materialListId}:${qty}`);
    saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { id });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', orderId, '委外退料', error); throw error; }
  return send(res, 201, { id });
}

/**
 * Per-material cumulative backflush. Backflush target for each material list row:
 *   target_cumulative_i = required_i × cumulative_confirmed_finished_receipt_qty / order_quantity
 *   incremental_i = target_cumulative_i - already_backflushed_i
 * Guards: incremental_i >= 0 AND incremental_i <= (net_supplied_i - already_backflushed_i)
 * Materials of different UOM/scale must NEVER be aggregated.
 */
export async function backflushMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['receiptId', 'identities', 'idempotencyKey']);
  if (!body.idempotencyKey) throw new HttpError(400, 'idempotencyKey 必填');
  const operation = 'OUTSOURCING_BACKFLUSH';
  const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, operation, orderId, body.idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const identities = new Map((Array.isArray(body.identities) ? body.identities : []).map((item) => [item.materialListId, item]));
  const now = new Date().toISOString();
  const results = [];
  let cumulativeFinished = 0;
  try { transaction(db, () => {
    const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
    if (!order) throw new HttpError(404, '委外订单不存在');
    const lockedReceipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=? AND order_id=?').get(body.receiptId, orderId);
    if (!lockedReceipt || lockedReceipt.business_status !== 'EFFECTED') throw businessConflict('OUTSOURCING_RECEIPT_NOT_EFFECTED', '仅已生效收货可执行倒冲复核');
    cumulativeFinished = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status='EFFECTED'").get(orderId).q);
    const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? ORDER BY id').all(orderId);
    for (const m of materials) {
      assertWipHistoryProvable(m);
      // 增量倒冲基数必须与收货生效路径同口径：每单位用量 × 累计合格收货量。
      const snapshot = JSON.parse(m.bom_snapshot_json || '{}');
      if (!Number.isFinite(Number(snapshot.per_unit_quantity)) || !Number.isFinite(Number(snapshot.required_quantity))
        || Math.abs(Number(snapshot.required_quantity) - Number(m.required_quantity)) > 1e-9) {
        throw businessConflict('OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED', '委外用料快照缺少已批准的每单位/总量基数');
      }
      const targetCumulative = Number(snapshot.per_unit_quantity) * cumulativeFinished;
      const incremental = targetCumulative - Number(m.backflushed_quantity);
      const netSupplied = Number(m.issued_quantity) + Number(m.supplemented_quantity) - Number(m.returned_quantity);
      const remaining = netSupplied - Number(m.backflushed_quantity);
      if (incremental < 0) {
        throw businessConflict('OUTSOURCING_WIP_INSUFFICIENT', `行 ${m.id} 增量倒冲数量小于 0`);
      }
      if (incremental > remaining + 1e-9) {
        throw businessConflict('OUTSOURCING_WIP_INSUFFICIENT', `行 ${m.id} 净供应不足`);
      }
      if (incremental <= 0) {
        results.push({ materialListId: m.id, incremental: 0 });
        continue;
      }
      const execution = executeOutsourcingBackflush(db, { actor, order, material: m, receipt: lockedReceipt, quantity: incremental, businessDate: lockedReceipt.business_date || lockedReceipt.received_date || now.slice(0, 10), identityInput: identities.get(m.id) || {} });
      db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=backflushed_quantity+?, updated_at=? WHERE id=?').run(incremental, now, m.id);
      audit(db, actor.id, 'BACKFLUSH', 'OUTSOURCING_BACKFLUSH', m.id, `+${incremental}`);
      results.push({ materialListId: m.id, incremental, carryingValueCents: execution.valuation.issuedValueCents });
    }
    saveIdempotency(db, operation, orderId, body.idempotencyKey, fingerprint, { ok: true, cumulativeFinished, results });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_RECEIPT', body.receiptId, '委外倒冲', error); throw error; }
  return send(res, 200, { ok: true, cumulativeFinished, results });
}

export async function createOutsourcingReceipt(db, req, res, actor) {
  assertReceivingPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['orderId', 'quantity', 'receivedDate', 'businessDate', 'processingFeeCents', 'processingPoId', 'sourceNoticeId', 'warehouseId', 'items', 'remark']);
  if (!Array.isArray(body.items) || !body.items.length) {
    throw new HttpError(400, '委外收货明细不能为空', { code: 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED' });
  }
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey) throw new HttpError(400, 'Idempotency-Key 必填');
  const operation = 'OUTSOURCING_RECEIPT_CREATE';
  const documentId = `create-request:${idempotencyKey}`;
  const fingerprint = requestFingerprint(body);
  const replay = idempotencyReplay(db, operation, documentId, idempotencyKey, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (!['RELEASED'].includes(order.status)) throw new HttpError(409, '只有下达状态可收货');
  const quantity = Number(body.quantity);
  const itemQuantity = body.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || body.items.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
    throw new HttpError(400, '委外收货数量必须大于 0');
  }
  if (Math.abs(quantity - itemQuantity) > 1e-9) throw new HttpError(400, '收货表头数量必须等于明细数量之和');
  if (!body.processingPoId || !body.sourceNoticeId || !body.warehouseId) throw new HttpError(400, '委外收货必须提供加工费 PO、完工通知和目标仓库');
  const processingFeeCents = outsourcingAmountCents(body.processingFeeCents, '加工费金额');
  const itemUnitPriceCents = body.items.map((item, index) => outsourcingAmountCents(item.unitPriceCents, `第 ${index + 1} 行单价`));
  const id = randomUUID(); const now = new Date().toISOString();
  const receiptNo = 'OS-RCPT-' + Date.now().toString().slice(-10);
  try { transaction(db, () => {
    const lockedOrder = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.orderId);
    if (!lockedOrder || lockedOrder.status !== 'RELEASED') throw businessConflict('OUTSOURCING_RECEIPT_SOURCE_MISMATCH', '委外订单状态已变化');
    const processingPo = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(body.processingPoId);
    const processingPoItems = processingPo ? db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY line_no').all(processingPo.id) : [];
    if (!processingPo || processingPo.status !== 'APPROVED' || processingPo.business_type !== 'OUTSOURCE_PROCESSING'
      || processingPo.source_outsourcing_order_id !== lockedOrder.id || processingPo.supplier_id !== lockedOrder.supplier_id
      || processingPoItems.length !== 1) {
      throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '加工费 PO 与委外订单来源不匹配');
    }
    const notice = db.prepare('SELECT * FROM receipt_notices WHERE id=?').get(body.sourceNoticeId);
    if (!notice || notice.business_type !== 'OUTSOURCE' || notice.outsourcing_order_id !== lockedOrder.id
      || notice.processing_po_id !== processingPo.id || notice.supplier_id !== lockedOrder.supplier_id
      || notice.warehouse_id !== body.warehouseId || notice.status !== 'CONFIRMED') {
      throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '委外完工通知与订单/加工费 PO/仓库不匹配');
    }
    if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(body.warehouseId)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '目标仓库不存在或已停用');
    const existingQuantity = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status<>'CANCELLED'").get(lockedOrder.id).q);
    if (existingQuantity + quantity > Number(lockedOrder.order_quantity) + 1e-9) throw businessConflict('RECEIPT_NOTICE_CAPACITY_EXCEEDED', '委外累计收货数量超过订单容量');
    // 通知行剩余容量（M1C-WP2–WP6-R1 / P0-01）：同一完工通知行的历史有效收货
    // 占用量 + 本次拟收货量必须 <= 通知行数量。权威口径在事务内重读。
    const noticeLine = outsourcingNoticeLineUsage(db, lockedOrder.id);
    if (noticeLine.unprovable) {
      throw businessConflict('RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN', '委外收货历史来源不可证明，无法证明完工通知行剩余容量');
    }
    db.prepare(`INSERT INTO outsourcing_receipts(
      id,receipt_no,order_id,processing_po_id,quantity,received_date,supplier_id,business_status,
      processing_fee_cents,total_cost_cents,creator_id,created_at,updated_at,warehouse_id,source_notice_id,business_date,version
    ) VALUES(?,?,?,?,?,?,?,'PENDING_INSPECTION',?,?,?,?,?,?,?,?,0)`).run(
      id, receiptNo, lockedOrder.id, processingPo.id, quantity, body.receivedDate || now.slice(0, 10), lockedOrder.supplier_id,
      processingFeeCents, processingFeeCents, actor.id, now, now,
      body.warehouseId, notice.id, body.businessDate || body.receivedDate || now.slice(0, 10),
    );
    const insertItem = db.prepare(`INSERT INTO outsourcing_receipt_items(
      id,receipt_id,product_id,quantity,unit_price_cents,line_no,lot_id,serial_id,unit_code,processing_po_item_id,source_notice_item_source_id
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const seenNoticeItems = new Set();
    body.items.forEach((item, index) => {
      assertAllowedFields(item, ['productId', 'quantity', 'unitCode', 'unitPriceCents', 'processingPoItemId', 'sourceNoticeItemId', 'lotId', 'serialId']);
      const poItem = db.prepare('SELECT * FROM purchase_order_items WHERE id=? AND order_id=?').get(item.processingPoItemId, processingPo.id);
      const noticeItem = db.prepare('SELECT * FROM receipt_notice_items WHERE id=? AND notice_id=?').get(item.sourceNoticeItemId, notice.id);
      const product = db.prepare('SELECT tracking_policy,base_uom_code,unit FROM products WHERE id=? AND active=1').get(item.productId);
      const unitCode = String(item.unitCode || product?.base_uom_code || product?.unit || 'EA').toUpperCase();
      const baseUnit = String(product?.base_uom_code || product?.unit || 'EA').toUpperCase();
      if (!poItem || !noticeItem || !product || poItem.product_id !== item.productId || noticeItem.product_id !== item.productId
        || noticeItem.purchase_order_item_id !== poItem.id || item.productId !== lockedOrder.product_id
        || unitCode !== baseUnit || (poItem.document_uom_code && unitCode !== String(poItem.document_uom_code).toUpperCase())
        || seenNoticeItems.has(noticeItem.id)) {
        throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', `第 ${index + 1} 行来源、产品或单位不匹配`);
      }
      // 通知行剩余容量按真实通知行 ID 逐行累计：历史占用 + 本次拟收货 <= 通知行数量。
      const noticeLineQuantity = Number(noticeItem.quantity);
      const noticeLineUsed = Number(noticeLine.usage.get(noticeItem.id) || 0);
      const requestedQuantity = Number(item.quantity);
      if (noticeLineUsed + requestedQuantity > noticeLineQuantity + 1e-9) {
        throw businessConflict('RECEIPT_NOTICE_CAPACITY_EXCEEDED',
          `第 ${index + 1} 行超过完工通知行剩余容量：通知行 ${noticeLineQuantity}、已占用 ${noticeLineUsed}、本次 ${requestedQuantity}`);
      }
      noticeLine.usage.set(noticeItem.id, noticeLineUsed + requestedQuantity);
      if (product.tracking_policy === 'LOT' && (!item.lotId || item.serialId)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', 'LOT 成品必须提供批次身份');
      if (product.tracking_policy === 'SERIAL' && (!item.serialId || item.lotId || Number(item.quantity) !== 1)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', 'SERIAL 成品必须逐行提供唯一序列号');
      if (product.tracking_policy === 'NONE' && (item.lotId || item.serialId)) throw businessConflict('OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH', '非跟踪成品不得携带 LOT/SERIAL');
      seenNoticeItems.add(noticeItem.id);
      insertItem.run(randomUUID(), id, item.productId, Number(item.quantity), itemUnitPriceCents[index], index + 1,
        item.lotId || null, item.serialId || null, unitCode, poItem.id, noticeItem.id);
    });
    audit(db, actor.id, 'CREATE', 'OUTSOURCING_RECEIPT', id, `${receiptNo} 待检，${body.items.length} 行`);
    saveIdempotency(db, operation, documentId, idempotencyKey, fingerprint, { id, receiptNo });
  }); } catch (error) { auditRejectedBusinessRule(db, actor, 'OUTSOURCING_ORDER', body.orderId, '创建委外收货', error); throw error; }
  return send(res, 201, { id, receiptNo });
}

export function getMaterialPosition(db, res, actor, orderId) {
  assertViewPermission(actor);
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(orderId).map(rowToMaterialList);
  return send(res, 200, { materials });
}

export {
  rowToOrder,
  rowToMaterialList,
};
