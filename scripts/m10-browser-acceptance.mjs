import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [port = '9225', baseUrl = 'http://127.0.0.1:43110', outputDir = '.tmp/m10-browser/screenshots'] = process.argv.slice(2);
mkdirSync(outputDir, { recursive: true });

async function waitFor(getter, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await getter();
      if (value) return value;
    } catch { /* retry while the browser/app settles */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const targets = await waitFor(async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) return null;
  return response.json();
}, 'Edge DevTools target');
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('No Edge page target available');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const exceptions = [];
const httpErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) {
    httpErrors.push({ status: message.params.response.status, url: message.params.response.url });
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
  return result.result.value;
}

async function navigate(url) {
  await send('Page.navigate', { url });
  await waitFor(() => evaluate(`document.readyState === 'complete'`), `navigation ${url}`);
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
}

async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(outputDir, name), Buffer.from(result.data, 'base64'));
}

async function assertBrowser(expression, message) {
  if (!await evaluate(expression)) throw new Error(message);
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Network.enable'), send('Log.enable')]);
await setViewport(375, 667);
await navigate(baseUrl);
await evaluate(`(async () => {
  const response = await fetch('/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:'admin',password:'admin123'}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  localStorage.setItem('modern_erp_token', data.token);
  location.reload();
})()`);
await waitFor(() => evaluate(`Boolean(document.querySelector('[aria-label="打开制品工序标准"]'))`), 'admin mobile routing card');

const fixture = await evaluate(`(async () => {
  const token = localStorage.getItem('modern_erp_token');
  const call = async (path, options={}) => {
    const response = await fetch(path, { ...options, headers:{authorization:'Bearer '+token,'content-type':'application/json',...(options.headers||{})} });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(path+': '+(data.error||response.status));
    return data;
  };
  let product = (await call('/api/products?search=DEMO-FG')).products.find((item) => item.code === 'DEMO-FG');
  if (!product) {
    const created = await call('/api/products', {method:'POST',body:JSON.stringify({code:'DEMO-FG',name:'演示成品',unit:'件',priceCents:10000,stockQuantity:0,active:true})});
    product = {id:created.id,code:'DEMO-FG',name:'演示成品'};
  }
  let routing = (await call('/api/product-routings?search=ROUTE-DEMO-V1')).routings.find((item) => item.routing_code === 'ROUTE-DEMO-V1');
  if (!routing) {
    const created = await call('/api/product-routings', {method:'POST',body:JSON.stringify({
      productId:product.id,routingCode:'ROUTE-DEMO-V1',routingName:'演示成品标准工序',version:'V1',status:'ACTIVE',notes:'M10 isolated browser acceptance',
      operations:[
        {sequenceNo:10,operationCode:'CUT',operationName:'下料',workCenter:'下料工位',setupMinutes:5,runMinutesPerUnit:2},
        {sequenceNo:20,operationCode:'ASSEMBLE',operationName:'装配',workCenter:'装配工位',setupMinutes:8,runMinutesPerUnit:4},
        {sequenceNo:30,operationCode:'INSPECT',operationName:'检验',workCenter:'检验工位',setupMinutes:3,runMinutesPerUnit:1},
        {sequenceNo:40,operationCode:'PACK',operationName:'包装',workCenter:'包装工位',setupMinutes:0,runMinutesPerUnit:0.5}
      ]
    })});
    routing = {id:created.id};
  }
  if (routing.status === 'INACTIVE') await call('/api/product-routings/'+routing.id+'/activate', {method:'POST',body:'{}'});
  return {productId:product.id,routingId:routing.id};
})()`);

await evaluate(`document.querySelector('[aria-label="打开制品工序标准"]').click()`);
await waitFor(() => evaluate(`document.body.innerText.includes('演示成品标准工序')`), 'mobile routing list');
await assertBrowser(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`, '375px page has horizontal overflow');
await evaluate(`[...document.querySelectorAll('.routing-summary-card')].find((item) => item.innerText.includes('ROUTE-DEMO-V1')).click()`);
await waitFor(() => evaluate(`document.querySelector('.routing-operation-flow')?.innerText.includes('包装')`), 'routing detail flow');
await assertBrowser(`(() => { const t=document.querySelector('.routing-operation-flow').innerText; return t.indexOf('下料') < t.indexOf('装配') && t.indexOf('装配') < t.indexOf('检验') && t.indexOf('检验') < t.indexOf('包装'); })()`, 'operation order is not deterministic');
await evaluate(`[...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='编辑').click()`);
await waitFor(() => evaluate(`document.querySelectorAll('.routing-operation-editor').length === 4`), 'mobile routing editor');
await assertBrowser(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`, '375px editor has horizontal overflow');

// Reorder 10 -> 5 through the real React form, save, verify, then restore 10.
await evaluate(`(() => { const input=[...document.querySelectorAll('.routing-operation-editor label')].find((label) => label.textContent.startsWith('顺序号')).querySelector('input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'5'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.modal form').requestSubmit(); })()`);
await waitFor(() => evaluate(`!document.querySelector('.modal') && document.body.innerText.includes('演示成品标准工序')`), 'editor save');
await evaluate(`[...document.querySelectorAll('.routing-summary-card')].find((item) => item.innerText.includes('ROUTE-DEMO-V1')).click()`);
await waitFor(() => evaluate(`document.querySelector('.routing-operation-card__sequence')?.textContent.trim()==='5'`), 'saved reorder');
await evaluate(`[...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='编辑').click()`);
await waitFor(() => evaluate(`document.querySelectorAll('.routing-operation-editor').length === 4`), 'reopen editor');
await evaluate(`(() => { const input=[...document.querySelectorAll('.routing-operation-editor label')].find((label) => label.textContent.startsWith('顺序号')).querySelector('input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'10'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.modal form').requestSubmit(); })()`);
await waitFor(() => evaluate(`!document.querySelector('.modal')`), 'restore route order');
await evaluate(`[...document.querySelectorAll('.routing-summary-card')].find((item) => item.innerText.includes('ROUTE-DEMO-V1')).click()`);
await waitFor(() => evaluate(`document.querySelector('.routing-operation-card__sequence')?.textContent.trim()==='10'`), 'restored order');
await evaluate(`[...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='停用').click()`);
await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='启用'))`), 'routing deactivation');
await evaluate(`[...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='启用').click()`);
await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='停用'))`), 'routing activation');
await screenshot('375x667-routing-detail.png');

await setViewport(414, 896);
await assertBrowser(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`, '414px detail has horizontal overflow');
await screenshot('414x896-routing-detail.png');
await evaluate(`[...document.querySelectorAll('.modal button')].find((button) => button.textContent.trim()==='关闭').click()`);

await setViewport(1024, 768);
await navigate(baseUrl + '/#product-routings');
await waitFor(() => evaluate(`Boolean(document.querySelector('.routing-list-desktop table')) && document.body.innerText.includes('演示成品标准工序')`), 'desktop routing list');
await assertBrowser(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`, '1024px page has horizontal overflow');
await evaluate(`[...document.querySelectorAll('.routing-list-desktop tbody tr')].find((row) => row.innerText.includes('ROUTE-DEMO-V1')).click()`);
await waitFor(() => evaluate(`document.querySelector('.routing-operation-flow')?.innerText.includes('包装')`), 'desktop detail');
await screenshot('1024x768-routing-detail.png');

const unauthorized = await evaluate(`(async () => {
  const login = await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'sales',password:'sales123'})});
  const auth = await login.json();
  const response = await fetch('/api/product-routings',{method:'POST',headers:{authorization:'Bearer '+auth.token,'content-type':'application/json'},body:'{}'});
  return response.status;
})()`);
if (unauthorized !== 403) throw new Error(`sales mutation expected 403, got ${unauthorized}`);

const unexpectedHttp = httpErrors.filter((item) => !(item.status === 403 && item.url.endsWith('/api/product-routings')));
if (consoleErrors.length || exceptions.length || unexpectedHttp.length) {
  throw new Error(JSON.stringify({ consoleErrors, exceptions, unexpectedHttp }, null, 2));
}

socket.close();
console.log(JSON.stringify({
  browser: target.browser || 'Microsoft Edge',
  fixture,
  viewports: ['375x667', '414x896', '1024x768'],
  consoleErrors: 0,
  unexpectedHttpErrors: 0,
  unauthorizedMutation: 403,
  screenshots: ['375x667-routing-detail.png', '414x896-routing-detail.png', '1024x768-routing-detail.png'],
}, null, 2));
