const fs = require("fs");
const path = require("path");
const appPath = path.join(__dirname, "app.js");
let app = fs.readFileSync(appPath, "utf8");

const newFunctions = `

// ============ 部门辅助核算 ============

async function listDepartments(db, res, actor, url) {
  allowAny(actor, ["DEPARTMENTS_VIEW", "DEPARTMENTS_MANAGE"]);
  const search = "%" + (url.searchParams.get("search") || "") + "%";
  const depts = db.prepare("SELECT d.*, p.name parent_name FROM departments d LEFT JOIN departments p ON p.id=d.parent_id WHERE (d.code LIKE ? OR d.name LIKE ?) ORDER BY d.code").all(search, search);
  return send(res, 200, { departments: depts });
}

async function createDepartment(db, req, res, actor) {
  allow(actor, "DEPARTMENTS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const deptId = id();
  db.prepare("INSERT INTO departments(id,code,name,parent_id,manager,created_at) VALUES(?,?,?,?,?,?)").run(deptId, body.code, body.name, body.parent_id || null, body.manager || "", now);
  return send(res, 201, { id: deptId });
}

async function getDepartment(db, res, actor, deptId) {
  allowAny(actor, ["DEPARTMENTS_VIEW", "DEPARTMENTS_MANAGE"]);
  const dept = db.prepare("SELECT d.*, p.name parent_name FROM departments d LEFT JOIN departments p ON p.id=d.parent_id WHERE d.id=?").get(deptId);
  if (!dept) throw new HttpError(404, "部门不存在");
  return send(res, 200, { department: dept });
}

async function updateDepartment(db, req, res, actor, deptId) {
  allow(actor, "DEPARTMENTS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE departments SET code=?,name=?,parent_id=?,manager=?,active=? WHERE id=?").run(body.code, body.name, body.parent_id || null, body.manager || "", body.active ? 1 : 0, deptId);
  return send(res, 200, { ok: true });
}

async function deleteDepartment(db, res, actor, deptId) {
  allow(actor, "DEPARTMENTS_MANAGE");
  const count = db.prepare("SELECT COUNT(*) cnt FROM accounting_entries WHERE department_id=?").get(deptId).cnt;
  if (count > 0) throw new HttpError(400, "该部门已被使用，无法删除");
  db.prepare("DELETE FROM departments WHERE id=?").run(deptId);
  return send(res, 200, { ok: true });
}

// ============ 项目辅助核算 ============

async function listProjects(db, res, actor, url) {
  allowAny(actor, ["PROJECTS_VIEW", "PROJECTS_MANAGE"]);
  const status = url.searchParams.get("status") || "";
  const search = "%" + (url.searchParams.get("search") || "") + "%";
  let sql = "SELECT * FROM projects WHERE (code LIKE ? OR name LIKE ?)";
  const params = [search, search];
  if (status) { sql += " AND status=?"; params.push(status); }
  sql += " ORDER BY code";
  const projects = db.prepare(sql).all(...params);
  return send(res, 200, { projects });
}

async function createProject(db, req, res, actor) {
  allow(actor, "PROJECTS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const projId = id();
  db.prepare("INSERT INTO projects(id,code,name,status,start_date,end_date,budget_cents,manager,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(projId, body.code, body.name, body.status || "RUNNING", body.start_date || null, body.end_date || null, body.budget_cents || 0, body.manager || "", now);
  return send(res, 201, { id: projId });
}

async function getProject(db, res, actor, projId) {
  allowAny(actor, ["PROJECTS_VIEW", "PROJECTS_MANAGE"]);
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(projId);
  if (!project) throw new HttpError(404, "项目不存在");
  return send(res, 200, { project });
}

async function updateProject(db, req, res, actor, projId) {
  allow(actor, "PROJECTS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE projects SET code=?,name=?,status=?,start_date=?,end_date=?,budget_cents=?,manager=?,active=? WHERE id=?").run(body.code, body.name, body.status, body.start_date || null, body.end_date || null, body.budget_cents || 0, body.manager || "", body.active ? 1 : 0, projId);
  return send(res, 200, { ok: true });
}

async function deleteProject(db, res, actor, projId) {
  allow(actor, "PROJECTS_MANAGE");
  const count = db.prepare("SELECT COUNT(*) cnt FROM accounting_entries WHERE project_id=?").get(projId).cnt;
  if (count > 0) throw new HttpError(400, "该项目已被使用，无法删除");
  db.prepare("DELETE FROM projects WHERE id=?").run(projId);
  return send(res, 200, { ok: true });
}

// ============ 币种管理 ============

function listCurrencies(db, res, actor) {
  allowAny(actor, ["CURRENCY_VIEW", "CURRENCY_MANAGE"]);
  const currencies = db.prepare("SELECT * FROM currencies ORDER BY is_base DESC, code").all();
  return send(res, 200, { currencies });
}

async function createCurrency(db, req, res, actor) {
  allow(actor, "CURRENCY_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO currencies(code,name,symbol,exchange_rate,is_base,updated_at) VALUES(?,?,?,?,?,?)").run(body.code, body.name, body.symbol, body.exchange_rate || 1.0, body.is_base ? 1 : 0, now);
  return send(res, 201, { ok: true });
}

async function updateCurrency(db, req, res, actor, code) {
  allow(actor, "CURRENCY_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE currencies SET name=?,symbol=?,exchange_rate=?,is_base=?,active=?,updated_at=? WHERE code=?").run(body.name, body.symbol, body.exchange_rate, body.is_base ? 1 : 0, body.active ? 1 : 0, now, code);
  return send(res, 200, { ok: true });
}

// ============ 凭证字管理 ============

function listVoucherWords(db, res, actor) {
  allowAny(actor, ["VOUCHER_WORDS_VIEW", "VOUCHER_WORDS_MANAGE"]);
  const words = db.prepare("SELECT * FROM voucher_words ORDER BY prefix").all();
  return send(res, 200, { voucherWords: words });
}

async function createVoucherWord(db, req, res, actor) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const wordId = id();
  db.prepare("INSERT INTO voucher_words(id,code,name,prefix,current_no,created_at) VALUES(?,?,?,?,0,?)").run(wordId, body.code, body.name, body.prefix, now);
  return send(res, 201, { id: wordId });
}

async function updateVoucherWord(db, req, res, actor, wordId) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const body = await readJson(req);
  db.prepare("UPDATE voucher_words SET code=?,name=?,prefix=?,active=? WHERE id=?").run(body.code, body.name, body.prefix, body.active ? 1 : 0, wordId);
  return send(res, 200, { ok: true });
}

async function deleteVoucherWord(db, res, actor, wordId) {
  allow(actor, "VOUCHER_WORDS_MANAGE");
  const used = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE voucher_word_id=?").get(wordId).cnt;
  if (used > 0) throw new HttpError(400, "该凭证字已被使用，无法删除");
  db.prepare("DELETE FROM voucher_words WHERE id=?").run(wordId);
  return send(res, 200, { ok: true });
}

// ============ 凭证模板 ============

function listVoucherTemplates(db, res, actor, url) {
  allowAny(actor, ["VOUCHER_TEMPLATES_VIEW", "VOUCHER_TEMPLATES_MANAGE"]);
  const category = url.searchParams.get("category") || "";
  let sql = "SELECT t.*, u.display_name creator_name FROM voucher_templates t LEFT JOIN users u ON u.id=t.creator_id WHERE 1=1";
  const params = [];
  if (category) { sql += " AND t.category=?"; params.push(category); }
  sql += " ORDER BY t.template_code";
  const templates = db.prepare(sql).all(...params).map(t => ({ ...t, entries: JSON.parse(t.entries_json) }));
  return send(res, 200, { templates });
}

async function createVoucherTemplate(db, req, res, actor) {
  allow(actor, "VOUCHER_TEMPLATES_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const templateId = id();
  db.prepare("INSERT INTO voucher_templates(id,template_code,template_name,description,category,entries_json,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(templateId, body.template_code, body.template_name, body.description || "", body.category || "GENERAL", JSON.stringify(body.entries || []), actor.id, now, now);
  return send(res, 201, { id: templateId });
}

function getVoucherTemplate(db, res, actor, templateId) {
  allowAny(actor, ["VOUCHER_TEMPLATES_VIEW", "VOUCHER_TEMPLATES_MANAGE"]);
  const template = db.prepare("SELECT t.*, u.display_name creator_name FROM voucher_templates t LEFT JOIN users u ON u.id=t.creator_id WHERE t.id=?").get(templateId);
  if (!template) throw new HttpError(404, "模板不存在");
  template.entries = JSON.parse(template.entries_json);
  return send(res, 200, { template });
}

async function updateVoucherTemplate(db, req, res, actor, templateId) {
  allow(actor, "VOUCHER_TEMPLATES_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  db.prepare("UPDATE voucher_templates SET template_name=?,description=?,category=?,entries_json=?,active=?,updated_at=? WHERE id=?").run(body.template_name, body.description || "", body.category || "GENERAL", JSON.stringify(body.entries || []), body.active ? 1 : 0, now, templateId);
  return send(res, 200, { ok: true });
}

// ============ 月结/年结 ============

function listPeriodClosures(db, res, actor, url) {
  allowAny(actor, ["PERIOD_CLOSE_VIEW", "PERIOD_CLOSE_MANAGE"]);
  const year = url.searchParams.get("year") || new Date().getFullYear();
  const closures = db.prepare("SELECT * FROM period_closures WHERE period_year=? ORDER BY period_month DESC").all(parseInt(year));
  return send(res, 200, { closures });
}

async function createPeriodClosure(db, req, res, actor) {
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

async function closePeriod(db, req, res, actor, closureId) {
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

async function unclosePeriod(db, req, res, actor, closureId) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const now = new Date().toISOString();
  db.prepare("UPDATE period_closures SET status=?,closed_by=?,closed_at=? WHERE id=?").run("OPEN", null, null, closureId);
  return send(res, 200, { ok: true, message: "反结账成功" });
}

function getClosureChecklist(db, req, res, actor, url) {
  allow(actor, "PERIOD_CLOSE_MANAGE");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const checklist = [];
  const pending = db.prepare("SELECT COUNT(*) cnt FROM accounting_vouchers WHERE period=? AND status=?").get(period, "DRAFT").cnt;
  checklist.push({ item: "未审核凭证", passed: pending === 0, detail: pending === 0 ? "无未审核凭证" : "有 " + pending + " 张未审核凭证" });
  return send(res, 200, { checklist });
}

// ============ 银行对账单 ============

function listBankStatements(db, res, actor, url) {
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

async function createBankStatement(db, req, res, actor) {
  allow(actor, "BANK_RECONCILE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const stmtId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM bank_statements WHERE bank_account_id=?").get(body.bank_account_id).cnt + 1).padStart(4, "0");
  const stmtNo = "BS-" + body.statement_date.replace(/-/g, "") + "-" + seq;
  db.prepare("INSERT INTO bank_statements(id,bank_account_id,statement_no,statement_date,period,opening_balance_cents,closing_balance_cents,total_debit_cents,total_credit_cents,total_count,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(stmtId, body.bank_account_id, stmtNo, body.statement_date, body.period, body.opening_balance_cents || 0, body.closing_balance_cents || 0, body.total_debit_cents || 0, body.total_credit_cents || 0, body.items?.length || 0, actor.id, now);
  return send(res, 201, { id: stmtId, statement_no: stmtNo });
}

function getBankStatement(db, res, actor, stmtId) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const stmt = db.prepare("SELECT bs.*, ba.bank_name, ba.account_no FROM bank_statements bs JOIN bank_accounts ba ON ba.id=bs.bank_account_id WHERE bs.id=?").get(stmtId);
  if (!stmt) throw new HttpError(404, "对账单不存在");
  stmt.items = db.prepare("SELECT * FROM bank_statement_items WHERE statement_id=? ORDER BY line_no").all(stmtId);
  return send(res, 200, { statement: stmt });
}

// ============ 银行对账 ============

function listBankReconciliations(db, res, actor, url) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const bankId = url.searchParams.get("bank_id") || "";
  let sql = "SELECT r.*, ba.bank_name, ba.account_no, u.display_name reconciled_by_name FROM bank_reconciliations r JOIN bank_accounts ba ON ba.id=r.bank_account_id LEFT JOIN users u ON u.id=r.reconciled_by WHERE 1=1";
  const params = [];
  if (bankId) { sql += " AND r.bank_account_id=?"; params.push(bankId); }
  sql += " ORDER BY r.period DESC";
  const reconciliations = db.prepare(sql).all(...params);
  return send(res, 200, { reconciliations });
}

async function createBankReconciliation(db, req, res, actor) {
  allow(actor, "BANK_RECONCILE_MANAGE");
  const body = await readJson(req);
  const now = new Date().toISOString();
  const reconId = id();
  const seq = String(db.prepare("SELECT COUNT(*) cnt FROM bank_reconciliations WHERE bank_account_id=?").get(body.bank_account_id).cnt + 1).padStart(4, "0");
  const reconNo = "BR-" + body.period + "-" + seq;
  db.prepare("INSERT INTO bank_reconciliations(id,bank_account_id,reconciliation_no,period,statement_balance_cents,book_balance_cents,difference_cents,reconciled_by,reconciled_at,remark) VALUES(?,?,?,?,?,?,?,?,?,?)").run(reconId, body.bank_account_id, reconNo, body.period, body.statement_balance_cents, body.book_balance_cents, body.difference_cents || 0, actor.id, now, body.remark || "");
  return send(res, 201, { id: reconId, reconciliation_no: reconNo });
}

function getBankReconciliation(db, res, actor, reconId) {
  allowAny(actor, ["BANK_RECONCILE_VIEW", "BANK_RECONCILE_MANAGE"]);
  const recon = db.prepare("SELECT r.*, ba.bank_name, ba.account_no, u.display_name reconciled_by_name FROM bank_reconciliations r JOIN bank_accounts ba ON ba.id=r.bank_account_id LEFT JOIN users u ON u.id=r.reconciled_by WHERE r.id=?").get(reconId);
  if (!recon) throw new HttpError(404, "对账记录不存在");
  return send(res, 200, { reconciliation: recon });
}

// ============ 会计报表 ============

function getTrialBalance(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const subjects = db.prepare("SELECT s.id, s.code, s.name, s.type, s.direction, SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as debit_total, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as credit_total FROM accounting_subjects s LEFT JOIN accounting_entries e ON e.subject_id=s.id AND e.voucher_id IN (SELECT id FROM accounting_vouchers WHERE period=?) WHERE s.active=1 GROUP BY s.id ORDER BY s.code").all(period);
  let totalDebit = 0, totalCredit = 0;
  const rows = subjects.filter(s => s.debit_total > 0 || s.credit_total > 0).map(s => { totalDebit += s.debit_total || 0; totalCredit += s.credit_total || 0; return { ...s, debit_total: s.debit_total || 0, credit_total: s.credit_total || 0 }; });
  return send(res, 200, { rows, totals: { debit: totalDebit, credit: totalCredit }, period });
}

function getSubjectLedger(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const subjectId = url.searchParams.get("subject_id");
  if (!subjectId) throw new HttpError(400, "请指定科目");
  const subject = db.prepare("SELECT * FROM accounting_subjects WHERE id=?").get(subjectId);
  if (!subject) throw new HttpError(404, "科目不存在");
  const entries = db.prepare("SELECT e.*, v.voucher_no, v.voucher_date, v.period FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id WHERE e.subject_id=? AND v.status='POSTED' ORDER BY v.voucher_date, v.voucher_no").all(subjectId);
  return send(res, 200, { subject, entries });
}

function getVoucherSummary(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const summary = db.prepare("SELECT v.voucher_no, v.voucher_date, v.source_type, v.remark, SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as total_debit, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as total_credit, u.display_name as creator_name FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id LEFT JOIN users u ON u.id=v.creator_id WHERE v.period=? GROUP BY v.id ORDER BY v.voucher_date, v.voucher_no").all(period);
  return send(res, 200, { vouchers: summary, period });
}

function getDailyBalance(db, req, res, actor, url) {
  allow(actor, "REPORT_VIEW");
  const period = url.searchParams.get("period");
  if (!period) throw new HttpError(400, "请指定期间");
  const [year, month] = period.split("-");
  const dailyData = db.prepare("SELECT v.voucher_date, SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END) as debit, SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END) as credit FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id WHERE v.period=? AND v.status='POSTED' GROUP BY v.voucher_date ORDER BY v.voucher_date").all(period);
  return send(res, 200, { period, rows: dailyData });
}

// ============ 增强的凭证管理 ============

async function createAccountingVoucher(db, req, res, actor) {
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

async function updateAccountingVoucher(db, req, res, actor, voucherId) {
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

async function deleteAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, "ACCOUNTING_MANAGE");
  const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE id=?").get(voucherId);
  if (!voucher) throw new HttpError(404, "凭证不存在");
  if (voucher.status === "POSTED") throw new HttpError(400, "已过账凭证不能删除");
  db.prepare("DELETE FROM accounting_vouchers WHERE id=?").run(voucherId);
  return send(res, 200, { ok: true });
}

async function approveAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, "ACCOUNTING_MANAGE");
  const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE id=?").get(voucherId);
  if (!voucher) throw new HttpError(404, "凭证不存在");
  if (voucher.status === "POSTED") throw new HttpError(400, "凭证已过账");
  const now = new Date().toISOString();
  db.prepare("UPDATE accounting_vouchers SET status=?,approver_id=?,approved_at=?,updated_at=? WHERE id=?").run("POSTED", actor.id, now, now, voucherId);
  return send(res, 200, { ok: true });
}
`;

// 在文件末尾添加新函数
app = app + newFunctions;

fs.writeFileSync(appPath, app);
console.log("Functions added!");
