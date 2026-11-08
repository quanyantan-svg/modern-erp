// OUT-001 真实 MySQL 8 Gate 的静态前置检查。
//
// 它在 ACK-4 能力被消费**之前**运行，只证明「合同与目标绑定是自洽的」：
// 固定 disposable 目标、MySQL 8 策略、空对象初始策略、固定 Manifest 与固定
// 套件文件。它不打开 MySQL，不做 destructive 操作。

import { OUT_001_MYSQL_MANIFEST, OUT_001_MYSQL_MANIFEST_NAME } from './ack4/ack4-runtime.mjs';
import { MYSQL_LOCAL_DISPOSABLE_TARGET, MYSQL_LOCAL_OBJECT_CATEGORIES, MYSQL_LOCAL_TARGET } from './mysql-local-target-contract.mjs';

/** OUT-001 Gate 只承认这一个套件文件；不接受任意传入脚本。 */
export const OUT_001_MYSQL_SUITE_FILE = 'server/mysql-out001.integration.js';

const REQUIRED_ENVIRONMENT = Object.freeze([
  'ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD',
  'ERP_DB_BACKEND', 'ERP_TEST_DB_BACKEND',
  'ERP_MYSQL_TEST_DISPOSABLE_TARGET', 'ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS',
  'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID', 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
  'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256', 'ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY',
  'ERP_MYSQL_WAVE10_INITIAL_INVENTORY',
]);

function refusal(message) {
  return new Error(`OUT-001 MYSQL STATIC PREFLIGHT REFUSED: ${message}`);
}

function assertTarget(target) {
  for (const key of ['host', 'port', 'database', 'user', 'selectedDatabase', 'currentUser', 'serverUuid', 'grantsSha256']) {
    if (target?.[key] === undefined || target?.[key] === null || String(target[key]).trim() === '') {
      throw refusal(`target.${key} is required`);
    }
  }
  if (target.database !== target.selectedDatabase) throw refusal('target.selectedDatabase must equal target.database');
  if (!/^[0-9a-f]{64}$/.test(String(target.grantsSha256))) throw refusal('target.grantsSha256 must be a SHA-256 digest');
  if (String(target.database) !== MYSQL_LOCAL_TARGET.database) throw refusal('the target is not the one approved local test schema');
  if (String(target.user) !== MYSQL_LOCAL_TARGET.user) throw refusal('the target is not the one approved local test account');
  if (String(target.host) !== MYSQL_LOCAL_TARGET.host) throw refusal('the target host is not the one approved local host');
  if (Number(target.port) !== MYSQL_LOCAL_TARGET.port) throw refusal('the target port is not the one approved local port');
}

export function assertOut001MySqlStaticPreflight({ target, environment = process.env }) {
  for (const name of REQUIRED_ENVIRONMENT) {
    if (!String(environment[name] || '').trim()) throw refusal(`${name} is required`);
  }
  if (environment.ERP_DB_BACKEND !== 'mysql' || environment.ERP_TEST_DB_BACKEND !== 'mysql') {
    throw refusal('the MySQL backend is required on both ERP_DB_BACKEND and ERP_TEST_DB_BACKEND');
  }
  if (environment.ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY !== 'MYSQL_8') throw refusal('the MYSQL_8 version policy is required');
  if (environment.ERP_MYSQL_WAVE10_INITIAL_INVENTORY !== 'EMPTY_ONLY') throw refusal('the EMPTY_ONLY initial inventory policy is required');
  if (environment.ERP_MYSQL_TEST_DISPOSABLE_TARGET !== MYSQL_LOCAL_DISPOSABLE_TARGET) {
    throw refusal('the disposable target does not match the one approved local target');
  }
  if (JSON.stringify(OUT_001_MYSQL_MANIFEST) !== JSON.stringify([
    'RESET_SCHEMA_PRE_RUN', 'BOOTSTRAP_CURRENT_SCHEMA', 'RUN_OUT001_HTTP_FIXTURES', 'CLEANUP_SCHEMA_POST_RUN',
  ])) {
    throw refusal('the OUT-001 operation manifest drifted');
  }
  assertTarget(target);
  return Object.freeze({
    manifest: OUT_001_MYSQL_MANIFEST_NAME,
    operations: OUT_001_MYSQL_MANIFEST,
    suiteFile: OUT_001_MYSQL_SUITE_FILE,
    objectCategories: MYSQL_LOCAL_OBJECT_CATEGORIES,
    target: Object.freeze({ ...target }),
  });
}

export const OUT_001_MYSQL_REQUIRED_ENVIRONMENT = REQUIRED_ENVIRONMENT;
