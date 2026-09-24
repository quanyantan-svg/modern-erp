import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, send } from '../lib/http.js';
import { idempotencyReplay, requestFingerprint, saveIdempotency } from './financial-controls.js';
import { allocateProportionalCents, assertFinancialPeriodsOpen, createSystemVoucher, postWipMovement } from './financial-inventory.js';
import { productionNetReceived, productionRequirementSummary } from './production-workflow.js';

const EPS = 1e-9;
const SCRAP_REASONS = new Set(['PROCESS_DEFECT', 'MATERIAL_DEFECT', 'SETUP_LOSS', 'QUALITY_FAILURE', 'OTHER']);
const roundCost = (seconds, centsPerHour) => Math.round(Number(seconds) * Number(centsPerHour) / 3600);
const nonNegative = (value, label) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label}必须为非负数`);
  return n;
};
const integerSeconds = (value, label, nullable = false) => {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(400, `${label}必须为非负整数秒`);
  return n;
};
const loadOrder = (db, orderId) => {
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  return order;
};
const reportNo = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;

export function materialSupportedQuantity(db, orderId) {
  const order = loadOrder(db, orderId);
  const requirements = productionRequirementSummary(db, orderId);
  if (!requirements.length) return 0;
  return Math.max(0, Math.min(Number(order.quantity), ...requirements.map((x) => x.quantityPerUnit > 0 ? x.netIssued / x.quantityPerUnit : Number(order.quantity))));
}

function operationTotals(db, operationId) {
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN r.status='CONFIRMED' THEN r.good_quantity ELSE 0 END),0)-COALESCE((SELECT SUM(good_quantity) FROM production_operation_report_reversals WHERE production_operation_id=?),0) good,
    COALESCE(SUM(CASE WHEN r.status='CONFIRMED' THEN r.scrap_quantity ELSE 0 END),0)-COALESCE((SELECT SUM(scrap_quantity) FROM production_operation_report_reversals WHERE production_operation_id=?),0) scrap,
    COALESCE(SUM(CASE WHEN r.status='CONFIRMED' THEN r.labor_seconds ELSE 0 END),0)-COALESCE((SELECT SUM(labor_seconds) FROM production_operation_report_reversals WHERE production_operation_id=?),0) laborSeconds,
    COALESCE(SUM(CASE WHEN r.status='CONFIRMED' THEN r.machine_seconds ELSE 0 END),0)-COALESCE((SELECT SUM(machine_seconds) FROM production_operation_report_reversals WHERE production_operation_id=?),0) machineSeconds,
    SUM(CASE WHEN r.status='CONFIRMED' AND r.machine_seconds IS NULL THEN 1 ELSE 0 END) missingMachineTime
    FROM production_operation_reports r WHERE r.production_operation_id=?`).get(operationId, operationId, operationId, operationId, operationId);
  return { good: Number(row.good), scrap: Number(row.scrap), laborSeconds: Number(row.laborSeconds), machineSeconds: Number(row.machineSeconds), missingMachineTime: Number(row.missingMachineTime) };
}

function operations(db, orderId) {
  return db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? ORDER BY sequence_no,id').all(orderId).map((op) => ({ ...op, ...operationTotals(db, op.id) }));
}

function availableInput(db, operation) {
  const rows = operations(db, operation.production_order_id);
  const index = rows.findIndex((x) => x.id === operation.id);
  const totalInput = index === 0 ? materialSupportedQuantity(db, operation.production_order_id) : rows[index - 1].good;
  return { totalInput, available: Math.max(0, totalInput - rows[index].good - rows[index].scrap), previous: index > 0 ? rows[index - 1] : null, current: rows[index] };
}

function plannedDate(order, index) {
  const base = order.planned_start || order.planned_finish;
  if (!base) return null;
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function ensureCostBaseline(db, order) {
  if (db.prepare('SELECT 1 FROM production_cost_baselines WHERE production_order_id=?').get(order.id)) return;
  const components = db.prepare(`SELECT i.product_id,i.quantity,p.standard_manufacturing_cost_cents unit_cost_cents
    FROM production_order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.line_no`).all(order.id);
  const standardMaterial = components.reduce((sum, x) => sum + Math.round(Number(x.quantity) * Number(x.unit_cost_cents)), 0);
  const ops = db.prepare('SELECT * FROM production_order_operations WHERE production_order_id=? ORDER BY sequence_no').all(order.id);
  const standardLabor = ops.reduce((sum, x) => sum + roundCost(Number(x.setup_seconds) + Number(x.run_seconds_per_unit) * Number(x.planned_input_quantity), x.labor_rate_cents_per_hour), 0);
  const standardOverhead = ops.reduce((sum, x) => sum + roundCost(Number(x.setup_seconds) + Number(x.run_seconds_per_unit) * Number(x.planned_input_quantity), x.overhead_rate_cents_per_hour), 0);
  const total = standardMaterial + standardLabor + standardOverhead;
  db.prepare(`INSERT INTO production_cost_baselines(id,production_order_id,standard_material_cents,standard_labor_cents,standard_overhead_cents,standard_total_cents,standard_unit_cents,component_snapshot_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(id(), order.id, standardMaterial, standardLabor, standardOverhead, total, Number(order.quantity) > 0 ? Math.round(total / Number(order.quantity)) : 0, JSON.stringify(components), new Date().toISOString());
}

function actualMaterialEvidence(db, orderId, requirements, fallbackCosts) {
  let total = 0; let authoritativeQuantity = 0; let requiredQuantity = 0;
  for (const requirement of requirements) {
    const net = Number(requirement.netIssued); requiredQuantity += net;
    const allocations = db.prepare(`SELECT a.quantity,pri.unit_price_cents
      FROM tracked_source_allocations a
      JOIN production_material_issue_items mi ON mi.id=a.source_item_id
      JOIN production_material_issues mh ON mh.id=mi.issue_id AND mh.status='CONFIRMED'
      LEFT JOIN inventory_lots l ON l.id=a.lot_id
      LEFT JOIN inventory_serials s ON s.id=a.serial_id
      LEFT JOIN purchase_receipt_items pri ON pri.id=COALESCE(l.created_source_item_id,s.created_source_item_id)
      WHERE a.source_type='PRODUCTION_MATERIAL_ISSUE' AND a.posted=1 AND a.reversed=0
        AND mh.production_order_id=? AND mi.requirement_line_id=?`).all(orderId, requirement.id);
    const returns = db.prepare(`SELECT a.quantity,pri.unit_price_cents
      FROM tracked_source_allocations a
      JOIN production_material_return_items ri ON ri.id=a.source_item_id
      JOIN production_material_returns rh ON rh.id=ri.return_id AND rh.status='CONFIRMED'
      LEFT JOIN inventory_lots l ON l.id=a.lot_id
      LEFT JOIN inventory_serials s ON s.id=a.serial_id
      LEFT JOIN purchase_receipt_items pri ON pri.id=COALESCE(l.created_source_item_id,s.created_source_item_id)
      WHERE a.source_type='PRODUCTION_MATERIAL_RETURN' AND a.posted=1 AND a.reversed=0
        AND rh.production_order_id=? AND ri.requirement_line_id=?`).all(orderId, requirement.id);
    const authQty = allocations.reduce((s, x) => s + (x.unit_price_cents == null ? 0 : Number(x.quantity)), 0) - returns.reduce((s, x) => s + (x.unit_price_cents == null ? 0 : Number(x.quantity)), 0);
    const authCost = allocations.reduce((s, x) => s + (x.unit_price_cents == null ? 0 : Math.round(Number(x.quantity) * Number(x.unit_price_cents))), 0) - returns.reduce((s, x) => s + (x.unit_price_cents == null ? 0 : Math.round(Number(x.quantity) * Number(x.unit_price_cents))), 0);
    authoritativeQuantity += Math.max(0, authQty); total += authCost + Math.round(Math.max(0, net - authQty) * Number(fallbackCosts.get(requirement.product_id) || 0));
  }
  const quality = requiredQuantity <= EPS || authoritativeQuantity <= EPS ? 'ESTIMATED' : authoritativeQuantity + EPS >= requiredQuantity ? 'AUTHORITATIVE' : 'PARTIAL';
  return { total, quality };
}

export function snapshotManufacturingExecution(db, orderId) {
  const order = loadOrder(db, orderId);
  const snapshots = db.prepare('SELECT * FROM production_order_routing_snapshots WHERE production_order_id=? ORDER BY sequence_no').all(orderId);
  if (!db.prepare('SELECT 1 FROM production_order_operations WHERE production_order_id=?').get(orderId)) {
    const insert = db.prepare(`INSERT INTO production_order_operations(id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_id,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,planned_date,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'NOT_STARTED',?,?)`);
    const now = new Date().toISOString();
    snapshots.forEach((snap, index) => {
      const wc = snap.work_center_id
        ? db.prepare('SELECT * FROM work_centers WHERE id=?').get(snap.work_center_id)
        : db.prepare('SELECT * FROM work_centers WHERE code=? OR name=? LIMIT 1').get(snap.work_center, snap.work_center);
      const setupSeconds = Number(snap.setup_seconds) || Math.round(Number(snap.setup_minutes || 0) * 60);
      const runSeconds = Number(snap.run_seconds_per_unit) || Math.round(Number(snap.run_minutes_per_unit || 0) * 60);
      insert.run(id(), orderId, snap.id, snap.sequence_no, snap.operation_code, snap.operation_name, wc?.id || null, wc?.code || snap.work_center || '', wc?.name || snap.work_center || '', setupSeconds, runSeconds, Number(snap.expected_yield_bps || 10000), Number(wc?.labor_rate_cents_per_hour || snap.labor_rate_cents_per_hour || 0), Number(wc?.overhead_rate_cents_per_hour || snap.overhead_rate_cents_per_hour || 0), Number(wc?.daily_capacity_minutes || snap.daily_capacity_minutes || 480), Number(order.quantity), plannedDate(order, index), now, now);
    });
  }
  ensureCostBaseline(db, order);
}

export function deriveProductionCost(db, orderId, persist = false) {
  const order = loadOrder(db, orderId);
  ensureCostBaseline(db, order);
  const baseline = db.prepare('SELECT * FROM production_cost_baselines WHERE production_order_id=?').get(orderId);
  const requirements = productionRequirementSummary(db, orderId);
  const componentCosts = JSON.parse(baseline.component_snapshot_json || '[]');
  const costByProduct = new Map(componentCosts.map((x) => [x.product_id, Number(x.unit_cost_cents)]));
  const materialEvidence = actualMaterialEvidence(db, orderId, requirements, costByProduct);
  const material = materialEvidence.total;
  const ops = operations(db, orderId);
  const labor = ops.reduce((sum, x) => sum + roundCost(x.laborSeconds, x.labor_rate_cents_per_hour), 0);
  const overheadComplete = ops.every((x) => x.missingMachineTime === 0);
  const overhead = overheadComplete ? ops.reduce((sum, x) => sum + roundCost(x.machineSeconds, x.overhead_rate_cents_per_hour), 0) : null;
  const finalGood = ops.length ? ops.at(-1).good : productionNetReceived(db, orderId);
  const scrap = ops.reduce((sum, x) => sum + x.scrap, 0);
  const total = overhead === null ? null : material + labor + overhead;
  const unit = total !== null && finalGood > EPS ? Math.round(total / finalGood) : null;
  const allowed = Number(order.quantity) > 0 ? Math.round(Number(baseline.standard_total_cents) * finalGood / Number(order.quantity)) : 0;
  const summary = { baseline, status: order.status === 'COMPLETED' ? 'FINAL' : 'PROVISIONAL', materialCostCents: material, laborCostCents: labor, overheadCostCents: overhead, totalCostCents: total, unitCostCents: unit, materialQuality: materialEvidence.quality, overheadComplete, goodQuantity: finalGood, scrapQuantity: scrap, yieldBps: Number(order.quantity) > 0 ? Math.round(finalGood * 10000 / Number(order.quantity)) : 0, scrapRateBps: Number(order.quantity) > 0 ? Math.round(scrap * 10000 / Number(order.quantity)) : 0, totalVarianceCents: total === null ? null : total - allowed, scrapLossCents: Math.round(scrap * Number(baseline.standard_unit_cents)) };
  if (persist) db.prepare(`INSERT INTO production_cost_summaries(id,production_order_id,status,material_cost_cents,labor_cost_cents,overhead_cost_cents,total_cost_cents,unit_cost_cents,material_quality,overhead_complete,good_quantity,scrap_quantity,yield_bps,total_variance_cents,finalized_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(production_order_id) DO UPDATE SET status=excluded.status,material_cost_cents=excluded.material_cost_cents,labor_cost_cents=excluded.labor_cost_cents,overhead_cost_cents=excluded.overhead_cost_cents,total_cost_cents=excluded.total_cost_cents,unit_cost_cents=excluded.unit_cost_cents,material_quality=excluded.material_quality,overhead_complete=excluded.overhead_complete,good_quantity=excluded.good_quantity,scrap_quantity=excluded.scrap_quantity,yield_bps=excluded.yield_bps,total_variance_cents=excluded.total_variance_cents,finalized_at=excluded.finalized_at,updated_at=excluded.updated_at`)
    .run(id(), orderId, summary.status, material, labor, overhead, total, unit, summary.materialQuality, overheadComplete ? 1 : 0, finalGood, scrap, summary.yieldBps, summary.totalVarianceCents, summary.status === 'FINAL' ? new Date().toISOString() : null, new Date().toISOString());
  return summary;
}

export function assertRoutedReceiptLimit(db, orderId, additionalQuantity) {
  const ops = operations(db, orderId);
  if (!ops.length) return;
  const next = productionNetReceived(db, orderId) + Number(additionalQuantity);
  if (next > ops.at(-1).good + EPS) throw new HttpError(409, `累计净入库 ${next} 超过末工序累计良品 ${ops.at(-1).good}`);
}

export function assertRoutedCompletion(db, orderId) {
  const order = loadOrder(db, orderId);
  const ops = operations(db, orderId);
  if (!ops.length) return false;
  if (ops.some((x) => x.status !== 'COMPLETED')) throw new HttpError(409, '所有工序必须先完成');
  if (db.prepare("SELECT 1 FROM production_operation_reports WHERE production_order_id=? AND status='DRAFT'").get(orderId)) throw new HttpError(409, '存在未处理的草稿报工单');
  const good = ops.at(-1).good;
  const scrap = ops.reduce((sum, x) => sum + x.scrap, 0);
  if (Math.abs(productionNetReceived(db, orderId) - good) > EPS) throw new HttpError(409, '净成品入库必须等于末工序累计良品');
  if (Math.abs(good + scrap - Number(order.quantity)) > EPS) throw new HttpError(409, '末工序良品与累计过程报废之和必须等于计划数量');
  return true;
}

export function assertMaterialReturnAfterProcessing(db, requirementLineId, nextNetIssued) {
  const requirement = db.prepare('SELECT * FROM production_order_items WHERE id=?').get(requirementLineId);
  if (!requirement) return;
  const first = operations(db, requirement.order_id)[0];
  if (!first) return;
  const required = (first.good + first.scrap) * Number(requirement.quantity_per_unit || 0);
  if (Number(nextNetIssued) + EPS < required) throw new HttpError(409, `退料后净领料不得低于已加工数量所需 ${required}`);
}

export function getManufacturingExecution(db, res, actor, orderId) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const order = loadOrder(db, orderId);
  const ops = operations(db, orderId).map((op) => { const input = availableInput(db, op); const processed = op.good + op.scrap; return { ...op, inputAvailable: input.totalInput, remainingUnprocessed: input.available, downstreamProcessed: 0, actualYieldBps: processed > 0 ? Math.round(op.good * 10000 / processed) : null, yieldVarianceBps: processed > 0 ? Math.round(op.good * 10000 / processed) - op.expected_yield_bps : null, plannedLoadMinutes: Math.ceil((op.setup_seconds + op.run_seconds_per_unit * op.planned_input_quantity) / 60), actualLoadMinutes: op.missingMachineTime ? null : Math.ceil(op.machineSeconds / 60) }; });
  for (let i = 0; i < ops.length - 1; i += 1) ops[i].downstreamProcessed = ops[i + 1].good + ops[i + 1].scrap;
  return send(res, 200, { order: { id: order.id, orderNo: order.order_no, plannedQuantity: Number(order.quantity), materialSupportedQuantity: materialSupportedQuantity(db, orderId), finalGoodQuantity: ops.at(-1)?.good || 0, scrapQuantity: ops.reduce((s, x) => s + x.scrap, 0), netReceived: productionNetReceived(db, orderId) }, operations: ops });
}

export async function createOperationReport(db, req, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_START');
  const body = await readJson(req); const order = loadOrder(db, body.productionOrderId);
  if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '只有生产中的工单允许报工');
  const operation = db.prepare('SELECT * FROM production_order_operations WHERE id=? AND production_order_id=?').get(body.productionOperationId, order.id);
  if (!operation || operation.status === 'COMPLETED' || operation.status === 'CANCELLED') throw new HttpError(409, '请选择可报工的工序');
  const good = nonNegative(body.goodQuantity, '良品数量'); const scrap = nonNegative(body.scrapQuantity, '报废数量');
  if (good + scrap <= EPS) throw new HttpError(400, '良品与报废数量之和必须大于 0');
  const reason = body.scrapReason ? String(body.scrapReason).toUpperCase() : null;
  if (scrap > EPS && !SCRAP_REASONS.has(reason)) throw new HttpError(400, '报废数量大于 0 时必须选择有效报废原因');
  const now = new Date().toISOString(); const reportId = id();
  db.prepare(`INSERT INTO production_operation_reports(id,report_no,production_order_id,production_operation_id,business_date,good_quantity,scrap_quantity,labor_seconds,machine_seconds,scrap_reason,remark,status,operator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT',?,?,?)`).run(reportId, reportNo('OR'), order.id, operation.id, body.businessDate || now.slice(0, 10), good, scrap, integerSeconds(body.laborSeconds, '人工工时', true), integerSeconds(body.machineSeconds, '设备工时', true), reason, optionalText(body.remark, 500), actor.id, now, now);
  audit(db, actor.id, 'CREATE', 'PRODUCTION_OPERATION_REPORT', reportId, `${operation.operation_code} 报工草稿`);
  return send(res, 201, { id: reportId });
}

export function confirmOperationReport(db, req, res, actor, reportId) {
  allow(actor, 'PRODUCTION_ORDERS_START');
  const key = String(req.headers['idempotency-key'] || `document-${reportId}`); const fingerprint = requestFingerprint({ action: 'confirm' });
  const replay = idempotencyReplay(db, 'OPERATION_REPORT_CONFIRM', reportId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const report = db.prepare('SELECT * FROM production_operation_reports WHERE id=?').get(reportId); if (!report) throw new HttpError(404, '报工单不存在');
    if (report.status !== 'DRAFT') throw new HttpError(409, '只有草稿报工单可以确认');
    const order = loadOrder(db, report.production_order_id); if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '生产工单不在生产中');
    const operation = db.prepare('SELECT * FROM production_order_operations WHERE id=?').get(report.production_operation_id); const input = availableInput(db, operation);
    if (Number(report.good_quantity) + Number(report.scrap_quantity) > input.available + EPS) throw new HttpError(409, `本次报工超过可报工数量 ${input.available}`);
    assertFinancialPeriodsOpen(db,report.business_date);
    const priorConfirmed=Number(db.prepare("SELECT COUNT(*) n FROM production_operation_reports WHERE production_operation_id=? AND status='CONFIRMED' AND id<>?").get(operation.id,reportId).n); const processed=Number(report.good_quantity)+Number(report.scrap_quantity); const seconds=(priorConfirmed?0:Number(operation.setup_seconds))+Number(operation.run_seconds_per_unit)*processed; const laborCents=Math.round(seconds*Number(operation.labor_rate_cents_per_hour)/3600); const overheadCents=Math.round(seconds*Number(operation.overhead_rate_cents_per_hour)/3600); const conversionCents=laborCents+overheadCents;
    const now = new Date().toISOString(); db.prepare("UPDATE production_operation_reports SET status='CONFIRMED',confirmed_by=?,confirmed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, reportId);
    if(conversionCents>0){ const entries=[{role:'WIP',direction:'DEBIT',amountCents:conversionCents},...(laborCents?[{role:'LABOR_ABSORPTION',direction:'CREDIT',amountCents:laborCents}]:[]),...(overheadCents?[{role:'OVERHEAD_ABSORPTION',direction:'CREDIT',amountCents:overheadCents}]:[])]; const voucherId=createSystemVoucher(db,{sourceType:'PRODUCTION_OPERATION_ABSORPTION',sourceId:reportId,businessDate:report.business_date,actorId:actor.id,entries}); postWipMovement(db,{productionOrderId:order.id,businessDate:report.business_date,movementType:'CONVERSION_ABSORPTION',amountCents:conversionCents,sourceType:'PRODUCTION_OPERATION_REPORT',sourceId:reportId,voucherId}); }
    if (operation.status === 'NOT_STARTED') db.prepare("UPDATE production_order_operations SET status='IN_PROGRESS',updated_at=? WHERE id=?").run(now, operation.id);
    deriveProductionCost(db, order.id, true); saveIdempotency(db, 'OPERATION_REPORT_CONFIRM', reportId, key, fingerprint, { ok: true, id: reportId, status: 'CONFIRMED' });
    audit(db, actor.id, 'CONFIRM', 'PRODUCTION_OPERATION_REPORT', reportId, '确认生产报工');
  });
  return send(res, 200, { ok: true });
}

export function cancelOperationReport(db, res, actor, reportId) {
  allow(actor, 'PRODUCTION_ORDERS_START');
  const report = db.prepare('SELECT * FROM production_operation_reports WHERE id=?').get(reportId);
  if (!report) throw new HttpError(404, '报工单不存在');
  if (report.status !== 'DRAFT') throw new HttpError(409, '只有草稿报工单可以取消');
  const now = new Date().toISOString();
  db.prepare("UPDATE production_operation_reports SET status='CANCELLED',updated_at=? WHERE id=?").run(now, reportId);
  audit(db, actor.id, 'CANCEL', 'PRODUCTION_OPERATION_REPORT', reportId, '取消报工草稿');
  return send(res, 200, { ok: true });
}

export async function reverseOperationReport(db, req, res, actor, reportId) {
  allow(actor, 'PRODUCTION_ORDERS_START'); const body = await readJson(req);
  const key = String(req.headers['idempotency-key'] || body.idempotencyKey || ''); if (!key) throw new HttpError(400, '冲销必须提供 Idempotency-Key');
  const values = { goodQuantity: nonNegative(body.goodQuantity, '冲销良品'), scrapQuantity: nonNegative(body.scrapQuantity, '冲销报废'), laborSeconds: integerSeconds(body.laborSeconds, '冲销人工工时'), machineSeconds: integerSeconds(body.machineSeconds, '冲销设备工时'), reason: String(body.reason || '').trim() };
  if (!values.reason) throw new HttpError(400, '必须填写冲销原因'); const fingerprint = requestFingerprint(values);
  const replay = idempotencyReplay(db, 'OPERATION_REPORT_REVERSAL', reportId, key, fingerprint); if (replay) return send(res, 200, { ...replay, replayed: true });
  transaction(db, () => {
    const report = db.prepare("SELECT * FROM production_operation_reports WHERE id=? AND status='CONFIRMED'").get(reportId); if (!report) throw new HttpError(409, '只能冲销已确认报工单');
    if (loadOrder(db, report.production_order_id).status !== 'IN_PROGRESS') throw new HttpError(409, '只有生产中的工单允许冲销报工');
    const reversed = db.prepare('SELECT COALESCE(SUM(good_quantity),0) good,COALESCE(SUM(scrap_quantity),0) scrap,COALESCE(SUM(labor_seconds),0) labor,COALESCE(SUM(machine_seconds),0) machine FROM production_operation_report_reversals WHERE original_report_id=?').get(reportId);
    if (values.goodQuantity > Number(report.good_quantity) - Number(reversed.good) + EPS || values.scrapQuantity > Number(report.scrap_quantity) - Number(reversed.scrap) + EPS || values.laborSeconds > Number(report.labor_seconds || 0) - Number(reversed.labor) || values.machineSeconds > Number(report.machine_seconds || 0) - Number(reversed.machine)) throw new HttpError(409, '冲销数量或工时超过原报工未冲销余额');
    const ops = operations(db, report.production_order_id); const index = ops.findIndex((x) => x.id === report.production_operation_id);
    if (values.goodQuantity > EPS && index < ops.length - 1 && ops[index + 1].good + ops[index + 1].scrap > ops[index].good - values.goodQuantity + EPS) throw new HttpError(409, '该良品已被下游工序消耗，请先冲销下游报工');
    if (values.goodQuantity > EPS && index === ops.length - 1 && productionNetReceived(db, report.production_order_id) > ops[index].good - values.goodQuantity + EPS) throw new HttpError(409, '该良品已支持成品入库，请先冲销生产入库');
    const now = new Date().toISOString(); const reversalId = id(),businessDate=body.businessDate || now.slice(0, 10); assertFinancialPeriodsOpen(db,businessDate); db.prepare(`INSERT INTO production_operation_report_reversals(id,reversal_no,original_report_id,production_order_id,production_operation_id,business_date,good_quantity,scrap_quantity,labor_seconds,machine_seconds,reason,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(reversalId, reportNo('ORR'), reportId, report.production_order_id, report.production_operation_id, businessDate, values.goodQuantity, values.scrapQuantity, values.laborSeconds, values.machineSeconds, values.reason, actor.id, now);
    const originalWip=db.prepare("SELECT * FROM production_wip_movements WHERE source_type='PRODUCTION_OPERATION_REPORT' AND source_id=? AND movement_type='CONVERSION_ABSORPTION'").get(reportId); if(originalWip){const originalQty=Number(report.good_quantity)+Number(report.scrap_quantity),reverseQty=values.goodQuantity+values.scrapQuantity,priorAmount=-Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0)n FROM production_wip_movements WHERE reversal_of_id=?").get(originalWip.id).n),remainingAmount=Number(originalWip.amount_cents)-priorAmount,remainingQty=originalQty-Number(reversed.good)-Number(reversed.scrap),amount=Math.abs(reverseQty-remainingQty)<=EPS?remainingAmount:allocateProportionalCents(Number(originalWip.amount_cents),reverseQty,originalQty);if(amount){const originalVoucher=db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='PRODUCTION_OPERATION_ABSORPTION' AND source_id=?").get(reportId);const credits=db.prepare("SELECT m.role_code role,e.amount_cents amount FROM accounting_entries e JOIN account_role_mappings m ON m.subject_id=e.subject_id WHERE e.voucher_id=? AND e.direction='CREDIT' AND m.role_code IN ('LABOR_ABSORPTION','OVERHEAD_ABSORPTION') ORDER BY m.role_code").all(originalVoucher?.id);let rest=amount;const entries=[{role:'WIP',direction:'CREDIT',amountCents:amount}];credits.forEach((e,i)=>{const part=i===credits.length-1?rest:allocateProportionalCents(Number(originalWip.amount_cents),Math.min(amount,Number(e.amount)),Number(originalWip.amount_cents));rest-=part;entries.push({role:e.role,direction:'DEBIT',amountCents:part});});const voucherId=createSystemVoucher(db,{sourceType:'PRODUCTION_OPERATION_ABSORPTION_REVERSAL',sourceId:reversalId,businessDate,actorId:actor.id,entries,reversalOfId:originalVoucher?.id});postWipMovement(db,{productionOrderId:report.production_order_id,businessDate,movementType:'CONVERSION_ABSORPTION_REVERSAL',amountCents:-amount,sourceType:'PRODUCTION_OPERATION_REPORT_REVERSAL',sourceId:reversalId,voucherId,reversalOfId:originalWip.id});}}
    deriveProductionCost(db, report.production_order_id, true); saveIdempotency(db, 'OPERATION_REPORT_REVERSAL', reportId, key, fingerprint, { ok: true, id: reversalId }); audit(db, actor.id, 'REVERSE', 'PRODUCTION_OPERATION_REPORT', reportId, values.reason);
  }); return send(res, 200, { ok: true });
}

export function completeOperation(db, res, actor, operationId) {
  allow(actor, 'PRODUCTION_ORDERS_COMPLETE'); const operation = db.prepare('SELECT * FROM production_order_operations WHERE id=?').get(operationId); if (!operation) throw new HttpError(404, '生产工序不存在');
  if (loadOrder(db, operation.production_order_id).status !== 'IN_PROGRESS') throw new HttpError(409, '只有生产中的工单允许完成工序');
  if (!['NOT_STARTED', 'IN_PROGRESS'].includes(operation.status)) throw new HttpError(409, '当前工序状态不可完成');
  if (db.prepare("SELECT 1 FROM production_operation_reports WHERE production_operation_id=? AND status='DRAFT'").get(operationId)) throw new HttpError(409, '存在未处理的草稿报工单');
  const rows = operations(db, operation.production_order_id); const index = rows.findIndex((x) => x.id === operationId); const current = rows[index];
  const expected = index === 0 ? Number(loadOrder(db, operation.production_order_id).quantity) : rows[index - 1].good;
  if (index > 0 && rows[index - 1].status !== 'COMPLETED') throw new HttpError(409, '前工序尚未完成，当前工序不能最终完成');
  if (Math.abs(current.good + current.scrap - expected) > EPS) throw new HttpError(409, `工序尚有未核算投入，应核算 ${expected}`);
  const now = new Date().toISOString(); db.prepare("UPDATE production_order_operations SET status='COMPLETED',completed_by=?,completed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, operationId); audit(db, actor.id, 'COMPLETE', 'PRODUCTION_ORDER_OPERATION', operationId, current.operation_name); return send(res, 200, { ok: true });
}

export function cancelOperation(db, res, actor, operationId) {
  allow(actor, 'PRODUCTION_ORDERS_COMPLETE'); const operation = db.prepare('SELECT * FROM production_order_operations WHERE id=?').get(operationId); if (!operation) throw new HttpError(404, '生产工序不存在');
  if (loadOrder(db, operation.production_order_id).status !== 'IN_PROGRESS') throw new HttpError(409, '只有生产中的工单允许取消工序');
  if (operation.status !== 'NOT_STARTED') throw new HttpError(409, '只有未开始且无报工历史的工序可以取消');
  if (db.prepare('SELECT 1 FROM production_operation_reports WHERE production_operation_id=?').get(operationId)) throw new HttpError(409, '已有报工历史的工序不能取消');
  const now = new Date().toISOString(); db.prepare("UPDATE production_order_operations SET status='CANCELLED',updated_at=? WHERE id=?").run(now, operationId); audit(db, actor.id, 'CANCEL', 'PRODUCTION_ORDER_OPERATION', operationId, operation.operation_name); return send(res, 200, { ok: true });
}

export function manufacturingWipReport(db, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW'); const orders = db.prepare("SELECT id,order_no,product_id,quantity,planned_finish FROM production_orders WHERE status='IN_PROGRESS' ORDER BY planned_finish,order_no").all();
  return send(res, 200, { rows: orders.map((order) => { const ops = operations(db, order.id); const current = ops.find((x) => x.status !== 'COMPLETED'); return { orderId: order.id, orderNo: order.order_no, plannedQuantity: Number(order.quantity), materialSupportedQuantity: materialSupportedQuantity(db, order.id), currentOperation: current?.operation_name || '', operationGood: current?.good || 0, operationScrap: current?.scrap || 0, finalGood: ops.at(-1)?.good || 0, scrap: ops.reduce((s, x) => s + x.scrap, 0), netReceived: productionNetReceived(db, order.id), plannedFinish: order.planned_finish }; }) });
}

export function manufacturingCapacityReport(db, res, actor, url) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW'); const date = url.searchParams.get('date') || '';
  const rows = db.prepare(`SELECT work_center_id,work_center_code,work_center_name,planned_date,daily_capacity_minutes,
    SUM((setup_seconds+run_seconds_per_unit*planned_input_quantity)/60.0) planned_minutes
    FROM production_order_operations WHERE work_center_id IS NOT NULL AND (?='' OR planned_date=?) GROUP BY work_center_id,planned_date ORDER BY planned_date,work_center_code`).all(date, date).map((row) => {
      const actual = db.prepare(`SELECT COALESCE(SUM(r.machine_seconds),0)-COALESCE(SUM(v.machine_seconds),0) seconds FROM production_operation_reports r LEFT JOIN (SELECT original_report_id,SUM(machine_seconds) machine_seconds FROM production_operation_report_reversals GROUP BY original_report_id) v ON v.original_report_id=r.id WHERE r.status='CONFIRMED' AND r.production_operation_id IN (SELECT id FROM production_order_operations WHERE work_center_id=? AND planned_date=?)`).get(row.work_center_id, row.planned_date);
      const actualMinutes = Number(actual.seconds) / 60; return { ...row, planned_minutes: Math.ceil(row.planned_minutes), actual_minutes: Math.ceil(actualMinutes), planned_utilization_bps: row.daily_capacity_minutes ? Math.round(row.planned_minutes * 10000 / row.daily_capacity_minutes) : 0, actual_utilization_bps: row.daily_capacity_minutes ? Math.round(actualMinutes * 10000 / row.daily_capacity_minutes) : 0, overloaded: row.planned_minutes > row.daily_capacity_minutes + EPS };
    }); return send(res, 200, { rows });
}

export function manufacturingYieldReport(db, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW'); const orders = db.prepare('SELECT id,order_no,product_id,quantity FROM production_orders WHERE EXISTS(SELECT 1 FROM production_order_operations WHERE production_order_id=production_orders.id) ORDER BY created_at DESC').all();
  return send(res, 200, { rows: orders.map((o) => { const ops = operations(db, o.id); const good = ops.at(-1)?.good || 0; const scrap = ops.reduce((s, x) => s + x.scrap, 0); return { orderId: o.id, orderNo: o.order_no, plannedQuantity: Number(o.quantity), goodQuantity: good, scrapQuantity: scrap, yieldBps: o.quantity ? Math.round(good * 10000 / o.quantity) : 0, scrapRateBps: o.quantity ? Math.round(scrap * 10000 / o.quantity) : 0 }; }) });
}

export function manufacturingCostReport(db, res, actor) {
  allow(actor, 'PRODUCTION_COSTS_VIEW'); const orders = db.prepare('SELECT id,order_no FROM production_orders WHERE EXISTS(SELECT 1 FROM production_cost_baselines WHERE production_order_id=production_orders.id) ORDER BY created_at DESC').all();
  return send(res, 200, { analyticalOnly: true, currency: 'CNY', rows: orders.map((o) => ({ orderId: o.id, orderNo: o.order_no, ...deriveProductionCost(db, o.id, false) })) });
}

export function reconcileProductionCosts(db, res, actor) {
  allow(actor, 'PRODUCTION_COSTS_VIEW'); const mismatches = []; const cached = db.prepare('SELECT * FROM production_cost_summaries').all();
  for (const row of cached) { const actual = deriveProductionCost(db, row.production_order_id, false); if (Number(row.material_cost_cents) !== actual.materialCostCents || Number(row.labor_cost_cents) !== actual.laborCostCents || row.overhead_cost_cents !== actual.overheadCostCents || row.total_cost_cents !== actual.totalCostCents) mismatches.push({ productionOrderId: row.production_order_id, cached: row, recomputed: actual }); }
  audit(db, actor.id, 'CHECK', 'PRODUCTION_COST_RECONCILIATION', 'all', `${mismatches.length} mismatch(es)`); return send(res, 200, { ok: mismatches.length === 0, checkOnly: true, mismatches });
}
