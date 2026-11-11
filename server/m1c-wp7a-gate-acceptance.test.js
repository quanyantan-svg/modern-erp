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
// M1C-WP7-A-R1 补证（本批，独立 describe，不改动 G01/G03/G04/G06 既有断言）：
//   G03 —— L2 canonical inventory primitive 证据（另见
//          `server/m1c-wp7a-g03-l2-mutation-key.test.js`）；
//          G03-2/3/4 的拒绝路径统一到**完整业务事实**逐字段快照。
//   G04 —— 成品唯一 Writer、企业所有权与物理/跟踪/估值流水关联（G04-R1-1）；
//          逐批成品估值与成本构成、Movement 与 Balance 逐笔核对（G04-R1-2）。
//
// 证据分级：正向来源一律经生产 HTTP API（L1）。基础夹具只有三处使用直接 SQL（L3），
// 且都是没有生产写入入口的字段：
//   1) `products.valuation_method` —— 无任何 HTTP 路由写入它；
//   2) `inventory_valuation_balances` 种子行 —— 估值方法与跟踪策略的绑定关系
//      由应用层校验，种子行用于给权威估值一个非零账面价值；
//   3) `inventory_lot_balances` 种子行 —— 批次维度的当前投影，其写入者是
//      postCanonicalTrackedLeg，原生库存单据确认路径不写它。
// 其余（LOT / SERIAL 身份、库存入仓、委外 BOM、委外订单、完工通知、收货、
// 发料 / 补料 / 退料、加工费账单）全部经生产 API 造数。
// G04-D1 的 backflush / confirm 两例各有一处明确隔离的 L3 历史异常种子：
// 把已倒冲累计量改为大于当前合法目标累计量；种子只用于证明对应生产
// HTTP Handler 的防御性拒绝，不得被表述为合法 L1 状态。
//
// 本套件拥有一次性临时 SQLite 文件，不触碰任何项目 / 开发 / 生产数据库，
// 也不连接 MySQL。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedOutsourceSource } from './test-support/procurement-http-fixture.js';
import {
  G03_BUSINESS_FACT_TABLES, G04_BUSINESS_FACT_TABLES,
  changedTables, g03BusinessFactTableReport, snapshotTables,
} from './test-support/m1-core-g03-g04-evidence.js';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

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
  async function createOutsourceBom(version, items, bomProductId = parentId) {
    const bom = await fixture.request('POST', '/api/engineering/boms', fixture.tokens.admin, {
      productId: bomProductId, version, purpose: 'OUTSOURCE', approvalStatus: 'APPROVED',
      effectiveFrom: isoDate(), items,
    });
    assert.equal(bom.status, 201, bom.data.error);
    const row = fixture.db.prepare('SELECT status,approval_status,purpose FROM boms WHERE id=?').get(bom.data.id);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.approval_status, 'APPROVED');
    assert.equal(row.purpose, 'OUTSOURCE');
    return bom.data.id;
  }

  async function releaseOrder(bomId, orderQuantity, orderProductId = parentId) {
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: orderProductId, orderQuantity, unit: 'EA',
      businessDate: isoDate(), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const id = order.data.id;
    // 用料快照必须在 DRAFT 阶段形成（Requirement §31.15；已批准 MC-REQ-03）：
    // 快照行取自已批准 OUTSOURCE BOM 的真实用料行。
    const bomItems = fixture.db.prepare('SELECT product_id FROM bom_items WHERE bom_id=? ORDER BY line_no').all(bomId);
    const snap = await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/material-list`, fixture.tokens.admin, {
      items: bomItems.map((item) => ({ productId: item.product_id, sourceWarehouseId: 'warehouse-001' })),
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

  // G03 合同的**完整业务事实**快照：用于「拒绝后逐字段零变化」断言。
  //
  // Active Design §13.1 的 G03 零副作用列要求「业务单据 / 库存 / 跟踪 / 估值 /
  // 身份层逐字段零变化」。旧实现只采集了三张表且**限定在本订单内**，因此
  // 跟踪层与估值层完全没有被断言到，订单之外的既有行被原地改写也发现不了。
  //
  // 现在改为对 G03 合同涉及的全部业务事实表做**完整行**采集与逐字段比较
  // （表集见 `G03_BUSINESS_FACT_TABLES`）。`audit_logs` **不在**快照内：拒绝
  // 路径必须**恰好新增 1 条**拒绝审计，这是与「零变化」并列的独立要求，
  // 由各用例单独断言。
  function g03BusinessFacts() {
    return snapshotTables(fixture.db, G03_BUSINESS_FACT_TABLES);
  }

  function g04BusinessFacts() {
    return snapshotTables(fixture.db, G04_BUSINESS_FACT_TABLES);
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
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: parentId, effectiveFrom: isoDate(-30) }]);
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

    test('G03-0 G03 业务事实表集与真实 schema 一致（表数不得虚报）', () => {
      const report = g03BusinessFactTableReport(fixture.db);
      assert.deepEqual(report.missing, [], `G03 业务事实表集里的表必须真实存在：${report.missing.join(', ')}`);
      assert.equal(report.present, report.declared, '表集声明数必须等于 schema 中真实存在的表数');
      assert.equal(report.declared, 18, 'G03 业务事实表集为 18 张表；表集增删必须同步更新本断言与候审证据中的表数');
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
      // 四个案例**逐个**采集拒绝前后的完整快照：每一次拒绝都独立成立，
      // 不能靠「四次合起来没变」蒙混过关 —— 后一次的失败无法掩盖前一次的
      // 副作用，反之亦然。
      const cases = [
        { name: 'LOT 物料缺少批次身份', body: { materialListId: materials[lotProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-lot' }, code: 'WIP_IDENTITY_EVIDENCE_MISSING' },
        { name: 'SERIAL 物料数量不为 1', body: { materialListId: materials[serialProductId], quantity: 2, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-serial-qty', serialId }, code: 'WIP_IDENTITY_POLICY_MISMATCH' },
        { name: 'SERIAL 物料缺少序列号身份', body: { materialListId: materials[serialProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-serial-id' }, code: 'WIP_IDENTITY_EVIDENCE_MISSING' },
        { name: 'SERIAL 物料携带批次身份', body: { materialListId: materials[serialProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-bad-serial-lot', serialId, lotId }, code: 'WIP_IDENTITY_EVIDENCE_MISSING' },
      ];
      for (const item of cases) {
        const before = g03BusinessFacts();
        const rejectsBefore = countRejects('OUTSOURCING_ORDER', orderId);

        const response = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, item.body);

        assert.equal(response.status, 409, `${item.name} 必须 409，实际 ${response.status}`);
        assert.equal(response.data.code, item.code, `${item.name} 必须返回精确错误码`);
        assert.deepEqual(g03BusinessFacts(), before, `${item.name} 拒绝后 G03 完整业务事实必须逐字段零变化`);
        assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 1,
          `${item.name} 拒绝必须恰好新增 1 条拒绝审计`);
      }
    });

    test('G03-2N 负控：同一完整快照比较在允许写入的路径上必须报告差异', async () => {
      // 非空洞负控：G03-2 的「逐字段零变化」断言必须**有能力**发现差异。
      // 这里在一条**被允许写入**的路径（合法发料）上运行同一比较，要求它报告
      // 变化；若比较本身是恒假的，G03-2 的零变化断言就毫无意义。
      const before = g03BusinessFacts();
      const response = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materials[lotProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-g03-2n-control', lotId,
      });
      assert.equal(response.status, 201, '合法发料必须成功');
      const after = g03BusinessFacts();
      const changed = changedTables(before, after);
      assert.ok(changed.length > 0, '同一完整快照比较在允许写入的路径上必须报告差异');
      assert.ok(changed.includes('inventory') || changed.includes('inventory_transactions'),
        `合法发料必须改变库存或物理流水事实，实际变化表：${changed.join(', ') || '无'}`);
    });

    test('G03-3 缺仓与库存不足一律 409 且拒绝审计恰好一条、事实零变化', async () => {
      // 缺仓：供应商未配置委外 WIP 仓（异常样本构造，构造后立即复原）。
      const before = g03BusinessFacts();
      const rejectsBefore = countRejects('OUTSOURCING_ORDER', orderId);
      fixture.db.prepare("UPDATE suppliers SET supplier_wip_warehouse_id=NULL WHERE id='supplier-001'").run();
      const noWarehouse = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: materials[lotProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-no-warehouse', lotId,
      });
      fixture.db.prepare("UPDATE suppliers SET supplier_wip_warehouse_id='warehouse-002' WHERE id='supplier-001'").run();
      assert.equal(noWarehouse.status, 409, '缺 WIP 仓必须 409');
      assert.equal(noWarehouse.data.code, 'OUTSOURCING_WIP_WAREHOUSE_MISSING');
      assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 1);
      assert.deepEqual(g03BusinessFacts(), before, '缺仓拒绝后 G03 完整业务事实必须逐字段零变化');

      // 库存不足：退料数量超过供应商 WIP 剩余。
      const issued = Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(materials[lotProductId]).q);
      const overReturn = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.outsourcing, {
        materialListId: materials[lotProductId], quantity: issued + 1, returnDate: isoDate(), idempotencyKey: 'wp7a-over-return', lotId,
      });
      assert.equal(overReturn.status, 409, '库存不足必须 409');
      assert.equal(overReturn.data.code, 'OUTSOURCING_WIP_INSUFFICIENT');
      assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 2);
      assert.deepEqual(g03BusinessFacts(), before, '库存不足拒绝后 G03 完整业务事实必须逐字段零变化');
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
      const before = g03BusinessFacts();
      const response = await fixture.request('POST', `/api/procurement/outsourcing/orders/${uomOrderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: uomMaterials[uomProductId], quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-uom-mismatch',
      });
      assert.equal(response.status, 409, 'UOM 不符必须 409');
      assert.equal(response.data.code, 'OUTSOURCING_WIP_UOM_MISMATCH');
      assert.equal(countRejects('OUTSOURCING_ORDER', uomOrderId), rejectsBefore + 1);
      assert.deepEqual(g03BusinessFacts(), before, 'UOM 不符拒绝后 G03 完整业务事实必须逐字段零变化');
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

    test('G04-D1 L3 历史异常：已倒冲累计量大于合法目标时生产 HTTP 409、事实零变化且拒绝审计恰好一条', async () => {
      const d1ProductId = await createProduct('WP7A-D1-MAT', 'NONE');
      await receiveStock(d1ProductId, 20);
      seedValuationBalance({
        key: `NONE:warehouse-001:${d1ProductId}`, method: 'MOVING_AVERAGE',
        productId: d1ProductId, warehouseId: 'warehouse-001', quantity: 20, valueCents: 2000,
      });
      const d1BomId = await createOutsourceBom('WP7A-D1', [{ productId: d1ProductId, quantity: 1 }]);
      const d1OrderId = await releaseOrder(d1BomId, 10);
      const d1MaterialId = (await snapshotMaterials(d1OrderId, [d1ProductId]))[d1ProductId];
      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${d1OrderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: d1MaterialId, quantity: 5, issuedDate: isoDate(), idempotencyKey: 'wp7a-d1-issue',
      });
      assert.equal(issue.status, 201, issue.data.error);

      // L1：合法 HTTP 建立一张已生效、累计合格量为 2 的收货；正常倒冲累计量也是 2。
      const source = await prepareOutsourcingReceiptSource(fixture, d1OrderId, 2, 'wp7a-d1');
      const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId: d1OrderId, quantity: 2, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
        sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 200,
        ...outsourcingReceiptBody(source, 2, 200),
      }, { 'idempotency-key': 'wp7a-d1-receipt' });
      assert.equal(receipt.status, 201, receipt.data.error);
      const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp7a-d1-effect' });
      assert.equal(effected.status, 200, effected.data.error);
      assert.equal(Number(fixture.db.prepare('SELECT backflushed_quantity q FROM outsourcing_material_list WHERE id=?').get(d1MaterialId).q), 2);

      // L3：受控历史异常种子。当前合法目标累计量仍为 2，但历史已倒冲累计量被置为 3。
      fixture.db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=3 WHERE id=?').run(d1MaterialId);
      const seeded = fixture.db.prepare('SELECT backflushed_quantity FROM outsourcing_material_list WHERE id=?').get(d1MaterialId);
      assert.equal(Number(seeded.backflushed_quantity), 3, 'L3 种子必须明确制造 target(2) - historical(3) < 0');

      const before = g04BusinessFacts();
      const rejectsBefore = countRejects('OUTSOURCING_RECEIPT', receipt.data.id);
      const rejected = await fixture.request('POST', `/api/procurement/outsourcing/orders/${d1OrderId}/backflush`, fixture.tokens.outsourcing, {
        receiptId: receipt.data.id, identities: [], idempotencyKey: 'wp7a-d1-defensive-backflush',
      });
      assert.equal(rejected.status, 409, '负增量防御必须返回 409');
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_INSUFFICIENT');
      assert.deepEqual(changedTables(before, g04BusinessFacts()), [], 'D-1 防御性拒绝后 G04 完整业务事实必须逐字段零变化');
      assert.equal(countRejects('OUTSOURCING_RECEIPT', receipt.data.id), rejectsBefore + 1,
        'D-1 防御性拒绝必须恰好新增一条 REJECT 审计');
    });

    test('G04-D1-C confirm 路径：L3 历史倒冲超目标时 409、18 表零变化且拒绝审计精确关联', async () => {
      const productId = await createProduct('WP7A-D1-CONFIRM-MAT', 'NONE');
      await receiveStock(productId, 20);
      seedValuationBalance({
        key: `NONE:warehouse-001:${productId}`, method: 'MOVING_AVERAGE',
        productId, warehouseId: 'warehouse-001', quantity: 20, valueCents: 2000,
      });
      const bomId = await createOutsourceBom('WP7A-D1-CONFIRM', [{ productId, quantity: 1 }]);
      const orderId = await releaseOrder(bomId, 10);
      const materialListId = (await snapshotMaterials(orderId, [productId]))[productId];

      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
        materialListId, quantity: 5, issuedDate: isoDate(), idempotencyKey: 'wp7a-d1-confirm-issue',
      });
      assert.equal(issue.status, 201, issue.data.error);

      // L1：加工费 PO、完工通知、待检收货全部经生产 HTTP 建立。
      const source = await prepareOutsourcingReceiptSource(fixture, orderId, 2, 'wp7a-d1-confirm');
      const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId, quantity: 2, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
        sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 200,
        ...outsourcingReceiptBody(source, 2, 200),
      }, { 'idempotency-key': 'wp7a-d1-confirm-receipt' });
      assert.equal(receipt.status, 201, receipt.data.error);
      assert.equal(fixture.db.prepare('SELECT business_status FROM outsourcing_receipts WHERE id=?').get(receipt.data.id).business_status,
        'PENDING_INSPECTION');

      // L1 质量条件：通过生产 HTTP 创建并完成 OUTSOURCING_RECEIPT IQC PASS。
      const iqc = await fixture.request('POST', '/api/iqc', fixture.tokens.warehouse, {
        outsourcing_receipt_id: receipt.data.id,
      });
      assert.equal(iqc.status, 201, iqc.data.error);
      const iqcPass = await fixture.request('POST', `/api/iqc/${iqc.data.id}/complete`, fixture.tokens.warehouse, {
        result: 'PASS', inspection_quantity: 2, passed_quantity: 2, failed_quantity: 0,
      });
      assert.equal(iqcPass.status, 200, iqcPass.data.error);
      const iqcRow = fixture.db.prepare('SELECT status,result,source_type,outsourcing_receipt_id FROM iqc_inspections WHERE id=?').get(iqc.data.id);
      assert.equal(iqcRow.status, 'COMPLETED');
      assert.equal(iqcRow.result, 'PASS');
      assert.equal(iqcRow.source_type, 'OUTSOURCING_RECEIPT');
      assert.equal(iqcRow.outsourcing_receipt_id, receipt.data.id,
        '质量条件必须由生产 HTTP 形成与本收货关联的已完成 IQC PASS');

      // L3：唯一的受控历史异常种子。合法 confirm 目标累计量为 2，历史已倒冲累计量被置为 3。
      // 该状态不是合法 L1 造数，只用于验证 confirm Handler 的防御性 fail-closed 分支。
      fixture.db.prepare('UPDATE outsourcing_material_list SET backflushed_quantity=3 WHERE id=?').run(materialListId);
      const seeded = fixture.db.prepare(`SELECT backflushed_quantity,
        json_extract(bom_snapshot_json,'$.per_unit_quantity') per_unit_quantity
        FROM outsourcing_material_list WHERE id=?`).get(materialListId);
      assert.equal(Number(seeded.per_unit_quantity) * 2, 2, '本次合法 confirm 的目标累计量必须为 2');
      assert.equal(Number(seeded.backflushed_quantity), 3, 'L3 种子必须明确制造 target(2) - historical(3) < 0');

      const before = g04BusinessFacts();
      const auditsBefore = fixture.db.prepare(
        "SELECT id FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_RECEIPT' AND entity_id=? ORDER BY id",
      ).all(receipt.data.id).map((row) => row.id);
      const rejected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp7a-d1-confirm-effect' });
      assert.equal(rejected.status, 409, 'confirm 负增量防御必须返回 409');
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_INSUFFICIENT');
      assert.deepEqual(changedTables(before, g04BusinessFacts()), [],
        'confirm 防御性拒绝后 G04 18 表业务事实必须逐字段零变化');

      const auditsAfter = fixture.db.prepare(
        "SELECT * FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_RECEIPT' AND entity_id=? ORDER BY id",
      ).all(receipt.data.id);
      const added = auditsAfter.filter((row) => !auditsBefore.includes(row.id));
      assert.equal(added.length, 1, 'confirm 防御性拒绝必须恰好新增一条 REJECT 审计');
      assert.equal(added[0].action, 'REJECT');
      assert.equal(added[0].entity_type, 'OUTSOURCING_RECEIPT');
      assert.equal(added[0].entity_id, receipt.data.id, '拒绝审计必须关联本收货实体');
      assert.match(added[0].detail, /确认委外收货 拒绝/);
      assert.match(added[0].detail, /OUTSOURCING_WIP_INSUFFICIENT/,
        '拒绝审计必须记录与 HTTP 响应相同的精确错误码');
    });

    test('G04-WP-G 合法 HTTP 构造净 WIP 供应不足：确认拒绝、完整快照零变化且拒绝审计恰好一条', async () => {
      const wpGProductId = await createProduct('WP7A-WPG-MAT', 'NONE');
      await receiveStock(wpGProductId, 20);
      seedValuationBalance({
        key: `NONE:warehouse-001:${wpGProductId}`, method: 'MOVING_AVERAGE',
        productId: wpGProductId, warehouseId: 'warehouse-001', quantity: 20, valueCents: 2000,
      });
      const wpGBomId = await createOutsourceBom('WP7A-WPG', [{ productId: wpGProductId, quantity: 1 }]);
      const wpGOrderId = await releaseOrder(wpGBomId, 10);
      const wpGMaterialId = (await snapshotMaterials(wpGOrderId, [wpGProductId]))[wpGProductId];

      // L1：只供应 1 单位 WIP，却以合法 HTTP 创建数量 2 的待检收货。
      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${wpGOrderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: wpGMaterialId, quantity: 1, issuedDate: isoDate(), idempotencyKey: 'wp7a-wpg-issue',
      });
      assert.equal(issue.status, 201, issue.data.error);
      const source = await prepareOutsourcingReceiptSource(fixture, wpGOrderId, 2, 'wp7a-wpg');
      const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
        orderId: wpGOrderId, quantity: 2, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
        sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 200,
        ...outsourcingReceiptBody(source, 2, 200),
      }, { 'idempotency-key': 'wp7a-wpg-receipt' });
      assert.equal(receipt.status, 201, receipt.data.error);

      const before = g04BusinessFacts();
      const rejectsBefore = countRejects('OUTSOURCING_RECEIPT', receipt.data.id);
      const rejected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
        fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp7a-wpg-effect' });
      assert.equal(rejected.status, 409, '净 WIP 供应不足必须返回 409');
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_INSUFFICIENT');
      assert.deepEqual(changedTables(before, g04BusinessFacts()), [], 'WP-G 拒绝后 G04 完整业务事实必须逐字段零变化');
      assert.equal(countRejects('OUTSOURCING_RECEIPT', receipt.data.id), rejectsBefore + 1,
        'WP-G 拒绝必须恰好新增一条 REJECT 审计');
    });
  });

  // ------------------------------------------------------------- G04-R1 ---
  // M1C-WP7-A-R1 —— G04 的成品 Writer 与逐批成本估值补证。
  //
  // 本 describe 使用**自己的成品货品与自己的委外订单**，与 G04 组的夹具完全
  // 隔离，因此断言不依赖任何用例执行顺序。
  describe('G04-R1 — 成品唯一 Writer、企业所有权与逐批成本估值', () => {
    let r1ParentId;
    let r1CostProductId;
    let r1OrderId;
    let r1MaterialListId;
    let r1Batches = [];
    let r1OpeningBalance = null;
    const r1BalanceKey = () => `NONE:warehouse-001:${r1ParentId}`;

    // 本批的**独立**成本期望值：由本套件自己建立的输入推导，**不**取自任何
    // 生产函数的输出。
    //
    //   BOM 每单位用量 0.005 × 每批收货 30 = 每批倒冲 0.15 单位
    //   × canonical 位置口径单位成本 100 分 = 每批材料账面价值 **15 分**
    //   + 本套件设置的 provisional 加工费 **30000 分**
    //   = 每批成品估值 **30015 分**
    //
    // 对照仓把同产品单位成本抬到 99999 分：若实现退化为**全局平均价**，每批材料
    // 账面价值会变成约 8249.92 分，本套件的绝对期望因此能**独立**检出该错误 ——
    // 不依赖「用生产函数的另一个输出当预期值」。
    const R1_BOM_PER_UNIT_QUANTITY = 0.005;
    const R1_RECEIPT_QUANTITY = 30;
    const R1_CANONICAL_UNIT_COST_CENTS = 100;
    const R1_PROCESSING_FEE_CENTS = 30000;
    const R1_EXPECTED_MATERIAL_COST_CENTS = 15;
    const R1_EXPECTED_FINISHED_VALUE_CENTS = R1_EXPECTED_MATERIAL_COST_CENTS + R1_PROCESSING_FEE_CENTS;

    const readR1Balance = () => fixture.db.prepare(
      'SELECT * FROM inventory_valuation_balances WHERE balance_key=?',
    ).get(r1BalanceKey()) || null;

    // 该批成品的估值 Movement：按**收货单 + 明细**关联，并要求恰好一条。
    function r1BatchMovements(batch) {
      const item = fixture.db.prepare(
        'SELECT * FROM outsourcing_receipt_items WHERE receipt_id=? ORDER BY line_no',
      ).get(batch.receiptId);
      const movements = fixture.db.prepare(
        "SELECT * FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? AND source_item_id=? AND status='POSTED' ORDER BY id",
      ).all(batch.receiptId, item.id);
      return { item, movements };
    }

    // 成品入库的**静态 Writer 调用链**检查。
    //
    // 目的：证明成品物理腿在生产代码里只有**一条**写入路径，而不是只断言
    // 「库存腿数正确」。做法是扫描 server 下的全部生产源文件（排除 *.test.js）：
    //   ① canonical primitive 的成品 sourceType 字面量只出现在**一个**文件；
    //   ② 该文件里的全部字面量都位于 `receiveOutsourcingFinishedGoods` 函数体内；
    //   ③ 成品入库 Writer 在整个 server 树里**只有一个调用点**。
    //
    // 口径边界：这是**源码级**证明「今天不存在第二条写入路径」，不是运行时
    // 证明；将来新增写入点会让本断言失败，从而强制重新审查。
    function scanFinishedGoodsWriterChain() {
      const serverDir = fileURLToPath(new URL('.', import.meta.url));
      const files = [];
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) files.push(full);
        }
      };
      walk(serverDir);

      const literalPattern = /sourceType:\s*'OUTSOURCING_RECEIPT'/g;
      const literalFiles = [];
      let literalCount = 0;
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const hits = text.match(literalPattern) || [];
        if (hits.length) {
          literalFiles.push(relative(serverDir, file).replaceAll('\\', '/'));
          literalCount += hits.length;
        }
      }

      const ownerFile = files.find((file) => /export function receiveOutsourcingFinishedGoods\(/.test(readFileSync(file, 'utf8')));
      const ownerText = readFileSync(ownerFile, 'utf8');
      const bodyStart = ownerText.indexOf('export function receiveOutsourcingFinishedGoods(');
      const bodyEnd = ownerText.indexOf('\nexport function ', bodyStart + 1);
      const body = ownerText.slice(bodyStart, bodyEnd === -1 ? ownerText.length : bodyEnd);
      const bodyLiterals = (body.match(literalPattern) || []).length;

      let callSites = 0;
      const callSiteFiles = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const hits = (text.match(/receiveOutsourcingFinishedGoods\(/g) || []).length;
        const definitions = (text.match(/export function receiveOutsourcingFinishedGoods\(/g) || []).length;
        const calls = hits - definitions;
        if (calls > 0) {
          callSites += calls;
          callSiteFiles.push(relative(serverDir, file).replaceAll('\\', '/'));
        }
      }
      return {
        literalFiles, literalCount, bodyLiterals, callSites, callSiteFiles,
        owner: relative(serverDir, ownerFile).replaceAll('\\', '/'),
      };
    }

    before(async () => {
      r1ParentId = await createProduct('WP7A-R1-FG', 'NONE', 'FINISHED_GOOD');
      await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: r1ParentId, effectiveFrom: isoDate(-30) }]);
      r1CostProductId = await createProduct('WP7A-R1-COST', 'NONE');
      await receiveStock(r1CostProductId, 100);
      seedValuationBalance({
        key: `NONE:warehouse-001:${r1CostProductId}`, method: 'MOVING_AVERAGE',
        productId: r1CostProductId, warehouseId: 'warehouse-001', quantity: 100, valueCents: 10000,
      });
      // 对照仓的同产品成本：若材料成本退化为全局平均价，逐批成品估值断言必须失败。
      const contrast = await fixture.request('POST', '/api/warehouses', fixture.tokens.admin, {
        code: 'WH-WP7A-R1-003', name: 'WP7A R1 成本对照仓',
      });
      assert.equal(contrast.status, 201, contrast.data.error);
      seedValuationBalance({
        key: `NONE:${contrast.data.id}:${r1CostProductId}`, method: 'MOVING_AVERAGE',
        productId: r1CostProductId, warehouseId: contrast.data.id, quantity: 100, valueCents: 99999,
      });

      const bomId = await createOutsourceBom('WP7A-R1', [{ productId: r1CostProductId, quantity: 0.005 }], r1ParentId);
      r1OrderId = await releaseOrder(bomId, 100, r1ParentId);
      const materials = await snapshotMaterials(r1OrderId, [r1CostProductId]);
      r1MaterialListId = materials[r1CostProductId];

      const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${r1OrderId}/issues`, fixture.tokens.outsourcing, {
        materialListId: r1MaterialListId, quantity: 10, issuedDate: isoDate(), idempotencyKey: 'wp7a-r1-issue',
      });
      assert.equal(issue.status, 201, issue.data.error);

      // 成品估值余额的**期初**与**逐批余额**快照：用于「各批增量加总 vs 期初期末
      // Balance 差额」核对。期初必须为空 —— 成品在首批完工前没有估值余额。
      r1OpeningBalance = readR1Balance();
      assert.equal(r1OpeningBalance, null, '成品在首批完工前不得存在估值余额（期初为空）');

      for (const batch of [1, 2]) {
        const source = await prepareOutsourcingReceiptSource(fixture, r1OrderId, 30, `wp7a-r1-b${batch}`);
        const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
          orderId: r1OrderId, quantity: 30, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
          sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 30000,
          ...outsourcingReceiptBody(source, 30, 30000),
        }, { 'idempotency-key': `wp7a-r1-receipt-${batch}` });
        assert.equal(receipt.status, 201, receipt.data.error);
        const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
          fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': `wp7a-r1-effect-${batch}` });
        assert.equal(effected.status, 200, effected.data.error);
        r1Batches.push({ receiptId: receipt.data.id, ...effected.data, balanceAfter: readR1Balance() });
      }
    });

    test('G04-R1-1 成品只经唯一 Writer 进入合法企业仓，物理/跟踪/估值流水逐笔关联', () => {
      // 1) 成品仓位：唯一、合法企业仓、企业所有权。
      const positions = fixture.db.prepare('SELECT * FROM inventory WHERE product_id=? AND active=1').all(r1ParentId);
      assert.equal(positions.length, 1, '成品只能有一个 canonical 仓位');
      assert.equal(positions[0].warehouse_id, 'warehouse-001', '成品只能进入合法企业仓');
      assert.equal(positions[0].owner_type, 'ENTERPRISE', '成品所有权必须是企业');
      assert.equal(positions[0].owner_id, null, '成品所有权不得挂到供应商或第三方');
      assert.equal(Number(positions[0].quantity), 60, '成品数量必须等于两批合计 60');
      assert.equal(
        fixture.db.prepare('SELECT COUNT(*) n FROM inventory WHERE product_id=? AND warehouse_id=?').get(r1ParentId, 'warehouse-002').n,
        0, '成品不得进入供应商 WIP 仓',
      );

      // 2) 物理流水 ↔ 跟踪流水 ↔ 估值流水：逐笔关联。
      const legs = fixture.db.prepare(
        "SELECT * FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND product_id=? ORDER BY created_at,id",
      ).all(r1ParentId);
      assert.equal(legs.length, 2, '两批完工必须恰好两条成品入库物理腿');
      for (const leg of legs) {
        assert.equal(leg.direction, 'IN', '成品入库腿方向必须是 IN');
        assert.equal(leg.valuation_status, 'VALUED', '每条成品物理腿必须完成权威估值');
        const tracked = fixture.db.prepare('SELECT * FROM tracked_inventory_movements WHERE transaction_id=?').all(leg.id);
        assert.equal(tracked.length, 1, '每条成品物理腿必须恰好一条跟踪腿');
        assert.equal(tracked[0].source_type, 'OUTSOURCING_RECEIPT');
        assert.equal(tracked[0].source_id, leg.source_id, '跟踪腿必须关联同一收货');
        assert.equal(tracked[0].product_id, r1ParentId);
        assert.equal(tracked[0].warehouse_id, leg.warehouse_id, '跟踪腿必须在同一仓位');
        assert.equal(Number(tracked[0].quantity), Math.abs(Number(leg.quantity_change)), '跟踪腿数量必须等于物理腿数量');
        const valuation = fixture.db.prepare(
          "SELECT * FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'",
        ).all(leg.id);
        assert.equal(valuation.length, 1, '每条成品物理腿必须恰好一条 POSTED 估值流水');
        assert.equal(valuation[0].source_id, leg.source_id, '估值流水必须关联同一收货');
        assert.equal(valuation[0].source_item_id, tracked[0].source_item_id, '估值流水必须关联同一收货明细');
      }

      // 3) 静态 Writer 调用链：成品物理腿只有一条生产写入路径。
      const chain = scanFinishedGoodsWriterChain();
      assert.deepEqual(chain.literalFiles, [chain.owner],
        `成品 sourceType 字面量只允许出现在成品 Writer 模块内，实际：${chain.literalFiles.join(', ')}`);
      assert.equal(chain.bodyLiterals, chain.literalCount,
        '成品 sourceType 字面量必须全部位于成品入库 Writer 函数体内');
      assert.equal(chain.callSites, 1, '成品入库 Writer 只能有一个调用点');
      assert.deepEqual(chain.callSiteFiles, ['modules/outsourcing-finance.js'],
        '成品入库 Writer 的调用点必须唯一');
    });

    test('G04-R1-2 每批成品估值 = 该批实际倒冲材料成本 + provisional 加工费，且与 Balance 逐笔对账', () => {
      assert.equal(r1Batches.length, 2, '必须恰好两批完工');
      let totalMovementQuantity = 0;
      let totalMovementValue = 0;
      for (const [index, batch] of r1Batches.entries()) {
        const { item, movements } = r1BatchMovements(batch);
        assert.equal(movements.length, 1, `第 ${index + 1} 批成品估值必须恰好一条 Movement（按收货单与明细关联）`);
        const evidence = fixture.db.prepare(
          'SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?',
        ).get(batch.receiptId);
        assert.ok(evidence, `第 ${index + 1} 批必须存在加工费成本证据`);
        assert.equal(evidence.basis_status, 'PROVISIONAL', '加工费证据必须为 provisional 口径');
        assert.ok(Number(evidence.processing_fee_provisional_cents) > 0, '加工费必须以 provisional 形式存在');
        assert.equal(evidence.processing_fee_actual_cents, null, '首期不得提前写入加工费实际值');
        assert.equal(evidence.variance_cents, null, '首期不得提前写入差异');

        // 独立期望（绝对值，由本套件自己的输入推导）：
        //   每批材料账面价值 = BOM 每单位用量 × 每批收货量 × canonical 位置单位成本
        //                    = 0.005 × 30 × 100 = 15 分
        //   每批 provisional 加工费 = 30000 分
        //   每批成品估值 = 15 + 30000 = 30015 分
        //
        // 这三个绝对值**不**取自任何生产函数的输出，因此能独立检出「材料成本
        // 退化为全局平均价」这类错误（对照仓 99999 分/单位会把材料成本推到
        // 约 8249.92 分，与 15 分严重偏离）。
        assert.equal(Number(evidence.material_consumed_value_cents), R1_EXPECTED_MATERIAL_COST_CENTS,
          `第 ${index + 1} 批材料账面价值必须为 ${R1_EXPECTED_MATERIAL_COST_CENTS} 分（BOM ${R1_BOM_PER_UNIT_QUANTITY} × ${R1_RECEIPT_QUANTITY} × ${R1_CANONICAL_UNIT_COST_CENTS} 分/单位）`);
        assert.equal(Number(evidence.processing_fee_provisional_cents), R1_PROCESSING_FEE_CENTS,
          `第 ${index + 1} 批 provisional 加工费必须为 ${R1_PROCESSING_FEE_CENTS} 分`);
        assert.equal(Number(movements[0].value_delta_cents), R1_EXPECTED_FINISHED_VALUE_CENTS,
          `第 ${index + 1} 批成品估值必须为 ${R1_EXPECTED_FINISHED_VALUE_CENTS} 分（${R1_EXPECTED_MATERIAL_COST_CENTS} 材料 + ${R1_PROCESSING_FEE_CENTS} 加工费）`);

        // 构成关系同样成立：成品估值 = 该批实际倒冲材料账面价值 + provisional 加工费。
        const expectedValue = Number(evidence.material_consumed_value_cents) + Number(evidence.processing_fee_provisional_cents);
        assert.equal(Number(movements[0].value_delta_cents), expectedValue,
          `第 ${index + 1} 批成品估值必须等于该批实际倒冲材料成本 + provisional 加工费`);
        // 明确不得把成品 Movement 读成「只有材料成本」或「累计余额」。
        assert.notEqual(Number(movements[0].value_delta_cents), Number(evidence.material_consumed_value_cents),
          '成品 Movement 必须包含 provisional 加工费，不得等于单独的材料成本');
        assert.equal(Number(movements[0].quantity_delta), Number(item.quantity),
          `第 ${index + 1} 批成品估值的数量必须等于该批明细数量`);

        // Movement 必须按 inventory_transaction_id 关联到该批的成品物理腿。
        const leg = fixture.db.prepare('SELECT * FROM inventory_transactions WHERE id=?').get(movements[0].inventory_transaction_id);
        assert.ok(leg, '成品估值 Movement 必须按 inventory_transaction_id 关联到成品物理腿');
        assert.equal(leg.source_id, batch.receiptId, '关联的物理腿必须属于同一收货');
        assert.equal(leg.direction, 'IN');
        assert.equal(leg.product_id, r1ParentId);
        assert.equal(leg.valuation_status, 'VALUED');

        const batchValue = Number(movements[0].value_delta_cents);
        const batchQuantity = Number(movements[0].quantity_delta);
        totalMovementValue += batchValue;
        totalMovementQuantity += batchQuantity;

        // 逐批 Balance 增量 = 该批 Movement 合计（不得把累计 Balance 当作单笔 Movement）。
        const previous = index === 0 ? r1OpeningBalance : r1Batches[index - 1].balanceAfter;
        const current = batch.balanceAfter;
        assert.ok(current, `第 ${index + 1} 批完工后必须存在成品估值余额`);
        assert.equal(Number(current.value_cents) - Number(previous?.value_cents || 0), batchValue,
          `第 ${index + 1} 批的 Balance 金额增量必须等于该批 Movement 合计`);
        assert.equal(Number(current.quantity) - Number(previous?.quantity || 0), batchQuantity,
          `第 ${index + 1} 批的 Balance 数量增量必须等于该批 Movement 合计`);
      }

      // 各批增量加总，与期初期末 Balance 差额核对。
      const closing = readR1Balance();
      assert.ok(closing, '两批完工后必须存在成品估值余额');
      assert.equal(Number(closing.value_cents) - Number(r1OpeningBalance?.value_cents || 0), totalMovementValue,
        '各批成品 Movement 金额加总必须等于期初期末 Balance 金额差额');
      assert.equal(Number(closing.quantity) - Number(r1OpeningBalance?.quantity || 0), totalMovementQuantity,
        '各批成品 Movement 数量加总必须等于期初期末 Balance 数量差额');
      assert.equal(Number(closing.value_cents), totalMovementValue, '期末 Balance 金额必须等于各批 Movement 加总');
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

    test('G06-1 委外来源账单在共享入口一律 409；专用入口按 C-P02 会计档案过账', async () => {
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

      // C-P04 跨域边界：共享入口是普通采购的公共通道，继续拒绝委外来源账单。
      const attempts = [
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

      // 专用入口：委外加工费的正式过账（C-P01/C-P02/C-P03）。金额上界取收货
      // 生效时确认的加工费金额，借方走委外加工费科目，不照搬普通采购 GRNI。
      const posted = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-bills/${billId}/post`,
        fixture.tokens.accounting);
      assert.equal(posted.status, 200, JSON.stringify(posted.data));
      const payable = fixture.db.prepare("SELECT * FROM account_payables WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId);
      assert.ok(payable, '专用过账必须产生 canonical 应付');
      assert.equal(Number(payable.amount_cents), 5000);
      const voucher = fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='SUPPLIER_BILL' AND source_id=?").get(billId);
      assert.ok(voucher, '专用过账必须产生 canonical 凭证');
      const entries = fixture.db.prepare('SELECT e.*, s.code subject_code FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id JOIN accounting_subjects s ON s.id=e.subject_id WHERE v.id=? ORDER BY e.line_no').all(voucher.id);
      assert.deepEqual(entries.filter((entry) => entry.direction === 'DEBIT').map((entry) => entry.subject_code), ['6408'],
        '借方必须是委外加工费科目');
      assert.deepEqual(entries.filter((entry) => entry.direction === 'CREDIT').map((entry) => entry.subject_code), ['2202'],
        '贷方必须是 canonical 应付账款');
      const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.data.id);
      assert.equal(evidence.basis_status, 'FINAL', '过账后成本证据必须转 FINAL');
    });
  });
});
