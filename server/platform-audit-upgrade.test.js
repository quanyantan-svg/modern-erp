// Platform 审计能力升级合同（PL-12）。
//
// 设计来源：docs/design/platform.md §32.2.7、§32.9；Requirement §36.9。
//
// 覆盖四件事：
//   1. **PL-DEF-06** —— `auditBusinessRejection` 的测试覆盖缺口被闭合：
//      正例（409 被拒绝时写入拒绝审计）与反例（非 409 错误**不写**）。
//   2. **向后兼容** —— `audit()` 的新增结构化参数是**可选**的；既有调用点不传新参数时，
//      新列写 NULL，8 个已冻结域的审计行为完全不变。
//   3. **schema 升级** —— `business_date` / `request_id` / `before_json` / `after_json`
//      四列与 `created_at` / 实体复合索引在 SQLite 与 MySQL 派生形状上同批落地。
//   4. **历史行不被改写** —— 迁移可重复执行，既有审计行内容逐字不变。

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { createDatabase } from './db.js';
import { audit, auditBusinessRejection } from './lib/audit.js';
import { HttpError } from './lib/http.js';
import { migratePlatformDomainSchema } from './migrations/platform-domain-schema.js';

let db;
let tempDir;

const before1 = { status: 'DRAFT', totalCents: 0 };
const after1 = { status: 'SUBMITTED', totalCents: 12345 };

before(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'modern-erp-platform-audit-'));
  db = createDatabase(join(tempDir, 'erp.db'));
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PL-12 审计 schema 升级', () => {
  test('四个结构化新列与两个索引存在', () => {
    const columns = new Set(db.prepare('PRAGMA table_info(audit_logs)').all().map((row) => row.name));
    for (const column of ['business_date', 'request_id', 'before_json', 'after_json']) {
      assert.ok(columns.has(column), `audit_logs 缺少列: ${column}`);
    }
    const indexes = new Set(db.prepare('PRAGMA index_list(audit_logs)').all().map((row) => row.name));
    assert.ok(indexes.has('ix_audit_logs_created_at'), '缺少 created_at 索引');
    assert.ok(indexes.has('ix_audit_logs_entity'), '缺少 entity 复合索引');
  });

  test('可选结构化参数写入新列；不传时新列为 NULL（向后兼容）', () => {
    const plain = db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
    audit(db, 'user-a', 'PLAIN', 'PLAIN_ENTITY', 'plain-1', '不传新参数的既有调用点');
    const plainRow = db.prepare('SELECT * FROM audit_logs WHERE entity_id=?').get('plain-1');
    assert.equal(plainRow.business_date, null);
    assert.equal(plainRow.request_id, null);
    assert.equal(plainRow.before_json, null);
    assert.equal(plainRow.after_json, null);
    assert.equal(plainRow.detail, '不传新参数的既有调用点');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, plain + 1);

    audit(db, 'user-a', 'STRUCTURED', 'PLAIN_ENTITY', 'structured-1', '带结构化证据', {
      businessDate: '2099-06-01', requestId: 'req-42', before: before1, after: after1,
    });
    const structured = db.prepare('SELECT * FROM audit_logs WHERE entity_id=?').get('structured-1');
    assert.equal(structured.business_date, '2099-06-01');
    assert.equal(structured.request_id, 'req-42');
    assert.deepEqual(JSON.parse(structured.before_json), before1);
    assert.deepEqual(JSON.parse(structured.after_json), after1);
  });
});

describe('PL-DEF-06 业务拒绝审计的测试覆盖', () => {
  test('正例：409 被拒绝时写入一条拒绝审计', () => {
    const before = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
    const error = new HttpError(409, '编号或账号已存在，请更换后重试', { code: 'DUPLICATE' });
    auditBusinessRejection(db, { id: 'user-b' }, {
      entityType: 'SALES_ORDER', entityId: 'so-1', action: '创建销售订单',
    }, error);
    const rows = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
    assert.equal(rows, before + 1, '409 拒绝必须留下一条拒绝审计');
    const row = db.prepare("SELECT * FROM audit_logs WHERE action='REJECT' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(row.entity_type, 'SALES_ORDER');
    assert.equal(row.entity_id, 'so-1');
    assert.equal(row.user_id, 'user-b');
    assert.match(row.detail, /DUPLICATE/);
  });

  test('反例：非 409 错误不写拒绝审计', () => {
    const before = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
    auditBusinessRejection(db, { id: 'user-b' }, {
      entityType: 'SALES_ORDER', entityId: 'so-2', action: '创建销售订单',
    }, new HttpError(400, '参数不合法'));
    auditBusinessRejection(db, { id: 'user-b' }, {
      entityType: 'SALES_ORDER', entityId: 'so-3', action: '创建销售订单',
    }, new HttpError(500, '服务器内部错误'));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n, before,
      '非 409 错误不得写拒绝审计');
  });

  test('onlyCodes 白名单外的错误码不写拒绝审计', () => {
    const before = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
    const error = new HttpError(409, '别的业务拒绝', { code: 'OTHER_BUSINESS_REJECT' });
    auditBusinessRejection(db, { id: 'user-b' }, {
      entityType: 'SALES_ORDER', entityId: 'so-4', action: '创建销售订单',
    }, error, { onlyCodes: ['DUPLICATE'] });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n, before,
      '白名单外的错误码不得写拒绝审计');
  });

  test('同一次拒绝只落一条审计（幂等标记）', () => {
    const before = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n;
    const error = new HttpError(409, '重复拒绝', { code: 'DUPLICATE' });
    const context = { entityType: 'SALES_ORDER', entityId: 'so-5', action: '创建销售订单' };
    auditBusinessRejection(db, { id: 'user-b' }, context, error);
    auditBusinessRejection(db, { id: 'user-b' }, context, error);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='REJECT'").get().n, before + 1,
      '同一次拒绝只允许一条审计行');
  });
});

describe('PL-12 历史审计行不被改写', () => {
  test('既有行的内容在重复初始化后逐字不变', () => {
    audit(db, 'user-c', 'HISTORY', 'PLAIN_ENTITY', 'history-1', '历史审计行');
    const original = db.prepare('SELECT * FROM audit_logs WHERE entity_id=?').get('history-1');
    // 重复初始化（迁移必须可重复执行）。
    migratePlatformDomainSchema(db);
    const afterMigration = db.prepare('SELECT * FROM audit_logs WHERE entity_id=?').get('history-1');
    assert.equal(afterMigration.detail, original.detail);
    assert.equal(afterMigration.action, original.action);
    assert.equal(afterMigration.created_at, original.created_at);
    assert.equal(afterMigration.business_date, null);
  });
});
