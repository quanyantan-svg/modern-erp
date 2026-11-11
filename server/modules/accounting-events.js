// Accounting & Analytics Domain Closure — AA-W1 accounting event ledger.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.1
//   AA-W1.1..AA-W1.8, AA-W1.15, AA-W1.16
// Design:    docs/design/accounting-analytics.md §31.1.1..§31.1.8
//
// Single responsibility: 会计事件台账的写入、状态推进、未生成/异常查询、受控修复。
// It does NOT create the voucher body — that is delegated to the rules /
// posting modules.
//
// State machine (§31.1.2):
//   PENDING ──生成成功──> GENERATED ──冲销──> REVERSED
//      ├──生成失败──> FAILED ──重试成功──> GENERATED
//      └──显式跳过──> SKIPPED ──恢复──> PENDING
//
// Invariants:
//   - GENERATED must carry a voucher_id;
//   - FAILED must carry a last_error_code;
//   - SKIPPED must carry a skip_reason;
//   - the natural key (event_type, source_type, source_id, source_item_id)
//     can never carry a second event;
//   - an event is never physically deleted — cancellation is SKIPPED.

import { HttpError, allow, allowAny, readJson, requiredText, send } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id, transaction } from '../db.js';

const EVENT_STATUSES = Object.freeze(['PENDING', 'GENERATED', 'SKIPPED', 'FAILED', 'REVERSED']);

export const ACCOUNTING_EVENT_ERROR_CODES = Object.freeze({
  NOT_FOUND: 'ACCOUNTING_EVENT_NOT_FOUND',
  ALREADY_GENERATED: 'ACCOUNTING_EVENT_ALREADY_GENERATED',
  SKIPPED: 'ACCOUNTING_EVENT_SKIPPED',
  SKIP_REASON_REQUIRED: 'ACCOUNTING_EVENT_SKIP_REASON_REQUIRED',
  REPAIR_SOD_VIOLATION: 'ACCOUNTING_EVENT_REPAIR_SOD_VIOLATION',
  NOT_REPAIRABLE: 'ACCOUNTING_EVENT_NOT_REPAIRABLE',
  PERMISSION_DENIED: 'ACCOUNTING_EVENT_PERMISSION_DENIED',
});

function nowIso() {
  return new Date().toISOString();
}

function periodOf(businessDate) {
  return String(businessDate).slice(0, 7);
}

/**
 * AA-W1.1 / AA-W1.4 — record the accounting event for one business fact.
 *
 * The natural key makes the relation layer unique: recording the same
 * business fact twice returns the existing event instead of creating a
 * second one. This is the property that lets AA-W1.1 claim "exactly one
 * event per business fact".
 */
export function recordEvent(db, {
  eventType,
  sourceType,
  sourceId,
  sourceItemId = '',
  businessDate,
  period = null,
  ruleCode = null,
  templateId = null,
  sourceAmountCents = 0,
  sourceTaxCents = 0,
  sourceCount = 0,
}) {
  if (!eventType || !sourceType || !sourceId || !businessDate) {
    throw new HttpError(400, '会计事件缺少事件类型、来源类型、来源 ID 或业务日期', { code: 'ACCOUNTING_EVENT_INVALID' });
  }
  const itemId = sourceItemId || '';
  const existing = db.prepare(
    'SELECT * FROM accounting_events WHERE event_type=? AND source_type=? AND source_id=? AND source_item_id=?',
  ).get(eventType, sourceType, sourceId, itemId);
  if (existing) return existing;

  const eventId = id();
  const now = nowIso();
  db.prepare(`INSERT INTO accounting_events(
      id,event_type,source_type,source_id,source_item_id,business_date,period,status,rule_code,template_id,
      attempt_count,source_amount_cents,source_tax_cents,source_count,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'PENDING',?,?,0,?,?,?,?,?)`)
    .run(eventId, eventType, sourceType, sourceId, itemId, businessDate, period || periodOf(businessDate), ruleCode, templateId,
      Number(sourceAmountCents || 0), Number(sourceTaxCents || 0), Number(sourceCount || 0), now, now);
  return db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
}

/**
 * AA-W1.6 — persist a failed generation attempt against the event. The error
 * code is stable so the workbench can filter on it.
 */
export function markEventFailed(db, { eventId, errorCode, errorMessage }) {
  const event = db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
  if (!event) throw new HttpError(404, '会计事件不存在', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_FOUND });
  const attemptNo = Number(event.attempt_count || 0) + 1;
  const now = nowIso();
  transaction(db, () => {
    db.prepare("UPDATE accounting_events SET status='FAILED', attempt_count=?, last_error_code=?, last_error_message=?, updated_at=? WHERE id=?")
      .run(attemptNo, errorCode || 'ACCOUNTING_GENERATION_FAILED', errorMessage || '', now, eventId);
    db.prepare('INSERT INTO accounting_event_attempts(id,event_id,attempt_no,outcome,error_code,error_message,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id(), eventId, attemptNo, 'FAILED', errorCode || 'ACCOUNTING_GENERATION_FAILED', errorMessage || '', now);
  });
  return db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
}

// ---------------------------------------------------------------------------
// Read paths
// ---------------------------------------------------------------------------

function listEvents(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_EVENTS_VIEW', 'ACCOUNTING_VIEW']);
  const where = [];
  const params = [];
  const status = url.searchParams.get('status');
  if (status) {
    if (!EVENT_STATUSES.includes(status)) {
      throw new HttpError(400, '会计事件状态非法：' + status, { code: 'ACCOUNTING_EVENT_STATUS_INVALID' });
    }
    where.push('status=?');
    params.push(status);
  }
  const sourceType = url.searchParams.get('source_type');
  if (sourceType) { where.push('source_type=?'); params.push(sourceType); }
  const period = url.searchParams.get('period');
  if (period) { where.push('period=?'); params.push(period); }
  const keyword = url.searchParams.get('keyword');
  if (keyword) {
    where.push('(source_id LIKE ? OR event_type LIKE ?)');
    params.push('%' + keyword + '%', '%' + keyword + '%');
  }
  const limit = Math.min(Number(url.searchParams.get('limit') || 200) || 200, 500);
  const sql = `SELECT * FROM accounting_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  const events = db.prepare(sql).all(...params, limit);
  return send(res, 200, { events });
}

/**
 * AA-W1.5 — the "approved business fact but no voucher" workbench list.
 * Skipped events are deliberately excluded (they were explicitly resolved).
 */
function listUngeneratedEvents(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_EVENTS_VIEW', 'ACCOUNTING_VIEW']);
  const where = ["status IN ('PENDING','FAILED')"];
  const params = [];
  const sourceType = url.searchParams.get('source_type');
  if (sourceType) { where.push('source_type=?'); params.push(sourceType); }
  const period = url.searchParams.get('period');
  if (period) { where.push('period=?'); params.push(period); }
  const errorCode = url.searchParams.get('error_code');
  if (errorCode) { where.push('last_error_code=?'); params.push(errorCode); }
  const events = db.prepare(
    `SELECT * FROM accounting_events WHERE ${where.join(' AND ')} ORDER BY business_date DESC, created_at DESC LIMIT 500`,
  ).all(...params);
  return send(res, 200, { events, count: events.length });
}

function getEvent(db, res, actor, eventId) {
  allowAny(actor, ['ACCOUNTING_EVENTS_VIEW', 'ACCOUNTING_VIEW']);
  const event = db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
  if (!event) throw new HttpError(404, '会计事件不存在', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_FOUND });
  event.attempts = db.prepare('SELECT * FROM accounting_event_attempts WHERE event_id=? ORDER BY attempt_no').all(eventId);
  if (event.voucher_id) {
    event.voucher = db.prepare('SELECT id,voucher_no,status,period,voucher_date,business_date FROM accounting_vouchers WHERE id=?').get(event.voucher_id) || null;
  }
  // AA-W1.3 — bidirectional navigation: from the event back to the source
  // business document and forward to the voucher.
  event.source = { sourceType: event.source_type, sourceId: event.source_id, sourceItemId: event.source_item_id };
  return send(res, 200, { event });
}

// ---------------------------------------------------------------------------
// AA-W1.7 / AA-W1.8 — controlled repair
// ---------------------------------------------------------------------------

function assertRepairable(event) {
  if (event.status === 'GENERATED') {
    throw new HttpError(409, '事件已生成凭证，禁止重复生成', { code: ACCOUNTING_EVENT_ERROR_CODES.ALREADY_GENERATED });
  }
  if (event.status === 'SKIPPED') {
    throw new HttpError(409, '事件已跳过，请先恢复', { code: ACCOUNTING_EVENT_ERROR_CODES.SKIPPED });
  }
  if (event.status === 'REVERSED') {
    throw new HttpError(409, '事件已冲销，不可修复', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_REPAIRABLE });
  }
}

/**
 * AA-W3 — SOD: the repairer must not be the reviewer of the original business
 * document. The source reviewer is resolved from the authoritative business
 * document when it exposes a reviewer; otherwise the check falls back to the
 * event creator.
 */
function assertRepairSod(db, event, actor) {
  const reviewer = resolveSourceReviewer(db, event);
  if (reviewer && reviewer === actor.id) {
    throw new HttpError(403, '修复人不得是原始业务单据审核人', { code: ACCOUNTING_EVENT_ERROR_CODES.REPAIR_SOD_VIOLATION });
  }
}

function resolveSourceReviewer(db, event) {
  const candidateTables = [
    'purchase_orders',
    'sales_orders',
    'receipt_notices',
    'delivery_notices',
    'production_orders',
    'supplier_bills',
    'outsourcing_orders',
  ];
  for (const table of candidateTables) {
    try {
      // Probe the table shape instead of assuming a fixed reviewer column
      // name — each business document records its approver differently.
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.length) continue;
      const reviewerColumn = columns.find(
        (column) => /^(reviewer_id|approved_by|reviewed_by|approver_id)$/.test(column.name),
      );
      if (!reviewerColumn) continue;
      const row = db.prepare(`SELECT ${reviewerColumn.name} FROM ${table} WHERE id=?`).get(event.source_id);
      if (row && row[reviewerColumn.name]) return row[reviewerColumn.name];
    } catch {
      // The source table does not exist for this event type — keep looking.
    }
  }
  return null;
}

async function retryEvent(db, req, res, actor, eventId, generate) {
  allow(actor, 'ACCOUNTING_EVENTS_REPAIR');
  const event = db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
  if (!event) throw new HttpError(404, '会计事件不存在', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_FOUND });
  assertRepairable(event);
  assertRepairSod(db, event, actor);

  // AA-W1.8 — retry is idempotent: an event that already owns a voucher
  // returns the existing voucher instead of creating a second one.
  if (event.voucher_id) {
    return send(res, 200, { event, voucherId: event.voucher_id, alreadyGenerated: true });
  }

  const result = await generate({ db, event, actor });
  const refreshed = db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
  audit(db, actor.id, 'ACCOUNTING_EVENT_REPAIR', 'ACCOUNTING_EVENT', eventId, '重试生成凭证');
  return send(res, 200, { event: refreshed, voucherId: refreshed.voucher_id, result: result || null });
}

async function skipEvent(db, req, res, actor, eventId) {
  allow(actor, 'ACCOUNTING_EVENTS_REPAIR');
  const event = db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
  if (!event) throw new HttpError(404, '会计事件不存在', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_FOUND });
  assertRepairable(event);
  const body = await readJson(req);
  let reason;
  try {
    reason = requiredText(body.reason, '跳过原因', 500);
  } catch (error) {
    throw new HttpError(400, '跳过原因不能为空', { code: ACCOUNTING_EVENT_ERROR_CODES.SKIP_REASON_REQUIRED });
  }
  transaction(db, () => {
    db.prepare("UPDATE accounting_events SET status='SKIPPED', skip_reason=?, updated_at=? WHERE id=?")
      .run(reason, nowIso(), eventId);
    db.prepare('INSERT INTO accounting_event_attempts(id,event_id,attempt_no,outcome,error_code,error_message,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id(), eventId, Number(event.attempt_count || 0) + 1, 'SKIPPED', 'ACCOUNTING_EVENT_SKIPPED', reason, nowIso());
  });
  audit(db, actor.id, 'ACCOUNTING_EVENT_SKIP', 'ACCOUNTING_EVENT', eventId, '跳过会计事件：' + reason);
  return send(res, 200, { event: db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId) });
}

async function resumeEvent(db, req, res, actor, eventId) {
  allow(actor, 'ACCOUNTING_EVENTS_REPAIR');
  const event = db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId);
  if (!event) throw new HttpError(404, '会计事件不存在', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_FOUND });
  if (event.status !== 'SKIPPED') {
    throw new HttpError(409, '只有已跳过的事件可以恢复', { code: ACCOUNTING_EVENT_ERROR_CODES.NOT_REPAIRABLE });
  }
  transaction(db, () => {
    db.prepare("UPDATE accounting_events SET status='PENDING', skip_reason=NULL, updated_at=? WHERE id=?").run(nowIso(), eventId);
  });
  audit(db, actor.id, 'ACCOUNTING_EVENT_RESUME', 'ACCOUNTING_EVENT', eventId, '恢复已跳过的会计事件');
  return send(res, 200, { event: db.prepare('SELECT * FROM accounting_events WHERE id=?').get(eventId) });
}

// ---------------------------------------------------------------------------
// Accounting subject maintenance (AA-W1.15 / AA-W1.16)
// ---------------------------------------------------------------------------

const SUBJECT_TYPES = Object.freeze(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
const SUBJECT_DIRECTIONS = Object.freeze(['DEBIT', 'CREDIT']);

async function createSubject(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_SUBJECTS_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '科目编码', 50).toUpperCase();
  const name = requiredText(body.name, '科目名称', 100);
  const type = requiredText(body.type, '科目类型', 20).toUpperCase();
  const direction = requiredText(body.direction, '余额方向', 10).toUpperCase();
  if (!SUBJECT_TYPES.includes(type)) {
    throw new HttpError(400, '科目类型非法：' + type, { code: 'ACCOUNTING_SUBJECT_TYPE_INVALID' });
  }
  if (!SUBJECT_DIRECTIONS.includes(direction)) {
    throw new HttpError(400, '科目余额方向非法：' + direction, { code: 'ACCOUNTING_SUBJECT_DIRECTION_INVALID' });
  }
  if (db.prepare('SELECT 1 FROM accounting_subjects WHERE code=?').get(code)) {
    throw new HttpError(409, '科目编码已存在：' + code, { code: 'ACCOUNTING_SUBJECT_CODE_EXISTS' });
  }
  const subjectId = id();
  transaction(db, () => {
    db.prepare('INSERT INTO accounting_subjects(id,code,name,type,direction,parent_id,active) VALUES(?,?,?,?,?,?,1)')
      .run(subjectId, code, name, type, direction, body.parentId || null);
    audit(db, actor.id, 'ACCOUNTING_SUBJECT_CREATE', 'ACCOUNTING_SUBJECT', subjectId, '创建会计科目 ' + code);
  });
  return send(res, 201, { id: subjectId, code });
}

async function updateSubject(db, req, res, actor, subjectId) {
  allow(actor, 'ACCOUNTING_SUBJECTS_MANAGE');
  const subject = db.prepare('SELECT * FROM accounting_subjects WHERE id=?').get(subjectId);
  if (!subject) throw new HttpError(404, '会计科目不存在', { code: 'ACCOUNTING_SUBJECT_NOT_FOUND' });
  const body = await readJson(req);

  // AA-W1.16 — a subject that already has entries may not change its type or
  // balance direction, because that would rewrite the meaning of history.
  const referenced = db.prepare('SELECT COUNT(*) n FROM accounting_entries WHERE subject_id=?').get(subjectId).n;
  const nextType = body.type ? requiredText(body.type, '科目类型', 20).toUpperCase() : subject.type;
  const nextDirection = body.direction ? requiredText(body.direction, '余额方向', 10).toUpperCase() : subject.direction;
  if (referenced > 0 && (nextType !== subject.type || nextDirection !== subject.direction)) {
    throw new HttpError(409, '科目已被凭证引用，不得改变类型或余额方向', { code: 'ACCOUNTING_SUBJECT_HAS_REFERENCES' });
  }
  if (!SUBJECT_TYPES.includes(nextType)) {
    throw new HttpError(400, '科目类型非法：' + nextType, { code: 'ACCOUNTING_SUBJECT_TYPE_INVALID' });
  }
  if (!SUBJECT_DIRECTIONS.includes(nextDirection)) {
    throw new HttpError(400, '科目余额方向非法：' + nextDirection, { code: 'ACCOUNTING_SUBJECT_DIRECTION_INVALID' });
  }
  transaction(db, () => {
    db.prepare('UPDATE accounting_subjects SET name=?, type=?, direction=?, parent_id=? WHERE id=?')
      .run(body.name ? requiredText(body.name, '科目名称', 100) : subject.name, nextType, nextDirection,
        body.parentId === undefined ? subject.parent_id : (body.parentId || null), subjectId);
    audit(db, actor.id, 'ACCOUNTING_SUBJECT_UPDATE', 'ACCOUNTING_SUBJECT', subjectId, '修改会计科目 ' + subject.code);
  });
  return send(res, 200, { id: subjectId });
}

/**
 * AA-W1.16 — deactivate. A referenced subject is never deleted; it is only
 * deactivated, and a deactivated subject can no longer be used for new
 * entries.
 */
async function deactivateSubject(db, req, res, actor, subjectId) {
  allow(actor, 'ACCOUNTING_SUBJECTS_MANAGE');
  const subject = db.prepare('SELECT * FROM accounting_subjects WHERE id=?').get(subjectId);
  if (!subject) throw new HttpError(404, '会计科目不存在', { code: 'ACCOUNTING_SUBJECT_NOT_FOUND' });
  if (!subject.active) {
    throw new HttpError(409, '科目已停用', { code: 'ACCOUNTING_SUBJECT_ALREADY_INACTIVE' });
  }
  transaction(db, () => {
    db.prepare('UPDATE accounting_subjects SET active=0 WHERE id=?').run(subjectId);
    audit(db, actor.id, 'ACCOUNTING_SUBJECT_DEACTIVATE', 'ACCOUNTING_SUBJECT', subjectId, '停用会计科目 ' + subject.code);
  });
  return send(res, 200, { id: subjectId, active: false });
}

export const accountingEventsHandlers = {
  listEvents,
  listUngeneratedEvents,
  getEvent,
  retryEvent,
  skipEvent,
  resumeEvent,
  createSubject,
  updateSubject,
  deactivateSubject,
};

export { recordEvent as recordAccountingEvent };
