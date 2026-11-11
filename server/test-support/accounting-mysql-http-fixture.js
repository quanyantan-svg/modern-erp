// Accounting & Analytics 域 —— 真实 MySQL 8 的 HTTP 夹具。
//
// 与 `accounting-http-fixture.js`（SQLite）形态相同，但把数据库换成**已经引导完成**
// 的受保护 disposable MySQL 目标。它不建库、不建表、不跑 migration：schema 由
// campaign 的 `BOOTSTRAP_CURRENT_SCHEMA` 操作建立，本夹具只在其上提供 HTTP 服务与
// 角色 token。
//
// 它只用于受保护的真实 MySQL campaign；普通本地回归仍然走 SQLite 夹具。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from '../app.js';
import { openM1CoreG07ExistingAdapter } from '../test-utils/m1-core-g07-existing-adapter.js';

export async function createAccountingMySqlFixture({ targetProofPath }) {
  const verified = openM1CoreG07ExistingAdapter({ targetProofPath });
  const server = createServer(createApp(verified.db, { distDir: resolve('dist') }));
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
    verified.db.close();
  }

  return { db: verified.db, baseUrl, request, tokens, close };
}

/**
 * MySQL 版的会计科目角色映射种子。SQLite 的 `INSERT OR REPLACE` 在 MySQL 上由
 * 生产 SQL 翻译器转成 `REPLACE`，因此这里直接使用同一份 canonical 写法。
 */
export function seedAccountingRolesMySql(db, roles) {
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
