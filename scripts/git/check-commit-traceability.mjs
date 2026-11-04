#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGovernedPath } from '../docs/lib/governed-paths.mjs';

export class DocsTraceError extends Error {
  constructor(message, code = 'DOCS_TRACE_INVALID') {
    super(message);
    this.name = 'DocsTraceError';
    this.code = code;
  }
}

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
}

function parseNameStatusZ(output) {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const path = fields[index++];
    if (!status || path === undefined) throw new DocsTraceError('无法解析 staged Git Diff', 'DOCS_TRACE_DIFF_INVALID');
    changes.push(Object.freeze({ status: status[0], path: path.replaceAll('\\', '/') }));
  }
  return Object.freeze(changes);
}

export function stagedChanges(repoRoot) {
  return parseNameStatusZ(git(repoRoot, [
    '-c', 'core.quotePath=false', 'diff', '--cached', '--name-status', '-z', '--no-renames', '--',
  ]));
}

export function commitChanges(repoRoot, commit) {
  const parents = git(repoRoot, ['show', '-s', '--format=%P', commit]).trim().split(/\s+/).filter(Boolean);
  if (!parents.length) throw new DocsTraceError(`提交 ${commit} 没有可比较父提交`, 'DOCS_TRACE_PARENT_REQUIRED');
  return parseNameStatusZ(git(repoRoot, [
    '-c', 'core.quotePath=false', 'diff', '--name-status', '-z', '--no-renames', parents[0], commit, '--',
  ]));
}

export function governedChanges(changes) {
  return Object.freeze(changes.filter((change) => isGovernedPath(change.path)));
}

function requiredPaths(changes) {
  const governed = governedChanges(changes);
  const deleted = governed.filter((change) => change.status === 'D');
  if (deleted.length) {
    throw new DocsTraceError(
      `受治理文件删除或 Rename 必须由正式 N7 fail closed：${deleted.map((item) => item.path).join(', ')}`,
      'DOCS_TRACE_GOVERNED_DELETE',
    );
  }
  return Object.freeze([...new Set(governed.map((change) => change.path))].sort());
}

export function docsTraceTrailers(message) {
  return Object.freeze([...String(message).matchAll(/^Docs-Trace:\s*(\S.*?)\s*$/gm)]
    .map((match) => match[1].replaceAll('\\', '/')));
}

export function prepareMessage(message, changes) {
  const required = requiredPaths(changes);
  if (!required.length) return message;
  const present = new Set(docsTraceTrailers(message));
  const missing = required.filter((path) => !present.has(path));
  if (!missing.length) return message;
  const base = String(message).replace(/\s+$/u, '');
  return `${base}\n\n${missing.map((path) => `Docs-Trace: ${path}`).join('\n')}\n`;
}

export function validateMessage(message, changes) {
  const required = requiredPaths(changes);
  const trailers = docsTraceTrailers(message);
  const unique = new Set(trailers);
  if (unique.size !== trailers.length) throw new DocsTraceError('Docs-Trace trailer 不得重复', 'DOCS_TRACE_DUPLICATE');
  const missing = required.filter((path) => !unique.has(path));
  const unrelated = trailers.filter((path) => !required.includes(path));
  if (missing.length || unrelated.length) {
    const parts = [];
    if (missing.length) parts.push(`缺少完整路径：${missing.join(', ')}`);
    if (unrelated.length) parts.push(`存在不相干或错误路径：${unrelated.join(', ')}`);
    throw new DocsTraceError(parts.join('；'), 'DOCS_TRACE_COVERAGE_MISMATCH');
  }
  return Object.freeze({ required, trailers });
}

function repoRoot() {
  return git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
}

function requiredArgument(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new DocsTraceError(`${name} 参数缺失`, 'DOCS_TRACE_ARGUMENT_REQUIRED');
  return args[index + 1];
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const root = repoRoot();
  if (command === 'prepare') {
    const messageFile = resolve(requiredArgument(args, '--message-file'));
    const prepared = prepareMessage(readFileSync(messageFile, 'utf8'), stagedChanges(root));
    writeFileSync(messageFile, prepared, 'utf8');
    return;
  }
  if (command === 'check-staged') {
    const messageFile = resolve(requiredArgument(args, '--message-file'));
    const result = validateMessage(readFileSync(messageFile, 'utf8'), stagedChanges(root));
    process.stdout.write(`Docs-Trace staged PASS (${result.required.length} governed path(s))\n`);
    return;
  }
  if (command === 'check-commit') {
    const commit = args[0] || 'HEAD';
    const message = git(root, ['show', '-s', '--format=%B', commit]);
    const result = validateMessage(message, commitChanges(root, commit));
    process.stdout.write(`Docs-Trace commit PASS ${commit} (${result.required.length} governed path(s))\n`);
    return;
  }
  throw new DocsTraceError('用法：prepare --message-file <path> | check-staged --message-file <path> | check-commit [sha]');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.code || 'DOCS_TRACE_ERROR'}: ${error.message}\n`);
    process.exit(1);
  }
}
