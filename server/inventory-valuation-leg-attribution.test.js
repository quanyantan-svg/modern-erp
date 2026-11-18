// F-06 —— 异动腿的计值归属（Requirement §32.17 `IW-VAL-01..06`）。
//
// 修复前的客户症状（真实 MySQL 8 实测）：
//   * `LEGACY_UNVALUED_MOVEMENTS` = 2：调拨 IN 腿与库存状态变更 IN 腿的事务行仍是
//     `LEGACY_UNVALUED`；
//   * `INVENTORY_QUANTITY_VS_VALUATION` = 1：状态变更 IN 腿**没有任何估值流水**，
//     在库数量比估值池多 1。
//
// 根因：canonical 位移写入器的 best-effort 计值分支把每条 movement 都当「出库计值」，
// IN 腿在目标位找不到来源池即抛错并被 `catch` 静默吞掉；调拨模块又把 IN 腿的估值流水
// 挂到 OUT 腿的事务 id 上。
//
// 本套件证明：
//   1. 配对异动（状态变更 / 直接调拨）两条腿的事务行都是 `VALUED`；
//   2. 配对异动后估值池数量与在库数量相等、价值守恒（价值中性）；
//   3. 调拨的入账腿估值流水归属**自己的**事务 id；
//   4. 计值失败让异动整体失败且零副作用。

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTempDb } from './test-utils/temp-db.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { receiveValue } from './modules/financial-inventory.js';
import { createInventoryTransfer, confirmInventoryTransferCommand } from './modules/inventory-transfer.js';

const actor = { id: 'user-admin', permissions: ['INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_CONFIRM'] };
const req = (body) => ({
  headers: { 'content-type': 'application/json' },
  [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body)); },
});
const res = () => {
  const response = { statusCode: 0, body: null, setHeader() {}, getHeader() { return null; }, write() {}, on() {}, once() {} };
  response.end = (chunk) => { if (chunk) response.body = JSON.parse(chunk); };
  return response;
};

function seed(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('user-admin','admin','管理员','x','x','role-admin',1,?)`).run(now);
  for (const [id, code, name] of [['wh-a', 'WH-A', '甲仓'], ['wh-b', 'WH-B', '乙仓']]) {
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
      VALUES(?,?,?,1,0,?,?)`).run(id, code, name, now, now);
  }
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,valuation_method,created_at,updated_at)
    VALUES('p-leg','P-LEG','腿归属料','CAT','EA',1000,0,1,'NONE','MOVING_AVERAGE',?,?)`).run(now, now);
}

function stockOf(db, productId, warehouseId, stockStatus) {
  return Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM inventory WHERE product_id=? AND warehouse_id=? AND stock_status=? AND active=1`)
    .get(productId, warehouseId, stockStatus).n);
}

function poolOf(db, productId, warehouseId) {
  const row = db.prepare('SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key=?')
    .get(`NONE:${warehouseId}:${productId}`);
  return row ? { quantity: Number(row.quantity), valueCents: Number(row.value_cents) } : { quantity: 0, valueCents: 0 };
}

test('F-06 配对异动（状态变更）：两条腿都 VALUED，估值池数量与价值守恒', () => {
  const handle = createTempDb({ label: 'f06-leg-attribution', production: true });
  const db = handle.db;
  seed(db);
  // 先给甲仓的可用位建立权威估值：100 件 × 1000 分 = 100000 分。
  const receipt1 = applyInventoryMutation({
    db, sourceType: 'PURCHASE_RECEIPT', sourceId: 'rc-1', sourceItemId: 'rc-1',
    businessDate: '2026-11-18', actor: { id: actor.id }, movementKind: 'IN', quantity: 100,
    toPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' },
    idempotencyKey: 'F06-RC-1',
  });
  receiveValue(db, {
    businessDate: '2026-11-18', productId: 'p-leg', warehouseId: 'wh-a', quantity: 100,
    valueCents: 100000, movementType: 'PURCHASE_RECEIPT', sourceType: 'PURCHASE_RECEIPT',
    sourceId: 'rc-1', sourceItemId: 'rc-1', valuationBasis: 'APPROVED_PO_PRICE',
    inventoryTransactionId: receipt1.movements.find((m) => m.direction === 'IN').transactionId,
  });

  const before = poolOf(db, 'p-leg', 'wh-a');
  assert.deepEqual(before, { quantity: 100, valueCents: 100000 });

  applyInventoryMutation({
    db, sourceType: 'INVENTORY_STOCK_STATUS_CHANGE', sourceId: 'stk-1', sourceItemId: 'stk-1',
    businessDate: '2026-11-18', actor: { id: actor.id }, movementKind: 'STATUS_CHANGE', quantity: 40,
    fromPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' },
    toPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'HOLD' },
    idempotencyKey: 'F06-STK-1',
  });

  // 两条腿的事务行都必须被标记 VALUED（修复前入账腿停在 LEGACY_UNVALUED）。
  const legs = db.prepare("SELECT direction,valuation_status FROM inventory_transactions WHERE source_type='INVENTORY_STOCK_STATUS_CHANGE' ORDER BY direction").all();
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((row) => row.valuation_status), ['VALUED', 'VALUED']);

  // 价值中性：池的数量与价值都不变；在库数量与池数量相等。
  const after = poolOf(db, 'p-leg', 'wh-a');
  assert.equal(after.quantity, 100, '状态变更不得改变估值池数量');
  assert.equal(after.valueCents, 100000, '状态变更不得改变估值池价值');
  assert.equal(stockOf(db, 'p-leg', 'wh-a', 'AVAILABLE'), 60);
  assert.equal(stockOf(db, 'p-leg', 'wh-a', 'HOLD'), 40);
  assert.equal(stockOf(db, 'p-leg', 'wh-a', 'AVAILABLE') + stockOf(db, 'p-leg', 'wh-a', 'HOLD'), after.quantity);

  // 未估值移动不得残留。
  const unvalued = db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE valuation_status<>'VALUED'").get().n;
  assert.equal(Number(unvalued), 0);
});

test('F-06 直接调拨：入账腿的估值流水归属自己的事务 id（修复前归属出账腿）', async () => {
  const handle = createTempDb({ label: 'f06-leg-attribution', production: true });
  const db = handle.db;
  seed(db);
  const receipt2 = applyInventoryMutation({
    db, sourceType: 'PURCHASE_RECEIPT', sourceId: 'rc-2', sourceItemId: 'rc-2',
    businessDate: '2026-11-18', actor: { id: actor.id }, movementKind: 'IN', quantity: 60,
    toPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' },
    idempotencyKey: 'F06-RC-2',
  });
  receiveValue(db, {
    businessDate: '2026-11-18', productId: 'p-leg', warehouseId: 'wh-a', quantity: 60,
    valueCents: 60000, movementType: 'PURCHASE_RECEIPT', sourceType: 'PURCHASE_RECEIPT',
    sourceId: 'rc-2', sourceItemId: 'rc-2', valuationBasis: 'APPROVED_PO_PRICE',
    inventoryTransactionId: receipt2.movements.find((m) => m.direction === 'IN').transactionId,
  });

  const created = res();
  await createInventoryTransfer(db, req({
    fromWarehouseId: 'wh-a', toWarehouseId: 'wh-b', businessDate: '2026-11-18',
    items: [{ productId: 'p-leg', quantity: 25 }],
  }), created, actor);
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  confirmInventoryTransferCommand(db, actor, created.body.id, '2026-11-18T00:00:00.000Z');

  // 两条腿都是 VALUED。
  const legs = db.prepare("SELECT id,direction,valuation_status FROM inventory_transactions WHERE source_type='INVENTORY_TRANSFER' ORDER BY direction").all();
  assert.equal(legs.length, 2);
  assert.deepEqual(legs.map((row) => row.valuation_status), ['VALUED', 'VALUED']);

  // 入账腿的估值流水必须引用**入账腿自己的**事务 id。
  const inLeg = legs.find((row) => row.direction === 'IN');
  const inValuation = db.prepare("SELECT inventory_transaction_id,value_delta_cents FROM inventory_valuation_movements WHERE movement_type='TRANSFER_IN'").get();
  assert.ok(inValuation, '入账腿必须有估值流水');
  assert.equal(inValuation.inventory_transaction_id, inLeg.id, '入账腿的估值流水必须归属入账腿自己的事务行');
  assert.equal(Number(inValuation.value_delta_cents), 25000, '入账腿承接出账腿发出的价值');

  // 目标仓的池必须收到该价值。
  assert.equal(poolOf(db, 'p-leg', 'wh-b').quantity, 25);
  assert.equal(poolOf(db, 'p-leg', 'wh-b').valueCents, 25000);
  assert.equal(poolOf(db, 'p-leg', 'wh-a').quantity, 35);
});

test('F-06 承接失败时异动整体失败且零副作用', () => {
  const handle = createTempDb({ label: 'f06-leg-attribution', production: true });
  const db = handle.db;
  seed(db);
  // 有库存但没有估值池：出账腿无法计价 → 异动必须失败，而不是静默留下未估值事实。
  applyInventoryMutation({
    db, sourceType: 'PURCHASE_RECEIPT', sourceId: 'rc-3', sourceItemId: 'rc-3',
    businessDate: '2026-11-18', actor: { id: actor.id }, movementKind: 'IN', quantity: 5,
    toPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' },
    idempotencyKey: 'F06-RC-3',
  });
  db.prepare('UPDATE products SET valuation_activated_at=? WHERE id=?').run('2026-11-18T00:00:00.000Z', 'p-leg');
  // 货品已进入估值口径（valuation_activated_at），但没有估值池：配对异动的出账腿
  // 无法计价 → 异动必须失败，而不是静默留下未估值事实。
  const before = {
    transactions: db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
    valuations: db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements').get().n,
    stock: db.prepare('SELECT COUNT(*) n FROM inventory').get().n,
  };
  assert.throws(() => applyInventoryMutation({
    db, sourceType: 'INVENTORY_STOCK_STATUS_CHANGE', sourceId: 'stk-2', sourceItemId: 'stk-2',
    businessDate: '2026-11-18', actor: { id: actor.id }, movementKind: 'STATUS_CHANGE', quantity: 5,
    fromPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' },
    toPosition: { productId: 'p-leg', warehouseId: 'wh-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'HOLD' },
    idempotencyKey: 'F06-STK-2',
  }));
  const after = {
    transactions: db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n,
    valuations: db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements').get().n,
    stock: db.prepare('SELECT COUNT(*) n FROM inventory').get().n,
  };
  assert.deepEqual(after, before, '计值失败必须让异动零副作用');
});
