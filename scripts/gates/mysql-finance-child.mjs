#!/usr/bin/env node

// Finance Operations 域真实 MySQL campaign 的子进程。
//
// 形态与 `mysql-accounting-analytics-child.mjs` 一致，但使用本域自己的 ACK-4
// Manifest (`FINANCE_MYSQL_V1`) 与夹具操作名 (`RUN_FINANCE_RACES`)，并保持独立
// 实现，避免改动采购与委外域已冻结的 M1-Core G07 证据链与会计与分析域已签发的
// 证据链。
//
// 需求：docs/requirements/finance-operations.md §33.39（15 个 Finance race 必须在
// 真实 MySQL 上实证；SQLite-only evidence 不计入）。

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { consumePortableChildLease } from './ack4/ack4-runtime.mjs';
import { emitNodeTestTap } from './m1-core-g07-suite-reporter.mjs';

const RACE_SUITE = 'server/mysql-finance-operations-concurrency.integration.js';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`FINANCE_MYSQL_CHILD_REQUIRED:${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function waitForLease(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('FINANCE_MYSQL_CHILD_LEASE_TIMEOUT');
    await delay(20);
  }
}

async function consume(operation) {
  const leasePath = resolve(required('ERP_FINANCE_MYSQL_ACK4_CHILD_LEASE'));
  await waitForLease(leasePath);
  const target = JSON.parse(readFileSync(required('ERP_FINANCE_MYSQL_TARGET_PROOF'), 'utf8'));
  consumePortableChildLease({
    leasePath, consumedDir: resolve(required('ERP_FINANCE_MYSQL_ACK4_CHILD_CONSUMED_DIR')),
    rootPublicKey: required('ERP_FINANCE_MYSQL_ACK4_ROOT_PUBLIC_KEY'),
    expected: {
      rootPid: Number(required('ERP_FINANCE_MYSQL_ROOT_PID')), childPid: process.pid,
      childStartedAt: required('ERP_FINANCE_MYSQL_CHILD_STARTED_AT'),
      commitSha: required('ERP_FINANCE_MYSQL_COMMIT_SHA'), target,
      manifest: 'FINANCE_MYSQL_V1', operation,
    },
  });
}

async function openVerifiedAdapter() {
  const { openM1CoreG07ExistingAdapter } = await import('../../server/test-utils/m1-core-g07-existing-adapter.js');
  return openM1CoreG07ExistingAdapter({ targetProofPath: required('ERP_FINANCE_MYSQL_TARGET_PROOF') });
}

async function databaseOperation(operation) {
  await consume(operation);
  const [disposable, dbModule] = await Promise.all([
    import('../../server/test-utils/mysql-disposable-target.js'), import('../../server/db.js'),
  ]);
  const verified = await openVerifiedAdapter();
  const { config } = verified;
  if (operation === 'BOOTSTRAP_CURRENT_SCHEMA') {
    verified.db.close();
    // createDatabase(config) runs the full current migration set against the
    // disposable MySQL target. This is the step that proves the Finance
    // Operations domain's schema is accepted by a real MySQL 8 server.
    const db = dbModule.createDatabase(config);
    try { process.stdout.write(`${JSON.stringify({ operation, bootstrapped: true })}\n`); }
    finally { db.close(); }
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
  } finally { db.close(); }
}

/**
 * The 15 Finance race scenarios. They are DB-level concurrency cases: the
 * suite owns its own connections and must never fall back to SQLite.
 */
async function raceProcess() {
  await consume('RUN_FINANCE_RACES');
  // The suite must run INSIDE this process: the ACK-4 portable child lease
  // is bound to this pid, and the suite's MySQL writes are only permitted
  // under that lease.
  process.env.ERP_FINANCE_MYSQL_GATE = '1';
  const stream = run({ files: [resolve(RACE_SUITE)], isolation: 'none' });
  const { failed } = await emitNodeTestTap(stream);
  if (failed) process.exitCode = 1;
}

/**
 * Independent, read-only postflight. It does NOT consume any destructive
 * operation: it opens a fresh session, re-proves the exact target identity
 * and counts the five object categories. The root uses this to prove the
 * schema is empty before it can mark the run FINISHED.
 */
async function postflightProcess() {
  const verified = await openVerifiedAdapter();
  try {
    const { wave10ObjectInventory } = await import('../../server/test-utils/mysql-wave10-campaign-target.js');
    const inventory = wave10ObjectInventory(verified.db);
    const identity = { database: verified.config.database, user: verified.config.user };
    process.stdout.write(`${JSON.stringify({ operation: 'POSTFLIGHT', identity, inventory })}\n`);
  } finally { verified.db.close(); }
}

const mode = argument('--mode');
if (mode === 'operation') await databaseOperation(required('ERP_FINANCE_MYSQL_OPERATION'));
else if (mode === 'races') await raceProcess();
else if (mode === 'postflight') await postflightProcess();
else throw new Error('FINANCE_MYSQL_CHILD_MODE_INVALID');
