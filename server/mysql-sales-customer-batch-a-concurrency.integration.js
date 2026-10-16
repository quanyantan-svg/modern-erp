import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { createSalesOrderCanonical, PRICE_OVERRIDE_CONSUMPTION } from './modules/sales-orders.js';
import { createSalesQuotation, salesQuotationAction } from './modules/sales-quotations.js';
import { createDirectSalesOrderChange } from './modules/sales-order-changes.js';
import { createDeliveryNotice, deliveryNoticeAction } from './modules/delivery-notices.js';
import { transaction } from './db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-batch-a-worker.mjs');
const REVIEWER = '00000000-0000-4000-8000-000000000001';
const CREATOR = '00000000-0000-4000-8000-000000000002';
const CUSTOMER = '00000000-0000-4000-8000-000000000003';
const PRODUCT = '00000000-0000-4000-8000-000000000004';
const WAREHOUSE = '00000000-0000-4000-8000-000000000005';
const GROUP = '00000000-0000-4000-8000-000000000006';
const SALESPERSON = '00000000-0000-4000-8000-000000000007';
const PRICE_LIST = '00000000-0000-4000-8000-000000000008';
const PRICE_ENTRY = '00000000-0000-4000-8000-000000000009';
const PRICE_VERSION = '00000000-0000-4000-8000-000000000010';
const ACTOR = { id: CREATOR, roleCode: 'ADMIN', permissions: ['ORDERS_CREATE', 'SALES_QUOTATION_MANAGE', 'SALES_MANAGE', 'SALES_ORDER_CHANGE_DIRECT_REQUEST'] };

class Worker {
  constructor(name) {
    this.name = name; this.pending = new Map(); this.stderr = '';
    this.child = spawn(process.execPath, [workerPath], { cwd: repoRoot, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id); if (!pending) return;
      this.pending.delete(reply.id); clearTimeout(pending.timer);
      if (reply.ok) pending.resolve(reply.result); else pending.reject(Object.assign(new Error(reply.error.message), reply.error));
    });
    this.child.on('exit', (code) => {
      for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(new Error(`${name} exited ${code}: ${this.stderr}`)); }
      this.pending.clear();
    });
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name} RPC timeout: ${JSON.stringify(command)}`)); }, 20_000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { try { await this.run({ action: 'close' }); } catch {} try { this.child.stdin.end(); } catch {} }
}

function request(body, key) {
  return { headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body ?? {})); } };
}
function response() {
  return { statusCode: 0, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value ? JSON.parse(value) : null; } };
}
async function call(fn) { const res = response(); await fn(res); return { status: res.statusCode, body: res.body }; }
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function processRow(db, connectionId) {
  try { return db.prepare('SELECT ID,STATE,INFO FROM information_schema.PROCESSLIST WHERE ID=?').get(connectionId); } catch { return null; }
}
function waitAtGate(db, connectionIds) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const rows = connectionIds.map((id) => processRow(db, id));
    if (rows.every((row) => String(row?.INFO || '').toUpperCase().includes('MYSQL_TRANSACTION_GATES'))) return rows;
    pause(25);
  }
  return null;
}

describe('Sales & Customer Batch A real MySQL independent-session races', () => {
  let handle; let db; let alpha; let beta; let control; let registrations;
  before(async () => {
    handle = createTempDb({ label: 'sales-batch-a-concurrency', production: true }); db = handle.db;
    assert.equal(db.dialect, 'mysql'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES('batch-a-role','BATCH_A','Batch A','',0,?)").run(stamp);
    for (const [userId, username] of [[REVIEWER, 'batch-a-reviewer'], [CREATOR, 'batch-a-creator']]) {
      db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at,name)
        VALUES(?,?,?,'','','batch-a-role',1,?,?)`).run(userId, username, username, stamp, username);
    }
    db.prepare('INSERT INTO customers(id,code,name,contact,phone,address,payment_terms_days,active,created_at,updated_at) VALUES(?,?,?,?,?,?,30,1,?,?)')
      .run(CUSTOMER, 'BA-C', 'Batch A Customer', 'Receiver', '13000000000', 'Test Address', stamp, stamp);
    db.prepare('INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(WAREHOUSE, 'BA-W', 'Batch A Warehouse', stamp, stamp);
    db.prepare('INSERT IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run('EA', 'Each', stamp, stamp);
    db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code)
      VALUES(?,?,?,'EA',0,0,1,?,?,'EA')`).run(PRODUCT, 'BA-P', 'Batch A Product', stamp, stamp);
    db.prepare("UPDATE products SET valuation_method='MOVING_AVERAGE',inventory_classification='FINISHED_GOODS',valuation_activated_at='2026-01-01' WHERE id=?").run(PRODUCT);
    db.prepare('INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?)')
      .run(randomUUID(), WAREHOUSE, PRODUCT, 100, stamp);
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES(?, 'MOVING_AVERAGE', ?, ?, NULL, NULL, 100, 50000, ?)`).run(`NONE:${WAREHOUSE}:${PRODUCT}`, PRODUCT, WAREHOUSE, stamp);
    db.prepare('INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(GROUP, 'BA-G', 'Batch A Group', stamp, stamp);
    db.prepare('INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)')
      .run(SALESPERSON, 'BA-SP', 'Batch A Salesperson', CREATOR, stamp, stamp);
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,'2026-01-01',1,1,?,?,?,?)`).run(randomUUID(), SALESPERSON, GROUP, stamp, stamp, REVIEWER, REVIEWER);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
      default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
      VALUES(?,?,1,'EA','EA',0,0,0,1,?,?)`).run(randomUUID(), PRODUCT, stamp, stamp);
    db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,active,created_at,updated_at,created_by,updated_by)
      VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','DISABLED',1,?,?,?,?)`).run(stamp, stamp, REVIEWER, REVIEWER);
    db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
      VALUES(?,'BA-PL','Batch A Price','CNY',0,'2026-01-01','ACTIVE',?,?,?,?,?,?)`)
      .run(PRICE_LIST, stamp, REVIEWER, stamp, REVIEWER, stamp, REVIEWER);
    const materialKey = `M:${Buffer.from(PRODUCT).toString('hex').toUpperCase()}`;
    db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
      pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
      VALUES(?,?,?,NULL,'ALL',?,'A','EA','U:4541|Q:0000000000000000|D:20260101',0,'2026-01-01',?,?)`)
      .run(PRICE_ENTRY, PRICE_LIST, PRODUCT, materialKey, stamp, REVIEWER);
    db.prepare('INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES(?,?,1,1000,?,?,?)')
      .run(PRICE_VERSION, PRICE_ENTRY, '{}', stamp, REVIEWER);
    db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
      default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,created_by,updated_by,default_pricing_list_id)
      VALUES(?,'2026-01-01',?,?,?,?,30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`)
      .run(CUSTOMER, CUSTOMER, CUSTOMER, SALESPERSON, GROUP, stamp, stamp, REVIEWER, REVIEWER, PRICE_LIST);
    alpha = new Worker('alpha'); beta = new Worker('beta'); control = new Worker('control');
    registrations = await Promise.all([alpha.run({ action: 'register' }), beta.run({ action: 'register' }), control.run({ action: 'register' })]);
    assert.equal(new Set(registrations.map((item) => item.connectionId)).size, 3);
    assert.equal(new Set(registrations.map((item) => item.processId)).size, 3);
    console.log(`MULTI_SESSION_CONSISTENCY_VERIFIED connections=${registrations.map((item) => item.connectionId).join(',')}`);
  });
  after(async () => { await alpha?.close(); await beta?.close(); await control?.close(); handle?.cleanup(); });

  async function race(left, right) {
    await control.run({ action: 'hold-gate' });
    const first = alpha.run(left); const second = beta.run(right);
    const observed = waitAtGate(db, [registrations[0].connectionId, registrations[1].connectionId]);
    await control.run({ action: 'release-gate' });
    const results = await Promise.all([first, second]);
    assert.ok(observed, `both workers must wait on mysql_transaction_gates: ${JSON.stringify(registrations)}`);
    console.log(`LOCK_WAIT_OBSERVED connections=${registrations[0].connectionId},${registrations[1].connectionId}`);
    return results;
  }
  function makeOrder(quantityMicros = 1_000_000) {
    const value = transaction(db, () => createSalesOrderCanonical(db, { body: { customerId: CUSTOMER, orderDate: '2026-10-15',
      requestedDeliveryDate: '2026-10-20', paymentTerms: 'MONTHLY', items: [{ productId: PRODUCT, uomCode: 'EA', quantityMicros }] }, actor: ACTOR }));
    db.prepare("UPDATE sales_orders SET status='APPROVED' WHERE id=?").run(value.id);
    return { orderId: value.id, itemId: value.itemIds[0] };
  }
  async function makeChange(orderId, itemId, quantityMicros, key) {
    const result = await call((res) => createDirectSalesOrderChange(db, request({ reasonCode: 'CUSTOMER_REQUEST', reason: 'race',
      lines: [{ op: 'MODIFY', salesOrderItemId: itemId, quantityMicros }] }, key), res, ACTOR, orderId));
    assert.equal(result.status, 201, JSON.stringify(result)); return result.body.id;
  }
  async function makeNotice(orderId, itemId, quantityMicros) {
    const result = await call((res) => createDeliveryNotice(db, request({ salesOrderId: orderId, warehouseId: WAREHOUSE,
      businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20', lines: [{ salesOrderItemId: itemId, scheduledQtyMicros: quantityMicros }] }), res, ACTOR));
    assert.equal(result.status, 201, JSON.stringify(result)); return { noticeId: result.body.notice.id, lineId: result.body.notice.lines[0].id };
  }
  function makeDelivery(orderId, itemId, quantityMicros, notice = null) {
    const deliveryId = randomUUID(); const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,
      remark,creator_id,created_at,updated_at,billing_mode,delivery_notice_id,source_mode) VALUES(?,?,?,?,?,?,'DRAFT',?,'2026-10-15','',?,?,?,'SEPARATE',?,?)`)
      .run(deliveryId, `SD-${randomUUID()}`, orderId, CUSTOMER, WAREHOUSE, CREATOR, Math.round(quantityMicros / 1000), CREATOR, stamp, stamp,
        notice?.noticeId || null, notice ? 'DELIVERY_NOTICE' : 'DIRECT_ORDER');
    const deliveryItemId = randomUUID();
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id,delivery_notice_line_id)
      VALUES(?,?,?, ?,1000,?,1,?,?)`).run(deliveryItemId, deliveryId, PRODUCT, quantityMicros / 1_000_000, Math.round(quantityMicros / 1000), itemId, notice?.lineId || null);
    db.prepare(`INSERT INTO logistics_quality_policy_snapshots(id,source_type,source_id,source_item_id,product_id,qcp_id,qcp_version,
      inspection_required,sampling_mode,sampling_value,waiver_reason,resolved_at) VALUES(?,'SALES_DELIVERY',?,?,?,NULL,NULL,0,'FULL',NULL,'CONCURRENCY_FIXTURE',?)`)
      .run(randomUUID(), deliveryId, deliveryItemId, PRODUCT, stamp);
    return deliveryId;
  }

  function deliveryEconomicFacts(deliveryIds) {
    const marks = deliveryIds.map(() => '?').join(',');
    return {
      confirmed: Number(db.prepare(`SELECT COUNT(*) n FROM sales_deliveries WHERE id IN (${marks}) AND status='CONFIRMED'`).get(...deliveryIds).n),
      inventoryTransactions: Number(db.prepare(`SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY' AND source_id IN (${marks})`).get(...deliveryIds).n),
      valuationMovements: Number(db.prepare(`SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_type='SALES_DELIVERY' AND source_id IN (${marks}) AND movement_type='SALES_DELIVERY_COGS'`).get(...deliveryIds).n),
      cogsVouchers: Number(db.prepare(`SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS' AND source_id IN (${marks})`).get(...deliveryIds).n),
      confirmAudits: Number(db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_DELIVERY' AND action='CONFIRM' AND entity_id IN (${marks})`).get(...deliveryIds).n),
    };
  }

  test('R7 native MySQL JSON applied-line guard is structural, owner-aware and NULL-safe', () => {
    const order = makeOrder();
    const owner = `SALES_ORDER_CHANGE:${randomUUID()}`;
    const appliedAuthorization = randomUUID();
    PRICE_OVERRIDE_CONSUMPTION.record(db, appliedAuthorization, ACTOR, { source: owner });
    db.prepare(`UPDATE sales_order_items SET price_snapshot_json=JSON_OBJECT(
      'zLast','formatted-by-mysql',
      'authorizationEvidence',JSON_OBJECT('fingerprint','native-json','authorizationId',?),
      'aFirst','field-order-independent') WHERE id=?`).run(appliedAuthorization, order.itemId);
    let appliedError = null;
    try { PRICE_OVERRIDE_CONSUMPTION.release(db, appliedAuthorization, ACTOR, { expectedOwner: owner }); }
    catch (error) { appliedError = error; }
    assert.equal(appliedError?.code, 'PRICE_OVERRIDE_AUTHORIZATION_APPLIED_LINE_EXISTS');
    assert.ok(db.prepare("SELECT id FROM idempotency_records WHERE operation_type=? AND document_id=? AND idempotency_key=?")
      .get(PRICE_OVERRIDE_CONSUMPTION.OPERATION, appliedAuthorization, PRICE_OVERRIDE_CONSUMPTION.KEY));

    const unrelatedAuthorization = randomUUID();
    PRICE_OVERRIDE_CONSUMPTION.record(db, unrelatedAuthorization, ACTOR, { source: owner });
    db.prepare(`UPDATE sales_order_items SET price_snapshot_json=JSON_OBJECT(
      'note',?,
      'authorizationEvidence',JSON_OBJECT('authorizationId',?)) WHERE id=?`)
      .run(unrelatedAuthorization, appliedAuthorization, order.itemId);
    assert.equal(PRICE_OVERRIDE_CONSUMPTION.release(db, unrelatedAuthorization, ACTOR, { expectedOwner: owner }), true,
      'same text in an unrelated JSON field must not count as an applied authorization');

    const nullSnapshotAuthorization = randomUUID();
    PRICE_OVERRIDE_CONSUMPTION.record(db, nullSnapshotAuthorization, ACTOR, { source: owner });
    db.prepare('UPDATE sales_order_items SET price_snapshot_json=NULL WHERE id=?').run(order.itemId);
    assert.equal(PRICE_OVERRIDE_CONSUMPTION.release(db, nullSnapshotAuthorization, ACTOR, { expectedOwner: owner }), true,
      'historical NULL snapshots must not fabricate applied authorization evidence');
  });

  test('R-SAL-06 quotation conversion serializes source capacity and rolls back the loser', async () => {
    const created = await call((res) => createSalesQuotation(db, request({ customerId: CUSTOMER, validFrom: '2026-10-15', validTo: '2026-12-31',
      items: [{ productId: PRODUCT, uomCode: 'EA', quantityMicros: 1_000_000 }] }), res, ACTOR));
    const quotationId = created.body.quotation.id; const lineId = created.body.quotation.lines[0].id;
    await call((res) => salesQuotationAction(db, request({}), res, ACTOR, quotationId, 'effective-publish'));
    const auditBefore = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_QUOTATION' AND action='CONVERT_TO_SO'").get().n);
    const results = await race(
      { action: 'convert-quotation', quotationId, key: `q-a-${randomUUID()}`, body: { businessDate: '2026-10-15', lineSelections: [{ quotationLineId: lineId, quantityMicros: 700_000 }] } },
      { action: 'convert-quotation', quotationId, key: `q-b-${randomUUID()}`, body: { businessDate: '2026-10-15', lineSelections: [{ quotationLineId: lineId, quantityMicros: 700_000 }] } },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [201, 409]);
    assert.equal(Number(db.prepare('SELECT converted_qty_micros n FROM sales_quotation_lines WHERE id=?').get(lineId).n), 700_000);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM sales_quotation_conversions WHERE quotation_line_id=?').get(lineId).n), 1);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_QUOTATION' AND action='CONVERT_TO_SO'").get().n), auditBefore + 1);
  });

  test('R-SAL-07 competing change applications keep one effective version and one audit', async () => {
    const order = makeOrder(2_000_000); const a = await makeChange(order.orderId, order.itemId, 1_000_000, `change-a-${randomUUID()}`);
    const b = await makeChange(order.orderId, order.itemId, 1_500_000, `change-b-${randomUUID()}`);
    const results = await race(
      { action: 'apply-change', changeId: a, expectedBaseVersion: 1, key: `apply-a-${randomUUID()}` },
      { action: 'apply-change', changeId: b, expectedBaseVersion: 1, key: `apply-b-${randomUUID()}` },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409], JSON.stringify(results));
    assert.equal(Number(db.prepare('SELECT effective_version n FROM sales_orders WHERE id=?').get(order.orderId).n), 2);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM sales_order_changes WHERE sales_order_id=? AND state='APPLIED'").get(order.orderId).n), 1);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER_CHANGE' AND action='APPROVE_AND_APPLY' AND entity_id IN (?,?)").get(a, b).n), 1);
  });

  test('R-SAL-01 competing full direct confirms consume order, stock, value and COGS exactly once', async () => {
    const order = makeOrder(10_000_000);
    const a = makeDelivery(order.orderId, order.itemId, 7_000_000);
    const b = makeDelivery(order.orderId, order.itemId, 7_000_000);
    const results = await race(
      { action: 'confirm-delivery', deliveryId: a, key: `direct-a-${randomUUID()}` },
      { action: 'confirm-delivery', deliveryId: b, key: `direct-b-${randomUUID()}` },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409], JSON.stringify(results));
    assert.deepEqual(deliveryEconomicFacts([a, b]), { confirmed: 1, inventoryTransactions: 1, valuationMovements: 1, cogsVouchers: 1, confirmAudits: 1 });
  });

  test('R-SAL-08 change versus full direct delivery confirm has one valid version and economic serialization', async () => {
    const order = makeOrder(20_000_000); const changeId = await makeChange(order.orderId, order.itemId, 10_000_000, `change-${randomUUID()}`);
    const deliveryId = makeDelivery(order.orderId, order.itemId, 15_000_000);
    const results = await race(
      { action: 'apply-change', changeId, expectedBaseVersion: 1, key: `apply-${randomUUID()}` },
      { action: 'confirm-delivery', deliveryId, key: `confirm-${randomUUID()}` },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
    const line = db.prepare('SELECT quantity FROM sales_order_items WHERE id=?').get(order.itemId);
    const delivery = db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(deliveryId);
    assert.ok((Number(line.quantity) === 10 && delivery.status === 'DRAFT') || (Number(line.quantity) === 20 && delivery.status === 'CONFIRMED'));
    const economic = deliveryEconomicFacts([deliveryId]);
    assert.equal(economic.confirmed, delivery.status === 'CONFIRMED' ? 1 : 0);
    assert.equal(economic.inventoryTransactions, economic.confirmed);
    assert.equal(economic.valuationMovements, economic.confirmed);
    assert.equal(economic.cogsVouchers, economic.confirmed);
    assert.equal(economic.confirmAudits, economic.confirmed);
  });

  test('R-SAL-16 two DN confirmations cannot over-schedule one SO line', async () => {
    const order = makeOrder(); const a = await makeNotice(order.orderId, order.itemId, 700_000); const b = await makeNotice(order.orderId, order.itemId, 700_000);
    const results = await race(
      { action: 'confirm-notice', noticeId: a.noticeId, key: `dn-a-${randomUUID()}` },
      { action: 'confirm-notice', noticeId: b.noticeId, key: `dn-b-${randomUUID()}` },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
    assert.equal(Number(db.prepare("SELECT COALESCE(SUM(l.scheduled_qty_micros),0) n FROM delivery_notice_lines l JOIN delivery_notices d ON d.id=l.delivery_notice_id WHERE l.sales_order_item_id=? AND d.state='CONFIRMED'").get(order.itemId).n), 700_000);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='DELIVERY_NOTICE' AND action='CONFIRM' AND entity_id IN (?,?)").get(a.noticeId, b.noticeId).n), 1);
  });

  test('R-SAL-17 two full SD confirms cannot exceed one DN remaining or duplicate economic effects', async () => {
    const order = makeOrder(20_000_000); const notice = await makeNotice(order.orderId, order.itemId, 10_000_000);
    await call((res) => deliveryNoticeAction(db, request({}, `dn-seed-${randomUUID()}`), res, ACTOR, notice.noticeId, 'confirm'));
    const a = makeDelivery(order.orderId, order.itemId, 7_000_000, notice); const b = makeDelivery(order.orderId, order.itemId, 7_000_000, notice);
    const results = await race(
      { action: 'confirm-delivery', deliveryId: a, key: `confirm-a-${randomUUID()}` },
      { action: 'confirm-delivery', deliveryId: b, key: `confirm-b-${randomUUID()}` },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409], JSON.stringify(results));
    assert.equal(Number(db.prepare('SELECT notified_qty_micros n FROM delivery_notice_lines WHERE id=?').get(notice.lineId).n), 7_000_000);
    assert.deepEqual(deliveryEconomicFacts([a, b]), { confirmed: 1, inventoryTransactions: 1, valuationMovements: 1, cogsVouchers: 1, confirmAudits: 1 });
  });

  test('R-SAL-18 SO Change versus DN confirmation preserves executed floor/capacity', async () => {
    const order = makeOrder(); const changeId = await makeChange(order.orderId, order.itemId, 500_000, `change-${randomUUID()}`);
    const notice = await makeNotice(order.orderId, order.itemId, 800_000);
    const results = await race(
      { action: 'apply-change', changeId, expectedBaseVersion: 1, key: `apply-${randomUUID()}` },
      { action: 'confirm-notice', noticeId: notice.noticeId, key: `dn-${randomUUID()}` },
    );
    assert.deepEqual(results.map((item) => item.status).sort(), [200, 409]);
    const quantity = Number(db.prepare('SELECT quantity n FROM sales_order_items WHERE id=?').get(order.itemId).n);
    const state = db.prepare('SELECT state FROM delivery_notices WHERE id=?').get(notice.noticeId).state;
    assert.ok((quantity === 0.5 && state === 'DRAFT') || (quantity === 1 && state === 'CONFIRMED'));
  });

  test('R-SAL-19 close versus full SD confirmation never confirms after commercial close', async () => {
    const order = makeOrder(); const deliveryId = makeDelivery(order.orderId, order.itemId, 1_000_000);
    const results = await race(
      { action: 'close-order', orderId: order.orderId, key: `close-${randomUUID()}` },
      { action: 'confirm-delivery', deliveryId, key: `confirm-${randomUUID()}` },
    );
    assert.ok(results.every((item) => [200, 409].includes(item.status)), JSON.stringify(results));
    const closeState = db.prepare('SELECT commercial_close_state state FROM sales_orders WHERE id=?').get(order.orderId).state;
    const deliveryState = db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(deliveryId).status;
    assert.equal(deliveryState, 'CONFIRMED', 'close cannot win before the lower tolerance is reached');
    assert.ok(['OPEN', 'CLOSED'].includes(closeState));
    const economic = deliveryEconomicFacts([deliveryId]);
    assert.deepEqual(economic, deliveryState === 'CONFIRMED'
      ? { confirmed: 1, inventoryTransactions: 1, valuationMovements: 1, cogsVouchers: 1, confirmAudits: 1 }
      : { confirmed: 0, inventoryTransactions: 0, valuationMovements: 0, cogsVouchers: 0, confirmAudits: 0 });
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='SALES_ORDER' AND action='CLOSE' AND entity_id=?").get(order.orderId).n), closeState === 'CLOSED' ? 1 : 0);
  });
});
