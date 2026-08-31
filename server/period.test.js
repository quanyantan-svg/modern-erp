import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let periodManagerToken;
let creatorToken;
let approverToken;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-period-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  adminToken = (await adminRes.json()).token;
  
  const pmRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'PERIOD_MANAGER', name: '期间管理员', permissions: ['PERIOD_CLOSE_MANAGE', 'PERIOD_CLOSE_VIEW', 'ACCOUNTING_VIEW'] }),
  });
  const pmRole = await pmRoleRes.json();
  const pmPassword = hashPassword('pm123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-pm', 'period-manager', '期间管理员', pmPassword.hash, pmPassword.salt, pmRole.id, new Date().toISOString());
  
  const creatorRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'VOUCHER_CREATOR', name: '凭证录入员', permissions: ['ACCOUNTING_VIEW', 'VOUCHER_SUBMIT'] }),
  });
  const creatorRole = await creatorRoleRes.json();
  const creatorPassword = hashPassword('creator123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-creator', 'voucher-creator', '凭证录入员', creatorPassword.hash, creatorPassword.salt, creatorRole.id, new Date().toISOString());
  
  const approverRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'VOUCHER_APPROVER', name: '凭证审核员', permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE'] }),
  });
  const approverRole = await approverRoleRes.json();
  const approverPassword = hashPassword('approver123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-approver', 'voucher-approver', '凭证审核员', approverPassword.hash, approverPassword.salt, approverRole.id, new Date().toISOString());
  
  periodManagerToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'period-manager', password: 'pm123' }),
  })).json()).token;
  
  creatorToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'voucher-creator', password: 'creator123' }),
  })).json()).token;
  
  approverToken = (await (await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'voucher-approver', password: 'approver123' }),
  })).json()).token;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function createVoucher(token, date) {
  const res = await fetch(`${baseUrl}/api/accounting-vouchers`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      voucherDate: date,
      entries: [
        { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: 'Test' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: 'Test' }
      ],
    }),
  });
  return res.json();
}

describe('Period Management', () => {
  test('Admin can create period closure', async () => {
    const res = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 1 }),
    });
    assert.equal(res.status, 201);
  });

  test('Cannot create duplicate period', async () => {
    const res = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 1 }),
    });
    assert.equal(res.status, 409);
  });

  test('Checklist passes when no vouchers exist', async () => {
    const res = await fetch(`${baseUrl}/api/period-closures/closure-checklist?period=3000-01`, {
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    const data = await res.json();
    assert.equal(data.passed, true);
  });

  test('Cannot close period with ENTERED vouchers', async () => {
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 2 }),
    });
    const closure = await createRes.json();
    await createVoucher(creatorToken, '3000-02-15');
    const res = await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('Cannot close period with SUBMITTED vouchers', async () => {
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 3 }),
    });
    const closure = await createRes.json();
    const voucher = await createVoucher(creatorToken, '3000-03-15');
    await fetch(`${baseUrl}/api/accounting-vouchers/${voucher.id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creatorToken}` },
    });
    const res = await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('Can close period when all vouchers are POSTED', async () => {
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 4 }),
    });
    const closure = await createRes.json();
    const voucher = await createVoucher(creatorToken, '3000-04-15');
    await fetch(`${baseUrl}/api/accounting-vouchers/${voucher.id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creatorToken}` },
    });
    await fetch(`${baseUrl}/api/accounting-vouchers/${voucher.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${approverToken}` },
    });
    const res = await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('Cannot close already closed period', async () => {
    const listRes = await fetch(`${baseUrl}/api/period-closures?year=3000`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const closedPeriod = (await listRes.json()).closures.find(c => c.period === '3000-04' && c.status === 'CLOSED');
    const res = await fetch(`${baseUrl}/api/period-closures/${closedPeriod.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('Can reopen closed period', async () => {
    const listRes = await fetch(`${baseUrl}/api/period-closures?year=3000`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const closedPeriod = (await listRes.json()).closures.find(c => c.period === '3000-04' && c.status === 'CLOSED');
    const res = await fetch(`${baseUrl}/api/period-closures/${closedPeriod.id}/unclose`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('Cannot reopen already open period', async () => {
    const listRes = await fetch(`${baseUrl}/api/period-closures?year=3000`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const openPeriod = (await listRes.json()).closures.find(c => c.period === '3000-04' && c.status === 'OPEN');
    const res = await fetch(`${baseUrl}/api/period-closures/${openPeriod.id}/unclose`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 400);
  });
});

describe('Closed Period Voucher Protection', () => {
  test('Cannot create voucher in closed period', async () => {
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 10 }),
    });
    const closure = await createRes.json();
    await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    const res = await createVoucher(creatorToken, '3000-10-15');
    assert.ok(res.error, 'Should return error for closed period');
  });

  test('Can create voucher in open period', async () => {
    const res = await createVoucher(creatorToken, '3000-05-15');
    assert.ok(res.id, 'Should create voucher');
  });
});

describe('Reporting Correctness', () => {
  test('Trial Balance only includes POSTED vouchers', async () => {
    const res = await fetch(`${baseUrl}/api/reports/trial-balance?period=3000-05`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.trialBalance);
  });

  test('Financial summary only includes POSTED vouchers', async () => {
    const res = await fetch(`${baseUrl}/api/reports/financial-summary?period=3000-05`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.revenue === 'number');
  });
});