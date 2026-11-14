// W10-INV-RISK-01 —— 生产库存正确性闭合回归。
//
// 本文件覆盖 Requirement `W10-INV-RISK-01` 的验收条款 AC-RISK-01..AC-RISK-08：
//   - 错误拒绝（canonical 足量、别的身份不足）必须按 canonical 数量通过；
//   - 错误放行（别的身份足量、canonical 不足）必须被拒绝且零副作用；
//   - canonical 缺行视为零库存；
//   - 扣减后不得出现负余额；
//   - 别的身份行不得被本轮路径修改；
//   - 重放不得重复扣减。
//
// 证据层级：全部为 **SQLite 本地**证据。AC-RISK-04 的真实 MySQL 并发证明
// 仍需受保护的 disposable MySQL campaign，本文件**不**代替它，也不得被
// 记为 MySQL 并发证据。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.js';
import { computePositionKey } from './lib/inventory-position.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  productionOrderBody, seedWave10AcceptanceBase, wave10DeliveryRequest,
  wave10HttpLogin, wave10HttpRequest,
} from './test-utils/wave10-mysql-acceptance-fixture.js';
import { createTempDb } from './test-utils/temp-db.js';

const WAREHOUSE_ID = 'w10-race-warehouse';
const PRODUCT_ID = 'w10-race-product';
const WRONG_OWNER_ID = 'w10-race-customer';
const CREDIT_OPTIONS = Object.freeze({ aggregateLimit: 1000000, salespersonLimit: 400000 });

const CANONICAL_POSITION_KEY = computePositionKey({
  productId: PRODUCT_ID,
  warehouseId: WAREHOUSE_ID,
  binId: null,
  ownerType: 'ENTERPRISE',
  ownerId: null,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

const WRONG_POSITION_KEY = computePositionKey({
  productId: PRODUCT_ID,
  warehouseId: WAREHOUSE_ID,
  binId: null,
  ownerType: 'CUSTOMER',
  ownerId: WRONG_OWNER_ID,
  stockStatus: 'AVAILABLE',
  lotId: null,
  serialId: null,
});

function now() {
  return new Date().toISOString();
}

async function withScenario(label, options, body) {
  const handle = createTempDb({ label, production: true });
  try {
    const db = handle.db;
    migrateSalesCustomerDomain(db);
    await seedWave10AcceptanceBase(db, { ...CREDIT_OPTIONS, ...options });
    const app = createApp(db, {});
    const creator = await wave10HttpLogin(app, { username: 'w10-race-creator' });
    const approver = await wave10HttpLogin(app, { username: 'w10-race-approver' });
    return await body({ db, app, creator, approver });
  } finally {
    handle.cleanup();
  }
}

function countRows(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count ?? 0);
}

function inventoryRows(db) {
  return db.prepare('SELECT * FROM inventory WHERE warehouse_id=? AND product_id=? ORDER BY id')
    .all(WAREHOUSE_ID, PRODUCT_ID);
}

function canonicalRow(db) {
  return inventoryRows(db).find((row) => row.position_key === CANONICAL_POSITION_KEY) || null;
}

function wrongRow(db) {
  return inventoryRows(db).find((row) => row.position_key === WRONG_POSITION_KEY) || null;
}

/**
 * 重建该 (warehouse, product) 的库存行。
 *
 * **wrong 行先插入**：旧实现的 pair-level 无过滤读取会取到第一行，
 * 因此「错误拒绝」与「错误放行」两个场景必须让 wrong 行排在前面，
 * 场景结论才不依赖行序。
 */
function seedPositions(db, { canonical = null, wrong = null }) {
  db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(WAREHOUSE_ID, PRODUCT_ID);
  if (wrong !== null) {
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,
      owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES(?,?,?,?,?,?,NULL,'CUSTOMER',?,'AVAILABLE',NULL,NULL,1)`)
      .run('w10-risk-wrong', WAREHOUSE_ID, PRODUCT_ID, wrong, now(), WRONG_POSITION_KEY, WRONG_OWNER_ID);
  }
  if (canonical !== null) {
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,
      owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES(?,?,?,?,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)`)
      .run('w10-risk-canonical', WAREHOUSE_ID, PRODUCT_ID, canonical, now(), CANONICAL_POSITION_KEY);
  }
}

async function canonicalApprovedOrder({ db, app, creator, approver }, key, { quantityMicros = 1_000_000 } = {}) {
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/sales-orders', token: creator,
    body: productionOrderBody({ quantityMicros }),
    headers: { 'idempotency-key': `${key}-create` },
  });
  assert.equal(created.statusCode, 201, `order creation failed: ${JSON.stringify(created.body)}`);
  const orderId = created.body?.id;
  const submitted = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/sales-orders/${orderId}/submit`, token: creator, body: {},
    headers: { 'idempotency-key': `${key}-submit` },
  });
  assert.equal(submitted.statusCode, 200, `order submission failed: ${JSON.stringify(submitted.body)}`);
  const approved = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/sales-orders/${orderId}/approve`, token: approver, body: {},
    headers: { 'idempotency-key': `${key}-approve` },
  });
  assert.equal(approved.statusCode, 200, `order approval failed: ${JSON.stringify(approved.body)}`);
  const orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no,id LIMIT 1').get(orderId).id;
  return { orderId, orderItemId };
}

async function createDelivery(context, { orderId, orderItemId }) {
  const created = await wave10HttpRequest(context.app, {
    method: 'POST', path: '/api/sales-deliveries', token: context.approver,
    body: wave10DeliveryRequest({ orderId, orderItemId }),
  });
  return created;
}

/* ------------------------------------------------------------------ */

test('AC-RISK-01 错误拒绝：canonical 足量、别的身份不足时按 canonical 数量通过', async () => {
  await withScenario('w10-risk-ac01', {}, async (context) => {
    const { db } = context;
    // wrong 行数量为 0，canonical 行数量为 100：旧实现按第一行读取会错误拒绝。
    seedPositions(db, { wrong: 0, canonical: 100 });

    const order = await canonicalApprovedOrder(context, 'w10-risk-ac01');
    const created = await createDelivery(context, order);
    assert.equal(created.statusCode, 201, `draft creation must not be refused: ${JSON.stringify(created.body)}`);
    const deliveryId = created.body.id;

    const confirmed = await wave10HttpRequest(context.app, {
      method: 'POST', path: `/api/sales-deliveries/${deliveryId}`, token: context.approver,
      body: { action: 'confirm' }, headers: { 'idempotency-key': 'w10-risk-ac01-confirm' },
    });
    assert.equal(confirmed.statusCode, 200, `confirmation must pass on the canonical position: ${JSON.stringify(confirmed.body)}`);

    const canonical = canonicalRow(db);
    assert.equal(Number(canonical.quantity), 99, 'canonical 位置必须被扣减一次');
    const wrong = wrongRow(db);
    assert.equal(Number(wrong.quantity), 0, '别的身份行不得被修改');
  });
});

test('AC-RISK-02 错误放行：别的身份足量、canonical 不足时必须拒绝且零副作用', async () => {
  await withScenario('w10-risk-ac02', {}, async (context) => {
    const { db } = context;
    seedPositions(db, { wrong: 100, canonical: 0 });

    const order = await canonicalApprovedOrder(context, 'w10-risk-ac02');
    const created = await createDelivery(context, order);
    assert.equal(created.statusCode, 400, `draft creation must be refused: ${JSON.stringify(created.body)}`);
    assert.match(String(created.body?.error || created.body?.message), /库存不足/);
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE quantity < 0'), 0, '不得出现负余额');
  });
});

test('AC-RISK-03 canonical 缺行：只有别的身份行时视为零库存并拒绝', async () => {
  await withScenario('w10-risk-ac03', {}, async (context) => {
    const { db } = context;
    seedPositions(db, { wrong: 100 });

    const order = await canonicalApprovedOrder(context, 'w10-risk-ac03');
    const created = await createDelivery(context, order);
    assert.equal(created.statusCode, 400, `missing canonical position must be refused: ${JSON.stringify(created.body)}`);
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM sales_deliveries'), 0, '被拒绝的草稿不得落库');
  });
});

test('AC-RISK-04/05/07 事务内拒绝：canonical 被抽空后确认必须整单回滚，别的身份行不变', async () => {
  await withScenario('w10-risk-ac04', {}, async (context) => {
    const { db } = context;
    seedPositions(db, { wrong: 100, canonical: 1 });

    const order = await canonicalApprovedOrder(context, 'w10-risk-ac04');
    const created = await createDelivery(context, order);
    assert.equal(created.statusCode, 201, `draft creation must pass: ${JSON.stringify(created.body)}`);
    const deliveryId = created.body.id;

    // 草稿建好后 canonical 被抽空：确认期必须在事务内权威复读并拒绝。
    db.prepare('UPDATE inventory SET quantity=0 WHERE position_key=?').run(CANONICAL_POSITION_KEY);
    const before = {
      vouchers: countRows(db, 'SELECT COUNT(*) count FROM accounting_vouchers'),
      valuation: countRows(db, 'SELECT COUNT(*) count FROM inventory_valuation_movements'),
      transactions: countRows(db, 'SELECT COUNT(*) count FROM inventory_transactions'),
      receivable: countRows(db, 'SELECT COUNT(*) count FROM account_receivables'),
    };

    const confirmed = await wave10HttpRequest(context.app, {
      method: 'POST', path: `/api/sales-deliveries/${deliveryId}`, token: context.approver,
      body: { action: 'confirm' }, headers: { 'idempotency-key': 'w10-risk-ac04-confirm' },
    });
    assert.equal(confirmed.statusCode, 400, `confirmation must be refused: ${JSON.stringify(confirmed.body)}`);

    // AC-RISK-04：canonical 不得被写成负数。
    const canonical = canonicalRow(db);
    assert.equal(Number(canonical.quantity), 0, 'canonical 余额必须保持不变');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE quantity < 0'), 0, '不得出现负余额');
    // AC-RISK-05：别的身份行不得被修改。
    const wrong = wrongRow(db);
    assert.equal(Number(wrong.quantity), 100, '别的身份行数量不得被修改');
    assert.equal(wrong.owner_type, 'CUSTOMER');
    assert.equal(wrong.owner_id, WRONG_OWNER_ID);
    assert.equal(Number(wrong.active), 1);
    // AC-RISK-07：单据状态、库存事务、估值、凭证、AR 与成功审计都不得新增。
    assert.equal(db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(deliveryId).status, 'DRAFT',
      '被拒绝的确认不得推进单据状态');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM accounting_vouchers'), before.vouchers, '不得新增凭证');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory_valuation_movements'), before.valuation, '不得新增估值事件');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory_transactions'), before.transactions, '不得新增库存事务');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM account_receivables'), before.receivable, '不得新增应收');
  });
});

test('AC-RISK-08 幂等：同一确认重放只扣减一次', async () => {
  await withScenario('w10-risk-ac08', {}, async (context) => {
    const { db } = context;
    seedPositions(db, { wrong: 0, canonical: 100 });

    const order = await canonicalApprovedOrder(context, 'w10-risk-ac08');
    const created = await createDelivery(context, order);
    assert.equal(created.statusCode, 201);
    const deliveryId = created.body.id;

    const first = await wave10HttpRequest(context.app, {
      method: 'POST', path: `/api/sales-deliveries/${deliveryId}`, token: context.approver,
      body: { action: 'confirm' }, headers: { 'idempotency-key': 'w10-risk-ac08-confirm' },
    });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    const afterFirst = Number(canonicalRow(db).quantity);
    assert.equal(afterFirst, 99, '首次确认扣减一次');

    const replay = await wave10HttpRequest(context.app, {
      method: 'POST', path: `/api/sales-deliveries/${deliveryId}`, token: context.approver,
      body: { action: 'confirm' }, headers: { 'idempotency-key': 'w10-risk-ac08-confirm' },
    });
    assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
    assert.equal(Number(canonicalRow(db).quantity), afterFirst, '重放不得重复扣减');
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory_transactions WHERE source_type=? AND source_id=?', 'SALES_DELIVERY', deliveryId), 1,
      '重放不得新增第二条库存事务');
  });
});

test('AC-RISK-06 跟踪身份：LOT 产品的可用量按批次身份判定，不按 pair 聚合', async () => {
  await withScenario('w10-risk-ac06', {}, async (context) => {
    const { db } = context;
    // 把 fixture 产品改成 LOT 跟踪，并写入一个批次身份位置。
    db.prepare("UPDATE products SET tracking_policy='LOT' WHERE id=?").run(PRODUCT_ID);
    const lotId = 'w10-risk-lot';
    db.prepare(`INSERT INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at)
      VALUES(?,?,?,'AVAILABLE','MANUAL','w10-risk-ac06',?)`)
      .run(lotId, PRODUCT_ID, 'LOT-RISK-1', now());
    const lotPositionKey = computePositionKey({
      productId: PRODUCT_ID,
      warehouseId: WAREHOUSE_ID,
      binId: null,
      ownerType: 'ENTERPRISE',
      ownerId: null,
      stockStatus: 'AVAILABLE',
      lotId,
      serialId: null,
    });
    db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(WAREHOUSE_ID, PRODUCT_ID);
    // 批次身份上有货，但默认位置没有。
    db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,
      owner_type,owner_id,stock_status,lot_id,serial_id,active)
      VALUES(?,?,?,?,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',?,NULL,1)`)
      .run('w10-risk-lot-row', WAREHOUSE_ID, PRODUCT_ID, 100, now(), lotPositionKey, lotId);

    const order = await canonicalApprovedOrder(context, 'w10-risk-ac06');
    // 未提供批次分配 → 跟踪身份不可确定 → 必须 fail closed，不得退回默认位置。
    const created = await createDelivery(context, order);
    assert.equal(created.statusCode, 409, `LOT 产品缺少批次分配时必须 fail closed: ${JSON.stringify(created.body)}`);
    assert.equal(countRows(db, 'SELECT COUNT(*) count FROM inventory WHERE warehouse_id=? AND product_id=? AND position_key=?', WAREHOUSE_ID, PRODUCT_ID, lotPositionKey), 1,
      '批次身份行不得被本轮路径修改');
  });
});
