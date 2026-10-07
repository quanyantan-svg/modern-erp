// M12 — Production Instruction, Purchase Instruction, Purchase
// Requisition focused tests.
//
// Coverage:
//   * Production Instruction MAKE eligibility, partial conversion,
//     release, idempotent Production Order generation, cancel rules.
//   * Purchase Instruction BUY eligibility, partial conversion,
//     release.
//   * Purchase Requisition DRAFT -> SUBMITTED -> APPROVED/REJECTED
//     flow, self-approval block, PO generation.
//   * Approval Center integration for PURCHASE_REQUISITION.
//   * Stock and accounting invariance: planning documents produce
//     no inventory_transactions or accounting_vouchers.
//   * M11 netting arithmetic regression (FG net 15, A=30, B=45).
//   * Five-role security contract.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase, id } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;
let adminToken;
let salesToken;
let reviewerToken;
let warehouseToken;
let accountingToken;

async function request(path, { token = adminToken, method = 'GET', body } = {}) {
  const headers = {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data.token;
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m12-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  adminToken = await login('admin', 'admin123');
  salesToken = await login('sales', 'sales123');
  reviewerToken = await login('reviewer', 'review123');
  warehouseToken = await login('warehouse', 'warehouse123');
  accountingToken = await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  try { database.close(); } catch {}
  await new Promise((r) => setTimeout(r, 100));
  try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

// =====================================================================
// helpers
// =====================================================================
function todayIso() { return new Date().toISOString().slice(0, 10); }

function seedBom({ parentId, items, status = 'ACTIVE' }) {
  const bomId = 'bom-' + id().slice(0, 8);
  database.prepare("INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,datetime('now'),datetime('now'))")
    .run(bomId, parentId, 'm12-v1', status, '', 'user-admin');
  const itemStmt = database.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
  items.forEach((it, idx) => itemStmt.run(id(), bomId, it.productId, it.quantity, it.scrapRate || 0, idx + 1));
  return bomId;
}

function seedInventory(warehouseId, productId, qty) {
  database.prepare("INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at) VALUES(?,?,?,?,datetime('now'))")
    .run(id(), warehouseId, productId, qty);
}

function ensureProduct(code, name = code) {
  const pid = 'product-m12-' + code;
  const existing = database.prepare("SELECT id FROM products WHERE id=?").get(pid);
  if (existing) return pid;
  database.prepare(`
    INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,1,datetime('now'),datetime('now'))
  `).run(pid, code, name, '', '', 0, 0);
  return pid;
}

async function runMrp({ token = adminToken, mode = 'SALES_ORDERS', forecastId = null } = {}) {
  const today = todayIso();
  const result = await request('/api/planning/mrp/runs', {
    method: 'POST', token, body: {
      runName: 'M12 MRP ' + Date.now(),
      horizonStart: today,
      horizonEnd: today,
      demandSourceMode: mode,
      forecastId,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const runId = result.data.id;
  const exec = await request(`/api/planning/mrp/runs/${runId}/execute`, { method: 'POST', token });
  assert.equal(exec.status, 200, JSON.stringify(exec.data));
  return runId;
}

function findResult(runId, productId, suggestionType) {
  return database.prepare(`
    SELECT id, suggested_quantity, net_requirement FROM mrp_run_results
     WHERE run_id=? AND product_id=? AND suggestion_type=?
  `).get(runId, productId, suggestionType);
}

// =====================================================================
// Section A: Permission registry
// =====================================================================
describe('A. Permission registry', () => {
  test('A1. new M12 planning-document permissions are registered', async () => {
    const { PERMISSIONS } = await import('./db.js');
    const codes = new Set(PERMISSIONS.map(([code]) => code));
    for (const code of [
      'PRODUCTION_INSTRUCTION_VIEW', 'PRODUCTION_INSTRUCTION_MANAGE',
      'PURCHASE_INSTRUCTION_VIEW', 'PURCHASE_INSTRUCTION_MANAGE',
      'PURCHASE_REQUISITION_VIEW', 'PURCHASE_REQUISITION_MANAGE',
      'PURCHASE_REQUISITION_APPROVE',
    ]) assert.ok(codes.has(code), code);
  });

  test('A2. admin token has all 7 M12 planning-document permissions; reviewer has only PURCHASE_REQUISITION_*', async () => {
    const planning = (perms) => perms.filter((p) => p.startsWith('PRODUCTION_INSTRUCTION_') || p.startsWith('PURCHASE_INSTRUCTION_') || p.startsWith('PURCHASE_REQUISITION_'));
    const adminMe = await request('/api/auth/me', { token: adminToken });
    const reviewerMe = await request('/api/auth/me', { token: reviewerToken });
    const salesMe = await request('/api/auth/me', { token: salesToken });
    const whMe = await request('/api/auth/me', { token: warehouseToken });
    const accMe = await request('/api/auth/me', { token: accountingToken });
    assert.equal(planning(adminMe.data.user.permissions).length, 7, 'admin has all 7');
    assert.deepEqual(planning(reviewerMe.data.user.permissions).sort(), ['PURCHASE_REQUISITION_APPROVE', 'PURCHASE_REQUISITION_VIEW']);
    // V1.3 Phase 1: sales now owns commercial entry — PR create / submit /
    // view. Sales must NOT have PRODUCTION_INSTRUCTION_*, PURCHASE_INSTRUCTION_*,
    // or PURCHASE_REQUISITION_APPROVE.
    const salesPlanning = planning(salesMe.data.user.permissions);
    assert.equal(salesPlanning.length, 2, `sales planning perms = 2, got ${salesPlanning.length} (${salesPlanning.join(',')})`);
    assert.ok(salesPlanning.includes('PURCHASE_REQUISITION_VIEW'));
    assert.ok(salesPlanning.includes('PURCHASE_REQUISITION_MANAGE'));
    assert.ok(!salesPlanning.includes('PURCHASE_REQUISITION_APPROVE'));
    assert.ok(!salesPlanning.some((p) => p.startsWith('PRODUCTION_INSTRUCTION_')));
    assert.ok(!salesPlanning.some((p) => p.startsWith('PURCHASE_INSTRUCTION_')));
    assert.equal(planning(whMe.data.user.permissions).length, 0);
    assert.equal(planning(accMe.data.user.permissions).length, 0);
  });

  test('A3. reviewer has PURCHASE_REQUISITION_VIEW + PURCHASE_REQUISITION_APPROVE', async () => {
    const r = await request('/api/auth/me', { token: reviewerToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.user.permissions.includes('PURCHASE_REQUISITION_VIEW'));
    assert.ok(r.data.user.permissions.includes('PURCHASE_REQUISITION_APPROVE'));
    assert.ok(!r.data.user.permissions.includes('PRODUCTION_INSTRUCTION_MANAGE'));
  });
});

// =====================================================================
// Section B: Production Instruction
// =====================================================================
describe('B. Production Instruction', () => {
  const fgCode = 'P-M12-FG';
  const fgId = ensureProduct(fgCode, 'M12 成品');
  const compCode = 'P-M12-COMP';
  const compId = ensureProduct(compCode, 'M12 组件');
  let warehouseId;
  let bomId;
  let runId;
  let makeResultId;

  before(async () => {
    warehouseId = 'wh-' + id().slice(0, 8);
    database.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))")
      .run(warehouseId, 'WH-M12-' + warehouseId.slice(3, 7), 'M12 测试仓');
    seedInventory(warehouseId, fgId, 0);
    bomId = seedBom({ parentId: fgId, items: [{ productId: compId, quantity: 1 }] });
    database.prepare(`
      INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
      VALUES('so-m12-fixture','SO-M12-FIXTURE','customer-001','APPROVED',0,'','user-sales',datetime('now'),datetime('now'),datetime('now'),datetime('now'))
    `).run();
    database.prepare(`
      INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('soi-m12-fixture','so-m12-fixture',?,100,1000,100000,1)
    `).run(fgId);
    runId = await runMrp();
    const result = findResult(runId, fgId, 'MAKE');
    assert.ok(result, 'MRP must produce a MAKE suggestion for the fixture FG');
    assert.equal(result.net_requirement, 100);
    makeResultId = result.id;
  });

  test('B1. sales cannot list or create production instructions (403)', async () => {
    const list = await request('/api/production-instructions', { token: salesToken });
    assert.equal(list.status, 403);
    const create = await request('/api/production-instructions', { token: salesToken, method: 'POST', body: { mrpRunId: runId, items: [] } });
    assert.equal(create.status, 403);
  });

  test('B2. admin can list production instructions (200)', async () => {
    const list = await request('/api/production-instructions', { token: adminToken });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.data.instructions));
  });

  test('B3. cannot create instruction from a DRAFT MRP run (409)', async () => {
    const draft = await request('/api/planning/mrp/runs', {
      method: 'POST', token: adminToken, body: {
        runName: 'M12 draft', horizonStart: todayIso(), horizonEnd: todayIso(), demandSourceMode: 'SALES_ORDERS',
      },
    });
    assert.equal(draft.status, 201);
    const r = await request('/api/production-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: draft.data.id, items: [{ mrpResultId: makeResultId, quantity: 1 }],
    } });
    assert.equal(r.status, 409);
  });

  test('B4. cannot create instruction from BUY suggestion (400)', async () => {
    const noBom = ensureProduct('P-M12-NOBOM', 'no bom');
    seedInventory(warehouseId, noBom, 0);
    database.prepare(`
      INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('soi-m12-nobom','so-m12-fixture',?,50,1000,50000,2)
    `).run(noBom);
    const runId2 = await runMrp();
    const buy = findResult(runId2, noBom, 'BUY');
    assert.ok(buy);
    const r = await request('/api/production-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId2, items: [{ mrpResultId: buy.id, quantity: 10 }],
    } });
    assert.equal(r.status, 400);
  });

  test('B5. partial conversion: instruction 60 then 40 → both succeed', async () => {
    const a = await request('/api/production-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId, items: [{ mrpResultId: makeResultId, quantity: 60 }],
    } });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    const b = await request('/api/production-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId, items: [{ mrpResultId: makeResultId, quantity: 40 }],
    } });
    assert.equal(b.status, 201, JSON.stringify(b.data));
  });

  test('B6. third instruction with 1 unit is rejected as over-conversion (409)', async () => {
    const c = await request('/api/production-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId, items: [{ mrpResultId: makeResultId, quantity: 1 }],
    } });
    assert.equal(c.status, 409);
  });

  test('B7. conversion metadata on MRP result: suggested 100, converted 100, remaining 0', async () => {
    const r = await request(`/api/planning/mrp/runs/${runId}`, { token: adminToken });
    assert.equal(r.status, 200);
    const fgResult = r.data.run.results.find((row) => row.product_id === fgId && row.suggestion_type === 'MAKE');
    assert.equal(Number(fgResult.suggested_quantity), 100);
    assert.equal(Number(fgResult.converted_quantity), 100);
    assert.equal(Number(fgResult.remaining_quantity), 0);
  });

  test('B8. cannot generate Production Order from a DRAFT instruction (409)', async () => {
    const list = await request('/api/production-instructions', { token: adminToken });
    const inst = list.data.instructions.find((row) => row.instructionNo) || list.data.instructions[0];
    const detail = await request(`/api/production-instructions/${inst.id}`, { token: adminToken });
    assert.equal(detail.status, 200);
    const itemId = detail.data.instruction.items[0].id;
    const r = await request(`/api/production-instructions/${inst.id}/generate-production-order`, {
      method: 'POST', token: adminToken, body: { itemId },
    });
    assert.equal(r.status, 409);
  });

  test('B9. release instruction and generate exactly one Production Order', async () => {
    const list = await request('/api/production-instructions', { token: adminToken });
    const inst = list.data.instructions[0];
    const detail = await request(`/api/production-instructions/${inst.id}`, { token: adminToken });
    const itemId = detail.data.instruction.items[0].id;
    const release = await request(`/api/production-instructions/${inst.id}/release`, { method: 'POST', token: adminToken });
    assert.equal(release.status, 200);
    const gen = await request(`/api/production-instructions/${inst.id}/generate-production-order`, {
      method: 'POST', token: adminToken, body: { itemId },
    });
    assert.equal(gen.status, 201, JSON.stringify(gen.data));
    assert.ok(gen.data.orderNo?.startsWith('MO-'));
    const dup = await request(`/api/production-instructions/${inst.id}/generate-production-order`, {
      method: 'POST', token: adminToken, body: { itemId },
    });
    assert.equal(dup.status, 409);
  });

  test('B10. cancellation of RELEASED instruction with generated PO is rejected (409)', async () => {
    const list = await request('/api/production-instructions', { token: adminToken });
    const inst = list.data.instructions[0];
    const cancel = await request(`/api/production-instructions/${inst.id}/cancel`, { method: 'POST', token: adminToken });
    assert.equal(cancel.status, 409);
  });

  test('B11. cancellation of the unreleased second instruction succeeds; converted reflects first-instruction PO only', async () => {
    // The list returns created_at DESC, so instructions[0] is the latest
    // (40-quantity instruction). After B9 that one was released and has
    // a generated Production Order; instructions[1] (60-quantity) is
    // still DRAFT in the database. Cancellation of a DRAFT instruction
    // never generates a PO so it succeeds and frees up its portion of
    // the conversion capacity.
    const list = await request('/api/production-instructions', { token: adminToken });
    const draft = list.data.instructions.find((row) => row.status === 'DRAFT');
    assert.ok(draft, 'expected one DRAFT instruction remaining');
    const release = await request(`/api/production-instructions/${draft.id}/release`, { method: 'POST', token: adminToken });
    assert.equal(release.status, 200);
    const cancel = await request(`/api/production-instructions/${draft.id}/cancel`, { method: 'POST', token: adminToken });
    assert.equal(cancel.status, 200);
    // After cancellation, the converted_quantity equals the first
    // instruction (40) because the second instruction (60) is now
    // CANCELLED and no longer counts as an active conversion.
    const r = await request(`/api/planning/mrp/runs/${runId}`, { token: adminToken });
    const fgResult = r.data.run.results.find((row) => row.product_id === fgId && row.suggestion_type === 'MAKE');
    assert.equal(Number(fgResult.converted_quantity), 40);
    assert.equal(Number(fgResult.remaining_quantity), 60);
  });
});

// =====================================================================
// Section C: Purchase Instruction
// =====================================================================
describe('C. Purchase Instruction', () => {
  const compOnlyCode = 'P-M12-BUY-ONLY';
  const compOnlyId = ensureProduct(compOnlyCode, 'no bom → BUY');
  let runId2;
  let buyResultId;

  before(async () => {
    const warehouseId = 'wh-' + id().slice(0, 8);
    database.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))")
      .run(warehouseId, 'WH-M12-' + warehouseId.slice(3, 7), 'M12 测试仓 2');
    seedInventory(warehouseId, compOnlyId, 0);
    database.prepare(`
      INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
      VALUES('so-m12-buyfixture','SO-M12-BUYFIX','customer-001','APPROVED',0,'','user-sales',datetime('now'),datetime('now'),datetime('now'),datetime('now'))
    `).run();
    database.prepare(`
      INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('soi-m12-buyfixture','so-m12-buyfixture',?,200,1000,200000,1)
    `).run(compOnlyId);
    runId2 = await runMrp();
    buyResultId = findResult(runId2, compOnlyId, 'BUY').id;
  });

  test('C1. cannot create purchase instruction from MAKE suggestion (400)', async () => {
    // Use the previous fixture run for a MAKE
    const list = await request('/api/planning/mrp/runs', { token: adminToken });
    const completed = list.data.runs.find((row) => row.status === 'COMPLETED');
    const fgResult = database.prepare(`SELECT id FROM mrp_run_results WHERE run_id=? AND suggestion_type='MAKE' LIMIT 1`).get(completed.id);
    const r = await request('/api/purchase-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: completed.id, items: [{ mrpResultId: fgResult.id, quantity: 1 }],
    } });
    assert.equal(r.status, 400);
  });

  test('C2. partial conversion 100 + 100 of 200 succeeds; +1 → 409', async () => {
    const a = await request('/api/purchase-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId2, items: [{ mrpResultId: buyResultId, quantity: 100 }],
    } });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    const b = await request('/api/purchase-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId2, items: [{ mrpResultId: buyResultId, quantity: 100 }],
    } });
    assert.equal(b.status, 201, JSON.stringify(b.data));
    const c = await request('/api/purchase-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: runId2, items: [{ mrpResultId: buyResultId, quantity: 1 }],
    } });
    assert.equal(c.status, 409);
  });

  test('C3. release purchase instruction succeeds', async () => {
    const list = await request('/api/purchase-instructions', { token: adminToken });
    const inst = list.data.instructions[0];
    const r = await request(`/api/purchase-instructions/${inst.id}/release`, { method: 'POST', token: adminToken });
    assert.equal(r.status, 200);
  });
});

// =====================================================================
// Section D: Purchase Requisition
// =====================================================================
describe('D. Purchase Requisition', () => {
  const reqProdCode = 'P-M12-REQ';
  const reqProdId = ensureProduct(reqProdCode, 'M12 请购单测试');
  let purchaseInstructionId;
  let purchaseInstructionItemId;

  before(async () => {
    const warehouseId = 'wh-' + id().slice(0, 8);
    database.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))")
      .run(warehouseId, 'WH-M12-' + warehouseId.slice(3, 7), 'M12 请购仓');
    seedInventory(warehouseId, reqProdId, 0);
    database.prepare(`
      INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
      VALUES('so-m12-reqfixture','SO-M12-REQFIX','customer-001','APPROVED',0,'','user-sales',datetime('now'),datetime('now'),datetime('now'),datetime('now'))
    `).run();
    database.prepare(`
      INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('soi-m12-reqfixture','so-m12-reqfixture',?,500,1000,500000,1)
    `).run(reqProdId);
    const run = await runMrp();
    const buy = findResult(run, reqProdId, 'BUY');
    assert.ok(buy);
    const pui = await request('/api/purchase-instructions', { token: adminToken, method: 'POST', body: {
      mrpRunId: run, items: [{ mrpResultId: buy.id, quantity: 500 }],
    } });
    assert.equal(pui.status, 201, JSON.stringify(pui.data));
    purchaseInstructionId = pui.data.id;
    const detail = await request(`/api/purchase-instructions/${purchaseInstructionId}`, { token: adminToken });
    purchaseInstructionItemId = detail.data.instruction.items[0].id;
    const rel = await request(`/api/purchase-instructions/${purchaseInstructionId}/release`, { method: 'POST', token: adminToken });
    assert.equal(rel.status, 200);
  });

  test('D1. create DRAFT requisition from purchase instruction item', async () => {
    const r = await request('/api/purchase-requisitions', { token: adminToken, method: 'POST', body: {
      sourceInstructionId: purchaseInstructionId,
      requiredDate: todayIso(),
      notes: 'M12 测试请购',
      items: [{ productId: reqProdId, quantity: 500, purchaseInstructionItemId, unitPriceCents: 1000, amountCents: 500000 }],
    } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  });

  test('D2. submitting moves to SUBMITTED and shows up in pending approvals', async () => {
    const list = await request('/api/purchase-requisitions', { token: adminToken });
    const req = list.data.requisitions[0];
    const sub = await request(`/api/purchase-requisitions/${req.id}/submit`, { method: 'POST', token: adminToken });
    assert.equal(sub.status, 200);
    // Pending approvals — reviewer should see it.
    const pending = await request('/api/approvals?tab=pending&limit=50', { token: reviewerToken });
    assert.equal(pending.status, 200);
    const prEntry = pending.data.items.find((row) => row.documentType === 'PURCHASE_REQUISITION');
    assert.ok(prEntry, 'reviewer must see the submitted requisition');
    assert.equal(prEntry.status, 'SUBMITTED');
    assert.equal(prEntry.documentNo, req.requisitionNo);
  });

  test('D3. creator (admin) self-approving is rejected (409)', async () => {
    const list = await request('/api/purchase-requisitions', { token: adminToken });
    const req = list.data.requisitions[0];
    const r = await request(`/api/purchase-requisitions/${req.id}/approve`, { method: 'POST', token: adminToken });
    assert.equal(r.status, 409);
  });

  test('D4. reviewer approves the requisition', async () => {
    const list = await request('/api/purchase-requisitions', { token: adminToken });
    const req = list.data.requisitions[0];
    const r = await request(`/api/purchase-requisitions/${req.id}/approve`, { method: 'POST', token: reviewerToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  });

  test('D5. approved requisition may generate a Purchase Order', async () => {
    const list = await request('/api/purchase-requisitions', { token: adminToken });
    const req = list.data.requisitions[0];
    const gen = await request(`/api/purchase-requisitions/${req.id}/generate-purchase-order`, {
      method: 'POST', token: adminToken, body: { supplierId: 'supplier-001' },
    });
    assert.equal(gen.status, 201, JSON.stringify(gen.data));
    assert.ok(gen.data.orderNo?.startsWith('PO-'));
    const dup = await request(`/api/purchase-requisitions/${req.id}/generate-purchase-order`, {
      method: 'POST', token: adminToken, body: { supplierId: 'supplier-001' },
    });
    assert.equal(dup.status, 409);
  });

  test('D6. cancelling APPROVED requisition with PO is rejected (409)', async () => {
    const list = await request('/api/purchase-requisitions', { token: adminToken });
    const req = list.data.requisitions[0];
    const r = await request(`/api/purchase-requisitions/${req.id}/cancel`, { method: 'POST', token: adminToken });
    assert.equal(r.status, 409);
  });

  test('D7. non-approved requisition cannot generate PO (409)', async () => {
    const sub = await request('/api/purchase-requisitions', { token: adminToken, method: 'POST', body: {
      requiredDate: todayIso(),
      notes: 'manual draft',
      items: [{ productId: reqProdId, quantity: 10, unitPriceCents: 1000, amountCents: 10000 }],
    } });
    assert.equal(sub.status, 201);
    const draft = sub.data.id;
    const r = await request(`/api/purchase-requisitions/${draft}/generate-purchase-order`, {
      method: 'POST', token: adminToken, body: { supplierId: 'supplier-001' },
    });
    assert.equal(r.status, 409);
  });

  test('D8. reject path with required reason (REJECTED), then resubmit', async () => {
    const sub = await request('/api/purchase-requisitions', { token: adminToken, method: 'POST', body: {
      requiredDate: todayIso(),
      notes: 'reject test',
      items: [{ productId: reqProdId, quantity: 10, unitPriceCents: 1000, amountCents: 10000 }],
    } });
    assert.equal(sub.status, 201);
    const rid = sub.data.id;
    const submit = await request(`/api/purchase-requisitions/${rid}/submit`, { method: 'POST', token: adminToken });
    assert.equal(submit.status, 200);
    const reject = await request(`/api/purchase-requisitions/${rid}/reject`, {
      method: 'POST', token: reviewerToken, body: { reason: '数量超预算' },
    });
    assert.equal(reject.status, 200);
    const detail = await request(`/api/purchase-requisitions/${rid}`, { token: adminToken });
    assert.equal(detail.data.requisition.status, 'REJECTED');
    assert.equal(detail.data.requisition.rejection_reason, '数量超预算');
    const resubmit = await request(`/api/purchase-requisitions/${rid}/submit`, { method: 'POST', token: adminToken });
    assert.equal(resubmit.status, 200);
  });
});

// =====================================================================
// Section E: Approval Center integration
// =====================================================================
describe('E. Approval Center', () => {
  test('E1. non-approval-role tokens do not see PURCHASE_REQUISITION rows', async () => {
    const r = await request('/api/approvals?tab=pending&limit=50', { token: salesToken });
    assert.equal(r.status, 200);
    assert.ok(!r.data.items.some((row) => row.documentType === 'PURCHASE_REQUISITION'));
  });

  test('E2. warehouse token does not see PURCHASE_REQUISITION rows', async () => {
    const r = await request('/api/approvals?tab=pending&limit=50', { token: warehouseToken });
    assert.equal(r.status, 200);
    assert.ok(!r.data.items.some((row) => row.documentType === 'PURCHASE_REQUISITION'));
  });

  test('E3. approval center exposes the approved document families', async () => {
    const { APPROVAL_DOCUMENT_TYPES } = await import('./modules/approvals.js');
    const expected = new Set(['SALES_ORDER', 'PURCHASE_ORDER', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER', 'PURCHASE_REQUISITION', 'PRODUCTION_ORDER']);
    assert.equal(APPROVAL_DOCUMENT_TYPES.length, expected.size);
    for (const t of APPROVAL_DOCUMENT_TYPES) assert.ok(expected.has(t), t);
  });
});

// =====================================================================
// Section F: Stock & accounting invariance
// =====================================================================
describe('F. Stock & accounting invariance', () => {
  test('F1. creating/releasing/generating planning documents writes 0 inventory_transactions and 0 accounting_vouchers', () => {
    const inv = database.prepare('SELECT COUNT(*) cnt FROM inventory_transactions').get().cnt;
    const vou = database.prepare('SELECT COUNT(*) cnt FROM accounting_vouchers').get().cnt;
    assert.equal(inv, 0, 'no inventory_transactions allowed from M12 planning docs');
    assert.equal(vou, 0, 'no accounting_vouchers allowed from M12 planning docs');
  });

  test('F2. canonical purchase orders / production orders are only created on explicit generate', () => {
    const po = database.prepare("SELECT COUNT(*) cnt FROM purchase_orders WHERE order_no NOT LIKE 'PO-%'").get().cnt;
    assert.equal(po, 0, 'no unrecognised POs');
  });
});

// =====================================================================
// Section G: M11 netting arithmetic regression
// =====================================================================
describe('G. M11 netting arithmetic regression', () => {
  const fg = ensureProduct('P-M12-FG-NET', 'M11 netting regression FG');
  const a = ensureProduct('P-M12-A', 'M11 A component');
  const b = ensureProduct('P-M12-B', 'M11 B component');
  let runId;

  before(async () => {
    const warehouseId = 'wh-' + id().slice(0, 8);
    database.prepare("INSERT INTO warehouses(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,datetime('now'),datetime('now'))")
      .run(warehouseId, 'WH-M12-NET', 'M11 regression');
    seedInventory(warehouseId, fg, 3);
    seedInventory(warehouseId, a, 0);
    seedInventory(warehouseId, b, 0);
    seedBom({ parentId: fg, items: [{ productId: a, quantity: 2 }, { productId: b, quantity: 3 }] });
    database.prepare(`
      INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,reviewed_at,created_at,updated_at)
      VALUES('so-m11-net','SO-M11-NET','customer-001','APPROVED',0,'','user-sales',datetime('now'),datetime('now'),datetime('now'),datetime('now'))
    `).run();
    database.prepare(`
      INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
      VALUES('soi-m11-net','so-m11-net',?,20,1000,20000,1)
    `).run(fg);
    const prodId = 'po-m11-net-' + id().slice(0, 6);
    database.prepare(`
      INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,planned_start,planned_finish,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,NULL,2,'PENDING',NULL,NULL,'','user-admin',datetime('now'),datetime('now'))
    `).run(prodId, 'MO-M11-NET', fg);
    runId = await runMrp();
  });

  test('G1. net MAKE 15 with components A=30, B=45 unchanged after M12', async () => {
    const r = await request(`/api/planning/mrp/runs/${runId}`, { token: adminToken });
    const fgRow = r.data.run.results.find((row) => row.product_id === fg);
    assert.equal(Number(fgRow.suggested_quantity), 15);
    assert.equal(Number(fgRow.net_requirement), 15);
    const aRow = r.data.run.results.find((row) => row.product_id === a);
    const bRow = r.data.run.results.find((row) => row.product_id === b);
    assert.equal(Number(aRow.gross_component_demand), 30);
    assert.equal(Number(bRow.gross_component_demand), 45);
  });
});

// =====================================================================
// Section H: Permission contract — no role gains planning docs by accident
// =====================================================================
describe('H. Permission contract', () => {
  test('H1. sales token returns 403 on production / purchase instructions, 200 on purchase requisitions', async () => {
    // V1.3 Phase 1: sales owns commercial entry (PR / SO / PO). It must NOT
    // see / mutate production instructions or purchase instructions.
    const r1 = await request('/api/production-instructions', { token: salesToken });
    const r2 = await request('/api/purchase-instructions', { token: salesToken });
    const r3 = await request('/api/purchase-requisitions', { token: salesToken });
    assert.equal(r1.status, 403, `sales /api/production-instructions must be 403, got ${r1.status}`);
    assert.equal(r2.status, 403, `sales /api/purchase-instructions must be 403, got ${r2.status}`);
    assert.equal(r3.status, 200, `sales /api/purchase-requisitions must be 200 (PR view), got ${r3.status}`);
  });

  test('H2. warehouse token returns 403 on planning documents', async () => {
    const r1 = await request('/api/production-instructions', { token: warehouseToken });
    const r2 = await request('/api/purchase-instructions', { token: warehouseToken });
    const r3 = await request('/api/purchase-requisitions', { token: warehouseToken });
    assert.equal(r1.status, 403);
    assert.equal(r2.status, 403);
    assert.equal(r3.status, 403);
  });

  test('H3. accounting token returns 403 on planning documents', async () => {
    const r1 = await request('/api/production-instructions', { token: accountingToken });
    const r2 = await request('/api/purchase-instructions', { token: accountingToken });
    const r3 = await request('/api/purchase-requisitions', { token: accountingToken });
    assert.equal(r1.status, 403);
    assert.equal(r2.status, 403);
    assert.equal(r3.status, 403);
  });

  test('H4. reviewer can list purchase-requisitions (200) but cannot manage (403)', async () => {
    const list = await request('/api/purchase-requisitions', { token: reviewerToken });
    assert.equal(list.status, 200);
    const create = await request('/api/purchase-requisitions', { token: reviewerToken, method: 'POST', body: {
      requiredDate: todayIso(), notes: '', items: [{ productId: 'product-001', quantity: 1, unitPriceCents: 100, amountCents: 100 }],
    } });
    assert.equal(create.status, 403);
  });
});

// =====================================================================
// Section I: Idempotency
// =====================================================================
describe('I. Idempotency', () => {
  test('I1. database can be reopened twice without duplicating planning documents', async () => {
    const countBefore = database.prepare('SELECT COUNT(*) cnt FROM production_instructions').get().cnt
      + database.prepare('SELECT COUNT(*) cnt FROM purchase_instructions').get().cnt
      + database.prepare('SELECT COUNT(*) cnt FROM purchase_requisitions').get().cnt;
    database.close();
    database = createDatabase(join(tempDir, 'erp.db'));
    const countAfter = database.prepare('SELECT COUNT(*) cnt FROM production_instructions').get().cnt
      + database.prepare('SELECT COUNT(*) cnt FROM purchase_instructions').get().cnt
      + database.prepare('SELECT COUNT(*) cnt FROM purchase_requisitions').get().cnt;
    assert.equal(countBefore, countAfter, 'reopen must not duplicate planning documents');
  });
});
