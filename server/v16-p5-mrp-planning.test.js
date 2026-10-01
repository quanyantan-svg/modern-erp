import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runs = read('src/pages/mrp-runs.jsx');
const plan = read('src/pages/material-requirements-plan.jsx');
const status = read('src/lib/status.js');
const css = read('src/styles/v16-mrp-planning.css');
const main = read('src/main.jsx');

test('P5 keeps implementation inside the dedicated frontend surface', () => {
  assert.match(main, /import '\.\/styles\/v16-mrp-planning\.css'/);
  assert.match(css, /--mrp-accent: var\(--v16-module-production/);
  assert.doesNotMatch(runs, /<Modal|<Panel|<RecordCard|<BusinessPageHeader/);
  assert.doesNotMatch(plan, /<Panel|MaterialCard|<table\b/);
});

test('P5 status and combined-demand language match the frozen contract', () => {
  assert.match(status, /COMPLETED: '已计算'/);
  assert.match(status, /销售订单会消费同期预测，重叠需求不会重复计算/);
  assert.doesNotMatch(status, /销售订单需求与预测需求将叠加计算/);
  for (const label of ['全部', '草稿', '已计算', '已取消']) assert.match(runs, new RegExp(label));
});

test('P5 list search is local and all list states are explicit', () => {
  assert.match(runs, /\[row\.run_code, row\.run_name\]/);
  assert.match(runs, /搜索运算号或名称/);
  for (const label of ['加载失败', '暂无 MRP 运算', '没有匹配结果', '清除筛选']) assert.match(runs, new RegExp(label));
  assert.match(runs, /aria-label="新建 MRP 运算"/);
});

test('P5 editor supports POST and PATCH while completed history remains outside it', () => {
  assert.match(runs, /method: runId \? 'PATCH' : 'POST'/);
  assert.match(runs, /runResult\.run\.status !== 'DRAFT'/);
  assert.match(runs, /保存草稿/);
  assert.doesNotMatch(runs, /保存并计算/);
  assert.match(runs, /run\.status === 'DRAFT'[\s\S]*编辑设置[\s\S]*开始计算/);
});

test('P5 material plan uses completed snapshots and exact authoritative filters', () => {
  assert.match(plan, /runs\?status=COMPLETED/);
  assert.match(plan, /item\.status === 'COMPLETED'/);
  assert.match(plan, /row\.suggestion_type === 'MAKE' && Number\(row\.suggested_quantity \|\| 0\) > 0/);
  assert.match(plan, /row\.suggestion_type === 'BUY' && Number\(row\.suggested_quantity \|\| 0\) > 0/);
  assert.match(plan, /Number\(row\.net_requirement \|\| 0\) > 0/);
  assert.match(plan, /需求日期未指定/);
});

test('P5 conversion language never claims downstream fulfillment', () => {
  for (const label of ['待转指令', '已转指令', '待处理', '已全部转为指令']) assert.match(plan, new RegExp(label));
  assert.doesNotMatch(plan, /已完成采购|已完成生产|一键创建/);
});

test('P5 calculation sheet maps API facts and navigates honestly', () => {
  for (const field of ['gross_sales_demand', 'gross_forecast_demand', 'gross_component_demand', 'gross_requirement', 'on_hand', 'open_purchase_supply', 'open_production_supply', 'net_requirement', 'suggestion_type', 'suggested_quantity', 'converted_quantity', 'remaining_quantity']) assert.match(plan, new RegExp(field));
  for (const section of ['需求', '可用供应', '净需求', '建议', 'BOM 来源']) assert.match(plan, new RegExp(section));
  assert.match(plan, /run\.components/);
  assert.match(plan, /run\.pegging/);
  assert.match(plan, /前往生产指令/);
  assert.match(plan, /前往采购指令/);
});

test('P5 responsive CSS preserves one rail and accessible targets', () => {
  assert.match(css, /min-height: 44px/);
  assert.match(css, /max-width: 680px/);
  assert.match(css, /@media \(max-width: 350px\)/);
  assert.match(css, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /min-width:\s*(?:7|8|9)\d\dpx/);
});
