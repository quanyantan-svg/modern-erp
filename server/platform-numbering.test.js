// Platform 编号服务 —— 合同测试（docs/design/platform.md §32.8）。
//
// 覆盖：既有 6 种单据的**单号逐字符不变**、编号规则表、幂等重放、事务内分配
// （PL-DEF-11）、原子幂等（PL-DEF-12）、请购单号不再撞号（PL-DEF-13）、
// 以及尚未纳入服务的单据类型清单可见。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase, transaction } from './db.js';
import { allocateDocumentNumber } from './modules/platform-numbering.js';
import { randomUUID } from 'node:crypto';

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
  tempDir = mkdtempSync(join(tmpdir(), 'erp-platform-num-'));
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

describe('NUM 既有单号逐字符不变', () => {
  test('6 种既有单据的单号形态与既有实现一致', () => {
    const cases = [['SI', 'SI-209901-00001'], ['PB', 'PB-209901-00001'], ['SCN', 'SCN-209901-00001'],
      ['PCN', 'PCN-209901-00001'], ['OB', 'OB-209901-00001'], ['PO', 'PO-209901-00001']];
    for (const [documentType, expected] of cases) {
      const { documentNo } = allocateDocumentNumber(db, documentType, '2099-01-15', `${documentType}-test-1`);
      assert.equal(documentNo, expected, `${documentType} 的单号形态不得改变`);
    }
  });

  test('无组织维度时 period_key 仍是 YYYYMM（号段不得断在旧数据上）', () => {
    allocateDocumentNumber(db, 'SI', '2099-02-15', 'SI-test-2');
    const rows = db.prepare("SELECT period_key FROM document_sequences WHERE document_type='SI'").all();
    assert.ok(rows.every((row) => /^\d{6}$/.test(row.period_key)), 'period_key 必须是纯 YYYYMM');
  });

  test('组织维度只体现在 period_key，不编进单号文本', () => {
    const { documentNo } = allocateDocumentNumber(db, 'SI', '2099-03-15', 'SI-test-3', { orgId: 'ORG-9' });
    assert.equal(documentNo, 'SI-209903-00001', '组织维度不得改变单号文本');
    const row = db.prepare("SELECT period_key FROM document_sequences WHERE document_type='SI' AND period_key LIKE 'ORG-9%'").get();
    assert.ok(row, '组织维度必须体现在 period_key');
  });
});

describe('NUM 幂等与原子性', () => {
  test('同一幂等键返回同一单号（PL-DEF-12）', () => {
    const first = allocateDocumentNumber(db, 'SI', '2099-04-15', 'SI-idem-1');
    const second = allocateDocumentNumber(db, 'SI', '2099-04-15', 'SI-idem-1');
    assert.equal(second.replayed, true);
    assert.equal(second.documentNo, first.documentNo, '同一幂等键必须返回同一单号，而不是 409');
    const rows = db.prepare("SELECT COUNT(*) n FROM document_number_allocations WHERE idempotency_key='SI-idem-1'").get().n;
    assert.equal(rows, 1, '幂等键只能留下一条分配记录');
  });

  test('缺少幂等键时失败即拒绝', () => {
    assert.throws(
      () => allocateDocumentNumber(db, 'SI', '2099-04-15', ''),
      (error) => error.status === 400,
    );
  });

  test('分配在调用方事务内时内联执行，不另开事务', () => {
    const before = db.prepare("SELECT COUNT(*) n FROM document_sequences WHERE document_type='PO'").get().n;
    let inner = null;
    transaction(db, () => {
      inner = db.isTransaction;
      allocateDocumentNumber(db, 'PO', '2099-05-15', 'PO-inner-1');
    });
    assert.equal(inner, true, '事务内必须处于事务状态');
    const after = db.prepare("SELECT COUNT(*) n FROM document_sequences WHERE document_type='PO'").get().n;
    assert.equal(after, before + 1, '事务内分配不得产生额外号段');
  });
});

describe('NUM 规则表', () => {
  test('种子规则覆盖 7 种单据', async () => {
    const listed = await request('/api/platform/number-series', 'admin');
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const types = listed.data.series.map((row) => row.documentType).sort();
    assert.deepEqual(types, ['OB', 'PB', 'PCN', 'PO', 'PRQ', 'SCN', 'SI']);
  });

  test('尚未纳入服务的单据类型清单可见', async () => {
    const listed = await request('/api/platform/number-series', 'admin');
    const pending = listed.data.pendingDocumentTypes.map((row) => row.documentType);
    assert.ok(pending.includes('SALES_ORDER'), '待迁移清单必须可见');
    assert.ok(pending.includes('PRODUCTION_ORDER'));
  });

  test('可以新增规则并生效', async () => {
    const created = await request('/api/platform/number-series', 'admin', {
      method: 'POST',
      body: { documentType: 'CUSTOM', orgId: '', prefix: 'CUS', suffix: '-X', periodMode: 'YEAR', padLength: 4 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const { documentNo } = allocateDocumentNumber(db, 'CUSTOM', '2099-06-15', 'CUSTOM-test-1');
    assert.equal(documentNo, 'CUS-2099-0001-X');
  });

  test('同一单据类型与组织不得有两条规则', async () => {
    const again = await request('/api/platform/number-series', 'admin', {
      method: 'POST',
      body: { documentType: 'CUSTOM', orgId: '', prefix: 'CUS2', periodMode: 'MONTH', padLength: 5 },
    });
    assert.equal(again.status, 409);
    assert.equal(again.data.code, 'PLATFORM_NUMBER_RULE_CONFLICT');
  });

  test('无维护权限的角色被拒绝', async () => {
    const denied = await request('/api/platform/number-series', 'sales', {
      method: 'POST',
      body: { documentType: 'X', prefix: 'X', periodMode: 'MONTH', padLength: 5 },
    });
    assert.equal(denied.status, 403);
  });
});

describe('NUM 请购单号不再撞号（PL-DEF-13）', () => {
  test('请购单号由服务发放，删除后不撞号', async () => {
    const first = allocateDocumentNumber(db, 'PRQ', '2099-07-15', `PRQ-${randomUUID()}`);
    const second = allocateDocumentNumber(db, 'PRQ', '2099-07-15', `PRQ-${randomUUID()}`);
    assert.notEqual(first.documentNo, second.documentNo, '同一期间的两个请购单号必须不同');
    assert.match(first.documentNo, /^PRQ-209907-\d{5}$/);
  });
});
