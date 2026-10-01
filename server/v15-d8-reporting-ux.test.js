import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D8 exposes the five canonical decision-report labels', () => {
  const source = read('src/pages/decision-reports.jsx');
  for (const label of ['采购统计分析', '采购未交货', '销售统计分析', '销售未出货', '库存异动明细']) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }
  // V1.6 P7 retired the legacy decision-reports-v15 desktop shell; the V16
  // mobile-enterprise surface remains on the single decision-reports route.
  assert.match(source, /className="v16-mobile-enterprise v16-decision-reports"/);
  assert.match(source, /'决策报表'/);
});

test('D8 keeps report date basis and export filters explicit', () => {
  const source = read('src/pages/decision-reports.jsx');
  assert.match(source, /权威业务日期/);
  assert.match(source, /ExportButton/);
  assert.match(source, /applied=\{appliedFilters\}/);
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
