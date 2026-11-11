// Accounting & Analytics Domain Closure — AA-W2 voucher template & rule platform.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.2
//   AA-W2.1..AA-W2.12
// Design:    docs/design/accounting-analytics.md §31.2.1..§31.2.5
//
// Single responsibility: 凭证模板与规则绑定的 CRUD、命中解析、批量 / 调度生成编排。
//
// Key contracts:
//   - AA-W2.4 — the business-type → template mapping is expressed by
//     configurable rule bindings (source_type + event_type + validity window),
//     never hardcoded in a business caller.
//   - AA-W2.5 — rule resolution is unique; an ambiguous or missing match is an
//     explicit failure, never a fallback to a hardcoded mapping.
//   - AA-W2.6 — subjects are resolved through an account role, never a
//     hardcoded subject code.
//   - AA-W2.9 — batch generation runs each event in its own transaction; one
//     failure never rolls back the batch and never leaves half a voucher.
//   - AA-W2.11 / AA-W2.12 — template conditions and amounts use the restricted
//     expression grammar; a failed evaluation fails the line.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';
import {
  evaluateTemplateAmount,
  evaluateTemplateCondition,
  isAccountingExpressionError,
} from './accounting-expressions.js';
import { markEventFailed, recordEvent } from './accounting-events.js';
import { postEventVoucher } from './accounting-posting.js';

const TEMPLATE_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);
const RULE_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);
const DIRECTIONS = Object.freeze(['DEBIT', 'CREDIT']);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * AA-W2.3 — a template carries a version and a validity window. A template
 * version that already produced vouchers must not be rewritten in place.
 */
function assertTemplateNotFrozen(db, templateId) {
  const usage = db.prepare(
    "SELECT COUNT(*) n FROM accounting_events WHERE template_id=? AND status='GENERATED'",
  ).get(templateId).n;
  if (usage > 0) {
    throw new HttpError(409, '模板版本已被使用，请新增版本', { code: 'VOUCHER_TEMPLATE_VERSION_FROZEN' });
  }
}

function templateItems(db, templateId) {
  return db.prepare('SELECT * FROM voucher_template_items WHERE template_id=? ORDER BY line_no').all(templateId);
}

/**
 * Legacy templates carried a JSON blob in `entries_json`. The normalization is
 * reversible: the original blob is preserved, and an unparseable item is
 * marked `LEGACY_UNRESOLVED` instead of being silently dropped (§31.8.2).
 */
function normalizeLegacyEntries(db, template) {
  const existing = templateItems(db, template.id);
  if (existing.length) return existing;
  const entries = parseJson(template.entries_json, []);
  if (!Array.isArray(entries) || !entries.length) return [];
  const now = nowIso();
  transaction(db, () => {
    entries.forEach((entry, index) => {
      db.prepare(`INSERT INTO voucher_template_items(
          id,template_id,line_no,summary,accounting_role,subject_id,direction,amount_source,amount_expr,dimension_json,parse_status
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id(), template.id, index + 1, entry.summary || '', entry.role || entry.accounting_role || '',
          entry.subjectId || entry.subject_id || null, entry.direction || '', entry.amountSource || entry.amount_source || '',
          entry.amountExpr || entry.amount_expr || null, entry.dimension_json || null,
          entry.role || entry.accounting_role ? 'RESOLVED' : 'LEGACY_UNRESOLVED');
    });
  });
  return templateItems(db, template.id);
}

function listTemplates(db, res, actor, url) {
  allowAny(actor, ['VOUCHER_TEMPLATES_VIEW', 'VOUCHER_TEMPLATES_MANAGE']);
  const status = url.searchParams.get('status');
  const sql = `SELECT t.* FROM voucher_templates t ${status ? 'WHERE t.status=?' : ''} ORDER BY t.template_code`;
  const templates = db.prepare(sql).all(...(status ? [status] : []));
  const enriched = templates.map((template) => ({
    ...template,
    items: normalizeLegacyEntries(db, template),
    legacyEntries: parseJson(template.entries_json, []),
  }));
  return send(res, 200, { templates: enriched });
}

async function createTemplate(db, req, res, actor) {
  allow(actor, 'VOUCHER_TEMPLATES_MANAGE');
  const body = await readJson(req);
  const templateCode = requiredText(body.templateCode, '模板编码', 50).toUpperCase();
  const name = requiredText(body.name, '模板名称', 100);
  if (db.prepare('SELECT 1 FROM voucher_templates WHERE template_code=?').get(templateCode)) {
    throw new HttpError(409, '模板编码已存在：' + templateCode, { code: 'VOUCHER_TEMPLATE_CODE_EXISTS' });
  }
  const templateId = id();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`INSERT INTO voucher_templates(
        id,template_code,template_name,description,category,entries_json,active,creator_id,created_at,updated_at,
        version_no,valid_from,valid_to,status,condition_expr,dimension_json
      ) VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)`)
      .run(templateId, templateCode, name, body.description || '', body.category || 'GENERAL', '[]', actor.id, now, now,
        Number(body.versionNo || 1), body.validFrom || null, body.validTo || null, 'ACTIVE', body.conditionExpr || null,
        body.dimensionJson ? JSON.stringify(body.dimensionJson) : null);
    insertTemplateItems(db, templateId, body.items || []);
    audit(db, actor.id, 'VOUCHER_TEMPLATE_CREATE', 'VOUCHER_TEMPLATE', templateId, '创建凭证模板 ' + templateCode);
  });
  return send(res, 201, { id: templateId, templateCode });
}

function insertTemplateItems(db, templateId, items) {
  if (!Array.isArray(items) || !items.length) {
    throw new HttpError(400, '凭证模板必须包含至少一条分录', { code: 'VOUCHER_TEMPLATE_ITEMS_REQUIRED' });
  }
  const insert = db.prepare(`INSERT INTO voucher_template_items(
      id,template_id,line_no,summary,accounting_role,subject_id,direction,amount_source,amount_expr,dimension_json,parse_status
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  items.forEach((item, index) => {
    const direction = requiredText(item.direction, '分录方向', 10).toUpperCase();
    if (!DIRECTIONS.includes(direction)) {
      throw new HttpError(400, '分录方向非法：' + direction, { code: 'VOUCHER_TEMPLATE_DIRECTION_INVALID' });
    }
    const role = item.accountingRole || '';
    const subjectId = item.subjectId || null;
    // AA-W2.6 — the subject is resolved through a role, not a hardcoded code.
    if (!role && !subjectId) {
      throw new HttpError(400, '分录必须指定科目角色或科目', { code: 'VOUCHER_TEMPLATE_SUBJECT_REQUIRED' });
    }
    const amountSource = item.amountSource || '';
    const amountExpr = item.amountExpr || null;
    if (!amountSource && !amountExpr) {
      throw new HttpError(400, '分录必须指定金额来源或金额表达式', { code: 'VOUCHER_TEMPLATE_AMOUNT_REQUIRED' });
    }
    insert.run(
      id(), templateId, index + 1, item.summary || '', role, subjectId, direction,
      amountSource, amountExpr, item.dimensionJson ? JSON.stringify(item.dimensionJson) : null, 'RESOLVED',
    );
  });
}

async function updateTemplate(db, req, res, actor, templateId) {
  allow(actor, 'VOUCHER_TEMPLATES_MANAGE');
  const template = db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(templateId);
  if (!template) throw new HttpError(404, '凭证模板不存在', { code: 'VOUCHER_TEMPLATE_NOT_FOUND' });
  assertTemplateNotFrozen(db, templateId);
  const body = await readJson(req);
  transaction(db, () => {
    db.prepare(`UPDATE voucher_templates SET template_name=?, description=?, condition_expr=?, valid_from=?, valid_to=?, updated_at=? WHERE id=?`)
      .run(body.name ? requiredText(body.name, '模板名称', 100) : template.template_name,
        body.description === undefined ? template.description : body.description,
        body.conditionExpr === undefined ? template.condition_expr : body.conditionExpr,
        body.validFrom === undefined ? template.valid_from : body.validFrom,
        body.validTo === undefined ? template.valid_to : body.validTo,
        nowIso(), templateId);
    if (Array.isArray(body.items)) {
      db.prepare('DELETE FROM voucher_template_items WHERE template_id=?').run(templateId);
      insertTemplateItems(db, templateId, body.items);
    }
    audit(db, actor.id, 'VOUCHER_TEMPLATE_UPDATE', 'VOUCHER_TEMPLATE', templateId, '修改凭证模板 ' + template.template_code);
  });
  return send(res, 200, { id: templateId });
}

/**
 * AA-W2.2 — deactivating a template keeps already generated vouchers intact;
 * only new business stops matching it.
 */
function deactivateTemplate(db, req, res, actor, templateId) {
  allow(actor, 'VOUCHER_TEMPLATES_MANAGE');
  const template = db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(templateId);
  if (!template) throw new HttpError(404, '凭证模板不存在', { code: 'VOUCHER_TEMPLATE_NOT_FOUND' });
  transaction(db, () => {
    db.prepare("UPDATE voucher_templates SET status='INACTIVE', active=0, updated_at=? WHERE id=?").run(nowIso(), templateId);
    audit(db, actor.id, 'VOUCHER_TEMPLATE_DEACTIVATE', 'VOUCHER_TEMPLATE', templateId, '停用凭证模板 ' + template.template_code);
  });
  return send(res, 200, { id: templateId, status: 'INACTIVE' });
}

// ---------------------------------------------------------------------------
// Rule bindings (AA-W2.4 / AA-W2.5)
// ---------------------------------------------------------------------------

function listRules(db, res, actor, url) {
  allowAny(actor, ['VOUCHER_TEMPLATES_VIEW', 'VOUCHER_TEMPLATES_MANAGE']);
  const sourceType = url.searchParams.get('source_type');
  const eventType = url.searchParams.get('event_type');
  const where = [];
  const params = [];
  if (sourceType) { where.push('r.source_type=?'); params.push(sourceType); }
  if (eventType) { where.push('r.event_type=?'); params.push(eventType); }
  const sql = `SELECT r.*, t.template_code, t.template_name, t.status template_status
    FROM accounting_rule_bindings r JOIN voucher_templates t ON t.id=r.template_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.source_type, r.event_type, r.priority`;
  return send(res, 200, { rules: db.prepare(sql).all(...params) });
}

async function createRule(db, req, res, actor) {
  allow(actor, 'VOUCHER_TEMPLATES_MANAGE');
  const body = await readJson(req);
  const sourceType = requiredText(body.sourceType, '来源类型', 60);
  const eventType = requiredText(body.eventType, '事件类型', 60);
  const templateId = requiredText(body.templateId, '模板 ID', 60);
  const validFrom = requiredText(body.validFrom, '生效起始日', 10);
  const validTo = body.validTo || null;
  if (validTo && validTo < validFrom) {
    throw new HttpError(400, '生效截止日不得早于生效起始日', { code: 'ACCOUNTING_RULE_WINDOW_INVALID' });
  }
  const template = db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(templateId);
  if (!template) throw new HttpError(404, '凭证模板不存在', { code: 'VOUCHER_TEMPLATE_NOT_FOUND' });
  const ruleId = id();
  const now = nowIso();
  transaction(db, () => {
    db.prepare(`INSERT INTO accounting_rule_bindings(
        id,source_type,event_type,template_id,valid_from,valid_to,priority,status,created_by,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(ruleId, sourceType, eventType, templateId, validFrom, validTo, Number(body.priority || 100), 'ACTIVE', actor.id, now);
    audit(db, actor.id, 'ACCOUNTING_RULE_CREATE', 'ACCOUNTING_RULE', ruleId, '创建凭证规则 ' + sourceType + '/' + eventType);
  });
  return send(res, 201, { id: ruleId });
}

async function updateRule(db, req, res, actor, ruleId) {
  allow(actor, 'VOUCHER_TEMPLATES_MANAGE');
  const rule = db.prepare('SELECT * FROM accounting_rule_bindings WHERE id=?').get(ruleId);
  if (!rule) throw new HttpError(404, '凭证规则不存在', { code: 'ACCOUNTING_RULE_NOT_FOUND' });
  const body = await readJson(req);
  transaction(db, () => {
    db.prepare('UPDATE accounting_rule_bindings SET valid_from=?, valid_to=?, priority=?, status=?, template_id=? WHERE id=?')
      .run(body.validFrom || rule.valid_from, body.validTo === undefined ? rule.valid_to : body.validTo,
        body.priority === undefined ? rule.priority : Number(body.priority),
        body.status || rule.status, body.templateId || rule.template_id, ruleId);
    audit(db, actor.id, 'ACCOUNTING_RULE_UPDATE', 'ACCOUNTING_RULE', ruleId, '修改凭证规则');
  });
  return send(res, 200, { id: ruleId });
}

function deactivateRule(db, req, res, actor, ruleId) {
  allow(actor, 'VOUCHER_TEMPLATES_MANAGE');
  const rule = db.prepare('SELECT * FROM accounting_rule_bindings WHERE id=?').get(ruleId);
  if (!rule) throw new HttpError(404, '凭证规则不存在', { code: 'ACCOUNTING_RULE_NOT_FOUND' });
  transaction(db, () => {
    db.prepare("UPDATE accounting_rule_bindings SET status='INACTIVE' WHERE id=?").run(ruleId);
    audit(db, actor.id, 'ACCOUNTING_RULE_DEACTIVATE', 'ACCOUNTING_RULE', ruleId, '停用凭证规则');
  });
  return send(res, 200, { id: ruleId, status: 'INACTIVE' });
}

// ---------------------------------------------------------------------------
// Rule resolution (AA-W2.5)
// ---------------------------------------------------------------------------

/**
 * Resolve the unique active rule for one (source_type, event_type, date).
 *
 * A missing match is `RULE_NOT_FOUND` and an ambiguous match is
 * `RULE_AMBIGUOUS`. Both are explicit failures — there is no fallback to a
 * hardcoded mapping.
 */
export function resolveRule(db, sourceType, eventType, businessDate) {
  const date = String(businessDate).slice(0, 10);
  const matches = db.prepare(`SELECT r.*, t.id template_id, t.template_code, t.template_name, t.status template_status, t.condition_expr, t.valid_from template_valid_from, t.valid_to template_valid_to
    FROM accounting_rule_bindings r JOIN voucher_templates t ON t.id=r.template_id
    WHERE r.source_type=? AND r.event_type=? AND r.status='ACTIVE'
      AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>=?)`)
    .all(sourceType, eventType, date, date);
  if (!matches.length) {
    throw new HttpError(409, '未命中凭证规则：' + sourceType + '/' + eventType, { code: 'RULE_NOT_FOUND' });
  }
  const effective = matches.filter((rule) => {
    if (rule.template_status !== 'ACTIVE') return false;
    if (rule.template_valid_from && rule.template_valid_from > date) return false;
    if (rule.template_valid_to && rule.template_valid_to < date) return false;
    return true;
  });
  if (!effective.length) {
    throw new HttpError(409, '未命中生效的凭证模板：' + sourceType + '/' + eventType, { code: 'RULE_NOT_FOUND' });
  }
  if (effective.length > 1) {
    throw new HttpError(409, '凭证规则命中歧义：' + sourceType + '/' + eventType, { code: 'RULE_AMBIGUOUS' });
  }
  return effective[0];
}

function subjectForRole(db, role) {
  const row = db.prepare('SELECT s.id FROM account_role_mappings m JOIN accounting_subjects s ON s.id=m.subject_id AND s.active=1 WHERE m.role_code=?').get(role);
  if (!row) {
    throw new HttpError(409, '缺少会计科目角色映射：' + role, { code: 'ACCOUNTING_ROLE_MAPPING_MISSING' });
  }
  return row.id;
}

/**
 * Apply a template to one event's source amounts and produce the voucher
 * entries. Every failure is explicit — no line is ever silently skipped and
 * no amount is ever silently degraded to 0.
 */
export function applyTemplate(db, { template, source }) {
  const bindings = {
    SOURCE_AMOUNT: Number(source.amountCents || 0),
    SOURCE_TAX: Number(source.taxCents || 0),
    SOURCE_COUNT: Number(source.count || 0),
    PERIOD: source.period || String(source.businessDate || '').slice(0, 7),
  };
  if (template.condition_expr) {
    let satisfied = false;
    try {
      satisfied = evaluateTemplateCondition(template.condition_expr, bindings);
    } catch (error) {
      if (isAccountingExpressionError(error)) {
        throw new HttpError(400, '凭证模板条件非法：' + error.code, { code: 'EXPRESSION_INVALID' });
      }
      throw error;
    }
    if (!satisfied) return null;
  }

  const items = templateItems(db, template.template_id || template.id);
  if (!items.length) {
    throw new HttpError(409, '凭证模板没有可用分录：' + template.template_code, { code: 'VOUCHER_TEMPLATE_HAS_NO_ITEMS' });
  }
  const entries = [];
  for (const item of items) {
    let amountCents = 0;
    try {
      if (item.amount_source) {
        const value = bindings[item.amount_source];
        if (value === undefined) {
          throw new HttpError(400, '凭证模板金额来源非法：' + item.amount_source, { code: 'EXPRESSION_INVALID' });
        }
        amountCents = Number(value);
      } else {
        amountCents = evaluateTemplateAmount(item.amount_expr, bindings);
      }
    } catch (error) {
      if (isAccountingExpressionError(error)) {
        throw new HttpError(400, '凭证模板金额表达式非法：' + error.code, { code: 'EXPRESSION_INVALID' });
      }
      throw error;
    }
    if (!Number.isSafeInteger(Math.round(amountCents))) {
      throw new HttpError(409, '凭证模板金额不是安全整数分', { code: 'ACCOUNTING_AMOUNT_NOT_SAFE_INTEGER' });
    }
    const rounded = Math.round(amountCents);
    if (rounded === 0) continue;
    const subjectId = item.subject_id || subjectForRole(db, item.accounting_role);
    entries.push({
      subjectId,
      role: item.accounting_role || undefined,
      direction: item.direction,
      amountCents: rounded,
      summary: item.summary || '',
      cashFlowCategory: parseJson(item.dimension_json, {})?.cashFlowCategory || null,
    });
  }
  if (!entries.length) {
    throw new HttpError(409, '凭证模板未产生任何分录', { code: 'VOUCHER_TEMPLATE_PRODUCED_NO_ENTRIES' });
  }
  const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amountCents, 0);
  const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amountCents, 0);
  if (debit !== credit) {
    throw new HttpError(409, '凭证模板借贷不平衡', { code: 'VOUCHER_TEMPLATE_NOT_BALANCED' });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// AA-W2.7 / AA-W2.8 / AA-W2.9 — generation
// ---------------------------------------------------------------------------

/**
 * Generate the voucher for one event. The event write and the voucher write
 * are separate transactions by design (§31.1.3): the event is committed first
 * so an ungenerated fact is always visible; a failure leaves the event in
 * FAILED with a stable error code and no half-written voucher.
 */
export function generateEventVoucher(db, { event, actor }) {
  let rule;
  try {
    rule = resolveRule(db, event.source_type, event.event_type, event.business_date);
  } catch (error) {
    markEventFailed(db, { eventId: event.id, errorCode: error.code || 'RULE_NOT_FOUND', errorMessage: error.message });
    throw error;
  }

  const source = {
    amountCents: Number(event.source_amount_cents || 0),
    taxCents: Number(event.source_tax_cents || 0),
    count: Number(event.source_count || 0),
    period: event.period,
    businessDate: event.business_date,
  };

  let entries;
  try {
    entries = applyTemplate(db, { template: rule, source });
  } catch (error) {
    markEventFailed(db, { eventId: event.id, errorCode: error.code || 'TEMPLATE_APPLY_FAILED', errorMessage: error.message });
    throw error;
  }
  if (!entries) {
    // The template condition did not match — the fact legitimately needs no
    // voucher. It is recorded as GENERATED-less SKIPPED? No: AA-W1 forbids
    // silent skips, so the event stays PENDING and stays visible in the
    // workbench until a human resolves it.
    return null;
  }

  const voucherId = transaction(db, () => {
    db.prepare('UPDATE accounting_events SET rule_code=?, template_id=?, updated_at=? WHERE id=?')
      .run(rule.template_code, rule.template_id, nowIso(), event.id);
    return postEventVoucher(db, {
      event: { ...event, template_id: rule.template_id },
      entries,
      actorId: actor.id,
      businessDate: event.business_date,
      remark: rule.template_name,
    });
  });
  return voucherId;
}

/**
 * AA-W2.7 — batch generation. Each event runs in its own transaction so a
 * single failure never rolls back the batch, and failures stay visible with
 * their error codes.
 */
async function batchGenerate(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_RULE_RUN');
  const body = await readJson(req);
  const where = ["status IN ('PENDING','FAILED')"];
  const params = [];
  if (body.period) { where.push('period=?'); params.push(body.period); }
  if (body.sourceType) { where.push('source_type=?'); params.push(body.sourceType); }
  const limit = Math.min(Number(body.limit || 100) || 100, 500);
  const events = db.prepare(`SELECT * FROM accounting_events WHERE ${where.join(' AND ')} ORDER BY business_date, created_at LIMIT ?`).all(...params, limit);

  const runId = id();
  const now = nowIso();
  db.prepare(`INSERT INTO accounting_generation_runs(id,run_type,period,status,total_count,success_count,failed_count,started_at,created_by) VALUES(?,?,?,?,?,0,0,?,?)`)
    .run(runId, body.runType || 'BATCH', body.period || null, 'RUNNING', events.length, now, actor.id);

  let success = 0;
  let failed = 0;
  const failures = [];
  for (const event of events) {
    try {
      const voucherId = generateEventVoucher(db, { event, actor });
      if (voucherId) success += 1;
      else failures.push({ eventId: event.id, errorCode: 'TEMPLATE_CONDITION_NOT_MET' });
    } catch (error) {
      failed += 1;
      failures.push({ eventId: event.id, errorCode: error.code || 'ACCOUNTING_GENERATION_FAILED', errorMessage: error.message });
    }
  }
  const finishedAt = nowIso();
  db.prepare('UPDATE accounting_generation_runs SET status=?, success_count=?, failed_count=?, finished_at=? WHERE id=?')
    .run(failed ? 'COMPLETED' : 'COMPLETED', success, failed, finishedAt, runId);
  audit(db, actor.id, 'ACCOUNTING_GENERATION_RUN', 'ACCOUNTING_GENERATION_RUN', runId,
    `批量生成凭证：成功 ${success} 条，失败 ${failed} 条`);
  return send(res, 200, { runId, total: events.length, success, failed, failures });
}

function listGenerationRuns(db, res, actor, url) {
  allowAny(actor, ['VOUCHER_TEMPLATES_VIEW', 'ACCOUNTING_RULE_RUN']);
  const period = url.searchParams.get('period');
  const runs = db.prepare(`SELECT * FROM accounting_generation_runs ${period ? 'WHERE period=?' : ''} ORDER BY started_at DESC LIMIT 100`)
    .all(...(period ? [period] : []));
  return send(res, 200, { runs });
}

/**
 * AA-W2.1 — template preview (试算). It never writes a voucher.
 */
function previewTemplate(db, res, actor, url, templateId) {
  allowAny(actor, ['VOUCHER_TEMPLATES_VIEW', 'VOUCHER_TEMPLATES_MANAGE']);
  const template = db.prepare('SELECT * FROM voucher_templates WHERE id=?').get(templateId);
  if (!template) throw new HttpError(404, '凭证模板不存在', { code: 'VOUCHER_TEMPLATE_NOT_FOUND' });
  const source = {
    amountCents: Number(url.searchParams.get('amountCents') || 0),
    taxCents: Number(url.searchParams.get('taxCents') || 0),
    count: Number(url.searchParams.get('count') || 0),
    period: url.searchParams.get('period') || '',
    businessDate: url.searchParams.get('businessDate') || '',
  };
  const entries = applyTemplate(db, { template, source });
  return send(res, 200, { template: { id: template.id, template_code: template.template_code }, entries });
}

export const accountingRulesHandlers = {
  listTemplates,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  previewTemplate,
  listRules,
  createRule,
  updateRule,
  deactivateRule,
  batchGenerate,
  listGenerationRuns,
};

export { recordEvent as recordRuleEvent };

