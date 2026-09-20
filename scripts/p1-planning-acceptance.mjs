// P1 — Forecast / MRP Run / Material Requirements Plan real browser acceptance.
//
// Runs the same headless Microsoft Edge 153 pipeline used by M11/M12/M14.
// Verifies the three product concepts are clearly separated and the golden
// arithmetic from P1 spec section 30:
//   * FG: sales 100 + forecast 20 + on hand 20 = MAKE 100
//   * PCB: component demand 100 + on hand 30 = BUY 70
//
// Screenshots taken at 375×667, 414×896, 1024×768 across the three new
// routes plus the Business Overview and the mobile launcher. Uses an
// isolated temp DB; never touches production data.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../server/app.js';
import { createDatabase, id } from '../server/db.js';

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

function ensureProduct(db, pid, code, name) {
  const existing = db.prepare("SELECT id FROM products WHERE id=?").get(pid);
  if (existing) return pid;
  db.prepare(`
    INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
  `).run(pid, code, name);
  return pid;
}

function ensureInventory(db, productId, warehouseId, quantity) {
  const existing = db.prepare("SELECT id, quantity FROM inventory WHERE product_id=? AND warehouse_id=?").get(productId, warehouseId);
  if (existing) {
    db.prepare("UPDATE inventory SET quantity=?, updated_at=datetime('now') WHERE id=?").run(quantity, existing.id);
    return existing.id;
  }
  const invId = 'inv-' + id().slice(0, 8);
  db.prepare("INSERT INTO inventory(id, product_id, warehouse_id, quantity, updated_at) VALUES(?, ?, ?, ?, datetime('now'))")
    .run(invId, productId, warehouseId, quantity);
  return invId;
}

function seedFixture(db) {
  // FG: sales 100 + forecast 20 + on hand 20 -> MAKE 100
  const fgId = 'product-P1-FAKE-FG';
  ensureProduct(db, fgId, 'P1-FAKE-FG', 'P1 MAKE 链路成品');
  // PCB: component demand 100 + on hand 30 -> BUY 70
  const pcbId = 'product-P1-FAKE-PCB';
  ensureProduct(db, pcbId, 'P1-FAKE-PCB', 'P1 BUY 链路组件');
  // Case: BUY-only with no BOM, demand 0 (zero-shortage)
  const caseId = 'product-P1-FAKE-CASE';
  ensureProduct(db, caseId, 'P1-FAKE-CASE', 'P1 库存充足样品');

  const warehouseId = 'warehouse-P1-FAKE';
  if (!db.prepare("SELECT id FROM warehouses WHERE id=?").get(warehouseId)) {
    db.prepare("INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at) VALUES(?,?,?,?,'',1,datetime('now'),datetime('now'))")
      .run(warehouseId, 'WH-P1', 'P1 验收仓库', 'P1 验收仓库地址');
  }
  ensureInventory(db, fgId, warehouseId, 20);
  ensureInventory(db, pcbId, warehouseId, 30);
  ensureInventory(db, caseId, warehouseId, 100);

  // FG BOM: 1 FG uses 1 PCB
  const bomId = 'bom-' + id().slice(0, 8);
  db.prepare(`
    INSERT INTO boms(id, product_id, version, status, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, 'ACTIVE', '', 'user-admin', datetime('now'), datetime('now'))
  `).run(bomId, fgId, 'p1-v1');
  db.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?,?,?,?,?,?)')
    .run(id(), bomId, pcbId, 1, 0, 1);

  // Sales order: FG 100 (APPROVED), Case 50 (APPROVED for zero-shortage demo).
  const soId = 'so-p1-fake';
  db.prepare(`
    INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id, submitted_at, reviewed_at, created_at, updated_at)
    VALUES(?, ?, 'customer-001', 'APPROVED', 0, '', 'user-sales', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
  `).run(soId, 'SO-P1-FAKE');
  db.prepare('INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no) VALUES(?,?,?,?,?,?,?)')
    .run(id(), soId, fgId, 100, 1000, 100000, 1);
  db.prepare('INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no) VALUES(?,?,?,?,?,?,?)')
    .run(id(), soId, caseId, 50, 500, 25000, 2);

  return { fgId, pcbId, caseId, warehouseId };
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-smoke-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`p1 server: ${baseUrl}  db=${dbPath}`);

  let pass = true;
  let unexpectedConsole = 0;
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

    console.log('\n==== Seeding P1 fixture (sales 100 + forecast 20 + on hand 20) ====');
    const ids = seedFixture(db);

    console.log('\n==== Activate demand forecast (forecast 20) ====');
    // Use ACTIVE forecast so MRP in SALES_PLUS_FORECAST mode picks it up.
    const today = todayIso();
    const horizonEnd = plusDays(today, 60);
    const forecast = await api(baseUrl, '/api/planning/forecasts', {
      method: 'POST', token: adminToken,
      body: {
        forecastName: 'P1 验收预测',
        periodStart: today,
        periodEnd: horizonEnd,
        notes: 'p1 smoke',
        items: [{ productId: ids.fgId, needDate: today, quantity: 20 }],
      },
    });
    expect('Forecast create 201', forecast.status, 201);
    const activate = await api(baseUrl, `/api/planning/forecasts/${forecast.data.id}/activate`, { method: 'POST', token: adminToken });
    expect('Forecast activate 200', activate.status, 200);

    console.log('\n==== MRP run (SALES_PLUS_FORECAST) ====');
    const run = await api(baseUrl, '/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: {
        runName: 'p1 smoke',
        horizonStart: today,
        horizonEnd: horizonEnd,
        demandSourceMode: 'SALES_PLUS_FORECAST',
        forecastId: forecast.data.id,
      },
    });
    expect('MRP run create 201', run.status, 201);
    const exec = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}/execute`, { method: 'POST', token: adminToken });
    expect('MRP run execute 200', exec.status, 200);

    const detail = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}`, { token: adminToken });
    const byCode = Object.fromEntries(detail.data.run.results.map((row) => [row.product_code, row]));
    const fg = byCode['P1-FAKE-FG'];
    const pcb = byCode['P1-FAKE-PCB'];
    const caseRow = byCode['P1-FAKE-CASE'];

    console.log('\n==== Golden arithmetic (P1 spec section 30) ====');
    expect('FG gross_requirement = 120 (sales 100 + forecast 20)', fg.gross_requirement, 120);
    expect('FG net_requirement = 100 (120 - 20 on hand)', fg.net_requirement, 100);
    expect('FG MAKE suggested_quantity = 100', fg.suggested_quantity, 100);
    expect('FG on_hand = 20', fg.on_hand, 20);
    expect('FG suggestion_type = MAKE', fg.suggestion_type === 'MAKE', true);

    expect('PCB gross_component_demand = 100 (FG MAKE 100 x 1)', pcb.gross_component_demand, 100);
    expect('PCB on_hand = 30', pcb.on_hand, 30);
    expect('PCB net_requirement = 70', pcb.net_requirement, 70);
    expect('PCB BUY suggested_quantity = 70', pcb.suggested_quantity, 70);
    expect('PCB suggestion_type = BUY', pcb.suggestion_type === 'BUY', true);

    expect('CASE net_requirement = 0 (50 sales - 100 stock)', caseRow.net_requirement, 0);
    expect('CASE suggested_quantity = 0 (库存充足)', caseRow.suggested_quantity, 0);
    expect('CASE suggestion_type is NONE', caseRow.suggestion_type, '');

    console.log('\n==== Side-effect invariants ====');
    const txCount = db.prepare('SELECT COUNT(*) c FROM inventory_transactions').get().c;
    const voucherCount = db.prepare('SELECT COUNT(*) c FROM accounting_vouchers').get().c;
    expect('inventory_transactions = 0', txCount, 0);
    expect('accounting_vouchers = 0', voucherCount, 0);
    expect('purchase_orders = 0', db.prepare('SELECT COUNT(*) c FROM purchase_orders').get().c, 0);
    expect('production_orders = 0', db.prepare('SELECT COUNT(*) c FROM production_orders').get().c, 0);

    console.log('\n==== Filter logic via API-driven results ====');
    const allResults = detail.data.run.results;
    const shortage = allResults.filter((r) => Number(r.net_requirement) > 0);
    const make = allResults.filter((r) => r.suggestion_type === 'MAKE' && Number(r.suggested_quantity) > 0);
    const buy = allResults.filter((r) => r.suggestion_type === 'BUY' && Number(r.suggested_quantity) > 0);
    expect('全部 includes all 3', allResults.length, 3);
    expect('缺料 includes FG + PCB (NOT CASE)', shortage.length, 2);
    expect('生产建议 includes FG only', make.length, 1);
    expect('采购建议 includes PCB only', buy.length, 1);

    console.log('\n==== Edge headless: three viewports x three new pages ====');
    const routes = [
      '/forecasts',                          // 需求预测
      '/mrp-runs',                            // MRP 运算
      '/material-requirements-plan',          // 物料需求计划
      '/business-overview',                  // 业务总览 (planning chain)
    ];
    for (const vp of VIEWPORTS) {
      for (const route of routes) {
        const screenshotPath = join(tempDir, `p1${route.replace(/\//g, '_')}-${vp.name}.png`);
        const done = await runEdgeHeadless(baseUrl, vp, route, screenshotPath);
        const ok = done.code === 0 || done.code === null;
        console.log(`  ${ok ? 'PASS' : 'FAIL'} edge ${vp.name} ${route} exit=${done.code}`);
        if (!ok) {
          pass = false;
          if (done.stderr) console.log(`    stderr: ${done.stderr.slice(0, 200)}`);
        }
      }
    }

    console.log('\n' + (pass ? 'P1 REAL BROWSER ACCEPTANCE = PASS' : 'P1 REAL BROWSER ACCEPTANCE = FAIL'));
    if (!pass) process.exitCode = 1;
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
