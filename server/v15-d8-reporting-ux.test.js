import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D8 exposes the five canonical decision-report labels', () => {
  const source = read('src/pages/decision-reports.jsx');
  for (const label of ['采购统计分析', '采购未交货', '销售统计分析', '销售未出货', '库存异动明细']) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
  assert.match(source, /className="decision-reports decision-reports-v15" width="rail"/);
  assert.match(source, /title="经营分析"/);
});

test('D8 keeps report date basis and export filters explicit', () => {
  const source = read('src/pages/decision-reports.jsx');
  assert.match(source, /权威业务日期/);
  assert.match(source, /exportEndpoint/);
  assert.match(source, /导出沿用当前筛选/);
});

test('D8 presents production and financial analysis within the canonical rail', () => {
  const manufacturing = read('src/pages/manufacturing.jsx');
  assert.match(manufacturing, /className="manufacturing-analytics-v15" width="rail"/);
  assert.match(manufacturing, /管理成本不等同于财务库存计价/);
  const accounting = read('src/pages/accounting.jsx');
  assert.match(accounting, /financial-reports-v15/);
  assert.match(accounting, /title=\{tab === 'income' \? '利润表'/);
  assert.match(accounting, /财务报表只纳入已过账凭证/);
});
