import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/app.js';
import { createDatabase } from '../../server/db.js';

const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const outputDir = resolve(process.argv[2] || '.tmp/v161-production');
const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-v161-production-'));
const db = createDatabase(join(tempDir, 'erp.db'));
const server = createServer(createApp(db, { distDir: resolve('dist') }));
const at = '2026-10-02T08:00:00.000Z';
const orderId = 'v161-prod-order';
let browser;

function seed() {
  db.prepare("INSERT INTO products(id,code,name,unit,price_cents,standard_manufacturing_cost_cents,active,created_at,updated_at) VALUES('v161-fg','HY-TC200','智能温湿度控制器','PCS',100000,50000,1,?,?)").run(at, at);
  db.prepare("INSERT INTO products(id,code,name,unit,price_cents,active,created_at,updated_at) VALUES('v161-rm','RM-PCB-200','TC200控制主板','PCS',12800,1,?,?)").run(at, at);
  db.prepare("INSERT INTO boms(id,product_id,version,status,creator_id,created_at,updated_at) VALUES('v161-bom','v161-fg','1.0','ACTIVE','user-admin',?,?)").run(at, at);
  db.prepare("INSERT INTO bom_items(id,bom_id,product_id,quantity,line_no) VALUES('v161-bomi','v161-bom','v161-rm',1,1)").run();
  db.prepare("INSERT INTO product_routings(id,product_id,routing_code,routing_name,version,status,created_at,updated_at) VALUES('v161-routing','v161-fg','RT-HY-TC200','TC200 组装终检','1.0','ACTIVE',?,?)").run(at, at);
  db.prepare("INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,created_at,updated_at) VALUES('v161-routing-op10','v161-routing',10,'ASSEMBLY','组装','WC-A',?,?)").run(at, at);
  db.prepare("INSERT INTO product_routing_operations(id,routing_id,sequence_no,operation_code,operation_name,work_center,created_at,updated_at) VALUES('v161-routing-op20','v161-routing',20,'FINAL-QC','终检','WC-Q',?,?)").run(at, at);
  db.prepare("INSERT INTO production_orders(id,order_no,product_id,bom_id,routing_id_snapshot,quantity,status,planned_start,creator_id,created_at,updated_at) VALUES(?,'MO-20261002-HYTC200','v161-fg','v161-bom','v161-routing',10,'PENDING','2026-10-02','user-admin',?,?)").run(orderId, at, at);
  for (const [id, seq, code, name, wc, date] of [['v161-snap10',10,'ASSEMBLY','组装','WC-A','2026-10-02'], ['v161-snap20',20,'FINAL-QC','终检','WC-Q','2026-10-03']]) {
    db.prepare('INSERT INTO production_order_routing_snapshots(id,production_order_id,routing_id,sequence_no,operation_code,operation_name,work_center,setup_minutes,run_minutes_per_unit,notes,created_at) VALUES(?,?,?,?,?,?,?,0,0,?,?)').run(id, orderId, 'v161-routing', seq, code, name, wc, '', at);
    db.prepare("INSERT INTO production_order_operations(id,production_order_id,routing_snapshot_id,sequence_no,operation_code,operation_name,work_center_code,work_center_name,setup_seconds,run_seconds_per_unit,expected_yield_bps,labor_rate_cents_per_hour,overhead_rate_cents_per_hour,daily_capacity_minutes,planned_input_quantity,planned_date,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,0,0,10000,0,0,480,10,?,'NOT_STARTED',?,?)")
      .run(`v161-op${seq}`, orderId, id, seq, code, name, wc, wc, date, at, at);
  }
  db.prepare("INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no,quantity_per_unit) VALUES('v161-req',?,'v161-rm',10,0,1,1)").run(orderId);
  db.prepare("INSERT INTO production_material_issues(id,issue_no,production_order_id,warehouse_id,status,issue_date,creator_id,created_at,updated_at) VALUES('v161-issue','MI-20261002-HYTC200',?,'warehouse-001','CONFIRMED','2026-10-02','user-admin',?,?)").run(orderId, at, at);
  db.prepare("INSERT INTO production_material_issue_items(id,issue_id,requirement_line_id,product_id,planned_quantity,issue_quantity,line_no) VALUES('v161-issue-item','v161-issue','v161-req','v161-rm',10,10,1)").run();
}

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function report(page, sequence) {
  await page.locator('label').filter({ hasText: '报工工序' }).locator('select').selectOption(`v161-op${sequence}`);
  await page.locator('label').filter({ hasText: '本次良品' }).locator('input').fill('10');
  await page.getByRole('button', { name: '确认报工', exact: true }).click();
  await page.getByRole('button', { name: `完成工序 ${sequence}`, exact: true }).waitFor();
  await page.getByRole('button', { name: `完成工序 ${sequence}`, exact: true }).click();
  await page.getByText(`工序 ${sequence === 10 ? '组装' : '终检'} 已完成`, { exact: true }).waitFor();
}

try {
  mkdirSync(outputDir, { recursive: true });
  seed();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const token = await login(baseUrl);
  browser = await chromium.launch({ executablePath: edgePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript((value) => localStorage.setItem('modern_erp_token', value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(`${baseUrl}#production-orders`, { waitUntil: 'networkidle' });
  await page.getByText('MO-20261002-HYTC200', { exact: true }).click();
  await page.getByRole('button', { name: '开工', exact: true }).click();
  try { await page.locator('label').filter({ hasText: '报工工序' }).locator('select').waitFor(); }
  catch (error) { throw new Error(`${error.message}\nPAGE=${(await page.locator('body').innerText()).slice(0, 3000)}`); }
  await report(page, 10);
  await report(page, 20);
  db.prepare("INSERT INTO production_receipts(id,receipt_no,production_order_id,warehouse_id,quantity,status,receipt_date,creator_id,created_at,updated_at) VALUES('v161-prod-receipt','PRI-20261003-HYTC200',?,'warehouse-001',10,'CONFIRMED','2026-10-03','user-admin',?,?)").run(orderId, at, at);
  await page.getByRole('button', { name: '完工', exact: true }).click();
  await page.getByText('已完工', { exact: true }).first().waitFor();
  assert.equal(db.prepare('SELECT status FROM production_orders WHERE id=?').get(orderId).status, 'COMPLETED');
  await page.screenshot({ path: join(outputDir, 'production-completed-390.png'), fullPage: true });
  process.stdout.write(`${JSON.stringify({ ok: true, journey: 'routed order → start → report/complete op 10 → report/complete op 20 → receipt → complete order', viewport: [390, 844], outputDir }, null, 2)}\n`);
  await context.close();
} finally {
  await browser?.close();
  server.closeAllConnections?.();
  if (server.listening) await new Promise((done) => server.close(done));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}
