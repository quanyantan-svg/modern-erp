// PL-RI-01 —— MySQL 灾备原语的离线合同回归。
//
// 覆盖 Requirement §36.16.2 与 Design §32.16.3 的可离线判定条款：
//   - 配置只来自环境变量，缺项即 fail closed；
//   - 凭据 / 连接串 / 对象存储密钥不得进入输出；
//   - 恢复目标授权默认 fail closed，生产恢复需窗口 + 审批 + 精确身份；
//   - 保留策略只删除「已过保留期且存在已验证异机副本」的对象；
//   - RPO / RTO 计时判定；
//   - object key 不可变且含 commit 与 run id；
//   - 备份 / 恢复状态机顺序固定。
//
// 证据层级：纯离线单元证据。**没有**连接 MySQL、对象存储或任何外部服务，
// 也不构成真实恢复演练证据。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_STATES, RESTORE_STATES, authorizeRestoreTarget, buildManifest, buildObjectKey,
  computeRetentionCandidates, evaluateRecoveryTiming, objectStoreAddressing, redactEndpoint,
  redactSecrets, validateBackupConfig,
} from './lib/mysql-dr.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const COMPLETE_ENV = Object.freeze({
  ERP_DB_BACKEND: 'mysql',
  ERP_DB_HOST: 'db.internal',
  ERP_DB_PORT: '3306',
  ERP_DB_NAME: 'modern_erp',
  ERP_DB_USER: 'erp_backup',
  ERP_DB_PASSWORD: 'super-secret',
  ERP_DR_S3_ENDPOINT: 'https://s3.example.invalid',
  ERP_DR_S3_BUCKET: 'erp-dr',
  ERP_DR_S3_REGION: 'cn-north-1',
  ERP_DR_S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  ERP_DR_S3_SECRET_ACCESS_KEY: 'very-secret-key',
});

test('T1 配置齐备时校验通过，且报告形态不含任何凭据', () => {
  const result = validateBackupConfig(COMPLETE_ENV);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const serialized = JSON.stringify(result.config.reportable);
  assert.ok(!serialized.includes('super-secret'), '密码不得进入报告');
  assert.ok(!serialized.includes('very-secret-key'), '对象存储密钥不得进入报告');
  assert.ok(!serialized.includes('AKIAEXAMPLE'), '访问键不得进入报告');
  assert.ok(!serialized.includes('erp_backup'), '数据库账号不得进入报告');
});

test('T2 缺项、backend 非 mysql、库名非法时一律 fail closed', () => {
  assert.equal(validateBackupConfig({ ...COMPLETE_ENV, ERP_DB_BACKEND: 'sqlite' }).ok, false);
  assert.equal(validateBackupConfig({ ...COMPLETE_ENV, ERP_DB_PASSWORD: '' }).ok, false);
  assert.equal(validateBackupConfig({ ...COMPLETE_ENV, ERP_DR_S3_SECRET_ACCESS_KEY: '' }).ok, false);
  assert.equal(validateBackupConfig({ ...COMPLETE_ENV, ERP_DB_NAME: 'a; DROP TABLE x' }).ok, false);
  assert.equal(validateBackupConfig({ ...COMPLETE_ENV, ERP_DR_S3_ENDPOINT: 'http://insecure.example' }).ok, false);
});

test('T3 脱敏：密码、密钥与连接串里的凭据不得出现在输出', () => {
  const text = redactSecrets('connect mysql://erp:s3cr3t@db:3306/x password=hunter2 secret=abc');
  assert.ok(!text.includes('s3cr3t'));
  assert.ok(!text.includes('hunter2'));
  assert.ok(!text.includes('abc'));
  assert.ok(redactEndpoint('https://user:pass@s3.example/x').includes('s3.example'));
  assert.ok(!redactEndpoint('https://user:pass@s3.example/x').includes('pass'));
});

test('T4 恢复目标授权：未声明类别即拒绝', () => {
  const result = authorizeRestoreTarget({ host: 'h', port: 3306, database: 'd' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /显式声明/);
});

test('T5 恢复目标授权：生产恢复必须同时具备窗口、审批与精确身份', () => {
  const base = { targetClass: 'APPROVED_PRODUCTION', host: 'db.internal', port: 3306, database: 'modern_erp' };
  assert.equal(authorizeRestoreTarget(base).ok, false, '缺窗口与审批必须拒绝');
  assert.equal(authorizeRestoreTarget({ ...base, windowId: 'w1' }).ok, false, '缺审批必须拒绝');
  assert.equal(authorizeRestoreTarget({ ...base, windowId: 'w1', approvalId: 'a1' }).ok, false, '缺精确身份必须拒绝');
  const mismatch = authorizeRestoreTarget({
    ...base, windowId: 'w1', approvalId: 'a1',
    expectedHost: 'other.internal', expectedPort: 3306, expectedDatabase: 'modern_erp',
  });
  assert.equal(mismatch.ok, false, '目标身份不一致必须拒绝');
  const ok = authorizeRestoreTarget({
    ...base, windowId: 'w1', approvalId: 'a1',
    expectedHost: 'db.internal', expectedPort: 3306, expectedDatabase: 'modern_erp',
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.reason));
});

test('T6 恢复目标授权：disposable 也必须有完整身份', () => {
  assert.equal(authorizeRestoreTarget({ targetClass: 'DISPOSABLE' }).ok, false);
  assert.equal(authorizeRestoreTarget({ targetClass: 'DISPOSABLE', host: 'h', port: 3306, database: 'd' }).ok, true);
});

test('T7 保留策略：只删除已过保留期且已验证异机副本的对象', () => {
  const daily = Array.from({ length: 35 }, (_, index) => ({
    key: `daily/${index}.sql`,
    uploadedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    kind: 'daily',
    verified: true,
  }));
  const drills = Array.from({ length: 6 }, (_, index) => ({
    key: `drill/${index}.sql`,
    uploadedAt: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    kind: 'drill',
    verified: true,
  }));
  const unverified = { key: 'daily/unverified.sql', uploadedAt: '2026-01-01T00:00:00.000Z', kind: 'daily', verified: false };
  const candidates = computeRetentionCandidates([...daily, ...drills, unverified]);
  assert.ok(!candidates.some((item) => item.key === unverified.key), '未验证的对象不得被删除');
  assert.ok(candidates.length === 35 + 6 - 30 - 4, `候选数量不符：${candidates.length}`);
  const keptDaily = daily.slice(-30).map((item) => item.key);
  for (const key of keptDaily) assert.ok(!candidates.some((item) => item.key === key), `最近 30 个每日副本必须保留: ${key}`);
});

test('T8 RPO / RTO 计时：超出即判定失败', () => {
  const within = evaluateRecoveryTiming({
    lastBackupAt: '2026-11-14T00:00:00.000Z',
    drillStartedAt: '2026-11-14T12:00:00.000Z',
    drillFinishedAt: '2026-11-14T14:00:00.000Z',
  });
  assert.equal(within.rpo.ok, true);
  assert.equal(within.rto.ok, true);
  assert.equal(within.ok, true);

  const stale = evaluateRecoveryTiming({
    lastBackupAt: '2026-11-10T00:00:00.000Z',
    drillStartedAt: '2026-11-14T12:00:00.000Z',
    drillFinishedAt: '2026-11-14T14:00:00.000Z',
  });
  assert.equal(stale.rpo.ok, false, '超过 24 小时的备份间隔必须判定 RPO 失败');
  assert.equal(stale.ok, false);
});

test('T9 object key 不可变、含 commit 与 run id，唯一性不来自时钟', () => {
  // 不可变：同一组输入（含同一时刻）必须得到同一个 key —— 重跑同一备份运行必须指向同一对象。
  const fixedNow = new Date('2026-11-14T12:00:00.000Z');
  const first = buildObjectKey({ prefix: 'p/', commit: 'abcdef1234567890', runId: 'run-1', kind: 'daily', now: fixedNow });
  const second = buildObjectKey({ prefix: 'p/', commit: 'abcdef1234567890', runId: 'run-1', kind: 'daily', now: fixedNow });
  assert.equal(first, second, '同一组输入必须得到同一个 key（不可变）');
  assert.ok(first.includes('abcdef123456'));
  assert.ok(first.includes('run-1'));
  assert.ok(first.startsWith('p/daily/'));

  // 唯一性来源：时钟分量完全相同时，不同 run 仍然得到不同 key —— 唯一性来自 run id，不来自毫秒时间戳。
  const other = buildObjectKey({ prefix: 'p/', commit: 'abcdef1234567890', runId: 'run-2', kind: 'daily', now: fixedNow });
  assert.notEqual(first, other, '不同 run id 必须得到不同 key');
  assert.equal(
    first.slice(0, first.indexOf('abcdef123456')),
    other.slice(0, other.indexOf('abcdef123456')),
    '两次调用的时钟分量必须完全相同（证明 key 的差异不来自时钟）',
  );

  // 未显式传入 run id 时，每次调用都必须自带新的 run id —— 生产调用方
  // `scripts/admin/mysql-backup.mjs` 显式传入每次新建的 crypto.randomUUID()。
  const defaulted = buildObjectKey({ prefix: 'p/', commit: 'abcdef1234567890', kind: 'daily', now: fixedNow });
  const defaultedAgain = buildObjectKey({ prefix: 'p/', commit: 'abcdef1234567890', kind: 'daily', now: fixedNow });
  assert.notEqual(defaulted, defaultedAgain, '未传 run id 时每次调用都必须得到不同的 key');
});

test('T10 manifest 不含凭据', () => {
  const manifest = buildManifest({
    runId: 'r', key: 'k', sha256: 'a'.repeat(64), bytes: 10, commit: 'c',
    kind: 'daily', reportable: { endpoint: 'https://s3.example/', bucket: 'b', region: 'r', database: 'h:3306/d' },
    startedAt: '2026-11-14T00:00:00.000Z', finishedAt: '2026-11-14T00:01:00.000Z',
  });
  const serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes('super-secret'));
  assert.ok(!serialized.includes('password'));
  assert.equal(manifest.status, 'LOCAL_VERIFIED');
});

test('T11 状态机顺序固定', () => {
  assert.deepEqual(BACKUP_STATES, [
    'CONFIG_VALIDATED', 'SNAPSHOT_RUNNING', 'LOCAL_VERIFIED', 'UPLOADED',
    'REMOTE_VERIFIED', 'RETENTION_APPLIED', 'COMPLETE',
  ]);
  assert.deepEqual(RESTORE_STATES, [
    'SOURCE_VERIFIED', 'TARGET_AUTHORIZED', 'EMPTY_TARGET_VERIFIED', 'RESTORE_RUNNING',
    'DATA_VERIFIED', 'APP_VERIFIED', 'COMPLETE',
  ]);
});

test('T12 systemd 单元与 SQLite 备份单元彼此独立', () => {
  const mysqlUnit = readFileSync(join(repoRoot, 'deploy', 'systemd', 'modern-erp-mysql-backup.service'), 'utf8');
  const mysqlTimer = readFileSync(join(repoRoot, 'deploy', 'systemd', 'modern-erp-mysql-backup.timer'), 'utf8');
  const sqliteUnit = readFileSync(join(repoRoot, 'deploy', 'systemd', 'modern-erp-backup.service'), 'utf8');
  assert.ok(mysqlUnit.includes('User=modern-erp-backup'), 'MySQL 备份必须使用独立 service account');
  assert.ok(mysqlUnit.includes('scripts/admin/mysql-backup.mjs'));
  assert.ok(!sqliteUnit.includes('mysql-backup'), 'SQLite 备份单元不得改为调用 MySQL 入口');
  assert.ok(mysqlTimer.includes('OnCalendar='), '定时器必须声明日历');
  assert.ok(mysqlTimer.includes('Unit=modern-erp-mysql-backup.service'));
  assert.ok(mysqlUnit.includes('UMask=0077'), '备份单元必须限制文件权限');
});

test('T13 对象存储寻址：远端用 virtual-hosted style，本地 sentinel 用 path-style', () => {
  // 腾讯云 COS 拒绝 path-style 寻址（PathStyleDomainForbidden），
  // 远端对象存储必须走 virtual-hosted style。
  assert.equal(objectStoreAddressing('https://cos.ap-guangzhou.myqcloud.com').forcePathStyle, false);
  assert.equal(objectStoreAddressing('https://cos.ap-guangzhou.myqcloud.com').addressing, 'VIRTUAL_HOSTED');
  assert.equal(objectStoreAddressing('https://s3.eu-central-1.amazonaws.com').forcePathStyle, false);
  // 本地 sentinel 保持 path-style：本地 S3 兼容测试服务按 path-style 暴露桶。
  assert.equal(objectStoreAddressing('http://127.0.0.1:9000').forcePathStyle, true);
  assert.equal(objectStoreAddressing('http://127.0.0.1:9000').addressing, 'PATH');
  assert.equal(objectStoreAddressing('http://localhost:9000').forcePathStyle, true);

  // 备份与恢复两个入口都必须走同一个寻址判定，不得各自硬编码。
  const backupSource = readFileSync(join(repoRoot, 'scripts', 'admin', 'mysql-backup.mjs'), 'utf8');
  const restoreSource = readFileSync(join(repoRoot, 'scripts', 'admin', 'mysql-restore.mjs'), 'utf8');
  assert.ok(!backupSource.includes('forcePathStyle'), '备份入口不得硬编码寻址方式');
  assert.ok(!restoreSource.includes('forcePathStyle'), '恢复入口不得硬编码寻址方式');
  assert.ok(backupSource.includes('createObjectStoreClient'), '备份入口必须复用共享客户端');
  assert.ok(restoreSource.includes('createObjectStoreClient'), '恢复入口必须复用共享客户端');
});
