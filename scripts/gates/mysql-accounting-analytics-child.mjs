#!/usr/bin/env node

// Accounting & Analytics 域真实 MySQL campaign 的子进程。
//
// 形态与 `m1-core-g07-child.mjs` 一致，但使用本域自己的 ACK-4 Manifest
// (`ACCOUNTING_ANALYTICS_MYSQL_V1`) 与夹具操作名 (`RUN_AA_HTTP_FIXTURES`)，
// 并保持独立实现，避免改动采购与委外域已冻结的 M1-Core G07 证据链。

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { consumePortableChildLease } from './ack4/ack4-runtime.mjs';
import { emitNodeTestTap } from './m1-core-g07-suite-reporter.mjs';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`AA_MYSQL_CHILD_REQUIRED:${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function waitForLease(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('AA_MYSQL_CHILD_LEASE_TIMEOUT');
    await delay(20);
  }
}

async function consume(operation) {
  const leasePath = resolve(required('ERP_AA_MYSQL_ACK4_CHILD_LEASE'));
  await waitForLease(leasePath);
  const target = JSON.parse(readFileSync(required('ERP_AA_MYSQL_TARGET_PROOF'), 'utf8'));
  consumePortableChildLease({
    leasePath, consumedDir: resolve(required('ERP_AA_MYSQL_ACK4_CHILD_CONSUMED_DIR')),
    rootPublicKey: required('ERP_AA_MYSQL_ACK4_ROOT_PUBLIC_KEY'),
    expected: {
      rootPid: Number(required('ERP_AA_MYSQL_ROOT_PID')), childPid: process.pid,
      childStartedAt: required('ERP_AA_MYSQL_CHILD_STARTED_AT'),
      commitSha: required('ERP_AA_MYSQL_COMMIT_SHA'), target,
      manifest: 'ACCOUNTING_ANALYTICS_MYSQL_V1', operation,
    },
  });
}

async function openVerifiedAdapter() {
  const { openM1CoreG07ExistingAdapter } = await import('../../server/test-utils/m1-core-g07-existing-adapter.js');
  return openM1CoreG07ExistingAdapter({ targetProofPath: required('ERP_AA_MYSQL_TARGET_PROOF') });
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
    // disposable MySQL target. This is the step that proves the Accounting &
    // Analytics domain's 45 new tables and their constraints are accepted by a
    // real MySQL 8 server.
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

async function appProcess() {
  await consume('RUN_AA_HTTP_FIXTURES');
  // Boot the HTTP handler directly against the already-bootstrapped schema.
  // The default boot entrypoint calls createDatabase(), which re-runs the full
  // MySQL reconciliation on every boot — DDL that exceeds the
  // RUN_AA_HTTP_FIXTURES operation scope. BOOTSTRAP_CURRENT_SCHEMA has already
  // built the full current schema, so the app only needs a read/write adapter.
  const verified = await openVerifiedAdapter();
  const [{ createServer }, { createApp }, { createStructuredLogger }] = await Promise.all([
    import('node:http'), import('../../server/app.js'), import('../../server/lib/logger.js'),
  ]);
  const port = Number(required('PORT'));
  const logger = createStructuredLogger();
  const server = createServer(createApp(verified.db, { distDir: resolve('dist'), logger }));
  server.listen(port, '127.0.0.1', () => {
    logger.info('aa_mysql_app_started', { port, dialect: verified.db.dialect });
  });
  const shutdown = () => {
    server.close(() => { verified.db.close(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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

async function suiteProcess() {
  const leasePath = resolve(required('ERP_AA_MYSQL_ACK4_CHILD_LEASE'));
  await waitForLease(leasePath);
  const stream = run({ files: [resolve('server/mysql-accounting-analytics.integration.js')], isolation: 'none' });
  const { failed } = await emitNodeTestTap(stream);
  if (failed) process.exitCode = 1;
}

const mode = argument('--mode');
if (mode === 'operation') await databaseOperation(required('ERP_AA_MYSQL_OPERATION'));
else if (mode === 'app') await appProcess();
else if (mode === 'suite') await suiteProcess();
else if (mode === 'postflight') await postflightProcess();
else throw new Error('AA_MYSQL_CHILD_MODE_INVALID');
