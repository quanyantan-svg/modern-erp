// Accounting & Analytics Domain Closure — HTTP fixture.
//
// Owns one temporary SQLite file and one ephemeral HTTP server. It never
// touches a project / development / production database and never connects to
// MySQL.
//
// The fixture exposes the canonical role tokens so the AA-W1 / AA-W2 contract
// tests can assert SOD behaviour (a repairer must not be the source reviewer,
// a submitter must not be the approver, and so on).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../app.js';
import { createDatabase } from '../db.js';

export async function createAccountingFixture(prefix = 'erp-accounting-') {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = 'http://127.0.0.1:' + server.address().port;

  async function request(method, path, token = null, body, extraHeaders = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }

  async function login(username, password) {
    const result = await request('POST', '/api/auth/login', null, { username, password });
    assert.equal(result.status, 200, result.data.error);
    return result.data.token;
  }

  const tokens = {
    admin: await login('admin', 'admin123'),
    accounting: await login('accounting', 'accounting123'),
    reviewer: await login('reviewer', 'review123'),
    sales: await login('sales', 'sales123'),
  };

  async function close() {
    await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { db, baseUrl, request, tokens, close };
}

/**
 * Seed the account-role mappings the AA-W2 template path needs. The mappings
 * are the canonical `account_role_mappings` rows; the helper only creates the
 * subjects and mappings that the fixture does not already provide.
 */
export function seedAccountingRoles(db, roles) {
  const now = new Date().toISOString();
  const subject = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get('ROLE_' + roles.code);
  let subjectId = subject?.id;
  if (!subjectId) {
    subjectId = 'acc-role-' + roles.code.toLowerCase();
    db.prepare('INSERT INTO accounting_subjects(id,code,name,type,direction,parent_id,active) VALUES(?,?,?,?,?,?,1)')
      .run(subjectId, 'ROLE_' + roles.code, roles.code, roles.type || 'EXPENSE', roles.direction || 'DEBIT', null);
  }
  db.prepare('INSERT OR REPLACE INTO account_role_mappings(role_code,subject_id,updated_by,updated_at) VALUES(?,?,?,?)')
    .run(roles.code, subjectId, null, now);
  return subjectId;
}
