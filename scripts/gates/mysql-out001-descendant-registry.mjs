import { execFile } from 'node:child_process';
import {
  closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const OUT_001_DESCENDANT_PURPOSE = 'OUT001_HTTP_APP';
const REGISTRY_VERSION = 1;
// 每一个独立 HTTP 应用进程都必须登记：M1b 的被测应用 1 个，M2 的两个并发
// 应用 2 个，M3 的 victim 应用 1 个。少一条即证明有进程没有被登记。
export const OUT_001_EXPECTED_HTTP_APP_COUNT = 4;
const MAX_REGISTRY_BYTES = 64 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertRunId(runId) {
  if (!UUID_V4.test(String(runId || ''))) throw new Error('OUT_001_DESCENDANT_RUN_ID_INVALID');
}

export function out001DescendantRegistryPath(childDir, runId) {
  assertRunId(runId);
  return resolve(childDir, 'descendants', `${runId}.jsonl`);
}

export function initializeOut001DescendantRegistry(childDir, runId) {
  const registryPath = out001DescendantRegistryPath(childDir, runId);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, '', { flag: 'wx', mode: 0o600 });
  return registryPath;
}

function assertControlledRegistryPath({ registryPath, childLeasePath, runId }) {
  assertRunId(runId);
  const expected = out001DescendantRegistryPath(dirname(resolve(childLeasePath)), runId);
  if (resolve(registryPath) !== expected) throw new Error('OUT_001_DESCENDANT_REGISTRY_PATH_REFUSED');
  const pathState = lstatSync(expected);
  if (!pathState.isFile() || pathState.isSymbolicLink()) {
    throw new Error('OUT_001_DESCENDANT_REGISTRY_NOT_REGULAR_FILE');
  }
  return expected;
}

function execFileResult(file, args) {
  return new Promise((resolveResult) => {
    let exitCode = null;
    const child = execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolveResult({ error, exitCode, stdout, stderr });
    });
    child.once('exit', (code) => { exitCode = code; });
  });
}

export async function readWindowsProcessIdentity(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('OUT_001_DESCENDANT_PID_INVALID');
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    "if($null -eq $p){[Console]::Write('null');exit 0}",
    "$r=[ordered]@{pid=[int]$p.ProcessId;processCreatedAt=$p.CreationDate.ToUniversalTime().ToString('o')}",
    '[Console]::Write(($r|ConvertTo-Json -Compress))',
  ].join(';');
  const result = await execFileResult('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ]);
  if (result.error || result.exitCode !== 0) throw new Error('OUT_001_DESCENDANT_PROCESS_QUERY_FAILED');
  let identity;
  try { identity = JSON.parse(String(result.stdout || '').trim()); } catch {
    throw new Error('OUT_001_DESCENDANT_PROCESS_QUERY_INVALID');
  }
  if (identity === null) return null;
  if (identity?.pid !== pid || typeof identity?.processCreatedAt !== 'string'
      || !Number.isFinite(Date.parse(identity.processCreatedAt))) {
    throw new Error('OUT_001_DESCENDANT_PROCESS_IDENTITY_INVALID');
  }
  return Object.freeze(identity);
}

export async function appendOut001DescendantRegistration({
  registryPath, childLeasePath, runId, pid, purpose = OUT_001_DESCENDANT_PURPOSE,
}) {
  if (purpose !== OUT_001_DESCENDANT_PURPOSE) throw new Error('OUT_001_DESCENDANT_PURPOSE_INVALID');
  const controlledPath = assertControlledRegistryPath({ registryPath, childLeasePath, runId });
  const identity = await readWindowsProcessIdentity(pid);
  if (!identity) throw new Error('OUT_001_DESCENDANT_PROCESS_NOT_RUNNING');
  const record = Object.freeze({
    version: REGISTRY_VERSION,
    runId,
    purpose,
    pid,
    processCreatedAt: identity.processCreatedAt,
    registeredAt: new Date().toISOString(),
  });
  const handle = openSync(controlledPath, 'r+');
  try {
    const state = fstatSync(handle);
    if (!state.isFile() || state.size > MAX_REGISTRY_BYTES) {
      throw new Error('OUT_001_DESCENDANT_REGISTRY_INVALID');
    }
    writeSync(handle, `${JSON.stringify(record)}\n`, state.size, 'utf8');
  } finally {
    closeSync(handle);
  }
  return record;
}

function parseRegistry({ registryPath, childLeasePath, runId }) {
  const controlledPath = assertControlledRegistryPath({ registryPath, childLeasePath, runId });
  const state = lstatSync(controlledPath);
  if (state.size <= 0 || state.size > MAX_REGISTRY_BYTES) throw new Error('OUT_001_DESCENDANT_REGISTRY_INVALID');
  const lines = readFileSync(controlledPath, 'utf8').trim().split(/\r?\n/);
  if (lines.length !== OUT_001_EXPECTED_HTTP_APP_COUNT) throw new Error('OUT_001_DESCENDANT_COUNT_INVALID');
  const records = lines.map((line) => JSON.parse(line));
  const pids = new Set();
  for (const record of records) {
    if (record?.version !== REGISTRY_VERSION || record?.runId !== runId
        || record?.purpose !== OUT_001_DESCENDANT_PURPOSE
        || !Number.isSafeInteger(record?.pid) || record.pid <= 0
        || typeof record?.processCreatedAt !== 'string' || !Number.isFinite(Date.parse(record.processCreatedAt))
        || typeof record?.registeredAt !== 'string' || !Number.isFinite(Date.parse(record.registeredAt))
        || pids.has(record.pid)) {
      throw new Error('OUT_001_DESCENDANT_RECORD_INVALID');
    }
    pids.add(record.pid);
  }
  return records;
}

export async function verifyOut001DescendantsExited(evidence) {
  try {
    const records = parseRegistry(evidence);
    for (const record of records) {
      const current = await readWindowsProcessIdentity(record.pid);
      if (current && current.processCreatedAt === record.processCreatedAt) return false;
    }
    return true;
  } catch {
    return false;
  }
}
