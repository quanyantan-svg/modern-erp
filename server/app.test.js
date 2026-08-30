import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

let baseUrl;
let database;
let server;
let tempDir;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-auth-test-'));
  database = createDatabase(join(tempDir, 'erp.db'));
  server = createServer(createApp(database, { distDir: resolve('dist') }));
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, data: await response.json() };
}

describe('Authentication Module', () => {
  
  test('健康检查可访问', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    const data = await health.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'modern-erp-api');
  });

  describe('Login', () => {
    test('正确账号密码登录成功', async () => {
      const result = await login('sales', 'sales123');
      assert.equal(result.status, 200, result.data.error);
      assert.ok(result.data.token, '应返回token');
      assert.ok(result.data.user, '应返回用户信息');
      assert.equal(result.data.user.username, 'sales');
      assert.equal(result.data.user.displayName, '销售专员');
      assert.ok(result.data.user.permissions, '应包含权限');
      assert.ok(result.data.expiresAt, '应包含过期时间');
      assert.ok(result.data.sessionHours, '应包含会话时长');
    });

    test('admin账号登录成功', async () => {
      const result = await login('admin', 'admin123');
      assert.equal(result.status, 200);
      assert.equal(result.data.user.username, 'admin');
      assert.ok(result.data.user.permissions.length > 10);
    });

    test('错误密码登录失败返回401', async () => {
      const result = await login('sales', 'wrongpassword');
      assert.equal(result.status, 401);
      assert.equal(result.data.code, 'INVALID_CREDENTIALS');
    });

    test('错误账号登录失败返回401', async () => {
      const result = await login('nonexistent', 'anypassword');
      assert.equal(result.status, 401);
      assert.equal(result.data.code, 'INVALID_CREDENTIALS');
    });

    test('空用户名登录失败返回400', async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: '', password: 'test' }),
      });
      assert.equal(response.status, 400);
    });

    test('空密码登录失败返回400', async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'sales', password: '' }),
      });
      assert.equal(response.status, 400);
    });

    test('登录返回的用户信息包含角色', async () => {
      const result = await login('sales', 'sales123');
      assert.equal(result.status, 200);
      assert.ok(result.data.user.roleId);
      assert.ok(result.data.user.roleName);
      assert.ok(result.data.user.roleCode);
    });

    test('登录返回会话过期时间', async () => {
      const result = await login('sales', 'sales123');
      assert.equal(result.status, 200);
      assert.ok(result.data.expiresAt);
    });

    test('登录成功后可使用Token访问其他API', async () => {
      const loginResult = await login('admin', 'admin123');
      assert.equal(loginResult.status, 200);
      const response = await fetch(`${baseUrl}/api/roles`, {
        headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
      });
      assert.equal(response.status, 200);
    });
  });

  describe('Login Rate Limiting', () => {
    test('连续5次错误密码后账户被锁定', async () => {
      // LOGIN_MAX_ATTEMPTS = 5: 4次失败后第5次触发锁定
      const lockUsername = 'ratelimit_' + Date.now();
      for (let i = 0; i < 4; i++) {
        const result = await login(lockUsername, `wrongpassword${i}`);
        assert.equal(result.status, 401, `第${i+1}次失败应返回401`);
      }
      // 第5次触发锁定
      const lockedResult = await login(lockUsername, 'wrongpassword5');
      assert.equal(lockedResult.status, 429, '5次失败后应返回429');
      assert.equal(lockedResult.data.code, 'ACCOUNT_LOCKED');
    });

    test('锁定后返回正确的重试时间', async () => {
      const lockUsername = 'locktest_' + Date.now();
      for (let i = 0; i < 4; i++) {
        await login(lockUsername, `wrongpassword${i}`);
      }
      const result = await login(lockUsername, 'wrongpassword5');
      assert.equal(result.status, 429);
      assert.ok(result.data.retryAfter);
    });
  });

  describe('Session Token', () => {
    test('Token格式正确', async () => {
      const result = await login('sales', 'sales123');
      assert.equal(result.status, 200);
      assert.ok(result.data.token);
      assert.ok(/^[A-Za-z0-9_-]+$/.test(result.data.token));
    });

    test('不同用户获得不同的Token', async () => {
      const result1 = await login('sales', 'sales123');
      const result2 = await login('admin', 'admin123');
      assert.notEqual(result1.data.token, result2.data.token);
    });

    test('Token可重复使用', async () => {
      const loginResult = await login('sales', 'sales123');
      for (let i = 0; i < 3; i++) {
        const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
        });
        assert.equal(meResponse.status, 200);
      }
    });

    test('无效Token返回401', async () => {
      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Authorization': 'Bearer invalid-token' },
      });
      assert.equal(meResponse.status, 401);
    });
  });

  describe('Password Management', () => {
    test('修改用户密码需要admin权限', async () => {
      const salesLogin = await login('sales', 'sales123');
      const updateResponse = await fetch(`${baseUrl}/api/users/${salesLogin.data.user.id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${salesLogin.data.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ password: 'newpassword123' }),
      });
      assert.equal(updateResponse.status, 403);
    });

    test('创建用户时密码长度验证', async () => {
      const loginResult = await login('admin', 'admin123');
      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${loginResult.data.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          username: 'testuser_short',
          displayName: '测试用户',
          roleId: 'role-sales',
          password: '123',
        }),
      });
      assert.equal(response.status, 400);
    });
  });

  describe('Logout', () => {
    test('带Token登出成功返回204', async () => {
      const loginResult = await login('sales', 'sales123');
      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
      });
      assert.equal(logoutResponse.status, 204);
    });

    test('不带Token登出也返回204', async () => {
      const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      assert.equal(logoutResponse.status, 204);
    });

    test('登出后Token失效', async () => {
      const loginResult = await login('sales', 'sales123');
      const token = loginResult.data.token;
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      assert.equal(dashboardResponse.status, 401);
    });
  });

  describe('Current User', () => {
    test('获取当前用户信息', async () => {
      const loginResult = await login('sales', 'sales123');
      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
      });
      assert.equal(meResponse.status, 200);
      const me = await meResponse.json();
      assert.equal(me.user.username, 'sales');
    });

    test('不带Token获取当前用户返回401', async () => {
      const meResponse = await fetch(`${baseUrl}/api/auth/me`);
      assert.equal(meResponse.status, 401);
    });

    test('无效Token获取当前用户返回401', async () => {
      const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Authorization': 'Bearer invalid-token-12345' },
      });
      assert.equal(meResponse.status, 401);
    });
  });

  describe('Authorization', () => {
    test('有权限用户可访问dashboard', async () => {
      const loginResult = await login('sales', 'sales123');
      const dashboardResponse = await fetch(`${baseUrl}/api/dashboard`, {
        headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
      });
      assert.equal(dashboardResponse.status, 200);
    });

    test('无权限用户访问受保护资源返回403', async () => {
      const loginResult = await login('sales', 'sales123');
      const usersResponse = await fetch(`${baseUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
      });
      assert.equal(usersResponse.status, 403);
    });

    test('admin可访问users管理', async () => {
      const loginResult = await login('admin', 'admin123');
      const usersResponse = await fetch(`${baseUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${loginResult.data.token}` },
      });
      assert.equal(usersResponse.status, 200);
    });

    test('无Token访问受保护资源返回401', async () => {
      const protectedEndpoints = ['/api/dashboard', '/api/users', '/api/customers'];
      for (const endpoint of protectedEndpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`);
        assert.equal(response.status, 401);
      }
    });
  });

  describe('Static Files', () => {
    test('首页可访问', async () => {
      const homeResponse = await fetch(`${baseUrl}/`);
      assert.equal(homeResponse.status, 200);
      const text = await homeResponse.text();
      assert.ok(text.includes('Modern ERP'));
    });

    test('不存在的静态文件返回index.html', async () => {
      const response = await fetch(`${baseUrl}/nonexistent-page`);
      assert.equal(response.status, 200);
    });
  });
});

test('扩展业务模块在全新数据库中完成迁移并可查询', async () => {
  const { token } = (await login('admin', 'admin123')).data;
  const headers = { authorization: `Bearer ${token}` };
  const paths = [
    '/api/contacts', '/api/projects', '/api/notifications', '/api/departments',
    '/api/aux-projects', '/api/mrp-plans', '/api/iqc', '/api/oqc',
    '/api/leave-requests', '/api/expense-claims', '/api/alert-rules',
    '/api/reports/financial-summary', '/api/reports/inventory-status',
    '/api/reports/sales-analysis',
  ];

  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
  }
});
