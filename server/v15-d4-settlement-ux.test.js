import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('D4 groups receivable and payable settlement around canonical parent concepts', () => {
  const source = read('src/pages/settlement.jsx');
  assert.match(source, /title=\{ar \? '应收结算' : '应付结算'\}/);
  assert.match(source, /title=\{collection \? '收款 \/ 核销' : '付款 \/ 核销'\}/);
  assert.match(source, /发票、收款、折让与未结余额/);
  assert.match(source, /账单、付款、折让与未结余额/);
});

test('D4 keeps invoice bill discount bank and accounting surfaces on the canonical rail', () => {
  assert.match(read('src/pages/commercial-go-live.jsx'), /BusinessPageShell className=\{sales \? 'sales-invoices-v15' : 'supplier-bills-v15'\} width="rail"/);
  const discounts = read('src/pages/discounts.jsx');
  assert.match(discounts, /className="sales-discounts-v15" width="rail"/);
  assert.match(discounts, /className="purchase-discounts-v15" width="rail"/);
  assert.match(read('src/pages/treasury-cost.jsx'), /className="bank-accounts-v15" width="rail"/);
  assert.match(read('src/pages/accounting.jsx'), /className=\{`accounting-v15\$\{/);
});

test('D4 removes raw POSTED copy from financial report empty states', () => {
  const source = read('src/pages/accounting.jsx');
  assert.doesNotMatch(source, /无 POSTED 凭证/);
  assert.match(source, /无已过账凭证/);
});
