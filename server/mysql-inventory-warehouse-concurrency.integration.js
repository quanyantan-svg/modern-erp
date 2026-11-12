// V24 Inventory & Warehouse Domain real MySQL concurrency matrix.
//
// Each race scenario starts two worker subprocesses — each with its own MySQL
// connection — and releases them through a common gate, so the race happens on
// a real MySQL 8 server and not as an interleaving of synchronous calls inside
// one event loop. The final state is then verified against the canonical
// production tables (inventory, inventory_transactions, inventory_mutation_log,
// inventory_locks, inventory_checks, inventory_transfers).
//
// The MySQL dialect is asserted on bootstrap, so a silent SQLite fallback can
// never produce a false-green result.
//
// Run:
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… ERP_MYSQL_TEST_ALLOW_RESET=true \
//   node --test server/mysql-inventory-warehouse-concurrency.integration.js

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { resolveDatabaseConfig } from './database/config.js';
import { computePositionKey } from './lib/inventory-position.js';

// The lifecycle used when the suite runs inside the Inventory & Warehouse
// ACK-4 campaign: the disposable target is already bootstrapped and the schema
// drop belongs to the Root's CLEANUP_SCHEMA_POST_RUN child.
const inventoryWarehouseGateLifecycle = {
  beforeCreate(config) {
    if (!/(?:test|phase7|disposable|domain_test)/i.test(String(config?.database || ''))) {
      throw new Error(`INVENTORY_WAREHOUSE RACE SUITE REFUSED: ${config?.database} is not a disposable target`);
    }
  },
  verify(db) {
    if (db.dialect !== 'mysql') throw new Error(`INVENTORY_WAREHOUSE RACE SUITE REFUSED: dialect=${db.dialect}`);
  },
  reset() {
    // The Root's CLEANUP_SCHEMA_POST_RUN child owns the schema drop.
  },
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'inventory-warehouse-concurrency-worker.mjs');
const ACTOR_ID = 'inventory-warehouse-race-actor';
const COUNTER_ID = 'inventory-warehouse-race-counter';
const APPROVER_ID = 'inventory-warehouse-race-approver';

describe('V24 Inventory & Warehouse real MySQL concurrency matrix (4 races)', () => {
  let mysql;
  let db;
  let observer;
  let counter = 0;

  function now() { return new Date().toISOString(); }

  /**
   * Start two workers, wait until both hold a live MySQL session, then release
   * them together. Returns each worker's parsed response.
   */
  async function raceTwo(specs) {
    const dir = mkdtempSync(join(tmpdir(), 'iw-race-'));
    const gate = join(dir, 'gate');
    const children = specs.map((spec, index) => {
      const payloadFile = join(dir, `payload-${index}.json`);
      const readyFile = join(dir, `ready-${index}`);
      writeFileSync(payloadFile, JSON.stringify(spec.payload));
      const child = spawn(process.execPath, [
        workerPath, '--action', spec.action, '--payload', payloadFile,
        '--ready', readyFile, '--gate', gate,
      ], { cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      // The exit promise is captured at spawn time. Attaching the listener
      // after the gate is released would miss the 'exit' event of a worker
      // that finishes first, and the await would then never settle.
      const exited = new Promise((resolveExit) => {
        child.on('exit', (code) => resolveExit(code));
      });
      return { child, readyFile, exited, stdout: () => stdout, stderr: () => stderr };
    });

    const deadline = Date.now() + 60_000;
    while (!children.every((entry) => existsSync(entry.readyFile))) {
      if (Date.now() >= deadline) {
        for (const entry of children) entry.child.kill('SIGKILL');
        throw new Error(`INVENTORY_WAREHOUSE RACE READY_TIMEOUT: ${children.map((e) => e.stderr()).join(' | ')}`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    writeFileSync(gate, 'go\n');
    const results = [];
    for (const entry of children) {
      const code = await Promise.race([
        entry.exited,
        new Promise((resolveTimeout) => setTimeout(() => resolveTimeout('TIMEOUT'), 60_000)),
      ]);
      if (code === 'TIMEOUT') {
        entry.child.kill('SIGKILL');
        throw new Error(`INVENTORY_WAREHOUSE RACE WORKER_TIMEOUT: ${entry.stderr()}`);
      }
      const raw = entry.stdout().trim().split(/\r?\n/).filter(Boolean).findLast((line) => line.startsWith('{'));
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
      results.push({ code, result: parsed, stderr: entry.stderr() });
    }
    rmSync(dir, { recursive: true, force: true });
    return results;
  }

  function auditCount(action, entityId) {
    return Number(db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE action=? AND entity_id=?')
      .get(action, entityId)?.n || 0);
  }

  /** Two warehouses, one product and one canonical position holding 100. */
  function seedScenario() {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const productId = `iw-race-product-${suffix}`;
    const fromWarehouseId = `iw-race-wh-from-${suffix}`;
    const toWarehouseId = `iw-race-wh-to-${suffix}`;
    const stamp = now();
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES(?,?,?,'竞态','件',0,0,1,'NONE',?,?)`).run(productId, `IWR-P-${suffix}`, '竞态产品', stamp, stamp);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,?,?)`)
      .run(fromWarehouseId, `IWR-WF-${suffix}`, '竞态调出仓', stamp, stamp);
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,?,?)`)
      .run(toWarehouseId, `IWR-WT-${suffix}`, '竞态调入仓', stamp, stamp);
    const positionKey = computePositionKey({
      productId, warehouseId: fromWarehouseId, binId: null, ownerType: 'ENTERPRISE',
      ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null,
    });
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES(?,?,?,100,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)`)
      .run(`iw-race-inv-${suffix}`, fromWarehouseId, productId, stamp, positionKey);
    return { suffix, productId, fromWarehouseId, toWarehouseId, positionKey };
  }

  function onHand(productId, warehouseId) {
    return Number(db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND warehouse_id=? AND active=1')
      .get(productId, warehouseId)?.q || 0);
  }

  before(() => {
    mysql = createTempDb({
      label: 'mysql-inventory-warehouse-races',
      production: true,
      mysqlLifecycle: process.env.ERP_INVENTORY_WAREHOUSE_MYSQL_GATE === '1' ? inventoryWarehouseGateLifecycle : null,
    });
    db = mysql.db;
    if (db.dialect !== 'mysql') {
      throw new Error(
        `Inventory & Warehouse MySQL race suite expected db.dialect='mysql' but got '${db.dialect}'. `
        + `Set ERP_TEST_DB_BACKEND=mysql and ERP_DB_BACKEND=mysql before invoking this suite.`,
      );
    }
    console.log(`INVENTORY_WAREHOUSE RACE DIALECT = ${db.dialect}`);
    const { backend: _backend, ...mysqlConfig } = resolveDatabaseConfig({ backend: 'mysql' });
    observer = new MySqlSyncAdapter(mysqlConfig);
    const server = observer.prepare('SELECT VERSION() version, DATABASE() database_name').get();
    if (!/^8\./.test(String(server?.version || ''))) {
      throw new Error(`Inventory & Warehouse MySQL race suite requires MySQL 8; server reported '${server?.version || 'unknown'}'`);
    }
    console.log(`INVENTORY_WAREHOUSE RACE MYSQL SERVER = ${server.version} database=${server.database_name} dialect=mysql`);
    const insertUser = db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,'x','x','role-admin',1,?)`);
    insertUser.run(ACTOR_ID, ACTOR_ID, '竞态用户', new Date().toISOString());
    insertUser.run(COUNTER_ID, COUNTER_ID, '竞态盘点人', new Date().toISOString());
    insertUser.run(APPROVER_ID, APPROVER_ID, '竞态审核人', new Date().toISOString());
  });

  beforeEach(() => {
    db.prepare('DELETE FROM audit_logs WHERE user_id IN (?,?,?)').run(ACTOR_ID, COUNTER_ID, APPROVER_ID);
  });

  after(() => {
    observer?.close();
    mysql?.cleanup();
  });

  // INV-RACE-01 -------------------------------------------------------
  // Two concurrent confirmations of the same transfer must move the stock
  // exactly once. The canonical confirm re-reads the document inside the
  // transaction and compares the status, so the second confirmation is
  // refused.
  test('INV-RACE-01 concurrent double confirmation of one transfer moves the stock once', async () => {
    const scenario = seedScenario();
    const stamp = now();
    const transferId = `iw-race-transfer-${scenario.suffix}`;
    db.prepare(`INSERT INTO inventory_transfers(id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at,business_date)
      VALUES(?,?,?,?,'DRAFT','','${ACTOR_ID}',?,?,'2026-11-12')`)
      .run(transferId, `IT-IWR-${scenario.suffix}`, scenario.fromWarehouseId, scenario.toWarehouseId, stamp, stamp);
    db.prepare(`INSERT INTO inventory_transfer_items(id,transfer_id,product_id,quantity) VALUES(?,?,?,10)`)
      .run(`iw-race-transfer-item-${scenario.suffix}`, transferId, scenario.productId);

    const results = await raceTwo([
      { action: 'transfer-confirm', payload: { transferId, approverActorId: APPROVER_ID } },
      { action: 'transfer-confirm', payload: { transferId, approverActorId: APPROVER_ID } },
    ]);
    const succeeded = results.filter((entry) => entry.result?.ok === true);
    assert.equal(succeeded.length, 1, `exactly one confirmation may succeed: ${JSON.stringify(results.map((r) => r.result))}`);
    const refused = results.find((entry) => entry.result?.ok === false);
    assert.equal(refused?.result?.status, 409, 'the refused confirmation is a state conflict');

    const transfer = db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(transferId);
    assert.equal(transfer.status, 'TRANSFERRED');
    assert.equal(onHand(scenario.productId, scenario.fromWarehouseId), 90, 'the source decreased exactly once');
    assert.equal(onHand(scenario.productId, scenario.toWarehouseId), 10, 'the destination increased exactly once');
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE source_type='INVENTORY_TRANSFER' AND source_id=?")
        .get(transferId)?.n || 0),
      1,
      'exactly one canonical mutation was recorded',
    );
  });

  // INV-RACE-02 -------------------------------------------------------
  // Two concurrent approvals of the same stocktake must apply the counted
  // difference exactly once.
  test('INV-RACE-02 concurrent double approval of one stocktake applies the difference once', async () => {
    const scenario = seedScenario();
    const stamp = now();
    const checkId = `iw-race-check-${scenario.suffix}`;
    db.prepare(`INSERT INTO inventory_checks(id,check_no,warehouse_id,status,checked_at,creator_id,created_at,check_kind,scope_strategy,snapshot_at,business_date)
      VALUES(?,?,?,'SUBMITTED',?,'${COUNTER_ID}',?,'REGULAR','ALL',?,'2026-11-12')`)
      .run(checkId, `STK-IWR-${scenario.suffix}`, scenario.fromWarehouseId, stamp, stamp, stamp);
    db.prepare(`INSERT INTO inventory_check_items(id,check_id,product_id,position_key,owner_type,stock_status,book_quantity,check_quantity,diff_quantity,snapshot_book_quantity)
      VALUES(?,?,?,?,'ENTERPRISE','AVAILABLE',100,90,-10,100)`)
      .run(`iw-race-check-item-${scenario.suffix}`, checkId, scenario.productId, scenario.positionKey);

    const results = await raceTwo([
      { action: 'stocktake-approve', payload: { checkId, approverActorId: APPROVER_ID } },
      { action: 'stocktake-approve', payload: { checkId, approverActorId: APPROVER_ID } },
    ]);
    const succeeded = results.filter((entry) => entry.result?.ok === true);
    assert.equal(succeeded.length, 1, `exactly one approval may succeed: ${JSON.stringify(results.map((r) => r.result))}`);

    const check = db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(checkId);
    assert.equal(check.status, 'APPROVED');
    assert.equal(onHand(scenario.productId, scenario.fromWarehouseId), 90, 'the counted difference was applied exactly once');
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE source_type='INVENTORY_STOCKTAKE_DIFF' AND source_id=?")
        .get(checkId)?.n || 0),
      1,
      'exactly one canonical mutation was recorded',
    );
    assert.equal(auditCount('APPROVE', checkId), 1, 'exactly one approval audit exists');
  });

  // INV-RACE-03 -------------------------------------------------------
  // Two concurrent submissions of the same draft stocktake must freeze the
  // counted lines once: the second submission is refused by the state guard.
  test('INV-RACE-03 concurrent double submission of one stocktake submits once', async () => {
    const scenario = seedScenario();
    const stamp = now();
    const checkId = `iw-race-draft-${scenario.suffix}`;
    db.prepare(`INSERT INTO inventory_checks(id,check_no,warehouse_id,status,checked_at,creator_id,created_at,check_kind,scope_strategy,snapshot_at,business_date)
      VALUES(?,?,?,'DRAFT',?,'${COUNTER_ID}',?,'REGULAR','ALL',?,'2026-11-12')`)
      .run(checkId, `STK-IWRS-${scenario.suffix}`, scenario.fromWarehouseId, stamp, stamp, stamp);
    db.prepare(`INSERT INTO inventory_check_items(id,check_id,product_id,position_key,owner_type,stock_status,book_quantity,check_quantity,diff_quantity,snapshot_book_quantity)
      VALUES(?,?,?,?,'ENTERPRISE','AVAILABLE',100,95,-5,100)`)
      .run(`iw-race-draft-item-${scenario.suffix}`, checkId, scenario.productId, scenario.positionKey);

    const results = await raceTwo([
      { action: 'stocktake-submit', payload: { checkId } },
      { action: 'stocktake-submit', payload: { checkId } },
    ]);
    const succeeded = results.filter((entry) => entry.result?.ok === true);
    assert.equal(succeeded.length, 1, `exactly one submission may succeed: ${JSON.stringify(results.map((r) => r.result))}`);
    const check = db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(checkId);
    assert.equal(check.status, 'SUBMITTED');
    assert.equal(auditCount('SUBMIT', checkId), 1, 'exactly one submission audit exists');
  });

  // INV-RACE-04 -------------------------------------------------------
  // Two concurrent locks of the same canonical position must not lock more
  // than the position holds. The over-lock guard reads the locked quantity
  // inside the transaction and locks the position row first.
  test('INV-RACE-04 concurrent double lock of one position never over-locks', async () => {
    const scenario = seedScenario();
    const results = await raceTwo([
      { action: 'inventory-lock', payload: { productId: scenario.productId, warehouseId: scenario.fromWarehouseId, positionKey: scenario.positionKey, quantity: 60 } },
      { action: 'inventory-lock', payload: { productId: scenario.productId, warehouseId: scenario.fromWarehouseId, positionKey: scenario.positionKey, quantity: 60 } },
    ]);
    const succeeded = results.filter((entry) => entry.result?.ok === true);
    assert.equal(succeeded.length, 1, `exactly one lock may succeed: ${JSON.stringify(results.map((r) => r.result))}`);
    const refused = results.find((entry) => entry.result?.ok === false);
    assert.equal(refused?.result?.status, 409, 'the refused lock is an over-lock conflict');

    const locked = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks WHERE position_key=? AND status='ACTIVE'")
      .get(scenario.positionKey)?.q || 0);
    assert.equal(locked, 60, 'the position is locked exactly once, never more than it holds');
    assert.ok(locked <= onHand(scenario.productId, scenario.fromWarehouseId), 'the locked quantity never exceeds the on-hand quantity');
  });
});
