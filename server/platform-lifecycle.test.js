// Platform 文档生命周期工作面合同（PL-06 的 operator 工作面 + PL-DEF-04 的权限专化）。
//
// 设计来源：docs/design/platform.md §32.10；Requirement §36.10。
//
// 断言三件事：
//   1. **权限专化**：生命周期 / 归档不再借用管理员权限 —— `LIFECYCLE_VIEW` 看、
//      `LIFECYCLE_MANAGE` 管；`USERS_MANAGE` 只作为**兼容别名**存在。
//   2. **fail closed**：既无专用码也无别名的主体一律 403；只读主体不能写。
//   3. **operator 工作面可达**：路由 'lifecycle' 已启用并绑定专用权限码，
//      旧的停用路由 'data-cleanup' 已退役，页面文件与屏根 testid 就位。

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const registrySource = readFileSync(join(root, 'src', 'navigation', 'applicationRegistry.js'), 'utf8');
const pageSource = readFileSync(join(root, 'src', 'pages', 'platform-lifecycle.jsx'), 'utf8');

let db;
let server;
let baseUrl;
let tempDir;
const tokens = {};
const stamp = '2026-09-21T08:00:00.000Z';

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const response = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.token;
}

/** 建一个只带指定权限码的主体（独立角色 + 独立用户），避免借用既有角色。 */
function createActor(id, username, roleId, permissions) {
  db.prepare('INSERT OR REPLACE INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
    .run(roleId, `R-${id}`, `角色 ${id}`, 'PL-06 合同测试角色', stamp);
  db.prepare('INSERT OR REPLACE INTO role_permissions(role_id,permission_code) VALUES(?,?)')
    .run(roleId, permissions[0]);
  if (permissions[1]) db.prepare('INSERT OR REPLACE INTO role_permissions(role_id,permission_code) VALUES(?,?)')
    .run(roleId, permissions[1]);
  const password = hashPassword(`${username}-pass`, 'platform-lifecycle-salt');
  db.prepare('INSERT OR REPLACE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
    .run(id, username, `主体 ${id}`, password.hash, password.salt, roleId, stamp);
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-platform-lifecycle-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  createActor('lifecycle-viewer', 'lifecycle-viewer', 'role-lifecycle-viewer', ['LIFECYCLE_VIEW']);
  createActor('lifecycle-manager', 'lifecycle-manager', 'role-lifecycle-manager', ['LIFECYCLE_VIEW', 'LIFECYCLE_MANAGE']);
  createActor('lifecycle-outsider', 'lifecycle-outsider', 'role-lifecycle-outsider', ['DASHBOARD_VIEW']);

  tokens.admin = await login('admin', 'admin123');
  tokens.viewer = await login('lifecycle-viewer', 'lifecycle-viewer-pass');
  tokens.manager = await login('lifecycle-manager', 'lifecycle-manager-pass');
  tokens.outsider = await login('lifecycle-outsider', 'lifecycle-outsider-pass');
  tokens.sales = await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PL-06 权限目录专化', () => {
  test('LIFECYCLE_VIEW / LIFECYCLE_MANAGE 已登记为独立权限码', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('LIFECYCLE_VIEW'), 'LIFECYCLE_VIEW 必须登记');
    assert.ok(codes.includes('LIFECYCLE_MANAGE'), 'LIFECYCLE_MANAGE 必须登记');
  });

  test('生命周期引擎不再把管理员权限当作生命周期能力本身（PL-DEF-04）', () => {
    const engine = readFileSync(join(root, 'server', 'modules', 'lifecycle-engine.js'), 'utf8');
    assert.doesNotMatch(engine, /allow\(actor, 'USERS_MANAGE'\)/, '不得再有裸的 USERS_MANAGE 判定');
    assert.match(engine, /allowAny\(actor, \['LIFECYCLE_VIEW', 'USERS_MANAGE'\]\)/);
    assert.match(engine, /allowAny\(actor, \['LIFECYCLE_MANAGE', 'USERS_MANAGE'\]\)/);
  });
});

describe('PL-06 权限判定 fail closed', () => {
  test('只读主体可读、不可写', async () => {
    const read = await request('/api/lifecycle/records?limit=5', { token: tokens.viewer });
    assert.equal(read.status, 200, JSON.stringify(read.data));
    const write = await request('/api/lifecycle/cleanup', {
      token: tokens.viewer, method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'x', reason: 'x', confirm: true },
    });
    assert.equal(write.status, 403, 'LIFECYCLE_VIEW 不得写');
  });

  test('管理主体可写', async () => {
    const write = await request('/api/lifecycle/cleanup', {
      token: tokens.manager, method: 'POST', body: { entityType: 'SALES_ORDER', entityId: 'x', reason: 'x', confirm: true },
    });
    assert.notEqual(write.status, 403, 'LIFECYCLE_MANAGE 不得被读权限挡住');
  });

  test('既无专用码也无别名的主体一律 403', async () => {
    for (const token of [tokens.outsider, tokens.sales]) {
      assert.equal((await request('/api/lifecycle/records', { token })).status, 403);
      assert.equal((await request('/api/lifecycle/cleanup-events', { token })).status, 403);
    }
  });

  test('USERS_MANAGE 保留为兼容别名：既有管理员仍然可用', async () => {
    const read = await request('/api/lifecycle/records?limit=5', { token: tokens.admin });
    assert.equal(read.status, 200, JSON.stringify(read.data));
  });
});

describe('PL-06 operator 工作面可达', () => {
  test('路由 lifecycle 已启用并绑定专用权限码，旧路由 data-cleanup 已退役', () => {
    assert.match(registrySource, /route\('lifecycle','生命周期与归档'[\s\S]*?any:\['LIFECYCLE_VIEW','LIFECYCLE_MANAGE'\]/);
    assert.match(registrySource, /'lifecycle': defaultScreen\('\.\.\/pages\/platform-lifecycle\.jsx'\)/);
    assert.doesNotMatch(registrySource, /route\('data-cleanup'/);
  });

  test('页面带 canonical 屏根 testid，且读写动作按权限分权', () => {
    assert.match(pageSource, /data-testid="platform-lifecycle-page"/);
    assert.match(pageSource, /LIFECYCLE_VIEW/);
    assert.match(pageSource, /LIFECYCLE_MANAGE/);
    assert.doesNotMatch(pageSource, /isAdmin/);
  });
});
