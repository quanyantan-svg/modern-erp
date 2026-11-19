#!/usr/bin/env node
/**
 * MySQL 生产备份 + 异机副本（PL-RI-01）。
 *
 * 状态机（固定顺序，任何一步失败即非零退出并停在该状态）：
 *   CONFIG_VALIDATED → SNAPSHOT_RUNNING → LOCAL_VERIFIED → UPLOADED
 *   → REMOTE_VERIFIED → RETENTION_APPLIED → COMPLETE
 *
 * 硬性边界：
 *   - 未到 REMOTE_VERIFIED **不得**执行保留清理，也不得报告可恢复；
 *   - 空文件、哈希不符、上传后回读不符一律失败；
 *   - 凭据、连接串、对象存储密钥**不得**进入输出、日志或 manifest；
 *   - 本工具**不**决定生产恢复授权（那是 `mysql-restore.mjs` 的职责）。
 *
 * 用法：
 *   node scripts/admin/mysql-backup.mjs [--out-dir <dir>] [--manifest-dir <dir>] [--kind daily|drill]
 *
 * 退出码：0 = 完成；1 = 失败；2 = 用法 / 配置错误。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BACKUP_STATES, buildManifest, buildObjectKey, computeRetentionCandidates, createObjectStoreClient,
  hashFile, redactSecrets, removeQuietly, runMysqlDump, validateBackupConfig,
} from './lib/mysql-dr.mjs';

function parseArgs(argv) {
  const args = { outDir: null, manifestDir: null, kind: 'daily', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out-dir') args.outDir = argv[++i];
    else if (argv[i] === '--manifest-dir') args.manifestDir = argv[++i];
    else if (argv[i] === '--kind') args.kind = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return 'unknown';
  return String(result.stdout || '').trim() || 'unknown';
}

/** S3 客户端：寻址方式由 endpoint 决定（腾讯云 COS 用 virtual-hosted style）。 */
async function s3Client(config) {
  return createObjectStoreClient(config.objectStore);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['daily', 'drill'].includes(args.kind)) {
    process.stderr.write('--kind 必须是 daily 或 drill\n');
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  let state = 'CONFIG_VALIDATED';

  const validated = validateBackupConfig(process.env);
  if (!validated.ok) {
    process.stderr.write(`=== MySQL 备份失败（状态 ${state}）===\n`);
    for (const problem of validated.problems) process.stderr.write(`  FAIL ${problem}\n`);
    process.exit(2);
  }
  const { config } = validated;

  const outDir = args.outDir || process.env.ERP_DR_BACKUP_DIR || join(process.cwd(), '.dr-backups');
  const manifestDir = args.manifestDir || process.env.ERP_DR_MANIFEST_DIR || join(outDir, 'manifests');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(manifestDir, { recursive: true });

  const runId = crypto.randomUUID();
  const commit = currentCommit();
  const key = buildObjectKey({ prefix: config.objectStore.prefix, commit, runId, kind: args.kind });
  const localPath = join(outDir, `${runId}.sql`);
  const manifestPath = join(manifestDir, `${runId}.json`);

  const finish = (ok, error) => {
    const finishedAt = new Date().toISOString();
    const result = {
      state,
      ok,
      runId,
      objectKey: key,
      commit,
      kind: args.kind,
      startedAt,
      finishedAt,
      target: config.reportable,
      error: error ? redactSecrets(String(error.message || error)) : null,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!ok) {
      process.stderr.write(`=== MySQL 备份失败（状态 ${state}）===\n  FAIL ${result.error}\n`);
      process.exit(1);
    }
    process.stderr.write(`=== MySQL 备份完成（状态 ${state}）===\n`);
  };

  try {
    /* SNAPSHOT_RUNNING */
    state = 'SNAPSHOT_RUNNING';
    if (args.dryRun) {
      finish(false, new Error('--dry-run 不产生备份；本轮不执行真实 mysqldump'));
      return;
    }
    await runMysqlDump({
      database: config.database,
      user: config.database.user,
      password: process.env.ERP_DB_PASSWORD,
      outputPath: localPath,
    });

    /* LOCAL_VERIFIED */
    state = 'LOCAL_VERIFIED';
    if (!existsSync(localPath)) throw new Error('备份文件不存在');
    const local = await hashFile(localPath);
    if (!local.bytes || local.bytes <= 0) throw new Error('备份文件为空，拒绝继续');
    const manifest = buildManifest({
      runId,
      key,
      sha256: local.sha256,
      bytes: local.bytes,
      commit,
      kind: args.kind,
      reportable: config.reportable,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    /* UPLOADED */
    state = 'UPLOADED';
    const { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } =
      await import('@aws-sdk/client-s3');
    const client = await s3Client(config);
    await client.send(new PutObjectCommand({
      Bucket: config.objectStore.bucket,
      Key: key,
      Body: (await import('node:fs')).createReadStream(localPath),
      ContentType: 'application/sql',
      ServerSideEncryption: 'AES256',
    }));

    /* REMOTE_VERIFIED —— 回读并重新计算哈希，只信 ETag / HeadObject 是不够的 */
    state = 'REMOTE_VERIFIED';
    const fetched = await client.send(new GetObjectCommand({ Bucket: config.objectStore.bucket, Key: key }));
    const hash = createHash('sha256');
    let remoteBytes = 0;
    for await (const chunk of fetched.Body) {
      hash.update(chunk);
      remoteBytes += chunk.length;
    }
    const remoteSha = hash.digest('hex');
    if (remoteSha !== local.sha256 || remoteBytes !== local.bytes) {
      throw new Error(`回读校验失败：本地 ${local.sha256}/${local.bytes}，远端 ${remoteSha}/${remoteBytes}`);
    }
    const verifiedManifest = { ...manifest, status: 'REMOTE_VERIFIED', remoteSha256: remoteSha };
    writeFileSync(manifestPath, `${JSON.stringify(verifiedManifest, null, 2)}\n`, 'utf8');

    /* RETENTION_APPLIED —— 只删除已过保留期且存在已验证异机副本的对象 */
    state = 'RETENTION_APPLIED';
    const listed = await client.send(new ListObjectsV2Command({ Bucket: config.objectStore.bucket, Prefix: config.objectStore.prefix }));
    const objects = [];
    for (const item of listed.Contents || []) {
      const name = String(item.Key);
      if (name === key) continue;
      const manifestName = name.split('/').pop().replace(/\.sql$/, '.json');
      const candidatePath = join(manifestDir, manifestName);
      let verified = false;
      let kind = 'daily';
      let uploadedAt = item.LastModified ? new Date(item.LastModified).toISOString() : new Date(0).toISOString();
      if (existsSync(candidatePath)) {
        try {
          const parsed = JSON.parse(readFileSync(candidatePath, 'utf8'));
          verified = parsed.status === 'REMOTE_VERIFIED' && Boolean(parsed.sha256);
          kind = parsed.kind || 'daily';
          uploadedAt = parsed.finishedAt || uploadedAt;
        } catch { verified = false; }
      }
      objects.push({ key: name, uploadedAt, kind, verified });
    }
    const candidates = computeRetentionCandidates(objects);
    const deleted = [];
    for (const candidate of candidates) {
      await client.send(new DeleteObjectCommand({ Bucket: config.objectStore.bucket, Key: candidate.key }));
      deleted.push(candidate.key);
    }

    removeQuietly(localPath);
    state = 'COMPLETE';
    finish(true, null);
    process.stdout.write(`  已清理对象: ${deleted.length}\n`);
  } catch (error) {
    removeQuietly(localPath);
    finish(false, error);
  }
}

main();
