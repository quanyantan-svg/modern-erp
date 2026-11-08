#!/usr/bin/env node

// OUT-001 真实 MySQL 8 Gate 的 Root 编排器。
//
// ACK-4 能力被消费之前，Root 只做只读前置检查。它按 OUT_001_MYSQL_V1 Manifest
// 依次执行四个操作：RESET → BOOTSTRAP → RUN_OUT001_HTTP_FIXTURES → CLEANUP，
// 并在最后用**独立**的只读 postflight 核验五类数据库对象为零。
//
// 它不复用 M1-Core G07 的入口，也不复用被 `blockUnmigratedAck4Entry` 阻断的
// 旧入口；它自己的 Manifest 是 OUT_001_MYSQL_V1。
//
// Requirement : document.md §31.14.2
// Design      : docs/design/procurement-outsourcing.md §26.34.15、§26.34.15.3

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNoAck4Quarantine, consumeAck4Record, OUT_001_MYSQL_MANIFEST, OUT_001_MYSQL_MANIFEST_NAME,
} from './ack4/ack4-runtime.mjs';
import {
  collectOut001Child, ensureOut001ChildExited, OUT_001_CHILD_TIMEOUT_MS,
  parseOut001OperationOutput, parseOut001PostflightOutput,
} from './mysql-out001-process-lifecycle.mjs';
import { runOut001MySqlLifecycle } from './mysql-out001-root-lifecycle.mjs';
import { initializeOut001DescendantRegistry } from './mysql-out001-descendant-registry.mjs';
import { assertOut001MySqlStaticPreflight, OUT_001_MYSQL_SUITE_FILE } from './mysql-out001-static-preflight.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = OUT_001_MYSQL_MANIFEST_NAME;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`ACK-4 BLOCKED: ${name} is required`);
  return value;
}

function gitText(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
}

function decryptDpapi(bytes) {
  const encoded = bytes.toString('base64');
  const script = [
    'Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue;',
    `$c=[Convert]::FromBase64String('${encoded}');`,
    '$p=[Security.Cryptography.ProtectedData]::Unprotect($c,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);',
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new();[Console]::Write([Text.Encoding]::UTF8.GetString($p));',
  ].join('');
  return JSON.parse(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }));
}

async function main() {
  const runId = requiredArgument('--run-id');
  const capabilityPath = requiredArgument('--ack4-capability');
  const targetPath = resolve(requiredArgument('--target-proof'));

  const commitSha = gitText(['rev-parse', 'HEAD']);
  if (gitText(['status', '--porcelain'])) throw new Error('ACK-4 BLOCKED: the Git worktree must be clean');
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));
  assertOut001MySqlStaticPreflight({ target, environment: process.env });

  const storeRoot = resolve(process.env.LOCALAPPDATA || '', 'ModernERP', 'mysql-gate', 'ack4');
  const quarantineDir = join(storeRoot, 'quarantine');
  assertNoAck4Quarantine(quarantineDir, target);

  const expected = { commitSha, target, manifest };
  const childDir = join(storeRoot, 'children', runId);
  mkdirSync(childDir, { recursive: true });
  const children = [];
  let rootLease;

  const spawnRegistered = async (context, { mode, operation, extraEnv = {} }) => {
    const childStartedAt = new Date().toISOString();
    const leasePath = join(childDir, `${mode}-${children.length}.lease.json`);
    const child = spawn(process.execPath, [join(repoRoot, 'scripts/gates/mysql-out001-child.mjs'), '--mode', mode], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...extraEnv,
        ERP_OUT_001_ACK4_CHILD_LEASE: leasePath,
        ERP_OUT_001_ACK4_CHILD_CONSUMED_DIR: join(childDir, 'consumed'),
        ERP_OUT_001_ACK4_ROOT_PUBLIC_KEY: rootLease.childLeasePublicKey,
        ERP_OUT_001_ROOT_PID: String(process.pid),
        ERP_OUT_001_CHILD_STARTED_AT: childStartedAt,
        ERP_OUT_001_COMMIT_SHA: commitSha,
        ERP_OUT_001_TARGET_PROOF: targetPath,
        ERP_OUT_001_OPERATION: operation,
      },
    });
    const lease = context.issuePortableChild({ childPid: child.pid, childStartedAt });
    writeFileSync(leasePath, JSON.stringify(lease), { flag: 'wx', mode: 0o600 });
    const entry = {
      child, context, childStartedAt, leasePath, mode, operation, stdout: '', stderr: '',
    };
    child.stdout.on('data', (chunk) => { entry.stdout += chunk; });
    child.stderr.on('data', (chunk) => { entry.stderr += chunk; });
    children.push(entry);
    return entry;
  };

  const finishChild = async (entry) => {
    const code = await collectOut001Child(entry, {
      timeoutMs: OUT_001_CHILD_TIMEOUT_MS[entry.operation],
    });
    if (code !== 0) {
      const error = new Error(`OUT_001_MYSQL_CHILD_FAILED:${entry.mode}:${entry.operation}:exit ${code}`);
      error.code = 'OUT_001_MYSQL_CHILD_FAILED';
      error.stdout = entry.stdout;
      error.stderr = entry.stderr;
      throw error;
    }
    if (!await ensureOut001ChildExited(entry)) {
      const error = new Error(`OUT_001_MYSQL_CHILD_EXIT_UNVERIFIED:${entry.mode}:${entry.operation}`);
      error.code = 'OUT_001_MYSQL_CHILD_EXIT_UNVERIFIED';
      throw error;
    }
    entry.context.markChildExited(entry.child.pid, entry.childStartedAt);
    return entry.stdout;
  };

  const finishOperation = async (context, operation) => {
    const stdout = await finishChild(await spawnRegistered(context, { mode: 'operation', operation }));
    return parseOut001OperationOutput(stdout, operation);
  };

  const report = await runOut001MySqlLifecycle({
    consumeRoot: async () => {
      rootLease = consumeAck4Record({
        issuedPath: resolve(capabilityPath),
        consumedDir: join(storeRoot, 'consumed'),
        decrypt: decryptDpapi,
        expected: {
          runId,
          commitSha,
          manifest,
          operations: OUT_001_MYSQL_MANIFEST,
          target,
          sid: process.env.USER_SID || process.env.USERNAME,
        },
        rootPid: process.pid,
        rootStartedAt: new Date().toISOString(),
      });
      return rootLease;
    },
    expected,
    quarantineDir,
    reset: async (context) => finishOperation(context, 'RESET_SCHEMA_PRE_RUN'),
    bootstrap: async (context) => finishOperation(context, 'BOOTSTRAP_CURRENT_SCHEMA'),
    runHttpFixtures: async (context) => {
      const descendantRegistryPath = initializeOut001DescendantRegistry(childDir, runId);
      const suite = await spawnRegistered(context, {
        mode: 'suite',
        operation: 'RUN_OUT001_HTTP_FIXTURES',
        extraEnv: {
          ERP_OUT_001_DESCENDANT_REGISTRY: descendantRegistryPath,
          ERP_OUT_001_DESCENDANT_RUN_ID: runId,
        },
      });
      suite.descendantRegistry = Object.freeze({
        registryPath: descendantRegistryPath,
        childLeasePath: suite.leasePath,
        runId,
      });
      await finishChild(suite);
      return { passed: true };
    },
    stopChildren: async () => {
      for (const entry of children) {
        const exited = await ensureOut001ChildExited(entry);
        if (!exited) return false;
        entry.context.markChildExited(entry.child.pid, entry.childStartedAt);
      }
      return true;
    },
    cleanup: async (context) => finishOperation(context, 'CLEANUP_SCHEMA_POST_RUN'),
    verifyCleanup: async () => {
      // 独立核验：它不消费任何 destructive 操作，只开启新会话重新证明身份
      // 并统计五类对象。
      const postflight = spawn(process.execPath, [join(repoRoot, 'scripts/gates/mysql-out001-child.mjs'), '--mode', 'postflight'], {
        cwd: repoRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ERP_OUT_001_TARGET_PROOF: targetPath,
          ERP_OUT_001_COMMIT_SHA: commitSha,
          ERP_OUT_001_ROOT_PID: String(process.pid),
        },
      });
      let stdout = '';
      let stderr = '';
      postflight.stdout.on('data', (chunk) => { stdout += chunk; });
      postflight.stderr.on('data', (chunk) => { stderr += chunk; });
      let code;
      try {
        code = await collectOut001Child({
          child: postflight, mode: 'postflight', operation: 'POSTFLIGHT',
          get stdout() { return stdout; }, get stderr() { return stderr; },
        }, { timeoutMs: OUT_001_CHILD_TIMEOUT_MS.POSTFLIGHT });
      } catch (error) {
        return { clean: false, inventory: [error.code || 'POSTFLIGHT_UNVERIFIED'] };
      }
      if (code !== 0) return { clean: false, inventory: [`POSTFLIGHT_EXIT_${code}`] };
      const result = parseOut001PostflightOutput(stdout);
      if (!result) {
        return { clean: false, inventory: ['POSTFLIGHT_UNVERIFIED'] };
      }
      const inventory = Object.entries(result.inventory)
        .filter(([, count]) => count !== 0)
        .map(([kind, count]) => `${kind}=${count}`);
      return { clean: inventory.length === 0, inventory };
    },
  });

  process.stdout.write(`${JSON.stringify({
    ...report,
    suites: [OUT_001_MYSQL_SUITE_FILE],
    executionStatus: 'EXECUTED_NOT_ACCEPTED',
  })}\n`);
}

try {
  await main();
} catch (error) {
  if (error?.out001Lifecycle) {
    process.stdout.write(`${JSON.stringify({ ...error.out001Lifecycle, executionStatus: 'EXECUTED_NOT_ACCEPTED' })}\n`);
  }
  throw error;
}
