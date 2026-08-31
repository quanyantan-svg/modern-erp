import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { hashPassword } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let creatorToken;  // User with VOUCHER_SUBMIT + ACCOUNTING_VIEW
let approverToken; // User with VOUCHER_APPROVE + ACCOUNTING_VIEW
let unauthorizedToken; // User without VOUCHER_APPROVE

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-voucher-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  
  // Login as admin to get permissions
  const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const adminData = await adminRes.json();
  const adminToken = adminData.token;
  
  // Create a test role for voucher creator (VOUCHER_SUBMIT + ACCOUNTING_VIEW)
  const creatorRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      code: 'VOUCHER_CREATOR',
      name: '凭证录入员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_SUBMIT']
    }),
  });
  const creatorRole = await creatorRoleRes.json();
  
  // Create a test user with creator role
  const password = hashPassword('creator123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-voucher-creator', 'voucher-creator', '凭证录入员', password.hash, password.salt, creatorRole.id, new Date().toISOString());
  
  
  // Create approver role with VOUCHER_APPROVE
  const approverRoleRes = await fetch(`${baseUrl}/api/roles`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      code: 'VOUCHER_APPROVER',
      name: '凭证审核员',
      permissions: ['ACCOUNTING_VIEW', 'VOUCHER_APPROVE']
    }),
  });
  const approverRole = await approverRoleRes.json();
  
  // Create approver user
  const approverPassword = hashPassword('approver123');
  database.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
    .run('user-voucher-approver', 'voucher-approver', '凭证审核员', approverPassword.hash, approverPassword.salt, approverRole.id, new Date().toISOString());
  
  // Login as creator (voucher-creator user with VOUCHER_CREATOR role)
  const creatorRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'voucher-creator', password: 'creator123' }),
  });
  const creatorData = await creatorRes.json();
  creatorToken = creatorData.token;
  
  // Login as approver (new user with VOUCHER_APPROVE)
  const approverRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'voucher-approver', password: 'approver123' }),
  });
  const approverData = await approverRes.json();
  approverToken = approverData.token;
  
  // Login as warehouse user (no VOUCHER_APPROVE)
  const unauthorizedRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'warehouse', password: 'warehouse123' }),
  });
  const unauthorizedData = await unauthorizedRes.json();
  unauthorizedToken = unauthorizedData.token;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function createVoucher(token, entries) {
  const defaultEntries = entries || [
    { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: 'Test debit entry' },
    { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: 'Test credit entry' }
  ];
  
  const res = await fetch(`${baseUrl}/api/accounting-vouchers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      voucherDate: '2026-08-01',
      remark: 'Test voucher for multi-user workflow',
      entries: defaultEntries
    }),
  });
  const data = await res.json();
  return { status: res.status, ...data };
}

async function getVoucher(token, voucherId) {
  const res = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return { status: res.status, ...(await res.json()) };
}

describe('Voucher Workflow - Multi-User Tests', () => {
  
  // ============ Task 2: Multi-user successful approval test ============
  describe('Task 2: Successful Multi-User Approval', () => {
    test('Creator A creates voucher → submits → Approver B approves → POSTED', async () => {
      // Step 1-2: Creator creates voucher
      const result = await createVoucher(creatorToken);
      assert.equal(result.status, 201, 'Voucher creation should succeed');
      assert.ok(result.id, 'Should return voucher ID');
      const voucherId = result.id;
      
      // Step 3: Confirm status = ENTERED
      let voucher = await getVoucher(creatorToken, voucherId);
      assert.equal(voucher.voucher.status, 'ENTERED', 'New voucher should be ENTERED');
      assert.equal(voucher.voucher.source_type, 'MANUAL', 'Should be MANUAL source type');
      
      // Step 4: Submit voucher
      const submitRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      assert.equal(submitRes.status, 200, 'Submit should succeed');
      
      // Step 5: Confirm status = SUBMITTED
      voucher = await getVoucher(creatorToken, voucherId);
      assert.equal(voucher.voucher.status, 'SUBMITTED', 'After submit, status should be SUBMITTED');
      assert.ok(voucher.voucher.submitted_at, 'submitted_at should be set');
      assert.ok(voucher.voucher.submitted_by, 'submitted_by should be set');
      
      // Step 6-7: Approver approves
      const approveRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${approverToken}`,
          'content-type': 'application/json',
        },
      });
      assert.equal(approveRes.status, 200, 'Approval should succeed');
      
      // Step 8: Confirm status = POSTED
      voucher = await getVoucher(approverToken, voucherId);
      assert.equal(voucher.voucher.status, 'POSTED', 'After approval, status should be POSTED');
      assert.ok(voucher.voucher.approver_id, 'approver_id should be set');
      assert.ok(voucher.voucher.approved_at, 'approved_at should be set');
      
      // Step 10: Verify audit records
      const auditRes = await fetch(`${baseUrl}/api/audit-logs?entity_type=ACCOUNTING_VOUCHER&entity_id=${voucherId}`, {
        headers: { 'Authorization': `Bearer ${approverToken}` },
      });
      const auditData = await auditRes.json();
      assert.ok(auditData.logs, 'Should return audit logs');
      
      const actions = auditData.logs.map(l => l.action);
      assert.ok(actions.includes('CREATE'), 'Should have CREATE audit record');
      assert.ok(actions.includes('SUBMIT'), 'Should have SUBMIT audit record');
      assert.ok(actions.includes('APPROVE'), 'Should have APPROVE audit record');
    });
  });
  
  // ============ Task 3: Creator self-approval test ============
  describe('Task 3: Creator Self-Approval Rejection', () => {
    test('Creator cannot approve their own voucher', async () => {
      // Creator creates voucher
      const result = await createVoucher(creatorToken);
      assert.equal(result.status, 201);
      const voucherId = result.id;
      
      // Creator submits
      const submitRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      assert.equal(submitRes.status, 200, 'Submit should succeed');
      
      // Creator attempts to approve (should fail)
      const approveRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      
      // Should be rejected with 403
      assert.equal(approveRes.status, 403, 'Self-approval should be rejected with 403');
      const errorData = await approveRes.json();
      assert.ok(errorData.error, 'Should return error message');
      
      // Status should remain SUBMITTED
      const voucher = await getVoucher(creatorToken, voucherId);
      assert.equal(voucher.voucher.status, 'SUBMITTED', 'Status should remain SUBMITTED');
      
      // No APPROVE audit should exist from creator
      const auditRes = await fetch(`${baseUrl}/api/audit-logs?entity_type=ACCOUNTING_VOUCHER&entity_id=${voucherId}`, {
        headers: { 'Authorization': `Bearer ${approverToken}` },
      });
      const auditData = await auditRes.json();
      const creatorApproveAudit = auditData.logs.find(l => l.action === 'APPROVE' && l.user_id === 'user-sales');
      assert.ok(!creatorApproveAudit, 'No approval audit from creator');
    });
  });
  
  // ============ Task 4: Unauthorized approver test ============
  describe('Task 4: Unauthorized Approval Rejection', () => {
    test('User without VOUCHER_APPROVE cannot approve', async () => {
      // Creator creates and submits voucher
      const result = await createVoucher(creatorToken);
      assert.equal(result.status, 201);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      
      // Unauthorized user attempts to approve
      const approveRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${unauthorizedToken}`,
          'content-type': 'application/json',
        },
      });
      
      // Should be rejected (403 Forbidden due to permission check)
      assert.equal(approveRes.status, 403, 'Unauthorized approval should be rejected with 403');
      
      // Status should remain SUBMITTED
      const voucher = await getVoucher(approverToken, voucherId);
      assert.equal(voucher.voucher.status, 'SUBMITTED', 'Status should remain SUBMITTED');
    });
  });
  
  // ============ Task 5: Rejection and correction workflow ============
  describe('Task 5: Rejection and Correction Workflow', () => {
    test('Creator A submits → Approver B rejects → Creator A edits → resubmits', async () => {
      // Creator creates and submits
      const result = await createVoucher(creatorToken);
      assert.equal(result.status, 201);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      
      // Verify SUBMITTED
      let voucher = await getVoucher(creatorToken, voucherId);
      assert.equal(voucher.voucher.status, 'SUBMITTED');
      
      // Approver rejects with reason
      const rejectRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${approverToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rejectionReason: '金额错误，需要核对' }),
      });
      assert.equal(rejectRes.status, 200, 'Rejection should succeed');
      
      // Verify REJECTED
      voucher = await getVoucher(approverToken, voucherId);
      assert.equal(voucher.voucher.status, 'REJECTED', 'Status should be REJECTED');
      assert.equal(voucher.voucher.rejection_reason, '金额错误，需要核对', 'Rejection reason should be set');
      
      // Verify REJECT audit includes reason
      const auditRes = await fetch(`${baseUrl}/api/audit-logs?entity_type=ACCOUNTING_VOUCHER&entity_id=${voucherId}`, {
        headers: { 'Authorization': `Bearer ${approverToken}` },
      });
      const auditData = await auditRes.json();
      const rejectAudit = auditData.logs.find(l => l.action === 'REJECT');
      assert.ok(rejectAudit, 'Should have REJECT audit record');
      assert.ok(rejectAudit.detail.includes('金额错误'), 'Audit should include rejection reason');
      
      // Creator edits rejected voucher
      const updateRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          voucherDate: '2026-08-02',
          remark: '已更正金额',
          entries: [
            { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 150000, summary: '更正后借方' },
            { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 150000, summary: '更正后贷方' }
          ]
        }),
      });
      assert.equal(updateRes.status, 200, 'Edit should succeed');
      
      // Verify status reset to ENTERED
      voucher = await getVoucher(creatorToken, voucherId);
      assert.equal(voucher.voucher.status, 'ENTERED', 'Status should be reset to ENTERED after edit');
      
      // Creator resubmits
      const resubmitRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      assert.equal(resubmitRes.status, 200, 'Resubmit should succeed');
      
      // Verify SUBMITTED again
      voucher = await getVoucher(creatorToken, voucherId);
      assert.equal(voucher.voucher.status, 'SUBMITTED', 'Status should be SUBMITTED again');
      
      // Approver approves
      const approveRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${approverToken}`,
          'content-type': 'application/json',
        },
      });
      assert.equal(approveRes.status, 200, 'Final approval should succeed');
      
      // Verify POSTED
      voucher = await getVoucher(approverToken, voucherId);
      assert.equal(voucher.voucher.status, 'POSTED', 'Status should be POSTED');
    });
  });
  
  // ============ Task 6: Audit verification ============
  describe('Task 6: Audit Verification', () => {
    test('Successful approval audit captures all required information', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      // Submit
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      
      // Approve
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${approverToken}`,
          'content-type': 'application/json',
        },
      });
      
      // Get audit logs
      const auditRes = await fetch(`${baseUrl}/api/audit-logs?entity_type=ACCOUNTING_VOUCHER&entity_id=${voucherId}`, {
        headers: { 'Authorization': `Bearer ${approverToken}` },
      });
      const auditData = await auditRes.json();
      
      // Verify audit record structure
      const approveAudit = auditData.logs.find(l => l.action === 'APPROVE');
      assert.ok(approveAudit, 'Should have APPROVE audit record');
      assert.ok(approveAudit.id, 'Audit record should have id');
      assert.ok(approveAudit.user_id, 'Audit record should have user_id');
      assert.ok(approveAudit.action, 'Audit record should have action');
      assert.ok(approveAudit.entity_type, 'Audit record should have entity_type');
      assert.ok(approveAudit.entity_id, 'Audit record should have entity_id');
      assert.ok(approveAudit.created_at, 'Audit record should have timestamp');
      assert.ok(approveAudit.detail, 'Audit record should have detail');
    });
    
    test('Rejection audit captures rejection reason', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creatorToken}`,
          'content-type': 'application/json',
        },
      });
      
      const rejectReason = '测试驳回原因ABC123';
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${approverToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ rejectionReason: rejectReason }),
      });
      
      const auditRes = await fetch(`${baseUrl}/api/audit-logs?entity_type=ACCOUNTING_VOUCHER&entity_id=${voucherId}`, {
        headers: { 'Authorization': `Bearer ${approverToken}` },
      });
      const auditData = await auditRes.json();
      
      const rejectAudit = auditData.logs.find(l => l.action === 'REJECT');
      assert.ok(rejectAudit, 'Should have REJECT audit record');
      assert.ok(rejectAudit.detail.includes(rejectReason), 'Audit detail should include rejection reason');
    });
  });
  
  // ============ Protection tests ============
  describe('Voucher Protection', () => {
    test('POSTED voucher cannot be edited', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      // Submit and approve
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
      });
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${approverToken}`, 'content-type': 'application/json' },
      });
      
      // Attempt to edit POSTED voucher
      const updateRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ remark: 'Trying to edit', entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: 'Test' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: 'Test' }
        ]}),
      });
      
      assert.equal(updateRes.status, 409, 'POSTED voucher cannot be edited');
    });
    
    test('POSTED voucher cannot be deleted', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
      });
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${approverToken}`, 'content-type': 'application/json' },
      });
      
      const deleteRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${creatorToken}` },
      });
      
      assert.equal(deleteRes.status, 409, 'POSTED voucher cannot be deleted');
    });
    
    test('SUBMITTED voucher cannot be edited', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
      });
      
      const updateRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ remark: 'Trying to edit', entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 100000, summary: 'Test' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 100000, summary: 'Test' }
        ]}),
      });
      
      assert.equal(updateRes.status, 409, 'SUBMITTED voucher cannot be edited');
    });
  });
  
  // ============ Invalid transition tests ============
  describe('Invalid Transitions', () => {
    test('ENTERED voucher cannot be approved', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      const approveRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${approverToken}`, 'content-type': 'application/json' },
      });
      
      assert.equal(approveRes.status, 409, 'ENTERED voucher cannot be approved');
    });
    
    test('ENTERED voucher cannot be rejected', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      const rejectRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${approverToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ rejectionReason: 'Test' }),
      });
      
      assert.equal(rejectRes.status, 409, 'ENTERED voucher cannot be rejected');
    });
    
    test('Empty rejection reason is rejected', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
      });
      
      const rejectRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${approverToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ rejectionReason: '' }),
      });
      
      assert.equal(rejectRes.status, 400, 'Empty rejection reason should fail');
    });
    
    test('Cannot submit already SUBMITTED voucher', async () => {
      const result = await createVoucher(creatorToken);
      const voucherId = result.id;
      
      await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
      });
      
      const resubmitRes = await fetch(`${baseUrl}/api/accounting-vouchers/${voucherId}/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${creatorToken}`, 'content-type': 'application/json' },
      });
      
      assert.equal(resubmitRes.status, 409, 'Cannot submit SUBMITTED voucher');
    });
  });
});

describe('Reporting Compatibility', () => {
  let reportBaseUrl;
  let reportTempDir;
  let reportServer;
  let reportDatabase;
  let reportApproverToken;
  
  before(async () => {
    reportTempDir = mkdtempSync(join(tmpdir(), 'modern-erp-report-test-'));
    reportDatabase = createDatabase(join(reportTempDir, 'erp.db'));
    reportServer = createServer(createApp(reportDatabase, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => reportServer.listen(0, '127.0.0.1', resolveListen));
    reportBaseUrl = `http://127.0.0.1:${reportServer.address().port}`;
    
    // Login as admin
    const adminRes = await fetch(`${reportBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const adminData = await adminRes.json();
    reportApproverToken = adminData.token;
  });
  
  after(async () => {
    await new Promise((resolveClose, reject) => reportServer.close((error) => error ? reject(error) : resolveClose()));
    reportDatabase.close();
    rmSync(reportTempDir, { recursive: true, force: true });
  });
  
  async function createAndApproveVoucher(amount, period, token) {
    const res = await fetch(`${reportBaseUrl}/api/accounting-vouchers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        voucherDate: `${period}-15`,
        remark: 'Report test',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: amount, summary: 'Test debit' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: amount, summary: 'Test credit' }
        ]
      }),
    });
    const data = await res.json();
    
    // Submit and approve
    await fetch(`${reportBaseUrl}/api/accounting-vouchers/${data.id}/submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    });
    await fetch(`${reportBaseUrl}/api/accounting-vouchers/${data.id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    });
    
    return data.id;
  }
  
  test('Trial balance only includes POSTED vouchers', async () => {
    // Create voucher but do not approve (status will be SUBMITTED)
    const res = await fetch(`${reportBaseUrl}/api/accounting-vouchers`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${reportApproverToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        voucherDate: '2026-07-15',
        remark: 'Not approved',
        entries: [
          { subjectId: 'subject-001', direction: 'DEBIT', amountCents: 50000, summary: 'Test' },
          { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: 'Test' }
        ]
      }),
    });
    
    // Create and approve another voucher
    await createAndApproveVoucher(100000, '2026-07', reportApproverToken);
    
    // Get trial balance for July
    const trialRes = await fetch(`${reportBaseUrl}/api/reports/trial-balance?period=2026-07`, {
      headers: { 'Authorization': `Bearer ${reportApproverToken}` },
    });
    assert.equal(trialRes.status, 200, 'Trial balance should work');
    const trial = await trialRes.json();
    assert.ok(trial.trialBalance, 'Should return trial balance data');
  });
  
  test('Financial summary only includes POSTED vouchers', async () => {
    const summaryRes = await fetch(`${reportBaseUrl}/api/reports/financial-summary?period=2026-08`, {
      headers: { 'Authorization': `Bearer ${reportApproverToken}` },
    });
    assert.equal(summaryRes.status, 200, 'Financial summary should work');
    const summary = await summaryRes.json();
    assert.ok(typeof summary.revenue === 'number', 'Should return revenue');
    assert.ok(typeof summary.expense === 'number', 'Should return expense');
  });
});