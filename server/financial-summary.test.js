import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let creatorToken;
let approverToken;
let accountingToken;
let unauthorizedToken;

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
  await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}

async function approveVoucher(token, voucherId) {
  await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
}

async function rejectVoucher(token, voucherId, reason) {
  await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/reject`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ rejectionReason: reason }),
  });
}

async function createAndPostVoucher(date, entries) {
  const created = await createVoucherRaw(creatorToken, date, entries);
  await submitVoucher(creatorToken, created.id);
  await approveVoucher(approverToken, created.id);
  return created;
}

async function getFinancialSummary(period, token = adminToken) {
  const url = period ? `${baseUrl}/api/reports/financial-summary?period=${encodeURIComponent(period)}` : `${baseUrl}/api/reports/financial-summary`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  return { status: res.status, data: await res.json() };
}

async function setupFixtures() {
  adminToken = await login('admin', 'admin123');

  const creatorRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'FS_CREATOR',
      name: '经营汇总录入员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW'],
    }),
  });
  const creatorRole = await creatorRoleRes.json();
  const creatorPwd = hashPassword('fs-creator-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-fs-creator', 'fs-creator', '经营汇总录入员', creatorPwd.hash, creatorPwd.salt, creatorRole.id, new Date().toISOString());

  const approverRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'FS_APPROVER',
      name: '经营汇总审核员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE', 'REPORT_VIEW'],
    }),
  });
  const approverRole = await approverRoleRes.json();
  const approverPwd = hashPassword('fs-approver-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-fs-approver', 'fs-approver', '经营汇总审核员', approverPwd.hash, approverPwd.salt, approverRole.id, new Date().toISOString());

  creatorToken = await login('fs-creator', 'fs-creator-123');
  approverToken = await login('fs-approver', 'fs-approver-123');
  accountingToken = await login('accounting', 'accounting123');
  unauthorizedToken = await login('warehouse', 'warehouse123');
}

beforeEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
  if (database) database.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });

  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-fs-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await setupFixtures();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(() => resolve()));
  if (database) database.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('Financial Summary — Empty / Setup', () => {
  test('empty period returns zeros and AR/AP fields preserved', async () => {
    const { status, data } = await getFinancialSummary('2099-01');
    assert.equal(status, 200);
    assert.equal(data.period, '2099-01');
    assert.equal(data.revenue, 0);
    assert.equal(data.expense, 0);
    assert.equal(data.profit, 0);
    assert.equal(typeof data.accounts_receivable, 'number');
    assert.equal(typeof data.accounts_payable, 'number');
  });

  test('missing period defaults to current month', async () => {
    const { status, data } = await getFinancialSummary(null);
    assert.equal(status, 200);
    assert.match(data.period, /^\d{4}-\d{2}$/);
  });
});

describe('Financial Summary — Direction Correctness', () => {
  test('revenue normal credit is counted as positive', async () => {
    await createAndPostVoucher('2098-01-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '主营业务收入' },
    ]);
    const { data } = await getFinancialSummary('2098-01');
    assert.equal(data.revenue, 100000);
  });

  test('revenue debit reversal reduces revenue (does NOT inflate)', async () => {
    await createAndPostVoucher('2098-02-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher('2098-02-20', [
      { subjectId: 'subject-006', direction: 'DEBIT', amountCents: 10000, summary: '销售退回' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000, summary: '银行存款' },
    ]);
    const { data } = await getFinancialSummary('2098-02');
    assert.equal(data.revenue, 90000, `expected 90000, got ${data.revenue} — direction must be respected`);
    assert.equal(data.profit, 90000);
  });

  test('expense normal debit is counted as positive expense', async () => {
    await createAndPostVoucher('2098-03-15', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 50000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 50000, summary: '银行存款' },
    ]);
    const { data } = await getFinancialSummary('2098-03');
    assert.equal(data.expense, 50000);
  });

  test('expense credit reversal reduces expense (does NOT inflate)', async () => {
    await createAndPostVoucher('2098-04-15', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 80000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 80000, summary: '银行存款' },
    ]);
    await createAndPostVoucher('2098-04-20', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 5000, summary: '银行存款' },
      { subjectId: 'subject-007', direction: 'CREDIT', amountCents: 5000, summary: '成本冲回' },
    ]);
    const { data } = await getFinancialSummary('2098-04');
    assert.equal(data.expense, 75000, `expected 75000, got ${data.expense}`);
  });

  test('profit = revenue - expense', async () => {
    await createAndPostVoucher('2098-05-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 200000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 200000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher('2098-05-20', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 60000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 60000, summary: '银行存款' },
    ]);
    const { data } = await getFinancialSummary('2098-05');
    assert.equal(data.profit, 140000);
  });
});

describe('Financial Summary — Status Filtering', () => {
  test('ENTERED voucher excluded', async () => {
    await createVoucherRaw(creatorToken, '2098-06-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 11111, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 11111, summary: '主营业务收入' },
    ]);
    const { data } = await getFinancialSummary('2098-06');
    assert.equal(data.revenue, 0);
  });

  test('SUBMITTED voucher excluded', async () => {
    const v = await createVoucherRaw(creatorToken, '2098-07-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 22222, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 22222, summary: '主营业务收入' },
    ]);
    await submitVoucher(creatorToken, v.id);
    const { data } = await getFinancialSummary('2098-07');
    assert.equal(data.revenue, 0);
  });

  test('REJECTED voucher excluded', async () => {
    const v = await createVoucherRaw(creatorToken, '2098-08-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 33333, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 33333, summary: '主营业务收入' },
    ]);
    await submitVoucher(creatorToken, v.id);
    await rejectVoucher(approverToken, v.id, '驳回测试');
    const { data } = await getFinancialSummary('2098-08');
    assert.equal(data.revenue, 0);
  });

  test('POSTED voucher included', async () => {
    await createAndPostVoucher('2098-09-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 44444, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 44444, summary: '主营业务收入' },
    ]);
    const { data } = await getFinancialSummary('2098-09');
    assert.equal(data.revenue, 44444);
  });
});

describe('Financial Summary — Period Isolation', () => {
  test('different periods isolated', async () => {
    await createAndPostVoucher('2097-01-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 10000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher('2097-02-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 20000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 20000, summary: '主营业务收入' },
    ]);
    const jan = await getFinancialSummary('2097-01');
    const feb = await getFinancialSummary('2097-02');
    assert.equal(jan.data.revenue, 10000);
    assert.equal(feb.data.revenue, 20000);
  });
});

describe('Financial Summary — period=NULL manual voucher counted', () => {
  test('manual voucher with NULL period column is still counted via voucher_date', async () => {
    await createAndPostVoucher('2097-03-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 55555, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 55555, summary: '主营业务收入' },
    ]);
    database.prepare("UPDATE accounting_vouchers SET period=NULL WHERE period='2097-03'").run();
    const { data } = await getFinancialSummary('2097-03');
    assert.equal(data.revenue, 55555, `expected 55555 — manual voucher period=NULL must still be counted via voucher_date`);
  });
});

describe('Financial Summary — Permission', () => {
  test('accounting role can access (has REPORT_VIEW)', async () => {
    const res = await fetch(`${baseUrl}/api/reports/financial-summary?period=2096-01`, {
      headers: { 'Authorization': `Bearer ${accountingToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('warehouse role cannot access (no REPORT_VIEW)', async () => {
    const res = await fetch(`${baseUrl}/api/reports/financial-summary?period=2096-01`, {
      headers: { 'Authorization': `Bearer ${unauthorizedToken}` },
    });
    assert.equal(res.status, 403);
  });
});