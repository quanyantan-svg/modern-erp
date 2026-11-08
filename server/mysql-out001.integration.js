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
import { releaseMySqlIdempotencyLocks, transaction, mysqlSessionState } from './db.js';
import { runG07GateRace, waitForNewTransaction } from './test-utils/m1-core-g07-lock-wait.js';
import {
  compareTableParity, readMySqlInformationSchemaContract,
} from './test-utils/m1-core-schema-parity.js';
import {
  countRows, out001BusinessSnapshot, out001IdempotencyLockName,
  out001PhysicalFinanceSnapshot,
} from './test-utils/mysql-out001-target.js';
import { isWipTransferUniqueConstraintError } from './modules/outsourcing-finance.js';

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

async function startIndependentOut001App() {
  const child = fork(new URL('../scripts/gates/mysql-out001-http-app-child.mjs', import.meta.url), [], {
    env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let ready;
  try {
    ready = await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('OUT001_M2_APP_START_TIMEOUT')), 30_000);
      child.on('message', (message) => {
        if (message?.type === 'READY') { clearTimeout(timer); resolveReady(message); }
        if (message?.type === 'ERROR') { clearTimeout(timer); reject(new Error(message.message)); }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`OUT001_M2_APP_EXIT_${code}:${stderr}`));
      });
    });
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    throw error;
  }
  return {
    ...ready,
    child,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.send({ type: 'STOP' });
      await new Promise((resolveClose, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('OUT001_M2_APP_STOP_TIMEOUT'));
        }, 15_000);
        child.once('exit', () => { clearTimeout(timer); resolveClose(); });
      });
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

  test('M1b 命名锁在请求进行中被持有，并在业务拒绝（ROLLBACK）后释放', { skip: isMySql ? false : MYSQL_ONLY }, async () => {
    const barrier = openIndependentSession();
    const probe = openIndependentSession();
    const source = await createOrderWithMaterial();
    const target = await createOrderWithMaterial();
    await issueWip(source.orderId, source.materialRow, 5);
    const key = `out001-m1b-${Date.now()}`;
    const appLock = out001IdempotencyLockName('OUTSOURCING_WIP_TRANSFER', source.orderId, key);
    try {
      // 屏障会话持有全局事务门禁：应用请求会阻塞在门禁上，但它**已经**取得
      // 自己的幂等命名锁。
      barrier.exec('START TRANSACTION');
      barrier.prepare('SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE').get();
      // 超额请求会在取得全局事务门禁、重读余额后抛出业务错误，使
      // transaction() 走真实 ROLLBACK；幂等命名锁仍必须在回滚后释放。
      const pending = postTransfer(fixture.baseUrl, fixture.tokens.admin, transferBody(source, target, 6, key));
      await waitForNewTransaction(barrier, new Set(), 'OUT001_M1B');
      // 请求进行中：独立会话拿不到应用的幂等锁。
      assert.equal(Number(probe.prepare('SELECT GET_LOCK(?,1) acquired').get(appLock).acquired), 0,
        '请求进行中应用必须持有幂等命名锁');
      barrier.exec('COMMIT');
      const response = await pending;
      assert.equal(response.status, 409, JSON.stringify(response.data));
      assert.equal(response.data.code, 'OUTSOURCING_WIP_TRANSFER_OVERDRAW');
      // 请求完成后：锁已被释放。
      assert.equal(Number(probe.prepare('SELECT GET_LOCK(?,5) acquired').get(appLock).acquired), 1,
        '请求完成后应用必须释放幂等命名锁');
      assert.equal(Number(probe.prepare('SELECT RELEASE_LOCK(?) released').get(appLock).released), 1);
    } finally {
      barrier.close();
      probe.close();
    }
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
      assert.equal(countRows(fixture.db, 'outsourcing_wip_transfers'), 1, '并发不得双写转移事实');
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
      await Promise.all([fixtureA, fixtureB].filter(Boolean).map((app) => app.close()));
    }
  });

  test('M3 会话状态、锁释放未确认隔离与不确定 COMMIT 不重跑业务体', { skip: isMySql ? false : MYSQL_ONLY }, async () => {
    const session = openIndependentSession();
    try {
      // R1/R3 的可判定前提：会话状态机在真实 MySQL 上可观测。
      assert.equal(mysqlSessionState(session), 'IDLE_TRUSTED');
      transaction(session, () => {
        assert.equal(mysqlSessionState(session), 'ACTIVE');
      });
      assert.equal(mysqlSessionState(session), 'IDLE_TRUSTED');

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
        session._idempotencyLocks = new Set([unownedLock]);
        session._idempotencyLockEpoch = session.sessionEpoch;
        const release = releaseMySqlIdempotencyLocks(session);
        assert.equal(release.attempted, 1);
        assert.equal(release.verified.length, 0);
        assert.deepEqual(release.unverified.map((item) => item.outcome), ['NOT_OWNER']);
        assert.equal(release.quarantined, true, '未确认释放必须由生产函数触发 quarantine');
        const state = session.quarantineState;
        assert.equal(state.state, 'TERMINATION_PENDING');
        await state.termination;
        assert.equal(state.state, 'TERMINATION_CONFIRMED', 'R1 要求终止已确认');
        assert.equal(session.sessionState, 'TERMINATED');
        assert.equal(mysqlSessionState(session), 'TERMINATED');
        assert.equal(Number(other.prepare('SELECT IS_FREE_LOCK(?) free').get(sentinelLock)?.free), 1,
          'observer 必须证明原命名锁已在服务器端释放');
        assert.equal(Number(other.prepare('SELECT GET_LOCK(?,5) acquired').get(sentinelLock)?.acquired), 1,
          'observer 必须能够重新取得同一命名锁');
        assert.equal(Number(other.prepare('SELECT RELEASE_LOCK(?) released').get(sentinelLock)?.released), 1);
        assert.equal(Number(other.prepare(
          'SELECT COUNT(*) n FROM information_schema.PROCESSLIST WHERE ID=?',
        ).get(victimId)?.n || 0), 0, 'victim session 必须从 PROCESSLIST 消失');
        assert.deepEqual(
          processListIds(other), beforeIds.filter((id) => id !== victimId),
          '隔离不得意外创建新的业务会话',
        );
      } finally {
        other.close();
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
    try {
      assert.throws(() => transaction(mockAdapter, () => {
        workCalls += 1;
        // 在业务体末尾布置一次操作错误，使随后的 COMMIT 失败。
        mockAdapter.prepare('SELECT 1 FROM __recovery_inject_op_error WHERE code = ?').run('PROTOCOL_CONNECTION_LOST');
      }));
      assert.equal(workCalls, 1, 'COMMIT 失败后业务体不得被重跑');
      assert.notEqual(mysqlSessionState(mockAdapter), 'IDLE_TRUSTED',
        'COMMIT 失败的会话不得回到可信空闲状态');
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
