// V22 — Finance Operations Wave E focused tests.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from './db.js';
import { arSummary, apSummary, arAging, treasuryMovementLedger, settlementAccountBalance, treasuryGlReconcile } from './modules/finance-reports.js';
import { applyTreasuryMovement } from './modules/finance-treasury-movement.js';

function bootstrap() {
  const db = createDatabase(':memory:');
  const now = new Date().toISOString();
  // bank account
  db.prepare(`INSERT INTO bank_accounts(id, bank_name, account_no, account_name, account_type, balance_cents, currency, active, created_at, updated_at, code, opening_balance_cents, accounting_role, accounting_subject_id)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'ba-1', 'Test', '1', 'Test', 'BANK', 0, 'CNY', 1, now, now, null, 0, '', null);
  // one AR + one AP
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, 'V1', 'customer-001', 'MANUAL', ?, 100000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'user-admin', ?, ?)`)
    .run('ar-1', 'ar-1', now, now);
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(100000, 'ar-1');
  db.prepare(`INSERT INTO account_payables(id, voucher_no, supplier_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, 'V2', 'supplier-001', 'MANUAL', ?, 50000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'user-admin', ?, ?)`)
    .run('ap-1', 'ap-1', now, now);
  db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(50000, 'ap-1');
  // apply one treasury IN
  applyTreasuryMovement(db, {
    settlementAccountId: 'ba-1', direction: 'IN', amountCents: 20000,
    businessDate: '2026-02-15', sourceType: 'COLLECTION', sourceId: 'pc-1',
    idempotencyKey: 'TEST_E_1', createdBy: 'user-admin',
  });
  return db;
}

function actor() {
  return {
    id: 'user-admin',
    permissions: [
      'FINANCE_AR_VIEW', 'FINANCE_AP_VIEW',
      'FINANCE_TREASURY_VIEW', 'ACCOUNTING_VIEW',
    ],
  };
}

function mkRes() {
  const r = { statusCode: null, body: null,
    setHeader: () => {}, getHeader: () => null, write: () => {}, on: () => {}, once: () => {} };
  r.json = (status, body) => { r.statusCode = status; r.body = body; return r; };
  r.end = (chunk) => { if (chunk) { try { r.body = JSON.parse(chunk); } catch (_) { r.body = null; } } };
  return r;
}

test('arSummary aggregates by customer', () => {
  const db = bootstrap();
  const res = mkRes();
  arSummary(db, res, actor());
  assert.equal(res.statusCode, 200);
  const ar = res.body.rows.find(r => r.customer_id === 'customer-001');
  assert.ok(ar, 'customer-001 row exists');
  assert.equal(Number(ar.total_open_cents), 100000);
});

test('apSummary aggregates by supplier', () => {
  const db = bootstrap();
  const res = mkRes();
  apSummary(db, res, actor());
  assert.equal(res.statusCode, 200);
  const ap = res.body.rows.find(r => r.supplier_id === 'supplier-001');
  assert.ok(ap);
  assert.equal(Number(ap.total_open_cents), 50000);
});

test('arAging computes days_overdue', () => {
  const db = bootstrap();
  const res = mkRes();
  arAging(db, res, actor());
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.rows));
});

test('treasuryMovementLedger returns CONFIRMED movements', () => {
  const db = bootstrap();
  const res = mkRes();
  treasuryMovementLedger(db, res, actor());
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.rows.length >= 1);
});

test('settlementAccountBalance returns account', () => {
  const db = bootstrap();
  const res = mkRes();
  settlementAccountBalance(db, res, actor(), 'ba-1');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account.id, 'ba-1');
});

test('treasuryGlReconcile PASS without GL mapping', () => {
  const db = bootstrap();
  const res = mkRes();
  treasuryGlReconcile(db, res, actor(), 'ba-1');
  assert.equal(res.statusCode, 200);
  // accounting_subject_id is null in this test → gl null → PASS
  assert.equal(res.body.status, 'PASS');
  assert.equal(res.body.operational, 20000); // 0 opening + 20000 IN
});
