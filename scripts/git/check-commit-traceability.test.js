import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function run(cwd, file, args, expected = 0) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'erp-docs-trace-'));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'Docs Trace Test');
  git(root, 'config', 'user.email', 'docs-trace@example.invalid');
  git(root, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(root, 'docs', 'status'), { recursive: true });
  mkdirSync(join(root, 'docs', 'reviews'), { recursive: true });
  writeFileSync(join(root, 'solution.md'), '# Solution\n\n> Owner: test\n\n## 1 Base\n\nbase\n');
  writeFileSync(join(root, 'document.md'), '# Document\n\n## 1 Base\n\nbase\n');
  writeFileSync(join(root, 'docs', 'status', 'PROJECT_STATUS.md'), '# Status\n\n## 1 Base\n\nbase\n');
  writeFileSync(join(root, 'source.js'), 'export const value = 1;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', '建立测试基线');

  mkdirSync(join(root, 'scripts', 'git'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'docs', 'lib'), { recursive: true });
  mkdirSync(join(root, '.githooks'), { recursive: true });
  cpSync(join(repoRoot, 'scripts', 'git', 'check-commit-traceability.mjs'), join(root, 'scripts', 'git', 'check-commit-traceability.mjs'));
  cpSync(join(repoRoot, 'scripts', 'docs', 'lib', 'governed-paths.mjs'), join(root, 'scripts', 'docs', 'lib', 'governed-paths.mjs'));
  for (const hook of ['prepare-commit-msg', 'commit-msg']) {
    const target = join(root, '.githooks', hook);
    cpSync(join(repoRoot, '.githooks', hook), target);
    chmodSync(target, 0o755);
  }
  git(root, 'config', 'core.hooksPath', '.githooks');
  return root;
}

test('Docs-Trace hooks auto-cover one, multiple, metadata, new-file and consecutive governed commits', () => {
  const root = setup();
  try {
    writeFileSync(join(root, 'solution.md'), `${readFileSync(join(root, 'solution.md'), 'utf8')}\n## 2 One\n\none\n`);
    git(root, 'add', 'solution.md');
    git(root, 'commit', '--quiet', '-m', '登记单文档变化');
    assert.match(git(root, 'show', '-s', '--format=%B', 'HEAD'), /^Docs-Trace: solution\.md$/m);

    writeFileSync(join(root, 'document.md'), `${readFileSync(join(root, 'document.md'), 'utf8')}\n## 2 Two\n\ntwo\n`);
    writeFileSync(join(root, 'docs', 'status', 'PROJECT_STATUS.md'), `${readFileSync(join(root, 'docs', 'status', 'PROJECT_STATUS.md'), 'utf8')}\n## 2 Two\n\ntwo\n`);
    git(root, 'add', 'document.md', 'docs/status/PROJECT_STATUS.md');
    git(root, 'commit', '--quiet', '-m', '登记多文档变化');
    const multi = git(root, 'show', '-s', '--format=%B', 'HEAD');
    assert.match(multi, /^Docs-Trace: document\.md$/m);
    assert.match(multi, /^Docs-Trace: docs\/status\/PROJECT_STATUS\.md$/m);

    writeFileSync(join(root, 'solution.md'), readFileSync(join(root, 'solution.md'), 'utf8').replace('> Owner: test', '> Owner: metadata-test'));
    git(root, 'add', 'solution.md');
    git(root, 'commit', '--quiet', '-m', '修改文档头部元数据');
    assert.match(git(root, 'show', '-s', '--format=%B', 'HEAD'), /^Docs-Trace: solution\.md$/m);

    writeFileSync(join(root, 'docs', 'reviews', 'new.md'), '# Review\n\n> 状态：PENDING\n');
    git(root, 'add', 'docs/reviews/new.md');
    git(root, 'commit', '--quiet', '--no-verify', '-m', '新增候选文档');
    assert.match(git(root, 'show', '-s', '--format=%B', 'HEAD'), /^Docs-Trace: docs\/reviews\/new\.md$/m,
      'prepare-commit-msg remains the automatic layer even when commit-msg is skipped');

    run(root, join(root, 'scripts', 'git', 'check-commit-traceability.mjs'), ['check-commit', 'HEAD']);
    writeFileSync(join(root, 'solution.md'), `${readFileSync(join(root, 'solution.md'), 'utf8')}\n## 3 Consecutive\n\nnext\n`);
    git(root, 'add', 'solution.md');
    git(root, 'commit', '--quiet', '-m', '连续合法提交');
    run(root, join(root, 'scripts', 'git', 'check-commit-traceability.mjs'), ['check-commit', 'HEAD']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('independent checker rejects missing, wrong, unrelated, duplicate and governed delete/rename traces', () => {
  const root = setup();
  try {
    const checker = join(root, 'scripts', 'git', 'check-commit-traceability.mjs');
    writeFileSync(join(root, 'solution.md'), `${readFileSync(join(root, 'solution.md'), 'utf8')}\n## 2 Changed\n\nchanged\n`);
    git(root, 'add', 'solution.md');
    const message = join(root, 'message.txt');
    for (const body of [
      '缺失路径\n',
      '错误路径\n\nDocs-Trace: docs/design/wrong.md\n',
      '仅测试结果\n\nTests: PASS\n',
      '重复\n\nDocs-Trace: solution.md\nDocs-Trace: solution.md\n',
    ]) {
      writeFileSync(message, body);
      run(root, checker, ['check-staged', '--message-file', message], 1);
    }
    writeFileSync(message, '合法\n\nDocs-Trace: solution.md\n');
    run(root, checker, ['check-staged', '--message-file', message]);

    git(root, 'reset', '--hard', 'HEAD');
    git(root, 'mv', 'solution.md', 'docs/reviews/moved.md');
    writeFileSync(message, '移动\n\nDocs-Trace: solution.md\nDocs-Trace: docs/reviews/moved.md\n');
    run(root, checker, ['check-staged', '--message-file', message], 1);
    git(root, 'reset', '--hard', 'HEAD');

    writeFileSync(join(root, 'source.js'), 'export const value = 2;\n');
    git(root, 'add', 'source.js');
    writeFileSync(message, '普通源码变化\n');
    run(root, checker, ['check-staged', '--message-file', message]);
    git(root, 'commit', '--quiet', '-m', '普通源码变化');
    assert.doesNotMatch(git(root, 'show', '-s', '--format=%B', 'HEAD'), /Docs-Trace:/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
