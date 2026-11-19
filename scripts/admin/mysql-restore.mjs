#!/usr/bin/env node
/**
 * MySQL 恢复演练（PL-RI-01）。
 *
 * 状态机（固定顺序）：
 *   SOURCE_VERIFIED → TARGET_AUTHORIZED → EMPTY_TARGET_VERIFIED → RESTORE_RUNNING
 *   → DATA_VERIFIED → APP_VERIFIED → COMPLETE
 *
 * 恢复安全（Requirement §36.16.2）：
 *   - 默认 fail closed：目标类别必须显式声明；
 *   - 生产恢复必须同时提供**独立窗口标识**与**审批标识**，且目标身份逐项相等；
 *   - 目标非空时默认拒绝；生产恢复**不**自动 DROP 数据库；
 *   - 不提供模糊目标、默认库名、通配清理或自动覆盖生产库的入口；
 *   - 凭据、连接串与对象存储密钥**不得**进入输出、日志或证据。
 *
 * 用法：
 *   node scripts/admin/mysql-restore.mjs --run-id <id> --target-class DISPOSABLE|APPROVED_PRODUCTION
 *     [--host <host> --port <port> --database <name>] [--window-id <id> --approval-id <id>]
 *     [--expected-host <h> --expected-port <p> --expected-database <d>]
 *     [--manifest-dir <dir>] [--app-base-url <url>]
 *
 * 退出码：0 = 完成；1 = 失败；2 = 用法 / 授权错误。
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authorizeRestoreTarget, createObjectStoreClient, evaluateRecoveryTiming, redactSecrets,
  removeQuietly, runMysqlImport,
} from './lib/mysql-dr.mjs';

function parseArgs(argv) {
  const args = {
    runId: null, targetClass: null, host: null, port: null, database: null,
    windowId: null, approvalId: null, expectedHost: null, expectedPort: null, expectedDatabase: null,
    manifestDir: null, appBaseUrl: null, dumpDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[++i];
    if (key === '--run-id') args.runId = value;
    else if (key === '--target-class') args.targetClass = value;
    else if (key === '--host') args.host = value;
    else if (key === '--port') args.port = value;
    else if (key === '--database') args.database = value;
    else if (key === '--window-id') args.windowId = value;
    else if (key === '--approval-id') args.approvalId = value;
    else if (key === '--expected-host') args.expectedHost = value;
    else if (key === '--expected-port') args.expectedPort = value;
    else if (key === '--expected-database') args.expectedDatabase = value;
    else if (key === '--manifest-dir') args.manifestDir = value;
    else if (key === '--app-base-url') args.appBaseUrl = value;
    else if (key === '--dump-dir') args.dumpDir = value;
    else { process.stderr.write(`未知参数: ${key}\n`); process.exit(2); }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.runId || !args.targetClass) {
    process.stderr.write('必须提供 --run-id 与 --target-class\n');
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  let state = 'SOURCE_VERIFIED';

  const manifestDir = args.manifestDir || process.env.ERP_DR_MANIFEST_DIR || join(process.cwd(), '.dr-backups', 'manifests');
  const dumpDir = args.dumpDir || process.env.ERP_DR_BACKUP_DIR || join(process.cwd(), '.dr-backups');
  const manifestPath = join(manifestDir, `${args.runId}.json`);
  const dumpPath = join(dumpDir, `${args.runId}.sql`);

  const finish = (ok, error, extra = {}) => {
    const finishedAt = new Date().toISOString();
    const result = {
      state,
      ok,
      runId: args.runId,
      startedAt,
      finishedAt,
      error: error ? redactSecrets(String(error.message || error)) : null,
      ...extra,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!ok) {
      process.stderr.write(`=== MySQL 恢复失败（状态 ${state}）===\n  FAIL ${result.error}\n`);
      process.exit(1);
    }
    process.stderr.write(`=== MySQL 恢复完成（状态 ${state}）===\n`);
  };

  try {
    /* SOURCE_VERIFIED */
    if (!existsSync(manifestPath)) throw new Error(`找不到 manifest: ${manifestPath}`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.status !== 'REMOTE_VERIFIED') {
      throw new Error(`源备份未达 REMOTE_VERIFIED（当前 ${manifest.status}），不得恢复`);
    }
    if (!manifest.sha256 || !manifest.bytes) throw new Error('manifest 缺少哈希或字节数，拒绝恢复');
    const bucket = process.env.ERP_DR_S3_BUCKET;
    const region = process.env.ERP_DR_S3_REGION;
    const endpoint = process.env.ERP_DR_S3_ENDPOINT;
    if (!bucket || !region || !endpoint) throw new Error('对象存储配置缺失，拒绝恢复');
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await createObjectStoreClient({
      region,
      endpoint,
      accessKeyId: process.env.ERP_DR_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.ERP_DR_S3_SECRET_ACCESS_KEY,
    });
    mkdirSync(dumpDir, { recursive: true });
    const fetched = await client.send(new GetObjectCommand({ Bucket: bucket, Key: manifest.objectKey }));
    const hash = createHash('sha256');
    let bytes = 0;
    const chunks = [];
    for await (const chunk of fetched.Body) {
      hash.update(chunk);
      bytes += chunk.length;
      chunks.push(chunk);
    }
    const sha256 = hash.digest('hex');
    if (sha256 !== manifest.sha256 || bytes !== manifest.bytes) {
      throw new Error(`下载校验失败：manifest ${manifest.sha256}/${manifest.bytes}，实际 ${sha256}/${bytes}`);
    }
    writeFileSync(dumpPath, Buffer.concat(chunks), { mode: 0o600 });

    /* TARGET_AUTHORIZED */
    state = 'TARGET_AUTHORIZED';
    const authorized = authorizeRestoreTarget({
      targetClass: args.targetClass,
      host: args.host,
      port: args.port,
      database: args.database,
      windowId: args.windowId,
      approvalId: args.approvalId,
      expectedHost: args.expectedHost,
      expectedPort: args.expectedPort,
      expectedDatabase: args.expectedDatabase,
    });
    if (!authorized.ok) {
      process.stderr.write(`=== 恢复授权失败 ===\n  FAIL ${authorized.reason}\n`);
      process.exit(2);
    }
    const target = authorized.target;

    /* EMPTY_TARGET_VERIFIED */
    state = 'EMPTY_TARGET_VERIFIED';
    const { createConnection } = await import('mysql2/promise');
    const connection = await createConnection({
      host: target.identity.host,
      port: target.identity.port,
      user: process.env.ERP_DB_USER,
      password: process.env.ERP_DB_PASSWORD,
      database: target.identity.database,
    });
    const [tables] = await connection.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    const existing = Number(tables[0]?.n || 0);
    if (existing > 0 && target.targetClass !== 'DISPOSABLE') {
      throw new Error('目标库非空：生产恢复不得自动覆盖，必须由操作员准备空目标');
    }
    if (existing > 0 && target.targetClass === 'DISPOSABLE') {
      throw new Error('目标库非空：演练目标必须是空库，拒绝覆盖');
    }

    /* RESTORE_RUNNING */
    state = 'RESTORE_RUNNING';
    await runMysqlImport({
      database: { ...target.identity, user: process.env.ERP_DB_USER },
      user: process.env.ERP_DB_USER,
      password: process.env.ERP_DB_PASSWORD,
      dumpPath,
    });

    /* DATA_VERIFIED */
    state = 'DATA_VERIFIED';
    const [tableRows] = await connection.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()',
    );
    const [viewRows] = await connection.query(
      'SELECT COUNT(*) AS n FROM information_schema.views WHERE table_schema = DATABASE()',
    );
    const [triggerRows] = await connection.query(
      'SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE()',
    );
    const [failing] = await connection.query(
      'SELECT COUNT(*) AS n FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_type = "FOREIGN KEY"',
    );
    const restored = {
      tables: Number(tableRows[0]?.n || 0),
      views: Number(viewRows[0]?.n || 0),
      triggers: Number(triggerRows[0]?.n || 0),
      foreignKeys: Number(failing[0]?.n || 0),
    };
    if (restored.tables <= 0) throw new Error('恢复后没有任何表：完整性校验失败');
    await connection.end();

    /* APP_VERIFIED */
    state = 'APP_VERIFIED';
    let appHealth = null;
    if (args.appBaseUrl) {
      const live = await fetch(`${args.appBaseUrl}/api/health/live`);
      const ready = await fetch(`${args.appBaseUrl}/api/health/ready`);
      if (!live.ok || !ready.ok) {
        throw new Error(`应用健康检查失败: live=${live.status} ready=${ready.status}`);
      }
      appHealth = { live: live.status, ready: ready.status };
    }

    removeQuietly(dumpPath);
    state = 'COMPLETE';
    finish(true, null, { restored, appHealth });
  } catch (error) {
    removeQuietly(dumpPath);
    finish(false, error);
  }
}

main();
