// Establish the fixed identity baseline of the unified local MySQL target.
//
// The baseline records what the target IS, not what it may become: the
// database, the authenticated account, the server UUID, the server version
// and the SHA-256 fingerprint of the effective grants.
//
// This helper only READS. It never calls `createDatabase()`, so it never
// creates or drops a table, it never issues a GRANT and it never creates a
// schema or an account. It refuses to write a baseline for a target that
// violates the repository's own least-privilege contract, and it refuses to
// write a baseline for a target whose schema is not empty.
//
// The password is read from the environment and is never printed, written or
// passed on a command line.
//
// Requirement : document.md §4.1 `W11-SEC-01`, §8 A-D2-*
// Design      : solution.md §37.54.7.11, §37.54.14.4, §37.54.15.2

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MySqlSyncAdapter } from '../../server/database/mysql-adapter.js';
import {
  _testInternals,
  readWave10ConnectedIdentity,
  wave10ObjectInventory,
} from '../../server/test-utils/mysql-wave10-campaign-target.js';
import { MYSQL_LOCAL_BASELINE_ENV, MYSQL_LOCAL_DISPOSABLE_TARGET, MYSQL_LOCAL_TARGET } from './mysql-local-target-contract.mjs';

const { assertExactLeastPrivilegeGrants } = _testInternals;

const password = String(process.env.ERP_DB_PASSWORD || '');
const baselinePath = String(process.env[MYSQL_LOCAL_BASELINE_ENV] || '').trim();

function refuse(message) {
  const error = new Error(`MYSQL LOCAL BASELINE REFUSED: ${message}`);
  error.code = 'MYSQL_LOCAL_BASELINE_REFUSED';
  throw error;
}

if (!password) refuse('the test account password is not present in the environment');
if (!baselinePath) refuse(`the baseline output path (${MYSQL_LOCAL_BASELINE_ENV}) is not present in the environment`);

const host = String(process.env.ERP_DB_HOST || MYSQL_LOCAL_TARGET.host);
const port = Number(process.env.ERP_DB_PORT || MYSQL_LOCAL_TARGET.port);
const database = String(process.env.ERP_DB_NAME || MYSQL_LOCAL_TARGET.database);
const user = String(process.env.ERP_DB_USER || MYSQL_LOCAL_TARGET.user);

// The target is bound. A caller that points the environment at another schema
// is refused before a connection is opened.
if (host !== MYSQL_LOCAL_TARGET.host
  || port !== MYSQL_LOCAL_TARGET.port
  || database !== MYSQL_LOCAL_TARGET.database
  || user !== MYSQL_LOCAL_TARGET.user) {
  refuse('the environment does not describe the one approved local test target');
}

const adapter = new MySqlSyncAdapter({ host, port, database, user, password });

let identity;
let inventory;
try {
  identity = readWave10ConnectedIdentity(adapter);
  inventory = wave10ObjectInventory(adapter);
  assertExactLeastPrivilegeGrants(identity.grants, database);
} finally {
  adapter.close();
}

if (identity.database !== database) {
  refuse(`the session opened ${identity.database || 'an empty schema'} instead of ${database}`);
}
if (!/^8\./.test(identity.version)) {
  refuse(`the instance is not MySQL 8 (${identity.version})`);
}

const nonEmpty = Object.entries(inventory).filter(([, count]) => count !== 0);
if (nonEmpty.length) {
  refuse(`the target schema is not empty (${nonEmpty.map(([kind, count]) => `${kind}=${count}`).join(', ')})`);
}

const baseline = {
  schema: 'Modern ERP unified local MySQL test target',
  host,
  port,
  database,
  user,
  currentUser: identity.currentUser,
  serverUuid: identity.serverUuid,
  serverVersion: identity.version,
  grantsSha256: identity.grantDigest,
  disposableTarget: MYSQL_LOCAL_DISPOSABLE_TARGET,
  initialInventory: 'EMPTY_ONLY',
  establishedAt: new Date().toISOString(),
};

mkdirSync(dirname(baselinePath), { recursive: true });
writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  baseline,
  inventory,
  grants: identity.grants,
})}\n`);
