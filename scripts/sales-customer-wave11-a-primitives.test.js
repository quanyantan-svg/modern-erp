// W11-A U1 — Read Primitives equivalence suite.
//
// solution.md §37.54.5.2, §37.54.15.3, §37.54.15.9 (Q1 = option A,
// W11_A_FROZEN_PAYLOAD_BOUNDED_AMENDMENT).
//
// WHAT THIS FILE PROVES
//   T1  the extracted pure fingerprint function reproduces, byte for byte, the
//       golden vectors that were captured from the ORIGINAL implementation
//       BEFORE the extraction (provenance below) — not from itself;
//   T2  invalid hash inputs keep the original error class, status, message and
//       business code;
//   T3  boundary, hash-order sensitivity, repeat-call determinism, the
//       length-prefixed canonical encoding and the `CSP1:` prefix;
//   T4  the snapshot writer's persistence behaviour is unchanged: first
//       creation, idempotency, uniqueness, no rewrite of history, and no write
//       at all on invalid input;
//   T5  the additive export in credit-check.js is inert: removing the appended
//       export block reproduces the W11-SEC-01 frozen SHA-256 exactly, and no
//       second Scope resolver, hash builder or fingerprint algorithm exists.
//
// EVIDENCE LEVEL. Every assertion runs on a single isolated SQLite connection
// inside a disposable temp database. It is NOT real-MySQL evidence; the W11-A
// MySQL Gate belongs to U2. No MySQL connection is opened by this file.
//
// CLASSIFICATION DEBT (deliberate, bounded)
//   This file lives under `scripts/` and is intentionally NOT listed in
//   `scripts/testing/test-suites.js` for U1, because registering it would
//   require editing that manifest, which the U1 authorization forbids. The
//   governance invariant "every *.test.js under server/ and src/lib/ is
//   classified into exactly one suite" therefore stays literally true and the
//   governance self-check keeps passing. The file must be registered in the
//   next authorized round; until then it is executed explicitly and its result
//   is recorded in the day's log.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createDatabase } from '../server/db.js';
import { migrateSalesCustomerDomain } from '../server/migrations/sales-customer-domain.js';
import { computePolicySnapshotFingerprint, ensureCreditPolicySnapshot } from '../server/modules/credit-policy.js';
import { buildScopeHashes, CREDIT_CHECK_RESULT_SCOPE } from '../server/modules/credit-check.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The W11-SEC-01 frozen payload digest of server/modules/credit-check.js.
// U1 is an authorised bounded amendment: the file may only GAIN the appended
// export block, so removing that block must reproduce this digest exactly.
const W11_SEC_FROZEN_CREDIT_CHECK_SHA256 =
  '3bf4eb5190f3c8f59c0d7446fe07cd0264992126cffaa8616c1ccbecd7e272f0';
const U1_EXPORT_MARKER = '\n// W11-A U1 — additive named exports';

// GOLDEN VECTORS — PROVENANCE: captured on 2026-10-28 from the ORIGINAL
// credit-policy.js implementation BEFORE the U1-B extraction, by driving
// ensureCreditPolicySnapshot on a disposable SQLite fixture. Golden file
// SHA-256 5f5212c4aa31e40d50e983c9f4655d14cb1e0025b567f0d839bd133b0e778c18.
// These are the trusted reference the extracted function is compared against;
// they are NOT derived from the extracted function itself.
const GOLDEN = {
  "valid": [
    {
      "id": "distinct",
      "input": {
        "id": "distinct",
        "parameterSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "snapshotFingerprint": "CSP1:22beeb7885f4d9b90bd22a564d01c72a7bd59c7fd6f73237e06fa2f141b42c5e"
    },
    {
      "id": "all-a",
      "input": {
        "id": "all-a",
        "parameterSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ruleSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "profileEffectiveStateHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "snapshotFingerprint": "CSP1:c5776134b09789ab75804f43ae538bb33f4c1cfc1003e7501d1c8189d400f15d"
    },
    {
      "id": "all-zero",
      "input": {
        "id": "all-zero",
        "parameterSetHash": "0000000000000000000000000000000000000000000000000000000000000000",
        "ruleSetHash": "0000000000000000000000000000000000000000000000000000000000000000",
        "profileEffectiveStateHash": "0000000000000000000000000000000000000000000000000000000000000000"
      },
      "snapshotFingerprint": "CSP1:add4e9b73b7dad17edd17d334cc54d6447df0ec2a39f0dbed51a16f27a57b3be"
    },
    {
      "id": "leading-zeros",
      "input": {
        "id": "leading-zeros",
        "parameterSetHash": "0000000000000000000000000000000000000000000000000000000000000001",
        "ruleSetHash": "0000000000000000000000000000000000000000000000000000000000000000",
        "profileEffectiveStateHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "snapshotFingerprint": "CSP1:82c7fa243de403ea10ef68da5ea56889b0b0f70cab70b2ca350b8aedc16da4a9"
    },
    {
      "id": "swapped-1",
      "input": {
        "id": "swapped-1",
        "parameterSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "ruleSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "snapshotFingerprint": "CSP1:5182d5d48aeabbdac165cf247ba4ae9eb6adc57de3f5a57c55466653a225c04e"
    },
    {
      "id": "swapped-2",
      "input": {
        "id": "swapped-2",
        "parameterSetHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "snapshotFingerprint": "CSP1:925b2e0b5aa4f1af4111d2794b247a6b28d8cafc380c6d182b3e9710e16a54b2"
    },
    {
      "id": "swapped-3",
      "input": {
        "id": "swapped-3",
        "parameterSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ruleSetHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "profileEffectiveStateHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      },
      "snapshotFingerprint": "CSP1:0f420e1dba395da677de1ed34683ad323d6c7ac72b7de53439070bedf27b0e76"
    }
  ],
  "invalid": [
    {
      "id": "missing-undefined",
      "input": {
        "id": "missing-undefined",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "missing-null",
      "input": {
        "id": "missing-null",
        "parameterSetHash": null,
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "short-63",
      "input": {
        "id": "short-63",
        "parameterSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "long-65",
      "input": {
        "id": "long-65",
        "parameterSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "non-hex-g",
      "input": {
        "id": "non-hex-g",
        "parameterSetHash": "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "uppercase",
      "input": {
        "id": "uppercase",
        "parameterSetHash": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "mixed-case",
      "input": {
        "id": "mixed-case",
        "parameterSetHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaA",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "number-input",
      "input": {
        "id": "number-input",
        "parameterSetHash": 12345678901234567000,
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "empty-string",
      "input": {
        "id": "empty-string",
        "parameterSetHash": "",
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    },
    {
      "id": "object-input",
      "input": {
        "id": "object-input",
        "parameterSetHash": {},
        "ruleSetHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "profileEffectiveStateHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      },
      "error": {
        "name": "Error",
        "status": 400,
        "message": "策略快照哈希必须为 64 位小写十六进制",
        "code": "VALIDATION"
      }
    }
  ]
};

function fingerprintOf(parameterSetHash, ruleSetHash, profileEffectiveStateHash) {
  return computePolicySnapshotFingerprint({ parameterSetHash, ruleSetHash, profileEffectiveStateHash });
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'w11a-u1-primitives-'));
  const db = createDatabase(join(dir, 'u1.db'));
  migrateSalesCustomerDomain(db);
  try {
    return fn(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

function policyScopeAnchor(db) {
  const row = db.prepare(`SELECT id FROM credit_lock_anchors WHERE anchor_type='POLICY_SCOPE' ORDER BY id LIMIT 1`).get();
  assert.ok(row, 'the migrated schema must seed a POLICY_SCOPE anchor');
  return row.id;
}

test('T1 the extracted pure function reproduces the original implementation byte for byte', () => {
  assert.equal(GOLDEN.valid.length, 7, 'the golden vector set must be the captured one');
  for (const vector of GOLDEN.valid) {
    const actual = fingerprintOf(
      vector.input.parameterSetHash,
      vector.input.ruleSetHash,
      vector.input.profileEffectiveStateHash,
    );
    assert.equal(actual, vector.snapshotFingerprint,
      `golden vector ${vector.id} must reproduce byte for byte`);
  }
});

test('T2 invalid hash inputs keep the original error class, status, message and code', () => {
  assert.equal(GOLDEN.invalid.length, 10, 'the invalid vector set must be the captured one');
  for (const vector of GOLDEN.invalid) {
    assert.throws(
      () => fingerprintOf(
        vector.input.parameterSetHash,
        vector.input.ruleSetHash,
        vector.input.profileEffectiveStateHash,
      ),
      (error) => {
        assert.equal(error.name, vector.error.name, `vector ${vector.id}: error class`);
        assert.equal(error.status, vector.error.status, `vector ${vector.id}: status`);
        assert.equal(error.message, vector.error.message, `vector ${vector.id}: message`);
        assert.equal(error.code, vector.error.code, `vector ${vector.id}: business code`);
        return true;
      },
      `invalid vector ${vector.id} must keep the original error semantics`,
    );
  }
});

test('T3 boundary, hash-order sensitivity, determinism, canonical length prefix and CSP1 prefix', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);

  // 64-character legal boundary is accepted and yields the documented shape.
  const boundary = fingerprintOf(A, B, C);
  assert.match(boundary, /^CSP1:[0-9a-f]{64}$/, 'the 64-character boundary must be accepted');

  // Hash order sensitivity: the same three hashes in another order differ.
  assert.notEqual(fingerprintOf(A, B, C), fingerprintOf(B, A, C), 'hash order must matter');
  assert.notEqual(fingerprintOf(A, B, C), fingerprintOf(C, B, A), 'hash order must matter');
  assert.notEqual(fingerprintOf(B, A, C), fingerprintOf(C, B, A), 'hash order must matter');

  // Repeat-call determinism.
  assert.equal(fingerprintOf(A, B, C), fingerprintOf(A, B, C), 'the function must be deterministic');

  // The canonical encoding is length prefixed, per the original specification:
  // "<length>:<hash>" joined in the fixed input order.
  const hashes = [A, B, C];
  const canonical = hashes.map((value) => `${value.length}:${value}`).join('');
  // Each element is "<length>:<hash>" — a 64-character hash is prefixed by the
  // two digits of its length plus the ':' separator, so 67 characters each.
  assert.equal(canonical.length, 3 * (64 + 3), 'the canonical string must carry three length prefixes');
  assert.equal(boundary, `CSP1:${createHash('sha256').update(canonical).digest('hex')}`,
    'the fingerprint must be the SHA-256 of the length-prefixed canonical encoding');

  // The CSP1 prefix and lowercase hex digest shape.
  assert.ok(boundary.startsWith('CSP1:'), 'the CSP1: prefix must be preserved');
  assert.equal(boundary.slice(5).length, 64, 'the digest must be 64 hex characters');
  assert.equal(boundary.slice(5), boundary.slice(5).toLowerCase(), 'the digest must be lowercase');
});

test('T4 the snapshot writer persistence behaviour is unchanged', () => {
  withFixture((db) => {
    const anchorId = policyScopeAnchor(db);
    const countRows = () => db.prepare(`SELECT COUNT(*) c FROM credit_policy_snapshots`).get().c;
    const input = {
      creditLockAnchorId: anchorId,
      scopeType: 'CUSTOMER_AGGREGATE',
      creditProfileId: null,
      businessDate: '2026-10-28',
      parameterSetHash: 'a'.repeat(64),
      ruleSetHash: 'b'.repeat(64),
      profileEffectiveStateHash: 'c'.repeat(64),
      capturedBy: null,
      notes: { origin: 'w11a-u1' },
    };

    const before = countRows();
    const first = ensureCreditPolicySnapshot(db, input);
    assert.equal(countRows(), before + 1, 'the first creation must persist exactly one snapshot');
    assert.equal(first.snapshot_fingerprint, fingerprintOf(input.parameterSetHash, input.ruleSetHash, input.profileEffectiveStateHash),
      'the persisted fingerprint must equal the pure computation');
    assert.equal(first.snapshot_fingerprint, GOLDEN.valid[0].snapshotFingerprint,
      'the persisted fingerprint must equal the original implementation output');

    // Idempotency: the same input returns the existing row and writes nothing.
    const repeat = ensureCreditPolicySnapshot(db, { ...input, capturedBy: 'someone-else' });
    assert.equal(repeat.id, first.id, 'the same input must resolve to the existing snapshot');
    assert.equal(repeat.snapshot_fingerprint, first.snapshot_fingerprint, 'the fingerprint must be stable');
    assert.equal(countRows(), before + 1, 'a repeated input must not create a second snapshot');

    // History is not rewritten by the repeat.
    assert.equal(repeat.captured_at, first.captured_at, 'captured_at must not be rewritten');
    assert.equal(repeat.captured_by, first.captured_by, 'captured_by must not be rewritten');
    assert.equal(repeat.notes_json, first.notes_json, 'notes_json must not be rewritten');
    assert.equal(repeat.parameter_set_hash, first.parameter_set_hash, 'parameter_set_hash must not be rewritten');
    assert.equal(repeat.rule_set_hash, first.rule_set_hash, 'rule_set_hash must not be rewritten');
    assert.equal(repeat.profile_effective_state_hash, first.profile_effective_state_hash,
      'profile_effective_state_hash must not be rewritten');
    assert.equal(repeat.business_date, first.business_date, 'business_date must not be rewritten');
    assert.equal(repeat.scope_type, first.scope_type, 'scope_type must not be rewritten');

    // Invalid input writes nothing at all.
    assert.throws(() => ensureCreditPolicySnapshot(db, { ...input, parameterSetHash: 'not-a-hash' }),
      (error) => error.status === 400);
    assert.equal(countRows(), before + 1, 'an invalid input must not write any snapshot');

    // A different hash triple is a different snapshot (uniqueness by fingerprint).
    const other = ensureCreditPolicySnapshot(db, { ...input, profileEffectiveStateHash: 'd'.repeat(64) });
    assert.notEqual(other.id, first.id, 'a different hash triple must be a different snapshot');
    assert.equal(countRows(), before + 2, 'a distinct fingerprint must persist its own snapshot');
  });
});

test('T5 the additive export is inert and introduces no second algorithm or resolver', () => {
  // 5a. Removing the appended export block reproduces the W11-SEC-01 frozen digest.
  const source = readFileSync(join(repoRoot, 'server/modules/credit-check.js'), 'utf8');
  const index = source.indexOf(U1_EXPORT_MARKER);
  assert.ok(index > 0, 'the appended export block must exist');
  const stripped = Buffer.from(source.slice(0, index), 'utf8');
  assert.equal(createHash('sha256').update(stripped).digest('hex'), W11_SEC_FROZEN_CREDIT_CHECK_SHA256,
    'credit-check.js minus the appended export must be byte-identical to the W11-SEC-01 frozen payload');
  assert.match(source.slice(index), /export \{ buildScopeHashes, CREDIT_CHECK_RESULT_SCOPE \};/,
    'the appended block must be exactly the authorised named export');

  // 5b. The exported Scope constant carries its frozen content, unchanged.
  assert.deepEqual(CREDIT_CHECK_RESULT_SCOPE, {
    aggregateExpr: "scope_type='CUSTOMER_AGGREGATE' AND credit_profile_id IS NOT NULL",
    selfExpr: "scope_type='SALESPERSON_SUB_LIMIT' AND credit_profile_id IN (SELECT id FROM credit_profile WHERE salesperson_scope_key=?)",
  }, 'the exported Scope constant content must be unchanged');

  // 5c. buildScopeHashes keeps its input/output contract and stays deterministic.
  withFixture((db) => {
    const scopes = [{
      scopeType: 'CUSTOMER_AGGREGATE',
      stage: 'SO_SUBMIT',
      profile: {
        id: 'cp-u1', anchor_id: 'anchor-u1', credit_limit_cents: 100000,
        status: 'ACTIVE', initial_state: 'NORMAL', rating_grade: 'A',
        rating_effective_from: '2026-01-01', rating_effective_to: null,
        overdue_day_policy: 'DEFAULT', rule_id: 'rule-u1',
        effective_from: '2026-01-01', effective_to: null,
      },
    }];
    const hashes = buildScopeHashes(db, { scopes, businessDate: '2026-10-28' });
    assert.deepEqual(Object.keys(hashes).sort(),
      ['parameterSetHash', 'profileEffectiveStateHash', 'ruleSetHash'],
      'the hash builder output contract must be unchanged');
    for (const [key, value] of Object.entries(hashes)) {
      assert.match(value, /^[0-9a-f]{64}$/, `${key} must be a 64 character lowercase hex digest`);
    }
    const again = buildScopeHashes(db, { scopes, businessDate: '2026-10-28' });
    assert.deepEqual(again, hashes, 'the hash builder must be deterministic for the same input');
  });

  // 5d. Exactly one Scope resolver, one predicate projection, one hash builder
  //     and one fingerprint algorithm exist.
  const scopeSource = readFileSync(join(repoRoot, 'server/modules/credit-scope.js'), 'utf8');
  const checkSource = readFileSync(join(repoRoot, 'server/modules/credit-check.js'), 'utf8');
  const policySource = readFileSync(join(repoRoot, 'server/modules/credit-policy.js'), 'utf8');

  const countOf = (needle, haystack) => haystack.split(needle).length - 1;
  assert.equal(countOf('export function resolveCreditReadMode', scopeSource), 1,
    'there must be exactly one Credit Read Mode resolver');
  assert.equal(countOf('export function creditScopePredicate', scopeSource), 1,
    'there must be exactly one Scope predicate projection');
  assert.equal(countOf('function sha256(', checkSource), 1,
    'there must be exactly one hash builder in credit-check.js');
  assert.equal(countOf('function canonicalJson(', checkSource), 1,
    'there must be exactly one canonical JSON serialiser in credit-check.js');
  assert.equal(countOf('createHash(', policySource), 1,
    'there must be exactly one digest computation in credit-policy.js');
  assert.equal(countOf('`CSP1:${', policySource), 1,
    'there must be exactly one fingerprint algorithm in credit-policy.js');
  assert.equal(countOf('export function computePolicySnapshotFingerprint', policySource), 1,
    'the fingerprint function must be exported exactly once');
});
