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
  let productionOperationId = null;
  if (sourceType === 'OPERATION_REPORT') {
    const report = db.prepare("SELECT * FROM production_operation_reports WHERE id=? AND production_order_id=?").get(sourceId, order.id);
    if (!report) throw new HttpError(400, '工序报工单不存在');
    productionOperationId = report.production_operation_id;
  } else {
    const receipt = db.prepare("SELECT * FROM production_receipts WHERE id=? AND production_order_id=?").get(sourceId, order.id);
    if (!receipt) throw new HttpError(400, '生产入库单不存在');
  }
  const inspectionId = id();
  const code = buildInspectionCode(sourceType === 'OPERATION_REPORT' ? 'POI' : 'PPI');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO production_inspections(id,code,production_order_id,production_operation_id,source_type,source_id,plan_id,inspection_type,status,business_date,inspector_id,creator_id,remark,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?, 'DRAFT', ?, ?, ?, ?, ?, ?)`).run(
      inspectionId, code, order.id, productionOperationId, sourceType, sourceId, body.planId || null,
      String(body.inspectionType || 'NORMAL').toUpperCase(),
      body.businessDate || now.slice(0, 10), actor.id, actor.id, optionalText(body.remark, 500) || '', now, now,
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
  const clauses = []; const ps = [];
  if (orderId) { clauses.push('i.production_order_id=?'); ps.push(orderId); }
  if (status && ['DRAFT','COMPLETED','CANCELLED'].includes(status)) { clauses.push('i.status=?'); ps.push(status); }
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
  const plan = db.prepare("SELECT id FROM inspection_plans WHERE target_type='PRODUCT' AND product_id=? AND active=1 ORDER BY created_at DESC LIMIT 1").get(receipt.order_product_id);
  if (!plan) return;
  const inspection = db.prepare("SELECT result FROM production_inspections WHERE source_type='PRODUCTION_RECEIPT' AND source_id=? AND status='COMPLETED' ORDER BY confirmed_at DESC LIMIT 1").get(receiptId);
  if (!inspection || inspection.result !== 'PASS' || receipt.quality_state !== 'PASS') {
    throw new HttpError(409, '该生产入库需先完成产品检验并通过');
  }
}
