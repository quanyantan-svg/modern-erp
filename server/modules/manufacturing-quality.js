// V18 Manufacturing & Quality Domain Closure — Manufacturing Quality Master + Inspection Execution.
//
// Wave E:
//   - Inspection Item Master (inspection_items)
//   - Detection Value Master (inspection_detection_values)
//   - Inspection Instrument Master (inspection_instruments)
//   - Inspection Plan (inspection_plans + inspection_plan_items)
//
// Wave F:
//   - Production Inspection execution (production_inspections + items)
//   - Operation Inspection (released_quantity on production_operation_reports)
//   - Product Inspection / Production Receipt Quality Gate
//   - Nonconforming Receipt boundary (LOT/SERIAL HOLD)

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, optionalText, readJson, requiredText, send } from '../lib/http.js';
import { calculateSampleQuantity } from './traceability-quality.js';

// The controlled inspection kinds. The server validates the submitted kind
// against this vocabulary, so a typo can never be stored as a valid type.
export const PRODUCTION_INSPECTION_TYPES = Object.freeze(new Set([
  'NORMAL', 'SAMPLING', 'FULL', 'FIRST_ARTICLE', 'PATROL', 'FINAL', 'REGRESSION', 'REWORK',
]));

// Resolve the sampling decision for a production inspection.
//
// The inspection plan is the WHAT. The quality control point linked to the
// plan is the WHEN and the HOW MUCH: `inspection_required` says whether an
// inspection has to happen at all, and `sampling_mode / sampling_value` say how
// much of the source quantity is actually inspected. The sampling engine is
// the existing `calculateSampleQuantity` — this domain does not build a second
// sampling engine.
function resolveInspectionSampling(db, planId, sourceQuantity, productId, businessDate) {
  const plan = planId ? db.prepare('SELECT * FROM inspection_plans WHERE id=?').get(planId) : null;
  const qcp = plan?.qcp_id
    ? db.prepare('SELECT * FROM quality_control_points WHERE id=?').get(plan.qcp_id)
    : null;
  const mode = String(qcp?.sampling_mode || 'FULL').toUpperCase();
  const value = qcp?.sampling_value ?? null;
  const quantity = calculateSampleQuantity(
    sourceQuantity > 0 ? sourceQuantity : 0,
    mode,
    mode === 'FULL' ? null : value,
  );
  return {
    mode,
    value,
    quantity,
    qcpId: qcp?.id || null,
    inspectionRequired: qcp ? Number(qcp.inspection_required || 0) === 1 : true,
  };
}

// ============ Inspection Item ============

export function listInspectionItems(db, res, actor, url) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_VIEW');
  const rows = db.prepare('SELECT * FROM inspection_items ORDER BY code LIMIT 200').all();
  return send(res, 200, { items: rows });
}

export async function createInspectionItem(db, req, res, actor) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '检验项目代码', 50);
  const name = requiredText(body.name, '检验项目名称', 200);
  if (db.prepare('SELECT 1 FROM inspection_items WHERE code=?').get(code)) throw new HttpError(409, '检验项目代码已存在');
  const itemId = id();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO inspection_items(id,code,name,category,analysis_method,standard,unit,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    itemId, code, name, optionalText(body.category, 50) || '', optionalText(body.analysisMethod || body.analysis_method, 100) || '',
    optionalText(body.standard, 500) || '', optionalText(body.unit, 20) || '', body.active === false ? 0 : 1, now, now,
  );
  audit(db, actor.id, 'CREATE', 'INSPECTION_ITEM', itemId, `创建检验项目 ${code}`);
  return send(res, 201, { id: itemId });
}

export function getInspectionItem(db, res, actor, itemId) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_VIEW');
  const item = db.prepare('SELECT * FROM inspection_items WHERE id=?').get(itemId);
  if (!item) throw new HttpError(404, '检验项目不存在');
  item.detectionValues = db.prepare('SELECT * FROM inspection_detection_values WHERE item_id=?').all(item.id);
  return send(res, 200, { item });
}

// ============ Detection Value ============

export async function createInspectionDetectionValue(db, req, res, actor) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_MANAGE');
  const body = await readJson(req);
  const itemId = String(body.itemId || '').trim();
  if (!db.prepare('SELECT 1 FROM inspection_items WHERE id=?').get(itemId)) throw new HttpError(400, '检验项目不存在');
  const label = requiredText(body.label, '检测值显示名称', 100);
  const value = requiredText(body.value, '检测值代码', 50);
  const dvId = id();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO inspection_detection_values(id,item_id,label,value,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(dvId, itemId, label, value, body.active === false ? 0 : 1, now, now);
  audit(db, actor.id, 'CREATE', 'INSPECTION_DETECTION_VALUE', dvId, `创建检测值 ${label}`);
  return send(res, 201, { id: dvId });
}

// The detection value list is the read side of the detection value master. It
// is filtered by the inspection item so the quality configuration surface can
// offer the values of one item without loading the whole master.
export function listInspectionDetectionValues(db, res, actor, url) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_VIEW');
  const itemId = url.searchParams.get('itemId');
  const rows = itemId
    ? db.prepare('SELECT * FROM inspection_detection_values WHERE item_id=? ORDER BY created_at').all(itemId)
    : db.prepare('SELECT * FROM inspection_detection_values ORDER BY created_at LIMIT 500').all();
  return send(res, 200, { values: rows });
}

// ============ Inspection Instrument ============

export function listInspectionInstruments(db, res, actor) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_VIEW');
  const rows = db.prepare('SELECT * FROM inspection_instruments ORDER BY code LIMIT 200').all();
  return send(res, 200, { instruments: rows });
}

export async function createInspectionInstrument(db, req, res, actor) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '仪器代码', 50);
  const name = requiredText(body.name, '仪器名称', 200);
  if (db.prepare('SELECT 1 FROM inspection_instruments WHERE code=?').get(code)) throw new HttpError(409, '仪器代码已存在');
  const insId = id();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO inspection_instruments(id,code,name,specification,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`).run(insId, code, name, optionalText(body.specification, 500) || '', body.active === false ? 0 : 1, now, now);
  audit(db, actor.id, 'CREATE', 'INSPECTION_INSTRUMENT', insId, `创建检验仪器 ${code}`);
  return send(res, 201, { id: insId });
}

// ============ Inspection Plan ============

export function listInspectionPlans(db, res, actor, url) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_VIEW');
  const productId = url.searchParams.get('productId');
  const targetType = url.searchParams.get('targetType');
  const clauses = []; const ps = [];
  if (productId) { clauses.push('product_id=?'); ps.push(productId); }
  if (targetType && ['PRODUCT','MATERIAL'].includes(targetType.toUpperCase())) { clauses.push('target_type=?'); ps.push(targetType.toUpperCase()); }
  const rows = db.prepare(`SELECT * FROM inspection_plans ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY code LIMIT 200`).all(...ps);
  return send(res, 200, { plans: rows });
}

export async function createInspectionPlan(db, req, res, actor) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '检验方案代码', 50);
  const name = requiredText(body.name, '检验方案名称', 200);
  const targetType = String(body.targetType || '').toUpperCase();
  if (!['PRODUCT', 'MATERIAL'].includes(targetType)) throw new HttpError(400, '目标类型不正确');
  if (db.prepare('SELECT 1 FROM inspection_plans WHERE code=?').get(code)) throw new HttpError(409, '检验方案代码已存在');
  const productId = body.productId || null;
  if (productId && !db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new HttpError(400, '关联产品不存在');
  const planId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO inspection_plans(id,code,name,target_type,target_id,product_id,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(planId, code, name, targetType, body.targetId || null, productId, body.active === false ? 0 : 1, now, now);
    const items = Array.isArray(body.items) ? body.items : [];
    const seen2 = new Map();
    const insertItem = db.prepare(`INSERT INTO inspection_plan_items(id,plan_id,sequence,item_id,criterion_name,specification,result_type,min_value,max_value,unit,instrument_id,required,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let i = 0; i < items.length; i += 1) {
      const x = items[i];
      const itemId = String(x.itemId || '').trim();
      if (!db.prepare('SELECT 1 FROM inspection_items WHERE id=?').get(itemId)) throw new HttpError(400, `第 ${i + 1} 行检验项目无效`);
      const seq = Number.isFinite(Number(x.sequence)) ? Math.trunc(Number(x.sequence)) : i + 1;
      if (seen2.has(seq)) throw new HttpError(400, '方案明细顺序号重复');
      seen2.set(seq, true);
      const resultType = String(x.resultType || 'PASS_FAIL').toUpperCase();
      if (!['PASS_FAIL', 'NUMERIC', 'TEXT'].includes(resultType)) throw new HttpError(400, '结果类型不正确');
      const instrumentId = x.instrumentId || null;
      if (instrumentId && !db.prepare('SELECT 1 FROM inspection_instruments WHERE id=?').get(instrumentId)) throw new HttpError(400, `第 ${i + 1} 行仪器不存在`);
      insertItem.run(id(), planId, seq, itemId, requiredText(x.criterionName || x.criterion_name, '检验准则', 200),
        optionalText(x.specification, 200) || '', resultType,
        x.minValue === undefined || x.minValue === null ? null : Number(x.minValue),
        x.maxValue === undefined || x.maxValue === null ? null : Number(x.maxValue),
        optionalText(x.unit, 20) || '', instrumentId, x.required === false ? 0 : 1, now);
    }
    audit(db, actor.id, 'CREATE', 'INSPECTION_PLAN', planId, `创建检验方案 ${code}`);
  });
  return send(res, 201, { id: planId });
}

export function getInspectionPlan(db, res, actor, planId) {
  allow(actor, 'PRODUCTION_QUALITY_CONFIG_VIEW');
  const plan = db.prepare('SELECT * FROM inspection_plans WHERE id=?').get(planId);
  if (!plan) throw new HttpError(404, '检验方案不存在');
  plan.items = db.prepare(`SELECT pi.*, ii.code itemCode, ii.name itemName, ix.code instrumentCode, ix.name instrumentName
    FROM inspection_plan_items pi
    LEFT JOIN inspection_items ii ON ii.id=pi.item_id
    LEFT JOIN inspection_instruments ix ON ix.id=pi.instrument_id
    WHERE pi.plan_id=? ORDER BY pi.sequence`).all(planId);
  return send(res, 200, { plan });
}

// ============ Operation / Product Inspection ============

function buildInspectionCode(prefix) {
  const now = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${now}-${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
}

export async function createProductionInspection(db, req, res, actor) {
  allow(actor, 'PRODUCTION_INSPECTION_MANAGE');
  const body = await readJson(req);
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(body.productionOrderId);
  if (!order) throw new HttpError(400, '生产工单不存在');
  const sourceType = String(body.sourceType || '').trim();
  if (!['OPERATION_REPORT', 'PRODUCTION_RECEIPT'].includes(sourceType)) throw new HttpError(400, '来源类型不正确');
  const sourceId = String(body.sourceId || '').trim();
  if (!sourceId) throw new HttpError(400, '请提供来源单据');
  // The inspection kind is a controlled vocabulary. A free-text kind used to
  // be written straight to the column, which made the stored value
  // unqueryable and let a typo masquerade as a valid inspection type.
  const inspectionType = String(body.inspectionType || 'NORMAL').toUpperCase();
  if (!PRODUCTION_INSPECTION_TYPES.has(inspectionType)) {
    throw new HttpError(400, `检验类型不正确，可用类型：${[...PRODUCTION_INSPECTION_TYPES].join(' / ')}`);
  }
  let productionOperationId = null;
  let sourceQuantity = 0;
  if (sourceType === 'OPERATION_REPORT') {
    const report = db.prepare("SELECT * FROM production_operation_reports WHERE id=? AND production_order_id=?").get(sourceId, order.id);
    if (!report) throw new HttpError(400, '工序报工单不存在');
    productionOperationId = report.production_operation_id;
    sourceQuantity = Number(report.good_quantity || 0) + Number(report.scrap_quantity || 0);
  } else {
    const receipt = db.prepare("SELECT * FROM production_receipts WHERE id=? AND production_order_id=?").get(sourceId, order.id);
    if (!receipt) throw new HttpError(400, '生产入库单不存在');
    sourceQuantity = Number(receipt.quantity || 0);
  }
  // The "when / what" relation: the inspection plan carries the WHAT (the
  // criteria), and the quality control point linked to the plan carries the
  // WHEN (is an inspection required at all) and the HOW MUCH (the sampling
  // rule). Both are frozen onto the inspection so a later policy change can
  // never rewrite a decision that was already taken.
  const sampling = resolveInspectionSampling(db, body.planId, sourceQuantity, order.product_id, body.businessDate);
  const inspectionId = id();
  const code = buildInspectionCode(sourceType === 'OPERATION_REPORT' ? 'POI' : 'PPI');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_inspections(id,code,production_order_id,production_operation_id,source_type,source_id,plan_id,inspection_type,status,business_date,inspector_id,creator_id,remark,created_at,updated_at,sampling_mode,sampling_value,sample_quantity)
      VALUES(?,?,?,?,?,?,?,?, 'DRAFT', ?, ?, ?, ?, ?, ?,?,?,?)`).run(
      inspectionId, code, order.id, productionOperationId, sourceType, sourceId, body.planId || null,
      inspectionType,
      body.businessDate || now.slice(0, 10), actor.id, actor.id, optionalText(body.remark, 500) || '', now, now,
      sampling.mode, sampling.value, sampling.quantity,
    );
    const planId = body.planId;
    if (planId) {
      const items = db.prepare('SELECT * FROM inspection_plan_items WHERE plan_id=? ORDER BY sequence').all(planId);
      const insert = db.prepare(`INSERT INTO production_inspection_items(id,inspection_id,plan_item_id,criterion_name,specification,result_type,min_value,max_value,unit,instrument_id,passed,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?, NULL, ?)`);
      for (const x of items) {
        insert.run(id(), inspectionId, x.id, x.criterion_name, x.specification, x.result_type, x.min_value, x.max_value, x.unit, x.instrument_id, now);
      }
    } else if (Array.isArray(body.items)) {
      const insert = db.prepare(`INSERT INTO production_inspection_items(id,inspection_id,plan_item_id,criterion_name,specification,result_type,min_value,max_value,unit,instrument_id,passed,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?, NULL, ?)`);
      for (const x of body.items) {
        insert.run(id(), inspectionId, null, requiredText(x.criterionName || x.criterion_name, '检验准则', 200),
          optionalText(x.specification, 200) || '', String(x.resultType || 'PASS_FAIL').toUpperCase(),
          x.minValue === undefined || x.minValue === null ? null : Number(x.minValue),
          x.maxValue === undefined || x.maxValue === null ? null : Number(x.maxValue),
          optionalText(x.unit, 20) || '', x.instrumentId || null, now);
      }
    }
    audit(db, actor.id, 'CREATE', 'PRODUCTION_INSPECTION', inspectionId, `创建 ${sourceType === 'OPERATION_REPORT' ? '工序' : '产品'} 检验单 ${code}`);
  });
  return send(res, 201, { id: inspectionId, code });
}

export function getProductionInspection(db, res, actor, inspectionId) {
  allow(actor, 'PRODUCTION_INSPECTION_VIEW');
  const insp = db.prepare(`SELECT i.*, po.order_no productionOrderNo, creator.display_name creatorName, inspector.display_name inspectorName, completed.display_name confirmedByName
    FROM production_inspections i
    JOIN production_orders po ON po.id=i.production_order_id
    JOIN users creator ON creator.id=i.creator_id
    LEFT JOIN users inspector ON inspector.id=i.inspector_id
    LEFT JOIN users completed ON completed.id=i.inspector_id
    WHERE i.id=?`).get(inspectionId);
  if (!insp) throw new HttpError(404, '生产检验单不存在');
  insp.items = db.prepare(`SELECT * FROM production_inspection_items WHERE inspection_id=? ORDER BY id`).all(inspectionId);
  return send(res, 200, { inspection: insp });
}

export function listProductionInspections(db, res, actor, url) {
  allow(actor, 'PRODUCTION_INSPECTION_VIEW');
  const orderId = url.searchParams.get('productionOrderId');
  const status = url.searchParams.get('status');
  const sourceType = url.searchParams.get('sourceType');
  const clauses = []; const ps = [];
  if (orderId) { clauses.push('i.production_order_id=?'); ps.push(orderId); }
  if (status && ['DRAFT','COMPLETED','CANCELLED'].includes(status)) { clauses.push('i.status=?'); ps.push(status); }
  if (sourceType && ['OPERATION_REPORT', 'PRODUCTION_RECEIPT'].includes(sourceType)) { clauses.push('i.source_type=?'); ps.push(sourceType); }
  const rows = db.prepare(`SELECT i.*, po.order_no productionOrderNo, po.status productionOrderStatus
    FROM production_inspections i JOIN production_orders po ON po.id=i.production_order_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY i.created_at DESC LIMIT 100`).all(...ps);
  return send(res, 200, { inspections: rows });
}

export async function completeProductionInspection(db, req, res, actor, inspectionId) {
  allow(actor, 'PRODUCTION_INSPECTION_MANAGE');
  const body = await readJson(req);
  const result = String(body.result || '').trim().toUpperCase();
  if (!['PASS', 'FAIL'].includes(result)) throw new HttpError(400, '结果必须是 PASS 或 FAIL');
  transaction(db, () => {
    const insp = db.prepare('SELECT * FROM production_inspections WHERE id=?').get(inspectionId);
    if (!insp) throw new HttpError(404, '生产检验单不存在');
    if (insp.status !== 'DRAFT') throw new HttpError(409, '只有草稿检验单可以确认');
    const items = db.prepare('SELECT * FROM production_inspection_items WHERE inspection_id=?').all(inspectionId);
    const submitted = new Map((body.items || []).map((x) => [String(x.id || ''), x]));
    const now = new Date().toISOString();
    let allPassed = true;
    const updateStmt = db.prepare(`UPDATE production_inspection_items SET pass_fail_result=?,numeric_result=?,text_result=?,passed=? WHERE id=?`);
    for (const item of items) {
      const x = submitted.get(String(item.id)) || {};
      let passed = true;
      if (item.result_type === 'PASS_FAIL') {
        const r = String(x.passFailResult || x.pass_fail_result || '').trim().toUpperCase();
        if (!['PASS','FAIL'].includes(r)) passed = false;
        else passed = r === 'PASS';
        updateStmt.run(r, null, null, passed ? 1 : 0, item.id);
      } else if (item.result_type === 'NUMERIC') {
        const n = Number(x.numericResult ?? x.numeric_result);
        if (!Number.isFinite(n)) { passed = false; updateStmt.run(null, null, null, 0, item.id); }
        else {
          passed = (item.min_value === null || n >= item.min_value) && (item.max_value === null || n <= item.max_value);
          updateStmt.run(null, n, null, passed ? 1 : 0, item.id);
        }
      } else {
        const t = String(x.textResult || x.text_result || '').trim();
        passed = Boolean(t);
        updateStmt.run(null, null, t, passed ? 1 : 0, item.id);
      }
      if (!passed) allPassed = false;
    }
    if (result === 'PASS' && !allPassed) throw new HttpError(409, '存在未通过检验项，不能完成 PASS');
    if (result === 'FAIL' && allPassed) throw new HttpError(409, '全部检验项已通过，不能完成 FAIL');
    db.prepare(`UPDATE production_inspections SET status='COMPLETED',result=?,inspector_id=?,confirmed_at=?,remark=?,updated_at=? WHERE id=?`).run(
      result, actor.id, now, optionalText(body.remark || insp.remark, 500) || '', now, inspectionId,
    );
    if (insp.source_type === 'OPERATION_REPORT') {
      const released = Math.max(0, Number(body.releasedQuantity || (result === 'PASS' ? Number(db.prepare('SELECT good_quantity FROM production_operation_reports WHERE id=?').get(insp.source_id)?.good_quantity || 0) : 0)));
      db.prepare("UPDATE production_operation_reports SET released_quantity=?,inspection_id=? WHERE id=?").run(released, inspectionId, insp.source_id);
    } else if (insp.source_type === 'PRODUCTION_RECEIPT') {
      db.prepare("UPDATE production_receipts SET quality_state=?,quality_inspection_id=? WHERE id=?").run(result, inspectionId, insp.source_id);
    }
    audit(db, actor.id, `INSPECTION_${result}`, 'PRODUCTION_INSPECTION', inspectionId, `${result === 'PASS' ? '通过' : '未通过'} 检验 ${insp.code}`);
  });
  return send(res, 200, { ok: true });
}

export function cancelProductionInspection(db, res, actor, inspectionId) {
  allow(actor, 'PRODUCTION_INSPECTION_MANAGE');
  const insp = db.prepare('SELECT * FROM production_inspections WHERE id=?').get(inspectionId);
  if (!insp) throw new HttpError(404, '生产检验单不存在');
  if (insp.status !== 'DRAFT') throw new HttpError(409, '只有草稿检验单可以取消');
  db.prepare("UPDATE production_inspections SET status='CANCELLED',cancelled_at=?,updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), inspectionId);
  audit(db, actor.id, 'CANCEL', 'PRODUCTION_INSPECTION', inspectionId, `取消生产检验 ${insp.code}`);
  return send(res, 200, { ok: true });
}

// ============ Quality gate enforcement ============

// Returns true if the operation report must be inspected (quality policy demands).
// For V18 we conservatively enable policy-driven inspection by checking whether
// an inspection_plan targets the operation's product. The plan is found by
// product_id; it does NOT block confirmation, but downstream handlers can call
// this to determine if they should require an inspection.
export function isOperationInspectionRequired(db, operation, productId) {
  if (operation && typeof operation === 'object') {
    const method = String(operation.control_inspection_method || '').toUpperCase();
    const policy = String(operation.quality_policy || '').toUpperCase();
    if (method && !['NONE', 'EXEMPT'].includes(method)) return true;
    if (policy && !['NONE', 'EXEMPT'].includes(policy)) return true;
  } else {
    productId = operation;
  }
  if (!productId) return false;
  return Boolean(db.prepare("SELECT 1 FROM inspection_plans WHERE target_type='PRODUCT' AND product_id=? AND active=1 LIMIT 1").get(productId));
}

export function assertOperationInspectionCompliance(db, operationReportId) {
  const report = db.prepare('SELECT * FROM production_operation_reports WHERE id=?').get(operationReportId);
  if (!report) return;
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(report.production_order_id);
  if (!order) return;
  const operation = db.prepare('SELECT * FROM production_order_operations WHERE id=?').get(report.production_operation_id);
  const required = isOperationInspectionRequired(db, operation, order.product_id);
  if (!required) return;
  // Released quantity cannot exceed quality-released quantity when policy requires inspection.
  if (Number(report.released_quantity || 0) > Number(report.good_quantity || 0) + 1e-9) {
    throw new HttpError(409, '工序报工的合格释放量不能超过良品数量');
  }
  if (db.prepare('SELECT id FROM production_inspections WHERE source_type=? AND source_id=? AND status=?').get('OPERATION_REPORT', operationReportId, 'COMPLETED')) {
    return;
  }
  // No completed inspection but policy requires it. Downstream handlers may choose to
  // block; here we simply ensure released_quantity has not been pre-set without evidence.
  if (Number(report.released_quantity || 0) > 0) {
    throw new HttpError(409, '质量策略要求检验，必须存在已完成的检验单据');
  }
}

export function assertProductionReceiptQualityGate(db, receiptId) {
  const receipt = db.prepare(`SELECT r.*,o.product_id order_product_id FROM production_receipts r
    JOIN production_orders o ON o.id=r.production_order_id WHERE r.id=?`).get(receiptId);
  if (!receipt) throw new HttpError(404, '生产入库单不存在');
  const plan = db.prepare("SELECT * FROM inspection_plans WHERE target_type='PRODUCT' AND product_id=? AND active=1 ORDER BY created_at DESC LIMIT 1").get(receipt.order_product_id);
  if (!plan) return;
  // The quality control point linked to the plan carries the WHEN: a point
  // that does not require an inspection means the receipt is not gated. With
  // no linked point the plan stays fail-closed and an inspection must pass.
  const qcp = plan.qcp_id ? db.prepare('SELECT * FROM quality_control_points WHERE id=?').get(plan.qcp_id) : null;
  if (qcp && Number(qcp.inspection_required || 0) === 0) return;
  const inspection = db.prepare("SELECT * FROM production_inspections WHERE source_type='PRODUCTION_RECEIPT' AND source_id=? AND status='COMPLETED' ORDER BY confirmed_at DESC LIMIT 1").get(receiptId);
  if (!inspection) throw new HttpError(409, '该生产入库需先完成产品检验并通过');
  if (inspection.result === 'WAIVED') {
    // A waiver is a controlled decision: it must carry the waiver person and
    // the reason, and the receipt must carry the same provenance.
    if (!inspection.waived_by || !inspection.waive_reason) throw new HttpError(409, '检验放行缺少放行人或放行原因');
    if (receipt.quality_state !== 'WAIVED') throw new HttpError(409, '生产入库单未登记检验放行');
    return;
  }
  if (inspection.result !== 'PASS') {
    // A failed inspection may only be received when the receipt is explicitly
    // marked nonconforming; the identities are then isolated by a HOLD.
    if (Number(receipt.nonconforming || 0) !== 1) throw new HttpError(409, '该生产入库需先完成产品检验并通过');
    if (!receipt.nonconforming_reason) throw new HttpError(409, '不合格入库必须填写不合格原因');
    return;
  }
  if (receipt.quality_state !== 'PASS') throw new HttpError(409, '生产入库单质量状态与检验结论不一致');
}

// ============ Inspection worklist, waiver and nonconforming disposition ============

// The pending worklist: the drafts that still need a decision. The quality
// execution surface is driven from this list, so an inspector never has to
// type an identifier to find the work.
export function listPendingProductionInspections(db, res, actor, url) {
  allow(actor, 'PRODUCTION_INSPECTION_VIEW');
  const sourceType = url.searchParams.get('sourceType');
  const clauses = ["i.status='DRAFT'"];
  const ps = [];
  if (sourceType && ['OPERATION_REPORT', 'PRODUCTION_RECEIPT'].includes(sourceType)) { clauses.push('i.source_type=?'); ps.push(sourceType); }
  const rows = db.prepare(`SELECT i.*, po.order_no productionOrderNo, po.product_id productId,
    po.quantity orderQuantity, op.operation_code operationCode, op.operation_name operationName
    FROM production_inspections i JOIN production_orders po ON po.id=i.production_order_id
    LEFT JOIN production_order_operations op ON op.id=i.production_operation_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY i.created_at ASC LIMIT 200`).all(...ps);
  return send(res, 200, { inspections: rows });
}

// A waiver releases the source document without a passing inspection. It is
// not a silent escape: it requires a reason and it is attributed.
export async function waiveProductionInspection(db, req, res, actor, inspectionId) {
  allow(actor, 'PRODUCTION_INSPECTION_MANAGE');
  const body = await readJson(req);
  const reason = requiredText(body.reason, '放行原因', 500);
  const now = new Date().toISOString();
  transaction(db, () => {
    const insp = db.prepare('SELECT * FROM production_inspections WHERE id=?').get(inspectionId);
    if (!insp) throw new HttpError(404, '生产检验单不存在');
    if (insp.status !== 'DRAFT') throw new HttpError(409, '只有草稿检验单可以放行');
    const items = db.prepare('SELECT * FROM production_inspection_items WHERE inspection_id=?').all(inspectionId);
    db.prepare('UPDATE production_inspection_items SET passed=NULL WHERE inspection_id=?').run(inspectionId);
    db.prepare(`UPDATE production_inspections SET status='COMPLETED',result='WAIVED',waived_by=?,waived_at=?,waive_reason=?,inspector_id=?,confirmed_at=?,remark=?,updated_at=? WHERE id=?`)
      .run(actor.id, now, reason, actor.id, now, optionalText(body.remark || insp.remark, 500) || '', now, inspectionId);
    if (insp.source_type === 'PRODUCTION_RECEIPT') {
      db.prepare("UPDATE production_receipts SET quality_state='WAIVED',quality_inspection_id=?,quality_waived_by=?,quality_waived_at=?,quality_waive_reason=? WHERE id=?")
        .run(inspectionId, actor.id, now, reason, insp.source_id);
    }
    audit(db, actor.id, 'INSPECTION_WAIVED', 'PRODUCTION_INSPECTION', inspectionId, `放行检验 ${insp.code}：${reason}`);
    void items;
  });
  return send(res, 200, { ok: true, result: 'WAIVED' });
}

// The nonconforming disposition: a receipt that failed its inspection is
// marked as such and the identities it carries are isolated by a HOLD, so the
// nonconforming stock can never be consumed as ordinary stock.
export async function markProductionReceiptNonconforming(db, req, res, actor, receiptId) {
  allow(actor, 'PRODUCTION_RECEIPT_MANAGE');
  const body = await readJson(req);
  const reason = requiredText(body.reason, '不合格原因', 500);
  const now = new Date().toISOString();
  let held = 0;
  transaction(db, () => {
    const receipt = db.prepare('SELECT * FROM production_receipts WHERE id=?').get(receiptId);
    if (!receipt) throw new HttpError(404, '生产入库单不存在');
    if (receipt.status !== 'CONFIRMED') throw new HttpError(409, '只有已确认的生产入库单可以标记不合格');
    if (Number(receipt.nonconforming || 0) === 1) throw new HttpError(409, '该生产入库单已标记为不合格');
    db.prepare('UPDATE production_receipts SET nonconforming=1,nonconforming_reason=?,updated_at=? WHERE id=?').run(reason, now, receiptId);
    const allocations = db.prepare('SELECT COALESCE(lot_id,serial_id) identityId, lot_id lotId, serial_id serialId FROM tracked_source_allocations WHERE source_type=? AND source_id=?')
      .all('PRODUCTION_RECEIPT', receiptId);
    for (const allocation of allocations) {
      if (allocation.lotId) {
        const lot = db.prepare('SELECT status FROM inventory_lots WHERE id=?').get(allocation.lotId);
        if (lot && lot.status === 'AVAILABLE') {
          db.prepare("UPDATE inventory_lots SET status='HOLD' WHERE id=?").run(allocation.lotId);
          db.prepare('INSERT INTO tracked_identity_hold_history(id,identity_type,identity_id,action,reason,operator_id,created_at) VALUES(?,?,?,?,?,?,?)')
            .run(id(), 'LOT', allocation.lotId, 'HOLD', reason, actor.id, now);
          held += 1;
        }
      }
      if (allocation.serialId) {
        const serial = db.prepare('SELECT lifecycle_state FROM inventory_serials WHERE id=?').get(allocation.serialId);
        if (serial && serial.lifecycle_state === 'AVAILABLE') {
          db.prepare("UPDATE inventory_serials SET lifecycle_state='HOLD',updated_at=? WHERE id=?").run(now, allocation.serialId);
          db.prepare('INSERT INTO tracked_identity_hold_history(id,identity_type,identity_id,action,reason,operator_id,created_at) VALUES(?,?,?,?,?,?,?)')
            .run(id(), 'SERIAL', allocation.serialId, 'HOLD', reason, actor.id, now);
          held += 1;
        }
      }
    }
    audit(db, actor.id, 'NONCONFORMING', 'PRODUCTION_RECEIPT', receiptId, `不合格入库 ${receipt.receipt_no}：${reason}（隔离身份 ${held} 个）`);
  });
  return send(res, 200, { ok: true, nonconforming: true, heldIdentities: held });
}
