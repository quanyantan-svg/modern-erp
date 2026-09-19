import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';
import { ensurePayableSource, ensureReceivableSource, reconcileSettlementSubledgers } from './modules/settlement-core.js';

describe('M8 AR/AP and settlement workflow', () => {
  let temp; let db; let server; let base; const tokens = {}; let arId; let apId;
  const auth = (role) => role ? { authorization: `Bearer ${tokens[role]}` } : {};
  const request = (path, role, options = {}) => fetch(base + path, { ...options, headers: { ...auth(role), ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers } });
  const post = (path, role, body = {}) => request(path, role, { method: 'POST', body: JSON.stringify(body) });

  before(async () => {
    temp = mkdtempSync(join(tmpdir(), 'modern-erp-m8-')); db = createDatabase(join(temp, 'erp.db'));
    server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, password] of [['admin', 'admin123'], ['accounting', 'accounting123'], ['sales', 'sales123'], ['reviewer', 'review123'], ['warehouse', 'warehouse123']]) {
      const response = await post('/api/auth/login', null, { username: name, password }); tokens[name] = (await response.json()).token;
    }
  });
  after(async () => { await new Promise((done, fail) => server.close((error) => error ? fail(error) : done())); db.close(); rmSync(temp, { recursive: true, force: true }); });

  test('permission registry has 113 entries after M14 discount additions; no sixth role', () => {
    assert.equal(PERMISSIONS.length, 113);
    for (const code of ['AR_VIEW', 'COLLECTION_MANAGE', 'AP_VIEW', 'PAYMENT_MANAGE']) assert.ok(PERMISSIONS.some(([item]) => item === code));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM roles').get().n, 5);
  });

  test('draft direct Sales Delivery creates no AR; confirmation creates one exact-cent AR and retry cannot duplicate it', async () => {
    const created = await (await post('/api/sales-deliveries', 'sales', { customerId: 'customer-001', warehouseId: 'warehouse-001', deliveryDate: '2026-08-10', remark: '', items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 10000 }] })).json();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(created.id).n, 0);
    assert.equal((await post(`/api/sales-deliveries/${created.id}`, 'sales', { action: 'confirm' })).status, 200);
    const ar = db.prepare("SELECT * FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(created.id); arId = ar.id;
    assert.equal(ar.amount_cents, 10000); assert.equal(ar.adjustment_cents, 0); assert.equal(ar.paid_cents, 0); assert.equal(ar.status, 'PENDING'); assert.equal(ar.customer_id, 'customer-001');
    assert.equal((await post(`/api/sales-deliveries/${created.id}`, 'sales', { action: 'confirm' })).status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(created.id).n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY' AND source_id=?").get(created.id).n, 1);
  });

  test('draft direct Purchase Receipt creates no AP; confirmation creates one exact-cent AP', async () => {
    const created = await (await post('/api/purchase-receipts', 'sales', { supplierId: 'supplier-001', warehouseId: 'warehouse-001', receiptDate: '2026-08-11', remark: '', items: [{ productId: 'product-002', quantity: 1, unitPriceCents: 12000 }] })).json();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(created.id).n, 0);
    assert.equal((await post(`/api/purchase-receipts/${created.id}`, 'sales', { action: 'confirm' })).status, 200);
    const ap = db.prepare("SELECT * FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(created.id); apId = ap.id;
    assert.equal(ap.amount_cents, 12000); assert.equal(ap.supplier_id, 'supplier-001'); assert.equal(ap.status, 'PENDING');
    assert.equal((await post(`/api/purchase-receipts/${created.id}`, 'sales', { action: 'confirm' })).status, 409);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(created.id).n, 1);
  });

  test('returns are independent negative AR/AP adjustments and reconciliation is idempotent', () => {
    const stamp = '2026-08-12T00:00:00.000Z';
    ensureReceivableSource(db, { id: 'return-ar', sourceType: 'SALES_RETURN', sourceNo: 'SRET-M8', partyId: 'customer-001', businessDate: '2026-08-12', effectCents: -5000, creatorId: 'user-sales', createdAt: stamp });
    ensurePayableSource(db, { id: 'return-ap', sourceType: 'PURCHASE_RETURN', sourceNo: 'PRET-M8', partyId: 'supplier-001', businessDate: '2026-08-12', effectCents: -3000, creatorId: 'user-sales', createdAt: stamp });
    ensureReceivableSource(db, { id: 'return-ar', sourceType: 'SALES_RETURN', sourceNo: 'SRET-M8', partyId: 'customer-001', businessDate: '2026-08-12', effectCents: -5000, creatorId: 'user-sales', createdAt: stamp });
    reconcileSettlementSubledgers(db); reconcileSettlementSubledgers(db);
    const ar = db.prepare("SELECT * FROM account_receivables WHERE source_id='return-ar'").get(); const ap = db.prepare("SELECT * FROM account_payables WHERE source_id='return-ap'").get();
    assert.equal(ar.amount_cents, 0); assert.equal(ar.adjustment_cents, -5000); assert.equal(ap.adjustment_cents, -3000);
    assert.equal(sourceStatusForTest(ar).outstandingCents, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_id='return-ar'").get().n, 1);
  });

  test('legacy confirmed Delivery and Receipt are backfilled once and repeated reconciliation is stable', () => {
    const stamp = '2026-08-12T02:00:00.000Z';
    db.prepare("INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('legacy-sd','SD-LEGACY-M8','customer-002','warehouse-001','user-sales',4321,'CONFIRMED','2026-08-12','旧单','user-sales',?,?)").run(stamp, stamp);
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('legacy-pr','PR-LEGACY-M8','supplier-002','warehouse-001','user-sales',5432,'CONFIRMED','2026-08-12','旧单','user-sales',?,?)").run(stamp, stamp);
    reconcileSettlementSubledgers(db); reconcileSettlementSubledgers(db);
    const arRows = db.prepare("SELECT source_id,amount_cents FROM account_receivables WHERE source_id='legacy-sd'").all(); const apRows = db.prepare("SELECT source_id,amount_cents FROM account_payables WHERE source_id='legacy-pr'").all();
    assert.equal(arRows.length, 1); assert.equal(arRows[0].amount_cents, 4321); assert.equal(apRows.length, 1); assert.equal(apRows[0].amount_cents, 5432);
  });

  test('collection DRAFT has no effect; partial and final confirmations settle in cents with one balanced voucher each', async () => {
    // M14: create a fresh positive AR for a fresh customer so that no
    // prior SALES_RETURN reduces the per-row outstanding. The existing
    // test fixture (customer-001 + arId) has a -5000 SALES_RETURN from
    // test 3, so a per-row COMPLETED state is unreachable there.
    const stamp = '2026-08-13T00:00:00.000Z';
    const freshArId = ensureReceivableSource(db, { id: 'm8-collection-ar', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-M8-COLL', partyId: 'customer-003', businessDate: '2026-08-13', effectCents: 10000, creatorId: 'user-sales', createdAt: stamp });
    const draftResponse = await post('/api/payment-collections', 'accounting', { customerId: 'customer-003', businessDate: '2026-08-13', amountCents: 4000, paymentMethod: 'BANK', allocations: [{ receivableId: freshArId, amountCents: 4000 }] });
    assert.equal(draftResponse.status, 201); const draft = await draftResponse.json(); assert.equal(db.prepare('SELECT paid_cents FROM account_receivables WHERE id=?').get(freshArId).paid_cents, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PAYMENT_COLLECTION' AND source_id=?").get(draft.id).n, 0);
    assert.equal((await post(`/api/payment-collections/${draft.id}/confirm`, 'accounting')).status, 200);
    let ar = db.prepare('SELECT * FROM account_receivables WHERE id=?').get(freshArId); assert.equal(ar.paid_cents, 4000); assert.equal(ar.status, 'PARTIAL');
    const entries = db.prepare("SELECT s.code,e.direction,e.amount_cents FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.source_type='PAYMENT_COLLECTION' AND v.source_id=? ORDER BY e.direction").all(draft.id);
    assert.deepEqual(entries.map((x) => [x.code, x.direction, x.amount_cents]), [['1122', 'CREDIT', 4000], ['1002', 'DEBIT', 4000]]);
    assert.equal((await post(`/api/payment-collections/${draft.id}/confirm`, 'accounting')).status, 409); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(draft.id).n, 1);
    const final = await (await post('/api/payment-collections', 'accounting', { customerId: 'customer-003', businessDate: '2026-08-14', amountCents: 6000, paymentMethod: 'CASH', allocations: [{ receivableId: freshArId, amountCents: 6000 }] })).json();
    assert.equal((await post(`/api/payment-collections/${final.id}/confirm`, 'accounting')).status, 200); ar = db.prepare('SELECT * FROM account_receivables WHERE id=?').get(freshArId); assert.equal(ar.paid_cents, 10000); assert.equal(ar.status, 'COMPLETED'); assert.equal(ar.amount_cents - ar.paid_cents, 0);
  });

  test('payment supports partial and full AP settlement with canonical account mapping', async () => {
    // M14: create a fresh positive AP for a fresh supplier so the per-row
    // COMPLETED state is reachable without interference from test 3's
    // -3000 PURCHASE_RETURN on supplier-001.
    const stamp = '2026-08-15T00:00:00.000Z';
    const freshApId = ensurePayableSource(db, { id: 'm8-payment-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-M8-PAY', partyId: 'supplier-003', businessDate: '2026-08-15', effectCents: 12000, creatorId: 'user-sales', createdAt: stamp });
    for (const [amount, method] of [[5000, 'BANK'], [7000, 'CASH']]) {
      const draft = await (await post('/api/payment-disbursements', 'accounting', { supplierId: 'supplier-003', businessDate: '2026-08-15', amountCents: amount, paymentMethod: method, allocations: [{ payableId: freshApId, amountCents: amount }] })).json();
      assert.equal((await post(`/api/payment-disbursements/${draft.id}/confirm`, 'accounting')).status, 200);
      const entries = db.prepare("SELECT s.code,e.direction FROM accounting_vouchers v JOIN accounting_entries e ON e.voucher_id=v.id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.source_type='PAYMENT_DISBURSEMENT' AND v.source_id=? ORDER BY e.direction").all(draft.id);
      assert.equal(entries.find((x) => x.direction === 'DEBIT').code, '2202'); assert.equal(entries.find((x) => x.direction === 'CREDIT').code, method === 'CASH' ? '1001' : '1002');
    }
    const ap = db.prepare('SELECT * FROM account_payables WHERE id=?').get(freshApId); assert.equal(ap.paid_cents, 12000); assert.equal(ap.status, 'COMPLETED');
  });

  test('multi-document collection is atomic and overcollection rolls back every mutation', async () => {
    const stamp = '2026-08-16T00:00:00.000Z'; const a = ensureReceivableSource(db, { id: 'multi-a', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-A', partyId: 'customer-002', businessDate: '2026-08-16', effectCents: 3000, creatorId: 'user-sales', createdAt: stamp }); const b = ensureReceivableSource(db, { id: 'multi-b', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-B', partyId: 'customer-002', businessDate: '2026-08-16', effectCents: 5000, creatorId: 'user-sales', createdAt: stamp });
    const draft = await (await post('/api/payment-collections', 'accounting', { customerId: 'customer-002', businessDate: '2026-08-16', amountCents: 8000, paymentMethod: 'BANK', allocations: [{ receivableId: a, amountCents: 3000 }, { receivableId: b, amountCents: 5000 }] })).json(); assert.equal((await post(`/api/payment-collections/${draft.id}/confirm`, 'accounting')).status, 200); assert.equal(db.prepare('SELECT SUM(paid_cents) n FROM account_receivables WHERE id IN (?,?)').get(a, b).n, 8000);
    const c = ensureReceivableSource(db, { id: 'over-c', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-C', partyId: 'customer-002', businessDate: '2026-08-16', effectCents: 1000, creatorId: 'user-sales', createdAt: stamp }); const over = await (await post('/api/payment-collections', 'accounting', { customerId: 'customer-002', businessDate: '2026-08-16', amountCents: 1001, paymentMethod: 'BANK', allocations: [{ receivableId: c, amountCents: 1001 }] })).json(); assert.equal((await post(`/api/payment-collections/${over.id}/confirm`, 'accounting')).status, 409); assert.equal(db.prepare('SELECT paid_cents FROM account_receivables WHERE id=?').get(c).paid_cents, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(over.id).n, 0); assert.equal(db.prepare('SELECT status FROM payment_collections WHERE id=?').get(over.id).status, 'DRAFT');
  });

  test('cross-party allocation, sum mismatch, zero amount, and confirmed cancellation are controlled', async () => {
    const foreign = ensureReceivableSource(db, { id: 'foreign', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-F', partyId: 'customer-003', businessDate: '2026-08-17', effectCents: 1000, creatorId: 'user-sales', createdAt: '2026-08-17T00:00:00.000Z' });
    assert.equal((await post('/api/payment-collections', 'accounting', { customerId: 'customer-002', businessDate: '2026-08-17', amountCents: 1000, allocations: [{ receivableId: foreign, amountCents: 1000 }] })).status, 400);
    assert.equal((await post('/api/payment-collections', 'accounting', { customerId: 'customer-002', businessDate: '2026-08-17', amountCents: 0, allocations: [] })).status, 400);
    const draft = await (await post('/api/payment-collections', 'accounting', { customerId: 'customer-003', businessDate: '2026-08-17', amountCents: 1000, allocations: [{ receivableId: foreign, amountCents: 999 }] })).json(); assert.equal((await post(`/api/payment-collections/${draft.id}/confirm`, 'accounting')).status, 409);
    assert.equal((await post(`/api/payment-collections/${draft.id}/cancel`, 'accounting')).status, 200); assert.equal((await post(`/api/payment-collections/${draft.id}/confirm`, 'accounting')).status, 409);
  });

  test('closed period blocks collection confirmation, balance mutation, voucher, and status atomically', async () => {
    const open = ensureReceivableSource(db, { id: 'closed-source', sourceType: 'SALES_DELIVERY', sourceNo: 'SD-CLOSED', partyId: 'customer-003', businessDate: '2026-07-01', effectCents: 2000, creatorId: 'user-sales', createdAt: '2026-07-01T00:00:00.000Z' });
    const draft = await (await post('/api/payment-collections', 'accounting', { customerId: 'customer-003', businessDate: '2026-07-02', amountCents: 2000, paymentMethod: 'BANK', allocations: [{ receivableId: open, amountCents: 2000 }] })).json();
    db.prepare("INSERT INTO period_closures(id,period,period_year,period_month,closure_type,status,checklist_passed,created_at) VALUES('m8-close','2026-07',2026,7,'MONTH','CLOSED',1,'2026-08-01T00:00:00.000Z')").run();
    assert.equal((await post(`/api/payment-collections/${draft.id}/confirm`, 'accounting')).status, 409); assert.equal(db.prepare('SELECT paid_cents FROM account_receivables WHERE id=?').get(open).paid_cents, 0); assert.equal(db.prepare('SELECT status FROM payment_collections WHERE id=?').get(draft.id).status, 'DRAFT'); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(draft.id).n, 0);
  });

  test('multi-payable payment is atomic; overpayment and closed-period payment both roll back', async () => {
    const stamp = '2026-08-18T00:00:00.000Z';
    const a = ensurePayableSource(db, { id: 'multi-ap-a', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-A', partyId: 'supplier-002', businessDate: '2026-08-18', effectCents: 3000, creatorId: 'user-sales', createdAt: stamp });
    const b = ensurePayableSource(db, { id: 'multi-ap-b', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-B', partyId: 'supplier-002', businessDate: '2026-08-18', effectCents: 5000, creatorId: 'user-sales', createdAt: stamp });
    const multi = await (await post('/api/payment-disbursements', 'accounting', { supplierId: 'supplier-002', businessDate: '2026-08-18', amountCents: 8000, paymentMethod: 'BANK', allocations: [{ payableId: a, amountCents: 3000 }, { payableId: b, amountCents: 5000 }] })).json();
    assert.equal((await post(`/api/payment-disbursements/${multi.id}/confirm`, 'accounting')).status, 200); assert.equal(db.prepare('SELECT SUM(paid_cents) n FROM account_payables WHERE id IN (?,?)').get(a, b).n, 8000);
    const overSource = ensurePayableSource(db, { id: 'over-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-OVER', partyId: 'supplier-002', businessDate: '2026-08-18', effectCents: 1000, creatorId: 'user-sales', createdAt: stamp });
    const over = await (await post('/api/payment-disbursements', 'accounting', { supplierId: 'supplier-002', businessDate: '2026-08-18', amountCents: 1001, paymentMethod: 'BANK', allocations: [{ payableId: overSource, amountCents: 1001 }] })).json();
    assert.equal((await post(`/api/payment-disbursements/${over.id}/confirm`, 'accounting')).status, 409); assert.equal(db.prepare('SELECT paid_cents FROM account_payables WHERE id=?').get(overSource).paid_cents, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?").get(over.id).n, 0);
    const closedSource = ensurePayableSource(db, { id: 'closed-ap', sourceType: 'PURCHASE_RECEIPT', sourceNo: 'PR-CLOSED', partyId: 'supplier-003', businessDate: '2026-07-02', effectCents: 2000, creatorId: 'user-sales', createdAt: '2026-07-02T00:00:00.000Z' });
    const closed = await (await post('/api/payment-disbursements', 'accounting', { supplierId: 'supplier-003', businessDate: '2026-07-02', amountCents: 2000, paymentMethod: 'BANK', allocations: [{ payableId: closedSource, amountCents: 2000 }] })).json();
    assert.equal((await post(`/api/payment-disbursements/${closed.id}/confirm`, 'accounting')).status, 409); assert.equal(db.prepare('SELECT paid_cents FROM account_payables WHERE id=?').get(closedSource).paid_cents, 0); assert.equal(db.prepare('SELECT status FROM payment_disbursements WHERE id=?').get(closed.id).status, 'DRAFT');
  });

  test('statements reconcile source increases, returns, settlements, date filtering and net credit exactly', async () => {
    // M14: with the customer-level balance gate, no collection has
    // been confirmed against customer-001 (tests 5 and 6 now use a fresh
    // customer-003 / supplier-003). customer-001 still has the original
    // +10000 SALES_DELIVERY and -5000 SALES_RETURN, so the statement
    // shows a net outstanding of 5000 (10000 increases - 5000
    // adjustments - 0 settlements).
    const response = await request('/api/accounts-receivable/statement?customer=customer-001&dateFrom=2026-08-01&dateTo=2026-08-31', 'accounting'); assert.equal(response.status, 200); const data = await response.json(); assert.equal(data.summary.increaseCents, 10000); assert.equal(data.summary.adjustmentCents, 5000); assert.equal(data.summary.settledCents, 0); assert.equal(data.summary.endingOutstandingCents, 5000); assert.ok(data.rows.every((row) => row.business_date >= '2026-08-01' && row.business_date <= '2026-08-31'));
  });

  test('authorization contract: accounting/admin allowed, all other roles denied mutation, unauthenticated is 401', async () => {
    assert.equal((await request('/api/accounts-receivable', 'accounting')).status, 200); assert.equal((await request('/api/accounts-payable', 'admin')).status, 200);
    const body = { customerId: 'customer-001', businessDate: '2026-08-20', amountCents: 100, allocations: [] };
    for (const role of ['sales', 'reviewer', 'warehouse']) assert.equal((await post('/api/payment-collections', role, body)).status, 403);
    assert.equal((await post('/api/payment-collections', null, body)).status, 401);
  });
});

function sourceStatusForTest(row) {
  const net = row.amount_cents + row.adjustment_cents - row.paid_cents - row.write_off_cents;
  return { outstandingCents: Math.max(0, net), creditCents: Math.max(0, -net) };
}
