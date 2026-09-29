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
  test('launcher retains the canonical business groups', () => {
    for (const label of ['基础资料', '销售', '计划 / MRP', '生产', '采购', '库存', '经营分析', '工作区', '高级设置', '更多业务', '系统设置']) {
      assert.match(metadata, new RegExp(`label: '${label}'`));
    }
  });

  test('all required core ERP surfaces remain registered', () => {
    const surface = app + metadata + pageSources;
    for (const label of [
      '货品资料', 'BOM', '客户资料', '供应商资料', '仓库资料', '制品工序标准',
      '计划预测', 'MRP', '物料建议', '生产指令', '采购指令', '请购单',
      '制令单', '用料出库', '生产入库', '销售订单', '销售出货', '销售退货',
      '采购订单', '采购入库', '采购退货', '库存作业', '库存调整', '库存调拨',
      '存货报废', '库存盘点', '存货月结', 'IQC 来料检验', 'OQC 出货检验',
      '应收结算', '应付结算', '销售折让', '采购折让', '收款 / 核销', '付款 / 核销', '会计凭证',
      '采购统计分析', '采购未交货', '销售统计分析', '销售未出货', '库存异动明细',
    ]) assert.ok(surface.includes(label), `missing core surface: ${label}`);
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

  test('decision reports use cards and an on-demand filter sheet, not tables', () => {
    const reports = read('src', 'pages', 'decision-reports.jsx');
    assert.doesNotMatch(reports, /<table\b/);
    assert.match(reports, /<FilterSheet/);
    assert.match(reports, /<FilterButton/);
    assert.match(reports, /<RecordCard/);
  });

  test('sales and purchase returns have distinct launcher targets', () => {
    assert.match(metadata, /\['returns', '销售退货'[\s\S]*documentType: 'SALES_RETURN'[\s\S]*'returns:sales'/);
    assert.match(metadata, /\['returns', '采购退货'[\s\S]*documentType: 'PURCHASE_RETURN'[\s\S]*'returns:purchase'/);
    assert.match(app, /navigateToPage\(item\.page, item\.target\)/);
  });

  test('boilerplate helper phrases are absent from product pages', () => {
    for (const phrase of ['您可以在这里管理', '此页面用于', '请在此页面', '本模块主要用于']) {
      assert.equal(pageSources.includes(phrase), false, `boilerplate helper copy remains: ${phrase}`);
    }
  });
});
