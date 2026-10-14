// Sales & Customer Wave 1 — REAL MySQL existing-database additive
// upgrade evidence.
//
// PHASE A — Establish a genuine pre-Wave-1 fixture.
//
//   The test uses the existing protected test database (the one
//   identified by ERP_DB_NAME). Before any Wave-1 work runs:
//
//     1. Any leftover Wave-1 tables from a previous suite run are
//        dropped (idempotent). The canonical concurrency gate drops
//        ALL tables between suites, so under the gate the DB is empty
//        when this test starts.
//     2. The canonical SQLite snapshot is captured via
//        `captureSqliteSnapshot(createDatabase, true)`. The public
//        `createDatabase(filename)` factory runs the full canonical
//        migration chain on a temporary SQLite file inside os.tmpdir()
//        and seeds demo data (because seedDemo=true). The capture
//        helper deletes the temp file as soon as the snapshot is
//        captured.
//     3. The eight Wave-1 tables are filtered out of the captured
//        snapshot. The filtered snapshot is the pre-Wave-1 schema +
//        legacy seed data + nothing else.
//     4. `bootstrapMySql(adapter, preWave1Snapshot)` creates the
//        pre-Wave-1 schema + seed rows in the test database.
//     6. The adapter is closed. The DB now contains a representative
//        set of pre-Wave-1 legacy rows. The fixture is read-only from
//        here on: no more writes happen to the fixture connection.
//
//   PRE-Wave-1 invariants asserted:
//
//     * dialect is mysql (real MySQL, not SQLite)
//     * the eight Wave-1 tables do NOT exist
//     * selected representative business tables (customers, products,
//       sales_orders, sales_order_items, audit_logs, users, …) contain
//       rows; remaining pre-Wave-1 tables preserve their (zero or more)
//       row count snapshot
//     * `mysql_backend_metadata.version` row exists with a non-Wave-1
//       marker (columns exactly are `version` / `completed_at`)
//     * `mysql_transaction_gates.gate_id=1` row exists
//     * a small set of stable legacy IDs and full representative row
//       fields are snapshotted for post-upgrade identity comparison
//
// PHASE B — Execute the canonical upgrade.
//
//   The pre-Wave-1 adapter is closed. The production `createDatabase()`
//   factory is invoked against the same database. That factory:
//
//     * opens a fresh MySqlSyncAdapter against the same database
//     * calls `bootstrapMySql(adapter, fullSnapshot)` which detects an
//       existing schema and runs `planMySqlAdditiveReconciliation` —
//       ONLY the eight Wave-1 tables are added; no existing pre-Wave-1
//       table is rewritten; no Wave-1 row touches a pre-Wave-1 row
//     * calls `migrateV14E2BusinessDate(adapter)` (idempotent)
//     * calls the production `migrateSalesCustomerDomain(adapter)` step
//       (idempotent — every CREATE TABLE IF NOT EXISTS is a no-op
//       because the additive reconciliation already added the tables)
//
//   POST-Wave-1 invariants asserted:
//
//     * exactly the eight Wave-1 tables exist
//     * no Wave-2+ Sales table exists
//     * every pre-Wave-1 row count is unchanged (no data loss)
//     * representative pre-Wave-1 rows are byte-identical
//     * Wave-1 foreign keys point to pre-existing Master / Platform
//       tables (information_schema.KEY_COLUMN_USAGE — REFERENCED_TABLE
//       _NAME is NOT in TABLE_CONSTRAINTS)
//     * UNIQUE / CHECK constraints on Wave-1 tables are intact
//     * `mysql_transaction_gates` row unchanged
//     * `mysql_backend_metadata` columns are still exactly
//       `[version, completed_at]` (no schema_version column was
//       introduced)
//
//   Replay: a second canonical `createDatabase()` invocation confirms
//   the factory is replay-idempotent.
//
// PRIVILEGES / ISOLATION.
//
//   This test uses the existing protected test database
//   (ERP_DB_NAME). It does NOT issue `CREATE DATABASE` or
//   `DROP DATABASE` — those commands require an elevated privilege
//   the protected test user does not necessarily hold. The test instead
//   drops only its own leftover Wave-1 tables in `before()` and leaves
//   the post-upgrade state behind for subsequent suites (the
//   concurrency gate drops ALL tables between suites). If the protected
//   DB already has Wave-1 rows from a previous in-session run, the
//   additive reconciliation preserves them — the test only asserts
//   that the schema is intact and the pre-Wave-1 row counts are
//   preserved.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { createDatabase } from './db.js';
import { bootstrapMySql, captureSqliteSnapshot } from './database/mysql-schema.js';
import { resolveDatabaseConfig } from './database/config.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import { SALES_WAVE1_TABLES } from './migrations/sales-customer-wave1-foundation.js';

const WAVE2_PLUS_TABLES = [
  'sales_quotations', 'sales_quotation_lines', 'sales_quotation_conversions',
  'sales_price_lists', 'sales_price_list_entries', 'sales_price_list_versions',
  'sales_discount_schemes', 'sales_discount_scheme_rules',
  'sales_order_changes', 'sales_order_change_lines',
  'delivery_notices', 'delivery_notice_lines',
  'sales_order_replacements', 'sales_order_replacement_lines',
  'sales_prepayment_requirements', 'sales_prepayment_gate_results',
  'sales_reservation_intent', 'service_fulfillments',
  'consignment_commercial_documents', 'consignment_commercial_lines',
  'consignment_commodity_locations',
  'credit_parameters', 'credit_check_rules', 'credit_policy_snapshots',
  'credit_profile', 'credit_profile_ratings', 'credit_special_approval',
  'credit_check_results',
  'credit_evaluation_indicator', 'credit_evaluation_scheme',
  'credit_evaluation_model', 'credit_evaluation_scoring_sheet',
  'credit_evaluation_result', 'credit_recalculation_history',
  'credit_lock_anchors',
];

// Tables the test snapshots + asserts are NON-empty in the pre-Wave-1
// fixture. These tables are seeded by the canonical demo seed, satisfy
// all required foreign keys, and represent real, legal pre-Wave-1
// business data. Their identity (specific stable IDs) is preserved
// byte-for-byte through the upgrade.
//
// IMPORTANT: this list reflects exactly what `seedDemoData()` in
// server/db.js inserts. The canonical demo seed does NOT touch
// sales_deliveries / purchase_receipts / sales_quotations / ... — those
// tables are empty on a freshly-seeded pre-Wave-1 database. The
// preflight assertion below verifies this from the actual snapshot
// instead of assuming it.
const REQUIRED_REPRESENTATIVE_TABLES = Object.freeze([
  'customers',
  'products',
  'suppliers',
  'warehouses',
  'sales_orders',
  'sales_order_items',
  'audit_logs',
  'roles',
  'permissions',
  'role_permissions',
  'users',
  'inventory',
]);

// Additional pre-Wave-1 tables whose row counts must be preserved
// across the upgrade even if the count is zero. Includes the legal
// empty tables that the canonical demo seed does not populate.
const COUNT_PRESERVED_TABLES = Object.freeze([
  'account_receivables',
  'account_payables',
  'payment_collections',
  'payment_disbursements',
  'cash_journals',
  'bank_accounts',
  'bills',
  'approval_requests',
  'purchase_orders',
  'purchase_order_items',
  'sales_deliveries',
  'sales_delivery_items',
  'purchase_receipts',
  'purchase_receipt_items',
  'return_orders',
  'return_order_items',
  'purchase_returns',
  'purchase_return_items',
  'boms',
  'bom_items',
  'production_orders',
  'production_order_items',
  'production_outputs',
  'inventory_checks',
  'inventory_check_items',
  'inventory_transfers',
  'inventory_transfer_items',
  'inventory_adjustments',
  'inventory_adjustment_items',
  'inventory_transactions',
]);

// Canonical MySQL 8 source for FK target identity. REFERENCED_TABLE_NAME
// does NOT exist in information_schema.TABLE_CONSTRAINTS — it lives in
// KEY_COLUMN_USAGE.
const FK_QUERY = `SELECT COUNT(*) n FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
    AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=?`;

// Stable pre-Wave-1 legacy IDs that the canonical demo seed produces.
// These are used by Phase A's preflight to verify the captured
// snapshot actually contains the rows the post-upgrade Phase B test
// expects to compare against.
const REQUIRED_PRE_WAVE_1_IDS = Object.freeze({
  customers: ['customer-001', 'customer-002', 'customer-003'],
  products: ['product-001', 'product-002', 'product-003', 'product-004', 'product-005'],
  suppliers: ['supplier-001', 'supplier-002', 'supplier-003'],
  warehouses: ['warehouse-001', 'warehouse-002'],
  users: ['user-admin', 'user-sales', 'user-reviewer', 'user-warehouse', 'user-accounting'],
  roles: ['role-admin', 'role-sales', 'role-reviewer', 'role-warehouse', 'role-accounting'],
  sales_orders: ['order-demo-001'],
  sales_order_items: ['item-demo-001', 'item-demo-002'],
});

// SQLite-only preflight that runs BEFORE any MySQL connection. It
// captures the canonical snapshot via the public `createDatabase`
// factory + `seedDemo=true`, prints the actual row counts for every
// required representative and count-preserved table, asserts every
// required pre-Wave-1 table exists in the snapshot with seeded rows,
// asserts every Wave-1 table has been filtered out, and asserts every
// fixed legacy ID appears in the captured rows. It does NOT touch the
// protected MySQL database.
//
// Returns the filtered pre-Wave-1 snapshot for the calling test hook
// to bootstrap into the upgrade-test database.
function runSqlitePreflight() {
  const fullSnapshot = captureSqliteSnapshot(createDatabase, true);
  assert.ok(fullSnapshot.tables.length > 0,
    'captureSqliteSnapshot must produce at least one table');
  const filtered = {
    tables: fullSnapshot.tables.filter((table) => !SALES_WAVE1_TABLES.includes(table.name)),
  };
  assert.ok(filtered.tables.length > 0,
    'filtered pre-Wave-1 snapshot must contain at least one canonical table');
  for (const t of SALES_WAVE1_TABLES) {
    assert.equal(filtered.tables.some((table) => table.name === t), false,
      `Wave-1 table ${t} must not appear in the pre-Wave-1 snapshot`);
  }

  // Index snapshot tables for fast lookup.
  const byName = new Map(filtered.tables.map((table) => [table.name, table]));
  for (const required of REQUIRED_REPRESENTATIVE_TABLES) {
    const table = byName.get(required);
    assert.ok(table, `pre-Wave-1 snapshot must include ${required}`);
    assert.ok(table.rows.length > 0,
      `pre-Wave-1 snapshot must carry seeded rows for ${required} (got ${table.rows.length})`);
  }

  // Per-table row-count summary (printed for human review and asserted
  // for test-data / historical-data distinction).
  const summary = {};
  for (const table of [...REQUIRED_REPRESENTATIVE_TABLES, ...COUNT_PRESERVED_TABLES]) {
    const t = byName.get(table);
    summary[table] = t ? t.rows.length : 0;
  }
  console.log('SQLITE SNAPSHOT PREFLIGHT (pre-Wave-1 filtered, before any MySQL connection):');
  for (const [table, count] of Object.entries(summary)) {
    console.log(`  ${table}: ${count} row(s)`);
  }

  // Verify every REQUIRED_REPRESENTATIVE_TABLES entry reports a
  // strictly positive row count from the snapshot.
  for (const required of REQUIRED_REPRESENTATIVE_TABLES) {
    const count = summary[required];
    assert.ok(count > 0,
      `REQUIRED_REPRESENTATIVE_TABLES entry ${required} must have rows in the captured snapshot, got ${count}`);
  }
  // Verify every COUNT_PRESERVED_TABLES entry is at least defined
  // (count may legitimately be zero).
  for (const preserved of COUNT_PRESERVED_TABLES) {
    assert.ok(byName.has(preserved),
      `COUNT_PRESERVED_TABLES entry ${preserved} must exist in the captured snapshot`);
  }

  // Verify fixed legacy IDs are present.
  for (const [table, ids] of Object.entries(REQUIRED_PRE_WAVE_1_IDS)) {
    const t = byName.get(table);
    assert.ok(t, `pre-Wave-1 snapshot must include ${table}`);
    const idColumn = table === 'sales_order_items' ? 'id' : 'id';
    const actualIds = new Set(t.rows.map((row) => String(row[idColumn])));
    for (const requiredId of ids) {
      assert.ok(actualIds.has(requiredId),
        `pre-Wave-1 snapshot must contain ${table}.id='${requiredId}' (missing from seeded fixture)`);
    }
  }

  return filtered;
}

describe('Sales & Customer Wave 1 — real existing-MySQL additive upgrade (Phase A + Phase B)', () => {
  let preWave1Snapshot;
  let preWave1RowCounts;
  let preWave1StableRows;

  before(async () => {
    // ── Step 0 — fail-closed environment gate.
    if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
      throw new Error('Existing-MySQL upgrade test requires ERP_MYSQL_TEST_ALLOW_RESET=true');
    }
    assert.equal(process.env.ERP_DB_BACKEND, 'mysql', 'upgrade test must run with ERP_DB_BACKEND=mysql');
    const config = resolveDatabaseConfig({ backend: 'mysql' });
    if (!/(?:test|phase7[abc]|disposable)/i.test(config.database)) {
      throw new Error(
        `Refusing MySQL upgrade test for non-disposable database: ${config.database}. `
        + `The test only accepts a protected disposable DB; the gate must have already reset it.`,
      );
    }

    // ── Step 1 — SQLite-only preflight. NO MySQL connection is opened
    // before this completes.
    preWave1Snapshot = runSqlitePreflight();

    // ── Step 2 — verify the protected test DB is empty before any
    // mutation. The gate is responsible for the reset; this test only
    // asserts it. Any pre-existing data is a hard STOP. We do NOT
    // issue DROP DATABASE / DROP TABLE here — that is the gate's job.
    let preCheckAdapter = null;
    try {
      preCheckAdapter = openUpgradeAdapter(config.database);
      assert.equal(preCheckAdapter.dialect, 'mysql', 'pre-flight adapter must speak MySQL');
      const actualDb = preCheckAdapter.dialect === 'mysql'
        ? preCheckAdapter.prepare('SELECT DATABASE() AS db').get().db
        : null;
      if (actualDb !== config.database) {
        throw new Error(
          `SELECT DATABASE()=${actualDb} does not match expected ${config.database}. `
          + `Refusing to bootstrap pre-Wave-1 fixture into a different DB.`,
        );
      }
      const existingTables = preCheckAdapter.prepare('SHOW TABLES').all().map((row) => Object.values(row)[0]);
      if (existingTables.length > 0) {
        throw new Error(
          `STOP / NO DESTRUCTIVE ACTION: protected test DB ${config.database} is not empty before upgrade test starts. `
          + `Existing tables: ${existingTables.join(', ')}. `
          + `The MySQL gate must have already reset the schema; this test refuses to silently wipe data.`,
        );
      }
      const remainingWave1 = preCheckAdapter.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${SALES_WAVE1_TABLES.map(() => '?').join(',')})`).all(...SALES_WAVE1_TABLES);
      assert.deepEqual(remainingWave1, [], 'no Wave-1 table may exist in the protected DB before this test runs');
      const remainingWave2 = preCheckAdapter.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${WAVE2_PLUS_TABLES.map(() => '?').join(',')})`).all(...WAVE2_PLUS_TABLES);
      assert.deepEqual(remainingWave2, [], 'no Wave-2+ table may exist in the protected DB before this test runs');
    } finally {
      try { preCheckAdapter?.close(); } catch { /* ignore */ }
    }

    // ── Step 3 — bootstrap the pre-Wave-1 fixture into the now-empty
    // protected test DB. This step does NOT issue DROP DATABASE /
    // DROP TABLE — the gate already cleared the schema.
    let bootstrapAdapter = null;
    try {
      bootstrapAdapter = openUpgradeAdapter(config.database);
      bootstrapMySql(bootstrapAdapter, preWave1Snapshot);
    } finally {
      try { bootstrapAdapter?.close(); } catch { /* ignore */ }
    }
  });

  after(() => { /* no DB-level teardown — gate drops all tables between suites */ });

  // Phase A: pre-Wave-1 fixture is built and asserted on a fresh
  // connection. The adapter opens on the existing protected test DB
  // and reads the schema state.
  describe('Phase A — pre-Wave-1 fixture invariants', () => {
    let preDb;
    before(() => {
      preDb = openUpgradeAdapter(resolveDatabaseConfig({ backend: 'mysql' }).database);
      assert.equal(preDb.dialect, 'mysql');
    });
    after(() => { try { preDb?.close(); } catch { /* ignore */ } });

    test('A-1 dialect is real MySQL and the eight Wave-1 tables do NOT exist', () => {
      assert.equal(preDb.dialect, 'mysql');
      const placeholders = SALES_WAVE1_TABLES.map(() => '?').join(',');
      const rows = preDb.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`).all(...SALES_WAVE1_TABLES);
      assert.deepEqual(rows, [], 'pre-Wave-1 fixture must not contain any Wave-1 table');
    });

    test('A-2 representative pre-Wave-1 business tables contain seeded rows', () => {
      for (const table of REQUIRED_REPRESENTATIVE_TABLES) {
        const count = Number(preDb.prepare(`SELECT COUNT(*) n FROM \`${table}\``).get().n);
        assert.ok(count > 0,
          `pre-Wave-1 fixture must contain seeded rows in ${table}, got ${count}`);
      }
    });

    test('A-3 other pre-Wave-1 tables preserve their row counts (incl. legitimately zero)', () => {
      // Snapshot every required-representative + count-preserved table
      // once. The post-upgrade test asserts the same counts.
      preWave1RowCounts = {};
      for (const table of [...REQUIRED_REPRESENTATIVE_TABLES, ...COUNT_PRESERVED_TABLES]) {
        preWave1RowCounts[table] = Number(preDb.prepare(`SELECT COUNT(*) n FROM \`${table}\``).get().n);
      }
      assert.ok(Object.keys(preWave1RowCounts).length > 0,
        'pre-Wave-1 row-count snapshot must cover every tracked table');
    });

    test('A-4 mysql_backend_metadata row exists with the canonical (version, completed_at) shape', () => {
      // mysql_backend_metadata has columns (version, completed_at) only.
      // No `schema_version` column exists or is introduced.
      const columns = preDb.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mysql_backend_metadata' ORDER BY ORDINAL_POSITION`).all();
      const names = columns.map((row) => row.name);
      assert.deepEqual(names, ['version', 'completed_at'],
        `mysql_backend_metadata columns must be exactly [version, completed_at], got ${JSON.stringify(names)}`);
      const rows = preDb.prepare('SELECT version, completed_at FROM mysql_backend_metadata').all();
      assert.ok(rows.length >= 1, 'mysql_backend_metadata row must exist');
      const version = String(rows[0].version);
      assert.ok(!/wave/i.test(version),
        `pre-Wave-1 fixture version ${version} must not mention wave`);
    });

    test('A-5 mysql_transaction_gates row exists', () => {
      const row = preDb.prepare('SELECT COUNT(*) n FROM mysql_transaction_gates WHERE gate_id=1').get();
      assert.equal(Number(row.n), 1, 'pre-Wave-1 fixture must include the canonical transaction gate row');
    });

    test('A-6 stable legacy IDs and full representative business fields are snapshotted', () => {
      // Sample one stable, pre-Wave-1 row by primary key for tables
      // that have demo seed data. The full row (or a representative
      // subset) is snapshotted so the post-upgrade test can assert
      // byte-equality.
      preWave1StableRows = {
        customerId: preDb.prepare("SELECT id, code, name, contact, phone, address, active FROM customers WHERE id='customer-001'").get(),
        productId: preDb.prepare("SELECT id, code, name, category, unit, price_cents, stock_quantity, active FROM products WHERE id='product-001'").get(),
        userId: preDb.prepare("SELECT id, username, display_name, role_id, active FROM users WHERE id='user-admin'").get(),
        auditId: preDb.prepare("SELECT id, user_id, action, entity_type, entity_id, detail, created_at FROM audit_logs ORDER BY created_at LIMIT 1").get(),
        salesOrder: preDb.prepare("SELECT id, order_no, customer_id, status, total_cents FROM sales_orders LIMIT 1").get(),
        // NOTE: salesperson_profiles / salesperson_group_memberships are Wave-1
        // tables and intentionally do NOT appear in the pre-Wave-1 stable
        // row set. Salesperson identity is verified after the upgrade as a
        // forward-only check, never as historical pre-Wave-1 evidence.
      };
      assert.ok(preWave1StableRows.customerId, 'customer-001 must exist');
      assert.ok(preWave1StableRows.productId, 'product-001 must exist');
      assert.ok(preWave1StableRows.userId, 'user-admin must exist');
      assert.ok(preWave1StableRows.auditId, 'an audit row must exist');
      assert.ok(preWave1StableRows.salesOrder, 'a sales order must exist');
    });

    test('A-7 pre-Wave-1 row-count snapshot covers every tracked table', () => {
      // The Phase A/B list of REQUIRED_REPRESENTATIVE_TABLES and
      // COUNT_PRESERVED_TABLES is the upgrade test's authoritative
      // inventory. Phase A must snapshot a row count for EVERY one of
      // them; Phase B then asserts every count is preserved. If the
      // snapshot silently omits a table (for example because a count
      // was zero at pre-Wave-1 time and a future regression dropped
      // it), Phase B would pass against a stale map. This assertion
      // verifies the map covers every tracked table at the moment of
      // capture.
      const expectedKeys = [...REQUIRED_REPRESENTATIVE_TABLES, ...COUNT_PRESERVED_TABLES].sort();
      const actualKeys = Object.keys(preWave1RowCounts || {}).sort();
      assert.deepEqual(actualKeys, expectedKeys,
        'pre-Wave-1 row-count snapshot must cover every tracked table');
      for (const table of expectedKeys) {
        const count = preWave1RowCounts[table];
        assert.ok(Number.isSafeInteger(count),
          `${table} row count must be a safe integer; got ${count}`);
        assert.ok(count >= 0,
          `${table} row count must be >= 0; got ${count}`);
      }
    });
  });

  // Phase B: canonical upgrade. The pre-Wave-1 adapter is closed before
  // invoking createDatabase(); the upgrade runs on a brand-new session
  // exactly as a real existing-MySQL startup would.
  describe('Phase B — canonical existing-MySQL upgrade', () => {
    let upgraded;
    before(() => {
      upgraded = createDatabase({ backend: 'mysql', database: resolveDatabaseConfig({ backend: 'mysql' }).database });
      assert.equal(upgraded.dialect, 'mysql');
    });
    after(() => { try { upgraded?.close(); } catch { /* ignore */ } });

    test('B-1 exactly the eight Wave-1 tables are materialised by the canonical upgrade', () => {
      const expected = [...SALES_WAVE1_TABLES].sort();
      const placeholders = expected.map(() => '?').join(',');
      const rows = upgraded.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME`).all(...expected);
      assert.deepEqual(rows.map((row) => row.name), expected);
    });

    test('B-2 no Wave-2+ Sales table is materialised by the canonical upgrade', () => {
      const placeholders = WAVE2_PLUS_TABLES.map(() => '?').join(',');
      const rows = upgraded.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`).all(...WAVE2_PLUS_TABLES);
      assert.deepEqual(rows, [], 'Wave-2+ tables must not appear after the canonical upgrade');
    });

    test('B-3 representative pre-Wave-1 table row counts are preserved (no data loss)', () => {
      for (const table of REQUIRED_REPRESENTATIVE_TABLES) {
        const count = Number(upgraded.prepare(`SELECT COUNT(*) n FROM \`${table}\``).get().n);
        assert.ok(count > 0,
          `${table} must still contain rows after the additive upgrade, got ${count}`);
        assert.equal(count, preWave1RowCounts[table],
          `${table} row count must be preserved by the additive upgrade`);
      }
    });

    test('B-4 other pre-Wave-1 table row counts are preserved (incl. legitimately zero)', () => {
      for (const table of COUNT_PRESERVED_TABLES) {
        const count = Number(upgraded.prepare(`SELECT COUNT(*) n FROM \`${table}\``).get().n);
        assert.equal(count, preWave1RowCounts[table],
          `${table} row count must be preserved by the additive upgrade`);
      }
    });

    test('B-5 stable legacy rows are byte-identical to the pre-Wave-1 fixture', () => {
      const customerAfter = upgraded.prepare("SELECT id, code, name, contact, phone, address, active FROM customers WHERE id='customer-001'").get();
      const productAfter = upgraded.prepare("SELECT id, code, name, category, unit, price_cents, stock_quantity, active FROM products WHERE id='product-001'").get();
      const userAfter = upgraded.prepare("SELECT id, username, display_name, role_id, active FROM users WHERE id='user-admin'").get();
      const auditAfter = upgraded.prepare("SELECT id, user_id, action, entity_type, entity_id, detail, created_at FROM audit_logs ORDER BY created_at LIMIT 1").get();
      const salesOrderAfter = upgraded.prepare("SELECT id, order_no, customer_id, status, total_cents FROM sales_orders LIMIT 1").get();
      assert.deepEqual(customerAfter, preWave1StableRows.customerId);
      assert.deepEqual(productAfter, preWave1StableRows.productId);
      assert.deepEqual(userAfter, preWave1StableRows.userId);
      assert.deepEqual(auditAfter, preWave1StableRows.auditId);
      assert.deepEqual(salesOrderAfter, preWave1StableRows.salesOrder);
    });

    test('B-6 Wave-1 foreign keys point to pre-existing Master / Platform tables', () => {
      // Canonical MySQL 8 source. The previous version queried
      // information_schema.TABLE_CONSTRAINTS for REFERENCED_TABLE_NAME
      // — that column does NOT exist there.
      const expectedFks = [
        ['customer_commercial_extensions', 'customers'],
        ['customer_material_xref', 'customers'],
        ['customer_material_xref', 'products'],
        ['customer_material_xref', 'uoms'],
        ['product_commercial_classification', 'products'],
        ['product_commercial_classification', 'uoms'],
        ['salesperson_group_memberships', 'salesperson_profiles'],
        ['salesperson_group_memberships', 'sales_groups'],
        ['salesperson_profiles', 'users'],
      ];
      for (const [child, parent] of expectedFks) {
        const row = upgraded.prepare(FK_QUERY).get(child, parent);
        assert.ok(Number(row.n) >= 1, `${child} must declare a foreign key to ${parent}`);
      }
    });

    test('B-7 Wave-1 UNIQUE constraints are intact after the upgrade', () => {
      const probes = [
        { table: 'sales_groups', column: 'group_code' },
        { table: 'salesperson_profiles', column: 'salesperson_code' },
        { table: 'salesperson_profiles', column: 'user_id' },
      ];
      for (const { table, column } of probes) {
        const rows = upgraded.prepare(`SELECT INDEX_NAME FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND NON_UNIQUE=0`).all(table, column);
        assert.ok(rows.length >= 1, `${table}.${column} must remain UNIQUE after upgrade`);
      }
    });

    test('B-8 CHECK constraints on Wave-1 tables are enforced after the upgrade', () => {
      let rejected = false;
      try {
        upgraded.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
          VALUES('wave1-upg-bad','enforced','enforced','',2,?,?)`).run(new Date().toISOString(), new Date().toISOString());
      } catch (error) {
        rejected = /check constraint|ER_CHECK_CONSTRAINT/i.test(String(error.message));
      }
      assert.equal(rejected, true, 'CHECK constraint must reject active=2');
      upgraded.prepare("DELETE FROM sales_groups WHERE id='wave1-upg-bad'").run();
    });

    test('B-9 mysql_transaction_gates row is intact after the canonical upgrade', () => {
      const row = upgraded.prepare('SELECT COUNT(*) n FROM mysql_transaction_gates WHERE gate_id=1').get();
      assert.equal(Number(row.n), 1, 'transaction gate row must exist after upgrade');
    });

    test('B-10 mysql_backend_metadata row is preserved (no schema_version column introduced)', () => {
      const rows = upgraded.prepare(`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mysql_backend_metadata' ORDER BY ORDINAL_POSITION`).all();
      const names = rows.map((row) => row.name);
      assert.deepEqual(names, ['version', 'completed_at'],
        `mysql_backend_metadata columns must be exactly [version, completed_at], got ${JSON.stringify(names)}`);
    });
  });

  // Final replay: a second createDatabase on the same target.
  describe('Replay idempotency — second createDatabase on the same target', () => {
    let upgradedAgain;
    before(() => {
      upgradedAgain = createDatabase({ backend: 'mysql', database: resolveDatabaseConfig({ backend: 'mysql' }).database });
    });
    after(() => { try { upgradedAgain?.close(); } catch { /* ignore */ } });

    test('R-PHP-1 a second canonical createDatabase() replay does not duplicate rows or tables', async () => {
      const executed = migrateSalesCustomerDomain(upgradedAgain);
      assert.deepEqual(executed, ['wave-1-commercial-foundation']);

      // Row counts must still match the post-upgrade values.
      for (const table of [...REQUIRED_REPRESENTATIVE_TABLES, ...COUNT_PRESERVED_TABLES]) {
        const count = Number(upgradedAgain.prepare(`SELECT COUNT(*) n FROM \`${table}\``).get().n);
        assert.equal(count, preWave1RowCounts[table],
          `${table} row count must be preserved after migration replay`);
      }
      // The eight Wave-1 tables must still be present, no duplicates.
      const expected = [...SALES_WAVE1_TABLES].sort();
      const placeholders = expected.map(() => '?').join(',');
      const rows = upgradedAgain.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME`).all(...expected);
      assert.deepEqual(rows.map((row) => row.name), expected);
    });
  });
});

function openUpgradeAdapter(database) {
  return new MySqlSyncAdapter({ ...resolveDatabaseConfig({ backend: 'mysql' }), database });
}