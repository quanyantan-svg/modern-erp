// V22 — Finance Operations Wave B.
//
// FO22 — Settlement Reversal.
//
// Backed by existing settlement_reversals / settlement_reversal_items
// tables (Phase 5 / Phase 6a migrations). This module is a thin Finance
// canonical façade that:
//   1. Locks the affected open items + settlement document
//   2. Writes settlement_reversal_items rows
//   3. Refreshes canonical open amounts (VIEW → equation → cache)
//
// Only component_type='ALLOCATION' rows reopen AR / AP open item.
// component_type='UNAPPLIED' rows only affect unapplied-balance lifecycle.

import { HttpError, allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './finance-refresh-open-amount.js';

export async function postSettlementReversal(db, req, res, actor) {
  allow(actor, 'FINANCE_MANAGE');
  const body = await readJson(req);
  const settlementType = requiredText(body.settlementType, 'settlementType', 16);
  const settlementId = requiredText(body.settlementId, 'settlementId', 64);
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const reason = requiredText(body.reason, 'reason', 256);
  const components = Array.isArray(body.components) ? body.components : [];
  if (!components.length) throw new HttpError(400, '请提供至少一条 component');

  const now = new Date().toISOString();
  const reversalId = id();
  const reversalNo = `REVERSAL-${now.slice(0, 10)}-${reversalId.slice(0, 6)}`;
  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO settlement_reversals(id, reversal_no, settlement_type, settlement_id, amount_cents, business_date, reason, status, creator_id, created_at)
       VALUES(?,?,?,?,?,?,?, 'CONFIRMED', ?, ?)`
    ).run(reversalId, reversalNo, settlementType, settlementId, amount, businessDate, reason, actor.id, now);
    const insertItem = db.prepare(
      `INSERT INTO settlement_reversal_items(id, reversal_id, component_type, original_component_id, amount_cents)
       VALUES(?,?,?,?,?)`
    );
    const affectedOpenItems = new Set();
    for (const c of components) {
      const compType = requiredText(c.componentType, 'componentType', 16);
      if (!['ALLOCATION', 'UNAPPLIED'].includes(compType)) throw new HttpError(400, 'componentType 非法');
      const origId = requiredText(c.originalComponentId, 'originalComponentId', 64);
      const compAmount = Number(c.amountCents);
      if (!Number.isSafeInteger(compAmount) || compAmount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
      insertItem.run(id(), reversalId, compType, origId, compAmount);
      // capture affected open items from ALLOCATION components only
      if (compType === 'ALLOCATION') {
        if (settlementType === 'COLLECTION') {
          const r = db.prepare(`SELECT receivable_id AS open_item_id FROM payment_collection_items WHERE id=?`).get(origId);
          if (r && r.open_item_id) affectedOpenItems.add(r.open_item_id);
        } else if (settlementType === 'PAYMENT') {
          const r = db.prepare(`SELECT payable_id AS open_item_id FROM payment_disbursement_items WHERE id=?`).get(origId);
          if (r && r.open_item_id) affectedOpenItems.add(r.open_item_id);
        }
      }
    }
    audit(db, actor.id, 'SETTLEMENT_REVERSAL', 'FINANCE_SETTLEMENT_REVERSAL', reversalId, reversalNo);
    // refresh open amounts
    for (const oi of affectedOpenItems) refreshOpenAmount(db, oi);
    for (const oi of affectedOpenItems) assertOpenAmountReconciled(db, oi);
  });
  return send(res, 200, { reversalId, reversalNo });
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
