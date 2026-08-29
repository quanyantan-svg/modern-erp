import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db.js';

let db;
let server;
let baseUrl;

before(async () => {
  db = createDatabase(':memory:');
  server = createServer(createApp(db));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data };
}

async function login(username, password) {
  const result = await request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200);
  return result.data.token;
}

test('健康检查无需登录', async () => {
  const result = await request('/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'ok');
});

test('销售制单、提交和主管审核形成完整闭环', async () => {
  const salesToken = await login('sales', 'sales123');
  const created = await request('/api/orders', {
    method: 'POST', token: salesToken,
    body: {
      customerId: 'customer-002',
      remark: '自动化测试订单',
      items: [
        { productId: 'product-001', quantity: 2, unitPriceCents: 250000 },
        { productId: 'product-003', quantity: 1, unitPriceCents: 128000 }
      ]
    }
  });
  assert.equal(created.status, 201);

  const submitted = await request(`/api/orders/${created.data.id}/submit`, { method: 'POST', token: salesToken });
  assert.equal(submitted.status, 200);

  const selfApproval = await request(`/api/orders/${created.data.id}/approve`, { method: 'POST', token: salesToken });
  assert.equal(selfApproval.status, 403);

  const reviewerToken = await login('reviewer', 'review123');
  const approved = await request(`/api/orders/${created.data.id}/approve`, { method: 'POST', token: reviewerToken });
  assert.equal(approved.status, 200);

  const detail = await request(`/api/orders/${created.data.id}`, { token: reviewerToken });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.order.status, 'APPROVED');
  assert.equal(detail.data.order.totalCents, 628000);
  assert.equal(detail.data.order.items.length, 2);
  assert.deepEqual(detail.data.order.history.map((item) => item.action), ['CREATE', 'SUBMIT', 'APPROVE']);
});

test('普通销售用户不能管理系统用户', async () => {
  const salesToken = await login('sales', 'sales123');
  const result = await request('/api/users', { token: salesToken });
  assert.equal(result.status, 403);
});
