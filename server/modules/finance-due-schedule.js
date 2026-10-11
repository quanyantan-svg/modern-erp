// V22 — Finance Operations Wave A.
//
// FO04 — Multi-Due-Date Schedule (finance_due_schedule_lines).
//
// Invariant: SUM(scheduled_amount_cents) = amount_cents of the
// open item. Money = integer cents.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

const VALID_SIDE = new Set(['AR', 'AP']);
const VALID_STATUS = new Set(['PENDING', 'PARTIAL', 'SETTLED', 'REVERSED']);

export function listDueSchedules(db, res, actor, side, openItemId) {
  allow(actor, 'AR_VIEW', 'AP_VIEW');
  if (!VALID_SIDE.has(side)) throw new HttpError(400, 'side 必须是 AR 或 AP');
  const rows = db.prepare(
    `SELECT id, side, open_item_id, sequence, due_date, scheduled_amount_cents,
            settled_amount_cents, status, created_at
       FROM finance_due_schedule_lines
      WHERE side=? AND open_item_id=?
      ORDER BY sequence ASC`
  ).all(side, openItemId);
  return send(res, 200, { schedules: rows });
}

export async function upsertDueSchedules(db, req, res, actor) {
  allow(actor, 'AR_VIEW', 'AP_VIEW');
  const body = await readJson(req);
  const side = requiredText(body.side, 'side', 4);
  if (!VALID_SIDE.has(side)) throw new HttpError(400, 'side 必须是 AR 或 AP');
  const openItemId = requiredText(body.openItemId, 'openItemId', 64);
  assertOpenItemSide(db, side, openItemId);

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw new HttpError(400, '请提供至少一条 due schedule line');

  let contractTotal = 0;
  const normalized = lines.map((l, idx) => {
    const sequence = (l.sequence === undefined || l.sequence === null) ? (idx + 1) : Number(l.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new HttpError(400, `第 ${idx + 1} 行的 sequence 必须为正整数`);
    }
    const dueDate = requiredText(l.dueDate, `第 ${idx + 1} 行 dueDate`, 16);
    const scheduledCents = Number(l.scheduledAmountCents);
    if (!Number.isSafeInteger(scheduledCents) || scheduledCents <= 0) {
      throw new HttpError(400, `第 ${idx + 1} 行的 scheduledAmountCents 必须为正整数`);
    }
    const status = optionalText(l.status ?? 'PENDING', 16);
    if (!VALID_STATUS.has(status)) {
      throw new HttpError(400, `第 ${idx + 1} 行的 status 非法`);
    }
    contractTotal += scheduledCents;
    return { sequence, dueDate, scheduledCents, status };
  });

  // Verify contract amount against open item amount_cents.
  const headerTable = side === 'AR' ? 'account_receivables' : 'account_payables';
  const originalCents = db.prepare(`SELECT amount_cents FROM ${headerTable} WHERE id=?`).get(openItemId)?.amount_cents;
  if (typeof originalCents !== 'number') {
    throw new HttpError(404, 'open item 不存在');
  }
  if (contractTotal !== originalCents) {
    throw new HttpError(400, `SUM(scheduled_amount_cents) 必须等于原币金额 ${originalCents}`);
  }

  const now = new Date().toISOString();
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM finance_due_schedule_lines WHERE side=? AND open_item_id=?`).run(side, openItemId);
    const insert = db.prepare(
      `INSERT INTO finance_due_schedule_lines(
         id, side, open_item_id, ar_open_item_id, ap_open_item_id,
         sequence, due_date, scheduled_amount_cents, settled_amount_cents,
         status, created_at)
       VALUES(?,?,?,?,?,?,?,?,0,?,?)`
    );
    for (const ln of normalized) {
      const lineId = id();
      const arId = side === 'AR' ? openItemId : null;
      const apId = side === 'AP' ? openItemId : null;
      insert.run(lineId, side, openItemId, arId, apId,
        ln.sequence, ln.dueDate, ln.scheduledCents, ln.status, now);
    }
    audit(db, actor.id, 'UPSERT_DUE_SCHEDULE', `${headerTable.toUpperCase()}_OPEN_ITEM`, openItemId, JSON.stringify({ lines: normalized.length }));
  });

  return send(res, 200, { openItemId, side, lines: normalized.length, contractTotal });
}

export function assertOpenItemSide(db, side, openItemId) {
  const table = side === 'AR' ? 'account_receivables' : 'account_payables';
  const row = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(openItemId);
  if (!row) throw new HttpError(404, 'open item 不存在或 side 不匹配');
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
