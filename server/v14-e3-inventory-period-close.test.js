import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { assertFinancialPeriodsOpen, createSystemVoucher, receiveValue } from './modules/financial-inventory.js';
import {
  closeInventoryPeriodCommand, getInventoryPeriodStatusData, reopenInventoryPeriodCommand,
  runInventoryCloseChecks,
} from './modules/inventory-period-close.js';

describe('V1.4-E3 inventory period close workflow', () => {
  let fixture; let db;
  const actor = { id: 'e3-admin', permissions: ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE'] };
  const at = '2026-09-27T08:00:00.000Z';

  beforeEach(() => {
    fixture = createTempDb({ label: 'v14-e3-close', production: true });
    db = fixture.db;
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(actor.id, actor.id, 'E3 Admin', 'x', 'x', at);
  });
  afterEach(() => fixture.cleanup());

  function seedAdjustment({ suffix, date, quantity, currentQuantity, active = 1 }) {
    const warehouseId = `e3-wh-${suffix}`; const productId = `e3-p-${suffix}`; const sourceId = `e3-adj-${suffix}`;
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
      VALUES(?,?,?,'','',1,?,?)`).run(warehouseId, `E3W${suffix}`, `E3 Warehouse ${suffix}`, at, at);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,tracking_policy,valuation_method,inventory_classification)
      VALUES(?,?,?,'TEST','EA',0,0,?,?,?,'NONE','MOVING_AVERAGE','OTHER_INVENTORY')`)
      .run(productId, `E3P${suffix}`, `E3 Product ${suffix}`, active, at, at);
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)`)
      .run(`e3-inv-${suffix}`, warehouseId, productId, currentQuantity, at);
    db.prepare(`INSERT INTO inventory_adjustments(id,adjustment_no,warehouse_id,status,reason,adjustment_date,creator_id,confirmed_by,created_at,updated_at,confirmed_at)
      VALUES(?,?,?,'CONFIRMED','E3 seed',?,?,?,?,?,?)`).run(sourceId, `E3-ADJ-${suffix}`, warehouseId, date, actor.id, actor.id, at, at, at);
    const txId = `e3-tx-${suffix}`;
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES(?,?,?,?, 'IN',?,'INVENTORY_ADJUSTMENT',?,?, '',?,?,?)`)
      .run(txId, warehouseId, productId, quantity, currentQuantity, sourceId, `E3-ADJ-${suffix}`, actor.id, at, date);
    receiveValue(db, { businessDate: date, productId, warehouseId, quantity, valueCents: quantity * 100,
      movementType: 'INVENTORY_ADJUSTMENT_GAIN', sourceType: 'INVENTORY_ADJUSTMENT', sourceId,
      sourceItemId: sourceId, inventoryTransactionId: txId });
    createSystemVoucher(db, { sourceType: 'INVENTORY_ADJUSTMENT', sourceId, businessDate: date, actorId: actor.id,
      entries: [{ role: 'OTHER_INVENTORY', direction: 'DEBIT', amountCents: quantity * 100 },
        { role: 'INVENTORY_GAIN_LOSS', direction: 'CREDIT', amountCents: quantity * 100 }] });
    return { warehouseId, productId, sourceId, txId };
  }

  test('precheck is read-only and reports stable blocking codes', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM inventory_period_closures').get().n;
    const pass = runInventoryCloseChecks(db, '2026-06', actor, { today: '2026-09-27' });
    assert.equal(pass.overallStatus, 'PASS');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_period_closures').get().n, before);

    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('e3-check-wh','E3-CW','E3 Check Warehouse','','',1,?,?)").run(at, at);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('e3-check-p','E3-CP','E3 Check Product','TEST','EA',0,0,1,?,?)").run(at, at);
    db.prepare(`INSERT INTO inventory_checks(id,check_no,warehouse_id,product_id,system_quantity,actual_quantity,difference,reason,status,creator_id,created_at,business_date)
      VALUES('e3-check','E3-CHECK','e3-check-wh','e3-check-p',0,0,0,'','DRAFT',?,?,'2026-06-20')`).run(actor.id, at);
    const pending = runInventoryCloseChecks(db, '2026-06', actor, { today: '2026-09-27' });
    assert.equal(pending.checks.find((row) => row.code === 'UNFINISHED_STOCKTAKE').status, 'FAIL');
    const future = runInventoryCloseChecks(db, '2026-09', actor, { today: '2026-09-27' });
    assert.equal(future.overallStatus, 'BLOCKED');
    assert.equal(future.checks.find((row) => row.code === 'PERIOD_ENDED').status, 'FAIL');
  });

  test('business-date snapshots ignore created_at and repeated close is idempotent', () => {
    const first = seedAdjustment({ suffix: 'A', date: '2026-06-10', quantity: 5, currentQuantity: 5 });
    const later = seedAdjustment({ suffix: 'B', date: '2026-07-05', quantity: 10, currentQuantity: 10 });
    db.prepare('UPDATE inventory SET warehouse_id=?,product_id=?,quantity=15 WHERE id=?').run(first.warehouseId, first.productId, `e3-inv-${first.productId.slice(-1)}`);
    // Consolidate the later movement onto the same stock key while retaining its authoritative source date.
    db.prepare('UPDATE inventory_transactions SET warehouse_id=?,product_id=?,created_at=? WHERE id=?').run(first.warehouseId, first.productId, '2020-01-01T00:00:00.000Z', later.txId);
    db.prepare('UPDATE inventory_valuation_movements SET warehouse_id=?,product_id=? WHERE inventory_transaction_id=?').run(first.warehouseId, first.productId, later.txId);
    db.prepare('DELETE FROM inventory WHERE id=?').run('e3-inv-B');
    db.prepare('UPDATE inventory SET quantity=15 WHERE warehouse_id=? AND product_id=?').run(first.warehouseId, first.productId);
    db.prepare('DELETE FROM inventory_valuation_balances WHERE product_id=?').run(later.productId);
    db.prepare('UPDATE inventory_valuation_balances SET quantity=15,value_cents=1500 WHERE product_id=? AND warehouse_id=?').run(first.productId, first.warehouseId);

    const closed = closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27', now: at });
    const snapshot = db.prepare('SELECT * FROM inventory_period_snapshots WHERE closure_id=? AND warehouse_id=? AND product_id=?').get(closed.id, first.warehouseId, first.productId);
    assert.equal(snapshot.closing_quantity, 5);
    assert.equal(snapshot.period_in_quantity, 5);
    const replay = closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27', now: at });
    assert.equal(replay.id, closed.id);
    assert.equal(replay.repeated, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_period_closures WHERE period_key='2026-06'").get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM inventory_period_snapshots WHERE closure_id=?').get(closed.id).n, 1);
  });

  test('strict sequence, latest-only reopen, same-record reclose and audit history', () => {
    const june = closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27', now: at });
    assert.throws(() => closeInventoryPeriodCommand(db, actor, { period: '2026-08' }, { today: '2026-09-27' }), (error) => error.code === 'PERIOD_SEQUENCE_INVALID');
    const july = closeInventoryPeriodCommand(db, actor, { period: '2026-07' }, { today: '2026-09-27', now: at });
    assert.throws(() => reopenInventoryPeriodCommand(db, actor, june.id, 'older'), (error) => error.code === 'PERIOD_NOT_LATEST');
    const reopened = reopenInventoryPeriodCommand(db, actor, july.id, '补录七月单据', { now: at });
    assert.equal(reopened.status, 'REOPENED');
    assert.equal(getInventoryPeriodStatusData(db, '2026-09-27').nextClosablePeriod, '2026-07');
    const reclosed = closeInventoryPeriodCommand(db, actor, { period: '2026-07', notes: '重结' }, { today: '2026-09-27', now: at });
    assert.equal(reclosed.id, july.id);
    assert.equal(reclosed.reclosed, true);
    assert.equal(db.prepare("SELECT reopen_reason FROM inventory_period_closures WHERE id=?").get(july.id).reopen_reason, '补录七月单据');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='INVENTORY_PERIOD_CLOSURE' AND entity_id=?").get(july.id).n, 3);
  });

  test('warnings require explicit confirmation and closed-through blocks earlier business dates', () => {
    seedAdjustment({ suffix: 'W', date: '2026-06-10', quantity: 2, currentQuantity: 2, active: 0 });
    const check = runInventoryCloseChecks(db, '2026-06', actor, { today: '2026-09-27' });
    assert.equal(check.overallStatus, 'WARNING');
    assert.throws(() => closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27' }), (error) => error.code === 'PRECHECK_WARNING_CONFIRMATION_REQUIRED');
    closeInventoryPeriodCommand(db, actor, { period: '2026-06', confirmWarnings: true }, { today: '2026-09-27', now: at });
    assert.throws(() => assertFinancialPeriodsOpen(db, '2026-05-31'), (error) => error.code === 'INVENTORY_PERIOD_CLOSED');
    assert.doesNotThrow(() => assertFinancialPeriodsOpen(db, '2026-07-01'));
  });

  test('legacy unknown dates block without created_at fallback', () => {
    const seeded = seedAdjustment({ suffix: 'L', date: '2026-06-10', quantity: 1, currentQuantity: 1 });
    db.prepare("UPDATE inventory_transactions SET source_type='LEGACY_UNKNOWN',business_date='2026-06-10',created_at='2026-06-10T00:00:00.000Z' WHERE id=?").run(seeded.txId);
    const check = runInventoryCloseChecks(db, '2026-06', actor, { today: '2026-09-27' });
    assert.equal(check.checks.find((row) => row.code === 'LEGACY_BUSINESS_DATE_UNKNOWN').status, 'FAIL');
    assert.throws(() => closeInventoryPeriodCommand(db, actor, { period: '2026-06' }, { today: '2026-09-27' }), (error) => error.code === 'PRECHECK_BLOCKED');
  });
});
