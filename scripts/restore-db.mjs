#!/usr/bin/env node
// scripts/restore-db.mjs
//
// Cross-platform SQLite restore tool.
//
// Usage:
//   node scripts/restore-db.mjs <backup-file> [--confirm-restore]
//
// Behaviour:
//   1. Verify backup file exists and is a valid SQLite DB (integrity_check = ok)
//   2. Create a safety backup of the current database
//   3. Replace the current database with the backup contents
//   4. Clean up stale -wal / -shm files
//   5. Run integrity_check again on the restored DB
//
// Production guard:
//   NODE_ENV=production requires --confirm-restore. This avoids
//   accidental overwrites when the script is invoked by automation
//   without interactive confirmation.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

export function runRestore({
  backupPath,
  dbPath,
  backupDir,
  isProduction = process.env.NODE_ENV === 'production',
  confirm = false,
  now = new Date(),
} = {}) {
  const resolvedDb = dbPath || process.env.ERP_DB_PATH || join(root, 'data', 'erp.db');
  const resolvedDir = backupDir || process.env.ERP_BACKUP_DIR || join(root, 'backups');

  if (!backupPath) {
    return { success: false, error: '必须指定备份文件路径', code: 2 };
  }
  if (!existsSync(backupPath)) {
    return { success: false, error: `备份文件不存在: ${backupPath}` };
  }
  const st = statSync(backupPath);
  if (!st.isFile() || st.size <= 0) {
    return { success: false, error: `备份文件无效或大小为 0: ${backupPath}` };
  }
  if (resolve(backupPath) === resolve(resolvedDb)) {
    return { success: false, error: '备份文件与目标数据库相同,拒绝覆盖。' };
  }

  let integrity = 'unknown';
  try {
    const verify = new DatabaseSync(backupPath, { readOnly: true });
    integrity = verify.prepare('PRAGMA integrity_check').get().integrity_check;
    verify.close();
  } catch (e) {
    return { success: false, error: `备份文件无法打开或非 SQLite 格式: ${e.message}` };
  }
  if (integrity !== 'ok') {
    return { success: false, error: `备份文件完整性检查未通过: ${integrity}` };
  }

  if (!existsSync(resolvedDb)) {
    return { success: false, error: `目标数据库不存在: ${resolvedDb}`, hint: '生产环境应在恢复前先通过 backup-db 创建目标数据库。' };
  }

  if (isProduction && !confirm) {
    return {
      success: false,
      error: '生产环境必须显式传入 --confirm-restore 才能执行恢复。建议先执行 backup-db 创建 safety backup。',
      code: 1,
    };
  }

  if (!existsSync(resolvedDir)) mkdirSync(resolvedDir, { recursive: true });

  let safetyPath = null;
  try {
    const safetyName = `safety-${timestamp(now)}.db`;
    safetyPath = join(resolvedDir, safetyName);
    if (existsSync(safetyPath)) {
      return { success: false, error: `safety 备份目标已存在: ${safetyPath}` };
    }
    const safetyDb = new DatabaseSync(resolvedDb);
    safetyDb.exec(`VACUUM INTO '${sqlEscape(safetyPath)}'`);
    safetyDb.close();
  } catch (e) {
    return { success: false, error: `创建 safety 备份失败,中止恢复: ${e.message}`, code: 1 };
  }

  const walPath = `${resolvedDb}-wal`;
  const shmPath = `${resolvedDb}-shm`;
  for (const stale of [walPath, shmPath]) {
    if (existsSync(stale)) {
      try { rmSync(stale); } catch (e) {
        return { success: false, error: `无法删除旧 ${stale}: ${e.message}`, code: 1 };
      }
    }
  }

  try {
    const targetTmp = `${resolvedDb}.restore.tmp`;
    if (existsSync(targetTmp)) rmSync(targetTmp);
    const src = new DatabaseSync(backupPath, { readOnly: true });
    src.exec(`VACUUM INTO '${sqlEscape(targetTmp)}'`);
    src.close();
    renameSync(targetTmp, resolvedDb);
  } catch (e) {
    return {
      success: false,
      error: `恢复失败: ${e.message}`,
      code: 1,
      safetyPath,
      hint: '当前数据库未修改;safety 备份可用于手工恢复。',
    };
  }

  let finalIntegrity = 'unknown';
  try {
    const verify = new DatabaseSync(resolvedDb, { readOnly: true });
    finalIntegrity = verify.prepare('PRAGMA integrity_check').get().integrity_check;
    verify.close();
  } catch (e) {
    return { success: false, error: `恢复后 integrity_check 失败: ${e.message}`, code: 1 };
  }
  if (finalIntegrity !== 'ok') {
    return { success: false, error: `恢复后完整性检查未通过: ${finalIntegrity}`, code: 1 };
  }

  return {
    success: true,
    dbPath: resolvedDb,
    backupPath,
    safetyPath,
    integrity: finalIntegrity,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node scripts/restore-db.mjs <backup-file> [--confirm-restore]');
    process.exit(2);
  }
  const backupArg = args[0];
  const confirm = args.includes('--confirm-restore');
  const backupPath = resolve(backupArg);
  const result = runRestore({ backupPath, confirm });
  if (!result.success) {
    console.error(`错误:${result.error}`);
    process.exit(result.code ?? 1);
  }
  console.log(`恢复成功: ${result.dbPath}`);
  console.log(`来源备份: ${result.backupPath}`);
  console.log(`Safety 备份: ${result.safetyPath}`);
  console.log(`恢复后完整性: ${result.integrity}`);
  console.log('提示:运行中的服务需重启才能读取恢复后的数据(详见部署文档)。');
}

const isMain = import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]);
if (isMain) main();