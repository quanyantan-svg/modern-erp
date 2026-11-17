// Requirement §31.21 / Design §26.41 —— 采购入库确认的跟踪物料合同。
//
// 本套件保护的是**一个写路径的收敛**，不是一个新能力：
//   * 采购入库确认的物理数量写入**必须**经唯一 canonical 写入器
//     （`applyInventoryMutation`），**不得**再调用 legacy `adjustInventory` /
//     `setInventoryQuantity`（Inventory Design §27.8 / §27.43.1 §C）；
//   * 批次 / 序列号跟踪物料**必须**可以完成入库确认，且数量落在带身份的
//     canonical position 上，采购价估值落在**同一身份**的估值池上
//     （`LOT:{warehouse}:{product}:{lot}` / `SERIAL:{serial}`）；
//   * 跟踪物料的分配证据缺失 / 不平 / 重复确认**必须** fail closed 且零副作用；
//   * 不跟踪物料的既有行为**必须**不变（回归护栏）；
//   * 残余写入点（Design §26.41.9 第 2 项的 11 处）**仍然拒绝**跟踪物料 ——
//     本次收敛**没有**把它们悄悄放开。
//
// 每条物理变化都必须同时出现在 canonical `inventory`、`inventory_transactions`、
// `tracked_inventory_movements` 与身份级估值流水中；断言「能通过」本身不是证据 ——
// 负控与写入器层断言共同构成证明。

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createServer } from 'node:http';

import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { insertPurchasePrice } from './test-support/procurement-http-fixture.js';
import { adjustInventory, setInventoryQuantity } from './lib/stock.js';

const WAREHOUSE_ID = 'warehouse-001';
const SUPPLIER_ID = 'supplier-001';
const RECEIPT_DATE = '2026-10-09';
const LOT_PRODUCT = 'product-prc-trk-lot';
const SERIAL_PRODUCT = 'product-prc-trk-serial';
const NONE_PRODUCT = 'product-001';

async function makeFixture() {
  const tempDir = mkdtempSync(join(tmpdir(), 'prc-trk-receipt-'));
  const db = createDatabase(join(tempDir, 'erp.db'));
  const server = createServer(createApp(db, { distDir: join(tempDir, 'dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function request(method, path, token, body, extraHeaders = {}) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }
  async function login(username, password) {
    const r = await request('POST', '/api/auth/login', null, { username, password });
    assert.equal(r.status, 200, r.data.error);
    return r.data.token;
  }
  const tokens = {
    admin: await login('admin', 'admin123'),
    warehouse: await login('warehouse', 'warehouse123'),
    reviewer: await login('reviewer', 'review123'),
  };
  return {
    db, request, tokens,
    close: () => new Promise((done, reject) => server.close((err) => err ? reject(err) : done()))
      .then(() => { db.close(); rmSync(tempDir, { recursive: true, force: true }); }),
  };
}

function seedTrackedProduct(db, { id, code, name, trackingPolicy, valuationMethod, priceCents }) {
  if (db.prepare('SELECT id FROM products WHERE id=?').get(id)) return id;
  db.prepare(`INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active,
      base_uom_code, tracking_policy, valuation_method, inventory_classification, created_at, updated_at)
    VALUES(?,?,?,'PRC-TRK','EA',?,0,1,'EA',?,?,'RAW_MATERIAL',datetime('now'),datetime('now'))`)
    .run(id, code, name, priceCents, trackingPolicy, valuationMethod);
  return id;
}

async function createApprovedPO(fix, { productId, quantity, unitPriceCents }) {
  insertPurchasePrice(fix.db, { supplierId: SUPPLIER_ID, productId, unitPriceCents });
  const po = await fix.request('POST', '/api/purchase-orders', fix.tokens.admin, {
    supplierId: SUPPLIER_ID, orderDate: '2026-10-08', expectedDeliveryDate: '2026-10-09',
    supplierContactName: '联系人', supplierContactPhone: '13800000000', supplierAddress: '地址', paymentTerms: '30 天',
    items: [{ productId, quantity, unitPriceCents }],
  });
  assert.equal(po.status, 201, po.data.error);
  await fix.request('POST', `/api/purchase-orders/${po.data.id}/submit`, fix.tokens.admin);
  await fix.request('POST', `/api/purchase-orders/${po.data.id}/approve`, fix.tokens.reviewer);
  return po.data.id;
}

async function createDraftReceipt(fix, { poId, productId, quantity, unitPriceCents, trackingAllocations }) {
  const poi = fix.db.prepare('SELECT id FROM purchase_order_items WHERE order_id=?').get(poId);
  const item = { purchaseOrderItemId: poi.id, productId, quantity, unitPriceCents };
  if (trackingAllocations) item.trackingAllocations = trackingAllocations;
  const created = await fix.request('POST', '/api/purchase-receipts', fix.tokens.warehouse, {
    purchaseOrderId: poId, supplierId: SUPPLIER_ID, warehouseId: WAREHOUSE_ID, receiptDate: RECEIPT_DATE,
    items: [item],
  });
  return created;
}

async function clearIqc(fix, receiptId, quantity) {
  const iqc = await fix.request('POST', '/api/iqc', fix.tokens.warehouse, { purchase_receipt_id: receiptId });
  if (iqc.status === 201) {
    await fix.request('POST', `/api/iqc/${iqc.data.id}/complete`, fix.tokens.warehouse, {
      result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0,
    });
  }
}

async function confirmReceipt(fix, receiptId, extraHeaders = {}) {
  return fix.request('POST', `/api/purchase-receipts/${receiptId}`, fix.tokens.warehouse, { action: 'confirm' }, extraHeaders);
}

function receiptItemId(db, receiptId) {
  return db.prepare('SELECT id FROM purchase_receipt_items WHERE receipt_id=?').get(receiptId).id;
}

function inventoryRows(db, productId) {
  return db.prepare('SELECT * FROM inventory WHERE product_id=? AND active=1 ORDER BY lot_id, serial_id').all(productId);
}

function valuationMovements(db, receiptId) {
  return db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=? ORDER BY created_at, id").all(receiptId);
}

describe('采购入库确认的跟踪物料合同（Requirement §31.21 / Design §26.41）', () => {
  let fix;

  before(async () => {
    fix = await makeFixture();
    const warehouse = fix.db.prepare('SELECT id, bin_enabled FROM warehouses WHERE id=?').get(WAREHOUSE_ID);
    assert.ok(warehouse, '演示种子的 warehouse-001 必须存在');
    assert.equal(Number(warehouse.bin_enabled), 0, '本套件使用非仓位仓；仓位仓由腿解析 fail closed');
    seedTrackedProduct(fix.db, {
      id: LOT_PRODUCT, code: 'PRC-TRK-LOT', name: '跟踪批次原料',
      trackingPolicy: 'LOT', valuationMethod: 'LOT_SPECIFIC_POOL', priceCents: 1000,
    });
    seedTrackedProduct(fix.db, {
      id: SERIAL_PRODUCT, code: 'PRC-TRK-SERIAL', name: '跟踪序列号成品',
      trackingPolicy: 'SERIAL', valuationMethod: 'SPECIFIC_SERIAL', priceCents: 1000,
    });
  });

  after(async () => { await fix.close(); });

  test('批次物料可以完成采购入库确认：数量落带批次的 canonical position，估值落身份级估值池', async () => {
    const poId = await createApprovedPO(fix, { productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, {
      poId, productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000,
      trackingAllocations: [{ lotCode: 'LOT-A', quantity: 10 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;
    await clearIqc(fix, receiptId, 10);

    const confirmed = await confirmReceipt(fix, receiptId);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const lot = fix.db.prepare('SELECT * FROM inventory_lots WHERE product_id=? AND lot_code=?').get(LOT_PRODUCT, 'LOT-A');
    assert.ok(lot, '批次主档必须被建立');

    const rows = inventoryRows(fix.db, LOT_PRODUCT);
    assert.equal(rows.length, 1, '一个批次只落一个 canonical position');
    assert.equal(Number(rows[0].quantity), 10);
    assert.equal(rows[0].lot_id, lot.id);
    assert.equal(rows[0].serial_id, null);
    assert.equal(rows[0].owner_type, 'ENTERPRISE');
    assert.equal(rows[0].owner_id, null);
    assert.equal(rows[0].stock_status, 'AVAILABLE');
    assert.equal(rows[0].bin_id, null);
    assert.ok(rows[0].position_key, 'canonical position 必须写 position_key');

    const lotBalance = fix.db.prepare('SELECT * FROM inventory_lot_balances WHERE warehouse_id=? AND lot_id=?').get(WAREHOUSE_ID, lot.id);
    assert.ok(lotBalance, '批次维度投影必须同步维护');
    assert.equal(Number(lotBalance.quantity), 10, '投影数量必须与 canonical 库存一致');

    const movements = valuationMovements(fix.db, receiptId);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].lot_id, lot.id, '估值必须落在该批次身份上');
    assert.equal(movements[0].serial_id, null);
    assert.equal(Number(movements[0].quantity_delta), 10);
    assert.equal(Number(movements[0].value_delta_cents), 10000);

    const balance = fix.db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?')
      .get(`LOT:${WAREHOUSE_ID}:${LOT_PRODUCT}:${lot.id}`);
    assert.ok(balance, '批次身份级估值余额必须存在');
    assert.equal(Number(balance.quantity), 10);
    assert.equal(Number(balance.value_cents), 10000);

    const transactions = fix.db.prepare("SELECT * FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").all(receiptId);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].direction, 'IN');
    assert.equal(Number(transactions[0].quantity_change), 10);
    assert.equal(Number(transactions[0].balance_after), 10);
    assert.equal(transactions[0].valuation_status, 'VALUED', '库存流水必须被估值标记');
    assert.equal(transactions[0].remark, '采购入库');
    assert.equal(transactions[0].business_date, RECEIPT_DATE);

    const tracked = fix.db.prepare("SELECT * FROM tracked_inventory_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").all(receiptId);
    assert.equal(tracked.length, 1);
    assert.equal(tracked[0].lot_id, lot.id);

    assert.equal(fix.db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(receiptId).status, 'CONFIRMED');
  });

  test('序列号物料可以完成采购入库确认：每个序列号一个身份级 position 与估值池', async () => {
    const poId = await createApprovedPO(fix, { productId: SERIAL_PRODUCT, quantity: 2, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, {
      poId, productId: SERIAL_PRODUCT, quantity: 2, unitPriceCents: 1000,
      trackingAllocations: [{ serialNumber: 'SN-001' }, { serialNumber: 'SN-002' }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;
    await clearIqc(fix, receiptId, 2);

    const confirmed = await confirmReceipt(fix, receiptId);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const serials = fix.db.prepare('SELECT * FROM inventory_serials WHERE product_id=? ORDER BY serial_number').all(SERIAL_PRODUCT);
    assert.equal(serials.length, 2);
    for (const serial of serials) {
      assert.equal(serial.lifecycle_state, 'AVAILABLE');
      assert.equal(serial.current_warehouse_id, WAREHOUSE_ID);
      const row = fix.db.prepare('SELECT * FROM inventory WHERE product_id=? AND serial_id=? AND active=1').get(SERIAL_PRODUCT, serial.id);
      assert.ok(row, '序列号必须落在自己的 canonical position');
      assert.equal(Number(row.quantity), 1);
      assert.equal(row.lot_id, null);
      const balance = fix.db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?').get(`SERIAL:${serial.id}`);
      assert.ok(balance, '序列号身份级估值余额必须存在');
      assert.equal(Number(balance.quantity), 1);
      assert.equal(Number(balance.value_cents), 1000);
    }

    const movements = valuationMovements(fix.db, receiptId);
    assert.equal(movements.length, 2);
    assert.equal(movements.reduce((sum, m) => sum + Number(m.quantity_delta), 0), 2);
    assert.equal(movements.reduce((sum, m) => sum + Number(m.value_delta_cents), 0), 2000);
    for (const movement of movements) {
      assert.ok(movement.serial_id, '估值必须落在该序列号身份上');
      assert.equal(Number(movement.quantity_delta), 1);
      assert.equal(Number(movement.value_delta_cents), 1000);
    }
  });

  test('多批次分配：拆成多条腿，逐腿落位，逐腿估值且金额合计守恒', async () => {
    const poId = await createApprovedPO(fix, { productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, {
      poId, productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000,
      trackingAllocations: [{ lotCode: 'LOT-B', quantity: 6 }, { lotCode: 'LOT-C', quantity: 4 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;
    await clearIqc(fix, receiptId, 10);

    const confirmed = await confirmReceipt(fix, receiptId);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const lots = fix.db.prepare('SELECT * FROM inventory_lots WHERE product_id=? AND lot_code IN (?,?) ORDER BY lot_code').all(LOT_PRODUCT, 'LOT-B', 'LOT-C');
    assert.equal(lots.length, 2);
    const byCode = Object.fromEntries(lots.map((lot) => [lot.lot_code, lot]));

    const rows = inventoryRows(fix.db, LOT_PRODUCT).filter((row) => [byCode['LOT-B'].id, byCode['LOT-C'].id].includes(row.lot_id));
    assert.equal(rows.length, 2, '两个批次必须落两个 canonical position');
    const quantityByLot = Object.fromEntries(rows.map((row) => [row.lot_id, Number(row.quantity)]));
    assert.equal(quantityByLot[byCode['LOT-B'].id], 6);
    assert.equal(quantityByLot[byCode['LOT-C'].id], 4);

    const movements = valuationMovements(fix.db, receiptId).filter((m) => [byCode['LOT-B'].id, byCode['LOT-C'].id].includes(m.lot_id));
    assert.equal(movements.length, 2);
    const valueByLot = Object.fromEntries(movements.map((m) => [m.lot_id, Number(m.value_delta_cents)]));
    assert.equal(valueByLot[byCode['LOT-B'].id], 6000, '估值按腿数量比例拆分');
    assert.equal(valueByLot[byCode['LOT-C'].id], 4000);
    assert.equal(movements.reduce((sum, m) => sum + Number(m.value_delta_cents), 0), 10000, '金额合计必须守恒');

    // 每条估值流水必须引用**自己那条腿**的库存流水，不得串号。
    const transactionIds = new Set(movements.map((m) => m.inventory_transaction_id));
    assert.equal(transactionIds.size, 2, '两条腿必须引用两条不同的库存流水');
    for (const movement of movements) {
      const transaction = fix.db.prepare('SELECT * FROM inventory_transactions WHERE id=?').get(movement.inventory_transaction_id);
      assert.ok(transaction, '估值必须引用真实存在的库存流水');
      assert.equal(Number(transaction.quantity_change), Number(movement.quantity_delta));
    }

    for (const lot of lots) {
      const lotBalance = fix.db.prepare('SELECT * FROM inventory_lot_balances WHERE warehouse_id=? AND lot_id=?').get(WAREHOUSE_ID, lot.id);
      assert.equal(Number(lotBalance.quantity), Number(quantityByLot[lot.id]), '批次投影必须与该腿数量一致');
    }
  });

  test('身份证据缺失时确认 fail closed：零副作用，单据不确认', async () => {
    const poId = await createApprovedPO(fix, { productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, {
      poId, productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000,
      trackingAllocations: [{ lotCode: 'LOT-D', quantity: 10 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;

    // 本例要命中**确认环节**的身份守卫，因此把本单的质量策略置为免检 —— 否则质量门禁
    // 会先用批次快照差异（检验已失效）先行拦下，测不到目标分支。
    fix.db.prepare("UPDATE logistics_quality_policy_snapshots SET inspection_required=0 WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").run(receiptId);

    // 身份分配证据在草稿后丢失（模拟证据被抹除）：确认必须拒绝而不是无声地写无身份仓位。
    fix.db.prepare("DELETE FROM tracked_source_allocations WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").run(receiptId);

    const before = {
      inventory: fix.db.prepare('SELECT COUNT(*) n FROM inventory WHERE product_id=?').get(LOT_PRODUCT).n,
      lots: fix.db.prepare('SELECT COUNT(*) n FROM inventory_lots WHERE product_id=?').get(LOT_PRODUCT).n,
      lotBalances: fix.db.prepare('SELECT COUNT(*) n FROM inventory_lot_balances WHERE product_id=?').get(LOT_PRODUCT).n,
      movements: fix.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE product_id=?').get(LOT_PRODUCT).n,
      transactions: fix.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE product_id=?').get(LOT_PRODUCT).n,
      tracked: fix.db.prepare('SELECT COUNT(*) n FROM tracked_inventory_movements WHERE product_id=?').get(LOT_PRODUCT).n,
    };

    const confirmed = await confirmReceipt(fix, receiptId);
    assert.equal(confirmed.status, 409, JSON.stringify(confirmed.data));
    assert.match(JSON.stringify(confirmed.data), /批次|LOT_REQUIRED/);

    const after = {
      inventory: fix.db.prepare('SELECT COUNT(*) n FROM inventory WHERE product_id=?').get(LOT_PRODUCT).n,
      lots: fix.db.prepare('SELECT COUNT(*) n FROM inventory_lots WHERE product_id=?').get(LOT_PRODUCT).n,
      lotBalances: fix.db.prepare('SELECT COUNT(*) n FROM inventory_lot_balances WHERE product_id=?').get(LOT_PRODUCT).n,
      movements: fix.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE product_id=?').get(LOT_PRODUCT).n,
      transactions: fix.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE product_id=?').get(LOT_PRODUCT).n,
      tracked: fix.db.prepare('SELECT COUNT(*) n FROM tracked_inventory_movements WHERE product_id=?').get(LOT_PRODUCT).n,
    };
    assert.deepEqual(after, before, '拒绝后不得留下任何批次 / 库存 / 估值半成品');
    assert.equal(fix.db.prepare('SELECT status FROM purchase_receipts WHERE id=?').get(receiptId).status, 'DRAFT');
  });

  test('分配数量与行数量不平时创建即被拒，且零副作用', async () => {
    const poId = await createApprovedPO(fix, { productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const before = {
      receipts: fix.db.prepare('SELECT COUNT(*) n FROM purchase_receipts').get().n,
      allocations: fix.db.prepare("SELECT COUNT(*) n FROM tracked_source_allocations WHERE source_type='PURCHASE_RECEIPT'").get().n,
      inventory: fix.db.prepare('SELECT COUNT(*) n FROM inventory WHERE product_id=?').get(LOT_PRODUCT).n,
    };
    const created = await createDraftReceipt(fix, {
      poId, productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000,
      trackingAllocations: [{ lotCode: 'LOT-E', quantity: 5 }],
    });
    assert.equal(created.status, 409, JSON.stringify(created.data));
    assert.match(JSON.stringify(created.data), /批次数量合计|TRACKING_QUANTITY_MISMATCH/);
    const after = {
      receipts: fix.db.prepare('SELECT COUNT(*) n FROM purchase_receipts').get().n,
      allocations: fix.db.prepare("SELECT COUNT(*) n FROM tracked_source_allocations WHERE source_type='PURCHASE_RECEIPT'").get().n,
      inventory: fix.db.prepare('SELECT COUNT(*) n FROM inventory WHERE product_id=?').get(LOT_PRODUCT).n,
    };
    assert.deepEqual(after, before, '被拒的创建不得留下单据、分配或库存');
  });

  test('重复确认：数量、批次余额与估值余额都不增加', async () => {
    const poId = await createApprovedPO(fix, { productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, {
      poId, productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000,
      trackingAllocations: [{ lotCode: 'LOT-F', quantity: 10 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;
    await clearIqc(fix, receiptId, 10);

    const first = await confirmReceipt(fix, receiptId);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    const lot = fix.db.prepare('SELECT * FROM inventory_lots WHERE product_id=? AND lot_code=?').get(LOT_PRODUCT, 'LOT-F');
    const snapshot = {
      inventory: Number(fix.db.prepare('SELECT quantity FROM inventory WHERE product_id=? AND lot_id=? AND active=1').get(LOT_PRODUCT, lot.id).quantity),
      lotBalance: Number(fix.db.prepare('SELECT quantity FROM inventory_lot_balances WHERE warehouse_id=? AND lot_id=?').get(WAREHOUSE_ID, lot.id).quantity),
      valuation: Number(fix.db.prepare('SELECT value_cents FROM inventory_valuation_balances WHERE balance_key=?').get(`LOT:${WAREHOUSE_ID}:${LOT_PRODUCT}:${lot.id}`).value_cents),
      transactions: fix.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId).n,
      movements: fix.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId).n,
    };
    assert.equal(snapshot.inventory, 10);

    const second = await confirmReceipt(fix, receiptId, { 'idempotency-key': `prc-replay-${receiptId}` });
    assert.equal(second.status, 409, JSON.stringify(second.data));

    const after = {
      inventory: Number(fix.db.prepare('SELECT quantity FROM inventory WHERE product_id=? AND lot_id=? AND active=1').get(LOT_PRODUCT, lot.id).quantity),
      lotBalance: Number(fix.db.prepare('SELECT quantity FROM inventory_lot_balances WHERE warehouse_id=? AND lot_id=?').get(WAREHOUSE_ID, lot.id).quantity),
      valuation: Number(fix.db.prepare('SELECT value_cents FROM inventory_valuation_balances WHERE balance_key=?').get(`LOT:${WAREHOUSE_ID}:${LOT_PRODUCT}:${lot.id}`).value_cents),
      transactions: fix.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId).n,
      movements: fix.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").get(receiptId).n,
    };
    assert.deepEqual(after, snapshot, '重复确认不得重复增加任何数量或价值');
  });

  test('canonical 写入器的幂等键是确定的：由入库单、明细行与位置构成，不含随机或时间成分', async () => {
    const poId = await createApprovedPO(fix, { productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, {
      poId, productId: LOT_PRODUCT, quantity: 10, unitPriceCents: 1000,
      trackingAllocations: [{ lotCode: 'LOT-G', quantity: 10 }],
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;
    const itemId = receiptItemId(fix.db, receiptId);
    await clearIqc(fix, receiptId, 10);
    const confirmed = await confirmReceipt(fix, receiptId);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const logs = fix.db.prepare("SELECT * FROM inventory_mutation_log WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").all(receiptId);
    assert.equal(logs.length, 1);
    const lot = fix.db.prepare('SELECT * FROM inventory_lots WHERE product_id=? AND lot_code=?').get(LOT_PRODUCT, 'LOT-G');
    const positionKey = fix.db.prepare('SELECT position_key FROM inventory WHERE product_id=? AND lot_id=? AND active=1').get(LOT_PRODUCT, lot.id).position_key;
    assert.equal(
      logs[0].idempotency_key,
      `PURCHASE_RECEIPT:${receiptId}:${itemId}:${positionKey}:IN:v1`,
      '幂等键必须由入库单、明细行与 position 确定性构成',
    );
    assert.doesNotMatch(logs[0].idempotency_key, /\d{13}/, '幂等键不得含时间戳');
  });

  test('不跟踪物料的采购入库行为不变：默认位置 + 移动加权平均估值池', async () => {
    const poId = await createApprovedPO(fix, { productId: NONE_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    const created = await createDraftReceipt(fix, { poId, productId: NONE_PRODUCT, quantity: 10, unitPriceCents: 1000 });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const receiptId = created.data.id;
    await clearIqc(fix, receiptId, 10);

    const confirmed = await confirmReceipt(fix, receiptId);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const row = fix.db.prepare('SELECT * FROM inventory WHERE product_id=? AND warehouse_id=? AND lot_id IS NULL AND serial_id IS NULL AND active=1').get(NONE_PRODUCT, WAREHOUSE_ID);
    assert.ok(row, '不跟踪物料必须落在默认 canonical position');
    assert.equal(row.owner_type, 'ENTERPRISE');
    assert.equal(row.stock_status, 'AVAILABLE');
    assert.ok(row.position_key);
    assert.ok(Number(row.quantity) >= 10, '默认位置数量必须包含本次入库');

    const movements = valuationMovements(fix.db, receiptId);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].lot_id, null);
    assert.equal(movements[0].serial_id, null);
    assert.equal(Number(movements[0].quantity_delta), 10);
    assert.equal(Number(movements[0].value_delta_cents), 10000);

    const balance = fix.db.prepare('SELECT * FROM inventory_valuation_balances WHERE balance_key=?').get(`NONE:${WAREHOUSE_ID}:${NONE_PRODUCT}`);
    assert.ok(balance, '不跟踪物料仍走移动加权平均估值池');
    assert.equal(Number(balance.quantity) >= 10, true);
    assert.equal(Number(balance.value_cents) >= 10000, true);

    const transactions = fix.db.prepare("SELECT * FROM inventory_transactions WHERE source_type='PURCHASE_RECEIPT' AND source_id=?").all(receiptId);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].valuation_status, 'VALUED');
    assert.equal(transactions[0].remark, '采购入库');
  });

  test('负控：残余写入点对跟踪物料仍然拒绝 —— 本次收敛没有把残余路径悄悄放开', () => {
    const now = new Date().toISOString();
    assert.throws(
      () => adjustInventory(fix.db, WAREHOUSE_ID, LOT_PRODUCT, 1, now),
      (error) => error.status === 400 && /LOT 跟踪/.test(error.message),
      'legacy adjustInventory 必须继续拒绝批次物料',
    );
    assert.throws(
      () => adjustInventory(fix.db, WAREHOUSE_ID, SERIAL_PRODUCT, 1, now),
      (error) => error.status === 400 && /SERIAL 跟踪/.test(error.message),
      'legacy adjustInventory 必须继续拒绝序列号物料',
    );
    assert.throws(
      () => setInventoryQuantity(fix.db, WAREHOUSE_ID, LOT_PRODUCT, 1, now),
      (error) => error.status === 400 && /LOT 跟踪/.test(error.message),
      'legacy setInventoryQuantity 必须继续拒绝批次物料',
    );
  });
});
