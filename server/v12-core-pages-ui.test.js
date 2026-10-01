import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const css = read('src', 'styles.css');
const app = read('src', 'App.jsx');
const metadata = read('src', 'navigation', 'applicationMetadata.js');
const pageSources = readdirSync(join(root, 'src', 'pages'))
  .filter((name) => name.endsWith('.jsx'))
  .map((name) => read('src', 'pages', name))
  .join('\n');

describe('V1.2 core page migration', () => {
  test('launcher retains the canonical V1.6 business groups', () => {
    // V1.6 P1B: six flowchart-aligned core groups + utility disclosures.
    for (const label of [
      '基础资料', '销售管理', '生产管理', '采购管理', '库存管理', '决策报表',
      '业务流程', '财务工具', '更多业务', '高级设置', '系统设置',
    ]) {
      assert.match(metadata, new RegExp(`label: '${label}'`));
    }
  });

  test('all required core ERP surfaces remain registered', () => {
    const surface = app + metadata + pageSources;
    // V1.6 P1B: IQC/OQC remain in App.jsx routes but are NOT primary launcher
    // tiles; material-requirements-plan stays as a route but is not a tile.
    for (const label of [
      '货品资料', 'BOM', '客户资料', '供应商资料', '仓库资料', '制品工序标准',
      '计划预测', 'MRP', '生产指令', '采购指令', '请购单',
      '制令单', '用料出库', '生产入库', '销售订单', '销售出货', '销售退货',
      '采购订单', '采购入库', '采购退货', '库存作业', '库存调整', '库存调拨',
      '存货报废', '库存盘点', '存货月结',
      '应收结算', '应付结算', '销售折让', '采购折让', '收款 / 核销', '付款 / 核销', '会计凭证',
      '采购统计分析表', '采购未交货反应表', '销售统计分析表', '销售未出货反应表', '存货异动明细表',
    ]) assert.ok(surface.includes(label), `missing core surface: ${label}`);
    // IQC/OQC are reachable as routes but must not be primary launcher tiles.
    const iqcInLauncher = /\['iqc'/.test(metadata);
    const oqcInLauncher = /\['oqc'/.test(metadata);
    assert.ok(!iqcInLauncher, 'IQC must not be a primary launcher tile');
    assert.ok(!oqcInLauncher, 'OQC must not be a primary launcher tile');
  });

  test('card lists and one-column forms are canonical at every viewport width', () => {
    const canonical = css.slice(css.indexOf('/* Core ERP pages use the same compact touch layout'));
    assert.ok(canonical.length > 500, 'canonical page override block must exist');
    assert.match(canonical, /\.mobile-application-view \.form-grid,[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
    assert.match(canonical, /\.mobile-application-view \.table-wrap tbody tr \{[^}]*display:grid[^}]*border-radius:var\(--radius-lg\)/s);
    assert.match(canonical, /\.modal,[\s\S]*width:min\(100%, var\(--app-max-width\)\)/);
    assert.doesNotMatch(canonical, /@media\s*\(min-width/, 'canonical page structure must not branch at desktop widths');
  });

  test('forecast and routing pages no longer ship duplicate desktop/mobile lists', () => {
    const forecasts = read('src', 'pages', 'forecasts.jsx');
    const routing = read('src', 'pages', 'product-routing.jsx');
    for (const source of [forecasts, routing]) {
      assert.doesNotMatch(source, /list-desktop|list-mobile/);
      assert.match(source, /<RecordList>/);
      assert.match(source, /<RecordCard/);
    }
  });

  test('decision reports use compact enterprise rows and an on-demand filter sheet, not tables', () => {
    const reports = read('src', 'pages', 'decision-reports.jsx');
    assert.doesNotMatch(reports, /<table\b/);
    assert.match(reports, /<FilterSheet/);
    assert.match(reports, /<FilterButton/);
    // V1.6 P7 retired the RecordCard primary surface in favour of compact enterprise rows.
    assert.doesNotMatch(reports, /<RecordCard/);
  });

  test('sales and purchase returns have distinct launcher targets', () => {
    // V1.6 P1B puts returns entries into the sales / purchasing core groups
    // while preserving the SALES_RETURN / PURCHASE_RETURN distinction.
    assert.match(metadata, /\['returns', '销售退货'[\s\S]*'returns:sales'[\s\S]*documentType: 'SALES_RETURN'/);
    assert.match(metadata, /\['returns', '采购退货'[\s\S]*'returns:purchase'[\s\S]*documentType: 'PURCHASE_RETURN'/);
    assert.match(app, /navigateToPage\(item\.page, item\.target\)/);
  });

  test('boilerplate helper phrases are absent from product pages', () => {
    for (const phrase of ['您可以在这里管理', '此页面用于', '请在此页面', '本模块主要用于']) {
      assert.equal(pageSources.includes(phrase), false, `boilerplate helper copy remains: ${phrase}`);
    }
  });
});
