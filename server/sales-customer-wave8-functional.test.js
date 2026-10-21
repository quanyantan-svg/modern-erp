import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createDatabase, hashPassword } from './db.js';
import { buildCanonicalPosition, canonicalPositionSnapshot, parseCanonicalPositionSnapshot } from './lib/inventory-position.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import {
  createConsignmentDocumentCommand, createConsignmentLocationCommand,
  getConsignmentHandoffPositionReferences, getConsignmentReturnPositionReferences,
  instructConsignmentCommand, resolveConsignmentHandoffEvidence,
  returnConsignmentLineCommand, settleConsignmentLineCommand,
} from './modules/consignment.js';
import { cancelServiceFulfillmentCommand, confirmServiceFulfillmentCommand, createServiceFulfillmentCommand } from './modules/service-fulfillment.js';
import { createCommercialCreditNote } from './modules/commercial-golive.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const DAY = '2026-10-20';
const actor = { id: 'user-sales', roleCode: 'SALES', permissions: ['SALES_VIEW', 'SALES_MANAGE', 'CONSIGNMENT_VIEW', 'CONSIGNMENT_MANAGE', 'SERVICE_SALES_VIEW', 'SERVICE_SALES_MANAGE'] };
const captureResponse = () => ({
  statusCode: 0, headers: {}, body: null,
  setHeader(name, value) { this.headers[name] = value; },
  end(value) { this.body = value ? JSON.parse(value) : null; },
});

describe('Wave 8 V21 evidence and Consignment closure', () => {
  let dir; let db;
  beforeEach(() => {
    const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    dir = mkdtempSync(join(tmpdir(), 'modern-erp-wave8-')); db = createDatabase(join(dir, 'erp.db'));
    if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior;
    const stamp = new Date().toISOString();
    const credentials = hashPassword('wave8-test-password');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-sales',1,?)`).run(actor.id, 'wave8-sales', 'Wave 8 Sales', credentials.hash, credentials.salt, stamp);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('w8-c','W8-C','Wave 8 Customer','','','',1,?,?)").run(stamp, stamp);
    for (const [id, code] of [['w8-source','W8-S'],['w8-site','W8-CONS'],['w8-return','W8-R']]) {
      db.prepare('INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,\'\',\'\',1,?,?)').run(id, code, code, stamp, stamp);
    }
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
      VALUES('w8-p','W8-P','Wave 8 Product','','EA',200,0,1,?,?,'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')`).run(stamp, stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,service_classification,active,created_at,updated_at,created_by,updated_by)
      VALUES('w8-pc','w8-p',1,NULL,NULL,0,1,?,?,?,?)`).run(stamp, stamp, actor.id, actor.id);
    upsertCanonicalInventory(db, { warehouseId: 'w8-source', productId: 'w8-p', quantity: 10, position: {}, rowId: 'w8-inv' });
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at)
      VALUES('NONE:w8-source:w8-p','MOVING_AVERAGE','w8-p','w8-source',10,1000,?)`).run(stamp);
  });
  afterEach(() => { try { db?.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  test('Position Snapshot V1 is byte-canonical and rejects tampering', () => {
    const position = buildCanonicalPosition(db, { productId: 'w8-p', warehouseId: 'w8-source', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' });
    const json = canonicalPositionSnapshot(position);
    assert.deepEqual(parseCanonicalPositionSnapshot(json), JSON.parse(json));
    assert.throws(() => parseCanonicalPositionSnapshot(json.replace(position.positionKey, '0'.repeat(64))), /hash mismatch/);
    assert.throws(() => parseCanonicalPositionSnapshot(json.replace('{', '{"extra":1,')), /shape mismatch/);
  });

  test('Consignment handoff persists exact immutable evidence, replay is exact, and settle/return consume historical partitions', () => {
    const location = createConsignmentLocationCommand(db, { locationCode: 'SITE-A', customerId: 'w8-c', name: 'Customer Site A', physicalWarehouseId: 'w8-site', effectiveFrom: DAY }, actor, 'w8-location-create');
    const document = createConsignmentDocumentCommand(db, { customerId: 'w8-c', sourceWarehouseId: 'w8-source', businessDate: DAY, currencyCode: 'CNY', lines: [
      { productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 5_000_000, unitPriceCents: 200 },
    ] }, actor, 'create-1');
    const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=?').get(document.id);
    const handoffInput = { expectedVersion: 1, businessDate: DAY, allocations: [{ lineId: line.id, quantityMicros: 5_000_000,
      fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } }] };
    assert.equal(instructConsignmentCommand(db, document.id, handoffInput, actor, 'handoff-1').status, 'INSTRUCTED');
    assert.equal(instructConsignmentCommand(db, document.id, handoffInput, actor, 'handoff-1').replayed, true);
    const evidence = resolveConsignmentHandoffEvidence(db, line.id);
    assert.equal(evidence.length, 1); assert.equal(evidence[0].remainingMicros, 5_000_000); assert.equal(evidence[0].position.warehouseId, 'w8-site');
    const persisted = db.prepare("SELECT * FROM inventory_mutation_log WHERE source_type='CONSIGNMENT_HANDOFF'").get();
    assert.match(persisted.request_fingerprint, /^V1:[0-9a-f]{64}$/); assert.ok(persisted.out_inventory_transaction_id); assert.ok(persisted.in_inventory_transaction_id);
    assert.throws(() => db.prepare('UPDATE inventory_mutation_log SET source_id=\'tampered\' WHERE id=?').run(persisted.id), /IMMUTABLE/);

    const settled = settleConsignmentLineCommand(db, line.id, { quantityMicros: 2_000_000, expectedVersion: 2, businessDate: DAY }, actor, 'settle-1');
    assert.equal(settled.amountCents, 400); assert.ok(settled.financeOpenItemId);
    const returned = returnConsignmentLineCommand(db, line.id, { quantityMicros: 1_000_000, expectedVersion: 3, businessDate: DAY, destinationWarehouseId: 'w8-return' }, actor, 'return-1');
    assert.equal(returned.returnAmountCents, 200);
    const after = db.prepare('SELECT * FROM consignment_commercial_lines WHERE id=?').get(line.id);
    assert.equal(Number(after.settled_qty_micros), 2_000_000); assert.equal(Number(after.returned_qty_micros), 1_000_000);
    assert.equal(resolveConsignmentHandoffEvidence(db, line.id)[0].remainingMicros, 2_000_000);
    assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE product_id='w8-p' AND warehouse_id='w8-site'").get().quantity), 2);
    assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE product_id='w8-p' AND warehouse_id='w8-return'").get().quantity), 1);
  });

  test('SALES position references disclose only bounded fields and Return permits only active non-WIP enterprise destinations', () => {
    const stamp = new Date().toISOString();
    for (const [id, code, binEnabled, supplierWip] of [
      ['w8-wip', 'W8-WIP', 0, 1], ['w8-bin-empty', 'W8-B0', 1, 0], ['w8-bin', 'W8-B1', 1, 0],
    ]) {
      db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at,bin_enabled,is_supplier_wip)
        VALUES(?,?,?,'','',1,?,?,?,?)`).run(id, code, code, stamp, stamp, binEnabled, supplierWip);
    }
    db.prepare(`INSERT INTO warehouse_bins(id,warehouse_id,code,name,active,created_at,updated_at)
      VALUES('w8-bin-a','w8-bin','A','Bin A',1,?,?)`).run(stamp, stamp);
    const location = createConsignmentLocationCommand(db, { locationCode: 'REF', customerId: 'w8-c', name: 'Reference Site', physicalWarehouseId: 'w8-site', effectiveFrom: DAY }, actor, 'ref-location');
    const document = createConsignmentDocumentCommand(db, { customerId: 'w8-c', sourceWarehouseId: 'w8-source', businessDate: DAY, currencyCode: 'CNY', lines: [
      { productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 2_000_000, unitPriceCents: 200 },
    ] }, actor, 'ref-document');
    const line = db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=?').get(document.id);

    const handoffRes = captureResponse();
    getConsignmentHandoffPositionReferences(db, handoffRes, actor, document.id);
    assert.equal(handoffRes.statusCode, 200);
    assert.deepEqual(Object.keys(handoffRes.body).sort(), ['bins', 'context', 'purpose', 'warehouse']);
    assert.deepEqual(Object.keys(handoffRes.body.warehouse).sort(), ['binEnabled', 'code', 'id', 'name']);
    assert.equal(handoffRes.body.warehouse.id, 'w8-source');

    instructConsignmentCommand(db, document.id, { expectedVersion: 1, businessDate: DAY, allocations: [{
      lineId: line.id, quantityMicros: 2_000_000,
      fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE' },
    }] }, actor, 'ref-handoff');

    const returnRes = captureResponse();
    getConsignmentReturnPositionReferences(db, returnRes, actor, document.id, line.id);
    assert.equal(returnRes.statusCode, 200);
    assert.deepEqual(Object.keys(returnRes.body).sort(), ['context', 'purpose', 'warehouses']);
    const ids = returnRes.body.warehouses.map((row) => row.id);
    assert.ok(ids.includes('w8-return') && ids.includes('w8-bin'));
    assert.ok(!ids.includes('w8-wip'), 'Supplier-WIP is not a B5 enterprise Return destination');
    assert.ok(!ids.includes('w8-bin-empty'), 'a bin-enabled warehouse without an active bin is not selectable');
    const binned = returnRes.body.warehouses.find((row) => row.id === 'w8-bin');
    assert.deepEqual(Object.keys(binned).sort(), ['binEnabled', 'bins', 'code', 'id', 'name']);
    assert.deepEqual(Object.keys(binned.bins[0]).sort(), ['code', 'id', 'name', 'warehouseId']);
    assert.equal('is_supplier_wip' in binned, false);

    const before = db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE source_type='CONSIGNMENT_RETURN'").get().n;
    assert.throws(() => returnConsignmentLineCommand(db, line.id, {
      quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY, destinationWarehouseId: 'w8-wip',
    }, actor, 'ref-return-wip'), (error) => error.status === 409 && error.code === 'CONSIGNMENT_RETURN_DESTINATION_INVALID');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE source_type='CONSIGNMENT_RETURN'").get().n, before);

    const returned = returnConsignmentLineCommand(db, line.id, {
      quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY,
      destinationWarehouseId: 'w8-bin', destinationBinId: 'w8-bin-a',
    }, actor, 'ref-return-cross-warehouse');
    assert.equal(returned.returnAmountCents, 200);
  });

  test('Consignment idempotency conflicts and legacy evidence fail closed without a second movement', () => {
    const from = { productId: 'w8-p', warehouseId: 'w8-source', binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null };
    const to = { ...from, warehouseId: 'w8-site' };
    const base = { db, actor, sourceType: 'CONSIGNMENT_HANDOFF', sourceId: 'doc', sourceItemId: 'line', movementKind: 'MOVE', quantity: 1,
      quantityMicros: 1_000_000, fromPosition: from, toPosition: to, businessDate: DAY, movementGroupId: 'group', idempotencyKey: 'mutation-key',
      trackingMode: 'CANONICAL_STRICT', valuationMode: 'EXTERNAL', valuationPolicy: 'HANDOFF_VALUE_NEUTRAL_V1', commercialAmountCents: null };
    const first = applyInventoryMutation(base); assert.equal(first.replayed, false);
    const replay = applyInventoryMutation(base); assert.equal(replay.replayed, true); assert.equal(replay.mutationId, first.mutationId);
    assert.throws(() => applyInventoryMutation({ ...base, quantity: 2, quantityMicros: 2_000_000 }), (error) => error.code === 'INVENTORY_MUTATION_IDEMPOTENCY_CONFLICT');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_mutation_log WHERE idempotency_key='mutation-key'").get().n, 1);
  });

  test('Service confirmations conserve capacity and multi-source Credit follows immutable invoice links', () => {
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy)
      VALUES('w8-service','W8-SVC','Wave 8 Service','','EA',151,0,1,?,?,'EA','NONE')`).run(stamp, stamp);
    db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
      VALUES('w8-service-c','w8-service',1,1,'STANDARD',1,?,?,?,?)`).run(stamp, stamp, actor.id, actor.id);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date)
      VALUES('w8-so','W8-SO','w8-c','APPROVED',302,?,?,?,?)`).run(actor.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_quantity_num,document_quantity_den)
      VALUES('w8-soi','w8-so','w8-service',2,151,302,1,2000000,1)`).run();
    db.prepare(`INSERT INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at)
      VALUES('w8-service-policy','AR','SERVICE_FULFILLMENT',NULL,'DIRECT_BUSINESS_OPEN_ITEM','2020-01-01',1,?,?)`).run(actor.id, stamp);
    const first = createServiceFulfillmentCommand(db, { salesOrderItemId: 'w8-soi', confirmationQtyMicros: 1_000_000, businessDate: DAY }, actor, 'service-create-1');
    const second = createServiceFulfillmentCommand(db, { salesOrderItemId: 'w8-soi', confirmationQtyMicros: 1_000_000, businessDate: DAY }, actor, 'service-create-2');
    assert.equal(confirmServiceFulfillmentCommand(db, first.id, 1, actor, 'service-confirm-1').recognitionAmountCents, 151);
    assert.equal(confirmServiceFulfillmentCommand(db, second.id, 1, actor, 'service-confirm-2').recognitionAmountCents, 151);
    assert.throws(() => cancelServiceFulfillmentCommand(db, first.id, 2, actor, 'service-cancel-confirmed'), (error) => error.code === 'SERVICE_FULFILLMENT_CONFIRMED_IMMUTABLE');
    db.prepare(`INSERT INTO sales_invoices(id,invoice_no,customer_id,invoice_date,status,tax_mode,net_cents,tax_cents,gross_cents,tax_snapshot_json,creator_id,created_at,posted_by,posted_at,remaining_creditable_amount_cents)
      VALUES('w8-si','W8-SI','w8-c',?,'POSTED','NO_TAX',302,0,302,'[]',?,?,?,?,302)`).run(DAY, actor.id, stamp, actor.id, stamp);
    const addLink = db.prepare(`INSERT INTO finance_invoice_source_links(id,invoice_id,invoice_side,source_type,source_id,source_line_id,invoiced_quantity,invoiced_amount_cents,created_at)
      VALUES(?,'w8-si','SALES_INVOICE','SERVICE_FULFILLMENT',?,?,1000000,151,?)`);
    addLink.run('w8-link-1', first.id, first.id, stamp); addLink.run('w8-link-2', second.id, second.id, stamp);
    createCommercialCreditNote(db, { side: 'AR', sourceId: 'w8-si', creditDate: DAY, grossCents: 151, actorId: actor.id, idempotencyKey: 'w8-credit-1' });
    createCommercialCreditNote(db, { side: 'AR', sourceId: 'w8-si', creditDate: DAY, grossCents: 151, actorId: actor.id, idempotencyKey: 'w8-credit-2' });
    const allocations = db.prepare("SELECT target_open_item_id,SUM(amount_cents) amount FROM financial_credit_adjustments WHERE source_type='SALES_CREDIT_NOTE' GROUP BY target_open_item_id ORDER BY target_open_item_id").all();
    assert.equal(allocations.length, 2); assert.equal(allocations.reduce((sum, row) => sum + Number(row.amount), 0), 302);
    assert.ok(allocations.every((row) => Number(row.amount) === 151));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM finance_invoice_source_links WHERE invoice_id='w8-si'").get().n, 2);
  });
});
