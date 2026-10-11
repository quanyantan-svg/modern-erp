// V22 — Finance Operations Wave B.
//
// FO15 — AR / AP Counterparty Transfer.
//
// Canonical execution:
//   1. lock source open items (sort ASC)
//   2. create target_party FINAL open item (DIRECT_BUSINESS_OPEN_ITEM,
//      source_type=FINANCE_TRANSFER, source_id=transfer_id)
//   3. write finance_open_item_effects-equivalent evidence via existing
//      source tables (allocation via financial_credit_adjustments + reverse)
//   4. audit
//
// total exposure conserved: source_open_item.cents == target_open_item.cents
// MUST NOT mutate original open_item.party_id in place.

import { HttpError, allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './finance-refresh-open-amount.js';
import { resolveRecognitionPolicy } from './finance-recognition-policy.js';
import { assertFinanceBusinessDateOpen } from './finance-business-close.js';

export async function postCounterpartyTransfer(db, req, res, actor) {
  allow(actor, 'FINANCE_TRANSFER_MANAGE');
  const body = await readJson(req);
  const side = requiredText(body.side, 'side', 4);
  const sourcePartyId = requiredText(body.sourcePartyId, 'sourcePartyId', 64);
  const targetPartyId = requiredText(body.targetPartyId, 'targetPartyId', 64);
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const reason = requiredText(body.reason, 'reason', 256);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw new HttpError(400, '请提供至少一条 transfer line');
  if (sourcePartyId === targetPartyId) throw new HttpError(400, 'source / target party 必须不同');

  assertFinanceBusinessDateOpen(db, side, businessDate);
  const now = new Date().toISOString();
  const transferId = id();
  const transferNo = `TRANSFER-${now.slice(0, 10)}-${transferId.slice(0, 6)}`;

  let totalCents = 0;
  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO finance_counterparty_transfers(id, transfer_no, side, source_party_id, target_party_id,
        business_date, reason, status, creator_id, confirmer_id, created_at, confirmed_at)
       VALUES(?,?,?,?,?, ?, ?, 'CONFIRMED', ?, NULL, ?, ?)`
    ).run(
      transferId, transferNo, side, sourcePartyId, targetPartyId,
      businessDate, reason, actor.id, now, now,
    );
    const insertLine = db.prepare(
      `INSERT INTO finance_counterparty_transfer_lines(id, transfer_id, side, source_open_item_id, amount_cents)
       VALUES(?,?,?,?,?)`
    );
    const openItems = [];
    for (const ln of lines) {
      const openItemId = requiredText(ln.openItemId, 'openItemId', 64);
      const amount = Number(ln.amountCents);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
      // verify source open item exists and not mutated in place
      const headerTable = side === 'AR' ? 'account_receivables' : 'account_payables';
      const openItem = db.prepare(`SELECT id, ${side === 'AR' ? 'customer_id' : 'supplier_id'} AS party_id, open_amount_cents FROM ${headerTable} WHERE id=?`).get(openItemId);
      if (!openItem) throw new HttpError(404, 'source open item 不存在');
      if (openItem.party_id !== sourcePartyId) {
        throw new HttpError(409, 'source open item 不属于 source party');
      }
      if (amount > openItem.open_amount_cents) throw new HttpError(409, 'transfer amount 超过 open item remaining');
      insertLine.run(id(), transferId, side, openItemId, amount);
      openItems.push({ openItemId, amount });
      totalCents += amount;
    }
    // create target party FINAL open item
    const policy = resolveRecognitionPolicy(db, side, 'FINANCE_TRANSFER', targetPartyId, businessDate);
    const targetItemId = id();
    db.prepare(
      `INSERT INTO account_${side === 'AR' ? 'receivables' : 'payables'}(
         id, voucher_no, ${side === 'AR' ? 'customer_id' : 'supplier_id'}, source_type, source_id,
         amount_cents, paid_cents, write_off_cents, status, due_date, business_date,
         recognition_mode, item_kind, conversion_state, settlement_account_id,
         creator_id, created_at, updated_at)
       VALUES(?,?,?, 'FINANCE_TRANSFER', ?, ?, 0, 0, 'PENDING', ?, ?, ?, 'FINAL', 'OPEN', NULL, ?, ?, ?)`
    ).run(
      targetItemId, transferNo, targetPartyId, transferId,
      totalCents, businessDate, businessDate,
      policy.mode, actor.id, now, now,
    );
    db.prepare(`UPDATE account_${side === 'AR' ? 'receivables' : 'payables'} SET open_amount_cents=? WHERE id=?`).run(totalCents, targetItemId);
    audit(db, actor.id, 'COUNTERPARTY_TRANSFER', `FINANCE_COUNTERPARTY_TRANSFER_${side}`, transferId, transferNo);

    // refresh canonical open amounts (still inside outer transaction;
    // refreshOpenAmount detects inTransaction and skips nested BEGIN).
    for (const oi of openItems) refreshOpenAmount(db, oi.openItemId);
    refreshOpenAmount(db, targetItemId);
    for (const oi of openItems) assertOpenAmountReconciled(db, oi.openItemId);
    assertOpenAmountReconciled(db, targetItemId);
  });
  return send(res, 200, { transferId, transferNo, totalCents });
}

function runInTransaction(db, fn) {
  if (db.isTransaction) { fn(); return; }
  db.exec('BEGIN IMMEDIATE');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
