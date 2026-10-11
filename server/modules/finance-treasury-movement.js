// V22 — Finance Operations Wave D.
//
// FO39 / FO40 / FO41 — Canonical Treasury Movement + Cash/Bank Transfer.
//
// applyTreasuryMovement is the SINGLE canonical writer for finance_treasury_movements.
// Every collection / payment / refund / settlement-reversal / cash-deposit /
// withdrawal / bank-transfer / notes-settlement must delegate here.
//
//   opening_balance_cents
//   + SUM(CONFIRMED IN)
//   - SUM(CONFIRMED OUT)
//   = canonical balance
//
// refreshSettlementAccountBalance(id) recomputes and refreshes bank_accounts.balance_cents.

import { HttpError, allow, send, readJson, requiredText } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { id } from '../db.js';

export function applyTreasuryMovement(db, input) {
  const settlementAccountId = requiredText(input.settlementAccountId, 'settlementAccountId', 64);
  const direction = requiredText(input.direction, 'direction', 4);
  if (!['IN', 'OUT'].includes(direction)) throw new HttpError(400, 'direction 必须是 IN 或 OUT');
  const amountCents = Number(input.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(input.businessDate, 'businessDate', 16);
  const sourceType = requiredText(input.sourceType, 'sourceType', 32);
  const sourceId = requiredText(input.sourceId, 'sourceId', 64);
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 256);
  const movementGroupId = input.movementGroupId || idempotencyKey;

  const movementId = id();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO finance_treasury_movements(
       id, settlement_account_id, direction, amount_cents, business_date,
       source_type, source_id, counterparty_type, counterparty_id, external_reference,
       reversal_of_movement_id, movement_group_id, accounting_event_id, status, idempotency_key,
       created_by, created_at)
     VALUES(
       $id, $sa, $d, $a, $bd, $st, $si, $ct, $ci, $er, $rev, $mg, $ae, 'CONFIRMED', $ik, $cb, $ca)`
  ).run({
    $id: movementId, $sa: settlementAccountId, $d: direction, $a: amountCents, $bd: businessDate,
    $st: sourceType, $si: sourceId, $ct: input.counterpartyType || '', $ci: input.counterpartyId || '', $er: input.externalReference || '',
    $rev: input.reversalOfMovementId || null, $mg: movementGroupId, $ae: input.accountingEventId || null,
    $ik: idempotencyKey, $cb: input.createdBy || 'system', $ca: now,
  });
  refreshSettlementAccountBalance(db, settlementAccountId);
  audit(db, input.createdBy || 'system', 'TREASURY_MOVEMENT', movementId, idempotencyKey);
  return movementId;
}

export function refreshSettlementAccountBalance(db, accountId) {
  const opening = Number(db.prepare(`SELECT COALESCE(opening_balance_cents, 0) AS ob FROM bank_accounts WHERE id=?`).get(accountId)?.ob || 0);
  const inSum = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM finance_treasury_movements WHERE settlement_account_id=? AND direction='IN' AND status='CONFIRMED'`).get(accountId)?.s || 0;
  const outSum = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM finance_treasury_movements WHERE settlement_account_id=? AND direction='OUT' AND status='CONFIRMED'`).get(accountId)?.s || 0;
  const balance = opening + Number(inSum) - Number(outSum);
  db.prepare(`UPDATE bank_accounts SET balance_cents=?, updated_at=? WHERE id=?`).run(balance, new Date().toISOString(), accountId);
  return balance;
}

export function assertBalanceReconciled(db, accountId) {
  const opening = Number(db.prepare(`SELECT COALESCE(opening_balance_cents, 0) AS ob FROM bank_accounts WHERE id=?`).get(accountId)?.ob || 0);
  const inSum = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM finance_treasury_movements WHERE settlement_account_id=? AND direction='IN' AND status='CONFIRMED'`).get(accountId)?.s || 0);
  const outSum = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS s FROM finance_treasury_movements WHERE settlement_account_id=? AND direction='OUT' AND status='CONFIRMED'`).get(accountId)?.s || 0);
  const canonical = opening + inSum - outSum;
  const cached = Number(db.prepare(`SELECT balance_cents FROM bank_accounts WHERE id=?`).get(accountId)?.balance_cents || 0);
  if (canonical !== cached) {
    throw new HttpError(500, `treasury balance mismatch — fail closed (account=${accountId}, canonical=${canonical}, cached=${cached})`);
  }
}

export async function postTreasuryTransfer(db, req, res, actor) {
  // FO41 — paired movements (cash → bank, bank → cash, bank → bank).
  allow(actor, 'FINANCE_TREASURY_MANAGE');
  const body = await readJson(req);
  const fromAccountId = requiredText(body.fromAccountId, 'fromAccountId', 64);
  const toAccountId = requiredText(body.toAccountId, 'toAccountId', 64);
  if (fromAccountId === toAccountId) throw new HttpError(400, 'from / to account 必须不同');
  const amount = Number(body.amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'amountCents 必须为正整数');
  const businessDate = requiredText(body.businessDate, 'businessDate', 16);
  const reason = requiredText(body.reason ?? 'internal transfer', 'reason', 256);
  const now = new Date().toISOString();
  const groupId = `TRANSFER-${now}-${id().slice(0, 6)}`;
  // deterministic lock order: sort ASC
  const accounts = [fromAccountId, toAccountId].sort();
  db.exec('BEGIN IMMEDIATE');
  try {
    // apply OUT then IN
    applyTreasuryMovement(db, {
      settlementAccountId: fromAccountId, direction: 'OUT', amountCents: amount,
      businessDate, sourceType: 'TREASURY_TRANSFER', sourceId: groupId,
      idempotencyKey: `TREASURY_TRANSFER:${groupId}:OUT`, movementGroupId: groupId,
      createdBy: actor.id,
    });
    applyTreasuryMovement(db, {
      settlementAccountId: toAccountId, direction: 'IN', amountCents: amount,
      businessDate, sourceType: 'TREASURY_TRANSFER', sourceId: groupId,
      idempotencyKey: `TREASURY_TRANSFER:${groupId}:IN`, movementGroupId: groupId,
      createdBy: actor.id,
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  audit(db, actor.id, 'TREASURY_TRANSFER', groupId, reason);
  return send(res, 200, { movementGroupId: groupId });
}
