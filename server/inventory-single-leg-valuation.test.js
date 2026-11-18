// 单腿入库异动的自持计值（Requirement §32.18 `IW-VAL-05` 修订清单）。
//
// 「只有入库腿、没有出库腿」的异动，其入库价值不得由写入器「出库计值」推导
// ——那会从目标池扣掉价值，于是**值离开来源池却不到目标池**：入库腿永远停在
// `LEGACY_UNVALUED`，权威结账被 `INVENTORY_QUANTITY_VS_VALUATION` 与
// `INVENTORY_VALUE_TO_GL` 挡住。
//
// 本套件证明（按穷尽枚举得到的 5 条单腿入库腿）：
//   1. 组装：成品入库腿的价值 = 本次**组件出库**的权威账面价值合计；
//   2. 拆卸：组件回收入库腿的价值 = **母件出库**的权威账面价值（按数量分摊）；
//   3. 步进调拨入库腿：价值 = **调出腿**的权威账面价值；
//   4. VMI 收货入库腿：价值 = **VMI 协议单价 × 数量**（Requirement §31.24
//      `VMI-SET-03` / `VMI-SET-04` 修正后的权威成本口径：权威价值必须与权威
//      金额同源，否则 `INVENTORY_VALUE_TO_GL` 会差出整笔收货金额）；
//   5. 每条入库腿的库存流水必须是 `VALUED`，且估值池数量 = 在库数量。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createProcurementFixture } from './test-support/procurement-http-fixture.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { receiveValue } from './modules/financial-inventory.js';

const UNIT_COST_CENTS = 1000;
const SEED_QUANTITY = 10;
/** 协议单价刻意不等于期初账面单价，用来证明入库价值来自协议而不是估值池。 */
const AGREEMENT_UNIT_PRICE_CENTS = 2500;

describe('单腿入库异动的自持计值（§32.18 IW-VAL-05）', () => {
  let fixture;

  before(async () => { fixture = await createProcurementFixture('modern-erp-single-leg-valuation-'); });
  after(async () => { try { fixture.close(); } catch { /* 清理失败不影响结论 */ } });

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  /** 为货品建立权威库存与估值池（期初口径：物理与估值同时建立）。 */
  function seedValuedStock(productId, warehouseId, { quantity = SEED_QUANTITY, unitCostCents = UNIT_COST_CENTS, key } = {}) {
    const sourceId = `single-leg-seed:${key || productId}:${warehouseId}`;
    applyInventoryMutation({
      db: fixture.db, sourceType: 'OTHER_RECEIPT', sourceId, sourceItemId: `${sourceId}:item`,
      businessDate: isoDate(0), actor: { id: 'user-admin' }, movementKind: 'IN', quantity,
      toPosition: { productId, warehouseId, ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: `SINGLE_LEG:SEED:${sourceId}`, remark: '单腿入库套件期初',
    });
    receiveValue(fixture.db, {
      businessDate: isoDate(0), productId, warehouseId, quantity,
      valueCents: quantity * unitCostCents, movementType: 'OPENING_INVENTORY', sourceType: 'OPENING_INVENTORY',
      sourceId, sourceItemId: `${sourceId}:item`, valuationBasis: 'OPENING_COST',
    });
  }

  function inboundLegs(sourceType, sourceId) {
    return fixture.db.prepare(
      "SELECT * FROM inventory_transactions WHERE source_type=? AND source_id=? AND direction='IN' ORDER BY created_at,id",
    ).all(sourceType, String(sourceId));
  }

  function postedValuation(transactionId) {
    return fixture.db.prepare(
      "SELECT * FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'",
    ).get(transactionId);
  }

  /** 在库数量与估值池数量的快照（差值比较，避免夹具自带的未估值库存干扰）。 */
  function poolSnapshot(productId, warehouseId) {
    const stock = Number(fixture.db.prepare(
      'SELECT COALESCE(SUM(quantity),0) n FROM inventory WHERE product_id=? AND warehouse_id=? AND active=1',
    ).get(productId, warehouseId).n);
    const pool = Number(fixture.db.prepare(
      "SELECT COALESCE(SUM(quantity),0) n FROM inventory_valuation_balances WHERE product_id=? AND warehouse_id=? AND quantity<>0",
    ).get(productId, warehouseId).n);
    return { stock, pool };
  }

  /** 本次异动带来的在库数量变化必须与估值池数量变化一致（`INVENTORY_QUANTITY_VS_VALUATION` 的前提）。 */
  function assertPoolDeltaMatchesStock(productId, warehouseId, before) {
    const after = poolSnapshot(productId, warehouseId);
    assert.equal(after.pool - before.pool, after.stock - before.stock,
      `货品 ${productId} 在 ${warehouseId} 的估值池数量变化必须等于在库数量变化`);
  }

  function seedBom(parentProductId, componentProductId, { quantity = 1, key } = {}) {
    const bomId = `bom-single-leg-${key}`;
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,purpose,effective_from,approval_status,approved_by,approved_at)
      VALUES(?,?,'1','ACTIVE','','user-admin',?,?,'SELF_MAKE',?, 'APPROVED','user-admin',?)`)
      .run(bomId, parentProductId, now, now, isoDate(-1), now);
    fixture.db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,0,1)`)
      .run(`${bomId}:1`, bomId, componentProductId, quantity);
    return bomId;
  }

  test('组装：成品入库腿的价值 = 本次组件出库的权威账面价值合计', async () => {
    const parent = 'product-001';
    const component = 'product-002';
    seedValuedStock(component, 'warehouse-001', { key: 'assembly' });
    const bomId = seedBom(parent, component, { key: 'assembly' });

    const parentBefore = poolSnapshot(parent, 'warehouse-001');
    const created = await fixture.request('POST', '/api/inventory/assembly-orders', fixture.tokens.warehouse, {
      productId: parent, warehouseId: 'warehouse-001', quantity: 5, businessDate: isoDate(0),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const confirmed = await fixture.request('POST', `/api/inventory/assembly-orders/${created.data.id}/confirm`, fixture.tokens.warehouse, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const legs = inboundLegs('INVENTORY_ASSEMBLY', created.data.id);
    assert.equal(legs.length, 1, '成品入库必须恰好一条物理腿');
    assert.equal(legs[0].valuation_status, 'VALUED', '成品入库腿必须完成权威估值');
    const valuation = postedValuation(legs[0].id);
    assert.ok(valuation, '成品入库腿必须存在已过账估值流水');
    // 组件消耗 5 件 × 1000 分 = 5000 分，成品入库价值必须等于它。
    assert.equal(Number(valuation.value_delta_cents), 5 * UNIT_COST_CENTS);
    assertPoolDeltaMatchesStock(parent, 'warehouse-001', parentBefore);
  });

  test('拆卸：组件回收入库腿的价值 = 母件出库的权威账面价值', async () => {
    const parent = 'product-001';
    const component = 'product-002';
    seedValuedStock(parent, 'warehouse-001', { quantity: 3, key: 'disassembly' });
    const bomId = seedBom(parent, component, { key: 'disassembly' });

    const componentBefore = poolSnapshot(component, 'warehouse-001');
    const created = await fixture.request('POST', '/api/inventory/disassembly-orders', fixture.tokens.warehouse, {
      productId: parent, warehouseId: 'warehouse-001', quantity: 3, businessDate: isoDate(0),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const confirmed = await fixture.request('POST', `/api/inventory/disassembly-orders/${created.data.id}/confirm`, fixture.tokens.warehouse, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const legs = inboundLegs('INVENTORY_DISASSEMBLY', created.data.id);
    assert.equal(legs.length, 1, '组件回收入库必须恰好一条物理腿');
    assert.equal(legs[0].valuation_status, 'VALUED', '组件回收入库腿必须完成权威估值');
    const valuation = postedValuation(legs[0].id);
    assert.ok(valuation, '组件回收入库腿必须存在已过账估值流水');
    assert.equal(Number(valuation.value_delta_cents), 3 * UNIT_COST_CENTS);
    assertPoolDeltaMatchesStock(component, 'warehouse-001', componentBefore);
  });

  test('步进调拨入库腿：价值 = 调出腿的权威账面价值', async () => {
    const product = 'product-001';
    seedValuedStock(product, 'warehouse-001', { key: 'step' });
    const transferId = 'TR-SINGLE-LEG-1';
    const targetBefore = poolSnapshot(product, 'warehouse-002');
    // 步进调拨的在途表以外键引用 canonical 调拨单，先建立该单据。
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO inventory_transfers(id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at)
      VALUES(?,?,'warehouse-001','warehouse-002','TRANSFERRED','','user-warehouse',?,?)`)
      .run(transferId, `TR-SINGLE-LEG-1`, now, now);
    const out = await fixture.request('POST', '/api/inventory-step-transfers/out', fixture.tokens.warehouse, {
      sourceTransferId: transferId, productId: product, quantity: 4,
      fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', businessDate: isoDate(0),
    });
    assert.equal(out.status, 201, JSON.stringify(out.data));
    const inbound = await fixture.request('POST', '/api/inventory-step-transfers/in', fixture.tokens.warehouse, {
      sourceTransferId: transferId, productId: product, quantity: 4,
      fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', businessDate: isoDate(0),
    });
    assert.ok([200, 201].includes(inbound.status), JSON.stringify(inbound.data));

    const legs = inboundLegs('INVENTORY_STEP_TRANSFER_IN', transferId);
    assert.equal(legs.length, 1, '调拨入库必须恰好一条物理腿');
    assert.equal(legs[0].valuation_status, 'VALUED', '调拨入库腿必须完成权威估值');
    const valuation = postedValuation(legs[0].id);
    assert.ok(valuation, '调拨入库腿必须存在已过账估值流水');
    assert.equal(Number(valuation.value_delta_cents), 4 * UNIT_COST_CENTS);
    assertPoolDeltaMatchesStock(product, 'warehouse-002', targetBefore);
  });

  test('VMI 收货入库腿：价值 = VMI 协议单价 × 数量', async () => {
    const product = 'product-001';
    await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      procurementEnabled: true, outsourcingEnabled: false, category: 'GENERAL',
    });
    const agreement = await fixture.request('POST', '/api/procurement/vmi/agreements', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: product,
      minStock: 10, maxStock: 100, reorderLevel: 20, effectiveFrom: isoDate(-1),
      unitPriceCents: AGREEMENT_UNIT_PRICE_CENTS,
    });
    assert.equal(agreement.status, 201, JSON.stringify(agreement.data));

    const receipt = await fixture.request('POST', '/api/procurement/vmi/receipts', fixture.tokens.admin, {
      supplierId: 'supplier-001', warehouseId: 'warehouse-001', productId: product,
      quantity: 5, receivedDate: isoDate(0), idempotencyKey: 'single-leg-vmi-1',
    });
    assert.equal(receipt.status, 201, JSON.stringify(receipt.data));
    const confirmed = await fixture.request('POST', `/api/procurement/vmi/receipts/${receipt.data.id}/confirm`, fixture.tokens.admin, {});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));

    const legs = inboundLegs('VMI_RECEIPT', receipt.data.id);
    assert.equal(legs.length, 1, 'VMI 收货必须恰好一条物理腿');
    assert.equal(legs[0].valuation_status, 'VALUED', 'VMI 收货腿必须完成权威估值');
    const valuation = postedValuation(legs[0].id);
    assert.ok(valuation, 'VMI 收货腿必须存在已过账估值流水');
    assert.equal(Number(valuation.value_delta_cents), AGREEMENT_UNIT_PRICE_CENTS * 5,
      'VMI 收货腿的权威价值必须等于协议单价 × 数量');
  });
});
