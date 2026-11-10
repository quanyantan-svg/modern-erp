#!/usr/bin/env node

// OUT-001 真实 MySQL 8 Gate 的子进程。
//
// 子进程只能做三件事，而且每一件都必须先消费**被 Root 签名的**子 Lease：
//
//   operation —— RESET_SCHEMA_PRE_RUN / BOOTSTRAP_CURRENT_SCHEMA /
//                CLEANUP_SCHEMA_POST_RUN 三个 schema 操作；
//   suite    —— 运行固定的 OUT-001 集成测试文件（不接受任意传入脚本）；
//   postflight —— 只读核验五类数据库对象为零（不消费任何 destructive 操作）。
//
// 密码永远不落盘：子进程从环境读取 ERP_DB_PASSWORD，只用于建立会话。

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { consumePortableChildLease } from './ack4/ack4-runtime.mjs';
import { emitNodeTestTap } from './m1-core-g07-suite-reporter.mjs';
import { OUT_001_MYSQL_SUITE_FILE } from './mysql-out001-static-preflight.mjs';
import { readWindowsProcessIdentity } from './mysql-out001-descendant-registry.mjs';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`OUT_001_MYSQL_CHILD_REQUIRED:${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function waitForLease(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('OUT_001_MYSQL_CHILD_LEASE_TIMEOUT');
    await delay(20);
  }
}

async function consume(operation) {
  const leasePath = resolve(required('ERP_OUT_001_ACK4_CHILD_LEASE'));
  await waitForLease(leasePath);
  const target = JSON.parse(readFileSync(required('ERP_OUT_001_TARGET_PROOF'), 'utf8'));
  const identity = await readWindowsProcessIdentity(process.pid);
  if (!identity) throw new Error('OUT_001_MYSQL_CHILD_PROCESS_IDENTITY_UNVERIFIED');
  consumePortableChildLease({
    leasePath,
    consumedDir: resolve(required('ERP_OUT_001_ACK4_CHILD_CONSUMED_DIR')),
    rootPublicKey: required('ERP_OUT_001_ACK4_ROOT_PUBLIC_KEY'),
    expected: {
      rootPid: Number(required('ERP_OUT_001_ROOT_PID')),
      childPid: process.pid,
      childStartedAt: identity.processCreatedAt,
      commitSha: required('ERP_OUT_001_COMMIT_SHA'),
      target,
      manifest: required('ERP_OUT_001_MANIFEST'),
      operation,
    },
  });
}

async function openVerifiedAdapter() {
  const { openOut001MySqlAdapter } = await import('../../server/test-utils/mysql-out001-target.js');
  return openOut001MySqlAdapter({ targetProofPath: required('ERP_OUT_001_TARGET_PROOF') });
}

async function databaseOperation(operation) {
  const allowed = required('ERP_OUT_001_MANIFEST') === 'ACK4_RECOVERY_V1'
    ? ['CLEANUP_SCHEMA_RECOVERY']
    : ['RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'CLEANUP_SCHEMA_POST_RUN'];
  if (!allowed.includes(operation)) throw new Error('OUT_001_MYSQL_CHILD_OPERATION_OUT_OF_MANIFEST');
  await consume(operation);
  const [disposable, dbModule] = await Promise.all([
    import('../../server/test-utils/mysql-disposable-target.js'), import('../../server/db.js'),
  ]);
  const verified = await openVerifiedAdapter();
  const { config } = verified;
  if (operation === 'BOOTSTRAP_CURRENT_SCHEMA') {
    verified.db.close();
    const db = dbModule.createDatabase(config);
    try {
      process.stdout.write(`${JSON.stringify({ operation, bootstrapped: true })}\n`);
    } finally {
      db.close();
    }
    return;
  }
  const db = verified.db;
  try {
    const result = disposable.resetAuthorizedDisposableMySqlSchema(
      db, config, process.env, { requireEmpty: operation === 'RESET_SCHEMA_PRE_RUN' },
    );
    const inventory = operation === 'RESET_SCHEMA_PRE_RUN'
      ? result.inventory
      : db.prepare('SHOW FULL TABLES').all();
    process.stdout.write(`${JSON.stringify({ operation, dropped: result.dropped, inventory })}\n`);
  } finally {
    db.close();
  }
}

/**
 * 固定套件子进程。它只运行 `OUT_001_MYSQL_SUITE_FILE` —— 套件文件是常量，
 * 因此没有任何路径可以让调用方传入任意脚本绕过 Manifest。
 */
async function suiteProcess() {
  await consume('RUN_OUT001_HTTP_FIXTURES');
  const stream = run({ files: [resolve(OUT_001_MYSQL_SUITE_FILE)], isolation: 'none' });
  const { failed } = await emitNodeTestTap(stream);
  if (failed) process.exitCode = 1;
}

/**
 * 独立、只读的收尾核验。它**不**消费任何 destructive 操作：它开启一个新会话，
 * 重新证明目标身份（通过 openOut001MySqlAdapter）并统计五类对象。
 */
async function postflightProcess() {
  await waitForLease(required('ERP_OUT_001_POSTFLIGHT_READY'));
  const verified = await openVerifiedAdapter();
  try {
    const { wave10ObjectInventory } = await import('../../server/test-utils/mysql-wave10-campaign-target.js');
    const inventory = wave10ObjectInventory(verified.db);
    const identity = { database: verified.config.database, user: verified.config.user };
    process.stdout.write(`${JSON.stringify({ operation: 'POSTFLIGHT', identity, inventory })}\n`);
  } finally {
    verified.db.close();
  }
}

const mode = argument('--mode');
if (mode === 'operation') await databaseOperation(required('ERP_OUT_001_OPERATION'));
else if (mode === 'suite') await suiteProcess();
else if (mode === 'postflight') await postflightProcess();
else throw new Error('OUT_001_MYSQL_CHILD_MODE_INVALID');
