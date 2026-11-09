// OUT-001 真实 MySQL 8 Gate 的目标绑定与快照原语。
//
// 三项职责：
//
//   1. 打开**已经 bootstrap 完成**的 disposable schema（绝不触发 migration / DDL，
//      绝不调用 createDatabase）；
//   2. 把 schema 清理的责任固定在 Root 的 CLEANUP_SCHEMA_POST_RUN 子进程：
//      测试进程只关闭自己的连接，deferMySqlCleanup() 让任何来自测试进程的
//      清理请求都变成「已延期」而不是执行；
//   3. 提供 M1–M5 需要的逐字段快照与确定性屏障辅助。
//
// Requirement : document.md §31.14.2（数量归属守恒 + 不可证明路径 fail closed）
// Design      : docs/design/procurement-outsourcing.md §26.34.15（OUT-001 有界批准）、
//               §26.34.15.2（身份链）、§26.34.14.2（transferNo）、§26.34.14.3（恢复条件）

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MySqlSyncAdapter } from '../database/mysql-adapter.js';
import { resolveDatabaseConfig } from '../database/config.js';
import { readWave10ConnectedIdentity } from './mysql-wave10-campaign-target.js';
import { deferMySqlCleanup, mysqlCleanupDeferralState, mysqlDisposableTargetIdentity } from './mysql-disposable-target.js';

export { deferMySqlCleanup, mysqlCleanupDeferralState };

/** OUT-001 的业务事实快照表：转移事实、身份账、物料行数量与幂等/审计记录。 */
export const OUT_001_BUSINESS_SNAPSHOT_TABLES = Object.freeze([
  'outsourcing_wip_transfers',
  'outsourcing_wip_identity_effects',
  'outsourcing_wip_identity_effect_allocations',
  'outsourcing_wip_identity_balances',
  'outsourcing_material_list',
  'idempotency_records',
  'audit_logs',
]);

/** 物理库存、估值与财务事实：逻辑数量归属转移必须对它们逐字段零变化。 */
export const OUT_001_PHYSICAL_FINANCE_TABLES = Object.freeze([
  'inventory',
  'inventory_transactions',
  'tracked_inventory_movements',
  'inventory_mutation_log',
  'inventory_valuation_movements',
  'inventory_valuation_balances',
  'supplier_bills',
  'supplier_bill_items',
  'account_payables',
  'accounting_vouchers',
  'accounting_entries',
]);

/**
 * The environment variable that declares a loopback proxy in front of the
 * authorized target. It is used by the OUT-001 M3 fault injection: the victim
 * application routes its MySQL session through a local proxy so the test can
 * withhold the COMMIT acknowledgement.
 *
 * The binding never changes WHICH server the process talks to. The connected
 * identity (server UUID, grants digest, version, CURRENT_USER, DATABASE) must
 * still match the target proof byte for byte.
 */
export const OUT_001_MYSQL_PROXY_BINDING_ENV = 'ERP_OUT_001_MYSQL_PROXY_BINDING';

function readProxyBinding(env = process.env) {
  const raw = String(env[OUT_001_MYSQL_PROXY_BINDING_ENV] ?? '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('OUT_001_MYSQL_PROXY_BINDING_INVALID');
  }
  const upstreamHost = String(parsed?.upstreamHost ?? '').trim();
  const upstreamPort = Number(parsed?.upstreamPort);
  if (!upstreamHost || !Number.isSafeInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
    throw new Error('OUT_001_MYSQL_PROXY_BINDING_INVALID');
  }
  return Object.freeze({ upstreamHost, upstreamPort });
}

/**
 * 打开已 bootstrap 的 disposable schema，并把会话身份钉在 target proof 上。
 * 该函数**不**执行任何 migration、DDL 或 seed。
 */
export function openOut001MySqlAdapter({ targetProofPath }) {
  const config = resolveDatabaseConfig({ backend: 'mysql' });
  const proxyBinding = readProxyBinding();
  const target = JSON.parse(readFileSync(resolve(targetProofPath), 'utf8'));
  // The disposable-target guard always runs against the identity this process
  // is authorized to talk to. A loopback proxy only changes the socket
  // address, never the target.
  const authorizedConfig = proxyBinding
    ? { ...config, host: proxyBinding.upstreamHost, port: proxyBinding.upstreamPort }
    : config;
  // This adapter only reads an already bootstrapped schema. It must not need
  // the destructive RESET flags passed to the suite or its HTTP descendants.
  const identity = mysqlDisposableTargetIdentity(authorizedConfig);
  if (!/(?:test|disposable)/i.test(authorizedConfig.database)
    || identity !== `mysql://${target.user}@${target.host}:${target.port}/${target.database}`) {
    throw new Error('OUT_001_MYSQL_READ_TARGET_REFUSED');
  }
  if (proxyBinding) {
    // The proxy must forward to exactly the approved target.
    if (String(proxyBinding.upstreamHost) !== String(target.host)
      || Number(proxyBinding.upstreamPort) !== Number(target.port)) {
      throw new Error('OUT_001_MYSQL_PROXY_UPSTREAM_DRIFT');
    }
  } else {
    for (const key of ['host', 'port']) {
      if (String(config[key]) !== String(target[key])) {
        throw new Error(`OUT_001_MYSQL_TARGET_CONFIG_DRIFT:${key}`);
      }
    }
  }
  for (const key of ['database', 'user']) {
    if (String(config[key]) !== String(target[key])) {
      throw new Error(`OUT_001_MYSQL_TARGET_CONFIG_DRIFT:${key}`);
    }
  }
  const db = new MySqlSyncAdapter(config);
  try {
    const actual = readWave10ConnectedIdentity(db);
    if (actual.database !== target.selectedDatabase
      || actual.currentUser !== target.currentUser
      || actual.serverUuid !== target.serverUuid
      || actual.grantDigest.toLowerCase() !== String(target.grantsSha256).toLowerCase()) {
      throw new Error('OUT_001_MYSQL_CONNECTED_TARGET_DRIFT');
    }
    if (!/^8\./.test(actual.version)) {
      throw new Error(`OUT_001_MYSQL_NOT_MYSQL_8:${actual.version || 'unknown'}`);
    }
    return { db, config, target, identity: actual };
  } catch (error) {
    db.close();
    throw error;
  }
}

function stableRows(db, table) {
  // MySQL 不保证无 ORDER BY 的行序，因此按整行序列化结果排序后再比较，
  // 使「逐字段零变化」在不同后端上是同一个判定。
  return db.prepare(`SELECT * FROM ${table}`).all()
    .map((row) => JSON.stringify(row))
    .sort();
}

export function snapshotTables(db, tables) {
  const snapshot = {};
  for (const table of tables) snapshot[table] = stableRows(db, table);
  return JSON.stringify(snapshot);
}

export function out001BusinessSnapshot(db) {
  return snapshotTables(db, OUT_001_BUSINESS_SNAPSHOT_TABLES);
}

export function out001PhysicalFinanceSnapshot(db) {
  return snapshotTables(db, OUT_001_PHYSICAL_FINANCE_TABLES);
}

/**
 * 计数快照：用于「恰好 N 条」类断言（转移事实、身份 effect、分配行）。
 */
export function countRows(db, table, where = '', params = []) {
  const clause = where ? ` WHERE ${where}` : '';
  return Number(db.prepare(`SELECT COUNT(*) count FROM ${table}${clause}`).get(...params).count);
}

/**
 * MySQL 命名锁名与 `server/modules/financial-controls.js` 的
 * `idempotencyReplay()` 完全一致（同一 sha256 与截断规则）。M1 需要用它来
 * 证明「同一作用域的锁在第二会话上确实被重新获取」。
 */
export function out001IdempotencyLockName(operationType, documentId, key) {
  return `erp-idem-${createHash('sha256').update(`${operationType}${documentId}${key}`).digest('hex').slice(0, 48)}`;
}
