// Accounting & Analytics Domain Closure — AA-W4 报表平台.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.4
//   AA-W4.1..AA-W4.13
// Design:    docs/design/accounting-analytics.md §31.4 / §31.8 / §31.9 / §31.10
//
// Single responsibility: 报表模板（行项目、可见范围、状态与版本）、报表期间
// 实例（计算、提交、审核、版本与留痕）与模板试算。
//
// Boundaries enforced by this module:
//   - It never evaluates a formula with `eval` / `Function` / `vm`. Report
//     formulas go through the domain's own restricted grammar
//     (`accounting-expressions.js::evaluateReportExpression`), which shares no
//     entry point and no identifier namespace with the workshop formula
//     grammar (`server/lib/formula-evaluator.js`).
//   - It never invents a second GL reading path. Every data source is one of
//     the whitelisted sources below, and every source reads the **posted**
//     ledger only.
//   - A failed evaluation is recorded on the item with its error code. It is
//     never silently zero, and an instance with errors can never be submitted.
//   - Every mutation runs in a transaction, re-reads the authoritative state and
//     writes an audit row.
//
// Money is always a safe-integer cent amount.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import { evaluateReportExpression, isAccountingExpressionError } from './accounting-expressions.js';

export const REPORT_TEMPLATE_STATUSES = Object.freeze(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const REPORT_INSTANCE_STATUSES = Object.freeze(['DRAFT', 'SUBMITTED', 'APPROVED']);
export const REPORT_SOURCE_KINDS = Object.freeze([
  'GL_BALANCE', 'GL_ENTRY_SUM', 'AUX_BALANCE', 'BUSINESS_AGGREGATE', 'TEMPLATE_ITEM',
]);

// 白名单业务台账聚合来源：表名 → 可聚合列。不得扩展到其他业务表。
const BUSINESS_AGGREGATE_SOURCES = Object.freeze({
  sales_orders: Object.freeze(['total_cents']),
  purchase_orders: Object.freeze(['total_cents']),
  purchase_receipts: Object.freeze(['total_cents']),
  sales_invoices: Object.freeze(['total_cents']),
  inventory_transactions: Object.freeze(['total_cents']),
});

const VIEW_PERMISSIONS = ['REPORT_TEMPLATE_VIEW', 'REPORT_INSTANCE_VIEW', 'ACCOUNTING_VIEW'];
const TEMPLATE_MANAGE_PERMISSIONS = ['REPORT_TEMPLATE_MANAGE'];
const INSTANCE_SUBMIT_PERMISSIONS = ['REPORT_INSTANCE_SUBMIT'];
const INSTANCE_APPROVE_PERMISSIONS = ['REPORT_INSTANCE_APPROVE'];

function nowIso() {
  return new Date().toISOString();
}

function requiredPeriod(value, label = '会计期间') {
  const period = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new HttpError(400, `${label}格式必须为 YYYY-MM`, { code: 'REPORT_PERIOD_INVALID' });
  }
  return period;
}

function periodBounds(period) {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [`${period}-01`, `${period}-${String(lastDay).padStart(2, '0')}`];
}

function loadTemplate(db, templateId) {
  const template = db.prepare('SELECT * FROM report_templates WHERE id=?').get(templateId);
  if (!template) throw new HttpError(404, '报表模板不存在', { code: 'REPORT_TEMPLATE_NOT_FOUND' });
  return template;
}

function templateItems(db, templateId) {
  return db.prepare('SELECT * FROM report_template_items WHERE template_id=? ORDER BY sort_no, item_code').all(templateId);
}

function templatePermissions(db, templateId) {
  return db.prepare('SELECT permission_code FROM report_template_permissions WHERE template_id=?').all(templateId)
    .map((row) => row.permission_code);
}

function assertTemplateVisible(db, template, actor) {
  const required = templatePermissions(db, template.id);
  if (!required.length) return;
  const permissions = new Set(actor?.permissions || []);
  if (!required.some((code) => permissions.has(code))) {
    throw new HttpError(403, '当前账号不在该报表模板的可见范围内', { code: 'REPORT_TEMPLATE_FORBIDDEN' });
  }
}

// ---------------------------------------------------------------------------
// 取数：白名单数据源（AA-W4.5）
// ---------------------------------------------------------------------------

function glSubjectId(db, subjectCode) {
  const row = db.prepare('SELECT id FROM accounting_subjects WHERE code=? AND active=1').get(String(subjectCode || '').trim());
  if (!row) {
    throw new HttpError(409, `会计科目 ${subjectCode} 不存在或已停用`, { code: 'REPORT_SUBJECT_NOT_FOUND' });
  }
  return row.id;
}

/**
 * 按白名单数据源取一个报表项的数值。
 *
 * 所有来源都只读**已过账**（`status='POSTED'`）账簿，且都绑定期间；维度
 * （部门 / 辅助项目 / 经营单元）通过来源参数显式绑定。
 */
function readSourceValue(db, item, period, dimension) {
  const source = JSON.parse(item.source_json || '{}');
  switch (item.source_kind) {
    case 'GL_BALANCE': {
      const subjectId = glSubjectId(db, source.subjectCode);
      const [start, end] = periodBounds(period);
      const measure = String(source.measure || 'CLOSING').toUpperCase();
      let sql;
      let params;
      if (measure === 'OPENING') {
        sql = `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
          FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
          WHERE e.subject_id=? AND v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date)<?`;
        params = [subjectId, start];
      } else if (measure === 'DEBIT' || measure === 'CREDIT') {
        sql = `SELECT COALESCE(SUM(e.amount_cents),0) n
          FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
          WHERE e.subject_id=? AND v.status='POSTED' AND e.direction=? AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ?`;
        params = [subjectId, measure, start, end];
      } else {
        sql = `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
          FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
          WHERE e.subject_id=? AND v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ?`;
        params = [subjectId, start, end];
      }
      return Number(db.prepare(sql).get(...params).n || 0);
    }
    case 'GL_ENTRY_SUM': {
      const subjectId = glSubjectId(db, source.subjectCode);
      const [start, end] = periodBounds(period);
      const row = db.prepare(`SELECT
          COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE 0 END),0) debit,
          COALESCE(SUM(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE 0 END),0) credit
        FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
        WHERE e.subject_id=? AND v.status='POSTED' AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ?`)
        .get(subjectId, start, end);
      const measure = String(source.measure || 'NET').toUpperCase();
      if (measure === 'DEBIT') return Number(row.debit);
      if (measure === 'CREDIT') return Number(row.credit);
      return Number(row.debit) - Number(row.credit);
    }
    case 'AUX_BALANCE': {
      const subjectId = glSubjectId(db, source.subjectCode);
      const [start, end] = periodBounds(period);
      const auxCode = String(source.auxProjectCode || '').trim();
      if (!auxCode) {
        throw new HttpError(409, '辅助项目取数必须指定辅助项目编码', { code: 'REPORT_SOURCE_INVALID' });
      }
      const aux = db.prepare('SELECT id FROM aux_projects WHERE code=?').get(auxCode);
      if (!aux) {
        throw new HttpError(409, `辅助项目 ${auxCode} 不存在`, { code: 'REPORT_AUX_PROJECT_NOT_FOUND' });
      }
      return Number(db.prepare(`SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
        FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
        WHERE e.subject_id=? AND v.status='POSTED' AND e.aux_project_id=?
          AND COALESCE(v.business_date,v.voucher_date) BETWEEN ? AND ?`)
        .get(subjectId, aux.id, start, end).n || 0);
    }
    case 'BUSINESS_AGGREGATE': {
      const table = String(source.table || '').trim();
      const column = String(source.column || '').trim();
      const columns = BUSINESS_AGGREGATE_SOURCES[table];
      if (!columns || !columns.includes(column)) {
        throw new HttpError(409, '业务台账聚合来源不在白名单内', { code: 'REPORT_SOURCE_NOT_ALLOWED' });
      }
      const [start, end] = periodBounds(period);
      const dateColumn = table === 'inventory_transactions' ? 'business_date' : 'created_at';
      const value = Number(db.prepare(`SELECT COALESCE(SUM(${column}),0) n FROM ${table}
        WHERE substr(COALESCE(${dateColumn},''),1,10) BETWEEN ? AND ?`).get(start, end).n || 0);
      return value;
    }
    default:
      throw new HttpError(409, '报表项取数来源不在白名单内', { code: 'REPORT_SOURCE_NOT_ALLOWED' });
  }
}

// ---------------------------------------------------------------------------
// 模板（AA-W4.1 / AA-W4.2 / AA-W4.11）
// ---------------------------------------------------------------------------

export function listReportTemplates(db, res, actor) {
  allowAny(actor, VIEW_PERMISSIONS);
  const templates = db.prepare('SELECT * FROM report_templates ORDER BY template_code').all();
  const visible = templates.filter((template) => {
    const required = templatePermissions(db, template.id);
    if (!required.length) return true;
    const permissions = new Set(actor?.permissions || []);
    return required.some((code) => permissions.has(code));
  });
  return send(res, 200, {
    reportTemplates: visible.map((template) => ({
      ...template,
      items: templateItems(db, template.id),
      permissions: templatePermissions(db, template.id),
    })),
  });
}

function normalizeTemplateItems(items, label = '报表项目') {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, `${label}不能为空`, { code: 'REPORT_ITEMS_INVALID' });
  }
  const codes = new Set();
  return items.map((item, index) => {
    const itemCode = requiredText(item.itemCode, `第 ${index + 1} 行项目编码`, 64);
    if (codes.has(itemCode)) {
      throw new HttpError(409, `报表项目编码重复：${itemCode}`, { code: 'REPORT_ITEM_CODE_DUPLICATED' });
    }
    codes.add(itemCode);
    const sourceKind = String(item.sourceKind || '').trim().toUpperCase();
    if (!REPORT_SOURCE_KINDS.includes(sourceKind)) {
      throw new HttpError(400, '报表项目取数来源不在白名单内', { code: 'REPORT_SOURCE_NOT_ALLOWED' });
    }
    if (sourceKind === 'TEMPLATE_ITEM' && !String(item.formulaExpr || '').trim()) {
      throw new HttpError(400, '引用其它报表项目的行必须给出公式', { code: 'REPORT_FORMULA_REQUIRED' });
    }
    return {
      itemCode,
      name: requiredText(item.name, `第 ${index + 1} 行项目名称`, 128),
      levelNo: Number.isSafeInteger(Number(item.levelNo)) && Number(item.levelNo) > 0 ? Number(item.levelNo) : 1,
      sortNo: Number.isSafeInteger(Number(item.sortNo)) ? Number(item.sortNo) : index + 1,
      sourceKind,
      sourceJson: item.sourceJson && typeof item.sourceJson === 'object' ? item.sourceJson : {},
      formulaExpr: item.formulaExpr ? String(item.formulaExpr) : null,
      isTotal: item.isTotal ? 1 : 0,
      unit: item.unit ? String(item.unit) : null,
      dimensionJson: item.dimensionJson && typeof item.dimensionJson === 'object' ? item.dimensionJson : null,
    };
  });
}

export async function createReportTemplate(db, req, res, actor) {
  allowAny(actor, TEMPLATE_MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const templateCode = requiredText(body.templateCode, '模板编码', 64);
  if (db.prepare('SELECT 1 FROM report_templates WHERE template_code=?').get(templateCode)) {
    throw new HttpError(409, '模板编码已存在', { code: 'REPORT_TEMPLATE_DUPLICATED' });
  }
  const name = requiredText(body.name, '模板名称', 128);
  const items = normalizeTemplateItems(body.items);
  const permissions = Array.isArray(body.permissions) ? body.permissions.map((code) => String(code).trim()).filter(Boolean) : [];
  const templateId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO report_templates(id,template_code,name,domain,description,status,version_no,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'DRAFT',1,?,?,?)`).run(
      templateId, templateCode, name, String(body.domain || 'accounting-analytics'), body.description ? String(body.description) : null,
      actor.id, nowIso(), nowIso(),
    );
    for (const item of items) {
      db.prepare(`INSERT INTO report_template_items(
          id,template_id,item_code,name,level_no,sort_no,source_kind,source_json,formula_expr,is_total,unit,dimension_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id(), templateId, item.itemCode, item.name, item.levelNo, item.sortNo, item.sourceKind,
        JSON.stringify(item.sourceJson), item.formulaExpr, item.isTotal, item.unit,
        item.dimensionJson ? JSON.stringify(item.dimensionJson) : null,
      );
    }
    for (const code of permissions) {
      db.prepare('INSERT OR IGNORE INTO report_template_permissions(template_id,permission_code) VALUES(?,?)').run(templateId, code);
    }
    audit(db, actor.id, 'CREATE', 'REPORT_TEMPLATE', templateId, `建立报表模板 ${templateCode}`);
  });
  return send(res, 201, { reportTemplate: loadTemplate(db, templateId) });
}

export async function updateReportTemplate(db, req, res, actor, templateId) {
  allowAny(actor, TEMPLATE_MANAGE_PERMISSIONS);
  const body = await readJson(req);
  const template = loadTemplate(db, templateId);
  if (template.status === 'ARCHIVED') {
    throw new HttpError(409, '已归档的报表模板不可修改', { code: 'REPORT_TEMPLATE_ARCHIVED' });
  }
  const items = body.items === undefined ? null : normalizeTemplateItems(body.items);
  transaction(db, () => {
    db.prepare('UPDATE report_templates SET name=?, description=?, updated_at=? WHERE id=?').run(
      body.name ? String(body.name) : template.name,
      body.description === undefined ? template.description : (body.description ? String(body.description) : null),
      nowIso(), templateId,
    );
    if (items) {
      db.prepare('DELETE FROM report_template_items WHERE template_id=?').run(templateId);
      for (const item of items) {
        db.prepare(`INSERT INTO report_template_items(
            id,template_id,item_code,name,level_no,sort_no,source_kind,source_json,formula_expr,is_total,unit,dimension_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id(), templateId, item.itemCode, item.name, item.levelNo, item.sortNo, item.sourceKind,
          JSON.stringify(item.sourceJson), item.formulaExpr, item.isTotal, item.unit,
          item.dimensionJson ? JSON.stringify(item.dimensionJson) : null,
        );
      }
      db.prepare('UPDATE report_templates SET version_no=version_no+1 WHERE id=?').run(templateId);
    }
    audit(db, actor.id, 'UPDATE', 'REPORT_TEMPLATE', templateId, `修改报表模板 ${template.template_code}`);
  });
  return send(res, 200, { reportTemplate: loadTemplate(db, templateId) });
}

export async function changeReportTemplateStatus(db, req, res, actor, templateId, action) {
  allowAny(actor, TEMPLATE_MANAGE_PERMISSIONS);
  const template = loadTemplate(db, templateId);
  const next = action === 'publish' ? 'PUBLISHED' : 'ARCHIVED';
  if (template.status === next) {
    throw new HttpError(409, `报表模板已处于 ${next} 状态`, { code: 'REPORT_TEMPLATE_STATUS_INVALID' });
  }
  if (action === 'publish' && template.status === 'ARCHIVED') {
    throw new HttpError(409, '已归档的报表模板不可发布', { code: 'REPORT_TEMPLATE_STATUS_INVALID' });
  }
  if (action === 'publish' && !templateItems(db, templateId).length) {
    throw new HttpError(409, '没有报表项目的模板不可发布', { code: 'REPORT_TEMPLATE_ITEMS_REQUIRED' });
  }
  transaction(db, () => {
    db.prepare('UPDATE report_templates SET status=?, updated_at=? WHERE id=?').run(next, nowIso(), templateId);
    audit(db, actor.id, action === 'publish' ? 'PUBLISH' : 'ARCHIVE', 'REPORT_TEMPLATE', templateId, `报表模板 ${template.template_code} → ${next}`);
  });
  return send(res, 200, { reportTemplate: loadTemplate(db, templateId) });
}

export async function publishReportTemplate(db, req, res, actor, templateId) {
  return changeReportTemplateStatus(db, req, res, actor, templateId, 'publish');
}

export async function archiveReportTemplate(db, req, res, actor, templateId) {
  return changeReportTemplateStatus(db, req, res, actor, templateId, 'archive');
}

// ---------------------------------------------------------------------------
// 计算（AA-W4.4 / AA-W4.6 / AA-W4.7）
// ---------------------------------------------------------------------------

/**
 * 计算一张报表模板在给定期间的取值。
 *
 * 求值顺序：先算取数项（白名单数据源），再算引用其它报表项目的公式项；
 * 公式项的绑定集合只包含**已经算出的**报表项编码。失败的项记录错误码与
 * 错误信息，绝不静默取 0。
 */
export function computeTemplateValues(db, template, period, dimension = {}) {
  const items = templateItems(db, template.id);
  const values = new Map();
  const results = [];
  for (const item of items) {
    const formula = item.formula_expr;
    if (item.source_kind !== 'TEMPLATE_ITEM' && !formula) {
      try {
        const value = readSourceValue(db, item, period, dimension);
        values.set(item.item_code, value);
        results.push({ itemCode: item.item_code, valueCents: value, errorCode: null, errorMessage: null });
      } catch (error) {
        results.push({
          itemCode: item.item_code,
          valueCents: null,
          errorCode: error.code || 'REPORT_SOURCE_FAILED',
          errorMessage: error.message,
        });
      }
      continue;
    }
    try {
      const bindings = {};
      for (const [key, value] of values.entries()) bindings[key] = value;
      const result = evaluateReportExpression(formula, bindings);
      const value = Math.round(result);
      values.set(item.item_code, value);
      results.push({ itemCode: item.item_code, valueCents: value, errorCode: null, errorMessage: null });
    } catch (error) {
      results.push({
        itemCode: item.item_code,
        valueCents: null,
        errorCode: isAccountingExpressionError(error) ? error.code : 'REPORT_FORMULA_FAILED',
        errorMessage: error.message,
      });
    }
  }
  const errorCount = results.filter((row) => row.errorCode).length;
  return { results, errorCount };
}

function writeInstanceValues(db, instanceId, results) {
  db.prepare('DELETE FROM report_instance_values WHERE instance_id=?').run(instanceId);
  for (const row of results) {
    db.prepare(`INSERT INTO report_instance_values(
        id,instance_id,item_code,value_cents,value_text,formula_text,error_code,error_message)
      VALUES(?,?,?,?,?,?,?,?)`).run(
      id(), instanceId, row.itemCode, row.valueCents ?? null, null, null, row.errorCode, row.errorMessage,
    );
  }
}

export function previewReportTemplate(db, res, actor, templateId, url) {
  allowAny(actor, VIEW_PERMISSIONS);
  const template = loadTemplate(db, templateId);
  assertTemplateVisible(db, template, actor);
  const period = requiredPeriod(url.searchParams.get('period'));
  const computed = computeTemplateValues(db, template, period);
  return send(res, 200, {
    preview: {
      templateId: template.id,
      period,
      items: computed.results,
      errorCount: computed.errorCount,
      status: computed.errorCount ? 'COMPUTED_WITH_ERRORS' : 'COMPUTED',
    },
  });
}

// ---------------------------------------------------------------------------
// 实例与生命周期（AA-W4.3 / AA-W4.8 / AA-W4.9 / AA-W4.10）
// ---------------------------------------------------------------------------

export function listReportInstances(db, res, actor, url) {
  allowAny(actor, VIEW_PERMISSIONS);
  const period = url.searchParams.get('period');
  const rows = period
    ? db.prepare('SELECT * FROM report_instances WHERE period=? ORDER BY template_id, version_no DESC').all(period)
    : db.prepare('SELECT * FROM report_instances ORDER BY created_at DESC LIMIT 200').all();
  return send(res, 200, { reportInstances: rows });
}

export async function createReportInstance(db, req, res, actor) {
  allowAny(actor, INSTANCE_SUBMIT_PERMISSIONS);
  const body = await readJson(req);
  const template = loadTemplate(db, String(body.templateId || '').trim());
  assertTemplateVisible(db, template, actor);
  if (template.status !== 'PUBLISHED') {
    throw new HttpError(409, '只有已发布的报表模板可以实例化', { code: 'REPORT_TEMPLATE_NOT_PUBLISHED' });
  }
  const period = requiredPeriod(body.period);
  const latest = db.prepare('SELECT MAX(version_no) v FROM report_instances WHERE template_id=? AND period=?')
    .get(template.id, period);
  const versionNo = Number(latest?.v || 0) + 1;
  const instanceId = id();
  transaction(db, () => {
    db.prepare(`INSERT INTO report_instances(id,template_id,period,status,version_no,created_at)
      VALUES(?,?,?,'DRAFT',?,?)`).run(instanceId, template.id, period, versionNo, nowIso());
    audit(db, actor.id, 'CREATE', 'REPORT_INSTANCE', instanceId, `实例化报表 ${template.template_code} ${period} v${versionNo}`);
  });
  return send(res, 201, { reportInstance: db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId) });
}

export async function computeReportInstance(db, req, res, actor, instanceId) {
  allowAny(actor, INSTANCE_SUBMIT_PERMISSIONS);
  const instance = db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId);
  if (!instance) throw new HttpError(404, '报表实例不存在', { code: 'REPORT_INSTANCE_NOT_FOUND' });
  const template = loadTemplate(db, instance.template_id);
  assertTemplateVisible(db, template, actor);
  if (instance.status === 'SUBMITTED') {
    throw new HttpError(409, '已提交的报表实例不得重算，请先退回', { code: 'REPORT_INSTANCE_SUBMITTED' });
  }
  if (instance.status === 'APPROVED') {
    // 审核后的实例重算必须**显式重开**：生成新版本，历史版本保留可回看，
    // 已审核的取值不被静默改写。
    const latest = db.prepare('SELECT MAX(version_no) v FROM report_instances WHERE template_id=? AND period=?')
      .get(template.id, instance.period);
    const nextVersion = Number(latest?.v || 0) + 1;
    const nextId = id();
    transaction(db, () => {
      db.prepare(`INSERT INTO report_instances(id,template_id,period,status,version_no,created_at)
        VALUES(?,?,?,'DRAFT',?,?)`).run(nextId, template.id, instance.period, nextVersion, nowIso());
      const computed = computeTemplateValues(db, template, instance.period);
      writeInstanceValues(db, nextId, computed.results);
      db.prepare('UPDATE report_instances SET computed_at=? WHERE id=?').run(nowIso(), nextId);
      audit(db, actor.id, 'REOPEN', 'REPORT_INSTANCE', instance.id, `已审核实例重开为 v${nextVersion}`);
    });
    return send(res, 200, {
      reportInstance: db.prepare('SELECT * FROM report_instances WHERE id=?').get(nextId),
      reopenedFrom: instance.id,
    });
  }
  transaction(db, () => {
    const computed = computeTemplateValues(db, template, instance.period);
    writeInstanceValues(db, instanceId, computed.results);
    db.prepare('UPDATE report_instances SET computed_at=? WHERE id=?').run(nowIso(), instanceId);
    audit(db, actor.id, 'COMPUTE', 'REPORT_INSTANCE', instanceId, `重算报表实例 ${instance.period}`);
  });
  return send(res, 200, {
    reportInstance: db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId),
  });
}

export async function submitReportInstance(db, req, res, actor, instanceId) {
  allowAny(actor, INSTANCE_SUBMIT_PERMISSIONS);
  const instance = db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId);
  if (!instance) throw new HttpError(404, '报表实例不存在', { code: 'REPORT_INSTANCE_NOT_FOUND' });
  if (instance.status !== 'DRAFT') {
    throw new HttpError(409, '只有草稿状态的报表实例可以提交', { code: 'REPORT_INSTANCE_STATUS_INVALID' });
  }
  const errors = db.prepare('SELECT COUNT(*) n FROM report_instance_values WHERE instance_id=? AND error_code IS NOT NULL').get(instanceId);
  if (Number(errors.n) > 0) {
    throw new HttpError(409, '存在求值失败的报表项，实例不得提交', { code: 'REPORT_INSTANCE_HAS_ERRORS' });
  }
  transaction(db, () => {
    db.prepare("UPDATE report_instances SET status='SUBMITTED', submitted_at=?, submitted_by=? WHERE id=?")
      .run(nowIso(), actor.id, instanceId);
    audit(db, actor.id, 'SUBMIT', 'REPORT_INSTANCE', instanceId, `提交报表实例 ${instance.period}`);
  });
  return send(res, 200, { reportInstance: db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId) });
}

export async function approveReportInstance(db, req, res, actor, instanceId) {
  allowAny(actor, INSTANCE_APPROVE_PERMISSIONS);
  const body = await readJson(req);
  const instance = db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId);
  if (!instance) throw new HttpError(404, '报表实例不存在', { code: 'REPORT_INSTANCE_NOT_FOUND' });
  if (instance.status !== 'SUBMITTED') {
    throw new HttpError(409, '只有已提交的报表实例可以审核', { code: 'REPORT_INSTANCE_STATUS_INVALID' });
  }
  if (instance.submitted_by && instance.submitted_by === actor.id) {
    throw new HttpError(403, '提交人不得审核同一张报表实例', { code: 'REPORT_INSTANCE_SOD_VIOLATION' });
  }
  const approved = body.approved === true || body.approved === 'true';
  transaction(db, () => {
    if (approved) {
      db.prepare("UPDATE report_instances SET status='APPROVED', approved_at=?, approved_by=? WHERE id=?")
        .run(nowIso(), actor.id, instanceId);
      audit(db, actor.id, 'APPROVE', 'REPORT_INSTANCE', instanceId, `审核通过报表实例 ${instance.period}`);
    } else {
      db.prepare("UPDATE report_instances SET status='DRAFT' WHERE id=?").run(instanceId);
      audit(db, actor.id, 'REJECT', 'REPORT_INSTANCE', instanceId, `审核退回报表实例 ${instance.period}`);
    }
  });
  return send(res, 200, { reportInstance: db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId) });
}

export function getReportInstance(db, res, actor, instanceId) {
  allowAny(actor, VIEW_PERMISSIONS);
  const instance = db.prepare('SELECT * FROM report_instances WHERE id=?').get(instanceId);
  if (!instance) throw new HttpError(404, '报表实例不存在', { code: 'REPORT_INSTANCE_NOT_FOUND' });
  const template = loadTemplate(db, instance.template_id);
  assertTemplateVisible(db, template, actor);
  const values = db.prepare('SELECT * FROM report_instance_values WHERE instance_id=? ORDER BY item_code').all(instanceId);
  const history = db.prepare(
    'SELECT id, period, status, version_no, computed_at, submitted_at, submitted_by, approved_at, approved_by FROM report_instances WHERE template_id=? AND period=? ORDER BY version_no DESC',
  ).all(template.id, instance.period);
  return send(res, 200, { reportInstance: instance, reportTemplate: template, values, history });
}
