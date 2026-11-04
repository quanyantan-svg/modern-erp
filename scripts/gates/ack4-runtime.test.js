import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  Ack4BlockedError, ACK4_CONSUME_WINDOW_MS, M1_CORE_MANIFEST, assertNoAck4Quarantine,
  consumeAck4Record, consumeChildLease, consumePortableChildLease, finalizeAck4Run,
  issueChildLease, issuePortableChildLease, validateAck4Approval,
} from './ack4/ack4-runtime.mjs';

const target = Object.freeze({
  host: '127.0.0.1', port: 3306, database: 'modern_erp_m1_test', user: 'erp_test',
  selectedDatabase: 'modern_erp_m1_test', currentUser: 'erp_test@localhost',
  serverUuid: '00000000-0000-0000-0000-000000000001', grantsSha256: 'a'.repeat(64),
});
const commitSha = 'b'.repeat(40);
const runId = '123e4567-e89b-42d3-a456-426614174000';

function record(now = Date.now()) {
  return {
    version: 1, runId, commitSha, manifest: 'M1_CORE_G07_V1', operations: [...M1_CORE_MANIFEST], target,
    approval: { subject: 'owner', channel: 'session', reference: 'approval-1', summary: 'approved exact run' },
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + ACK4_CONSUME_WINDOW_MS).toISOString(),
  };
}

function expected() {
  return { runId, commitSha, manifest: 'M1_CORE_G07_V1', operations: M1_CORE_MANIFEST, target, sid: 'S-1-5-21-test' };
}

describe('ACK-4 pure simulation (no database and no MySQL connection)', () => {
  test('missing, expired, target drift and operation drift fail closed', () => {
    const now = Date.now();
    assert.throws(() => validateAck4Approval(null, expected(), now), Ack4BlockedError);
    assert.throws(() => validateAck4Approval(record(now - ACK4_CONSUME_WINDOW_MS - 1), expected(), now), /consumption window/);
    assert.throws(() => validateAck4Approval(record(now), { ...expected(), target: { ...target, database: 'other', selectedDatabase: 'other' } }, now), /target identity drifted/);
    assert.throws(() => validateAck4Approval(record(now), { ...expected(), operations: M1_CORE_MANIFEST.slice(0, 3) }, now), /operations/);
  });

  test('atomic one-time consumption refuses sequential and concurrent double consumption', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-ack4-'));
    try {
      const issued = join(dir, `${runId}.issued`);
      writeFileSync(issued, JSON.stringify(record()));
      const input = { issuedPath: issued, consumedDir: join(dir, 'consumed'), expected: expected(), decrypt: (bytes) => JSON.parse(bytes), rootPid: 100, rootStartedAt: '2026-11-04T00:00:00.000Z' };
      const outcomes = await Promise.allSettled([
        Promise.resolve().then(() => consumeAck4Record(input)),
        Promise.resolve().then(() => consumeAck4Record(input)),
      ]);
      assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
      assert.throws(() => consumeAck4Record(input), /missing or already consumed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('root/child subset, process tree, replay and drift are continuously checked', () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-ack4-child-'));
    try {
      const issued = join(dir, `${runId}.issued`);
      writeFileSync(issued, JSON.stringify(record()));
      const root = consumeAck4Record({ issuedPath: issued, consumedDir: join(dir, 'consumed'), expected: expected(), decrypt: (bytes) => JSON.parse(bytes), rootPid: 100, rootStartedAt: 'root-start' });
      const child = issueChildLease(root, { childPid: 200, childStartedAt: 'child-start', operations: ['RUN_M1_HTTP_FIXTURES'] });
      consumeChildLease(child, { rootLease: root, childPid: 200, childStartedAt: 'child-start', operation: 'RUN_M1_HTTP_FIXTURES', commitSha, target, manifest: 'M1_CORE_G07_V1' });
      assert.throws(() => consumeChildLease(child, { rootLease: root, childPid: 200, childStartedAt: 'child-start', operation: 'RUN_M1_HTTP_FIXTURES', commitSha, target, manifest: 'M1_CORE_G07_V1' }), /replayed/);
      assert.throws(() => issueChildLease(root, { childPid: 201, childStartedAt: 'x', operations: ['DROP_DATABASE'] }), /outside the root lease/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('portable child lease binds PID/parent/SHA/target/operation and is atomically one-time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-ack4-portable-'));
    try {
      const issued = join(dir, `${runId}.issued`);
      writeFileSync(issued, JSON.stringify(record()));
      const root = consumeAck4Record({ issuedPath: issued, consumedDir: join(dir, 'root-consumed'), expected: expected(), decrypt: (bytes) => JSON.parse(bytes), rootPid: 100, rootStartedAt: 'root-start' });
      const child = issuePortableChildLease(root, { childPid: 200, childStartedAt: 'child-start', operation: 'RUN_M1_HTTP_FIXTURES' });
      const leasePath = join(dir, 'child.json'); writeFileSync(leasePath, JSON.stringify(child));
      const input = {
        leasePath, consumedDir: join(dir, 'child-consumed'), rootNonce: root.nonce,
        expected: { rootPid: 100, childPid: 200, childStartedAt: 'child-start', commitSha, target, manifest: 'M1_CORE_G07_V1', operation: 'RUN_M1_HTTP_FIXTURES' },
      };
      assert.equal(consumePortableChildLease(input).operation, 'RUN_M1_HTTP_FIXTURES');
      assert.throws(() => consumePortableChildLease(input), /missing|already consumed|ENOENT/);

      const tamperedPath = join(dir, 'tampered.json');
      writeFileSync(tamperedPath, JSON.stringify({ ...child, childPid: 999 }));
      assert.throws(() => consumePortableChildLease({ ...input, leasePath: tamperedPath }), /signature is invalid/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('cleanup failure creates quarantine; successful cleanup reaches terminal state without renewal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'modern-erp-ack4-cleanup-'));
    try {
      const makeRoot = (suffix) => {
        const localRecord = { ...record(), runId: `123e4567-e89b-42d3-a456-42661417400${suffix}` };
        const issued = join(dir, `${suffix}.issued`); writeFileSync(issued, JSON.stringify(localRecord));
        return consumeAck4Record({ issuedPath: issued, consumedDir: join(dir, 'consumed'), expected: { ...expected(), runId: localRecord.runId }, decrypt: (bytes) => JSON.parse(bytes), rootPid: 100, rootStartedAt: 'root-start' });
      };
      const quarantined = makeRoot('1');
      assert.equal(finalizeAck4Run(quarantined, { testsPassed: false, cleanupProven: false, childrenExited: true, quarantineDir: join(dir, 'quarantine'), inventory: ['leftover'] }), 'CLEANUP_UNVERIFIED');
      assert.throws(() => assertNoAck4Quarantine(join(dir, 'quarantine'), target), /quarantined/);
      const clean = makeRoot('2');
      assert.equal(finalizeAck4Run(clean, { testsPassed: false, cleanupProven: true, childrenExited: true, quarantineDir: join(dir, 'quarantine') }), 'FAILED');
      assert.equal(clean.state, 'FAILED');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
