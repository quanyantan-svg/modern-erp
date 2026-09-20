// P1 Real Product UX acceptance — Microsoft Edge 153 headless via CDP.
//
// Exercises the three planning product concepts end-to-end against an
// isolated temp DB. Captures actual DOM text via Runtime.evaluate
// instead of relying on screenshot inspection.
//
// Does NOT touch production data. Does NOT modify source.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../server/app.js';
import { createDatabase, id } from '../server/db.js';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const EDGE_VERSION = '153.0.4234.48';

const VIEWPORTS = [
  { name: '375x667', width: 375, height: 667 },
  { name: '414x896', width: 414, height: 896 },
  { name: '1024x768', width: 1024, height: 768 },
];

// ---------------------------------------------------------------------------
// CDP client — minimal WebSocket wrapper.
// ---------------------------------------------------------------------------

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.consoleMessages = [];
    this.pageExceptions = [];
    this.requestFailures = [];
    this.responseReceived = [];
    this.closed = false;
    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      } else if (data.method) {
        if (data.method === 'Runtime.consoleAPICalled') {
          this.consoleMessages.push({
            type: data.params.type,
            text: (data.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '),
          });
        } else if (data.method === 'Runtime.exceptionThrown') {
          const ex = data.params.exceptionDetails;
          this.pageExceptions.push({
            text: ex.text + ' ' + (ex.exception?.description || ''),
          });
        } else if (data.method === 'Network.requestWillBeSent') {
          this.requestFailures.push({ url: data.params.request.url, method: data.params.request.method });
        } else if (data.method === 'Network.responseReceived') {
          const r = data.params.response;
          this.responseReceived.push({ url: r.url, status: r.status });
        }
        const handlers = this.eventHandlers.get(data.method) || [];
        for (const h of handlers) h(data.params);
      }
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('CDP WebSocket closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket is not open for ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    if (!this.eventHandlers.has(method)) this.eventHandlers.set(method, []);
    this.eventHandlers.get(method).push(handler);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(800);
    await this.waitForLoad();
  }

  async waitForLoad(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = await this.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (r.result.value === 'complete') return;
      await sleep(100);
    }
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error('eval error: ' + JSON.stringify(r.exceptionDetails));
    return r.result.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 768,
    });
    await sleep(200);
  }

  async clickByText(selector, text) {
    const expr = `
      (() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const target = els.find((e) => (e.textContent || '').trim() === ${JSON.stringify(text)});
        if (!target) return { ok: false, count: els.length };
        target.click();
        return { ok: true };
      })()
    `;
    return this.eval(expr);
  }

  async clickContaining(selector, text) {
    const expr = `
      (() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const target = els.find((e) => (e.textContent || '').includes(${JSON.stringify(text)}));
        if (!target) return { ok: false };
        target.click();
        return { ok: true };
      })()
    `;
    return this.eval(expr);
  }

  async scrollIntoViewByText(text) {
    const expr = `
      (() => {
        const all = Array.from(document.querySelectorAll('*'));
        const target = all.find((e) => e.children.length === 0 && (e.textContent || '').trim() === ${JSON.stringify(text)});
        if (!target) return false;
        target.scrollIntoView({ block: 'center' });
        return true;
      })()
    `;
    return this.eval(expr);
  }

  async getTexts(selector) {
    const expr = `
      Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .map((e) => (e.textContent || '').trim())
        .filter(Boolean)
    `;
    return this.eval(expr);
  }

  async getHtml(selector) {
    return this.eval(`document.querySelector(${JSON.stringify(selector)})?.innerHTML || null`);
  }

  async getTitle() {
    return this.eval(`document.title`);
  }

  async getBodyText() {
    return this.eval(`document.body.innerText`);
  }

  async checkOverflow() {
    return this.eval(`
      ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
      })
    `);
  }
}

// ---------------------------------------------------------------------------
// Edge process control.
// ---------------------------------------------------------------------------

async function startEdge(userDataDir, port, viewport) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    `--window-size=${viewport.width},${viewport.height}`,
    'about:blank',
  ];
  const proc = spawn(EDGE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString(); });
  // Wait for the debugger to be reachable.
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) {
        const info = await r.json();
        return { proc, info };
      }
    } catch {}
    await sleep(300);
  }
  proc.kill();
  throw new Error('Edge did not start: ' + stderr.slice(0, 500));
}

async function getFreePort() {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const port = probe.address().port;
  await new Promise((resolvePromise) => probe.close(resolvePromise));
  return port;
}

async function stopEdge(edge) {
  if (!edge?.proc || edge.proc.exitCode !== null) return;
  const exited = new Promise((resolvePromise) => edge.proc.once('exit', resolvePromise));
  edge.proc.kill();
  await Promise.race([exited, sleep(3000)]);
}

async function createTab(port, url) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error('new tab failed: ' + r.status);
  return r.json();
}

async function connectToTab(tab, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.binaryType = 'arraybuffer';
    try {
      await new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => reject(new Error('WS open timeout')), 8000);
        const onError = (event) => {
          clearTimeout(timer);
          reject(new Error('WS error: ' + (event.message || 'unknown')));
        };
        ws.addEventListener('error', onError, { once: true });
        ws.addEventListener('open', () => {
          clearTimeout(timer);
          ws.removeEventListener('error', onError);
          resolvePromise();
        }, { once: true });
      });
      await sleep(300);
      return new CdpClient(ws);
    } catch (error) {
      lastError = error;
      try { ws.close(); } catch {}
      if (attempt < attempts) await sleep(250 * attempt);
    }
  }
  throw new Error(`CDP connection failed after ${attempts} attempts: ${lastError?.message || 'unknown error'}`);
}

// ---------------------------------------------------------------------------
// Fixture builders (re-use canonical M12 helpers where possible).
// ---------------------------------------------------------------------------

function todayIso() { return new Date().toISOString().slice(0, 10); }
function plusDays(iso, days) { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

function ensureProduct(db, pid, code, name) {
  if (db.prepare("SELECT id FROM products WHERE id=?").get(pid)) return pid;
  db.prepare(`
    INSERT INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES(?, ?, ?, '', '', 0, 0, 1, datetime('now'), datetime('now'))
  `).run(pid, code, name);
  return pid;
}

function ensureInventory(db, productId, warehouseId, quantity) {
  const existing = db.prepare("SELECT id FROM inventory WHERE product_id=? AND warehouse_id=?").get(productId, warehouseId);
  if (existing) {
    db.prepare("UPDATE inventory SET quantity=?, updated_at=datetime('now') WHERE id=?").run(quantity, existing.id);
    return existing.id;
  }
  const invId = 'inv-' + id().slice(0, 8);
  db.prepare("INSERT INTO inventory(id, product_id, warehouse_id, quantity, updated_at) VALUES(?, ?, ?, ?, datetime('now'))")
    .run(invId, productId, warehouseId, quantity);
  return invId;
}

function seedGoldenFixture(db) {
  const fgId = 'product-X100-FG';
  const pcbId = 'product-X100-PCB';
  const caseId = 'product-X100-CASE';
  const psuId = 'product-X100-PSU';
  ensureProduct(db, fgId, 'X100-FG', 'X100 智能环境控制终端');
  ensureProduct(db, pcbId, 'X100-PCB', 'X100 控制主板');
  ensureProduct(db, caseId, 'X100-CASE', 'X100 铝合金外壳');
  ensureProduct(db, psuId, 'X100-PSU', 'X100 电源');

  const warehouseId = 'warehouse-X100';
  if (!db.prepare("SELECT id FROM warehouses WHERE id=?").get(warehouseId)) {
    db.prepare("INSERT INTO warehouses(id, code, name, address, manager, active, created_at, updated_at) VALUES(?,?,?,?,'',1,datetime('now'),datetime('now'))")
      .run(warehouseId, 'WH-X100', 'X100 仓库', 'X100 仓库地址');
  }
  ensureInventory(db, fgId, warehouseId, 20);
  ensureInventory(db, pcbId, warehouseId, 30);
  ensureInventory(db, caseId, warehouseId, 100);
  ensureInventory(db, psuId, warehouseId, 100);

  // BOM: FG uses PCB×1, CASE×1, PSU×1
  const bomId = 'bom-X100';
  db.prepare(`DELETE FROM bom_items WHERE bom_id=?`).run(bomId);
  db.prepare(`DELETE FROM boms WHERE id=?`).run(bomId);
  db.prepare(`
    INSERT INTO boms(id, product_id, version, status, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, 'ACTIVE', '', 'user-admin', datetime('now'), datetime('now'))
  `).run(bomId, fgId, 'x100-v1');
  db.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?,?,?,?,?,?)')
    .run(id(), bomId, pcbId, 1, 0, 1);
  db.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?,?,?,?,?,?)')
    .run(id(), bomId, caseId, 1, 0, 2);
  db.prepare('INSERT INTO bom_items(id, bom_id, product_id, quantity, scrap_rate, line_no) VALUES(?,?,?,?,?,?)')
    .run(id(), bomId, psuId, 1, 0, 3);

  // Routing (ACTIVE) so FG MAKE has no ROUTING_MISSING warning
  const routingId = 'routing-X100';
  db.prepare(`DELETE FROM product_routings WHERE id=?`).run(routingId);
  db.prepare(`INSERT INTO product_routings(id, product_id, routing_code, routing_name, version, status, notes, created_at, updated_at) VALUES(?,?,?,?,?, 'ACTIVE', '', datetime('now'), datetime('now'))`)
    .run(routingId, fgId, 'X100-RT', 'X100 默认路线', 'v1');
  db.prepare(`DELETE FROM product_routing_operations WHERE routing_id=?`).run(routingId);
  db.prepare(`INSERT INTO product_routing_operations(id, routing_id, sequence_no, operation_code, operation_name, work_center, setup_minutes, run_minutes_per_unit, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
    .run(id(), routingId, 1, 'OP10', '装配', 'WC-ASM', 10, 5);

  // Sales order: FG 100 APPROVED
  const soId = 'so-X100';
  db.prepare(`DELETE FROM sales_order_items WHERE order_id=?`).run(soId);
  db.prepare(`DELETE FROM sales_orders WHERE id=?`).run(soId);
  db.prepare(`
    INSERT INTO sales_orders(id, order_no, customer_id, status, total_cents, remark, creator_id, submitted_at, reviewed_at, created_at, updated_at)
    VALUES(?, ?, 'customer-001', 'APPROVED', 0, '', 'user-sales', datetime('now'), datetime('now'), datetime('now'), datetime('now'))
  `).run(soId, 'SO-X100');
  db.prepare('INSERT INTO sales_order_items(id, order_id, product_id, quantity, unit_price_cents, amount_cents, line_no) VALUES(?,?,?,?,?,?,?)')
    .run(id(), soId, fgId, 100, 10000, 1000000, 1);

  return { fgId, pcbId, caseId, psuId, warehouseId };
}

// ---------------------------------------------------------------------------
// Test orchestration
// ---------------------------------------------------------------------------

async function api(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function loginAsAdmin(baseUrl) {
  const r = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  if (r.status !== 200) throw new Error('admin login failed: ' + JSON.stringify(r.data));
  return r.data.token;
}

const results = {};
const failures = [];
function record(key, value) { results[key] = value; console.log(`[record] ${key} = ${JSON.stringify(value)}`); }
function flag(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(label);
  return ok;
}

async function runUiSweep(baseUrl, viewport, runId) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-ui-'));
  const port = await getFreePort();
  let edge;
  let cdp;
  try {
    edge = await startEdge(userDataDir, port, viewport);
    const tab = await createTab(port, `${baseUrl}/`);
    cdp = await connectToTab(tab);
    // Wait for the page to be ready before changing viewport (which would
    // reload the page and break our session).
    await cdp.waitForLoad();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');
    await cdp.setViewport(viewport.width, viewport.height);
    await cdp.waitForLoad();

    // ---- LOGIN ----
    await cdp.navigate(`${baseUrl}/`);
    await sleep(400);
    const loginResult = await cdp.eval(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return { ok: inputs.length >= 2, username: inputs[0]?.name, password: inputs[1]?.name };
    })()`);
    flag(`${viewport.name} login form rendered`, loginResult.ok, `inputs=${loginResult.username},${loginResult.password}`);

    await cdp.eval(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const setNativeValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setNativeValue(inputs[0], 'admin');
      setNativeValue(inputs[1], 'admin123');
      const form = inputs[0].closest('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return true;
    })()`);
    // Wait for launcher to render
    let launcherReady = false;
    for (let i = 0; i < 30; i++) {
      launcherReady = await cdp.eval(`!!document.querySelector('[data-testid^="mobile-launcher-item-"]')`);
      if (launcherReady) break;
      await sleep(200);
    }
    const afterLogin = await cdp.getBodyText();
    flag(`${viewport.name} login completes → launcher visible`, launcherReady, `bodyLen=${afterLogin.length}`);

    // ---- LAUNCHER ----
    const launcherLabels = await cdp.eval(`
      Array.from(document.querySelectorAll('.mobile-launcher__item-label, [data-testid^="mobile-launcher-item"] .mobile-launcher__item-label'))
        .map((e) => (e.textContent || '').trim())
    `);
    record(`${viewport.name}.launcherLabels`, launcherLabels);
    record(`${viewport.name}.has需求预测`, launcherLabels.includes('需求预测'));
    record(`${viewport.name}.hasMRP运算`, launcherLabels.includes('MRP 运算'));
    record(`${viewport.name}.has物料需求计划`, launcherLabels.includes('物料需求计划'));
    record(`${viewport.name}.noLegacyMRP物料需求计划`, !launcherLabels.some((l) => l === 'MRP物料需求计划'));
    flag(`${viewport.name} launcher has 需求预测`, launcherLabels.includes('需求预测'));
    flag(`${viewport.name} launcher has MRP 运算`, launcherLabels.includes('MRP 运算'));
    flag(`${viewport.name} launcher has 物料需求计划`, launcherLabels.includes('物料需求计划'));
    flag(`${viewport.name} no duplicate legacy MRP`, !launcherLabels.some((l) => l === 'MRP物料需求计划'));

    // ---- DEMAND FORECAST ----
    const forecastClickResult = await cdp.eval(`(() => {
      const item = Array.from(document.querySelectorAll('[data-testid^="mobile-launcher-item-"]'))
        .find((el) => el.getAttribute('data-page') === 'forecasts');
      if (!item) return { ok: false, reason: 'not found' };
      item.click();
      return { ok: true };
    })()`);
    record(`${viewport.name}.forecastClick`, forecastClickResult);
    // Wait for navigation; mobile app header changes
    let forecastNavOk = false;
    for (let i = 0; i < 30; i++) {
      forecastNavOk = await cdp.eval(`!!document.querySelector('.panel-head h2') && document.querySelector('.panel-head h2').textContent.includes('需求预测')`);
      if (forecastNavOk) break;
      await sleep(200);
    }
    const forecastText = await cdp.getBodyText();
    record(`${viewport.name}.forecastText500`, forecastText.slice(0, 500));
    flag(`${viewport.name} 需求预测 panel rendered`, forecastNavOk);
    flag(`${viewport.name} 需求预测 shows subtitle`, forecastText.includes('作为 MRP 的需求来源之一'));

    // ---- MRP RUN ----
    await cdp.eval(`(() => {
      // Click back to launcher first
      const back = document.querySelector('.mobile-header__back');
      back?.click();
      return !!back;
    })()`);
    await sleep(600);
    const mrpClickResult = await cdp.eval(`(() => {
      const item = Array.from(document.querySelectorAll('[data-testid^="mobile-launcher-item-"]'))
        .find((el) => el.getAttribute('data-page') === 'mrp-runs');
      if (!item) return { ok: false, reason: 'not found' };
      item.click();
      return { ok: true };
    })()`);
    record(`${viewport.name}.mrpClick`, mrpClickResult);
    let mrpNavOk = false;
    for (let i = 0; i < 30; i++) {
      mrpNavOk = await cdp.eval(`!!document.querySelector('.panel-head h2') && document.querySelector('.panel-head h2').textContent.includes('MRP 运算')`);
      if (mrpNavOk) break;
      await sleep(200);
    }
    const mrpText = await cdp.getBodyText();
    record(`${viewport.name}.mrpRunText300`, mrpText.slice(0, 300));
    flag(`${viewport.name} MRP 运算 panel rendered`, mrpNavOk);
    flag(`${viewport.name} MRP 运算 shows calc subtitle`, mrpText.includes('综合销售订单、需求预测、现有库存、在途供应和 BOM'));

    // ---- MATERIAL PLAN (canonical) ----
    await cdp.eval(`(() => {
      const back = document.querySelector('.mobile-header__back');
      back?.click();
      return !!back;
    })()`);
    await sleep(600);
    const planClickResult = await cdp.eval(`(() => {
      const item = Array.from(document.querySelectorAll('[data-testid^="mobile-launcher-item-"]'))
        .find((el) => el.getAttribute('data-page') === 'material-requirements-plan');
      if (!item) return { ok: false, reason: 'not found' };
      item.click();
      return { ok: true };
    })()`);
    record(`${viewport.name}.planClick`, planClickResult);
    let planNavOk = false;
    for (let i = 0; i < 30; i++) {
      planNavOk = await cdp.eval(`document.querySelectorAll('.material-card').length > 0 || !!document.querySelector('.material-plan-empty')`);
      if (planNavOk) break;
      await sleep(200);
    }
    await sleep(400);

    const planText = await cdp.getBodyText();
    record(`${viewport.name}.planText800`, planText.slice(0, 800));
    flag(`${viewport.name} 物料需求计划 loaded`, planText.includes('物料需求计划'));

    // Capture per-product card values
    const cardData = await cdp.eval(`
      Array.from(document.querySelectorAll('.material-card')).map((card) => {
        const head = card.querySelector('.material-card__head');
        const summary = card.querySelector('.material-card__summary');
        const rows = Array.from(card.querySelectorAll('.material-card__rows > div')).map((row) => {
          const dt = row.querySelector('dt')?.textContent?.trim();
          const dd = row.querySelector('dd')?.textContent?.trim();
          return { dt, dd };
        });
        const action = card.querySelector('.material-card__action strong')?.textContent?.trim();
        const footer = Array.from(card.querySelectorAll('.material-card__footer a, .material-card__footer button'))
          .map((e) => e.textContent.trim());
        return {
          product: head?.querySelector('strong')?.textContent?.trim(),
          code: head?.querySelector('small')?.textContent?.trim(),
          chip: head?.querySelector('.material-card__chip')?.textContent?.trim(),
          summary: summary?.innerText?.replace(/\\s+/g, ' ')?.trim(),
          rows,
          action,
          footer,
          className: card.className,
        };
      })
    `);
    record(`${viewport.name}.cards`, cardData);
    const byCode = Object.fromEntries(cardData.map((c) => [c.code, c]));
    record(`${viewport.name}.fg`, byCode['X100-FG']);
    record(`${viewport.name}.pcb`, byCode['X100-PCB']);
    record(`${viewport.name}.caseRow`, byCode['X100-CASE']);
    record(`${viewport.name}.psu`, byCode['X100-PSU']);

    // ---- FILTER CHIPS ----
    const filters = [
      { key: 'all', label: '全部', expect: 4 },
      { key: 'shortage', label: '缺料', expect: 2 },
      { key: 'make', label: '生产建议', expect: 1 },
      { key: 'buy', label: '采购建议', expect: 1 },
    ];
    const filterCounts = {};
    for (const f of filters) {
      await cdp.clickByText('.filter-chip', f.label);
      await sleep(300);
      const count = await cdp.eval(`document.querySelectorAll('.material-card').length`);
      filterCounts[f.key] = count;
      flag(`${viewport.name} filter ${f.label} → ${count} cards (expected ${f.expect})`, count === f.expect);
    }
    record(`${viewport.name}.filterCounts`, filterCounts);

    // Reset to all
    await cdp.clickByText('.filter-chip', '全部');
    await sleep(300);

    // ---- SORT ----
    const sortOptions = await cdp.getTexts('.filter-sort select option');
    record(`${viewport.name}.sortOptions`, sortOptions);
    const hasDateSort = sortOptions.includes('按需求日期');
    const hasMaterialSort = sortOptions.includes('按物料');
    flag(`${viewport.name} sort has 按需求日期`, hasDateSort);
    flag(`${viewport.name} sort has 按物料`, hasMaterialSort);

    if (hasMaterialSort) {
      await cdp.eval(`(() => {
        const sel = document.querySelector('.filter-sort select');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, 'product');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(300);
      const sortedCodes = await cdp.eval(`
        Array.from(document.querySelectorAll('.material-card__head small'))
          .map((e) => e.textContent.trim())
      `);
      record(`${viewport.name}.sortedByMaterial`, sortedCodes);
      const expectedOrder = [...sortedCodes].sort();
      flag(`${viewport.name} sort by 物料 produces alphabetical order`, JSON.stringify(sortedCodes) === JSON.stringify(expectedOrder));
    }

    // ---- TRACE: FG ----
    await cdp.clickByText('.filter-chip', '全部');
    await sleep(300);
    await cdp.clickContaining('.material-card__footer button, .material-card__footer .link-button', '为什么是这个数量？');
    await sleep(500);
    // FG trace
    await cdp.eval(`(() => {
      const card = Array.from(document.querySelectorAll('.material-card'))
        .find((c) => c.querySelector('small')?.textContent?.trim() === 'X100-FG');
      card?.querySelector('button')?.click();
      return true;
    })()`);
    await sleep(400);
    const fgTrace = await cdp.eval(`
      Array.from(document.querySelectorAll('.modal .trace-list > div')).map((row) => ({
        dt: row.querySelector('dt')?.textContent?.trim(),
        dd: row.querySelector('dd')?.textContent?.trim(),
      }))
    `);
    record(`${viewport.name}.fgTrace`, fgTrace);
    const fgTraceHas = (label) => fgTrace.some((r) => r.dt && r.dt.includes(label));
    flag(`${viewport.name} FG trace explains 销售订单需求`, fgTraceHas('销售订单需求'));
    flag(`${viewport.name} FG trace explains 需求预测`, fgTraceHas('需求预测'));
    flag(`${viewport.name} FG trace explains 毛需求`, fgTraceHas('毛需求'));
    flag(`${viewport.name} FG trace explains 现有库存`, fgTraceHas('现有库存'));
    // 最终结果 is rendered as h3 heading; verify it appears in modal sections
    const h3Sections = await cdp.eval(`Array.from(document.querySelectorAll('.modal h3')).map((e) => e.textContent.trim())`);
    record(`${viewport.name}.fgTraceH3`, h3Sections);
    flag(`${viewport.name} FG trace has 最终结果 section`, h3Sections.includes('最终结果'));
    flag(`${viewport.name} FG trace shows 计算式`, fgTrace.some((r) => r.dd && r.dd.includes('120') && r.dd.includes('100')));

    // Close modal
    await cdp.eval(`document.querySelector('.modal .secondary, .modal button[class*="secondary"]')?.click()`);
    await sleep(300);

    // ---- TRACE: PCB ----
    await cdp.eval(`(() => {
      const card = Array.from(document.querySelectorAll('.material-card'))
        .find((c) => c.querySelector('small')?.textContent?.trim() === 'X100-PCB');
      card?.querySelector('button')?.click();
      return true;
    })()`);
    await sleep(400);
    const pcbTrace = await cdp.eval(`
      Array.from(document.querySelectorAll('.modal .trace-list > div')).map((row) => ({
        dt: row.querySelector('dt')?.textContent?.trim(),
        dd: row.querySelector('dd')?.textContent?.trim(),
      }))
    `);
    record(`${viewport.name}.pcbTrace`, pcbTrace);
    flag(`${viewport.name} PCB trace explains 来源 (BOM parent)`, pcbTrace.length > 0 && pcbTrace[0].dt.includes('来自') || pcbTrace.some((r) => r.dt && r.dt.includes('组件毛需求')));
    flag(`${viewport.name} PCB trace shows 70 net`, pcbTrace.some((r) => r.dd && r.dd.includes('70')));

    await cdp.eval(`document.querySelector('.modal .secondary, .modal button[class*="secondary"]')?.click()`);
    await sleep(300);

    // ---- CONVERSION ACTIONS ----
    const fgFooter = byCode['X100-FG']?.footer || [];
    const pcbFooter = byCode['X100-PCB']?.footer || [];
    record(`${viewport.name}.fgFooter`, fgFooter);
    record(`${viewport.name}.pcbFooter`, pcbFooter);
    flag(`${viewport.name} FG card offers 创建生产指令`, fgFooter.some((t) => t.includes('创建生产指令')));
    flag(`${viewport.name} PCB card offers 创建采购指令`, pcbFooter.some((t) => t.includes('创建采购指令')));

    // ---- RAW ENUM LEAK ----
    const leakGreps = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'MAKE', 'BUY', 'NONE', 'ROUTING_MISSING'];
    const bodyText = await cdp.getBodyText();
    const leaks = leakGreps.filter((g) => new RegExp(`\\b${g}\\b`).test(bodyText));
    record(`${viewport.name}.rawEnumLeaks`, leaks);
    flag(`${viewport.name} no raw enum leak on planning pages`, leaks.length === 0, `leaks=${JSON.stringify(leaks)}`);

    // ---- LAYOUT ----
    const overflow = await cdp.checkOverflow();
    record(`${viewport.name}.overflow`, overflow);
    flag(`${viewport.name} no horizontal overflow`, overflow.scrollWidth <= overflow.innerWidth, JSON.stringify(overflow));

    // Touch targets for primary buttons (>=44px)
    const touchTargets = await cdp.eval(`
      Array.from(document.querySelectorAll('.material-card__footer a, .material-card__footer button'))
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { text: el.textContent.trim(), h: Math.round(rect.height), w: Math.round(rect.width), minHeight: cs.minHeight, padding: cs.padding, display: cs.display, className: el.className };
        })
        .filter((t) => t.text)
    `);
    record(`${viewport.name}.touchTargets`, touchTargets);
    flag(`${viewport.name} touch targets >=44px`, touchTargets.every((t) => t.h >= 44), JSON.stringify(touchTargets));

    // ---- CONSOLE / NETWORK ----
    record(`${viewport.name}.consoleErrors`, cdp.consoleMessages.filter((m) => m.type === 'error'));
    record(`${viewport.name}.pageExceptions`, cdp.pageExceptions);
    record(`${viewport.name}.networkErrors`, cdp.responseReceived.filter((r) => r.status >= 400 && r.status !== 401));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { await stopEdge(edge); } catch {}
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

async function runEmptyStatesSweep(baseUrl) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-empty-'));
  const port = await getFreePort();
  const viewport = { name: '375x667-empty', width: 375, height: 667 };
  let edge;
  let cdp;
  try {
    edge = await startEdge(userDataDir, port, viewport);
    const tab = await createTab(port, `${baseUrl}/`);
    cdp = await connectToTab(tab);
    await cdp.waitForLoad();
    await cdp.setViewport(viewport.width, viewport.height);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    await cdp.navigate(`${baseUrl}/`);
    await sleep(400);
    await cdp.eval(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const setNativeValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setNativeValue(inputs[0], 'admin');
      setNativeValue(inputs[1], 'admin123');
      inputs[0].closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    await sleep(1200);

    // ---- 需求预测 EMPTY ----
    await cdp.eval(`(async () => {
      const item = Array.from(document.querySelectorAll('[data-testid^="mobile-launcher-item-"]'))
        .find((el) => el.getAttribute('data-page') === 'forecasts');
      item?.click();
    })()`);
    await sleep(800);
    const forecastEmpty = await cdp.getBodyText();
    flag('需求预测 empty state', forecastEmpty.includes('还没有需求预测') && forecastEmpty.includes('可将其纳入 MRP 运算'), forecastEmpty.slice(0, 200));

    await cdp.eval(`document.querySelector('.mobile-header__back')?.click()`);
    await sleep(500);

    // ---- MRP 运算 EMPTY ----
    await cdp.eval(`(async () => {
      const item = Array.from(document.querySelectorAll('[data-testid^="mobile-launcher-item-"]'))
        .find((el) => el.getAttribute('data-page') === 'mrp-runs');
      item?.click();
    })()`);
    await sleep(800);
    const mrpEmpty = await cdp.getBodyText();
    flag('MRP 运算 empty state', mrpEmpty.includes('还没有 MRP 运算') && mrpEmpty.includes('系统会计算生产与采购需求'));

    await cdp.eval(`document.querySelector('.mobile-header__back')?.click()`);
    await sleep(500);

    // ---- 物料需求计划 EMPTY ----
    await cdp.eval(`(async () => {
      const item = Array.from(document.querySelectorAll('[data-testid^="mobile-launcher-item-"]'))
        .find((el) => el.getAttribute('data-page') === 'material-requirements-plan');
      item?.click();
    })()`);
    await sleep(800);
    const planEmpty = await cdp.getBodyText();
    flag('物料需求计划 empty state', planEmpty.includes('还没有可查看的物料需求计划') && planEmpty.includes('请先完成一次 MRP 运算'));
    record('empty.diagnostics', {
      consoleErrors: cdp.consoleMessages.filter((item) => item.type === 'error'),
      pageExceptions: cdp.pageExceptions,
      unexpectedResponses: cdp.responseReceived.filter((item) => [400, 403, 404].includes(item.status) || item.status >= 500),
    });
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { await stopEdge(edge); } catch {}
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

async function runMobileNavigationSpotCheck(baseUrl) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-mobile-nav-'));
  const port = await getFreePort();
  const viewport = { name: '375x667-navigation', width: 375, height: 667 };
  let edge;
  let cdp;
  try {
    edge = await startEdge(userDataDir, port, viewport);
    const tab = await createTab(port, `${baseUrl}/`);
    cdp = await connectToTab(tab);
    await cdp.waitForLoad();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.setViewport(viewport.width, viewport.height);
    await cdp.navigate(`${baseUrl}/`);
    await cdp.eval(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inputs[0], 'admin');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], 'admin123');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    await sleep(1000);

    const openLauncherPage = async (page) => {
      const clicked = await cdp.eval(`(() => {
        const item = document.querySelector('[data-page="${page}"]');
        item?.click();
        return !!item;
      })()`);
      await sleep(700);
      return clicked;
    };
    const planningState = () => cdp.eval(`({
      hash: location.hash,
      titles: Array.from(document.querySelectorAll('.panel-head h2')).map((el) => el.textContent.trim()),
      activeTab: document.querySelector('.planning-tabs button.active')?.textContent?.trim() || '',
    })`);
    const returnToLauncher = async () => {
      await cdp.eval(`document.querySelector('.mobile-header__back')?.click()`);
      await sleep(500);
    };

    await openLauncherPage('production-instructions');
    const launcherProduction = await planningState();
    record('375.navigation.launcherProduction', launcherProduction);
    flag('375 launcher → 生产指令', launcherProduction.hash === '#production-instructions' && launcherProduction.activeTab === '生产指令');
    await returnToLauncher();

    await openLauncherPage('purchase-instructions');
    const launcherPurchase = await planningState();
    record('375.navigation.launcherPurchase', launcherPurchase);
    flag('375 launcher → 采购指令', launcherPurchase.hash === '#purchase-instructions' && launcherPurchase.activeTab === '采购指令');
    await returnToLauncher();

    await openLauncherPage('material-requirements-plan');
    await sleep(500);
    await cdp.eval(`(() => {
      const card = Array.from(document.querySelectorAll('.material-card')).find((el) => el.textContent.includes('X100-FG'));
      card?.querySelector('a[href="#production-instructions"]')?.click();
    })()`);
    await sleep(700);
    const makeState = await planningState();
    record('375.navigation.makeConversion', makeState);
    flag('375 material plan MAKE → 生产指令', makeState.hash === '#production-instructions' && makeState.activeTab === '生产指令');
    await returnToLauncher();

    await openLauncherPage('material-requirements-plan');
    await sleep(500);
    await cdp.eval(`(() => {
      const card = Array.from(document.querySelectorAll('.material-card')).find((el) => el.textContent.includes('X100-PCB'));
      card?.querySelector('a[href="#purchase-instructions"]')?.click();
    })()`);
    await sleep(700);
    const buyState = await planningState();
    record('375.navigation.buyConversion', buyState);
    flag('375 material plan BUY → 采购指令', buyState.hash === '#purchase-instructions' && buyState.activeTab === '采购指令');

    const overflow = await cdp.checkOverflow();
    record('375.navigation.overflow', overflow);
    flag('375 navigation spot-check has no horizontal overflow', overflow.scrollWidth <= overflow.innerWidth, JSON.stringify(overflow));
    const diagnostics = {
      pageExceptions: cdp.pageExceptions,
      consoleErrors: cdp.consoleMessages.filter((item) => item.type === 'error'),
      unexpectedResponses: cdp.responseReceived.filter((item) => [400, 403, 404].includes(item.status) || item.status >= 500),
    };
    record('375.navigation.diagnostics', diagnostics);
    flag('375 navigation spot-check runtime diagnostics clean', Object.values(diagnostics).every((entries) => entries.length === 0), JSON.stringify(diagnostics));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { await stopEdge(edge); } catch {}
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

async function runDesktopSweep(baseUrl) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-desktop-'));
  const port = await getFreePort();
  const viewport = { name: '1024x768-desktop', width: 1024, height: 768 };
  let edge;
  let cdp;
  try {
    edge = await startEdge(userDataDir, port, viewport);
    const tab = await createTab(port, `${baseUrl}/`);
    cdp = await connectToTab(tab);
    await cdp.waitForLoad();
    await cdp.setViewport(viewport.width, viewport.height);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    await cdp.navigate(`${baseUrl}/`);
    await sleep(400);
    await cdp.eval(`(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const setNativeValue = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setNativeValue(inputs[0], 'admin');
      setNativeValue(inputs[1], 'admin123');
      inputs[0].closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    await sleep(1200);

    // Desktop: check sidebar visible, mobile bottom navigation absent.
    const layout = await cdp.eval(`
      ({
        sidebarVisible: !!document.querySelector('.sidebar') && document.querySelector('.sidebar').getBoundingClientRect().width > 0,
        mobileBottomNavPresent: !!document.querySelector('[data-testid="mobile-bottom-nav"]'),
        width: innerWidth,
        height: innerHeight,
      })
    `);
    record('1024.desktopLayout', layout);
    flag('1024 viewport is exactly 1024×768', layout.width === 1024 && layout.height === 768, JSON.stringify(layout));
    flag('1024 sidebar visible', layout.sidebarVisible);
    flag('1024 mobile bottom navigation absent', !layout.mobileBottomNavPresent);

    // Exercise the planning concepts from the real desktop sidebar.
    for (const page of [
      { hash: 'forecasts', title: '需求预测' },
      { hash: 'mrp-runs', title: 'MRP 运算' },
    ]) {
      const clicked = await cdp.eval(`(() => {
        const link = document.querySelector('.sidebar a[href="#${page.hash}"]');
        link?.click();
        return !!link;
      })()`);
      await sleep(800);
      const pageState = await cdp.eval(`({ hash: location.hash, title: document.querySelector('.panel-head h2')?.textContent?.trim() || '' })`);
      record(`1024.${page.hash}`, pageState);
      flag(`1024 ${page.title} usable`, clicked && pageState.hash === `#${page.hash}` && pageState.title === page.title, JSON.stringify(pageState));
    }

    const readPlanningRoute = () => cdp.eval(`({
      hash: location.hash,
      titles: Array.from(document.querySelectorAll('.panel-head h2')).map((el) => el.textContent.trim()),
      activeTab: document.querySelector('.planning-tabs button.active')?.textContent?.trim() || '',
    })`);
    const verifyDirectRoute = async (page, label) => {
      await cdp.navigate(`${baseUrl}/#${page}`);
      await sleep(700);
      const state = await readPlanningRoute();
      record(`1024.direct.${page}`, state);
      flag(`1024 direct route ${page}`, state.hash === `#${page}` && state.titles.includes(label) && state.activeTab === label, JSON.stringify(state));
    };
    await verifyDirectRoute('purchase-instructions', '采购指令');
    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitForLoad();
    await sleep(700);
    const purchaseRefresh = await readPlanningRoute();
    record('1024.refresh.purchase-instructions', purchaseRefresh);
    flag('1024 refresh preserves purchase route', purchaseRefresh.hash === '#purchase-instructions' && purchaseRefresh.activeTab === '采购指令', JSON.stringify(purchaseRefresh));

    await cdp.eval(`Array.from(document.querySelectorAll('.planning-tabs button')).find((el) => el.textContent.trim() === '生产指令')?.click()`);
    await sleep(500);
    const purchaseToProduction = await readPlanningRoute();
    record('1024.purchaseToProduction', purchaseToProduction);
    flag('1024 采购指令 → 生产指令', purchaseToProduction.hash === '#production-instructions' && purchaseToProduction.activeTab === '生产指令', JSON.stringify(purchaseToProduction));
    await cdp.eval(`Array.from(document.querySelectorAll('.planning-tabs button')).find((el) => el.textContent.trim() === '采购指令')?.click()`);
    await sleep(500);
    const productionToPurchase = await readPlanningRoute();
    record('1024.productionToPurchase', productionToPurchase);
    flag('1024 生产指令 → 采购指令', productionToPurchase.hash === '#purchase-instructions' && productionToPurchase.activeTab === '采购指令', JSON.stringify(productionToPurchase));

    await cdp.eval(`document.querySelector('.sidebar a[href="#business-overview"]')?.click()`);
    await sleep(400);
    await cdp.eval(`document.querySelector('.sidebar a[href="#purchase-instructions"]')?.click()`);
    await sleep(500);
    const returnToPurchase = await readPlanningRoute();
    record('1024.returnToPurchase', returnToPurchase);
    flag('1024 leave and return to purchase route', returnToPurchase.hash === '#purchase-instructions' && returnToPurchase.activeTab === '采购指令', JSON.stringify(returnToPurchase));

    await verifyDirectRoute('production-instructions', '生产指令');

    const planClicked = await cdp.eval(`(() => {
      const link = document.querySelector('.sidebar a[href="#material-requirements-plan"]');
      link?.click();
      return !!link;
    })()`);
    await sleep(1000);
    const planText = await cdp.getBodyText();
    record('1024.planText500', planText.slice(0, 500));
    flag('1024 物料需求计划 loaded', planClicked && planText.includes('物料需求计划'));

    // Desktop table should have all expected columns
    const headers = await cdp.getTexts('.material-plan-desktop thead th');
    record('1024.tableHeaders', headers);
    for (const col of ['物料', '销售需求', '预测需求', '组件需求', '毛需求', '现有库存', '在途采购', '在途生产', '净需求', '建议', '建议数量', '需求日期']) {
      flag(`1024 table has column "${col}"`, headers.includes(col));
    }

    const tableUsability = await cdp.eval(`(() => {
      const wrap = document.querySelector('.material-plan-desktop .table-wrap');
      const table = wrap?.querySelector('table');
      if (!wrap || !table) return null;
      wrap.scrollLeft = wrap.scrollWidth;
      const last = table.querySelector('thead th:last-child')?.getBoundingClientRect();
      const box = wrap.getBoundingClientRect();
      return {
        rowCount: table.querySelectorAll('tbody tr').length,
        clientWidth: wrap.clientWidth,
        scrollWidth: wrap.scrollWidth,
        canReachLastColumn: !!last && last.right <= box.right + 1 && last.left >= box.left - 1,
      };
    })()`);
    record('1024.tableUsability', tableUsability);
    flag('1024 desktop material plan table usable without inaccessible clipping', tableUsability?.rowCount === 4 && tableUsability?.canReachLastColumn, JSON.stringify(tableUsability));

    // Trace a real result from the desktop table.
    const traceClicked = await cdp.eval(`(() => {
      const row = Array.from(document.querySelectorAll('.material-plan-desktop tbody tr'))
        .find((el) => el.textContent.includes('X100-FG'));
      row?.querySelector('button')?.click();
      return !!row;
    })()`);
    await sleep(400);
    const traceState = await cdp.eval(`({ open: !!document.querySelector('.modal'), text: document.querySelector('.modal')?.innerText || '' })`);
    record('1024.trace', { open: traceState.open, text: traceState.text.slice(0, 300) });
    flag('1024 trace usable', traceClicked && traceState.open && traceState.text.includes('计算依据') && traceState.text.includes('最终结果'));
    await cdp.eval(`document.querySelector('.modal .secondary, .modal button[class*="secondary"]')?.click()`);
    await sleep(300);

    // Actually follow the canonical SPA conversion links; no documents are created.
    const followConversion = async (code, expectedHash, expectedTitle) => {
      const clicked = await cdp.eval(`(() => {
        const row = Array.from(document.querySelectorAll('.material-plan-desktop tbody tr'))
          .find((el) => el.textContent.includes(${JSON.stringify(code)}));
        const link = row?.querySelector('a[href="#${expectedHash}"]');
        link?.click();
        return !!link;
      })()`);
      await sleep(800);
      const state = await cdp.eval(`({
        hash: location.hash,
        titles: Array.from(document.querySelectorAll('.panel-head h2')).map((el) => el.textContent.trim()),
        activeTab: document.querySelector('.planning-tabs button.active')?.textContent?.trim() || '',
      })`);
      record(`1024.conversion.${code}`, state);
      flag(`${code} conversion navigates to ${expectedTitle}`,
        clicked && state.hash === `#${expectedHash}` && state.titles.includes(expectedTitle) && state.activeTab === expectedTitle,
        JSON.stringify(state));
    };
    await followConversion('X100-FG', 'production-instructions', '生产指令');
    await cdp.eval(`document.querySelector('.sidebar a[href="#material-requirements-plan"]')?.click()`);
    await sleep(800);
    await followConversion('X100-PCB', 'purchase-instructions', '采购指令');

    // Verify the rendered Business Overview distinguishes the planning chain.
    await cdp.eval(`document.querySelector('.sidebar a[href="#business-overview"]')?.click()`);
    await sleep(500);
    const overview = await cdp.eval(`(() => {
      const flow = document.querySelector('.business-flow--planning');
      return {
        labels: Array.from(flow?.querySelectorAll('.business-flow__node strong') || []).map((el) => el.textContent.trim()),
        description: flow?.querySelector('header p')?.textContent?.trim() || '',
      };
    })()`);
    record('1024.businessOverview', overview);
    const distinctCore = ['需求预测', 'MRP 运算', '物料需求计划', '生产指令', '采购指令']
      .every((label) => overview.labels.includes(label));
    const distinctSuggestions = overview.description.includes('生产与采购建议');
    flag('Business Overview shows distinct planning chain and both suggestion branches', distinctCore && distinctSuggestions, JSON.stringify(overview));

    const diagnostics = {
      referenceError: cdp.pageExceptions.filter((item) => item.text.includes('ReferenceError')),
      typeError: cdp.pageExceptions.filter((item) => item.text.includes('TypeError')),
      unhandledPromiseRejection: cdp.consoleMessages.filter((item) => /Unhandled Promise Rejection/i.test(item.text)),
      unexpected400: cdp.responseReceived.filter((item) => item.status === 400),
      unexpected403: cdp.responseReceived.filter((item) => item.status === 403),
      unexpected404: cdp.responseReceived.filter((item) => item.status === 404),
      unexpected500: cdp.responseReceived.filter((item) => item.status >= 500),
    };
    record('1024.diagnostics', diagnostics);
    for (const [name, entries] of Object.entries(diagnostics)) flag(`1024 ${name} = 0`, entries.length === 0, JSON.stringify(entries));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { await stopEdge(edge); } catch {}
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

async function main() {
  const remainingOnly = process.argv.includes('--remaining');
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-real-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`server: ${baseUrl}  db=${dbPath}  edge=${EDGE_VERSION}`);

  let pass = true;
  const expect = (label, actual, expected) => {
    const ok = Number(actual) === Number(expected);
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: actual=${actual} expected=${expected}`);
    if (!ok) { pass = false; failures.push(label); }
    return ok;
  };

  try {
    const adminToken = await loginAsAdmin(baseUrl);
    console.log('\n==== Seed golden X100 fixture ====');
    seedGoldenFixture(db);

    // ---- Forecast + MRP ----
    const today = todayIso();
    const horizonEnd = plusDays(today, 60);
    const fc = await api(baseUrl, '/api/planning/forecasts', {
      method: 'POST', token: adminToken,
      body: { forecastName: 'X100 演示预测', periodStart: today, periodEnd: horizonEnd, notes: 'p1 ux',
        items: [{ productId: 'product-X100-FG', needDate: today, quantity: 20 }] },
    });
    expect('Forecast create 201', fc.status, 201);
    const act = await api(baseUrl, `/api/planning/forecasts/${fc.data.id}/activate`, { method: 'POST', token: adminToken });
    expect('Forecast activate 200', act.status, 200);

    const run = await api(baseUrl, '/api/planning/mrp/runs', {
      method: 'POST', token: adminToken,
      body: { runName: 'X100 MRP', horizonStart: today, horizonEnd, demandSourceMode: 'SALES_PLUS_FORECAST', forecastId: fc.data.id },
    });
    expect('MRP run create 201', run.status, 201);
    const exec = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}/execute`, { method: 'POST', token: adminToken });
    expect('MRP run execute 200', exec.status, 200);

    // Verify arithmetic via API (canonical)
    const detail = await api(baseUrl, `/api/planning/mrp/runs/${run.data.id}`, { token: adminToken });
    const byCode = Object.fromEntries(detail.data.run.results.map((r) => [r.product_code, r]));
    expect('FG gross_requirement = 120', byCode['X100-FG'].gross_requirement, 120);
    expect('FG on_hand = 20', byCode['X100-FG'].on_hand, 20);
    expect('FG net_requirement = 100', byCode['X100-FG'].net_requirement, 100);
    expect('FG MAKE = 100', byCode['X100-FG'].suggested_quantity, 100);
    expect('PCB gross_component_demand = 100', byCode['X100-PCB'].gross_component_demand, 100);
    expect('PCB on_hand = 30', byCode['X100-PCB'].on_hand, 30);
    expect('PCB net_requirement = 70', byCode['X100-PCB'].net_requirement, 70);
    expect('PCB BUY = 70', byCode['X100-PCB'].suggested_quantity, 70);
    expect('CASE net = 0', byCode['X100-CASE'].net_requirement, 0);
    expect('PSU net = 0', byCode['X100-PSU'].net_requirement, 0);

    if (!remainingOnly) {
      console.log('\n==== Edge headless UI sweep @ 375 / 414 (mobile shell) ====');
      for (const vp of VIEWPORTS.filter((v) => v.width < 768)) {
        console.log(`\n-- viewport ${vp.name} --`);
        await runUiSweep(baseUrl, vp, run.data.id);
      }
    } else {
      console.log('\n==== 375 / 414 mobile sweeps skipped (already accepted) ====');
    }

    console.log('\n==== Edge headless desktop sweep @ 1024 (sidebar + table) ====');
    await runDesktopSweep(baseUrl);

    console.log('\n==== Edge headless mobile navigation spot-check @ 375 ====');
    await runMobileNavigationSpotCheck(baseUrl);

    console.log('\n==== Empty states (isolated empty DB) ====');
    const emptyDbDir = mkdtempSync(join(tmpdir(), 'modern-erp-p1-empty-db-'));
    const emptyDbPath = join(emptyDbDir, 'erp.db');
    const emptyDb = createDatabase(emptyDbPath);
    const emptyServer = createServer(createApp(emptyDb, { distDir: resolve('dist') }));
    await new Promise((r) => emptyServer.listen(0, '127.0.0.1', r));
    const emptyBaseUrl = `http://127.0.0.1:${emptyServer.address().port}`;
    try {
      await runEmptyStatesSweep(emptyBaseUrl);
    } finally {
      await new Promise((r) => emptyServer.close(() => r()));
      try { emptyDb.close(); } catch {}
      await sleep(100);
      try { rmSync(emptyDbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    }

    pass = pass && failures.length === 0;
    console.log('\n' + (pass ? 'P1 REAL PRODUCT UX ACCEPTANCE = PASS' : 'P1 REAL PRODUCT UX ACCEPTANCE = FAIL'));
    if (!pass) {
      console.log(`Failures: ${JSON.stringify(failures)}`);
      process.exitCode = 1;
    }
    console.log('\n==== Results JSON ====');
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
