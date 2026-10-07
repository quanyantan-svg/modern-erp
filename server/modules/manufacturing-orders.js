// V18 Manufacturing & Quality Domain Closure — Production order canonical owner.
// Owns production_orders lifecycle (Draft / Submit / Approve / Reject / Release
// / Start / Complete / Cancel), material list lifecycle, Engineering Resolver
// integration, and production_outputs legacy convergence.
//
// Backward compatibility:
//  - Existing PENDING rows are treated as SUBMITTED alias (CHECK constraint
//    upgrade auto-converts PENDING -> SUBMITTED).
//  - Existing DRAFT/IN_PROGRESS/COMPLETED/CANCELLED rows unchanged.
//  - production_orders.bom_id / bom_version_snapshot / routing_id_snapshot
//    are immutable once RELEASED.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredText, send } from '../lib/http.js';
import { resolveEffectiveBomForCaller } from './engineering-bom.js';
import { snapshotManufacturingExecution, assertRoutedCompletion, deriveProductionCost } from './manufacturing-execution.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, postWipMovement } from './financial-inventory.js';
import { productionNetReceived, productionRequirementSummary } from './production-workflow.js';

const EPS = 1e-9;
const PO_STATUS = Object.freeze({
  DRAFT: '草稿', PENDING: '待提交', SUBMITTED: '待审核', APPROVED: '已审核',
  REJECTED: '已驳回', RELEASED: '已下达', IN_PROGRESS: '生产中',
  COMPLETED: '已完成', CANCELLED: '已取消',
});
const TRANSITIONS = Object.freeze({
  DRAFT:      ['SUBMITTED', 'CANCELLED'],
  PENDING:    ['SUBMITTED', 'CANCELLED'],
  SUBMITTED:  ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED:   ['RELEASED', 'CANCELLED'],
  REJECTED:   ['DRAFT', 'CANCELLED'],
  RELEASED:   ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED:  [],
  CANCELLED:  [],
});

const loadOrder = (db, orderId) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  return order;
};

const positiveQuantity = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${label}必须大于 0`);
  return n;
};

const assertTransition = (current, target) => {
  const allowed = TRANSITIONS[current.status] || [];
  if (!allowed.includes(target)) {
    throw new HttpError(409, `当前状态 ${PO_STATUS[current.status] || current.status} 不允许转移至 ${PO_STATUS[target] || target}`);
  }
};

function snapshotProductionOrder(db, orderId, productId, bomId, quantity, routingId) {
  const effective = resolveEffectiveBomForCaller(db, productId, 'SELF_MAKE');
  const businessDate = new Date().toISOString().slice(0, 10);
  let chosenBom = bomId ? db.prepare(`SELECT * FROM boms WHERE id=? AND product_id=? AND status='ACTIVE'
    AND approval_status='APPROVED' AND purpose IN ('SELF_MAKE','GENERAL')
    AND (effective_from IS NULL OR effective_from<=?) AND (effective_to IS NULL OR effective_to>=?)`).get(bomId, productId, businessDate, businessDate) : null;
  if (chosenBom) {
    if (chosenBom.product_id !== productId) throw new HttpError(409, 'BOM 与生产产品不匹配');
    if (chosenBom.status !== 'ACTIVE') throw new HttpError(409, 'BOM 未启用');
  } else if (bomId) {
    throw new HttpError(409, 'BOM does not satisfy the approved effective self-make contract');
  } else if (effective) {
    chosenBom = effective;
  } else {
    throw new HttpError(409, '找不到适合生产使用的 BOM');
  }
  const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(chosenBom.id);
  if (!bomItems.length) throw new HttpError(409, 'BOM 没有物料明细，不能下达或开工');
  if (!db.prepare('SELECT 1 FROM production_order_items WHERE order_id=?').get(orderId)) {
    const insert = db.prepare(`INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no,bom_item_id,quantity_per_unit,scrap_rate_snapshot,material_list_status)
      VALUES(?,?,?,?,0,?,?,?,?,?)`);
    for (const item of bomItems) {
      const perUnit = Number(item.quantity) * (1 + Number(item.scrap_rate || 0));
      insert.run(id(), orderId, item.product_id, perUnit * Number(quantity), item.line_no, item.id, perUnit, Number(item.scrap_rate || 0), 'GENERATED');
    }
  }
  const routing = routingId
    ? db.prepare("SELECT * FROM product_routings WHERE id=? AND product_id=? AND status='ACTIVE'").get(routingId, productId)
    : db.prepare("SELECT * FROM product_routings WHERE product_id=? AND status='ACTIVE'").get(productId);
  if (routingId && !routing) throw new HttpError(409, 'Routing is inactive, missing, or belongs to another product');
  db.prepare('UPDATE production_orders SET bom_id=?,bom_version_snapshot=?,routing_id_snapshot=?,routing_version_snapshot=?,updated_at=? WHERE id=?')
    .run(chosenBom.id, chosenBom.version || '', routing?.id || null, routing?.version || '', new Date().toISOString(), orderId);
  if (routing && !db.prepare('SELECT 1 FROM production_order_routing_snapshots WHERE production_order_id=?').get(orderId)) {
    const insert = db.prepare(`INSERT INTO production_order_routing_snapshots(id,production_order_id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at,
      source_operation_id,work_center_id,setup_seconds,run_seconds_per_unit,expected_yield_bps,control_code_id,control_code,control_participates_scheduling,control_reporting_method,control_inspection_method,is_outsource,quality_policy,topology)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const now = new Date().toISOString();
    for (const op of db.prepare(`SELECT o.*,cc.code control_code_code,cc.category control_code_category,cc.policy control_code_policy
      FROM product_routing_operations o LEFT JOIN engineering_control_codes cc ON cc.id=o.control_code_id
      WHERE o.routing_id=? AND COALESCE(o.active,1)=1 ORDER BY o.sequence_no`).all(routing.id)) {
      insert.run(id(), orderId, routing.id, op.sequence_no, op.operation_code, op.operation_name, op.work_center, op.setup_minutes, op.run_minutes_per_unit, op.notes, now,
        op.id, op.work_center_id || null, Number(op.setup_seconds || 0), Number(op.run_seconds_per_unit || 0), Number(op.expected_yield_bps || 10000),
        op.control_code_id || null, op.control_code_code || '', op.control_code_category === 'SCHEDULING' && String(op.control_code_policy || '').toUpperCase() === 'EXCLUDE' ? 0 : 1,
        op.control_code_category === 'REPORT' ? (op.control_code_policy || 'MANUAL') : 'MANUAL',
        ['INSPECTION', 'QUALITY'].includes(op.control_code_category) ? (op.control_code_policy || 'REQUIRED') : 'NONE',
        Number(op.is_outsource || 0), op.quality_policy || 'NONE', routing.topology_type || 'LINEAR');
    }
  }
  return { bom: chosenBom, routing };
}

export function listProductionOrders(db, res, actor, url) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  const clauses = ['(po.order_no LIKE ? OR p.name LIKE ?)'];
  const params = [search, search];
  if (status) { clauses.push('po.status = ?'); params.push(status); }
  const rows = db.prepare(`SELECT po.*, p.code productCode, p.name productName, b.version bomVersion,
    creator.display_name creatorName, released.display_name releasedByName,
    approved.display_name approvedByName
    FROM production_orders po JOIN products p ON p.id=po.product_id
    LEFT JOIN boms b ON b.id=po.bom_id
    JOIN users creator ON creator.id=po.creator_id
    LEFT JOIN users released ON released.id = po.released_by
    LEFT JOIN users approved ON approved.id = po.approved_by
    WHERE ${clauses.join(' AND ')} ORDER BY po.created_at DESC LIMIT 100`).all(...params);
  return send(res, 200, { orders: rows.map((row) => ({ ...row, statusLabel: PO_STATUS[row.status] || row.status })) });
}

export async function createProductionOrder(db, req, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_CREATE');
  const body = await readJson(req);
  const productId = String(body.productId || '').trim();
  if (!productId) throw new HttpError(400, '请选择产品');
  const product = db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(400, '产品不存在或已停用');
  const orderQuantity = positiveQuantity(body.quantity, '生产数量');
  const now = new Date().toISOString();
  const poId = id();
  const poNo = 'MO-' + Date.now().toString(36).toUpperCase();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_orders(id,order_no,product_id,quantity,status,planned_start,planned_finish,remark,creator_id,created_at,updated_at,source_type,material_list_status)
      VALUES(?,?,?,?, 'DRAFT', ?, ?, ?, ?, ?, ?, 'MANUAL', 'GENERATED')`).run(poId, poNo, productId, orderQuantity, body.plannedStart || null, body.plannedFinish || null, optionalText(body.remark, 500), actor.id, now, now);
    const bomId = body.bomId ? String(body.bomId) : null;
    snapshotProductionOrder(db, poId, productId, bomId, orderQuantity, body.routingId || null);
    audit(db, actor.id, 'CREATE', 'PRODUCTION_ORDER', poId, `创建生产工单 ${poNo}`);
  });
  return send(res, 200, { id: poId, orderNo: poNo, status: 'DRAFT' });
}

function transitionOrder(db, actor, order, target, body) {
  const now = new Date().toISOString();
  if (target === 'SUBMITTED') {
    allow(actor, 'PRODUCTION_ORDERS_CREATE');
    db.prepare("UPDATE production_orders SET status='SUBMITTED',submitted_by=?,submitted_at=?,updated_at=? WHERE id=?")
      .run(actor.id, now, now, order.id);
    audit(db, actor.id, 'SUBMIT', 'PRODUCTION_ORDER', order.id, `提交生产工单 ${order.order_no}`);
    return { status: 'SUBMITTED' };
  }
  if (target === 'APPROVED') {
    allow(actor, 'PRODUCTION_ORDERS_APPROVE');
    db.prepare("UPDATE production_orders SET status='APPROVED',approved_by=?,approved_at=?,updated_at=?,rejection_reason='' WHERE id=?")
      .run(actor.id, now, now, order.id);
    audit(db, actor.id, 'APPROVE', 'PRODUCTION_ORDER', order.id, `审核生产工单 ${order.order_no}`);
    return { status: 'APPROVED' };
  }
  if (target === 'REJECTED') {
    allow(actor, 'PRODUCTION_ORDERS_APPROVE');
    const reason = String(body?.reason || '').trim();
    if (!reason) throw new HttpError(400, '请填写驳回原因');
    db.prepare("UPDATE production_orders SET status='REJECTED',rejected_by=?,rejected_at=?,rejection_reason=?,updated_at=? WHERE id=?")
      .run(actor.id, now, reason, now, order.id);
    audit(db, actor.id, 'REJECT', 'PRODUCTION_ORDER', order.id, `驳回生产工单 ${order.order_no} 原因：${reason}`);
    return { status: 'REJECTED' };
  }
  if (target === 'RELEASED') {
    allow(actor, 'PRODUCTION_ORDERS_RELEASE');
    db.prepare("UPDATE production_orders SET status='RELEASED',released_by=?,released_at=?,updated_at=?,material_list_status='RELEASED',material_list_released_by=?,material_list_released_at=? WHERE id=?")
      .run(actor.id, now, now, actor.id, now, order.id);
    snapshotManufacturingExecution(db, order.id);
    audit(db, actor.id, 'RELEASE', 'PRODUCTION_ORDER', order.id, `下达生产工单 ${order.order_no}`);
    return { status: 'RELEASED' };
  }
  if (target === 'IN_PROGRESS') {
    allow(actor, 'PRODUCTION_ORDERS_START');
    snapshotProductionOrder(db, order.id, order.product_id, order.bom_id, order.quantity, order.routing_id_snapshot);
    snapshotManufacturingExecution(db, order.id);
    db.prepare("UPDATE production_orders SET status='IN_PROGRESS',actual_start=?,updated_at=? WHERE id=?")
      .run(now, now, order.id);
    audit(db, actor.id, 'START', 'PRODUCTION_ORDER', order.id, `生产工单开工 ${order.order_no}`);
    return { status: 'IN_PROGRESS' };
  }
  if (target === 'COMPLETED') {
    allow(actor, 'PRODUCTION_ORDERS_COMPLETE');
    const routed = assertRoutedCompletion(db, order.id);
    const netReceived = productionNetReceived(db, order.id);
    if (!routed && Math.abs(netReceived - Number(order.quantity)) > EPS) {
      throw new HttpError(409, `净入库 ${netReceived} 必须等于计划数量 ${order.quantity}`);
    }
    for (const item of productionRequirementSummary(db, order.id)) {
      const required = Number(order.quantity) * Number(item.quantityPerUnit);
      if (item.netIssued + EPS < required) {
        throw new HttpError(409, `${item.productCode} 净领料 ${item.netIssued} 小于完工需求 ${required}`);
      }
    }
    const drafts = Number(db.prepare("SELECT (SELECT COUNT(*) FROM production_material_issues WHERE production_order_id=? AND status='DRAFT')+(SELECT COUNT(*) FROM production_receipts WHERE production_order_id=? AND status='DRAFT') total").get(order.id, order.id).total);
    if (drafts) throw new HttpError(409, '存在未处理的草稿领料或生产入库，请先确认、取消或删除');
    const businessDate = now.slice(0, 10);
    assertFinancialPeriodsOpen(db, businessDate);
    const residual = Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM production_wip_movements WHERE production_order_id=?').get(order.id).n);
    if (residual !== 0) {
      const voucherId = createSystemVoucher(db, {
        sourceType: 'PRODUCTION_COMPLETION_VARIANCE',
        sourceId: order.id,
        businessDate,
        actorId: actor.id,
        entries: residual > 0
          ? [{ role: 'MANUFACTURING_VARIANCE', direction: 'DEBIT', amountCents: residual }, { role: 'WIP', direction: 'CREDIT', amountCents: residual }]
          : [{ role: 'WIP', direction: 'DEBIT', amountCents: -residual }, { role: 'MANUFACTURING_VARIANCE', direction: 'CREDIT', amountCents: -residual }],
      });
      postWipMovement(db, {
        productionOrderId: order.id,
        businessDate,
        movementType: 'COMPLETION_VARIANCE',
        amountCents: -residual,
        sourceType: 'PRODUCTION_ORDER_COMPLETION',
        sourceId: order.id,
        voucherId,
      });
    }
    db.prepare("UPDATE production_orders SET status='COMPLETED',actual_finish=?,updated_at=? WHERE id=?")
      .run(now, now, order.id);
    deriveProductionCost(db, order.id, true);
    audit(db, actor.id, 'COMPLETE', 'PRODUCTION_ORDER', order.id, `生产工单完工 ${order.order_no}`);
    return { status: 'COMPLETED' };
  }
  if (target === 'CANCELLED') {
    allowAny(actor, ['PRODUCTION_ORDERS_CREATE', 'PRODUCTION_ORDERS_START', 'PRODUCTION_ORDERS_APPROVE']);
    if (order.status === 'COMPLETED') throw new HttpError(409, '已完工的工单不能取消');
    if (order.status === 'CANCELLED') return { status: 'CANCELLED' };
    if (['DRAFT', 'REJECTED'].includes(order.status)) {
      db.prepare("UPDATE production_orders SET status='CANCELLED',updated_at=? WHERE id=?")
        .run(now, order.id);
      audit(db, actor.id, 'CANCEL', 'PRODUCTION_ORDER', order.id, `取消生产工单 ${order.order_no}`);
      return { status: 'CANCELLED' };
    }
    if (productionNetReceived(db, order.id) > EPS || productionRequirementSummary(db, order.id).some((item) => Math.abs(item.netIssued) > EPS)) {
      throw new HttpError(409, '制令单仍有净库存影响，必须先退料或冲销至零');
    }
    if (db.prepare("SELECT 1 FROM production_operation_reports WHERE production_order_id=? AND status='CONFIRMED'").get(order.id)) {
      throw new HttpError(409, '制令单已有确认报工历史，必须先完整冲销报工后才能取消');
    }
    db.prepare("UPDATE production_orders SET status='CANCELLED',updated_at=? WHERE id=?")
      .run(now, order.id);
    audit(db, actor.id, 'CANCEL', 'PRODUCTION_ORDER', order.id, `取消生产工单 ${order.order_no}`);
    return { status: 'CANCELLED' };
  }
  throw new HttpError(400, '不支持的目标状态');
}

export async function changeProductionOrderState(db, req, res, actor, poId) {
  const body = await readJson(req);
  return changeProductionOrderStateByBody(db, body, res, actor, poId);
}

export function changeProductionOrderStateByBody(db, body, res, actor, poId, options = {}) {
  const target = String(body?.target || '').trim().toUpperCase();
  if (!target) throw new HttpError(400, '请提供目标状态');
  const result = transaction(db, () => {
    const order = loadOrder(db, poId);
    if (order.status !== 'CANCELLED' || target !== 'CANCELLED') {
      const legacyPendingStart = options.legacyAction === true && order.status === 'PENDING' && target === 'IN_PROGRESS';
      if (!legacyPendingStart) assertTransition(order, target);
    }
    return transitionOrder(db, actor, order, target, body);
  });
  return send(res, 200, { ok: true, ...result });
}

export function getProductionOrder(db, res, actor, poId) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const order = db.prepare(`SELECT po.*, p.code productCode, p.name productName, b.version bomVersion,
    creator.display_name creatorName, submitted.display_name submittedByName,
    approved.display_name approvedByName, released.display_name releasedByName,
    rejected.display_name rejectedByName
    FROM production_orders po JOIN products p ON p.id=po.product_id
    LEFT JOIN boms b ON b.id=po.bom_id
    JOIN users creator ON creator.id=po.creator_id
    LEFT JOIN users submitted ON submitted.id=po.submitted_by
    LEFT JOIN users approved ON approved.id=po.approved_by
    LEFT JOIN users released ON released.id=po.released_by
    LEFT JOIN users rejected ON rejected.id=po.rejected_by
    WHERE po.id=?`).get(poId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  order.materialListStatus = order.material_list_status || 'GENERATED';
  order.items = db.prepare('SELECT poi.*, p.code productCode, p.name productName, p.unit, p.stock_quantity availableStock, poi.material_list_status materialListStatus FROM production_order_items poi JOIN products p ON p.id=poi.product_id WHERE poi.order_id=? ORDER BY poi.line_no').all(poId);
  const summary = productionRequirementSummary(db, poId);
  order.items = order.items.map((item) => ({ ...item, ...summary.find((s) => (s.id === item.id)) }));
  order.netReceived = productionNetReceived(db, poId);
  order.remainingReceivable = Math.max(0, Number(order.quantity) - order.netReceived);
  order.materialSupportedMaximum = summary.length ? Math.min(...summary.map((item) => item.quantityPerUnit > 0 ? item.netIssued / item.quantityPerUnit : Number(order.quantity))) : 0;
  order.sourceInstruction = order.production_instruction_id ? db.prepare('SELECT id,instruction_no,status FROM production_instructions WHERE id=?').get(order.production_instruction_id) : null;
  const activeRouting = db.prepare("SELECT id,routing_code FROM product_routings WHERE product_id=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1").get(order.product_id);
  order.activeRoutingId = activeRouting?.id || null;
  order.activeRoutingCode = activeRouting?.routing_code || '';
  order.routingSnapshot = db.prepare('SELECT * FROM production_order_routing_snapshots WHERE production_order_id=? ORDER BY sequence_no').all(poId);
  order.operationPlan = db.prepare('SELECT id,sequence_no,operation_code operationCode,operation_name operationName,plan_status planStatus,status executionStatus,topology,is_outsource isOutsource,quality_policy qualityPolicy FROM production_order_operations WHERE production_order_id=? ORDER BY sequence_no').all(poId);
  order.materialIssues = db.prepare('SELECT id,issue_no issueNo,status,issue_date issueDate FROM production_material_issues WHERE production_order_id=? ORDER BY created_at').all(poId);
  order.materialReturns = db.prepare('SELECT id,return_no returnNo,status,return_date returnDate,reason_code reasonCode FROM production_material_returns WHERE production_order_id=? ORDER BY created_at').all(poId);
  order.materialSupplements = db.prepare('SELECT id,supplement_no supplementNo,status,supplement_date supplementDate,reason_code reasonCode FROM production_material_supplements WHERE production_order_id=? ORDER BY created_at').all(poId);
  order.productionReceipts = db.prepare('SELECT id,receipt_no receiptNo,status,quantity,receipt_date receiptDate,quality_state qualityState,nonconforming nonconforming FROM production_receipts WHERE production_order_id=? ORDER BY created_at').all(poId);
  order.receiptReversals = db.prepare('SELECT id,reversal_no reversalNo,status,quantity,reversal_date reversalDate FROM production_receipt_reversals WHERE production_order_id=? ORDER BY created_at').all(poId);
  order.byproducts = db.prepare('SELECT * FROM production_byproducts WHERE production_order_id=? ORDER BY created_at').all(poId);
  order.statusLabel = PO_STATUS[order.status] || order.status;
  return send(res, 200, { order });
}
