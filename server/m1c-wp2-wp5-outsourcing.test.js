// M1C-WP2..WP5 — 委外收货 / 材料执行 / 增量倒冲与成品入库 / 权限与危险写入拒绝。
//
// Contract source:
//   - Requirement docs/requirements/procurement-outsourcing.md §31.13
//     MC-REQ-03..MC-REQ-11、MC-REQ-15
//   - Active Design docs/design/procurement-outsourcing-m1-core.md §5.2..§5.5、
//     §6、§8.1、§9.1..§9.5、§10
//
// Positive evidence is produced only through the production HTTP API. The
// suite owns disposable temporary SQLite files and never touches a project,
// development or production database, and never touches MySQL.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from './db.js';
import { migrateProcurementOutsourcingSchema } from './migrations/procurement-outsourcing-schema.js';
import {
  createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedApprovedOutsourceBom,
} from './test-support/procurement-http-fixture.js';

describe('M1C WP2-WP5 outsourcing core', () => {
  let fixture;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  const countRejects = (entityType, entityId = null) => fixture.db.prepare(
    "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id IS ?",
  ).get(entityType, entityId).n;

  async function qualifySupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
    const now = new Date().toISOString();
    for (const productId of ['product-001', 'product-002']) {
      fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
        VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
        ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:${productId}`, productId, now);
    }
  }

  // 用料快照必须在 DRAFT 阶段形成，CONFIRM_PLAN / RELEASE 才可达
  // （Requirement §31.15；已批准 MC-REQ-03）。不演练耗料的用例用零耗用 BOM 行，
  // 表示该订单没有材料消耗，倒冲增量因此为 0。
  async function releaseOrder(quantity, materials = [{ productId: 'product-001', requiredQuantity: 0 }]) {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', materials, `wp2wp5-${Date.now()}-${Math.random()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: quantity, unit: 'EA',
      businessDate: isoDate(), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const id = order.data.id;
    const snap = await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/material-list`, fixture.tokens.admin, {
      items: materials.map((item) => ({ productId: item.productId, sourceWarehouseId: 'warehouse-001' })),
    });
    assert.equal(snap.status, 200, snap.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' })).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${id}/transition`, fixture.tokens.admin, { action: 'RELEASE' })).status, 200);
    return id;
  }

  async function snapshotMaterials(orderId, productIds) {
    return productIds.map((productId) => fixture.db
      .prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderId, productId).id);
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp2-wp5-');
    await qualifySupplier();
  });
  after(async () => fixture.close());

  // ---------------------------------------------------------------- WP2 ----
  test('WP2 收货表头 + 明细原子创建：缺明细 400，来源不匹配 409，业务零副作用', async () => {
    const orderId = await releaseOrder(20);
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wp2-atomic-${orderId}`);

    const before = {
      receipts: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_receipts').get().n,
      items: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_receipt_items').get().n,
    };
    const missingItems = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 2, receivedDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
    }, { 'idempotency-key': 'wp2-missing-items' });
    assert.equal(missingItems.status, 400);
    assert.equal(missingItems.data.code, 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED');

    const emptyItems = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 0, receivedDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, items: [],
    }, { 'idempotency-key': 'wp2-empty-items' });
    assert.equal(emptyItems.status, 400);
    assert.equal(emptyItems.data.code, 'OUTSOURCING_RECEIPT_ITEMS_REQUIRED');

    const mismatched = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 2, receivedDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
      items: [{ productId: 'product-001', quantity: 2, unitCode: source.unitCode,
        unitPriceCents: 10, processingPoItemId: 'po-item-not-exists', sourceNoticeItemId: source.sourceNoticeItemId }],
    }, { 'idempotency-key': 'wp2-mismatch' });
    assert.equal(mismatched.status, 409);
    assert.equal(mismatched.data.code, 'OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH');

    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_receipts').get().n, before.receipts);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_receipt_items').get().n, before.items);
  });

  test('WP2 两段式生效：质量门禁未过 409 且零副作用，PASS 后生效并产生成品与成本证据', async () => {
    const orderId = await releaseOrder(20);
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wp2-gate-${orderId}`);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 4, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 400,
      ...outsourcingReceiptBody(source, 4, 400),
    }, { 'idempotency-key': 'wp2-gate-receipt' });
    assert.equal(receipt.status, 201, receipt.data.error);
    const receiptId = receipt.data.id;
    assert.equal(fixture.db.prepare('SELECT business_status status FROM outsourcing_receipts WHERE id=?').get(receiptId).status, 'PENDING_INSPECTION');

    const inspection = await fixture.request('POST', '/api/iqc', fixture.tokens.warehouse, { outsourcing_receipt_id: receiptId });
    assert.equal(inspection.status, 201, inspection.data.error);
    // 委外完工入库默认免检（供应商侧管控，OUT-18）；本用例冻结“必须检验”的
    // 质量策略快照，使质量门禁在检验未完成时真实拒绝。
    const receiptItemId = fixture.db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=?').get(receiptId).id;
    fixture.db.prepare(`UPDATE logistics_quality_policy_snapshots SET inspection_required=1, waiver_reason=NULL
      WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?`).run(receiptId);
    if (fixture.db.prepare("SELECT COUNT(*) n FROM logistics_quality_policy_snapshots WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=?").get(receiptId).n === 0) {
      fixture.db.prepare(`INSERT INTO logistics_quality_policy_snapshots(id,source_type,source_id,source_item_id,product_id,inspection_required,sampling_mode,resolved_at)
        VALUES(?, 'OUTSOURCING_RECEIPT', ?, ?, ?, 1, 'FULL', ?)`)
        .run(`qps-${receiptId}`, receiptId, receiptItemId, 'product-001', new Date().toISOString());
    }

    const beforeEffect = {
      receipt: fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId),
      inventory: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE source_type=?').get('OUTSOURCING_RECEIPT').n,
      valuation: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type=?').get('OUTSOURCING_RECEIPT').n,
      evidences: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n,
    };
    const rejectsBefore = countRejects('OUTSOURCING_RECEIPT', receiptId);
    const blocked = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
      fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp2-gate-blocked' });
    assert.equal(blocked.status, 409, blocked.data.error);
    assert.equal(blocked.data.code, 'OUTSOURCING_QUALITY_GATE_NOT_PASSED');
    assert.deepEqual(fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId), beforeEffect.receipt);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE source_type=?').get('OUTSOURCING_RECEIPT').n, beforeEffect.inventory);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type=?').get('OUTSOURCING_RECEIPT').n, beforeEffect.valuation);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n, beforeEffect.evidences);
    assert.equal(countRejects('OUTSOURCING_RECEIPT', receiptId), rejectsBefore + 1, '409 恰好新增 1 条业务拒绝审计');

    const completed = await fixture.request('POST', `/api/iqc/${inspection.data.id}/complete`, fixture.tokens.warehouse, {
      result: 'PASS', passed_quantity: 4, failed_quantity: 0,
    });
    assert.equal(completed.status, 200, completed.data.error);

    const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
      fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp2-gate-effected' });
    assert.equal(effected.status, 200, effected.data.error);
    assert.equal(fixture.db.prepare('SELECT business_status status FROM outsourcing_receipts WHERE id=?').get(receiptId).status, 'EFFECTED');
    assert.ok(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE source_type=? AND direction=?').get('OUTSOURCING_RECEIPT', 'IN').n >= 1,
      '成品必须经 canonical Writer 入企业仓');
    assert.ok(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type=? AND status=?').get('OUTSOURCING_RECEIPT', 'POSTED').n >= 1,
      '成品入库必须形成权威估值');
    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId);
    assert.ok(evidence, '成本证据必须存在');
    assert.equal(evidence.processing_fee_actual_cents, null, '首期不得提前刷新加工费实际值');
  });

  test('WP2 收货生效逐段重读加工费 PO 来源：生效前破坏 PO 事实则零副作用拒绝', async () => {
    const orderId = await releaseOrder(20);
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wp2-provenance-${orderId}`);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 2, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 120,
      ...outsourcingReceiptBody(source, 2, 120),
    }, { 'idempotency-key': 'wp2-provenance-receipt' });
    assert.equal(receipt.status, 201, receipt.data.error);
    const receiptId = receipt.data.id;
    assert.equal(fixture.db.prepare('SELECT business_status status FROM outsourcing_receipts WHERE id=?').get(receiptId).status, 'PENDING_INSPECTION');

    // 生效前把加工费 PO 事实改坏 ⇒ 整体回滚且业务零副作用。
    fixture.db.prepare("UPDATE purchase_orders SET status='REJECTED' WHERE id=?").run(source.processingPoId);
    const beforeEffect = {
      receipt: fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId),
      inventory: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE source_type=?').get('OUTSOURCING_RECEIPT').n,
      valuation: fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type=?').get('OUTSOURCING_RECEIPT').n,
      evidences: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n,
    };
    const rejectsBefore = countRejects('OUTSOURCING_RECEIPT', receiptId);
    const effect = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receiptId}/confirm`,
      fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp2-provenance-effect' });
    assert.equal(effect.status, 409, effect.data.error);
    assert.equal(effect.data.code, 'OUTSOURCING_RECEIPT_ITEM_SOURCE_MISMATCH');
    assert.deepEqual(fixture.db.prepare('SELECT * FROM outsourcing_receipts WHERE id=?').get(receiptId), beforeEffect.receipt,
      '拒绝路径收货业务事实必须逐字段不变');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_transactions WHERE source_type=?').get('OUTSOURCING_RECEIPT').n, beforeEffect.inventory);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type=?').get('OUTSOURCING_RECEIPT').n, beforeEffect.valuation);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receiptId).n, beforeEffect.evidences);
    assert.equal(countRejects('OUTSOURCING_RECEIPT', receiptId), rejectsBefore + 1, '409 恰好新增 1 条业务拒绝审计');
  });

  test('WP2 委外收货员真实角色权限与职责分离', async () => {
    const orderId = await releaseOrder(20);
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wp2-sod-${orderId}`);

    const authorizationBefore = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION'").get().n;
    const byBusiness = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcing, {
      orderId, quantity: 2, receivedDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
      ...outsourcingReceiptBody(source, 2, 200),
    }, { 'idempotency-key': 'wp2-sod-business' });
    assert.equal(byBusiness.status, 403, '委外业务角色不得录入委外收货');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type='AUTHORIZATION'").get().n,
      authorizationBefore + 1, '403 恰好新增 1 条授权拒绝审计');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_receipts WHERE order_id=?').get(orderId).n, 0);

    const byReceiving = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 2, receivedDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId,
      ...outsourcingReceiptBody(source, 2, 200),
    }, { 'idempotency-key': 'wp2-sod-receiving' });
    assert.equal(byReceiving.status, 201, byReceiving.data.error);

    // 委外收货员不得执行委外业务动作，也不得执行材料动作。
    const orderCreate = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.outsourcingReceiving, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 1, unit: 'EA', businessDate: isoDate(),
    });
    assert.equal(orderCreate.status, 403, '委外收货员不得创建委外订单');
    const materialExecute = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`,
      fixture.tokens.outsourcingReceiving, { materialListId: 'no-such-material', quantity: 1, idempotencyKey: 'wp2-sod-material' });
    assert.equal(materialExecute.status, 403, '委外收货员不得执行委外材料动作');
  });

  // ---------------------------------------------------------------- WP3 ----
  test('WP3 发料/补料/退料经 canonical Writer，逐腿跟踪、权威估值与 WIP 身份证据成立', async () => {
    const materials = [{ productId: 'product-001', requiredQuantity: 0.02 }];
    const orderId = await releaseOrder(100, materials);
    const [materialId] = await snapshotMaterials(orderId, ['product-001']);

    const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 10, issuedDate: isoDate(), idempotencyKey: 'wp3-issue-1',
    });
    assert.equal(issue.status, 201, issue.data.error);

    const supplement = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/supplements`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 2, reason: '损耗补料', supplementDate: isoDate(), idempotencyKey: 'wp3-supplement-1',
    });
    assert.equal(supplement.status, 201, supplement.data.error);

    const returnResult = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 1, returnDate: isoDate(), idempotencyKey: 'wp3-return-1',
    });
    assert.equal(returnResult.status, 201, returnResult.data.error);

    const material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialId);
    assert.equal(Number(material.issued_quantity), 10);
    assert.equal(Number(material.supplemented_quantity), 2);
    assert.equal(Number(material.returned_quantity), 1);
    assert.equal(material.identity_evidence_state, 'VERIFIED');

    // canonical 库存腿：MOVE 必须成对（OUT + IN）。
    const eventIds = [issue.data.id, supplement.data.id, returnResult.data.id];
    const placeholders = eventIds.map(() => '?').join(',');
    const movements = fixture.db.prepare(`SELECT * FROM inventory_transactions WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN') AND source_id IN (${placeholders})`).all(...eventIds);
    assert.ok(movements.length >= 4, '每个物理动作必须有 canonical 库存腿');
    assert.equal(movements.filter((row) => row.direction === 'OUT').length, movements.filter((row) => row.direction === 'IN').length,
      'MOVE 腿必须成对');
    for (const movement of movements) {
      const valuation = fixture.db.prepare("SELECT * FROM inventory_valuation_movements WHERE inventory_transaction_id=? AND status='POSTED'").get(movement.id);
      assert.ok(valuation, '每条库存腿必须有 POSTED 的权威估值');
      assert.equal(movement.valuation_status, 'VALUED');
    }

    // 逐腿跟踪：跟踪分配数必须与物理腿数一致。
    const tracked = fixture.db.prepare(`SELECT COUNT(*) n FROM tracked_inventory_movements WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT','OUTSOURCING_RETURN') AND source_id IN (${placeholders})`).get(...eventIds).n;
    assert.equal(tracked, movements.length, '跟踪腿数必须等于实际物理腿数');

    // Supplier WIP 位置与身份证据余额守恒。
    const balance = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=?').get(materialId);
    assert.ok(balance, '必须写身份证据余额');
    assert.equal(Number(balance.supplied_quantity), 12);
    assert.equal(Number(balance.consumed_quantity), 1);
    assert.equal(Number(balance.available_quantity), 11);
    assert.equal(balance.evidence_state, 'QUANTITY_ONLY');
    assert.equal(Number(balance.available_quantity),
      Number(material.issued_quantity) + Number(material.supplemented_quantity)
      - Number(material.returned_quantity) - Number(material.backflushed_quantity),
    '身份余额必须与物料行计数守恒');

    // 幂等重放不得重复写入。
    const replay = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 10, issuedDate: isoDate(), idempotencyKey: 'wp3-issue-1',
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal(Number(fixture.db.prepare('SELECT issued_quantity q FROM outsourcing_material_list WHERE id=?').get(materialId).q), 10);
  });

  test('WP3 发料与补料的 source position 库存不足只返回专用精确错误码且业务零副作用', async () => {
    const orderId = await releaseOrder(10, [{ productId: 'product-001', requiredQuantity: 1 }]);
    const [materialId] = await snapshotMaterials(orderId, ['product-001']);
    // Negative precondition only: production HTTP has no endpoint whose
    // purpose is to force a canonical source position below the requested
    // quantity. Keep the business action itself on the real HTTP handler.
    fixture.db.prepare(`UPDATE inventory SET quantity=1
      WHERE warehouse_id='warehouse-001' AND product_id='product-001' AND active=1`).run();
    fixture.db.prepare(`UPDATE inventory_valuation_balances SET quantity=1,value_cents=1000
      WHERE warehouse_id='warehouse-001' AND product_id='product-001'`).run();
    const unavailable = 2;
    const before = {
      material: fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialId),
      transactions: fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT')").get().n,
      effects: fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effects WHERE material_list_id=?').get(materialId).n,
    };
    for (const [path, key, dates] of [
      ['issues', 'insufficient-issue', { issuedDate: isoDate() }],
      ['supplements', 'insufficient-supplement', { reason: 'test', supplementDate: isoDate() }],
    ]) {
      const result = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/${path}`, fixture.tokens.outsourcing, {
        materialListId: materialId, quantity: unavailable, idempotencyKey: key, ...dates,
      });
      assert.equal(result.status, 409, JSON.stringify(result.data));
      assert.equal(result.data.code, 'OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT');
    }
    assert.deepEqual(fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialId), before.material);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type IN ('OUTSOURCING_ISSUE','OUTSOURCING_SUPPLEMENT')").get().n, before.transactions);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_wip_identity_effects WHERE material_list_id=?').get(materialId).n, before.effects);
  });

  test('WP3 历史 WIP 不可证明的行不得被新的退料/倒冲消费', async () => {
    const materials = [{ productId: 'product-001', requiredQuantity: 0.02 }];
    const orderId = await releaseOrder(100, materials);
    const [materialId] = await snapshotMaterials(orderId, ['product-001']);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 5, issuedDate: isoDate(), idempotencyKey: 'wp3-history-issue',
    });
    // 模拟历史行：legacy_unverified_wip_quantity 为 NULL = 未证明（首期不回填）。
    fixture.db.prepare('UPDATE outsourcing_material_list SET legacy_unverified_wip_quantity=NULL WHERE id=?').run(materialId);
    const rejectsBefore = countRejects('OUTSOURCING_ORDER', orderId);
    const returnResult = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 1, returnDate: isoDate(), idempotencyKey: 'wp3-history-return',
    });
    assert.equal(returnResult.status, 409);
    assert.equal(returnResult.data.code, 'OUTSOURCING_WIP_HISTORY_UNPROVEN');
    assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 1);
    assert.equal(Number(fixture.db.prepare('SELECT returned_quantity q FROM outsourcing_material_list WHERE id=?').get(materialId).q), 0);
  });

  // ---------------------------------------------------------------- WP4 ----
  test('WP4 未批准 / 用途不符的 OUTSOURCE BOM 一律 fail closed', async () => {
    // 未批准的 OUTSOURCE BOM 必须在 DRAFT 阶段就无法形成用料快照：
    // 快照是先于确认计划建立的唯一用料事实来源（Requirement §31.15）。
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId: 'product-001', requiredQuantity: 0.02 }], `wp4-bad-${Date.now()}`);
    fixture.db.prepare("UPDATE boms SET approval_status='DRAFT' WHERE id=?").run(bomId);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, unit: 'EA',
      businessDate: isoDate(), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.outsourcing, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 409);
    assert.equal(snapshot.data.code, 'OUTSOURCING_BACKFLUSH_BASIS_UNSUPPORTED');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_material_list WHERE order_id=?').get(order.data.id).n, 0);
  });

  test('WP4 增量倒冲按每单位用量 × 累计合格收货量，材料账面价值来自权威估值，成品入企业仓且不产生 AP/GL', async () => {
    const materials = [{ productId: 'product-002', requiredQuantity: 0.005 }];
    const orderId = await releaseOrder(100, materials);
    const [materialId] = await snapshotMaterials(orderId, ['product-002']);
    const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.outsourcing, {
      materialListId: materialId, quantity: 10, issuedDate: isoDate(), idempotencyKey: 'wp4-issue',
    });
    assert.equal(issue.status, 201, issue.data.error);

    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 50, `wp4-${orderId}`);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 30, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 30000,
      ...outsourcingReceiptBody(source, 30, 30000),
    }, { 'idempotency-key': 'wp4-receipt' });
    assert.equal(receipt.status, 201, receipt.data.error);

    const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${receipt.data.id}/confirm`,
      fixture.tokens.outsourcingReceiving, {}, { 'idempotency-key': 'wp4-effect' });
    assert.equal(effected.status, 200, effected.data.error);

    const material = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(materialId);
    assert.ok(Math.abs(Number(material.backflushed_quantity) - 0.15) < 1e-9,
      `增量倒冲必须为 每单位用量 × 累计合格收货量 = 0.15，实际 ${material.backflushed_quantity}`);

    const evidence = fixture.db.prepare('SELECT * FROM outsourcing_cost_evidences WHERE outsourcing_receipt_id=?').get(receipt.data.id);
    assert.ok(evidence, '成本证据必须存在');
    assert.ok(Number(evidence.material_consumed_value_cents) > 0, '材料成本必须来自权威估值而非 0');
    assert.equal(evidence.processing_fee_actual_cents, null, '首期不得提前写入加工费实际值');

    const finished = fixture.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? AND direction='IN'").get(receipt.data.id).n;
    assert.equal(finished, 1, '成品必须以 canonical Writer 入企业仓');
    const valuation = fixture.db.prepare("SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='OUTSOURCING_RECEIPT' AND source_id=? AND status='POSTED'").get(receipt.data.id).n;
    assert.ok(valuation >= 1, '成品入库必须形成权威估值');

    // 首期不得放开委外 AP / GL。
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(receipt.data.id).n, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(source.processingPoId).n, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM supplier_bills WHERE source_outsourcing_receipt_id=?").get(receipt.data.id).n, 0);
  });

  // ---------------------------------------------------------------- WP5 ----
  test('WP5 延期能力与 VMI 危险写入一律 409 且拒绝审计恰好一次', async () => {
    const orderId = await releaseOrder(20);
    const cases = [
      { path: '/api/procurement/outsourcing/finished-returns', body: { outsourcingReceiptId: 'receipt-x', quantity: 1 }, code: 'OUTSOURCING_FINISHED_RETURN_NOT_APPROVED' },
      { path: `/api/procurement/outsourcing/orders/${orderId}/difference-apply`, body: { materialListId: 'mat-x' }, code: 'OUTSOURCING_DIFFERENCE_APPROVAL_PENDING' },
      { path: '/api/procurement/vmi/ownership-transfers', body: { vmiReceiptId: 'vmi-x' }, code: 'VMI_SETTLEMENT_POLICY_PENDING' },
    ];
    for (const item of cases) {
      const rejectsBefore = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
      const response = await fixture.request('POST', item.path, fixture.tokens.admin, item.body);
      assert.equal(response.status, 409, `${item.path} 必须 409`);
      assert.equal(response.data.code, item.code);
      const rejectsAfter = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
      assert.equal(rejectsAfter, rejectsBefore + 1, `${item.path} 必须恰好新增 1 条拒绝审计`);
    }
  });

  test('WP5 委外来源账单的共享过账与匹配入口同样被来源级 Guard 拒绝，普通采购账单不受影响', async () => {
    const orderId = await releaseOrder(20);
    const source = await prepareOutsourcingReceiptSource(fixture, orderId, 10, `wp5-gl-${orderId}`);
    const receipt = await fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.outsourcingReceiving, {
      orderId, quantity: 2, receivedDate: isoDate(), businessDate: isoDate(), processingPoId: source.processingPoId,
      sourceNoticeId: source.sourceNoticeId, warehouseId: source.warehouseId, processingFeeCents: 200,
      ...outsourcingReceiptBody(source, 2, 200),
    }, { 'idempotency-key': 'wp5-gl-receipt' });
    assert.equal(receipt.status, 201, receipt.data.error);
    const receiptItem = fixture.db.prepare('SELECT id FROM outsourcing_receipt_items WHERE receipt_id=?').get(receipt.data.id).id;

    const bill = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.outsourcing, {
      supplierId: 'supplier-001', supplierInvoiceNo: 'WP5-OUTSOURCING', billDate: isoDate(),
      idempotencyKey: 'wp5-gl-bill',
      lines: [{ outsourcingReceiptItemId: receiptItem, quantity: 2, unitPriceCents: 100 }],
    });
    assert.equal(bill.status, 201, bill.data.error);
    const billId = bill.data.id;
    assert.equal(fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(billId).status, 'DRAFT');

    for (const actor of ['admin', 'accounting']) {
      const response = await fixture.request('POST', `/api/supplier-bills/${billId}/post`, fixture.tokens[actor]);
      assert.equal(response.status, 409, `${actor} 必须被来源级 Guard 拒绝`);
      assert.equal(response.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    }
    const match = await fixture.request('POST', `/api/supplier-bills/${billId}/match`, fixture.tokens.accounting, { items: [] });
    assert.equal(match.status, 409);
    assert.equal(match.data.code, 'OUTSOURCING_GL_POLICY_NOT_APPROVED');
    assert.equal(fixture.db.prepare('SELECT status FROM supplier_bills WHERE id=?').get(billId).status, 'DRAFT');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM account_payables WHERE source_id=?").get(billId).n, 0);
  });
});

describe('M1C UNIQUE 索引（一次性临时数据库验证，不触碰项目数据库）', () => {
  let tempDir;

  before(() => { tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m1c-unique-')); });
  after(() => rmSync(tempDir, { recursive: true, force: true }));

  test('索引存在、拒绝重复非空来源、允许多个 NULL 标准 PO', () => {
    const db = createDatabase(join(tempDir, 'erp.db'));
    try {
      const indexes = db.prepare("PRAGMA index_list('purchase_orders')").all();
      const unique = indexes.find((entry) => entry.name === 'uq_purchase_orders_source_outsourcing');
      assert.ok(unique, '唯一索引必须存在');
      assert.equal(unique.unique, 1);

      const insert = db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at,source_outsourcing_order_id)
        VALUES(?,?,?,'DRAFT',0,'user-admin',?,?,?)`);
      const now = new Date().toISOString();
      insert.run('std-a', 'PO-STD-A', 'supplier-001', now, now, null);
      insert.run('std-b', 'PO-STD-B', 'supplier-001', now, now, null);
      insert.run('os-a', 'PO-OS-A', 'supplier-001', now, now, 'outsourcing-1');
      assert.throws(() => insert.run('os-b', 'PO-OS-B', 'supplier-001', now, now, 'outsourcing-1'),
        /UNIQUE constraint failed/i, '非空委外来源终身唯一');
    } finally {
      db.close();
    }
  });

  test('历史重复来源在建索引前 fail closed，不得自动选主、删除、取消或改写', () => {
    const db = createDatabase(join(tempDir, 'history.db'));
    try {
      db.exec('DROP INDEX IF EXISTS uq_purchase_orders_source_outsourcing');
      const now = new Date().toISOString();
      const insert = db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,creator_id,created_at,updated_at,source_outsourcing_order_id)
        VALUES(?,?,?,'DRAFT',0,'user-admin',?,?,?)`);
      insert.run('hist-a', 'PO-HIST-A', 'supplier-001', now, now, 'outsourcing-dup');
      insert.run('hist-b', 'PO-HIST-B', 'supplier-001', now, now, 'outsourcing-dup');
      assert.throws(() => migrateProcurementOutsourcingSchema(db), /PROCESSING_PO_SOURCE_HISTORY_CONFLICT/,
        '历史重复来源必须停止 migration');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE source_outsourcing_order_id=?').get('outsourcing-dup').n, 2,
        '不得删除、合并或改写历史行');
    } finally {
      db.close();
    }
  });
});
