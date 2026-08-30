import { id } from '../db.js';
import { HttpError, allow, allowAny, readJson, send } from '../lib/http.js';

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

export async function getDepartment(db, res, actor, deptId) {
  allowAny(actor, ["DEPARTMENTS_VIEW", "DEPARTMENTS_MANAGE"]);
  const dept = db.prepare("SELECT d.*, p.name parent_name FROM departments d LEFT JOIN departments p ON p.id=d.parent_id WHERE d.id=?").get(deptId);
  if (!dept) throw new HttpError(404, "部门不存在");
  return send(res, 200, { department: dept });
}

export async function updateDepartment(db, req, res, actor, deptId) {
  allow(actor, "DEPARTMENTS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE departments SET code=?,name=?,parent_id=?,manager=?,active=? WHERE id=?").run(body.code, body.name, body.parent_id || null, body.manager || "", body.active ? 1 : 0, deptId);
  return send(res, 200, { ok: true });
}

export async function deleteDepartment(db, res, actor, deptId) {
  allow(actor, "DEPARTMENTS_MANAGE");
  const count = db.prepare("SELECT COUNT(*) cnt FROM accounting_entries WHERE department_id=?").get(deptId).cnt;
  if (count > 0) throw new HttpError(400, "该部门已被使用，无法删除");
  db.prepare("DELETE FROM departments WHERE id=?").run(deptId);
  return send(res, 200, { ok: true });
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

export async function getProject(db, res, actor, projId) {
  allowAny(actor, ["PROJECTS_VIEW", "PROJECTS_MANAGE"]);
  const project = db.prepare("SELECT * FROM aux_projects WHERE id=?").get(projId);
  if (!project) throw new HttpError(404, "项目不存在");
  return send(res, 200, { project });
}

export async function updateAuxProject(db, req, res, actor, projId) {
  allow(actor, "PROJECTS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE aux_projects SET code=?,name=?,status=?,start_date=?,end_date=?,budget_cents=?,manager=?,active=? WHERE id=?").run(body.code, body.name, body.status, body.start_date || null, body.end_date || null, body.budget_cents || 0, body.manager || "", body.active ? 1 : 0, projId);
  return send(res, 200, { ok: true });
}

export async function deleteProject(db, res, actor, projId) {
  allow(actor, "PROJECTS_MANAGE");
  const count = db.prepare("SELECT COUNT(*) cnt FROM accounting_entries WHERE project_id=?").get(projId).cnt;
  if (count > 0) throw new HttpError(400, "该项目已被使用，无法删除");
  db.prepare("DELETE FROM aux_projects WHERE id=?").run(projId);
  return send(res, 200, { ok: true });
}

// ============ 币种管理 ============

export function listCurrencies(db, res, actor) {
  allowAny(actor, ["CURRENCY_VIEW", "CURRENCY_MANAGE"]);
  const currencies = db.prepare("SELECT * FROM currencies ORDER BY is_base DESC, code").all();
  return send(res, 200, { currencies });
}

export async function createCurrency(db, req, res, actor) {
  allow(actor, "CURRENCY_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO currencies(code,name,symbol,exchange_rate,is_base,updated_at) VALUES(?,?,?,?,?,?)").run(body.code, body.name, body.symbol, body.exchange_rate || 1.0, body.is_base ? 1 : 0, now);
  return send(res, 201, { ok: true });
}

export async function updateCurrency(db, req, res, actor, code) {
  allow(actor, "CURRENCY_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE currencies SET name=?,symbol=?,exchange_rate=?,is_base=?,active=?,updated_at=? WHERE code=?").run(body.name, body.symbol, body.exchange_rate, body.is_base ? 1 : 0, body.active ? 1 : 0, now, code);
  return send(res, 200, { ok: true });
}

// ============ 凭证字管理 ============

export function listVoucherWords(db, res, actor) {
  allowAny(actor, ["VOUCHER_WORDS_VIEW", "VOUCHER_WORDS_MANAGE"]);
  const words = db.prepare("SELECT * FROM voucher_words ORDER BY prefix").all();
  return send(res, 200, { voucherWords: words });
}

export async function createVoucherWord(db, req, res, actor) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const wordId = id();
  db.prepare("INSERT INTO voucher_words(id,code,name,prefix,current_no,created_at) VALUES(?,?,?,?,0,?)").run(wordId, body.code, body.name, body.prefix, now);
  return send(res, 201, { id: wordId });
}

export async function updateVoucherWord(db, req, res, actor, wordId) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE voucher_words SET code=?,name=?,prefix=?,active=? WHERE id=?").run(body.code, body.name, body.prefix, body.active ? 1 : 0, wordId);
  return send(res, 200, { ok: true });
}

export async function deleteVoucherWord(db, res, actor, wordId) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const used = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE voucher_word_id=?").get(wordId).cnt;
  if (used > 0) throw new HttpError(400, "该凭证字已被使用，无法删除");
  db.prepare("DELETE FROM voucher_words WHERE id=?").run(wordId);
  return send(res, 200, { ok: true });
}

// ============ 凭证模板 ============

export function listVoucherTemplates(db, res, actor, url) {
  allowAny(actor, ["VOUCHER_TEMPLATES_VIEW", "VOUCHER_TEMPLATES_MANAGE"]);
  const category = url.searchParams.get("category") || "";
  let sql = "SELECT t.*, u.display_name creator_name FROM voucher_templates t LEFT JOIN users u ON u.id=t.creator_id WHERE 1=1";
  const params = [];
  if (category) { sql += " AND t.category=?"; params.push(category); }
  sql += " ORDER BY t.template_code";
  const templates = db.prepare(sql).all(...params).map(t => ({ ...t, entries: JSON.parse(t.entries_json) }));
  return send(res, 200, { templates });
}

export async function createVoucherTemplate(db, req, res, actor) {
  allow(actor, "VOUCHER_TEMPLATES_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const templateId = id();
  db.prepare("INSERT INTO voucher_templates(id,template_code,template_name,description,category,entries_json,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(templateId, body.template_code, body.template_name, body.description || "", body.category || "GENERAL", JSON.stringify(body.entries || []), actor.id, now, now);
  return send(res, 201, { id: templateId });
}

export function getVoucherTemplate(db, res, actor, templateId) {
  allowAny(actor, ["VOUCHER_TEMPLATES_VIEW", "VOUCHER_TEMPLATES_MANAGE"]);
  const template = db.prepare("SELECT t.*, u.display_name creator_name FROM voucher_templates t LEFT JOIN users u ON u.id=t.creator_id WHERE t.id=?").get(templateId);
  if (!template) throw new HttpError(404, "模板不存在");
  template.entries = JSON.parse(template.entries_json);
  return send(res, 200, { template });
}

export async function updateVoucherTemplate(db, req, res, actor, templateId) {
  allow(actor, "VOUCHER_TEMPLATES_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE voucher_templates SET template_name=?,description=?,category=?,entries_json=?,active=?,updated_at=? WHERE id=?").run(body.template_name, body.description || "", body.category || "GENERAL", JSON.stringify(body.entries || []), body.active ? 1 : 0, now, templateId);
  return send(res, 200, { ok: true });
}

// ============ 月结/年结 ============

export function listPeriodClosures(db, res, actor, url) {
  allowAny(actor, ["PERIOD_CLOSE_VIEW", "PERIOD_CLOSE_MANAGE"]);
  const year = url.searchParams.get("year") || new Date().getFullYear();
  const closures = db.prepare("SELECT * FROM period_closures WHERE period_year=? ORDER BY period_month DESC").all(parseInt(year));
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

export async function closePeriod(db, req, res, actor, closureId) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const closure = db.prepare("SELECT * FROM period_closures WHERE id=?").get(closureId);
  if (!closure) throw new HttpError(404, "期间不存在");
  if (closure.status === "CLOSED") throw new HttpError(400, "期间已结账");
  const pendingVouchers = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE period=? AND status=?").get(closure.period, "DRAFT").cnt;
  if (pendingVouchers > 0) throw new HttpError(400, "有 " + pendingVouchers + " 张凭证未审核，请先审核");
  const now = new Date().toISOString();
  db.prepare("UPDATE period_closures SET status=?,closed_by=?,closed_at=?,checklist_passed=1 WHERE id=?").run("CLOSED", actor.id, now, closureId);
  return send(res, 200, { ok: true, message: "期间结账成功" });
}

export async function unclosePeriod(db, req, res, actor, closureId) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const now = new Date().toISOString();
  db.prepare("UPDATE period_closures SET status=?,closed_by=?,closed_at=? WHERE id=?").run("OPEN", null, null, closureId);
  return send(res, 200, { ok: true, message: "反结账成功" });
}

export function getClosureChecklist(db, req, res, actor, url) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const checklist = [];
  const pending = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE period=? AND status=?").get(period, "DRAFT").cnt;
  checklist.push({ item: "未审核凭证", passed: pending === 0, detail: pending === 0 ? "无未审核凭证" : "有 " + pending + " 张未审核凭证" });
  return send(res, 200, { checklist });
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

export function getBankStatement(db, res, actor, stmtId) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const stmt = db.prepare("SELECT bs.*, ba.bank_name, ba.account_no FROM bank_statements bs JOIN bank_accounts ba ON ba.id=bs.bank_account_id WHERE bs.id=?").get(stmtId);
  if (!stmt) throw new HttpError(404, "对账单不存在");
  stmt.items = db.prepare("SELECT * FROM bank_statement_items WHERE statement_id=? ORDER BY line_no").all(stmtId);
  return send(res, 200, { statement: stmt });
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

export function getBankReconciliation(db, res, actor, reconId) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const recon = db.prepare("SELECT r.*, ba.bank_name, ba.account_no, u.display_name reconciled_by_name FROM bank_reconciliations r JOIN bank_accounts ba ON ba.id=r.bank_account_id LEFT JOIN users u ON u.id=r.reconciled_by WHERE r.id=?").get(reconId);
  if (!recon) throw new HttpError(404, "对账记录不存在");
  return send(res, 200, { reconciliation: recon });
}

// ============ 会计报表 ============

export function legacyGetTrialBalance(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const subjects = db.prepare("SELECT s.id, s.code, s.name, s.type, s.direction, SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as debit_total, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as credit_total FROM accounting_subjects s LEFT JOIN accounting_entries e ON e.subject_id=s.id AND e.voucher_id IN (SELECT id FROM accounting_vouchers WHERE period=?) WHERE s.active=1 GROUP BY s.id ORDER BY s.code").all(period);
  let totalDebit = 0, totalCredit = 0;
  const rows = subjects.filter(s => s.debit_total > 0 || s.credit_total > 0).map(s => { totalDebit += s.debit_total || 0; totalCredit += s.credit_total || 0; return { ...s, debit_total: s.debit_total || 0, credit_total: s.credit_total || 0 }; });
  return send(res, 200, { rows, totals: { debit: totalDebit, credit: totalCredit }, period });
}

export function getSubjectLedger(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const subjectId = url.searchParams.get("subject_id");
  if (!subjectId) throw new HttpError(400, "请指定科目");
  const subject = db.prepare("SELECT * FROM accounting_subjects WHERE id=?").get(subjectId);
  if (!subject) throw new HttpError(404, "科目不存在");
  const entries = db.prepare("SELECT e.*, v.voucher_no, v.voucher_date, v.period FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=? AND v.status='POSTED' ORDER BY v.voucher_date, v.voucher_no").all(subjectId);
  return send(res, 200, { subject, entries });
}

export function getVoucherSummary(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const summary = db.prepare("SELECT v.voucher_no, v.voucher_date, v.source_type, v.remark, SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as total_debit, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as total_credit, u.display_name as creator_name FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id LEFT JOIN users u ON u.id=v.creator_id WHERE v.period=? GROUP BY v.id ORDER BY v.voucher_date, v.voucher_no").all(period);
  return send(res, 200, { vouchers: summary, period });
}

export function getDailyBalance(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const [year, month] = period.split("-");
  const dailyData = db.prepare("SELECT v.voucher_date, SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as debit, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as credit FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id WHERE v.period=? AND v.status='POSTED' GROUP BY v.voucher_date ORDER BY v.voucher_date").all(period);
  return send(res, 200, { period, rows: dailyData });
}

// ============ 增强的凭证管理 ============

export async function legacyCreateAccountingVoucher(db, req, res, actor) {
  allow(actor, "ACCOUNTING_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const voucherId = id();
  const year = new Date(body.voucher_date).getFullYear();
  const month = new Date(body.voucher_date).getMonth() + 1;
  const period = year + "-" + String(month).padStart(2, "0");
  const prefix = body.voucher_word_id ? db.prepare("SELECT prefix FROM voucher_words WHERE id=?").get(body.voucher_word_id)?.prefix || "JZ" : "JZ";
  const seq = db.prepare("SELECT current_no FROM voucher_sequences WHERE voucher_word_id=? AND year=? AND month=?").get(body.voucher_word_id || "default", year, month) || { current_no: 0 };
  const newNo = seq.current_no + 1;
  db.prepare("INSERT OR REPLACE INTO voucher_sequences(id,voucher_word_id,year,month,current_no) VALUES(?,?,?,?,?)").run(id(), body.voucher_word_id || "default", year, month, newNo);
  const voucherNo = prefix + "-" + year + String(month).padStart(2, "0") + String(newNo).padStart(4, "0");
  db.prepare("INSERT INTO accounting_vouchers(id,voucher_no,voucher_word_id,source_type,source_id,voucher_date,period,remark,attachment_count,creator_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(voucherId, voucherNo, body.voucher_word_id || null, body.source_type || "MANUAL", body.source_id || "", body.voucher_date, period, body.remark || "", body.attachment_count || 0, actor.id, body.status || "POSTED", now, now);
  for (let i = 0; i < body.entries.length; i++) {
    const entry = body.entries[i];
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,department_id,project_id,customer_id,supplier_id,currency_code,exchange_rate,amount_foreign,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id(), voucherId, entry.subject_id, entry.direction, entry.amount_cents, entry.summary || "", entry.department_id || null, entry.project_id || null, entry.customer_id || null, entry.supplier_id || null, entry.currency_code || "CNY", entry.exchange_rate || 1.0, entry.amount_foreign || 0, i + 1);
  }
  return send(res, 201, { id: voucherId, voucher_no: voucherNo });
}

export async function legacyUpdateAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, "ACCOUNTING_MANAGE");
  const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE id=?").get(voucherId);
  if (!voucher) throw new HttpError(404, "凭证不存在");
  if (voucher.status === "POSTED") throw new HttpError(400, "已过账凭证不能修改");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE accounting_vouchers SET voucher_date=?,remark=?,attachment_count=?,updated_at=? WHERE id=?").run(body.voucher_date, body.remark || "", body.attachment_count || 0, now, voucherId);
  db.prepare("DELETE FROM accounting_entries WHERE voucher_id=?").run(voucherId);
  for (let i = 0; i < body.entries.length; i++) {
    const entry = body.entries[i];
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,department_id,project_id,customer_id,supplier_id,currency_code,exchange_rate,amount_foreign,line_no) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id(), voucherId, entry.subject_id, entry.direction, entry.amount_cents, entry.summary || "", entry.department_id || null, entry.project_id || null, entry.customer_id || null, entry.supplier_id || null, entry.currency_code || "CNY", entry.exchange_rate || 1.0, entry.amount_foreign || 0, i + 1);
  }
  return send(res, 200, { ok: true });
}

export async function legacyDeleteAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, "ACCOUNTING_MANAGE");
  const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE id=?").get(voucherId);
  if (!voucher) throw new HttpError(404, "凭证不存在");
  if (voucher.status === "POSTED") throw new HttpError(400, "已过账凭证不能删除");
  db.prepare("DELETE FROM accounting_vouchers WHERE id=?").run(voucherId);
  return send(res, 200, { ok: true });
}

export async function approveAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, "ACCOUNTING_MANAGE");
  const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE id=?").get(voucherId);
  if (!voucher) throw new HttpError(404, "凭证不存在");
  if (voucher.status === "POSTED") throw new HttpError(400, "凭证已过账");
  const now = new Date().toISOString();
  db.prepare("UPDATE accounting_vouchers SET status=?,approver_id=?,approved_at=?,updated_at=? WHERE id=?").run("POSTED", actor.id, now, now, voucherId);
  return send(res, 200, { ok: true });
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

export function getMrpPlan(db, res, actor, planId) {
  allowAny(actor, ["MRP_VIEW", "MRP_MANAGE"]);
  const plan = db.prepare("SELECT p.*, u.display_name creator_name FROM mrp_plans p LEFT JOIN users u ON u.id=p.creator_id WHERE p.id=?").get(planId);
  if (!plan) throw new HttpError(404, "MRP计划不存在");
  plan.items = db.prepare("SELECT i.*, pr.code product_code, pr.name product_name FROM mrp_plan_items i JOIN products pr ON pr.id=i.product_id WHERE i.plan_id=? ORDER BY i.id").all(planId);
  return send(res, 200, { plan });
}

export async function updateMrpPlan(db, req, res, actor, planId) {
  allow(actor, "MRP_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE mrp_plans SET status=?, updated_at=? WHERE id=?").run(body.status || "DRAFT", now, planId);
  return send(res, 200, { ok: true });
}

export async function generateMrp(db, req, res, actor) {
  allow(actor, "MRP_MANAGE");
  const body = await readJson(req);
  const { plan_id, demand_type, demand_source_id } = body;
  const plan = db.prepare("SELECT * FROM mrp_plans WHERE id=?").get(plan_id);
  if (!plan) throw new HttpError(404, "MRP计划不存在");
  
  const now = new Date().toISOString();
  
  // 获取销售订单需求
  if (demand_type === "SALES_ORDER" && demand_source_id) {
    const order = db.prepare("SELECT * FROM sales_orders WHERE id=?").get(demand_source_id);
    if (order) {
      const items = db.prepare("SELECT * FROM sales_order_items WHERE order_id=?").all(demand_source_id);
      for (const item of items) {
        const product = db.prepare("SELECT * FROM products WHERE id=?").get(item.product_id);
        const onHand = product?.stock_quantity || 0;
        const scheduledReceipt = db.prepare("SELECT COALESCE(SUM(quantity), 0) total FROM purchase_receipts WHERE product_id=? AND status='CONFIRMED'").get(item.product_id).total;
        
        const itemId = id();
        const plannedQty = Math.max(0, item.quantity - onHand - scheduledReceipt);
        
        db.prepare("INSERT INTO mrp_plan_items(id,plan_id,product_id,demand_type,demand_source_id,gross_requirement,on_hand,scheduled_receipt,planned_receipt,planned_order_quantity,due_date,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(itemId, plan_id, item.product_id, demand_type, demand_source_id, item.quantity, onHand, scheduledReceipt, 0, plannedQty, order.submitted_at?.slice(0, 10) || now.slice(0, 10), "PENDING");
      }
    }
  }
  
  // 更新计划汇总
  const stats = db.prepare("SELECT COUNT(*) total_items, SUM(planned_order_quantity) total_qty FROM mrp_plan_items WHERE plan_id=?").get(plan_id);
  db.prepare("UPDATE mrp_plans SET total_items=?, updated_at=? WHERE id=?").run(stats.total_items || 0, now, plan_id);
  
  return send(res, 200, { ok: true, message: "MRP计算完成" });
}

export async function executeMrpPlan(db, req, res, actor, planId) {
  allow(actor, "MRP_MANAGE");
  const body = await readJson(req);
  const plan = db.prepare("SELECT * FROM mrp_plans WHERE id=?").get(planId);
  if (!plan) throw new HttpError(404, "MRP计划不存在");
  
  const items = db.prepare("SELECT * FROM mrp_plan_items WHERE plan_id=? AND status='PENDING'").all(planId);
  const now = new Date().toISOString();
  let created = 0;
  
  for (const item of items) {
    if (item.planned_order_quantity > 0) {
      // 生成采购申请
      const seq = String(db.prepare("SELECT COUNT(*) cnt FROM purchase_orders").get().cnt + 1).padStart(4, "0");
      const poNo = "PO-MRP-" + seq;
      const poId = id();
      
      db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(poId, poNo, body.supplier_id || "supplier-001", "DRAFT", 0, actor.id, now, now);
      
      const product = db.prepare("SELECT * FROM products WHERE id=?").get(item.product_id);
      const amount = (item.planned_order_quantity * (product?.price_cents || 0));
      
      db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)")
        .run(id(), poId, item.product_id, item.planned_order_quantity, product?.price_cents || 0, amount);
      
      db.prepare("UPDATE purchase_orders SET total_cents=? WHERE id=?", amount, poId);
      
      db.prepare("UPDATE mrp_plan_items SET status='CONVERTED', planned_receipt=? WHERE id=?", item.planned_order_quantity, item.id);
      created++;
    }
  }
  
  db.prepare("UPDATE mrp_plans SET status='COMPLETED', updated_at=? WHERE id=?", now, planId);
  
  return send(res, 200, { ok: true, message: "已生成" + created + "个采购申请" });
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
  db.prepare("INSERT INTO work_centers(id,code,name,type,capacity_hours,efficiency,unit_cost_cents,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(wcId, body.code, body.name, body.type || "ASSEMBLY", body.capacity_hours || 8, body.efficiency || 100, body.unit_cost_cents || 0, now);
  return send(res, 201, { id: wcId });
}

export async function updateWorkCenter(db, req, res, actor, wcId) {
  allow(actor, "WORK_CENTERS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE work_centers SET name=?,type=?,capacity_hours=?,efficiency=?,unit_cost_cents=?,active=? WHERE id=?")
    .run(body.name, body.type || "ASSEMBLY", body.capacity_hours || 8, body.efficiency || 100, body.unit_cost_cents || 0, body.active ? 1 : 0, wcId);
  return send(res, 200, { ok: true });
}

export async function deleteWorkCenter(db, res, actor, wcId) {
  allow(actor, "WORK_CENTERS_MANAGE");
  const used = db.prepare("SELECT COUNT(*) cnt FROM routing_operations WHERE work_center_id=?").get(wcId).cnt;
  if (used > 0) throw new HttpError(400, "该工作中心已被工序使用，无法删除");
  db.prepare("DELETE FROM work_centers WHERE id=?").run(wcId);
  return send(res, 200, { ok: true });
}

// ============ 工序管理 ============

export function listRoutingOperations(db, res, actor, url) {
  allowAny(actor, ["ROUTING_VIEW", "ROUTING_MANAGE"]);
  const bomId = url.searchParams.get("bom_id");
  let sql = "SELECT r.*, w.code wc_code, w.name wc_name, b.bom_code FROM routing_operations r JOIN work_centers w ON w.id=r.work_center_id JOIN boms b ON b.id=r.bom_id";
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

export function getRoutingByBom(db, res, actor, bomId) {
  allowAny(actor, ["ROUTING_VIEW", "ROUTING_MANAGE"]);
  const operations = db.prepare("SELECT r.*, w.code wc_code, w.name wc_name FROM routing_operations r JOIN work_centers w ON w.id=r.work_center_id WHERE r.bom_id=? ORDER BY r.operation_no").all(bomId);
  return send(res, 200, { operations });
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
  const now = new Date().toISOString();
  const iqcId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM iqc_inspections").get().cnt + 1).padStart(4, "0");
  const iqcNo = "IQC-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  db.prepare("INSERT INTO iqc_inspections(id,iqc_no,supplier_id,receipt_id,inspection_type,status,total_quantity,sample_quantity,inspector_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(iqcId, iqcNo, body.supplier_id, body.receipt_id || null, body.inspection_type || "NORMAL", "PENDING", body.total_quantity || 0, body.sample_quantity || 0, actor.id, now, now);
  
  return send(res, 201, { id: iqcId, iqc_no: iqcNo });
}

export function getIqcInspection(db, res, actor, iqcId) {
  allowAny(actor, ["IQC_VIEW", "IQC_MANAGE"]);
  const inspection = db.prepare("SELECT i.*, s.code supplier_code, s.name supplier_name, u.display_name inspector_name FROM iqc_inspections i JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN users u ON u.id=i.inspector_id WHERE i.id=?").get(iqcId);
  if (!inspection) throw new HttpError(404, "检验单不存在");
  inspection.items = db.prepare("SELECT ii.*, p.code product_code, p.name product_name FROM iqc_inspection_items ii JOIN products p ON p.id=ii.product_id WHERE ii.iqc_id=?").all(iqcId);
  return send(res, 200, { inspection });
}

export async function updateIqcInspection(db, req, res, actor, iqcId) {
  allow(actor, "IQC_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  
  if (body.status === "COMPLETED") {
    db.prepare("UPDATE iqc_inspections SET status=?,result=?,qualified_quantity=?,reject_quantity=?,inspected_at=?,remark=?,updated_at=? WHERE id=?")
      .run("COMPLETED", body.result || "PASS", body.qualified_quantity || 0, body.reject_quantity || 0, now, body.remark || "", now, iqcId);
  } else {
    db.prepare("UPDATE iqc_inspections SET status=?,remark=?,updated_at=? WHERE id=?")
      .run(body.status || "PENDING", body.remark || "", now, iqcId);
  }
  
  // 如果有明细
  if (body.items?.length) {
    db.prepare("DELETE FROM iqc_inspection_items WHERE iqc_id=?").run(iqcId);
    for (const item of body.items) {
      db.prepare("INSERT INTO iqc_inspection_items(id,iqc_id,product_id,batch_no,quantity,sample_size,qualified,reject_reason) VALUES(?,?,?,?,?,?,?,?)")
        .run(id(), iqcId, item.product_id, item.batch_no || "", item.quantity || 0, item.sample_size || 0, item.qualified ? 1 : 0, item.reject_reason || "");
    }
  }
  
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
  const now = new Date().toISOString();
  const oqcId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM oqc_inspections").get().cnt + 1).padStart(4, "0");
  const oqcNo = "OQC-" + now.slice(0, 10).replace(/-/g, "") + "-" + seq;
  
  db.prepare("INSERT INTO oqc_inspections(id,oqc_no,customer_id,delivery_id,inspection_type,status,total_quantity,sample_quantity,inspector_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(oqcId, oqcNo, body.customer_id, body.delivery_id || null, body.inspection_type || "NORMAL", "PENDING", body.total_quantity || 0, body.sample_quantity || 0, actor.id, now, now);
  
  return send(res, 201, { id: oqcId, oqc_no: oqcNo });
}

export function getOqcInspection(db, res, actor, oqcId) {
  allowAny(actor, ["OQC_VIEW", "OQC_MANAGE"]);
  const inspection = db.prepare("SELECT o.*, c.code customer_code, c.name customer_name, u.display_name inspector_name FROM oqc_inspections o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.inspector_id WHERE o.id=?").get(oqcId);
  if (!inspection) throw new HttpError(404, "检验单不存在");
  inspection.items = db.prepare("SELECT oi.*, p.code product_code, p.name product_name FROM oqc_inspection_items oi JOIN products p ON p.id=oi.product_id WHERE oi.oqc_id=?").all(oqcId);
  return send(res, 200, { inspection });
}

export async function updateOqcInspection(db, req, res, actor, oqcId) {
  allow(actor, "OQC_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  
  if (body.status === "COMPLETED") {
    db.prepare("UPDATE oqc_inspections SET status=?,result=?,qualified_quantity=?,reject_quantity=?,inspected_at=?,remark=?,updated_at=? WHERE id=?")
      .run("COMPLETED", body.result || "PASS", body.qualified_quantity || 0, body.reject_quantity || 0, now, body.remark || "", now, oqcId);
  } else {
    db.prepare("UPDATE oqc_inspections SET status=?,remark=?,updated_at=? WHERE id=?")
      .run(body.status || "PENDING", body.remark || "", now, oqcId);
  }
  
  if (body.items?.length) {
    db.prepare("DELETE FROM oqc_inspection_items WHERE oqc_id=?").run(oqcId);
    for (const item of body.items) {
      db.prepare("INSERT INTO oqc_inspection_items(id,oqc_id,product_id,batch_no,quantity,sample_size,qualified,reject_reason) VALUES(?,?,?,?,?,?,?,?)")
        .run(id(), oqcId, item.product_id, item.batch_no || "", item.quantity || 0, item.sample_size || 0, item.qualified ? 1 : 0, item.reject_reason || "");
    }
  }
  
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

export function getFinancialSummary(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period") || new Date().toISOString().slice(0, 7);
  
  const revenue = db.prepare("SELECT COALESCE(SUM(e.amount_cents), 0) total FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.period=? AND v.status='POSTED' AND s.type='REVENUE'").get(period).total;
  const expense = db.prepare("SELECT COALESCE(SUM(e.amount_cents), 0) total FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.period=? AND v.status='POSTED' AND s.type='EXPENSE'").get(period).total;
  const ar = db.prepare("SELECT COALESCE(SUM(amount_cents - paid_cents), 0) total FROM account_receivables WHERE status IN ('PENDING', 'PARTIAL')").get().total;
  const ap = db.prepare("SELECT COALESCE(SUM(amount_cents - paid_cents), 0) total FROM account_payables WHERE status IN ('PENDING', 'PARTIAL')").get().total;
  
  return send(res, 200, { period, revenue, expense, profit: revenue - expense, accounts_receivable: ar, accounts_payable: ap });
}

export function getInventoryStatus(db, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const items = db.prepare("SELECT p.id, p.code, p.name, p.unit, p.stock_quantity, p.reorder_point, p.min_stock, p.max_stock, w.name warehouse_name FROM inventory i JOIN products p ON p.id=i.product_id JOIN warehouses w ON w.id=i.warehouse_id ORDER BY p.code").all();
  const summary = { total: items.length, low: 0, normal: 0, over: 0 };
  for (const item of items) {
    if (item.stock_quantity <= item.min_stock) { item.status = "LOW"; summary.low++; }
    else if (item.stock_quantity >= item.max_stock) { item.status = "OVER"; summary.over++; }
    else { item.status = "NORMAL"; summary.normal++; }
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
