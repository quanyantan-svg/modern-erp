// D4 —— 跟踪维度投影一致性 + 5 个列表端点 + 平台前提播种
// （Requirement §32.14 IW-TRACE-01..06 / §36.21 PL-SEED-01..05）。
//
// 本套件覆盖三件事：
//   1. 跟踪维度投影由 canonical 位移写入器维护（IW-TRACE-04）：一般路径写入
//      带批次的货品后，`inventory_lot_balances` 与 canonical 仓位聚合一致，
//      `GET /api/tracking/reconcile` 的差异为 0，平台健康检查
//      `TRACKED_DIMENSION_VS_CANONICAL` 的差异为 0。
//   2. 既有差额由幂等迁移按 canonical 仓位回填（IW-TRACE-05），回填只写投影。
//   3. 5 个列表端点与前端页签登记（IW-TRACE-01/02/03）以及平台前提播种
//      （PL-SEED-01..05）。
//
// 每条新断言都带**独立的负向对照**：断言自己重新推导一次比较口径，证明它
// 真的能发现差额 —— 否则「一致」可能只是两处都恒等于 0 的空洞。

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { createTempDb } from './test-utils/temp-db.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import {
  listLotsHandler, listSerialsHandler, listTrackingIdentities, reconcileTrackedInventory, resolveQualityPolicy,
} from './modules/traceability-quality.js';
import { listLotAdjustments } from './modules/inventory-lot-adjustment.js';
import { listFormConversions } from './modules/inventory-form-conversion.js';
import { listContainers } from './modules/inventory-container.js';
import { systemHealth } from './modules/financial-inventory.js';
import {
  alignTrackedDimensionProjection, trackedDimensionDifferences,
} from './migrations/v25-tracked-dimension-alignment.js';
import {
  readSeedState, seedPlatformPrerequisites,
} from './migrations/v25-platform-prerequisite-seeds.js';
import { INVENTORY_WORK_TABS, permittedInventoryWorkTabs } from '../src/lib/inventoryWorkTabs.js';

const EPS = 1e-9;

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
    VALUES('wh-A','WH-A','WH A',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
    VALUES('wh-B','WH-B','WH B',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
    VALUES('p-lot','P-LOT','批号货品','CAT','PCS',1000,0,1,'LOT',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
    VALUES('p-ser','P-SER','序列货品','CAT','PCS',1000,0,1,'SERIAL',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
    VALUES('p-plain','P-PLAIN','普通货品','CAT','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at)
    VALUES('lot-1','p-lot','LOT-1','AVAILABLE','MANUAL','seed',?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at)
    VALUES('lot-2','p-lot','LOT-2','AVAILABLE','MANUAL','seed',?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO inventory_serials(id,product_id,serial_number,lifecycle_state,current_warehouse_id,created_source_type,created_source_id,updated_at,created_at)
    VALUES('ser-1','p-ser','SER-1','AVAILABLE',NULL,'MANUAL','seed',?,?)`).run(now, now);
}

function clearMovements(db) {
  for (const table of [
    'inventory', 'inventory_mutation_log', 'inventory_transactions', 'tracked_inventory_movements',
    'inventory_lot_balances', 'inventory_serials', 'inventory_lots',
    'inventory_lot_adjustments', 'inventory_form_conversions', 'inventory_containers',
    'inventory_container_items', 'inventory_native_documents', 'inventory_native_items',
  ]) {
    try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* 表可能不存在 */ }
  }
  seedMaster(db);
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    end(payload) { if (payload) this.body = JSON.parse(payload); },
  };
}

function callHandler(handler, db, actor, query = '') {
  const res = mockRes();
  handler(db, res, actor, new URL(`http://localhost${query}`));
  return res;
}

const FULL_ACTOR = {
  id: 'u-act',
  roleCode: 'ADMIN',
  permissions: [
    'INVENTORY_VIEW',
    'INVENTORY_LOT_ADJUSTMENT_VIEW', 'INVENTORY_FORM_CONVERSION_VIEW', 'INVENTORY_CONTAINER_VIEW',
  ],
};
const NO_PERMISSION_ACTOR = { id: 'u-act', roleCode: 'REVIEWER', permissions: [] };

/** canonical 仓位聚合（独立于生产代码的口径，用于负向对照）。 */
function canonicalQuantity(db, { productId, warehouseId }) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM inventory
    WHERE active=1 AND product_id=? AND warehouse_id=?`).get(productId, warehouseId);
  return Number(row.n);
}

/** 投影聚合（独立于生产代码的口径，用于负向对照）。 */
function projectedQuantity(db, { productId, warehouseId }) {
  const row = db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM inventory_lot_balances
    WHERE product_id=? AND warehouse_id=?`).get(productId, warehouseId);
  return Number(row.n);
}

function trackedHealthDifference(db) {
  const health = systemHealth(db, { asOfDate: '9999-12-31' });
  const check = health.checks.find((item) => item.code === 'TRACKED_DIMENSION_VS_CANONICAL');
  return check ? check.difference : null;
}

describe('D4 · IW-TRACE-04 跟踪维度投影由 canonical 位移写入器维护', () => {
  let db;
  let handle;

  before(() => {
    // production=true：抑制 Demo Seed，使本套件只观察本节实现的播种行为。
    handle = createTempDb({ label: 'd4-projection', production: true });
    db = handle.db;
  });

  after(() => {
    try { handle?.cleanup?.(); } catch { /* 清理失败不影响结论 */ }
  });

  beforeEach(() => clearMovements(db));

  test('一般路径（其他入库）写入带批次的货品后，投影与 canonical 仓位一致', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 120,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:IN:1', remark: 'd4',
    });
    assert.equal(canonicalQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), 120);
    assert.equal(projectedQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), 120);
    assert.deepEqual(reconcileTrackedInventory(db).mismatches, []);
    assert.equal(reconcileTrackedInventory(db).ok, true);
    assert.equal(trackedHealthDifference(db), 0);
  });

  test('一般路径（其他出库）同步减少投影，且不多不少迁移一次', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 120,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:IN:1', remark: 'd4',
    });
    applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'doc-out', sourceItemId: 'item-out',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'OUT', quantity: 40,
      fromPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:OUT:1', remark: 'd4',
    });
    assert.equal(canonicalQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), 80);
    assert.equal(projectedQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), 80);
    assert.equal(trackedHealthDifference(db), 0);
    // 一笔移动只产生一条跟踪移动证据。
    const movements = db.prepare(`SELECT COUNT(*) n FROM tracked_inventory_movements
      WHERE product_id='p-lot' AND source_id='doc-out'`).get();
    assert.equal(Number(movements.n), 1);
  });

  test('负向对照：绕过 canonical 写入器直接造 canonical 仓位，一致性断言确实转红', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 120,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:IN:1', remark: 'd4',
    });
    // 只写 canonical 仓位，不写投影 —— 模拟「投影由部分路径维护」的历史漂移。
    db.prepare(`UPDATE inventory_lot_balances SET quantity=quantity+650 WHERE lot_id='lot-1'`).run();
    assert.notEqual(canonicalQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }),
      projectedQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }));
    assert.equal(reconcileTrackedInventory(db).ok, false);
    assert.notEqual(trackedHealthDifference(db), 0);
    assert.ok(trackedDimensionDifferences(db).length > 0);
  });

  test('序列号：一般路径出库只迁移一次生命周期，入库回到目标仓', () => {
    db.prepare(`UPDATE inventory_serials SET lifecycle_state='AVAILABLE', current_warehouse_id='wh-A' WHERE id='ser-1'`).run();
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-ser-in', sourceItemId: 'item-ser-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 1,
      toPosition: {
        productId: 'p-ser', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', serialId: 'ser-1',
      },
      idempotencyKey: 'D4:SER:IN', remark: 'd4',
    });
    let serial = db.prepare(`SELECT lifecycle_state, current_warehouse_id FROM inventory_serials WHERE id='ser-1'`).get();
    assert.equal(serial.lifecycle_state, 'AVAILABLE');
    assert.equal(serial.current_warehouse_id, 'wh-A');

    applyInventoryMutation({
      db, sourceType: 'OTHER_ISSUE', sourceId: 'doc-ser-out', sourceItemId: 'item-ser-out',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'OUT', quantity: 1,
      fromPosition: {
        productId: 'p-ser', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', serialId: 'ser-1',
      },
      idempotencyKey: 'D4:SER:OUT', remark: 'd4',
    });
    serial = db.prepare(`SELECT lifecycle_state, current_warehouse_id FROM inventory_serials WHERE id='ser-1'`).get();
    assert.equal(serial.lifecycle_state, 'CONSUMED');
    assert.equal(serial.current_warehouse_id, null);
    assert.equal(trackedHealthDifference(db), 0);
  });
});

describe('D4 · IW-TRACE-05 既有差额按 canonical 仓位幂等回填', () => {
  let db;
  let handle;

  before(() => {
    handle = createTempDb({ label: 'd4-align', production: true });
    db = handle.db;
  });

  after(() => {
    try { handle?.cleanup?.(); } catch { /* 清理失败不影响结论 */ }
  });

  beforeEach(() => clearMovements(db));

  test('漂移被回填、canonical 仓位逐行未变、重复执行结果相同', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 120,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:ALIGN:IN', remark: 'd4',
    });
    // 制造历史漂移：投影清零 + 追加一条无 canonical 仓位的陈旧投影行。
    db.prepare(`UPDATE inventory_lot_balances SET quantity=0 WHERE lot_id='lot-1'`).run();
    db.prepare(`INSERT INTO inventory_lot_balances(warehouse_id,product_id,lot_id,quantity,updated_at)
      VALUES('wh-B','p-lot','lot-2',999,?)`).run(new Date().toISOString());
    const canonicalBefore = db.prepare(`SELECT id, quantity, position_key, active FROM inventory WHERE active=1 ORDER BY id`).all();
    const canonicalTotalBefore = canonicalQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' });

    const first = alignTrackedDimensionProjection(db);
    assert.equal(first.status, 'applied');
    assert.equal(projectedQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), canonicalTotalBefore);
    // 陈旧投影行被清除（没有 canonical 仓位的批次不再有投影）。
    const stale = db.prepare(`SELECT COUNT(*) n FROM inventory_lot_balances WHERE lot_id='lot-2'`).get();
    assert.equal(Number(stale.n), 0);
    // canonical 仓位逐行未变 —— 回填只写投影，不造库存。
    const canonicalAfter = db.prepare(`SELECT id, quantity, position_key, active FROM inventory WHERE active=1 ORDER BY id`).all();
    assert.deepEqual(canonicalAfter, canonicalBefore);
    assert.equal(trackedHealthDifference(db), 0);
    assert.deepEqual(trackedDimensionDifferences(db), []);

    // 幂等：重复执行不写任何行。
    const balancesBefore = db.prepare('SELECT * FROM inventory_lot_balances ORDER BY warehouse_id, lot_id').all();
    const second = alignTrackedDimensionProjection(db);
    assert.equal(second.status, 'replayed');
    const balancesAfter = db.prepare('SELECT * FROM inventory_lot_balances ORDER BY warehouse_id, lot_id').all();
    assert.deepEqual(balancesAfter, balancesBefore);
  });

  test('序列号位置按 canonical 仓位纠正，生命周期事实不被改写', () => {
    db.prepare(`UPDATE inventory_serials SET lifecycle_state='AVAILABLE', current_warehouse_id='wh-A' WHERE id='ser-1'`).run();
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-ser-in', sourceItemId: 'item-ser-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 1,
      toPosition: {
        productId: 'p-ser', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', serialId: 'ser-1',
      },
      idempotencyKey: 'D4:ALIGN:SER', remark: 'd4',
    });
    // 位置漂到别的仓库，生命周期保持 AVAILABLE（业务事实）。
    db.prepare(`UPDATE inventory_serials SET current_warehouse_id='wh-B' WHERE id='ser-1'`).run();
    alignTrackedDimensionProjection(db);
    const serial = db.prepare(`SELECT lifecycle_state, current_warehouse_id FROM inventory_serials WHERE id='ser-1'`).get();
    assert.equal(serial.current_warehouse_id, 'wh-A');
    assert.equal(serial.lifecycle_state, 'AVAILABLE');
  });
});

describe('D4 · IW-TRACE-01/02/03 五个列表端点', () => {
  let db;
  let handle;

  before(() => {
    handle = createTempDb({ label: 'd4-endpoints', production: true });
    db = handle.db;
  });

  after(() => {
    try { handle?.cleanup?.(); } catch { /* 清理失败不影响结论 */ }
  });

  beforeEach(() => clearMovements(db));

  test('五个端点对有权 actor 返回 2xx 与读模型字段', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 120,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:EP:IN', remark: 'd4',
    });
    const lots = callHandler(listLotsHandler, db, FULL_ACTOR, '/api/inventory-lots');
    assert.equal(lots.statusCode, 200);
    const lot = lots.body.lots.find((row) => row.id === 'lot-1');
    assert.ok(lot, '批次主档必须包含批次 lot-1');
    assert.equal(lot.lotCode, 'LOT-1');
    assert.equal(lot.productCode, 'P-LOT');
    // 数量取自既有维度事实，不是第二份算法。
    assert.equal(lot.onHandQuantity, projectedQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }));
    assert.equal(lot.warehouses.length, 1);
    assert.equal(lot.warehouses[0].warehouseCode, 'WH-A');

    const serials = callHandler(listSerialsHandler, db, FULL_ACTOR, '/api/inventory-serials');
    assert.equal(serials.statusCode, 200);
    assert.ok(Array.isArray(serials.body.serials));

    const adjustments = callHandler(listLotAdjustments, db, FULL_ACTOR, '/api/inventory-lot-adjustments');
    assert.equal(adjustments.statusCode, 200);
    assert.ok(Array.isArray(adjustments.body.lotAdjustments));

    const conversions = callHandler(listFormConversions, db, FULL_ACTOR, '/api/inventory-form-conversions');
    assert.equal(conversions.statusCode, 200);
    assert.ok(Array.isArray(conversions.body.formConversions));

    const containers = callHandler(listContainers, db, FULL_ACTOR, '/api/inventory-containers');
    assert.equal(containers.statusCode, 200);
    assert.ok(Array.isArray(containers.body.containers));
  });

  test('无权 actor 被后端拒绝（403），不是前端先行读取', () => {
    for (const handler of [listLotsHandler, listSerialsHandler, listLotAdjustments, listFormConversions, listContainers]) {
      assert.throws(
        () => callHandler(handler, db, NO_PERMISSION_ACTOR, '/x'),
        (error) => error.status === 403,
      );
    }
  });

  test('过滤与限量生效', () => {
    const lots = callHandler(listLotsHandler, db, FULL_ACTOR, '/api/inventory-lots?productId=p-lot&limit=1');
    assert.equal(lots.statusCode, 200);
    assert.equal(lots.body.lots.length, 1);
    const filtered = callHandler(listLotsHandler, db, FULL_ACTOR, '/api/inventory-lots?productId=p-ser');
    assert.equal(filtered.body.lots.length, 0);
    const byStatus = callHandler(listLotsHandler, db, FULL_ACTOR, '/api/inventory-lots?status=hold');
    assert.equal(byStatus.body.lots.length, 0);
  });

  test('负向对照：投影为空时端点返回 0，而不是自己另算一份数量', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-17', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 120,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'D4:EP:NEG', remark: 'd4',
    });
    db.prepare(`UPDATE inventory_lot_balances SET quantity=0`).run();
    const lots = callHandler(listLotsHandler, db, FULL_ACTOR, '/api/inventory-lots');
    const lot = lots.body.lots.find((row) => row.id === 'lot-1');
    assert.equal(lot.onHandQuantity, 0);
    // 端点没有另算一份数量：canonical 仍然是 120。
    assert.equal(canonicalQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), 120);
  });
});

describe('D4 · IW-TRACE-02/03 前端页签登记', () => {
  test('三个页签登记各自的读取端点与既有权限码，页签集合不变', () => {
    const tabs = Object.fromEntries(INVENTORY_WORK_TABS.map((tab) => [tab.key, tab]));
    assert.equal(INVENTORY_WORK_TABS.length, 21, '页签集合不得改变');
    assert.deepEqual(tabs.lot.reads, [{ endpoint: '/api/inventory-lot-adjustments', kind: 'all', codes: ['INVENTORY_LOT_ADJUSTMENT_VIEW'] }]);
    assert.deepEqual(tabs.form.reads, [{ endpoint: '/api/inventory-form-conversions', kind: 'all', codes: ['INVENTORY_FORM_CONVERSION_VIEW'] }]);
    assert.deepEqual(tabs.containers.reads, [{ endpoint: '/api/inventory-containers', kind: 'all', codes: ['INVENTORY_CONTAINER_VIEW'] }]);
  });

  test('只持 INVENTORY_VIEW 的角色看不到这三个页签；持有 ..._VIEW 的角色看得到', () => {
    const reviewer = permittedInventoryWorkTabs(['INVENTORY_VIEW']).map((tab) => tab.key);
    for (const key of ['lot', 'form', 'containers']) {
      assert.ok(!reviewer.includes(key), `审核员不应看到页签 ${key}`);
    }
    const warehouse = permittedInventoryWorkTabs([
      'INVENTORY_VIEW', 'INVENTORY_LOT_ADJUSTMENT_VIEW', 'INVENTORY_FORM_CONVERSION_VIEW', 'INVENTORY_CONTAINER_VIEW',
    ]).map((tab) => tab.key);
    for (const key of ['lot', 'form', 'containers']) {
      assert.ok(warehouse.includes(key), `仓库角色应看到页签 ${key}`);
    }
  });
});

describe('F-04 · IW-TRACE-06 身份列表与主档列表读同一份数量口径', () => {
  let db;
  let handle;

  before(() => {
    handle = createTempDb({ label: 'f04-identity-quantity', production: true });
    db = handle.db;
  });

  after(() => {
    try { handle?.cleanup?.(); } catch { /* 清理失败不影响结论 */ }
  });

  beforeEach(() => clearMovements(db));

  test('同一批次多次移动后，身份列表数量仍是真实数量而不是「真实数量 × 移动笔数」', () => {
    for (const index of [1, 2, 3]) {
      applyInventoryMutation({
        db, sourceType: 'OTHER_RECEIPT', sourceId: `doc-in-${index}`, sourceItemId: `item-in-${index}`,
        businessDate: '2026-11-18', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 40,
        toPosition: {
          productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
          stockStatus: 'AVAILABLE', lotId: 'lot-1',
        },
        idempotencyKey: `F04:IN:${index}`, remark: 'f04',
      });
    }
    const movements = Number(db.prepare(`SELECT COUNT(*) n FROM tracked_inventory_movements
      WHERE lot_id='lot-1' AND reversed=0`).get().n);
    const truth = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) n FROM inventory_lot_balances
      WHERE lot_id='lot-1'`).get().n);
    assert.equal(movements, 3, '负向对照前提：同一批次必须有 3 笔移动，放大因子不为 1');
    assert.equal(truth, 120);

    const identity = listTrackingIdentities(db, 'LOT', 'LOT-1').find((row) => row.id === 'lot-1');
    assert.ok(identity, '身份列表必须包含批次 lot-1');
    assert.equal(identity.currentQuantity, truth);
    assert.notEqual(identity.currentQuantity, truth * movements, '数量不得被移动笔数放大');
    assert.equal(identity.warehouseCodes, 'WH-A');
  });

  test('身份列表与批次主档列表对同一批次给出同一个数量（单一口径）', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-18', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 70,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'F04:PARITY:IN', remark: 'f04',
    });
    const identity = listTrackingIdentities(db, 'LOT', 'LOT-1').find((row) => row.id === 'lot-1');
    const master = callHandler(listLotsHandler, db, FULL_ACTOR, '/api/inventory-lots').body.lots
      .find((row) => row.id === 'lot-1');
    assert.equal(identity.currentQuantity, master.onHandQuantity);
    assert.equal(identity.currentQuantity, 70);
  });

  test('负向对照：投影被清零时身份列表给 0，而不是自己另算一份数量', () => {
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'doc-in', sourceItemId: 'item-in',
      businessDate: '2026-11-18', actor: { id: 'u-act' }, movementKind: 'IN', quantity: 90,
      toPosition: {
        productId: 'p-lot', warehouseId: 'wh-A', ownerType: 'ENTERPRISE',
        stockStatus: 'AVAILABLE', lotId: 'lot-1',
      },
      idempotencyKey: 'F04:NEG:IN', remark: 'f04',
    });
    db.prepare(`UPDATE inventory_lot_balances SET quantity=0 WHERE lot_id='lot-1'`).run();
    const identity = listTrackingIdentities(db, 'LOT', 'LOT-1').find((row) => row.id === 'lot-1');
    assert.equal(identity.currentQuantity, 0);
    // canonical 仓位仍然是 90：端点没有另算一份数量。
    assert.equal(canonicalQuantity(db, { productId: 'p-lot', warehouseId: 'wh-A' }), 90);
  });
});

describe('D4 · PL-SEED-01..05 平台前提播种', () => {
  let db;
  let handle;

  before(() => {
    handle = createTempDb({ label: 'd4-seed', production: true });
    db = handle.db;
    // 播种的归属必须是真实用户（PL-SEED-04）：这里只建一个最小管理员。
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(new Date().toISOString());
  });

  after(() => {
    try { handle?.cleanup?.(); } catch { /* 清理失败不影响结论 */ }
  });

  test('幂等：重复播种行数与取值不变', () => {
    const first = seedPlatformPrerequisites(db);
    assert.equal(first.status, 'applied');
    assert.equal(first.state.deferred, false);
    assert.equal(first.state.complete, true);
    const parameters = db.prepare('SELECT * FROM sales_parameters WHERE scope_key=?').get('SYSTEM');
    const points = db.prepare('SELECT * FROM quality_control_points ORDER BY code').all();
    assert.equal(points.length, 2);

    const second = seedPlatformPrerequisites(db);
    assert.equal(second.status, 'replayed');
    assert.deepEqual(db.prepare('SELECT * FROM sales_parameters WHERE scope_key=?').get('SYSTEM'), parameters);
    assert.deepEqual(db.prepare('SELECT * FROM quality_control_points ORDER BY code').all(), points);
  });

  test('PL-SEED-02 取值是业务所有者批准的取值', () => {
    const row = db.prepare('SELECT * FROM sales_parameters WHERE scope_key=?').get('SYSTEM');
    assert.equal(row.active, 1);
    assert.equal(row.sellable_control_enabled, 1);
    assert.equal(row.customer_material_xref_enabled, 1);
    assert.equal(row.sales_group_data_scope_enabled, 1);
    assert.equal(row.delivery_schedule_enabled, 1);
    assert.equal(row.delivery_quantity_control_enabled, 1);
    assert.equal(row.order_change_mode, 'BOTH');
    assert.equal(row.reservation_behavior, 'DISABLED');
    assert.ok(row.created_by, '归属必须是真实用户 id');
    assert.ok(db.prepare('SELECT 1 FROM users WHERE id=?').get(row.created_by));
  });

  test('PL-SEED-03 默认质检点必须检验，且缺检验仍然 fail-safe 拒绝', () => {
    const points = db.prepare('SELECT * FROM quality_control_points ORDER BY code').all();
    assert.deepEqual(points.map((row) => row.code), ['QCP-IN-GLOBAL', 'QCP-OUT-GLOBAL']);
    for (const point of points) {
      assert.equal(point.inspection_required, 1);
      assert.equal(point.scope, 'GLOBAL');
      assert.equal(point.sampling_mode, 'FULL');
      assert.equal(point.active, 1);
      assert.ok(db.prepare('SELECT 1 FROM users WHERE id=?').get(point.created_by));
    }
    const policy = resolveQualityPolicy(db, 'SALES_DELIVERY', 'p-lot', '2026-11-17');
    assert.equal(policy.inspectionRequired, true);
    assert.ok(policy.qcpId, '播种后策略快照必须携带真实 qcp_id，而不是 NULL');
  });

  test('PL-SEED-05 不覆盖运维已配置的取值', () => {
    seedPlatformPrerequisites(db);
    db.prepare(`UPDATE sales_parameters SET reservation_behavior='MANUAL_RESERVATION', delivery_schedule_enabled=0
      WHERE scope_key='SYSTEM'`).run();
    db.prepare(`UPDATE quality_control_points SET inspection_required=0, remarks='运维显式免检' WHERE code='QCP-OUT-GLOBAL'`).run();
    seedPlatformPrerequisites(db);
    const row = db.prepare('SELECT * FROM sales_parameters WHERE scope_key=?').get('SYSTEM');
    assert.equal(row.reservation_behavior, 'MANUAL_RESERVATION');
    assert.equal(row.delivery_schedule_enabled, 0);
    const point = db.prepare('SELECT * FROM quality_control_points WHERE code=?').get('QCP-OUT-GLOBAL');
    assert.equal(point.inspection_required, 0);
    assert.equal(point.remarks, '运维显式免检');
  });

  test('播种目标是生产部署：演示库不播种（演示环境的业务开关由演示数据自身决定）', () => {
    const demo = createTempDb({ label: 'd4-seed-demo' });
    try {
      // 无论演示 seed 开关如何，演示库都不得被播种改写销售开关与质检策略。
      assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM sales_parameters').get().n, 0);
      assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM quality_control_points').get().n, 0);
    } finally {
      try { demo.cleanup(); } catch { /* 清理失败不影响结论 */ }
    }
  });

  test('PL-SEED-04 没有真实用户时播种延后，不写伪造归属的行', () => {
    const isolated = createTempDb({ label: 'd4-seed-nouser', production: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n > 0, true, '前置用例已创建用户');
      const state = readSeedState(isolated.db);
      assert.equal(state.actorId, null);
      assert.equal(state.deferred, true);
      assert.equal(state.complete, false);
      assert.equal(isolated.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
      assert.equal(isolated.db.prepare('SELECT COUNT(*) n FROM sales_parameters').get().n, 0);
      assert.equal(isolated.db.prepare('SELECT COUNT(*) n FROM quality_control_points').get().n, 0);
      // 播种本身必须报告「延后」，而不是假装已完成。
      const seeded = seedPlatformPrerequisites(isolated.db);
      assert.equal(seeded.deferred, true);
      assert.equal(seeded.complete, false);
      assert.equal(isolated.db.prepare('SELECT COUNT(*) n FROM sales_parameters').get().n, 0);
      assert.equal(isolated.db.prepare('SELECT COUNT(*) n FROM quality_control_points').get().n, 0);
    } finally {
      try { isolated.cleanup(); } catch { /* 清理失败不影响结论 */ }
    }
  });
});
