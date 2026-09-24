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
const srcDir = resolve(repoRoot, 'src');

function readServerSrc(rel) { return readFileSync(join(serverSrc, rel), 'utf8'); }
function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

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

  test('getTrialBalance returns per-row openingDirection and closingDirection', () => {
    const ext = readServerSrc('modules/extended.js');
    const fn = ext.match(/export\s+function\s+getTrialBalance[\s\S]*?^}/m);
    assert.ok(fn, 'getTrialBalance must be present');
    assert.ok(/openingDirection:\s*classifyBalanceDirection\(openingBalance/.test(fn[0]),
      'openingDirection must be derived from classifyBalanceDirection with opening=true');
    assert.ok(/closingDirection:\s*classifyBalanceDirection\(closingBalance/.test(fn[0]),
      'closingDirection must be derived from classifyBalanceDirection with opening=false');
  });

  test('classifyBalanceDirection helper exists with canonical accounting rules', () => {
    const ext = readServerSrc('modules/extended.js');
    assert.ok(/function\s+classifyBalanceDirection\(/.test(ext),
      'classifyBalanceDirection helper must be defined');
    // Verify the two canonical branches:
    // - opening branch: sign-based, subject-type agnostic
    // - closing branch: subject normal direction + sign of balance
    assert.ok(/balance\s*>\s*0\s*\?\s*"DEBIT"\s*:\s*"CREDIT"/.test(ext),
      'opening branch must classify positive → DEBIT, negative → CREDIT (sign-agnostic)');
    assert.ok(/\(balance\s*>\s*0\)\s*===\s*isDebitNormal/.test(ext),
      'closing branch must compare sign to subject normal direction');
  });

  test('frontend trial-balance aggregation uses direction fields (not Math.max sign heuristic)', () => {
    const src = readSrc('pages/accounting.jsx');
    // Must reference openingDirection / closingDirection fields
    assert.ok(/openingDirection/.test(src), 'aggregation must reference openingDirection');
    assert.ok(/closingDirection/.test(src), 'aggregation must reference closingDirection');
    // Defence in depth: the old buggy Math.max(balance, 0) / Math.max(-balance, 0) heuristic
    // for openingBalance and closingBalance must NOT appear in this file.
    assert.equal(/Math\.max\(Number\(r\.openingBalance\s*\|\|\s*0\),\s*0\)/.test(src), false,
      'opening balance aggregation must not use the old Math.max(>0, 0) sign heuristic');
    assert.equal(/Math\.max\(Number\(r\.closingBalance\s*\|\|\s*0\),\s*0\)/.test(src), false,
      'closing balance aggregation must not use the old Math.max(>0, 0) sign heuristic');
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

  test('subject filter includes legacy subjects and all configured Phase 6D role accounts', async () => {
    const res = await api('/api/reports/trial-balance?period=2099-01', {}, adminToken);
    assert.equal(res.status, 200, `trial balance must succeed; got ${res.status} ${JSON.stringify(res.data)}`);
    const codes = res.data.trialBalance.map((r) => r.code).sort();
    // Legacy subjects remain visible and Phase 6D adds the configured inventory/WIP/variance accounts.
    for (const expected of ['1001', '1002', '1122', '1405', '2202', '6001', '6401']) {
      assert.ok(codes.includes(expected),
        `trial balance must include subject ${expected} regardless of activity; got [${codes.join(',')}]`);
    }
    for (const expected of ['1403','1404','1406','5101','5102','6402','6403','6404','6405','6406']) assert.ok(codes.includes(expected), `trial balance must include Phase 6D role subject ${expected}`);
    assert.equal(codes.length, 17, `trial balance must contain the 17 configured subjects; got [${codes.join(',')}]`);
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
    assert.equal(r1001.openingDirection, null, '1001 openingDirection must be null (zero opening)');
    assert.equal(r1001.closingDirection, 'DEBIT', '1001 closingDirection must be DEBIT (ASSET positive = DEBIT)');

    // 6001: credit 1000000
    const r6001 = row(tb, '6001');
    assert.equal(r6001.periodDebit, 0);
    assert.equal(r6001.periodCredit, 1000000, '6001 periodCredit must equal 1000000');
    assert.equal(r6001.closingBalance, 1000000, '6001 closingBalance (REVENUE: +credit-debit) must be 1000000');
    assert.equal(r6001.openingDirection, null, '6001 openingDirection must be null (zero opening)');
    assert.equal(r6001.closingDirection, 'CREDIT', '6001 closingDirection must be CREDIT (REVENUE positive = CREDIT)');

    // 6401: debit 400000
    const r6401 = row(tb, '6401');
    assert.equal(r6401.periodDebit, 400000, '6401 periodDebit must equal 400000');
    assert.equal(r6401.periodCredit, 0);
    assert.equal(r6401.closingBalance, 400000, '6401 closingBalance (EXPENSE: +debit-credit) must be 400000');
    assert.equal(r6401.openingDirection, null, '6401 openingDirection must be null (zero opening)');
    assert.equal(r6401.closingDirection, 'DEBIT', '6401 closingDirection must be DEBIT (EXPENSE positive = DEBIT)');

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

// ============================================================
// Closing-direction regression — production smoke + edge cases
// ============================================================
//
// Original defect: Trial Balance footer showed
//   `期末余额 借 ¥20,000.00 / 贷 ¥0.00`
// instead of
//   `借 ¥10,000.00 / 贷 ¥10,000.00`.
// Root cause: backend stored closingBalance with subject-type-relative
// sign convention (positive = normal side of subject type), but the
// frontend used a sign-only heuristic Math.max(balance, 0) for debit /
// Math.max(-balance, 0) for credit. For credit-normal subjects
// (LIABILITY / EQUITY / REVENUE) a positive closing balance is on the
// CREDIT side — but the heuristic treated it as DEBIT.
//
// Fix: backend exposes per-row `openingDirection` and `closingDirection`
// fields ('DEBIT' | 'CREDIT' | null). Frontend aggregation uses these
// direction fields rather than balance sign. Same logic applies to
// opening balance to prevent the same latent defect on opening footer
// totals. Zero balance returns null direction and contributes to
// neither footer side.

// Each scenario gets its own describe block with a fresh DB. Cross-test data
// leakage is impossible because each tempDir/database is destroyed in `after`.
// Common setup helpers are inlined per block to keep each scenario standalone
// (Node test runner does not support nested describe hooks cleanly).

async function setupDirectionTestEnvironment() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-tb-direction-'));
  const database = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(database, { distDir: undefined }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const adminToken = (await adminLogin.json()).token;

  const approverRole = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'TB_DIR_APPROVER', name: 'TB Direction Approver', permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE', 'REPORT_VIEW'] }),
  });
  const approverRoleId = (await approverRole.json()).id;
  const { hashPassword } = await import('./db.js');
  const pwd = hashPassword('tb-dir-pwd');
  database.prepare(`INSERT INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
    VALUES ('user-tb-dir-approver', 'tb-dir-approver', 'TB Direction 审核员', ?, ?, ?, 1, ?)`)
    .run(pwd.hash, pwd.salt, approverRoleId, new Date().toISOString());

  const accLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
  });
  const accountingToken = (await accLogin.json()).token;

  const apprLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tb-dir-approver', password: 'tb-dir-pwd' }),
  });
  const approverToken = (await apprLogin.json()).token;

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
      body: { voucherDate, remark: 'direction regression', entries },
    }, token);
    assert.equal(create.status, 201, `create must succeed; got ${create.status} ${JSON.stringify(create.data)}`);
    const vid = create.data.id;
    const submit = await api(`/api/accounting-vouchers/${vid}/submit`, { method: 'POST' }, token);
    assert.equal(submit.status, 200, `submit must succeed; got ${submit.status} ${JSON.stringify(submit.data)}`);
    const approve = await api(`/api/accounting-vouchers/${vid}/approve`, { method: 'POST' }, approverToken);
    assert.equal(approve.status, 200, `approve must succeed; got ${approve.status} ${JSON.stringify(approve.data)}`);
    return vid;
  }

  function insertPostedVoucher(voucherDate, entries, period) {
    const vid = `v-${Math.random().toString(36).slice(2, 10)}`;
    const vno = `DIR-${vid}`;
    const now = new Date().toISOString();
    database.prepare(`
      INSERT INTO accounting_vouchers(id, voucher_no, source_type, source_id, voucher_date, remark, creator_id, created_at, status, period)
      VALUES (?, ?, 'MANUAL', ?, ?, 'synthetic', 'user-admin', ?, 'POSTED', ?)
    `).run(vid, vno, vid, voucherDate, now, period || voucherDate.slice(0, 7));
    for (const e of entries) {
      database.prepare(`
        INSERT INTO accounting_entries(id, voucher_id, subject_id, direction, amount_cents, summary)
        VALUES (?, ?, ?, ?, ?, 'synthetic')
      `).run(`e-${Math.random().toString(36).slice(2, 10)}`, vid, e.subjectId, e.direction, e.amountCents);
    }
    return vid;
  }

  async function teardown() {
    await new Promise((r) => server.close(() => r()));
    try { database.close(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { database, api, createSubmitApprove, insertPostedVoucher, teardown, accountingToken, approverToken };
}

function row(trialBalance, code) {
  return trialBalance.find((r) => r.code === code);
}

describe('Phase E — Production smoke: closing debit = closing credit = 1000000 cents', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('closing totals match ¥10,000 / ¥10,000 for SMOKE-E01 + SMOKE-E02 in 2026-09', async () => {
    await env.createSubmitApprove(env.accountingToken, '2026-09-01', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: '现金' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: '收入' },
    ]);
    await env.createSubmitApprove(env.accountingToken, '2026-09-02', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 400000, summary: '成本' },
      { subjectId: 'subject-001', direction: 'CREDIT', amountCents: 400000, summary: '现金' },
    ]);

    const res = await env.api('/api/reports/trial-balance?period=2026-09', {}, env.approverToken);
    assert.equal(res.status, 200);
    const tb = res.data.trialBalance;

    const closingDebit = tb.reduce((s, r) =>
      s + (r.closingDirection === 'DEBIT' ? Math.abs(r.closingBalance) : 0), 0);
    const closingCredit = tb.reduce((s, r) =>
      s + (r.closingDirection === 'CREDIT' ? Math.abs(r.closingBalance) : 0), 0);
    assert.equal(closingDebit, 1000000,
      `production smoke closing debit total must be 1000000 cents (¥10,000); got ${closingDebit}`);
    assert.equal(closingCredit, 1000000,
      `production smoke closing credit total must be 1000000 cents (¥10,000); got ${closingCredit}`);

    // Period debit/credit still 1400000 each (gross movement, unaffected by direction fix).
    const periodDebit = tb.reduce((s, r) => s + r.periodDebit, 0);
    const periodCredit = tb.reduce((s, r) => s + r.periodCredit, 0);
    assert.equal(periodDebit, 1400000);
    assert.equal(periodCredit, 1400000);

    // `借方发生额 = 贷方发生额` banner remains correct.
    assert.equal(periodDebit, periodCredit, 'period balanced flag must remain true');
  });
});

describe('Phase E — 1001 closing direction = DEBIT (ASSET)', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('1001 closing direction = DEBIT (ASSET, positive closing = DEBIT)', async () => {
    await env.createSubmitApprove(env.accountingToken, '2026-09-01', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: '现金' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: '收入' },
    ]);
    const res = await env.api('/api/reports/trial-balance?period=2026-09', {}, env.approverToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.closingDirection, 'DEBIT',
      `1001 (ASSET) positive closing must be DEBIT; got '${r1001.closingDirection}'`);
    assert.equal(r1001.closingBalance, 1000000);
  });
});

describe('Phase E — 6001 closing direction = CREDIT (REVENUE)', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('6001 closing direction = CREDIT (REVENUE, positive closing = CREDIT)', async () => {
    await env.createSubmitApprove(env.accountingToken, '2026-09-01', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: '现金' },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: '收入' },
    ]);
    const res = await env.api('/api/reports/trial-balance?period=2026-09', {}, env.approverToken);
    const r6001 = row(res.data.trialBalance, '6001');
    assert.equal(r6001.closingDirection, 'CREDIT',
      `6001 (REVENUE) positive closing must be CREDIT (credit-normal subject); got '${r6001.closingDirection}'`);
    assert.equal(r6001.closingBalance, 1000000);
  });
});

describe('Phase E — 6401 closing direction = DEBIT (EXPENSE)', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('6401 closing direction = DEBIT (EXPENSE, positive closing = DEBIT)', async () => {
    await env.createSubmitApprove(env.accountingToken, '2026-09-02', [
      { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 400000, summary: '成本' },
      { subjectId: 'subject-001', direction: 'CREDIT', amountCents: 400000, summary: '现金' },
    ]);
    const res = await env.api('/api/reports/trial-balance?period=2026-09', {}, env.approverToken);
    const r6401 = row(res.data.trialBalance, '6401');
    assert.equal(r6401.closingDirection, 'DEBIT',
      `6401 (EXPENSE) positive closing must be DEBIT; got '${r6401.closingDirection}'`);
    assert.equal(r6401.closingBalance, 400000);
  });
});

describe('Phase E — debit-normal contra balance direction', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('debit-normal account crossing into credit balance is classified CREDIT', async () => {
    // 1001 (ASSET, debit-normal) — debit 100, credit 150 → closing = -50 → CREDIT side (contra).
    env.insertPostedVoucher('2027-01-15', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 10000 },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000 },
    ], '2027-01');
    env.insertPostedVoucher('2027-01-16', [
      { subjectId: 'subject-001', direction: 'CREDIT', amountCents: 15000 },
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 15000 },
    ], '2027-01');

    const res = await env.api('/api/reports/trial-balance?period=2027-01', {}, env.approverToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.closingBalance, -5000,
      `1001 closing should be -5000 (10000 debit - 15000 credit); got ${r1001.closingBalance}`);
    assert.equal(r1001.closingDirection, 'CREDIT',
      `debit-normal account with negative closing must classify as CREDIT (contra); got '${r1001.closingDirection}'`);
  });
});

describe('Phase E — credit-normal contra balance direction', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('credit-normal account crossing into debit balance is classified DEBIT', async () => {
    // 6001 (REVENUE, credit-normal) — credit 100, debit 150 → closing = -50 → DEBIT side (contra).
    env.insertPostedVoucher('2027-02-10', [
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 10000 },
      { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000 },
    ], '2027-02');
    env.insertPostedVoucher('2027-02-11', [
      { subjectId: 'subject-006', direction: 'DEBIT', amountCents: 15000 },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 15000 },
    ], '2027-02');

    const res = await env.api('/api/reports/trial-balance?period=2027-02', {}, env.approverToken);
    const r6001 = row(res.data.trialBalance, '6001');
    assert.equal(r6001.closingBalance, -5000,
      `6001 closing should be -5000 (10000 credit - 15000 debit); got ${r6001.closingBalance}`);
    assert.equal(r6001.closingDirection, 'DEBIT',
      `credit-normal account with negative closing must classify as DEBIT (contra); got '${r6001.closingDirection}'`);
  });
});

describe('Phase E — zero balance does not inflate footer', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('zero balance does not inflate either side', async () => {
    // Self-cancelling voucher: debit + credit of equal amount → zero net.
    env.insertPostedVoucher('2027-03-10', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 10000 },
      { subjectId: 'subject-001', direction: 'CREDIT', amountCents: 10000 },
    ], '2027-03');
    const res = await env.api('/api/reports/trial-balance?period=2027-03', {}, env.approverToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.closingBalance, 0);
    assert.equal(r1001.closingDirection, null,
      `zero closing balance must return null direction (so it does not inflate either footer total); got '${r1001.closingDirection}'`);

    // Footer totals must both be 0.
    const closingDebit = res.data.trialBalance.reduce((s, r) =>
      s + (r.closingDirection === 'DEBIT' ? Math.abs(r.closingBalance) : 0), 0);
    const closingCredit = res.data.trialBalance.reduce((s, r) =>
      s + (r.closingDirection === 'CREDIT' ? Math.abs(r.closingBalance) : 0), 0);
    assert.equal(closingDebit, 0, `closing debit total must be 0; got ${closingDebit}`);
    assert.equal(closingCredit, 0, `closing credit total must be 0; got ${closingCredit}`);
  });
});

describe('Phase E — opening balance direction parity', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('opening balance uses the same correct direction logic', async () => {
    // Pre-September voucher creates a non-zero opening for 1001.
    env.insertPostedVoucher('2026-08-15', [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 200000 },
      { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 200000 },
    ], '2026-08');
    const res = await env.api('/api/reports/trial-balance?period=2026-09', {}, env.approverToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.openingBalance, 200000,
      `1001 opening should reflect pre-September debit; got ${r1001.openingBalance}`);
    assert.equal(r1001.openingDirection, 'DEBIT',
      `opening positive must classify as DEBIT regardless of subject type; got '${r1001.openingDirection}'`);

    // For a credit-normal subject (6001), opening SQL gives negative when only credits existed.
    const r6001 = row(res.data.trialBalance, '6001');
    assert.equal(r6001.openingBalance, -200000,
      `6001 opening = 0 - 200000 = -200000 (credit activity); got ${r6001.openingBalance}`);
    assert.equal(r6001.openingDirection, 'CREDIT',
      `opening negative must classify as CREDIT; got '${r6001.openingDirection}'`);

    // Opening footer totals: 200000 DEBIT, 200000 CREDIT → balanced.
    const openingDebit = res.data.trialBalance.reduce((s, r) =>
      s + (r.openingDirection === 'DEBIT' ? Math.abs(r.openingBalance) : 0), 0);
    const openingCredit = res.data.trialBalance.reduce((s, r) =>
      s + (r.openingDirection === 'CREDIT' ? Math.abs(r.openingBalance) : 0), 0);
    assert.equal(openingDebit, 200000);
    assert.equal(openingCredit, 200000);
  });
});

describe('Phase E — POSTED-only direction behavior unchanged', () => {
  let env;
  before(async () => { env = await setupDirectionTestEnvironment(); });
  after(async () => { await env.teardown(); });

  test('ENTERED voucher does not affect closing totals', async () => {
    // Insert only an ENTERED voucher (no submit / approve).
    await env.api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2027-04-10',
        remark: 'entered only',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 50000, summary: 'x' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: 'x' },
        ],
      },
    });
    const res = await env.api('/api/reports/trial-balance?period=2027-04', {}, env.approverToken);
    const tb = res.data.trialBalance;
    const r1001 = row(tb, '1001');
    assert.equal(r1001.closingBalance, 0,
      `ENTERED voucher must NOT affect closing balance; got ${r1001.closingBalance}`);
    assert.equal(r1001.closingDirection, null);
    const closingDebit = tb.reduce((s, r) =>
      s + (r.closingDirection === 'DEBIT' ? Math.abs(r.closingBalance) : 0), 0);
    assert.equal(closingDebit, 0,
      `ENTERED voucher must not contribute to closing debit total; got ${closingDebit}`);
  });

  test('SUBMITTED voucher does not affect closing totals', async () => {
    const create = await env.api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2027-04-11',
        remark: 'submitted only',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 60000, summary: 'x' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 60000, summary: 'x' },
        ],
      },
    });
    await env.api(`/api/accounting-vouchers/${create.data.id}/submit`, { method: 'POST' });
    const res = await env.api('/api/reports/trial-balance?period=2027-04', {}, env.approverToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.closingBalance, 0);
  });

  test('REJECTED voucher does not affect closing totals', async () => {
    const create = await env.api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2027-04-12',
        remark: 'rejected only',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 70000, summary: 'x' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 70000, summary: 'x' },
        ],
      },
    });
    await env.api(`/api/accounting-vouchers/${create.data.id}/submit`, { method: 'POST' });
    await env.api(`/api/accounting-vouchers/${create.data.id}/reject`, {
      method: 'POST',
      body: { rejectionReason: 'direction regression' },
    }, env.approverToken);
    const res = await env.api('/api/reports/trial-balance?period=2027-04', {}, env.approverToken);
    const r1001 = row(res.data.trialBalance, '1001');
    assert.equal(r1001.closingBalance, 0);
  });
});
