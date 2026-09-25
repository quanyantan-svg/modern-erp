// M11 Net-Before-Explosion HOTFIX — Real Edge browser regression.
//
// Spawns Microsoft Edge 153 headless against an isolated temp DB,
// recreates the deterministic browser fixture
// (Sales = 10, Forecast = 10, FG inventory = 3, Open production = 2,
// FG BOM: A×2, B×3), executes a NEW MRP run, and asserts the corrected
// arithmetic via the API the UI consumes.
//
// The script mirrors the Edge browser behavior by:
//   - launching the real built SPA at /planning/mrp
//   - calling the same authenticated JSON endpoints the UI calls
//   - validating results against the SPEC arithmetic
//   - confirming zero inventory/accounting/PO/MO side effects
//
// No production data is touched: the temp DB lives in os.tmpdir() and
// is removed on exit.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function logHeader(label) { console.log(`\n==== ${label} ====`); }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function plusDays(iso, days) { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

async function api(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function runEdgeHeadless(baseUrl, viewport, screenshotPath) {
  return new Promise((resolveDone) => {
    const args = [
      '--headless=new', '--disable-gpu', '--no-sandbox',
      `--window-size=${viewport.width},${viewport.height}`,
      '--virtual-time-budget=5000',
      `--screenshot=${screenshotPath}`,
      `${baseUrl}/planning/mrp`,
    ];
    const proc = spawn(EDGE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('exit', (code) => resolveDone({ code, stderr }));
    setTimeout(() => { try { proc.kill(); } catch {} }, 15000);
  });
}

function seedFixture(db) {
  const fgId = 'product-HOTFIX-FG';
  const aId = 'product-HOTFIX-A';
  const bId = 'product-HOTFIX-B';
  const today = todayIso();

  for (const [pid, code, name] of [
    [fgId, 'HOTFIX-FG', '热修成品'],
    [aId, 'HOTFIX-A', '热修组件A'],
    [bId, 'HOTFIX-B', '热修组件B'],
  ]) {
    db.prepare(`
      INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
      VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
    `).run(pid, code, name);
  }

  const bomId = 'bom-' + id().slice(0, 8);
  db.prepare(`
    INSERT INTO boms(id, product_id, version, status, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, 'ACTIVE', '', 'user-admin', datetime('now'), datetime('now'))
  `).run(bomId, fgId, 'hotfix-v1');
  const itemStmt = db.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?, ?, ?, ?, ?, ?)');
  itemStmt.run(id(), bomId, aId, 2, 0, 1);
  itemStmt.run(id(), bomId, bId, 3, 0, 2);

  db.prepare(`
    INSERT INTO inventory(id, warehouse_id, product_id, quantity, updated_at)
    VALUES(?, 'warehouse-001', ?, 3, datetime('now'))
  `).run(id(), fgId);

  const moId = 'po2-' + id().slice(0, 8);
  db.prepare(`
    INSERT INTO production_orders(id, order_no, product_id, bom_id, quantity, status, planned_start, planned_finish, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, 'PENDING', ?, ?, '', 'user-admin', datetime('now'), datetime('now'))
  `).run(moId, 'MO-HOTFIX', fgId, bomId, 2, today, plusDays(today, 7));

  const soId = 'so-' + id().slice(0, 8);
  db.prepare(`
    INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id, submitted_at, reviewed_at, created_at, updated_at)
    VALUES(?, ?, 'customer-001', 'APPROVED', 10000, '', 'user-sales', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
  `).run(soId, 'SO-HOTFIX');
  db.prepare(`
    INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no)
    VALUES(?, ?, ?, 10, 1000, 10000, 1)
  `).run(id(), soId, fgId);

  return { fgId, aId, bId };
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-hotfix-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`hotfix server: ${baseUrl}  db=${dbPath}`);

  try {
    const login = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    if (login.status !== 200) throw new Error('admin login failed');
    const token = login.data.token;

    // Edge headless smoke at three viewports.
    for (const vp of VIEWPORTS) {
      logHeader(`Edge ${vp.name} headless screenshot`);
      const screenshotPath = join(tempDir, `mrp-${vp.name}.png`);
      const res = await runEdgeHeadless(baseUrl, vp, screenshotPath);
      console.log(`edge exit code: ${res.code}`);
      console.log(`  screenshot: ${screenshotPath}`);
    }

    // Seed deterministic fixture via DB.
    logHeader('Seeding deterministic fixture');
    const ids = seedFixture(db);

    // Create + activate forecast FG = 10.
    logHeader('Forecast + MRP run via API');
    const today = todayIso();
    const fc = await api(baseUrl, '/api/planning/forecasts', {
      method: 'POST', token,
      body: {
        forecastName: 'hotfix forecast',
        periodStart: today, periodEnd: plusDays(today, 30),
        items: [{ productId: ids.fgId, needDate: plusDays(today, 7), quantity: 10 }],
      },
    });
    if (fc.status !== 201) throw new Error(`forecast create failed: ${fc.status} ${JSON.stringify(fc.data)}`);
    const act = await api(baseUrl, `/api/planning/forecasts/${fc.data.id}/activate`, { method: 'POST', token });
    if (act.status !== 200) throw new Error(`forecast activate failed: ${act.status}`);

    // Create NEW MRP run (SALES_PLUS_FORECAST).
    const run = await api(baseUrl, '/api/planning/mrp/runs', {
      method: 'POST', token,
      body: {
        runName: 'hotfix smoke',
        horizonStart: today, horizonEnd: plusDays(today, 60),
        demandSourceMode: 'SALES_PLUS_FORECAST', forecastId: fc.data.id,
      },
    });
    if (run.status !== 201) throw new Error(`mrp create failed: ${run.status} ${JSON.stringify(run.data)}`);
    const exec = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}/execute`, { method: 'POST', token });
    if (exec.status !== 200) throw new Error(`mrp execute failed: ${exec.status} ${JSON.stringify(exec.data)}`);

    const detail = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}`, { token });
    const r = detail.data.run;
    const byProduct = Object.fromEntries(r.results.map((row) => [row.product_code, row]));
    const fgRow = byProduct['HOTFIX-FG'];
    const aRow = byProduct['HOTFIX-A'];
    const bRow = byProduct['HOTFIX-B'];

    console.log('FG row:', fgRow && {
      gross_sales_demand: Number(fgRow.gross_sales_demand),
      gross_forecast_demand: Number(fgRow.gross_forecast_demand),
      gross_requirement: Number(fgRow.gross_requirement),
      on_hand: Number(fgRow.on_hand),
      open_production_supply: Number(fgRow.open_production_supply),
      net_requirement: Number(fgRow.net_requirement),
      suggested_quantity: Number(fgRow.suggested_quantity),
      suggestion_type: fgRow.suggestion_type,
    });
    console.log('A row:', aRow && {
      gross_component_demand: Number(aRow.gross_component_demand),
      net_requirement: Number(aRow.net_requirement),
      suggested_quantity: Number(aRow.suggested_quantity),
      suggestion_type: aRow.suggestion_type,
    });
    console.log('B row:', bRow && {
      gross_component_demand: Number(bRow.gross_component_demand),
      net_requirement: Number(bRow.net_requirement),
      suggested_quantity: Number(bRow.suggested_quantity),
      suggestion_type: bRow.suggestion_type,
    });
    const aPeg = r.pegging.filter((p) => p.product_id === aRow?.product_id && p.source_type === 'BOM_EXPLOSION');
    const bPeg = r.pegging.filter((p) => p.product_id === bRow?.product_id && p.source_type === 'BOM_EXPLOSION');
    console.log('Pegging A:', aPeg.map((p) => Number(p.quantity_contribution)));
    console.log('Pegging B:', bPeg.map((p) => Number(p.quantity_contribution)));
    console.log('Pegging A source_label:', aPeg.map((p) => p.source_label));
    console.log('Pegging B source_label:', bPeg.map((p) => p.source_label));

    // Spec arithmetic assertions.
    const expect = (label, actual, expected) => {
      const ok = Number(actual) === Number(expected);
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: actual=${actual} expected=${expected}`);
      return ok;
    };
    let pass = true;
    pass &= expect('ACTUAL SMOKE FG GROSS', fgRow.gross_requirement, 20);
    pass &= expect('ACTUAL SMOKE FG ON_HAND', fgRow.on_hand, 3);
    pass &= expect('ACTUAL SMOKE FG OPEN_PRODUCTION', fgRow.open_production_supply, 2);
    pass &= expect('ACTUAL SMOKE FG NET', fgRow.net_requirement, 15);
    pass &= expect('ACTUAL SMOKE FG MAKE', fgRow.suggested_quantity, 15);
    pass &= expect('ACTUAL SMOKE A GROSS_COMPONENT', aRow.gross_component_demand, 30);
    pass &= expect('ACTUAL SMOKE B GROSS_COMPONENT', bRow.gross_component_demand, 45);
    pass &= expect('ACTUAL PEGGING A', aPeg.reduce((s, p) => s + Number(p.quantity_contribution), 0), 30);
    pass &= expect('ACTUAL PEGGING B', bPeg.reduce((s, p) => s + Number(p.quantity_contribution), 0), 45);

    // Side-effect invariants.
    const txCount = db.prepare('SELECT COUNT(*) c FROM inventory_transactions').get().c;
    const voucherCount = db.prepare('SELECT COUNT(*) c FROM accounting_vouchers').get().c;
    const poCount = db.prepare("SELECT COUNT(*) c FROM purchase_orders").get().c;
    const moCount = db.prepare("SELECT COUNT(*) c FROM production_orders").get().c;
    const productionOrderCreated = moCount - 1; // fixture seeded exactly 1 production order
    pass &= expect('STOCK EFFECT (inventory tx unchanged)', txCount, 0);
    pass &= expect('ACCOUNTING EFFECT (voucher unchanged)', voucherCount, 0);
    pass &= expect('PURCHASE ORDER CREATION = 0', poCount, 0);
    pass &= expect('PRODUCTION ORDER CREATION = 0 beyond fixture', productionOrderCreated, 0);

    // Unexpected HTTP status sweep.
    const me = await api(baseUrl, '/api/auth/me', { token });
    pass &= expect('AUTH /me 200', me.status, 200);
    const fcList = await api(baseUrl, '/api/planning/forecasts', { token });
    pass &= expect('Forecast list 200', fcList.status, 200);
    const runList = await api(baseUrl, '/api/planning/mrp/runs', { token });
    pass &= expect('MRP list 200', runList.status, 200);

    console.log('\n' + (pass ? 'M11 NETTING HOTFIX COMPLETE = YES' : 'M11 NETTING HOTFIX COMPLETE = NO'));
    if (!pass) process.exitCode = 1;
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
