// M1C-WP7A-R1 —— G03 的**多物料行与 SERIAL 身份**物理腿数补证（SQLite L1）。
//
// Active Design §13.1 的 G03 成功列要求：「沿 canonical 仓位写真实物理库存、跟踪与
// 估值；企业所有权不变；内部仓与 WIP 仓数量与流水可对账；**多物料行与 SERIAL 拆分
// 各自成键，实际腿数 == 预期腿数**」。
//
// 此前 G03-1 只覆盖**单物料单身份**各发一次，多物料行与 SERIAL 拆分的腿数断言没有
// 断言位。本文件补上它：
//
//   - 一个委外订单，三条物料行：LOT（批次跟踪）、NONE（非跟踪）、SERIAL（序列号跟踪）；
//   - 四次**独立**的合法发料：LOT 一次、NONE 一次、SERIAL **两个不同序列号各一次**；
//     SERIAL 每次数量严格为 1（生产合同的 SERIAL 策略要求），**不做批量发料**、
//     **不发数量为 2 的 SERIAL**；
//   - 断言四个独立业务事件 ID、物料行与身份键精确对应、每个 MOVE 恰好一 OUT 一 IN
//     （共八条物理腿）、每条物理腿的跟踪与 POSTED 估值关联正确、来源仓与供应商 WIP 仓
//     数量守恒且企业所有权不变、WIP 身份余额与效果记录按身份分域不串行、同一外部幂等键
//     同内容重放不产生第二次物理动作而异内容稳定拒绝且业务事实零变化。
//
// 证据口径：
//   - 正向来源**全部**经生产 HTTP API（L1）；只有三处使用直接 SQL（L3），且都是没有
//     生产写入入口的字段：`products.valuation_method`、`inventory_valuation_balances`
//     种子行、`inventory_lot_balances` 种子行。
//   - 本文件拥有一次性临时 SQLite 文件，不触碰任何项目 / 开发 / 生产数据库，
//     也不连接 MySQL。
//   - 本文件**独立**于 G03 / G04 / G06 的其它用例，不依赖它们的执行顺序。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createProcurementFixture, seedOutsourceSource } from './test-support/procurement-http-fixture.js';
import {
  G03_BUSINESS_FACT_TABLES, changedTables, snapshotTables,
} from './test-support/m1-core-g03-g04-evidence.js';

const PARENT_CODE = 'WP7A-M-FG';
const LOT_CODE = 'WP7A-M-LOT';
const NONE_CODE = 'WP7A-M-NONE';
const SERIAL_CODE = 'WP7A-M-SERIAL';
const SOURCE_WAREHOUSE = 'warehouse-001';
const WIP_WAREHOUSE = 'warehouse-002';

describe('M1C-WP7A-R1 — G03 多物料行与 SERIAL 身份物理腿数', () => {
  let fixture;
  let parentId;
  let lotProductId;
  let noneProductId;
  let serialProductId;
  let lotId;
  let serialIds;
  let orderId;
  let materialIds;
  let issues;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  async function createProduct(code, trackingPolicy, classification = 'RAW_MATERIAL') {
    const created = await fixture.request('POST', '/api/products', fixture.tokens.admin, {
      code, name: code, unit: 'EA', baseUomCode: 'EA', priceCents: 100,
      inventoryClassification: classification, trackingPolicy,
    });
    assert.equal(created.status, 201, created.data.error);
    return created.data.id;
  }

  // products.valuation_method 没有任何生产写入入口，必须由直接 SQL 设置。
  function setValuationMethod(productId, method) {
    fixture.db.prepare('UPDATE products SET valuation_method=? WHERE id=?').run(method, productId);
  }

  function seedValuationBalance({ key, method, productId, warehouseId, lotId = null, serialId = null, quantity, valueCents }) {
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(
      balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity,value_cents=excluded.value_cents,updated_at=excluded.updated_at`
    ).run(key, method, productId, warehouseId, lotId, serialId, quantity, valueCents, new Date().toISOString());
  }

  // inventory_lot_balances 是批次维度的当前投影，其写入者是 postCanonicalTrackedLeg；
  // 原生库存单据的确认路径不写它。
  function seedLotBalance(warehouseId, productId, lotId, quantity) {
    fixture.db.prepare(`INSERT INTO inventory_lot_balances(warehouse_id,product_id,lot_id,quantity,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(warehouse_id,lot_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`
    ).run(warehouseId, productId, lotId, quantity, new Date().toISOString());
  }

  // 真实库存入仓：原生库存单据（OTHER_RECEIPT）+ 确认，走 canonical Writer。
  async function receiveStock(productId, quantity, extra = {}) {
    const doc = await fixture.request('POST', '/api/inventory/native-documents', fixture.tokens.warehouse, {
      docKind: 'OTHER_RECEIPT', businessDate: isoDate(),
      items: [{ productId, warehouseId: SOURCE_WAREHOUSE, quantity, ...extra }],
    });
    assert.equal(doc.status, 201, doc.data.error);
    const confirmed = await fixture.request('POST', `/api/inventory/native-documents/${doc.data.id}/confirm`, fixture.tokens.warehouse, {});
    assert.equal(confirmed.status, 200, confirmed.data.error);
  }

  async function createOutsourceBom(version, items) {
    const bom = await fixture.request('POST', '/api/engineering/boms', fixture.tokens.admin, {
      productId: parentId, version, purpose: 'OUTSOURCE', approvalStatus: 'APPROVED',
      effectiveFrom: isoDate(), items,
    });
    assert.equal(bom.status, 201, bom.data.error);
    const row = fixture.db.prepare('SELECT status,approval_status,purpose FROM boms WHERE id=?').get(bom.data.id);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.approval_status, 'APPROVED');
    assert.equal(row.purpose, 'OUTSOURCE');
    return bom.data.id;
  }

  async function releaseOrder(bomId, orderQuantity) {
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: parentId, orderQuantity, unit: 'EA',
      businessDate: isoDate(), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const id = order.data.id;
    // 用料快照必须在 DRAFT 阶段形成（Requirement §31.15；已批准 MC-REQ-03）：
    // 快照行取自已批准 OUTSOURCE BOM 的真实用料行。
    const bomItems = fixture.db.prepare('SELECT product_id FROM bom_items WHERE bom_id=? ORDER BY line_no').all(bomId);
    const snap = await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/material-list`, fixture.tokens.admin, {
      items: bomItems.map((item) => ({ productId: item.product_id, sourceWarehouseId: SOURCE_WAREHOUSE })),
    });
    assert.equal(snap.status, 200, snap.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' })).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fixture.tokens.admin, { action: 'RELEASE' })).status, 200);
    return id;
  }

  async function snapshotMaterials(orderId, productIds) {
    return Object.fromEntries(productIds.map((productId) => [
      productId,
      fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderId, productId).id,
    ]));
  }

  function positionQuantity(productId, warehouseId) {
    return Number(fixture.db.prepare(
      'SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND warehouse_id=? AND active=1',
    ).get(productId, warehouseId).q);
  }

  function expectedIdentity(item) {
    if (item.name === 'LOT') return { identityKey: `LOT:${lotId}`, lotId, serialId: null };
    if (item.name === 'NONE') return { identityKey: 'NONE', lotId: null, serialId: null };
    const serialId = item.identity.serialId;
    return { identityKey: `SERIAL:${serialId}`, lotId: null, serialId };
  }

  function readMutationBundle(item) {
    const mutations = fixture.db.prepare(
      "SELECT * FROM inventory_mutation_log WHERE source_type='OUTSOURCING_ISSUE' AND source_id=? ORDER BY id",
    ).all(item.eventId);
    const legs = fixture.db.prepare(
      "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' AND source_id=? ORDER BY direction,id",
    ).all(item.eventId);
    const tracked = legs.flatMap((leg) => fixture.db.prepare(
      'SELECT * FROM tracked_inventory_movements WHERE transaction_id=? ORDER BY id',
    ).all(leg.id));
    return { mutations, legs, tracked };
  }

  // 正向断言与负控共用同一验证器。这样负控证明的是实际承重断言，
  // 而不是另写一套只在负控中使用的镜像条件。
  function assertMutationBundle(item, bundle) {
    const expected = expectedIdentity(item);
    const expectedKey = `OUTSOURCING_ISSUE:${item.eventId}:${item.materialListId}:MOVE:${expected.identityKey}`;
    assert.equal(bundle.mutations.length, 1, `${item.name} 必须恰好一条内部 Mutation Log`);
    const mutation = bundle.mutations[0];
    assert.equal(mutation.source_type, 'OUTSOURCING_ISSUE');
    assert.equal(mutation.source_id, item.eventId);
    assert.equal(mutation.source_item_id, item.materialListId);
    assert.equal(mutation.movement_kind, 'MOVE');
    assert.equal(mutation.movement_group_id, item.eventId);
    assert.equal(mutation.idempotency_key, expectedKey, `${item.name} Mutation Key 必须包含自身事件、物料行、MOVE 与身份键`);

    assert.equal(bundle.legs.length, 2, `${item.name} 必须恰好一条 OUT 与一条 IN 物理腿`);
    const out = bundle.legs.find((leg) => leg.direction === 'OUT');
    const inbound = bundle.legs.find((leg) => leg.direction === 'IN');
    assert.ok(out && inbound, `${item.name} 的 OUT / IN 物理腿必须齐全`);
    assert.equal(mutation.out_inventory_transaction_id, out.id, `${item.name} Mutation Log 必须关联正确 OUT 腿`);
    assert.equal(mutation.in_inventory_transaction_id, inbound.id, `${item.name} Mutation Log 必须关联正确 IN 腿`);

    const fromIdentity = JSON.parse(mutation.from_position_identity_json);
    const toIdentity = JSON.parse(mutation.to_position_identity_json);
    for (const [label, identity, warehouseId] of [
      ['OUT', fromIdentity, SOURCE_WAREHOUSE], ['IN', toIdentity, WIP_WAREHOUSE],
    ]) {
      assert.equal(identity.productId, item.productId, `${item.name} ${label} 物理腿货品必须准确`);
      assert.equal(identity.warehouseId, warehouseId, `${item.name} ${label} 物理腿仓库必须准确`);
      assert.equal(identity.lotId, expected.lotId, `${item.name} ${label} 物理腿 lot_id 不得串身份`);
      assert.equal(identity.serialId, expected.serialId, `${item.name} ${label} 物理腿 serial_id 不得串身份`);
    }

    assert.equal(bundle.tracked.length, 2, `${item.name} 必须恰好两条跟踪腿`);
    for (const tracked of bundle.tracked) {
      assert.equal(tracked.source_id, item.eventId);
      assert.equal(tracked.source_item_id, item.materialListId);
      assert.equal(tracked.product_id, item.productId);
      assert.equal(tracked.lot_id, expected.lotId, `${item.name} 跟踪腿 lot_id 不得串身份`);
      assert.equal(tracked.serial_id, expected.serialId, `${item.name} 跟踪腿 serial_id 不得串身份`);
    }
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp7a-m-');
    // 供应商配置 WIP 仓（委外发料的企业所有权仓位）。
    const qualified = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: WIP_WAREHOUSE,
    });
    assert.equal(qualified.status, 200, qualified.data.error);

    parentId = await createProduct(PARENT_CODE, 'NONE', 'FINISHED_GOOD');
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: parentId, effectiveFrom: isoDate(-30) }]);
    lotProductId = await createProduct(LOT_CODE, 'LOT');
    noneProductId = await createProduct(NONE_CODE, 'NONE');
    serialProductId = await createProduct(SERIAL_CODE, 'SERIAL');
    setValuationMethod(lotProductId, 'LOT_SPECIFIC_POOL');
    setValuationMethod(serialProductId, 'SPECIFIC_SERIAL');

    const lot = await fixture.request('POST', '/api/inventory-lots', fixture.tokens.warehouse, {
      productId: lotProductId, lotCode: 'WP7A-M-LOT-001',
    });
    assert.equal(lot.status, 201, lot.data.error);
    lotId = lot.data.id;

    serialIds = [];
    for (const serialNumber of ['WP7A-M-SN-001', 'WP7A-M-SN-002']) {
      const serial = await fixture.request('POST', '/api/inventory-serials', fixture.tokens.warehouse, {
        productId: serialProductId, serialNumber, warehouseId: SOURCE_WAREHOUSE,
      });
      assert.equal(serial.status, 201, serial.data.error);
      serialIds.push(serial.data.id);
    }

    await receiveStock(lotProductId, 100, { lotId });
    await receiveStock(noneProductId, 100);
    await receiveStock(serialProductId, 1, { serialId: serialIds[0] });
    await receiveStock(serialProductId, 1, { serialId: serialIds[1] });
    seedLotBalance(SOURCE_WAREHOUSE, lotProductId, lotId, 100);

    seedValuationBalance({
      key: `LOT:${SOURCE_WAREHOUSE}:${lotProductId}:${lotId}`, method: 'LOT_SPECIFIC_POOL',
      productId: lotProductId, warehouseId: SOURCE_WAREHOUSE, lotId, quantity: 100, valueCents: 10000,
    });
    seedValuationBalance({
      key: `NONE:${SOURCE_WAREHOUSE}:${noneProductId}`, method: 'MOVING_AVERAGE',
      productId: noneProductId, warehouseId: SOURCE_WAREHOUSE, quantity: 100, valueCents: 10000,
    });
    for (const serialId of serialIds) {
      seedValuationBalance({
        key: `SERIAL:${serialId}`, method: 'SPECIFIC_SERIAL',
        productId: serialProductId, warehouseId: SOURCE_WAREHOUSE, serialId, quantity: 1, valueCents: 1000,
      });
    }

    // 一个订单、三条物料行：LOT、NONE、SERIAL。
    const bomId = await createOutsourceBom('WP7A-M', [
      { productId: lotProductId, quantity: 2 },
      { productId: noneProductId, quantity: 2 },
      { productId: serialProductId, quantity: 1 },
    ]);
    orderId = await releaseOrder(bomId, 10);
    materialIds = await snapshotMaterials(orderId, [lotProductId, noneProductId, serialProductId]);

    // 四次**独立**的合法发料：LOT 一次、NONE 一次、SERIAL 两个不同序列号各一次。
    // SERIAL 每次数量严格为 1 —— 不做批量发料，也不发数量为 2 的 SERIAL。
    const plan = [
      { name: 'LOT', productId: lotProductId, materialListId: materialIds[lotProductId], quantity: 3, identity: { lotId }, key: 'wp7a-m-lot' },
      { name: 'NONE', productId: noneProductId, materialListId: materialIds[noneProductId], quantity: 4, identity: {}, key: 'wp7a-m-none' },
      { name: 'SERIAL-1', productId: serialProductId, materialListId: materialIds[serialProductId], quantity: 1, identity: { serialId: serialIds[0] }, key: 'wp7a-m-sn1' },
      { name: 'SERIAL-2', productId: serialProductId, materialListId: materialIds[serialProductId], quantity: 1, identity: { serialId: serialIds[1] }, key: 'wp7a-m-sn2' },
    ];
    issues = [];
    for (const step of plan) {
      const response = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: step.materialListId, quantity: step.quantity, issuedDate: isoDate(),
        idempotencyKey: step.key, ...step.identity,
      });
      assert.equal(response.status, 201, `${step.name} 发料必须成功：${response.data.error}`);
      issues.push({ ...step, eventId: response.data.id });
    }
  });

  after(async () => fixture.close());

  test('G03-M1 四次发料具有四个独立的业务事件 ID，且物理流水挂在各自事件下', () => {
    assert.equal(issues.length, 4, '必须恰好四次独立发料');
    const eventIds = issues.map((item) => item.eventId);
    assert.equal(new Set(eventIds).size, 4, '四次发料必须产生四个不同的业务事件 ID');
    for (const item of issues) {
      const row = fixture.db.prepare('SELECT * FROM outsourcing_issues WHERE id=?').get(item.eventId);
      assert.ok(row, '每次发料都必须落一张委外发料单');
      assert.equal(row.order_id, orderId);
      assert.equal(row.material_list_id, item.materialListId);
      assert.equal(Number(row.quantity), item.quantity);
      assert.equal(row.idempotency_key, item.key);
      const legs = fixture.db.prepare(
        "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' AND source_id=?",
      ).all(item.eventId);
      assert.equal(legs.length, 2, `${item.name} 发料必须恰好两条物理流水（OUT + IN）`);
      assertMutationBundle(item, readMutationBundle(item));
    }
    assert.equal(
      fixture.db.prepare("SELECT COUNT(*) n FROM outsourcing_issues WHERE order_id=?").get(orderId).n, 4,
      '委外订单下必须恰好四张发料单',
    );
  });

  test('G03-M2 每个合法 MOVE 恰好一条 OUT、一条 IN，总共八条物理腿', () => {
    const legs = fixture.db.prepare(
      "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' ORDER BY created_at,id",
    ).all();
    assert.equal(legs.length, 8, '四次 MOVE 发料必须恰好八条物理腿');
    for (const item of issues) {
      const own = legs.filter((leg) => leg.source_id === item.eventId);
      assert.equal(own.length, 2, `${item.name} 必须恰好两条物理腿`);
      assert.equal(own.filter((leg) => leg.direction === 'OUT').length, 1, `${item.name} 必须恰好一条 OUT 腿`);
      assert.equal(own.filter((leg) => leg.direction === 'IN').length, 1, `${item.name} 必须恰好一条 IN 腿`);
      const out = own.find((leg) => leg.direction === 'OUT');
      const inbound = own.find((leg) => leg.direction === 'IN');
      assert.equal(out.warehouse_id, SOURCE_WAREHOUSE, `${item.name} 的 OUT 腿必须来自来源仓`);
      assert.equal(inbound.warehouse_id, WIP_WAREHOUSE, `${item.name} 的 IN 腿必须进入供应商 WIP 仓`);
      // quantity_change 存绝对值，方向由 direction 列承担。
      assert.equal(Number(out.quantity_change), Number(item.quantity));
      assert.equal(Number(inbound.quantity_change), Number(item.quantity));
    }
  });

  test('G03-M3 物料行与身份键精确对应，WIP 身份余额与效果记录按身份分域', () => {
    const expected = [
      { materialListId: materialIds[lotProductId], identityKey: `LOT:${lotId}`, quantity: 3, eventId: issues[0].eventId },
      { materialListId: materialIds[noneProductId], identityKey: 'NONE', quantity: 4, eventId: issues[1].eventId },
      { materialListId: materialIds[serialProductId], identityKey: `SERIAL:${serialIds[0]}`, quantity: 1, eventId: issues[2].eventId },
      { materialListId: materialIds[serialProductId], identityKey: `SERIAL:${serialIds[1]}`, quantity: 1, eventId: issues[3].eventId },
    ];
    const balances = fixture.db.prepare(
      'SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id IN (?,?,?) ORDER BY material_list_id,identity_key',
    ).all(materialIds[lotProductId], materialIds[noneProductId], materialIds[serialProductId]);
    assert.equal(balances.length, 4, '四次发料必须产生四条身份余额（LOT / NONE / SERIAL-1 / SERIAL-2）');
    for (const item of expected) {
      const balance = balances.find((row) => row.material_list_id === item.materialListId && row.identity_key === item.identityKey);
      assert.ok(balance, `必须存在身份键 ${item.identityKey} 的余额行`);
      assert.equal(Number(balance.supplied_quantity), item.quantity, `${item.identityKey} 的供给量必须精确对应`);
      assert.equal(Number(balance.consumed_quantity), 0);
      assert.equal(Number(balance.available_quantity), item.quantity);
      assert.equal(balance.evidence_state, item.identityKey === 'NONE' ? 'QUANTITY_ONLY' : 'TRACKED');
    }
    // 不串行：LOT 物料行不得承载 SERIAL 身份，NONE 物料行不得承载任何跟踪身份。
    for (const balance of balances) {
      if (balance.material_list_id === materialIds[lotProductId]) assert.equal(balance.identity_key, `LOT:${lotId}`);
      if (balance.material_list_id === materialIds[noneProductId]) assert.equal(balance.identity_key, 'NONE');
      if (balance.material_list_id === materialIds[serialProductId]) {
        assert.ok(serialIds.includes(balance.identity_key.slice('SERIAL:'.length)), 'SERIAL 物料行只允许承载本单的两个序列号身份');
      }
    }
    const effects = fixture.db.prepare(
      'SELECT * FROM outsourcing_wip_identity_effects WHERE material_list_id IN (?,?,?) ORDER BY created_at,id',
    ).all(materialIds[lotProductId], materialIds[noneProductId], materialIds[serialProductId]);
    assert.equal(effects.length, 4, '四次发料必须产生四条身份效果记录');
    for (const item of expected) {
      const effect = effects.find((row) => row.business_event_id === item.eventId);
      assert.ok(effect, `事件 ${item.eventId} 必须有一条身份效果记录`);
      assert.equal(effect.material_list_id, item.materialListId);
      assert.equal(effect.identity_key, item.identityKey, '身份效果必须挂在正确的身份键上');
      assert.equal(effect.effect_direction, 'SUPPLY');
      assert.equal(Number(effect.signed_quantity), item.quantity);

      const mutation = readMutationBundle(issues.find((issue) => issue.eventId === item.eventId)).mutations[0];
      const fromIdentity = JSON.parse(mutation.from_position_identity_json);
      const toIdentity = JSON.parse(mutation.to_position_identity_json);
      const expectedIdentityRow = expectedIdentity(issues.find((issue) => issue.eventId === item.eventId));
      assert.equal(fromIdentity.lotId, expectedIdentityRow.lotId);
      assert.equal(fromIdentity.serialId, expectedIdentityRow.serialId);
      assert.equal(toIdentity.lotId, expectedIdentityRow.lotId);
      assert.equal(toIdentity.serialId, expectedIdentityRow.serialId);
    }
  });

  test('G03-M4 每条物理腿都有正确关联的跟踪记录与 POSTED 估值记录', () => {
    const legs = fixture.db.prepare(
      "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' ORDER BY created_at,id",
    ).all();
    assert.equal(legs.length, 8);
    for (const leg of legs) {
      const tracked = fixture.db.prepare(
        'SELECT * FROM tracked_inventory_movements WHERE transaction_id=?',
      ).all(leg.id);
      assert.equal(tracked.length, 1, `物理腿 ${leg.id} 必须恰好一条跟踪记录`);
      assert.equal(tracked[0].source_type, 'OUTSOURCING_ISSUE');
      assert.equal(tracked[0].source_id, leg.source_id, '跟踪记录必须关联同一业务事件');
      assert.equal(tracked[0].product_id, leg.product_id);
      assert.equal(tracked[0].warehouse_id, leg.warehouse_id);
      assert.equal(Number(tracked[0].quantity), Math.abs(Number(leg.quantity_change)));
      const item = issues.find((issue) => issue.eventId === leg.source_id);
      const expected = expectedIdentity(item);
      assert.equal(tracked[0].source_item_id, item.materialListId);
      assert.equal(tracked[0].lot_id, expected.lotId, `${item.name} 跟踪腿 lot_id 必须匹配事件身份`);
      assert.equal(tracked[0].serial_id, expected.serialId, `${item.name} 跟踪腿 serial_id 必须匹配事件身份`);
      const valuation = fixture.db.prepare(
        "SELECT * FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'",
      ).all(leg.id);
      assert.equal(valuation.length, 1, `物理腿 ${leg.id} 必须恰好一条 POSTED 估值记录`);
      assert.equal(valuation[0].source_type, 'OUTSOURCING_ISSUE');
      assert.equal(valuation[0].source_id, leg.source_id, '估值记录必须关联同一业务事件');
      assert.equal(valuation[0].product_id, leg.product_id);
      assert.equal(leg.valuation_status, 'VALUED', '物理腿必须完成权威估值');
    }
  });

  test('G03-M5 来源仓与供应商 WIP 仓数量守恒，企业所有权保持不变', () => {
    const plan = [
      { productId: lotProductId, issued: 3, initial: 100 },
      { productId: noneProductId, issued: 4, initial: 100 },
      { productId: serialProductId, issued: 2, initial: 2 },
    ];
    for (const item of plan) {
      const source = positionQuantity(item.productId, SOURCE_WAREHOUSE);
      const wip = positionQuantity(item.productId, WIP_WAREHOUSE);
      assert.equal(source, item.initial - item.issued, '来源仓数量必须按发料量扣减');
      assert.equal(wip, item.issued, '供应商 WIP 仓数量必须等于累计发料量');
      assert.equal(source + wip, item.initial, '来源仓与 WIP 仓合计必须守恒');
      const positions = fixture.db.prepare(
        'SELECT * FROM inventory WHERE product_id=? AND active=1',
      ).all(item.productId);
      assert.ok(positions.length >= 2, '每个物料在来源仓与 WIP 仓都必须有 canonical 仓位');
      for (const position of positions) {
        assert.equal(position.owner_type, 'ENTERPRISE', '企业所有权不得改变');
        assert.equal(position.owner_id, null, '企业所有权不得挂到供应商或第三方');
      }
    }
  });

  test('G03-M7 负控：错绑 Mutation Key 或 LOT/SERIAL 身份会被同一事件验证器检出', () => {
    const lotIssue = issues.find((item) => item.name === 'LOT');
    const serial1 = issues.find((item) => item.name === 'SERIAL-1');
    const serial2 = issues.find((item) => item.name === 'SERIAL-2');

    const wrongKey = structuredClone(readMutationBundle(lotIssue));
    wrongKey.mutations[0].idempotency_key = readMutationBundle(serial1).mutations[0].idempotency_key;
    assert.throws(
      () => assertMutationBundle(lotIssue, wrongKey),
      /Mutation Key 必须包含自身事件、物料行、MOVE 与身份键/,
      '把 LOT 事件错绑到 SERIAL-1 Mutation Key 时，正向承重断言必须失败',
    );

    const wrongPhysicalIdentity = structuredClone(readMutationBundle(serial1));
    const wrongFrom = JSON.parse(wrongPhysicalIdentity.mutations[0].from_position_identity_json);
    wrongFrom.serialId = serial2.identity.serialId;
    wrongPhysicalIdentity.mutations[0].from_position_identity_json = JSON.stringify(wrongFrom);
    assert.throws(
      () => assertMutationBundle(serial1, wrongPhysicalIdentity),
      /OUT 物理腿 serial_id 不得串身份/,
      '把 SERIAL-1 的 OUT 物理腿错绑到 SERIAL-2 时必须失败',
    );

    const wrongTrackedIdentity = structuredClone(readMutationBundle(serial1));
    wrongTrackedIdentity.tracked[0].serial_id = serial2.identity.serialId;
    assert.throws(
      () => assertMutationBundle(serial1, wrongTrackedIdentity),
      /跟踪腿 serial_id 不得串身份/,
      '把 SERIAL-1 跟踪腿错绑到 SERIAL-2 时必须失败',
    );
  });

  test('G03-M6 同一外部幂等键同内容重放不产生第二次物理动作，异内容稳定拒绝且业务事实零变化', async () => {
    const lotIssue = issues[0];
    const body = {
      materialListId: lotIssue.materialListId, quantity: lotIssue.quantity,
      issuedDate: isoDate(), idempotencyKey: lotIssue.key, lotId,
    };
    const before = snapshotTables(fixture.db, G03_BUSINESS_FACT_TABLES);
    const legsBefore = fixture.db.prepare(
      "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE'",
    ).get().n;

    const replay = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, body);
    assert.equal(replay.status, 200, '同键同内容重放必须返回 200');
    assert.equal(replay.data.replayed, true, '同键同内容必须标记为重放');
    assert.equal(
      fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE'").get().n,
      legsBefore, '重放不得产生第二次物理动作',
    );
    assert.deepEqual(
      changedTables(before, snapshotTables(fixture.db, G03_BUSINESS_FACT_TABLES)), [],
      '重放不得改变任何 G03 业务事实',
    );

    // 异内容：同一外部幂等键，不同数量 → 稳定拒绝，且业务事实逐字段零变化。
    const beforeConflict = snapshotTables(fixture.db, G03_BUSINESS_FACT_TABLES);
    const conflict = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
      ...body, quantity: lotIssue.quantity + 1,
    });
    assert.equal(conflict.status, 409, '同键异内容必须稳定拒绝');
    assert.deepEqual(
      changedTables(beforeConflict, snapshotTables(fixture.db, G03_BUSINESS_FACT_TABLES)), [],
      '同键异内容拒绝后 G03 完整业务事实必须逐字段零变化',
    );
  });
});
