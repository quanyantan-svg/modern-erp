// Wave 8 — mixed Sales Delivery and the RBAC negative-access matrix.
//
// These exercise the real HTTP surface so permission, scope and rollback are
// proven end to end rather than by calling module functions directly.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const DAY = '2026-10-20';

describe('Wave 8 mixed Sales Delivery and RBAC negative matrix', () => {
  let temp; let db; let server; let base; const tokens = {};
  const auth = (role) => role ? { authorization: `Bearer ${tokens[role]}` } : {};
  const post = (path, role, body = {}, headers = {}) => fetch(base + path, {
    method: 'POST',
    headers: { ...auth(role), 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const get = (path, role) => fetch(base + path, { headers: auth(role) });

  let soId; let serviceItemId; let physicalItemId; let fulfillmentId; let warehouseId;
  let counter = 0;

  before(async () => {
    temp = mkdtempSync(join(tmpdir(), 'modern-erp-w8-mixed-'));
    db = createDatabase(join(temp, 'erp.db'));
    const stamp = new Date().toISOString();
    warehouseId = 'w8-mix-wh';

    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,bin_enabled,created_at,updated_at) VALUES(?,'W8-MIX','Wave 8 Mixed','a','m',1,0,?,?)`).run(warehouseId, stamp, stamp);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('w8-mix-c','W8-MIX-C','Wave 8 Mixed Customer','','','',1,?,?)").run(stamp, stamp);
    for (const [id, code, service] of [['w8-mix-svc', 'W8-MIX-SVC', 1], ['w8-mix-phy', 'W8-MIX-PHY', 0]]) {
      db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification)
        VALUES(?,?,?,'x','EA',100,0,1,?,?,'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')`).run(id, code, code, stamp, stamp, stamp);
      db.prepare(`INSERT INTO product_commercial_classification(id,product_id,sales_enabled,sales_uom_code,pricing_uom_code,service_classification,service_kind,active,created_at,updated_at,created_by,updated_by)
        VALUES(?,?,1,NULL,NULL,?,?,1,?,?,?,?)`).run(`${id}-c`, id, service, service ? 'STANDARD' : null, stamp, stamp, 'user-sales', 'user-sales');
    }
    upsertCanonicalInventory(db, { warehouseId, productId: 'w8-mix-phy', quantity: 50, position: {}, rowId: 'w8-mix-inv' });
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,quantity,value_cents,updated_at)
      VALUES(?,'MOVING_AVERAGE','w8-mix-phy',?,50,5000,?)`).run(`NONE:${warehouseId}:w8-mix-phy`, warehouseId, stamp);

    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at,order_date,payment_terms_days)
      VALUES('w8-mix-so','W8-MIX-SO','w8-mix-c','APPROVED',300,'user-sales',?,?,?,0)`).run(stamp, stamp, DAY);
    db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no,document_uom_code,document_quantity_num,document_quantity_den,base_quantity_num,base_quantity_den)
      VALUES('w8-mix-soi-svc','w8-mix-so','w8-mix-svc',20,100,2000,1,'EA',20000000,1000000,20000000,1000000),
             ('w8-mix-soi-phy','w8-mix-so','w8-mix-phy',20,100,2000,2,'EA',20000000,1000000,20000000,1000000)`).run();
    db.prepare('UPDATE sales_orders SET total_cents=4000 WHERE id=?').run('w8-mix-so');
    serviceItemId = 'w8-mix-soi-svc'; physicalItemId = 'w8-mix-soi-phy'; soId = 'w8-mix-so';
    db.prepare(`INSERT INTO finance_recognition_policy(id,side,source_type,source_id,recognition_mode,effective_date,active,created_by,created_at)
      VALUES('w8-mix-policy','AR','SERVICE_FULFILLMENT',NULL,'DIRECT_BUSINESS_OPEN_ITEM','2020-01-01',1,'user-sales',?)`).run(stamp);

    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
    for (const [name, password] of [['admin', 'admin123'], ['sales', 'sales123'], ['accounting', 'accounting123'], ['warehouse', 'warehouse123'], ['reviewer', 'review123']]) {
      const response = await post('/api/auth/login', null, { username: name, password });
      tokens[name] = (await response.json()).token;
    }
  });
  after(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    db.close(); rmSync(temp, { recursive: true, force: true });
  });

  function economicFootprint() {
    return {
      inventory: db.prepare('SELECT product_id,quantity FROM inventory ORDER BY product_id').all(),
      outTransactions: Number(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_DELIVERY'").get().n),
      cogsVouchers: Number(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_DELIVERY_COGS'").get().n),
      deliveryAr: Number(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SALES_DELIVERY'").get().n),
      serviceAr: Number(db.prepare("SELECT COUNT(*) n FROM account_receivables WHERE source_type='SERVICE_FULFILLMENT'").get().n),
      confirmedServiceAr: Number(db.prepare("SELECT COUNT(*) n FROM account_receivables ar JOIN service_fulfillments f ON f.finance_open_item_id=ar.id").get().n),
    };
  }

  async function passOqc(deliveryId, quantity) {
    const createResponse = await post('/api/oqc', 'warehouse', { sales_delivery_id: deliveryId });
    const created = JSON.parse(await createResponse.text());
    assert.ok(created.id, `OQC create failed: ${JSON.stringify(created)}`);
    const complete = await post(`/api/oqc/${created.id}/complete`, 'warehouse', { result: 'PASS', inspection_quantity: quantity, passed_quantity: quantity, failed_quantity: 0 });
    assert.ok([200, 201].includes(complete.status), `OQC complete failed: ${await complete.text()}`);
  }

  async function createDelivery(label, items) {
    counter += 1;
    const response = await post('/api/sales-deliveries', 'warehouse', {
      salesOrderId: soId, customerId: 'w8-mix-c', warehouseId, sourceMode: 'DIRECT_ORDER', deliveryDate: DAY, remark: label, items,
    });
    const text = await response.text();
    assert.ok([200, 201].includes(response.status), `delivery create failed: ${text}`);
    // OQC must inspect every line the draft carries, service lines included.
    lastTotalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return JSON.parse(text);
  }

  let lastTotalQuantity = 0;
  function serviceItem(quantity) { return { salesOrderItemId: serviceItemId, productId: 'w8-mix-svc', quantity, unitPriceCents: 100 }; }
  function physicalItem(quantity) { return { salesOrderItemId: physicalItemId, productId: 'w8-mix-phy', quantity, unitPriceCents: 100 }; }

  async function createConfirmedFulfillment(quantityMicros, keySuffix) {
    const created = await post('/api/service-fulfillments', 'sales', { salesOrderItemId: serviceItemId, confirmationQtyMicros: quantityMicros, businessDate: DAY }, { 'idempotency-key': `mix-sf-create-${keySuffix}` });
    const createdText = await created.text();
    assert.equal(created.status, 201, createdText);
    const fulfillment = JSON.parse(createdText).fulfillment;
    const confirmed = await post(`/api/service-fulfillments/${fulfillment.id}/confirm`, 'sales', { expectedVersion: 1 }, { 'idempotency-key': `mix-sf-confirm-${keySuffix}` });
    assert.equal(confirmed.status, 200, await confirmed.text());
    return fulfillment.id;
  }

  // ------------------------------------------------------------- mixed ---

  test('a mixed delivery confirms atomically: service lines take no inventory or COGS, physical lines keep both', async () => {
    fulfillmentId = await createConfirmedFulfillment(2_000_000, 'mixed');
    const before = economicFootprint();
    const physicalBefore = before.inventory.find((row) => row.product_id === 'w8-mix-phy').quantity;
    assert.equal(before.confirmedServiceAr, 1, 'confirming the fulfillment produced exactly one AR open item');

    const delivery = await createDelivery('mixed', [serviceItem(1), physicalItem(1)]);
    await passOqc(delivery.id, lastTotalQuantity);
    const confirmed = await post(`/api/sales-deliveries/${delivery.id}`, 'warehouse', { action: 'confirm' });
    assert.equal(confirmed.status, 200, await confirmed.text());

    const after = economicFootprint();
    const physicalAfter = after.inventory.find((row) => row.product_id === 'w8-mix-phy').quantity;
    assert.equal(physicalAfter, physicalBefore - 1, 'the physical line issued stock');
    assert.ok(!after.inventory.some((row) => row.product_id === 'w8-mix-svc' && row.quantity > 0), 'a service line must never create an inventory position');
    assert.equal(after.outTransactions, before.outTransactions + 1, 'only the physical line wrote an OUT transaction');
    assert.equal(after.cogsVouchers, before.cogsVouchers + 1, 'only the physical line produced COGS');
    assert.equal(after.deliveryAr, before.deliveryAr + 1, 'the delivery recognized exactly one AR for the physical amount');
    assert.equal(after.confirmedServiceAr, 1, 'the service delivery added no second AR for the already-confirmed fulfillment');

    const replay = await post(`/api/sales-deliveries/${delivery.id}`, 'warehouse', { action: 'confirm' });
    assert.ok([200, 409].includes(replay.status), 'a repeat confirm is either idempotent or refused');
    assert.deepEqual(economicFootprint(), after, 'the replay attempt changed nothing');
  });

  test('a service delivery over-delivering confirmed fulfillment capacity rolls the whole delivery back', async () => {
    const before = economicFootprint();
    const delivery = await createDelivery('over-deliver', [serviceItem(3)]);
    await passOqc(delivery.id, lastTotalQuantity);
    const confirmed = await post(`/api/sales-deliveries/${delivery.id}`, 'warehouse', { action: 'confirm' });
    assert.equal(confirmed.status, 409);
    assert.equal(db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(delivery.id).status, 'DRAFT');
    assert.deepEqual(economicFootprint(), before, 'a refused service delivery leaves no economic or audit residue');
  });

  test('a mixed delivery whose physical line is short rolls back the service line too', async () => {
    const second = await createConfirmedFulfillment(2_000_000, 'rollback');
    assert.ok(second);
    const delivery = await createDelivery('partial-fail', [serviceItem(1), physicalItem(1)]);
    await passOqc(delivery.id, lastTotalQuantity);
    // Drain the physical warehouse after the draft exists, so only the physical
    // leg fails at confirm while the service leg would otherwise be legal.
    db.prepare('UPDATE inventory SET quantity=0 WHERE product_id=? AND warehouse_id=?').run('w8-mix-phy', warehouseId);
    const before = economicFootprint();
    const confirmed = await post(`/api/sales-deliveries/${delivery.id}`, 'warehouse', { action: 'confirm' });
    assert.ok([400, 409].includes(confirmed.status), 'the physical leg fails on insufficient stock');
    assert.equal(db.prepare('SELECT status FROM sales_deliveries WHERE id=?').get(delivery.id).status, 'DRAFT');
    assert.deepEqual(economicFootprint(), before, 'the whole delivery rolled back, including the legal service leg');

    db.prepare('UPDATE inventory SET quantity=50 WHERE product_id=? AND warehouse_id=?').run('w8-mix-phy', warehouseId);
  });

  test('a pure service delivery produces no inventory movement and no COGS at all', async () => {
    await createConfirmedFulfillment(1_000_000, 'pure-service');
    const before = economicFootprint();
    const delivery = await createDelivery('pure-service', [serviceItem(1)]);
    await passOqc(delivery.id, lastTotalQuantity);
    const confirmed = await post(`/api/sales-deliveries/${delivery.id}`, 'warehouse', { action: 'confirm' });
    assert.equal(confirmed.status, 200, await confirmed.text());
    const after = economicFootprint();
    assert.equal(after.outTransactions, before.outTransactions);
    assert.equal(after.cogsVouchers, before.cogsVouchers);
    assert.equal(after.deliveryAr, before.deliveryAr, 'a zero-value physical remainder recognizes nothing');
  });

  // -------------------------------------------------------------- RBAC ---

  test('the Wave 8 RBAC matrix: anonymous, wrong-role and view-only actors are refused server-side', async () => {
    const anonymous = await post('/api/service-fulfillments', null, { salesOrderItemId: serviceItemId, confirmationQtyMicros: 1_000_000, businessDate: DAY });
    assert.equal(anonymous.status, 401);

    // Accounting and Warehouse roles must not inherit any Sales mutation.
    for (const role of ['accounting', 'warehouse', 'reviewer']) {
      const response = await post('/api/service-fulfillments', role, { salesOrderItemId: serviceItemId, confirmationQtyMicros: 1_000_000, businessDate: DAY }, { 'idempotency-key': `neg-${role}` });
      assert.equal(response.status, 403, `${role} must not create a service fulfillment`);
      const consignment = await post('/api/consignment-commercial-documents', role, { customerId: 'w8-mix-c', sourceWarehouseId: warehouseId, businessDate: DAY, currencyCode: 'CNY', lines: [] }, { 'idempotency-key': `neg-consign-${role}` });
      assert.equal(consignment.status, 403, `${role} must not create a consignment document`);
    }

    // Sales may read the Wave 8 surfaces.
    assert.equal((await get('/api/service-fulfillments?salesOrderId=' + soId, 'sales')).status, 200);
    assert.equal((await get('/api/consignment-commercial-documents', 'sales')).status, 200);

    // ADMIN retains full access.
    assert.equal((await get('/api/service-fulfillments?salesOrderId=' + soId, 'admin')).status, 200);
  });

  test('both Consignment reference endpoints enforce the real 401/403/404 HTTP matrix without disclosure', async () => {
    const stamp = new Date().toISOString();
    for (const [id, code] of [['w8-ref-group-a', 'W8-REF-A'], ['w8-ref-group-b', 'W8-REF-B']]) {
      db.prepare('INSERT OR IGNORE INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)')
        .run(id, code, code, stamp, stamp);
    }
    let salesperson = db.prepare("SELECT id FROM salesperson_profiles WHERE user_id='user-sales'").get();
    if (!salesperson) {
      db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,user_id,name,active,created_at,updated_at)
        VALUES('w8-ref-sp','W8-REF-SP','user-sales','Reference Sales',1,?,?)`).run(stamp, stamp);
      salesperson = { id: 'w8-ref-sp' };
    }
    db.prepare(`INSERT OR IGNORE INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,created_at,updated_at,created_by)
      VALUES('w8-ref-member',?,'w8-ref-group-a',1,1,'2000-01-01',?,?,'user-admin')`).run(salesperson.id, stamp, stamp);
    const parameters = db.prepare("SELECT scope_key FROM sales_parameters WHERE scope_key='SYSTEM'").get();
    if (parameters) db.prepare("UPDATE sales_parameters SET sales_group_data_scope_enabled=1 WHERE scope_key='SYSTEM'").run();
    else db.prepare(`INSERT INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
      active,created_at,updated_at) VALUES('SYSTEM','SYSTEM',NULL,0,0,1,0,0,'CONTROLLED_DIRECT','DISABLED',1,?,?)`).run(stamp, stamp);

    db.prepare(`INSERT INTO consignment_commodity_locations(id,location_code,customer_id,name,address_text,physical_warehouse_id,
      physical_bin_id,active,effective_from,effective_to,version,created_at,updated_at,created_by,updated_by)
      VALUES('w8-ref-location','W8-REF-SECRET-LOCATION','w8-mix-c','Secret Location','secret-address',?,NULL,1,'2000-01-01',NULL,1,?,?,?,?)`)
      .run(warehouseId, stamp, stamp, 'user-admin', 'user-admin');
    const insertDocument = db.prepare(`INSERT INTO consignment_commercial_documents(id,document_no,customer_id,sales_group_id,source_warehouse_id,
      instruction_date,business_date,currency_code,status,version,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,'CNY',?,1,?,?,?,?)`);
    insertDocument.run('w8-ref-doc-a', 'W8-REF-A-DOC', 'w8-mix-c', 'w8-ref-group-a', warehouseId, DAY, DAY, 'DRAFT', stamp, stamp, 'user-admin', 'user-admin');
    insertDocument.run('w8-ref-doc-a2', 'W8-REF-A2-DOC', 'w8-mix-c', 'w8-ref-group-a', warehouseId, DAY, DAY, 'DRAFT', stamp, stamp, 'user-admin', 'user-admin');
    insertDocument.run('w8-ref-secret-doc', 'W8-REF-SECRET-DOC', 'w8-mix-c', 'w8-ref-group-b', warehouseId, DAY, DAY, 'DRAFT', stamp, stamp, 'user-admin', 'user-admin');
    db.prepare(`INSERT INTO consignment_commercial_lines(id,document_id,line_no,product_id,consignment_commodity_location_id,lot_code,lot_code_key,
      consigned_qty_micros,settled_qty_micros,returned_qty_micros,settled_amount_cents,returned_amount_cents,unit_price_cents,version,
      created_at,updated_at,created_by,updated_by) VALUES('w8-ref-line-a2','w8-ref-doc-a2',1,'w8-mix-phy','w8-ref-location',NULL,'',
      1000000,0,0,0,0,100,1,?,?,?,?)`).run(stamp, stamp, 'user-admin', 'user-admin');

    const handoff = (documentId, role) => get(`/api/consignment-commercial-documents/${documentId}/handoff-position-references`, role);
    const returning = (documentId, lineId, role) => get(`/api/consignment-commercial-documents/${documentId}/lines/${lineId}/return-position-references`, role);
    const expectRefusal = async (response, status, label) => {
      const text = await response.text();
      assert.equal(response.status, status, `${label}: ${text}`);
      for (const secret of ['W8-REF-SECRET', 'secret-address', warehouseId]) {
        assert.equal(text.includes(secret), false, `${label} leaked ${secret}: ${text}`);
      }
    };

    await expectRefusal(await handoff('w8-ref-secret-doc', null), 401, 'Handoff unauthenticated');
    await expectRefusal(await returning('w8-ref-secret-doc', 'foreign-line', null), 401, 'Return unauthenticated');
    await expectRefusal(await handoff('w8-ref-secret-doc', 'warehouse'), 403, 'Handoff missing business permissions');
    await expectRefusal(await returning('w8-ref-secret-doc', 'foreign-line', 'warehouse'), 403, 'Return missing business permissions');
    await expectRefusal(await handoff('w8-ref-secret-doc', 'sales'), 403, 'Handoff cross Sales Group');
    await expectRefusal(await returning('w8-ref-secret-doc', 'foreign-line', 'sales'), 403, 'Return cross Sales Group');
    await expectRefusal(await handoff('w8-ref-unknown-doc', 'sales'), 404, 'Handoff unknown document');
    await expectRefusal(await returning('w8-ref-unknown-doc', 'unknown-line', 'sales'), 404, 'Return unknown document');
    await expectRefusal(await returning('w8-ref-doc-a', 'w8-ref-line-a2', 'sales'), 404, 'Return line/document mismatch');
  });

  test('a sales actor outside the document sales group is refused, and the refusal writes nothing', async () => {
    const stamp = new Date().toISOString();
    db.prepare(`INSERT INTO sales_groups(id,group_code,name,active,created_at,updated_at) VALUES('w8-mix-group','W8-GRP','Wave 8 Group',1,?,?)`).run(stamp, stamp);
    // Group scope only engages once Sales parameters are configured; without them
    // the guard fails closed one step earlier for an unrelated reason.
    db.prepare(`INSERT OR IGNORE INTO sales_parameters(scope_key,scope_type,document_type,sellable_control_enabled,customer_material_xref_enabled,
      sales_group_data_scope_enabled,delivery_schedule_enabled,delivery_quantity_control_enabled,order_change_mode,reservation_behavior,
      active,created_at,updated_at) VALUES('SYSTEM','SYSTEM',NULL,0,0,1,0,0,'CONTROLLED_DIRECT','DISABLED',1,?,?)`).run(stamp, stamp);
    db.prepare("UPDATE sales_parameters SET sales_group_data_scope_enabled=1 WHERE scope_key='SYSTEM'").run();
    db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('w8-mix-other-sales','w8-other','Other Sales','','','role-sales',1,?)`).run(stamp);
    db.prepare(`INSERT INTO salesperson_profiles(id,salesperson_code,user_id,name,active,created_at,updated_at) VALUES('w8-mix-sp','W8-SP','w8-mix-other-sales','Other Sales',1,?,?)`).run(stamp, stamp);
    db.prepare(`INSERT INTO salesperson_group_memberships(id,salesperson_id,sales_group_id,is_default,active,effective_from,created_at,updated_at,created_by) VALUES('w8-mix-mem','w8-mix-sp','w8-mix-group',1,1,?,?,?,'user-sales')`).run('2000-01-01', stamp, stamp);

    const scopedLocation = await (await post('/api/consignment-commodity-locations', 'sales', {
      locationCode: 'SCOPED', customerId: 'w8-mix-c', name: 'Scoped Site', physicalWarehouseId: warehouseId, effectiveFrom: DAY,
    }, { 'idempotency-key': 'w8-mix-scoped-location' })).json();
    assert.ok(scopedLocation.location?.id, `location create failed: ${JSON.stringify(scopedLocation)}`);
    const documentCountBefore = Number(db.prepare('SELECT COUNT(*) n FROM consignment_commercial_documents').get().n);
    const auditCountBefore = Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CONSIGNMENT_DOCUMENT'").get().n);
    const scopedDocument = await post('/api/consignment-commercial-documents', 'sales', {
      customerId: 'w8-mix-c', salesGroupId: 'w8-mix-group', sourceWarehouseId: warehouseId, businessDate: DAY, currencyCode: 'CNY',
      lines: [{ productId: 'w8-mix-phy', consignmentCommodityLocationId: scopedLocation.location.id, consignedQtyMicros: 1_000_000, unitPriceCents: 100 }],
    }, { 'idempotency-key': 'w8-mix-scoped-doc' });
    assert.equal(scopedDocument.status, 403, `a sales actor with no membership cannot create a group document: ${await scopedDocument.clone().text()}`);
    assert.equal(Number(db.prepare('SELECT COUNT(*) n FROM consignment_commercial_documents').get().n), documentCountBefore);
    assert.equal(Number(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity_type='CONSIGNMENT_DOCUMENT'").get().n), auditCountBefore,
      'a refused mutation leaves no audit residue');
  });
});
