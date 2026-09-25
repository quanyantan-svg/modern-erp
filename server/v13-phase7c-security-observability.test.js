import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { hashPassword, id } from './db.js';
import { createStructuredLogger, redact, safeSqlLabel } from './lib/logger.js';
import { createTempDb } from './test-utils/temp-db.js';

let disposable;
let db;
let server;
let baseUrl;
const records = [];
const sink = {
  log: (line) => records.push(line),
  warn: (line) => records.push(line),
  error: (line) => records.push(line),
};

async function request(path, { token, body, headers = {}, ...options } = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

async function login(username, password) {
  const response = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  return payload.token;
}

before(async () => {
  disposable = createTempDb({ label: 'phase7c-security' });
  db = disposable.db;
  const password = hashPassword('viewer-7c-password');
  db.prepare('INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
    .run('role-view7c', 'VIEW7C', 'Phase 7C viewer', '', new Date().toISOString());
  db.prepare('INSERT INTO role_permissions(role_id,permission_code) VALUES(?,?)').run('role-view7c', 'ORDERS_VIEW');
  db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
    .run('user-view7c', 'viewer7c', 'Phase 7C Viewer', password.hash, password.salt, 'role-view7c', new Date().toISOString());
  server = createServer(createApp(db, {
    logger: createStructuredLogger({ sink }),
    slowRequestMs: 300_000,
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  disposable.cleanup();
});

describe('V1.3 Phase 7C security and observability', () => {
  test('liveness and readiness are separate, secret-free, no-store endpoints', async () => {
    const live = await request('/api/health/live');
    const ready = await request('/api/health/ready');
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(live.headers.get('cache-control'), 'no-store');
    assert.match(live.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(live.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(live.headers.get('x-frame-options'), 'DENY');
    assert.ok(live.headers.get('content-security-policy'));
    assert.deepEqual(await ready.json(), { status: 'ready', database: 'reachable' });
    assert.doesNotMatch(JSON.stringify(await live.json()), /password|secret|token|stack/i);
  });

  test('client request IDs are accepted only in a constrained format', async () => {
    const accepted = await request('/api/health/live', { headers: { 'x-request-id': 'client-request-123' } });
    const rejected = await request('/api/health/live', { headers: { 'x-request-id': 'bad id with spaces' } });
    assert.equal(accepted.headers.get('x-request-id'), 'client-request-123');
    assert.notEqual(rejected.headers.get('x-request-id'), 'bad id with spaces');
  });

  test('unauthenticated mutation, VIEW-to-WRITE and sensitive routes are denied', async () => {
    assert.equal((await request('/api/orders', { method: 'POST', body: {} })).status, 401);
    const viewer = await login('viewer7c', 'viewer-7c-password');
    assert.equal((await request('/api/orders', { token: viewer, method: 'POST', body: {} })).status, 403);
    assert.equal((await request('/api/bank-accounts', { token: viewer })).status, 403);
    assert.equal((await request('/api/system-health', { token: viewer })).status, 403);
    assert.equal((await request('/api/orders/not-a-real-id', { token: viewer, method: 'PUT', body: {} })).status, 403);
  });

  test('malformed, unsupported media, oversized and mass-assignment login bodies return controlled 4xx', async () => {
    const malformed = await request('/api/auth/login', { method: 'POST', body: '{' });
    const media = await request('/api/auth/login', {
      method: 'POST', body: '{"username":"x"}', headers: { 'content-type': 'text/plain' },
    });
    const oversized = await request('/api/auth/login', {
      method: 'POST', body: { username: 'x', password: 'x'.repeat(1_000_100) },
    });
    const assigned = await request('/api/auth/login', {
      method: 'POST', body: { username: 'admin', password: 'admin123', roleId: 'role-admin' },
    });
    assert.equal(malformed.status, 400);
    assert.equal(media.status, 415);
    assert.equal(oversized.status, 413);
    assert.equal(assigned.status, 400);
  });

  test('sensitive user fields cannot be mass-assigned and rejected requests do not mutate state', async () => {
    const admin = await login('admin', 'admin123');
    const before = db.prepare('SELECT active,password_hash FROM users WHERE id=?').get('user-view7c');
    const response = await request('/api/users/user-view7c', {
      token: admin, method: 'PATCH', body: { password_hash: 'attacker-controlled', active: false },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(db.prepare('SELECT active,password_hash FROM users WHERE id=?').get('user-view7c'), before);
  });

  test('locked accounts stay locked even when the next password is correct', async () => {
    const password = hashPassword('lock-7c-password');
    db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
      .run('user-lock7c', 'lock7c', 'Lock Test', password.hash, password.salt, 'role-view7c', new Date().toISOString());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request('/api/auth/login', { method: 'POST', body: { username: 'lock7c', password: `wrong-${attempt}` } });
    }
    const response = await request('/api/auth/login', { method: 'POST', body: { username: 'lock7c', password: 'lock-7c-password' } });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
  });

  test('disabled users and stale sessions are rejected', async () => {
    const token = await login('viewer7c', 'viewer-7c-password');
    db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=?)')
      .run('2000-01-01T00:00:00.000Z', 'user-view7c');
    assert.equal((await request('/api/auth/me', { token })).status, 401);
    const activeToken = await login('viewer7c', 'viewer-7c-password');
    db.prepare('UPDATE users SET active=0 WHERE id=?').run('user-view7c');
    assert.equal((await request('/api/auth/me', { token: activeToken })).status, 401);
    db.prepare('UPDATE users SET active=1 WHERE id=?').run('user-view7c');
  });

  test('structured logs redact secrets and mutation logs carry correlation context', async () => {
    const cleaned = redact({ password: 'p', authorization: 'Bearer raw-secret', nested: { token: 't' }, note: 'password=visible' });
    assert.equal(cleaned.password, '[REDACTED]');
    assert.equal(cleaned.authorization, '[REDACTED]');
    assert.equal(cleaned.nested.token, '[REDACTED]');
    assert.doesNotMatch(cleaned.note, /visible/);
    assert.equal(safeSqlLabel('SELECT * FROM sessions WHERE token_hash=?'), 'SELECT:sessions');

    await request('/api/auth/logout', { method: 'POST', headers: { 'x-request-id': 'phase7c-logout-1' } });
    const mutation = records.map((line) => JSON.parse(line)).find((row) => row.requestId === 'phase7c-logout-1');
    assert.equal(mutation.event, 'mutation_request');
    assert.equal(mutation.route, '/api/auth/logout');
    assert.doesNotMatch(records.join('\n'), /raw-secret|viewer-7c-password|admin123/);
  });

  test('production-style unhandled errors expose only a generic message and correlation ID', async () => {
    const errorRecords = [];
    const failingDb = { prepare() { throw new Error('database failed password=supersecret'); } };
    const failingServer = createServer(createApp(failingDb, {
      logger: createStructuredLogger({ sink: { log() {}, warn() {}, error: (line) => errorRecords.push(line) } }),
    }));
    await new Promise((resolve) => failingServer.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${failingServer.address().port}/api/dashboard`, {
        headers: { authorization: 'Bearer client-secret-token' },
      });
      const payload = await response.json();
      assert.equal(response.status, 500);
      assert.equal(payload.error, '服务器内部错误');
      assert.equal(payload.requestId, response.headers.get('x-request-id'));
      assert.doesNotMatch(JSON.stringify(payload), /stack|supersecret|client-secret-token/i);
      assert.match(errorRecords[0], /unhandled_request_error/);
      assert.doesNotMatch(errorRecords.join('\n'), /supersecret|client-secret-token/);
    } finally {
      await new Promise((resolve) => failingServer.close(resolve));
    }
  });
});
