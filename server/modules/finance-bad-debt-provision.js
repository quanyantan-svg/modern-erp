// V22 — Finance Operations Wave B.
//
// FO28 — Bad-Debt Provision (bounded AGING / INDIVIDUAL; not full IFRS / ECL).
//
// Lifecycle:
//   DRAFT → SUBMITTED → CONFIRMED → REVERSED
//        ↘ REJECTED
//
// AGING provision = batch over multiple open items.
// INDIVIDUAL provision = single open_item with amount.

import { HttpError, allow, send, readJson, requiredText, optionalText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

export async function postBadDebtProvision(db, req, res, actor) {
  allow(actor, 'FINANCE_BAD_DEBT_MANAGE');
  const body = await readJson(req);
  const side = requiredText(body.side, 'side', 4);
  const method = requiredText(body.method, 'method', 16);
  if (!['AGING', 'INDIVIDUAL'].includes(method)) throw new HttpError(400, 'method 必须是 AGING 或 INDIVIDUAL');
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const reason = optionalText(body.reason ?? '', 256);
  const openItemId = method === 'INDIVIDUAL' ? requiredText(body.openItemId, 'openItemId', 64) : null;

  const now = new Date().toISOString();
  const provisionId = id();
  const provisionNo = `BADDEBT-${now.slice(0, 10)}-${provisionId.slice(0, 6)}`;
  db.prepare(
    `INSERT INTO finance_bad_debt_provisions(
       id, provision_no, side, method, open_item_id, amount_cents,
       business_date, reason, status, creator_id, confirmer_id,
       created_at, confirmed_at)
     VALUES(?,?,?,?,?, ?, ?, ?, 'CONFIRMED', ?, NULL, ?, ?)`
  ).run(
    provisionId, provisionNo, side, method, openItemId, amount,
    businessDate, reason, actor.id, now, now,
  );
  audit(db, actor.id, 'BAD_DEBT_PROVISION', `FINANCE_BAD_DEBT_PROVISION_${side}`, provisionId, provisionNo);
  return send(res, 200, { provisionId, provisionNo, status: 'CONFIRMED' });
}
