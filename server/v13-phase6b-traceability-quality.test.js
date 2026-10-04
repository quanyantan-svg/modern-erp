import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';
import { APPROVAL_DOCUMENT_TYPES } from './modules/approvals.js';
import {
  allocateGenealogy, calculateSampleQuantity, changeTrackingPolicy, createQcp, freezeQualityPolicy,
  holdIdentity, postTrackedMovement, reconcileTrackedInventory, resolveQualityPolicy,
  saveTrackedAllocations, traceIdentity, trackingSnapshot, transferTrackedInventory,
} from './modules/traceability-quality.js';

describe('V1.3 Phase 6B lot, serial, genealogy and configurable quality', () => {
  let handle; let db;
  const admin = { id: 'user-admin', roleCode: 'ADMIN', permissions: ['INVENTORY_VIEW','PRODUCTION_RECEIPT_MANAGE'] };
  const warehouse = { id: 'user-warehouse', roleCode: 'WAREHOUSE', permissions: ['INVENTORY_VIEW','WAREHOUSES_MANAGE','PRODUCTION_RECEIPT_MANAGE'] };
  const at = '2026-09-24T00:00:00.000Z';
  const addProduct = (id, code) => db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES(?,?,?,'测试','个',100,0,1,?,?)").run(id, code, code, at, at);
  const stock = (warehouseId, productId, quantity) => db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(warehouse_id,product_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(`inv-${warehouseId}-${productId}`, warehouseId, productId, quantity, at);

  before(() => { handle = createTempDb({ label: 'v13-p6b' }); db = handle.db; for (const [id, code] of [['p-lot','LOT-P'],['p-serial','SER-P'],['fg-serial','X100-FG'],['p-none','NONE-P'],['p-safe','SAFE-P']]) addProduct(id, code); });
  after(() => handle.cleanup());

  test('schema is additive; legacy products default NONE; roles and approval families remain canonical', () => {
    for (const table of ['inventory_lots','inventory_lot_balances','inventory_serials','tracked_source_allocations','tracked_inventory_movements','tracked_identity_hold_history','production_genealogy_allocations','quality_control_points','quality_control_criteria','logistics_quality_policy_snapshots','inspection_criteria_snapshots']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    assert.equal(db.prepare("SELECT tracking_policy FROM products WHERE id='p-none'").get().tracking_policy, 'NONE');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM roles').get().n, 5);
    assert.deepEqual(APPROVAL_DOCUMENT_TYPES, ['SALES_ORDER','PURCHASE_ORDER','INVENTORY_CHECK','ACCOUNTING_VOUCHER','PURCHASE_REQUISITION']);
  });

  test('tracking policy changes require zero stock/open execution and create immutable audit history', () => {
    const lot = changeTrackingPolicy(db, admin, 'p-lot', { policy: 'LOT', shelfLifeDays: 30, reason: '启用批次追溯' }); assert.equal(lot.trackingPolicy, 'LOT');
    const serial = changeTrackingPolicy(db, admin, 'p-serial', { policy: 'SERIAL', reason: '启用单件追溯' }); assert.equal(serial.trackingPolicy, 'SERIAL');
    stock('warehouse-001', 'p-safe', 1); assert.throws(() => changeTrackingPolicy(db, admin, 'p-safe', { policy: 'LOT', reason: '不安全' }), /库存必须为 0/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM product_tracking_policy_history WHERE product_id IN ('p-lot','p-serial')").get().n, 2);
  });

  test('LOT receipt is exact, idempotent, reconciled, FEFO-aware, and HOLD/expiry blocks outbound with zero side effect', () => {
    saveTrackedAllocations(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-lot', sourceItemId: 'ri-lot', productId: 'p-lot', quantity: 3, allocations: [{ lotCode: 'LOT-A', quantity: 2, manufactureDate: '2026-09-01' }, { lotCode: 'LOT-B', quantity: 1, expiryDate: '2026-09-23' }] });
    postTrackedMovement(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-lot', sourceItemId: 'ri-lot', productId: 'p-lot', warehouseId: 'warehouse-001', quantity: 3, direction: 'IN', businessDate: '2026-09-24' }); stock('warehouse-001', 'p-lot', 3);
    const lotA = db.prepare("SELECT * FROM inventory_lots WHERE product_id='p-lot' AND lot_code='LOT-A'").get(); const lotB = db.prepare("SELECT * FROM inventory_lots WHERE product_id='p-lot' AND lot_code='LOT-B'").get();
    assert.equal(lotA.expiry_date, '2026-10-01'); assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_lots WHERE product_id='p-lot'").get().n, 2);
    postTrackedMovement(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-lot', sourceItemId: 'ri-lot', productId: 'p-lot', warehouseId: 'warehouse-001', quantity: 3, direction: 'IN', businessDate: '2026-09-24' }); assert.equal(db.prepare("SELECT SUM(quantity) n FROM inventory_lot_balances WHERE product_id='p-lot'").get().n, 3);
    holdIdentity(db, warehouse, 'LOT', lotA.id, 'HOLD', '待复核');
    saveTrackedAllocations(db, { sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: 'issue-hold', sourceItemId: 'issue-hold-item', productId: 'p-lot', quantity: 1, allocations: [{ lotId: lotA.id, quantity: 1 }] });
    const before = db.prepare("SELECT quantity FROM inventory_lot_balances WHERE lot_id=?").get(lotA.id).quantity; assert.throws(() => postTrackedMovement(db, { sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: 'issue-hold', sourceItemId: 'issue-hold-item', productId: 'p-lot', warehouseId: 'warehouse-001', quantity: 1, direction: 'OUT', businessDate: '2026-09-24' }), /HOLD/); assert.equal(db.prepare("SELECT quantity FROM inventory_lot_balances WHERE lot_id=?").get(lotA.id).quantity, before);
    holdIdentity(db, warehouse, 'LOT', lotA.id, 'RELEASE', '复核合格');
    saveTrackedAllocations(db, { sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: 'issue-expired', sourceItemId: 'issue-expired-item', productId: 'p-lot', quantity: 1, allocations: [{ lotId: lotB.id, quantity: 1 }] });
    assert.throws(() => postTrackedMovement(db, { sourceType: 'PRODUCTION_MATERIAL_ISSUE', sourceId: 'issue-expired', sourceItemId: 'issue-expired-item', productId: 'p-lot', warehouseId: 'warehouse-001', quantity: 1, direction: 'OUT', businessDate: '2026-09-24' }), /过期/);
    assert.deepEqual(reconcileTrackedInventory(db), { ok: true, mode: 'CHECK', mismatches: [] });
  });

  test('SERIAL receipt requires exact unique units; transfer moves location and scrap preserves identity', () => {
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-bad', sourceItemId: 'ri-bad', productId: 'p-serial', quantity: 2, allocations: [{ serialNumber: 'SN-1' }] }), /数量必须/);
    assert.throws(() => saveTrackedAllocations(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-dup', sourceItemId: 'ri-dup', productId: 'p-serial', quantity: 2, allocations: [{ serialNumber: 'SN-X' }, { serialNumber: 'SN-X' }] }), /不能重复/);
    saveTrackedAllocations(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-ser', sourceItemId: 'ri-ser', productId: 'p-serial', quantity: 3, allocations: ['SN-1','SN-2','SN-3'].map((serialNumber) => ({ serialNumber })) });
    postTrackedMovement(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'r-ser', sourceItemId: 'ri-ser', productId: 'p-serial', warehouseId: 'warehouse-001', quantity: 3, direction: 'IN', businessDate: '2026-09-24' }); stock('warehouse-001', 'p-serial', 3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_serials WHERE product_id='p-serial'").get().n, 3);
    const sn1 = db.prepare("SELECT * FROM inventory_serials WHERE serial_number='SN-1'").get();
    saveTrackedAllocations(db, { sourceType: 'INVENTORY_TRANSFER', sourceId: 'tr-1', sourceItemId: 'tri-1', productId: 'p-serial', quantity: 1, allocations: [{ serialId: sn1.id }] });
    transferTrackedInventory(db, { sourceId: 'tr-1', sourceItemId: 'tri-1', productId: 'p-serial', fromWarehouseId: 'warehouse-001', toWarehouseId: 'warehouse-002', quantity: 1, businessDate: '2026-09-24' });
    assert.equal(db.prepare('SELECT current_warehouse_id FROM inventory_serials WHERE id=?').get(sn1.id).current_warehouse_id, 'warehouse-002');
    saveTrackedAllocations(db, { sourceType: 'INVENTORY_SCRAP', sourceId: 'scrap-1', sourceItemId: 'scrapi-1', productId: 'p-serial', quantity: 1, allocations: [{ serialId: sn1.id }] });
    postTrackedMovement(db, { sourceType: 'INVENTORY_SCRAP', sourceId: 'scrap-1', sourceItemId: 'scrapi-1', productId: 'p-serial', warehouseId: 'warehouse-002', quantity: 1, direction: 'OUT', businessDate: '2026-09-24' });
    assert.equal(db.prepare('SELECT lifecycle_state FROM inventory_serials WHERE id=?').get(sn1.id).lifecycle_state, 'SCRAPPED');
  });

  test('tracked movement makes policy immutable and CHECK reports synthetic mismatch without repair', () => {
    assert.throws(() => changeTrackingPolicy(db, admin, 'p-lot', { policy: 'SERIAL', reason: '错误切换' }), /已有批次/);
    const before = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='p-lot'").get().quantity; db.prepare("UPDATE inventory SET quantity=99 WHERE warehouse_id='warehouse-001' AND product_id='p-lot'").run();
    const report = reconcileTrackedInventory(db); assert.equal(report.ok, false); assert.equal(report.mismatches[0].canonicalQuantity, 99); assert.equal(db.prepare("SELECT quantity FROM inventory WHERE warehouse_id='warehouse-001' AND product_id='p-lot'").get().quantity, 99);
    stock('warehouse-001', 'p-lot', before);
  });

  test('QCP default is REQUIRED; product waiver is explicit/admin-only; resolution, version snapshot and sampling are deterministic', () => {
    const incoming = resolveQualityPolicy(db, 'PURCHASE_RECEIPT', 'p-lot', '2026-09-24'); assert.equal(incoming.inspectionRequired, true); assert.equal(incoming.samplingMode, 'FULL');
    assert.throws(() => createQcp(db, warehouse, { code: 'WAIVE', operationType: 'PURCHASE_RECEIPT', scope: 'PRODUCT', productId: 'p-lot', inspectionRequired: false, samplingMode: 'FULL', remarks: '免检' }), /管理员/);
    const waiver = createQcp(db, admin, { code: 'WAIVE-LOT', name: '产品免检', operationType: 'PURCHASE_RECEIPT', scope: 'PRODUCT', productId: 'p-lot', inspectionRequired: false, samplingMode: 'PERCENTAGE', samplingValue: 10, effectiveFrom: '2026-09-24', remarks: '供应商认证免检' });
    assert.equal(resolveQualityPolicy(db, 'PURCHASE_RECEIPT', 'p-lot', '2026-09-23').inspectionRequired, true); assert.equal(resolveQualityPolicy(db, 'PURCHASE_RECEIPT', 'p-lot', '2026-09-24').qcpId, waiver.id);
    const frozen = freezeQualityPolicy(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'quality-doc', sourceItemId: 'quality-line', productId: 'p-lot', businessDate: '2026-09-24' });
    createQcp(db, admin, { code: 'WAIVE-LOT', name: '恢复检验', operationType: 'PURCHASE_RECEIPT', scope: 'PRODUCT', productId: 'p-lot', inspectionRequired: true, samplingMode: 'FIXED_QUANTITY', samplingValue: 2, effectiveFrom: '2026-09-25', remarks: '新版本' });
    assert.equal(db.prepare('SELECT qcp_version FROM logistics_quality_policy_snapshots WHERE id=?').get(frozen.id).qcp_version, 1);
    assert.equal(calculateSampleQuantity(7, 'FULL'), 7); assert.equal(calculateSampleQuantity(7, 'FIXED_QUANTITY', 10), 7); assert.equal(calculateSampleQuantity(7, 'PERCENTAGE', 10), 1); assert.throws(() => calculateSampleQuantity(7, 'PERCENTAGE', 0), /不正确/);
  });

  test('tracked inspection snapshot is exact and changes when lot/serial selection changes', () => {
    saveTrackedAllocations(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'snap-r', sourceItemId: 'snap-i', productId: 'p-lot', quantity: 1, allocations: [{ lotCode: 'SNAP-A', quantity: 1 }] });
    const first = trackingSnapshot(db, 'PURCHASE_RECEIPT', 'snap-r', 'snap-i');
    saveTrackedAllocations(db, { sourceType: 'PURCHASE_RECEIPT', sourceId: 'snap-r', sourceItemId: 'snap-i', productId: 'p-lot', quantity: 1, allocations: [{ lotCode: 'SNAP-B', quantity: 1 }] });
    assert.notEqual(trackingSnapshot(db, 'PURCHASE_RECEIPT', 'snap-r', 'snap-i'), first);
  });

  test('genealogy enforces issued quantity and exact serial single allocation; forward/backward trace uses authoritative links', () => {
    changeTrackingPolicy(db, admin, 'fg-serial', { policy: 'SERIAL', reason: 'X100 成品单件追溯' });
    const now = at; db.prepare("INSERT INTO production_orders(id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,source_type) VALUES('po-x100','PO-X100','fg-serial',3,'IN_PROGRESS','','user-warehouse',?,?, 'MANUAL')").run(now, now);
    db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,remark,creator_id,created_at,updated_at,confirmed_by,confirmed_at) VALUES('mi-x100','MI-X100','po-x100','warehouse-001','CONFIRMED','2026-09-24','','user-warehouse',?,?, 'user-warehouse',?)").run(now, now, now);
    db.prepare("INSERT INTO production_material_issue_items(id,issue_id,product_id,planned_quantity,issue_quantity,line_no,requirement_line_id) VALUES('mii-x100','mi-x100','p-lot',3,3,1,'req-x100')").run();
    const lotA = db.prepare("SELECT id FROM inventory_lots WHERE product_id='p-lot' AND lot_code='LOT-A'").get();
    db.prepare("INSERT INTO tracked_inventory_movements(id,source_type,source_id,source_item_id,product_id,warehouse_id,direction,quantity,lot_id,business_date,created_at) VALUES('tm-gene','PRODUCTION_MATERIAL_ISSUE','mi-x100','mii-x100','p-lot','warehouse-001','OUT',3,?,'2026-09-24',?)").run(lotA.id, now);
    db.prepare("INSERT INTO production_receipts(id,receipt_no,production_order_id,product_id,warehouse_id,quantity,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_by,confirmed_at) VALUES('pr-x100','PR-X100','po-x100','fg-serial','warehouse-001',3,'CONFIRMED','2026-09-24','','user-warehouse',?,?, 'user-warehouse',?)").run(now, now, now);
    for (const n of [1,2,3]) db.prepare("INSERT INTO inventory_serials(id,product_id,serial_number,created_source_type,created_source_id,created_source_item_id,lifecycle_state,current_warehouse_id,updated_at,created_at) VALUES(?,?,?,?,?,?,'AVAILABLE','warehouse-001',?,?)").run(`fg-sn-${n}`, 'fg-serial', `X100-SN-000${n}`, 'PRODUCTION_RECEIPT', 'pr-x100', 'pr-x100', now, now);
    for (const n of [1,2,3]) allocateGenealogy(db, warehouse, { productionOrderId: 'po-x100', outputReceiptId: 'pr-x100', outputSerialId: `fg-sn-${n}`, materialIssueItemId: 'mii-x100', inputLotId: lotA.id, quantity: 1 });
    assert.throws(() => allocateGenealogy(db, warehouse, { productionOrderId: 'po-x100', outputReceiptId: 'pr-x100', outputSerialId: 'fg-sn-1', materialIssueItemId: 'mii-x100', inputLotId: lotA.id, quantity: 1 }), /超过/);
    const backward = traceIdentity(db, 'SERIAL', 'fg-sn-1', 'BACKWARD'); assert.equal(backward.genealogy[0].input_lot_id, lotA.id);
    const forward = traceIdentity(db, 'LOT', lotA.id, 'FORWARD'); assert.equal(forward.genealogy.length, 3);
  });

  test('X100 focused UAT exposes three exact finished serials from the PCB lot and preserves remaining identities', () => {
    const impact = traceIdentity(db, 'LOT', db.prepare("SELECT id FROM inventory_lots WHERE lot_code='LOT-A'").get().id, 'FORWARD');
    assert.deepEqual(impact.genealogy.map((x) => x.output_serial_id).sort(), ['fg-sn-1','fg-sn-2','fg-sn-3']);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM inventory_serials WHERE product_id='fg-serial' AND lifecycle_state='AVAILABLE'").get().n, 3);
  });

  test('UI and documentation expose Chinese tracking controls, mobile trace directions and legacy honesty', () => {
    // V1.7 P0: traceability label lives in applicationRegistry.js (not App.jsx).
    const registry = readFileSync(new URL('../src/navigation/applicationRegistry.js', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../src/pages/traceability.jsx', import.meta.url), 'utf8');
    const master = readFileSync(new URL('../src/pages/master-data.jsx', import.meta.url), 'utf8');
    const tracking = readFileSync(new URL('../src/lib/tracking.js', import.meta.url), 'utf8');
    assert.match(registry, /route\('traceability','批次 \/ 序列号追溯'/);
    assert.match(page, /向前追溯/);
    assert.match(page, /向后追溯/);
    assert.match(master, /trackingPresentation/);
    assert.match(tracking, /批次管理/);
    assert.match(tracking, /序列号管理/);
  });
});
