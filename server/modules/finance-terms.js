// V22 — Finance Operations Wave A.
//
// FO03 — Collection/Payment Terms (canonical finance_payment_terms master).

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

export function listFinancePaymentTerms(db, res, actor) {
  allow(actor, 'AR_VIEW', 'AP_VIEW');
  const rows = db.prepare(`SELECT * FROM finance_payment_terms ORDER BY code ASC`).all();
  return send(res, 200, { terms: rows.map(rowToTerm) });
}

export async function upsertFinancePaymentTerm(db, req, res, actor) {
  allow(actor, 'FINANCE_PARAMETERS_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '条款编码', 64);
  const name = optionalText(body.name ?? '', 128);
  const daysNum = body.days === undefined || body.days === null || body.days === '' ? 0 : Number(body.days);
  if (!Number.isSafeInteger(daysNum) || daysNum < 0 || daysNum > 3650) {
    throw new HttpError(400, '付款条款天数必须是 0–3650 的整数');
  }
  const active = body.active === undefined ? 1 : (body.active ? 1 : 0);
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
  });
  return send(res, 200, { id: tid, code });
}

function rowToTerm(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    days: row.days,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runInTransaction(db, fn) {
  if (db.inTransaction && db.inTransaction()) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
