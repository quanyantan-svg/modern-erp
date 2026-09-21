import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const plan = read('src', 'pages', 'material-requirements-plan.jsx');
const runs = read('src', 'pages', 'mrp-runs.jsx');
const css = read('src', 'styles.css');

describe('V1.2 material planning product experience', () => {
  test('material plan has one card architecture and no desktop variant', () => {
    assert.doesNotMatch(plan, /MaterialPlanDesktop|MaterialPlanMobile|material-plan-desktop|material-plan-mobile|<table\b/);
    assert.match(plan, /function MaterialPlanList/);
    assert.match(plan, /className="material-plan-list"/);
    assert.doesNotMatch(css, /\.material-plan-desktop|\.material-plan-mobile/);
  });

  test('run selector, 2-by-2 summary and exact segments follow the canonical order', () => {
    const selector = plan.indexOf('className="material-run-selector"');
    const summary = plan.indexOf('<MaterialSummary', selector);
    assert.ok(selector > 0 && summary > selector, 'run selector must sit directly before the summary');
    assert.match(css, /\.material-summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(plan, /key: 'all', label: '全部'[\s\S]*key: 'make', label: '生产'[\s\S]*key: 'buy', label: '采购'[\s\S]*key: 'shortage', label: '缺料'/);
    assert.match(plan, /<SegmentedControl/);
  });

  test('material cards keep formulas on demand and show only primary facts', () => {
    const card = plan.slice(plan.indexOf('function MaterialCard'), plan.indexOf('function MaterialTraceSheet'));
    for (const label of ['建议数量', '净需求', '现有库存', '查看计算依据']) assert.match(card, new RegExp(label));
    for (const formula of ['销售订单需求', '需求预测', '组件需求', '毛需求', '在途采购', '在途生产']) assert.doesNotMatch(card, new RegExp(formula));
  });

  test('calculation basis opens in a sheet with demand, supply and BOM trace', () => {
    const trace = plan.slice(plan.indexOf('function MaterialTraceSheet'));
    assert.match(trace, /return <Sheet/);
    for (const label of ['销售订单需求', '需求预测', '组件需求', '毛需求', '现有库存', '在途采购', '在途生产', '净需求', 'BOM 追溯', '需求来源']) assert.match(trace, new RegExp(label));
  });

  test('zero-result runs explain the real date inputs and offer a rerun', () => {
    for (const source of [plan, runs]) {
      assert.match(source, /本次计算期间内没有可纳入的需求/);
      assert.match(source, /销售订单是否已审批且提交、审批或创建日期位于计算期间内/);
      assert.match(source, /需求预测需求日期和计算期间/);
      assert.match(source, /重新运行 MRP/);
    }
  });

  test('MRP run page is card-based and completed results expose no delete action', () => {
    assert.match(runs, /<RecordList>/);
    assert.match(runs, /<RecordCard/);
    assert.doesNotMatch(runs, /mrp-run-list-desktop|mrp-run-list-mobile|<table\b/);
    assert.doesNotMatch(runs, /删除.*MRP|delete.*mrp/i);
    assert.match(runs, /run\.status === 'DRAFT'[\s\S]*act\('execute'\)/);
  });
});
