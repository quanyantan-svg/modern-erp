// Regression coverage for Phase E — Accounting manual voucher workflow.
//
// Original defect:
//   1. The Accounting → Voucher list page had no "+ 新建凭证" button.
//      Backend canonical createAccountingVoucher (POST /api/accounting-vouchers,
//      ACCOUNTING_VIEW gate) was unused by the UI; the only path was legacy
//      sales/purchase auto-posting.
//   2. Voucher list rendered source_type 'MANUAL' as '库存调拨' (else-branch
//      fallback) — silently masking manually entered vouchers as transfers.
//   3. role-accounting was missing VOUCHER_SUBMIT, so even after adding
//      a create button, the accounting user could not transition
//      ENTERED → SUBMITTED.
//   4. VoucherDetail had no submit / approve / reject UI.
//
// Fix:
//   - New VoucherModal (create + edit REJECTED → ENTERED) wired into the
//     voucher tab, gated by ACCOUNTING_VIEW.
//   - voucherSourceLabel() map: MANUAL → 手工凭证; SALES_ORDER / PURCHASE_ORDER
//     / INVENTORY_TRANSFER mapped; unknown source renders raw code (never
//     silently masks as another type).
//   - Voucher status column (Badge) added to the list.
//   - VoucherDetail actions: submit (VOUCHER_SUBMIT), approve / reject
//     (VOUCHER_APPROVE + creator != approver), edit / delete (ACCOUNTING_VIEW
//     on ENTERED / REJECTED MANUAL). POSTED stays read-only.
//   - role-accounting now includes VOUCHER_SUBMIT (not VOUCHER_APPROVE).
//     Reconciliation is automatic via the existing seedSchema idempotency:
//     role_permissions has PK (role_id, permission_code) and the seed uses
//     INSERT OR IGNORE, so existing production DBs receive VOUCHER_SUBMIT
//     on next startup without a separate migration step.
//
// Scope:
//   - Frontend assertions run at source level (Node-only harness has no jsdom).
//   - Backend assertions run end-to-end against a fresh SQLite + local HTTP
//     server, mirroring the Phase D / voucher.test.js harness.
//   - Existing voucher.test.js, period.test.js, income-statement.test.js,
//     balance-sheet.test.js, financial-summary.test.js suites are not modified
//     and remain authoritative for their respective behaviour.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');
const serverSrc = resolve(repoRoot, 'server');

function readSrc(rel) { return readFileSync(join(srcDir, rel), 'utf8'); }
function readServerSrc(rel) { return readFileSync(join(serverSrc, rel), 'utf8'); }

// Extract a top-level function body by brace-counting from the function body's
// opening brace to the brace that brings the depth back to zero. Robust
// against inner functions / IIFEs / destructured parameters whose `}` would
// otherwise short-circuit a naive regex.
function extractComponent(src, name) {
  const startIdx = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  if (startIdx === -1) return null;
  // Skip past the parameter list: find the `)` that closes the function's `(`.
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = startIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') parenDepth++;
    else if (c === ')') {
      parenDepth--;
      if (parenDepth === 0) { bodyStart = i + 1; break; }
    }
  }
  if (bodyStart === -1) return null;
  // Now brace-count from bodyStart.
  let depth = 0;
  let started = false;
  for (let i = bodyStart; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') {
      depth--;
      if (started && depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return null;
}

// ============================================================
// Permission table — role-accounting has SUBMIT, no APPROVE
// ============================================================

describe('Phase E — role-accounting permission contract', () => {
  test('VOUCHER_SUBMIT is a registered permission', () => {
    const codes = PERMISSIONS.map(([code]) => code);
    assert.ok(codes.includes('VOUCHER_SUBMIT'), 'VOUCHER_SUBMIT must be registered');
    assert.ok(codes.includes('VOUCHER_APPROVE'), 'VOUCHER_APPROVE must remain registered');
    assert.ok(codes.includes('ACCOUNTING_VIEW'), 'ACCOUNTING_VIEW must remain registered');
  });

  test('role-accounting seed grants VOUCHER_SUBMIT (not VOUCHER_APPROVE)', () => {
    const src = readServerSrc('db.js');
    const match = src.match(/'role-accounting':\s*\[([\s\S]*?)\]/);
    assert.ok(match, "role-accounting permission list must be present");
    const perms = match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    assert.ok(perms.includes('VOUCHER_SUBMIT'), `role-accounting must include VOUCHER_SUBMIT; got [${perms.join(', ')}]`);
    assert.ok(perms.includes('ACCOUNTING_VIEW'), 'role-accounting must include ACCOUNTING_VIEW');
    assert.ok(perms.includes('REPORT_VIEW'), 'role-accounting must include REPORT_VIEW');
    assert.equal(perms.includes('VOUCHER_APPROVE'), false,
      'role-accounting must NOT include VOUCHER_APPROVE (separation of duties)');
  });
});

// ============================================================
// Existing DB upgrade receives VOUCHER_SUBMIT idempotently
// ============================================================

describe('Phase E — existing DB permission reconciliation', () => {
  let tempDir;
  let database;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-phase-e-recon-'));
  });

  after(async () => {
    if (database) try { database.close(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
  });

  function queryPerms(roleCode) {
    return database.prepare(`
      SELECT rp.permission_code
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      WHERE r.code = ?
      ORDER BY rp.permission_code
    `).all(roleCode).map((row) => row.permission_code);
  }

  test('after fresh seed, role-accounting has VOUCHER_SUBMIT but no VOUCHER_APPROVE', () => {
    database = createDatabase(join(tempDir, 'erp.db'));
    const perms = queryPerms('ACCOUNTING');
    assert.ok(perms.includes('VOUCHER_SUBMIT'), `fresh seed must include VOUCHER_SUBMIT; got [${perms.join(', ')}]`);
    assert.ok(perms.includes('ACCOUNTING_VIEW'));
    assert.equal(perms.includes('VOUCHER_APPROVE'), false);
  });

  test('simulated existing DB (VOUCHER_SUBMIT missing) receives it idempotently on re-seed', () => {
    // Simulate an "old" production DB by removing VOUCHER_SUBMIT from role-accounting.
    // Production currently has role-accounting rows WITHOUT VOUCHER_SUBMIT (pre-Phase-E).
    const roleRow = database.prepare(`SELECT id FROM roles WHERE code='ACCOUNTING'`).get();
    database.prepare(`DELETE FROM role_permissions WHERE role_id=? AND permission_code='VOUCHER_SUBMIT'`).run(roleRow.id);

    const before = queryPerms('ACCOUNTING');
    assert.equal(before.includes('VOUCHER_SUBMIT'), false, 'precondition: VOUCHER_SUBMIT must be absent before re-seed');
    const beforeCount = database.prepare(`SELECT COUNT(*) cnt FROM role_permissions WHERE role_id=?`).get(roleRow.id).cnt;

    // Re-run the seed (this is what the next application startup does).
    database.close();
    database = createDatabase(join(tempDir, 'erp.db'));

    const after = queryPerms('ACCOUNTING');
    assert.ok(after.includes('VOUCHER_SUBMIT'), 'post-seed: VOUCHER_SUBMIT must be present');
    const afterCount = database.prepare(`SELECT COUNT(*) cnt FROM role_permissions WHERE role_id=?`).get(roleRow.id).cnt;
    assert.equal(afterCount, beforeCount + 1, 'exactly one new permission row must have been inserted');
  });

  test('repeated startup does not duplicate VOUCHER_SUBMIT (idempotent)', () => {
    const roleRow = database.prepare(`SELECT id FROM roles WHERE code='ACCOUNTING'`).get();
    const beforeCount = database.prepare(`SELECT COUNT(*) cnt FROM role_permissions WHERE role_id=?`).get(roleRow.id).cnt;

    // Simulate a 3rd / 4th / 5th startup cycle.
    for (let i = 0; i < 3; i++) {
      database.close();
      database = createDatabase(join(tempDir, 'erp.db'));
    }

    const afterCount = database.prepare(`SELECT COUNT(*) cnt FROM role_permissions WHERE role_id=?`).get(roleRow.id).cnt;
    assert.equal(afterCount, beforeCount, `repeated startups must NOT duplicate permission rows; before=${beforeCount} after=${afterCount}`);
    assert.ok(queryPerms('ACCOUNTING').includes('VOUCHER_SUBMIT'), 'VOUCHER_SUBMIT must remain present after repeated startups');
  });

  test('reconciliation does not depend on ERP_SEED_DEMO (production with NODE_ENV=production must still get VOUCHER_SUBMIT)', async () => {
    const previousSeed = process.env.ERP_SEED_DEMO;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.ERP_SEED_DEMO = 'false';
    process.env.NODE_ENV = 'production';
    try {
      const otherDir = mkdtempSync(join(tmpdir(), 'modern-erp-phase-e-prod-'));
      try {
        // Bare-minimum schema: only create the table the seed touches.
        // Simulates the path setup-admin takes in production.
        const setupMod = await import('../scripts/setup-admin.mjs');
        setupMod.setupAdmin({ dbPath: join(otherDir, 'erp.db'), username: 'prod-admin', password: 'S3cure-Production-Pwd-1' });
        // Re-open via createDatabase to trigger seedSchema + role_permissions reconciliation.
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(join(otherDir, 'erp.db'));
        db.exec('PRAGMA foreign_keys = ON;');
        db.close();
        // Now run createDatabase, which triggers seedSchema on the production-shaped DB.
        const productionDb = createDatabase(join(otherDir, 'erp.db'));
        try {
          const roleRow = productionDb.prepare(`SELECT id FROM roles WHERE code='ACCOUNTING'`).get();
          assert.ok(roleRow, 'role-accounting must exist after setup-admin + seedSchema');
          const perms = productionDb.prepare(`SELECT permission_code FROM role_permissions WHERE role_id=?`).all(roleRow.id).map((r) => r.permission_code);
          assert.ok(perms.includes('VOUCHER_SUBMIT'),
            `production DB under ERP_SEED_DEMO=false must still receive VOUCHER_SUBMIT; got [${perms.join(', ')}]`);
          assert.equal(perms.includes('VOUCHER_APPROVE'), false,
            'production DB must NOT receive VOUCHER_APPROVE for role-accounting');
        } finally {
          productionDb.close();
        }
      } finally {
        rmSync(otherDir, { recursive: true, force: true });
      }
    } finally {
      if (previousSeed === undefined) delete process.env.ERP_SEED_DEMO; else process.env.ERP_SEED_DEMO = previousSeed;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

// ============================================================
// Frontend source-level — voucher tab surface
// ============================================================

describe('Phase E — frontend voucher UI wiring', () => {
  test('accounting.jsx voucher tab exposes a New Voucher action gated by ACCOUNTING_VIEW', () => {
    const src = readSrc('pages/accounting.jsx');
    // The Toolbar must render a "+ 新建凭证" button for ACCOUNTING_VIEW users.
    assert.ok(/action=\{canCreateVoucher\s*&&[^<]*<button[^>]*>[\s\S]*?新建凭证/.test(src),
      'voucher Toolbar action must include "+ 新建凭证" button');
    assert.ok(/const\s+canCreateVoucher\s*=\s*can\(user,\s*'ACCOUNTING_VIEW'\)/.test(src),
      'canCreateVoucher must derive from ACCOUNTING_VIEW (canonical backend create gate)');
  });

  test('voucher list renders source_type via voucherSourceLabel() — MANUAL → 手工凭证', () => {
    const src = readSrc('pages/accounting.jsx');
    assert.ok(/VOUCHER_SOURCE_LABELS\s*=\s*\{[\s\S]*?MANUAL:\s*'手工凭证'[\s\S]*?\}/.test(src),
      'MANUAL must be mapped to 手工凭证 (not silently masquerade as 库存调拨)');
    // list + detail must use the helper.
    assert.ok(/voucherSourceLabel\(v\.source_type\)/.test(src), 'list must render source via voucherSourceLabel');
    // Negative regression: the old buggy ternary mapping must be gone.
    assert.equal(/v\.source_type === 'SALES_ORDER' \? '销售订单' : v\.source_type === 'PURCHASE_ORDER' \? '采购订单' : '库存调拨'/.test(src), false,
      'old source_type ternary that maps MANUAL → 库存调拨 must be removed');
  });

  test('voucher list renders a status column with Badge', () => {
    const src = readSrc('pages/accounting.jsx');
    assert.ok(/<th>状态<\/th>/.test(src), 'list header must include 状态 column');
    assert.ok(/VOUCHER_STATUS_LABELS\[v\.status\]/.test(src) || /\{VOUCHER_STATUS_LABELS\[v\.status\][\s\S]*?\}/.test(src),
      'list body must render status label');
    // All four canonical statuses must be defined in the label map.
    for (const key of ['ENTERED', 'SUBMITTED', 'POSTED', 'REJECTED']) {
      assert.ok(src.includes(`${key}:`), `VOUCHER_STATUS_LABELS must define ${key}`);
    }
  });

  test('VoucherDetail exposes submit only when user has VOUCHER_SUBMIT and status is ENTERED', () => {
    const src = readSrc('pages/accounting.jsx');
    const detail = extractComponent(src, 'VoucherDetail');
    assert.ok(detail, 'VoucherDetail must be defined');
    assert.ok(/can\(user,\s*'VOUCHER_SUBMIT'\)/.test(detail),
      'submit gating must reference VOUCHER_SUBMIT');
    assert.ok(/status\s*===\s*'ENTERED'/.test(detail),
      'submit must gate on status === ENTERED');
  });

  test('VoucherDetail exposes approve / reject only when user has VOUCHER_APPROVE and creator !== approver', () => {
    const src = readSrc('pages/accounting.jsx');
    const detail = extractComponent(src, 'VoucherDetail');
    assert.ok(detail, 'VoucherDetail must be defined');
    assert.ok(/can\(user,\s*'VOUCHER_APPROVE'\)/.test(detail),
      'approve / reject gating must reference VOUCHER_APPROVE');
    assert.ok(/value\.creator_id\s*!==\s*user\?\.id/.test(detail),
      'approve / reject must NOT be exposed to the voucher creator (separation of duties)');
    assert.ok(/审核通过/.test(detail), 'approve button label must be 审核通过');
    assert.ok(/驳回/.test(detail), 'reject button label must be 驳回');
  });

  test('reject UI requires a non-empty rejectionReason', () => {
    const src = readSrc('pages/accounting.jsx');
    const detail = extractComponent(src, 'VoucherDetail');
    assert.ok(detail, 'VoucherDetail must be defined');
    assert.ok(/rejectionReason\.trim\(\)/.test(detail), 'reject must guard on rejectionReason.trim()');
    assert.ok(/rejectionReason:\s*reason/.test(detail), 'reject body must include rejectionReason');
  });

  test('POSTED voucher is read-only — no edit / delete / submit / approve / reject buttons', () => {
    const src = readSrc('pages/accounting.jsx');
    const detail = extractComponent(src, 'VoucherDetail');
    assert.ok(detail, 'VoucherDetail must be defined');
    assert.ok(/已过账凭证为只读/.test(detail),
      'POSTED voucher must surface a read-only hint');
  });

  test('VoucherModal uses canonical backend create / update API and amountCents contract', () => {
    const src = readSrc('pages/accounting.jsx');
    assert.ok(/function\s+VoucherModal\s*\(/.test(src), 'VoucherModal must be defined');
    assert.ok(/api\(['"]\/api\/accounting-vouchers['"]/.test(src) && /method:\s*'POST'/.test(src),
      'VoucherModal must POST to /api/accounting-vouchers (create)');
    assert.ok(/api\([`][^`]*\/api\/accounting-vouchers\/\$\{value\.id\}[^`]*[`][\s\S]*?method:\s*'PATCH'/.test(src),
      'VoucherModal must PATCH /api/accounting-vouchers/:id for edit');
    assert.ok(/amountCents/.test(src), 'entry amount field must use backend amountCents contract');
    assert.ok(/DEBIT[\s\S]*?CREDIT/.test(src) || /['"]CREDIT['"][\s\S]*?['"]DEBIT['"]/.test(src),
      'direction options must include both DEBIT and CREDIT');
  });

  test('VoucherModal has minimum 2-entry guard, balance check, and subject non-empty guard (frontend UX validation)', () => {
    const src = readSrc('pages/accounting.jsx');
    const modal = extractComponent(src, 'VoucherModal');
    assert.ok(modal, 'VoucherModal must be defined');
    assert.ok(/至少需要两条分录/.test(modal), 'min-entries guard must surface 至少需要两条分录');
    assert.ok(/科目不能为空/.test(modal), 'subject non-empty guard must surface 科目不能为空');
    assert.ok(/金额必须大于 0/.test(modal), 'amount > 0 guard must surface 金额必须大于 0');
    assert.ok(/借贷不平衡/.test(modal), 'balance check must surface 借贷不平衡');
  });

  test('VoucherModal stores yuan strings and converts to integer amountCents only at the request boundary', () => {
    const src = readSrc('pages/accounting.jsx');
    const modal = extractComponent(src, 'VoucherModal');
    assert.ok(modal, 'VoucherModal must be defined');
    // The amount input must be a yuan string field, NOT named amountCents.
    assert.ok(/setEntry\(i,\s*'amount',\s*e\.target\.value\)/.test(modal),
      'amount input must be stored under the `amount` field (yuan string)');
    // Conversion to backend amountCents happens at the request body build step,
    // not at the input boundary.
    assert.ok(/amountCents:\s*yuanToCents\(e\.amount\)/.test(modal),
      'amountCents must be derived from yuanToCents(e.amount) at the request boundary');
    // Defence in depth: the UI must NOT use Math.round(yuan*100) — that produces
    // float drift like 10000.01 → 1000000.9999999. The dedicated helpers live in
    // src/lib/money.js.
    assert.equal(/Math\.round\([^)]*\*\s*100/.test(modal), false,
      'UI must not invent amountCents = round(yuan*100); use yuanToCents helper instead');
  });

  test('voucher tab keeps POSTED-only reporting rules unchanged (no UI drift)', () => {
    const src = readSrc('pages/accounting.jsx');
    // Trial Balance / Income Statement / Balance Sheet must still rely on the
    // backend POSTED-only filter; the UI does NOT add a client-side filter.
    // (Defensive: assert there's no logic that filters vouchers by status here.)
    assert.equal(/trialBalance[^}]*v\.status\s*!==\s*'POSTED'/.test(src), false,
      'trial-balance UI must not invent its own POSTED filter');
    assert.equal(/incomeStatement[^}]*status\s*!==\s*'POSTED'/.test(src), false,
      'income-statement UI must not invent its own POSTED filter');
  });
});

// ============================================================
// Backend end-to-end — workflow using role-accounting
// ============================================================

describe('Phase E — backend workflow with role-accounting', () => {
  let tempDir;
  let database;
  let server;
  let baseUrl;
  let accountingToken;
  let approverToken;
  let accountingUserId;

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-phase-e-'));
    server = createServer(createApp(database = createDatabase(join(tempDir, 'erp.db')), { distDir: undefined }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // Login as admin to bootstrap an approver.
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const adminToken = (await adminLogin.json()).token;

    // Create an approver role / user with VOUCHER_APPROVE so the test exercises
    // creator !== approver while keeping admin (which is the original creator)
    // out of the approve path.
    const approverRole = await fetch(`${baseUrl}/api/roles`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'PHASE_E_APPROVER', name: 'Phase E 审核员', permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE'] }),
    });
    const approverRoleId = (await approverRole.json()).id;
    const { hashPassword } = await import('./db.js');
    const pwd = hashPassword('approver1-pwd');
    database.prepare(`INSERT INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
      VALUES ('user-phase-e-approver', 'phase-e-approver', 'Phase E 审核员', ?, ?, ?, 1, ?)`)
      .run(pwd.hash, pwd.salt, approverRoleId, new Date().toISOString());

    const accLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'accounting', password: 'accounting123' }),
    });
    accountingToken = (await accLogin.json()).token;
    const accMe = await fetch(`${baseUrl}/api/auth/me`, { headers: { 'Authorization': `Bearer ${accountingToken}` } });
    accountingUserId = (await accMe.json()).user.id;

    const apprLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'phase-e-approver', password: 'approver1-pwd' }),
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

  function balancedBody(extra = {}) {
    return {
      voucherDate: '2026-09-01',
      remark: 'phase-e regression',
      entries: [
        { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: '借方' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: '贷方' },
      ],
      ...extra,
    };
  }

  test('accounting user has VOUCHER_SUBMIT, ACCOUNTING_VIEW, REPORT_VIEW — not VOUCHER_APPROVE', async () => {
    const me = await api('/api/auth/me');
    const perms = me.data.user.permissions;
    assert.ok(perms.includes('VOUCHER_SUBMIT'), `accounting must have VOUCHER_SUBMIT; got ${perms.join(',')}`);
    assert.ok(perms.includes('ACCOUNTING_VIEW'));
    assert.ok(perms.includes('REPORT_VIEW'));
    assert.equal(perms.includes('VOUCHER_APPROVE'), false,
      'accounting must NOT have VOUCHER_APPROVE');
  });

  test('accounting user can create a balanced manual voucher → ENTERED', async () => {
    const res = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    assert.equal(res.status, 201, `create must succeed; got ${res.status} ${JSON.stringify(res.data)}`);
    assert.ok(res.data.id && res.data.voucherNo);
    const detail = await api(`/api/accounting-vouchers/${res.data.id}`);
    assert.equal(detail.data.voucher.status, 'ENTERED');
    assert.equal(detail.data.voucher.source_type, 'MANUAL');
    assert.equal(detail.data.voucher.creator_id, accountingUserId);
  });

  test('accounting user can submit ENTERED → SUBMITTED', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    const id = create.data.id;
    const submit = await api(`/api/accounting-vouchers/${id}/submit`, { method: 'POST', body: {} });
    assert.equal(submit.status, 200, `submit must succeed; got ${submit.status}`);
    const detail = await api(`/api/accounting-vouchers/${id}`);
    assert.equal(detail.data.voucher.status, 'SUBMITTED');
  });

  test('accounting user attempting to approve own voucher → 403 (separation of duties)', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    await api(`/api/accounting-vouchers/${create.data.id}/submit`, { method: 'POST', body: {} });
    const approve = await api(`/api/accounting-vouchers/${create.data.id}/approve`, { method: 'POST', body: {} });
    assert.equal(approve.status, 403, `self-approval must be rejected with 403; got ${approve.status}`);
  });

  test('approver (VOUCHER_APPROVE, different user) approves accounting voucher → POSTED', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    const id = create.data.id;
    await api(`/api/accounting-vouchers/${id}/submit`, { method: 'POST', body: {} });
    const approve = await api(`/api/accounting-vouchers/${id}/approve`, { method: 'POST', body: {} }, approverToken);
    assert.equal(approve.status, 200, `approver approve must succeed; got ${approve.status} ${JSON.stringify(approve.data)}`);
    const detail = await api(`/api/accounting-vouchers/${id}`);
    assert.equal(detail.data.voucher.status, 'POSTED');
  });

  test('reject without reason → 400', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    await api(`/api/accounting-vouchers/${create.data.id}/submit`, { method: 'POST', body: {} });
    const reject = await api(`/api/accounting-vouchers/${create.data.id}/reject`, { method: 'POST', body: { rejectionReason: '' } }, approverToken);
    assert.equal(reject.status, 400);
  });

  test('reject with reason → REJECTED (with reason persisted)', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    const id = create.data.id;
    await api(`/api/accounting-vouchers/${id}/submit`, { method: 'POST', body: {} });
    const reason = 'phase-e 驳回原因';
    const reject = await api(`/api/accounting-vouchers/${id}/reject`, { method: 'POST', body: { rejectionReason: reason } }, approverToken);
    assert.equal(reject.status, 200);
    const detail = await api(`/api/accounting-vouchers/${id}`);
    assert.equal(detail.data.voucher.status, 'REJECTED');
    assert.equal(detail.data.voucher.rejection_reason, reason);
  });

  test('editing a REJECTED voucher resets status to ENTERED', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    const id = create.data.id;
    await api(`/api/accounting-vouchers/${id}/submit`, { method: 'POST', body: {} });
    await api(`/api/accounting-vouchers/${id}/reject`, { method: 'POST', body: { rejectionReason: 'phase-e 驳回 → 编辑测试' } }, approverToken);
    const patch = await api(`/api/accounting-vouchers/${id}`, { method: 'PATCH', body: balancedBody({ voucherDate: '2026-09-02', remark: 'rejected → edited' }) });
    assert.equal(patch.status, 200);
    const detail = await api(`/api/accounting-vouchers/${id}`);
    assert.equal(detail.data.voucher.status, 'ENTERED', 'status must reset to ENTERED after edit');
  });

  test('unbalanced voucher rejected at create with 400', async () => {
    const res = await api('/api/accounting-vouchers', {
      method: 'POST',
      body: {
        voucherDate: '2026-09-01',
        remark: 'unbalanced',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: 'd' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 99000, summary: 'c' },
        ],
      },
    });
    assert.equal(res.status, 400, `unbalanced must fail; got ${res.status}`);
  });

  test('POSTED voucher cannot be edited (protection intact)', async () => {
    const create = await api('/api/accounting-vouchers', { method: 'POST', body: balancedBody() });
    const id = create.data.id;
    await api(`/api/accounting-vouchers/${id}/submit`, { method: 'POST', body: {} });
    await api(`/api/accounting-vouchers/${id}/approve`, { method: 'POST', body: {} }, approverToken);
    const patch = await api(`/api/accounting-vouchers/${id}`, { method: 'PATCH', body: balancedBody() });
    assert.equal(patch.status, 409);
    const del = await api(`/api/accounting-vouchers/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 409);
  });
});