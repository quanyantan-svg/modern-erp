// OUT-001 真实 MySQL 8 Gate 的集成测试。
//
// 本文件由受保护的 Gate 子进程以 `ERP_TEST_DB_BACKEND=mysql` 运行。它包含：
//
//   1. 现有 28 项 OUT-001 focused 测试的 **MySQL 版本**（直接复用同一个测试
//      文件；该文件按后端选择夹具，因此 SQLite 与 MySQL 跑的是同一批断言）；
//   2. M1～M5 五项真实 MySQL 专有证据。
//
// Requirement : document.md §31.14.2
// Design      : docs/design/procurement-outsourcing.md §26.34.15、§26.34.15.2、
//               §26.34.14.2、§26.34.14.3

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';
import { MySqlSyncAdapter } from './database/mysql-adapter.js';
import { resolveDatabaseConfig } from './database/config.js';
import {
  MYSQL_TRANSACTION_ADMISSION_REFUSED, releaseMySqlIdempotencyLocks, transaction, mysqlSessionState,
} from './db.js';
import { runG07GateRace, waitForNewTransaction } from './test-utils/m1-core-g07-lock-wait.js';
import {
  compareTableParity, readMySqlInformationSchemaContract,
} from './test-utils/m1-core-schema-parity.js';
import {
  countRows, out001BusinessSnapshot, out001IdempotencyLockName,
  out001PhysicalFinanceSnapshot, snapshotTables,
} from './test-utils/mysql-out001-target.js';
import { isWipTransferUniqueConstraintError } from './modules/outsourcing-finance.js';
import {
  appendOut001DescendantRegistration, OUT_001_DESCENDANT_PURPOSE,
} from '../scripts/gates/mysql-out001-descendant-registry.mjs';

// 现有 28 项 OUT-001 focused 测试的 MySQL 版本：
//   · server/outsourcing-wip-transfer.test.js —— 21 项 WIP 转移专项；
//   · server/outsourcing-finance.test.js —— 7 项委外财务与收货链路。
// 两个文件按后端选择夹具，因此这里跑的是**同一批断言**的 MySQL 版本。
import './outsourcing-wip-transfer.test.js';
import './outsourcing-finance.test.js';

const MYSQL_ONLY = 'this evidence requires the protected real MySQL backend';
const isMySql = process.env.ERP_TEST_DB_BACKEND === 'mysql';

const OUT_001_PARITY_TABLES = Object.freeze([
  'outsourcing_wip_transfers',
  'outsourcing_material_list',
  'outsourcing_wip_identity_effects',
  'outsourcing_wip_identity_effect_allocations',
  'outsourcing_wip_identity_balances',
  'idempotency_records',
]);

const OUT_001_M1B_ZERO_SIDE_EFFECT_TABLES = Object.freeze([
  'outsourcing_wip_transfers',
  'outsourcing_wip_identity_effects',
  'outsourcing_wip_identity_effect_allocations',
  'outsourcing_wip_identity_balances',
  'outsourcing_material_list',
  'idempotency_records',
]);

function openIndependentSession() {
  const config = resolveDatabaseConfig({ backend: 'mysql' });
  return new MySqlSyncAdapter({
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, ssl: config.ssl,
  });
}

function processListIds(db) {
  const config = resolveDatabaseConfig({ backend: 'mysql' });
  return db.prepare(
    'SELECT ID id FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND USER=? ORDER BY ID',
  ).all(config.user).map((row) => Number(row.id));
}

/**
 * 强制回收独立 HTTP 应用子进程。
 *
 * 失败的测试绝不允许把子进程留给下一次 Gate：未退出的进程会继续持有
 * MySQL 会话与命名锁，让后续的「后代退出证明」永远无法通过。
 */
async function killOut001App(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill('SIGKILL'); } catch { /* the process is already gone */ }
  await new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolveExit(); return; }
    child.once('exit', resolveExit);
  });
}

async function startIndependentOut001App() {
  const child = fork(new URL('../scripts/gates/mysql-out001-http-app-child.mjs', import.meta.url), [], {
    env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const readyPromise = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('OUT001_HTTP_APP_START_TIMEOUT')), 30_000);
    child.on('message', (message) => {
      if (message?.type === 'READY') { clearTimeout(timer); resolveReady(message); }
      if (message?.type === 'ERROR') { clearTimeout(timer); reject(new Error(message.message)); }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`OUT001_HTTP_APP_EXIT_${code}:${stderr}`));
    });
  });
  let ready;
  try {
    if (process.env.ERP_OUT_001_DESCENDANT_REGISTRY) {
      await appendOut001DescendantRegistration({
        registryPath: process.env.ERP_OUT_001_DESCENDANT_REGISTRY,
        childLeasePath: process.env.ERP_OUT_001_ACK4_CHILD_LEASE,
        runId: process.env.ERP_OUT_001_DESCENDANT_RUN_ID,
        pid: child.pid,
        purpose: OUT_001_DESCENDANT_PURPOSE,
      });
    }
    ready = await readyPromise;
  } catch (error) {
    await killOut001App(child);
    await readyPromise.catch(() => {});
    throw error;
  }
  return {
    ...ready,
    child,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.send({ type: 'STOP' }); } catch { /* the IPC channel may already be closed */ }
      const exited = await new Promise((resolveClose) => {
        const timer = setTimeout(() => resolveClose(false), 15_000);
        child.once('exit', () => { clearTimeout(timer); resolveClose(true); });
      });
      if (exited) return;
      // 优雅退出超时：强制回收后再报错，绝不把仍然存活的子进程留给下一次 Gate。
      await killOut001App(child);
      throw new Error('OUT001_HTTP_APP_STOP_TIMEOUT');
    },
  };
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * 读取 SQLite 侧的表契约，供仓库既有的 `compareTableParity` 使用。
 * 它读的是**同一个** SQLite bootstrap 产物，与 MySQL 侧的
 * `readMySqlInformationSchemaContract` 构成双端对照。
 */
function readSqliteTableContract(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all().map((item) => ({
    name: item.name, type: item.type, notnull: item.notnull, dflt_value: item.dflt_value, pk: item.pk,
  }));
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all().map((item) => ({
    name: item.name,
    unique: Boolean(item.unique),
    origin: item.origin,
    columns: db.prepare(`PRAGMA index_info(${item.name})`).all().map((index) => index.name),
  }));
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${tableName})`).all().map((item) => ({
    from: item.from, table: item.table, to: item.to, on_update: item.on_update, on_delete: item.on_delete,
  }));
  return { name: tableName, sql: row?.sql || '', columns, indexes, foreignKeys };
}

describe('OUT-001 真实 MySQL 8 专有证据（M1–M5）', { concurrency: false }, () => {
  let fixture;
  let seq = 0;

  before(async () => {
    if (!isMySql) return;
    fixture = await createProcurementFixture('modern-erp-out001-mysql-');
  });
  after(async () => {
    if (fixture) await fixture.close();
  });

  async function createOrderWithMaterial({ productId = 'product-001' } = {}) {
    seq += 1;
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [{ productId, requiredQuantity: 10, unit: 'PCS' }], `out001-mysql-${seq}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    const snapshot = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/material-list`, fixture.tokens.admin, {
      items: [{ productId, requiredQuantity: 10, unit: 'PCS', sourceWarehouseId: 'warehouse-001' }],
    });
    assert.equal(snapshot.status, 200, snapshot.data.error);
    const materialRow = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(order.data.id, productId);
    return { orderId: order.data.id, materialRow };
  }

  async function issueWip(orderId, materialRow, quantity) {
    const issued = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: materialRow.id, quantity, issuedDate: isoDate(0), idempotencyKey: `mysql-issue-${orderId}-${quantity}-${seq}`,
    });
    assert.equal(issued.status, 201, issued.data.error);
  }

  function transferBody(source, target, quantity, idempotencyKey) {
    return {
      sourceOrderId: source.orderId,
      targetOrderId: target.orderId,
      materialListId: source.materialRow.id,
      quantity,
      transferDate: isoDate(0),
      idempotencyKey,
    };
  }

  async function postTransfer(baseUrl, token, body, signal) {
    const response = await fetch(`${baseUrl}/api/procurement/outsourcing/wip-transfers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  test('M1 命名锁：获取、COMMIT/ROLLBACK 后释放、第二会话可重新获取', { skip: isMySql ? false : MYSQL_ONLY }, async () => {
    const session1 = openIndependentSession();
    const session2 = openIndependentSession();
    const probe = openIndependentSession();
    try {
      const lockName = `out001-m1-probe-${Date.now()}`;
      // 1. 第一会话获取命名锁。
      assert.equal(Number(session1.prepare('SELECT GET_LOCK(?,10) acquired').get(lockName).acquired), 1);
      // 2. 第二会话在第一会话持锁时**必须**拿不到。
      assert.equal(Number(session2.prepare('SELECT GET_LOCK(?,1) acquired').get(lockName).acquired), 0);
      // 3. 第一会话释放。
      assert.equal(Number(session1.prepare('SELECT RELEASE_LOCK(?) released').get(lockName).released), 1);
      // 4. 第二会话此时可以重新获取 —— 释放是真实的、跨会话可见的。
      assert.equal(Number(session2.prepare('SELECT GET_LOCK(?,10) acquired').get(lockName).acquired), 1);
      assert.equal(Number(session2.prepare('SELECT RELEASE_LOCK(?) released').get(lockName).released), 1);

      // 应用自身的幂等命名锁：请求成功后必须已被 COMMIT 释放。
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const key = `out001-m1-app-${Date.now()}`;
      const created = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
        transferBody(source, target, 3, key));
      assert.equal(created.status, 201, JSON.stringify(created.data));
      const appLock = out001IdempotencyLockName('OUTSOURCING_WIP_TRANSFER', source.orderId, key);
      // 独立会话能够立即取得该锁，证明应用在 COMMIT 之后确实释放了它。
      assert.equal(Number(probe.prepare('SELECT GET_LOCK(?,5) acquired').get(appLock).acquired), 1);
      assert.equal(Number(probe.prepare('SELECT RELEASE_LOCK(?) released').get(appLock).released), 1);
    } finally {
      session1.close();
      session2.close();
      probe.close();
    }
  });

  test('M1b 命名锁在请求进行中被持有，并在业务拒绝（ROLLBACK）后释放', { skip: isMySql ? false : MYSQL_ONLY }, async (t) => {
    const barrier = openIndependentSession();
    const probe = openIndependentSession();
    let app = null;
    let barrierOpen = false;
    // 清理钩子必须在任何可能抛错的步骤**之前**注册：否则夹具准备阶段失败
    // 就会遗留两个已打开的 MySQL 会话。存活的子进程还会继续持有 MySQL
    // 会话与命名锁，让下一次 Gate 的「后代退出证明」永远无法通过。
    t.after(async () => {
      if (barrierOpen) {
        try { barrier.exec('ROLLBACK'); } catch (error) {
          t.diagnostic(`M1B_BARRIER_ROLLBACK_FAILED ${error.message}`);
        }
        barrierOpen = false;
      }
      try { barrier.close(); } catch (error) { t.diagnostic(`M1B_BARRIER_CLOSE_FAILED ${error.message}`); }
      try { probe.close(); } catch (error) { t.diagnostic(`M1B_PROBE_CLOSE_FAILED ${error.message}`); }
      if (app) {
        try {
          await app.close();
        } catch (error) {
          t.diagnostic(`M1B_APP_CLOSE_FAILED ${error.message}`);
        }
        if (app.child.exitCode === null && app.child.signalCode === null) {
          await killOut001App(app.child);
          t.diagnostic('M1B_APP_FORCE_KILLED_AFTER_FAILURE');
        }
      }
    });
    const source = await createOrderWithMaterial();
    const target = await createOrderWithMaterial();
    await issueWip(source.orderId, source.materialRow, 5);
    const key = `out001-m1b-${Date.now()}`;
    const appLock = out001IdempotencyLockName('OUTSOURCING_WIP_TRANSFER', source.orderId, key);
    const zeroSideEffectsBefore = snapshotTables(fixture.db, OUT_001_M1B_ZERO_SIDE_EFFECT_TABLES);
    const physicalBefore = out001PhysicalFinanceSnapshot(fixture.db);
    const rejectionsBefore = countRows(
      fixture.db,
      'audit_logs',
      "action='REJECT' AND entity_type='OUTSOURCING_ORDER' AND entity_id=?",
      [source.orderId],
    );
    app = await startIndependentOut001App();
    assert.notEqual(app.pid, process.pid, 'M1b HTTP 应用必须位于独立 Node.js 进程');
    t.diagnostic(`M1B_APP_STARTED pid=${app.pid}`);
    // 屏障会话持有全局事务门禁：应用请求会阻塞在门禁上，但它**已经**取得
    // 自己的幂等命名锁（`idempotencyReplay()` 在 `transaction()` 之前取锁）。
    barrier.exec('START TRANSACTION');
    barrierOpen = true;
    barrier.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
    t.diagnostic('M1B_BARRIER_HELD');
    // 超额请求会在取得全局事务门禁、重读余额后抛出业务错误，使
    // transaction() 走真实 ROLLBACK；幂等命名锁仍必须在回滚后释放。
    const requestState = { settled: false, outcome: null };
    const pending = postTransfer(app.baseUrl, app.tokens.admin, transferBody(source, target, 6, key)).then(
      (value) => {
        requestState.settled = true;
        requestState.outcome = { status: 'fulfilled', value };
        return value;
      },
      (reason) => {
        requestState.settled = true;
        requestState.outcome = { status: 'rejected', reason };
        throw reason;
      },
    );
    const waiter = await waitForNewTransaction(barrier, new Set(), 'OUT001_M1B', { requestState });
    assert.equal(requestState.settled, false, '观察到门禁等待者时 HTTP 请求必须仍在进行中');
    t.diagnostic(`M1B_HTTP_PENDING waiter=${waiter}`);
    // 请求进行中：独立会话拿不到应用的幂等锁。
    assert.equal(Number(probe.prepare('SELECT GET_LOCK(?,1) acquired').get(appLock).acquired), 0,
      '请求进行中应用必须持有幂等命名锁');
    t.diagnostic('M1B_NAMED_LOCK_HELD');
    barrier.exec('COMMIT');
    barrierOpen = false;
    t.diagnostic('M1B_BARRIER_RELEASED');
    const response = await pending;
    assert.equal(response.status, 409, JSON.stringify(response.data));
    assert.equal(response.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
    t.diagnostic(`M1B_HTTP_RESPONSE status=${response.status} code=${response.data.code}`);
    // 请求完成后：锁已被释放。
    assert.equal(Number(probe.prepare('SELECT GET_LOCK(?,5) acquired').get(appLock).acquired), 1,
      '请求完成后应用必须释放幂等命名锁');
    assert.equal(Number(probe.prepare('SELECT RELEASE_LOCK(?) released').get(appLock).released), 1);
    t.diagnostic('M1B_NAMED_LOCK_RELEASED');
    assert.equal(
      snapshotTables(fixture.db, OUT_001_M1B_ZERO_SIDE_EFFECT_TABLES),
      zeroSideEffectsBefore,
      '业务拒绝必须保持 WIP、身份、数量与幂等事实零副作用',
    );
    assert.equal(out001PhysicalFinanceSnapshot(fixture.db), physicalBefore,
      '业务拒绝不得产生物理库存、估值或财务副作用');
    assert.equal(
      countRows(
        fixture.db,
        'audit_logs',
        "action='REJECT' AND entity_type='OUTSOURCING_ORDER' AND entity_id=?",
        [source.orderId],
      ),
      rejectionsBefore + 1,
      '超额拒绝必须恰好记录一条拒绝审计',
    );
    t.diagnostic('M1B_REJECTION_AUDIT count=1');
    t.diagnostic('M1B_ZERO_SIDE_EFFECTS_PROVEN');
    // 子进程必须正常退出：退出码 0 且不得被信号终止。
    await app.close();
    assert.equal(app.child.exitCode, 0, 'M1b 独立 HTTP 应用必须正常退出');
    assert.equal(app.child.signalCode, null, 'M1b 独立 HTTP 应用不得被信号终止');
    t.diagnostic(`M1B_APP_EXITED pid=${app.pid} code=${app.child.exitCode}`);
  });

  test('M2 不同 Key、两个独立应用进程、同源并发竞争不得超额或双写', { skip: isMySql ? false : MYSQL_ONLY }, async () => {
    // 两个 child 各自拥有独立 Node.js 进程、HTTP Server 与 MySQL Adapter。
    let fixtureA;
    let fixtureB;
    let barrier;
    try {
      fixtureA = await startIndependentOut001App();
      fixtureB = await startIndependentOut001App();
      barrier = openIndependentSession();
      const source = await createOrderWithMaterial();
      const target = await createOrderWithMaterial();
      await issueWip(source.orderId, source.materialRow, 5);
      const before = out001BusinessSnapshot(fixture.db);
      const physicalBefore = out001PhysicalFinanceSnapshot(fixture.db);
      const transfersBefore = countRows(
        fixture.db,
        'outsourcing_wip_transfers',
      );

      const race = await runG07GateRace({
        db: barrier,
        label: 'OUT001_M2',
        requestA: (signal) => postTransfer(fixtureA.baseUrl, fixtureA.tokens.admin,
          transferBody(source, target, 3, `out001-m2-a-${Date.now()}`), signal),
        requestB: (signal) => postTransfer(fixtureB.baseUrl, fixtureB.tokens.admin,
          transferBody(source, target, 3, `out001-m2-b-${Date.now()}`), signal),
      });

      assert.notEqual(fixtureA.pid, fixtureB.pid, '两个应用实例必须位于两个独立 Node.js 进程');
      // 两个等待者必须是两个**不同的** MySQL 会话。
      assert.notEqual(race.waiterA, race.waiterB, '两个并发请求必须来自两个独立的 MySQL 会话');
      const created = race.responses.filter((response) => response.status === 201);
      const rejected = race.responses.filter((response) => response.status === 409);
      assert.equal(created.length, 1, '并发下只允许一个请求成功');
      assert.equal(rejected.length, 1, '并发败方必须是固定 409');
      // 真实 MySQL 下两个不同 Key 的转移被 mysql_transaction_gates 全局门禁串行化，
      // 败方在事务内重读到已扣减的余额，因此按**超额**拒绝（见 PROJECT_STATUS §45.11 M2）。
      assert.equal(rejected[0].data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');

      // 无双写、无超额：最终可用量与身份账一致。
      assert.equal(
        countRows(fixture.db, 'outsourcing_wip_transfers') - transfersBefore,
        1,
        '并发只能新增一笔 WIP Transfer',
      );
      assert.equal(
        Number(fixture.db.prepare(`
          SELECT COUNT(*) AS n
          FROM outsourcing_wip_transfers
          WHERE source_order_id=? AND target_order_id=?
        `).get(source.orderId, target.orderId).n),
        1,
        '本次源目标订单只能形成一笔转移事实',
      );
      const sourceRow = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(source.materialRow.id);
      const targetRow = fixture.db.prepare('SELECT * FROM outsourcing_material_list WHERE id=?').get(target.materialRow.id);
      assert.equal(Number(sourceRow.issued_quantity), 2);
      assert.equal(Number(targetRow.issued_quantity), 3);
      const sourceBalance = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key=?')
        .get(source.materialRow.id, 'NONE');
      const targetBalance = fixture.db.prepare('SELECT * FROM outsourcing_wip_identity_balances WHERE material_list_id=? AND identity_key=?')
        .get(target.materialRow.id, 'NONE');
      assert.equal(Number(sourceBalance.available_quantity), 2);
      assert.equal(Number(targetBalance.available_quantity), 3);
      assert.ok(Number(sourceBalance.available_quantity) >= 0, '最终可用量不得为负');
      assert.notEqual(before, out001BusinessSnapshot(fixture.db), '并发必须只产生一组业务事实');
      assert.equal(physicalBefore, out001PhysicalFinanceSnapshot(fixture.db), '并发不得产生物理库存/估值/财务副作用');
    } finally {
      try { barrier?.close(); } catch {}
      // 逐个关闭：其中一个关闭失败不得让另一个仍然存活的子进程被遗留。
      for (const app of [fixtureA, fixtureB].filter(Boolean)) {
        try {
          await app.close();
        } catch {
          await killOut001App(app.child);
        }
      }
    }
  });

  test('M3 会话状态、锁释放未确认隔离与不确定 COMMIT 不重跑业务体', { skip: isMySql ? false : MYSQL_ONLY }, async (t) => {
    const session = openIndependentSession();
    try {
      // R1/R3 的可判定前提：会话状态机在真实 MySQL 上可观测。
      assert.equal(mysqlSessionState(session), 'FRESH');
      t.diagnostic('M3_STATE FRESH');
      transaction(session, () => {
        assert.equal(mysqlSessionState(session), 'ACTIVE');
        t.diagnostic('M3_COMMIT_PATH ACTIVE');
      });
      assert.equal(mysqlSessionState(session), 'IDLE_TRUSTED');
      t.diagnostic('M3_COMMIT_PATH IDLE_TRUSTED');

      const rollbackProbe = new Error('OUT001_M3_ROLLBACK_PROBE');
      assert.throws(() => transaction(session, () => {
        assert.equal(mysqlSessionState(session), 'ACTIVE');
        t.diagnostic('M3_ROLLBACK_PATH ACTIVE');
        throw rollbackProbe;
      }), (error) => error === rollbackProbe);
      assert.equal(mysqlSessionState(session), 'IDLE_TRUSTED');
      t.diagnostic('M3_ROLLBACK_PATH IDLE_TRUSTED');

      // victim 真实持有 sentinelLock，但本地幂等锁集合只登记一个从未持有的
      // unownedLock。生产 release 函数对 unownedLock 得到 NOT_OWNER 后隔离并
      // 终止 victim；sentinelLock 只能随该真实会话终止而由服务器释放。
      const sentinelLock = `out001-m3-sentinel-${Date.now()}`;
      const unownedLock = `out001-m3-unowned-${Date.now()}`;
      assert.equal(Number(session.prepare('SELECT GET_LOCK(?,10) acquired').get(sentinelLock).acquired), 1);
      const other = openIndependentSession();
      try {
        const victimId = Number(session.prepare('SELECT CONNECTION_ID() id').get()?.id);
        const beforeIds = processListIds(other);
        assert.equal(Number(other.prepare('SELECT IS_USED_LOCK(?) owner').get(sentinelLock)?.owner), victimId,
          'sentinelLock 必须由 victim 真实持有');
        assert.equal(Number(other.prepare('SELECT GET_LOCK(?,0) acquired').get(sentinelLock)?.acquired), 0,
          'victim 终止前 observer 不得取得 sentinelLock');
        // observer 持有 unownedLock，victim 不持有。victim 对它执行
        // RELEASE_LOCK 时，MySQL 必须返回 0（NOT_OWNER）。
        const observerId = Number(other.prepare('SELECT CONNECTION_ID() id').get().id);
        assert.equal(Number(other.prepare('SELECT GET_LOCK(?,0) acquired').get(unownedLock)?.acquired), 1,
          'observer 必须成功持有 unownedLock');
        assert.equal(Number(other.prepare('SELECT IS_USED_LOCK(?) owner').get(unownedLock)?.owner), observerId,
          'unownedLock 的真实所有者必须是 observer');
        session._idempotencyLocks = new Set([unownedLock]);
        session._idempotencyLockEpoch = session.sessionEpoch;
        const release = releaseMySqlIdempotencyLocks(session);
        assert.equal(release.attempted, 1);
        assert.equal(release.verified.length, 0);
        assert.deepEqual(release.unverified.map((item) => item.outcome), ['NOT_OWNER']);
        assert.equal(release.quarantined, true, '未确认释放必须由生产函数触发 quarantine');
        t.diagnostic('M3_QUARANTINE CONFIRMED');
        const state = session.quarantineState;
        assert.equal(state.state, 'TERMINATION_PENDING');

        // 终止**未确认**时禁止连接复用（§26.34.14.3 P3）：被隔离的适配器
        // 必须拒绝 admission，并且不得再向服务器发出任何语句。
        let reuseCalls = 0;
        assert.throws(() => transaction(session, () => { reuseCalls += 1; }), (error) => {
          assert.equal(error.code, MYSQL_TRANSACTION_ADMISSION_REFUSED);
          assert.equal(error.reason, 'ADAPTER_QUARANTINED');
          return true;
        });
        assert.equal(reuseCalls, 0, '终止未确认时不得在该连接上重放业务体');
        const blockedRelease = releaseMySqlIdempotencyLocks(session);
        assert.equal(blockedRelease.attempted, 0, '被隔离的适配器不得再尝试释放任何命名锁');
        assert.equal(blockedRelease.quarantined, true);
        t.diagnostic('M3_REUSE_BLOCKED_WHILE_TERMINATION_PENDING');

        await state.termination;
        assert.equal(state.state, 'TERMINATION_CONFIRMED', 'R1 要求终止已确认');
        assert.equal(session.sessionState, 'TERMINATED');
        // 隔离是终态：适配器一旦隔离就不再是可复用会话，`mysqlSessionState()`
        // 因此报告 QUARANTINED 而不是 IDLE_TRUSTED（§26.34.14.3 R1 / P3）。
        assert.equal(mysqlSessionState(session), 'QUARANTINED',
          '终止已确认的隔离会话不得回到可复用的可信空闲状态');
        t.diagnostic('M3_TERMINATION CONFIRMED');
        // 终止已确认后仍然禁止复用同一连接。
        let reuseAfterTermination = 0;
        assert.throws(() => transaction(session, () => { reuseAfterTermination += 1; }), (error) => {
          assert.equal(error.code, MYSQL_TRANSACTION_ADMISSION_REFUSED);
          return true;
        });
        assert.equal(reuseAfterTermination, 0, '终止已确认后也不得在该连接上重放业务体');
        t.diagnostic('M3_REUSE_BLOCKED_AFTER_TERMINATION_CONFIRMED');
        assert.equal(Number(other.prepare('SELECT IS_FREE_LOCK(?) free').get(sentinelLock)?.free), 1,
          'observer 必须证明原命名锁已在服务器端释放');
        assert.equal(Number(other.prepare('SELECT GET_LOCK(?,5) acquired').get(sentinelLock)?.acquired), 1,
          'observer 必须能够重新取得同一命名锁');
        assert.equal(Number(other.prepare('SELECT RELEASE_LOCK(?) released').get(sentinelLock)?.released), 1);
        assert.equal(Number(other.prepare(
          'SELECT COUNT(*) n FROM information_schema.PROCESSLIST WHERE ID=?',
        ).get(victimId)?.n || 0), 0, 'victim session 必须从 PROCESSLIST 消失');
        // R3：核验连接必须可信且与原会话不同。
        assert.ok(['IDLE_TRUSTED', 'FRESH'].includes(mysqlSessionState(other)),
          '核验连接必须是可信会话');
        assert.notEqual(Number(other.prepare('SELECT CONNECTION_ID() id').get()?.id), victimId,
          '核验连接必须与原会话不同');
        assert.deepEqual(
          processListIds(other), beforeIds.filter((id) => id !== victimId),
          '隔离不得意外创建新的业务会话',
        );
      } finally {
        try {
          const owner = Number(other.prepare('SELECT IS_USED_LOCK(?) owner').get(unownedLock)?.owner);
          const observerId = Number(other.prepare('SELECT CONNECTION_ID() id').get()?.id);
          if (owner === observerId) {
            assert.equal(Number(other.prepare('SELECT RELEASE_LOCK(?) released').get(unownedLock)?.released), 1,
              'observer 必须释放其持有的 unownedLock');
          }
        } finally {
        other.close();
        }
      }
    } finally {
      try { session.close(); } catch { /* the adapter may already be terminated */ }
    }

    // 不确定 COMMIT：业务体**不得**被重跑。真实 MySQL 的「COMMIT 结果未知」
    // 需要以更高权限在提交中途 KILL CONNECTION；disposable least-privilege
    // 账户刻意没有该权限，因此这一段用仓库自带的 recovery worker 夹具证明
    // **代码路径**，并把真实库的不可达性显式记录下来（不得冒充已证明）。
    const recoveryWorker = new URL('./database/test-fixtures/recovery-mysql-worker.js', import.meta.url);
    const config = resolveDatabaseConfig({ backend: 'mysql' });
    const mockAdapter = new MySqlSyncAdapter({
      host: config.host, port: config.port, database: config.database,
      user: config.user, password: config.password, ssl: config.ssl,
    }, { workerUrl: recoveryWorker });
    let workCalls = 0;
    let uncertainError = null;
    try {
      assert.throws(() => transaction(mockAdapter, () => {
        workCalls += 1;
        // 先布置一次会话错误：连接丢失后重新建链会失败，因此随后的 ROLLBACK
        // 无法被证明。未确认的 ROLLBACK 必须让适配器进入隔离，而不是回到
        // 可信空闲状态。
        mockAdapter.prepare('SELECT 1 FROM __recovery_inject_session_error WHERE code = ?').run('PROTOCOL_CONNECTION_LOST');
        // 再布置一次连接丢失，使随后的 COMMIT 失败且结果未知：服务端可能已
        // 提交，客户端无法区分「已提交」与「已回滚」。
        mockAdapter.prepare('SELECT 1 FROM __recovery_inject_op_error WHERE code = ?').run('PROTOCOL_CONNECTION_LOST');
      }), (error) => { uncertainError = error; return true; });
      assert.equal(workCalls, 1, '不确定 COMMIT 之后业务体不得被重跑');
      assert.equal(uncertainError?.code, 'PROTOCOL_CONNECTION_LOST',
        '不确定 COMMIT 的原始错误必须原样透出，调用侧才能按 §26.34.14.3 处置');
      assert.equal(uncertainError?.sessionLost, true,
        '连接丢失必须携带 sessionLost 标记，否则调用侧无法识别不确定 COMMIT');
      assert.equal(mockAdapter.quarantined, true,
        '未确认的 ROLLBACK 必须让适配器进入隔离');
      assert.notEqual(mysqlSessionState(mockAdapter), 'IDLE_TRUSTED',
        '不确定 COMMIT 之后会话不得回到可信空闲状态');
      t.diagnostic('M3_UNCERTAIN_COMMIT workCalls=1 sessionLost=true quarantined=true');
      // 被隔离的连接不得用于重放业务体（§26.34.14.3 P3）。
      let reuseCalls = 0;
      assert.throws(() => transaction(mockAdapter, () => { reuseCalls += 1; }), (error) => {
        assert.equal(error.code, MYSQL_TRANSACTION_ADMISSION_REFUSED);
        return true;
      });
      assert.equal(reuseCalls, 0, '隔离后不得在该连接上重放业务体');
    } finally {
      try { mockAdapter.close(); } catch { /* the mock worker may already be torn down */ }
    }
  });

  test('M4 CHECK / UNIQUE / FK 与 SQLite-MySQL Schema Parity', { skip: isMySql ? false : MYSQL_ONLY }, async () => {
    const db = fixture.db;
    // 一条真实的物料行：让后续断言的外键成立，从而**只有**被测的那一个约束
    // （CHECK / UNIQUE / FK）被违反 —— 否则断言会因外键先失败而变成空洞的。
    const source = await createOrderWithMaterial();
    const now = new Date().toISOString();
    const probeMaterialId = `out001-m4-material-${Date.now()}`;
    db.prepare(`INSERT INTO outsourcing_material_list(
      id,order_id,product_id,required_quantity,unit,issued_quantity,supplemented_quantity,returned_quantity,
      backflushed_quantity,bom_snapshot_json,source_warehouse_id,legacy_unverified_wip_quantity,identity_evidence_state,created_at,updated_at)
      VALUES(?,?,?,0,'EA',0,0,0,0,'{}','warehouse-001',0,'NONE',?,?)`)
      .run(probeMaterialId, source.orderId, source.materialRow.product_id, now, now);

    // 4.1 CHECK：available_quantity 必须等于 supplied − consumed。
    const checkError = (() => {
      try {
        db.prepare(`INSERT INTO outsourcing_wip_identity_balances(
          material_list_id,identity_key,identity_type,lot_id,serial_id,evidence_state,
          supplied_quantity,consumed_quantity,available_quantity,last_effect_id,created_at,updated_at)
          VALUES(?,'NONE','NONE',NULL,NULL,'QUANTITY_ONLY',5,0,4,NULL,?,?)`)
          .run(probeMaterialId, now, now);
        return null;
      } catch (error) { return error; }
    })();
    assert.ok(checkError, 'MySQL 必须拒绝 available_quantity ≠ supplied − consumed');
    assert.match(String(checkError.message), /check constraint/i, '必须是 CHECK 约束被违反，而不是其它约束');

    // 4.2 CHECK：SUPPLY 的 signed_quantity 必须为正。
    const directionError = (() => {
      try {
        db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
          id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
          event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at)
          VALUES(?,?,'NONE','NONE',NULL,NULL,'SUPPLY',-1,'ISSUE','evt','item',NULL,'2026-01-01',?,'fp',?)`)
          .run(`out001-m4-effect-${Date.now()}`, probeMaterialId, `out001-m4-effect-key-${Date.now()}`, now);
        return null;
      } catch (error) { return error; }
    })();
    assert.ok(directionError, 'MySQL 必须拒绝 SUPPLY 的非正 signed_quantity');
    assert.match(String(directionError.message), /check constraint/i, '必须是 CHECK 约束被违反');

    // 4.3 FK：source_effect_id 必须指向一个存在的 effect。
    const fkError = (() => {
      try {
        db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
          id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
          event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at)
          VALUES(?,?,'NONE','NONE',NULL,NULL,'CONSUME',-1,'TRANSFER_OUT','evt','item','missing-effect','2026-01-01',?,'fp',?)`)
          .run(`out001-m4-fk-${Date.now()}`, probeMaterialId, `out001-m4-fk-key-${Date.now()}`, now);
        return null;
      } catch (error) { return error; }
    })();
    assert.ok(fkError, 'MySQL 必须拒绝指向不存在 effect 的 source_effect_id');
    assert.match(String(fkError.message), /foreign key/i, '必须是外键被违反');

    function assertDuplicate(error, label) {
      assert.ok(error, `${label} 必须拒绝重复键`);
      assert.ok(error.code === 'ER_DUP_ENTRY' || error.errno === 1062,
        `${label} 必须返回真实 MySQL ER_DUP_ENTRY/1062: ${error.code}/${error.errno}`);
      assert.equal(isWipTransferUniqueConstraintError(error), true, `${label} 必须被生产分类器识别`);
    }

    // 4.4 UNIQUE：identity effect 的业务身份键。
    const supplyEffectId = `out001-m4-supply-${Date.now()}`;
    db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
      id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
      event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at)
      VALUES(?,?,'NONE','NONE',NULL,NULL,'SUPPLY',1,'ISSUE','m4-event','m4-item',NULL,'2026-01-01',?,'fp',?)`)
      .run(supplyEffectId, probeMaterialId, `out001-m4-supply-key-${Date.now()}`, now);
    const effectUniqueError = (() => {
      try {
        db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
          id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
          event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at)
          VALUES(?,?,'NONE','NONE',NULL,NULL,'SUPPLY',1,'ISSUE','m4-event','m4-item',NULL,'2026-01-01',?,'fp',?)`)
          .run(`out001-m4-supply-dup-${Date.now()}`, probeMaterialId, `out001-m4-supply-dup-key-${Date.now()}`, now);
        return null;
      } catch (error) { return error; }
    })();
    assertDuplicate(effectUniqueError, 'identity effect business key');

    // 4.5 UNIQUE：effect allocation 的 (effect, source supply, kind)。
    const consumeEffectId = `out001-m4-consume-${Date.now()}`;
    db.prepare(`INSERT INTO outsourcing_wip_identity_effects(
      id,material_list_id,identity_key,identity_type,lot_id,serial_id,effect_direction,signed_quantity,
      event_type,business_event_id,business_event_item_id,source_effect_id,business_date,idempotency_key,request_fingerprint,created_at)
      VALUES(?,?,'NONE','NONE',NULL,NULL,'CONSUME',-1,'TRANSFER_OUT','m4-transfer','m4-transfer-item',NULL,'2026-01-01',?,'fp',?)`)
      .run(consumeEffectId, probeMaterialId, `out001-m4-consume-key-${Date.now()}`, now);
    db.prepare(`INSERT INTO outsourcing_wip_identity_effect_allocations(
      id,effect_id,source_supply_effect_id,allocation_kind,allocated_quantity,created_at)
      VALUES(?,?,?,'TRANSFER_ORIGIN',1,?)`).run(`out001-m4-allocation-${Date.now()}`, consumeEffectId, supplyEffectId, now);
    const allocationUniqueError = (() => {
      try {
        db.prepare(`INSERT INTO outsourcing_wip_identity_effect_allocations(
          id,effect_id,source_supply_effect_id,allocation_kind,allocated_quantity,created_at)
          VALUES(?,?,?,'TRANSFER_ORIGIN',1,?)`).run(
          `out001-m4-allocation-dup-${Date.now()}`, consumeEffectId, supplyEffectId, now,
        );
        return null;
      } catch (error) { return error; }
    })();
    assertDuplicate(allocationUniqueError, 'identity effect allocation key');

    // 4.6 UNIQUE：idempotency_records 的 (operation_type, document_id, idempotency_key)。
    const idempotencyValues = ['OUTSOURCING_WIP_TRANSFER', 'out001-doc', `out001-m4-key-${Date.now()}`];
    db.prepare(`INSERT INTO idempotency_records(
      id,operation_type,document_id,idempotency_key,request_fingerprint,result_json,status,created_at)
      VALUES(?,?,?,?,?,'{}','SUCCEEDED',?)`).run(
      `out001-m4-idem-first-${Date.now()}`, ...idempotencyValues, 'fp', now,
    );
    const uniqueError = (() => {
      try {
        db.prepare(`INSERT INTO idempotency_records(
          id,operation_type,document_id,idempotency_key,request_fingerprint,result_json,status,created_at)
          VALUES(?,?,?,?,?,'{}','SUCCEEDED',?)`).run(
          `out001-m4-idem-dup-${Date.now()}`, ...idempotencyValues, 'fp', now,
        );
        return null;
      } catch (error) { return error; }
    })();
    assertDuplicate(uniqueError, 'idempotency business key');

    // 4.7 双端 Schema Parity：同一份 SQLite bootstrap 与真实 MySQL 目录的列 /
    // 索引 / 外键 / CHECK 必须一致（复用仓库既有的比较器）。
    const { createTempDb } = await import('./test-utils/temp-db.js');
    const previousBackend = process.env.ERP_TEST_DB_BACKEND;
    process.env.ERP_TEST_DB_BACKEND = 'sqlite';
    let sqliteHandle;
    try {
      sqliteHandle = createTempDb({ label: 'out001-parity' });
      const failures = [];
      for (const table of OUT_001_PARITY_TABLES) {
        const sqliteTable = readSqliteTableContract(sqliteHandle.db, table);
        const errors = compareTableParity(sqliteTable, readMySqlInformationSchemaContract(db, table));
        if (errors.length) failures.push(`${table}:${errors.join(',')}`);
      }
      assert.deepEqual(failures, [], `SQLite-MySQL Schema Parity 不匹配: ${failures.join(' | ')}`);
    } finally {
      if (sqliteHandle) sqliteHandle.cleanup();
      if (previousBackend === undefined) delete process.env.ERP_TEST_DB_BACKEND;
      else process.env.ERP_TEST_DB_BACKEND = previousBackend;
    }
  });

  test('M5 transfer_no UNIQUE 冲突映射为稳定 409', { skip: isMySql ? false : MYSQL_ONLY }, async () => {
    const source = await createOrderWithMaterial();
    const target = await createOrderWithMaterial();
    await issueWip(source.orderId, source.materialRow, 5);
    const created = await fixture.request('POST', '/api/procurement/outsourcing/wip-transfers', fixture.tokens.admin,
      transferBody(source, target, 3, `out001-m5-${Date.now()}`));
    assert.equal(created.status, 201, JSON.stringify(created.data));

    // (a) 真实的 MySQL 唯一约束必须拒绝重复的 transfer_no。
    const duplicateError = (() => {
      try {
        fixture.db.prepare(`INSERT INTO outsourcing_wip_transfers(
          id,transfer_no,source_order_id,target_order_id,material_list_id,quantity,transfer_date,business_status,creator_id,created_at)
          VALUES(?,?,?,?,?,?,?,'CONFIRMED','user-admin',?)`).run(
          `out001-m5-dup-${Date.now()}`, created.data.transferNo,
          source.orderId, target.orderId, target.materialRow.id, 1, isoDate(0), new Date().toISOString());
        return null;
      } catch (error) { return error; }
    })();
    assert.ok(duplicateError, 'MySQL 必须拒绝重复的 transfer_no');
    assert.match(String(duplicateError.message), /duplicate entry/i, '必须是唯一键被违反');

    // (b) 该错误必须被 handler 的分类器识别为「唯一键冲突」，从而映射为
    //     409 OUTSOURCING_WIP_TRANSFER_NO_CONFLICT，而不是 500。
    assert.equal(isWipTransferUniqueConstraintError(duplicateError), true,
      'handler 必须把真实的 MySQL 重复键错误识别为唯一键冲突');
    // (c) 分类器不得把无关错误误判为唯一键冲突。
    assert.equal(isWipTransferUniqueConstraintError(new Error('unrelated')), false);
    assert.equal(isWipTransferUniqueConstraintError(null), false);
  });
});
