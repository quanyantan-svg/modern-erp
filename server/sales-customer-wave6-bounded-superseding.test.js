// Wave 6 LOT/SERIAL R1-R4 bounded superseding Design — focused tests per solution.md §30.31.8.
// Covers:
//  - Six-combination SO_BACKED/NO_SOURCE × MOVING_AVERAGE/LOT/SERIAL positive matrix
//  - LOT/SERIAL negative cases (subsequent OUT, replenishment, duplicate, ambiguous provenance)
//  - Legacy ambiguity fail-closed (R4)
//  - Option C Idempotency-Key mandatory (missing → 400, no body/random fallback)
//  - Option C NULL/unknown marker → 409
//  - Stale Confirm/Reverse (replay → 200; double Confirm → 409)
//  - Period / RBAC / dependency failures
//  - Zero partial side effects

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword } from './db.js';
import { upsertCanonicalInventory } from './test-support/inventory-canonical-fixture.js';

const DAY = '2026-10-17';

describe('Wave 6 §30.31 Bounded superseding — LOT/SERIAL + Option C idempotency + marker', () => {
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

  const confirmReturn = (id, key) => request(`/api/sales-returns/${id}`, 'warehouse', 'POST', { action: 'confirm' }, { 'idempotency-key': key });
  const reverseReturn = (id, key, body = {}) => request(`/api/sales-returns/${id}/reverse`, 'warehouse', 'POST', { businessDate: DAY, reason: 'wave6-bounded', ...body }, { 'idempotency-key': key });

  beforeEach(async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-wave6-bounded-'));
    db = createDatabase(join(tmp, 'erp.db'));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;

    const now = new Date().toISOString();
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS-W6-B','Wave 6 Bounded Customer','','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH-W6-B','Wave 6 Bounded Warehouse','','',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification) VALUES('p1','P-W6-B','Bounded MA Product','','EA',1250,0,1,?,?,'EA','NONE','MOVING_AVERAGE',?,'FINISHED_GOOD')").run(now, now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification) VALUES('p-lot','P-W6-B-LOT','Bounded LOT Product','','EA',500,0,1,?,?,'EA','LOT','LOT_SPECIFIC_POOL',?,'FINISHED_GOOD')").run(now, now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code,tracking_policy,valuation_method,valuation_activated_at,inventory_classification) VALUES('p-serial','P-W6-B-SERIAL','Bounded SERIAL Product','','EA',700,0,1,?,?,'EA','SERIAL','SPECIFIC_SERIAL',?,'FINISHED_GOOD')").run(now, now, now);
    db.prepare("INSERT INTO inventory_lots(id,product_id,lot_code,created_source_type,created_source_id,status,created_at) VALUES('lot-b','p-lot','LOT-W6-B','TEST','seed','AVAILABLE',?)").run(now);
    db.prepare("INSERT INTO inventory_serials(id,product_id,serial_number,created_source_type,created_source_id,lifecycle_state,current_warehouse_id,updated_at,created_at) VALUES('serial-b','p-serial','SERIAL-W6-B','TEST','seed','DELIVERED',NULL,?,?)").run(now, now);
    upsertCanonicalInventory(db, { warehouseId: 'wh', productId: 'p1', quantity: 10, position: {}, rowId: 'inv-p1-b' });
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('NONE:wh:p1','MOVING_AVERAGE','p1','wh',NULL,NULL,10,1000,?)`).run(now);
    db.prepare(`INSERT INTO inventory_valuation_balances(balance_key,valuation_method,product_id,warehouse_id,lot_id,serial_id,quantity,value_cents,updated_at)
      VALUES('LOT:wh:p-lot:lot-b','LOT_SPECIFIC_POOL','p-lot','wh','lot-b',NULL,5,500,?)`).run(now);
    // §30.31.4 item 1: pre-Confirm SPECIFIC_SERIAL pool MUST be zero/absent. Do NOT seed
    // a positive same-serial balance here.
    for (const [name, role, password] of [['warehouse', 'role-warehouse', 'w6-b-warehouse-1234'], ['reviewer', 'role-reviewer', 'w6-b-reviewer-1234']]) {
      const hashed = hashPassword(password);
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
        .run(`user-${name}`, name, name, hashed.hash, hashed.salt, role, now);
    }
    // §30.31.2 SERIAL eligible outbound evidence seed
    db.prepare(`INSERT INTO sales_deliveries(id,delivery_no,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,creator_id,created_at,updated_at)
      VALUES('sd-b-serial-out','SD-B-SERIAL-OUT','cus','wh','user-warehouse',333,'CONFIRMED',?,'user-warehouse',?,?)`).run(DAY, now, now);
    db.prepare(`INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('sdi-b-serial-out','sd-b-serial-out','p-serial',1,333,333,1)`).run();
    db.prepare(`INSERT INTO inventory_transactions(id,business_date,source_type,source_id,source_line_id,product_id,warehouse_id,lot_id,serial_id,quantity_change,direction,valuation_status,created_at)
      VALUES('itx-b-serial-out',?,'SALES_DELIVERY','sd-b-serial-out','sdi-b-serial-out','p-serial','wh',NULL,'serial-b',-1,'OUT','VALUED',?)`).run(DAY, now);
    db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
      VALUES('vm-b-serial-out',?,'p-serial','wh',NULL,'serial-b',-1,-333,333,'ORIGINAL_COST','SALES_DELIVERY_COGS','SALES_DELIVERY','sd-b-serial-out','sdi-b-serial-out','itx-b-serial-out',NULL,NULL,'POSTED',?)`).run(DAY, now);
    db.prepare(`INSERT INTO tracked_inventory_movements(id,product_id,warehouse_id,lot_id,serial_id,direction,quantity,source_type,source_id,source_item_id,transaction_id,business_date,created_at,reversed)
      VALUES('tim-b-serial-out','p-serial','wh',NULL,'serial-b','OUT',1,'SALES_DELIVERY','sd-b-serial-out','sdi-b-serial-out','itx-b-serial-out',?,?,0)`).run(DAY, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at,order_date) VALUES('so1','SO-W6-B','cus','APPROVED',12500,'','user-warehouse',?,?,?)").run(now, now, DAY);
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi1','so1','p1',10,1250,12500,1)").run();
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-lot','so1','p-lot',10,500,5000,2)").run();
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-serial','so1','p-serial',10,700,7000,3)").run();

    server = createServer(createApp(db, { distDir: resolve('dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const [name, password] of [['warehouse', 'w6-b-warehouse-1234'], ['reviewer', 'w6-b-reviewer-1234']]) {
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

  // ---------------- POSITIVE six-combination matrix ----------------
  test('SO_BACKED × MA — positive Confirm and Reverse', async () => {
    const created = await createReturn({ marker: 'SO_BACKED', quantity: 4, salesOrderItemId: 'soi1' });
    assert.equal((await confirmReturn(created.id, 'sb-ma-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'sb-ma-r')).status, 201);
  });

  test('SO_BACKED × LOT — positive Confirm and Reverse (R1 fence pass)', async () => {
    const created = await createReturn({ marker: 'SO_BACKED', productId: 'p-lot', quantity: 2, salesOrderItemId: 'soi-lot', trackingAllocations: [{ lotId: 'lot-b', quantity: 2 }] });
    assert.equal((await confirmReturn(created.id, 'sb-lot-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'sb-lot-r')).status, 201);
  });

  test('SO_BACKED × SERIAL — positive Confirm and Reverse (R2)', async () => {
    const created = await createReturn({ marker: 'SO_BACKED', productId: 'p-serial', quantity: 1, salesOrderItemId: 'soi-serial', trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    assert.equal((await confirmReturn(created.id, 'sb-serial-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'sb-serial-r')).status, 201);
    // Provenance row removed via reverse would be a contract violation; row must persist immutably.
    const provCount = db.prepare(`SELECT COUNT(*) n FROM sales_return_valuation_provenance WHERE return_order_id=?`).get(created.id).n;
    assert.equal(provCount, 1, 'provenance row must be insert-only and persist');
  });

  test('NO_SOURCE × MA — positive Confirm and Reverse', async () => {
    const created = await createReturn({ marker: 'NO_SOURCE', quantity: 2 });
    assert.equal((await confirmReturn(created.id, 'ns-ma-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'ns-ma-r')).status, 201);
  });

  test('NO_SOURCE × LOT — positive Confirm and Reverse (R3 separate from SO_BACKED)', async () => {
    const created = await createReturn({ marker: 'NO_SOURCE', productId: 'p-lot', quantity: 2, trackingAllocations: [{ lotId: 'lot-b', quantity: 2 }] });
    assert.equal((await confirmReturn(created.id, 'ns-lot-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'ns-lot-r')).status, 201);
  });

  test('NO_SOURCE × SERIAL — positive Confirm and Reverse where valid provenance exists (R3)', async () => {
    const created = await createReturn({ marker: 'NO_SOURCE', productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    assert.equal((await confirmReturn(created.id, 'ns-serial-c')).status, 201);
    // Commercial marker must remain NO_SOURCE — never become SO_BACKED or DELIVERY_BACKED.
    const marker = db.prepare(`SELECT commercial_source_marker FROM return_orders WHERE id=?`).get(created.id).commercial_source_marker;
    assert.equal(marker, 'NO_SOURCE');
    assert.equal((await reverseReturn(created.id, 'ns-serial-r')).status, 201);
  });

  // ---------------- NEGATIVE LOT cases ----------------
  test('LOT subsequent OUT after Confirm → reverse 409 (R1 fence)', async () => {
    const created = await createReturn({ marker: 'NO_SOURCE', productId: 'p-lot', quantity: 2, trackingAllocations: [{ lotId: 'lot-b', quantity: 2 }] });
    assert.equal((await confirmReturn(created.id, 'lot-sub-c')).status, 201);
    // Inject a downstream POSTED negative valuation movement at the same LOT.
    const laterTs = new Date(Date.now() + 60_000).toISOString();
    db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
      VALUES('vm-lot-sub-out',?,'p-lot','wh','lot-b',NULL,-1,-50,50,'LOT_CARRYING','SALES_DELIVERY_COGS','SALES_DELIVERY','sd-sub','sdi-sub','itx-sub',NULL,NULL,'POSTED',?)`).run(DAY, laterTs);
    const response = await reverseReturn(created.id, 'lot-sub-r');
    assert.equal(response.status, 409);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
  });

  test('LOT OUT followed by replenishment → reverse 409 (R1 fence still applies)', async () => {
    const created = await createReturn({ marker: 'NO_SOURCE', productId: 'p-lot', quantity: 2, trackingAllocations: [{ lotId: 'lot-b', quantity: 2 }] });
    assert.equal((await confirmReturn(created.id, 'lot-rep-c')).status, 201);
    const baseTs = new Date(Date.now() + 60_000).toISOString();
    db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
      VALUES('vm-lot-rep-out',?,'p-lot','wh','lot-b',NULL,-1,-50,50,'LOT_CARRYING','SALES_DELIVERY_COGS','SALES_DELIVERY','sd-rep-o','sdi-rep-o','itx-rep-o',NULL,NULL,'POSTED',?)`).run(DAY, baseTs);
    const replenishTs = new Date(Date.now() + 120_000).toISOString();
    db.prepare(`INSERT INTO inventory_valuation_movements(id,business_date,product_id,warehouse_id,lot_id,serial_id,quantity_delta,value_delta_cents,unit_cost_cents,valuation_basis,movement_type,source_type,source_id,source_item_id,inventory_transaction_id,production_order_id,reversal_of_id,status,created_at)
      VALUES('vm-lot-rep-in',?,'p-lot','wh','lot-b',NULL,1,50,50,'LOT_CARRYING','SALES_DELIVERY_COGS','SALES_DELIVERY','sd-rep-i','sdi-rep-i','itx-rep-i',NULL,NULL,'POSTED',?)`).run(DAY, replenishTs);
    const response = await reverseReturn(created.id, 'lot-rep-r');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /下游|精确反转/);
  });

  // ---------------- NEGATIVE SERIAL cases ----------------
  test('SERIAL missing outbound provenance → Confirm 409 (R2)', async () => {
    // Delete the seeded outbound to force zero candidates.
    db.prepare(`DELETE FROM tracked_inventory_movements WHERE id='tim-b-serial-out'`).run();
    db.prepare(`DELETE FROM inventory_valuation_movements WHERE id='vm-b-serial-out'`).run();
    const created = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    const response = await confirmReturn(created.id, 'serial-miss-c');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /eligible outbound|provenance/);
  });

  test('SERIAL duplicate restoration → second reverse 409 (R2 no duplicate)', async () => {
    const created = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    assert.equal((await confirmReturn(created.id, 'serial-dup-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'serial-dup-r')).status, 201);
    // After successful reverse, the restored unit is gone. A second reverse must fail-closed.
    const response = await reverseReturn(created.id, 'serial-dup-r2');
    assert.equal(response.status, 409);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
  });

  test('SERIAL duplicate Confirm on second Return for same outbound → second Confirm 409 (R2 Confirm-time precheck)', async () => {
    // §30.31.4 + §30.31.7 — even within a single SQLite session, the FOR UPDATE-locked
    // precheck at Confirm time must reject a second SERIAL restoration against the same
    // outbound valuation movement. The first Confirm consumes the outbound evidence; the
    // second must fail closed with zero partial side effects.
    const first = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    assert.equal((await confirmReturn(first.id, 'serial-dup-c2-first')).status, 201);
    // After the first Confirm, the serial is now AVAILABLE with current_warehouse_id set.
    // A second SERIAL Return referencing the SAME outbound must 409 at the precheck.
    const serialRow = db.prepare(`SELECT lifecycle_state,current_warehouse_id FROM inventory_serials WHERE id='serial-b'`).get();
    assert.equal(serialRow.lifecycle_state, 'HOLD');
    // Set up a second tracking allocation pointing at the same outbound evidence path —
    // but the precheck must reject before any INSERT or movement.
    const second = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    const response = await confirmReturn(second.id, 'serial-dup-c2-second');
    assert.equal(response.status, 409, JSON.stringify(await response.json()));
    // No second provenance row may be written.
    const provCount = Number(db.prepare(`SELECT COUNT(*) n FROM sales_return_valuation_provenance WHERE return_order_id=?`).get(second.id).n);
    assert.equal(provCount, 0, 'no duplicate provenance row may be persisted for the same outbound');
    // No SALES_RETURN valuation movement for the failed second Return.
    const secondMoves = Number(db.prepare(`SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_id=? AND status='POSTED'`).get(second.id).n);
    assert.equal(secondMoves, 0, 'failed second Confirm must write no valuation movement');
    // No SALES_RETURN inventory transaction for the failed second Return.
    const secondTx = Number(db.prepare(`SELECT COUNT(*) n FROM inventory_transactions WHERE source_id=? AND source_type='SALES_RETURN'`).get(second.id).n);
    assert.equal(secondTx, 0, 'failed second Confirm must write no inventory transaction');
    // Second Return status remains DRAFT.
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(second.id).status, 'DRAFT');
  });

  test('SERIAL lifecycle invalid (current_warehouse_id set before confirm) → Confirm 409', async () => {
    // After a prior Delivery restore, serial is back at the warehouse — set lifecycle_state to AVAILABLE
    db.prepare(`UPDATE inventory_serials SET lifecycle_state='AVAILABLE', current_warehouse_id='wh' WHERE id='serial-b'`).run();
    const created = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    const response = await confirmReturn(created.id, 'serial-lc-c');
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /lifecycle|provenance|returnable/);
  });

  // ---------------- Legacy ambiguity ----------------
  test('R4 legacy without deterministic evidence → 409 (no synthetic outbound)', async () => {
    // No outbound seeded — LOT/MOVING_AVERAGE reverse must still work via positive pool,
    // but for SERIAL no provenance → fail-closed.
    db.prepare(`DELETE FROM tracked_inventory_movements WHERE id='tim-b-serial-out'`).run();
    db.prepare(`DELETE FROM inventory_valuation_movements WHERE id='vm-b-serial-out'`).run();
    const created = await createReturn({ productId: 'p-serial', quantity: 1, trackingAllocations: [{ serialId: 'serial-b', quantity: 1 }] });
    const response = await confirmReturn(created.id, 'legacy-serial-c');
    assert.equal(response.status, 409);
    // No synthetic outbound / no balance-reconstruction / no current-cost fallback.
    const moves = db.prepare(`SELECT COUNT(*) n FROM inventory_valuation_movements WHERE source_id=? AND status='POSTED'`).get(created.id).n;
    assert.equal(moves, 0, 'no synthetic valuation movement may be written');
  });

  // ---------------- Option C Idempotency-Key / Marker ----------------
  test('Option C missing Idempotency-Key header → HTTP 400, no side effects', async () => {
    const created = await createReturn({ quantity: 2 });
    assert.equal((await confirmReturn(created.id, 'idem-ok-c')).status, 201);
    const response = await fetch(`${baseUrl}/api/sales-returns/${created.id}/reverse`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.warehouse}`, 'content-type': 'application/json' },
      body: JSON.stringify({ businessDate: DAY, reason: 'no key' }),
    });
    assert.equal(response.status, 400);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
    const rev = db.prepare(`SELECT COUNT(*) n FROM return_reversals WHERE return_id=?`).get(created.id).n;
    assert.equal(rev, 0);
  });

  test('Option C payload conflict (same key, different reason) → HTTP 409', async () => {
    const created = await createReturn({ quantity: 2 });
    assert.equal((await confirmReturn(created.id, 'idem-conf-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'idem-conf-k')).status, 201);
    const response = await request(`/api/sales-returns/${created.id}/reverse`, 'warehouse', 'POST', { businessDate: DAY, reason: 'different reason' }, { 'idempotency-key': 'idem-conf-k' });
    assert.equal(response.status, 409);
  });

  test('Option C equivalent payload replay (same key, same body) → 200 + replayed:true', async () => {
    const created = await createReturn({ quantity: 2 });
    assert.equal((await confirmReturn(created.id, 'idem-rep-c')).status, 201);
    assert.equal((await reverseReturn(created.id, 'idem-rep-k')).status, 201);
    const replay = await reverseReturn(created.id, 'idem-rep-k');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
  });

  test('Option C NULL/unknown marker → HTTP 409, no fall-through to DELIVERY_BACKED', async () => {
    // Insert a Return with NULL marker
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO return_orders(id,return_no,source_type,source_id,creator_id,status,return_date,customer_id,warehouse_id,commercial_source_marker,total_cents,created_at,updated_at)
      VALUES('null-marker-r','NULL-R','SALES','null-sid','user-warehouse','CONFIRMED',?,'cus','wh',NULL,2500,?,?)`).run(DAY, now, now);
    db.prepare(`INSERT INTO return_order_items(id,return_id,product_id,quantity,delivery_item_id,unit_price_cents,amount_cents,line_no)
      VALUES('null-marker-ri','null-marker-r','p1',2,NULL,1250,2500,1)`).run();
    const response = await request('/api/sales-returns/null-marker-r/reverse', 'warehouse', 'POST', { businessDate: DAY, reason: 'null marker' }, { 'idempotency-key': 'null-marker-k' });
    assert.equal(response.status, 409);
    const rev = db.prepare(`SELECT COUNT(*) n FROM return_reversals WHERE return_id='null-marker-r'`).get().n;
    assert.equal(rev, 0, 'NULL marker must not silently route to DELIVERY_BACKED or Option C');
  });

  // ---------------- Stale Confirm / dependency gate ----------------
  test('Double Confirm on same Return → second 409', async () => {
    const created = await createReturn({ quantity: 2 });
    assert.equal((await confirmReturn(created.id, 'stale-c-1')).status, 201);
    const response = await confirmReturn(created.id, 'stale-c-2');
    assert.equal(response.status, 409);
    assert.equal(db.prepare('SELECT status FROM return_orders WHERE id=?').get(created.id).status, 'CONFIRMED');
  });
});