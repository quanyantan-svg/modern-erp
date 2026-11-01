import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const checkerSource = join(here, 'check-doc-consistency.mjs');
const dotGit = join(repoRoot, '.git');
const sourceGitDir = statSync(dotGit).isDirectory()
  ? dotGit
  : readFileSync(dotGit, 'utf8').trim().replace(/^gitdir:\s*/, '');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function runCheck(cwd, target = 'WORKTREE') {
  const result = spawnSync(
    process.execPath,
    ['scripts/docs/check-doc-consistency.mjs', '--mode', 'current', '--target', target, '--only', 'N7'],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function expectGate(result, gate, expected) {
  const line = result.output.split(/\r?\n/).find((item) => item.includes(`] ${gate} `));
  assert.ok(line, `missing ${gate} result:\n${result.output}`);
  assert.match(line, new RegExp(`^\\[${expected}\\] ${gate} `));
}

test('N7 distinguishes WORKTREE, HEAD, new files, and an explicit non-HEAD target', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'erp-doc-n7-'));
  const clone = join(tempRoot, 'repo');
  const candidate = 'docs/reviews/m1/n7-regression-candidate.md';
  const candidatePath = join(clone, ...candidate.split('/'));
  const laterCandidate = 'docs/reviews/m1/n7-later-head-only.md';
  const laterCandidatePath = join(clone, ...laterCandidate.split('/'));

  try {
    git(
      tempRoot,
      '-c', `safe.directory=${repoRoot}`,
      '-c', `safe.directory=${sourceGitDir}`,
      'clone', '--quiet', '--no-hardlinks', repoRoot, clone,
    );
    git(clone, 'config', 'user.name', 'N7 Regression');
    git(clone, 'config', 'user.email', 'n7-regression@example.invalid');

    // Execute the worktree version under test while all Git scenarios remain isolated in the clone.
    copyFileSync(checkerSource, join(clone, 'scripts', 'docs', 'check-doc-consistency.mjs'));

    const clean = runCheck(clone);
    expectGate(clean, 'N7', 'PASS');

    appendFileSync(join(clone, 'solution.md'), '\nN7 uncommitted contract change\n', 'utf8');
    const dirtyWorktree = runCheck(clone);
    expectGate(dirtyWorktree, 'N7', 'FAIL');
    assert.match(dirtyWorktree.output, /WORKTREE 含未提交或未跟踪的受治理文件变化/);

    git(clone, 'add', 'solution.md');
    git(clone, 'commit', '--quiet', '-m', 'docs: 更新 solution.md 的 N7 回归锚点');
    const legalHead = runCheck(clone, 'HEAD');
    expectGate(legalHead, 'N7', 'PASS');

    appendFileSync(join(clone, 'solution.md'), '\nN7 worktree-only marker\n', 'utf8');
    const headIgnoresWorktree = runCheck(clone, 'HEAD');
    expectGate(headIgnoresWorktree, 'N7', 'PASS');
    git(clone, 'restore', '--', 'solution.md');

    const candidateText = [
      '# N7 临时候选合同',
      '',
      '> 状态：`PENDING_REVIEW`',
      '> Owner：N7 Regression',
      '> 权威来源：测试专用临时合同',
      '> 来源 SHA：TEMP',
      '> 来源章节：§99',
      '> Implementation：`NOT_AUTHORIZED`',
      '> Design PASS：`NOT_ISSUED`',
      '',
      '## 99 N7 临时候选合同',
      '',
      '仅用于临时克隆中的 N7 回归验证。',
      '',
    ].join('\n');
    writeFileSync(candidatePath, candidateText, 'utf8');
    const untrackedNewFile = runCheck(clone);
    expectGate(untrackedNewFile, 'N7', 'FAIL');
    assert.match(untrackedNewFile.output, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    git(clone, 'add', candidate);
    git(clone, 'commit', '--quiet', '-m', 'docs: 新增 N7 临时候选合同');
    const missingPathMessage = runCheck(clone, 'HEAD');
    expectGate(missingPathMessage, 'N7', 'FAIL');
    assert.match(missingPathMessage.output, /新增受治理文件缺少提到它的提交记录/);

    appendFileSync(candidatePath, '提交信息路径验证。\n', 'utf8');
    git(clone, 'add', candidate);
    git(clone, 'commit', '--quiet', '-m', `docs: 登记 ${candidate}`);
    const validNewFile = runCheck(clone, 'HEAD');
    expectGate(validNewFile, 'N7', 'PASS');
    const nonHeadTarget = git(clone, 'rev-parse', 'HEAD');

    writeFileSync(laterCandidatePath, candidateText.replace('§99', '§100'), 'utf8');
    git(clone, 'add', laterCandidate);
    git(clone, 'commit', '--quiet', '-m', 'docs: 制造仅 HEAD 可见的新文件反例');

    const explicitTarget = runCheck(clone, nonHeadTarget);
    expectGate(explicitTarget, 'N7', 'PASS');

    const laterHead = runCheck(clone, 'HEAD');
    expectGate(laterHead, 'N7', 'FAIL');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
