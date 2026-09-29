import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { MOBILE_APPLICATION_GROUPS } from '../src/navigation/applicationMetadata.js';
import { PRIMARY_DOMAINS } from '../src/navigation/presentationMetadata.js';

const read = (path) => readFileSync(resolve(path), 'utf8');

test('D2 application workspace exposes exactly seven primary domains', () => {
  const domains = MOBILE_APPLICATION_GROUPS.filter((group) => group.kind === 'domain');
  assert.deepEqual(domains.map((group) => group.label), PRIMARY_DOMAINS.map((domain) => domain.label));
  assert.equal(domains.some((group) => group.key === 'finance'), false);
  assert.ok(domains.every((group) => group.items.filter((item) => item.tier === 'primary').length <= 4));
});

test('D2 mobile application hierarchy discloses secondary and utility entries', () => {
  const launcher = read('src/components/MobileLauncher.jsx');
  assert.match(launcher, /UtilityGroups/);
  assert.match(launcher, /application-domain-nav/);
  assert.match(launcher, /application-domain-content__more/);
  assert.match(launcher, /application-shortcuts/);
  assert.doesNotMatch(launcher, /application-desktop-workspace|application-mobile-domains/);
});

test('D2 overview remains permission-safe and contains three flow lanes', () => {
  const overview = read('src/pages/business-overview.jsx');
  assert.match(overview, /code: 'SALES'/);
  assert.match(overview, /code: 'PRODUCTION'/);
  assert.match(overview, /code: 'PURCHASE'/);
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
  assert.match(page, /移除只影响正常业务列表的可见性，不删除单据或审计记录/);
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
  assert.match(css, /\.application-domain-nav__index/);
});
