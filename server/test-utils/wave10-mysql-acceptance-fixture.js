import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../db.js';
import { computeCreditExposure } from '../modules/credit-check.js';
import { resolveEffectiveCreditProfile } from '../modules/credit-profile.js';
import { createWave10MysqlLifecycle } from './mysql-wave10-campaign-target.js';
import { createTempDb } from './temp-db.js';

// The canonical production writers are reached through the real HTTP
// dispatch, so the fixture needs a login-capable account. The credential is
// test-only, lives in this fixture module and is never printed or persisted.
export const W10_TEST_CREDENTIALS = Object.freeze({
  username: 'w10-race-approver',
  password: 'wave10-fixture-account',
});


// §37.39.6.3 B — the exposure window is load-bearing. `readApprovedOrders()`
// filters `SUBSTR(reviewed_at,1,10)<=businessDate`, and the winner's
// `reviewed_at` is the wall clock at commit. A fixed calendar constant would
// silently drop the winner's commitment from the loser's exposure read once
// the campaign runs on a later date, so the business date is always derived
// from the actual run date.
export function wave10BusinessDate() {
  return new Date().toISOString().slice(0, 10);
}

// A business date that is always after the current business date, so a
// bounded approval expiry never depends on the calendar the campaign runs on.
export function wave10FutureBusinessDate(months = 6) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

export const W10_OBJECT = 'W10-RACE-OBJECT';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workerPath = resolve(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave10-worker.mjs');

export function wave10MysqlTempOptions(label) {
  return { label, production: true, mysqlLifecycle: createWave10MysqlLifecycle() };
}

// ---------------------------------------------------------------------------
// Canonical production HTTP dispatch
//
// `createApp(db)` returns the real application handler, so a canonical
// business action is exercised through the production authentication,
// authorization, validation, transaction, audit and idempotency contract
// instead of being simulated with direct SQL.
// ---------------------------------------------------------------------------

export function wave10HttpResponse() {
  const finishListeners = [];
  return {
    statusCode: 200,
    headers: {},
    bodyText: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
    once(event, listener) { if (event === 'finish') finishListeners.push(listener); return this; },
    end(value) {
      this.bodyText = value === undefined || value === null ? null : String(value);
      for (const listener of finishListeners.splice(0)) listener();
    },
    json() { return this.bodyText ? JSON.parse(this.bodyText) : null; },
  };
}

export async function wave10HttpRequest(app, { method = 'POST', path, body, token, headers = {} } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.url = path;
  req.headers = {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers,
  };
  const res = wave10HttpResponse();
  await app(req, res);
  return { statusCode: res.statusCode, body: res.json(), headers: res.headers };
}

export async function wave10HttpLogin(app, {
  username = W10_TEST_CREDENTIALS.username, password = W10_TEST_CREDENTIALS.password,
} = {}) {
  const outcome = await wave10HttpRequest(app, {
    method: 'POST', path: '/api/auth/login', body: { username, password },
  });
  if (outcome.statusCode !== 200 || !outcome.body?.token) {
    throw new Error(`WAVE10_HTTP_LOGIN_REFUSED:${outcome.statusCode}`);
  }
  return outcome.body.token;
}

// The canonical Delivery request. The values are the production contract:
// `sourceMode` selects the source chain, `billingMode` selects the Finance
// recognition mode that `createSalesDelivery` writes onto the delivery, and
// the line references the approved order's own item.
export function wave10DeliveryRequest({
  orderId, orderItemId, quantity = 1, warehouseId = 'w10-race-warehouse',
  customerId = 'w10-race-customer', billingMode = 'SEPARATE', deliveryDate,
} = {}) {
  return {
    salesOrderId: orderId,
    customerId,
    warehouseId,
    deliveryDate: deliveryDate || wave10BusinessDate(),
    billingMode,
    sourceMode: 'DIRECT_ORDER',
    remark: 'Wave 10 canonical delivery',
    items: [{ salesOrderItemId: orderItemId, quantity }],
  };
}

export class Wave10Worker {
  constructor(name) {
    this.name = name;
    this.pending = new Map();
    this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], {
      cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    this.exited = new Promise((resolveExit) => this.child.once('exit', resolveExit));
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply;
      try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
  }

  run(command, timeoutMs = 45_000) {
    const id = randomUUID();
    return new Promise((resolveRun, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} timeout on ${command.action}: ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveRun, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }

  async close() {
    let closeError = null;
    try { await this.run({ action: 'close' }, 5_000); } catch (error) { closeError = error; }
    try { this.child.stdin.end(); } catch {}
    if (this.child.exitCode === null) {
      const killer = setTimeout(() => this.child.kill('SIGKILL'), 5_000);
      await this.exited; clearTimeout(killer);
    }
    if (closeError && this.child.exitCode !== 0) throw closeError;
  }
}

export async function withWave10Race(label, options, body, { workerCount = 3 } = {}) {
  const handle = createTempDb(wave10MysqlTempOptions(label));
  const workers = Array.from({ length: workerCount }, (_, index) => new Wave10Worker(`${label}-${index + 1}`));
  let primaryError = null;
  try {
    assert.equal(handle.db.dialect, 'mysql');
    seedWave10AcceptanceBase(handle.db, options);
    const registrations = await Promise.all(workers.map((worker) => worker.run({ action: 'register' })));
    assert.ok(registrations.every((row) => row.dialect === 'mysql'));
    assert.equal(new Set(registrations.map((row) => row.connectionId)).size, workers.length, `${label}: independent sessions required`);
    return await body(handle.db, workers, registrations);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const closes = await Promise.allSettled(workers.map((worker) => worker.close()));
    try { handle.cleanup(); }
    catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], `${label}: body and cleanup failed`);
      throw cleanupError;
    }
    const rejected = closes.filter((result) => result.status === 'rejected');
    if (!primaryError && rejected.length) throw new AggregateError(rejected.map((result) => result.reason), `${label}: worker cleanup failed`);
  }
}

export async function waitForWave10Waiters(observer, {
  waiterIds, holderId, objectName = 'mysql_transaction_gates', attempts = 100,
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const observed = await observer.run({ action: 'observe-waits' });
    const matching = observed.waits.filter((row) => waiterIds.includes(Number(row.waiter_connection_id))
      && Number(row.holder_connection_id) === Number(holderId) && row.object_name === objectName);
    if (new Set(matching.map((row) => Number(row.waiter_connection_id))).size === waiterIds.length) return matching;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`WAVE10_WAIT_EVIDENCE_UNAVAILABLE: ${objectName}`);
}

// §37.39.6.1 — the coordinator holds the production L0 gate row and every
// contender must be observably pending on that boundary before the release.
// `Promise.all` alone is never the barrier. The last worker is the
// coordinator; every other worker is a contender.
export async function runCoordinatedWave10Race(workers, registrations, commands) {
  assert.ok(Array.isArray(commands) && commands.length >= 2, 'a coordinated race needs at least two contenders');
  assert.ok(workers.length > commands.length, 'a coordinated race needs a dedicated coordinator session');
  const contenders = workers.slice(0, commands.length);
  const coordinator = workers[workers.length - 1];
  const contenderRegistrations = registrations.slice(0, commands.length);
  const coordinatorRegistration = registrations[registrations.length - 1];
  assert.equal((await coordinator.run({ action: 'raw-gate-hold' })).held, true);
  for (const [index, contender] of contenders.entries()) {
    assert.equal((await contender.run({ action: 'prepare', command: commands[index] })).ready, true, `contender ${index} must be ready`);
  }
  const pending = contenders.map((contender) => contender.run({ action: 'go' }));
  const waits = await waitForWave10Waiters(coordinator, {
    waiterIds: contenderRegistrations.map((row) => row.connectionId),
    holderId: coordinatorRegistration.connectionId,
  });
  await coordinator.run({ action: 'release' });
  return Object.freeze({ outcomes: await Promise.all(pending), waits });
}

export function seedWave10AcceptanceBase(db, {
  aggregateLimit = 300000, salespersonLimit = null, secondSalespersonLimit = null,
  stage = 'SO_APPROVE', scenario = 'BLOCK', controlStrength = 'BLOCK',
  aggregateProfileStatus = 'ACTIVE', salespersonProfileStatus = 'ACTIVE', secondSalespersonProfileStatus = 'ACTIVE',
} = {}) {
  const now = new Date().toISOString();
  // The canonical Delivery path is reached over the real HTTP dispatch, so the
  // fixture accounts carry a real password hash and the existing permitted
  // `role-admin` role. The credential stays inside this fixture.
  const credential = hashPassword(W10_TEST_CREDENTIALS.password);
  for (const id of ['w10-race-creator', 'w10-race-approver', 'w10-race-sales-a', 'w10-race-sales-b']) {
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-admin',1,?)`).run(id, id, id, credential.hash, credential.salt, now);
  }
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('w10-race-customer','W10-RACE','Wave 10 Race','','','',1,?,?)`).run(now, now);
  for (const [id, user] of [['w10-race-sp-a','w10-race-sales-a'], ['w10-race-sp-b','w10-race-sales-b']]) {
    db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
      VALUES(?,?,?,?,1,?,?)`).run(id, id.toUpperCase(), id, user, now, now);
  }
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
    VALUES('w10-race-group','W10-RACE-G','Wave 10 Race Group','',1,?,?)`).run(now, now);
  for (const [id, salespersonId, isDefault] of [['w10-race-member-a','w10-race-sp-a',1], ['w10-race-member-b','w10-race-sp-b',0]]) {
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
      VALUES(?,?, 'w10-race-group',?,1,'2020-01-01',NULL,?,?)`).run(id, salespersonId, isDefault, now, now);
  }
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES('w10-race-warehouse','W10-RACE-WH','Wave 10 Race Warehouse','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES('w10-race-product','W10-RACE-P','Wave 10 Race Product','','EA',100000,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,service_kind,
    active,created_at,updated_at,created_by,updated_by)
    VALUES('w10-race-class','w10-race-product',1,'EA','EA',0,5000,0,NULL,1,?,?, 'w10-race-approver','w10-race-approver')`).run(now, now);
  const priceListId = '10000000-0000-4000-8000-000000000001';
  const priceEntryId = 'w10-race-price-entry';
  db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,fallback_price_list_id,
    effective_from,effective_to,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
    VALUES(?,'W10-RACE-PRICE','Wave 10 Race Price','CNY',0,NULL,'2020-01-01',NULL,'ACTIVE',?,
      'w10-race-approver',?,'w10-race-approver',?,'w10-race-approver')`).run(priceListId, now, now, now);
  const materialKey = `M:${Buffer.from('w10-race-product').toString('hex').toUpperCase()}`;
  const pricingKey = `U:${Buffer.from('EA').toString('hex').toUpperCase()}|Q:${String(1_000_000).padStart(16, '0')}|D:20200101`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,
    material_identity_key,customer_scope_key,pricing_uom_code,pricing_identity_key,qty_break_min_micros,
    qty_break_max_micros,effective_from,effective_to,created_at,created_by)
    VALUES(?,?, 'w10-race-product',NULL,'ALL',?,'A','EA',?,1000000,NULL,'2020-01-01',NULL,?,'w10-race-approver')`)
    .run(priceEntryId, priceListId, materialKey, pricingKey, now);
  db.prepare(`INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by)
    VALUES('w10-race-price-version',?,1,100000,'{}',?,'w10-race-approver')`).run(priceEntryId, now);
  db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,
    payer_customer_id,default_salesperson_id,default_sales_group_id,default_payment_terms_days,
    default_settlement_method,sellable_scope_mode,effective_to,created_at,updated_at,created_by,updated_by,
    default_pricing_list_id,default_discount_scheme_id)
    VALUES('w10-race-customer','2020-01-01','w10-race-customer','w10-race-customer','w10-race-sp-a',
      'w10-race-group',0,'CASH','ALL_SALES_ENABLED',NULL,?,?, 'w10-race-approver','w10-race-approver',?,NULL)`)
    .run(now, now, priceListId);
  // Wave 9 canonical migration already provisions the one global policy
  // anchor (`credit-anchor-policy-global`). The acceptance fixture must
  // consume that authority fact, not insert a competing identity.
  db.prepare(`INSERT INTO credit_parameters(id,code,value_bool,effective_from,status,created_at,created_by)
    VALUES('w10-race-enabled','CREDIT_MANAGEMENT_ENABLED',1,'2026-01-01','ACTIVE',?,'w10-race-approver')`).run(now);
  db.prepare(`INSERT INTO credit_check_rules(id,rule_code,business_stage,scenario,check_timing,control_strength,credit_item,
    recognition_mode,effective_from,status,result_payload_json,created_at,created_by)
    VALUES('w10-race-rule','W10_RACE_RULE',?,?,'BEFORE_WRITE',?,'ORDER_EXPOSURE',NULL,'2026-01-01','ACTIVE','{}',?,'w10-race-approver')`)
    .run(stage, scenario, controlStrength, now);
  seedProfile(db, { id: 'w10-profile-agg', anchorId: 'w10-anchor-agg', salespersonId: null, limit: aggregateLimit, status: aggregateProfileStatus, now });
  if (salespersonLimit != null) seedProfile(db, { id: 'w10-profile-a', anchorId: 'w10-anchor-a', salespersonId: 'w10-race-sp-a', limit: salespersonLimit, status: salespersonProfileStatus, now });
  if (secondSalespersonLimit != null) seedProfile(db, { id: 'w10-profile-b', anchorId: 'w10-anchor-b', salespersonId: 'w10-race-sp-b', limit: secondSalespersonLimit, status: secondSalespersonProfileStatus, now });
  seedWave10Inventory(db);
  seedWave10SettlementAccount(db);
}

// Reference data only. Initial on-hand stock and the cash settlement account
// are master facts that the canonical Delivery and collection writers read;
// they are never evidence that a business transaction happened.
export function seedWave10Inventory(db, {
  warehouseId = 'w10-race-warehouse', productId = 'w10-race-product', quantity = 100,
} = {}) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM inventory WHERE warehouse_id=? AND product_id=?').run(warehouseId, productId);
  db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)')
    .run('w10-race-inventory', warehouseId, productId, quantity, now);
}

export function seedWave10SettlementAccount(db, { id = 'w10-race-cash-account' } = {}) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM bank_accounts WHERE id=?').run(id);
  db.prepare(`INSERT INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at)
    VALUES(?,?,?,?,'CASH',0,'CNY',1,?,?)`).run(id, 'Wave 10 Cash', 'W10-CASH-0001', 'Wave 10 Cash Account', now, now);
}

function seedProfile(db, { id, anchorId, salespersonId, limit, status = 'ACTIVE', now }) {
  const scope = salespersonId || 'AGGREGATE';
  const key = `CREDIT_OBJECT|SALES_ORDER|${W10_OBJECT}|CUSTOMER|w10-race-customer|SCOPE:${scope}`;
  db.prepare(`INSERT INTO credit_lock_anchors(id,anchor_key,anchor_type,customer_id,salesperson_id,credit_object_type,
    credit_object_id,policy_scope_type,policy_scope_id,created_at)
    VALUES(?,?,'CREDIT_OBJECT','w10-race-customer',?,'SALES_ORDER',?,NULL,NULL,?)`).run(anchorId, key, salespersonId, W10_OBJECT, now);
  db.prepare(`INSERT INTO credit_profile(id,anchor_id,customer_id,salesperson_scope_key,salesperson_id,credit_object_type,
    credit_object_id,credit_limit_cents,initial_state,status,rating_grade,overdue_day_policy,rule_id,effective_from,created_at,created_by)
    VALUES(?,?,'w10-race-customer',?,?,'SALES_ORDER',?,?,'NORMAL',?,'A','15','w10-race-rule','2026-01-01',?,'w10-race-approver')`)
    .run(id, anchorId, salespersonId || '*', salespersonId, W10_OBJECT, limit, status, now);
}

export function seedSubmittedOrder(db, { id, salespersonId = 'w10-race-sp-a', cents = 100000, status = 'SUBMITTED' }) {
  const now = new Date().toISOString();
  const reviewerId = status === 'APPROVED' ? 'w10-race-approver' : null;
  const submittedAt = status === 'DRAFT' ? null : now;
  const reviewedAt = status === 'APPROVED' ? now : null;
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,
    reviewer_id,submitted_at,reviewed_at,created_at,updated_at,order_date,requested_delivery_date,payment_terms,
    ship_to_contact_name,ship_to_phone,ship_to_address,payment_terms_days,salesperson_id,sales_group_id,
    settlement_party_id,payer_id,required_prepayment_cents,reservation_intent_state,commercial_close_state,
    gift_summary_cents,effective_version)
    VALUES(?,?,?,?,?,'','', 'w10-race-creator',?,?,?,?,?,?,?,'CASH','','','',0,?,'w10-race-group',
      'w10-race-customer','w10-race-customer',0,'NONE','OPEN',0,1)`)
    .run(id, id.toUpperCase(), 'w10-race-customer', status, cents, reviewerId, submittedAt, reviewedAt,
      now, now, wave10BusinessDate(), wave10BusinessDate(), salespersonId);
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES(?,?,'w10-race-product',1,?,?,1)`).run(`item-${id}`, id, cents, cents);
}

export function creditInput({
  orderId, salespersonId = 'w10-race-sp-a', proposedDeltaCents = 100000,
  stage = 'SO_APPROVE', businessDate = wave10BusinessDate(), recognitionMode = 'DIRECT_BUSINESS_OPEN_ITEM',
} = {}) {
  return {
    customerId: 'w10-race-customer', salespersonId, creditObjectType: 'SALES_ORDER', creditObjectId: W10_OBJECT,
    stage, businessDate, proposedDeltaCents,
    recognitionMode, sourceRef: { sourceType: 'SALES_ORDER', sourceId: orderId },
    actorId: 'w10-race-approver', authorizationContext: `race:${orderId}`,
  };
}

export function productionOrderBody({ salespersonId = 'w10-race-sp-a', cents = 100000, quantityMicros = 1_000_000 } = {}) {
  return {
    customerId: 'w10-race-customer', salespersonId, salesGroupId: 'w10-race-group',
    orderDate: wave10BusinessDate(), requestedDeliveryDate: wave10BusinessDate(), paymentTerms: 'CASH', paymentTermsDays: 0,
    shipToContactName: 'Wave 10', shipToPhone: '10000', shipToAddress: 'Wave 10 test address',
    items: [{ productId: 'w10-race-product', uomCode: 'EA', quantityMicros,
      ...(cents === 100000 ? {} : { manualPriceCents: cents, overrideReason: 'Wave 10 bounded fixture' }) }],
  };
}

export function seedReceivable(db, {
  id, sourceType, sourceId, amountCents, openCents = amountCents,
  itemClass = 'SOURCE', recognitionMode = 'DIRECT_BUSINESS_OPEN_ITEM', itemKind = 'FINAL',
} = {}) {
  const now = `${wave10BusinessDate()}T10:00:00.000Z`;
  db.prepare(`INSERT INTO account_receivables(id,voucher_no,customer_id,source_type,source_id,amount_cents,paid_cents,
      write_off_cents,status,due_date,creator_id,created_at,business_date,updated_at,open_amount_cents,item_class,
      recognition_mode,item_kind,conversion_state)
    VALUES(?,?,'w10-race-customer',?,?,?,0,0,'PENDING','2026-11-30','w10-race-creator',?,?,?,?,?,?,?,'OPEN')`)
    .run(id, id.toUpperCase(), sourceType, sourceId, amountCents, now, wave10BusinessDate(), now, openCents,
      itemClass, recognitionMode, itemKind);
}

export function assertFailureSideEffectsZero(db, before, label) {
  const after = acceptanceFootprint(db);
  assert.deepEqual(after, before, `${label}: failed contender must leave zero side effects`);
}

export function acceptanceFootprint(db) {
  return captureWave10PersistenceProjection(db);
}

const PROJECTION_TABLES = Object.freeze([
  'credit_check_results', 'credit_special_approval', 'credit_policy_snapshots',
  'credit_profile', 'credit_check_rules', 'credit_parameters',
  'sales_prepayment_requirements', 'sales_prepayment_gate_results',
  'sales_orders', 'sales_order_items', 'sales_deliveries', 'sales_delivery_items',
  'sales_invoices', 'account_receivables', 'payment_collections',
  'settlement_unapplied_balances', 'settlement_reversals', 'settlement_reversal_items',
  'credit_reversal_components', 'finance_invoice_source_links',
  'audit_logs', 'idempotency_records',
]);

export const WAVE10_PROJECTION_FAMILIES = Object.freeze({
  'P-CREDIT': Object.freeze(['credit_check_results', 'credit_policy_snapshots', 'credit_profile', 'credit_check_rules', 'credit_parameters']),
  'P-APPROVAL': Object.freeze(['credit_special_approval']),
  'P-GATE': Object.freeze(['sales_prepayment_requirements', 'sales_prepayment_gate_results', 'settlement_unapplied_balances']),
  'P-SALES': Object.freeze(['sales_orders', 'sales_order_items', 'sales_deliveries', 'sales_delivery_items', 'sales_invoices']),
  'P-FINANCE': Object.freeze(['account_receivables', 'payment_collections', 'settlement_unapplied_balances',
    'settlement_reversals', 'settlement_reversal_items', 'credit_reversal_components', 'finance_invoice_source_links']),
  'P-AUDIT-IDEM': Object.freeze(['audit_logs', 'idempotency_records']),
});

export function projectionTablesFor(families) {
  assert.ok(Array.isArray(families) && families.length, 'at least one projection family is required');
  const tables = [];
  const seen = new Set();
  for (const family of families) {
    const declared = WAVE10_PROJECTION_FAMILIES[family];
    assert.ok(declared, `unknown Wave 10 projection family: ${family}`);
    for (const table of declared) if (!seen.has(table)) { seen.add(table); tables.push(table); }
  }
  return Object.freeze(tables);
}

function normalizedValue(value) {
  if (Buffer.isBuffer(value)) return value.toString('hex');
  return value;
}

export function captureWave10PersistenceProjection(db, tables = PROJECTION_TABLES) {
  const projection = {};
  for (const table of tables) {
    assert.match(table, /^[A-Za-z0-9_]+$/);
    let rows;
    try { rows = db.prepare(`SELECT * FROM \`${table}\` ORDER BY id`).all(); }
    catch (error) {
      throw Object.assign(new Error(`WAVE10_PROJECTION_UNAVAILABLE: ${table}: ${error.code || error.message}`), {
        code: 'WAVE10_PROJECTION_UNAVAILABLE', table,
      });
    }
    projection[table] = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizedValue(value)])));
  }
  return Object.freeze(projection);
}

export function captureWave10ProjectionFamilies(db, families) {
  return captureWave10PersistenceProjection(db, projectionTablesFor(families));
}

export function assertWave10ProjectionUnchanged(before, after, label) {
  assert.deepEqual(after, before, `${label}: persistent projection changed`);
}

function componentTotal(components) {
  return Number(components.approvedSoCommitmentCents || 0)
    + Number(components.deliveredNotSettledCents || 0)
    + Number(components.arOpenCents || 0)
    - Number(components.eligiblePrepaymentCents || 0);
}

export function classifyCapacity({ available, deltaA, deltaB }) {
  for (const [name, value] of Object.entries({ available, deltaA, deltaB })) {
    assert.ok(Number.isSafeInteger(value) && value >= 0, `${name} must be non-negative safe cents`);
  }
  if (deltaA <= available && deltaB <= available && deltaA + deltaB <= available) return 'BOTH_FIT';
  if (deltaA <= available && deltaB <= available && deltaA + deltaB > available) return 'ONLY_ONE_FITS';
  if (deltaA > available && deltaB > available) return 'NEITHER_FITS';
  return 'ASYMMETRIC';
}

// §37.39.6.3 B / W10-AIR-R05 — the capacity precondition is read from the
// canonical production sources: the Wave 9 effective-date resolver for the
// Profile and its real limit, and the production exposure projection for the
// canonical current exposure `E`. A seed constant is never a substitute.
export function readAuthoritativeCapacity(db, {
  salespersonId = null, businessDate = wave10BusinessDate(), deltaA, deltaB,
} = {}) {
  const profile = resolveEffectiveCreditProfile(db, {
    customerId: 'w10-race-customer', salespersonId,
    creditObjectType: 'SALES_ORDER', creditObjectId: W10_OBJECT, businessDate,
  });
  assert.ok(profile, `authoritative Profile missing for ${salespersonId || 'aggregate'}`);
  assert.equal(profile.status, 'ACTIVE', 'the effective Profile must be ACTIVE');
  assert.ok(profile.credit_limit_cents != null, 'bounded capacity requires a non-null limit');
  const prepayments = Number(db.prepare(`SELECT COUNT(*) count FROM settlement_unapplied_balances
    WHERE party_id='w10-race-customer' AND side='CUSTOMER' AND balance_type='PREPAYMENT' AND status='OPEN'`).get().count);
  assert.equal(prepayments, 0, 'capacity classification requires zero eligible prepayment in this fixture');
  const exposure = computeCreditExposure(db, { customerId: 'w10-race-customer', salespersonId, businessDate });
  const components = salespersonId ? exposure.salespersonComponents : exposure.aggregateComponents;
  const exposureCents = componentTotal(components);
  const limitCents = Number(profile.credit_limit_cents);
  const available = limitCents - exposureCents;
  const classification = classifyCapacity({ available, deltaA, deltaB });
  return Object.freeze({
    profileId: profile.id, salespersonId, businessDate, limitCents, exposureCents, available,
    deltaA, deltaB, classification, components: Object.freeze({ ...components }),
  });
}

// §37.39.10 — a rejection PASS requires an empty forbidden delta across the
// complete declared union, not merely an unchanged row count. The delta is
// computed row by row so an in-place mutation is as visible as an insert.
export function wave10ProjectionDelta(before, after) {
  const delta = {};
  for (const table of Object.keys(after)) {
    const beforeRows = new Map((before[table] || []).map((row) => [String(row.id), row]));
    const afterRows = new Map((after[table] || []).map((row) => [String(row.id), row]));
    const changed = [];
    for (const [id, row] of afterRows) {
      const previous = beforeRows.get(id);
      if (!previous) { changed.push({ id, kind: 'INSERTED', after: row }); continue; }
      const fields = Object.keys(row).filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(row[key]));
      if (fields.length) changed.push({ id, kind: 'UPDATED', fields: fields.sort(), before: previous, after: row });
    }
    for (const [id, row] of beforeRows) {
      if (!afterRows.has(id)) changed.push({ id, kind: 'DELETED', before: row });
    }
    if (changed.length) delta[table] = changed.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return delta;
}

export function assertWave10ProjectionDeltaEmpty(before, after, label) {
  const delta = wave10ProjectionDelta(before, after);
  assert.deepEqual(Object.keys(delta), [], `${label}: forbidden persistent delta ${JSON.stringify(Object.keys(delta))}`);
  return delta;
}

export function assertWave10ProjectionDelta(before, after, expectedTables, label) {
  const delta = wave10ProjectionDelta(before, after);
  assert.deepEqual(Object.keys(delta).sort(), [...expectedTables].sort(), `${label}: persistent delta tables`);
  return delta;
}

// §37.39.6.3 E — the authoritative Sales commitment facts of one order.
export function wave10SalesCommitment(db, orderId) {
  const order = db.prepare(`SELECT id,status,total_cents,salesperson_id,reviewer_id,reviewed_at,
      commercial_close_state,effective_version,required_prepayment_cents,reservation_intent_state
    FROM sales_orders WHERE id=?`).get(orderId);
  assert.ok(order, `sales order ${orderId} is missing`);
  return Object.freeze({
    id: order.id,
    status: order.status,
    totalCents: Number(order.total_cents),
    salespersonId: order.salesperson_id,
    reviewerId: order.reviewer_id ?? null,
    reviewedAt: order.reviewed_at ?? null,
    commercialCloseState: order.commercial_close_state,
    effectiveVersion: Number(order.effective_version),
    items: db.prepare('SELECT id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no FROM sales_order_items WHERE order_id=? ORDER BY line_no,id').all(orderId)
      .map((row) => ({ ...row, quantity: Number(row.quantity), unitPriceCents: Number(row.unit_price_cents), amountCents: Number(row.amount_cents) })),
  });
}

export { PROJECTION_TABLES };
