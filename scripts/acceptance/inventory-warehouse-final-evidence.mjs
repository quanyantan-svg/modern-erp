import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

import { createApp } from '../../server/app.js';
import { hashPassword } from '../../server/db.js';
import { computeAvailability } from '../../server/lib/inventory-availability.js';
import { computePositionKey } from '../../server/lib/inventory-position.js';
import { systemHealth } from '../../server/modules/financial-inventory.js';
import { createTempDb } from '../../server/test-utils/temp-db.js';

const BUSINESS_DATE = '2026-09-15';
const NOW = '2026-10-10T08:00:00.000Z';
const SERIAL_NUMBER = 'SN-UAT-FINAL-001';
const results = [];

function seedIdentity(db) {
  const password = hashPassword('uat-final-password');
  const insert = db.prepare(`INSERT INTO users
    (id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,?,1,?)`);
  insert.run('uat-admin', 'uat-admin', 'UAT Admin', password.hash, password.salt, 'role-admin', NOW);
  insert.run('uat-warehouse', 'uat-warehouse', 'UAT Warehouse', password.hash, password.salt, 'role-warehouse', NOW);
}

function seedMaster(db, { productId, warehouseId, trackingPolicy = 'NONE' }) {
  db.prepare(`INSERT INTO warehouses
    (id,code,name,address,manager,active,created_at,updated_at,bin_enabled,is_supplier_wip,negative_stock_policy,mrp_participation,inventory_lock_enabled)
    VALUES(?,?,?,'','',1,?,?,0,0,'FORBID',1,1)`)
    .run(warehouseId, `W-${warehouseId}`, `Warehouse ${warehouseId}`, NOW, NOW);
  db.prepare(`INSERT INTO products
    (id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
    VALUES(?,?,?,'UAT','EA',1000,0,1,?,?,?,'MOVING_AVERAGE','MERCHANDISE')`)
    .run(productId, `P-${productId}`, `Product ${productId}`, NOW, NOW, trackingPolicy);
}

async function fixture(label) {
  const handle = createTempDb({ label, production: true });
  seedIdentity(handle.db);
  const server = createServer(createApp(handle.db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, path, token, body) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    return { status: response.status, data };
  }
  async function login(username) {
    const response = await request('POST', '/api/auth/login', null, { username, password: 'uat-final-password' });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.ok(response.data.token);
    return response.data.token;
  }
  return {
    ...handle, server, request,
    adminToken: await login('uat-admin'),
    warehouseToken: await login('uat-warehouse'),
    async cleanupAll() {
      await new Promise((done) => server.close(done));
      handle.cleanup();
    },
  };
}

function expectStatus(response, expected) {
  assert.equal(response.status, expected, JSON.stringify(response.data));
  return response.data;
}

function sideEffects(db) {
  return {
    quantity: Number(db.prepare('SELECT COALESCE(SUM(quantity),0) n FROM inventory').get().n),
    inventoryMovements: Number(db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n),
    trackedMovements: Number(db.prepare('SELECT COUNT(*) n FROM tracked_inventory_movements').get().n),
    valuationMovements: Number(db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements').get().n),
    vouchers: Number(db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n),
    entries: Number(db.prepare('SELECT COUNT(*) n FROM accounting_entries').get().n),
  };
}

async function uat10() {
  const fix = await fixture('inventory-uat10-final');
  try {
    seedMaster(fix.db, { productId: 'uat-serial-product', warehouseId: 'uat-serial-wh', trackingPolicy: 'SERIAL' });
    const serial = expectStatus(await fix.request('POST', '/api/inventory-serials', fix.adminToken, {
      productId: 'uat-serial-product', serialNumber: SERIAL_NUMBER,
      lifecycleState: 'AVAILABLE', warehouseId: 'uat-serial-wh',
    }), 201);
    const receipt = expectStatus(await fix.request('POST', '/api/inventory/native-documents', fix.adminToken, {
      docKind: 'OTHER_RECEIPT', businessDate: BUSINESS_DATE, notes: 'UAT-10 final serial receipt',
      items: [{ productId: 'uat-serial-product', warehouseId: 'uat-serial-wh', serialId: serial.id, quantity: 1, stockStatus: 'AVAILABLE' }],
    }), 201);
    expectStatus(await fix.request('POST', `/api/inventory/native-documents/${receipt.id}/confirm`, fix.adminToken), 200);
    const firstIssue = expectStatus(await fix.request('POST', '/api/inventory/native-documents', fix.adminToken, {
      docKind: 'OTHER_ISSUE', businessDate: BUSINESS_DATE, notes: 'UAT-10 first consume',
      items: [{ productId: 'uat-serial-product', warehouseId: 'uat-serial-wh', serialId: serial.id, quantity: 1, stockStatus: 'AVAILABLE' }],
    }), 201);
    expectStatus(await fix.request('POST', `/api/inventory/native-documents/${firstIssue.id}/confirm`, fix.adminToken), 200);

    const beforeDuplicate = sideEffects(fix.db);
    const duplicate = expectStatus(await fix.request('POST', '/api/inventory/native-documents', fix.adminToken, {
      docKind: 'OTHER_ISSUE', businessDate: BUSINESS_DATE, notes: 'UAT-10 duplicate consume',
      items: [{ productId: 'uat-serial-product', warehouseId: 'uat-serial-wh', serialId: serial.id, quantity: 1, stockStatus: 'AVAILABLE' }],
    }), 201);
    const rejected = await fix.request('POST', `/api/inventory/native-documents/${duplicate.id}/confirm`, fix.adminToken);
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    assert.deepEqual(sideEffects(fix.db), beforeDuplicate, 'duplicate consume must have zero side effects');

    const positions = fix.db.prepare('SELECT quantity,serial_id,active FROM inventory WHERE serial_id=?').all(serial.id);
    assert.equal(positions.length, 1);
    assert.equal(Number(positions[0].quantity), 0);
    assert.equal(Number(positions[0].active), 1);
    assert.equal(Number(fix.db.prepare('SELECT MIN(quantity) n FROM inventory').get().n), 0);
    assert.equal(Number(fix.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OTHER_ISSUE' AND source_id=? AND direction='OUT'").get(firstIssue.id).n), 1);
    assert.equal(Number(fix.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OTHER_ISSUE' AND source_id=?").get(duplicate.id).n), 0);
    assert.equal(Number(fix.db.prepare("SELECT COUNT(*) n FROM tracked_inventory_movements WHERE source_type='OTHER_ISSUE' AND source_id=? AND serial_id=? AND direction='OUT'").get(firstIssue.id, serial.id).n), 1);
    assert.equal(Number(fix.db.prepare("SELECT COUNT(*) n FROM tracked_inventory_movements WHERE source_type='OTHER_ISSUE' AND source_id=?").get(duplicate.id).n), 0);
    const serialAfter = fix.db.prepare('SELECT lifecycle_state,current_warehouse_id FROM inventory_serials WHERE id=?').get(serial.id);
    assert.equal(serialAfter.lifecycle_state, 'CONSUMED');
    assert.equal(serialAfter.current_warehouse_id, null);
    const health = systemHealth(fix.db, { asOfDate: BUSINESS_DATE });
    for (const code of ['TRACKED_DIMENSION_VS_CANONICAL', 'INVENTORY_QUANTITY_VS_VALUATION', 'NEGATIVE_OR_RESIDUAL_VALUATION']) {
      assert.equal(health.checks.find((row) => row.code === code)?.status, 'PASS', `${code} must pass`);
    }
    return {
      serial: SERIAL_NUMBER, receiptStatus: 200, firstConsumeStatus: 200,
      duplicateConsumeStatus: rejected.status, positionCount: positions.length,
      endingQuantity: Number(positions[0].quantity), outMovementCount: 1, trackedOutCount: 1,
      valuationMovementCount: beforeDuplicate.valuationMovements,
      accountingVoucherCount: beforeDuplicate.vouchers, accountingEntryCount: beforeDuplicate.entries,
      serialState: serialAfter.lifecycle_state, health: 'PASS',
    };
  } finally { await fix.cleanupAll(); }
}

async function uat27() {
  const fix = await fixture('inventory-uat27-final');
  try {
    seedMaster(fix.db, { productId: 'uat-period-product', warehouseId: 'uat-period-wh' });
    expectStatus(await fix.request('GET', '/api/inventory-period-closures/status', fix.warehouseToken), 200);
    const denied = await fix.request('POST', '/api/inventory-period-closures', fix.warehouseToken, { period: '2026-09' });
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    const closed = expectStatus(await fix.request('POST', '/api/inventory-period-closures', fix.adminToken, {
      period: '2026-09', notes: 'UAT-27 final close',
    }), 200);
    assert.equal(closed.status, 'CLOSED');
    assert.equal(fix.db.prepare('SELECT status FROM inventory_period_closures WHERE id=?').get(closed.id).status, 'CLOSED');

    const document = expectStatus(await fix.request('POST', '/api/inventory/native-documents', fix.adminToken, {
      docKind: 'OTHER_RECEIPT', businessDate: BUSINESS_DATE, notes: 'UAT-27 closed period mutation',
      items: [{ productId: 'uat-period-product', warehouseId: 'uat-period-wh', quantity: 1, stockStatus: 'AVAILABLE' }],
    }), 201);
    const beforeBlocked = sideEffects(fix.db);
    const blocked = await fix.request('POST', `/api/inventory/native-documents/${document.id}/confirm`, fix.adminToken);
    assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
    assert.deepEqual(sideEffects(fix.db), beforeBlocked, 'closed-period rejection must have zero side effects');
    assert.equal(fix.db.prepare('SELECT status FROM inventory_native_documents WHERE id=?').get(document.id).status, 'DRAFT');

    const reopened = expectStatus(await fix.request('POST', `/api/inventory-period-closures/${closed.id}/reopen`, fix.adminToken, {
      reason: 'UAT-27 authorized correction',
    }), 200);
    assert.equal(reopened.status, 'REOPENED');
    assert.equal(fix.db.prepare('SELECT status FROM inventory_period_closures WHERE id=?').get(closed.id).status, 'REOPENED');
    expectStatus(await fix.request('POST', `/api/inventory/native-documents/${document.id}/confirm`, fix.adminToken), 200);
    const afterRetry = sideEffects(fix.db);
    assert.equal(afterRetry.quantity, 1);
    assert.equal(afterRetry.inventoryMovements, beforeBlocked.inventoryMovements + 1);
    return {
      warehouseViewStatus: 200, warehouseManageStatus: denied.status,
      closeStatus: 200, persistedCloseState: 'CLOSED', closedPeriodMutationStatus: blocked.status,
      rejectedSideEffects: { quantityDelta: 0, movementDelta: 0, trackedDelta: 0, valuationDelta: 0, voucherDelta: 0, entryDelta: 0 },
      reopenStatus: 200, persistedReopenState: 'REOPENED', postReopenMutationStatus: 200,
      postReopenQuantity: afterRetry.quantity,
    };
  } finally { await fix.cleanupAll(); }
}

async function uat28() {
  const fix = createTempDb({ label: 'inventory-uat28-final', production: true });
  try {
    seedIdentity(fix.db);
    seedMaster(fix.db, { productId: 'uat-availability-product', warehouseId: 'uat-availability-wh' });
    const positionKey = computePositionKey({
      productId: 'uat-availability-product', warehouseId: 'uat-availability-wh', binId: null,
      ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null,
    });
    fix.db.prepare(`INSERT INTO inventory
      (id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES('uat-av-inv','uat-availability-wh','uat-availability-product',100,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)`)
      .run(NOW, positionKey);
    fix.db.prepare(`INSERT INTO inventory_locks
      (id,product_id,warehouse_id,position_key,quantity,reason,status,locked_by,locked_at,source_type,source_id)
      VALUES('uat-av-lock','uat-availability-product','uat-availability-wh',?,20,'UAT lock','ACTIVE','uat-admin',?,'UAT','UAT-28')`)
      .run(positionKey, NOW);
    const reservation = fix.db.prepare(`INSERT INTO planning_reservations
      (id,reservation_no,reservation_type,demand_source_type,demand_source_id,supply_source_type,supply_source_id,product_id,warehouse_id,quantity,status,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,'ON_HAND','UAT-28-SUPPLY','uat-availability-product','uat-availability-wh',?,'ACTIVE','uat-admin',?,?)`);
    reservation.run('uat-av-strong', 'UAT-AV-STRONG', 'STRONG', 'UAT', 'UAT-28-S', 20, NOW, NOW);
    reservation.run('uat-av-manual', 'UAT-AV-MANUAL', 'MANUAL', 'UAT', 'UAT-28-M', 10, NOW, NOW);
    reservation.run('uat-av-weak', 'UAT-AV-WEAK', 'WEAK', 'UAT', 'UAT-28-W', 10, NOW, NOW);
    const actual = computeAvailability(fix.db, { productId: 'uat-availability-product', warehouseId: 'uat-availability-wh' });
    const expected = {
      eligibleOnHand: 100, activeLocked: 20, positionFreePhysical: 80,
      activeReservedTotal: 40, hardReserved: 30, softReserved: 10,
      availableForNewReservation: 40, availableForUnrelatedExecution: 50,
    };
    assert.deepEqual(actual, expected);
    return { runtimeService: 'computeAvailability', inputs: { eligible: 100, lock: 20, strong: 20, manual: 10, weak: 10 }, ...actual };
  } finally { fix.cleanup(); }
}

for (const [id, run] of [['UAT-10', uat10], ['UAT-27', uat27], ['UAT-28', uat28]]) {
  try {
    const evidence = await run();
    results.push({ id, status: 'PASS', evidence });
    console.log(`PASS ${id} ${JSON.stringify(evidence)}`);
  } catch (error) {
    results.push({ id, status: 'FAIL', error: error.stack || error.message });
    console.error(`FAIL ${id} ${error.stack || error.message}`);
  }
}

const failed = results.filter((row) => row.status === 'FAIL');
console.log(JSON.stringify({ suite: 'Inventory & Warehouse evidence closure', pass: results.length - failed.length, fail: failed.length, results }, null, 2));
process.exitCode = failed.length ? 1 : 0;
