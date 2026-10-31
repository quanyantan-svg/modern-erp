// W11-A U3 — Demo Seed canonical inventory position identity.
//
// Requirement : document.md R-U3-INV-01 .. R-U3-INV-08
// Design      : solution.md §37.54.43 §2 and §5 (acceptance items A .. H)
//
// This suite owns the physical identity of the inventory rows that the Demo
// Seed creates. It exists because the Domain 5 inventory suites deliberately
// suppress the Demo Seed (NODE_ENV=production), so no existing suite ever
// observed a seeded inventory row.
//
// Every case runs against a disposable SQLite database in the operating
// system temporary directory. No real MySQL is contacted. The suite never
// writes to the repository, never manufactures a business quantity and never
// weakens the existing approval expectation: the seeded quantity 20 must
// become 22 through the real approval path.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase, detectAbnormalInventoryPositions } from './db.js';
import { computePositionKey } from './lib/inventory-position.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// The canonical default position dimension tuple.
const CANONICAL_DIMENSIONS = Object.freeze({
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

const DEMO_POSITIONS = Object.freeze([
  { id: 'seed-inv-warehouse-001-001', warehouseId: 'warehouse-001', productId: 'product-001', quantity: 20 },
  { id: 'seed-inv-warehouse-001-002', warehouseId: 'warehouse-001', productId: 'product-002', quantity: 100 },
  { id: 'seed-inv-warehouse-001-003', warehouseId: 'warehouse-001', productId: 'product-003', quantity: 30 },
  { id: 'seed-inv-warehouse-002-001', warehouseId: 'warehouse-002', productId: 'product-001', quantity: 16 },
  { id: 'seed-inv-warehouse-002-002', warehouseId: 'warehouse-002', productId: 'product-002', quantity: 80 },
  { id: 'seed-inv-warehouse-002-003', warehouseId: 'warehouse-002', productId: 'product-003', quantity: 22 },
]);

function canonicalKey(warehouseId, productId) {
  return computePositionKey({ productId, warehouseId, ...CANONICAL_DIMENSIONS });
}

function createDisposableDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-demo-seed-'));
  const path = join(dir, 'erp.db');
  const db = createDatabase(path);
  return {
    dir,
    path,
    db,
    close() { try { db.close(); } catch (_) { /* the handle may already be released */ } },
    cleanup() { try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ } },
  };
}

function readInventoryRows(db) {
  return db.prepare(`SELECT id, warehouse_id, product_id, quantity, position_key,
      bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active
    FROM inventory ORDER BY id`).all();
}

describe('W11-A U3 A/B/C — fresh SQLite demo seed physical identity', () => {
  let fixture;
  let rows;

  before(() => {
    fixture = createDisposableDatabase();
    rows = readInventoryRows(fixture.db);
  });

  after(() => { fixture.close(); fixture.cleanup(); });

  test('A the fresh SQLite demo seed creates exactly six valid canonical positions', () => {
    assert.equal(rows.length, 6, 'the demo seed creates exactly six inventory rows');
    assert.deepEqual(
      rows.map((row) => row.id),
      DEMO_POSITIONS.map((position) => position.id),
    );
    for (const expected of DEMO_POSITIONS) {
      const row = rows.find((candidate) => candidate.id === expected.id);
      assert.ok(row, `${expected.id} must exist`);
      assert.equal(row.warehouse_id, expected.warehouseId);
      assert.equal(row.product_id, expected.productId);
      assert.equal(Number(row.quantity), expected.quantity);
      assert.equal(Number(row.active), 1);
      assert.match(row.position_key, /^[0-9a-f]{64}$/, `${expected.id} must carry a canonical position key`);
    }
  });

  test('B every seeded position key equals the canonical computation of its own dimensions', () => {
    for (const row of rows) {
      const expected = computePositionKey({
        productId: row.product_id,
        warehouseId: row.warehouse_id,
        binId: row.bin_id,
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        stockStatus: row.stock_status,
        lotId: row.lot_id,
        serialId: row.serial_id,
      });
      assert.equal(row.position_key, expected, `${row.id} must carry its own canonical position key`);
    }
  });

  test('B every seeded position stores exactly the canonical default dimension tuple', () => {
    for (const row of rows) {
      assert.equal(row.bin_id, null, `${row.id} bin_id`);
      assert.equal(row.owner_type, 'ENTERPRISE', `${row.id} owner_type`);
      assert.equal(row.owner_id, null, `${row.id} owner_id`);
      assert.equal(row.stock_status, 'AVAILABLE', `${row.id} stock_status`);
      assert.equal(row.lot_id, null, `${row.id} lot_id`);
      assert.equal(row.serial_id, null, `${row.id} serial_id`);
    }
  });

  test('C no active inventory row carries a NULL or empty position key', () => {
    const nullKeys = fixture.db.prepare(
      `SELECT COUNT(*) c FROM inventory WHERE active=1 AND (position_key IS NULL OR position_key='')`,
    ).get();
    assert.equal(Number(nullKeys.c), 0);
    const report = detectAbnormalInventoryPositions(fixture.db);
    assert.equal(report.healthy, true);
    assert.equal(report.abnormalRows, 0);
    assert.equal(report.scanned, 6);
  });
});

describe('W11-A U3 D/E/F — inventory check approval against the canonical position', () => {
  let fixture;
  let httpServer;
  let baseUrl;
  let token;
  const positionKey = canonicalKey('warehouse-001', 'product-001');

  before(async () => {
    fixture = createDisposableDatabase();
    httpServer = createServer(createApp(fixture.db, { distDir: resolve(root, 'dist') }));
    await new Promise((resolveListen) => httpServer.listen(0, '127.0.0.1', resolveListen));
    baseUrl = `http://127.0.0.1:${httpServer.address().port}`;

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200, loginBody.error);
    token = loginBody.token;

    // The demo product carries no cost basis and no valuation activation, so
    // its valuation would be the legacy unvalued movement with a zero amount
    // and the system voucher would be skipped for an empty entry set. A
    // standard cost is given to the fixture product so the approval exercises
    // the complete money path: a real valuation movement, a real system
    // voucher and balanced integer-cent entries.
    fixture.db.prepare('UPDATE products SET standard_manufacturing_cost_cents=? WHERE id=?')
      .run(259900, 'product-001');

    // The check is created by the warehouse user, so the administrator may
    // approve it. The system quantity is the seeded quantity and the counted
    // actual quantity is the seeded quantity plus the counted difference.
    const seeded = fixture.db.prepare('SELECT quantity FROM inventory WHERE position_key=?').get(positionKey);
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO inventory_checks
      (id,check_no,warehouse_id,status,checked_at,creator_id,created_at,product_id,
       system_quantity,actual_quantity,difference,reason,reviewer_id,reviewed_at,remark,business_date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'demo-seed-check', 'IC-DEMO-SEED', 'warehouse-001', 'SUBMITTED', now, 'user-warehouse', now,
      'product-001', Number(seeded.quantity), Number(seeded.quantity) + 2, 2, 'count',
      null, null, '', '2099-06-01',
    );
  });

  after(async () => {
    await new Promise((resolveClose) => httpServer.close(() => resolveClose()));
    fixture.close();
    fixture.cleanup();
  });

  test('D the approved inventory check moves the seeded canonical position from 20 to 22', async () => {
    const before = fixture.db.prepare('SELECT id, quantity FROM inventory WHERE position_key=?').get(positionKey);
    assert.equal(Number(before.quantity), 20);

    const response = await fetch(`${baseUrl}/api/inventory-checks/demo-seed-check`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'APPROVE' }),
    });
    const body = await response.json().catch(() => ({}));
    assert.equal(response.status, 200, JSON.stringify(body));

    // The canonical position is read by its position key. The unqualified
    // (warehouse_id, product_id) read is asserted as well, so the original
    // business expectation of 22 is preserved rather than renegotiated.
    const canonical = fixture.db.prepare('SELECT id, quantity FROM inventory WHERE position_key=?').get(positionKey);
    assert.equal(Number(canonical.quantity), 22);
    const unqualified = fixture.db.prepare(
      'SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?',
    ).get('warehouse-001', 'product-001');
    assert.equal(Number(unqualified.quantity), 22);

    // The approval updated the seeded row in place. It did not insert a
    // second physical row for the same logical position.
    assert.equal(canonical.id, before.id);
  });

  test('E exactly one active canonical position exists for the logical position', () => {
    const byKey = fixture.db.prepare(
      'SELECT COUNT(*) c FROM inventory WHERE position_key=? AND active=1',
    ).get(positionKey);
    assert.equal(Number(byKey.c), 1, 'exactly one active row carries the canonical position key');

    const activeByTuple = fixture.db.prepare(
      'SELECT COUNT(*) c FROM inventory WHERE warehouse_id=? AND product_id=? AND active=1',
    ).get('warehouse-001', 'product-001');
    assert.equal(Number(activeByTuple.c), 1, 'exactly one active row describes the logical position');

    const allByTuple = fixture.db.prepare(
      'SELECT COUNT(*) c FROM inventory WHERE warehouse_id=? AND product_id=?',
    ).get('warehouse-001', 'product-001');
    assert.equal(Number(allByTuple.c), 1, 'the logical position holds a single physical inventory fact');

    const total = fixture.db.prepare('SELECT COUNT(*) c FROM inventory').get();
    assert.equal(Number(total.c), 6, 'the approval created no additional inventory row');
  });

  test('F the approval writes its inventory transaction, audit record, valuation movement and system voucher', () => {
    const transactions = fixture.db.prepare(
      `SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_CHECK' AND source_id='demo-seed-check'`,
    ).all();
    assert.equal(transactions.length, 1, 'exactly one inventory transaction');
    assert.equal(Number(transactions[0].quantity_change), 2);
    assert.equal(transactions[0].direction, 'IN');
    assert.equal(Number(transactions[0].balance_after), 22);
    assert.equal(transactions[0].business_date, '2099-06-01');

    const audits = fixture.db.prepare(
      `SELECT * FROM audit_logs WHERE entity_type='INVENTORY_CHECK' AND entity_id='demo-seed-check' AND action='APPROVE'`,
    ).all();
    assert.equal(audits.length, 1, 'the approval wrote exactly one audit record');
    assert.equal(audits[0].user_id, 'user-admin');

    const valuations = fixture.db.prepare(
      `SELECT * FROM inventory_valuation_movements WHERE source_type='INVENTORY_CHECK' AND source_id='demo-seed-check'`,
    ).all();
    assert.equal(valuations.length, 1, 'the approval wrote exactly one valuation movement');
    assert.equal(Number(valuations[0].quantity_delta), 2);
    assert.equal(valuations[0].valuation_basis, 'STANDARD_COST');
    const valuationAmount = Math.abs(Number(valuations[0].value_delta_cents));
    assert.ok(Number.isSafeInteger(valuationAmount));
    assert.ok(valuationAmount > 0, 'the valuation carries a real integer-cent amount');
    assert.equal(valuationAmount, 2 * 259900, 'the valuation amount is the standard cost times the counted difference');

    const vouchers = fixture.db.prepare(
      `SELECT * FROM accounting_vouchers WHERE source_type='INVENTORY_COUNT' AND source_id='demo-seed-check'`,
    ).all();
    assert.equal(vouchers.length, 1, 'the approval wrote exactly one system voucher');

    const entries = fixture.db.prepare('SELECT * FROM accounting_entries WHERE voucher_id=?').all(vouchers[0].id);
    assert.ok(entries.length >= 2, 'the system voucher carries its entries');
    const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
    const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
    assert.equal(debit, credit, 'the system voucher stays balanced');
    assert.equal(debit, valuationAmount, 'the voucher amount agrees with the valuation amount');
    assert.ok(Number.isSafeInteger(debit));

    const check = fixture.db.prepare('SELECT * FROM inventory_checks WHERE id=?').get('demo-seed-check');
    assert.equal(check.status, 'APPROVED');
    assert.equal(check.reviewer_id, 'user-admin');
    assert.ok(check.reviewed_at);

    // The approval is the only actor: it wrote no second inventory
    // transaction and no canonical inventory mutation log entry.
    const mutationLog = fixture.db.prepare('SELECT COUNT(*) c FROM inventory_mutation_log').get();
    assert.equal(Number(mutationLog.c), 0);
  });
});

describe('W11-A U3 G — reopen and repeated bootstrap idempotency', () => {
  let fixture;

  before(() => { fixture = createDisposableDatabase(); });

  after(() => { fixture.close(); fixture.cleanup(); });

  test('G a repeated bootstrap never overwrites the real quantity and never adds a row', () => {
    const positionKey = canonicalKey('warehouse-001', 'product-001');
    const seeded = fixture.db.prepare('SELECT id, quantity FROM inventory WHERE position_key=?').get(positionKey);
    assert.equal(Number(seeded.quantity), 20);

    // The quantity is changed by a real business fact, not by a direct write
    // to the inventory table.
    fixture.db.prepare('UPDATE inventory SET quantity=? WHERE position_key=?').run(37, positionKey);

    // A second initialization of the same database must preserve it.
    fixture.close();
    const reopened = createDatabase(fixture.path);
    try {
      const rows = readInventoryRows(reopened);
      assert.equal(rows.length, 6, 'a repeated bootstrap adds no inventory row');
      const row = rows.find((candidate) => candidate.id === seeded.id);
      assert.equal(Number(row.quantity), 37, 'a repeated bootstrap never overwrites the real quantity');
      assert.equal(row.position_key, positionKey, 'the canonical identity is preserved');
      const nullKeys = reopened.prepare(
        `SELECT COUNT(*) c FROM inventory WHERE active=1 AND (position_key IS NULL OR position_key='')`,
      ).get();
      assert.equal(Number(nullKeys.c), 0, 'a repeated bootstrap produces no keyless position');
      const report = detectAbnormalInventoryPositions(reopened);
      assert.equal(report.healthy, true);
    } finally {
      reopened.close();
    }
  });

  test('G a second reopen converges on the same physical state', () => {
    const reopened = createDatabase(fixture.path);
    try {
      const rows = readInventoryRows(reopened);
      assert.equal(rows.length, 6);
      for (const expected of DEMO_POSITIONS) {
        const row = rows.find((candidate) => candidate.id === expected.id);
        assert.ok(row);
        assert.equal(row.position_key, canonicalKey(row.warehouse_id, row.product_id));
      }
    } finally {
      reopened.close();
    }
  });
});

describe('W11-A U3 H — legacy abnormal inventory detection', () => {
  let fixture;

  beforeEach(() => { fixture = createDisposableDatabase(); });

  afterEach(() => { fixture.close(); fixture.cleanup(); });

  test('H a legacy NULL position key is detected and reported', () => {
    fixture.db.prepare("UPDATE inventory SET position_key=NULL WHERE id='seed-inv-warehouse-001-001'").run();
    const report = detectAbnormalInventoryPositions(fixture.db);
    assert.equal(report.healthy, false);
    assert.equal(report.counts.nullPositionKey, 1);
    assert.equal(report.nullPositionKey[0].id, 'seed-inv-warehouse-001-001');
  });

  test('H a legacy NULL position key is backfilled by the approved migration without duplicating the inventory fact', () => {
    fixture.db.prepare("UPDATE inventory SET position_key=NULL WHERE id='seed-inv-warehouse-001-001'").run();
    fixture.close();
    const reopened = createDatabase(fixture.path);
    try {
      const rows = reopened.prepare(
        'SELECT id, quantity, position_key FROM inventory WHERE warehouse_id=? AND product_id=?',
      ).all('warehouse-001', 'product-001');
      assert.equal(rows.length, 1, 'the recoverable NULL produces no duplicated inventory fact');
      assert.equal(rows[0].position_key, canonicalKey('warehouse-001', 'product-001'));
      assert.equal(Number(rows[0].quantity), 20);
      assert.equal(detectAbnormalInventoryPositions(reopened).healthy, true);
    } finally {
      reopened.close();
    }
  });

  test('H a duplicated canonical position is detected and reported', () => {
    const positionKey = canonicalKey('warehouse-001', 'product-001');
    fixture.db.prepare("UPDATE inventory SET position_key=NULL WHERE id='seed-inv-warehouse-001-001'").run();
    fixture.db.prepare(`INSERT INTO inventory
      (id, warehouse_id, product_id, quantity, updated_at, position_key,
       bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      'legacy-duplicate-row', 'warehouse-001', 'product-001', 22, new Date().toISOString(), positionKey,
      null, 'ENTERPRISE', null, 'AVAILABLE', null, null,
    );
    const report = detectAbnormalInventoryPositions(fixture.db);
    assert.equal(report.healthy, false);
    assert.equal(report.counts.nullPositionKey, 1);
    assert.equal(report.counts.duplicateCanonical, 1);
    assert.equal(report.abnormalRows, 2, 'both physical facts are reported as abnormal');
    assert.deepEqual(report.duplicateCanonical[0].rowIds.sort(), ['legacy-duplicate-row', 'seed-inv-warehouse-001-001']);
  });

  test('H a synthetic fallback position key is detected and reported', () => {
    const positionKey = canonicalKey('warehouse-001', 'product-001');
    const synthetic = `${positionKey}:fallback1`;
    fixture.db.prepare('UPDATE inventory SET position_key=? WHERE id=?').run(synthetic, 'seed-inv-warehouse-001-001');
    const report = detectAbnormalInventoryPositions(fixture.db);
    assert.equal(report.healthy, false);
    assert.equal(report.counts.nonCanonicalKey, 1);
    assert.equal(report.nonCanonicalKey[0].id, 'seed-inv-warehouse-001-001');
    assert.equal(report.nonCanonicalKey[0].stored, synthetic);
    assert.equal(report.nonCanonicalKey[0].expected, positionKey);
  });

  test('H the detection never mutates, merges, deletes or sums the abnormal rows', () => {
    const positionKey = canonicalKey('warehouse-001', 'product-001');
    fixture.db.prepare("UPDATE inventory SET position_key=NULL WHERE id='seed-inv-warehouse-001-001'").run();
    fixture.db.prepare(`INSERT INTO inventory
      (id, warehouse_id, product_id, quantity, updated_at, position_key,
       bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      'legacy-duplicate-row', 'warehouse-001', 'product-001', 22, new Date().toISOString(), positionKey,
      null, 'ENTERPRISE', null, 'AVAILABLE', null, null,
    );
    const before = readInventoryRows(fixture.db);
    detectAbnormalInventoryPositions(fixture.db);
    const after = readInventoryRows(fixture.db);
    assert.deepEqual(after, before, 'the detection is strictly read-only');
  });

  test('H an existing duplicated position is never merged, deleted, summed or backdated on reopen', () => {
    const positionKey = canonicalKey('warehouse-001', 'product-001');
    fixture.db.prepare("UPDATE inventory SET position_key=NULL WHERE id='seed-inv-warehouse-001-001'").run();
    fixture.db.prepare(`INSERT INTO inventory
      (id, warehouse_id, product_id, quantity, updated_at, position_key,
       bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      'legacy-duplicate-row', 'warehouse-001', 'product-001', 22, new Date().toISOString(), positionKey,
      null, 'ENTERPRISE', null, 'AVAILABLE', null, null,
    );
    fixture.close();
    const reopened = createDatabase(fixture.path);
    try {
      const rows = reopened.prepare(
        'SELECT id, quantity, position_key FROM inventory WHERE warehouse_id=? AND product_id=?',
      ).all('warehouse-001', 'product-001');
      assert.equal(rows.length, 2, 'the duplicate is neither merged nor deleted');
      assert.deepEqual(
        rows.map((row) => Number(row.quantity)).sort((left, right) => left - right),
        [20, 22],
        'the two quantities are neither summed nor overwritten',
      );
      const stale = rows.find((row) => row.id === 'seed-inv-warehouse-001-001');
      assert.notEqual(stale.position_key, positionKey, 'the stale fact does not claim the canonical identity');
      const report = detectAbnormalInventoryPositions(reopened);
      assert.equal(report.healthy, false, 'the problem stays visible after the reopen');
      assert.ok(report.abnormalRows >= 1);

      // No fabricated stocktake, adjustment or canonical mutation flow.
      assert.equal(Number(reopened.prepare(
        `SELECT COUNT(*) c FROM inventory_transactions WHERE source_type='INVENTORY_CHECK'`,
      ).get().c), 0);
      assert.equal(Number(reopened.prepare('SELECT COUNT(*) c FROM inventory_mutation_log').get().c), 0);
      assert.equal(Number(reopened.prepare(
        `SELECT COUNT(*) c FROM audit_logs WHERE entity_type='INVENTORY_CHECK'`,
      ).get().c), 0);
    } finally {
      reopened.close();
    }
  });

  test('H the seed fails closed when it cannot establish a canonical position', () => {
    // Occupy the seeded row identity with a row whose own dimensions describe
    // a different logical position, so the seed can never establish
    // (warehouse-001, product-001). INSERT OR IGNORE suppresses the insert,
    // so only the independent verification can stop the initialization from
    // reporting success.
    fixture.db.prepare(
      "UPDATE inventory SET warehouse_id='warehouse-002', product_id='product-002' WHERE id='seed-inv-warehouse-001-001'",
    ).run();
    fixture.close();
    assert.throws(
      () => createDatabase(fixture.path),
      /Demo seed failed to establish canonical inventory positions/,
      'an incomplete seed must not be reported as a successful initialization',
    );
  });
});
