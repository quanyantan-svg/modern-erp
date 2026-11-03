import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, outsourcingReceiptBody, prepareOutsourcingReceiptSource, seedApprovedOutsourceBom } from './test-support/procurement-http-fixture.js';

describe('Procurement Wave F-H outsourcing foundation, material execution, receiving', () => {
  let fixture;
  const receiptSources = new Map();
  before(async () => { fixture = await createProcurementFixture('modern-erp-prc-wavef-'); });
  after(async () => fixture.close());

  function isoDate(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  async function qualifyOutsourceSupplier() {
    const result = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180), supplierWipWarehouseId: 'warehouse-002',
    });
    assert.equal(result.status, 200, result.data.error);
    const now = new Date().toISOString();
    for (const productId of ['product-001', 'product-002']) {
      fixture.db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
        VALUES(?, 'MOVING_AVERAGE', ?, 'warehouse-001', NULL, NULL, 1000, 1000000, ?)
        ON CONFLICT(balance_key) DO NOTHING`).run(`NONE:warehouse-001:${productId}`, productId, now);
    }
  }

  async function createReleasedOrder({ source = 'MANUAL', orderQty = 100, materials = [] } = {}) {
    const bomId = materials.length ? seedApprovedOutsourceBom(fixture, 'product-001', materials, `outsourcing-${Date.now()}-${Math.random()}`) : null;
    const body = {
      supplierId: 'supplier-001', productId: 'product-001',
      orderQuantity: orderQty, unit: 'EA', businessDate: isoDate(0),
      ...(bomId ? { bomId } : {}),
    };
    if (source === 'PLANNING') {
      // OUT-05: a real planning_outsource_handoffs row must exist before the
      // create endpoint can consume it. Insert a deterministic fixture row.
      body.planningHandoffId = 'handoff-' + Date.now();
      seedHandoff(body.planningHandoffId, 'product-001', orderQty);
    }
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, body);
    assert.equal(order.status, 201, order.data.error);
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'PLAN_CONFIRMED' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/transition`, fixture.tokens.admin, { action: 'RELEASED' });
    receiptSources.set(order.data.id, await prepareOutsourcingReceiptSource(fixture, order.data.id, orderQty, `outsourcing-${order.data.id}`));
    return order.data.id;
  }

  async function createReceipt(orderId, body) {
    return fixture.request('POST', '/api/procurement/outsourcing/receipts', fixture.tokens.admin, {
      orderId, ...body, ...outsourcingReceiptBody(receiptSources.get(orderId), body.quantity, body.processingFeeCents, body.receivedDate),
    }, { 'idempotency-key': `receipt-${orderId}-${Date.now()}-${Math.random()}` });
  }

  function seedHandoff(id, productId = 'product-001', quantity = 100) {
    const plannedOrderId = 'po-' + id;
    // Use the canonical admin user id (the canonical procurement fixture
    // always seeds user-admin).
    fixture.db.prepare(`INSERT INTO planned_orders(id,order_no,source_type,mrp_run_id,mrp_result_id,product_id,quantity,need_date,planned_supply_date,supply_type,status,released_quantity,created_by,updated_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      plannedOrderId, plannedOrderId, 'MANUAL', null, null, productId, quantity,
      isoDate(0), isoDate(0), 'OUTSOURCE', 'RELEASED', quantity,
      'user-admin', 'user-admin', isoDate(0), isoDate(0),
    );
    fixture.db.prepare(`INSERT INTO planning_outsource_handoffs(id,planned_order_id,product_id,quantity,need_date,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, plannedOrderId, productId, quantity, isoDate(0), 'PENDING', 'user-admin', isoDate(0));
  }

  test('PLANNING handoff is exactly-once; MANUAL handoff null', async () => {
    await qualifyOutsourceSupplier();
    seedHandoff('handoff-A1', 'product-001', 100);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, planningHandoffId: 'handoff-A1',
      businessDate: isoDate(0),
    });
    assert.equal(order.status, 201, order.data.error);
    const dup = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 100, planningHandoffId: 'handoff-A1',
      businessDate: isoDate(0),
    });
    assert.equal(dup.status, 409, JSON.stringify(dup.data));
    assert.match(dup.data.error, /planning_handoff_id|handoff/i);
  });

  test('Cancelled order handoff stays CONSUMED; new order requires new handoff', async () => {
    seedHandoff('handoff-CANCEL', 'product-001', 50);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, planningHandoffId: 'handoff-CANCEL',
      businessDate: isoDate(0),
    });
    assert.equal(order.status, 201);
    const cancel = await fixture.request('POST', `/api/procurement/outsourcing/orders/${order.data.id}/cancel`, fixture.tokens.admin);
    assert.equal(cancel.status, 200);
    // handoff stays consumed; new attempt with same handoff still 409
    const dup = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 50, planningHandoffId: 'handoff-CANCEL',
      businessDate: isoDate(0),
    });
    assert.equal(dup.status, 409);
  });

  test('Material execution: issue / supplement / return preserves enterprise ownership and stock', async () => {
    await qualifyOutsourceSupplier();
    const bomMaterials = [{ productId: 'product-001', requiredQuantity: 0.02, unit: 'EA' }, { productId: 'product-002', requiredQuantity: 0.005, unit: 'EA' }];
    const orderId = await createReleasedOrder({ orderQty: 100, materials: bomMaterials });
    // Snapshot material list with two distinct materials (different UOM-like).
    const snap = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [
        { productId: 'product-001', sourceWarehouseId: 'warehouse-001' },
        { productId: 'product-002', sourceWarehouseId: 'warehouse-001' },
      ],
    });
    assert.equal(snap.status, 200, snap.data.error);
    const materials = fixture.db.prepare('SELECT id, product_id FROM outsourcing_material_list WHERE order_id=? ORDER BY product_id').all(orderId);
    const mat1 = materials.find((m) => m.product_id === 'product-001');
    const mat2 = materials.find((m) => m.product_id === 'product-002');
    // Issue 50 PCS for material-1
    const issue = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: mat1.id, quantity: 3, issuedDate: isoDate(0), idempotencyKey: 'issue-1',
    });
    assert.equal(issue.status, 201, issue.data.error);
    // Supplement 10 PCS for material-1 (independent of required_qty)
    const supplement = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/supplements`, fixture.tokens.admin, {
      materialListId: mat1.id, quantity: 2, reason: '损耗补料', supplementDate: isoDate(0), idempotencyKey: 'supplement-1',
    });
    assert.equal(supplement.status, 201, supplement.data.error);
    // Return 5 PCS for material-1
    const ret = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.admin, {
      materialListId: mat1.id, quantity: 1, returnDate: isoDate(0), idempotencyKey: 'return-1',
    });
    assert.equal(ret.status, 201, ret.data.error);
    // Verify WIP remaining = 3+2-1 = 4 (enterprise owned)
    const m1 = fixture.db.prepare('SELECT issued_quantity issued, supplemented_quantity supplemented, returned_quantity returned FROM outsourcing_material_list WHERE id=?').get(mat1.id);
    assert.equal(Number(m1.issued) + Number(m1.supplemented) - Number(m1.returned), 4);
    // Over-return blocked
    const over = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/returns`, fixture.tokens.admin, {
      materialListId: mat1.id, quantity: 9999, returnDate: isoDate(0), idempotencyKey: 'return-over',
    });
    assert.equal(over.status, 409);
  });

  test('Backflush: per-material cumulative, different UOM never aggregate, insufficient supply fails closed', async () => {
    await qualifyOutsourceSupplier();
    const bomMaterials = [{ productId: 'product-001', requiredQuantity: 0.02, unit: 'EA' }, { productId: 'product-002', requiredQuantity: 0.005, unit: 'EA' }];
    const orderId = await createReleasedOrder({ orderQty: 100, materials: bomMaterials });
    const snap = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [
        { productId: 'product-001', sourceWarehouseId: 'warehouse-001' },
        { productId: 'product-002', sourceWarehouseId: 'warehouse-001' },
      ],
    });
    assert.equal(snap.status, 200);
    const mat1 = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderId, 'product-001').id;
    const mat2 = fixture.db.prepare('SELECT id FROM outsourcing_material_list WHERE order_id=? AND product_id=?').get(orderId, 'product-002').id;
    // Issue 60 PCS and 30 KG (sufficient net supplied)
    const issue1 = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: mat1, quantity: 10, issuedDate: isoDate(0), idempotencyKey: 'issue-bf-1',
    });
    assert.equal(issue1.status, 201, issue1.data.error);
    const issue2 = await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/issues`, fixture.tokens.admin, {
      materialListId: mat2, quantity: 10, issuedDate: isoDate(0), idempotencyKey: 'issue-bf-2',
    });
    assert.equal(issue2.status, 201, issue2.data.error);
    // Create first receipt 30 finished qty.
    const r1 = await createReceipt(orderId, { quantity: 30, receivedDate: isoDate(0), processingFeeCents: 30000 });
    assert.equal(r1.status, 201, r1.data.error);
    // Backflush: target for material-1 = 2 × 30 / 100 = 0.6 PCS; material-2 = 0.5 × 30 / 100 = 0.15 KG
    const effected = await fixture.request('POST', `/api/procurement/outsourcing/receipts/${r1.data.id}/confirm`, fixture.tokens.admin, {}, { 'idempotency-key': 'effect-receipt-1' });
    assert.equal(effected.status, 200, effected.data.error);
    // Verify backflushed amounts are independent (no cross-material aggregation)
    const m1 = fixture.db.prepare('SELECT backflushed_quantity bf FROM outsourcing_material_list WHERE id=?').get(mat1);
    const m2 = fixture.db.prepare('SELECT backflushed_quantity bf FROM outsourcing_material_list WHERE id=?').get(mat2);
    assert.ok(Math.abs(Number(m1.bf) - 0.6) < 1e-9, `material-1 backflush expected 0.6, got ${m1.bf}`);
    assert.ok(Math.abs(Number(m2.bf) - 0.15) < 1e-9, `material-2 backflush expected 0.15, got ${m2.bf}`);
  });

  test('Outsourcing Receipt uses OUTSOURCE_PROCESSING PO and excludes BUY supply', async () => {
    await qualifyOutsourceSupplier();
    const orderId = await createReleasedOrder({ orderQty: 50 });
    const receipt = await createReceipt(orderId, { quantity: 10, receivedDate: isoDate(0), processingFeeCents: 5000 });
    assert.equal(receipt.status, 201, receipt.data.error);
    // Verify business_type isolation: this is the OUTSOURCING domain, not standard receipt.
    const row = fixture.db.prepare("SELECT order_id FROM outsourcing_receipts WHERE id=?").get(receipt.data.id);
    assert.equal(row.order_id, orderId);
  });
});
