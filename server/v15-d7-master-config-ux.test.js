import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D7 presents the four primary master-data routes on the canonical rail', () => {
  const source = read('src/pages/master-data.jsx');
  for (const name of ['suppliers', 'customers', 'products', 'warehouses']) {
    assert.match(source, new RegExp(`className="${name}-v15" width="rail"`));
  }
  assert.match(source, /title="货品资料"/);
  assert.match(source, /库存数量由业务单据维护/);
});

test('D7 makes BOM routing cost and quality version hierarchies explicit', () => {
  assert.match(read('src/pages/manufacturing.jsx'), /className="boms-v15" width="rail"/);
  assert.match(read('src/pages/product-routing.jsx'), /className="product-routings-v15" width="rail"/);
  const cost = read('src/pages/treasury-cost.jsx');
  assert.match(cost, /className="product-costs-v15" width="rail"/);
  assert.match(cost, /title="成本费率"/);
  const quality = read('src/pages/quality.jsx');
  assert.match(quality, /className="quality-rules-v15" width="rail"/);
  assert.match(quality, /title="质量规则"/);
});

test('D7 keeps contacts subordinate to customer and supplier master data', () => {
  const source = read('src/pages/crm.jsx');
  assert.match(source, /className="contacts-v15" width="rail"/);
  assert.match(source, /客户与供应商辅助资料/);
  assert.match(source, /联系人不替代客户或供应商主数据/);
});
