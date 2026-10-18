// Wave 7 real-MySQL migration and metadata acceptance.
// Registered by scripts/gates/mysql-gate.mjs; never run without that gate's
// disposable-database identity and explicit reset authorization.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { migrateSalesCustomerWave7PrepaymentReservation, SALES_WAVE7_TABLES } from './migrations/sales-customer-wave7-prepayment-reservation.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');

describe('Sales & Customer Wave 7 — real MySQL migration metadata', () => {
  let handle;
  let db;

  before(() => {
    handle = createTempDb({ label: 'sales-customer-wave7', production: true });
    db = handle.db;
    assert.equal(db.dialect, 'mysql');
    assert.match(String(db.prepare('SELECT VERSION() version').get().version), /^8\./);
  });
  after(() => handle?.cleanup());

  test('fresh bootstrap and idempotent replay materialize all Wave 7 carriers', () => {
    migrateSalesCustomerWave7PrepaymentReservation(db);
    migrateSalesCustomerWave7PrepaymentReservation(db);
    const placeholders = SALES_WAVE7_TABLES.map(() => '?').join(',');
    const rows = db.prepare(`SELECT TABLE_NAME name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME`).all(...SALES_WAVE7_TABLES);
    assert.deepEqual(rows.map((row) => row.name), [...SALES_WAVE7_TABLES].sort());
    for (const table of SALES_WAVE7_TABLES) {
      assert.equal(db.prepare(`SELECT ENGINE engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`).get(table).engine, 'InnoDB');
    }
  });

  test('columns preserve nullability, defaults and quantity precision', () => {
    const rows = db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME column_name,DATA_TYPE data_type,
        IS_NULLABLE is_nullable,COLUMN_DEFAULT column_default,NUMERIC_PRECISION numeric_precision,NUMERIC_SCALE numeric_scale
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN ('sales_prepayment_requirements','sales_prepayment_gate_results','sales_reservation_intent')`).all();
    const byKey = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
    assert.deepEqual(
      ['requested_qty','granted_qty','consumed_qty','released_qty'].map((name) => {
        const row = byKey.get(`sales_reservation_intent.${name}`);
        return [name, row.data_type, row.is_nullable, Number(row.numeric_precision), Number(row.numeric_scale)];
      }),
      [
        ['requested_qty','decimal','NO',24,6], ['granted_qty','decimal','NO',24,6],
        ['consumed_qty','decimal','NO',24,6], ['released_qty','decimal','NO',24,6],
      ],
    );
    assert.equal(byKey.get('sales_reservation_intent.sales_order_item_id').is_nullable, 'YES');
    assert.equal(byKey.get('sales_prepayment_requirements.line_no').is_nullable, 'NO');
    assert.equal(String(byKey.get('sales_prepayment_requirements.line_no').column_default), '0');
  });

  test('FK, CHECK, UNIQUE and supporting-index metadata match the logical contract', () => {
    const fks = db.prepare(`SELECT TABLE_NAME table_name,COLUMN_NAME column_name,
        REFERENCED_TABLE_NAME referenced_table,REFERENCED_COLUMN_NAME referenced_column
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN ('sales_prepayment_requirements','sales_prepayment_gate_results','sales_reservation_intent')
        AND REFERENCED_TABLE_NAME IS NOT NULL`).all();
    const fkKeys = new Set(fks.map((row) => `${row.table_name}.${row.column_name}->${row.referenced_table}.${row.referenced_column}`));
    for (const expected of [
      'sales_prepayment_requirements.sales_order_id->sales_orders.id',
      'sales_prepayment_requirements.created_by->users.id',
      'sales_prepayment_gate_results.overridden_by->users.id',
      'sales_prepayment_gate_results.evaluated_by->users.id',
      'sales_reservation_intent.sales_order_item_id->sales_order_items.id',
      'sales_reservation_intent.product_id->products.id',
      'sales_reservation_intent.warehouse_id->warehouses.id',
      'sales_reservation_intent.planning_reservation_id->planning_reservations.id',
      'sales_reservation_intent.inventory_lock_id->inventory_locks.id',
      'sales_reservation_intent.created_by->users.id',
    ]) assert.ok(fkKeys.has(expected), expected);

    const checks = db.prepare(`SELECT CONSTRAINT_NAME name,CHECK_CLAUSE clause
      FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
        AND CONSTRAINT_NAME LIKE 'chk_sales_%'`).all();
    assert.ok(checks.length >= 8, JSON.stringify(checks));

    const unique = db.prepare(`SELECT COLUMN_NAME column_name,EXPRESSION expression,SEQ_IN_INDEX seq_in_index,NON_UNIQUE non_unique
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_reservation_intent'
        AND INDEX_NAME='uq_sales_reservation_intent_order_line_mode' ORDER BY SEQ_IN_INDEX`).all();
    assert.equal(unique.length, 3);
    assert.equal(unique[0].column_name, 'sales_order_id');
    assert.match(String(unique[1].expression), /coalesce/i);
    assert.equal(unique[2].column_name, 'reservation_mode');
    assert.ok(unique.every((row) => Number(row.non_unique) === 0));
  });

  test('existing-schema reconciliation fails closed when normalized identity already contains duplicates', () => {
    const now = new Date().toISOString();
    const suffix = Date.now().toString(36);
    const userId = `w7-meta-user-${suffix}`;
    const customerId = `w7-meta-customer-${suffix}`;
    const orderId = `w7-meta-order-${suffix}`;
    const productId = `w7-meta-product-${suffix}`;
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(userId, userId, userId, 'x', 'x', now);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,1,?,?)`).run(customerId, `W7C-${suffix}`, 'W7 Metadata', '', '', '', now, now);
    db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at)
      VALUES(?,?,?,'EA',0,0,1,?,?)`).run(productId, `W7P-${suffix}`, 'W7 Metadata Product', now, now);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at)
      VALUES(?,?,?,'DRAFT',0,?,?,?)`).run(orderId, `W7SO-${suffix}`, customerId, userId, now, now);
    db.exec('DROP INDEX uq_sales_reservation_intent_order_line_mode ON sales_reservation_intent');
    for (const n of [1, 2]) db.prepare(`INSERT INTO sales_reservation_intent(
      id,sales_order_id,sales_order_item_id,product_id,reservation_mode,intent_state,
      requested_qty,granted_qty,consumed_qty,released_qty,created_at,created_by)
      VALUES(?,?,NULL,?,'ON_HAND_RESERVATION','REQUESTED',1,0,0,0,?,?)`)
      .run(`w7-meta-intent-${suffix}-${n}`, orderId, productId, now, userId);
    assert.throws(() => migrateSalesCustomerWave7PrepaymentReservation(db), /duplicate normalized reservation intent identity/);
  });
});
