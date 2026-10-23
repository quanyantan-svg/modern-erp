import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createDatabase } from './db.js';
import {
  SALES_CUSTOMER_MIGRATIONS,
  migrateSalesCustomerDomain,
  runSalesCustomerMigrations,
} from './migrations/sales-customer-domain.js';
import { SALES_WAVE1_TABLES } from './migrations/sales-customer-wave1-foundation.js';
import { SALES_WAVE2_TABLES } from './migrations/sales-customer-wave2-pricing.js';
import { SALES_WAVE6_TABLES } from './migrations/sales-customer-wave6-returns.js';
import { SALES_WAVE8_TABLES } from './migrations/sales-customer-wave8-service-consignment.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import { createTempDir } from './test-utils/temp-db.js';

const BATCH_A_TABLES = [
  'sales_quotations',
  'sales_quotation_lines',
  'sales_quotation_conversions',
  'sales_order_changes',
  'sales_order_change_lines',
  'delivery_notices',
  'delivery_notice_lines',
];

const WAVE10_PLUS_SALES_TABLES = [
  'credit_special_approval',
  'credit_check_results',
  'credit_evaluation_indicator',
  'credit_evaluation_scheme',
  'credit_evaluation_model',
  'credit_evaluation_scoring_sheet',
  'credit_evaluation_result',
  'credit_recalculation_history',
];

// This fixture deliberately remains bounded at Wave 8. It proves that the
// historical Wave 8 acceptance boundary did not silently expand when the
// production registry advanced to Wave 9.
const WAVE8_BOUNDED_STEPS = Object.freeze(
  SALES_CUSTOMER_MIGRATIONS.filter((step) => step.wave <= 8),
);

const BATCH_A_COLUMNS = {
  sales_orders: [
    'salesperson_id', 'sales_group_id', 'settlement_party_id', 'payer_id',
    'customer_material_xref_id', 'commercial_tax_code', 'tax_inclusive',
    'required_prepayment_cents', 'reservation_intent_state',
    'commercial_close_state', 'gift_summary_cents', 'commercial_pricing_uom_code', 'effective_version',
  ],
  sales_order_items: [
    'is_gift_line', 'commercial_tax_basis', 'tax_inclusive_assumption',
    'pricing_uom_code_applied', 'qty_break_applied_min', 'qty_break_applied_max',
    'planned_delivery_date', 'upper_delivery_tolerance_bps', 'lower_delivery_tolerance_bps',
    'price_snapshot_json', 'discount_snapshot_json',
  ],
  sales_deliveries: ['delivery_notice_id', 'source_mode'],
  sales_delivery_items: ['delivery_notice_line_id'],
};

function assertWave9ProductionSchema(db) {
  const wave1Placeholders = SALES_WAVE1_TABLES.map(() => '?').join(',');
  const wave1 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${wave1Placeholders}) ORDER BY name`).all(...SALES_WAVE1_TABLES);
  assert.deepEqual(wave1.map((row) => row.name), [...SALES_WAVE1_TABLES].sort());
  const wave2Placeholders = SALES_WAVE2_TABLES.map(() => '?').join(',');
  const wave2 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${wave2Placeholders}) ORDER BY name`).all(...SALES_WAVE2_TABLES);
  assert.deepEqual(wave2.map((row) => row.name), [...SALES_WAVE2_TABLES].sort());
  const placeholders = BATCH_A_TABLES.map(() => '?').join(',');
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders}) ORDER BY name`).all(...BATCH_A_TABLES);
  assert.deepEqual(tables.map((row) => row.name), [...BATCH_A_TABLES].sort());
  const wave6Placeholders = SALES_WAVE6_TABLES.map(() => '?').join(',');
  const wave6 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${wave6Placeholders}) ORDER BY name`).all(...SALES_WAVE6_TABLES);
  assert.deepEqual(wave6.map((row) => row.name), [...SALES_WAVE6_TABLES].sort());
  const wave8Placeholders = SALES_WAVE8_TABLES.map(() => '?').join(',');
  const wave8 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${wave8Placeholders}) ORDER BY name`).all(...SALES_WAVE8_TABLES);
  assert.deepEqual(wave8.map((row) => row.name), [...SALES_WAVE8_TABLES].sort());
  const wave9Placeholders = SALES_WAVE9_TABLES.map(() => '?').join(',');
  const wave9 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${wave9Placeholders}) ORDER BY name`).all(...SALES_WAVE9_TABLES);
  assert.deepEqual(wave9.map((row) => row.name), [...SALES_WAVE9_TABLES].sort());
  const futurePlaceholders = WAVE10_PLUS_SALES_TABLES.map(() => '?').join(',');
  const future = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${futurePlaceholders}) ORDER BY name`).all(...WAVE10_PLUS_SALES_TABLES);
  assert.deepEqual(future, [], 'Wave 9 must not create any Wave 10+ Sales table');
  const extensionColumns = new Set(db.prepare('PRAGMA table_info(customer_commercial_extensions)').all().map((row) => row.name));
  assert.equal(extensionColumns.has('default_pricing_list_id'), true);
  assert.equal(extensionColumns.has('default_discount_scheme_id'), true);

  for (const [table, expectedColumns] of Object.entries(BATCH_A_COLUMNS)) {
    const actual = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of expectedColumns) assert.equal(actual.has(column), true, `Batch A must add ${table}.${column}`);
  }
  assert.equal(new Set(db.prepare('PRAGMA table_info(return_orders)').all().map((row) => row.name)).has('commercial_source_marker'), true);
  assert.equal(new Set(db.prepare('PRAGMA table_info(return_order_items)').all().map((row) => row.name)).has('sales_order_item_id'), true);
  const sourceFk = db.prepare('PRAGMA foreign_key_list(return_order_items)').all().find((row) => row.from === 'sales_order_item_id');
  assert.equal(sourceFk?.table, 'sales_order_items');
  assert.equal(sourceFk?.to, 'id');
}

test('canonical production registry contains approved Wave 1 through Wave 9 steps and preserves the bounded Wave 8 fixture', () => {
  assert.equal(Object.values(BATCH_A_COLUMNS).flat().length, 27);
  assert.equal(Object.isFrozen(SALES_CUSTOMER_MIGRATIONS), true);
  assert.equal(SALES_CUSTOMER_MIGRATIONS.length, 9);
  assert.equal(SALES_CUSTOMER_MIGRATIONS[0].id, 'wave-1-commercial-foundation');
  assert.equal(SALES_CUSTOMER_MIGRATIONS[1].id, 'wave-2-pricing-discount');
  assert.deepEqual(SALES_CUSTOMER_MIGRATIONS.slice(2).map((step) => step.id), ['wave-3-quotation','wave-4-canonical-sales-order','wave-5-delivery-notice','wave-6-return-replacement','wave-7-prepayment-reservation','wave-8-service-consignment','wave-9-credit-foundation']);
  assert.equal(WAVE8_BOUNDED_STEPS.length, 8);
  assert.equal(WAVE8_BOUNDED_STEPS.at(-1).id, 'wave-8-service-consignment');
  assert.equal(WAVE8_BOUNDED_STEPS.some((step) => step.wave >= 9), false);
  const db = new DatabaseSync(':memory:');
  try {
    assert.deepEqual(runSalesCustomerMigrations(db, []), [], 'explicit empty fixture preserves historical Wave 0 semantics');
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
  } finally {
    db.close();
  }
});

test('injected steps run exactly once in deterministic wave/id order with the same adapter', () => {
  const db = { marker: 'same-adapter' };
  const calls = [];
  const steps = [
    { id: 'wave-2-b', wave: 2, migrate: (received) => calls.push(['wave-2-b', received]) },
    { id: 'wave-1-z', wave: 1, migrate: (received) => calls.push(['wave-1-z', received]) },
    { id: 'wave-1-a', wave: 1, migrate: (received) => calls.push(['wave-1-a', received]) },
  ];

  assert.deepEqual(runSalesCustomerMigrations(db, steps), ['wave-1-a', 'wave-1-z', 'wave-2-b']);
  assert.deepEqual(calls.map(([id]) => id), ['wave-1-a', 'wave-1-z', 'wave-2-b']);
  assert.equal(calls.every(([, received]) => received === db), true);
  assert.deepEqual(steps.map((step) => step.id), ['wave-2-b', 'wave-1-z', 'wave-1-a'], 'caller registry order is not mutated');
});

test('each explicit runner invocation executes each step once', () => {
  let executions = 0;
  const steps = [{ id: 'repeatable-test-step', wave: 1, migrate: () => { executions += 1; } }];
  runSalesCustomerMigrations({}, steps);
  runSalesCustomerMigrations({}, steps);
  assert.equal(executions, 2);
});

test('duplicate and invalid registry definitions fail before any step executes', () => {
  let executions = 0;
  const migrate = () => { executions += 1; };
  assert.throws(
    () => runSalesCustomerMigrations({}, [
      { id: 'duplicate', wave: 1, migrate },
      { id: 'duplicate', wave: 2, migrate },
    ]),
    /Duplicate Sales & Customer migration step id: duplicate/,
  );
  assert.throws(
    () => runSalesCustomerMigrations({}, [{ id: 'invalid-wave', wave: 14, migrate }]),
    /invalid wave/,
  );
  assert.throws(
    () => runSalesCustomerMigrations({}, [{ id: 'missing-migrate', wave: 1 }]),
    /requires migrate\(db\)/,
  );
  assert.equal(executions, 0);
});

test('migration errors propagate and stop later steps', () => {
  const calls = [];
  const expected = new Error('wave-step-failed');
  assert.throws(
    () => runSalesCustomerMigrations({}, [
      { id: '01-before', wave: 1, migrate: () => calls.push('before') },
      { id: '02-fail', wave: 1, migrate: () => { throw expected; } },
      { id: '03-after', wave: 1, migrate: () => calls.push('after') },
    ]),
    (error) => error === expected,
  );
  assert.deepEqual(calls, ['before']);
});

test('fresh SQLite and existing SQLite reopen execute through Wave 9 idempotently', () => {
  const dir = createTempDir('sales-wave0');
  const dbPath = join(dir, 'wave0.db');
  try {
    const fresh = createDatabase(dbPath);
    try {
      assertWave9ProductionSchema(fresh);
      assert.ok(fresh.prepare("SELECT 1 FROM pragma_table_info('sales_deliveries') WHERE name='billing_mode'").get(), 'existing billing_mode remains intact');
    } finally {
      fresh.close();
    }

    const reopened = createDatabase(dbPath);
    try {
      assertWave9ProductionSchema(reopened);
      assert.equal(reopened.prepare('SELECT 1 value').get().value, 1);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test('database factory wires the canonical runner after SQLite prerequisites and after live MySQL open', async () => {
  const source = await readFile(new URL('./db.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ migrateSalesCustomerDomain \} from '\.\/migrations\/sales-customer-domain\.js';/);

  const sqliteStart = source.indexOf('function createSqliteDatabase(filename)');
  const sqliteEnd = source.indexOf('\nfunction lateProcurementColumns', sqliteStart);
  const sqliteFactory = source.slice(sqliteStart, sqliteEnd);
  assert.ok(sqliteFactory.indexOf('ensureFinanceOpenItemEffectsView(db);') < sqliteFactory.indexOf('migrateSalesCustomerDomain(db);'));
  assert.ok(sqliteFactory.indexOf('migrateSalesCustomerDomain(db);') < sqliteFactory.lastIndexOf('return db;'));

  const factoryStart = source.indexOf('export function createDatabase(target)');
  const factoryEnd = source.indexOf('\n// Idempotent migration for purchase_receipts', factoryStart);
  const factory = source.slice(factoryStart, factoryEnd);
  assert.ok(factory.indexOf('const db = createMySqlDatabase') < factory.indexOf('migrateSalesCustomerDomain(db);'));
  assert.ok(factory.indexOf('migrateSalesCustomerDomain(db);') < factory.indexOf('return db;'));
  assert.match(factory, /catch \(error\) \{\s+db\.close\(\);\s+throw error;/);
});
