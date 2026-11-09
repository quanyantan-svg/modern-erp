import { assertActivePortableChildOperation } from '../../scripts/gates/ack4/ack4-runtime.mjs';

const DISPOSABLE_NAME_HINT = /(?:test|phase7[abc]|disposable)/i;

export const MYSQL_DESTRUCTIVE_OPERATIONS_ACK =
  'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP';

/**
 * The schema cleanup of a protected MySQL gate belongs to exactly one process:
 * the Root's `CLEANUP_SCHEMA_POST_RUN` child. A test process that runs inside
 * the gate may only close its own connection.
 *
 * `deferMySqlCleanup()` records that separation in the process that asks for a
 * cleanup, so `resetAuthorizedDisposableMySqlSchema()` becomes a no-op there
 * instead of dropping objects the Root still has to account for.
 */
let mysqlCleanupDeferral = null;

export function deferMySqlCleanup(reason) {
  mysqlCleanupDeferral = Object.freeze({
    reason: String(reason || '').trim() || 'UNSPECIFIED',
    deferredAt: new Date().toISOString(),
  });
  return mysqlCleanupDeferral;
}

export function mysqlCleanupDeferralState() {
  return mysqlCleanupDeferral;
}

export function mysqlDisposableTargetIdentity(config) {
  const host = String(config?.host ?? '').trim();
  const port = Number(config?.port);
  const database = String(config?.database ?? '').trim();
  const user = String(config?.user ?? '').trim();
  if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535 || !database || !user) {
    throw new Error('MYSQL DISPOSABLE TARGET REFUSED: incomplete host/port/database/user identity');
  }
  return `mysql://${user}@${host}:${port}/${database}`;
}

export function assertAuthorizedDisposableMySqlTarget(config, env = process.env) {
  const identity = mysqlDisposableTargetIdentity(config);
  if (env.ERP_MYSQL_TEST_ALLOW_RESET !== 'true') {
    throw new Error('MYSQL DISPOSABLE TARGET REFUSED: ERP_MYSQL_TEST_ALLOW_RESET=true required');
  }
  if (!DISPOSABLE_NAME_HINT.test(config.database)) {
    throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: database name lacks a disposable hint (${config.database})`);
  }
  const approvedIdentity = String(env.ERP_MYSQL_TEST_DISPOSABLE_TARGET ?? '').trim();
  if (!approvedIdentity || approvedIdentity !== identity) {
    throw new Error(
      `MYSQL DISPOSABLE TARGET REFUSED: ERP_MYSQL_TEST_DISPOSABLE_TARGET must exactly equal ${identity}`,
    );
  }
  const approvedOperations = String(env.ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS ?? '').trim();
  if (approvedOperations !== MYSQL_DESTRUCTIVE_OPERATIONS_ACK) {
    throw new Error(
      'MYSQL DISPOSABLE TARGET REFUSED: ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS must explicitly approve '
      + MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
    );
  }
  return Object.freeze({ identity, operations: MYSQL_DESTRUCTIVE_OPERATIONS_ACK });
}

export function disposableMySqlObjectInventory(db, database) {
  const tableRows = db.prepare('SHOW FULL TABLES').all();
  const inventory = { tables: 0, views: 0, triggers: 0, routines: 0, events: 0 };
  for (const row of tableRows) {
    const [, type] = Object.values(row);
    if (String(type).toUpperCase() === 'BASE TABLE') inventory.tables += 1;
    else if (String(type).toUpperCase() === 'VIEW') inventory.views += 1;
    else throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: unsupported object type ${type}`);
  }
  inventory.triggers = Number(db.prepare(
    'SELECT COUNT(*) count FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?',
  ).get(database)?.count || 0);
  inventory.routines = Number(db.prepare(
    'SELECT COUNT(*) count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?',
  ).get(database)?.count || 0);
  inventory.events = Number(db.prepare(
    'SELECT COUNT(*) count FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?',
  ).get(database)?.count || 0);
  return Object.freeze(inventory);
}

export function assertDisposableMySqlSchemaEmpty(db, config) {
  const actualDatabase = db.prepare('SELECT DATABASE() database_name').get()?.database_name;
  if (actualDatabase !== config.database) {
    throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: SELECT DATABASE()=${actualDatabase} expected ${config.database}`);
  }
  const inventory = disposableMySqlObjectInventory(db, config.database);
  const occupied = Object.entries(inventory).filter(([, count]) => count !== 0);
  if (occupied.length) {
    throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: EMPTY_ONLY recheck failed (${occupied.map(([kind, count]) => `${kind}=${count}`).join(',')})`);
  }
  return inventory;
}

export function resetAuthorizedDisposableMySqlSchema(db, config, env = process.env, { requireEmpty = false } = {}) {
  // A protected gate assigns the schema cleanup to exactly one process: the
  // Root's CLEANUP_SCHEMA_POST_RUN child. A test process that runs inside the
  // gate may only close its own connection. `deferMySqlCleanup()` makes that
  // separation enforceable instead of advisory: any schema cleanup requested
  // from a deferred process is recorded and NOT executed.
  const deferral = mysqlCleanupDeferralState();
  if (deferral) {
    return Object.freeze({
      identity: mysqlDisposableTargetIdentity(config),
      operations: MYSQL_DESTRUCTIVE_OPERATIONS_ACK,
      dropped: 0,
      deferred: true,
      deferral,
    });
  }
  const lease = assertActivePortableChildOperation([
    'RESET_SCHEMA_PRE_RUN', 'CLEANUP_SCHEMA_POST_RUN', 'CLEANUP_SCHEMA_RECOVERY',
  ]);
  if (lease.operation === 'RESET_SCHEMA_PRE_RUN' && requireEmpty !== true) {
    throw new Error('MYSQL DISPOSABLE TARGET REFUSED: RESET lease cannot DROP objects');
  }
  if (lease.operation !== 'RESET_SCHEMA_PRE_RUN' && requireEmpty === true) {
    throw new Error('MYSQL DISPOSABLE TARGET REFUSED: cleanup lease cannot masquerade as RESET');
  }
  const authorization = assertAuthorizedDisposableMySqlTarget(config, env);
  const actualDatabase = db.prepare('SELECT DATABASE() database_name').get()?.database_name;
  if (actualDatabase !== config.database) {
    throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: SELECT DATABASE()=${actualDatabase} expected ${config.database}`);
  }
  if (requireEmpty) {
    const inventory = assertDisposableMySqlSchemaEmpty(db, config);
    // EMPTY_ONLY means there is nothing for RESET to drop. Returning here is
    // stronger than listing a second time: an object concurrently created
    // after the proof can make bootstrap fail, but this RESET child can never
    // delete that unknown object.
    return Object.freeze({ ...authorization, dropped: 0, inventory });
  }
  const objects = db.prepare('SHOW FULL TABLES').all().map((row) => {
    const [name, type] = Object.values(row);
    if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: unsafe object name ${name}`);
    if (!['BASE TABLE', 'VIEW'].includes(String(type).toUpperCase())) {
      throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: unsupported object type ${type} for ${name}`);
    }
    return { name, type: String(type).toUpperCase() };
  });
  db.exec('SET FOREIGN_KEY_CHECKS=0');
  try {
    for (const object of objects.filter((item) => item.type === 'VIEW')) {
      db.exec(`DROP VIEW IF EXISTS \`${object.name}\``);
    }
    for (const object of objects.filter((item) => item.type === 'BASE TABLE')) {
      db.exec(`DROP TABLE IF EXISTS \`${object.name}\``);
    }
  } finally {
    db.exec('SET FOREIGN_KEY_CHECKS=1');
  }
  return Object.freeze({ ...authorization, dropped: objects.length });
}
