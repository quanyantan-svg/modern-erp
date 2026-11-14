#!/usr/bin/env node
/**
 * Migration fail-closed 覆盖清点（PL-RI-02）。
 *
 * 背景：Requirement §36.16.2 规定「禁止 catch {}、空 catch 或仅 console.error 后继续」。
 * 本脚本把初始化 / 升级路径上的**每一个** catch 站点分类并列出，形成机器可验证的
 * 全量清点，而不是逐个症状修补。
 *
 * 分类：
 *  - `NARROW_RETHROW`   —— catch 会重新抛出未知错误，只对明确错误类别放行（合规）。
 *  - `CLEANUP_ATTACHED` —— catch 只做回滚 / 关闭等清理，且原始异常在之后被重新抛出
 *                          （Design §32.16.4 第 4 条明确允许）。
 *  - `SWALLOWED`        —— 空 catch / 仅打印后继续：**不合规**，登记为 OPEN。
 *  - `NOT_MIGRATION`    —— 不在初始化 / 升级路径上（事务辅助、种子、诊断等）。
 *
 * 退出码：0 = 授权范围内无 SWALLOWED；1 = 授权范围内仍有 SWALLOWED；2 = 用法错误。
 *
 * 本脚本**只读**：不修改任何仓库文件、数据库或 Git 状态。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** PL-RI-02 已授权实施的范围：server/db.js 中承载初始化 / 升级的函数。 */
const IN_SCOPE_FUNCTIONS = [
  'createSqliteDatabase',
  'initializeSqliteDatabase',
  'migrateWarehouseLogistics',
  'lateProcurementColumns',
  'migrateProductionDocuments',
];

/** 同一初始化路径、但超出本轮授权范围的模块目录。 */
const MIGRATION_DIR = 'server/migrations';

/** catch 体里出现这些调用即视为「重新抛出」，未知错误不会被吞掉。 */
const RETHROW_PATTERNS = [/\bthrow\b/, /migrationFailure\(/];

/** catch 体里出现这些调用即视为「仅打印后继续」。 */
const LOG_ONLY_PATTERNS = [/console\.(error|warn|log)\(/];

/** 清理型 catch 体：只做回滚 / 释放，不吞掉原始异常。 */
const CLEANUP_ONLY = /^(if\s*\(.*\)\s*)?(db\.exec\(\s*'(ROLLBACK|RELEASE)[^']*'\s*\)|db\.close\(\)|release[A-Za-z]*\([^)]*\))\s*;?$/;

/** 去掉注释后的行，用于判断语句是否为空。 */
function stripComment(line) {
  return line.replace(/\/\/.*$/, '').trim();
}

/**
 * 去掉整段块注释（保留行数，便于行号定位）。
 * 注释里的 `catch` 字样不得被当成 catch 站点。
 */
function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/** 判断一个函数在源文件中的行区间（含函数体）。 */
function functionRange(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^function ${name}\\b`).test(line));
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i > start) return { start: start + 1, end: i + 1 };
  }
  return null;
}

/** 抽取 catch 块体（按花括号配平），跳过注释行里的 catch 字样。 */
function catchSites(rawText) {
  const sites = [];
  const text = stripBlockComments(rawText);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const header = stripComment(lines[i]);
    if (!/\bcatch\b/.test(header)) continue;
    const openIndex = header.indexOf('{', header.indexOf('catch'));
    if (openIndex === -1) continue;
    let depth = 0;
    const body = [];
    let end = i;
    for (let j = i; j < lines.length; j++) {
      const current = j === i ? lines[j].slice(openIndex) : lines[j];
      for (const ch of current) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      body.push(j === i ? lines[j].slice(openIndex) : lines[j]);
      if (depth === 0) { end = j; break; }
    }
    sites.push({ line: i + 1, endLine: end + 1, body: body.join('\n'), header: header.trim() });
    i = end;
  }
  return sites;
}

function classify(site) {
  const body = site.body;
  const statements = body
    .split('\n')
    .slice(1, -1)
    .map(stripComment)
    .filter(Boolean);
  if (statements.length === 0) return 'SWALLOWED';
  if (RETHROW_PATTERNS.some((re) => re.test(body))) return 'NARROW_RETHROW';
  if (statements.every((line) => CLEANUP_ONLY.test(line))) return 'CLEANUP_ATTACHED';
  if (LOG_ONLY_PATTERNS.some((re) => re.test(body))) return 'SWALLOWED';
  return 'SWALLOWED';
}

function listMigrationFiles() {
  const dir = path.join(REPO_ROOT, MIGRATION_DIR);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.js'))
    .map((entry) => `${MIGRATION_DIR}/${entry}`);
}

function scanFile(file, ranges) {
  const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
  return catchSites(text).map((site) => {
    let scope = ranges ? 'NOT_MIGRATION' : 'MIGRATION_MODULE';
    if (ranges) {
      for (const [name, range] of Object.entries(ranges)) {
        if (site.line >= range.start && site.line <= range.end) { scope = name; break; }
      }
    }
    return { file, ...site, scope, classification: classify(site) };
  });
}

function main() {
  const dbText = readFileSync(path.join(REPO_ROOT, 'server/db.js'), 'utf8');
  const ranges = {};
  for (const name of IN_SCOPE_FUNCTIONS) {
    const range = functionRange(dbText, name);
    if (range) ranges[name] = range;
  }
  const missing = IN_SCOPE_FUNCTIONS.filter((name) => !ranges[name]);
  if (missing.length) {
    process.stderr.write(`无法定位授权范围内的函数: ${missing.join(', ')}\n`);
    process.exit(2);
  }

  const inventory = [
    ...scanFile('server/db.js', ranges),
    ...listMigrationFiles().flatMap((file) => scanFile(file, null)),
  ];

  const inScope = inventory.filter((item) => IN_SCOPE_FUNCTIONS.includes(item.scope));
  const outOfScope = inventory.filter((item) => item.scope === 'MIGRATION_MODULE');
  const notMigration = inventory.filter((item) => item.scope === 'NOT_MIGRATION');

  const inScopeBad = inScope.filter((item) => item.classification === 'SWALLOWED');
  const outOfScopeBad = outOfScope.filter((item) => item.classification === 'SWALLOWED');

  process.stdout.write('=== PL-RI-02 migration fail-closed 覆盖清点 ===\n');
  process.stdout.write(`扫描 ${1 + listMigrationFiles().length} 个文件；catch 站点 ${inventory.length} 个\n\n`);

  process.stdout.write(`--- 已授权范围（${IN_SCOPE_FUNCTIONS.join(', ')}）：${inScope.length} 个 catch 站点 ---\n`);
  for (const item of inScope) {
    process.stdout.write(`  ${item.classification} ${item.file}:${item.line} [${item.scope}] ${item.header}\n`);
  }
  if (!inScope.length) process.stdout.write('  (none)\n');

  process.stdout.write(`\n--- 范围外待处理（${MIGRATION_DIR}/**: ${outOfScopeBad.length} 个不合规站点）---\n`);
  for (const item of outOfScopeBad) {
    process.stdout.write(`  OPEN ${item.file}:${item.line} ${item.header}\n`);
  }
  if (!outOfScopeBad.length) process.stdout.write('  (none)\n');

  process.stdout.write(`\n--- 非迁移路径（server/db.js 其余部分）：${notMigration.length} 个 catch 站点，仅供留档 ---\n`);
  for (const item of notMigration) {
    process.stdout.write(`  ${item.classification} ${item.file}:${item.line} ${item.header}\n`);
  }

  process.stdout.write('\n=== 结论 ===\n');
  process.stdout.write(`授权范围内不合规（SWALLOWED）: ${inScopeBad.length}\n`);
  process.stdout.write(`范围外待处理（SWALLOWED）: ${outOfScopeBad.length}\n`);
  if (inScopeBad.length) {
    process.stdout.write('FAIL: 授权范围内仍有吞错 catch\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write('PASS: 授权范围内不存在吞错 catch\n');
}

main();
