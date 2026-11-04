import { M1_CORE_G07_SCENARIOS } from './m1-core-g07-contract.js';

function assertNoSql(value, location = 'plan') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(sql|query|statement|ddl|dml)$/i.test(key)) throw new Error(`M1_G07_FIXTURE_SQL_FORBIDDEN:${location}.${key}`);
    assertNoSql(child, `${location}.${key}`);
  }
}

function concreteHttpRequest(request, label) {
  if (!request || !['POST', 'PUT', 'PATCH'].includes(request.method) || !String(request.path || '').startsWith('/api/')) {
    throw new Error(`M1_G07_FIXTURE_HTTP_REQUIRED:${label}`);
  }
  if (/[:{}]/.test(request.path)) throw new Error(`M1_G07_FIXTURE_PATH_NOT_CONCRETE:${label}`);
  if (!['A', 'B'].includes(request.application)) throw new Error(`M1_G07_FIXTURE_APPLICATION_INVALID:${label}`);
  assertNoSql(request, label);
  return request;
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

function validateBusinessObjectProvenance(objects, setupById) {
  if (!Array.isArray(objects) || objects.length === 0) throw new Error('M1_G07_FIXTURE_BUSINESS_OBJECT_PROVENANCE_REQUIRED');
  for (const object of objects) {
    if (!object?.kind) throw new Error('M1_G07_FIXTURE_BUSINESS_OBJECT_KIND_REQUIRED');
    if (object.source === 'SETUP_HTTP') {
      if (!setupById.has(object.stepId)) throw new Error(`M1_G07_FIXTURE_PROVENANCE_STEP_MISSING:${object.stepId}`);
    } else if (object.source === 'RACE_HTTP') {
      if (!['A', 'B'].includes(object.application)) throw new Error('M1_G07_FIXTURE_PROVENANCE_RACE_INVALID');
    } else throw new Error(`M1_G07_FIXTURE_PROVENANCE_INVALID:${object.kind}`);
  }
}

/** Build every positive business fact through injected production HTTP only. */
export async function buildM1CoreG07HttpFixtures({ applications, plans, request }) {
  if (!applications?.A || !applications?.B || typeof request !== 'function') throw new Error('M1_G07_FIXTURE_APPLICATIONS_REQUIRED');
  assertNoSql(plans);
  const definitions = new Map(M1_CORE_G07_SCENARIOS.map((item) => [item.id, item]));
  if (!Array.isArray(plans) || plans.length !== definitions.size) throw new Error('M1_G07_FIXTURE_PLAN_SET_INCOMPLETE');
  const setupTrace = [];
  const scenarios = {};

  for (const plan of plans) {
    const definition = definitions.get(plan.id);
    if (!definition || scenarios[plan.id]) throw new Error(`M1_G07_FIXTURE_PLAN_INVALID:${plan.id}`);
    const context = { setup: {} };
    const setupById = new Set();
    for (const raw of plan.setup || []) {
      if (!raw.id || setupById.has(raw.id)) throw new Error(`${plan.id}_SETUP_STEP_ID_INVALID`);
      const step = concreteHttpRequest(resolveRefs(raw, context), `${plan.id}.${raw.id}`);
      const response = await request(applications[step.application], step);
      if (response.status < 200 || response.status >= 300) throw new Error(`${plan.id}_SETUP_HTTP_FAILED:${raw.id}:${response.status}`);
      setupById.add(raw.id);
      context.setup[raw.id] = { body: response.data, status: response.status };
      setupTrace.push(Object.freeze({ scenario: plan.id, stepId: raw.id, application: step.application, method: step.method, path: step.path, status: response.status }));
    }
    const requests = (plan.requests || []).map((raw, index) => concreteHttpRequest(resolveRefs(raw, context), `${plan.id}.race.${index}`));
    if (requests.length !== 2 || new Set(requests.map((item) => item.application)).size !== 2) throw new Error(`${plan.id}_RACE_REQUESTS_INVALID`);
    validateBusinessObjectProvenance(plan.businessObjects, setupById);
    const expectedKeys = [...definition.snapshotTables].sort();
    if (Object.keys(plan.expectedSnapshot || {}).sort().join(',') !== expectedKeys.join(',')) throw new Error(`${plan.id}_EXPECTED_SNAPSHOT_INCOMPLETE`);
    scenarios[plan.id] = Object.freeze({
      requests: Object.freeze(requests),
      expectedSnapshot: plan.expectedSnapshot,
      businessObjectProvenance: Object.freeze(plan.businessObjects.map((item) => Object.freeze({ ...item, channel: 'PRODUCTION_HTTP' }))),
    });
  }
  if (Object.keys(scenarios).length !== definitions.size) throw new Error('M1_G07_FIXTURE_PLAN_SET_INCOMPLETE');
  return Object.freeze({
    version: 1, provenance: 'PRODUCTION_HTTP', applications: Object.freeze({ ...applications }),
    setupTrace: Object.freeze(setupTrace), scenarios: Object.freeze(scenarios), executionStatus: 'NOT_RUN',
  });
}
