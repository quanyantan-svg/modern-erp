// W11-A U3 Demo Seed inventory protected real-MySQL gate.
//
// Requirement : document.md R-U3-INV-01 .. R-U3-INV-08
// Design      : solution.md §37.54.46.5, §37.54.46.6
//
// The general protected runner remains the single owner of target identity,
// reset, TAP validation and final cleanup. This gate adds no reset, no
// identity check, no cleanup, no TAP parser, no MySQL driver and no lease
// logic of its own.
//
// The gate is independent from the closed Selector E3 gate
// (scripts/gates/mysql-sales-wave11-a-selector-gate.mjs): it runs its own
// campaign, so it never shares a campaign id or a lease with that suite, and
// it never modifies the closed suite, the frozen runner or the frozen
// launcher.

import { runProtectedMySqlCampaign } from './mysql-wave10-runner-support.mjs';

export const W11_A_U3_INVENTORY_MYSQL_SUITES = Object.freeze([
  Object.freeze({
    label: 'W11-A-U3-INVENTORY-DEMO-SEED',
    file: 'server/mysql-inventory-demo-seed-position.integration.js',
  }),
]);

await runProtectedMySqlCampaign({
  campaign: 'W11-A U3 INVENTORY DEMO SEED MYSQL E3 ACCEPTANCE',
  suites: W11_A_U3_INVENTORY_MYSQL_SUITES,
});
