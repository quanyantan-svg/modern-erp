import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const checkerSource = join(here, 'check-doc-consistency.mjs');
const indexSource = join(here, 'lib', 'current-index.mjs');
const governedSource = join(here, 'lib', 'governed-paths.mjs');
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

/**
 * 从子进程输出解析门禁判定。
 * 返回 { verdict: 'PASS'|'FAIL'|null, line }；找不到判定行时 verdict 为 null。
 */
function parseGate(output, gate) {
  const line = output.split(/\r?\n/).find((item) => item.includes(`] ${gate} `));
  if (!line) return { verdict: null, line: null };
  const m = /^\[(PASS|FAIL)\]\s/.exec(line.trim());
  return { verdict: m ? m[1] : null, line };
}

/**
 * 严格断言：PASS ⇔ exit 0，FAIL ⇔ exit 1；
 * spawn error、signal、错误退出码、判定与退出码不自洽，全部使测试失败。
 */
function expectGate(result, gate, expected) {
  assert.equal(result.error, undefined, `spawn error: ${result.error}`);
  assert.equal(result.signal, null, `terminated by signal: ${result.signal}`);
  const expectedStatus = expected === 'PASS' ? 0 : 1;
  assert.equal(result.status, expectedStatus,
    `${gate} ${expected} must exit ${expectedStatus}, got ${result.status}:\n${result.output}`);
  const parsed = parseGate(result.output, gate);
  assert.ok(parsed.line, `missing ${gate} result:\n${result.output}`);
  assert.equal(parsed.verdict, expected,
    `${gate} verdict must be ${expected}, got ${parsed.verdict}:\n${result.output}`);
  assert.equal(parsed.verdict === 'PASS', result.status === 0,
    `${gate} verdict ${parsed.verdict} is inconsistent with exit code ${result.status}:\n${result.output}`);
}

/** 按 LF 归一后复制：安装到临时 clone 的实现不依赖全局 core.autocrlf。 */
function copyNormalized(src, dest) {
  writeFileSync(dest, readFileSync(src, 'utf8').replace(/\r/g, ''), 'utf8');
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

/** 合同正文模板（带反引号包裹的权威章节声明）。 */
function contractBody(id, headingId = id) {
  return [
    `# N7 探针合同 ${id}`, '',
    '> 状态：`ACTIVE`',
    '> Owner：N7 Regression',
    `> 权威来源：\`document.md\` §${id}`,
    `> 来源：\`document.md\` §${id}（源 SHA \`4cb8c477\`，正文逐字迁移，章节编号保持不变）`, '',
    `## ${headingId} N7 探针合同`, '',
    '仅用于临时克隆中的受治理正文回归验证。', '',
  ].join('\n');
}

/**
 * 建立临时克隆并安装被测实现。
 *
 * 安装规则：
 *   - clone 的检出与换行一律固定为 LF（命令级 -c + clone 本地 config），
 *     因此结果与机器全局 core.autocrlf 无关，也不需要用户改全局配置；
 *   - 先检查暂存区是否真的有 Diff，只有确实产生变更时才提交「安装 commit」；
 *   - 若被测实现与 clone HEAD 完全一致，直接以 HEAD 作为测试基线，不产生空提交；
 *   - 绝不使用 --allow-empty 掩盖无变更提交；
 *   - 全部安装动作只发生在临时 clone 内。
 */
function createClone(root, label) {
  const tempRoot = mkdtempSync(join(tmpdir(), `erp-doc-${label}-`));
  const clone = join(tempRoot, 'repo');
  git(tempRoot, '-c', `safe.directory=${repoRoot}`, '-c', `safe.directory=${sourceGitDir}`,
    '-c', 'core.autocrlf=false', 'clone', '--quiet', '--no-hardlinks', repoRoot, clone);
  git(clone, 'config', 'user.name', 'N7 Regression');
  git(clone, 'config', 'user.email', 'n7-regression@example.invalid');
  git(clone, 'config', 'core.autocrlf', 'false');
  copyNormalized(checkerSource, join(clone, 'scripts', 'docs', 'check-doc-consistency.mjs'));
  copyNormalized(indexSource, join(clone, 'scripts', 'docs', 'lib', 'current-index.mjs'));
  copyNormalized(governedSource, join(clone, 'scripts', 'docs', 'lib', 'governed-paths.mjs'));
  git(clone, 'add', 'scripts/docs/check-doc-consistency.mjs', 'scripts/docs/lib/current-index.mjs',
    'scripts/docs/lib/governed-paths.mjs');
  const staged = git(clone, 'diff', '--cached', '--name-only');
  let installed = false;
  if (staged) {
    git(clone, 'commit', '--quiet', '-m', 'test: install N7 test implementation');
    installed = true;
  }
  const base = git(clone, 'rev-parse', 'HEAD');
  return { tempRoot, clone, base, installed };
}

test('N7 adversarial matrix T01-T26', { timeout: 20 * 60 * 1000 }, () => {
  const { tempRoot, clone, base, installed } = createClone(repoRoot, 'n7');
  const results = [];

  try {
    /* 安装必须与源文件逐字节一致（按 LF 归一），否则结果会依赖全局 core.autocrlf。 */
    const installedChecker = readFileSync(join(clone, 'scripts', 'docs', 'check-doc-consistency.mjs'), 'utf8');
    assert.ok(!installedChecker.includes('\r'),
      'installed checker must be LF-normalized so the result does not depend on core.autocrlf');
    assert.equal(installedChecker, readFileSync(checkerSource, 'utf8').replace(/\r/g, ''),
      'installed checker must equal the source implementation after LF normalization');

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
      const parsed = parseGate(actual.output, 'N7');
      results.push({
        id, input, command: actual.command, expected,
        actual: parsed.verdict, exit: actual.status,
      });
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
    console.log(`install-commit-created=${installed} | base=${base}`);
    assert.equal(results.length, 26);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('N7 historical governed path matrix T27-T31', { timeout: 20 * 60 * 1000 }, () => {
  const { tempRoot, clone, base } = createClone(repoRoot, 'n7h');
  const results = [];

  try {
    const reset = () => {
      assert.ok(resolve(clone).startsWith(resolve(tempRoot)), 'destructive reset must stay in temp clone');
      git(clone, 'reset', '--hard', base);
      git(clone, 'clean', '-fd');
    };
    const commit = (message) => { git(clone, 'add', '-A'); git(clone, 'commit', '--quiet', '-m', message); };
    const run = (id, input, expected, target = 'HEAD') => {
      const actual = runCheck(clone, target);
      expectGate(actual, 'N7', expected);
      const parsed = parseGate(actual.output, 'N7');
      results.push({
        id, input, command: actual.command, expected,
        actual: parsed.verdict, exit: actual.status,
      });
      return actual;
    };

    /* T27：新建 Requirement 后又删除 —— 必须进入 N7 审查并 FAIL */
    reset();
    writeFileSync(join(clone, 'docs', 'requirements', 'n7-tmp.md'), contractBody('41'), 'utf8');
    commit('docs: 新增 docs/requirements/n7-tmp.md');
    git(clone, 'rm', '--quiet', 'docs/requirements/n7-tmp.md');
    commit('docs: 移除 docs/requirements/n7-tmp.md');
    const t27 = run('T27', 'create then delete a Requirement body inside the interval', 'FAIL');
    assert.match(t27.output, /整体删除或移动受治理文件|整体消失/, 'T27 must report the deleted Requirement');

    /* T28：新建 Design 后又删除 */
    reset();
    writeFileSync(join(clone, 'docs', 'design', 'n7-tmp.md'), contractBody('42'), 'utf8');
    commit('docs: 新增 docs/design/n7-tmp.md');
    git(clone, 'rm', '--quiet', 'docs/design/n7-tmp.md');
    commit('docs: 移除 docs/design/n7-tmp.md');
    const t28 = run('T28', 'create then delete a Design body inside the interval', 'FAIL');
    assert.match(t28.output, /整体删除或移动受治理文件|整体消失/, 'T28 must report the deleted Design');

    /* T29：新建 Review 后又删除 */
    reset();
    writeFileSync(join(clone, 'docs', 'reviews', 'n7-tmp.md'), candidateText('43'), 'utf8');
    commit('docs: 新增 docs/reviews/n7-tmp.md');
    git(clone, 'rm', '--quiet', 'docs/reviews/n7-tmp.md');
    commit('docs: 移除 docs/reviews/n7-tmp.md');
    const t29 = run('T29', 'create then delete a Review candidate inside the interval', 'FAIL');
    assert.match(t29.output, /整体删除或移动受治理文件|整体消失/, 'T29 must report the deleted Review');

    /* T30：新建后改名并删除 —— Rename/Move 必须 Fail Closed */
    reset();
    writeFileSync(join(clone, 'docs', 'requirements', 'n7-move.md'), contractBody('44'), 'utf8');
    commit('docs: 新增 docs/requirements/n7-move.md');
    git(clone, 'mv', 'docs/requirements/n7-move.md', 'docs/requirements/n7-moved.md');
    commit('docs: 移动 docs/requirements/n7-move.md');
    git(clone, 'rm', '--quiet', 'docs/requirements/n7-moved.md');
    commit('docs: 移除 docs/requirements/n7-moved.md');
    const t30 = run('T30', 'create, rename and then delete a Requirement body', 'FAIL');
    assert.match(t30.output, /整体删除或移动受治理文件|整体消失/, 'T30 must report the renamed-away Requirement');

    /* T31：普通非治理文件的创建与删除不得误触发 N7 */
    reset();
    mkdirSync(join(clone, 'docs', 'notes'), { recursive: true });
    writeFileSync(join(clone, 'docs', 'notes', 'n7-ordinary.md'), '# ordinary note\n\nnot a governed contract\n', 'utf8');
    commit('docs: 新增 docs/notes/n7-ordinary.md');
    git(clone, 'rm', '--quiet', 'docs/notes/n7-ordinary.md');
    commit('docs: 移除 docs/notes/n7-ordinary.md');
    run('T31', 'create and delete an ordinary non-governed document', 'PASS');

    for (const row of results) {
      console.log(`${row.id} | input=${row.input} | command=${row.command} | expected=${row.expected} | actual=${row.actual} | exit=${row.exit}`);
    }
    assert.equal(results.length, 5);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
