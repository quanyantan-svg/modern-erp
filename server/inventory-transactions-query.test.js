import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInventoryTransactionsQuery } from './app.js';

function query(search = '') {
  return buildInventoryTransactionsQuery(new URL(`http://localhost/api/inventory-transactions${search}`));
}

test('empty inventory-transaction search has no wildcard predicate and stays bounded', () => {
  const { sql, params } = query('?search=&type=&warehouse=&product=&direction=&startDate=&endDate=');
  assert.doesNotMatch(sql, /LIKE/);
  assert.deepEqual(params, []);
  assert.match(sql, /ORDER BY t\.created_at DESC LIMIT 200$/);
});

test('inventory-transaction query preserves every UI filter with sargable valid dates', () => {
  const { sql, params } = query('?search=PO-1&type=PURCHASE_RECEIPT&warehouse=wh-1&product=pr-1&direction=IN&startDate=2026-01-01&endDate=2026-01-31');
  assert.match(sql, /t\.source_no LIKE \? OR p\.code LIKE \? OR p\.name LIKE \?/);
  assert.match(sql, /t\.warehouse_id = \?/);
  assert.match(sql, /t\.product_id = \?/);
  assert.match(sql, /t\.direction = \?/);
  assert.match(sql, /t\.source_type = \?/);
  assert.match(sql, /t\.created_at >= \?/);
  assert.match(sql, /t\.created_at < \?/);
  assert.doesNotMatch(sql, /DATE\(t\.created_at\)/);
  assert.deepEqual(params, ['%PO-1%', '%PO-1%', '%PO-1%', 'wh-1', 'pr-1', 'IN', 'PURCHASE_RECEIPT', '2026-01-01', '2026-02-01']);
});

test('invalid API date text retains the prior SQL DATE filtering behavior', () => {
  const { sql, params } = query('?startDate=not-a-date&endDate=also-invalid');
  assert.match(sql, /DATE\(t\.created_at\) >= \?/);
  assert.match(sql, /DATE\(t\.created_at\) <= \?/);
  assert.deepEqual(params, ['not-a-date', 'also-invalid']);
});
