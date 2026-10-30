// W11-A U3 Selector protected real-MySQL E3 gate. The general protected runner
// remains the single owner of target identity, reset, TAP validation and final
// cleanup.
//
// Requirement : document.md R-U3-GATE-01 .. R-U3-GATE-06
// Design      : solution.md §37.54.36.7
//
// This gate is independent from the frozen W11-A U2 E3 gate
// (scripts/gates/mysql-sales-wave11-a-gate.mjs). It runs its own campaign, so
// it never shares a campaign id or a lease with the frozen suite, and it never
// modifies the frozen suite or the frozen runner.

import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';

export const W11_A_SELECTOR_MYSQL_SUITES = Object.freeze([
  Object.freeze({
    label: 'W11-A-U3-SELECTOR-OPTIONS',
    file: 'server/mysql-sales-customer-wave11-a-credit-query-options.integration.js',
  }),
]);

await runProtectedMySqlCampaign({
  campaign: 'W11-A U3 SELECTOR MYSQL E3 ACCEPTANCE',
  suites: W11_A_SELECTOR_MYSQL_SUITES,
});
