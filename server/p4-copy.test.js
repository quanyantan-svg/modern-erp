import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUSINESS_CONFLICT_COPY, ROLE_DISPLAY_NAME, safeErrorMessage } from '../src/lib/copy.js';
import { STATUS_LABEL, statusLabel, suggestionTypeLabel, warningLabel } from '../src/lib/status.js';

const source = (path) => readFileSync(resolve(path), 'utf8');

test('P4 — canonical mobile and planning terminology', () => {
  const shell = source('src/components/MobileShell.jsx');
  for (const label of ['消息', '签核', '应用', '云翼', '我的']) assert.match(shell, new RegExp(`label: '${label}'`));
  const app = source('src/App.jsx');
  for (const term of ['计划预测', "label: 'MRP'", 'MRP · 物料建议']) assert.match(app, new RegExp(term));
  const metadata = source('src/navigation/applicationMetadata.js');
  for (const term of ['采购统计分析', '采购未交货', '销售统计分析', '销售未出货', '库存异动明细']) assert.match(metadata, new RegExp(term));
});

test('P4 — five canonical visible role labels', () => {
  // V1.4-C §3 freezes REVIEWER's visible label as 业务审核员 to express
  // the cross-sales/purchase/requisition/stocktake review scope; the
  // backend code role-reviewer is unchanged.
  assert.deepEqual(Object.values(ROLE_DISPLAY_NAME).slice(0, 5), ['系统管理员', '销售人员', '业务审核员', '仓库人员', '财务人员']);
});

test('P4 — centralized status and planning labels never echo raw values', () => {
  assert.equal(STATUS_LABEL.DRAFT, '草稿');
  assert.equal(STATUS_LABEL.SUBMITTED, '待审批');
  assert.equal(STATUS_LABEL.APPROVED, '已审批');
  assert.equal(STATUS_LABEL.COMPLETED, '已完成');
  assert.equal(statusLabel('PENDING', 'production'), '待生产');
  assert.equal(statusLabel('UNKNOWN_VALUE'), '状态待确认');
  assert.equal(suggestionTypeLabel('MAKE'), '生产建议');
  assert.equal(suggestionTypeLabel('BUY'), '采购建议');
  assert.equal(warningLabel('ROUTING_MISSING'), '尚未设置生产工序标准');
});

test('P4 — safe lifecycle and transport messages', () => {
  assert.match(BUSINESS_CONFLICT_COPY.RECORD_REFERENCED, /无法删除该记录/);
  assert.match(BUSINESS_CONFLICT_COPY.DOCUMENT_NOT_DRAFT, /进入业务流程/);
  assert.match(BUSINESS_CONFLICT_COPY.DOCUMENT_HAS_DOWNSTREAM, /后续业务/);
  assert.match(BUSINESS_CONFLICT_COPY.WAREHOUSE_NOT_EMPTY, /仍有库存/);
  assert.equal(safeErrorMessage({ status: 401 }), '登录状态已失效，请重新登录');
  assert.equal(safeErrorMessage({ status: 403 }), '你没有执行此操作的权限');
  assert.equal(safeErrorMessage({ status: 404 }), '内容不存在或已被删除');
  assert.equal(safeErrorMessage({ status: 500, serverMessage: 'SQLITE_CONSTRAINT' }), '暂时无法完成，请稍后重试');
  assert.equal(safeErrorMessage({ network: true }), '网络连接异常，请检查网络后重试');
});

test('P4 — targeted surfaces contain no legacy known-bad copy', () => {
  const files = ['src/App.jsx', 'src/pages/master-data.jsx', 'src/pages/accounting.jsx', 'src/pages/decision-reports.jsx', 'src/pages/planning-documents.jsx'];
  const combined = files.map(source).join('\n');
  for (const legacy of ['云翼服务正在建设', '客户ID', '供应商ID', 'MAKE 建议', 'BUY 建议', '确认计提本月折旧?']) assert.doesNotMatch(combined, new RegExp(legacy));
  assert.doesNotMatch(combined, /window\.confirm|(?<![A-Za-z])confirm\(/);
});
