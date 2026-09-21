// MRP 运算 / MRP Run page.
//
// P1 — productization rename: this page is "MRP 运算". The full result
// table has moved to the Material Requirements Plan page. The run
// detail now shows the calculation settings + summary and a primary
// link "查看物料需求计划" that hands off to the result view.

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { can, Empty, FormActions, Loading, Modal, Panel, Status, Toolbar } from '../components/ui.jsx';
import { DetailSection, EmptyState, KeyValueRow, RecordCard, RecordList } from '../components/design-system.jsx';
import {
  demandModeHint,
  demandModeLabel,
  mrpRunStatusLabel,
} from '../lib/status.js';

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(n);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyRunForm() {
  return {
    runName: '',
    horizonStart: todayIso(),
    horizonEnd: plusDays(todayIso(), 60),
    demandSourceMode: 'SALES_ORDERS',
    forecastId: '',
  };
}

function toRunForm(run) {
  if (!run) return emptyRunForm();
  return {
    runName: run.run_name || '',
    horizonStart: run.horizon_start || todayIso(),
    horizonEnd: run.horizon_end || todayIso(),
    demandSourceMode: run.demand_source_mode || 'SALES_ORDERS',
    forecastId: run.forecast_id || '',
  };
}

function statusBadgeType(status) {
  if (status === 'COMPLETED') return 'approved';
  if (status === 'CANCELLED') return 'rejected';
  return 'draft';
}

export default function MrpRuns({ user, notify }) {
  const navigation = useAppNavigation();
  const canManage = can(user, 'MRP_MANAGE');
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState(null);

  const load = () => api(`/api/planning/mrp/runs?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.runs || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);

  useEffect(() => {
    if (navigation.target?.page === 'mrp-runs' && navigation.target.documentId) {
      setViewingId(navigation.target.documentId);
    }
  }, [navigation.target]);

  if (rows === null) return <Loading/>;

  const filtered = rows.filter((row) => !search
    || (row.run_code || '').toLowerCase().includes(search.toLowerCase())
    || (row.run_name || '').toLowerCase().includes(search.toLowerCase()));

  const handleRefresh = () => load();

  return <>
    <Panel
      title="MRP 运算"
      action={canManage && <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 运行 MRP 运算</button>}
    >
      <Toolbar
        search={search}
        setSearch={setSearch}
        onSearch={load}
        placeholder="搜索计划名称或编号"
        extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="COMPLETED">已完成</option>
          <option value="CANCELLED">已取消</option>
        </select>}
      />
      <RecordList>
        {filtered.map((row) => {
          const completedZero = row.status === 'COMPLETED' && Number(row.summary?.totalProducts || 0) === 0;
          return <RecordCard
            key={row.id}
            title={row.run_name}
            subtitle={row.run_code}
            status={<Status status={statusBadgeType(row.status)} label={mrpRunStatusLabel(row.status)}/>}
            facts={[
              { label: '期间', value: `${row.horizon_start} ~ ${row.horizon_end}` },
              { label: '需求来源', value: demandModeLabel(row.demand_source_mode) },
              ...(row.forecast_code ? [{ label: '预测来源', value: row.forecast_code }] : []),
              { label: '结果', value: completedZero ? '本期没有可纳入需求' : `${row.summary?.totalProducts ?? '—'} 项物料` },
            ]}
            onClick={() => setViewingId(row.id)}
          />;
        })}
        {!filtered.length && <Empty text={rows.length === 0 ? '还没有 MRP 运算。创建一次运算，系统会计算生产与采购需求。' : '没有符合筛选条件的 MRP 运算'}/>}
      </RecordList>
    </Panel>

    {viewingId && <MrpRunDetail
      runId={viewingId}
      onClose={() => setViewingId(null)}
      onRerun={() => { setViewingId(null); setCreating(true); }}
      onChanged={() => { void handleRefresh(); }}
      notify={notify}
    />}
    {creating && canManage && <MrpRunEditor
      value={{ create: true }}
      onClose={() => setCreating(false)}
      onSaved={() => {
        setCreating(false);
        void handleRefresh();
        notify('MRP 运算已创建（草稿）');
      }}
      notify={notify}
    />}
  </>;
}

function MrpRunEditor({ value, onClose, onSaved, notify }) {
  const [forecasts, setForecasts] = useState([]);
  const [form, setForm] = useState(emptyRunForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/planning/forecasts?status=ACTIVE')
      .then((result) => setForecasts(result.forecasts || []))
      .catch(() => setForecasts([]));
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { ...form };
      if (form.demandSourceMode === 'SALES_ORDERS') body.forecastId = null;
      await api('/api/planning/mrp/runs', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(e.message);
      notify(e.message, 'error');
    } finally { setBusy(false); }
  };

  const needsForecast = form.demandSourceMode === 'FORECAST' || form.demandSourceMode === 'SALES_PLUS_FORECAST';

  return <Modal title="运行 MRP 运算" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="full">计划名称<input value={form.runName} onChange={(event) => setForm({ ...form, runName: event.target.value })} required maxLength={80}/></label>
      <label>开始日期<input type="date" value={form.horizonStart} onChange={(event) => setForm({ ...form, horizonStart: event.target.value })} required/></label>
      <label>结束日期<input type="date" value={form.horizonEnd} onChange={(event) => setForm({ ...form, horizonEnd: event.target.value })} required/></label>
      <label className="full">需求来源<select value={form.demandSourceMode} onChange={(event) => setForm({ ...form, demandSourceMode: event.target.value, forecastId: '' })}>
        <option value="SALES_ORDERS">销售订单</option>
        <option value="FORECAST">需求预测</option>
        <option value="SALES_PLUS_FORECAST">销售订单 + 需求预测</option>
      </select></label>
      {needsForecast && <label className="full">关联已生效预测<select value={form.forecastId} onChange={(event) => setForm({ ...form, forecastId: event.target.value })} required>
        <option value="">选择已生效预测</option>
        {forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.forecast_code} - {forecast.forecast_name}</option>)}
      </select></label>}
      {form.demandSourceMode === 'SALES_PLUS_FORECAST' && <p className="full mrp-mode-hint dim">{demandModeHint(form.demandSourceMode)}。</p>}
      {error && <p className="full error-banner">{error}</p>}
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存草稿'}/>
    </form>
  </Modal>;
}

function MrpRunDetail({ runId, onClose, onRerun, onChanged, notify }) {
  const navigation = useAppNavigation();
  const [run, setRun] = useState(null);
  const load = () => api('/api/planning/mrp/runs/' + runId)
    .then((result) => setRun(result.run))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [runId]);

  const act = async (action) => {
    try {
      await api(`/api/planning/mrp/runs/${runId}/${action}`, { method: 'POST' });
      notify(action === 'execute' ? '物料需求计划已生成' : 'MRP 运算已取消');
      void load();
      onChanged?.();
    } catch (error) { notify(error.message, 'error'); }
  };

  if (!run) return <Modal title="MRP 运算详情" onClose={onClose} wide><Loading/></Modal>;

  const summary = run.summary || null;
  const completedZero = run.status === 'COMPLETED' && Number(summary?.totalProducts || 0) === 0;
  const openPlan = () => {
    navigation.navigateToPage('material-requirements-plan', { documentId: runId });
    onClose();
  };

  return <Modal title={`MRP 运算 ${run.run_code}`} onClose={onClose} wide>
    <DetailSection title="运算设置">
      <KeyValueRow label="运行名称" value={run.run_name}/>
      <KeyValueRow label="期间" value={`${run.horizon_start} ~ ${run.horizon_end}`}/>
      <KeyValueRow label="需求来源" value={demandModeLabel(run.demand_source_mode)}/>
      {run.forecast_code && <KeyValueRow label="预测来源" value={run.forecast_code}/>}
      <KeyValueRow label="状态"><Status status={statusBadgeType(run.status)} label={mrpRunStatusLabel(run.status)}/></KeyValueRow>
    </DetailSection>
    {completedZero ? <EmptyState
      title="本次计算期间内没有可纳入的需求"
      description="请检查销售订单是否已审批且提交、审批或创建日期位于计算期间内，并检查需求预测需求日期和计算期间。"
      action={<button type="button" className="primary" onClick={onRerun}>重新运行 MRP</button>}
    /> : summary && <DetailSection title="结果摘要">
      <div className="mrp-summary">
        <span><strong>{summary.totalProducts}</strong> 项物料</span>
        <span><strong>{summary.makeSuggestions}</strong> 条生产建议</span>
        <span><strong>{summary.buySuggestions}</strong> 条采购建议</span>
        <span><strong>{summary.shortageProducts}</strong> 项缺料</span>
      </div>
    </DetailSection>}
    {run.status === 'COMPLETED' && !completedZero && (
      <div className="form-actions full">
        <button type="button" className="primary" onClick={openPlan}>查看物料需求计划</button>
      </div>
    )}
    <div className="form-actions full">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      {run.status === 'DRAFT' && <button type="button" className="primary" onClick={() => act('execute')}>开始计算</button>}
      {run.status === 'DRAFT' && <button type="button" className="danger-button" onClick={() => act('cancel')}>取消运算</button>}
    </div>
  </Modal>;
}
