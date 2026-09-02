import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer as createViteServer } from 'vite';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';
import { centsToYuanInput, yuanToNonNegativeCents } from '../src/lib/money.js';

function addActor(db, suffix, permissions) {
  const roleId = `role-cost-${suffix}`;
  const userId = `user-cost-${suffix}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
    .run(roleId, `COST_${suffix.toUpperCase()}`, suffix, '', now);
  for (const permission of permissions) db.prepare('INSERT INTO role_permissions(role_id,permission_code) VALUES(?,?)').run(roleId, permission);
  const password = `cost-${suffix}-1234`;
  const hashed = hashPassword(password);
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES(?,?,?,?,?,?,1,?)`).run(userId, `cost_${suffix}`, suffix, hashed.hash, hashed.salt, roleId, now);
  return { username: `cost_${suffix}`, password };
}

async function startApi(db) {
  const server = createHttpServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body.token;
}

async function api(baseUrl, token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
    body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

const validCost = (overrides = {}) => ({
  productId: 'product-001', materialCostCents: 10000, laborCostCents: 3000,
  overheadCostCents: 2345, standardCostCents: 15345, effectiveDate: '2026-09-01', remark: 'C1', ...overrides,
});

const validRate = (overrides = {}) => ({
  rateType: 'LABOR_RATE', rateValue: 88.5, unit: '元/小时', effectiveDate: '2026-09-01', remark: 'C1', ...overrides,
});

describe('Cost exact money boundary', () => {
  test('153.45 yuan converts to exactly 15345 cents', () => assert.equal(yuanToNonNegativeCents('153.45'), 15345));
  test('zero is valid for an individual cost component', () => assert.equal(yuanToNonNegativeCents('0.00'), 0));
  test('more than two decimals is rejected without rounding', () => assert.equal(yuanToNonNegativeCents('1.005'), null));
  test('15345 cents displays as 153.45 yuan', () => assert.equal(centsToYuanInput(15345), '153.45'));
});

describe('Cost frontend modal behavior', () => {
  let vite;
  let ui;

  before(async () => {
    vite = await createViteServer({ root: resolve('.'), server: { middlewareMode: true }, appType: 'custom' });
    ui = await vite.ssrLoadModule('/src/pages/treasury-cost.jsx');
  });
  after(async () => { await vite.close(); });

  test('Standard Cost modal renders real form controls', () => {
    const html = renderToStaticMarkup(createElement(ui.ProductCostModal, { products: [{ id: 'p1', code: 'P1', name: '产品' }], value: {}, notify() {}, onClose() {}, onSaved() {} }));
    assert.match(html, /设置标准成本/);
    assert.match(html, /材料成本\(元\)/);
    assert.match(html, /标准成本: ¥0\.00/);
  });

  test('Cost Rate modal renders only canonical fields', () => {
    const html = renderToStaticMarkup(createElement(ui.CostRateModal, { value: {}, notify() {}, onClose() {}, onSaved() {} }));
    assert.match(html, /费率类型/);
    assert.match(html, /生效日期/);
    assert.doesNotMatch(html, /编号|启用该项目/);
  });

  test('rejected save is converted to controlled notify and does not throw', async () => {
    const notices = [];
    let saved = false;
    const result = await ui.runCostSave(() => Promise.reject(new Error('业务拒绝')), () => { saved = true; }, (...args) => notices.push(args));
    assert.equal(result, false);
    assert.equal(saved, false);
    assert.deepEqual(notices, [['业务拒绝', 'error']]);
  });

  test('successful save invokes completion without an error notification', async () => {
    const notices = [];
    let saved = false;
    const result = await ui.runCostSave(() => Promise.resolve(), () => { saved = true; }, (...args) => notices.push(args));
    assert.equal(result, true);
    assert.equal(saved, true);
    assert.deepEqual(notices, []);
  });
});

describe('Cost canonical API and authorization', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  let adminToken;
  let viewToken;
  let manageToken;
  let productsToken;
  let accountingToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-cost-'));
    db = createDatabase(join(tmp, 'erp.db'));
    const view = addActor(db, 'view', ['COST_VIEW']);
    const manage = addActor(db, 'manage', ['COST_MANAGE']);
    const products = addActor(db, 'products', ['PRODUCTS_VIEW']);
    ({ server, baseUrl } = await startApi(db));
    adminToken = await login(baseUrl, 'admin', 'admin123');
    viewToken = await login(baseUrl, view.username, view.password);
    manageToken = await login(baseUrl, manage.username, manage.password);
    productsToken = await login(baseUrl, products.username, products.password);
    accountingToken = await login(baseUrl, 'accounting', 'accounting123');
  });

  after(async () => {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('fresh DB cost-rate GET returns an empty canonical collection', async () => {
    const result = await api(baseUrl, adminToken, '/api/cost-rates');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.rates, []);
  });

  test('valid Standard Cost persists and responds with exact integer cents', async () => {
    const result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost() });
    assert.equal(result.status, 201, result.body.error);
    assert.equal(result.body.cost.standardCostCents, 15345);
    assert.equal(db.prepare('SELECT standard_cost_cents value FROM product_costs WHERE id=?').get(result.body.cost.id).value, 15345);
  });

  test('all component cents persist without conversion', () => {
    const row = db.prepare("SELECT * FROM product_costs WHERE product_id='product-001' AND status='ACTIVE'").get();
    assert.deepEqual([row.material_cost_cents, row.labor_cost_cents, row.overhead_cost_cents], [10000, 3000, 2345]);
  });

  test('Standard Cost never changes product selling price', () => {
    assert.equal(db.prepare("SELECT price_cents value FROM products WHERE id='product-001'").get().value, 259900);
  });

  test('client total inconsistent with components is rejected', async () => {
    const result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost({ standardCostCents: 15344 }) });
    assert.equal(result.status, 400);
  });

  test('missing amounts are rejected rather than silently coerced to zero', async () => {
    const body = validCost();
    delete body.laborCostCents;
    const result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body });
    assert.equal(result.status, 400);
  });

  test('negative cost components are rejected', async () => {
    const result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost({ materialCostCents: -1, standardCostCents: 5344 }) });
    assert.equal(result.status, 400);
  });

  test('invalid effective dates are rejected', async () => {
    const result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost({ effectiveDate: '2026-02-30' }) });
    assert.equal(result.status, 400);
  });

  test('next version retires the previous ACTIVE row and leaves one ACTIVE row', async () => {
    const previous = db.prepare("SELECT id FROM product_costs WHERE product_id='product-001' AND status='ACTIVE'").get();
    const result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost({ materialCostCents: 11000, standardCostCents: 16345, effectiveDate: '2026-09-02' }) });
    assert.equal(result.status, 201, result.body.error);
    assert.equal(db.prepare('SELECT status FROM product_costs WHERE id=?').get(previous.id).status, 'HISTORICAL');
    assert.equal(db.prepare("SELECT count(*) count FROM product_costs WHERE product_id='product-001' AND status='ACTIVE'").get().count, 1);
  });

  test('injected insert failure rolls back prior ACTIVE retirement', async () => {
    const activeBefore = db.prepare("SELECT id FROM product_costs WHERE product_id='product-001' AND status='ACTIVE'").get().id;
    db.exec("CREATE TRIGGER fail_cost_insert BEFORE INSERT ON product_costs WHEN NEW.remark='INJECT_FAILURE' BEGIN SELECT RAISE(ABORT, 'injected'); END");
    const originalConsoleError = console.error;
    console.error = () => {};
    let result;
    try {
      result = await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost({ remark: 'INJECT_FAILURE', effectiveDate: '2026-09-03' }) });
    } finally {
      console.error = originalConsoleError;
    }
    db.exec('DROP TRIGGER fail_cost_insert');
    assert.equal(result.status, 500);
    assert.equal(db.prepare('SELECT status FROM product_costs WHERE id=?').get(activeBefore).status, 'ACTIVE');
    assert.equal(db.prepare("SELECT count(*) count FROM product_costs WHERE product_id='product-001' AND status='ACTIVE'").get().count, 1);
  });

  test('productId query filters the Standard Cost list', async () => {
    await api(baseUrl, adminToken, '/api/product-costs', { method: 'POST', body: validCost({ productId: 'product-002', materialCostCents: 5000, laborCostCents: 0, overheadCostCents: 0, standardCostCents: 5000 }) });
    const result = await api(baseUrl, adminToken, '/api/product-costs?productId=product-002');
    assert.equal(result.status, 200);
    assert.ok(result.body.costs.length > 0);
    assert.ok(result.body.costs.every((cost) => cost.productId === 'product-002'));
  });

  let rateId;
  test('valid canonical Cost Rate POST persists', async () => {
    const result = await api(baseUrl, adminToken, '/api/cost-rates', { method: 'POST', body: validRate() });
    assert.equal(result.status, 201, result.body.error);
    rateId = result.body.rate.id;
    assert.equal(result.body.rate.rateValue, 88.5);
  });

  test('canonical Cost Rate PATCH updates actual normalized columns', async () => {
    const result = await api(baseUrl, adminToken, `/api/cost-rates/${rateId}`, { method: 'PATCH', body: validRate({ rateType: 'OVERHEAD_RATE', rateValue: 0.42, unit: '比例', effectiveDate: '2026-09-02' }) });
    assert.equal(result.status, 200, result.body.error);
    assert.equal(result.body.rate.rateValue, 0.42);
    assert.equal(db.prepare('SELECT rate_type type FROM cost_rates WHERE id=?').get(rateId).type, 'OVERHEAD_RATE');
  });

  test('Cost Rate refresh returns only canonical public fields', async () => {
    const result = await api(baseUrl, adminToken, '/api/cost-rates');
    const row = result.body.rates.find((rate) => rate.id === rateId);
    assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'creatorId', 'creatorName', 'effectiveDate', 'id', 'rateType', 'rateValue', 'remark', 'unit', 'updatedAt'].sort());
  });

  test('invalid non-finite-shaped Cost Rate values are rejected', async () => {
    const result = await api(baseUrl, adminToken, '/api/cost-rates', { method: 'POST', body: validRate({ rateValue: 'NaN' }) });
    assert.equal(result.status, 400);
  });

  test('COST_VIEW actor can read both Cost resources', async () => {
    assert.equal((await api(baseUrl, viewToken, '/api/product-costs')).status, 200);
    assert.equal((await api(baseUrl, viewToken, '/api/cost-rates')).status, 200);
    const lookup = await api(baseUrl, viewToken, '/api/product-costs/products');
    assert.equal(lookup.status, 200);
    assert.deepEqual(Object.keys(lookup.body.products[0]).sort(), ['code', 'id', 'name']);
  });

  test('COST_VIEW actor cannot write Cost resources', async () => {
    assert.equal((await api(baseUrl, viewToken, '/api/product-costs', { method: 'POST', body: validCost() })).status, 403);
    assert.equal((await api(baseUrl, viewToken, '/api/cost-rates', { method: 'POST', body: validRate() })).status, 403);
  });

  test('COST_MANAGE actor can read and write Cost resources', async () => {
    assert.equal((await api(baseUrl, manageToken, '/api/cost-rates')).status, 200);
    assert.equal((await api(baseUrl, manageToken, '/api/cost-rates', { method: 'POST', body: validRate({ rateType: 'MATERIAL_RATE' }) })).status, 201);
  });

  test('PRODUCTS_VIEW alone cannot read either Cost API', async () => {
    assert.equal((await api(baseUrl, productsToken, '/api/product-costs')).status, 403);
    assert.equal((await api(baseUrl, productsToken, '/api/cost-rates')).status, 403);
    assert.equal((await api(baseUrl, productsToken, '/api/product-costs/products')).status, 403);
  });

  test('ACCOUNTING_VIEW alone cannot write either Cost API', async () => {
    assert.equal((await api(baseUrl, accountingToken, '/api/product-costs', { method: 'POST', body: validCost() })).status, 403);
    assert.equal((await api(baseUrl, accountingToken, '/api/cost-rates', { method: 'POST', body: validRate() })).status, 403);
  });
});

describe('Legacy Cost Rate startup reconciliation', () => {
  let tmp;
  let filename;
  let db;
  let server;
  let baseUrl;
  let adminToken;

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-cost-legacy-'));
    filename = join(tmp, 'erp.db');
    createDatabase(filename).close();
    const legacy = new DatabaseSync(filename);
    legacy.exec(`PRAGMA foreign_keys=OFF; DROP TABLE cost_rates;
      CREATE TABLE cost_rates (
        id TEXT PRIMARY KEY, code TEXT, name TEXT, category TEXT, rate_cents_per_hour INTEGER,
        unit TEXT, active INTEGER, remark TEXT, creator_id TEXT, created_at TEXT, updated_at TEXT
      );
      INSERT INTO cost_rates VALUES('legacy-rate','LR-1','旧人工费率','LABOR',12345,'小时',1,'保留此行','user-admin','2025-01-02T00:00:00.000Z','2025-01-03T00:00:00.000Z');`);
    legacy.close();
    db = createDatabase(filename);
    ({ server, baseUrl } = await startApi(db));
    adminToken = await login(baseUrl, 'admin', 'admin123');
  });

  after(async () => {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('legacy schema is replaced by canonical columns without obsolete columns', () => {
    const columns = db.prepare('PRAGMA table_info(cost_rates)').all().map((column) => column.name);
    assert.ok(['rate_type', 'rate_value', 'effective_date'].every((column) => columns.includes(column)));
    assert.ok(['name', 'category', 'rate_cents_per_hour', 'active'].every((column) => !columns.includes(column)));
  });

  test('meaningful legacy row and cents value are preserved canonically', () => {
    const row = db.prepare("SELECT * FROM cost_rates WHERE id='legacy-rate'").get();
    assert.equal(row.rate_type, 'LABOR_RATE');
    assert.equal(row.rate_value, 123.45);
    assert.equal(row.effective_date, '2025-01-02');
    assert.equal(row.remark, '保留此行');
  });

  test('second startup is idempotent and non-destructive', () => {
    const reopened = createDatabase(filename);
    const rows = reopened.prepare("SELECT id,rate_type,rate_value FROM cost_rates WHERE id='legacy-rate'").all();
    reopened.close();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'legacy-rate');
    assert.equal(rows[0].rate_type, 'LABOR_RATE');
    assert.equal(rows[0].rate_value, 123.45);
  });

  test('GET POST and PATCH remain usable after legacy migration', async () => {
    const get = await api(baseUrl, adminToken, '/api/cost-rates');
    assert.equal(get.status, 200);
    assert.ok(get.body.rates.some((rate) => rate.id === 'legacy-rate'));
    const post = await api(baseUrl, adminToken, '/api/cost-rates', { method: 'POST', body: validRate() });
    assert.equal(post.status, 201, post.body.error);
    const patch = await api(baseUrl, adminToken, `/api/cost-rates/${post.body.rate.id}`, { method: 'PATCH', body: validRate({ rateValue: 99 }) });
    assert.equal(patch.status, 200, patch.body.error);
    assert.equal(patch.body.rate.rateValue, 99);
  });
});
