// V17 Master & Engineering Domain Closure — Wave A: Engineering Reference.
//
// Owner module for Shift, Shift Pattern, Calendar Template, Work Calendar,
// Basic Activity, Workshop Formula (safe grammar), Resource, Equipment,
// Operation, Control Code. All handlers are fail-closed; every mutation is
// wrapped in transaction + audit and re-reads for the canonical state.
//
// The workshop-formula endpoint does NOT call eval / Function / vm. It uses
// `server/lib/formula-evaluator.js` which is a hand-rolled recursive-descent
// parser that compiles a fixed grammar and evaluates only via arithmetic.

import { id, transaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, allow, allowAny, optionalText, readJson, requiredCode, requiredText, send } from '../lib/http.js';
import { compileFormula, evaluateAst, evaluateFormula, FormulaError } from '../lib/formula-evaluator.js';

const ENGINEERING_PERMS = Object.freeze({
  SHIFT: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  PATTERN: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  CAL_TEMPLATE: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  CALENDAR: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  ACTIVITY: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  FORMULA: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  RESOURCE: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  EQUIPMENT: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  OPERATION: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
  CONTROL_CODE: ['ENGINEERING_REFERENCE_VIEW', 'ENGINEERING_REFERENCE_MANAGE'],
});

const WORK_CENTER_PERMS = Object.freeze({
  VIEW: ['WORK_CENTERS_VIEW', 'WORK_CENTERS_MANAGE'],
  MANAGE: 'WORK_CENTERS_MANAGE',
});

function readActive(db, table, id, label = '记录', { lock = false } = {}) {
  // A locking read observes the latest committed row and holds it for the rest
  // of the transaction, so a concurrent deactivate cannot slip between the
  // authoritative read and the write.
  const suffix = lock && db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  const record = db.prepare(`SELECT * FROM ${table} WHERE id=?${suffix}`).get(id);
  if (!record) throw new HttpError(404, `${label}不存在`);
  return record;
}

function parseShiftOrder(value) {
  if (!Array.isArray(value)) return new Map();
  const result = new Map();
  for (const item of value) {
    if (typeof item === 'string') {
      result.set(item, 1);
    } else if (item && typeof item === 'object') {
      if (item.id) result.set(String(item.id), 1);
    }
  }
  return result;
}

function validateMinuteRange(start, end) {
  if (!Number.isInteger(start) || start < 0 || start >= 1440) {
    throw new HttpError(400, '班次起始分钟必须在 0–1440 之间');
  }
  if (!Number.isInteger(end) || end <= 0 || end > 1440) {
    throw new HttpError(400, '班次结束分钟必须在 1–1440 之间');
  }
  if (start >= end) throw new HttpError(400, '班次结束时间必须晚于起始时间');
}

function normalizeShift(body, current = null) {
  const start = Math.round(Number(body.startMinute ?? body.start_minute ?? current?.start_minute ?? 0));
  const end = Math.round(Number(body.endMinute ?? body.end_minute ?? current?.end_minute ?? 0));
  validateMinuteRange(start, end);
  return {
    code: requiredCode(body.code ?? body.code ?? current?.code, '班次编码'),
    name: requiredText(body.name ?? body.name ?? current?.name, '班次名称', 100),
    startMinute: start,
    endMinute: end,
    active: body.active === false || body.active === 0 ? 0 : 1,
    notes: optionalText(body.notes ?? current?.notes, 500),
  };
}

export function listShifts(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.SHIFT);
  const shifts = db.prepare('SELECT * FROM engineering_shifts ORDER BY code').all();
  return send(res, 200, { shifts });
}

export async function createShift(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const shift = normalizeShift(body);
  const shiftId = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_shifts(id,code,name,start_minute,end_minute,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(shiftId, shift.code, shift.name, shift.startMinute, shift.endMinute, shift.active, shift.notes, now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_SHIFT', shiftId, shift.code);
  });
  return send(res, 201, { id: shiftId });
}

export async function updateShift(db, req, res, actor, shiftId) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const current = readActive(db, 'engineering_shifts', shiftId, '班次');
  const body = await readJson(req);
  const shift = normalizeShift(body, current);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE engineering_shifts SET code=?,name=?,start_minute=?,end_minute=?,active=?,notes=?,updated_at=? WHERE id=?')
      .run(shift.code, shift.name, shift.startMinute, shift.endMinute, shift.active, shift.notes, now, shiftId);
    audit(db, actor.id, 'UPDATE', 'ENGINEERING_SHIFT', shiftId, shift.code);
  });
  return send(res, 200, { ok: true });
}

export function listShiftPatterns(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.PATTERN);
  const patterns = db.prepare('SELECT * FROM engineering_shift_patterns ORDER BY code').all();
  return send(res, 200, { patterns });
}

export async function createShiftPattern(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '班制编码');
  const name = requiredText(body.name, '班制名称', 100);
  const shiftIds = Array.isArray(body.shiftIds ?? body.shift_ids) ? (body.shiftIds ?? body.shift_ids) : [];
  if (!shiftIds.length) throw new HttpError(400, '班制至少包含一个班次');
  const unknown = [];
  for (const sid of shiftIds) {
    const found = db.prepare('SELECT 1 FROM engineering_shifts WHERE id=? AND active=1').get(sid);
    if (!found) unknown.push(sid);
  }
  if (unknown.length) throw new HttpError(400, `班次不存在或未启用 ${unknown.join(',')}`);
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_shift_patterns(id,code,name,shift_ids,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, JSON.stringify(shiftIds), 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_SHIFT_PATTERN', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listCalendarTemplates(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.CAL_TEMPLATE);
  const templates = db.prepare(`SELECT t.*, p.code shift_pattern_code, p.name shift_pattern_name
    FROM engineering_calendar_templates t
    LEFT JOIN engineering_shift_patterns p ON p.id=t.shift_pattern_id
    ORDER BY t.code`).all();
  return send(res, 200, { templates });
}

export async function createCalendarTemplate(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '日历模板编码');
  const name = requiredText(body.name, '日历模板名称', 100);
  const workDays = Array.isArray(body.workDays ?? body.work_days) ? (body.workDays ?? body.work_days) : [1, 2, 3, 4, 5];
  const sanitized = Array.from(new Set(workDays.filter((d) => Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 6))).map(Number);
  if (!sanitized.length) throw new HttpError(400, '工作日不能为空');
  const shiftPatternId = body.shiftPatternId ?? body.shift_pattern_id ?? null;
  if (shiftPatternId) {
    const found = db.prepare('SELECT 1 FROM engineering_shift_patterns WHERE id=? AND active=1').get(shiftPatternId);
    if (!found) throw new HttpError(400, '班制不存在或未启用');
  }
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_calendar_templates(id,code,name,work_days,shift_pattern_id,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, JSON.stringify(sanitized), shiftPatternId, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_CALENDAR_TEMPLATE', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listWorkCalendars(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.CALENDAR);
  const calendars = db.prepare(`SELECT c.*, t.code template_code, t.name template_name
    FROM engineering_work_calendars c
    LEFT JOIN engineering_calendar_templates t ON t.id=c.template_id
    ORDER BY c.start_date DESC, c.code`).all();
  return send(res, 200, { calendars });
}

export async function createWorkCalendar(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '工作日历编码');
  const name = requiredText(body.name, '工作日历名称', 100);
  const startDate = requiredText(body.startDate ?? body.start_date, '起始日期', 10);
  const endDate = requiredText(body.endDate ?? body.end_date, '结束日期', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new HttpError(400, '日期格式必须为 YYYY-MM-DD');
  }
  if (startDate >= endDate) throw new HttpError(400, '结束日期必须晚于起始日期');
  const templateId = body.templateId ?? body.template_id ?? null;
  if (templateId) {
    const found = db.prepare('SELECT 1 FROM engineering_calendar_templates WHERE id=? AND active=1').get(templateId);
    if (!found) throw new HttpError(400, '日历模板不存在或未启用');
  }
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_work_calendars(id,code,name,template_id,start_date,end_date,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, templateId, startDate, endDate, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_WORK_CALENDAR', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listBasicActivities(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.ACTIVITY);
  const activities = db.prepare('SELECT * FROM engineering_basic_activities ORDER BY code').all();
  return send(res, 200, { activities });
}

export async function createBasicActivity(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '基础活动编码');
  const name = requiredText(body.name, '基础活动名称', 100);
  const stage = String(body.stage || 'PROCESS').toUpperCase();
  if (!['PREPARE', 'PROCESS', 'DISASSEMBLE'].includes(stage)) throw new HttpError(400, '活动阶段不正确');
  const unit = optionalText(body.unit, 20) || '';
  const defaultQuantity = Number(body.defaultQuantity ?? body.default_quantity ?? 0);
  if (!Number.isFinite(defaultQuantity) || defaultQuantity < 0) throw new HttpError(400, '默认数量必须为非负数');
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_basic_activities(id,code,name,stage,unit,default_quantity,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, stage, unit, defaultQuantity, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_BASIC_ACTIVITY', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listWorkshopFormulas(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.FORMULA);
  const formulas = db.prepare('SELECT * FROM engineering_workshop_formulas ORDER BY code').all();
  return send(res, 200, { formulas });
}

function parseVariables(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return [];
  }
}

export async function createWorkshopFormula(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '公式编码');
  const name = requiredText(body.name, '公式名称', 100);
  const formula = requiredText(body.formula, '公式', 256);
  // Validate formula compiles safely without executing it.
  try {
    compileFormula(formula);
  } catch (error) {
    if (error instanceof FormulaError) {
      throw new HttpError(400, `公式非法 (${error.reason}): ${error.message}`);
    }
    throw error;
  }
  const variables = Array.isArray(body.variables) ? body.variables.map(String) : [];
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_workshop_formulas(id,code,name,formula,formula_version,variables,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, formula, 1, JSON.stringify(variables), 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_WORKSHOP_FORMULA', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export async function evaluateWorkshopFormula(db, req, res, actor, formulaId) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const formula = readActive(db, 'engineering_workshop_formulas', formulaId, '公式');
  const body = await readJson(req);
  const variables = body.variables || {};
  try {
    const value = evaluateFormula(formula.formula, variables);
    return send(res, 200, { value, formula: formula.formula, formulaVersion: String(formula.formula_version) });
  } catch (error) {
    if (error instanceof FormulaError) {
      throw new HttpError(400, `公式求值失败 (${error.reason}): ${error.message}`);
    }
    throw error;
  }
}

export function listResources(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.RESOURCE);
  const resources = db.prepare(`SELECT r.*, w.code work_center_code, w.name work_center_name
    FROM engineering_resources r
    LEFT JOIN work_centers w ON w.id=r.work_center_id
    ORDER BY r.code`).all();
  return send(res, 200, { resources });
}

export async function createResource(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '资源编码');
  const name = requiredText(body.name, '资源名称', 100);
  const category = String(body.category || 'MACHINE').toUpperCase();
  if (!['MACHINE', 'TOOL', 'PERSON', 'MATERIAL', 'OTHER'].includes(category)) throw new HttpError(400, '资源类型不正确');
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '资源数量必须为正数');
  const unit = optionalText(body.unit, 20) || '';
  const workCenterId = body.workCenterId ?? body.work_center_id ?? null;
  if (workCenterId) {
    const found = db.prepare('SELECT 1 FROM work_centers WHERE id=?').get(workCenterId);
    if (!found) throw new HttpError(400, '工作中心不存在');
  }
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_resources(id,code,name,quantity,unit,category,work_center_id,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, quantity, unit, category, workCenterId, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_RESOURCE', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listEquipment(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.EQUIPMENT);
  const equipment = db.prepare(`SELECT e.*, w.code work_center_code, w.name work_center_name
    FROM engineering_equipment e
    LEFT JOIN work_centers w ON w.id=e.work_center_id
    ORDER BY e.code`).all();
  return send(res, 200, { equipment });
}

export async function createEquipment(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '设备编码');
  const name = requiredText(body.name, '设备名称', 100);
  const model = optionalText(body.model, 100) || '';
  const serial = optionalText(body.serial, 100) || '';
  const workCenterId = body.workCenterId ?? body.work_center_id ?? null;
  if (workCenterId) {
    const found = db.prepare('SELECT 1 FROM work_centers WHERE id=?').get(workCenterId);
    if (!found) throw new HttpError(400, '工作中心不存在');
  }
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_equipment(id,code,name,model,serial,work_center_id,status,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, model, serial, workCenterId, 'ACTIVE', 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_EQUIPMENT', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listOperations(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.OPERATION);
  const operations = db.prepare(`SELECT o.*, w.code work_center_code, w.name work_center_name,
      a.code activity_code, a.name activity_name
      FROM engineering_operations o
      LEFT JOIN work_centers w ON w.id=o.work_center_id
      LEFT JOIN engineering_basic_activities a ON a.id=o.activity_id
      ORDER BY o.code`).all();
  return send(res, 200, { operations });
}

export async function createOperation(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '作业编码');
  const name = requiredText(body.name, '作业名称', 100);
  const standardMinutes = Number(body.standardMinutes ?? body.standard_minutes ?? 0);
  if (!Number.isFinite(standardMinutes) || standardMinutes < 0) throw new HttpError(400, '标准工时必须为非负数');
  const activityId = body.activityId ?? body.activity_id ?? null;
  if (activityId) {
    const found = db.prepare('SELECT 1 FROM engineering_basic_activities WHERE id=? AND active=1').get(activityId);
    if (!found) throw new HttpError(400, '基础活动不存在或未启用');
  }
  const workCenterId = body.workCenterId ?? body.work_center_id ?? null;
  if (workCenterId) {
    const found = db.prepare('SELECT 1 FROM work_centers WHERE id=?').get(workCenterId);
    if (!found) throw new HttpError(400, '工作中心不存在');
  }
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_operations(id,code,name,standard_minutes,activity_id,work_center_id,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, standardMinutes, activityId, workCenterId, 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_OPERATION', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

export function listControlCodes(db, res, actor) {
  allowAny(actor, ENGINEERING_PERMS.CONTROL_CODE);
  const codes = db.prepare('SELECT * FROM engineering_control_codes ORDER BY code').all();
  return send(res, 200, { codes });
}

export async function createControlCode(db, req, res, actor) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const body = await readJson(req);
  const code = requiredCode(body.code, '控制码编码');
  const name = requiredText(body.name, '控制码名称', 100);
  const category = String(body.category || 'PROCESSING').toUpperCase();
  if (!['SCHEDULING', 'PROCESSING', 'REPORT', 'INSPECTION', 'OUTSOURCE', 'QUALITY'].includes(category)) {
    throw new HttpError(400, '控制码类别不正确');
  }
  const idValue = id();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare(`INSERT INTO engineering_control_codes(id,code,name,category,policy,active,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(idValue, code, name, category, optionalText(body.policy, 100) || 'STANDARD', 1, optionalText(body.notes, 500), now, now);
    audit(db, actor.id, 'CREATE', 'ENGINEERING_CONTROL_CODE', idValue, code);
  });
  return send(res, 201, { id: idValue });
}

function parseWorkCenterPayload(body, current = null) {
  const code = requiredCode(body.code ?? current?.code, '工作中心编码');
  const name = requiredText(body.name ?? current?.name, '工作中心名称', 100);
  const type = String(body.type ?? current?.type ?? 'ASSEMBLY').toUpperCase();
  const capacityHours = Number(body.capacityHours ?? body.capacity_hours ?? current?.capacity_hours ?? 8);
  const dailyCapacityMinutes = Math.max(0, Math.round(Number(body.dailyCapacityMinutes ?? body.daily_capacity_minutes ?? (capacityHours * 60))));
  const efficiency = Number(body.efficiency ?? current?.efficiency ?? 1);
  const defaultEfficiencyPct = Number(body.defaultEfficiencyPct ?? body.default_efficiency_pct ?? current?.default_efficiency_pct ?? (efficiency * 100));
  const unitCostCents = Math.max(0, Math.round(Number(body.unitCostCents ?? body.unit_cost_cents ?? current?.unit_cost_cents ?? 0)));
  const laborRateCentsPerHour = Math.max(0, Math.round(Number(body.laborRateCentsPerHour ?? body.labor_rate_cents_per_hour ?? current?.labor_rate_cents_per_hour ?? 0)));
  const overheadRateCentsPerHour = Math.max(0, Math.round(Number(body.overheadRateCentsPerHour ?? body.overhead_rate_cents_per_hour ?? current?.overhead_rate_cents_per_hour ?? 0)));
  const calendarId = body.calendarId ?? body.calendar_id ?? current?.calendar_id ?? null;
  const isOutsource = body.isOutsource === true || body.is_outsource === true ? 1 : 0;
  const notes = optionalText(body.notes ?? current?.notes, 500);
  const active = body.active === false || body.active === 0 ? 0 : 1;
  return {
    code, name, type, capacityHours, dailyCapacityMinutes, efficiency, defaultEfficiencyPct,
    unitCostCents, laborRateCentsPerHour, overheadRateCentsPerHour,
    calendarId, isOutsource, notes, active,
  };
}

export async function updateWorkCenter(db, req, res, actor, workCenterId) {
  allow(actor, WORK_CENTER_PERMS.MANAGE);
  const body = await readJson(req);
  const now = new Date().toISOString();
  transaction(db, () => {
    // The work center row is re-read and locked inside the transaction so the
    // payload defaults and the write cannot disagree with a concurrent change.
    const current = readActive(db, 'work_centers', workCenterId, '工作中心', { lock: true });
    const payload = parseWorkCenterPayload(body, current);
    if (payload.calendarId) {
      const cal = db.prepare("SELECT 1 FROM engineering_work_calendars WHERE id=? AND active=1").get(payload.calendarId);
      if (!cal) throw new HttpError(400, '工作日历不存在或未启用');
    }
    db.prepare(`UPDATE work_centers SET code=?,name=?,type=?,capacity_hours=?,efficiency=?,default_efficiency_pct=?,unit_cost_cents=?,
      daily_capacity_minutes=?,labor_rate_cents_per_hour=?,overhead_rate_cents_per_hour=?,
      calendar_id=?,is_outsource=?,notes=?,active=?,updated_at=? WHERE id=?`)
      .run(payload.code, payload.name, payload.type, payload.capacityHours, payload.efficiency,
        payload.defaultEfficiencyPct, payload.unitCostCents,
        payload.dailyCapacityMinutes, payload.laborRateCentsPerHour, payload.overheadRateCentsPerHour,
        payload.calendarId, payload.isOutsource, payload.notes, payload.active, now, workCenterId);
    audit(db, actor.id, 'UPDATE', 'WORK_CENTER', workCenterId, payload.code);
  });
  return send(res, 200, { ok: true });
}

export async function deactivateWorkCenter(db, res, actor, workCenterId) {
  allow(actor, WORK_CENTER_PERMS.MANAGE);
  const now = new Date().toISOString();
  transaction(db, () => {
    // The work center row is locked and the reference guards are counted
    // inside the same transaction that performs the deactivation.
    const current = readActive(db, 'work_centers', workCenterId, '工作中心', { lock: true });
    if (current.active === 0) return;
    // Reference guard: cannot deactivate if any active engineering resource / equipment / operation references it.
    const refs = db.prepare(`SELECT
      (SELECT COUNT(*) FROM engineering_resources WHERE work_center_id=? AND active=1) +
      (SELECT COUNT(*) FROM engineering_equipment WHERE work_center_id=? AND status='ACTIVE') +
      (SELECT COUNT(*) FROM engineering_operations WHERE work_center_id=? AND active=1) AS cnt`).get(workCenterId, workCenterId, workCenterId);
    if (Number(refs.cnt) > 0) {
      throw new HttpError(409, '工作中心仍被活动引用，无法停用');
    }
    db.prepare('UPDATE work_centers SET active=0, updated_at=? WHERE id=?').run(now, workCenterId);
    audit(db, actor.id, 'DEACTIVATE', 'WORK_CENTER', workCenterId, current.code);
  });
  return send(res, 200, { ok: true, active: 0 });
}

export function listWorkCenterEnhancement(db, res, actor, url) {
  allowAny(actor, WORK_CENTER_PERMS.VIEW);
  const centers = db.prepare(`SELECT w.*, c.code calendar_code, c.name calendar_name FROM work_centers w
    LEFT JOIN engineering_work_calendars c ON c.id=w.calendar_id
    ORDER BY w.code`).all();
  return send(res, 200, { workCenters: centers });
}

export { parseVariables };


// ---------------------------------------------------------------------------
// Reference master lifecycle (Requirement §28.8.A "CRUD 闭环" / §28.4
// "强制 lifecycle active/inactive")
//
// Every engineering reference master is a lifecycle master: it can be
// created, read, UPDATED and DEACTIVATED, and it may never be hard-deleted
// while an active record still references it. The masters differ only in
// their editable columns and their validation, so the lifecycle is written
// once against a per-master specification instead of nine near-copies.
//
// Deactivation is a soft state change (`active = 0`): historical references
// must not break, so the row stays and the reference guard refuses to
// deactivate a master that an active record still points at.
// ---------------------------------------------------------------------------

function referenceMasterSpecs() {
  return {
    SHIFT: {
      table: 'engineering_shifts', entity: 'ENGINEERING_SHIFT', label: '班次',
      normalize(body, current) {
        const shift = normalizeShift(body, current);
        return {
          sql: 'UPDATE engineering_shifts SET code=?,name=?,start_minute=?,end_minute=?,notes=?,updated_at=? WHERE id=?',
          params: [shift.code, shift.name, shift.startMinute, shift.endMinute, shift.notes, 'NOW', 'MASTER_ID'],
          values: shift,
        };
      },
    },
    PATTERN: {
      table: 'engineering_shift_patterns', entity: 'ENGINEERING_SHIFT_PATTERN', label: '班制',
      normalize(body, current, db) {
        const code = requiredCode(body.code ?? current?.code, '班制编码');
        const name = requiredText(body.name ?? current?.name, '班制名称', 100);
        const shiftIds = Array.isArray(body.shiftIds ?? body.shift_ids)
          ? (body.shiftIds ?? body.shift_ids).map(String)
          : parseShiftIds(current?.shift_ids);
        if (!shiftIds.length) throw new HttpError(400, '班制至少包含一个班次');
        const unknown = [];
        for (const sid of shiftIds) {
          if (!db.prepare('SELECT 1 FROM engineering_shifts WHERE id=? AND active=1').get(sid)) unknown.push(sid);
        }
        if (unknown.length) throw new HttpError(400, `班次不存在或未启用 ${unknown.join(',')}`);
        return {
          sql: 'UPDATE engineering_shift_patterns SET code=?,name=?,shift_ids=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, JSON.stringify(shiftIds), optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, shiftIds },
        };
      },
    },
    CALENDAR_TEMPLATE: {
      table: 'engineering_calendar_templates', entity: 'ENGINEERING_CALENDAR_TEMPLATE', label: '日历模板',
      normalize(body, current, db) {
        const code = requiredCode(body.code ?? current?.code, '日历模板编码');
        const name = requiredText(body.name ?? current?.name, '日历模板名称', 100);
        const workDays = Array.isArray(body.workDays ?? body.work_days)
          ? (body.workDays ?? body.work_days)
          : parseWorkDays(current?.work_days);
        const sanitized = Array.from(new Set(workDays
          .filter((d) => Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 6))).map(Number);
        if (!sanitized.length) throw new HttpError(400, '工作日不能为空');
        const shiftPatternId = body.shiftPatternId ?? body.shift_pattern_id ?? current?.shift_pattern_id ?? null;
        if (shiftPatternId && !db.prepare('SELECT 1 FROM engineering_shift_patterns WHERE id=? AND active=1').get(shiftPatternId)) {
          throw new HttpError(400, '班制不存在或未启用');
        }
        return {
          sql: 'UPDATE engineering_calendar_templates SET code=?,name=?,work_days=?,shift_pattern_id=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, JSON.stringify(sanitized), shiftPatternId, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, workDays: sanitized, shiftPatternId },
        };
      },
    },
    WORK_CALENDAR: {
      table: 'engineering_work_calendars', entity: 'ENGINEERING_WORK_CALENDAR', label: '工作日历',
      normalize(body, current, db) {
        const code = requiredCode(body.code ?? current?.code, '工作日历编码');
        const name = requiredText(body.name ?? current?.name, '工作日历名称', 100);
        const startDate = requiredText(body.startDate ?? body.start_date ?? current?.start_date, '起始日期', 10);
        const endDate = requiredText(body.endDate ?? body.end_date ?? current?.end_date, '结束日期', 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
          throw new HttpError(400, '日期格式必须为 YYYY-MM-DD');
        }
        if (startDate >= endDate) throw new HttpError(400, '结束日期必须晚于起始日期');
        const templateId = body.templateId ?? body.template_id ?? current?.template_id ?? null;
        if (templateId && !db.prepare('SELECT 1 FROM engineering_calendar_templates WHERE id=? AND active=1').get(templateId)) {
          throw new HttpError(400, '日历模板不存在或未启用');
        }
        return {
          sql: 'UPDATE engineering_work_calendars SET code=?,name=?,template_id=?,start_date=?,end_date=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, templateId, startDate, endDate, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, templateId, startDate, endDate },
        };
      },
    },
    ACTIVITY: {
      table: 'engineering_basic_activities', entity: 'ENGINEERING_BASIC_ACTIVITY', label: '基础活动',
      normalize(body, current) {
        const code = requiredCode(body.code ?? current?.code, '基础活动编码');
        const name = requiredText(body.name ?? current?.name, '基础活动名称', 100);
        const stage = String(body.stage ?? current?.stage ?? 'PROCESS').toUpperCase();
        if (!['PREPARE', 'PROCESS', 'DISASSEMBLE'].includes(stage)) throw new HttpError(400, '活动阶段不正确');
        const unit = optionalText(body.unit ?? current?.unit, 20) || '';
        const defaultQuantity = Number(body.defaultQuantity ?? body.default_quantity ?? current?.default_quantity ?? 0);
        if (!Number.isFinite(defaultQuantity) || defaultQuantity < 0) throw new HttpError(400, '默认数量必须为非负数');
        return {
          sql: 'UPDATE engineering_basic_activities SET code=?,name=?,stage=?,unit=?,default_quantity=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, stage, unit, defaultQuantity, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, stage, unit, defaultQuantity },
        };
      },
    },
    FORMULA: {
      table: 'engineering_workshop_formulas', entity: 'ENGINEERING_WORKSHOP_FORMULA', label: '公式',
      normalize(body, current) {
        const code = requiredCode(body.code ?? current?.code, '公式编码');
        const name = requiredText(body.name ?? current?.name, '公式名称', 100);
        const formula = requiredText(body.formula ?? current?.formula, '公式', 256);
        try {
          compileFormula(formula);
        } catch (error) {
          if (error instanceof FormulaError) {
            throw new HttpError(400, `公式非法 (${error.reason}): ${error.message}`);
          }
          throw error;
        }
        const variables = Array.isArray(body.variables)
          ? body.variables.map(String)
          : parseVariables(current?.variables);
        return {
          sql: 'UPDATE engineering_workshop_formulas SET code=?,name=?,formula=?,formula_version=?,variables=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, formula, Number(current?.formula_version || 1) + 1, JSON.stringify(variables), optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, formula, variables },
        };
      },
    },
    RESOURCE: {
      table: 'engineering_resources', entity: 'ENGINEERING_RESOURCE', label: '资源',
      normalize(body, current, db) {
        const code = requiredCode(body.code ?? current?.code, '资源编码');
        const name = requiredText(body.name ?? current?.name, '资源名称', 100);
        const category = String(body.category ?? current?.category ?? 'MACHINE').toUpperCase();
        if (!['MACHINE', 'TOOL', 'PERSON', 'MATERIAL', 'OTHER'].includes(category)) throw new HttpError(400, '资源类型不正确');
        const quantity = Number(body.quantity ?? current?.quantity ?? 1);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '资源数量必须为正数');
        const unit = optionalText(body.unit ?? current?.unit, 20) || '';
        const workCenterId = body.workCenterId ?? body.work_center_id ?? current?.work_center_id ?? null;
        if (workCenterId && !db.prepare('SELECT 1 FROM work_centers WHERE id=?').get(workCenterId)) {
          throw new HttpError(400, '工作中心不存在');
        }
        return {
          sql: 'UPDATE engineering_resources SET code=?,name=?,quantity=?,unit=?,category=?,work_center_id=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, quantity, unit, category, workCenterId, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, quantity, unit, category, workCenterId },
        };
      },
    },
    EQUIPMENT: {
      table: 'engineering_equipment', entity: 'ENGINEERING_EQUIPMENT', label: '设备',
      normalize(body, current, db) {
        const code = requiredCode(body.code ?? current?.code, '设备编码');
        const name = requiredText(body.name ?? current?.name, '设备名称', 100);
        const model = optionalText(body.model ?? current?.model, 100) || '';
        const serial = optionalText(body.serial ?? current?.serial, 100) || '';
        const workCenterId = body.workCenterId ?? body.work_center_id ?? current?.work_center_id ?? null;
        if (workCenterId && !db.prepare('SELECT 1 FROM work_centers WHERE id=?').get(workCenterId)) {
          throw new HttpError(400, '工作中心不存在');
        }
        return {
          sql: 'UPDATE engineering_equipment SET code=?,name=?,model=?,serial=?,work_center_id=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, model, serial, workCenterId, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, model, serial, workCenterId },
        };
      },
    },
    OPERATION: {
      table: 'engineering_operations', entity: 'ENGINEERING_OPERATION', label: '作业',
      normalize(body, current, db) {
        const code = requiredCode(body.code ?? current?.code, '作业编码');
        const name = requiredText(body.name ?? current?.name, '作业名称', 100);
        const standardMinutes = Number(body.standardMinutes ?? body.standard_minutes ?? current?.standard_minutes ?? 0);
        if (!Number.isFinite(standardMinutes) || standardMinutes < 0) throw new HttpError(400, '标准工时必须为非负数');
        const activityId = body.activityId ?? body.activity_id ?? current?.activity_id ?? null;
        if (activityId && !db.prepare('SELECT 1 FROM engineering_basic_activities WHERE id=? AND active=1').get(activityId)) {
          throw new HttpError(400, '基础活动不存在或未启用');
        }
        const workCenterId = body.workCenterId ?? body.work_center_id ?? current?.work_center_id ?? null;
        if (workCenterId && !db.prepare('SELECT 1 FROM work_centers WHERE id=?').get(workCenterId)) {
          throw new HttpError(400, '工作中心不存在');
        }
        return {
          sql: 'UPDATE engineering_operations SET code=?,name=?,standard_minutes=?,activity_id=?,work_center_id=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, standardMinutes, activityId, workCenterId, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, standardMinutes, activityId, workCenterId },
        };
      },
    },
    CONTROL_CODE: {
      table: 'engineering_control_codes', entity: 'ENGINEERING_CONTROL_CODE', label: '控制码',
      normalize(body, current) {
        const code = requiredCode(body.code ?? current?.code, '控制码编码');
        const name = requiredText(body.name ?? current?.name, '控制码名称', 100);
        const category = String(body.category ?? current?.category ?? 'PROCESSING').toUpperCase();
        if (!['SCHEDULING', 'PROCESSING', 'REPORT', 'INSPECTION', 'OUTSOURCE', 'QUALITY'].includes(category)) {
          throw new HttpError(400, '控制码类别不正确');
        }
        const policy = optionalText(body.policy ?? current?.policy, 100) || 'STANDARD';
        return {
          sql: 'UPDATE engineering_control_codes SET code=?,name=?,category=?,policy=?,notes=?,updated_at=? WHERE id=?',
          params: [code, name, category, policy, optionalText(body.notes ?? current?.notes, 500), 'NOW', 'MASTER_ID'],
          values: { code, name, category, policy },
        };
      },
    },
  };
}

// The active references that block a deactivation. A master that is still
// pointed at by an active record must stay active: historical references must
// not break.
function referenceGuards(kind) {
  const guards = {
    SHIFT: [
      { sql: "SELECT COUNT(*) n FROM engineering_shift_patterns WHERE active=1 AND shift_ids LIKE ?", param: (id) => `%${id}%`, label: '班制' },
    ],
    PATTERN: [
      { sql: 'SELECT COUNT(*) n FROM engineering_calendar_templates WHERE active=1 AND shift_pattern_id=?', param: (id) => id, label: '日历模板' },
    ],
    CALENDAR_TEMPLATE: [
      { sql: 'SELECT COUNT(*) n FROM engineering_work_calendars WHERE active=1 AND template_id=?', param: (id) => id, label: '工作日历' },
    ],
    WORK_CALENDAR: [
      { sql: 'SELECT COUNT(*) n FROM work_centers WHERE active=1 AND calendar_id=?', param: (id) => id, label: '工作中心' },
    ],
    ACTIVITY: [
      { sql: 'SELECT COUNT(*) n FROM engineering_operations WHERE active=1 AND activity_id=?', param: (id) => id, label: '作业' },
      { sql: 'SELECT COUNT(*) n FROM product_routing_operations WHERE activity_id=?', param: (id) => id, label: '工艺路线作业' },
    ],
    RESOURCE: [
      { sql: 'SELECT COUNT(*) n FROM product_routing_operations WHERE resource_id=?', param: (id) => id, label: '工艺路线作业' },
    ],
    EQUIPMENT: [
      { sql: 'SELECT COUNT(*) n FROM product_routing_operations WHERE equipment_id=?', param: (id) => id, label: '工艺路线作业' },
    ],
    OPERATION: [
      { sql: 'SELECT COUNT(*) n FROM product_routing_operations WHERE operation_id=?', param: (id) => id, label: '工艺路线作业' },
    ],
    CONTROL_CODE: [
      { sql: 'SELECT COUNT(*) n FROM product_routing_operations WHERE control_code_id=?', param: (id) => id, label: '工艺路线作业' },
    ],
  };
  return guards[kind] || [];
}

function parseShiftIds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return [];
  }
}

function parseWorkDays(raw) {
  if (!raw) return [1, 2, 3, 4, 5];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number) : [1, 2, 3, 4, 5];
  } catch (_) {
    return [1, 2, 3, 4, 5];
  }
}

export function listEngineeringReferenceMasters() {
  return Object.keys(referenceMasterSpecs());
}

export async function updateEngineeringReferenceMaster(db, req, res, actor, kind, masterId) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const spec = referenceMasterSpecs()[kind];
  if (!spec) throw new HttpError(400, '未知的工程参考资料类型');
  const body = await readJson(req);
  const now = new Date().toISOString();
  transaction(db, () => {
    // The authoritative master row is re-read inside the transaction and
    // locked, so the defaults derived from it and the write that follows
    // cannot disagree with a concurrent deactivate.
    const current = readActive(db, spec.table, masterId, spec.label, { lock: true });
    const prepared = spec.normalize(body, current, db);
    const params = prepared.params.map((value) => {
      if (value === 'NOW') return now;
      if (value === 'MASTER_ID') return masterId;
      return value;
    });
    db.prepare(prepared.sql).run(...params);
    audit(db, actor.id, 'UPDATE', spec.entity, masterId, String(prepared.values.code ?? current.code));
  });
  return send(res, 200, { ok: true, id: masterId });
}

export function deactivateEngineeringReferenceMaster(db, res, actor, kind, masterId) {
  allow(actor, 'ENGINEERING_REFERENCE_MANAGE');
  const spec = referenceMasterSpecs()[kind];
  if (!spec) throw new HttpError(400, '未知的工程参考资料类型');
  const now = new Date().toISOString();
  transaction(db, () => {
    // The master row is locked and the reference guards are counted inside the
    // same transaction that performs the deactivation, so a reference created
    // concurrently cannot be missed by the guard.
    const current = readActive(db, spec.table, masterId, spec.label, { lock: true });
    if (Number(current.active) === 0) return;
    for (const guard of referenceGuards(kind)) {
      const row = db.prepare(guard.sql).get(guard.param(masterId));
      if (Number(row?.n || 0) > 0) {
        throw new HttpError(409, `${spec.label}仍被活动的${guard.label}引用，无法停用`);
      }
    }
    db.prepare(`UPDATE ${spec.table} SET active=0, updated_at=? WHERE id=?`).run(now, masterId);
    audit(db, actor.id, 'DEACTIVATE', spec.entity, masterId, String(current.code));
  });
  return send(res, 200, { ok: true, active: 0 });
}
