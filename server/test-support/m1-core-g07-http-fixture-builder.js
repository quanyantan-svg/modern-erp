import {
  assertFixedFixtureManifest, M1_CORE_G07_FIXED_FIXTURE_DIGEST, M1_CORE_G07_FIXED_SCENARIOS,
  M1_CORE_G07_FIXTURE_VERSION, resolveRoute,
} from './m1-core-g07-fixtures.js';

function assertNoSql(value, location = 'fixture') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(sql|query|statement|ddl|dml)$/i.test(key)) throw new Error(`M1_G07_FIXTURE_SQL_FORBIDDEN:${location}.${key}`);
    assertNoSql(child, `${location}.${key}`);
  }
}

function lookup(context, reference) {
  const parts = String(reference).split('.');
  let value = context;
  for (const part of parts) value = value?.[part];
  if (value === undefined) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
  return value;
}

function resolveRefs(value, context) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, context));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') return lookup(context, value.$ref);
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child, context)]));
  }
  return value;
}

function concreteHttpRequest(request, label) {
  if (!request || !['POST', 'PUT', 'PATCH'].includes(request.method) || !String(request.path || request.route || '').startsWith('/api/')) {
    throw new Error(`M1_G07_FIXTURE_HTTP_REQUIRED:${label}`);
  }
  assertNoSql(request, label);
  return request;
}

/**
 * Build every positive business fact through the fixed production-HTTP chain.
 * There is no external plan: the scenario definitions are the fixed, versioned,
 * SHA-pinned `M1_CORE_G07_FIXED_SCENARIOS`. A dynamic reference that cannot be
 * resolved, an illegal method, a SQL-shaped field or a non-2xx setup step fails
 * closed BEFORE any race (and therefore before ACK-4 is consumed upstream).
 */
export async function buildM1CoreG07HttpFixtures({ applications, request }) {
  if (!applications?.A || !applications?.B || typeof request !== 'function') throw new Error('M1_G07_FIXTURE_APPLICATIONS_REQUIRED');
  assertFixedFixtureManifest();
  const setupTrace = [];
  const scenarios = {};

  for (const scenario of M1_CORE_G07_FIXED_SCENARIOS) {
    const context = { setup: {} };
    for (const raw of scenario.setup) {
      const body = resolveRefs(raw.body, context);
      const path = resolveRoute(raw.route, context);
      const step = concreteHttpRequest({ application: raw.app, method: raw.method, path, body }, `${scenario.id}.${raw.id}`);
      const response = await request(applications[step.application], step);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`M1_G07_FIXTURE_SETUP_BLOCKED:${scenario.id}.${raw.id}:http ${response.status}`);
      }
      context.setup[raw.id] = response.data;
      setupTrace.push(Object.freeze({
        scenario: scenario.id, stepId: raw.id, application: step.application,
        method: step.method, path: step.path, status: response.status,
      }));
    }
    const requests = scenario.raceRequests.map((raw) => {
      const body = resolveRefs(raw.body, context);
      const path = resolveRoute(raw.route, context);
      return concreteHttpRequest({ application: raw.app, method: raw.method, path, body }, `${scenario.id}.race`);
    });
    if (requests.length !== 2 || new Set(requests.map((item) => item.application)).size !== 2) {
      throw new Error(`${scenario.id}_RACE_REQUESTS_INVALID`);
    }
    scenarios[scenario.id] = Object.freeze({
      requests: Object.freeze(requests),
      businessObjectProvenance: Object.freeze([
        ...scenario.setup.map((item) => Object.freeze({ kind: item.id, source: 'SETUP_HTTP', stepId: item.id, channel: 'PRODUCTION_HTTP' })),
        ...scenario.raceRequests.map((item, index) => Object.freeze({ kind: `${scenario.id}-race-${index}`, source: 'RACE_HTTP', application: item.app, channel: 'PRODUCTION_HTTP' })),
      ]),
    });
  }
  if (Object.keys(scenarios).length !== M1_CORE_G07_FIXED_SCENARIOS.length) throw new Error('M1_G07_FIXTURE_PLAN_SET_INCOMPLETE');
  return Object.freeze({
    version: M1_CORE_G07_FIXTURE_VERSION, provenance: 'PRODUCTION_HTTP', applications: Object.freeze({ ...applications }),
    setupTrace: Object.freeze(setupTrace), scenarios: Object.freeze(scenarios),
    fixtureDigest: M1_CORE_G07_FIXED_FIXTURE_DIGEST, executionStatus: 'NOT_RUN',
  });
}
