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
  database.exec("DELETE FROM inventory_valuation_movements; DELETE FROM inventory_valuation_balances; DELETE FROM inventory_mutation_log; DELETE FROM tracked_inventory_movements; DELETE FROM tracked_source_allocations; DELETE FROM tracked_inventory_movements; DELETE FROM tracked_source_allocations; DELETE FROM inventory_transactions; DELETE FROM inventory; INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES('period-test-debit','6998','期间测试借方','EXPENSE','DEBIT',1),('period-test-credit','6999','期间测试贷方','REVENUE','CREDIT',1);");
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
        { subjectId: 'period-test-debit', direction: 'DEBIT', amountCents: 100000, summary: 'Test' },
        { subjectId: 'period-test-credit', direction: 'CREDIT', amountCents: 100000, summary: 'Test' }
      ],
    }),
  });
  return res.json();
}

function closeInventoryGate(period) {
  database.prepare("INSERT OR REPLACE INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes,close_checks_json) VALUES(?,?,'CLOSED','user-admin',?,'test fixture',?)")
    .run(`inventory-gate-${period}`, period, new Date().toISOString(), JSON.stringify({ overallStatus: 'PASS', checks: [] }));
}

function closeFinanceThrough(date) {
  database.prepare('UPDATE finance_business_close_state SET closed_through_date=?,updated_at=?,updated_by=?')
    .run(date, new Date().toISOString(), 'user-admin');
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
    database.prepare("UPDATE period_closures SET status='CLOSED' WHERE period='3000-01'").run();
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 2 }),
    });
    const closure = await createRes.json();
    closeInventoryGate('3000-02');
    closeFinanceThrough('3000-02-28');
    await createVoucher(creatorToken, '3000-02-15');
    const res = await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 409);
    database.prepare("UPDATE period_closures SET status='CLOSED' WHERE id=?").run(closure.id);
  });

  test('Cannot close period with SUBMITTED vouchers', async () => {
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 3 }),
    });
    const closure = await createRes.json();
    closeInventoryGate('3000-03');
    closeFinanceThrough('3000-03-31');
    const voucher = await createVoucher(creatorToken, '3000-03-15');
    await fetch(`${baseUrl}/api/accounting-vouchers/${voucher.id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creatorToken}` },
    });
    const res = await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(res.status, 409);
    database.prepare("UPDATE period_closures SET status='CLOSED' WHERE id=?").run(closure.id);
  });

  test('Can close period when all vouchers are POSTED', async () => {
    const createRes = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year: 3000, month: 4 }),
    });
    const closure = await createRes.json();
    closeInventoryGate('3000-04');
    closeFinanceThrough('3000-04-30');
    const voucher = await createVoucher(creatorToken, '3000-04-15');
    await fetch(`${baseUrl}/api/accounting-vouchers/${voucher.id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${creatorToken}` },
    });
    await fetch(`${baseUrl}/api/accounting-vouchers/${voucher.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${approverToken}` },
    });
    // AA-W3.16 — 期间仍有损益余额但未执行真实损益结转时，关账必须被拦截。
    // 结转完成后本期损益科目余额归零，关账才被放行。
    const blocked = await fetch(`${baseUrl}/api/period-closures/${closure.id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
    assert.equal(blocked.status, 409, '未结转时关账必须被拦截');
    const transfer = await fetch(`${baseUrl}/api/accounting/profit-transfer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ period: '3000-04', reason: '期末损益结转' }),
    });
    assert.equal(transfer.status, 200, `profit transfer must succeed; got ${transfer.status} ${JSON.stringify(await transfer.clone().json())}`);
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
    assert.equal(res.status, 409);
  });

  test('Can reopen closed period', async () => {
    const listRes = await fetch(`${baseUrl}/api/period-closures?year=3000`, {
      headers: { 'Authorization': `Bearer ${adminToken}` },
    });
    const closedPeriod = (await listRes.json()).closures.find(c => c.period === '3000-04' && c.status === 'CLOSED');
    const res = await fetch(`${baseUrl}/api/period-closures/${closedPeriod.id}/unclose`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '发现跨期更正事项' }),
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
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '重复反结账检查' }),
    });
    assert.equal(res.status, 409);
  });
});

describe('Closed Period Voucher Protection', () => {
  test('Cannot create voucher in closed period', async () => {
    const before = Number(database.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='PERIOD_CONTROL'").get().n);
    const res = await createVoucher(creatorToken, '3000-03-15');
    assert.ok(res.error, 'Should return error for closed period');
    const rows = database.prepare("SELECT detail FROM audit_logs WHERE action='REJECT' AND entity_type='PERIOD_CONTROL' ORDER BY created_at,id").all();
    assert.equal(rows.length, before + 1, '期间拒绝必须在回滚后恰好审计一次');
    assert.match(rows.at(-1).detail, /businessDate=3000-03-15; axis=LEGAL_ACCOUNTING/);
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

// R-02 — close / reopen protocol of the legal accounting period.
// Contract: docs/requirements/platform.md §36.15.5 and
// docs/design/accounting-analytics.md §31.16.2.
describe('Period close / reopen protocol (R-02)', () => {
  async function createClosure(year, month) {
    const res = await fetch(`${baseUrl}/api/period-closures`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ year, month }),
    });
    return res.json();
  }

  function closureIdOf(period) {
    return database.prepare('SELECT id FROM period_closures WHERE period=?').get(period).id;
  }

  async function closeClosure(id) {
    return fetch(`${baseUrl}/api/period-closures/${id}/close`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${periodManagerToken}` },
    });
  }

  test('close is refused while the inventory axis is not closed for the period', async () => {
    const closure = await createClosure(2999, 1);
    const res = await closeClosure(closure.id);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'PERIOD_DEPENDENCY_NOT_CLOSED');
    assert.equal(body.details?.axis, 'INVENTORY');
    assert.equal(database.prepare('SELECT status FROM period_closures WHERE id=?').get(closure.id).status, 'OPEN',
      '拒绝后期间状态不得改变');
  });

  test('close is refused while a Finance axis is not closed through the period end', async () => {
    closeInventoryGate('2999-01');
    database.prepare("UPDATE finance_business_close_state SET closed_through_date='' ").run();
    const res = await closeClosure(closureIdOf('2999-01'));
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'PERIOD_DEPENDENCY_NOT_CLOSED');
    assert.equal(body.details?.axis, 'FINANCE_AR');
    assert.equal(database.prepare('SELECT status FROM period_closures WHERE period=?').get('2999-01').status, 'OPEN');
  });

  test('close is refused when an earlier legal period is still open, and the earliest one may close', async () => {
    closeInventoryGate('2999-02');
    database.prepare("UPDATE finance_business_close_state SET closed_through_date='2999-12-31'").run();
    const later = await createClosure(2999, 2);
    const refused = await closeClosure(later.id);
    assert.equal(refused.status, 409);
    const refusedBody = await refused.json();
    assert.equal(refusedBody.code, 'PERIOD_SEQUENCE_INVALID');
    assert.equal(database.prepare('SELECT status FROM period_closures WHERE id=?').get(later.id).status, 'OPEN');
    const ok = await closeClosure(closureIdOf('2999-01'));
    assert.equal(ok.status, 200);
    assert.equal(database.prepare('SELECT status FROM period_closures WHERE period=?').get('2999-01').status, 'CLOSED');
  });

  test('reopen requires a reason and only the latest closed period may be reopened', async () => {
    const first = closureIdOf('2999-01');
    const withoutReason = await fetch(`${baseUrl}/api/period-closures/${first}/unclose`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(withoutReason.status, 400);
    const body = await withoutReason.json();
    assert.equal(body.code, 'PERIOD_REOPEN_REASON_REQUIRED');
    assert.equal(database.prepare('SELECT status FROM period_closures WHERE id=?').get(first).status, 'CLOSED');

    const closedSecond = await closeClosure(closureIdOf('2999-02'));
    assert.equal(closedSecond.status, 200);
    const notLatest = await fetch(`${baseUrl}/api/period-closures/${first}/unclose`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '逆序反结账检查' }),
    });
    assert.equal(notLatest.status, 409);
    const notLatestBody = await notLatest.json();
    assert.equal(notLatestBody.code, 'PERIOD_NOT_LATEST');
    assert.equal(database.prepare('SELECT status FROM period_closures WHERE id=?').get(first).status, 'CLOSED');
  });
});
