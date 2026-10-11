// V22 — Finance Operations Wave A.
//
// FO05 — Settlement / Reconciliation Scheme config.
//
// finance_settlement_schemes (NEW table #5). Pure config; no economic
// effect on its own.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

const VALID_METHOD = new Set(['AUTO', 'MANUAL']);
const VALID_SIDE = new Set(['AR', 'AP']);

export function listSettlementSchemes(db, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_VIEW');
  const rows = db.prepare(`SELECT * FROM finance_settlement_schemes ORDER BY side, scheme_code`).all();
  return send(res, 200, { schemes: rows });
}

export async function upsertSettlementScheme(db, req, res, actor) {
  allow(actor, 'FINANCE_RECOGNITION_POLICY_MANAGE');
  const body = await readJson(req);
  const side = requiredText(body.side, 'side', 4);
  if (!VALID_SIDE.has(side)) throw new HttpError(400, 'side 必须是 AR 或 AP');
  const schemeCode = requiredText(body.schemeCode, 'schemeCode', 64);
  const name = optionalText(body.name ?? '', 128);
  const matchMethod = optionalText(body.matchMethod ?? 'AUTO', 16);
  if (!VALID_METHOD.has(matchMethod)) throw new HttpError(400, 'matchMethod 必须是 AUTO 或 MANUAL');
  const active = body.active === undefined ? 1 : (body.active ? 1 : 0);
  const now = new Date().toISOString();
  const existing = db.prepare(`SELECT id FROM finance_settlement_schemes WHERE side=? AND scheme_code=?`).get(side, schemeCode);
  let sid;
  runInTransaction(db, () => {
    if (existing) {
      db.prepare(`UPDATE finance_settlement_schemes SET name=?, match_method=?, active=?, created_at=? WHERE id=?`)
        .run(name, matchMethod, active, now, existing.id);
      sid = existing.id;
      audit(db, actor.id, 'UPDATE', 'FINANCE_SETTLEMENT_SCHEME', sid, `${side}:${schemeCode}`);
    } else {
      sid = id();
      db.prepare(`INSERT INTO finance_settlement_schemes(id, side, scheme_code, name, match_method, active, created_at)
                   VALUES(?,?,?,?,?,?,?)`)
        .run(sid, side, schemeCode, name, matchMethod, active, now);
      audit(db, actor.id, 'CREATE', 'FINANCE_SETTLEMENT_SCHEME', sid, `${side}:${schemeCode}`);
    }
  });
  return send(res, 200, { id: sid, side, schemeCode });
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
