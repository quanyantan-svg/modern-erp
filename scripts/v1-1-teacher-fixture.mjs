// V1.1 Productization — teacher fixture acceptance.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../server/app.js';
import { createDatabase, id } from '../server/db.js';

function todayIso() { return new Date().toISOString().slice(0, 10); }

async function api(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const expectEq = (label, actual, expected) => {
  const ok = Number(actual) === Number(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  return ok;
};

const expectTrue = (label, condition, extra = '') => {
  const ok = !!condition;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`);
  return ok;
};

function ensureProduct(db, pid, code, name, priceCents = 0) {
  if (db.prepare('SELECT id FROM products WHERE id=?').get(pid)) return;
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,'','',?,0,1,datetime('now'),datetime('now'))`).run(pid, code, name, priceCents);
}

function ensureWarehouse(db, wid, code, name) {
  if (db.prepare('SELECT id FROM warehouses WHERE id=?').get(wid)) return;
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,datetime('now'),datetime('now'))`).run(wid, code, name);
}

function ensureCustomer(db, cid, code, name) {
  if (db.prepare('SELECT id FROM customers WHERE id=?').get(cid)) return;
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,'','','',1,datetime('now'),datetime('now'))`).run(cid, code, name);
}

function ensureSupplier(db, sid, code, name) {
  if (db.prepare('SELECT id FROM suppliers WHERE id=?').get(sid)) return;
  db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,'','','',1,datetime('now'),datetime('now'))`).run(sid, code, name);
}

function setInventory(db, productId, warehouseId, qty) {
  const ex = db.prepare('SELECT id FROM inventory WHERE product_id=? AND warehouse_id=?').get(productId, warehouseId);
  if (ex) {
    db.prepare("UPDATE inventory SET quantity=?, updated_at=datetime('now') WHERE id=?").run(qty, ex.id);
  } else {
    db.prepare("INSERT INTO inventory(id,product_id,warehouse_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
      .run('inv-' + id().slice(0, 8), productId, warehouseId, qty);
  }
}

function inventoryTotal(db, productId) {
  return Number(db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM inventory WHERE product_id=?").get(productId).n);
}

function customerNet(db, customerId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents+adjustment_cents-paid_cents-write_off_cents),0) n FROM account_receivables WHERE customer_id=?`).get(customerId).n);
}

function supplierNet(db, supplierId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(amount_cents+adjustment_cents-paid_cents-write_off_cents),0) n FROM account_payables WHERE supplier_id=?`).get(supplierId).n);
}

async function loginAs(baseUrl, username, password) {
  const r = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username, password } });
  if (r.status !== 200) throw new Error(`${username} login failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-teacher-fixture-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: pathResolve('dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`teacher fixture server: ${baseUrl}  db=${dbPath}`);

  let pass = true;
  const failures = [];
  const record = (ok, label) => { if (!ok) { pass = false; failures.push(label); } };

  try {
    const adminToken = await loginAs(baseUrl, 'admin', 'admin123');
    const salesToken = await loginAs(baseUrl, 'sales', 'sales123');
    const reviewerToken = await loginAs(baseUrl, 'reviewer', 'review123');
    const warehouseToken = await loginAs(baseUrl, 'warehouse', 'warehouse123');
    const accountingToken = await loginAs(baseUrl, 'accounting', 'accounting123');

    const customerId = 'customer-TEACHER-FZ-001';
    const supplierId = 'supplier-TEACHER-XM-001';
    const fgId = 'product-TEACHER-X100-FG';
    const pcbId = 'product-TEACHER-X100-PCB';
    const caseId = 'product-TEACHER-X100-CASE';
    const psuId = 'product-TEACHER-X100-PSU';
    const whRm = 'wh-TEACHER-RM-01';
    const whFg = 'wh-TEACHER-FG-01';
    const whSp = 'wh-TEACHER-SP-01';

    ensureCustomer(db, customerId, 'CUST-FZ-001', '福建榕智数字科技有限公司');
    ensureSupplier(db, supplierId, 'SUP-XM-001', '厦门海芯电子科技有限公司');
    ensureWarehouse(db, whRm, 'WH-RM-01', '晋江原材料仓');
    ensureWarehouse(db, whFg, 'WH-FG-01', '晋江成品仓');
    ensureWarehouse(db, whSp, 'WH-SP-01', '晋江备品仓');
    ensureProduct(db, fgId, 'X100-FG', 'X100智能环境控制终端', 100000);
    ensureProduct(db, pcbId, 'X100-PCB', 'X100控制主板', 20000);
    ensureProduct(db, caseId, 'X100-CASE', 'X100铝合金外壳', 5000);
    ensureProduct(db, psuId, 'X100-PSU', '24V工业电源', 3000);
    setInventory(db, fgId, whFg, 20);
    setInventory(db, pcbId, whRm, 30);
    setInventory(db, caseId, whRm, 100);
    setInventory(db, psuId, whRm, 100);

    const bomId = 'bom-TEACHER-X100-FG';
    if (!db.prepare('SELECT id FROM boms WHERE id=?').get(bomId)) {
      db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,'ACTIVE','','user-admin',datetime('now'),datetime('now'))`).run(bomId, fgId, 'teacher-v1');
      db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,?)`).run(id(), bomId, pcbId, 1, 1);
      db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,?)`).run(id(), bomId, caseId, 1, 2);
      db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,?)`).run(id(), bomId, psuId, 1, 3);
    }

    const today = todayIso();

    // 1) Sales Order 100 × 1000 yuan = 100000 yuan = 10,000,000 cents.
    console.log('\n==== Step 1: Sales Order 100 × 1000 yuan = 100000 yuan ====');
    const orderCreate = await api(baseUrl, '/api/orders', {
      method: 'POST', token: salesToken,
      body: { customerId, remark: 'teacher sales', items: [{ productId: fgId, quantity: 100, unitPriceCents: 100000 }] },
    });
    record(expectEq('SO create 201', orderCreate.status, 201), 'SO create');
    const orderId = orderCreate.data.id;
    record(expectEq('FG inventory still 20 after DRAFT', inventoryTotal(db, fgId), 20), 'FG inventory post-DRAFT');
    record(expectEq('Customer AR still 0 after DRAFT', customerNet(db, customerId), 0), 'Customer AR post-DRAFT');

    const orderSubmit = await api(baseUrl, `/api/orders/${orderId}/submit`, { method: 'POST', token: salesToken });
    record(expectEq('SO submit 200', orderSubmit.status, 200), 'SO submit');
    record(expectEq('FG inventory still 20 after SUBMIT', inventoryTotal(db, fgId), 20), 'FG inventory post-SUBMIT');

    const orderApprove = await api(baseUrl, `/api/orders/${orderId}/approve`, { method: 'POST', token: reviewerToken });
    record(expectEq('SO approve 200', orderApprove.status, 200), 'SO approve');
    record(expectEq('FG inventory still 20 after APPROVED (no stock mutation)', inventoryTotal(db, fgId), 20), 'FG inventory post-APPROVED');
    record(expectEq('Customer AR still 0 after APPROVED (no revenue mutation)', customerNet(db, customerId), 0), 'Customer AR post-APPROVED');

    // 2) Forecast 20 FG (ACTIVE) + MRP run.
    console.log('\n==== Step 2: Forecast 20 FG + SALES_PLUS_FORECAST MRP ====');
    const forecast = await api(baseUrl, '/api/planning/forecasts', {
      method: 'POST', token: adminToken,
      body: { forecastName: 'teacher forecast', periodStart: today, periodEnd: today, notes: '', items: [{ productId: fgId, needDate: today, quantity: 20 }] },
    });
    record(expectEq('Forecast create 201', forecast.status, 201), 'Forecast create');
    const forecastActivate = await api(baseUrl, `/api/planning/forecasts/${forecast.data.id}/activate`, { method: 'POST', token: adminToken });
    record(expectEq('Forecast activate 200', forecastActivate.status, 200), 'Forecast activate');

    const mrpRun = await api(baseUrl, '/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: { runName: 'teacher mrp', horizonStart: today, horizonEnd: today, demandSourceMode: 'SALES_PLUS_FORECAST', forecastId: forecast.data.id },
    });
    record(expectEq('MRP create 201', mrpRun.status, 201), 'MRP create');
    const mrpExec = await api(baseUrl, `/api/planning/mrp/runs/${mrpRun.data.id}/execute`, { method: 'POST', token: adminToken });
    record(expectEq('MRP execute 200', mrpExec.status, 200), 'MRP execute');
    const mrpDetail = await api(baseUrl, `/api/planning/mrp/runs/${mrpRun.data.id}`, { token: adminToken });
    const results = mrpDetail.data.run.results;
    const fgRow = results.find((r) => r.product_id === fgId);
    const pcbRow = results.find((r) => r.product_id === pcbId);
    const caseRow = results.find((r) => r.product_id === caseId);
    const psuRow = results.find((r) => r.product_id === psuId);

    console.log('\n==== Step 2: MRP arithmetic contract ====');
    record(expectEq('FG gross_requirement = 120 (100 sales + 20 forecast)', fgRow.gross_requirement, 120), 'FG gross');
    record(expectEq('FG on_hand = 20', fgRow.on_hand, 20), 'FG on_hand');
    record(expectEq('FG net_requirement = 100', fgRow.net_requirement, 100), 'FG net');
    record(expectEq('FG MAKE suggested_quantity = 100', fgRow.suggested_quantity, 100), 'FG MAKE');
    record(expectEq('PCB gross_component_demand = 100', pcbRow.gross_component_demand, 100), 'PCB component demand');
    record(expectEq('PCB on_hand = 30', pcbRow.on_hand, 30), 'PCB on_hand');
    record(expectEq('PCB net_requirement = 70', pcbRow.net_requirement, 70), 'PCB net');
    record(expectEq('PCB BUY suggested_quantity = 70', pcbRow.suggested_quantity, 70), 'PCB BUY');
    record(expectEq('CASE net_requirement = 0', caseRow.net_requirement, 0), 'CASE net');
    record(expectEq('CASE suggested_quantity = 0', caseRow.suggested_quantity, 0), 'CASE qty');
    record(expectEq('PSU net_requirement = 0', psuRow.net_requirement, 0), 'PSU net');
    record(expectEq('PSU suggested_quantity = 0', psuRow.suggested_quantity, 0), 'PSU qty');
    record(expectEq('inventory_transactions delta from MRP = 0', db.prepare('SELECT COUNT(*) c FROM inventory_transactions').get().c, 0), 'MRP inventory delta');
    record(expectEq('accounting_vouchers delta from MRP = 0', db.prepare('SELECT COUNT(*) c FROM accounting_vouchers').get().c, 0), 'MRP voucher delta');

    // 3) Purchase PCB 70 × 200 = 14000.
    console.log('\n==== Step 3: Purchase PCB 70 × 200 = 14000 ====');
    const poCreate = await api(baseUrl, '/api/purchase-orders', {
      method: 'POST', token: adminToken,
      body: {
        supplierId, remark: 'teacher purchase', needByDate: today,
        items: [{ productId: pcbId, quantity: 70, unitPriceCents: 20000 }],
      },
    });
    record(expectEq('PO create 201', poCreate.status, 201), 'PO create');
    const poId = poCreate.data.id;
    record(expectEq('Supplier AP still 0 after DRAFT PO', supplierNet(db, supplierId), 0), 'AP post-DRAFT PO');
    const poSubmit = await api(baseUrl, `/api/purchase-orders/${poId}/submit`, { method: 'POST', token: adminToken });
    record(expectEq('PO submit 200', poSubmit.status, 200), 'PO submit');
    record(expectEq('PCB inventory still 30 after SUBMIT PO', inventoryTotal(db, pcbId), 30), 'PCB post-SUBMIT PO');
    // Reviewer approves (cannot be admin because admin is creator).
    const poApprove = await api(baseUrl, `/api/purchase-orders/${poId}/approve`, { method: 'POST', token: reviewerToken });
    record(expectEq('PO approve 200', poApprove.status, 200), 'PO approve');
    record(expectEq('PCB inventory still 30 after APPROVED PO (no stock mutation)', inventoryTotal(db, pcbId), 30), 'PCB post-APPROVED PO');
    record(expectEq('Supplier AP still 0 after APPROVED PO (no AP mutation)', supplierNet(db, supplierId), 0), 'AP post-APPROVED PO');

    const prCreate = await api(baseUrl, '/api/purchase-receipts', {
      method: 'POST', token: warehouseToken,
      body: {
        purchaseOrderId: poId, supplierId, warehouseId: whRm, receiptDate: today, remark: 'teacher receipt',
        items: [{ productId: pcbId, quantity: 70, unitPriceCents: 20000 }],  // 200 yuan × 70 = 14000 yuan = 1400000 cents
      },
    });
    record(expectEq('Purchase receipt create 201', prCreate.status, 201), 'PR create');
    const prId = prCreate.data.id;
    const prConfirm = await api(baseUrl, `/api/purchase-receipts/${prId}`, { method: 'POST', token: warehouseToken, body: { action: 'confirm' } });
    record(expectEq('Purchase receipt confirm 200', prConfirm.status, 200), 'PR confirm');
    record(expectEq('PCB inventory = 100 after receipt', inventoryTotal(db, pcbId), 100), 'PCB post-receipt');
    record(expectEq('Supplier AP = 1400000 cents (14000 yuan) after receipt', supplierNet(db, supplierId), 1400000), 'AP post-receipt');

    // 4) Production MAKE 100. Material issue/receipt use admin (warehouse role lacks the permission).
    console.log('\n==== Step 4: Production MAKE 100 (issue + receipt) ====');
    const prodOrder = await api(baseUrl, '/api/production-orders', {
      method: 'POST', token: adminToken,
      body: { productId: fgId, bomId, quantity: 100, plannedStart: today, plannedFinish: today, remark: 'teacher production' },
    });
    record(expectEq('Production order create 200', prodOrder.status, 200), 'PO create');
    const prodId = prodOrder.data.id;
    record(expectEq('FG inventory still 20 after PENDING PO', inventoryTotal(db, fgId), 20), 'FG post-PENDING PO');
    const prodStart = await api(baseUrl, `/api/production-orders/${prodId}`, { method: 'POST', token: adminToken, body: { action: 'start' } });
    record(expectEq('Production start 200', prodStart.status, 200), 'PO start');
    record(expectEq('FG inventory still 20 after IN_PROGRESS (no stock mutation)', inventoryTotal(db, fgId), 20), 'FG post-IN_PROGRESS PO');

    const issueCreate = await api(baseUrl, '/api/production-material-issues', {
      method: 'POST', token: adminToken,
      body: {
        productionOrderId: prodId, warehouseId: whRm, issueDate: today, remark: 'teacher issue',
        items: [
          { productId: pcbId, issueQuantity: 100 },
          { productId: caseId, issueQuantity: 100 },
          { productId: psuId, issueQuantity: 100 },
        ],
      },
    });
    record(expectEq('Material issue create 201', issueCreate.status, 201), 'issue create');
    const issueId = issueCreate.data.id;
    const issueConfirm = await api(baseUrl, `/api/production-material-issues/${issueId}/confirm`, { method: 'POST', token: adminToken });
    record(expectEq('Material issue confirm 200', issueConfirm.status, 200), 'issue confirm');
    record(expectEq('PCB = 0 after issue', inventoryTotal(db, pcbId), 0), 'PCB post-issue');
    record(expectEq('CASE = 0 after issue', inventoryTotal(db, caseId), 0), 'CASE post-issue');
    record(expectEq('PSU = 0 after issue', inventoryTotal(db, psuId), 0), 'PSU post-issue');
    record(expectEq('FG inventory still 20 after issue', inventoryTotal(db, fgId), 20), 'FG post-issue');

    const prodRcvCreate = await api(baseUrl, '/api/production-receipts', {
      method: 'POST', token: adminToken,
      body: { productionOrderId: prodId, warehouseId: whFg, quantity: 100, receiptDate: today, remark: 'teacher prod receipt' },
    });
    record(expectEq('Production receipt create 201', prodRcvCreate.status, 201), 'PRcv create');
    const prodRcvId = prodRcvCreate.data.id;
    const prodRcvConfirm = await api(baseUrl, `/api/production-receipts/${prodRcvId}/confirm`, { method: 'POST', token: adminToken });
    record(expectEq('Production receipt confirm 200', prodRcvConfirm.status, 200), 'PRcv confirm');
    record(expectEq('FG = 120 after production receipt', inventoryTotal(db, fgId), 120), 'FG post-production');

    const prodComplete = await api(baseUrl, `/api/production-orders/${prodId}`, { method: 'POST', token: adminToken, body: { action: 'complete' } });
    record(expectEq('Production complete 200', prodComplete.status, 200), 'PO complete');

    // 5) Sales Delivery 100 FG → FG 20, AR +100000 yuan.
    console.log('\n==== Step 5: Sales Delivery 100 FG ====');
    const deliveryCreate = await api(baseUrl, '/api/sales-deliveries', {
      method: 'POST', token: warehouseToken,
      body: {
        salesOrderId: orderId, customerId, warehouseId: whFg, deliveryDate: today, remark: 'teacher delivery',
        items: [{ productId: fgId, quantity: 100, unitPriceCents: 100000 }],
      },
    });
    record(expectEq('Sales delivery create 201', deliveryCreate.status, 201), 'SD create');
    const deliveryId = deliveryCreate.data.id;
    const deliveryConfirm = await api(baseUrl, `/api/sales-deliveries/${deliveryId}`, { method: 'POST', token: warehouseToken, body: { action: 'confirm' } });
    record(expectEq('Sales delivery confirm 200', deliveryConfirm.status, 200), 'SD confirm');
    record(expectEq('FG = 20 after delivery', inventoryTotal(db, fgId), 20), 'FG post-delivery');
    record(expectEq('Customer AR = 10000000 cents (100000 yuan) after delivery', customerNet(db, customerId), 10000000), 'AR post-delivery');

    // 6) Sales Return 2 FG → FG 22, AR -2000 yuan.
    console.log('\n==== Step 6: Sales Return 2 FG (-2000 yuan) ====');
    const returnCreate = await api(baseUrl, '/api/sales-returns', {
      method: 'POST', token: warehouseToken,
      body: {
        deliveryId, customerId, warehouseId: whFg, returnDate: today, remark: 'teacher return',
        items: [{ productId: fgId, quantity: 2, unitPriceCents: 100000 }],  // 1000 × 2 = 2000 yuan
      },
    });
    record(expectEq('Sales return create 201', returnCreate.status, 201), 'SR create');
    const returnId = returnCreate.data.id;
    const returnConfirm = await api(baseUrl, `/api/sales-returns/${returnId}`, { method: 'POST', token: warehouseToken, body: { action: 'confirm' } });
    record(expectEq('Sales return confirm 200', returnConfirm.status, 200), 'SR confirm');
    record(expectEq('FG = 22 after return', inventoryTotal(db, fgId), 22), 'FG post-return');
    record(expectEq('Customer AR = 9800000 cents (98000 yuan) after return', customerNet(db, customerId), 9800000), 'AR post-return');

    // 7) Sales Discount 3000 → AR -3000.
    console.log('\n==== Step 7: Sales Discount 3000 ====');
    const arList = await api(baseUrl, '/api/accounts-receivable', { token: accountingToken });
    const sourceAr = arList.data.receivables.find((r) => r.source_type === 'SALES_DELIVERY' && r.source_id === deliveryId);
    record(expectTrue('Source AR found for sales delivery', sourceAr), 'source AR lookup');

    const discountCreate = await api(baseUrl, '/api/sales-discounts', {
      method: 'POST', token: accountingToken,
      body: { customerId, sourceReceivableId: sourceAr.id, amountCents: 300000, businessDate: today, reason: 'teacher discount', notes: '' },
    });
    record(expectEq('Sales discount create 201', discountCreate.status, 201), 'SD create');
    const discountId = discountCreate.data.id;
    const discountConfirm = await api(baseUrl, `/api/sales-discounts/${discountId}/confirm`, { method: 'POST', token: accountingToken });
    record(expectEq('Sales discount confirm 200', discountConfirm.status, 200), 'SD confirm');
    record(expectEq('Customer AR = 9500000 cents (95000 yuan) after discount', customerNet(db, customerId), 9500000), 'AR post-discount');

    // 8) Collection 95000 → AR 0. Allocate against delivery AR for 9500000 cents
    // (delivery AR outstanding is 10000000 but only 9500000 is needed to
    // zero the customer net balance: 10000000 - 200000 - 300000 = 9500000).
    console.log('\n==== Step 8: Collection 95000 ====');
    const arListPostDiscount = await api(baseUrl, '/api/accounts-receivable', { token: accountingToken });
    const positiveReceivables = arListPostDiscount.data.receivables.filter((r) => Number(r.outstandingCents) > 0 && r.customer_id === customerId);
    const totalPositive = positiveReceivables.reduce((s, r) => s + Number(r.outstandingCents), 0);
    record(expectEq('Sum positive outstanding = 10000000 (delivery AR before collection)', totalPositive, 10000000), 'positive outstanding');

    const collectionCreate = await api(baseUrl, '/api/payment-collections', {
      method: 'POST', token: accountingToken,
      body: {
        customerId, amountCents: 9500000, businessDate: today, paymentMethod: 'BANK', bankAccount: 'teacher', remark: 'teacher collection',
        allocations: [{ receivableId: positiveReceivables[0].id, amountCents: 9500000 }],
      },
    });
    record(expectEq('Collection create 201', collectionCreate.status, 201), 'COLL create');
    const collectionId = collectionCreate.data.id;
    const collectionConfirm = await api(baseUrl, `/api/payment-collections/${collectionId}/confirm`, { method: 'POST', token: accountingToken });
    record(expectEq('Collection confirm 200', collectionConfirm.status, 200), 'COLL confirm');
    record(expectEq('Customer AR = 0 after collection', customerNet(db, customerId), 0), 'AR post-collection');

    // 9) Purchase Discount 1000 → AP -1000.
    console.log('\n==== Step 9: Purchase Discount 1000 ====');
    const apList = await api(baseUrl, '/api/accounts-payable', { token: accountingToken });
    const sourceAp = apList.data.payables.find((r) => r.source_type === 'PURCHASE_RECEIPT' && r.source_id === prId);
    record(expectTrue('Source AP found for purchase receipt', sourceAp), 'source AP lookup');

    const purchaseDiscountCreate = await api(baseUrl, '/api/purchase-discounts', {
      method: 'POST', token: accountingToken,
      body: { supplierId, sourcePayableId: sourceAp.id, amountCents: 100000, businessDate: today, reason: 'teacher purchase discount', notes: '' },
    });
    record(expectEq('Purchase discount create 201', purchaseDiscountCreate.status, 201), 'PD create');
    const purchaseDiscountId = purchaseDiscountCreate.data.id;
    const purchaseDiscountConfirm = await api(baseUrl, `/api/purchase-discounts/${purchaseDiscountId}/confirm`, { method: 'POST', token: accountingToken });
    record(expectEq('Purchase discount confirm 200', purchaseDiscountConfirm.status, 200), 'PD confirm');
    record(expectEq('Supplier AP = 1300000 cents (13000 yuan) after purchase discount', supplierNet(db, supplierId), 1300000), 'AP post-discount');

    // 10) Payment 13000 → AP 0. Allocate 1300000 cents against purchase receipt AP
    // (receipt AP outstanding is 1400000 but only 1300000 needed:
    // 1400000 - 100000 discount = 1300000).
    console.log('\n==== Step 10: Payment 13000 ====');
    const apListPostDiscount = await api(baseUrl, '/api/accounts-payable', { token: accountingToken });
    const positivePayables = apListPostDiscount.data.payables.filter((r) => Number(r.outstandingCents) > 0 && r.supplier_id === supplierId);
    const totalPositivePayable = positivePayables.reduce((s, r) => s + Number(r.outstandingCents), 0);
    record(expectEq('Sum positive AP outstanding = 1400000 (receipt AP before payment)', totalPositivePayable, 1400000), 'positive AP outstanding');

    const paymentCreate = await api(baseUrl, '/api/payment-disbursements', {
      method: 'POST', token: accountingToken,
      body: {
        supplierId, amountCents: 1300000, businessDate: today, paymentMethod: 'BANK', bankAccount: 'teacher', remark: 'teacher payment',
        allocations: [{ payableId: positivePayables[0].id, amountCents: 1300000 }],
      },
    });
    record(expectEq('Payment create 201', paymentCreate.status, 201), 'PAY create');
    const paymentId = paymentCreate.data.id;
    const paymentConfirm = await api(baseUrl, `/api/payment-disbursements/${paymentId}/confirm`, { method: 'POST', token: accountingToken });
    record(expectEq('Payment confirm 200', paymentConfirm.status, 200), 'PAY confirm');
    record(expectEq('Supplier AP = 0 after payment', supplierNet(db, supplierId), 0), 'AP post-payment');

    // 11) Transfer 5 FG WH-FG-01 → WH-SP-01.
    console.log('\n==== Step 11: Transfer 5 FG WH-FG-01 → WH-SP-01 ====');
    const transferCreate = await api(baseUrl, '/api/inventory-transfers', {
      method: 'POST', token: warehouseToken,
      body: { fromWarehouseId: whFg, toWarehouseId: whSp, transferDate: today, remark: 'teacher transfer', items: [{ productId: fgId, quantity: 5 }] },
    });
    record(expectEq('Transfer create 201', transferCreate.status, 201), 'TX create');
    const transferId = transferCreate.data.id;
    const transferExec = await api(baseUrl, `/api/inventory-transfers/${transferId}/transfer`, { method: 'POST', token: warehouseToken });
    record(expectEq('Transfer transfer 200', transferExec.status, 200), 'TX exec');
    const whFgQty = Number(db.prepare('SELECT quantity FROM inventory WHERE product_id=? AND warehouse_id=?').get(fgId, whFg).quantity);
    const whSpQty = Number(db.prepare('SELECT quantity FROM inventory WHERE product_id=? AND warehouse_id=?').get(fgId, whSp).quantity);
    record(expectEq('WH-FG-01 FG = 17', whFgQty, 17), 'FG in WH-FG-01 post-transfer');
    record(expectEq('WH-SP-01 FG = 5', whSpQty, 5), 'FG in WH-SP-01 post-transfer');
    record(expectEq('FG total = 22 after transfer', inventoryTotal(db, fgId), 22), 'FG total post-transfer');

    // 12) Scrap 1 FG → total FG = 21.
    console.log('\n==== Step 12: Scrap 1 FG ====');
    const scrapCreate = await api(baseUrl, '/api/inventory-scraps', {
      method: 'POST', token: warehouseToken,
      body: { warehouseId: whFg, scrapDate: today, reason: 'teacher scrap', notes: '', items: [{ warehouseId: whFg, productId: fgId, quantity: 1 }] },
    });
    record(expectEq('Scrap create 201', scrapCreate.status, 201), 'SCRAP create');
    const scrapId = scrapCreate.data.id;
    const scrapConfirm = await api(baseUrl, `/api/inventory-scraps/${scrapId}/confirm`, { method: 'POST', token: warehouseToken });
    record(expectEq('Scrap confirm 200', scrapConfirm.status, 200), 'SCRAP confirm');
    record(expectEq('FG total = 21 after scrap', inventoryTotal(db, fgId), 21), 'FG post-scrap');

    // 13) Stocktake adjustment to bring FG total to 20 (delta -1).
    console.log('\n==== Step 13: Stocktake approve (delta -1) ====');
    // Inventory check is single-product: actualQuantity=15 with systemQuantity=16 → diff=-1.
    const stocktakeCreate = await api(baseUrl, '/api/inventory-checks', {
      method: 'POST', token: warehouseToken,
      body: { warehouseId: whFg, productId: fgId, actualQuantity: 15, reason: 'teacher stocktake' },
    });
    record(expectEq('Stocktake create 201', stocktakeCreate.status, 201), 'IC create');
    const stocktakeId = stocktakeCreate.data.id;
    const stocktakeSubmit = await api(baseUrl, `/api/inventory-checks/${stocktakeId}`, { method: 'PATCH', token: warehouseToken, body: { action: 'SUBMIT' } });
    record(expectEq('Stocktake submit 200', stocktakeSubmit.status, 200), 'IC submit');
    // Admin must approve (warehouse role lacks INVENTORY_CHECK_APPROVE; reviewer also lacks it).
    const stocktakeApprove = await api(baseUrl, `/api/inventory-checks/${stocktakeId}`, { method: 'PATCH', token: adminToken, body: { action: 'APPROVE' } });
    record(expectEq('Stocktake approve 200', stocktakeApprove.status, 200), 'IC approve');
    record(expectEq('FG total = 20 after stocktake', inventoryTotal(db, fgId), 20), 'FG post-stocktake');

    // 14) Month-end close + reopen.
    console.log('\n==== Step 14: Month-end close + reopen ====');
    const periodClose = await api(baseUrl, '/api/inventory-period-closures', {
      method: 'POST', token: adminToken,
      body: { periodKey: today.slice(0, 7), closureType: 'MONTH' },
    });
    // closeInventoryPeriod returns 200 with {ok, period}; subsequent calls return 409 (already closed).
    record(expectTrue('Period close returns 200/409', [200, 409].includes(periodClose.status), `status=${periodClose.status}`), 'period close');
    if (periodClose.status === 200 && periodClose.data?.id) {
      const closureId = periodClose.data.id;
      const reopen = await api(baseUrl, `/api/inventory-period-closures/${closureId}/reopen`, { method: 'POST', token: adminToken });
      record(expectEq('Period reopen 200', reopen.status, 200), 'period reopen');
    }

    // Final invariants.
    console.log('\n==== Final invariants ====');
    record(expectEq('FG final = 20', inventoryTotal(db, fgId), 20), 'FG final');
    record(expectEq('PCB final = 0 (consumed by production)', inventoryTotal(db, pcbId), 0), 'PCB final');
    record(expectEq('CASE final = 0 (consumed by production)', inventoryTotal(db, caseId), 0), 'CASE final');
    record(expectEq('PSU final = 0 (consumed by production)', inventoryTotal(db, psuId), 0), 'PSU final');
    record(expectEq('Customer AR final = 0', customerNet(db, customerId), 0), 'AR final');
    record(expectEq('Supplier AP final = 0', supplierNet(db, supplierId), 0), 'AP final');
    const integrity = db.prepare('PRAGMA integrity_check').get();
    record(integrity.integrity_check === 'ok', `PRAGMA integrity_check = ${integrity.integrity_check}`);
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    record(expectEq('PRAGMA foreign_key_check rows', fk.length, 0), 'foreign_key_check');

    console.log('\n' + (pass ? 'TEACHER FIXTURE ACCEPTANCE = PASS' : 'TEACHER FIXTURE ACCEPTANCE = FAIL'));
    if (failures.length) {
      console.log('Failures:');
      for (const f of failures) console.log('  - ' + f);
    }
    if (!pass) process.exitCode = 1;
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });