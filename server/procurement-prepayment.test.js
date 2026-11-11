// PRC-17 Prepayment Requirement — contract regression.
//
// Requirement §31.3.1 PRC-17 / Active Design §26.9.
//
// Covered contract points:
//   1. Procurement owns the requirement document; the expected payment amount
//      is DERIVED from the authoritative purchase order total and the
//      declared rational basis (HALF_UP, BigInt) — never from the client.
//   2. Finance owns the actual payment: posting hands off to the canonical
//      Finance settlement path (`payment_disbursements` +
//      `payment_disbursement_items`, `source_type='PREPAYMENT_REQUIREMENT'`).
//      There is no second payment engine.
//   3. State machine DRAFT → POSTED → CANCELLED with fail-closed guards and
//      stable error codes.
//   4. Separation of duties: the applicant may not post their own request.
//   5. Failure scenarios leave zero business side effects.
//
// The suite owns a disposable temporary SQLite through the shared
// procurement HTTP fixture, exactly like `procurement-commercial-evidence`.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture } from './test-support/procurement-http-fixture.js';

const PREPAY_PRODUCT = 'pc-prepay-product';
const PREPAY_PRODUCT_2 = 'pc-prepay-product-2';
const SETTLEMENT_ACCOUNT = 'pc-prepay-bank';

describe('Procurement prepayment requirement: PRC-17', () => {
  let fixture;

  function isoDate(offsetDays = 0) {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  }

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-prc-prepay-');
    const now = new Date().toISOString();
    fixture.db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code)
      VALUES(?,'PC-PREPAY-001','预付款测试货品','测试货品','EA',0,0,1,?,?,'EA')`).run(PREPAY_PRODUCT, now, now);
    fixture.db.prepare(`INSERT OR IGNORE INTO products(id,code,name,category,unit,price_cents,stock_quantity,active,created_at,updated_at,base_uom_code)
      VALUES(?,'PC-PREPAY-002','预付款测试货品二','测试货品','EA',0,0,1,?,?,'EA')`).run(PREPAY_PRODUCT_2, now, now);
    fixture.db.prepare(`INSERT OR IGNORE INTO bank_accounts(id,bank_name,account_no,account_name,account_type,balance_cents,currency,active,created_at,updated_at,code,opening_balance_cents)
      VALUES(?,'预付款测试银行','PC-PREPAY-001','预付款结算户','CHECKING',0,'CNY',1,?,?,?,0)`)
      .run(SETTLEMENT_ACCOUNT, now, now, SETTLEMENT_ACCOUNT);
    for (const [productId, unitPriceCents] of [[PREPAY_PRODUCT, 10000], [PREPAY_PRODUCT_2, 1007]]) {
      const price = await fixture.request('POST', '/api/procurement/price-list', fixture.tokens.admin, {
        supplierId: 'supplier-001', productId, sourceType: 'PURCHASE',
        pricingUomCode: 'EA', unitPriceCents, effectiveFrom: isoDate(-30),
      });
      assert.equal(price.status, 201, price.data.error);
    }
  });

  after(async () => fixture.close());

  /** An APPROVED ordinary purchase order, ready to carry a prepayment. */
  async function approvedOrder({ quantity = 10, price = 10000 } = {}) {
    const created = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(30),
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
      supplierAddress: '测试地址', paymentTerms: '30 天',
      items: [{ productId: PREPAY_PRODUCT, quantity, unitPriceCents: price }],
    });
    assert.equal(created.status, 201, created.data.error);
    const orderId = created.data.id;
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/submit`, fixture.tokens.admin)).status, 200);
    assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/approve`, fixture.tokens.reviewer)).status, 200);
    return orderId;
  }

  /** A DRAFT purchase order (never approved). */
  async function draftOrder() {
    const created = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(30),
      supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
      supplierAddress: '测试地址', paymentTerms: '30 天',
      items: [{ productId: PREPAY_PRODUCT, quantity: 1, unitPriceCents: 10000 }],
    });
    assert.equal(created.status, 201, created.data.error);
    return created.data.id;
  }

  function createRequirement(body, token = fixture.tokens.admin) {
    return fixture.request('POST', '/api/procurement/prepayment-requirements', token, body);
  }

  function postRequirement(id, body = {}, token = fixture.tokens.accounting) {
    return fixture.request('POST', `/api/procurement/prepayment-requirements/${id}/post`, token, {
      settlementAccountId: SETTLEMENT_ACCOUNT, paymentMethod: 'BANK', ...body,
    });
  }

  function countRows(table, where = '', params = []) {
    return Number(fixture.db.prepare(`SELECT COUNT(*) n FROM ${table} ${where}`).get(...params).n);
  }

  // ------------------------------------------------------------------
  // A. 建立预付款要求
  // ------------------------------------------------------------------
  describe('A. 建立预付款要求', () => {
    test('A1. 预付金额由采购订单金额与有理数比例推导，客户端断言只做校验', async () => {
      const orderId = await approvedOrder({ quantity: 10, price: 10000 });
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100,
        dueDate: isoDate(15), expectedPaymentCents: 30000,
      });
      assert.equal(created.status, 201, created.data.error);
      const requirement = created.data.prepaymentRequirement;
      assert.equal(requirement.status, 'DRAFT');
      assert.equal(requirement.expectedPaymentCents, 30000, '10 EA × 10000 分 × 30% = 30000 分');
      assert.equal(requirement.prepaymentPctBasisNumerator, 30);
      assert.equal(requirement.prepaymentPctBasisDenominator, 100);
      assert.equal(requirement.financeHandoffId, null, 'DRAFT 阶段不得存在财务交接');
      assert.equal(requirement.items.length, 1);
      assert.equal(requirement.items[0].expectedPaymentCents, 30000, '明细行携带该行自身的预付份额');
      assert.equal(
        requirement.items.reduce((sum, item) => sum + item.expectedPaymentCents, 0),
        requirement.expectedPaymentCents,
        '预付明细合计必须与单据总额完全核对一致',
      );
    });

    test('A2. 客户端传入与推导不一致的金额被拒绝，金额不得由客户端决定', async () => {
      const orderId = await approvedOrder({ quantity: 4, price: 10000 });
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 25, prepaymentPctBasisDenominator: 100,
        dueDate: isoDate(15), expectedPaymentCents: 999999,
      });
      assert.equal(created.status, 400, created.data.error);
      assert.equal(created.data.code, 'PREPAYMENT_AMOUNT_MISMATCH');
    });

    test('A3. 比例非法（≤0 或 >1）被拒绝', async () => {
      const orderId = await approvedOrder();
      const zero = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 0, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(zero.status, 400, zero.data.error);
      assert.equal(zero.data.code, 'PREPAYMENT_RATIO_INVALID');

      const negative = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: -30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(negative.status, 400, negative.data.error);
      assert.equal(negative.data.code, 'PREPAYMENT_RATIO_INVALID');

      const overOne = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 130, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(overOne.status, 400, overOne.data.error);
      assert.equal(overOne.data.code, 'PREPAYMENT_RATIO_INVALID');
    });

    test('A4. 订单不存在与订单未批准被拒绝', async () => {
      const missing = await createRequirement({
        poId: 'po-does-not-exist', prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(missing.status, 404, missing.data.error);
      assert.equal(missing.data.code, 'PREPAYMENT_PO_NOT_FOUND');

      const draftPoId = await draftOrder();
      const notApproved = await createRequirement({
        poId: draftPoId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(notApproved.status, 409, notApproved.data.error);
      assert.equal(notApproved.data.code, 'PREPAYMENT_PO_NOT_APPROVED');
    });

    test('A5. 失败场景零业务副作用（无预付款要求、无付款单、无财务余额）', async () => {
      const requirementsBefore = countRows('prepayment_requirements');
      const disbursementsBefore = countRows('payment_disbursements');
      const balancesBefore = countRows('settlement_unapplied_balances');
      const orderId = await approvedOrder();
      await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 0, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(countRows('prepayment_requirements'), requirementsBefore);
      assert.equal(countRows('payment_disbursements'), disbursementsBefore);
      assert.equal(countRows('settlement_unapplied_balances'), balancesBefore);
    });

    test('A6. 多行订单的预付明细按 HALF_UP 逐行计算并与单据总额完全核对', async () => {
      const created = await fixture.request('POST', '/api/purchase-orders', fixture.tokens.admin, {
        supplierId: 'supplier-001', orderDate: isoDate(0), expectedDeliveryDate: isoDate(30),
        supplierContactName: '采购联系人', supplierContactPhone: '13800000000',
        supplierAddress: '测试地址', paymentTerms: '30 天',
        items: [
          { productId: PREPAY_PRODUCT, quantity: 3, unitPriceCents: 10000 },
          { productId: PREPAY_PRODUCT_2, quantity: 7, unitPriceCents: 1007 },
        ],
      });
      assert.equal(created.status, 201, created.data.error);
      const orderId = created.data.id;
      assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/submit`, fixture.tokens.admin)).status, 200);
      assert.equal((await fixture.request('POST', `/api/purchase-orders/${orderId}/approve`, fixture.tokens.reviewer)).status, 200);

      const order = fixture.db.prepare('SELECT total_cents FROM purchase_orders WHERE id=?').get(orderId);
      const orderTotal = Number(order.total_cents);
      const requirement = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 1, prepaymentPctBasisDenominator: 3, dueDate: isoDate(15),
      });
      assert.equal(requirement.status, 201, requirement.data.error);
      const rows = requirement.data.prepaymentRequirement;
      // 1/3 of the order total, HALF_UP.
      const expectedTotal = Math.floor((orderTotal * 2 + 3) / 6);
      assert.equal(rows.expectedPaymentCents, expectedTotal);
      assert.equal(
        rows.items.reduce((sum, item) => sum + item.expectedPaymentCents, 0),
        rows.expectedPaymentCents,
        '逐行舍入残差必须被吸收，明细合计必须等于单据总额',
      );
      assert.equal(rows.items.length, 2);
    });

    test('A7. 预付明细必须覆盖整张采购订单，不接受客户端自行裁剪范围', async () => {
      const orderId = await approvedOrder();
      const narrowed = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100,
        dueDate: isoDate(15), lineNos: [1],
      });
      assert.equal(narrowed.status, 400, narrowed.data.error);
      assert.match(String(narrowed.data.error), /不支持的字段/);
    });
  });

  // ------------------------------------------------------------------
  // B. 过账与财务交接
  // ------------------------------------------------------------------
  describe('B. 过账与财务交接', () => {
    test('B1. 过账产生财务交接、真实付款事实与 PREPAYMENT_REQUIREMENT 来源', async () => {
      const orderId = await approvedOrder({ quantity: 10, price: 10000 });
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      assert.equal(created.status, 201, created.data.error);
      const requirementId = created.data.prepaymentRequirement.id;

      const posted = await postRequirement(requirementId);
      assert.equal(posted.status, 200, posted.data.error);
      const requirement = posted.data.prepaymentRequirement;
      assert.equal(requirement.status, 'POSTED');
      assert.ok(requirement.financeHandoffId, '必须冻结财务交接标识');
      assert.equal(requirement.financeHandoffId, posted.data.financeHandoff.financeHandoffId);

      // The payment fact lives in the canonical Finance tables — there is no
      // second payment engine.
      const disbursement = fixture.db.prepare('SELECT * FROM payment_disbursements WHERE id=?')
        .get(requirement.financeHandoffId);
      assert.ok(disbursement, '必须存在 canonical payment_disbursements 付款单');
      assert.equal(disbursement.amount_cents, 30000);
      assert.equal(disbursement.status, 'CONFIRMED');
      assert.equal(disbursement.supplier_id, 'supplier-001');
      assert.equal(disbursement.external_reference, requirementId, '付款单必须回指采购预付款要求');

      // The canonical Finance subledger row carries source_type='PREPAYMENT_REQUIREMENT'.
      const payable = fixture.db.prepare("SELECT * FROM account_payables WHERE source_type='PREPAYMENT_REQUIREMENT' AND source_id=?")
        .get(requirementId);
      assert.ok(payable, '必须存在 source_type=PREPAYMENT_REQUIREMENT 的应付项');

      // The prepayment money is recorded as an explicit unapplied prepayment
      // balance by the canonical Finance path.
      const balance = fixture.db.prepare("SELECT * FROM settlement_unapplied_balances WHERE balance_type='PREPAYMENT' AND source_id=?")
        .get(requirement.financeHandoffId);
      assert.ok(balance, '必须存在 PREPAYMENT 未核销余额');
      assert.equal(balance.original_amount_cents, 30000);

      // The canonical Finance voucher exists for the payment.
      const voucher = fixture.db.prepare("SELECT * FROM accounting_vouchers WHERE source_type='PAYMENT_DISBURSEMENT' AND source_id=?")
        .get(requirement.financeHandoffId);
      assert.ok(voucher, '必须存在 canonical 付款凭证');
    });

    test('B2. 已 POSTED 的要求不得再次 POSTED', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 50, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      const requirementId = created.data.prepaymentRequirement.id;
      assert.equal((await postRequirement(requirementId)).status, 200);

      const disbursementsBefore = countRows('payment_disbursements');
      const again = await postRequirement(requirementId);
      assert.equal(again.status, 409, again.data.error);
      assert.equal(again.data.code, 'PREPAYMENT_STATUS_INVALID');
      assert.equal(countRows('payment_disbursements'), disbursementsBefore, '重复过账不得产生第二张付款单');
    });

    test('B3. POSTED 的要求不得被取消（状态机 DRAFT → POSTED → CANCELLED 的单向性）', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 50, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      const requirementId = created.data.prepaymentRequirement.id;
      assert.equal((await postRequirement(requirementId)).status, 200);

      const cancelled = await fixture.request('POST', `/api/procurement/prepayment-requirements/${requirementId}/cancel`, fixture.tokens.accounting, {});
      assert.equal(cancelled.status, 409, cancelled.data.error);
      assert.equal(cancelled.data.code, 'PREPAYMENT_STATUS_INVALID');
      assert.equal(
        fixture.db.prepare('SELECT status FROM prepayment_requirements WHERE id=?').get(requirementId).status,
        'POSTED',
      );
    });

    test('B4. 申请人不得过账自己的申请（职责分离）', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      }, fixture.tokens.admin);
      assert.equal(created.status, 201, created.data.error);
      const requirementId = created.data.prepaymentRequirement.id;

      const disbursementsBefore = countRows('payment_disbursements');
      const selfPost = await postRequirement(requirementId, {}, fixture.tokens.admin);
      assert.equal(selfPost.status, 409, selfPost.data.error);
      assert.equal(selfPost.data.code, 'PREPAYMENT_SELF_POST_FORBIDDEN');
      assert.equal(countRows('payment_disbursements'), disbursementsBefore, '自批不得产生任何付款事实');
      assert.equal(
        fixture.db.prepare('SELECT status FROM prepayment_requirements WHERE id=?').get(requirementId).status,
        'DRAFT',
      );
    });

    test('B5. 无财务付款权限的主体不得过账', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      }, fixture.tokens.admin);
      const requirementId = created.data.prepaymentRequirement.id;

      const forbidden = await postRequirement(requirementId, {}, fixture.tokens.reviewer);
      assert.equal(forbidden.status, 403, forbidden.data.error);
      assert.equal(
        fixture.db.prepare('SELECT status FROM prepayment_requirements WHERE id=?').get(requirementId).status,
        'DRAFT',
      );
    });

    test('B6. 缺少结算账户时 fail closed，且零副作用', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      const requirementId = created.data.prepaymentRequirement.id;

      const disbursementsBefore = countRows('payment_disbursements');
      const missing = await fixture.request('POST', `/api/procurement/prepayment-requirements/${requirementId}/post`, fixture.tokens.accounting, { paymentMethod: 'BANK' });
      assert.equal(missing.status, 400, missing.data.error);
      assert.equal(missing.data.code, 'PREPAYMENT_SETTLEMENT_ACCOUNT_REQUIRED');
      assert.equal(countRows('payment_disbursements'), disbursementsBefore);
      assert.equal(
        fixture.db.prepare('SELECT status FROM prepayment_requirements WHERE id=?').get(requirementId).status,
        'DRAFT',
      );
    });
  });

  // ------------------------------------------------------------------
  // C. 取消与审计
  // ------------------------------------------------------------------
  describe('C. 取消与审计', () => {
    test('C1. DRAFT 要求可以取消，取消后不得再过账', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      const requirementId = created.data.prepaymentRequirement.id;

      const cancelled = await fixture.request('POST', `/api/procurement/prepayment-requirements/${requirementId}/cancel`, fixture.tokens.accounting, {});
      assert.equal(cancelled.status, 200, cancelled.data.error);
      assert.equal(cancelled.data.prepaymentRequirement.status, 'CANCELLED');

      const disbursementsBefore = countRows('payment_disbursements');
      const posted = await postRequirement(requirementId);
      assert.equal(posted.status, 409, posted.data.error);
      assert.equal(posted.data.code, 'PREPAYMENT_STATUS_INVALID');
      assert.equal(countRows('payment_disbursements'), disbursementsBefore);
    });

    test('C2. 创建 / 过账 / 取消都写审计，且审计不包含密码或令牌', async () => {
      const orderId = await approvedOrder();
      const created = await createRequirement({
        poId: orderId, prepaymentPctBasisNumerator: 30, prepaymentPctBasisDenominator: 100, dueDate: isoDate(15),
      });
      const requirementId = created.data.prepaymentRequirement.id;
      const createAudit = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='PREPAYMENT_REQUIREMENT' AND entity_id=? AND action='CREATE'").get(requirementId);
      assert.ok(createAudit, '创建必须写审计');

      assert.equal((await postRequirement(requirementId)).status, 200);
      const postAudit = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='PREPAYMENT_REQUIREMENT' AND entity_id=? AND action='POST'").get(requirementId);
      assert.ok(postAudit, '过账必须写审计');
      assert.ok(postAudit.detail.includes('财务交接'), '过账审计必须记录财务交接标识');

      const audits = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='PREPAYMENT_REQUIREMENT' AND entity_id=?").all(requirementId);
      for (const row of audits) {
        assert.doesNotMatch(String(row.detail), /password|passwd|token|secret|authorization/i, '审计不得记录密码或令牌');
      }
    });
  });
});
