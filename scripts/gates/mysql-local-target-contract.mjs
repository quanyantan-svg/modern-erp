// The unified local MySQL test target contract.
//
// One MySQL 8 instance, one disposable test schema and one least-privilege
// test account serve every protected MySQL gate in this repository. This file
// is the single canonical statement of that target, so the setup helper, the
// read-only preflight, the baseline establishment and the one-command launcher
// cannot drift apart.
//
// Nothing in this file is a secret. The test account password exists only as a
// DPAPI blob under the current Windows user's LocalAppData; it is never
// written here, into the repository, into a log or onto a command line.
//
// The authoritative least-privilege check is the repository's own
// `assertExactLeastPrivilegeGrants` in
// `server/test-utils/mysql-wave10-campaign-target.js`. It is deliberately not
// restated here: a second privilege list would be a second contract.
//
// Requirement : document.md §4.1 `W11-SEC-01`, §8 A-D2-*
// Design      : solution.md §37.54.7.11, §37.54.14.4, §37.54.15.2

export const MYSQL_LOCAL_TARGET = Object.freeze({
  host: '127.0.0.1',
  port: 3306,
  database: 'modern_erp_domain_test',
  user: 'modern_erp_test',
});

/** The exact disposable-target identity string the protected guard demands. */
export const MYSQL_LOCAL_DISPOSABLE_TARGET =
  `mysql://${MYSQL_LOCAL_TARGET.user}@${MYSQL_LOCAL_TARGET.host}:${MYSQL_LOCAL_TARGET.port}/${MYSQL_LOCAL_TARGET.database}`;

/**
 * The environment variables that carry the protected identity contract into a
 * gate child process.
 *
 * The `ERP_MYSQL_WAVE10_*` names are historical: the protected runner that
 * enforces the contract was introduced for the Wave 10 campaign, and the
 * Wave 11 gate reuses that runner unchanged rather than forking a second
 * general database test architecture. The semantics behind the names are the
 * general protected-target contract.
 */
export const MYSQL_LOCAL_EXPECTED_ENV = Object.freeze({
  serverUuid: 'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID',
  currentUser: 'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
  grantsSha256: 'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256',
  versionPolicy: 'ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY',
  initialInventory: 'ERP_MYSQL_WAVE10_INITIAL_INVENTORY',
});

/** The five object categories every MySQL gate must leave behind at zero. */
export const MYSQL_LOCAL_OBJECT_CATEGORIES = Object.freeze([
  'tables', 'views', 'triggers', 'routines', 'events',
]);

/** The fixed identity baseline file, written next to the encrypted credential. */
export const MYSQL_LOCAL_BASELINE_ENV = 'MYSQL_LOCAL_BASELINE_PATH';
