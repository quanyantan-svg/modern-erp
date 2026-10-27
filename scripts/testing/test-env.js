// Package B — ordinary test launcher environment isolation policy.
//
// Frozen by `document.md` → `## Package B — Local Test Backend Isolation
// Requirement (2026-10-27)` (`PB-ISO-R01`..`PB-ISO-R14`) and `solution.md` →
// `## 37.53 Package B — Local Test Backend Isolation Design (2026-10-27)`
// (`§37.53.2` module responsibility, `§37.53.4` sanitization contract,
// `§37.53.5` construction mechanics M1..M4).
//
// This module is the SINGLE policy source for the environment handed to an
// ordinary test child process (FAST / FULL / HEAVY / ALL). It is deliberately
// side-effect free so that it can be exercised as a pure function:
//
//   - it never reads or writes `process.env`;
//   - it never opens a database;
//   - it never reads a file, a credential or a secret;
//   - it never creates a child process;
//   - it returns a NEW environment object.
//
// The protected MySQL gateways do NOT import this module. They own their own
// launchers and their own explicitly constructed child environments, so real
// MySQL execution continues to require a protected command
// (`solution.md §37.53.8`).
//
// Nothing in this module prints, logs, echoes or encodes an environment
// variable VALUE. Diagnostics carry variable NAMES only
// (`PB-ISO-R09`, `AC-ISO-10`).

/** The backend every ordinary test child is explicitly pinned to. */
export const ISOLATED_TEST_BACKEND = 'sqlite';

/**
 * The environment variable that carries the pinned backend.
 *
 * It is the one forbidden name that is **pinned rather than merely absent**:
 * it is deleted from the parent environment and then set explicitly, and a
 * case variant of it is still rejected.
 */
const PINNED_BACKEND_ENV_NAME = 'ERP_DB_BACKEND';

/**
 * The closed list of environment variables that must not reach an ordinary
 * test child.
 *
 * The list is derived from the variables the code actually reads — not from
 * what a particular shell happens to export — so it is complete with respect
 * to database-target drift and destructive authorization. It comprises the
 * backend selectors, the database path, the connection endpoint and
 * credential variables, the demo-seed toggle, the disposable-target reset
 * authorization, the destructive-operation approval, the production reset
 * sentinel, and the Wave 10 campaign identity / lease set.
 *
 * Three further variables are read by the code and are deliberately NOT in
 * this list because they cannot cause target drift: `ERP_DB_TX_RETRY_MAX`
 * (a MySQL transaction-retry ceiling, inert under SQLite) and
 * `ERP_GATE_ATTEMPTS_MAX` / `ERP_GATE_ATTEMPTS_BUDGET_MS` (Sales Delivery
 * confirmation retry tuning — business behaviour under test).
 */
export const FORBIDDEN_INHERITED_ENV_NAMES = Object.freeze([
  // Backend selectors.
  'ERP_DB_BACKEND',
  'ERP_TEST_DB_BACKEND',
  // Database path.
  'ERP_DB_PATH',
  // Connection endpoint and credential.
  'ERP_DB_HOST',
  'ERP_DB_PORT',
  'ERP_DB_NAME',
  'ERP_DB_USER',
  'ERP_DB_PASSWORD',
  'ERP_DB_SSL',
  'ERP_DB_SSL_REJECT_UNAUTHORIZED',
  // Demo seed toggle.
  'ERP_SEED_DEMO',
  // Disposable-target reset authorization and destructive approval.
  'ERP_MYSQL_TEST_ALLOW_RESET',
  'ERP_MYSQL_TEST_DISPOSABLE_TARGET',
  'ERP_MYSQL_TEST_DESTRUCTIVE_OPERATIONS',
  // Production reset sentinel.
  'ERP_RESET_PRODUCTION_OK',
  // Wave 10 campaign identity and lease.
  'ERP_MYSQL_WAVE10_CAMPAIGN_ID',
  'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE',
  'ERP_MYSQL_WAVE10_EXPECTED_SERVER_UUID',
  'ERP_MYSQL_WAVE10_EXPECTED_CURRENT_USER',
  'ERP_MYSQL_WAVE10_EXPECTED_GRANTS_SHA256',
  'ERP_MYSQL_WAVE10_EXPECTED_VERSION_POLICY',
  'ERP_MYSQL_WAVE10_INITIAL_INVENTORY',
]);

// Matching is case-insensitive: on Windows `process.env` is a case-insensitive
// proxy and the child resolves `process.env.ERP_DB_BACKEND` case-insensitively,
// so a shell exporting `erp_db_backend` would otherwise survive an
// exactly-cased removal (`solution.md §37.53.5` M2, `AC-ISO-09` / T09).
const FORBIDDEN_BY_UPPERCASE_NAME = new Set(
  FORBIDDEN_INHERITED_ENV_NAMES.map((name) => name.toUpperCase()),
);

/**
 * Build the isolated environment for an ordinary test child.
 *
 * Pure: the parent environment is read but never mutated, and a brand new
 * environment object is returned.
 *
 * @param {Record<string, string|undefined>} parentEnv
 * @returns {{ env: Record<string, string|undefined>, removed: string[] }}
 *   `env` is the sanitized child environment; `removed` lists the NAMES of the
 *   parent variables that were dropped (original spelling, for operator
 *   recognition). No value is ever returned for a removed variable.
 */
export function buildIsolatedTestEnv(parentEnv = process.env) {
  if (!parentEnv || typeof parentEnv !== 'object') {
    throw new Error('buildIsolatedTestEnv: parentEnv must be an object');
  }

  const env = {};
  const removed = [];

  for (const key of Object.keys(parentEnv)) {
    if (FORBIDDEN_BY_UPPERCASE_NAME.has(key.toUpperCase())) {
      removed.push(key);
      continue;
    }
    env[key] = parentEnv[key];
  }

  // Positive selection: the backend is pinned explicitly rather than merely
  // left absent, so the isolation does not depend on a future default change
  // in `server/database/config.js` or `scripts/admin/setup-admin.mjs`
  // (`solution.md §37.53.5` M3, `PB-ISO-R02`).
  env[PINNED_BACKEND_ENV_NAME] = ISOLATED_TEST_BACKEND;

  return { env, removed };
}

/**
 * Verify that a candidate environment satisfies the isolation contract.
 *
 * Pure: reads only the supplied object. Throws on any violation; it never
 * returns a partially validated environment.
 *
 * The forbidden list governs what may be **inherited** from the parent. The
 * backend variable is therefore not simply "must be absent": it is pinned.
 * `ERP_DB_BACKEND` must be present exactly once, spelled exactly
 * `ERP_DB_BACKEND`, and hold exactly the isolated backend value. A case
 * variant of it is still an offender, because on Windows the child resolves
 * `process.env.ERP_DB_BACKEND` case-insensitively and would otherwise be
 * able to shadow the pin (`solution.md §37.53.4` group A, §37.53.5 M3/M4).
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string|undefined>} the same object, when valid
 */
export function assertIsolatedTestEnv(env) {
  if (!env || typeof env !== 'object') {
    throw new Error('assertIsolatedTestEnv: env must be an object');
  }

  const offenders = [];
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (!FORBIDDEN_BY_UPPERCASE_NAME.has(upper)) continue;
    // The canonical backend key is pinned, not forbidden: its value is
    // verified separately below. Every other spelling is an offender.
    if (upper === PINNED_BACKEND_ENV_NAME && key === PINNED_BACKEND_ENV_NAME) continue;
    offenders.push(key);
  }
  if (offenders.length > 0) {
    throw new Error(
      `isolated test environment still contains forbidden variables: ${offenders.join(', ')}`,
    );
  }

  const backend = env[PINNED_BACKEND_ENV_NAME];
  if (backend !== ISOLATED_TEST_BACKEND) {
    throw new Error(
      `isolated test environment backend variable ${PINNED_BACKEND_ENV_NAME} must be '${ISOLATED_TEST_BACKEND}'`,
    );
  }

  return env;
}
