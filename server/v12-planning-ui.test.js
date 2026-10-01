import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const plan = read('src', 'pages', 'material-requirements-plan.jsx');
const runs = read('src', 'pages', 'mrp-runs.jsx');
const css = read('src', 'styles', 'v16-mrp-planning.css');

describe('V1.6 P5 material planning product experience', () => {
  test('material plan uses one enterprise-row architecture without a desktop variant', () => {
    assert.doesNotMatch(plan, /MaterialPlanDesktop|MaterialPlanMobile|MaterialCard|<table\b|<Panel/);
    assert.match(plan, /function MaterialResultRowV16/);
    assert.match(plan, /className="v16-material-result-row"/);
    assert.match(css, /\.v16-material-result-row\s*\{/);
  });

  test('completed run selector, 2-by-2 summary and exact segments use canonical order', () => {
    const selector = plan.indexOf('v16-material-plan__run');
    const summary = plan.indexOf('<MrpSummaryV16', selector);
    assert.ok(selector > 0 && summary > selector);
    assert.match(css, /\.v16-mrp-summary\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(plan, /value: 'all', label: '全部'[\s\S]*value: 'make', label: '生产'[\s\S]*value: 'buy', label: '采购'[\s\S]*value: 'shortage', label: '缺料'/);
    assert.match(plan, /status=COMPLETED/);
  });

  test('result rows show authoritative primary facts and keep formulas in the sheet', () => {
    const row = plan.slice(plan.indexOf('function MaterialResultRowV16'), plan.indexOf('function traceSources'));
    for (const label of ['建议', '净需求', '库存']) assert.match(row, new RegExp(label));
    for (const formula of ['销售订单需求', '需求预测', '组件需求', '毛需求', '在途采购', '在途生产']) assert.doesNotMatch(row, new RegExp(formula));
  });

  test('calculation basis uses five fixed business sections and honest navigation', () => {
    const trace = plan.slice(plan.indexOf('function MaterialTraceSheetV16'));
    for (const label of ['需求', '可用供应', '净需求', '建议', 'BOM 来源', '前往生产指令', '前往采购指令']) assert.match(trace, new RegExp(label));
    assert.doesNotMatch(trace, /一键创建|创建生产指令|创建采购指令/);
  });

  test('zero and filtered-empty states are short and actionable', () => {
    for (const label of ['本次没有物料需求', '当前期间没有可纳入计算的需求。', '当前筛选没有结果', '查看全部', '前往 MRP']) assert.match(plan, new RegExp(label));
    assert.match(runs, /本次没有物料需求/);
    assert.doesNotMatch(runs, /销售订单是否已审批且提交/);
  });

  test('MRP run uses enterprise rows and full-page detail/editor without Modal or cards', () => {
    assert.match(runs, /function MrpRunListRowV16/);
    assert.match(runs, /function MrpRunEditorV16/);
    assert.match(runs, /function MrpRunDetailV16/);
    assert.doesNotMatch(runs, /<RecordList|<RecordCard|<Modal|<Panel|<BusinessPageHeader/);
    assert.doesNotMatch(runs, /删除.*MRP|delete.*mrp/i);
    assert.match(runs, /run\.status === 'DRAFT'[\s\S]*开始计算/);
  });
});
