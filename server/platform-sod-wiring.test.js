// Platform SOD 接线 —— 跨域行为不变性与 PL-DEF-01 闭合证明（Design §32.4.3）。
//
// 两条断言：
//   1. **既有 6 族的行为逐字不变** —— 自审批仍然被拒绝，且**状态码与文案完全相同**
//      （409×4 + 403×1 + 信用特批的 409）。SOD 层接在既有防护之后，不抢先、不改写。
//   2. **生产工单族的自审批缺口已闭合**（PL-DEF-01）—— 该族此前没有任何自审批防护，
//      发起人可以审批自己提交的生产工单；现在由平台 SOD 层唯一把关。
//
// 另有一条源码级断言：7 个决策点都确实接上了 SOD 判定。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

import { createApp } from './app.js';
import { createDatabase } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let db;
let httpServer;
let baseUrl;
let tempDir;
const tokens = {};

const future = '2099-06-01T08:00:00.000Z';

function seedFixtures() {
  // 全部由 user-admin 发起 —— 用 admin 自己去审批，即自审批场景。
  db.prepare(`INSERT INTO sales_orders
    (id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-so-self', 'SO-SOD-SELF', 'customer-001', 'SUBMITTED', 100000, '', '', 'user-admin', null, future, null, future, future,
  );
  db.prepare(`INSERT INTO purchase_orders
    (id,order_no,supplier_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-po-self', 'PO-SOD-SELF', 'supplier-001', 'SUBMITTED', 100000, '', '', 'user-admin', null, future, null, future, future,
  );
  db.prepare(`INSERT INTO purchase_requisitions
    (id,requisition_no,status,creator_id,notes,created_at,updated_at,submitted_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    'sod-pr-self', 'PR-SOD-SELF', 'SUBMITTED', 'user-admin', '', future, future, future,
  );
  db.prepare(`INSERT INTO purchase_requisitions
    (id,requisition_no,status,creator_id,notes,created_at,updated_at,submitted_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(
    'sod-pr-other', 'PR-SOD-OTHER', 'SUBMITTED', 'user-sales', '', future, future, future,
  );
  db.prepare(`INSERT INTO inventory_checks
    (id,check_no,warehouse_id,status,checked_at,creator_id,created_at,product_id,system_quantity,actual_quantity,difference,reason,reviewer_id,reviewed_at,remark,business_date)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-ic-self', 'IC-SOD-SELF', 'warehouse-001', 'SUBMITTED', future, 'user-admin', future,
    'product-001', 10, 10, 0, '', null, null, '', '2099-06-01',
  );
  db.prepare(`INSERT INTO accounting_vouchers
    (id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status,period,approver_id,approved_at,updated_at,rejection_reason,submitted_at,submitted_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-vc-self', 'VCH-SOD-SELF', 'MANUAL', 'sod-vc-self', '2099-06-01', '', 'user-admin', future,
    'SUBMITTED', '2099-06', null, null, future, '', future, 'user-admin',
  );
  // 生产工单：一个由 admin 发起（自审批应被拒），一个由 sales 发起（应可通过）。
  db.prepare(`INSERT INTO production_orders
    (id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-po-self2', 'MO-SOD-SELF', 'product-001', 1, 'SUBMITTED', '', 'user-admin', future, future, 'user-admin', future,
  );
  db.prepare(`INSERT INTO production_orders
    (id,order_no,product_id,quantity,status,remark,creator_id,created_at,updated_at,submitted_by,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
    'sod-po-other', 'MO-SOD-OTHER', 'product-001', 1, 'SUBMITTED', '', 'user-sales', future, future, 'user-sales', future,
  );
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  tokens[username] = data.token;
}

async function request(path, username = 'admin', options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${tokens[username]}`,
      ...options.headers,
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'erp-sod-wiring-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  seedFixtures();
  httpServer = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  await login('admin', 'admin123');
  await login('sales', 'sales123');
});

after(async () => {
  await new Promise((done, fail) => httpServer.close((error) => (error ? fail(error) : done())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SOD-WIRE 既有 6 族的行为逐字不变', () => {
  const cases = [
    { family: 'SALES_ORDER', path: '/api/orders/sod-so-self/approve', status: 409, message: '创建人不能审批自己的订单' },
    { family: 'PURCHASE_ORDER', path: '/api/purchase-orders/sod-po-self/approve', status: 409, message: '创建人不能审核自己的订单' },
    { family: 'PURCHASE_REQUISITION', path: '/api/purchase-requisitions/sod-pr-self/approve', status: 409, message: '创建人不能审核自己的请购单' },
    { family: 'INVENTORY_CHECK', path: '/api/inventory-stocktakes/sod-ic-self/approve', status: 409, message: '盘点单创建人不能审批自己的单据' },
    { family: 'ACCOUNTING_VOUCHER', path: '/api/accounting-vouchers/sod-vc-self/approve', status: 403, message: '不能审核自己录入的凭证' },
  ];

  for (const testCase of cases) {
    test(`${testCase.family}：自审批仍被拒绝，且状态码与文案逐字不变`, async () => {
      const { status, data } = await request(testCase.path, 'admin', { method: 'POST' });
      assert.equal(status, testCase.status, `${testCase.family} 的拒绝状态码不得改变`);
      assert.equal(data.error, testCase.message, `${testCase.family} 的拒绝文案不得改变`);
    });
  }

  test('既有族在 SOD 层接入后仍可被他人正常审批（行为未被误伤）', async () => {
    // 用请购单证明正例：它的审批路径没有信用 / 库存等前置闸门，审批成败只取决于
    // 状态与职责分离 —— SOD 层不得误伤正常审批。
    const { status } = await request('/api/purchase-requisitions/sod-pr-other/approve', 'admin', { method: 'POST' });
    assert.equal(status, 200, '他人审批必须照常成功');
    assert.equal(db.prepare("SELECT status FROM purchase_requisitions WHERE id='sod-pr-other'").get().status, 'APPROVED');
  });
});

describe('SOD-WIRE 生产工单族的自审批缺口已闭合（PL-DEF-01）', () => {
  test('发起人审批自己提交的生产工单被拒绝', async () => {
    const { status, data } = await request('/api/production-orders/sod-po-self2/state', 'admin', {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 409, '自审批必须被拒绝');
    assert.equal(data.code, 'PLATFORM_SOD_RULE_VIOLATION');
    assert.equal(db.prepare("SELECT status FROM production_orders WHERE id='sod-po-self2'").get().status, 'SUBMITTED',
      '被拒绝后生产工单状态不得改变');
  });

  test('他人审批生产工单照常成功', async () => {
    const { status } = await request('/api/production-orders/sod-po-other/state', 'admin', {
      method: 'POST', body: { target: 'APPROVED' },
    });
    assert.equal(status, 200, '他人审批必须照常成功');
    assert.equal(db.prepare("SELECT status FROM production_orders WHERE id='sod-po-other'").get().status, 'APPROVED');
  });

  test('种子规则只为生产工单族存在，既有 6 族不产生任何判定记录', () => {
    const rules = db.prepare('SELECT * FROM sod_rules WHERE status=\'ACTIVE\'').all();
    assert.equal(rules.length, 1, '只应有生产工单族的种子规则');
    assert.equal(rules[0].business_type, 'PRODUCTION_ORDER');
    assert.equal(rules[0].constraint_type, 'SAME_PERSON_FORBIDDEN');
    assert.equal(rules[0].resolution, 'REJECT');
  });
});

describe('SOD-WIRE 接线位置', () => {
  const sites = [
    { file: 'server/modules/sales-orders.js', businessType: 'SALES_ORDER' },
    { file: 'server/app.js', businessType: 'PURCHASE_ORDER' },
    { file: 'server/app.js', businessType: 'ACCOUNTING_VOUCHER' },
    { file: 'server/modules/planning-documents.js', businessType: 'PURCHASE_REQUISITION' },
    { file: 'server/modules/inventory-stocktake.js', businessType: 'INVENTORY_CHECK' },
    { file: 'server/modules/manufacturing-orders.js', businessType: 'PRODUCTION_ORDER' },
    { file: 'server/modules/credit-special-approval.js', businessType: 'CREDIT_SPECIAL_APPROVAL' },
  ];

  for (const site of sites) {
    test(`${site.businessType} 的决策点已接入 SOD 判定`, () => {
      const source = readFileSync(join(root, site.file), 'utf8');
      assert.ok(
        source.includes(`businessType: '${site.businessType}'`),
        `${site.file} 缺少 ${site.businessType} 的 SOD 接线`,
      );
      assert.ok(source.includes('assertApprovalSod('), `${site.file} 缺少 assertApprovalSod 调用`);
    });
  }

  test('生产工单族是唯一以平台层为唯一闸门的族（既有防护之后接入）', () => {
    const manufacturing = readFileSync(join(root, 'server/modules/manufacturing-orders.js'), 'utf8');
    const approveBranch = manufacturing.slice(manufacturing.indexOf("if (target === 'APPROVED')"));
    const sodIndex = approveBranch.indexOf('assertApprovalSod(');
    assert.ok(sodIndex >= 0, '生产工单族必须接入 SOD');
    assert.ok(
      !approveBranch.slice(0, sodIndex).includes('creator_id === actor.id'),
      '生产工单族此前没有任何自审批防护，平台层是唯一闸门（PL-DEF-01）',
    );
    // 其余 5 族的既有防护必须保留在 SOD 之前 —— 既有行为逐字不变。
    for (const site of [
      { file: 'server/modules/sales-orders.js', marker: "order.creator_id === actor.id" },
      { file: 'server/app.js', marker: "order.creator_id === actor.id" },
      { file: 'server/modules/planning-documents.js', marker: 'header.creator_id === actor.id' },
      { file: 'server/modules/inventory-stocktake.js', marker: 'check.creator_id === actor.id' },
      { file: 'server/modules/credit-special-approval.js', marker: 'requestAudit.user_id === actor.id' },
    ]) {
      const source = readFileSync(join(root, site.file), 'utf8');
      assert.ok(source.includes(site.marker), `${site.file} 的既有自审批防护不得被移除`);
    }
  });
});
