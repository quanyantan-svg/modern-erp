import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

let tempDir;

function freshDb(name) {
  return join(tempDir, name);
}

after(async () => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function openRaw(dbPath) {
  return new DatabaseSync(dbPath);
}

describe('Supplier schema — clean database', () => {
  beforeEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-supplier-clean-'));
  });

  test('CREATE TABLE includes every column that supplier APIs read/write', () => {
    const db = createDatabase(freshDb('clean.db'));
    const cols = columnNames(db, 'suppliers');
    for (const required of ['id', 'code', 'name', 'contact', 'phone', 'address', 'email', 'active', 'created_at', 'updated_at']) {
      assert.ok(cols.includes(required), `suppliers.${required} must exist on a clean DB, got columns=[${cols.join(',')}]`);
    }
    db.close();
  });

  test('createSupplier SQL (INSERT with email column) succeeds on clean DB', () => {
    const db = createDatabase(freshDb('clean-insert.db'));
    const now = new Date().toISOString();
    assert.doesNotThrow(() => {
      db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`)
        .run('sup-x', 'S100', '测试供应商', '王经理', '13900000000', '广东省深圳市', '[email protected]', now, now);
    });
    const row = db.prepare('SELECT * FROM suppliers WHERE id=?').get('sup-x');
    assert.equal(row.email, '[email protected]');
    db.close();
  });

  test('updateSupplier SQL (UPDATE with email column) succeeds on clean DB', () => {
    const db = createDatabase(freshDb('clean-update.db'));
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`)
      .run('sup-y', 'S101', '初始供应商', '', '', '', '', now, now);
    assert.doesNotThrow(() => {
      db.prepare('UPDATE suppliers SET code=?,name=?,contact=?,phone=?,address=?,email=?,active=?,updated_at=? WHERE id=?')
        .run('S101', '更新供应商', '李经理', '13700000000', '北京市朝阳区', '[email protected]', 1, now, 'sup-y');
    });
    const row = db.prepare('SELECT * FROM suppliers WHERE id=?').get('sup-y');
    assert.equal(row.email, '[email protected]');
    assert.equal(row.name, '更新供应商');
    db.close();
  });
});

describe('Supplier schema — old-schema database migration', () => {
  beforeEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-supplier-old-'));
  });

  function simulateOldDb(dbPath) {
    const raw = openRaw(dbPath);
    raw.exec(`
      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        contact TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const now = '2026-01-01T00:00:00.000Z';
    raw.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,1,?,?)`)
      .run('sup-old-001', 'SOLD001', '历史供应商', '赵主管', '13511112222', '上海市浦东新区', now, now);
    raw.close();
  }

  test('createDatabase() adds the missing email column to an old-schema DB', () => {
    const dbPath = freshDb('old.db');
    simulateOldDb(dbPath);

    const db = createDatabase(dbPath);
    const cols = columnNames(db, 'suppliers');
    assert.ok(cols.includes('email'), `email column must be added on migration, got columns=[${cols.join(',')}]`);
    db.close();
  });

  test('existing supplier rows remain intact after migration (data preserved)', () => {
    const dbPath = freshDb('old-rows.db');
    simulateOldDb(dbPath);

    const db = createDatabase(dbPath);
    const row = db.prepare('SELECT id,code,name,contact,phone,address,active FROM suppliers WHERE id=?').get('sup-old-001');
    assert.ok(row, 'existing supplier row must remain after migration');
    assert.equal(row.code, 'SOLD001');
    assert.equal(row.name, '历史供应商');
    assert.equal(row.contact, '赵主管');
    assert.equal(row.phone, '13511112222');
    assert.equal(row.address, '上海市浦东新区');
    assert.equal(row.active, 1);
    // existing rows get email='' from column DEFAULT (NOT NULL)
    assert.equal(row.email ?? db.prepare('SELECT email FROM suppliers WHERE id=?').get('sup-old-001').email, '');
    db.close();
  });

  test('after migration, creating a new supplier with email succeeds (full HTTP path)', async () => {
    const dbPath = freshDb('old-http.db');
    simulateOldDb(dbPath);

    const database = createDatabase(dbPath);
    const server = createServer(createApp(database, { distDir: resolve('dist') }));
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' }),
      });
      assert.equal(login.status, 200, 'admin login must succeed; ensure demo seed ran (NODE_ENV not production)');
      const { token } = await login.json();

      const create = await fetch(`${baseUrl}/api/suppliers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          code: 'S200',
          name: '新供应商',
          contact: '孙经理',
          phone: '13611112222',
          address: '杭州市西湖区',
          email: '[email protected]',
        }),
      });
      assert.equal(create.status, 201, `create supplier must succeed after migration, got ${create.status} body=${await create.text()}`);

      const list = await fetch(`${baseUrl}/api/suppliers`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(list.status, 200);
      const listBody = await list.json();
      const codes = listBody.suppliers.map((s) => s.code);
      assert.ok(codes.includes('SOLD001'), 'old supplier must still be listed');
      assert.ok(codes.includes('S200'), 'new supplier must be listed after migration');

      const created = database.prepare('SELECT * FROM suppliers WHERE code=?').get('S200');
      assert.equal(created.email, '[email protected]');

      const update = await fetch(`${baseUrl}/api/suppliers/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: '[email protected]' }),
      });
      assert.equal(update.status, 200, `update supplier must succeed after migration, got ${update.status} body=${await update.text()}`);
      const updated = database.prepare('SELECT email FROM suppliers WHERE id=?').get(created.id);
      assert.equal(updated.email, '[email protected]');
    } finally {
      await new Promise((resolveClose) => server.close(() => resolveClose()));
      database.close();
    }
  });

  test('createSupplier with optional email omitted still succeeds on migrated DB', () => {
    const dbPath = freshDb('old-noemail.db');
    simulateOldDb(dbPath);

    const db = createDatabase(dbPath);
    const now = new Date().toISOString();
    assert.doesNotThrow(() => {
      db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`)
        .run('sup-new-002', 'S201', '无邮箱供应商', '', '', '', '', now, now);
    });
    const row = db.prepare('SELECT email FROM suppliers WHERE id=?').get('sup-new-002');
    assert.equal(row.email, '');
    db.close();
  });
});

describe('Supplier schema — migration idempotency', () => {
  beforeEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-supplier-idem-'));
  });

  test('running createDatabase() multiple times on a fresh DB does not error', () => {
    const dbPath = freshDb('idem-fresh.db');
    const db1 = createDatabase(dbPath);
    db1.close();
    assert.doesNotThrow(() => {
      const db2 = createDatabase(dbPath);
      db2.close();
    });
    assert.doesNotThrow(() => {
      const db3 = createDatabase(dbPath);
      db3.close();
    });
  });

  test('running createDatabase() multiple times on an old-schema DB does not error', () => {
    const dbPath = freshDb('idem-old.db');
    const raw = openRaw(dbPath);
    raw.exec(`
      CREATE TABLE suppliers (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        contact TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw.close();

    const db1 = createDatabase(dbPath);
    db1.close();
    assert.doesNotThrow(() => {
      const db2 = createDatabase(dbPath);
      db2.close();
    });
    assert.doesNotThrow(() => {
      const db3 = createDatabase(dbPath);
      const cols = columnNames(db3, 'suppliers');
      assert.ok(cols.includes('email'), 'email must still be present after repeated migrations');
      db3.close();
    });
  });
});