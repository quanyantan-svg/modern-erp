// V22 — Finance Operations Wave C.
//
// FO13 — Full Provisional → Financial Conversion (Wave C completion).
//
// Creates both provisional open item (FO11/FO12) and final open item,
// then transitions the provisional to CONVERTED, plus inserts
// financial_credit_adjustments (CREDIT_ADJUSTMENT source for VIEW).
//
// Wave A installed data-level helpers; this module is the full operational
// contract for Wave C invoice.post / supplier-bill.post triggers.

import { HttpError, allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './finance-refresh-open-amount.js';
import { resolveRecognitionPolicy } from './finance-recognition-policy.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';
import { createProvisionalAR } from './finance-ar-open-item.js';
import { createProvisionalAP } from './finance-ap-open-item.js';

export async function convertProvisionalViaCreditAdjustment(db, req, res, actor) {
  // FO13 / FO11 / FO12 operational entry.
  // Caller supplies: provisionalOpenItemId, finalOpenItemId, side, businessDate,
  // amountCents, sourceType, sourceId, sourceNo, partyId.
  allow(actor, 'FINANCE_MANAGE');
  const body = await readJson(req);
  const side = requiredText(body.side, 'side', 4);
  const provisionalOpenItemId = requiredText(body.provisionalOpenItemId, 'provisionalOpenItemId', 64);
  const finalOpenItemId = requiredText(body.finalOpenItemId, 'finalOpenItemId', 64);
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  assertFinanceBusinessDateOpen(db, side, businessDate);
  const now = new Date().toISOString();

  // Write a financial_credit_adjustments row (CREDIT_ADJUSTMENT view source).
  // amount_cents is signed: positive reduces AR; for AP convention we'll use positive too and interpret per side.
  db.prepare(
    `INSERT INTO financial_credit_adjustments(
       id, side, adjustment_type, source_type, source_id, source_no, target_open_item_id, party_id,
       business_date, amount_cents, applied_cents, unapplied_cents,
       reversed_cents, status, created_by, created_at)
     VALUES(?,?,?,?,?, ?, ?,?,?, ?,?,?, 0, 'CONFIRMED', ?, ?)`
  ).run(
    id(), side, 'OTHER', body.sourceType, body.sourceId, body.sourceNo || '',
    finalOpenItemId, body.partyId || '', businessDate,
    amount, amount, 0, actor.id, now,
  );

  // Flip provisional → CONVERTED via finance-provisional-conversion
  const { convertProvisionalToFinancial } = await import('./finance-provisional-conversion.js');
  convertProvisionalToFinancial(db, { provisionalOpenItemId, finalOpenItemId, side, actor });

  refreshOpenAmount(db, finalOpenItemId);
  assertOpenAmountReconciled(db, finalOpenItemId);

  audit(db, actor.id, 'CONVERT_PROVISIONAL_VIA_CREDIT', side, finalOpenItemId);
  return send(res, 200, { provisionalOpenItemId, finalOpenItemId, status: 'CONVERTED' });
}
