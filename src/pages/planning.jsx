import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Badge, can, Empty, FormActions, Loading, Modal, Panel, Status, Toolbar } from '../components/ui.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const FORECAST_STATUS_LABELS = { DRAFT: '草稿', ACTIVE: '已生效', CANCELLED: '已取消' };
const MRP_STATUS_LABELS = { DRAFT: '草稿', COMPLETED: '已计算', CANCELLED: '已取消' };
const DEMAND_MODE_LABELS = {
  SALES_ORDERS: '销售订单',
  FORECAST: '计划预测',
  SALES_PLUS_FORECAST: '销售订单 + 计划预测（叠加）',
};
const SUGGESTION_LABELS = { MAKE: '生产建议', BUY: '采购建议' };

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(n);
}

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '—';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyForecastItem() {
  return { productId: '', needDate: todayIso(), quantity: '', notes: '' };
}

function emptyForm() {
  return {
    forecastName: '',
    periodStart: todayIso(),
    periodEnd: plusDays(todayIso(), 30),
    notes: '',
    items: [emptyForecastItem()],
  };
}

function toForecastForm(forecast) {
  if (!forecast) return emptyForm();
  return {
    forecastName: forecast.forecast_name || '',
    periodStart: forecast.period_start || todayIso(),
    periodEnd: forecast.period_end || todayIso(),
    notes: forecast.notes || '',
    items: (forecast.items || []).map((item) => ({
      productId: item.product_id,
      needDate: item.need_date,
      quantity: item.quantity,
      notes: item.notes || '',
    })),
  };
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

function PlanningHub({ user, notify, onSelect }) {
  const [tab, setTab] = useState('forecasts');
  return <Panel
    title="计划与物料需求"
    subtitle="维护计划预测并按销售订单、计划预测或二者叠加运行 MRP 计划建议"
    action={<div className="planning-tabs">
      <button className={tab === 'forecasts' ? 'active' : ''} onClick={() => setTab('forecasts')}>计划预测</button>
      <button className={tab === 'mrp' ? 'active' : ''} onClick={() => setTab('mrp')}>MRP 物料需求计划</button>
    </div>}
  >
    {tab === 'forecasts'
      ? <ForecastList user={user} notify={notify} onSelect={(id) => onSelect({ type: 'forecast', id })}/>
      : <MrpRunList user={user} notify={notify} onSelect={(id) => onSelect({ type: 'mrp', id })}/>}
  </Panel>;
}

function ForecastList({ user, notify, onSelect }) {
  const canManage = can(user, 'MRP_MANAGE');
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const load = () => api(`/api/planning/forecasts?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.forecasts || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  if (rows === null) return <Loading/>;
  const filtered = rows.filter((row) => !search
    || (row.forecast_code || '').toLowerCase().includes(search.toLowerCase())
    || (row.forecast_name || '').toLowerCase().includes(search.toLowerCase()));
  return <>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索预测编号或名称"
      extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option>
        <option value="DRAFT">草稿</option>
        <option value="ACTIVE">已生效</option>
        <option value="CANCELLED">已取消</option>
      </select>}
      action={canManage && <button className="primary" onClick={() => setEditing({ create: true })}>＋ 新建预测</button>}
    />
    <div className="table-wrap forecast-list-desktop"><table><thead><tr>
      <th>预测编号</th><th>名称</th><th>期间</th><th>状态</th>
      <th className="number">产品数</th><th className="number">总预测数量</th><th>更新时间</th>
    </tr></thead><tbody>
      {filtered.map((row) => <tr className="clickable" key={row.id} onClick={() => onSelect(row.id)}>
        <td className="mono strong-text">{row.forecast_code}</td>
        <td><strong>{row.forecast_name}</strong></td>
        <td>{row.period_start} ~ {row.period_end}</td>
        <td><Status status={row.status === 'ACTIVE' ? 'approved' : row.status === 'CANCELLED' ? 'rejected' : 'draft'} label={FORECAST_STATUS_LABELS[row.status] || row.status}/></td>
        <td className="number">{row.item_count}</td>
        <td className="number">{fmtQty(row.total_quantity)}</td>
        <td className="dim">{row.updated_at?.slice(0, 16).replace('T', ' ')}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有符合条件的预测"/>}</div>
    <div className="forecast-list-mobile">
      {filtered.map((row) => <button type="button" className="forecast-card" key={row.id} onClick={() => onSelect(row.id)}>
        <span className="forecast-card__head"><strong>{row.forecast_name}</strong><Status status={row.status === 'ACTIVE' ? 'approved' : row.status === 'CANCELLED' ? 'rejected' : 'draft'} label={FORECAST_STATUS_LABELS[row.status]}/></span>
        <small className="mono">{row.forecast_code}</small>
        <small>期间 {row.period_start} ~ {row.period_end}</small>
        <small>共 {row.item_count} 项产品 · 合计 {fmtQty(row.total_quantity)}</small>
      </button>)}
      {!filtered.length && <Empty text="没有符合条件的预测"/>}
    </div>
    {editing && <ForecastEditor value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} notify={notify}/>}
  </>;
}

function ForecastEditor({ value, onClose, onSaved, notify }) {
  const [detail, setDetail] = useState(value.create ? null : null);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(value.create ? emptyForm() : emptyForm());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/products').then((result) => setProducts(result.products || [])).catch(() => {});
    if (!value.create && value.id) {
      api('/api/planning/forecasts/' + value.id)
        .then((result) => { setDetail(result.forecast); setForm(toForecastForm(result.forecast)); })
        .catch((error) => notify(error.message, 'error'));
    }
  }, []);
  const updateItem = (index, field, newValue) => setForm((current) => ({
    ...current,
    items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: newValue } : item),
  }));
  const addItem = () => setForm((current) => ({ ...current, items: [...current.items, emptyForecastItem()] }));
  const removeItem = (index) => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form, items: form.items.filter((item) => item.productId) };
      if (value.create) await api('/api/planning/forecasts', { method: 'POST', body });
      else await api('/api/planning/forecasts/' + value.id, { method: 'PATCH', body });
      notify(value.create ? '预测已创建' : '预测已更新');
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };
  if (!value.create && !detail) return <Modal title="预测详情" onClose={onClose} wide><Loading/></Modal>;
  return <Modal title={value.create ? '新建计划预测' : '编辑计划预测'} onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>预测名称<input value={form.forecastName} onChange={(event) => setForm({ ...form, forecastName: event.target.value })} required maxLength={80}/></label>
      <label>开始日期<input type="date" value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })} required/></label>
      <label>结束日期<input type="date" value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })} required/></label>
      <label className="full">备注<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={200}/></label>
      <div className="full">
        <div className="form-section-head"><span>预测明细</span><button type="button" className="secondary" onClick={addItem}>＋ 增加</button></div>
        <div className="forecast-items-editor">
          {form.items.map((item, index) => <article className="forecast-item-editor" key={index}>
            <div className="forecast-item-editor__fields">
              <label>产品<select value={item.productId} onChange={(event) => updateItem(index, 'productId', event.target.value)} required>
                <option value="">选择产品</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.code} - {product.name}</option>)}
              </select></label>
              <label>需求日期<input type="date" value={item.needDate} onChange={(event) => updateItem(index, 'needDate', event.target.value)} required/></label>
              <label>预测数量<input type="number" min="0.000001" step="0.000001" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)} required/></label>
              <label className="full">备注<input value={item.notes} onChange={(event) => updateItem(index, 'notes', event.target.value)} maxLength={200}/></label>
            </div>
            <button type="button" className="danger-text" onClick={() => removeItem(index)}>删除</button>
          </article>)}
          {!form.items.length && <Empty text="尚未添加预测明细"/>}
        </div>
      </div>
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存'}/>
    </form>
  </Modal>;
}

function ForecastDetail({ forecastId, onClose, notify }) {
  const [forecast, setForecast] = useState(null);
  const load = () => api('/api/planning/forecasts/' + forecastId)
    .then((result) => setForecast(result.forecast))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [forecastId]);
  const act = async (action) => {
    try {
      await api(`/api/planning/forecasts/${forecastId}/${action}`, { method: 'POST' });
      notify(action === 'activate' ? '预测已生效' : '预测已取消');
      void load();
    } catch (error) { notify(error.message, 'error'); }
  };
  if (!forecast) return <Modal title="预测详情" onClose={onClose} wide><Loading/></Modal>;
  return <Modal title={`预测 ${forecast.forecast_code}`} onClose={onClose} wide>
    <div className="form-grid">
      <label>名称<span><strong>{forecast.forecast_name}</strong></span></label>
      <label>状态<span><Status status={forecast.status === 'ACTIVE' ? 'approved' : forecast.status === 'CANCELLED' ? 'rejected' : 'draft'} label={FORECAST_STATUS_LABELS[forecast.status]}/></span></label>
      <label>期间<span>{forecast.period_start} ~ {forecast.period_end}</span></label>
      <label>制单人<span>{forecast.creator_name || '—'}</span></label>
      <label>备注<span>{forecast.notes || '—'}</span></label>
    </div>
    <div className="forecast-items-table">
      <h3>预测明细</h3>
      <div className="table-wrap"><table><thead><tr>
        <th>产品</th><th>需求日期</th><th className="number">数量</th><th>备注</th>
      </tr></thead><tbody>
        {forecast.items?.map((item) => <tr key={item.id}>
          <td><strong>{item.product_name}</strong><small className="block mono">{item.product_code}</small></td>
          <td>{item.need_date}</td>
          <td className="number">{fmtQty(item.quantity)}</td>
          <td className="dim">{item.notes || '—'}</td>
        </tr>)}
      </tbody></table>{!forecast.items?.length && <Empty text="没有预测明细"/>}</div>
    </div>
    <div className="form-actions full">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      {forecast.status === 'DRAFT' && <button type="button" className="primary" onClick={() => act('activate')}>生效</button>}
      {forecast.status !== 'CANCELLED' && <button type="button" className="danger-button" onClick={() => act('cancel')}>取消预测</button>}
    </div>
  </Modal>;
}

function MrpRunList({ user, notify, onSelect }) {
  const canManage = can(user, 'MRP_MANAGE');
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(null);
  const load = () => api(`/api/planning/mrp/runs?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.runs || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  if (rows === null) return <Loading/>;
  const filtered = rows.filter((row) => !search
    || (row.run_code || '').toLowerCase().includes(search.toLowerCase())
    || (row.run_name || '').toLowerCase().includes(search.toLowerCase()));
  return <>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索 MRP 编号或名称"
      extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">全部状态</option>
        <option value="DRAFT">草稿</option>
        <option value="COMPLETED">已计算</option>
        <option value="CANCELLED">已取消</option>
      </select>}
      action={canManage && <button className="primary" onClick={() => setCreating({ create: true })}>＋ 新建 MRP 计算</button>}
    />
    <div className="table-wrap mrp-run-list-desktop"><table><thead><tr>
      <th>MRP 编号</th><th>名称</th><th>需求来源</th><th>计算期间</th><th>状态</th>
      <th className="number">产品数</th><th className="number">生产建议</th><th className="number">采购建议</th><th>计算时间</th>
    </tr></thead><tbody>
      {filtered.map((row) => <tr className="clickable" key={row.id} onClick={() => onSelect(row.id)}>
        <td className="mono strong-text">{row.run_code}</td>
        <td><strong>{row.run_name}</strong></td>
        <td>{DEMAND_MODE_LABELS[row.demand_source_mode] || row.demand_source_mode}{row.forecast_code ? <small className="block dim">关联预测 {row.forecast_code}</small> : null}</td>
        <td>{row.horizon_start} ~ {row.horizon_end}</td>
        <td><Status status={row.status === 'COMPLETED' ? 'approved' : row.status === 'CANCELLED' ? 'rejected' : 'draft'} label={MRP_STATUS_LABELS[row.status] || row.status}/></td>
        <td className="number">{row.summary?.totalProducts ?? '—'}</td>
        <td className="number">{row.summary?.makeSuggestions ?? '—'}</td>
        <td className="number">{row.summary?.buySuggestions ?? '—'}</td>
        <td className="dim">{row.completed_at?.slice(0, 16).replace('T', ' ') || '—'}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有符合条件的 MRP 计算"/>}</div>
    <div className="mrp-run-list-mobile">
      {filtered.map((row) => <button type="button" className="mrp-run-card" key={row.id} onClick={() => onSelect(row.id)}>
        <span className="mrp-run-card__head"><strong>{row.run_name}</strong><Status status={row.status === 'COMPLETED' ? 'approved' : row.status === 'CANCELLED' ? 'rejected' : 'draft'} label={MRP_STATUS_LABELS[row.status]}/></span>
        <small className="mono">{row.run_code}</small>
        <small>需求来源：{DEMAND_MODE_LABELS[row.demand_source_mode] || row.demand_source_mode}</small>
        <small>期间 {row.horizon_start} ~ {row.horizon_end}</small>
        <small>{row.summary?.totalProducts ?? '—'} 项产品 · 生产 {row.summary?.makeSuggestions ?? '—'} · 采购 {row.summary?.buySuggestions ?? '—'}</small>
      </button>)}
      {!filtered.length && <Empty text="没有符合条件的 MRP 计算"/>}
    </div>
    {creating && <MrpRunEditor value={creating} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); void load(); }} notify={notify}/>}
  </>;
}

function MrpRunEditor({ value, onClose, onSaved, notify }) {
  const [forecasts, setForecasts] = useState([]);
  const [form, setForm] = useState(emptyRunForm());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/planning/forecasts?status=ACTIVE')
      .then((result) => setForecasts(result.forecasts || []))
      .catch(() => setForecasts([]));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...form };
      if (form.demandSourceMode === 'SALES_ORDERS') body.forecastId = null;
      await api('/api/planning/mrp/runs', { method: 'POST', body });
      notify('MRP 计算已创建（草稿）');
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };
  const needsForecast = form.demandSourceMode === 'FORECAST' || form.demandSourceMode === 'SALES_PLUS_FORECAST';
  return <Modal title="新建 MRP 计算" onClose={onClose} wide>
    <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="full">计算名称<input value={form.runName} onChange={(event) => setForm({ ...form, runName: event.target.value })} required maxLength={80}/></label>
      <label>开始日期<input type="date" value={form.horizonStart} onChange={(event) => setForm({ ...form, horizonStart: event.target.value })} required/></label>
      <label>结束日期<input type="date" value={form.horizonEnd} onChange={(event) => setForm({ ...form, horizonEnd: event.target.value })} required/></label>
      <label className="full">需求来源<select value={form.demandSourceMode} onChange={(event) => setForm({ ...form, demandSourceMode: event.target.value, forecastId: '' })}>
        <option value="SALES_ORDERS">销售订单</option>
        <option value="FORECAST">计划预测</option>
        <option value="SALES_PLUS_FORECAST">销售订单 + 计划预测（叠加）</option>
      </select></label>
      {needsForecast && <label className="full">关联已生效预测<select value={form.forecastId} onChange={(event) => setForm({ ...form, forecastId: event.target.value })} required>
        <option value="">选择已生效预测</option>
        {forecasts.map((forecast) => <option key={forecast.id} value={forecast.id}>{forecast.forecast_code} - {forecast.forecast_name}</option>)}
      </select></label>}
      {form.demandSourceMode === 'SALES_PLUS_FORECAST' && <p className="full mrp-mode-hint dim">销售订单需求与计划预测数量为叠加关系，二者均纳入净需求计算。</p>}
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存草稿'}/>
    </form>
  </Modal>;
}

function MrpRunDetail({ runId, onClose, notify }) {
  const [run, setRun] = useState(null);
  const load = () => api('/api/planning/mrp/runs/' + runId)
    .then((result) => setRun(result.run))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [runId]);
  const act = async (action) => {
    try {
      await api(`/api/planning/mrp/runs/${runId}/${action}`, { method: 'POST' });
      notify(action === 'execute' ? 'MRP 已计算' : 'MRP 已取消');
      void load();
    } catch (error) { notify(error.message, 'error'); }
  };
  if (!run) return <Modal title="MRP 计算详情" onClose={onClose} wide><Loading/></Modal>;
  const grouped = (run.results || []).reduce((acc, row) => {
    const key = row.suggestion_type || 'NONE';
    (acc[key] = acc[key] || []).push(row);
    return acc;
  }, {});
  return <Modal title={`MRP ${run.run_code}`} onClose={onClose} wide>
    <div className="form-grid">
      <label>名称<span><strong>{run.run_name}</strong></span></label>
      <label>状态<span><Status status={run.status === 'COMPLETED' ? 'approved' : run.status === 'CANCELLED' ? 'rejected' : 'draft'} label={MRP_STATUS_LABELS[run.status]}/></span></label>
      <label>需求来源<span>{DEMAND_MODE_LABELS[run.demand_source_mode] || run.demand_source_mode}{run.forecast_code ? <small className="block dim">关联预测 {run.forecast_code}</small> : null}</span></label>
      <label>计算期间<span>{run.horizon_start} ~ {run.horizon_end}</span></label>
      <label>制单人<span>{run.creator_name || '—'}</span></label>
      <label>完成时间<span>{run.completed_at?.slice(0, 16).replace('T', ' ') || '—'}</span></label>
    </div>
    {run.summary && <div className="mrp-summary">
      <span><strong>{run.summary.totalProducts}</strong> 项产品</span>
      <span><strong>{run.summary.makeSuggestions}</strong> 条生产建议</span>
      <span><strong>{run.summary.buySuggestions}</strong> 条采购建议</span>
      <span><strong>{run.summary.shortageProducts}</strong> 项缺料</span>
    </div>}
    {run.status === 'COMPLETED' && run.results?.length > 0 && <MrpResultSection grouped={grouped} run={run} onClose={onClose} notify={notify}/>}
    <div className="form-actions full">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      {run.status === 'DRAFT' && <button type="button" className="primary" onClick={() => act('execute')}>执行计算</button>}
      {run.status === 'DRAFT' && <button type="button" className="danger-button" onClick={() => act('cancel')}>取消</button>}
    </div>
  </Modal>;
}

function MrpResultSection({ grouped, run, onClose, notify }) {
  const [openRow, setOpenRow] = useState(null);
  const make = grouped.MAKE || [];
  const buy = grouped.BUY || [];
  const satisfied = grouped[''] || [];
  return <>
    <h3>需求明细</h3>
    <div className="table-wrap"><table><thead><tr>
      <th>产品</th><th className="number">销售需求</th><th className="number">预测需求</th><th className="number">组件需求</th>
      <th className="number">毛需求</th><th className="number">现有库存</th><th className="number">在途采购</th>
      <th className="number">在途生产</th><th className="number">净需求</th><th>建议类型</th>
      <th className="number">建议数量</th><th>需求日期</th><th>提示</th>
    </tr></thead><tbody>
      {[...make, ...buy, ...satisfied].map((row) => <tr className="clickable" key={row.id} onClick={() => setOpenRow(row)}>
        <td><strong>{row.product_name}</strong><small className="block mono">{row.product_code}</small></td>
        <td className="number">{fmtQty(row.gross_sales_demand)}</td>
        <td className="number">{fmtQty(row.gross_forecast_demand)}</td>
        <td className="number">{fmtQty(row.gross_component_demand)}</td>
        <td className="number">{fmtQty(row.gross_requirement)}</td>
        <td className="number">{fmtQty(row.on_hand)}</td>
        <td className="number">{fmtQty(row.open_purchase_supply)}</td>
        <td className="number">{fmtQty(row.open_production_supply)}</td>
        <td className="number"><strong>{fmtQty(row.net_requirement)}</strong></td>
        <td>{row.suggestion_type ? <Badge type={row.suggestion_type === 'MAKE' ? 'info' : 'success'}>{SUGGESTION_LABELS[row.suggestion_type]}</Badge> : <span className="dim">无</span>}</td>
        <td className="number">{fmtQty(row.suggested_quantity)}</td>
        <td>{row.need_by_date || '—'}</td>
        <td>{row.warning ? <Badge type="warning">{row.warning === 'ROUTING_MISSING' ? '缺少工序' : row.warning}</Badge> : '—'}</td>
      </tr>)}
    </tbody></table></div>
    {openRow && <MrpResultTrace runId={run.id} result={openRow} onClose={() => setOpenRow(null)} notify={notify}/>}
  </>;
}

function MrpResultTrace({ runId, result, onClose, notify }) {
  const [trace, setTrace] = useState(null);
  useEffect(() => {
    api('/api/planning/mrp/runs/' + runId)
      .then((res) => {
        const related = (res.run.pegging || []).filter((row) => row.result_product_id === result.product_id);
        const components = (res.run.components || []).filter((row) => row.product_id === result.product_id);
        const demands = (res.run.demands || []).filter((row) => row.product_id === result.product_id);
        setTrace({ related, components, demands });
      })
      .catch((error) => notify(error.message, 'error'));
  }, []);
  if (!trace) return <Modal title={`${result.product_code || ''} 计算追溯`} onClose={onClose} wide><Loading/></Modal>;
  return <Modal title={`${result.product_code || ''} 净需求追溯`} onClose={onClose} wide>
    <div className="form-grid">
      <label>产品<span><strong>{result.product_name}</strong></span></label>
      <label>建议类型<span>{result.suggestion_type ? SUGGESTION_LABELS[result.suggestion_type] : '无（库存已满足）'}</span></label>
      <label>毛需求<span>{fmtQty(result.gross_requirement)}</span></label>
      <label>现有库存<span>{fmtQty(result.on_hand)}</span></label>
      <label>在途采购<span>{fmtQty(result.open_purchase_supply)}</span></label>
      <label>在途生产<span>{fmtQty(result.open_production_supply)}</span></label>
      <label>净需求<span><strong>{fmtQty(result.net_requirement)}</strong></span></label>
      <label>建议数量<span>{fmtQty(result.suggested_quantity)}</span></label>
    </div>
    <h3>需求来源</h3>
    <div className="table-wrap"><table><thead><tr><th>来源类型</th><th>单据</th><th>需求日期</th><th className="number">数量</th></tr></thead><tbody>
      {trace.demands.map((row) => <tr key={row.id}><td>{row.source_type === 'SALES_ORDER' ? '销售订单' : '计划预测'}</td><td>{row.source_label || row.source_id}</td><td>{row.need_date}</td><td className="number">{fmtQty(row.quantity)}</td></tr>)}
      {!trace.demands.length && <tr><td colSpan={4}><Empty text="该产品在本次 MRP 中没有顶层需求"/></td></tr>}
    </tbody></table></div>
    {trace.components.length > 0 && <>
      <h3>BOM 展开</h3>
      <div className="table-wrap"><table><thead><tr><th>父项</th><th>展开路径</th><th className="number">毛需求</th></tr></thead><tbody>
        {trace.components.map((row) => <tr key={row.id}>
          <td>{row.parent_name} <small className="mono dim">{row.parent_code}</small></td>
          <td className="mono small">{row.bom_path}</td>
          <td className="number">{fmtQty(row.gross_required)}</td>
        </tr>)}
      </tbody></table></div>
    </>}
    <h3>建议来源追溯</h3>
    <div className="table-wrap"><table><thead><tr><th>来源类型</th><th>来源单据/产品</th><th className="number">贡献数量</th><th>备注</th></tr></thead><tbody>
      {trace.related.map((row) => <tr key={row.id}><td>{row.source_type === 'BOM_EXPLOSION' ? 'BOM 展开' : row.source_type === 'SALES_ORDER' ? '销售订单' : '计划预测'}</td><td>{row.source_label || row.source_id}</td><td className="number">{fmtQty(row.quantity_contribution)}</td><td className="dim">{row.note || '—'}</td></tr>)}
      {!trace.related.length && <tr><td colSpan={4}><Empty text="没有追溯数据"/></td></tr>}
    </tbody></table></div>
    <div className="form-actions full"><button type="button" className="secondary" onClick={onClose}>关闭</button></div>
  </Modal>;
}

export default function Planning({ user, notify }) {
  const { target } = useAppNavigation();
  const [selection, setSelection] = useState(null);
  useEffect(() => {
    if (target?.page === 'forecasts' || target?.page === 'mrp') setSelection({ type: target.page === 'forecasts' ? 'forecast' : 'mrp', id: target.documentId || null });
  }, [target]);
  const close = () => setSelection(null);
  if (selection?.type === 'forecast' && selection.id) {
    return <Panel title="计划预测" subtitle="维护面向计划的预测数据，MRP 只能使用已生效预测"
      action={<button className="secondary" onClick={close}>← 返回</button>}>
      <ForecastList user={user} notify={notify} onSelect={(id) => setSelection({ type: 'forecast', id })}/>
      <ForecastDetail forecastId={selection.id} onClose={close} notify={notify}/>
    </Panel>;
  }
  if (selection?.type === 'mrp' && selection.id) {
    return <Panel title="MRP 物料需求计划" subtitle="根据销售订单、计划预测或二者叠加，输出生产与采购建议"
      action={<button className="secondary" onClick={close}>← 返回</button>}>
      <MrpRunList user={user} notify={notify} onSelect={(id) => setSelection({ type: 'mrp', id })}/>
      <MrpRunDetail runId={selection.id} onClose={close} notify={notify}/>
    </Panel>;
  }
  return <PlanningHub user={user} notify={notify} onSelect={setSelection}/>;
}
