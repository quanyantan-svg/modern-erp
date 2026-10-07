// V18 Manufacturing & Quality Domain Closure — Material Execution (Wave B).
// Production Material Supplement + Return Reason + Batch Picking / Combined Issue.
//
// All three flows reuse the canonical inventory / valuation / WIP / voucher /
// period / audit / idempotency contracts from production-workflow.js.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, optionalText, readJson, send } from '../lib/http.js';
import { adjustInventory } from '../lib/stock.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { postTrackedMovement, saveTrackedAllocations, sourceTrackingAllocations } from './traceability-quality.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, issueSourceValue, postWipMovement, inventoryAccountRole } from './financial-inventory.js';
import { productionRequirementSummary } from './production-workflow.js';

const EPS = 1e-9;
const SOURCE = { SUPPLEMENT: 'PRODUCTION_MATERIAL_SUPPLEMENT', BATCH_ISSUE: 'PRODUCTION_BATCH_ISSUE' };
const SUPPLEMENT_REASONS = new Set(['SHORTAGE', 'YIELD_LOSS', 'QUALITY_REPLACEMENT', 'OTHER']);
const RETURN_REASONS = new Set(['MATERIAL_DEFECT', 'GOOD_RETURN', 'PROCESS_DEFECT', 'OTHER']);
const inventoryQty = (db, warehouseId, productId) => Number(db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId)?.quantity || 0);

const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label}必须大于 0`);
  return n;
};

const loadOrder = (db, orderId) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  return order;
};

const requireActiveOrder = (order) => {
  if (!['RELEASED', 'IN_PROGRESS'].includes(order.status)) {
    throw new HttpError(409, '只有 RELEASED/IN_PROGRESS 工单允许补料');
  }
};

function postLedger(db, x) {
  const transactionId = id();
  db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_line_id,source_no,remark,creator_id,created_at,business_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    transactionId, x.warehouseId, x.productId, x.quantity, x.direction,
    inventoryQty(db, x.warehouseId, x.productId), x.sourceType, x.sourceId, x.sourceLineId || null, x.sourceNo, x.remark, x.actorId, x.now, x.businessDate || x.now.slice(0, 10),
  );
  return transactionId;
}

// ============ Production Material Supplement ============

export function listProductionMaterialSupplements(db, res, actor, url) {
  allow(actor, 'PRODUCTION_SUPPLEMENT_MANAGE');
  const status = url.searchParams.get('status');
  const clauses = []; const ps = [];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { clauses.push('s.status=?'); ps.push(status); }
  const rows = db.prepare(`SELECT s.*, po.order_no productionOrderNo, po.status productionOrderStatus,
    w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName,
    (SELECT COUNT(*) FROM production_material_supplement_items WHERE supplement_id=s.id) itemCount
    FROM production_material_supplements s
    JOIN production_orders po ON po.id=s.production_order_id
    JOIN warehouses w ON w.id=s.warehouse_id
    JOIN users creator ON creator.id=s.creator_id
    LEFT JOIN users confirmed ON confirmed.id=s.confirmed_by
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY s.created_at DESC LIMIT 100`).all(...ps);
  return send(res, 200, { supplements: rows });
}

export function getProductionMaterialSupplement(db, res, actor, supplementId) {
  allow(actor, 'PRODUCTION_SUPPLEMENT_MANAGE');
  const supplement = db.prepare(`SELECT s.*, po.order_no productionOrderNo, po.status productionOrderStatus,
    w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName
    FROM production_material_supplements s
    JOIN production_orders po ON po.id=s.production_order_id
    JOIN warehouses w ON w.id=s.warehouse_id
    JOIN users creator ON creator.id=s.creator_id
    LEFT JOIN users confirmed ON confirmed.id=s.confirmed_by
    WHERE s.id=?`).get(supplementId);
  if (!supplement) throw new HttpError(404, '生产补料单不存在');
  supplement.items = db.prepare(`SELECT i.*, p.code productCode, p.name productName, p.unit FROM production_material_supplement_items i JOIN products p ON p.id=i.product_id WHERE i.supplement_id=?`).all(supplementId)
    .map((x) => ({ ...x, trackingAllocations: sourceTrackingAllocations(db, SOURCE.SUPPLEMENT, supplementId, x.id) }));
  return send(res, 200, { supplement });
}

export async function createProductionMaterialSupplement(db, req, res, actor) {
  allow(actor, 'PRODUCTION_SUPPLEMENT_MANAGE');
  const body = await readJson(req);
  const order = loadOrder(db, body.productionOrderId);
  requireActiveOrder(order);
  const reason = String(body.reasonCode || '').trim().toUpperCase();
  if (!SUPPLEMENT_REASONS.has(reason)) throw new HttpError(400, '补料原因不正确');
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, '请添加至少一条补料明细');
  const warehouseId = String(body.warehouseId || '').trim();
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) {
    throw new HttpError(400, '请选择有效仓库');
  }
  const supplementId = id();
  const supplementNo = 'PMS-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10);
  const now = new Date().toISOString();
  const items = body.items.map((raw, index) => ({
    id: id(),
    productId: String(raw.productId || '').trim(),
    quantity: positive(raw.quantity, '本次补料数量'),
    lineNo: index + 1,
    trackingAllocations: raw.trackingAllocations || raw.tracking_allocations || [],
  }));
  if (!items.every((x) => x.productId)) throw new HttpError(400, '请为每条补料明细选择物料');
  transaction(db, () => {
    db.prepare(`INSERT INTO production_material_supplements(id,supplement_no,production_order_id,source_type,source_id,warehouse_id,reason_code,remark,status,supplement_date,creator_id,created_at,updated_at)
      VALUES(?,?,?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`).run(
      supplementId, supplementNo, order.id, body.sourceType === 'RETURN_LINK' ? 'RETURN_LINK' : 'MANUAL',
      body.sourceId || null, warehouseId, reason, optionalText(body.remark, 500),
      body.supplementDate || now.slice(0, 10), actor.id, now, now,
    );
    const stmt = db.prepare('INSERT INTO production_material_supplement_items(id,supplement_id,product_id,quantity,line_no) VALUES(?,?,?,?,?)');
    for (const item of items) {
      stmt.run(item.id, supplementId, item.productId, item.quantity, item.lineNo);
      saveTrackedAllocations(db, { sourceType: SOURCE.SUPPLEMENT, sourceId: supplementId, sourceItemId: item.id, productId: item.productId, quantity: item.quantity, allocations: item.trackingAllocations });
    }
    audit(db, actor.id, 'CREATE', 'MATERIAL_SUPPLEMENT', supplementId, `创建生产补料 ${supplementNo}`);
  });
  return send(res, 201, { id: supplementId, supplementNo, status: 'DRAFT' });
}

export function confirmProductionMaterialSupplement(db, req, res, actor, supplementId) {
  allow(actor, 'PRODUCTION_SUPPLEMENT_MANAGE');
  const now = new Date().toISOString();
  const key = String(req.headers['idempotency-key'] || `document-${supplementId}`);
  const fingerprint = requestFingerprint({ action: 'confirm' });
  const replay = idempotencyReplay(db, 'MATERIAL_SUPPLEMENT_CONFIRM', supplementId, key, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const supplement = db.prepare('SELECT * FROM production_material_supplements WHERE id=?').get(supplementId);
    if (!supplement) throw new HttpError(404, '生产补料单不存在');
    if (supplement.status !== 'DRAFT') throw new HttpError(409, '只有草稿补料单可以确认');
    const order = loadOrder(db, supplement.production_order_id);
    requireActiveOrder(order);
    assertFinancialPeriodsOpen(db, supplement.supplement_date);
    const rows = db.prepare('SELECT * FROM production_material_supplement_items WHERE supplement_id=? ORDER BY line_no').all(supplementId);
    if (!rows.length) throw new HttpError(409, '补料单没有明细');
    const baseline = db.prepare('SELECT component_snapshot_json FROM production_cost_baselines WHERE production_order_id=?').get(order.id);
    if (!baseline) throw new HttpError(409, '生产工单缺少冻结成本基线');
    const costs = new Map(JSON.parse(baseline.component_snapshot_json || '[]').map((x) => [x.product_id, Number(x.unit_cost_cents)]));
    const summary = new Map(productionRequirementSummary(db, order.id).map((x) => [x.id, x]));
    for (const row of rows) {
      const stock = inventoryQty(db, supplement.warehouse_id, row.product_id);
      if (stock + EPS < Number(row.quantity)) throw new HttpError(409, `${row.product_id} 库存不足，需要 ${row.quantity}，实际 ${stock}`);
    }
    const voucherEntries = []; let standardTotal = 0;
    for (const row of rows) {
      postTrackedMovement(db, { sourceType: SOURCE.SUPPLEMENT, sourceId: supplement.id, sourceItemId: row.id, productId: row.product_id, warehouseId: supplement.warehouse_id, quantity: row.quantity, direction: 'OUT', businessDate: supplement.supplement_date });
      const before = inventoryQty(db, supplement.warehouse_id, row.product_id);
      const after = adjustInventory(db, supplement.warehouse_id, row.product_id, -Number(row.quantity), now);
      db.prepare('UPDATE production_material_supplement_items SET before_quantity=?,after_quantity=? WHERE id=?').run(before, after, row.id);
      const transactionId = postLedger(db, { warehouseId: supplement.warehouse_id, productId: row.product_id, quantity: Number(row.quantity), direction: 'OUT', sourceType: SOURCE.SUPPLEMENT, sourceId: supplement.id, sourceLineId: row.id, sourceNo: supplement.supplement_no, remark: '生产补料', actorId: actor.id, now, businessDate: supplement.supplement_date });
      const carrying = issueSourceValue(db, { businessDate: supplement.supplement_date, productId: row.product_id, warehouseId: supplement.warehouse_id, quantity: Number(row.quantity), movementType: 'MATERIAL_SUPPLEMENT', sourceType: SOURCE.SUPPLEMENT, sourceId: supplement.id, sourceItemId: row.id, inventoryTransactionId: transactionId, productionOrderId: supplement.production_order_id }).reduce((s, x) => s - x.valueDeltaCents, 0);
      const standard = Math.round(Number(row.quantity) * Number(costs.get(row.product_id) || 0));
      standardTotal += standard;
      voucherEntries.push({ role: 'WIP', direction: 'DEBIT', amountCents: standard }, { role: inventoryAccountRole(db, row.product_id), direction: 'CREDIT', amountCents: carrying });
      if (carrying > standard) voucherEntries.push({ role: 'MATERIAL_PRICE_VARIANCE', direction: 'DEBIT', amountCents: carrying - standard });
      else if (standard > carrying) voucherEntries.push({ role: 'MATERIAL_PRICE_VARIANCE', direction: 'CREDIT', amountCents: standard - carrying });
    }
    const voucherId = createSystemVoucher(db, { sourceType: 'PRODUCTION_MATERIAL_SUPPLEMENT', sourceId: supplement.id, businessDate: supplement.supplement_date, actorId: actor.id, entries: voucherEntries });
    if (standardTotal !== 0) postWipMovement(db, { productionOrderId: supplement.production_order_id, businessDate: supplement.supplement_date, movementType: 'MATERIAL_SUPPLEMENT_ABSORPTION', amountCents: standardTotal, sourceType: SOURCE.SUPPLEMENT, sourceId: supplement.id, voucherId });
    db.prepare("UPDATE production_material_supplements SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, supplement.id);
    saveIdempotency(db, 'MATERIAL_SUPPLEMENT_CONFIRM', supplementId, key, fingerprint, { ok: true, id: supplementId, status: 'CONFIRMED' });
    audit(db, actor.id, 'CONFIRM', 'MATERIAL_SUPPLEMENT', supplement.id, `确认生产补料 ${supplement.supplement_no}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelProductionMaterialSupplement(db, res, actor, supplementId) {
  allow(actor, 'PRODUCTION_SUPPLEMENT_MANAGE');
  const x = db.prepare('SELECT * FROM production_material_supplements WHERE id=?').get(supplementId);
  if (!x) throw new HttpError(404, '生产补料单不存在');
  if (x.status !== 'DRAFT') throw new HttpError(409, '只有草稿补料单可以取消');
  db.prepare("UPDATE production_material_supplements SET status='CANCELLED',updated_at=? WHERE id=?").run(new Date().toISOString(), supplementId);
  audit(db, actor.id, 'CANCEL', 'MATERIAL_SUPPLEMENT', supplementId, `取消生产补料 ${x.supplement_no}`);
  return send(res, 200, { ok: true });
}

// ============ Production Material Return Reason ============

export async function createProductionMaterialReturnWithReason(db, req, res, actor) {
  allow(actor, 'PRODUCTION_RETURN_MANAGE');
  const body = await readJson(req);
  const issue = db.prepare("SELECT * FROM production_material_issues WHERE id=? AND status='CONFIRMED'").get(body.originalIssueId);
  if (!issue) throw new HttpError(409, '只能对已确认用料出库创建退料');
  const order = loadOrder(db, issue.production_order_id);
  if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '只有 IN_PROGRESS 工单允许退料');
  const reasonCode = String(body.reasonCode || 'OTHER').trim().toUpperCase();
  if (!RETURN_REASONS.has(reasonCode)) throw new HttpError(400, '退料原因不正确');
  if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, '请添加退料明细');
  const items = body.items.map((raw, i) => {
    const original = db.prepare('SELECT * FROM production_material_issue_items WHERE id=? AND issue_id=?').get(raw.originalIssueItemId, issue.id);
    if (!original) throw new HttpError(400, `第 ${i + 1} 行原出库明细无效`);
    return { id: id(), original, quantity: positive(raw.quantity, '退料数量'), lineNo: i + 1, trackingAllocations: raw.trackingAllocations || raw.tracking_allocations || [] };
  });
  const returnId = id();
  const returnNo = 'PMR-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_material_returns(id,return_no,original_issue_id,production_order_id,warehouse_id,status,return_date,reason_code,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'DRAFT',?,?,?,?,?,?)`).run(
      returnId, returnNo, issue.id, issue.production_order_id, issue.warehouse_id,
      body.returnDate || now.slice(0, 10), reasonCode, optionalText(body.remark, 500), actor.id, now, now,
    );
    const stmt = db.prepare('INSERT INTO production_material_return_items(id,return_id,original_issue_item_id,requirement_line_id,product_id,quantity,line_no) VALUES(?,?,?,?,?,?,?)');
    for (const [index, x] of items.entries()) {
      stmt.run(x.id, returnId, x.original.id, x.original.requirement_line_id, x.original.product_id, x.quantity, x.lineNo);
      saveTrackedAllocations(db, { sourceType: 'PRODUCTION_MATERIAL_RETURN', sourceId: returnId, sourceItemId: x.id, productId: x.original.product_id, quantity: x.quantity, allocations: body.items[index].trackingAllocations || body.items[index].tracking_allocations || [] });
    }
    audit(db, actor.id, 'CREATE', 'MATERIAL_RETURN', returnId, `创建生产退料 ${returnNo} 原因 ${reasonCode}`);
  });
  return send(res, 201, { id: returnId, returnNo, status: 'DRAFT' });
}

// ============ Batch Picking / Combined Issue ============

export async function createProductionBatchIssue(db, req, res, actor) {
  allow(actor, 'PRODUCTION_BATCH_ISSUE_MANAGE');
  const body = await readJson(req);
  const warehouseId = String(body.warehouseId || '').trim();
  if (!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId)) {
    throw new HttpError(400, '请选择有效仓库');
  }
  const orders = Array.isArray(body.orders) ? body.orders : [];
  if (!orders.length) throw new HttpError(400, '请至少添加一笔生产订单');
  const batchId = id();
  const batchNo = 'PBI-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10);
  const now = new Date().toISOString();
  const orderIssueIds = [];
  // Phase 1: validate & create DRAFT issues per order, in one transaction.
  transaction(db, () => {
    db.prepare(`INSERT INTO production_batch_issues(id,batch_no,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,'DRAFT',?,?,?,?,?)`).run(
      batchId, batchNo, warehouseId, body.issueDate || now.slice(0, 10), optionalText(body.remark, 500), actor.id, now, now,
    );
    for (const o of orders) {
      const order = loadOrder(db, o.productionOrderId);
      if (order.status !== 'IN_PROGRESS') throw new HttpError(409, `订单 ${order.order_no} 状态不允许合并领料`);
      const seen = new Set();
      const items = (Array.isArray(o.items) ? o.items : []).map((raw, idx) => {
        const r = db.prepare('SELECT * FROM production_order_items WHERE id=? AND order_id=?').get(raw.requirementLineId, order.id);
        if (!r) throw new HttpError(400, `订单 ${order.order_no} 第 ${idx + 1} 行不是有效需求行`);
        if (seen.has(r.id)) throw new HttpError(400, `订单 ${order.order_no} 同一需求行不能重复`);
        seen.add(r.id);
        const stock = inventoryQty(db, warehouseId, r.product_id);
        if (stock + EPS < Number(raw.issueQuantity || 0)) throw new HttpError(409, `订单 ${order.order_no} ${r.product_id} 库存不足`);
        return { id: id(), requirementLineId: r.id, productId: r.product_id, plannedQuantity: Number(r.quantity), issueQuantity: positive(raw.issueQuantity, '本次出库量'), lineNo: idx + 1 };
      });
      const orderIssueId = id();
      const orderIssueNo = 'PMI-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10) + '-' + (orderIssueIds.length + 1);
      db.prepare(`INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,issue_date,remark,status,creator_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'DRAFT',?,?,?)`).run(
        orderIssueId, orderIssueNo, order.id, warehouseId, body.issueDate || now.slice(0, 10), optionalText(o.remark || `合并领料 ${batchNo}`, 500), actor.id, now, now,
      );
      const itemStmt = db.prepare('INSERT INTO production_material_issue_items(id,issue_id,requirement_line_id,product_id,planned_quantity,issue_quantity,line_no) VALUES(?,?,?,?,?,?,?)');
      for (const x of items) itemStmt.run(x.id, orderIssueId, x.requirementLineId, x.productId, x.plannedQuantity, x.issueQuantity, x.lineNo);
      const orderIssueLinkId = id();
      db.prepare(`INSERT INTO production_batch_issue_orders(id,batch_id,production_order_id,order_status) VALUES(?,?,?,'OK')`).run(orderIssueLinkId, batchId, order.id);
      const itemLinkStmt = db.prepare('INSERT INTO production_batch_issue_items(id,batch_id,order_issue_id,product_id,planned_quantity,issue_quantity,line_no) VALUES(?,?,?,?,?,?,?)');
      for (const x of items) itemLinkStmt.run(id(), batchId, orderIssueLinkId, x.productId, x.plannedQuantity, x.issueQuantity, x.lineNo);
      orderIssueIds.push(orderIssueId);
    }
    audit(db, actor.id, 'CREATE', 'BATCH_ISSUE', batchId, `创建合并领料 ${batchNo}（${orders.length} 订单）`);
  });
  return send(res, 201, { id: batchId, batchNo, status: 'DRAFT', orderIssueIds });
}

export function confirmProductionBatchIssue(db, req, res, actor, batchId) {
  allow(actor, 'PRODUCTION_BATCH_ISSUE_MANAGE');
  const now = new Date().toISOString();
  const key = String(req.headers['idempotency-key'] || `document-${batchId}`);
  const fingerprint = requestFingerprint({ action: 'confirm-batch' });
  const replay = idempotencyReplay(db, 'BATCH_ISSUE_CONFIRM', batchId, key, fingerprint);
  if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const batch = db.prepare('SELECT * FROM production_batch_issues WHERE id=?').get(batchId);
    if (!batch) throw new HttpError(404, '合并领料单不存在');
    if (batch.status !== 'DRAFT') throw new HttpError(409, '只有草稿合并领料单可以确认');
    const orderLinks = db.prepare('SELECT * FROM production_batch_issue_orders WHERE batch_id=?').all(batchId);
    if (!orderLinks.length) throw new HttpError(409, '合并领料单没有订单明细');
    for (const link of orderLinks) {
      const issue = db.prepare("SELECT * FROM production_material_issues WHERE production_order_id=? AND status='DRAFT' AND created_at=?").get(link.production_order_id, batch.created_at);
      if (!issue) throw new HttpError(409, `订单 ${link.production_order_id} 对应出库单不存在或已确认`);
      const order = loadOrder(db, link.production_order_id);
      if (order.status !== 'IN_PROGRESS') throw new HttpError(409, `订单 ${order.order_no} 状态不允许合并领料`);
      assertFinancialPeriodsOpen(db, batch.issue_date);
      const rows = db.prepare('SELECT * FROM production_material_issue_items WHERE issue_id=? ORDER BY line_no').all(issue.id);
      const baseline = db.prepare('SELECT component_snapshot_json FROM production_cost_baselines WHERE production_order_id=?').get(order.id);
      if (!baseline) throw new HttpError(409, `订单 ${order.order_no} 缺少冻结成本基线`);
      const costs = new Map(JSON.parse(baseline.component_snapshot_json || '[]').map((x) => [x.product_id, Number(x.unit_cost_cents)]));
      const summary = new Map(productionRequirementSummary(db, order.id).map((x) => [x.id, x]));
      for (const row of rows) {
        const r = summary.get(row.requirement_line_id);
        if (!r || r.product_id !== row.product_id) throw new HttpError(409, '用料需求来源已失效');
        if (Number(row.issue_quantity) > r.remainingQuantity + EPS) throw new HttpError(409, `${r.productCode} 剩余可领 ${r.remainingQuantity}，本次 ${row.issue_quantity} 超出`);
      }
      const voucherEntries = []; let standardTotal = 0;
      for (const row of rows) {
        postTrackedMovement(db, { sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: issue.id, sourceItemId: row.id, productId: row.product_id, warehouseId: batch.warehouse_id, quantity: row.issue_quantity, direction: 'OUT', businessDate: batch.issue_date });
        const before = inventoryQty(db, batch.warehouse_id, row.product_id);
        const after = adjustInventory(db, batch.warehouse_id, row.product_id, -Number(row.issue_quantity), now);
        db.prepare('UPDATE production_material_issue_items SET before_quantity=?,after_quantity=? WHERE id=?').run(before, after, row.id);
        const transactionId = postLedger(db, { warehouseId: batch.warehouse_id, productId: row.product_id, quantity: Number(row.issue_quantity), direction: 'OUT', sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: issue.id, sourceLineId: row.id, sourceNo: issue.issue_no, remark: '合并领料', actorId: actor.id, now, businessDate: batch.issue_date });
        const carrying = issueSourceValue(db, { businessDate: batch.issue_date, productId: row.product_id, warehouseId: batch.warehouse_id, quantity: Number(row.issue_quantity), movementType: 'MATERIAL_ISSUE', sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: issue.id, sourceItemId: row.id, inventoryTransactionId: transactionId, productionOrderId: order.id }).reduce((s, x) => s - x.valueDeltaCents, 0);
        const standard = Math.round(Number(row.issue_quantity) * Number(costs.get(row.product_id) || 0));
        standardTotal += standard;
        voucherEntries.push({ role: 'WIP', direction: 'DEBIT', amountCents: standard }, { role: inventoryAccountRole(db, row.product_id), direction: 'CREDIT', amountCents: carrying });
        if (carrying > standard) voucherEntries.push({ role: 'MATERIAL_PRICE_VARIANCE', direction: 'DEBIT', amountCents: carrying - standard });
        else if (standard > carrying) voucherEntries.push({ role: 'MATERIAL_PRICE_VARIANCE', direction: 'CREDIT', amountCents: standard - carrying });
      }
      const voucherId = createSystemVoucher(db, { sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: issue.id, businessDate: batch.issue_date, actorId: actor.id, entries: voucherEntries });
      if (standardTotal !== 0) postWipMovement(db, { productionOrderId: order.id, businessDate: batch.issue_date, movementType: 'MATERIAL_STANDARD_ABSORPTION', amountCents: standardTotal, sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: issue.id, voucherId });
      db.prepare("UPDATE production_material_issues SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, issue.id);
      audit(db, actor.id, 'CONFIRM', 'MATERIAL_ISSUE', issue.id, `合并领料确认 ${issue.issue_no}`);
    }
    db.prepare("UPDATE production_batch_issues SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, batchId);
    saveIdempotency(db, 'BATCH_ISSUE_CONFIRM', batchId, key, fingerprint, { ok: true, id: batchId, status: 'CONFIRMED' });
    audit(db, actor.id, 'CONFIRM', 'BATCH_ISSUE', batchId, `确认合并领料 ${batch.batch_no}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelProductionBatchIssue(db, res, actor, batchId) {
  allow(actor, 'PRODUCTION_BATCH_ISSUE_MANAGE');
  const batch = db.prepare('SELECT * FROM production_batch_issues WHERE id=?').get(batchId);
  if (!batch) throw new HttpError(404, '合并领料单不存在');
  if (batch.status !== 'DRAFT') throw new HttpError(409, '只有草稿合并领料单可以取消');
  const now = new Date().toISOString();
  transaction(db, () => {
    const orderLinks = db.prepare('SELECT * FROM production_batch_issue_orders WHERE batch_id=?').all(batchId);
    for (const link of orderLinks) {
      const draftIssue = db.prepare("SELECT id FROM production_material_issues WHERE production_order_id=? AND status='DRAFT' AND created_at=?").get(link.production_order_id, batch.created_at);
      if (draftIssue) db.prepare("UPDATE production_material_issues SET status='CANCELLED',updated_at=? WHERE id=?").run(now, draftIssue.id);
      db.prepare("UPDATE production_batch_issue_orders SET order_status='CANCELLED' WHERE id=?").run(link.id);
    }
    db.prepare("UPDATE production_batch_issues SET status='CANCELLED',updated_at=? WHERE id=?").run(now, batchId);
    audit(db, actor.id, 'CANCEL', 'BATCH_ISSUE', batchId, `取消合并领料 ${batch.batch_no}`);
  });
  return send(res, 200, { ok: true });
}

export function getProductionBatchIssue(db, res, actor, batchId) {
  allow(actor, 'PRODUCTION_BATCH_ISSUE_MANAGE');
  const batch = db.prepare(`SELECT b.*, w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName
    FROM production_batch_issues b JOIN warehouses w ON w.id=b.warehouse_id
    JOIN users creator ON creator.id=b.creator_id
    LEFT JOIN users confirmed ON confirmed.id=b.confirmed_by
    WHERE b.id=?`).get(batchId);
  if (!batch) throw new HttpError(404, '合并领料单不存在');
  batch.orders = db.prepare(`SELECT o.*, po.order_no productionOrderNo, po.status productionOrderStatus
    FROM production_batch_issue_orders o JOIN production_orders po ON po.id=o.production_order_id
    WHERE o.batch_id=?`).all(batchId);
  batch.items = db.prepare(`SELECT i.*, p.code productCode, p.name productName FROM production_batch_issue_items i JOIN products p ON p.id=i.product_id WHERE i.batch_id=?`).all(batchId);
  return send(res, 200, { batchIssue: batch });
}

export function listProductionBatchIssues(db, res, actor, url) {
  allow(actor, 'PRODUCTION_BATCH_ISSUE_MANAGE');
  const status = url.searchParams.get('status');
  const clauses = []; const ps = [];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { clauses.push('b.status=?'); ps.push(status); }
  const rows = db.prepare(`SELECT b.*, w.code warehouseCode, w.name warehouseName,
    creator.display_name creatorName, confirmed.display_name confirmedByName,
    (SELECT COUNT(*) FROM production_batch_issue_orders WHERE batch_id=b.id) orderCount
    FROM production_batch_issues b JOIN warehouses w ON w.id=b.warehouse_id
    JOIN users creator ON creator.id=b.creator_id
    LEFT JOIN users confirmed ON confirmed.id=b.confirmed_by
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY b.created_at DESC LIMIT 100`).all(...ps);
  return send(res, 200, { batchIssues: rows });
}