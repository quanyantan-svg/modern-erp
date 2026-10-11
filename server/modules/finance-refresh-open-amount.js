// V22 — Finance Operations Wave A.
//
// refreshOpenAmount(openItemId) + assertOpenAmountReconciled(openItemId).
//
// refreshOpenAmount reads the finance_open_item_effects VIEW only.
// assertOpenAmountReconciled independently recomputes canonical result
// via the same VIEW contract and compares the cached header value.

import { HttpError } from '../lib/http.js';
import { projectFinanceEffects } from './finance-open-item-effect-view.js';

export function lookupOpenItemHeader(db, openItemId) {
  for (const side of ['AR', 'AP']) {
    const table = side === 'AR' ? 'account_receivables' : 'account_payables';
    const row = db.prepare(
      `SELECT id, '${side}' AS side, amount_cents, open_amount_cents, status
         FROM ${table} WHERE id=?`
    ).get(openItemId);
    if (row) return row;
  }
  return null;
}

// Canonical equation — reads VIEW only.
//   remaining = amount_cents - SUM(effective_amount_cents)
export function computeCanonicalRemaining(db, openItemId) {
  const header = lookupOpenItemHeader(db, openItemId);
  if (!header) throw new HttpError(404, 'open item 不存在');
  const rows = projectFinanceEffects(db, header.side, openItemId);
  const effective = rows.reduce((s, r) => s + Number(r.effective_amount_cents || 0), 0);
  return Number(header.amount_cents) - effective;
}

export function refreshOpenAmount(db, openItemId) {
  const header = lookupOpenItemHeader(db, openItemId);
  if (!header) throw new HttpError(404, 'open item 不存在');
  const remaining = computeCanonicalRemaining(db, openItemId);
  const status = deriveStatus(header, remaining);
  const table = header.side === 'AR' ? 'account_receivables' : 'account_payables';
  const now = new Date().toISOString();
  if (db.isTransaction) {
    db.prepare(`UPDATE ${table} SET open_amount_cents=?, status=?, updated_at=? WHERE id=?`)
      .run(remaining, status, now, openItemId);
  } else {
    runInTransaction(db, () => {
      db.prepare(`UPDATE ${table} SET open_amount_cents=?, status=?, updated_at=? WHERE id=?`)
        .run(remaining, status, now, openItemId);
    });
  }
  return { openItemId, side: header.side, remaining, status };
}

export function assertOpenAmountReconciled(db, openItemId) {
  const header = lookupOpenItemHeader(db, openItemId);
  if (!header) throw new HttpError(404, 'open item 不存在');
  const canonical = computeCanonicalRemaining(db, openItemId);
  if (canonical !== Number(header.open_amount_cents)) {
    throw new HttpError(500, `open amount cache mismatch — fail closed (${openItemId}) canonical=${canonical} cached=${header.open_amount_cents}`);
  }
}

function deriveStatus(header, remaining) {
  if (remaining === 0 && header.status === 'WRITTEN_OFF') return 'WRITTEN_OFF';
  if (remaining === 0) return 'COMPLETED';
  if (remaining > 0 && remaining < Number(header.amount_cents)) return 'PARTIAL';
  if (remaining > 0) return 'PENDING';
  return 'PENDING';
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
