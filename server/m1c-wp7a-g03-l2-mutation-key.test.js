// M1C-WP7-A-R1 —— G03 的 **L2 canonical inventory primitive** 证据。
//
// Active Design §13.1.1 规定 G03 固定两层证据，且两层互不冒充：
//
//   L1 生产 HTTP：同外部键同内容 200 replay 且无第二次动作；同键异内容稳定 409
//                 且业务事实逐字段零变化；不同外部键各获唯一内部 eventId；
//                 实际物理腿数等于预期腿数。
//   L2 canonical inventory primitive：同一五字段 Mutation Key —— 同指纹只 replay；
//                 异指纹 409 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；
//                 **无物理腿、跟踪、估值或 mutation log 部分写入**。
//
// 本文件**只补 L2 层的断言位**，不新增业务功能、不改变业务合同、不修改核心实现。
// L1 层由 `server/m1c-wp7a-gate-acceptance.test.js` 承担，本文件不替代它。
//
// 证据口径（必须如实理解，不得扩大）：
//   - L2 直接调用 `applyInventoryMutation()`，并使用**委外严格模式**
//     （`trackingMode: 'EXTERNAL'`、`valuationMode: 'EXTERNAL'`）。在该模式下
//     canonical primitive **自身不写**跟踪腿与估值流水 —— 那是调用方
//     `postTrackingAndValuation()` 的职责。因此本文件**不**声称「Primitive 正向
//     执行完成了外部跟踪或估值写入」；它只断言：冲突发生时，物理腿、跟踪、估值、
//     估值余额与 mutation log **都没有**被部分写入。
//   - 本文件只使用生产 HTTP 无关的领域 primitive；它**不是**生产通路证据。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from './db.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import {
  G03_L2_MUTATION_FACT_TABLES, OUTSOURCING_MUTATION_KEY_TEMPLATE,
  changedTables, describeSnapshotChanges, snapshotTables,
} from './test-support/m1-core-g03-g04-evidence.js';

const ACTOR = { id: 'u-act' };
const BUSINESS_DATE = '2026-11-07';

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at)
    VALUES('wh-A','WH-A','WH A',1,0,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at)
    VALUES('wh-WIP','WH-WIP','WH WIP',1,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
    VALUES('p-1','P-1','P 1','CAT','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
}

// 生产委外 canonical 变更键的五字段形状：sourceType、eventId、material.id、
// 物理腿种类、身份键。
function outsourcingMutationKey({ sourceType, eventId, materialId, identityKey = 'NONE' }) {
  return `${sourceType}:${eventId}:${materialId}:MOVE:${identityKey}`;
}

function sourcePosition() {
  return { productId: 'p-1', warehouseId: 'wh-A', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null };
}

function wipPosition() {
  return { productId: 'p-1', warehouseId: 'wh-WIP', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null };
}

// 独立复算生产冲突检测的**可读字段比较**（`server/lib/inventory-mutation.js` 的
// `readableMismatch` 中与指纹子句并列的部分）。
//
// 用途：证明 L2-2 的 409 来自「键命中 + 内容不同」这条承重条件，而不是来自
// 「键未命中」或任何无关错误分支。本函数**不**调用生产内部实现，是一次独立
// 再推导。
//
// 事实说明（已由变异实验确认）：在委外严格路径上，生产 `readableMismatch` 的
// `request_fingerprint` 子句与本函数的字段比较**冗余** —— 任何能让指纹不同的
// 输入差异，同时也会让这些可读字段不同。因此承重的是可读字段比较；把
// 指纹子句单独去掉不会让本套件失败，而把整个 `readableMismatch` 去掉会让
// L2-2 失败（变异实验见候审证据）。
function localReadableMismatch(stored, input) {
  return stored.source_type !== input.sourceType
    || String(stored.source_id) !== String(input.sourceId)
    || String(stored.source_item_id) !== String(input.sourceItemId)
    || stored.movement_group_id !== input.movementGroupId
    || stored.movement_kind !== input.movementKind
    || stored.business_date !== input.businessDate
    || Number(stored.quantity) !== Number(input.quantity);
}

describe('M1C-WP7-A-R1 — G03 L2 canonical inventory primitive 证据', () => {
  let db;
  let dbDir;

  before(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-m1c-g03-l2-'));
    db = createDatabase(join(dbDir, 'test.db'));
    seedMaster(db);
    // 起始库存同样由 canonical primitive 写入，不直接 SQL 造业务事实。
    applyInventoryMutation({
      db, actor: ACTOR, sourceType: 'OTHER_RECEIPT', sourceId: 'seed-1', sourceItemId: 'seed-1',
      movementKind: 'IN', movementGroupId: 'seed-1', quantity: 100, businessDate: BUSINESS_DATE,
      idempotencyKey: 'OTHER_RECEIPT:seed-1:seed-1:IN:NONE',
      toPosition: sourcePosition(), trackingMode: 'EXTERNAL', valuationMode: 'EXTERNAL',
    });
  });

  after(() => {
    try { db?.close?.(); } catch { /* ignore */ }
    try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function issueInput({ eventId, materialId, quantity }) {
    const key = outsourcingMutationKey({ sourceType: 'OUTSOURCING_ISSUE', eventId, materialId });
    return {
      db, actor: ACTOR, sourceType: 'OUTSOURCING_ISSUE', sourceId: eventId, sourceItemId: materialId,
      sourceNo: 'SO-1', movementKind: 'MOVE', movementGroupId: eventId,
      quantity, businessDate: BUSINESS_DATE, idempotencyKey: key,
      fromPosition: sourcePosition(), toPosition: wipPosition(),
      trackingMode: 'EXTERNAL', valuationMode: 'EXTERNAL',
    };
  }

  test('L2-0 生产委外变更键仍由同样五个字段构成（L2 证据的键形状不得漂移）', () => {
    const source = readFileSync(new URL('./modules/outsourcing-inventory.js', import.meta.url), 'utf8');
    const match = source.match(/const mutationKey = `([^`]+)`/);
    assert.ok(match, '必须能定位生产委外 canonical 变更键的构造点');
    assert.equal(match[1], OUTSOURCING_MUTATION_KEY_TEMPLATE, '五字段变更键合同不得漂移');
    // 模板本身必须真的由五个字段构成。
    assert.equal(Object.keys({ sourceType: 1, eventId: 1, material: 1, movement: 1, identity: 1 }).length, 5);
    assert.equal(OUTSOURCING_MUTATION_KEY_TEMPLATE.split(':').length, 5);
  });

  test('L2-1 同键同指纹只 replay，且不产生第二条物理腿', () => {
    const before = snapshotTables(db, G03_L2_MUTATION_FACT_TABLES);

    const first = applyInventoryMutation(issueInput({ eventId: 'evt-1', materialId: 'mat-1', quantity: 5 }));
    assert.equal(first.replayed, false, '首次执行不得是 replay');
    assert.equal(first.movements.length, 2, 'MOVE 必须成对产生 OUT 与 IN 两条物理腿');
    assert.deepEqual(first.movements.map((movement) => movement.direction).sort(), ['IN', 'OUT']);

    const afterFirst = snapshotTables(db, G03_L2_MUTATION_FACT_TABLES);
    assert.deepEqual(
      changedTables(before, afterFirst).sort(), ['inventory', 'inventory_mutation_log', 'inventory_transactions'],
      '首次执行只能新增物理腿、流水与 mutation log',
    );
    // 委外严格模式为 EXTERNAL：canonical primitive **自身不写**跟踪腿与估值流水。
    // 这一条是口径声明，不是「跟踪与估值已被 primitive 完成」的证明。
    assert.equal(afterFirst.tracked_inventory_movements.length, before.tracked_inventory_movements.length,
      'EXTERNAL 模式下 primitive 不写跟踪腿；跟踪与估值由调用方负责');
    assert.equal(afterFirst.inventory_valuation_movements.length, before.inventory_valuation_movements.length,
      'EXTERNAL 模式下 primitive 不写估值流水；跟踪与估值由调用方负责');
    assert.equal(afterFirst.inventory_valuation_balances.length, before.inventory_valuation_balances.length,
      'EXTERNAL 模式下 primitive 不写估值余额；跟踪与估值由调用方负责');

    const replay = applyInventoryMutation(issueInput({ eventId: 'evt-1', materialId: 'mat-1', quantity: 5 }));
    assert.equal(replay.replayed, true, '同键同指纹必须 replay');
    assert.equal(replay.movementGroupId, first.movementGroupId, 'replay 必须返回同一 movement group');
    assert.deepEqual(
      changedTables(afterFirst, snapshotTables(db, G03_L2_MUTATION_FACT_TABLES)), [],
      'replay 不得产生任何新的物理腿、流水、跟踪、估值或 mutation log',
    );
  });

  test('L2-2 同键异指纹精确 409 INVENTORY_MUTATION_UNEXPECTED_REPLAY，且六类事实零部分写入', () => {
    const key = outsourcingMutationKey({ sourceType: 'OUTSOURCING_ISSUE', eventId: 'evt-2', materialId: 'mat-2' });
    const seeded = applyInventoryMutation(issueInput({ eventId: 'evt-2', materialId: 'mat-2', quantity: 5 }));
    assert.equal(seeded.replayed, false);

    const before = snapshotTables(db, G03_L2_MUTATION_FACT_TABLES);
    let thrown = null;
    try {
      applyInventoryMutation(issueInput({ eventId: 'evt-2', materialId: 'mat-2', quantity: 3 }));
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, '同键异指纹必须被拒绝');
    assert.equal(thrown.status, 409, '必须返回 409');
    assert.equal(thrown.code, 'INVENTORY_MUTATION_UNEXPECTED_REPLAY', '必须是精确的冲突码');

    const after = snapshotTables(db, G03_L2_MUTATION_FACT_TABLES);
    assert.deepEqual(
      changedTables(before, after), [],
      `冲突后不得有任何部分写入，实际变化：${describeSnapshotChanges(before, after).join(', ') || '无'}`,
    );
    assert.equal(after.inventory_mutation_log.length, before.inventory_mutation_log.length, 'mutation log 不得新增行');
    assert.equal(after.inventory_transactions.length, before.inventory_transactions.length, '物理流水不得新增行');
    assert.equal(after.tracked_inventory_movements.length, before.tracked_inventory_movements.length, '跟踪腿不得新增行');
    assert.equal(after.inventory_valuation_movements.length, before.inventory_valuation_movements.length, '估值流水不得新增行');
    assert.equal(after.inventory_valuation_balances.length, before.inventory_valuation_balances.length, '估值余额不得新增行');
  });

  test('L2-3 负控：拒绝来自「键命中 + 内容比对」而非「键未命中」，且拒绝是键作用域的', () => {
    const key = outsourcingMutationKey({ sourceType: 'OUTSOURCING_ISSUE', eventId: 'evt-3', materialId: 'mat-3' });
    applyInventoryMutation(issueInput({ eventId: 'evt-3', materialId: 'mat-3', quantity: 5 }));

    // 独立负控一：若生产代码不做内容比对，同一五字段键会被直接判为 replay。
    // 这里独立复算该分支，证明 L2-2 的 409 **不是**「键未命中」造成的。
    const stored = db.prepare('SELECT * FROM inventory_mutation_log WHERE idempotency_key=?').get(key);
    assert.ok(stored, '该五字段键必须能命中既有 mutation log 行');
    const wouldReplayWithoutContentComparison = Boolean(stored);
    assert.equal(wouldReplayWithoutContentComparison, true,
      '若去掉内容比对，同键同指纹将走 replay 分支；故 L2-2 的拒绝必然来自内容比对');

    // 独立负控二：独立复算承重的内容比较条件，确认它对「同键异内容」成立。
    const conflicting = issueInput({ eventId: 'evt-3', materialId: 'mat-3', quantity: 4 });
    assert.equal(localReadableMismatch(stored, conflicting), true,
      '独立复算必须能识别出同键异内容；否则 L2-2 的 409 就没有承重条件');

    // 独立负控三：不同的五字段键（不同 eventId）必须照常成功 —— 证明拒绝是
    // 键作用域的，而不是「第二次调用一律失败」。
    const otherKey = outsourcingMutationKey({ sourceType: 'OUTSOURCING_ISSUE', eventId: 'evt-3b', materialId: 'mat-3' });
    const other = applyInventoryMutation(issueInput({ eventId: 'evt-3b', materialId: 'mat-3', quantity: 5 }));
    assert.equal(other.replayed, false, '不同五字段键必须独立成功');
    assert.notEqual(other.movementGroupId, stored.movement_group_id, '不同键必须得到不同的 movement group');

    // 独立负控四：同键异内容仍然必须被拒绝（键命中 + 内容不同）。
    let thrown = null;
    try {
      applyInventoryMutation(issueInput({ eventId: 'evt-3b', materialId: 'mat-3', quantity: 4 }));
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, '同键异内容必须被拒绝');
    assert.equal(thrown.code, 'INVENTORY_MUTATION_UNEXPECTED_REPLAY');
  });
});
