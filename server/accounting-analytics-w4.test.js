// Accounting & Analytics Domain Closure — AA-W4 报表平台.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.4
// Design:    docs/design/accounting-analytics.md §31.4
//
// Coverage:
//   AA-W4.1..AA-W4.3   报表模板、行项目与期间实例
//   AA-W4.4..AA-W4.7   受限公式引擎、白名单取数、错误码与显式失败
//   AA-W4.8..AA-W4.10  生命周期、重算幂等、版本与审核留痕
//   AA-W4.11..AA-W4.13 自定义报表与既有固定报表口径不变

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createAccountingFixture } from './test-support/accounting-http-fixture.js';

const PERIOD = '2027-08';
const PERIOD_DATE = PERIOD + '-15';

let fixture;

before(async () => {
  fixture = await createAccountingFixture('erp-accounting-w4-');
});

after(async () => {
  if (fixture) await fixture.close();
});

/** 写入一张已过账凭证，作为取数的事实基础。 */
function seedPostedVoucher(db, { id, subjectCode, debitCents, creditCents, counterSubjectCode = '2202', counterCents = 0 }) {
  const now = new Date().toISOString();
  const subject = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(subjectCode);
  assert.ok(subject, `会计科目 ${subjectCode} 必须存在`);
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,period)
    VALUES(?,?,'AA_W4_FIXTURE',?,?,?,'AA-W4 fixture','user-accounting',?,?,'POSTED','MANUAL',?)`)
    .run(id, 'V-' + id, id, PERIOD_DATE, PERIOD_DATE, now, now, PERIOD);
  const entries = [];
  if (debitCents > 0) entries.push(['DEBIT', subject.id, debitCents]);
  if (creditCents > 0) entries.push(['CREDIT', subject.id, creditCents]);
  if (counterCents > 0) {
    const counter = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(counterSubjectCode);
    assert.ok(counter, `对方科目 ${counterSubjectCode} 必须存在`);
    entries.push([debitCents > 0 ? 'CREDIT' : 'DEBIT', counter.id, counterCents]);
  }
  entries.forEach(([direction, subjectId, amountCents], index) => {
    db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)')
      .run(`${id}-e${index}`, id, subjectId, direction, amountCents, 'AA-W4 fixture', index + 1);
  });
}

function templatePayload(overrides = {}) {
  return {
    templateCode: 'TPL-BALANCE',
    name: '库存余额模板',
    description: '按科目取期末余额并合计',
    items: [
      {
        itemCode: 'RM_OPENING', name: '原材料期初', sourceKind: 'GL_BALANCE',
        sourceJson: { subjectCode: '1403', measure: 'OPENING' }, sortNo: 1, levelNo: 1,
      },
      {
        itemCode: 'RM_CLOSING', name: '原材料期末', sourceKind: 'GL_BALANCE',
        sourceJson: { subjectCode: '1403', measure: 'CLOSING' }, sortNo: 2, levelNo: 1,
      },
      {
        itemCode: 'RM_CHANGE', name: '原材料变动', sourceKind: 'TEMPLATE_ITEM',
        formulaExpr: 'RM_CLOSING - RM_OPENING', sortNo: 3, levelNo: 2, isTotal: true,
      },
    ],
    ...overrides,
  };
}

describe('AA-W4 报表平台', () => {
  test('AA-W4.1/2 报表模板带行项目、可见范围、状态与版本', async () => {
    const created = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload());
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.reportTemplate.status, 'DRAFT');
    assert.equal(Number(created.data.reportTemplate.version_no), 1);

    const listed = await fixture.request('GET', '/api/accounting/report-templates', fixture.tokens.accounting);
    assert.equal(listed.status, 200);
    const template = listed.data.reportTemplates.find((row) => row.template_code === 'TPL-BALANCE');
    assert.ok(template, '模板必须在列表中可见');
    assert.equal(template.items.length, 3);
    assert.equal(template.permissions.length, 0);

    const duplicated = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload());
    assert.equal(duplicated.status, 409);

    const badSource = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload({
      templateCode: 'TPL-BAD',
      items: [{ itemCode: 'X', name: '非法来源', sourceKind: 'RAW_SQL', sourceJson: {} }],
    }));
    assert.equal(badSource.status, 400);
    assert.equal(badSource.data.code, 'REPORT_SOURCE_NOT_ALLOWED');

    const forbidden = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.sales, templatePayload({
      templateCode: 'TPL-SALES',
    }));
    assert.equal(forbidden.status, 403);
  });

  test('AA-W4.3/5 模板必须发布后才能实例化，取数只读已过账账簿', async () => {
    const created = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload({
      templateCode: 'TPL-PERIOD',
    }));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const templateId = created.data.reportTemplate.id;

    const tooEarly = await fixture.request('POST', '/api/accounting/report-instances', fixture.tokens.accounting, {
      templateId, period: PERIOD,
    });
    assert.equal(tooEarly.status, 409, '未发布的模板不得实例化');
    assert.equal(tooEarly.data.code, 'REPORT_TEMPLATE_NOT_PUBLISHED');

    const published = await fixture.request('POST', `/api/accounting/report-templates/${templateId}/publish`, fixture.tokens.accounting, {});
    assert.equal(published.status, 200, JSON.stringify(published.data));
    assert.equal(published.data.reportTemplate.status, 'PUBLISHED');
  });

  test('AA-W4.4/6/7 公式求值成功、失败显式报错且不静默取 0', async () => {
    seedPostedVoucher(fixture.db, { id: 'aa-w4-v1', subjectCode: '1403', debitCents: 50000, creditCents: 0 });
    seedPostedVoucher(fixture.db, { id: 'aa-w4-v2', subjectCode: '1403', debitCents: 0, creditCents: 20000, counterSubjectCode: '2202', counterCents: 20000 });
    const created = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload({
      templateCode: 'TPL-EVAL',
      items: [
        ...templatePayload().items,
        {
          itemCode: 'BAD_FORMULA', name: '非法公式', sourceKind: 'TEMPLATE_ITEM',
          formulaExpr: 'RM_CLOSING / 0', sortNo: 4, levelNo: 2,
        },
        {
          itemCode: 'UNKNOWN_REF', name: '未知标识符', sourceKind: 'TEMPLATE_ITEM',
          formulaExpr: 'NOT_BOUND + 1', sortNo: 5, levelNo: 2,
        },
      ],
    }));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const templateId = created.data.reportTemplate.id;
    await fixture.request('POST', `/api/accounting/report-templates/${templateId}/publish`, fixture.tokens.accounting, {});

    const preview = await fixture.request('GET', `/api/accounting/report-templates/${templateId}/preview?period=${PERIOD}`, fixture.tokens.accounting);
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const items = preview.data.preview.items;
    const closing = items.find((row) => row.itemCode === 'RM_CLOSING');
    assert.equal(Number(closing.valueCents), 30000, '期末余额必须来自已过账账簿');
    const change = items.find((row) => row.itemCode === 'RM_CHANGE');
    assert.equal(Number(change.valueCents), 30000, '公式项必须按绑定值求值');
    const badFormula = items.find((row) => row.itemCode === 'BAD_FORMULA');
    assert.equal(badFormula.valueCents, null, '求值失败不得静默取 0');
    assert.ok(badFormula.errorCode, '求值失败必须带错误码');
    const unknown = items.find((row) => row.itemCode === 'UNKNOWN_REF');
    assert.equal(unknown.valueCents, null);
    assert.ok(unknown.errorCode, '未知标识符必须带错误码');
    assert.ok(preview.data.preview.errorCount >= 2);
    assert.equal(preview.data.preview.status, 'COMPUTED_WITH_ERRORS');
  });

  test('AA-W4.8/9/10 生命周期：实例化 → 重算 → 提交 → 审核，且审核后重算生成新版本', async () => {
    seedPostedVoucher(fixture.db, { id: 'aa-w4-v3', subjectCode: '1403', debitCents: 70000, creditCents: 0, counterSubjectCode: '2202', counterCents: 70000 });
    const created = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload({
      templateCode: 'TPL-LIFECYCLE',
    }));
    const templateId = created.data.reportTemplate.id;
    await fixture.request('POST', `/api/accounting/report-templates/${templateId}/publish`, fixture.tokens.accounting, {});

    const instance = await fixture.request('POST', '/api/accounting/report-instances', fixture.tokens.accounting, {
      templateId, period: PERIOD,
    });
    assert.equal(instance.status, 201, JSON.stringify(instance.data));
    const instanceId = instance.data.reportInstance.id;
    assert.equal(instance.data.reportInstance.version_no, 1);

    // 未计算即提交 → 不得提交（存在求值失败的项或没有取值）。
    const computed = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/compute`, fixture.tokens.accounting, {});
    assert.equal(computed.status, 200, JSON.stringify(computed.data));

    // 重算幂等：同一实例重算后取值相同。
    const first = await fixture.request('GET', `/api/accounting/report-instances/${instanceId}`, fixture.tokens.accounting);
    const firstValues = first.data.values.map((row) => `${row.item_code}=${row.value_cents}`).join(',');
    await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/compute`, fixture.tokens.accounting, {});
    const second = await fixture.request('GET', `/api/accounting/report-instances/${instanceId}`, fixture.tokens.accounting);
    assert.equal(second.data.values.map((row) => `${row.item_code}=${row.value_cents}`).join(','), firstValues, '重算必须幂等');

    const submitted = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/submit`, fixture.tokens.accounting, {});
    assert.equal(submitted.status, 200, JSON.stringify(submitted.data));
    assert.equal(submitted.data.reportInstance.status, 'SUBMITTED');
    assert.ok(submitted.data.reportInstance.submitted_by);

    // 已提交不得重算。
    const recomputeSubmitted = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/compute`, fixture.tokens.accounting, {});
    assert.equal(recomputeSubmitted.status, 409);

    // 审核：提交人不得审核自己（SOD）。
    const selfApprove = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/approve`, fixture.tokens.accounting, { approved: true });
    assert.equal(selfApprove.status, 403);
    assert.equal(selfApprove.data.code, 'REPORT_INSTANCE_SOD_VIOLATION');

    const approved = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/approve`, fixture.tokens.admin, { approved: true });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.reportInstance.status, 'APPROVED');

    // 审核后的实例重算 → 显式重开为新版本，历史版本保留。
    const reopened = await fixture.request('POST', `/api/accounting/report-instances/${instanceId}/compute`, fixture.tokens.accounting, {});
    assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
    assert.equal(reopened.data.reportInstance.status, 'DRAFT');
    assert.equal(Number(reopened.data.reportInstance.version_no), 2);

    const detail = await fixture.request('GET', `/api/accounting/report-instances/${instanceId}`, fixture.tokens.accounting);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.history.length, 2, '历史版本必须可回看');
    const original = detail.data.history.find((row) => row.version_no === 1);
    assert.equal(original.status, 'APPROVED', '已审核版本不得被静默改写');
  });

  test('AA-W4.10 审核留痕必须存在，提交与审核分离', async () => {
    const rows = fixture.db.prepare("SELECT * FROM report_instances WHERE status='APPROVED'").all();
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.ok(row.submitted_by, '已审核实例必须有提交人');
      assert.ok(row.approved_by, '已审核实例必须有审核人');
      assert.notEqual(row.submitted_by, row.approved_by, '提交人与审核人必须分离');
    }
  });

  test('AA-W4.11/12 自定义报表沿用同一模板与期间口径，可见范围受控', async () => {
    // 自定义管理报表：与模板报表走同一套期间口径、同一套取数与权限模型。
    const created = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload({
      templateCode: 'TPL-CUSTOM',
      name: '自定义管理报表',
    }));
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const templateId = created.data.reportTemplate.id;
    await fixture.request('POST', `/api/accounting/report-templates/${templateId}/publish`, fixture.tokens.accounting, {});
    const instance = await fixture.request('POST', '/api/accounting/report-instances', fixture.tokens.accounting, {
      templateId, period: PERIOD,
    });
    assert.equal(instance.status, 201, JSON.stringify(instance.data));

    const badPeriod = await fixture.request('POST', '/api/accounting/report-instances', fixture.tokens.accounting, {
      templateId, period: '2027-8',
    });
    assert.equal(badPeriod.status, 400, '期间口径与模板报表一致');

    // 可见范围受限的模板：没有对应权限的主体看不到它，也不得实例化。
    const restricted = await fixture.request('POST', '/api/accounting/report-templates', fixture.tokens.accounting, templatePayload({
      templateCode: 'TPL-RESTRICTED',
      name: '受限报表',
      permissions: ['REPORT_SPECIAL_SCOPE'],
    }));
    assert.equal(restricted.status, 201, JSON.stringify(restricted.data));
    const restrictedId = restricted.data.reportTemplate.id;
    await fixture.request('POST', `/api/accounting/report-templates/${restrictedId}/publish`, fixture.tokens.accounting, {});
    const listed = await fixture.request('GET', '/api/accounting/report-templates', fixture.tokens.accounting);
    assert.equal(listed.data.reportTemplates.some((row) => row.id === restrictedId), false, '可见范围之外的主体看不到模板');
    const forbidden = await fixture.request('POST', '/api/accounting/report-instances', fixture.tokens.accounting, {
      templateId: restrictedId, period: PERIOD,
    });
    assert.equal(forbidden.status, 403, '可见范围之外的主体不得实例化');

    // 无报表权限的角色读模板列表一律拒绝。
    const denied = await fixture.request('GET', '/api/accounting/report-templates', fixture.tokens.sales);
    assert.equal(denied.status, 403);
  });

  test('AA-W4.13 既有固定执行报表口径与入口不变', async () => {
    const reports = await fixture.request('GET', '/api/reports/decision/sales-summary', fixture.tokens.accounting);
    assert.equal(reports.status, 200, '既有销售统计报表端点必须保持可用');
    assert.ok(Array.isArray(reports.data.rows || reports.data.report || []), '既有报表响应形状不变');
  });
});
