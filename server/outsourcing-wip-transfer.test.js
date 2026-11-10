import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';
import { requestFingerprint } from './modules/financial-controls.js';

// OUT-001（跨委外订单 WIP 数量归属转移）的 focused 证据。
//
// 合同来源：docs/design/procurement-outsourcing.md §26.34.15（OUT-001 有界批准）、
// §26.34.13.2（I3a-S 安全加固）、§26.34.13.2b / §26.34.13.3（I3a-P + I3b 正向转移）、
// §26.34.8（幂等）、§26.34.14.2（transferNo）、§26.34.15.2（身份链权威正文）。
//
// 两批的正确定性**不同**：
//   · I3a-S —— 稳定拒绝 + 固定 code + 零业务副作用 + 单次拒绝审计；**不含**任何正向 201。
//   · I3a-P + I3b —— 合法 NONE 路径**固定 201**，身份链与数量账守恒，物理库存零新增移动。
describe('OUT-001 委外跨单 WIP 数量归属转移', () => {
  let fixture;
  let seq = 0;

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-out001-');
    await qualifyOutsourceSupplier();
  });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
    // 委外发料需要权威估值余额；没有它 issue 会被估值门禁拒绝，测不到 WIP 事实。
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('NONE:warehouse-001:product-001','MOVING_AVERAGE','product-001','warehouse-001',NULL,NULL,100,100000,?)
      ON CONFLICT(balance_key) DO NOTHING`).run(new Date().toISOString());
  }

  async function createOrderWithMaterial({ productId = 'product-001', orderQty = 100, requiredQuantity = 10 } = {}) {
    seq += 1;
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId, requiredQuantity, unit: 'PCS' }], `out001-${seq}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: orderQty, businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId, requiredQuantity, unit: 'PCS', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASE' });
    const materialRow = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(order.data.id, productId);
    assert.ok(materialRow, '物料行快照缺失');
    return { orderId: order.data.id, materialRow };
  }

  // 夹具补货：委外发料需要源仓的权威库存与估值余额；每个场景在发料前补足，
  // 避免用例之间因共享种子库存而相互干扰。补货发生在场景快照之前，
  // 因此不影响「转移不产生物理移动」的逐字段比较。
  function ensureWipStock(productId) {
    const now = new Date().toISOString();
    fixture.db.prepare(`UPDATE inventory SET quantity=quantity+1000, updated_at=?
      WHERE warehouse_id='warehouse-001' AND product_id=? AND owner_type='ENTERPRISE' AND owner_id IS NULL
        AND stock_status='AVAILABLE' AND lot_id IS NULL AND serial_id IS NULL AND active=1`).run(now, productId);
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?,'MOVING_AVERAGE',?,'warehouse-001',NULL,NULL,1000,1000000,?)
      ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity, value_cents=excluded.value_cents, updated_at=excluded.updated_at`)
      .run(`NONE:warehouse-001:${productId}`, productId, now);
  }

  async function issueWip(orderId, materialRow, quantity) {
    ensureWipStock(materialRow.product_id);
    const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: materialRow.id, quantity, issuedDate: isoDate(0), idempotencyKey: `issue-${orderId}-${quantity}-${seq}`,
    });
    assert.equal(issued.status, 201, issued.data.error);
    return issued;
  }

  function transferBody(source, target, quantity, extra = {}) {
    return {
      sourceOrderId: source.orderId,
      targetOrderId: target.orderId,
      materialListId: source.materialRow.id,
      quantity,
      transferDate: isoDate(0),
      idempotencyKey: `xfer-${source.orderId}-${target.orderId}-${quantity}-${Math.random()}`,
      ...extra,
    };
  }

  // 业务事实逐字段快照：转移表、幂等记录、身份账、物料行数量、库存、估值、AP/GL。
  function businessSnapshot() {
    const tables = [
      'outsourcing_wip_transfers', 'idempotency_records', 'outsourcing_wip_identity_effects',
      'outsourcing_wip_identity_effect_allocations', 'outsourcing_wip_identity_balances',
      'outsourcing_material_list', 'inventory', 'inventory_transactions', 'tracked_inventory_movements',
      'inventory_mutation_log', 'inventory_valuation_movements', 'inventory_valuation_balances',
      'supplier_bills', 'supplier_bill_items', 'account_payables', 'accounting_vouchers', 'accounting_entries',
    ];
    const snapshot = {};
    for (const table of tables) {
      snapshot[table] = fixture.db.prepare(`SELECT * FROM ${table}`).all();
    }
    return JSON.stringify(snapshot);
  }

  // 物理库存 / 估值 / 财务副作用快照：逻辑数量归属转移不得改动这些表。
  function physicalAndFinanceSnapshot() {
    const tables = [
      'inventory', 'inventory_transactions', 'tracked_inventory_movements', 'inventory_mutation_log',
      'inventory_valuation_movements', 'inventory_valuation_balances',
      'supplier_bills', 'supplier_bill_items', 'account_payables', 'accounting_vouchers', 'accounting_entries',
    ];
    const snapshot = {};
    for (const table of tables) {
      snapshot[table] = fixture.db.prepare(`SELECT * FROM ${table}`).all();
    }
    return JSON.stringify(snapshot);
  }

  function rejectionAuditCount(orderId) {
    return Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_ORDER' AND entity_id=?"
    ).get(orderId).n);
  }

  function successAuditCount() {
    return Number(fixture.db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE action='TRANSFER' AND entity_type='OUTSOURCING_WIP_TRANSFER'"
    ).get().n);
  }

  function materialRow(id) {
    return fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(id);
  }

  function identityBalance(materialListId) {
    return fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key=?')
      .get(materialListId, 'NONE');
  }

  // ── 第一批：I3a-S 安全加固 ────────────────────────────────────────────────
  describe('I3a-S 安全加固：请求合同、门禁与幂等（不含正向 201）', () => {
    let baselineTransfers = 0;
    let baselineSuccessAudits = 0;
    before(() => {
      baselineTransfers = Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n);
      baselineSuccessAudits = successAuditCount();
    });

    test('I3a-S-1 请求合同：缺幂等键、非法数量、非法日期、同源同目标、缺字段一律 400 且零业务写入', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      const before = businessSnapshot();

      const missingKey = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: target.orderId, materialListId: source.materialRow.id, quantity: 3, transferDate: isoDate(0),
      });
      assert.equal(missingKey.status, 400);
      assert.equal(missingKey.data.code, 'IDEMPOTENCY_KEY_REQUIRED');

      const blankKey = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: target.orderId, materialListId: source.materialRow.id, quantity: 3, transferDate: isoDate(0), idempotencyKey: '   ',
      });
      assert.equal(blankKey.status, 400);
      assert.equal(blankKey.data.code, 'IDEMPOTENCY_KEY_REQUIRED');

      // 0、负数、NaN、Infinity 与非法精度都必须被固定 400 拒绝（修复前曾接受 0/负数并可能返回错误的 201）。
      const illegalQuantities = [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.23456789];
      for (const quantity of illegalQuantities) {
        const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
          sourceOrderId: source.orderId, targetOrderId: target.orderId, materialListId: source.materialRow.id,
          quantity, transferDate: isoDate(0), idempotencyKey: `bad-qty-${quantity}-${seq}`,
        });
        assert.equal(rejected.status, 400, `quantity=${quantity} 必须 400，实际 ${rejected.status}`);
        assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_INVALID_QUANTITY', `quantity=${quantity}`);
      }

      const badDate = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: target.orderId, materialListId: source.materialRow.id,
        quantity: 3, transferDate: '2026-02-31', idempotencyKey: `bad-date-${seq}`,
      });
      assert.equal(badDate.status, 400);
      assert.equal(badDate.data.code, 'OUTSOURCING_WIP_TRANSFER_INVALID_DATE');

      const sameOrder = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: source.orderId, materialListId: source.materialRow.id,
        quantity: 3, transferDate: isoDate(0), idempotencyKey: `same-order-${seq}`,
      });
      assert.equal(sameOrder.status, 400);
      assert.equal(sameOrder.data.code, 'OUTSOURCING_WIP_TRANSFER_SAME_ORDER');

      const missingField = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: target.orderId, quantity: 3, transferDate: isoDate(0), idempotencyKey: `missing-field-${seq}`,
      });
      assert.equal(missingField.status, 400);
      assert.equal(missingField.data.code, 'OUTSOURCING_WIP_TRANSFER_INVALID_INPUT');

      assert.equal(businessSnapshot(), before, '400 输入错误必须零业务写入');
      assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='OUTSOURCING_WIP_TRANSFER'").get().n, 0, '400 不得写幂等记录');
    });

    test('I3a-S-1 权限：无委外材料执行权限一律 403 且零业务写入', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      const before = businessSnapshot();
      const denied = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.sales,
        transferBody(source, target, 3));
      assert.equal(denied.status, 403);
      assert.equal(businessSnapshot(), before, '403 必须零业务写入');
    });

    test('I3a-S-2/11 事务内权威重读：源行、源订单、目标订单、目标行不存在分别 404', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      // 目标订单存在但没有同产品物料行
      const otherProductOrder = await createOrderWithMaterial({ productId: 'product-002' });
      const before = businessSnapshot();

      const noSourceRow = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: target.orderId, materialListId: 'material-does-not-exist',
        quantity: 3, transferDate: isoDate(0), idempotencyKey: `no-source-row-${seq}`,
      });
      assert.equal(noSourceRow.status, 404);

      const noSourceOrder = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: 'order-does-not-exist', targetOrderId: target.orderId, materialListId: source.materialRow.id,
        quantity: 3, transferDate: isoDate(0), idempotencyKey: `no-source-order-${seq}`,
      });
      assert.equal(noSourceOrder.status, 404);

      const noTargetOrder = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: 'order-does-not-exist', materialListId: source.materialRow.id,
        quantity: 3, transferDate: isoDate(0), idempotencyKey: `no-target-order-${seq}`,
      });
      assert.equal(noTargetOrder.status, 404);

      const noTargetRow = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, {
        sourceOrderId: source.orderId, targetOrderId: otherProductOrder.orderId, materialListId: source.materialRow.id,
        quantity: 3, transferDate: isoDate(0), idempotencyKey: `no-target-row-${seq}`,
      });
      assert.equal(noTargetRow.status, 404);

      assert.equal(businessSnapshot(), before, '404 必须零业务写入');
    });

    test('I3a-S-9 目标行不唯一固定 409 TARGET_NOT_UNIQUE', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      const now = new Date().toISOString();
      fixture.db.prepare(`INSERT INTO outsourcing_material_list(id,order_id,product_id,required_quantity,unit,issued_quantity,supplemented_quantity,returned_quantity,backflushed_quantity,bom_snapshot_json,source_warehouse_id,legacy_unverified_wip_quantity,identity_evidence_state,created_at,updated_at)
        VALUES(?,?,?,0,'EA',0,0,0,0,'{}','warehouse-001',0,'NONE',?,?)`)
        .run(`dup-target-${seq}`, target.orderId, source.materialRow.product_id, now, now);
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_TARGET_NOT_UNIQUE');
      assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    });

    test('I3a-S-9 源行单位与产品基础单位不一致固定 409 UOM_MISMATCH', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      fixture.db.prepare('UPDATE outsourcing_material_list SET unit=? WHERE id=?').run('PCS', source.materialRow.id);
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH');
      assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    });

    test('I3a-S-2 跨供应商固定 409 SUPPLIER_MISMATCH', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      fixture.db.prepare('UPDATE outsourcing_orders SET supplier_id=? WHERE id=?').run('supplier-002', target.orderId);
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_SUPPLIER_MISMATCH');
      assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    });

    test('I3a-S-2 订单状态不允许固定 409 ORDER_STATE_INVALID', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      fixture.db.prepare("UPDATE outsourcing_orders SET status='COMPLETED' WHERE id=?").run(target.orderId);
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_ORDER_STATE_INVALID');
      assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    });

    test('I3a-S-7 历史 WIP 不可证明固定 409 SOURCE_UNVERIFIED', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      fixture.db.prepare('UPDATE outsourcing_material_list SET legacy_unverified_wip_quantity=NULL WHERE id=?').run(source.materialRow.id);
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED');
      assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    });

    test('I3a-S-4 超额固定 409 OVERDRAW 且零副作用', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const before = businessSnapshot();
      const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 9999));
      assert.equal(rejected.status, 409);
      assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
      assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    });

    test('I3a-S-3 幂等三态：缺键 400、同键异载荷 409 且恰好一条拒绝审计、精确重放零新增业务事实', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const key = `out001-idem-${seq}`;
      const payload = {
        sourceOrderId: source.orderId,
        targetOrderId: target.orderId,
        materialListId: source.materialRow.id,
        quantity: 3,
        uom: String(source.materialRow.unit || '').toUpperCase(),
        transferDate: isoDate(0),
        identityKey: 'NONE',
      };
      const fingerprint = requestFingerprint(payload);
      // 预置一条历史幂等记录：精确重放分支必须返回已持久化结果且零新增业务事实。
      fixture.db.prepare(`INSERT INTO idempotency_records(id,operation_type,document_id,idempotency_key,request_fingerprint,result_json,status,created_at)
        VALUES(?,?,?,?,?,?,'SUCCEEDED',?)`).run(
        `seeded-idem-${seq}`, 'OUTSOURCING_WIP_TRANSFER', source.orderId, key, fingerprint,
        JSON.stringify({ id: `prior-transfer-${seq}`, transferNo: `WIP-XFER-${isoDate(0).replace(/-/g, '')}-PRIORSEED0001` }),
        new Date().toISOString());

      const transfersBefore = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n;
      const auditsBefore = successAuditCount();
      const replayed = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3, { idempotencyKey: key }));
      assert.equal(replayed.status, 201);
      assert.equal(replayed.data.replayed, true);
      assert.equal(replayed.data.id, `prior-transfer-${seq}`);
      assert.equal(replayed.data.transferNo, `WIP-XFER-${isoDate(0).replace(/-/g, '')}-PRIORSEED0001`);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n, transfersBefore, '精确重放不得新增转移事实');
      assert.equal(successAuditCount(), auditsBefore, '精确重放不得新增成功审计');

      const before = businessSnapshot();
      const auditsBeforeConflict = rejectionAuditCount(source.orderId);
      const conflict = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 4, { idempotencyKey: key }));
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, 'OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT');
      assert.equal(rejectionAuditCount(source.orderId), auditsBeforeConflict + 1, '同键异载荷必须恰好记录一条拒绝审计');
      assert.equal(businessSnapshot(), before, '同键异载荷必须零业务副作用');
    });

    test('I3a-S-11 本安全加固场景不产生任何转移成功记录或成功审计', () => {
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n, baselineTransfers,
        'I3a-S 场景不得产生任何 WIP 转移成功记录');
      assert.equal(successAuditCount(), baselineSuccessAudits, 'I3a-S 场景不得产生任何转移成功审计');
    });
  });

  // ── 第二批：I3a-P + I3b 正向转移 ──────────────────────────────────────────
  describe('I3a-P + I3b 正向转移：合法 NONE 身份数量归属转移', () => {
    test('I3a-P-1/3/5 合法转移固定 201：源减目标增，物料行数量与身份余额同时守恒', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);

      const transfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(transfer.status, 201, JSON.stringify(transfer.data));
      assert.ok(transfer.data.id, '必须返回转移事实 id');
      assert.match(transfer.data.transferNo, /^WIP-XFER-\d{8}-[0-9A-F]{12}$/, 'transferNo 必须使用 §26.34.14.2 的稳定编号方案');
      assert.equal(transfer.data.replayed, undefined, '首次成功不得带 replayed 标记');

      // 物料行数量：源 5 → 2，目标 0 → 3
      const sourceRow = materialRow(source.materialRow.id);
      const targetRow = materialRow(target.materialRow.id);
      assert.equal(Number(sourceRow.issued_quantity), 2);
      assert.equal(Number(targetRow.issued_quantity), 3);
      assert.equal(String(targetRow.identity_evidence_state), 'VERIFIED');

      // 身份余额：源 available 5 → 2，目标 available 0 → 3
      const sourceBalance = identityBalance(source.materialRow.id);
      const targetBalance = identityBalance(target.materialRow.id);
      assert.equal(Number(sourceBalance.supplied_quantity), 5);
      assert.equal(Number(sourceBalance.consumed_quantity), 3);
      assert.equal(Number(sourceBalance.available_quantity), 2);
      assert.equal(Number(targetBalance.supplied_quantity), 3);
      assert.equal(Number(targetBalance.consumed_quantity), 0);
      assert.equal(Number(targetBalance.available_quantity), 3);

      // 数量账与身份账逐项对账
      assert.equal(Number(sourceBalance.available_quantity),
        Number(sourceRow.issued_quantity) + Number(sourceRow.supplemented_quantity)
        - Number(sourceRow.returned_quantity) - Number(sourceRow.backflushed_quantity));
      assert.equal(Number(targetBalance.available_quantity),
        Number(targetRow.issued_quantity) + Number(targetRow.supplemented_quantity)
        - Number(targetRow.returned_quantity) - Number(targetRow.backflushed_quantity));

      // 转移事实
      const fact = fixture.db.prepare('SELECT * FROM outsourcing_wip_transfers WHERE id=?').get(transfer.data.id);
      assert.equal(fact.transfer_no, transfer.data.transferNo);
      assert.equal(fact.source_order_id, source.orderId);
      assert.equal(fact.target_order_id, target.orderId);
      assert.equal(fact.material_list_id, target.materialRow.id, '既有 material_list_id 语义保持为**目标行**');
      assert.equal(Number(fact.quantity), 3);
      assert.equal(fact.business_status, 'CONFIRMED');

      // 已转走的源容量不得再被消费：源剩余 2，再转 3 必须固定 409 超额拒绝。
      const again = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(again.status, 409);
      assert.equal(again.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
      assert.equal(Number(materialRow(source.materialRow.id).issued_quantity), 2, '被拒绝的转移不得改变源数量');
      assert.equal(Number(identityBalance(source.materialRow.id).available_quantity), 2, '被拒绝的转移不得改变身份可用量');
    });

    test('I3a-P-1/2 身份链：TRANSFER_OUT=源行 CONSUME、TRANSFER_ORIGIN 指向原始 SUPPLY、TRANSFER_IN=目标行 SUPPLY 且经 source_effect_id 关联', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const transfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(transfer.status, 201, JSON.stringify(transfer.data));

      const effects = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE business_event_id=?').all(transfer.data.id);
      assert.equal(effects.length, 2, '一次转移必须恰好产生两个身份 effect');
      const transferOut = effects.find((effect) => effect.event_type === 'TRANSFER_OUT');
      const transferIn = effects.find((effect) => effect.event_type === 'TRANSFER_IN');
      assert.ok(transferOut, '缺少 TRANSFER_OUT effect');
      assert.ok(transferIn, '缺少 TRANSFER_IN effect');

      // C1：TRANSFER_OUT = 源行 CONSUME
      assert.equal(transferOut.material_list_id, source.materialRow.id);
      assert.equal(transferOut.effect_direction, 'CONSUME');
      assert.equal(Number(transferOut.signed_quantity), -3);
      // C3：TRANSFER_IN = 目标行 SUPPLY
      assert.equal(transferIn.material_list_id, target.materialRow.id);
      assert.equal(transferIn.effect_direction, 'SUPPLY');
      assert.equal(Number(transferIn.signed_quantity), 3);
      // C4：TRANSFER_IN 经 source_effect_id 关联对应 TRANSFER_OUT
      assert.equal(transferIn.source_effect_id, transferOut.id);
      // C6：两侧 business_event_id 关联同一个 WIP Transfer ID
      assert.equal(transferOut.business_event_id, transfer.data.id);
      assert.equal(transferIn.business_event_id, transfer.data.id);

      // C2：TRANSFER_ORIGIN 分配指向合法的原始 SUPPLY effect
      const allocations = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_effect_allocations WHERE effect_id=?').all(transferOut.id);
      assert.equal(allocations.length, 1);
      assert.equal(allocations[0].allocation_kind, 'TRANSFER_ORIGIN');
      assert.equal(Number(allocations[0].allocated_quantity), 3);
      const originSupply = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE id=?').get(allocations[0].source_supply_effect_id);
      assert.ok(originSupply, 'TRANSFER_ORIGIN 必须指向一个存在的原始供给 effect');
      assert.equal(originSupply.effect_direction, 'SUPPLY', '供给来源必须是 SUPPLY effect');
      assert.equal(originSupply.material_list_id, source.materialRow.id);
      assert.ok(['ISSUE', 'SUPPLEMENT'].includes(originSupply.event_type));
      assert.equal(Number(originSupply.signed_quantity), 5);

      // C5：禁止把 TRANSFER_OUT 作为 source_supply_effect_id 的供给来源
      const transferOutAsSource = fixture.db.prepare(
        'SELECT COUNT(*) n FROM outsourcing_wip_identity_effect_allocations WHERE source_supply_effect_id=?'
      ).get(transferOut.id).n;
      assert.equal(Number(transferOutAsSource), 0, 'TRANSFER_OUT 不得成为任何分配的供给来源');
      // TRANSFER_IN 只经 source_effect_id 表达关联，不得有分配行
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effect_allocations WHERE effect_id=?').get(transferIn.id).n, 0);

      // 供给剩余：原始供给 5 的累计分配不得超过 5
      const allocated = Number(fixture.db.prepare(
        'SELECT COALESCE(SUM(allocated_quantity),0) q FROM outsourcing_wip_identity_effect_allocations WHERE source_supply_effect_id=?'
      ).get(originSupply.id).q);
      assert.ok(allocated <= Number(originSupply.signed_quantity), '供给累计分配不得超过原供给');
    });

    test('I3b-2/I3b-4 transferId 可双向反查源行、源订单、目标行与目标订单', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const transfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(transfer.status, 201, JSON.stringify(transfer.data));

      const transferOut = fixture.db.prepare(
        "SELECT * FROM outsourcing_wip_identity_effects WHERE business_event_id=? AND event_type='TRANSFER_OUT'"
      ).get(transfer.data.id);
      const transferIn = fixture.db.prepare(
        "SELECT * FROM outsourcing_wip_identity_effects WHERE business_event_id=? AND event_type='TRANSFER_IN'"
      ).get(transfer.data.id);
      const sourceRow = materialRow(transferOut.material_list_id);
      const targetRow = materialRow(transferIn.material_list_id);
      assert.equal(sourceRow.order_id, source.orderId, 'transferId 必须可反查源订单');
      assert.equal(targetRow.order_id, target.orderId, 'transferId 必须可反查目标订单');
      assert.equal(transferOut.business_event_item_id, source.materialRow.id);
      assert.equal(transferIn.business_event_item_id, target.materialRow.id);
    });

    test('I3a-P 幂等：首次 201、精确重放 201 且零新增事实、同 Key 异载荷 409', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const key = `out001-pos-${seq}`;
      const body = transferBody(source, target, 3, { idempotencyKey: key });

      const first = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, body);
      assert.equal(first.status, 201, JSON.stringify(first.data));
      assert.equal(first.data.replayed, undefined);

      const transfersAfterFirst = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n;
      const effectsAfterFirst = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effects').get().n;
      const auditsAfterFirst = successAuditCount();
      const sourceAfterFirst = Number(materialRow(source.materialRow.id).issued_quantity);
      const targetAfterFirst = Number(materialRow(target.materialRow.id).issued_quantity);

      const replay = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin, body);
      assert.equal(replay.status, 201);
      assert.equal(replay.data.replayed, true);
      assert.equal(replay.data.id, first.data.id);
      assert.equal(replay.data.transferNo, first.data.transferNo);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n, transfersAfterFirst, '精确重放不得新增转移事实');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effects').get().n, effectsAfterFirst, '精确重放不得新增身份 effect');
      assert.equal(successAuditCount(), auditsAfterFirst, '精确重放不得新增成功审计');
      assert.equal(Number(materialRow(source.materialRow.id).issued_quantity), sourceAfterFirst, '精确重放不得改变源数量');
      assert.equal(Number(materialRow(target.materialRow.id).issued_quantity), targetAfterFirst, '精确重放不得改变目标数量');

      const auditsBeforeConflict = rejectionAuditCount(source.orderId);
      const conflict = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 4, { idempotencyKey: key }));
      assert.equal(conflict.status, 409);
      assert.equal(conflict.data.code, 'OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT');
      assert.equal(rejectionAuditCount(source.orderId), auditsBeforeConflict + 1, '同键异载荷必须恰好一条拒绝审计');
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n, transfersAfterFirst, '同键异载荷不得新增转移事实');
    });

    test('I3a-P 负向：非法数量 400、超额 409、历史不明 409、LOT/SERIAL 409、目标不唯一 409', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);

      const illegal = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 0));
      assert.equal(illegal.status, 400);
      assert.equal(illegal.data.code, 'OUTSOURCING_WIP_TRANSFER_INVALID_QUANTITY');

      const overdraw = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 6));
      assert.equal(overdraw.status, 409);
      assert.equal(overdraw.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');

      // 目标不唯一
      const now = new Date().toISOString();
      fixture.db.prepare(`INSERT INTO outsourcing_material_list(id,order_id,product_id,required_quantity,unit,issued_quantity,supplemented_quantity,returned_quantity,backflushed_quantity,bom_snapshot_json,source_warehouse_id,legacy_unverified_wip_quantity,identity_evidence_state,created_at,updated_at)
        VALUES(?,?,?,0,'EA',0,0,0,0,'{}','warehouse-001',0,'NONE',?,?)`)
        .run(`dup-target-pos-${seq}`, target.orderId, source.materialRow.product_id, now, now);
      const notUnique = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(notUnique.status, 409);
      assert.equal(notUnique.data.code, 'OUTSOURCING_WIP_TRANSFER_TARGET_NOT_UNIQUE');
      fixture.db.prepare('DELETE FROM outsourcing_material_list WHERE id=?').run(`dup-target-pos-${seq}`);

      // 历史不明
      fixture.db.prepare('UPDATE outsourcing_material_list SET legacy_unverified_wip_quantity=NULL WHERE id=?').run(source.materialRow.id);
      const unproven = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(unproven.status, 409);
      assert.equal(unproven.data.code, 'OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED');
      fixture.db.prepare('UPDATE outsourcing_material_list SET legacy_unverified_wip_quantity=0 WHERE id=?').run(source.materialRow.id);

      // LOT/SERIAL 跟踪产品：身份归属未批准，继续 fail closed
      const lotSource = await createOrderWithMaterial({ productId: 'product-002' });
      const lotTarget = await createOrderWithMaterial({ productId: 'product-002' });
      fixture.db.prepare("UPDATE products SET tracking_policy='LOT' WHERE id='product-002'").run();
      try {
        const tracked = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
          transferBody(lotSource, lotTarget, 3));
        assert.equal(tracked.status, 409);
        assert.equal(tracked.data.code, 'OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED');
      } finally {
        fixture.db.prepare("UPDATE products SET tracking_policy='NONE' WHERE id='product-002'").run();
      }
    });

    test('I3a-P 并发：同源不同 Key 竞争不得超额或双写', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const transfersBefore = Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n);

      const responses = await Promise.all([
        fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
          transferBody(source, target, 3, { idempotencyKey: `race-a-${seq}` })),
        fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
          transferBody(source, target, 3, { idempotencyKey: `race-b-${seq}` })),
      ]);
      const created = responses.filter((response) => response.status === 201);
      const rejected = responses.filter((response) => response.status === 409);
      assert.equal(created.length, 1, '并发下只允许一个请求成功');
      assert.equal(rejected.length, 1, '并发败方必须是固定 409');
      assert.equal(rejected[0].data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
      assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n), transfersBefore + 1, '并发不得双写转移事实');
      assert.equal(Number(materialRow(source.materialRow.id).issued_quantity), 2, '源剩余必须等于初始可用减转移量');
      assert.equal(Number(materialRow(target.materialRow.id).issued_quantity), 3);
      assert.equal(Number(identityBalance(source.materialRow.id).available_quantity), 2);
      assert.equal(Number(identityBalance(target.materialRow.id).available_quantity), 3);
    });

    test('OUT-001 边界：目标行 UOM 与源行/产品基础单位不一致固定 409 UOM_MISMATCH，零业务副作用、单次拒绝审计', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);

      // 情形一：源行 PCS、目标行 BOX —— 两侧都与产品基础单位不一致。
      fixture.db.prepare('UPDATE outsourcing_material_list SET unit=? WHERE id=?').run('PCS', source.materialRow.id);
      fixture.db.prepare('UPDATE outsourcing_material_list SET unit=? WHERE id=?').run('BOX', target.materialRow.id);
      const beforeMismatch = businessSnapshot();
      const auditsBefore = rejectionAuditCount(source.orderId);
      const mismatch = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(mismatch.status, 409);
      assert.equal(mismatch.data.code, 'OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH');
      assert.equal(businessSnapshot(), beforeMismatch, 'UOM 不一致必须零业务副作用（转移事实/身份 effect/物料数量/幂等记录/库存与财务事实）');
      assert.equal(rejectionAuditCount(source.orderId), auditsBefore + 1, 'UOM 拒绝必须恰好记录一条拒绝审计');

      // 情形二：源行与产品基础单位一致、只有目标行 BOX —— 隔离验证目标行 UOM 门禁本身生效。
      fixture.db.prepare('UPDATE outsourcing_material_list SET unit=? WHERE id=?').run('EA', source.materialRow.id);
      const beforeTargetOnly = businessSnapshot();
      const auditsBeforeTarget = rejectionAuditCount(source.orderId);
      const targetOnly = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(targetOnly.status, 409);
      assert.equal(targetOnly.data.code, 'OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH');
      assert.equal(businessSnapshot(), beforeTargetOnly, '目标行 UOM 不一致必须零业务副作用');
      assert.equal(rejectionAuditCount(source.orderId), auditsBeforeTarget + 1, '目标行 UOM 拒绝必须恰好记录一条拒绝审计');

      // 恢复一致单位后，同一源行必须可正常转移（证明上述拒绝来自 UOM 门禁本身）。
      fixture.db.prepare('UPDATE outsourcing_material_list SET unit=? WHERE id=?').run('EA', target.materialRow.id);
      const allowed = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(allowed.status, 201, JSON.stringify(allowed.data));
    });

    test('OUT-001 边界：A→B→C 多级转移：TRANSFER_ORIGIN 只认原始 ISSUE/SUPPLEMENT 供给，第二次转移固定 409 且零副作用', async () => {
      const orderA = await createOrderWithMaterial();
      const orderB = await createOrderWithMaterial();
      const orderC = await createOrderWithMaterial();
      await issueWip(orderA.orderId, orderA.materialRow, 5);

      // A → B：合法转移，TRANSFER_ORIGIN 必须指向 A 的原始 ISSUE SUPPLY effect。
      const first = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(orderA, orderB, 3));
      assert.equal(first.status, 201, JSON.stringify(first.data));
      const transferOutA = fixture.db.prepare(
        "SELECT * FROM outsourcing_wip_identity_effects WHERE business_event_id=? AND event_type='TRANSFER_OUT'"
      ).get(first.data.id);
      const transferInB = fixture.db.prepare(
        "SELECT * FROM outsourcing_wip_identity_effects WHERE business_event_id=? AND event_type='TRANSFER_IN'"
      ).get(first.data.id);
      assert.equal(transferOutA.material_list_id, orderA.materialRow.id);
      assert.equal(transferInB.material_list_id, orderB.materialRow.id);
      const originAllocation = fixture.db.prepare(
        "SELECT * FROM outsourcing_wip_identity_effect_allocations WHERE effect_id=? AND allocation_kind='TRANSFER_ORIGIN'"
      ).get(transferOutA.id);
      assert.ok(originAllocation, 'A→B 必须产生 TRANSFER_ORIGIN 分配');
      const originSupply = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_effects WHERE id=?')
        .get(originAllocation.source_supply_effect_id);
      assert.equal(originSupply.effect_direction, 'SUPPLY');
      assert.equal(originSupply.event_type, 'ISSUE', 'TRANSFER_ORIGIN 必须指向原始 ISSUE 供给');
      assert.equal(originSupply.material_list_id, orderA.materialRow.id);
      assert.notEqual(originSupply.id, transferInB.id, 'TRANSFER_IN 不得冒充原始供给');

      // B → C：B 的 WIP 全部来自 A 的 TRANSFER_IN，没有可覆盖的原始 ISSUE/SUPPLEMENT 供给。
      const beforeSecond = businessSnapshot();
      const auditsBefore = rejectionAuditCount(orderB.orderId);
      const second = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(orderB, orderC, 3));
      assert.equal(second.status, 409);
      assert.equal(second.data.code, 'OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED');
      assert.equal(businessSnapshot(), beforeSecond, '第二次转移必须零业务副作用');
      assert.equal(rejectionAuditCount(orderB.orderId), auditsBefore + 1, '第二次转移拒绝必须恰好记录一条拒绝审计');
      assert.equal(fixture.db.prepare(
        'SELECT COUNT(*) n FROM outsourcing_wip_identity_effect_allocations WHERE source_supply_effect_id=?'
      ).get(transferInB.id).n, 0, 'TRANSFER_IN 不得被当作原始供给来源');

      // A→B 的合法 201 不受影响。
      assert.equal(Number(materialRow(orderA.materialRow.id).issued_quantity), 2);
      assert.equal(Number(materialRow(orderB.materialRow.id).issued_quantity), 3);
      assert.equal(Number(identityBalance(orderA.materialRow.id).available_quantity), 2);
      assert.equal(Number(identityBalance(orderB.materialRow.id).available_quantity), 3);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers WHERE id=?').get(first.data.id).n, 1);
      assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effects WHERE business_event_id=?').get(first.data.id).n, 2);
    });

    test('I3a-P-4 转移不新增物理库存移动、估值、AP 或 GL', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const before = physicalAndFinanceSnapshot();
      const transfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(transfer.status, 201, JSON.stringify(transfer.data));
      assert.equal(physicalAndFinanceSnapshot(), before, '逻辑数量归属转移不得产生物理库存、估值或财务副作用');
    });

    test('I3a-P 成功审计恰好一条，且与拒绝审计不重复', async () => {
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const auditsBefore = successAuditCount();
      const rejectionsBefore = rejectionAuditCount(source.orderId);
      const transfer = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3));
      assert.equal(transfer.status, 201, JSON.stringify(transfer.data));
      assert.equal(successAuditCount(), auditsBefore + 1, '成功转移必须恰好一条成功审计');
      assert.equal(rejectionAuditCount(source.orderId), rejectionsBefore, '成功路径不得写拒绝审计');
      const audit = fixture.db.prepare(
        "SELECT * FROM audit_logs WHERE action='TRANSFER' AND entity_type='OUTSOURCING_WIP_TRANSFER' ORDER BY created_at DESC"
      ).get();
      assert.equal(audit.entity_id, transfer.data.id);
    });
  });
});
