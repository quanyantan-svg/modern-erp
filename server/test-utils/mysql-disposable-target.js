const DISPOSABLE_NAME_HINT = /(?:test|phase7[abc]|disposable)/i;

export const MYSQL_DESTRUCTIVE_OPERATIONS_ACK =
  'DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP';

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

export function resetAuthorizedDisposableMySqlSchema(db, config, env = process.env) {
  const authorization = assertAuthorizedDisposableMySqlTarget(config, env);
  const actualDatabase = db.prepare('SELECT DATABASE() database_name').get()?.database_name;
  if (actualDatabase !== config.database) {
    throw new Error(`MYSQL DISPOSABLE TARGET REFUSED: SELECT DATABASE()=${actualDatabase} expected ${config.database}`);
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
