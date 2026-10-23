import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { runSalesCustomerMigrations } from './migrations/sales-customer-domain.js';
import { SALES_WAVE1_TABLES } from './migrations/sales-customer-wave1-foundation.js';
import { SALES_WAVE2_TABLES } from './migrations/sales-customer-wave2-pricing.js';
import { SALES_WAVE3_TABLES } from './migrations/sales-customer-wave3-quotation.js';
import { SALES_WAVE4_TABLES } from './migrations/sales-customer-wave4-orders.js';
import { SALES_WAVE5_TABLES } from './migrations/sales-customer-wave5-delivery.js';
import { SALES_WAVE6_TABLES } from './migrations/sales-customer-wave6-returns.js';
import { SALES_WAVE9_TABLES } from './migrations/sales-customer-wave9-credit-foundation.js';
import { createTempDb } from './test-utils/temp-db.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

const BATCH_A_TABLES = [...SALES_WAVE3_TABLES, ...SALES_WAVE4_TABLES, ...SALES_WAVE5_TABLES];
const WAVE7_PLUS_SALES_TABLES = [
  'service_fulfillments',
  'consignment_commercial_documents', 'consignment_commercial_lines',
  'consignment_commodity_locations', ...SALES_WAVE9_TABLES,
];

const WAVE10_PLUS_SALES_TABLES = [
  'credit_special_approval', 'credit_check_results',
  'credit_evaluation_indicator', 'credit_evaluation_scheme',
  'credit_evaluation_model', 'credit_evaluation_scoring_sheet',
  'credit_evaluation_result', 'credit_recalculation_history',
];

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

  test('fresh MySQL materialises Waves 1-9 and no later credit schema', () => {
    assert.equal(BATCH_A_TABLES.length, 7);
    assert.equal(Object.values(BATCH_A_COLUMNS).flat().length, 27);
    const wave1Placeholders = SALES_WAVE1_TABLES.map(() => '?').join(',');
    const wave1 = db.prepare(`SELECT TABLE_NAME table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${wave1Placeholders}) ORDER BY TABLE_NAME`).all(...SALES_WAVE1_TABLES);
    assert.deepEqual(wave1.map((row) => row.table_name), [...SALES_WAVE1_TABLES].sort());
    const wave2Placeholders = SALES_WAVE2_TABLES.map(() => '?').join(',');
    const wave2 = db.prepare(`SELECT TABLE_NAME table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${wave2Placeholders}) ORDER BY TABLE_NAME`).all(...SALES_WAVE2_TABLES);
    assert.deepEqual(wave2.map((row) => row.table_name), [...SALES_WAVE2_TABLES].sort());
    const batchPlaceholders = BATCH_A_TABLES.map(() => '?').join(',');
    const batchRows = db.prepare(`SELECT TABLE_NAME table_name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${batchPlaceholders}) ORDER BY TABLE_NAME`).all(...BATCH_A_TABLES);
    assert.deepEqual(batchRows.map((row) => row.table_name), [...BATCH_A_TABLES].sort());
    const wave6Placeholders = SALES_WAVE6_TABLES.map(() => '?').join(',');
    const wave6Rows = db.prepare(`SELECT TABLE_NAME table_name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${wave6Placeholders}) ORDER BY TABLE_NAME`).all(...SALES_WAVE6_TABLES);
    assert.deepEqual(wave6Rows.map((row) => row.table_name), [...SALES_WAVE6_TABLES].sort());
    const lotFrontierIndex = db.prepare(`SELECT COLUMN_NAME column_name,SEQ_IN_INDEX sequence_no,
        SUB_PART sub_part,NON_UNIQUE non_unique,INDEX_TYPE index_type
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_valuation_movements'
        AND INDEX_NAME='idx_valuation_movements_identity_status_created'
      ORDER BY SEQ_IN_INDEX`).all();
    assert.deepEqual(lotFrontierIndex.map((row) => [
      row.column_name, Number(row.sequence_no), row.sub_part == null ? null : Number(row.sub_part),
      Number(row.non_unique), row.index_type,
    ]), [
      ['product_id', 1, null, 1, 'BTREE'],
      ['warehouse_id', 2, null, 1, 'BTREE'],
      ['lot_id', 3, null, 1, 'BTREE'],
      ['serial_id', 4, null, 1, 'BTREE'],
      ['status', 5, 16, 1, 'BTREE'],
      ['created_at', 6, 64, 1, 'BTREE'],
      ['id', 7, null, 1, 'BTREE'],
    ]);
    const placeholders = WAVE7_PLUS_SALES_TABLES.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT TABLE_NAME table_name
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})
        ORDER BY TABLE_NAME`,
    ).all(...WAVE7_PLUS_SALES_TABLES);
    assert.deepEqual(rows.map((row) => row.table_name), [...WAVE7_PLUS_SALES_TABLES].sort());
    const futurePlaceholders = WAVE10_PLUS_SALES_TABLES.map(() => '?').join(',');
    const future = db.prepare(`SELECT TABLE_NAME table_name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${futurePlaceholders}) ORDER BY TABLE_NAME`).all(...WAVE10_PLUS_SALES_TABLES);
    assert.deepEqual(future, []);

    const defaults = db.prepare(`SELECT COLUMN_NAME column_name,IS_NULLABLE is_nullable FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_commercial_extensions'
        AND COLUMN_NAME IN ('default_pricing_list_id','default_discount_scheme_id') ORDER BY COLUMN_NAME`).all();
    assert.deepEqual(defaults.map((row) => [row.column_name,row.is_nullable]), [['default_discount_scheme_id','YES'],['default_pricing_list_id','YES']]);
    const defaultFks = db.prepare(`SELECT CONSTRAINT_NAME constraint_name,COLUMN_NAME column_name,REFERENCED_TABLE_NAME target
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='customer_commercial_extensions'
        AND COLUMN_NAME IN ('default_pricing_list_id','default_discount_scheme_id') AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY COLUMN_NAME`).all();
    assert.deepEqual(defaultFks.map((row) => [row.constraint_name,row.column_name,row.target]), [
      ['fk_customer_commercial_default_discount_scheme','default_discount_scheme_id','sales_discount_schemes'],
      ['fk_customer_commercial_default_price_list','default_pricing_list_id','sales_price_lists'],
    ]);
    const triggers = db.prepare(`SELECT TRIGGER_NAME trigger_name,ACTION_TIMING action_timing,EVENT_MANIPULATION event_name,
      EVENT_OBJECT_TABLE table_name,ACTION_STATEMENT action_statement FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
      AND TRIGGER_NAME IN ('trg_sales_price_entries_identity_bi','trg_sales_price_entries_identity_bu') ORDER BY TRIGGER_NAME`).all();
    assert.deepEqual(triggers.map((row) => [row.trigger_name,row.action_timing,row.event_name,row.table_name]), [
      ['trg_sales_price_entries_identity_bi','BEFORE','INSERT','sales_price_list_entries'],
      ['trg_sales_price_entries_identity_bu','BEFORE','UPDATE','sales_price_list_entries'],
    ]);
    for (const trigger of triggers) {
      assert.match(trigger.action_statement, /BINARY NEW\.material_identity_key/);
      assert.match(trigger.action_statement, /BINARY NEW\.customer_scope_key/);
      assert.match(trigger.action_statement, /BINARY NEW\.pricing_identity_key/);
    }
    const uniqueIndexes = db.prepare(`SELECT INDEX_NAME index_name,COLUMN_NAME column_name,SEQ_IN_INDEX sequence_no
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_price_list_entries'
      AND NON_UNIQUE=0 AND INDEX_NAME<>'PRIMARY' ORDER BY INDEX_NAME,SEQ_IN_INDEX`).all();
    const groupedIndexes = Map.groupBy(uniqueIndexes, (row) => row.index_name);
    assert.ok([...groupedIndexes.values()].some((rows) => rows.map((row) => row.column_name).join(',')
      === 'price_list_id,material_identity_key,customer_scope_key,pricing_identity_key'));

    for (const [table, columns] of Object.entries(BATCH_A_COLUMNS)) {
      const columnPlaceholders = columns.map(() => '?').join(',');
      const found = db.prepare(
        `SELECT COLUMN_NAME column_name
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN (${columnPlaceholders})
          ORDER BY COLUMN_NAME`,
      ).all(table, ...columns);
      assert.deepEqual(found.map((row) => row.column_name), [...columns].sort(), `Batch A columns on ${table}`);
    }

    const snapshotTypes = db.prepare(`SELECT COLUMN_NAME column_name,DATA_TYPE data_type,IS_NULLABLE is_nullable
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_order_items'
        AND COLUMN_NAME IN ('price_snapshot_json','discount_snapshot_json') ORDER BY COLUMN_NAME`).all();
    assert.deepEqual(snapshotTypes.map((row) => [row.column_name,row.data_type,row.is_nullable]), [
      ['discount_snapshot_json','json','YES'], ['price_snapshot_json','json','YES'],
    ]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_orders' AND COLUMN_NAME='commercial_source_marker'").get().n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_order_items' AND COLUMN_NAME='sales_order_item_id'").get().n, 1);

    assert.equal(db.prepare(
      "SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_deliveries' AND COLUMN_NAME='billing_mode'",
    ).get().n, 1, 'Wave 0 preserves the existing billing_mode column');
  });
});
