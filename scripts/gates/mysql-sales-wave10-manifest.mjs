// Wave 10 protected MySQL acceptance manifest.
// This module is data-only: importing it opens no database connection.

export const WAVE10_MYSQL_SUITES = Object.freeze([
  Object.freeze({ label: 'W10-PARITY', file: 'server/mysql-sales-customer-wave10.integration.js' }),
  Object.freeze({ label: 'W10-RACES', file: 'server/mysql-sales-customer-wave10-concurrency.integration.js' }),
  Object.freeze({ label: 'W10-BUSINESS-MATRIX', file: 'server/mysql-sales-customer-wave10-business-matrix.integration.js' }),
]);

export const WAVE10_RACE_CASES = Object.freeze([
  'W10-R1', 'W10-R2', 'W10-R3', 'W10-R4', 'W10-R5', 'W10-R6',
  'W10-R7', 'W10-R8', 'W10-R9', 'W10-R10', 'W10-R11', 'W10-R12',
]);

export const R_SAL_ALIASES = Object.freeze({
  'R-SAL-12': 'W10-R1',
  'R-SAL-13': 'W10-R2',
  'R-SAL-14': 'W10-R3',
});

export const GATE_B_CASES = Object.freeze([
  Object.freeze({ id: 'B-COMPOSE', evidence: 'STATIC_INTENT', owner: 'GATE-B' }),
  Object.freeze({ id: 'B-M9', evidence: 'PRODUCTION_SERIALIZED_OUTCOME', owner: 'GATE-B' }),
  Object.freeze({ id: 'B-M10', evidence: 'PRODUCTION_SERIALIZED_OUTCOME', owner: 'GATE-B' }),
  Object.freeze({ id: 'B-M11', evidence: 'PRODUCTION_SERIALIZED_OUTCOME', owner: 'GATE-B' }),
  Object.freeze({ id: 'B-M12', evidence: 'PRODUCTION_SERIALIZED_OUTCOME', owner: 'GATE-B' }),
  Object.freeze({ id: 'B-M15', evidence: 'PRODUCTION_SERIALIZED_OUTCOME', owner: 'GATE-B' }),
  Object.freeze({ id: 'B-M19C', evidence: 'PRODUCTION_SERIALIZED_OUTCOME', owner: 'GATE-B' }),
]);

export const GATE_B_SUITES = Object.freeze([
  Object.freeze({ label: 'GATE-B-PRODUCTION-RACES', file: 'server/mysql-sales-customer-wave10-concurrency.integration.js' }),
  Object.freeze({ label: 'GATE-B', file: 'server/mysql-sales-customer-wave10-gate-b.integration.js' }),
]);

export const ACCEPTANCE_EVIDENCE_LEVELS = Object.freeze([
  'PRODUCTION_SERIALIZED_OUTCOME',
  'RAW_ROW_LEVEL_LOCK_ORDER',
  'STATIC_INTENT',
]);
