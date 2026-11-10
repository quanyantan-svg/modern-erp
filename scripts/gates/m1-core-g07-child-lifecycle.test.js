import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, test } from 'node:test';
import { hasExited, waitForExit } from './m1-core-g07-child-lifecycle.mjs';

function spawnNode(script) {
  return spawn(process.execPath, ['-e', script], { windowsHide: true, stdio: 'ignore' });
}

describe('M1C-G07 child process lifecycle (pure Node, no MySQL)', () => {
  test('normal exit resolves to code 0 and is observed as exited', async () => {
    const child = spawnNode('process.exit(0)');
    assert.equal(await waitForExit(child), 0);
    assert.ok(hasExited(child));
  });

  test('non-zero exit resolves to the exact exit code', async () => {
    const child = spawnNode('process.exit(7)');
    assert.equal(await waitForExit(child), 7);
  });

  test('SIGTERM is observed through signalCode without hanging', async () => {
    const child = spawnNode('setInterval(() => {}, 1000)');
    child.kill('SIGTERM');
    assert.equal(await waitForExit(child), null);
    assert.equal(child.signalCode, 'SIGTERM');
    assert.ok(hasExited(child));
  });

  test('a child that exits before waitForExit is called still resolves', async () => {
    const child = spawnNode('process.exit(0)');
    await delay(50);
    assert.equal(await waitForExit(child), 0);
  });

  test('the exit-before-wait race never leaves waitForExit pending', async () => {
    for (let i = 0; i < 20; i += 1) {
      const child = spawnNode('process.exit(0)');
      const result = await Promise.race([waitForExit(child), delay(2000).then(() => 'TIMEOUT')]);
      assert.notEqual(result, 'TIMEOUT', 'waitForExit must not hang when the child exits immediately');
    }
  });

  // The shared disposable-target primitive forbids a RESET lease from taking
  // the DROP path (RESET is EMPTY_ONLY). Both gate children must therefore
  // pass the same `requireEmpty` flag; without it every RESET is refused
  // before the bootstrap, which is how the M1-Core G07 gate was left broken
  // after the OUT-001 hardening of the shared primitive.
  test('every gate child passes the EMPTY_ONLY flag for RESET_SCHEMA_PRE_RUN', () => {
    for (const script of ['m1-core-g07-child.mjs', 'mysql-out001-child.mjs']) {
      const source = readFileSync(new URL(script, import.meta.url), 'utf8');
      assert.match(
        source,
        /resetAuthorizedDisposableMySqlSchema\(\s*db, config, process\.env, \{ requireEmpty: operation === 'RESET_SCHEMA_PRE_RUN' \}/,
        `${script} must call the shared reset primitive in EMPTY_ONLY mode for RESET_SCHEMA_PRE_RUN`,
      );
    }
  });
});
