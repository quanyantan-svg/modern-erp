// M6 Production Workflow — explicit material issue & production receipt
// documents. Production Order START/COMPLETE remain status transitions
// only and never mutate inventory. Physical inventory movements happen
// here through explicit, auditable DRAFT/CONFIRMED/CANCELLED documents.
//
// Authorization is consolidated to two narrow permissions:
//   PRODUCTION_MATERIAL_ISSUE_MANAGE — 用料出库
//   PRODUCTION_RECEIPT_MANAGE       — 生产入库
// Both are admin-only in the current five-role contract.
//
// Source-type mapping (canonical ledger):
//   PRODUCTION_MATERIAL_ISSUE → inventory_transactions.source_type, direction='OUT'
//   PRODUCTION_RECEIPT        → inventory_transactions.source_type, direction='IN'

import { HttpError, allow, optionalText, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';

const ISSUE_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const RECEIPT_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

const SOURCE_TYPE_ISSUE = 'PRODUCTION_MATERIAL_ISSUE';
const SOURCE_TYPE_RECEIPT = 'PRODUCTION_RECEIPT';

function normalizePositiveQuantity(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label}必须大于 0`);
  return n;
}

function normalizeNonNegativeQuantity(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label}必须为非负数`);
  return n;
}

function loadProductionOrder(db, poId) {
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(poId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  return order;
}

function requireActiveWarehouse(db, warehouseId) {
  const row = db.prepare('SELECT id FROM warehouses WHERE id=? AND active=1').get(warehouseId);
  if (!row) throw new HttpError(400, '请选择有效仓库');
}

function makeMaterialIssueNo() {
  const now = new Date();
  return `PMI-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

function makeProductionReceiptNo() {
  const now = new Date();
  return `PR-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

function normalizeIssueItemsPayload(db, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, '请添加至少一条出库明细');
  const seen = new Set();
  return rawItems.map((item, index) => {
    if (!item || !item.productId || !db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(item.productId)) {
      throw new HttpError(400, `第 ${index + 1} 行物料无效`);
    }
    if (seen.has(item.productId)) throw new HttpError(400, '同一物料不能重复');
    seen.add(item.productId);
    const planned = item.plannedQuantity != null ? normalizeNonNegativeQuantity(item.plannedQuantity, '计划用量') : 0;
    const issue = normalizePositiveQuantity(item.issueQuantity, '本次出库量');
    return { id: id(), productId: item.productId, plannedQuantity: planned, issueQuantity: issue, lineNo: index + 1 };
  });
}

function saveIssueItems(db, issueId, items) {
  db.prepare('DELETE FROM production_material_issue_items WHERE issue_id=?').run(issueId);
  const insert = db.prepare('INSERT INTO production_material_issue_items(id,issue_id,product_id,planned_quantity,issue_quantity,line_no) VALUES(?,?,?,?,?,?)');
  for (const item of items) insert.run(item.id, issueId, item.productId, item.plannedQuantity, item.issueQuantity, item.lineNo);
}

function adjustInventory(db, warehouseId, productId, quantityChange, now) {
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(warehouse_id,product_id) DO UPDATE SET
      quantity=inventory.quantity+excluded.quantity,
      updated_at=excluded.updated_at`).run(id(), warehouseId, productId, quantityChange, now);
  return db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId).quantity;
}

// ============ Material Issue ============

export function listProductionMaterialIssues(db, res, actor, url) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const status = url.searchParams.get('status');
  const params = [];
  const clauses = [];
  const archiveFilter = lifecycleArchiveFilter('PRODUCTION_MATERIAL_ISSUE', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'pi.id' });
  if (archiveFilter.clause) clauses.push(archiveFilter.clause);
  if (status && ISSUE_STATUS[status]) { clauses.push('pi.status=?'); params.push(status); }
  const rows = db.prepare(`SELECT pi.*, po.order_no productionOrderNo, po.status productionOrderStatus,
    p.code productCode, p.name productName,
    w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName,
    (SELECT COUNT(*) FROM production_material_issue_items WHERE issue_id=pi.id) itemCount
    FROM production_material_issues pi
    JOIN production_orders po ON po.id=pi.production_order_id
    JOIN products p ON p.id=po.product_id
    JOIN warehouses w ON w.id=pi.warehouse_id
    JOIN users creator ON creator.id=pi.creator_id
    LEFT JOIN users confirmed ON confirmed.id=pi.confirmed_by
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY pi.created_at DESC LIMIT 100`).all(...params)
    .map((row) => ({ ...row, statusLabel: ISSUE_STATUS[row.status] || row.status }));
  return send(res, 200, { materialIssues: rows });
}

export function getProductionMaterialIssue(db, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const issue = db.prepare(`SELECT pi.*, po.order_no productionOrderNo, po.status productionOrderStatus,
    p.code productCode, p.name productName,
    w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName
    FROM production_material_issues pi
    JOIN production_orders po ON po.id=pi.production_order_id
    JOIN products p ON p.id=po.product_id
    JOIN warehouses w ON w.id=pi.warehouse_id
    JOIN users creator ON creator.id=pi.creator_id
    LEFT JOIN users confirmed ON confirmed.id=pi.confirmed_by
    WHERE pi.id=?`).get(issueId);
  if (!issue) throw new HttpError(404, '用料出库单不存在');
  issue.statusLabel = ISSUE_STATUS[issue.status] || issue.status;
  issue.items = db.prepare(`SELECT mi.*, mi.product_id productId, mi.planned_quantity plannedQuantity,
    mi.issue_quantity issueQuantity, mi.before_quantity beforeQuantity, mi.after_quantity afterQuantity,
    p.code productCode, p.name productName, p.unit
    FROM production_material_issue_items mi
    JOIN products p ON p.id=mi.product_id
    WHERE mi.issue_id=? ORDER BY mi.line_no`).all(issueId);
  return send(res, 200, { materialIssue: issue });
}

export function prefetchMaterialIssueFromBom(db, res, actor, url) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const productionOrderId = url.searchParams.get('productionOrderId');
  if (!productionOrderId) throw new HttpError(400, '请提供生产工单');
  const order = loadProductionOrder(db, productionOrderId);
  if (!order.bom_id) {
    return send(res, 200, {
      productionOrderId: order.id,
      productionOrderNo: order.order_no,
      productCode: db.prepare('SELECT code FROM products WHERE id=?').get(order.product_id)?.code,
      productName: db.prepare('SELECT name FROM products WHERE id=?').get(order.product_id)?.name,
      hasBom: false,
      bomId: null,
      items: [],
    });
  }
  const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(order.bom_id);
  const items = bomItems.map((item) => {
    const required = Number(item.quantity) * Number(order.quantity) * (1 + Number(item.scrap_rate || 0));
    const product = db.prepare('SELECT id, code, name, unit FROM products WHERE id=?').get(item.product_id);
    return {
      productId: item.product_id,
      productCode: product?.code || item.product_id,
      productName: product?.name || '',
      unit: product?.unit || '',
      plannedQuantity: required,
      issueQuantity: required,
    };
  });
  return send(res, 200, {
    productionOrderId: order.id,
    productionOrderNo: order.order_no,
    productCode: db.prepare('SELECT code FROM products WHERE id=?').get(order.product_id)?.code,
    productName: db.prepare('SELECT name FROM products WHERE id=?').get(order.product_id)?.name,
    hasBom: true,
    bomId: order.bom_id,
    items,
  });
}

export async function createProductionMaterialIssue(db, req, res, actor) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const body = await readJson(req);
  if (!body.productionOrderId) throw new HttpError(400, '请选择生产工单');
  const order = loadProductionOrder(db, body.productionOrderId);
  requireActiveWarehouse(db, body.warehouseId);
  const items = normalizeIssueItemsPayload(db, body.items);
  const issueDate = body.issueDate || new Date().toISOString().slice(0, 10);
  const remark = optionalText(body.remark || '', 500);
  const issueId = id();
  const now = new Date().toISOString();
  const issueNo = makeMaterialIssueNo();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,'DRAFT',?,?,?,?,?)`)
      .run(issueId, issueNo, order.id, body.warehouseId, issueDate, remark, actor.id, now, now);
    saveIssueItems(db, issueId, items);
    audit(db, actor.id, 'CREATE', 'MATERIAL_ISSUE', issueId, `创建用料出库 ${issueNo}`);
  });
  return send(res, 201, { id: issueId, issueNo, status: 'DRAFT' });
}

export async function updateProductionMaterialIssue(db, req, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const current = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId);
  if (!current) throw new HttpError(404, '用料出库单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿出库单可以修改');
  const body = await readJson(req);
  if (!body.productionOrderId || body.productionOrderId !== current.production_order_id) {
    throw new HttpError(400, '出库单所关联的生产工单不能变更');
  }
  requireActiveWarehouse(db, body.warehouseId);
  const items = normalizeIssueItemsPayload(db, body.items);
  const issueDate = body.issueDate || current.issue_date || new Date().toISOString().slice(0, 10);
  const remark = optionalText(body.remark || '', 500);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE production_material_issues SET warehouse_id=?, issue_date=?, remark=?, updated_at=? WHERE id=?`)
      .run(body.warehouseId, issueDate, remark, now, issueId);
    saveIssueItems(db, issueId, items);
    audit(db, actor.id, 'UPDATE', 'MATERIAL_ISSUE', issueId, `修改用料出库 ${current.issue_no}`);
  });
  return send(res, 200, { ok: true });
}

export function confirmProductionMaterialIssue(db, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const now = new Date().toISOString();
  transaction(db, () => {
    const locked = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId);
    if (!locked) throw new HttpError(404, '用料出库单不存在');
    if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿出库单可以确认');
    // M6 operational rule: material issue may only be confirmed while the
    // production order is IN_PROGRESS. Historical PENDING orders that were
    // not yet started must be started before material can be issued.
    const order = db.prepare('SELECT status FROM production_orders WHERE id=?').get(locked.production_order_id);
    if (!order) throw new HttpError(409, '关联生产工单不存在');
    if (order.status !== 'IN_PROGRESS') {
      throw new HttpError(409, '只有已开工的生产工单才能确认用料出库');
    }
    const items = db.prepare('SELECT * FROM production_material_issue_items WHERE issue_id=? ORDER BY line_no').all(issueId);
    if (items.length === 0) throw new HttpError(409, '出库单没有明细，无法确认');
    for (const item of items) {
      const beforeRow = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(locked.warehouse_id, item.product_id);
      const before = Number(beforeRow?.quantity || 0);
      if (before < Number(item.issue_quantity)) {
        const product = db.prepare('SELECT code,name FROM products WHERE id=?').get(item.product_id);
        throw new HttpError(409, `${product?.code || item.product_id} 库存不足，需要 ${item.issue_quantity}，实际 ${before.toFixed(3)}`);
      }
      const after = adjustInventory(db, locked.warehouse_id, item.product_id, -Number(item.issue_quantity), now);
      db.prepare('UPDATE production_material_issue_items SET before_quantity=?, after_quantity=? WHERE id=?')
        .run(before, after, item.id);
      db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at)
        VALUES(?,?,?,?,'OUT',?,?,?,?,?,?,?)`)
        .run(id(), locked.warehouse_id, item.product_id, Number(item.issue_quantity), after, SOURCE_TYPE_ISSUE, issueId, locked.issue_no, '用料出库', actor.id, now);
    }
    db.prepare(`UPDATE production_material_issues SET status='CONFIRMED', confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=?`)
      .run(actor.id, now, now, issueId);
    audit(db, actor.id, 'CONFIRM', 'MATERIAL_ISSUE', issueId, `确认用料出库 ${locked.issue_no}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelProductionMaterialIssue(db, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const issue = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId);
  if (!issue) throw new HttpError(404, '用料出库单不存在');
  if (issue.status !== 'DRAFT') throw new HttpError(409, '只有草稿出库单可以取消');
  const now = new Date().toISOString();
  db.prepare("UPDATE production_material_issues SET status='CANCELLED', updated_at=? WHERE id=?")
    .run(now, issueId);
  audit(db, actor.id, 'CANCEL', 'MATERIAL_ISSUE', issueId, `取消用料出库 ${issue.issue_no}`);
  return send(res, 200, { ok: true });
}

// ============ Production Receipt ============

export function listProductionReceipts(db, res, actor, url) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const status = url.searchParams.get('status');
  const params = [];
  const clauses = [];
  const archiveFilter = lifecycleArchiveFilter('PRODUCTION_RECEIPT', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'pr.id' });
  if (archiveFilter.clause) clauses.push(archiveFilter.clause);
  if (status && RECEIPT_STATUS[status]) { clauses.push('pr.status=?'); params.push(status); }
  const rows = db.prepare(`SELECT pr.*, po.order_no productionOrderNo, po.status productionOrderStatus,
    po.quantity plannedQuantity,
    p.code productCode, p.name productName,
    w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName
    FROM production_receipts pr
    JOIN production_orders po ON po.id=pr.production_order_id
    JOIN products p ON p.id=po.product_id
    JOIN warehouses w ON w.id=pr.warehouse_id
    JOIN users creator ON creator.id=pr.creator_id
    LEFT JOIN users confirmed ON confirmed.id=pr.confirmed_by
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY pr.created_at DESC LIMIT 100`).all(...params)
    .map((row) => ({ ...row, statusLabel: RECEIPT_STATUS[row.status] || row.status }));
  return send(res, 200, { productionReceipts: rows });
}

export function getProductionReceipt(db, res, actor, receiptId) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const receipt = db.prepare(`SELECT pr.*, po.order_no productionOrderNo, po.status productionOrderStatus,
    po.quantity plannedQuantity,
    p.code productCode, p.name productName,
    w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName
    FROM production_receipts pr
    JOIN production_orders po ON po.id=pr.production_order_id
    JOIN products p ON p.id=po.product_id
    JOIN warehouses w ON w.id=pr.warehouse_id
    JOIN users creator ON creator.id=pr.creator_id
    LEFT JOIN users confirmed ON confirmed.id=pr.confirmed_by
    WHERE pr.id=?`).get(receiptId);
  if (!receipt) throw new HttpError(404, '生产入库单不存在');
  receipt.statusLabel = RECEIPT_STATUS[receipt.status] || receipt.status;
  receipt.cumulativeReceived = db.prepare("SELECT COALESCE(SUM(quantity),0) total FROM production_receipts WHERE production_order_id=? AND status='CONFIRMED' AND id<>?")
    .get(receipt.production_order_id, receiptId).total;
  return send(res, 200, { productionReceipt: receipt });
}

export async function createProductionReceipt(db, req, res, actor) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const body = await readJson(req);
  if (!body.productionOrderId) throw new HttpError(400, '请选择生产工单');
  const order = loadProductionOrder(db, body.productionOrderId);
  requireActiveWarehouse(db, body.warehouseId);
  const quantity = normalizePositiveQuantity(body.quantity, '本次入库数量');
  const receiptDate = body.receiptDate || new Date().toISOString().slice(0, 10);
  const remark = optionalText(body.remark || '', 500);
  const receiptId = id();
  const now = new Date().toISOString();
  const receiptNo = makeProductionReceiptNo();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_receipts(id,receipt_no,production_order_id,warehouse_id,quantity,status,receipt_date,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?)`)
      .run(receiptId, receiptNo, order.id, body.warehouseId, quantity, receiptDate, remark, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'PRODUCTION_RECEIPT', receiptId, `创建生产入库 ${receiptNo}`);
  });
  return send(res, 201, { id: receiptId, receiptNo, status: 'DRAFT' });
}

export async function updateProductionReceipt(db, req, res, actor, receiptId) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const current = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId);
  if (!current) throw new HttpError(404, '生产入库单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿入库单可以修改');
  const body = await readJson(req);
  if (!body.productionOrderId || body.productionOrderId !== current.production_order_id) {
    throw new HttpError(400, '入库单所关联的生产工单不能变更');
  }
  requireActiveWarehouse(db, body.warehouseId);
  const quantity = normalizePositiveQuantity(body.quantity, '本次入库数量');
  const receiptDate = body.receiptDate || current.receipt_date || new Date().toISOString().slice(0, 10);
  const remark = optionalText(body.remark || '', 500);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`UPDATE production_receipts SET warehouse_id=?, quantity=?, receipt_date=?, remark=?, updated_at=? WHERE id=?`)
      .run(body.warehouseId, quantity, receiptDate, remark, now, receiptId);
    audit(db, actor.id, 'UPDATE', 'PRODUCTION_RECEIPT', receiptId, `修改生产入库 ${current.receipt_no}`);
  });
  return send(res, 200, { ok: true });
}

export function confirmProductionReceipt(db, res, actor, receiptId) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const now = new Date().toISOString();
  transaction(db, () => {
    const locked = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId);
    if (!locked) throw new HttpError(404, '生产入库单不存在');
    if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿入库单可以确认');
    const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(locked.production_order_id);
    if (!order) throw new HttpError(409, '关联生产工单不存在');
    // M6: overproduction is conservative — block when confirmed cumulative
    // receipts would exceed planned order quantity.
    const cumulativeRow = db.prepare("SELECT COALESCE(SUM(quantity),0) total FROM production_receipts WHERE production_order_id=? AND status='CONFIRMED'")
      .get(locked.production_order_id);
    const cumulative = Number(cumulativeRow?.total || 0);
    if (cumulative + Number(locked.quantity) > Number(order.quantity) + 1e-9) {
      throw new HttpError(409, `累计入库 ${cumulative} + 本次 ${locked.quantity} 已超过计划数量 ${order.quantity}`);
    }
    const beforeRow = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(locked.warehouse_id, order.product_id);
    const before = Number(beforeRow?.quantity || 0);
    const after = adjustInventory(db, locked.warehouse_id, order.product_id, Number(locked.quantity), now);
    db.prepare('UPDATE production_receipts SET before_quantity=?, after_quantity=?, status=?, confirmed_by=?, confirmed_at=?, updated_at=? WHERE id=?')
      .run(before, after, 'CONFIRMED', actor.id, now, now, receiptId);
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at)
      VALUES(?,?,?,?,'IN',?,?,?,?,?,?,?)`)
      .run(id(), locked.warehouse_id, order.product_id, Number(locked.quantity), after, SOURCE_TYPE_RECEIPT, receiptId, locked.receipt_no, '生产入库', actor.id, now);
    audit(db, actor.id, 'CONFIRM', 'PRODUCTION_RECEIPT', receiptId, `确认生产入库 ${locked.receipt_no}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelProductionReceipt(db, res, actor, receiptId) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const receipt = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId);
  if (!receipt) throw new HttpError(404, '生产入库单不存在');
  if (receipt.status !== 'DRAFT') throw new HttpError(409, '只有草稿入库单可以取消');
  const now = new Date().toISOString();
  db.prepare("UPDATE production_receipts SET status='CANCELLED', updated_at=? WHERE id=?")
    .run(now, receiptId);
  audit(db, actor.id, 'CANCEL', 'PRODUCTION_RECEIPT', receiptId, `取消生产入库 ${receipt.receipt_no}`);
  return send(res, 200, { ok: true });
}

export const PRODUCTION_WORKFLOW_STATUS_LABELS = { ISSUE: ISSUE_STATUS, RECEIPT: RECEIPT_STATUS };
export const PRODUCTION_WORKFLOW_SOURCE_TYPES = { ISSUE: SOURCE_TYPE_ISSUE, RECEIPT: SOURCE_TYPE_RECEIPT };
