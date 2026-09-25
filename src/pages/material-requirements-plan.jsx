// 物料需求计划 / Material Requirements Plan page.
//
// P1 — read-only derived view over an MRP run. NO new database tables.
// Reads existing mrp_runs / mrp_run_results / mrp_run_components /
// mrp_run_pegging via /api/planning/mrp/runs/:id.
//
// One canonical card architecture at every width. Four segments
// (全部 / 生产 / 采购 / 缺料). Sort by
// 需求日期 (default) or 物料. Trace view explains the numbers in
// user-friendly product language, never engineering terms.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { Empty, Loading, Panel } from '../components/ui.jsx';
import { BottomActionBar, EmptyState, SecondaryButton, SegmentedControl, Sheet } from '../components/design-system.jsx';
import {
  demandModeLabel,
  suggestionTypeLabel,
  warningLabel,
} from '../lib/status.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'make', label: '生产' },
  { key: 'buy', label: '采购' },
  { key: 'shortage', label: '缺料' },
];

const SORTS = [
  { key: 'need_date', label: '按需求日期' },
  { key: 'product', label: '按物料' },
];

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(n);
}

function fmtDateShort(value) {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text;
  return `${parseInt(match[2], 10)}月${parseInt(match[3], 10)}日`;
}

// Apply the active filter chip to a result row.
function rowMatchesFilter(row, filterKey) {
  const net = Number(row.net_requirement || 0);
  const sug = Number(row.suggested_quantity || 0);
  const type = row.suggestion_type;
  if (filterKey === 'shortage') return net > 0;
  if (filterKey === 'make') return type === 'MAKE' && sug > 0;
  if (filterKey === 'buy') return type === 'BUY' && sug > 0;
  return true;
}

// Sort comparator
function sortRows(rows, sortKey) {
  const copy = [...rows];
  if (sortKey === 'product') {
    copy.sort((a, b) => (a.product_code || '').localeCompare(b.product_code || ''));
  } else {
    // default: by need_by_date asc, then product_code
    copy.sort((a, b) => {
      const ad = a.need_by_date || '9999-12-31';
      const bd = b.need_by_date || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return (a.product_code || '').localeCompare(b.product_code || '');
    });
  }
  return copy;
}

// Group rows by ISO week (yyyy-Www) for optional "按周" presentation
function isoWeekKey(dateStr) {
  if (!dateStr) return '未指定日期';
  const text = String(dateStr).slice(0, 10);
  const d = new Date(text + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '未指定日期';
  // Compute ISO week
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function formatWeekRange(weekKey) {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return weekKey;
  // Approximate Monday-Sunday for visual grouping only
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = simple.getUTCDay();
  const ISOweekStart = new Date(simple);
  if (day <= 4) ISOweekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  else ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  const start = ISOweekStart;
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const fmt = (d) => `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  return `${fmt(start)}–${fmt(end)}`;
}

export default function MaterialRequirementsPlan({ notify }) {
  const navigation = useAppNavigation();
  const [runs, setRuns] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('need_date');
  const [traceRow, setTraceRow] = useState(null);

  // Load list of runs (to find latest COMPLETED and allow switching)
  useEffect(() => {
    api('/api/planning/mrp/runs')
      .then((result) => {
        const all = result.runs || [];
        setRuns(all);
        if (navigation.target?.documentId) {
          setSelectedRunId(navigation.target.documentId);
        } else {
          const completed = all.filter((r) => r.status === 'COMPLETED');
          const latest = completed.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))[0];
          if (latest) setSelectedRunId(latest.id);
        }
      })
      .catch((error) => notify(error.message, 'error'));
  }, []);

  // Load selected run detail (results / pegging / components / demands)
  useEffect(() => {
    if (!selectedRunId) { setRun(null); return; }
    let current = true;
    api('/api/planning/mrp/runs/' + selectedRunId)
      .then((result) => { if (current) setRun(result.run); })
      .catch((error) => { if (current) notify(error.message, 'error'); });
    return () => { current = false; };
  }, [selectedRunId]);

  const summary = run?.summary || null;

  // Apply filter + sort to results
  const visibleRows = useMemo(() => {
    if (!run?.results) return [];
    return sortRows(
      run.results.filter((row) => rowMatchesFilter(row, filter)),
      sort,
    );
  }, [run, filter, sort]);

  // Group by week when sort is need_date (visual grouping only)
  const grouped = useMemo(() => {
    if (sort !== 'need_date') return null;
    const map = new Map();
    for (const row of visibleRows) {
      const key = isoWeekKey(row.need_by_date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return [...map.entries()].map(([weekKey, items]) => ({ weekKey, items }));
  }, [visibleRows, sort]);

  if (runs === null) return <Loading/>;

  if (runs.length === 0) {
    return <Panel title="物料需求计划">
      <Empty text="还没有可查看的物料需求计划。请先完成一次 MRP 运算。"/>
      <div className="form-actions full">
        <AppLink page="mrp-runs" className="primary">前往 MRP 运算</AppLink>
      </div>
    </Panel>;
  }

  const completedRuns = runs.filter((r) => r.status === 'COMPLETED');
  if (completedRuns.length === 0) {
    return <Panel title="物料需求计划">
      <Empty text="还没有可查看的物料需求计划。请先完成一次 MRP 运算。"/>
      <div className="form-actions full">
        <AppLink page="mrp-runs" className="primary">前往 MRP 运算</AppLink>
      </div>
    </Panel>;
  }

  if (!run) return <Loading/>;

  return <>
    <Panel title="物料需求计划">
      <label className="material-run-selector">
        <span>MRP 运算</span>
        <select aria-label="切换 MRP 运算" value={selectedRunId || ''} onChange={(e) => setSelectedRunId(e.target.value)}>
        {runs.filter((r) => r.status === 'COMPLETED').map((r) => <option key={r.id} value={r.id}>{r.run_name}（{r.run_code}）</option>)}
        </select>
      </label>
      <p className="material-run-meta">{demandModeLabel(run.demand_source_mode)} · {run.horizon_start} ~ {run.horizon_end}</p>
      <MaterialSummary summary={summary} run={run}/>
      <div className="material-plan-controls">
        <SegmentedControl
          label="物料建议筛选"
          options={FILTERS.map(({ key, label }) => ({ value: key, label }))}
          value={filter}
          onChange={setFilter}
        />
        <label className="filter-sort">
          排序
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {visibleRows.length === 0
        ? filter === 'all' ? <MaterialPlanZeroState/> : <Empty text="当前筛选条件下没有匹配的物料。"/>
        : <MaterialPlanList grouped={grouped} rows={visibleRows} onTrace={setTraceRow}/>
      }
    </Panel>
    {traceRow && <MaterialTraceSheet
      run={run}
      row={traceRow}
      onClose={() => setTraceRow(null)}
    />}
  </>;
}

function MaterialSummary({ summary, run }) {
  if (!summary) return null;
  return <div className="material-summary-grid">
    <div className="material-summary-item">
      <span>物料</span>
      <strong>{summary.totalProducts}</strong>
    </div>
    <div className="material-summary-item">
      <span>生产建议</span>
      <strong>{summary.makeSuggestions}</strong>
    </div>
    <div className="material-summary-item">
      <span>采购建议</span>
      <strong>{summary.buySuggestions}</strong>
    </div>
    <div className="material-summary-item">
      <span>缺料</span>
      <strong>{summary.shortageProducts}</strong>
    </div>
  </div>;
}

function MaterialPlanZeroState() {
  return <EmptyState
    title="本次计算期间内没有可纳入的需求"
    description="请检查销售订单是否已审批且提交、审批或创建日期位于计算期间内，并检查需求预测需求日期和计算期间。"
    action={<AppLink page="mrp-runs" className="primary">重新运行 MRP</AppLink>}
  />;
}

function MaterialPlanList({ grouped, rows, onTrace }) {
  return <div className="material-plan-list">
    {grouped && grouped.map((group) => <div className="material-plan-week" key={group.weekKey}>
      <div className="material-plan-week__label">{formatWeekRange(group.weekKey)}</div>
      {group.items.map((row) => <MaterialCard key={row.id} row={row} onTrace={onTrace}/>)}
    </div>)}
    {!grouped && rows.map((row) => <MaterialCard key={row.id} row={row} onTrace={onTrace}/>)}
  </div>;
}

function MaterialCard({ row, onTrace }) {
  const net = Number(row.net_requirement || 0);
  const sug = Number(row.suggested_quantity || 0);
  const suggestion = row.suggestion_type;
  const dateText = row.need_by_date ? `${fmtDateShort(row.need_by_date)}前需要` : '—';
  const warning = row.warning ? warningLabel(row.warning) : '';
  const hasSuggestion = sug > 0 && Boolean(suggestion);
  const kindLabel = hasSuggestion ? suggestionTypeLabel(suggestion) : '无需补充';
  const kindClass = hasSuggestion ? suggestion.toLowerCase() : 'ok';

  return <article className={`material-card material-card--${kindClass}`}>
    <header className="material-card__head">
      <div>
        <strong className="mono">{row.product_code}</strong>
        <span>{row.product_name}</span>
      </div>
      <span className={`material-card__chip is-${kindClass}`}>{kindLabel}</span>
    </header>
    <dl className="material-card__rows">
      <div><dt>建议数量</dt><dd><strong>{fmtQty(sug)}</strong></dd></div>
      <div><dt>净需求</dt><dd><strong>{fmtQty(net)}</strong></dd></div>
      <div><dt>现有库存</dt><dd>{fmtQty(row.on_hand)}</dd></div>
    </dl>
    <div className="material-card__meta">
      <span>{dateText}</span>
      {warning && <span className="material-card__warning">{warning}</span>}
    </div>
    <div className="material-card__footer">
      <button type="button" className="material-card__trace" onClick={() => onTrace(row)}>查看计算依据</button>
      {suggestion === 'MAKE' && <AppLink page="production-instructions" className="primary">创建生产指令</AppLink>}
      {suggestion === 'BUY' && <AppLink page="purchase-instructions" className="primary">创建采购指令</AppLink>}
    </div>
  </article>;
}

// User-friendly trace view explaining the math behind a result row.
// Uses existing mrp_run_demands / mrp_run_components / mrp_run_pegging.
function MaterialTraceSheet({ run, row, onClose }) {
  const demands = (run.demands || []).filter((d) => d.product_id === row.product_id);
  const pegging = (run.pegging || []).filter((p) => p.result_product_id === row.product_id);
  const components = (run.components || []).filter((c) => c.product_id === row.product_id);
  const gross = Number(row.gross_requirement || 0);
  const component = Number(row.gross_component_demand || 0);
  const onHand = Number(row.on_hand || 0);
  const openPo = Number(row.open_purchase_supply || 0);
  const openProd = Number(row.open_production_supply || 0);
  const net = Number(row.net_requirement || 0);
  const sug = Number(row.suggested_quantity || 0);

  const suggestion = row.suggestion_type;
  const suggestionLabel = suggestionTypeLabel(suggestion);
  const isTopLevel = demands.length > 0;
  const parentsText = components
    .map((c) => `${c.parent_name || ''}${c.bom_path ? `（${c.bom_path.replace(/^[^>]+>\s*/, '')}）` : ''}`)
    .filter(Boolean);

  return <Sheet title={`${row.product_name} · 计算依据`} onClose={onClose}>
    <div className="material-calculation-trace">
      {isTopLevel ? <TopLevelTrace
      row={row}
      demands={demands}
      component={component}
      gross={gross}
      onHand={onHand}
      openPo={openPo}
      openProd={openProd}
      net={net}
      sug={sug}
      suggestionLabel={suggestionLabel}
      /> : <BuyItemTrace
      row={row}
      components={components}
      pegging={pegging}
      gross={gross}
      onHand={onHand}
      openPo={openPo}
      openProd={openProd}
      net={net}
      sug={sug}
      parentsText={parentsText}
      />}
    </div>
    <BottomActionBar><SecondaryButton type="button" onClick={onClose}>关闭</SecondaryButton></BottomActionBar>
  </Sheet>;
}

function TopLevelTrace({ demands, component, gross, onHand, openPo, openProd, net, sug, suggestionLabel }) {
  const sales = demands.filter((d) => d.source_type === 'SALES_ORDER').reduce((s, d) => s + Number(d.quantity || 0), 0);
  const forecast = demands.filter((d) => d.source_type === 'FORECAST').reduce((s, d) => s + Number(d.quantity || 0), 0);
  return <>
    <h3>需求来源</h3>
    <dl className="trace-list">
      <div><dt>销售订单需求</dt><dd>{fmtQty(sales)}</dd></div>
      <div><dt>需求预测</dt><dd>{fmtQty(forecast)}</dd></div>
      <div><dt>组件需求</dt><dd>{fmtQty(component)}</dd></div>
      <div><dt>毛需求</dt><dd><strong>{fmtQty(gross)}</strong></dd></div>
    </dl>
    <h3>供应情况</h3>
    <dl className="trace-list">
      <div><dt>现有库存</dt><dd>{fmtQty(onHand)}</dd></div>
      <div><dt>在途采购</dt><dd>{fmtQty(openPo)}</dd></div>
      <div><dt>在途生产</dt><dd>{fmtQty(openProd)}</dd></div>
    </dl>
    <h3>最终结果</h3>
    <dl className="trace-list">
      <div><dt>计算式</dt><dd>{fmtQty(gross)} − {fmtQty(onHand)} − {fmtQty(openPo)} − {fmtQty(openProd)} = <strong>{fmtQty(net)}</strong></dd></div>
      <div><dt>净需求</dt><dd><strong>{fmtQty(net)}</strong></dd></div>
      <div><dt>建议类型</dt><dd>{suggestionLabel}</dd></div>
      <div><dt>{suggestionLabel}</dt><dd><strong>{fmtQty(sug)}</strong></dd></div>
    </dl>
  </>;
}

function BuyItemTrace({ row, components, pegging, gross, onHand, openPo, openProd, net, sug, parentsText }) {
  return <>
    <h3>需求来源</h3>
    <dl className="trace-list">
      <div><dt>销售订单需求</dt><dd>{fmtQty(row.gross_sales_demand)}</dd></div>
      <div><dt>需求预测</dt><dd>{fmtQty(row.gross_forecast_demand)}</dd></div>
      <div><dt>组件需求</dt><dd>{fmtQty(row.gross_component_demand)}</dd></div>
    </dl>
    <h3>BOM 追溯</h3>
    {parentsText.length > 0 ? (
      <ul className="trace-parent-list">
        {parentsText.map((text, idx) => <li key={idx}>来自 {text}</li>)}
      </ul>
    ) : <p className="dim">本次运算中此项没有 BOM 组件需求来源。</p>}
    <dl className="trace-list">
      <div><dt>组件毛需求</dt><dd>{fmtQty(gross)}</dd></div>
    </dl>
    <h3>供应情况</h3>
    <dl className="trace-list">
      <div><dt>现有库存</dt><dd>{fmtQty(onHand)}</dd></div>
      <div><dt>在途采购</dt><dd>{fmtQty(openPo)}</dd></div>
      <div><dt>在途生产</dt><dd>{fmtQty(openProd)}</dd></div>
    </dl>
    <h3>最终结果</h3>
    <dl className="trace-list">
      <div><dt>计算式</dt><dd>{fmtQty(gross)} − {fmtQty(onHand)} − {fmtQty(openPo)} − {fmtQty(openProd)} = <strong>{fmtQty(net)}</strong></dd></div>
      <div><dt>净需求</dt><dd><strong>{fmtQty(net)}</strong></dd></div>
      <div><dt>采购建议</dt><dd><strong>{fmtQty(sug)}</strong></dd></div>
    </dl>
  </>;
}
