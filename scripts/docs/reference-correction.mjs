#!/usr/bin/env node
/**
 * 历史引用纠错登记辅助工具（DOC-REF-CORR-01）。
 *
 * 用途：为 `docs/acceptance/document-reference-corrections.md` 的登记行生成
 * **可复算**的「原行内容哈希」，并同时打印该行上的相对链接目标。
 * 只读：不修改任何仓库文件、数据库或 Git 状态。
 *
 * 用法：
 *   node scripts/docs/reference-correction.mjs --file log/2026-11-14.md --line 1387
 *   node scripts/docs/reference-correction.mjs --file log/2026-11-14.md --target "../../docs/status/PROJECT_STATUS.md"
 *
 * 退出码：0 成功；1 未找到匹配行；2 用法错误。
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashLine } from './lib/reference-corrections.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function parseArgs(argv) {
  const args = { file: null, line: null, target: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--line') args.line = argv[++i];
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') return null;
  }
  return args;
}

function usage() {
  process.stderr.write('用法: node scripts/docs/reference-correction.mjs --file <path> [--line <n> | --target <link>]\n');
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (!args || !args.file) usage();
if (args.line === null && args.target === null) usage();

const abs = path.join(REPO_ROOT, args.file);
if (!existsSync(abs)) {
  process.stderr.write(`文件不存在: ${args.file}\n`);
  process.exit(2);
}
const text = readFileSync(abs, 'utf8').replace(/\r/g, '');
const lines = text.split('\n');

/** 收集某一行的链接目标。 */
function targetsOfLine(lineText) {
  const out = [];
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(lineText))) out.push(m[1]);
  return out;
}

const matches = [];
if (args.line !== null) {
  const lineNo = Number(args.line);
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lines.length) {
    process.stderr.write(`行号超出范围: ${args.line}（文件共 ${lines.length} 行）\n`);
    process.exit(2);
  }
  matches.push(lineNo);
} else {
  for (let i = 0; i < lines.length; i++) {
    if (targetsOfLine(lines[i]).includes(args.target)) matches.push(i + 1);
  }
}

if (!matches.length) {
  process.stderr.write('未找到匹配行\n');
  process.exit(1);
}

for (const lineNo of matches) {
  const line = lines[lineNo - 1];
  process.stdout.write(`file: ${args.file}\n`);
  process.stdout.write(`line: ${lineNo}\n`);
  process.stdout.write(`hash: ${hashLine(line)}\n`);
  const targets = targetsOfLine(line);
  if (targets.length) {
    process.stdout.write('targets:\n');
    for (const t of targets) process.stdout.write(`  - ${t}\n`);
  } else {
    process.stdout.write('targets: (none)\n');
  }
  process.stdout.write('\n');
}
