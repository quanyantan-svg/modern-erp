// Regression coverage for Phase E — Accounting / 会计期间 UI.
//
// Goal:
//   Expose a minimal 会计期间 tab on the existing Accounting page that drives
//   the canonical period-closing backend (PERIOD_CLOSE_VIEW / PERIOD_CLOSE_MANAGE)
//   without altering other Accounting UI, reporting, or workflow.
//
// Backend contract (already present, not authored here):
//   - GET    /api/period-closures?year=YYYY                   PERIOD_CLOSE_VIEW | PERIOD_CLOSE_MANAGE
//   - POST   /api/period-closures                             PERIOD_CLOSE_MANAGE
//   - POST   /api/period-closures/:id/close                   PERIOD_CLOSE_MANAGE
//   - POST   /api/period-closures/:id/unclose                 PERIOD_CLOSE_MANAGE
//   - GET    /api/period-closures/closure-checklist?period=.. PERIOD_CLOSE_MANAGE
//   - closePeriod writes audit CLOSE_PERIOD atomically with status flip.
//   - unclosePeriod writes audit UNCLOSE_PERIOD atomically with status flip.
//   - Voucher CRUD/submit/approve/reject blocked (409) when period is CLOSED.
//
// This test file does NOT modify any of those handlers — it only covers the
// UI integration contract and end-to-end behaviour on a fresh DB.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }

// ============================================================
// Backend permission wiring
// ============================================================

describe('Phase E — period permission registry', () => {
  test('PERIOD_CLOSE_VIEW and PERIOD_CLOSE_MANAGE are registered', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('PERIOD_CLOSE_VIEW'), 'PERIOD_CLOSE_VIEW must be registered');
    assert.ok(codes.includes('PERIOD_CLOSE_MANAGE'), 'PERIOD_CLOSE_MANAGE must be registered');
  });
});

// ============================================================
// UI source-level contract
// ============================================================

describe('Phase E — 会计期间 UI source-level contract', () => {
  const accountingSrc = readSrc(join('pages', 'accounting.jsx'));

  test('PeriodManagement component exists in accounting.jsx', () => {
    assert.match(accountingSrc, /function\s+PeriodManagement\s*\(/);
  });

  test('PERIOD_STATUS_LABELS covers OPEN and CLOSED', () => {
    assert.match(accountingSrc, /PERIOD_STATUS_LABELS\s*=\s*\{[^}]*OPEN:\s*['"]未结账['"][^}]*CLOSED:\s*['"]已结账['"]/s);
  });

  test('PERIOD_STATUS_BADGE maps OPEN/CLOSED to existing status CSS', () => {
    assert.match(accountingSrc, /PERIOD_STATUS_BADGE\s*=\s*\{[\s\S]*?OPEN:\s*\{\s*type:\s*['"]info['"]\s*,\s*status:\s*['"]draft['"]/);
    assert.match(accountingSrc, /PERIOD_STATUS_BADGE\s*=\s*\{[\s\S]*?CLOSED:\s*\{\s*type:\s*['"]success['"]\s*,\s*status:\s*['"]completed['"]/);
  });

  test('list endpoint call uses ?year=YYYY query and stores closures', () => {
    assert.match(accountingSrc, /\/api\/period-closures\?year=/);
    assert.match(accountingSrc, /setClosures\(r\.closures\s*\|\|\s*\[\]\)/);
  });

  test('create endpoint POST with { year, month }', () => {
    assert.match(accountingSrc, /api\(\s*['"]\/api\/period-closures['"]\s*,\s*\{\s*method:\s*['"]POST['"]\s*,\s*body:\s*\{\s*year:\s*Number\(y\)/);
  });

  test('close endpoint POST /api/period-closures/:id/close', () => {
    assert.match(accountingSrc, /api\(\s*`\/api\/period-closures\/\$\{closureId\}\/close`/);
  });

  test('unclose endpoint POST /api/period-closures/:id/unclose', () => {
    assert.match(accountingSrc, /api\(\s*`\/api\/period-closures\/\$\{closureId\}\/unclose`/);
  });

  test('checklist endpoint GET ?period=YYYY-MM', () => {
    assert.match(accountingSrc, /\/api\/period-closures\/closure-checklist\?period=/);
  });

  test('Tab registration uses canonical PERIOD_CLOSE_VIEW gate', () => {
    assert.match(accountingSrc, /const\s+showPeriod\s*=\s*can\(user,\s*['"]PERIOD_CLOSE_VIEW['"]\)/);
  });

  test('Tab only renders when showPeriod is true', () => {
    assert.match(accountingSrc, /\{showPeriod\s*&&[\s\S]*?>会计期间<\/button>/);
  });

  test('Tab content only renders for showPeriod', () => {
    assert.match(accountingSrc, /\{tab === ['"]period['"]\s*&&\s*showPeriod\s*&&\s*<PeriodManagement/);
  });

  test('Initialize (create period row) gated by PERIOD_CLOSE_MANAGE', () => {
    assert.match(accountingSrc, /!\s*c\s*&&\s*canManage\s*&&\s*<button[^>]*onClick=\{\(\)\s*=>\s*createPeriod\(period\)\}>初始化<\/button>/);
  });

  test('Close button disabled when checklist passed=false', () => {
    assert.match(accountingSrc, /selectedClosure\.status\s*===\s*['"]OPEN['"][^}]*disabled=\{busy\s*\|\|\s*!\s*checklist\s*\|\|\s*!\s*checklist\.passed/s);
  });

  test('Unclose button only available for CLOSED period', () => {
    assert.match(accountingSrc, /selectedClosure\.status\s*===\s*['"]CLOSED['"][\s\S]*?>\s*重开期间/);
  });

  test('Confirmation modal includes canonical close-period confirmation text', () => {
    assert.match(accountingSrc, /确认关闭会计期间\s*\$\{confirm\.period\}\?/);
    assert.match(accountingSrc, /关闭后该期间的会计凭证将受到结账保护/);
  });

  test('Confirmation modal includes canonical reopen confirmation text', () => {
    assert.match(accountingSrc, /确认重开会计期间\s*\$\{confirm\.period\}\?/);
  });

  test('PeriodManagement does not generate retained earnings / profit carry-forward entries', () => {
    // The frontend must not construct period-end vouchers. Restrict check to
    // only the PeriodManagement function body (escape BalanceSheet helpers
    // that legitimately reference the "未结转损益" virtual row).
    const idx = accountingSrc.indexOf('function PeriodManagement');
    assert.notEqual(idx, -1, 'PeriodManagement function must be defined');
    const componentBody = accountingSrc.slice(idx, idx + 4000);
    assert.doesNotMatch(componentBody, /retained|Earnings|利润分配|本年利润|结转损益|createRetained|generateClosingVoucher/);
  });

  test('Reuses Badge / Modal / Loading / Empty / Panel — no custom render primitives', () => {
    assert.match(accountingSrc, /import\s*\{[^}]*\bBadge\b[^}]*\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
    assert.match(accountingSrc, /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
    assert.match(accountingSrc, /import\s*\{[^}]*\bLoading\b[^}]*\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
    assert.match(accountingSrc, /import\s*\{[^}]*\bEmpty\b[^}]*\}\s*from\s*['"]\.\.\/components\/ui\.jsx['"]/);
  });
});

// ============================================================
// End-to-end: fresh DB, full period lifecycle
// ============================================================

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let accountingToken;
let periodManagerToken;

async function login(username, password, target = baseUrl) {
  const res = await fetch(`${target}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `login ${username}`);
  return (await res.json()).token;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-period-ui-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Create dedicated period-manager role (mirrors period.test.js harness).
  adminToken = await login('admin', 'admin123');

  const pmRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'PERIOD_MANAGER', name: '期间管理员', permissions: ['PERIOD_CLOSE_VIEW', 'PERIOD_CLOSE_MANAGE'] }),
  });
  const pmRole = await pmRes.json();
  const pmPwd = hashPassword('pm123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-pm', 'period-manager', '期间管理员', pmPwd.hash, pmPwd.salt, pmRole.id, new Date().toISOString());
  periodManagerToken = await login('period-manager', 'pm123');

  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((r, j) => server.close((e) => e ? j(e) : r()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function rawJson(res) { return res.json(); }

async function createVoucher(token, voucherDate, status = 'ENTERED', target = baseUrl) {
  const body = {
    voucherDate,
    entries: [
      { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 10000, summary: 'debit' },
      { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000, summary: 'credit' },
    ],
  };
  const res = await fetch(`${target}/api/accounting-vouchers`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201, `create voucher ${status}`);
  const v = await res.json();
  if (status === 'SUBMITTED') {
    const sub = await fetch(`${target}/api/accounting-vouchers/${v.id}/submit`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.equal(sub.status, 200, 'submit voucher');
  } else if (status === 'POSTED') {
    const sub = await fetch(`${target}/api/accounting-vouchers/${v.id}/submit`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.equal(sub.status, 200, 'submit voucher');
    // admin (different user) approves
    const adminTok = await login('admin', 'admin123', target);
    const apr = await fetch(`${target}/api/accounting-vouchers/${v.id}/approve`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adminTok}` },
    });
    assert.equal(apr.status, 200, 'approve voucher');
  } else if (status === 'REJECTED') {
    const sub = await fetch(`${target}/api/accounting-vouchers/${v.id}/submit`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}` },
    });
    assert.equal(sub.status, 200, 'submit voucher');
    const adminTok = await login('admin', 'admin123', target);
    const rej = await fetch(`${target}/api/accounting-vouchers/${v.id}/reject`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adminTok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ rejectionReason: 'unit test' }),
    });
    assert.equal(rej.status, 200, 'reject voucher');
  }
  return v;
}

describe('Phase E — period authorization / routing', () => {
  test('close requires PERIOD_CLOSE_MANAGE (admin allowed)', async () => {
    // admin can use admin's "all" permission set
    // First create a closure row
    const c = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2099, month: 1 }),
    });
    assert.equal(c.status, 201);
    const cv = await c.json();

    // accounting role has no PERIOD_CLOSE_MANAGE
    const denied = await fetch(`${baseUrl}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accountingToken}` },
    });
    assert.equal(denied.status, 403, 'accounting must be forbidden from closing');

    // unauthenticated
    const unauth = await fetch(`${baseUrl}/api/period-closures/${cv.id}/close`, { method: 'POST' });
    assert.equal(unauth.status, 401, 'unauthenticated must 401');
  });

  test('unclose requires PERIOD_CLOSE_MANAGE', async () => {
    // Setup CLOSED period
    const c = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2099, month: 2 }),
    });
    const cv = await c.json();
    await fetch(`${baseUrl}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adminToken}` },
    });

    const denied = await fetch(`${baseUrl}/api/period-closures/${cv.id}/unclose`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${accountingToken}` },
    });
    assert.equal(denied.status, 403, 'accounting must be forbidden from reopening');
  });

  test('list endpoint open to PERIOD_CLOSE_VIEW', async () => {
    const res = await fetch(`${baseUrl}/api/period-closures?year=2099`, {
      headers: { 'Authorization': `Bearer ${accountingToken}` },
    });
    // accounting has REPORT_VIEW but NOT PERIOD_CLOSE_VIEW; spec says 403.
    assert.equal(res.status, 403);
  });

  test('checklist endpoint requires PERIOD_CLOSE_MANAGE', async () => {
    const res = await fetch(`${baseUrl}/api/period-closures/closure-checklist?period=2099-01`, {
      headers: { 'Authorization': `Bearer ${accountingToken}` },
    });
    assert.equal(res.status, 403);
  });
});

describe('Phase E — period checklist blocking coverage (fresh DB)', () => {
  let dbDir;
  let db;
  let svr;
  let url;

  beforeEach(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'modern-erp-period-checklist-'));
    db = createDatabase(join(dbDir, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${svr.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  test('close endpoint rejects ENTERED-only period', async () => {
    const adm = await login('admin', 'admin123', url);
    const creator = await login('accounting', 'accounting123', url);
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2080, month: 1 }),
    });
    const cv = await c.json();
    await createVoucher(creator, '2080-01-15', 'ENTERED', url);

    const r = await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });
    assert.equal(r.status, 400);
    const body = await rawJson(r);
    assert.match(body.error || '', /录入/);
  });

  test('close endpoint rejects SUBMITTED-only period', async () => {
    const adm = await login('admin', 'admin123', url);
    const creator = await login('accounting', 'accounting123', url);
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2080, month: 2 }),
    });
    const cv = await c.json();
    await createVoucher(creator, '2080-02-15', 'SUBMITTED', url);

    const r = await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });
    assert.equal(r.status, 400);
    const body = await rawJson(r);
    assert.match(body.error || '', /待审核/);
  });

  test('close endpoint rejects REJECTED-only period', async () => {
    const adm = await login('admin', 'admin123', url);
    const creator = await login('accounting', 'accounting123', url);
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2080, month: 3 }),
    });
    const cv = await c.json();
    await createVoucher(creator, '2080-03-15', 'REJECTED', url);

    const r = await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });
    assert.equal(r.status, 400);
    const body = await rawJson(r);
    assert.match(body.error || '', /驳回/);
  });

  test('close endpoint succeeds for POSTED-only period', async () => {
    const adm = await login('admin', 'admin123', url);
    const creator = await login('accounting', 'accounting123', url);
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2080, month: 4 }),
    });
    const cv = await c.json();
    await createVoucher(creator, '2080-04-15', 'POSTED', url);

    const r = await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });
    assert.equal(r.status, 200, `close should succeed for POSTED-only, got ${r.status}`);
  });
});

describe('Phase E — closed period protects voucher create + audit trail', () => {
  let dbDir;
  let db;
  let svr;
  let url;

  beforeEach(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'modern-erp-period-closed-'));
    db = createDatabase(join(dbDir, 'erp.db'));
    svr = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((r) => svr.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${svr.address().port}`;
  });

  afterEach(async () => {
    await new Promise((r, j) => svr.close((e) => e ? j(e) : r()));
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  test('CLOSED period blocks manual voucher create with HTTP 409', async () => {
    const adm = await login('admin', 'admin123', url);
    const creator = await login('accounting', 'accounting123', url);

    // Init + close a period
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2081, month: 9 }),
    });
    const cv = await c.json();
    await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });

    // Try to create voucher dated 2081-09-15 — must fail
    const body = {
      voucherDate: '2081-09-15',
      entries: [
        { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 10000, summary: '' },
        { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000, summary: '' },
      ],
    };
    const r = await fetch(`${url}/api/accounting-vouchers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creator}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 409, `voucher create must 409 in CLOSED period, got ${r.status}`);
    const j = await rawJson(r);
    assert.match(j.error || '', /2081-09\s*已结账/);
  });

  test('closePeriod writes CLOSE_PERIOD audit log; unclosePeriod writes UNCLOSE_PERIOD audit log', async () => {
    const adm = await login('admin', 'admin123', url);
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2082, month: 1 }),
    });
    const cv = await c.json();

    // No vouchers → close should succeed
    const closeRes = await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });
    assert.equal(closeRes.status, 200);

    const reopenRes = await fetch(`${url}/api/period-closures/${cv.id}/unclose`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });
    assert.equal(reopenRes.status, 200);

    // Verify audit_logs (must read via DB directly — no public listing of all
    // audits for arbitrary users; the API requires USERS_MANAGE).
    const auditRows = db.prepare(
      "SELECT action FROM audit_logs WHERE entity_type='PERIOD_CLOSURE' AND entity_id=? ORDER BY created_at"
    ).all(cv.id);
    const actions = auditRows.map((r) => r.action);
    assert.deepEqual(actions, ['CLOSE_PERIOD', 'UNCLOSE_PERIOD']);
  });

  test('Repeated close/reopen does not corrupt data', async () => {
    const adm = await login('admin', 'admin123', url);
    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2083, month: 6 }),
    });
    const cv = await c.json();
    for (let i = 0; i < 3; i++) {
      const closeRes = await fetch(`${url}/api/period-closures/${cv.id}/close`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
      });
      assert.equal(closeRes.status, 200, `close iter ${i}`);
      const reopenRes = await fetch(`${url}/api/period-closures/${cv.id}/unclose`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
      });
      assert.equal(reopenRes.status, 200, `reopen iter ${i}`);
    }
    // After 3 cycles it must still be OPEN and idempotent
    const finalState = db.prepare('SELECT status FROM period_closures WHERE id=?').get(cv.id);
    assert.equal(finalState.status, 'OPEN');
  });

  test('Reopened period allows new voucher creation again', async () => {
    const adm = await login('admin', 'admin123', url);
    const creator = await login('accounting', 'accounting123', url);

    const c = await fetch(`${url}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adm}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2084, month: 1 }),
    });
    const cv = await c.json();
    await fetch(`${url}/api/period-closures/${cv.id}/close`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });

    const denied = await fetch(`${url}/api/accounting-vouchers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creator}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        voucherDate: '2084-01-15',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 10000, summary: '' },
          { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 10000, summary: '' },
        ],
      }),
    });
    assert.equal(denied.status, 409);

    await fetch(`${url}/api/period-closures/${cv.id}/unclose`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${adm}` },
    });

    const allowed = await fetch(`${url}/api/accounting-vouchers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creator}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        voucherDate: '2084-01-20',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 5000, summary: 'after reopen' },
          { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 5000, summary: 'after reopen' },
        ],
      }),
    });
    assert.equal(allowed.status, 201, `voucher after reopen must succeed, got ${allowed.status}`);
  });
});
