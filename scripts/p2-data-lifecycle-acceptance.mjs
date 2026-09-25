// P2 real product UX acceptance — Microsoft Edge via CDP and an isolated DB.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const VIEWPORTS = [{ name: '375x667', width: 375, height: 667 }, { name: '414x896', width: 414, height: 896 }, { name: '1024x768', width: 1024, height: 768 }];
const failures = []; const results = {};
function flag(label, ok, detail = '') { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures.push(label); }
function record(key, value) { results[key] = value; console.log(`[record] ${key}=${JSON.stringify(value)}`); }

class Cdp {
  constructor(ws) {
    this.ws = ws; this.next = 1; this.pending = new Map(); this.exceptions = []; this.responses = []; this.consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) { const p = this.pending.get(data.id); this.pending.delete(data.id); data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result); return; }
      if (data.method === 'Runtime.exceptionThrown') this.exceptions.push(data.params.exceptionDetails);
      if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') this.consoleErrors.push(data.params.args.map((a) => a.value || a.description || '').join(' '));
      if (data.method === 'Network.responseReceived') this.responses.push({ url: data.params.response.url, status: data.params.response.status });
    });
  }
  send(method, params = {}) { const id = this.next++; return new Promise((resolvePromise, reject) => { this.pending.set(id, { resolve: resolvePromise, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
  async waitFor(expression, timeout = 8000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await this.eval(expression)) return true; await sleep(100); } return false; }
}

async function freePort() { const probe = createServer(); await new Promise((done) => probe.listen(0, '127.0.0.1', done)); const port = probe.address().port; await new Promise((done) => probe.close(done)); return port; }
async function startEdge(dir, port, viewport) {
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, `--window-size=${viewport.width},${viewport.height}`, 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return proc; } catch {} await sleep(250); }
  proc.kill(); throw new Error('Edge debugger did not start');
}
async function connect(port, url) {
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((done, reject) => { ws.addEventListener('open', done, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  return new Cdp(ws);
}
function seed(db, suffix) {
  const stamp = '2026-09-20T08:00:00.000Z';
  db.prepare('INSERT INTO customers(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(`p2-free-${suffix}`, `CUST-DELETE-${suffix}`, `测试删除客户-${suffix}`, stamp, stamp);
  db.prepare('INSERT INTO customers(id,code,name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(`p2-used-${suffix}`, `CUST-HISTORY-${suffix}`, `历史客户-${suffix}`, stamp, stamp);
  db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at) VALUES(?,?,?,'DRAFT',0,'user-admin',?,?)").run(`p2-draft-${suffix}`, `SO-DELETE-${suffix}`, 'customer-001', stamp, stamp);
  db.prepare("INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,creator_id,created_at,updated_at) VALUES(?,?,?,'APPROVED',0,'user-admin',?,?)").run(`p2-history-${suffix}`, `SO-HISTORY-${suffix}`, `p2-used-${suffix}`, stamp, stamp);
}

async function login(cdp) {
  await cdp.waitFor(`document.querySelectorAll('input').length >= 2`);
  await cdp.eval(`(() => { const i=[...document.querySelectorAll('input')]; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(i[0],'admin'); i[0].dispatchEvent(new Event('input',{bubbles:true})); s.call(i[1],'admin123'); i[1].dispatchEvent(new Event('input',{bubbles:true})); i[0].closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
  return cdp.waitFor(`!!document.querySelector('[data-testid^="mobile-launcher-item-"], .sidebar nav a')`);
}
async function openPage(cdp, page) {
  await cdp.eval(`(() => { const back=document.querySelector('.mobile-header__back'); if(back) back.click(); return true; })()`); await sleep(300);
  return cdp.eval(`(() => {
    const mobile=[...document.querySelectorAll('[data-testid^="mobile-launcher-item-"]')].find(e=>e.dataset.page===${JSON.stringify(page)});
    const desktop=[...document.querySelectorAll('.sidebar nav a')].find(e=>(e.getAttribute('href')||'')==='#${page}');
    const item=mobile||desktop; if(!item)return false; item.click(); return true;
  })()`);
}
async function openRowMenu(cdp, code) {
  return cdp.eval(`(() => { const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes(${JSON.stringify(code)})); const menu=row?.querySelector('.action-menu'); if(!menu)return false; menu.open=true; return true; })()`);
}
async function clickInRow(cdp, code, text) {
  return cdp.eval(`(() => { const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes(${JSON.stringify(code)})); const b=[...(row?.querySelectorAll('button')||[])].find(x=>x.innerText.trim()===${JSON.stringify(text)}); if(!b)return false; b.click(); return true; })()`);
}
async function runViewport(baseUrl, db, viewport, index) {
  const suffix = `${viewport.width}-${index}`; seed(db, suffix);
  const dir = mkdtempSync(join(tmpdir(), 'modern-erp-p2-edge-')); const port = await freePort(); let edge; let cdp;
  try {
    edge = await startEdge(dir, port, viewport); cdp = await connect(port, baseUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 768 });
    flag(`${viewport.name} login`, await login(cdp));
    flag(`${viewport.name} open customer management`, await openPage(cdp, 'customers')); flag(`${viewport.name} customer list loaded`, await cdp.waitFor(`document.body.innerText.includes('CUST-DELETE-${suffix}')`));

    await openRowMenu(cdp, `CUST-DELETE-${suffix}`); flag(`${viewport.name} opens delete confirmation`, await clickInRow(cdp, `CUST-DELETE-${suffix}`, '删除'));
    flag(`${viewport.name} confirmation identifies record and irreversibility`, await cdp.waitFor(`document.querySelector('.modal')?.innerText.includes('CUST-DELETE-${suffix}') && document.querySelector('.modal')?.innerText.includes('无法恢复')`));
    await sleep(250); // Measure after the 200 ms modal entrance animation settles.
    const confirmLayout = await cdp.eval(`(() => { const m=document.querySelector('.modal'); const buttons=[...m.querySelectorAll('.form-actions button')].map(b=>({text:b.innerText,h:Math.round(b.getBoundingClientRect().height)})); const r=m.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,buttons}; })()`);
    record(`${viewport.name}.confirmLayout`, confirmLayout);
    flag(`${viewport.name} confirmation not clipped`, confirmLayout.left >= 0 && confirmLayout.right <= viewport.width && confirmLayout.top >= 0 && confirmLayout.bottom <= viewport.height, JSON.stringify(confirmLayout));
    flag(`${viewport.name} confirmation buttons >=44px`, confirmLayout.buttons.every((b) => b.h >= 44), JSON.stringify(confirmLayout.buttons));
    await cdp.eval(`[...document.querySelectorAll('.modal button')].find(b=>b.innerText==='删除').click()`);
    flag(`${viewport.name} unreferenced customer disappears`, await cdp.waitFor(`!document.body.innerText.includes('CUST-DELETE-${suffix}')`));

    await openRowMenu(cdp, `CUST-HISTORY-${suffix}`); await clickInRow(cdp, `CUST-HISTORY-${suffix}`, '删除'); await cdp.waitFor(`!!document.querySelector('.modal')`);
    await cdp.eval(`[...document.querySelectorAll('.modal button')].find(b=>b.innerText==='删除').click()`);
    flag(`${viewport.name} referenced delete shows product-safe block`, await cdp.waitFor(`document.body.innerText.includes('已有业务引用') && document.body.innerText.includes('停用')`));
    await cdp.eval(`[...document.querySelectorAll('.modal button')].find(b=>b.innerText==='取消').click()`); await sleep(200);
    await openRowMenu(cdp, `CUST-HISTORY-${suffix}`); await clickInRow(cdp, `CUST-HISTORY-${suffix}`, '停用');
    flag(`${viewport.name} customer disables`, await cdp.waitFor(`([...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes('CUST-HISTORY-${suffix}'))?.innerText||'').includes('停用')`));
    await openRowMenu(cdp, `CUST-HISTORY-${suffix}`); await clickInRow(cdp, `CUST-HISTORY-${suffix}`, '启用');
    flag(`${viewport.name} customer re-enables`, await cdp.waitFor(`([...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes('CUST-HISTORY-${suffix}'))?.innerText||'').includes('启用')`));

    await openPage(cdp, 'orders'); flag(`${viewport.name} orders loaded`, await cdp.waitFor(`document.body.innerText.includes('SO-DELETE-${suffix}')`));
    const rowDelete = await cdp.eval(`(() => { const row=[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes('SO-DELETE-${suffix}')); const b=[...row.querySelectorAll('button')].find(x=>x.innerText==='删除'); b?.click(); return !!b; })()`);
    flag(`${viewport.name} draft order delete offered`, rowDelete); await cdp.waitFor(`!!document.querySelector('.modal')`);
    await cdp.eval(`[...document.querySelectorAll('.modal button')].find(b=>b.innerText==='删除').click()`);
    flag(`${viewport.name} draft order deleted`, await cdp.waitFor(`!document.body.innerText.includes('SO-DELETE-${suffix}')`));
    const nonDraft = await cdp.eval(`fetch('/api/orders/p2-history-${suffix}',{method:'DELETE',headers:{Authorization:'Bearer '+localStorage.getItem('modern_erp_token')}}).then(async r=>({status:r.status,body:await r.json()}))`);
    record(`${viewport.name}.nonDraft`, nonDraft); flag(`${viewport.name} non-DRAFT delete blocked`, nonDraft.status === 409 && nonDraft.body?.details?.code === 'DOCUMENT_NOT_DRAFT');

    const overflow = await cdp.eval(`({scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth})`); record(`${viewport.name}.overflow`, overflow); flag(`${viewport.name} no page overflow`, overflow.scrollWidth <= overflow.innerWidth, JSON.stringify(overflow));
    flag(`${viewport.name} no ReferenceError`, !cdp.exceptions.some((e) => JSON.stringify(e).includes('ReferenceError')));
    flag(`${viewport.name} no TypeError`, !cdp.exceptions.some((e) => JSON.stringify(e).includes('TypeError')));
    flag(`${viewport.name} no unhandled promise rejection`, !cdp.consoleErrors.some((e) => /unhandled|promise/i.test(e)));
    const unexpected = cdp.responses.filter((r) => [400, 403, 404, 500].includes(r.status)); record(`${viewport.name}.unexpectedResponses`, unexpected); flag(`${viewport.name} no unexpected 400/403/404/500`, unexpected.length === 0, JSON.stringify(unexpected));
  } finally {
    try { cdp?.ws.close(); } catch {} try { edge?.kill(); } catch {} await sleep(300); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

const dir = mkdtempSync(join(tmpdir(), 'modern-erp-p2-acceptance-')); const db = createDatabase(join(dir, 'erp.db')); const server = createServer(createApp(db, { distDir: resolve('dist') }));
try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done)); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (let i = 0; i < VIEWPORTS.length; i++) await runViewport(baseUrl, db, VIEWPORTS[i], i + 1);
} finally {
  await new Promise((done) => server.close(done)); db.close(); rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({ edge: true, viewports: VIEWPORTS.map((v) => v.name), failures, results }, null, 2));
if (failures.length) process.exitCode = 1;
