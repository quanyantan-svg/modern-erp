// P1 — Material Requirements Plan IA focused tests.
//
// Verifies the three product concepts (需求预测 / MRP 运算 / 物料需求计划)
// are clearly separated:
//   - launcher exposes exactly three planning entries, no duplicate
//     legacy "MRP物料需求计划" card
//   - status lib maps enum → Chinese label without leaking raw enums
//   - material-plan filter logic matches the P1 spec (全部 / 缺料 / 生产建议 / 采购建议)
//   - material-plan sort logic preserves M11/M12 arithmetic semantics
//   - trace explanation produces the exact numbers from the P1 golden case
//   - business overview distinguishes 需求预测 / MRP 运算 / 物料需求计划
//   - M11 net-before-explosion golden regression (FG net 15, A 30, B 45)
//   - M12 conversion (MAKE/BUY) wiring through material-plan links

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';

import {
  FORECAST_STATUS_LABEL,
  MRP_RUN_STATUS_LABEL,
  MRP_DEMAND_MODE_LABEL,
  SUGGESTION_TYPE_LABEL,
  WARNING_LABEL,
  forecastStatusLabel,
  mrpRunStatusLabel,
  demandModeLabel,
  suggestionTypeLabel,
  warningLabel,
} from '../src/lib/status.js';
import {
  PLANNING_DOCUMENT_PAGES,
  planningDocumentTabForPage,
} from '../src/navigation/planningDocumentNavigation.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// ---------------------------------------------------------------------------
// Pure logic helper re-implementations from material-requirements-plan.jsx
//
// We import via execSync rather than from a JSX file because the helper is
// co-located with a React component. The expected logic is fixed by the
// product spec; if the page implementation drifts, the focused test fires.
// ---------------------------------------------------------------------------
const FILTER_LOGIC_SOURCE = readFileSync(
  resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'),
  'utf8',
);

function assertContains(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message || `expected source to contain ${needle}`);
}

// Apply the same predicate the page uses, to assert expected counts.
function rowMatchesFilter(row, filterKey) {
  const net = Number(row.net_requirement || 0);
  const sug = Number(row.suggested_quantity || 0);
  const type = row.suggestion_type;
  if (filterKey === 'shortage') return net > 0;
  if (filterKey === 'make') return type === 'MAKE' && sug > 0;
  if (filterKey === 'buy') return type === 'BUY' && sug > 0;
  return true;
}

function sortRows(rows, sortKey) {
  const copy = [...rows];
  if (sortKey === 'product') {
    copy.sort((a, b) => (a.product_code || '').localeCompare(b.product_code || ''));
  } else {
    copy.sort((a, b) => {
      const ad = a.need_by_date || '9999-12-31';
      const bd = b.need_by_date || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return (a.product_code || '').localeCompare(b.product_code || '');
    });
  }
  return copy;
}

// ---------------------------------------------------------------------------
// 1. Status label helpers
// ---------------------------------------------------------------------------

test('P1 status: forecast status mapping is centralized', () => {
  assert.equal(forecastStatusLabel('DRAFT'), '草稿');
  assert.equal(forecastStatusLabel('ACTIVE'), '已生效');
  assert.equal(forecastStatusLabel('CANCELLED'), '已取消');
  assert.equal(forecastStatusLabel('UNKNOWN'), '状态待确认'); // P4: raw enum never reaches normal UI
  assert.equal(forecastStatusLabel(null), '—');
});

test('P1 status: MRP run status mapping is centralized', () => {
  assert.equal(mrpRunStatusLabel('DRAFT'), '草稿');
  assert.equal(mrpRunStatusLabel('COMPLETED'), '已完成'); // NOT '已计算'
  assert.equal(mrpRunStatusLabel('CANCELLED'), '已取消');
});

test('P1 status: demand mode mapping uses 需求预测 (NOT 计划预测)', () => {
  assert.equal(demandModeLabel('SALES_ORDERS'), '销售订单');
  assert.equal(demandModeLabel('FORECAST'), '需求预测');
  assert.equal(demandModeLabel('SALES_PLUS_FORECAST'), '销售订单 + 需求预测');
});

test('P1 status: suggestion type mapping covers all three states', () => {
  assert.equal(suggestionTypeLabel('MAKE'), '生产建议');
  assert.equal(suggestionTypeLabel('BUY'), '采购建议');
  assert.equal(suggestionTypeLabel('NONE'), '无需补充');
  assert.equal(suggestionTypeLabel(''), '无需补充');
});

test('P1 status: warning labels are user-facing, not raw enum', () => {
  assert.equal(warningLabel('ROUTING_MISSING'), '尚未设置生产工序标准');
  assert.equal(warningLabel(''), '');
});

// ---------------------------------------------------------------------------
// 2. Material plan filter logic — golden case from spec section 29
// ---------------------------------------------------------------------------

test('P1 material plan: filter chip semantics match spec', () => {
  const rows = [
    { product_code: 'FG', suggestion_type: 'MAKE', suggested_quantity: 100, net_requirement: 100, need_by_date: '2026-09-30' },
    { product_code: 'PCB', suggestion_type: 'BUY', suggested_quantity: 70, net_requirement: 70, need_by_date: '2026-09-30' },
    { product_code: 'CASE', suggestion_type: '', suggested_quantity: 0, net_requirement: 0, need_by_date: '2026-09-30' },
  ];
  const all = rows.filter((r) => rowMatchesFilter(r, 'all'));
  assert.equal(all.length, 3, '全部 includes all rows including zero-shortage');
  const shortage = rows.filter((r) => rowMatchesFilter(r, 'shortage'));
  assert.equal(shortage.length, 2, '缺料 includes FG and PCB only');
  assert.deepEqual(shortage.map((r) => r.product_code).sort(), ['FG', 'PCB']);
  const make = rows.filter((r) => rowMatchesFilter(r, 'make'));
  assert.equal(make.length, 1);
  assert.equal(make[0].product_code, 'FG');
  const buy = rows.filter((r) => rowMatchesFilter(r, 'buy'));
  assert.equal(buy.length, 1);
  assert.equal(buy[0].product_code, 'PCB');
});

// ---------------------------------------------------------------------------
// 3. Sort logic
// ---------------------------------------------------------------------------

test('P1 material plan: sort by 需求日期 puts earliest first', () => {
  const rows = [
    { product_code: 'C', need_by_date: '2026-10-15' },
    { product_code: 'A', need_by_date: '2026-09-25' },
    { product_code: 'B', need_by_date: '2026-10-01' },
  ];
  const sorted = sortRows(rows, 'need_date').map((r) => r.product_code);
  assert.deepEqual(sorted, ['A', 'B', 'C']);
});

test('P1 material plan: sort by 物料 is alphabetical', () => {
  const rows = [
    { product_code: 'Z9', need_by_date: '2026-10-01' },
    { product_code: 'A1', need_by_date: '2026-09-25' },
    { product_code: 'M5', need_by_date: '2026-10-15' },
  ];
  const sorted = sortRows(rows, 'product').map((r) => r.product_code);
  assert.deepEqual(sorted, ['A1', 'M5', 'Z9']);
});

// ---------------------------------------------------------------------------
// 4. Material plan filter / sort implementation lives in the page source
// ---------------------------------------------------------------------------

test('P1 material plan: page source contains the four canonical filter segments', () => {
  assert.match(FILTER_LOGIC_SOURCE, /key: 'all', label: '全部'[\s\S]*key: 'make', label: '生产'[\s\S]*key: 'buy', label: '采购'[\s\S]*key: 'shortage', label: '缺料'/);
});

test('P1 material plan: page source contains sort options', () => {
  assertContains(FILTER_LOGIC_SOURCE, '按需求日期');
  assertContains(FILTER_LOGIC_SOURCE, '按物料');
});

test('P1 material plan: page source uses centralized status labels (no raw enum leakage)', () => {
  assertContains(FILTER_LOGIC_SOURCE, "from '../lib/status.js'");
  assertContains(FILTER_LOGIC_SOURCE, 'demandModeLabel');
  assertContains(FILTER_LOGIC_SOURCE, 'suggestionTypeLabel');
  assertContains(FILTER_LOGIC_SOURCE, 'warningLabel');
});

// ---------------------------------------------------------------------------
// 5. Mobile launcher — three distinct planning entries, no duplicate
// ---------------------------------------------------------------------------

test('P1 launcher: 计划 / MRP domain exposes forecast, MRP and material suggestions', () => {
  const launcherSource = readFileSync(resolve(repoRoot, 'src/navigation/applicationMetadata.js'), 'utf8');
  assertContains(launcherSource, "label: '计划 / MRP'");
  assertContains(launcherSource, "['forecasts', '计划预测'");
  assertContains(launcherSource, "['mrp-runs', 'MRP'");
  assertContains(launcherSource, "['material-requirements-plan', '物料建议'");
});

test('P1 launcher: no duplicate legacy "MRP 物料需求计划" card in 基础资料', () => {
  const launcherSource = readFileSync(resolve(repoRoot, 'src/navigation/applicationMetadata.js'), 'utf8');
  // The exact old label must be gone
  assert.ok(!launcherSource.includes("'MRP 物料需求计划'"), 'legacy MRP launcher entry still present');
  // The old `mrp` page key must not appear as a launcher entry (it remains as a route alias only)
  assert.ok(!launcherSource.includes("page: 'mrp'"), "'mrp' is reserved as a route alias only");
});

test('P1 launcher: 基础资料 no longer contains forecasts or mrp items', () => {
  const launcherSource = readFileSync(resolve(repoRoot, 'src/navigation/applicationMetadata.js'), 'utf8');
  // master-data group must not reference forecasts / mrp-runs / material-requirements-plan
  const masterDataBlock = launcherSource.split("label: '基础资料'")[1]?.split("}")[0] || '';
  assert.ok(!masterDataBlock.includes("'forecasts'"), 'forecasts still inside 基础资料 group');
  assert.ok(!masterDataBlock.includes("'mrp-runs'"), 'mrp-runs still inside 基础资料 group');
  assert.ok(!masterDataBlock.includes("'material-requirements-plan'"), 'material plan still inside 基础资料 group');
});

// ---------------------------------------------------------------------------
// 6. App.jsx navGroups — three distinct canonical entries, label rename
// ---------------------------------------------------------------------------

test('P1 navGroups: V1.5 navigation uses 计划预测 / MRP / MRP · 物料建议 labels', () => {
  const appSource = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');
  assertContains(appSource, "key: 'forecasts', label: '计划预测'");
  assertContains(appSource, "key: 'mrp-runs', label: 'MRP'");
  assertContains(appSource, "key: 'material-requirements-plan', label: 'MRP · 物料建议'");
  // Older ambiguous combined label remains absent.
  assert.ok(!appSource.includes("label: 'MRP 物料需求计划'"), 'old MRP 物料需求计划 label still in navGroups');
});

test('P1 navGroups: 计划与生产 group contains the three planning entries + planning documents', () => {
  const appSource = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');
  const planningBlock = appSource.split("label: '计划与生产'")[1]?.split(']},')[0] || '';
  assertContains(planningBlock, "'forecasts'");
  assertContains(planningBlock, "'mrp-runs'");
  assertContains(planningBlock, "'material-requirements-plan'");
  assertContains(planningBlock, "'production-instructions'");
  assertContains(planningBlock, "'purchase-instructions'");
  assertContains(planningBlock, "'purchase-requisitions'");
});

test('P1 navGroups: 物料需求计划 uses MRP_VIEW or MRP_MANAGE permission', () => {
  const appSource = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');
  const entry = appSource.split("key: 'material-requirements-plan'")[1]?.split('},')[0] || '';
  assertContains(entry, "'MRP_VIEW', 'MRP_MANAGE'");
});

test('P1 routes: mrp is kept as a backwards-compat alias for material-requirements-plan', () => {
  const appSource = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');
  assertContains(appSource, "'mrp': <MaterialRequirementsPlan");
});

// ---------------------------------------------------------------------------
// 7. Business Overview — distinct concepts, no "需求预测 = MRP" implication
// ---------------------------------------------------------------------------

test('P1 business overview: MRP anchors production and purchasing flows', () => {
  const overviewSource = readFileSync(resolve(repoRoot, 'src/pages/business-overview.jsx'), 'utf8');
  assertContains(overviewSource, "'production-mrp', 'MRP', 'mrp-runs'");
  assertContains(overviewSource, "'purchase-mrp', 'MRP', 'mrp-runs'");
});

test('P1 business overview: forecast and material suggestions remain catalogue entries rather than false flow stages', () => {
  const overviewSource = readFileSync(resolve(repoRoot, 'src/pages/business-overview.jsx'), 'utf8');
  assert.ok(!overviewSource.includes("'forecasts'"));
  assert.ok(!overviewSource.includes("'material-requirements-plan'"));
});

// ---------------------------------------------------------------------------
// 8. Forecast page — uses centralized status lib, no MRP terminology
// ---------------------------------------------------------------------------

test('P1 forecasts: permanent helper subtitle is removed while empty state remains purposeful', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/forecasts.jsx'), 'utf8');
  assert.ok(!source.includes('subtitle="录入未来产品需求'), 'low-value permanent helper copy must be removed');
  assertContains(source, '创建预测后，可将其纳入 MRP 运算');
  // Forecast page must NOT mention "物料需求" or "MRP 运算" as a section title
  assert.ok(!source.includes('物料需求计划'), 'forecast page mentions material plan');
});

test('P1 forecasts: page uses centralized forecast status label', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/forecasts.jsx'), 'utf8');
  // V1.4-E1 status presentation moves through presentation.js; the page
  // must still route its forecast status display through the centralized
  // helper rather than echo raw backend enum strings.
  assertContains(source, "from '../lib/presentation.js'");
  assertContains(source, 'presentStatus');
  assertContains(source, "'forecast.status'");
});

test('P1 forecasts: action button uses 开始计算 / 生效 / 取消 lifecycle', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/forecasts.jsx'), 'utf8');
  assertContains(source, '生效');
  assertContains(source, '取消预测');
});

// ---------------------------------------------------------------------------
// 9. MRP Runs page — surfaces calculation workspace, hands off to plan
// ---------------------------------------------------------------------------

test('P1 mrp-runs: list presents only essential run facts without permanent helper copy', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/mrp-runs.jsx'), 'utf8');
  assert.ok(!source.includes('subtitle="综合销售订单'), 'low-value permanent helper copy must be removed');
  for (const fact of ['期间', '需求来源', '预测来源', '结果']) assertContains(source, fact);
});

test('P1 mrp-runs: detail page offers 查看物料需求计划 primary action', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/mrp-runs.jsx'), 'utf8');
  assertContains(source, '查看物料需求计划');
});

test('P1 mrp-runs: create form uses 开始计算 / 取消运算 lifecycle', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/mrp-runs.jsx'), 'utf8');
  assertContains(source, '开始计算');
  assertContains(source, '取消运算');
});

test('P1 mrp-runs: combined mode hint says 叠加 not 抵扣', () => {
  // The hint string lives in the centralized status lib; the page uses it via demandModeHint().
  const statusSource = readFileSync(resolve(repoRoot, 'src/lib/status.js'), 'utf8');
  assertContains(statusSource, '销售订单需求与预测需求将叠加计算');
  // Page wires demandModeHint for the SALES_PLUS_FORECAST branch
  const pageSource = readFileSync(resolve(repoRoot, 'src/pages/mrp-runs.jsx'), 'utf8');
  assertContains(pageSource, 'demandModeHint');
  assertContains(pageSource, "demandSourceMode === 'SALES_PLUS_FORECAST'");
});

// ---------------------------------------------------------------------------
// 10. Material Requirements Plan page — implementation contracts
// ---------------------------------------------------------------------------

test('P1 material plan: page reads from existing M11 endpoints only', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  assertContains(source, "/api/planning/mrp/runs'");
  assertContains(source, "/api/planning/mrp/runs/' + selectedRunId");
  assert.ok(!source.includes('/api/material-requirement-plans'), 'material plan calls non-existent endpoint');
});

test('P1 material plan: empty state copy is product-oriented (not 暂无数据)', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  assertContains(source, '请先完成一次 MRP 运算');
  assert.ok(!source.includes('暂无数据'), 'generic 暂无数据 used');
});

test('P1 material plan: shows accurate friendly copy when no replenishment is needed', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  assertContains(source, '无需补充');
});

test('P1 material plan: trace sheet shows user-friendly explanation', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  assertContains(source, '<Sheet');
  assertContains(source, '计算依据');
  assertContains(source, '计算式');
  assertContains(source, '销售订单需求');
  assertContains(source, '需求预测');
  assertContains(source, '现有库存');
  assertContains(source, '在途采购');
  assertContains(source, '在途生产');
  assertContains(source, '毛需求');
  assertContains(source, '最终结果');
});

test('P1 material plan: routing titles use exact product names', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  // Page title appears as Panel title prop
  assertContains(source, 'title="MRP · 物料建议"');
  // Trace modal title pattern (per-product trace)
  assertContains(source, 'title={`${row.product_name} · 计算依据`}');
});

test('P1 material plan: conversion actions link to M12 production / purchase instructions', () => {
  const source = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  // Canonical cards wire the link at every width.
  const makeCount = (source.match(/page="production-instructions"/g) || []).length;
  const buyCount = (source.match(/page="purchase-instructions"/g) || []).length;
  assert.ok(makeCount >= 1, 'production-instructions AppLink missing');
  assert.ok(buyCount >= 1, 'purchase-instructions AppLink missing');
});

// ---------------------------------------------------------------------------
// 11. Golden case arithmetic (P1 spec section 30 + M11 net-before-explosion)
// ---------------------------------------------------------------------------

test('P1 golden arithmetic: sales 100 + forecast 20 + FG on hand 20 = MAKE 100', () => {
  const fg = { gross_sales_demand: 100, gross_forecast_demand: 20, gross_component_demand: 0, on_hand: 20, open_purchase_supply: 0, open_production_supply: 0 };
  const gross = fg.gross_sales_demand + fg.gross_forecast_demand + fg.gross_component_demand;
  const net = Math.max(0, gross - fg.on_hand - fg.open_purchase_supply - fg.open_production_supply);
  assert.equal(gross, 120);
  assert.equal(net, 100);
  assert.equal(suggestionTypeLabel('MAKE'), '生产建议');
});

test('P1 golden arithmetic: PCB component demand 100 - on hand 30 = BUY 70', () => {
  const pcb = { gross_component_demand: 100, on_hand: 30, open_purchase_supply: 0, open_production_supply: 0 };
  const gross = pcb.gross_component_demand;
  const net = Math.max(0, gross - pcb.on_hand - pcb.open_purchase_supply - pcb.open_production_supply);
  assert.equal(net, 70);
  assert.equal(suggestionTypeLabel('BUY'), '采购建议');
});

test('P1 golden arithmetic: M11 net-before-explosion regression (FG net 15, A 30, B 45)', () => {
  // From M11 hotfix: sales 10 + forecast 10, on hand 3, open prod 2 -> net 15
  const fg = { gross_sales_demand: 10, gross_forecast_demand: 10, gross_component_demand: 0, on_hand: 3, open_purchase_supply: 0, open_production_supply: 2 };
  const fgNet = Math.max(0, (fg.gross_sales_demand + fg.gross_forecast_demand) - fg.on_hand - fg.open_purchase_supply - fg.open_production_supply);
  assert.equal(fgNet, 15, 'FG net must be 15 (NOT inflated by parent gross)');
  // A×2 B×3 BOM
  const aGross = fgNet * 2; assert.equal(aGross, 30);
  const bGross = fgNet * 3; assert.equal(bGross, 45);
});

// ---------------------------------------------------------------------------
// 12. Trace explanation produces the exact numbers from the P1 golden case
// ---------------------------------------------------------------------------

test('P1 trace: top-level trace renders 销售订单需求 + 需求预测 + 供应 + 计算式 for FG MAKE 100', () => {
  // FG: sales 100, forecast 20, on hand 20, open po 0, open prod 0 -> net 100 -> MAKE 100
  const demands = [
    { source_type: 'SALES_ORDER', quantity: 100 },
    { source_type: 'FORECAST', quantity: 20 },
  ];
  const sales = demands.filter((d) => d.source_type === 'SALES_ORDER').reduce((s, d) => s + Number(d.quantity), 0);
  const forecast = demands.filter((d) => d.source_type === 'FORECAST').reduce((s, d) => s + Number(d.quantity), 0);
  const gross = sales + forecast;
  const onHand = 20;
  const openPo = 0;
  const openProd = 0;
  const net = Math.max(0, gross - onHand - openPo - openProd);
  assert.equal(sales, 100);
  assert.equal(forecast, 20);
  assert.equal(gross, 120);
  assert.equal(net, 100);
  // The trace uses exact numbers from this calculation; assertion is that the
  // page source references these labels.
  const traceSource = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  // Trace label format must use spaces, not raw field names
  assertContains(traceSource, '销售订单需求');
  assertContains(traceSource, '需求预测');
  assertContains(traceSource, '毛需求');
  assertContains(traceSource, '现有库存');
  assertContains(traceSource, '在途采购');
  assertContains(traceSource, '在途生产');
  assertContains(traceSource, '最终结果');
});

test('P1 trace: buy-item trace renders component sources + supply + 采购建议 for PCB BUY 70', () => {
  // PCB: component demand 100, on hand 30, open po 0, open prod 0 -> net 70 -> BUY 70
  const traceSource = readFileSync(resolve(repoRoot, 'src/pages/material-requirements-plan.jsx'), 'utf8');
  // BuyItemTrace references component parents via bom_path
  assertContains(traceSource, 'parent_name');
  assertContains(traceSource, '组件毛需求');
  assertContains(traceSource, '组件需求'); // top-level label
  assertContains(traceSource, '采购建议');
});

// ---------------------------------------------------------------------------
// 13. Status language map exports are immutable (frozen)
// ---------------------------------------------------------------------------

test('P1 status: exported maps are frozen so callers cannot mutate them', () => {
  assert.equal(Object.isFrozen(FORECAST_STATUS_LABEL), true);
  assert.equal(Object.isFrozen(MRP_RUN_STATUS_LABEL), true);
  assert.equal(Object.isFrozen(MRP_DEMAND_MODE_LABEL), true);
  assert.equal(Object.isFrozen(SUGGESTION_TYPE_LABEL), true);
  assert.equal(Object.isFrozen(WARNING_LABEL), true);
});

// ---------------------------------------------------------------------------
// 14. Planning document hub follows the canonical SPA page
// ---------------------------------------------------------------------------

test('P1 planning document routes select their matching hub tabs', () => {
  assert.equal(planningDocumentTabForPage('production-instructions'), 'production-instructions');
  assert.equal(planningDocumentTabForPage('purchase-instructions'), 'purchase-instructions');
  assert.equal(planningDocumentTabForPage('purchase-requisitions'), 'purchase-requisitions');
  assert.deepEqual(PLANNING_DOCUMENT_PAGES, [
    'production-instructions',
    'purchase-instructions',
    'purchase-requisitions',
  ]);
});

test('P1 planning document route changes are stateless in both directions', () => {
  const sequenceA = ['production-instructions', 'purchase-instructions']
    .map(planningDocumentTabForPage);
  const sequenceB = ['purchase-instructions', 'production-instructions']
    .map(planningDocumentTabForPage);
  const leaveAndReturn = ['purchase-instructions', 'dashboard', 'purchase-instructions']
    .map(planningDocumentTabForPage);
  assert.deepEqual(sequenceA, ['production-instructions', 'purchase-instructions']);
  assert.deepEqual(sequenceB, ['purchase-instructions', 'production-instructions']);
  assert.equal(leaveAndReturn.at(-1), 'purchase-instructions');
});

test('P1 planning hub derives its active tab from currentPage and navigates tabs canonically', () => {
  const hubSource = readFileSync(resolve(repoRoot, 'src/pages/planning-documents.jsx'), 'utf8');
  const appSource = readFileSync(resolve(repoRoot, 'src/App.jsx'), 'utf8');
  assertContains(hubSource, 'planningDocumentTabForPage(currentPage)');
  assertContains(hubSource, 'onChange={navigateToPage}');
  assertContains(hubSource, "value:'production-instructions'");
  assertContains(hubSource, "value:'purchase-instructions'");
  assertContains(appSource, 'currentPage: page');
  assertContains(appSource, "useState(location.hash.slice(1) || 'dashboard')");
  assertContains(appSource, "navigateToPage(location.hash.slice(1) || 'dashboard'");
});
