// M1C-WP7A-R2 —— G03「同一外部幂等键、异内容拒绝」的拒绝审计。
//
// 合同锚点：Requirement §31.13.5 G03 行「失败时**业务**零副作用 + 拒绝审计**恰好 1 条**」；
// Active Design §13.1 G03 行的拒绝列与零副作用列同样要求「拒绝审计恰好 1 条」。
//
// 本文件覆盖 ISSUE / SUPPLEMENT / RETURN 三条委外物料动作路径，各自证明：
//   1. 第一次合法请求成功；
//   2. 同一外部幂等键、不同内容返回 409；
//   3. G03 业务事实逐字段零变化；
//   4. 对应业务实体的 REJECT 审计**恰好新增 1 条**。
//
// ---------------------------------------------------------------------------
// 缺陷定位与修复状态（Owner 已单独授权 D-G03-001 最小 Implementation）
//
// 静态定位：`server/modules/outsourcing.js` 的三条路径把幂等冲突检查放在业务
// try/catch **之外**：
//
//   issueMaterial      `outsourcing.js:474`  const replay = idempotencyReplay(...)
//                      `outsourcing.js:477`  try { transaction(...) { ... } }
//                      `outsourcing.js:490`  } catch (error) { auditRejectedBusinessRule(...) }
//   supplementMaterial `outsourcing.js:507` / `:510` / `:523`
//   returnMaterial     `outsourcing.js:535` / `:538` / `:551`
//
// 而 `idempotencyReplay()` 在「同一幂等键不能用于不同请求内容」时**抛出** 409
// （`server/modules/financial-controls.js:56`）。该抛出发生在 try/catch 之前，
// 因此**绕过** `auditRejectedBusinessRule()`（`outsourcing.js:76`），拒绝审计**缺失**。
//
// 对照：`createOutsourcingProcessingPo`（`outsourcing.js:322`）与
// `confirmOutsourcingReceipt`（`server/modules/outsourcing-finance.js:116-122`）
// 都把 `idempotencyReplay()` 包在会写拒绝审计的 catch 里。
//
// 修复前红灯证据：三条冲突请求均为 409、业务事实无变化，但 REJECT 审计增量为 0；
// 负控移除 ISSUE 审计调用后，仅 ISSUE 断言失败。Owner 授权修复后，本文件三例通过。
// 本文件不放宽业务约束、不跳过断言；修复仅将 idempotencyReplay() 的冲突异常纳入
// 对应 Handler 的既有拒绝审计边界。
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { createProcurementFixture, seedOutsourceSource } from './test-support/procurement-http-fixture.js';
import {
  G03_BUSINESS_FACT_TABLES, changedTables, snapshotTables,
} from './test-support/m1-core-g03-g04-evidence.js';

const PARENT_CODE = 'WP7A-C-FG';
const MATERIAL_CODE = 'WP7A-C-MAT';
const SOURCE_WAREHOUSE = 'warehouse-001';
const WIP_WAREHOUSE = 'warehouse-002';

describe('M1C-WP7A-R2 — G03 同外部幂等键异内容拒绝的审计', () => {
  let fixture;
  let parentId;
  let materialId;
  let orderId;

  const isoDate = (offset = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offset);
    return value.toISOString().slice(0, 10);
  };

  const countRejects = (entityType, entityId = null) => fixture.db.prepare(
    "SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT' AND entity_type=? AND entity_id IS ?",
  ).get(entityType, entityId).n;

  const businessFacts = () => snapshotTables(fixture.db, G03_BUSINESS_FACT_TABLES);

  async function createProduct(code, trackingPolicy, classification = 'RAW_MATERIAL') {
    const created = await fixture.request('POST', '/api/products', fixture.tokens.admin, {
      code, name: code, unit: 'EA', baseUomCode: 'EA', priceCents: 100,
      inventoryClassification: classification, trackingPolicy,
    });
    assert.equal(created.status, 201, created.data.error);
    return created.data.id;
  }

  async function receiveStock(productId, quantity) {
    const doc = await fixture.request('POST', '/api/inventory/native-documents', fixture.tokens.warehouse, {
      docKind: 'OTHER_RECEIPT', businessDate: isoDate(),
      items: [{ productId, warehouseId: SOURCE_WAREHOUSE, quantity }],
    });
    assert.equal(doc.status, 201, doc.data.error);
    const confirmed = await fixture.request('POST', `/api/inventory/native-documents/${doc.data.id}/confirm`, fixture.tokens.warehouse, {});
    assert.equal(confirmed.status, 200, confirmed.data.error);
  }

  function seedValuationBalance(productId, quantity, valueCents) {
    fixture.db.prepare(`INSERT INTO inventory_valuation_balances(
      balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at
    ) VALUES(?,?,?,?,NULL,NULL,?,?,?)`).run(
      `NONE:${SOURCE_WAREHOUSE}:${productId}`,
      'MOVING_AVERAGE',
      productId,
      SOURCE_WAREHOUSE,
      quantity,
      valueCents,
      new Date().toISOString(),
    );
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-m1c-wp7a-c-');
    const qualified = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: WIP_WAREHOUSE,
    });
    assert.equal(qualified.status, 200, qualified.data.error);

    parentId = await createProduct(PARENT_CODE, 'NONE', 'FINISHED_GOOD');
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: parentId, effectiveFrom: isoDate(-30) }]);
    const materialProductId = await createProduct(MATERIAL_CODE, 'NONE');
    await receiveStock(materialProductId, 100);
    // 估值余额目前没有生产写入入口；沿用 G03 既有 L2 夹具，只为让合法动作抵达 Handler 目标分支。
    seedValuationBalance(materialProductId, 100, 10000);

    const bom = await fixture.request('POST', '/api/engineering/boms', fixture.tokens.admin, {
      productId: parentId, version: 'WP7A-C', purpose: 'OUTSOURCE', approvalStatus: 'APPROVED',
      effectiveFrom: isoDate(), items: [{ productId: materialProductId, quantity: 1 }],
    });
    assert.equal(bom.status, 201, bom.data.error);

    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: parentId, orderQuantity: 10, unit: 'EA',
      businessDate: isoDate(), bomId: bom.data.id,
    });
    assert.equal(order.status, 201, order.data.error);
    orderId = order.data.id;
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [{ productId: materialProductId, sourceWarehouseId: SOURCE_WAREHOUSE }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' })).status, 200);
    assert.equal((await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'RELEASE' })).status, 200);

    materialId = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=?').get(orderId).id;
  });

  after(async () => fixture.close());

  async function assertConflictRejected({ label, path, body, key, firstQuantity, conflictQuantity }) {
    // 1. 第一次合法请求必须成功。
    const first = await fixture.request('POST', path, fixture.tokens.outsourcing, { ...body, quantity: firstQuantity, idempotencyKey: key });
    assert.equal(
      first.status,
      201,
      `${label} 首次合法请求必须成功：${JSON.stringify(first.data)}`,
    );

    // Same-content replay remains 200 and leaves G03 facts and audit untouched.
    const replayBefore = businessFacts();
    const rejectsBeforeReplay = countRejects('OUTSOURCING_ORDER', orderId);
    const replay = await fixture.request('POST', path, fixture.tokens.outsourcing, {
      ...body, quantity: firstQuantity, idempotencyKey: key,
    });
    assert.equal(replay.status, 200, `${label} 同内容重放必须返回 200`);
    assert.equal(replay.data.replayed, true, `${label} 同内容重放必须标记 replayed`);
    assert.deepEqual(changedTables(replayBefore, businessFacts()), [], `${label} 同内容重放不得改变 G03 业务事实`);
    assert.equal(countRejects('OUTSOURCING_ORDER', orderId), rejectsBeforeReplay, `${label} 同内容重放不得新增拒绝审计`);

    // 2. 同一外部幂等键、不同内容 → 409。
    const before = businessFacts();
    const rejectsBefore = countRejects('OUTSOURCING_ORDER', orderId);
    const conflict = await fixture.request('POST', path, fixture.tokens.outsourcing, { ...body, quantity: conflictQuantity, idempotencyKey: key });
    assert.equal(conflict.status, 409, `${label} 同外部幂等键异内容必须返回 409`);

    // 3. G03 业务事实逐字段零变化。
    assert.deepEqual(
      changedTables(before, businessFacts()), [],
      `${label} 同外部幂等键异内容拒绝后 G03 业务事实必须逐字段零变化`,
    );

    // 4. 对应业务实体的 REJECT 审计恰好新增 1 条。
    assert.equal(
      countRejects('OUTSOURCING_ORDER', orderId), rejectsBefore + 1,
      `${label} 同外部幂等键异内容拒绝必须恰好新增 1 条 REJECT 审计（缺陷 D-G03-001：idempotencyReplay() 在业务 try/catch 之外抛出，绕过 auditRejectedBusinessRule()）`,
    );
  }

  test('G03-C1 ISSUE：同外部幂等键异内容必须 409、事实零变化且拒绝审计恰好一条', async () => {
    await assertConflictRejected({
      label: 'ISSUE',
      path: `/api/procurement/outsourcing/orders/${orderId}/issues`,
      body: { materialListId: materialId, issuedDate: isoDate() },
      key: 'wp7a-c-iss',
      firstQuantity: 5,
      conflictQuantity: 6,
    });
  });

  test('G03-C2 SUPPLEMENT：同外部幂等键异内容必须 409、事实零变化且拒绝审计恰好一条', async () => {
    await assertConflictRejected({
      label: 'SUPPLEMENT',
      path: `/api/procurement/outsourcing/orders/${orderId}/supplements`,
      body: { materialListId: materialId, supplementDate: isoDate(), reason: 'WP7A-C' },
      key: 'wp7a-c-sup',
      firstQuantity: 3,
      conflictQuantity: 4,
    });
  });

  test('G03-C3 RETURN：同外部幂等键异内容必须 409、事实零变化且拒绝审计恰好一条', async () => {
    await assertConflictRejected({
      label: 'RETURN',
      path: `/api/procurement/outsourcing/orders/${orderId}/returns`,
      body: { materialListId: materialId, returnDate: isoDate() },
      key: 'wp7a-c-ret',
      firstQuantity: 2,
      conflictQuantity: 1,
    });
  });
});
