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
    // V1.7 P0: launcher groups are owned by applicationRegistry.js;
    // applicationMetadata.js is a compatibility projection. The
    // Core Scope Cleanup removed the 更多业务 utility-extension
    // launcher group because its only tiles were the Project /
    // CRM extension routes.
    const registry = read('src', 'navigation', 'applicationRegistry.js');
    // 2026-11-17：分组标题改为从 domainMetadata 的中文 navigationLabel 单源派生
    // （Requirement §36.19 PL-NAVI-03），因此标题断言移到 domainMetadata，
    // registry 只断言分组键与 kind。
    const domainMetadata = read('src', 'navigation', 'domainMetadata.js');
    for (const label of [
      '主数据与工程', '销售与客户', '计划', '采购与委外',
      '制造与质量', '库存与仓储', '财务运营', '会计与分析', '系统设置',
    ]) {
      assert.match(domainMetadata, new RegExp(`navigationLabel: '${label}'`));
    }
    for (const key of [
      'master-engineering', 'sales-customer', 'planning', 'procurement-outsourcing',
      'manufacturing-quality', 'inventory-warehouse', 'finance-operations',
      'accounting-analytics', 'platform',
    ]) {
      assert.match(registry, new RegExp(`launcherGroup\\('${key}','domain'`));
    }
    assert.match(registry, /DOMAIN_BY_KEY\[key\]\.navigationLabel/);
    assert.doesNotMatch(registry, /launcherGroup\('utility-extension',/);
  });

  test('all required core ERP surfaces remain registered', () => {
    const registry = read('src', 'navigation', 'applicationRegistry.js');
    // V1.7 P0: routes, labels and launcher entries all live in the
    // canonical registry. IQC/OQC remain enabled routes but must not be
    // primary launcher tiles.
    for (const label of [
      '货品资料', 'BOM', '客户资料', '供应商资料', '仓库资料', '制品工序标准',
      '计划预测', '生产指令', '采购指令', '请购单',
      '制令单', '用料出库', '生产入库', '销售订单', '销售出货', '销售退货',
      '采购订单', '采购收货', '采购退货', '库存作业', '存货报废', '存货月结',
      '应收结算', '应付结算', '销售折让', '应付折让', '会计凭证',
      '寻源与定价', '委外加工',
      '销售统计分析表', '销售未出货反应表', '采购统计分析表', '采购未交货反应表', '存货异动明细表',
    ]) assert.ok(registry.includes(label), `missing core surface: ${label}`);
    // IQC/OQC are reachable as routes but must not be primary launcher tiles.
    const iqcInLauncher = /\['iqc'/.test(registry);
    const oqcInLauncher = /\['oqc'/.test(registry);
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
    // V1.7 P0: returns launcher entries are owned by applicationRegistry.js
    // with composite keys that encode SALES_RETURN / PURCHASE_RETURN targets.
    const registry = read('src', 'navigation', 'applicationRegistry.js');
    assert.match(registry, /\['returns','销售退货','returns',\{key:'returns:sales',target:\{documentType:'SALES_RETURN'\}\}\]/);
    assert.match(registry, /\['returns','采购退货','returns',\{key:'returns:purchase',target:\{documentType:'PURCHASE_RETURN'\}\}\]/);
    assert.match(app, /navigate\(\{ routeKey: item\.page, target: item\.reportKey \? \{ reportKey: item\.reportKey \} : item\.target \}/);
  });

  test('boilerplate helper phrases are absent from product pages', () => {
    for (const phrase of ['您可以在这里管理', '此页面用于', '请在此页面', '本模块主要用于']) {
      assert.equal(pageSources.includes(phrase), false, `boilerplate helper copy remains: ${phrase}`);
    }
  });
});
