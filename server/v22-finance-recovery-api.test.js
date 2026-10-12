import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';
import { applyTreasuryMovement } from './modules/finance-treasury-movement.js';

let temp; let db; let server; let base; const tokens = {};
const request = (path, role, method = 'GET', body) => fetch(base + path, {
  method,
  headers: { ...(role ? { authorization: `Bearer ${tokens[role]}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'finance-recovery-api-'));
  db = createDatabase(join(temp, 'erp.db'));
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at,code,opening_balance_cents,accounting_role,accounting_subject_id)
    VALUES('finance-test-bank','测试银行','FIN-001','财务测试账户','BANK',100000,'CNY',1,?,?,'FIN-001',100000,'BANK','subject-002')`).run(now, now);
  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [role, username, password] of [['accounting', 'accounting', 'accounting123'], ['admin', 'admin', 'admin123'], ['sales', 'sales', 'sales123']]) {
    const response = await request('/api/auth/login', null, 'POST', { username, password });
    tokens[role] = (await response.json()).token;
  }
});

after(async () => {
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
  db.close(); rmSync(temp, { recursive: true, force: true });
});

test('Finance bounded permissions are seeded and fail closed by role', async () => {
  const financeCodes = PERMISSIONS.map(([code]) => code).filter((code) => code.startsWith('FINANCE_'));
  assert.equal(financeCodes.length, 20);
  assert.equal(new Set(financeCodes).size, 20);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM role_permissions WHERE role_id='role-accounting' AND permission_code LIKE 'FINANCE_%'").get().n, 20);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM role_permissions WHERE role_id='role-sales' AND permission_code LIKE 'FINANCE_%'").get().n, 0);
  assert.equal((await request('/api/finance/parameters', 'accounting')).status, 200);
  assert.equal((await request('/api/finance/parameters', 'sales')).status, 403);
});

test('notes settlement and payment request execution create canonical Treasury movements only at execution', async () => {
  const note = await (await request('/api/finance/notes', 'accounting', 'POST', {
    direction: 'RECEIVABLE', faceAmountCents: 12000, issueDate: '2026-10-01', dueDate: '2026-10-31', drawerName: '客户甲', payeeName: '本公司', bankName: '测试银行',
  })).json();
  assert.equal((await request(`/api/finance/notes/${note.id}/hold`, 'accounting', 'POST', {})).status, 200);
  assert.equal((await request(`/api/finance/notes/${note.id}/settle`, 'accounting', 'POST', { businessDate: '2026-10-11', settlementAccountId: 'finance-test-bank' })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE source_type='NOTE_SETTLEMENT' AND source_id=?").get(note.id).n, 1);

  const created = await (await request('/api/finance/payment-requests', 'accounting', 'POST', { side: 'AP', partyId: 'supplier-001', amountCents: 18000, businessDate: '2026-10-11', reason: '到期付款' })).json();
  assert.equal((await request(`/api/finance/payment-requests/${created.id}/submit`, 'accounting', 'POST', {})).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE source_type='PAYMENT_REQUEST' AND source_id=?").get(created.id).n, 0);
  assert.equal((await request(`/api/finance/payment-requests/${created.id}/approve`, 'admin', 'POST', {})).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE source_type='PAYMENT_REQUEST' AND source_id=?").get(created.id).n, 0);
  assert.equal((await request(`/api/finance/payment-requests/${created.id}/execute`, 'accounting', 'POST', { settlementAccountId: 'finance-test-bank', paymentMethod: 'BANK' })).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE source_type='PAYMENT_REQUEST' AND source_id=?").get(created.id).n, 1);
});

test('cash count records variance without mutating canonical cash balance', async () => {
  const before = db.prepare("SELECT balance_cents FROM bank_accounts WHERE id='finance-cash-default'").get().balance_cents;
  const movementCount = db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE settlement_account_id='finance-cash-default'").get().n;
  const created = await (await request('/api/finance/cash-counts', 'accounting', 'POST', { settlementAccountId: 'finance-cash-default', countDate: '2026-10-11', lines: [{ denomination: '100.00', countQuantity: 2, totalCents: 20000 }] })).json();
  assert.equal(created.bookAmountCents, before); assert.equal(created.physicalAmountCents, 20000);
  assert.equal((await request(`/api/finance/cash-counts/${created.id}/confirm`, 'accounting', 'POST', {})).status, 200);
  assert.equal(db.prepare("SELECT balance_cents FROM bank_accounts WHERE id='finance-cash-default'").get().balance_cents, before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_treasury_movements WHERE settlement_account_id='finance-cash-default'").get().n, movementCount);
});

test('bank import is idempotent and reconciliation preserves Treasury truth with derived unmatched balances', async () => {
  let paymentMovement = db.prepare("SELECT * FROM finance_treasury_movements WHERE source_type='PAYMENT_REQUEST' ORDER BY created_at DESC LIMIT 1").get();
  if (!paymentMovement) {
    applyTreasuryMovement(db, { settlementAccountId: 'finance-test-bank', direction: 'OUT', amountCents: 18000,
      businessDate: '2026-10-11', sourceType: 'PAYMENT_REQUEST', sourceId: 'standalone-bank-recon',
      idempotencyKey: 'PAYMENT_REQUEST:standalone-bank-recon', createdBy: 'user-admin' });
    paymentMovement = db.prepare("SELECT * FROM finance_treasury_movements WHERE source_id='standalone-bank-recon'").get();
  }
  const payload = { fileName: 'statement-2026-10.csv', bankAccountId: 'finance-test-bank', statementNo: 'BST-202610', statementDate: '2026-10-11', period: '2026-10', openingBalanceCents: 112000, closingBalanceCents: 94000, lines: [{ transactionDate: '2026-10-11', valueDate: '2026-10-11', amountCents: 18000, direction: 'OUT', balanceCents: 94000, counterparty: '供应商一', bankReference: 'BANK-PAY-1', description: '付款申请执行' }] };
  const imported = await (await request('/api/finance/bank-statements/import', 'accounting', 'POST', payload)).json();
  const replay = await (await request('/api/finance/bank-statements/import', 'accounting', 'POST', payload)).json();
  assert.equal(replay.replayed, true); assert.equal(replay.statementId, imported.statementId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM bank_statement_items WHERE statement_id=?').get(imported.statementId).n, 1);
  const movementCount = db.prepare('SELECT COUNT(*) n FROM finance_treasury_movements').get().n;
  const reconciliation = await (await request('/api/finance/bank-reconciliations', 'accounting', 'POST', { settlementAccountId: 'finance-test-bank', statementId: imported.statementId })).json();
  const line = db.prepare('SELECT id FROM bank_statement_items WHERE statement_id=?').get(imported.statementId);
  assert.equal((await request(`/api/finance/bank-reconciliations/${reconciliation.id}/matches`, 'accounting', 'POST', { statementLineId: line.id, treasuryMovementId: paymentMovement.id, matchedAmountCents: 18000, matchMethod: 'MANUAL' })).status, 201);
  const unmatched = await (await request(`/api/finance/bank-reconciliations/${reconciliation.id}/unmatched`, 'accounting')).json();
  assert.equal(unmatched.bankUnmatched.length, 0);
  assert.ok(unmatched.bookUnmatched.every((row) => row.id !== paymentMovement.id));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM finance_treasury_movements').get().n, movementCount);
});
