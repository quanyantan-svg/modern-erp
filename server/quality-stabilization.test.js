import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { createTempDb } from './test-utils/temp-db.js';

describe('Quality permissions and V1.3 UI contract', () => {
  test('canonical warehouse/admin permissions remain idempotent and commercial/reviewer roles cannot execute quality', () => {
    const temp = createTempDb({ label: 'quality-permissions', production: true });
    try {
      const permissions = (role) => temp.db.prepare('SELECT permission_code code FROM role_permissions WHERE role_id=?').all(role).map((row) => row.code);
      for (const code of ['IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE']) {
        assert.ok(permissions('role-warehouse').includes(code)); assert.ok(permissions('role-admin').includes(code));
        for (const role of ['role-sales', 'role-reviewer', 'role-accounting']) assert.ok(!permissions(role).includes(code));
      }
    } finally { temp.cleanup(); }
  });

  test('quality UI is source-driven, displays inherited facts, and has no editable price/source party fields', () => {
    const source = readFileSync(resolve('src/pages/quality.jsx'), 'utf8');
    assert.match(source, /请从.*采购入库草稿.*销售出库草稿.*创建检验单/s);
    assert.match(source, /来源明细（只读）/);
    assert.match(source, /历史未关联检验（仅供读取，不能满足质量门禁）/);
    assert.doesNotMatch(source, /LEGACY \/ UNLINKED INSPECTION/);
    assert.match(source, /inspection_quantity/);
    assert.match(source, /defect_reason/);
    assert.match(source, /disposition/);
    assert.doesNotMatch(source, /unit_price|price_cents|commercial_price/);
    assert.doesNotMatch(source, /api\/lookup\/(suppliers|customers)/);
  });

  test('logistics UI exposes quality status and create/reinspection actions without auto-saving before confirmation', () => {
    const source = readFileSync(resolve('src/pages/logistics-finance.jsx'), 'utf8');
    assert.match(source, /创建 IQC/); assert.match(source, /创建 OQC/); assert.match(source, /创建 IQC 复检/); assert.match(source, /创建 OQC 复检/);
    assert.match(source, /质量状态/); assert.match(source, /qualityState/);
    assert.doesNotMatch(source, /if \(action === 'confirm'\) await api\("\/api\/(purchase-receipts|sales-deliveries)/);
  });

  test('IQC/OQC remain outside the five-family Approval Center', () => {
    const source = readFileSync(resolve('server/modules/approvals.js'), 'utf8');
    for (const family of ['SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER']) assert.match(source, new RegExp(family));
    assert.doesNotMatch(source, /IQC|OQC/);
  });
});
