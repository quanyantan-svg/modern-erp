// Read-only verification of the unified local MySQL target.
//
// The helper opens a real session as the dedicated test account and proves:
//   - the exact connection target (database, account, server UUID, version);
//   - that the effective grants still satisfy the repository's own
//     least-privilege contract;
//   - that the target schema holds no object in any of the five object
//     categories;
//   - that the live identity still matches the fixed, non-secret baseline.
//
// The baseline is only ever COMPARED, never rewritten. A drifted identity is
// reported, not re-established: re-establishing it is a deliberate act of the
// setup script, not a side effect of a preflight.
//
// It never calls `createDatabase()`, so it never creates or drops a table.
//
// Requirement : document.md §4.1 `W11-SEC-01`, §8 A-D2-*
// Design      : solution.md §37.54.7.11, §37.54.14.4, §37.54.15.2

import { readFileSync } from 'node:fs';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import {
  _testInternals,
  readWave10ConnectedIdentity,
  wave10ObjectInventory,
} from '../../server/test-utils/mysql-wave10-campaign-target.js';
import { MYSQL_LOCAL_BASELINE_ENV, MYSQL_LOCAL_TARGET } from './mysql-local-target-contract.mjs';

const { assertExactLeastPrivilegeGrants } = _testInternals;

const baselinePath = String(process.env[MYSQL_LOCAL_BASELINE_ENV] || '').trim();
const password = String(process.env.ERP_DB_PASSWORD || '');

function refuse(message) {
  const error = new Error(`MYSQL LOCAL PREFLIGHT REFUSED: ${message}`);
  error.code = 'MYSQL_LOCAL_PREFLIGHT_REFUSED';
  throw error;
}

if (!baselinePath) refuse(`the fixed identity baseline path (${MYSQL_LOCAL_BASELINE_ENV}) is not present in the environment`);
if (!password) refuse('the test account password is not present in the environment');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
for (const name of ['host', 'port', 'database', 'user', 'currentUser', 'serverUuid', 'grantsSha256', 'disposableTarget']) {
  if (!baseline[name]) refuse(`the fixed identity baseline is incomplete (${name})`);
}

const host = String(process.env.ERP_DB_HOST || baseline.host);
const port = Number(process.env.ERP_DB_PORT || baseline.port);
const database = String(process.env.ERP_DB_NAME || baseline.database);
const user = String(process.env.ERP_DB_USER || baseline.user);

if (host !== MYSQL_LOCAL_TARGET.host
  || port !== MYSQL_LOCAL_TARGET.port
  || database !== MYSQL_LOCAL_TARGET.database
  || user !== MYSQL_LOCAL_TARGET.user) {
  refuse('the environment does not describe the one approved local test target');
}

const adapter = new MySqlSyncAdapter({ host, port, database, user, password });

let result;
try {
  const identity = readWave10ConnectedIdentity(adapter);
  const inventory = wave10ObjectInventory(adapter);
  assertExactLeastPrivilegeGrants(identity.grants, database);

  const drift = [];
  if (identity.database !== baseline.database) drift.push(`database (${identity.database || 'empty'})`);
  if (identity.currentUser !== baseline.currentUser) drift.push(`current user (${identity.currentUser})`);
  if (identity.serverUuid !== baseline.serverUuid) drift.push('server uuid');
  if (identity.grantDigest.toLowerCase() !== String(baseline.grantsSha256).toLowerCase()) drift.push('grant fingerprint');
  if (!/^8\./.test(identity.version)) drift.push(`server version (${identity.version})`);

  const nonEmpty = Object.entries(inventory)
    .filter(([, count]) => count !== 0)
    .map(([kind, count]) => `${kind}=${count}`);

  result = {
    ok: drift.length === 0 && nonEmpty.length === 0,
    identity: {
      database: identity.database,
      currentUser: identity.currentUser,
      serverVersion: identity.version,
      serverUuid: identity.serverUuid,
      grantsSha256: identity.grantDigest,
      grants: identity.grants,
    },
    inventory,
    drift,
    nonEmpty,
  };
} finally {
  adapter.close();
}

process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
