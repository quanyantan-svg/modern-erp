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
const indexSource = join(here, 'lib', 'current-index.mjs');
const dotGit = join(repoRoot, '.git');
const sourceGitDir = statSync(dotGit).isDirectory()
  ? dotGit
  : readFileSync(dotGit, 'utf8').trim().replace(/^gitdir:\s*/, '');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function runCheck(cwd, target = 'WORKTREE') {
  const args = ['scripts/docs/check-doc-consistency.mjs', '--mode', 'current', '--target', target, '--only', 'N7'];
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
    command: `node ${args.join(' ')}`,
  };
}

function expectGate(result, gate, expected) {
  assert.equal(result.error, undefined, `spawn error: ${result.error}`);
  assert.equal(result.signal, null, `terminated by signal: ${result.signal}`);
  const expectedStatus = expected === 'PASS' ? 0 : 1;
  assert.equal(result.status, expectedStatus,
    `${gate} ${expected} must exit ${expectedStatus}, got ${result.status}:\n${result.output}`);
  const line = result.output.split(/\r?\n/).find((item) => item.includes(`] ${gate} `));
  assert.ok(line, `missing ${gate} result:\n${result.output}`);
  assert.match(line, new RegExp(`^\\[${expected}\\] ${gate} `));
}

function candidateText(id = '99') {
  return [
    '# N7 临时候选合同', '',
    '> 状态：`PENDING_REVIEW`',
    '> Owner：N7 Regression',
    '> 权威来源：测试专用临时合同',
    '> 来源 SHA：TEMP',
    `> 来源章节：§${id}`,
    '> Implementation：`NOT_AUTHORIZED`',
    '> Design PASS：`NOT_ISSUED`', '',
    `## ${id} N7 临时候选合同`, '',
    '仅用于临时克隆中的 N7 回归验证。', '',
  ].join('\n');
}

test('N7 adversarial matrix T01-T26', { timeout: 15 * 60 * 1000 }, () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'erp-doc-n7-'));
  const clone = join(tempRoot, 'repo');
  const results = [];

  try {
    git(tempRoot, '-c', `safe.directory=${repoRoot}`, '-c', `safe.directory=${sourceGitDir}`,
      'clone', '--quiet', '--no-hardlinks', repoRoot, clone);
    git(clone, 'config', 'user.name', 'N7 Regression');
    git(clone, 'config', 'user.email', 'n7-regression@example.invalid');
    copyFileSync(checkerSource, join(clone, 'scripts', 'docs', 'check-doc-consistency.mjs'));
    copyFileSync(indexSource, join(clone, 'scripts', 'docs', 'lib', 'current-index.mjs'));
    git(clone, 'add', 'scripts/docs/check-doc-consistency.mjs', 'scripts/docs/lib/current-index.mjs');
    git(clone, 'commit', '--quiet', '-m', 'test: install N7 test implementation');
    const base = git(clone, 'rev-parse', 'HEAD');

    const reset = () => {
      assert.ok(resolve(clone).startsWith(resolve(tempRoot)), 'destructive reset must stay in temp clone');
      git(clone, 'reset', '--hard', base);
      git(clone, 'clean', '-fd');
    };
    const addSections = (...ids) => appendFileSync(join(clone, 'solution.md'),
      ids.map(id => `\n## ${id} N7 regression section\n\ncontent ${id}\n`).join(''), 'utf8');
    const commit = (message, ...files) => {
      assert.ok(files.length > 0, 'scenario commit must declare its intended files');
      git(clone, 'add', '-A');
      git(clone, 'commit', '--quiet', '-m', message);
      return git(clone, 'rev-parse', 'HEAD');
    };
    const run = (id, input, expected, target = 'WORKTREE') => {
      const actual = runCheck(clone, target);
      expectGate(actual, 'N7', expected);
      results.push({ id, input, command: actual.command, expected, actual: expected, exit: actual.status });
      return actual;
    };

    reset(); run('T01', 'clean temporary Git clone', 'PASS');
    reset(); addSections('901'); run('T02', 'unstaged solution.md contract change', 'FAIL');
    reset(); addSections('901'); git(clone, 'add', 'solution.md'); run('T03', 'staged solution.md contract change', 'FAIL');

    reset();
    writeFileSync(join(clone, 'docs', 'reviews', 'n7-untracked.md'), candidateText(), 'utf8');
    run('T04', 'untracked governed review file', 'FAIL');

    reset(); addSections('901'); commit('docs: update §901', 'solution.md');
    run('T05', 'legal section commit references §901', 'PASS', 'HEAD');
    reset(); addSections('901'); commit('docs: update contract', 'solution.md');
    run('T06', 'illegal section commit lacks ID and path', 'FAIL', 'HEAD');

    reset(); addSections('901'); commit('docs: update §901', 'solution.md');
    appendFileSync(join(clone, 'solution.md'), '\nsecond change\n', 'utf8');
    commit('docs: second change without trace', 'solution.md');
    appendFileSync(join(clone, 'solution.md'), '\nthird change\n', 'utf8');
    commit('docs: update §901 a third time', 'solution.md');
    run('T07', 'three commits; middle commit is illegal', 'FAIL', 'HEAD');

    reset(); addSections('901'); commit('docs: update §901', 'solution.md');
    appendFileSync(join(clone, 'solution.md'), '\nsecond change\n', 'utf8');
    commit('docs: update §901 again', 'solution.md');
    run('T08', 'multiple commits; every commit is legal', 'PASS', 'HEAD');

    reset(); addSections('901', '902'); commit('docs: update §901', 'solution.md');
    run('T09', 'one commit changes §901 and §902 but mentions only §901', 'FAIL', 'HEAD');
    reset(); addSections('901', '902'); commit('docs: update solution.md', 'solution.md');
    run('T10', 'multi-section commit references exact root-relative path', 'PASS', 'HEAD');

    reset();
    appendFileSync(join(clone, 'docs', 'status', 'PROJECT_STATUS.md'), '\n## 900 N7 regression\n\ncontent\n', 'utf8');
    commit('docs: update PROJECT_STATUS.md', 'docs/status/PROJECT_STATUS.md');
    run('T11', 'basename-only reference for nested governed file', 'FAIL', 'HEAD');
    reset();
    const metaText = readFileSync(join(clone, 'docs', 'status', 'PROJECT_STATUS.md'), 'utf8');
    writeFileSync(join(clone, 'docs', 'status', 'PROJECT_STATUS.md'), metaText.replace(/^# /, '# N7 metadata change '), 'utf8');
    commit('docs: update §36', 'docs/status/PROJECT_STATUS.md');
    expectGate(runCheck(clone, 'HEAD'), 'N7', 'FAIL');

    const newReview = 'docs/reviews/n7-new.md';
    reset(); writeFileSync(join(clone, ...newReview.split('/')), candidateText(), 'utf8');
    run('T12', 'new governed file remains uncommitted', 'FAIL');
    reset(); writeFileSync(join(clone, ...newReview.split('/')), candidateText(), 'utf8');
    commit('docs: add n7-new.md', newReview);
    run('T13', 'new file commit lacks exact full path', 'FAIL', 'HEAD');
    reset(); writeFileSync(join(clone, ...newReview.split('/')), candidateText(), 'utf8');
    commit(`docs: add ${newReview}`, newReview);
    run('T14', 'new file commit contains exact full path', 'PASS', 'HEAD');

    reset(); git(clone, 'rm', '--quiet', 'solution.md');
    expectGate(runCheck(clone), 'N7', 'FAIL');
    commit('docs: delete solution.md', 'solution.md');
    run('T15', 'delete whole fixed governed file', 'FAIL', 'HEAD');
    reset(); git(clone, 'rm', '--quiet', 'docs/reviews/m1/procurement-outsourcing-critical-chain-design.md');
    commit('docs: delete review', 'docs/reviews/m1/procurement-outsourcing-critical-chain-design.md');
    run('T16', 'delete whole Review file', 'FAIL', 'HEAD');
    reset(); git(clone, 'rm', '--quiet', 'docs/requirements/procurement-outsourcing.md');
    commit('docs: delete requirement', 'docs/requirements/procurement-outsourcing.md');
    run('T17', 'delete whole active Requirement file', 'FAIL', 'HEAD');
    reset(); git(clone, 'rm', '--quiet', 'docs/design/procurement-outsourcing.md');
    commit('docs: delete design', 'docs/design/procurement-outsourcing.md');
    run('T18', 'delete whole active Design file', 'FAIL', 'HEAD');

    reset(); addSections('901'); commit('docs: add §901', 'solution.md');
    let text = readFileSync(join(clone, 'solution.md'), 'utf8');
    writeFileSync(join(clone, 'solution.md'), text.replace('\n## 901 N7 regression section\n\ncontent 901\n', ''), 'utf8');
    commit('docs: remove §901', 'solution.md');
    run('T19', 'delete section with legal section trace', 'PASS', 'HEAD');

    reset(); addSections('901'); commit('docs: add §901', 'solution.md');
    text = readFileSync(join(clone, 'solution.md'), 'utf8');
    writeFileSync(join(clone, 'solution.md'), text.replace('\n## 901 N7 regression section\n\ncontent 901\n', ''), 'utf8');
    commit('docs: remove section', 'solution.md');
    run('T20', 'delete section without legal trace', 'FAIL', 'HEAD');

    reset(); addSections('901'); run('T21', 'HEAD ignores uncommitted governed change', 'PASS', 'HEAD');

    reset(); addSections('901'); const nonHead = commit('docs: add §901', 'solution.md');
    addSections('902'); commit('docs: add §902', 'solution.md');
    run('T22', 'explicit reachable non-HEAD SHA', 'PASS', nonHead);

    reset(); addSections('901'); const beforeIllegal = commit('docs: add §901', 'solution.md');
    addSections('902'); commit('docs: illegal later commit', 'solution.md');
    run('T23', 'explicit SHA excludes subsequent illegal commit', 'PASS', beforeIllegal);
    run('T24', 'HEAD includes subsequent illegal commit', 'FAIL', 'HEAD');

    reset();
    const nonAncestor = git(clone, 'commit-tree', `${base}^{tree}`, '-m', 'test: unrelated root');
    expectGate(runCheck(clone, nonAncestor), 'N7', 'FAIL');
    run('T25', 'nonexistent and non-ancestor target SHAs', 'FAIL', '0000000000000000000000000000000000000000');

    const fake = { status: 0, signal: null, error: undefined, output: '[FAIL] N7 simulated\n' };
    assert.throws(() => expectGate(fake, 'N7', 'FAIL'), /must exit 1/);
    results.push({
      id: 'T26', input: 'simulated [FAIL] N7 output with exit code 0', command: 'expectGate(fake, N7, FAIL)',
      expected: 'ASSERTION_FAIL', actual: 'ASSERTION_FAIL', exit: 0,
    });

    for (const row of results) {
      console.log(`${row.id} | input=${row.input} | command=${row.command} | expected=${row.expected} | actual=${row.actual} | exit=${row.exit}`);
    }
    assert.equal(results.length, 26);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
