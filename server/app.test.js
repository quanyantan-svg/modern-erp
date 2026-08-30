import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('健康检查和前端静态入口可访问', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'modern-erp-api' });

  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Modern ERP/);
});

test('登录、工作台和后端权限校验形成闭环', async () => {
  const { token, user } = await login('sales', 'sales123');
  assert.equal(user.username, 'sales');
  const headers = { authorization: `Bearer ${token}` };

  assert.equal((await fetch(`${baseUrl}/api/dashboard`, { headers })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/users`, { headers })).status, 403);
});

test('扩展业务模块在全新数据库中完成迁移并可查询', async () => {
  const { token } = await login('admin', 'admin123');
  const headers = { authorization: `Bearer ${token}` };
  const paths = [
    '/api/contacts', '/api/projects', '/api/notifications', '/api/departments',
    '/api/aux-projects', '/api/mrp-plans', '/api/iqc', '/api/oqc',
    '/api/leave-requests', '/api/expense-claims', '/api/alert-rules',
    '/api/reports/financial-summary', '/api/reports/inventory-status',
    '/api/reports/sales-analysis',
  ];

  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    assert.equal(response.status, 200, `${path} returned ${response.status}: ${await response.text()}`);
  }
});
