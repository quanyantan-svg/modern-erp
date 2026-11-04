// W11-A U2 protected real-MySQL E3 gate. The general protected runner remains
// the single owner of target identity, reset, TAP validation and final cleanup.

import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';
import { blockUnmigratedAck4Entry } from './ack4/ack4-runtime.mjs';

blockUnmigratedAck4Entry('mysql-sales-wave11-a-gate.mjs');

export const W11_A_MYSQL_SUITES = Object.freeze([
  Object.freeze({
    label: 'W11-A-U2-CREDIT-QUERY',
    file: 'server/mysql-sales-customer-wave11-a-credit-query.integration.js',
  }),
]);

await runProtectedMySqlCampaign({
  campaign: 'W11-A U2 MYSQL E3 ACCEPTANCE',
  suites: W11_A_MYSQL_SUITES,
});
