// M1C-WP7-A — M1-Core 首期 Gate 补证套件（G03 / G04 / G06）。
//
// Contract source:
//   - Requirement docs/requirements/procurement-outsourcing.md §31.13
//     MC-REQ-06..MC-REQ-11、MC-REQ-15
//   - Active Design docs/design/procurement-outsourcing-m1-core.md
//     §5.3..§5.5、§9.1..§9.5、§13.1（M1C-G03 / G04 / G06 的成功与拒绝断言）
//
// 本文件**只补断言位**，不新增业务功能、不改变业务合同、不修改核心实现。
// WP2–WP6 已交付的 focused 套件覆盖了各 Gate 的主链路，但 §13.1 明列的下列
// 断言此前没有断言位：
//   G03 —— LOT / SERIAL / NONE 三类身份各自成键；缺仓、库存不足、UOM 不符、
//          身份异常四类拒绝分支；幂等重放与异内容重放。
//   G04 —— 多批次部分完工的增量倒冲；成品估值 Movement + Balance 双写；
//          材料成本按 canonical 位置口径（非全局平均价）；加工费 provisional 证据。
//   G06 —— 来源级拒绝后 AP / 凭证 / 库存 / 估值 / 成本证据 / 单据逐字段零变化。
//
// 证据分级：正向来源一律经生产 HTTP API（L1）。只有三处使用直接 SQL（L3），
// 且都是没有生产写入入口的字段：
//   1) `products.valuation_method` —— 无任何 HTTP 路由写入它；
//   2) `inventory_valuation_balances` 种子行 —— 估值方法与跟踪策略的绑定关系
//      由应用层校验，种子行用于给权威估值一个非零账面价值；
//   3) `inventory_lot_balances` 种子行 —— 批次维度的当前投影，其写入者是
//      postCanonicalTrackedLeg，原生库存单据确认路径不写它。
// 其余（LOT / SERIAL 身份、库存入仓、委外 BOM、委外订单、完工通知、收货、
// 发料 / 补料 / 退料、加工费账单）全部经生产 API 造数。
//
// 本套件拥有一次性临时 SQLite 文件，不触碰任何项目 / 开发 / 生产数据库，
// 也不连接 MySQL。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource,
} from './test-support/procurement-http-fixture.js';

const PARENT_CODE = 'WP7A-FG';
const MATERIAL_LOT = 'WP7A-LOT';
const MATERIAL_SERIAL = 'WP7A-SERIAL';
const MATERIAL_COST = 'WP7A-COST';
const MATERIAL_G06 = 'WP7A-G06-MAT';
const MATERIAL_UOM = 'WP7A-UOM';

describe('M1C-WP7-A — M1-Core 首期 Gate 补证（G03 / G04 / G06）', () => {
  let fixture;
  // 委外成品（父项货品）的真实 id：委外订单与 OUTSOURCE BOM 都按 id 引用它。
  let parentId;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  const countRejects = (entityType, entityId = null) => fixture.db.prepare(
    "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id IS ?",
  ).get(entityType, entityId).n;

  async function createProduct(code, trackingPolicy, classification = 'RAW_MATERIAL') {
    const created = await fixture.request('POST', '/api/products', fixture.tokens.admin, {
      code, name: code, unit: 'EA', baseUomCode: 'EA', priceCents: 100,
      inventoryClassification: classification, trackingPolicy,
    });
    assert.equal(created.status, 201, created.data.error);
    return created.data.id;
  }

  // products.valuation_method 没有任何生产写入入口，必须由直接 SQL 设置，
  // 否则 valuationMethod() 抛「货品追踪策略与财务估值方法不兼容」。
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

  // inventory_lot_balances 是批次维度的当前投影，其写入者是
  // postCanonicalTrackedLeg；原生库存单据的确认路径不写它。不种这一行，
  // 委外 LOT 出库会按 LOT_NOT_AVAILABLE 正确地 fail closed。
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
      items: [{ productId, warehouseId: 'warehouse-001', quantity, ...extra }],
    });
    assert.equal(doc.status, 201, doc.data.error);
    const confirmed = await fixture.request('POST', `/api/inventory/native-documents/${doc.data.id}/confirm`, fixture.tokens.warehouse, {});
    assert.equal(confirmed.status, 200, confirmed.data.error);
    return doc.data.id;
  }

  // 生产 API 创建已批准、已生效、用途为 OUTSOURCE 的 BOM。
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
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' })).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fixture.tokens.admin, { action: 'RELEASED' })).status, 200);
    return id;
  }

  async function snapshotMaterials(orderId, productIds) {
    const snap = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: productIds.map((productId) => ({ productId, sourceWarehouseId: 'warehouse-001' })),
    });
    assert.equal(snap.status, 200, snap.data.error);
    return Object.fromEntries(productIds.map((productId) => [
      productId,
      fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderId, productId).id,
    ]));
  }

  // 一个委外订单的全部物料事实快照：用于「拒绝后逐字段零变化」断言。
  function materialFacts(orderId) {
    return JSON.stringify({
      materials: fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? ORDER BY id').all(orderId),
      balances: fixture.db.prepare(
        'SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id IN (SELECT id FROM outsourcing_material_list WHERE order_id=?) ORDER BY material_list_id,identity_key',
      ).all(orderId),
      transactions: fixture.db.prepare(
        "SELECT * FROM inventory_transactions WHERE source_id IN (SELECT id FROM outsourcing_issues WHERE order_id=?) ORDER BY id",
      ).all(orderId),
    });
  }

  async function qualifySupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp7a-');
    await qualifySupplier();
    // 委外成品（父项货品）：委外订单与 OUTSOURCE BOM 的父项。
    parentId = await createProduct(PARENT_CODE, 'NONE', 'FINISHED_GOOD');
  });
  after(async () => fixture.close());

  // ------------------------------------------------------------------ G03 ---
  describe('G03 — 物料身份分类与拒绝分支', () => {
    let lotProductId;
    let serialProductId;
    let lotId;
    let serialId;
    let orderId;
    let materials;

    before(async () => {
      lotProductId = await createProduct(MATERIAL_LOT, 'LOT');
      serialProductId = await createProduct(MATERIAL_SERIAL, 'SERIAL');
      setValuationMethod(lotProductId, 'LOT_SPECIFIC_POOL');
      setValuationMethod(serialProductId, 'SPECIFIC_SERIAL');

      const lot = await fixture.request('POST', '/api/inventory-lots', fixture.tokens.warehouse, {
        productId: lotProductId, lotCode: 'WP7A-LOT-001',
      });
      assert.equal(lot.status, 201, lot.data.error);
      lotId = lot.data.id;

      const serial = await fixture.request('POST', '/api/inventory-serials', fixture.tokens.warehouse, {
        productId: serialProductId, serialNumber: 'WP7A-SN-001', warehouseId: 'warehouse-001',
      });
      assert.equal(serial.status, 201, serial.data.error);
      serialId = serial.data.id;

      await receiveStock(lotProductId, 100, { lotId });
      await receiveStock(serialProductId, 1, { serialId });
      seedLotBalance('warehouse-001', lotProductId, lotId, 100);

      seedValuationBalance({
        key: `LOT:warehouse-001:${lotProductId}:${lotId}`, method: 'LOT_SPECIFIC_POOL',
        productId: lotProductId, warehouseId: 'warehouse-001', lotId, quantity: 100, valueCents: 10000,
      });
      seedValuationBalance({
        key: `SERIAL:${serialId}`, method: 'SPECIFIC_SERIAL',
        productId: serialProductId, warehouseId: 'warehouse-001', serialId, quantity: 1, valueCents: 1000,
      });

      const bomId = await createOutsourceBom('WP7A-G03', [
        { productId: lotProductId, quantity: 2 },
        { productId: serialProductId, quantity: 1 },
      ]);
      orderId = await releaseOrder(bomId, 10);
      materials = await snapshotMaterials(orderId, [lotProductId, serialProductId]);
    });

    test('G03-1 LOT / SERIAL 身份各自成键，跟踪腿数等于实际物理腿数，企业所有权不变', async () => {
      const lotIssue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materials[lotProductId], quantity: 3, issuedDate: isoDate(), idempotencyKey: 'wp7a-lot-1', lotId,
      });
      assert.equal(lotIssue.status, 201, lotIssue.data.error);

      const serialIssue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materials[serialProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-serial-1', serialId,
      });
      assert.equal(serialIssue.status, 201, serialIssue.data.error);

      // 每个 MOVE 必须成对（OUT + IN），跟踪腿数 == 物理腿数。
      for (const [issue, productId] of [[lotIssue, lotProductId], [serialIssue, serialProductId]]) {
        const movements = fixture.db.prepare(
          "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' AND source_id=?",
        ).all(issue.data.id);
        assert.equal(movements.length, 2, 'MOVE 腿必须成对');
        assert.equal(movements.filter((m) => m.direction === 'OUT').length, 1);
        assert.equal(movements.filter((m) => m.direction === 'IN').length, 1);
        const tracked = fixture.db.prepare(
          "SELECT COUNT(*) n FROM tracked_inventory_movements WHERE source_type='OUTSOURCING_ISSUE' AND source_id=?",
        ).get(issue.data.id).n;
        assert.equal(tracked, movements.length, '跟踪腿数必须等于实际物理腿数');
        for (const movement of movements) {
          const valuation = fixture.db.prepare(
            "SELECT status FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'",
          ).get(movement.id);
          assert.ok(valuation, '每条物理腿必须有 POSTED 的权威估值');
        }
        // 企业所有权不变：来源仓与 WIP 仓的 canonical 仓位都属于企业。
        const positions = fixture.db.prepare(
          'SELECT * FROM inventory WHERE product_id=? AND warehouse_id IN (?,?)',
        ).all(productId, 'warehouse-001', 'warehouse-002');
        assert.ok(positions.length >= 2, '来源仓与 WIP 仓都必须有 canonical 仓位');
        for (const position of positions) {
          assert.equal(position.owner_type, 'ENTERPRISE', '企业所有权不得改变');
          assert.equal(position.owner_id, null, '企业所有权不得改变');
        }
      }

      // 身份证据余额按身份键分行，LOT 与 SERIAL 互不混淆。
      const lotBalance = fixture.db.prepare(
        'SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?',
      ).all(materials[lotProductId]);
      assert.equal(lotBalance.length, 1);
      assert.equal(lotBalance[0].identity_key, `LOT:${lotId}`);
      assert.equal(lotBalance[0].identity_type, 'LOT');
      assert.equal(lotBalance[0].lot_id, lotId);
      assert.equal(lotBalance[0].serial_id, null);
      assert.equal(lotBalance[0].evidence_state, 'TRACKED');
      assert.equal(Number(lotBalance[0].supplied_quantity), 3);

      const serialBalance = fixture.db.prepare(
        'SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?',
      ).all(materials[serialProductId]);
      assert.equal(serialBalance.length, 1);
      assert.equal(serialBalance[0].identity_key, `SERIAL:${serialId}`);
      assert.equal(serialBalance[0].identity_type, 'SERIAL');
      assert.equal(serialBalance[0].serial_id, serialId);
      assert.equal(serialBalance[0].lot_id, null);
      assert.equal(serialBalance[0].evidence_state, 'TRACKED');
      assert.equal(Number(serialBalance[0].supplied_quantity), 1);
    });

    test('G03-2 身份异常一律 409 且拒绝审计恰好一条、事实零变化', async () => {
      const before = materialFacts(orderId);
      const rejectsBefore = countRejects('OUTSOURCING_ORDER', orderId);

      const cases = [
        { name: 'LOT 物料缺少批次身份', body: { materialListId: materials[lotProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-lot' }, code: 'WIP_IDENTITY_EVIDENCE_MISSING' },
        { name: 'SERIAL 物料数量不为 1', body: { materialListId: materials[serialProductId], quantity: 2, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-serial-qty', serialId }, code: 'WIP_IDENTITY_POLICY_MISMATCH' },
        { name: 'SERIAL 物料缺少序列号身份', body: { materialListId: materials[serialProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-serial-id' }, code: 'WIP_IDENTITY_EVIDENCE_MISSING' },
        { name: 'SERIAL 物料携带批次身份', body: { materialListId: materials[serialProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-serial-lot', serialId, lotId }, code: 'WIP_IDENTITY_EVIDENCE_MISSING' },
      ];
      for (const item of cases) {
        const response = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, item.body);
        assert.equal(response.status, 409, `${item.name} 必须 409，实际 ${response.status}`);
        assert.equal(response.data.code, item.code, item.name);
      }
      assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + cases.length,
        '每个业务门禁拒绝恰好新增 1 条拒绝审计');
      assert.equal(materialFacts(orderId), before, '身份异常拒绝后库存、身份余额与物料行必须逐字段零变化');
    });

    test('G03-3 缺仓与库存不足一律 409 且拒绝审计恰好一条、事实零变化', async () => {
      // 缺仓：供应商未配置委外 WIP 仓（异常样本构造，构造后立即复原）。
      const before = materialFacts(orderId);
      const rejectsBefore = countRejects('OUTSOURCING_ORDER', orderId);
      fixture.db.prepare("UPDATE suppliers SET supplier_wip_warehouse_id=NULL WHERE id='supplier-001'").run();
      const noWarehouse = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materials[lotProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-no-warehouse', lotId,
      });
      fixture.db.prepare("UPDATE suppliers SET supplier_wip_warehouse_id='warehouse-002' WHERE id='supplier-001'").run();
      assert.equal(noWarehouse.status, 409, '缺 WIP 仓必须 409');
      assert.equal(noWarehouse.data.code, 'OUTSOURCING_WIP_WAREHOUSE_MISSING');
      assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 1);
      assert.equal(materialFacts(orderId), before, '缺仓拒绝后事实必须逐字段零变化');

      // 库存不足：退料数量超过供应商 WIP 剩余。
      const issued = Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(materials[lotProductId]).q);
      const overReturn = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.outsourcing, {
        materialListId: materials[lotProductId], quantity: issued + 1, returnDate: isoDate(), idempotencyKey: 'wp7a-over-return', lotId,
      });
      assert.equal(overReturn.status, 409, '库存不足必须 409');
      assert.equal(overReturn.data.code, 'OUTSOURCING_WIP_INSUFFICIENT');
      assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 2);
      assert.equal(materialFacts(orderId), before, '库存不足拒绝后事实必须逐字段零变化');
    });

    test('G03-4 UOM 不符一律 409 且拒绝审计恰好一条', async () => {
      const uomProductId = await createProduct(MATERIAL_UOM, 'NONE');
      const bomId = await createOutsourceBom('WP7A-UOM', [{ productId: uomProductId, quantity: 1 }]);
      const uomOrderId = await releaseOrder(bomId, 10);
      const uomMaterials = await snapshotMaterials(uomOrderId, [uomProductId]);
      const material = fixture.db.prepare('SELECT unit FROM outsourcing_material_list WHERE id=?').get(uomMaterials[uomProductId]);
      assert.equal(material.unit, 'EA');

      // 快照建立后变更产品基础单位（此时该产品尚无库存交易，允许变更）。
      const patched = await fixture.request('PATCH', `/api/products/${uomProductId}`, fixture.tokens.admin, { baseUomCode: 'BOX' });
      assert.equal(patched.status, 200, patched.data.error);

      const rejectsBefore = countRejects('OUTSOURCING_ORDER', uomOrderId);
      const response = await fixture.request('POST', `/api/procurement/outsourcing/orders/${uomOrderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: uomMaterials[uomProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-uom-mismatch',
      });
      assert.equal(response.status, 409, 'UOM 不符必须 409');
      assert.equal(response.data.code, 'OUTSOURCING_WIP_UOM_MISMATCH');
      assert.equal(countRejects('OUTSOURCING_ORDER', uomOrderId), rejectsBefore + 1);
      assert.equal(Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(uomMaterials[uomProductId]).q), 0);
    });

    test('G03-5 同键同内容幂等重放不产生第二次物理动作，同键异内容一律拒绝', async () => {
      const body = {
        materialListId: materials[lotProductId], quantity: 2, issuedDate: isoDate(), idempotencyKey: 'wp7a-idem-1', lotId,
      };
      const first = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, body);
      assert.equal(first.status, 201, first.data.error);

      const movementsAfterFirst = fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' AND source_id=?",
      ).get(first.data.id).n;
      const issuedAfterFirst = Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(materials[lotProductId]).q);

      const replay = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, body);
      assert.equal(replay.status, 200, '同键同内容必须幂等重放');
      assert.equal(replay.data.replayed, true);
      assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' AND source_id=?").get(first.data.id).n,
        movementsAfterFirst, '重放不得产生第二次物理动作');
      assert.equal(Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(materials[lotProductId]).q),
        issuedAfterFirst, '重放不得改写已发数量');

      const different = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        ...body, quantity: 5,
      });
      assert.equal(different.status, 409, '同键异内容必须拒绝');
      assert.equal(Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(materials[lotProductId]).q),
        issuedAfterFirst, '异内容重放不得改写已发数量');
      assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_ISSUE' AND source_id=?").get(first.data.id).n,
        movementsAfterFirst, '异内容重放不得产生物理动作');
    });
  });

  // ------------------------------------------------------------------ G04 ---
  describe('G04 — 多批次完工、增量倒冲与成品估值', () => {
    let costProductId;
    let orderId;
    let materialListId;

    before(async () => {
      costProductId = await createProduct(MATERIAL_COST, 'NONE');
      await receiveStock(costProductId, 100);
      seedValuationBalance({
        key: `NONE:warehouse-001:${costProductId}`, method: 'MOVING_AVERAGE',
        productId: costProductId, warehouseId: 'warehouse-001', quantity: 100, valueCents: 10000,
      });

      // 第三个仓位的同产品对照成本：若实现退化为全局平均价，
      // 倒冲材料账面价值会显著偏离 canonical 位置口径。
      const warehouse = await fixture.request('POST', '/api/warehouses', fixture.tokens.admin, {
        code: 'WH-WP7A-003', name: 'WP7A 成本对照仓',
      });
      assert.equal(warehouse.status, 201, warehouse.data.error);
      seedValuationBalance({
        key: `NONE:${warehouse.data.id}:${costProductId}`, method: 'MOVING_AVERAGE',
        productId: costProductId, warehouseId: warehouse.data.id, quantity: 100, valueCents: 99999,
      });

      const bomId = await createOutsourceBom('WP7A-G04', [{ productId: costProductId, quantity: 0.005 }]);
      orderId = await releaseOrder(bomId, 100);
      const materials = await snapshotMaterials(orderId, [costProductId]);
      materialListId = materials[costProductId];

      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId, quantity: 10, issuedDate: isoDate(), idempotencyKey: 'wp7a-g04-issue',
      });
      assert.equal(issue.status, 201, issue.data.error);
    });

    test('G04-1 多批次部分完工的增量倒冲正确、无双扣无双收，成品估值 Movement + Balance 双写', async () => {
      const batches = [];
      for (const batch of [1, 2]) {
        const source = await prepareOutsourcingReceiptSource(fixture, orderId, 30, `wp7a-g04-b${batch}`);
        const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
          orderId, quantity: 30, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
          sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 30000,
          ...outsourcingReceiptBody(source, 30, 30000),
        }, { 'idempotency-key': `wp7a-g04-receipt-${batch}` });
        assert.equal(receipt.status, 201, receipt.data.error);

        const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
          fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `wp7a-g04-effect-${batch}` });
        assert.equal(effected.status, 200, effected.data.error);
        batches.push({ receiptId: receipt.data.id, ...effected.data });
      }

      // 增量倒冲：每单位用量 0.005 × 累计合格收货量。
      const material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialListId);
      assert.ok(Math.abs(Number(material.backflushed_quantity) - 0.3) < 1e-9,
        `两批各 30 的累计倒冲必须为 0.005 × 60 = 0.30，实际 ${material.backflushed_quantity}`);

      // 无双扣：倒冲物理腿恰好 2 条，且都是 OUT。
      const backflushLegs = fixture.db.prepare(
        "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_BACKFLUSH' AND direction='OUT'",
      ).all();
      assert.equal(backflushLegs.length, 2, '两批完工必须恰好两条倒冲 OUT 腿');
      const backflushIn = fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_BACKFLUSH' AND direction='IN'",
      ).get().n;
      assert.equal(backflushIn, 0, '倒冲只有 OUT 物理腿');

      // 无双收：成品入库腿恰好 2 条。
      const finishedLegs = fixture.db.prepare(
        "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND direction='IN'",
      ).all();
      assert.equal(finishedLegs.length, 2, '两批完工必须恰好两条成品入库腿');

      // 材料账面价值按 canonical 位置口径：WIP 仓单位成本 100 分 × 0.15 = 15 分。
      // 若退化为全局平均价（含对照仓 99999 分），该值将显著偏离。
      for (const batch of batches) {
        assert.ok(Math.abs(Number(batch.totalMaterialValueCents) - 15) < 1e-9,
          `材料账面价值必须来自 canonical 位置口径（15 分），实际 ${batch.totalMaterialValueCents}`);
        const evidence = fixture.db.prepare(
          'SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?',
        ).get(batch.receiptId);
        assert.ok(evidence, '加工费成本证据必须存在');
        assert.equal(Number(evidence.material_consumed_value_cents), 15);
        assert.equal(Number(evidence.processing_fee_provisional_cents), 30000, '加工费 provisional 证据必须承载加工费');
        assert.equal(evidence.processing_fee_actual_cents, null, '首期不得提前写入加工费实际值');
        assert.equal(evidence.variance_cents, null, '首期不得提前写入差异');
        assert.equal(evidence.basis_status, 'PROVISIONAL');
      }

      // 成品估值 Movement + Balance 双写。
      const finishedBalance = fixture.db.prepare(
        'SELECT * FROM inventory_valuation_balances WHERE balance_key=?',
      ).get(`NONE:warehouse-001:${parentId}`);
      assert.ok(finishedBalance, '成品估值余额必须存在');
      assert.ok(Math.abs(Number(finishedBalance.quantity) - 60) < 1e-9,
        `成品估值余额数量必须为两批合计 60，实际 ${finishedBalance.quantity}`);
      assert.equal(Number(finishedBalance.value_cents), 60030,
        '成品估值余额金额必须为两批 (15 + 30000) 合计');
      const balanceMovements = fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND status='POSTED'",
      ).get().n;
      assert.equal(balanceMovements, 2, '每条成品入库腿必须有一条 POSTED 估值 Movement');
      const balanceSum = fixture.db.prepare(
        "SELECT COALESCE(SUM(value_delta_cents),0) v FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND status='POSTED'",
      ).get().v;
      assert.equal(Number(balanceSum), 60030, '成品估值 Movement 合计必须等于 Balance 金额');

      // 供应商 WIP 仓的物料余额与流水可对账。
      const wipBalance = fixture.db.prepare(
        'SELECT * FROM inventory_valuation_balances WHERE balance_key=?',
      ).get(`NONE:warehouse-002:${costProductId}`);
      assert.ok(wipBalance, '供应商 WIP 仓估值余额必须存在');
      assert.ok(Math.abs(Number(wipBalance.quantity) - 9.7) < 1e-9,
        `WIP 数量必须为 10 − 0.30 = 9.70，实际 ${wipBalance.quantity}`);
      assert.equal(Number(wipBalance.value_cents), 970, 'WIP 账面价值必须扣减两批倒冲材料价值');

      // 首期不得放开委外 AP / GL。
      const receiptIds = batches.map((b) => b.receiptId);
      assert.equal(fixture.db.prepare(`SELECT COUNT(*) n FROM account_payables WHERE source_id IN (${receiptIds.map(() => '?').join(',')})`).get(...receiptIds).n, 0);
      assert.equal(fixture.db.prepare(`SELECT COUNT(*) n FROM supplier_bills WHERE source_outsourcing_receipt_id IN (${receiptIds.map(() => '?').join(',')})`).get(...receiptIds).n, 0);
    });

    test('G04-2 重复确认同一收货不双扣、不双收，且拒绝审计恰好一条', async () => {
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, 'wp7a-g04-dup');
      const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, quantity: 10, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
        sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 1000,
        ...outsourcingReceiptBody(source, 10, 1000),
      }, { 'idempotency-key': 'wp7a-g04-dup-receipt' });
      assert.equal(receipt.status, 201, receipt.data.error);

      const first = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp7a-g04-dup-effect' });
      assert.equal(first.status, 200, first.data.error);

      const legsAfterFirst = fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?",
      ).get(receipt.data.id).n;
      const backflushAfterFirst = fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_BACKFLUSH'",
      ).get().n;

      const rejectsBefore = countRejects('OUTSOURCING_RECEIPT', receipt.data.id);
      const second = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp7a-g04-dup-effect-2' });
      assert.equal(second.status, 409, '换键重复确认必须显式拒绝');
      assert.equal(second.data.code, 'OUTSOURCING_RECEIPT_ALREADY_EFFECTED');
      assert.equal(countRejects('OUTSOURCING_RECEIPT', receipt.data.id), rejectsBefore + 1,
        '重复确认恰好新增 1 条拒绝审计');
      assert.equal(fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?",
      ).get(receipt.data.id).n, legsAfterFirst, '重复确认不得双收');
      assert.equal(fixture.db.prepare(
        "SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_BACKFLUSH'",
      ).get().n, backflushAfterFirst, '重复确认不得双扣');
    });
  });

  // ------------------------------------------------------------------ G06 ---
  describe('G06 — 来源级拒绝后业务事实逐字段零变化', () => {
    let orderId;

    function businessSnapshot(billId, receiptId) {
      return JSON.stringify({
        bill: fixture.db.prepare('SELECT * FROM supplier_bills WHERE id=?').get(billId),
        billItems: fixture.db.prepare('SELECT * FROM supplier_bill_items WHERE bill_id=? ORDER BY id').all(billId),
        payables: fixture.db.prepare('SELECT * FROM account_payables WHERE source_id=?').all(billId),
        vouchers: fixture.db.prepare('SELECT * FROM accounting_vouchers WHERE source_id=?').all(billId),
        inventoryTx: fixture.db.prepare('SELECT * FROM inventory_transactions WHERE source_id=? ORDER BY id').all(receiptId),
        valuationMovements: fixture.db.prepare('SELECT * FROM inventory_valuation_movements WHERE source_id=? ORDER BY id').all(receiptId),
        valuationBalances: fixture.db.prepare('SELECT * FROM inventory_valuation_balances WHERE product_id=? ORDER BY balance_key').all(parentId),
        costEvidence: fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').all(receiptId),
        receipt: fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId),
        receiptItems: fixture.db.prepare('SELECT * FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY id').all(receiptId),
      });
    }

    before(async () => {
      const materialId = await createProduct(MATERIAL_G06, 'NONE');
      await receiveStock(materialId, 100);
      seedValuationBalance({
        key: `NONE:warehouse-001:${materialId}`, method: 'MOVING_AVERAGE',
        productId: materialId, warehouseId: 'warehouse-001', quantity: 100, valueCents: 10000,
      });
      const bomId = await createOutsourceBom('WP7A-G06', [{ productId: materialId, quantity: 0.005 }]);
      orderId = await releaseOrder(bomId, 100);
      const materials = await snapshotMaterials(orderId, [materialId]);
      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materials[materialId], quantity: 10, issuedDate: isoDate(), idempotencyKey: 'wp7a-g06-issue',
      });
      assert.equal(issue.status, 201, issue.data.error);
    });

    test('G06-1 委外来源账单在专用与共享入口一律 409，AP / 凭证 / 库存 / 估值 / 成本 / 单据逐字段零变化', async () => {
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, 'wp7a-g06');
      const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, quantity: 10, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
        sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 5000,
        ...outsourcingReceiptBody(source, 10, 5000),
      }, { 'idempotency-key': 'wp7a-g06-receipt' });
      assert.equal(receipt.status, 201, receipt.data.error);
      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp7a-g06-effect' });
      assert.equal(effected.status, 200, effected.data.error);

      const receiptItem = fixture.db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=?').get(receipt.data.id).id;
      const bill = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.outsourcing, {
        supplierId: 'supplier-001', supplierInvoiceNo: 'WP7A-G06', billDate: isoDate(),
        idempotencyKey: 'wp7a-g06-bill',
        lines: [{ outsourcingReceiptItemId: receiptItem, quantity: 10, unitPriceCents: 500 }],
      });
      assert.equal(bill.status, 201, bill.data.error);
      const billId = bill.data.id;
      assert.equal(fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(billId).status, 'DRAFT',
        '委外草稿创建必须合法且停留在 DRAFT');

      const before = businessSnapshot(billId, receipt.data.id);
      const rejectsBefore = countRejects('SUPPLIER_BILL', billId);

      const attempts = [
        { name: '专用过账', path: `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`, body: undefined, actor: 'accounting' },
        { name: '共享过账', path: `/api/supplier-bills/${billId}/post`, body: undefined, actor: 'accounting' },
        { name: '共享匹配', path: `/api/supplier-bills/${billId}/match`, body: { items: [] }, actor: 'accounting' },
        { name: '管理员共享过账', path: `/api/supplier-bills/${billId}/post`, body: undefined, actor: 'admin' },
      ];
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        const response = await fixture.request('POST', attempt.path, fixture.tokens[attempt.actor], attempt.body);
        assert.equal(response.status, 409, `${attempt.name} 必须 409，实际 ${response.status}`);
        assert.equal(response.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED', attempt.name);
        assert.equal(countRejects('SUPPLIER_BILL', billId), rejectsBefore + index + 1,
          `${attempt.name} 恰好新增 1 条拒绝审计`);
        assert.equal(businessSnapshot(billId, receipt.data.id), before,
          `${attempt.name} 拒绝后业务事实必须逐字段零变化`);
      }

      // 未授权主体在读取来源前得到 403，且不泄露来源。
      const forbidden = await fixture.request('POST', `/api/supplier-bills/${billId}/post`, fixture.tokens.outsourcing, undefined);
      assert.equal(forbidden.status, 403, '未授权主体必须 403');
      const forbiddenBody = JSON.stringify(forbidden.data);
      assert.equal(forbiddenBody.includes('OUTSOURCING_RECEIPT_ITEM'), false, '403 响应不得泄露账单来源');
      assert.equal(forbiddenBody.includes(billId), false, '403 响应不得泄露业务单据标识');
      assert.equal(businessSnapshot(billId, receipt.data.id), before, '403 拒绝后业务事实必须逐字段零变化');
    });
  });
});
