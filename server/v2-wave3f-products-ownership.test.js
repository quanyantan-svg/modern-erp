// V2 Stage 3 / Wave 3F — focused behavior coverage for the migrated
// /api/products Product master-data route family.
//
// Pure ownership-migration tests. The pre-existing tests already cover:
//   - server/v13-function-freeze-p1-stock-quantity.test.js proves
//     listProducts stockQuantity is SUM(inventory.quantity) and
//     updateProduct rejects stockQuantity / stock_quantity writes;
//   - server/v13-phase3-quality-gates.test.js exercises master-data
//     creation paths for downstream QC and process flows;
//   - server/teacher-acceptance-matrix.test.js exercises master-data
//     CRUD through HTTP for the teacher acceptance matrix;
//   - server/p2-data-lifecycle.test.js exercises the canonical
//     deleteMasterRecord product lifecycle (referenced 409,
//     unreferenced 200, DELETE audit);
//   - server/v13-function-freeze-p1-stock-quantity.test.js exercises
//     the "stockQuantity is read-only" 409 contract.
//
// This suite complements — does not duplicate — those tests by
// proving the canonical Product master-data contract end-to-end after
// the route-table migration:
//   - GET /api/products returns the canonical product list with the
//     historical shape (id, code, name, unit, baseUomCode,
//     purchaseUomCode, salesUomCode, priceCents,
//     standardManufacturingCostCents, derived stockQuantity,
//     active Boolean, trackingPolicy, shelfLifeDays,
//     trackingEffectiveAt, valuationMethod, inventoryClassification,
//     createdAt, updatedAt) and is searchable by code / name;
//   - GET /api/products requires PRODUCTS_VIEW or PRODUCTS_MANAGE and
//     rejects unauthenticated callers;
//   - POST /api/products persists the canonical product row, the
//     default inventoryClassification / trackingPolicy /
//     shelfLifeDays behavior, the UOM row creation, the hard-coded
//     active=1, the products.stock_quantity=0, and writes CREATE
//     PRODUCT audit;
//   - POST rejects invalid standardManufacturingCostCents, invalid
//     trackingPolicy with the exact 400 "库存跟踪方式无效" +
//     TRACKING_POLICY_MISMATCH code, and invalid shelfLifeDays;
//   - PATCH /api/products/:id updates display fields, persists
//     baseUom / standardManufacturingCostCents / classification,
//     returns 404 for a non-existent product, rejects stockQuantity /
//     stock_quantity writes with the exact 409 "货品库存数量只读…",
//     and rejects a base-UOM change once inventory_transactions
//     exist with the exact 409 "已有历史交易的产品不可变更基础单位";
//   - DELETE /api/products/:id delegates to deleteMasterRecord
//     (200 on unreferenced + DELETE PRODUCT audit; 409
//     RECORD_REFERENCED on a referenced product);
//   - PATCH /api/products/:id/tracking-policy continues to dispatch
//     via the legacy handleApi branch to
//     updateProductTrackingHandler in
//     server/modules/traceability-quality.js (NOT to the
//     route-table).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { hashPassword, createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, `login ${username} failed: ${result.data.error}`);
  return result.data.token;
}

function adminRoleId() {
  return database.prepare("SELECT id FROM roles WHERE code='ADMIN'").get().id;
}

function seedWarehouse() {
  const id = 'wh-wave3f';
  const now = new Date().toISOString();
  database.prepare(
    "INSERT OR IGNORE INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)",
  ).run(id, 'WH-W3F', 'Wave3F Warehouse', '', '', now, now);
  return id;
}

function insertInventoryTransaction(productId, tag = 'base-uom') {
  const now = new Date().toISOString();
  // A minimal inventory_transactions row is enough to make the
  // base-UOM change guard fire. The handler's guard only checks for
  // the existence of any inventory_transactions row for the product.
  database.prepare(
    "INSERT INTO inventory_transactions(id, warehouse_id, product_id, quantity_change, direction, balance_after, source_type, source_id, source_no, creator_id, created_at) VALUES(?, ?, ?, 1, 'IN', 1, 'OPENING_BATCH', ?, '', 'user-admin', ?)",
  ).run(`itx-wave3f-${tag}`, seedWarehouse(), productId, `ob-${tag}`, now);
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave3f-products-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 3F — product master-data route family behavior preservation', () => {
  test('GET /api/products returns the canonical product list with derived stockQuantity, joined fields, and active as Boolean', async () => {
    const result = await request('/api/products');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.products));
    // The seed product 'P-001' is present from db.js seedSchema.
    const sample = result.data.products.find((row) => row.id === 'p-001') || result.data.products[0];
    assert.ok(sample, 'at least one seeded product must be present');

    const expectedKeys = [
      'active',
      'baseUomCode',
      'code',
      'createdAt',
      'id',
      'inventoryClassification',
      'name',
      'priceCents',
      'purchaseUomCode',
      'salesUomCode',
      'shelfLifeDays',
      'standardManufacturingCostCents',
      'stockQuantity',
      'trackingEffectiveAt',
      'trackingPolicy',
      'unit',
      'updatedAt',
      'valuationMethod',
    ].sort();
    const actualKeys = Object.keys(sample).sort();
    assert.deepEqual(actualKeys, expectedKeys, `GET /api/products row shape must match the canonical field set; got ${JSON.stringify(actualKeys)}`);
    assert.equal(typeof sample.active, 'boolean', 'active must be a Boolean');
    assert.equal(typeof sample.priceCents, 'number');
    assert.equal(typeof sample.standardManufacturingCostCents, 'number');
    assert.equal(typeof sample.stockQuantity, 'number', 'stockQuantity must be derived as a number');
  });

  test('GET /api/products search filter returns matching rows by code/name', async () => {
    const created = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-SEARCH',
        name: 'W3F Searchable Widget',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
        baseUomCode: 'EA',
        purchaseUomCode: 'EA',
        salesUomCode: 'EA',
        inventoryClassification: 'FINISHED_GOOD',
        trackingPolicy: 'NONE',
        shelfLifeDays: 30,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));

    const byCode = await request('/api/products?search=W3F-SEARCH');
    assert.equal(byCode.status, 200);
    assert.ok(byCode.data.products.some((row) => row.code === 'W3F-SEARCH'));

    const byName = await request('/api/products?search=Searchable');
    assert.equal(byName.status, 200);
    assert.ok(byName.data.products.some((row) => row.name === 'W3F Searchable Widget'));

    const empty = await request('/api/products?search=__no_such_match__');
    assert.equal(empty.status, 200);
    assert.equal(empty.data.products.length, 0);
  });

  test('GET /api/products is reachable for any role with PRODUCTS_VIEW/PRODUCTS_MANAGE; rejects unauthenticated', async () => {
    // admin has PRODUCTS_MANAGE — reachable.
    const adminRes = await request('/api/products', { token: adminToken });
    assert.equal(adminRes.status, 200);

    // sales has PRODUCTS_VIEW — also reachable.
    const salesRes = await request('/api/products', { token: salesToken });
    assert.equal(salesRes.status, 200);

    // Unauthenticated.
    const unauthRes = await request('/api/products', { token: '' });
    assert.equal(unauthRes.status, 401);
  });

  test('POST /api/products persists the canonical row with defaults, UOM auto-create, hard-coded active=1, stock_quantity=0, and writes CREATE PRODUCT audit', async () => {
    const result = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-CREATE-1',
        name: 'W3F Create One',
        unit: 'EA',
        priceCents: 2500,
        standardManufacturingCostCents: 1200,
        baseUomCode: 'EA',
        purchaseUomCode: 'EA',
        salesUomCode: 'EA',
        inventoryClassification: 'FINISHED_GOOD',
        trackingPolicy: 'NONE',
        shelfLifeDays: 60,
      },
    });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(typeof result.data.id, 'string');

    const row = database.prepare('SELECT * FROM products WHERE id=?').get(result.data.id);
    assert.equal(row.code, 'W3F-CREATE-1');
    assert.equal(row.name, 'W3F Create One');
    assert.equal(row.unit, 'EA');
    assert.equal(row.base_uom_code, 'EA');
    assert.equal(row.purchase_uom_code, 'EA');
    assert.equal(row.sales_uom_code, 'EA');
    assert.equal(row.price_cents, 2500);
    assert.equal(row.standard_manufacturing_cost_cents, 1200);
    assert.equal(row.stock_quantity, 0, 'POST /api/products must hard-code products.stock_quantity=0');
    assert.equal(row.active, 1);
    assert.equal(row.inventory_classification, 'FINISHED_GOOD');
    assert.equal(row.tracking_policy, 'NONE');
    assert.equal(row.shelf_life_days, 60);

    // UOM row created via INSERT OR IGNORE.
    const uom = database.prepare('SELECT code FROM uoms WHERE code=?').get('EA');
    assert.ok(uom, 'UOM row must be auto-created (INSERT OR IGNORE)');

    // CREATE PRODUCT audit with the canonical detail format.
    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='CREATE' AND entity_type='PRODUCT' AND entity_id=?").get(result.data.id);
    assert.ok(audit, 'CREATE PRODUCT audit must be written');
    assert.match(audit.detail, /^W3F-CREATE-1; tracking=NONE$/);
  });

  test('POST /api/products rejects an invalid trackingPolicy with the exact 400 "库存跟踪方式无效" + TRACKING_POLICY_MISMATCH code', async () => {
    const result = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-BAD-POL',
        name: 'Bad Policy',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
        inventoryClassification: 'FINISHED_GOOD',
        trackingPolicy: 'BOGUS_POLICY',
      },
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, '库存跟踪方式无效');
    assert.equal(result.data.code, 'TRACKING_POLICY_MISMATCH');
  });

  test('POST /api/products rejects negative standardManufacturingCostCents and invalid shelfLifeDays', async () => {
    const negative = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-NEG-COST',
        name: 'Negative Cost',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: -1,
      },
    });
    assert.equal(negative.status, 400);
    assert.equal(negative.data.error, '标准制造成本必须是非负整数分');

    const badShelf = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-BAD-SHELF',
        name: 'Bad Shelf Life',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
        shelfLifeDays: 0,
      },
    });
    assert.equal(badShelf.status, 400);
    assert.equal(badShelf.data.error, '保质期必须为正整数天');
  });

  test('POST /api/products rejects sales (no PRODUCTS_MANAGE) with 403', async () => {
    const result = await request('/api/products', {
      token: salesToken,
      method: 'POST',
      body: {
        code: 'W3F-BY-SALES',
        name: 'By Sales',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
      },
    });
    assert.equal(result.status, 403);
  });

  test('PATCH /api/products/:id updates display fields, persists classification + baseUom, returns 404 for missing product, writes UPDATE PRODUCT audit', async () => {
    const created = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-PATCH-1',
        name: 'Initial Name',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
        inventoryClassification: 'RAW_MATERIAL',
      },
    });
    assert.equal(created.status, 201);
    const id = created.data.id;

    const patched = await request(`/api/products/${id}`, {
      method: 'PATCH',
      body: {
        name: 'Renamed W3F',
        priceCents: 250,
        standardManufacturingCostCents: 80,
        inventoryClassification: 'FINISHED_GOOD',
      },
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.data, { ok: true });

    const row = database.prepare('SELECT name, price_cents, standard_manufacturing_cost_cents, inventory_classification FROM products WHERE id=?').get(id);
    assert.equal(row.name, 'Renamed W3F');
    assert.equal(row.price_cents, 250);
    assert.equal(row.standard_manufacturing_cost_cents, 80);
    assert.equal(row.inventory_classification, 'FINISHED_GOOD');

    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='UPDATE' AND entity_type='PRODUCT' AND entity_id=?").get(id);
    assert.ok(audit, 'UPDATE PRODUCT audit must be written');
    // The canonical updateProduct audit detail is `product.code`, not the display name.
    assert.equal(audit.detail, 'W3F-PATCH-1');

    const missing = await request('/api/products/__no_such_product__', {
      method: 'PATCH',
      body: { name: 'Missing' },
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.data.error, '货品不存在');
  });

  test('PATCH /api/products/:id rejects stockQuantity / stock_quantity writes with the exact 409 "货品库存数量只读，请通过库存业务单据变更"', async () => {
    const created = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-STOCKQ-1',
        name: 'Stock Write',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
      },
    });
    assert.equal(created.status, 201);
    const id = created.data.id;

    const cam = await request(`/api/products/${id}`, {
      method: 'PATCH',
      body: { stockQuantity: 99999 },
    });
    assert.equal(cam.status, 409);
    assert.equal(cam.data.error, '货品库存数量只读，请通过库存业务单据变更');

    const snake = await request(`/api/products/${id}`, {
      method: 'PATCH',
      body: { stock_quantity: 99999 },
    });
    assert.equal(snake.status, 409);
    assert.equal(snake.data.error, '货品库存数量只读，请通过库存业务单据变更');

    // products.stock_quantity must still be 0 (the canonical create default).
    const row = database.prepare('SELECT stock_quantity FROM products WHERE id=?').get(id);
    assert.equal(row.stock_quantity, 0);
  });

  test('PATCH /api/products/:id allows a baseUom change when no inventory_transactions exist, but rejects once inventory_transactions exist with the exact 409 "已有历史交易的产品不可变更基础单位"', async () => {
    // Seed a product with no inventory_transactions.
    const created = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-BASE-UOM',
        name: 'Base UOM',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
        baseUomCode: 'EA',
      },
    });
    assert.equal(created.status, 201);
    const id = created.data.id;

    // Base-UOM change while no inventory_transactions: must succeed.
    const okChange = await request(`/api/products/${id}`, {
      method: 'PATCH',
      body: { baseUomCode: 'PCS' },
    });
    assert.equal(okChange.status, 200);
    let row = database.prepare('SELECT base_uom_code FROM products WHERE id=?').get(id);
    assert.equal(row.base_uom_code, 'PCS');

    // Plant a canonical inventory_transactions row.
    insertInventoryTransaction(id);

    // Now a second base-UOM change must be rejected with the exact
    // 409 contract.
    const blocked = await request(`/api/products/${id}`, {
      method: 'PATCH',
      body: { baseUomCode: 'BOX' },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error, '已有历史交易的产品不可变更基础单位');

    row = database.prepare('SELECT base_uom_code FROM products WHERE id=?').get(id);
    assert.equal(row.base_uom_code, 'PCS', 'base_uom_code must remain at the first change (PCS) — the second change was rejected');
  });

  test('DELETE /api/products/:id delegates to deleteMasterRecord (200 on unreferenced + DELETE PRODUCT audit; 409 RECORD_REFERENCED on a referenced product)', async () => {
    // Seed two products: one with no references, one that will be referenced.
    const unreferenced = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-DEL-OK',
        name: 'Deletable',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
      },
    });
    assert.equal(unreferenced.status, 201);

    const referenced = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-DEL-REF',
        name: 'Referenced',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
      },
    });
    assert.equal(referenced.status, 201);
    insertInventoryTransaction(referenced.data.id, 'del-ref');

    // Unreferenced: 200 + DELETE PRODUCT audit.
    const ok = await request(`/api/products/${unreferenced.data.id}`, { method: 'DELETE' });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { ok: true });
    const stillThere = database.prepare('SELECT id FROM products WHERE id=?').get(unreferenced.data.id);
    assert.equal(stillThere, undefined, 'unreferenced product must be removed');
    const audit = database.prepare("SELECT * FROM audit_logs WHERE action='DELETE' AND entity_type='PRODUCT' AND entity_id=?").get(unreferenced.data.id);
    assert.ok(audit, 'DELETE PRODUCT audit must be written');

    // Referenced: 409 RECORD_REFERENCED.
    const blocked = await request(`/api/products/${referenced.data.id}`, { method: 'DELETE' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'RECORD_REFERENCED');
    const stillReferenced = database.prepare('SELECT id FROM products WHERE id=?').get(referenced.data.id);
    assert.ok(stillReferenced, 'referenced product must NOT be removed');
  });

  test('PATCH /api/products/:id/tracking-policy continues to dispatch via the legacy handleApi branch to updateProductTrackingHandler (NOT via the route-table)', async () => {
    // Wave 3F explicitly does NOT migrate the tracking-policy route.
    // A successful PATCH requires the canonical
    // updateProductTrackingHandler to run; we only verify that the
    // route is NOT rejected as 404 / NOT FOUND / UNKNOWN at the
    // route-table lookup. A non-tracking-policy body is sufficient
    // to reach the legacy branch; the full tracking-policy semantics
    // are exercised by the dedicated traceability-quality suite and
    // remain unchanged.
    const created = await request('/api/products', {
      method: 'POST',
      body: {
        code: 'W3F-TRACK',
        name: 'Tracking Subject',
        unit: 'EA',
        priceCents: 100,
        standardManufacturingCostCents: 50,
      },
    });
    assert.equal(created.status, 201);

    // This PATCH targets the canonical tracking-policy route shape.
    // We only assert that the route is reachable (not a 404 from the
    // route-table), proving it continues to dispatch through the
    // legacy handleApi branch. The full semantic contract for
    // tracking-policy changes is owned by
    // server/modules/traceability-quality.js and is preserved by
    // brief §11.
    const result = await request(`/api/products/${created.data.id}/tracking-policy`, {
      method: 'PATCH',
      body: {},
    });
    assert.notEqual(result.status, 404, 'PATCH /api/products/:id/tracking-policy must NOT be routed through ownedRouteTable (must hit the legacy handleApi branch)');
  });
});
