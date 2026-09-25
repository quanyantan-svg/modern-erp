#!/usr/bin/env node
// server/reset-data.js
//
// Fail-closed destructive database reset.
//
// Contract (effective v1.0 — phase-0 process integrity rebuild):
//   1. ERP_DB_PATH MUST be explicitly provided AND absolute.
//      → Without an explicit ERP_DB_PATH, the script REFUSES (exits non-zero)
//        and never touches any database. This prevents a test or one-off
//        command from accidentally removing the repository default DB.
//   2. NODE_ENV=production → REFUSE always. This repository does not ship a
//      current V1.3 production full-data-reset tool. Any production-destructive
//      reset requires a separately reviewed, environment-specific procedure,
//      backup/recovery evidence, and explicit approval.
//   3. The resolved target MUST NOT be the repository default database
//      (<repo>/data/erp.db). This is a last-line guard against a caller
//      that explicitly points ERP_DB_PATH at the developer workspace.
//   4. The resolved target MUST live outside the repository root.
//      Resetting a DB inside the repo is never a normal operation.
//   5. If the path looks like a production path (contains "production"
//      or "live", or matches a sentinel-allowlisted override) AND the
//      ERP_RESET_PRODUCTION_OK=YES environment sentinel is NOT set,
//      REFUSE. This guards against destructive reset against a live
//      server's database by mistake.
//   6. On success the script deletes exactly the target file plus its
//      SQLite -wal and -shm siblings. Nothing else is touched.
//
// Default-repo safety note: callers that need to delete the repo's default
// DB (e.g. demos, local exploration) must invoke reset-data with an
// explicit ERP_DB_PATH pointing at a disposable temporary database under
// os.tmpdir(), not the repo's data/erp.db.

import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, '..', '..');
const defaultRepoDb = resolve(repoRoot, 'data', 'erp.db');

function refuse(code, ...messages) {
  for (const message of messages) console.error(message);
  process.exit(code);
}

// Production must never run through this script. No directly executable V1.3
// production full-data-reset tool is provided by this repository.
if (process.env.NODE_ENV === 'production') {
  refuse(
    1,
    '错误：生产环境禁止执行 reset-data。',
    '生产破坏性重置必须使用单独评审、与目标环境匹配并明确批准的流程;当前仓库不提供可直接执行的 V1.3 生产全量重置工具。',
  );
}

const rawTarget = process.env.ERP_DB_PATH;
if (typeof rawTarget !== 'string' || rawTarget.trim() === '') {
  refuse(
    2,
    '错误：reset-data 已禁用隐式默认数据库。',
    '必须显式设置 ERP_DB_PATH=<绝对路径>,指向一次性临时数据库(例如 os.tmpdir() 下的路径)。',
    '示例: ERP_DB_PATH="$(node -e "console.log(require(\\\"node:os\\\").tmpdir()+\\\"/erp-reset.db\\\"))" node server/reset-data.js',
  );
}

const trimmed = rawTarget.trim();
if (!isAbsolute(trimmed)) {
  refuse(2, `错误：ERP_DB_PATH 必须是绝对路径: ${rawTarget}`);
}

const target = resolve(trimmed);

// Last-line guard: never allow the script to be aimed at the repo default.
if (target === defaultRepoDb) {
  refuse(
    2,
    `错误：reset-data 拒绝操作仓库默认数据库(${defaultRepoDb})。`,
    '这是开发者本地数据库;本保护防止测试或脚本误删数据。',
    '请使用 os.tmpdir() 下的临时数据库(例如测试工厂 server/test-utils/temp-db.js)。',
  );
}

// Never allow the path to live inside the repository. This is a belt-and-braces
// guard: even if a caller points ERP_DB_PATH at a sibling file under
// <repo>/data, we refuse. The reset script is only for disposable temporary
// databases outside the repository.
const insideRepo =
  target === repoRoot ||
  target.startsWith(repoRoot + sep) ||
  target.startsWith(repoRoot + '/') ||
  target.startsWith(repoRoot + '\\');
if (insideRepo) {
  refuse(
    2,
    `错误：reset-data 拒绝操作仓库内部路径: ${target}`,
    `仓库根目录: ${repoRoot}`,
    '请仅使用仓库外的一次性临时数据库路径。',
  );
}

// Live / production path protection. A caller can opt in explicitly via
// ERP_RESET_PRODUCTION_OK=YES; without that sentinel, refuse.
const lower = target.toLowerCase();
const looksProduction = lower.includes('production') || lower.includes('/live') || lower.endsWith('-live.db') || lower.endsWith('-prod.db');
if (looksProduction && process.env.ERP_RESET_PRODUCTION_OK !== 'YES') {
  refuse(
    2,
    `错误：路径疑似生产数据库(${target}),但缺少 ERP_RESET_PRODUCTION_OK=YES 哨兵。`,
    'reset-data 仅用于仓库外的一次性开发/测试数据库;生产破坏性操作需要独立评审和明确批准。',
  );
}

// All guards passed. Delete exactly the target file and its -wal / -shm siblings.
let removed = 0;
for (const file of [target, `${target}-wal`, `${target}-shm`]) {
  if (existsSync(file)) {
    rmSync(file);
    removed += 1;
  }
}
console.log(`已清除 ${removed} 个文件: ${target} (+ -wal / -shm 若存在)`);
console.log('下次启动时会自动重新初始化。');
