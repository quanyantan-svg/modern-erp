// Accounting & Analytics Domain Closure — AA-W7 经营会计.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.7
// Design:    docs/design/accounting-analytics.md §31.7
//
// Coverage:
//   AA-W7.1..AA-W7.2   经营账簿与经营单元（阿米巴）
//   AA-W7.3..AA-W7.4   经营台账：来源可追溯、只取已过账事实、归集幂等
//   AA-W7.5..AA-W7.6   内部结算价格
//   AA-W7.7..AA-W7.8   费用归集与分摊（可重算一致）
//   AA-W7.9..AA-W7.10  经营损益与法定损益勾稽
//   AA-W7.11..AA-W7.12 经营期间关账与受控反关账

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createAccountingFixture } from './test-support/accounting-http-fixture.js';

const PERIOD = '2027-09';
const PERIOD_DATE = PERIOD + '-15';

let fixture;

before(async () => {
  fixture = await createAccountingFixture('erp-accounting-w7-');
});

after(async () => {
  if (fixture) await fixture.close();
});

/** 写入一张已过账凭证（经营台账与法定损益的事实基础）。 */
function seedPostedVoucher(db, { id, entries }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,period)
    VALUES(?,?,'AA_W7_FIXTURE',?,?,?,'AA-W7 fixture','user-accounting',?,?,'POSTED','MANUAL',?)`)
    .run(id, 'V-' + id, id, PERIOD_DATE, PERIOD_DATE, now, now, PERIOD);
  entries.forEach((entry, index) => {
    const subject = db.prepare('SELECT id FROM accounting_subjects WHERE code=?').get(entry.subjectCode);
    assert.ok(subject, `会计科目 ${entry.subjectCode} 必须存在`);
    db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary,line_no) VALUES(?,?,?,?,?,?,?)')
      .run(`${id}-e${index}`, id, subject.id, entry.direction, entry.amountCents, 'AA-W7 fixture', index + 1);
  });
}

function closeLegalPeriod(db, period) {
  const [year, month] = period.split('-').map(Number);
  db.prepare("INSERT OR REPLACE INTO period_closures(id,period,period_year,period_month,closure_type,status,created_at) VALUES(?,?,?,?,'MONTH','CLOSED',?)")
    .run('aa-w7-legal-' + period, period, year, month, new Date().toISOString());
}

describe('AA-W7 经营会计', () => {
  test('AA-W7.1/2 经营账簿与经营单元是独立实体，重复编码与越权被拒', async () => {
    const book = await fixture.request('POST', '/api/management/books', fixture.tokens.accounting, {
      code: 'MB-CN', name: '中国经营账簿', legalEntity: '现代科技（中国）',
    });
    assert.equal(book.status, 201, JSON.stringify(book.data));
    assert.equal(book.data.managementBook.status, 'OPEN');

    const duplicated = await fixture.request('POST', '/api/management/books', fixture.tokens.accounting, {
      code: 'MB-CN', name: '重复', legalEntity: '现代科技（中国）',
    });
    assert.equal(duplicated.status, 409);

    const center = await fixture.request('POST', '/api/management/profit-centers', fixture.tokens.accounting, {
      code: 'PC-SH', name: '上海经营单元', managementBookId: book.data.managementBook.id, orgUnit: '上海事业部',
    });
    assert.equal(center.status, 201, JSON.stringify(center.data));
    assert.equal(center.data.profitCenter.management_book_id, book.data.managementBook.id);

    const forbidden = await fixture.request('POST', '/api/management/books', fixture.tokens.sales, {
      code: 'MB-SALES', name: '越权', legalEntity: '越权',
    });
    assert.equal(forbidden.status, 403);
  });

  test('AA-W7.3/4 经营台账只取已过账事实，归集幂等且来源可追溯', async () => {
    const book = await fixture.request('POST', '/api/management/books', fixture.tokens.accounting, {
      code: 'MB-LEDGER', name: '台账账簿', legalEntity: '现代科技（中国）',
    });
    const bookId = book.data.managementBook.id;
    const center = await fixture.request('POST', '/api/management/profit-centers', fixture.tokens.accounting, {
      code: 'PC-LEDGER', name: '台账经营单元', managementBookId: bookId,
    });
    const centerId = center.data.profitCenter.id;

    seedPostedVoucher(fixture.db, {
      id: 'aa-w7-v1',
      entries: [
        { subjectCode: '6001', direction: 'DEBIT', amountCents: 100000 },
        { subjectCode: '1405', direction: 'CREDIT', amountCents: 100000 },
      ],
    });
    // 未过账的凭证不得进入经营台账。
    fixture.db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,business_date,remark,creator_id,created_at,updated_at,status,voucher_origin,period)
      VALUES('aa-w7-draft','V-draft','AA_W7_FIXTURE','aa-w7-draft',?,?,'draft','user-accounting',?,?,'ENTERED','MANUAL',?)`)
      .run(PERIOD_DATE, PERIOD_DATE, new Date().toISOString(), new Date().toISOString(), PERIOD);

    const collected = await fixture.request('POST', '/api/management/collect', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, profitCenterId: centerId,
      source: { kind: 'GL', accountCode: '6001' },
    });
    assert.equal(collected.status, 201, JSON.stringify(collected.data));
    const ledger = await fixture.request('GET', `/api/management/ledger?period=${PERIOD}&managementBookId=${bookId}`, fixture.tokens.accounting);
    assert.equal(ledger.status, 200);
    assert.equal(ledger.data.operatingLedgerEntries.length, 1, '只取已过账分录');
    const entry = ledger.data.operatingLedgerEntries[0];
    assert.equal(entry.source_kind, 'GL');
    assert.ok(entry.source_id, '经营台账条目必须可追溯到来源');
    assert.equal(Number(entry.debit_cents), 100000);

    // 幂等：重复归集不得重复入账。
    await fixture.request('POST', '/api/management/collect', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, profitCenterId: centerId,
      source: { kind: 'GL', accountCode: '6001' },
    });
    const again = await fixture.request('GET', `/api/management/ledger?period=${PERIOD}&managementBookId=${bookId}`, fixture.tokens.accounting);
    assert.equal(again.data.operatingLedgerEntries.length, 1, '同一来源事实只允许入账一次');
  });

  test('AA-W7.5 内部结算价格可维护，非法窗口被拒', async () => {
    const created = await fixture.request('POST', '/api/management/internal-prices', fixture.tokens.accounting, {
      productId: 'product-001', priceCents: 12345, validFrom: '2027-01-01', validTo: '2027-12-31',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(Number(created.data.internalSettlementPrice.price_cents), 12345);

    const invalid = await fixture.request('POST', '/api/management/internal-prices', fixture.tokens.accounting, {
      productId: 'product-001', priceCents: 100, validFrom: '2027-12-31', validTo: '2027-01-01',
    });
    assert.equal(invalid.status, 400);
  });

  test('AA-W7.7/8 费用分摊可重算一致，基数缺失时 fail closed', async () => {
    const book = await fixture.request('POST', '/api/management/books', fixture.tokens.accounting, {
      code: 'MB-ALLOC', name: '分摊账簿', legalEntity: '现代科技（中国）',
    });
    const bookId = book.data.managementBook.id;
    const centers = [];
    for (const code of ['PC-A1', 'PC-A2']) {
      const center = await fixture.request('POST', '/api/management/profit-centers', fixture.tokens.accounting, {
        code, name: `经营单元 ${code}`, managementBookId: bookId,
      });
      centers.push(center.data.profitCenter.id);
    }
    seedPostedVoucher(fixture.db, {
      id: 'aa-w7-v2',
      entries: [{ subjectCode: '6401', direction: 'DEBIT', amountCents: 60000 }],
    });
    await fixture.request('POST', '/api/management/collect', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, profitCenterId: centers[0],
      source: { kind: 'GL', accountCode: '6401' },
    });

    const rule = await fixture.request('POST', '/api/management/allocation-rules', fixture.tokens.accounting, {
      code: 'AR-EQUAL', name: '等权分摊', managementBookId: bookId, basisType: 'EQUAL',
      driver: { accountCodes: ['6401'], targets: [{ profitCenterId: centers[0], weight: 1 }, { profitCenterId: centers[1], weight: 1 }] },
    });
    assert.equal(rule.status, 201, JSON.stringify(rule.data));

    const run = await fixture.request('POST', '/api/management/allocation-runs', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, ruleId: rule.data.allocationRule.id,
    });
    assert.equal(run.status, 201, JSON.stringify(run.data));
    assert.equal(run.data.baseCents, 60000);
    const total = run.data.allocationResults.reduce((sum, row) => sum + Number(row.allocated_cents), 0);
    assert.equal(total, 60000, '分摊总额必须等于被分摊的基数');

    // 没有基数时 fail closed。
    const empty = await fixture.request('POST', '/api/management/allocation-runs', fixture.tokens.accounting, {
      managementBookId: bookId, period: '2027-10', ruleId: rule.data.allocationRule.id,
    });
    assert.equal(empty.status, 409);
  });

  test('AA-W7.9/10 经营损益可与法定损益勾稽，差额必须显式列出', async () => {
    const book = await fixture.request('POST', '/api/management/books', fixture.tokens.accounting, {
      code: 'MB-PL', name: '损益账簿', legalEntity: '现代科技（中国）',
    });
    const bookId = book.data.managementBook.id;
    const center = await fixture.request('POST', '/api/management/profit-centers', fixture.tokens.accounting, {
      code: 'PC-PL', name: '损益经营单元', managementBookId: bookId,
    });
    await fixture.request('POST', '/api/management/collect', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, profitCenterId: center.data.profitCenter.id,
      source: { kind: 'GL', accountCode: '6001' },
    });

    const profitLoss = await fixture.request('GET', `/api/management/profit-loss?period=${PERIOD}&managementBookId=${bookId}`, fixture.tokens.accounting);
    assert.equal(profitLoss.status, 200, JSON.stringify(profitLoss.data));
    assert.equal(Number(profitLoss.data.revenueCents), 100000, '经营收入取自已过账事实');
    assert.equal(Number(profitLoss.data.operatingProfitCents), 100000);
    assert.ok(Array.isArray(profitLoss.data.reconciliations), '差额必须显式列出');
    const codes = profitLoss.data.reconciliations.map((row) => row.code);
    for (const expected of ['UNALLOCATED', 'INTERNAL_ELIMINATION', 'SCOPE_DIFFERENCE']) {
      assert.ok(codes.includes(expected), `勾稽必须列出 ${expected}`);
    }
    assert.equal(profitLoss.data.explained, true, '差额必须可解释');
  });

  test('AA-W7.11/12 经营关账要求归集与分摊完成，且法定期间先行', async () => {
    const book = await fixture.request('POST', '/api/management/books', fixture.tokens.accounting, {
      code: 'MB-CLOSE', name: '关账账簿', legalEntity: '现代科技（中国）',
    });
    const bookId = book.data.managementBook.id;
    const center = await fixture.request('POST', '/api/management/profit-centers', fixture.tokens.accounting, {
      code: 'PC-CLOSE', name: '关账经营单元', managementBookId: bookId,
    });
    const centerId = center.data.profitCenter.id;

    // 未归集 → 不得关账。
    const notCollected = await fixture.request('POST', '/api/management/period-closures', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD,
    });
    assert.equal(notCollected.status, 409);
    assert.equal(notCollected.data.code, 'MANAGEMENT_COLLECTION_INCOMPLETE');

    seedPostedVoucher(fixture.db, {
      id: 'aa-w7-v3',
      entries: [{ subjectCode: '6401', direction: 'DEBIT', amountCents: 40000 }],
    });
    await fixture.request('POST', '/api/management/collect', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, profitCenterId: centerId,
      source: { kind: 'GL', accountCode: '6401' },
    });
    const rule = await fixture.request('POST', '/api/management/allocation-rules', fixture.tokens.accounting, {
      code: 'AR-CLOSE', name: '关账分摊', managementBookId: bookId, basisType: 'EQUAL',
      driver: { accountCodes: ['6401'], targets: [{ profitCenterId: centerId, weight: 1 }] },
    });
    await fixture.request('POST', '/api/management/allocation-runs', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD, ruleId: rule.data.allocationRule.id,
    });

    // 法定期间未关闭 → 经营期间不得先关。
    const legalFirst = await fixture.request('POST', '/api/management/period-closures', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD,
    });
    assert.equal(legalFirst.status, 409);
    assert.equal(legalFirst.data.code, 'MANAGEMENT_LEGAL_PERIOD_NOT_CLOSED');

    closeLegalPeriod(fixture.db, PERIOD);
    const closed = await fixture.request('POST', '/api/management/period-closures', fixture.tokens.accounting, {
      managementBookId: bookId, period: PERIOD,
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.operatingPeriodClosure.status, 'CLOSED');

    // 受控反关账：必须给出原因并留痕。
    const noReason = await fixture.request('POST', `/api/management/period-closures/${closed.data.operatingPeriodClosure.id}/reopen`, fixture.tokens.accounting, {});
    assert.equal(noReason.status, 400);
    const reopened = await fixture.request('POST', `/api/management/period-closures/${closed.data.operatingPeriodClosure.id}/reopen`, fixture.tokens.accounting, {
      reason: '补充分摊证据',
    });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
    assert.equal(reopened.data.operatingPeriodClosure.status, 'OPEN');
    assert.equal(reopened.data.operatingPeriodClosure.reopen_reason, '补充分摊证据');
    const audit = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='OPERATING_PERIOD_CLOSURE' AND entity_id=? AND action='REOPEN'")
      .get(closed.data.operatingPeriodClosure.id);
    assert.ok(audit, '反关账必须留痕');
  });
});
