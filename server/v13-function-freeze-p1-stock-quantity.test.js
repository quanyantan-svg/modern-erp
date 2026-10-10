import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createServer } from 'node:http';
import { hashPassword } from './db.js';
import { createTempDb } from './test-utils/temp-db.js';
import { receiveValue, issueValue } from './modules/financial-inventory.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

// V1.3 Function-Freeze P1 cleanup regression tests.
//
// Closes the two audited P1 gaps:
//   1. server/modules/extended.js getInventoryStatus must NOT read the
//      legacy `products.stock_quantity` display column; the canonical
//      truth lives in `inventory.quantity` (base UOM).  Threshold logic
//      (min / max / LOW / OVER / NORMAL) must reflect that.
//   2. src/pages/master-data.jsx ProductModal must not present a normal
//      editable `stockQuantity` input; products.stock_quantity must not
//      appear as a second stock truth to the user.
//
// Tests run on a disposable TempDb and assert the canonical
// `inventory` table is the only source of business stock truth.

async function setup() {
  const temp = createTempDb({ label: 'p6e-p1-stock', production: true });
  const db = temp.db;
  const now = new Date().toISOString();
  const adminHash = hashPassword('admin-p1');
  const accountingHash = hashPassword('accounting-p1');
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('user-admin','admin-p1','Admin',?,?,'role-admin',1,?)").run(adminHash.hash, adminHash.salt, now);
  db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('user-accounting','accounting-p1','Accounting',?,?,'role-accounting',1,?)").run(accountingHash.hash, accountingHash.salt, now);
  db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-p1','W1','Warehouse 1','','',1,?,?)").run(now, now);
  db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh-p1-2','W2','Warehouse 2','','',1,?,?)").run(now, now);
  db.prepare("INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,min_stock,max_stock,active,created_at,updated_at) VALUES('p-low','LOW','Low Stock','EA',10,0,10,100,1,?,?)").run(now, now);
  db.prepare("INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,min_stock,max_stock,active,created_at,updated_at) VALUES('p-over','OVER','Over Stock','EA',10,0,1,4,1,?,?)").run(now, now);
  db.prepare("INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,min_stock,max_stock,active,created_at,updated_at) VALUES('p-normal','NORMAL','Normal Stock','EA',10,0,10,100,1,?,?)").run(now, now);
  return { temp, db };
}

// Plant canonical inventory: write both inventory (canonical quantity
// truth) and inventory_valuation_balances (valuation side) so the
// downstream reports and receiveValue/issueValue flows behave correctly.
function plantInventory(db, productId, warehouseId, quantity) {
  const now = new Date().toISOString();
  upsertCanonicalInventory(db, {
    warehouseId, productId, quantity, position: {},
  });
  // Plant a POSTED balance movement at the canonical standard cost so
  // downstream flows (issueValue, etc.) find a non-LEGACY_UNVALUED row.
  receiveValue(db, { businessDate: '2026-09-25', productId, warehouseId, quantity, valueCents: 1000, movementType: 'OPENING_BALANCE', sourceType: 'OPENING_BATCH', sourceId: `ob-${productId}-${warehouseId}`, valuationBasis: 'CONTROLLED_OPENING' });
}

async function setupServer() {
  const handle = await setup();
  const server = createServer(createApp(handle.db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const tokens = {};
  for (const name of ['admin', 'accounting']) {
    const r = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password: `${name}-p1` }) });
    tokens[name] = (await r.json()).token;
  }
  return { handle, server, baseUrl, tokens };
}

describe('V1.3 function-freeze P1 stock-quantity cleanup', () => {
  let temp; let db;
  beforeEach(() => ({ temp, db } = {}));

  test('getInventoryStatus uses canonical SUM(inventory.quantity); stale products.stock_quantity cannot influence the result', async () => {
    const { temp: t, db: database } = await setup();
    plantInventory(database, 'p-normal', 'wh-p1', 50);
    plantInventory(database, 'p-over', 'wh-p1-2', 5);
    plantInventory(database, 'p-low', 'wh-p1', 5);

    // Now pollute the legacy products.stock_quantity with values that
    // would invert every threshold classification if the legacy
    // column were still the source of truth:
    database.prepare("UPDATE products SET stock_quantity=999999 WHERE id='p-low'").run();
    database.prepare("UPDATE products SET stock_quantity=999999 WHERE id='p-over'").run();
    database.prepare("UPDATE products SET stock_quantity=999999 WHERE id='p-normal'").run();

    const server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'accounting-p1', password: 'accounting-p1' }) });
    const token = (await login.json()).token;
    try {
      const r = await fetch(baseUrl + '/api/reports/inventory-status', { headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 200);
      const body = await r.json();
      const byCode = Object.fromEntries(body.items.map((x) => [x.code, x]));
      assert.equal(byCode.LOW.status, 'LOW', 'p-low must be classified by canonical SUM(inventory.quantity), not the stale products.stock_quantity=999999');
      assert.equal(byCode.OVER.status, 'OVER', 'p-over must be classified by canonical SUM(inventory.quantity), not the stale products.stock_quantity=999999');
      assert.equal(byCode.NORMAL.status, 'NORMAL', 'p-normal must be classified by canonical SUM(inventory.quantity), not the stale products.stock_quantity=999999');
      assert.equal(byCode.LOW.quantity, 5);
      assert.equal(byCode.OVER.quantity, 5);
      assert.equal(byCode.NORMAL.quantity, 50);

      // No response field may expose the legacy display column under any
      // alias.  The audit requires that products.stock_quantity not be a
      // second stock truth to the user.
      for (const item of body.items) {
        assert.ok(!('stock_quantity' in item), `legacy stock_quantity must not appear on the wire (code=${item.code})`);
      }
    } finally {
      await new Promise((done) => server.close(done));
      t.cleanup();
    }
  });

  test('listProducts stockQuantity comes from SUM(inventory.quantity); legacy products.stock_quantity writes do not influence it', async () => {
    const { temp: t, db: database } = await setup();
    try {
      // canonical truth: plant 42 units across two warehouses
      plantInventory(database, 'p-normal', 'wh-p1', 30);
      plantInventory(database, 'p-normal', 'wh-p1-2', 12);
      // pollute legacy display
      database.prepare("UPDATE products SET stock_quantity=999999 WHERE id='p-normal'").run();

      const server = createServer(createApp(database, { distDir: resolve('dist') }));
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const login = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin-p1', password: 'admin-p1' }) });
      const token = (await login.json()).token;
      const r = await fetch(baseUrl + '/api/products', { headers: { authorization: `Bearer ${token}` } });
      assert.equal(r.status, 200);
      const body = await r.json();
      const product = body.products.find((x) => x.id === 'p-normal');
      assert.equal(product.stockQuantity, 42, 'product list stockQuantity must reflect canonical SUM(inventory.quantity) = 30 + 12');
      assert.notEqual(product.stockQuantity, 999999, 'product list stockQuantity must not echo the stale products.stock_quantity display column');
      await new Promise((done) => server.close(done));
    } finally {
      t.cleanup();
    }
  });

  test('updateProduct rejects stockQuantity writes (legacy display column is read-only)', async () => {
    const { temp: t, db: database } = await setup();
    try {
      const server = createServer(createApp(database, { distDir: resolve('dist') }));
      await new Promise((done) => server.listen(0, '127.0.0.1', done));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const login = await fetch(baseUrl + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin-p1', password: 'admin-p1' }) });
      const token = (await login.json()).token;
      const r = await fetch(baseUrl + '/api/products/p-normal', { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'NORMAL', name: 'Normal Stock', unit: 'EA', priceCents: 1000, stockQuantity: 99999 }) });
      assert.equal(r.status, 409, 'server must reject stockQuantity write attempts with 409');
      const body = await r.json();
      assert.match(body.error, /库存数量只读/);
      const canonical = database.prepare('SELECT stock_quantity FROM products WHERE id=?').get('p-normal');
      assert.equal(canonical.stock_quantity, 0, 'legacy products.stock_quantity must remain 0 (unwritten) after rejected write');
      await new Promise((done) => server.close(done));
    } finally {
      t.cleanup();
    }
  });

  test('canonical inventory remains the only source of stock truth; only the inventory table changes on real movement', async () => {
    const { temp: t, db: database } = await setup();
    try {
      plantInventory(database, 'p-normal', 'wh-p1', 50);
      const before = database.prepare('SELECT COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = ?), 0) q, stock_quantity FROM products WHERE id = ?').get('p-normal', 'p-normal');
      assert.equal(Number(before.q), 50);
      const legacyBefore = Number(before.stock_quantity);

      // Simulate a real business movement: sales delivery confirm path
      // decrements inventory.quantity and writes a valuation movement.
      // We use the same primitive the receipt / delivery flows use to
      // prove the canonical inventory table is the only source of truth.
      database.prepare("UPDATE inventory SET quantity=quantity-20, updated_at=? WHERE product_id=? AND warehouse_id=?").run(new Date().toISOString(), 'p-normal', 'wh-p1');
      issueValue(database, { businessDate: '2026-09-26', productId: 'p-normal', warehouseId: 'wh-p1', quantity: 20, movementType: 'SALES_DELIVERY_COGS', sourceType: 'SALES_DELIVERY', sourceId: 'sd-p1', sourceItemId: 'sdi-p1' });

      const after = database.prepare('SELECT COALESCE((SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = ?), 0) q, stock_quantity FROM products WHERE id = ?').get('p-normal', 'p-normal');
      assert.equal(Number(after.q), 30, 'canonical SUM(inventory.quantity) shrinks by issue quantity');
      assert.equal(Number(after.stock_quantity), legacyBefore, 'legacy products.stock_quantity must NOT change on inventory movement (canonical truth is inventory only)');
    } finally {
      t.cleanup();
    }
  });

  test('Product master source: no normal editable stockQuantity field on the form', () => {
    // Source-level guarantee that the UI no longer offers a normal
    // editable stock field.  The list is allowed to keep its canonical
    // SUM(inventory.quantity) display, but the modal form must not
    // present a stockQuantity input the server silently drops.
    const source = readFileSync(resolve('src/pages/master-data.jsx'), 'utf8');
    assert.doesNotMatch(source, /<label>演示库存/, '演示库存 label must not exist on the product form');
    assert.doesNotMatch(source, /value=\{form\.stockQuantity\}/, 'form.stockQuantity input binding must not exist on the product form');
    assert.doesNotMatch(source, /stockQuantity:\s*0/, 'ProductModal initial state must not include stockQuantity');
  });

  test('server extended.js getInventoryStatus SQL does not reference products.stock_quantity', () => {
    const source = readFileSync(resolve('server/modules/extended.js'), 'utf8');
    const idx = source.indexOf('export function getInventoryStatus');
    assert.ok(idx > 0, 'getInventoryStatus export must exist');
    const end = source.indexOf('\n}', idx);
    const body = source.slice(idx, end);
    assert.doesNotMatch(body, /p\.stock_quantity/, 'getInventoryStatus must not read products.stock_quantity');
    assert.doesNotMatch(body, /item\.stock_quantity/, 'getInventoryStatus must not branch on item.stock_quantity');
    assert.match(body, /SUM\(i\.quantity\)|SUM\(inventory\.quantity\)|i\.quantity/, 'getInventoryStatus must derive quantity from inventory.quantity');
  });
});