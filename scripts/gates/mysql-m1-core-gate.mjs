// M1-Core G07 is the only root runner currently assigned an approved ACK-4
// operation manifest. This file intentionally performs no database work until
// the one-time capability has been validated and atomically consumed.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumeAck4Record, M1_CORE_MANIFEST, assertNoAck4Quarantine } from './ack4/ack4-runtime.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = 'M1_CORE_G07_V1';
const registeredSuites = Object.freeze([
  'server/mysql-m1-core-g07.integration.js',
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
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

function gitText(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
}

const runId = argument('--run-id');
const capabilityPath = argument('--ack4-capability');
if (!runId || !capabilityPath) throw new Error('ACK-4 BLOCKED: --run-id and --ack4-capability are required');
const commitSha = gitText(['rev-parse', 'HEAD']);
if (gitText(['status', '--porcelain'])) throw new Error('ACK-4 BLOCKED: the Git worktree must be clean');

// The executor remains deliberately sealed until the production-HTTP fixture
// builder and root-managed child lifecycle have completed independent safety
// review. Refuse before reading/decrypting/renaming the one-time capability so
// a readiness probe cannot burn an approved run or strand it in CONSUMED.
throw Object.assign(new Error(`M1 G07 BLOCKED_BEFORE_CONSUMPTION: registered ${registeredSuites.join(', ')}; root execution lifecycle is not activated`), {
  code: 'M1_G07_EXECUTION_NOT_AUTHORIZED',
});

// The launcher writes this read-only result after target preflight. It contains
// no password and is bound into the approved capability. Reading it does not
// open a database from this process.
const targetPath = argument('--target-proof');
if (!targetPath) throw new Error('ACK-4 BLOCKED: --target-proof is required');
const target = JSON.parse(readFileSync(resolve(targetPath), 'utf8'));
const storeRoot = resolve(process.env.LOCALAPPDATA || '', 'ModernERP', 'mysql-gate', 'ack4');
assertNoAck4Quarantine(join(storeRoot, 'quarantine'), target);
const lease = consumeAck4Record({
  issuedPath: resolve(capabilityPath), consumedDir: join(storeRoot, 'consumed'), decrypt: decryptDpapi,
  expected: { runId, commitSha, manifest, operations: M1_CORE_MANIFEST, target, sid: process.env.USER_SID || process.env.USERNAME },
  rootPid: process.pid, rootStartedAt: new Date().toISOString(),
});

// WP7-COMBINED prepares the runner and suites but does not authorize a real
// MySQL execution. A future exact run approval will replace this readiness
// boundary with the reset/bootstrap/suite/cleanup orchestration after an
// independent security review of the implementation commit.
throw Object.assign(new Error(`M1 G07 READY_TO_EXECUTE: ACK-4 run ${lease.runId} consumed for ${registeredSuites.join(', ')}; execution remains independently disabled`), {
  code: 'M1_G07_EXECUTION_NOT_AUTHORIZED',
});
