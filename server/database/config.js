import { isAbsolute, resolve } from 'node:path';

const BACKENDS = new Set(['sqlite', 'mysql']);

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required when ERP_DB_BACKEND=mysql`);
  return text;
}
function integer(value, name, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return parsed;
}

function boolean(value, name, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true or false`);
}

/** Resolve and validate database configuration. Invalid or incomplete MySQL
 * configuration is rejected before a connection is attempted (fail closed).
 */
export function resolveDatabaseConfig(overrides = {}) {
  const backend = String(overrides.backend ?? process.env.ERP_DB_BACKEND ?? 'sqlite').trim().toLowerCase();
  if (!BACKENDS.has(backend)) throw new Error(`ERP_DB_BACKEND must be one of: ${[...BACKENDS].join(', ')}`);

  if (backend === 'sqlite') {
    const path = String(overrides.path ?? process.env.ERP_DB_PATH ?? '').trim();
    if (!path) throw new Error('ERP_DB_PATH is required when ERP_DB_BACKEND=sqlite');
    return { backend, path: isAbsolute(path) ? path : resolve(path) };
  }

  const ssl = boolean(overrides.ssl ?? process.env.ERP_DB_SSL, 'ERP_DB_SSL');
  const rejectUnauthorized = boolean(
    overrides.sslRejectUnauthorized ?? process.env.ERP_DB_SSL_REJECT_UNAUTHORIZED,
    'ERP_DB_SSL_REJECT_UNAUTHORIZED',
    true,
  );
  return {
    backend,
    host: required(overrides.host ?? process.env.ERP_DB_HOST, 'ERP_DB_HOST'),
    port: integer(overrides.port ?? process.env.ERP_DB_PORT, 'ERP_DB_PORT', 3306),
    database: required(overrides.database ?? process.env.ERP_DB_NAME, 'ERP_DB_NAME'),
    user: required(overrides.user ?? process.env.ERP_DB_USER, 'ERP_DB_USER'),
    password: required(overrides.password ?? process.env.ERP_DB_PASSWORD, 'ERP_DB_PASSWORD'),
    ssl: ssl ? { rejectUnauthorized } : undefined,
  };
}
