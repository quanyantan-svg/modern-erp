import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, test } from 'node:test';
import {
  assertM15ReadyForOutsourcingTracking, inspectM15Preconditions, migrateTrackedIdentityKeyM15,
} from './migrations/m15-tracked-identity-key.js';

let handles = [];
afterEach(() => { for (const db of handles) db.close(); handles = []; });

function legacyDb() {
  const db = new DatabaseSync(':memory:');
  handles.push(db);
  db.exec(`
    CREATE TABLE products(id TEXT PRIMARY KEY,tracking_policy TEXT NOT NULL);
    CREATE TABLE tracked_inventory_movements(
      id TEXT PRIMARY KEY,source_type TEXT NOT NULL,source_id TEXT NOT NULL,source_item_id TEXT,
      product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,direction TEXT NOT NULL,quantity REAL NOT NULL,
      lot_id TEXT,serial_id TEXT,business_date TEXT NOT NULL,reversed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertProduct(db, id, policy) {
  db.prepare('INSERT INTO products(id,tracking_policy) VALUES(?,?)').run(id, policy);
}

function insertMovement(db, { id, productId, lotId = null, serialId = null, sourceItemId = `item-${id}`, sourceId = `event-${id}` }) {
  db.prepare(`INSERT INTO tracked_inventory_movements(
    id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,serial_id,business_date,reversed,created_at
  ) VALUES(?,'OUTSOURCING_ISSUE',?,?,?,'warehouse-1','OUT',1,?,?,'2026-11-04',0,'2026-11-04T00:00:00.000Z')`)
    .run(id, sourceId, sourceItemId, productId, lotId, serialId);
}

describe('M-15 isolated SQLite implementation (never a project/history database)', () => {
  test('explicit Migration authorization is mandatory and an unauthorized call changes nothing', () => {
    const db = legacyDb();
    assert.throws(() => migrateTrackedIdentityKeyM15(db), /EXPLICIT_MIGRATION_AUTHORIZATION/);
    assert.equal(inspectM15Preconditions(db).columnPresent, false);
  });

  test('LOT, SERIAL and NONE map deterministically and the partial unique index is established', () => {
    const db = legacyDb();
    insertProduct(db, 'lot-product', 'LOT'); insertProduct(db, 'serial-product', 'SERIAL'); insertProduct(db, 'none-product', 'NONE');
    insertMovement(db, { id: 'lot-row', productId: 'lot-product', lotId: 'lot-1' });
    insertMovement(db, { id: 'serial-row', productId: 'serial-product', serialId: 'serial-1' });
    insertMovement(db, { id: 'none-row', productId: 'none-product' });
    const result = migrateTrackedIdentityKeyM15(db, { authorized: true });
    const identities = db.prepare('SELECT id,identity_key FROM tracked_inventory_movements ORDER BY id').all()
      .map((row) => ({ id: row.id, identity_key: row.identity_key }));
    assert.deepEqual(identities, [
      { id: 'lot-row', identity_key: 'LOT:lot-1' },
      { id: 'none-row', identity_key: 'NONE' },
      { id: 'serial-row', identity_key: 'SERIAL:serial-1' },
    ]);
    assert.deepEqual({ preA: result.preA, preB: result.preB, preC: result.preC, indexPresent: result.indexPresent },
      { preA: 0, preB: 0, preC: 0, indexPresent: true });
    assert.doesNotThrow(() => assertM15ReadyForOutsourcingTracking(db));
  });

  test('unknown or conflicting identity fails PRE-B and SQLite rolls the whole migration back', () => {
    const db = legacyDb();
    insertProduct(db, 'lot-product', 'LOT');
    insertMovement(db, { id: 'bad', productId: 'lot-product' });
    assert.throws(() => migrateTrackedIdentityKeyM15(db, { authorized: true }), /M15_PRE_B_IDENTITY_UNPROVEN/);
    assert.equal(inspectM15Preconditions(db).columnPresent, false, 'SQLite transactional DDL leaves no partial column');
  });

  test('missing source item fails PRE-A before DDL and duplicate identities fail PRE-C without deleting history', () => {
    const missing = legacyDb(); insertProduct(missing, 'none-product', 'NONE');
    insertMovement(missing, { id: 'missing', productId: 'none-product', sourceItemId: null });
    assert.throws(() => migrateTrackedIdentityKeyM15(missing, { authorized: true }), /M15_PRE_A_SOURCE_ITEM_MISSING:1/);
    assert.equal(inspectM15Preconditions(missing).columnPresent, false);

    const duplicate = legacyDb(); insertProduct(duplicate, 'none-product', 'NONE');
    insertMovement(duplicate, { id: 'a', productId: 'none-product', sourceId: 'same', sourceItemId: 'same-item' });
    insertMovement(duplicate, { id: 'b', productId: 'none-product', sourceId: 'same', sourceItemId: 'same-item' });
    assert.throws(() => migrateTrackedIdentityKeyM15(duplicate, { authorized: true }), /M15_PRE_C_DUPLICATE_IDENTITY:1/);
    assert.equal(duplicate.prepare('SELECT COUNT(*) n FROM tracked_inventory_movements').get().n, 2);
    assert.equal(inspectM15Preconditions(duplicate).columnPresent, false);
  });

  test('a MySQL-like partial-completion state is recognized and idempotently resumed', () => {
    const db = legacyDb(); insertProduct(db, 'none-product', 'NONE');
    insertMovement(db, { id: 'row', productId: 'none-product' });
    db.exec("ALTER TABLE tracked_inventory_movements ADD COLUMN identity_key TEXT NOT NULL DEFAULT ''");
    db.prepare("UPDATE tracked_inventory_movements SET identity_key='NONE' WHERE id='row'").run();
    assert.equal(inspectM15Preconditions(db).indexPresent, false);
    const first = migrateTrackedIdentityKeyM15(db, { authorized: true });
    const second = migrateTrackedIdentityKeyM15(db, { authorized: true });
    assert.equal(first.indexPresent, true); assert.equal(second.indexPresent, true);
    assert.equal(db.prepare("SELECT identity_key FROM tracked_inventory_movements WHERE id='row'").get().identity_key, 'NONE');
  });
});

describe('M-15 MySQL DDL plan (pure mock; no socket, database or Worker)', () => {
  test('recognizes each auto-commit boundary and retries without repeating completed DDL', () => {
    const state = { columns: new Set(['id']), index: false, statements: [] };
    const db = {
      dialect: 'mysql',
      isTransaction: false,
      prepare(sql) {
        if (/^PRAGMA table_info/.test(sql)) return { all: () => [...state.columns].map((name) => ({ name })) };
        if (/information_schema\.statistics/.test(sql)) return { get: () => (state.index ? { present: 1 } : undefined) };
        if (/source_item_id IS NULL/.test(sql)) return { get: () => ({ n: 0 }) };
        if (/SELECT m\.(?:id|identity_key)/.test(sql)) return { all: () => [] };
        if (/GROUP BY source_type/.test(sql)) return { get: () => ({ n: 0 }) };
        if (/^UPDATE tracked_inventory_movements/.test(sql)) return { run: () => ({ changes: 0 }) };
        throw new Error(`unexpected mock SQL: ${sql}`);
      },
      exec(sql) {
        state.statements.push(sql);
        if (/ADD COLUMN identity_key/.test(sql)) state.columns.add('identity_key');
        else if (/ADD COLUMN `(__partial_[0-9a-f]+)`/.test(sql)) state.columns.add(sql.match(/ADD COLUMN `([^`]+)`/)[1]);
        else if (/CREATE UNIQUE INDEX/.test(sql)) state.index = true;
        else throw new Error(`unexpected mock DDL: ${sql}`);
      },
    };
    const first = migrateTrackedIdentityKeyM15(db, { authorized: true });
    const ddlCount = state.statements.length;
    const second = migrateTrackedIdentityKeyM15(db, { authorized: true });
    assert.equal(first.indexPresent, true);
    assert.equal(second.indexPresent, true);
    assert.equal(state.statements.length, ddlCount, 'completed MySQL DDL must not be repeated on retry');
    assert.equal(ddlCount, 3, 'identity column, generated digest column and UNIQUE index are distinct resumable steps');
  });
});
