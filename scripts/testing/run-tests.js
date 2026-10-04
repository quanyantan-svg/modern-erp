#!/usr/bin/env node
// V1.7 Test Suite Consolidation — cross-platform test runner.
//
// Responsibilities:
//   - Discover which Node --test files belong to a given suite
//     (FAST / FULL / HEAVY / ALL).
//   - Validate the suite manifest before invoking Node --test, so a
//     misclassification (e.g. a *.test.js file that was never added to
//     any suite, or a file that lives in two suites) fails the run
//     rather than silently being skipped or double-counted.
//   - Invoke `node --test` with the resolved, deduplicated file list.
//   - Propagate the exit code from the Node test runner unchanged.
//   - Never silently swallow failures; never filter passing tests.
//
// Usage:
//   node scripts/testing/run-tests.js fast
//   node scripts/testing/run-tests.js full
//   node scripts/testing/run-tests.js heavy
//   node scripts/testing/run-tests.js all
//   node scripts/testing/run-tests.js <suite> --list
//
// If a suite name is omitted, FULL is used.
//
// Suite set semantics (must hold for every run):
//   FAST ⊆ FULL
//   FULL ∩ HEAVY = ∅
//   ALL = FULL ∪ HEAVY  (FAST is already a subset of FULL)
// `test:all` therefore never runs FAST twice.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SUITES, validate, listTestFilesOnDisk } from './test-suites.js';

const repoRoot = SUITES.repoRoot;

const args = process.argv.slice(2);
const requested = (args[0] || 'full').toLowerCase();
const listOnly = args.includes('--list') || args.includes('--dry-run');
const filterIdx = args.indexOf('--filter');
const filterName = filterIdx >= 0 ? args[filterIdx + 1] : null;

const ALL = 'all';
const VALID = new Set(['fast', 'full', 'heavy', ALL]);

if (!VALID.has(requested)) {
  console.error(`Unknown suite: ${requested}`);
  console.error(`Expected one of: fast, full, heavy, all`);
  process.exit(2);
}

// Pre-flight invariant validation. Fail closed if the manifest is wrong.
const onDisk = listTestFilesOnDisk(repoRoot);
const report = validate(SUITES, { onDisk });
if (!report.ok) {
  console.error('[run-tests] suite manifest validation FAILED:');
  for (const e of report.errors) console.error('  - ' + e);
  process.exit(2);
}

function filesFor(suiteName) {
  if (suiteName === ALL) {
    return Array.from(new Set([...SUITES.FULL, ...SUITES.HEAVY]));
  }
  return SUITES[suiteName.toUpperCase()];
}

let files = filesFor(requested);

// Optional --filter: keep only files whose basename matches the substring.
// Cheap, deterministic, no shell-glob dependency.
if (filterName) {
  const needle = filterName.toLowerCase();
  files = files.filter((f) => f.toLowerCase().includes(needle));
}

if (listOnly) {
  const label = requested === ALL ? 'all (full + heavy)' : requested;
  console.log(`Suite: ${label}`);
  console.log(`Files: ${files.length}`);
  for (const file of files) console.log(`- ${file}`);
  console.log(`Counts: FAST=${report.counts.FAST} FULL=${report.counts.FULL} HEAVY=${report.counts.HEAVY} ALL=${report.counts.ALL} onDisk=${report.counts.onDisk}`);
  process.exit(0);
}

// Sanity: warn loudly if a listed file is missing on disk. This is also
// caught by validate() above, but we keep a defensive post-validation
// check here so a runtime drift cannot silently bypass the gate.
const missing = files.filter((file) => !existsSync(file));
if (missing.length) {
  console.error('[run-tests] the following files in the suite manifest are missing:');
  for (const file of missing) console.error('  ' + file);
  process.exit(2);
}

const label = requested === ALL ? 'all (full + heavy)' : requested;
console.error(`[run-tests] suite=${label} files=${files.length}`);

// We pass --test directly. --test-reporter=spec keeps output close to
// the previous default for human readers. CI can override via NODE_TEST_FLAGS.
const env = { ...process.env };
const extraFlags = (env.NODE_TEST_FLAGS || '').trim();

const childArgs = ['--test', ...extraFlags.split(/\s+/).filter(Boolean), ...files];

const child = spawn(process.execPath, childArgs, {
  stdio: 'inherit',
  cwd: repoRoot,
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-tests] child terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});

child.on('error', (err) => {
  console.error(`[run-tests] failed to start node --test: ${err.message}`);
  process.exit(1);
});
