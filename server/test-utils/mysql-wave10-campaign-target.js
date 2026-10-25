import { createHash, randomUUID } from 'node:crypto';
import { MySqlSyncAdapter } from '../database/mysql-adapter.js';
import {
  assertAuthorizedDisposableMySqlTarget,
  mysqlDisposableTargetIdentity,
} from './mysql-disposable-target.js';

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;
const REQUIRED_WAVE10_ENV = Object.freeze([
  'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID',
  'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
  'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256',
]);
const activeCampaignLeases = new Map();
const REQUIRED_SCHEMA_PRIVILEGES = Object.freeze([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX',
  'REFERENCES', 'TRIGGER', 'CREATE VIEW',
]);
const REQUIRED_PERFORMANCE_SCHEMA_TABLES = Object.freeze([
  'DATA_LOCKS', 'DATA_LOCK_WAITS', 'THREADS',
]);

function refusal(message) {
  return Object.assign(new Error(`WAVE 10 MYSQL TARGET REFUSED: ${message}`), {
    code: 'WAVE10_MYSQL_TARGET_REFUSED',
  });
}

function scalarCount(db, sql) {
  const count = Number(db.prepare(sql).get()?.count);
  if (!Number.isSafeInteger(count) || count < 0) throw refusal('invalid object inventory count');
  return count;
}

export function wave10ObjectInventory(db) {
  return Object.freeze({
    tables: scalarCount(db, "SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"),
    views: scalarCount(db, "SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='VIEW'"),
    triggers: scalarCount(db, 'SELECT COUNT(*) count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'),
    routines: scalarCount(db, 'SELECT COUNT(*) count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()'),
    events: scalarCount(db, 'SELECT COUNT(*) count FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()'),
  });
}

export function assertWave10ZeroObjects(inventory, label = 'Wave 10 target') {
  for (const [kind, count] of Object.entries(inventory)) {
    if (count !== 0) throw refusal(`${label}: expected zero ${kind}, found ${count}`);
  }
  return inventory;
}

export function normalizeGrantLines(rows) {
  return rows.flatMap((row) => Object.values(row).map((value) => String(value).trim()))
    .filter(Boolean).sort();
}

export function grantFingerprint(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function normalizeGrantObject(value) {
  return String(value).replaceAll('`', '').replace(/\s+/g, '').toUpperCase();
}

function parsePrivilegeList(value) {
  return new Set(String(value).split(',').map((item) => item.trim().replace(/\s+/g, ' ').toUpperCase()).filter(Boolean));
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...expected].every((item) => actual.has(item));
}

function assertExactLeastPrivilegeGrants(lines, database) {
  const requiredSchema = new Set(REQUIRED_SCHEMA_PRIVILEGES);
  const actualSchema = new Set();
  const performanceReads = new Set();
  const targetSchema = `${String(database).toUpperCase()}.*`;

  for (const rawLine of lines) {
    const line = String(rawLine).trim();
    const upper = line.toUpperCase();
    if (/\bWITH\s+GRANT\s+OPTION\b/.test(upper)) throw refusal('WITH GRANT OPTION is forbidden');
    if (/^SET\s+DEFAULT\s+ROLE\b/.test(upper) || (/^GRANT\s+/.test(upper) && !/\sON\s/.test(upper))) {
      throw refusal('role inheritance is forbidden');
    }
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i.exec(line);
    if (!match) throw refusal('unrecognized effective grant');
    const privileges = parsePrivilegeList(match[1]);
    const object = normalizeGrantObject(match[2]);
    if (object === '*.*') {
      if (!sameSet(privileges, new Set(['USAGE']))) throw refusal('global privileges other than USAGE are forbidden');
      continue;
    }
    if (object === targetSchema) {
      for (const privilege of privileges) actualSchema.add(privilege);
      continue;
    }
    const performanceMatch = /^PERFORMANCE_SCHEMA\.([A-Z0-9_]+)$/.exec(object);
    if (performanceMatch && REQUIRED_PERFORMANCE_SCHEMA_TABLES.includes(performanceMatch[1])) {
      if (!sameSet(privileges, new Set(['SELECT']))) throw refusal('Performance Schema grants must be SELECT only');
      performanceReads.add(performanceMatch[1]);
      continue;
    }
    throw refusal(`unrelated or excessive grant scope (${object})`);
  }

  if (!sameSet(actualSchema, requiredSchema)) {
    const missing = REQUIRED_SCHEMA_PRIVILEGES.filter((item) => !actualSchema.has(item));
    const extra = [...actualSchema].filter((item) => !requiredSchema.has(item));
    throw refusal(`target-schema privilege mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }
  if (!sameSet(performanceReads, new Set(REQUIRED_PERFORMANCE_SCHEMA_TABLES))) {
    throw refusal('exact Performance Schema table reads are required');
  }
}

export function assertWave10StaticAuthorization(config, env = process.env) {
  const base = assertAuthorizedDisposableMySqlTarget(config, env);
  const missing = REQUIRED_WAVE10_ENV.filter((name) => !String(env[name] ?? '').trim());
  if (missing.length) throw refusal(`${missing.join(', ')} required`);
  if (env.ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY !== 'MYSQL_8') throw refusal('MYSQL_8 version policy required');
  if (env.ERP_MYSQL_WAVE10_INITIAL_INVENTORY !== 'EMPTY_ONLY') throw refusal('EMPTY_ONLY initial inventory policy required');
  if (!/^[0-9a-f]{64}$/i.test(env.ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256)) throw refusal('grant fingerprint must be SHA-256');
  return Object.freeze({ ...base, identity: mysqlDisposableTargetIdentity(config) });
}

export function readWave10ConnectedIdentity(db) {
  const row = db.prepare(`SELECT DATABASE() database_name, CURRENT_USER() current_user_name,
    @@server_uuid server_uuid, VERSION() version`).get();
  const grants = normalizeGrantLines(db.prepare('SHOW GRANTS FOR CURRENT_USER()').all());
  return Object.freeze({
    database: String(row?.database_name ?? ''),
    currentUser: String(row?.current_user_name ?? ''),
    serverUuid: String(row?.server_uuid ?? ''),
    version: String(row?.version ?? ''),
    grantDigest: grantFingerprint(grants),
    grants,
  });
}

export function verifyWave10ConnectedIdentity(db, config, env = process.env) {
  const authorization = assertWave10StaticAuthorization(config, env);
  const actual = readWave10ConnectedIdentity(db);
  if (actual.database !== config.database) throw refusal(`SELECT DATABASE() mismatch (${actual.database || 'empty'})`);
  if (actual.currentUser !== env.ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER) throw refusal('CURRENT_USER() mismatch');
  if (actual.serverUuid !== env.ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID) throw refusal('server UUID mismatch');
  if (!/^8\./.test(actual.version)) throw refusal(`MySQL 8 required (actual ${actual.version || 'unknown'})`);
  if (actual.grantDigest.toLowerCase() !== env.ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256.toLowerCase()) {
    throw refusal('effective grant fingerprint mismatch');
  }
  assertExactLeastPrivilegeGrants(actual.grants, config.database);
  return Object.freeze({
    identity: authorization.identity,
    database: actual.database,
    currentUser: actual.currentUser,
    serverUuid: actual.serverUuid,
    version: actual.version,
    grantDigest: actual.grantDigest,
  });
}

export function authorizeInitialWave10Target(db, config, env = process.env, campaignId = randomUUID()) {
  const verified = verifyWave10ConnectedIdentity(db, config, env);
  const inventory = wave10ObjectInventory(db);
  assertWave10ZeroObjects(inventory, 'initial inventory');
  if (activeCampaignLeases.has(verified.identity)) throw refusal('target already has an active Wave 10 campaign lease');
  const lease = Object.freeze({
    ...verified,
    campaignId,
    inventoryPolicy: 'EMPTY_ONLY',
  });
  activeCampaignLeases.set(verified.identity, lease);
  return lease;
}

export function releaseWave10CampaignLease(lease) {
  if (!lease?.identity || !lease?.campaignId) throw refusal('valid campaign lease required for release');
  const active = activeCampaignLeases.get(lease.identity);
  if (!active || active.campaignId !== lease.campaignId) throw refusal('campaign lease release mismatch');
  activeCampaignLeases.delete(lease.identity);
}

// §37.39.3.2 — identity drift revokes the lease before any destructive action.
// The lease is a capability, so a failed revalidation withdraws it instead of
// leaving a stale grant behind.
export function revokeWave10CampaignLease(lease) {
  if (!lease?.identity || !lease?.campaignId) return false;
  const active = activeCampaignLeases.get(lease.identity);
  if (!active || active.campaignId !== lease.campaignId) return false;
  activeCampaignLeases.delete(lease.identity);
  return true;
}

// §37.39.3.2 — the bounded report is the only shape allowed to leave the
// guard. It carries the password-free identity, a server-UUID digest, the
// version, the account identity, the grant digest and the inventory policy.
// Raw grants, the raw UUID and every secret stay inside the guard.
export function wave10TargetReport(lease) {
  if (!lease?.identity) throw refusal('valid campaign lease required for report');
  return Object.freeze({
    identity: lease.identity,
    database: lease.database,
    currentUser: lease.currentUser,
    serverUuidDigest: createHash('sha256').update(String(lease.serverUuid || '')).digest('hex'),
    version: lease.version,
    grantDigest: lease.grantDigest,
    campaignId: lease.campaignId,
    inventoryPolicy: lease.inventoryPolicy,
  });
}

export function encodeWave10CampaignLease(lease) {
  return Buffer.from(JSON.stringify(lease), 'utf8').toString('base64url');
}

export function decodeWave10CampaignLease(value) {
  try {
    const lease = JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
    if (!lease || typeof lease !== 'object' || !lease.campaignId || !lease.identity) throw new Error('invalid');
    return Object.freeze(lease);
  } catch {
    throw refusal('runner-issued campaign lease required');
  }
}

function assertLeaseMatches(lease, verified, env) {
  if (lease.campaignId !== env.ERP_MYSQL_WAVE10_CAMPAIGN_ID) throw refusal('campaign id mismatch');
  for (const key of ['identity', 'database', 'currentUser', 'serverUuid', 'grantDigest']) {
    if (lease[key] !== verified[key]) throw refusal(`campaign lease ${key} mismatch`);
  }
}

function listObjects(db) {
  const tablesAndViews = db.prepare('SHOW FULL TABLES').all().map((row) => {
    const [name, type] = Object.values(row);
    return { name: String(name), type: String(type).toUpperCase() };
  });
  const triggers = db.prepare(`SELECT TRIGGER_NAME name FROM information_schema.TRIGGERS
    WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME`).all().map((row) => ({ name: String(row.name), type: 'TRIGGER' }));
  const routines = db.prepare(`SELECT ROUTINE_NAME name,ROUTINE_TYPE type FROM information_schema.ROUTINES
    WHERE ROUTINE_SCHEMA=DATABASE() ORDER BY ROUTINE_NAME`).all().map((row) => ({ name: String(row.name), type: String(row.type).toUpperCase() }));
  const events = db.prepare(`SELECT EVENT_NAME name FROM information_schema.EVENTS
    WHERE EVENT_SCHEMA=DATABASE() ORDER BY EVENT_NAME`).all().map((row) => ({ name: String(row.name), type: 'EVENT' }));
  const objects = [...tablesAndViews, ...triggers, ...routines, ...events];
  for (const object of objects) {
    if (!SAFE_IDENTIFIER.test(object.name)) throw refusal(`unsafe object name ${object.name}`);
    if (!['BASE TABLE', 'VIEW', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'EVENT'].includes(object.type)) {
      throw refusal(`unsupported object type ${object.type}`);
    }
  }
  return objects;
}

export function resetWave10CampaignSchema(db, config, lease, env = process.env) {
  let verified;
  try {
    verified = verifyWave10ConnectedIdentity(db, config, env);
    assertLeaseMatches(lease, verified, env);
  } catch (error) {
    revokeWave10CampaignLease(lease);
    throw error;
  }
  const objects = listObjects(db);
  const executeDrops = (type, keyword = type) => {
    for (const object of objects.filter((item) => item.type === type)) db.exec(`DROP ${keyword} IF EXISTS \`${object.name}\``);
  };
  db.exec('SET FOREIGN_KEY_CHECKS=0');
  try {
    executeDrops('EVENT');
    executeDrops('TRIGGER');
    executeDrops('VIEW');
    executeDrops('BASE TABLE', 'TABLE');
    executeDrops('PROCEDURE');
    executeDrops('FUNCTION');
  } finally {
    db.exec('SET FOREIGN_KEY_CHECKS=1');
  }
  return Object.freeze({ ...verified, dropped: objects.length });
}

function defaultOpenAdapter(config) {
  return new MySqlSyncAdapter({
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, ssl: config.ssl,
  });
}

export function createWave10MysqlLifecycle({ env = process.env, openAdapter = defaultOpenAdapter } = {}) {
  const lease = decodeWave10CampaignLease(env.ERP_MYSQL_WAVE10_CAMPAIGN_LEASE);
  const reverify = (db, config) => {
    try {
      const verified = verifyWave10ConnectedIdentity(db, config, env);
      assertLeaseMatches(lease, verified, env);
      return verified;
    } catch (error) {
      revokeWave10CampaignLease(lease);
      throw error;
    }
  };
  return Object.freeze({
    beforeCreate(config) {
      const db = openAdapter(config);
      try { reverify(db, config); } finally { db.close(); }
    },
    verify(db, config) { return reverify(db, config); },
    reset(db, config) { return resetWave10CampaignSchema(db, config, lease, env); },
  });
}

export const _testInternals = Object.freeze({
  assertExactLeastPrivilegeGrants,
  REQUIRED_SCHEMA_PRIVILEGES,
  REQUIRED_PERFORMANCE_SCHEMA_TABLES,
  assertLeaseMatches,
  listObjects,
  refusal,
  activeCampaignLeases,
  revokeWave10CampaignLease,
});
