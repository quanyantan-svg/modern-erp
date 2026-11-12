// 验收记录有效性复核（2026-11-12）
//
// 背景：域级验收审计发现，Planning 域 2026-10-08 的 "Final Acceptance: PASS"
// 记录在仓库里没有签发记录、没有机器可读 token，其浏览器证据已因之后的界面
// 改动失效，其 MySQL 证据在当前门禁基础设施下不可复现。一个**历史已验收**
// 的结论可以长期停留在文档里而不被任何人发现已经不成立。
//
// 本脚本把「历史验收记录在当前 HEAD 上是否仍然成立」变成机器可验证的清单：
//
//   1. 每份验收记录提取它引用的仓库路径（实现路径 / 合同路径）。
//   2. 引用路径解析：先按原样找；再按同名不同扩展名找（.js / .jsx / .mjs /
//      .ts / .tsx / .json）；再按**全仓同名文件**找（路径搬迁）。三步都找不到
//      → BROKEN（证据指针彻底断了），FAIL。
//   3. 引用路径只因扩展名或位置变化而失效 → 必须在下面的 POINTER_RESOLUTIONS
//      登记表里登记它的当前位置；未登记 → RELOCATED_UNRESOLVED，FAIL。
//   4. 引用的**实现路径**在该记录之后被改动 → NEEDS_REVIEW（该记录的代码
//      证据可能已失效，需要人工复核）。
//   5. 引用的**合同路径**在该记录之后被改动 → NEEDS_REVIEW（它冻结的合同已变）。
//   6. 其余 → CURRENT。
//
// 登记表的每一条都由
// `docs/acceptance/acceptance-record-revalidation-20261112.md` 背书；本脚本不
// 自行判断「结论是否仍成立」，只保证指针不悬空、不静默漂移。
//
// 用法：node scripts/qa/verify-acceptance-records.mjs
// 只读：只做 git 查询与文件读取，不写任何文件、不碰数据库。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.md', '.sql', '.css', '.ps1'];

// 已登记的指针解析：历史记录里的旧路径 → 它的当前位置。
// 每一条都必须由 acceptance-record-revalidation-20261112.md 背书。
const POINTER_RESOLUTIONS = {
  'src/pages/accounting-analytics.js': 'src/pages/accounting-analytics.jsx',
  'src/pages/accounting.js': 'src/pages/accounting.jsx',
  'src/pages/fixed-assets.js': 'src/pages/fixed-assets.jsx',
  'src/components/ui.js': 'src/components/ui.jsx',
  'src/pages/outsourcing.js': 'src/pages/outsourcing.jsx',
  'src/pages/logistics-finance.js': 'src/pages/logistics-finance.jsx',
  'src/pages/credit-query.js': 'src/pages/credit-query.jsx',
  'src/pages/sales-pricing.js': 'src/pages/sales-pricing.jsx',
  'src/pages/credit-check.js': 'src/pages/credit-check.jsx',
  'src/pages/wave8-sales.js': 'src/pages/wave8-sales.jsx',
  'src/pages/sourcing-pricing.js': 'src/pages/sourcing-pricing.jsx',
  'server/tests/m1-core-g07-http-fixture-builder.js': 'server/test-support/m1-core-g07-http-fixture-builder.js',
  'docs/evidence/sales-customer-batch-a/browser-acceptance.js': 'docs/evidence/sales-customer-batch-a/browser-acceptance.json',
};

// 记录中被**明确说明为不存在**的路径（负向引用），不是断掉的指针。
const NEGATIVE_REFERENCES = new Set([
  // 记录中明确说明「不存在」或「已删除」的路径：它们是历史事实的引用，不是断掉的指针。
  'src/pages/returns.js',
  'server/modules/planning-reservation.js',
  'server/modules/finance-manual-ar-ap.js',
]);

function git(args) {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

// 一次性把「路径 -> 最后提交时间」与「sha -> 提交时间」建好，避免逐路径调用
// git（逐路径调用会让本检查耗时 30 秒以上，不适合进门禁）。
const lastChangeByPath = new Map();
{
  const output = git(['log', '--format=%cI', '--name-only', '--no-renames']);
  let current = null;
  for (const line of output.split('\n')) {
    const stamp = line.match(/^\d{4}-\d{2}-\d{2}T/);
    if (stamp) { current = line; continue; }
    const path = line.trim();
    if (!path || !current) continue;
    if (!lastChangeByPath.has(path)) lastChangeByPath.set(path, current);
  }
}
const commitDateBySha = new Map();
{
  const output = git(['log', '--format=%H %cI']);
  for (const line of output.split('\n')) {
    const match = line.match(/^([0-9a-f]{40})\s+(\S+)/);
    if (match && !commitDateBySha.has(match[1])) commitDateBySha.set(match[1], match[2]);
  }
}

const lastChangeDate = (path) => lastChangeByPath.get(path) || null;
const commitDate = (sha) => commitDateBySha.get(sha) || null;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'coverage', '.git', '.tmp'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const repoFiles = walk(ROOT).map((file) => relative(ROOT, file).split(sep).join('/'));
const byBaseName = new Map();
for (const file of repoFiles) {
  const name = basename(file);
  if (!byBaseName.has(name)) byBaseName.set(name, []);
  byBaseName.get(name).push(file);
}

function resolveReference(referenced) {
  if (existsSync(join(ROOT, referenced))) return { kind: 'EXACT', current: referenced };
  const stem = referenced.replace(/\.[a-z]+$/, '');
  for (const extension of EXTENSIONS) {
    const candidate = `${stem}${extension}`;
    if (existsSync(join(ROOT, candidate))) return { kind: 'EXTENSION', current: candidate };
  }
  const name = basename(referenced);
  const matches = byBaseName.get(name) || [];
  if (matches.length === 1) return { kind: 'RELOCATED', current: matches[0] };
  return { kind: 'BROKEN', current: null };
}

const PATH_RE = /(?:server|src|scripts|docs)\/[A-Za-z0-9_\-./一-龥()（）]*\.(?:js|jsx|mjs|ts|tsx|sql|md|css|ps1|json)/g;
const ANCHOR_RE = /(?:实现锚点|锚点|anchor)\s*[`（(]?\s*([0-9a-f]{7,40})\b/gi;

function listRecords(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listRecords(full, out);
    else if (entry.endsWith('.md') && entry !== 'README.md') out.push(full);
  }
  return out;
}

const rows = [];
for (const file of listRecords(join(ROOT, 'docs/acceptance'))) {
  const posixPath = relative(ROOT, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const referenced = [...new Set(text.match(PATH_RE) || [])].filter((p) => !p.includes('*')).sort();

  let anchorDate = lastChangeDate(posixPath);
  let anchorSha = null;
  for (const match of text.matchAll(ANCHOR_RE)) {
    const date = commitDate(match[1]);
    if (date) { anchorSha = match[1]; anchorDate = date; break; }
  }

  const broken = [];
  const relocated = [];
  const staleImpl = [];
  const staleContract = [];

  for (const referencedPath of referenced) {
    if (NEGATIVE_REFERENCES.has(referencedPath)) continue;
    let resolution = resolveReference(referencedPath);
    if (resolution.kind === 'BROKEN' && POINTER_RESOLUTIONS[referencedPath]) {
      const current = POINTER_RESOLUTIONS[referencedPath];
      if (existsSync(join(ROOT, current))) resolution = { kind: 'REGISTERED', current };
    }
    if (resolution.kind === 'BROKEN') { broken.push(referencedPath); continue; }
    if (resolution.kind === 'RELOCATED' && !POINTER_RESOLUTIONS[referencedPath]) {
      relocated.push(`${referencedPath} -> ${resolution.current}`);
    }
    const current = resolution.current || referencedPath;
    if (!anchorDate) continue;
    const changed = lastChangeDate(current);
    if (!changed || changed <= anchorDate) continue;
    if (current.startsWith('docs/requirements/') || current.startsWith('docs/design/')) staleContract.push(current);
    else if (!current.startsWith('docs/')) staleImpl.push(current);
  }

  const verdict = broken.length ? 'BROKEN'
    : relocated.length ? 'RELOCATED_UNRESOLVED'
      : staleImpl.length || staleContract.length ? 'NEEDS_REVIEW'
        : 'CURRENT';
  rows.push({
    record: posixPath,
    anchor: anchorSha || posixPath,
    anchorDate: anchorDate ? anchorDate.slice(0, 10) : '—',
    referenced: referenced.length,
    broken, relocated, staleImpl, staleContract, verdict,
  });
}

const order = { BROKEN: 0, RELOCATED_UNRESOLVED: 1, NEEDS_REVIEW: 2, CURRENT: 3 };
rows.sort((a, b) => order[a.verdict] - order[b.verdict] || a.record.localeCompare(b.record));

console.log('=== 验收记录当前有效性复核 ===');
console.log('锚点时间 = 记录自身最后提交时间，或记录中声明的实现锚点提交时间\n');
for (const row of rows) {
  console.log(`[${row.verdict}] ${row.record}`);
  console.log(`    锚点 ${row.anchor}（${row.anchorDate}） · 引用路径 ${row.referenced}`);
  if (row.broken.length) console.log(`    BROKEN（引用彻底不存在）: ${row.broken.join(', ')}`);
  if (row.relocated.length) console.log(`    指针已漂移且未登记: ${row.relocated.join(', ')}`);
  if (row.staleImpl.length) console.log(`    实现路径在记录之后被改动: ${row.staleImpl.join(', ')}`);
  if (row.staleContract.length) console.log(`    合同路径在记录之后被改动: ${row.staleContract.join(', ')}`);
}

const broken = rows.filter((r) => r.verdict === 'BROKEN');
const relocated = rows.filter((r) => r.verdict === 'RELOCATED_UNRESOLVED');
const review = rows.filter((r) => r.verdict === 'NEEDS_REVIEW');
console.log('\n=== 结论 ===');
console.log(`  记录 ${rows.length} 份：CURRENT ${rows.length - broken.length - relocated.length - review.length} / NEEDS_REVIEW ${review.length} / RELOCATED_UNRESOLVED ${relocated.length} / BROKEN ${broken.length}`);
if (broken.length || relocated.length) {
  console.log('\n  FAIL：存在悬空或未登记漂移的证据指针。');
  console.log('  处置：在 POINTER_RESOLUTIONS 登记该路径的当前位置（须由');
  console.log('        docs/acceptance/acceptance-record-revalidation-20261112.md 背书），');
  console.log('        或在记录中修正该指针。');
  process.exit(1);
}
console.log('\n  PASS：没有悬空或未登记漂移的证据指针。');
console.log('  NOTE：NEEDS_REVIEW 的记录需要人工复核其结论是否仍然成立；该判定不自动改写任何已签发结论。');
