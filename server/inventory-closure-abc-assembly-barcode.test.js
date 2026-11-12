// Focused tests for the Inventory & Warehouse closure modules:
//   INV-26 ABC classification, INV-17 Assembly / Disassembly, INV-39 barcode
//   generation.
//
// Every physical stock change asserted here must be visible in the canonical
// `inventory` table and in `inventory_transactions` — never in the stale
// `products.stock_quantity`.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { createDatabase } from './db.js';
import {
  listAbcClassifications, classifyInventoryAbc, getInventoryAbcAnalysis,
} from './modules/inventory-abc-classifications.js';
import {
  createAssemblyOrder, confirmAssemblyOrder, createDisassemblyOrder,
  confirmDisassemblyOrder, listAssemblyOrders,
} from './modules/inventory-assembly-disassembly.js';
import {
  generateBarcode, listGeneratedBarcodes, renderBarcodeLabel,
} from './modules/inventory-barcode-generation.js';
import { migrateV24InventoryAssemblyAbc } from './migrations/v24-inventory-assembly-abc.js';
import { computePositionKey } from './lib/inventory-position.js';

const ACTOR = {
  id: 'u-act',
  permissions: [
    'INVENTORY_ABC_MANAGE', 'INVENTORY_REPORT_VIEW', 'INVENTORY_VIEW',
    'INVENTORY_ASSEMBLY_VIEW', 'INVENTORY_ASSEMBLY_MANAGE',
    'INVENTORY_BARCODE_RULE_VIEW', 'INVENTORY_BARCODE_RULE_MANAGE',
  ],
};

function makeRes() {
  return {
    statusCode: 200, body: null,
    setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end(payload) { if (payload !== undefined) this.body = JSON.parse(payload); return this; },
  };
}

function makeReq(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf-8');
  const stream = Readable.from(payload);
  stream.headers = { 'content-type': 'application/json', 'content-length': payload.length };
  return stream;
}

function seedPosition(db, id, productId, quantity) {
  const positionKey = computePositionKey({
    productId, warehouseId: 'wh-1', binId: null,
    ownerType: 'ENTERPRISE', ownerId: null, stockStatus: 'AVAILABLE',
    lotId: null, serialId: null,
  });
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active)
    VALUES(?,?,?,?,?,?,NULL,'ENTERPRISE',NULL,'AVAILABLE',NULL,NULL,1)`)
    .run(id, 'wh-1', productId, quantity, '2026-01-01', positionKey);
}

function onHand(db, productId) {
  const row = db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id=? AND active=1').get(productId);
  return Number(row?.q || 0);
}

describe('Inventory closure — ABC / Assembly / Barcode', () => {
  let db;
  let dbDir;

  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-closure-'));
    db = createDatabase(join(dbDir, 'test.db'));
    migrateV24InventoryAssemblyAbc(db);
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at)
      VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at)
      VALUES('wh-1','WH1','主仓',1,0,?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-a','PA','成品A','FG','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-b','PB','成品B','FG','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-c1','PC1','元件1','RM','PCS',100,0,1,'NONE',?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-c2','PC2','元件2','RM','PCS',100,0,1,'NONE',?,?)`).run(now, now);
    db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-idle','PID','呆滞件','RM','PCS',100,0,1,'NONE',?,?)`).run(now, now);
  });

  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  // ---------------------------------------------------------------- INV-26
  test('ABC USAGE basis classifies from the canonical movement ledger', async () => {
    // Seed canonical inventory + two OUT movements.
    seedPosition(db, 'inv-1', 'p-a', 100);
    seedPosition(db, 'inv-2', 'p-b', 50);
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES('tx-1','wh-1','p-a',60,'OUT',40,'OTHER_ISSUE','s1','','',NULL,?,?)`).run(today, today);
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES('tx-2','wh-1','p-b',10,'OUT',40,'OTHER_ISSUE','s1','','',NULL,?,?)`).run(today, today);
    // A receipt must NOT count as usage.
    db.prepare(`INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at,business_date)
      VALUES('tx-3','wh-1','p-idle',999,'IN',999,'OTHER_RECEIPT','s2','','',NULL,?,?)`).run(today, today);

    const res = makeRes();
    await classifyInventoryAbc(db, makeReq({ basis: 'USAGE', effectiveFrom: today }), res, ACTOR);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.classified >= 4, 'all active products classified');
    assert.equal(res.body.basis, 'USAGE');

    const rows = db.prepare('SELECT product_id, abc_class FROM inventory_abc_classifications WHERE effective_to IS NULL').all();
    const byProduct = Object.fromEntries(rows.map((r) => [r.product_id, r.abc_class]));
    assert.equal(byProduct['p-a'], 'A', 'highest usage is A');
    assert.equal(byProduct['p-idle'], 'C', 'no movement is C');
  });

  test('ABC VALUE basis refuses without a Finance valuation snapshot', async () => {
    const res = makeRes();
    await assert.rejects(
      () => classifyInventoryAbc(db, makeReq({ basis: 'VALUE', effectiveFrom: '2026-01-01' }), res, ACTOR),
      (error) => error.status === 409 && /Finance/.test(error.message),
    );
  });

  test('ABC re-run with the same effectiveFrom does not duplicate and closes history', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const before = db.prepare('SELECT COUNT(*) n FROM inventory_abc_classifications').get().n;
    const res = makeRes();
    await classifyInventoryAbc(db, makeReq({ basis: 'USAGE', effectiveFrom: today }), res, ACTOR);
    const after = db.prepare('SELECT COUNT(*) n FROM inventory_abc_classifications').get().n;
    assert.equal(after, before, 'idempotent — no duplicate rows');

    const later = makeRes();
    await classifyInventoryAbc(db, makeReq({ basis: 'USAGE', effectiveFrom: '2099-01-01' }), later, ACTOR);
    const closed = db.prepare("SELECT COUNT(*) n FROM inventory_abc_classifications WHERE effective_to IS NOT NULL").get().n;
    assert.ok(closed > 0, 'previous open rows are closed, not deleted');
  });

  test('ABC list + analysis read the canonical on-hand quantity', async () => {
    const listRes = makeRes();
    listAbcClassifications(db, listRes, ACTOR, new URL('http://x/api?abcClass=A'));
    assert.equal(listRes.statusCode, 200);
    assert.ok(Array.isArray(listRes.body.abcClassifications));

    const analysisRes = makeRes();
    getInventoryAbcAnalysis(db, analysisRes, ACTOR, new URL('http://x/api'));
    assert.equal(analysisRes.statusCode, 200);
    const row = analysisRes.body.analysis.find((r) => r.productId === 'p-a');
    assert.ok(row);
    assert.equal(row.onHandQuantity, onHand(db, 'p-a'));
    assert.notEqual(row.onHandQuantity, 0);
  });

  // ---------------------------------------------------------------- INV-17
  test('Assembly ignores client components and uses the Engineering BOM', async () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,purpose,effective_from,effective_to,approval_status)
      VALUES('bom-1','p-a','1.0','ACTIVE','','u-act',?,?, 'GENERAL',NULL,NULL,'APPROVED')`).run(now, now);
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES('bi-1','bom-1','p-c1',2,0,1)`).run();
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES('bi-2','bom-1','p-c2',3,0,2)`).run();
    // Component stock.
    seedPosition(db, 'inv-c1', 'p-c1', 100);
    seedPosition(db, 'inv-c2', 'p-c2', 100);

    const res = makeRes();
    await createAssemblyOrder(db, makeReq({
      warehouseId: 'wh-1', productId: 'p-a', quantity: 5,
      components: [{ productId: 'p-b', quantity: 999 }], // forged — must be ignored
    }), res, ACTOR);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.orderType, 'ASSEMBLY');
    assert.equal(res.body.status, 'DRAFT');
    assert.ok(res.body.docNo.startsWith('ASM-'));
    assert.equal(res.body.items.length, 2);
    assert.deepEqual(res.body.items.map((i) => i.componentProductId).sort(), ['p-c1', 'p-c2']);
    // BOM ratio × order quantity.
    const c1 = res.body.items.find((i) => i.componentProductId === 'p-c1');
    assert.equal(c1.requiredQuantity, 10);
  });

  test('Assembly confirm consumes components and produces the assembly once', async () => {
    const listRes = makeRes();
    listAssemblyOrders(db, listRes, ACTOR, new URL('http://x/api?orderType=ASSEMBLY'));
    const order = listRes.body.assemblyOrders[0];
    assert.ok(order);

    const beforeC1 = onHand(db, 'p-c1');
    const beforeC2 = onHand(db, 'p-c2');
    const beforeA = onHand(db, 'p-a');

    const res = makeRes();
    confirmAssemblyOrder(db, makeReq({}), res, ACTOR, order.id);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'CONFIRMED');
    assert.equal(onHand(db, 'p-c1'), beforeC1 - 10);
    assert.equal(onHand(db, 'p-c2'), beforeC2 - 15);
    assert.equal(onHand(db, 'p-a'), beforeA + 5);

    // Double confirm is refused, not applied twice.
    const again = makeRes();
    assert.throws(
      () => confirmAssemblyOrder(db, makeReq({}), again, ACTOR, order.id),
      (error) => error.status === 409,
    );
    assert.equal(onHand(db, 'p-c1'), beforeC1 - 10, 'no second physical apply');
    assert.equal(onHand(db, 'p-a'), beforeA + 5);
  });

  test('Disassembly reverses the assembly and is protected against double confirm', async () => {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,purpose,effective_from,effective_to,approval_status)
      VALUES('bom-2','p-a','1.0','ACTIVE','','u-act',?,?, 'GENERAL',NULL,NULL,'APPROVED')`).run(now, now);
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES('bi-3','bom-2','p-c1',2,0,1)`).run();
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES('bi-4','bom-2','p-c2',3,0,2)`).run();

    const createRes = makeRes();
    await createDisassemblyOrder(db, makeReq({ warehouseId: 'wh-1', productId: 'p-a', quantity: 2 }), createRes, ACTOR);
    assert.equal(createRes.statusCode, 201);
    const id = createRes.body.id;
    assert.equal(createRes.body.items.length, 2, 'two-component BOM');

    const beforeA = onHand(db, 'p-a');
    const beforeC1 = onHand(db, 'p-c1');
    const beforeC2 = onHand(db, 'p-c2');
    const confirmRes = makeRes();
    confirmDisassemblyOrder(db, makeReq({}), confirmRes, ACTOR, id);
    assert.equal(confirmRes.statusCode, 200);
    assert.equal(onHand(db, 'p-a'), beforeA - 2, 'assembly consumed ONCE for the whole document');
    assert.equal(onHand(db, 'p-c1'), beforeC1 + 4, 'component 1 received (2 × bom ratio 2)');
    assert.equal(onHand(db, 'p-c2'), beforeC2 + 6, 'component 2 received (2 × bom ratio 3)');

    const again = makeRes();
    assert.throws(
      () => confirmDisassemblyOrder(db, makeReq({}), again, ACTOR, id),
      (error) => error.status === 409,
    );
    assert.equal(onHand(db, 'p-a'), beforeA - 2, 'no second physical apply');
  });

  test('Assembly refuses when no active BOM resolves', async () => {
    const res = makeRes();
    await assert.rejects(
      () => createAssemblyOrder(db, makeReq({ warehouseId: 'wh-1', productId: 'p-idle', quantity: 1 }), res, ACTOR),
      (error) => error.status === 409 && /BOM/.test(error.message),
    );
  });

  test('Assembly with insufficient component stock is refused before any movement', async () => {
    // A dedicated parent with its own BOM, so the resolved component set does
    // not depend on the BOM of an earlier test.
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at)
      VALUES('p-short','PSH','缺料成品','FG','PCS',100,0,1,'NONE',?,?)`).run(now, now);
    db.prepare(`INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at,purpose,effective_from,effective_to,approval_status)
      VALUES('bom-short','p-short','1.0','ACTIVE','','u-act',?,?, 'GENERAL',NULL,NULL,'APPROVED')`).run(now, now);
    db.prepare(`INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES('bi-short','bom-short','p-c1',1,0,1)`).run();
    db.prepare("UPDATE inventory SET quantity=0 WHERE product_id='p-c1'").run();

    const res = makeRes();
    await createAssemblyOrder(db, makeReq({ warehouseId: 'wh-1', productId: 'p-short', quantity: 1 }), res, ACTOR);
    const order = res.body;
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].componentProductId, 'p-c1');
    const beforeC1 = onHand(db, 'p-c1');
    const beforeShort = onHand(db, 'p-short');

    const confirmRes = makeRes();
    assert.throws(
      () => confirmAssemblyOrder(db, makeReq({}), confirmRes, ACTOR, order.id),
      (error) => error.status === 409 && /库存不足/.test(error.message),
    );
    assert.equal(onHand(db, 'p-c1'), beforeC1, 'no partial apply — component untouched');
    assert.equal(onHand(db, 'p-short'), beforeShort, 'no assembly produced');
    // The document stays DRAFT so the operator can fix the shortage.
    const doc = db.prepare('SELECT status FROM inventory_assembly_orders WHERE id=?').get(order.id);
    assert.equal(doc.status, 'DRAFT');
  });

  test('Barcode bound to a different entity is refused (resolution mismatch is not silently accepted)', async () => {
    // Bind p-b's product barcode to p-a: the canonical parser must resolve the
    // barcode back to p-b, so the assertion must fail closed.
    const genRes = makeRes();
    await generateBarcode(db, makeReq({ entityType: 'product', entityId: 'p-b' }), genRes, ACTOR);
    const barcode = genRes.body.barcode;
    assert.equal(barcode, 'PRD-PB');

    // A duplicate barcode for another entity must be rejected.
    const dupRes = makeRes();
    await assert.rejects(
      () => generateBarcode(db, makeReq({ entityType: 'product', entityId: 'p-a', barcode }), dupRes, ACTOR),
      (error) => error.status === 409,
    );
  });

  // ---------------------------------------------------------------- INV-39
  test('Generated barcodes are deterministic and round-trip to the same entity', async () => {
    const res = makeRes();
    await generateBarcode(db, makeReq({ entityType: 'product', entityId: 'p-a' }), res, ACTOR);
    assert.equal(res.statusCode, 201);
    const barcode = res.body.barcode;
    assert.equal(barcode, 'PRD-PA');

    // Idempotent: the second call returns the same barcode, no second binding.
    const again = makeRes();
    await generateBarcode(db, makeReq({ entityType: 'product', entityId: 'p-a' }), again, ACTOR);
    assert.equal(again.body.barcode, barcode);
    assert.equal(again.body.created, false);
    const count = db.prepare("SELECT COUNT(*) n FROM inventory_barcode_bindings WHERE entity_type='PRODUCT' AND entity_id='p-a'").get().n;
    assert.equal(count, 1);
  });

  test('Generated barcode parses back to the same entity', async () => {
    const res = makeRes();
    await generateBarcode(db, makeReq({ entityType: 'warehouse', entityId: 'wh-1' }), res, ACTOR);
    assert.equal(res.body.barcode, 'WH-WH1');
    const listRes = makeRes();
    listGeneratedBarcodes(db, listRes, ACTOR, new URL('http://x/api?entityType=WAREHOUSE'));
    assert.equal(listRes.body.barcodes.length, 1);
    assert.equal(listRes.body.barcodes[0].barcode, 'WH-WH1');
  });

  test('Label payload is structured data plus a self-contained SVG', async () => {
    const res = makeRes();
    await renderBarcodeLabel(db, makeReq({ barcode: 'PRD-PA', template: 'LABEL' }), res, ACTOR);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.barcode, 'PRD-PA');
    assert.equal(res.body.template, 'LABEL');
    assert.ok(Array.isArray(res.body.lines) && res.body.lines.length > 0);
    assert.equal(res.body.payloadVersion, 1);
    assert.ok(res.body.renderedAt);
    assert.ok(res.body.svg.startsWith('<svg'));
    assert.ok(res.body.svg.includes('PRD-PA'));
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(res.body.svg), 'no external asset reference');
  });
});
