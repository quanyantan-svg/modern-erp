import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureSqliteSnapshot,
  planMySqlAdditiveReconciliation,
  planMySqlIndexReconciliation,
  readMySqlColumnNames,
  readMySqlIndexNames,
} from './database/mysql-schema.js';
import { createDatabase } from './db.js';

const ENGINEERING_TABLES = [
  'engineering_shifts',
  'engineering_shift_patterns',
  'engineering_calendar_templates',
  'engineering_work_calendars',
  'engineering_basic_activities',
  'engineering_workshop_formulas',
  'engineering_resources',
  'engineering_equipment',
  'engineering_operations',
  'engineering_control_codes',
  'engineering_substitute_schemes',
  'engineering_substitutes',
  'product_routing_operation_links',
  'engineering_change_orders',
  'engineering_change_items',
];

const ENGINEERING_INDEXES = [
  ['bom_items', 'idx_bom_items_product'],
  ['boms', 'idx_boms_product_purpose_status'],
  ['engineering_change_items', 'idx_engineering_change_items_change'],
  ['engineering_change_orders', 'idx_engineering_change_orders_status'],
  ['engineering_substitutes', 'idx_engineering_substitutes_primary'],
  ['engineering_substitutes', 'idx_engineering_substitutes_scheme'],
  ['product_routing_operation_links', 'idx_product_routing_operation_links_routing'],
];

test('MySQL snapshot contains all 15 additive engineering tables', () => {
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), false);
  const names = new Set(snapshot.tables.map((table) => table.name));
  for (const name of ENGINEERING_TABLES) assert.ok(names.has(name), `${name} missing from MySQL snapshot`);
  assert.equal(ENGINEERING_TABLES.length, 15);
});

test('existing complete MySQL schema receives missing engineering tables and additive columns', () => {
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), false);
  const boms = snapshot.tables.find((table) => table.name === 'boms');
  const bomItems = snapshot.tables.find((table) => table.name === 'bom_items');
  const workCenters = snapshot.tables.find((table) => table.name === 'work_centers');
  const routings = snapshot.tables.find((table) => table.name === 'product_routings');
  const routingOperations = snapshot.tables.find((table) => table.name === 'product_routing_operations');
  const existing = new Set(snapshot.tables.map((table) => table.name).filter((name) => !ENGINEERING_TABLES.includes(name)));
  const columns = new Map();
  for (const table of snapshot.tables.filter((item) => existing.has(item.name))) {
    columns.set(table.name, new Set(table.columns.map((column) => column.name)));
  }
  for (const [table, removed] of [
    [boms, ['purpose', 'effective_from', 'effective_to', 'approval_status', 'approved_by', 'approved_at', 'change_request_id', 'eco_change_id']],
    [bomItems, ['is_selectable', 'is_replaceable', 'is_modifiable', 'config_group', 'config_constraint', 'eco_change_id', 'source_change_id']],
    [workCenters, ['calendar_id', 'default_efficiency_pct', 'is_outsource', 'notes', 'updated_at']],
    [routings, ['topology_type']],
    [routingOperations, ['operation_id', 'control_code_id', 'activity_id', 'resource_id', 'equipment_id', 'is_outsource', 'quality_policy']],
  ]) for (const name of removed) columns.get(table.name).delete(name);

  const plan = planMySqlAdditiveReconciliation(snapshot, { tables: existing, columns });
  const creates = plan.filter((sql) => sql.startsWith('CREATE TABLE'));
  const alters = plan.filter((sql) => sql.startsWith('ALTER TABLE'));
  assert.equal(creates.length, 15);
  assert.equal(alters.length, 28);
  assert.ok(alters.some((sql) => sql.includes('`boms`') && sql.includes('`approval_status`')));
  assert.ok(alters.some((sql) => sql.includes('`product_routing_operations`') && sql.includes('`control_code_id`')));
  assert.ok(plan.every((sql) => /^(CREATE TABLE IF NOT EXISTS|ALTER TABLE)/.test(sql)));
});

test('MySQL additive reconciliation is idempotent when schema already matches', () => {
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), false);
  const tables = new Set(snapshot.tables.map((table) => table.name));
  const columns = new Map(snapshot.tables.map((table) => [table.name, new Set(table.columns.map((column) => column.name))]));
  assert.deepEqual(planMySqlAdditiveReconciliation(snapshot, { tables, columns }), []);
  const indexes = new Map(snapshot.tables.map((table) => [table.name, new Set(table.indexes.map((index) => index.name))]));
  assert.deepEqual(planMySqlIndexReconciliation(snapshot, indexes), []);
});

test('MySQL reconciliation restores ordinary engineering indexes', () => {
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), false);
  const indexes = new Map(snapshot.tables.map((table) => [table.name, new Set(table.indexes.map((index) => index.name))]));
  for (const [table, index] of ENGINEERING_INDEXES) {
    assert.equal(indexes.get(table).delete(index), true, `${index} missing from canonical snapshot`);
  }
  const plan = planMySqlIndexReconciliation(snapshot, indexes);
  assert.equal(plan.length, 7);
  for (const [, index] of ENGINEERING_INDEXES) assert.ok(plan.some((sql) => sql.includes(index)), `${index} must be restored`);
});

test('MySQL metadata inspection aliases driver-native uppercase keys to canonical names', () => {
  const calls = [];
  const adapter = {
    prepare(sql) {
      calls.push(sql);
      if (sql.includes('COLUMN_NAME AS column_name')) {
        return { all: () => [{ column_name: 'id' }, { column_name: 'purpose' }] };
      }
      if (sql.includes('INDEX_NAME AS index_name')) {
        return { all: () => [{ index_name: 'PRIMARY' }, { index_name: 'idx_boms_product_purpose_status' }] };
      }
      throw new Error(`Metadata query lacks a canonical alias: ${sql}`);
    },
  };

  assert.deepEqual([...readMySqlColumnNames(adapter, 'boms')], ['id', 'purpose']);
  assert.deepEqual([...readMySqlIndexNames(adapter, 'boms')], ['PRIMARY', 'idx_boms_product_purpose_status']);
  assert.match(calls[0], /ORDER BY ORDINAL_POSITION/);
  assert.equal(calls.length, 2);
});
