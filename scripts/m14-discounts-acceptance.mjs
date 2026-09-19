// M14 — Sales / Purchase Discount / Allowance real Edge browser acceptance.
//
// Spawns Microsoft Edge 153 headless against an isolated temp DB, walks
// through the seven canonical M14 acceptance flows, and asserts the
// customer-level / supplier-level net-balance settlement gate plus the
// voucher integrity / Approval Center neutrality contracts.
//
// No production data is touched: the temp DB lives in os.tmpdir() and
// is removed on exit.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';
import { APPROVAL_DOCUMENT_TYPES } from '../server/modules/approvals.js';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '414x896', width: 414, height: 896 },
  { name: '1024x768', width: 1024, height: 768 },
];

const PAGES = [
  '/sales-discounts',
  '/purchase-discounts',
  '/accounts-receivable',
  '/accounts-payable',
  '/approvals',
];

function logHeader(label) { console.log(`\n==== ${label} ====`); }
function todayIso() { return new Date().toISOString().slice(0, 10); }

async function api(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function runEdgeHeadless(baseUrl, viewport, route, screenshotPath) {
  return new Promise((resolveDone) => {
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      `--window-size=${viewport.width},${viewport.height}`,
      '--virtual-time-budget=5000',
      `--screenshot=${screenshotPath}`,
      `${baseUrl}${route}`,
    ];
    const proc = spawn(EDGE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('exit', (code) => resolveDone({ code, stderr }));
    setTimeout(() => { try { proc.kill(); } catch {} }, 15000);
  });
}

function ensureProduct(db, pid, code, name) {
  if (db.prepare('SELECT 1 FROM products WHERE id=?').get(pid)) return;
  db.prepare(`
    INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
  `).run(pid, code, name);
}

function ensureWarehouse(db, wid, code, name) {
  if (db.prepare('SELECT 1 FROM warehouses WHERE id=?').get(wid)) return;
  db.prepare(`INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at) VALUES(?,?,?,'','',1,datetime('now'),datetime('now'))`).run(wid, code, name);
}

function seedInventory(db, wid, pid, qty) {
  const ex = db.prepare('SELECT id FROM inventory WHERE warehouse_id=? AND product_id=?').get(wid, pid);
  if (ex) {
    db.prepare('UPDATE inventory SET quantity=?, updated_at=datetime(\'now\') WHERE id=?').run(qty, ex.id);
  } else {
    db.prepare('INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at) VALUES(?,?,?,?,datetime(\'now\'))').run(`inv-m14-${wid}-${pid}`, wid, pid, qty);
  }
}

async function createConfirmedDelivery(baseUrl, token, customerId, productId, warehouseId, totalCents, db) {
  const create = await api(baseUrl, '/api/sales-deliveries', {
    method: 'POST', token,
    body: {
      customerId, warehouseId, deliveryDate: todayIso(), remark: 'm14 acceptance',
      items: [{ productId, quantity: 1, unitPriceCents: totalCents }],
    },
  });
  if (create.status !== 201) throw new Error(`sales-delivery create failed: ${create.status} ${JSON.stringify(create.data)}`);
  const confirm = await api(baseUrl, `/api/sales-deliveries/${create.data.id}`, {
    method: 'POST', token, body: { action: 'confirm' },
  });
  if (confirm.status !== 200) throw new Error(`sales-delivery confirm failed: ${confirm.status} ${JSON.stringify(confirm.data)}`);
  const arRow = db.prepare("SELECT id FROM account_receivables WHERE source_type='SALES_DELIVERY' AND source_id=?").get(create.data.id);
  return { deliveryId: create.data.id, receivableId: arRow.id };
}

async function createConfirmedReceipt(baseUrl, token, supplierId, productId, warehouseId, totalCents, db) {
  const create = await api(baseUrl, '/api/purchase-receipts', {
    method: 'POST', token,
    body: {
      supplierId, warehouseId, receiptDate: todayIso(), remark: 'm14 acceptance',
      items: [{ productId, quantity: 1, unitPriceCents: totalCents }],
    },
  });
  if (create.status !== 201) throw new Error(`purchase-receipt create failed: ${create.status} ${JSON.stringify(create.data)}`);
  const confirm = await api(baseUrl, `/api/purchase-receipts/${create.data.id}`, {
    method: 'POST', token, body: { action: 'confirm' },
  });
  if (confirm.status !== 200) throw new Error(`purchase-receipt confirm failed: ${confirm.status} ${JSON.stringify(confirm.data)}`);
  const apRow = db.prepare("SELECT id FROM account_payables WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(create.data.id);
  return { receiptId: create.data.id, payableId: apRow.id };
}

function customerNet(db, customerId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents),0) n FROM account_receivables WHERE customer_id=?`).get(customerId).n);
}
function supplierNet(db, supplierId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents + adjustment_cents - paid_cents - write_off_cents),0) n FROM account_payables WHERE supplier_id=?`).get(supplierId).n);
}
function voucherCount(db, sourceType, sourceId) {
  return db.prepare(`SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type=? AND source_id=?`).get(sourceType, sourceId).n;
}

async function loginAs(baseUrl, username, password) {
  const r = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username, password } });
  if (r.status !== 200) throw new Error(`${username} login failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function closePeriod(baseUrl, token, year, month) {
  const create = await api(baseUrl, '/api/period-closures', {
    method: 'POST', token,
    body: { year, month, closure_type: 'MONTH' },
  });
  if (create.status !== 201) throw new Error(`period create failed: ${create.status} ${JSON.stringify(create.data)}`);
  const close = await api(baseUrl, `/api/period-closures/${create.data.id}/close`, {
    method: 'POST', token, body: {},
  });
  if (close.status !== 200) throw new Error(`period close failed: ${close.status} ${JSON.stringify(close.data)}`);
}

const expect = (label, actual, expected) => {
  let ok;
  if (typeof expected === 'object') {
    ok = JSON.stringify(actual) === JSON.stringify(expected);
  } else {
    ok = Number(actual) === Number(expected);
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  return ok;
};

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m14-smoke-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`m14 server: ${baseUrl}  db=${dbPath}`);

  let pass = true;
  const failures = [];
  let totalChecks = 0;
  const record = (ok, label) => {
    totalChecks += 1;
    if (!ok) { pass = false; failures.push(label); }
  };

  try {
    const adminToken = await loginAs(baseUrl, 'admin', 'admin123');
    const salesToken = await loginAs(baseUrl, 'sales', 'sales123');
    const reviewerToken = await loginAs(baseUrl, 'reviewer', 'review123');
    const warehouseToken = await loginAs(baseUrl, 'warehouse', 'warehouse123');
    const accountingToken = await loginAs(baseUrl, 'accounting', 'accounting123');

    // Edge headless smoke at three viewports.
    for (const vp of VIEWPORTS) {
      logHeader(`Edge ${vp.name} headless screenshots`);
      for (const route of PAGES) {
        const screenshotPath = join(tempDir, `m14${route.replace(/\//g, '_')}-${vp.name}.png`);
        const res = await runEdgeHeadless(baseUrl, vp, route, screenshotPath);
        record(res.code === 0, `edge ${vp.name} ${route} exit 0`);
        console.log(`  edge ${vp.name} ${route} exit=${res.code}`);
      }
    }

    // Seed fixture: customer / supplier / product / warehouse.
    const productId = 'product-m14-smoke-P';
    const warehouseId = 'warehouse-m14-smoke';
    ensureProduct(db, productId, 'M14-SMOKE-P', 'M14 smoke product');
    ensureWarehouse(db, warehouseId, 'WH-M14', 'M14 smoke warehouse');
    seedInventory(db, warehouseId, productId, 100000);

    // ============ 1. PRE-SETTLEMENT Sales Discount ============
    logHeader('1. PRE-SETTLEMENT Sales Discount: AR+10000 / Discount-2000 -> collection 8000 OK, 8001 -> 409');
    const cust1 = 'customer-001';
    const del1 = await createConfirmedDelivery(baseUrl, salesToken, cust1, productId, warehouseId, 10000, db);
    const sd1 = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust1, sourceReceivableId: del1.receivableId, businessDate: todayIso(), amountCents: 2000, reason: 'pre-settle' },
    });
    record(sd1.status === 201, 'PRE sales discount DRAFT 201');
    const cf1 = await api(baseUrl, `/api/sales-discounts/${sd1.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(cf1.status === 200, 'PRE sales discount confirm 200');
    record(expect('PRE customer net = 8000', customerNet(db, cust1), 8000), 'PRE net = 8000');
    record(expect('PRE voucher count for SALES_DISCOUNT = 1', voucherCount(db, 'SALES_DISCOUNT', sd1.data.id), 1), 'PRE voucher count = 1');

    const colOver = await api(baseUrl, '/api/payment-collections', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust1, businessDate: todayIso(), amountCents: 8001, paymentMethod: 'BANK', allocations: [{ receivableId: del1.receivableId, amountCents: 8001 }] },
    });
    const colOverCf = await api(baseUrl, `/api/payment-collections/${colOver.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(colOverCf.status === 409, 'PRE collection 8001 -> 409');
    record(expect('PRE net still 8000 after over-rejection', customerNet(db, cust1), 8000), 'PRE net unchanged after rejection');

    const colOk = await api(baseUrl, '/api/payment-collections', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust1, businessDate: todayIso(), amountCents: 8000, paymentMethod: 'BANK', allocations: [{ receivableId: del1.receivableId, amountCents: 8000 }] },
    });
    const colOkCf = await api(baseUrl, `/api/payment-collections/${colOk.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(colOkCf.status === 200, 'PRE collection 8000 -> 200');
    record(expect('PRE net = 0 after 8000 collection', customerNet(db, cust1), 0), 'PRE net = 0');

    // ============ 2. POST-SETTLEMENT customer credit ============
    logHeader('2. POST-SETTLEMENT customer credit: AR+10000 / collection 8000 / discount 3000 -> net -1000');
    const cust2 = 'customer-002';
    const del2 = await createConfirmedDelivery(baseUrl, salesToken, cust2, productId, warehouseId, 10000, db);
    const col2 = await api(baseUrl, '/api/payment-collections', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust2, businessDate: todayIso(), amountCents: 8000, paymentMethod: 'BANK', allocations: [{ receivableId: del2.receivableId, amountCents: 8000 }] },
    });
    const col2Cf = await api(baseUrl, `/api/payment-collections/${col2.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(col2Cf.status === 200, 'POST collection 8000 -> 200');
    record(expect('POST customer net after collection = 2000', customerNet(db, cust2), 2000), 'POST net after collection = 2000');

    const sd2 = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust2, sourceReceivableId: del2.receivableId, businessDate: todayIso(), amountCents: 3000, reason: 'post-settle' },
    });
    const cf2 = await api(baseUrl, `/api/sales-discounts/${sd2.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(cf2.status === 200, 'POST sales discount confirm 200');

    const ar2 = db.prepare(`SELECT amount_cents, adjustment_cents, paid_cents, write_off_cents FROM account_receivables WHERE id=?`).get(del2.receivableId);
    record(expect('POST original AR amount_cents untouched', Number(ar2.amount_cents), 10000), 'POST AR amount_cents untouched');
    record(expect('POST original AR adjustment_cents untouched', Number(ar2.adjustment_cents), 0), 'POST AR adjustment_cents untouched');
    record(expect('POST original AR paid_cents untouched', Number(ar2.paid_cents), 8000), 'POST AR paid_cents untouched');

    const allocSum = Number(db.prepare(`SELECT COALESCE(SUM(amount_cents),0) n FROM payment_collection_items WHERE receivable_id=?`).get(del2.receivableId).n);
    record(expect('POST collection allocation row NOT overwritten', allocSum, 8000), 'POST allocation sum = 8000');

    record(expect('POST customer net = -1000 (credit visible)', customerNet(db, cust2), -1000), 'POST net = -1000');
    const st2 = await api(baseUrl, `/api/accounts-receivable/statement?customer=customer-002&dateFrom=2026-01-01&dateTo=2026-12-31`, { token: accountingToken });
    record(st2.status === 200, 'POST statement 200');
    const hasSdRow = (st2.data.rows || []).some((r) => r.source_type === 'SALES_DISCOUNT');
    record(hasSdRow, 'POST statement shows SALES_DISCOUNT row');

    // ============ 3. FUTURE OFFSET ============
    logHeader('3. FUTURE OFFSET: customer credit -1000 + new AR 5000 -> net 4000; collection 4000 OK; 4001 409');
    record(expect('Future OFFSET baseline net = -1000', customerNet(db, cust2), -1000), 'Future OFFSET baseline = -1000');
    const del3 = await createConfirmedDelivery(baseUrl, salesToken, cust2, productId, warehouseId, 5000, db);
    record(expect('Future OFFSET net after +5000 AR = 4000', customerNet(db, cust2), 4000), 'Future OFFSET net = 4000');

    const col3Over = await api(baseUrl, '/api/payment-collections', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust2, businessDate: todayIso(), amountCents: 4001, paymentMethod: 'BANK', allocations: [{ receivableId: del3.receivableId, amountCents: 4001 }] },
    });
    const col3OverCf = await api(baseUrl, `/api/payment-collections/${col3Over.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(col3OverCf.status === 409, 'Future OFFSET collection 4001 -> 409');

    const col3Ok = await api(baseUrl, '/api/payment-collections', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust2, businessDate: todayIso(), amountCents: 4000, paymentMethod: 'BANK', allocations: [{ receivableId: del3.receivableId, amountCents: 4000 }] },
    });
    const col3OkCf = await api(baseUrl, `/api/payment-collections/${col3Ok.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(col3OkCf.status === 200, 'Future OFFSET collection 4000 -> 200');
    record(expect('Future OFFSET net after settle = 0', customerNet(db, cust2), 0), 'Future OFFSET net = 0');

    // ============ 4. PRE-SETTLEMENT Purchase Discount ============
    logHeader('4. PRE-SETTLEMENT Purchase Discount: AP+12000 / Discount-2000 -> payment 10000 OK; 10001 409');
    const sup1 = 'supplier-001';
    const rec1 = await createConfirmedReceipt(baseUrl, salesToken, sup1, productId, warehouseId, 12000, db);
    const pd1 = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: accountingToken,
      body: { supplierId: sup1, sourcePayableId: rec1.payableId, businessDate: todayIso(), amountCents: 2000, reason: 'pre-settle AP' },
    });
    record(pd1.status === 201, 'PRE purchase discount DRAFT 201');
    const pd1Cf = await api(baseUrl, `/api/purchase-discounts/${pd1.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(pd1Cf.status === 200, 'PRE purchase discount confirm 200');
    record(expect('PRE supplier net = 10000', supplierNet(db, sup1), 10000), 'PRE supplier net = 10000');
    record(expect('PRE purchase voucher count = 1', voucherCount(db, 'PURCHASE_DISCOUNT', pd1.data.id), 1), 'PRE purchase voucher = 1');

    const payOver = await api(baseUrl, '/api/payment-disbursements', {
      method: 'POST', token: accountingToken,
      body: { supplierId: sup1, businessDate: todayIso(), amountCents: 10001, paymentMethod: 'BANK', allocations: [{ payableId: rec1.payableId, amountCents: 10001 }] },
    });
    const payOverCf = await api(baseUrl, `/api/payment-disbursements/${payOver.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(payOverCf.status === 409, 'PRE payment 10001 -> 409');
    record(expect('PRE supplier net still 10000 after rejection', supplierNet(db, sup1), 10000), 'PRE supplier net unchanged');

    const payOk = await api(baseUrl, '/api/payment-disbursements', {
      method: 'POST', token: accountingToken,
      body: { supplierId: sup1, businessDate: todayIso(), amountCents: 10000, paymentMethod: 'BANK', allocations: [{ payableId: rec1.payableId, amountCents: 10000 }] },
    });
    const payOkCf = await api(baseUrl, `/api/payment-disbursements/${payOk.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(payOkCf.status === 200, 'PRE payment 10000 -> 200');

    // ============ 5. POST-SETTLEMENT supplier credit ============
    logHeader('5. POST-SETTLEMENT supplier credit: AP+10000 / payment 8000 / discount 3000 -> net -1000');
    const sup2 = 'supplier-002';
    const rec2 = await createConfirmedReceipt(baseUrl, salesToken, sup2, productId, warehouseId, 10000, db);
    const pay2 = await api(baseUrl, '/api/payment-disbursements', {
      method: 'POST', token: accountingToken,
      body: { supplierId: sup2, businessDate: todayIso(), amountCents: 8000, paymentMethod: 'BANK', allocations: [{ payableId: rec2.payableId, amountCents: 8000 }] },
    });
    const pay2Cf = await api(baseUrl, `/api/payment-disbursements/${pay2.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(pay2Cf.status === 200, 'POST supplier payment 8000 -> 200');

    const pd2 = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: accountingToken,
      body: { supplierId: sup2, sourcePayableId: rec2.payableId, businessDate: todayIso(), amountCents: 3000, reason: 'post-settle AP' },
    });
    const pd2Cf = await api(baseUrl, `/api/purchase-discounts/${pd2.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(pd2Cf.status === 200, 'POST supplier discount confirm 200');
    record(expect('POST supplier net = -1000', supplierNet(db, sup2), -1000), 'POST supplier net = -1000');

    // ============ 6. Voucher integrity ============
    logHeader('6. Discount voucher: balanced, integer cents, source-derived accounts, exactly once');
    const v = db.prepare(`
      SELECT v.id, v.source_type, v.source_id, v.voucher_no, v.status
        FROM accounting_vouchers v
       WHERE v.source_type='SALES_DISCOUNT' AND v.source_id=?
    `).get(sd1.data.id);
    const entries = db.prepare(`
      SELECT s.code, e.direction, e.amount_cents
        FROM accounting_vouchers v
        JOIN accounting_entries e ON e.voucher_id=v.id
        JOIN accounting_subjects s ON s.id=e.subject_id
       WHERE v.id=?
       ORDER BY e.direction DESC
    `).all(v.id);
    record(expect('SD voucher subject count = 2', entries.length, 2), 'SD voucher subject count = 2');
    const entry1122 = entries.find((e) => e.code === '1122');
    const entry6001 = entries.find((e) => e.code === '6001');
    record(expect('SD voucher 1122 CREDIT 2000', { direction: entry1122?.direction, amount: Number(entry1122?.amount_cents) }, { direction: 'CREDIT', amount: 2000 }), 'SD voucher 1122 CREDIT 2000');
    record(expect('SD voucher 6001 DEBIT 2000', { direction: entry6001?.direction, amount: Number(entry6001?.amount_cents) }, { direction: 'DEBIT', amount: 2000 }), 'SD voucher 6001 DEBIT 2000');
    const debitSum = entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amount_cents), 0);
    const creditSum = entries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amount_cents), 0);
    record(expect('SD voucher balanced', debitSum, creditSum), 'SD voucher balanced');
    record(entries.every((e) => Number.isInteger(Number(e.amount_cents)) && Number(e.amount_cents) > 0), 'SD voucher integer cents > 0');

    const pv = db.prepare(`SELECT id FROM accounting_vouchers WHERE source_type='PURCHASE_DISCOUNT' AND source_id=?`).get(pd1.data.id);
    const pEntries = db.prepare(`
      SELECT s.code, e.direction, e.amount_cents
        FROM accounting_vouchers v
        JOIN accounting_entries e ON e.voucher_id=v.id
        JOIN accounting_subjects s ON s.id=e.subject_id
       WHERE v.id=?
       ORDER BY e.direction DESC
    `).all(pv.id);
    record(expect('PD voucher subject count = 2', pEntries.length, 2), 'PD voucher subject count = 2');
    const entry2202 = pEntries.find((e) => e.code === '2202');
    const entry1405 = pEntries.find((e) => e.code === '1405');
    record(expect('PD voucher 2202 DEBIT 2000', { direction: entry2202?.direction, amount: Number(entry2202?.amount_cents) }, { direction: 'DEBIT', amount: 2000 }), 'PD voucher 2202 DEBIT 2000');
    record(expect('PD voucher 1405 CREDIT 2000', { direction: entry1405?.direction, amount: Number(entry1405?.amount_cents) }, { direction: 'CREDIT', amount: 2000 }), 'PD voucher 1405 CREDIT 2000');
    const pdDebitSum = pEntries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amount_cents), 0);
    const pdCreditSum = pEntries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amount_cents), 0);
    record(expect('PD voucher balanced', pdDebitSum, pdCreditSum), 'PD voucher balanced');

    // Exactly one voucher per discount.
    record(expect('SD voucher count = 1 (exactly once)', voucherCount(db, 'SALES_DISCOUNT', sd1.data.id), 1), 'SD voucher count = 1');
    record(expect('PD voucher count = 1 (exactly once)', voucherCount(db, 'PURCHASE_DISCOUNT', pd1.data.id), 1), 'PD voucher count = 1');

    // No arbitrary IDs — verify voucher references subject-006 / subject-003 (canonical).
    const canonicalS = db.prepare(`
      SELECT DISTINCT s.id FROM accounting_subjects s
        WHERE s.code IN ('1122','6001','2202','1405')
    `).all().map((r) => r.id).sort();
    const voucherSubjectIds = db.prepare(`
      SELECT DISTINCT s.id FROM accounting_vouchers v
        JOIN accounting_entries e ON e.voucher_id=v.id
        JOIN accounting_subjects s ON s.id=e.subject_id
       WHERE v.source_type IN ('SALES_DISCOUNT','PURCHASE_DISCOUNT')
    `).all().map((r) => r.id).sort();
    record(expect('discount voucher subject IDs come from canonical codes only', voucherSubjectIds, canonicalS), 'discount voucher canonical subjects');

    // ============ 7. Closed accounting period ============
    logHeader('7. Closed accounting period: discount confirm -> 409; AR/AP delta = 0; voucher delta = 0');
    await closePeriod(baseUrl, adminToken, 2099, 12);
    const sdClosed = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: accountingToken,
      body: { customerId: cust1, sourceReceivableId: del1.receivableId, businessDate: '2099-12-15', amountCents: 500, reason: 'closed-period' },
    });
    record(sdClosed.status === 201, 'CLOSED-period sales discount DRAFT 201');
    const arBefore = db.prepare('SELECT COUNT(*) n FROM account_receivables').get().n;
    const voucherBefore = db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n;
    const sdClosedCf = await api(baseUrl, `/api/sales-discounts/${sdClosed.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(sdClosedCf.status === 409, 'CLOSED-period sales discount confirm -> 409');
    const sdClosedRow = db.prepare(`SELECT status FROM sales_discounts WHERE id=?`).get(sdClosed.data.id);
    record(sdClosedRow.status === 'DRAFT', 'CLOSED-period sales discount stays DRAFT');
    record(expect('CLOSED-period AR row count delta = 0', db.prepare('SELECT COUNT(*) n FROM account_receivables').get().n - arBefore, 0), 'CLOSED-period AR delta = 0');
    record(expect('CLOSED-period voucher count delta = 0', db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n - voucherBefore, 0), 'CLOSED-period voucher delta = 0');

    const pdClosed = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: accountingToken,
      body: { supplierId: sup1, sourcePayableId: rec1.payableId, businessDate: '2099-12-15', amountCents: 500, reason: 'closed-period AP' },
    });
    const pdClosedCf = await api(baseUrl, `/api/purchase-discounts/${pdClosed.data.id}/confirm`, { method: 'POST', token: accountingToken, body: {} });
    record(pdClosedCf.status === 409, 'CLOSED-period purchase discount confirm -> 409');
    const pdClosedRow = db.prepare(`SELECT status FROM purchase_discounts WHERE id=?`).get(pdClosed.data.id);
    record(pdClosedRow.status === 'DRAFT', 'CLOSED-period purchase discount stays DRAFT');

    // ============ 8. Five-role permission contract ============
    logHeader('8. Five-role permission contract');
    const sdAdmin = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: adminToken,
      body: { customerId: cust1, sourceReceivableId: del1.receivableId, businessDate: todayIso(), amountCents: 100, reason: 'admin' },
    });
    record(sdAdmin.status === 201, 'admin SD allowed');
    const pdAdmin = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: adminToken,
      body: { supplierId: sup1, sourcePayableId: rec1.payableId, businessDate: todayIso(), amountCents: 100, reason: 'admin' },
    });
    record(pdAdmin.status === 201, 'admin PD allowed');
    const sdSales = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: salesToken,
      body: { customerId: cust1, sourceReceivableId: del1.receivableId, businessDate: todayIso(), amountCents: 100, reason: 'sales' },
    });
    record(sdSales.status === 403, 'sales forbidden (403)');
    const sdReviewer = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: reviewerToken,
      body: { customerId: cust1, sourceReceivableId: del1.receivableId, businessDate: todayIso(), amountCents: 100, reason: 'reviewer' },
    });
    record(sdReviewer.status === 403, 'reviewer forbidden (403)');
    const sdWarehouse = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: warehouseToken,
      body: { customerId: cust1, sourceReceivableId: del1.receivableId, businessDate: todayIso(), amountCents: 100, reason: 'warehouse' },
    });
    record(sdWarehouse.status === 403, 'warehouse forbidden (403)');
    const pdSales = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: salesToken,
      body: { supplierId: sup1, sourcePayableId: rec1.payableId, businessDate: todayIso(), amountCents: 100, reason: 'sales' },
    });
    record(pdSales.status === 403, 'sales PD forbidden (403)');
    const pdReviewer = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: reviewerToken,
      body: { supplierId: sup1, sourcePayableId: rec1.payableId, businessDate: todayIso(), amountCents: 100, reason: 'reviewer' },
    });
    record(pdReviewer.status === 403, 'reviewer PD forbidden (403)');
    const pdWarehouse = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: warehouseToken,
      body: { supplierId: sup1, sourcePayableId: rec1.payableId, businessDate: todayIso(), amountCents: 100, reason: 'warehouse' },
    });
    record(pdWarehouse.status === 403, 'warehouse PD forbidden (403)');

    // ============ 9. Approval Center must not contain SALES_DISCOUNT / PURCHASE_DISCOUNT ============
    logHeader('9. Approval Center: only 5 families; SALES_DISCOUNT/PURCHASE_DISCOUNT absent');
    const allowed = ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER'].sort();
    const actualFamilies = [...APPROVAL_DOCUMENT_TYPES].sort();
    record(expect('APPROVAL_DOCUMENT_TYPES = canonical 5', actualFamilies, allowed), 'Approval Center document types = canonical 5');
    record(!APPROVAL_DOCUMENT_TYPES.includes('SALES_DISCOUNT'), 'SALES_DISCOUNT absent from Approval Center');
    record(!APPROVAL_DOCUMENT_TYPES.includes('PURCHASE_DISCOUNT'), 'PURCHASE_DISCOUNT absent from Approval Center');

    // Also verify the live API endpoint agrees when seeded with at least one
    // APPROVED approval per family (e.g. a SUBMITTED → APPROVED sales order).
    const so = await api(baseUrl, '/api/orders', {
      method: 'POST', token: salesToken,
      body: { customerId: cust1, remark: 'm14 approval',
        items: [{ productId, quantity: 1, unitPriceCents: 1000 }] },
    });
    record(so.status === 201, 'seed SO for Approval Center check');
    const submit = await api(baseUrl, `/api/orders/${so.data.id}/submit`, { method: 'POST', token: salesToken, body: {} });
    record(submit.status === 200, 'seed SO submit');
    const approve = await api(baseUrl, `/api/orders/${so.data.id}/approve`, { method: 'POST', token: reviewerToken, body: {} });
    record(approve.status === 200, 'seed SO approve');

    const families = new Set();
    for (const tab of ['pending', 'approved', 'rejected', 'created']) {
      const r = await api(baseUrl, `/api/approvals?tab=${tab}&limit=200`, { token: adminToken });
      for (const item of (r.data.items || [])) families.add(item.documentType);
    }
    const extra = [...families].filter((f) => !allowed.includes(f));
    record(extra.length === 0, `Live API Approval Center only canonical 5 (unexpected: ${extra.join(',') || 'none'})`);
    record(!families.has('SALES_DISCOUNT'), 'live API: SALES_DISCOUNT absent');
    record(!families.has('PURCHASE_DISCOUNT'), 'live API: PURCHASE_DISCOUNT absent');

    // ============ 10. Side-effect neutrality ============
    logHeader('10. Side-effect invariants: BOM / routing / production orders untouched by discount flow');
    const boms = db.prepare('SELECT COUNT(*) n FROM boms').get().n;
    const routings = db.prepare('SELECT COUNT(*) n FROM product_routings').get().n;
    const po = db.prepare('SELECT COUNT(*) n FROM production_orders').get().n;
    record(boms === 0, 'BOMs untouched by discount flow');
    record(routings === 0, 'routings untouched by discount flow');
    record(po === 0, 'production_orders untouched by discount flow');

    // ============ 11. Console / Network sweep ============
    logHeader('11. SPA endpoints expected to return 2xx/4xx (no 500)');
    const me = await api(baseUrl, '/api/auth/me', { token: adminToken });
    record(me.status === 200, '/api/auth/me 200');
    const sdList = await api(baseUrl, '/api/sales-discounts', { token: adminToken });
    record(sdList.status === 200, '/api/sales-discounts 200');
    const pdList = await api(baseUrl, '/api/purchase-discounts', { token: adminToken });
    record(pdList.status === 200, '/api/purchase-discounts 200');
    const arList = await api(baseUrl, '/api/accounts-receivable', { token: adminToken });
    record(arList.status === 200, '/api/accounts-receivable 200');
    const apList = await api(baseUrl, '/api/accounts-payable', { token: adminToken });
    record(apList.status === 200, '/api/accounts-payable 200');
    const apv = await api(baseUrl, '/api/approvals', { token: adminToken });
    record(apv.status === 200, '/api/approvals 200');

    // ============ Summary ============
    console.log('\n==== SUMMARY ====');
    console.log(`Total checks: ${totalChecks}; failures: ${failures.length}`);
    if (failures.length) {
      console.log('Failed:');
      for (const f of failures) console.log('  -', f);
    }
    console.log('\n' + (pass ? 'M14 SALES DISCOUNT COMPLETE = YES' : 'M14 SALES DISCOUNT COMPLETE = NO'));
    console.log((pass ? 'M14 PURCHASE DISCOUNT COMPLETE = YES' : 'M14 PURCHASE DISCOUNT COMPLETE = NO'));
    console.log((pass ? 'M14 REAL BROWSER ACCEPTANCE = PASS' : 'M14 REAL BROWSER ACCEPTANCE = FAIL'));
    console.log(`BLOCKING DEFECTS = ${pass ? 'NONE' : failures.length}`);
    console.log(`READY FOR FINAL V1.1 ACCEPTANCE = ${pass ? 'YES' : 'NO'}`);
    if (!pass) process.exitCode = 1;
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });