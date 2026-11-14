// R-02 — canonical cross-domain period guard.
//
// Contract: docs/requirements/platform.md §36.15.3 and
// docs/design/platform.md §32.15.2. This module is the only active period
// judgement in the codebase: it resolves the immutable axis set of a named
// action, takes the stable locks in the canonical rank order, re-reads the
// authoritative state of each axis under those locks, and rejects with a
// structured error before any economic side effect.
//
// It does not implement close/reopen: each Domain keeps ownership of its own
// close/reopen state machine and only borrows the lock protocol.

import { transaction } from '../db.js';
import { HttpError } from '../lib/http.js';
import { axesForPeriodAction, financeActionCode, PERIOD_AXES } from './period-action-registry.js';

const AXIS_RANK = Object.freeze({
  [PERIOD_AXES.INVENTORY]: 10,
  [PERIOD_AXES.FINANCE_AR]: 20,
  [PERIOD_AXES.FINANCE_AP]: 30,
  [PERIOD_AXES.FINANCE_TREASURY]: 40,
  [PERIOD_AXES.LEGAL_ACCOUNTING]: 50,
  [PERIOD_AXES.OPERATING]: 60,
});

const FINANCE_TYPE = Object.freeze({
  [PERIOD_AXES.FINANCE_AR]: 'AR',
  [PERIOD_AXES.FINANCE_AP]: 'AP',
  [PERIOD_AXES.FINANCE_TREASURY]: 'TREASURY',
});

function periodError(status, message, code, details = {}) {
  return new HttpError(status, message, { code, ...details });
}

export function normalizeBusinessDate(value) {
  const date = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw periodError(400, '业务日期格式必须为 YYYY-MM-DD', 'BUSINESS_DATE_INVALID');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw periodError(400, '业务日期不是有效日历日期', 'BUSINESS_DATE_INVALID');
  }
  return date;
}

export function periodEndDate(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period ?? ''))) {
    throw periodError(400, '期间格式必须为 YYYY-MM', 'PERIOD_SCOPE_REQUIRED');
  }
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

function nextPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  const value = new Date(Date.UTC(year, month, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function closedCutoff(rows, column, axis) {
  const periods = [...new Set(rows.map((row) => String(row[column] || '')).filter(Boolean))].sort();
  for (let index = 1; index < periods.length; index += 1) {
    if (periods[index] !== nextPeriod(periods[index - 1])) {
      throw periodError(409, `${axis} 关闭期间存在断裂`, 'PERIOD_STATE_INVALID', { axis, periods });
    }
  }
  return periods.at(-1) || '';
}

function requireTransaction(db) {
  if (!db?.isTransaction) {
    throw periodError(500, '期间闸门必须在写事务内执行', 'PERIOD_GUARD_TRANSACTION_REQUIRED');
  }
}

function lockSuffix(db) {
  return db.dialect === 'mysql' ? ' FOR UPDATE' : '';
}

function lockAxis(db, axis, managementBookId) {
  const suffix = lockSuffix(db);
  if (axis === PERIOD_AXES.INVENTORY || axis === PERIOD_AXES.LEGAL_ACCOUNTING) {
    const row = db.prepare(`SELECT axis,scope_key FROM period_guard_anchors WHERE axis=? AND scope_key='GLOBAL'${suffix}`).get(axis);
    if (!row) throw periodError(409, `${axis} 期间协调锚点缺失`, 'PERIOD_STATE_INVALID', { axis });
    return;
  }
  const financeType = FINANCE_TYPE[axis];
  if (financeType) {
    const row = db.prepare(`SELECT close_type FROM finance_business_close_state WHERE close_type=?${suffix}`).get(financeType);
    if (!row) throw periodError(409, `${financeType} 业务关账锚点缺失`, 'PERIOD_STATE_INVALID', { axis });
    return;
  }
  if (axis === PERIOD_AXES.OPERATING) {
    if (!managementBookId) throw periodError(400, '经营期间动作必须指定 managementBookId', 'PERIOD_SCOPE_REQUIRED', { axis });
    const row = db.prepare(`SELECT id FROM management_books WHERE id=?${suffix}`).get(managementBookId);
    if (!row) throw periodError(400, '经营账簿不存在', 'PERIOD_SCOPE_REQUIRED', { axis, managementBookId });
  }
}

export function lockPeriodAxes(db, axes, { managementBookId = null } = {}) {
  requireTransaction(db);
  const ordered = [...new Set(axes)].sort((left, right) => (AXIS_RANK[left] ?? 999) - (AXIS_RANK[right] ?? 999));
  for (const axis of ordered) lockAxis(db, axis, managementBookId);
  return ordered;
}

function inventoryCutoff(db) {
  return closedCutoff(
    db.prepare("SELECT period_key FROM inventory_period_closures WHERE status='CLOSED' ORDER BY period_key").all(),
    'period_key', PERIOD_AXES.INVENTORY,
  );
}

function legalCutoff(db) {
  return closedCutoff(
    db.prepare("SELECT period FROM period_closures WHERE status='CLOSED' ORDER BY period").all(),
    'period', PERIOD_AXES.LEGAL_ACCOUNTING,
  );
}

// The closed-through boundary of each axis, read through the canonical module
// so that no owner re-derives it. Both throw PERIOD_STATE_INVALID on a broken
// closure history.
export function inventoryClosedThrough(db) {
  return inventoryCutoff(db);
}

export function legalClosedThrough(db) {
  return legalCutoff(db);
}

function financeCutoff(db, axis) {
  const closeType = FINANCE_TYPE[axis];
  const row = db.prepare('SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?').get(closeType);
  if (!row) throw periodError(409, `${closeType} 业务关账锚点缺失`, 'PERIOD_STATE_INVALID', { axis });
  return row.closed_through_date || '';
}

function operatingState(db, date, managementBookId) {
  const period = date.slice(0, 7);
  const row = db.prepare('SELECT status FROM operating_period_closures WHERE management_book_id=? AND period=?')
    .get(managementBookId, period);
  return { period, row };
}

function assertInventoryOpen(db, date) {
  const cutoff = inventoryCutoff(db);
  if (cutoff && date <= periodEndDate(cutoff)) {
    throw periodError(409, `存货期间已结至 ${cutoff}`, 'INVENTORY_PERIOD_CLOSED', {
      axis: PERIOD_AXES.INVENTORY, businessDate: date, closedThrough: cutoff,
      resolution: '使用未结期间的业务日期，或先按逆序治理流程反结账。',
    });
  }
}

function assertLegalOpen(db, date) {
  const cutoff = legalCutoff(db);
  if (cutoff && date <= periodEndDate(cutoff)) {
    throw periodError(409, `会计期间已结至 ${cutoff}`, 'FINANCIAL_PERIOD_CLOSED', {
      axis: PERIOD_AXES.LEGAL_ACCOUNTING, businessDate: date, closedThrough: cutoff,
      resolution: '使用未结期间的业务日期，或先按逆序治理流程反结账。',
    });
  }
}

function assertFinanceOpen(db, axis, date) {
  const closeType = FINANCE_TYPE[axis];
  const cutoff = financeCutoff(db, axis);
  if (cutoff && date <= cutoff) {
    throw periodError(409, `${closeType} 业务日期 ${date} 已结账至 ${cutoff}`, 'FINANCE_PERIOD_CLOSED', {
      axis, closeType, businessDate: date, closedThrough: cutoff,
    });
  }
}

function assertOperatingOpen(db, date, managementBookId) {
  const { period, row } = operatingState(db, date, managementBookId);
  if (row?.status === 'CLOSED') {
    throw periodError(409, `经营期间 ${period} 已关闭`, 'OPERATING_PERIOD_CLOSED', {
      axis: PERIOD_AXES.OPERATING, managementBookId, businessDate: date, period,
    });
  }
  if (row && row.status !== 'OPEN') {
    throw periodError(409, `经营期间 ${period} 状态异常`, 'PERIOD_STATE_INVALID', {
      axis: PERIOD_AXES.OPERATING, managementBookId, period,
    });
  }
}

/**
 * The single period guard entry point.
 *
 * `actionCode` must be a key of PERIOD_ACTIONS: an unregistered action fails
 * closed instead of falling back to a weaker check.
 */
export function guardPeriodAction(db, input) {
  requireTransaction(db);
  const actionCode = String(input?.actionCode || '').trim();
  const axes = axesForPeriodAction(actionCode);
  if (!axes) throw periodError(500, `期间动作未登记: ${actionCode || '<empty>'}`, 'PERIOD_ACTION_UNREGISTERED');
  const date = normalizeBusinessDate(input?.businessDate);
  const ordered = lockPeriodAxes(db, axes, { managementBookId: input?.managementBookId });
  for (const axis of ordered) {
    if (axis === PERIOD_AXES.INVENTORY) assertInventoryOpen(db, date);
    else if (axis === PERIOD_AXES.LEGAL_ACCOUNTING) assertLegalOpen(db, date);
    else if (FINANCE_TYPE[axis]) assertFinanceOpen(db, axis, date);
    else if (axis === PERIOD_AXES.OPERATING) assertOperatingOpen(db, date, input?.managementBookId);
  }
  return { actionCode, axes: ordered, businessDate: date };
}

/** Guard for a mutation whose Finance axis is only known at runtime. */
export function guardFinanceAction(db, closeType, businessDate) {
  const actionCode = financeActionCode(closeType);
  if (!actionCode) throw periodError(400, 'closeType 必须是 AR / AP / TREASURY', 'PERIOD_SCOPE_REQUIRED');
  return guardPeriodAction(db, { actionCode, businessDate });
}

/** Guard for a voucher mutation (system or manual). */
export function guardVoucherAction(db, businessDate, actionCode = 'LEGAL_VOUCHER') {
  return guardPeriodAction(db, { actionCode, businessDate });
}

/** Guard for an operating-book mutation. */
export function guardOperatingAction(db, actionCode, period, managementBookId) {
  return guardPeriodAction(db, { actionCode, businessDate: `${period}-01`, managementBookId });
}

/**
 * Run a canonical mutation that may be reached without an enclosing write
 * transaction. The guard has to observe and lock the period state in the same
 * transaction as the economic write, so a standalone entry owns its
 * transaction; when the caller already opened one the body runs inline and
 * both share that transaction.
 */
export function runGuardedMutation(db, work) {
  if (db?.isTransaction) return work();
  return transaction(db, work);
}
