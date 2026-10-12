// V22 — Finance Operations Wave B focused tests.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from './db.js';
import { postCounterpartyTransfer } from './modules/finance-counterparty-transfer.js';
import { postBadDebtProvision } from './modules/finance-bad-debt-provision.js';
import { postSettlementReversal } from './modules/finance-settlement-reversal.js';
import { postAdvanceReceipt, postBalanceApplication } from './modules/finance-unapplied-balance.js';
import { refreshOpenAmount, assertOpenAmountReconciled } from './modules/finance-refresh-open-amount.js';

function bootstrap() {
  const db = createDatabase(':memory:');
  return db;
}

function actor(extra = []) {
  return {
    id: 'user-admin',
    permissions: [
      'FINANCE_TRANSFER_MANAGE', 'FINANCE_BAD_DEBT_MANAGE',
      'COLLECTION_MANAGE', 'PAYMENT_MANAGE', 'FINANCE_AR_VIEW', 'FINANCE_AP_VIEW',
      ...extra,
    ],
  };
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

function mkAR(db, id, customerId, amount, status = 'PENDING') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_receivables(id, voucher_no, customer_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, item_class, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, ?, ?, 'MANUAL', ?, ?, 0, 0, ?, '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'SOURCE', 'OPEN', 'user-admin', ?, ?)`)
    .run(id, `V-${id}`, customerId, id, amount, status, now, now);
  db.prepare(`UPDATE account_receivables SET open_amount_cents=? WHERE id=?`).run(amount, id);
}

function mkAP(db, id, supplierId, amount, status = 'PENDING') {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO account_payables(id, voucher_no, supplier_id, source_type, source_id,
     amount_cents, paid_cents, write_off_cents, status, due_date,
     business_date, recognition_mode, item_kind, item_class, conversion_state, creator_id, created_at, updated_at)
     VALUES(?, ?, ?, 'MANUAL', ?, ?, 0, 0, ?, '2026-12-31', '2026-01-01', 'DIRECT_BUSINESS_OPEN_ITEM', 'FINAL', 'SOURCE', 'OPEN', 'user-admin', ?, ?)`)
    .run(id, `V-${id}`, supplierId, id, amount, status, now, now);
  db.prepare(`UPDATE account_payables SET open_amount_cents=? WHERE id=?`).run(amount, id);
}

test('finance_counterparty_transfers: AR transfer creates target FINAL open item', async () => {
  const db = bootstrap();
  const custCount = db.prepare(`SELECT COUNT(*) c FROM customers WHERE id IN ('customer-001','customer-002','customer-003')`).get().c;
  assert.ok(custCount >= 1, 'customers exist');
  mkAR(db, 'ar-1', 'customer-001', 100000);
  mkAR(db, 'ar-2', 'customer-001', 50000);
  const res = mkRes();
  const req = await mkReq({
    side: 'AR',
    sourcePartyId: 'customer-001',
    targetPartyId: 'customer-002',
    businessDate: '2026-02-15',
    reason: 'customer merger',
    lines: [
      { openItemId: 'ar-1', amountCents: 60000 },
      { openItemId: 'ar-2', amountCents: 40000 },
    ],
  });
  await postCounterpartyTransfer(db, req, res, actor());
  assert.equal(res.statusCode, 200);
  const targets = db.prepare(`SELECT * FROM account_receivables WHERE customer_id='customer-002' AND source_type='FINANCE_TRANSFER'`).all();
  assert.ok(targets.length >= 1);
  const target = targets[targets.length - 1];
  assert.equal(target.item_kind, 'FINAL');
  assert.equal(target.amount_cents, 100000);
  assert.equal(target.open_amount_cents, 100000);
  assert.equal(db.prepare(`SELECT open_amount_cents FROM account_receivables WHERE id='ar-1'`).get().open_amount_cents, 40000);
  assert.equal(db.prepare(`SELECT open_amount_cents FROM account_receivables WHERE id='ar-2'`).get().open_amount_cents, 10000);
  const remainingExposure = db.prepare(`SELECT SUM(open_amount_cents) total FROM account_receivables WHERE id IN ('ar-1','ar-2',?)`).get(target.id).total;
  assert.equal(remainingExposure, 150000);
});

test('finance_counterparty_transfers: AP transfer conserves supplier exposure', async () => {
  const db = bootstrap();
  mkAP(db, 'ap-transfer-1', 'supplier-001', 70000);
  const res = mkRes();
  await postCounterpartyTransfer(db, await mkReq({
    side: 'AP', sourcePartyId: 'supplier-001', targetPartyId: 'supplier-002',
    businessDate: '2026-02-15', reason: 'supplier reassignment',
    lines: [{ openItemId: 'ap-transfer-1', amountCents: 30000 }],
  }), res, actor());
  assert.equal(res.statusCode, 200);
  const target = db.prepare("SELECT * FROM account_payables WHERE supplier_id='supplier-002' AND source_type='FINANCE_TRANSFER'").get();
  assert.equal(target.item_kind, 'FINAL'); assert.equal(target.open_amount_cents, 30000);
  const source = db.prepare("SELECT open_amount_cents FROM account_payables WHERE id='ap-transfer-1'").get();
  assert.equal(source.open_amount_cents, 40000); assert.equal(source.open_amount_cents + target.open_amount_cents, 70000);
});

test('finance_bad_debt_provisions insert + status', async () => {
  const db = bootstrap();
  mkAR(db, 'ar-bd-1', 'customer-001', 100000);
  const res = mkRes();
  const req = await mkReq({
    side: 'AR',
    method: 'INDIVIDUAL',
    openItemId: 'ar-bd-1',
    amountCents: 30000,
    businessDate: '2026-03-01',
    reason: 'overdue',
  });
  await postBadDebtProvision(db, req, res, actor());
  assert.equal(res.statusCode, 200);
  assert.ok(res.body && res.body.provisionId);
  const prov = db.prepare(`SELECT * FROM finance_bad_debt_provisions WHERE id=?`).get(res.body.provisionId);
  assert.equal(prov.status, 'CONFIRMED');
  assert.equal(prov.method, 'INDIVIDUAL');
});

test('settlement_reversal on PAYMENT reverses ALLOCATION effect', async () => {
  const db = bootstrap();
  mkAP(db, 'ap-rev-1', 'supplier-001', 100000);
  // create a payment_disbursement_items CONFIRMED line
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payment_disbursements(id, disbursement_no, supplier_id, payable_id, amount_cents, payment_method, disbursement_date, remark, creator_id, created_at, status, external_reference, reversed_amount_cents, reversal_status, settlement_account_id, unapplied_amount_cents, explicit_unapplied)
            VALUES(?,?,?,NULL,50000,'BANK','2026-02-01','','user-admin',?,'CONFIRMED','',0,'NONE',NULL,0,0)`).run('pd-rev-1', 'PD-REV-1', 'supplier-001', now);
  db.prepare(`INSERT INTO payment_disbursement_items(id, disbursement_id, payable_id, amount_cents, reversed_cents)
            VALUES(?,?,?,?,0)`).run('pdi-rev-1', 'pd-rev-1', 'ap-rev-1', 50000);
  const r0 = refreshOpenAmount(db, 'ap-rev-1');
  assert.equal(r0.remaining, 50000); // 100000 - 50000 allocation

  // now reverse
  const res = mkRes();
  const req = await mkReq({
    settlementType: 'PAYMENT',
    settlementId: 'pd-rev-1',
    amountCents: 50000,
    businessDate: '2026-03-01',
    reason: 'reversal',
    components: [
      { componentType: 'ALLOCATION', originalComponentId: 'pdi-rev-1', amountCents: 50000 },
    ],
  });
  await postSettlementReversal(db, req, res, actor());
  assert.equal(res.statusCode, 200);
  const rev = db.prepare(`SELECT * FROM settlement_reversals WHERE id=?`).get(res.body.reversalId);
  assert.ok(rev);
  assert.equal(rev.settlement_type, 'PAYMENT');
});

test('advance receipt creates PREPAYMENT unapplied balance', async () => {
  const db = bootstrap();
  const res = mkRes();
  const req = await mkReq({
    customerId: 'customer-001',
    amountCents: 200000,
    businessDate: '2026-02-10',
  });
  await postAdvanceReceipt(db, req, res, actor());
  assert.equal(res.statusCode, 200);
  // verify unapplied balance row exists
  const balances = db.prepare(`SELECT * FROM settlement_unapplied_balances WHERE side='CUSTOMER' AND balance_type='PREPAYMENT' AND party_id='customer-001'`).all();
  assert.ok(balances.length >= 1);
});

test('balance application inserts balance_application row', async () => {
  const db = bootstrap();
  mkAR(db, 'ar-app-1', 'customer-001', 100000);
  // first create an advance receipt
  const res1 = mkRes();
  await postAdvanceReceipt(db, await mkReq({ customerId: 'customer-001', amountCents: 80000, businessDate: '2026-02-10' }), res1, actor());
  const balanceId = db.prepare(`SELECT id FROM settlement_unapplied_balances WHERE side='CUSTOMER' AND party_id='customer-001' ORDER BY created_at DESC LIMIT 1`).get().id;
  const res2 = mkRes();
  const req = await mkReq({
    balanceId, side: 'AR', openItemId: 'ar-app-1',
    amountCents: 50000, businessDate: '2026-02-15',
  });
  await postBalanceApplication(db, req, res2, actor());
  assert.equal(res2.statusCode, 200);
  const apps = db.prepare(`SELECT * FROM balance_applications WHERE balance_id=?`).all(balanceId);
  assert.ok(apps.length >= 1);
});
