#!/usr/bin/env node
/**
 * 解析迁移前的历史引用，返回其在新结构中的精确位置。
 *
 * 用法：
 *   node scripts/docs/resolve-reference.mjs "solution.md:12607"
 *   node scripts/docs/resolve-reference.mjs "solution.md §37.54.4"
 *   node scripts/docs/resolve-reference.mjs --baseline <commit> "document.md:11187"
 *
 * 只读：仅执行 git show / ls-tree，不写入任何文件。
 * 退出码：0 = 解析成功；1 = 解析失败；2 = 用法错误。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMigrationIndex, resolveReference, DEFAULT_BASELINE } from './lib/migration-index.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  let baseline = DEFAULT_BASELINE;
  let target = null;
  const refs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') { baseline = argv[++i]; continue; }
    if (a === '--target') { target = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { refs.push('--help'); continue; }
    refs.push(a);
  }
  return { baseline, target, refs };
}

function main() {
  const { baseline, target, refs } = parseArgs(process.argv.slice(2));
  if (!refs.length || refs.includes('--help')) {
    process.stdout.write([
      '用法: node scripts/docs/resolve-reference.mjs [--baseline <commit>] [--target <commit>] "<引用>" [...]',
      '',
      '示例:',
      '  node scripts/docs/resolve-reference.mjs "solution.md:12607"',
      '  node scripts/docs/resolve-reference.mjs "solution.md §37.54.4"',
      '',
    ].join('\n'));
    process.exit(refs.length ? 0 : 2);
  }

  const targetRef = target || process.env.G0_TARGET_REF || 'WORKTREE';
  const index = buildMigrationIndex(REPO_ROOT, baseline, targetRef);
  let failures = 0;

  for (const ref of refs) {
    const r = resolveReference(index, ref);
    if (!r.ok) {
      failures++;
      process.stdout.write(`UNRESOLVED  ${ref}\n  原因: ${r.reason}\n`);
      continue;
    }
    process.stdout.write(`RESOLVED    ${ref}\n`);
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
  }

  process.exit(failures ? 1 : 0);
}

main();
