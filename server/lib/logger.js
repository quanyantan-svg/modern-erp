const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|db[_-]?password)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const ASSIGNMENT = /\b(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*([^\s,;]+)/gi;

function sanitizeString(value) {
  return String(value).replace(BEARER_VALUE, 'Bearer [REDACTED]').replace(ASSIGNMENT, '$1=[REDACTED]');
}

export function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, seen),
  ]));
}

export function createStructuredLogger({ sink = console, service = 'modern-erp-api' } = {}) {
  function write(level, event, fields = {}) {
    const record = redact({ timestamp: new Date().toISOString(), level, service, event, ...fields });
    const method = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
    sink[method]?.(JSON.stringify(record));
  }
  return {
    info: (event, fields) => write('INFO', event, fields),
    warn: (event, fields) => write('WARN', event, fields),
    error: (event, fields) => write('ERROR', event, fields),
  };
}

export function safeSqlLabel(sql) {
  const normalized = String(sql).trim().replace(/\s+/g, ' ');
  const operation = normalized.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase() || 'SQL';
  const table = normalized.match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+[`"]?([A-Za-z0-9_]+)/i)?.[1] || 'unknown';
  return `${operation}:${table}`;
}
