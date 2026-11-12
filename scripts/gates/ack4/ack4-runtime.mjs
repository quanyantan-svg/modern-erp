import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ACK4_VERSION = 1;
export const ACK4_CONSUME_WINDOW_MS = 15 * 60 * 1000;
export const M1_CORE_MANIFEST = Object.freeze([
  'RESET_SCHEMA_PRE_RUN',
  'BOOTSTRAP_CURRENT_SCHEMA',
  'RUN_M1_HTTP_FIXTURES',
  'CLEANUP_SCHEMA_POST_RUN',
]);
// OUT-001 (委外跨单 WIP 数量归属转移) 的独立 ACK-4 Manifest。M1_CORE_MANIFEST
// 属于 M1-Core G07，不被本 Manifest 复用或修改；OUT-001 的操作范围只包含
// 自身的一个 HTTP fixture 动作。
export const OUT_001_MYSQL_MANIFEST_NAME = 'OUT_001_MYSQL_V1';
export const OUT_001_MYSQL_MANIFEST = Object.freeze([
  'RESET_SCHEMA_PRE_RUN',
  'BOOTSTRAP_CURRENT_SCHEMA',
  'RUN_OUT001_HTTP_FIXTURES',
  'CLEANUP_SCHEMA_POST_RUN',
]);
export const ACK4_TERMINAL_STATES = Object.freeze(['FINISHED', 'FAILED', 'CLEANUP_UNVERIFIED']);
// Accounting & Analytics 域（AA-W1..AA-W7）的独立 ACK-4 Manifest。M1_CORE_MANIFEST
// 与 OUT_001_MYSQL_MANIFEST 属于各自的 campaign，既不被本 Manifest 复用，也不被
// 本 Manifest 修改；本 Manifest 的夹具操作名带 AA 前缀，使运行期证据可以唯一地归属
// 本域 campaign，不会与 M1-Core G07 或 OUT-001 的证据混淆。
export const ACCOUNTING_ANALYTICS_MYSQL_MANIFEST_NAME = 'ACCOUNTING_ANALYTICS_MYSQL_V1';
export const ACCOUNTING_ANALYTICS_MYSQL_MANIFEST = Object.freeze([
  'RESET_SCHEMA_PRE_RUN',
  'BOOTSTRAP_CURRENT_SCHEMA',
  'RUN_AA_HTTP_FIXTURES',
  'CLEANUP_SCHEMA_POST_RUN',
]);
// Finance Operations 域（RACE-01..RACE-15 真实 MySQL 并发实证）的独立 ACK-4
// Manifest。M1_CORE_MANIFEST、OUT_001_MYSQL_MANIFEST 与
// ACCOUNTING_ANALYTICS_MYSQL_MANIFEST 属于各自的 campaign，既不被本 Manifest
// 复用，也不被本 Manifest 修改；本 Manifest 的夹具操作名带 FINANCE 前缀，使
// 运行期证据可以唯一地归属本域 campaign。
export const FINANCE_MYSQL_MANIFEST_NAME = 'FINANCE_MYSQL_V1';
export const FINANCE_MYSQL_MANIFEST = Object.freeze([
  'RESET_SCHEMA_PRE_RUN',
  'BOOTSTRAP_CURRENT_SCHEMA',
  'RUN_FINANCE_RACES',
  'CLEANUP_SCHEMA_POST_RUN',
]);
export const ACK4_RECOVERY_MANIFEST = Object.freeze([
  'INSPECT_QUARANTINE',
  'CLEANUP_SCHEMA_RECOVERY',
]);
let activePortableChildLease = null;

export class Ack4BlockedError extends Error {
  constructor(message, code = 'ACK4_BLOCKED') {
    super(`ACK-4 BLOCKED: ${message}`);
    this.name = 'Ack4BlockedError';
    this.code = code;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function exactArray(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Ack4BlockedError(`${label} does not exactly match the approved manifest`, 'ACK4_OPERATION_MISMATCH');
  }
}

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Ack4BlockedError(`${label} is required`, 'ACK4_FORMAT_INVALID');
  return normalized;
}

export function normalizeAck4Target(target) {
  const normalized = {
    host: requiredText(target?.host, 'target.host'),
    port: Number(target?.port),
    database: requiredText(target?.database, 'target.database'),
    user: requiredText(target?.user, 'target.user'),
    selectedDatabase: requiredText(target?.selectedDatabase, 'target.selectedDatabase'),
    currentUser: requiredText(target?.currentUser, 'target.currentUser'),
    serverUuid: requiredText(target?.serverUuid, 'target.serverUuid'),
    grantsSha256: requiredText(target?.grantsSha256, 'target.grantsSha256').toLowerCase(),
  };
  if (!Number.isSafeInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) {
    throw new Ack4BlockedError('target.port is invalid', 'ACK4_FORMAT_INVALID');
  }
  if (!/^[0-9a-f]{64}$/.test(normalized.grantsSha256)) {
    throw new Ack4BlockedError('target.grantsSha256 is invalid', 'ACK4_FORMAT_INVALID');
  }
  if (normalized.selectedDatabase !== normalized.database) {
    throw new Ack4BlockedError('SELECT DATABASE() does not match the approved database', 'ACK4_TARGET_MISMATCH');
  }
  return Object.freeze(normalized);
}

export function validateAck4Approval(record, expected, nowMs = Date.now()) {
  if (!record || record.version !== ACK4_VERSION) throw new Ack4BlockedError('capability format/version is invalid', 'ACK4_FORMAT_INVALID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(record.runId || ''))) {
    throw new Ack4BlockedError('runId must be UUIDv4', 'ACK4_FORMAT_INVALID');
  }
  requiredText(record.approval?.subject, 'approval.subject');
  requiredText(record.approval?.channel, 'approval.channel');
  requiredText(record.approval?.reference, 'approval.reference');
  requiredText(record.approval?.summary, 'approval.summary');
  if (!/^[0-9a-f]{40}$/i.test(String(record.commitSha || ''))) throw new Ack4BlockedError('full commit SHA is required', 'ACK4_SHA_MISMATCH');
  const issuedAt = Date.parse(record.issuedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt - issuedAt > ACK4_CONSUME_WINDOW_MS || expiresAt <= issuedAt) {
    throw new Ack4BlockedError('issuedAt/expiresAt window is invalid', 'ACK4_FORMAT_INVALID');
  }
  if (nowMs < issuedAt || nowMs > expiresAt) throw new Ack4BlockedError('capability is not in its consumption window', 'ACK4_EXPIRED');
  if (record.runId !== expected.runId) throw new Ack4BlockedError('runId mismatch', 'ACK4_RUN_MISMATCH');
  if (record.commitSha !== expected.commitSha) throw new Ack4BlockedError('commit SHA mismatch', 'ACK4_SHA_MISMATCH');
  if (record.manifest !== expected.manifest) throw new Ack4BlockedError('runner manifest mismatch', 'ACK4_MANIFEST_MISMATCH');
  exactArray(record.operations, expected.operations, 'operations');
  const approvedTarget = normalizeAck4Target(record.target);
  const actualTarget = normalizeAck4Target(expected.target);
  if (digest(approvedTarget) !== digest(actualTarget)) throw new Ack4BlockedError('target identity drifted', 'ACK4_TARGET_MISMATCH');
  return Object.freeze({ ...record, target: approvedTarget, operations: Object.freeze([...record.operations]) });
}

function lockDirectory(storeDir, runId) {
  const lock = join(storeDir, `${runId}.consume.lock`);
  try { mkdirSync(lock); }
  catch { throw new Ack4BlockedError('another consumer owns the run mutex', 'ACK4_ALREADY_CONSUMED'); }
  return () => { try { rmSync(lock, { recursive: true, force: true }); } catch {} };
}

export function consumeAck4Record({ issuedPath, consumedDir, expected, decrypt, nowMs = Date.now(), rootPid = process.pid, rootStartedAt }) {
  const source = resolve(issuedPath);
  mkdirSync(consumedDir, { recursive: true });
  const release = lockDirectory(dirname(source), expected.runId);
  try {
    if (!existsSync(source)) throw new Ack4BlockedError('issued capability is missing or already consumed', 'ACK4_ALREADY_CONSUMED');
    const encrypted = readFileSync(source);
    const record = validateAck4Approval(decrypt(encrypted), expected, nowMs);
    const consumedPath = join(consumedDir, `${record.runId}.consumed`);
    if (existsSync(consumedPath)) throw new Ack4BlockedError('capability was already consumed', 'ACK4_ALREADY_CONSUMED');
    renameSync(source, consumedPath);
    const lease = {
      version: ACK4_VERSION, state: 'CONSUMED', runId: record.runId, commitSha: record.commitSha,
      target: record.target, operations: record.operations, manifest: record.manifest,
      approvalReference: record.approval.reference, sid: requiredText(expected.sid, 'sid'),
      rootPid, rootStartedAt: requiredText(rootStartedAt, 'rootStartedAt'), nonce: randomBytes(32).toString('hex'),
      consumedAt: new Date(nowMs).toISOString(), consumedPath,
    };
    const childKeys = generateKeyPairSync('ed25519');
    lease.childLeasePrivateKey = childKeys.privateKey;
    lease.childLeasePublicKey = childKeys.publicKey.export({ type: 'spki', format: 'pem' });
    lease.completedOperations = [];
    return lease;
  } finally { release(); }
}

export function issueChildLease(rootLease, { childPid, childStartedAt, operations }) {
  assertActiveRootLease(rootLease, { commitSha: rootLease.commitSha, target: rootLease.target, manifest: rootLease.manifest });
  for (const operation of operations) {
    if (!rootLease.operations.includes(operation)) throw new Ack4BlockedError('child requested an operation outside the root lease', 'ACK4_CHILD_SCOPE_ESCALATION');
  }
  return {
    version: ACK4_VERSION, kind: 'CHILD', childLeaseId: randomUUID(), runId: rootLease.runId,
    rootPid: rootLease.rootPid, rootStartedAt: rootLease.rootStartedAt,
    childPid, childStartedAt: requiredText(childStartedAt, 'childStartedAt'),
    commitSha: rootLease.commitSha, targetDigest: digest(rootLease.target), manifest: rootLease.manifest,
    operations: Object.freeze([...operations]), nonceDigest: digest(rootLease.nonce), consumed: false,
  };
}

export function assertActiveRootLease(lease, expected) {
  if (!lease || lease.state !== 'CONSUMED') throw new Ack4BlockedError('active root lease is required', 'ACK4_ROOT_LEASE_REQUIRED');
  if (lease.commitSha !== expected.commitSha || lease.manifest !== expected.manifest) throw new Ack4BlockedError('root SHA/manifest drifted', 'ACK4_ROOT_DRIFT');
  if (digest(lease.target) !== digest(normalizeAck4Target(expected.target))) throw new Ack4BlockedError('root target drifted', 'ACK4_TARGET_MISMATCH');
  return lease;
}

export function consumeChildLease(childLease, { rootLease, childPid, childStartedAt, operation, commitSha, target, manifest }) {
  assertActiveRootLease(rootLease, { commitSha, target, manifest });
  if (!childLease || childLease.kind !== 'CHILD' || childLease.consumed) throw new Ack4BlockedError('child lease missing or replayed', 'ACK4_CHILD_REPLAY');
  if (childLease.runId !== rootLease.runId || childLease.rootPid !== rootLease.rootPid || childLease.rootStartedAt !== rootLease.rootStartedAt) {
    throw new Ack4BlockedError('child is outside the registered root process tree', 'ACK4_PROCESS_TREE_MISMATCH');
  }
  if (childLease.childPid !== childPid || childLease.childStartedAt !== childStartedAt) throw new Ack4BlockedError('child PID/start time drifted', 'ACK4_PROCESS_TREE_MISMATCH');
  if (!childLease.operations.includes(operation)) throw new Ack4BlockedError('child operation is outside its subset', 'ACK4_CHILD_SCOPE_ESCALATION');
  if (childLease.commitSha !== commitSha || childLease.targetDigest !== digest(normalizeAck4Target(target))) throw new Ack4BlockedError('child SHA/target drifted', 'ACK4_CHILD_DRIFT');
  childLease.consumed = true;
  return childLease;
}

function signPortableChildPayload(payload, privateKey) {
  if (!privateKey) throw new Ack4BlockedError('root child-signing key is required', 'ACK4_CHILD_SIGNING_KEY_REQUIRED');
  return sign(null, Buffer.from(JSON.stringify(canonical(payload))), privateKey).toString('base64');
}

export function issuePortableChildLease(rootLease, { childPid, childStartedAt, operation, expiresAt = Date.now() + ACK4_CONSUME_WINDOW_MS }) {
  assertActiveRootLease(rootLease, { commitSha: rootLease.commitSha, target: rootLease.target, manifest: rootLease.manifest });
  if (!rootLease.operations.includes(operation)) throw new Ack4BlockedError('child requested an operation outside the root lease', 'ACK4_CHILD_SCOPE_ESCALATION');
  const payload = {
    version: ACK4_VERSION, kind: 'PORTABLE_CHILD', childLeaseId: randomUUID(), runId: rootLease.runId,
    rootPid: rootLease.rootPid, childPid, childStartedAt: requiredText(childStartedAt, 'childStartedAt'),
    commitSha: rootLease.commitSha, target: rootLease.target, manifest: rootLease.manifest, operation,
    issuedAt: Date.now(), expiresAt,
  };
  return Object.freeze({ ...payload, signature: signPortableChildPayload(payload, rootLease.childLeasePrivateKey) });
}

export function consumePortableChildLease({ leasePath, consumedDir, rootPublicKey, expected, nowMs = Date.now() }) {
  const source = resolve(leasePath);
  mkdirSync(consumedDir, { recursive: true });
  const record = JSON.parse(readFileSync(source, 'utf8'));
  const { signature, ...payload } = record;
  if (!rootPublicKey || !verify(null, Buffer.from(JSON.stringify(canonical(payload))), rootPublicKey, Buffer.from(String(signature || ''), 'base64'))) {
    throw new Ack4BlockedError('portable child signature is invalid', 'ACK4_CHILD_SIGNATURE_INVALID');
  }
  if (record.kind !== 'PORTABLE_CHILD' || record.version !== ACK4_VERSION) throw new Ack4BlockedError('portable child format is invalid', 'ACK4_FORMAT_INVALID');
  if (nowMs < record.issuedAt || nowMs > record.expiresAt || record.expiresAt - record.issuedAt > ACK4_CONSUME_WINDOW_MS) throw new Ack4BlockedError('portable child lease expired', 'ACK4_EXPIRED');
  if (record.rootPid !== expected.rootPid || record.childPid !== expected.childPid || record.childStartedAt !== expected.childStartedAt) throw new Ack4BlockedError('portable child process tree drifted', 'ACK4_PROCESS_TREE_MISMATCH');
  if (record.commitSha !== expected.commitSha || record.manifest !== expected.manifest || record.operation !== expected.operation) throw new Ack4BlockedError('portable child scope drifted', 'ACK4_CHILD_DRIFT');
  if (digest(normalizeAck4Target(record.target)) !== digest(normalizeAck4Target(expected.target))) throw new Ack4BlockedError('portable child target drifted', 'ACK4_TARGET_MISMATCH');
  const consumedPath = join(consumedDir, `${record.childLeaseId}.consumed.json`);
  try { renameSync(source, consumedPath); }
  catch { throw new Ack4BlockedError('portable child lease is missing or already consumed', 'ACK4_CHILD_REPLAY'); }
  activePortableChildLease = Object.freeze({ ...record, consumedPath });
  return activePortableChildLease;
}

export function beginAck4RootOperation(rootLease, operation, expected) {
  assertActiveRootLease(rootLease, expected);
  const index = rootLease.operations.indexOf(operation);
  if (index < 0) throw new Ack4BlockedError('root operation is outside the approved manifest', 'ACK4_ROOT_SCOPE_ESCALATION');
  if (rootLease.completedOperations.includes(operation)) throw new Ack4BlockedError('root operation cannot be reused', 'ACK4_OPERATION_REPLAY');
  const cleanup = operation === 'CLEANUP_SCHEMA_POST_RUN' || operation === 'CLEANUP_SCHEMA_RECOVERY';
  if (cleanup) {
    // A failed bootstrap or suite may skip later work, but cleanup must never
    // be the first action of a newly consumed capability.
    const prerequisite = operation === 'CLEANUP_SCHEMA_RECOVERY'
      ? 'INSPECT_QUARANTINE' : 'RESET_SCHEMA_PRE_RUN';
    if (!rootLease.completedOperations.includes(prerequisite)) {
      throw new Ack4BlockedError('cleanup prerequisite was not started', 'ACK4_OPERATION_ORDER_MISMATCH');
    }
  } else {
    const firstUnfinished = rootLease.operations.find((item) => !rootLease.completedOperations.includes(item));
    if (firstUnfinished !== operation) throw new Ack4BlockedError('root operation order drifted', 'ACK4_OPERATION_ORDER_MISMATCH');
  }
  rootLease.completedOperations.push(operation);
  return operation;
}

export function assertActivePortableChildOperation(operations) {
  const allowed = Array.isArray(operations) ? operations : [operations];
  if (!activePortableChildLease || activePortableChildLease.childPid !== process.pid) {
    throw new Ack4BlockedError('registered portable child lease is required before MySQL test writes', 'ACK4_CHILD_LEASE_REQUIRED');
  }
  if (!allowed.includes(activePortableChildLease.operation)) {
    throw new Ack4BlockedError('portable child operation is outside the primitive scope', 'ACK4_CHILD_SCOPE_ESCALATION');
  }
  return activePortableChildLease;
}

export function finalizeAck4Run(rootLease, { testsPassed, cleanupProven, childrenExited, quarantineDir, inventory = [], children = [] }) {
  if (rootLease.state !== 'CONSUMED') throw new Ack4BlockedError('only a consumed run can finish', 'ACK4_STATE_INVALID');
  const state = cleanupProven && childrenExited ? (testsPassed ? 'FINISHED' : 'FAILED') : 'CLEANUP_UNVERIFIED';
  rootLease.state = state;
  rootLease.finishedAt = new Date().toISOString();
  if (state === 'CLEANUP_UNVERIFIED') {
    mkdirSync(quarantineDir, { recursive: true });
    writeFileSync(join(quarantineDir, `${digest(rootLease.target)}.json`), JSON.stringify({
      version: ACK4_VERSION, runId: rootLease.runId, state, target: rootLease.target,
      commitSha: rootLease.commitSha, manifest: rootLease.manifest, inventory,
      rootPid: rootLease.rootPid, rootStartedAt: rootLease.rootStartedAt,
      children: children.map(({ childPid, childStartedAt, operation }) => ({ childPid, childStartedAt, operation })),
    }, null, 2), { flag: 'wx', mode: 0o600 });
  }
  return state;
}

export function assertNoAck4Quarantine(quarantineDir, target) {
  if (existsSync(ack4QuarantineMarkerPath(quarantineDir, target))) {
    throw new Ack4BlockedError('target is quarantined; a new recovery approval is required', 'ACK4_TARGET_QUARANTINED');
  }
}

export function ack4QuarantineMarkerPath(quarantineDir, target) {
  return join(quarantineDir, `${digest(normalizeAck4Target(target))}.json`);
}

export function recoverAck4Quarantine(recoveryLease, { quarantineDir, target, cleanupProven, childrenExited }) {
  assertActiveRootLease(recoveryLease, {
    commitSha: recoveryLease.commitSha, target, manifest: 'ACK4_RECOVERY_V1',
  });
  exactArray(recoveryLease.operations, ACK4_RECOVERY_MANIFEST, 'recovery operations');
  const markerPath = join(quarantineDir, `${digest(normalizeAck4Target(target))}.json`);
  if (!existsSync(markerPath)) throw new Ack4BlockedError('quarantine marker is missing', 'ACK4_QUARANTINE_MISSING');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.runId === recoveryLease.runId) throw new Ack4BlockedError('recovery requires a new runId', 'ACK4_RECOVERY_REPLAY');
  exactArray(recoveryLease.completedOperations, ACK4_RECOVERY_MANIFEST, 'completed recovery operations');
  if (!cleanupProven || !childrenExited) throw new Ack4BlockedError('recovery cleanup is unverified', 'ACK4_RECOVERY_UNVERIFIED');
  rmSync(markerPath);
  recoveryLease.state = 'FINISHED';
  recoveryLease.finishedAt = new Date().toISOString();
  return Object.freeze({ recoveredRunId: marker.runId, recoveryRunId: recoveryLease.runId, state: 'FINISHED' });
}

export function blockUnmigratedAck4Entry(entry) {
  throw new Ack4BlockedError(`${entry} has no independently approved ACK-4 manifest and remains disabled`, 'ACK4_ENTRY_NOT_MIGRATED');
}

export const _testInternals = Object.freeze({ canonical, digest, exactArray, lockDirectory });
