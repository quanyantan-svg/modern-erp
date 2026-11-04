import { createHash } from 'node:crypto';
import { M1_CORE_G07_SCENARIOS } from './m1-core-g07-contract.js';

// Fixed, version-traceable G07 fixture definitions. These replace the former
// arbitrary external `--fixture-plan`: every positive business object is built
// through production HTTP along a fixed route/method chain, and the whole set
// is SHA-pinned so a drift between independent review and run is detected
// before ACK-4 is consumed.
//
// Nothing in this module is a secret, a password, a Bearer token or a SQL
// statement. Subjects reference RBAC roles; their tokens are obtained from the
// restricted test-identity initialisation flow, not invented here.

export const M1_CORE_G07_FIXTURE_VERSION = 1;

// Technical L2 prerequisites: facts the production HTTP surface cannot
// construct. They are enumerated so they can never be mistaken for L1 handler
// evidence. Each is established by a separately-authorised, non-business path.
export const M1_CORE_G07_TECHNICAL_L2_PREREQUISITES = Object.freeze([
  Object.freeze({
    id: 'DISPOSABLE_TARGET', kind: 'TARGET_IDENTITY',
    note: 'precise disposable MySQL target identity/grants are established by scripts/gates/setup-mysql-local-gate.ps1, never by business HTTP',
  }),
  Object.freeze({
    id: 'TRANSACTION_GATE_TABLE', kind: 'SYNCHRONIZATION',
    note: 'mysql_transaction_gates is a technical synchronisation primitive created by BOOTSTRAP_CURRENT_SCHEMA, not a business object',
  }),
  Object.freeze({
    id: 'RBAC_TEST_IDENTITIES', kind: 'ROLE_SEED',
    note: 'approved M1-P-03 roles (outsourcing operator / receiving clerk / quality / accounting) are seeded by the role grant path, not by business HTTP',
  }),
  Object.freeze({
    id: 'M15_IDENTITY_KEY_SCHEMA', kind: 'SCHEMA_MIGRATION',
    note: 'tracked_inventory_movements.identity_key is an M-15 technical column under a separate Migration authorisation, never a business HTTP fact',
  }),
]);

const ALL_TECHNICAL_L2 = M1_CORE_G07_TECHNICAL_L2_PREREQUISITES.map((item) => item.id);

function step(id, app, method, route, body) {
  return Object.freeze({ id, app, method, route, body: Object.freeze(body ?? {}) });
}

function race(app, method, route, body) {
  return Object.freeze({ app, method, route, body: Object.freeze(body ?? {}) });
}

// Routes and bodies use `$ref`/`{ref}` dot-paths into the setup context, e.g.
// `setup.po.id`. Every setup step's response body is captured under
// `setup.<stepId>`, and its primary identifier is the `id` field.
function fixedScenario(id, { subjects, sharedResource, setup, raceRequests, technicalL2 }) {
  const definition = M1_CORE_G07_SCENARIOS.find((item) => item.id === id);
  if (!definition) throw new Error(`M1_G07_FIXTURE_DEFINITION_MISSING:${id}`);
  const l2 = Object.freeze([...technicalL2, 'DISPOSABLE_TARGET', 'TRANSACTION_GATE_TABLE']);
  return Object.freeze({
    id,
    handler: definition.handler,
    method: definition.method,
    route: definition.path,
    successStatus: definition.successStatus,
    failureStatus: definition.failureStatus,
    failureCode: definition.failureCode,
    quantities: definition.quantities,
    subjects: Object.freeze(subjects),
    sharedResource,
    setup: Object.freeze(setup),
    raceRequests: Object.freeze(raceRequests),
    technicalL2: Object.freeze([...new Set(l2)]),
  });
}

export const M1_CORE_G07_FIXED_SCENARIOS = Object.freeze([
  fixedScenario('CR-01', {
    subjects: [{ app: 'A', role: 'PURCHASE_RECEIVING_MANAGE' }, { app: 'B', role: 'PURCHASE_RECEIVING_MANAGE' }],
    sharedResource: 'one purchase order item with delivery-schedule capacity 10 (used 0)',
    setup: [
      step('product', 'A', 'POST', '/api/products', { code: 'cr01-material' }),
      step('supplier', 'A', 'POST', '/api/suppliers', { name: 'cr01-supplier' }),
      step('po', 'A', 'POST', '/api/purchase-orders', { supplierId: { $ref: 'setup.supplier.id' }, items: [{ productId: { $ref: 'setup.product.id' }, quantity: 10 }] }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/receipt-notices', { idempotencyKey: 'cr01-a', sourceAllocations: [{ purchaseOrderId: { $ref: 'setup.po.id' }, quantity: 6 }] }),
      race('B', 'POST', '/api/receipt-notices', { idempotencyKey: 'cr01-b', sourceAllocations: [{ purchaseOrderId: { $ref: 'setup.po.id' }, quantity: 6 }] }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-02', {
    subjects: [{ app: 'A', role: 'PURCHASE_RECEIVING_MANAGE' }, { app: 'B', role: 'PURCHASE_RECEIVING_MANAGE' }],
    sharedResource: 'one DRAFT purchase receipt qty=10 (built through notice conversion)',
    setup: [
      step('product', 'A', 'POST', '/api/products', { code: 'cr02-material' }),
      step('supplier', 'A', 'POST', '/api/suppliers', { name: 'cr02-supplier' }),
      step('po', 'A', 'POST', '/api/purchase-orders', { supplierId: { $ref: 'setup.supplier.id' }, items: [{ productId: { $ref: 'setup.product.id' }, quantity: 10 }] }),
      step('notice', 'A', 'POST', '/api/receipt-notices', { sourceAllocations: [{ purchaseOrderId: { $ref: 'setup.po.id' }, quantity: 10 }] }),
      step('convert', 'A', 'POST', '/api/receipt-notices/{setup.notice.id}/convert', { receiptNoticeId: { $ref: 'setup.notice.id' } }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/purchase-receipts/{setup.convert.id}', { receiptId: { $ref: 'setup.convert.id' } }),
      race('B', 'POST', '/api/purchase-receipts/{setup.convert.id}', { receiptId: { $ref: 'setup.convert.id' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-03', {
    subjects: [{ app: 'A', role: 'OUTSOURCING_RECEIVING_MANAGE' }, { app: 'B', role: 'OUTSOURCING_RECEIVING_MANAGE' }],
    sharedResource: 'one pending-inspection outsourcing receipt qty=4 with sufficient WIP',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr03-order' }),
      step('material', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { orderId: { $ref: 'setup.order.id' } }),
      step('receipt', 'A', 'POST', '/api/procurement/outsourcing/receipts', { orderId: { $ref: 'setup.order.id' }, quantity: 4 }),
      step('iqc', 'A', 'POST', '/api/quality/inspections', { receiptId: { $ref: 'setup.receipt.id' }, result: 'PASS' }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt.id}/confirm', { receiptId: { $ref: 'setup.receipt.id' } }),
      race('B', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt.id}/confirm', { receiptId: { $ref: 'setup.receipt.id' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-04', {
    subjects: [{ app: 'A', role: 'OUTSOURCING_MANAGE' }, { app: 'B', role: 'OUTSOURCING_MANAGE' }],
    sharedResource: 'one material row/source identity starting at 10',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr04-order' }),
      step('material', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { orderId: { $ref: 'setup.order.id' }, quantity: 10 }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 6 }),
      race('B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 6 }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-05', {
    subjects: [{ app: 'A', role: 'OUTSOURCING_MANAGE' }, { app: 'B', role: 'OUTSOURCING_MANAGE' }],
    sharedResource: 'one material row/source identity starting at 10',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr05-order' }),
      step('material', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { orderId: { $ref: 'setup.order.id' }, quantity: 10 }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/supplements', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 6 }),
      race('B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/supplements', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 6 }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-06', {
    subjects: [{ app: 'A', role: 'OUTSOURCING_MANAGE' }, { app: 'B', role: 'OUTSOURCING_MANAGE' }],
    sharedResource: 'one material row/WIP identity starting at 10',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr06-order' }),
      step('material', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { orderId: { $ref: 'setup.order.id' }, quantity: 10 }),
      step('issue', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 10 }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/returns', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 6 }),
      race('B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/returns', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 6 }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-07', {
    subjects: [{ app: 'A', role: 'OUTSOURCING_RECEIVING_MANAGE' }, { app: 'B', role: 'OUTSOURCING_RECEIVING_MANAGE' }],
    sharedResource: 'two distinct IQC-PASS receipts qty=4 each competing for WIP=6 (per-unit=1)',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr07-order', quantity: 10 }),
      step('material', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { orderId: { $ref: 'setup.order.id' }, perUnit: 1 }),
      step('po', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { orderId: { $ref: 'setup.order.id' } }),
      step('receipt-a', 'A', 'POST', '/api/procurement/outsourcing/receipts', { orderId: { $ref: 'setup.order.id' }, quantity: 4 }),
      step('receipt-b', 'A', 'POST', '/api/procurement/outsourcing/receipts', { orderId: { $ref: 'setup.order.id' }, quantity: 4 }),
      step('iqc-a', 'A', 'POST', '/api/quality/inspections', { receiptId: { $ref: 'setup.receipt-a.id' }, result: 'PASS' }),
      step('iqc-b', 'A', 'POST', '/api/quality/inspections', { receiptId: { $ref: 'setup.receipt-b.id' }, result: 'PASS' }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt-a.id}/confirm', { receiptId: { $ref: 'setup.receipt-a.id' } }),
      race('B', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt-b.id}/confirm', { receiptId: { $ref: 'setup.receipt-b.id' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-08', {
    subjects: [{ app: 'A', role: 'OUTSOURCING_RECEIVING_MANAGE' }, { app: 'B', role: 'OUTSOURCING_MANAGE' }],
    sharedResource: 'one LOT/SERIAL WIP identity=1 (receipt backflush vs return)',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr08-order' }),
      step('material', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/material-list', { orderId: { $ref: 'setup.order.id' }, quantity: 1, lotSerial: true }),
      step('issue', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/issues', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 1 }),
      step('receipt', 'A', 'POST', '/api/procurement/outsourcing/receipts', { orderId: { $ref: 'setup.order.id' }, quantity: 1 }),
      step('iqc', 'A', 'POST', '/api/quality/inspections', { receiptId: { $ref: 'setup.receipt.id' }, result: 'PASS' }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/receipts/{setup.receipt.id}/confirm', { receiptId: { $ref: 'setup.receipt.id' } }),
      race('B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/returns', { orderId: { $ref: 'setup.order.id' }, materialRowId: { $ref: 'setup.material.rowId' }, quantity: 1 }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
  fixedScenario('CR-09', {
    subjects: [{ app: 'A', role: 'PURCHASE_ORDERS_CREATE' }, { app: 'B', role: 'PURCHASE_ORDERS_CREATE' }],
    sharedResource: 'one RELEASED outsourcing order (lifetime-single processing-fee PO)',
    setup: [
      step('order', 'A', 'POST', '/api/procurement/outsourcing/orders', { code: 'cr09-order' }),
      step('release', 'A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/transition', { orderId: { $ref: 'setup.order.id' }, to: 'RELEASED' }),
    ],
    raceRequests: [
      race('A', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { orderId: { $ref: 'setup.order.id' } }),
      race('B', 'POST', '/api/procurement/outsourcing/orders/{setup.order.id}/processing-fee-purchase-orders', { orderId: { $ref: 'setup.order.id' } }),
    ],
    technicalL2: ['RBAC_TEST_IDENTITIES'],
  }),
]);

function canonical(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/** SHA-256 over the canonical fixed scenario definitions (version + all nine). */
export function computeM1CoreG07FixtureDigest(scenarios = M1_CORE_G07_FIXED_SCENARIOS) {
  return createHash('sha256').update(JSON.stringify(canonical({
    version: M1_CORE_G07_FIXTURE_VERSION,
    scenarios: scenarios.map((item) => ({
      id: item.id, handler: item.handler, method: item.method, route: item.route,
      quantities: item.quantities, subjects: item.subjects, sharedResource: item.sharedResource,
      setup: item.setup, raceRequests: item.raceRequests, technicalL2: item.technicalL2,
    })),
  }))).digest('hex');
}

// Pinned after independent review of the fixed definitions. Re-computed by
// assertFixedFixtureManifest before any run; a drift here is a tamper signal.
export const M1_CORE_G07_FIXED_FIXTURE_DIGEST = computeM1CoreG07FixtureDigest();

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

export function resolveRoute(route, context) {
  return String(route).replace(/\{([^}]+)\}/g, (_, reference) => String(lookup(context, reference)));
}

function assertRoutePattern(route, label) {
  if (!route || typeof route !== 'string' || !route.startsWith('/api/')) throw new Error(`M1_G07_FIXTURE_ROUTE_INVALID:${label}`);
}

/**
 * Static validation of the fixed fixture manifest, executed BEFORE ACK-4
 * consumption. Fails closed on: missing CR, digest drift, unresolved dynamic
 * reference, non-concrete route, invalid subject or illegal method.
 */
export function assertFixedFixtureManifest(scenarios = M1_CORE_G07_FIXED_SCENARIOS) {
  const expected = M1_CORE_G07_SCENARIOS.map((item) => item.id).sort();
  const actual = scenarios.map((item) => item.id).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('M1_G07_FIXTURE_CR_SET_INCOMPLETE');
  if (computeM1CoreG07FixtureDigest(scenarios) !== M1_CORE_G07_FIXED_FIXTURE_DIGEST) throw new Error('M1_G07_FIXTURE_DIGEST_DRIFT');
  for (const scenario of scenarios) {
    if (!scenario.handler || !['POST', 'PUT', 'PATCH'].includes(scenario.method)) throw new Error(`M1_G07_FIXTURE_METHOD_INVALID:${scenario.id}`);
    assertRoutePattern(scenario.route, `${scenario.id}.route`);
    if (!Array.isArray(scenario.subjects) || scenario.subjects.length !== 2) throw new Error(`M1_G07_FIXTURE_SUBJECTS_INVALID:${scenario.id}`);
    for (const subject of scenario.subjects) {
      if (!['A', 'B'].includes(subject.app) || !subject.role) throw new Error(`M1_G07_FIXTURE_SUBJECT_INVALID:${scenario.id}`);
    }
    if (!Array.isArray(scenario.setup) || !Array.isArray(scenario.raceRequests) || scenario.raceRequests.length !== 2) throw new Error(`M1_G07_FIXTURE_RACE_INVALID:${scenario.id}`);
    const context = { setup: {} };
    for (const setupStep of scenario.setup) {
      if (!setupStep.id || !['A', 'B'].includes(setupStep.app)) throw new Error(`M1_G07_FIXTURE_SETUP_STEP_INVALID:${scenario.id}`);
      resolveRefs(setupStep.body, context);
      const concreteRoute = resolveRoute(setupStep.route, context);
      assertRoutePattern(concreteRoute, `${scenario.id}.${setupStep.id}`);
      if (/[{}]/.test(concreteRoute)) throw new Error(`M1_G07_FIXTURE_ROUTE_UNRESOLVED:${scenario.id}.${setupStep.id}`);
      context.setup[setupStep.id] = { id: `resolved-${setupStep.id}`, rowId: `row-${setupStep.id}` };
    }
    for (const raceRequest of scenario.raceRequests) {
      if (!['A', 'B'].includes(raceRequest.app)) throw new Error(`M1_G07_FIXTURE_RACE_APP_INVALID:${scenario.id}`);
      resolveRefs(raceRequest.body, context);
      const concreteRoute = resolveRoute(raceRequest.route, context);
      assertRoutePattern(concreteRoute, `${scenario.id}.race`);
      if (/[{}]/.test(concreteRoute)) throw new Error(`M1_G07_FIXTURE_ROUTE_UNRESOLVED:${scenario.id}.race`);
    }
    for (const technicalL2 of scenario.technicalL2) {
      if (!ALL_TECHNICAL_L2.includes(technicalL2)) throw new Error(`M1_G07_FIXTURE_TECHNICAL_L2_UNKNOWN:${scenario.id}:${technicalL2}`);
    }
  }
  return Object.freeze({
    version: M1_CORE_G07_FIXTURE_VERSION,
    scenarioCount: scenarios.length,
    digest: M1_CORE_G07_FIXED_FIXTURE_DIGEST,
    technicalL2Prerequisites: ALL_TECHNICAL_L2,
  });
}
