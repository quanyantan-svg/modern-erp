// Accounting & Analytics Domain Closure — AA-W1 / AA-W2 contract suite.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.1 AA-W1.1..AA-W1.16
//   and §35.4.2 AA-W2.1..AA-W2.12
// Design:    docs/design/accounting-analytics.md §31.1 / §31.2
//
// Every capability in this suite has at least one positive case and at least
// one negative case. No `skip`, no deleted assertion, no downgraded
// classification.
//
// This suite owns one temporary SQLite file. It never touches a project /
// development / production database and never connects to MySQL.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createAccountingFixture, seedAccountingRoles } from './test-support/accounting-http-fixture.js';
import { recordEvent } from './modules/accounting-events.js';

const PERIOD = '2026-03';
const BUSINESS_DATE = '2026-03-15';

/**
 * Seed a template and its normalized line items directly, so the suite does
 * not depend on the HTTP write path for setup. The template is written
 * through the same canonical tables the write path uses.
 */
function seedTemplate(templateCode, debitRole = 'AA_W2_DEBIT', creditRole = 'AA_W2_CREDIT', conditionExpr = null) {
  const db = currentFixture.db;
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM voucher_templates WHERE template_code=?').get(templateCode);
  if (existing) return existing.id;
  const templateId = 'aa-tpl-' + templateCode.toLowerCase();
  db.prepare(`INSERT INTO voucher_templates(
      id,template_code,template_name,description,category,entries_json,active,creator_id,created_at,updated_at,
      version_no,valid_from,valid_to,status,condition_expr
    ) VALUES(?,?,?,'','GENERAL','[]',1,'user-admin',?,?,1,NULL,NULL,'ACTIVE',?)`)
    .run(templateId, templateCode, templateCode, now, now, conditionExpr);
  const insert = db.prepare(`INSERT INTO voucher_template_items(
      id,template_id,line_no,summary,accounting_role,subject_id,direction,amount_source,amount_expr,parse_status
    ) VALUES(?,?,?,?,?,NULL,?,?,NULL,'RESOLVED')`);
  insert.run(templateId + '-1', templateId, 1, '借', debitRole, 'DEBIT', 'SOURCE_AMOUNT');
  insert.run(templateId + '-2', templateId, 2, '贷', creditRole, 'CREDIT', 'SOURCE_AMOUNT');
  return templateId;
}

function seedRule(templateId, templateCode, sourceType, eventType) {
  const db = currentFixture.db;
  const now = new Date().toISOString();
  const ruleId = 'aa-rule-' + sourceType.toLowerCase() + '-' + eventType.toLowerCase() + '-' + Math.random().toString(36).slice(2, 8);
  db.prepare(`INSERT INTO accounting_rule_bindings(
      id,source_type,event_type,template_id,valid_from,valid_to,priority,status,created_by,created_at
    ) VALUES(?,?,?,?,'2020-01-01',NULL,100,'ACTIVE','user-admin',?)`)
    .run(ruleId, sourceType, eventType, templateId, now);
  return ruleId;
}

let currentFixture;

describe('Accounting & Analytics — AA-W1 会计事件台账与对账工作台', () => {
  let fixture;

  before(async () => {
    fixture = await createAccountingFixture();
    currentFixture = fixture;
  });

  after(async () => {
    await fixture.close();
  });

  // ------------------------------------------------------------------
  // AA-W1.1 / AA-W1.4 — exactly one event per business fact
  // ------------------------------------------------------------------
  test('AA-W1.1 同一业务事实恰有一条事件，重复记录不产生第二条', () => {
    const first = recordEvent(fixture.db, {
      eventType: 'SALES_INVOICE_POSTED',
      sourceType: 'SALES_INVOICE',
      sourceId: 'so-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 10000,
    });
    const second = recordEvent(fixture.db, {
      eventType: 'SALES_INVOICE_POSTED',
      sourceType: 'SALES_INVOICE',
      sourceId: 'so-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 10000,
    });
    assert.equal(first.id, second.id, '重复记录必须返回同一条事件');
    const count = fixture.db.prepare(
      "SELECT COUNT(*) n FROM accounting_events WHERE event_type='SALES_INVOICE_POSTED' AND source_type='SALES_INVOICE' AND source_id='so-fact-1'",
    ).get().n;
    assert.equal(count, 1);
  });

  test('AA-W1.4 事件自然键在数据库层唯一，直接写第二条被拒绝', () => {
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='so-fact-1'").get();
    assert.ok(event, '前置事件必须存在');
    assert.throws(() => {
      fixture.db.prepare(`INSERT INTO accounting_events(
          id,event_type,source_type,source_id,source_item_id,business_date,period,status,attempt_count,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,'PENDING',0,?,?)`)
        .run('dup-event', 'SALES_INVOICE_POSTED', 'SALES_INVOICE', 'so-fact-1', '', BUSINESS_DATE, PERIOD, 'now', 'now');
    }, '第二条例外事件必须被唯一约束拒绝');
  });

  // ------------------------------------------------------------------
  // AA-W1.5 / AA-W1.6 — the ungenerated workbench
  // ------------------------------------------------------------------
  test('AA-W1.5/AA-W1.6 未生成清单可按状态与错误码筛选', async () => {
    recordEvent(fixture.db, {
      eventType: 'AR_POSTED',
      sourceType: 'SALES_INVOICE',
      sourceId: 'ar-fact-pending',
      businessDate: BUSINESS_DATE,
    });
    const listed = await fixture.request('GET', '/api/accounting/events/ungenerated', fixture.tokens.accounting);
    assert.equal(listed.status, 200, listed.data.error);
    assert.ok(listed.data.events.length >= 1, 'PENDING 事件必须出现在未生成清单');

    const failed = fixture.db.prepare(
      "UPDATE accounting_events SET status='FAILED', last_error_code='RULE_NOT_FOUND' WHERE source_id='ar-fact-pending'",
    ).run();
    assert.equal(failed.changes, 1);

    const filtered = await fixture.request('GET', '/api/accounting/events/ungenerated?error_code=RULE_NOT_FOUND', fixture.tokens.accounting);
    assert.equal(filtered.status, 200, filtered.data.error);
    assert.equal(filtered.data.events.length, 1);
    assert.equal(filtered.data.events[0].last_error_code, 'RULE_NOT_FOUND');
  });

  test('AA-W1.5 跳过后不再出现在未生成清单', async () => {
    recordEvent(fixture.db, {
      eventType: 'AP_POSTED',
      sourceType: 'SUPPLIER_BILL',
      sourceId: 'ap-fact-skip',
      businessDate: BUSINESS_DATE,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='ap-fact-skip'").get();
    const skipped = await fixture.request('POST', '/api/accounting/events/' + event.id + '/skip', fixture.tokens.accounting, { reason: '业务作废' });
    assert.equal(skipped.status, 200, skipped.data.error);
    assert.equal(skipped.data.event.status, 'SKIPPED');

    const listed = await fixture.request('GET', '/api/accounting/events/ungenerated', fixture.tokens.accounting);
    assert.ok(!listed.data.events.some((row) => row.id === event.id), '已跳过事件不得出现在未生成清单');
  });

  // ------------------------------------------------------------------
  // AA-W1.7 — controlled repair
  // ------------------------------------------------------------------
  test('AA-W1.7 跳过必须填写原因', async () => {
    recordEvent(fixture.db, {
      eventType: 'WIP_POSTED',
      sourceType: 'PRODUCTION_ORDER',
      sourceId: 'wip-fact-reason',
      businessDate: BUSINESS_DATE,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='wip-fact-reason'").get();
    const skipped = await fixture.request('POST', '/api/accounting/events/' + event.id + '/skip', fixture.tokens.accounting, { reason: '   ' });
    assert.equal(skipped.status, 400, '空原因必须被拒绝');
    assert.equal(skipped.data.code, 'ACCOUNTING_EVENT_SKIP_REASON_REQUIRED');
  });

  test('AA-W1.7 跳过与恢复都写审计', async () => {
    recordEvent(fixture.db, {
      eventType: 'COGS_POSTED',
      sourceType: 'DELIVERY_NOTICE',
      sourceId: 'cogs-fact-audit',
      businessDate: BUSINESS_DATE,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='cogs-fact-audit'").get();
    await fixture.request('POST', '/api/accounting/events/' + event.id + '/skip', fixture.tokens.accounting, { reason: '待核实' });
    await fixture.request('POST', '/api/accounting/events/' + event.id + '/resume', fixture.tokens.accounting);
    const skipAudit = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='ACCOUNTING_EVENT_SKIP' AND entity_id=?").get(event.id).n;
    const resumeAudit = fixture.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='ACCOUNTING_EVENT_RESUME' AND entity_id=?").get(event.id).n;
    assert.equal(skipAudit, 1, '跳过必须写审计');
    assert.equal(resumeAudit, 1, '恢复必须写审计');
    const resumed = fixture.db.prepare('SELECT * FROM accounting_events WHERE id=?').get(event.id);
    assert.equal(resumed.status, 'PENDING');
    assert.equal(resumed.skip_reason, null);
  });

  // ------------------------------------------------------------------
  // AA-W1.8 — retry idempotency
  // ------------------------------------------------------------------
  test('AA-W1.8 重复修复不会产生第二张凭证', async () => {
    seedAccountingRoles(fixture.db, { code: 'AA_TEST_DEBIT', type: 'EXPENSE', direction: 'DEBIT' });
    seedAccountingRoles(fixture.db, { code: 'AA_TEST_CREDIT', type: 'LIABILITY', direction: 'CREDIT' });
    const templateId = seedTemplate('AA-IDEMPOTENT', 'AA_TEST_DEBIT', 'AA_TEST_CREDIT');
    seedRule(templateId, 'AA-IDEMPOTENT', 'SALES_INVOICE', 'AA_TEST_EVENT');

    recordEvent(fixture.db, {
      eventType: 'AA_TEST_EVENT',
      sourceType: 'SALES_INVOICE',
      sourceId: 'idem-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 5000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='idem-fact-1'").get();

    const first = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    assert.equal(first.status, 200, first.data.error);
    assert.ok(first.data.voucherId, '首次修复必须生成凭证');

    const second = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    // Design §31.1.5: re-generating an already GENERATED event is a 409 with
    // the stable code ACCOUNTING_EVENT_ALREADY_GENERATED. The idempotency
    // invariant that matters is that no second voucher is ever written.
    assert.equal(second.status, 409, second.data.error);
    assert.equal(second.data.code, 'ACCOUNTING_EVENT_ALREADY_GENERATED');

    const voucherCount = fixture.db.prepare('SELECT COUNT(*) n FROM accounting_vouchers WHERE source_id=?').get('idem-fact-1').n;
    assert.equal(voucherCount, 1, '同一业务事实只能有一张凭证');
  });

  // ------------------------------------------------------------------
  // AA-W1.7 — SOD
  // ------------------------------------------------------------------
  test('AA-W1.7 修复人不得是原始业务单据审核人', async () => {
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO production_orders(
        id,order_no,product_id,quantity,status,creator_id,created_at,updated_at,approved_by,approved_at
      ) VALUES('po-sod-1','PO-SOD-1','product-sod-1',1,'APPROVED','user-admin',?,?,?,?)`)
      .run(now, now, 'user-accounting', now);
    recordEvent(fixture.db, {
      eventType: 'PO_POSTED',
      sourceType: 'PURCHASE_ORDER',
      sourceId: 'po-sod-1',
      businessDate: BUSINESS_DATE,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='po-sod-1'").get();
    const retry = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    assert.equal(retry.status, 403, '修复人 == 原单审核人必须被后端拒绝');
    assert.equal(retry.data.code, 'ACCOUNTING_EVENT_REPAIR_SOD_VIOLATION');
  });

  // ------------------------------------------------------------------
  // AA-W1.5 — fail closed
  // ------------------------------------------------------------------
  test('AA-W1.5 无权限角色不能读取事件台账', async () => {
    const listed = await fixture.request('GET', '/api/accounting/events', fixture.tokens.sales);
    assert.equal(listed.status, 403, '无权限角色必须被拒绝');
  });

  test('AA-W1.5 事件不存在返回 404 与稳定错误码', async () => {
    const listed = await fixture.request('GET', '/api/accounting/events/does-not-exist', fixture.tokens.accounting);
    assert.equal(listed.status, 404);
    assert.equal(listed.data.code, 'ACCOUNTING_EVENT_NOT_FOUND');
  });

  // ------------------------------------------------------------------
  // AA-W1.9 / AA-W1.10 — reconciliation snapshot
  // ------------------------------------------------------------------
  test('AA-W1.9 对账结果逐项给出检查码与差异', async () => {
    const run = await fixture.request('POST', '/api/accounting/reconciliation/run', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(run.status, 200, run.data.error);
    assert.ok(Array.isArray(run.data.items), '对账必须返回逐项结果');
    assert.ok(run.data.items.length > 0, '对账必须至少有一项检查');
    for (const item of run.data.items) {
      assert.ok(item.checkCode, '每项必须给出检查码');
      assert.ok(['PASS', 'FAIL'].includes(item.status), '每项必须给出明确状态');
      assert.ok(Number.isSafeInteger(item.differenceCents), '每项必须给出整数分差异');
      assert.ok(item.explanation.length > 0, '每项必须给出解释');
    }
  });

  test('AA-W1.10 对账快照可按期间回看且重复运行幂等', async () => {
    const before = await fixture.request('GET', '/api/accounting/reconciliation?period=' + PERIOD, fixture.tokens.accounting);
    assert.equal(before.status, 200, before.data.error);
    assert.ok(before.data.run, '必须能回看对账快照');

    const rerun = await fixture.request('POST', '/api/accounting/reconciliation/run', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(rerun.status, 200);
    assert.equal(rerun.data.idempotent, true, '同一期间重复对账必须幂等');
    assert.equal(rerun.data.run.id, before.data.run.id);
  });

  // ------------------------------------------------------------------
  // AA-W1.12 / AA-W1.13 — close checklist
  // ------------------------------------------------------------------
  test('AA-W1.12/AA-W1.13 期末检查覆盖未过账凭证与未生成事件', async () => {
    fixture.db.prepare(
      "INSERT INTO period_closures(id,period,period_year,period_month,closure_type,status,created_at) VALUES('aa-closure-check',?,2026,3,'MONTH','OPEN',?)",
    ).run(PERIOD, new Date().toISOString());
    const checklist = await fixture.request('GET', '/api/accounting/close-checklist?period=' + PERIOD, fixture.tokens.accounting);
    assert.equal(checklist.status, 200, checklist.data.error);
    const codes = checklist.data.checklist.map((entry) => entry.code);
    assert.ok(codes.includes('VOUCHERS_ENTERED'), '必须检查录入中凭证');
    assert.ok(codes.includes('VOUCHERS_SUBMITTED'), '必须检查待审核凭证');
    assert.ok(codes.includes('VOUCHERS_REJECTED'), '必须检查已驳回凭证');
    assert.ok(codes.includes('UNPOSTED_VOUCHERS'), '必须检查未过账凭证');
    assert.ok(codes.includes('UNGENERATED_ACCOUNTING_EVENTS'), '必须检查凭证生成完整性');
    assert.ok(codes.includes('PROFIT_NOT_TRANSFERRED'), '必须检查损益结转');
    assert.equal(checklist.data.passed, false, '存在未生成事件时检查不得通过');
  });

  test('AA-W1.12 存在未生成事件时关账被真实拦截', async () => {
    const close = await fixture.request('POST', '/api/period-closures/aa-closure-check/close', fixture.tokens.admin);
    assert.equal(close.status, 409, '存在未生成事件时关账必须被拦截');
  });

  // ------------------------------------------------------------------
  // AA-W1.15 / AA-W1.16 — subject maintenance
  // ------------------------------------------------------------------
  test('AA-W1.15 科目可创建且编码唯一', async () => {
    const created = await fixture.request('POST', '/api/accounting/subjects', fixture.tokens.accounting, {
      code: 'AA-TEST-1001', name: '测试科目', type: 'EXPENSE', direction: 'DEBIT',
    });
    assert.equal(created.status, 201, created.data.error);
    const duplicate = await fixture.request('POST', '/api/accounting/subjects', fixture.tokens.accounting, {
      code: 'AA-TEST-1001', name: '重复科目', type: 'EXPENSE', direction: 'DEBIT',
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.code, 'ACCOUNTING_SUBJECT_CODE_EXISTS');
  });

  test('AA-W1.16 已被引用的科目不得改变类型或余额方向', async () => {
    const subject = fixture.db.prepare("SELECT * FROM accounting_subjects WHERE code='AA-TEST-1001'").get();
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,status,voucher_origin,period)
      VALUES('aa-voucher-ref','AA-V-1','MANUAL','aa-voucher-ref',?,?,'','user-admin',?,'POSTED','SYSTEM',?)`)
      .run(BUSINESS_DATE, BUSINESS_DATE, now, PERIOD);
    fixture.db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)')
      .run('aa-entry-ref', 'aa-voucher-ref', subject.id, 'DEBIT', 100, '');

    const updated = await fixture.request('PATCH', '/api/accounting/subjects/' + subject.id, fixture.tokens.accounting, {
      type: 'ASSET', direction: 'CREDIT',
    });
    assert.equal(updated.status, 409, '已引用科目不得改变类型或余额方向');
    assert.equal(updated.data.code, 'ACCOUNTING_SUBJECT_HAS_REFERENCES');
  });

  test('AA-W1.16 停用后不得用于新分录', async () => {
    const created = await fixture.request('POST', '/api/accounting/subjects', fixture.tokens.accounting, {
      code: 'AA-TEST-1002', name: '待停用科目', type: 'EXPENSE', direction: 'DEBIT',
    });
    assert.equal(created.status, 201, created.data.error);
    const subjectId = created.data.id;
    const deactivated = await fixture.request('POST', '/api/accounting/subjects/' + subjectId + '/deactivate', fixture.tokens.accounting);
    assert.equal(deactivated.status, 200, deactivated.data.error);
    const row = fixture.db.prepare('SELECT active FROM accounting_subjects WHERE id=?').get(subjectId);
    assert.equal(row.active, 0, '停用后 active 必须为 0');
    const again = await fixture.request('POST', '/api/accounting/subjects/' + subjectId + '/deactivate', fixture.tokens.accounting);
    assert.equal(again.status, 409, '重复停用必须被拒绝');
  });

  test('AA-W1.15 科目维护需要权限', async () => {
    const created = await fixture.request('POST', '/api/accounting/subjects', fixture.tokens.sales, {
      code: 'AA-TEST-9999', name: '越权科目', type: 'EXPENSE', direction: 'DEBIT',
    });
    assert.equal(created.status, 403, '无权限角色不得维护科目');
  });
});

// ---------------------------------------------------------------------------
// AA-W2 — 凭证模板与规则平台
// ---------------------------------------------------------------------------

describe('Accounting & Analytics — AA-W2 凭证模板与规则平台', () => {
  let fixture;

  before(async () => {
    fixture = await createAccountingFixture();
    currentFixture = fixture;
    seedAccountingRoles(fixture.db, { code: 'AA_W2_DEBIT', type: 'EXPENSE', direction: 'DEBIT' });
    seedAccountingRoles(fixture.db, { code: 'AA_W2_CREDIT', type: 'LIABILITY', direction: 'CREDIT' });
  });

  after(async () => {
    await fixture.close();
  });

  test('AA-W2.1 模板可创建且分录要求科目角色或科目', async () => {
    const created = await fixture.request('POST', '/api/accounting/voucher-templates', fixture.tokens.accounting, {
      templateCode: 'AA-W2-TPL-1',
      name: 'AA-W2 测试模板',
      items: [
        { direction: 'DEBIT', accountingRole: 'AA_W2_DEBIT', amountSource: 'SOURCE_AMOUNT', summary: '借' },
        { direction: 'CREDIT', accountingRole: 'AA_W2_CREDIT', amountSource: 'SOURCE_AMOUNT', summary: '贷' },
      ],
    });
    assert.equal(created.status, 201, created.data.error);

    const invalid = await fixture.request('POST', '/api/accounting/voucher-templates', fixture.tokens.accounting, {
      templateCode: 'AA-W2-TPL-BAD',
      name: '缺少科目的模板',
      items: [{ direction: 'DEBIT', amountSource: 'SOURCE_AMOUNT' }],
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, 'VOUCHER_TEMPLATE_SUBJECT_REQUIRED');
  });

  test('AA-W2.5 规则命中唯一：未命中与歧义都显式失败', async () => {
    const templateId = seedTemplate('AA-W2-TPL-2');
    const listed = await fixture.request('GET', '/api/accounting/rules', fixture.tokens.accounting);
    assert.equal(listed.status, 200, listed.data.error);

    recordEvent(fixture.db, {
      eventType: 'AA_MISSING_EVENT',
      sourceType: 'NO_RULE_SOURCE',
      sourceId: 'missing-rule-fact',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const missingEvent = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='missing-rule-fact'").get();
    const missing = await fixture.request('POST', '/api/accounting/events/' + missingEvent.id + '/retry', fixture.tokens.accounting);
    assert.equal(missing.status, 409, '未命中规则必须显式失败');
    assert.equal(missing.data.code, 'RULE_NOT_FOUND');
    const failed = fixture.db.prepare('SELECT * FROM accounting_events WHERE id=?').get(missingEvent.id);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.last_error_code, 'RULE_NOT_FOUND');
    assert.equal(failed.voucher_id, null, '失败不得留下半张凭证');

    seedRule(templateId, 'AA-W2-TPL-2', 'AMBIGUOUS_SOURCE', 'AA_AMBIGUOUS_EVENT');
    seedRule(templateId, 'AA-W2-TPL-2', 'AMBIGUOUS_SOURCE', 'AA_AMBIGUOUS_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_AMBIGUOUS_EVENT',
      sourceType: 'AMBIGUOUS_SOURCE',
      sourceId: 'ambiguous-rule-fact',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const ambiguousEvent = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='ambiguous-rule-fact'").get();
    const ambiguous = await fixture.request('POST', '/api/accounting/events/' + ambiguousEvent.id + '/retry', fixture.tokens.accounting);
    assert.equal(ambiguous.status, 409, '规则歧义必须显式失败');
    assert.equal(ambiguous.data.code, 'RULE_AMBIGUOUS');
  });

  test('AA-W2.6 科目通过角色解析，缺少映射时失败', async () => {
    const templateId = seedTemplate('AA-W2-TPL-3', 'AA_MISSING_ROLE', 'AA_W2_CREDIT');
    seedRule(templateId, 'AA-W2-TPL-3', 'ROLE_MISSING_SOURCE', 'AA_ROLE_MISSING_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_ROLE_MISSING_EVENT',
      sourceType: 'ROLE_MISSING_SOURCE',
      sourceId: 'role-missing-fact',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='role-missing-fact'").get();
    const failed = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    assert.equal(failed.status, 409, '缺少科目角色映射必须失败');
    assert.equal(failed.data.code, 'ACCOUNTING_ROLE_MAPPING_MISSING');
  });

  test('AA-W2.9 批量生成逐条独立事务，单条失败不回滚整批', async () => {
    const templateId = seedTemplate('AA-W2-TPL-4');
    seedRule(templateId, 'AA-W2-TPL-4', 'BATCH_SOURCE', 'AA_BATCH_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_BATCH_EVENT',
      sourceType: 'BATCH_SOURCE',
      sourceId: 'batch-good-fact',
      businessDate: '2026-04-10',
      sourceAmountCents: 2000,
    });
    recordEvent(fixture.db, {
      eventType: 'AA_BATCH_EVENT',
      sourceType: 'BATCH_SOURCE',
      sourceId: 'batch-bad-fact',
      businessDate: '2026-04-10',
      sourceAmountCents: 2000,
    });
    // The second fact has no binding for its source type, so it must fail
    // while the first one still succeeds.
    fixture.db.prepare("UPDATE accounting_events SET source_type='BATCH_NO_RULE' WHERE source_id='batch-bad-fact'").run();

    const batch = await fixture.request('POST', '/api/accounting/events/batch-generate', fixture.tokens.accounting, {
      period: '2026-04',
    });
    assert.equal(batch.status, 200, batch.data.error);
    assert.equal(batch.data.success, 1, '成功条目必须计数');
    assert.equal(batch.data.failed, 1, '失败条目必须计数');
    assert.equal(batch.data.failures[0].errorCode, 'RULE_NOT_FOUND', '失败原因必须可见');

    const good = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='batch-good-fact'").get();
    assert.equal(good.status, 'GENERATED', '成功条目不得被同批失败回滚');
    assert.ok(good.voucher_id);

    const runs = await fixture.request('GET', '/api/accounting/generation-runs', fixture.tokens.accounting);
    assert.equal(runs.status, 200, runs.data.error);
    assert.ok(runs.data.runs.length >= 1, '批量生成必须留下运行记录');
  });

  test('AA-W2.2 停用模板后新业务不再命中，已生成凭证不受影响', async () => {
    const templateId = seedTemplate('AA-W2-TPL-5');
    seedRule(templateId, 'AA-W2-TPL-5', 'DEACTIVATE_SOURCE', 'AA_DEACTIVATE_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_DEACTIVATE_EVENT',
      sourceType: 'DEACTIVATE_SOURCE',
      sourceId: 'deactivate-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 3000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='deactivate-fact-1'").get();
    const generated = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    assert.equal(generated.status, 200, generated.data.error);
    const voucherBefore = generated.data.voucherId;

    const deactivated = await fixture.request('POST', '/api/accounting/voucher-templates/' + templateId + '/deactivate', fixture.tokens.accounting);
    assert.equal(deactivated.status, 200, deactivated.data.error);

    const voucherAfter = fixture.db.prepare('SELECT id FROM accounting_vouchers WHERE id=?').get(voucherBefore);
    assert.ok(voucherAfter, '停用模板不得影响已生成凭证');

    recordEvent(fixture.db, {
      eventType: 'AA_DEACTIVATE_EVENT',
      sourceType: 'DEACTIVATE_SOURCE',
      sourceId: 'deactivate-fact-2',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 3000,
    });
    const second = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='deactivate-fact-2'").get();
    const failed = await fixture.request('POST', '/api/accounting/events/' + second.id + '/retry', fixture.tokens.accounting);
    assert.equal(failed.status, 409, '停用模板后新业务不得再命中');
    assert.equal(failed.data.code, 'RULE_NOT_FOUND');
  });

  test('AA-W2.11 模板条件使用受限表达式', async () => {
    const templateId = seedTemplate('AA-W2-TPL-6', 'AA_W2_DEBIT', 'AA_W2_CREDIT', 'SOURCE_AMOUNT > 0');
    seedRule(templateId, 'AA-W2-TPL-6', 'EXPR_SOURCE', 'AA_EXPR_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_EXPR_EVENT',
      sourceType: 'EXPR_SOURCE',
      sourceId: 'expr-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='expr-fact-1'").get();
    const generated = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    assert.equal(generated.status, 200, generated.data.error);
    assert.ok(generated.data.voucherId);
  });

  test('AA-W2.12 表达式求值失败不得静默取 0', async () => {
    const templateId = seedTemplate('AA-W2-TPL-7', 'AA_W2_DEBIT', 'AA_W2_CREDIT', 'SOURCE_AMOUNT / 0');
    seedRule(templateId, 'AA-W2-TPL-7', 'DIVZERO_SOURCE', 'AA_DIVZERO_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_DIVZERO_EVENT',
      sourceType: 'DIVZERO_SOURCE',
      sourceId: 'divzero-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='divzero-fact-1'").get();
    const failed = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    // Design §31.10: an invalid expression is a 400-class input error.
    assert.equal(failed.status, 400, '除零必须显式失败');
    assert.equal(failed.data.code, 'EXPRESSION_INVALID');
    const row = fixture.db.prepare('SELECT * FROM accounting_events WHERE id=?').get(event.id);
    assert.equal(row.status, 'FAILED');
    assert.equal(row.voucher_id, null, '失败不得留下半张凭证');
  });

  test('AA-W2.12 表达式不得执行代码', async () => {
    const templateId = seedTemplate('AA-W2-TPL-8', 'AA_W2_DEBIT', 'AA_W2_CREDIT', 'eval(1) == 1');
    seedRule(templateId, 'AA-W2-TPL-8', 'EVAL_SOURCE', 'AA_EVAL_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_EVAL_EVENT',
      sourceType: 'EVAL_SOURCE',
      sourceId: 'eval-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='eval-fact-1'").get();
    const failed = await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    assert.equal(failed.status, 400, '代码执行表达式必须被拒绝');
    assert.equal(failed.data.code, 'EXPRESSION_INVALID');
    const row = fixture.db.prepare('SELECT * FROM accounting_events WHERE id=?').get(event.id);
    assert.equal(row.voucher_id, null);
  });

  test('AA-W2.3 已被使用过的模板版本不得原地改写', async () => {
    const usedId = seedTemplate('AA-W2-TPL-9');
    seedRule(usedId, 'AA-W2-TPL-9', 'USED_SOURCE', 'AA_USED_EVENT');
    recordEvent(fixture.db, {
      eventType: 'AA_USED_EVENT',
      sourceType: 'USED_SOURCE',
      sourceId: 'used-fact-1',
      businessDate: BUSINESS_DATE,
      sourceAmountCents: 1000,
    });
    const event = fixture.db.prepare("SELECT * FROM accounting_events WHERE source_id='used-fact-1'").get();
    await fixture.request('POST', '/api/accounting/events/' + event.id + '/retry', fixture.tokens.accounting);
    const frozen = await fixture.request('PATCH', '/api/accounting/voucher-templates/' + usedId, fixture.tokens.accounting, { name: '改写已使用模板' });
    assert.equal(frozen.status, 409, '已使用模板不得原地改写');
    assert.equal(frozen.data.code, 'VOUCHER_TEMPLATE_VERSION_FROZEN');
  });
});
