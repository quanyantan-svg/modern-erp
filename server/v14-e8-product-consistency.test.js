import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MOBILE_APPLICATION_GROUPS } from '../src/navigation/applicationMetadata.js';
import { ROUTE_PRESENTATIONS, DISABLED_ROUTE_PRESENTATIONS } from '../src/navigation/presentationMetadata.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path) => readFileSync(resolve(root, path), 'utf8');

test('E8 audits the complete current user-facing application catalogue', () => {
  const disabled = new Set(['cash-journals', 'bills', 'fixed-assets', 'workflows', 'data-cleanup']);
  const pages = new Set(ROUTE_PRESENTATIONS.map((item) => item.route));
  assert.equal(pages.size, 53);
  assert.deepEqual(new Set(DISABLED_ROUTE_PRESENTATIONS.map((item) => item.route)), disabled);
  for (const page of ['business-overview', 'orders', 'inventory-transactions', 'decision-reports', 'traceability']) {
    assert.ok(pages.has(page), `missing audited page ${page}`);
  }
  assert.equal(pages.has('system-health'), false);
  assert.equal(pages.has('commercial-go-live'), false);
});

test('C02 business selector remains report-only', () => {
  const app = source('src/App.jsx');
  const reports = source('src/pages/decision-reports.jsx');
  assert.match(reports, /BusinessEntitySelector/);
  assert.doesNotMatch(app, /BusinessEntitySelector/);
  for (const path of ['src/pages/master-data.jsx', 'src/pages/logistics-finance.jsx', 'src/pages/manufacturing.jsx']) {
    assert.doesNotMatch(source(path), /BusinessEntitySelector/);
  }
});

test('tracking, commercial, inventory and quality pages use business-readable enum presentation', () => {
  assert.match(source('src/components/TrackingAllocationEditor.jsx'), /presentStatus\(serial\.lifecycle_state, 'tracking\.status'\)\.label/);
  assert.match(source('src/pages/commercial-go-live.jsx'), /presentBusinessValue\('taxMode', row\.tax_mode\)\.label/);
  assert.match(source('src/pages/logistics-finance.jsx'), /presentBusinessValue\('inventoryDirection', item\.direction\)\.label/);
  assert.match(source('src/pages/quality.jsx'), /presentBusinessValue\('samplingMode', x\.sampling_mode\)\.label/);
  assert.doesNotMatch(source('src/pages/business-overview.jsx'), /NONE \/ LOT \/ SERIAL/);
});

test('business dates and settlement account labels are explicit and safe', () => {
  const inventory = source('src/pages/logistics-finance.jsx');
  const settlement = source('src/pages/settlement.jsx');
  assert.match(inventory, /item\.business_date \|\| '业务日期缺失'/);
  assert.match(inventory, /item\.business_date \|\| '业务日期缺失'/);
  assert.doesNotMatch(settlement, /<strong>\{document\.settlement_account_id/);
  assert.match(settlement, /settlementAccountLabel\(document\)/);
});

test('decision reports preserve structured error guidance and canonical states', () => {
  const reports = source('src/pages/decision-reports.jsx');
  for (const kind of ['LOADING', 'ERROR', 'EMPTY', 'NO_RESULTS', 'PERMISSION_DENIED']) {
    assert.match(reports, new RegExp(`BusinessState kind="${kind}"`));
  }
  assert.match(reports, /requestId=\{state\.error\?\.requestId\}/);
  assert.match(reports, /state\.error\?\.resolution/);
});

test('transfer and reviewer language remain within the approved V1.4 vocabulary', () => {
  const transfers = source('src/pages/master-data.jsx');
  const copy = source('src/lib/copy.js');
  assert.match(transfers, />确认调拨<\/button>/);
  assert.doesNotMatch(transfers, /批准调拨|审批调拨|确认审批/);
  assert.match(copy, /业务审核员/);
  assert.doesNotMatch(copy, /销售主管|SALES_SUPERVISOR/);
});
