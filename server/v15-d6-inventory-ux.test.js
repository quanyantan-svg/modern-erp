import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D6 unifies inventory query and operations without calling confirmation approval', () => {
  const source = read('src/pages/master-data.jsx');
  assert.match(source, /className="inventory-operations-v15" width="rail"/);
  assert.match(source, /title="库存作业"/);
  assert.match(source, /调拨与调整的确认是库存生效动作，不代表业务审批/);
  assert.match(source, />调拨</);
  assert.match(source, />盘点</);
  assert.match(source, />调整</);
});

test('D6 treats inventory movements as a report and traceability as evidence', () => {
  const movements = read('src/pages/logistics-finance.jsx');
  const traceability = read('src/pages/traceability.jsx');
  assert.match(movements, /className="inventory-transactions-v15" width="rail"/);
  assert.match(movements, /title="库存异动明细"/);
  assert.match(traceability, /className="traceability-page traceability-v15" width="rail"/);
  assert.match(traceability, /不根据相似数量或日期推测关系/);
});

test('D6 keeps scrap confirmation and month-end boundaries explicit', () => {
  const source = read('src/pages/inventory-extensions.jsx');
  assert.match(source, /className="inventory-scraps-v15" width="rail"/);
  assert.match(source, /title="存货报废"/);
  assert.match(source, /确认是库存生效动作，不是审批动作/);
  assert.match(source, /className="inventory-period-page inventory-month-end-v15" width="rail"/);
  assert.match(source, /结账不会修改库存流水或会计凭证/);
});
