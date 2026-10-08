import { randomUUID } from 'node:crypto';
import { transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  HttpError, allow, allowAny, assertAllowedFields, readJson, send,
} from '../lib/http.js';

const VIEW_PERMISSIONS = ['VMI_VIEW', 'VMI_MANAGE'];

function assertViewPermission(actor) { allowAny(actor, VIEW_PERMISSIONS); }
function assertManagePermission(actor) { allow(actor, 'VMI_MANAGE'); }

function assertInventoryOwnerDimension() {
  // Cross-domain dependency: physical owner-dimensional mutation must come
  // through the Inventory contract. If the current Inventory domain does not
  // support owner-dimension mutations, the business layer fails closed.
  // The check below is intentionally fail-closed: any missing owner column
  // in canonical inventory valuation prevents the mutation.
  throw new HttpError(
    409,
    'INVENTORY_OWNER_DIMENSION_UNAVAILABLE: 库存 owner 维度尚未上线，VMI 业务层无法触发物理库存变更',
  );
}

function rowToAgreement(row) {
  if (!row) return null;
  return {
    id: row.id,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    minStock: row.min_stock,
    maxStock: row.max_stock,
    reorderLevel: row.reorder_level,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    active: Boolean(row.active),
  };
}

function rowToVmiReceipt(row) {
  if (!row) return null;
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    productId: row.product_id,
    quantity: row.quantity,
    receivedDate: row.received_date,
    businessStatus: row.business_status,
    handlerId: row.handler_id,
    remark: row.remark,
  };
}

export function listVmiAgreements(db, res, actor, url) {
  assertViewPermission(actor);
  const supplierId = url.searchParams.get('supplierId');
  const productId = url.searchParams.get('productId');
  const warehouseId = url.searchParams.get('warehouseId');
  const date = url.searchParams.get('date');
  const where = ['active=1'];
  const params = [];
  if (supplierId) { where.push('supplier_id=?'); params.push(supplierId); }
  if (productId) { where.push('product_id=?'); params.push(productId); }
  if (warehouseId) { where.push('warehouse_id=?'); params.push(warehouseId); }
  if (date) { where.push('effective_from<=? AND (effective_to IS NULL OR effective_to>=?)'); params.push(date, date); }
  const rows = db.prepare(`SELECT * FROM vmi_agreements WHERE ${where.join(' AND ')} ORDER BY effective_from DESC`).all(...params).map(rowToAgreement);
  return send(res, 200, { agreements: rows });
}

export async function createVmiAgreement(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'warehouseId', 'productId', 'minStock', 'maxStock', 'reorderLevel', 'effectiveFrom', 'effectiveTo']);
  if (!body.supplierId || !body.warehouseId || !body.productId) throw new HttpError(400, '供应商、仓库、产品必填');
  if (Number(body.maxStock) < Number(body.minStock)) throw new HttpError(409, '最大库存不能小于最小库存');
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id=? AND outsourcing_enabled=1').get(body.supplierId)) {
    throw new HttpError(409, '供应商未启用委外资质');
  }
  const id = randomUUID(); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO vmi_agreements(id,supplier_id,warehouse_id,product_id,min_stock,max_stock,reorder_level,effective_from,effective_to,active,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, body.supplierId, body.warehouseId, body.productId, Number(body.minStock), Number(body.maxStock), Number(body.reorderLevel || 0), body.effectiveFrom || now.slice(0, 10), body.effectiveTo || null, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'VMI_AGREEMENT', id, `${body.supplierId}:${body.productId}`);
  });
  return send(res, 201, { id });
}

export async function createVmiReceipt(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['supplierId', 'warehouseId', 'productId', 'quantity', 'receivedDate', 'remark', 'idempotencyKey']);
  if (!body.supplierId || !body.warehouseId || !body.productId) throw new HttpError(400, '供应商、仓库、产品必填');
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  // Cross-domain dependency: physical mutation requires Inventory owner dimension.
  assertInventoryOwnerDimension();
  const id = randomUUID(); const now = new Date().toISOString();
  const receiptNo = 'VMI-RCPT-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO vmi_receipts(id,receipt_no,supplier_id,warehouse_id,product_id,quantity,received_date,business_status,handler_id,remark,idempotency_key,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?,?,?,?)`).run(id, receiptNo, body.supplierId, body.warehouseId, body.productId, quantity, body.receivedDate || now.slice(0, 10), actor.id, body.remark || '', body.idempotencyKey || null, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'VMI_RECEIPT', id, receiptNo);
  });
  return send(res, 201, { id, receiptNo });
}

export async function confirmVmiReceipt(db, req, res, actor, receiptId) {
  assertManagePermission(actor);
  const receipt = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, 'VMI 收货不存在');
  if (receipt.business_status !== 'PENDING') throw new HttpError(409, '只有待确认状态可以确认');
  // Cross-domain dependency: physical mutation must go through Inventory owner dimension.
  assertInventoryOwnerDimension();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE vmi_receipts SET business_status=?,updated_at=? WHERE id=?').run('CONFIRMED', now, receiptId);
    audit(db, actor.id, 'CONFIRM', 'VMI_RECEIPT', receiptId, receipt.receipt_no);
  });
  return send(res, 200, { ok: true });
}

export async function createVmiConsumption(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['vmiReceiptId', 'quantity', 'consumedDate', 'destination', 'remark']);
  const receipt = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(body.vmiReceiptId);
  if (!receipt) throw new HttpError(404, 'VMI 收货不存在');
  if (receipt.business_status !== 'CONFIRMED') throw new HttpError(409, '只有已确认收货可以消耗');
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  // Cross-domain dependency: consumption requires Inventory owner dimension.
  assertInventoryOwnerDimension();
  const id = randomUUID(); const now = new Date().toISOString();
  const consumptionNo = 'VMI-CONS-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO vmi_consumptions(id,consumption_no,vmi_receipt_id,quantity,consumed_date,destination,remark,business_status,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(id, consumptionNo, receipt.id, quantity, body.consumedDate || now.slice(0, 10), body.destination || 'PRODUCTION', body.remark || '', actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'VMI_CONSUMPTION', id, consumptionNo);
  });
  return send(res, 201, { id, consumptionNo });
}

export async function transferVmiOwnership(db, req, res, actor) {
  assertManagePermission(actor);
  const body = await readJson(req);
  assertAllowedFields(body, ['vmiReceiptId', 'settlementQuantity', 'settlementAmountCents', 'transferDate', 'supplierBillId']);
  const receipt = db.prepare('SELECT * FROM vmi_receipts WHERE id=?').get(body.vmiReceiptId);
  if (!receipt) throw new HttpError(404, 'VMI 收货不存在');
  if (receipt.business_status !== 'CONFIRMED') throw new HttpError(409, '只有已确认收货可以转移所有权');
  // Idempotency: one ownership transfer per VMI receipt.
  const existing = db.prepare('SELECT id FROM vmi_ownership_transfers WHERE vmi_receipt_id=? AND business_status<>'+ "'CANCELLED'").get(receipt.id);
  if (existing) throw new HttpError(409, '同一 VMI 收货不能重复转移所有权');
  // Cross-domain dependency: physical owner change requires Inventory owner dimension.
  assertInventoryOwnerDimension();
  const id = randomUUID(); const now = new Date().toISOString();
  const transferNo = 'VMI-XFER-' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare(`INSERT INTO vmi_ownership_transfers(id,transfer_no,vmi_receipt_id,settlement_quantity,settlement_amount_cents,transfer_date,business_status,supplier_bill_id,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'PENDING',?,?,?,?)`).run(id, transferNo, receipt.id, Number(body.settlementQuantity), Number(body.settlementAmountCents), body.transferDate || now.slice(0, 10), body.supplierBillId || null, actor.id, now, now);
    db.prepare('UPDATE vmi_receipts SET business_status=?,updated_at=? WHERE id=?').run('TRANSFERRED', now, receipt.id);
    audit(db, actor.id, 'CREATE', 'VMI_OWNERSHIP_TRANSFER', id, transferNo);
  });
  return send(res, 201, { id, transferNo });
}

export function getVmiSummary(db, res, actor, supplierId) {
  assertViewPermission(actor);
  const receipts = db.prepare(`SELECT product_id, SUM(quantity) received_qty FROM vmi_receipts WHERE supplier_id=? AND business_status IN ('CONFIRMED','CONSUMED','TRANSFERRED') GROUP BY product_id`).all(supplierId);
  const consumed = db.prepare(`SELECT r.product_id, SUM(c.quantity) consumed_qty FROM vmi_consumptions c JOIN vmi_receipts r ON r.id=c.vmi_receipt_id WHERE r.supplier_id=? AND c.business_status<>'CANCELLED' GROUP BY r.product_id`).all(supplierId);
  const transferred = db.prepare(`SELECT r.product_id, SUM(t.settlement_quantity) transferred_qty FROM vmi_ownership_transfers t JOIN vmi_receipts r ON r.id=t.vmi_receipt_id WHERE r.supplier_id=? AND t.business_status<>'CANCELLED' GROUP BY r.product_id`).all(supplierId);
  const productMap = new Map();
  for (const r of receipts) productMap.set(r.product_id, { ...productMap.get(r.product_id), productId: r.product_id, received: r.received_qty, consumed: 0, transferred: 0, pendingSettlement: r.received_qty });
  for (const c of consumed) { const m = productMap.get(c.product_id) || { productId: c.product_id, received: 0, consumed: 0, transferred: 0, pendingSettlement: 0 }; m.consumed = c.consumed_qty; productMap.set(c.product_id, m); }
  for (const t of transferred) { const m = productMap.get(t.product_id) || { productId: t.product_id, received: 0, consumed: 0, transferred: 0, pendingSettlement: 0 }; m.transferred = t.transferred_qty; productMap.set(t.product_id, m); }
  const summary = Array.from(productMap.values()).map((m) => ({ ...m, pendingSettlement: Math.max(0, m.received - m.consumed - m.transferred) }));
  return send(res, 200, { summary });
}

export {
  assertInventoryOwnerDimension,
  rowToAgreement,
  rowToVmiReceipt,
};
