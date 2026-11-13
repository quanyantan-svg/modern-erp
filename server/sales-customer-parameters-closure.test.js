// Sales & Customer — CAP-1 closure: SC01 parameter enforcement (SC-DEF-01).
//
// Contract:
//   document.md §34.3.1 (SC01 Sales Parameters — 可售控制 / 客户物料对应启用 /
//   交货计划·数量控制 / 预留行为 control semantics)
//   solution.md  §29.4.5 (A-65 sales_parameters SYSTEM / DOCUMENT_TYPE
//   resolution), §29.8.3 (delivery schedule / quantity control execution)
//   Audit ledger: docs/audits/sales-customer-capability-audit-20261113.md
//   defect SC-DEF-01 — the three control switches were persisted and resolved
//   but had NO production consumer.
//
// What this suite proves:
//   1. `deliveryScheduleEnabled = false` refuses the Delivery Notice path with
//      the explicit code SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED, and the
//      refusal leaves zero business side effect.
//   2. `deliveryQuantityControlEnabled = false` accepts a Delivery Notice
//      that exceeds the order line tolerance; with the control enabled the
//      same notice is refused with DELIVERY_NOTICE_TOLERANCE_EXCEEDED /
//      DELIVERY_NOTICE_CAPACITY_EXCEEDED.
//   3. `reservationBehavior = DISABLED` refuses a reservation intent request
//      with the explicit code SALES_RESERVATION_BEHAVIOR_DISABLED.
//   4. The DEFAULT parameter state keeps today's behaviour — the existing
//      suites must stay green unchanged.
//
// It is deliberately NOT registered in FAST: every case owns one disposable
// temp SQLite and drives the real HTTP surface, which is outside the FAST
// criterion of a bounded, database-free regression.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let db; let server; let baseUrl; let tempDir; const tokens = {};
let orderId; let orderItemId; let warehouseId; let uom;

async function request(path, { token = tokens.admin, method = 'GET', body, key } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(username, password) {
  const response = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.token;
}

function codeOf(payload) {
  return payload?.details?.code || payload?.code || null;
}

// Rewrite the SYSTEM parameter row's three control switches in place. The
// other columns keep their current values so the change is bounded to the
// switch under test.
function setSystemSwitches({ deliveryScheduleEnabled, deliveryQuantityControlEnabled, reservationBehavior }) {
  const current = db.prepare("SELECT * FROM sales_parameters WHERE scope_key='SYSTEM'").get();
  assert.ok(current, 'the SYSTEM parameter row must exist for this suite');
  db.prepare(`UPDATE sales_parameters SET delivery_schedule_enabled=?,delivery_quantity_control_enabled=?,
    reservation_behavior=?,updated_at=? WHERE scope_key='SYSTEM'`).run(
    deliveryScheduleEnabled === undefined ? current.delivery_schedule_enabled : (deliveryScheduleEnabled ? 1 : 0),
    deliveryQuantityControlEnabled === undefined ? current.delivery_quantity_control_enabled : (deliveryQuantityControlEnabled ? 1 : 0),
    reservationBehavior === undefined ? current.reservation_behavior : reservationBehavior,
    new Date().toISOString(),
  );
}

function noticeCount() {
  return Number(db.prepare('SELECT COUNT(*) n FROM delivery_notices').get().n);
}

function intentCount() {
  return Number(db.prepare('SELECT COUNT(*) n FROM sales_reservation_intent').get().n);
}

// Create one sales order and drive it to APPROVED so the Delivery Notice
// path is reachable (a Delivery Notice requires an APPROVED, OPEN order).
let orderSequence = 0;
async function createApprovedOrder({ quantity = '10', keyPrefix = 'cap1-order' } = {}) {
  orderSequence += 1;
  const created = await request('/api/sales-orders', {
    token: tokens.sales, method: 'POST', key: `${keyPrefix}-${orderSequence}`,
    body: {
      customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
      items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: quantity }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const submitted = await request(`/api/sales-orders/${created.data.id}/submit`, {
    token: tokens.sales, method: 'POST', key: `${keyPrefix}-${orderSequence}-submit`, body: {},
  });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
  const approved = await request(`/api/sales-orders/${created.data.id}/approve`, {
    token: tokens.reviewer, method: 'POST', key: `${keyPrefix}-${orderSequence}-approve`, body: {},
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const itemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(created.data.id).id;
  return { orderId: created.data.id, itemId };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'sales-cap1-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  const stamp = new Date().toISOString();
  uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
  db.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(uom, uom, stamp, stamp);

  // The SYSTEM parameter row starts in the DEFAULT state that mirrors
  // today's production behaviour: the delivery schedule and quantity
  // controls are ON and the reservation behaviour is DISABLED (no
  // reservation is requested by default).
  db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
    sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
    active,created_at,updated_at,created_by,updated_by) VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','DISABLED',1,?,?,?,?)`)
    .run(stamp, stamp, 'user-admin', 'user-admin');
  db.prepare("INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('cap1-group','CAP1','CAP1 Group',1,?,?)").run(stamp, stamp);
  db.prepare("INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at) VALUES('cap1-salesperson','CAP1-SP','CAP1 Sales','user-sales',1,?,?)").run(stamp, stamp);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,effective_from,is_default,active,created_at,updated_at,created_by,updated_by)
    VALUES('cap1-membership','cap1-salesperson','cap1-group','2026-01-01',1,1,?,?,?,?)`).run(stamp, stamp, 'user-admin', 'user-admin');
  db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
    default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
    VALUES('cap1-class','product-001',1,?,?,0,0,0,1,?,?)`).run(uom, uom, stamp, stamp);

  // A price list so the order line resolves an authoritative price.
  const priceListId = '22222222-2222-4222-8222-222222222222';
  db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
    VALUES(?,'CAP1-PL','CAP1 price','CNY',0,'2026-01-01','ACTIVE',?,'user-reviewer',?,'user-sales',?,'user-sales')`).run(priceListId, stamp, stamp, stamp);
  const materialKey = `M:${Buffer.from('product-001').toString('hex').toUpperCase()}`;
  const pricingKey = `U:${Buffer.from(uom).toString('hex').toUpperCase()}|Q:0000000000000000|D:20260101`;
  db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
    pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
    VALUES('cap1-entry',?,'product-001',NULL,'ALL',?,'A',?,?,0,'2026-01-01',?,'user-sales')`).run(priceListId, materialKey, uom, pricingKey, stamp);
  db.prepare("INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by) VALUES('cap1-version','cap1-entry',1,1250,'{}',?,'user-sales')").run(stamp);
  db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
    default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,
    created_by,updated_by,default_pricing_list_id) VALUES('customer-001','2026-01-01','customer-001','customer-001','cap1-salesperson','cap1-group',30,'MONTHLY','ALL_SALES_ENABLED',?,?,?,?,?)`)
    .run(stamp, stamp, 'user-admin', 'user-admin', priceListId);

  server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  tokens.admin = await login('admin', 'admin123');
  tokens.sales = await login('sales', 'sales123');
  tokens.reviewer = await login('reviewer', 'review123');
});

after(async () => {
  if (server) await new Promise((done) => server.close(done));
  db?.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('CAP-1 SC-DEF-01 — SC01 control switches have production consumers', () => {
  test('the default parameter state keeps the pre-existing delivery behaviour', async () => {
    // DEFAULT: delivery schedule ON, quantity control ON. The Delivery
    // Notice path therefore behaves exactly as before this work package.
    const parameters = await request('/api/sales/parameters');
    assert.equal(parameters.status, 200, JSON.stringify(parameters.data));
    const system = parameters.data.parameters.find((row) => row.scopeKey === 'SYSTEM');
    assert.ok(system, 'the SYSTEM parameter row must be readable');
    assert.equal(system.deliveryScheduleEnabled, true);
    assert.equal(system.deliveryQuantityControlEnabled, true);

    const created = await request('/api/sales-orders', {
      token: tokens.sales, method: 'POST', key: 'cap1-default-order',
      body: {
        customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
        items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '10' }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    orderId = created.data.id;
    orderItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(orderId).id;
    warehouseId = db.prepare("SELECT id FROM warehouses WHERE id='warehouse-001'").get()?.id
      || db.prepare('SELECT id FROM warehouses WHERE active=1 LIMIT 1').get().id;
    const submitted = await request(`/api/sales-orders/${orderId}/submit`, {
      token: tokens.sales, method: 'POST', key: 'cap1-default-submit', body: {},
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    const approved = await request(`/api/sales-orders/${orderId}/approve`, {
      token: tokens.reviewer, method: 'POST', key: 'cap1-default-approve', body: {},
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));

    // With the quantity control ON (the default) a notice that exceeds the
    // order line upper bound is refused — today's behaviour, unchanged.
    const overTolerance = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 11_000_000 }],
      },
    });
    assert.equal(overTolerance.status, 409, JSON.stringify(overTolerance.data));
    assert.equal(codeOf(overTolerance.data), 'DELIVERY_NOTICE_TOLERANCE_EXCEEDED');

    // A notice inside the tolerance is accepted — the unchanged happy path.
    const withinTolerance = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 10_000_000 }],
      },
    });
    assert.equal(withinTolerance.status, 201, JSON.stringify(withinTolerance.data));
    assert.equal((await request(`/api/delivery-notices/${withinTolerance.data.notice.id}/confirm`, {
      token: tokens.sales, method: 'POST', key: 'cap1-default-confirm', body: {},
    })).status, 200);
  });

  test('deliveryScheduleEnabled=false refuses the Delivery Notice path with an explicit code and zero side effect', async () => {
    setSystemSwitches({ deliveryScheduleEnabled: false });
    const before = noticeCount();
    const refused = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 1_000_000 }],
      },
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(codeOf(refused.data), 'SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED');
    assert.equal(noticeCount(), before, 'a refused notice must not create any row');

    // Re-enabling the control restores the previous behaviour.
    setSystemSwitches({ deliveryScheduleEnabled: true });
    const accepted = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 1_000_000 }],
      },
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  });

  test('deliveryScheduleEnabled=false also refuses a Delivery Notice draft edit', async () => {
    const draft = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 1_000_000 }],
      },
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    setSystemSwitches({ deliveryScheduleEnabled: false });
    const before = noticeCount();
    const refused = await request(`/api/delivery-notices/${draft.data.notice.id}`, {
      token: tokens.sales, method: 'PATCH',
      body: { plannedDeliveryDate: '2026-10-25', lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 2_000_000 }] },
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(codeOf(refused.data), 'SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED');
    assert.equal(noticeCount(), before, 'a refused draft edit must not create any row');
    setSystemSwitches({ deliveryScheduleEnabled: true });
  });

  test('deliveryQuantityControlEnabled=false accepts a notice beyond the tolerance, and enabling it refuses the same notice', async () => {
    // A dedicated order line so the cumulative-capacity case is isolated.
    const { orderId: qtyOrderId, itemId: qtyItemId } = await createApprovedOrder({ keyPrefix: 'cap1-qty' });
    const noticeBody = {
      salesOrderId: qtyOrderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
      lines: [{ salesOrderItemId: qtyItemId, scheduledQtyMicros: 12_000_000 }],
    };

    // Control OFF: the over-tolerance notice is accepted.
    setSystemSwitches({ deliveryQuantityControlEnabled: false });
    const accepted = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body: noticeBody });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));

    // Control ON: the same notice is refused with the explicit code.
    setSystemSwitches({ deliveryQuantityControlEnabled: true });
    const refused = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body: noticeBody });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(codeOf(refused.data), 'DELIVERY_NOTICE_TOLERANCE_EXCEEDED');
  });

  test('deliveryQuantityControlEnabled=false removes the cumulative notice capacity refusal on confirm', async () => {
    const { orderId: cumulativeOrderId, itemId: cumulativeItemId } = await createApprovedOrder({ keyPrefix: 'cap1-cumulative' });
    const noticeBody = (quantity) => ({
      salesOrderId: cumulativeOrderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
      lines: [{ salesOrderItemId: cumulativeItemId, scheduledQtyMicros: quantity }],
    });

    // Control ON: two notices of 6 units each exceed the 10-unit upper bound
    // cumulatively, so the second CONFIRM is refused.
    setSystemSwitches({ deliveryQuantityControlEnabled: true });
    const first = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body: noticeBody(6_000_000) });
    const second = await request('/api/delivery-notices', { token: tokens.sales, method: 'POST', body: noticeBody(6_000_000) });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal((await request(`/api/delivery-notices/${first.data.notice.id}/confirm`, {
      token: tokens.sales, method: 'POST', key: 'cap1-cumulative-first', body: {},
    })).status, 200);
    const blocked = await request(`/api/delivery-notices/${second.data.notice.id}/confirm`, {
      token: tokens.sales, method: 'POST', key: 'cap1-cumulative-second', body: {},
    });
    assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
    assert.equal(codeOf(blocked.data), 'DELIVERY_NOTICE_CAPACITY_EXCEEDED');
    assert.equal(db.prepare('SELECT state FROM delivery_notices WHERE id=?').get(second.data.notice.id).state, 'DRAFT');

    // Control OFF: the cumulative bound is not enforced and the same
    // CONFIRM succeeds.
    setSystemSwitches({ deliveryQuantityControlEnabled: false });
    const allowed = await request(`/api/delivery-notices/${second.data.notice.id}/confirm`, {
      token: tokens.sales, method: 'POST', key: 'cap1-cumulative-second-open', body: {},
    });
    assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
    assert.equal(db.prepare('SELECT state FROM delivery_notices WHERE id=?').get(second.data.notice.id).state, 'CONFIRMED');
    setSystemSwitches({ deliveryQuantityControlEnabled: true });
  });

  test('reservationBehavior=DISABLED refuses a reservation intent request with an explicit code', async () => {
    const before = intentCount();
    setSystemSwitches({ reservationBehavior: 'DISABLED' });
    const refused = await request('/api/sales-reservation-intents', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, salesOrderItemId: orderItemId,
        productId: 'product-001', warehouseId, reservationMode: 'INVENTORY_LOCK', quantity: 1,
      },
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(codeOf(refused.data), 'SALES_RESERVATION_BEHAVIOR_DISABLED');
    assert.equal(intentCount(), before, 'a refused reservation intent must not create any row');
  });

  test('a non-DISABLED reservation behavior keeps the pre-existing behaviour', async () => {
    setSystemSwitches({ reservationBehavior: 'INVENTORY_LOCK' });
    const result = await request('/api/sales-reservation-intents', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, salesOrderItemId: orderItemId,
        productId: 'product-001', warehouseId, reservationMode: 'INVENTORY_LOCK', quantity: 1,
      },
    });
    // The refusal, when any, must NOT be the SC01 reservation-behaviour
    // refusal: a non-DISABLED behavior never blocks the reservation stage.
    assert.notEqual(codeOf(result.data), 'SALES_RESERVATION_BEHAVIOR_DISABLED', JSON.stringify(result.data));
    setSystemSwitches({ reservationBehavior: 'DISABLED' });
  });

  test('a DOCUMENT_TYPE row overrides the SYSTEM row for the delivery controls', async () => {
    // The SYSTEM row disables the delivery schedule; the SALES_ORDER row
    // re-enables it. The Delivery Notice resolves the DOCUMENT_TYPE row.
    setSystemSwitches({ deliveryScheduleEnabled: false });
    const upsert = await request('/api/sales/parameters', {
      method: 'PUT',
      body: {
        scopeType: 'DOCUMENT_TYPE', documentType: 'DELIVERY_NOTICE',
        sellableControlEnabled: false, customerMaterialXrefEnabled: false,
        salesGroupDataScopeEnabled: true, deliveryScheduleEnabled: true,
        deliveryQuantityControlEnabled: true, orderChangeMode: 'BOTH',
        reservationBehavior: 'DISABLED', active: true,
      },
    });
    assert.equal(upsert.status, 200, JSON.stringify(upsert.data));
    const accepted = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 1_000_000 }],
      },
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
    // Removing the DOCUMENT_TYPE row restores the SYSTEM-level refusal.
    db.prepare("DELETE FROM sales_parameters WHERE scope_key='DOCUMENT_TYPE:DELIVERY_NOTICE'").run();
    const refused = await request('/api/delivery-notices', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, warehouseId, businessDate: '2026-10-15', plannedDeliveryDate: '2026-10-20',
        lines: [{ salesOrderItemId: orderItemId, scheduledQtyMicros: 1_000_000 }],
      },
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(codeOf(refused.data), 'SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED');
    setSystemSwitches({ deliveryScheduleEnabled: true });
  });

  test('deliveryScheduleEnabled=false refuses a sales order submit whose line carries its own delivery schedule', async () => {
    // The header commitment date (`requested_delivery_date`) stays mandatory
    // under SC34 — it is the header commitment, not a delivery schedule. A
    // LINE that carries its own planned delivery date IS a delivery schedule
    // (SC30) and is refused while the control is off.
    orderSequence += 1;
    const created = await request('/api/sales-orders', {
      token: tokens.sales, method: 'POST', key: `cap1-schedule-${orderSequence}`,
      body: {
        customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
        items: [{
          productId: 'product-001', uomCode: uom, quantityDecimal: '10',
          plannedDeliveryDate: '2026-11-20',
        }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const scheduledOrderId = created.data.id;
    const scheduledItemId = db.prepare('SELECT id FROM sales_order_items WHERE order_id=? ORDER BY line_no LIMIT 1').get(scheduledOrderId).id;
    assert.equal(
      db.prepare('SELECT planned_delivery_date FROM sales_order_items WHERE id=?').get(scheduledItemId).planned_delivery_date,
      '2026-11-20',
      'the fixture must really carry a per-line delivery schedule',
    );

    // Control OFF: the submit is refused with the explicit code and the order
    // stays in DRAFT — zero business side effect.
    setSystemSwitches({ deliveryScheduleEnabled: false });
    const refused = await request(`/api/sales-orders/${scheduledOrderId}/submit`, {
      token: tokens.sales, method: 'POST', key: `cap1-schedule-${orderSequence}-submit`, body: {},
    });
    assert.equal(refused.status, 409, JSON.stringify(refused.data));
    assert.equal(codeOf(refused.data), 'SALES_DELIVERY_SCHEDULE_CONTROL_DISABLED');
    assert.equal(
      db.prepare('SELECT status FROM sales_orders WHERE id=?').get(scheduledOrderId).status,
      'DRAFT',
      'a refused submit must not move the order out of DRAFT',
    );

    // Control ON: the same order submits unchanged — the pre-existing
    // behaviour.
    setSystemSwitches({ deliveryScheduleEnabled: true });
    const accepted = await request(`/api/sales-orders/${scheduledOrderId}/submit`, {
      token: tokens.sales, method: 'POST', key: `cap1-schedule-${orderSequence}-submit-open`, body: {},
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  });

  test('deliveryScheduleEnabled=false leaves an order whose lines match the header commitment date submittable', async () => {
    // The default SO create copies the header date onto every line, so an
    // order without an explicit per-line schedule is NOT a delivery schedule
    // and must stay submittable while the control is off. This is the
    // negative control that proves the guard is not a blanket ban.
    orderSequence += 1;
    const created = await request('/api/sales-orders', {
      token: tokens.sales, method: 'POST', key: `cap1-no-schedule-${orderSequence}`,
      body: {
        customerId: 'customer-001', orderDate: '2026-10-15', requestedDeliveryDate: '2026-10-20',
        items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '10' }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    setSystemSwitches({ deliveryScheduleEnabled: false });
    const submitted = await request(`/api/sales-orders/${created.data.id}/submit`, {
      token: tokens.sales, method: 'POST', key: `cap1-no-schedule-${orderSequence}-submit`, body: {},
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    setSystemSwitches({ deliveryScheduleEnabled: true });
  });
});

// ---------------------------------------------------------------------------
// CAP-1 / SC-DEF-08 — operator work surfaces.
//
// The repo convention for "the screen exists and is wired" is a source
// assertion plus a registry assertion. The source assertions live in
// `server/ui-source.test.js` (a FAST suite, so they never depend on an
// unapplied registry change). The registry BINDING assertions live here,
// because the registry file is under concurrent edit by the credit work
// package and the five route entries must be applied together with this
// work package.
// ---------------------------------------------------------------------------

const NEW_SALES_ROUTE_KEYS = [
  'sales-parameters',
  'sales-group-memberships',
  'sellable-scope-rules',
  'product-classifications',
  'sales-price-override-authorizations',
];

describe('CAP-1 SC-DEF-08 — Sales operator work surfaces are wired', () => {
  const registrySource = readFileSync(join(repoRoot, 'src', 'navigation', 'applicationRegistry.js'), 'utf8');
  const pageSource = readFileSync(join(repoRoot, 'src', 'pages', 'sales-parameters.jsx'), 'utf8');
  const batchSource = readFileSync(join(repoRoot, 'src', 'pages', 'sales-batch-a.jsx'), 'utf8');

  test('every operator surface is exported from the canonical page module', () => {
    for (const name of [
      'SalesParameters',
      'SalesGroupMemberships',
      'SellableScopeRules',
      'ProductClassifications',
      'PriceOverrideAuthorizations',
    ]) {
      assert.match(
        pageSource,
        new RegExp(`export\\s+function\\s+${name}\\b`),
        `src/pages/sales-parameters.jsx must export ${name}`,
      );
    }
  });

  test('the operator surfaces consume only the existing backend endpoints', () => {
    for (const endpoint of [
      '/api/sales/parameters',
      '/api/sales/memberships',
      '/api/sales/sellable-scope-rules',
      '/api/sales/product-classifications',
      '/api/sales-price-overrides/authorize',
    ]) {
      assert.ok(pageSource.includes(endpoint), `the surfaces must consume ${endpoint}`);
    }
  });

  test('the new Sales routes are declared and bound in the canonical registry', () => {
    for (const key of NEW_SALES_ROUTE_KEYS) {
      assert.match(
        registrySource,
        new RegExp(`route\\('${key}'`),
        `applicationRegistry.js must declare the ${key} route`,
      );
      assert.match(
        registrySource,
        new RegExp(`'${key}':\\s*named\\('\\.\\./pages/sales-parameters\\.jsx'`),
        `applicationRegistry.js must bind ${key} to its canonical screen`,
      );
    }
  });

  test('the new Sales routes stay contextual Sales & Customer routes with a parent', () => {
    for (const key of NEW_SALES_ROUTE_KEYS) {
      const line = registrySource.split('\n').find((row) => row.includes(`route('${key}'`));
      assert.ok(line, `${key} route definition must exist`);
      assert.ok(line.includes("'sales-customer'"), `${key} must belong to the sales-customer domain`);
      assert.ok(line.includes("'contextual'"), `${key} must be a contextual route`);
      assert.ok(line.includes('parentRoute:'), `${key} must declare a parentRoute`);
    }
    // The contextual route set must classify the new routes as CONTEXTUAL.
    const contextualBlock = registrySource.slice(registrySource.indexOf('const CONTEXTUAL_ROUTES'));
    for (const key of NEW_SALES_ROUTE_KEYS) {
      assert.ok(contextualBlock.includes(`'${key}'`), `${key} must be listed in CONTEXTUAL_ROUTES`);
    }
  });

  test('the new Sales routes add NO launcher entry', () => {
    // These are operator sub-surfaces reached from the Sales & Customer
    // contextual navigation. The only Sales launcher entry today remains
    // 'credit-query'.
    const launcherBlock = registrySource.slice(
      registrySource.indexOf('const APPLICATION_LAUNCHER_GROUPS'),
      registrySource.indexOf('const launcherEntriesByRoute'),
    );
    for (const key of NEW_SALES_ROUTE_KEYS) {
      assert.equal(
        launcherBlock.includes(`'${key}'`),
        false,
        `${key} must not appear as a launcher entry`,
      );
    }
  });

  test('the order change editor accepts a freshly obtained price override authorisation id', () => {
    assert.match(batchSource, /priceOverrideAuthorizationId/, 'the change editor must carry the authorisation id field');
    assert.match(batchSource, /setAuthorizations/, 'the change draft editor must let the operator enter an authorisation id');
  });

  test('the SC01 reservation behaviour guard is wired into the reservation stage', () => {
    // The guard itself is implemented and exported from
    // server/modules/sales-parameters.js. It is enforced on the RESERVATION
    // gate stage, which is entered ONLY by the Sales reservation intent
    // writer (server/modules/sales-reservation-intent.js is the sole caller
    // of `authorizeSalesPrepaymentGateWithPlan` with `stage: 'RESERVATION'`).
    // That keeps the enforcement OUT of the Finance gate semantics while
    // still covering every reservation request.
    const gateSource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-prepayment-gate.js'), 'utf8');
    assert.match(
      gateSource,
      /assertReservationBehaviorEnabled/,
      'server/modules/sales-prepayment-gate.js must call assertReservationBehaviorEnabled on the RESERVATION stage',
    );
    assert.match(
      gateSource,
      /stage\s*===\s*'RESERVATION'/,
      'the reservation behaviour guard must be gated on the RESERVATION stage',
    );
    const intentSource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-reservation-intent.js'), 'utf8');
    assert.match(
      intentSource,
      /stage:\s*'RESERVATION'/,
      'the reservation intent writer must enter the RESERVATION gate stage',
    );
  });

  test('the SC01 delivery schedule guard is wired into the sales order submit path', () => {
    // The SALES_ORDER side of `delivery_schedule_enabled` is enforced on the
    // submit path. `submitSalesOrder` (server/modules/sales-orders.js) enters
    // the shared gate helper with `stage: 'PLANNING_RELEASE'`, and that stage
    // is used by NO other flow, so it is the single submit-time hook.
    //
    // The guard itself is exported from server/modules/sales-parameters.js —
    // the module that owns the A-65 parameter table — so the switch and its
    // enforcement share one canonical owner.
    const gateSource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-prepayment-gate.js'), 'utf8');
    assert.match(
      gateSource,
      /assertSalesOrderDeliveryScheduleEnabled/,
      'server/modules/sales-prepayment-gate.js must call assertSalesOrderDeliveryScheduleEnabled on the submit stage',
    );
    assert.match(
      gateSource,
      /stage\s*===\s*'PLANNING_RELEASE'/,
      'the sales order delivery schedule guard must be gated on the PLANNING_RELEASE stage',
    );
    const parameterSource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-parameters.js'), 'utf8');
    assert.match(
      parameterSource,
      /export\s+function\s+assertSalesOrderDeliveryScheduleEnabled\b/,
      'server/modules/sales-parameters.js must export assertSalesOrderDeliveryScheduleEnabled',
    );
    const orderSource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-orders.js'), 'utf8');
    assert.match(
      orderSource,
      /stage:\s*'PLANNING_RELEASE'/,
      'the sales order submit path must enter the PLANNING_RELEASE stage',
    );
  });

  test('the DOCUMENT_TYPE delivery schedule guard is wired into the delivery notice path', () => {
    const noticeSource = readFileSync(join(repoRoot, 'server', 'modules', 'delivery-notices.js'), 'utf8');
    assert.match(
      noticeSource,
      /assertDeliveryScheduleEnabled/,
      'server/modules/delivery-notices.js must call assertDeliveryScheduleEnabled',
    );
    const parameterSource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-parameters.js'), 'utf8');
    assert.match(
      parameterSource,
      /export\s+function\s+assertDeliveryScheduleEnabled\b/,
      'server/modules/sales-parameters.js must export assertDeliveryScheduleEnabled',
    );
  });

  test('the delivery quantity control guard is wired into both delivery capacity paths', () => {
    const noticeSource = readFileSync(join(repoRoot, 'server', 'modules', 'delivery-notices.js'), 'utf8');
    assert.match(
      noticeSource,
      /resolveDeliveryQuantityControl/,
      'server/modules/delivery-notices.js must resolve the delivery quantity control',
    );
    const deliverySource = readFileSync(join(repoRoot, 'server', 'modules', 'sales-delivery-source.js'), 'utf8');
    assert.match(
      deliverySource,
      /resolveDeliveryQuantityControl/,
      'server/modules/sales-delivery-source.js must resolve the delivery quantity control',
    );
  });
});
