import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { can, Loading } from '../components/ui.jsx';
import { ActionMenu, BottomActionBar, BusinessPageShell, ConfirmSheet, DangerSheet, EmptyState, InlineAlert, SearchField, SegmentedControl, StatusChip } from '../components/design-system.jsx';
import { demandModeHint, demandModeLabel, mrpRunStatusLabel } from '../lib/status.js';

const STATUS_OPTIONS = [
  { value: '', label: '全部' }, { value: 'DRAFT', label: '草稿' },
  { value: 'COMPLETED', label: '已计算' }, { value: 'CANCELLED', label: '已取消' },
];
const todayIso = () => new Date().toISOString().slice(0, 10);
function plusDays(iso, days) { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function emptyRunForm() { const start = todayIso(); return { runName: '', horizonStart: start, horizonEnd: plusDays(start, 60), demandSourceMode: 'SALES_ORDERS', forecastId: '' }; }
function toRunForm(run) { return { runName: run.run_name || '', horizonStart: run.horizon_start || todayIso(), horizonEnd: run.horizon_end || todayIso(), demandSourceMode: run.demand_source_mode || 'SALES_ORDERS', forecastId: run.forecast_id || '' }; }
function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}
function runProgress(row) {
  if (row.status === 'DRAFT') return '待计算';
  if (row.status === 'CANCELLED') return '已取消';
  const s = row.summary || {};
  return `${s.totalProducts || 0}项物料 · ${s.makeSuggestions || 0}生产 · ${s.buySuggestions || 0}采购 · ${s.shortageProducts || 0}缺料`;
}

export default function MrpRuns({ user, notify }) {
  const navigation = useAppNavigation();
  const setHeaderBackAction = navigation.setHeaderBackAction;
  const canManage = can(user, 'MRP_MANAGE');
  const initialId = navigation.target?.page === 'mrp-runs' ? navigation.target.documentId : null;
  const [rows, setRows] = useState([]);
  const [listState, setListState] = useState('LOADING');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState(initialId || null);
  const [editor, setEditor] = useState(null);

  async function load() {
    setListState('LOADING');
    try {
      const result = await api('/api/planning/mrp/runs?limit=100&offset=0');
      const nextRows = result.runs || [];
      setRows(nextRows);
      setListState(nextRows.length ? 'READY' : 'EMPTY');
    } catch (error) { setListState('ERROR'); notify(error.message, 'error'); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (navigation.target?.page === 'mrp-runs' && navigation.target.documentId) setSelectedId(navigation.target.documentId); }, [navigation.target]);
  useEffect(() => {
    const handler = editor ? () => setEditor(null) : selectedId ? () => setSelectedId(null) : null;
    setHeaderBackAction?.(handler);
    return () => setHeaderBackAction?.(null);
    // App owns this callback; rerun only when the local full-page layer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selectedId]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('zh-CN');
    return rows.filter((row) => (!status || row.status === status) && (!needle || [row.run_code, row.run_name].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(needle))));
  }, [rows, search, status]);
  const openNew = () => { setSelectedId(null); setEditor({ runId: null }); };
  const openEditor = (runId) => setEditor({ runId });
  const handleSaved = (runId) => { setEditor(null); setSelectedId(runId); void load(); };

  if (editor) return <BusinessPageShell className="v16-mrp-planning v16-mrp-editor" width="rail"><MrpRunEditorV16 runId={editor.runId} notify={notify} onCancel={() => setEditor(null)} onSaved={handleSaved}/></BusinessPageShell>;
  if (selectedId) return <BusinessPageShell className="v16-mrp-planning v16-mrp-detail" width="rail"><MrpRunDetailV16 runId={selectedId} canManage={canManage} notify={notify} onEdit={() => openEditor(selectedId)} onNew={openNew} onChanged={load}/></BusinessPageShell>;

  return <BusinessPageShell className="v16-mrp-planning v16-mrp-list" width="rail">
    <div className="v16-mrp-list__tools"><SearchField value={search} onChange={setSearch} placeholder="搜索运算号或名称" label="搜索 MRP 运算"/>{canManage && <button type="button" className="primary v16-mrp-new" aria-label="新建 MRP 运算" onClick={openNew}>新建</button>}</div>
    <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} label="MRP 运算状态"/>
    {listState === 'LOADING' && <Loading/>}
    {listState === 'ERROR' && <EmptyState title="加载失败" description="暂时无法获取 MRP 运算。" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>}
    {listState === 'EMPTY' && <EmptyState title="暂无 MRP 运算" action={canManage ? <button type="button" className="primary" onClick={openNew}>新建 MRP 运算</button> : null}/>}
    {listState === 'READY' && filtered.length === 0 && <EmptyState title="没有匹配结果" action={<button type="button" className="secondary" onClick={() => { setSearch(''); setStatus(''); }}>清除筛选</button>}/>}
    {listState === 'READY' && filtered.length > 0 && <div className="v16-mrp-run-list" aria-label="MRP 运算列表">{filtered.map((row) => <MrpRunListRowV16 key={row.id} row={row} canManage={canManage} onOpen={() => setSelectedId(row.id)} onEdit={() => openEditor(row.id)}/>)}</div>}
  </BusinessPageShell>;
}

function MrpRunListRowV16({ row, canManage, onOpen, onEdit }) {
  return <article className="v16-mrp-run-row">
    <button type="button" className="v16-mrp-run-row__open" onClick={onOpen}>
      <span className="v16-mrp-run-row__top"><strong className="mono">{row.run_code}</strong><StatusChip status={row.status}>{mrpRunStatusLabel(row.status)}</StatusChip></span>
      <span className="v16-mrp-run-row__name">{row.run_name}</span>
      <span className="v16-mrp-run-row__meta">{row.horizon_start} – {row.horizon_end} · {demandModeLabel(row.demand_source_mode)}</span>
      <span className="v16-mrp-run-row__progress">{runProgress(row)}</span>
    </button>
    {canManage && row.status === 'DRAFT' && <ActionMenu label={`${row.run_code} 更多操作`}><button type="button" onClick={onEdit}>编辑设置</button></ActionMenu>}
  </article>;
}

function MrpRunEditorV16({ runId, onCancel, onSaved, notify }) {
  const [form, setForm] = useState(emptyRunForm());
  const [forecasts, setForecasts] = useState([]);
  const [state, setState] = useState('LOADING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setState('LOADING'); setError('');
    try {
      const [forecastResult, runResult] = await Promise.all([api('/api/planning/forecasts?status=ACTIVE'), runId ? api(`/api/planning/mrp/runs/${runId}`) : Promise.resolve(null)]);
      if (runResult?.run && runResult.run.status !== 'DRAFT') throw new Error('只有草稿状态的 MRP 可以编辑');
      setForecasts(forecastResult.forecasts || []); setForm(runResult?.run ? toRunForm(runResult.run) : emptyRunForm()); setState('READY');
    } catch (loadError) { setError(loadError.message); setState('ERROR'); }
  }
  useEffect(() => { void load(); }, [runId]);
  async function save(event) {
    event.preventDefault(); setError('');
    if (form.horizonStart > form.horizonEnd) { setError('开始日期不能晚于结束日期'); return; }
    setBusy(true);
    try {
      const body = { ...form, forecastId: form.demandSourceMode === 'SALES_ORDERS' ? null : form.forecastId };
      const result = await api(runId ? `/api/planning/mrp/runs/${runId}` : '/api/planning/mrp/runs', { method: runId ? 'PATCH' : 'POST', body });
      notify(runId ? 'MRP 草稿已更新' : 'MRP 草稿已创建'); onSaved(runId || result.id);
    } catch (saveError) { setError(saveError.message); notify(saveError.message, 'error'); } finally { setBusy(false); }
  }
  if (state === 'LOADING') return <Loading/>;
  if (state === 'ERROR') return <EmptyState title="无法打开编辑器" description={error} action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>;
  const needsForecast = form.demandSourceMode !== 'SALES_ORDERS';
  return <form className="v16-mrp-editor__form" onSubmit={save}>
    <header className="v16-mrp-editor__identity"><span>{runId ? '编辑草稿' : '新建 MRP'}</span><h2>{form.runName || '未命名运算'}</h2></header>
    <section className="v16-mrp-form-section"><h3>运算名称</h3><input aria-label="运算名称" value={form.runName} maxLength={80} required autoFocus={!runId} onChange={(event) => setForm({ ...form, runName: event.target.value })}/></section>
    <section className="v16-mrp-form-section"><h3>需求期间</h3><div className="v16-mrp-date-fields"><label>开始日期<input type="date" value={form.horizonStart} required onChange={(event) => setForm({ ...form, horizonStart: event.target.value })}/></label><label>结束日期<input type="date" value={form.horizonEnd} required onChange={(event) => setForm({ ...form, horizonEnd: event.target.value })}/></label></div></section>
    <section className="v16-mrp-form-section"><h3>需求来源</h3><select aria-label="需求来源" value={form.demandSourceMode} onChange={(event) => setForm({ ...form, demandSourceMode: event.target.value, forecastId: '' })}><option value="SALES_ORDERS">销售订单</option><option value="FORECAST">需求预测</option><option value="SALES_PLUS_FORECAST">销售订单 + 需求预测</option></select>{form.demandSourceMode === 'SALES_PLUS_FORECAST' && <p className="v16-mrp-mode-hint">{demandModeHint(form.demandSourceMode)}</p>}</section>
    {needsForecast && <section className="v16-mrp-form-section"><h3>条件预测来源</h3><label>关联预测<select value={form.forecastId} required onChange={(event) => setForm({ ...form, forecastId: event.target.value })}><option value="">选择已生效预测</option>{forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.forecast_code} · {forecast.forecast_name}</option>)}</select></label></section>}
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <BottomActionBar><button type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="primary" disabled={busy}>{busy ? '保存中…' : '保存草稿'}</button></BottomActionBar>
  </form>;
}

function MrpRunDetailV16({ runId, canManage, onEdit, onNew, onChanged, notify }) {
  const navigation = useAppNavigation();
  const [run, setRun] = useState(null); const [state, setState] = useState('LOADING'); const [confirm, setConfirm] = useState(null); const [busy, setBusy] = useState(false);
  async function load() { setState('LOADING'); try { const result = await api(`/api/planning/mrp/runs/${runId}`); setRun(result.run); setState('READY'); } catch (error) { setState('ERROR'); notify(error.message, 'error'); } }
  useEffect(() => { void load(); }, [runId]);
  async function act(action) {
    setBusy(true);
    try { await api(`/api/planning/mrp/runs/${runId}/${action}`, { method: 'POST' }); notify(action === 'execute' ? 'MRP 计算已完成' : 'MRP 运算已取消'); setConfirm(null); await load(); await onChanged?.(); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  }
  if (state === 'LOADING') return <Loading/>;
  if (state === 'ERROR') return <EmptyState title="加载失败" description="暂时无法获取这次 MRP 运算。" action={<button type="button" className="secondary" onClick={() => void load()}>重新加载</button>}/>;
  const summary = run.summary || {}; const total = Number(summary.totalProducts || 0);
  const openPlan = () => navigation.navigateToPage('material-requirements-plan', { documentId: run.id, originPage: 'mrp-runs' });
  return <>
    <header className="v16-mrp-detail__identity"><div><span className="mono">{run.run_code}</span><StatusChip status={run.status}>{mrpRunStatusLabel(run.status)}</StatusChip></div><h2>{run.run_name}</h2><p>{run.horizon_start} – {run.horizon_end}</p></header>
    <section className="v16-mrp-detail__section"><h3>运算设置</h3><dl className="v16-mrp-facts"><div><dt>需求期间</dt><dd>{run.horizon_start} – {run.horizon_end}</dd></div><div><dt>需求来源</dt><dd>{demandModeLabel(run.demand_source_mode)}</dd></div>{run.forecast_name && <div><dt>预测来源</dt><dd>{run.forecast_code} · {run.forecast_name}</dd></div>}</dl></section>
    {run.status === 'COMPLETED' && <section className="v16-mrp-detail__section"><h3>结果摘要</h3>{total > 0 ? <MrpSummaryV16 summary={summary}/> : <EmptyState title="本次没有物料需求" description="当前计算期间内没有可纳入的需求。"/>}</section>}
    <section className="v16-mrp-detail__section"><h3>下一步</h3>{run.status === 'DRAFT' && <p className="v16-mrp-next">检查设置后开始计算，结果将保存为不可变历史快照。</p>}{run.status === 'COMPLETED' && total > 0 && <button type="button" className="primary v16-mrp-wide-action" onClick={openPlan}>查看物料需求计划</button>}{(run.status === 'CANCELLED' || (run.status === 'COMPLETED' && total === 0)) && canManage && <button type="button" className="primary v16-mrp-wide-action" onClick={onNew}>新建一次 MRP</button>}{run.status === 'COMPLETED' && total > 0 && canManage && <button type="button" className="secondary v16-mrp-wide-action" onClick={onNew}>新建一次 MRP</button>}{run.status === 'CANCELLED' && !canManage && <p className="v16-mrp-next">这次运算已取消。</p>}</section>
    <section className="v16-mrp-detail__section"><h3>运算记录</h3><dl className="v16-mrp-facts">{run.creator_name && <div><dt>创建人</dt><dd>{run.creator_name}</dd></div>}<div><dt>创建时间</dt><dd>{fmtDateTime(run.created_at)}</dd></div>{run.completed_at && <div><dt>计算完成</dt><dd>{fmtDateTime(run.completed_at)}</dd></div>}</dl></section>
    {canManage && run.status === 'DRAFT' && <section className="v16-mrp-detail__section v16-mrp-detail__management"><h3>管理</h3><button type="button" className="danger-button" onClick={() => setConfirm('cancel')}>取消这次运算</button></section>}
    {canManage && run.status === 'DRAFT' && <BottomActionBar><button type="button" className="secondary" onClick={onEdit}>编辑设置</button><button type="button" className="primary" onClick={() => setConfirm('execute')}>开始计算</button></BottomActionBar>}
    {confirm === 'execute' && <ConfirmSheet title="开始 MRP 计算？" confirmLabel={busy ? '计算中…' : '开始计算'} onClose={() => !busy && setConfirm(null)} onConfirm={() => !busy && void act('execute')}><p>系统将按当前期间、需求来源、库存和在途供应生成历史快照。计算不会创建生产或采购指令。</p></ConfirmSheet>}
    {confirm === 'cancel' && <DangerSheet title="取消这次运算？" confirmLabel={busy ? '取消中…' : '确认取消'} onClose={() => !busy && setConfirm(null)} onConfirm={() => !busy && void act('cancel')}><p>这只会取消当前草稿，不会影响任何已完成的 MRP 历史。</p></DangerSheet>}
  </>;
}

export function MrpSummaryV16({ summary = {} }) {
  return <dl className="v16-mrp-summary"><div><dt>物料</dt><dd>{summary.totalProducts || 0}</dd></div><div><dt>生产建议</dt><dd>{summary.makeSuggestions || 0}</dd></div><div><dt>采购建议</dt><dd>{summary.buySuggestions || 0}</dd></div><div><dt>缺料</dt><dd>{summary.shortageProducts || 0}</dd></div></dl>;
}
