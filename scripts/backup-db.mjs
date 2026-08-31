#!/usr/bin/env node
// scripts/backup-db.mjs
//
// Cross-platform SQLite online backup tool.
//
// Strategy:
//   SQLite node:sqlite (Node >= 22.13) does not expose the C backup API on
//   DatabaseSync. We use the official SQLite command `VACUUM INTO <path>`,
//   which produces a self-contained, transactionally-consistent copy of the
//   database. WAL pending pages are materialised into the new file by VACUUM,
//   so the backup is consistent without requiring a checkpoint or quiesce.
//   The resulting file has no `-wal` / `-shm` siblings.
//
// Defaults:
//   ERP_DB_PATH    → <repo>/data/erp.db
//   ERP_BACKUP_DIR → <repo>/backups

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function backupFilename(date) {
  return `erp-${timestamp(date)}.db`;
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

export function runBackup({ dbPath, backupDir, retention = 30, now = new Date() } = {}) {
  const resolvedDb = dbPath || process.env.ERP_DB_PATH || join(root, 'data', 'erp.db');
  const resolvedDir = backupDir || process.env.ERP_BACKUP_DIR || join(root, 'backups');

  if (!existsSync(resolvedDb)) {
    return { success: false, error: `数据库不存在: ${resolvedDb}` };
  }
  if (!existsSync(resolvedDir)) mkdirSync(resolvedDir, { recursive: true });

  const backupPath = join(resolvedDir, backupFilename(now));
  if (existsSync(backupPath)) {
    return { success: false, error: `备份文件已存在,不覆盖: ${backupPath}` };
  }

  let db;
  try {
    db = new DatabaseSync(resolvedDb);
    db.exec(`VACUUM INTO '${sqlEscape(backupPath)}'`);
  } catch (e) {
    try { rmSync(backupPath, { force: true }); } catch {}
    return { success: false, error: `VACUUM INTO 失败: ${e.message}` };
  } finally {
    try { db?.close(); } catch {}
  }

  if (!existsSync(backupPath)) {
    return { success: false, error: `备份文件未生成: ${backupPath}` };
  }
  const st = statSync(backupPath);
  if (st.size <= 0) {
    rmSync(backupPath, { force: true });
    return { success: false, error: `备份文件大小为 0: ${backupPath}` };
  }

  let integrity = 'unknown';
  try {
    const verify = new DatabaseSync(backupPath, { readOnly: true });
    integrity = verify.prepare('PRAGMA integrity_check').get().integrity_check;
    verify.close();
  } catch (e) {
    rmSync(backupPath, { force: true });
    return { success: false, error: `备份 integrity_check 失败: ${e.message}` };
  }

  if (integrity !== 'ok') {
    rmSync(backupPath, { force: true });
    return { success: false, error: `备份完整性检查未通过: ${integrity}` };
  }

  let removed = 0;
  if (retention > 0) {
    const existing = readdirSync(resolvedDir)
      .filter(f => /^erp-\d{8}-\d{6}\.db$/.test(f))
      .map(f => ({ f, mtime: statSync(join(resolvedDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const toRemove = existing.slice(retention);
    for (const r of toRemove) {
      try { rmSync(join(resolvedDir, r.f)); removed++; } catch {}
    }
  }

  return { success: true, path: backupPath, size: st.size, integrity, removed };
}

function main() {
  const retention = Number(process.env.ERP_BACKUP_RETENTION || 30);
  const result = runBackup({ retention });
  if (!result.success) {
    console.error(`错误:${result.error}`);
    process.exit(1);
  }
  console.log(`备份成功: ${result.path}`);
  console.log(`大小: ${result.size} bytes`);
  console.log(`完整性: ${result.integrity}`);
  if (result.removed) {
    console.log(`已清理 ${result.removed} 个过期备份(保留最新 ${retention} 个)`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]);
if (isMain) main();