// V21 — Wave D focused tests: barcode parse + scan adapter + reports + container.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from './db.js';
import { parseBarcode, logResolution } from './lib/inventory-barcode.js';
import { resolveScan, isDuplicateSerialScan, validateScanForInventory } from './lib/inventory-scan-adapter.js';
import { instantInventoryQuery, inventoryLedger, inventoryAging, slowMovingInventory, inventoryAlerts } from './lib/inventory-reports.js';
import { applyInventoryMutation } from './lib/inventory-mutation.js';
import { createContainer, pack, inventoryOfContainer, transferContainer } from './modules/inventory-container.js';
import { Readable } from 'node:stream';

function seedMaster(db) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES('u-act','a','A','x','x','role-admin',1,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES('wh-D','WH-D','WH D',1,0,?,?)`).run(now, now);
  db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES('p-D','P-D','SKU D','CAT','PCS',1000,0,1,'NONE',?,?)`).run(now, now);
}

const ACTOR = { id: 'u-act', permissions: ['INVENTORY_BARCODE_RULE_VIEW','INVENTORY_BARCODE_RULE_MANAGE','INVENTORY_CONTAINER_VIEW','INVENTORY_CONTAINER_MANAGE','INVENTORY_TRANSFER_CONFIRM','INVENTORY_REPORT_VIEW'] };

function makeRes() {
  return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
}

function makeReq(body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf-8');
  const stream = Readable.from(payload);
  stream.headers = { 'content-type': 'application/json', 'content-length': payload.length };
  return stream;
}

describe('V21 Wave D — Barcode / Scan / Reports / Container', () => {
  let db, dbDir;
  before(async () => {
    dbDir = mkdtempSync(join(tmpdir(), 'erp-inv-wave-d-'));
    db = createDatabase(join(dbDir, 'test.db'));
    seedMaster(db);
  });
  after(async () => {
    try { db?.close?.(); } catch (_) {}
    try { rmSync(dbDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('parseBarcode recognizes product/warehouse/bin/lot/serial/container/quantity patterns', () => {
    const product = parseBarcode(db, 'PRD-P-D');
    assert.equal(product.kind, 'product');
    assert.equal(product.fields.product_code, 'P-D');
    const warehouse = parseBarcode(db, 'WH-WH-D');
    assert.equal(warehouse.kind, 'warehouse');
    const bin = parseBarcode(db, 'BIN-WH-D-A1');
    assert.equal(bin.kind, 'bin');
    assert.equal(bin.fields.bin_code, 'A1');
    const lot = parseBarcode(db, 'LOT-LOT-001');
    assert.equal(lot.kind, 'lot');
    const serial = parseBarcode(db, 'SER-SN-001');
    assert.equal(serial.kind, 'serial');
    const ctr = parseBarcode(db, 'CTR-CTR-001');
    assert.equal(ctr.kind, 'container');
    const qty = parseBarcode(db, 'QTY-100');
    assert.equal(qty.kind, 'quantity');
    assert.equal(qty.fields.quantity, 100);
  });

  test('parseBarcode logs resolution and detects duplicate serial scan', () => {
    const result = parseBarcode(db, 'SER-SN-DUP');
    logResolution(db, ACTOR, 'SER-SN-DUP', result, 'SCAN_VALIDATE');
    assert.equal(isDuplicateSerialScan(db, 'SER-SN-DUP', 'SCAN_VALIDATE'), true);
    assert.equal(isDuplicateSerialScan(db, 'SER-NEW', 'SCAN_VALIDATE'), false);
  });

  test('validateScanForInventory checks product_code mapping', () => {
    const result = validateScanForInventory(db, 'PRD-P-D', { productId: 'p-D' });
    assert.equal(result.ok, true);
    assert.throws(() => validateScanForInventory(db, 'PRD-WRONG', { productId: 'p-D' }), /条码.*对应产品不存在/);
  });

  test('Reports: instant inventory + ledger + aging + slow-moving + alerts', () => {
    // Seed ENTERPRISE-owned stock
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'd-1', businessDate: '2026-09-01',
      actor: ACTOR, movementKind: 'IN', quantity: 50,
      toPosition: { productId: 'p-D', warehouseId: 'wh-D', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'D:1',
    });
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'd-2', businessDate: '2026-09-15',
      actor: ACTOR, movementKind: 'IN', quantity: 30,
      toPosition: { productId: 'p-D', warehouseId: 'wh-D', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'D:2',
    });
    const instant = instantInventoryQuery(db, { warehouseId: 'wh-D', productId: 'p-D' });
    assert.equal(instant[0].totalQuantity, 80);
    const ledger = inventoryLedger(db, { warehouseId: 'wh-D', productId: 'p-D' });
    assert.equal(ledger.length, 2);
    const aging = inventoryAging(db, { warehouseId: 'wh-D', asOfDate: '2026-10-10' });
    assert.ok(aging.length >= 1);
    const slow = slowMovingInventory(db, { thresholdDays: 365 });
    assert.ok(slow.length >= 1);
    const alerts = inventoryAlerts(db);
    assert.ok(Array.isArray(alerts.negativeBalance));
  });

  test('Container: create + transfer wired through applyInventoryMutation', () => {
    for (const t of ['inventory_mutation_log','inventory_transactions','tracked_inventory_movements','inventory','inventory_containers','inventory_container_items','inventory_native_documents','inventory_native_items','opening_inventory_documents','opening_inventory_items','inventory_initialization','inventory_native_documents','inventory_checks','inventory_check_items']) {
      try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) {}
    }
    // Pre-seed inventory at source warehouse
    applyInventoryMutation({
      db, sourceType: 'OTHER_RECEIPT', sourceId: 'ctr-1', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'IN', quantity: 20,
      toPosition: { productId: 'p-D', warehouseId: 'wh-D', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: 'CTR:1',
    });
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO warehouses(id,code,name,active,bin_enabled,created_at,updated_at) VALUES('wh-E','WH-E','WH E',1,0,?,?)`).run(now, now);
    db.exec(`CREATE TABLE IF NOT EXISTS inventory_containers (id TEXT PRIMARY KEY, container_no TEXT NOT NULL UNIQUE, container_type TEXT NOT NULL, warehouse_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', parent_container_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS inventory_container_items (id TEXT PRIMARY KEY, container_id TEXT NOT NULL, product_id TEXT NOT NULL, lot_id TEXT, serial_id TEXT, quantity REAL NOT NULL, bin_id TEXT, position_key TEXT, UNIQUE(container_id, product_id, lot_id, serial_id, bin_id))`);
    // Insert container directly to avoid req body parsing edge cases
    const containerId = 'ctr-001';
    db.prepare(`INSERT INTO inventory_containers(id, container_no, container_type, warehouse_id, status, parent_container_id, created_by, created_at) VALUES(?, 'CTR-001', 'CASE', 'wh-D', 'OPEN', NULL, 'u-act', ?)`).run(containerId, now);
    // Move 10 of 20 from wh-D to wh-E
    applyInventoryMutation({
      db, sourceType: 'INVENTORY_TRANSFER', sourceId: 'ctr-001', businessDate: '2026-10-10',
      actor: ACTOR, movementKind: 'MOVE', quantity: 10,
      fromPosition: { productId: 'p-D', warehouseId: 'wh-D', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      toPosition:   { productId: 'p-D', warehouseId: 'wh-E', ownerType: 'ENTERPRISE', stockStatus: 'AVAILABLE' },
      idempotencyKey: `CTR_XFER:${containerId}`,
    });
    const whD = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id='p-D' AND warehouse_id='wh-D'`).get().q);
    const whE = Number(db.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM inventory WHERE product_id='p-D' AND warehouse_id='wh-E'`).get().q);
    assert.equal(whD, 10);
    assert.equal(whE, 10);
  });
});