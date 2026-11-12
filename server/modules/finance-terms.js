// V22 — Finance Operations Wave A.
//
// FO03 — Collection/Payment Terms (canonical finance_payment_terms master).

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

export function listFinancePaymentTerms(db, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_VIEW');
  const rows = db.prepare(`SELECT * FROM finance_payment_terms ORDER BY code ASC`).all();
  const installments = db.prepare('SELECT * FROM finance_payment_term_installments ORDER BY term_id, sequence').all();
  return send(res, 200, { terms: rows.map((row) => rowToTerm(row, installments.filter((item) => item.term_id === row.id))) });
}

export async function upsertFinancePaymentTerm(db, req, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '条款编码', 64);
  const name = optionalText(body.name ?? '', 128);
  const daysNum = body.days === undefined || body.days === null || body.days === '' ? 0 : Number(body.days);
  if (!Number.isSafeInteger(daysNum) || daysNum < 0 || daysNum > 3650) {
    throw new HttpError(400, '付款条款天数必须是 0–3650 的整数');
  }
  const active = body.active === undefined ? 1 : (body.active ? 1 : 0);
  const installments = normalizeInstallments(body.installments ?? body.installment_lines);
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id FROM finance_payment_terms WHERE code=?`).get(code);
  let tid;
  runInTransaction(db, () => {
    if (existing) {
      db.prepare(`UPDATE finance_payment_terms SET name=?, days=?, active=?, updated_at=? WHERE code=?`)
        .run(name, daysNum, active, now, code);
      tid = existing.id;
      audit(db, actor.id, 'UPDATE', 'FINANCE_PAYMENT_TERM', tid, code);
    } else {
      tid = id();
      db.prepare(`INSERT INTO finance_payment_terms(id, code, name, days, active, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?)`)
        .run(tid, code, name, daysNum, active, now, now);
      audit(db, actor.id, 'CREATE', 'FINANCE_PAYMENT_TERM', tid, code);
    }
    replaceInstallments(db, tid, installments, now);
  });
  return send(res, 200, { id: tid, code, installments: installments.length });
}

// A term may carry 1..n installment lines (Requirement §33.7). The ratios are
// basis points; the schedule lines themselves are split by the due-plan
// service so that the sum stays exact in integer cents.
function normalizeInstallments(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const lines = raw.map((item, index) => {
    const sequence = (item.sequence === undefined || item.sequence === null) ? (index + 1) : Number(item.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new HttpError(400, `\u7b2c ${index + 1} \u884c\u7684 sequence \u5fc5\u987b\u4e3a\u6b63\u6574\u6570`);
    }
    const dueOffsetDays = Number(item.dueOffsetDays ?? item.due_offset_days ?? 0);
    if (!Number.isSafeInteger(dueOffsetDays) || dueOffsetDays < 0 || dueOffsetDays > 3650) {
      throw new HttpError(400, `\u7b2c ${index + 1} \u884c\u7684 dueOffsetDays \u5fc5\u987b\u4e3a 0\u20133650 \u7684\u6574\u6570`);
    }
    const ratioBps = Number(item.ratioBps ?? item.ratio_bps ?? 0);
    if (!Number.isSafeInteger(ratioBps) || ratioBps < 0 || ratioBps > 10000) {
      throw new HttpError(400, `\u7b2c ${index + 1} \u884c\u7684 ratioBps \u5fc5\u987b\u4e3a 0\u201310000 \u7684\u6574\u6570`);
    }
    return { sequence, dueOffsetDays, ratioBps };
  });
  const sequences = new Set(lines.map((line) => line.sequence));
  if (sequences.size !== lines.length) throw new HttpError(400, '\u5206\u671f\u7684 sequence \u4e0d\u5f97\u91cd\u590d');
  return lines.sort((left, right) => left.sequence - right.sequence);
}

function replaceInstallments(db, termId, installments, now) {
  db.prepare('DELETE FROM finance_payment_term_installments WHERE term_id=?').run(termId);
  for (const line of installments) {
    db.prepare(`INSERT INTO finance_payment_term_installments(id, term_id, sequence, due_offset_days, ratio_bps, created_at)
                 VALUES(?,?,?,?,?,?)`)
      .run(id(), termId, line.sequence, line.dueOffsetDays, line.ratioBps, now);
  }
}

function rowToTerm(row, installments = []) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    days: row.days,
    active: !!row.active,
    installments: installments.map((item) => ({
      sequence: Number(item.sequence),
      dueOffsetDays: Number(item.due_offset_days || 0),
      ratioBps: Number(item.ratio_bps || 0),
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
