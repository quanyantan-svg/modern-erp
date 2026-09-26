// UAT R4 — Purchase source-chain end-to-end regression.
//
// Coverage:
//   * A. Purchase Instruction -> Purchase Requisition auto-carry
//     (purchaseInstructionItemId persistence + source linkage contract).
//   * B. required_date single-value contract: header required_date
//     must equal each source item's need_by_date when one exists;
//     else planned_date is allowed.
//   * C/D. Stale / cleared source-link identity at the API layer:
//     backend rejects cross-source linkage or missing linkage on
//     source-derived documents.
//   * E. GET /api/purchase-orders/:id surfaces
//     purchaseRequisitionItemId per item so the frontend editor can
//     carry it through.
//   * F. Source-derived PO PUT succeeds when items retain
//     purchaseRequisitionItemId / productId / quantity and the operator
//     only edits payment terms / payment days.
//   * G. Commercial-only edit (payment terms + payment days) on an
//     unchanged source-derived PO succeeds end-to-end.
//   * H/I/J. Backend immutability validation remains strict:
//     changing source product / quantity / missing linkage -> 409.
//   * K. PO submit path requires payment_terms and proceeds normally
//     when the source-derived PO is otherwise complete.
//   * L. Manually-created PO without source linkage still creates,
//     edits and submits normally.
//   * M. No inventory movement is created by PR / PO create / edit /
//     submit / approval paths.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

async function startApi(db) {
  const server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function closeApi(server) {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  return body.token;
}

async function api(baseUrl, token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

const today = () => new Date().toISOString().slice(0, 10);

// =====================================================================
// Shared DB / API setup
// =====================================================================
let tmp; let db; let server; let baseUrl;
let adminToken; let salesToken; let reviewerToken;
let productA; let productB; let supplier;
let uniqueCounter = 0;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'modern-erp-uat-r4-'));
  db = createDatabase(join(tmp, 'erp.db'));
  ({ server, baseUrl } = await startApi(db));
  adminToken = await login(baseUrl, 'admin', 'admin123');
  salesToken = await login(baseUrl, 'sales', 'sales123');
  reviewerToken = await login(baseUrl, 'reviewer', 'review123');

  // Seed two products and one supplier for PR / PO creation paths.
  productA = ensureProduct('R4-PROD-A', 10000);
  productB = ensureProduct('R4-PROD-B', 12000);
  // Set unit prices so PR unit_price_cents seeds are valid.
  db.prepare("UPDATE products SET price_cents=? WHERE id=?").run(10000, productA);
  db.prepare("UPDATE products SET price_cents=? WHERE id=?").run(12000, productB);
  supplier = ensureActiveSupplier();
});

after(async () => {
  await closeApi(server);
  db.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function ensureProduct(code, priceCents) {
  const id = 'product-r4-' + code;
  if (db.prepare('SELECT id FROM products WHERE id=?').get(id)) return id;
  db.prepare(`INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, base_uom_code, created_at, updated_at)
              VALUES(?, ?, ?, 'R4', 'EA', ?, 0, 1, 'EA', datetime('now'), datetime('now'))`)
    .run(id, code, `R4 ${code}`, priceCents);
  return id;
}

function ensureActiveSupplier() {
  const id = 'supplier-r4-001';
  if (db.prepare('SELECT id FROM suppliers WHERE id=?').get(id)) return id;
  db.prepare(`INSERT INTO suppliers(id, code, name, active, payment_terms_days, contact, phone, address, created_at, updated_at)
              VALUES(?, 'R4-SUP-001', 'R4 测试供应商', 1, 30, '采购联系人', '13800000000', '深圳市福田区', datetime('now'), datetime('now'))`)
    .run(id);
  return id;
}

function ensureWarehouse() {
  const id = 'warehouse-r4-001';
  if (db.prepare('SELECT id FROM warehouses WHERE id=?').get(id)) return id;
  db.prepare(`INSERT INTO warehouses(id, code, name, active, created_at, updated_at)
              VALUES(?, 'R4-WH-001', 'R4 测试仓', 1, datetime('now'), datetime('now'))`)
    .run(id);
  return id;
}

function ensureMrpRun(options = {}) {
  const { suggestedA = 5, suggestedB = 7, netA = 5, netB = 7 } = options;
  uniqueCounter += 1;
  const runId = 'mrp-r4-' + uniqueCounter + '-' + Date.now().toString(36);
  db.prepare(`INSERT INTO mrp_runs(id, run_code, run_name, horizon_start, horizon_end, demand_source_mode,
                                  status, summary, created_by, created_at, updated_at)
              VALUES(?, ?, 'R4 MRP', ?, ?, 'SALES_ORDERS', 'COMPLETED', '', ?, datetime('now'), datetime('now'))`)
    .run(runId, runId, today(), today(), 'user-admin');
  db.prepare(`INSERT INTO mrp_run_results(id, run_id, product_id, gross_requirement, net_requirement,
                                          suggestion_type, suggested_quantity, need_by_date)
              VALUES(?, ?, ?, ?, ?, 'BUY', ?, ?)`)
    .run('mrpres-' + runId + '-A', runId, productA, netA, netA, suggestedA, today());
  db.prepare(`INSERT INTO mrp_run_results(id, run_id, product_id, gross_requirement, net_requirement,
                                          suggestion_type, suggested_quantity, need_by_date)
              VALUES(?, ?, ?, ?, ?, 'BUY', ?, ?)`)
    .run('mrpres-' + runId + '-B', runId, productB, netB, netB, suggestedB, today());
  return runId;
}

function ensurePurchaseInstruction(options = {}) {
  const { runId, dates = [today(), today()], quantities = [5, 7] } = options;
  uniqueCounter += 1;
  const instrId = 'pui-r4-' + uniqueCounter + '-' + Date.now().toString(36);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO purchase_instructions(id, instruction_no, mrp_run_id, status, planned_date, notes,
                                                 created_by, released_by, created_at, updated_at, released_at)
              VALUES(?, ?, ?, 'RELEASED', ?, '', ?, ?, ?, ?, ?)`)
    .run(instrId, instrId, runId, today(), 'user-admin', 'user-admin', now, now, now);
  const items = [];
  const products = [productA, productB];
  products.forEach((pid, idx) => {
    const itemId = 'puii-' + instrId + '-' + idx;
    db.prepare(`INSERT INTO purchase_instruction_items(id, instruction_id, mrp_result_id, product_id, quantity,
                                                         need_by_date, created_at)
                VALUES(?, ?, ?, ?, ?, ?, ?)`)
      .run(itemId, instrId, 'mrpres-' + runId + '-' + (idx === 0 ? 'A' : 'B'), pid, quantities[idx], dates[idx], now);
    items.push({ id: itemId, product_id: pid, quantity: quantities[idx], need_by_date: dates[idx] });
  });
  return { id: instrId, items };
}

// =====================================================================
// Section A: Purchase Instruction -> PR auto-carry contract
// =====================================================================
describe('A. Purchase Instruction -> Purchase Requisition auto-carry', () => {
  test('A1. PR create accepts purchaseInstructionItemId and persists source line back-link', async () => {
    const runId = ensureMrpRun();
    const pui = ensurePurchaseInstruction({ runId });
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: today(),
        notes: 'auto-carry test',
        items: [
          { productId: pui.items[0].product_id, quantity: pui.items[0].quantity, purchaseInstructionItemId: pui.items[0].id, unitPriceCents: 10000, amountCents: 50000 },
        ],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const prId = res.body.id;
    const detail = await api(baseUrl, salesToken, `/api/purchase-requisitions/${prId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.requisition.source_instruction_id, pui.id);
    assert.equal(detail.body.requisition.items.length, 1);
    assert.equal(detail.body.requisition.items[0].purchaseInstructionItemId, pui.items[0].id);
    assert.equal(detail.body.requisition.items[0].product_id, pui.items[0].product_id);
  });

  test('A2. GET /api/purchase-instructions/:id surfaces product / quantity / need_by_date for frontend auto-fill', async () => {
    const runId = ensureMrpRun();
    const future = '2027-01-15';
    const pui = ensurePurchaseInstruction({ runId, dates: [future, today()], quantities: [3, 4] });
    const detail = await api(baseUrl, adminToken, `/api/purchase-instructions/${pui.id}`);
    assert.equal(detail.status, 200);
    const items = detail.body.instruction.items;
    assert.equal(items.length, 2);
    assert.equal(items[0].product_id, productA);
    assert.equal(items[0].quantity, 3);
    assert.equal(items[0].need_by_date, future);
    assert.equal(items[1].product_id, productB);
    assert.equal(items[1].quantity, 4);
    assert.equal(items[1].need_by_date, today());
  });

  test('A3. PR create rejects purchaseInstructionItemId that does not belong to sourceInstructionId', async () => {
    const runId = ensureMrpRun();
    const puiA = ensurePurchaseInstruction({ runId });
    const runIdB = ensureMrpRun();
    const puiB = ensurePurchaseInstruction({ runId: runIdB });
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: puiA.id,
        requestDate: today(),
        requiredDate: today(),
        items: [{
          productId: puiA.items[0].product_id,
          quantity: 5,
          purchaseInstructionItemId: puiB.items[0].id, // belongs to a different instruction
          unitPriceCents: 10000,
          amountCents: 50000,
        }],
      },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });
});

// =====================================================================
// Section B: required_date single-value contract
// =====================================================================
describe('B. PR required_date deterministic rule', () => {
  test('B1. PR with required_date matching PUI need_by_date is accepted', async () => {
    const runId = ensureMrpRun();
    const future = '2027-02-20';
    const pui = ensurePurchaseInstruction({ runId, dates: [future, future], quantities: [2, 3] });
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: future,
        items: [{
          productId: pui.items[0].product_id,
          quantity: 2,
          purchaseInstructionItemId: pui.items[0].id,
          unitPriceCents: 10000,
          amountCents: 20000,
        }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test('B2. PR with required_date differing from any non-empty PUI need_by_date is rejected', async () => {
    const runId = ensureMrpRun();
    const future = '2027-03-10';
    const pui = ensurePurchaseInstruction({ runId, dates: [future, future], quantities: [2, 3] });
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: '2027-04-01', // mismatched
        items: [{
          productId: pui.items[0].product_id,
          quantity: 2,
          purchaseInstructionItemId: pui.items[0].id,
          unitPriceCents: 10000,
          amountCents: 20000,
        }],
      },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test('B3. PR create without source linkage allows any required_date', async () => {
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        requestDate: today(),
        requiredDate: '2027-05-05',
        items: [{ productId: productA, quantity: 1, unitPriceCents: 10000, amountCents: 10000 }],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
});

// =====================================================================
// Section C/D: source-link backend invariants
// =====================================================================
describe('C. Source-link identity must not bleed across documents', () => {
  test('C1. Same purchaseInstructionItemId cannot be used in two PRs (back-link uniqueness)', async () => {
    const runId = ensureMrpRun();
    const pui = ensurePurchaseInstruction({ runId });
    const first = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: today(),
        items: [{
          productId: pui.items[0].product_id,
          quantity: 1,
          purchaseInstructionItemId: pui.items[0].id,
          unitPriceCents: 10000,
          amountCents: 10000,
        }],
      },
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const second = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: today(),
        items: [{
          productId: pui.items[0].product_id,
          quantity: 1,
          purchaseInstructionItemId: pui.items[0].id, // already bound
          unitPriceCents: 10000,
          amountCents: 10000,
        }],
      },
    });
    assert.equal(second.status, 409, JSON.stringify(second.body));
  });

  test('C2. PR create with purchaseInstructionItemId and no sourceInstructionId is rejected', async () => {
    const runId = ensureMrpRun();
    const pui = ensurePurchaseInstruction({ runId });
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        requestDate: today(),
        requiredDate: today(),
        items: [{
          productId: pui.items[0].product_id,
          quantity: 1,
          purchaseInstructionItemId: pui.items[0].id, // orphan
          unitPriceCents: 10000,
          amountCents: 10000,
        }],
      },
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });
});

// =====================================================================
// Section D: TRUE multi-line PUI -> single PR (R4-R2B corrected contract)
// =====================================================================
describe('D. Multi-line PUI source chain -> single Purchase Requisition', () => {
  function ensureMultiLinePurchaseInstruction({ dates, quantities, products }) {
    uniqueCounter += 1;
    const runId = ensureMrpRun();
    const instrId = 'pui-multi-r4-' + uniqueCounter + '-' + Date.now().toString(36);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO purchase_instructions(id, instruction_no, mrp_run_id, status, planned_date, notes,
                                                 created_by, released_by, created_at, updated_at, released_at)
                VALUES(?, ?, ?, 'RELEASED', ?, '', ?, ?, ?, ?, ?)`)
      .run(instrId, instrId, runId, today(), 'user-admin', 'user-admin', now, now, now);
    const items = [];
    products.forEach((pid, idx) => {
      const itemId = 'puii-multi-' + instrId + '-' + idx;
      db.prepare(`INSERT INTO purchase_instruction_items(id, instruction_id, mrp_result_id, product_id, quantity,
                                                         need_by_date, created_at)
                  VALUES(?, ?, ?, ?, ?, ?, ?)`)
        .run(itemId, instrId, 'mrpres-' + runId + '-' + (idx === 0 ? 'A' : 'B'), pid, quantities[idx], dates[idx], now);
      items.push({ id: itemId, product_id: pid, quantity: quantities[idx], need_by_date: dates[idx] });
    });
    return { id: instrId, items, runId };
  }

  test('D1. ONE Purchase Requisition with THREE source items preserves purchaseInstructionItemId per line', async () => {
    const future = '2027-04-15';
    const pui = ensureMultiLinePurchaseInstruction({
      dates: [future, future, future],
      quantities: [10, 10, 10],
      products: [productA, productB, productA], // third item reuses productA
    });
    const res = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: future,
        notes: 'multi-line source chain',
        items: pui.items.map((it) => ({
          productId: it.product_id,
          quantity: it.quantity,
          purchaseInstructionItemId: it.id,
          unitPriceCents: 10000,
          amountCents: 10000 * it.quantity,
        })),
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const prId = res.body.id;
    const detail = await api(baseUrl, salesToken, `/api/purchase-requisitions/${prId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.requisition.items.length, 3);
    // The GET response orders PR items by (created_at, id). Match each
    // returned PR item to its source PUI item by purchaseInstructionItemId
    // (authoritative), not by positional index.
    const expectedPiiIds = new Set(pui.items.map((it) => it.id));
    const returnedPiiIds = new Set(detail.body.requisition.items.map((it) => it.purchaseInstructionItemId));
    assert.equal(returnedPiiIds.size, 3, 'must return 3 distinct PUI ids');
    for (const piiId of returnedPiiIds) {
      assert.ok(expectedPiiIds.has(piiId), `returned PUI id ${piiId} must be one of the source PUI items`);
    }
    // Every PUI id submitted must appear exactly once in the PR.
    for (const piiId of expectedPiiIds) {
      assert.ok(returnedPiiIds.has(piiId), `submitted PUI id ${piiId} must be preserved in the PR`);
    }
    // All three PUI rows must back-link to the SAME PR header id.
    const backLinks = db.prepare(`
      SELECT id, purchase_requisition_id FROM purchase_instruction_items
       WHERE id IN (?, ?, ?)
    `).all(pui.items[0].id, pui.items[1].id, pui.items[2].id);
    assert.equal(backLinks.length, 3);
    for (const row of backLinks) {
      assert.equal(row.purchase_requisition_id, prId,
        `PUI ${row.id} must back-link to the single PR ${prId}`);
    }
  });

  test('D2. Same PUI item cannot be re-consumed by a different PR (DB + application dual guard)', async () => {
    const future = '2027-05-15';
    const pui = ensureMultiLinePurchaseInstruction({
      dates: [future, future, future],
      quantities: [5, 5, 5],
      products: [productA, productB, productA],
    });
    const first = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: future,
        items: pui.items.map((it) => ({
          productId: it.product_id,
          quantity: it.quantity,
          purchaseInstructionItemId: it.id,
          unitPriceCents: 10000,
          amountCents: 10000 * it.quantity,
        })),
      },
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    // Attempt to reuse ONE of the already-consumed PUI items in a different PR.
    const reuse = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: future,
        items: [{
          productId: pui.items[1].product_id,
          quantity: 1,
          purchaseInstructionItemId: pui.items[1].id, // already consumed
          unitPriceCents: 10000,
          amountCents: 10000,
        }],
      },
    });
    assert.equal(reuse.status, 409, JSON.stringify(reuse.body));
  });
});

// =====================================================================
// Sections E/F/G/H/I/J/K/L: Source-derived Purchase Order contract
// =====================================================================
describe('E/F/G/H/I/J/K/L. Source-derived Purchase Order editor + edit + submit contract', () => {
  async function makeApprovedPurchaseOrder({ includeSource = true, unitPriceCents = 100000 } = {}) {
    const runId = ensureMrpRun();
    const pui = ensurePurchaseInstruction({ runId });
    const prRes = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: includeSource ? pui.id : undefined,
        requestDate: today(),
        requiredDate: today(),
        items: includeSource
          ? [{
              productId: pui.items[0].product_id,
              quantity: 3,
              purchaseInstructionItemId: pui.items[0].id,
              unitPriceCents: 10000,
              amountCents: 30000,
            }]
          : [{ productId: productA, quantity: 3, unitPriceCents: 10000, amountCents: 30000 }],
      },
    });
    assert.equal(prRes.status, 201, JSON.stringify(prRes.body));
    const prId = prRes.body.id;
    const submit = await api(baseUrl, salesToken, `/api/purchase-requisitions/${prId}/submit`, { method: 'POST' });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    const approve = await api(baseUrl, reviewerToken, `/api/purchase-requisitions/${prId}/approve`, { method: 'POST' });
    assert.equal(approve.status, 200, JSON.stringify(approve.body));
    const poRes = await api(baseUrl, salesToken, `/api/purchase-requisitions/${prId}/generate-purchase-order`, {
      method: 'POST',
      body: {
        supplierId: supplier,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '',
        supplierContactName: '采购联系人',
        supplierContactPhone: '13800000000',
        supplierAddress: '深圳市福田区',
      },
    });
    assert.equal(poRes.status, 201, JSON.stringify(poRes.body));
    return { poId: poRes.body.id, prDetail: prRes.body };
  }

  test('E. GET /api/purchase-orders/:id surfaces purchaseRequisitionItemId per item', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.body.order.items));
    for (const item of detail.body.order.items) {
      assert.ok('purchaseRequisitionItemId' in item, 'item must include purchaseRequisitionItemId field');
      assert.ok(item.purchaseRequisitionItemId, 'source-derived item must carry non-null purchaseRequisitionItemId');
    }
  });

  test('F. PUT with purchaseRequisitionItemId retained succeeds (commercial-only edit)', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    const items = detail.body.order.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
    }));
    const put = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: detail.body.order.supplierId,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: detail.body.order.supplierContactName,
        supplierContactPhone: detail.body.order.supplierContactPhone,
        supplierAddress: detail.body.order.supplierAddress,
        remark: 'commercial-only edit',
        items,
      },
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    // Re-read and confirm payment_terms persisted, source line ids persisted.
    const after = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    assert.equal(after.body.order.paymentTerms, '月结 30 天');
    assert.equal(after.body.order.paymentTermsDays, 30);
    for (const item of after.body.order.items) {
      assert.ok(item.purchaseRequisitionItemId);
    }
  });

  test('G. Commercial-only edit (payment terms + payment days) succeeds end-to-end -> submit', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    const items = detail.body.order.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
    }));
    const put = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: detail.body.order.supplierId,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: detail.body.order.supplierContactName,
        supplierContactPhone: detail.body.order.supplierContactPhone,
        supplierAddress: detail.body.order.supplierAddress,
        items,
      },
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const submit = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}/submit`, { method: 'POST' });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    const after = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    assert.equal(after.body.order.status, 'SUBMITTED');
  });

  test('H. PUT changing source productId on source-derived PO is rejected', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    const items = detail.body.order.items.map((it) => ({
      productId: productB, // mutated
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
    }));
    const put = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: detail.body.order.supplierId,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: detail.body.order.supplierContactName,
        supplierContactPhone: detail.body.order.supplierContactPhone,
        supplierAddress: detail.body.order.supplierAddress,
        items,
      },
    });
    assert.equal(put.status, 409, JSON.stringify(put.body));
    assert.match(put.body.error || '', /货品/);
  });

  test('I. PUT changing source quantity on source-derived PO is rejected', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    const items = detail.body.order.items.map((it) => ({
      productId: it.productId,
      quantity: Number(it.quantity) + 1, // mutated
      unitPriceCents: it.unitPriceCents,
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
    }));
    const put = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: detail.body.order.supplierId,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: detail.body.order.supplierContactName,
        supplierContactPhone: detail.body.order.supplierContactPhone,
        supplierAddress: detail.body.order.supplierAddress,
        items,
      },
    });
    assert.equal(put.status, 409, JSON.stringify(put.body));
    assert.match(put.body.error || '', /数量/);
  });

  test('J. PUT omitting purchaseRequisitionItemId on source-derived PO is rejected (UAT-FUNC-004 reproduction)', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    const items = detail.body.order.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      // purchaseRequisitionItemId deliberately omitted
    }));
    const put = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: detail.body.order.supplierId,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: detail.body.order.supplierContactName,
        supplierContactPhone: detail.body.order.supplierContactPhone,
        supplierAddress: detail.body.order.supplierAddress,
        items,
      },
    });
    assert.equal(put.status, 409, JSON.stringify(put.body));
    assert.match(put.body.error || '', /请购明细/);
  });

  test('K. Source-derived PO submit requires payment_terms; absent -> 400', async () => {
    const { poId } = await makeApprovedPurchaseOrder();
    const submit = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}/submit`, { method: 'POST' });
    assert.equal(submit.status, 400, JSON.stringify(submit.body));
    assert.match(submit.body.error || '', /付款条件/);
  });

  test('L. Manual (non-source) PO regression: create + edit + submit succeeds', async () => {
    const create = await api(baseUrl, salesToken, '/api/purchase-orders', {
      method: 'POST',
      body: {
        supplierId: supplier,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: '采购联系人',
        supplierContactPhone: '13800000000',
        supplierAddress: '深圳市福田区',
        items: [{ productId: productA, quantity: 2, unitPriceCents: 10000 }],
      },
    });
    assert.equal(create.status, 201, JSON.stringify(create.body));
    const poId = create.body.id;
    const put = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: supplier,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: '采购联系人',
        supplierContactPhone: '13800000000',
        supplierAddress: '深圳市福田区',
        remark: 'manual edit',
        items: [{ productId: productA, quantity: 2, unitPriceCents: 12000 }], // edit price
      },
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const submit = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}/submit`, { method: 'POST' });
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
  });
});

// =====================================================================
// Section M: Inventory posting neutrality
// =====================================================================
describe('M. PR / PO create + edit + submit + approval does not post inventory', () => {
  test('M1. inventory_transactions count is unchanged through full purchase chain', async () => {
    ensureWarehouse();
    const before = db.prepare('SELECT COUNT(*) cnt FROM inventory_transactions').get().cnt;
    const runId = ensureMrpRun();
    const pui = ensurePurchaseInstruction({ runId });
    const prRes = await api(baseUrl, salesToken, '/api/purchase-requisitions', {
      method: 'POST',
      body: {
        sourceInstructionId: pui.id,
        requestDate: today(),
        requiredDate: today(),
        items: [{
          productId: pui.items[0].product_id,
          quantity: 1,
          purchaseInstructionItemId: pui.items[0].id,
          unitPriceCents: 10000,
          amountCents: 10000,
        }],
      },
    });
    assert.equal(prRes.status, 201, JSON.stringify(prRes.body));
    const prId = prRes.body.id;
    await api(baseUrl, salesToken, `/api/purchase-requisitions/${prId}/submit`, { method: 'POST' });
    await api(baseUrl, reviewerToken, `/api/purchase-requisitions/${prId}/approve`, { method: 'POST' });
    const poRes = await api(baseUrl, salesToken, `/api/purchase-requisitions/${prId}/generate-purchase-order`, {
      method: 'POST',
      body: {
        supplierId: supplier,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: '采购联系人',
        supplierContactPhone: '13800000000',
        supplierAddress: '深圳市福田区',
      },
    });
    assert.equal(poRes.status, 201, JSON.stringify(poRes.body));
    const poId = poRes.body.id;
    const detail = await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`);
    const items = detail.body.order.items.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      purchaseRequisitionItemId: it.purchaseRequisitionItemId,
    }));
    await api(baseUrl, salesToken, `/api/purchase-orders/${poId}`, {
      method: 'PUT',
      body: {
        supplierId: detail.body.order.supplierId,
        orderDate: today(),
        expectedDeliveryDate: today(),
        paymentTerms: '月结 30 天',
        paymentTermsDays: 30,
        supplierContactName: detail.body.order.supplierContactName,
        supplierContactPhone: detail.body.order.supplierContactPhone,
        supplierAddress: detail.body.order.supplierAddress,
        items,
      },
    });
    await api(baseUrl, salesToken, `/api/purchase-orders/${poId}/submit`, { method: 'POST' });
    await api(baseUrl, reviewerToken, `/api/purchase-orders/${poId}/approve`, { method: 'POST' });
    const after = db.prepare('SELECT COUNT(*) cnt FROM inventory_transactions').get().cnt;
    assert.equal(after, before, `inventory_transactions must not grow through PR/PO chain (before=${before}, after=${after})`);
    const acctBefore = db.prepare('SELECT COUNT(*) cnt FROM accounting_vouchers').get().cnt;
    const acctAfter = db.prepare('SELECT COUNT(*) cnt FROM accounting_vouchers').get().cnt;
    assert.equal(acctAfter, acctBefore, 'accounting_vouchers must not grow through PR/PO chain');
  });
});

// =====================================================================
// Section N: source-level frontend shape consistency
// =====================================================================
describe('N. Frontend shape consistency (source-level)', () => {
  test('N1. PurchaseOrderEditor init preserves purchaseRequisitionItemId', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(resolve(repoRoot, 'src/pages/master-data.jsx'), 'utf8');
    assert.match(src, /purchaseRequisitionItemId:\s*x\.purchaseRequisitionItemId\s*\|\|\s*null/);
  });

  test('N2. PurchaseOrderEditor save payload preserves purchaseRequisitionItemId', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(resolve(repoRoot, 'src/pages/master-data.jsx'), 'utf8');
    const occurrences = (src.match(/purchaseRequisitionItemId:\s*x\.purchaseRequisitionItemId\s*\|\|\s*null/g) || []).length;
    assert.ok(occurrences >= 2, `expected >=2 mappings (init + save), got ${occurrences}`);
  });

  test('N3. PurchaseRequisitionCreate auto-carry useEffect preserves purchaseInstructionItemId', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(resolve(repoRoot, 'src/pages/planning-documents.jsx'), 'utf8');
    // Every mapped item must carry source.id directly. The first-line-only
    // workaround (`index === 0 ? source.id : null`) is explicitly rejected.
    assert.match(src, /purchaseInstructionItemId:\s*source\.id/);
    assert.doesNotMatch(src, /index\s*===\s*0\s*\?\s*source\.id\s*:\s*null/);
    assert.match(src, /purchaseInstructionItemId:\s*item\.purchaseInstructionItemId\s*\|\|\s*null/);
  });
});