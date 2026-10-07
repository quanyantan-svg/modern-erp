import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { APPLICATION_LAUNCHER_GROUPS, applicationRouteFor } from '../src/navigation/applicationRegistry.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Master & Engineering launcher exposes the three focused engineering surfaces', () => {
  const group = APPLICATION_LAUNCHER_GROUPS.find((item) => item.key === 'master-engineering');
  assert.ok(group);
  const keys = group.items.map((item) => item.routeKey);
  assert.deepEqual(keys, ['products', 'engineering-reference', 'boms', 'product-routings', 'engineering-substitute', 'engineering-change']);
  for (const key of ['engineering-reference', 'engineering-substitute', 'engineering-change']) {
    const route = applicationRouteFor(key);
    assert.equal(route.enabled, true);
    assert.equal(route.applicationGroup, 'master-engineering');
    assert.equal(typeof route.screen.loader, 'function');
  }
});

test('focused frontend calls canonical engineering contracts and keeps Apply explicit', () => {
  const reference = read('src/pages/engineering-reference.jsx');
  const substitute = read('src/pages/engineering-substitute.jsx');
  const change = read('src/pages/engineering-change.jsx');
  const manufacturing = read('src/pages/manufacturing.jsx');
  const bom = read('src/components/BomGovernancePanel.jsx');

  assert.match(reference, /res\[responseKey\]/);
  assert.doesNotMatch(reference, /const endpoint = isExisting[^\n]+workshop-formulas/);
  assert.match(reference, /WORK_CENTERS_MANAGE/);
  assert.doesNotMatch(reference, /eval\s*\(|new Function\s*\(/);

  assert.match(substitute, /setResults\(r\.substitutes \|\| \[\]\)/);
  assert.doesNotMatch(substitute, /method: 'DELETE'/);
  assert.match(change, /<ConfirmAction/);
  assert.match(change, /call\('reject', \{ reason: rejectReason \}\)/);

  assert.match(manufacturing, /\/api\/engineering\/boms/);
  assert.match(manufacturing, /method: 'PATCH'/);
  assert.doesNotMatch(manufacturing.slice(0, manufacturing.indexOf('\/\/ ============ Production Orders')), /\/api\/boms/);
  assert.match(bom, /batch-preview/);
  assert.match(bom, /<ConfirmAction/);
  assert.match(bom, /product_id=/);
});

test('responsive contract includes the four acceptance widths and single-column mobile editors', () => {
  const css = read('src/styles.css');
  const acceptance = read('scripts/acceptance/v17-engineering-frontend.mjs');
  for (const width of [320, 390, 430, 680]) assert.match(acceptance, new RegExp(`\\b${width}\\b`));
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.engineering-form[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /\.engineering-reference-tabs[\s\S]*?overflow-x: auto/);
});
