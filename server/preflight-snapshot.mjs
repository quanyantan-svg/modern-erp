// SQLite snapshot preflight — runs locally without any MySQL access.
// Mirrors the preflight logic from server/mysql-sales-customer-wave1-upgrade.integration.js
// to print actual row counts for every required representative and count-preserved
// table, verify Wave 1 tables are filtered out, and verify fixed legacy IDs.

import assert from 'node:assert/strict';
import { captureSqliteSnapshot } from './database/mysql-schema.js';
import { createDatabase } from './db.js';
import { SALES_WAVE1_TABLES } from './migrations/sales-customer-wave1-foundation.js';

const REQUIRED_REPRESENTATIVE_TABLES = Object.freeze([
  'customers', 'products', 'suppliers', 'warehouses',
  'sales_orders', 'sales_order_items', 'audit_logs',
  'roles', 'permissions', 'role_permissions', 'users', 'inventory',
]);

const COUNT_PRESERVED_TABLES = Object.freeze([
  'account_receivables', 'account_payables', 'payment_collections',
  'payment_disbursements', 'cash_journals', 'bank_accounts', 'bills',
  'approval_requests', 'purchase_orders', 'purchase_order_items',
  'sales_deliveries', 'sales_delivery_items', 'purchase_receipts',
  'purchase_receipt_items', 'return_orders',
]);

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

console.log('--- SQLite snapshot preflight (no MySQL connection) ---');
const fullSnapshot = captureSqliteSnapshot(createDatabase, true);
const filtered = {
  tables: fullSnapshot.tables.filter((table) => !SALES_WAVE1_TABLES.includes(table.name)),
};
assert.ok(filtered.tables.length > 0, 'filtered snapshot must contain at least one canonical table');
for (const t of SALES_WAVE1_TABLES) {
  assert.equal(filtered.tables.some((table) => table.name === t), false,
    `Wave-1 table ${t} must not appear in the pre-Wave-1 snapshot`);
}

const byName = new Map(filtered.tables.map((table) => [table.name, table]));
console.log('--- REQUIRED_REPRESENTATIVE_TABLES row counts ---');
for (const required of REQUIRED_REPRESENTATIVE_TABLES) {
  const table = byName.get(required);
  assert.ok(table, `pre-Wave-1 snapshot must include ${required}`);
  assert.ok(table.rows.length > 0, `${required} must have seeded rows`);
  console.log(`  ${required}: ${table.rows.length} row(s)`);
}
console.log('--- COUNT_PRESERVED_TABLES row counts ---');
for (const preserved of COUNT_PRESERVED_TABLES) {
  const table = byName.get(preserved);
  assert.ok(table, `pre-Wave-1 snapshot must include ${preserved}`);
  console.log(`  ${preserved}: ${table.rows.length} row(s) ${table.rows.length === 0 ? '(legitimately empty)' : ''}`);
}
console.log('--- Required pre-Wave-1 IDs ---');
for (const [table, ids] of Object.entries(REQUIRED_PRE_WAVE_1_IDS)) {
  const t = byName.get(table);
  assert.ok(t, `pre-Wave-1 snapshot must include ${table}`);
  const actualIds = new Set(t.rows.map((row) => String(row.id)));
  for (const requiredId of ids) {
    assert.ok(actualIds.has(requiredId),
      `pre-Wave-1 snapshot must contain ${table}.id='${requiredId}' (missing from seeded fixture)`);
  }
  console.log(`  ${table}: ${ids.length} required ID(s) verified present`);
}
console.log('--- OK ---');
console.log(`Total pre-Wave-1 tables in snapshot: ${filtered.tables.length}`);
console.log(`Wave-1 tables filtered out: ${SALES_WAVE1_TABLES.length}`);