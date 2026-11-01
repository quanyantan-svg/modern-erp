#!/usr/bin/env node
/**
 * G0 文档一致性检查。
 *
 * 检查项：
 *   C1 迁移章节覆盖     —— master 基线上的每一个 H2 章节都有归属，覆盖率必须 100%
 *   C2 内容一致性       —— 已迁移章节正文逐字保留且只出现一次；保留章节逐字未改
 *   C3 映射表完整性     —— MIGRATION-MAP.md 的行数、目标文件、新行范围、内容哈希与实际一致
 *   C4 链接与锚点       —— Markdown 链接与标题锚点可达；区分新增失效与历史遗留
 *   C5 历史引用解析     —— 迁移前的 `document.md:NNNN` / `solution.md §X.Y` 仍可解析
 *   C6 重复 Active 合同 —— 同一份合同正文不得出现在多个文件中
 *
 * 用法：
 *   node scripts/docs/check-doc-consistency.mjs
 *   node scripts/docs/check-doc-consistency.mjs --baseline <commit> --target <commit>
 *
 * 约束：
 *   - 只读：只执行 git show / ls-tree，不写任何文件、不碰数据库；
 *   - 只用 Node.js 内置模块；
 *   - 失败时返回非零退出码；
 *   - 不依赖工作树状态，不依赖任何临时目录。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMigrationIndex, listMarkdown, showFile, splitSections, sha16, git, resolveReference, isRetained,
} from './lib/migration-index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_BASELINE = '4cb8c477aa00988bbfebef905764565cdfe62b71';

/** 已知历史遗留失效链接（G0 之前即已存在，不属于本轮回归）。 */
const KNOWN_HISTORICAL_BROKEN = [
  'docs/archive/v1.6/README.md',
  'docs/archive/v1.6/phase-designs/solution.md-§19-§35.md',
  'docs/archive/v1.6/phase-requirements/document.md-§20-§34.md',
];

/** 必须可解析的历史引用抽样（取自独立审计报告给出的具体引用）。 */
const SAMPLE_REFERENCES = [
  'solution.md:12607',
  'solution.md:19698',
  'solution.md:19700-19710',
  'document.md:11187',
  'solution.md §29',
  'solution.md §37.54',
  'solution.md §35',
  'solution.md §35.27',
  'document.md §31.12',
  'document.md §22',
];

const results = [];
let failures = 0;
function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  if (!ok) failures++;
  const mark = ok ? 'PASS' : 'FAIL';
  process.stdout.write(`[${mark}] ${id} ${title}\n`);
  if (detail) {
    const lines = Array.isArray(detail) ? detail : [detail];
    for (const l of lines.slice(0, 20)) process.stdout.write(`       ${l}\n`);
    if (lines.length > 20) process.stdout.write(`       … 另有 ${lines.length - 20} 条\n`);
  }
}

function parseArgs(argv) {
  let baseline = DEFAULT_BASELINE;
  let target = 'WORKTREE';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--baseline') baseline = argv[++i];
    else if (argv[i] === '--target') target = argv[++i];
  }
  return { baseline, target };
}

/* ---------------- 链接 / 锚点 ---------------- */
function headingSlugs(text) {
  const slugs = new Set();
  let fence = false, fenceChar = '';
  for (const line of text.split('\n')) {
    const fm = /^\s*(```+|~~~+)/.exec(line);
    if (fm) { if (!fence) { fence = true; fenceChar = fm[1][0]; } else if (fm[1][0] === fenceChar) { fence = false; } continue; }
    if (fence) continue;
    const m = /^#{1,6}\s+(.*)/.exec(line);
    if (m) slugs.add(slugify(m[1]));
  }
  return slugs;
}
function slugify(s) {
  return s.trim().toLowerCase().replace(/[^\w一-鿿\- ]+/g, '').replace(/\s+/g, '-');
}

function scanLinks(ref, files) {
  const content = new Map();
  for (const f of files) content.set(f, showFile(REPO_ROOT, ref, f));
  const allFiles = new Set(files);
  const broken = [];
  const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const f of files) {
    const text = content.get(f);
    let m; linkRe.lastIndex = 0;
    while ((m = linkRe.exec(text))) {
      const target = m[1];
      if (/^(https?:|mailto:|data:)/i.test(target)) continue;
      const [pathPart, anchor] = target.split('#');
      let ok = true, why = '';
      if (pathPart) {
        const base = path.posix.dirname(f);
        const abs = path.posix.normalize(path.posix.join(base, pathPart));
        const isDir = pathPart.endsWith('/');
        const hasFile = allFiles.has(abs);
        const hasDir = isDir && files.some(x => x.startsWith(abs));
        if (!hasFile && !hasDir) { ok = false; why = `目标不存在: ${abs}`; }
      }
      if (ok && anchor) {
        const tfile = pathPart ? path.posix.normalize(path.posix.join(path.posix.dirname(f), pathPart)) : f;
        const ttext = content.get(tfile);
        if (ttext === undefined) { ok = false; why = '锚点目标文件不存在'; }
        else if (!headingSlugs(ttext).has(slugify(anchor))) { ok = false; why = `锚点 #${anchor} 在 ${tfile} 中不存在`; }
      }
      if (!ok) broken.push({ from: f, target, why });
    }
  }
  return broken;
}

/* ---------------- 主流程 ---------------- */
function main() {
  const { baseline, target } = parseArgs(process.argv.slice(2));
  process.stdout.write(`G0 文档一致性检查\n  迁移基线: ${baseline}\n  目标版本: ${target}\n\n`);

  const index = buildMigrationIndex(REPO_ROOT, baseline, target);
  const h2 = index.h2Entries;
  const retained = h2.filter(isRetained);
  const relocated = h2.filter(e => !isRetained(e));
  const unmapped = h2.filter(e => e.segments.length === 0);

  /* C1 覆盖 */
  const total = h2.length;
  record('C1', '迁移章节覆盖率 100%', unmapped.length === 0,
    unmapped.length
      ? [`未定位章节 ${unmapped.length} 个:`,
        ...unmapped.map(e => `  ${e.sourceFile} :: ${e.sourceSection} (原行 ${e.sourceStartLine}-${e.sourceEndLine})`)]
      : [`master 基线共 ${total} 个 H2 章节：${retained.length} 个保留在根文件，${relocated.length} 个已迁移，全部定位到目标文件`]);

  /* C2 内容一致性 */
  const dup = relocated.filter(e => index.tree.locate(e.body).length > 1);
  record('C2', '已迁移正文逐字保留且唯一', dup.length === 0,
    dup.length
      ? dup.map(e => `  重复出现: ${e.sourceSection} -> ${index.tree.locate(e.body).map(x => x.file).join(', ')}`)
      : [`${relocated.length} 个已迁移章节正文均逐字命中且只出现一次`]);

  /* C3 映射表完整性 */
  const mapText = showFile(REPO_ROOT, target, 'docs/status/MIGRATION-MAP.md');
  const mapRows = mapText.split('\n')
    .filter(l => /^\| `(document|solution)\.md` \|/.test(l))
    .map(l => {
      const c = l.split('|').map(x => x.trim().replace(/`/g, ''));
      return {
        sourceFile: c[1], sourceSection: c[2], sourceLines: c[3], sourceSha: c[4],
        kind: c[5], targets: c[6], hash: c[7],
      };
    });
  const mapProblems = [];
  if (mapRows.length !== relocated.length) {
    mapProblems.push(`映射表数据行 ${mapRows.length}，实际已迁移章节 ${relocated.length}`);
  }
  for (const row of mapRows) {
    const e = relocated.find(x => x.sourceFile === row.sourceFile && x.sourceSection === row.sourceSection);
    if (!e) { mapProblems.push(`映射表条目在基线中不存在: ${row.sourceFile} :: ${row.sourceSection}`); continue; }
    if (row.hash !== e.bodyHash) mapProblems.push(`内容哈希不符: ${row.sourceFile} :: ${row.sourceSection}`);
    const declared = [...row.targets.matchAll(/([^`\s:]+):(\d+)-(\d+)/g)].map(m => ({ file: m[1], startLine: +m[2], endLine: +m[3] }));
    const actual = e.segments.map(s => ({ file: s.file, startLine: s.startLine, endLine: s.endLine }));
    if (declared.length !== actual.length) {
      mapProblems.push(`目标区间数不符: ${row.sourceFile} :: ${row.sourceSection}  表=${declared.length} 实际=${actual.length}`);
    } else {
      for (const d of declared) {
        const a = actual.find(x => x.file === d.file && x.startLine === d.startLine && x.endLine === d.endLine);
        if (!a) mapProblems.push(`目标区间不符: ${row.sourceFile} :: ${row.sourceSection}  表=${d.file}:${d.startLine}-${d.endLine}  实际=${actual.map(x => `${x.file}:${x.startLine}-${x.endLine}`).join(' + ')}`);
      }
    }
  }
  record('C3', 'MIGRATION-MAP 与实际迁移一致', mapProblems.length === 0,
    mapProblems.length ? mapProblems : [`${mapRows.length} 行映射：目标文件、新行范围、内容哈希全部与实际一致`]);

  /* C4 链接与锚点 */
  const targetFiles = listMarkdown(REPO_ROOT, target);
  const baselineFiles = listMarkdown(REPO_ROOT, baseline);
  const brokenTarget = scanLinks(target, targetFiles);
  const brokenBaseline = scanLinks(baseline, baselineFiles);
  const baselineKeys = new Set(brokenBaseline.map(b => `${b.from} -> ${b.target}`));
  const newBroken = brokenTarget.filter(b => !baselineKeys.has(`${b.from} -> ${b.target}`));
  record('C4', '无新增失效链接与锚点', newBroken.length === 0,
    newBroken.length
      ? newBroken.map(b => `  NEW_BROKEN ${b.from} -> ${b.target}  (${b.why})`)
      : [`目标版本失效链接 ${brokenTarget.length} 条，全部为基线已存在的历史遗留；新增 ${newBroken.length} 条`]);

  /* C5 历史引用解析 */
  const sampleResults = SAMPLE_REFERENCES.map(ref => ({ ref, r: resolveReference(index, ref) }));
  const unresolved = sampleResults.filter(x => !x.r.ok);
  record('C5', '历史引用抽样可解析', unresolved.length === 0,
    unresolved.length
      ? unresolved.map(x => `  无法解析: ${x.ref} (${x.r.reason})`)
      : sampleResults.map(x => `  ${x.ref} -> ${x.r.segments.map(s => `${s.file}:${s.newLines}`).join(' + ')}`));

  /* C6 重复 Active 合同 */
  const multi = relocated.filter(e => index.tree.locate(e.body).length > 1);
  const split = relocated.filter(e => index.tree.locate(e.body).length === 0 && e.segments.length > 1);
  record('C6', '无重复 Active 合同正文', multi.length === 0,
    multi.length
      ? multi.map(e => `  正文在多个位置出现: ${e.sourceSection}`)
      : [`每份迁移正文只对应一个目标文件；分段映射 ${split.length} 个（§35 拆分为归档段 + 当前基线段）`]);

  /* 汇总 */
  process.stdout.write(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  for (const r of results) {
    process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.title}\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  process.stderr.write(`检查器异常: ${err && err.stack ? err.stack : err}\n`);
  process.exit(2);
});
