// Debug helper: minimal isolated flow to find the 404 root cause.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../server/app.js';
import { createDatabase, id } from '../server/db.js';

async function api(baseUrl, path, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { status: res.status, data };
}

async function main() {
  const tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-debug-'));
  const dbPath = join(tempDir, 'erp.db');
  const db = createDatabase(dbPath);
  const server = createServer(createApp(db, { distDir: resolve('dist') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`debug server: ${baseUrl}`);

  try {
    const adminLogin = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
    console.log('admin login status', adminLogin.status);

    // Setup minimal master data.
    db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('c-debug','C-debug','B1','','','',1,datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES('s-debug','S-debug','S1','','','',1,datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES('w-debug','W-debug','W1','','',1,datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES('p-debug','P-debug','P1','','',1000,0,1,datetime('now'),datetime('now'))`).run();
    db.prepare(`INSERT INTO inventory(id,product_id,warehouse_id,quantity,updated_at) VALUES(?,?,?,100,datetime('now'))`).run('inv-debug', 'p-debug', 'w-debug');
    const adminToken = adminLogin.data.token;

    // 1. Create SO.
    const so = await api(baseUrl, '/api/orders', {
      method: 'POST', token: adminToken,
      body: { customerId: 'c-debug', remark: '', items: [{ productId: 'p-debug', quantity: 10, unitPriceCents: 1000 }] },
    });
    console.log('SO create', so.status, so.data);

    // 2. Submit + Approve.
    await api(baseUrl, `/api/orders/${so.data.id}/submit`, { method: 'POST', token: adminToken });
    const reviewerLogin = await api(baseUrl, '/api/auth/login', { method: 'POST', body: { username: 'reviewer', password: 'review123' } });
    const reviewerToken = reviewerLogin.data.token;
    await api(baseUrl, `/api/orders/${so.data.id}/approve`, { method: 'POST', token: reviewerToken });

    // 3. Create sales delivery.
    const sd = await api(baseUrl, '/api/sales-deliveries', {
      method: 'POST', token: adminToken,
      body: { salesOrderId: so.data.id, customerId: 'c-debug', warehouseId: 'w-debug', deliveryDate: '2026-09-21', remark: '', items: [{ productId: 'p-debug', quantity: 10, unitPriceCents: 1000 }] },
    });
    console.log('SD create', sd.status, sd.data);

    // 4. Confirm delivery.
    const sdConf = await api(baseUrl, `/api/sales-deliveries/${sd.data.id}`, { method: 'POST', token: adminToken, body: { action: 'confirm' } });
    console.log('SD confirm', sdConf.status, sdConf.data);

    // 5. Create return.
    const sr = await api(baseUrl, '/api/sales-returns', {
      method: 'POST', token: adminToken,
      body: { deliveryId: sd.data.id, customerId: 'c-debug', warehouseId: 'w-debug', returnDate: '2026-09-21', remark: '', items: [{ productId: 'p-debug', quantity: 2, unitPriceCents: 1000 }] },
    });
    console.log('SR create', sr.status, sr.data);

    // 6. Confirm return.
    const srConf = await api(baseUrl, `/api/sales-returns/${sr.data.id}`, { method: 'POST', token: adminToken, body: { action: 'confirm' } });
    console.log('SR confirm', srConf.status, srConf.data);
  } finally {
    await new Promise((r) => server.close(() => r()));
    try { db.close(); } catch {}
    await sleep(100);
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => { console.error(err); process.exit(1); });