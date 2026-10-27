// Protected real-MySQL Wave 10 business matrix (M-BIZ-01..20).
//
// Every business transition in this matrix is performed by a canonical
// production writer: the Sales Order create/submit/approve handlers, the
// registered `POST /api/sales-deliveries` route and its confirmation route,
// the canonical invoice create/post lifecycle and the canonical collection
// settlement. A direct write of a business status column would substitute the
// transition that the case accepts, so none is used.
//
// Declared direct-DML setup facts (their production creation is outside the case):
//   - the Credit Profile reference rows, the rule, the parameter and the lock
//     anchors, because a Profile status change (SUSPENDED/CLOSED) has no
//     production writer and is only reachable as a reference fact;
//   - the draft Sales Order rows that only serve as the credit check's source
//     reference, and the DRAFT orders of the Credit-only cases;
//   - the historical approval stamp of an order that was approved years ago,
//     because no production writer creates such a historical document;
//   - the deliberately broken invoice lineage of M-BIZ-15, which exists
//     specifically to prove that an inconsistent lineage fails closed;
//   - the manual receivable of M-BIZ-08 and its overdue due date, which are
//     reference facts of a receivable that is settled canonically afterwards.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { transaction } from './db.js';
import { createApp } from './app.js';
import { assertCreditAllowsBusinessAction, computeCreditExposure, evaluateCredit } from './modules/credit-check.js';
import { decideCreditSpecialApproval, requestCreditSpecialApproval } from './modules/credit-special-approval.js';
import { createSalesOrder, salesOrderAction } from './modules/sales-orders.js';
import { createSalesInvoice, postSalesInvoice } from './modules/commercial-golive.js';
import { createTempDb } from './test-utils/temp-db.js';
import {
  captureWave10PersistenceProjection, creditInput, productionOrderBody, seedReceivable,
  seedSubmittedOrder, seedWave10AcceptanceBase, wave10BusinessDate, wave10DeliveryRequest,
  wave10FutureBusinessDateFrom, wave10HttpLogin, wave10HttpRequest, wave10MysqlTempOptions,
} from './test-utils/wave10-mysql-acceptance-fixture.js';

const required = ['ERP_DB_HOST', 'ERP_DB_PORT', 'ERP_DB_NAME', 'ERP_DB_USER', 'ERP_DB_PASSWORD', 'ERP_MYSQL_WAVE10_CAMPAIGN_LEASE'];
for (const name of required) if (!process.env[name]) throw new Error(`MYSQL TEST ENVIRONMENT = UNAVAILABLE (${name} missing)`);

const APPROVER = Object.freeze({ id: 'w10-race-approver', roleCode: 'ADMIN', permissions: ['CREDIT_SPECIAL_APPROVE'] });
const REQUESTER = Object.freeze({
  id: 'w10-race-creator', roleCode: 'ADMIN',
  permissions: ['CREDIT_SPECIAL_APPROVE', 'ORDERS_CREATE', 'ORDERS_SUBMIT'],
});
const ORDER_MANAGER = Object.freeze({
  id: 'w10-race-approver', roleCode: 'ADMIN',
  permissions: ['SALES_MANAGE', 'SALES_CROSS_GROUP', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE'],
});

function request(body, key) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.headers = { 'content-type': 'application/json', 'idempotency-key': key };
  return req;
}

function response() {
  return { statusCode: null, body: null, setHeader() {}, end(value) { this.body = value ? JSON.parse(value) : null; } };
}

async function invoke(handler, db, body, actor, key, ...tail) {
  const res = response();
  await handler(db, request(body, key), res, actor, ...tail);
  return res;
}

async function withMatrix(label, options, body) {
  const handle = createTempDb(wave10MysqlTempOptions(label));
  try {
    assert.equal(handle.db.dialect, 'mysql');
    await seedWave10AcceptanceBase(handle.db, options);
    return await body(handle.db, createApp(handle.db));
  } finally { handle.cleanup(); }
}

// ---------------------------------------------------------------------------
// Canonical production transitions
//
// The Sales Order, Delivery, invoice and collection transitions below are
// performed by the production writers. A directly inserted APPROVED order, a
// directly written CONFIRMED delivery, a directly written posted invoice or
// a directly written invoice source link would substitute a business action
// for the transition that the case accepts, so none of them is used.
// ---------------------------------------------------------------------------

async function canonicalApprovedOrder(db, {
  key, salespersonId = 'w10-race-sp-a', quantityMicros = 1_000_000,
} = {}) {
  const created = await invoke(createSalesOrder, db, productionOrderBody({ salespersonId, quantityMicros }),
    REQUESTER, `${key}-create`);
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const orderId = created.body.id;
  assert.ok(orderId, 'the canonical order creation must return the order id');
  const submitted = await invoke(salesOrderAction, db, { reason: 'Wave 10 submit' }, REQUESTER, `${key}-submit`, orderId, 'submit');
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
  const approved = await invoke(salesOrderAction, db, { reason: 'Wave 10 approve' }, ORDER_MANAGER, `${key}-approve`, orderId, 'approve');
  assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
  const orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no,id LIMIT 1').get(orderId)?.id;
  assert.ok(orderItemId, 'the canonical order must create its own order line');
  return { orderId, orderItemId, totalCents: Number(created.body.totalCents) };
}

// The canonical Delivery transition over the real production HTTP dispatch.
async function canonicalDelivery(app, db, {
  orderId, orderItemId, quantity = 1, billingMode = 'SEPARATE', key,
}) {
  const token = await wave10HttpLogin(app);
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/sales-deliveries',
    body: wave10DeliveryRequest({ orderId, orderItemId, quantity, billingMode }), token,
  });
  if (created.statusCode !== 201) {
    throw new Error(`canonical delivery creation failed: ${created.statusCode} ${JSON.stringify(created.body)}`);
  }
  const deliveryId = created.body.id;
  const confirmed = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/sales-deliveries/${deliveryId}`, body: { action: 'confirm' },
    token, headers: { 'idempotency-key': `${key}-confirm` },
  });
  if (confirmed.statusCode !== 200) {
    throw new Error(`canonical delivery confirmation failed: ${confirmed.statusCode} ${JSON.stringify(confirmed.body)}`);
  }
  const deliveryItemId = db.prepare('SELECT id FROM sales_delivery_items WHERE delivery_id=? ORDER BY line_no,id LIMIT 1').get(deliveryId)?.id;
  assert.ok(deliveryItemId, 'the canonical delivery confirmation must produce its own delivery line');
  return { deliveryId, deliveryItemId };
}

// The canonical invoice create/post lifecycle. The invoice lines reference the
// canonical delivery lines, so the invoice source links and the Finance AR are
// produced by the production recognition writer.
function canonicalInvoice(db, { deliveryItems, idempotencyKey, invoiceDate = wave10BusinessDate(), unitPriceCents }) {
  const invoice = createSalesInvoice(db, {
    customerId: 'w10-race-customer', invoiceDate, taxMode: 'NO_TAX',
    items: deliveryItems.map((item) => ({
      deliveryItemId: item.deliveryItemId, quantity: 1, ...(unitPriceCents ? { unitPriceCents } : {}),
    })),
    actorId: 'w10-race-creator', idempotencyKey,
  });
  const postedInvoice = postSalesInvoice(db, invoice.id, 'w10-race-creator');
  const receivable = db.prepare('SELECT * FROM account_receivables WHERE source_type=? AND source_id=?').get('SALES_INVOICE', invoice.id);
  assert.ok(receivable, 'the canonical invoice posting must create the Finance AR');
  return { invoice: postedInvoice, receivable };
}

// The canonical collection settlement. The receivable outstanding balance is
// refreshed by the production settlement writer.
async function canonicalCollection(app, { receivableId, amountCents, key }) {
  const token = await wave10HttpLogin(app);
  const created = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/payment-collections',
    body: {
      customerId: 'w10-race-customer', amountCents, paymentMethod: 'CASH',
      businessDate: wave10BusinessDate(), settlementAccountId: 'w10-race-cash-account',
      allocations: [{ receivableId, amountCents }], remark: 'Wave 10 canonical collection',
    },
    token,
  });
  if (created.statusCode !== 201) {
    throw new Error(`canonical collection creation failed: ${created.statusCode} ${JSON.stringify(created.body)}`);
  }
  const collectionId = created.body.id;
  const confirmed = await wave10HttpRequest(app, {
    method: 'POST', path: `/api/payment-collections/${collectionId}/confirm`, body: {},
    token, headers: { 'idempotency-key': `${key}-confirm` },
  });
  if (confirmed.statusCode !== 200) {
    throw new Error(`canonical collection confirmation failed: ${confirmed.statusCode} ${JSON.stringify(confirmed.body)}`);
  }
  return { collectionId };
}

function runCheck(db, overrides = {}) {
  let outcome;
  transaction(db, () => { outcome = evaluateCredit(db, creditInput({ orderId: overrides.orderId || 'matrix-order', ...overrides })); });
  return outcome;
}

function exposure(db, businessDate = wave10BusinessDate(), salespersonId = 'w10-race-sp-a') {
  return computeCreditExposure(db, { customerId: 'w10-race-customer', salespersonId, businessDate });
}

// The canonical Sales Order → Delivery → Invoice → AR chain.
async function canonicalInvoiceScenario(app, db, prefix, {
  quantityMicros = 1_000_000, deliveries = 1, invoiceUnitPriceCents, salespersonId = 'w10-race-sp-a',
} = {}) {
  const order = await canonicalApprovedOrder(db, { key: prefix, salespersonId, quantityMicros });
  const lines = [];
  for (let index = 0; index < deliveries; index += 1) {
    lines.push(await canonicalDelivery(app, db, {
      orderId: order.orderId, orderItemId: order.orderItemId, key: `${prefix}-delivery-${index}`,
    }));
  }
  const { invoice, receivable } = canonicalInvoice(db, {
    deliveryItems: lines, idempotencyKey: `${prefix}-invoice`, unitPriceCents: invoiceUnitPriceCents,
  });
  return { ...order, deliveries: lines, invoice, receivable };
}

test('M-BIZ-01 B-9 ACTIVE Profile authorizes a controlled evaluation', async () => {
  await withMatrix('biz01', { aggregateLimit: 300000 }, (db) => {
    seedSubmittedOrder(db, { id: 'biz01-order', status: 'DRAFT' });
    const outcome = runCheck(db, { orderId: 'biz01-order' });
    assert.equal(outcome.enforced, true); assert.equal(outcome.decision, 'PASS');
  });
});

test('M-BIZ-02 B-9 SUSPENDED Profile fails with the status-specific contract and zero delta', async () => {
  await withMatrix('biz02', { aggregateLimit: 300000, aggregateProfileStatus: 'SUSPENDED' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz02-order', status: 'DRAFT' });
    const before = captureWave10PersistenceProjection(db);
    assert.throws(() => runCheck(db, { orderId: 'biz02-order' }), (error) => error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE' && error.details?.profileStatus === 'SUSPENDED');
    assert.deepEqual(captureWave10PersistenceProjection(db), before);
  });
});

test('M-BIZ-03 B-9 CLOSED current Profile does not fall back to historical ACTIVE', async () => {
  await withMatrix('biz03', { aggregateLimit: 300000, aggregateProfileStatus: 'CLOSED' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz03-order', status: 'DRAFT' });
    db.prepare("UPDATE credit_profile SET effective_from='2026-01-01' WHERE id='w10-profile-agg'").run();
    assert.throws(() => runCheck(db, { orderId: 'biz03-order' }), (error) => error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE' && error.details?.profileStatus === 'CLOSED');
  });
});

test('M-BIZ-04 B-9 Special Approval and aggregate Profile cannot bypass a non-ACTIVE salesperson scope', async () => {
  await withMatrix('biz04', { aggregateLimit: 50000, salespersonLimit: 50000, scenario: 'OVERRIDE_REQUEST', controlStrength: 'WARNING' }, async (db) => {
    // §37.49.3.1 — one controlled business date for the whole case, and one
    // expiry derived from it and shared by the request and the decision.
    const businessDate = wave10BusinessDate();
    const expiryBusinessDate = wave10FutureBusinessDateFrom(businessDate);
    seedSubmittedOrder(db, { id: 'biz04-order', cents: 100000, status: 'DRAFT' });
    const initial = runCheck(db, { orderId: 'biz04-order', proposedDeltaCents: 100000, businessDate });
    const aggregate = initial.scopeResults.find((row) => row.scopeType === 'CUSTOMER_AGGREGATE');
    assert.equal(aggregate.decision, 'SPECIAL_APPROVAL_REQUIRED');
    const aggregateRow = db.prepare("SELECT id FROM credit_check_results WHERE check_group_id=? AND scope_type='CUSTOMER_AGGREGATE'").get(initial.checkGroupId);
    assert.ok(aggregateRow);
    const requested = await invoke(requestCreditSpecialApproval, db, {
      sourceCreditCheckResultId: aggregateRow.id, reason: 'M-BIZ-04', requestedOverrideCents: 50000,
      requestedCeilingCents: 100000, requestedExpiryBusinessDate: expiryBusinessDate, scopeMode: 'ONE_TIME',
    }, REQUESTER, 'biz04-request');
    const approvalId = requested.body.approval.id;
    await invoke(decideCreditSpecialApproval, db, {
      decision: 'APPROVED', approvedOverrideCents: 50000, approvedCeilingCents: 100000,
      approvedExpiryBusinessDate: expiryBusinessDate, reason: 'bounded',
    }, APPROVER, 'biz04-decide', approvalId);
    db.prepare("UPDATE credit_profile SET status='SUSPENDED' WHERE id='w10-profile-a'").run();
    const before = captureWave10PersistenceProjection(db);
    assert.throws(() => runCheck(db, { orderId: 'biz04-order', proposedDeltaCents: 100000, businessDate }),
      (error) => error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE' && error.details?.scopeType === 'SALESPERSON_SUB_LIMIT');
    assert.deepEqual(captureWave10PersistenceProjection(db), before);
    assert.equal(Number(db.prepare("SELECT COUNT(*) count FROM audit_logs WHERE entity_type='CREDIT_SPECIAL_APPROVAL' AND action='CONSUME'").get().count), 0);
  });
});

test('M-BIZ-05 B-10 unresolved old approved SO remains in exposure', async () => {
  await withMatrix('biz05', {}, async (db) => {
    const order = await canonicalApprovedOrder(db, { key: 'biz05' });
    // Declared historical reference fact: an order that was approved years
    // ago and never extinguished. No production writer creates such a
    // historical document.
    db.prepare("UPDATE sales_orders SET order_date='2010-01-01',reviewed_at='2010-01-02T00:00:00.000Z' WHERE id=?").run(order.orderId);
    assert.equal(exposure(db).aggregateComponents.approvedSoCommitmentCents, 100000);
  });
});

test('M-BIZ-06 B-10 arbitrary business-date advance does not expire the unresolved SO', async () => {
  await withMatrix('biz06', {}, async (db) => {
    const order = await canonicalApprovedOrder(db, { key: 'biz06' });
    assert.ok(order.orderId);
    assert.equal(exposure(db, wave10BusinessDate()).aggregateComponents.approvedSoCommitmentCents, 100000);
    assert.equal(exposure(db, '2099-12-31').aggregateComponents.approvedSoCommitmentCents, 100000);
  });
});

test('M-BIZ-07 B-10 canonical terminal facts release only extinguished undelivered cents', async () => {
  await withMatrix('biz07', {}, async (db, app) => {
    // The cancelled order releases its whole commitment.
    const cancelled = await canonicalApprovedOrder(db, { key: 'biz07-cancel' });
    const cancellation = await invoke(salesOrderAction, db, { reason: 'Wave 10 B-10 cancellation' },
      ORDER_MANAGER, 'biz07-cancel-cancel', cancelled.orderId, 'cancel');
    assert.equal(cancellation.statusCode, 200, JSON.stringify(cancellation.body));
    assert.equal(db.prepare('SELECT commercial_close_state FROM sales_orders WHERE id=?').get(cancelled.orderId).commercial_close_state, 'CANCELLED');
    // The controlled close releases only the undelivered remainder; the already
    // delivered portion stays represented by the delivered stage.
    const closed = await canonicalApprovedOrder(db, { key: 'biz07-close', quantityMicros: 2_000_000 });
    await canonicalDelivery(app, db, { orderId: closed.orderId, orderItemId: closed.orderItemId, key: 'biz07-close-delivery' });
    const close = await invoke(salesOrderAction, db, { reason: 'Wave 10 B-10 controlled close' },
      ORDER_MANAGER, 'biz07-close-close', closed.orderId, 'close');
    assert.equal(close.statusCode, 200, JSON.stringify(close.body));
    assert.equal(db.prepare('SELECT commercial_close_state FROM sales_orders WHERE id=?').get(closed.orderId).commercial_close_state, 'CLOSED');
    const result = exposure(db);
    assert.equal(result.aggregateComponents.approvedSoCommitmentCents, 0, 'both terminal facts must release the SO commitment stage');
    assert.equal(result.aggregateComponents.deliveredNotSettledCents, 100000, 'the delivered portion must remain in the delivered stage');
    assert.equal(result.aggregateComponents.arOpenCents, 0, 'the SEPARATE delivery recognition leaves the obligation in the delivered stage');
  });
});

test('M-BIZ-08 B-10 overdue AR remains once until a proven settled terminal state', async () => {
  await withMatrix('biz08', {}, async (db, app) => {
    // Declared reference fact: a manual receivable whose due date has passed.
    seedReceivable(db, { id: 'biz08-ar', sourceType: 'MANUAL', sourceId: 'biz08-source', amountCents: 70000, openCents: 70000 });
    db.prepare("UPDATE account_receivables SET due_date='2010-01-01' WHERE id='biz08-ar'").run();
    assert.equal(exposure(db).aggregateComponents.arOpenCents, 70000);
    // The settlement is a canonical collection document, and its production
    // confirmation refreshes the outstanding balance.
    await canonicalCollection(app, { receivableId: 'biz08-ar', amountCents: 70000, key: 'biz08-collection' });
    assert.equal(exposure(db).aggregateComponents.arOpenCents, 0);
  });
});

test('M-BIZ-09 S14 Mode B one invoice replaces delivered exposure exactly once', async () => {
  await withMatrix('biz09', {}, async (db, app) => {
    const scenario = await canonicalInvoiceScenario(app, db, 'biz09');
    assert.equal(Number(scenario.receivable.amount_cents), 100000);
    const result = exposure(db).aggregateComponents;
    assert.equal(result.deliveredNotSettledCents, 0, 'the invoice must replace the delivered stage');
    assert.equal(result.arOpenCents, 100000, 'the invoice must open the AR stage');
  });
});

test('M-BIZ-10 S14 partial invoice conserves delivered plus AR total', async () => {
  await withMatrix('biz10', {}, async (db, app) => {
    const scenario = await canonicalInvoiceScenario(app, db, 'biz10', { invoiceUnitPriceCents: 40000 });
    assert.equal(Number(scenario.receivable.amount_cents), 40000);
    const result = exposure(db).aggregateComponents;
    assert.equal(result.deliveredNotSettledCents, 60000);
    assert.equal(result.arOpenCents, 40000);
    assert.equal(result.deliveredNotSettledCents + result.arOpenCents, 100000, 'the obligation is conserved');
  });
});

test('M-BIZ-11 S14 partial collection retains only canonical open AR', async () => {
  await withMatrix('biz11', {}, async (db, app) => {
    const scenario = await canonicalInvoiceScenario(app, db, 'biz11');
    assert.equal(Number(scenario.receivable.open_amount_cents), 100000);
    await canonicalCollection(app, { receivableId: scenario.receivable.id, amountCents: 60000, key: 'biz11-collection' });
    const settled = db.prepare('SELECT open_amount_cents FROM account_receivables WHERE id=?').get(scenario.receivable.id);
    assert.equal(Number(settled.open_amount_cents), 40000, 'the production settlement refreshes the outstanding balance');
    const result = exposure(db);
    assert.equal(result.aggregateComponents.arOpenCents, 40000);
    assert.equal(result.salespersonComponents.arOpenCents, 40000);
  });
});

test('M-BIZ-12 S14 multiple delivery links conserve one invoice header', async () => {
  await withMatrix('biz12', {}, async (db, app) => {
    const scenario = await canonicalInvoiceScenario(app, db, 'biz12', { quantityMicros: 2_000_000, deliveries: 2 });
    const links = db.prepare('SELECT * FROM finance_invoice_source_links WHERE invoice_id=? ORDER BY source_id,id').all(scenario.invoice.id);
    assert.equal(links.length, 2, 'one canonical invoice source link per confirmed delivery line');
    assert.equal(new Set(links.map((row) => row.source_id)).size, 2);
    const result = exposure(db).aggregateComponents;
    assert.equal(result.arOpenCents, 200000, 'one invoice header carries the whole delivered obligation');
    assert.equal(result.deliveredNotSettledCents, 0, 'the delivered obligation is represented by exactly one stage');
  });
});

test('M-BIZ-13 S14 exact single-salesperson allocation remains attributable', async () => {
  await withMatrix('biz13', {}, async (db, app) => {
    await canonicalInvoiceScenario(app, db, 'biz13');
    const result = exposure(db);
    assert.equal(result.hasAmbiguousAttribution, false);
    assert.equal(result.salespersonComponents.arOpenCents, 100000);
  });
});

test('M-BIZ-14 S14 multi-salesperson residual is not guessed', async () => {
  await withMatrix('biz14', {}, async (db, app) => {
    const first = await canonicalApprovedOrder(db, { key: 'biz14-a', salespersonId: 'w10-race-sp-a' });
    const second = await canonicalApprovedOrder(db, { key: 'biz14-b', salespersonId: 'w10-race-sp-b' });
    const firstDelivery = await canonicalDelivery(app, db, { orderId: first.orderId, orderItemId: first.orderItemId, key: 'biz14-da' });
    const secondDelivery = await canonicalDelivery(app, db, { orderId: second.orderId, orderItemId: second.orderItemId, key: 'biz14-db' });
    const { invoice, receivable } = canonicalInvoice(db, {
      deliveryItems: [firstDelivery, secondDelivery], idempotencyKey: 'biz14-invoice',
    });
    assert.equal(Number(receivable.amount_cents), 200000);
    // A partial settlement across two salespersons leaves a remainder that
    // must never be guessed to one of them.
    await canonicalCollection(app, { receivableId: receivable.id, amountCents: 100000, key: 'biz14-collection' });
    const result = exposure(db);
    assert.equal(result.aggregateComponents.arOpenCents, 100000);
    assert.equal(result.salespersonComponents.arOpenCents, 0);
    assert.equal(result.ambiguousAttributionCents, 100000);
    assert.equal(invoice.status, 'POSTED');
  });
});
test('M-BIZ-15 S14 missing or inconsistent invoice lineage fails closed', async () => {
  await withMatrix('biz15', {}, (db) => {
    db.prepare(`INSERT INTO sales_invoices(id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,
      tax_snapshot_json,creator_id,created_at,posted_by,posted_at) VALUES('biz15-invoice','BIZ15','w10-race-customer',
      '2026-10-25','POSTED','NO_TAX',100000,0,100000,'[]','w10-race-creator','2026-10-25T10:00:00.000Z',
      'w10-race-approver','2026-10-25T10:00:00.000Z')`).run();
    seedReceivable(db, { id: 'biz15-ar', sourceType: 'SALES_INVOICE', sourceId: 'biz15-invoice', amountCents: 100000 });
    assert.throws(() => exposure(db), (error) => error.code === 'CREDIT_EXPOSURE_SOURCE_INCONSISTENT');
  });
});

test('M-BIZ-16 Recognition global rule applies to every supported mode', async () => {
  await withMatrix('biz16', { aggregateLimit: 50000, stage: 'SO_SUBMIT', scenario: 'WARNING_ONLY', controlStrength: 'WARNING' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz16-order', status: 'DRAFT' });
    for (const recognitionMode of ['DIRECT_BUSINESS_OPEN_ITEM', 'INVOICE_DRIVEN_OPEN_ITEM', 'PROVISIONAL_TO_FINANCIAL']) {
      assert.equal(runCheck(db, { orderId: 'biz16-order', stage: 'SO_SUBMIT', recognitionMode, proposedDeltaCents: 100000 }).decision, 'WARNING');
    }
  });
});

test('M-BIZ-17 Recognition exact-mode rule applies to its own mode', async () => {
  await withMatrix('biz17', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz17-order', status: 'DRAFT' });
    db.prepare("UPDATE credit_check_rules SET recognition_mode='INVOICE_DRIVEN_OPEN_ITEM' WHERE id='w10-race-rule'").run();
    const result = runCheck(db, { orderId: 'biz17-order', stage: 'SO_SUBMIT', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM', proposedDeltaCents: 100000 });
    assert.equal(result.enforced, true); assert.equal(result.decision, 'BLOCK');
  });
});

test('M-BIZ-18 Recognition other-mode-only is unenforced with no result or audit', async () => {
  await withMatrix('biz18', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz18-order', status: 'DRAFT' });
    db.prepare("UPDATE credit_check_rules SET recognition_mode='INVOICE_DRIVEN_OPEN_ITEM' WHERE id='w10-race-rule'").run();
    const before = captureWave10PersistenceProjection(db);
    const result = runCheck(db, { orderId: 'biz18-order', stage: 'SO_SUBMIT', recognitionMode: 'DIRECT_BUSINESS_OPEN_ITEM', proposedDeltaCents: 100000 });
    assert.equal(result.enforced, false); assert.deepEqual(result.reasonCodes, ['NO_APPLICABLE_EFFECTIVE_RULE']);
    assert.deepEqual(captureWave10PersistenceProjection(db), before);
  });
});

test('M-BIZ-19 Recognition disabled and no-rule paths stay unenforced with zero evidence', async () => {
  for (const variant of ['disabled', 'no-rule']) {
    await withMatrix(`biz19-${variant}`, {
      aggregateLimit: 50000, stage: 'SO_SUBMIT',
      // §37.49.2.3 — the no-rule variant keeps the rule as a complete, real,
      // dated and referenced fact and only moves its effective window, so the
      // rule set offers no effective rule for this stage on this business
      // date. No rule row is deleted and no reference is released.
      ruleMode: variant === 'no-rule' ? 'NOT_YET_EFFECTIVE' : 'EFFECTIVE',
    }, (db) => {
      seedSubmittedOrder(db, { id: `biz19-${variant}-order`, status: 'DRAFT' });
      if (variant === 'disabled') db.prepare("UPDATE credit_parameters SET value_bool=0 WHERE code='CREDIT_MANAGEMENT_ENABLED'").run();
      const before = captureWave10PersistenceProjection(db);
      const result = runCheck(db, { orderId: `biz19-${variant}-order`, stage: 'SO_SUBMIT', proposedDeltaCents: 100000 });
      assert.equal(result.enforced, false); assert.equal(result.decision, 'PASS');
      assert.deepEqual(result.reasonCodes, [variant === 'disabled' ? 'CREDIT_MANAGEMENT_DISABLED' : 'NO_APPLICABLE_EFFECTIVE_RULE']);
      assert.deepEqual(captureWave10PersistenceProjection(db), before);
    });
  }
});

test('M-BIZ-20 strongest applicable BLOCK rolls back; missing and non-ACTIVE contracts stay distinct', async () => {
  await withMatrix('biz20-strongest', { aggregateLimit: 50000, stage: 'SO_SUBMIT', scenario: 'WARNING_ONLY', controlStrength: 'WARNING' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz20-order', status: 'DRAFT' });
    db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
      recognition_mode,effective_from,status,result_payload_json,created_at,created_by) VALUES('biz20-block','BIZ20_BLOCK',
      'SO_SUBMIT','BLOCK','BEFORE_WRITE','BLOCK','ORDER_EXPOSURE','INVOICE_DRIVEN_OPEN_ITEM','2026-01-01','ACTIVE','{}',
      '2026-10-25T00:00:00.000Z','w10-race-approver')`).run();
    const before = captureWave10PersistenceProjection(db);
    assert.throws(() => transaction(db, () => assertCreditAllowsBusinessAction(db, {
      ...creditInput({ orderId: 'biz20-order', stage: 'SO_SUBMIT', recognitionMode: 'INVOICE_DRIVEN_OPEN_ITEM', proposedDeltaCents: 100000 }),
    })), (error) => error.code === 'CREDIT_CHECK_BLOCKED');
    assert.deepEqual(captureWave10PersistenceProjection(db), before);
  });
  await withMatrix('biz20-missing', { aggregateLimit: 50000, stage: 'SO_SUBMIT' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz20-missing-order', status: 'DRAFT' });
    db.prepare('DELETE FROM credit_profile_ratings').run(); db.prepare('DELETE FROM credit_profile').run();
    assert.throws(() => runCheck(db, { orderId: 'biz20-missing-order', stage: 'SO_SUBMIT' }), (error) => error.code === 'CREDIT_PROFILE_MISSING');
  });
  await withMatrix('biz20-nonactive', { aggregateLimit: 50000, stage: 'SO_SUBMIT', aggregateProfileStatus: 'SUSPENDED' }, (db) => {
    seedSubmittedOrder(db, { id: 'biz20-nonactive-order', status: 'DRAFT' });
    assert.throws(() => runCheck(db, { orderId: 'biz20-nonactive-order', stage: 'SO_SUBMIT' }), (error) => error.code === 'CREDIT_PROFILE_NOT_ENFORCEABLE');
  });
});
