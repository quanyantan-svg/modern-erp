import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { runSalesCustomerMigrations } from './migrations/sales-customer-domain.js';
import { createTempDb } from './test-utils/temp-db.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

const FUTURE_SALES_TABLES = [
  'sales_quotations', 'sales_quotation_lines', 'sales_quotation_conversions',
  'sales_price_lists', 'sales_price_list_entries', 'sales_price_list_versions',
  'sales_discount_schemes', 'sales_discount_scheme_rules',
  'sales_order_changes', 'sales_order_change_lines',
  'delivery_notices', 'delivery_notice_lines',
  'sales_order_replacements', 'sales_order_replacement_lines',
  'customer_commercial_extensions', 'customer_material_xref',
  'sales_prepayment_requirements', 'sales_prepayment_gate_results',
  'sales_reservation_intent', 'service_fulfillments',
  'consignment_commercial_documents', 'consignment_commercial_lines',
  'consignment_commodity_locations', 'credit_parameters', 'credit_check_rules',
  'credit_policy_snapshots', 'credit_profile', 'credit_profile_ratings',
  'credit_special_approval', 'credit_check_results',
  'credit_evaluation_indicator', 'credit_evaluation_scheme',
  'credit_evaluation_model', 'credit_evaluation_scoring_sheet',
  'credit_evaluation_result', 'credit_recalculation_history',
  'product_commercial_classification', 'credit_lock_anchors',
];

const FUTURE_SALES_COLUMNS = {
  sales_orders: [
    'salesperson_code', 'sales_group_code', 'settlement_party_id', 'payer_id',
    'customer_material_xref_id', 'commercial_tax_code', 'tax_inclusive',
    'required_prepayment_cents', 'reservation_intent_state',
    'commercial_close_state', 'gift_summary_cents', 'commercial_pricing_uom_code',
  ],
  sales_order_items: [
    'is_gift_line', 'commercial_tax_basis', 'tax_inclusive_assumption',
    'pricing_uom_code_applied', 'qty_break_applied_min', 'qty_break_applied_max',
  ],
  sales_deliveries: ['delivery_notice_id'],
  sales_delivery_items: ['delivery_notice_line_id'],
  return_orders: ['commercial_source_marker'],
};

describe('Sales & Customer Wave 0 — real MySQL migration runner smoke', () => {
  let handle;
  let db;

  before(() => {
    handle = createTempDb({ label: 'sales-customer-wave0', production: true });
    db = handle.db;
  });

  after(() => {
    handle?.cleanup();
  });

  test('live MySqlSyncAdapter accepts a harmless injected step and remains usable', () => {
    assert.equal(db.dialect, 'mysql');
    assert.equal(db instanceof MySqlSyncAdapter, true);
    let received;
    const executed = runSalesCustomerMigrations(db, [{
      id: 'wave0-mysql-select-smoke',
      wave: 0,
      migrate(adapter) {
        received = adapter;
        assert.equal(adapter.prepare('SELECT 1 AS value').get().value, 1);
      },
    }]);

    assert.deepEqual(executed, ['wave0-mysql-select-smoke']);
    assert.equal(received, db);
    assert.equal(db.prepare('SELECT 1 AS value').get().value, 1);
  });

  test('Wave 0 creates none of the 38 frozen future Sales tables', () => {
    assert.equal(FUTURE_SALES_TABLES.length, 38);
    assert.equal(Object.values(FUTURE_SALES_COLUMNS).flat().length, 21);
    const placeholders = FUTURE_SALES_TABLES.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT TABLE_NAME table_name
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})
        ORDER BY TABLE_NAME`,
    ).all(...FUTURE_SALES_TABLES);
    assert.deepEqual(rows, []);

    for (const [table, columns] of Object.entries(FUTURE_SALES_COLUMNS)) {
      const columnPlaceholders = columns.map(() => '?').join(',');
      const found = db.prepare(
        `SELECT COLUMN_NAME column_name
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN (${columnPlaceholders})
          ORDER BY COLUMN_NAME`,
      ).all(table, ...columns);
      assert.deepEqual(found, [], `Wave 0 must not add future columns to ${table}`);
    }

    assert.equal(db.prepare(
      "SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_deliveries' AND COLUMN_NAME='billing_mode'",
    ).get().n, 1, 'Wave 0 preserves the existing billing_mode column');
  });
});
