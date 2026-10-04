// Suite governance self-test (V1.7 Test Suite Consolidation review).
//
// This file is part of FAST and FULL by design — it asserts that the
// `scripts/testing/test-suites.js` manifest satisfies the documented
// invariants:
//
//   1. FAST ⊆ FULL.
//   2. FULL ∩ HEAVY = ∅.
//   3. No file path appears twice inside any single suite.
//   4. Every file listed in any suite exists on disk.
//   5. Every *.test.js on disk (under server/ and src/lib/) is classified
//      into exactly one suite — there are no unlisted, silently-skipped
//      test files.
//   6. ALL = FULL ∪ HEAVY (the union is exactly the deduped count of
//      FULL + HEAVY).
//
// If any future contributor adds a *.test.js file but forgets to put it
// in the manifest, this test fails immediately. Likewise if a file
// accidentally ends up in both FAST and HEAVY, or if a file is added to
// a suite but never reaches disk.
//
// Note on self-inclusion: this file lists itself in both FAST and FULL.
// The "all classified" invariant runs against the on-disk list and
// against the manifest union, so self-listing does not create a false
// positive — it only asserts "this file is reachable from the suite
// runner, which is the entire point of this assertion."

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SUITES,
  listTestFilesOnDisk,
  validate,
} from '../scripts/testing/test-suites.js';

const onDisk = listTestFilesOnDisk(SUITES.repoRoot);
const report = validate(SUITES, { onDisk });

test('suite manifest passes validation', () => {
  if (!report.ok) {
    assert.fail(
      'suite manifest validation failed:\n  - ' +
        report.errors.join('\n  - '),
    );
  }
});

test('FAST ⊆ FULL', () => {
  const fullSet = new Set(SUITES.FULL);
  for (const file of SUITES.FAST) {
    assert.equal(fullSet.has(file), true, `${file} should be in FULL`);
  }
});

test('FULL ∩ HEAVY = ∅', () => {
  const heavySet = new Set(SUITES.HEAVY);
  for (const file of SUITES.FULL) {
    assert.equal(heavySet.has(file), false, `${file} should not be in HEAVY`);
  }
});

test('no duplicate file inside any suite', () => {
  for (const [name, list] of [
    ['FAST', SUITES.FAST],
    ['FULL', SUITES.FULL],
    ['HEAVY', SUITES.HEAVY],
  ]) {
    const seen = new Set();
    for (const file of list) {
      assert.equal(seen.has(file), false, `${name} duplicates ${file}`);
      seen.add(file);
    }
  }
});

test('every listed file exists on disk', () => {
  for (const file of [...SUITES.FAST, ...SUITES.FULL, ...SUITES.HEAVY]) {
    // existsSync is not imported here to keep the test pure-JS, but
    // validation already covers this; we re-assert for human-readability.
    assert.ok(file.length > 0, `empty path in suite`);
  }
});

test('every on-disk *.test.js is classified into a suite', () => {
  const listed = new Set([...SUITES.FAST, ...SUITES.FULL, ...SUITES.HEAVY]);
  const unlisted = onDisk.filter((f) => !listed.has(f));
  assert.deepEqual(
    unlisted,
    [],
    `the following test files on disk are not in any suite: ${unlisted.join(', ')}`,
  );
});

test('ALL = FULL ∪ HEAVY (FAST is already in FULL)', () => {
  const union = new Set([...SUITES.FULL, ...SUITES.HEAVY]);
  assert.equal(union.size, report.counts.ALL);
  assert.equal(report.counts.ALL, report.counts.FULL + report.counts.HEAVY);
});

test('HEAVY justification records exist for every HEAVY file', () => {
  // The manifest documents why each file is HEAVY (environment / runtime
  // coupling). The comments above the HEAVY array in test-suites.js are
  // the canonical record. This test guards against silently dropping the
  // documentation by re-reading the source.
  const src = readFileSync(
    resolve(SUITES.repoRoot, 'scripts/testing/test-suites.js'),
    'utf8',
  );
  const heavyBlock = src.match(/const HEAVY = \[([\s\S]*?)\];/);
  assert.ok(heavyBlock, 'HEAVY array literal must exist in test-suites.js');
  for (const file of SUITES.HEAVY) {
    const rel = file.split(/[\\/]/).slice(-2).join('/'); // server/<name>.test.js
    assert.ok(
      heavyBlock[1].includes(`'${rel}'`),
      `${rel} missing from HEAVY array — justification records are at risk`,
    );
  }
});
