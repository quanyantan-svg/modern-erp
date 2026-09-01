// Regression coverage for the manual voucher amount-unit defect.
//
// Original defect (Phase E production browser verification):
//   User enters "10000" (yuan) in the manual voucher amount input. The form
//   stored that value directly into the request as amountCents, so the backend
//   persisted 10000 cents. The list / detail rendering then showed "¥100.00".
//   In other words, the frontend treated the human-entered yuan amount as
//   backend amountCents — a unit-conflation bug.
//
//   Backend accounting storage / API contract intentionally uses INTEGER
//   CENTS (accounting_entries.amount_cents, createAccountingVoucher /
//   updateAccountingVoucher) and must NOT change.
//
// Fix:
//   - New src/lib/money.js with pure yuanToCents() / centsToYuanInput()
//     helpers. Integer arithmetic only — no Math.round on float — so e.g.
//     10000.01 -> 1000001 (never 1000000.9999999).
//   - VoucherModal form state now holds YUAN strings under the `amount` field.
//   - Edit-mode init converts backend amount_cents -> yuan via centsToYuanInput().
//   - Save handler builds the request body with entries[].amountCents =
//     yuanToCents(entry.amount), keeping the backend contract intact.
//   - Balance validation runs in cents space (no float drift).
//
// Scope:
//   - Pure helpers tested directly via Node ESM import.
//   - VoucherModal source-level assertions cover the unit-boundary contract
//     and prevent the previous bug from regressing.
//   - Backend end-to-end tests confirm integer cents are received and
//     persisted across the create / edit round-trip.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { yuanToCents, centsToYuanInput } from '../src/lib/money.js';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');
function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

// ============================================================
// Pure yuanToCents / centsToYuanInput contract
// ============================================================

describe('yuanToCents — canonical contract', () => {
  const cases = [
    ['1',         100],
    ['1.5',       150],
    ['1.50',      150],
    ['10000',     1000000],
    ['10000.00',  1000000],
    ['10000.01',  1000001],
    ['0.01',      1],
    ['0.1',       10],
    ['0',         null],     // zero: rejected (non-positive)
    ['-100',      null],     // negative: rejected
    ['100.005',   null],     // >2 decimal places: rejected per UX convention
    ['',          null],
    ['   ',       null],
    [null,        null],
    [undefined,   null],
    ['abc',       null],
    ['1.2.3',     null],
    ['1,000',     null],     // comma not allowed
    ['1e2',       null],     // scientific notation not allowed
  ];
  for (const [input, expected] of cases) {
    test(`yuanToCents(${JSON.stringify(input)}) -> ${expected === null ? 'null' : expected}`, () => {
      assert.equal(yuanToCents(input), expected, `yuanToCents(${JSON.stringify(input)}) must equal ${expected}`);
    });
  }

  test('10000.01 -> exactly 1000001 (no float drift)', () => {
    // The classic float trap: 10000.01 * 100 = 1000000.9999999...
    const result = yuanToCents('10000.01');
    assert.equal(result, 1000001);
    assert.equal(typeof result, 'number');
    assert.ok(Number.isInteger(result), 'result must be an integer (no float residue)');
  });
});

describe('centsToYuanInput — canonical contract', () => {
  const cases = [
    [1000000,  '10000.00'],
    [1000001,  '10000.01'],
    [1,        '0.01'],
    [10,       '0.10'],
    [100,      '1.00'],
    [150,      '1.50'],
    [0,        '0.00'],
    [null,     ''],
    [undefined, ''],
    ['',       ''],
  ];
  for (const [input, expected] of cases) {
    test(`centsToYuanInput(${input}) -> ${JSON.stringify(expected)}`, () => {
      assert.equal(centsToYuanInput(input), expected);
    });
  }

  test('round-trip yuanToCents -> centsToYuanInput is identity (no drift)', () => {
    for (const cents of [1, 10, 100, 150, 999, 1000000, 1000001, 99999999]) {
      const yuan = centsToYuanInput(cents);
      const back = yuanToCents(yuan);
      assert.equal(back, cents, `round-trip must be identity for ${cents}: ${cents} -> ${JSON.stringify(yuan)} -> ${back}`);
    }
  });
});

// ============================================================
// VoucherModal source-level — unit-boundary contract
// ============================================================

describe('VoucherModal source-level — yuan/cents boundary contract', () => {
  test('form state stores amounts under the `amount` field (yuan string), NOT `amountCents`', () => {
    const src = readSrc('pages/accounting.jsx');
    assert.ok(/import\s*\{[^}]*yuanToCents[^}]*\}\s*from\s*['"]\.\.\/lib\/money\.js['"]/.test(src),
      'accounting page must import yuanToCents / centsToYuanInput from ../lib/money.js');
    assert.ok(/amount:\s*centsToYuanInput\(e\.amount_cents\s*\?\?\s*e\.amountCents\)/.test(src),
      'edit-mode init must convert backend amount_cents -> yuan via centsToYuanInput');
    assert.ok(/amount:\s*''/.test(src),
      'create-mode default entries must hold an empty yuan string, not a cents value');
    assert.ok(/setEntry\(i,\s*'amount',\s*e\.target\.value\)/.test(src),
      'amount input onChange must write to `amount` field (yuan), not `amountCents`');
  });

  test('save handler builds request body with integer amountCents (backend contract preserved)', () => {
    const src = readSrc('pages/accounting.jsx');
    // The body construction must derive amountCents from yuanToCents(e.amount).
    assert.ok(/amountCents:\s*yuanToCents\(e\.amount\)/.test(src),
      'request body must derive amountCents from yuanToCents(e.amount)');
    // Must NOT do a naive yuan * 100 (float-drift trap).
    assert.equal(/e\.amount\s*\*\s*100/.test(src), false,
      'UI must not multiply yuan by 100 directly; use yuanToCents() for integer math');
    assert.equal(/Math\.round\([^)]*\*\s*100/.test(src), false,
      'UI must not use Math.round(yuan * 100); that produces float drift');
  });

  test('balance validation operates in cents space (no float comparison)', () => {
    const src = readSrc('pages/accounting.jsx');
    // The validation IIFE must sum yuanToCents(e.amount) — not Number(e.amount).
    assert.ok(/yuanToCents\(e\.amount\)/.test(src),
      'balance validation must convert each entry to cents via yuanToCents()');
    // Defence: the old direct Number(e.amount) sum must be gone.
    assert.equal(/debit\s*\+=\s*Number\(e\.amount\)/.test(src), false,
      'old `debit += Number(e.amount)` direct-sum pattern must be removed');
  });

  test('rejects amount <= 0 and malformed amounts at the validation layer', () => {
    const src = readSrc('pages/accounting.jsx');
    assert.ok(/金额必须大于 0/.test(src),
      'amount <= 0 guard must surface 金额必须大于 0');
  });
});

// ============================================================
// Backend end-to-end — UI request contract is integer cents
// ============================================================

describe('Backend end-to-end — manual voucher persists integer cents', () => {
  let tempDir;
  let database;
  let server;
  let baseUrl;
  let accountingToken;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-voucher-units-'));
    server = createServer(createApp(database = createDatabase(join(tempDir, 'erp.db')), { distDir: undefined }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
    });
    accountingToken = (await login.json()).token;
  });

  after(async () => {
    await new Promise((r) => server.close(() => r()));
    if (database) try { database.close(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function apiCall(path, opts = {}) {
    const headers = { Authorization: `Bearer ${accountingToken}`, ...(opts.headers || {}) };
    if (opts.body && typeof opts.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      opts = { ...opts, body: JSON.stringify(opts.body) };
    }
    const res = await fetch(`${baseUrl}${path}`, { ...opts, headers });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  test('POST manual voucher with amountCents: 1000000 -> persisted 1000000 (integer cents contract preserved)', async () => {
    // Simulate what the corrected VoucherModal save() sends.
    const res = await apiCall('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-01',
        remark: 'units test 10000 yuan',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: '借' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: '贷' },
        ],
      },
    });
    assert.equal(res.status, 201, `create must succeed; got ${res.status}`);
    const detail = await apiCall(`/api/accounting-vouchers/${res.data.id}`);
    assert.equal(detail.data.voucher.status, 'ENTERED');
    assert.equal(detail.data.voucher.debitTotal, 1000000);
    assert.equal(detail.data.voucher.creditTotal, 1000000);
    assert.equal(detail.data.voucher.entries[0].amount_cents, 1000000);
    assert.equal(detail.data.voucher.entries[1].amount_cents, 1000000);
  });

  test('yuanToCents -> POST body amounts are accepted as integer cents', async () => {
    // Drive the backend with the exact cents the helper would produce.
    const cases = [
      { yuan: '1',       cents: 100 },
      { yuan: '1.5',     cents: 150 },
      { yuan: '10000',   cents: 1000000 },
      { yuan: '10000.01',cents: 1000001 },
      { yuan: '0.01',    cents: 1 },
    ];
    for (const { yuan, cents } of cases) {
      const res = await apiCall('/api/accounting-vouchers', {
        method: 'POST',
        body: {
          voucherDate: '2026-09-01',
          remark: `units test ${yuan} yuan`,
          entries: [
            { subjectId: 'subject-001', direction: 'DEBIT', amountCents: cents, summary: `d ${yuan}` },
            { subjectId: 'subject-006', direction: 'CREDIT', amountCents: cents, summary: `c ${yuan}` },
          ],
        },
      });
      assert.equal(res.status, 201, `${yuan} yuan (${cents} cents) create must succeed; got ${res.status}`);
      const detail = await apiCall(`/api/accounting-vouchers/${res.data.id}`);
      assert.equal(detail.data.voucher.entries[0].amount_cents, cents,
        `amount_cents must persist as integer ${cents} for ${yuan} yuan`);
    }
  });

  test('create -> edit round-trip: PATCH preserves integer cents (no double-conversion)', async () => {
    const create = await apiCall('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-01',
        remark: 'round-trip test',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: 'd' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 1000000, summary: 'c' },
        ],
      },
    });
    assert.equal(create.status, 201);
    const voucherId = create.data.id;

    // Simulate the corrected edit flow: backend cents -> centsToYuanInput ->
    // user re-submits the same yuan -> yuanToCents -> integer cents.
    const detail = await apiCall(`/api/accounting-vouchers/${voucherId}`);
    const originalCents = detail.data.voucher.entries[0].amount_cents;
    const yuan = centsToYuanInput(originalCents);            // "10000.00"
    const backToCents = yuanToCents(yuan);                    // 1000000
    assert.equal(backToCents, originalCents, 'cents -> yuan -> cents must be identity');

    const patch = await apiCall(`/api/accounting-vouchers/${voucherId}`, {
      method: 'PATCH',
      body: {
        voucherDate: '2026-09-02',
        remark: 'round-trip edit',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: backToCents, summary: 'd' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: backToCents, summary: 'c' },
        ],
      },
    });
    assert.equal(patch.status, 200, `PATCH must succeed; got ${patch.status}`);
    const detail2 = await apiCall(`/api/accounting-vouchers/${voucherId}`);
    assert.equal(detail2.data.voucher.entries[0].amount_cents, originalCents,
      'PATCH must NOT multiply by 100 again — amount must remain integer cents');
  });

  test('unbalanced amount (UI rejects via yuanToCents null) is also caught by backend (defence in depth)', async () => {
    // UI sends only what yuanToCents accepted; backend must still reject imbalance
    // (diff > 1 cent tolerance). Use a clearly unbalanced pair.
    const res = await apiCall('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-01',
        remark: 'unbalanced',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 1000000, summary: 'd' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 990000, summary: 'c' },
        ],
      },
    });
    assert.equal(res.status, 400, `backend must reject unbalanced voucher; got ${res.status}`);
  });
});