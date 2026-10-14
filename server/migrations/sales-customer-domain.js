// Sales & Customer domain migration registry.
//
// Wave 0 established the canonical cross-dialect entrypoint. Wave 1 registers
// the bounded eight-table Commercial Foundation migration.
//
// Every future step must be idempotent. A fresh MySQL database is built from
// an already-migrated SQLite snapshot and then replays this same registry on
// the live MySQL adapter; an existing MySQL database runs the live replay as
// its additive upgrade path. Known idempotent conditions belong inside the
// individual step. Unexpected errors propagate and fail database startup.

import { migrateSalesCustomerWave1Foundation } from './sales-customer-wave1-foundation.js';

export const SALES_CUSTOMER_MIGRATIONS = Object.freeze([
  Object.freeze({
    id: 'wave-1-commercial-foundation',
    wave: 1,
    migrate: migrateSalesCustomerWave1Foundation,
  }),
]);

function compareSteps(left, right) {
  if (left.wave !== right.wave) return left.wave - right.wave;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function validateAndOrderSteps(steps) {
  if (!Array.isArray(steps)) {
    throw new TypeError('Sales & Customer migration steps must be an array');
  }

  const ids = new Set();
  const validated = steps.map((step, index) => {
    if (!step || typeof step !== 'object') {
      throw new TypeError(`Sales & Customer migration step at index ${index} must be an object`);
    }
    if (typeof step.id !== 'string' || step.id.trim() === '') {
      throw new TypeError(`Sales & Customer migration step at index ${index} requires a non-empty id`);
    }
    if (!Number.isSafeInteger(step.wave) || step.wave < 0 || step.wave > 13) {
      throw new TypeError(`Sales & Customer migration step ${step.id} has an invalid wave`);
    }
    if (typeof step.migrate !== 'function') {
      throw new TypeError(`Sales & Customer migration step ${step.id} requires migrate(db)`);
    }

    const id = step.id.trim();
    if (ids.has(id)) {
      throw new Error(`Duplicate Sales & Customer migration step id: ${id}`);
    }
    ids.add(id);
    return { id, wave: step.wave, migrate: step.migrate };
  });

  return validated.sort(compareSteps);
}

export function runSalesCustomerMigrations(db, steps = SALES_CUSTOMER_MIGRATIONS) {
  if (db === null || db === undefined) {
    throw new TypeError('Sales & Customer migration runner requires a database adapter');
  }

  const orderedSteps = validateAndOrderSteps(steps);
  for (const step of orderedSteps) {
    step.migrate(db);
  }
  return orderedSteps.map((step) => step.id);
}

export function migrateSalesCustomerDomain(db) {
  return runSalesCustomerMigrations(db, SALES_CUSTOMER_MIGRATIONS);
}
