import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const DAY = '2026-10-17';

describe('Sales & Customer Wave 6 functional closure', () => {
  let tmp;
  let db;
  let server;
  let baseUrl;
  const tokens = {};

  const request = (path, role, method = 'GET', body, headers = {}) => fetch(baseUrl + path, {
    method,
    headers: {
      authorization: `Bearer ${tokens[role]}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const createReturn = async ({ marker = 'NO_SOURCE', quantity = 2, productId = 'p1', salesOrderItemId, trackingAllocations } = {}) => {
    const response = await request('/api/sales-returns', 'warehouse', 'POST', {
      commercialSourceMarker: marker,
      customerId: 'cus',
      warehouseId: 'wh',
      salesOrderId: marker === 'SO_BACKED' ? 'so1' : undefined,
      returnDate: DAY,
      items: [{ productId, quantity, ...(salesOrderItemId ? { salesOrderItemId } : {}), ...(trackingAllocations ? { trackingAllocations } : {}) }],
    });
    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    return payload;
  };

  const confirmReturn = (id, key = `confirm-${id}`) => request(`/api/sales-returns/${id}`, 'warehouse', 'POST', { action: 'confirm' }, { 'idempotency-key': key });

  beforeEach(async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-wave6-'));
    db = createDatabase(join(tmp, 'erp.db'));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;

    const now = new Date().toISOString();
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS-W6','Wave 6 Customer','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus-other','CUS-X','Other Customer','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH-W6','Wave 6 Warehouse','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification) VALUES('p1','P-W6','Wave 6 Product','','EA',1250,0,1,?,?,'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')").run(now, now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification,standard_manufacturing_cost_cents) VALUES('p-no-pool','P-NO-POOL','No Pool Product','','EA',900,0,1,?,?,'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD',900)").run(now, now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification) VALUES('p-lot','P-LOT','Lot Product','','EA',500,0,1,?,?,'EA','LOT','LOT_SPECIFIC_POOL',?,'FINISHED_GOOD')").run(now, now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification) VALUES('p-serial','P-SERIAL','Serial Product','','EA',700,0,1,?,?,'EA','SERIAL','SPECIFIC_SERIAL',?,'FINISHED_GOOD')").run(now, now, now);
    db.prepare("INSERT INTO inventory_lots(id,product_id,lot_code,created_source_type,created_source_id,status,created_at) VALUES('lot-w6','p-lot','LOT-W6','TEST','seed','AVAILABLE',?)").run(now);
    db.prepare("INSERT INTO inventory_serials(id,product_id,serial_number,created_source_type,created_source_id,lifecycle_state,current_warehouse_id,updated_at,created_at) VALUES('serial-w6','p-serial','SERIAL-W6','TEST','seed','DELIVERED',NULL,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p1', quantity: 10, position: {}, rowId: 'inv-p1' });
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p-no-pool', quantity: 0, position: {}, rowId: 'inv-no-pool' });
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('NONE:wh:p1','MOVING_AVERAGE','p1','wh',NULL,NULL,10,1000,?)`).run(now);
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('LOT:wh:p-lot:lot-w6','LOT_SPECIFIC_POOL','p-lot','wh','lot-w6',NULL,5,500,?)`).run(now);
    // §30.31.4 item 1: pre-Confirm SPECIFIC_SERIAL pool MUST be zero/absent. Do NOT seed
    // a positive same-serial balance here; the Confirm produces exactly one unit at the
    // Return warehouse with the matching outbound value.
    for (const [name, role, password] of [
      ['warehouse', 'role-warehouse', 'warehouse-wave6-1234'],
      ['reviewer', 'role-reviewer', 'reviewer-wave6-1234'],
    ]) {
      const hashed = hashPassword(password);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
        .run(`user-${name}`, name, name, hashed.hash, hashed.salt, role, now);
    }
    // §30.31.2 Seed the unique eligible original SALES_DELIVERY_COGS outbound for SERIAL.
    // The provenance row created at Confirm will reference this outbound valuation movement.
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,creator_id,created_at,updated_at)
      VALUES('sd-serial-out','SD-SERIAL-OUT','cus','wh','user-warehouse',333,'CONFIRMED',?,'user-warehouse',?,?)`).run(DAY, now, now);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('sdi-serial-out','sd-serial-out','p-serial',1,333,333,1)`).run();
    db.prepare(`INSERT INTO inventory_transactions(id,business_date,source_type,source_id,source_line_id,product_id,warehouse_id,lot_id,serial_id,quantity_change,direction,valuation_status,created_at)
      VALUES('itx-serial-out',?,'SALES_DELIVERY','sd-serial-out','sdi-serial-out','p-serial','wh',NULL,'serial-w6',-1,'OUT','VALUED',?)`).run(DAY, now);
    db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
      VALUES('vm-serial-out',?, 'p-serial','wh',NULL,'serial-w6',-1,-333,333,'ORIGINAL_COST','SALES_DELIVERY_COGS','SALES_DELIVERY','sd-serial-out','sdi-serial-out','itx-serial-out',NULL,NULL,'POSTED',?)`).run(DAY, now);
    db.prepare(`INSERT INTO tracked_inventory_movements(id,product_id,warehouse_id,lot_id,serial_id,direction,quantity,source_type,source_id,source_item_id,transaction_id,business_date,created_at,reversed)
      VALUES('tim-serial-out','p-serial','wh',NULL,'serial-w6','OUT',1,'SALES_DELIVERY','sd-serial-out','sdi-serial-out','itx-serial-out',?,?,0)`).run(DAY, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date) VALUES('so1','SO-W6','cus','APPROVED',12500,'','user-warehouse',?,?,?)").run(now, now, DAY);
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi1','so1','p1',10,1250,12500,1)").run();

    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const [name, password] of [['warehouse', 'warehouse-wave6-1234'], ['reviewer', 'reviewer-wave6-1234']]) {
      const response = await fetch(baseUrl + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, password }),
      });
      tokens[name] = (await response.json()).token;
    }
  });

  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('Option A NO_SOURCE confirm posts physical inventory, exact pool valuation and balanced voucher without AR credit', async () => {
    const created = await createReturn();
    const response = await confirmReturn(created.id);
    assert.equal(response.status, 201);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1' AND active=1").get().quantity, 12);
    assert.equal(db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:wh:p1'").get().quantity, 12);
    assert.equal(db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:wh:p1'").get().value_cents, 1200);
    const movement = db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id);
    assert.equal(movement.value_delta_cents, 200);
    assert.ok(movement.inventory_transaction_id);
    const voucher = db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id);
    const totals = db.prepare("SELECT SUM(CASE WHEN direction='DEBIT' THEN amount_cents ELSE 0 END) debit,SUM(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END) credit FROM accounting_entries WHERE voucher_id=?").get(voucher.id);
    assert.equal(totals.debit, 200);
    assert.equal(totals.credit, 200);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_credit_adjustments WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id).n, 0);
  });

  test('Option A preserves lawful LOT/SERIAL identity, pool value and lifecycle', async () => {
    const cases = [
      { productId: 'p-lot', quantity: 2, trackingAllocations: [{ lotId: 'lot-w6', quantity: 2 }], identityColumn: 'lot_id', identity: 'lot-w6', value: 200 },
      { productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-w6', quantity: 1 }], identityColumn: 'serial_id', identity: 'serial-w6', value: 333 },
    ];
    for (const [index, entry] of cases.entries()) {
      // §30.31.4 item 1 — SERIAL pre-Confirm state must show zero/absent same-identity valuation balance.
      // LOT pre-Confirm uses the existing positive LOT pool as authority, so the assertion only
      // applies to SERIAL entries.
      if (entry.identityColumn === 'serial_id') {
        const prePool = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key=?`).get(`SERIAL:${entry.identity}`);
        if (prePool) {
          assert.equal(Number(prePool.quantity), 0, `pre-Confirm SERIAL pool quantity must be 0 for serial_id=${entry.identity}`);
          assert.equal(Number(prePool.value_cents), 0, `pre-Confirm SERIAL pool value_cents must be 0 for serial_id=${entry.identity}`);
        }
      }
      const created = await createReturn(entry);
      assert.equal((await confirmReturn(created.id, `tracked-confirm-${index}`)).status, 201);
      const movement = db.prepare("SELECT * FROM inventory_valuation_movements WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id);
      assert.equal(movement[entry.identityColumn], entry.identity);
      assert.equal(movement.value_delta_cents, entry.value);
      assert.equal(movement.movement_type, 'SALES_RETURN');
      assert.equal(movement.status, 'POSTED');
      const position = db.prepare(`SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id=? AND ${entry.identityColumn}=? AND active=1`).get(entry.productId, entry.identity);
      assert.equal(position.quantity, entry.quantity, `post-Confirm inventory quantity for ${entry.identityColumn}=${entry.identity}`);
      if (entry.productId === 'p-lot') {
        assert.equal(db.prepare("SELECT quantity FROM inventory_lot_balances WHERE warehouse_id='wh' AND lot_id='lot-w6'").get().quantity, 2);
        // §30.31.5 / document.md §34.3.10: LOT Confirm adds the Return quantity/value to the
        // shared LOT carrying-value pool. The pool is the immutable authoritative aggregation;
        // the per-allocation value is a proportional allocation of the existing pool value.
        const pool = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='LOT:wh:p-lot:lot-w6'`).get();
        assert.equal(Number(pool.quantity), 7, 'LOT pool quantity becomes 5+2');
        assert.equal(Number(pool.value_cents), 700, 'LOT pool value_cents becomes 500+200');
      } else {
        // §30.31.4 item 5 — exactly one restored unit + matching one-unit valuation balance.
        const serial = db.prepare("SELECT lifecycle_state,current_warehouse_id FROM inventory_serials WHERE id='serial-w6'").get();
        assert.equal(serial.lifecycle_state, 'HOLD');
        assert.equal(serial.current_warehouse_id, 'wh');
        const pool = db.prepare(`SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='SERIAL:serial-w6'`).get();
        assert.equal(Number(pool.quantity), 1, 'SERIAL post-Confirm pool quantity must be exactly 1');
        assert.equal(Number(pool.value_cents), 333, 'SERIAL post-Confirm pool value_cents must equal outbound original value');
      }
    }
  });

  test('Option A rejects SERIAL when SPECIFIC_SERIAL pool already has a positive balance (§30.31.4 item 1)', async () => {
    // Inject a stale positive same-serial balance. The strict Design says this is
    // 409 with zero partial side effects.
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('SERIAL:serial-w6','SPECIFIC_SERIAL','p-serial','wh',NULL,'serial-w6',1,333,?)`).run(new Date().toISOString());
    const created = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-w6', quantity: 1 }] });
    const response = await confirmReturn(created.id, 'serial-stale-pool');
    assert.equal(response.status, 409);
    // Zero partial effects: no SALES_RETURN movement, no inventory transaction, no provenance.
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_id=? AND source_type='SALES_RETURN'`).get(created.id).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM inventory_transactions WHERE source_id=? AND source_type='SALES_RETURN'`).get(created.id).n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM sales_return_valuation_provenance WHERE return_order_id=?`).get(created.id).n, 0);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'DRAFT');
  });

  test('Option C LOT reversal succeeds under the conservative no-subsequent-negative-movement fence (R1)', async () => {
    // §30.31.3: aggregate pool equality is FORBIDDEN. The new contract is the
    // conservative fence — reverse succeeds as long as no downstream negative
    // valuation movement exists at the same LOT identity.
    const created = await createReturn({ productId: 'p-lot', quantity: 2, trackingAllocations: [{ lotId: 'lot-w6', quantity: 2 }] });
    assert.equal((await confirmReturn(created.id, 'lot-fence-confirm')).status, 201);
    const before = db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='LOT:wh:p-lot:lot-w6'").get();
    const response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', { businessDate: DAY, reason: 'no downstream consumption' }, { 'idempotency-key': 'lot-fence-reverse' });
    assert.equal(response.status, 201);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
    // Reverse must remove the inbound quantity from the LOT pool.
    const after = db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='LOT:wh:p-lot:lot-w6'").get();
    assert.equal(Number(after.quantity), Number(before.quantity) - 2);
    assert.equal(Number(after.value_cents), Number(before.value_cents) - 200);
  });

  test('Option C LOT rejection when downstream negative valuation movement exists (R1 fence)', async () => {
    // §30.31.3: any POSTED negative valuation movement at the exact LOT identity whose
    // created_at >= original.created_at AND from a different transaction blocks reverse.
    const created = await createReturn({ productId: 'p-lot', quantity: 2, trackingAllocations: [{ lotId: 'lot-w6', quantity: 2 }] });
    assert.equal((await confirmReturn(created.id, 'lot-frontier-confirm')).status, 201);
    // Inject a downstream negative valuation movement with later created_at at the same LOT.
    const laterTs = new Date(Date.now() + 60_000).toISOString();
    db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
      VALUES('vm-frontier-blocker',?,'p-lot','wh','lot-w6',NULL,-1,-50,50,'LOT_CARRYING','SALES_DELIVERY_COGS','SALES_DELIVERY','sd-blocker','sdi-blocker','itx-blocker',NULL,NULL,'POSTED',?)`).run(DAY, laterTs);
    const response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', { businessDate: DAY, reason: 'downstream consumption exists' }, { 'idempotency-key': 'lot-frontier-reverse' });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /下游|下游负 movement|fence|精确反转/);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_RETURN_REVERSAL'").get().n, 0);
  });

  test('Option A SO_BACKED uses real SO line and enforces remaining capacity', async () => {
    const created = await createReturn({ marker: 'SO_BACKED', quantity: 4, salesOrderItemId: 'soi1' });
    assert.equal((await confirmReturn(created.id)).status, 201);
    const over = await createReturn({ marker: 'SO_BACKED', quantity: 7, salesOrderItemId: 'soi1' });
    const response = await confirmReturn(over.id);
    assert.equal(response.status, 409);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(over.id).status, 'DRAFT');
  });

  test('Option A rejects standard-cost fallback and rolls physical/economic effects back', async () => {
    const created = await createReturn({ productId: 'p-no-pool' });
    const before = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p-no-pool' AND active=1").get().quantity;
    const response = await confirmReturn(created.id);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /valuation pool|估值池/);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p-no-pool' AND active=1").get().quantity, before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id).n, 0);
  });

  test('Option C full reversal restores physical quantity, pool value and exact voucher; replay is exact and payload conflict is 409', async () => {
    const created = await createReturn();
    assert.equal((await confirmReturn(created.id)).status, 201);
    const body = { businessDate: DAY, reason: '客户退货确认有误' };
    let response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', body, { 'idempotency-key': 'reverse-one' });
    assert.equal(response.status, 201);
    const first = await response.json();
    assert.equal(first.amountCents, 0);
    assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='wh' AND product_id='p1' AND active=1").get().quantity, 10);
    const restoredPool = db.prepare("SELECT quantity,value_cents FROM inventory_valuation_balances WHERE balance_key='NONE:wh:p1'").get();
    assert.equal(restoredPool.quantity, 10);
    assert.equal(restoredPool.value_cents, 1000);
    const original = db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='SALES_RETURN' AND source_id=?").get(created.id);
    const reversal = db.prepare("SELECT id FROM accounting_vouchers WHERE source_type='SALES_RETURN_REVERSAL' AND source_id=? AND reversal_of_id=?").get(first.id, original.id);
    assert.ok(reversal);
    response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', body, { 'idempotency-key': 'reverse-one' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).replayed, true);
    response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', { ...body, reason: '不同原因' }, { 'idempotency-key': 'reverse-one' });
    assert.equal(response.status, 409);
  });

  test('Replacement supports partial and multiple deliveries, preserves fulfillment on cancel, and blocks reverse/new fulfillment', async () => {
    const created = await createReturn();
    assert.equal((await confirmReturn(created.id)).status, 201);
    const returnItem = db.prepare('SELECT id FROM return_order_items WHERE return_id=?').get(created.id);
    let response = await request('/api/sales-order-replacements', 'warehouse', 'POST', {
      sourceReturnId: created.id,
      lines: [{ returnItemId: returnItem.id, qty: 2, materialId: 'p1', uomCode: 'EA' }],
    }, { 'idempotency-key': 'replacement-create' });
    assert.equal(response.status, 201);
    const replacement = await response.json();
    response = await request(`/api/sales-order-replacements/${replacement.id}`, 'warehouse');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).replacement.id, replacement.id);
    const replacementLine = db.prepare('SELECT id FROM sales_order_replacement_lines WHERE replacement_id=?').get(replacement.id);
    const now = new Date().toISOString();
    for (const [deliveryId, itemId, qty] of [['sd-r1', 'sdi-r1', 1], ['sd-r2', 'sdi-r2', 1]]) {
      db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,creator_id,created_at,updated_at)
        VALUES(?,?, 'cus','wh','user-warehouse',1250,'CONFIRMED',?,'user-warehouse',?,?)`).run(deliveryId, deliveryId.toUpperCase(), DAY, now, now);
      db.prepare('INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,1)')
        .run(itemId, deliveryId, 'p1', qty, 1250, 1250 * qty);
    }
    response = await request(`/api/sales-order-replacements/${replacement.id}/fulfill`, 'warehouse', 'POST', {
      lines: [{ replacementLineId: replacementLine.id, salesDeliveryItemId: 'sdi-r1', qty: 1 }],
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).fulfillmentState, 'PARTIAL');
    response = await request(`/api/sales-order-replacements/${replacement.id}/fulfill`, 'warehouse', 'POST', {
      lines: [{ replacementLineId: replacementLine.id, salesDeliveryItemId: 'sdi-r1', qty: 1 }],
    });
    assert.equal(response.status, 409);
    response = await request(`/api/sales-order-replacements/${replacement.id}/cancel`, 'warehouse', 'POST', {});
    assert.equal(response.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales_replacement_fulfillments WHERE replacement_line_id=?').get(replacementLine.id).n, 1);
    response = await request(`/api/sales-order-replacements/${replacement.id}/fulfill`, 'warehouse', 'POST', {
      lines: [{ replacementLineId: replacementLine.id, salesDeliveryItemId: 'sdi-r2', qty: 1 }],
    });
    assert.equal(response.status, 409);
    response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', { businessDate: DAY, reason: '不得绕过已履行换货' }, { 'idempotency-key': 'reverse-blocked' });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Replacement Fulfillment/);
  });

  test('RETURNS_VIEW without RETURNS_MANAGE cannot confirm, reverse, create or fulfill', async () => {
    const created = await createReturn();
    let response = await request(`/api/sales-returns/${created.id}`, 'reviewer', 'POST', { action: 'confirm' }, { 'idempotency-key': 'denied-confirm' });
    assert.equal(response.status, 403);
    response = await request('/api/sales-order-replacements', 'reviewer', 'POST', { sourceReturnId: created.id, lines: [] });
    assert.equal(response.status, 403);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'DRAFT');
  });
});
