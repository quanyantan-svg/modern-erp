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
let creatorToken;
let approverToken;
let viewerToken;
let unauthorizedToken;

const REVENUE_EXTRA_ID = 'subject-6002';
const EXPENSE_EXTRA_ID = 'subject-6601';

function lastDayOfMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

async function login(username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  return data.token;
}

async function createVoucherRaw(token, date, entries) {
  const res = await fetch(`${baseUrl}/api/accounting-vouchers`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ voucherDate: date, entries }),
  });
  return res.json();
}

async function submitVoucher(token, voucherId) {
  const res = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

async function approveVoucher(token, voucherId) {
  const res = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res.json();
}

async function rejectVoucher(token, voucherId, reason) {
  const res = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/reject`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rejectionReason: reason }),
  });
  return res.json();
}

async function createAndPostVoucher(date, entries) {
  const created = await createVoucherRaw(creatorToken, date, entries);
  await submitVoucher(creatorToken, created.id);
  await approveVoucher(approverToken, created.id);
  return created;
}

async function createPeriodClosure(year, month) {
  const res = await fetch(`${baseUrl}/api/period-closures`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ year, month }),
  });
  return res.json();
}

async function closePeriod(closureId) {
  const res = await fetch(`${baseUrl}/api/period-closures/${closureId}/close`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` },
  });
  return res.json();
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-income-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  adminToken = await login('admin', 'admin123');

  // Create creator role (VOUCHER_SUBMIT only)
  const creatorRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'IS_CREATOR',
      name: '利润表录入员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW'],
    }),
  });
  const creatorRole = await creatorRoleRes.json();
  const creatorPwd = hashPassword('is-creator-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-is-creator', 'is-creator', '利润表录入员', creatorPwd.hash, creatorPwd.salt, creatorRole.id, new Date().toISOString());

  // Create approver role (VOUCHER_APPROVE only)
  const approverRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'IS_APPROVER',
      name: '利润表审核员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE', 'REPORT_VIEW'],
    }),
  });
  const approverRole = await approverRoleRes.json();
  const approverPwd = hashPassword('is-approver-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-is-approver', 'is-approver', '利润表审核员', approverPwd.hash, approverPwd.salt, approverRole.id, new Date().toISOString());

  // Create viewer role (REPORT_VIEW only, no VOUCHER_*)
  const viewerRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'IS_VIEWER',
      name: '利润表查看员',
      permissions: ['REPORT_VIEW'],
    }),
  });
  const viewerRole = await viewerRoleRes.json();
  const viewerPwd = hashPassword('is-viewer-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-is-viewer', 'is-viewer', '利润表查看员', viewerPwd.hash, viewerPwd.salt, viewerRole.id, new Date().toISOString());

  // Add additional REVENUE / EXPENSE subjects via direct DB (test fixture only)
  database.prepare('INSERT OR IGNORE INTO accounting_subjects(id, code, name, type, direction, active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(REVENUE_EXTRA_ID, '6002', '其他业务收入', 'REVENUE', 'CREDIT');
  database.prepare('INSERT OR IGNORE INTO accounting_subjects(id, code, name, type, direction, active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(EXPENSE_EXTRA_ID, '6601', '销售费用', 'EXPENSE', 'DEBIT');

  creatorToken = await login('is-creator', 'is-creator-123');
  approverToken = await login('is-approver', 'is-approver-123');
  viewerToken = await login('is-viewer', 'is-viewer-123');
  unauthorizedToken = await login('warehouse', 'warehouse123');
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Income Statement — Empty / Single Type', () => {
  test('empty period returns zero revenue/expense/profit', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-01`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.period, '2099-01');
    assert.equal(data.revenue, 0);
    assert.equal(data.expense, 0);
    assert.equal(data.profit, 0);
    assert.equal(data.sections.length, 2);
    assert.equal(data.sections[0].type, 'REVENUE');
    assert.equal(data.sections[0].subtotal, 0);
    assert.equal(data.sections[1].type, 'EXPENSE');
    assert.equal(data.sections[1].subtotal, 0);
  });

  test('revenue-only period aggregates correctly', async () => {
    const date = '2099-02-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '主营业务收入' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-02`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.revenue, 100000);
    assert.equal(data.expense, 0);
    assert.equal(data.profit, 100000);
    const revenueSection = data.sections.find(s => s.type === 'REVENUE');
    assert.equal(revenueSection.subtotal, 100000);
    assert.equal(revenueSection.subjects.length, 1);
    assert.equal(revenueSection.subjects[0].code, '6001');
    assert.equal(revenueSection.subjects[0].amount, 100000);
  });

  test('expense-only period aggregates correctly', async () => {
    const date = '2099-03-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 50000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 50000, summary: '银行存款' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-03`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.revenue, 0);
    assert.equal(data.expense, 50000);
    assert.equal(data.profit, -50000);
    const expenseSection = data.sections.find(s => s.type === 'EXPENSE');
    assert.equal(expenseSection.subtotal, 50000);
    assert.equal(expenseSection.subjects.length, 1);
    assert.equal(expenseSection.subjects[0].code, '6401');
    assert.equal(expenseSection.subjects[0].amount, 50000);
  });
});

describe('Income Statement — Mixed / Multiple Subjects', () => {
  test('mixed revenue and expense aggregates correctly', async () => {
    const date = '2099-04-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 200000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 200000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 80000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 80000, summary: '银行存款' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-04`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.revenue, 200000);
    assert.equal(data.expense, 80000);
    assert.equal(data.profit, 120000);
  });

  test('multiple revenue subjects summed in section', async () => {
    const date = '2099-05-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 300000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 150000, summary: '主营业务收入' },
      { subjectId: REVENUE_EXTRA_ID, direction: 'CREDIT', amountCents: 150000, summary: '其他业务收入' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-05`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.revenue, 300000);
    const revenueSection = data.sections.find(s => s.type === 'REVENUE');
    assert.equal(revenueSection.subjects.length, 2);
    const total = revenueSection.subjects.reduce((s, x) => s + x.amount, 0);
    assert.equal(total, 300000);
  });

  test('multiple expense subjects summed in section', async () => {
    const date = '2099-06-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 60000, summary: '主营业务成本' },
      { subjectId: EXPENSE_EXTRA_ID, direction: 'DEBIT', amountCents: 40000, summary: '销售费用' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 100000, summary: '银行存款' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-06`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.expense, 100000);
    const expenseSection = data.sections.find(s => s.type === 'EXPENSE');
    assert.equal(expenseSection.subjects.length, 2);
  });
});

describe('Income Statement — Status Filtering', () => {
  test('ENTERED voucher is excluded', async () => {
    const date = '2099-07-15';
    const created = await createVoucherRaw(creatorToken, date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 99999, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 99999, summary: '主营业务收入' },
    ]);
    // intentionally NOT submitted - remains ENTERED
    assert.ok(created.id);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-07`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.revenue, 0);
  });

  test('SUBMITTED voucher is excluded', async () => {
    const date = '2099-08-15';
    const created = await createVoucherRaw(creatorToken, date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 88888, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 88888, summary: '主营业务收入' },
    ]);
    await submitVoucher(creatorToken, created.id);
    // not approved - remains SUBMITTED

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-08`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.revenue, 0);
  });

  test('REJECTED voucher is excluded', async () => {
    const date = '2099-09-15';
    const created = await createVoucherRaw(creatorToken, date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 77777, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 77777, summary: '主营业务收入' },
    ]);
    await submitVoucher(creatorToken, created.id);
    await rejectVoucher(approverToken, created.id, '测试驳回');
    // REJECTED status - not POSTED

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-09`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.revenue, 0);
  });

  test('POSTED voucher is included', async () => {
    const date = '2099-10-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 66666, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 66666, summary: '主营业务收入' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-10`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.revenue, 66666);
  });
});

describe('Income Statement — Direction / Reversal', () => {
  test('REVENUE debit reversal reduces revenue (not adds)', async () => {
    const date = '2099-11-15';
    // First POSTED credit
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '主营业务收入' },
    ]);
    // Second POSTED debit (sales return) - reverses part of revenue
    await createAndPostVoucher(date, [
      { subjectId: 'subject-006', direction: 'DEBIT', amountCents: 10000, summary: '销售退回' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000, summary: '银行存款' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-11`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    // Expected: 100000 - 10000 = 90000, NOT 110000
    assert.equal(data.revenue, 90000);
    assert.equal(data.profit, 90000);
  });

  test('EXPENSE credit reversal reduces expense (not adds)', async () => {
    const date = '2099-12-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 80000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 80000, summary: '银行存款' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 5000, summary: '银行存款' },
      { subjectId: 'subject-007', direction: 'CREDIT', amountCents: 5000, summary: '成本冲回' },
    ]);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2099-12`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    assert.equal(data.expense, 75000);
  });
});

describe('Income Statement — Period Isolation', () => {
  test('different periods isolated', async () => {
    const date1 = '2098-01-15';
    const date2 = '2098-02-15';
    await createAndPostVoucher(date1, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 11111, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 11111, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(date2, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 22222, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 22222, summary: '主营业务收入' },
    ]);

    const janRes = await fetch(`${baseUrl}/api/reports/income-statement?period=2098-01`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const jan = await janRes.json();
    assert.equal(jan.revenue, 11111);

    const febRes = await fetch(`${baseUrl}/api/reports/income-statement?period=2098-02`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    const feb = await febRes.json();
    assert.equal(feb.revenue, 22222);
  });
});

describe('Income Statement — Parameter Validation', () => {
  test('missing period returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('invalid period format returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2026/08`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('non-numeric month returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2026-AB`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('month out of range returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2026-13`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });
});

describe('Income Statement — Permission', () => {
  test('user without REPORT_VIEW returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2097-01`, {
      headers: { 'Authorization': `Bearer ${unauthorizedToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('user with REPORT_VIEW succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2097-01`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
  });
});

describe('Income Statement — Open / Closed Period', () => {
  test('OPEN period can be queried', async () => {
    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2096-01`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('CLOSED period can be queried', async () => {
    const closure = await createPeriodClosure(2095, 6);
    await closePeriod(closure.id);

    const res = await fetch(`${baseUrl}/api/reports/income-statement?period=2095-06`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.period, '2095-06');
  });
});