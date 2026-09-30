import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const appSource = readFileSync(join(root, 'src', 'App.jsx'), 'utf8');
const pageSource = readFileSync(join(root, 'src', 'pages', 'data-cleanup.jsx'), 'utf8');
const metadataSource = readFileSync(join(root, 'src', 'navigation', 'applicationMetadata.js'), 'utf8');
let db; let server; let baseUrl; let tempDir; let adminToken; let salesToken;
const stamp = '2026-09-21T08:00:00.000Z';

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const response = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(response.status, 200);
  return response.data.token;
}

function insert(table, values) {
  const columns = Object.keys(values);
  db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(values));
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-lifecycle-product-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Lifecycle product APIs', () => {
  test('record and audit queries remain administrator-only', async () => {
    assert.equal((await request('/api/lifecycle/records', { token: salesToken })).status, 403);
    assert.equal((await request('/api/lifecycle/cleanup-events', { token: salesToken })).status, 403);
    const result = await request('/api/lifecycle/records');
    assert.equal(result.status, 200);
    assert.equal(result.data.entityTypes.length, 25);
  });

  test('archive is hidden in normal list, includeArchived reveals it, restore returns it', async () => {
    insert('sales_orders', { id: 'phase7-order', order_no: 'SO-PHASE7', customer_id: 'customer-001', status: 'DRAFT', total_cents: 0, creator_id: 'user-admin', created_at: stamp, updated_at: stamp });
    assert.equal((await request('/api/lifecycle/archive', { method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'phase7-order', reason: '错误测试记录' } })).status, 200);
    assert.ok(!(await request('/api/orders')).data.orders.some((row) => row.id === 'phase7-order'));
    assert.ok((await request('/api/orders?includeArchived=true')).data.orders.some((row) => row.id === 'phase7-order'));
    const archived = await request('/api/lifecycle/records?search=SO-PHASE7&includeArchived=true');
    assert.equal(archived.data.records[0].archived, true);
    assert.equal(archived.data.records[0].archiveReason, '错误测试记录');
    assert.equal((await request('/api/lifecycle/restore', { method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'phase7-order' } })).status, 200);
    assert.ok((await request('/api/orders')).data.orders.some((row) => row.id === 'phase7-order'));
  });

  test('planning lists use the same archive contract', async () => {
    insert('planning_forecasts', { id: 'phase7-forecast', forecast_code: 'FC-PHASE7', forecast_name: '归档测试', period_start: '2026-09-01', period_end: '2026-09-30', status: 'DRAFT', created_by: 'user-admin', created_at: stamp, updated_at: stamp });
    await request('/api/lifecycle/archive', { method: 'POST', body: { entityType: 'PLANNING_FORECAST', entityId: 'phase7-forecast', reason: '历史预测' } });
    assert.ok(!(await request('/api/planning/forecasts')).data.forecasts.some((row) => row.id === 'phase7-forecast'));
    assert.ok((await request('/api/planning/forecasts?includeArchived=true')).data.forecasts.some((row) => row.id === 'phase7-forecast'));
  });

  test('cleanup audit is queryable after the business record is gone', async () => {
    insert('sales_orders', { id: 'phase7-delete', order_no: 'SO-PHASE7-DELETE', customer_id: 'customer-001', status: 'DRAFT', total_cents: 0, creator_id: 'user-admin', created_at: stamp, updated_at: stamp });
    const cleanup = await request('/api/lifecycle/cleanup', { method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'phase7-delete', reason: '误录测试数据', confirm: true } });
    assert.equal(cleanup.status, 200, JSON.stringify(cleanup.data));
    assert.equal(db.prepare("SELECT 1 FROM sales_orders WHERE id='phase7-delete'").get(), undefined);
    const events = await request('/api/lifecycle/cleanup-events?search=SO-PHASE7-DELETE');
    assert.equal(events.data.events.length, 1);
    assert.equal(events.data.events[0].items[0].documentNo, 'SO-PHASE7-DELETE');
  });
});

describe('Data cleanup product wiring', () => {
  test('data-cleanup route is wired with USERS_MANAGE gate but excluded from launcher tiles', () => {
    // V1.6 P1B: data-cleanup continues to be a reachable disabled route
    // via the navigation registry but is NOT a primary launcher tile.
    assert.match(appSource, /key:\s*['"]data-cleanup['"][\s\S]*?permission:\s*['"]USERS_MANAGE['"]/);
    assert.match(appSource, /['"]data-cleanup['"]:\s*<DataCleanup/);
    assert.doesNotMatch(metadataSource, /\['data-cleanup', '数据整理'/);
  });

  test('cleanup UX uses one sheet at a time and requires destructive reasons', () => {
    for (const component of ['SearchField', 'FilterSheet', 'RecordCard', 'LifecycleBadge', 'DependencyGraphSheet', 'DangerSheet', 'BottomActionBar']) assert.ok(pageSource.includes(component));
    assert.match(pageSource, /if \(\(confirmAction === 'cleanup' \|\| confirmAction === 'archive'\) && !cleanReason\)/);
    assert.doesNotMatch(pageSource, /<Sheet[\s\S]*?<DependencyGraphSheet[\s\S]*?<\/Sheet>/);
    assert.doesNotMatch(pageSource, /SQLITE|FOREIGN KEY|stack trace|Failed to fetch/);
  });
});
