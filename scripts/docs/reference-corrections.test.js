import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashLine, parseCorrections, correctionFor } from './lib/reference-corrections.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const checkerSource = join(here, 'check-doc-consistency.mjs');
const libSources = [
  join(here, 'lib', 'current-index.mjs'),
  join(here, 'lib', 'governed-paths.mjs'),
  join(here, 'lib', 'migration-index.mjs'),
  join(here, 'lib', 'n7-traceability-ledger.mjs'),
  join(here, 'lib', 'reference-corrections.mjs'),
];

const isolatedGitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: isolatedGitEnv }).trim();
}

function copyNormalized(src, dest) {
  writeFileSync(dest, readFileSync(src, 'utf8').replace(/\r/g, ''), 'utf8');
}

function parseGate(output, gate) {
  const line = output.split(/\r?\n/).find((item) => item.includes(`] ${gate} `));
  if (!line) return { verdict: null, line: null };
  const m = /^\[(PASS|FAIL)\]\s/.exec(line.trim());
  return { verdict: m ? m[1] : null, line };
}

const BROKEN_LINE = '- 权威状态入口：[`docs/status/PROJECT_STATUS.md`](../../docs/status/PROJECT_STATUS.md) §35–§63。';
const BROKEN_TARGET = '../../docs/status/PROJECT_STATUS.md';
const FIXED_TARGET = '../docs/status/PROJECT_STATUS.md';

function registryRow({ id = 'DOC-REF-CORR-01', file = 'log/2026-11-14.md', lineHash, oldTarget = BROKEN_TARGET, newTarget = FIXED_TARGET }) {
  return `| \`${id}\` | \`${file}\` | \`${lineHash}\` | \`${oldTarget}\` | \`${newTarget}\` | \`2026-11-14\` | \`Platform\` | \`Requirement §36.16.7\` |`;
}

function registryText(row) {
  return [
    '# 历史引用纠错登记', '',
    '> 状态：`ACTIVE`', '',
    '## DOC-REF-CORR-01 纠错登记', '',
    '| 纠错 ID | 原文件 | 原行内容哈希 | 错误目标 | 正确目标 | 登记日期 | Owner | 批准依据 |',
    '|---|---|---|---|---|---|---|---|',
    row, '',
  ].join('\n');
}

function contractBody(id) {
  return [
    `# 探针合同 ${id}`, '',
    '> 状态：`ACTIVE`',
    '> Owner：Regression',
    `> 权威来源：\`document.md\` §${id}`,
    `> 来源：\`document.md\` §${id}（源 SHA \`4cb8c477\`，正文逐字迁移，章节编号保持不变）`, '',
    `## ${id} 探针合同`, '',
    '仅用于临时克隆中的回归验证。', '',
  ].join('\n');
}

/** 建立最小临时克隆并安装被测实现。 */
function createClone(label) {
  const tempRoot = mkdtempSync(join(tmpdir(), `erp-refcorr-${label}-`));
  const clone = join(tempRoot, 'repo');
  mkdirSync(clone, { recursive: true });
  git(clone, 'init', '--quiet');
  git(clone, 'config', 'user.name', 'Reference Corrections Regression');
  git(clone, 'config', 'user.email', 'ref-corrections@example.invalid');
  git(clone, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(clone, 'scripts', 'docs', 'lib'), { recursive: true });
  mkdirSync(join(clone, 'docs', 'status'), { recursive: true });
  mkdirSync(join(clone, 'docs', 'acceptance'), { recursive: true });
  mkdirSync(join(clone, 'log'), { recursive: true });
  copyNormalized(checkerSource, join(clone, 'scripts', 'docs', 'check-doc-consistency.mjs'));
  for (const src of libSources) {
    copyNormalized(src, join(clone, 'scripts', 'docs', 'lib', basenameOf(src)));
  }
  writeFileSync(join(clone, 'document.md'), contractBody('1'), 'utf8');
  writeFileSync(join(clone, 'solution.md'), contractBody('2'), 'utf8');
  writeFileSync(join(clone, 'docs', 'status', 'PROJECT_STATUS.md'), contractBody('36'), 'utf8');
  /*
   * 基线**不含**失效链接：断链必须在锚点之后出现，
   * 否则 N1 会把它判为「G0 验收锚点已存在的历史遗留」而无需登记。
   */
  writeFileSync(join(clone, 'log', '2026-11-14.md'), [
    '# 2026-11-14 开发日志', '',
  ].join('\n'), 'utf8');
  git(clone, 'add', '-A');
  git(clone, 'commit', '--quiet', '-m', '建立最小引用纠错测试基线');
  const base = git(clone, 'rev-parse', 'HEAD');
  git(clone, 'tag', 'refcorr-test-anchor', base);
  return { tempRoot, clone, base };
}

function basenameOf(p) {
  return p.split(/[\\/]/).pop();
}

function runN1(clone) {
  const args = [
    'scripts/docs/check-doc-consistency.mjs', '--mode', 'current', '--target', 'WORKTREE',
    '--anchor', 'refcorr-test-anchor', '--only', 'N1',
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: clone, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: isolatedGitEnv,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const parsed = parseGate(output, 'N1');
  return { status: result.status, output, verdict: parsed.verdict };
}

function expectN1(result, expected, mustContain = [], mustNotContain = []) {
  assert.equal(result.verdict, expected, `N1 verdict must be ${expected}:\n${result.output}`);
  for (const token of mustContain) {
    assert.ok(result.output.includes(token), `N1 output must contain ${token}:\n${result.output}`);
  }
  for (const token of mustNotContain) {
    assert.ok(!result.output.includes(token), `N1 output must NOT contain ${token}:\n${result.output}`);
  }
}

/* ------------------------- 单元层 ------------------------- */

test('hashLine 对 CRLF 与 LF 给出同一哈希', () => {
  const a = hashLine('- 权威状态入口：[x](../../y) §35。');
  const b = hashLine('- 权威状态入口：[x](../../y) §35。\r');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('parseCorrections 解析合法登记行', () => {
  const hash = hashLine(BROKEN_LINE);
  const { entries, errors } = parseCorrections(registryText(registryRow({ lineHash: hash })));
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'DOC-REF-CORR-01');
  assert.equal(entries[0].sourceFile, 'log/2026-11-14.md');
  assert.equal(entries[0].lineHash, hash);
  assert.equal(entries[0].oldTarget, BROKEN_TARGET);
  assert.equal(entries[0].newTarget, FIXED_TARGET);
});

test('parseCorrections 拒绝重复登记、重复 ID、通配与非法哈希', () => {
  const hash = hashLine(BROKEN_LINE);

  const dupTriple = parseCorrections(registryText([
    registryRow({ lineHash: hash, id: 'DOC-REF-CORR-01' }),
    registryRow({ lineHash: hash, id: 'DOC-REF-CORR-02' }),
  ].join('\n')));
  assert.ok(dupTriple.errors.some((e) => e.includes('重复')), JSON.stringify(dupTriple.errors));

  const dupId = parseCorrections(registryText([
    registryRow({ lineHash: hash, id: 'DOC-REF-CORR-01' }),
    registryRow({ lineHash: hash, id: 'DOC-REF-CORR-01' }),
  ].join('\n')));
  assert.ok(dupId.errors.some((e) => e.includes('重复')), JSON.stringify(dupId.errors));

  const wildcard = parseCorrections(registryText(registryRow({ lineHash: hash, newTarget: '../docs/status/*.md' })));
  assert.ok(wildcard.errors.some((e) => e.includes('通配符')), JSON.stringify(wildcard.errors));

  const badHash = parseCorrections(registryText(registryRow({ lineHash: 'NOTAHASH' })));
  assert.ok(badHash.errors.some((e) => e.includes('哈希非法')), JSON.stringify(badHash.errors));

  const sameTarget = parseCorrections(registryText(registryRow({ lineHash: hash, newTarget: BROKEN_TARGET })));
  assert.ok(sameTarget.errors.some((e) => e.includes('相同')), JSON.stringify(sameTarget.errors));
});

test('correctionFor 只接受三元精确匹配', () => {
  const hash = hashLine(BROKEN_LINE);
  const { entries } = parseCorrections(registryText(registryRow({ lineHash: hash })));
  const corrections = { entries, errors: [] };
  const broken = { from: 'log/2026-11-14.md', target: BROKEN_TARGET, lineHash: hash };
  assert.ok(correctionFor(corrections, broken));

  assert.equal(correctionFor(corrections, { ...broken, lineHash: hashLine('drifted') }), null);
  assert.equal(correctionFor(corrections, { ...broken, target: '../../docs/status/OTHER.md' }), null);
  assert.equal(correctionFor(corrections, { ...broken, from: 'log/other.md' }), null);
});

/* ------------------------- 集成层（临时克隆） ------------------------- */

test('N1 纠错登记矩阵：命中 / 未登记 / 漂移 / 悬空 / 通配', { timeout: 5 * 60 * 1000 }, () => {
  const hash = hashLine(BROKEN_LINE);
  const registryPath = join('docs', 'acceptance', 'document-reference-corrections.md');
  const scenarios = [];

  scenarios.push({
    id: 'C01 未登记断链 fail closed',
    expected: 'FAIL',
    mustContain: ['UNREGISTERED_BROKEN', BROKEN_TARGET],
    mustNotContain: ['CORRECTED_REFERENCE'],
    setup: () => {},
  });

  scenarios.push({
    id: 'C02 精确登记命中',
    expected: 'PASS',
    mustContain: ['CORRECTED_REFERENCE', 'DOC-REF-CORR-01'],
    mustNotContain: ['UNREGISTERED_BROKEN'],
    setup: (clone) => writeFileSync(join(clone, registryPath), registryText(registryRow({ lineHash: hash })), 'utf8'),
  });

  scenarios.push({
    id: 'C03 登记漂移（原行内容变化）不被覆盖',
    expected: 'FAIL',
    mustContain: ['UNREGISTERED_BROKEN', 'STALE_CORRECTION'],
    mustNotContain: ['CORRECTED_REFERENCE'],
    setup: (clone) => writeFileSync(join(clone, registryPath), registryText(registryRow({ lineHash: hashLine('drifted line') })), 'utf8'),
  });

  scenarios.push({
    id: 'C04 正确目标悬空不被覆盖',
    expected: 'FAIL',
    mustContain: ['CORRECTION_TARGET_UNREACHABLE'],
    mustNotContain: ['CORRECTED_REFERENCE'],
    setup: (clone) => writeFileSync(join(clone, registryPath), registryText(registryRow({ lineHash: hash, newTarget: '../docs/status/MISSING.md' })), 'utf8'),
  });

  scenarios.push({
    id: 'C05 通配登记被拒绝',
    expected: 'FAIL',
    mustContain: ['通配符'],
    mustNotContain: ['CORRECTED_REFERENCE'],
    setup: (clone) => writeFileSync(join(clone, registryPath), registryText(registryRow({ lineHash: hash, newTarget: '../docs/status/*.md' })), 'utf8'),
  });

  scenarios.push({
    id: 'C06 重复登记被拒绝',
    expected: 'FAIL',
    // 首条登记仍可命中，但重复的第二条被拒 —— 整体必须 fail closed。
    mustContain: ['重复'],
    setup: (clone) => writeFileSync(join(clone, registryPath), registryText([
      registryRow({ lineHash: hash, id: 'DOC-REF-CORR-01' }),
      registryRow({ lineHash: hash, id: 'DOC-REF-CORR-02' }),
    ].join('\n')), 'utf8'),
  });

  for (const scenario of scenarios) {
    const { tempRoot, clone, base } = createClone(scenario.id.slice(0, 3).toLowerCase());
    try {
      git(clone, 'reset', '--hard', base);
      git(clone, 'clean', '-fd');
      // git clean 会移除未被 Git 跟踪的空目录，场景文件写入前必须重建。
      mkdirSync(join(clone, 'docs', 'acceptance'), { recursive: true });
      appendFileSync(join(clone, 'log', '2026-11-14.md'), `${BROKEN_LINE}\n`, 'utf8');
      scenario.setup(clone);
      const result = runN1(clone);
      expectN1(result, scenario.expected, scenario.mustContain, scenario.mustNotContain);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});
