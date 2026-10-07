// Regression coverage for v1.0.1-rc.3 — M4 BLOCKER HOTFIX: SCOPED LOGISTICS
// SOURCE LOOKUPS.
//
// Production-side blocker that was reproduced in the combined M4+M5 real
// browser acceptance (375×667 viewport, test_warehouse):
//
//   test_warehouse
//   应用 → 销售管理 → 销售出货 → 新增销售出库单
//   来源销售订单（可选）: only 直接出货
//   GET /api/orders?status=APPROVED → 403
//   silent .catch(() => {}) turned the 403 into an apparently empty
//   selector and blocked the M4 trace "Sales Order → linked Sales
//   Delivery" link.
//
// Product / security principle upheld here:
//   - A user authorized to perform a logistics operation receives a
//     MINIMAL, SCOPED source-document lookup required for that
//     operation. No broad ORDERS_VIEW / PURCHASE_ORDERS_VIEW grant.
//   - warehouse still cannot call /api/orders or /api/purchase-orders
//     (the canonical broad list endpoints remain gated).
//
// Fix scope:
//   - GET /api/lookup/sales-orders-source   (gated by SALES_DELIVERIES_MANAGE / RETURNS_MANAGE)
//   - GET /api/lookup/purchase-orders-source (gated by PURCHASE_RECEIPTS_MANAGE / RETURNS_MANAGE)
//   - logistics-finance.jsx PurchaseReceiptEditorV16 / SalesDeliveryModal
//     call the scoped lookups instead of the broad /api/orders and
//     /api/purchase-orders endpoints. Source-prefill uses data already
//     loaded by the lookup so the warehouse actor never has to call
//     /api/orders/:id or /api/purchase-orders/:id.
//   - Silent .catch(() => {}) on source lookups replaced with a
//     controlled notify() that does not white-screen.
//
// What is NOT changed (separation of duties preserved):
//   - PERMISSIONS registry (still 94 codes).
//   - role-warehouse / role-sales / role-reviewer / role-accounting
//     permission sets.
//   - Sales Order / Purchase Order broad list endpoints
//     (/api/orders, /api/purchase-orders).
//   - schema, business state machine, inventory / voucher effects.
//   - Returns source lookups (already use /api/sales-deliveries?
//     status=CONFIRMED and /api/purchase-receipts?status=CONFIRMED,
//     which warehouse can call via SALES_DELIVERIES_VIEW /
//     PURCHASE_RECEIPTS_VIEW).

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, hashPassword, PERMISSIONS } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src');

function authHeaders(token) {
  return { 'Authorization': `Bearer ${token}`, 'content-type': 'application/json' };
}

async function login(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json()).token;
}

async function seedFiveRolesWithApprovableOrders(baseUrl) {
  // Helper to create a complete fixture: customers, suppliers, warehouses,
  // products, sales orders (DRAFT/SUBMITTED/APPROVED/REJECTED), purchase
  // orders (DRAFT/SUBMITTED/APPROVED/REJECTED), users for 5 roles.
}

describe('m4-blocker-hotfix — scoped logistics source lookups', () => {
  let tmp; let db; let server; let baseUrl;
  let warehouseToken; let salesToken; let reviewerToken; let accountingToken; let adminToken;
  let customerId; let supplierId; let warehouseId; let productId;
  let approvedSoId; let draftSoId; let submittedSoId; let rejectedSoId;
  let approvedPoId; let draftPoId; let submittedPoId; let rejectedPoId;

  beforeEach(async () => {
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
    tmp = mkdtempSync(join(tmpdir(), 'modern-erp-src-lkp-'));
    db = createDatabase(join(tmp, 'erp.db'));
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;

    const now = '2026-09-16T00:00:00.000Z';

    // Master data
    db.prepare("INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('cus','CUS-001','演示客户','c','1','sz',1,?,?)").run(now, now);
    db.prepare("INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('sup','SUP-001','演示供应商','s','2','gz',1,?,?)").run(now, now);
    db.prepare("INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('wh','WH-001','主仓','','m',1,?,?)").run(now, now);
    db.prepare("INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('prod','P-001','演示货品','T','个',10000,0,1,?,?)").run(now, now);

    customerId = 'cus'; supplierId = 'sup'; warehouseId = 'wh'; productId = 'prod';

    // Initial inventory so Sales Delivery creation can satisfy the inventory check.
    db.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES('inv-src',?,?,1000,?)").run(warehouseId, productId, now);

    // Users first (FK creator_id REFERENCES users(id) on orders)
    for (const [name, role] of [['admin', 'role-admin'], ['sales', 'role-sales'], ['reviewer', 'role-reviewer'], ['warehouse', 'role-warehouse'], ['accounting', 'role-accounting']]) {
      const password = `${name}-src-1234`;
      const hash = hashPassword(password);
      db.prepare("INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)")
        .run(`u-${name}`, name, name, hash.hash, hash.salt, role, now);
    }

    // Sales Orders: one of each status
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('so-draft','SO-DRAFT',?,'DRAFT',1000,'','u-sales',NULL,NULL,?,?)").run(customerId, now, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('so-sub','SO-SUB',?,'SUBMITTED',2000,'','u-sales',?,NULL,?,?)").run(customerId, now, now, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('so-app','SO-APP',?,'APPROVED',3000,'','u-sales',?,?,?,?)").run(customerId, now, now, now, now);
    db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('so-rej','SO-REJ',?,'REJECTED',4000,'','u-sales',?,?,?,?)").run(customerId, now, now, now, now);
    // items for approved sales order (prefill target)
    db.prepare("INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('soi-1','so-app',?,3,1000,3000,1)").run(productId);

    // Purchase Orders: one of each status
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('po-draft','PO-DRAFT',?,'DRAFT',1000,'','u-sales',NULL,NULL,?,?)").run(supplierId, now, now);
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('po-sub','PO-SUB',?,'SUBMITTED',2000,'','u-sales',?,NULL,?,?)").run(supplierId, now, now, now);
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('po-app','PO-APP',?,'APPROVED',3000,'','u-sales',?,?,?,?)").run(supplierId, now, now, now, now);
    db.prepare("INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at) VALUES('po-rej','PO-REJ',?,'REJECTED',4000,'','u-sales',?,?,?,?)").run(supplierId, now, now, now, now);
    // items for approved purchase order
    db.prepare("INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES('poi-1','po-app',?,3,1000,3000,1)").run(productId);

    approvedSoId = 'so-app'; draftSoId = 'so-draft'; submittedSoId = 'so-sub'; rejectedSoId = 'so-rej';
    approvedPoId = 'po-app'; draftPoId = 'po-draft'; submittedPoId = 'po-sub'; rejectedPoId = 'po-rej';

    server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    warehouseToken = await login(baseUrl, 'warehouse', 'warehouse-src-1234');
    salesToken = await login(baseUrl, 'sales', 'sales-src-1234');
    reviewerToken = await login(baseUrl, 'reviewer', 'reviewer-src-1234');
    accountingToken = await login(baseUrl, 'accounting', 'accounting-src-1234');
    adminToken = await login(baseUrl, 'admin', 'admin-src-1234');
  });

  afterEach(async () => {
    await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
    db.close(); rmSync(tmp, { recursive: true, force: true });
  });

  // =====================================================================
  // A. SALES LOOKUP
  // =====================================================================

  describe('A. SALES LOOKUP — /api/lookup/sales-orders-source', () => {
    test('1. unauthenticated lookup → 401', async () => {
      const res = await fetch(`${baseUrl}/api/lookup/sales-orders-source`);
      assert.equal(res.status, 401);
    });

    test('2. warehouse logistics actor can load eligible Sales Order candidates', async () => {
      const res = await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(warehouseToken) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.orders));
      assert.ok(body.orders.length >= 1, 'must surface at least the APPROVED sales order');
    });

    test('3. APPROVED Sales Order included', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      assert.ok(body.orders.find((o) => o.id === approvedSoId), 'APPROVED sales order must appear');
    });

    test('4-6. DRAFT / SUBMITTED / REJECTED Sales Orders excluded', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      const ids = body.orders.map((o) => o.id);
      assert.ok(!ids.includes(draftSoId), 'DRAFT must be excluded');
      assert.ok(!ids.includes(submittedSoId), 'SUBMITTED must be excluded');
      assert.ok(!ids.includes(rejectedSoId), 'REJECTED must be excluded');
    });

    test('7. minimal response shape — required + items + status / totalCents / customer fields', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      const o = body.orders.find((x) => x.id === approvedSoId);
      assert.ok(o);
      // Required keys
      for (const key of ['id', 'orderNo', 'status', 'totalCents', 'createdAt', 'customerId', 'customerCode', 'customerName', 'items']) {
        assert.ok(Object.prototype.hasOwnProperty.call(o, key), `missing ${key}`);
      }
      assert.equal(o.status, 'APPROVED');
      assert.equal(o.totalCents, 3000);
      assert.equal(o.orderNo, 'SO-APP');
      assert.equal(o.customerId, customerId);
      assert.equal(o.customerCode, 'CUS-001');
      // items prefill contract
      assert.ok(Array.isArray(o.items));
      assert.equal(o.items.length, 1);
      assert.equal(o.items[0].productId, productId);
      assert.equal(o.items[0].quantity, 3);
      assert.equal(o.items[0].unitPriceCents, 1000);
    });

    test('8. no unauthorized financial / internal fields (no creator / reviewer / rejectionReason / audit)', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      const o = body.orders[0];
      const forbiddenKeys = ['creatorId', 'creatorName', 'reviewerId', 'reviewerName', 'rejectionReason', 'history', 'submittedAt', 'reviewedAt', 'remark', 'itemCount', 'deliveryCount', 'updatedAt', 'customerId' /* not forbidden — needed for prefill */];
      // Note: customerId IS allowed because prefill needs it. Audit/internal fields are NOT.
      const reallyForbidden = ['creatorId', 'creatorName', 'reviewerId', 'reviewerName', 'rejectionReason', 'history', 'submittedAt', 'reviewedAt', 'remark', 'itemCount', 'deliveryCount', 'updatedAt'];
      for (const k of reallyForbidden) {
        assert.ok(!Object.prototype.hasOwnProperty.call(o, k), `must not leak ${k}`);
      }
    });

    test('9. warehouse still cannot call the broad /api/orders endpoint (canonical broad-list gate preserved)', async () => {
      const res = await fetch(`${baseUrl}/api/orders?status=APPROVED`, { headers: authHeaders(warehouseToken) });
      assert.equal(res.status, 403, 'broad /api/orders must remain 403 for warehouse — only the scoped lookup is permitted');
    });

    test('10. authoritative source is required and approved source line is accepted', async () => {
      // Warehouse creates Sales Delivery with no source → refused
      const noSrc = await fetch(`${baseUrl}/api/sales-deliveries`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({
          customerId, warehouseId,
          items: [{ productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      });
      assert.equal(noSrc.status, 400);
      // With approved source and source line → 201
      const withSrc = await fetch(`${baseUrl}/api/sales-deliveries`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({
          salesOrderId: approvedSoId, customerId, warehouseId,
          items: [{ salesOrderItemId: 'soi-1', productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      });
      assert.equal(withSrc.status, 201);
    });
  });

  // =====================================================================
  // B. PURCHASE LOOKUP
  // =====================================================================

  describe('B. PURCHASE LOOKUP — /api/lookup/purchase-orders-source', () => {
    test('11. warehouse can load eligible Purchase Order candidates', async () => {
      const res = await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(warehouseToken) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.purchaseOrders));
      assert.ok(body.purchaseOrders.length >= 1);
    });

    test('12. APPROVED Purchase Order included', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      assert.ok(body.purchaseOrders.find((o) => o.id === approvedPoId));
    });

    test('13. non-approved Purchase Orders excluded (DRAFT / SUBMITTED / REJECTED)', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      const ids = body.purchaseOrders.map((o) => o.id);
      assert.ok(!ids.includes(draftPoId));
      assert.ok(!ids.includes(submittedPoId));
      assert.ok(!ids.includes(rejectedPoId));
    });

    test('14. minimal response — required + items + supplier context', async () => {
      const body = await (await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(warehouseToken) })).json();
      const o = body.purchaseOrders.find((x) => x.id === approvedPoId);
      assert.ok(o);
      for (const key of ['id', 'orderNo', 'status', 'totalCents', 'createdAt', 'supplierId', 'supplierCode', 'supplierName', 'items']) {
        assert.ok(Object.prototype.hasOwnProperty.call(o, key), `missing ${key}`);
      }
      assert.equal(o.status, 'APPROVED');
      assert.equal(o.supplierId, supplierId);
      assert.equal(o.supplierCode, 'SUP-001');
      assert.equal(o.items.length, 1);
      assert.equal(o.items[0].quantity, 3);
      assert.equal(o.items[0].unitPriceCents, 1000);
    });

    test('15. broad Purchase Order permission not granted — /api/purchase-orders still 403 for warehouse', async () => {
      const res = await fetch(`${baseUrl}/api/purchase-orders?status=APPROVED`, { headers: authHeaders(warehouseToken) });
      assert.equal(res.status, 403, 'broad /api/purchase-orders must remain 403 for warehouse');
    });
  });

  // =====================================================================
  // C. RETURN LOOKUPS
  // =====================================================================

  describe('C. RETURN LOOKUPS — already-scoped via existing logistics permissions', () => {
    test('16. Sales Return source Sales Delivery list works for warehouse', async () => {
      // Seed a confirmed sales delivery
      const now = '2026-09-16T01:00:00.000Z';
      db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd-1','SD-RET',?,?,?,'u-warehouse',1000,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(approvedSoId, customerId, warehouseId, now, now);
      const res = await fetch(`${baseUrl}/api/sales-deliveries?status=CONFIRMED`, { headers: authHeaders(warehouseToken) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.salesDeliveries.find((s) => s.id === 'sd-1'));
    });

    test('17. Purchase Return source Purchase Receipt list works for warehouse', async () => {
      const now = '2026-09-16T01:00:00.000Z';
      db.prepare("INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at) VALUES('pr-1','PR-RET',?,?,?,'u-warehouse',1000,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(approvedPoId, supplierId, warehouseId, now, now);
      const res = await fetch(`${baseUrl}/api/purchase-receipts?status=CONFIRMED`, { headers: authHeaders(warehouseToken) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.purchaseReceipts.find((p) => p.id === 'pr-1'));
    });

    test('18. no unrelated document leakage — returns endpoints only return their own type', async () => {
      const now = '2026-09-16T01:00:00.000Z';
      db.prepare("INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at) VALUES('sd-1','SD-RET',?,?,?,'u-warehouse',1000,'CONFIRMED','2026-09-16','','u-warehouse',?,?)").run(approvedSoId, customerId, warehouseId, now, now);
      const body = await (await fetch(`${baseUrl}/api/sales-deliveries?status=CONFIRMED`, { headers: authHeaders(warehouseToken) })).json();
      assert.ok(!('purchaseReceipts' in body), '/api/sales-deliveries must not leak purchase receipts');
    });
  });

  // =====================================================================
  // D. ROLE SECURITY (positive / negative permission closure)
  // =====================================================================

  describe('D. ROLE SECURITY — auth + permission gate coverage', () => {
    test('admin can call scoped sales lookup', async () => {
      const res = await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(adminToken) });
      assert.equal(res.status, 200);
    });
    test('admin can call scoped purchase lookup', async () => {
      const res = await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(adminToken) });
      assert.equal(res.status, 200);
    });
    test('sales role is allowed scoped lookup (role-sales canonical contract holds ORDERS_CREATE / PURCHASE_ORDERS_CREATE)', async () => {
      // V1.3 Phase 1: sales lost SALES_DELIVERIES_MANAGE / RETURNS_MANAGE /
      // PURCHASE_RECEIPTS_MANAGE. The scoped lookups are still permitted via
      // ORDERS_CREATE and PURCHASE_ORDERS_CREATE which sales holds, so it can
      // prefill approved sales orders / purchase orders for PR / PO creation.
      const resSales = await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(salesToken) });
      const resPurchase = await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(salesToken) });
      assert.equal(resSales.status, 200);
      assert.equal(resPurchase.status, 200);
    });
    test('reviewer cannot mutate, but review-only roles do not auto-gain logistics source lookup', async () => {
      const resSales = await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(reviewerToken) });
      const resPurchase = await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(reviewerToken) });
      assert.equal(resSales.status, 403, 'reviewer must not gain logistics source lookup');
      assert.equal(resPurchase.status, 403, 'reviewer must not gain logistics source lookup');
    });
    test('accounting (no SALES_DELIVERIES_MANAGE / PURCHASE_RECEIPTS_MANAGE) is denied scoped lookups', async () => {
      const resSales = await fetch(`${baseUrl}/api/lookup/sales-orders-source`, { headers: authHeaders(accountingToken) });
      const resPurchase = await fetch(`${baseUrl}/api/lookup/purchase-orders-source`, { headers: authHeaders(accountingToken) });
      assert.equal(resSales.status, 403);
      assert.equal(resPurchase.status, 403);
    });
  });

  // =====================================================================
  // E. UI — source code contract (logistics-finance.jsx)
  // =====================================================================

  describe('E. UI — frontend source-selector contract', () => {
    let source;

    beforeEach(() => {
      source = readFileSync(join(srcDir, 'pages/logistics-finance.jsx'), 'utf8');
    });

    function extractBlock(text, name) {
      const startRe = new RegExp(`function\\s+${name}\\s*\\(`);
      const m = startRe.exec(text);
      if (!m) return '';
      // Walk through the parameter list (handles destructuring + nested parens)
      // so the inner `{` of destructured params is not mistaken for the body.
      let i = m.index;
      let depth = 0;
      while (i < text.length) {
        const c = text[i];
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] !== '{') return '';
      const start = i;
      depth = 1; i++;
      while (i < text.length) {
        const c = text[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
        i++;
      }
      return text.slice(start);
    }

    test('19. SalesDeliveryModal uses /api/lookup/sales-orders-source (scoped), not /api/orders', () => {
      const modal = extractBlock(source, 'SalesDeliveryModal');
      assert.match(modal, /api\("\/api\/lookup\/sales-orders-source"\)/, 'must use scoped lookup');
      assert.doesNotMatch(modal, /api\("\/api\/orders\?status=APPROVED"\)/, 'must not call broad /api/orders');
      assert.doesNotMatch(modal, /api\("\/api\/orders"\s*\+\s*salesOrderId\)/, 'must not call /api/orders/:id for prefill');
    });

    test('20. PurchaseReceiptEditorV16 uses /api/lookup/purchase-orders-source (scoped), not /api/purchase-orders', () => {
      const modal = extractBlock(source, 'PurchaseReceiptEditorV16');
      assert.match(modal, /api\(['"]\/api\/lookup\/purchase-orders-source['"]\)/, 'must use scoped lookup');
      assert.doesNotMatch(modal, /api\(['"]\/api\/purchase-orders\?status=APPROVED['"]\)/, 'must not call broad /api/purchase-orders');
      assert.doesNotMatch(modal, /api\(['"]\/api\/purchase-orders['"]\s*\+\s*purchaseOrderId\)/, 'must not call /api/purchase-orders/:id for prefill');
    });

    test('21. source selectors are required and direct logistics options are absent', () => {
      const sdModal = extractBlock(source, 'SalesDeliveryModal');
      const prModal = extractBlock(source, 'PurchaseReceiptEditorV16');
      assert.match(sdModal, /来源销售订单（必选）/);
      assert.match(prModal, /来源采购订单[\s\S]*?<select[\s\S]*?required/);
      assert.doesNotMatch(sdModal, /直接出货（不关联销售订单）/);
      assert.doesNotMatch(prModal, /直接入库（不关联采购订单）/);
    });

    test('22/23. direct Sales Delivery / Purchase Receipt are refused', async () => {
      const r1 = await fetch(`${baseUrl}/api/sales-deliveries`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({ customerId, warehouseId, items: [{ productId, quantity: 1, unitPriceCents: 1000 }] }),
      });
      assert.equal(r1.status, 400);
      const r2 = await fetch(`${baseUrl}/api/purchase-receipts`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({ supplierId, warehouseId, items: [{ productId, quantity: 1, unitPriceCents: 1000 }] }),
      });
      assert.equal(r2.status, 400);
    });

    test('24. lookup error is visible and controlled (notify with explicit message; no raw stack trace)', () => {
      const sdModal = extractBlock(source, 'SalesDeliveryModal');
      const prModal = extractBlock(source, 'PurchaseReceiptEditorV16');
      // notify(...) with explanatory Chinese message + "error" tone
      assert.match(sdModal, /\.catch\(\(e\)\s*=>\s*notify\("来源销售订单加载失败，请重试。",\s*"error"\)\)/);
      assert.match(prModal, /\.catch\(\(e\)\s*=>\s*notify\(['"]来源采购订单加载失败，请重试。['"],\s*['"]error['"]\)\)/);
      // returns modal also surfaces a controlled message
      const returnModal = extractBlock(source, 'ReturnModal');
      assert.match(returnModal, /notify\("来源单据加载失败，请重试。"/);
    });

    test('25. lookup error does not white-screen — no silent .catch(() => {}) on the source-document lookups', () => {
      const sdModal = extractBlock(source, 'SalesDeliveryModal');
      const prModal = extractBlock(source, 'PurchaseReceiptEditorV16');
      const returnModal = extractBlock(source, 'ReturnModal');
      // The lookup source-document fetches must NOT silently swallow — they must surface via notify.
      assert.doesNotMatch(sdModal, /api\("\/api\/lookup\/sales-orders-source"\)[\s\S]{0,80}\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
      assert.doesNotMatch(prModal, /api\("\/api\/lookup\/purchase-orders-source"\)[\s\S]{0,80}\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
      // Returns: source list fetch must notify (no silent swallow)
      assert.doesNotMatch(returnModal, /api\([\s\S]{0,200}\?status=CONFIRMED'\)[\s\S]{0,80}\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
    });
  });

  // =====================================================================
  // F. SECURITY — registry + role permission set stability
  // =====================================================================

  describe('F. SECURITY — registry + role permission stability', () => {
    test('26. PERMISSIONS registry size after M14 + Core Scope Cleanup', () => {
      assert.equal(PERMISSIONS.length, 135, 'PERMISSIONS count is 135 after M14 + Core Scope Cleanup + V17 Wave A+B+C+D+E + V18 Manufacturing & Quality (13 production_*)');
    });

    test('27. role-warehouse permission set unchanged from M5 baseline', () => {
      const permissions = new Set(
        db.prepare("SELECT permission_code FROM role_permissions WHERE role_id='role-warehouse'").all().map((r) => r.permission_code)
      );
      for (const required of [
        'PRODUCTS_VIEW', 'WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE', 'INVENTORY_VIEW',
        'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE',
        'INVENTORY_ADJUSTMENT_MANAGE',
        'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE',
        'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE',
        'RETURNS_VIEW', 'RETURNS_MANAGE',
        'IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE',
      ]) assert.ok(permissions.has(required), `warehouse missing ${required}`);
      for (const forbidden of [
        'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE',
        'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE',
        'PRODUCTS_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE',
        'ACCOUNTING_VIEW', 'PERIOD_CLOSE_VIEW', 'PERIOD_CLOSE_MANAGE',
        'USERS_MANAGE', 'ROLES_MANAGE',
      ]) assert.ok(!permissions.has(forbidden), `warehouse must NOT have ${forbidden}`);
    });

    test('28. role-reviewer permission set unchanged', () => {
      const permissions = new Set(
        db.prepare("SELECT permission_code FROM role_permissions WHERE role_id='role-reviewer'").all().map((r) => r.permission_code)
      );
      for (const forbidden of [
        'SALES_DELIVERIES_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'RETURNS_MANAGE',
        'ORDERS_CREATE', 'ORDERS_SUBMIT',
        'PRODUCTS_MANAGE', 'CUSTOMERS_MANAGE', 'SUPPLIERS_MANAGE',
        'ACCOUNTING_VIEW', 'PERIOD_CLOSE_MANAGE', 'USERS_MANAGE',
      ]) assert.ok(!permissions.has(forbidden), `reviewer must NOT have ${forbidden}`);
      // reviewer should keep ORDERS_APPROVE + PURCHASE_ORDERS_APPROVE
      assert.ok(permissions.has('ORDERS_APPROVE'));
      assert.ok(permissions.has('PURCHASE_ORDERS_APPROVE'));
    });

    test('29. role-accounting permission set unchanged (no SALES_DELIVERIES_MANAGE etc.)', () => {
      const permissions = new Set(
        db.prepare("SELECT permission_code FROM role_permissions WHERE role_id='role-accounting'").all().map((r) => r.permission_code)
      );
      for (const forbidden of [
        'SALES_DELIVERIES_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'RETURNS_MANAGE',
        'ORDERS_CREATE', 'ORDERS_APPROVE',
        'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_APPROVE',
        'PERIOD_CLOSE_VIEW', 'PERIOD_CLOSE_MANAGE', 'USERS_MANAGE',
      ]) assert.ok(!permissions.has(forbidden), `accounting must NOT have ${forbidden}`);
    });
  });

  // =====================================================================
  // G. REGRESSION — full M4 trace + approval + delivery round-trip
  // =====================================================================

  describe('G. REGRESSION — workflow traceability preserved', () => {
    test('30. M1/M2/M3 — no role lost its existing scoped permission (warehouse can still list /api/products, /api/warehouses, /api/inventory)', async () => {
      const tokens = [['products', warehouseToken], ['warehouses', warehouseToken], ['inventory', warehouseToken]];
      for (const [path, token] of tokens) {
        const res = await fetch(`${baseUrl}/api/${path}`, { headers: authHeaders(token) });
        assert.equal(res.status, 200, `warehouse must keep /api/${path} 200`);
      }
    });

    test('31. M3 approval — reviewer can approve SUBMITTED sales order (existing workflow intact)', async () => {
      // so-sub was inserted as SUBMITTED by sales; reviewer must be able to approve it
      const res = await fetch(`${baseUrl}/api/orders/${submittedSoId}/approve`, {
        method: 'POST', headers: authHeaders(reviewerToken),
      });
      assert.equal(res.status, 200);
      const row = db.prepare("SELECT status FROM sales_orders WHERE id=?").get(submittedSoId);
      assert.equal(row.status, 'APPROVED');
    });

    test('32. M3 approval — reviewer can approve SUBMITTED purchase order (existing workflow intact)', async () => {
      const res = await fetch(`${baseUrl}/api/purchase-orders/${submittedPoId}/approve`, {
        method: 'POST', headers: authHeaders(reviewerToken),
      });
      assert.equal(res.status, 200);
      const row = db.prepare("SELECT status FROM purchase_orders WHERE id=?").get(submittedPoId);
      assert.equal(row.status, 'APPROVED');
    });

    test('33. M4 trace — warehouse creates Sales Delivery with approved source; trace links Sales Order → Sales Delivery', async () => {
      const created = await (await fetch(`${baseUrl}/api/sales-deliveries`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({
          salesOrderId: approvedSoId, customerId, warehouseId,
          items: [{ salesOrderItemId: 'soi-1', productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      })).json();
      const detail = (await (await fetch(`${baseUrl}/api/sales-deliveries/${created.id}`, { headers: authHeaders(warehouseToken) })).json()).salesDelivery;
      assert.equal(detail.sales_order_id, approvedSoId, 'delivery must persist source sales_order_id');
      assert.ok(detail.relationships.upstream.find((u) => u.id === approvedSoId && u.type === 'SALES_ORDER'));
    });

    test('34. M5 inventory — M4 Sales Delivery confirm still writes inventory transaction (no schema/state mutation)', async () => {
      // Inventory already seeded in beforeEach (inv-src / 1000 qty).
      const created = await (await fetch(`${baseUrl}/api/sales-deliveries`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({
          salesOrderId: approvedSoId, customerId, warehouseId,
          items: [{ salesOrderItemId: 'soi-1', productId, quantity: 1, unitPriceCents: 1000 }],
        }),
      })).json();
      const quality = await (await fetch(`${baseUrl}/api/oqc`, {
        method: 'POST', headers: authHeaders(warehouseToken), body: JSON.stringify({ sales_delivery_id: created.id }),
      })).json();
      const qualityComplete = await fetch(`${baseUrl}/api/oqc/${quality.id}/complete`, {
        method: 'POST', headers: authHeaders(warehouseToken), body: JSON.stringify({ result: 'PASS', inspection_quantity: 1, passed_quantity: 1, failed_quantity: 0 }),
      });
      assert.equal(qualityComplete.status, 200);
      // confirm
      const confirm = await fetch(`${baseUrl}/api/sales-deliveries/${created.id}`, {
        method: 'POST', headers: authHeaders(warehouseToken),
        body: JSON.stringify({ action: 'confirm' }),
      });
      assert.equal(confirm.status, 200);
      const tx = db.prepare("SELECT direction, source_type, source_id FROM inventory_transactions WHERE source_id=?").get(created.id);
      assert.equal(tx.direction, 'OUT');
      assert.equal(tx.source_type, 'SALES_DELIVERY');
    });
  });
});
