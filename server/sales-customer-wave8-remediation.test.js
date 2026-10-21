// Wave 8 — P0/P1 remediation reproduction and closure tests.
//
// Each test here reproduces one independent-audit counterexample against the
// approved §35.18 / §35.19 contracts. They are not a re-run of the Stage D
// functional suite; they exist because the original suite was green while the
// audited defects were live.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createDatabase, hashPassword } from './db.js';
import {
  consignmentReport, createConsignmentDocumentCommand, createConsignmentLocationCommand,
  instructConsignmentCommand, listConsignmentDocuments, resolveConsignmentHandoffEvidence,
  returnConsignmentLineCommand, settleConsignmentLineCommand,
} from './modules/consignment.js';
import { authorizeSalesPrepaymentGateWithPlan, discoverSalesPrepaymentGatePlan } from './modules/sales-prepayment-gate.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const DAY = '2026-10-20';
const SALES = ['SALES_VIEW', 'SALES_MANAGE', 'CONSIGNMENT_VIEW', 'CONSIGNMENT_MANAGE'];

function actorWith(permissions, id = 'user-sales') {
  return { id, roleCode: 'SALES', permissions };
}

describe('Wave 8 P0/P1 remediation', () => {
  let dir; let db;
  const sales = actorWith(SALES);

  beforeEach(() => {
    const prior = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    dir = mkdtempSync(join(tmpdir(), 'modern-erp-wave8-fix-'));
    db = createDatabase(join(dir, 'erp.db'));
    if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior;
    const stamp = new Date().toISOString();
    const credentials = hashPassword('wave8-remediation-password');
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES(?,?,?,?,?,'role-sales',1,?)`).run(sales.id, 'w8fix-sales', 'Wave 8 Fix Sales', credentials.hash, credentials.salt, stamp);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('w8-c','W8-C','Wave 8 Customer','','','',1,?,?)").run(stamp, stamp);
    for (const [id, code, binEnabled] of [['w8-source', 'W8-SRC', 1], ['w8-source-b', 'W8-SRC-B', 0], ['w8-site', 'W8-SITE', 1], ['w8-return', 'W8-RET', 0]]) {
      db.prepare('INSERT INTO warehouses(id,code,name,address,manager,active,bin_enabled,created_at,updated_at) VALUES(?,?,?,\'\',\'\',1,?,?,?)').run(id, code, code, binEnabled, stamp, stamp);
    }
    db.prepare("INSERT INTO warehouse_bins(id,warehouse_id,code,name,active,created_at,updated_at) VALUES('w8-bin-a','w8-source','A','Bin A',1,?,?),('w8-bin-b','w8-source','B','Bin B',1,?,?),('w8-site-bin','w8-site','S1','Site bin',1,?,?)").run(stamp, stamp, stamp, stamp, stamp, stamp);
    for (const [id, code, tracking] of [['w8-p', 'W8-P', 'NONE'], ['w8-lot-p', 'W8-LOT-P', 'LOT'], ['w8-ser-p', 'W8-SER-P', 'SERIAL']]) {
      db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
        VALUES(?,?,?,\'\','EA',200,0,1,?,?,'EA',?,'MOVING_AVERAGE',?,'FINISHED_GOOD')`).run(id, code, code, stamp, stamp, tracking, stamp);
      db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,service_classification,active,created_at,updated_at,created_by,updated_by)
        VALUES(?,?,1,NULL,NULL,0,1,?,?,?,?)`).run(`${id}-c`, id, stamp, stamp, sales.id, sales.id);
    }
    seedStock('w8-source', 'w8-p', 40, { binId: 'w8-bin-a' });
    seedStock('w8-source-b', 'w8-p', 40, { binId: null });
    seedStock('w8-source', 'w8-p', 10, { binId: 'w8-bin-b' });
  });

  afterEach(() => { try { db?.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  function seedStock(warehouseId, productId, quantity, position = {}, rowId = null) {
    const id = rowId || `${warehouseId}-${productId}-${position.binId || 'nb'}`;
    upsertCanonicalInventory(db, { warehouseId, productId, quantity, position, rowId: id });
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at)
      VALUES(?,'MOVING_AVERAGE',?,?,?,?,?) ON CONFLICT(balance_key) DO UPDATE SET quantity=excluded.quantity,value_cents=excluded.value_cents`)
      .run(`NONE:${warehouseId}:${productId}`, productId, warehouseId, quantity, quantity * 100, new Date().toISOString());
  }

  function makeLocation(code, warehouseId, binId) {
    return createConsignmentLocationCommand(db, {
      locationCode: code, customerId: 'w8-c', name: code, physicalWarehouseId: warehouseId, physicalBinId: binId, effectiveFrom: DAY,
    }, sales, `loc-${code}`);
  }

  function makeDocument(key, lines, { sourceWarehouseId = 'w8-source' } = {}) {
    return createConsignmentDocumentCommand(db, {
      customerId: 'w8-c', sourceWarehouseId, businessDate: DAY, currencyCode: 'CNY', lines,
    }, sales, key);
  }

  function instruct(documentId, lineId, quantityMicros, key, allocations) {
    return instructConsignmentCommand(db, documentId, {
      expectedVersion: 1, businessDate: DAY,
      allocations: allocations || [{ lineId, quantityMicros, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', binId: 'w8-bin-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } }],
    }, sales, key);
  }

  function lineOf(documentId) { return db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=?').get(documentId); }

  // Full economic footprint of a consignment line, used to prove that a refused
  // settlement leaves nothing behind anywhere.
  function footprint() {
    return {
      line: db.prepare('SELECT * FROM consignment_commercial_lines').all(),
      mutationLog: db.prepare('SELECT * FROM inventory_mutation_log').all(),
      inventory: db.prepare('SELECT * FROM inventory').all(),
      valuation: db.prepare('SELECT * FROM inventory_valuation_movements').all(),
      tracking: db.prepare('SELECT * FROM tracked_inventory_movements').all(),
      vouchers: db.prepare('SELECT * FROM accounting_vouchers').all(),
      receivables: db.prepare('SELECT * FROM account_receivables').all(),
      audit: db.prepare('SELECT * FROM audit_logs').all(),
      idempotency: db.prepare('SELECT * FROM idempotency_records').all(),
    };
  }

  // ---------------------------------------------------------------- P0-1 ---

  test('P0-1 zero-unit-price settlement is refused before any stock leaves the consignment site', () => {
    const location = makeLocation('ZERO', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-zero', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 5_000_000, unitPriceCents: 0 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 5_000_000, 'handoff-zero');

    const before = footprint();
    assert.throws(
      () => settleConsignmentLineCommand(db, line.id, { quantityMicros: 2_000_000, expectedVersion: 2, businessDate: DAY }, sales, 'settle-zero'),
      (error) => error.code === 'CONSIGNMENT_SETTLEMENT_AMOUNT_NOT_POSITIVE' && error.status === 409,
    );
    assert.deepEqual(footprint(), before, 'a zero-amount settlement must leave no commercial, inventory, tracking, valuation, COGS, AR, audit or idempotency residue');

    const onHand = Number(db.prepare("SELECT quantity FROM inventory WHERE product_id='w8-p' AND warehouse_id='w8-site'").get().quantity);
    assert.equal(onHand, 5, 'consigned stock must still sit at the customer site');
    assert.equal(Number(db.prepare("SELECT COALESCE(SUM(quantity_delta),0) v FROM inventory_valuation_movements WHERE source_type='CONSIGNMENT_SETTLEMENT'").get().v), 0);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='CONSIGNMENT_SETTLEMENT'").get().n), 0);
  });

  test('P0-1 a positive settlement is still accepted and conserves every layer', () => {
    const location = makeLocation('POS', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-pos', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 5_000_000, unitPriceCents: 200 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 5_000_000, 'handoff-pos');
    const settled = settleConsignmentLineCommand(db, line.id, { quantityMicros: 2_000_000, expectedVersion: 2, businessDate: DAY }, sales, 'settle-pos');
    assert.equal(settled.amountCents, 400);
    assert.ok(settled.financeOpenItemId);
    assert.equal(Number(db.prepare("SELECT quantity FROM inventory WHERE product_id='w8-p' AND warehouse_id='w8-site'").get().quantity), 3);
  });

  test('P0-1 a sub-cent-zero allocation after a partial settlement is refused and stays refused', () => {
    // 3 units at 1 cent each => 3 cents total. Two whole-unit settlements consume
    // 1 cent each; the next half-unit settlement's cumulative difference is 0.
    const location = makeLocation('SUB', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-sub', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 3_000_000, unitPriceCents: 1 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 3_000_000, 'handoff-sub');
    assert.equal(settleConsignmentLineCommand(db, line.id, { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY }, sales, 'sub-1').amountCents, 1);
    assert.equal(settleConsignmentLineCommand(db, line.id, { quantityMicros: 1_000_000, expectedVersion: 3, businessDate: DAY }, sales, 'sub-2').amountCents, 1);

    const before = footprint();
    assert.throws(
      () => settleConsignmentLineCommand(db, line.id, { quantityMicros: 500_000, expectedVersion: 4, businessDate: DAY }, sales, 'sub-3'),
      (error) => error.code === 'CONSIGNMENT_SETTLEMENT_AMOUNT_NOT_POSITIVE',
    );
    assert.deepEqual(footprint(), before);
    assert.equal(Number(db.prepare('SELECT settled_qty_micros FROM consignment_commercial_lines WHERE id=?').get(line.id).settled_qty_micros), 2_000_000);
  });

  // ---------------------------------------------------------------- P0-2 ---

  function seedSalesOrder({ id, itemId, quantity = 4, unitPriceCents = 200, amountCents = 800, conversion = [1, 1], discount = null }) {
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date)
      VALUES(?,?,?,'APPROVED',?,?,?,?,?)`).run(id, `SO-${id}`, 'w8-c', amountCents, sales.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,
      document_uom_code,document_quantity_num,document_quantity_den,conversion_numerator,conversion_denominator,
      base_quantity_num,base_quantity_den,discount_snapshot_json)
      VALUES(?,?,?,?,?,?,1,'EA',?,1000000,?,?,?,?,?)`).run(itemId, id, 'w8-p', quantity, unitPriceCents, amountCents,
      quantity * 1_000_000, conversion[0], conversion[1], quantity * 1_000_000 * conversion[0], 1_000_000 * conversion[1], discount);
  }

  test('P0-2 an SO-backed consignment line must carry the approved net unit price', () => {
    seedSalesOrder({ id: 'w8-so', itemId: 'w8-soi', quantity: 4, unitPriceCents: 200, amountCents: 800 });
    const location = makeLocation('SOBAD', 'w8-site', 'w8-site-bin');
    assert.throws(
      () => makeDocument('create-so-tamper', [{ salesOrderItemId: 'w8-soi', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 199 }]),
      (error) => error.code === 'CONSIGNMENT_SALES_ORDER_BASIS_MISMATCH',
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM consignment_commercial_documents').get().n, 0, 'a rejected document must not persist');
    const accepted = makeDocument('create-so-ok', [{ salesOrderItemId: 'w8-soi', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 2_000_000, unitPriceCents: 200 }]);
    assert.equal(lineOf(accepted.id).unit_price_cents, 200);
  });

  test('P0-2 non-1:1 sales UOM and non-representable net amounts fail closed as unrepresentable', () => {
    const location = makeLocation('SOUOM', 'w8-site', 'w8-site-bin');
    seedSalesOrder({ id: 'w8-so-uom', itemId: 'w8-soi-uom', quantity: 4, conversion: [6, 1] });
    assert.throws(
      () => makeDocument('create-so-uom', [{ salesOrderItemId: 'w8-soi-uom', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 200 }]),
      (error) => error.code === 'CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE' && error.details.reason === 'SALES_UOM_NOT_ONE_TO_ONE',
    );

    seedSalesOrder({ id: 'w8-so-frac', itemId: 'w8-soi-frac', quantity: 3, unitPriceCents: 100, amountCents: 301 });
    assert.throws(
      () => makeDocument('create-so-frac', [{ salesOrderItemId: 'w8-soi-frac', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 100 }]),
      (error) => error.code === 'CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE' && error.details.reason === 'NET_UNIT_PRICE_NOT_INTEGER_CENTS',
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM consignment_commercial_documents').get().n, 0);
  });

  test('P0-2 the approved discount snapshot must agree with the source amount it prices', () => {
    const location = makeLocation('SODISC', 'w8-site', 'w8-site-bin');
    seedSalesOrder({
      id: 'w8-so-disc', itemId: 'w8-soi-disc', quantity: 4, unitPriceCents: 250, amountCents: 800,
      discount: JSON.stringify({ contractVersion: 'ORDER_DISCOUNT_SNAPSHOT_V1', finalAmountCents: 900 }),
    });
    assert.throws(
      () => makeDocument('create-so-disc', [{ salesOrderItemId: 'w8-soi-disc', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 200 }]),
      (error) => error.code === 'CONSIGNMENT_COMMERCIAL_BASIS_UNREPRESENTABLE' && error.details.reason === 'DISCOUNT_SNAPSHOT_DISAGREES_WITH_SOURCE_AMOUNT',
    );
  });

  test('P0-2 SO-backed consignment may not exceed the remaining approved source capacity', () => {
    seedSalesOrder({ id: 'w8-so-cap', itemId: 'w8-soi-cap', quantity: 2, unitPriceCents: 200, amountCents: 400 });
    const location = makeLocation('SOCAP', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-so-cap', [{ salesOrderItemId: 'w8-soi-cap', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 2_000_000, unitPriceCents: 200 }]);
    assert.ok(document.id);
    assert.throws(
      () => makeDocument('create-so-cap-2', [{ salesOrderItemId: 'w8-soi-cap', productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 200 }]),
      (error) => error.code === 'CONSIGNMENT_SOURCE_CAPACITY_EXCEEDED',
    );
  });

  // -------------------------------------------------- partition entitlement ---

  test('two source bins handing off into one destination Position consume that bucket once', () => {
    const location = makeLocation('MULTI', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-multi', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 6_000_000, unitPriceCents: 100 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 6_000_000, 'handoff-multi', [
      { lineId: line.id, quantityMicros: 4_000_000, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', binId: 'w8-bin-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } },
      { lineId: line.id, quantityMicros: 2_000_000, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', binId: 'w8-bin-b', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } },
    ]);

    const evidence = resolveConsignmentHandoffEvidence(db, line.id);
    assert.equal(evidence.length, 1, 'both handoffs land in one destination Position and therefore one entitlement bucket');
    assert.equal(evidence[0].handedOffMicros, 6_000_000, 'the bucket holds the summed handoff quantity');
    assert.equal(evidence[0].mutationIds.length, 2, 'both immutable handoff mutations remain individually inspectable');
    assert.equal(evidence[0].remainingMicros, 6_000_000);

    settleConsignmentLineCommand(db, line.id, { quantityMicros: 4_000_000, expectedVersion: 2, businessDate: DAY }, sales, 'multi-settle');
    returnConsignmentLineCommand(db, line.id, { quantityMicros: 1_000_000, expectedVersion: 3, businessDate: DAY, destinationWarehouseId: 'w8-return' }, sales, 'multi-return');

    const after = resolveConsignmentHandoffEvidence(db, line.id);
    assert.equal(after.length, 1);
    assert.equal(after[0].remainingMicros, 1_000_000, '5 of 6 units consumed once, not twice');
    assert.equal(Number(db.prepare('SELECT settled_qty_micros FROM consignment_commercial_lines WHERE id=?').get(line.id).settled_qty_micros), 4_000_000);
  });

  test('two consignment lines sharing one destination Position keep independent entitlement', () => {
    // Two distinct commercial locations that map to the SAME physical warehouse/bin,
    // so both lines hand off into one destination Position.
    const locationA = makeLocation('SHARED-A', 'w8-site', 'w8-site-bin');
    const locationB = makeLocation('SHARED-B', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-shared', [
      { productId: 'w8-p', consignmentCommodityLocationId: locationA.id, consignedQtyMicros: 2_000_000, unitPriceCents: 100 },
      { productId: 'w8-p', consignmentCommodityLocationId: locationB.id, consignedQtyMicros: 3_000_000, unitPriceCents: 100 },
    ]);
    const [first, second] = db.prepare('SELECT * FROM consignment_commercial_lines WHERE document_id=? ORDER BY line_no').all(document.id);
    instructConsignmentCommand(db, document.id, { expectedVersion: 1, businessDate: DAY, allocations: [
      { lineId: first.id, quantityMicros: 2_000_000, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', binId: 'w8-bin-a', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } },
      { lineId: second.id, quantityMicros: 3_000_000, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source', binId: 'w8-bin-b', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } },
    ] }, sales, 'handoff-shared');

    const firstEvidence = resolveConsignmentHandoffEvidence(db, first.id);
    const secondEvidence = resolveConsignmentHandoffEvidence(db, second.id);
    assert.equal(firstEvidence[0].positionKey, secondEvidence[0].positionKey, 'both lines resolve to the same physical Position');
    assert.equal(firstEvidence[0].handedOffMicros, 2_000_000);
    assert.equal(secondEvidence[0].handedOffMicros, 3_000_000);

    settleConsignmentLineCommand(db, first.id, { quantityMicros: 2_000_000, expectedVersion: 2, businessDate: DAY }, sales, 'shared-settle');
    assert.equal(resolveConsignmentHandoffEvidence(db, first.id)[0].remainingMicros, 0);
    assert.equal(resolveConsignmentHandoffEvidence(db, second.id)[0].remainingMicros, 3_000_000, 'the second line keeps its own full entitlement');
  });

  test('settlement beyond partition entitlement fails closed even when commercial stock remains', () => {
    const location = makeLocation('OVER', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-over', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 4_000_000, unitPriceCents: 100 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 4_000_000, 'handoff-over');
    const before = footprint();
    assert.throws(
      () => settleConsignmentLineCommand(db, line.id, { quantityMicros: 5_000_000, expectedVersion: 2, businessDate: DAY }, sales, 'over-settle'),
      (error) => error.code === 'CONSIGNMENT_CAPACITY_EXCEEDED',
    );
    assert.deepEqual(footprint(), before);
  });

  // ---------------------------------------------------- handoff warehouse ---

  test('a handoff sourced from outside the declared source warehouse fails closed before V21', () => {
    const location = makeLocation('SRCMIX', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-srcmix', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 100 }]);
    const line = lineOf(document.id);
    const before = footprint();
    assert.throws(
      () => instruct(document.id, line.id, 1_000_000, 'handoff-srcmix', [{ lineId: line.id, quantityMicros: 1_000_000, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source-b', binId: null, ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } }]),
      (error) => error.code === 'CONSIGNMENT_SOURCE_WAREHOUSE_MISMATCH',
    );
    assert.deepEqual(footprint(), before, 'no V21 MOVE, no evidence row, no document state change');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory WHERE product_id='w8-p' AND warehouse_id='w8-site'").get().n, 0);
  });

  test('a handoff bin that does not belong to the declared source warehouse fails closed', () => {
    const location = makeLocation('BINMIX', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-binmix', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 100 }]);
    const line = lineOf(document.id);
    assert.throws(
      () => instruct(document.id, line.id, 1_000_000, 'handoff-binmix', [{ lineId: line.id, quantityMicros: 1_000_000, fromPosition: { productId: 'w8-p', warehouseId: 'w8-source-b', binId: 'w8-site-bin', ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE', lotId: null, serialId: null } }]),
      (error) => error.code === 'CONSIGNMENT_SOURCE_WAREHOUSE_MISMATCH',
    );
  });

  // ------------------------------------------------------ three-layer report ---

  test('the three-layer report reports a real physical discrepancy instead of RESOLVED', () => {
    const location = makeLocation('REPORT', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-report', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 3_000_000, unitPriceCents: 100 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 3_000_000, 'handoff-report');

    const res = fakeResponse();
    consignmentReport(db, res, sales);
    const healthy = JSON.parse(res.body).rows;
    assert.equal(healthy.length, 1);
    assert.equal(healthy[0].physicalEvidenceState, 'RESOLVED', `unexpected discrepancy: ${healthy[0].physicalEvidenceDiscrepancy}`);
    assert.equal(healthy[0].physicalEvidenceDiscrepancy, null);
    assert.equal(healthy[0].partitionEntitlementMicros, 3_000_000);

    // Inject an inspectable physical shortfall at the consigned Position.
    db.prepare("UPDATE inventory SET quantity=1 WHERE product_id='w8-p' AND warehouse_id='w8-site'").run();
    const brokenRes = fakeResponse();
    consignmentReport(db, brokenRes, sales);
    const broken = JSON.parse(brokenRes.body).rows;
    assert.equal(broken[0].physicalEvidenceState, 'DISCREPANCY');
    assert.equal(broken[0].physicalEvidenceDiscrepancy, 'PHYSICAL_BALANCE_BELOW_PARTITION_ENTITLEMENT');
    assert.equal(broken[0].lineId, line.id);
  });

  // ----------------------------------------------------------------- RBAC ---

  test('CONSIGNMENT_VIEW alone can read but cannot mutate; SALES_MANAGE can read without SALES_VIEW', () => {
    const location = makeLocation('RBAC', 'w8-site', 'w8-site-bin');
    const document = makeDocument('create-rbac', [{ productId: 'w8-p', consignmentCommodityLocationId: location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 100 }]);
    const line = lineOf(document.id);
    instruct(document.id, line.id, 1_000_000, 'handoff-rbac');

    const viewer = actorWith(['SALES_VIEW', 'CONSIGNMENT_VIEW', 'CONSIGNMENT_MANAGE'], 'user-view');
    assert.throws(
      () => settleConsignmentLineCommand(db, line.id, { quantityMicros: 1_000_000, expectedVersion: 2, businessDate: DAY }, viewer, 'rbac-mutate'),
      (error) => error.status === 403,
      'CONSIGNMENT_MANAGE without SALES_MANAGE must not mutate',
    );

    const managerOnly = actorWith(['SALES_MANAGE', 'CONSIGNMENT_VIEW', 'CONSIGNMENT_MANAGE'], 'user-manage');
    const listRes = fakeResponse();
    listConsignmentDocuments(db, listRes, managerOnly);
    assert.equal(JSON.parse(listRes.body).documents.length, 1, 'SALES_MANAGE alone satisfies the read gate');

    const stranger = actorWith(['SALES_VIEW'], 'user-stranger');
    assert.throws(() => listConsignmentDocuments(db, fakeResponse(), stranger), (error) => error.status === 403);
  });

  // -------------------------------------------------------------- C1 locks ---

  test('C1 authorization locks the Finance PREPAYMENT parents before any Gate row', () => {
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,
      original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
      VALUES('w8-b2','CUSTOMER','PREPAYMENT','w8-c','SALES_RECEIPT','rcpt-2','RC2',5000,?,NULL,'OPEN',?,?),
             ('w8-b1','CUSTOMER','PREPAYMENT','w8-c','SALES_RECEIPT','rcpt-1','RC1',5000,?,NULL,'OPEN',?,?)`).run(DAY, sales.id, stamp, DAY, sales.id, stamp);
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date)
      VALUES('w8-gate-so','W8-GATE-SO','w8-c','APPROVED',800,?,?,?,?)`).run(sales.id, stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_prepayment_requirements(id,sales_order_id,line_no,required_amount_cents,ratio_basis,effective_from,effective_to,created_at,created_by)
      VALUES('w8-req','w8-gate-so',0,9000,'ORDER_VALUE',NULL,NULL,?,?)`).run(stamp, sales.id);
    db.prepare(`INSERT INTO sales_prepayment_gate_results(id,sales_order_id,stage,gate_decision,required_remaining_cents,
      eligible_advance_cents,refunded_amount_cents,applied_amount_cents,override_reason,overridden_by,source_balance_identities,snapshot_key,evaluated_at,evaluated_by)
      VALUES('w8-gate-res','w8-gate-so','DELIVERY','PASS',9000,10000,0,0,NULL,NULL,'[]','seed',?,?)`).run(stamp, sales.id);

    // Discovery is unlocked and returns candidate parents in stable id ASC order.
    const plan = discoverSalesPrepaymentGatePlan(db, 'w8-gate-so', DAY);
    assert.deepEqual(plan.parentBalanceIds, ['w8-b1', 'w8-b2']);

    // The MySQL adapter serializes every transaction behind one global gate row, so a
    // timing race cannot evidence lock ORDER. The order is therefore asserted on the
    // literal FOR UPDATE statements the helper emits.
    const probe = mysqlLockProbe(db);
    const outcome = authorizeSalesPrepaymentGateWithPlan(probe, plan, { stage: 'DELIVERY', actorId: sales.id, mutationKey: 'lock-order-probe' });
    assert.equal(outcome.state, 'PASS');

    const locks = probe.locks;
    const parentLocks = locks.filter((entry) => /settlement_unapplied_balances/.test(entry.sql) && /WHERE id=\?/.test(entry.sql));
    const gateResultLocks = locks.filter((entry) => /sales_prepayment_gate_results/.test(entry.sql) && /LIMIT 1/.test(entry.sql));
    const requirementLocks = locks.filter((entry) => /sales_prepayment_requirements/.test(entry.sql) && /WHERE id=\?/.test(entry.sql));
    assert.ok(parentLocks.length >= 2, 'both candidate parents are locked individually');
    assert.equal(gateResultLocks.length, 1);
    assert.equal(requirementLocks.length, 1);

    const at = (list) => locks.indexOf(list[0]);
    assert.ok(at(parentLocks) < at(gateResultLocks), 'Finance PREPAYMENT parents lock before the Gate result row');
    assert.ok(at(parentLocks) < at(requirementLocks), 'Finance PREPAYMENT parents lock before the Gate requirement row');
    assert.deepEqual(parentLocks.slice(0, 2).map((entry) => entry.args[0]), ['w8-b1', 'w8-b2'], 'parents are locked in stable id ASC order');

    const inserted = db.prepare(`INSERT INTO settlement_unapplied_balances(id,side,balance_type,party_id,source_type,source_id,source_no,
      original_amount_cents,business_date,settlement_account_id,status,created_by,created_at)
      VALUES('w8-b3','CUSTOMER','PREPAYMENT','w8-c','SALES_RECEIPT','rcpt-3','RC3',1000,?,NULL,'OPEN',?,?)`).run(DAY, sales.id, stamp);
    assert.equal(inserted.changes, 1);
    assert.throws(
      () => authorizeSalesPrepaymentGateWithPlan(probe, plan, { stage: 'DELIVERY', actorId: sales.id, mutationKey: 'lock-order-stale' }),
      (error) => error.code === 'SALES_PREPAYMENT_LOCK_PLAN_STALE',
      'a changed candidate set rolls back and asks the caller to retry from discovery',
    );
  });
});

// The MySQL adapter serializes every transaction behind one global gate row, so a
// timing race cannot evidence lock ORDER. This probe presents the helper with the
// MySQL dialect — so it really emits FOR UPDATE — records every locking statement
// with its bound identity, and executes the equivalent unlocked statement so the
// assertions still run against real rows.
function mysqlLockProbe(db) {
  const locks = [];
  return {
    get dialect() { return 'mysql'; },
    get isTransaction() { return db.isTransaction; },
    locks,
    prepare(sql) {
      const locking = /FOR UPDATE/.test(sql);
      const runnable = sql.replace(/\s*FOR UPDATE/g, '');
      const statement = db.prepare(runnable);
      const bind = (method) => (...args) => {
        if (locking) locks.push({ sql, args });
        return statement[method](...args);
      };
      return { get: bind('get'), all: bind('all'), run: bind('run') };
    },
    exec: (sql) => db.exec(sql),
  };
}

function fakeResponse() {
  return { statusCode: 0, payload: null, body: '{}', setHeader() {}, end(chunk) { if (chunk !== undefined) this.body = String(chunk); } };
}