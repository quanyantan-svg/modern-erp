// scripts/mysql-phase7c-slow-query-diagnostics.mjs
//
// Read-only diagnostic for Phase 7C performance failures. Targets the
// already-populated disposable MySQL database. Does NOT reset, does NOT
// reseed, does NOT mutate any data, does NOT start the full benchmark.
//
// For each known slow endpoint SQL it:
//   - captures EXPLAIN rows (table, type, possible_keys, key, key_len,
//     ref, rows, filtered, Extra) using EXPLAIN (not EXPLAIN ANALYZE —
//     never execute the real 60-second query)
//   - captures SHOW INDEX output for every table touched
//   - captures exact row counts and the cardinality the endpoint expects
//     to return (LIMIT 200 for transactions, unbounded for inventory +
//     orders, single-row for sessions)
//
// Run only when:
//   - ERP_DB_BACKEND=mysql
//   - ERP_DB_* connection variables are set
//   - ERP_MYSQL_TEST_ALLOW_RESET=true
//   - the database name matches /test|phase7[abc]|disposable/i
//
// Production is never contacted.

import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { resolveDatabaseConfig } from '../server/database/config.js';

process.env.ERP_DB_BACKEND = 'mysql';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length || process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  console.error(`SLOW-QUERY DIAGNOSTICS = UNAVAILABLE${missing.length ? ` (${missing.join(', ')} missing)` : ' (ERP_MYSQL_TEST_ALLOW_RESET=true required)'}`);
  process.exit(2);
}
if (!/(?:test|phase7[abc]|disposable)/i.test(process.env.ERP_DB_NAME)) {
  console.error(`Refusing diagnostic for non-disposable database: ${process.env.ERP_DB_NAME}`);
  process.exit(2);
}

const TABLES_OF_INTEREST = [
  'inventory', 'inventory_transactions', 'inventory_valuation_movements',
  'sales_orders', 'sales_order_items', 'sales_deliveries',
  'customers', 'products', 'warehouses',
  'sessions', 'users', 'roles', 'role_permissions',
];

async function safeQuery(conn, sql, params = []) {
  try {
    const [rows] = await conn.query(sql, params);
    return { rows, error: null };
  } catch (error) {
    return { rows: null, error: error?.message || String(error) };
  }
}

async function captureTableRowCounts(conn) {
  const counts = {};
  for (const table of TABLES_OF_INTEREST) {
    const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    counts[table] = Number(rows[0].n);
  }
  return counts;
}

async function captureShowIndex(conn) {
  const indexes = {};
  for (const table of TABLES_OF_INTEREST) {
    const { rows, error } = await safeQuery(conn, `SHOW INDEX FROM \`${table}\``);
    if (error) { indexes[table] = { error }; continue; }
    indexes[table] = (rows || []).map((row) => ({
      key_name: row.Key_name, column_name: row.Column_name, seq_in_index: row.Seq_in_index,
      non_unique: row.Non_unique, cardinality: row.Cardinality, index_type: row.Index_type,
    }));
  }
  return indexes;
}

async function explainQuery(conn, label, sql, params = []) {
  const startMs = performance.now();
  const { rows, error } = await safeQuery(conn, `EXPLAIN ${sql}`, params);
  const durationMs = Math.round((performance.now() - startMs) * 100) / 100;
  if (error) {
    console.log(`  ${label.padEnd(45)} EXPLAIN ERROR (${durationMs}ms): ${error}`);
    return { label, error, durationMs };
  }
  console.log(`  ${label.padEnd(45)} EXPLAIN (${durationMs}ms)`);
  for (const row of rows) {
    console.log(`    table=${row.table} type=${row.type} key=${row.key || '-'} key_len=${row.key_len || '-'} ` +
      `rows=${row.rows || '-'} filtered=${row.filtered || '-'} extra=${row.Extra || '-'}`);
    if (row.partitions) console.log(`    partitions=${row.partitions}`);
  }
  return { label, plan: rows, durationMs };
}

// The endpoint SQLs, copied verbatim from server/app.js. Each is the query
// the live endpoint actually executes for an empty-param GET request (the
// shape the Phase 7C benchmark exercises). Do NOT add LIMIT or other
// shortcuts — these are the real production SQLs and the diagnostic must
// surface their actual cost.
const SLOW_SQLS = [
  {
    label: 'GET /api/inventory',
    expectedCardinality: 'unbounded (no LIMIT; inventory has 25,000 rows)',
    sql: `SELECT i.warehouse_id,i.product_id,i.quantity,i.updated_at,w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit,
      (SELECT MAX(t.created_at) FROM inventory_transactions t WHERE t.warehouse_id=i.warehouse_id AND t.product_id=i.product_id) recentMovementAt
      FROM inventory i JOIN warehouses w ON w.id=i.warehouse_id JOIN products p ON p.id=i.product_id
      ORDER BY w.code,p.code`,
    params: [],
    correlatedSubqueries: [
      `(SELECT MAX(t.created_at) FROM inventory_transactions t WHERE t.warehouse_id=i.warehouse_id AND t.product_id=i.product_id) per inventory row`,
    ],
  },
  {
    label: 'GET /api/inventory-transactions',
    expectedCardinality: 'LIMIT 200, but the LIKE search with no params matches all 600,000 inventory_transactions',
    sql: `SELECT t.*,t.source_type tx_type,t.source_no ref_no,CASE WHEN t.direction='OUT' THEN -t.quantity_change ELSE t.quantity_change END quantity,t.balance_after balance,
      w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit
      FROM inventory_transactions t
      JOIN warehouses w ON w.id = t.warehouse_id
      JOIN products p ON p.id = t.product_id
      WHERE (t.source_no LIKE ? OR p.code LIKE ? OR p.name LIKE ?)
      ORDER BY t.created_at DESC LIMIT 200`,
    params: ['%%', '%%', '%%'],
    correlatedSubqueries: [],
  },
  {
    label: 'GET /api/orders (orderRows main)',
    expectedCardinality: 'unbounded (no LIMIT; sales_orders has 35,000 rows)',
    sql: `SELECT so.id,so.order_no orderNo,so.status,so.total_cents totalCents,so.remark,
      so.rejection_reason rejectionReason,so.created_at createdAt,so.updated_at updatedAt,so.submitted_at submittedAt,
      so.reviewed_at reviewedAt,
      so.order_date orderDate,so.requested_delivery_date requestedDeliveryDate,so.payment_terms paymentTerms,so.payment_terms_days paymentTermsDays,
      so.ship_to_contact_name shipToContactName,so.ship_to_phone shipToPhone,so.ship_to_address shipToAddress,
      c.id customerId,c.code customerCode,c.name customerName,c.contact customerContact,c.phone customerPhone,c.address customerAddress,
      creator.display_name creatorName,reviewer.display_name reviewerName,
      (SELECT count(*) FROM sales_order_items i WHERE i.order_id=so.id) itemCount,
      (SELECT count(*) FROM sales_deliveries sd WHERE sd.sales_order_id=so.id) deliveryCount
    FROM sales_orders so
    JOIN customers c ON c.id=so.customer_id
    JOIN users creator ON creator.id=so.creator_id
    LEFT JOIN users reviewer ON reviewer.id=so.reviewer_id
    ORDER BY so.created_at DESC`,
    params: [],
    correlatedSubqueries: [
      `(SELECT count(*) FROM sales_order_items i WHERE i.order_id=so.id) runs per sales_order row — touches sales_order_items (90,000 rows) with N×M = 35K × 90K = 3.15B index lookups worst case`,
      `(SELECT count(*) FROM sales_deliveries sd WHERE sd.sales_order_id=so.id) runs per sales_order row`,
    ],
  },
  {
    label: 'GET /api/orders (sales_order_items correlated subquery only)',
    expectedCardinality: 'N/A — correlated subquery inside orderRows',
    sql: `SELECT count(*) FROM sales_order_items i WHERE i.order_id=?`,
    params: ['so-0'],
    correlatedSubqueries: [],
  },
  {
    label: 'authenticate() sessions lookup',
    expectedCardinality: 'single row (token_hash PK, expires_at filter)',
    sql: `SELECT u.*, r.name role_name, r.code role_code
      FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,
    params: ['0000000000000000000000000000000000000000000000000000000000000000', new Date().toISOString()],
    correlatedSubqueries: [],
  },
  {
    label: 'actorFromRow() permissions lookup',
    expectedCardinality: 'one row per permission in role_permissions',
    sql: `SELECT permission_code code FROM role_permissions WHERE role_id=? ORDER BY permission_code`,
    params: ['role-admin'],
    correlatedSubqueries: [],
  },
];

(async () => {
  const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
  const conn = await mysql.createConnection(mysqlConfig);

  console.log('# Phase 7C slow-query diagnostic');
  console.log(`# database = ${mysqlConfig.database}`);
  console.log('# mode = read-only EXPLAIN + SHOW INDEX + COUNT(*); no mutations, no reseed');

  console.log('\n## Table row counts (from COUNT(*))');
  const rowCounts = await captureTableRowCounts(conn);
  for (const table of TABLES_OF_INTEREST) {
    console.log(`  ${table.padEnd(36)} ${rowCounts[table].toLocaleString()}`);
  }

  console.log('\n## SHOW INDEX per table');
  const indexes = await captureShowIndex(conn);
  for (const table of TABLES_OF_INTEREST) {
    const ix = indexes[table];
    if (ix?.error) { console.log(`  ${table.padEnd(36)} ERROR ${ix.error}`); continue; }
    if (!ix || ix.length === 0) { console.log(`  ${table.padEnd(36)} (no secondary indexes — primary key only)`); continue; }
    for (const row of ix) {
      console.log(`  ${table.padEnd(36)} key=${row.key_name.padEnd(36)} column=${row.column_name.padEnd(20)} seq=${row.seq_in_index} non_unique=${row.non_unique} cardinality=${row.cardinality} type=${row.index_type}`);
    }
  }

  console.log('\n## EXPLAIN for each slow query (no execution)');
  for (const q of SLOW_SQLS) {
    console.log(`\n### ${q.label}`);
    console.log(`  expected cardinality: ${q.expectedCardinality}`);
    if (q.correlatedSubqueries.length) {
      console.log(`  correlated subqueries:`);
      for (const sub of q.correlatedSubqueries) console.log(`    - ${sub}`);
    }
    await explainQuery(conn, q.label, q.sql, q.params);
  }

  console.log('\n## Per-query fingerprint summary');
  for (const q of SLOW_SQLS) {
    const norm = q.sql.replace(/\s+/g, ' ').trim();
    console.log(`  ${q.label.padEnd(45)} fingerprint=${createHash('sha256').update(norm).digest('hex').slice(0, 16)}`);
  }

  await conn.end();
})().catch((error) => {
  console.error('SLOW-QUERY DIAGNOSTICS FAILED:', error?.message || error);
  process.exit(1);
});