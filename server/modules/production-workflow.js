// V1.3 Phase 4 — authoritative production stock execution.
import { HttpError, allow, optionalText, readJson, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { lifecycleArchiveFilter } from './lifecycle-engine.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';

const EPS = 1e-9;
const STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const SOURCE = { ISSUE: 'PRODUCTION_MATERIAL_ISSUE', RETURN: 'PRODUCTION_MATERIAL_RETURN', RECEIPT: 'PRODUCTION_RECEIPT', RECEIPT_REVERSAL: 'PRODUCTION_RECEIPT_REVERSAL' };
const positive = (value, label) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label}必须大于 0`); return n; };
const loadOrder = (db, orderId) => { const row = db.prepare('SELECT * FROM production_orders WHERE id=?').get(orderId); if (!row) throw new HttpError(404, '生产工单不存在'); return row; };
const requireInProgress = (order) => { if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '只有生产中的制令单允许执行库存作业'); };
const requireWarehouse = (db, warehouseId) => { if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) throw new HttpError(400, '请选择有效仓库'); };
const docNo = (prefix) => `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
const inventoryQty = (db, warehouseId, productId) => Number(db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId)?.quantity || 0);

function adjustInventory(db, warehouseId, productId, delta, now) {
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(warehouse_id,product_id) DO UPDATE SET quantity=inventory.quantity+excluded.quantity,updated_at=excluded.updated_at`)
    .run(id(), warehouseId, productId, delta, now);
  return inventoryQty(db, warehouseId, productId);
}

function postLedger(db, x) {
  db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_line_id,source_no,remark,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id(), x.warehouseId, x.productId, x.quantity, x.direction,
    inventoryQty(db, x.warehouseId, x.productId), x.sourceType, x.sourceId, x.sourceLineId || null, x.sourceNo, x.remark, x.actorId, x.now);
}

export function productionRequirementSummary(db, orderId) {
  return db.prepare(`SELECT r.*,p.code productCode,p.name productName,p.unit,
    COALESCE((SELECT SUM(i.issue_quantity) FROM production_material_issue_items i JOIN production_material_issues h ON h.id=i.issue_id WHERE i.requirement_line_id=r.id AND h.status='CONFIRMED'),0)
    -COALESCE((SELECT SUM(i.quantity) FROM production_material_return_items i JOIN production_material_returns h ON h.id=i.return_id WHERE i.requirement_line_id=r.id AND h.status='CONFIRMED'),0) netIssued
    FROM production_order_items r JOIN products p ON p.id=r.product_id WHERE r.order_id=? ORDER BY r.line_no`).all(orderId).map((r) => ({
      ...r, requiredQuantity: Number(r.quantity), quantityPerUnit: Number(r.quantity_per_unit), netIssued: Number(r.netIssued),
      remainingQuantity: Math.max(0, Number(r.quantity) - Number(r.netIssued)),
    }));
}

export function productionNetReceived(db, orderId) {
  const received = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) total FROM production_receipts WHERE production_order_id=? AND status='CONFIRMED'").get(orderId).total);
  const reversed = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) total FROM production_receipt_reversals WHERE production_order_id=? AND status='CONFIRMED'").get(orderId).total);
  return received - reversed;
}

function resolveRequirement(db, orderId, raw, index) {
  let requirement;
  if (raw.requirementLineId) requirement = db.prepare('SELECT * FROM production_order_items WHERE id=? AND order_id=?').get(raw.requirementLineId, orderId);
  else if (raw.productId) { const rows = db.prepare('SELECT * FROM production_order_items WHERE order_id=? AND product_id=?').all(orderId, raw.productId); if (rows.length === 1) requirement = rows[0]; }
  if (!requirement) throw new HttpError(400, `第 ${index + 1} 行不是制令单的有效物料需求行`);
  if (raw.productId && raw.productId !== requirement.product_id) throw new HttpError(400, `第 ${index + 1} 行物料与需求行不匹配`);
  return requirement;
}

function issueItems(db, orderId, rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new HttpError(400, '请添加至少一条出库明细');
  const seen = new Set();
  return rawItems.map((raw, index) => { const r = resolveRequirement(db, orderId, raw || {}, index); if (seen.has(r.id)) throw new HttpError(400, '同一需求行不能重复'); seen.add(r.id); return { id: id(), requirementLineId: r.id, productId: r.product_id, plannedQuantity: Number(r.quantity), issueQuantity: positive(raw.issueQuantity, '本次出库量'), lineNo: index + 1 }; });
}

function saveIssueItems(db, issueId, items) {
  db.prepare('DELETE FROM production_material_issue_items WHERE issue_id=?').run(issueId);
  const stmt = db.prepare('INSERT INTO production_material_issue_items(id,issue_id,requirement_line_id,product_id,planned_quantity,issue_quantity,line_no) VALUES(?,?,?,?,?,?,?)');
  for (const x of items) stmt.run(x.id, issueId, x.requirementLineId, x.productId, x.plannedQuantity, x.issueQuantity, x.lineNo);
}

export function listProductionMaterialIssues(db, res, actor, url) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const status = url.searchParams.get('status'); const clauses = []; const params = [];
  const archive = lifecycleArchiveFilter('PRODUCTION_MATERIAL_ISSUE', { includeArchived: url.searchParams.get('includeArchived') === 'true', idExpression: 'pi.id' });
  if (archive.clause) clauses.push(archive.clause); if (status && STATUS[status]) { clauses.push('pi.status=?'); params.push(status); }
  const rows = db.prepare(`SELECT pi.*,po.order_no productionOrderNo,po.status productionOrderStatus,p.code productCode,p.name productName,w.code warehouseCode,w.name warehouseName,
    creator.display_name creatorName,confirmed.display_name confirmedByName,(SELECT COUNT(*) FROM production_material_issue_items WHERE issue_id=pi.id) itemCount
    FROM production_material_issues pi JOIN production_orders po ON po.id=pi.production_order_id JOIN products p ON p.id=po.product_id JOIN warehouses w ON w.id=pi.warehouse_id
    JOIN users creator ON creator.id=pi.creator_id LEFT JOIN users confirmed ON confirmed.id=pi.confirmed_by ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY pi.created_at DESC LIMIT 100`).all(...params);
  return send(res, 200, { materialIssues: rows.map((r) => ({ ...r, statusLabel: STATUS[r.status] || r.status })) });
}

export function getProductionMaterialIssue(db, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const issue = db.prepare(`SELECT pi.*,po.order_no productionOrderNo,po.status productionOrderStatus,p.code productCode,p.name productName,w.code warehouseCode,w.name warehouseName,
    creator.display_name creatorName,confirmed.display_name confirmedByName FROM production_material_issues pi JOIN production_orders po ON po.id=pi.production_order_id JOIN products p ON p.id=po.product_id
    JOIN warehouses w ON w.id=pi.warehouse_id JOIN users creator ON creator.id=pi.creator_id LEFT JOIN users confirmed ON confirmed.id=pi.confirmed_by WHERE pi.id=?`).get(issueId);
  if (!issue) throw new HttpError(404, '用料出库单不存在'); issue.statusLabel = STATUS[issue.status] || issue.status;
  issue.items = db.prepare(`SELECT i.*,i.requirement_line_id requirementLineId,i.product_id productId,i.planned_quantity plannedQuantity,i.issue_quantity issueQuantity,
    i.before_quantity beforeQuantity,i.after_quantity afterQuantity,p.code productCode,p.name productName,p.unit FROM production_material_issue_items i JOIN products p ON p.id=i.product_id WHERE i.issue_id=? ORDER BY i.line_no`).all(issueId);
  return send(res, 200, { materialIssue: issue });
}

export function prefetchMaterialIssueFromBom(db, res, actor, url) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const order = loadOrder(db, url.searchParams.get('productionOrderId')); const warehouseId = url.searchParams.get('warehouseId');
  const items = productionRequirementSummary(db, order.id).map((x) => ({ requirementLineId: x.id, productId: x.product_id, productCode: x.productCode, productName: x.productName, unit: x.unit, plannedQuantity: x.requiredQuantity, netIssuedQuantity: x.netIssued, remainingQuantity: x.remainingQuantity, currentStock: warehouseId ? inventoryQty(db, warehouseId, x.product_id) : Number(db.prepare('SELECT COALESCE(SUM(quantity),0) total FROM inventory WHERE product_id=?').get(x.product_id).total), issueQuantity: x.remainingQuantity }));
  return send(res, 200, { productionOrderId: order.id, productionOrderNo: order.order_no, productCode: db.prepare('SELECT code FROM products WHERE id=?').get(order.product_id)?.code, productName: db.prepare('SELECT name FROM products WHERE id=?').get(order.product_id)?.name, hasBom: items.length > 0, bomId: order.bom_id, items });
}

export async function createProductionMaterialIssue(db, req, res, actor) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const body = await readJson(req); const order = loadOrder(db, body.productionOrderId); requireInProgress(order); requireWarehouse(db, body.warehouseId);
  const items = issueItems(db, order.id, body.items); const issueId = id(); const issueNo = docNo('PMI'); const now = new Date().toISOString();
  transaction(db, () => { db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,'DRAFT',?,?,?,?,?)").run(issueId, issueNo, order.id, body.warehouseId, body.issueDate || now.slice(0, 10), optionalText(body.remark || '', 500), actor.id, now, now); saveIssueItems(db, issueId, items); audit(db, actor.id, 'CREATE', 'MATERIAL_ISSUE', issueId, `创建用料出库 ${issueNo}`); });
  return send(res, 201, { id: issueId, issueNo, status: 'DRAFT' });
}

export async function updateProductionMaterialIssue(db, req, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const current = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId); if (!current) throw new HttpError(404, '用料出库单不存在'); if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿出库单可以修改');
  const body = await readJson(req); if (body.productionOrderId !== current.production_order_id) throw new HttpError(400, '出库单来源制令单不可变更'); requireInProgress(loadOrder(db, current.production_order_id)); requireWarehouse(db, body.warehouseId); const items = issueItems(db, current.production_order_id, body.items); const now = new Date().toISOString();
  transaction(db, () => { db.prepare('UPDATE production_material_issues SET warehouse_id=?,issue_date=?,remark=?,updated_at=? WHERE id=?').run(body.warehouseId, body.issueDate || current.issue_date, optionalText(body.remark || '', 500), now, issueId); saveIssueItems(db, issueId, items); audit(db, actor.id, 'UPDATE', 'MATERIAL_ISSUE', issueId, `修改用料出库 ${current.issue_no}`); }); return send(res, 200, { ok: true });
}

export function confirmProductionMaterialIssue(db, req, res, actor, issueId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const now = new Date().toISOString(); const key = String(req.headers['idempotency-key'] || `document-${issueId}`); const fingerprint = requestFingerprint({ action: 'confirm' }); const replay = idempotencyReplay(db, 'MATERIAL_ISSUE_CONFIRM', issueId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => { const issue = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId); if (!issue) throw new HttpError(404, '用料出库单不存在'); if (issue.status !== 'DRAFT') throw new HttpError(409, '只有草稿出库单可以确认'); requireInProgress(loadOrder(db, issue.production_order_id));
    const rows = db.prepare('SELECT * FROM production_material_issue_items WHERE issue_id=? ORDER BY line_no').all(issueId); if (!rows.length) throw new HttpError(409, '出库单没有明细'); const summary = new Map(productionRequirementSummary(db, issue.production_order_id).map((x) => [x.id, x]));
    for (const row of rows) { const r = summary.get(row.requirement_line_id); if (!r || r.product_id !== row.product_id) throw new HttpError(409, '用料需求来源已失效'); if (Number(row.issue_quantity) > r.remainingQuantity + EPS) throw new HttpError(409, `${r.productCode} 剩余可领 ${r.remainingQuantity}，本次 ${row.issue_quantity} 超出`); const stock = inventoryQty(db, issue.warehouse_id, row.product_id); if (stock + EPS < Number(row.issue_quantity)) throw new HttpError(409, `${r.productCode} 库存不足，需要 ${row.issue_quantity}，实际 ${stock}`); }
    for (const row of rows) { const before = inventoryQty(db, issue.warehouse_id, row.product_id); const after = adjustInventory(db, issue.warehouse_id, row.product_id, -Number(row.issue_quantity), now); db.prepare('UPDATE production_material_issue_items SET before_quantity=?,after_quantity=? WHERE id=?').run(before, after, row.id); postLedger(db, { warehouseId: issue.warehouse_id, productId: row.product_id, quantity: Number(row.issue_quantity), direction: 'OUT', sourceType: SOURCE.ISSUE, sourceId: issue.id, sourceLineId: row.id, sourceNo: issue.issue_no, remark: '用料出库', actorId: actor.id, now }); }
    db.prepare("UPDATE production_material_issues SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, issue.id); saveIdempotency(db, 'MATERIAL_ISSUE_CONFIRM', issueId, key, fingerprint, { ok: true, id: issueId, status: 'CONFIRMED' }); audit(db, actor.id, 'CONFIRM', 'MATERIAL_ISSUE', issue.id, `确认用料出库 ${issue.issue_no}`); }); return send(res, 200, { ok: true });
}

export function cancelProductionMaterialIssue(db, res, actor, issueId) { allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const x = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId); if (!x) throw new HttpError(404, '用料出库单不存在'); if (x.status !== 'DRAFT') throw new HttpError(409, '只有草稿出库单可以取消'); db.prepare("UPDATE production_material_issues SET status='CANCELLED',updated_at=? WHERE id=?").run(new Date().toISOString(), issueId); audit(db, actor.id, 'CANCEL', 'MATERIAL_ISSUE', issueId, `取消用料出库 ${x.issue_no}`); return send(res, 200, { ok: true }); }
export function deleteProductionMaterialIssue(db, res, actor, issueId) { allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const x = db.prepare('SELECT * FROM production_material_issues WHERE id=?').get(issueId); if (!x) throw new HttpError(404, '用料出库单不存在'); if (!['DRAFT', 'CANCELLED'].includes(x.status)) throw new HttpError(409, '已确认出库单不可删除，请使用生产退料'); transaction(db, () => { db.prepare('DELETE FROM production_material_issues WHERE id=?').run(issueId); audit(db, actor.id, 'DELETE', 'MATERIAL_ISSUE', issueId, `删除未过账用料出库 ${x.issue_no}`); }); return send(res, 200, { ok: true }); }

export async function createProductionMaterialReturn(db, req, res, actor) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const body = await readJson(req); const issue = db.prepare("SELECT * FROM production_material_issues WHERE id=? AND status='CONFIRMED'").get(body.originalIssueId); if (!issue) throw new HttpError(409, '只能对已确认用料出库创建退料'); requireInProgress(loadOrder(db, issue.production_order_id)); if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, '请添加退料明细');
  const items = body.items.map((raw, i) => { const original = db.prepare('SELECT * FROM production_material_issue_items WHERE id=? AND issue_id=?').get(raw.originalIssueItemId, issue.id); if (!original) throw new HttpError(400, `第 ${i + 1} 行原出库明细无效`); return { id: id(), original, quantity: positive(raw.quantity, '退料数量'), lineNo: i + 1 }; }); const returnId = id(); const returnNo = docNo('PMR'); const now = new Date().toISOString();
  transaction(db, () => { db.prepare("INSERT INTO production_material_returns(id,return_no,original_issue_id,production_order_id,warehouse_id,status,return_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?)").run(returnId, returnNo, issue.id, issue.production_order_id, issue.warehouse_id, body.returnDate || now.slice(0, 10), optionalText(body.remark || '', 500), actor.id, now, now); const stmt = db.prepare('INSERT INTO production_material_return_items(id,return_id,original_issue_item_id,requirement_line_id,product_id,quantity,line_no) VALUES(?,?,?,?,?,?,?)'); for (const x of items) stmt.run(x.id, returnId, x.original.id, x.original.requirement_line_id, x.original.product_id, x.quantity, x.lineNo); audit(db, actor.id, 'CREATE', 'MATERIAL_RETURN', returnId, `创建生产退料 ${returnNo}`); }); return send(res, 201, { id: returnId, returnNo, status: 'DRAFT' });
}

export function confirmProductionMaterialReturn(db, res, actor, returnId) {
  allow(actor, 'PRODUCTION_MATERIAL_ISSUE_MANAGE'); const now = new Date().toISOString(); transaction(db, () => { const h = db.prepare('SELECT * FROM production_material_returns WHERE id=?').get(returnId); if (!h) throw new HttpError(404, '生产退料单不存在'); if (h.status !== 'DRAFT') throw new HttpError(409, '只有草稿退料单可以确认'); requireInProgress(loadOrder(db, h.production_order_id)); const items = db.prepare('SELECT * FROM production_material_return_items WHERE return_id=?').all(returnId);
    for (const x of items) { const original = db.prepare(`SELECT i.*,h.production_order_id,h.warehouse_id,h.status issue_status FROM production_material_issue_items i JOIN production_material_issues h ON h.id=i.issue_id WHERE i.id=?`).get(x.original_issue_item_id); if (!original || original.issue_status !== 'CONFIRMED' || original.production_order_id !== h.production_order_id || original.warehouse_id !== h.warehouse_id || original.product_id !== x.product_id || original.requirement_line_id !== x.requirement_line_id) throw new HttpError(409, '退料来源与原出库不匹配'); const returned = Number(db.prepare("SELECT COALESCE(SUM(i.quantity),0) total FROM production_material_return_items i JOIN production_material_returns h ON h.id=i.return_id WHERE i.original_issue_item_id=? AND h.status='CONFIRMED'").get(original.id).total); if (returned + Number(x.quantity) > Number(original.issue_quantity) + EPS) throw new HttpError(409, '退料数量超过原出库未退数量'); }
    for (const x of items) { const before = inventoryQty(db, h.warehouse_id, x.product_id); const after = adjustInventory(db, h.warehouse_id, x.product_id, Number(x.quantity), now); db.prepare('UPDATE production_material_return_items SET before_quantity=?,after_quantity=? WHERE id=?').run(before, after, x.id); postLedger(db, { warehouseId: h.warehouse_id, productId: x.product_id, quantity: Number(x.quantity), direction: 'IN', sourceType: SOURCE.RETURN, sourceId: h.id, sourceLineId: x.id, sourceNo: h.return_no, remark: '生产退料', actorId: actor.id, now }); }
    db.prepare("UPDATE production_material_returns SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, returnId); audit(db, actor.id, 'CONFIRM', 'MATERIAL_RETURN', returnId, `确认生产退料 ${h.return_no}`); }); return send(res, 200, { ok: true });
}

export function listProductionReceipts(db, res, actor, url) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const status = url.searchParams.get('status'); const params = []; const where = status && STATUS[status] ? (params.push(status), 'WHERE pr.status=?') : ''; const rows = db.prepare(`SELECT pr.*,po.order_no productionOrderNo,po.status productionOrderStatus,po.quantity plannedQuantity,p.code productCode,p.name productName,w.code warehouseCode,w.name warehouseName,creator.display_name creatorName,confirmed.display_name confirmedByName FROM production_receipts pr JOIN production_orders po ON po.id=pr.production_order_id JOIN products p ON p.id=pr.product_id JOIN warehouses w ON w.id=pr.warehouse_id JOIN users creator ON creator.id=pr.creator_id LEFT JOIN users confirmed ON confirmed.id=pr.confirmed_by ${where} ORDER BY pr.created_at DESC LIMIT 100`).all(...params); return send(res, 200, { productionReceipts: rows.map((x) => ({ ...x, statusLabel: STATUS[x.status] || x.status })) }); }

export function getProductionReceipt(db, res, actor, receiptId) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const x = db.prepare(`SELECT pr.*,po.order_no productionOrderNo,po.status productionOrderStatus,po.quantity plannedQuantity,p.code productCode,p.name productName,w.code warehouseCode,w.name warehouseName,creator.display_name creatorName,confirmed.display_name confirmedByName FROM production_receipts pr JOIN production_orders po ON po.id=pr.production_order_id JOIN products p ON p.id=pr.product_id JOIN warehouses w ON w.id=pr.warehouse_id JOIN users creator ON creator.id=pr.creator_id LEFT JOIN users confirmed ON confirmed.id=pr.confirmed_by WHERE pr.id=?`).get(receiptId); if (!x) throw new HttpError(404, '生产入库单不存在'); x.statusLabel = STATUS[x.status] || x.status; x.cumulativeReceived = productionNetReceived(db, x.production_order_id); return send(res, 200, { productionReceipt: x }); }

export async function createProductionReceipt(db, req, res, actor) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const body = await readJson(req); const order = loadOrder(db, body.productionOrderId); requireInProgress(order); requireWarehouse(db, body.warehouseId); const quantity = positive(body.quantity, '本次入库数量'); if (body.productId && body.productId !== order.product_id) throw new HttpError(400, '生产入库成品与制令单不匹配'); const receiptId = id(); const receiptNo = docNo('PR'); const now = new Date().toISOString(); transaction(db, () => { db.prepare("INSERT INTO production_receipts(id,receipt_no,production_order_id,product_id,warehouse_id,quantity,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'DRAFT',?,?,?,?,?)").run(receiptId, receiptNo, order.id, order.product_id, body.warehouseId, quantity, body.receiptDate || now.slice(0, 10), optionalText(body.remark || '', 500), actor.id, now, now); audit(db, actor.id, 'CREATE', 'PRODUCTION_RECEIPT', receiptId, `创建生产入库 ${receiptNo}`); }); return send(res, 201, { id: receiptId, receiptNo, status: 'DRAFT' }); }

export async function updateProductionReceipt(db, req, res, actor, receiptId) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const x = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId); if (!x) throw new HttpError(404, '生产入库单不存在'); if (x.status !== 'DRAFT') throw new HttpError(409, '只有草稿入库单可以修改'); const body = await readJson(req); if (body.productionOrderId !== x.production_order_id) throw new HttpError(400, '生产入库来源制令单不可变更'); requireInProgress(loadOrder(db, x.production_order_id)); requireWarehouse(db, body.warehouseId); db.prepare('UPDATE production_receipts SET warehouse_id=?,quantity=?,receipt_date=?,remark=?,updated_at=? WHERE id=?').run(body.warehouseId, positive(body.quantity, '本次入库数量'), body.receiptDate || x.receipt_date, optionalText(body.remark || '', 500), new Date().toISOString(), receiptId); audit(db, actor.id, 'UPDATE', 'PRODUCTION_RECEIPT', receiptId, `修改生产入库 ${x.receipt_no}`); return send(res, 200, { ok: true }); }

function assertReceiptCoverage(db, order, quantity) { const next = productionNetReceived(db, order.id) + quantity; if (next > Number(order.quantity) + EPS) throw new HttpError(409, `累计净入库 ${next} 超过计划数量 ${order.quantity}`); const requirements = productionRequirementSummary(db, order.id); if (!requirements.length) throw new HttpError(409, '制令单缺少物料需求快照'); for (const r of requirements) { const need = next * r.quantityPerUnit; if (r.netIssued + EPS < need) throw new HttpError(409, `${r.productCode} 净领料 ${r.netIssued} 不足以支持累计入库 ${next}，需要 ${need}`); } }

export function confirmProductionReceipt(db, req, res, actor, receiptId) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const now = new Date().toISOString(); const key = String(req.headers['idempotency-key'] || `document-${receiptId}`); const fingerprint = requestFingerprint({ action: 'confirm' }); const replay = idempotencyReplay(db, 'PRODUCTION_RECEIPT_CONFIRM', receiptId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true }); transaction(db, () => { const x = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId); if (!x) throw new HttpError(404, '生产入库单不存在'); if (x.status !== 'DRAFT') throw new HttpError(409, '只有草稿入库单可以确认'); const order = loadOrder(db, x.production_order_id); requireInProgress(order); if (x.product_id !== order.product_id) throw new HttpError(409, '生产入库成品来源不匹配'); assertReceiptCoverage(db, order, Number(x.quantity)); const before = inventoryQty(db, x.warehouse_id, x.product_id); const after = adjustInventory(db, x.warehouse_id, x.product_id, Number(x.quantity), now); db.prepare("UPDATE production_receipts SET before_quantity=?,after_quantity=?,status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(before, after, actor.id, now, now, x.id); postLedger(db, { warehouseId: x.warehouse_id, productId: x.product_id, quantity: Number(x.quantity), direction: 'IN', sourceType: SOURCE.RECEIPT, sourceId: x.id, sourceNo: x.receipt_no, remark: '生产入库', actorId: actor.id, now }); saveIdempotency(db, 'PRODUCTION_RECEIPT_CONFIRM', receiptId, key, fingerprint, { ok: true, id: receiptId, status: 'CONFIRMED' }); audit(db, actor.id, 'CONFIRM', 'PRODUCTION_RECEIPT', x.id, `确认生产入库 ${x.receipt_no}`); }); return send(res, 200, { ok: true }); }

export function cancelProductionReceipt(db, res, actor, receiptId) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const x = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId); if (!x) throw new HttpError(404, '生产入库单不存在'); if (x.status !== 'DRAFT') throw new HttpError(409, '只有草稿入库单可以取消'); db.prepare("UPDATE production_receipts SET status='CANCELLED',updated_at=? WHERE id=?").run(new Date().toISOString(), receiptId); audit(db, actor.id, 'CANCEL', 'PRODUCTION_RECEIPT', receiptId, `取消生产入库 ${x.receipt_no}`); return send(res, 200, { ok: true }); }
export function deleteProductionReceipt(db, res, actor, receiptId) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const x = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId); if (!x) throw new HttpError(404, '生产入库单不存在'); if (!['DRAFT', 'CANCELLED'].includes(x.status)) throw new HttpError(409, '已确认生产入库不可删除，请使用入库冲销'); transaction(db, () => { db.prepare('DELETE FROM production_receipts WHERE id=?').run(receiptId); audit(db, actor.id, 'DELETE', 'PRODUCTION_RECEIPT', receiptId, `删除未过账生产入库 ${x.receipt_no}`); }); return send(res, 200, { ok: true }); }

export async function createProductionReceiptReversal(db, req, res, actor) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const body = await readJson(req); const receipt = db.prepare("SELECT * FROM production_receipts WHERE id=? AND status='CONFIRMED'").get(body.originalReceiptId); if (!receipt) throw new HttpError(409, '只能冲销已确认生产入库'); requireInProgress(loadOrder(db, receipt.production_order_id)); const quantity = positive(body.quantity, '冲销数量'); const reversalId = id(); const reversalNo = docNo('PRR'); const now = new Date().toISOString(); transaction(db, () => { db.prepare("INSERT INTO production_receipt_reversals(id,reversal_no,original_receipt_id,production_order_id,product_id,warehouse_id,quantity,status,reversal_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'DRAFT',?,?,?,?,?)").run(reversalId, reversalNo, receipt.id, receipt.production_order_id, receipt.product_id, receipt.warehouse_id, quantity, body.reversalDate || now.slice(0, 10), optionalText(body.remark || '', 500), actor.id, now, now); audit(db, actor.id, 'CREATE', 'PRODUCTION_RECEIPT_REVERSAL', reversalId, `创建生产入库冲销 ${reversalNo}`); }); return send(res, 201, { id: reversalId, reversalNo, status: 'DRAFT' }); }

export function confirmProductionReceiptReversal(db, res, actor, reversalId) { allow(actor, 'PRODUCTION_RECEIPT_MANAGE'); const now = new Date().toISOString(); transaction(db, () => { const x = db.prepare('SELECT * FROM production_receipt_reversals WHERE id=?').get(reversalId); if (!x) throw new HttpError(404, '生产入库冲销单不存在'); if (x.status !== 'DRAFT') throw new HttpError(409, '只有草稿冲销单可以确认'); requireInProgress(loadOrder(db, x.production_order_id)); const receipt = db.prepare("SELECT * FROM production_receipts WHERE id=? AND status='CONFIRMED'").get(x.original_receipt_id); if (!receipt || receipt.production_order_id !== x.production_order_id || receipt.product_id !== x.product_id || receipt.warehouse_id !== x.warehouse_id) throw new HttpError(409, '冲销来源与原生产入库不匹配'); const reversed = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) total FROM production_receipt_reversals WHERE original_receipt_id=? AND status='CONFIRMED'").get(receipt.id).total); if (reversed + Number(x.quantity) > Number(receipt.quantity) + EPS) throw new HttpError(409, '冲销数量超过原入库未冲销数量'); const before = inventoryQty(db, x.warehouse_id, x.product_id); if (before + EPS < Number(x.quantity)) throw new HttpError(409, '成品库存不足，无法冲销'); const after = adjustInventory(db, x.warehouse_id, x.product_id, -Number(x.quantity), now); db.prepare("UPDATE production_receipt_reversals SET before_quantity=?,after_quantity=?,status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(before, after, actor.id, now, now, x.id); postLedger(db, { warehouseId: x.warehouse_id, productId: x.product_id, quantity: Number(x.quantity), direction: 'OUT', sourceType: SOURCE.RECEIPT_REVERSAL, sourceId: x.id, sourceNo: x.reversal_no, remark: '生产入库冲销', actorId: actor.id, now }); audit(db, actor.id, 'CONFIRM', 'PRODUCTION_RECEIPT_REVERSAL', x.id, `确认生产入库冲销 ${x.reversal_no}`); }); return send(res, 200, { ok: true }); }

export const PRODUCTION_WORKFLOW_STATUS_LABELS = { ISSUE: STATUS, RECEIPT: STATUS };
export const PRODUCTION_WORKFLOW_SOURCE_TYPES = SOURCE;
