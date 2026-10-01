import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D6 unifies inventory query and operations without calling confirmation approval', () => {
  const source = read('src/pages/master-data.jsx');
  assert.match(source, /className="v16-inventory-shell" width="rail"/);
  assert.match(source, /aria-label="库存控制"/);
  assert.match(source, /确认调拨/);
  assert.match(source, />调拨</);
  assert.match(source, />盘点</);
  assert.match(source, />调整</);
});

test('D6 treats inventory movements as a report and traceability as evidence', () => {
  const movements = read('src/pages/logistics-finance.jsx');
  const traceability = read('src/pages/traceability.jsx');
  assert.match(movements, /v16-inventory-transactions/);
  assert.match(movements, /筛选库存异动/);
  assert.match(traceability, /className="traceability-page traceability-v15" width="rail"/);
  assert.match(traceability, /不根据相似数量或日期推测关系/);
});

test('D6 keeps scrap confirmation and month-end boundaries explicit', () => {
  const source = read('src/pages/inventory-extensions.jsx');
  assert.match(source, /v16-inventory-scraps/);
  assert.match(source, /新建存货报废/);
  assert.match(source, /确认整单报废/);
  assert.match(source, /v16-inventory-month-end/);
  assert.match(source, /运行预检查/);
});
