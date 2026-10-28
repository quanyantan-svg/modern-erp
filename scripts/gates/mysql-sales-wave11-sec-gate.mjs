// W11-SEC-01 protected MySQL acceptance gate.
//
// This gate reuses the existing protected disposable-MySQL campaign runner
// unchanged. The runner was introduced for the Wave 10 campaign, so its
// authorization environment variables carry the WAVE10 prefix; the semantics
// behind them are the general protected-target contract:
//
//   ERP_DB_HOST / ERP_DB_PORT / ERP_DB_NAME / ERP_DB_USER / ERP_DB_PASSWORD
//   ERP_MYSQL_TEST_ALLOW_RESET=true
//   ERP_MYSQL_TEST_DISPOSABLE_TARGET=<exactly mysql://user@host:port/database>
//   ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS=DROP_ALL_TABLES,RECREATE_SCHEMA,DROP_ALL_TABLES_ON_CLEANUP
//   ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID / _EXPECTED_CURRENT_USER / _EXPECTED_GRANTS_SHA256
//   ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY=MYSQL_8
//   ERP_MYSQL_WAVE10_INITIAL_INVENTORY=EMPTY_ONLY
//
// Forking a second protected runner for W11-SEC would create a second general
// database test architecture, which the acceptance boundary forbids. The gate
// therefore runs the W11-SEC suite alone: it does not run, replace or depend
// on the Wave 10 campaign suites, and the Wave 10 campaign is not a
// prerequisite for it.
//
// The runner guarantees, for the target it is given:
//   - the disposable-target identity is verified against the exact approved
//     string before any statement is prepared;
//   - `SELECT DATABASE()`, `CURRENT_USER()`, the server UUID, the MySQL 8
//     version and the effective grant fingerprint must all match the
//     approved values;
//   - the initial inventory must be empty;
//   - the schema is reset before the suite and again afterwards, and the
//     final object inventory must be zero.
//
// Requirement : document.md §4 D2, §4.1 `W11-SEC-01`
// Design      : solution.md §37.54.7.11, §37.54.14.4, §37.54.15.2

import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';

export const W11_SEC_MYSQL_SUITES = Object.freeze([
  Object.freeze({ label: 'W11-SEC-SCOPE', file: 'server/mysql-sales-customer-wave11-sec-scope.integration.js' }),
]);

await runProtectedMySqlCampaign({
  campaign: 'W11-SEC-01 MYSQL ACCEPTANCE',
  suites: W11_SEC_MYSQL_SUITES,
});
