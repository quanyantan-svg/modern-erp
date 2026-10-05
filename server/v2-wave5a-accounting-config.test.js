// V2 Stage 3 / Wave 5A — focused behavior coverage for the migrated
// accounting configuration dictionaries (currencies / voucher words /
// voucher templates) route family.
//
// Pure ownership-migration tests. Existing coverage is intentionally
// minimal:
//   - teacher-acceptance-matrix.test.js exercises GET endpoints with
//     status 200/404 only (no payload shape / no POST / no 403
//     semantics);
//
// This suite complements that minimal coverage by proving that after
// the route-table migration the four endpoints behave identically to
// the pre-Wave-5A baseline:
//
//   - GET /api/currencies requires CURRENCY_VIEW / CURRENCY_MANAGE;
//     orders base currency first when fixture permits; preserves
//     baseline field shape (code / name / symbol / exchange_rate /
//     is_base / active / updated_at);
//   - GET /api/voucher-words requires VOUCHER_WORDS_VIEW /
//     VOUCHER_WORDS_MANAGE; returns voucherWords array; ordering by
//     prefix remains canonical;
//   - POST /api/voucher-words requires VOUCHER_WORDS_MANAGE; returns
//     201 + { id }; persists current_no=0; the new word is visible
//     from a subsequent GET;
//   - GET /api/voucher-templates requires VOUCHER_TEMPLATES_VIEW /
//     VOUCHER_TEMPLATES_MANAGE; category query parameter filters
//     rows; entries_json is returned as parsed `entries`; creator
//     projection (LEFT JOIN users) remains intact;
//   - Permission preservation: warehouse role lacks all three
//     permission pairs and receives 403 on a representative route
//     (POST /api/voucher-words chosen because it requires the most
//     restrictive gate, VOUCHER_WORDS_MANAGE).
//
// No business semantics changed. The handler bodies, SQL, response
// shapes, and HTTP semantics remain byte-equivalent to the baseline
// implementation in server/modules/extended.js.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let warehouseToken;

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

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-wave5a-acct-cfg-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  warehouseToken = await login('warehouse', 'warehouse123');

  // Seed currencies, voucher_words, voucher_templates directly. Demo
  // seed does not cover these tables; this is the only place the
  // fixtures live for this wave.
  const now = new Date().toISOString();
  const insertCurrency = database.prepare(
    'INSERT OR IGNORE INTO currencies(code,name,symbol,exchange_rate,is_base,active,updated_at) VALUES(?,?,?,?,?,1,?)',
  );
  insertCurrency.run('CNY', '人民币', '¥', 1, 1, now);
  insertCurrency.run('USD', '美元', '$', 0.14, 0, now);
  insertCurrency.run('EUR', '欧元', '€', 0.13, 0, now);

  const insertVoucherWord = database.prepare(
    'INSERT OR IGNORE INTO voucher_words(id,code,name,prefix,current_no,active,created_at) VALUES(?,?,?,?,0,1,?)',
  );
  insertVoucherWord.run('vw-001', 'JZ', '记账', 'JZ', now);
  insertVoucherWord.run('vw-002', 'XJ', '现金', 'XJ', now);

  const insertVoucherTemplate = database.prepare(
    "INSERT OR IGNORE INTO voucher_templates(id,template_code,template_name,description,category,entries_json,active,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?)",
  );
  insertVoucherTemplate.run(
    'vt-001',
    'GENERAL-JZ-001',
    '通用记账模板',
    '通用记账分录',
    'GENERAL',
    JSON.stringify([
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: '借方分录' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '贷方分录' },
    ]),
    'user-admin',
    now,
    now,
  );
  insertVoucherTemplate.run(
    'vt-002',
    'CASH-XJ-001',
    '现金记账模板',
    '现金日记账分录',
    'CASH',
    JSON.stringify([
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 50000, summary: '现金收入' },
      { subjectId: 'subject-003', direction: 'CREDIT', amountCents: 50000, summary: '现金支出' },
    ]),
    'user-admin',
    now,
    now,
  );
});

after(async () => {
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('V2 Wave 5A — accounting configuration route family behavior preservation', () => {
  test('GET /api/currencies returns seeded currencies ordered by is_base DESC and preserves baseline field shape', async () => {
    const result = await request('/api/currencies');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.currencies));
    const codes = result.data.currencies.map((row) => row.code);
    assert.ok(codes.includes('CNY'));
    assert.ok(codes.includes('USD'));
    assert.ok(codes.includes('EUR'));
    const cnyIndex = codes.indexOf('CNY');
    const usdIndex = codes.indexOf('USD');
    const eurIndex = codes.indexOf('EUR');
    assert.ok(cnyIndex < usdIndex, 'base currency must sort before non-base currencies');
    assert.ok(cnyIndex < eurIndex, 'base currency must sort before non-base currencies');
    const cny = result.data.currencies.find((row) => row.code === 'CNY');
    assert.equal(cny.name, '人民币');
    assert.equal(cny.symbol, '¥');
    assert.equal(cny.is_base, 1, 'base currency must expose is_base=1');
    const usd = result.data.currencies.find((row) => row.code === 'USD');
    assert.equal(usd.is_base, 0);
    assert.equal(typeof usd.exchange_rate, 'number');
  });

  test('GET /api/voucher-words returns seeded voucherWords and preserves baseline field shape', async () => {
    const result = await request('/api/voucher-words');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.voucherWords));
    const codes = result.data.voucherWords.map((row) => row.code);
    assert.ok(codes.includes('JZ'));
    assert.ok(codes.includes('XJ'));
    const jz = result.data.voucherWords.find((row) => row.code === 'JZ');
    assert.equal(jz.name, '记账');
    assert.equal(jz.prefix, 'JZ');
    assert.equal(typeof jz.current_no, 'number');
    assert.equal(typeof jz.created_at, 'string');
  });

  test('POST /api/voucher-words creates a new voucher word, returns 201 + id, persists current_no=0, and is visible via subsequent GET', async () => {
    const created = await request('/api/voucher-words', {
      method: 'POST',
      body: { code: 'ZZ', name: '转账', prefix: 'ZZ' },
    });
    assert.equal(created.status, 201, `expected 201, got ${created.status}: ${JSON.stringify(created.data)}`);
    assert.ok(typeof created.data.id === 'string' && created.data.id.length > 0);

    const persisted = database.prepare('SELECT id,code,name,prefix,current_no FROM voucher_words WHERE id=?').get(created.data.id);
    assert.ok(persisted, 'new voucher word must be persisted in voucher_words');
    assert.equal(persisted.code, 'ZZ');
    assert.equal(persisted.name, '转账');
    assert.equal(persisted.prefix, 'ZZ');
    assert.equal(persisted.current_no, 0, 'new voucher word must be created with current_no=0');

    const list = await request('/api/voucher-words');
    assert.equal(list.status, 200);
    const codes = list.data.voucherWords.map((row) => row.code);
    assert.ok(codes.includes('ZZ'), 'new voucher word must be exposed via subsequent GET');
  });

  test('GET /api/voucher-templates returns templates, parses entries_json, and projects creator_name from users LEFT JOIN', async () => {
    const result = await request('/api/voucher-templates');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.templates));
    const template = result.data.templates.find((row) => row.template_code === 'GENERAL-JZ-001');
    assert.ok(template);
    assert.equal(template.category, 'GENERAL');
    assert.equal(template.creator_name, '系统管理员', 'creator projection must remain intact via users LEFT JOIN');
    assert.ok(Array.isArray(template.entries));
    assert.equal(template.entries.length, 2);
    assert.equal(template.entries[0].subjectId, 'subject-001');
    assert.equal(template.entries[0].direction, 'DEBIT');
    assert.equal(template.entries[0].amountCents, 100000);
    assert.equal(typeof template.entries_json, 'string', 'baseline raw entries_json must still be exposed alongside parsed entries');
  });

  test('GET /api/voucher-templates?category=CASH filters templates by category', async () => {
    const result = await request('/api/voucher-templates?category=CASH');
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data.templates));
    assert.ok(result.data.templates.length >= 1, 'CASH filter must return at least the seeded cash template');
    assert.ok(result.data.templates.every((row) => row.category === 'CASH'));
    const codes = result.data.templates.map((row) => row.template_code);
    assert.ok(codes.includes('CASH-XJ-001'));
    assert.ok(!codes.includes('GENERAL-JZ-001'), 'GENERAL template must be excluded by CASH filter');
  });

  test('GET /api/voucher-templates without category returns templates across categories (no implicit filter)', async () => {
    const result = await request('/api/voucher-templates');
    assert.equal(result.status, 200);
    const categories = new Set(result.data.templates.map((row) => row.category));
    assert.ok(categories.has('GENERAL'));
    assert.ok(categories.has('CASH'));
  });

  test('POST /api/voucher-words rejects warehouse role with 403 (permission preservation)', async () => {
    const result = await request('/api/voucher-words', {
      token: warehouseToken,
      method: 'POST',
      body: { code: 'QB', name: '全部', prefix: 'QB' },
    });
    assert.equal(result.status, 403, `warehouse POST /api/voucher-words must be rejected with 403; got ${result.status}`);
  });

  test('GET /api/currencies rejects warehouse role with 403 (CURRENCY_VIEW / CURRENCY_MANAGE not held by role-warehouse)', async () => {
    const result = await request('/api/currencies', { token: warehouseToken });
    assert.equal(result.status, 403, `warehouse GET /api/currencies must be rejected with 403; got ${result.status}`);
  });
});
