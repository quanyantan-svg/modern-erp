// V22 — Finance Operations Wave A.
//
// FO06 — AR initialization (opening migration).

import { allow, send } from '../lib/http.js';
import { id } from '../db.js';
import { audit } from '../lib/audit.js';

export function listArInitialization(db, res, actor) {
  allow(actor, 'AR_VIEW', 'FINANCE_VIEW');
  const rows = db.prepare(`SELECT id, voucher_no, customer_id, amount_cents, business_date FROM account_receivables WHERE source_type='OPENING' ORDER BY business_date DESC`).all();
  return send(res, 200, { openings: rows });
}

export function postArOpening(db, body, actor) {
  allow(actor, 'AR_VIEW', 'FINANCE_MANAGE');
  const openingId = id();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO account_receivables(
       id, voucher_no, customer_id, source_type, source_id,
       amount_cents, amount_cents, paid_cents, write_off_cents,
       status, due_date, business_date, recognition_mode, item_kind,
       conversion_state, settlement_account_id,
       creator_id, created_at, updated_at)
     VALUES(?,?,?, 'OPENING', ?, ?, ?, 0, 0, 'PENDING', ?, ?, 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', NULL, ?, ?, ?)`
  ).run(
    openingId, `OPENING-${openingId.slice(0, 6)}`, body.customerId, openingId,
    body.amountCents, body.amountCents, body.businessDate, body.businessDate,
    actor.id, now, now,
  );
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(body.amountCents, openingId);
  audit(db, actor.id, 'OPENING', 'ACCOUNT_RECEIVABLE', openingId, body.businessDate);
  return openingId;
}
