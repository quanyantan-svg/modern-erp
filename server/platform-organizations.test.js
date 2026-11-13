// Platform 组织主数据与作用域登记 —— 合同测试（docs/design/platform.md §32.5）。
//
// 覆盖：组织注册表（法人实体 / 业务单元 + 层级 + 防环 + 启停用）、作用域登记
// （SINGLE / MULTI 绑定）、与既有 accounting_scopes 自由文本标签的隔离、权限 fail closed。
//
// 明确不在本域范围（Requirement §36.5）：向业务表铺开 org_id 的多组织业务数据隔离。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let db;
let httpServer;
let baseUrl;
let tempDir;
const tokens = {};

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  tokens[username] = data.token;
}

async function request(path, username = 'admin', options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokens[username]}`,
      ...options.headers,
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'erp-platform-org-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  httpServer = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  await login('admin', 'admin123');
  await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, fail) => httpServer.close((error) => (error ? fail(error) : done())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PL-ORG 组织注册表', () => {
  test('创建法人实体与业务单元，形成父子层级', async () => {
    const legal = await request('/api/platform/organizations', 'admin', {
      method: 'POST', body: { code: 'ORG-LEGAL-01', name: '本体法人', orgType: 'LEGAL_ENTITY' },
    });
    assert.equal(legal.status, 201, JSON.stringify(legal.data));
    assert.equal(legal.data.organization.status, 'ACTIVE');
    assert.equal(legal.data.organization.parentOrgId, null);

    const unit = await request('/api/platform/organizations', 'admin', {
      method: 'POST', body: { code: 'ORG-UNIT-01', name: '一号业务单元', orgType: 'BUSINESS_UNIT', parentOrgId: legal.data.organization.id },
    });
    assert.equal(unit.status, 201, JSON.stringify(unit.data));
    assert.equal(unit.data.organization.parentOrgId, legal.data.organization.id);

    const detail = await request(`/api/platform/organizations/${legal.data.organization.id}`, 'admin');
    assert.equal(detail.status, 200);
    assert.equal(detail.data.children.length, 1);
    assert.equal(detail.data.children[0].code, 'ORG-UNIT-01');
  });

  test('组织编码唯一', async () => {
    const again = await request('/api/platform/organizations', 'admin', {
      method: 'POST', body: { code: 'ORG-LEGAL-01', name: '重复编码', orgType: 'LEGAL_ENTITY' },
    });
    assert.equal(again.status, 409);
    assert.equal(again.data.code, 'PLATFORM_ORGANIZATION_CODE_CONFLICT');
  });

  test('层级不得成环', async () => {
    const legal = db.prepare("SELECT id FROM organizations WHERE code='ORG-LEGAL-01'").get();
    const unit = db.prepare("SELECT id FROM organizations WHERE code='ORG-UNIT-01'").get();
    const selfParent = await request(`/api/platform/organizations/${unit.id}`, 'admin', {
      method: 'PATCH', body: { parentOrgId: unit.id },
    });
    assert.equal(selfParent.status, 409);
    assert.equal(selfParent.data.code, 'PLATFORM_ORGANIZATION_CYCLE');
    const cycle = await request(`/api/platform/organizations/${legal.id}`, 'admin', {
      method: 'PATCH', body: { parentOrgId: unit.id },
    });
    assert.equal(cycle.status, 409);
    assert.equal(cycle.data.code, 'PLATFORM_ORGANIZATION_CYCLE');
  });

  test('有启用中子组织时不得停用父组织', async () => {
    const legal = db.prepare("SELECT id FROM organizations WHERE code='ORG-LEGAL-01'").get();
    const blocked = await request(`/api/platform/organizations/${legal.id}/status`, 'admin', {
      method: 'POST', body: { status: 'INACTIVE' },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'PLATFORM_ORGANIZATION_HAS_ACTIVE_CHILDREN');
  });

  test('子组织停用后父组织可停用', async () => {
    const unit = db.prepare("SELECT id FROM organizations WHERE code='ORG-UNIT-01'").get();
    const legal = db.prepare("SELECT id FROM organizations WHERE code='ORG-LEGAL-01'").get();
    const off = await request(`/api/platform/organizations/${unit.id}/status`, 'admin', {
      method: 'POST', body: { status: 'INACTIVE' },
    });
    assert.equal(off.status, 200, JSON.stringify(off.data));
    const offParent = await request(`/api/platform/organizations/${legal.id}/status`, 'admin', {
      method: 'POST', body: { status: 'INACTIVE' },
    });
    assert.equal(offParent.status, 200, JSON.stringify(offParent.data));
    // 复位，避免影响后续用例
    db.prepare("UPDATE organizations SET status='ACTIVE'").run();
  });
});

describe('PL-ORG 作用域登记', () => {
  test('单组织作用域只能绑定一个组织，第二个被拒绝', async () => {
    const scope = await request('/api/platform/organization-scopes', 'admin', {
      method: 'POST', body: { scopeCode: 'SCOPE_SINGLE_01', name: '单组织作用域', bindingMode: 'SINGLE' },
    });
    assert.equal(scope.status, 201, JSON.stringify(scope.data));
    const scopeId = scope.data.scope.id;

    const first = await request('/api/platform/organization-scopes', 'admin', {
      method: 'POST', body: { scopeCode: 'SCOPE_SINGLE_02', name: '第二个单组织作用域', bindingMode: 'SINGLE' },
    });
    const orgA = db.prepare("SELECT id FROM organizations WHERE code='ORG-LEGAL-01'").get();
    const orgB = db.prepare("SELECT id FROM organizations WHERE code='ORG-UNIT-01'").get();

    const bindOne = await request(`/api/platform/organization-scopes/${scopeId}/bind`, 'admin', {
      method: 'POST', body: { orgId: orgA.id },
    });
    assert.equal(bindOne.status, 200, JSON.stringify(bindOne.data));
    assert.deepEqual(bindOne.data.scope.organizationIds, [orgA.id]);

    const bindTwo = await request(`/api/platform/organization-scopes/${scopeId}/bind`, 'admin', {
      method: 'POST', body: { orgId: orgB.id },
    });
    assert.equal(bindTwo.status, 409);
    assert.equal(bindTwo.data.code, 'PLATFORM_SCOPE_BINDING_INVALID');

    // 重复绑定同一组织是幂等的。
    const rebind = await request(`/api/platform/organization-scopes/${scopeId}/bind`, 'admin', {
      method: 'POST', body: { orgId: orgA.id },
    });
    assert.equal(rebind.status, 200);
    assert.equal(rebind.data.unchanged, true);
  });

  test('多组织作用域可绑定多个组织，解绑后减少', async () => {
    const scope = await request('/api/platform/organization-scopes', 'admin', {
      method: 'POST', body: { scopeCode: 'SCOPE_MULTI_01', name: '多组织作用域', bindingMode: 'MULTI' },
    });
    assert.equal(scope.status, 201, JSON.stringify(scope.data));
    const scopeId = scope.data.scope.id;
    const orgA = db.prepare("SELECT id FROM organizations WHERE code='ORG-LEGAL-01'").get();
    const orgB = db.prepare("SELECT id FROM organizations WHERE code='ORG-UNIT-01'").get();
    await request(`/api/platform/organization-scopes/${scopeId}/bind`, 'admin', { method: 'POST', body: { orgId: orgA.id } });
    const bindTwo = await request(`/api/platform/organization-scopes/${scopeId}/bind`, 'admin', { method: 'POST', body: { orgId: orgB.id } });
    assert.equal(bindTwo.status, 200, JSON.stringify(bindTwo.data));
    assert.equal(bindTwo.data.scope.organizationIds.length, 2);

    const unbind = await request(`/api/platform/organization-scopes/${scopeId}/unbind`, 'admin', {
      method: 'POST', body: { orgId: orgB.id },
    });
    assert.equal(unbind.status, 200, JSON.stringify(unbind.data));
    assert.equal(unbind.data.scope.organizationIds.length, 1);
  });

  test('单组织作用域没有绑定时解析失败即拒绝', async () => {
    const scope = await request('/api/platform/organization-scopes', 'admin', {
      method: 'POST', body: { scopeCode: 'SCOPE_EMPTY_01', name: '空作用域', bindingMode: 'SINGLE' },
    });
    const listed = await request('/api/platform/organization-scopes', 'admin');
    const found = listed.data.scopes.find((item) => item.scopeCode === 'SCOPE_EMPTY_01');
    assert.ok(found, '作用域必须出现在列表中');
    // 单组织作用域绑定 0 个组织时不得被解析为"通过"。
    const { resolveOrganizationScope } = await import('./modules/platform-organizations.js');
    assert.throws(
      () => resolveOrganizationScope(db, 'SCOPE_EMPTY_01'),
      (error) => error.code === 'PLATFORM_SCOPE_BINDING_INVALID',
      '单组织作用域未绑定时必须失败即拒绝',
    );
    assert.ok(scope.status === 201);
  });
});

describe('PL-ORG 与既有 accounting_scopes 的隔离', () => {
  test('accounting_scopes.org_scope 的自由文本校验语义不变', () => {
    // accounting_scopes.org_scope 是自由文本标签，平台层不得改变它的校验语义。
    const rows = db.prepare('SELECT code, org_scope FROM accounting_scopes LIMIT 5').all();
    for (const row of rows) {
      assert.ok(typeof row.org_scope === 'string', 'org_scope 仍是自由文本');
    }
    // 平台的作用域表是独立的，不与 accounting_scopes 共用一张表。
    const platformScopes = db.prepare('SELECT COUNT(*) n FROM organization_scopes').get().n;
    assert.ok(platformScopes > 0, '平台作用域表必须独立存在');
  });

  test('业务表不被铺开 org_id（多组织业务数据隔离不在本域范围）', () => {
    const columns = db.prepare('PRAGMA table_info(sales_orders)').all().map((column) => column.name);
    assert.ok(!columns.includes('org_id'), '本轮不得向业务表铺开 org_id');
  });
});

describe('PL-ORG 权限 fail closed', () => {
  test('无权限的角色读不到组织注册表', async () => {
    const denied = await request('/api/platform/organizations', 'sales');
    assert.equal(denied.status, 403);
  });

  test('无权限的角色不能维护组织', async () => {
    const denied = await request('/api/platform/organizations', 'sales', {
      method: 'POST', body: { code: 'ORG-NOPE', name: '越权创建', orgType: 'LEGAL_ENTITY' },
    });
    assert.equal(denied.status, 403);
  });
});
