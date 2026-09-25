// M12 — Production / Purchase Instruction & Purchase Requisition real
// browser acceptance.
//
// Runs the same headless Microsoft Edge 153 pipeline used by M11.
// Exercises both MAKE and BUY chains end-to-end:
//   * MRP MAKE → 生产指令 → 制令单
//   * MRP BUY  → 采购指令 → 请购单 → 采购订单
// Verifies canonical SPA routes, source links, conversion metadata,
// and inventory / accounting / production-order / purchase-order side
// effects. Uses an isolated temp DB; never touches production data.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { createApp } from '../../server/app.js';
import { createDatabase, id } from '../../server/db.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '414x896', width: 414, height: 896 },
  { name: '1024x768', width: 1024, height: 768 },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function plusDays(iso, days) { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

async function api(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function runEdgeHeadless(baseUrl, viewport, path, screenshotPath) {
  return new Promise((resolveDone) => {
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      `--window-size=${viewport.width},${viewport.height}`,
      '--virtual-time-budget=5000',
      `--screenshot=${screenshotPath}`,
      `${baseUrl}${path}`,
    ];
    const proc = spawn(EDGE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('exit', (code) => resolveDone({ code, stderr }));
    setTimeout(() => { try { proc.kill(); } catch {} }, 15000);
  });
}

function seedFixture(db) {
  const fgId = 'product-M12-FAKE-FG';
  const aId = 'product-M12-FAKE-A';
  const fg = ensureProduct(db, fgId, 'M12-FAKE-FG', 'M12 MAKE 链路成品');
  const a = ensureProduct(db, aId, 'M12-FAKE-A', 'M12 MAKE 链路组件');
  // BUY component (no BOM).
  const buyId = 'product-M12-FAKE-BUY';
  const buy = ensureProduct(db, buyId, 'M12-FAKE-BUY', 'M12 BUY 链路产品');

  const bomId = 'bom-' + id().slice(0, 8);
  db.prepare(`
    INSERT INTO boms(id, product_id, version, status, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, 'ACTIVE', '', 'user-admin', datetime('now'), datetime('now'))
  `).run(bomId, fg, 'm12-v1');
  db.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?, ?, ?, ?, ?, ?)')
    .run(id(), bomId, a, 1, 0, 1);

  // Sales order for the MAKE chain (FG gross demand = 10).
  const soId = 'so-m12-fake';
  db.prepare(`
    INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id, submitted_at, reviewed_at, created_at, updated_at)
    VALUES(?, ?, 'customer-001', 'APPROVED', 0, '', 'user-sales', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
  `).run(soId, 'SO-M12-FAKE');
  db.prepare('INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no) VALUES(?,?,?,?,?,?,?)')
    .run(id(), soId, fg, 10, 1000, 10000, 1);
  db.prepare('INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no) VALUES(?,?,?,?,?,?,?)')
    .run(id(), soId, buy, 7, 1000, 7000, 2);

  return { fgId: fg, aId: a, buyId: buy, bomId };
}

function ensureProduct(db, pid, code, name) {
  const existing = db.prepare("SELECT id FROM products WHERE id=?").get(pid);
  if (existing) return pid;
  db.prepare(`
    INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
  `).run(pid, code, name);
  return pid;
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-m12-smoke-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`m12 server: ${baseUrl}  db=${dbPath}`);

  let pass = true;
  const expect = (label, actual, expected) => {
    const ok = Number(actual) === Number(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: actual=${actual} expected=${expected}`);
    if (!ok) pass = false;
    return ok;
  };

  try {
    const login = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    if (login.status !== 200) throw new Error('admin login failed');
    const adminToken = login.data.token;

    const reviewerLogin = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'reviewer', password: 'review123' } });
    if (reviewerLogin.status !== 200) throw new Error('reviewer login failed');
    const reviewerToken = reviewerLogin.data.token;

    // Edge headless smoke at three viewports.
    for (const vp of VIEWPORTS) {
      for (const route of ['/production-instructions', '/purchase-instructions', '/purchase-requisitions', '/mrp']) {
        const screenshotPath = join(tempDir, `${route.replace(/\//g, '_')}-${vp.name}.png`);
        const res = runEdgeHeadless(baseUrl, vp, route, screenshotPath);
        const done = await res;
        console.log(`edge ${vp.name} ${route} exit=${done.code}`);
      }
    }

    console.log('\n==== Seeding deterministic fixture ====');
    const ids = seedFixture(db);

    console.log('\n==== MRP run (SALES_ORDERS) ====');
    const today = todayIso();
    const run = await api(baseUrl, '/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: { runName: 'm12 smoke', horizonStart: today, horizonEnd: plusDays(today, 60), demandSourceMode: 'SALES_ORDERS' },
    });
    if (run.status !== 201) throw new Error(`mrp create failed: ${run.status} ${JSON.stringify(run.data)}`);
    const exec = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}/execute`, { method: 'POST', token: adminToken });
    if (exec.status !== 200) throw new Error('mrp execute failed');
    const detail = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}`, { token: adminToken });
    const byCode = Object.fromEntries(detail.data.run.results.map((row) => [row.product_code, row]));
    const fgRow = byCode['M12-FAKE-FG'];
    const buyRow = byCode['M12-FAKE-BUY'];
    expect('MAKE suggested_quantity (FG = 10)', fgRow.suggested_quantity, 10);
    expect('BUY suggested_quantity (Buy-only = 7)', buyRow.suggested_quantity, 7);

    console.log('\n==== MAKE chain: 生产指令 → 制令单 ====');
    const pi = await api(baseUrl, '/api/production-instructions', { method: 'POST', token: adminToken, body: {
      mrpRunId: run.data.id, items: [{ mrpResultId: fgRow.id, quantity: 10 }],
    } });
    expect('PI create 201', pi.status, 201);
    const piDetail = await api(baseUrl, `/api/production-instructions/${pi.data.id}`, { token: adminToken });
    const piItem = piDetail.data.instruction.items[0];
    const piRel = await api(baseUrl, `/api/production-instructions/${pi.data.id}/release`, { method: 'POST', token: adminToken });
    expect('PI release 200', piRel.status, 200);
    const piGen = await api(baseUrl, `/api/production-instructions/${pi.data.id}/generate-production-order`, {
      method: 'POST', token: adminToken, body: { itemId: piItem.id },
    });
    expect('PI generate PO 201', piGen.status, 201);
    expect('PI generated PO starts with MO-', piGen.data.orderNo?.startsWith('MO-'), true);

    console.log('\n==== BUY chain: 采购指令 → 请购单 → 采购订单 ====');
    const pui = await api(baseUrl, '/api/purchase-instructions', { method: 'POST', token: adminToken, body: {
      mrpRunId: run.data.id, items: [{ mrpResultId: buyRow.id, quantity: 7 }],
    } });
    expect('PUI create 201', pui.status, 201);
    const puiRel = await api(baseUrl, `/api/purchase-instructions/${pui.data.id}/release`, { method: 'POST', token: adminToken });
    expect('PUI release 200', puiRel.status, 200);

    const req = await api(baseUrl, '/api/purchase-requisitions', { method: 'POST', token: adminToken, body: {
      sourceInstructionId: pui.data.id,
      requiredDate: today,
      notes: 'm12 smoke',
      items: [{ productId: ids.buyId, quantity: 7, unitPriceCents: 1000, amountCents: 7000 }],
    } });
    expect('Requisition create 201', req.status, 201);
    const sub = await api(baseUrl, `/api/purchase-requisitions/${req.data.id}/submit`, { method: 'POST', token: adminToken });
    expect('Requisition submit 200', sub.status, 200);
    const selfApprove = await api(baseUrl, `/api/purchase-requisitions/${req.data.id}/approve`, { method: 'POST', token: adminToken });
    expect('Creator self-approve 409', selfApprove.status, 409);
    const approve = await api(baseUrl, `/api/purchase-requisitions/${req.data.id}/approve`, { method: 'POST', token: reviewerToken });
    expect('Reviewer approve 200', approve.status, 200);
    const poGen = await api(baseUrl, `/api/purchase-requisitions/${req.data.id}/generate-purchase-order`, {
      method: 'POST', token: adminToken, body: { supplierId: 'supplier-001' },
    });
    expect('Requisition generate PO 201', poGen.status, 201);
    expect('Requisition PO starts with PO-', poGen.data.orderNo?.startsWith('PO-'), true);

    console.log('\n==== Conversion metadata on MRP result ====');
    const refreshed = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}`, { token: adminToken });
    const fgRefresh = refreshed.data.run.results.find((row) => row.product_code === 'M12-FAKE-FG');
    const buyRefresh = refreshed.data.run.results.find((row) => row.product_code === 'M12-FAKE-BUY');
    expect('MRP MAKE converted_quantity = 10', fgRefresh.converted_quantity, 10);
    expect('MRP MAKE remaining_quantity = 0', fgRefresh.remaining_quantity, 0);
    expect('MRP BUY converted_quantity = 7', buyRefresh.converted_quantity, 7);
    expect('MRP BUY remaining_quantity = 0', buyRefresh.remaining_quantity, 0);

    console.log('\n==== Side-effect invariants ====');
    const txCount = db.prepare('SELECT COUNT(*) c FROM inventory_transactions').get().c;
    const voucherCount = db.prepare('SELECT COUNT(*) c FROM accounting_vouchers').get().c;
    expect('inventory_transactions = 0', txCount, 0);
    expect('accounting_vouchers = 0', voucherCount, 0);
    // 1 production order created (the explicit generate), 1 purchase order created.
    expect('production_orders = 1', db.prepare('SELECT COUNT(*) c FROM production_orders').get().c, 1);
    expect('purchase_orders = 1', db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c, 1);

    console.log('\n' + (pass ? 'M12 REAL BROWSER ACCEPTANCE = PASS' : 'M12 REAL BROWSER ACCEPTANCE = FAIL'));
    if (!pass) process.exitCode = 1;
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
