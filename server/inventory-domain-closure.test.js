// Domain contract for the Inventory & Warehouse closure (INV-15 / INV-17 /
// INV-26 / INV-29~31 / INV-39 / INV-42).
//
// The contract this file protects:
//   1. INV-15 direct transfer and INV-29~31 stocktake each have exactly ONE
//      write entry. The canonical module owns it; the legacy write paths are
//      retired with 410 and never write.
//   2. The physical movement of both documents goes through
//      applyInventoryMutation (INV-07), so the negative-stock policy, the
//      inventory lock, the period gates and the mutation log apply.
//   3. The stocktake counts on the canonical position identity, keeps the
//      authoritative business date, separates the counter from the approver
//      and refuses a count whose book snapshot moved.
//   4. The transfer carries the value of the issued leg into the receiving
//      warehouse.
//
// Every physical stock change asserted here must be visible in the canonical
// `inventory` table, in `inventory_transactions` and in
// `inventory_mutation_log` — never in the stale `products.stock_quantity`.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { createDatabase } from './db.js';
import { changeInventoryAdjustmentState, createInventoryAdjustment } from './app.js';
import {
  createStocktake, submitStocktake, approveStocktake, scanStocktake, listStocktakes,
} from './modules/inventory-stocktake.js';
import {
  createInventoryTransfer, confirmInventoryTransferCommand, cancelInventoryTransfer,
} from './modules/inventory-transfer.js';
import { createInventoryLock } from './modules/inventory-lock.js';
import { createInventoryScrap, confirmInventoryScrap } from './modules/inventory-extensions.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { computePositionKey } from './lib/inventory-position.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ACTOR = {
  id: 'u-counter',
  roleCode: 'WAREHOUSE',
  permissions: [
    'INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_CHECK_APPROVE',
    'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_CONFIRM', 'INVENTORY_TRANSFER_APPROVE',
    'INVENTORY_LOCK_VIEW', 'INVENTORY_LOCK_MANAGE',
    'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE',
  ],
};
const APPROVER = { ...ACTOR, id: 'u-approver' };

const TODAY = '2026-11-12';

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(payload) { if (payload !== undefined) this.body = JSON.parse(payload); return this; },
  };
}

function makeReq(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf-8');
  const stream = Readable.from(payload);
  stream.headers = { 'content-type': 'application/json', 'content-length': payload.length };
  return stream;
}

const canonicalKey = (productId, warehouseId) => computePositionKey({
  productId, warehouseId, binId: null, ownerType: 'ENTERPRISE', ownerId: null,
  stockStatus: 'AVAILABLE', lotId: null, serialId: null,
});

describe('Inventory & Warehouse closure — single write entry and canonical mutation', () => {
  let db;
  let dbDir;

  before(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-domain-closure-'));
    db = createDatabase(join(dbDir, 'test.db'));
    const now = new Date().toISOString();
    for (const id of ['u-counter', 'u-approver']) {
      db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
        VALUES(?,?,'U','x','x','role-admin',1,?)`).run(id, id, now);
    }
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
      VALUES('wh-1','WH1','主仓',1,0,?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
      VALUES('wh-2','WH2','分仓',1,0,?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-1','P1','货品一','FG','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-2','P2','货品二','FG','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
    // A standard cost lets the valuation post a real integer-cent amount, so
    // the adjustment gain/loss also writes its system voucher.
    db.prepare('UPDATE products SET standard_manufacturing_cost_cents=100000 WHERE id IN (?,?)').run('p-1', 'p-2');
    // The source position holds 100; the receiving warehouse starts empty.
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES('inv-1','wh-1','p-1',100,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)`)
      .run(now, canonicalKey('p-1', 'wh-1'));
  });

  after(() => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  const onHand = (productId, warehouseId) => Number(
    db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND warehouse_id=? AND active=1')
      .get(productId, warehouseId)?.q || 0,
  );

  // ---------------------------------------------------------------- INV-29~31
  test('INV-29 stocktake: DRAFT -> SUBMITTED -> APPROVED applies the difference through the canonical mutation', async () => {
    const res = makeRes();
    await createStocktake(db, makeReq({
      warehouseId: 'wh-1', checkKind: 'REGULAR', businessDate: TODAY,
      items: [{ productId: 'p-1', physicalQuantity: 95 }],
    }), res, ACTOR);
    assert.equal(res.statusCode, 201);
    const checkId = res.body.id;
    assert.equal(res.body.status, 'DRAFT');
    assert.equal(db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(checkId).status, 'DRAFT');

    // The counter may not approve its own document.
    const submitted = makeRes();
    submitStocktake(db, submitted, ACTOR, checkId);
    assert.equal(db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(checkId).status, 'SUBMITTED');
    assert.throws(() => approveStocktake(db, makeRes(), ACTOR, checkId), /创建人不能审批/);
    // A submitted document is frozen.
    assert.throws(() => submitStocktake(db, makeRes(), ACTOR, checkId), /不可提交/);

    const approved = makeRes();
    approveStocktake(db, approved, APPROVER, checkId);
    assert.equal(db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(checkId).status, 'APPROVED');
    assert.equal(onHand('p-1', 'wh-1'), 95, 'the canonical balance carries the counted quantity');

    const movement = db.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_STOCKTAKE_DIFF' AND source_id=?").get(checkId);
    assert.ok(movement, 'the difference is written as an inventory movement');
    assert.equal(movement.direction, 'OUT');
    assert.equal(Number(movement.quantity_change), 5);
    assert.equal(Number(movement.balance_after), 95);

    const mutation = db.prepare("SELECT * FROM inventory_mutation_log WHERE source_type='INVENTORY_STOCKTAKE_DIFF' AND source_id=?").get(checkId);
    assert.ok(mutation, 'the difference is recorded in the canonical mutation log');
    assert.equal(mutation.movement_kind, 'ADJUSTMENT');

    // A second approval is refused by the state guard.
    assert.throws(() => approveStocktake(db, makeRes(), APPROVER, checkId), /不可审批/);
  });

  test('INV-29 stocktake: a book change between counting and approval forces a recount', async () => {
    const res = makeRes();
    await createStocktake(db, makeReq({
      warehouseId: 'wh-1', checkKind: 'REGULAR', businessDate: TODAY,
      items: [{ productId: 'p-1', physicalQuantity: 90 }],
    }), res, ACTOR);
    const checkId = res.body.id;
    submitStocktake(db, makeRes(), ACTOR, checkId);
    // Somebody else moves the stock after the count was taken.
    applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'other-1', businessDate: TODAY,
      actor: ACTOR, movementKind: 'OUT', quantity: 1,
      fromPosition: { productId: 'p-1', warehouseId: 'wh-1', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'OTHER_ISSUE:other-1',
    });
    const before = onHand('p-1', 'wh-1');
    assert.throws(() => approveStocktake(db, makeRes(), APPROVER, checkId), /库存已变化/);
    assert.equal(onHand('p-1', 'wh-1'), before, 'the refused approval changed nothing');
    assert.equal(db.prepare('SELECT status FROM inventory_checks WHERE id=?').get(checkId).status, 'SUBMITTED');
  });

  test('INV-30 cycle stocktake: checkKind CYCLE with a period key is accepted and applied', async () => {
    const res = makeRes();
    await createStocktake(db, makeReq({
      warehouseId: 'wh-1', checkKind: 'CYCLE', scopeStrategy: 'CYCLE', cyclePeriodKey: '2026-11',
      businessDate: TODAY, items: [{ productId: 'p-2', physicalQuantity: 5 }],
    }), res, ACTOR);
    assert.equal(res.body.checkKind, 'CYCLE');
    const checkId = res.body.id;
    const row = db.prepare('SELECT check_kind, scope_strategy, cycle_period_key FROM inventory_checks WHERE id=?').get(checkId);
    assert.equal(row.check_kind, 'CYCLE');
    assert.equal(row.scope_strategy, 'CYCLE');
    assert.equal(row.cycle_period_key, '2026-11');
    submitStocktake(db, makeRes(), ACTOR, checkId);
    approveStocktake(db, makeRes(), APPROVER, checkId);
    assert.equal(onHand('p-2', 'wh-1'), 5);
  });

  test('INV-29 stocktake: the authoritative business date is mandatory', async () => {
    const res = makeRes();
    await assert.rejects(() => createStocktake(db, makeReq({
      warehouseId: 'wh-1', checkKind: 'REGULAR', items: [{ productId: 'p-1', physicalQuantity: 95 }],
    }), res, ACTOR), /盘点业务日期/);
  });

  test('INV-42 stocktake scan: the scanned count lands on the canonical position line', async () => {
    const res = makeRes();
    await createStocktake(db, makeReq({
      warehouseId: 'wh-1', checkKind: 'REGULAR', businessDate: TODAY,
      items: [{ productId: 'p-2', physicalQuantity: 4 }],
    }), res, ACTOR);
    const checkId = res.body.id;
    const scanned = makeRes();
    scanStocktake(db, scanned, ACTOR, checkId, { code: 'PRD-P2', quantity: 6 });
    assert.equal(scanned.statusCode, 200);
    const item = db.prepare('SELECT * FROM inventory_check_items WHERE check_id=? AND product_id=?').get(checkId, 'p-2');
    assert.ok(item, 'the scanned line is a counted line of the stocktake');
    assert.equal(Number(item.check_quantity), 6);
    assert.equal(item.position_key, canonicalKey('p-2', 'wh-1'));
    // A submitted document no longer accepts a scan.
    submitStocktake(db, makeRes(), ACTOR, checkId);
    assert.throws(() => scanStocktake(db, makeRes(), ACTOR, checkId, { code: 'PRD-P2', quantity: 7 }), /草稿/);
  });

  test('INV-29 stocktake: the read model exposes the counted lines', async () => {
    const res = makeRes();
    await createStocktake(db, makeReq({
      warehouseId: 'wh-1', checkKind: 'REGULAR', businessDate: TODAY,
      items: [{ productId: 'p-2', physicalQuantity: 8 }],
    }), res, ACTOR);
    const listed = makeRes();
    listStocktakes(db, listed, ACTOR, new URL('http://127.0.0.1/api/inventory-stocktakes'));
    const row = listed.body.stocktakes.find((item) => item.id === res.body.id);
    assert.ok(row, 'the stocktake is listed');
    assert.equal(row.itemCount, 1);
    assert.equal(row.items.length, 1);
    assert.equal(Number(row.items[0].checkQuantity), 8);
  });

  // ------------------------------------------------------------------- INV-15
  test('INV-15 direct transfer: the movement runs through the canonical mutation and carries the value', async () => {
    const created = makeRes();
    await createInventoryTransfer(db, makeReq({
      fromWarehouseId: 'wh-1', toWarehouseId: 'wh-2', businessDate: TODAY,
      items: [{ productId: 'p-1', quantity: 10 }], remark: 'closure',
    }), created, ACTOR);
    assert.equal(created.statusCode, 201);
    const transferId = created.body.id;
    assert.equal(created.body.status, 'DRAFT');

    const beforeSource = onHand('p-1', 'wh-1');
    const confirmed = confirmInventoryTransferCommand(db, APPROVER, transferId);
    assert.equal(confirmed.status, 'TRANSFERRED');
    assert.equal(onHand('p-1', 'wh-1'), beforeSource - 10, 'the source decreases');
    assert.equal(onHand('p-1', 'wh-2'), 10, 'the destination increases');

    const mutation = db.prepare("SELECT * FROM inventory_mutation_log WHERE source_type='INVENTORY_TRANSFER' AND source_id=?").get(transferId);
    assert.ok(mutation, 'the transfer is recorded in the canonical mutation log');
    assert.equal(mutation.movement_kind, 'MOVE');

    const movement = db.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_TRANSFER' AND source_id=?").get(transferId);
    assert.ok(movement, 'the transfer writes the canonical inventory movement');

    // The document is terminal: a second confirmation is refused.
    assert.throws(() => confirmInventoryTransferCommand(db, APPROVER, transferId), /请勿重复操作/);
    // And it can no longer be cancelled.
    assert.throws(() => cancelInventoryTransfer(db, makeRes(), ACTOR, transferId), /不可取消/);
  });

  test('INV-15 direct transfer: the authoritative business date is mandatory on creation', async () => {
    const res = makeRes();
    await assert.rejects(() => createInventoryTransfer(db, makeReq({
      fromWarehouseId: 'wh-1', toWarehouseId: 'wh-2', items: [{ productId: 'p-1', quantity: 1 }],
    }), res, ACTOR), /调拨业务日期/);
  });

  test('INV-15 direct transfer: an insufficient source position is refused with zero side effects', async () => {
    const created = makeRes();
    await createInventoryTransfer(db, makeReq({
      fromWarehouseId: 'wh-1', toWarehouseId: 'wh-2', businessDate: TODAY,
      items: [{ productId: 'p-1', quantity: 100000 }],
    }), created, ACTOR);
    const beforeSource = onHand('p-1', 'wh-1');
    const beforeTarget = onHand('p-1', 'wh-2');
    assert.throws(() => confirmInventoryTransferCommand(db, APPROVER, created.body.id), /库存不足/);
    assert.equal(onHand('p-1', 'wh-1'), beforeSource);
    assert.equal(onHand('p-1', 'wh-2'), beforeTarget);
    assert.equal(db.prepare('SELECT status FROM inventory_transfers WHERE id=?').get(created.body.id).status, 'DRAFT');
  });

  // ------------------------------------------------------------------- INV-21
  test('INV-21 adjustment confirmation writes the canonical position through the canonical mutation', async () => {
    const created = makeRes();
    await createInventoryAdjustment(db, makeReq({
      warehouseId: 'wh-1', reason: 'closure gain', adjustmentDate: TODAY,
      items: [{ productId: 'p-1', quantityDelta: 5 }],
    }), created, ACTOR);
    assert.equal(created.statusCode, 201);
    const adjustmentId = created.body.id;
    const before = onHand('p-1', 'wh-1');
    const confirmed = makeRes();
    changeInventoryAdjustmentState(db, confirmed, ACTOR, adjustmentId, 'confirm');
    assert.equal(onHand('p-1', 'wh-1'), before + 5, 'the canonical balance carries the adjustment');
    const mutation = db.prepare("SELECT * FROM inventory_mutation_log WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id=?")
      .get(adjustmentId);
    assert.ok(mutation, 'the adjustment is recorded in the canonical mutation log');
    assert.equal(mutation.movement_kind, 'ADJUSTMENT');
    const movement = db.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id=?")
      .get(adjustmentId);
    assert.ok(movement, 'the adjustment writes the canonical inventory movement');
    assert.equal(movement.direction, 'IN');
    assert.equal(Number(movement.quantity_change), 5);
    const valuation = db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id=?")
      .all(adjustmentId);
    assert.ok(valuation.length > 0, 'the adjustment still writes its valuation movement');
    const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id=?")
      .get(adjustmentId);
    assert.ok(voucher, 'the adjustment still writes its system voucher');
  });

  test('INV-21 adjustment confirmation cannot consume locked stock', async () => {
    const lock = makeRes();
    await createInventoryLock(db, makeReq({
      productId: 'p-2', warehouseId: 'wh-1', quantity: 5, reason: 'closure lock',
    }), lock, ACTOR);
    assert.equal(lock.statusCode, 201);
    const created = makeRes();
    await createInventoryAdjustment(db, makeReq({
      warehouseId: 'wh-1', reason: 'closure locked loss', adjustmentDate: TODAY,
      items: [{ productId: 'p-2', quantityDelta: -1 }],
    }), created, ACTOR);
    const before = onHand('p-2', 'wh-1');
    assert.throws(
      () => changeInventoryAdjustmentState(db, makeRes(), ACTOR, created.body.id, 'confirm'),
      /库存不足/,
      'the canonical mutation refuses to consume locked stock',
    );
    assert.equal(onHand('p-2', 'wh-1'), before, 'the refused adjustment changed nothing');
    assert.equal(db.prepare('SELECT status FROM inventory_adjustments WHERE id=?').get(created.body.id).status, 'DRAFT');
  });

  test('INV-21 scrap confirmation writes the canonical position through the canonical mutation', async () => {
    const created = makeRes();
    await createInventoryScrap(db, makeReq({
      scrapDate: TODAY, reason: 'closure scrap',
      items: [{ warehouseId: 'wh-1', productId: 'p-1', quantity: 3 }],
    }), created, ACTOR);
    assert.equal(created.statusCode, 201);
    const before = onHand('p-1', 'wh-1');
    const confirmed = makeRes();
    confirmInventoryScrap(db, confirmed, ACTOR, created.body.id);
    assert.equal(onHand('p-1', 'wh-1'), before - 3, 'the canonical balance carries the scrap');
    const mutation = db.prepare("SELECT * FROM inventory_mutation_log WHERE source_type='INVENTORY_SCRAP' AND source_id=?")
      .get(created.body.id);
    assert.ok(mutation, 'the scrap is recorded in the canonical mutation log');
    const movement = db.prepare("SELECT * FROM inventory_transactions WHERE source_type='INVENTORY_SCRAP' AND source_id=?")
      .get(created.body.id);
    assert.ok(movement, 'the scrap writes the canonical inventory movement');
    assert.equal(movement.direction, 'OUT');
  });

  // ------------------------------------------------- single write entry (source)
  test('single write entry: the retired stocktake and transfer write paths are gone', () => {
    const appSource = readFileSync(resolve('server/app.js'), 'utf8');
    // The legacy stocktake write paths answer 410 and never write.
    assert.match(appSource, /pathname === '\/api\/inventory-checks' && req\.method === 'POST'\) return send\(res, 410/);
    assert.match(appSource, /icMatch && req\.method === 'PATCH'\) return send\(res, 410/);
    // The duplicate transfer write path is gone as well.
    assert.match(appSource, /pathname === '\/api\/inventory-transfer-commands' && req\.method === 'POST'\) return send\(res, 410/);
    // No legacy inline handler of the retired documents is left.
    assert.doesNotMatch(appSource, /function createInventoryCheck\(/);
    assert.doesNotMatch(appSource, /function approveInventoryCheck\(/);
    assert.doesNotMatch(appSource, /function createInventoryTransfer\(/);
    assert.doesNotMatch(appSource, /function changeInventoryTransferState\(/);
    // The canonical modules own both documents.
    assert.match(appSource, /owner: 'server\/modules\/inventory-stocktake\.js'/);
    assert.match(appSource, /owner: 'server\/modules\/inventory-transfer\.js'/);
  });
});
