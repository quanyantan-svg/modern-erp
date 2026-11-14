// R-02 期间控制真实 MySQL 8 不变量实证套件。
//
// 三个 **handler-vs-handler** 竞态场景，每个都带一个**负控**（negative control）：
// 一个证明守卫真实承重的变体。负控若不能被观察到，这个场景就**没有**证明守卫承重。
//
//   S1 库存关账 vs 库存 mutation —— 两个真实 canonical handler 并发。
//      允许的两种结果：
//        (a) 关账先完成 → mutation 被 409 拒绝（INVENTORY_PERIOD_CLOSED）；
//        (b) mutation 先完成并被关账快照纳入 → 关账成功，且快照里能看到该笔移动。
//      **禁止**：mutation 在关账提交之后仍然成功。
//      负控：同一时刻对**未关闭**期间的 mutation 必须成功 —— 证明守卫不是无差别拒绝。
//   S2 法定关账 vs 凭证 mutation —— 同上，凭证写入走 canonical 系统凭证入口。
//      负控：未关闭期间的凭证必须成功。
//   S3 经营关账 vs 分摊执行 —— 同上，两者都经 management_books 行锁串行化。
//      负控：未关闭期间的分摊执行必须成功。
//   S4 canonical 协调锚点的 schema 形态与行锁可用性（真实 MySQL 8 接受该表，
//      且 FOR UPDATE 锁锚点行成功）。
//      负控：锚点行**恰好**两行（INVENTORY / LEGAL_ACCOUNTING），没有多出来的轴。
//
// 并发场景用**独立的 worker 子进程**：每个 worker 持有自己的 MySQL 会话，并通过同一个
// 文件闸门一起释放，因此两个竞争者在同一瞬间进入被争用的代码路径，竞态发生在真实的
// MySQL 8 服务器上，而不是同一个事件循环里的同步调用交错。
//
// 运行（真实 MySQL，由 ACK-4 campaign 子进程承载）：
//   ERP_DB_BACKEND=mysql ERP_DB_HOST=… ERP_DB_PORT=… ERP_DB_NAME=… \
//   ERP_DB_USER=… ERP_DB_PASSWORD=… \
//   node --test server/mysql-r02-period-races.integration.js
//
// 运行（离线 SQLite 校验，只证明夹具与断言自洽，**不是**真实 MySQL 证据）：
//   node --test server/mysql-r02-period-races.integration.js

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTempDb } from './test-utils/temp-db.js';
import { hashPassword } from './db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'r02-period-races-worker.mjs');

// The campaign gate flag. Inside the ACK-4 campaign the suite runs on the leased
// MySQL target and the schema drop belongs to the Root's CLEANUP_SCHEMA_POST_RUN
// child. Outside the campaign the suite runs on a local SQLite database and the
// result is explicitly NOT real-MySQL evidence.
const inCampaign = process.env.ERP_R02_PERIOD_MYSQL_GATE === '1';

const r02GateLifecycle = {
  beforeCreate(config) {
    if (!/(?:test|phase7|disposable|domain_test)/i.test(String(config?.database || ''))) {
      throw new Error(`R02 RACE SUITE REFUSED: ${config?.database} is not a disposable target`);
    }
  },
  verify(db) {
    if (db.dialect !== 'mysql') throw new Error(`R02 RACE SUITE REFUSED: dialect=${db.dialect}`);
  },
  reset() {
    // The Root's CLEANUP_SCHEMA_POST_RUN child owns the schema drop.
  },
};

const ADMIN_ID = 'r02-race-admin';
const CLOSER_ID = 'r02-race-closer';
const ADMIN_PASSWORD = 'r02-race-pass';

const WAREHOUSE_ID = 'r02-race-wh';
const PRODUCT_ID = 'r02-race-product';
const BOOK_ID = 'r02-race-book';
const CENTER_ID = 'r02-race-center';
const PLAN_ID = 'r02-race-plan';
const RULE_ID = 'r02-race-rule';
const RULE_CODE = 'R02-RACE-RULE';

const CLOSE_PERIOD = '2026-02';
const MUTATION_DATE = '2026-02-15';
const OPEN_PERIOD = '2026-05';
const OPEN_DATE = '2026-05-15';
const LEGAL_MUTATION_DATE = '2026-02-20';

let db;
let handle;
let gateDir;
let workerEnv = process.env;

async function readCommand() { return null; }

function startWorker(name, command) {
  const child = spawn(process.execPath, [workerPath], {
    cwd: repoRoot, env: {
      ...workerEnv,
      ERP_R02_RACE_GATE_DIR: gateDir,
      ERP_R02_RACE_WORKER: name,
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
        if (Date.now() >= deadline) throw new Error(`R02 RACE WORKER NOT READY: ${name} ${stderr}`);
        await new Promise((done) => setTimeout(done, 10));
      }
    },
    release() {
      writeFileSync(join(gateDir, 'release'), new Date().toISOString());
    },
    async result() {
      const code = await exit;
      const line = stdout.trim().split(/\r?\n/).findLast((item) => item.startsWith('{'));
      if (!line) throw new Error(`R02 RACE WORKER FAILED: ${name} exit=${code} stderr=${stderr}`);
      return JSON.parse(line);
    },
  };
}

/**
 * Run two canonical handlers concurrently and report both outcomes.
 * The gate file is recreated for every race so the two workers really start
 * together.
 */
async function race(name, leftCommand, rightCommand) {
  const previousGate = gateDir;
  gateDir = await mkdtempPromise(`r02-race-${name}-`);
  const left = startWorker(`${name}-left`, leftCommand);
  const right = startWorker(`${name}-right`, rightCommand);
  await Promise.all([left.waitReady(), right.waitReady()]);
  left.release();
  const [leftResult, rightResult] = await Promise.all([left.result(), right.result()]);
  gateDir = previousGate;
  return { left: leftResult, right: rightResult };
}

function mkdtempPromise(prefix) {
  return mkdtempSync(join(tmpdir(), `modern-erp-${prefix}-`));
}

function seedMaster() {
  const now = new Date().toISOString();
  const password = hashPassword(ADMIN_PASSWORD, 'r02-race-salt');
  for (const [id, username, displayName] of [
    [ADMIN_ID, 'r02-admin', 'R-02 竞态管理员'],
    [CLOSER_ID, 'r02-closer', 'R-02 竞态关账人'],
  ]) {
    db.prepare('INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,\'role-admin\',1,?)')
      .run(id, username, displayName, password.hash, password.salt, now);
  }
  db.prepare("INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,is_supplier_wip,created_at,updated_at) VALUES(?,'R02-WH','R-02 仓库',1,0,0,?,?)")
    .run(WAREHOUSE_ID, now, now);
  db.prepare("INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES(?,'R02-P1','R-02 货品','CAT','PCS',1000,0,1,'NONE',?,?)")
    .run(PRODUCT_ID, now, now);
  db.prepare("INSERT OR IGNORE INTO profit_centers(id,code,name,management_book_id,org_unit,owner_user_id,status,created_at) VALUES(?,'R02-C1','R-02 经营单元',?,'ORG',?,'ACTIVE',?)")
    .run(CENTER_ID, BOOK_ID, ADMIN_ID, now);
}

before(async () => {
  // The demo seed is switched OFF: the campaign target holds the schema and the
  // canonical roles only. A seeded demo inventory would be unvalued stock and
  // would make the close precheck fail for a reason that has nothing to do with
  // the period guard.
  handle = createTempDb({ label: 'r02-race', production: true, mysqlLifecycle: inCampaign ? r02GateLifecycle : null });
  db = handle.db;
  workerEnv = { ...process.env };
  if (!inCampaign) workerEnv.ERP_R02_RACE_DB_PATH = handle.dbPath;
  gateDir = mkdtempPromise('r02-race-gate-');
  seedMaster();
  // 经营归集的来源是已过账分录。它们必须在**法定期间关闭之前**过账（法定期间一旦关闭，
  // 同期间的凭证写入就会被 canonical 守卫拒绝 —— 这正是 R-02 要证明的行为）。
  // 科目对取 GRNI / 进项税：两个都是资产科目，不产生损益（否则法定关账的损益结转前置
  // 会拦下它），也不在任何关账勾稽项里。
  const { createSystemVoucher } = await import('./modules/financial-inventory.js');
  for (const [sourceId, date] of [['r02-op-voucher', MUTATION_DATE], ['r02-op-voucher-open', OPEN_DATE]]) {
    createSystemVoucher(db, {
      sourceType: 'R02_OPERATING_SOURCE', sourceId, businessDate: date, actorId: ADMIN_ID,
      entries: [
        { role: 'GRNI', direction: 'DEBIT', amountCents: 1000, summary: 'R-02 经营归集来源' },
        { role: 'INPUT_TAX_RECEIVABLE', direction: 'CREDIT', amountCents: 1000, summary: 'R-02 经营归集来源' },
      ],
    });
  }
});

after(() => {
  try { handle?.db?.close(); } catch { /* already closed */ }
});

describe('R-02 期间控制真实 MySQL 竞态（handler-vs-handler）', () => {
  test('S1 库存关账 vs 库存 mutation：mutation 绝不晚于关账提交', async () => {
    // 前置：被关账期间 2026-02 内没有未完成单据；竞态中的移动引用一张**已确认**的
    // 库存调整单（业务日期可追溯，否则结账预检的 LEGACY ��查会 fail closed）。
    const now = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO inventory_adjustments(id,adjustment_no,warehouse_id,status,reason,adjustment_date,creator_id,confirmed_by,created_at,updated_at,confirmed_at) VALUES('r02-race-adjust','R02-ADJ-1',?,'CONFIRMED','R-02 竞态调整',?,?,?,?,?,?)")
      .run(WAREHOUSE_ID, MUTATION_DATE, ADMIN_ID, ADMIN_ID, now, now, now);

    const outcome = await race('s1', {
      action: 'inventoryClose', actorId: ADMIN_ID, period: CLOSE_PERIOD, today: '2026-11-01',
    }, {
      action: 'inventoryMutation', actorId: ADMIN_ID, sourceType: 'INVENTORY_ADJUSTMENT',
      sourceId: 'r02-race-adjust', businessDate: MUTATION_DATE,
      productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID, quantity: 5, idempotencyKey: 'R02:RACE:MOVE:1',
    });

    const close = outcome.left;
    const mutation = outcome.right;
    const closed = db.prepare("SELECT status,closed_at FROM inventory_period_closures WHERE period_key=?").get(CLOSE_PERIOD);
    const moved = db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE source_id='r02-race-move'").get().n;

    if (mutation.ok) {
      // mutation 赢了：它必须早于关账提交，且关账快照必须纳入它。
      assert.equal(close.ok, true, `mutation 先完成时关账也必须成功：${JSON.stringify(close)}`);
      const snapshot = db.prepare('SELECT snapshot_json FROM inventory_period_snapshots WHERE closure_id=(SELECT id FROM inventory_period_closures WHERE period_key=?)')
        .get(CLOSE_PERIOD);
      const closure = db.prepare('SELECT id,closed_at FROM inventory_period_closures WHERE period_key=?').get(CLOSE_PERIOD);
      const mutationRow = db.prepare('SELECT created_at FROM inventory_mutation_log WHERE source_id=?').get('r02-race-move');
      assert.ok(mutationRow, 'mutation 证据必须存在');
      assert.ok(
        String(mutationRow.created_at) <= String(closure.closed_at),
        `mutation 提交时间必须早于关账提交时间（mutation=${mutationRow.created_at} close=${closure.closed_at}）`,
      );
      const snapshotText = JSON.stringify(snapshot?.snapshot_json || '');
      assert.match(snapshotText, new RegExp(PRODUCT_ID), '关账快照必须纳入该笔库存移动');
    } else {
      // 关账赢了：mutation 必须被 409 拒绝，且期间状态保持 CLOSED。
      assert.equal(mutation.code, 'INVENTORY_PERIOD_CLOSED', `mutation 必须被期间闸门拒绝，实际 ${mutation.code}`);
      assert.equal(Number(moved), 0, '被拒绝的 mutation 不得留下任何写入');
      assert.equal(closed?.status, 'CLOSED');
    }
  });

  test('S1 负控：未关闭期间的并发 mutation 必须成功', async () => {
    const outcome = await race('s1nc', {
      action: 'inventoryClose', actorId: ADMIN_ID, period: CLOSE_PERIOD, today: '2026-11-01',
    }, {
      action: 'inventoryMutation', actorId: ADMIN_ID, sourceType: 'INVENTORY_ADJUSTMENT',
      sourceId: 'r02-open-move', businessDate: OPEN_DATE,
      productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID, quantity: 3, idempotencyKey: 'R02:RACE:MOVE:OPEN',
    });
    assert.equal(outcome.right.ok, true, `未关闭期间的 mutation 必须成功：${JSON.stringify(outcome.right)}`);
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE source_id='r02-open-move'").get().n), 1,
      '未关闭期间的 mutation 必须真实落库',
    );
  });

  test('S2 法定关账 vs 凭证 mutation：mutation 绝不晚于关账提交', async () => {
    // 前置：存货期间与三个 Finance 轴已关至 2026-02 末（依赖状态，不是被竞态的动作）。
    db.prepare("INSERT OR REPLACE INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes,close_checks_json) VALUES('r02-inv-gate',?,'CLOSED','r02-race-admin',?,'r02',?)")
      .run(CLOSE_PERIOD, new Date().toISOString(), JSON.stringify({ overallStatus: 'PASS', checks: [] }));
    db.prepare('UPDATE finance_business_close_state SET closed_through_date=?,updated_at=?,updated_by=?')
      .run('2026-02-28', new Date().toISOString(), 'r02-race-admin');
    const closureId = 'r02-legal-closure';
    db.prepare("INSERT OR REPLACE INTO period_closures(id,period,period_year,period_month,closure_type,status,created_at) VALUES(?,?,2026,2,'MONTH','OPEN',?)")
      .run(closureId, CLOSE_PERIOD, new Date().toISOString());

    // 被竞态的写动作是一笔**带凭证的记账型 mutation**（移动 + 估值 + 系统凭证），
    // 与收货路径同一形状：法定轴因此被真实地经由凭证写入路径触碰。
    db.prepare("INSERT OR REPLACE INTO inventory_adjustments(id,adjustment_no,warehouse_id,status,reason,adjustment_date,creator_id,confirmed_by,created_at,updated_at,confirmed_at) VALUES('r02-legal-adjust','R02-ADJ-2',?,'CONFIRMED','R-02 法定竞态调整',?,?,?,?,?,?)")
      .run(WAREHOUSE_ID, LEGAL_MUTATION_DATE, ADMIN_ID, ADMIN_ID, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    const outcome = await race('s2', {
      action: 'legalClose', actorId: ADMIN_ID, closureId,
    }, {
      action: 'inventoryMutation', actorId: ADMIN_ID, sourceType: 'INVENTORY_ADJUSTMENT',
      sourceId: 'r02-legal-adjust', businessDate: LEGAL_MUTATION_DATE,
      productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID, quantity: 4, idempotencyKey: 'R02:RACE:MOVE:LEGAL',
    });

    const close = outcome.left;
    const mutation = outcome.right;
    const closure = db.prepare('SELECT status,closed_at FROM period_closures WHERE id=?').get(closureId);
    const voucher = db.prepare("SELECT id,created_at FROM accounting_vouchers WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id='r02-legal-adjust'").get();

    if (mutation.ok) {
      assert.equal(close.ok, true, `mutation 先完成时法定关账也必须成功：${JSON.stringify(close)}`);
      assert.ok(voucher, '凭证证据必须存在');
      assert.ok(
        String(voucher.created_at) <= String(closure.closed_at),
        `凭证提交时间必须早于关账提交时间（voucher=${voucher.created_at} close=${closure.closed_at}）`,
      );
      assert.equal(closure.status, 'CLOSED');
    } else {
      // 拒绝必须来自 canonical 期间守卫。法定轴可能被存货轴**先命中**：
      // 法定关账的前置条件本身就要求同期的存货期间已关闭，而锁序里存货轴排在法定轴之前
      // （rank 10 < 50），因此同期间的写动作会先被存货轴拒绝 —— 这仍是正确的 fail closed。
      assert.ok(
        ['INVENTORY_PERIOD_CLOSED', 'FINANCIAL_PERIOD_CLOSED'].includes(mutation.code),
        `mutation 必须被期间守卫拒绝，实际 ${mutation.code}`,
      );
      assert.equal(voucher, undefined, '被拒绝的凭证不得留下任何写入');
      assert.equal(closure.status, 'CLOSED', `关账必须成功：${JSON.stringify(close)}`);
    }
  });

  test('S2 负控：未关闭期间的并发凭证必须成功', async () => {
    db.prepare("INSERT OR REPLACE INTO inventory_adjustments(id,adjustment_no,warehouse_id,status,reason,adjustment_date,creator_id,confirmed_by,created_at,updated_at,confirmed_at) VALUES('r02-open-adjust','R02-ADJ-3',?,'CONFIRMED','R-02 开放期间调整',?,?,?,?,?,?)")
      .run(WAREHOUSE_ID, OPEN_DATE, ADMIN_ID, ADMIN_ID, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    const outcome = await race('s2nc', {
      action: 'legalClose', actorId: CLOSER_ID, closureId: 'r02-legal-closure',
    }, {
      action: 'inventoryMutation', actorId: ADMIN_ID, sourceType: 'INVENTORY_ADJUSTMENT',
      sourceId: 'r02-open-adjust', businessDate: OPEN_DATE,
      productId: PRODUCT_ID, warehouseId: WAREHOUSE_ID, quantity: 2, idempotencyKey: 'R02:RACE:MOVE:OPENLEGAL',
    });
    assert.equal(outcome.right.ok, true, `未关闭期间的写动作必须成功：${JSON.stringify(outcome.right)}`);
    assert.equal(
      Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='INVENTORY_ADJUSTMENT' AND source_id='r02-open-adjust'").get().n), 1,
      '未关闭期间的写动作必须真实落库（含其系统凭证）',
    );
  });

  test('S3 经营关账 vs 分摊执行：mutation 绝不晚于关账提交', async () => {
    // 前置：经营账簿 + 归集计划 + 分摊规则 + 一条已存在的分摊结果（关账前置条件）。
    const now = new Date().toISOString();
    db.prepare("INSERT OR REPLACE INTO management_books(id,code,name,legal_entity,base_currency,status,created_at) VALUES(?,?,?,?,?,'OPEN',?)")
      .run(BOOK_ID, 'R02-BOOK', 'R-02 经营账簿', 'R-02', 'CNY', now);
    db.prepare("INSERT OR REPLACE INTO cost_collection_plans(id,management_book_id,period,source_json,status,created_by,created_at) VALUES(?,?,?,'{}','COLLECTED',?,?)")
      .run(PLAN_ID, BOOK_ID, CLOSE_PERIOD, ADMIN_ID, now);
    db.prepare("INSERT OR REPLACE INTO allocation_rules(id,management_book_id,code,name,basis_type,driver_json,status,created_at) VALUES(?,?,?,?,?,?,'ACTIVE',?)")
      .run(RULE_ID, BOOK_ID, RULE_CODE, 'R-02 竞态分摊规则', 'VALUE', '{}', now);
    db.prepare("INSERT OR REPLACE INTO allocation_results(id,plan_id,rule_id,source_json,target_profit_center_id,allocated_cents,status,created_at) VALUES(?,?,?,'{}',?,?,'ALLOCATED',?)")
      .run('r02-alloc-seed', PLAN_ID, RULE_ID, CENTER_ID, 1000, now);
    db.prepare("INSERT OR REPLACE INTO period_closures(id,period,period_year,period_month,closure_type,status,created_at) VALUES('r02-op-legal',?,2026,2,'MONTH','CLOSED',?)")
      .run(CLOSE_PERIOD, now);


    const outcome = await race('s3', {
      action: 'operatingClose', actorId: CLOSER_ID, managementBookId: BOOK_ID, period: CLOSE_PERIOD,
    }, {
      action: 'operatingCollect', actorId: ADMIN_ID, managementBookId: BOOK_ID, period: CLOSE_PERIOD,
      source: { kind: 'GL', accountCode: '1407' }, profitCenterId: CENTER_ID,
    });

    const close = outcome.left;
    const mutation = outcome.right;
    const closure = db.prepare('SELECT status,closed_at FROM operating_period_closures WHERE management_book_id=? AND period=?')
      .get(BOOK_ID, CLOSE_PERIOD);
    const plans = Number(db.prepare('SELECT COUNT(*) n FROM cost_collection_plans WHERE management_book_id=? AND period=?')
      .get(BOOK_ID, CLOSE_PERIOD).n);

    if (mutation.ok) {
      assert.equal(close.ok, true, '归集先完成时经营关账也必须成功');
      assert.ok(String(closure?.closed_at), '经营期间必须已关闭');
    } else {
      assert.equal(mutation.code, 'OPERATING_PERIOD_CLOSED', `归集必须被经营期间闸门拒绝，实际 ${mutation.code}`);
      assert.equal(closure?.status, 'CLOSED');
      assert.equal(plans, 1, '被拒绝的归集不得留下新的归集计划');
    }
  });

  test('S3 负控：未关闭期间的并发归集必须成功', async () => {
    const outcome = await race('s3nc', {
      action: 'operatingClose', actorId: CLOSER_ID, managementBookId: BOOK_ID, period: CLOSE_PERIOD,
    }, {
      action: 'operatingCollect', actorId: ADMIN_ID, managementBookId: BOOK_ID, period: OPEN_PERIOD,
      source: { kind: 'GL', accountCode: '1407' }, profitCenterId: CENTER_ID,
    });
    assert.equal(outcome.right.ok, true, `未关闭期间的归集必须成功：${JSON.stringify(outcome.right)}`);
  });

  test('S4 canonical 协调锚点的 schema 形态与行锁可用性', async () => {
    const columns = db.prepare('PRAGMA table_info(period_guard_anchors)').all().map((row) => row.name);
    assert.deepEqual(columns, ['axis', 'scope_key', 'version', 'updated_at']);
    const anchors = db.prepare('SELECT axis,scope_key FROM period_guard_anchors ORDER BY axis').all()
      .map((row) => ({ axis: row.axis, scope_key: row.scope_key }));
    // 负控：锚点行恰好两行 —— 多了就说明协调表被别的用途污染了。
    assert.deepEqual(anchors, [
      { axis: 'INVENTORY', scope_key: 'GLOBAL' },
      { axis: 'LEGAL_ACCOUNTING', scope_key: 'GLOBAL' },
    ]);
    // 行锁证明只在 MySQL 上有意义：SQLite 没有 FOR UPDATE。
    const lockSql = db.dialect === 'mysql'
      ? "SELECT axis FROM period_guard_anchors WHERE axis='INVENTORY' AND scope_key='GLOBAL' FOR UPDATE"
      : "SELECT axis FROM period_guard_anchors WHERE axis='INVENTORY' AND scope_key='GLOBAL'";
    const locked = db.prepare(lockSql).get();
    assert.ok(locked, '协调锚点行必须可被锁定');
  });
});
