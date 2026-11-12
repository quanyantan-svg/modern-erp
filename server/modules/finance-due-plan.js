// Finance Operations — FO03 / FO04 wiring.
//
// The payment-term master (FO03) and the multi-due-date schedule (FO04) are
// only real if a business path consumes them. This module is the single
// place where an open item's due schedule is derived from the term master
// and written through the canonical schedule lines.
//
// Design §28 (finance_payment_terms / finance_due_schedule_lines) and
// Requirement §33.7:
//
//   - one term may produce 1..n schedule lines;
//   - SUM(scheduled_amount_cents) == the open item's contractual amount;
//   - a multi-due-date term must NOT be collapsed into a single due_date.
//
// The single `due_date` column on the open item stays as a **projection** of
// the last schedule line; the schedule lines remain the truth.

import { HttpError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

const EPS = 1e-9;
const DEFAULT_TERM_CODE = 'DEFAULT';

function scheduleTableExists(db) {
  try {
    db.prepare('SELECT 1 FROM finance_due_schedule_lines LIMIT 1').get();
    return true;
  } catch (error) {
    if (!/no such table|does not exist|unknown table/i.test(String(error?.message || error))) throw error;
    return false;
  }
}

function addDays(dateText, days) {
  const value = new Date(`${dateText}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
}

// Resolve the term master row (with its installments). A term code that does
// not exist is an explicit error: a caller must not silently lose its terms.
export function resolveFinanceTerm(db, termCode) {
  const code = String(termCode || '').trim();
  if (!code) return null;
  const row = db.prepare('SELECT * FROM finance_payment_terms WHERE code=? AND active=1').get(code);
  if (!row) throw new HttpError(409, `付款条款不存在或已停用 ${code}`, { code: 'FINANCE_PAYMENT_TERM_NOT_FOUND' });
  const installments = db.prepare(
    'SELECT sequence, due_offset_days, ratio_bps FROM finance_payment_term_installments WHERE term_id=? ORDER BY sequence ASC',
  ).all(row.id);
  return {
    id: row.id,
    code: row.code,
    days: Number(row.days || 0),
    installments: installments.map((item) => ({
      sequence: Number(item.sequence),
      dueOffsetDays: Number(item.due_offset_days || 0),
      ratioBps: Number(item.ratio_bps || 0),
    })),
  };
}

export function resolveDefaultFinanceTerm(db) {
  const row = db.prepare('SELECT code FROM finance_payment_terms WHERE code=? AND active=1').get(DEFAULT_TERM_CODE);
  return row ? resolveFinanceTerm(db, row.code) : null;
}

// The dated schedule lines for one open item. The sum is exact in integer
// cents: every line but the last is floored, the last line takes the
// remainder so the invariant holds for any amount.
export function buildDueScheduleLines(db, { termCode, businessDate, amountCents, fallbackOffsetDays = null }) {
  const total = Number(amountCents);
  if (!Number.isSafeInteger(total) || total <= 0) throw new HttpError(400, '到期计划金额必须为正整数');
  const term = termCode ? resolveFinanceTerm(db, termCode) : resolveDefaultFinanceTerm(db);
  const business = String(businessDate || '').slice(0, 10);
  if (!business) throw new HttpError(400, '业务日期无效');
  if (!term || !term.installments.length) {
    // No term (or a single-installment term): one line at the business date
    // plus the caller's own term offset, or at the term's own offset. The
    // single due_date column stays the projection of that line.
    const offset = term ? term.days
      : (Number.isSafeInteger(fallbackOffsetDays) && fallbackOffsetDays >= 0 ? fallbackOffsetDays : 0);
    const dueDate = addDays(business, offset);
    return { term, lines: [{ sequence: 1, dueDate, scheduledAmountCents: total }] };
  }
  const ratios = term.installments.map((item) => (item.ratioBps > 0 ? item.ratioBps : 0));
  const ratioSum = ratios.reduce((sum, value) => sum + value, 0);
  const lines = [];
  let allocated = 0;
  term.installments.forEach((item, index) => {
    const isLast = index === term.installments.length - 1;
    let amount = 0;
    if (isLast) {
      amount = total - allocated;
    } else {
      const basis = ratioSum > 0 ? ratios[index] / ratioSum : 1 / term.installments.length;
      amount = Math.floor(total * basis);
      allocated += amount;
    }
    lines.push({ sequence: item.sequence || index + 1, dueDate: addDays(business, item.dueOffsetDays), scheduledAmountCents: amount });
  });
  const sum = lines.reduce((acc, line) => acc + line.scheduledAmountCents, 0);
  if (sum !== total) throw new HttpError(400, '到期计划金额合计必须等于原币金额');
  return { term, lines };
}

// Write the canonical schedule lines for an open item and project the last
// line's date onto the open item's single due_date column.
export function applyDueScheduleForOpenItem(db, { side, openItemId, termCode, businessDate, amountCents, fallbackOffsetDays = null, actor }) {
  const isAr = side === 'AR';
  if (!scheduleTableExists(db)) {
    // The schedule master does not exist yet while the legacy settlement
    // migration is still running. The open item keeps its due_date and no
    // schedule is written; the canonical Finance path always has the table.
    return { term: null, lines: [] };
  }
  const table = isAr ? 'account_receivables' : 'account_payables';
  const header = db.prepare(`SELECT id, amount_cents, due_date FROM ${table} WHERE id=?`).get(openItemId);
  if (!header) throw new HttpError(404, '往来项不存在');
  const amount = Number(amountCents ?? header.amount_cents);
  const { term, lines } = buildDueScheduleLines(db, { termCode, businessDate, amountCents: amount, fallbackOffsetDays });
  const now = new Date().toISOString();
  db.prepare('DELETE FROM finance_due_schedule_lines WHERE side=? AND open_item_id=?').run(side, openItemId);
  const insert = db.prepare(
    `INSERT INTO finance_due_schedule_lines(
       id, side, open_item_id, ar_open_item_id, ap_open_item_id,
       sequence, due_date, scheduled_amount_cents, settled_amount_cents,
       status, created_at)
     VALUES(?,?,?,?,?,?,?,?,0,'OPEN',?)`,
  );
  for (const line of lines) {
    insert.run(
      id(), side, openItemId,
      isAr ? openItemId : null,
      isAr ? null : openItemId,
      line.sequence, line.dueDate, line.scheduledAmountCents, now,
    );
  }
  // The single due_date column is a projection of the last schedule line.
  const lastDue = lines.length ? lines[lines.length - 1].dueDate : header.due_date;
  db.prepare(`UPDATE ${table} SET due_date=?, updated_at=? WHERE id=?`).run(lastDue, now, openItemId);
  audit(db, actor?.id, 'APPLY_DUE_SCHEDULE', isAr ? 'ACCOUNT_RECEIVABLE' : 'ACCOUNT_PAYABLE', openItemId,
    `term=${term?.code || 'NONE'} lines=${lines.length}`);
  return { term, lines };
}
