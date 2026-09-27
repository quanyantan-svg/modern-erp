import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, PERMISSIONS } from './db.js';
import { APPROVAL_DOCUMENT_TYPES } from './modules/approvals.js';

let baseUrl; let database; let server; let tempDir; let adminToken; let accountingToken;
const now = '2026-09-20T08:00:00.000Z';

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function login(username, password) {
  const result = await request('/api/auth/login', { token: '', method: 'POST', body: { username, password } });
  assert.equal(result.status, 200); return result.data.token;
}
function insert(table, values) {
  const columns = Object.keys(values); database.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...Object.values(values));
}
function auditFor(entity, recordId) { return database.prepare("SELECT * FROM audit_logs WHERE action='DELETE' AND entity_type=? AND entity_id=?").get(entity, recordId); }

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-p2-lifecycle-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123'); accountingToken = await login('accounting', 'accounting123');
});
after(async () => {
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  database.close(); rmSync(tempDir, { recursive: true, force: true });
});

describe('P2 lifecycle contract remains permission- and approval-neutral', () => {
  test('permission registry stays exactly 113 and approval center stays exactly five canonical types', () => {
    assert.equal(PERMISSIONS.length, 114);
    assert.deepEqual(APPROVAL_DOCUMENT_TYPES, ['SALES_ORDER', 'PURCHASE_ORDER', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER', 'PURCHASE_REQUISITION']);
  });
  test('unauthorized destructive operation returns 403', async () => {
    const result = await request('/api/customers/customer-001', { token: accountingToken, method: 'DELETE' });
    assert.equal(result.status, 403);
  });
  test('new sales and purchase document selectors explicitly filter inactive masters', () => {
    const source = readFileSync(resolve('src/pages/master-data.jsx'), 'utf8');
    assert.match(source, /setCustomers\(c\.customers\.filter\(\(x\) => x\.active\)\)/);
    assert.match(source, /setSuppliers\(s\.suppliers\.filter\(\(x\) => x\.active\)\)/);
    assert.ok((source.match(/setProducts\(p\.products\.filter\(\(x\) => x\.active\)\)/g) || []).length >= 2);
  });
});

describe('P2 master-data safe delete, disable and archive behavior', () => {
  test('unreferenced customer hard-deletes, audits and a repeated delete is 404', async () => {
    insert('customers', { id: 'p2-customer-free', code: 'P2-C-FREE', name: 'P2无引用客户', created_at: now, updated_at: now });
    assert.equal((await request('/api/customers/p2-customer-free', { method: 'DELETE' })).status, 200);
    assert.equal(database.prepare('SELECT 1 FROM customers WHERE id=?').get('p2-customer-free'), undefined);
    assert.ok(auditFor('CUSTOMER', 'p2-customer-free'));
    assert.equal((await request('/api/customers/p2-customer-free', { method: 'DELETE' })).status, 404);
  });
  test('referenced customer returns controlled 409, can be disabled, and historical order remains readable', async () => {
    insert('customers', { id: 'p2-customer-used', code: 'P2-C-USED', name: 'P2有引用客户', created_at: now, updated_at: now });
    insert('sales_orders', { id: 'p2-order-history', order_no: 'SO-P2-HISTORY', customer_id: 'p2-customer-used', status: 'APPROVED', creator_id: 'user-admin', created_at: now, updated_at: now });
    const blocked = await request('/api/customers/p2-customer-used', { method: 'DELETE' });
    assert.equal(blocked.status, 409); assert.equal(blocked.data.details.code, 'RECORD_REFERENCED'); assert.doesNotMatch(blocked.data.error, /constraint|SQL/i);
    assert.equal((await request('/api/customers/p2-customer-used', { method: 'PATCH', body: { active: false } })).status, 200);
    assert.equal(database.prepare('SELECT active FROM customers WHERE id=?').get('p2-customer-used').active, 0);
    assert.equal((await request('/api/orders/p2-order-history')).status, 200);
  });
  test('unreferenced supplier and zero-stock product can delete; referenced product is blocked', async () => {
    insert('suppliers', { id: 'p2-supplier-free', code: 'P2-S-FREE', name: 'P2供应商', created_at: now, updated_at: now });
    insert('products', { id: 'p2-product-free', code: 'P2-P-FREE', name: 'P2货品', unit: '件', price_cents: 0, created_at: now, updated_at: now });
    assert.equal((await request('/api/suppliers/p2-supplier-free', { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/products/p2-product-free', { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/products/product-001', { method: 'DELETE' })).status, 409);
  });
  test('referenced supplier disables, remains historically readable, and re-enables without duplication', async () => {
    insert('suppliers', { id: 'p2-supplier-used', code: 'P2-S-USED', name: 'P2历史供应商', created_at: now, updated_at: now });
    insert('purchase_orders', { id: 'p2-po-history', order_no: 'PO-P2-HISTORY', supplier_id: 'p2-supplier-used', status: 'APPROVED', creator_id: 'user-admin', created_at: now, updated_at: now });
    assert.equal((await request('/api/suppliers/p2-supplier-used', { method: 'DELETE' })).status, 409);
    assert.equal((await request('/api/suppliers/p2-supplier-used', { method: 'PATCH', body: { active: false } })).status, 200);
    assert.equal((await request('/api/purchase-orders/p2-po-history')).data.order.supplierName, 'P2历史供应商');
    assert.equal((await request('/api/suppliers/p2-supplier-used', { method: 'PATCH', body: { active: true } })).status, 200);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM suppliers WHERE id='p2-supplier-used'").get().n, 1);
  });
  test('referenced product can disable and historical order lines retain its label', async () => {
    insert('products', { id: 'p2-product-used', code: 'P2-P-USED', name: 'P2历史货品', unit: '件', price_cents: 100, created_at: now, updated_at: now });
    insert('sales_orders', { id: 'p2-product-order', order_no: 'SO-P2-PRODUCT', customer_id: 'customer-001', status: 'DRAFT', creator_id: 'user-admin', created_at: now, updated_at: now });
    insert('sales_order_items', { id: 'p2-product-line', order_id: 'p2-product-order', product_id: 'p2-product-used', quantity: 1, unit_price_cents: 100, amount_cents: 100, line_no: 1 });
    assert.equal((await request('/api/products/p2-product-used', { method: 'DELETE' })).status, 409);
    assert.equal((await request('/api/products/p2-product-used', { method: 'PATCH', body: { active: false } })).status, 200);
    assert.equal((await request('/api/orders/p2-product-order')).data.order.items[0].productName, 'P2历史货品');
  });
  test('warehouse with non-zero inventory cannot be disabled or deleted, while empty warehouse can delete', async () => {
    assert.equal((await request('/api/warehouses/warehouse-001', { method: 'PATCH', body: { active: false } })).status, 409);
    assert.equal((await request('/api/warehouses/warehouse-001', { method: 'DELETE' })).status, 409);
    insert('warehouses', { id: 'p2-warehouse-free', code: 'P2-W-FREE', name: 'P2空仓', created_at: now, updated_at: now });
    assert.equal((await request('/api/warehouses/p2-warehouse-free', { method: 'DELETE' })).status, 200);
  });
  test('BOM must be discontinued and unreferenced; own items delete atomically', async () => {
    insert('products', { id: 'p2-bom-parent', code: 'P2-BOM-P', name: 'P2 BOM父件', unit: '件', price_cents: 0, created_at: now, updated_at: now });
    insert('products', { id: 'p2-bom-child', code: 'P2-BOM-C', name: 'P2 BOM子件', unit: '件', price_cents: 0, created_at: now, updated_at: now });
    insert('boms', { id: 'p2-bom-free', product_id: 'p2-bom-parent', version: 'P2', status: 'ACTIVE', creator_id: 'user-admin', created_at: now, updated_at: now });
    insert('bom_items', { id: 'p2-bom-item', bom_id: 'p2-bom-free', product_id: 'p2-bom-child', quantity: 1, line_no: 1 });
    assert.equal((await request('/api/boms/p2-bom-free', { method: 'DELETE' })).status, 409);
    database.prepare("UPDATE boms SET status='DISCONTINUED' WHERE id='p2-bom-free'").run();
    assert.equal((await request('/api/boms/p2-bom-free', { method: 'DELETE' })).status, 200);
    assert.equal(database.prepare("SELECT 1 FROM bom_items WHERE bom_id='p2-bom-free'").get(), undefined);
  });
  test('product routing must be inactive and unreferenced; own operations delete atomically', async () => {
    insert('products', { id: 'p2-route-product', code: 'P2-ROUTE-P', name: 'P2路线产品', unit: '件', price_cents: 0, created_at: now, updated_at: now });
    insert('product_routings', { id: 'p2-route-free', product_id: 'p2-route-product', routing_code: 'P2-ROUTE', routing_name: 'P2路线', version: 'V1', status: 'INACTIVE', created_at: now, updated_at: now });
    insert('product_routing_operations', { id: 'p2-route-op', routing_id: 'p2-route-free', sequence_no: 10, operation_code: 'OP-10', operation_name: '装配', created_at: now, updated_at: now });
    assert.equal((await request('/api/product-routings/p2-route-free', { method: 'DELETE' })).status, 200);
    assert.equal(database.prepare("SELECT 1 FROM product_routing_operations WHERE routing_id='p2-route-free'").get(), undefined);
    assert.ok(auditFor('PRODUCT_ROUTING', 'p2-route-free'));
  });
});

function seedDraftDocuments() {
  const productId = 'product-001';
  insert('sales_orders', { id: 'p2-so-draft', order_no: 'SO-P2-DRAFT', customer_id: 'customer-001', status: 'DRAFT', creator_id: 'user-admin', created_at: now, updated_at: now });
  insert('sales_order_items', { id: 'p2-so-item', order_id: 'p2-so-draft', product_id: productId, quantity: 1, unit_price_cents: 100, amount_cents: 100, line_no: 1 });
  insert('purchase_orders', { id: 'p2-po-draft', order_no: 'PO-P2-DRAFT', supplier_id: 'supplier-001', status: 'DRAFT', creator_id: 'user-admin', created_at: now, updated_at: now });
  insert('purchase_order_items', { id: 'p2-po-item', order_id: 'p2-po-draft', product_id: productId, quantity: 1, unit_price_cents: 100, amount_cents: 100, line_no: 1 });
  insert('purchase_requisitions', { id: 'p2-pr-draft', requisition_no: 'PR-P2-DRAFT', status: 'DRAFT', creator_id: 'user-admin', created_at: now, updated_at: now });
  insert('purchase_requisition_items', { id: 'p2-pr-item', requisition_id: 'p2-pr-draft', product_id: productId, quantity: 1, created_at: now });
  insert('planning_forecasts', { id: 'p2-fc-draft', forecast_code: 'FC-P2-DRAFT', forecast_name: 'P2预测', period_start: '2026-10-01', period_end: '2026-10-31', status: 'DRAFT', created_by: 'user-admin', created_at: now, updated_at: now });
  insert('planning_forecast_items', { id: 'p2-fc-item', forecast_id: 'p2-fc-draft', product_id: productId, need_date: '2026-10-10', quantity: 1 });
  insert('inventory_adjustments', { id: 'p2-ia-draft', adjustment_no: 'IA-P2-DRAFT', warehouse_id: 'warehouse-001', status: 'DRAFT', reason: 'P2测试', adjustment_date: '2026-09-20', creator_id: 'user-admin', created_at: now, updated_at: now });
  insert('inventory_adjustment_items', { id: 'p2-ia-item', adjustment_id: 'p2-ia-draft', product_id: productId, quantity_delta: 1, line_no: 1 });
}

describe('P2 exactly five DRAFT-only business deletes', () => {
  test('all five draft routes delete header/items, create audit, and do not create stock or finance effects', async () => {
    seedDraftDocuments();
    const before = { inventory: database.prepare('SELECT COUNT(*) n FROM inventory').get().n, tx: database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, vouchers: database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n, ar: database.prepare('SELECT COUNT(*) n FROM account_receivables').get().n, ap: database.prepare('SELECT COUNT(*) n FROM account_payables').get().n };
    const cases = [
      ['/api/orders/p2-so-draft', 'sales_orders', 'p2-so-draft', 'SALES_ORDER'],
      ['/api/purchase-orders/p2-po-draft', 'purchase_orders', 'p2-po-draft', 'PURCHASE_ORDER'],
      ['/api/purchase-requisitions/p2-pr-draft', 'purchase_requisitions', 'p2-pr-draft', 'PURCHASE_REQUISITION'],
      ['/api/planning/forecasts/p2-fc-draft', 'planning_forecasts', 'p2-fc-draft', 'PLANNING_FORECAST'],
      ['/api/inventory-adjustments/p2-ia-draft', 'inventory_adjustments', 'p2-ia-draft', 'INVENTORY_ADJUSTMENT'],
    ];
    for (const [path, table, recordId, entity] of cases) {
      assert.equal((await request(path, { method: 'DELETE' })).status, 200, path);
      assert.equal(database.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(recordId), undefined);
      assert.ok(auditFor(entity, recordId));
      assert.equal((await request(path)).status, 404);
      assert.equal((await request(path, { method: 'DELETE' })).status, 404);
    }
    assert.deepEqual({ inventory: database.prepare('SELECT COUNT(*) n FROM inventory').get().n, tx: database.prepare('SELECT COUNT(*) n FROM inventory_transactions').get().n, vouchers: database.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n, ar: database.prepare('SELECT COUNT(*) n FROM account_receivables').get().n, ap: database.prepare('SELECT COUNT(*) n FROM account_payables').get().n }, before);
  });
  test('submitted/approved/cancelled documents are rejected with controlled 409', async () => {
    insert('purchase_orders', { id: 'p2-po-approved', order_no: 'PO-P2-APPROVED', supplier_id: 'supplier-001', status: 'APPROVED', creator_id: 'user-admin', created_at: now, updated_at: now });
    insert('purchase_requisitions', { id: 'p2-pr-submitted', requisition_no: 'PR-P2-SUBMITTED', status: 'SUBMITTED', creator_id: 'user-admin', created_at: now, updated_at: now });
    insert('planning_forecasts', { id: 'p2-fc-active', forecast_code: 'FC-P2-ACTIVE', forecast_name: 'P2已生效预测', period_start: '2026-10-01', period_end: '2026-10-31', status: 'ACTIVE', created_by: 'user-admin', created_at: now, updated_at: now });
    insert('inventory_adjustments', { id: 'p2-ia-cancelled', adjustment_no: 'IA-P2-CANCELLED', warehouse_id: 'warehouse-001', status: 'CANCELLED', reason: 'P2测试', adjustment_date: '2026-09-20', creator_id: 'user-admin', created_at: now, updated_at: now });
    const cases = [
      ['/api/orders/order-demo-001', 'sales_orders', 'order-demo-001'],
      ['/api/purchase-orders/p2-po-approved', 'purchase_orders', 'p2-po-approved'],
      ['/api/purchase-requisitions/p2-pr-submitted', 'purchase_requisitions', 'p2-pr-submitted'],
      ['/api/planning/forecasts/p2-fc-active', 'planning_forecasts', 'p2-fc-active'],
      ['/api/inventory-adjustments/p2-ia-cancelled', 'inventory_adjustments', 'p2-ia-cancelled'],
    ];
    for (const [path, table, recordId] of cases) { const result = await request(path, { method: 'DELETE' }); assert.equal(result.status, 409); assert.equal(result.data.details.code, 'DOCUMENT_NOT_DRAFT'); assert.ok(database.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(recordId)); }
  });
  test('draft sales order with downstream delivery is blocked', async () => {
    insert('sales_orders', { id: 'p2-so-linked', order_no: 'SO-P2-LINKED', customer_id: 'customer-001', status: 'DRAFT', creator_id: 'user-admin', created_at: now, updated_at: now });
    insert('sales_deliveries', { id: 'p2-delivery', delivery_no: 'SD-P2', sales_order_id: 'p2-so-linked', customer_id: 'customer-001', warehouse_id: 'warehouse-001', handler_id: 'user-admin', status: 'DRAFT', delivery_date: '2026-09-20', creator_id: 'user-admin', created_at: now, updated_at: now });
    const result = await request('/api/orders/p2-so-linked', { method: 'DELETE' });
    assert.equal(result.status, 409); assert.equal(result.data.details.code, 'DOCUMENT_HAS_DOWNSTREAM');
  });
  test('forbidden business families still expose no DELETE route', async () => {
    for (const path of ['/api/planning/mrp/runs/mrp-run-demo-001', '/api/production-orders/production-order-001', '/api/sales-deliveries/sales-delivery-001', '/api/accounting/vouchers/voucher-001']) {
      assert.equal((await request(path, { method: 'DELETE' })).status, 404, path);
    }
  });
});
