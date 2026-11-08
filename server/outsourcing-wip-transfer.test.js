import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';
import { requestFingerprint } from './modules/financial-controls.js';

// OUT-001（跨委外订单 WIP 数量归属转移）的 I3a-S 安全加固证据。
//
// 合同来源：docs/design/procurement-outsourcing.md §26.34.15（OUT-001 有界批准）、
// §26.34.13.2（I3a-S-1..11）、§26.34.8（幂等）、§26.34.14.2（transferNo）。
//
// I3a-S 的正确定性是「稳定拒绝 + 固定 code + 零业务副作用 + 单次拒绝审计」：
// 它**不**产生任何转移成功记录，正向 201 属 I3a-P + I3b。
// 因此本文件**不含**任何正向 201 断言。
describe('OUT-001 委外跨单 WIP 数量归属转移：I3a-S 安全加固', () => {
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
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId, requiredQuantity, unit: 'PCS', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    const materialRow = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(order.data.id, productId);
    assert.ok(materialRow, '物料行快照缺失');
    return { orderId: order.data.id, materialRow };
  }

  async function issueWip(orderId, materialRow, quantity) {
    const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: materialRow.id, quantity, issuedDate: isoDate(0), idempotencyKey: `issue-${orderId}-${quantity}-${seq}`,
    });
    assert.equal(issued.status, 201, issued.data.error);
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

    // 0、负数、NaN、Infinity 与非法精度都必须被固定 400 拒绝（当前实现曾接受 0/负数并错误返回 201）。
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

    // 目标订单存在但没有同产品物料行
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

  test('I3a-S-6 源行存在身份余额时继续 fail closed 固定 409 IDENTITY_UNSUPPORTED，且拒绝审计恰好一条', async () => {
    const source = await createOrderWithMaterial();
    const target = await createOrderWithMaterial();
    await issueWip(source.orderId, source.materialRow, 5);
    const before = businessSnapshot();
    const auditsBefore = rejectionAuditCount(source.orderId);
    const rejected = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
      transferBody(source, target, 3));
    assert.equal(rejected.status, 409);
    assert.equal(rejected.data.code, 'OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED');
    assert.equal(businessSnapshot(), before, '409 必须零业务副作用');
    assert.equal(rejectionAuditCount(source.orderId), auditsBefore + 1, '业务拒绝必须恰好记录一条拒绝审计');
    const audit = fixture.db.prepare(
      "SELECT * FROM audit_logs WHERE action='REJECT' AND entity_type='OUTSOURCING_ORDER' AND entity_id=? ORDER BY created_at DESC"
    ).get(source.orderId);
    assert.match(audit.detail, /OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED/);
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
    // 预置一条历史幂等记录：I3a-S 自身不产生成功记录，重放分支只能由此验证。
    fixture.db.prepare(`INSERT INTO idempotency_records(id,operation_type,document_id,idempotency_key,request_fingerprint,result_json,status,created_at)
      VALUES(?,?,?,?,?,?,'SUCCEEDED',?)`).run(
      `seeded-idem-${seq}`, 'OUTSOURCING_WIP_TRANSFER', source.orderId, key, fingerprint,
      JSON.stringify({ id: `prior-transfer-${seq}`, transferNo: `WIP-XFER-${isoDate(0).replace(/-/g, '')}-PRIORSEED0001` }),
      new Date().toISOString());

    // 同 Key 同载荷 → 精确重放：不新增转移、身份、数量或成功审计。
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

    // 同 Key 异载荷 → 409 固定 code，恰好一条拒绝审计，零业务副作用。
    const before = businessSnapshot();
    const auditsBeforeConflict = rejectionAuditCount(source.orderId);
    const conflict = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
      transferBody(source, target, 4, { idempotencyKey: key }));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.code, 'OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT');
    assert.equal(rejectionAuditCount(source.orderId), auditsBeforeConflict + 1, '同键异载荷必须恰好记录一条拒绝审计');
    assert.equal(businessSnapshot(), before, '同键异载荷必须零业务副作用');
  });

  test('I3a-S-11 批次整体不产生任何转移成功记录或成功审计', async () => {
    const transfers = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_transfers').get().n;
    assert.equal(transfers, 0, 'I3a-S 不得产生任何 WIP 转移成功记录');
    assert.equal(successAuditCount(), 0, 'I3a-S 不得产生任何转移成功审计');
  });
});
