// Platform 附件能力 —— 合同测试（docs/design/platform.md §32.6）。
//
// 覆盖：multipart 上传与 base64 上传、内容寻址存储（同一内容多单据共享一份文件）、
// 类型与扩展名**双重**白名单、文件名净化、下载按归属对象的既有查看权限鉴权、
// 软删除与审计、accounting_vouchers.attachment_count 变为派生值。

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

function multipartBody(fields, file) {
  const boundary = '----erpAttachmentBoundary';
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`
    + `Content-Type: ${file.contentType}\r\n\r\n`,
  ));
  parts.push(file.body);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(parts) };
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

async function uploadMultipart(ownerType, ownerId, file, username = 'admin') {
  const { boundary, body } = multipartBody({ ownerType, ownerId }, file);
  const response = await fetch(`${baseUrl}/api/platform/attachments`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${tokens[username]}` },
    body,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
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
  tempDir = mkdtempSync(join(tmpdir(), 'erp-platform-att-'));
  db = createDatabase(join(tempDir, 'erp.db'));
  // 挂载点需要的最小业务行。
  db.prepare(`INSERT INTO sales_orders
    (id,order_no,customer_id,status,total_cents,remark,rejection_reason,creator_id,reviewer_id,submitted_at,reviewed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'att-so-1', 'SO-ATT-001', 'customer-001', 'SUBMITTED', 100000, '', '', 'user-sales', null, future, null, future, future,
  );
  db.prepare(`INSERT INTO accounting_vouchers
    (id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status,period,approver_id,approved_at,updated_at,rejection_reason,submitted_at,submitted_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'att-vc-1', 'VCH-ATT-001', 'MANUAL', 'att-vc-1', '2099-06-01', '', 'user-accounting', future,
    'SUBMITTED', '2099-06', null, null, future, '', future, 'user-accounting',
  );
  httpServer = createServer(createApp(db, { distDir: resolve(root, 'dist') }));
  await new Promise((done) => httpServer.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
  await login('admin', 'admin123');
  await login('sales', 'sales123');
  await login('accounting', 'accounting123');
});

after(async () => {
  await new Promise((done, fail) => httpServer.close((error) => (error ? fail(error) : done())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('ATT 上传与存储', () => {
  test('multipart 上传成功，元数据与内容寻址键正确', async () => {
    const body = Buffer.from('attachment-payload-one', 'utf8');
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: '合同扫描件.pdf', contentType: 'application/pdf', body,
    });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    const attachment = uploaded.data.attachment;
    assert.equal(attachment.fileName, '合同扫描件.pdf');
    assert.equal(attachment.contentType, 'application/pdf');
    assert.equal(attachment.byteSize, body.length);
    assert.match(attachment.sha256, /^[0-9a-f]{64}$/);
    assert.equal(attachment.storageKey, `${attachment.sha256.slice(0, 2)}/${attachment.sha256.slice(2, 4)}/${attachment.sha256}`);
    // 文件真的落盘了，且不在静态服务范围内。
    assert.ok(existsSync(join(tempDir, 'attachments', attachment.storageKey)), '附件文件必须落盘');
  });

  test('同一内容挂到另一个单据时共享同一份文件', async () => {
    const body = Buffer.from('attachment-payload-one', 'utf8');
    const second = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: '另一个名字.pdf', contentType: 'application/pdf', body,
    });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    assert.equal(second.data.attachment.storageKey, db.prepare(
      "SELECT storage_key FROM attachments WHERE file_name='合同扫描件.pdf'",
    ).get().storage_key, '同内容必须共享同一存储键');
  });

  test('base64 JSON 上传路径同样可用', async () => {
    const body = Buffer.from('base64-payload', 'utf8');
    const uploaded = await request('/api/platform/attachments', 'admin', {
      method: 'POST',
      body: {
        ownerType: 'SALES_ORDER', ownerId: 'att-so-1', fileName: '说明.txt',
        contentType: 'text/plain', contentBase64: body.toString('base64'),
      },
    });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    assert.equal(uploaded.data.attachment.byteSize, body.length);
  });

  test('客户端文件名不得影响落盘路径（路径分隔符被剥离）', async () => {
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: '../../etc/passwd.pdf', contentType: 'application/pdf', body: Buffer.from('trav', 'utf8'),
    });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    assert.equal(uploaded.data.attachment.fileName, 'passwd.pdf');
    assert.ok(!uploaded.data.attachment.storageKey.includes('..'), '存储键不得含路径片段');
  });
});

describe('ATT 类型与大小白名单', () => {
  test('content type 不在白名单被拒绝', async () => {
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: 'x.bin', contentType: 'application/octet-stream', body: Buffer.from('x'),
    });
    assert.equal(uploaded.status, 415);
    assert.equal(uploaded.data.code, 'PLATFORM_ATTACHMENT_TYPE_REJECTED');
  });

  test('扩展名不在白名单被拒绝（即使 content type 合法）', async () => {
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: 'payload.exe', contentType: 'application/pdf', body: Buffer.from('x'),
    });
    assert.equal(uploaded.status, 415);
    assert.equal(uploaded.data.code, 'PLATFORM_ATTACHMENT_TYPE_REJECTED');
  });

  test('归属类型未登记挂载点被拒绝', async () => {
    const uploaded = await uploadMultipart('NOT_A_MOUNT_POINT', 'x', {
      filename: 'a.pdf', contentType: 'application/pdf', body: Buffer.from('x'),
    });
    assert.equal(uploaded.status, 422);
    assert.equal(uploaded.data.code, 'PLATFORM_ATTACHMENT_OWNER_UNSUPPORTED');
  });
});

describe('ATT 下载鉴权', () => {
  test('有归属对象查看权限的用户可以下载', async () => {
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: '可下载.pdf', contentType: 'application/pdf', body: Buffer.from('download-me'),
    });
    const attachmentId = uploaded.data.attachment.id;
    const response = await fetch(`${baseUrl}/api/platform/attachments/${attachmentId}/content`, {
      headers: { authorization: `Bearer ${tokens.sales}` },
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'download-me');
    assert.match(response.headers.get('content-disposition') || '', /^attachment;/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  test('无归属对象查看权限的用户被拒绝', async () => {
    const uploaded = await uploadMultipart('ACCOUNTING_VOUCHER', 'att-vc-1', {
      filename: '凭证附件.pdf', contentType: 'application/pdf', body: Buffer.from('voucher-att'),
    });
    const attachmentId = uploaded.data.attachment.id;
    const denied = await fetch(`${baseUrl}/api/platform/attachments/${attachmentId}/content`, {
      headers: { authorization: `Bearer ${tokens.sales}` },
    });
    assert.equal(denied.status, 403, '销售角色不得下载凭证附件');
    const allowed = await fetch(`${baseUrl}/api/platform/attachments/${attachmentId}/content`, {
      headers: { authorization: `Bearer ${tokens.accounting}` },
    });
    assert.equal(allowed.status, 200);
  });

  test('列举同样受归属对象查看权限约束', async () => {
    const denied = await request('/api/platform/attachments?ownerType=ACCOUNTING_VOUCHER&ownerId=att-vc-1', 'sales');
    assert.equal(denied.status, 403);
    const allowed = await request('/api/platform/attachments?ownerType=SALES_ORDER&ownerId=att-so-1', 'sales');
    assert.equal(allowed.status, 200);
    assert.ok(allowed.data.attachments.length >= 1);
  });
});

describe('ATT 删除与派生计数', () => {
  test('凭证附件计数成为派生值，删除后重算', async () => {
    // 计数是派生值 —— 用相对断言，不依赖用例执行顺序。
    const countOf = () => db.prepare('SELECT attachment_count FROM accounting_vouchers WHERE id=?')
      .get('att-vc-1').attachment_count;
    const before = countOf();
    const uploaded = await uploadMultipart('ACCOUNTING_VOUCHER', 'att-vc-1', {
      filename: '凭证附件.pdf', contentType: 'application/pdf', body: Buffer.from('voucher-att'),
    });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    assert.equal(countOf(), before + 1, '上传后派生计数必须 +1');

    const deleted = await request(`/api/platform/attachments/${uploaded.data.attachment.id}/delete`, 'admin', {
      method: 'POST', body: { reason: '测试删除' },
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
    assert.equal(countOf(), before, '删除后派生计数必须回到原值');
    const audit = db.prepare(
      "SELECT COUNT(*) n FROM audit_logs WHERE entity_type='ATTACHMENT' AND action='ATTACHMENT_DELETE'",
    ).get().n;
    assert.equal(audit, 1, '删除必须写审计');
  });

  test('删除后的附件不可下载', async () => {
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: '待删除.pdf', contentType: 'application/pdf', body: Buffer.from('to-delete'),
    });
    const attachmentId = uploaded.data.attachment.id;
    await request(`/api/platform/attachments/${attachmentId}/delete`, 'admin', { method: 'POST', body: {} });
    const response = await fetch(`${baseUrl}/api/platform/attachments/${attachmentId}/content`, {
      headers: { authorization: `Bearer ${tokens.sales}` },
    });
    assert.equal(response.status, 404);
  });
});

describe('ATT 权限 fail closed', () => {
  test('无上传权限的角色被拒绝', async () => {
    const uploaded = await uploadMultipart('SALES_ORDER', 'att-so-1', {
      filename: '越权.pdf', contentType: 'application/pdf', body: Buffer.from('x'),
    }, 'sales');
    assert.equal(uploaded.status, 403);
  });
});
