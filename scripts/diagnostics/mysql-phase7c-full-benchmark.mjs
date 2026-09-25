// scripts/diagnostics/mysql-phase7c-full-benchmark.mjs
//
// Phase 7C full benchmark suite.
//
// 1. Bootstraps a disposable MySQL 8 database with the frozen V1.3 schema.
// 2. Populates a realistic SME-scale dataset sized to the Phase 7C required
//    profile (docs/archive/v1.3/phases/V1.3-PHASE7C-SECURITY-PERFORMANCE-OBSERVABILITY.md:98-106)
//    using raw mysql2 multi-row inserts so fixture generation does not pay
//    the per-call MySqlSyncAdapter round-trip cost.
// 3. Boots the API server in-process and measures representative routes.
// 4. Benchmarks the singleton InnoDB transaction gate at 1/5/10/20 writers.
// 5. Captures EXPLAIN evidence for representative read queries.
// 6. Verifies each measured operation against the provisional Phase 7C SME
//    thresholds and reports full table scans.
//
// Run only when:
//   - ERP_DB_BACKEND=mysql
//   - ERP_DB_* connection variables are set
//   - ERP_MYSQL_TEST_ALLOW_RESET=true
//   - the database name matches /test|phase7[abc]|disposable/i
//
// Production is never contacted.

import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import mysql from 'mysql2/promise';

import { createApp } from '../../server/app.js';
import { transaction } from '../../server/db.js';
import { createTempDb } from '../../server/test-utils/temp-db.js';
import { resolveDatabaseConfig } from '../../server/database/config.js';

process.env.ERP_DB_BACKEND = 'mysql';
process.env.ERP_TEST_DB_BACKEND = 'mysql';
process.env.NODE_ENV = 'production';
process.env.ERP_SEED_DEMO = 'false';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`MYSQL PHASE 7C ENVIRONMENT = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7[abc]|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing Phase 7C benchmark for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

// Dataset scale sized to the Phase 7C required acceptance profile
// (docs/archive/v1.3/phases/V1.3-PHASE7C-SECURITY-PERFORMANCE-OBSERVABILITY.md:98-106).
// Every minimum is met or exceeded. salesInvoices / supplierBills must each
// be ≥ their corresponding AR / AP count so that account_receivables.source_id
// and account_payables.source_id stay unique under the UNIQUE(source_type,
// source_id) index installed by server/modules/settlement-core.js:35-36.
const SCALE = {
  products: 10_000,
  customers: 2_000,
  suppliers: 1_000,
  warehouses: 20,
  inventoryRows: 25_000,
  inventoryTransactions: 600_000,
  valuationMovements: 400_000,                  // 1,000,000 combined
  inventoryLots: 60_000,
  inventorySerials: 40_000,                     // 100,000 combined
  salesOrders: 35_000,
  salesOrderItems: 90_000,
  salesDeliveries: 25_000,
  salesDeliveryItems: 70_000,
  purchaseOrders: 25_000,                       // 60,000 SO+PO headers
  purchaseOrderItems: 55_000,
  purchaseReceipts: 15_000,
  purchaseReceiptItems: 45_000,                 // 260,000 SO/PO/SD/PR items
  salesInvoices: 60_000,                        // ≥ accountReceivables
  supplierBills: 40_000,                        // ≥ accountPayables; 100,000 invoices/bills
  accountReceivables: 60_000,
  accountPayables: 40_000,                      // 100,000 AR/AP
  accountingVouchers: 50_000,
  accountingEntries: 250_000,
  productionOrders: 10_000,
  productionOrderOperations: 15_000,            // 25,000 production orders/ops
  productionOrderRoutingSnapshots: 10_000,     // 1 routing snapshot per production_order;
                                                 // production_order_operations.routing_snapshot_id
                                                 // is NOT NULL (v13-phase6c:32) so every
                                                 // operation must point at a real snapshot.
  productionMaterialIssues: 4_000,
  productionReceipts: 5_000,
};

// Fixture preflight. Asserts that the literals this benchmark inserts into
// high-volume financial tables stay inside the canonical CHECK sets emitted
// by server/database/mysql-schema.js (extractChecks() in mysql-schema.js:8-33)
// from the canonical SQLite CREATE TABLE statements in server/db.js and
// server/migrations/v13-phase6e-commercial-golive.js. Runs before the bulk
// inserts so a drift away from those constraints fails in JS with a useful
// message instead of after 60,000 rows have been queued for INSERT.
function preflightFinancialFixtures() {
  const ensure = (table, field, value, allowed, predicate) => {
    if (allowed && !allowed.includes(value)) {
      throw new Error(`${table} preflight: ${field}=${JSON.stringify(value)} violates canonical CHECK. Allowed: ${allowed.join(', ')}`);
    }
    if (predicate && !predicate(value)) {
      throw new Error(`${table} preflight: ${field}=${JSON.stringify(value)} violates invariant`);
    }
  };

  // account_receivables (canonical CHECK at server/db.js:1220)
  ensure('account_receivables', 'status', 'PENDING',
    ['PENDING', 'PARTIAL', 'COMPLETED', 'WRITTEN_OFF']);
  ensure('account_receivables', 'amount_cents', 100_000, null, (v) => v > 0);
  ensure('account_receivables', 'item_class', 'SOURCE');

  // account_payables (canonical CHECK at server/db.js:1237)
  ensure('account_payables', 'status', 'PENDING',
    ['PENDING', 'PARTIAL', 'COMPLETED', 'WRITTEN_OFF']);
  ensure('account_payables', 'amount_cents', 100_000, null, (v) => v > 0);
  ensure('account_payables', 'item_class', 'SOURCE');

  // sales_invoices (canonical CHECKs at v13-phase6e-commercial-golive.js:72-73)
  ensure('sales_invoices', 'status', 'POSTED',
    ['DRAFT', 'POSTED', 'REVERSED', 'CANCELLED']);
  ensure('sales_invoices', 'tax_mode', 'EXCLUSIVE',
    ['NO_TAX', 'EXCLUSIVE', 'INCLUSIVE']);

  // supplier_bills (canonical CHECKs at v13-phase6e-commercial-golive.js:91-92)
  ensure('supplier_bills', 'status', 'POSTED',
    ['DRAFT', 'WAITING_MATCH', 'POSTED', 'REVERSED', 'CANCELLED']);
  ensure('supplier_bills', 'tax_mode', 'EXCLUSIVE',
    ['NO_TAX', 'EXCLUSIVE', 'INCLUSIVE']);

  // accounting_vouchers (canonical CHECK at server/db.js:272 — added by
  // migrateVoucherWorkflow). Status is rebuilt in place so the CHECK survives
  // the table copy.
  ensure('accounting_vouchers', 'status', 'POSTED',
    ['ENTERED', 'SUBMITTED', 'POSTED', 'REJECTED']);

  // accounting_entries (canonical CHECKs at server/db.js:1204-1205)
  ensure('accounting_entries', 'direction', 'DEBIT', ['DEBIT', 'CREDIT']);
  ensure('accounting_entries', 'amount_cents', 100_000, null, (v) => v > 0);
  // accounting_entries.subject_id must reference a seeded row in
  // accounting_subjects; seeded IDs are subject-001 … subject-007
  // (server/db.js:1537-1544).
  ensure('accounting_entries', 'subject_id', 'subject-001',
    ['subject-001', 'subject-002', 'subject-003', 'subject-004', 'subject-005', 'subject-006', 'subject-007']);

  // UNIQUE(source_type, source_id) on AR/AP (settlement-core.js:35-36).
  // Source ids below must equal the SCALE cardinality of their parent table
  // so each receivable / payable gets a unique invoice / bill id.
  if (SCALE.accountReceivables > SCALE.salesInvoices) {
    throw new Error(`account_receivables preflight: SCALE.accountReceivables=${SCALE.accountReceivables} > SCALE.salesInvoices=${SCALE.salesInvoices} would collide on UNIQUE(source_type, source_id)`);
  }
  if (SCALE.accountPayables > SCALE.supplierBills) {
    throw new Error(`account_payables preflight: SCALE.accountPayables=${SCALE.accountPayables} > SCALE.supplierBills=${SCALE.supplierBills} would collide on UNIQUE(source_type, source_id)`);
  }
}

// Provisional SME acceptance thresholds from
// docs/archive/v1.3/phases/V1.3-PHASE7C-SECURITY-PERFORMANCE-OBSERVABILITY.md:90.
const THRESHOLDS = {
  errorRate: 0.01,
  readP95Ms: 500,
  mutationP95Ms: 750,
  gateP95Ms: 1_000,
  gateMinThroughputPerSecond: 20,
};

function isoDate(offsetDays) {
  const base = new Date('2026-09-01T00:00:00.000Z');
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString();
}

function shortDate(offsetDays) {
  return isoDate(offsetDays).slice(0, 10);
}

function percentile(values, percent) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percent) - 1)] || 0;
}

// Streaming multi-row INSERT. Only one batch is held in JS memory at a time.
// Each row is produced by rowFn(i) and must return an array of values matching
// `columns` in order. mysql2 parameter placeholders (?) are used; no string
// interpolation of values, so this is safe against SQL injection.
async function bulkInsert(conn, tableName, columns, totalCount, batchSize, rowFn) {
  if (!totalCount) return;
  const placeholders = `(${columns.map(() => '?').join(',')})`;
  for (let offset = 0; offset < totalCount; offset += batchSize) {
    const count = Math.min(batchSize, totalCount - offset);
    const valuesClause = Array.from({ length: count }, () => placeholders).join(',');
    const params = [];
    for (let i = 0; i < count; i += 1) {
      const row = rowFn(offset + i);
      for (const value of row) params.push(value);
    }
    await conn.query(`INSERT INTO ${tableName} (${columns.join(',')}) VALUES ${valuesClause}`, params);
  }
}

// Production-domain fixture preflight. Asserts that the literals the
// production rowFns insert stay inside the canonical NOT NULL / CHECK
// contracts of the migrated production_orders, production_order_routing_snapshots
// and production_order_operations tables, because FOREIGN_KEY_CHECKS=0 is
// on during bulk seeding and the failure that surfaced — `bom_version_snapshot
// cannot be null` (errno 1048) — would otherwise repeat silently.
function preflightProductionFixtures() {
  const ensure = (table, field, value, allowed, predicate) => {
    if (allowed && !allowed.includes(value)) {
      throw new Error(`${table} preflight: ${field}=${JSON.stringify(value)} violates canonical CHECK. Allowed: ${allowed.join(', ')}`);
    }
    if (predicate && !predicate(value)) {
      throw new Error(`${table} preflight: ${field}=${JSON.stringify(value)} violates invariant`);
    }
  };

  // production_orders.status CHECK IN (…,'COMPLETED',…) — server/db.js:1147
  ensure('production_orders', 'status', 'COMPLETED',
    ['DRAFT', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

  // production_orders.source_type has no CHECK; canonical default is MANUAL.
  // Using INSTRUCTION here would require a real production_instructions /
  // production_instruction_items chain (planning-documents-schema.js:31-78),
  // so we use MANUAL and leave production_instruction_id null.
  ensure('production_orders', 'source_type', 'MANUAL');

  // bom_version_snapshot TEXT NOT NULL DEFAULT '' (v13-phase4:11) and
  // routing_version_snapshot TEXT NOT NULL DEFAULT '' (v13-phase4:13). A null
  // literal here triggers ER_BAD_NULL_ERROR on insert.
  ensure('production_orders', 'bom_version_snapshot', '', null, (v) => v !== null && typeof v === 'string');
  ensure('production_orders', 'routing_version_snapshot', '', null, (v) => v !== null && typeof v === 'string');

  // production_order_operations.status CHECK (v13-phase6c:45)
  ensure('production_order_operations', 'status', 'COMPLETED',
    ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);

  // routing_snapshot_id TEXT NOT NULL FK→production_order_routing_snapshots
  // (v13-phase6c:32, :52). The harness seeds one snapshot per production_order
  // and every operation references its order's snapshot via `rout-${...}`.
  ensure('production_order_operations', 'routing_snapshot_id', 'rout-0', null,
    (v) => v !== null && typeof v === 'string' && /^rout-\d+$/.test(v));

  // work_center_code and work_center_name are TEXT NOT NULL DEFAULT ''
  // (v13-phase6c:35-36). Null literals here trigger ER_BAD_NULL_ERROR.
  ensure('production_order_operations', 'work_center_code', '', null, (v) => v !== null && typeof v === 'string');
  ensure('production_order_operations', 'work_center_name', '', null, (v) => v !== null && typeof v === 'string');

  // Cross-table invariant: SCALE.productionOrderRoutingSnapshots must be ≥ 1
  // and every production_order must have a corresponding routing snapshot,
  // because routing_snapshot_id is NOT NULL on the operations table.
  if (SCALE.productionOrderRoutingSnapshots < SCALE.productionOrders) {
    throw new Error(`preflightProductionFixtures: SCALE.productionOrderRoutingSnapshots=${SCALE.productionOrderRoutingSnapshots} < SCALE.productionOrders=${SCALE.productionOrders} — operations would have no snapshot to reference`);
  }
}

// Tracks dataset generation without retaining rows in JS memory.
async function populateDataset(conn) {
  const startMs = performance.now();

  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  try {

  // System fixtures (small, fixed). The benchmark previously inserted a
  // benchmark-owned 'system-role' row to back the FK on the 'system'
  // user. That created a 6th row in the roles table that was neither a
  // canonical business role (server/db.js:1502-1508 only seeds ADMIN/SALES/
  // REVIEWER/WAREHOUSE/ACCOUNTING) nor something the canonical seed would
  // create. We now reuse the canonical role-admin as the 'system' user's
  // role_id so the canonical role count stays at 5 and the 'system' user
  // still has a valid FK target.
  await conn.query(
    `INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('system','system','System','placeholder','placeholder','role-admin',1,'2026-09-01T00:00:00.000Z')`,
  );

  await bulkInsert(conn, 'warehouses',
    ['id', 'code', 'name', 'address', 'manager', 'active', 'created_at', 'updated_at'],
    SCALE.warehouses, 1000,
    (i) => [`wh-${i}`, `WH${String(i).padStart(3, '0')}`, `Warehouse ${i}`, `Addr ${i}`, `Manager ${i}`, 1, isoDate(-365), isoDate(-1)]);

  await bulkInsert(conn, 'customers',
    ['id', 'code', 'name', 'contact', 'phone', 'address', 'active', 'created_at', 'updated_at', 'payment_terms_days'],
    SCALE.customers, 1000,
    (i) => [`cu-${i}`, `C${String(i).padStart(5, '0')}`, `Customer ${i}`, `Contact ${i}`, `1380000${String(i).padStart(4, '0')}`, `Addr ${i}`, 1, isoDate(-365), isoDate(-1), 30]);

  await bulkInsert(conn, 'suppliers',
    ['id', 'code', 'name', 'contact', 'phone', 'address', 'email', 'active', 'created_at', 'updated_at', 'payment_terms_days'],
    SCALE.suppliers, 1000,
    (i) => [`su-${i}`, `S${String(i).padStart(5, '0')}`, `Supplier ${i}`, `Contact ${i}`, `1390000${String(i).padStart(4, '0')}`, `Addr ${i}`, `sup${i}@x.com`, 1, isoDate(-365), isoDate(-1), 30]);

  await bulkInsert(conn, 'products',
    ['id', 'code', 'name', 'category', 'unit', 'price_cents', 'stock_quantity', 'active', 'created_at', 'updated_at',
     'reorder_point', 'min_stock', 'max_stock', 'lead_time_days', 'tracking_policy', 'shelf_life_days', 'tracking_effective_at',
     'standard_manufacturing_cost_cents', 'valuation_method', 'inventory_classification', 'valuation_activated_at',
     'base_uom_code', 'purchase_uom_code', 'sales_uom_code'],
    SCALE.products, 500,
    (i) => {
      const tp = ['NONE', 'NONE', 'NONE', 'LOT', 'LOT', 'SERIAL'][i % 6];
      const vm = ['MOVING_AVERAGE', 'MOVING_AVERAGE', 'MOVING_AVERAGE', 'LOT_SPECIFIC', 'SERIAL_SPECIFIC', 'STANDARD_COST'][i % 6];
      const ic = ['RAW_MATERIAL', 'WORK_IN_PROGRESS', 'FINISHED_GOOD', 'OTHER_INVENTORY'][i % 4];
      return [
        `pr-${i}`, `P${String(i).padStart(6, '0')}`, `Product ${i}`, `Cat ${i % 50}`, 'EA',
        Math.round(10_000 + Math.random() * 990_000), 0, 1, isoDate(-365), isoDate(-1),
        100, 50, 500, 7, tp, 365, isoDate(-365),
        Math.round(5000 + Math.random() * 50_000), vm, ic, isoDate(-365),
        'EA', 'EA', 'EA',
      ];
    });

  await bulkInsert(conn, 'inventory',
    ['id', 'warehouse_id', 'product_id', 'quantity', 'updated_at'],
    SCALE.inventoryRows, 1000,
    (i) => {
      const whIdx = i % SCALE.warehouses;
      const productIdx = Math.floor(i / SCALE.warehouses);
      return [`inv-${i}`, `wh-${whIdx}`, `pr-${productIdx}`, Math.round(Math.random() * 10_000) / 100, isoDate(-1)];
    });

  await bulkInsert(conn, 'inventory_lots',
    ['id', 'product_id', 'lot_code', 'manufacture_date', 'expiry_date', 'supplier_lot_reference', 'created_source_type', 'created_source_id', 'created_source_item_id', 'status', 'created_at'],
    SCALE.inventoryLots, 500,
    (i) => [`lot-${i}`, `pr-${i % SCALE.products}`, `L${String(i).padStart(8, '0')}`, shortDate(-60), shortDate(305), `SLR${i}`, 'PO_RECEIPT', `recpt-${i % SCALE.purchaseReceipts}`, `item-${i}`, 'AVAILABLE', isoDate(-30)]);

  await bulkInsert(conn, 'inventory_serials',
    ['id', 'product_id', 'serial_number', 'lot_id', 'manufacture_date', 'expiry_date', 'created_source_type', 'created_source_id', 'created_source_item_id', 'lifecycle_state', 'current_warehouse_id', 'updated_at', 'created_at'],
    SCALE.inventorySerials, 500,
    (i) => [`sn-${i}`, `pr-${i % SCALE.products}`, `S${String(i).padStart(8, '0')}`, `lot-${i}`, shortDate(-60), null, 'PO_RECEIPT', `recpt-${i}`, `item-${i}`, 'AVAILABLE', `wh-${i % SCALE.warehouses}`, isoDate(-30), isoDate(-30)]);

  // 1,000,000 inventory / valuation movements combined.
  await bulkInsert(conn, 'inventory_transactions',
    ['id', 'warehouse_id', 'product_id', 'quantity_change', 'direction', 'balance_after', 'source_type', 'source_id', 'source_no', 'remark', 'creator_id', 'created_at', 'source_line_id', 'lot_id', 'serial_id', 'business_date', 'valuation_status'],
    SCALE.inventoryTransactions, 1000,
    (i) => {
      const productIdx = i % SCALE.products;
      const whIdx = i % SCALE.warehouses;
      const dayOffset = -(i % 90);
      const qty = Math.round((Math.random() * 200 - 100) * 100) / 100;
      return [
        `txn-${i}`, `wh-${whIdx}`, `pr-${productIdx}`, qty, qty >= 0 ? 'IN' : 'OUT',
        Math.round(Math.random() * 10_000) / 100, 'INVENTORY_ADJUSTMENT', `src-${i}`, `ADJ${i}`, `Bench ${i}`, 'system',
        isoDate(dayOffset), `line-${i}`, null, null, shortDate(dayOffset), 'VALUED',
      ];
    });

  await bulkInsert(conn, 'inventory_valuation_movements',
    ['id', 'business_date', 'product_id', 'warehouse_id', 'lot_id', 'serial_id', 'quantity_delta', 'value_delta_cents', 'unit_cost_cents', 'valuation_basis', 'movement_type', 'source_type', 'source_id', 'source_item_id', 'inventory_transaction_id', 'production_order_id', 'reversal_of_id', 'status', 'created_at'],
    SCALE.valuationMovements, 1000,
    (i) => {
      const productIdx = i % SCALE.products;
      const whIdx = i % SCALE.warehouses;
      const dayOffset = -(i % 90);
      const qty = Math.round((Math.random() * 200 - 100) * 100) / 100;
      return [
        `val-${i}`, shortDate(dayOffset), `pr-${productIdx}`, `wh-${whIdx}`, null, null, qty,
        Math.round(Math.random() * 200_000 - 100_000), Math.round(Math.random() * 1000),
        'POSTED_VALUE_LEDGER', 'INVENTORY_ADJUSTMENT', 'INVENTORY_ADJUSTMENT', `src-${i}`, `item-${i}`,
        `txn-${i}`, null, null, 'POSTED', isoDate(dayOffset),
      ];
    });

  // SO + PO header totals >= 50,000.
  await bulkInsert(conn, 'sales_orders',
    ['id', 'order_no', 'customer_id', 'status', 'total_cents', 'remark', 'rejection_reason', 'creator_id', 'reviewer_id', 'submitted_at', 'reviewed_at', 'created_at', 'updated_at', 'order_date', 'requested_delivery_date', 'payment_terms', 'ship_to_contact_name', 'ship_to_phone', 'ship_to_address', 'payment_terms_days'],
    SCALE.salesOrders, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `so-${i}`, `SO${String(i).padStart(7, '0')}`, `cu-${i % SCALE.customers}`, 'APPROVED', 100000, '', '',
        'system', 'system', isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset),
        shortDate(dayOffset), shortDate(dayOffset + 7), 'NET30', 'Contact', '13800000000', 'Addr', 30,
      ];
    });

  await bulkInsert(conn, 'sales_order_items',
    ['id', 'order_id', 'product_id', 'quantity', 'unit_price_cents', 'amount_cents', 'line_no', 'document_uom_code', 'document_quantity_num', 'document_quantity_den', 'conversion_numerator', 'conversion_denominator', 'base_quantity_num', 'base_quantity_den'],
    SCALE.salesOrderItems, 1000,
    (i) => [
      randomUUID(), `so-${i % SCALE.salesOrders}`, `pr-${i % SCALE.products}`, 10, 1000, 10000, (i % 10) + 1,
      'EA', 10, 1, 1, 1, 10, 1,
    ]);

  await bulkInsert(conn, 'sales_deliveries',
    ['id', 'delivery_no', 'sales_order_id', 'customer_id', 'warehouse_id', 'handler_id', 'total_cents', 'status', 'delivery_date', 'remark', 'creator_id', 'created_at', 'updated_at', 'confirmed_at', 'confirmed_by', 'billing_mode'],
    SCALE.salesDeliveries, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `sd-${i}`, `SD${String(i).padStart(7, '0')}`, `so-${i % SCALE.salesOrders}`, `cu-${i % SCALE.customers}`,
        `wh-${i % SCALE.warehouses}`, 'system', 100000, 'CONFIRMED', shortDate(dayOffset), '', 'system',
        isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset), 'system', 'ON_RECEIPT',
      ];
    });

  await bulkInsert(conn, 'sales_delivery_items',
    ['id', 'delivery_id', 'product_id', 'quantity', 'unit_price_cents', 'amount_cents', 'line_no', 'sales_order_item_id', 'document_uom_code', 'document_quantity_num', 'document_quantity_den', 'conversion_numerator', 'conversion_denominator', 'base_quantity_num', 'base_quantity_den'],
    SCALE.salesDeliveryItems, 1000,
    (i) => [
      randomUUID(), `sd-${i % SCALE.salesDeliveries}`, `pr-${i % SCALE.products}`, 10, 1000, 10000, (i % 10) + 1,
      null, 'EA', 10, 1, 1, 1, 10, 1,
    ]);

  await bulkInsert(conn, 'purchase_orders',
    ['id', 'order_no', 'supplier_id', 'status', 'total_cents', 'remark', 'rejection_reason', 'creator_id', 'reviewer_id', 'submitted_at', 'reviewed_at', 'created_at', 'updated_at', 'order_date', 'expected_delivery_date', 'payment_terms', 'supplier_contact_name', 'supplier_contact_phone', 'supplier_address', 'purchase_requisition_id', 'payment_terms_days'],
    SCALE.purchaseOrders, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `po-${i}`, `PO${String(i).padStart(7, '0')}`, `su-${i % SCALE.suppliers}`, 'APPROVED', 100000, '', '',
        'system', 'system', isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset),
        shortDate(dayOffset), shortDate(dayOffset + 7), 'NET30', 'Contact', '13900000000', 'Addr', null, 30,
      ];
    });

  await bulkInsert(conn, 'purchase_order_items',
    ['id', 'order_id', 'product_id', 'quantity', 'unit_price_cents', 'amount_cents', 'line_no', 'purchase_requisition_item_id', 'document_uom_code', 'document_quantity_num', 'document_quantity_den', 'conversion_numerator', 'conversion_denominator', 'base_quantity_num', 'base_quantity_den'],
    SCALE.purchaseOrderItems, 1000,
    (i) => [
      randomUUID(), `po-${i % SCALE.purchaseOrders}`, `pr-${i % SCALE.products}`, 10, 1000, 10000, (i % 10) + 1,
      null, 'EA', 10, 1, 1, 1, 10, 1,
    ]);

  await bulkInsert(conn, 'purchase_receipts',
    ['id', 'receipt_no', 'purchase_order_id', 'supplier_id', 'warehouse_id', 'handler_id', 'total_cents', 'status', 'receipt_date', 'remark', 'creator_id', 'created_at', 'updated_at', 'confirmed_at', 'confirmed_by', 'billing_mode'],
    SCALE.purchaseReceipts, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `recpt-${i}`, `RCPT${String(i).padStart(7, '0')}`, `po-${i % SCALE.purchaseOrders}`, `su-${i % SCALE.suppliers}`,
        `wh-${i % SCALE.warehouses}`, 'system', 100000, 'CONFIRMED', shortDate(dayOffset), '', 'system',
        isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset), 'system', 'ON_RECEIPT',
      ];
    });

  await bulkInsert(conn, 'purchase_receipt_items',
    ['id', 'receipt_id', 'product_id', 'quantity', 'unit_price_cents', 'amount_cents', 'line_no', 'purchase_order_item_id', 'document_uom_code', 'document_quantity_num', 'document_quantity_den', 'conversion_numerator', 'conversion_denominator', 'base_quantity_num', 'base_quantity_den'],
    SCALE.purchaseReceiptItems, 1000,
    (i) => [
      randomUUID(), `recpt-${i % SCALE.purchaseReceipts}`, `pr-${i % SCALE.products}`, 10, 1000, 10000, (i % 10) + 1,
      null, 'EA', 10, 1, 1, 1, 10, 1,
    ]);

  await bulkInsert(conn, 'sales_invoices',
    ['id', 'invoice_no', 'customer_id', 'invoice_date', 'status', 'tax_mode', 'net_cents', 'tax_cents', 'gross_cents', 'tax_snapshot_json', 'creator_id', 'created_at', 'posted_by', 'posted_at', 'reversal_of_id', 'idempotency_key'],
    SCALE.salesInvoices, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `inv-${i}`, `INV${String(i).padStart(7, '0')}`, `cu-${i % SCALE.customers}`, shortDate(dayOffset),
        'POSTED', 'EXCLUSIVE', 100000, 13000, 113000, '[]', 'system', isoDate(dayOffset), 'system',
        isoDate(dayOffset), null, null,
      ];
    });

  await bulkInsert(conn, 'supplier_bills',
    ['id', 'bill_no', 'supplier_id', 'supplier_invoice_no', 'bill_date', 'status', 'tax_mode', 'net_cents', 'tax_cents', 'gross_cents', 'grni_cents', 'variance_cents', 'tax_snapshot_json', 'creator_id', 'created_at', 'posted_by', 'posted_at', 'reversal_of_id', 'idempotency_key'],
    SCALE.supplierBills, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `bill-${i}`, `BIL${String(i).padStart(7, '0')}`, `su-${i % SCALE.suppliers}`, `EXT${i}`,
        shortDate(dayOffset), 'POSTED', 'EXCLUSIVE', 100000, 13000, 113000, 100000, 0, '[]',
        'system', isoDate(dayOffset), 'system', isoDate(dayOffset), null, null,
      ];
    });

  await bulkInsert(conn, 'account_receivables',
    ['id', 'voucher_no', 'customer_id', 'source_type', 'source_id', 'amount_cents', 'paid_cents', 'write_off_cents', 'status', 'due_date', 'creator_id', 'created_at', 'source_no', 'business_date', 'adjustment_cents', 'updated_at', 'payment_terms_days', 'return_credit_applied_cents', 'discount_credit_applied_cents', 'other_credit_applied_cents', 'cash_allocation_cents', 'open_amount_cents', 'item_class'],
    SCALE.accountReceivables, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `ar-${i}`, `AR${String(i).padStart(7, '0')}`, `cu-${i % SCALE.customers}`, 'INVOICE',
        // source_id must be unique per source_type (UNIQUE INDEX
        // idx_ar_source_unique). salesInvoices is sized ≥ accountReceivables
        // so each AR row points at its own invoice.
        `inv-${i}`, 100000, 0, 0, 'PENDING', shortDate(dayOffset + 30), 'system',
        isoDate(dayOffset), `INV${String(i).padStart(7, '0')}`, shortDate(dayOffset), 0,
        isoDate(dayOffset), 30, 0, 0, 0, 0, 100000, 'SOURCE',
      ];
    });

  await bulkInsert(conn, 'account_payables',
    ['id', 'voucher_no', 'supplier_id', 'source_type', 'source_id', 'amount_cents', 'paid_cents', 'write_off_cents', 'status', 'due_date', 'creator_id', 'created_at', 'source_no', 'business_date', 'adjustment_cents', 'updated_at', 'payment_terms_days', 'return_credit_applied_cents', 'discount_credit_applied_cents', 'other_credit_applied_cents', 'cash_allocation_cents', 'open_amount_cents', 'item_class'],
    SCALE.accountPayables, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `ap-${i}`, `AP${String(i).padStart(7, '0')}`, `su-${i % SCALE.suppliers}`, 'BILL',
        // source_id must be unique per source_type (UNIQUE INDEX
        // idx_ap_source_unique). supplierBills is sized ≥ accountPayables so
        // each AP row points at its own bill.
        `bill-${i}`, 100000, 0, 0, 'PENDING', shortDate(dayOffset + 30), 'system',
        isoDate(dayOffset), `BIL${String(i).padStart(7, '0')}`, shortDate(dayOffset), 0,
        isoDate(dayOffset), 30, 0, 0, 0, 0, 100000, 'SOURCE',
      ];
    });

  await bulkInsert(conn, 'accounting_vouchers',
    ['id', 'voucher_no', 'source_type', 'source_id', 'voucher_date', 'remark', 'creator_id', 'created_at', 'voucher_word_id', 'period', 'status', 'attachment_count', 'approver_id', 'approved_at', 'updated_at', 'rejection_reason', 'submitted_at', 'submitted_by', 'voucher_origin', 'reversal_of_id', 'business_date'],
    SCALE.accountingVouchers, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `v-${i}`, `V${String(i).padStart(8, '0')}`, 'INVOICE', `inv-${i % SCALE.salesInvoices}`,
        shortDate(dayOffset), 'Bench', 'system', isoDate(dayOffset), null, '2026-09', 'POSTED', 0,
        'system', isoDate(dayOffset), isoDate(dayOffset), null, isoDate(dayOffset), 'system',
        'SYSTEM', null, shortDate(dayOffset),
      ];
    });

  await bulkInsert(conn, 'accounting_entries',
    ['id', 'voucher_id', 'subject_id', 'direction', 'amount_cents', 'summary', 'department_id', 'project_id', 'customer_id', 'supplier_id', 'currency_code', 'exchange_rate', 'amount_foreign', 'line_no'],
    SCALE.accountingEntries, 1000,
    (i) => [
      randomUUID(), `v-${i % SCALE.accountingVouchers}`, 'subject-001',
      i % 2 ? 'CREDIT' : 'DEBIT', 100000, 'Bench', null, null, null, null, 'CNY', 1, 100000,
      (i % 2) + 1,
    ]);

  await bulkInsert(conn, 'production_orders',
    ['id', 'order_no', 'product_id', 'quantity', 'status', 'planned_start', 'planned_finish', 'actual_start', 'actual_finish', 'remark', 'creator_id', 'created_at', 'updated_at', 'bom_id', 'source_type', 'production_instruction_id', 'production_instruction_item_id', 'bom_version_snapshot', 'routing_id_snapshot', 'routing_version_snapshot'],
    SCALE.productionOrders, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `prodo-${i}`, `PRODO${String(i).padStart(6, '0')}`, `pr-${i % SCALE.products}`, 100, 'COMPLETED',
        shortDate(dayOffset), shortDate(dayOffset + 5), shortDate(dayOffset), shortDate(dayOffset + 5), '',
        'system', isoDate(dayOffset), isoDate(dayOffset + 5),
        null,         // bom_id (nullable; this benchmark uses manual orders with no BOM)
        'MANUAL',     // source_type — canonical default for orders without a production_instruction
        null,         // production_instruction_id (nullable when source_type is MANUAL)
        null,         // production_instruction_item_id (nullable when source_type is MANUAL)
        '',           // bom_version_snapshot NOT NULL DEFAULT '' (v13-phase4:11). '' matches the
                      // canonical default for orders without a bom_id. Null literal here triggers
                      // ER_BAD_NULL_ERROR (errno 1048).
        null,         // routing_id_snapshot (nullable; benchmark has no product_routings)
        '',           // routing_version_snapshot NOT NULL DEFAULT '' (v13-phase4:13). Same
                      // NOT NULL contract as bom_version_snapshot.
      ];
    });

  // production_order_routing_snapshots — schema at v13-phase4:31-46. Required
  // because production_order_operations.routing_snapshot_id is NOT NULL and
  // must reference a real row here. Seed one snapshot per production_order so
  // every operation can point at the snapshot of the order it belongs to.
  await bulkInsert(conn, 'production_order_routing_snapshots',
    ['id', 'production_order_id', 'routing_id', 'sequence_no', 'operation_code', 'operation_name', 'work_center', 'setup_minutes', 'run_minutes_per_unit', 'notes', 'created_at'],
    SCALE.productionOrderRoutingSnapshots, 500,
    (i) => [
      `rout-${i}`, `prodo-${i}`, null, 1, 'OP1', 'Routing', '', 0, 0, '', isoDate(-30),
    ]);

  await bulkInsert(conn, 'production_order_operations',
    ['id', 'production_order_id', 'routing_snapshot_id', 'sequence_no', 'operation_code', 'operation_name', 'work_center_id', 'work_center_code', 'work_center_name', 'setup_seconds', 'run_seconds_per_unit', 'expected_yield_bps', 'labor_rate_cents_per_hour', 'overhead_rate_cents_per_hour', 'daily_capacity_minutes', 'planned_input_quantity', 'planned_date', 'status', 'completed_by', 'completed_at', 'created_at', 'updated_at'],
    SCALE.productionOrderOperations, 500,
    (i) => {
      const dayOffset = -(i % 90);
      const sequenceNo = (i % 3) + 1;
      return [
        randomUUID(),
        `prodo-${i % SCALE.productionOrders}`,
        // routing_snapshot_id NOT NULL FK→production_order_routing_snapshots
        // (v13-phase6c:52). Null literal here triggers ER_BAD_NULL_ERROR.
        `rout-${i % SCALE.productionOrderRoutingSnapshots}`,
        sequenceNo,
        `OP${sequenceNo}`,
        `Op ${sequenceNo}`,
        null,           // work_center_id (nullable FK→work_centers; benchmark has no work_centers)
        '',             // work_center_code NOT NULL DEFAULT '' (v13-phase6c:35)
        '',             // work_center_name NOT NULL DEFAULT '' (v13-phase6c:36)
        600, 60, 9800, 5000, 3000, 480, 100,
        shortDate(dayOffset), 'COMPLETED', 'system', isoDate(dayOffset), isoDate(dayOffset), isoDate(dayOffset),
      ];
    });

  await bulkInsert(conn, 'production_material_issues',
    ['id', 'issue_no', 'production_order_id', 'warehouse_id', 'status', 'issue_date', 'remark', 'creator_id', 'created_at', 'updated_at', 'confirmed_by', 'confirmed_at'],
    SCALE.productionMaterialIssues, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `pmi-${i}`, `PMI${String(i).padStart(6, '0')}`, `prodo-${i % SCALE.productionOrders}`,
        `wh-${i % SCALE.warehouses}`, 'CONFIRMED', shortDate(dayOffset), '', 'system',
        isoDate(dayOffset), isoDate(dayOffset), 'system', isoDate(dayOffset),
      ];
    });

  await bulkInsert(conn, 'production_receipts',
    ['id', 'receipt_no', 'production_order_id', 'warehouse_id', 'quantity', 'status', 'receipt_date', 'remark', 'creator_id', 'created_at', 'updated_at', 'confirmed_by', 'confirmed_at', 'before_quantity', 'after_quantity', 'product_id'],
    SCALE.productionReceipts, 500,
    (i) => {
      const dayOffset = -(i % 90);
      return [
        `prec-${i}`, `PREC${String(i).padStart(6, '0')}`, `prodo-${i % SCALE.productionOrders}`,
        `wh-${i % SCALE.warehouses}`, 100, 'CONFIRMED', shortDate(dayOffset), '', 'system',
        isoDate(dayOffset), isoDate(dayOffset), 'system', isoDate(dayOffset), 0, 100, `pr-${i % SCALE.products}`,
      ];
    });

  await conn.query('SET FOREIGN_KEY_CHECKS=1');
  } finally {
    // Always restore FOREIGN_KEY_CHECKS=1, even if a bulk insert throws,
    // so the connection is left in a known-good state for any caller that
    // reuses the same session.
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
  }
  return Math.round(performance.now() - startMs);
}

function captureDatasetStats(db) {
  const tables = [
    'products', 'customers', 'suppliers', 'warehouses', 'inventory',
    'inventory_transactions', 'inventory_lots', 'inventory_serials',
    'inventory_valuation_movements', 'sales_orders', 'sales_order_items',
    'sales_deliveries', 'sales_delivery_items', 'purchase_orders',
    'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items',
    'sales_invoices', 'supplier_bills',
    'account_receivables', 'account_payables',
    'accounting_vouchers', 'accounting_entries',
    'production_orders', 'production_order_routing_snapshots',
    'production_order_operations',
    'production_material_issues', 'production_receipts',
  ];
  const stats = {};
  for (const table of tables) {
    stats[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  }
  return stats;
}

// Mirror of the disposable-reset pattern in server/test-utils/temp-db.js
// cleanup() (FOREIGN_KEY_CHECKS=0, SHOW TABLES, validate table name regex,
// DROP TABLE, FOREIGN_KEY_CHECKS=1). Runs BEFORE createTempDb so every
// benchmark invocation starts from a known empty disposable schema, regardless
// of whether the previous run reached its cleanup(). Fail-closed: re-checks
// ERP_MYSQL_TEST_ALLOW_RESET and the disposable DB-name guard before doing
// anything destructive, so this can never run against production.
async function resetMySqlDatabase(conn) {
  if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
    throw new Error('resetMySqlDatabase requires ERP_MYSQL_TEST_ALLOW_RESET=true');
  }
  if (!/(?:test|phase7[abc]|disposable)/i.test(process.env.ERP_DB_NAME || '')) {
    throw new Error(`resetMySqlDatabase refuses non-disposable database: ${process.env.ERP_DB_NAME}`);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  const [tables] = await conn.query('SHOW TABLES');
  for (const row of tables) {
    const table = Object.values(row)[0];
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error(`Unsafe MySQL table name: ${table}`);
    await conn.query(`DROP TABLE IF EXISTS \`${table}\``);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
}

// Post-reset / post-bootstrap assertion that every benchmark-owned high-volume
// table is empty before populateDataset runs. Canonical/static bootstrap seed
// tables (roles, permissions, accounting_subjects, role_permissions) are
// deliberately NOT checked here — those are seeded by the V1.3 schema bootstrap
// and their rows are expected to exist. This check covers the 27 tables the
// benchmark itself owns. If any of them is non-empty, the benchmark cannot
// proceed against a deterministic clean state.
const BENCHMARK_OWNED_TABLES = [
  'products', 'customers', 'suppliers', 'warehouses', 'inventory',
  'inventory_transactions', 'inventory_lots', 'inventory_serials',
  'inventory_valuation_movements', 'sales_orders', 'sales_order_items',
  'sales_deliveries', 'sales_delivery_items', 'purchase_orders',
  'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items',
  'sales_invoices', 'supplier_bills',
  'account_receivables', 'account_payables',
  'accounting_vouchers', 'accounting_entries',
  'production_orders', 'production_order_routing_snapshots',
  'production_order_operations',
  'production_material_issues', 'production_receipts',
];

async function verifyCleanBenchmarkTables(conn) {
  const stale = [];
  for (const table of BENCHMARK_OWNED_TABLES) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    const count = Number(rows[0].n);
    if (count > 0) stale.push({ table, count });
  }
  return stale;
}

// Post-populate scale assertion. datasetScale is compared to SCALE key-by-key
// using a fixed mapping (SCALE keys are camelCase, table names are snake_case).
// COUNT(*) is exact for InnoDB; any mismatch means populateDataset produced
// fewer or more rows than the declared scale, which would invalidate the
// downstream Phase 7C acceptance profile, so the benchmark stops.
const SCALE_TO_TABLE = {
  products: 'products',
  customers: 'customers',
  suppliers: 'suppliers',
  warehouses: 'warehouses',
  inventoryRows: 'inventory',
  inventoryTransactions: 'inventory_transactions',
  valuationMovements: 'inventory_valuation_movements',
  inventoryLots: 'inventory_lots',
  inventorySerials: 'inventory_serials',
  salesOrders: 'sales_orders',
  salesOrderItems: 'sales_order_items',
  salesDeliveries: 'sales_deliveries',
  salesDeliveryItems: 'sales_delivery_items',
  purchaseOrders: 'purchase_orders',
  purchaseOrderItems: 'purchase_order_items',
  purchaseReceipts: 'purchase_receipts',
  purchaseReceiptItems: 'purchase_receipt_items',
  salesInvoices: 'sales_invoices',
  supplierBills: 'supplier_bills',
  accountReceivables: 'account_receivables',
  accountPayables: 'account_payables',
  accountingVouchers: 'accounting_vouchers',
  accountingEntries: 'accounting_entries',
  productionOrders: 'production_orders',
  productionOrderRoutingSnapshots: 'production_order_routing_snapshots',
  productionOrderOperations: 'production_order_operations',
  productionMaterialIssues: 'production_material_issues',
  productionReceipts: 'production_receipts',
};

function verifyDatasetScale(datasetScale) {
  const mismatches = [];
  for (const [scaleKey, table] of Object.entries(SCALE_TO_TABLE)) {
    const expected = SCALE[scaleKey];
    const actual = datasetScale[table];
    if (actual !== expected) mismatches.push({ table, expected, actual });
  }
  return mismatches;
}

// Post-seed referential integrity validation. FOREIGN_KEY_CHECKS=0 is used
// during bulk seeding for speed; this validation explicitly proves zero
// orphan rows exist before any endpoint benchmark timing begins, derived
// directly from information_schema so we never drift from the actual
// production FK constraints. Tables with 0 rows are skipped (no orphans
// possible). Composite FKs are handled by grouping on CONSTRAINT_NAME.
// The validation is purely a read; it never mutates rows.
async function validateReferentialIntegrity(conn) {
  const startMs = performance.now();
  const [fks] = await conn.query(`
    SELECT
      kcu.CONSTRAINT_NAME    AS constraintName,
      kcu.TABLE_NAME         AS tableName,
      kcu.COLUMN_NAME        AS columnName,
      kcu.REFERENCED_TABLE_NAME  AS referencedTable,
      kcu.REFERENCED_COLUMN_NAME AS referencedColumn,
      kcu.ORDINAL_POSITION   AS ordinalPosition
    FROM information_schema.KEY_COLUMN_USAGE kcu
    INNER JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = kcu.TABLE_SCHEMA AND t.TABLE_NAME = kcu.TABLE_NAME
    WHERE kcu.TABLE_SCHEMA = DATABASE()
      AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
      AND t.TABLE_ROWS > 0
    ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
  `);

  // Group FK columns by constraint (composite FKs share one constraint_name).
  const grouped = new Map();
  for (const fk of fks) {
    if (!grouped.has(fk.constraintName)) {
      grouped.set(fk.constraintName, {
        constraint: fk.constraintName,
        table: fk.tableName,
        referencedTable: fk.referencedTable,
        columns: [],
      });
    }
    grouped.get(fk.constraintName).columns.push({
      columnName: fk.columnName,
      referencedColumn: fk.referencedColumn,
    });
  }

  // For each constraint, count rows where the FK column does not match any
  // row in the referenced table. Uses NOT EXISTS which MySQL optimises via
  // an index seek on the referenced table.
  const results = [];
  const violations = [];
  for (const c of grouped.values()) {
    const conditions = c.columns.map((col) =>
      `(t.\`${col.columnName}\` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM \`${c.referencedTable}\` r WHERE r.\`${col.referencedColumn}\` = t.\`${col.columnName}\`))`,
    ).join(' AND ');
    const sql = `SELECT COUNT(*) AS orphans FROM \`${c.table}\` t WHERE ${conditions}`;
    try {
      const [rows] = await conn.query(sql);
      const orphanCount = Number(rows[0].orphans);
      results.push({ constraint: c.constraint, table: c.table, referencedTable: c.referencedTable, orphanCount });
      if (orphanCount > 0) {
        violations.push({ constraint: c.constraint, table: c.table, referencedTable: c.referencedTable, orphanCount });
      }
    } catch (error) {
      const message = error?.message || String(error);
      results.push({ constraint: c.constraint, table: c.table, referencedTable: c.referencedTable, error: message });
      violations.push({ constraint: c.constraint, table: c.table, referencedTable: c.referencedTable, error: message });
    }
  }

  return {
    durationMs: Math.round(performance.now() - startMs),
    constraintsChecked: grouped.size,
    results,
    violations,
    pass: violations.length === 0,
  };
}

function startApiServer(db) {
  const app = createApp(db, { distDir: null, logger: null });
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function httpCall(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? safeParse(data) : null }));
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// Generic endpoint benchmark. bodyFn(i) -> raw request body string (null for GET).
async function benchmarkEndpoint(port, token, name, method, path, iterations, bodyFn = null) {
  const latencies = [];
  let errors = 0;
  const headers = { Authorization: `Bearer ${token}` };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  for (let i = 0; i < iterations; i += 1) {
    const startedAt = performance.now();
    try {
      const body = bodyFn ? bodyFn(i) : null;
      const result = await httpCall(port, method, path, headers, body);
      if (result.status >= 400) errors += 1;
    } catch { errors += 1; }
    latencies.push(performance.now() - startedAt);
  }
  return {
    name, method, path,
    samples: iterations,
    p50Ms: Math.round(percentile(latencies, 0.5) * 100) / 100,
    p95Ms: Math.round(percentile(latencies, 0.95) * 100) / 100,
    p99Ms: Math.round(percentile(latencies, 0.99) * 100) / 100,
    maxMs: Math.round(Math.max(...latencies) * 100) / 100,
    errors,
    errorRate: errors / iterations,
  };
}

const ENDPOINTS = [
  { name: 'inventory-list',                 method: 'GET',  path: '/api/inventory',                     iterations: 30 },
  { name: 'inventory-transactions-list',    method: 'GET',  path: '/api/inventory-transactions',        iterations: 30 },
  { name: 'sales-orders-list',              method: 'GET',  path: '/api/orders',                         iterations: 30 },
  { name: 'purchase-orders-list',           method: 'GET',  path: '/api/purchase-orders',                iterations: 30 },
  { name: 'bills-list',                     method: 'GET',  path: '/api/bills',                          iterations: 30 },
  { name: 'inventory-adjustments-list',     method: 'GET',  path: '/api/inventory-adjustments',          iterations: 30 },
  { name: 'accounts-receivable-list',       method: 'GET',  path: '/api/accounts-receivable',           iterations: 30 },
  { name: 'accounts-payable-list',          method: 'GET',  path: '/api/accounts-payable',              iterations: 30 },
  { name: 'accounting-vouchers-list',       method: 'GET',  path: '/api/accounting-vouchers',           iterations: 30 },
  { name: 'inventory-valuation-as-of',      method: 'GET',  path: '/api/reports/inventory-valuation',   iterations: 20 },
  { name: 'system-health',                  method: 'GET',  path: '/api/system-health',                  iterations: 20 },
  { name: 'dashboard',                      method: 'GET',  path: '/api/dashboard',                      iterations: 30 },
  { name: 'mrp-list',                       method: 'GET',  path: '/api/mrp-plans',                      iterations: 20 },
  { name: 'mrp-calculate',                  method: 'POST', path: '/api/mrp/calculate',                  iterations: 10,
    bodyFn: () => JSON.stringify({ type: 'product', productId: 'pr-0', quantity: 100 }) },
  { name: 'traceability-lot',               method: 'GET',  path: '/api/traceability?type=LOT&id=lot-0', iterations: 30 },
  { name: 'sales-order-create',             method: 'POST', path: '/api/orders',                         iterations: 10,
    bodyFn: (i) => JSON.stringify({
      customerId: 'cu-0',
      orderDate: '2026-09-25',
      requestedDeliveryDate: '2026-10-05',
      items: [{ productId: 'pr-0', quantity: 5, unitPriceCents: 10_000 }],
    }) },
];

function seedAdminAndSession(db) {
  // Reuse the canonical role-admin seeded by bootstrap
  // (server/db.js:1503, 1514). role-admin has every permission in PERMISSIONS,
  // so the benchmark exercises every authorisation path through the canonical
  // (permissions) → (role_permissions) → (roles) graph. We do NOT insert a
  // sixth normal role, do NOT touch permissions_json (which the canonical
  // roles schema does not have), and do NOT modify production auth.

  // Clean up any prior benchmark admin row. sessions.user_id FK→users.id so
  // sessions must be removed first.
  db.exec(`DELETE FROM sessions WHERE user_id='admin-user'`);
  try { db.exec("DELETE FROM users WHERE username='admin'"); } catch {}

  // Canonical users schema (server/db.js:740-749): id, username, display_name,
  // password_hash, password_salt, role_id, active, created_at. No updated_at.
  // hashPassword() returns { salt, hash } — both columns must be populated
  // separately because verifyPassword(password, salt, expectedHex) reads both.
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync('Admin#1234', salt, 64).toString('hex');
  const now = isoDate(0);
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
    'admin-user', 'admin', 'Administrator', hash, salt, 'role-admin', 1, now,
  );

  // Canonical sessions schema (server/db.js:751-756):
  // token_hash TEXT PRIMARY KEY, user_id, expires_at, created_at.
  // server/app.js:896 is the production insert path (login). Replicate it
  // here so the row is structurally identical to a live session; the
  // production authenticate() middleware (app.js:922-928) sha256-hashes the
  // bearer token from Authorization headers and looks up sessions.token_hash.
  const bearer = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(bearer).digest('hex');
  const expires = new Date(Date.now() + 3600_000).toISOString();
  db.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)`).run(
    tokenHash, 'admin-user', expires, now,
  );

  return bearer;
}

// EXPLAIN evidence: per query, report access type, chosen key/index, estimated
// rows, Extra flags, and a full-table-scan flag (type === 'ALL' in any row).
function captureExplain(db) {
  const targets = [
    { endpoint: 'inventory', sql: 'SELECT i.warehouse_id,i.product_id,i.quantity,i.updated_at,w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit,(SELECT MAX(t.created_at) FROM inventory_transactions t WHERE t.warehouse_id=i.warehouse_id AND t.product_id=i.product_id) recentMovementAt FROM inventory i JOIN warehouses w ON w.id=i.warehouse_id JOIN products p ON p.id=i.product_id ORDER BY w.code,p.code LIMIT 100' },
    { endpoint: 'inventory-movements', sql: 'SELECT COUNT(*) FROM inventory_transactions WHERE business_date>=?', params: ['2026-06-01'] },
    { endpoint: 'sales-outstanding', sql: 'SELECT so.id,so.order_no,so.customer_id,so.status FROM sales_orders so WHERE so.status=? ORDER BY so.order_date DESC LIMIT 100', params: ['CONFIRMED'] },
    { endpoint: 'ar-aging', sql: 'SELECT customer_id,SUM(open_amount_cents) FROM account_receivables WHERE status=? GROUP BY customer_id', params: ['PENDING'] },
    { endpoint: 'ar-list', sql: 'SELECT id,voucher_no,customer_id,open_amount_cents,business_date,due_date FROM account_receivables WHERE status=? ORDER BY due_date LIMIT 100', params: ['PENDING'] },
    { endpoint: 'valuation', sql: 'SELECT v.product_id,v.warehouse_id,SUM(v.quantity_delta) quantity,SUM(v.value_delta_cents) valueCents FROM inventory_valuation_movements v WHERE v.status=? AND v.business_date<=? GROUP BY v.product_id,v.warehouse_id', params: ['POSTED', '2026-09-25'] },
    { endpoint: 'ap-list', sql: 'SELECT id,voucher_no,supplier_id,open_amount_cents,business_date,due_date FROM account_payables WHERE status=? ORDER BY due_date LIMIT 100', params: ['PENDING'] },
    { endpoint: 'so-list', sql: 'SELECT so.id,so.order_no,so.customer_id,so.status FROM sales_orders so ORDER BY so.created_at DESC LIMIT 100' },
    { endpoint: 'traceability-lot', sql: 'SELECT id,product_id,lot_code,status FROM inventory_lots WHERE id=?', params: ['lot-0'] },
  ];
  const results = [];
  for (const target of targets) {
    try {
      const params = target.params || [];
      const plan = db.prepare(`EXPLAIN ${target.sql}`).all(...params);
      const hasFullScan = plan.some((row) => row.type === 'ALL');
      const summary = plan.map((row) => ({
        table: row.table, type: row.type, key: row.key, rows: row.rows, extra: row.Extra,
      }));
      results.push({
        endpoint: target.endpoint,
        sql: target.sql.replace(/\s+/g, ' ').trim().slice(0, 250),
        plan: summary,
        fullTableScan: hasFullScan,
      });
    } catch (error) {
      results.push({ endpoint: target.endpoint, error: error.message });
    }
  }
  return results;
}

// Verify provisional Phase 7C SME acceptance thresholds. Read endpoints are
// checked against readP95Ms; mutation endpoints against mutationP95Ms; the
// gate benchmark against gateP95Ms and gateMinThroughputPerSecond.
function verifyThresholds({ endpointResults, gateResults }) {
  const readOps = ['GET'];
  const mutationOps = ['POST', 'PUT', 'DELETE'];
  const findings = [];
  for (const ep of endpointResults) {
    const isMutation = mutationOps.includes(ep.method);
    const limit = isMutation ? THRESHOLDS.mutationP95Ms : THRESHOLDS.readP95Ms;
    const label = isMutation ? 'mutationP95Ms' : 'readP95Ms';
    if (ep.p95Ms > limit) {
      findings.push({ name: ep.name, kind: 'endpoint', metric: label, measured: ep.p95Ms, limit, pass: false });
    }
    if (ep.errorRate > THRESHOLDS.errorRate) {
      findings.push({ name: ep.name, kind: 'endpoint', metric: 'errorRate', measured: ep.errorRate, limit: THRESHOLDS.errorRate, pass: false });
    }
  }
  for (const g of gateResults) {
    if (g.p95Ms > THRESHOLDS.gateP95Ms) {
      findings.push({ name: `gate-${g.writers}`, kind: 'gate', metric: 'gateP95Ms', measured: g.p95Ms, limit: THRESHOLDS.gateP95Ms, pass: false });
    }
    if (g.throughputPerSecond < THRESHOLDS.gateMinThroughputPerSecond) {
      findings.push({ name: `gate-${g.writers}`, kind: 'gate', metric: 'gateThroughputPerSecond', measured: g.throughputPerSecond, limit: THRESHOLDS.gateMinThroughputPerSecond, pass: false });
    }
    if (g.errorRate > THRESHOLDS.errorRate) {
      findings.push({ name: `gate-${g.writers}`, kind: 'gate', metric: 'errorRate', measured: g.errorRate, limit: THRESHOLDS.errorRate, pass: false });
    }
  }
  return {
    thresholds: THRESHOLDS,
    findings,
    pass: findings.length === 0,
  };
}

(async () => {
  const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });

  // ---- Seed phase: deterministic lifecycle in the order required by the
  // disposable benchmark contract.
  //
  //   1. RESET                    — drop every table so a previous failed run
  //                                 cannot leak rows into this run
  //   2. MYSQL BOOTSTRAP          — recreate the V1.3 schema via the adapter
  //   3. VERIFY CLEAN             — assert every benchmark-owned table is
  //                                 empty before any populate step
  //   4. FINANCIAL FIXTURE PREFLIGHT — JS-only CHECK-set assertions on the
  //                                 literals the benchmark is about to INSERT
  //   5. POPULATE DATASET         — streaming multi-row INSERTs
  //   6. POST-SEED FK VALIDATION  — information_schema-derived orphan check
  //   7. VERIFY DATASET SCALE     — every benchmark-owned table has exactly
  //                                 SCALE rows
  //   8. BEGIN BENCHMARK TIMING   — only now
  //
  // Steps 1, 4, 6, 7 fail closed: any violation throws and exits 1.
  const seedStartMs = performance.now();
  const conn = await mysql.createConnection(mysqlConfig);

  // 1. RESET — guarantees a clean deterministic schema regardless of any
  // prior run that did not reach its cleanup().
  const resetStartMs = performance.now();
  await resetMySqlDatabase(conn);
  const resetDurationMs = Math.round(performance.now() - resetStartMs);
  console.log(`# Phase 7C — RESET disposable MySQL database (${resetDurationMs}ms)`);

  // 2. MYSQL BOOTSTRAP — creates the V1.3 schema and the canonical/static
  // seed rows. Bootstrap does NOT populate any benchmark-owned table.
  const mysqlDb = createTempDb({ label: 'mysql-phase7c-bench', production: true });
  const db = mysqlDb.db;
  console.log('# Phase 7C — bootstrap disposable MySQL database');
  const bootstrapDatasetScale = captureDatasetStats(db);
  console.log(JSON.stringify({ bootstrapDatasetScale, resetDurationMs }, null, 2));

  // 3. VERIFY CLEAN — every benchmark-owned high-volume table must be empty.
  // Canonical/static seed tables (roles, permissions, role_permissions,
  // accounting_subjects) are intentionally NOT checked — those are owned by
  // the V1.3 bootstrap, not by this benchmark.
  const staleTables = await verifyCleanBenchmarkTables(conn);
  if (staleTables.length) {
    await conn.end();
    mysqlDb.cleanup();
    console.error('STALE BENCHMARK TABLES AFTER RESET/BOOTSTRAP');
    console.error(JSON.stringify({ staleTables }, null, 2));
    throw new Error(`Stale benchmark tables after reset/bootstrap: ${staleTables.length} table(s) still have rows. First: ${JSON.stringify(staleTables[0])}`);
  }
  console.log(`# Phase 7C — verified clean: ${BENCHMARK_OWNED_TABLES.length} benchmark-owned tables empty`);

  // 4. FINANCIAL FIXTURE PREFLIGHT — JS-only assertions on the literals the
  // benchmark is about to INSERT, against the canonical CHECK sets.
  preflightFinancialFixtures();
  preflightProductionFixtures();
  console.log('# Phase 7C — financial + production fixture preflight passed');

  // 5. POPULATE DATASET — streaming multi-row INSERTs via raw mysql2.
  console.log('# Phase 7C — populating realistic MySQL dataset');
  const populateDurationMs = await populateDataset(conn);
  const datasetScale = captureDatasetStats(db);
  console.log('# Phase 7C — populated dataset');
  console.log(JSON.stringify({ populateDurationMs, datasetScale }, null, 2));

  // 6. POST-SEED FK VALIDATION — derived from information_schema, runs
  // before benchmark timing and stops the run on any orphan.
  const fkValidationStartMs = performance.now();
  const fkValidation = await validateReferentialIntegrity(conn);
  const fkValidationDurationMs = Math.round(performance.now() - fkValidationStartMs);
  console.log(`# Phase 7C — FK validation: ${fkValidation.constraintsChecked} FK(s) checked, ${fkValidation.results.filter((r) => r.orphanCount > 0).length} violation(s), ${fkValidationDurationMs}ms`);
  if (!fkValidation.pass) {
    await conn.end();
    mysqlDb.cleanup();
    console.error('POST-SEED FK VALIDATION FAILED');
    console.error(JSON.stringify({ fkValidation }, null, 2));
    throw new Error(`Post-seed FK validation failed: ${fkValidation.violations.length} FK(s) have orphan rows. First violation: ${JSON.stringify(fkValidation.violations[0])}`);
  }
  if (fkValidation.violations.length === 0 && fkValidation.constraintsChecked > 0) {
    for (const r of fkValidation.results) {
      console.log(`    ${r.constraint.padEnd(40)} ${r.table.padEnd(30)} -> ${r.referencedTable.padEnd(30)} orphans=${r.orphanCount}`);
    }
  }

  // 7. VERIFY DATASET SCALE — every benchmark-owned table must have exactly
  // its declared SCALE row count, no more and no fewer. COUNT(*) is exact
  // for InnoDB so no tolerance is applied.
  const scaleMismatches = verifyDatasetScale(datasetScale);
  if (scaleMismatches.length) {
    await conn.end();
    mysqlDb.cleanup();
    console.error('DATASET SCALE MISMATCH');
    console.error(JSON.stringify({ scaleMismatches, datasetScale, SCALE }, null, 2));
    throw new Error(`Dataset scale mismatch on ${scaleMismatches.length} table(s). First: ${JSON.stringify(scaleMismatches[0])}`);
  }
  console.log('# Phase 7C — verified dataset scale');

  await conn.end();
  const seedDurationMs = Math.round(performance.now() - seedStartMs);

  // 8. BEGIN BENCHMARK TIMING — only now.
  const benchmarkStartMs = performance.now();
  console.log('# Phase 7C — starting API server');
  const { server, port } = await startApiServer(db);
  const bearer = seedAdminAndSession(db);

  console.log('# Phase 7C — endpoint benchmarks');
  const endpointResults = [];
  for (const ep of ENDPOINTS) {
    const result = await benchmarkEndpoint(port, bearer, ep.name, ep.method, ep.path, ep.iterations, ep.bodyFn);
    endpointResults.push(result);
    console.log(`  ${ep.method.padEnd(4)} ${ep.path.padEnd(45)} samples=${result.samples} p50=${result.p50Ms.toFixed(2)}ms p95=${result.p95Ms.toFixed(2)}ms p99=${result.p99Ms.toFixed(2)}ms max=${result.maxMs.toFixed(2)}ms errors=${result.errors}/${result.samples}`);
  }

  console.log('# Phase 7C — singleton gate microbenchmark');
  const gateResults = [];
  for (const writers of [1, 5, 10, 20]) {
    const latencies = [];
    let errors = 0;
    let deadlocks = 0;
    let timeouts = 0;
    let otherCoded = 0;
    const errorClasses = {};
    const startedAt = performance.now();
    for (let w = 0; w < writers; w += 1) {
      for (let i = 0; i < 20; i += 1) {
        const opStart = performance.now();
        try {
          transaction(db, () => {
            const whIdx = w % SCALE.warehouses;
            const productIdx = (w * 1000 + i) % SCALE.products;
            db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=? FOR UPDATE').get(`wh-${whIdx}`, `pr-${productIdx}`);
            db.prepare('UPDATE inventory SET quantity=quantity+1, updated_at=? WHERE warehouse_id=? AND product_id=?').run(isoDate(0), `wh-${whIdx}`, `pr-${productIdx}`);
            db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,source_line_id,lot_id,serial_id,business_date,valuation_status)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
              randomUUID(), `wh-${whIdx}`, `pr-${productIdx}`, 1, 'IN', 1, 'INVENTORY_ADJUSTMENT', `bench-${w}-${i}`, `BENCH${w}-${i}`, 'Bench', 'system', isoDate(0), null, null, null, shortDate(0), 'VALUED');
          });
        } catch (error) {
          errors += 1;
          if (error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213) deadlocks += 1;
          else if (error?.code === 'ER_LOCK_WAIT_TIMEOUT' || error?.errno === 1205) timeouts += 1;
          else {
            otherCoded += 1;
            const key = error?.code || error?.message?.slice(0, 60) || 'unknown';
            errorClasses[key] = (errorClasses[key] || 0) + 1;
          }
        }
        latencies.push(performance.now() - opStart);
      }
    }
    const durationMs = performance.now() - startedAt;
    const baseline = percentile(latencies, 0.5);
    const result = {
      writers,
      operations: latencies.length,
      throughputPerSecond: Math.round((latencies.length / durationMs) * 100_000) / 100,
      p50Ms: Math.round(percentile(latencies, 0.5) * 100) / 100,
      p95Ms: Math.round(percentile(latencies, 0.95) * 100) / 100,
      p99Ms: Math.round(percentile(latencies, 0.99) * 100) / 100,
      maxMs: Math.round(Math.max(...latencies) * 100) / 100,
      estimatedQueueWaitP95Ms: Math.max(0, Math.round((percentile(latencies, 0.95) - baseline) * 100) / 100),
      errors, deadlocks, timeouts, otherCoded, errorClasses,
      errorRate: errors / latencies.length,
    };
    gateResults.push(result);
    console.log(`  ${writers} writers: ${result.throughputPerSecond} txn/s, p50=${result.p50Ms}ms, p95=${result.p95Ms}ms, p99=${result.p99Ms}ms, max=${result.maxMs}ms, errors=${errors} deadlocks=${deadlocks} timeouts=${timeouts}`);
  }

  console.log('# Phase 7C — EXPLAIN evidence');
  const explainResults = captureExplain(db);
  for (const r of explainResults) {
    if (r.error) {
      console.log(`  ${r.endpoint}: ERROR ${r.error}`);
    } else {
      const planRows = r.plan.map((row) => `${row.table || '?'} type=${row.type || '?'} key=${row.key || '?'} rows=${row.rows || '?'}${row.extra ? ` extra=${row.extra}` : ''}`).join(' | ');
      const scan = r.fullTableScan ? ' FULL-SCAN' : '';
      console.log(`  ${r.endpoint}: ${planRows}${scan}`);
    }
  }

  const thresholdReport = verifyThresholds({ endpointResults, gateResults });

  server.close();
  mysqlDb.cleanup();
  const benchmarkDurationMs = Math.round(performance.now() - benchmarkStartMs);

  console.log('\n# Phase 7C — final report');
  const report = {
    seedDurationMs,
    seedBreakdownMs: { reset: resetDurationMs, populate: populateDurationMs, fkValidation: fkValidationDurationMs },
    benchmarkDurationMs,
    datasetScale,
    fkValidation: {
      constraintsChecked: fkValidation.constraintsChecked,
      violations: fkValidation.violations,
      results: fkValidation.results,
      pass: fkValidation.pass,
    },
    endpointResults,
    gateResults,
    explainResults,
    thresholdReport,
  };
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error('PHASE 7C BENCHMARK FAILED:', error);
  process.exit(1);
});
