// The protected gate's child exit code must depend on the suite result.
//
// The TAP reporter used to take its failure signal from the `test:fail`
// stream event alone. A failure reported only inside a nested subtest does
// not always reach that event, so the child process still exited 0 and the
// gate reported a FAILING suite as a PASS. The protected Accounting &
// Analytics campaign hit exactly that.
//
// This suite owns no database and never connects to MySQL: it drives the
// reporter in a child process against a controlled failing and passing suite
// and asserts the resulting exit code — the same signal the gate consumes.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const PASSING = `import assert from 'node:assert/strict';
import { test } from 'node:test';
test('passes', () => { assert.equal(1, 1); });
`;

const FAILING = `import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
describe('probe', () => {
  test('passes', () => { assert.equal(1, 1); });
  test('fails', () => { assert.equal(1, 2); });
});
`;

/** Run the reporter in a child process, exactly as the gate's suite child does. */
async function runReporter(source) {
  const directory = mkdtempSync(join(tmpdir(), 'ack4-reporter-'));
  const filePath = join(directory, 'suite.test.mjs');
  writeFileSync(filePath, source, 'utf8');
  try {
    const runner = [
      '(async () => {',
      "const { run } = await import('node:test');",
      "const { emitNodeTestTap } = await import('./scripts/gates/m1-core-g07-suite-reporter.mjs');",
      'const result = await emitNodeTestTap(run({ files: [process.argv[1]], isolation: \'none\' }));',
      'if (result.failed) process.exitCode = 1;',
      '})().catch((error) => { console.error(error); process.exitCode = 2; });',
    ].join('\n');
    const child = spawn(process.execPath, ['-e', runner, filePath], {
      cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    return { exitCode, stdout, stderr };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe('受保护门禁的 TAP 报告器必须反映套件结果', () => {
  test('失败套件 → 子进程以非零退出（门禁据此判 FAIL）', async () => {
    const { exitCode, stdout, stderr } = await runReporter(FAILING);
    assert.equal(exitCode, 1, `失败套件必须以非零退出，实际 ${exitCode}；stderr=${stderr}`);
    assert.match(stdout, /not ok \d+/, '合成 TAP 必须含 not ok 行');
  });

  test('通过套件 → 子进程以零退出（门禁据此判 PASS）', async () => {
    const { exitCode, stdout, stderr } = await runReporter(PASSING);
    assert.equal(exitCode, 0, `通过套件必须以零退出，实际 ${exitCode}；stderr=${stderr}`);
    assert.doesNotMatch(stdout, /not ok \d+/);
  });

  test('负例前提：只看 test:fail 事件不足以覆盖嵌套子测试的失败', async () => {
    // The event count is recorded for the record; the TAP text always carries
    // the failure. The reporter must consult BOTH, which is why the failing
    // case above is decided by the TAP text rather than by the event alone.
    const { stdout } = await runReporter(FAILING);
    assert.match(stdout, /not ok \d+/,
      '合成 TAP 必须携带失败；否则 TAP 文本扫描这一路守卫没有区分力');
  });
});
