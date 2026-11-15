import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D6 unifies inventory query and operations without calling confirmation approval', () => {
  // V24 (2026-11-12) — the inventory work surface moved to
  // src/pages/inventory-work.jsx when the domain consolidated onto one
  // canonical work face.
  const source = read('src/pages/inventory-work.jsx');
  assert.match(source, /className="v16-inventory-shell[^"]*" width="rail"/);
  assert.match(source, /aria-label="库存控制"/);
  assert.match(source, /确认调拨/);
  // V24 (2026-11-15): the operator capability tab labels moved from the page's
  // inline WORK_TABS table into the single registration module
  // src/lib/inventoryWorkTabs.js (Platform contract §36.18, PL-EXPOSURE-01 —
  // a page must not keep a second tab / endpoint list). The labels are
  // therefore asserted on that module, and the page is asserted to use it.
  const tabs = read('src/lib/inventoryWorkTabs.js');
  assert.match(source, /from '\.\.\/lib\/inventoryWorkTabs\.js'/);
  assert.match(tabs, /label: '调拨'/);
  assert.match(tabs, /label: '盘点'/);
  assert.match(tabs, /label: '调整'/);
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
