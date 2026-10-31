// W11-A U3 — Demo Seed canonical inventory position identity on the live
// MySQL 8 target.
//
// Requirement : document.md R-U3-INV-01 .. R-U3-INV-08
// Design      : solution.md §37.54.46.5, §37.54.46.6, §37.54.46.7
//
// Flat top-level TAP only: the protected campaign parser accepts exactly one
// top-level plan and contiguous top-level records. Exactly eight top-level
// cases M-INV-01 .. M-INV-08, no describe, no it, no skip, no todo, no only.
//
// The suite runs against the real disposable MySQL 8 target through the
// existing MySQL adapter, the existing protected campaign lease and the
// production database initialization path. It never falls back to SQLite, it
// never fabricates an inventory fact and it never calls a private handler as
// a shortcut: the approval is driven through the real HTTP surface.
//
// The Demo Seed boundary is deliberate. The protected campaign runner hands
// the child NODE_ENV=test and ERP_SEED_DEMO=false, and `shouldSeedDemoData()`
// treats only NODE_ENV=production as a suppression, so the seed runs and the
// fresh bootstrap really carries the six demo inventory positions. The
// fixture therefore never uses createTempDb({production:true}).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { captureSqliteSnapshot } from './database/mysql-schema.js';
import { computePositionKey } from './lib/inventory-position.js';
import { createTempDb } from './test-utils/temp-db.js';
import { createWave10MysqlLifecycle } from './test-utils/mysql-wave10-campaign-target.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);
}
if (process.env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
  throw new Error('MYSQL TEST ENVIRONMENT = UNAVAILABLE (ERP_MYSQL_TEST_ALLOW_RESET=true required)');
}

const CAMPAIGN = 'W11-A U3 INVENTORY DEMO SEED MYSQL E3 ACCEPTANCE';
const BUSINESS_DATE = '2099-06-01';
const TARGET_WAREHOUSE = 'warehouse-001';
const TARGET_PRODUCT = 'product-001';
const COUNTED_QUANTITY = 22;

// The one explicit fixture fact. The demo product carries no standard
// manufacturing cost, so an approved adjustment would be the legacy unvalued
// movement with a zero amount and the system voucher would be skipped for an
// empty entry set. The cost is applied only after M-INV-01 .. M-INV-04 have
// observed the untouched fresh bootstrap, exactly as the local SQLite suite
// does.
const FIXTURE_STANDARD_COST_CENTS = 259900;

const CANONICAL_DIMENSIONS = Object.freeze({
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

const DEMO_POSITIONS = Object.freeze([
  Object.freeze({ id: 'seed-inv-warehouse-001-001', warehouseId: 'warehouse-001', productId: 'product-001', quantity: 20 }),
  Object.freeze({ id: 'seed-inv-warehouse-001-002', warehouseId: 'warehouse-001', productId: 'product-002', quantity: 100 }),
  Object.freeze({ id: 'seed-inv-warehouse-001-003', warehouseId: 'warehouse-001', productId: 'product-003', quantity: 30 }),
  Object.freeze({ id: 'seed-inv-warehouse-002-001', warehouseId: 'warehouse-002', productId: 'product-001', quantity: 16 }),
  Object.freeze({ id: 'seed-inv-warehouse-002-002', warehouseId: 'warehouse-002', productId: 'product-002', quantity: 80 }),
  Object.freeze({ id: 'seed-inv-warehouse-002-003', warehouseId: 'warehouse-002', productId: 'product-003', quantity: 22 }),
]);

function canonicalKey(warehouseId, productId) {
  return computePositionKey({ productId, warehouseId, ...CANONICAL_DIMENSIONS });
}

// Every physical field is projected through an explicit type so that the
// SQLite reference, the SQLite snapshot and the MySQL target compare on
// values and never on the driver's native representation.
function normalizeInventoryRow(row) {
  const text = (value) => (value === null || value === undefined ? null : String(value));
  return {
    id: text(row.id),
    warehouse_id: text(row.warehouse_id),
    product_id: text(row.product_id),
    quantity: Number(row.quantity),
    position_key: text(row.position_key),
    bin_id: text(row.bin_id),
    owner_type: text(row.owner_type),
    owner_id: text(row.owner_id),
    stock_status: text(row.stock_status),
    lot_id: text(row.lot_id),
    serial_id: text(row.serial_id),
    active: Number(row.active),
  };
}

function readInventoryRows(db) {
  return db.prepare(`SELECT id, warehouse_id, product_id, quantity, position_key,
      bin_id, owner_type, owner_id, stock_status, lot_id, serial_id, active
    FROM inventory ORDER BY id`).all().map(normalizeInventoryRow);
}

function countOf(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.c);
}

const state = {
  mysqlHandle: null,
  mysqlDb: null,
  reopenedDb: null,
  snapshotRows: [],
  server: null,
  baseUrl: '',
  tokens: {},
  checkId: '',
  guardCheckId: '',
  beforeApproval: null,
  afterApproval: null,
  approvedFacts: null,
  evidenceWritten: false,
};

const httpLog = [];
const evidence = {
  startedAt: new Date().toISOString(),
  campaign: CAMPAIGN,
  suite: 'W11-A-U3-INVENTORY-DEMO-SEED',
  requirement: 'document.md R-U3-INV-01 .. R-U3-INV-08',
  design: 'solution.md §37.54.46.5 .. §37.54.46.7',
  cases: {},
  facts: {},
  http: httpLog,
};

function evidenceDirectory() {
  const configured = String(process.env.U3_INVENTORY_EVIDENCE_DIR || '').trim();
  if (configured) return configured;
  return join(tmpdir(), `modern-erp-w11a-u3-inventory-mysql-e3-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`);
}

function writeEvidence() {
  const dir = evidenceDirectory();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'inventory-demo-seed-mysql-e3-evidence.json');
  evidence.completedAt = new Date().toISOString();
  writeFileSync(file, JSON.stringify(evidence, null, 2));
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  // The digest lives beside the evidence, never inside it, so the digest of
  // the evidence file stays stable and verifiable.
  writeFileSync(`${file}.sha256`, `${sha256}  inventory-demo-seed-mysql-e3-evidence.json\n`);
  state.evidenceWritten = true;
  // A TAP diagnostic, never a TAP record: the first word is not one of the
  // reserved summary names, so the strict parser cannot read it as a record.
  process.stdout.write(`# W11-A-U3-INVENTORY-E3 EVIDENCE ${file} sha256=${sha256}\n`);
  return { file, sha256 };
}

async function api(path, { method = 'GET', body, token, sensitive = false } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${state.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = { rawText: raw }; }
  }
  // The credential never reaches the evidence. A login response carries the
  // session token, so only its method, path and status are recorded.
  httpLog.push(sensitive
    ? { method, path, status: response.status, credential: 'MASKED' }
    : { method, path, status: response.status, request: body ?? null, response: payload });
  return { status: response.status, payload };
}

async function login(username, password) {
  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    sensitive: true,
  });
  assert.equal(result.status, 200, `login for ${username} failed`);
  assert.ok(result.payload?.token, `login for ${username} returned no token`);
  return result.payload.token;
}

before(async () => {
  // The exact snapshot the MySQL bootstrap consumes: the same production
  // SQLite initialization path, with the same Demo Seed.
  const snapshot = captureSqliteSnapshot((path) => createDatabase(path), true);
  const snapshotInventory = snapshot.tables.find((table) => table.name === 'inventory');
  assert.ok(snapshotInventory, 'the SQLite snapshot must carry the inventory table');
  state.snapshotRows = snapshotInventory.rows.map(normalizeInventoryRow)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  // No `production` option: the Demo Seed must really run on the live target.
  state.mysqlHandle = createTempDb({
    label: 'w11-a-u3-inventory-mysql-e3',
    mysqlLifecycle: createWave10MysqlLifecycle(),
  });
  state.mysqlDb = state.mysqlHandle.db;
  assert.equal(state.mysqlDb.dialect, 'mysql', 'the gate target must not fall back to SQLite');

  state.server = createServer(createApp(state.mysqlDb, { distDir: resolve('dist') }));
  await new Promise((done) => state.server.listen(0, '127.0.0.1', done));
  state.baseUrl = `http://127.0.0.1:${state.server.address().port}`;

  state.tokens.warehouse = await login('warehouse', 'warehouse123');
  state.tokens.admin = await login('admin', 'admin123');
  state.tokens.sales = await login('sales', 'sales123');
});

after(async () => {
  if (state.server?.listening) {
    await new Promise((done) => state.server.close(() => done()));
  }
  try { state.reopenedDb?.close(); } catch { /* already released */ }
  state.mysqlHandle?.close();
  // The schema cleanup belongs to the protected runner and the protected
  // launcher. The suite never claims the five-class zero itself.
  state.mysqlHandle?.cleanup();
  if (!state.evidenceWritten) writeEvidence();
});

test('M-INV-01 the fresh MySQL bootstrap carries the six demo inventory rows of the same SQLite snapshot', () => {
  const db = state.mysqlDb;
  assert.equal(db.dialect, 'mysql');
  const rows = readInventoryRows(db);

  assert.equal(rows.length, 6, 'the fresh bootstrap creates exactly six demo inventory rows');
  assert.deepEqual(
    rows.map((row) => row.id),
    DEMO_POSITIONS.map((position) => position.id),
    'the six seeded row identities are the canonical ones',
  );
  for (const expected of DEMO_POSITIONS) {
    const row = rows.find((candidate) => candidate.id === expected.id);
    assert.ok(row, `${expected.id} must exist`);
    assert.equal(row.warehouse_id, expected.warehouseId);
    assert.equal(row.product_id, expected.productId);
    assert.equal(row.quantity, expected.quantity);
    assert.equal(row.active, 1);
    assert.match(row.position_key, /^[0-9a-f]{64}$/, `${expected.id} must carry a canonical position key`);
  }

  // The full row copy: the live MySQL rows and the SQLite snapshot rows are
  // identical, and nothing was silently dropped.
  assert.equal(state.snapshotRows.length, 6, 'the SQLite snapshot carries the same six rows');
  assert.deepEqual(rows, state.snapshotRows, 'the MySQL rows are a complete copy of the SQLite snapshot rows');

  evidence.cases['M-INV-01'] = {
    dialect: db.dialect,
    mysqlRowCount: rows.length,
    snapshotRowCount: state.snapshotRows.length,
    rowIdentities: rows.map((row) => row.id),
    quantities: rows.map((row) => row.quantity),
    completeRowCopy: true,
  };
});

test('M-INV-02 every stored position key is the canonical computation of its own stored dimensions', () => {
  const db = state.mysqlDb;
  const rows = readInventoryRows(db);
  for (const row of rows) {
    const expected = computePositionKey({
      productId: row.product_id,
      warehouseId: row.warehouse_id,
      binId: row.bin_id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      stockStatus: row.stock_status,
      lotId: row.lot_id,
      serialId: row.serial_id,
    });
    assert.equal(row.position_key, expected, `${row.id} must carry its own canonical position key`);
    assert.equal(row.bin_id, null, `${row.id} bin_id`);
    assert.equal(row.owner_type, 'ENTERPRISE', `${row.id} owner_type`);
    assert.equal(row.owner_id, null, `${row.id} owner_id`);
    assert.equal(row.stock_status, 'AVAILABLE', `${row.id} stock_status`);
    assert.equal(row.lot_id, null, `${row.id} lot_id`);
    assert.equal(row.serial_id, null, `${row.id} serial_id`);
  }

  // The physical column must be able to hold the canonical 64-character key
  // without truncation.
  const column = db.prepare(`SELECT DATA_TYPE data_type, IS_NULLABLE is_nullable,
      CHARACTER_MAXIMUM_LENGTH max_length
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory' AND COLUMN_NAME='position_key'`).get();
  assert.ok(column, 'the inventory table must carry a position_key column');
  assert.ok(['varchar', 'char'].includes(String(column.data_type).toLowerCase()),
    `position_key must be a character column (actual ${column.data_type})`);
  assert.ok(Number(column.max_length) >= 64, 'position_key must hold the 64-character canonical key');

  evidence.cases['M-INV-02'] = {
    verifiedRows: rows.length,
    physicalColumn: {
      dataType: String(column.data_type),
      nullable: column.is_nullable === 'YES',
      maxLength: Number(column.max_length),
    },
    canonicalDimensions: CANONICAL_DIMENSIONS,
  };
});

test('M-INV-03 no active row carries a NULL, an empty or a synthetic fallback position key', () => {
  const db = state.mysqlDb;
  const rows = readInventoryRows(db);

  const nullKeys = rows.filter((row) => row.active === 1 && row.position_key === null);
  const emptyKeys = rows.filter((row) => row.active === 1 && row.position_key === '');
  const syntheticKeys = rows.filter((row) => row.active === 1 && row.position_key !== null
    && row.position_key !== '' && row.position_key !== computePositionKey({
      productId: row.product_id,
      warehouseId: row.warehouse_id,
      binId: row.bin_id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      stockStatus: row.stock_status,
      lotId: row.lot_id,
      serialId: row.serial_id,
    }));
  assert.deepEqual(nullKeys.map((row) => row.id), [], 'no active row may carry a NULL position key');
  assert.deepEqual(emptyKeys.map((row) => row.id), [], 'no active row may carry an empty position key');
  assert.deepEqual(syntheticKeys.map((row) => row.id), [], 'no active row may carry a synthetic fallback position key');

  // The unique index is supporting evidence only. The data is the contract.
  const uniqueIndexes = db.prepare(`SELECT DISTINCT INDEX_NAME index_name FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory' AND COLUMN_NAME='position_key' AND NON_UNIQUE=0`).all();
  assert.ok(uniqueIndexes.length >= 1, 'the canonical position key carries a unique index');

  evidence.cases['M-INV-03'] = {
    activeRows: rows.filter((row) => row.active === 1).length,
    nullPositionKeys: nullKeys.length,
    emptyPositionKeys: emptyKeys.length,
    syntheticFallbackKeys: syntheticKeys.length,
    uniquePositionKeyIndexes: uniqueIndexes.map((row) => row.index_name),
  };
});

test('M-INV-04 no logical inventory position holds more than one active row', () => {
  const db = state.mysqlDb;
  const rows = readInventoryRows(db).filter((row) => row.active === 1);
  assert.equal(rows.length, 6, 'the fresh bootstrap holds exactly six active positions');

  const byCanonical = new Map();
  for (const row of rows) {
    const key = computePositionKey({
      productId: row.product_id,
      warehouseId: row.warehouse_id,
      binId: row.bin_id,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      stockStatus: row.stock_status,
      lotId: row.lot_id,
      serialId: row.serial_id,
    });
    const bucket = byCanonical.get(key);
    if (bucket) bucket.push(row.id);
    else byCanonical.set(key, [row.id]);
  }
  const duplicates = [...byCanonical.entries()].filter(([, ids]) => ids.length > 1);
  assert.deepEqual(duplicates.map(([key, ids]) => ({ key, ids })), [], 'no canonical identity may hold two active rows');

  // The source identity and the stock state of the approved position.
  const source = db.prepare(`SELECT id, warehouse_id, product_id, quantity, position_key, active
    FROM inventory WHERE warehouse_id=? AND product_id=?`).get(TARGET_WAREHOUSE, TARGET_PRODUCT);
  assert.ok(source, 'the seeded source position must exist');
  assert.equal(source.id, 'seed-inv-warehouse-001-001');
  assert.equal(Number(source.quantity), 20);
  assert.equal(source.position_key, canonicalKey(TARGET_WAREHOUSE, TARGET_PRODUCT));
  assert.equal(Number(source.active), 1);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory WHERE position_key=? AND active=1', source.position_key), 1);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory WHERE warehouse_id=? AND product_id=?', TARGET_WAREHOUSE, TARGET_PRODUCT), 1);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM warehouses WHERE id=? AND active=1', TARGET_WAREHOUSE), 1);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM products WHERE id=? AND active=1', TARGET_PRODUCT), 1);

  state.beforeApproval = {
    id: String(source.id),
    warehouseId: String(source.warehouse_id),
    productId: String(source.product_id),
    quantity: Number(source.quantity),
    positionKey: String(source.position_key),
  };
  evidence.cases['M-INV-04'] = {
    canonicalIdentities: byCanonical.size,
    duplicateCanonicalIdentities: duplicates.length,
    sourceIdentity: state.beforeApproval,
  };
});

test('M-INV-05 the real HTTP approval moves the seeded canonical position from 20 to 22 in place', async () => {
  const db = state.mysqlDb;

  // The one explicit fixture fact, applied only after the fresh bootstrap
  // facts were observed.
  db.prepare('UPDATE products SET standard_manufacturing_cost_cents=? WHERE id=?')
    .run(FIXTURE_STANDARD_COST_CENTS, TARGET_PRODUCT);

  // Permission boundary: a user without INVENTORY_CHECK_CREATE is refused.
  const forbidden = await api('/api/inventory-checks', {
    method: 'POST',
    token: state.tokens.sales,
    body: { warehouseId: TARGET_WAREHOUSE, productId: TARGET_PRODUCT, actualQuantity: COUNTED_QUANTITY, businessDate: BUSINESS_DATE, reason: 'unauthorized create' },
  });
  assert.equal(forbidden.status, 403, 'a user without the create permission must be refused');

  // The self-approval guard. The administrator creates and submits its own
  // check and then tries to approve it, while the seeded quantity is still
  // the system quantity, so only the guard itself can refuse.
  const guardCreated = await api('/api/inventory-checks', {
    method: 'POST',
    token: state.tokens.admin,
    body: { warehouseId: TARGET_WAREHOUSE, productId: TARGET_PRODUCT, actualQuantity: COUNTED_QUANTITY, businessDate: BUSINESS_DATE, reason: 'self approval guard probe' },
  });
  assert.equal(guardCreated.status, 201, JSON.stringify(guardCreated.payload));
  state.guardCheckId = String(guardCreated.payload.id);
  const guardSubmitted = await api(`/api/inventory-checks/${state.guardCheckId}`, {
    method: 'PATCH', token: state.tokens.admin, body: { action: 'SUBMIT' },
  });
  assert.equal(guardSubmitted.status, 200, JSON.stringify(guardSubmitted.payload));
  const guardApproved = await api(`/api/inventory-checks/${state.guardCheckId}`, {
    method: 'PATCH', token: state.tokens.admin, body: { action: 'APPROVE' },
  });
  assert.equal(guardApproved.status, 409, JSON.stringify(guardApproved.payload));
  assert.equal(guardApproved.payload?.error, '盘点单创建人不能审批自己的单据');
  assert.equal(db.prepare('SELECT status status FROM inventory_checks WHERE id=?').get(state.guardCheckId).status, 'SUBMITTED');

  // The warehouse actor creates and submits the counted check.
  const created = await api('/api/inventory-checks', {
    method: 'POST',
    token: state.tokens.warehouse,
    body: { warehouseId: TARGET_WAREHOUSE, productId: TARGET_PRODUCT, actualQuantity: COUNTED_QUANTITY, businessDate: BUSINESS_DATE, reason: 'M-INV-05 counted position' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.status, 'DRAFT');
  state.checkId = String(created.payload.id);
  const submitted = await api(`/api/inventory-checks/${state.checkId}`, {
    method: 'PATCH', token: state.tokens.warehouse, body: { action: 'SUBMIT' },
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.payload));

  // The administrator approves it.
  const approved = await api(`/api/inventory-checks/${state.checkId}`, {
    method: 'PATCH', token: state.tokens.admin, body: { action: 'APPROVE' },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.payload));

  const check = db.prepare('SELECT id, check_no, status, reviewer_id, reviewed_at, business_date, system_quantity, actual_quantity, difference FROM inventory_checks WHERE id=?')
    .get(state.checkId);
  assert.equal(check.status, 'APPROVED');
  assert.equal(check.reviewer_id, 'user-admin');
  assert.ok(check.reviewed_at);

  // The canonical position was updated in place.
  const canonical = db.prepare('SELECT id, quantity, position_key, active FROM inventory WHERE position_key=? AND active=1')
    .get(state.beforeApproval.positionKey);
  assert.ok(canonical, 'the canonical position must still exist');
  assert.equal(canonical.id, state.beforeApproval.id, 'the approval updated the seeded row in place');
  assert.equal(Number(canonical.quantity), COUNTED_QUANTITY, 'the seeded quantity moved from 20 to 22');
  const unqualified = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?')
    .get(TARGET_WAREHOUSE, TARGET_PRODUCT);
  assert.equal(Number(unqualified.quantity), COUNTED_QUANTITY);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory'), 6, 'the approval created no additional inventory row');
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory WHERE position_key=? AND active=1', state.beforeApproval.positionKey), 1,
    'exactly one active row carries the canonical position key');
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory WHERE warehouse_id=? AND product_id=? AND active=1', TARGET_WAREHOUSE, TARGET_PRODUCT), 1,
    'exactly one active row describes the logical position');

  state.afterApproval = {
    id: String(canonical.id),
    quantity: Number(canonical.quantity),
    positionKey: String(canonical.position_key),
  };
  evidence.cases['M-INV-05'] = {
    forbiddenCreateStatus: forbidden.status,
    selfApprovalGuardStatus: guardApproved.status,
    selfApprovalGuardMessage: guardApproved.payload?.error ?? null,
    guardCheckRemained: 'SUBMITTED',
    approvedCheckId: state.checkId,
    approvedStatus: check.status,
    reviewerId: check.reviewer_id,
    businessDate: check.business_date,
    before: state.beforeApproval,
    after: state.afterApproval,
    inventoryRowCount: 6,
    activeRowsForLogicalPosition: 1,
  };
});

test('M-INV-06 the approval writes one inventory transaction, one audit record, one valuation movement and one balanced system voucher', () => {
  const db = state.mysqlDb;
  const check = db.prepare('SELECT system_quantity, actual_quantity, difference, business_date FROM inventory_checks WHERE id=?').get(state.checkId);
  const difference = Number(check.difference);
  const actualQuantity = Number(check.actual_quantity);
  assert.ok(difference > 0, 'the counted difference must be a real business fact');

  const transactions = db.prepare(`SELECT * FROM inventory_transactions
    WHERE source_type='INVENTORY_CHECK' AND source_id=?`).all(state.checkId);
  assert.equal(transactions.length, 1, 'exactly one inventory transaction');
  const transaction = transactions[0];
  assert.equal(Number(transaction.quantity_change), difference);
  assert.equal(transaction.direction, 'IN');
  assert.equal(Number(transaction.balance_after), actualQuantity);
  assert.equal(transaction.business_date, check.business_date);
  assert.equal(transaction.creator_id, 'user-admin');

  const audits = db.prepare(`SELECT * FROM audit_logs
    WHERE entity_type='INVENTORY_CHECK' AND entity_id=? AND action='APPROVE'`).all(state.checkId);
  assert.equal(audits.length, 1, 'the approval wrote exactly one audit record');
  assert.equal(audits[0].user_id, 'user-admin');

  const valuations = db.prepare(`SELECT * FROM inventory_valuation_movements
    WHERE source_type='INVENTORY_CHECK' AND source_id=?`).all(state.checkId);
  assert.equal(valuations.length, 1, 'the approval wrote exactly one valuation movement');
  const valuation = valuations[0];
  assert.equal(Number(valuation.quantity_delta), difference);
  assert.equal(valuation.valuation_basis, 'STANDARD_COST');

  // The amount is derived from the actual business facts: the counted
  // difference and the frozen standard cost of the product.
  const standardCostCents = Number(db.prepare('SELECT standard_manufacturing_cost_cents cost FROM products WHERE id=?')
    .get(TARGET_PRODUCT).cost);
  assert.equal(standardCostCents, FIXTURE_STANDARD_COST_CENTS);
  const expectedAmountCents = difference * standardCostCents;
  assert.ok(Number.isSafeInteger(expectedAmountCents));
  const valuationAmountCents = Math.abs(Number(valuation.value_delta_cents));
  assert.ok(Number.isSafeInteger(valuationAmountCents), 'the valuation amount is an integer number of cents');
  assert.ok(valuationAmountCents > 0, 'the valuation carries a real amount');
  assert.equal(valuationAmountCents, expectedAmountCents, 'the valuation amount is the standard cost times the counted difference');

  const vouchers = db.prepare(`SELECT * FROM accounting_vouchers
    WHERE source_type='INVENTORY_COUNT' AND source_id=?`).all(state.checkId);
  assert.equal(vouchers.length, 1, 'the approval wrote exactly one system voucher');
  const entries = db.prepare('SELECT * FROM accounting_entries WHERE voucher_id=?').all(vouchers[0].id);
  assert.ok(entries.length >= 2, 'the system voucher carries its entries');
  const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
  const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + Number(entry.amount_cents), 0);
  assert.equal(debit, credit, 'the system voucher stays balanced');
  assert.equal(debit, valuationAmountCents, 'the voucher amount agrees with the valuation amount');
  assert.ok(Number.isSafeInteger(debit));

  // No duplicate side effects. The blocked self-approval produced none.
  assert.equal(countOf(db, `SELECT COUNT(*) c FROM inventory_transactions WHERE source_type='INVENTORY_CHECK'`), 1);
  assert.equal(countOf(db, `SELECT COUNT(*) c FROM inventory_valuation_movements WHERE source_type='INVENTORY_CHECK'`), 1);
  assert.equal(countOf(db, `SELECT COUNT(*) c FROM accounting_vouchers WHERE source_type='INVENTORY_COUNT'`), 1);
  assert.equal(countOf(db, `SELECT COUNT(*) c FROM inventory_transactions WHERE source_id=?`, state.guardCheckId), 0);
  assert.equal(countOf(db, `SELECT COUNT(*) c FROM inventory_valuation_movements WHERE source_id=?`, state.guardCheckId), 0);
  assert.equal(countOf(db, `SELECT COUNT(*) c FROM accounting_vouchers WHERE source_id=?`, state.guardCheckId), 0);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory_mutation_log'), 0);

  state.approvedFacts = {
    difference,
    actualQuantity,
    standardCostCents,
    valuationAmountCents,
    voucherDebitCents: debit,
    voucherCreditCents: credit,
    inventoryTransactionId: String(transaction.id),
    valuationMovementId: String(valuation.id),
    voucherId: String(vouchers[0].id),
  };
  evidence.cases['M-INV-06'] = {
    ...state.approvedFacts,
    inventoryTransactions: transactions.length,
    auditRecords: audits.length,
    valuationMovements: valuations.length,
    systemVouchers: vouchers.length,
    voucherEntries: entries.length,
    duplicateSideEffects: 0,
  };
});

test('M-INV-07 a reopen and a repeated initialization preserve the quantity and add no row', () => {
  const db = state.mysqlDb;
  const before = db.prepare('SELECT id, quantity, position_key FROM inventory WHERE position_key=? AND active=1')
    .get(state.beforeApproval.positionKey);
  assert.equal(Number(before.quantity), COUNTED_QUANTITY);
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory'), 6);

  // The reopen is a real reopen of the same database through the production
  // initialization path: the original connection is released and a new one is
  // opened against the same schema. The database is never destroyed and
  // rebuilt, so a destroy-and-recreate can never masquerade as a reopen.
  state.mysqlHandle.close();
  const reopened = createDatabase({ backend: 'mysql' });
  try {
    assert.equal(reopened.dialect, 'mysql');
    const rows = readInventoryRows(reopened);
    assert.equal(rows.length, 6, 'a repeated bootstrap adds no inventory row');
    const row = rows.find((candidate) => candidate.id === state.beforeApproval.id);
    assert.ok(row, 'the seeded row identity survives the reopen');
    assert.equal(row.quantity, COUNTED_QUANTITY, 'a repeated bootstrap never overwrites the real quantity');
    assert.equal(row.position_key, state.beforeApproval.positionKey, 'the canonical identity is preserved');
    assert.equal(row.active, 1);
    assert.equal(countOf(reopened, 'SELECT COUNT(*) c FROM inventory WHERE position_key=? AND active=1', state.beforeApproval.positionKey), 1,
      'the logical position still holds exactly one active row');
    assert.equal(countOf(reopened, `SELECT COUNT(*) c FROM inventory WHERE position_key IS NULL OR position_key=''`), 0,
      'a repeated bootstrap produces no keyless position');
    assert.equal(countOf(reopened, `SELECT COUNT(*) c FROM inventory_transactions WHERE source_type='INVENTORY_CHECK'`), 1,
      'a repeated bootstrap adds no duplicate inventory transaction');
    assert.equal(countOf(reopened, `SELECT COUNT(*) c FROM inventory_valuation_movements WHERE source_type='INVENTORY_CHECK'`), 1);
    assert.equal(countOf(reopened, `SELECT COUNT(*) c FROM accounting_vouchers WHERE source_type='INVENTORY_COUNT'`), 1);
    state.reopenedDb = reopened;
  } catch (error) {
    reopened.close();
    throw error;
  }

  evidence.cases['M-INV-07'] = {
    reopenedThrough: 'createDatabase({backend:mysql})',
    originalConnectionReleased: true,
    rowCount: 6,
    quantityBeforeReopen: COUNTED_QUANTITY,
    quantityAfterReopen: COUNTED_QUANTITY,
    positionKeyStable: true,
    duplicateRows: 0,
    duplicateInventoryTransactions: 0,
  };
});

test('M-INV-08 the suite releases its resources and writes a complete, verifiable evidence record', async () => {
  const db = state.reopenedDb || state.mysqlDb;

  // The acceptance data is still present. The five-class zero is confirmed by
  // the protected runner and by the protected launcher, never by this suite.
  const objects = {
    tables: Number(db.prepare("SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'").get().count),
    views: Number(db.prepare("SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='VIEW'").get().count),
    triggers: Number(db.prepare("SELECT COUNT(*) count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()").get().count),
    routines: Number(db.prepare("SELECT COUNT(*) count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()").get().count),
    events: Number(db.prepare("SELECT COUNT(*) count FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()").get().count),
  };
  assert.ok(objects.tables > 0, 'the acceptance data is still present, so the outer cleanup has real work to do');
  assert.equal(countOf(db, 'SELECT COUNT(*) c FROM inventory'), 6);

  // Resource release.
  await new Promise((done) => state.server.close(() => done()));
  assert.equal(state.server.listening, false, 'the HTTP server must be released');
  if (state.reopenedDb) state.reopenedDb.close();
  else state.mysqlHandle.close();
  assert.equal(db.closed, true, 'the MySQL adapter must be released');

  evidence.cases['M-INV-08'] = {
    httpServerReleased: true,
    mysqlAdapterReleased: true,
    objectsBeforeOuterCleanup: objects,
    fiveClassZeroOwner: 'protected runner and protected launcher',
    acceptanceDataStillPresent: true,
  };
  evidence.facts = {
    campaign: CAMPAIGN,
    httpCalls: httpLog.length,
    approvedCheckId: state.checkId,
    guardCheckId: state.guardCheckId,
  };

  const written = writeEvidence();
  const bytes = readFileSync(written.file);
  const recomputed = createHash('sha256').update(bytes).digest('hex');
  assert.equal(recomputed, written.sha256, 'the evidence file digest must match its content');
  assert.equal(
    readFileSync(`${written.file}.sha256`, 'utf8').trim().split(/\s+/)[0],
    written.sha256,
    'the recorded digest must match the evidence file',
  );
  const parsed = JSON.parse(bytes.toString('utf8'));
  for (const id of ['M-INV-01', 'M-INV-02', 'M-INV-03', 'M-INV-04', 'M-INV-05', 'M-INV-06', 'M-INV-07', 'M-INV-08']) {
    assert.ok(parsed.cases[id], `the evidence must carry the case record ${id}`);
  }
  assert.equal(parsed.http.length, httpLog.length);
  for (const call of parsed.http) {
    assert.ok(!JSON.stringify(call).includes('token'), 'the evidence must never carry a session token');
  }
});
