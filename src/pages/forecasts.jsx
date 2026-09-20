// 需求预测 / Demand Forecast page.
//
// P1 — productization rename: this page is "需求预测". Backend lifecycle
// is unchanged (DRAFT → ACTIVE → CANCELLED); only the surface wording
// and the canonical user mental model are updated. MRP only consumes
// ACTIVE forecasts; this page does not display MRP result terminology.

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { can, ConfirmDelete, Empty, FormActions, Loading, Modal, Panel, Status, Toolbar } from '../components/ui.jsx';
import { forecastStatusLabel } from '../lib/status.js';

function fmtQty(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(n);
}

function fmtDate(value) {
  if (!value) return '—';
  const text = String(value).slice(0, 10);
  return /^d{4}-d{2}-d{2}$/.test(text) ? text : '—';
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

function statusBadgeType(status) {
  if (status === 'ACTIVE') return 'approved';
  if (status === 'CANCELLED') return 'rejected';
  return 'draft';
}

export default function Forecasts({ user, notify }) {
  const navigation = useAppNavigation();
  const canManage = can(user, 'MRP_MANAGE');
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = () => api(`/api/planning/forecasts?status=${encodeURIComponent(status)}`)
    .then((result) => setRows(result.forecasts || []))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [status]);

  useEffect(() => {
    if (navigation.target?.page === 'forecasts' && navigation.target.documentId) {
      setViewingId(navigation.target.documentId);
    }
  }, [navigation.target]);

  if (rows === null) return <Loading/>;

  const filtered = rows.filter((row) => !search
    || (row.forecast_code || '').toLowerCase().includes(search.toLowerCase())
    || (row.forecast_name || '').toLowerCase().includes(search.toLowerCase()));

  const handleNew = () => setCreateOpen(true);
  const handleRefresh = () => load();

  return <>
    <Panel
      title="需求预测"
      subtitle="录入未来产品需求，作为 MRP 的需求来源之一"
      action={canManage && <button type="button" className="primary" onClick={handleNew}>＋ 新建预测</button>}
    >
      <Toolbar
        search={search}
        setSearch={setSearch}
        onSearch={load}
        placeholder="搜索预测编号或名称"
        extra={<select aria-label="状态" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="ACTIVE">已生效</option>
          <option value="CANCELLED">已取消</option>
        </select>}
      />
      <div className="table-wrap forecast-list-desktop"><table><thead><tr>
        <th>预测编号</th><th>预测名称</th><th>预测期间</th><th>状态</th>
        <th className="number">明细数</th><th className="number">预测总数量</th><th>更新时间</th>
      </tr></thead><tbody>
        {filtered.map((row) => <tr className="clickable" key={row.id} onClick={() => setViewingId(row.id)}>
          <td className="mono strong-text">{row.forecast_code}</td>
          <td><strong>{row.forecast_name}</strong></td>
          <td>{row.period_start} ~ {row.period_end}</td>
          <td><Status status={statusBadgeType(row.status)} label={forecastStatusLabel(row.status)}/></td>
          <td className="number">{row.item_count}</td>
          <td className="number">{fmtQty(row.total_quantity)}</td>
          <td className="dim">{row.updated_at?.slice(0, 16).replace('T', ' ')}</td>
        </tr>)}
      </tbody></table>{!filtered.length && <Empty text={rows.length === 0 ? '还没有需求预测。创建预测后，可将其纳入 MRP 运算。' : '没有符合筛选条件的预测'}/>}</div>
      <div className="forecast-list-mobile">
        {filtered.map((row) => <button type="button" className="forecast-card" key={row.id} onClick={() => setViewingId(row.id)}>
          <span className="forecast-card__head"><strong>{row.forecast_name}</strong><Status status={statusBadgeType(row.status)} label={forecastStatusLabel(row.status)}/></span>
          <small className="mono">{row.forecast_code}</small>
          <small>预测期间 {row.period_start} ~ {row.period_end}</small>
          <small>共 {row.item_count} 项明细 · 合计 {fmtQty(row.total_quantity)}</small>
        </button>)}
        {!filtered.length && <Empty text={rows.length === 0 ? '还没有需求预测。创建预测后，可将其纳入 MRP 运算。' : '没有符合筛选条件的预测'}/>}
      </div>
    </Panel>

    {viewingId && <ForecastDetail
      forecastId={viewingId}
      onClose={() => { setViewingId(null); }}
      onChanged={() => { void handleRefresh(); }}
      notify={notify}
    />}
    {createOpen && canManage && <ForecastEditor
      value={{ create: true }}
      onClose={() => setCreateOpen(false)}
      onSaved={() => { setCreateOpen(false); void handleRefresh(); notify('预测已创建'); }}
      notify={notify}
    />}
  </>;
}

function ForecastEditor({ value, onClose, onSaved, notify }) {
  const [detail, setDetail] = useState(null);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm());
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
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };

  if (!value.create && !detail) return <Modal title="预测详情" onClose={onClose} wide><Loading/></Modal>;

  return <Modal title={value.create ? '新建需求预测' : '编辑需求预测'} onClose={onClose} wide>
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

function ForecastDetail({ forecastId, onClose, onChanged, notify }) {
  const [forecast, setForecast] = useState(null);
  const [editing, setEditing] = useState(false);

  const load = () => api('/api/planning/forecasts/' + forecastId)
    .then((result) => setForecast(result.forecast))
    .catch((error) => notify(error.message, 'error'));
  useEffect(() => { void load(); }, [forecastId]);

  const act = async (action) => {
    try {
      await api(`/api/planning/forecasts/${forecastId}/${action}`, { method: 'POST' });
      notify(action === 'activate' ? '预测已生效' : '预测已取消');
      void load();
      onChanged?.();
    } catch (error) { notify(error.message, 'error'); }
  };

  if (!forecast) return <Modal title="预测详情" onClose={onClose} wide><Loading/></Modal>;

  return <>
    <Modal title={`预测 ${forecast.forecast_code}`} onClose={onClose} wide>
      <div className="form-grid">
        <label>预测名称<span><strong>{forecast.forecast_name}</strong></span></label>
        <label>状态<span><Status status={statusBadgeType(forecast.status)} label={forecastStatusLabel(forecast.status)}/></span></label>
        <label>预测期间<span>{forecast.period_start} ~ {forecast.period_end}</span></label>
        <label>制单人<span>{forecast.creator_name || '—'}</span></label>
        <label className="full">备注<span>{forecast.notes || '—'}</span></label>
      </div>
      <div className="forecast-items-table">
        <h3>预测明细</h3>
        <div className="table-wrap"><table><thead><tr>
          <th>产品</th><th>需求日期</th><th className="number">预测数量</th><th>备注</th>
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
        {forecast.status === 'DRAFT' && <button type="button" className="primary" onClick={() => setEditing(true)}>编辑</button>}
        {forecast.status === 'DRAFT' && <button type="button" className="primary" onClick={() => act('activate')}>生效</button>}
        {forecast.status === 'DRAFT' && (<ConfirmDelete label="预测单" onConfirm={async () => {
          try { await api(`/api/planning/forecasts/${forecastId}`, { method: 'DELETE' }); notify('预测单草稿已删除'); onChanged?.(); onClose(); }
          catch (error) { notify(error.message, 'error'); throw error; }
        }}/>) }
        {forecast.status !== 'CANCELLED' && <button type="button" className="danger-button" onClick={() => act('cancel')}>取消预测</button>}
      </div>
    </Modal>
    {editing && <ForecastEditor
      value={{ id: forecastId }}
      onClose={() => setEditing(false)}
      onSaved={() => {
        setEditing(false);
        void load();
        onChanged?.();
        notify('预测已更新');
      }}
      notify={notify}
    />}
  </>;
}
