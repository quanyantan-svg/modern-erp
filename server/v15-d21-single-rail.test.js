import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (path) => readFileSync(resolve(path), 'utf8');
const launcher = read('src/components/MobileLauncher.jsx');
const overview = read('src/pages/business-overview.jsx');
const logistics = read('src/pages/logistics-finance.jsx');
const design = read('src/components/design-system.jsx');
const css = read('src/styles.css');
const visual = read('scripts/acceptance/v15-d2-visual-review.mjs');

test('D2.1 freezes one 680px rail for all four prototypes', () => {
  assert.match(css, /--app-max-width:680px/);
  assert.match(css, /\.business-page-shell--rail\s*\{[^}]*max-width:680px/);
  assert.match(overview, /className="flow-overview" width="rail"/);
  assert.match(logistics, /className="purchase-receipts-prototype" width="rail"/);
  assert.match(logistics, /className=\{`purchase-receipt-detail[\s\S]*?width="rail"/);
});

test('D2.1 application launcher is rebuilt as direct flowchart grids', () => {
  // V1.6 P1B replaces the seven-row numbered selector with six
  // flowchart-aligned groups rendered as direct 3-column grids.
  const v16Css = read('src/styles/v16-mobile-enterprise.css');
  assert.doesNotMatch(launcher, /application-desktop-workspace|application-mobile-domains/);
  assert.match(launcher, /v16-launcher-grid/);
  assert.match(launcher, /v16-launcher-group/);
  assert.match(launcher, /v16-launcher-tile/);
  assert.match(v16Css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  // Numbered selector intentionally removed.
  assert.doesNotMatch(launcher, /application-domain-nav__index/);
  assert.doesNotMatch(launcher, /application-domain-nav__label/);
  assert.doesNotMatch(launcher, /application-domain-nav__indicator/);
});

test('D2.1 replaces receipt tables and detail side rail with structured records', () => {
  assert.match(design, /export function CompactRecordList/);
  assert.match(design, /export function CompactRecord/);
  assert.match(logistics, /className="receipt-record-list"/);
  assert.match(logistics, /className="receipt-document-flow"/);
  assert.doesNotMatch(logistics, /className="receipt-list-table"|<BusinessDetailLayout/);
  assert.doesNotMatch(logistics, /className="receipt-detail-lines"/);
});

test('D2.1 long-text visual gate covers rail width and collision checks', () => {
  for (const value of ['超长供应商', '超长仓库', '超长货品', 'PR-D2-LONG']) assert.match(visual, new RegExp(value));
  assert.match(visual, /assertRail/);
  assert.match(visual, /assertNoHeaderOverlap/);
  assert.match(visual, /long-text/);
});
