import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { Loading } from '../components/ui.jsx';
import { BottomActionBar, BusinessPageShell, EmptyState, SegmentedControl, Sheet } from '../components/design-system.jsx';
import { demandModeLabel, warningLabel } from '../lib/status.js';
import { MrpSummaryV16 } from './mrp-runs.jsx';

const FILTERS = [
  { value: 'all', label: '全部' }, { value: 'make', label: '生产' },
  { value: 'buy', label: '采购' }, { value: 'shortage', label: '缺料' },
];
const SORTS = [{ value: 'need_date', label: '按需求日期' }, { value: 'product', label: '按物料' }];

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(number);
}
function withUnit(value, unit) { const text = fmtQty(value); return unit && text !== '—' ? `${text} ${unit}` : text; }
function fmtDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : '需求日期未指定';
}
function matchesFilter(row, filter) {
  if (filter === 'shortage') return Number(row.net_requirement || 0) > 0;
  if (filter === 'make') return row.suggestion_type === 'MAKE' && Number(row.suggested_quantity || 0) > 0;
  if (filter === 'buy') return row.suggestion_type === 'BUY' && Number(row.suggested_quantity || 0) > 0;
  return true;
}
function sortRows(rows, sort) {
  return [...rows].sort((a, b) => {
    if (sort === 'product') return String(a.product_code || '').localeCompare(String(b.product_code || ''), 'zh-CN');
    const dateResult = String(a.need_by_date || '9999-12-31').localeCompare(String(b.need_by_date || '9999-12-31'));
    return dateResult || String(a.product_code || '').localeCompare(String(b.product_code || ''), 'zh-CN');
  });
}
function weekStart(dateText) {
  if (!dateText) return null;
  const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}
function weekLabel(key) {
  if (!key) return '需求日期未指定';
  const start = new Date(`${key}T00:00:00Z`); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const display = (date) => `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
  return `${display(start)}–${display(end)}`;
}
function conversionText(row) {
  const converted = Number(row.converted_quantity || 0); const remaining = Number(row.remaining_quantity || 0);
  if (remaining <= 0) return '已全部转为指令';
  if (converted > 0) return `已转指令 ${fmtQty(converted)} · 待处理 ${fmtQty(remaining)}`;
  return `待转指令 ${fmtQty(remaining)}`;
}
function resultType(row) {
  if (row.suggestion_type === 'MAKE') return '生产';
  if (row.suggestion_type === 'BUY') return '采购';
  return '无需补充';
}

export default function MaterialRequirementsPlan({ notify }) {
  const navigation = useAppNavigation();
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [listState, setListState] = useState('LOADING');
  const [detailState, setDetailState] = useState('IDLE');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('need_date');
  const [traceRow, setTraceRow] = useState(null);

  async function loadRuns() {
    setListState('LOADING');
    try {
      const result = await api('/api/planning/mrp/runs?status=COMPLETED');
      const completed = (result.runs || []).filter((item) => item.status === 'COMPLETED');
      setRuns(completed);
      const targetId = navigation.target?.documentId;
      const nextId = completed.some((item) => item.id === targetId) ? targetId : completed[0]?.id || null;
      setSelectedRunId(nextId);
      setListState(completed.length ? 'READY' : 'EMPTY');
    } catch (error) { setListState('ERROR'); notify(error.message, 'error'); }
  }
  useEffect(() => { void loadRuns(); }, []);
  useEffect(() => {
    const backTarget = selectedRunId && navigation.target?.originPage === 'mrp-runs'
      ? () => navigation.navigateToPage('mrp-runs', { documentId: selectedRunId })
      : () => navigation.navigateToPage('mrp-runs');
    navigation.setHeaderBackAction?.(backTarget);
    return () => navigation.setHeaderBackAction?.(null);
  }, [selectedRunId, navigation.target?.originPage]);
  useEffect(() => {
    if (!selectedRunId) { setRun(null); setDetailState('IDLE'); return; }
    let active = true;
    setDetailState('LOADING'); setTraceRow(null);
    api(`/api/planning/mrp/runs/${selectedRunId}`)
      .then((result) => { if (active) { setRun(result.run); setDetailState('READY'); } })
      .catch((error) => { if (active) { setDetailState('ERROR'); notify(error.message, 'error'); } });
    return () => { active = false; };
  }, [selectedRunId]);

  const visibleRows = useMemo(() => sortRows((run?.results || []).filter((row) => matchesFilter(row, filter)), sort), [run, filter, sort]);
  const groups = useMemo(() => {
    if (sort !== 'need_date') return [{ key: 'product', label: '', items: visibleRows }];
    const map = new Map();
    visibleRows.forEach((row) => { const key = weekStart(row.need_by_date); if (!map.has(key)) map.set(key, []); map.get(key).push(row); });
    return [...map.entries()].map(([key, items]) => ({ key: key || 'undated', label: weekLabel(key), items }));
  }, [visibleRows, sort]);

  if (listState === 'LOADING') return <BusinessPageShell className="v16-mrp-planning v16-material-plan" width="rail"><Loading/></BusinessPageShell>;
  if (listState === 'ERROR') return <BusinessPageShell className="v16-mrp-planning v16-material-plan" width="rail"><EmptyState title="加载失败" description="暂时无法获取已计算的 MRP 运算。" action={<button type="button" className="secondary" onClick={() => void loadRuns()}>重新加载</button>}/></BusinessPageShell>;
  if (listState === 'EMPTY') return <BusinessPageShell className="v16-mrp-planning v16-material-plan" width="rail"><EmptyState title="本次没有物料需求" description="请先完成一次 MRP 运算。" action={<AppLink page="mrp-runs" className="primary">前往 MRP</AppLink>}/></BusinessPageShell>;

  return <BusinessPageShell className="v16-mrp-planning v16-material-plan" width="rail">
    <section className="v16-material-plan__run">
      <label><span>MRP 运算</span><select aria-label="切换 MRP 运算" value={selectedRunId || ''} onChange={(event) => setSelectedRunId(event.target.value)}>{runs.map((item) => <option key={item.id} value={item.id}>{item.run_name} · {item.run_code}</option>)}</select></label>
      {run && <p>{demandModeLabel(run.demand_source_mode)} · {run.horizon_start} – {run.horizon_end}</p>}
    </section>
    {detailState === 'LOADING' && <Loading/>}
    {detailState === 'ERROR' && <EmptyState title="加载失败" description="暂时无法获取这次运算结果。" action={<button type="button" className="secondary" onClick={() => { const current = selectedRunId; setSelectedRunId(null); queueMicrotask(() => setSelectedRunId(current)); }}>重新加载</button>}/>}
    {detailState === 'READY' && run && <>
      <MrpSummaryV16 summary={run.summary}/>
      <div className="v16-material-plan__controls">
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} label="物料计划筛选"/>
        <label>排序<select value={sort} onChange={(event) => setSort(event.target.value)}>{SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </div>
      {(run.results || []).length === 0 && <EmptyState title="本次没有物料需求" description="当前期间没有可纳入计算的需求。" action={<AppLink page="mrp-runs" className="secondary">前往 MRP</AppLink>}/>}
      {(run.results || []).length > 0 && visibleRows.length === 0 && <EmptyState title="当前筛选没有结果" action={<button type="button" className="secondary" onClick={() => setFilter('all')}>查看全部</button>}/>}
      {visibleRows.length > 0 && <div className="v16-material-result-list">{groups.map((group) => <section className="v16-material-week" key={group.key}>{group.label && <h3>{group.label}</h3>}{group.items.map((row) => <MaterialResultRowV16 key={row.id} row={row} onOpen={() => setTraceRow(row)}/>)}</section>)}</div>}
    </>}
    {traceRow && <MaterialTraceSheetV16 run={run} row={traceRow} onClose={() => setTraceRow(null)}/>}
  </BusinessPageShell>;
}

function MaterialResultRowV16({ row, onOpen }) {
  const warning = warningLabel(row.warning);
  return <button type="button" className="v16-material-result-row" onClick={onOpen}>
    <span className="v16-material-result-row__head"><strong className="mono">{row.product_code}</strong><span className={`v16-material-type is-${String(row.suggestion_type || 'none').toLowerCase()}`}>{resultType(row)}</span></span>
    <span className="v16-material-result-row__name">{row.product_name}</span>
    <span className="v16-material-result-row__date">{row.need_by_date ? `${fmtDate(row.need_by_date)}前需要` : '需求日期未指定'}</span>
    <span className="v16-material-result-row__metrics"><span>建议 <b>{withUnit(row.suggested_quantity, row.product_unit)}</b></span><span>净需求 <b>{withUnit(row.net_requirement, row.product_unit)}</b></span><span>库存 <b>{withUnit(row.on_hand, row.product_unit)}</b></span></span>
    <span className="v16-material-result-row__foot"><span>{conversionText(row)}</span>{warning && <span className="v16-material-warning">{warning}</span>}<span aria-hidden="true">›</span></span>
  </button>;
}

function traceSources(run, row) {
  const components = (run.components || []).filter((item) => item.product_id === row.product_id);
  const pegging = (run.pegging || []).filter((item) => item.result_product_id === row.product_id);
  const labels = [];
  components.forEach((item) => { const text = [item.parent_code, item.parent_name].filter(Boolean).join(' · '); if (text && !labels.includes(text)) labels.push(text); });
  pegging.forEach((item) => { if (item.source_label && !labels.includes(item.source_label)) labels.push(item.source_label); });
  return labels;
}

function MaterialTraceSheetV16({ run, row, onClose }) {
  const unit = row.product_unit;
  const sources = traceSources(run, row);
  const remaining = Number(row.remaining_quantity || 0);
  const targetPage = row.suggestion_type === 'MAKE' ? 'production-instructions' : row.suggestion_type === 'BUY' ? 'purchase-instructions' : null;
  const targetLabel = row.suggestion_type === 'MAKE' ? '前往生产指令' : '前往采购指令';
  return <Sheet title={`${row.product_name} · 计算依据`} onClose={onClose} className="v16-material-trace-sheet">
    <div className="v16-material-trace">
      <TraceSection title="需求" rows={[
        ['销售订单需求', withUnit(row.gross_sales_demand, unit)], ['需求预测', withUnit(row.gross_forecast_demand, unit)],
        ['组件需求', withUnit(row.gross_component_demand, unit)], ['毛需求', withUnit(row.gross_requirement, unit)],
      ]}/>
      <TraceSection title="可用供应" rows={[
        ['现有库存', withUnit(row.on_hand, unit)], ['在途采购', withUnit(row.open_purchase_supply, unit)], ['在途生产', withUnit(row.open_production_supply, unit)],
      ]}/>
      <TraceSection title="净需求" rows={[
        ['计算式', `${fmtQty(row.gross_requirement)} − ${fmtQty(row.on_hand)} − ${fmtQty(row.open_purchase_supply)} − ${fmtQty(row.open_production_supply)}`],
        ['净需求', withUnit(row.net_requirement, unit)],
      ]}/>
      <TraceSection title="建议" rows={[
        ['建议类型', resultType(row)], ['建议数量', withUnit(row.suggested_quantity, unit)], ['已转指令', withUnit(row.converted_quantity, unit)], ['待处理', withUnit(row.remaining_quantity, unit)],
      ]}/>
      {sources.length > 0 && <section className="v16-material-trace__section"><h3>BOM 来源</h3><ul>{sources.map((source) => <li key={source}>{source}</li>)}</ul></section>}
      {remaining <= 0 && <p className="v16-material-trace__complete">已全部转为指令</p>}
    </div>
    <BottomActionBar><button type="button" className="secondary" onClick={onClose}>关闭</button>{remaining > 0 && targetPage && <AppLink page={targetPage} className="primary">{targetLabel}</AppLink>}</BottomActionBar>
  </Sheet>;
}

function TraceSection({ title, rows }) {
  return <section className="v16-material-trace__section"><h3>{title}</h3><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>;
}

export { conversionText, matchesFilter, sortRows };
