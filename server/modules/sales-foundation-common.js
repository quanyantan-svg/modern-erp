import { transaction } from '../db.js';
import { HttpError, normalizeBusinessDate } from '../lib/http.js';

export const SALES_DOCUMENT_TYPES = Object.freeze(['SALES_ORDER', 'SALES_QUOTATION', 'DELIVERY_NOTICE']);
export const ORDER_CHANGE_MODES = Object.freeze(['DISABLED', 'CONTROLLED_DIRECT', 'CONTROLLED_DOCUMENT', 'BOTH']);
export const RESERVATION_BEHAVIORS = Object.freeze([
  'DISABLED', 'INVENTORY_LOCK', 'MANUAL_RESERVATION', 'ON_HAND_RESERVATION', 'EXPECTED_SUPPLY_RESERVATION',
]);

export function boolInt(value, fallback = true) {
  if (value === undefined) return fallback ? 1 : 0;
  if (value !== true && value !== false && value !== 1 && value !== 0) {
    throw new HttpError(400, '布尔字段必须为 true 或 false');
  }
  return value ? 1 : 0;
}

export function nullableId(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function optionalDate(value, label = '结束日期') {
  if (value === undefined || value === null || value === '') return null;
  return normalizeBusinessDate(value, label);
}

export function assertDateRange(from, to) {
  if (to && to < from) throw new HttpError(400, '结束日期不能早于开始日期');
}

export function intervalsOverlap(leftFrom, leftTo, rightFrom, rightTo) {
  return leftFrom <= (rightTo || '9999-12-31') && rightFrom <= (leftTo || '9999-12-31');
}

export function previousDate(date) {
  const probe = new Date(`${date}T00:00:00Z`);
  probe.setUTCDate(probe.getUTCDate() - 1);
  return probe.toISOString().slice(0, 10);
}

export function lockById(db, table, id) {
  const suffix = db.dialect === 'mysql' ? ' FOR UPDATE' : '';
  return db.prepare(`SELECT id FROM ${table} WHERE id=?${suffix}`).get(id);
}

export function runSalesWrite(db, work) {
  return transaction(db, work);
}

export function requireRow(row, message) {
  if (!row) throw new HttpError(404, message);
  return row;
}

export function mapBoolFields(row, fields) {
  if (!row) return row;
  const mapped = { ...row };
  for (const field of fields) mapped[field] = Boolean(mapped[field]);
  return mapped;
}

export function conflict(message, code = 'SALES_FOUNDATION_CONFLICT') {
  return new HttpError(409, message, { code });
}

export function translateConstraintError(error, message = '记录与现有配置冲突') {
  const text = String(error?.message || '');
  if (/UNIQUE|constraint|duplicate/i.test(text)) throw conflict(message);
  throw error;
}
