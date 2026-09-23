import assert from 'node:assert/strict';
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
        db.prepare("INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,total_cents,status,return_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(returnId, 'SRET-P6-R', 'SALES', sourceId, null, 'customer-001', 'warehouse-001', 2000, 'CONFIRMED', '2026-09-20', '', 'user-warehouse', stamp, stamp);
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
    db.prepare("INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,total_cents,status,return_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(returnId, 'SRET-P6-CONSUMED', 'SALES', 'p6-consumed-source', null, 'customer-002', 'warehouse-001', 1000, 'CONFIRMED', '2026-09-20', '', 'user-warehouse', stamp, stamp);
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
