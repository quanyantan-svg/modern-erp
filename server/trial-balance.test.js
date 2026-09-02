// Regression coverage for Phase E — Trial Balance filter fix.
//
// Original defect (production browser verification of Phase E acceptance):
//   Two manual vouchers (SMOKE-E01 REVENUE / SMOKE-E02 EXPENSE) were
//   successfully created, submitted, approved and POSTED in 2026-09.
//   Income Statement and Balance Sheet returned correct data for
//   period=2026-09, but Trial Balance for 2026-09 was completely empty.
//
// Root causes (this commit fixes both):
//   1. Subject filter excluded every seeded subject.
//      getTrialBalance selected `WHERE active = 1 AND parent_id IS NOT NULL`.
//      The seed (`server/db.js:1139-1148`) inserts all 7 subjects (1001/1002/
//      1122/1405/2202/6001/6401) without setting parent_id, so all subjects
//      have parent_id = NULL → entire subject list filtered out → trial
//      balance had 0 rows. Income Statement / Balance Sheet never filter
//      by parent_id, so they correctly included all subjects.
//   2. endDate was off by one day in non-UTC timezones.
//      The original `new Date(y, m, 0).toISOString().slice(0, 10)` produced
//      local-midnight-on-last-day then serialized to UTC. In UTC+8 (Tencent
//      Cloud production) `2026-09-30 00:00 +08:00` → `2026-09-29T16:00Z`
//      → `.slice(0,10) = '2026-09-29'`. Vouchers dated on the last day of
//      any month were silently excluded.
//
// Fix:
//   - New exported helper `resolvePeriodRange(period)` in
//     `server/modules/extended.js`. Pure date arithmetic using local-time
//     `new Date(year, month, 0).getDate()` to compute lastDay, then
//     `resolved + "-" + String(lastDay).padStart(2, "0")` for endDate —
//     no `.toISOString()` involved. Single canonical period parser reused
//     by `calculateIncomeForPeriod`, `getTrialBalance`, and future
//     reports.
//   - `getTrialBalance` moved from `server/app.js` to
//     `server/modules/extended.js`. Drops the `parent_id IS NOT NULL`
//     filter so it matches Income Statement / Balance Sheet's subject
//     inclusion criterion (just `active = 1`). Keeps `voucher_date`
//     ranges (no `period` filter — period = NULL on manual vouchers is
//     fine), keeps `status = 'POSTED'` filter, keeps existing shape
//     (openingBalance / periodDebit / periodCredit / closingBalance),
//     keeps REPORT_VIEW gate.
//   - `createAccountingVoucher` / `updateAccountingVoucher` in
//     `server/app.js` now populate `accounting_vouchers.period` from
//     `voucherDate.slice(0, 7)`. This is forward-consistency only — the
//     trial balance remains correct for historical vouchers whose `period`
//     is NULL because it filters on `voucher_date`, not on `period`.
//   - Schema: no changes (period column already existed in
//     accounting_vouchers from migration `db.js:140`).
//
// Scope:
//   - All assertions run end-to-end against a fresh SQLite + local HTTP
//     server, mirroring the Phase D / phase-e-accounting.test.js harness.
//   - Existing voucher.test.js / period.test.js / income-statement.test.js
//     / balance-sheet.test.js / financial-summary.test.js /
//     phase-e-accounting.test.js suites remain authoritative for their
//     respective behaviour and are not modified.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const serverSrc = resolve(repoRoot, 'server');

function readServerSrc(rel) { return readFileSync(join(serverSrc, rel), 'utf8'); }

// ============================================================
// Source-level: canonical helper + new wiring + period write
// ============================================================

describe('Phase E — Trial Balance canonical period helper', () => {
  test('extended.js exports a resolvePeriodRange helper', () => {
    const src = readServerSrc('modules/extended.js');
    assert.ok(/export\s+function\s+resolvePeriodRange\s*\(/.test(src),
      'resolvePeriodRange must be exported');
    assert.ok(/new\s+Date\(year,\s*month,\s*0\)\.getDate\(\)/.test(src),
      'endDate must be derived via local-time new Date(year, month, 0).getDate() (no .toISOString() to avoid UTC+8 off-by-one)');
    assert.ok(/String\(lastDay\)\.padStart\(2,\s*"0"\)/.test(src),
      'endDate must be resolved + "-" + lastDay padded to 2 digits');
  });

  test('calculateIncomeForPeriod is refactored to call resolvePeriodRange (no behavior change)', () => {
    const src = readServerSrc('modules/extended.js');
    const calc = src.match(/export\s+function\s+calculateIncomeForPeriod[\s\S]*?^}/m);
    assert.ok(calc, 'calculateIncomeForPeriod must be present');
    assert.ok(/resolvePeriodRange\(/.test(calc[0]),
      'calculateIncomeForPeriod must call resolvePeriodRange');
    // Defense-in-depth: the function must not re-derive period arithmetic locally.
    assert.equal(/resolved\s*=\s*period\s*\|\|\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*7\)/.test(calc[0]), false,
      'calculateIncomeForPeriod must not duplicate period-resolution logic');
  });

  test('getTrialBalance is exported from extended.js (and removed from app.js)', () => {
    const ext = readServerSrc('modules/extended.js');
    assert.ok(/export\s+function\s+getTrialBalance\s*\(/.test(ext),
      'getTrialBalance must be exported from modules/extended.js');
    const app = readServerSrc('app.js');
    assert.equal(/function\s+getTrialBalance\s*\(/.test(app), false,
      'local getTrialBalance must be removed from app.js');
    // app.js imports it from extended.js
    assert.ok(/getTrialBalance/.test(app) && /from\s+['"]\.\/modules\/extended\.js['"]/.test(app),
      'app.js must import getTrialBalance from ./modules/extended.js');
  });

  test('getTrialBalance does NOT filter by parent_id (must match Income Statement / Balance Sheet)', () => {
    const ext = readServerSrc('modules/extended.js');
    const fn = ext.match(/export\s+function\s+getTrialBalance[\s\S]*?^}/m);
    assert.ok(fn, 'getTrialBalance must be present');
    assert.equal(/parent_id\s+IS\s+NOT\s+NULL/.test(fn[0]), false,
      'getTrialBalance must not require parent_id — seed subjects have parent_id NULL');
    assert.ok(/active\s*=\s*1/.test(fn[0]), 'getTrialBalance must keep active = 1 filter');
  });

  test('getTrialBalance still requires REPORT_VIEW gate and POSTED-only filter', () => {
    const ext = readServerSrc('modules/extended.js');
    const fn = ext.match(/export\s+function\s+getTrialBalance[\s\S]*?^}/m);
    assert.ok(/allow\(actor,\s*"REPORT_VIEW"\)/.test(fn[0]),
      'getTrialBalance must keep REPORT_VIEW gate');
    assert.ok(/v\.status\s*=\s*'POSTED'/.test(fn[0]),
      'getTrialBalance must keep status = POSTED filter');
  });

  test('createAccountingVoucher populates period from voucherDate.slice(0, 7)', () => {
    const src = readServerSrc('app.js');
    // The INSERT statement now includes `period` as the 10th column.
    assert.ok(/INSERT INTO accounting_vouchers\([\s\S]*?period[\s\S]*?\)\s*VALUES\(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)/.test(src),
      'INSERT statement must include period column (10 placeholders)');
    assert.ok(/effectiveVoucherDate\.slice\(0,\s*7\)/.test(src) || /voucherDate\.slice\(0,\s*7\)/.test(src),
      'period write must derive from voucherDate.slice(0, 7)');
  });

  test('updateAccountingVoucher keeps period in sync with voucherDate', () => {
    const src = readServerSrc('app.js');
    assert.ok(/UPDATE accounting_vouchers SET voucher_date[\s\S]*?period\s*=\s*\?/.test(src),
      'UPDATE statement must keep period in sync');
  });
});

// ============================================================
// End-to-end: Trial Balance returns SMOKE vouchers
// ============================================================

describe('Phase E — Trial Balance end-to-end', () => {
  let tempDir;
  let database;
  let server;
  let baseUrl;
  let accountingToken;
  let adminToken;
  let approverRoleId;
  let approverToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-trial-balance-'));
    server = createServer(createApp(database = createDatabase(join(tempDir, 'erp.db')), { distDir: undefined }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = (await adminLogin.json()).token;

    // Create an approver role to exercise creator !== approver
    const approverRole = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'TB_APPROVER', name: 'Trial Balance Approver', permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE'] }),
    });
    approverRoleId = (await approverRole.json()).id;
    const { hashPassword } = await import('./db.js');
    const pwd = hashPassword('tb-approver-pwd');
    database.prepare(`INSERT INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
      VALUES ('user-tb-approver', 'tb-approver', 'Trial Balance 审核员', ?, ?, ?, 1, ?)`)
      .run(pwd.hash, pwd.salt, approverRoleId, new Date().toISOString());

    const accLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
    });
    accountingToken = (await accLogin.json()).token;

    const apprLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'tb-approver', password: 'tb-approver-pwd' }),
    });
    approverToken = (await apprLogin.json()).token;
  });

  after(async () => {
    await new Promise((r) => server.close(() => r()));
    if (database) try { database.close(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function api(path, opts = {}, token = accountingToken) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (opts.body && typeof opts.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      opts = { ...opts, body: JSON.stringify(opts.body) };
    }
    const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function createSubmitApprove(token, voucherDate, entries) {
    const create = await api('/api/accounting-vouchers', {
      method: 'POST',
      body: { voucherDate, remark: 'trial-balance regression', entries },
    }, token);
    assert.equal(create.status, 201, `create must succeed; got ${create.status} ${JSON.stringify(create.data)}`);
    const vid = create.data.id;
    const submit = await api(`/api/accounting-vouchers/${vid}/submit`, { method: 'POST' }, token);
    assert.equal(submit.status, 200, `submit must succeed; got ${submit.status} ${JSON.stringify(submit.data)}`);
    const approve = await api(`/api/accounting-vouchers/${vid}/approve`, { method: 'POST' }, approverToken);
    assert.equal(approve.status, 200, `approve must succeed; got ${approve.status} ${JSON.stringify(approve.data)}`);
    return vid;
  }

  function row(trialBalance, code) {
    return trialBalance.find((r) => r.code === code);
  }

  test('subject filter regression: all 7 seeded subjects appear (no parent_id filter)', async () => {
    const res = await api('/api/reports/trial-balance?period=2099-01', {}, adminToken);
    assert.equal(res.status, 200, `trial balance must succeed; got ${res.status} ${JSON.stringify(res.data)}`);
    const codes = res.data.trialBalance.map((r) => r.code).sort();
    // All 7 seeded subjects must be present even on a period with zero activity.
    for (const expected of ['1001', '1002', '1122', '1405', '2202', '6001', '6401']) {
      assert.ok(codes.includes(expected),
        `trial balance must include subject ${expected} regardless of activity; got [${codes.join(',')}]`);
    }
    assert.equal(codes.length, 7, `trial balance must contain exactly the 7 seeded subjects; got [${codes.join(',')}]`);
  });

  test('POSTED manual voucher with period populated appears in Trial Balance', async () => {
    // SMOKE-E01: 借 1001 ¥10,000 / 贷 6001 ¥10,000 (1000000 cents)
    const e01 = await createSubmitApprove(accountingToken, '2026-09-01', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: '现金' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: '收入' },
    ]);
    // Verify period was written at create time
    const periodWritten = database.prepare(`SELECT period FROM accounting_vouchers WHERE id=?`).get(e01).period;
    assert.equal(periodWritten, '2026-09',
      `createAccountingVoucher must populate period = voucherDate.slice(0, 7); got '${periodWritten}'`);

    // SMOKE-E02: 借 6401 ¥4,000 / 贷 1001 ¥4,000 (400000 cents)
    const e02 = await createSubmitApprove(accountingToken, '2026-09-02', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 400000, summary: '成本' },
      { subjectId: 'subject-001', direction: 'CREDIT', amountCents: 400000, summary: '现金' },
    ]);
    const periodWritten2 = database.prepare(`SELECT period FROM accounting_vouchers WHERE id=?`).get(e02).period;
    assert.equal(periodWritten2, '2026-09');

    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    assert.equal(res.status, 200);
    const tb = res.data.trialBalance;

    // All three subjects must appear
    assert.ok(row(tb, '1001'), '1001 库存现金 must appear');
    assert.ok(row(tb, '6001'), '6001 主营业务收入 must appear');
    assert.ok(row(tb, '6401'), '6401 主营业务成本 must appear');

    // 1001: debit 1000000 (E01), credit 400000 (E02), net +600000
    const r1001 = row(tb, '1001');
    assert.equal(r1001.periodDebit, 1000000, '1001 periodDebit must equal 1000000');
    assert.equal(r1001.periodCredit, 400000, '1001 periodCredit must equal 400000');
    assert.equal(r1001.closingBalance, 600000, '1001 closingBalance (ASSET: +debit-credit) must be 600000');

    // 6001: credit 1000000
    const r6001 = row(tb, '6001');
    assert.equal(r6001.periodDebit, 0);
    assert.equal(r6001.periodCredit, 1000000, '6001 periodCredit must equal 1000000');
    assert.equal(r6001.closingBalance, 1000000, '6001 closingBalance (REVENUE: +credit-debit) must be 1000000');

    // 6401: debit 400000
    const r6401 = row(tb, '6401');
    assert.equal(r6401.periodDebit, 400000, '6401 periodDebit must equal 400000');
    assert.equal(r6401.periodCredit, 0);
    assert.equal(r6401.closingBalance, 400000, '6401 closingBalance (EXPENSE: +debit-credit) must be 400000');

    // Debit/Credit totals must match production smoke expectation (14,000,000 cents = ¥140,000.00)
    const totalDebit = tb.reduce((s, r) => s + r.periodDebit, 0);
    const totalCredit = tb.reduce((s, r) => s + r.periodCredit, 0);
    assert.equal(totalDebit, 1400000, `period total debit must equal 1400000 cents; got ${totalDebit}`);
    assert.equal(totalCredit, 1400000, `period total credit must equal 1400000 cents; got ${totalCredit}`);
  });

  test('correct September date range: 2026-09-01 .. 2026-09-30', async () => {
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    assert.equal(res.data.period.startDate, '2026-09-01');
    assert.equal(res.data.period.endDate, '2026-09-30');
  });

  test('period isolation: 2026-08-31 voucher NOT included in September', async () => {
    // Add an August 31 voucher with substantial amount
    await createSubmitApprove(accountingToken, '2026-08-31', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 999999, summary: 'aug' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 999999, summary: 'aug' },
    ]);
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    // 1001 must NOT include 999999 from August
    assert.equal(r1001.periodDebit, 1000000,
      `2026-09 trial balance 1001.periodDebit must NOT include 2026-08-31 voucher; got ${r1001.periodDebit}`);
  });

  test('period isolation: 2026-10-01 voucher NOT included in September', async () => {
    await createSubmitApprove(accountingToken, '2026-10-01', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 888888, summary: 'oct' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 888888, summary: 'oct' },
    ]);
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.periodDebit, 1000000,
      `2026-09 trial balance 1001.periodDebit must NOT include 2026-10-01 voucher; got ${r1001.periodDebit}`);
  });

  test('off-by-one regression: 2026-09-30 (last day) voucher IS included', async () => {
    await createSubmitApprove(accountingToken, '2026-09-30', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 777777, summary: 'last-day' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 777777, summary: 'last-day' },
    ]);
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.periodDebit, 1000000 + 777777,
      `2026-09 trial balance 1001.periodDebit must include 2026-09-30 voucher (was the off-by-one bug); got ${r1001.periodDebit}`);
  });

  test('ENTERED voucher is excluded from Trial Balance', async () => {
    // Create an ENTERED voucher but do NOT submit
    await api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-15',
        remark: 'entered only',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 55555, summary: 'x' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 55555, summary: 'x' },
        ],
      },
    });
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.periodDebit, 1000000 + 777777,
      `ENTERED voucher must NOT affect period debit; got ${r1001.periodDebit}`);
  });

  test('SUBMITTED voucher is excluded from Trial Balance', async () => {
    const create = await api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-15',
        remark: 'submitted only',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 44444, summary: 'x' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 44444, summary: 'x' },
        ],
      },
    });
    await api(`/api/accounting-vouchers/${create.data.id}/submit`, { method: 'POST' });
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.periodDebit, 1000000 + 777777,
      `SUBMITTED voucher must NOT affect period debit; got ${r1001.periodDebit}`);
  });

  test('REJECTED voucher is excluded from Trial Balance', async () => {
    const create = await api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-15',
        remark: 'rejected only',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 33333, summary: 'x' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 33333, summary: 'x' },
        ],
      },
    });
    await api(`/api/accounting-vouchers/${create.data.id}/submit`, { method: 'POST' });
    await api(`/api/accounting-vouchers/${create.data.id}/reject`, {
      method: 'POST',
      body: { rejectionReason: 'trial balance regression' },
    }, approverToken);
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.periodDebit, 1000000 + 777777,
      `REJECTED voucher must NOT affect period debit; got ${r1001.periodDebit}`);
  });

  test('POSTED-only: only POSTED vouchers contribute to Trial Balance', async () => {
    // Aggregate: at this point only the 4 POSTED vouchers (E01, E02, 8-31, 9-30, 10-01)
    // are POSTED for 2026-09. Note 8-31 and 10-01 are outside September — they
    // should not appear in 2026-09 period. So 2026-09 period should contain
    // exactly E01 + E02 + 9-30 = 1000000 + 400000 + 777777 = 2177777 debit.
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.periodDebit, 1000000 + 777777,
      `1001.periodDebit in 2026-09 must reflect only POSTED September vouchers; got ${r1001.periodDebit}`);

    const r6001 = row(res.data.trialBalance, '6001');
    assert.equal(r6001.periodCredit, 1000000 + 777777,
      `6001.periodCredit in 2026-09 must reflect only POSTED September vouchers; got ${r6001.periodCredit}`);

    // 6401 only has E02 = 400000
    const r6401 = row(res.data.trialBalance, '6401');
    assert.equal(r6401.periodDebit, 400000);
  });

  test('Trial Balance: period debit == period credit (existing model holds)', async () => {
    const res = await api('/api/reports/trial-balance?period=2026-09', {}, adminToken);
    const tb = res.data.trialBalance;
    const totalDebit = tb.reduce((s, r) => s + r.periodDebit, 0);
    const totalCredit = tb.reduce((s, r) => s + r.periodCredit, 0);
    assert.equal(totalDebit, totalCredit,
      `period debit must equal period credit for a balanced trial balance; debit=${totalDebit} credit=${totalCredit}`);
  });
});

// ============================================================
// Other reports must remain unchanged
// ============================================================

describe('Phase E — Other reports unaffected by Trial Balance fix', () => {
  let tempDir;
  let database;
  let server;
  let baseUrl;
  let accountingToken;
  let approverToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-tb-regress-'));
    server = createServer(createApp(database = createDatabase(join(tempDir, 'erp.db')), { distDir: undefined }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const adminToken = (await adminLogin.json()).token;

    const approverRole = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'TB_REGRESS_APPROVER', name: 'TB Regression Approver', permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE'] }),
    });
    const approverRoleId = (await approverRole.json()).id;
    const { hashPassword } = await import('./db.js');
    const pwd = hashPassword('tb-regress-pwd');
    database.prepare(`INSERT INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
      VALUES ('user-tb-regress-approver', 'tb-regress-approver', 'TB Regression 审核员', ?, ?, ?, 1, ?)`)
      .run(pwd.hash, pwd.salt, approverRoleId, new Date().toISOString());

    const accLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
    });
    accountingToken = (await accLogin.json()).token;

    const apprLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'tb-regress-approver', password: 'tb-regress-pwd' }),
    });
    approverToken = (await apprLogin.json()).token;

    // Create + submit + approve the same two SMOKE vouchers
    async function post(path, body, token = accountingToken) {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.json();
    }
    const e01 = await post('/api/accounting-vouchers', {
      voucherDate: '2026-09-01', remark: 'regress',
      entries: [
        { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: '现金' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: '收入' },
      ],
    });
    await post(`/api/accounting-vouchers/${e01.id}/submit`, {});
    await post(`/api/accounting-vouchers/${e01.id}/approve`, {}, approverToken);

    const e02 = await post('/api/accounting-vouchers', {
      voucherDate: '2026-09-02', remark: 'regress',
      entries: [
        { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 400000, summary: '成本' },
        { subjectId: 'subject-001', direction: 'CREDIT', amountCents: 400000, summary: '现金' },
      ],
    });
    await post(`/api/accounting-vouchers/${e02.id}/submit`, {});
    await post(`/api/accounting-vouchers/${e02.id}/approve`, {}, approverToken);
  });

  after(async () => {
    await new Promise((r) => server.close(() => r()));
    if (database) try { database.close(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function api(path) {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    return res.json();
  }
  // Fetch admin token lazily (it was used inside before; expose via /me)
  let adminToken;
  async function ensureAdminToken() {
    if (adminToken) return adminToken;
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    adminToken = (await r.json()).token;
    return adminToken;
  }

  test('Income Statement still correct (revenue 1000000, expense 400000, profit 600000)', async () => {
    await ensureAdminToken();
    const r = await fetch(`${baseUrl}/api/reports/income-statement?period=2026-09`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const data = await r.json();
    assert.equal(data.revenue, 1000000);
    assert.equal(data.expense, 400000);
    assert.equal(data.profit, 600000);
    assert.equal(data.periodRange.startDate, '2026-09-01');
    assert.equal(data.periodRange.endDate, '2026-09-30');
  });

  test('Balance Sheet still correct (equationValid)', async () => {
    const r = await fetch(`${baseUrl}/api/reports/balance-sheet?period=2026-09`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const data = await r.json();
    assert.equal(data.asOfDate, '2026-09-30');
    assert.equal(data.equationValid, true,
      `balance sheet equationValid must hold; difference=${data.difference}`);
    assert.equal(data.totalAssets, 600000, '1001 库存现金 = 1000000 - 400000 = 600000');
    assert.equal(data.equity.unclosedProfit, 600000, 'revenue 1000000 - expense 400000 = 600000');
  });

  test('Financial Summary still correct (revenue / expense / profit / ar / ap)', async () => {
    const r = await fetch(`${baseUrl}/api/reports/financial-summary?period=2026-09`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const data = await r.json();
    assert.equal(data.revenue, 1000000);
    assert.equal(data.expense, 400000);
    assert.equal(data.profit, 600000);
    assert.equal(typeof data.accounts_receivable, 'number');
    assert.equal(typeof data.accounts_payable, 'number');
  });
});
