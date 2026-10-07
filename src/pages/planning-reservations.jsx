// Planning Reservation surface — list / create / release / trace.
//
// CONTEXTUAL route under `planned-orders`. Strict reservation semantics:
// STRONG/MANUAL reserved for the same eligible supply cannot be double
// counted; backend is authoritative through `assertStrongReservationAvailability`.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import {
  BusinessPageShell, ConfirmSheet, DangerSheet, EmptyState, InlineAlert,
  SegmentedControl, Sheet, StatusChip,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import '../styles/planning-workbench.css';

const qty = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value || 0));
const dateLabel = (value) => (value ? String(value).slice(0, 10) : '—');

const RES_TYPE_LABELS = { STRONG: '强预留', WEAK: '弱预留', MANUAL: '手动预留' };
const RES_STATUS_LABELS = { ACTIVE: '生效中', RELEASED: '已释放', CONSUMED: '已消耗', CANCELLED: '已取消' };
const RES_STATUS_TONE = { ACTIVE: 'info', RELEASED: 'muted', CONSUMED: 'success', CANCELLED: 'muted' };
const SUPPLY_SOURCE_LABELS = {
  ON_HAND: '现存量', PLANNED_ORDER: '计划订单', PURCHASE_ORDER: '采购订单',
  PRODUCTION_ORDER: '生产工单', EXPECTED: '预计供应',
};
const DEMAND_SOURCE_LABELS = {
  SALES_ORDER: '销售订单', FORECAST: '预测', PRODUCTION_ORDER: '生产工单', MANUAL: '手动需求',
};

const RES_FILTERS = [
  { value: '', label: '全部' },
  { value: 'ACTIVE', label: '生效中' },
  { value: 'RELEASED', label: '已释放' },
];

export default function PlanningReservations({ user, notify }) {
  const navigation = useAppNavigation();
  const canManage = can(user, 'PLANNING_RESERVATION_MANAGE');
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('');
  const [state, setState] = useState('LOADING');
  const [parameters, setParameters] = useState(null);
  const [open, setOpen] = useState(null); // { kind, ...payload }

  const reload = async () => {
    try {
      const [list, params] = await Promise.all([
        api(`/api/planning/reservations?status=${encodeURIComponent(status)}`),
        api('/api/planning/parameters'),
      ]);
      setRows(list.reservations || []);
      setParameters(params.parameters || null);
      setState('READY');
    } catch (error) { setState('ERROR'); notify(error.message, 'error'); }
  };
  useEffect(() => { setState('LOADING'); void reload(); }, [status]);

  useEffect(() => {
    if (navigation.target?.page === 'planning-reservations' && navigation.target.documentId) {
      setOpen({ kind: 'detail', id: navigation.target.documentId });
    }
  }, [navigation.target]);

  const release = async (row) => {
    setOpen({ kind: 'release', row });
  };

  const detail = rows.find((row) => row.id === open?.id);

  return <BusinessPageShell className="planning-closure planning-reservations" width="rail">
    <header className="planning-hero">
      <div><span>PLANNING RESERVATION</span><h2>计划预留</h2></div>
      <p>建立强预留保护关键供应；弱预留由 MRP 自动生成；预留可双向追溯。</p>
    </header>

    {parameters && <InlineAlert tone={parameters.reservation_enabled ? 'info' : 'warning'}>
      预留功能当前 <strong>{parameters.reservation_enabled ? '已启用' : '已停用'}</strong>。停用时只能查看历史预留。
    </InlineAlert>}

    <div className="planning-toolbar">
      <SegmentedControl label="预留状态" options={RES_FILTERS} value={status} onChange={setStatus}/>
      <div className="planning-toolbar__actions">
        {canManage && parameters?.reservation_enabled && <button type="button" className="primary" onClick={() => setOpen({ kind: 'create' })}>新建预留</button>}
      </div>
    </div>

    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="加载失败" action={<button className="secondary" onClick={() => void reload()}>重新加载</button>}/>}
    {state === 'READY' && rows.length === 0 && <EmptyState title="暂无预留" description="预留会在 MRP 运算或人工创建时形成。"/>}
    {state === 'READY' && rows.length > 0 && <div className="planning-order-list">
      {rows.map((row) => <ReservationRow key={row.id} row={row} onOpen={() => setOpen({ kind: 'detail', id: row.id })} onRelease={canManage ? () => release(row) : null}/>)}
    </div>}

    {open?.kind === 'detail' && detail && <ReservationDetailSheet reservation={detail} onClose={() => setOpen(null)} onRelease={canManage ? () => release(detail) : null} onChanged={() => { setOpen(null); void reload(); }}/>}
    {open?.kind === 'release' && open.row && <ConfirmSheet
      title="释放预留"
      message={`确定释放预留 ${open.row.reservation_no}？释放后其它需求可以占用此供应。`}
      confirmLabel="确认释放"
      onClose={() => setOpen(null)}
      onConfirm={async () => {
        try { await api(`/api/planning/reservations/${open.row.id}/release`, { method: 'POST' }); notify('预留已释放', 'success'); await reload(); }
        catch (error) { notify(error.message, 'error'); }
        finally { setOpen(null); }
      }}
    />}
    {open?.kind === 'create' && <ReservationCreateSheet onClose={() => setOpen(null)} notify={notify} onDone={async () => { setOpen(null); await reload(); }}/>}
  </BusinessPageShell>;
}

function ReservationRow({ row, onOpen, onRelease }) {
  return <article className="planning-order">
    <button type="button" className="planning-order__open" onClick={onOpen}>
      <div className="planning-order__identity"><span className="mono">{row.reservation_no}</span><StatusChip status={row.reservation_type} domain="tracking">{RES_TYPE_LABELS[row.reservation_type] || row.reservation_type}</StatusChip></div>
      <h3>{row.product_name}</h3>
      <p className="mono planning-order__code">{row.product_code}</p>
      <dl>
        <div><dt>状态</dt><dd><StatusChip status={row.status} domain="lifecycle">{RES_STATUS_LABELS[row.status] || row.status}</StatusChip></dd></div>
        <div><dt>数量</dt><dd>{qty(row.quantity)}</dd></div>
        <div><dt>需求来源</dt><dd>{DEMAND_SOURCE_LABELS[row.demand_source_type] || row.demand_source_type}</dd></div>
        <div><dt>供应来源</dt><dd>{SUPPLY_SOURCE_LABELS[row.supply_source_type] || row.supply_source_type}</dd></div>
        <div><dt>释放日期</dt><dd>{dateLabel(row.release_date)}</dd></div>
        <div><dt>优先级</dt><dd>{row.priority ?? 100}</dd></div>
      </dl>
    </button>
    {onRelease && row.status === 'ACTIVE' && <div className="planning-order__actions">
      <button type="button" className="secondary" onClick={(ev) => { ev.stopPropagation(); onRelease(); }}>释放</button>
    </div>}
  </article>;
}

function ReservationDetailSheet({ reservation, onClose, onRelease, onChanged }) {
  // Bidirectional trace: Reservation sits between Demand and Supply.
  // Forward: Demand ← quantity → Supply (this reservation)
  // Reverse: Supply → this reservation → Demand
  // Backend only exposes the reservation. Trace for now is captured by
  // the demand / supply labels on the row itself; explicit demand and
  // supply records are rendered as labelled fields so the planner can
  // see both directions.
  return <Sheet title={reservation.reservation_no} onClose={onClose} className="planning-detail">
    <section className="planning-detail__identity">
      <span>{reservation.reservation_no}</span>
      <div>
        <h2>{reservation.product_name}</h2>
        <StatusChip status={reservation.status} domain="lifecycle">{RES_STATUS_LABELS[reservation.status] || reservation.status}</StatusChip>
      </div>
      <p className="mono">{reservation.product_code}</p>
    </section>

    <section className="planning-detail__section">
      <h3>双向追溯</h3>
      <ol className="planning-trace">
        <li><span>需求</span><strong>{DEMAND_SOURCE_LABELS[reservation.demand_source_type] || reservation.demand_source_type}</strong><span className="mono">{reservation.demand_source_id || '—'}</span></li>
        <li><span>预留</span><strong>{RES_TYPE_LABELS[reservation.reservation_type]} · {qty(reservation.quantity)}</strong><span className="mono">{reservation.reservation_no}</span></li>
        <li><span>供应</span><strong>{SUPPLY_SOURCE_LABELS[reservation.supply_source_type] || reservation.supply_source_type}</strong><span className="mono">{reservation.supply_source_id || '—'}</span></li>
      </ol>
    </section>

    <section className="planning-detail__section">
      <h3>关键事实</h3>
      <dl className="planning-detail__facts">
        <div><dt>预留数量</dt><dd>{qty(reservation.quantity)}</dd></div>
        <div><dt>优先级</dt><dd>{reservation.priority ?? 100}</dd></div>
        <div><dt>释放日期</dt><dd>{dateLabel(reservation.release_date)}</dd></div>
        <div><dt>仓库</dt><dd>{reservation.warehouse_code || '—'}</dd></div>
        <div><dt>方案</dt><dd>{reservation.scheme_id || '—'}</dd></div>
        <div><dt>MRP 运算</dt><dd>{reservation.mrp_run_id || '—'}</dd></div>
        <div><dt>创建时间</dt><dd>{reservation.created_at ? String(reservation.created_at).slice(0, 16).replace('T', ' ') : '—'}</dd></div>
      </dl>
    </section>

    <section className="planning-detail__section">
      <h3>备注</h3>
      <p>{reservation.notes || '—'}</p>
    </section>

    <div className="bottom-action-bar">
      {onRelease && reservation.status === 'ACTIVE' && <button type="button" className="danger-button" onClick={onRelease}>释放预留</button>}
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
    </div>
  </Sheet>;
}

function ReservationCreateSheet({ onClose, notify, onDone }) {
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({
    reservationType: 'STRONG', productId: '', warehouseId: '',
    demandSourceType: 'SALES_ORDER', demandSourceId: '',
    supplySourceType: 'ON_HAND', supplySourceId: '',
    quantity: '', releaseDate: '', priority: 100, notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api('/api/products?limit=500'), api('/api/warehouses?limit=500')])
      .then(([p, w]) => { setProducts(p.products || []); setWarehouses(w.warehouses || []); })
      .catch(() => setError('加载产品或仓库失败'));
  }, []);

  const valid = form.productId && form.demandSourceId && Number(form.quantity) > 0
    && (form.supplySourceType === 'ON_HAND' || form.supplySourceType === 'EXPECTED' || form.supplySourceId);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const body = {
        reservationType: form.reservationType,
        productId: form.productId,
        warehouseId: form.warehouseId || null,
        demandSourceType: form.demandSourceType,
        demandSourceId: form.demandSourceId,
        supplySourceType: form.supplySourceType,
        supplySourceId: form.supplySourceId || null,
        quantity: Number(form.quantity),
        releaseDate: form.releaseDate || null,
        priority: Number(form.priority || 100),
        notes: form.notes,
      };
      await api('/api/planning/reservations', { method: 'POST', body });
      notify('预留已建立', 'success');
      await onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return <Sheet title="新建预留" onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <p className="planning-form__hint">强预留保护关键供应不被其它需求占用；手动预留适合无现存供应时指定预计供应。</p>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <label className="form-row"><span className="field-label">预留类型 *</span>
        <select value={form.reservationType} onChange={(event) => setForm({ ...form, reservationType: event.target.value })}>
          <option value="STRONG">强预留</option>
          <option value="MANUAL">手动预留</option>
        </select>
      </label>
      <label className="form-row"><span className="field-label">产品 *</span>
        <select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
          <option value="">请选择</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
      </label>
      <label className="form-row"><span className="field-label">仓库</span>
        <select value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}>
          <option value="">不限</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
        </select>
      </label>
      <div className="planning-form__group">
        <label className="form-row"><span className="field-label">需求来源类型 *</span>
          <select value={form.demandSourceType} onChange={(event) => setForm({ ...form, demandSourceType: event.target.value })}>
            {Object.keys(DEMAND_SOURCE_LABELS).map((key) => <option key={key} value={key}>{DEMAND_SOURCE_LABELS[key]}</option>)}
          </select>
        </label>
        <label className="form-row"><span className="field-label">需求来源 ID *</span>
          <input type="text" value={form.demandSourceId} onChange={(event) => setForm({ ...form, demandSourceId: event.target.value })}/>
        </label>
      </div>
      <div className="planning-form__group">
        <label className="form-row"><span className="field-label">供应来源类型 *</span>
          <select value={form.supplySourceType} onChange={(event) => setForm({ ...form, supplySourceType: event.target.value, supplySourceId: '' })}>
            {Object.keys(SUPPLY_SOURCE_LABELS).map((key) => <option key={key} value={key}>{SUPPLY_SOURCE_LABELS[key]}</option>)}
          </select>
        </label>
        {form.supplySourceType !== 'ON_HAND' && form.supplySourceType !== 'EXPECTED' && <label className="form-row"><span className="field-label">供应来源 ID *</span>
          <input type="text" value={form.supplySourceId} onChange={(event) => setForm({ ...form, supplySourceId: event.target.value })}/>
        </label>}
      </div>
      <div className="planning-form__group">
        <label className="form-row"><span className="field-label">数量 *</span>
          <input type="number" inputMode="decimal" min="0" step="0.0001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })}/>
        </label>
        <label className="form-row"><span className="field-label">优先级</span>
          <input type="number" min="0" step="1" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}/>
        </label>
        <label className="form-row"><span className="field-label">释放日期</span>
          <input type="date" value={form.releaseDate} onChange={(event) => setForm({ ...form, releaseDate: event.target.value })}/>
        </label>
      </div>
      <label className="form-row"><span className="field-label">备注</span>
        <textarea rows={2} maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/>
      </label>
    </section>
    <div className="bottom-action-bar">
      <button type="button" className="secondary" onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={!valid || busy} onClick={submit}>确认创建</button>
    </div>
  </Sheet>;
}