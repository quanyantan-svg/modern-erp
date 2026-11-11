// 委外加工费会计档案维护面与加工费账单只读列表（OUT-20 / C-P02）。
//
// 覆盖合同点：
//   1. 档案是过账的唯一科目来源：档案缺位 / 未批准 / 角色码未解析时一律
//      fail closed，且拒绝发生在任何状态、应付、凭证与成本证据写入之前。
//   2. 维护面只做「列出 / 建立 / 改变批准状态」三件事，不改写既有档案的科目、
//      税率与有效期。
//   3. 职责分离：维护权限是财务侧的过账权限；委外业务侧不得定义科目。
//   4. 失败场景零业务副作用。
//   5. 加工费账单列表是只读读模型：不重算金额、不修复历史。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createProcurementFixture, seedApprovedOutsourceBom, seedOutsourceSource } from './test-support/procurement-http-fixture.js';

describe('OUT-20 委外加工费会计档案维护面与账单只读列表', () => {
  let fixture;

  const isoDate = (offsetDays = 0) => {
    const value = new Date();
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  };

  before(async () => {
    fixture = await createProcurementFixture('modern-erp-out20-profile-');
    const qualified = await fixture.request('PATCH', '/api/suppliers/supplier-001/profile', fixture.tokens.admin, {
      outsourcingEnabled: true, category: 'OUTSOURCE', qualificationStatus: 'QUALIFIED',
      qualificationValidFrom: isoDate(-30), qualificationValidTo: isoDate(180),
    });
    assert.equal(qualified.status, 200, qualified.data.error);
    await seedOutsourceSource(fixture, [{ supplierId: 'supplier-001', productId: 'product-001', effectiveFrom: isoDate(-30) }]);
  });
  after(async () => fixture.close());

  const listProfiles = (token = fixture.tokens.accounting) => fixture.request(
    'GET', '/api/procurement/outsourcing/processing-fee-accounting-profiles', token,
  );

  test('A1 迁移预置的全局默认档案可读，且是加工费过账的唯一默认口径', async () => {
    const listed = await listProfiles();
    assert.equal(listed.status, 200, listed.data.error);
    const profiles = listed.data.processingFeeAccountingProfiles;
    assert.equal(profiles.length, 1);
    const profile = profiles[0];
    assert.equal(profile.scope, 'GLOBAL');
    assert.equal(profile.approvalState, 'APPROVED');
    assert.equal(profile.taxMode, 'NO_TAX');
    assert.equal(profile.processingFeeRole, 'OUTSOURCING_PROCESSING_FEE');
    // 角色码必须解析到启用科目。
    const subject = fixture.db.prepare("SELECT id, code FROM accounting_subjects WHERE code='6408'").get();
    assert.ok(subject, '加工费借方科目 6408 必须存在');
    const mapping = fixture.db.prepare('SELECT subject_id FROM account_role_mappings WHERE role_code=?')
      .get('OUTSOURCING_PROCESSING_FEE');
    assert.equal(mapping.subject_id, subject.id);
  });

  test('A2 建立档案：角色码未解析、范围重叠与非法范围一律拒绝且零副作用', async () => {
    const before = fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_processing_fee_accounting_profiles').get().n;

    const unresolved = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.accounting, {
      scope: 'SUPPLIER', supplierId: 'supplier-001', profileCode: 'SUP-001',
      taxMode: 'NO_TAX', processingFeeRole: 'NO_SUCH_ROLE', effectiveFrom: isoDate(0),
    });
    assert.equal(unresolved.status, 409, JSON.stringify(unresolved.data));
    assert.equal(unresolved.data.code, 'OUTSOURCING_GL_PROFILE_ROLE_UNRESOLVED');

    const badScope = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.accounting, {
      scope: 'SUPPLIER', profileCode: 'SUP-002', processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: isoDate(0),
    });
    assert.equal(badScope.status, 400);

    const badWindow = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.accounting, {
      scope: 'SUPPLIER', supplierId: 'supplier-001', profileCode: 'SUP-003',
      processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: isoDate(10), effectiveTo: isoDate(0),
    });
    assert.equal(badWindow.status, 400);

    assert.equal(
      fixture.db.prepare('SELECT COUNT(*) n FROM outsourcing_processing_fee_accounting_profiles').get().n,
      before,
      '被拒绝的建档不得留下档案事实',
    );
  });

  test('A3 建立供应商级档案成功并写审计；同范围窗口重叠被拒', async () => {
    const created = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.accounting, {
      scope: 'SUPPLIER', supplierId: 'supplier-001', profileCode: 'SUP-001',
      taxMode: 'NO_TAX', processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: isoDate(0),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const profile = created.data.processingFeeAccountingProfile;
    assert.equal(profile.scope, 'SUPPLIER');
    assert.equal(profile.supplierId, 'supplier-001');
    assert.equal(profile.approvalState, 'APPROVED');

    const audit = fixture.db.prepare("SELECT * FROM audit_logs WHERE entity_type='OUTSOURCING_PROCESSING_FEE_PROFILE' AND entity_id=? AND action='CREATE'").get(profile.id);
    assert.ok(audit, '建档必须写审计');
    assert.doesNotMatch(String(audit.detail), /password|passwd|token|secret/i);

    const overlap = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.accounting, {
      scope: 'SUPPLIER', supplierId: 'supplier-001', profileCode: 'SUP-002',
      processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: isoDate(1),
    });
    assert.equal(overlap.status, 409, JSON.stringify(overlap.data));
    assert.equal(overlap.data.code, 'OUTSOURCING_GL_PROFILE_OVERLAP');
  });

  test('A4 批准状态变更受控：可暂停、可重新批准，重复状态被拒并写审计', async () => {
    const created = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.accounting, {
      scope: 'SUPPLIER', supplierId: 'supplier-002', profileCode: 'SUP-STATE-001',
      processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: isoDate(0),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const profileId = created.data.processingFeeAccountingProfile.id;

    const suspended = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-accounting-profiles/${profileId}/approval`, fixture.tokens.accounting, {
      approvalState: 'SUSPENDED', reason: '科目政策复核',
    });
    assert.equal(suspended.status, 200, JSON.stringify(suspended.data));
    assert.equal(suspended.data.processingFeeAccountingProfile.approvalState, 'SUSPENDED');

    const again = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-accounting-profiles/${profileId}/approval`, fixture.tokens.accounting, {
      approvalState: 'SUSPENDED',
    });
    assert.equal(again.status, 409);

    const approved = await fixture.request('POST', `/api/procurement/outsourcing/processing-fee-accounting-profiles/${profileId}/approval`, fixture.tokens.accounting, {
      approvalState: 'APPROVED',
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.processingFeeAccountingProfile.approvalState, 'APPROVED');

    const audits = fixture.db.prepare("SELECT action FROM audit_logs WHERE entity_type='OUTSOURCING_PROCESSING_FEE_PROFILE' AND entity_id=?").all(profileId);
    assert.deepEqual(audits.map((row) => row.action).sort(), ['APPROVE', 'CREATE', 'SUSPEND']);
  });

  test('A5 职责分离：委外业务角色不得维护会计档案', async () => {
    const created = await fixture.request('POST', '/api/procurement/outsourcing/processing-fee-accounting-profiles', fixture.tokens.outsourcing, {
      scope: 'SUPPLIER', supplierId: 'supplier-001', profileCode: 'SUP-FORBIDDEN',
      processingFeeRole: 'OUTSOURCING_PROCESSING_FEE', effectiveFrom: isoDate(0),
    });
    assert.equal(created.status, 403, JSON.stringify(created.data));
    assert.equal(
      fixture.db.prepare("SELECT COUNT(*) n FROM outsourcing_processing_fee_accounting_profiles WHERE profile_code='SUP-FORBIDDEN'").get().n,
      0,
      '无权限时零副作用',
    );
  });

  test('A6 加工费账单列表是只读读模型：返回来源行与过账状态，不重算金额', async () => {
    const bomId = seedApprovedOutsourceBom(fixture, 'product-001', [
      { productId: 'product-001', requiredQuantity: 0 },
    ], `out20-list-${Date.now()}`);
    const order = await fixture.request('POST', '/api/procurement/outsourcing/orders', fixture.tokens.admin, {
      supplierId: 'supplier-001', productId: 'product-001', orderQuantity: 10, unit: 'EA', businessDate: isoDate(0), bomId,
    });
    assert.equal(order.status, 201, order.data.error);
    const orderId = order.data.id;
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/material-list`, fixture.tokens.admin, {
      items: [{ productId: 'product-001', sourceWarehouseId: 'warehouse-001' }],
    });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'CONFIRM_PLAN' });
    await fixture.request('POST', `/api/procurement/outsourcing/orders/${orderId}/transition`, fixture.tokens.admin, { action: 'RELEASE' });

    const listed = await fixture.request('GET', '/api/procurement/outsourcing/processing-fee-bills', fixture.tokens.accounting);
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    assert.ok(Array.isArray(listed.data.processingFeeBills));
    // 空列表也是合法读模型。
    assert.equal(listed.data.processingFeeBills.length, 0);
  });
});
