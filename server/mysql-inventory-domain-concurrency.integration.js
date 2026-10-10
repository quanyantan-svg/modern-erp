import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';
import { computePositionKey } from './lib/inventory-position.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-worker.mjs');
const ACTOR_ID = 'inventory-race-user';
const BUSINESS_DATE = '2026-10-10';

class AppInstance {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.child = spawn(process.execPath, [workerPath], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.stderr = '';
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(Object.assign(new Error(response.error.message), response.error));
    });
    this.child.on('exit', (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  run(command) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }

  close() { this.child.stdin.end(); }
}

function position(productId = 'inventory-race-none', warehouseId = 'inventory-race-wh-a', extra = {}) {
  return {
    productId,
    warehouseId,
    ownerType: 'ENTERPRISE',
    ownerId: null,
    stockStatus: 'AVAILABLE',
    ...extra,
  };
}

function mutation(input) {
  return {
    action: 'inventory-mutation',
    actorId: ACTOR_ID,
    input: {
      sourceType: 'OTHER_ISSUE',
      businessDate: BUSINESS_DATE,
      ...input,
    },
  };
}

function successCount(results) {
  return results.filter((result) => result.status === 'fulfilled').length;
}

describe('V21 Inventory/Warehouse real MySQL concurrency matrix (14 races)', () => {
  let mysql;
  let db;
  let apps;

  const race = (commands) => Promise.allSettled(commands.map((command, index) => apps[index % apps.length].run(command)));
  const quantity = (where, ...params) => Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE ${where} AND active=1`).get(...params)?.q || 0);
  const seed = (quantityValue, productId = 'inventory-race-none', warehouseId = 'inventory-race-wh-a', extra = {}) => upsertCanonicalInventory(db, {
    rowId: randomUUID(),
    warehouseId,
    productId,
    quantity: quantityValue,
    position: extra,
  });

  before(() => {
    mysql = createTempDb({ label: 'mysql-inventory-domain-races', production: true });
    db = mysql.db;
    assert.equal(db.dialect, 'mysql');
    console.log(`INVENTORY RACE DIALECT = ${db.dialect}`);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(ACTOR_ID, ACTOR_ID, 'Inventory Race User', 'x', 'x', now);
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at)
      VALUES('inventory-race-supplier','INV-RACE-SUP','Inventory Race Supplier','','','','',1,?,?)`).run(now, now);
    for (const [id, code] of [['inventory-race-wh-a', 'INV-RACE-A'], ['inventory-race-wh-b', 'INV-RACE-B']]) {
      db.prepare(`INSERT INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at)
        VALUES(?,?,?,1,0,0,?,?)`).run(id, code, code, now, now);
    }
    for (const [id, code] of [['inventory-race-bin-a', 'BIN-A'], ['inventory-race-bin-b', 'BIN-B']]) {
      db.prepare(`INSERT INTO warehouse_bins(id,warehouse_id,code,name,active,created_at,updated_at)
        VALUES(?,'inventory-race-wh-a',?,?,1,?,?)`).run(id, code, code, now, now);
    }
    for (const [id, code, tracking] of [
      ['inventory-race-none', 'INV-RACE-NONE', 'NONE'],
      ['inventory-race-lot', 'INV-RACE-LOT', 'LOT'],
      ['inventory-race-serial', 'INV-RACE-SERIAL', 'SERIAL'],
    ]) {
      db.prepare(`INSERT INTO products
        (id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
        VALUES(?,?,?,'TEST','EA',0,0,1,?,?,?)`).run(id, code, code, tracking, now, now);
    }
    db.prepare(`INSERT INTO inventory_lots
      (id,product_id,lot_code,status,created_source_type,created_source_id,created_at)
      VALUES('inventory-race-lot-a','inventory-race-lot','LOT-A','AVAILABLE','OTHER_RECEIPT','seed',?),
            ('inventory-race-lot-b','inventory-race-lot','LOT-B','AVAILABLE','OTHER_RECEIPT','seed',?)`).run(now, now);
    db.prepare(`INSERT INTO inventory_serials
      (id,product_id,serial_number,lifecycle_state,current_warehouse_id,created_source_type,created_source_id,updated_at,created_at)
      VALUES('inventory-race-serial-1','inventory-race-serial','SERIAL-1','AVAILABLE','inventory-race-wh-a','OTHER_RECEIPT','seed',?,?)`).run(now, now);
    apps = Array.from({ length: 4 }, (_, index) => new AppInstance(`inventory-app-${index + 1}`));
  });

  beforeEach(() => {
    for (const table of [
      'inventory_mutation_log', 'inventory_transactions', 'tracked_inventory_movements',
      'inventory_locks', 'planning_reservations', 'inventory_step_transfer_in_transit',
      'inventory_period_closures', 'inventory_initialization', 'inventory',
    ]) db.prepare(`DELETE FROM ${table}`).run();
    db.prepare(`UPDATE warehouses SET bin_enabled=0, negative_stock_policy='BLOCK'
      WHERE id IN ('inventory-race-wh-a','inventory-race-wh-b')`).run();
  });

  after(() => {
    for (const app of apps || []) app.close();
    mysql?.cleanup();
  });

  test('RACE-01 two outbound mutations against the same position', async () => {
    seed(100);
    const results = await race([1, 2].map((n) => mutation({
      sourceId: `race-01-${n}`, movementKind: 'OUT', quantity: 70,
      fromPosition: position(), idempotencyKey: `RACE-01:${n}`,
    })));
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'"), 30);
  });

  test('RACE-02 direct transfer vs outbound on the same source position', async () => {
    seed(100);
    const results = await race([
      mutation({ sourceType: 'INVENTORY_TRANSFER', sourceId: 'race-02-move', movementKind: 'MOVE', quantity: 70,
        fromPosition: position(), toPosition: position('inventory-race-none', 'inventory-race-wh-b'), idempotencyKey: 'RACE-02:MOVE' }),
      mutation({ sourceId: 'race-02-out', movementKind: 'OUT', quantity: 70,
        fromPosition: position(), idempotencyKey: 'RACE-02:OUT' }),
    ]);
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'"), 30);
    assert.ok(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-b'") >= 0);
  });

  test('RACE-03 step-transfer receive twice cannot over-receive', async () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO inventory_transfers
      (id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at,business_date)
      VALUES('race-03','RACE-03','inventory-race-wh-a','inventory-race-wh-b','DRAFT','',?,?,?,?)`)
      .run(ACTOR_ID, now, now, BUSINESS_DATE);
    db.prepare(`INSERT INTO inventory_step_transfer_in_transit
      (id,source_transfer_id,product_id,warehouse_id_source,warehouse_id_destination,issued_qty,received_qty,returned_qty,cancelled_qty,status,created_at)
      VALUES('race-03-step','race-03','inventory-race-none','inventory-race-wh-a','inventory-race-wh-b',10,0,0,0,'IN_TRANSIT',?)`).run(now);
    const results = await race([1, 2].map((n) => ({
      action: 'inventory-step-receive', actorId: ACTOR_ID, stepId: 'race-03-step', quantity: 7,
      businessDate: BUSINESS_DATE, toPosition: position('inventory-race-none', 'inventory-race-wh-b'),
      idempotencyKey: `RACE-03:${n}`,
    })));
    assert.equal(successCount(results), 1);
    assert.equal(Number(db.prepare("SELECT received_qty FROM inventory_step_transfer_in_transit WHERE id='race-03-step'").get().received_qty), 7);
    assert.equal(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-b'"), 7);
  });

  test('RACE-04 stocktake adjustment vs outbound cannot double-reduce', async () => {
    seed(100);
    const results = await race([
      mutation({ sourceType: 'INVENTORY_STOCKTAKE_DIFF', sourceId: 'race-04-stocktake', movementKind: 'ADJUSTMENT', quantity: 60,
        fromPosition: position(), idempotencyKey: 'RACE-04:STOCKTAKE' }),
      mutation({ sourceId: 'race-04-out', movementKind: 'OUT', quantity: 60,
        fromPosition: position(), idempotencyKey: 'RACE-04:OUT' }),
    ]);
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'"), 40);
  });

  test('RACE-05 lock vs outbound preserves non-negative lockable stock', async () => {
    const row = seed(100);
    const results = await race([
      { action: 'inventory-lock-create', actorId: ACTOR_ID, lockId: 'race-05-lock', productId: row.productId,
        warehouseId: row.warehouseId, positionKey: row.positionKey, quantity: 60 },
      mutation({ sourceId: 'race-05-out', movementKind: 'OUT', quantity: 60,
        fromPosition: position(), idempotencyKey: 'RACE-05:OUT' }),
    ]);
    assert.equal(successCount(results), 1);
    const onHand = quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'");
    const locked = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM inventory_locks WHERE status='ACTIVE'").get().q);
    assert.ok(onHand - locked >= 0);
  });

  test('RACE-06 planning reservation vs availability-consuming mutation remains consistent', async () => {
    seed(100);
    const now = new Date().toISOString();
    const results = await race([
      { action: 'inventory-reserve', actorId: ACTOR_ID, reservationId: 'race-06-reservation', reservationNo: 'RACE-06',
        productId: 'inventory-race-none', warehouseId: 'inventory-race-wh-a', quantity: 40, createdAt: now },
      mutation({ sourceId: 'race-06-out', movementKind: 'OUT', quantity: 60,
        fromPosition: position(), idempotencyKey: 'RACE-06:OUT' }),
    ]);
    assert.equal(successCount(results), 2);
    assert.equal(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'"), 40);
    assert.equal(Number(db.prepare("SELECT quantity FROM planning_reservations WHERE id='race-06-reservation'").get().quantity), 40);
  });

  test('RACE-07 VMI owner transfer twice has one physical effect', async () => {
    seed(100, 'inventory-race-none', 'inventory-race-wh-a', { ownerType: 'SUPPLIER', ownerId: 'inventory-race-supplier' });
    const results = await race([1, 2].map((n) => mutation({
      sourceType: 'VMI_OWNERSHIP_TRANSFER', sourceId: `race-07-${n}`, movementKind: 'OWNER_CHANGE', quantity: 100,
      fromPosition: position('inventory-race-none', 'inventory-race-wh-a', { ownerType: 'SUPPLIER', ownerId: 'inventory-race-supplier' }),
      toPosition: position(), idempotencyKey: `RACE-07:${n}`,
    })));
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-none' AND owner_type='SUPPLIER'"), 0);
    assert.equal(quantity("product_id='inventory-race-none' AND owner_type='ENTERPRISE'"), 100);
  });

  test('RACE-08 stock-status adjustment vs outbound preserves quantity invariants', async () => {
    seed(100);
    const results = await race([
      mutation({ sourceType: 'INVENTORY_STOCK_STATUS_CHANGE', sourceId: 'race-08-status', movementKind: 'STATUS_CHANGE', quantity: 70,
        fromPosition: position(), toPosition: position('inventory-race-none', 'inventory-race-wh-a', { stockStatus: 'HOLD' }), idempotencyKey: 'RACE-08:STATUS' }),
      mutation({ sourceId: 'race-08-out', movementKind: 'OUT', quantity: 70,
        fromPosition: position(), idempotencyKey: 'RACE-08:OUT' }),
    ]);
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-none' AND stock_status='AVAILABLE'"), 30);
    assert.ok(quantity("product_id='inventory-race-none'") >= 30);
  });

  test('RACE-09 lot reclass vs lot outbound cannot over-consume the lot', async () => {
    seed(100, 'inventory-race-lot', 'inventory-race-wh-a', { lotId: 'inventory-race-lot-a' });
    const lotA = position('inventory-race-lot', 'inventory-race-wh-a', { lotId: 'inventory-race-lot-a' });
    const results = await race([
      mutation({ sourceType: 'INVENTORY_LOT_ADJUSTMENT', sourceId: 'race-09-reclass', movementKind: 'LOT_RECLASS', quantity: 70,
        fromPosition: lotA, toPosition: position('inventory-race-lot', 'inventory-race-wh-a', { lotId: 'inventory-race-lot-b' }), idempotencyKey: 'RACE-09:RECLASS' }),
      mutation({ sourceId: 'race-09-out', movementKind: 'OUT', quantity: 70,
        fromPosition: lotA, idempotencyKey: 'RACE-09:OUT' }),
    ]);
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-lot' AND lot_id='inventory-race-lot-a'"), 30);
  });

  test('RACE-10 the same serial cannot be consumed twice', async () => {
    seed(1, 'inventory-race-serial', 'inventory-race-wh-a', { serialId: 'inventory-race-serial-1' });
    const serial = position('inventory-race-serial', 'inventory-race-wh-a', { serialId: 'inventory-race-serial-1' });
    const results = await race([1, 2].map((n) => mutation({
      sourceId: `race-10-${n}`, movementKind: 'OUT', quantity: 1,
      fromPosition: serial, idempotencyKey: `RACE-10:${n}`,
    })));
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-serial' AND serial_id='inventory-race-serial-1'"), 0);
  });

  test('RACE-11 bin move vs outbound cannot over-consume the source bin', async () => {
    db.prepare("UPDATE warehouses SET bin_enabled=1 WHERE id='inventory-race-wh-a'").run();
    seed(100, 'inventory-race-none', 'inventory-race-wh-a', { binId: 'inventory-race-bin-a' });
    const binA = position('inventory-race-none', 'inventory-race-wh-a', { binId: 'inventory-race-bin-a' });
    const results = await race([
      mutation({ sourceType: 'INVENTORY_BIN_MOVE', sourceId: 'race-11-move', movementKind: 'BIN_MOVE', quantity: 70,
        fromPosition: binA, toPosition: position('inventory-race-none', 'inventory-race-wh-a', { binId: 'inventory-race-bin-b' }), idempotencyKey: 'RACE-11:MOVE' }),
      mutation({ sourceId: 'race-11-out', movementKind: 'OUT', quantity: 70,
        fromPosition: binA, idempotencyKey: 'RACE-11:OUT' }),
    ]);
    assert.equal(successCount(results), 1);
    assert.equal(quantity("product_id='inventory-race-none' AND bin_id='inventory-race-bin-a'"), 30);
  });

  test('RACE-12 period close vs stock mutation serializes to a valid outcome', async () => {
    seed(100);
    const results = await race([
      { action: 'inventory-close-period', actorId: ACTOR_ID, closureId: 'race-12-close', periodKey: '2026-09', closedAt: new Date().toISOString() },
      mutation({ sourceId: 'race-12-out', businessDate: '2026-09-30', movementKind: 'OUT', quantity: 5,
        fromPosition: position(), idempotencyKey: 'RACE-12:OUT' }),
    ]);
    assert.ok([1, 2].includes(successCount(results)));
    assert.equal(db.prepare("SELECT status FROM inventory_period_closures WHERE id='race-12-close'").get().status, 'CLOSED');
    assert.ok([95, 100].includes(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'")));
  });

  test('RACE-13 initialization close vs opening write serializes to a valid outcome', async () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO inventory_initialization(id,status,opened_by,opened_at)
      VALUES('race-13-init','OPEN',?,?)`).run(ACTOR_ID, now);
    const results = await race([
      { action: 'inventory-close-initialization', actorId: ACTOR_ID, initializationId: 'race-13-init', closedAt: now },
      mutation({ sourceType: 'OPENING_INVENTORY', sourceId: 'race-13-opening', movementKind: 'IN', quantity: 10,
        toPosition: position(), idempotencyKey: 'RACE-13:OPENING' }),
    ]);
    assert.ok([1, 2].includes(successCount(results)));
    assert.equal(db.prepare("SELECT status FROM inventory_initialization WHERE id='race-13-init'").get().status, 'CLOSED');
    assert.ok([0, 10].includes(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'")));
  });

  test('RACE-14 duplicate barcode serial confirm is an exact idempotent replay', async () => {
    const command = mutation({
      sourceType: 'BARCODE_SCAN_CONFIRM', sourceId: 'race-14-scan', movementKind: 'IN', quantity: 10,
      toPosition: position(), idempotencyKey: 'RACE-14:SCAN',
    });
    const results = await race([command, command]);
    assert.equal(successCount(results), 2);
    const values = results.map((result) => result.value);
    assert.equal(values.filter((value) => value.replayed).length, 1);
    assert.equal(new Set(values.map((value) => value.movementGroupId)).size, 1);
    assert.equal(quantity("product_id='inventory-race-none' AND warehouse_id='inventory-race-wh-a'"), 10);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE idempotency_key='RACE-14:SCAN'").get().n), 1);
  });
});
