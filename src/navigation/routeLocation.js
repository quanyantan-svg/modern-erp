import { applicationRouteFor, resolveApplicationRouteAlias } from './applicationRegistry.js';

const EMPTY = Object.freeze({});
const safeDecode = (value) => {
  try { return { value: decodeURIComponent(String(value).replace(/\+/g, ' ')), error: null }; }
  catch { return { value: '', error: 'MALFORMED_ENCODING' }; }
};

export function resolveRouteAlias(routeKey) {
  return resolveApplicationRouteAlias(routeKey);
}

export function validateRouteTarget(route, target) {
  if (!route || target == null) return target == null || (typeof target === 'object' && !Array.isArray(target));
  if (typeof target !== 'object' || Array.isArray(target)) return false;
  const allowed = new Set([route.targetContract.pathParam, ...(route.targetContract.queryKeys || [])].filter(Boolean));
  for (const [key, value] of Object.entries(target)) {
    if (key === 'page') continue;
    if (!allowed.has(key) || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length === 0) return false;
  }
  if (target.documentId != null && route.targetContract.pathParam !== 'documentId') return false;
  return true;
}

export function normalizeRouteLocation(location = {}) {
  const requestedRouteKey = typeof location.routeKey === 'string' && location.routeKey.trim() ? location.routeKey.trim() : 'dashboard';
  const routeKey = resolveRouteAlias(requestedRouteKey);
  const route = applicationRouteFor(routeKey);
  const params = { ...(location.params || {}) };
  const query = { ...(location.query || {}) };
  const suppliedTarget = location.target && typeof location.target === 'object' && !Array.isArray(location.target) ? location.target : EMPTY;
  if (suppliedTarget.documentId != null && params.documentId == null) params.documentId = suppliedTarget.documentId;
  for (const [key, value] of Object.entries(suppliedTarget)) if (key !== 'page' && key !== 'documentId' && query[key] == null) query[key] = value;
  const target = { ...(params.documentId != null ? { documentId: String(params.documentId) } : {}), ...query };
  const valid = !location.error && (!route || validateRouteTarget(route, target));
  return Object.freeze({
    routeKey, params: Object.freeze(params.documentId == null ? {} : { documentId: String(params.documentId) }),
    query: Object.freeze(Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)]))),
    target: Object.freeze(Object.fromEntries(Object.entries(target).map(([key, value]) => [key, String(value)]))),
    requestedRouteKey, wasAlias: requestedRouteKey !== routeKey,
    invalid: !valid, error: location.error || (valid ? null : 'ILLEGAL_TARGET'),
  });
}

export function parseRouteLocation(hash = '') {
  const raw = String(hash).replace(/^#/, '');
  if (!raw) return normalizeRouteLocation({ routeKey: 'dashboard' });
  const queryAt = raw.indexOf('?');
  const rawPath = queryAt >= 0 ? raw.slice(0, queryAt) : raw;
  const rawQuery = queryAt >= 0 ? raw.slice(queryAt + 1) : '';
  const pathParts = rawPath.split('/');
  if (pathParts.length > 2 || pathParts.some((part) => part === '')) return normalizeRouteLocation({ routeKey: 'dashboard', error: 'MALFORMED_PATH' });
  const decodedRoute = safeDecode(pathParts[0]);
  const decodedDocument = pathParts[1] == null ? { value: null, error: null } : safeDecode(pathParts[1]);
  if (decodedRoute.error || decodedDocument.error) return normalizeRouteLocation({ routeKey: 'dashboard', error: 'MALFORMED_ENCODING' });
  const query = {};
  if (rawQuery) for (const pair of rawQuery.split('&')) {
    if (!pair) continue;
    const equals = pair.indexOf('=');
    const key = safeDecode(equals >= 0 ? pair.slice(0, equals) : pair);
    const value = safeDecode(equals >= 0 ? pair.slice(equals + 1) : '');
    if (key.error || value.error || !key.value || !value.value) return normalizeRouteLocation({ routeKey: decodedRoute.value, error: 'MALFORMED_QUERY' });
    query[key.value] = value.value;
  }
  return normalizeRouteLocation({
    routeKey: decodedRoute.value,
    params: decodedDocument.value == null ? {} : { documentId: decodedDocument.value },
    query,
  });
}

export function serializeRouteLocation(location) {
  const normalized = normalizeRouteLocation(location);
  const route = applicationRouteFor(normalized.routeKey);
  if (normalized.invalid || (route && !validateRouteTarget(route, normalized.target))) return '#dashboard';
  let hash = `#${encodeURIComponent(normalized.routeKey)}`;
  if (normalized.params.documentId != null) hash += `/${encodeURIComponent(normalized.params.documentId)}`;
  const queryEntries = Object.entries(normalized.query)
    .filter(([key]) => key !== 'documentId')
    .sort(([left], [right]) => left.localeCompare(right));
  if (queryEntries.length) hash += `?${queryEntries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')}`;
  return hash;
}