// SC32 / SC68 — Sales reservation intent reaction suite.
//
// Closes the two defects recorded by the Sales & Customer capability audit
// 2026-11-13:
//
//   SC-DEF-02  `sales_orders.reservation_intent_state` was written only at
//              INSERT time with the default 'NONE'; no UPDATE existed
//              repo-wide, so the order-side reservation fact was inert.
//   SC-DEF-03  `adjustReservationIntentOnChange` and
//              `releaseReservationIntentsForOrder` had zero callers repo-wide,
//              so the reservation never reacted to SO change / cancel /
//              close / return / replacement.
//
// The suite drives the PRODUCTION writers and the REAL HTTP surface. It never
// asserts against a hand-written structure: every canonical reservation /
// inventory lock is produced by the Sales intent writer through the Planning
// / Inventory owner adapters.
//
// Contract anchors:
//   * Requirement §34.3.5 SC32  — SO Reservation Intent (order-side fact)
//   * Requirement §34.3.13 SC66..SC68 — Reservation Intent request / view /
//     release + react to SO change / cancel / close / return / replacement
//   * Requirement §34.3.6 SC40 — executed / delivered / invoiced / financially
//     recognized history is never silently rewritten
//   * Requirement §34.4 S05 / S12 — no silent rewrite; Sales owns intent only,
//     Planning owns the canonical reserved quantity
//   * Design §29.17.2 — React to events table

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword, transaction } from './db.js';
import { migrateSalesCustomerDomain } from './migrations/sales-customer-domain.js';
import {
  adjustReservationIntentOnChange,
  releaseReservationIntentsForOrder,
  requestReservationIntent,
  grantReservationIntent,
  consumeReservationIntent,
  releaseReservationIntent,
  __salesReservationIntentInternals,
} from './modules/sales-reservation-intent.js';
import { salesOrderAction } from './modules/sales-orders.js';
import { createDirectSalesOrderChange, salesOrderChangeAction } from './modules/sales-order-changes.js';

const DAY = '2026-10-20';

function makeReq(body = {}, headers = {}) {
  const encoded = body === undefined ? '' : JSON.stringify(body);
  const buf = Buffer.from(encoded, 'utf8');
  let consumed = false;
  return {
    headers: { 'content-type': 'application/json', 'content-length': String(buf.length), ...headers },
    async *[Symbol.asyncIterator]() {
      if (consumed) return;
      consumed = true;
      yield buf;
    },
  };
}

function makeRes() {
  const state = {
    statusCode: null, body: null, headers: {}, chunks: [], ended: false,
    setHeader(name, value) { state.headers[name] = value; },
    end(chunk) {
      if (chunk) state.chunks.push(chunk);
      state.ended = true;
      try {
        state.body = JSON.parse(Buffer.concat(state.chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf8') || 'null');
      } catch { state.body = null; }
    },
    writeHead(status) { state.statusCode = status; },
  };
  return state;
}

const salesActor = (id) => ({
  id, roleCode: 'SALES', permissions: ['SALES_MANAGE', 'SALES_VIEW', 'SALES_ORDER_CHANGE_DIRECT_REQUEST'], isSystemAdmin: false,
});
const reviewerActor = (id) => ({
  id, roleCode: 'REVIEWER', permissions: ['SALES_MANAGE', 'SALES_VIEW', 'SALES_ORDER_CHANGE_APPROVE', 'SALES_CROSS_GROUP'], isSystemAdmin: false,
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function buildDb() {
  const temp = mkdtempSync(join(tmpdir(), 'modern-erp-sc-reservation-'));
  const db = createDatabase(join(temp, 'sc.db'));
  try {
    migrateSalesCustomerDomain(db);
  } catch (error) {
    db.close();
    rmSync(temp, { recursive: true, force: true });
    throw error;
  }
  return { db, temp };
}

// One APPROVED, commercially OPEN sales order with a single 10 EA line, plus the
// Planning / Inventory context the reservation adapters need.
function seedOrderContext(db, { orderId = 'so-r', itemId = 'soi-r', quantity = 10 } = {}) {
  const now = new Date().toISOString();
  const hashed = hashPassword('reservation-1234');
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
    VALUES('u-r','res-sales','Reservation Sales',?,?,'role-sales',1,?)`).run(hashed.hash, hashed.salt, now);
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at)
    VALUES('cus-r','CUS-R','Reservation Customer','','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
    VALUES('sp-r','SP-R','Salesperson R','u-r',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO sales_groups(id,group_code,name,description,active,created_at,updated_at)
    VALUES('sg-r','SG-R','Sales Group R','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,effective_to,created_at,updated_at)
    VALUES('mem-r','sp-r','sg-r',1,1,?,NULL,?,?)`).run(DAY, now, now);
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at)
    VALUES('wh-r','WH-R','Reservation Warehouse','','',1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES('p-r','P-R','Reservation Product','','EA',10000,0,1,?,?)`).run(now, now);
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
    VALUES('inv-r','wh-r','p-r',100,?)`).run(now);
  db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
      active,created_at,updated_at,created_by,updated_by)
    VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','INVENTORY_LOCK',1,?,?,'u-r','u-r')`).run(now, now);
  db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,
      order_date,requested_delivery_date,payment_terms_days,commercial_close_state,effective_version,sales_group_id,salesperson_id)
    VALUES(?,'SO-R','cus-r','APPROVED',?, 'u-r',?,?,?,?,30,'OPEN',1,'sg-r','sp-r')`)
    .run(orderId, quantity * 10000, now, now, DAY, DAY);
  db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
      document_quantity_num,document_quantity_den,upper_delivery_tolerance_bps,lower_delivery_tolerance_bps)
    VALUES(?,?,'p-r',?,10000,?,1,?,1,0,5000)`).run(itemId, orderId, quantity, quantity * 10000, quantity * 1_000_000);
  return { now, orderId, itemId };
}

// A confirmed Delivery for the given SO line — the canonical Sales-visible
// execution fact that freezes the obligation.
function seedConfirmedDelivery(db, { orderId, itemId, quantity }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,status,delivery_date,warehouse_id,handler_id,total_cents,created_at,updated_at,creator_id)
    VALUES('del-r','SD-R',?,'cus-r','CONFIRMED',?,'wh-r','u-r',?,?,?,'u-r')`).run(orderId, DAY, quantity * 10000, now, now);
  db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,sales_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
    VALUES('sdi-r','del-r',?,'p-r',?,10000,?,1)`).run(itemId, quantity, quantity * 10000);
}

async function requestIntent(db, actor, { orderId = 'so-r', itemId = 'soi-r', quantity = 5 } = {}) {
  const res = makeRes();
  await requestReservationIntent(db, makeReq({
    salesOrderId: orderId,
    salesOrderItemId: itemId,
    productId: 'p-r',
    warehouseId: 'wh-r',
    quantity,
    reservationMode: 'INVENTORY_LOCK',
    businessDate: DAY,
  }), res, actor);
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body;
}

function orderReservationState(db, orderId) {
  return db.prepare('SELECT reservation_intent_state FROM sales_orders WHERE id=?').get(orderId)?.reservation_intent_state;
}

// ---------------------------------------------------------------------------
// SC-DEF-02 — the order-side reservation state is a live projection
// ---------------------------------------------------------------------------

describe('SC32 — sales_orders.reservation_intent_state is a live projection', () => {
  test('request / grant / consume / release move the order-side state', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      assert.equal(orderReservationState(db, 'so-r'), 'NONE');

      const intent = await requestIntent(db, actor);
      assert.equal(intent.intentState, 'REQUESTED');
      assert.equal(orderReservationState(db, 'so-r'), 'REQUESTED');

      const grantRes = makeRes();
      await grantReservationIntent(db, makeReq({ grantedQty: 5 }), grantRes, actor, intent.id);
      assert.equal(grantRes.body.intentState, 'GRANTED');
      assert.equal(orderReservationState(db, 'so-r'), 'GRANTED');

      const consumeRes = makeRes();
      await consumeReservationIntent(db, makeReq({ quantity: 2, consumerEvent: 'DELIVERY_CONFIRMED' }), consumeRes, actor, intent.id);
      assert.equal(consumeRes.body.intentState, 'GRANTED');
      assert.equal(orderReservationState(db, 'so-r'), 'GRANTED');

      const releaseRes = makeRes();
      await releaseReservationIntent(db, makeReq({ consumerEvent: 'MANUAL' }), releaseRes, actor, intent.id);
      assert.equal(releaseRes.body.intentState, 'RELEASED');
      assert.equal(orderReservationState(db, 'so-r'), 'RELEASED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('a fully consumed reservation closes the order-side state, it does not keep it GRANTED', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      const intent = await requestIntent(db, actor, { quantity: 2 });
      const grantRes = makeRes();
      await grantReservationIntent(db, makeReq({ grantedQty: 2 }), grantRes, actor, intent.id);
      const consumeRes = makeRes();
      await consumeReservationIntent(db, makeReq({ quantity: 2, consumerEvent: 'DELIVERY_CONFIRMED' }), consumeRes, actor, intent.id);
      assert.equal(consumeRes.body.intentState, 'CONSUMED');
      assert.equal(orderReservationState(db, 'so-r'), 'RELEASED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// SC-DEF-03 — the reservation reacts to the SO lifecycle
// ---------------------------------------------------------------------------

describe('SC68 — the reservation reacts to SO change / cancel / close', () => {
  test('an SO cancel releases the open reservation and moves the order-side state', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      await requestIntent(db, actor, { quantity: 5 });
      assert.equal(orderReservationState(db, 'so-r'), 'REQUESTED');

      const res = makeRes();
      await salesOrderAction(db, makeReq({ reason: '客户取消' }, { 'idempotency-key': 'cancel-r-1' }), res, actor, 'so-r', 'cancel');
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));

      const intent = db.prepare(`SELECT * FROM sales_reservation_intent WHERE sales_order_id='so-r'`).get();
      assert.equal(intent.intent_state, 'RELEASED');
      assert.equal(intent.consumer_event, 'SO_CANCELLED');
      const lock = db.prepare(`SELECT * FROM inventory_locks WHERE id=?`).get(intent.inventory_lock_id);
      assert.equal(lock.status, 'RELEASED');
      assert.equal(orderReservationState(db, 'so-r'), 'RELEASED');
      const order = db.prepare(`SELECT * FROM sales_orders WHERE id='so-r'`).get();
      assert.equal(order.commercial_close_state, 'CANCELLED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('an SO close releases the still-open reservation of the order', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      await requestIntent(db, actor, { quantity: 5 });
      // The controlled close needs a delivery that reaches the line's lower
      // tolerance. The reservation is deliberately NOT consumed: it is still
      // an open obligation, so the close must release it.
      seedConfirmedDelivery(db, { orderId: 'so-r', itemId: 'soi-r', quantity: 5 });
      const res = makeRes();
      await salesOrderAction(db, makeReq({ reason: '受控关闭' }, { 'idempotency-key': 'close-r-1' }), res, actor, 'so-r', 'close');
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const intent = db.prepare(`SELECT * FROM sales_reservation_intent WHERE sales_order_id='so-r'`).get();
      assert.equal(intent.intent_state, 'RELEASED');
      assert.equal(intent.consumer_event, 'SO_CLOSED');
      assert.equal(orderReservationState(db, 'so-r'), 'RELEASED');
      const lock = db.prepare(`SELECT * FROM inventory_locks WHERE id=?`).get(intent.inventory_lock_id);
      assert.equal(lock.status, 'RELEASED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('an SO close after full fulfilment does NOT release an already consumed reservation', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      const intent = await requestIntent(db, actor, { quantity: 5 });
      const grantRes = makeRes();
      await grantReservationIntent(db, makeReq({ grantedQty: 5 }), grantRes, actor, intent.id);
      const consumeRes = makeRes();
      await consumeReservationIntent(db, makeReq({ quantity: 5, consumerEvent: 'DELIVERY_CONFIRMED' }), consumeRes, actor, intent.id);
      assert.equal(consumeRes.body.intentState, 'CONSUMED');

      // The line is fully delivered, so the controlled close is allowed.
      seedConfirmedDelivery(db, { orderId: 'so-r', itemId: 'soi-r', quantity: 10 });
      const res = makeRes();
      await salesOrderAction(db, makeReq({ reason: '全部交付后关闭' }, { 'idempotency-key': 'close-r-2' }), res, actor, 'so-r', 'close');
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));

      // The consumed reservation is executed history and must survive the close.
      const after = db.prepare(`SELECT * FROM sales_reservation_intent WHERE id=?`).get(intent.id);
      assert.equal(after.intent_state, 'CONSUMED');
      assert.equal(Number(after.consumed_qty), 5);
      assert.equal(after.consumer_event, 'DELIVERY_CONFIRMED');
      const lock = db.prepare(`SELECT * FROM inventory_locks WHERE id=?`).get(after.inventory_lock_id);
      assert.equal(lock.status, 'ACTIVE', 'a consumed reservation must not be released by the close');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Transaction discipline — a failure leaves NO partial state
// ---------------------------------------------------------------------------

describe('SC68 — the reservation reaction shares the order transaction', () => {
  test('a failing SO cancel rolls the reservation release back with the cancel', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      await requestIntent(db, actor, { quantity: 5 });
      const before = db.prepare(`SELECT * FROM sales_reservation_intent WHERE sales_order_id='so-r'`).get();
      const lockBefore = db.prepare(`SELECT * FROM inventory_locks WHERE id=?`).get(before.inventory_lock_id);
      assert.equal(lockBefore.status, 'ACTIVE');

      // A pending Delivery Notice blocks the close, so the whole close
      // transaction must roll back — including any reservation release.
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO delivery_notices(id,notice_no,sales_order_id,state,warehouse_id,ship_to_snapshot_json,planned_delivery_date,
          business_date,customer_id,customer_snapshot_json,creator_id,created_at,updated_at)
        VALUES('dn-r','DN-R','so-r','CONFIRMED','wh-r','{}',?,?,'cus-r','{}','u-r',?,?)`).run(DAY, DAY, now, now);
      db.prepare(`INSERT INTO delivery_notice_lines(id,delivery_notice_id,line_no,sales_order_item_id,scheduled_qty_micros,notified_qty_micros,cancelled_notified_qty_micros)
        VALUES('dnl-r','dn-r',1,'soi-r',5000000,0,0)`).run();

      const res = makeRes();
      await assert.rejects(
        salesOrderAction(db, makeReq({ reason: '关闭' }, { 'idempotency-key': 'close-r-fail' }), res, actor, 'so-r', 'close'),
        (error) => error?.code === 'SALES_ORDER_PENDING_DELIVERY_NOTICE',
      );

      const after = db.prepare(`SELECT * FROM sales_reservation_intent WHERE sales_order_id='so-r'`).get();
      assert.equal(after.intent_state, 'REQUESTED');
      const lockAfter = db.prepare(`SELECT * FROM inventory_locks WHERE id=?`).get(before.inventory_lock_id);
      assert.equal(lockAfter.status, 'ACTIVE', 'a rolled back close must not release the inventory lock');
      const order = db.prepare(`SELECT * FROM sales_orders WHERE id='so-r'`).get();
      assert.equal(order.commercial_close_state, 'OPEN');
      assert.equal(orderReservationState(db, 'so-r'), 'REQUESTED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('a failing release of an already consumed reservation fails closed', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      const intent = await requestIntent(db, actor, { quantity: 5 });
      const grantRes = makeRes();
      await grantReservationIntent(db, makeReq({ grantedQty: 5 }), grantRes, actor, intent.id);
      const consumeRes = makeRes();
      await consumeReservationIntent(db, makeReq({ quantity: 5, consumerEvent: 'DELIVERY_CONFIRMED' }), consumeRes, actor, intent.id);
      assert.equal(consumeRes.body.intentState, 'CONSUMED');

      const internals = __salesReservationIntentInternals();
      assert.throws(
        () => transaction(db, () => internals.releaseIntentRow(db, actor, {
          id: intent.id, sales_order_id: 'so-r', intent_state: 'CONSUMED',
          granted_qty: 5, consumed_qty: 5, released_qty: 0,
          inventory_lock_id: db.prepare(`SELECT inventory_lock_id FROM sales_reservation_intent WHERE id=?`).get(intent.id).inventory_lock_id,
          planning_reservation_id: null,
        }, { consumerEvent: 'MANUAL', auditAction: 'RELEASE' })),
        (error) => error?.code === 'SALES_RESERVATION_INTENT_ALREADY_CONSUMED',
      );
      const after = db.prepare(`SELECT * FROM sales_reservation_intent WHERE id=?`).get(intent.id);
      assert.equal(after.intent_state, 'CONSUMED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The two formerly dead exports now have real callers
// ---------------------------------------------------------------------------

describe('SC68 — the react-to-event exports have real callers', () => {
  test('adjustReservationIntentOnChange and releaseReservationIntentsForOrder are called by the SO writers', async () => {
    const { readFileSync } = await import('node:fs');
    const changes = readFileSync(resolve('server/modules/sales-order-changes.js'), 'utf8');
    const orders = readFileSync(resolve('server/modules/sales-orders.js'), 'utf8');
    assert.ok(changes.includes('adjustReservationIntentOnChange(db, actor'), 'the SO change path must call the adjust helper');
    assert.ok(orders.includes('releaseReservationIntentsForOrder(db, actor'), 'the SO cancel/close path must call the release helper');
  });

  test('adjustReservationIntentOnChange leaves a consumed intent untouched', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      const intent = await requestIntent(db, actor, { quantity: 10 });
      const grantRes = makeRes();
      await grantReservationIntent(db, makeReq({ grantedQty: 10 }), grantRes, actor, intent.id);
      const consumeRes = makeRes();
      await consumeReservationIntent(db, makeReq({ quantity: 10, consumerEvent: 'DELIVERY_CONFIRMED' }), consumeRes, actor, intent.id);

      transaction(db, () => {
        adjustReservationIntentOnChange(db, actor, {
          salesOrderId: 'so-r', salesOrderItemId: 'soi-r', newQty: 4, consumerEvent: 'SO_CHANGED', executedQty: 10,
        });
      });
      const after = db.prepare(`SELECT * FROM sales_reservation_intent WHERE id=?`).get(intent.id);
      assert.equal(after.intent_state, 'CONSUMED');
      assert.equal(Number(after.consumed_qty), 10);
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('releaseReservationIntentsForOrder skips the lines that carry an execution fact', async () => {
    const { db, temp } = buildDb();
    try {
      seedOrderContext(db);
      const actor = salesActor('u-r');
      const intent = await requestIntent(db, actor, { quantity: 5 });
      const grantRes = makeRes();
      await grantReservationIntent(db, makeReq({ grantedQty: 5 }), grantRes, actor, intent.id);
      const consumeRes = makeRes();
      await consumeReservationIntent(db, makeReq({ quantity: 5, consumerEvent: 'DELIVERY_CONFIRMED' }), consumeRes, actor, intent.id);

      let released = 0;
      transaction(db, () => {
        released = releaseReservationIntentsForOrder(db, actor, {
          salesOrderId: 'so-r', consumerEvent: 'SO_CLOSED', executedItemIds: ['soi-r'],
        });
      });
      assert.equal(released, 0);
      const after = db.prepare(`SELECT * FROM sales_reservation_intent WHERE id=?`).get(intent.id);
      assert.equal(after.intent_state, 'CONSUMED');
    } finally {
      db.close();
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end through the real HTTP surface
// ---------------------------------------------------------------------------

describe('SC68 — end-to-end over the HTTP surface', () => {
  let server; let baseUrl; let db; let tempDir;
  const tokens = {};

  async function http(path, { token = tokens.sales, method = 'GET', body, key } = {}) {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['idempotency-key'] = key;
    const response = await fetch(baseUrl + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }

  before(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'sales-reservation-http-'));
    db = createDatabase(join(tempDir, 'erp.db'));
    const now = new Date().toISOString();
    // The demo seed already provides `user-admin` / `user-sales` and the
    // canonical `customer-001` / `product-001` rows. The fixture only adds the
    // Sales commercial context the reservation writer needs.
    const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
    db.prepare('INSERT OR IGNORE INTO uoms(code,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(uom, uom, now, now);
    db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
        sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
        active,created_at,updated_at,created_by,updated_by)
      VALUES('SYSTEM','SYSTEM',NULL,0,0,1,1,1,'BOTH','INVENTORY_LOCK',1,?,?,'user-admin','user-admin')`).run(now, now);
    db.prepare(`INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at)
      VALUES('sg-http','SG-HTTP','HTTP Group',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,name,user_id,active,created_at,updated_at)
      VALUES('sp-http','SP-HTTP','HTTP Salesperson','user-admin',1,?,?)`).run(now, now);
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,created_at,updated_at)
      VALUES('mem-http','sp-http','sg-http',1,1,'2026-01-01',?,?)`).run(now, now);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,
        default_upper_delivery_tolerance_bps,default_lower_delivery_tolerance_bps,service_classification,active,created_at,updated_at)
      VALUES('pc-http','product-001',1,?,?,1000,500,0,1,?,?)`).run(uom, uom, now, now);
    // The canonical price list the Sales pricing engine resolves against, so
    // the production order writer can produce a real price / discount snapshot.
    const priceListId = '21111111-1111-4111-8111-111111111111';
    db.prepare(`INSERT INTO sales_price_lists(id,price_list_code,name,currency_code,priority,effective_from,status,activated_at,activated_by,created_at,created_by,updated_at,updated_by)
      VALUES(?,'RES-PL','Reservation Price','CNY',0,'2026-01-01','ACTIVE',?,'user-admin',?,'user-admin',?,'user-admin')`)
      .run(priceListId, now, now, now);
    const materialKey = `M:${Buffer.from('product-001').toString('hex').toUpperCase()}`;
    const pricingKey = `U:${Buffer.from(uom).toString('hex').toUpperCase()}|Q:0000000000000000|D:20260101`;
    db.prepare(`INSERT INTO sales_price_list_entries(id,price_list_id,material_id,customer_id,customer_scope_type,material_identity_key,customer_scope_key,
        pricing_uom_code,pricing_identity_key,qty_break_min_micros,effective_from,created_at,created_by)
      VALUES('res-entry',?,'product-001',NULL,'ALL',?,'A',?,?,0,'2026-01-01',?,'user-admin')`)
      .run(priceListId, materialKey, uom, pricingKey, now);
    db.prepare(`INSERT INTO sales_price_list_versions(id,entry_id,version,unit_price_cents,snapshot_json,created_at,created_by)
      VALUES('res-version','res-entry',1,1000,'{}',?,'user-admin')`).run(now);
    db.prepare(`INSERT INTO customer_commercial_extensions(customer_id,effective_from,settlement_party_customer_id,payer_customer_id,
        default_salesperson_id,default_sales_group_id,default_payment_terms_days,default_settlement_method,sellable_scope_mode,created_at,updated_at,
        created_by,updated_by,default_pricing_list_id) VALUES('customer-001','2026-01-01','customer-001','customer-001','sp-http','sg-http',30,'MONTHLY','ALL_SALES_ENABLED',?,?,
        'user-admin','user-admin',?)`).run(now, now, priceListId);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,
        order_date,requested_delivery_date,payment_terms_days,commercial_close_state,effective_version,sales_group_id,salesperson_id,
        settlement_party_id,payer_id,reservation_intent_state)
      VALUES('so-http','SO-HTTP','customer-001','APPROVED',10000,'user-admin',?,?,?,?,30,'OPEN',1,'sg-http','sp-http','customer-001','customer-001','NONE')`)
      .run(now, now, '2026-10-20', '2026-10-25');
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
        document_quantity_num,document_quantity_den,upper_delivery_tolerance_bps,lower_delivery_tolerance_bps)
      VALUES('soi-http','so-http','product-001',10,1000,10000,1,10000000,1,0,0)`).run();
    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await http('/api/auth/login', { token: '', method: 'POST', body: { username: 'admin', password: 'admin123' } });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    tokens.sales = login.data.token;
    const reviewer = await http('/api/auth/login', { token: '', method: 'POST', body: { username: 'reviewer', password: 'review123' } });
    assert.equal(reviewer.status, 200, JSON.stringify(reviewer.data));
    tokens.reviewer = reviewer.data.token;
  });

  after(async () => {
    if (server) await new Promise((done) => server.close(done));
    try { db?.close(); } catch { /* already closed */ }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test('the HTTP surface shows the reservation intent and the order-side state reacting to a cancel', async () => {
    const requested = await http('/api/sales-reservation-intents', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: 'so-http', salesOrderItemId: 'soi-http', productId: 'product-001',
        warehouseId: 'warehouse-001', quantity: 4, reservationMode: 'INVENTORY_LOCK', businessDate: '2026-10-20',
      },
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    assert.equal(requested.data.intentState, 'REQUESTED');

    const listed = await http('/api/sales-reservation-intents?salesOrderId=so-http', { token: tokens.sales });
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.equal(listed.data.intents.length, 1);

    const order = db.prepare(`SELECT reservation_intent_state FROM sales_orders WHERE id='so-http'`).get();
    assert.equal(order.reservation_intent_state, 'REQUESTED');

    const cancelled = await http('/api/sales-orders/so-http/cancel', {
      token: tokens.sales, method: 'POST', body: { reason: 'HTTP 取消' }, key: 'http-cancel-1',
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));

    const after = db.prepare(`SELECT reservation_intent_state FROM sales_orders WHERE id='so-http'`).get();
    assert.equal(after.reservation_intent_state, 'RELEASED');
    const intent = db.prepare(`SELECT * FROM sales_reservation_intent WHERE sales_order_id='so-http'`).get();
    assert.equal(intent.intent_state, 'RELEASED');
    assert.equal(intent.consumer_event, 'SO_CANCELLED');
  });

  test('an SO controlled change that reduces the line quantity releases the reservation', async () => {
    // The order is created through the PRODUCTION writer so it carries the
    // canonical price / discount snapshot the change path validates against.
    const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
    const created = await http('/api/sales-orders', {
      token: tokens.sales, method: 'POST', key: 'res-change-order',
      body: {
        customerId: 'customer-001', orderDate: '2026-10-20', requestedDeliveryDate: '2026-10-25',
        items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '10' }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const orderId = created.data.id;
    const itemId = created.data.itemIds[0];
    assert.ok(itemId);

    const submitted = await http(`/api/sales-orders/${orderId}/submit`, {
      token: tokens.sales, method: 'POST', key: 'res-change-submit', body: {},
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    const approved = await http(`/api/sales-orders/${orderId}/approve`, {
      token: tokens.reviewer, method: 'POST', key: 'res-change-approve', body: {},
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));

    const requested = await http('/api/sales-reservation-intents', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, salesOrderItemId: itemId, productId: 'product-001',
        warehouseId: 'warehouse-001', quantity: 10, reservationMode: 'INVENTORY_LOCK', businessDate: '2026-10-20',
      },
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    assert.equal(db.prepare('SELECT reservation_intent_state FROM sales_orders WHERE id=?').get(orderId).reservation_intent_state, 'REQUESTED');

    // CONTROLLED_DIRECT change: 10 EA -> 6 EA.
    const change = await http(`/api/sales-orders/${orderId}/controlled-change`, {
      token: tokens.sales, method: 'POST', key: 'res-change-1',
      body: {
        reasonCode: 'CUSTOMER_REQUEST', reason: '客户下调数量',
        lines: [{ op: 'MODIFY', salesOrderItemId: itemId, quantityMicros: 6_000_000 }],
      },
    });
    assert.equal(change.status, 201, JSON.stringify(change.data));
    const applied = await http(`/api/sales-order-changes/${change.data.id}/approve`, {
      token: tokens.reviewer, method: 'POST', key: 'res-change-1-apply', body: {},
    });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));

    assert.equal(Number(db.prepare('SELECT quantity FROM sales_order_items WHERE id=?').get(itemId).quantity), 6);
    const intent = db.prepare('SELECT * FROM sales_reservation_intent WHERE sales_order_id=?').get(orderId);
    assert.equal(intent.intent_state, 'RELEASED');
    assert.equal(intent.consumer_event, 'SO_CHANGED');
    assert.equal(db.prepare('SELECT reservation_intent_state FROM sales_orders WHERE id=?').get(orderId).reservation_intent_state, 'RELEASED');
    const lock = db.prepare('SELECT * FROM inventory_locks WHERE id=?').get(intent.inventory_lock_id);
    assert.equal(lock.status, 'RELEASED');
  });

  test('a delivered line is NOT silently rewritten by an SO controlled change', async () => {
    const uom = db.prepare("SELECT base_uom_code FROM products WHERE id='product-001'").get().base_uom_code;
    const created = await http('/api/sales-orders', {
      token: tokens.sales, method: 'POST', key: 'res-exec-order',
      body: {
        customerId: 'customer-001', orderDate: '2026-10-20', requestedDeliveryDate: '2026-10-25',
        items: [{ productId: 'product-001', uomCode: uom, quantityDecimal: '10' }],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const orderId = created.data.id;
    const itemId = created.data.itemIds[0];

    await http(`/api/sales-orders/${orderId}/submit`, { token: tokens.sales, method: 'POST', key: 'res-exec-submit', body: {} });
    const approved = await http(`/api/sales-orders/${orderId}/approve`, { token: tokens.reviewer, method: 'POST', key: 'res-exec-approve', body: {} });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));

    const requested = await http('/api/sales-reservation-intents', {
      token: tokens.sales, method: 'POST',
      body: {
        salesOrderId: orderId, salesOrderItemId: itemId, productId: 'product-001',
        warehouseId: 'warehouse-001', quantity: 10, reservationMode: 'INVENTORY_LOCK', businessDate: '2026-10-20',
      },
    });
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    const intentId = requested.data.id;
    const granted = await http(`/api/sales-reservation-intents/${intentId}/grant`, {
      token: tokens.sales, method: 'POST', body: { grantedQty: 10 },
    });
    assert.equal(granted.status, 200, JSON.stringify(granted.data));
    const consumed = await http(`/api/sales-reservation-intents/${intentId}/consume`, {
      token: tokens.sales, method: 'POST', body: { quantity: 4, consumerEvent: 'DELIVERY_CONFIRMED' },
    });
    assert.equal(consumed.status, 200, JSON.stringify(consumed.data));
    assert.equal(consumed.data.consumedQty, 4);

    // The line carries a confirmed Delivery: the obligation is executed for
    // 4 EA. A change that goes below that floor is refused by the SO change
    // writer, and the reservation must not be rewritten either way.
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,status,delivery_date,warehouse_id,handler_id,total_cents,created_at,updated_at,creator_id)
      VALUES('del-http','SD-HTTP',?,'customer-001','CONFIRMED','2026-10-20','warehouse-001','user-admin',4000,?,?,'user-admin')`).run(orderId, now, now);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,sales_order_item_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('sdi-http','del-http',?,'product-001',4,1000,4000,1)`).run(itemId);

    // 10 EA -> 2 EA is below the 4 EA executed floor: the change is refused.
    const refused = await http(`/api/sales-orders/${orderId}/controlled-change`, {
      token: tokens.sales, method: 'POST', key: 'res-exec-change-low',
      body: {
        reasonCode: 'CUSTOMER_REQUEST', reason: '客户下调数量',
        lines: [{ op: 'MODIFY', salesOrderItemId: itemId, quantityMicros: 2_000_000 }],
      },
    });
    assert.notEqual(refused.status, 201, JSON.stringify(refused.data));

    // The executed portion of the reservation is untouched.
    const afterRefusal = db.prepare('SELECT * FROM sales_reservation_intent WHERE id=?').get(intentId);
    assert.equal(afterRefusal.intent_state, 'GRANTED');
    assert.equal(Number(afterRefusal.consumed_qty), 4);
    assert.equal(Number(afterRefusal.requested_qty), 10);
    assert.equal(db.prepare('SELECT * FROM inventory_locks WHERE id=?').get(afterRefusal.inventory_lock_id).status, 'ACTIVE');
    assert.equal(db.prepare('SELECT reservation_intent_state FROM sales_orders WHERE id=?').get(orderId).reservation_intent_state, 'GRANTED');
  });
});
