import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import {
  createConsignmentDocumentCommand, createConsignmentLocationCommand,
  getConsignmentReturnPositionReferences, instructConsignmentCommand,
  resolveConsignmentHandoffEvidence,
} from './modules/consignment.js';
import { createServiceFulfillmentCommand, confirmServiceFulfillmentCommand } from './modules/service-fulfillment.js';
import { createCommercialCreditNote, createSalesInvoice, postSalesInvoice } from './modules/commercial-golive.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = join(repoRoot, 'scripts', 'gates', 'mysql-concurrency-sales-wave8-worker.mjs');
const DAY = '2026-10-20';
const actor = { id: 'wave8-race-actor', roleCode: 'ADMIN', isSystemAdmin: true, permissions: [] };
const captureResponse = () => ({
  statusCode: 0, headers: {}, body: null,
  setHeader(name, value) { this.headers[name] = value; },
  end(value) { this.body = value ? JSON.parse(value) : null; },
});

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
  }
  run(command) {
    const id = randomUUID();
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} timeout: ${this.stderr}`)), 30_000);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command })}\n`);
    });
  }
  async close() { try { await this.run({ action: 'close' }); } catch {} try { this.child.stdin.end(); } catch {} }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitAtGate(db, ids) {
  for (let index = 0; index < 400; index += 1) {
    const waiting = ids.map((id) => db.prepare('SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=?').get(id));
    if (waiting.every((row) => String(row?.INFO || '').toUpperCase().includes('MYSQL_TRANSACTION_GATES'))) return true;
    sleep(25);
  }
  return false;
}

async function race(db, leftCommand, rightCommand) {
  const left = new Worker('wave8-left'); const right = new Worker('wave8-right'); const control = new Worker('wave8-control'); let held = false;
  try {
    const [l, r] = await Promise.all([left.run({ action: 'register' }), right.run({ action: 'register' })]);
    assert.notEqual(l.connectionId, r.connectionId);
    await control.run({ action: 'hold-gate' }); held = true;
    const pending = [left.run(leftCommand), right.run(rightCommand)];
    assert.equal(waitAtGate(db, [l.connectionId, r.connectionId]), true, 'both Wave 8 transactions must overlap');
    await control.run({ action: 'release-gate' }); held = false;
    return Promise.all(pending);
  } finally {
    if (held) { try { await control.run({ action: 'release-gate' }); } catch {} }
    await Promise.all([left.close(), right.close(), control.close()]);
  }
}

// Runs two independent sessions with a controlled acquisition order. The adapter's
// global transaction gate serializes MySQL work, so "who wins" is decided by which
// session reaches the gate first. Both commands are legal when issued: each starts
// from the line version the other has not yet consumed.
async function raceInOrder(db, firstCommand, secondCommand) {
  const first = new Worker('wave8-first'); const second = new Worker('wave8-second');
  try {
    const [f, s] = await Promise.all([first.run({ action: 'register' }), second.run({ action: 'register' })]);
    assert.notEqual(f.connectionId, s.connectionId);
    const firstResult = await first.run(firstCommand);
    const secondResult = await second.run(secondCommand);
    return [firstResult, secondResult];
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

async function independentConcurrent(leftCommand, rightCommand) {
  const left = new Worker('wave8-independent-left'); const right = new Worker('wave8-independent-right');
  try {
    const [l, r] = await Promise.all([left.run({ action: 'register' }), right.run({ action: 'register' })]);
    assert.notEqual(l.connectionId, r.connectionId);
    return Promise.all([left.run(leftCommand), right.run(rightCommand)]);
  } finally {
    await Promise.all([left.close(), right.close()]);
  }
}

// Every economic layer a consignment race can touch, so a blocked party can be
// shown to have committed nothing rather than merely returned 409.
function consignmentFootprint(db, lineId) {
  const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE id=?').get(lineId);
  const entitlement = line.handoff_movement_group_id
    ? resolveConsignmentHandoffEvidence(db, lineId).reduce((sum, partition) => sum + partition.remainingMicros, 0)
    : null;
  const count = (sql, ...params) => Number(db.prepare(sql).get(...params).n);
  const sum = (sql, ...params) => Number(db.prepare(sql).get(...params).n);
  // §35.18.7 gives each settlement and return an immutable `CS:`/`CR:` prefixed
  // event identity, which scopes every downstream row back to this line.
  const event = (prefix) => `${prefix}:${lineId}:%`;
  return {
    settledMicros: Number(line.settled_qty_micros),
    returnedMicros: Number(line.returned_qty_micros),
    commercialRemainingMicros: Number(line.consigned_qty_micros) - Number(line.settled_qty_micros) - Number(line.returned_qty_micros),
    partitionRemainingMicros: entitlement,
    siteMicros: Math.round(sum("SELECT COALESCE(SUM(quantity),0) n FROM inventory WHERE product_id='w8-race-p' AND warehouse_id='w8-race-site'") * 1_000_000),
    returnMicros: Math.round(sum("SELECT COALESCE(SUM(quantity),0) n FROM inventory WHERE product_id='w8-race-p' AND warehouse_id='w8-race-return'") * 1_000_000),
    settlementTransactions: count("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='CONSIGNMENT_SETTLEMENT' AND source_id LIKE ?", event('CS')),
    returnTransactions: count("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='CONSIGNMENT_RETURN' AND source_id LIKE ?", event('CR')),
    trackedMovements: count("SELECT COUNT(*) n FROM tracked_inventory_movements WHERE source_item_id=?", lineId),
    valuationMovementCents: sum("SELECT COALESCE(SUM(value_delta_cents),0) n FROM inventory_valuation_movements WHERE (source_id LIKE ? OR source_id LIKE ?)", event('CS'), event('CR')),
    cogsVouchers: count("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='CONSIGNMENT_SETTLEMENT_COGS' AND source_id LIKE ?", event('CS')),
    settlementVouchers: count("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='CONSIGNMENT_SETTLEMENT' AND source_id LIKE ?", event('CS')),
    financeOpenItems: count("SELECT COUNT(*) n FROM account_receivables WHERE source_type='CONSIGNMENT_SETTLEMENT' AND source_id LIKE ?", event('CS')),
    auditRows: count("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CONSIGNMENT_LINE' AND entity_id=?", lineId),
    idempotencyRows: count("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='CONSIGNMENT_SETTLEMENT' AND document_id=?", lineId),
  };
}

describe('Sales & Customer Wave 8 — real MySQL concurrency', () => {
  let handle; let db; let location; let stamp;
  before(() => {
    handle = createTempDb({ label: 'sales-customer-wave8-concurrency', production: true }); db = handle.db; assert.equal(db.dialect, 'mysql'); stamp = new Date().toISOString();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,'role-admin',1,?)`)
      .run(actor.id, actor.id, 'Wave 8 Race', 'x', 'x', stamp);
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('w8-race-c','W8-RC','Wave 8 Race','','','',1,?,?)`).run(stamp, stamp);
    for (const [id, code] of [['w8-race-source','W8-RS'],['w8-race-site','W8-RC'],['w8-race-return','W8-RR']]) db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,'','',1,?,?)`).run(id, code, code, stamp, stamp);
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
      VALUES('w8-race-p','W8-RP','Wave 8 Race Product','','EA',100,0,1,?,?,'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')`).run(stamp, stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,active,created_at,updated_at,created_by,updated_by)
      VALUES('w8-race-pc','w8-race-p',1,0,1,?,?,?,?)`).run(stamp, stamp, actor.id, actor.id);
    db.prepare(`INSERT INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at)
      VALUES('w8-race-service-policy','AR','SERVICE_FULFILLMENT',NULL,'DIRECT_BUSINESS_OPEN_ITEM','2020-01-01',1,?,?)`).run(actor.id, stamp);
    upsertCanonicalInventory(db, { warehouseId: 'w8-race-source', productId: 'w8-race-p', quantity: 20, position: {}, rowId: 'w8-race-inv' });
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at)
      VALUES('NONE:w8-race-source:w8-race-p','MOVING_AVERAGE','w8-race-p','w8-race-source',20,2000,?)`).run(stamp);
    location = createConsignmentLocationCommand(db, { locationCode: 'RACE', customerId: 'w8-race-c', name: 'Race Site', physicalWarehouseId: 'w8-race-site', effectiveFrom: DAY }, actor, 'w8-race-location');
  });
  after(() => handle?.cleanup());

  function handedOffLine(suffix, quantityMicros) {
    const document = createConsignmentDocumentCommand(db, { customerId: 'w8-race-c', sourceWarehouseId: 'w8-race-source', businessDate: DAY, currencyCode: 'CNY', lines: [{ productId: 'w8-race-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: quantityMicros, unitPriceCents: 100 }] }, actor, `w8-doc-${suffix}`);
    const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=?').get(document.id);
    instructConsignmentCommand(db, document.id, { expectedVersion: 1, businessDate: DAY, allocations: [{ lineId: line.id, quantityMicros, fromPosition: { productId: 'w8-race-p', warehouseId: 'w8-race-source', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' } }] }, actor, `w8-handoff-${suffix}`);
    return line.id;
  }

  function serviceInvoice(suffix, { posted = false } = {}) {
    const productId = `w8-race-svc-${suffix}`; const orderId = `w8-race-so-${suffix}`; const orderItemId = `w8-race-soi-${suffix}`;
    db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy)
      VALUES(?,?,?,'EA',100,0,1,?,?,'EA','NONE')`).run(productId, `W8-SVC-${suffix}`, `Wave 8 Service ${suffix}`, stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,1,1,'STANDARD',1,?,?,?,?)`).run(`w8-race-svcc-${suffix}`, productId, stamp, stamp, actor.id, actor.id);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date)
      VALUES(?,?, 'w8-race-c','APPROVED',100,?,?,?,?)`).run(orderId, `W8-SO-${suffix}`, actor.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_quantity_num,document_quantity_den)
      VALUES(?,?,?,1,100,100,1,1000000,1000000)`).run(orderItemId, orderId, productId);
    const fulfillment = createServiceFulfillmentCommand(db, { salesOrderItemId: orderItemId, confirmationQtyMicros: 1_000_000, businessDate: DAY }, actor, `w8-race-sf-create-${suffix}`);
    confirmServiceFulfillmentCommand(db, fulfillment.id, 1, actor, `w8-race-sf-confirm-${suffix}`);
    const deliveryId = `w8-race-delivery-${suffix}`; const deliveryItemId = `w8-race-delivery-item-${suffix}`;
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
      VALUES(?,?,?,'w8-race-c','w8-race-source',?,100,'CONFIRMED',?,'',?,?,?,?,?)`)
      .run(deliveryId, `W8-D-${suffix}`, orderId, actor.id, DAY, actor.id, stamp, stamp, stamp, actor.id);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no,sales_order_item_id,document_uom_code,document_quantity_num,document_quantity_den,base_quantity_num,base_quantity_den)
      VALUES(?,?,?,1,100,100,1,?,'EA',1,1,1,1)`).run(deliveryItemId, deliveryId, productId, orderItemId);
    const invoice = createSalesInvoice(db, { customerId: 'w8-race-c', invoiceDate: DAY, taxMode: 'NO_TAX', actorId: actor.id,
      idempotencyKey: `w8-race-invoice-create-${suffix}`, items: [{ deliveryItemId, quantityNumerator: 1, quantityDenominator: 1, unitPriceCents: 100 }] });
    return posted ? postSalesInvoice(db, invoice.id, actor.id) : invoice;
  }

  function creditFor(invoice, suffix, grossCents = 40) {
    return createCommercialCreditNote(db, {
      side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents,
      actorId: actor.id, idempotencyKey: `w8-race-credit-${suffix}`,
    });
  }

  function creditFootprint(noteId, invoiceId) {
    const note = db.prepare('SELECT status,gross_cents FROM commercial_credit_notes WHERE id=?').get(noteId);
    const invoice = db.prepare('SELECT status,credited_amount_cents,remaining_creditable_amount_cents,credit_state FROM sales_invoices WHERE id=?').get(invoiceId);
    const adjustments = db.prepare(`SELECT status,amount_cents,reversed_cents FROM financial_credit_adjustments
      WHERE source_type='SALES_CREDIT_NOTE' AND (source_id=? OR source_id LIKE ?) ORDER BY id`).all(noteId, `${noteId}:%`);
    return {
      note, invoice, adjustments,
      reversalVouchers: Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_CREDIT_NOTE_REVERSAL' AND source_id=?").get(noteId).n),
      audits: Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='COMMERCIAL_CREDIT_NOTE' AND entity_id=? AND action='REVERSE'").get(noteId).n),
      idempotency: Number(db.prepare("SELECT COUNT(*) n FROM idempotency_records WHERE operation_type='COMMERCIAL_CREDIT_REVERSAL' AND document_id=?").get(noteId).n),
    };
  }

  test('R-SAL-20 settlement × settlement serializes on one commercial line', async () => {
    const lineId = handedOffLine('r20', 2_000_000);
    const command = (key) => ({ action: 'settle-consignment', id: lineId, key, body: { quantityMicros: 2_000_000, expectedVersion: 2, businessDate: DAY } });
    const results = await race(db, command('r20-a'), command('r20-b'));
    assert.equal(results.filter((result) => result.status === 200).length, 1); assert.equal(results.filter((result) => result.status === 409).length, 1);
    const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE id=?').get(lineId); assert.equal(Number(line.settled_qty_micros), 2_000_000); assert.equal(Number(line.returned_qty_micros), 0);
  });

  test('R-SAL-21 legal settlement × return shares the same line capacity anchor', async () => {
    const lineId = handedOffLine('r21', 2_000_000);
    const results = await race(db,
      { action: 'settle-consignment', id: lineId, key: 'r21-settle', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY } },
      { action: 'return-consignment', id: lineId, key: 'r21-return', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY, destinationWarehouseId: 'w8-race-return' } });
    assert.ok(results.every((result) => [200, 409].includes(result.status)));
    const state = consignmentFootprint(db, lineId);
    assert.equal(state.settledMicros + state.returnedMicros, 1_000_000, 'exactly one party commits');
    assert.equal(state.commercialRemainingMicros, 1_000_000);
    assert.equal(state.partitionRemainingMicros, 1_000_000, 'commercial and partition entitlement agree after the race');
  });

  test('R-SAL-21a a winning settlement legally blocks the return and leaves it with zero committed effects', async () => {
    const lineId = handedOffLine('r21a', 2_000_000);
    const before = consignmentFootprint(db, lineId);
    const [settled, returned] = await raceInOrder(db,
      { action: 'settle-consignment', id: lineId, key: 'r21a-settle', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY } },
      { action: 'return-consignment', id: lineId, key: 'r21a-return', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY, destinationWarehouseId: 'w8-race-return' } });
    assert.equal(settled.status, 200);
    assert.equal(returned.status, 409, 'the return is blocked by the version the settlement consumed');

    const state = consignmentFootprint(db, lineId);
    assert.equal(state.settledMicros, 1_000_000);
    assert.equal(state.returnedMicros, 0, 'the blocked return committed nothing');
    assert.equal(state.returnTransactions, 0);
    assert.equal(state.returnMicros - before.returnMicros, 0, 'no stock arrived at the return warehouse');
    assert.equal(state.commercialRemainingMicros, 1_000_000);
    assert.equal(state.partitionRemainingMicros, 1_000_000);
    assert.equal(state.siteMicros - before.siteMicros, -1_000_000, 'the settlement issued exactly its own quantity');
    assert.equal(state.settlementTransactions, 1);
    assert.equal(state.financeOpenItems, 1, 'the winning settlement produced exactly one AR open item');
    assert.equal(state.cogsVouchers, 1);
    assert.equal(state.settlementVouchers, 1);
    assert.equal(state.auditRows, 1, 'only the winner wrote audit evidence');
    assert.equal(state.idempotencyRows, 1, 'only the winner recorded idempotency');
  });

  test('R-SAL-21b a winning return legally blocks the settlement and leaves it with zero committed effects', async () => {
    const lineId = handedOffLine('r21b', 2_000_000);
    const before = consignmentFootprint(db, lineId);
    const [returned, settled] = await raceInOrder(db,
      { action: 'return-consignment', id: lineId, key: 'r21b-return', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY, destinationWarehouseId: 'w8-race-return' } },
      { action: 'settle-consignment', id: lineId, key: 'r21b-settle', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY } });
    assert.equal(returned.status, 200);
    assert.equal(settled.status, 409, 'the settlement is blocked by the version the return consumed');

    const state = consignmentFootprint(db, lineId);
    assert.equal(state.returnedMicros, 1_000_000);
    assert.equal(state.settledMicros, 0, 'the blocked settlement committed nothing');
    assert.equal(state.settlementTransactions, 0);
    assert.equal(state.cogsVouchers, 0, 'no COGS for stock that never left');
    assert.equal(state.settlementVouchers, 0);
    assert.equal(state.financeOpenItems, 0, 'an unsettled return must not create AR');
    assert.equal(state.commercialRemainingMicros, 1_000_000);
    assert.equal(state.partitionRemainingMicros, 1_000_000);
    assert.equal(state.returnTransactions, 2, 'a MOVE writes one OUT and one IN leg');
    assert.equal(state.returnMicros - before.returnMicros, 1_000_000);
    assert.equal(state.siteMicros - before.siteMicros, -1_000_000);
    assert.equal(state.auditRows, 1, 'only the winner wrote audit evidence');
    assert.equal(state.idempotencyRows, 0, 'a return records no settlement idempotency');
  });

  test('B5 a destination deactivated after reference GET fails closed on an independent connection', async () => {
    const lineId = handedOffLine('b5-inactive', 1_000_000);
    const documentId = db.prepare('SELECT document_id FROM consignment_commercial_lines WHERE id=?').get(lineId).document_id;
    const response = captureResponse();
    getConsignmentReturnPositionReferences(db, response, actor, documentId, lineId);
    assert.equal(response.statusCode, 200);
    assert.ok(response.body.warehouses.some((row) => row.id === 'w8-race-return'));
    const before = consignmentFootprint(db, lineId);
    db.prepare("UPDATE warehouses SET active=0 WHERE id='w8-race-return'").run();
    try {
      const [result] = await independentConcurrent(
        { action: 'return-consignment', id: lineId, key: 'b5-inactive-return', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY, destinationWarehouseId: 'w8-race-return' } },
        { action: 'register' },
      );
      assert.equal(result.status, 409);
      assert.equal(result.code, 'CONSIGNMENT_RETURN_DESTINATION_INVALID');
      assert.deepEqual(consignmentFootprint(db, lineId), before, 'stale inactive destination has zero effects');
    } finally {
      db.prepare("UPDATE warehouses SET active=1 WHERE id='w8-race-return'").run();
    }
  });

  test('B5 a destination reclassified as Supplier-WIP after reference GET fails closed on an independent connection', async () => {
    const lineId = handedOffLine('b5-wip', 1_000_000);
    const documentId = db.prepare('SELECT document_id FROM consignment_commercial_lines WHERE id=?').get(lineId).document_id;
    const response = captureResponse();
    getConsignmentReturnPositionReferences(db, response, actor, documentId, lineId);
    assert.equal(response.statusCode, 200);
    assert.ok(response.body.warehouses.some((row) => row.id === 'w8-race-return'));
    const before = consignmentFootprint(db, lineId);
    db.prepare("UPDATE warehouses SET is_supplier_wip=1 WHERE id='w8-race-return'").run();
    try {
      const [result] = await independentConcurrent(
        { action: 'return-consignment', id: lineId, key: 'b5-wip-return', body: { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY, destinationWarehouseId: 'w8-race-return' } },
        { action: 'register' },
      );
      assert.equal(result.status, 409);
      assert.equal(result.code, 'CONSIGNMENT_RETURN_DESTINATION_INVALID');
      assert.deepEqual(consignmentFootprint(db, lineId), before, 'stale Supplier-WIP destination has zero effects');
    } finally {
      db.prepare("UPDATE warehouses SET is_supplier_wip=0 WHERE id='w8-race-return'").run();
    }
  });

  test('R-SAL-22 service confirmations cannot exceed the shared SO-line capacity', async () => {
    db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy) VALUES('w8-race-svc','W8-RSVC','Wave 8 Service','EA',100,0,1,?,?,'EA','NONE')`).run(stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by) VALUES('w8-race-svcc','w8-race-svc',1,1,'STANDARD',1,?,?,?,?)`).run(stamp, stamp, actor.id, actor.id);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date) VALUES('w8-race-so','W8-RSO','w8-race-c','APPROVED',200,?,?,?,?)`).run(actor.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_quantity_num,document_quantity_den) VALUES('w8-race-soi','w8-race-so','w8-race-svc',2,100,200,1,2000000,1)`).run();
    for (const suffix of ['a','b']) db.prepare(`INSERT INTO service_fulfillments(id,fulfillment_no,sales_order_id,sales_order_item_id,product_id,customer_id,confirmation_qty_micros,unit_price_cents,recognition_amount_cents,business_date,confirmation_state,version,created_at,updated_at,created_by,updated_by) VALUES(?,?, 'w8-race-so','w8-race-soi','w8-race-svc','w8-race-c',2000000,100,0,?,'PENDING',1,?,?,?,?)`).run(`w8-race-sf-${suffix}`, `W8-RSF-${suffix}`, DAY, stamp, stamp, actor.id, actor.id);
    const results = await race(db,
      { action: 'confirm-service', id: 'w8-race-sf-a', version: 1, key: 'r22-a' },
      { action: 'confirm-service', id: 'w8-race-sf-b', version: 1, key: 'r22-b' });
    assert.equal(results.filter((result) => result.status === 200).length, 1); assert.equal(results.filter((result) => result.status === 409).length, 1);
    assert.equal(Number(db.prepare("SELECT COALESCE(SUM(confirmation_qty_micros),0) n FROM service_fulfillments WHERE sales_order_item_id='w8-race-soi' AND confirmation_state='CONFIRMED'").get().n), 2_000_000);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SERVICE_FULFILLMENT'").get().n), 1);
  });

  test('A3 invoice POST/POST is replay-safe with one immutable source-link set', async () => {
    const invoice = serviceInvoice('a3-post-post');
    const results = await race(db, { action: 'post-invoice', id: invoice.id }, { action: 'post-invoice', id: invoice.id });
    assert.equal(results.filter((result) => result.status === 200).length, 2);
    assert.equal(db.prepare('SELECT status FROM sales_invoices WHERE id=?').get(invoice.id).status, 'POSTED');
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM finance_invoice_source_links WHERE invoice_id=?').get(invoice.id).n), 1);
  });

  test('A3 invoice POST/VOID has only a legal serialized lifecycle', async () => {
    const invoice = serviceInvoice('a3-post-void');
    const results = await race(db, { action: 'post-invoice', id: invoice.id }, { action: 'void-invoice', id: invoice.id, reason: 'A3 POST/VOID race' });
    const status = db.prepare('SELECT status FROM sales_invoices WHERE id=?').get(invoice.id).status;
    assert.ok(['POSTED', 'REVERSED'].includes(status));
    assert.equal(results.filter((result) => result.status === 200).length, status === 'REVERSED' ? 2 : 1);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM finance_invoice_source_links WHERE invoice_id=?').get(invoice.id).n), 1);
  });

  test('A3 Credit/Credit cannot exceed immutable service invoice capacity', async () => {
    const invoice = serviceInvoice('a3-credit-credit', { posted: true });
    const command = (key) => ({ action: 'credit-invoice', body: { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 60, idempotencyKey: key } });
    const results = await race(db, command('w8-a3-credit-a'), command('w8-a3-credit-b'));
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(results.filter((result) => result.status === 409).length, 1);
    assert.equal(Number(db.prepare("SELECT COALESCE(SUM(gross_cents),0) n FROM commercial_credit_notes WHERE source_id=? AND status='POSTED'").get(invoice.id).n), 60);
  });

  test('A3 Credit/VOID resolves to exactly one legal economic transition', async () => {
    const invoice = serviceInvoice('a3-credit-void', { posted: true });
    const results = await race(db,
      { action: 'credit-invoice', body: { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 40, idempotencyKey: 'w8-a3-credit-void' } },
      { action: 'void-invoice', id: invoice.id, reason: 'A3 Credit/VOID race' });
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.equal(results.filter((result) => result.status === 409).length, 1);
    const final = db.prepare('SELECT status,credit_state FROM sales_invoices WHERE id=?').get(invoice.id);
    assert.ok((final.status === 'POSTED' && final.credit_state === 'PARTIAL') || (final.status === 'REVERSED' && final.credit_state === 'NONE'));
  });

  test('R1 Reversal/Reversal uses independent connections and commits one exact reversal effect', async () => {
    const invoice = serviceInvoice('r1-reverse-reverse', { posted: true });
    const note = creditFor(invoice, 'reverse-reverse', 40);
    const command = (key) => ({ action: 'reverse-credit', id: note.id, key, body: { reversalDate: DAY, reason: '并发冲销' } });
    const results = await race(db, command('w8-r1-rr-a'), command('w8-r1-rr-b'));
    assert.equal(results.filter((row) => row.status === 200).length, 1);
    assert.equal(results.filter((row) => row.status === 409).length, 1);
    const state = creditFootprint(note.id, invoice.id);
    assert.equal(state.note.status, 'REVERSED');
    assert.equal(state.invoice.credit_state, 'NONE');
    assert.equal(Number(state.invoice.credited_amount_cents), 0);
    assert.ok(state.adjustments.every((row) => row.status === 'REVERSED' && Number(row.reversed_cents) === Number(row.amount_cents)));
    assert.deepEqual({ vouchers: state.reversalVouchers, audits: state.audits, idempotency: state.idempotency }, { vouchers: 1, audits: 1, idempotency: 1 });
  });

  test('R1 exact replay is single-effect and different-payload replay conflicts', async () => {
    const invoice = serviceInvoice('r1-replay', { posted: true });
    const note = creditFor(invoice, 'replay', 40);
    const exact = { action: 'reverse-credit', id: note.id, key: 'w8-r1-replay', body: { reversalDate: DAY, reason: '同一请求' } };
    // Replay may complete from the frozen pre-transaction idempotency reader and
    // therefore is not required to wait at the transaction gate. It is still sent
    // concurrently through two verified independent MySQL connections.
    const results = await independentConcurrent(exact, exact);
    assert.equal(results.filter((row) => row.status === 200).length, 2);
    assert.ok(results.some((row) => row.data?.replayed === true));
    const conflict = await raceInOrder(db, exact, { ...exact, body: { reversalDate: DAY, reason: '不同请求' } });
    assert.equal(conflict[1].status, 409);
    const state = creditFootprint(note.id, invoice.id);
    assert.deepEqual({ vouchers: state.reversalVouchers, audits: state.audits, idempotency: state.idempotency }, { vouchers: 1, audits: 1, idempotency: 1 });
  });

  test('R1 Reversal/Credit Creation conserves invoice and every Finance layer', async () => {
    const invoice = serviceInvoice('r1-reverse-create', { posted: true });
    const note = creditFor(invoice, 'reverse-create-original', 40);
    const results = await race(db,
      { action: 'reverse-credit', id: note.id, key: 'w8-r1-reverse-create', body: { reversalDate: DAY, reason: '冲销原贷项' } },
      { action: 'credit-invoice', body: { side: 'AR', sourceId: invoice.id, creditDate: DAY, grossCents: 60, idempotencyKey: 'w8-r1-create-concurrent' } });
    assert.ok(results.every((row) => row.status === 200), JSON.stringify(results));
    const state = creditFootprint(note.id, invoice.id);
    assert.equal(state.note.status, 'REVERSED');
    assert.equal(state.invoice.credit_state, 'PARTIAL');
    assert.equal(Number(state.invoice.credited_amount_cents), 60);
    assert.equal(Number(state.invoice.remaining_creditable_amount_cents), 40);
    assert.deepEqual({ vouchers: state.reversalVouchers, audits: state.audits, idempotency: state.idempotency }, { vouchers: 1, audits: 1, idempotency: 1 });
  });

  test('R1 Reversal/Invoice VOID leaves one legal terminal composition with no loser effects', async () => {
    const invoice = serviceInvoice('r1-reverse-void', { posted: true });
    const note = creditFor(invoice, 'reverse-void', 40);
    const results = await race(db,
      { action: 'reverse-credit', id: note.id, key: 'w8-r1-reverse-void', body: { reversalDate: DAY, reason: '冲销后允许作废' } },
      { action: 'void-invoice', id: invoice.id, reason: '并发作废' });
    assert.equal(results.filter((row) => row.status === 200).length >= 1, true);
    assert.ok(results.every((row) => [200, 409].includes(row.status)));
    const state = creditFootprint(note.id, invoice.id);
    assert.equal(state.note.status, 'REVERSED');
    assert.equal(state.invoice.credit_state, 'NONE');
    assert.equal(Number(state.invoice.credited_amount_cents), 0);
    assert.ok(['POSTED', 'REVERSED'].includes(state.invoice.status));
    assert.deepEqual({ vouchers: state.reversalVouchers, audits: state.audits, idempotency: state.idempotency }, { vouchers: 1, audits: 1, idempotency: 1 });
  });
});
