// PL-RI-02 —— SQLite migration fail-closed 合同回归。
//
// 本文件覆盖 Requirement §36.16.2 与 Design §32.16.4 的验收条款：
//   fresh / upgrade / replay / 未知 DDL / 复制中断 / 校验失败 / 重启重试，
// 并证明：未知错误向上传播、失败后不进入 seed 与服务监听、表重建失败不留
// `_new` 残留表与半复制数据。
//
// 证据层级：全部为 **SQLite 本地**证据，不接触 MySQL，不签发任何 Acceptance。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './db.js';
import {
  addColumnIfMissing, columnExists, migrationFailure, runMigrationStep,
} from './migrations/migration-runner.js';

// 演示数据会写入随机标识的行，破坏 schema 断言的可复算性；本文件只关心 schema 合同。
process.env.ERP_SEED_DEMO = 'false';

/** 在临时目录里执行一段逻辑，结束后一定关闭句柄并清理目录。 */
function withTempDb(label, fn) {
  const dir = mkdtempSync(join(tmpdir(), `erp-migration-${label}-`));
  const path = join(dir, 'erp.db');
  const opened = [];
  try {
    return fn(path, (db) => { opened.push(db); return db; });
  } finally {
    for (const db of opened) {
      try { db.close(); } catch { /* 已关闭 */ }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
}

/** 捕获抛出的错误对象（`assert.throws` 不返回错误本身）。 */
function captureThrow(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('期望抛出异常，但调用正常返回');
}

/**
 * 破坏 `inventory_transactions` 的形状，使「表重建」的复制语句读到不存在的列。
 *
 * 选它而不是 `accounting_vouchers`：后者在 `migrate()` 里就有索引引用 source_type，
 * 破坏后会在更早的段落失败，证明不了「复制中断发生在重建步骤内」。
 */
function corruptInventoryTransactions(db) {
  db.exec('DROP TABLE inventory_transactions');
  db.exec(`CREATE TABLE inventory_transactions (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    type TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  db.exec("INSERT INTO inventory_transactions VALUES('it-1','w-1','p-1',2,'OUT','MANUAL','s-1','2026-01-01')");
}

/** 把 `inventory_transactions` 恢复成 canonical 形态。 */
function repairInventoryTransactions(db) {
  db.exec('DROP TABLE inventory_transactions');
  db.exec(`CREATE TABLE inventory_transactions (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity_change REAL NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
    balance_after REAL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_no TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    creator_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (creator_id) REFERENCES users(id)
  )`);
}

/* ------------------------- 执行器单元层 ------------------------- */

test('runner：apply 失败向上传播并回滚，不吞掉原始异常', () => {
  withTempDb('unit-apply', (path, keep) => {
    const db = keep(new DatabaseSync(path));
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY, v TEXT)');
    db.exec("INSERT INTO t VALUES('a','1')");

    const error = captureThrow(() => runMigrationStep(db, {
      id: 'unit-apply',
      apply: (database) => {
        database.exec("INSERT INTO t VALUES('b','2')");
        database.exec('THIS IS NOT VALID SQL');
      },
    }));
    assert.equal(error.name, 'MigrationError');
    assert.equal(error.migrationId, 'unit-apply');
    // 原始异常没有被吞掉：它作为 cause 保留。
    assert.ok(error.cause, '原始异常必须作为 cause 保留');
    // 事务已回滚：失败的写入没有留下。
    assert.deepEqual(db.prepare('SELECT id FROM t').all().map((r) => r.id), ['a']);
    assert.equal(db.isTransaction, false, '失败后不得把连接留在事务中');
  });
});

test('runner：提交前校验失败与 DDL 失败等价，同样回滚', () => {
  withTempDb('unit-verify', (path, keep) => {
    const db = keep(new DatabaseSync(path));
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY)');
    const error = captureThrow(() => runMigrationStep(db, {
      id: 'unit-verify',
      apply: (database) => { database.exec("INSERT INTO t VALUES('x')"); },
      verify: () => false,
    }));
    assert.equal(error.migrationPhase, 'apply');
    assert.deepEqual(db.prepare('SELECT id FROM t').all(), []);
    assert.equal(db.isTransaction, false);
  });
});

test('runner：inspect 判定已满足时记为 replay，apply 不得执行', () => {
  withTempDb('unit-replay', (path, keep) => {
    const db = keep(new DatabaseSync(path));
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY)');
    let applied = false;
    const result = runMigrationStep(db, {
      id: 'unit-replay',
      inspect: () => true,
      apply: () => { applied = true; },
    });
    assert.equal(result.status, 'replayed');
    assert.equal(applied, false, 'inspect 判定已满足时不得执行 apply');
  });
});

test('runner：inspect 自身的错误带 inspect 阶段标识向上传播', () => {
  withTempDb('unit-inspect', (path, keep) => {
    const db = keep(new DatabaseSync(path));
    const error = captureThrow(() => runMigrationStep(db, {
      id: 'unit-inspect',
      inspect: () => { throw new Error('inspection exploded'); },
      apply: () => {},
    }));
    assert.equal(error.migrationPhase, 'inspect');
  });
});

test('runner：诊断信息脱敏，不泄露密码与连接串', () => {
  const error = migrationFailure('unit-redact', new Error('connect failed mysql://erp:s3cr3t@db:3306 password=hunter2'));
  assert.ok(!error.message.includes('s3cr3t'), `密码不得出现在诊断中: ${error.message}`);
  assert.ok(!error.message.includes('hunter2'), `密码不得出现在诊断中: ${error.message}`);
  assert.ok(error.message.includes('unit-redact'));
});

test('helper：addColumnIfMissing 幂等，列已存在时不重复执行 ALTER', () => {
  withTempDb('unit-column', (path, keep) => {
    const db = keep(new DatabaseSync(path));
    db.exec('CREATE TABLE t(id TEXT PRIMARY KEY)');
    assert.equal(addColumnIfMissing(db, 't', 'v', 'v TEXT'), true);
    assert.equal(columnExists(db, 't', 'v'), true);
    assert.equal(addColumnIfMissing(db, 't', 'v', 'v TEXT'), false);
  });
});

test('helper：未知 DDL 错误不被吞掉（表不存在时加列必须失败）', () => {
  withTempDb('unit-unknown', (path, keep) => {
    const db = keep(new DatabaseSync(path));
    assert.throws(() => addColumnIfMissing(db, 'missing_table', 'v', 'v TEXT'), /no such table/i);
  });
});

/* ------------------------- 初始化集成层 ------------------------- */

test('fresh：全新库初始化成功并达成目标形态', () => {
  withTempDb('fresh', (path, keep) => {
    const db = keep(createDatabase(path));
    const productionOrdersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='production_orders'").get().sql;
    assert.ok(productionOrdersSql.includes("'PENDING'"), 'production_orders CHECK 必须包含 PENDING');
    assert.equal(columnExists(db, 'accounting_vouchers', 'submitted_by'), true);
    assert.equal(columnExists(db, 'return_orders', 'delivery_id'), true);
    assert.equal(columnExists(db, 'inventory_transactions', 'quantity_change'), true);
  });
});

test('replay：同一库重复初始化成功，不得移除任何 schema 对象且目标形态保持', () => {
  withTempDb('replay', (path) => {
    const first = createDatabase(path);
    const before = first.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
      .map((r) => `${r.type} ${r.name}`);
    const shapeBefore = first.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_vouchers'").get().sql;
    first.close();
    const second = createDatabase(path);
    const after = second.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
      .map((r) => `${r.type} ${r.name}`);
    const shapeAfter = second.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_vouchers'").get().sql;
    second.close();
    const removed = before.filter((name) => !after.includes(name));
    assert.deepEqual(removed, [], `重复初始化不得移除任何 schema 对象: ${removed.join(', ')}`);
    assert.ok(shapeAfter.includes("'ENTERED'"), '重复初始化后目标形态必须保持');
    assert.equal(
      shapeAfter.replace(/\s+/g, ' '),
      shapeBefore.replace(/\s+/g, ' '),
      '重复初始化不得改变已达成目标形态的表结构',
    );
  });
});

test('upgrade：legacy 形态的库被升级，数据完整保留', () => {
  withTempDb('upgrade', (path) => {
    // 构造一个 legacy 形态：production_orders 缺少 PENDING 状态，且带真实数据。
    const legacy = new DatabaseSync(path);
    // creator_id 引用 users(id)，legacy 库必须先有真实用户，否则重建时的
    // INSERT 会被外键拒绝（与迁移本身无关）。
    legacy.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );`);
    legacy.exec("INSERT INTO users VALUES('u-1','legacy','Legacy','hash','salt','r-1',1,'2026-01-01')");
    legacy.exec(`CREATE TABLE production_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','IN_PROGRESS','COMPLETED','CANCELLED')),
      planned_start TEXT,
      planned_finish TEXT,
      actual_start TEXT,
      actual_finish TEXT,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
    legacy.exec("INSERT INTO production_orders VALUES('po-1','PO-1','p-1',3,'DRAFT',NULL,NULL,NULL,NULL,'','u-1','2026-01-01','2026-01-01')");
    legacy.close();

    const db = createDatabase(path);
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='production_orders'").get().sql;
    assert.ok(sql.includes("'PENDING'"), '升级后 CHECK 必须包含 PENDING');
    const rows = db.prepare('SELECT id, order_no, quantity FROM production_orders').all();
    assert.equal(rows.length, 1, '升级不得丢失既有行');
    assert.equal(rows[0].order_no, 'PO-1');
    assert.equal(Number(rows[0].quantity), 3);
    db.close();
  });
});

test('复制中断：表重建失败时抛出带 migration 标识的错误，旧表与数据保留且无 _new 残留', () => {
  withTempDb('copy-interrupt', (path) => {
    const seed = createDatabase(path);
    corruptInventoryTransactions(seed);
    seed.close();

    const error = captureThrow(() => createDatabase(path));
    assert.equal(error.name, 'MigrationError');
    assert.ok(error.cause, '原始 SQLite 错误必须作为 cause 保留');

    const after = new DatabaseSync(path);
    const residue = tableNames(after).filter((n) => n.includes('_new_'));
    assert.deepEqual(residue, [], `失败后不得残留临时表: ${residue.join(', ')}`);
    const stillThere = after.prepare('SELECT id FROM inventory_transactions').all();
    assert.equal(stillThere.length, 1, '失败后旧表必须仍在');
    assert.equal(stillThere[0].id, 'it-1', '失败后旧数据必须仍在');
    after.close();
  });
});

test('重启重试：修复根因后重新初始化成功', () => {
  withTempDb('restart', (path) => {
    const seed = createDatabase(path);
    corruptInventoryTransactions(seed);
    seed.close();

    captureThrow(() => createDatabase(path));

    // 修复根因：把表恢复成 canonical 形态。
    const repair = new DatabaseSync(path);
    repairInventoryTransactions(repair);
    repair.close();

    const db = createDatabase(path);
    const columns = db.prepare("PRAGMA table_info(inventory_transactions)").all().map((c) => c.name);
    assert.ok(columns.includes('quantity_change'), '重试后必须达成目标形态');
    assert.ok(columns.includes('direction'));
    db.close();
  });
});

test('应用在迁移失败时不得进入 ready：server/index.js 不会监听', () => {
  withTempDb('no-ready', (path) => {
    const seed = createDatabase(path);
    corruptInventoryTransactions(seed);
    seed.close();

    const result = spawnSync(process.execPath, ['server/index.js'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, ERP_DB_BACKEND: 'sqlite', ERP_DB_PATH: path, PORT: '0' },
    });
    assert.notEqual(result.status, 0, `迁移失败时进程必须非零退出:\n${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /migration v1\.3-warehouse-logistics/);
    // 迁移失败时进程必须**自行退出**（signal === null）。
    // 若它进入了监听，就会一直存活直到被超时杀死（signal === 'SIGTERM'）。
    assert.equal(result.signal, null, '进程必须自行退出，而不是被超时杀死（后者意味着它错误地进入了监听）');
  });
});
