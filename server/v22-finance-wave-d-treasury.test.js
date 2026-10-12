// V22 — Finance Operations Wave D focused tests.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from './db.js';
import { applyTreasuryMovement, refreshSettlementAccountBalance, assertBalanceReconciled, postTreasuryTransfer } from './modules/finance-treasury-movement.js';
import { postTreasuryOpening } from './modules/finance-treasury-init.js';

function bootstrap() {
  const db = createDatabase(':memory:');
  // create bank_account rows for tests
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO bank_accounts(id, bank_name, account_no, account_name, account_type, balance_cents, currency, active, created_at, updated_at, code, opening_balance_cents, accounting_role, accounting_subject_id)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ba-1', 'Test Bank', '1234', 'Test Account', 'BANK', 0, 'CNY', 1, now, now, null, 100000, '', null);
  db.prepare(`INSERT INTO bank_accounts(id, bank_name, account_no, account_name, account_type, balance_cents, currency, active, created_at, updated_at, code, opening_balance_cents, accounting_role, accounting_subject_id)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ba-2', 'Test Bank 2', '5678', 'Test Account 2', 'BANK', 0, 'CNY', 1, now, now, null, 50000, '', null);
  return db;
}

function mkRes() {
  const r = {
    statusCode: null, body: null,
    setHeader: () => {}, getHeader: () => null,
    write: () => {}, on: () => {}, once: () => {},
  };
  r.end = (chunk) => { if (chunk) { try { r.body = JSON.parse(chunk); } catch (_) { r.body = null; } } };
  return r;
}

async function mkReq(body) {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return {
    headers: { 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; },
  };
}

function actor() {
  return { id: 'user-admin', permissions: ['FINANCE_TREASURY_MANAGE'] };
}

test('applyTreasuryMovement: IN increments balance', () => {
  const db = bootstrap();
  applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'IN', amountCents: 30000,
    businessDate: '2026-02-15', sourceType: 'COLLECTION', sourceId: 'pc-1',
    idempotencyKey: 'TEST_IN_1', createdBy: 'user-admin',
  });
  const bal = refreshSettlementAccountBalance(db, 'ba-1');
  assert.equal(bal, 130000); // 100000 opening + 30000 IN
});

test('Treasury initialization persists opening on canonical settlement account', async () => {
  const db = bootstrap(); const res = mkRes();
  await postTreasuryOpening(db, await mkReq({ accountId: 'ba-1', openingBalanceCents: 125000, businessDate: '2026-01-01' }), res, actor());
  assert.equal(res.statusCode, 200);
  const account = db.prepare("SELECT opening_balance_cents,balance_cents FROM bank_accounts WHERE id='ba-1'").get();
  assert.equal(account.opening_balance_cents, 125000); assert.equal(account.balance_cents, 125000);
});

test('applyTreasuryMovement: OUT decrements balance', () => {
  const db = bootstrap();
  applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'IN', amountCents: 50000,
    businessDate: '2026-02-15', sourceType: 'COLLECTION', sourceId: 'pc-1',
    idempotencyKey: 'TEST_IN_2', createdBy: 'user-admin',
  });
  applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'OUT', amountCents: 20000,
    businessDate: '2026-02-20', sourceType: 'PAYMENT', sourceId: 'pd-1',
    idempotencyKey: 'TEST_OUT_1', createdBy: 'user-admin',
  });
  const bal = refreshSettlementAccountBalance(db, 'ba-1');
  assert.equal(bal, 130000); // 100000 + 50000 - 20000
});

test('postTreasuryTransfer: paired IN/OUT movements conserve total', async () => {
  const db = bootstrap();
  const res = mkRes();
  const req = await mkReq({
    fromAccountId: 'ba-1', toAccountId: 'ba-2',
    amountCents: 25000, businessDate: '2026-03-01', reason: 'transfer',
  });
  await postTreasuryTransfer(db, req, res, actor());
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.movementGroupId);
  const from = refreshSettlementAccountBalance(db, 'ba-1');
  const to = refreshSettlementAccountBalance(db, 'ba-2');
  assert.equal(from, 75000); // 100000 - 25000
  assert.equal(to, 75000); // 50000 + 25000
});

test('assertBalanceReconciled: mismatch fail closed', () => {
  const db = bootstrap();
  applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'IN', amountCents: 10000,
    businessDate: '2026-02-15', sourceType: 'COLLECTION', sourceId: 'pc-2',
    idempotencyKey: 'TEST_IN_3', createdBy: 'user-admin',
  });
  // intentionally break the cached balance to simulate drift
  db.prepare(`UPDATE bank_accounts SET balance_cents=999999 WHERE id='ba-1'`).run();
  let threw = false;
  try { assertBalanceReconciled(db, 'ba-1'); }
  catch (e) { threw = true; assert.match(e.message, /mismatch/); }
  assert.equal(threw, true);
});

test('applyTreasuryMovement idempotency: same key returns existing row', () => {
  const db = bootstrap();
  const m1 = applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'IN', amountCents: 5000,
    businessDate: '2026-02-15', sourceType: 'COLLECTION', sourceId: 'pc-3',
    idempotencyKey: 'IDEM_KEY_1', createdBy: 'user-admin',
  });
  const m2 = applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'IN', amountCents: 5000,
    businessDate: '2026-02-15', sourceType: 'COLLECTION', sourceId: 'pc-3',
    idempotencyKey: 'IDEM_KEY_1', createdBy: 'user-admin',
  });
  assert.equal(m2, m1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE idempotency_key='IDEM_KEY_1'").get().n, 1);
});
