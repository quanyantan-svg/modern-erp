// 用户可见文案守卫（Requirement §36.22 PL-UX-01/02/08；Design §32.22.5、§32.22.8）。
//
// 目的：最终用户界面上不出现研发内部语言。
//
// 禁止的四类：
//   ① 实施批次词：Wave / Stage / Phase；
//   ② 合同编号：SC01…、PL-XX-NN、IW-XX-NN、MQ-XX-NN、AA-XX-NN、PRC-XX-NN；
//   ③ 权限码：以 `server/db.js` 的 `PERMISSIONS` 目录为准，逐个精确匹配；
//   ④ 数据库内部 ID：不作为文案解释操作 —— 由各业务页面的参照选择器承担。
//
// 判定方式：只扫描**会呈现给最终用户**的位置。位置识别由
// `scripts/qa/lib/user-visible-text.mjs` 唯一实现，源码注释、route key、
// permission code、CSS 类名、data-testid、SQL 与表名列名都不参与判定
// （Requirement §36.22 PL-UX-08：追溯注释必须保留，不得为通过本守卫而删除）。
//
// 真实业务单号、客户 / 供应商 / 货品编码不属于内部开发标识，不在禁止集内。
//
// 只读：不连数据库、不写仓库、不改任何业务数据。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectUserVisibleTexts, frontendFiles, backendFiles, root } from './lib/user-visible-text.mjs';

/** 实施批次词。`Stage` / `Phase` 只有在跟随一个批次标识（Stage C、Phase 1）时才算批次词。 */
const BATCH_WORD = /\bWave\b|\b(?:Stage|Phase)\s+[A-Z0-9]+\b/i;

/** 合同编号。 */
const CONTRACT_ID = /\bSC\d{2,3}\b|\b(?:PL|IW|MQ|AA|FO|PRC)-[A-Z]{2,4}-\d{2}\b/;

/**
 * 显式标注的技术标识符与模板插值不参与判定：中文书名号「」是既有的
 * 「这是技术标识符」标记（与界面语言守卫一致），`${...}` 是变量名。
 */
function scannable(text) {
  return String(text)
    .replace(/「[^」]*」/g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ');
}

/**
 * 权限码目录。权限码的 canonical 目录在 `server/db.js` 的 `PERMISSIONS` 里，
 * 本守卫**静态读取**该目录而不是另抄一份：抄一份就会漂移。
 */
export function permissionCodes() {
  const source = readFileSync(resolve(root, 'server', 'db.js'), 'utf8');
  const start = source.indexOf('export const PERMISSIONS = [');
  if (start < 0) throw new Error('权限码目录未找到：server/db.js 的 PERMISSIONS 声明缺失');
  const end = source.indexOf('\n];', start);
  if (end < 0) throw new Error('权限码目录未找到：server/db.js 的 PERMISSIONS 声明未闭合');
  const codes = new Set();
  for (const match of source.slice(start, end).matchAll(/\['([A-Z][A-Z0-9_]*)'/g)) codes.add(match[1]);
  if (codes.size === 0) throw new Error('权限码目录为空：静态读取失败');
  return codes;
}

/** 文本里出现的全大写标识符 token。 */
function identifierTokens(text) {
  return text.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || [];
}

/**
 * 判定一段文本里的研发内部标识。静态守卫与浏览器门禁的 DOM 断言共用这一份
 * 规则，因此两处不会出现不同的结论。
 *
 * @param {string} text
 * @param {Set<string>} permissions
 * @returns {string[]} 命中说明；空数组表示干净。
 */
export function forbiddenHits(text, permissions) {
  const scannableText = scannable(text);
  const hits = [];
  const batch = scannableText.match(BATCH_WORD);
  if (batch) hits.push(`实施批次词 ${batch[0]}`);
  const contract = scannableText.match(CONTRACT_ID);
  if (contract) hits.push(`合同编号 ${contract[0]}`);
  for (const token of identifierTokens(scannableText)) {
    if (permissions.has(token)) { hits.push(`权限码 ${token}`); break; }
  }
  return hits;
}

export function collectCopyFindings() {
  const permissions = permissionCodes();
  const findings = [];
  for (const entry of collectUserVisibleTexts()) {
    const hits = forbiddenHits(entry.text, permissions);
    if (hits.length === 0) continue;
    findings.push({ file: entry.file, line: entry.line, text: entry.text, source: entry.source, hits });
  }
  return {
    scannedFrontend: frontendFiles().length,
    scannedBackend: backendFiles().length,
    permissionCodeCount: permissions.size,
    copyFindings: findings.length,
    findings,
  };
}

function main() {
  const report = collectCopyFindings();
  process.stdout.write(`${JSON.stringify({
    scannedFrontend: report.scannedFrontend,
    scannedBackend: report.scannedBackend,
    permissionCodeCount: report.permissionCodeCount,
    copyFindings: report.copyFindings,
  }, null, 2)}\n`);

  if (report.copyFindings) {
    process.stdout.write('\n--- 用户可见的研发内部标识 ---\n');
    for (const finding of report.findings) {
      process.stdout.write(`${finding.file}:${finding.line} [${finding.source}] ${finding.hits.join('、')} — ${finding.text}\n`);
    }
    process.stdout.write(`\n用户可见文案守卫失败：${report.copyFindings} 处研发内部标识残留\n`);
    process.exit(1);
  }
  process.stdout.write('\n用户可见文案守卫 PASS：研发内部标识残留为 0\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
