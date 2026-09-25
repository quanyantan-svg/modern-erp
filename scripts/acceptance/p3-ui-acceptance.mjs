// V1.2 product UI acceptance — real Microsoft Edge, isolated database,
// seven required widths and all five canonical roles.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';
import { createDatabase, hashPassword } from '../../server/db.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VIEWPORTS = [
  { name: '375x812', width: 375, height: 812 },
  { name: '414x896', width: 414, height: 896 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];
const ROLES = [
  { label: 'admin', username: 'test_admin', roleId: 'role-admin', must: ['customers', 'material-requirements-plan', 'inventory', 'accounting', 'users', 'data-cleanup'], deny: [] },
  { label: 'sales', username: 'test_sales', roleId: 'role-sales', must: ['customers', 'orders', 'purchase-orders', 'inventory'], deny: ['accounting', 'production-orders', 'users', 'data-cleanup', 'sales-discounts', 'purchase-discounts'] },
  { label: 'reviewer', username: 'test_reviewer', roleId: 'role-reviewer', must: ['orders', 'purchase-orders', 'inventory'], deny: ['accounting', 'production-orders', 'users', 'data-cleanup', 'sales-discounts', 'purchase-discounts'] },
  { label: 'warehouse', username: 'test_warehouse', roleId: 'role-warehouse', must: ['inventory', 'inventory-scraps', 'iqc', 'oqc'], deny: ['orders', 'accounting', 'inventory-month-end', 'data-cleanup', 'sales-discounts', 'purchase-discounts'] },
  { label: 'accounting', username: 'test_accounting', roleId: 'role-accounting', must: ['accounting', 'accounts-receivable', 'accounts-payable', 'decision-reports', 'sales-discounts', 'purchase-discounts'], deny: ['inventory', 'production-orders', 'users', 'data-cleanup'] },
];
const PASSWORD = 'P3-Isolated-Only-2026!';
const outputDir = resolve(repoRoot, '.tmp/p3-ui-acceptance');
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
async function loginWithForm(cdp) {
  await cdp.eval(`(() => {
    const inputs=[...document.querySelectorAll('input')];
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(inputs[0],'admin'); inputs[0].dispatchEvent(new Event('input',{bubbles:true}));
    setter.call(inputs[1],'admin123'); inputs[1].dispatchEvent(new Event('input',{bubbles:true}));
    inputs[0].closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  })()`);
  return cdp.waitFor(`!!document.querySelector('[data-testid="mobile-launcher"]')`);
}
async function verifyInteractiveSurfaces(cdp, viewport) {
  const openedPlan = await openMobile(cdp, 'material-requirements-plan');
  flag(`${viewport.name} material plan opens`, openedPlan && await cdp.waitFor(`document.querySelector('.mobile-header__title')?.innerText==='物料需求计划' && document.querySelectorAll('.segmented-control button').length===4`));
  const plan = await cdp.eval(`(() => {
    const title=document.querySelector('.panel-head h2');
    const cards=[...document.querySelectorAll('.material-card')];
    const filters=[...document.querySelectorAll('.segmented-control button')].map((button)=>button.innerText.trim());
    const nav=document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect();
    const shell=document.querySelector('.mobile-shell');
    return {overflow:document.documentElement.scrollWidth-innerWidth,titleWidth:title?.getBoundingClientRect().width||0,titleHeight:title?.getBoundingClientRect().height||0,cards:cards.length,filters,zero:Boolean(document.querySelector('.canonical-empty-state,.empty')),reservedBottom:parseFloat(getComputedStyle(shell).paddingBottom),navHeight:nav?.height||0};
  })()`);
  record(`materialPlan.${viewport.name}`, plan);
  flag(`${viewport.name} material plan no overflow`, plan.overflow <= 0, JSON.stringify(plan));
  flag(`${viewport.name} material plan title does not collapse`, plan.titleWidth > 120 && plan.titleHeight < 80, JSON.stringify(plan));
  flag(`${viewport.name} material plan filters`, JSON.stringify(plan.filters) === JSON.stringify(['全部','生产','采购','缺料']), JSON.stringify(plan.filters));
  flag(`${viewport.name} material plan result state`, plan.cards > 0 || plan.zero);
  flag(`${viewport.name} bottom navigation does not overlap content`, plan.reservedBottom >= plan.navHeight, JSON.stringify(plan));
  for (const filter of [
    { label: '生产', expectCard: true },
    { label: '采购', expectCard: false },
    { label: '缺料', expectCard: true },
  ]) {
    await cdp.eval(`([...document.querySelectorAll('.segmented-control button')].find((button)=>button.innerText.trim()===${JSON.stringify(filter.label)}))?.click()`);
    await cdp.waitFor(`[...document.querySelectorAll('.segmented-control button')].some((button)=>button.innerText.trim()===${JSON.stringify(filter.label)} && button.getAttribute('aria-pressed')==='true')`);
    const filterState = await cdp.eval(`({cards:document.querySelectorAll('.material-card').length,empty:document.querySelector('.empty,.canonical-empty-state')?.innerText||''})`);
    flag(`${viewport.name} ${filter.label} filter usable`, filter.expectCard ? filterState.cards > 0 : filterState.cards === 0 && filterState.empty.includes('没有匹配的物料'), JSON.stringify(filterState));
  }
  await cdp.eval(`([...document.querySelectorAll('.segmented-control button')].find((button)=>button.innerText.trim()==='全部'))?.click()`); await sleep(50);
  if (plan.cards > 0) {
    await cdp.eval(`[...document.querySelectorAll('.material-card__trace')][0]?.click()`);
    flag(`${viewport.name} calculation basis opens`, await cdp.waitFor(`!!document.querySelector('.sheet') && document.querySelector('.sheet').innerText.includes('计算依据')`));
    flag(`${viewport.name} calculation sheet has bottom action`, await cdp.eval(`!!document.querySelector('.sheet .bottom-action-bar')`));
    await cdp.eval(`document.querySelector('.sheet > header button')?.click()`); await sleep(100);
  }

  flag(`${viewport.name} data cleanup opens`, await openMobile(cdp, 'data-cleanup'));
  await cdp.waitFor(`document.body.innerText.includes('数据整理')`);
  const filterButton = await cdp.eval(`(() => { const b=document.querySelector('.filter-button'); b?.click(); return Boolean(b); })()`);
  flag(`${viewport.name} filter sheet opens`, filterButton && await cdp.waitFor(`!!document.querySelector('.filter-sheet')`));
  flag(`${viewport.name} filter sheet actions visible`, await cdp.eval(`document.querySelectorAll('.filter-sheet .bottom-action-bar button').length===2`));
  await cdp.eval(`document.querySelector('.sheet > header button')?.click()`); await sleep(100);

  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  const focus = await cdp.eval(`(() => { const e=document.activeElement; const s=getComputedStyle(e); return {tag:e?.tagName,outline:s.outlineStyle,ring:s.boxShadow}; })()`);
  flag(`${viewport.name} keyboard focus reaches a control`, ['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(focus.tag), JSON.stringify(focus));
}
async function runViewport(baseUrl, viewport, profileRoot) {
  const port = await freePort(); const profile = join(profileRoot, viewport.name); let edge; let cdp;
  try {
    edge = await startEdge(profile, port, viewport); cdp = await connect(port, baseUrl); await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]); await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 768 });
    flag(`${viewport.name} login form renders`, await cdp.waitFor(`document.querySelectorAll('input').length >= 2`));
    flag(`${viewport.name} login completes`, await loginWithForm(cdp));
    await cdp.eval(`localStorage.removeItem('modern_erp_token')`);
    await cdp.send('Page.navigate', { url: `${baseUrl}/?accept=logout-${viewport.width}` });
    await cdp.waitFor(`document.querySelectorAll('input').length >= 2`);
    for (const role of ROLES) {
      const token = await loginToken(baseUrl, role.username); cdp.exceptions.length = 0; cdp.consoleErrors.length = 0; cdp.responses.length = 0;
      await cdp.eval(`localStorage.setItem('modern_erp_token',${JSON.stringify(token)})`);
      await cdp.send('Page.navigate', { url: `${baseUrl}/?accept=${role.label}-${viewport.width}-${Date.now()}` });
      const ready = `!!document.querySelector('[data-testid="mobile-bottom-nav"]') && !!document.querySelector('[data-testid="mobile-launcher"]')`;
      flag(`${role.label} ${viewport.name} shell`, await cdp.waitFor(ready));
      const state = await cdp.eval(`(() => {
        const items=[...document.querySelectorAll('[data-page]')].map(e=>e.dataset.page);
        const tabs=[...document.querySelectorAll('.mobile-bottom-nav__label')].map(e=>e.textContent.trim());
        const widths=[...document.querySelectorAll('.mobile-bottom-nav__item')].map(e=>Math.round(e.getBoundingClientRect().width));
        const shell=document.querySelector('.mobile-shell').getBoundingClientRect();
        const nav=document.querySelector('.mobile-bottom-nav').getBoundingClientRect();
        const visibleControls=[...document.querySelectorAll('button:not([disabled]),a[href],input,select,textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;});
        return {items,tabs,widths,clientWidth:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-innerWidth,minTarget:visibleControls.length?Math.min(...visibleControls.map(e=>Math.round(e.getBoundingClientRect().height))):0,shell:{left:Math.round(shell.left),right:Math.round(shell.right),width:Math.round(shell.width),paddingBottom:parseFloat(getComputedStyle(document.querySelector('.mobile-shell')).paddingBottom)},nav:{left:Math.round(nav.left),right:Math.round(nav.right),width:Math.round(nav.width),height:Math.round(nav.height)},legacyChrome:Boolean(document.querySelector('.sidebar,.app-shell,.topbar')),bottomNav:Boolean(document.querySelector('.mobile-bottom-nav'))};
      })()`);
      record(`${role.label}.${viewport.name}`, state);
      flag(`${role.label} ${viewport.name} canonical tabs`, JSON.stringify(state.tabs) === JSON.stringify(['消息','签核','应用','云翼','我的']), JSON.stringify(state.tabs));
      flag(`${role.label} ${viewport.name} equal tabs`, Math.max(...state.widths)-Math.min(...state.widths) <= 1, JSON.stringify(state.widths));
      flag(`${role.label} ${viewport.name} touch targets`, state.minTarget >= 44, `min=${state.minTarget}`);
      flag(`${role.label} ${viewport.name} one canonical shell`, state.bottomNav && !state.legacyChrome);
      flag(`${role.label} ${viewport.name} centered workspace`, state.shell.width <= 600 && Math.abs(state.shell.left-(state.clientWidth-state.shell.width)/2) <= 1, JSON.stringify(state.shell));
      flag(`${role.label} ${viewport.name} bottom nav follows workspace`, state.nav.left === state.shell.left && state.nav.right === state.shell.right, JSON.stringify(state.nav));
      flag(`${role.label} ${viewport.name} bottom nav reserves content space`, state.shell.paddingBottom >= state.nav.height, JSON.stringify({padding:state.shell.paddingBottom,height:state.nav.height}));
      flag(`${role.label} ${viewport.name} no page overflow`, state.overflow <= 0, `delta=${state.overflow}`);
      for (const page of role.must) flag(`${role.label} sees ${page} @ ${viewport.name}`, state.items.includes(page));
      for (const page of role.deny) flag(`${role.label} hides ${page} @ ${viewport.name}`, !state.items.includes(page));
      if (role.username === 'test_admin') {
        await cdp.shot(`${viewport.name}-launcher.png`);
        await verifyInteractiveSurfaces(cdp, viewport);
        await cdp.eval(`document.querySelector('[data-testid="bottom-tab-approvals"]')?.click()`); await sleep(250);
        flag(`${viewport.name} approvals uses canonical shell`, await cdp.eval(`!!document.querySelector('[data-testid="mobile-approval-center"]')`));
        await cdp.eval(`document.querySelector('[data-testid="bottom-tab-apps"]')?.click()`); await sleep(150);
      }
      flag(`${role.label} ${viewport.name} ReferenceError=0`, !cdp.exceptions.some((item) => item.includes('ReferenceError')));
      flag(`${role.label} ${viewport.name} TypeError=0`, !cdp.exceptions.some((item) => item.includes('TypeError')));
      flag(`${role.label} ${viewport.name} console errors=0`, cdp.consoleErrors.length === 0, JSON.stringify(cdp.consoleErrors));
      const expectedSecurity = cdp.responses.filter((item) => item.status === 403 && item.url.includes('/api/approvals'));
      const unexpected = cdp.responses.filter((item) => [400,403,404,500].includes(item.status) && !expectedSecurity.includes(item));
      record(`${role.label}.${viewport.name}.expectedSecurity`, expectedSecurity);
      flag(`${role.label} ${viewport.name} unexpected HTTP=0`, unexpected.length === 0, JSON.stringify(unexpected));
    }
  } finally { try { cdp?.ws.close(); } catch {} try { edge?.kill(); } catch {} await sleep(300); }
}

const isolated = join(tmpdir(), `modern-erp-p3-${process.pid}`); mkdirSync(isolated, { recursive: true });
const db = createDatabase(join(isolated, 'erp.db')); const now = new Date().toISOString();
const insert = db.prepare('INSERT OR REPLACE INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)');
for (const role of ROLES) { const password = hashPassword(PASSWORD); insert.run(`p3-${role.username}`, role.username, role.username, password.hash, password.salt, role.roleId, now); }
db.prepare(`INSERT INTO mrp_runs(id,run_code,run_name,horizon_start,horizon_end,demand_source_mode,status,summary,created_by,created_at,updated_at,completed_at) VALUES(?,?,?,?,?,?,'COMPLETED',?,?,?,?,?)`).run(
  'v12-browser-mrp', 'MRP-V12-BROWSER', 'V1.2 浏览器验收', '2026-09-01', '2026-09-30', 'SALES_ORDERS', JSON.stringify({ totalProducts: 1, makeSuggestions: 1, buySuggestions: 0, shortageProducts: 1 }), 'user-admin', now, now, now,
);
db.prepare(`INSERT INTO mrp_run_demands(id,run_id,product_id,need_date,source_type,source_id,source_label,quantity) VALUES(?,?,?,?,?,?,?,?)`).run(
  'v12-browser-demand', 'v12-browser-mrp', 'product-001', '2026-09-30', 'SALES_ORDER', 'v12-browser-source', '浏览器验收需求', 10,
);
db.prepare(`INSERT INTO mrp_run_results(id,run_id,product_id,gross_sales_demand,gross_requirement,on_hand,net_requirement,suggestion_type,suggested_quantity,need_by_date,bom_level,warning) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  'v12-browser-result', 'v12-browser-mrp', 'product-001', 10, 10, 0, 10, 'MAKE', 10, '2026-09-30', 0, '',
);
const server = createServer(createApp(db, { distDir: resolve(repoRoot, 'dist') }));
try { await new Promise((done) => server.listen(0, '127.0.0.1', done)); const baseUrl = `http://127.0.0.1:${server.address().port}`; for (const viewport of VIEWPORTS) await runViewport(baseUrl, viewport, isolated); }
finally { await new Promise((done) => server.close(done)); db.close(); rmSync(isolated, { recursive: true, force: true }); }
console.log(JSON.stringify({ browser: 'Microsoft Edge', viewports: VIEWPORTS.map((item) => item.width), roles: ROLES.map((item) => item.label), failures, screenshots, outputDir, observations }, null, 2));
if (failures.length) process.exitCode = 1;
