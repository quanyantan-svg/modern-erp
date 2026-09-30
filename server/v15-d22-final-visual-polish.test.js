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

test('D2.2 application page removes duplicate title and English eyebrows', () => {
  // No duplicate large h1 inside launcher (mobile shell already shows "应用").
  assert.doesNotMatch(launcher, /<h1>应用<\/h1>/);
  assert.doesNotMatch(launcher, /<span>APPLICATIONS<\/span>/);
  assert.doesNotMatch(launcher, /<span>ROLE WORKSPACE<\/span>/);
  // V1.6 P1B removed the "我的工作区 / 快捷入口" panel; launcher now uses
  // direct flowchart grids followed by utility disclosures.
  assert.doesNotMatch(launcher, /<h2>我的工作区<\/h2>/);
  assert.doesNotMatch(launcher, /<h2>快捷入口<\/h2>/);
});

test('D2.2 application page is rebuilt as direct flowchart grids (no numbered selector)', () => {
  // V1.6 P1B replaces the numbered seven-domain selector with six
  // flowchart-aligned groups rendered as direct 3-column grids.
  const v16Css = read('src/styles/v16-mobile-enterprise.css');
  assert.match(launcher, /v16-launcher/);
  assert.match(launcher, /v16-launcher-group/);
  assert.match(launcher, /v16-launcher-tile/);
  assert.match(v16Css, /\.v16-launcher-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3/);
  // Numbered domain selector is intentionally gone.
  assert.doesNotMatch(launcher, /application-domain-nav__index/);
  assert.doesNotMatch(launcher, /application-domain-nav__label/);
  assert.doesNotMatch(launcher, /application-domain-nav__indicator/);
});

test('D2.2 business overview turns tile groups into vertical step flow', () => {
  // Three flow lanes with the approved sequence.
  for (const step of ['销售订单', '销售出货 / 退货', '应收结算', 'MRP', '生产指令', '制令单', '用料出库', '生产入库', '采购指令', '请购单', '采购订单', '采购入库', '应付结算']) {
    assert.match(overview, new RegExp(step), step);
  }
  // Vertical connector lines.
  assert.match(overview, /flow-lane__connector/);
  assert.match(css, /\.flow-lane__connector\s*\{/);
  // No per-tile huge colored cards; flow lane has bottom separator only.
  assert.doesNotMatch(css, /\.flow-lane\s*\{[^}]*border-left:4px solid/);
  // No "进入应用" repeated copy.
  assert.doesNotMatch(overview, /进入应用/);
  // Boundary copy removed from main surface.
  assert.doesNotMatch(overview, /审批 ≠ 履约 · 物流 ≠ 结算 · 结算 ≠ 凭证/);
  // HelpDisclosure remains available with the boundary copy.
  assert.match(overview, /审批 ≠ 履约/);
  assert.match(overview, /HelpDisclosure/);
  assert.match(overview, /流程说明/);
  // SUPPORTING English eyebrow removed.
  assert.doesNotMatch(overview, /<span>SUPPORTING<\/span>/);
});

test('D2.2 purchase receipt list removes header subtitle and updates archive wording', () => {
  const receiptCss = read('src/styles/v16-purchase-receipts.css');
  // Subtitle "记录到货、质量验收与库存入账" removed from default header.
  assert.doesNotMatch(logistics, /context="记录到货、质量验收与库存入账"/);
  assert.match(logistics, /className="purchase-receipts-v16 v16-purchase-receipts"/);
  // Archive filter wording updated.
  assert.match(logistics, /归档记录/);
  assert.doesNotMatch(logistics, />显示已移除</);
  // Document number single-line + ellipsis in receipt record list.
  assert.match(receiptCss, /\.v16-purchase-receipt-row__number\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/s);
  // Inline archive card text on the list updated.
  assert.match(logistics, /v16-purchase-receipt-row__archive">已归档<\/span>/);
});

test('D2.2 purchase receipt detail localizes billing status enum and refines danger zone', () => {
  const receiptCss = read('src/styles/v16-purchase-receipts.css');
  // Localized billing status.
  assert.match(logistics, /BILLING_STATUS_LABELS[\s\S]*?UNBILLED:\s*'未开账'/);
  assert.match(logistics, /PARTIALLY_BILLED:\s*'部分开账'/);
  assert.match(logistics, /BILLED:\s*'已开账'/);
  assert.match(logistics, /billingStatusLabel\(billingStatus\)/);
  // Long-value layout class wired.
  assert.match(logistics, /v16-purchase-receipt-detail__source-row-value/);
  assert.match(receiptCss, /\.v16-purchase-receipt-detail__source-row-value\s*\{/);
  // Danger zone refined: "管理" section, subtle border, not a giant red container.
  assert.match(logistics, /<summary>管理<\/summary>/);
  assert.match(receiptCss, /\.v16-purchase-receipt-detail__management-row\s*\{[^}]*border-bottom:/s);
  // Archive confirmation semantics preserved.
  assert.match(logistics, /title="从业务列表移除？"/);
  assert.match(logistics, /confirmLabel="从列表移除"/);
  assert.match(logistics, /从正常业务列表中移除/);
  assert.doesNotMatch(logistics, /永久删除|彻底删除|不可恢复/);
});

test('D2.2 four prototypes stay on the 680px canonical rail with no page-level overflow', () => {
  assert.match(css, /--app-max-width:680px/);
  assert.match(css, /\.business-page-shell--rail\s*\{[^}]*max-width:680px/);
  assert.match(overview, /width="rail"/);
  assert.match(logistics, /width="rail"/);
});
