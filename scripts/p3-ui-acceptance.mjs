// P3 product UI acceptance — real Microsoft Edge, isolated database, five roles.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../server/app.js';
import { createDatabase, hashPassword } from '../server/db.js';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VIEWPORTS = [{ name: '375x667', width: 375, height: 667 }, { name: '414x896', width: 414, height: 896 }, { name: '1024x768', width: 1024, height: 768 }];
const ROLES = [
  { username: 'test_admin', roleId: 'role-admin', must: ['customers', 'material-requirements-plan', 'inventory', 'accounting', 'users'], deny: [] },
  { username: 'test_sales', roleId: 'role-sales', must: ['customers', 'orders', 'purchase-orders', 'inventory'], deny: ['accounting', 'production-orders', 'users'] },
  { username: 'test_reviewer', roleId: 'role-reviewer', must: ['orders', 'purchase-orders', 'inventory'], deny: ['accounting', 'production-orders', 'users'] },
  { username: 'test_warehouse', roleId: 'role-warehouse', must: ['inventory', 'inventory-scraps', 'iqc', 'oqc'], deny: ['orders', 'accounting', 'inventory-month-end'] },
  { username: 'test_accounting', roleId: 'role-accounting', must: ['accounting', 'accounts-receivable', 'accounts-payable', 'decision-reports'], deny: ['inventory', 'production-orders', 'users'] },
];
const PASSWORD = 'P3-Isolated-Only-2026!';
const outputDir = resolve('.tmp/p3-ui-acceptance');
mkdirSync(outputDir, { recursive: true });
const failures = []; const observations = {}; const screenshots = [];
function flag(label, ok, detail = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures.push(label); }
function record(key, value) { observations[key] = value; console.log(`[record] ${key}=${JSON.stringify(value)}`); }

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 1; this.pending = new Map(); this.exceptions = []; this.consoleErrors = []; this.responses = [];
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { const pending = this.pending.get(data.id); this.pending.delete(data.id); data.error ? pending.reject(new Error(data.error.message)) : pending.resolve(data.result); return; }
      if (data.method === 'Runtime.exceptionThrown') this.exceptions.push(JSON.stringify(data.params.exceptionDetails));
      if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') this.consoleErrors.push(data.params.args.map((arg) => arg.value || arg.description || '').join(' '));
      if (data.method === 'Network.responseReceived') this.responses.push({ status: data.params.response.status, url: data.params.response.url });
    });
  }
  send(method, params = {}) { const id = this.id++; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolvePromise, reject) => this.pending.set(id, { resolve: resolvePromise, reject })); }
  async eval(expression) { const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  async waitFor(expression, timeout = 10000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await this.eval(expression)) return true; await sleep(100); } return false; }
  async shot(name) { const data = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(join(outputDir, name), Buffer.from(data.data, 'base64')); screenshots.push(name); }
}

async function freePort() { const probe = createServer(); await new Promise((done) => probe.listen(0, '127.0.0.1', done)); const port = probe.address().port; await new Promise((done) => probe.close(done)); return port; }
async function startEdge(profile, port, viewport) {
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--window-size=${viewport.width},${viewport.height}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) return edge; } catch {} await sleep(200); }
  edge.kill(); throw new Error('Edge debugger did not start');
}
async function connect(port, url) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', reject, { once: true }); }); return new Cdp(ws);
}
async function loginToken(baseUrl, username) { const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }) }); const body = await response.json(); if (!response.ok) throw new Error(`${username} login ${response.status}: ${body.error}`); return body.token; }
async function openMobile(cdp, page) { await cdp.eval(`document.querySelector('.mobile-header__back')?.click()`); await sleep(150); return cdp.eval(`(() => { const item=document.querySelector('[data-page="${page}"]'); item?.click(); return Boolean(item); })()`); }
async function runViewport(baseUrl, viewport, profileRoot) {
  const port = await freePort(); const profile = join(profileRoot, viewport.name); let edge; let cdp;
  try {
    edge = await startEdge(profile, port, viewport); cdp = await connect(port, baseUrl); await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]); await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 768 });
    for (const role of ROLES) {
      const token = await loginToken(baseUrl, role.username); cdp.exceptions.length = 0; cdp.consoleErrors.length = 0; cdp.responses.length = 0;
      await cdp.eval(`localStorage.setItem('modern_erp_token',${JSON.stringify(token)});location.href=${JSON.stringify(baseUrl)};`);
      const ready = viewport.width < 768 ? `!!document.querySelector('[data-testid="mobile-bottom-nav"]')` : `!!document.querySelector('.sidebar')`;
      flag(`${role.username} ${viewport.name} shell`, await cdp.waitFor(ready));
      const state = await cdp.eval(`(() => {
        const mobile=${viewport.width < 768}; const items=mobile?[...document.querySelectorAll('[data-page]')].map(e=>e.dataset.page):[...document.querySelectorAll('.sidebar a')].map(e=>(e.getAttribute('href')||'').slice(1));
        const tabs=[...document.querySelectorAll('.mobile-bottom-nav__label')].map(e=>e.textContent.trim());
        const widths=[...document.querySelectorAll('.mobile-bottom-nav__item')].map(e=>Math.round(e.getBoundingClientRect().width));
        const visibleControls=[...document.querySelectorAll('button:not([disabled]),a[href],input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;});
        return {items,tabs,widths,overflow:document.documentElement.scrollWidth-innerWidth,minTarget:visibleControls.length?Math.min(...visibleControls.map(e=>Math.round(e.getBoundingClientRect().height))):0,bottomPadding:mobile?parseFloat(getComputedStyle(document.querySelector('.mobile-main')).paddingBottom):0,sidebar:Boolean(document.querySelector('.sidebar')),bottomNav:Boolean(document.querySelector('.mobile-bottom-nav'))};
      })()`);
      record(`${role.username}.${viewport.name}`, state);
      if (viewport.width < 768) { flag(`${role.username} ${viewport.name} canonical tabs`, JSON.stringify(state.tabs) === JSON.stringify(['消息','签核','应用','云翼','我的']), JSON.stringify(state.tabs)); flag(`${role.username} ${viewport.name} equal tabs`, new Set(state.widths).size === 1, JSON.stringify(state.widths)); flag(`${role.username} ${viewport.name} touch targets`, state.minTarget >= 44, `min=${state.minTarget}`); }
      else { flag(`${role.username} ${viewport.name} desktop shell`, state.sidebar && !state.bottomNav); }
      flag(`${role.username} ${viewport.name} no page overflow`, state.overflow <= 0, `delta=${state.overflow}`);
      for (const page of role.must) flag(`${role.username} sees ${page} @ ${viewport.name}`, state.items.includes(page));
      for (const page of role.deny) flag(`${role.username} hides ${page} @ ${viewport.name}`, !state.items.includes(page));
      if (role.username === 'test_admin') {
        if (viewport.width < 768) {
          await cdp.shot(`${viewport.name}-launcher.png`);
          const pages = viewport.width === 375
            ? ['business-overview', 'customers', 'orders', 'purchase-orders', 'forecasts', 'mrp-runs', 'material-requirements-plan', 'inventory', 'inventory-scraps', 'inventory-month-end', 'accounting', 'decision-reports']
            : ['orders', 'purchase-orders', 'forecasts', 'mrp-runs', 'material-requirements-plan', 'inventory', 'accounting', 'decision-reports'];
          for (const page of pages) { if (await openMobile(cdp, page)) { await cdp.waitFor(`!!document.querySelector('.mobile-application-view')`); await sleep(250); const overflow = await cdp.eval(`document.documentElement.scrollWidth<=innerWidth`); flag(`${viewport.name} ${page} no overflow`, overflow); await cdp.shot(`${viewport.name}-${page}.png`); await cdp.eval(`document.querySelector('.mobile-header__back')?.click()`); await sleep(150); } }
          await cdp.eval(`document.querySelector('[data-testid="bottom-tab-approvals"]')?.click()`); await sleep(300); await cdp.shot(`${viewport.name}-approvals.png`); await cdp.eval(`document.querySelector('[data-testid="bottom-tab-apps"]')?.click()`); await sleep(150);
          if (viewport.width === 375) {
            for (const tab of ['cloud', 'profile']) { await cdp.eval(`document.querySelector('[data-testid="bottom-tab-${tab}"]')?.click()`); await sleep(200); flag(`${viewport.name} ${tab} no overflow`, await cdp.eval(`document.documentElement.scrollWidth<=innerWidth`)); await cdp.shot(`${viewport.name}-${tab}.png`); }
            await cdp.eval(`document.querySelector('[data-testid="bottom-tab-apps"]')?.click()`); await sleep(150);
          }
        } else {
          for (const [page, name] of [['business-overview','business-overview'], ['customers','customers'], ['orders','sales-orders'], ['purchase-orders','purchase-orders'], ['forecasts','forecasts'], ['mrp-runs','mrp-runs'], ['material-requirements-plan','material-plan'], ['approvals','approvals'], ['inventory','inventory'], ['inventory-scraps','inventory-scraps'], ['inventory-month-end','inventory-month-end'], ['accounting','finance'], ['decision-reports','decision-reports'], ['fixed-assets','fixed-assets']]) { await cdp.eval(`location.hash='#${page}'`); await sleep(350); flag(`${viewport.name} ${page} no overflow`, await cdp.eval(`document.documentElement.scrollWidth<=innerWidth`)); await cdp.shot(`${viewport.name}-${name}.png`); }
        }
      }
      flag(`${role.username} ${viewport.name} ReferenceError=0`, !cdp.exceptions.some((item) => item.includes('ReferenceError')));
      flag(`${role.username} ${viewport.name} TypeError=0`, !cdp.exceptions.some((item) => item.includes('TypeError')));
      flag(`${role.username} ${viewport.name} unhandled rejection=0`, !cdp.consoleErrors.some((item) => /unhandled|promise rejection/i.test(item)));
      const expectedSecurity = cdp.responses.filter((item) => item.status === 403 && item.url.includes('/api/approvals'));
      const unexpected = cdp.responses.filter((item) => [400,403,404,500].includes(item.status) && !expectedSecurity.includes(item));
      record(`${role.username}.${viewport.name}.expectedSecurity`, expectedSecurity);
      flag(`${role.username} ${viewport.name} unexpected HTTP=0`, unexpected.length === 0, JSON.stringify(unexpected));
    }
  } finally { try { cdp?.ws.close(); } catch {} try { edge?.kill(); } catch {} await sleep(300); }
}

const isolated = join(tmpdir(), `modern-erp-p3-${process.pid}`); mkdirSync(isolated, { recursive: true });
const db = createDatabase(join(isolated, 'erp.db')); const now = new Date().toISOString();
const insert = db.prepare('INSERT OR REPLACE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)');
for (const role of ROLES) { const password = hashPassword(PASSWORD); insert.run(`p3-${role.username}`, role.username, role.username, password.hash, password.salt, role.roleId, now); }
const server = createServer(createApp(db, { distDir: resolve('dist') }));
try { await new Promise((done) => server.listen(0, '127.0.0.1', done)); const baseUrl = `http://127.0.0.1:${server.address().port}`; for (const viewport of VIEWPORTS) await runViewport(baseUrl, viewport, isolated); }
finally { await new Promise((done) => server.close(done)); db.close(); rmSync(isolated, { recursive: true, force: true }); }
console.log(JSON.stringify({ browser: 'Microsoft Edge', viewports: VIEWPORTS.map((item) => item.name), roles: ROLES.map((item) => item.username), failures, screenshots, outputDir, observations }, null, 2));
if (failures.length) process.exitCode = 1;
