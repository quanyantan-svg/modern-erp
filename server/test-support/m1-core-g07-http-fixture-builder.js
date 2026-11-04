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
  for (const part of parts) {
    if (value == null) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
    if (Array.isArray(value)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
      value = value[index];
    } else {
      value = value[part];
    }
  }
  if (value === undefined) throw new Error(`M1_G07_FIXTURE_REFERENCE_MISSING:${reference}`);
  return value;
}

function resolveRefs(value, context) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, context));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$ref === 'string') return lookup(context, value.$ref);
    if (Object.keys(value).length === 1 && Number.isSafeInteger(value.$businessDate)) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + value.$businessDate);
      return date.toISOString().slice(0, 10);
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveRefs(child, context)]));
  }
  return value;
}

function concreteHttpRequest(request, label) {
  if (!request || !['GET', 'POST', 'PUT', 'PATCH'].includes(request.method) || !String(request.path || request.route || '').startsWith('/api/')) {
    throw new Error(`M1_G07_FIXTURE_HTTP_REQUIRED:${label}`);
  }
  assertNoSql(request, label);
  return request;
}

const LEGAL_SETUP_STATES = new Set([
  'DRAFT', 'SUBMITTED', 'APPROVED', 'CONFIRMED', 'RELEASED', 'PLAN_CONFIRMED',
  'PENDING', 'PENDING_INSPECTION', 'PASS', 'QUALIFIED', 'ACTIVE', 'AVAILABLE', 'OPEN', 'POSTED',
]);

function expectedSetupStatus(step) {
  if (['GET', 'PATCH', 'PUT'].includes(step.method)) return 200;
  if (/\/(submit|approve|confirm|complete|transition|material-list)$/.test(step.path)
      || /^\/api\/purchase-receipts\/[^/]+$/.test(step.path)) return 200;
  return 201;
}

function collectNamedValues(value, predicate, found = []) {
  if (Array.isArray(value)) for (const item of value) collectNamedValues(item, predicate, found);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (predicate(key, child)) found.push({ key, value: child });
    collectNamedValues(child, predicate, found);
  }
  return found;
}

function assertSetupResponse(step, response, label) {
  const expectedStatus = expectedSetupStatus(step);
  if (response.status !== expectedStatus) throw new Error(`M1_G07_FIXTURE_SETUP_STATUS_INVALID:${label}:expected ${expectedStatus},got ${response.status}`);
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data) || Object.keys(response.data).length === 0) {
    throw new Error(`M1_G07_FIXTURE_SETUP_DTO_INVALID:${label}`);
  }
  const requestSourceIds = collectNamedValues(step.body, (key) => /Id$/.test(key));
  if (requestSourceIds.some((entry) => typeof entry.value !== 'string' || !entry.value.trim())) {
    throw new Error(`M1_G07_FIXTURE_SETUP_SOURCE_ID_INVALID:${label}`);
  }
  const responseIds = collectNamedValues(response.data, (key) => key === 'id' || /Id$/.test(key));
  const routeHasSourceId = /\/[^/]+\/(?:submit|approve|confirm|complete|transition|material-list)$/.test(step.path)
    || /^\/api\/purchase-receipts\/[^/]+$/.test(step.path);
  if (expectedStatus === 201 && responseIds.length === 0) throw new Error(`M1_G07_FIXTURE_SETUP_RESPONSE_ID_MISSING:${label}`);
  if (expectedStatus === 200 && responseIds.length === 0 && !routeHasSourceId && response.data.ok !== true
      && !Object.keys(response.data).some((key) => /status$/i.test(key))) {
    throw new Error(`M1_G07_FIXTURE_SETUP_SOURCE_PROOF_MISSING:${label}`);
  }
  const states = collectNamedValues(response.data, (key, child) => /(^|_)(status|result)$/i.test(key) || /Status$/.test(key));
  for (const state of states) {
    if (typeof state.value === 'string' && state.value && !LEGAL_SETUP_STATES.has(state.value.toUpperCase())) {
      throw new Error(`M1_G07_FIXTURE_SETUP_STATE_INVALID:${label}:${state.key}=${state.value}`);
    }
  }
  return Object.freeze({ expectedStatus, dtoVerified: true, sourceIdsVerified: true, businessStateVerified: states.length > 0 ? true : 'NOT_APPLICABLE' });
}

/**
 * Build every positive business fact through the fixed production-HTTP chain.
 * There is no external plan: the scenario definitions are the fixed, versioned,
 * SHA-pinned `M1_CORE_G07_FIXED_SCENARIOS`. Intermediate IDs that a create
 * response does not return are read back via production GET steps (resolved
 * through array-indexed `$ref`). A dynamic reference that cannot be resolved,
 * an illegal method, a SQL-shaped field or a non-2xx setup step fails closed
 * BEFORE any race (and therefore before ACK-4 is consumed upstream).
 *
 * `subjectTokens` maps each subject key to a real bearer token obtained by the
 * caller through the production /api/auth/login flow — never invented here.
 */
export async function buildM1CoreG07HttpFixtures({ applications, subjectTokens, request, admitTechnicalL2 }) {
  if (!applications?.A || !applications?.B || !subjectTokens || typeof request !== 'function') {
    throw new Error('M1_G07_FIXTURE_APPLICATIONS_REQUIRED');
  }
  assertFixedFixtureManifest();
  const setupTrace = [];
  const scenarios = {};

  function tokenFor(subject, label) {
    const token = subjectTokens[subject];
    if (!token) throw new Error(`M1_G07_FIXTURE_SUBJECT_TOKEN_MISSING:${label}:${subject}`);
    return token;
  }

  for (const scenario of M1_CORE_G07_FIXED_SCENARIOS) {
    const context = { setup: {} };
    for (const raw of scenario.setup) {
      if (raw.method === 'TECHNICAL_L2') {
        if (typeof admitTechnicalL2 !== 'function') throw new Error(`M1_G07_TECHNICAL_L2_ADMISSION_REQUIRED:${scenario.id}.${raw.id}`);
        const evidence = await admitTechnicalL2(Object.freeze({
          scenarioId: scenario.id, stepId: raw.id, prerequisite: raw.prerequisite,
          input: resolveRefs(raw.input, context),
        }));
        if (!evidence || evidence.admitted !== true || evidence.prerequisite !== raw.prerequisite) {
          throw new Error(`M1_G07_TECHNICAL_L2_EVIDENCE_INVALID:${scenario.id}.${raw.id}`);
        }
        context.setup[raw.id] = evidence;
        setupTrace.push(Object.freeze({
          scenario: scenario.id, stepId: raw.id, application: null, subject: null,
          method: 'TECHNICAL_L2', path: null, status: 'ADMITTED', prerequisite: raw.prerequisite,
        }));
        continue;
      }
      const body = raw.body === undefined ? undefined : resolveRefs(raw.body, context);
      const path = resolveRoute(raw.route, context);
      const token = tokenFor(raw.subject, `${scenario.id}.${raw.id}`);
      const step = concreteHttpRequest({ application: raw.application ?? 'A', subject: raw.subject, method: raw.method, path, headers: raw.headers, body, token }, `${scenario.id}.${raw.id}`);
      const response = await request(applications[step.application], step);
      if (response.status < 200 || response.status >= 300) throw new Error(`M1_G07_FIXTURE_SETUP_BLOCKED:${scenario.id}.${raw.id}:http ${response.status}:${JSON.stringify(response.data)}`);
      if (raw.method === 'GET' && step.body !== undefined) throw new Error(`M1_G07_FIXTURE_GET_BODY_FORBIDDEN:${scenario.id}.${raw.id}`);
      const verification = assertSetupResponse(step, response, `${scenario.id}.${raw.id}`);
      context.setup[raw.id] = response.data;
      setupTrace.push(Object.freeze({
        scenario: scenario.id, stepId: raw.id, application: step.application, subject: raw.subject,
        method: step.method, path: step.path, status: response.status, ...verification,
      }));
    }
    const requests = scenario.raceRequests.map((raw) => {
      const body = raw.body === undefined ? undefined : resolveRefs(raw.body, context);
      const path = resolveRoute(raw.route, context);
      const token = tokenFor(raw.subject, `${scenario.id}.race`);
      return concreteHttpRequest({ application: raw.app, subject: raw.subject, method: raw.method, path, headers: raw.headers, body, token }, `${scenario.id}.race`);
    });
    if (requests.length !== 2 || new Set(requests.map((item) => item.application)).size !== 2) {
      throw new Error(`${scenario.id}_RACE_REQUESTS_INVALID`);
    }
    scenarios[scenario.id] = Object.freeze({
      setup: Object.freeze({ ...context.setup }),
      requests: Object.freeze(requests),
      businessObjectProvenance: Object.freeze([
        ...scenario.setup.filter((item) => item.method !== 'TECHNICAL_L2').map((item) => Object.freeze({ kind: item.id, source: 'SETUP_HTTP', stepId: item.id, channel: 'PRODUCTION_HTTP' })),
        ...scenario.raceRequests.map((item, index) => Object.freeze({ kind: `${scenario.id}-race-${index}`, source: 'RACE_HTTP', application: item.app, channel: 'PRODUCTION_HTTP' })),
      ]),
      technicalL2Evidence: Object.freeze(scenario.setup.filter((item) => item.method === 'TECHNICAL_L2').map((item) => context.setup[item.id])),
    });
  }
  if (Object.keys(scenarios).length !== M1_CORE_G07_FIXED_SCENARIOS.length) throw new Error('M1_G07_FIXTURE_PLAN_SET_INCOMPLETE');
  return Object.freeze({
    version: M1_CORE_G07_FIXTURE_VERSION, provenance: 'PRODUCTION_HTTP', applications: Object.freeze({ ...applications }),
    setupTrace: Object.freeze(setupTrace), scenarios: Object.freeze(scenarios),
    fixtureDigest: M1_CORE_G07_FIXED_FIXTURE_DIGEST, executionStatus: 'NOT_RUN',
  });
}
