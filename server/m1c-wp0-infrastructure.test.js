import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const schema = read('server/migrations/procurement-outsourcing-schema.js');
const dbSource = read('server/db.js');
const v13 = read('server/migrations/v13-phase1-contracts.js');
const inventoryMutation = read('server/lib/inventory-mutation.js');
const mysqlSchema = read('server/database/mysql-schema.js');
const mysqlAdapter = read('server/database/mysql-adapter.js');

test('M1C-WP-0 registers only the approved new inventory source literals', () => {
  assert.match(inventoryMutation, /'OUTSOURCING_SUPPLEMENT'/);
  assert.match(inventoryMutation, /'OUTSOURCING_BACKFLUSH'/);
  assert.match(inventoryMutation, /const SOURCE_TYPES = new Set/);
});

test('M1C-WP-0 additive schema covers M-01 through M-07 without history backfill or M-15', () => {
  for (const table of [
    'receipt_notice_item_sources',
    'schedule_consumption_effects',
    'outsourcing_wip_identity_effects',
    'outsourcing_wip_identity_effect_allocations',
    'outsourcing_wip_identity_balances',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`));
  }

  assert.match(schema, /converted_quantity REAL,/,
    'converted_quantity must remain nullable with no DEFAULT 0');
  assert.doesNotMatch(schema, /converted_quantity REAL NOT NULL|converted_quantity REAL[^\n]*DEFAULT\s+0/);
  assert.match(schema, /legacy_unverified_wip_quantity REAL'/,
    'legacy WIP evidence column must remain nullable');
  assert.doesNotMatch(schema, /legacy_unverified_wip_quantity[^\n]*DEFAULT\s+0/);
  assert.match(schema, /UNIQUE\(business_event_type, business_event_id, business_event_item_id, reverses_effect_key\)/);
  assert.match(schema, /PRIMARY KEY\(material_list_id, identity_key\)/);

  assert.doesNotMatch(schema, /UPDATE\s+receipt_notice_item_sources/i);
  assert.doesNotMatch(schema, /UPDATE\s+outsourcing_material_list\s+SET\s+legacy_unverified_wip_quantity/i);
  assert.doesNotMatch(schema, /tracked_inventory_movements[^\n]*identity_key/i,
    'M-15 is separately authorized and must not enter WP-0');
});

test('M1C-WP-0 columns preserve unknown historical facts and approved defaults', () => {
  const required = [
    "'purchase_receipts', 'source_notice_id', 'source_notice_id TEXT'",
    "'purchase_receipt_items', 'source_notice_item_source_id', 'source_notice_item_source_id TEXT'",
    "'purchase_receipt_items', 'delivery_schedule_id', 'delivery_schedule_id TEXT'",
    "'outsourcing_receipts', 'warehouse_id', 'warehouse_id TEXT'",
    "'outsourcing_receipts', 'source_notice_id', 'source_notice_id TEXT'",
    "'outsourcing_receipts', 'business_date', 'business_date TEXT'",
    "'outsourcing_receipts', 'version', 'version INTEGER NOT NULL DEFAULT 0'",
    "'outsourcing_receipt_items', 'unit_code', \"unit_code TEXT NOT NULL DEFAULT 'EA'\"",
    "'outsourcing_material_list', 'source_warehouse_id', 'source_warehouse_id TEXT'",
    "'outsourcing_material_list', 'legacy_unverified_wip_quantity', 'legacy_unverified_wip_quantity REAL'",
    "'outsourcing_material_list', 'identity_evidence_state', \"identity_evidence_state TEXT NOT NULL DEFAULT 'NONE'\"",
  ];
  for (const contract of required) assert.ok(schema.includes(contract), `missing ${contract}`);
});

test('M1-P-03 roles and M-17 permission stay synchronized across canonical seed and V13 reconciliation', () => {
  assert.match(dbSource, /\['SUPPLIER_BILL_MANAGE', '管理供应商账单正式过账'\]/);
  assert.match(dbSource, /\['role-outsourcing', 'OUTSOURCING', '委外业务员'/);
  assert.match(dbSource, /\['role-outsourcing-receiving', 'OUTSOURCING_RECEIVING', '委外收货员'/);
  assert.match(dbSource, /'role-outsourcing': \['OUTSOURCING_MANAGE', 'OUTSOURCING_MATERIAL_EXECUTE'\]/);
  assert.match(dbSource, /'role-outsourcing-receiving': \['OUTSOURCING_RECEIVING_MANAGE'\]/);
  assert.match(v13, /'role-accounting':[\s\S]*?'SUPPLIER_BILL_MANAGE'/);
  assert.match(v13, /'role-outsourcing': \[[\s\S]*?'OUTSOURCING_MANAGE', 'OUTSOURCING_MATERIAL_EXECUTE'/);
  assert.match(v13, /'role-outsourcing-receiving': \[[\s\S]*?'OUTSOURCING_RECEIVING_MANAGE'/);

  const outsourcingSeed = dbSource.match(/'role-outsourcing': \[([^\]]+)\]/)?.[1] || '';
  const receivingSeed = dbSource.match(/'role-outsourcing-receiving': \[([^\]]+)\]/)?.[1] || '';
  assert.doesNotMatch(outsourcingSeed, /OUTSOURCING_RECEIVING_MANAGE|IQC_MANAGE|SUPPLIER_BILL_MANAGE/);
  assert.doesNotMatch(receivingSeed, /OUTSOURCING_MANAGE|OUTSOURCING_MATERIAL_EXECUTE|IQC_MANAGE|SUPPLIER_BILL_MANAGE/);
});

test('WP-0 retains canonical transaction and lock-order guards for later writers', () => {
  assert.match(dbSource, /SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE/);
  assert.match(inventoryMutation, /\.map\(\(p\) => p\.positionKey\)\)\]\.sort\(\)/);
  assert.match(inventoryMutation, /ORDER BY position_key ASC/);
});

test('WP-0 schema remains on the canonical SQLite snapshot to MySQL reconciliation path', () => {
  assert.match(mysqlAdapter, /captureSqliteSnapshot\(createSqliteSnapshot, seedDemo\)/);
  assert.match(mysqlAdapter, /bootstrapMySql\(adapter, snapshot\)/);
  assert.match(mysqlSchema, /planMySqlAdditiveReconciliation\(snapshot,/);
  assert.match(mysqlSchema, /for \(const check of extractChecks\(table\.sql\)\) definitions\.push\(`CHECK/);
});
