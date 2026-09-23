import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';

describe('V1.3 Phase 3 authoritative IQC/OQC quality gates', () => {
  let temp; let db; let server; let baseUrl; let token;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(baseUrl + path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {}; try { data = await response.json(); } catch { /* empty */ }
    return { status: response.status, data };
  };
  const seedSource = (kind, key, quantities = [10], status = 'DRAFT') => {
    const now = new Date().toISOString();
    if (kind === 'IQC') {
      db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,expected_delivery_date) VALUES(?,?,?,'APPROVED',10000,'','user-warehouse',?,?,?,?)").run(`po-${key}`, `PO-${key}`, 'sup', now, now, '2026-09-23', '2026-09-30');
      quantities.forEach((quantity, index) => db.prepare('INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)').run(`poi-${key}-${index}`, `po-${key}`, `p${index + 1}`, quantity, 1000, quantity * 1000, index + 1));
      db.prepare('INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`pr-${key}`, `PR-${key}`, `po-${key}`, 'sup', 'wh', 'user-warehouse', status, quantities.reduce((a, b) => a + b, 0) * 1000, '2026-09-23', '', 'user-warehouse', now, now);
      quantities.forEach((quantity, index) => db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no,purchase_order_item_id) VALUES(?,?,?,?,?,?,?,?)').run(`pri-${key}-${index}`, `pr-${key}`, `p${index + 1}`, quantity, 1000, quantity * 1000, index + 1, `poi-${key}-${index}`));
      return `pr-${key}`;
    }
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date,requested_delivery_date) VALUES(?,?,?,'APPROVED',10000,'','user-warehouse',?,?,?,?)").run(`so-${key}`, `SO-${key}`, 'cus', now, now, '2026-09-23', '2026-09-30');
    quantities.forEach((quantity, index) => db.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)').run(`soi-${key}-${index}`, `so-${key}`, `p${index + 1}`, quantity, 1000, quantity * 1000, index + 1));
    db.prepare('INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`sd-${key}`, `SD-${key}`, `so-${key}`, 'cus', 'wh', 'user-warehouse', status, quantities.reduce((a, b) => a + b, 0) * 1000, '2026-09-23', '', 'user-warehouse', now, now);
    quantities.forEach((quantity, index) => db.prepare('INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id) VALUES(?,?,?,?,?,?,?,?)').run(`sdi-${key}-${index}`, `sd-${key}`, `p${index + 1}`, quantity, 1000, quantity * 1000, index + 1, `soi-${key}-${index}`));
    return `sd-${key}`;
  };
  const createQuality = async (kind, sourceId) => call(`/api/${kind.toLowerCase()}`, 'POST', { [kind === 'IQC' ? 'purchase_receipt_id' : 'sales_delivery_id']: sourceId });
  const complete = async (kind, qualityId, quantity, result = 'PASS', extra = {}) => call(`/api/${kind.toLowerCase()}/${qualityId}/complete`, 'POST', { result, inspection_quantity: quantity, passed_quantity: result === 'PASS' ? quantity : quantity - 1, failed_quantity: result === 'PASS' ? 0 : 1, ...(result === 'FAIL' ? { defect_reason: '尺寸不符', disposition: 'HOLD' } : {}), ...extra });
  const effects = () => ({ inventory: db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM inventory').get().n, tx: db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, ar: db.prepare('SELECT COUNT(*) n FROM account_receivables').get().n, ap: db.prepare('SELECT COUNT(*) n FROM account_payables').get().n, vouchers: db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n, entries: db.prepare('SELECT COUNT(*) n FROM accounting_entries').get().n });

  beforeEach(async () => {
    temp = createTempDb({ label: 'v13-phase3', production: true }); db = temp.db;
    const now = new Date().toISOString();
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('sup','SUP','Supplier','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS','Customer','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH','Warehouse','','',1,?,?)").run(now, now);
    for (let i = 1; i <= 2; i++) { db.prepare('INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES(?,?,?,?,?,1000,0,1,?,?)').run(`p${i}`, `P${i}`, `Product ${i}`, '', 'EA', now, now); db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)').run(`inv${i}`, 'wh', `p${i}`, 100, now); }
    const password = hashPassword('warehouse-phase3'); db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('user-warehouse','warehouse-p3','Warehouse',?,?, 'role-warehouse',1,?)").run(password.hash, password.salt, now);
    server = createServer(createApp(db, { distDir: resolve('dist') })); await new Promise((done) => server.listen(0, '127.0.0.1', done)); baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'warehouse-p3', password: 'warehouse-phase3' }) }); token = (await login.json()).token;
  });
  afterEach(async () => { await new Promise((done) => server.close(done)); temp.cleanup(); });

  test('A-C/V-X standalone, confirmed, and cancelled sources are refused', async () => {
    assert.equal((await call('/api/iqc', 'POST', {})).status, 400); assert.equal((await call('/api/oqc', 'POST', {})).status, 400);
    for (const [kind, prefix] of [['IQC', 'pr'], ['OQC', 'sd']]) {
      const confirmed = seedSource(kind, `${kind}-confirmed`, [10], 'CONFIRMED'); const cancelled = seedSource(kind, `${kind}-cancelled`, [10], 'CANCELLED');
      assert.equal((await createQuality(kind, confirmed)).status, 409); assert.equal((await createQuality(kind, cancelled)).status, 409);
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${kind === 'IQC' ? 'iqc_inspections' : 'oqc_inspections'} WHERE ${kind === 'IQC' ? 'purchase_receipt_id' : 'sales_delivery_id'} LIKE ?`).get(`${prefix}-%`).n, 0);
    }
  });

  test('D-F/Y-AA source facts are inherited, immutable, and exact quantities are required', async () => {
    for (const kind of ['IQC', 'OQC']) {
      const source = seedSource(kind, `inherit-${kind}`, [6, 4]);
      const forged = await call(`/api/${kind.toLowerCase()}`, 'POST', { [kind === 'IQC' ? 'purchase_receipt_id' : 'sales_delivery_id']: source, [kind === 'IQC' ? 'supplier_id' : 'customer_id']: 'forged', items: [{ product_id: 'p2', quantity: 999 }] }); assert.equal(forged.status, 400);
      const created = await createQuality(kind, source); assert.equal(created.status, 201, created.data.error);
      const detail = await call(`/api/${kind.toLowerCase()}/${created.data.id}`); assert.equal(detail.status, 200); assert.equal(detail.data.inspection.total_quantity, 10); assert.equal(detail.data.inspection.items.length, 2); assert.ok(detail.data.inspection.items.every((item) => item[kind === 'IQC' ? 'purchase_receipt_item_id' : 'sales_delivery_item_id']));
      assert.equal((await call(`/api/${kind.toLowerCase()}/${created.data.id}`, 'PATCH', { [kind === 'IQC' ? 'supplier_id' : 'customer_id']: 'forged' })).status, 409);
      assert.equal((await complete(kind, created.data.id, 9)).status, 400);
    }
  });

  test('G-K/AB validation completes only internally consistent PASS or FAIL', async () => {
    const cases = [
      ['PASS', { passed_quantity: 9, failed_quantity: 1 }, 400], ['PASS', { passed_quantity: 9, failed_quantity: 0 }, 400],
      ['FAIL', { passed_quantity: 10, failed_quantity: 0, defect_reason: 'x', disposition: 'HOLD' }, 400], ['FAIL', { passed_quantity: 9, failed_quantity: 1, defect_reason: '', disposition: '' }, 400],
    ];
    for (let i = 0; i < cases.length; i++) { const source = seedSource('IQC', `validation-${i}`); const created = await createQuality('IQC', source); const [result, extra, expected] = cases[i]; assert.equal((await complete('IQC', created.data.id, 10, result, extra)).status, expected); }
    const passSource = seedSource('IQC', 'valid-pass'); const pass = await createQuality('IQC', passSource); assert.equal((await complete('IQC', pass.data.id, 10)).status, 200);
    const failSource = seedSource('OQC', 'valid-fail'); const fail = await createQuality('OQC', failSource); assert.equal((await complete('OQC', fail.data.id, 10, 'FAIL')).status, 200);
  });

  test('L-P/AC-AG missing, draft, failed, and passed inspections enforce atomic posting', async () => {
    for (const kind of ['IQC', 'OQC']) {
      const path = kind === 'IQC' ? 'purchase-receipts' : 'sales-deliveries';
      const missing = seedSource(kind, `missing-${kind}`); const beforeMissing = effects(); assert.equal((await call(`/api/${path}/${missing}`, 'POST', { action: 'confirm' })).status, 409); assert.deepEqual(effects(), beforeMissing);
      const draft = seedSource(kind, `draft-${kind}`); await createQuality(kind, draft); const beforeDraft = effects(); assert.equal((await call(`/api/${path}/${draft}`, 'POST', { action: 'confirm' })).status, 409); assert.deepEqual(effects(), beforeDraft);
      const failedSource = seedSource(kind, `failed-${kind}`); const failed = await createQuality(kind, failedSource); await complete(kind, failed.data.id, 10, 'FAIL'); const beforeFail = effects(); assert.equal((await call(`/api/${path}/${failedSource}`, 'POST', { action: 'confirm' })).status, 409); assert.deepEqual(effects(), beforeFail);
      const passedSource = seedSource(kind, `passed-${kind}`); const passed = await createQuality(kind, passedSource); await complete(kind, passed.data.id, 10); assert.equal((await call(`/api/${path}/${passedSource}`, 'POST', { action: 'confirm' })).status, 200); assert.equal((await call(`/api/${path}/${passedSource}`, 'POST', { action: 'confirm' })).status, 409);
    }
  });

  test('Q/R/S/AH/AI stale, cancelled, and reinspection rules preserve immutable history', async () => {
    for (const kind of ['IQC', 'OQC']) {
      const source = seedSource(kind, `stale-${kind}`); const first = await createQuality(kind, source); await complete(kind, first.data.id, 10);
      db.prepare(`UPDATE ${kind === 'IQC' ? 'purchase_order_items' : 'sales_order_items'} SET quantity=20 WHERE order_id=?`).run(`${kind === 'IQC' ? 'po' : 'so'}-stale-${kind}`);
      const itemTable = kind === 'IQC' ? 'purchase_receipt_items' : 'sales_delivery_items'; const fk = kind === 'IQC' ? 'receipt_id' : 'delivery_id'; db.prepare(`UPDATE ${itemTable} SET quantity=11 WHERE ${fk}=?`).run(source);
      const logistics = kind === 'IQC' ? 'purchase-receipts' : 'sales-deliveries'; assert.equal((await call(`/api/${logistics}/${source}`, 'POST', { action: 'confirm' })).status, 409); const detail = await call(`/api/${logistics}/${source}`); assert.equal((detail.data[kind === 'IQC' ? 'purchaseReceipt' : 'salesDelivery']).qualityState.code, 'STALE');
      const reinspect = await createQuality(kind, source); assert.equal(reinspect.status, 201); assert.equal((await complete(kind, reinspect.data.id, 11)).status, 200); assert.equal((await call(`/api/${logistics}/${source}`, 'POST', { action: 'confirm' })).status, 200);
      assert.equal(db.prepare(`SELECT result FROM ${kind === 'IQC' ? 'iqc_inspections' : 'oqc_inspections'} WHERE id=?`).get(first.data.id).result, 'PASS');
      const cancelSource = seedSource(kind, `cancel-${kind}`); const cancelled = await createQuality(kind, cancelSource); assert.equal((await call(`/api/${kind.toLowerCase()}/${cancelled.data.id}/cancel`, 'POST', {})).status, 200); assert.equal((await call(`/api/${logistics}/${cancelSource}`, 'POST', { action: 'confirm' })).status, 409);
      const failedSource = seedSource(kind, `fail-reinspect-${kind}`); const failed = await createQuality(kind, failedSource); assert.equal((await complete(kind, failed.data.id, 10, 'FAIL')).status, 200); const afterFailure = await createQuality(kind, failedSource); assert.equal((await complete(kind, afterFailure.data.id, 10)).status, 200); assert.equal((await call(`/api/${logistics}/${failedSource}`, 'POST', { action: 'confirm' })).status, 200); assert.equal(db.prepare(`SELECT result FROM ${kind === 'IQC' ? 'iqc_inspections' : 'oqc_inspections'} WHERE id=?`).get(failed.data.id).result, 'FAIL');
    }
  });

  test('migration adds FK-backed nullable links and legacy unlinked rows remain readable but ineffective', async () => {
    const iqcFks = db.prepare("PRAGMA foreign_key_list('iqc_inspections')").all(); const iqcItemFks = db.prepare("PRAGMA foreign_key_list('iqc_inspection_items')").all();
    const oqcFks = db.prepare("PRAGMA foreign_key_list('oqc_inspections')").all(); const oqcItemFks = db.prepare("PRAGMA foreign_key_list('oqc_inspection_items')").all();
    assert.ok(iqcFks.some((fk) => fk.from === 'purchase_receipt_id' && fk.table === 'purchase_receipts')); assert.ok(iqcItemFks.some((fk) => fk.from === 'purchase_receipt_item_id' && fk.table === 'purchase_receipt_items'));
    assert.ok(oqcFks.some((fk) => fk.from === 'sales_delivery_id' && fk.table === 'sales_deliveries')); assert.ok(oqcItemFks.some((fk) => fk.from === 'sales_delivery_item_id' && fk.table === 'sales_delivery_items'));
    const now = new Date().toISOString(); db.prepare("INSERT INTO iqc_inspections(id,iqc_no,supplier_id,receipt_id,status,total_quantity,sample_quantity,inspector_id,remark,created_at,updated_at) VALUES('legacy-iqc','IQC-LEGACY','sup','FREE-TEXT','COMPLETED',1,1,'user-warehouse','',?,?)").run(now, now);
    const legacy = await call('/api/iqc/legacy-iqc'); assert.equal(legacy.status, 200); assert.equal(legacy.data.inspection.legacy_unlinked, true);
  });

  test('T/U/AJ/AK multi-line documents require one current PASS covering every line', async () => {
    for (const kind of ['IQC', 'OQC']) {
      const source = seedSource(kind, `multi-${kind}`, [3, 7]); const created = await createQuality(kind, source);
      const itemTable = kind === 'IQC' ? 'iqc_inspection_items' : 'oqc_inspection_items'; const qualityFk = kind === 'IQC' ? 'iqc_id' : 'oqc_id'; db.prepare(`DELETE FROM ${itemTable} WHERE ${qualityFk}=? AND product_id='p2'`).run(created.data.id);
      assert.equal((await complete(kind, created.data.id, 10)).status, 409);
      await call(`/api/${kind.toLowerCase()}/${created.data.id}/cancel`, 'POST', {});
      const recreated = await createQuality(kind, source); assert.equal((await complete(kind, recreated.data.id, 10)).status, 200);
      assert.equal((await call(`/api/${kind === 'IQC' ? 'purchase-receipts' : 'sales-deliveries'}/${source}`, 'POST', { action: 'confirm' })).status, 200);
    }
  });
});
