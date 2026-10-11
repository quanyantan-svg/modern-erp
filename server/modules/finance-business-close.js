// V22 — Finance Operations Wave A.
//
// FO51 / FO52 / FO53 — Operational Business Close.
//
// finance_business_close_state (NEW table #19; stable 3-seeded anchor,
// lock target for RACE-15).
// finance_business_closures (NEW table #20; history rows).
//
// assertFinanceBusinessDateOpen(closeType, businessDate)
//   1. SELECT * FROM finance_business_close_state WHERE close_type=? FOR UPDATE
//   2. assert closed_through_date == '' OR businessDate > closed_through_date
//
// Every dated Finance write MUST declare which close guard applies.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

export const VALID_CLOSE_TYPES = Object.freeze(['AR', 'AP', 'TREASURY']);

export function assertFinanceBusinessDateOpen(db, closeType, businessDate) {
  if (!VALID_CLOSE_TYPES.includes(closeType)) {
    throw new HttpError(400, 'closeType 必须是 AR / AP / TREASURY');
  }
  const row = db.prepare(
    `SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?`
  ).get(closeType);
  if (!row) throw new HttpError(500, `business-close anchor missing for ${closeType}`);
  const closedThrough = row.closed_through_date || '';
  if (closedThrough && businessDate && businessDate <= closedThrough) {
    throw new HttpError(409, `${closeType} 业务日期 ${businessDate} 已结账至 ${closedThrough}`);
  }
}

export function listBusinessCloseState(db, res, actor) {
  allow(actor, 'FINANCE_CLOSE_VIEW', 'AR_VIEW', 'AP_VIEW');
  const rows = db.prepare(`SELECT * FROM finance_business_close_state ORDER BY close_type`).all();
  return send(res, 200, { state: rows });
}

export function listBusinessCloseHistory(db, res, actor, closeType) {
  allow(actor, 'FINANCE_CLOSE_VIEW');
  const params = [];
  let sql = `SELECT * FROM finance_business_closures`;
  if (closeType) { sql += ` WHERE close_type=?`; params.push(closeType); }
  sql += ` ORDER BY closed_through_date DESC, status ASC`;
  const rows = db.prepare(sql).all(...params);
  return send(res, 200, { history: rows });
}

export async function closeBusiness(db, req, res, actor, closeType) {
  allow(actor, 'FINANCE_CLOSE_MANAGE');
  if (!VALID_CLOSE_TYPES.includes(closeType)) throw new HttpError(400, 'closeType 非法');
  const body = await readJson(req);
  const closedThroughDate = requiredText(body.closedThroughDate, 'closedThroughDate', 16);
  const now = new Date().toISOString();
  runInTransaction(db, () => {
    const row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?`).get(closeType);
    if (!row) throw new HttpError(500, `business-close anchor missing for ${closeType}`);
    if (row.closed_through_date && row.closed_through_date >= closedThroughDate) {
      throw new HttpError(409, `${closeType} 已结账至 ${row.closed_through_date}，不可回退`);
    }
    db.prepare(`UPDATE finance_business_close_state SET closed_through_date=?, updated_at=?, updated_by=? WHERE close_type=?`)
      .run(closedThroughDate, now, actor.id, closeType);
    db.prepare(
      `INSERT INTO finance_business_closures(id, close_type, closed_through_date, status, closed_by, closed_at, created_at)
       VALUES(?,?,?, 'CLOSED', ?, ?, ?)`
    ).run(id(), closeType, closedThroughDate, actor.id, now, now);
    audit(db, actor.id, 'CLOSE_BUSINESS_DATE', `FINANCE_BUSINESS_CLOSE_${closeType}`, closeType, closedThroughDate);
  });
  return send(res, 200, { closeType, closedThroughDate, status: 'CLOSED' });
}

export async function reopenBusiness(db, req, res, actor, closeType) {
  allow(actor, 'FINANCE_CLOSE_MANAGE');
  if (!VALID_CLOSE_TYPES.includes(closeType)) throw new HttpError(400, 'closeType 非法');
  const body = await readJson(req);
  const reopenReason = optionalText(body.reopenReason ?? '', 256);
  const now = new Date().toISOString();
  runInTransaction(db, () => {
    const row = db.prepare(`SELECT closed_through_date FROM finance_business_close_state WHERE close_type=?`).get(closeType);
    if (!row || !row.closed_through_date) {
      throw new HttpError(409, `${closeType} 未结账，无需重开`);
    }
    db.prepare(`UPDATE finance_business_close_state SET closed_through_date='', updated_at=?, updated_by=? WHERE close_type=?`)
      .run(now, actor.id, closeType);
    db.prepare(
      `INSERT INTO finance_business_closures(id, close_type, closed_through_date, status, reopened_by, reopened_at, reopen_reason, created_at)
       VALUES(?,?,?, 'REOPENED', ?, ?, ?, ?)`
    ).run(id(), closeType, row.closed_through_date, actor.id, now, reopenReason, now);
    audit(db, actor.id, 'REOPEN_BUSINESS_DATE', `FINANCE_BUSINESS_CLOSE_${closeType}`, closeType, reopenReason);
  });
  return send(res, 200, { closeType, status: 'REOPENED' });
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
