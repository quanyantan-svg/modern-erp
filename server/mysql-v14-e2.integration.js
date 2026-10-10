import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';
import { receiveValue } from './modules/financial-inventory.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';
import { createTempDb } from './test-utils/temp-db.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

describe('V1.4-E2 MySQL business dates and transfer execution', () => {
  let handle; let db; let server; let baseUrl; let warehouseToken;
  const at = '2026-09-27T08:00:00.000Z';
  const businessDate = '2026-09-27';

  before(async () => {
    handle = createTempDb({ label: 'mysql-v14-e2', production: true });
    db = handle.db;
    const password = hashPassword('warehouse-e2-1234');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('e2-wh-user','warehouse-e2','E2 Warehouse',?,?, 'role-warehouse',1,?)`).run(password.hash, password.salt, at);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES
      ('e2-wh-a','E2-A','E2 Source','','',1,?,?),
      ('e2-wh-b','E2-B','E2 Target','','',1,?,?)`).run(at, at, at, at);
    const product = db.prepare(`INSERT INTO products
      (id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
      VALUES(?,?,?,'TEST','EA',0,0,1,?,?,?,?,?)`);
    product.run('e2-none','E2-NONE','E2 None',at,at,'NONE','MOVING_AVERAGE','OTHER_INVENTORY');
    product.run('e2-lot','E2-LOT','E2 Lot',at,at,'LOT','LOT_SPECIFIC_POOL','RAW_MATERIAL');
    product.run('e2-serial','E2-SERIAL','E2 Serial',at,at,'SERIAL','SPECIFIC_SERIAL','FINISHED_GOOD');
    db.prepare(`INSERT INTO inventory_lots
      (id,product_id,lot_code,created_source_type,created_source_id,status,created_at)
      VALUES('e2-lot-id','e2-lot','E2-LOT-001','E2_SEED','e2-seed','AVAILABLE',?)`).run(at);
    db.prepare(`INSERT INTO inventory_lot_balances
      (warehouse_id,product_id,lot_id,quantity,updated_at) VALUES('e2-wh-a','e2-lot','e2-lot-id',2,?)`).run(at);
    db.prepare(`INSERT INTO inventory_serials
      (id,product_id,serial_number,created_source_type,created_source_id,lifecycle_state,current_warehouse_id,updated_at,created_at)
      VALUES('e2-serial-id','e2-serial','E2-SN-001','E2_SEED','e2-seed','AVAILABLE','e2-wh-a',?,?)`).run(at, at);
    for (const row of [
      { warehouseId: 'e2-wh-a', productId: 'e2-none', quantity: 20 },
      { warehouseId: 'e2-wh-b', productId: 'e2-none', quantity: 0 },
      { warehouseId: 'e2-wh-a', productId: 'e2-lot', quantity: 2, position: { lotId: 'e2-lot-id' } },
      { warehouseId: 'e2-wh-b', productId: 'e2-lot', quantity: 0, position: { lotId: 'e2-lot-id' } },
      { warehouseId: 'e2-wh-a', productId: 'e2-serial', quantity: 1, position: { serialId: 'e2-serial-id' } },
      { warehouseId: 'e2-wh-b', productId: 'e2-serial', quantity: 0, position: { serialId: 'e2-serial-id' } },
    ]) upsertCanonicalInventory(db, row);
    receiveValue(db,{businessDate,productId:'e2-none',warehouseId:'e2-wh-a',quantity:20,valueCents:20000,movementType:'E2_SEED',sourceType:'E2_SEED',sourceId:'e2-none-seed',sourceItemId:'e2-none-seed'});
    receiveValue(db,{businessDate,productId:'e2-lot',warehouseId:'e2-wh-a',lotId:'e2-lot-id',quantity:2,valueCents:4000,movementType:'E2_SEED',sourceType:'E2_SEED',sourceId:'e2-lot-seed',sourceItemId:'e2-lot-seed'});
    receiveValue(db,{businessDate,productId:'e2-serial',warehouseId:'e2-wh-a',serialId:'e2-serial-id',quantity:1,valueCents:3000,movementType:'E2_SEED',sourceType:'E2_SEED',sourceId:'e2-serial-seed',sourceItemId:'e2-serial-seed'});

    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'warehouse-e2', password: 'warehouse-e2-1234' }),
    });
    warehouseToken = (await login.json()).token;
    assert.ok(warehouseToken);
  });

  after(async () => {
    if (server) await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    handle?.cleanup();
  });

  async function api(path, { method = 'GET', body, token = warehouseToken } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    return { response, payload };
  }

  async function createTransfer(items, date = businessDate) {
    const { response, payload } = await api('/api/inventory-transfers', {
      method: 'POST', body: { fromWarehouseId: 'e2-wh-a', toWarehouseId: 'e2-wh-b', businessDate: date, items },
    });
    assert.equal(response.status, 201, JSON.stringify(payload));
    return payload;
  }

  test('migration is idempotent, nullable legacy dates stay NULL, and permission scope is exact', () => {
    const columns = db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME column_name FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='business_date' AND TABLE_NAME IN ('inventory_transfers','inventory_checks') ORDER BY TABLE_NAME`).all();
    assert.deepEqual(columns.map((row) => row.table_name), ['inventory_checks','inventory_transfers']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='inventory_transactions' AND COLUMN_NAME='business_date_origin') OR (TABLE_NAME='production_orders' AND COLUMN_NAME='completion_date'))").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM permissions WHERE code='INVENTORY_TRANSFER_CONFIRM'").get().n, 1);
    assert.deepEqual(db.prepare("SELECT role_id FROM role_permissions WHERE permission_code='INVENTORY_TRANSFER_CONFIRM' ORDER BY role_id").all().map((row) => row.role_id), ['role-admin','role-warehouse']);

    db.prepare(`INSERT INTO inventory_transfers
      (id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at,business_date)
      VALUES('e2-legacy-submitted','E2-LEG-S','e2-wh-a','e2-wh-b','SUBMITTED','','e2-wh-user',?,?,NULL),
            ('e2-legacy-approved','E2-LEG-A','e2-wh-a','e2-wh-b','APPROVED','','e2-wh-user',?,?,NULL)`).run(at, at, at, at);
    db.prepare(`INSERT INTO inventory_checks
      (id,check_no,warehouse_id,product_id,system_quantity,actual_quantity,difference,reason,status,creator_id,created_at,business_date)
      VALUES('e2-legacy-check','E2-LEG-C','e2-wh-a','e2-none',20,20,0,'','DRAFT','e2-wh-user',?,NULL)`).run(at);
    const reopened = createDatabase({ backend: 'mysql' });
    try {
      assert.equal(reopened.prepare("SELECT COUNT(*) n FROM permissions WHERE code='INVENTORY_TRANSFER_CONFIRM'").get().n, 1);
      assert.equal(reopened.prepare("SELECT COUNT(*) n FROM inventory_transfers WHERE id LIKE 'e2-legacy-%' AND business_date IS NULL").get().n, 2);
      assert.equal(reopened.prepare("SELECT business_date FROM inventory_checks WHERE id='e2-legacy-check'").get().business_date, null);
    } finally { reopened.close(); }
  });

  test('stocktake stores its business date and missing dates are rejected without timestamp fallback', async () => {
    const missing = await api('/api/inventory-checks', { method: 'POST', body: { warehouseId: 'e2-wh-a', productId: 'e2-none', actualQuantity: 20, reason: 'missing date' } });
    assert.equal(missing.response.status, 400);
    const created = await api('/api/inventory-checks', { method: 'POST', body: { warehouseId: 'e2-wh-a', productId: 'e2-none', actualQuantity: 20, businessDate, reason: 'dated count' } });
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    assert.equal(db.prepare('SELECT business_date FROM inventory_checks WHERE id=?').get(created.payload.id).business_date, businessDate);
    assert.equal(db.prepare("SELECT business_date FROM inventory_checks WHERE id='e2-legacy-check'").get().business_date, null);
  });

  test('same WAREHOUSE user executes DRAFT to TRANSFERRED with quantity, value, LOT and SERIAL conservation', async () => {
    const before = db.prepare("SELECT SUM(quantity) quantity,SUM(value_cents) value_cents FROM inventory_valuation_balances WHERE product_id IN ('e2-none','e2-lot','e2-serial')").get();
    const created = await createTransfer([
      { productId: 'e2-none', quantity: 5 },
      { productId: 'e2-lot', quantity: 1, trackingAllocations: [{ lotId: 'e2-lot-id', quantity: 1 }] },
      { productId: 'e2-serial', quantity: 1, trackingAllocations: [{ serialId: 'e2-serial-id' }] },
    ]);
    const confirmed = await api(`/api/inventory-transfers/${created.id}/transfer`, { method: 'POST', body: {} });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.payload));
    const transfer = db.prepare('SELECT status,creator_id,reviewer_id,business_date FROM inventory_transfers WHERE id=?').get(created.id);
    assert.deepEqual(transfer, { status: 'TRANSFERRED', creator_id: 'e2-wh-user', reviewer_id: 'e2-wh-user', business_date: businessDate });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_id=? AND business_date=?").get(created.id, businessDate).n, 6);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tracked_inventory_movements WHERE source_id=? AND business_date=?").get(created.id, businessDate).n, 4);
    assert.deepEqual(db.prepare("SELECT warehouse_id,quantity FROM inventory_lot_balances WHERE lot_id='e2-lot-id' ORDER BY warehouse_id").all(), [{ warehouse_id: 'e2-wh-a', quantity: 1 }, { warehouse_id: 'e2-wh-b', quantity: 1 }]);
    assert.equal(db.prepare("SELECT current_warehouse_id FROM inventory_serials WHERE id='e2-serial-id'").get().current_warehouse_id, 'e2-wh-b');
    const after = db.prepare("SELECT SUM(quantity) quantity,SUM(value_cents) value_cents FROM inventory_valuation_balances WHERE product_id IN ('e2-none','e2-lot','e2-serial')").get();
    assert.deepEqual(after, before);
    const totalInventory = db.prepare("SELECT product_id,SUM(quantity) quantity FROM inventory WHERE product_id IN ('e2-none','e2-lot','e2-serial') GROUP BY product_id ORDER BY product_id").all();
    assert.deepEqual(totalInventory, [{ product_id:'e2-lot',quantity:2 },{ product_id:'e2-none',quantity:20 },{ product_id:'e2-serial',quantity:1 }]);
    const detail = await api(`/api/inventory-transfers/${created.id}`);
    assert.equal(detail.payload.transfer.confirmedBy, 'e2-wh-user');
    assert.equal(detail.payload.transfer.businessDateMissing, false);
    const duplicate = await api(`/api/inventory-transfers/${created.id}/transfer`, { method: 'POST', body: {} });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.payload.code, 'DUPLICATE_CONFIRMATION');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_id=?").get(created.id).n, 6);
  });

  test('legacy APPROVE remains a compatibility alias and legacy statuses remain unchanged', async () => {
    const created = await createTransfer([{ productId: 'e2-none', quantity: 1 }]);
    db.prepare("DELETE FROM role_permissions WHERE role_id='role-warehouse' AND permission_code='INVENTORY_TRANSFER_CONFIRM'").run();
    try {
      const result = await api(`/api/inventory-transfers/${created.id}/transfer`, { method: 'POST', body: {} });
      assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    } finally {
      db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES('role-warehouse','INVENTORY_TRANSFER_CONFIRM')").run();
    }
    for (const [id, status] of [['e2-legacy-submitted','SUBMITTED'],['e2-legacy-approved','APPROVED']]) {
      const detail = await api(`/api/inventory-transfers/${id}`);
      assert.equal(detail.response.status, 200);
      assert.equal(detail.payload.transfer.status, status);
      assert.equal(detail.payload.transfer.legacyTechnicalStatus, true);
      assert.equal(detail.payload.transfer.business_date, null);
      assert.equal(db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(id).status, status);
    }
  });

  test('closed-period blocking uses transfer business_date and rolls back every effect', async () => {
    const created = await createTransfer([{ productId: 'e2-none', quantity: 1 }], '2026-08-31');
    db.prepare("INSERT INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes) VALUES('e2-closed','2026-08','CLOSED','e2-wh-user',?,'e2')").run(at);
    const before = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='e2-wh-a' AND product_id='e2-none'").get().quantity;
    const result = await api(`/api/inventory-transfers/${created.id}/transfer`, { method: 'POST', body: {} });
    assert.equal(result.response.status, 409);
    assert.equal(db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(created.id).status, 'DRAFT');
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='e2-wh-a' AND product_id='e2-none'").get().quantity, before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_id=?").get(created.id).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_id=?").get(created.id).n, 0);
  });
});
