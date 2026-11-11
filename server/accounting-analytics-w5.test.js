// Accounting & Analytics Domain Closure — AA-W5 固定资产完整生命周期.
//
// Requirement: docs/requirements/accounting-analytics.md §35.4.5
// Design:    docs/design/accounting-analytics.md §31.5
//
// Coverage:
//   AA-W5.1..AA-W5.3   字典实体、折旧政策实体与卡片生命周期状态
//   AA-W5.4..AA-W5.6   采购转固、来源唯一
//   AA-W5.7..AA-W5.8   受控变更单与生效前不可改写
//   AA-W5.9..AA-W5.10  拆分 / 合并价值守恒
//   AA-W5.11..AA-W5.12 借用与盘点差异
//   AA-W5.13..AA-W5.16 政策驱动折旧、凭证、幂等与 GL 对账
//   AA-W5.17..AA-W5.18 受控处置与处置损益
//   §35.5.2 / §35.5.3  职责分离与后端 fail closed

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createAccountingFixture } from './test-support/accounting-http-fixture.js';

const RECEIPT_DATE = '2027-01-15';
const RECEIPT_AMOUNT_CENTS = 120000;

let fixture;

function seedReceipt(db, { receiptId = 'w5-receipt-1', itemId = 'w5-receipt-item-1', amountCents = RECEIPT_AMOUNT_CENTS } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
     VALUES(?,?,NULL,'supplier-001','warehouse-001','user-warehouse',?,'CONFIRMED',?,'','user-warehouse',?,?,?,?)`,
  ).run(receiptId, 'RCPT-W5-1', amountCents, RECEIPT_DATE, now, now, now, 'user-warehouse');
  db.prepare(
    `INSERT OR REPLACE INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no)
     VALUES(?,?,'product-001',1,?,?,1)`,
  ).run(itemId, receiptId, amountCents, amountCents);
  return { receiptId, itemId };
}

async function createPolicy(token, overrides = {}) {
  const result = await fixture.request('POST', '/api/depreciation-policies', token, {
    code: overrides.code || 'POL-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    name: '直线折旧政策',
    method: overrides.method || 'STRAIGHT_LINE',
    useful_life_months: overrides.useful_life_months || 60,
    residual_rate_bp: overrides.residual_rate_bp || 0,
    start_rule: overrides.start_rule || 'FROM_PURCHASE',
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.id;
}

async function transferCard(token, { policyId, receiptId = 'w5-receipt-1', itemId = 'w5-receipt-item-1', assetCode = 'FA-W5-001' } = {}) {
  const result = await fixture.request('POST', '/api/fixed-assets/transfer', token, {
    receipt_id: receiptId,
    lines: [{ item_id: itemId, asset_code: assetCode, asset_name: '测试设备', policy_id: policyId }],
  });
  return result;
}

function subjectBalance(db, code, period) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_cents ELSE -e.amount_cents END),0) n
     FROM accounting_entries e JOIN accounting_vouchers v ON v.id=e.voucher_id
     JOIN accounting_subjects s ON s.id=e.subject_id
     WHERE s.code=? AND v.status='POSTED' AND v.period=?`,
  ).get(code, period);
  return Number(row.n);
}

before(async () => {
  fixture = await createAccountingFixture('erp-accounting-w5-');
});

after(async () => {
  if (fixture) await fixture.close();
});

beforeEach(() => {
  const db = fixture.db;
  db.exec(`DELETE FROM asset_depreciations;
    DELETE FROM asset_depreciation_runs;
    DELETE FROM asset_disposals;
    DELETE FROM asset_stocktake_items;
    DELETE FROM asset_stocktakes;
    DELETE FROM asset_loans;
    DELETE FROM asset_split_merge_records;
    DELETE FROM asset_change_requests;
    DELETE FROM fixed_assets;
    DELETE FROM accounting_entries;
    DELETE FROM accounting_vouchers;
    DELETE FROM purchase_receipt_items;
    DELETE FROM purchase_receipts;`);
  // The disposal approver is an ADMIN capability by default. The fixture grants
  // it to the accounting role as well so the SOD contract can be exercised with
  // two different principals.
  db.prepare("INSERT OR IGNORE INTO role_permissions(role_id,permission_code) VALUES('role-accounting','FIXED_ASSET_DISPOSE')").run();
});

// ---------------------------------------------------------------------------
// AA-W5.1 / AA-W5.2 — 字典与折旧政策实体
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 字典与折旧政策', () => {
  test('资产类别、资产位置与折旧政策是独立实体，卡片引用而非内嵌文本', async () => {
    const type = await fixture.request('POST', '/api/fixed-asset-types', fixture.tokens.accounting, {
      code: 'EQ', name: '设备',
    });
    assert.equal(type.status, 201);
    const location = await fixture.request('POST', '/api/fixed-asset-locations', fixture.tokens.accounting, {
      code: 'WH-A', name: 'A 厂房',
    });
    assert.equal(location.status, 201);

    const policyId = await createPolicy(fixture.tokens.accounting, { code: 'POL-EQ', useful_life_months: 60 });

    const policies = await fixture.request('GET', '/api/depreciation-policies', fixture.tokens.accounting);
    assert.equal(policies.status, 200);
    assert.equal(policies.data.policies.length, 1);
    assert.equal(policies.data.policies[0].useful_life_months, 60);
    assert.equal(policies.data.policies[0].method, 'STRAIGHT_LINE');

    const card = await fixture.request('POST', '/api/fixed-assets', fixture.tokens.accounting, {
      asset_code: 'FA-DICT-1',
      asset_name: '字典引用卡片',
      asset_type_id: type.data.id,
      location_id: location.data.id,
      policy_id: policyId,
      original_value_cents: 60000,
    });
    assert.equal(card.status, 201);

    const row = fixture.db.prepare('SELECT asset_type_id,location_id,policy_id FROM fixed_assets WHERE id=?').get(card.data.id);
    assert.equal(row.asset_type_id, type.data.id);
    assert.equal(row.location_id, location.data.id);
    assert.equal(row.policy_id, policyId);
  });

  test('权限不足时后端 fail closed', async () => {
    const result = await fixture.request('POST', '/api/depreciation-policies', fixture.tokens.sales, {
      code: 'POL-X', name: '越权', method: 'STRAIGHT_LINE', useful_life_months: 12, residual_rate_bp: 0, start_rule: 'FROM_PURCHASE',
    });
    assert.equal(result.status, 403);
  });
});

// ---------------------------------------------------------------------------
// AA-W5.4 .. AA-W5.6 — 采购转固
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 采购转固', () => {
  test('转固金额取自采购收货单并绑定来源，同一来源不得重复转固', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);

    const first = await transferCard(fixture.tokens.accounting, { policyId });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(first.data.assets.length, 1);

    const card = db.prepare('SELECT * FROM fixed_assets WHERE id=?').get(first.data.assets[0].id);
    assert.equal(card.source_type, 'PURCHASE_RECEIPT');
    assert.equal(card.source_id, 'w5-receipt-1');
    assert.equal(card.original_value_cents, RECEIPT_AMOUNT_CENTS);
    assert.equal(card.card_status, 'ACTIVE');
    assert.equal(card.activated_at !== null, true);

    const second = await transferCard(fixture.tokens.accounting, { policyId, assetCode: 'FA-W5-002' });
    assert.equal(second.status, 409);
    assert.equal(second.data.code, 'FIXED_ASSET_ALREADY_TRANSFERRED');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fixed_assets').get().n, 1);
  });

  test('转固不允许调用方提供金额', async () => {
    seedReceipt(fixture.db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const result = await fixture.request('POST', '/api/fixed-assets/transfer', fixture.tokens.accounting, {
      receipt_id: 'w5-receipt-1',
      lines: [{ item_id: 'w5-receipt-item-1', asset_code: 'FA-W5-003', asset_name: '设备', policy_id: policyId, amount_cents: 1 }],
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, 'FIXED_ASSET_TRANSFER_AMOUNT_NOT_ALLOWED');
  });

  test('只有已确认的采购收货单可以转固', async () => {
    const db = fixture.db;
    seedReceipt(db);
    db.prepare("UPDATE purchase_receipts SET status='DRAFT' WHERE id='w5-receipt-1'").run();
    const policyId = await createPolicy(fixture.tokens.accounting);
    const result = await transferCard(fixture.tokens.accounting, { policyId });
    assert.equal(result.status, 409);
    assert.equal(result.data.code, 'PURCHASE_RECEIPT_NOT_CONFIRMED');
  });
});

// ---------------------------------------------------------------------------
// AA-W5.13 .. AA-W5.16 — 政策驱动折旧
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 自动折旧计提', () => {
  test('按期间自动计提、生成凭证并与 GL 累计折旧科目对账，且同期间幂等', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting, { useful_life_months: 60 });
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    assert.equal(card.status, 201);

    const monthly = Math.floor(RECEIPT_AMOUNT_CENTS / 60);
    const run = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-01' });
    assert.equal(run.status, 201, JSON.stringify(run.data));
    assert.equal(run.data.run.total_cents, monthly);
    assert.equal(run.data.depreciations.length, 1);

    const assetRow = db.prepare('SELECT accumulated_depreciation_cents, net_value_cents, book_value_cents FROM fixed_assets WHERE id=?').get(card.data.assets[0].id);
    assert.equal(assetRow.accumulated_depreciation_cents, monthly);
    assert.equal(assetRow.net_value_cents, RECEIPT_AMOUNT_CENTS - monthly);
    assert.equal(assetRow.book_value_cents, RECEIPT_AMOUNT_CENTS - monthly);

    // GL reconciliation: 借 折旧费用 / 贷 累计折旧
    assert.equal(subjectBalance(db, '6602', '2027-01'), monthly);
    assert.equal(subjectBalance(db, '1602', '2027-01'), -monthly);

    const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='FIXED_ASSET_DEPRECIATION_RUN' AND source_id=?").get(run.data.id);
    assert.ok(voucher, '折旧必须生成系统凭证');
    assert.equal(voucher.status, 'POSTED');

    // Idempotency: the same period must not book twice.
    const again = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-01' });
    assert.equal(again.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM asset_depreciations').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_vouchers').get().n, 1);

    // The next period books the next month only.
    const february = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-02' });
    assert.equal(february.status, 201);
    assert.equal(february.data.run.total_cents, monthly);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM asset_depreciations').get().n, 2);
  });

  test('手工折旧录入受控：超过剩余可折旧金额被拒绝', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting, { useful_life_months: 60 });
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;

    const tooMuch = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, {
      asset_id: assetId,
      depreciation_amount: RECEIPT_AMOUNT_CENTS / 100 + 1,
      reason: '越界测试',
    });
    assert.equal(tooMuch.status, 409);
    assert.equal(tooMuch.data.code, 'FIXED_ASSET_DEPRECIATION_EXCEEDS_REMAINING');

    const accepted = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, {
      asset_id: assetId,
      depreciation_amount: 100,
      reason: '历史数据校正',
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    const row = db.prepare('SELECT depreciation_type, period, remark FROM asset_depreciations WHERE id=?').get(accepted.data.id);
    assert.equal(row.depreciation_type, 'ADJUSTMENT');
    assert.equal(row.period, null);
  });
});

// ---------------------------------------------------------------------------
// AA-W5.7 / AA-W5.8 — 受控变更单
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 受控变更单', () => {
  test('变更未生效前资产当前值不得被改写，审核人不得是制单人', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;

    const request = await fixture.request('POST', `/api/fixed-assets/${assetId}/change-requests`, fixture.tokens.accounting, {
      change_type: 'VALUE',
      original_value_cents: RECEIPT_AMOUNT_CENTS + 10000,
      reason: '评估增值',
    });
    assert.equal(request.status, 201);

    const before = db.prepare('SELECT original_value_cents FROM fixed_assets WHERE id=?').get(assetId);
    assert.equal(before.original_value_cents, RECEIPT_AMOUNT_CENTS);

    await fixture.request('POST', `/api/fixed-assets/change-requests/${request.data.id}/submit`, fixture.tokens.accounting);

    const selfApprove = await fixture.request('POST', `/api/fixed-assets/change-requests/${request.data.id}/approve`, fixture.tokens.accounting, { action: 'APPROVE' });
    assert.equal(selfApprove.status, 409);
    assert.equal(selfApprove.data.code, 'FIXED_ASSET_CHANGE_SOD_VIOLATION');

    const approve = await fixture.request('POST', `/api/fixed-assets/change-requests/${request.data.id}/approve`, fixture.tokens.admin, { action: 'APPROVE' });
    assert.equal(approve.status, 200, JSON.stringify(approve.data));

    const after = db.prepare('SELECT original_value_cents, card_status FROM fixed_assets WHERE id=?').get(assetId);
    assert.equal(after.original_value_cents, RECEIPT_AMOUNT_CENTS + 10000);
    assert.equal(after.card_status, 'ACTIVE');
  });

  test('已计提折旧的资产不得直接改原值', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;
    await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-01' });

    const direct = await fixture.request('PATCH', `/api/fixed-assets/${assetId}`, fixture.tokens.accounting, {
      original_value_cents: 999999,
    });
    assert.equal(direct.status, 409);
    assert.equal(direct.data.code, 'FIXED_ASSET_CHANGE_REQUIRES_REQUEST');
  });
});

// ---------------------------------------------------------------------------
// AA-W5.9 / AA-W5.10 — 拆分 / 合并价值守恒
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 拆分与合并', () => {
  test('拆分必须价值守恒，累计折旧按原值比例结转', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting, { useful_life_months: 60 });
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;
    await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-01' });
    const monthly = Math.floor(RECEIPT_AMOUNT_CENTS / 60);

    const unbalanced = await fixture.request('POST', `/api/fixed-assets/${assetId}/split`, fixture.tokens.accounting, {
      reason: '不守恒测试',
      targets: [
        { asset_code: 'FA-SPLIT-1', asset_name: '拆分一', original_value_cents: 60000 },
        { asset_code: 'FA-SPLIT-2', asset_name: '拆分二', original_value_cents: 50000 },
      ],
    });
    assert.equal(unbalanced.status, 409);
    assert.equal(unbalanced.data.code, 'FIXED_ASSET_VALUE_NOT_BALANCED');

    const split = await fixture.request('POST', `/api/fixed-assets/${assetId}/split`, fixture.tokens.accounting, {
      reason: '按台账拆分',
      targets: [
        { asset_code: 'FA-SPLIT-1', asset_name: '拆分一', original_value_cents: 60000 },
        { asset_code: 'FA-SPLIT-2', asset_name: '拆分二', original_value_cents: 60000 },
      ],
    });
    assert.equal(split.status, 201, JSON.stringify(split.data));

    const rows = db.prepare('SELECT asset_code,original_value_cents,accumulated_depreciation_cents FROM fixed_assets WHERE id<>? ORDER BY asset_code').all('w5-no-such');
    const totalOriginal = rows.reduce((sum, row) => sum + row.original_value_cents, 0);
    const totalAccumulated = rows.reduce((sum, row) => sum + row.accumulated_depreciation_cents, 0);
    assert.equal(totalOriginal, RECEIPT_AMOUNT_CENTS);
    assert.equal(totalAccumulated, monthly);
  });

  test('合并后原值等于合并前合计', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;

    const split = await fixture.request('POST', `/api/fixed-assets/${assetId}/split`, fixture.tokens.accounting, {
      reason: '先拆分',
      targets: [
        { asset_code: 'FA-MERGE-1', asset_name: '合并一', original_value_cents: 50000 },
        { asset_code: 'FA-MERGE-2', asset_name: '合并二', original_value_cents: 70000 },
      ],
    });
    assert.equal(split.status, 201, JSON.stringify(split.data));

    const target = db.prepare("SELECT id FROM fixed_assets WHERE asset_code='FA-MERGE-1'").get();
    const source = db.prepare("SELECT id FROM fixed_assets WHERE asset_code='FA-MERGE-2'").get();
    const merged = await fixture.request('POST', '/api/fixed-assets/merge', fixture.tokens.accounting, {
      target_asset_id: target.id,
      asset_ids: [source.id],
      reason: '合并回一张卡片',
    });
    assert.equal(merged.status, 201, JSON.stringify(merged.data));

    const row = db.prepare('SELECT original_value_cents FROM fixed_assets WHERE id=?').get(target.id);
    assert.equal(row.original_value_cents, RECEIPT_AMOUNT_CENTS);
    const closed = db.prepare('SELECT original_value_cents, card_status FROM fixed_assets WHERE id=?').get(source.id);
    assert.equal(closed.original_value_cents, 0);
    assert.equal(closed.card_status, 'IDLE');
  });
});

// ---------------------------------------------------------------------------
// AA-W5.11 / AA-W5.12 — 借用与盘点
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 借用与盘点', () => {
  test('借用登记与归还受控，未归还时不得重复借出', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;

    const loan = await fixture.request('POST', `/api/fixed-assets/${assetId}/loans`, fixture.tokens.accounting, {
      borrower_user_id: 'user-sales',
      due_at: '2027-03-01',
    });
    assert.equal(loan.status, 201);

    const duplicate = await fixture.request('POST', `/api/fixed-assets/${assetId}/loans`, fixture.tokens.accounting, {
      borrower_user_id: 'user-sales',
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.code, 'FIXED_ASSET_LOAN_OPEN');

    const returned = await fixture.request('POST', `/api/fixed-assets/loans/${loan.data.id}/return`, fixture.tokens.accounting, {});
    assert.equal(returned.status, 200);
    assert.equal(db.prepare('SELECT status FROM asset_loans WHERE id=?').get(loan.data.id).status, 'RETURNED');
  });

  test('盘点差异被记录但不得改写资产原值或累计折旧', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;

    const stocktake = await fixture.request('POST', '/api/fixed-assets/stocktakes', fixture.tokens.accounting, {
      period: '2027-01',
      items: [{ asset_id: assetId }],
    });
    assert.equal(stocktake.status, 201);

    const completed = await fixture.request('POST', `/api/fixed-assets/stocktakes/${stocktake.data.id}/complete`, fixture.tokens.accounting, {
      items: [{ id: db.prepare('SELECT id FROM asset_stocktake_items WHERE stocktake_id=?').get(stocktake.data.id).id, actual_location_id: null }],
    });
    assert.equal(completed.status, 200, JSON.stringify(completed.data));
    assert.equal(completed.data.differences.length, 1);
    assert.equal(completed.data.differences[0].difference_type, 'MISSING');

    const row = db.prepare('SELECT original_value_cents, accumulated_depreciation_cents FROM fixed_assets WHERE id=?').get(assetId);
    assert.equal(row.original_value_cents, RECEIPT_AMOUNT_CENTS);
    assert.equal(row.accumulated_depreciation_cents, 0);
  });
});

// ---------------------------------------------------------------------------
// AA-W5.17 / AA-W5.18 — 受控处置
// ---------------------------------------------------------------------------

describe('AA-W5 固定资产 · 处置', () => {
  test('处置生成凭证并结转处置损益，审核人不得是制单人', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;
    await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-01' });
    const monthly = Math.floor(RECEIPT_AMOUNT_CENTS / 60);

    const created = await fixture.request('POST', `/api/fixed-assets/${assetId}/disposals`, fixture.tokens.accounting, {
      disposal_type: 'SCRAP',
      disposal_date: '2027-02-01',
      reason: '设备报废',
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(db.prepare('SELECT card_status FROM fixed_assets WHERE id=?').get(assetId).card_status, 'DISPOSING');

    await fixture.request('POST', `/api/fixed-assets/disposals/${created.data.id}/submit`, fixture.tokens.accounting);
    const selfApprove = await fixture.request('POST', `/api/fixed-assets/disposals/${created.data.id}/approve`, fixture.tokens.accounting, {});
    assert.equal(selfApprove.status, 409);
    assert.equal(selfApprove.data.code, 'FIXED_ASSET_DISPOSAL_SOD_VIOLATION');

    const approved = await fixture.request('POST', `/api/fixed-assets/disposals/${created.data.id}/approve`, fixture.tokens.admin, {});
    assert.equal(approved.status, 200, JSON.stringify(approved.data));

    const disposed = db.prepare('SELECT card_status, original_value_cents FROM fixed_assets WHERE id=?').get(assetId);
    assert.equal(disposed.card_status, 'DISPOSED');
    assert.equal(disposed.original_value_cents, 0);

    const voucher = db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='FIXED_ASSET_DISPOSAL' AND source_id=?").get(created.data.id);
    assert.ok(voucher, '处置必须生成凭证');
    assert.equal(voucher.status, 'POSTED');
    // 贷 固定资产原值；借 累计折旧 + 处置损失
    assert.equal(subjectBalance(db, '1601', '2027-02'), -RECEIPT_AMOUNT_CENTS);
    assert.equal(subjectBalance(db, '1602', '2027-02'), monthly);
    assert.equal(subjectBalance(db, '6603', '2027-02'), RECEIPT_AMOUNT_CENTS - monthly);
  });

  test('已处置资产不得再计提折旧', async () => {
    const db = fixture.db;
    seedReceipt(db);
    const policyId = await createPolicy(fixture.tokens.accounting);
    const card = await transferCard(fixture.tokens.accounting, { policyId });
    const assetId = card.data.assets[0].id;

    const created = await fixture.request('POST', `/api/fixed-assets/${assetId}/disposals`, fixture.tokens.accounting, {
      disposal_type: 'SCRAP',
      disposal_date: '2027-02-01',
      reason: '设备报废',
    });
    await fixture.request('POST', `/api/fixed-assets/disposals/${created.data.id}/submit`, fixture.tokens.accounting);
    await fixture.request('POST', `/api/fixed-assets/disposals/${created.data.id}/approve`, fixture.tokens.admin, {});

    const depreciate = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, { period: '2027-03' });
    assert.equal(depreciate.status, 201);
    assert.equal(depreciate.data.run.total_cents, 0);

    const manual = await fixture.request('POST', '/api/fixed-assets/depreciation', fixture.tokens.accounting, {
      asset_id: assetId,
      depreciation_amount: 10,
      reason: '处置后调整',
    });
    assert.equal(manual.status, 409);
    assert.equal(manual.data.code, 'FIXED_ASSET_DISPOSED');
  });
});
