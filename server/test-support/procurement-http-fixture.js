import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../app.js';
import { createDatabase } from '../db.js';

export async function createProcurementFixture(prefix) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, token = null, body) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
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
    sales: await login('sales', 'sales123'),
    reviewer: await login('reviewer', 'review123'),
    warehouse: await login('warehouse', 'warehouse123'),
  };

  async function close() {
    await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return { db, request, tokens, close };
}
