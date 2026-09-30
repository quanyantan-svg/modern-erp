import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D3 keeps order approval separate from fulfillment', () => {
  const source = read('src/pages/master-data.jsx');
  // V1.6 P2: the sales-order permanent list-page 流程说明 paragraph has been
  // removed; the semantic separation between approval and fulfillment is now
  // preserved through data presentation (the APPROVED fulfillment context).
  assert.doesNotMatch(source, /销售订单审批只代表业务授权，不等于已经出货/);
  assert.match(source, /v16-sales-order-fulfillment/);
  assert.match(source, /function orderFulfillmentLabel/);
  assert.match(source, /'待出货'/);
  assert.match(source, /已关联 \$\{count\} 张出货单/);
  // Purchase-orders permanent copy still expresses the same boundary.
  assert.match(source, /采购订单审批只代表业务授权，采购入库和供应商账单继续独立处理/);
  assert.match(source, /className="sales-orders-v15/);
  assert.match(source, /className="purchase-orders-v15"/);
});

test('D3 presents delivery, return and quality queues on the canonical rail', () => {
  const logistics = read('src/pages/logistics-finance.jsx');
  const quality = read('src/pages/quality.jsx');
  assert.match(logistics, /className="sales-deliveries-v15" width="rail"/);
  assert.match(logistics, /title="退货管理"/);
  assert.match(logistics, /销售退货引用已确认销售出货/);
  assert.match(quality, /采购入库内部质量任务/);
  assert.match(quality, /销售出货内部质量任务/);
  assert.doesNotMatch(quality, /LEGACY \/ UNLINKED INSPECTION/);
});

test('D3 localizes linked finance status at presentation time', () => {
  const source = read('src/pages/logistics-finance.jsx');
  assert.match(source, /presentStatus\(relation\.finance\.status\)\.label/);
  assert.doesNotMatch(source, /<strong>\{relation\.finance\.status\}<\/strong>/);
});
