import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';

const VIEW_PERMISSIONS = ['OUTSOURCING_VIEW', 'OUTSOURCING_MANAGE', 'OUTSOURCING_RELEASE'];
const RECEIVE_PERMISSIONS = ['OUTSOURCING_RECEIVING_VIEW', 'OUTSOURCING_RECEIVING_MANAGE'];
const MATERIAL_PERMISSIONS = ['OUTSOURCING_MATERIAL_EXECUTE'];

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'OUTSOURCING_MANAGE'); }
function assertReleasePermission(actor) { allowAny(actor, ['OUTSOURCING_RELEASE', 'OUTSOURCING_MANAGE']); }
function assertMaterialPermission(actor) { allowAny(actor, [...MATERIAL_PERMISSIONS, 'OUTSOURCING_MANAGE']); }
function assertReceivingPermission(actor) { allowAny(actor, [...RECEIVE_PERMISSIONS, 'OUTSOURCING_MANAGE']); }

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
 * Create outsourcing order from PLANNING source: must consume planning_handoff_id exactly-once.
 * planning_handoff_id is UNIQUE in outsourcing_orders.
 */
export async function createOutsourcingOrder(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'productId', 'orderQuantity', 'unit', 'planningHandoffId', 'businessDate', 'expectedCompletionDate', 'remark', 'bomId']);
  const sourceType = body.planningHandoffId ? 'PLANNING' : 'MANUAL';
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
    try {
      db.prepare(`INSERT INTO outsourcing_orders(id,order_no,supplier_id,product_id,order_quantity,required_quantity,unit,source_type,planning_handoff_id,status,business_date,expected_completion_date,bom_id,bom_version,remark,creator_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?,?,?,?)`).run(
        orderId, orderNo, body.supplierId, body.productId, Number(body.orderQuantity), Number(body.orderQuantity), body.unit || 'EA',
        sourceType, body.planningHandoffId || null, body.businessDate || today, body.expectedCompletionDate || null,
        body.bomId || null, body.bomVersion || null, body.remark || '', actor.id, now, now,
      );
    } catch (err) {
      if (/UNIQUE constraint failed: outsourcing_orders.planning_handoff_id/i.test(String(err.message))) {
        throw new HttpError(409, 'planning_handoff_id 已被消费，不得重复');
      }
      throw err;
    }
    audit(db, actor.id, 'CREATE', 'OUTSOURCING_ORDER', orderId, orderNo);
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

export async function snapshotMaterialList(db, req, res, actor, orderId) {
  assertManagePermission(actor);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const body = await readJson(req);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, '物料清单至少需要一行');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('DELETE FROM outsourcing_material_list WHERE order_id=?').run(orderId);
    const stmt = db.prepare('INSERT INTO outsourcing_material_list(id,order_id,product_id,required_quantity,unit,bom_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)');
    items.forEach((item) => {
      stmt.run(randomUUID(), orderId, item.productId, Number(item.requiredQuantity), item.unit || 'EA', JSON.stringify(item.bomSnapshot || {}), now, now);
    });
    audit(db, actor.id, 'SNAPSHOT', 'OUTSOURCING_MATERIAL_LIST', orderId, `物料快照 ${items.length} 行`);
  });
  return send(res, 200, { ok: true, count: items.length });
}

export async function issueMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'fromWarehouseId', 'toWarehouseId', 'issuedDate', 'idempotencyKey']);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (!['RELEASED'].includes(order.status)) throw new HttpError(409, '只有下达状态可发料');
  const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
  if (!material) throw new HttpError(404, '物料清单行不存在');
  const qty = Number(body.quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, '数量必须大于 0');
  const id = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_issues(id,order_id,material_list_id,quantity,issued_date,from_warehouse_id,to_warehouse_id,business_status,idempotency_key,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`).run(id, orderId, body.materialListId, qty, body.issuedDate || now.slice(0, 10), body.fromWarehouseId, body.toWarehouseId, body.idempotencyKey || null, actor.id, now, now);
    db.prepare('UPDATE outsourcing_material_list SET issued_quantity=issued_quantity+?, updated_at=? WHERE id=?').run(qty, now, body.materialListId);
    audit(db, actor.id, 'ISSUE', 'OUTSOURCING_ISSUE', id, `${orderId}:${body.materialListId}:${qty}`);
  });
  return send(res, 201, { id });
}

export async function supplementMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'reason', 'supplementDate']);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
  if (!material) throw new HttpError(404, '物料清单行不存在');
  const id = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_supplements(id,order_id,material_list_id,quantity,reason,supplement_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, orderId, body.materialListId, Number(body.quantity), body.reason || '', body.supplementDate || now.slice(0, 10), actor.id, now);
    db.prepare('UPDATE outsourcing_material_list SET supplemented_quantity=supplemented_quantity+?, updated_at=? WHERE id=?').run(Number(body.quantity), now, body.materialListId);
    audit(db, actor.id, 'SUPPLEMENT', 'OUTSOURCING_SUPPLEMENT', id, body.reason || '');
  });
  return send(res, 201, { id });
}

export async function returnMaterial(db, req, res, actor, orderId) {
  assertMaterialPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['materialListId', 'quantity', 'fromWarehouseId', 'toWarehouseId', 'returnDate']);
  const material = db.prepare('SELECT * FROM outsourcing_material_list WHERE id=? AND order_id=?').get(body.materialListId, orderId);
  if (!material) throw new HttpError(404, '物料清单行不存在');
  const qty = Number(body.quantity);
  const wipRemaining = Number(material.issued_quantity) + Number(material.supplemented_quantity) - Number(material.returned_quantity) - Number(material.backflushed_quantity);
  if (qty > wipRemaining) throw new HttpError(409, '退料数量超过供应商 WIP 剩余');
  const id = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_returns(id,order_id,material_list_id,quantity,from_warehouse_id,to_warehouse_id,return_date,business_status,creator_id,created_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?)`).run(id, orderId, body.materialListId, qty, body.fromWarehouseId, body.toWarehouseId, body.returnDate || now.slice(0, 10), actor.id, now);
    db.prepare('UPDATE outsourcing_material_list SET returned_quantity=returned_quantity+?, updated_at=? WHERE id=?').run(qty, now, body.materialListId);
    audit(db, actor.id, 'RETURN', 'OUTSOURCING_RETURN', id, `${orderId}:${body.materialListId}:${qty}`);
  });
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
  assertAllowedFields(body, ['receiptId']);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  const receipt = db.prepare('SELECT * FROM outsourcing_receipts WHERE id=? AND order_id=?').get(body.receiptId, orderId);
  if (!receipt) throw new HttpError(404, '委外收货不存在');
  // Lock receipt row for atomic calculation
  const cumulativeFinished = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM outsourcing_receipts WHERE order_id=? AND business_status<>'CANCELLED'").get(orderId).q);
  const materials = db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=?').all(orderId);
  const now = new Date().toISOString();
  const results = [];
  transaction(db, () => {
    for (const m of materials) {
      const targetCumulative = Number(m.required_quantity) * cumulativeFinished / Number(order.order_quantity);
      const incremental = targetCumulative - Number(m.backflushed_quantity);
      const netSupplied = Number(m.issued_quantity) + Number(m.supplemented_quantity) - Number(m.returned_quantity);
      const remaining = netSupplied - Number(m.backflushed_quantity);
      if (incremental < 0) {
        throw new HttpError(409, `BACKFLUSH_INSUFFICIENT_SUPPLY: 行 ${m.id} 增量小于 0`);
      }
      if (incremental > remaining + 1e-9) {
        throw new HttpError(409, `BACKFLUSH_INSUFFICIENT_SUPPLY: 行 ${m.id} 净供应不足`);
      }
      if (incremental <= 0) {
        results.push({ materialListId: m.id, incremental: 0 });
        continue;
      }
      db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=backflushed_quantity+?, updated_at=? WHERE id=?').run(incremental, now, m.id);
      audit(db, actor.id, 'BACKFLUSH', 'OUTSOURCING_BACKFLUSH', m.id, `+${incremental}`);
      results.push({ materialListId: m.id, incremental });
    }
  });
  return send(res, 200, { ok: true, cumulativeFinished, results });
}

export async function createOutsourcingReceipt(db, req, res, actor) {
  assertReceivingPermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['orderId', 'quantity', 'receivedDate', 'processingFeeCents', 'processingPoId', 'remark']);
  const order = db.prepare('SELECT * FROM outsourcing_orders WHERE id=?').get(body.orderId);
  if (!order) throw new HttpError(404, '委外订单不存在');
  if (!['RELEASED'].includes(order.status)) throw new HttpError(409, '只有下达状态可收货');
  const id = randomUUID(); const now = new Date().toISOString();
  const receiptNo = 'OS-RCPT-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO outsourcing_receipts(id,receipt_no,order_id,processing_po_id,quantity,received_date,supplier_id,business_status,processing_fee_cents,total_cost_cents,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?,?)`).run(id, receiptNo, body.orderId, body.processingPoId || null, Number(body.quantity), body.receivedDate || now.slice(0, 10), order.supplier_id, Number(body.processingFeeCents || 0), Number(body.processingFeeCents || 0), actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'OUTSOURCING_RECEIPT', id, receiptNo);
  });
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
