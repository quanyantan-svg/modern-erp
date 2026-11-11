// Accounting & Analytics Domain Closure — AA-W3 总账增强与期末自动化.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.3
// Design:    docs/design/accounting-analytics.md §31.3
//
// Coverage:
//   AA-W3.1..AA-W3.4   凭证纠错（冲销 / 补记）统一路径
//   AA-W3.5..AA-W3.7   出纳复核状态机、SOD 与过账前置
//   AA-W3.8..AA-W3.10  现金流量表与资金子账对账
//   AA-W3.11..AA-W3.13 期末转账 / 摊销 / 计提
//   AA-W3.14..AA-W3.17 真实损益结转、反结转与关账拦截

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createAccountingFixture, seedAccountingRoles } from './test-support/accounting-http-fixture.js';

const PERIOD = '2027-03';
const PERIOD_DATE = PERIOD + '-15';
const PERIOD_END = PERIOD + '-31';

let fixture;

function seedPostedVoucher(db, { id, date, entries, origin = 'MANUAL', sourceType = 'MANUAL', status = 'POSTED' }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,period)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'V-' + id, sourceType, id, date, date, 'AA-W3 fixture', 'user-accounting', now, now, status, origin, date.slice(0, 7));
  entries.forEach((entry, index) => {
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)")
      .run(id + '-e' + index, id, entry.subjectId, entry.direction, entry.amountCents, entry.summary || '', index + 1);
  });
  return id;
}

function balanceOf(db, subjectId, period) {
  return Number(db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
    FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
    WHERE e.subject_id=? AND v.status='POSTED' AND v.period=?
  `).get(subjectId, period).n);
}

function closeInventoryGate(db, period) {
  db.prepare("INSERT OR REPLACE INTO inventory_period_closures(id,period_key,status,closed_by,closed_at,notes,close_checks_json) VALUES(?,?,'CLOSED','user-admin',?,'AA-W3 fixture',?)")
    .run('aa-w3-inv-' + period, period, new Date().toISOString(), JSON.stringify({ overallStatus: 'PASS', checks: [] }));
}

function openPeriodClosure(db, period, id) {
  const [year, month] = period.split('-').map(Number);
  db.prepare("INSERT OR REPLACE INTO period_closures(id,period,period_year,period_month,closure_type,status,created_at) VALUES(?,?,?,?,'MONTH','OPEN',?)")
    .run(id, period, year, month, new Date().toISOString());
}

before(async () => {
  fixture = await createAccountingFixture('erp-accounting-w3-');
});

after(async () => {
  if (fixture) await fixture.close();
});

beforeEach(() => {
  const db = fixture.db;
  db.exec(`DELETE FROM voucher_corrections;
    DELETE FROM period_end_runs;
    DELETE FROM period_end_definitions;
    DELETE FROM profit_transfer_runs;
    DELETE FROM accounting_entries;
    DELETE FROM accounting_vouchers;
    DELETE FROM accounting_close_check_snapshots;
    DELETE FROM accounting_reconciliation_runs;
    DELETE FROM settlement_account_movements;
    DELETE FROM inventory_period_closures;
    DELETE FROM period_closures;`);
  // The demo seed ships inventory positions without an authoritative
  // valuation, which legitimately blocks an authoritative close. The AA-W3
  // close gate is about the profit transfer, so the fixture starts from a
  // clean inventory ledger.
  db.exec(`DELETE FROM inventory_valuation_movements;
    DELETE FROM inventory_valuation_balances;
    DELETE FROM inventory_transactions;
    DELETE FROM inventory;`);
  db.prepare("INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES('w3-rev','6999','测试收入','REVENUE','CREDIT',1),('w3-exp','6998','测试费用','EXPENSE','DEBIT',1)").run();
  db.exec("UPDATE accounting_subjects SET active=1");
});

// ---------------------------------------------------------------------------
// AA-W3.1 .. AA-W3.4 — 凭证纠错
// ---------------------------------------------------------------------------

describe('AA-W3 凭证纠错：冲销与补记走同一条 canonical 路径', () => {
  test('AA-W3.1/W3.3 冲销生成金额与方向镜像一致的反向凭证', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-v1',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 50000, summary: '收现' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 50000, summary: '收入' },
      ],
    });
    const reversed = await fixture.request('POST', '/api/accounting/vouchers/w3-v1/reverse', fixture.tokens.accounting, { reason: '收现有误' });
    assert.equal(reversed.status, 201, JSON.stringify(reversed.data));
    const entries = db.prepare('SELECT subject_id subjectId,direction,amount_cents amountCents FROM accounting_entries WHERE voucher_id=? ORDER BY line_no').all(reversed.data.id);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].direction, 'CREDIT');
    assert.equal(entries[0].amountCents, 50000);
    assert.equal(entries[1].direction, 'DEBIT');
    assert.equal(entries[1].amountCents, 50000);
    const chain = db.prepare('SELECT * FROM voucher_corrections WHERE original_voucher_id=?').all('w3-v1');
    assert.equal(chain.length, 1);
    assert.equal(chain[0].correction_type, 'REVERSAL');
  });

  test('AA-W3.3 同一凭证不得被重复冲销', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-v1-dup',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 10000 },
      ],
    });
    const first = await fixture.request('POST', '/api/accounting/vouchers/w3-v1-dup/reverse', fixture.tokens.accounting, { reason: '第一次冲销' });
    assert.equal(first.status, 201);
    const second = await fixture.request('POST', '/api/accounting/vouchers/w3-v1-dup/reverse', fixture.tokens.accounting, { reason: '重复冲销' });
    assert.equal(second.status, 409);
    assert.equal(second.data.code, 'VOUCHER_ALREADY_REVERSED');
  });

  test('AA-W3.3 未过账凭证不得冲销', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-v-entered',
      date: PERIOD_DATE,
      status: 'ENTERED',
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 10000 },
      ],
    });
    const result = await fixture.request('POST', '/api/accounting/vouchers/w3-v-entered/reverse', fixture.tokens.accounting, { reason: '未过账' });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'VOUCHER_NOT_POSTED');
  });

  test('AA-W3.3 期间已关账时拒绝冲销', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-v-closed',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 10000 },
      ],
    });
    db.prepare("INSERT OR REPLACE INTO period_closures(id,period,period_year,period_month,closure_type,status,created_at) VALUES('w3-closed-period',?,2027,3,'MONTH','CLOSED',?)")
      .run(PERIOD, new Date().toISOString());
    const result = await fixture.request('POST', '/api/accounting/vouchers/w3-v-closed/reverse', fixture.tokens.accounting, { reason: '已关账' });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'PERIOD_CLOSED');
  });

  test('AA-W3.4 补记凭证与原凭证关联且差异可比', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-v2',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 30000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 30000 },
      ],
    });
    const supplemented = await fixture.request('POST', '/api/accounting/vouchers/w3-v2/supplement', fixture.tokens.accounting, {
      reason: '少记收入',
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 10000 },
      ],
    });
    assert.equal(supplemented.status, 201, JSON.stringify(supplemented.data));
    const link = db.prepare('SELECT correction_of_id correctionOfId FROM accounting_vouchers WHERE id=?').get(supplemented.data.id);
    assert.equal(link.correctionOfId, 'w3-v2');
    const chain = await fixture.request('GET', '/api/accounting/vouchers/w3-v2/corrections', fixture.tokens.accounting);
    assert.equal(chain.status, 200);
    assert.equal(chain.data.corrections.length, 1);
    assert.equal(chain.data.corrections[0].correction_type, 'SUPPLEMENT');
  });

  test('AA-W3.4 补记分录借贷不平衡时被拒绝', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-v3',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 30000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 30000 },
      ],
    });
    const result = await fixture.request('POST', '/api/accounting/vouchers/w3-v3/supplement', fixture.tokens.accounting, {
      reason: '不平衡补记',
      entries: [{ subjectId: 'subject-002', direction: 'DEBIT', amountCents: 10000 }],
    });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'VOUCHER_NOT_BALANCED');
  });
});

// ---------------------------------------------------------------------------
// AA-W3.5 .. AA-W3.7 — 出纳复核
// ---------------------------------------------------------------------------

describe('AA-W3 出纳复核：独立节点、SOD 与过账前置', () => {
  async function createSubmittedVoucher(db, id, creatorId = 'user-accounting') {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,period)
      VALUES(?,?,?,?,?,?,?,?,?,?,'SUBMITTED','MANUAL',?)`)
      .run(id, 'V-' + id, 'MANUAL', id, PERIOD_DATE, PERIOD_DATE, 'AA-W3 fixture', creatorId, now, now, PERIOD);
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)")
      .run(id + '-e0', id, 'subject-002', 'DEBIT', 20000, '付现', 1);
    db.prepare("INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)")
      .run(id + '-e1', id, 'subject-007', 'CREDIT', 20000, '成本', 2);
    return id;
  }

  test('AA-W3.6 未通过出纳复核的凭证不得过账', async () => {
    const db = fixture.db;
    await createSubmittedVoucher(db, 'w3-cashier-1');
    const marked = await fixture.request('POST', '/api/accounting/vouchers/w3-cashier-1/cashier-review', fixture.tokens.accounting, { action: 'MARK' });
    assert.equal(marked.status, 200, JSON.stringify(marked.data));
    assert.equal(marked.data.status, 'PENDING');
    const blocked = await fixture.request('POST', '/api/accounting-vouchers/w3-cashier-1/approve', fixture.tokens.admin);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.code, 'VOUCHER_CASHIER_REVIEW_REQUIRED');
  });

  test('AA-W3.7 出纳复核人不得是制单人', async () => {
    const db = fixture.db;
    await createSubmittedVoucher(db, 'w3-cashier-2');
    await fixture.request('POST', '/api/accounting/vouchers/w3-cashier-2/cashier-review', fixture.tokens.accounting, { action: 'MARK' });
    const selfReview = await fixture.request('POST', '/api/accounting/vouchers/w3-cashier-2/cashier-review', fixture.tokens.accounting, { action: 'APPROVE' });
    assert.equal(selfReview.status, 403);
    assert.equal(selfReview.data.code, 'VOUCHER_CASHIER_REVIEW_SOD_VIOLATION');
  });

  test('AA-W3.5 复核通过后凭证可以过账，且复核不改变金额', async () => {
    const db = fixture.db;
    await createSubmittedVoucher(db, 'w3-cashier-3');
    await fixture.request('POST', '/api/accounting/vouchers/w3-cashier-3/cashier-review', fixture.tokens.accounting, { action: 'MARK' });
    const approved = await fixture.request('POST', '/api/accounting/vouchers/w3-cashier-3/cashier-review', fixture.tokens.admin, { action: 'APPROVE', reason: '资金已核对' });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.status, 'APPROVED');
    const total = Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) n FROM accounting_entries WHERE voucher_id=?').get('w3-cashier-3').n);
    assert.equal(total, 40000, '复核不得改变凭证金额');
    const posted = await fixture.request('POST', '/api/accounting-vouchers/w3-cashier-3/approve', fixture.tokens.admin);
    assert.equal(posted.status, 200, JSON.stringify(posted.data));
  });

  test('AA-W3.6 无出纳复核权限的用户不得进入该节点', async () => {
    const db = fixture.db;
    await createSubmittedVoucher(db, 'w3-cashier-4');
    const denied = await fixture.request('POST', '/api/accounting/vouchers/w3-cashier-4/cashier-review', fixture.tokens.sales, { action: 'MARK' });
    assert.equal(denied.status, 403);
  });
});

// ---------------------------------------------------------------------------
// AA-W3.8 .. AA-W3.10 — 现金流量
// ---------------------------------------------------------------------------

describe('AA-W3 现金流量表：三段式、未分类显式与资金子账对账', () => {
  test('AA-W3.8/W3.9 分类分录进入三段，未分类现金分录显式列出', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-cf-1',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 120000, summary: '销售回款' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 120000, summary: '收入' },
      ],
    });
    db.prepare("UPDATE accounting_entries SET cash_flow_category='OPERATING', cash_flow_item='销售商品收到的现金' WHERE voucher_id='w3-cf-1' AND subject_id='subject-002'").run();
    seedPostedVoucher(db, {
      id: 'w3-cf-2',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 30000, summary: '未分类回款' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 30000, summary: '收入' },
      ],
    });
    const response = await fixture.request('GET', '/api/accounting/cash-flow?period=' + PERIOD, fixture.tokens.accounting);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const operating = response.data.sections.find((section) => section.category === 'OPERATING');
    assert.ok(operating, '必须存在经营活动段');
    assert.equal(operating.totalCents, 120000);
    assert.equal(response.data.sections.find((section) => section.category === 'INVESTING').totalCents, 0);
    assert.equal(response.data.sections.find((section) => section.category === 'FINANCING').totalCents, 0);
    assert.ok(response.data.unclassified.items.some((item) => item.reason === 'NOT_CLASSIFIED'),
      '未指定分类的现金分录必须显式出现在未分类行');
    assert.equal(response.data.cashMovementNetCents, 150000);
  });

  test('AA-W3.9 现金流量表只取已过账凭证', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-cf-draft',
      date: PERIOD_DATE,
      status: 'SUBMITTED',
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 99000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 99000 },
      ],
    });
    const response = await fixture.request('GET', '/api/accounting/cash-flow?period=' + PERIOD, fixture.tokens.accounting);
    assert.equal(response.status, 200);
    assert.equal(response.data.cashMovementNetCents, 0, '未过账凭证不得进入现金流量表');
  });

  test('AA-W3.10 与资金子账的差异被显式标记', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-cf-3',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 40000 },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 40000 },
      ],
    });
    db.prepare("UPDATE accounting_entries SET cash_flow_category='OPERATING', cash_flow_item='销售商品收到的现金' WHERE voucher_id='w3-cf-3' AND subject_id='subject-002'").run();
    const response = await fixture.request('GET', '/api/accounting/cash-flow?period=' + PERIOD, fixture.tokens.accounting);
    assert.equal(response.status, 200);
    assert.equal(response.data.reconciliation.code, 'CASH_FLOW_TO_TREASURY');
    assert.equal(response.data.reconciliation.differenceCents, 40000);
    assert.equal(response.data.reconciliation.passed, false);
    assert.ok(response.data.unclassified.items.some((item) => item.reason === 'CASH_FLOW_TO_TREASURY'),
      '差异必须计入未分类 / 差异行');
  });

  test('AA-W3.10 缺少期间时拒绝', async () => {
    const response = await fixture.request('GET', '/api/accounting/cash-flow', fixture.tokens.accounting);
    assert.equal(response.status, 400);
    assert.equal(response.data.code, 'CASH_FLOW_PERIOD_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// AA-W3.11 .. AA-W3.13 — 期末转账 / 摊销 / 计提
// ---------------------------------------------------------------------------

describe('AA-W3 期末处理：定义、幂等执行与凭证生成', () => {
  test('AA-W3.12 非法金额表达式在定义阶段被拒绝', async () => {
    const response = await fixture.request('POST', '/api/accounting/period-end/definitions', fixture.tokens.accounting, {
      defType: 'AMORTIZATION',
      code: 'AA-W3-AMORT',
      name: '待摊费用摊销',
      source: { sourceRole: 'AMORTIZATION_SOURCE', amountCents: 1000 },
      targetRole: 'AMORTIZATION_TARGET',
      direction: 'DEBIT',
      amountExpr: 'SOURCE_AMOUNT ** 2',
    });
    assert.equal(response.status, 400);
    assert.equal(response.data.code, 'PERIOD_END_EXPRESSION_INVALID');
  });

  test('AA-W3.12/W3.13 期末执行生成凭证且按定义与期间幂等', async () => {
    const db = fixture.db;
    seedAccountingRoles(db, { code: 'AMORT_SOURCE', type: 'EXPENSE', direction: 'DEBIT' });
    seedAccountingRoles(db, { code: 'AMORT_TARGET', type: 'EXPENSE', direction: 'DEBIT' });
    const created = await fixture.request('POST', '/api/accounting/period-end/definitions', fixture.tokens.accounting, {
      defType: 'AMORTIZATION',
      code: 'AA-W3-AMORT-1',
      name: '待摊费用摊销',
      source: { sourceRole: 'AMORT_SOURCE', amountCents: 5000 },
      targetRole: 'AMORT_TARGET',
      direction: 'DEBIT',
      amountExpr: 'SOURCE_AMOUNT',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const first = await fixture.request('POST', '/api/accounting/period-end/runs', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.runs.length, 1);
    assert.equal(first.data.runs[0].status, 'COMPLETED');
    assert.ok(first.data.runs[0].voucherId, '期末处理必须生成凭证');
    const second = await fixture.request('POST', '/api/accounting/period-end/runs', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(second.status, 200);
    assert.equal(second.data.runs[0].alreadyRun, true, '同一期间重复执行必须幂等');
    assert.equal(second.data.runs[0].voucherId, first.data.runs[0].voucherId);
    const vouchers = db.prepare("SELECT COUNT(*) n FROM accounting_vouchers WHERE source_type='PERIOD_END'").get().n;
    assert.equal(vouchers, 1, '重复执行不得产生第二张凭证');
  });

  test('AA-W3.11 停用的定义不得被执行', async () => {
    const db = fixture.db;
    seedAccountingRoles(db, { code: 'ACCRUAL_SOURCE', type: 'EXPENSE', direction: 'DEBIT' });
    seedAccountingRoles(db, { code: 'ACCRUAL_TARGET', type: 'EXPENSE', direction: 'DEBIT' });
    const created = await fixture.request('POST', '/api/accounting/period-end/definitions', fixture.tokens.accounting, {
      defType: 'ACCRUAL',
      code: 'AA-W3-ACCRUAL-1',
      name: '计提坏账准备',
      source: { sourceRole: 'ACCRUAL_SOURCE', amountCents: 3000 },
      targetRole: 'ACCRUAL_TARGET',
      direction: 'DEBIT',
      amountExpr: 'SOURCE_AMOUNT',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const deactivated = await fixture.request('POST', '/api/accounting/period-end/definitions/' + created.data.id + '/deactivate', fixture.tokens.accounting);
    assert.equal(deactivated.status, 200);
    const run = await fixture.request('POST', '/api/accounting/period-end/runs', fixture.tokens.accounting, { period: PERIOD, definitionId: created.data.id });
    assert.equal(run.status, 200);
    assert.equal(run.data.runs[0].status, 'FAILED');
    assert.equal(run.data.runs[0].errorCode, 'PERIOD_END_DEF_INACTIVE');
  });
});

// ---------------------------------------------------------------------------
// AA-W3.14 .. AA-W3.17 — 真实损益结转
// ---------------------------------------------------------------------------

describe('AA-W3 真实损益结转：权益承接、关账拦截与受控反结转', () => {
  function postProfitAndCost() {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-pl-1',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 200000, summary: '收款' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 200000, summary: '收入' },
      ],
    });
    seedPostedVoucher(db, {
      id: 'w3-pl-2',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-007', direction: 'DEBIT', amountCents: 50000, summary: '成本' },
        { subjectId: 'subject-002', direction: 'CREDIT', amountCents: 50000, summary: '付款' },
      ],
    });
  }

  test('AA-W3.14 结转后损益科目余额归零且权益科目承接净损益', async () => {
    const db = fixture.db;
    postProfitAndCost();
    const before = {
      revenue: balanceOf(db, 'subject-006', PERIOD),
      expense: balanceOf(db, 'subject-007', PERIOD),
    };
    assert.equal(before.revenue, -200000);
    assert.equal(before.expense, 50000);

    const result = await fixture.request('POST', '/api/accounting/profit-transfer', fixture.tokens.accounting, { period: PERIOD, reason: '期末结转' });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(balanceOf(db, 'subject-006', PERIOD), 0, '结转后收入科目余额必须为 0');
    assert.equal(balanceOf(db, 'subject-007', PERIOD), 0, '结转后成本科目余额必须为 0');

    const equity = db.prepare("SELECT id FROM accounting_subjects WHERE code='4103'").get();
    assert.ok(equity, '必须存在损益结转权益科目');
    const equityBalance = -balanceOf(db, equity.id, PERIOD);
    assert.equal(equityBalance, 150000, '权益科目贷方余额必须承接净损益 150000');
  });

  test('AA-W3.14 同一期间不得重复结转', async () => {
    const db = fixture.db;
    postProfitAndCost();
    const first = await fixture.request('POST', '/api/accounting/profit-transfer', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(first.status, 200);
    const second = await fixture.request('POST', '/api/accounting/profit-transfer', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(second.status, 409);
    assert.equal(second.data.code, 'PROFIT_TRANSFER_ALREADY_DONE');
  });

  test('AA-W3.16 未结转时禁止关闭会计期间，结转后放行', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-close-pl',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'w3-exp', direction: 'DEBIT', amountCents: 30000, summary: '费用' },
        { subjectId: 'w3-rev', direction: 'CREDIT', amountCents: 80000, summary: '收入' },
      ],
    });
    openPeriodClosure(db, PERIOD, 'w3-close-period');
    closeInventoryGate(db, PERIOD);
    const blocked = await fixture.request('POST', '/api/period-closures/w3-close-period/close', fixture.tokens.admin);
    assert.equal(blocked.status, 409, '未结转时关账必须被拦截');
    assert.equal(blocked.data.code, 'PROFIT_NOT_TRANSFERRED');

    const transferred = await fixture.request('POST', '/api/accounting/profit-transfer', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(transferred.status, 200);
    const closed = await fixture.request('POST', '/api/period-closures/w3-close-period/close', fixture.tokens.admin);
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
  });

  test('AA-W3.15 移除虚拟权益行后资产负债表口径自洽（移除前后一致性对照）', async () => {
    const db = fixture.db;
    seedPostedVoucher(db, {
      id: 'w3-bs-1',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 300000, summary: '收款' },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: 300000, summary: '收入' },
      ],
    });
    db.prepare("INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES('w3-equity','4001-W3','实收资本','EQUITY','CREDIT',1)").run();
    seedPostedVoucher(db, {
      id: 'w3-bs-2',
      date: PERIOD_DATE,
      entries: [
        { subjectId: 'subject-002', direction: 'DEBIT', amountCents: 100000, summary: '注资' },
        { subjectId: 'w3-equity', direction: 'CREDIT', amountCents: 100000, summary: '实收资本' },
      ],
    });
    const transferred = await fixture.request('POST', '/api/accounting/profit-transfer', fixture.tokens.accounting, { period: PERIOD });
    assert.equal(transferred.status, 200, JSON.stringify(transferred.data));
    const sheet = await fixture.request('GET', '/api/reports/balance-sheet?period=' + PERIOD, fixture.tokens.accounting);
    assert.equal(sheet.status, 200, JSON.stringify(sheet.data));
    assert.equal(sheet.data.totalAssets, 400000);
    assert.equal(sheet.data.totalLiabilitiesAndEquity, 400000, '结转后权益合计必须等于资产合计');
    assert.equal(sheet.data.difference, 0);
    assert.equal(sheet.data.equationValid, true);
    assert.equal(sheet.data.equity.unclosedProfit, 0, '结转后未结转损益必须为 0');
  });

  test('AA-W3.17 反结转限 ADMIN 且必须留痕', async () => {
    const db = fixture.db;
    postProfitAndCost();
    await fixture.request('POST', '/api/accounting/profit-transfer', fixture.tokens.accounting, { period: PERIOD, reason: '期末结转' });
    const denied = await fixture.request('POST', '/api/accounting/profit-transfer/reverse', fixture.tokens.accounting, { period: PERIOD, reason: '反结转' });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, 'PROFIT_TRANSFER_NOT_ALLOWED');
    const reversed = await fixture.request('POST', '/api/accounting/profit-transfer/reverse', fixture.tokens.admin, { period: PERIOD, reason: '结转有误' });
    assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
    const run = db.prepare('SELECT * FROM profit_transfer_runs WHERE period=?').get(PERIOD);
    assert.equal(run.status, 'REVERSED');
    assert.ok(run.reversed_at, '反结转必须留痕');
    assert.equal(run.reversed_by, 'user-admin');
    const audit = db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='PROFIT_TRANSFER_REVERSE'").get().n;
    assert.equal(audit, 1);
  });
});
