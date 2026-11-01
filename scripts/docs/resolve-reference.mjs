#!/usr/bin/env node
/**
 * 解析迁移前的历史引用，返回其在新结构中的位置。
 *
 * 两种解析精度：
 *   - **精确（exact）**：章节正文**逐字未改**时，给出当前文件与当前行区间；
 *   - **结构（structural）**：以「章节号 + 标题」为锚定位，正文被合法修改后**仍然可追溯**。
 *
 * 默认先尝试精确解析，失败时自动回退到结构解析，并标注精度。
 *
 * 用法：
 *   node scripts/docs/resolve-reference.mjs "solution.md:12607"
 *   node scripts/docs/resolve-reference.mjs "solution.md §37.54.4"
 *   node scripts/docs/resolve-reference.mjs --structural "document.md §31.12"
 *   node scripts/docs/resolve-reference.mjs --baseline <commit> "document.md:11187"
 *   node scripts/docs/resolve-reference.mjs --target HEAD "<引用>"
 *
 * 只读：仅执行 git show / ls-tree / ls-files，不写入任何文件。
 * 退出码：0 = 解析成功；1 = 解析失败；2 = 用法错误。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMigrationIndex, resolveReference, splitSections, showFile, DEFAULT_BASELINE } from './lib/migration-index.mjs';
import { buildCurrentIndex, resolveStructural } from './lib/current-index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  let baseline = DEFAULT_BASELINE;
  let target = null;
  let structuralOnly = false;
  const refs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') { baseline = argv[++i]; continue; }
    if (a === '--target') { target = argv[++i]; continue; }
    if (a === '--structural') { structuralOnly = true; continue; }
    if (a === '--help' || a === '-h') { refs.push('--help'); continue; }
    refs.push(a);
  }
  return { baseline, target, structuralOnly, refs };
}

/** 从基线正文中定位引用所属的最深章节。 */
function baselineOwner(baseline, ref) {
  const lineM = /^(document|solution)\.md[:：](\d+)(?:\s*[-–]\s*(\d+))?$/.exec(ref.trim());
  const secM = /^(document|solution)\.md\s*§\s*(\d+(?:\.\d+)*)$/.exec(ref.trim());
  let file = null;
  let owner = null;
  const sections = file => splitSections(showFile(REPO_ROOT, baseline, file), { mode: 'all' }).sections;
  if (lineM) {
    file = `${lineM[1]}.md`;
    const line = parseInt(lineM[2], 10);
    const containing = sections(file).filter(s => line >= s.startLine && line <= s.endLine);
    if (containing.length) {
      const maxDepth = Math.max(...containing.map(s => s.depth));
      owner = containing.filter(s => s.depth === maxDepth)
        .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0];
    }
  } else if (secM) {
    file = `${secM[1]}.md`;
    const id = secM[2];
    const exact = sections(file).filter(s => s.sectionId === id);
    owner = exact.length ? exact[exact.length - 1] : null;
    if (!owner) {
      const loose = sections(file).filter(s => s.sectionId && s.sectionId.startsWith(id + '.'));
      owner = loose.length ? loose[0] : null;
    }
  }
  return owner ? { file, owner } : null;
}

function main() {
  const { baseline, target, structuralOnly, refs } = parseArgs(process.argv.slice(2));
  if (!refs.length || refs.includes('--help')) {
    process.stdout.write([
      '用法: node scripts/docs/resolve-reference.mjs [--baseline <commit>] [--target <commit>] [--structural] "<引用>" [...]',
      '',
      '示例:',
      '  node scripts/docs/resolve-reference.mjs "solution.md:12607"',
      '  node scripts/docs/resolve-reference.mjs "solution.md §37.54.4"',
      '  node scripts/docs/resolve-reference.mjs --structural "document.md §31.12"',
      '',
    ].join('\n'));
    process.exit(refs.length ? 0 : 2);
  }

  const targetRef = target || process.env.G0_TARGET_REF || 'WORKTREE';
  const index = buildMigrationIndex(REPO_ROOT, baseline, targetRef);
  const cur = buildCurrentIndex(REPO_ROOT, targetRef);
  let failures = 0;

  for (const ref of refs) {
    let done = false;

    if (!structuralOnly) {
      const r = resolveReference(index, ref);
      if (r.ok) {
        process.stdout.write(`RESOLVED    ${ref}\n`);
        process.stdout.write(`  精度       精确（章节正文逐字未改）\n`);
        process.stdout.write(`  原始章节   ${r.sourceFile} §${r.sourceSectionId ?? '(无编号)'} — ${r.sourceSection}\n`);
        process.stdout.write(`  原始行范围 ${r.sourceLines}（基线 ${r.baselineRef.slice(0, 12)}）\n`);
        for (const s of r.segments) {
          process.stdout.write(`  → ${s.file}:${s.newLines}  [${s.segment}]`);
          if (s.covers === true) process.stdout.write('  ← 引用落在本段内');
          else if (s.covers === false) process.stdout.write('  (引用不在本段内)');
          process.stdout.write('\n');
        }
        if (r.candidates) process.stdout.write(`  候选章节   ${r.candidates.join(', ')}\n`);
        process.stdout.write('\n');
        done = true;
      }
    }

    if (!done) {
      const base = baselineOwner(baseline, ref);
      if (!base) {
        failures++;
        process.stdout.write(`UNRESOLVED  ${ref}\n  原因: 无法在基线中定位该引用\n\n`);
        continue;
      }
      const s = resolveStructural(cur, {
        file: base.file,
        sectionId: base.owner.sectionId,
        title: base.owner.title,
      });
      if (!s.ok) {
        failures++;
        process.stdout.write(`UNRESOLVED  ${ref}\n  原因: 当前结构中已无法定位（基线 §${base.owner.sectionId}）\n\n`);
        continue;
      }
      process.stdout.write(`RESOLVED    ${ref}\n`);
      process.stdout.write(`  精度       结构（章节号 + 标题锚定；正文可能已被合法修改）\n`);
      process.stdout.write(`  原始章节   ${base.file} §${base.owner.sectionId ?? '(无编号)'} — ${base.owner.title}\n`);
      process.stdout.write(`  原始行范围 ${base.owner.startLine}-${base.owner.endLine}（基线 ${baseline.slice(0, 12)}）\n`);
      for (const h of s.hits) {
        process.stdout.write(`  → ${h.file} §${h.id}:${h.startLine}-${h.endLine}  — ${h.title}\n`);
      }
      if (s.precision === 'id') {
        process.stdout.write('  注: 标题已漂移，按章节号定位\n');
      } else if (s.precision === 'ambiguous') {
        process.stdout.write('  注: 章节号在当前结构中有多处命中，全部列出\n');
      }
      process.stdout.write('\n');
    }
  }

  process.exit(failures ? 1 : 0);
}

main();
