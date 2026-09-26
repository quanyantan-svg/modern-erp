#!/usr/bin/env node
// scripts/admin/setup-admin.mjs
//
// Explicit one-time first administrator bootstrap.
//
// Why:
//   Phase 2A blocks demo seed in production so an empty production DB no
//   longer auto-creates weak demo accounts. This script is the ONLY
//   supported path to create the first administrator against a fresh
//   production database. It is invoked explicitly by an operator and
//   must never be called from normal application startup.
//
// Usage:
//   node scripts/admin/setup-admin.mjs --username admin --password <secret>
//   pnpm setup-admin -- --username admin --password <secret>
//
// Production behaviour:
//   Allowed under NODE_ENV=production (this is a production init tool).
//   Must always be invoked as an explicit command. The application
//   startup path (server/index.js) does NOT call this script.
//
// Safety:
//   - username / password both required
//   - rejects a short set of well-known demo passwords
//   - rejects existing usernames (does not overwrite)
//   - verifies the admin role exists before inserting
//   - never echoes the password to stdout / stderr
//   - never writes the password to disk

import { createDatabase, hashPassword } from '../../server/db.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const WEAK_DEMO_PASSWORDS = new Set([
  'admin123', 'sales123', 'review123', 'warehouse123', 'accounting123',
  'admin', 'password', '123456', '12345678', 'qwerty',
]);

const MIN_PASSWORD_LENGTH = 12;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function ensureDbDir(dbPath) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function setupAdmin({
  dbPath,
  username,
  password,
  displayName = '系统管理员',
  now = new Date(),
  backend = String(process.env.ERP_DB_BACKEND || 'sqlite').toLowerCase(),
  createDatabaseFn = createDatabase,
  ensureDbDirFn = ensureDbDir,
} = {}) {
  if (!username || typeof username !== 'string' || !username.trim()) {
    return { success: false, error: '必须提供 --username 参数' };
  }
  const user = username.trim();

  if (!password || typeof password !== 'string') {
    return { success: false, error: '必须提供 --password 参数' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: `密码长度至少 ${MIN_PASSWORD_LENGTH} 个字符` };
  }
  if (WEAK_DEMO_PASSWORDS.has(password.toLowerCase())) {
    return { success: false, error: '拒绝使用已知弱密码(包括 demo 演示密码)' };
  }

  let db;
  try {
    if (backend === 'mysql') {
      // MySQL production: rely on configured ERP_DB_* env via createDatabase(),
      // and skip SQLite-only parent-directory mkdir.
      db = createDatabaseFn();
    } else {
      ensureDbDirFn(dbPath);
      db = createDatabaseFn(dbPath);
    }
  } catch (e) {
    return { success: false, error: `无法打开数据库: ${e.message}` };
  }

  try {
    const role = db.prepare("SELECT id FROM roles WHERE code='ADMIN'").get();
    if (!role) {
      return { success: false, error: 'admin role(ADMIN)不存在;数据库 schema 未正确初始化' };
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(user);
    if (existing) {
      return { success: false, error: `用户已存在: ${user}(拒绝覆盖)` };
    }

    const userId = 'user-admin-init';
    const nowIso = now.toISOString();
    const passwordHash = hashPassword(password);

    db.prepare(`
      INSERT INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
      VALUES(?, ?, ?, ?, ?, ?, 1, ?)
    `).run(userId, user, displayName, passwordHash.hash, passwordHash.salt, role.id, nowIso);

    return { success: true, username: user, userId, roleId: role.id };
  } catch (e) {
    return { success: false, error: `创建失败: ${e.message}` };
  } finally {
    try { db.close(); } catch {}
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = process.env.ERP_DB_PATH || join(root, 'data', 'erp.db');
  const username = args.username;
  const password = args.password;

  if (!username && process.stdin.isTTY) {
    process.stdout.write('username: ');
    try {
      username = require('node:readline').createInterface({ input: process.stdin, output: process.stdout })
        .question('', (answer) => { /* never reached */ });
    } catch {}
  }

  const result = setupAdmin({ dbPath, username, password });

  // Wipe password from memory after use (best-effort)
  if (typeof password === 'string') {
    try { password.replace(/./g, '\0'); } catch {}
  }

  if (!result.success) {
    console.error(`错误:${result.error}`);
    process.exit(1);
  }
  console.log(`管理员创建成功: ${result.username}`);
  console.log(`userId: ${result.userId}`);
  console.log(`role: ADMIN`);
  console.log(`数据库: ${dbPath}`);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const scriptPath = process.argv[1].replace(/\\/g, '/');
  const moduleUrl = import.meta.url;
  // URL-encoded version of the script path
  const encoded = encodeURI(scriptPath);
  if (moduleUrl === `file:///${encoded}` || moduleUrl === `file://${encoded}`) return true;
  if (moduleUrl.endsWith(scriptPath.split('/').pop())) return true;
  return false;
}

if (isMainModule()) main();
