import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { applyCreditAdjustment, ensurePayableSource, ensureReceivableSource, openItemSnapshot, unappliedBalanceSnapshot } from './modules/settlement-core.js';
import { createTempDb } from './test-utils/temp-db.js';

describe('V1.3 Phase 6A financial and transaction controls', () => {
  let handle; let db; let server; let base; const tokens = {};
  const request = (path, role, method = 'GET', body, key) => fetch(base + path, { method, headers: { ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const post = (path, role, body = {}, key) => request(path, role, 'POST', body, key);
  const settlement = async (kind, partyKey, partyId, amount, allocations = [], unapplied = 0, method = 'BANK') => {
    const path = kind === 'COLLECTION' ? '/api/payment-collections' : '/api/payment-disbursements';
    const body = { [partyKey]: partyId, businessDate: '2026-09-20', amountCents: amount, paymentMethod: method, settlementAccountId: method === 'BANK' ? 'phase6-bank' : 'subject-001', allocations, unappliedAmountCents: unapplied, explicitUnapplied: unapplied > 0 };
    const createdResponse = await post(path, 'accounting', body); assert.equal(createdResponse.status, 201, JSON.stringify(await createdResponse.clone().json()));
    const created = await createdResponse.json(); const confirmed = await post(`${path}/${created.id}/confirm`, 'accounting', {}, `confirm-${created.id}`);
    assert.equal(confirmed.status, 200, JSON.stringify(await confirmed.clone().json())); return created;
  };

  before(async () => {
    handle = createTempDb({ label: 'v13-p6a' }); db = handle.db;
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at) VALUES('phase6-bank','测试银行','P6A-001','Phase 6A 结算户','CHECKING',0,'CNY',1,?,?)").run(stamp, stamp);
    server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, password] of [['admin', 'admin123'], ['accounting', 'accounting123'], ['warehouse', 'warehouse123']]) tokens[name] = (await (await post('/api/auth/login', null, { username: name, password })).json()).token;
  });
  after(async () => { await new Promise((done, fail) => server.close((e) => e ? fail(e) : done())); handle.cleanup(); });

  test('schema is additive, durable, and keeps five canonical roles', () => {
    for (const table of ['settlement_unapplied_balances', 'balance_applications', 'financial_refunds', 'financial_write_offs', 'return_reversals', 'settlement_account_movements', 'idempotency_records', 'period_reopen_history']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM roles').get().n, 5);
  });

  test('explicit customer cash prepayment creates no fake AR and applies to a later AR without cash movement', async () => {
    const beforeAr = db.prepare('SELECT COUNT(*) n FROM account_receivables').get().n;
    await settlement('COLLECTION', 'customerId', 'customer-001', 5000, [], 5000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM account_receivables').get().n, beforeAr);
    const balance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE side='CUSTOMER' AND balance_type='PREPAYMENT' ORDER BY created_at DESC").get();
    const ar = ensureReceivableSource(db, { id: 'p6-later-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-LATER', partyId: 'customer-001', businessDate: '2026-09-21', effectCents: 8000, creatorId: 'user-sales' });
    const movements = db.prepare('SELECT COUNT(*) n FROM settlement_account_movements').get().n;
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', balanceId: balance.id, openItemId: ar, amountCents: 5000, businessDate: '2026-09-21' })).status, 201);
    assert.equal(openItemSnapshot(db, 'AR', ar).openCents, 3000); assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM settlement_account_movements').get().n, movements);
    const wrong = ensureReceivableSource(db, { id: 'p6-wrong-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-WRONG', partyId: 'customer-002', businessDate: '2026-09-21', effectCents: 1000, creatorId: 'user-sales' });
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', balanceId: balance.id, openItemId: wrong, amountCents: 1, businessDate: '2026-09-21' })).status, 409);
  });

  test('supplier prepayment is symmetric and over-application is refused with zero side effect', async () => {
    await settlement('PAYMENT', 'supplierId', 'supplier-001', 2000, [], 2000);
    const balance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE side='SUPPLIER' ORDER BY created_at DESC").get();
    const ap = ensurePayableSource(db, { id: 'p6-later-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-P6-LATER', partyId: 'supplier-001', businessDate: '2026-09-21', effectCents: 6000, creatorId: 'user-sales' });
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AP', balanceId: balance.id, openItemId: ap, amountCents: 2001, businessDate: '2026-09-21' })).status, 409);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 6000); assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 2000);
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AP', balanceId: balance.id, openItemId: ap, amountCents: 2000, businessDate: '2026-09-21' })).status, 201);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 4000);
  });

  test('unapplied return credit never auto-applies and explicit application is reversible', async () => {
    const settled = ensureReceivableSource(db, { id: 'p6-settled-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-SETTLED', partyId: 'customer-001', businessDate: '2026-09-22', effectCents: 1000, creatorId: 'user-sales' });
    await settlement('COLLECTION', 'customerId', 'customer-001', 1000, [{ receivableId: settled, amountCents: 1000 }]);
    const credit = applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: 'p6-credit-source', sourceNo: 'SRET-P6', targetOpenItemId: settled, partyId: 'customer-001', businessDate: '2026-09-22', amountCents: 2000, actorId: 'user-accounting' });
    const later = ensureReceivableSource(db, { id: 'p6-credit-target', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-CREDIT-TARGET', partyId: 'customer-001', businessDate: '2026-09-23', effectCents: 10000, creatorId: 'user-sales' });
    assert.equal(openItemSnapshot(db, 'AR', later).openCents, 10000);
    const applied = await (await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', creditId: credit.id, openItemId: later, amountCents: 2000, businessDate: '2026-09-23' })).json();
    assert.equal(openItemSnapshot(db, 'AR', later).openCents, 8000);
    assert.equal((await post(`/api/settlement/balance-applications/${applied.id}/reverse`, 'accounting', { reason: '测试冲销' })).status, 200);
    assert.equal(openItemSnapshot(db, 'AR', later).openCents, 10000);
  });

  test('customer refund enforces source balance, preserves account linkage, reverses, and is idempotent', async () => {
    await settlement('COLLECTION', 'customerId', 'customer-002', 2000, [], 2000);
    const balance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE party_id='customer-002' ORDER BY created_at DESC").get();
    const body = { side: 'CUSTOMER', balanceId: balance.id, partyId: 'customer-002', amountCents: 1000, businessDate: '2026-09-24', settlementAccountId: 'phase6-bank', paymentMethod: 'BANK', reason: '退回多收款', reference: 'REF-1' };
    const first = await post('/api/financial-refunds', 'accounting', body, 'refund-key-1'); assert.equal(first.status, 201); const result = await first.json();
    const replay = await post('/api/financial-refunds', 'accounting', body, 'refund-key-1'); assert.equal(replay.status, 200); assert.equal((await replay.json()).id, result.id);
    assert.equal((await post('/api/financial-refunds', 'accounting', { ...body, amountCents: 1001 }, 'refund-key-2')).status, 409);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 1000);
    assert.equal((await post(`/api/financial-refunds/${result.id}/reverse`, 'accounting', { businessDate: '2026-09-25', reason: '银行退票' }, 'refund-reverse-key')).status, 201);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 2000);
    await settlement('PAYMENT', 'supplierId', 'supplier-002', 1500, [], 1500);
    const supplierBalance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE party_id='supplier-002' ORDER BY created_at DESC").get();
    const supplierRefund = await post('/api/financial-refunds', 'accounting', { side: 'SUPPLIER', balanceId: supplierBalance.id, partyId: 'supplier-002', amountCents: 500, businessDate: '2026-09-25', settlementAccountId: 'phase6-bank', paymentMethod: 'BANK', reason: '供应商退回预付款' }, 'supplier-refund-key');
    assert.equal(supplierRefund.status, 201); assert.equal(unappliedBalanceSnapshot(db, supplierBalance.id).remainingCents, 1000);
  });

  test('partial collection reversal targets exact allocation and never exceeds original', async () => {
    const a = ensureReceivableSource(db, { id: 'p6-rev-a', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-A', partyId: 'customer-003', businessDate: '2026-09-20', effectCents: 60000, creatorId: 'user-sales' });
    const b = ensureReceivableSource(db, { id: 'p6-rev-b', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-B', partyId: 'customer-003', businessDate: '2026-09-20', effectCents: 35000, creatorId: 'user-sales' });
    const collection = await settlement('COLLECTION', 'customerId', 'customer-003', 95000, [{ receivableId: a, amountCents: 60000 }, { receivableId: b, amountCents: 35000 }]);
    const allocation = db.prepare('SELECT id FROM payment_collection_items WHERE collection_id=? AND receivable_id=?').get(collection.id, a);
    assert.equal((await post(`/api/payment-collections/${collection.id}/reverse`, 'accounting', { businessDate: '2026-09-25', reason: '部分退票', components: [{ type: 'ALLOCATION', id: allocation.id, amountCents: 10000 }] }, 'partial-reverse-1')).status, 201);
    assert.equal(openItemSnapshot(db, 'AR', a).openCents, 10000); assert.equal(openItemSnapshot(db, 'AR', b).openCents, 0);
    assert.equal(db.prepare('SELECT reversed_amount_cents FROM payment_collections WHERE id=?').get(collection.id).reversed_amount_cents, 10000);
    assert.equal((await post(`/api/payment-collections/${collection.id}/reverse`, 'accounting', { businessDate: '2026-09-25', reason: '超额', components: [{ type: 'ALLOCATION', id: allocation.id, amountCents: 60000 }] }, 'partial-reverse-2')).status, 409);
    const ap = ensurePayableSource(db, { id: 'p6-payment-rev', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-P6-REV', partyId: 'supplier-003', businessDate: '2026-09-20', effectCents: 13000, creatorId: 'user-sales' });
    const payment = await settlement('PAYMENT', 'supplierId', 'supplier-003', 13000, [{ payableId: ap, amountCents: 13000 }]);
    const paymentAllocation = db.prepare('SELECT id FROM payment_disbursement_items WHERE disbursement_id=?').get(payment.id);
    assert.equal((await post(`/api/payment-disbursements/${payment.id}/reverse`, 'accounting', { businessDate: '2026-09-25', reason: '部分付款退回', components: [{ type: 'ALLOCATION', id: paymentAllocation.id, amountCents: 3000 }] }, 'payment-partial-reverse')).status, 201);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 3000);
  });

  test('write-off requires independent admin confirmation and reversal restores open amount', async () => {
    const ar = ensureReceivableSource(db, { id: 'p6-writeoff-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-WO', partyId: 'customer-001', businessDate: '2026-09-20', effectCents: 5000, creatorId: 'user-sales' });
    const created = await (await post('/api/financial-write-offs', 'accounting', { side: 'AR', openItemId: ar, amountCents: 1000, businessDate: '2026-09-25', reason: '小额尾差' })).json();
    assert.equal((await post(`/api/financial-write-offs/${created.id}/submit`, 'accounting')).status, 200);
    assert.equal((await post(`/api/financial-write-offs/${created.id}/confirm`, 'accounting', {}, 'wo-self')).status, 403);
    assert.equal((await post(`/api/financial-write-offs/${created.id}/confirm`, 'admin', {}, 'wo-confirm')).status, 200);
    assert.equal(openItemSnapshot(db, 'AR', ar).openCents, 4000);
    assert.equal((await post(`/api/financial-write-offs/${created.id}/reverse`, 'accounting', { amountCents: 1000, businessDate: '2026-09-26', reason: '核销依据撤销' })).status, 201);
    assert.equal(openItemSnapshot(db, 'AR', ar).openCents, 5000);
    const ap = ensurePayableSource(db, { id: 'p6-writeoff-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-P6-WO', partyId: 'supplier-001', businessDate: '2026-09-20', effectCents: 2500, creatorId: 'user-sales' });
    const apWriteOff = await (await post('/api/financial-write-offs', 'accounting', { side: 'AP', openItemId: ap, amountCents: 500, businessDate: '2026-09-25', reason: '供应商尾差' })).json();
    await post(`/api/financial-write-offs/${apWriteOff.id}/submit`, 'accounting'); assert.equal((await post(`/api/financial-write-offs/${apWriteOff.id}/confirm`, 'admin', {}, 'ap-wo-confirm')).status, 200);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 2000);
  });

  test('sales and purchase return reversals are partial, linked, atomic, and dependency-safe', async () => {
    const stamp = new Date().toISOString();
    const seedReturn = (side) => {
      const sales = side === 'SALES'; const returnId = `p6-${side.toLowerCase()}-return`; const sourceId = `p6-${side.toLowerCase()}-open`;
      const openId = sales
        ? ensureReceivableSource(db, { id: sourceId, sourceType: 'SALES_DELIVERY', sourceNo: `SRC-${side}`, partyId: 'customer-001', businessDate: '2026-09-20', effectCents: 5000, creatorId: 'user-sales' })
        : ensurePayableSource(db, { id: sourceId, sourceType: 'PURCHASE_RECEIPT', sourceNo: `SRC-${side}`, partyId: 'supplier-001', businessDate: '2026-09-20', effectCents: 5000, creatorId: 'user-sales' });
      if (sales) {
        db.prepare("INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,total_cents,status,return_date,remark,creator_id,created_at,updated_at,commercial_source_marker) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(returnId, 'SRET-P6-R', 'SALES', sourceId, null, 'customer-001', 'warehouse-001', 2000, 'CONFIRMED', '2026-09-20', '', 'user-warehouse', stamp, stamp, 'DELIVERY_BACKED');
        db.prepare("INSERT INTO return_order_items(id,return_id,delivery_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?,1)").run(`${returnId}-item`, returnId, `${returnId}-delivery-item`, 'product-001', 2, 1000, 2000);
      } else {
        db.prepare("INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,total_cents,status,return_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(returnId, 'PRET-P6-R', null, 'supplier-001', 'warehouse-001', 2000, 'CONFIRMED', '2026-09-20', '', 'user-warehouse', stamp, stamp);
        db.prepare("INSERT INTO purchase_return_items(id,return_id,receipt_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?,1)").run(`${returnId}-item`, returnId, `${returnId}-receipt-item`, 'product-002', 2, 1000, 2000);
      }
      const credit = applyCreditAdjustment(db, { side: sales ? 'AR' : 'AP', adjustmentType: 'RETURN', sourceType: sales ? 'SALES_RETURN' : 'PURCHASE_RETURN', sourceId: returnId, sourceNo: sales ? 'SRET-P6-R' : 'PRET-P6-R', targetOpenItemId: openId, partyId: sales ? 'customer-001' : 'supplier-001', businessDate: '2026-09-20', amountCents: 2000, actorId: 'user-accounting' });
      const voucherId = `${returnId}-voucher`; db.prepare("INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status) VALUES(?,?,?,?,?,?,?,?,'POSTED')").run(voucherId, `V-${returnId}`, sales ? 'SALES_RETURN' : 'PURCHASE_RETURN', returnId, '2026-09-20', '', 'user-accounting', stamp);
      const codes = sales ? [['6001', 'DEBIT'], ['1122', 'CREDIT']] : [['2202', 'DEBIT'], ['1405', 'CREDIT']];
      for (const [code, direction] of codes) db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,2000,?)').run(`${returnId}-${code}`, voucherId, db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(code).id, direction, returnId);
      return { returnId, openId, credit };
    };
    const sales = seedReturn('SALES');
    const inventoryBefore = Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    const reverseSales = await post(`/api/sales-returns/${sales.returnId}/reverse`, 'warehouse', { businessDate: '2026-09-27', reason: '部分退货冲销', items: [{ returnItemId: `${sales.returnId}-item`, quantity: 1 }] }, 'sales-return-reversal');
    assert.equal(reverseSales.status, 201, JSON.stringify(await reverseSales.clone().json())); assert.equal(openItemSnapshot(db, 'AR', sales.openId).openCents, 4000);
    assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity), inventoryBefore - 1);
    assert.equal((await post(`/api/sales-returns/${sales.returnId}/reverse`, 'warehouse', { businessDate: '2026-09-27', reason: '超量', items: [{ returnItemId: `${sales.returnId}-item`, quantity: 2 }] }, 'sales-return-over')).status, 409);
    const purchase = seedReturn('PURCHASE'); const purchaseBefore = Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-002'").get().quantity);
    assert.equal((await post(`/api/purchase-returns/${purchase.returnId}/reverse`, 'warehouse', { businessDate: '2026-09-27', reason: '采购退货部分冲销', items: [{ returnItemId: `${purchase.returnId}-item`, quantity: 1 }] }, 'purchase-return-reversal')).status, 201);
    assert.equal(openItemSnapshot(db, 'AP', purchase.openId).openCents, 4000); assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-002'").get().quantity), purchaseBefore + 1);
  });

  test('consumed return credit blocks reversal until its application is reversed', async () => {
    const source = ensureReceivableSource(db, { id: 'p6-consumed-source', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-CONSUMED', partyId: 'customer-002', businessDate: '2026-09-20', effectCents: 1000, creatorId: 'user-sales' });
    await settlement('COLLECTION', 'customerId', 'customer-002', 1000, [{ receivableId: source, amountCents: 1000 }]);
    const stamp = new Date().toISOString(); const returnId = 'p6-consumed-return';
    db.prepare("INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,total_cents,status,return_date,remark,creator_id,created_at,updated_at,commercial_source_marker) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(returnId, 'SRET-P6-CONSUMED', 'SALES', 'p6-consumed-source', null, 'customer-002', 'warehouse-001', 1000, 'CONFIRMED', '2026-09-20', '', 'user-warehouse', stamp, stamp, 'DELIVERY_BACKED');
    db.prepare("INSERT INTO return_order_items(id,return_id,delivery_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?,1)").run(`${returnId}-item`, returnId, 'consumed-delivery-item', 'product-001', 1, 1000, 1000);
    const credit = applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: returnId, sourceNo: 'SRET-P6-CONSUMED', targetOpenItemId: source, partyId: 'customer-002', businessDate: '2026-09-20', amountCents: 1000, actorId: 'user-accounting' });
    const target = ensureReceivableSource(db, { id: 'p6-consumed-target', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-CONSUMED-TARGET', partyId: 'customer-002', businessDate: '2026-09-21', effectCents: 2000, creatorId: 'user-sales' });
    const application = await (await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', creditId: credit.id, openItemId: target, amountCents: 1000, businessDate: '2026-09-21' })).json();
    const body = { businessDate: '2026-09-28', reason: '依赖检查', items: [{ returnItemId: `${returnId}-item`, quantity: 1 }] };
    const before = Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity);
    assert.equal((await post(`/api/sales-returns/${returnId}/reverse`, 'warehouse', body, 'consumed-block')).status, 409);
    assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='product-001'").get().quantity), before);
    await post(`/api/settlement/balance-applications/${application.id}/reverse`, 'accounting', { reason: '先冲销贷项应用' });
    const voucherId = 'p6-consumed-voucher'; db.prepare("INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status) VALUES(?,?,?,?,?,?,?,?,'POSTED')").run(voucherId, 'V-P6-CONSUMED', 'SALES_RETURN', returnId, '2026-09-20', '', 'user-accounting', stamp);
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES('p6-consumed-e1',?,'subject-006','DEBIT',1000,'退货')").run(voucherId);
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES('p6-consumed-e2',?,'subject-003','CREDIT',1000,'退货')").run(voucherId);
    assert.equal((await post(`/api/sales-returns/${returnId}/reverse`, 'warehouse', body, 'consumed-after-dependency')).status, 201);
  });

  test('settlement account reconciliation is CHECK-only and detects synthetic mismatch', async () => {
    let response = await request('/api/settlement/account-reconciliation', 'accounting'); assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    const movement = db.prepare('SELECT * FROM settlement_account_movements LIMIT 1').get(); db.prepare('UPDATE settlement_account_movements SET amount_cents=amount_cents+1 WHERE id=?').run(movement.id);
    response = await request('/api/settlement/account-reconciliation', 'accounting'); const result = await response.json(); assert.equal(result.ok, false); assert.ok(result.issues.some((x) => x.code === 'MOVEMENT_VOUCHER_MISMATCH'));
    assert.equal(db.prepare('SELECT amount_cents FROM settlement_account_movements WHERE id=?').get(movement.id).amount_cents, movement.amount_cents + 1);
    db.prepare('UPDATE settlement_account_movements SET amount_cents=? WHERE id=?').run(movement.amount_cents, movement.id);
  });

  test('financial UAT chain is fully traceable from AR 100000 to later credit application', async () => {
    const ar = ensureReceivableSource(db, { id: 'p6-uat-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-UAT', partyId: 'customer-003', businessDate: '2026-10-01', effectCents: 10000000, creatorId: 'user-sales' });
    applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: 'p6-uat-return', sourceNo: 'SRET-P6-UAT', targetOpenItemId: ar, partyId: 'customer-003', businessDate: '2026-10-02', amountCents: 200000, actorId: 'user-accounting' });
    applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'DISCOUNT', sourceType: 'SALES_DISCOUNT', sourceId: 'p6-uat-discount', sourceNo: 'SDISC-P6-UAT', targetOpenItemId: ar, partyId: 'customer-003', businessDate: '2026-10-03', amountCents: 300000, actorId: 'user-accounting' });
    await settlement('COLLECTION', 'customerId', 'customer-003', 9000000, [{ receivableId: ar, amountCents: 9000000 }]);
    assert.equal(openItemSnapshot(db, 'AR', ar).openCents, 500000);
    const writeOff = await (await post('/api/financial-write-offs', 'accounting', { side: 'AR', openItemId: ar, amountCents: 100000, businessDate: '2026-10-04', reason: 'UAT坏账核销' })).json();
    await post(`/api/financial-write-offs/${writeOff.id}/submit`, 'accounting'); assert.equal((await post(`/api/financial-write-offs/${writeOff.id}/confirm`, 'admin', {}, 'uat-ar-writeoff')).status, 200);
    assert.equal(openItemSnapshot(db, 'AR', ar).openCents, 400000);
    await settlement('COLLECTION', 'customerId', 'customer-003', 400000, [{ receivableId: ar, amountCents: 400000 }]);
    assert.equal(openItemSnapshot(db, 'AR', ar).openCents, 0);
    const laterCredit = applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: 'p6-uat-later-return', sourceNo: 'SRET-P6-UAT-LATER', targetOpenItemId: ar, partyId: 'customer-003', businessDate: '2026-10-05', amountCents: 100000, actorId: 'user-accounting' });
    const nextAr = ensureReceivableSource(db, { id: 'p6-uat-next-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-P6-UAT-NEXT', partyId: 'customer-003', businessDate: '2026-10-06', effectCents: 1000000, creatorId: 'user-sales' });
    assert.equal(openItemSnapshot(db, 'AR', nextAr).openCents, 1000000);
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', creditId: laterCredit.id, openItemId: nextAr, amountCents: 100000, businessDate: '2026-10-06', reason: 'UAT显式贷项应用' })).status, 201);
    assert.equal(openItemSnapshot(db, 'AR', nextAr).openCents, 900000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_id IN ('p6-uat-return','p6-uat-discount','p6-uat-later-return')").get().n, 3);
  });

  test('AP UAT chain is fully traceable from AP 14000 to later supplier-credit application', async () => {
    const ap = ensurePayableSource(db, { id: 'p6-uat-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-P6-UAT', partyId: 'supplier-003', businessDate: '2026-10-01', effectCents: 1400000, creatorId: 'user-sales' });
    applyCreditAdjustment(db, { side: 'AP', adjustmentType: 'DISCOUNT', sourceType: 'PURCHASE_DISCOUNT', sourceId: 'p6-uat-pdiscount', sourceNo: 'PDISC-P6-UAT', targetOpenItemId: ap, partyId: 'supplier-003', businessDate: '2026-10-02', amountCents: 100000, actorId: 'user-accounting' });
    await settlement('PAYMENT', 'supplierId', 'supplier-003', 1000000, [{ payableId: ap, amountCents: 1000000 }]);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 300000);
    const writeOff = await (await post('/api/financial-write-offs', 'accounting', { side: 'AP', openItemId: ap, amountCents: 50000, businessDate: '2026-10-03', reason: 'UAT应付尾差' })).json();
    await post(`/api/financial-write-offs/${writeOff.id}/submit`, 'accounting'); assert.equal((await post(`/api/financial-write-offs/${writeOff.id}/confirm`, 'admin', {}, 'uat-ap-writeoff')).status, 200);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 250000);
    await settlement('PAYMENT', 'supplierId', 'supplier-003', 250000, [{ payableId: ap, amountCents: 250000 }]);
    assert.equal(openItemSnapshot(db, 'AP', ap).openCents, 0);
    const supplierCredit = applyCreditAdjustment(db, { side: 'AP', adjustmentType: 'RETURN', sourceType: 'PURCHASE_RETURN', sourceId: 'p6-uat-later-preturn', sourceNo: 'PRET-P6-UAT-LATER', targetOpenItemId: ap, partyId: 'supplier-003', businessDate: '2026-10-04', amountCents: 100000, actorId: 'user-accounting' });
    const nextAp = ensurePayableSource(db, { id: 'p6-uat-next-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-P6-UAT-NEXT', partyId: 'supplier-003', businessDate: '2026-10-05', effectCents: 600000, creatorId: 'user-sales' });
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AP', creditId: supplierCredit.id, openItemId: nextAp, amountCents: 100000, businessDate: '2026-10-05', reason: 'UAT供应商贷项应用' })).status, 201);
    assert.equal(openItemSnapshot(db, 'AP', nextAp).openCents, 500000);
  });
});

// ---------------------------------------------------------------------------
// W7-C1 / W7-C2' Implementation A — Finance Refund post-lock monetary authority
// (solution.md §37.6, §37.10 A-MONEY / A-REFUND / A-SIDE / A-STATIC)
//
// These tests exercise the corrected createRefund() against durable business
// facts on a single-connection SQLite run. They deliberately do NOT claim real
// concurrent proof: per §37.10 A-RAW, row-level concurrency evidence requires a
// disposable real-MySQL gate, which is not authorized in this stage. What is
// asserted here is the capacity AUTHORITY contract and the zero-side-effect
// property on every rejection path.
// ---------------------------------------------------------------------------

describe('V1.3 Phase 6A refund post-lock monetary authority', () => {
  let handle; let db; let server; let base; const tokens = {};
  const request = (path, role, method = 'GET', body, key) => fetch(base + path, { method, headers: { ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const post = (path, role, body = {}, key) => request(path, role, 'POST', body, key);
  const settlement = async (kind, partyKey, partyId, amount, allocations = [], unapplied = 0) => {
    const path = kind === 'COLLECTION' ? '/api/payment-collections' : '/api/payment-disbursements';
    const body = { [partyKey]: partyId, businessDate: '2026-11-02', amountCents: amount, paymentMethod: 'BANK', settlementAccountId: 'refund-auth-bank', allocations, unappliedAmountCents: unapplied, explicitUnapplied: unapplied > 0 };
    const created = await (await post(path, 'accounting', body)).json();
    assert.equal((await post(`${path}/${created.id}/confirm`, 'accounting', {}, `auth-confirm-${created.id}`)).status, 200);
    return created;
  };
  // Durable-fact snapshot used by every zero-side-effect assertion.
  const facts = (balanceId) => ({
    refunds: db.prepare('SELECT COUNT(*) n FROM financial_refunds WHERE balance_id=?').get(balanceId).n,
    refundCents: Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM financial_refunds WHERE balance_id=? AND status='CONFIRMED'").get(balanceId).n),
    vouchers: db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='FINANCIAL_REFUND'").get().n,
    movements: db.prepare("SELECT COUNT(*) n FROM settlement_account_movements WHERE source_type='FINANCIAL_REFUND'").get().n,
    audits: db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='FINANCIAL_REFUND' AND action='CONFIRM'").get().n,
    idem: db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='REFUND_CONFIRM' AND status='SUCCEEDED'").get().n,
  });
  const refund = (body, key) => post('/api/financial-refunds', 'accounting', body, key);

  before(async () => {
    handle = createTempDb({ label: 'v13-p6a-refund-authority' }); db = handle.db;
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at) VALUES('refund-auth-bank','授权银行','AUTH-001','退款授权测试户','CHECKING',0,'CNY',1,?,?)").run(stamp, stamp);
    server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); base = `http://127.0.0.1:${server.address().port}`;
    tokens.accounting = (await (await post('/api/auth/login', null, { username: 'accounting', password: 'accounting123' })).json()).token;
  });
  after(async () => { await new Promise((done, fail) => server.close((e) => e ? fail(e) : done())); handle.cleanup(); });

  const prepayCustomer = async (customerId, amount) => {
    await settlement('COLLECTION', 'customerId', customerId, amount, [], amount);
    return db.prepare("SELECT * FROM settlement_unapplied_balances WHERE party_id=? AND balance_type='PREPAYMENT' ORDER BY created_at DESC").get(customerId);
  };
  const baseBody = (balanceId, partyId, amountCents) => ({ side: 'CUSTOMER', balanceId, partyId, amountCents, businessDate: '2026-11-03', settlementAccountId: 'refund-auth-bank', paymentMethod: 'BANK', reason: '超额退款测试' });

  // R1 + R10 — a refund inside current capacity commits every durable fact and
  // leaves a nonnegative canonical remaining balance.
  test('refund within current capacity commits every durable fact and keeps remaining nonnegative', async () => {
    const balance = await prepayCustomer('customer-001', 10000);
    const response = await refund(baseBody(balance.id, 'customer-001', 4000), 'auth-r1');
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    const created = await response.json();
    const row = db.prepare('SELECT * FROM financial_refunds WHERE id=?').get(created.id);
    assert.equal(row.status, 'CONFIRMED'); assert.equal(row.amount_cents, 4000); assert.equal(row.balance_id, balance.id);
    assert.ok(db.prepare("SELECT 1 FROM accounting_vouchers WHERE source_type='FINANCIAL_REFUND' AND source_id=?").get(created.id));
    assert.ok(db.prepare("SELECT 1 FROM settlement_account_movements WHERE source_type='FINANCIAL_REFUND' AND source_id=?").get(created.id));
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE entity_type='FINANCIAL_REFUND' AND entity_id=? AND action='CONFIRM'").get(created.id));
    assert.ok(db.prepare("SELECT 1 FROM idempotency_records WHERE operation_type='REFUND_CONFIRM' AND document_id=? AND status='SUCCEEDED'").get(`CUSTOMER:${balance.id}`));
    const remaining = unappliedBalanceSnapshot(db, balance.id).remainingCents;
    assert.equal(remaining, 6000); assert.ok(remaining >= 0, 'remaining must never be negative');
  });

  // R2 + R9 — an over-refund is refused and creates no voucher, movement, refund,
  // audit or idempotency fact.
  test('refund beyond remaining capacity is refused with zero durable side effect', async () => {
    const balance = await prepayCustomer('customer-002', 5000);
    const before = facts(balance.id);
    const response = await refund(baseBody(balance.id, 'customer-002', 5001), 'auth-r2');
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'FINANCIAL_REFUND_CAPACITY_EXCEEDED');
    assert.deepEqual(facts(balance.id), before);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 5000);
  });

  // R3 — two DIFFERENT idempotency keys, each individually valid against the
  // original capacity, must not both consume the same capacity. This asserts the
  // outcome invariant only; real concurrent proof is Gate A A-RAW on a
  // disposable MySQL, which is deliberately not fabricated here.
  test('two distinct refund keys cannot both consume the same capacity', async () => {
    const balance = await prepayCustomer('customer-003', 10000);
    assert.equal((await refund(baseBody(balance.id, 'customer-003', 7000), 'auth-r3-a')).status, 201);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 3000);
    const second = await refund(baseBody(balance.id, 'customer-003', 7000), 'auth-r3-b');
    assert.equal(second.status, 409);
    const after = facts(balance.id);
    assert.equal(after.refunds, 1, 'only one refund may exist');
    assert.ok(after.refundCents <= 10000, 'consumed must never exceed the original balance');
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 3000);
  });

  // R4 — a CONFIRMED application reduces refundable capacity and the refund path
  // observes the reduced amount.
  test('refund after a confirmed application respects the reduced capacity', async () => {
    await settlement('COLLECTION', 'customerId', 'customer-001', 10000, [], 10000);
    const balance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE party_id='customer-001' AND balance_type='PREPAYMENT' ORDER BY created_at DESC").get();
    const ar = ensureReceivableSource(db, { id: 'auth-r4-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-AUTH-R4', partyId: 'customer-001', businessDate: '2026-11-04', effectCents: 10000, creatorId: 'user-sales' });
    assert.equal((await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', balanceId: balance.id, openItemId: ar, amountCents: 7000, businessDate: '2026-11-04' })).status, 201);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 3000);
    const before = facts(balance.id);
    assert.equal((await refund(baseBody(balance.id, 'customer-001', 4000), 'auth-r4')).status, 409);
    assert.deepEqual(facts(balance.id), before);
    assert.equal((await refund(baseBody(balance.id, 'customer-001', 3000), 'auth-r4-ok')).status, 201);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 0);
  });

  // R5 — a CONFIRMED UNAPPLIED settlement reversal component reduces refundable
  // capacity, and the refund path observes it.
  test('refund after a confirmed UNAPPLIED reversal respects the reduced capacity', async () => {
    const balance = await prepayCustomer('customer-001', 10000);
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO settlement_reversals(id,reversal_no,settlement_type,settlement_id,amount_cents,business_date,reason,status,creator_id,created_at) VALUES('auth-r5-rev','RV-AUTH-R5','COLLECTION','auth-r5-doc',4000,'2026-11-04','未核销冲销','CONFIRMED','user-accounting',?)").run(stamp);
    db.prepare("INSERT INTO settlement_reversal_items(id,reversal_id,component_type,original_component_id,amount_cents) VALUES('auth-r5-item','auth-r5-rev','UNAPPLIED',?,4000)").run(balance.id);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 6000);
    const before = facts(balance.id);
    assert.equal((await refund(baseBody(balance.id, 'customer-001', 7000), 'auth-r5')).status, 409);
    assert.deepEqual(facts(balance.id), before);
    assert.equal((await refund(baseBody(balance.id, 'customer-001', 6000), 'auth-r5-ok')).status, 201);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 0);
  });

  // R6 — only CONFIRMED applications/refunds reduce capacity; reversing an
  // application restores it under the existing canonical status rules.
  test('reversing an application restores capacity because only CONFIRMED counts', async () => {
    await settlement('COLLECTION', 'customerId', 'customer-002', 10000, [], 10000);
    const balance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE party_id='customer-002' AND balance_type='PREPAYMENT' ORDER BY created_at DESC").get();
    const ar = ensureReceivableSource(db, { id: 'auth-r6-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-AUTH-R6', partyId: 'customer-002', businessDate: '2026-11-05', effectCents: 10000, creatorId: 'user-sales' });
    const application = await (await post('/api/settlement/balance-applications', 'accounting', { side: 'AR', balanceId: balance.id, openItemId: ar, amountCents: 7000, businessDate: '2026-11-05' })).json();
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 3000);
    assert.equal((await post(`/api/settlement/balance-applications/${application.id}/reverse`, 'accounting', { reason: '应用冲销' })).status, 200);
    assert.equal(db.prepare('SELECT status FROM balance_applications WHERE id=?').get(application.id).status, 'REVERSED');
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 10000, 'REVERSED application must not reduce capacity');
    assert.equal((await refund(baseBody(balance.id, 'customer-002', 10000), 'auth-r6')).status, 201);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 0);
  });

  // R2-R7 — exact replay must win over mutable capacity even after the first
  // request fully depletes the balance. A conflicting fingerprint still fails by
  // idempotency identity, while a fresh key sees the authoritative zero capacity.
  test('exact idempotent replay survives full depletion without duplicate effects', async () => {
    const balance = await prepayCustomer('customer-003', 10000);
    const body = baseBody(balance.id, 'customer-003', 10000);
    const first = await refund(body, 'auth-r7'); assert.equal(first.status, 201);
    const created = await first.json();
    const before = facts(balance.id);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 0);
    const replay = await refund(body, 'auth-r7');
    assert.equal(replay.status, 200);
    const replayed = await replay.json();
    assert.equal(replayed.id, created.id); assert.equal(replayed.replayed, true);
    assert.deepEqual(facts(balance.id), before, 'replay must not add any durable fact');
    const conflict = await refund({ ...body, amountCents: 9999 }, 'auth-r7');
    assert.equal(conflict.status, 409);
    assert.deepEqual(facts(balance.id), before, 'same-key conflict must not add any durable fact');
    const fresh = await refund(body, 'auth-r7-fresh');
    assert.equal(fresh.status, 409);
    assert.equal((await fresh.json()).code, 'FINANCIAL_REFUND_CAPACITY_EXCEEDED');
    assert.deepEqual(facts(balance.id), before, 'fresh key after depletion must not add any durable fact');
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 0);
  });

  // R8 — the same idempotency key with a different request fingerprint is refused.
  test('same idempotency key with a conflicting request is refused', async () => {
    const balance = await prepayCustomer('customer-001', 10000);
    const body = baseBody(balance.id, 'customer-001', 1500);
    assert.equal((await refund(body, 'auth-r8')).status, 201);
    const before = facts(balance.id);
    const conflict = await refund({ ...body, reason: '不同的退款原因' }, 'auth-r8');
    assert.equal(conflict.status, 409);
    assert.deepEqual(facts(balance.id), before);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, 8500);
  });

  // §37.6 — a balance whose canonical remaining is negative fails closed rather
  // than being absorbed, and produces no durable fact.
  test('negative authoritative remaining capacity fails closed with a distinct code', async () => {
    const balance = await prepayCustomer('customer-002', 1000);
    const stamp = new Date().toISOString();
    db.prepare("INSERT INTO financial_refunds(id,refund_no,side,balance_id,party_id,amount_cents,business_date,settlement_account_id,payment_method,reference,reason,creator_id,created_at) VALUES('auth-neg-refund','RNEG-AUTH','CUSTOMER',?,'customer-002',2000,'2026-11-04','refund-auth-bank','BANK','','历史超额退款','user-accounting',?)").run(balance.id, stamp);
    assert.equal(unappliedBalanceSnapshot(db, balance.id).remainingCents, -1000);
    const before = facts(balance.id);
    const response = await refund(baseBody(balance.id, 'customer-002', 1), 'auth-negative');
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'FINANCIAL_REFUND_CAPACITY_NEGATIVE');
    assert.deepEqual(facts(balance.id), before, 'a negative-capacity refund must leave every fact untouched');
  });

  // R11 — CUSTOMER/SUPPLIER and PREPAYMENT/CREDIT both keep working unchanged.
  test('customer, supplier and CREDIT-balance refunds all remain compatible', async () => {
    await settlement('PAYMENT', 'supplierId', 'supplier-001', 3000, [], 3000);
    const supplierBalance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE party_id='supplier-001' ORDER BY created_at DESC").get();
    const supplierRefund = await post('/api/financial-refunds', 'accounting', { side: 'SUPPLIER', balanceId: supplierBalance.id, partyId: 'supplier-001', amountCents: 1200, businessDate: '2026-11-06', settlementAccountId: 'refund-auth-bank', paymentMethod: 'BANK', reason: '供应商退款' }, 'auth-r11-supplier');
    assert.equal(supplierRefund.status, 201, JSON.stringify(await supplierRefund.clone().json()));
    assert.equal(unappliedBalanceSnapshot(db, supplierBalance.id).remainingCents, 1800);

    // A credit only materialises a CREDIT balance for the portion that exceeds the
    // open item, so the open item must be smaller than the adjustment.
    const ar = ensureReceivableSource(db, { id: 'auth-r11-credit-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-AUTH-R11', partyId: 'customer-003', businessDate: '2026-11-06', effectCents: 900, creatorId: 'user-sales' });
    const credit = applyCreditAdjustment(db, { side: 'AR', adjustmentType: 'RETURN', sourceType: 'SALES_RETURN', sourceId: 'auth-r11-return', sourceNo: 'SRET-AUTH-R11', targetOpenItemId: ar, partyId: 'customer-003', businessDate: '2026-11-06', amountCents: 2000, actorId: 'user-accounting' });
    const creditBalance = db.prepare("SELECT * FROM settlement_unapplied_balances WHERE balance_type='CREDIT' AND source_id=?").get(credit.id);
    assert.ok(creditBalance, 'an unapplied credit must materialise a CREDIT balance');
    assert.equal(creditBalance.balance_type, 'CREDIT');
    assert.equal(Number(creditBalance.original_amount_cents), 1100);
    assert.equal(unappliedBalanceSnapshot(db, creditBalance.id).remainingCents, 1100);
    const creditRefund = await post('/api/financial-refunds', 'accounting', { side: 'CUSTOMER', creditId: credit.id, partyId: 'customer-003', amountCents: 900, businessDate: '2026-11-06', settlementAccountId: 'refund-auth-bank', paymentMethod: 'BANK', reason: '退货贷项退款' }, 'auth-r11-credit');
    assert.equal(creditRefund.status, 201, JSON.stringify(await creditRefund.clone().json()));
    assert.equal(unappliedBalanceSnapshot(db, creditBalance.id).remainingCents, 200);
  });

  // R12 + §37.10 A-STATIC — the post-lock authority read is ordered after the
  // canonical lock and before any business effect, and uses portable SQL that
  // behaves identically on SQLite and MySQL.
  test('post-lock capacity authority is ordered after the parent lock and before every business effect', () => {
    const source = readFileSync(resolve('server/modules/financial-controls.js'), 'utf8');
    const body = source.slice(source.indexOf('export async function createRefund'), source.indexOf('export async function reverseRefund'));
    const replay = body.indexOf("idempotencyReplay(db, 'REFUND_CONFIRM'");
    const transactionStart = body.indexOf('transaction(db, () => {');
    assert.ok(replay > 0, 'canonical replay lookup must be present');
    assert.ok(transactionStart > replay, 'a fresh request must enter the transaction after replay lookup');
    const betweenReplayAndTransaction = body.slice(replay, transactionStart);
    assert.ok(!betweenReplayAndTransaction.includes('throw new HttpError'), 'no application rejection may strand the MySQL idempotency named lock before transaction()');
    assert.ok(!betweenReplayAndTransaction.includes('unappliedBalanceSnapshot'), 'mutable capacity must not reject an exact committed replay');
    // Anchor every monetary ordering assertion to the transaction body.
    const tx = body.slice(body.indexOf('transaction(db, () => {'));
    const lock = tx.indexOf('acquireParentBalanceLock(db, balance.id)');
    const authority = tx.indexOf('const currentAvailable = unappliedBalanceSnapshot(db, balance.id).remainingCents');
    const negative = tx.indexOf('FINANCIAL_REFUND_CAPACITY_NEGATIVE');
    const exceed = tx.indexOf('amount > currentAvailable');
    assert.ok(lock > 0, 'the canonical parent lock must be present');
    assert.ok(authority > lock, 'capacity authority must be read after the canonical lock');
    assert.ok(negative > authority, 'the negative-capacity check must follow the authority read');
    assert.ok(exceed > negative, 'the capacity-exceeded check must follow the negative-capacity check');
    const effects = {
      voucher: tx.indexOf('generateVoucher(db'),
      refundInsert: tx.indexOf('INSERT INTO financial_refunds'),
      movement: tx.indexOf('recordSettlementMovement(db'),
      idempotency: tx.indexOf("saveIdempotency(db, 'REFUND_CONFIRM'"),
      auditWrite: tx.indexOf("audit(db, actor.id, 'CONFIRM', 'FINANCIAL_REFUND'"),
    };
    for (const [name, index] of Object.entries(effects)) {
      assert.ok(index > exceed, `${name} must be written only after the authoritative capacity check`);
    }
    const authorityStatement = tx.slice(tx.indexOf('SELECT id,side,party_id,status FROM settlement_unapplied_balances'), tx.indexOf('const currentAvailable'));
    assert.ok(!/FOR UPDATE|LOCK IN SHARE MODE|GET_LOCK|--/i.test(authorityStatement), 'the authority read must use portable SQL only');
  });
});
