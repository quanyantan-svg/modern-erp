import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';

describe('UAT-004 Linux x64 build architecture', () => {
  test('pnpm supports Windows and Linux x64 while preserving allowBuilds', () => {
    const workspace = readFileSync(resolve('pnpm-workspace.yaml'), 'utf8');
    assert.match(workspace, /allowBuilds:\s*[\s\S]*esbuild:\s*true/);
    assert.match(workspace, /supportedArchitectures:\s*[\s\S]*os:\s*[\s\S]*- win32\s*[\s\S]*- linux/);
    assert.match(workspace, /cpu:\s*[\s\S]*- x64/);
  });

  test('frozen lockfile carries both Rollup native optional packages', () => {
    const lockfile = readFileSync(resolve('pnpm-lock.yaml'), 'utf8');
    assert.match(lockfile, /'@rollup\/rollup-linux-x64-gnu@/);
    assert.match(lockfile, /'@rollup\/rollup-win32-x64-msvc@/);
  });

  test('platform-specific Rollup packages are not direct dependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const direct = { ...pkg.dependencies, ...pkg.devDependencies };
    assert.equal(direct['@rollup/rollup-linux-x64-gnu'], undefined);
    assert.equal(direct['@rollup/rollup-win32-x64-msvc'], undefined);
  });
});
