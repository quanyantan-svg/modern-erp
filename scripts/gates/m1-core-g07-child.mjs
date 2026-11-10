#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { consumePortableChildLease } from './ack4/ack4-runtime.mjs';
import { emitNodeTestTap } from './m1-core-g07-suite-reporter.mjs';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`M1_G07_CHILD_REQUIRED:${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function waitForLease(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('M1_G07_CHILD_LEASE_TIMEOUT');
    await delay(20);
  }
}

async function consume(operation) {
  const leasePath = resolve(required('ERP_M1_G07_ACK4_CHILD_LEASE'));
  await waitForLease(leasePath);
  const target = JSON.parse(readFileSync(required('ERP_M1_G07_TARGET_PROOF'), 'utf8'));
  consumePortableChildLease({
    leasePath, consumedDir: resolve(required('ERP_M1_G07_ACK4_CHILD_CONSUMED_DIR')),
    rootPublicKey: required('ERP_M1_G07_ACK4_ROOT_PUBLIC_KEY'),
    expected: {
      rootPid: Number(required('ERP_M1_G07_ROOT_PID')), childPid: process.pid,
      childStartedAt: required('ERP_M1_G07_CHILD_STARTED_AT'),
      commitSha: required('ERP_M1_G07_COMMIT_SHA'), target,
      manifest: 'M1_CORE_G07_V1', operation,
    },
  });
}

async function openVerifiedAdapter() {
  const { openM1CoreG07ExistingAdapter } = await import('../../server/test-utils/m1-core-g07-existing-adapter.js');
  return openM1CoreG07ExistingAdapter({ targetProofPath: required('ERP_M1_G07_TARGET_PROOF') });
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
    const db = dbModule.createDatabase(config);
    try { process.stdout.write(`${JSON.stringify({ operation, bootstrapped: true })}\n`); }
    finally { db.close(); }
    return;
  }
  const db = verified.db;
  try {
    // The shared disposable-target primitive forbids a RESET lease from taking
    // the DROP path: RESET is EMPTY_ONLY and proves that all five object
    // classes are empty. Only the CLEANUP lease may drop. The M1-Core child
    // must therefore pass the same `requireEmpty` flag the OUT-001 child
    // passes; without it the tightened primitive refuses every RESET.
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
  await consume('RUN_M1_HTTP_FIXTURES');
  // Boot the HTTP handler directly against the already-bootstrapped schema.
  // The default boot entrypoint calls createDatabase(), which re-runs the full
  // MySQL migration/view reconciliation (ensureFinanceOpenItemEffectsView +
  // migrateSalesCustomerDomain + bootstrap) on every boot — DDL that exceeds
  // the RUN_M1_HTTP_FIXTURES operation scope. The BOOTSTRAP_CURRENT_SCHEMA
  // operation has already built the full current schema, so the app only needs
  // a read/write adapter with no migration.
  const verified = await openVerifiedAdapter();
  const [{ createServer }, { createApp }, { createStructuredLogger }] = await Promise.all([
    import('node:http'), import('../../server/app.js'), import('../../server/lib/logger.js'),
  ]);
  const port = Number(required('PORT'));
  const logger = createStructuredLogger();
  const server = createServer(createApp(verified.db, { distDir: resolve('dist'), logger }));
  server.listen(port, '127.0.0.1', () => {
    logger.info('m1_g07_app_started', { port, dialect: verified.db.dialect });
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
 * (via openVerifiedAdapter) and counts the five object categories. The root
 * uses this to prove the schema is empty before it can mark the run FINISHED.
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
  const leasePath = resolve(required('ERP_M1_G07_ACK4_CHILD_LEASE'));
  await waitForLease(leasePath);
  const stream = run({ files: [resolve('server/mysql-m1-core-g07.integration.js')], isolation: 'none' });
  const { failed } = await emitNodeTestTap(stream);
  if (failed) process.exitCode = 1;
}

const mode = argument('--mode');
if (mode === 'operation') await databaseOperation(required('ERP_M1_G07_OPERATION'));
else if (mode === 'app') await appProcess();
else if (mode === 'suite') await suiteProcess();
else if (mode === 'postflight') await postflightProcess();
else throw new Error('M1_G07_CHILD_MODE_INVALID');
