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
let viewerToken;
let unauthorizedToken;

const EQUITY_SUBJECT_ID = 'subject-4001';

function lastDayOfMonth(period) {
  const [y, m] = period.split('-').map(Number);
  return y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
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

async function getBalanceSheet(period, token = viewerToken) {
  const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=${encodeURIComponent(period)}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return { status: res.status, data: await res.json() };
}

async function setupFixtures() {
  adminToken = await login('admin', 'admin123');

  const creatorRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'BS_CREATOR',
      name: '资产负债表录入员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW'],
    }),
  });
  const creatorRole = await creatorRoleRes.json();
  const creatorPwd = hashPassword('bs-creator-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-bs-creator', 'bs-creator', '资产负债表录入员', creatorPwd.hash, creatorPwd.salt, creatorRole.id, new Date().toISOString());

  const approverRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'BS_APPROVER',
      name: '资产负债表审核员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE', 'REPORT_VIEW'],
    }),
  });
  const approverRole = await approverRoleRes.json();
  const approverPwd = hashPassword('bs-approver-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-bs-approver', 'bs-approver', '资产负债表审核员', approverPwd.hash, approverPwd.salt, approverRole.id, new Date().toISOString());

  const viewerRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'BS_VIEWER',
      name: '资产负债表查看员',
      permissions: ['REPORT_VIEW'],
    }),
  });
  const viewerRole = await viewerRoleRes.json();
  const viewerPwd = hashPassword('bs-viewer-123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-bs-viewer', 'bs-viewer', '资产负债表查看员', viewerPwd.hash, viewerPwd.salt, viewerRole.id, new Date().toISOString());

  database.prepare('INSERT OR IGNORE INTO accounting_subjects(id, code, name, type, direction, active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(EQUITY_SUBJECT_ID, '4001', '实收资本', 'EQUITY', 'CREDIT');

  creatorToken = await login('bs-creator', 'bs-creator-123');
  approverToken = await login('bs-approver', 'bs-approver-123');
  viewerToken = await login('bs-viewer', 'bs-viewer-123');
  unauthorizedToken = await login('warehouse', 'warehouse123');
}

beforeEach(async () => {
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
  if (database) database.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });

  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-bs-test-'));
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

describe('Balance Sheet — Empty / Setup', () => {
  test('empty period returns zero balances and equation valid', async () => {
    const { status, data } = await getBalanceSheet('2099-01');
    assert.equal(status, 200);
    assert.equal(data.period, '2099-01');
    assert.equal(data.asOfDate, lastDayOfMonth('2099-01'));
    assert.equal(data.assets.total, 0);
    assert.equal(data.liabilities.total, 0);
    assert.equal(data.equity.postedEquity, 0);
    assert.equal(data.equity.unclosedProfit, 0);
    assert.equal(data.equity.total, 0);
    assert.equal(data.totalAssets, 0);
    assert.equal(data.totalLiabilitiesAndEquity, 0);
    assert.equal(data.difference, 0);
    assert.equal(data.equationValid, true);
  });
});

describe('Balance Sheet — Direction / Sign', () => {
  test('ASSET debit increases asset balance', async () => {
    const date = '2098-01-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 50000, summary: '库存现金增加' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2098-01');
    const cash = data.assets.subjects.find(s => s.code === '1001');
    assert.ok(cash, 'should have 库存现金 subject');
    assert.equal(cash.amount, 50000);
  });

  test('ASSET credit decreases asset balance', async () => {
    const date = '2098-02-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 30000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 30000, summary: '银行存款减少' },
    ]);
    const { data } = await getBalanceSheet('2098-02');
    const bank = data.assets.subjects.find(s => s.code === '1002');
    assert.equal(bank.amount, 70000);
  });

  test('LIABILITY credit increases liability balance', async () => {
    const date = '2098-03-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-004', direction: 'DEBIT', amountCents: 40000, summary: '库存商品' },
      { subjectId: 'subject-005', direction: 'CREDIT', amountCents: 40000, summary: '应付账款' },
    ]);
    const { data } = await getBalanceSheet('2098-03');
    const ap = data.liabilities.subjects.find(s => s.code === '2202');
    assert.equal(ap.amount, 40000);
  });

  test('LIABILITY debit decreases liability balance', async () => {
    const date = '2098-04-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-004', direction: 'DEBIT', amountCents: 60000, summary: '库存商品' },
      { subjectId: 'subject-005', direction: 'CREDIT', amountCents: 60000, summary: '应付账款' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-005', direction: 'DEBIT', amountCents: 20000, summary: '偿还应付账款' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 20000, summary: '银行存款减少' },
    ]);
    const { data } = await getBalanceSheet('2098-04');
    const ap = data.liabilities.subjects.find(s => s.code === '2202');
    assert.equal(ap.amount, 40000);
  });

  test('EQUITY credit increases posted equity', async () => {
    const date = '2098-05-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 1000000, summary: '银行存款' },
      { subjectId: EQUITY_SUBJECT_ID, direction: 'CREDIT', amountCents: 1000000, summary: '实收资本' },
    ]);
    const { data } = await getBalanceSheet('2098-05');
    const equity = data.equity.subjects.find(s => s.code === '4001');
    assert.equal(equity.amount, 1000000);
    assert.equal(data.equity.postedEquity, 1000000);
  });
});

describe('Balance Sheet — Voucher Status Filtering', () => {
  test('ENTERED voucher is excluded', async () => {
    const date = '2098-06-15';
    const before = await getBalanceSheet('2098-06');
    await createVoucherRaw(creatorToken, date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 12345, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 12345, summary: '主营业务收入' },
    ]);
    const after = await getBalanceSheet('2098-06');
    assert.equal(after.data.totalAssets, before.data.totalAssets);
  });

  test('SUBMITTED voucher is excluded', async () => {
    const date = '2098-07-15';
    const before = await getBalanceSheet('2098-07');
    const created = await createVoucherRaw(creatorToken, date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 22222, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 22222, summary: '主营业务收入' },
    ]);
    await submitVoucher(creatorToken, created.id);
    const after = await getBalanceSheet('2098-07');
    assert.equal(after.data.totalAssets, before.data.totalAssets);
  });

  test('REJECTED voucher is excluded', async () => {
    const date = '2098-08-15';
    const before = await getBalanceSheet('2098-08');
    const created = await createVoucherRaw(creatorToken, date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 33333, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 33333, summary: '主营业务收入' },
    ]);
    await submitVoucher(creatorToken, created.id);
    await rejectVoucher(approverToken, created.id, '驳回测试');
    const after = await getBalanceSheet('2098-08');
    assert.equal(after.data.totalAssets, before.data.totalAssets);
  });

  test('POSTED voucher is included (delta check)', async () => {
    const date = '2098-09-15';
    const before = await getBalanceSheet('2098-09');
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 44444, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 44444, summary: '主营业务收入' },
    ]);
    const after = await getBalanceSheet('2098-09');
    assert.equal(after.data.totalAssets, before.data.totalAssets + 44444);
  });
});

describe('Balance Sheet — Cumulative / Period End', () => {
  test('transactions before selected month remain in period-end balance', async () => {
    const earlyDate = '2098-10-15';
    await createAndPostVoucher(earlyDate, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 80000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 80000, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2098-11');
    const bank = data.assets.subjects.find(s => s.code === '1002');
    assert.equal(bank.amount, 80000);
  });

  test('transactions after selected period end are excluded', async () => {
    const beforeDate = '2097-11-15';
    const afterDate = '2097-12-15';
    await createAndPostVoucher(beforeDate, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 50000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(afterDate, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 99999, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 99999, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2097-11');
    const bank = data.assets.subjects.find(s => s.code === '1002');
    assert.equal(bank.amount, 50000);
  });
});

describe('Balance Sheet — Multiple Subjects', () => {
  test('multiple asset subjects summed correctly', async () => {
    const date = '2097-10-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 10000, summary: '现金' },
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 20000, summary: '银行存款' },
      { subjectId: 'subject-003', direction: 'DEBIT', amountCents: 30000, summary: '应收账款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 60000, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2097-10');
    assert.equal(data.assets.total, 60000);
    assert.equal(data.assets.subjects.length, 3);
  });

  test('multiple liability subjects summed correctly', async () => {
    const date = '2097-09-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-004', direction: 'DEBIT', amountCents: 15000, summary: '库存商品' },
      { subjectId: 'subject-005', direction: 'CREDIT', amountCents: 15000, summary: '应付账款' },
    ]);
    const { data } = await getBalanceSheet('2097-09');
    assert.equal(data.liabilities.total, 15000);
  });
});

describe('Balance Sheet — Unclosed Accumulated Profit', () => {
  test('revenue contributes to unclosed profit', async () => {
    const date = '2097-08-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 70000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 70000, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2097-08');
    assert.equal(data.equity.unclosedProfit, 70000);
  });

  test('expense reduces unclosed profit', async () => {
    const date = '2097-07-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 50000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 20000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 20000, summary: '银行存款' },
    ]);
    const { data } = await getBalanceSheet('2097-07');
    assert.equal(data.equity.unclosedProfit, 30000);
  });

  test('revenue debit reversal reduces unclosed profit', async () => {
    const date = '2097-06-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 90000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 90000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-006', direction: 'DEBIT', amountCents: 10000, summary: '销售退回' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000, summary: '银行存款减少' },
    ]);
    const { data } = await getBalanceSheet('2097-06');
    assert.equal(data.equity.unclosedProfit, 80000);
  });

  test('expense credit reversal increases unclosed profit', async () => {
    const date = '2097-05-15';
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 60000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 60000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 40000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 40000, summary: '银行存款' },
    ]);
    await createAndPostVoucher(date, [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 5000, summary: '银行存款' },
      { subjectId: 'subject-007', direction: 'CREDIT', amountCents: 5000, summary: '成本冲回' },
    ]);
    const { data } = await getBalanceSheet('2097-05');
    assert.equal(data.equity.unclosedProfit, 25000);
  });
});

describe('Balance Sheet — Multi-Month Accumulation (Critical)', () => {
  test('unclosed profit accumulates across months when querying later month', async () => {
    await createAndPostVoucher('2096-01-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher('2096-01-20', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 60000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 60000, summary: '银行存款' },
    ]);
    await createAndPostVoucher('2096-02-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 50000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: '主营业务收入' },
    ]);
    await createAndPostVoucher('2096-02-20', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 20000, summary: '主营业务成本' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 20000, summary: '银行存款' },
    ]);

    const { data } = await getBalanceSheet('2096-02');
    assert.equal(data.equity.unclosedProfit, 70000,
      `unclosed profit must accumulate across months (expected 70000, got ${data.equity.unclosedProfit})`);
  });
});

describe('Balance Sheet — Equation Validation', () => {
  test('valid accounting scenario returns equationValid=true with zero difference', async () => {
    await createAndPostVoucher('2093-03-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '银行存款' },
      { subjectId: EQUITY_SUBJECT_ID, direction: 'CREDIT', amountCents: 100000, summary: '实收资本' },
    ]);
    await createAndPostVoucher('2093-03-20', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 30000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 30000, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2093-03');
    assert.equal(data.totalAssets, 130000);
    assert.equal(data.totalLiabilitiesAndEquity, 130000);
    assert.equal(data.difference, 0);
    assert.equal(data.equationValid, true);
  });

  test('intentionally unbalanced data returns equationValid=false with non-zero difference', async () => {
    await createAndPostVoucher('2093-04-15', [
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 75000, summary: '银行存款' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 75000, summary: '主营业务收入' },
    ]);
    const { data } = await getBalanceSheet('2093-04');
    assert.equal(data.equationValid, true);

    const now = new Date().toISOString();
    database.prepare("INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status) VALUES('orphan-voucher','ORPHAN-001','MANUAL','orphan-voucher','2093-04-25','不平衡测试','user-admin',?,'POSTED')").run(now);
    database.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES('entry-bs-orphan','orphan-voucher','subject-002','DEBIT',25000,'孤立资产分录')").run();

    const { data: data2 } = await getBalanceSheet('2093-04');
    assert.equal(data2.totalAssets, 100000);
    assert.equal(data2.totalLiabilitiesAndEquity, 75000);
    assert.equal(data2.difference, 25000);
    assert.equal(data2.equationValid, false);
  });
});

describe('Balance Sheet — Parameter Validation', () => {
  test('missing period returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('invalid period format returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2026/08`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });

  test('month out of range returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2026-13`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 400);
  });
});

describe('Balance Sheet — Permission', () => {
  test('user without REPORT_VIEW returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2095-01`, {
      headers: { 'Authorization': `Bearer ${unauthorizedToken}` },
    });
    assert.equal(res.status, 403);
  });

  test('user with REPORT_VIEW succeeds', async () => {
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2095-01`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
  });
});

describe('Balance Sheet — Open / Closed Period', () => {
  test('OPEN period can be queried', async () => {
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2094-01`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
  });

  test('CLOSED period can be queried', async () => {
    const closure = await createPeriodClosure(2094, 6);
    await closePeriod(closure.id);
    const res = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2094-06`, {
      headers: { 'Authorization': `Bearer ${viewerToken}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.period, '2094-06');
    assert.equal(data.asOfDate, '2094-06-30');
  });
});