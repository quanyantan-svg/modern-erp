import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { listTrackingIdentities, saveTrackedAllocations, sourceTrackingAllocations, traceIdentity } from './modules/traceability-quality.js';
import { TRACKING_POLICIES, copySourceAllocations, trackingPolicyOf, trackingPresentation, withProductTracking } from '../src/lib/tracking.js';

describe('V1.4-E4 product tracking presentation', () => {
  let handle; let db;
  const at = '2026-09-27T00:00:00.000Z';
  before(() => {
    handle = createTempDb({ label: 'v14-e4' }); db = handle.db;
    const insert = db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,tracking_policy,created_at,updated_at) VALUES(?,?,?,'测试','个',100,0,1,?,?,?)");
    insert.run('none-e4', 'NONE-E4', '普通货品', 'NONE', at, at);
    insert.run('lot-e4', 'LOT-E4', '批次货品', 'LOT', at, at);
    insert.run('serial-e4', 'SER-E4', '序列货品', 'SERIAL', at, at);
  });
  after(() => handle.cleanup());

  test('internal enums have one shared Chinese presentation mapping and product changes clear stale allocations', () => {
    assert.deepEqual(Object.keys(TRACKING_POLICIES), ['NONE', 'LOT', 'SERIAL']);
    assert.equal(trackingPresentation('NONE').label, '不跟踪');
    assert.equal(trackingPresentation('LOT').label, '批次管理');
    assert.equal(trackingPresentation('SERIAL').label, '序列号管理');
    assert.equal(trackingPolicyOf({ tracking_policy: 'LOT' }), 'LOT');
    assert.deepEqual(withProductTracking({ productId: 'old', trackingAllocations: [{ lotId: 'stale' }] }, 'new').trackingAllocations, []);
  });

  test('NONE never creates placeholder identities and rejects accidental identity payloads', () => {
    assert.deepEqual(saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'none', sourceItemId: 'none-line', productId: 'none-e4', quantity: 2, allocations: [] }), []);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM tracked_source_allocations WHERE source_id='none'").get().n, 0);
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'bad-none', sourceItemId: 'bad-none-line', productId: 'none-e4', quantity: 1, allocations: [{ lotCode: 'SHOULD-NOT-EXIST', quantity: 1 }] }), (error) => error.code === 'TRACKING_POLICY_MISMATCH');
  });

  test('tracked lines return structured missing, mismatch and duplicate errors', () => {
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'lot-missing', sourceItemId: 'line', productId: 'lot-e4', quantity: 1, allocations: [] }), (error) => error.code === 'LOT_REQUIRED' && Boolean(error.resolution));
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'serial-missing', sourceItemId: 'line', productId: 'serial-e4', quantity: 1, allocations: [] }), (error) => error.code === 'SERIAL_REQUIRED');
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'lot-mismatch', sourceItemId: 'line', productId: 'lot-e4', quantity: 2, allocations: [{ lotCode: 'LOT-X', quantity: 1 }] }), (error) => error.code === 'TRACKING_QUANTITY_MISMATCH');
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'serial-dup', sourceItemId: 'line', productId: 'serial-e4', quantity: 2, allocations: [{ serialNumber: 'SN-X' }, { serialNumber: 'SN-X' }] }), (error) => error.code === 'SERIAL_DUPLICATE');
  });

  test('draft source allocations round-trip as business DTOs and identity lists expose business codes', () => {
    saveTrackedAllocations(db, { sourceType: 'TEST', sourceId: 'lot-ok', sourceItemId: 'line', productId: 'lot-e4', quantity: 2, allocations: [{ lotCode: 'LOT-E4-001', quantity: 2 }] });
    const allocations = sourceTrackingAllocations(db, 'TEST', 'lot-ok', 'line');
    assert.equal(allocations[0].lotCode, 'LOT-E4-001');
    assert.deepEqual(copySourceAllocations(allocations)[0], { lotId: null, lotCode: 'LOT-E4-001', serialId: null, serialNumber: '', quantity: 2, manufactureDate: null, expiryDate: null, supplierLotReference: null });
    db.prepare("INSERT INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at) VALUES('lot-id-e4','lot-e4','LOT-E4-001','AVAILABLE','PURCHASE_RECEIPT','receipt-e4',?)").run(at);
    const row = listTrackingIdentities(db, 'LOT', 'LOT-E4')[0];
    assert.equal(row.identityCode, 'LOT-E4-001');
    assert.equal(Object.hasOwn(row, 'productName'), true);
  });

  test('traceability presents actual business numbers and labels evidence-free identities as legacy incomplete', () => {
    db.prepare("INSERT INTO purchase_receipts(id,receipt_no,supplier_id,warehouse_id,handler_id,status,receipt_date,creator_id,created_at,updated_at) VALUES('receipt-e4','RC-E4-001','supplier-001','warehouse-001','user-admin','CONFIRMED','2026-09-27','user-admin',?,?)").run(at, at);
    db.prepare("INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,business_date,created_at) VALUES('move-e4','PURCHASE_RECEIPT','receipt-e4','line','lot-e4','warehouse-001','IN',2,'lot-id-e4','2026-09-27',?)").run(at);
    const proven = traceIdentity(db, 'LOT', 'lot-id-e4');
    assert.equal(proven.movements[0].sourceDocumentNo, 'RC-E4-001');
    assert.equal(proven.provenance.code, 'COMPLETE');
    db.prepare("INSERT INTO inventory_lots(id,product_id,lot_code,status,created_source_type,created_source_id,created_at) VALUES('legacy-lot-e4','lot-e4','LEGACY-E4','AVAILABLE','LEGACY','unknown-source',?)").run(at);
    const legacy = traceIdentity(db, 'LOT', 'legacy-lot-e4');
    assert.equal(legacy.provenance.code, 'LEGACY_INCOMPLETE');
    assert.match(legacy.legacyNotice, /历史数据/);
    assert.deepEqual(legacy.genealogy, []);
  });

  test('all primary transaction screens use the bounded shared editor and inventory movements show identities', () => {
    const files = ['master-data.jsx', 'logistics-finance.jsx', 'inventory-extensions.jsx', 'manufacturing.jsx'].map((name) => readFileSync(new URL(`../src/pages/${name}`, import.meta.url), 'utf8'));
    for (const source of files) assert.match(source, /TrackingAllocationEditor/);
    assert.match(files[1], /批次 \/ 序列号/);
    assert.match(readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8'), /tracking-editor/);
  });
});
