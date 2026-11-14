// Platform 域真实 MySQL 8 不变量实证套件。
//
// 四个场景，每个都带一个**负控**（negative control）：一个证明守卫真实承重的变体。
// 负控若不能被观察到，这个场景就**没有**证明守卫承重，因此负控与主场景同样重要。
//
//   S1 职责分离拒绝的**事务外证据** —— 事务回滚后，判定记录与审计行仍在
//      （这是 Platform 域本轮新增的能力：拒绝证据此前随回滚一起消失）。
//      负控：另一个主体审批同一张单据**必须成功** —— 证明守卫不是无差别拒绝。
//   S2 编号服务的幂等并发 —— 同一幂等键并发取号必须返回**同一单号**（PL-DEF-12）。
//      负控：不同幂等键必须拿到**不同**单号 —— 证明守卫不是「永远返回同一个」。
//   S3 通知去重 —— 同一去重键并发产生必须只落一条。
//      负控：不同去重键必须各落一条 —— 证明去重不是「全部丢弃」。
//   S4 平台 schema 形态 —— 17 张新表 + notifications / audit_logs 加列被真实 MySQL 8 接受。
//
// 并发场景用**独立的 worker 子进程**：每个 worker 持有自己的 MySQL 会话，并通过同一个
// 文件闸门一起释放，因此两个竞争者在同一瞬间进入被争用的代码路径，竞态发生在真实的
// MySQL 8 服务器上，而不是同一个事件循环里的同步调用交错。
//
// 运行（真实 MySQL，由 ACK-4 campaign 子进程承载）：
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… \
//   node --test server/mysql-platform-domain-races.integration.js
//
// 运行（离线 SQLite 校验，只证明夹具与断言自洽，**不是**真实 MySQL 证据）：
//   node --test server/mysql-platform-domain-races.integration.js

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';
import { createApp } from './app.js';
import { hashPassword } from './db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'platform-domain-races-worker.mjs');

// The campaign gate flag. Inside the ACK-4 campaign the suite runs on the leased
// MySQL target and the schema drop belongs to the Root's CLEANUP_SCHEMA_POST_RUN
// child. Outside the campaign the suite runs on a local SQLite database and the
// result is explicitly NOT real-MySQL evidence.
const inCampaign = process.env.ERP_PLATFORM_MYSQL_GATE === '1';

const platformGateLifecycle = {
  beforeCreate(config) {
    if (!/(?:test|phase7|disposable|domain_test)/i.test(String(config?.database || ''))) {
      throw new Error(`PLATFORM RACE SUITE REFUSED: ${config?.database} is not a disposable target`);
    }
  },
  verify(db) {
    if (db.dialect !== 'mysql') throw new Error(`PLATFORM RACE SUITE REFUSED: dialect=${db.dialect}`);
  },
  reset() {
    // The Root's CLEANUP_SCHEMA_POST_RUN child owns the schema drop.
  },
};

const ADMIN_ID = 'platform-race-admin';
const ADMIN2_ID = 'platform-race-admin2';
const REVIEWER_ID = 'platform-race-reviewer';
const PRODUCT_ID = 'platform-race-product';
const ORDER_ID = 'platform-race-order';
const ORDER_NO = 'MO-PLATFORM-RACE';
const ADMIN_PASSWORD = 'platform-race-pass';

const PLATFORM_TABLES = Object.freeze([
  'workflow_templates', 'workflow_template_versions', 'workflow_bindings', 'workflow_binding_history',
  'workflow_instances', 'workflow_node_instances', 'workflow_tasks', 'workflow_action_logs', 'workflow_events',
  'sod_rules', 'sod_evaluations', 'organizations', 'organization_scopes', 'organization_scope_bindings',
  'attachments', 'notification_subscriptions', 'document_number_series',
]);

let db;
let handle;
let httpServer;
let baseUrl;
let gateDir;
let workerEnv = process.env;

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `login ${username} failed: ${JSON.stringify(data)}`);
  return data.token;
}

async function apiCall(token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/**
 * 启动一个 worker 并让它在闸门处等待。返回 { result(), release() }。
 */
function startWorker(name, command) {
  const child = spawn(process.execPath, [workerPath], {
    cwd: repoRoot, env: {
      ...workerEnv,
      ERP_PLATFORM_RACE_GATE_DIR: gateDir,
      ERP_PLATFORM_RACE_WORKER: name,
    },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.write(`${JSON.stringify(command)}\n`);
  child.stdin.end();
  const exit = new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code)));
  return {
    name,
    async waitReady() {
      const readyPath = join(gateDir, `ready-${name}`);
      const deadline = Date.now() + 30_000;
      while (!existsSync(readyPath)) {
        if (Date.now() >= deadline) throw new Error(`PLATFORM RACE WORKER NOT READY: ${name} ${stderr}`);
        await new Promise((done) => setTimeout(done, 10));
      }
    },
    release() {
      writeFileSync(join(gateDir, 'release'), new Date().toISOString());
    },
    async result() {
      const code = await exit;
      const line = stdout.trim().split(/\r?\n/).findLast((item) => item.startsWith('{'));
      if (code !== 0 || !line) throw new Error(`PLATFORM RACE WORKER FAILED: ${name} exit=${code} stderr=${stderr}`);
      return JSON.parse(line);
    },
  };
}

before(async () => {
  handle = createTempDb({ label: 'platform-race', mysqlLifecycle: inCampaign ? platformGateLifecycle : null });
  db = handle.db;
  workerEnv = { ...process.env };
  if (!inCampaign) workerEnv.ERP_PLATFORM_RACE_DB_PATH = handle.dbPath;
  gateDir = mkdtempSync(join(tmpdir(), 'modern-erp-platform-race-gate-'));

  const now = new Date().toISOString();
  const password = hashPassword(ADMIN_PASSWORD, 'platform-race-salt');
  for (const [id, username, displayName, roleId] of [
    [ADMIN_ID, 'platform-admin', '平台竞态管理员', 'role-admin'],
    [ADMIN2_ID, 'platform-admin2', '平台竞态管理员二', 'role-admin'],
    [REVIEWER_ID, 'platform-reviewer', '平台竞态审核员', 'role-reviewer'],
  ]) {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,?,1,?)`).run(id, username, displayName, password.hash, password.salt, roleId, now);
  }
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,?,?)`).run(
    PRODUCT_ID, 'PLATFORM-RACE-P', '平台竞态产品', '电子产品', '台', 100000, 0, now, now,
  );
  db.prepare(`INSERT INTO production_orders
    (id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    ORDER_ID, ORDER_NO, PRODUCT_ID, 1, 'SUBMITTED', '', ADMIN_ID, now, now, ADMIN_ID, now,
  );

  httpServer = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
  await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
});

after(async () => {
  await new Promise((done) => handle.close && done());
  if (httpServer) await new Promise((done) => httpServer.close(done));
  if (handle) handle.close();
});

describe('PLATFORM-MYSQL S1 职责分离拒绝的事务外证据', () => {
  test('发起人审批自己的生产工单被拒，且判定记录与审计行在事务回滚后仍在', async () => {
    const token = await login('platform-admin', ADMIN_PASSWORD);
    const before = db.prepare('SELECT COUNT(*) n FROM sod_evaluations').get().n;
    const { status, data } = await apiCall(token, `/api/production-orders/${ORDER_ID}/state`, {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 409, JSON.stringify(data));
    assert.equal(data.code, 'PLATFORM_SOD_RULE_VIOLATION');

    const evaluation = db.prepare(
      'SELECT * FROM sod_evaluations WHERE business_type=? AND business_id=? AND decision=?',
    ).get('PRODUCTION_ORDER', ORDER_ID, 'VIOLATED');
    assert.ok(evaluation, '拒绝判定记录必须在事务之外落库（回滚不得抹掉拒绝证据）');
    assert.equal(evaluation.actor_id, ADMIN_ID);

    const audit = db.prepare(
      "SELECT * FROM audit_logs WHERE action='SOD_RULE_VIOLATION' AND entity_type='PRODUCTION_ORDER' AND entity_id=?",
    ).get(ORDER_ID);
    assert.ok(audit, '拒绝审计行必须在事务之外落库');

    const order = db.prepare('SELECT status FROM production_orders WHERE id=?').get(ORDER_ID);
    assert.equal(order.status, 'SUBMITTED', '被拒后单据状态不得改变');
    const after = db.prepare('SELECT COUNT(*) n FROM sod_evaluations').get().n;
    assert.equal(after, before + 1, '只允许留下这一条判定记录');
  });

  test('负控：另一个主体审批同一张工单成功（守卫不是无差别拒绝）', async () => {
    const token = await login('platform-admin2', ADMIN_PASSWORD);
    const { status, data } = await apiCall(token, `/api/production-orders/${ORDER_ID}/state`, {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(ORDER_ID).status, 'APPROVED');
  });
});

describe('PLATFORM-MYSQL S2 编号服务的幂等并发（PL-DEF-12）', () => {
  test('同一幂等键并发取号返回同一单号，且只落一条分配记录', async () => {
    const idempotencyKey = `platform-race-${Date.now()}`;
    const command = {
      action: 'allocate', documentType: 'PRQ', businessDate: '2099-06-01', idempotencyKey,
    };
    const first = startWorker('number-a', command);
    const second = startWorker('number-b', command);
    await first.waitReady();
    await second.waitReady();
    first.release();
    second.release();
    const [a, b] = await Promise.all([first.result(), second.result()]);
    assert.equal(a.documentNo, b.documentNo, '同一幂等键必须返回同一单号');
    const allocations = db.prepare('SELECT COUNT(*) n FROM document_number_allocations WHERE idempotency_key=?')
      .get(idempotencyKey).n;
    assert.equal(allocations, 1, '同一幂等键只能落一条分配记录');
  });

  test('负控：不同幂等键拿到不同单号（守卫不是永远返回同一个号）', async () => {
    const keyA = `platform-race-a-${Date.now()}`;
    const keyB = `platform-race-b-${Date.now()}`;
    const make = (key) => ({ action: 'allocate', documentType: 'PRQ', businessDate: '2099-06-01', idempotencyKey: key });
    const first = startWorker('number-c', make(keyA));
    const second = startWorker('number-d', make(keyB));
    await first.waitReady();
    await second.waitReady();
    first.release();
    second.release();
    const [a, b] = await Promise.all([first.result(), second.result()]);
    assert.notEqual(a.documentNo, b.documentNo, '不同幂等键必须拿到不同单号');
  });
});

describe('PLATFORM-MYSQL S3 通知去重', () => {
  test('同一去重键并发产生只落一条通知', async () => {
    const dedupeKey = `platform-race-${Date.now()}`;
    const command = {
      action: 'notify', eventType: 'PLATFORM_RACE_EVENT', category: 'PLATFORM_RACE',
      title: '平台竞态通知', dedupeKey, recipientId: REVIEWER_ID,
    };
    const first = startWorker('notify-a', command);
    const second = startWorker('notify-b', command);
    await first.waitReady();
    await second.waitReady();
    first.release();
    second.release();
    const [a, b] = await Promise.all([first.result(), second.result()]);
    assert.equal(a.created + b.created, 1, '同一去重键只能创建一条通知');
    assert.equal(a.skipped + b.skipped, 1, '另一个必须被去重跳过');
    const rows = db.prepare('SELECT COUNT(*) n FROM notifications WHERE dedupe_key LIKE ?').get(`%${dedupeKey}%`).n;
    assert.equal(rows, 1, '通知表只能落一行');
  });

  test('负控：不同去重键各落一条（去重不是全部丢弃）', async () => {
    const suffix = Date.now();
    const make = (key) => ({
      action: 'notify', eventType: 'PLATFORM_RACE_EVENT', category: 'PLATFORM_RACE',
      title: '平台竞态通知', dedupeKey: key, recipientId: REVIEWER_ID,
    });
    const first = startWorker('notify-c', make(`platform-race-c-${suffix}`));
    const second = startWorker('notify-d', make(`platform-race-d-${suffix}`));
    await first.waitReady();
    await second.waitReady();
    first.release();
    second.release();
    const [a, b] = await Promise.all([first.result(), second.result()]);
    assert.equal(a.created + b.created, 2, '不同去重键必须各创建一条');
  });
});

describe('PLATFORM-MYSQL S4 平台 schema 形态', () => {
  const isMysql = db.dialect === 'mysql';
  // 目录查询是方言相关的：campaign 走 MySQL，离线校验走 SQLite。
  // 断言的**对象**（表名与列名）两条路径完全相同。
  const tableNames = () => (isMysql
    ? db.prepare('SHOW FULL TABLES').all().map((row) => Object.values(row).find((value) => typeof value === 'string'))
    : db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const columnNames = (table) => (isMysql
    ? db.prepare(`SHOW COLUMNS FROM ${table}`).all().map((row) => row.Field)
    : db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));

  test('17 张平台新表在真实 MySQL 上存在', () => {
    const present = new Set(tableNames());
    for (const table of PLATFORM_TABLES) {
      assert.ok(present.has(table), `平台表缺失: ${table}`);
    }
  });

  test('notifications 与 audit_logs 的平台加列在真实 MySQL 上存在', () => {
    const notificationColumns = new Set(columnNames('notifications'));
    for (const column of ['priority', 'category', 'action_url', 'expires_at', 'dedupe_key', 'event_type']) {
      assert.ok(notificationColumns.has(column), `notifications 缺少列: ${column}`);
    }
    const auditColumns = new Set(columnNames('audit_logs'));
    for (const column of ['business_date', 'request_id', 'before_json', 'after_json']) {
      assert.ok(auditColumns.has(column), `audit_logs 缺少列: ${column}`);
    }
  });
});
