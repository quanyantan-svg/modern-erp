// V22 — Finance Operations Wave A.
//
// FO01 — Finance Operations Parameters.
//
// Single canonical finance parameters owner.
// Module exports `listFinanceParameters`, `upsertFinanceParameter`,
// `getFinanceParameter`.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

function rowToParam(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    value: row.value,
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listFinanceParameters(db, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_VIEW');
  const rows = db.prepare(`SELECT * FROM finance_parameters ORDER BY code ASC`).all();
  return send(res, 200, { parameters: rows.map(rowToParam) });
}

export async function upsertFinanceParameter(db, req, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_MANAGE');
  const body = await readJson(req);
  const code = requiredText(body.code, '参数编码', 64);
  const name = optionalText(body.name ?? '', 128);
  const value = optionalText(body.value ?? '', 2048);
  const active = body.active === undefined ? 1 : (body.active ? 1 : 0);
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id FROM finance_parameters WHERE code=?`).get(code);
  let pid;
  runInTransaction(db, () => {
    if (existing) {
      db.prepare(`UPDATE finance_parameters SET name=?, value=?, active=?, updated_at=? WHERE code=?`)
        .run(name, value, active, now, code);
      pid = existing.id;
      audit(db, actor.id, 'UPDATE', 'FINANCE_PARAMETER', pid, code);
    } else {
      pid = id();
      db.prepare(`INSERT INTO finance_parameters(id, code, name, value, active, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?)`)
        .run(pid, code, name, value, active, now, now);
      audit(db, actor.id, 'CREATE', 'FINANCE_PARAMETER', pid, code);
    }
  });
  return send(res, 200, { id: pid, code });
}

export function getFinanceParameter(db, code) {
  if (!code) return null;
  const row = db.prepare(`SELECT * FROM finance_parameters WHERE code=? AND active=1`).get(code);
  return row ? rowToParam(row) : null;
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
