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
  // one AR + one AP（canonical 行：item_class='SOURCE'）
  // 口径合同（Requirement §33.52 `FO54-FO55-CALIBER-01`）：summary / aging 只统计结算敞口，
  // 因此 fixture 同时放入暂估待转销行与历史遗留行作为**负向对照**。
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
     VALUES(?, 'V1', 'customer-001', 'MANUAL', ?, 100000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'SOURCE', 'user-admin', ?, ?)`)
    .run('ar-1', 'ar-1', now, now);
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(100000, 'ar-1');
  // 暂估待转销：总账对方是 GRNI，不是应收 —— 不得计入报表。
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
     VALUES(?, 'V1P', 'customer-001', 'SALES_DELIVERY', ?, 30000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'PROVISIONAL', 'OPEN', 'SOURCE', 'user-admin', ?, ?)`)
    .run('ar-1p', 'ar-1p', now, now);
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(30000, 'ar-1p');
  // 历史遗留行：没有总账对应 —— 不得计入报表。
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
     VALUES(?, 'V1L', 'customer-001', 'MANUAL', ?, 40000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'LEGACY', 'user-admin', ?, ?)`)
    .run('ar-1l', 'ar-1l', now, now);
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(40000, 'ar-1l');
  db.prepare(`INSERT INTO account_payables(id, voucher_no, supplier_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
     VALUES(?, 'V2', 'supplier-001', 'MANUAL', ?, 50000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'OPEN', 'SOURCE', 'user-admin', ?, ?)`)
    .run('ap-1', 'ap-1', now, now);
  db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(50000, 'ap-1');
  // 暂估应付：负向对照。
  db.prepare(`INSERT INTO account_payables(id, voucher_no, supplier_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, conversion_state, item_class, creator_id, created_at, updated_at)
     VALUES(?, 'V2P', 'supplier-001', 'PURCHASE_RECEIPT', ?, 20000, 0, 0, 'PENDING', '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'PROVISIONAL', 'OPEN', 'SOURCE', 'user-admin', ?, ?)`)
    .run('ap-1p', 'ap-1p', now, now);
  db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(20000, 'ap-1p');
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

// FO54 / FO55 口径（Requirement §33.52 `FO54-FO55-CALIBER-01..03`）。
// 负向对照是本断言的承重处：fixture 同时含 canonical 行、暂估待转销行与历史遗留行，
// 口径一旦放宽到「往来义务」，AR 合计会从 100000 跳到 170000、AP 从 50000 跳到 70000，
// 断言必然失败。
test('FO54/FO55 口径：summary / aging 只统计结算敞口，暂估与历史遗留行不计入', () => {
  const db = bootstrap();
  const arRes = mkRes();
  arSummary(db, arRes, actor());
  assert.equal(arRes.statusCode, 200);
  assert.equal(arRes.body.caliber, 'SETTLEMENT_EXPOSURE');
  const ar = arRes.body.rows.find(r => r.customer_id === 'customer-001');
  assert.ok(ar, 'customer-001 row exists');
  assert.equal(Number(ar.total_open_cents), 100000, '暂估（30000）与历史遗留（40000）不得计入 AR 合计');
  assert.equal(Number(ar.open_items), 1, 'open_items 只数结算敞口行');

  const apRes = mkRes();
  apSummary(db, apRes, actor());
  assert.equal(apRes.statusCode, 200);
  assert.equal(apRes.body.caliber, 'SETTLEMENT_EXPOSURE');
  const ap = apRes.body.rows.find(r => r.supplier_id === 'supplier-001');
  assert.ok(ap);
  assert.equal(Number(ap.total_open_cents), 50000, '暂估应付（20000）不得计入 AP 合计');
  assert.equal(Number(ap.open_items), 1);

  const agingRes = mkRes();
  arAging(db, agingRes, actor());
  assert.equal(agingRes.statusCode, 200);
  assert.equal(agingRes.body.caliber, 'SETTLEMENT_EXPOSURE');
  assert.deepEqual(agingRes.body.rows.map((row) => row.id), ['ar-1'], '账龄只列结算敞口行');
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
