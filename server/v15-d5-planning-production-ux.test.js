import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D5 separates forecast, MRP runs and material suggestions in presentation', () => {
  const forecasts = read('src/pages/forecasts.jsx');
  const runs = read('src/pages/mrp-runs.jsx');
  const plan = read('src/pages/material-requirements-plan.jsx');
  assert.match(forecasts, /className="forecasts-v15" width="rail"/);
  assert.match(forecasts, /title="计划预测"/);
  assert.match(runs, /title="MRP"/);
  assert.match(runs, /context="运算历史"/);
  assert.match(plan, /title="MRP · 物料建议"/);
});

test('D5 keeps the three planning document branches distinct', () => {
  const source = read('src/pages/planning-documents.jsx');
  assert.match(source, /className="planning-documents-v15" width="rail"/);
  assert.match(source, /label:'生产指令'/);
  assert.match(source, /label:'采购指令'/);
  assert.match(source, /label:'请购单'/);
  assert.match(source, /下达后生成制令单/);
});

test('D5 presents production execution on the canonical rail without changing API contracts', () => {
  const source = read('src/pages/manufacturing.jsx');
  assert.match(source, /className="production-orders-v15" width="rail"/);
  assert.match(source, /className="material-issues-v15" width="rail"/);
  assert.match(source, /className="production-receipts-v15" width="rail"/);
  assert.match(source, /title="制令单"/);
  assert.match(source, /\/api\/production-orders/);
});
