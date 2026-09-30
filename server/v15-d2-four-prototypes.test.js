import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { MOBILE_APPLICATION_GROUPS } from '../src/navigation/applicationMetadata.js';
import { PRIMARY_DOMAINS } from '../src/navigation/presentationMetadata.js';

const read = (path) => readFileSync(resolve(path), 'utf8');

test('D2 application workspace exposes V1.6 flowchart-aligned primary domains', () => {
  // V1.6 P1B intentionally moves the launcher to six flowchart-aligned
  // core groups. PRIMARY_DOMAINS (internal V1.5 metadata) is preserved at
  // seven entries; the launcher's user-facing groups are a deliberate
  // subset alignment that must not collapse internal semantics.
  const domains = MOBILE_APPLICATION_GROUPS.filter((group) => group.kind === 'domain');
  assert.deepEqual(
    domains.map(({ key, label }) => [key, label]),
    [
      ['master-data', '基础资料'],
      ['sales', '销售管理'],
      ['production', '生产管理'],
      ['purchasing', '采购管理'],
      ['inventory', '库存管理'],
      ['analytics', '决策报表'],
    ]
  );
  assert.equal(domains.some((group) => group.key === 'finance'), false);
  // Internal V1.5 metadata still has seven entries for backend semantics.
  assert.equal(PRIMARY_DOMAINS.length, 7);
});

test('D2 mobile application hierarchy discloses utility entries via details/summary', () => {
  const launcher = read('src/components/MobileLauncher.jsx');
  // V1.6 P1B: launcher uses an isolated .v16-* component layer and
  // details/summary disclosures for utility groups instead of the V1.5
  // numbered domain selector.
  assert.match(launcher, /v16-launcher/);
  assert.match(launcher, /details/);
  assert.doesNotMatch(launcher, /application-domain-nav/);
  assert.doesNotMatch(launcher, /application-domain-content__more/);
  assert.doesNotMatch(launcher, /application-shortcuts/);
});

test('D2 overview remains permission-safe and contains three flow lanes', () => {
  const overview = read('src/pages/business-overview.jsx');
  assert.match(overview, /title: '销售履约'/);
  assert.match(overview, /title: '生产执行'/);
  assert.match(overview, /title: '采购履约'/);
  assert.match(overview, /navigation\.canNavigate/);
  assert.doesNotMatch(overview, /\bapi\s*\(/);
});

test('D2 purchase receipt list and detail use D1 lifecycle contracts truthfully', () => {
  const page = read('src/pages/logistics-finance.jsx');
  for (const contract of [
    '/api/lifecycle/analyze?entityType=PURCHASE_RECEIPT',
    '/api/lifecycle/archive',
    '/api/lifecycle/restore',
    'includeArchived',
  ]) assert.match(page, new RegExp(contract.replace(/[?]/g, '\\?')));
  assert.match(page, /从正常业务列表中移除/);
  assert.match(page, /仍保持“已取消”/);
  assert.match(page, /can\(user, 'USERS_MANAGE'\)/);
  assert.match(page, /receipt-document-flow/);
  assert.match(page, /CompactRecordList/);
});

test('D2 responsive styles cover mobile, tablet workspace, and desktop', () => {
  const css = read('src/styles.css');
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /--app-max-width:680px/);
  assert.match(css, /\.compact-record-list/);
  // V1.6 P0 isolated new component CSS into v16-mobile-enterprise.css.
  const v16Css = read('src/styles/v16-mobile-enterprise.css');
  assert.match(v16Css, /\.v16-launcher-tile/);
  assert.match(v16Css, /\.v16-workspace/);
});
