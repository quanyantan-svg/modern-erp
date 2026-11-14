// Wave 6 Final Functional Closure — minimal high-signal tests using direct DatabaseSync.
// Mirrors schema as needed for the focused assertions:
// - F5 physical schema (CHECK(amount_cents >= 0) is applied)
// - applyWave6SalesReturnPoolValue fail-closed: pool absent + standard cost → 409 (no STANDARD_COST)
// - applyWave6SalesReturnPoolValue: positive pool → proportional value
// - applyWave6SalesReturnPoolValue: valuation_activated_at NULL → 409 (no LEGACY_UNVALUED)
// - F5 idempotent re-runs preserve legacy data
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateSalesCustomerWave6Returns } from './migrations/sales-customer-wave6-returns.js';

// R-02：canonical 期间守卫需要协调锚点表（锁对象，不是期间状态权威）。
function bootstrapPeriodGuardAnchors(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS period_guard_anchors (
      axis TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(axis, scope_key)
    );
  `);
  const now = new Date().toISOString();
  for (const axis of ['INVENTORY', 'LEGAL_ACCOUNTING']) {
    db.prepare("INSERT OR IGNORE INTO period_guard_anchors(axis,scope_key,version,updated_at) VALUES(?,'GLOBAL',0,?)").run(axis, now);
  }
}

function buildDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}

async function loadFinv() { return await import('./modules/financial-inventory.js'); }

function bootstrapReversalTables(db) {
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE return_orders (id TEXT PRIMARY KEY, return_no TEXT NOT NULL, creator_id TEXT NOT NULL);
    CREATE TABLE return_order_items (id TEXT PRIMARY KEY, return_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity REAL NOT NULL);
    CREATE TABLE return_reversals (
      id TEXT PRIMARY KEY, reversal_no TEXT NOT NULL UNIQUE,
      side TEXT NOT NULL CHECK(side IN ('SALES','PURCHASE')), return_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), business_date TEXT NOT NULL,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status='CONFIRMED'),
      creator_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE return_reversal_items (
      id TEXT PRIMARY KEY, reversal_id TEXT NOT NULL, original_return_item_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      UNIQUE(reversal_id, original_return_item_id),
      FOREIGN KEY(reversal_id) REFERENCES return_reversals(id)
    );
  `);
}

function bootstrapProductValuationTables(db) {
  db.exec(`
    CREATE TABLE products (id TEXT PRIMARY KEY, inventory_classification TEXT, valuation_activated_at TEXT, tracking_policy TEXT, valuation_method TEXT, standard_manufacturing_cost_cents INTEGER);
    CREATE TABLE inventory_valuation_balances (balance_key TEXT PRIMARY KEY, valuation_method TEXT NOT NULL, product_id TEXT, warehouse_id TEXT, lot_id TEXT, serial_id TEXT, quantity REAL, value_cents INTEGER, updated_at TEXT NOT NULL);
    CREATE TABLE inventory_valuation_movements (id TEXT PRIMARY KEY, business_date TEXT, product_id TEXT, warehouse_id TEXT, lot_id TEXT, serial_id TEXT, quantity_delta REAL, value_delta_cents INTEGER, valuation_basis TEXT, movement_type TEXT, source_type TEXT, source_id TEXT, source_item_id TEXT, inventory_transaction_id TEXT, reversal_of_id TEXT, status TEXT, created_at TEXT NOT NULL, unit_cost_cents INTEGER, production_order_id TEXT);
    CREATE TABLE inventory_transactions (id TEXT PRIMARY KEY, business_date TEXT, valuation_status TEXT);
    CREATE TABLE inventory_period_closures (id TEXT PRIMARY KEY, period_key TEXT NOT NULL, status TEXT NOT NULL, closed_by TEXT NOT NULL, closed_at TEXT NOT NULL, reopened_by TEXT, reopened_at TEXT);
    CREATE TABLE period_closures (id TEXT PRIMARY KEY, period TEXT NOT NULL, status TEXT NOT NULL, closed_by TEXT NOT NULL, closed_at TEXT NOT NULL, reopened_by TEXT, reopened_at TEXT);
  `);
  // No CLOSED periods; the canonical period guard will pass.
}

test('Wave6 Final - F5: return_reversals CHECK(amount_cents >= 0) physically present + legacy data preserved + 0 amount allowed', () => {
  const db = buildDb();
  bootstrapPeriodGuardAnchors(db);
  bootstrapReversalTables(db);
  db.exec(`INSERT INTO users(id) VALUES('u1')`);
  db.exec(`INSERT INTO return_orders(id,return_no,creator_id) VALUES('r1','LR-1','u1')`);
  db.exec(`INSERT INTO return_order_items(id,return_id,product_id,quantity) VALUES('ri1','r1','p1',5)`);
  // Legacy positive-value row
  db.prepare(`INSERT INTO return_reversals(id, reversal_no, side, return_id, amount_cents, business_date, reason, creator_id, created_at) VALUES('legacy','LR','SALES','r1',500,'2025-01-01','legacy','u1','2025-01-01')`).run();
  // Run Wave 6 migration
  migrateSalesCustomerWave6Returns(db);
  // Verify CHECK physically present
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='return_reversals'`).get().sql;
  assert.ok(sql.includes('CHECK(amount_cents >= 0)'), `actual: ${sql}`);
  // NO_SOURCE zero amount succeeds (F5 relaxation)
  db.prepare(`INSERT INTO return_reversals(id, reversal_no, side, return_id, amount_cents, business_date, reason, creator_id, created_at) VALUES('zero','ZR','SALES','r1',0,'2026-03-15','NO_SOURCE','u1','2026-03-15')`).run();
  // Legacy positive row preserved
  assert.equal(db.prepare(`SELECT amount_cents FROM return_reversals WHERE id='legacy'`).get().amount_cents, 500);
  // Idempotent
  migrateSalesCustomerWave6Returns(db);
  migrateSalesCustomerWave6Returns(db);
  // FK check clean
  const fks = db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(fks.length, 0, `FK orphans: ${JSON.stringify(fks)}`);
});

test('Wave6 Final - F5 idempotent re-runs preserve legacy data and constraints', () => {
  const db = buildDb();
  bootstrapPeriodGuardAnchors(db);
  bootstrapReversalTables(db);
  db.exec(`INSERT INTO users(id) VALUES('u1')`);
  db.exec(`INSERT INTO return_orders(id,return_no,creator_id) VALUES('r1','LR','u1')`);
  db.exec(`INSERT INTO return_order_items(id,return_id,product_id,quantity) VALUES('ri1','r1','p1',1)`);
  db.prepare(`INSERT INTO return_reversals(id, reversal_no, side, return_id, amount_cents, business_date, reason, creator_id, created_at) VALUES('legacy','LR-1','SALES','r1',100,'2025-01-01','l','u1','2025-01-01')`).run();
  migrateSalesCustomerWave6Returns(db);
  migrateSalesCustomerWave6Returns(db);
  migrateSalesCustomerWave6Returns(db);
  const legacy = db.prepare(`SELECT amount_cents FROM return_reversals WHERE id='legacy'`).get();
  assert.equal(legacy.amount_cents, 100);
  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='return_reversals'`).get().sql;
  assert.ok(sql.includes('CHECK(amount_cents >= 0)'));
});

test('Wave6 Final - applyWave6SalesReturnPoolValue fail-closed: pool absent + standard_manufacturing_cost_cents > 0 → 409 (no STANDARD_COST)', async () => {
  const { applyWave6SalesReturnPoolValue } = await loadFinv();
  const { HttpError } = await import('./lib/http.js');
  const db = buildDb();
  bootstrapPeriodGuardAnchors(db);
  bootstrapProductValuationTables(db);
  // Product has valuation_activated_at set, has forbidden standard cost, but pool absent
  db.prepare(`INSERT INTO products(id, valuation_activated_at, tracking_policy, valuation_method, standard_manufacturing_cost_cents) VALUES('p1','2026-01-01','NONE','MOVING_AVERAGE', 9999)`).run();
  assert.throws(
    () => applyWave6SalesReturnPoolValue(db, {
      businessDate: '2026-03-15', productId: 'p1', warehouseId: 'w1', quantity: 1,
      movementType: 'SALES_RETURN', sourceType: 'SALES_RETURN',
      sourceId: 'r1', sourceItemId: 'ri1', inventoryTransactionId: 'tx1',
    }),
    (err) => err instanceof HttpError && /估值未启用|同一身份/.test(err.message),
  );
  // No fallback movements written
  const moves = db.prepare(`SELECT * FROM inventory_valuation_movements WHERE source_id='r1'`).all();
  assert.equal(moves.length, 0, 'no STANDARD_COST or LEGACY_UNVALUED fallback');
});

test('Wave6 Final - applyWave6SalesReturnPoolValue: positive MOVING_AVERAGE pool → proportional value', async () => {
  const { applyWave6SalesReturnPoolValue } = await loadFinv();
  const db = buildDb();
  bootstrapPeriodGuardAnchors(db);
  bootstrapProductValuationTables(db);
  db.prepare(`INSERT INTO products(id, valuation_activated_at, tracking_policy, valuation_method) VALUES('p1','2026-01-01','NONE','MOVING_AVERAGE')`).run();
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at) VALUES('NONE:w1:p1','MOVING_AVERAGE','p1','w1',100,10000,'2026-01-01')`).run();
  const movement = applyWave6SalesReturnPoolValue(db, {
    businessDate: '2026-03-15', productId: 'p1', warehouseId: 'w1', quantity: 3,
    movementType: 'SALES_RETURN', sourceType: 'SALES_RETURN',
    sourceId: 'r1', sourceItemId: 'ri1', inventoryTransactionId: 'tx1',
  });
  assert.equal(Number(movement.quantityDelta), 3);
  assert.equal(Number(movement.valueDeltaCents), 300);
  assert.equal(movement.valuationMethod, 'MOVING_AVERAGE');
});

test('Wave6 Final - applyWave6SalesReturnPoolValue: valuation_activated_at NULL → 409 (no LEGACY_UNVALUED)', async () => {
  const { applyWave6SalesReturnPoolValue } = await loadFinv();
  const { HttpError } = await import('./lib/http.js');
  const db = buildDb();
  bootstrapPeriodGuardAnchors(db);
  bootstrapProductValuationTables(db);
  db.prepare(`INSERT INTO products(id, valuation_activated_at, tracking_policy, valuation_method) VALUES('p1', NULL,'NONE','MOVING_AVERAGE')`).run();
  db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at) VALUES('NONE:w1:p1','MOVING_AVERAGE','p1','w1',100,10000,'2026-01-01')`).run();
  assert.throws(
    () => applyWave6SalesReturnPoolValue(db, {
      businessDate: '2026-03-15', productId: 'p1', warehouseId: 'w1', quantity: 1,
      movementType: 'SALES_RETURN', sourceType: 'SALES_RETURN',
      sourceId: 'r1', sourceItemId: 'ri1', inventoryTransactionId: 'tx1',
    }),
    (err) => err instanceof HttpError && /估值未启用/.test(err.message),
  );
  const moves = db.prepare(`SELECT * FROM inventory_valuation_movements WHERE source_id='r1'`).all();
  assert.equal(moves.length, 0, 'no LEGACY_UNVALUED fallback should be written');
});
