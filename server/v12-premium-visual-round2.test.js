import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const css = read('src', 'styles.css');
const ui = read('src', 'components', 'ui.jsx');
const approvals = read('src', 'components', 'MobileApprovalCenter.jsx');
const masterData = read('src', 'pages', 'master-data.jsx');
const settlement = read('src', 'pages', 'settlement.jsx');
const ordinaryFilterPages = [
  read('src', 'pages', 'platform-notifications.jsx'),
  read('src', 'pages', 'platform-workflows.jsx'),
  read('src', 'pages', 'quality.jsx'),
  read('src', 'pages', 'treasury-cost.jsx'),
].join('\n');

describe('V1.2 premium visual polish round 2', () => {
  test('canonical list search submits with Enter without a visible query button', () => {
    const toolbar = ui.match(/export function Toolbar[\s\S]*?export function Modal/)?.[0] || '';
    assert.match(toolbar, /role="search"/);
    assert.match(toolbar, /onSubmit=/);
    assert.doesNotMatch(toolbar, />查询<\/button>/);
    assert.doesNotMatch(ordinaryFilterPages, />查询<\/button>/);
  });

  test('approval inbox defers every decision to the detail view', () => {
    const card = approvals.match(/export function ApprovalCard[\s\S]*?export function ApprovalListState/)?.[0] || '';
    const detail = approvals.match(/function ApprovalDetail[\s\S]*?function ActionDialog/)?.[0] || '';
    assert.doesNotMatch(card, /驳回|审批通过|mobile-approval-card__actions/);
    assert.match(detail, /驳回/);
    assert.match(detail, /审批通过/);
  });

  test('inventory uses compact modes and product-first semantic records', () => {
    assert.match(masterData, /className="v16-inventory-row"/);
    assert.match(masterData, /v16-inventory-row__body[\s\S]*?productName/);
    assert.match(masterData, /v16-inventory-row__metric/);
    assert.doesNotMatch(masterData, /<strong>库存查询<\/strong><small>/);
    assert.match(masterData, /className="v16-inventory-tabs"/);
  });

  test('root panel and launcher groups use whitespace instead of container chrome', () => {
    assert.match(css, /\.mobile-application-view > \.panel\s*\{[^}]*background:transparent[^}]*box-shadow:none/s);
    assert.match(css, /\.mobile-launcher__group\s*\{[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/s);
  });

  test('empty states are compact and receivables emphasize outstanding balance', () => {
    assert.match(css, /\.canonical-empty-state, \.empty, \.mobile-page__body--empty\s*\{[^}]*min-height:168px/s);
    assert.match(settlement, /className="number settlement-outstanding"/);
    assert.match(css, /\.settlement-outstanding strong\s*\{[^}]*font-size:19px/s);
  });
});
