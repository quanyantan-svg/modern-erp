import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';
import { systemHealth } from './financial-inventory.js';

const IQC_OQC_STATUSES = ['PENDING', 'COMPLETED'];
const IQC_OQC_RESULTS = ['PASS', 'FAIL'];
const IQC_OQC_INSPECTION_TYPES = ['NORMAL', 'SAMPLING', 'FULL'];

function requireFiniteNumber(value, label, options = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}必须为有效数字`);
  if (options.nonNegative && n < 0) throw new HttpError(400, `${label}不能为负数`);
  if (options.max != null && n > options.max) throw new HttpError(400, `${label}不能超过 ${options.max}`);
  return n;
}

function validateIqcOqcItems(items, label) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, `${label}: 检验明细不能为空`);
  const validated = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i] || {};
    const productId = String(raw.product_id ?? '').trim();
    if (!productId) throw new HttpError(400, `${label}: 第 ${i + 1} 行产品不能为空`);
    const quantity = requireFiniteNumber(raw.quantity, `${label}: 第 ${i + 1} 行数量`, { nonNegative: true });
    const sampleSize = requireFiniteNumber(raw.sample_size ?? 0, `${label}: 第 ${i + 1} 行抽样数`, { nonNegative: true });
    if (sampleSize > quantity) throw new HttpError(400, `${label}: 第 ${i + 1} 行抽样数不能大于数量`);
    const qualifiedRaw = raw.qualified;
    const qualified = qualifiedRaw === true || qualifiedRaw === 1 || qualifiedRaw === '1' ? 1 : 0;
    validated.push({
      product_id: productId,
      batch_no: String(raw.batch_no ?? '').trim(),
      quantity,
      sample_size: sampleSize,
      qualified,
      reject_reason: String(raw.reject_reason ?? '').trim(),
    });
  }
  return validated;
}

function validateIqcHeader(body, db) {
  const supplierId = String(body.supplier_id ?? '').trim();
  if (!supplierId) throw new HttpError(400, '供应商不能为空');
  if (!db.prepare('SELECT id FROM suppliers WHERE id=?').get(supplierId)) throw new HttpError(400, '供应商不存在');
  const receiptId = body.receipt_id ? String(body.receipt_id).trim() : null;
  const inspectionType = String(body.inspection_type ?? 'NORMAL').trim();
  if (!IQC_OQC_INSPECTION_TYPES.includes(inspectionType)) throw new HttpError(400, `检验类型必须是 ${IQC_OQC_INSPECTION_TYPES.join(' / ')}`);
  const totalQuantity = requireFiniteNumber(body.total_quantity ?? 0, '送检数量', { nonNegative: true });
  const sampleQuantity = requireFiniteNumber(body.sample_quantity ?? 0, '抽样数量', { nonNegative: true, max: totalQuantity });
  const qualifiedQuantity = requireFiniteNumber(body.qualified_quantity ?? 0, '合格数量', { nonNegative: true, max: sampleQuantity });
  const rejectQuantity = requireFiniteNumber(body.reject_quantity ?? 0, '不合格数量', { nonNegative: true });
  if (qualifiedQuantity + rejectQuantity > sampleQuantity) throw new HttpError(400, '合格数与不合格数之和不能超过抽样数');
  return {
    supplier_id: supplierId,
    receipt_id: receiptId,
    inspection_type: inspectionType,
    total_quantity: totalQuantity,
    sample_quantity: sampleQuantity,
    qualified_quantity: qualifiedQuantity,
    reject_quantity: rejectQuantity,
    remark: String(body.remark ?? '').trim(),
  };
}

function validateOqcHeader(body, db) {
  const customerId = String(body.customer_id ?? '').trim();
  if (!customerId) throw new HttpError(400, '客户不能为空');
  if (!db.prepare('SELECT id FROM customers WHERE id=?').get(customerId)) throw new HttpError(400, '客户不存在');
  const deliveryId = body.delivery_id ? String(body.delivery_id).trim() : null;
  const inspectionType = String(body.inspection_type ?? 'NORMAL').trim();
  if (!IQC_OQC_INSPECTION_TYPES.includes(inspectionType)) throw new HttpError(400, `检验类型必须是 ${IQC_OQC_INSPECTION_TYPES.join(' / ')}`);
  const totalQuantity = requireFiniteNumber(body.total_quantity ?? 0, '送检数量', { nonNegative: true });
  const sampleQuantity = requireFiniteNumber(body.sample_quantity ?? 0, '抽样数量', { nonNegative: true, max: totalQuantity });
  const qualifiedQuantity = requireFiniteNumber(body.qualified_quantity ?? 0, '合格数量', { nonNegative: true, max: sampleQuantity });
  const rejectQuantity = requireFiniteNumber(body.reject_quantity ?? 0, '不合格数量', { nonNegative: true });
  if (qualifiedQuantity + rejectQuantity > sampleQuantity) throw new HttpError(400, '合格数与不合格数之和不能超过抽样数');
  return {
    customer_id: customerId,
    delivery_id: deliveryId,
    inspection_type: inspectionType,
    total_quantity: totalQuantity,
    sample_quantity: sampleQuantity,
    qualified_quantity: qualifiedQuantity,
    reject_quantity: rejectQuantity,
    remark: String(body.remark ?? '').trim(),
  };
}

function loadIqcInspection(db, iqcId) {
  const inspection = db.prepare("SELECT i.*, s.code supplier_code, s.name supplier_name, u.display_name inspector_name FROM iqc_inspections i JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN users u ON u.id=i.inspector_id WHERE i.id=?").get(iqcId);
  if (!inspection) throw new HttpError(404, '来料检验单不存在');
  inspection.items = db.prepare("SELECT ii.*, p.code product_code, p.name product_name FROM iqc_inspection_items ii JOIN products p ON p.id=ii.product_id WHERE ii.iqc_id=?").all(iqcId);
  return inspection;
}

function loadOqcInspection(db, oqcId) {
  const inspection = db.prepare("SELECT o.*, c.code customer_code, c.name customer_name, u.display_name inspector_name FROM oqc_inspections o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.inspector_id WHERE o.id=?").get(oqcId);
  if (!inspection) throw new HttpError(404, '出货检验单不存在');
  inspection.items = db.prepare("SELECT oi.*, p.code product_code, p.name product_name FROM oqc_inspection_items oi JOIN products p ON p.id=oi.product_id WHERE oi.oqc_id=?").all(oqcId);
  return inspection;
}

// ============ 部门辅助核算 ============

export async function listDepartments(db, res, actor, url) {
  allowAny(actor, ["DEPARTMENTS_VIEW", "DEPARTMENTS_MANAGE"]);
  const search = "%" + (url.searchParams.get("search") || "") + "%";
  const depts = db.prepare("SELECT d.*, p.name parent_name FROM departments d LEFT JOIN departments p ON p.id=d.parent_id WHERE (d.code LIKE ? OR d.name LIKE ?) ORDER BY d.code").all(search, search);
  return send(res, 200, { departments: depts });
}

export async function createDepartment(db, req, res, actor) {
  allow(actor, "DEPARTMENTS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const deptId = id();
  db.prepare("INSERT INTO departments(id,code,name,parent_id,manager,created_at) VALUES(?,?,?,?,?,?)").run(deptId, body.code, body.name, body.parent_id || null, body.manager || "", now);
  return send(res, 201, { id: deptId });
}

// ============ 项目辅助核算 ============

export async function listAuxProjects(db, res, actor, url) {
  allowAny(actor, ["PROJECTS_VIEW", "PROJECTS_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  const search = "%" + (url.searchParams.get("search") || "") + "%";
  let sql = "SELECT * FROM aux_projects WHERE (code LIKE ? OR name LIKE ?)";
  const params = [search, search];
  if (status) { sql += " AND status=?"; params.push(status); }
  sql += " ORDER BY code";
  const projects = db.prepare(sql).all(...params);
  return send(res, 200, { projects });
}

export async function createAuxProject(db, req, res, actor) {
  allow(actor, "PROJECTS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const projId = id();
  db.prepare("INSERT INTO aux_projects(id,code,name,status,start_date,end_date,budget_cents,manager,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(projId, body.code, body.name, body.status || "RUNNING", body.start_date || null, body.end_date || null, body.budget_cents || 0, body.manager || "", now);
  return send(res, 201, { id: projId });
}

// ============ 月结/年结 ============

export function listPeriodClosures(db, res, actor, url) {
  allowAny(actor, ["PERIOD_CLOSE_VIEW", "PERIOD_CLOSE_MANAGE"]);
  const year = url.searchParams.get("year") || new Date().getFullYear();
  const closures = db.prepare("SELECT pc.*, u.display_name closed_by_name FROM period_closures pc LEFT JOIN users u ON u.id=pc.closed_by WHERE pc.period_year=? ORDER BY pc.period_month DESC").all(parseInt(year));
  return send(res, 200, { closures });
}

export async function createPeriodClosure(db, req, res, actor) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const body = await readJson(req);
  const { year, month } = body;
  const period = year + "-" + String(month).padStart(2, "0");
  const exists = db.prepare("SELECT id FROM period_closures WHERE period=?").get(period);
  if (exists) throw new HttpError(409, "期间已存在");
  const now = new Date().toISOString();
  const closureId = id();
  db.prepare("INSERT INTO period_closures(id,period,period_year,period_month,closure_type,created_at) VALUES(?,?,?,?,?,?)").run(closureId, period, year, month, body.closure_type || "MONTH", now);
  return send(res, 201, { id: closureId, period });
}

// ============ 期间关闭前置检查（内部函数）===========
// 统一的检查逻辑，供 closePeriod 和 getClosureChecklist 共用
// 返回 { passed: boolean, items: Array<{ item, passed, detail }> }

function getPeriodClosureChecklist(db, period) {
  const checklist = [];

  // 检查1: 期间内是否存在 ENTERED 状态的凭证
  const enteredCount = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE voucher_date LIKE ? AND status='ENTERED'").get(period + '%').cnt;
  const enteredPassed = enteredCount === 0;
  checklist.push({
    item: "录入中凭证",
    passed: enteredPassed,
    detail: enteredPassed ? "无录入中凭证" : `有 ${enteredCount} 张录入中凭证，请先提交或删除`
  });

  // 检查2: 期间内是否存在 SUBMITTED 状态的凭证
  const submittedCount = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE voucher_date LIKE ? AND status='SUBMITTED'").get(period + '%').cnt;
  const submittedPassed = submittedCount === 0;
  checklist.push({
    item: "待审核凭证",
    passed: submittedPassed,
    detail: submittedPassed ? "无待审核凭证" : `有 ${submittedCount} 张待审核凭证，请先审核或驳回`
  });

  // 检查3: 期间内是否存在 REJECTED 状态的凭证
  const rejectedCount = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE voucher_date LIKE ? AND status='REJECTED'").get(period + '%').cnt;
  const rejectedPassed = rejectedCount === 0;
  checklist.push({
    item: "已驳回凭证",
    passed: rejectedPassed,
    detail: rejectedPassed ? "无已驳回凭证" : `有 ${rejectedCount} 张已驳回凭证，请修改后重新提交或删除`
  });

  // 所有检查通过
  const allPassed = checklist.every(c => c.passed);
  return { passed: allPassed, items: checklist };
}
export function getClosureChecklist(db, res, actor, url) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间，格式: YYYY-MM");
  
  // 检查期间是否存在
  const closure = db.prepare("SELECT * FROM period_closures WHERE period=?").get(period);
  if (!closure) {
    return send(res, 200, { 
      checklist: [], 
      passed: false, 
      detail: "期间未初始化，请先创建期间记录" 
    });
  }
  
  if (closure.status === 'CLOSED') {
    return send(res, 200, { 
      checklist: [], 
      passed: false, 
      detail: "期间已结账" 
    });
  }
  
  const result = getPeriodClosureChecklist(db, period);
  return send(res, 200, { 
    checklist: result.items, 
    passed: result.passed 
  });
}

export async function closePeriod(db, req, res, actor, closureId) {
  allow(actor, "PERIOD_CLOSE_MANAGE");

  const closure = db.prepare("SELECT * FROM period_closures WHERE id=?").get(closureId);
  if (!closure) throw new HttpError(404, "期间不存在");
  if (closure.status === "CLOSED") throw new HttpError(400, "期间已结账");
  if(!db.prepare("SELECT 1 FROM inventory_period_closures WHERE period_key=? AND status='CLOSED'").get(closure.period)) throw new HttpError(409,'必须先完成对应存货期间结账');
  const endDate=`${closure.period}-${String(new Date(Number(closure.period.slice(0,4)),Number(closure.period.slice(5,7)),0).getDate()).padStart(2,'0')}`; const health=systemHealth(db,{asOfDate:endDate}); const blocking=health.checks.filter(x=>x.severity==='BLOCKING'&&x.status==='FAIL'); if(blocking.length) throw new HttpError(409,`会计结账健康检查失败: ${blocking.map(x=>x.code).join(', ')}`);

  // 执行统一的关闭前置检查
  const checklistResult = getPeriodClosureChecklist(db, closure.period);
  if (!checklistResult.passed) {
    const failedItems = checklistResult.items.filter(c => !c.passed);
    const reasons = failedItems.map(c => c.detail).join("; ");
    throw new HttpError(400, `结账前置检查未通过: ${reasons}`);
  }

  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE period_closures SET status=?,closed_by=?,closed_at=?,checklist_passed=1 WHERE id=?")
      .run("CLOSED", actor.id, now, closureId);
    db.prepare("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id(), actor.id, "CLOSE_PERIOD", "PERIOD_CLOSURE", closureId, `结账期间 ${closure.period}`, now);
  });

  return send(res, 200, { ok: true, message: "期间结账成功" });
}

export async function unclosePeriod(db, req, res, actor, closureId) {
  if (actor.roleCode !== 'ADMIN') throw new HttpError(403, '仅系统管理员可执行会计期间重新打开');
  const body = await readJson(req);
  const reason = String(body.reason || '').trim();
  if (!reason) throw new HttpError(400, '重新打开期间必须填写原因');

  const closure = db.prepare("SELECT * FROM period_closures WHERE id=?").get(closureId);
  if (!closure) throw new HttpError(404, "期间不存在");
  if (closure.status !== "CLOSED") throw new HttpError(400, "期间未结账，无需反结账");

  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("INSERT INTO period_reopen_history(id,period_closure_id,period,previous_closed_by,previous_closed_at,reason,reopened_by,reopened_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id(), closureId, closure.period, closure.closed_by, closure.closed_at, reason, actor.id, now);
    db.prepare("UPDATE period_closures SET status='OPEN',reopen_reason=?,checklist_passed=0 WHERE id=?")
      .run(reason, closureId);
    db.prepare("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id(), actor.id, "UNCLOSE_PERIOD", "PERIOD_CLOSURE", closureId, `反结账期间 ${closure.period}：${reason}`, now);
  });

  return send(res, 200, { ok: true, message: "反结账成功" });
}

// ============ 银行对账单 ============

export function listBankStatements(db, res, actor, url) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const bankId = url.searchParams.get("bank_id") || "";
  const period = url.searchParams.get("period") || "";
  let sql = "SELECT bs.*, ba.bank_name, ba.account_no FROM bank_statements bs JOIN bank_accounts ba ON ba.id=bs.bank_account_id WHERE 1=1";
  const params = [];
  if (bankId) { sql += " AND bs.bank_account_id=?"; params.push(bankId); }
  if (period) { sql += " AND bs.period=?"; params.push(period); }
  sql += " ORDER BY bs.statement_date DESC";
  const statements = db.prepare(sql).all(...params);
  return send(res, 200, { statements });
}

export async function createBankStatement(db, req, res, actor) {
  allow(actor, "BANK_RECONCILE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const stmtId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM bank_statements WHERE bank_account_id=?").get(body.bank_account_id).cnt + 1).padStart(4, "0");
  const stmtNo = "BS-" + body.statement_date.replace(/-/g, "") + "-" + seq;
  db.prepare("INSERT INTO bank_statements(id,bank_account_id,statement_no,statement_date,period,opening_balance_cents,closing_balance_cents,total_debit_cents,total_credit_cents,total_count,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(stmtId, body.bank_account_id, stmtNo, body.statement_date, body.period, body.opening_balance_cents || 0, body.closing_balance_cents || 0, body.total_debit_cents || 0, body.total_credit_cents || 0, body.items?.length || 0, actor.id, now);
  return send(res, 201, { id: stmtId, statement_no: stmtNo });
}

// ============ 银行对账 ============

export function listBankReconciliations(db, res, actor, url) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const bankId = url.searchParams.get("bank_id") || "";
  let sql = "SELECT r.*, ba.bank_name, ba.account_no, u.display_name reconciled_by_name FROM bank_reconciliations r JOIN bank_accounts ba ON ba.id=r.bank_account_id LEFT JOIN users u ON u.id=r.reconciled_by WHERE 1=1";
  const params = [];
  if (bankId) { sql += " AND r.bank_account_id=?"; params.push(bankId); }
  sql += " ORDER BY r.period DESC";
  const reconciliations = db.prepare(sql).all(...params);
  return send(res, 200, { reconciliations });
}

export async function createBankReconciliation(db, req, res, actor) {
  allow(actor, "BANK_RECONCILE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const reconId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM bank_reconciliations WHERE bank_account_id=?").get(body.bank_account_id).cnt + 1).padStart(4, "0");
  const reconNo = "BR-" + body.period + "-" + seq;
  db.prepare("INSERT INTO bank_reconciliations(id,bank_account_id,reconciliation_no,period,statement_balance_cents,book_balance_cents,difference_cents,reconciled_by,reconciled_at,remark) VALUES(?,?,?,?,?,?,?,?,?,?)").run(reconId, body.bank_account_id, reconNo, body.period, body.statement_balance_cents, body.book_balance_cents, body.difference_cents || 0, actor.id, now, body.remark || "");
  return send(res, 201, { id: reconId, reconciliation_no: reconNo });
}

// ============ MRP物料需求计划 ============

export function listMrpPlans(db, res, actor, url) {
  allowAny(actor, ["MRP_VIEW", "MRP_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  let sql = "SELECT p.*, u.display_name creator_name FROM mrp_plans p LEFT JOIN users u ON u.id=p.creator_id WHERE 1=1";
  const params = [];
  if (status) { sql += " AND p.status=?"; params.push(status); }
  sql += " ORDER BY p.created_at DESC";
  const plans = db.prepare(sql).all(...params);
  return send(res, 200, { plans });
}

export async function createMrpPlan(db, req, res, actor) {
  allow(actor, "MRP_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const planId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM mrp_plans").get().cnt + 1).padStart(4, "0");
  const planNo = "MRP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  db.prepare("INSERT INTO mrp_plans(id,plan_no,plan_type,status,planned_date,total_items,total_cost_cents,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(planId, planNo, body.plan_type || "AUTO", "DRAFT", body.planned_date || now.slice(0, 10), 0, 0, actor.id, now, now);
  
  return send(res, 201, { id: planId, plan_no: planNo });
}

function productStock(db, productId) {
  const row = db.prepare("SELECT COALESCE(SUM(quantity), 0) total FROM inventory WHERE product_id=?").get(productId);
  return Number(row?.total || 0);
}

function scheduledReceipt(db, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(pri.quantity), 0) total
    FROM purchase_receipt_items pri
    JOIN purchase_receipts pr ON pr.id = pri.receipt_id
    WHERE pri.product_id = ? AND pr.status = 'CONFIRMED'
  `).get(productId);
  return Number(row?.total || 0);
}

function explodeActiveBomDemand(db, productId, quantity, seen = new Set()) {
  if (seen.has(productId)) throw new HttpError(400, "BOM存在递归引用");
  const bom = db.prepare("SELECT id FROM boms WHERE product_id=? AND status='ACTIVE' ORDER BY updated_at DESC LIMIT 1").get(productId);
  if (!bom) return [{ productId, quantity }];
  const items = db.prepare("SELECT product_id, quantity, scrap_rate FROM bom_items WHERE bom_id=? ORDER BY line_no").all(bom.id);
  if (items.length === 0) return [{ productId, quantity }];
  const nextSeen = new Set(seen);
  nextSeen.add(productId);
  const result = [];
  for (const item of items) {
    const required = Number(quantity) * Number(item.quantity) * (1 + Number(item.scrap_rate || 0));
    result.push(...explodeActiveBomDemand(db, item.product_id, required, nextSeen));
  }
  return result;
}

export async function generateMrp(db, req, res, actor) {
  allow(actor, "MRP_MANAGE");
  const body = await readJson(req);
  const { plan_id, demand_type, demand_source_id } = body;
  if (!plan_id) throw new HttpError(400, "请选择MRP计划");
  if (demand_type !== "SALES_ORDER" || !demand_source_id) throw new HttpError(400, "仅支持按销售订单生成MRP");
  const plan = db.prepare("SELECT * FROM mrp_plans WHERE id=?").get(plan_id);
  if (!plan) throw new HttpError(404, "MRP计划不存在");
  
  const now = new Date().toISOString();
  
  const order = db.prepare("SELECT * FROM sales_orders WHERE id=?").get(demand_source_id);
  if (!order) throw new HttpError(404, "销售订单不存在");
  const items = db.prepare("SELECT * FROM sales_order_items WHERE order_id=? ORDER BY line_no").all(demand_source_id);
  if (items.length === 0) throw new HttpError(400, "销售订单没有明细");
  transaction(db, () => {
    db.prepare("DELETE FROM mrp_plan_items WHERE plan_id=?").run(plan_id);
    const demandMap = new Map();
    for (const item of items) {
      const leaves = explodeActiveBomDemand(db, item.product_id, Number(item.quantity));
      for (const leaf of leaves) {
        demandMap.set(leaf.productId, (demandMap.get(leaf.productId) || 0) + leaf.quantity);
      }
    }

    for (const [productId, grossRequirement] of demandMap.entries()) {
      const product = db.prepare("SELECT * FROM products WHERE id=?").get(productId);
      if (!product) throw new HttpError(400, "MRP需求产品不存在");
      const onHand = productStock(db, productId);
      const expectedReceipt = scheduledReceipt(db, productId);
        
      const itemId = id();
      const plannedQty = Math.max(0, grossRequirement - onHand - expectedReceipt);
        
      db.prepare("INSERT INTO mrp_plan_items(id,plan_id,product_id,demand_type,demand_source_id,gross_requirement,on_hand,scheduled_receipt,planned_receipt,planned_order_quantity,due_date,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(itemId, plan_id, productId, demand_type, demand_source_id, grossRequirement, onHand, expectedReceipt, 0, plannedQty, order.submitted_at?.slice(0, 10) || now.slice(0, 10), "PENDING");
    }
    const stats = db.prepare("SELECT COUNT(*) total_items, SUM(planned_order_quantity) total_qty FROM mrp_plan_items WHERE plan_id=?").get(plan_id);
    db.prepare("UPDATE mrp_plans SET total_items=?, updated_at=? WHERE id=?").run(stats.total_items || 0, now, plan_id);
    audit(db, actor.id, 'GENERATE', 'MRP_PLAN', plan_id, `按销售订单生成MRP ${order.order_no}`);
  });
  
  return send(res, 200, { ok: true, message: "MRP计算完成" });
}

// ============ 工作中心 ============

export function listWorkCenters(db, res, actor) {
  allowAny(actor, ["WORK_CENTERS_VIEW", "WORK_CENTERS_MANAGE"]);
  const centers = db.prepare("SELECT * FROM work_centers ORDER BY code").all();
  return send(res, 200, { workCenters: centers });
}

export async function createWorkCenter(db, req, res, actor) {
  allow(actor, "WORK_CENTERS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const wcId = id();
  const capacity = Math.max(0, Math.round(Number(body.dailyCapacityMinutes ?? body.daily_capacity_minutes ?? (Number(body.capacity_hours || 8) * 60))));
  const laborRate = Math.max(0, Math.round(Number(body.laborRateCentsPerHour ?? body.labor_rate_cents_per_hour ?? 0)));
  const overheadRate = Math.max(0, Math.round(Number(body.overheadRateCentsPerHour ?? body.overhead_rate_cents_per_hour ?? 0)));
  db.prepare("INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,daily_capacity_minutes,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(wcId, body.code, body.name, body.type || "ASSEMBLY", capacity / 60, body.efficiency || 100, body.unit_cost_cents || 0, capacity, laborRate, overheadRate, now);
  audit(db, actor.id, 'CREATE', 'WORK_CENTER', wcId, `${body.code} 能力 ${capacity} 分钟`);
  return send(res, 201, { id: wcId });
}

// ============ 工序管理 ============

export function listRoutingOperations(db, res, actor, url) {
  allowAny(actor, ["ROUTING_VIEW", "ROUTING_MANAGE"]);
  const bomId = url.searchParams.get("bom_id");
  let sql = "SELECT r.*, w.code wc_code, w.name wc_name, b.version bom_version, p.code product_code, p.name product_name FROM routing_operations r JOIN work_centers w ON w.id=r.work_center_id JOIN boms b ON b.id=r.bom_id JOIN products p ON p.id=b.product_id";
  const params = [];
  if (bomId) { sql += " WHERE r.bom_id=?"; params.push(bomId); }
  sql += " ORDER BY r.bom_id, r.operation_no";
  const operations = db.prepare(sql).all(...params);
  return send(res, 200, { operations });
}

export async function createRoutingOperation(db, req, res, actor) {
  allow(actor, "ROUTING_MANAGE");
  const body = await readJson(req);
  const opId = id();
  db.prepare("INSERT INTO routing_operations(id,bom_id,operation_no,work_center_id,work_time_minutes,setup_time_minutes,wait_time_minutes,move_time_minutes,description) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(opId, body.bom_id, body.operation_no || 1, body.work_center_id, body.work_time_minutes || 0, body.setup_time_minutes || 0, body.wait_time_minutes || 0, body.move_time_minutes || 0, body.description || "");
  return send(res, 201, { id: opId });
}

// ============ 生产人工记录 ============

export function listLaborRecords(db, res, actor, url) {
  allowAny(actor, ["PRODUCTION_COSTS_VIEW", "PRODUCTION_COSTS_MANAGE"]);
  const orderId = url.searchParams.get("order_id");
  const workDate = url.searchParams.get("work_date");
  let sql = "SELECT l.*, u.display_name worker_name, o.order_no FROM production_labor_records l JOIN users u ON u.id=l.worker_id JOIN production_orders o ON o.id=l.order_id WHERE 1=1";
  const params = [];
  if (orderId) { sql += " AND l.order_id=?"; params.push(orderId); }
  if (workDate) { sql += " AND l.work_date=?"; params.push(workDate); }
  sql += " ORDER BY l.work_date DESC, l.created_at DESC";
  const records = db.prepare(sql).all(...params);
  return send(res, 200, { records });
}

export async function createLaborRecord(db, req, res, actor) {
  allow(actor, "PRODUCTION_COSTS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const recordId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM production_labor_records").get().cnt + 1).padStart(4, "0");
  const recordNo = "LR-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  // 计算人工成本
  const laborCost = Math.round(body.hours * 50 * 100); // 假设50元/小时
  
  db.prepare("INSERT INTO production_labor_records(id,record_no,order_id,operation_id,worker_id,work_date,hours,output_quantity,reject_quantity,labor_cost_cents,status,remark,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(recordId, recordNo, body.order_id, body.operation_id || null, body.worker_id, body.work_date, body.hours, body.output_quantity || 0, body.reject_quantity || 0, laborCost, body.status || "DRAFT", body.remark || "", now);
  
  return send(res, 201, { id: recordId, record_no: recordNo });
}
// ============ IQC来料检验 ============

export function listIqcInspections(db, res, actor, url) {
  allowAny(actor, ["IQC_VIEW", "IQC_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  let sql = "SELECT i.*, s.code supplier_code, s.name supplier_name, u.display_name inspector_name FROM iqc_inspections i JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN users u ON u.id=i.inspector_id WHERE 1=1";
  const params = [];
  if (status) { sql += " AND i.status=?"; params.push(status); }
  sql += " ORDER BY i.created_at DESC";
  const inspections = db.prepare(sql).all(...params);
  return send(res, 200, { inspections });
}

export async function createIqcInspection(db, req, res, actor) {
  allow(actor, "IQC_MANAGE");
  const body = await readJson(req);
  const header = validateIqcHeader(body, db);
  const items = validateIqcOqcItems(body.items, 'IQC');
  const now = new Date().toISOString();
  const iqcId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM iqc_inspections").get().cnt + 1).padStart(4, "0");
  const iqcNo = "IQC-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;

  transaction(db, () => {
    db.prepare("INSERT INTO iqc_inspections(id,iqc_no,supplier_id,receipt_id,inspection_type,status,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspector_id,remark,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(iqcId, iqcNo, header.supplier_id, header.receipt_id, header.inspection_type, 'PENDING', header.total_quantity, header.sample_quantity, header.qualified_quantity, header.reject_quantity, actor.id, header.remark, now, now);
    const insertItem = db.prepare("INSERT INTO iqc_inspection_items(id,iqc_id,product_id,batch_no,quantity,sample_size,qualified,reject_reason) VALUES(?,?,?,?,?,?,?,?)");
    for (const item of items) {
      insertItem.run(id(), iqcId, item.product_id, item.batch_no, item.quantity, item.sample_size, item.qualified, item.reject_reason);
    }
    audit(db, actor.id, 'CREATE', 'IQC_INSPECTION', iqcId, `新建来料检验单 ${iqcNo}`);
  });

  return send(res, 201, { id: iqcId, iqc_no: iqcNo });
}

export function getIqcInspection(db, res, actor, iqcId) {
  allowAny(actor, ["IQC_VIEW", "IQC_MANAGE"]);
  return send(res, 200, { inspection: loadIqcInspection(db, iqcId) });
}

export async function updateIqcInspection(db, req, res, actor, iqcId) {
  allow(actor, "IQC_MANAGE");
  const body = await readJson(req);
  const inspection = db.prepare('SELECT * FROM iqc_inspections WHERE id=?').get(iqcId);
  if (!inspection) throw new HttpError(404, '来料检验单不存在');
  if (inspection.status === 'COMPLETED') throw new HttpError(409, '已完成的检验单不可修改');
  const header = validateIqcHeader(body, db);
  const items = validateIqcOqcItems(body.items, 'IQC');
  const now = new Date().toISOString();

  transaction(db, () => {
    db.prepare("UPDATE iqc_inspections SET supplier_id=?,receipt_id=?,inspection_type=?,total_quantity=?,sample_quantity=?,qualified_quantity=?,reject_quantity=?,remark=?,updated_at=? WHERE id=?")
      .run(header.supplier_id, header.receipt_id, header.inspection_type, header.total_quantity, header.sample_quantity, header.qualified_quantity, header.reject_quantity, header.remark, now, iqcId);
    db.prepare("DELETE FROM iqc_inspection_items WHERE iqc_id=?").run(iqcId);
    const insertItem = db.prepare("INSERT INTO iqc_inspection_items(id,iqc_id,product_id,batch_no,quantity,sample_size,qualified,reject_reason) VALUES(?,?,?,?,?,?,?,?)");
    for (const item of items) {
      insertItem.run(id(), iqcId, item.product_id, item.batch_no, item.quantity, item.sample_size, item.qualified, item.reject_reason);
    }
    audit(db, actor.id, 'UPDATE', 'IQC_INSPECTION', iqcId, `更新来料检验单 ${inspection.iqc_no}`);
  });

  return send(res, 200, { ok: true });
}

export async function completeIqcInspection(db, req, res, actor, iqcId) {
  allow(actor, 'IQC_MANAGE');
  const body = await readJson(req);
  const result = String(body.result || '').trim();
  if (!IQC_OQC_RESULTS.includes(result)) throw new HttpError(400, `检验结果必须是 ${IQC_OQC_RESULTS.join(' / ')}`);
  const qualifiedQuantity = requireFiniteNumber(body.qualified_quantity ?? 0, '合格数量', { nonNegative: true });
  const rejectQuantity = requireFiniteNumber(body.reject_quantity ?? 0, '不合格数量', { nonNegative: true });
  const inspection = db.prepare('SELECT * FROM iqc_inspections WHERE id=?').get(iqcId);
  if (!inspection) throw new HttpError(404, '来料检验单不存在');
  if (inspection.status === 'COMPLETED') throw new HttpError(409, '来料检验单已完成,不可重复完成');
  const sampleQuantity = Number(inspection.sample_quantity);
  if (qualifiedQuantity > sampleQuantity) throw new HttpError(400, '合格数量不能超过抽样数量');
  if (rejectQuantity > sampleQuantity) throw new HttpError(400, '不合格数量不能超过抽样数量');
  if (qualifiedQuantity + rejectQuantity > sampleQuantity) throw new HttpError(400, '合格数与不合格数之和不能超过抽样数');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE iqc_inspections SET status=?,result=?,qualified_quantity=?,reject_quantity=?,inspected_at=?,updated_at=? WHERE id=?")
      .run('COMPLETED', result, qualifiedQuantity, rejectQuantity, now, now, iqcId);
    audit(db, actor.id, 'COMPLETE', 'IQC_INSPECTION', iqcId, `完成来料检验单 ${inspection.iqc_no}, 结果 ${result}`);
  });
  return send(res, 200, { ok: true });
}

// ============ OQC出货检验 ============

export function listOqcInspections(db, res, actor, url) {
  allowAny(actor, ["OQC_VIEW", "OQC_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  let sql = "SELECT o.*, c.code customer_code, c.name customer_name, u.display_name inspector_name FROM oqc_inspections o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.inspector_id WHERE 1=1";
  const params = [];
  if (status) { sql += " AND o.status=?"; params.push(status); }
  sql += " ORDER BY o.created_at DESC";
  const inspections = db.prepare(sql).all(...params);
  return send(res, 200, { inspections });
}

export async function createOqcInspection(db, req, res, actor) {
  allow(actor, "OQC_MANAGE");
  const body = await readJson(req);
  const header = validateOqcHeader(body, db);
  const items = validateIqcOqcItems(body.items, 'OQC');
  const now = new Date().toISOString();
  const oqcId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM oqc_inspections").get().cnt + 1).padStart(4, "0");
  const oqcNo = "OQC-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;

  transaction(db, () => {
    db.prepare("INSERT INTO oqc_inspections(id,oqc_no,customer_id,delivery_id,inspection_type,status,total_quantity,sample_quantity,qualified_quantity,reject_quantity,inspector_id,remark,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(oqcId, oqcNo, header.customer_id, header.delivery_id, header.inspection_type, 'PENDING', header.total_quantity, header.sample_quantity, header.qualified_quantity, header.reject_quantity, actor.id, header.remark, now, now);
    const insertItem = db.prepare("INSERT INTO oqc_inspection_items(id,oqc_id,product_id,batch_no,quantity,sample_size,qualified,reject_reason) VALUES(?,?,?,?,?,?,?,?)");
    for (const item of items) {
      insertItem.run(id(), oqcId, item.product_id, item.batch_no, item.quantity, item.sample_size, item.qualified, item.reject_reason);
    }
    audit(db, actor.id, 'CREATE', 'OQC_INSPECTION', oqcId, `新建出货检验单 ${oqcNo}`);
  });

  return send(res, 201, { id: oqcId, oqc_no: oqcNo });
}

export function getOqcInspection(db, res, actor, oqcId) {
  allowAny(actor, ["OQC_VIEW", "OQC_MANAGE"]);
  return send(res, 200, { inspection: loadOqcInspection(db, oqcId) });
}

export async function updateOqcInspection(db, req, res, actor, oqcId) {
  allow(actor, "OQC_MANAGE");
  const body = await readJson(req);
  const inspection = db.prepare('SELECT * FROM oqc_inspections WHERE id=?').get(oqcId);
  if (!inspection) throw new HttpError(404, '出货检验单不存在');
  if (inspection.status === 'COMPLETED') throw new HttpError(409, '已完成的检验单不可修改');
  const header = validateOqcHeader(body, db);
  const items = validateIqcOqcItems(body.items, 'OQC');
  const now = new Date().toISOString();

  transaction(db, () => {
    db.prepare("UPDATE oqc_inspections SET customer_id=?,delivery_id=?,inspection_type=?,total_quantity=?,sample_quantity=?,qualified_quantity=?,reject_quantity=?,remark=?,updated_at=? WHERE id=?")
      .run(header.customer_id, header.delivery_id, header.inspection_type, header.total_quantity, header.sample_quantity, header.qualified_quantity, header.reject_quantity, header.remark, now, oqcId);
    db.prepare("DELETE FROM oqc_inspection_items WHERE oqc_id=?").run(oqcId);
    const insertItem = db.prepare("INSERT INTO oqc_inspection_items(id,oqc_id,product_id,batch_no,quantity,sample_size,qualified,reject_reason) VALUES(?,?,?,?,?,?,?,?)");
    for (const item of items) {
      insertItem.run(id(), oqcId, item.product_id, item.batch_no, item.quantity, item.sample_size, item.qualified, item.reject_reason);
    }
    audit(db, actor.id, 'UPDATE', 'OQC_INSPECTION', oqcId, `更新出货检验单 ${inspection.oqc_no}`);
  });

  return send(res, 200, { ok: true });
}

export async function completeOqcInspection(db, req, res, actor, oqcId) {
  allow(actor, 'OQC_MANAGE');
  const body = await readJson(req);
  const result = String(body.result || '').trim();
  if (!IQC_OQC_RESULTS.includes(result)) throw new HttpError(400, `检验结果必须是 ${IQC_OQC_RESULTS.join(' / ')}`);
  const qualifiedQuantity = requireFiniteNumber(body.qualified_quantity ?? 0, '合格数量', { nonNegative: true });
  const rejectQuantity = requireFiniteNumber(body.reject_quantity ?? 0, '不合格数量', { nonNegative: true });
  const inspection = db.prepare('SELECT * FROM oqc_inspections WHERE id=?').get(oqcId);
  if (!inspection) throw new HttpError(404, '出货检验单不存在');
  if (inspection.status === 'COMPLETED') throw new HttpError(409, '出货检验单已完成,不可重复完成');
  const sampleQuantity = Number(inspection.sample_quantity);
  if (qualifiedQuantity > sampleQuantity) throw new HttpError(400, '合格数量不能超过抽样数量');
  if (rejectQuantity > sampleQuantity) throw new HttpError(400, '不合格数量不能超过抽样数量');
  if (qualifiedQuantity + rejectQuantity > sampleQuantity) throw new HttpError(400, '合格数与不合格数之和不能超过抽样数');
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE oqc_inspections SET status=?,result=?,qualified_quantity=?,reject_quantity=?,inspected_at=?,updated_at=? WHERE id=?")
      .run('COMPLETED', result, qualifiedQuantity, rejectQuantity, now, now, oqcId);
    audit(db, actor.id, 'COMPLETE', 'OQC_INSPECTION', oqcId, `完成出货检验单 ${inspection.oqc_no}, 结果 ${result}`);
  });
  return send(res, 200, { ok: true });
}

// ============ 供应商评估 ============

export function listSupplierEvaluations(db, res, actor, url) {
  allowAny(actor, ["SUPPLIER_EVAL_VIEW", "SUPPLIER_EVAL_MANAGE"]);
  const supplierId = url.searchParams.get("supplier_id");
  let sql = "SELECT e.*, s.code supplier_code, s.name supplier_name, u.display_name evaluator_name FROM supplier_evaluations e JOIN suppliers s ON s.id=e.supplier_id LEFT JOIN users u ON u.id=e.evaluator_id WHERE 1=1";
  const params = [];
  if (supplierId) { sql += " AND e.supplier_id=?"; params.push(supplierId); }
  sql += " ORDER BY e.evaluation_date DESC";
  const evaluations = db.prepare(sql).all(...params);
  return send(res, 200, { evaluations });
}

export async function createSupplierEvaluation(db, req, res, actor) {
  allow(actor, "SUPPLIER_EVAL_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const evalId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM supplier_evaluations WHERE supplier_id=?").get(body.supplier_id).cnt + 1).padStart(4, "0");
  const evalNo = "SE-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  const overallScore = ((body.quality_score || 0) * 0.4 + (body.delivery_score || 0) * 0.3 + (body.price_score || 0) * 0.2 + (body.service_score || 0) * 0.1);
  const grade = overallScore >= 90 ? "A" : overallScore >= 80 ? "B" : overallScore >= 70 ? "C" : "D";
  
  db.prepare("INSERT INTO supplier_evaluations(id,evaluation_no,supplier_id,evaluation_type,evaluation_date,quality_score,delivery_score,price_score,service_score,overall_score,grade,evaluator_id,remark,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(evalId, evalNo, body.supplier_id, body.evaluation_type || "PERIODIC", body.evaluation_date || now.slice(0, 10), body.quality_score || 0, body.delivery_score || 0, body.price_score || 0, body.service_score || 0, overallScore, grade, actor.id, body.remark || "", now);
  
  return send(res, 201, { id: evalId, evaluation_no: evalNo, overall_score: overallScore, grade });
}
// ============ OA请假申请 ============

export function listLeaveRequests(db, res, actor, url) {
  allowAny(actor, ["OA_LEAVE_VIEW", "OA_LEAVE_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  let sql = "SELECT l.*, u.display_name applicant_name, a.display_name approver_name FROM leave_requests l JOIN users u ON u.id=l.applicant_id LEFT JOIN users a ON a.id=l.approver_id WHERE 1=1";
  const params = [];
  if (status) { sql += " AND l.status=?"; params.push(status); }
  sql += " ORDER BY l.created_at DESC";
  const requests = db.prepare(sql).all(...params);
  return send(res, 200, { requests });
}

export async function createLeaveRequest(db, req, res, actor) {
  allow(actor, "OA_LEAVE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const reqId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM leave_requests").get().cnt + 1).padStart(4, "0");
  const reqNo = "LR-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  db.prepare("INSERT INTO leave_requests(id,request_no,leave_type,start_date,end_date,total_days,reason,status,applicant_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(reqId, reqNo, body.leave_type, body.start_date, body.end_date, body.total_days || 1, body.reason || "", "PENDING", actor.id, now);
  
  return send(res, 201, { id: reqId, request_no: reqNo });
}

export async function processLeaveRequest(db, req, res, actor, reqId, action) {
  allow(actor, "OA_LEAVE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const status = action === "approve" ? "APPROVED" : "REJECTED";
  
  db.prepare("UPDATE leave_requests SET status=?,approver_id=?,approved_at=?,remark=? WHERE id=?")
    .run(status, actor.id, now, body.remark || "", reqId);
  
  return send(res, 200, { ok: true, message: action === "approve" ? "已批准" : "已驳回" });
}

// ============ OA费用报销 ============

export function listExpenseClaims(db, res, actor, url) {
  allowAny(actor, ["OA_EXPENSE_VIEW", "OA_EXPENSE_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  let sql = "SELECT e.*, u.display_name applicant_name, a.display_name approver_name FROM expense_claims e JOIN users u ON u.id=e.applicant_id LEFT JOIN users a ON a.id=e.approver_id WHERE 1=1";
  const params = [];
  if (status) { sql += " AND e.status=?"; params.push(status); }
  sql += " ORDER BY e.created_at DESC";
  const claims = db.prepare(sql).all(...params);
  return send(res, 200, { claims });
}

export async function createExpenseClaim(db, req, res, actor) {
  allow(actor, "OA_EXPENSE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const claimId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM expense_claims").get().cnt + 1).padStart(4, "0");
  const claimNo = "EC-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  db.prepare("INSERT INTO expense_claims(id,claim_no,claim_type,amount_cents,expense_date,description,status,applicant_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(claimId, claimNo, body.claim_type || "GENERAL", body.amount_cents || 0, body.expense_date || now.slice(0, 10), body.description || "", "PENDING", actor.id, now);
  
  if (body.items?.length) {
    for (const item of body.items) {
      db.prepare("INSERT INTO expense_claim_items(id,claim_id,item_date,item_type,amount_cents,description) VALUES(?,?,?,?,?,?)")
        .run(id(), claimId, item.item_date || now.slice(0, 10), item.item_type || "OTHER", item.amount_cents || 0, item.description || "");
    }
  }
  
  return send(res, 201, { id: claimId, claim_no: claimNo });
}

export async function processExpenseClaim(db, req, res, actor, claimId, action) {
  allow(actor, "OA_EXPENSE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const status = action === "approve" ? "APPROVED" : "REJECTED";
  
  db.prepare("UPDATE expense_claims SET status=?,approver_id=?,approved_at=?,remark=? WHERE id=?")
    .run(status, actor.id, now, body.remark || "", claimId);
  
  return send(res, 200, { ok: true, message: action === "approve" ? "已批准" : "已驳回" });
}

// ============ 预警系统 ============

export function listAlertRules(db, res, actor) {
  allowAny(actor, ["ALERT_RULES_VIEW", "ALERT_RULES_MANAGE"]);
  const rules = db.prepare("SELECT * FROM alert_rules ORDER BY rule_code").all();
  return send(res, 200, { rules });
}

export async function createAlertRule(db, req, res, actor) {
  allow(actor, "ALERT_RULES_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const ruleId = id();
  db.prepare("INSERT INTO alert_rules(id,rule_code,rule_name,alert_type,condition_type,threshold_value,threshold_unit,enabled,notify_users,remark,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(ruleId, body.rule_code, body.rule_name, body.alert_type || "STOCK", body.condition_type || "LESS_THAN", body.threshold_value || "0", body.threshold_unit || "", body.enabled ? 1 : 0, JSON.stringify(body.notify_users || []), body.remark || "", now, now);
  return send(res, 201, { id: ruleId });
}

export async function updateAlertRule(db, req, res, actor, ruleId) {
  allow(actor, "ALERT_RULES_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE alert_rules SET rule_name=?,alert_type=?,condition_type=?,threshold_value=?,threshold_unit=?,enabled=?,notify_users=?,remark=?,updated_at=? WHERE id=?")
    .run(body.rule_name, body.alert_type, body.condition_type, body.threshold_value, body.threshold_unit, body.enabled ? 1 : 0, JSON.stringify(body.notify_users || []), body.remark || "", now, ruleId);
  return send(res, 200, { ok: true });
}

export function listAlertRecords(db, res, actor, url) {
  allowAny(actor, ["ALERT_VIEW", "ALERT_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  const alertType = url.searchParams.get("alert_type") || "";
  let sql = "SELECT a.*, r.rule_name FROM alert_records a JOIN alert_rules r ON r.id=a.rule_id WHERE 1=1";
  const params = [];
  if (status === "unresolved") { sql += " AND a.is_resolved=0"; }
  else if (status === "resolved") { sql += " AND a.is_resolved=1"; }
  if (alertType) { sql += " AND a.alert_type=?"; params.push(alertType); }
  sql += " ORDER BY a.created_at DESC LIMIT 100";
  const alerts = db.prepare(sql).all(...params);
  return send(res, 200, { alerts });
}

export async function resolveAlert(db, req, res, actor, alertId) {
  allow(actor, "ALERT_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE alert_records SET is_resolved=1,resolved_by=?,resolved_at=?,resolved_remark=? WHERE id=?")
    .run(actor.id, now, body.remark || "", alertId);
  return send(res, 200, { ok: true });
}

// ============ 经营报表 ============

// 纯业务 helper：解析期间字符串为 { period, startDate, endDate }。
// 单一 canonical period 解析器：Income Statement / Trial Balance / Balance Sheet 等
// 所有 financial reporting 复用。endDate 通过 Date(y, m, 0).getDate() 在本地时区
// 直接构造，避免 toISOString() 在 UTC+8 等非 UTC 时区产生 -1 天的偏移。
// 入参 period 为 YYYY-MM 字符串；非法格式抛出 Error，由 HTTP handler 转为 HttpError。
// period 缺省时回退到当前月（与 getFinancialSummary 历史行为一致）。
export function resolvePeriodRange(period) {
  const resolved = period || new Date().toISOString().slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(resolved);
  if (!match) throw new Error("period 格式错误，应为 YYYY-MM");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error("月份必须在 01-12 之间");
  const startDate = resolved + "-01";
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = resolved + "-" + String(lastDay).padStart(2, "0");
  return { period: resolved, startDate, endDate };
}

// 纯业务 helper：按指定期间计算 REVENUE / EXPENSE 净额与利润。
// 不接收 res，不做 HTTP 权限校验，不发送 response。
// 期间过滤使用 voucher_date 范围（避开 v.period 列可能 NULL 的问题）。
// 净额规则：REVENUE = credit - debit；EXPENSE = debit - credit（与试算平衡表一致）。
// 入参 period 为 YYYY-MM 字符串；非法格式抛出 Error，由 HTTP handler 转为 HttpError。
// period 缺省时回退到当前月（与 getFinancialSummary 历史行为一致）。
export function calculateIncomeForPeriod(db, period) {
  const { period: resolved, startDate, endDate } = resolvePeriodRange(period);

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN s.type='REVENUE' AND e.direction='CREDIT' THEN e.amount_cents ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN s.type='REVENUE' AND e.direction='DEBIT'  THEN e.amount_cents ELSE 0 END), 0)
      AS revenue_net,
      COALESCE(SUM(CASE WHEN s.type='EXPENSE' AND e.direction='DEBIT'  THEN e.amount_cents ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN s.type='EXPENSE' AND e.direction='CREDIT' THEN e.amount_cents ELSE 0 END), 0)
      AS expense_net
    FROM accounting_entries e
    JOIN accounting_vouchers v ON v.id = e.voucher_id
    JOIN accounting_subjects s ON s.id = e.subject_id
    WHERE v.status = 'POSTED'
      AND v.voucher_date >= ?
      AND v.voucher_date <= ?
      AND s.type IN ('REVENUE', 'EXPENSE')
  `).get(startDate, endDate);

  const revenue = Number(row.revenue_net);
  const expense = Number(row.expense_net);
  const profit = revenue - expense;
  return { period: resolved, periodRange: { startDate, endDate }, revenue, expense, profit };
}

export function getFinancialSummary(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");

  const income = calculateIncomeForPeriod(db, period);

  const ar = db.prepare("SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents), 0) total FROM account_receivables WHERE status IN ('PENDING', 'PARTIAL')").get().total;
  const ap = db.prepare("SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents), 0) total FROM account_payables WHERE status IN ('PENDING', 'PARTIAL')").get().total;

  return send(res, 200, {
    period: income.period,
    revenue: income.revenue,
    expense: income.expense,
    profit: income.profit,
    accounts_receivable: Number(ar),
    accounts_payable: Number(ap),
  });
}

// ============ 试算平衡表 ============
// 单月期间期初/本期借方/本期贷方/期末。POSTED only。
// 期间过滤使用 voucher_date 范围（避开 v.period 列可能 NULL 的问题，与利润表共享 resolvePeriodRange）。
// 科目集合：所有 active 科目（不要求 parent_id；与利润表 / 资产负债表保持一致；
//  seed 数据未设置 parent_id，过滤会导致整个列表为空）。
// 净额规则：ASSET/EXPENSE 期末 = 期初 + 借方 - 贷方；其他 = 期初 + 贷方 - 借方。
// direction 规则（per row，独立的 openingDirection / closingDirection 字段）：
//   opening：基于 SQL Σ(DEBIT)-Σ(CREDIT) 的符号 —— 正 → DEBIT，负 → CREDIT（与 subject type 无关）。
//   closing：基于科目 normal direction —— debit-normal 科目（ASSET/EXPENSE）正 → DEBIT，
//    负 → CREDIT（contra）；credit-normal 科目（LIABILITY/EQUITY/REVENUE）正 → CREDIT，
//    负 → DEBIT（contra）。由 classifyBalanceDirection 统一实现。
export function getTrialBalance(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  const { startDate, endDate } = resolvePeriodRange(period);

  const subjects = db.prepare(`
    SELECT id, code, name, type FROM accounting_subjects
    WHERE active = 1 ORDER BY code
  `).all();

  const trialBalance = subjects.map(subject => {
    const opening = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN e.direction = 'DEBIT' THEN e.amount_cents ELSE -e.amount_cents END), 0) AS balance
      FROM accounting_entries e
      JOIN accounting_vouchers v ON v.id = e.voucher_id
      WHERE e.subject_id = ? AND v.voucher_date < ? AND v.status = 'POSTED'
    `).get(subject.id, startDate);

    const periodDebit = db.prepare(`
      SELECT COALESCE(SUM(e.amount_cents), 0) AS total
      FROM accounting_entries e
      JOIN accounting_vouchers v ON v.id = e.voucher_id
      WHERE e.subject_id = ? AND e.direction = 'DEBIT'
        AND v.voucher_date >= ? AND v.voucher_date <= ? AND v.status = 'POSTED'
    `).get(subject.id, startDate, endDate);

    const periodCredit = db.prepare(`
      SELECT COALESCE(SUM(e.amount_cents), 0) AS total
      FROM accounting_entries e
      JOIN accounting_vouchers v ON v.id = e.voucher_id
      WHERE e.subject_id = ? AND e.direction = 'CREDIT'
        AND v.voucher_date >= ? AND v.voucher_date <= ? AND v.status = 'POSTED'
    `).get(subject.id, startDate, endDate);

    const openingBalance = Number(opening.balance);
    const debit = Number(periodDebit.total);
    const credit = Number(periodCredit.total);

    const closingBalance = (subject.type === 'ASSET' || subject.type === 'EXPENSE')
      ? openingBalance + debit - credit
      : openingBalance + credit - debit;

    return {
      ...subject,
      openingBalance,
      openingDirection: classifyBalanceDirection(openingBalance, subject.type, /*opening=*/true),
      periodDebit: debit,
      periodCredit: credit,
      closingBalance,
      closingDirection: classifyBalanceDirection(closingBalance, subject.type, /*opening=*/false),
    };
  });

  return send(res, 200, { trialBalance, period: { startDate, endDate } });
}

// 纯 helper：按 canonical accounting direction 规则对余额进行方向归类。
// 入参：
//   balance — 已签名的余额数值（cents）。
//   subjectType — 科目类型（ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE）。
//   opening — true 表示走 opening SQL 规则（SUM(DEBIT)-SUM(CREDIT)，符号直接代表方向）；
//             false 表示走 closing 规则（按科目 normal direction 解读）。
// 出参：
//   "DEBIT" | "CREDIT" | null（null 仅当余额为 0；不计入借/贷任一侧合计，避免污染 footer）。
//
// canonical 规则：
//   opening 余额的符号约定：Σ(DEBIT) - Σ(CREDIT)。
//     - 正数：净借方活动 → DEBIT 方向（与 subject type 无关）。
//     - 负数：净贷方活动 → CREDIT 方向（与 subject type 无关）。
//     - 零：null。
//   closing 余额的符号约定：
//     - ASSET / EXPENSE（debit-normal 科目）：期初+借方-贷方；
//       正余额 → DEBIT（normal side）；负余额 → CREDIT（contra balance，反向）。
//     - LIABILITY / EQUITY / REVENUE（credit-normal 科目）：期初+贷方-借方；
//       正余额 → CREDIT（normal side）；负余额 → DEBIT（contra balance，反向）。
function classifyBalanceDirection(balance, subjectType, opening) {
  if (balance === 0) return null;
  if (opening) {
    // opening 符号直接代表借贷方向，不依赖 subject type。
    return balance > 0 ? "DEBIT" : "CREDIT";
  }
  const isDebitNormal = subjectType === "ASSET" || subjectType === "EXPENSE";
  // closing：正余额对应科目 normal side，负余额对应 contra side。
  return (balance > 0) === isDebitNormal ? "DEBIT" : "CREDIT";
}

// ============ 利润表 ============
// 复用 calculateIncomeForPeriod；附加按科目类型的明细 section。

export function getIncomeStatement(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间，格式: YYYY-MM");

  let income;
  try {
    income = calculateIncomeForPeriod(db, period);
  } catch (e) {
    throw new HttpError(400, e.message);
  }

  const aggregateByType = db.prepare(`
    SELECT s.code, s.name, s.type,
      SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_cents ELSE 0 END) AS credit_total,
      SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_cents ELSE 0 END) AS debit_total
    FROM accounting_entries e
    JOIN accounting_vouchers v ON v.id = e.voucher_id
    JOIN accounting_subjects s ON s.id = e.subject_id
    WHERE v.status = 'POSTED'
      AND v.voucher_date >= ?
      AND v.voucher_date <= ?
      AND s.type IN ('REVENUE', 'EXPENSE')
    GROUP BY s.id
    ORDER BY s.code
  `).all(income.periodRange.startDate, income.periodRange.endDate);

  const buildSection = (type, name, sign) => {
    const rows = aggregateByType
      .filter(r => r.type === type)
      .map(r => ({ code: r.code, name: r.name, amount: sign === '+' ? Number(r.credit_total) - Number(r.debit_total) : Number(r.debit_total) - Number(r.credit_total) }))
      .filter(r => r.amount !== 0);
    const subtotal = rows.reduce((s, r) => s + r.amount, 0);
    return { name, type, subtotal, subjects: rows };
  };

  const revenueSection = buildSection('REVENUE', '营业收入', '+');
  const expenseSection = buildSection('EXPENSE', '营业成本与费用', '-');

  return send(res, 200, {
    period: income.period,
    periodRange: income.periodRange,
    revenue: income.revenue,
    expense: income.expense,
    profit: income.profit,
    sections: [revenueSection, expenseSection],
  });
}

// ============ 资产负债表 ============
// as-of / period-end 时点报表。统计 voucher_date <= asOfDate 的累计余额。
// 当前 schema 无自动损益结转，通过「未结转损益」虚拟权益行补偿。
// 扩展恒等式：Assets = Liabilities + Posted Equity + Unclosed Profit。

export function getBalanceSheet(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间，格式: YYYY-MM");
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) throw new HttpError(400, "期间格式错误，应为 YYYY-MM");
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new HttpError(400, "月份必须在 01-12 之间");

  const lastDay = new Date(year, month, 0).getDate();
  const asOfDate = period + "-" + String(lastDay).padStart(2, "0");

  const balances = db.prepare(`
    SELECT s.code, s.name, s.type,
      SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_cents ELSE 0 END) AS credit_total,
      SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_cents ELSE 0 END) AS debit_total
    FROM accounting_entries e
    JOIN accounting_vouchers v ON v.id = e.voucher_id
    JOIN accounting_subjects s ON s.id = e.subject_id
    WHERE v.status = 'POSTED'
      AND v.voucher_date <= ?
      AND s.type IN ('ASSET', 'LIABILITY', 'EQUITY')
    GROUP BY s.id
    ORDER BY s.code
  `).all(asOfDate);

  const buildSection = (type) => {
    const subjects = balances
      .filter(r => r.type === type)
      .map(r => {
        const credit = Number(r.credit_total);
        const debit = Number(r.debit_total);
        const amount = (type === 'ASSET') ? debit - credit : credit - debit;
        return { code: r.code, name: r.name, amount };
      })
      .filter(s => s.amount !== 0);
    const total = subjects.reduce((s, x) => s + x.amount, 0);
    return { total, subjects };
  };

  const assets = buildSection('ASSET');
  const liabilities = buildSection('LIABILITY');
  const equityPosted = buildSection('EQUITY');

  // 未结转损益：累计 voucher_date <= asOfDate 的 REVENUE/EXPENSE 净额
  const profitRows = db.prepare(`
    SELECT s.type,
      SUM(CASE WHEN e.direction = 'CREDIT' THEN e.amount_cents ELSE 0 END) AS credit_total,
      SUM(CASE WHEN e.direction = 'DEBIT'  THEN e.amount_cents ELSE 0 END) AS debit_total
    FROM accounting_entries e
    JOIN accounting_vouchers v ON v.id = e.voucher_id
    JOIN accounting_subjects s ON s.id = e.subject_id
    WHERE v.status = 'POSTED'
      AND v.voucher_date <= ?
      AND s.type IN ('REVENUE', 'EXPENSE')
    GROUP BY s.type
  `).all(asOfDate);

  let revenueNet = 0;
  let expenseNet = 0;
  for (const r of profitRows) {
    const credit = Number(r.credit_total);
    const debit = Number(r.debit_total);
    if (r.type === 'REVENUE') revenueNet = credit - debit;
    if (r.type === 'EXPENSE') expenseNet = debit - credit;
  }
  const unclosedProfit = revenueNet - expenseNet;
  const equityTotal = equityPosted.total + unclosedProfit;

  const totalAssets = assets.total;
  const totalLiabilitiesAndEquity = liabilities.total + equityTotal;
  const difference = totalAssets - totalLiabilitiesAndEquity;
  const equationValid = difference === 0;

  return send(res, 200, {
    period,
    asOfDate,
    assets,
    liabilities,
    equity: {
      postedEquity: equityPosted.total,
      unclosedProfit,
      total: equityTotal,
      subjects: equityPosted.subjects,
    },
    totalAssets,
    totalLiabilitiesAndEquity,
    difference,
    equationValid,
  });
}

export function getInventoryStatus(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  // Canonical stock truth lives in `inventory.quantity` (base UOM).  The
  // legacy `products.stock_quantity` display column is never written by
  // the canonical receipt / delivery / transfer / adjustment / scrap /
  // production flows, so threshold checks must use SUM(inventory.quantity)
  // per product rather than the stale display value.
  const items = db.prepare(`
    SELECT
      p.id,
      p.code,
      p.name,
      p.unit,
      p.min_stock,
      p.max_stock,
      p.reorder_point,
      COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0) AS quantity
    FROM products p
    WHERE EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.id)
    ORDER BY p.code
  `).all();
  const summary = { total: items.length, low: 0, normal: 0, over: 0 };
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (quantity <= Number(item.min_stock)) { item.status = "LOW"; summary.low++; }
    else if (quantity >= Number(item.max_stock) && Number(item.max_stock) > 0) { item.status = "OVER"; summary.over++; }
    else { item.status = "NORMAL"; summary.normal++; }
    item.quantity = quantity;
  }
  return send(res, 200, { items, summary });
}

export function getSalesAnalysis(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const startDate = url.searchParams.get("start_date") || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const endDate = url.searchParams.get("end_date") || new Date().toISOString().slice(0, 10);
  
  const orders = db.prepare("SELECT DATE(created_at) order_date, COUNT(*) order_count, SUM(total_cents) total_amount FROM sales_orders WHERE DATE(created_at) BETWEEN ? AND ? AND status='APPROVED' GROUP BY DATE(created_at) ORDER BY order_date").all(startDate, endDate);
  const topCustomers = db.prepare("SELECT c.name, COUNT(*) order_count, SUM(o.total_cents) total_amount FROM sales_orders o JOIN customers c ON c.id=o.customer_id WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status='APPROVED' GROUP BY c.id ORDER BY total_amount DESC LIMIT 10").all(startDate, endDate);
  const topProducts = db.prepare("SELECT p.name, SUM(oi.quantity) total_qty, SUM(oi.amount_cents) total_amount FROM sales_order_items oi JOIN sales_orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE DATE(o.created_at) BETWEEN ? AND ? AND o.status='APPROVED' GROUP BY p.id ORDER BY total_amount DESC LIMIT 10").all(startDate, endDate);
  
  return send(res, 200, { startDate, endDate, orders, topCustomers, topProducts });
}
