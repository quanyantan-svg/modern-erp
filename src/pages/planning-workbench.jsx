// Planning Domain — planner-facing working surfaces.
//
// One canonical file for the `planned-orders` and `planner-workbench` routes.
// The companion `planning-reservations` and `planning-configuration` pages
// cover the matching sub-surfaces registered as CONTEXTUAL routes with
// `planned-orders` as parent route. No new launcher entries are added.
//
// Responsibilities on this file:
//   - Planned Order List / Detail / Split / Merge / Batch / Target Change
//   - Workbench exception cards with quick entry to Planned Order &
//     Reservation relationships.
// Mobile-first, 390 CSS px primary; Sheet / contextual action; one
// primary action per state.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import {
  ActionSheet, BusinessPageShell, ConfirmSheet, DangerSheet, EmptyState,
  InlineAlert, SegmentedControl, Sheet, StatusChip,
} from '../components/design-system.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import '../styles/planning-workbench.css';

// ------------------- shared formatters & labels -------------------

const qty = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value || 0));
const dateLabel = (value) => (value ? String(value).slice(0, 10) : '—');

const ORDER_FILTERS = [
  { value: '', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'RELEASED', label: '已释放' },
  { value: 'CLOSED', label: '已关闭' },
  { value: 'CANCELLED', label: '已取消' },
];

const ORDER_STATUS_LABELS = {
  DRAFT: '草稿', CONFIRMED: '已确认', RELEASED: '已释放', CLOSED: '已关闭', CANCELLED: '已取消',
};
const ORDER_STATUS_TONE = {
  DRAFT: 'neutral', CONFIRMED: 'info', RELEASED: 'success', CLOSED: 'muted', CANCELLED: 'muted',
};
const SUPPLY_TYPE_LABELS = { MAKE: '生产', BUY: '采购', OUTSOURCE: '委外' };
const SOURCE_TYPE_LABELS = { MRP: 'MRP 生成', MANUAL: '手动创建' };
const RELEASE_STATE_LABELS = {
  NOT_RELEASED: '未释放', PARTIAL: '部分释放', RELEASED: '已释放',
};
const RESERVATION_STATE_LABELS = {
  NONE: '无', PARTIAL: '部分预留', FULL: '已预留',
};
const RESERVATION_TYPE_LABELS = { STRONG: '强预留', WEAK: '弱预留', MANUAL: '手动预留' };
const RESERVATION_STATUS_LABELS = {
  ACTIVE: '生效中', RELEASED: '已释放', CONSUMED: '已消耗', CANCELLED: '已取消',
};
const SUPPLY_SOURCE_LABELS = {
  ON_HAND: '现存量', PLANNED_ORDER: '计划订单', PURCHASE_ORDER: '采购订单',
  PRODUCTION_ORDER: '生产工单', EXPECTED: '预计供应',
};
const DEMAND_SOURCE_LABELS = {
  SALES_ORDER: '销售订单', FORECAST: '预测', PRODUCTION_ORDER: '生产工单', MANUAL: '手动需求',
};

const makeOrderNo = (row) => (row?.order_no || '').trim();

const isClosed = (row) => row && (row.status === 'CLOSED' || row.status === 'CANCELLED' || row.status === 'RELEASED');

// ------------------- top-level router -------------------

export default function PlanningWorkbench({ user, notify }) {
  const navigation = useAppNavigation();
  if (navigation.currentPage === 'planned-orders') {
    return <PlannedOrders user={user} notify={notify}/>;
  }
  return <PlannerWorkbench notify={notify} user={user}/>;
}

// ------------------- Planned Orders surface -------------------

function PlannedOrders({ user, notify }) {
  const navigation = useAppNavigation();
  const canManage = can(user, 'MRP_MANAGE');
  const canRelease = can(user, 'PLANNED_ORDER_RELEASE');
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [state, setState] = useState('LOADING');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sheet, setSheet] = useState(null);

  const load = async () => {
    setState('LOADING');
    try {
      const data = await api('/api/planning/planned-orders');
      setRows(data.plannedOrders || []);
      setState('READY');
    } catch (error) { setState('ERROR'); notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, []);

  // Direct deep-link support: #planned-orders/<id> opens detail sheet.
  useEffect(() => {
    if (navigation.target?.page === 'planned-orders' && navigation.target.documentId) {
      setOpenId(navigation.target.documentId);
    }
  }, [navigation.target]);

  const visible = useMemo(() => rows.filter((row) => !filter || row.status === filter), [rows, filter]);
  const open = rows.find((row) => row.id === openId) || null;
  const selectedRows = visible.filter((row) => selected.has(row.id));

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const reload = async () => {
    await load();
    if (openId) {
      try {
        const fresh = await api(`/api/planning/planned-orders/${openId}`);
        if (fresh.plannedOrder) setOpenId(fresh.plannedOrder.id);
      } catch (error) { /* detail may have been closed */ }
    }
  };

  const runAction = async (order, action) => {
    setBusy(true);
    try {
      const result = await api(`/api/planning/planned-orders/${order.id}/${action}`, { method: 'POST' });
      if (action === 'release') {
        notify(result.type === 'OUTSOURCE' ? `已交接委外 ${result.type}` : `已生成${SUPPLY_TYPE_LABELS[result.type] || ''}指令`, 'success');
      } else if (action === 'confirm') notify('计划订单已确认', 'success');
      else if (action === 'close') notify('计划订单已关闭', 'success');
      else if (action === 'cancel') notify('计划订单已取消', 'success');
      await reload();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const runBatchAction = async (action) => {
    const ids = Array.from(selected);
    if (action === 'merge') {
      if (ids.length < 2) { notify('至少选择两张计划订单', 'error'); return; }
      setSheet({ kind: 'merge', ids });
      return;
    }
    setBusy(true);
    try {
      let success = 0; let failed = 0;
      for (const id of ids) {
        try {
          await api(`/api/planning/planned-orders/${id}/${action}`, { method: 'POST' });
          success += 1;
        } catch (error) { failed += 1; }
      }
      notify(`批量${action}完成：${success} 成功，${failed} 失败`, failed ? 'error' : 'success');
      setSelected(new Set());
      await reload();
    } finally { setBusy(false); }
  };

  const openSheet = (kind, payload) => setSheet({ kind, ...payload });
  const closeSheet = () => setSheet(null);

  const sheetTitleByKind = {
    split: '拆分计划订单', merge: '合并计划订单', target: '变更供给类型',
    batch: '批量操作', create: '新建计划订单',
  };

  return <BusinessPageShell className="planning-closure" width="rail">
    <header className="planning-hero">
      <div><span>PLANNING CONTROL</span><h2>计划订单</h2></div>
      <p>确认供给建议，再安全释放到生产、采购或委外交接。可拆分、合并、按状态过滤。</p>
    </header>

    <div className="planning-toolbar">
      <SegmentedControl label="计划订单状态" options={ORDER_FILTERS} value={filter} onChange={(value) => { setFilter(value); setSelected(new Set()); }}/>
      <div className="planning-toolbar__actions">
        {canManage && <AppLink page="planning-configuration" className="secondary">配置</AppLink>}
        {canManage && <AppLink page="planning-reservations" className="secondary">预留</AppLink>}
        {canManage && <button type="button" className="primary" onClick={() => openSheet('create')}>新建</button>}
      </div>
    </div>

    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="加载失败" action={<button className="secondary" onClick={() => void load()}>重新加载</button>}/>}
    {state === 'READY' && visible.length === 0 && <EmptyState title="暂无计划订单" description="完成 MRP 运算后，系统会形成可追溯的计划订单。"/>}

    {state === 'READY' && visible.length > 0 && <>
      {selected.size > 0 && <BatchBar count={selected.size} canManage={canManage} canRelease={canRelease} onClear={() => setSelected(new Set())} onAction={runBatchAction}/>}
      <div className="planning-order-list">
        {visible.map((row) => <PlannedRow
          key={row.id}
          row={row}
          canManage={canManage}
          canRelease={canRelease}
          busy={busy}
          selected={selected.has(row.id)}
          onOpen={() => openSheet('detail', { id: row.id })}
          onToggleSelect={() => toggleSelect(row.id)}
          onAction={(action) => runAction(row, action)}
        />)}
      </div>
    </>}

    {sheet?.kind === 'detail' && open && <PlannedOrderDetailSheet
      orderId={open.id}
      onClose={() => { setSheet(null); setOpenId(null); }}
      onChanged={reload}
      onAction={(action) => runAction(open, action)}
      onSheet={(k, payload) => openSheet(k, payload)}
      canManage={canManage}
      canRelease={canRelease}
      busy={busy}
      user={user}
      notify={notify}
    />}

    {sheet?.kind === 'split' && open && <PlannedOrderSplitSheet
      order={open}
      onClose={closeSheet}
      notify={notify}
      onDone={async () => { closeSheet(); await reload(); }}
    />}

    {sheet?.kind === 'target' && open && <PlannedOrderTargetSheet
      order={open}
      onClose={closeSheet}
      notify={notify}
      onDone={async () => { closeSheet(); await reload(); }}
    />}

    {sheet?.kind === 'merge' && <MergeSheet
      ids={sheet.ids}
      rows={rows}
      onClose={closeSheet}
      notify={notify}
      onDone={async () => { closeSheet(); setSelected(new Set()); await reload(); }}
    />}

    {sheet?.kind === 'batch' && <BatchSheet
      count={selected.size}
      canManage={canManage}
      canRelease={canRelease}
      onClose={closeSheet}
      onApply={async (action) => { closeSheet(); await runBatchAction(action); }}
    />}

    {sheet?.kind === 'create' && <PlannedOrderCreateSheet
      onClose={closeSheet}
      notify={notify}
      onDone={async (id) => { closeSheet(); await reload(); setOpenId(id); openSheet('detail', { id }); }}
    />}
  </BusinessPageShell>;
}

// ------------------- planned order list row -------------------

function PlannedRow({ row, canManage, canRelease, busy, selected, onOpen, onToggleSelect, onAction }) {
  const remaining = Math.max(0, Number(row.quantity || 0) - Number(row.released_quantity || 0));
  const isBatchable = !isClosed(row) && row.status !== 'RELEASED';
  return <article className={`planning-order ${selected ? 'is-selected' : ''}`}>
    <label className="planning-order__select"><input type="checkbox" checked={selected} disabled={!isBatchable} onChange={onToggleSelect} aria-label={`选择 ${row.order_no}`}/></label>
    <button type="button" className="planning-order__open" onClick={onOpen}>
      <div className="planning-order__identity"><span className="mono">{row.order_no}</span><StatusChip status={row.status}>{ORDER_STATUS_LABELS[row.status] || row.status}</StatusChip></div>
      <h3>{row.product_name}</h3>
      <p className="mono planning-order__code">{row.product_code}</p>
      <dl>
        <div><dt>供给</dt><dd>{SUPPLY_TYPE_LABELS[row.supply_type] || row.supply_type}</dd></div>
        <div><dt>来源</dt><dd>{SOURCE_TYPE_LABELS[row.source_type] || row.source_type}</dd></div>
        <div><dt>计划数量</dt><dd>{qty(row.quantity)} {row.unit}</dd></div>
        <div><dt>剩余</dt><dd>{qty(remaining)} {row.unit}</dd></div>
        <div><dt>需求日期</dt><dd>{dateLabel(row.need_date)}</dd></div>
        <div><dt>计划供应</dt><dd>{dateLabel(row.planned_supply_date)}</dd></div>
      </dl>
    </button>
    <div className="planning-order__actions">
      {canManage && row.status === 'DRAFT' && <button className="secondary" disabled={busy} onClick={(ev) => { ev.stopPropagation(); onAction('confirm'); }}>确认</button>}
      {canManage && (row.status === 'DRAFT' || row.status === 'CONFIRMED') && <button className="secondary" disabled={busy} onClick={(ev) => { ev.stopPropagation(); onAction(row.status === 'DRAFT' ? 'cancel' : 'close'); }}>{row.status === 'DRAFT' ? '取消' : '关闭'}</button>}
      {canRelease && row.status === 'CONFIRMED' && Number(remaining) > 0 && <button className="primary" disabled={busy} onClick={(ev) => { ev.stopPropagation(); onAction('release'); }}>释放供给</button>}
    </div>
  </article>;
}

// ------------------- batch bar / sheet -------------------

function BatchBar({ count, canManage, canRelease, onClear, onAction }) {
  return <div className="planning-batch-bar" role="region" aria-label="批量操作">
    <strong>已选择 {count} 条计划订单</strong>
    <div>
      {canManage && <button type="button" className="secondary" onClick={() => onAction('close')}>批量关闭</button>}
      {canRelease && <button type="button" className="primary" onClick={() => onAction('release')}>批量释放</button>}
      {canManage && <button type="button" className="secondary" onClick={() => onAction('merge')}>合并</button>}
      <button type="button" className="ghost" onClick={onClear}>清除选择</button>
    </div>
  </div>;
}

function BatchSheet({ count, canManage, canRelease, onClose, onApply }) {
  return <ActionSheet title={`批量操作（${count} 条）`} onClose={onClose}>
    {canManage && <button type="button" className="secondary" onClick={() => onApply('close')}>批量关闭</button>}
    {canManage && <button type="button" className="secondary" onClick={() => onApply('merge')}>合并到首条</button>}
    {canRelease && <button type="button" className="primary" onClick={() => onApply('release')}>批量释放</button>}
    <button type="button" className="ghost" onClick={onClose}>取消</button>
  </ActionSheet>;
}

// ------------------- planned order detail sheet -------------------

function PlannedOrderDetailSheet({ orderId, onClose, onChanged, onAction, onSheet, canManage, canRelease, busy, user, notify }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('LOADING');
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reservations, setReservations] = useState([]);

  const load = async () => {
    setState('LOADING');
    try {
      const result = await api(`/api/planning/planned-orders/${orderId}`);
      setData(result.plannedOrder);
      // Reservation trace: query all reservations referring to this product.
      const list = await api(`/api/planning/reservations`);
      setReservations((list.reservations || []).filter((row) => row.product_id === result.plannedOrder.product_id));
      setState('READY');
    } catch (error) { setState('ERROR'); notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, [orderId]);

  const remaining = data ? Math.max(0, Number(data.quantity || 0) - Number(data.released_quantity || 0)) : 0;
  const userCanRelease = canRelease || can(user, 'PLANNED_ORDER_RELEASE');
  const canEditMeta = canManage && ['DRAFT', 'CONFIRMED'].includes(data?.status) && Number(data?.released_quantity || 0) === 0;
  const canConfirm = canManage && data?.status === 'DRAFT';
  const canReleaseAction = userCanRelease && data?.status === 'CONFIRMED' && remaining > 0;

  return <Sheet title={data?.order_no || '计划订单'} onClose={onClose} className="planning-detail">
    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="详情加载失败" action={<button className="secondary" onClick={() => void load()}>重新加载</button>}/>}
    {state === 'READY' && data && <>
      <section className="planning-detail__identity">
        <span>{data.order_no}</span>
        <div>
          <h2>{data.product_name}</h2>
          <StatusChip status={data.status} domain="lifecycle">{ORDER_STATUS_LABELS[data.status]}</StatusChip>
        </div>
        <p className="mono">{data.product_code}</p>
      </section>

      <section className="planning-detail__section">
        <h3>基本信息</h3>
        <dl className="planning-detail__facts">
          <div><dt>计划数量</dt><dd>{qty(data.quantity)} {data.unit}</dd></div>
          <div><dt>已释放</dt><dd>{qty(data.released_quantity)} {data.unit}</dd></div>
          <div><dt>剩余</dt><dd>{qty(remaining)} {data.unit}</dd></div>
          <div><dt>需求日期</dt><dd>{dateLabel(data.need_date)}</dd></div>
          <div><dt>计划供应日期</dt><dd>{dateLabel(data.planned_supply_date)}</dd></div>
          <div><dt>供给类型</dt><dd>{SUPPLY_TYPE_LABELS[data.supply_type] || data.supply_type}</dd></div>
          <div><dt>来源</dt><dd>{SOURCE_TYPE_LABELS[data.source_type] || data.source_type}</dd></div>
          <div><dt>释放状态</dt><dd>{RELEASE_STATE_LABELS[data.release_state] || data.release_state || '未释放'}</dd></div>
          <div><dt>预留状态</dt><dd>{RESERVATION_STATE_LABELS[data.reservation_state] || data.reservation_state || '无'}</dd></div>
          <div><dt>更新时间</dt><dd>{data.updated_at ? String(data.updated_at).slice(0, 16).replace('T', ' ') : '—'}</dd></div>
        </dl>
      </section>

      {data.sources && data.sources.length > 0 && <section className="planning-detail__section">
        <h3>来源追溯</h3>
        <ul className="planning-detail__sources">
          {data.sources.map((src) => <li key={src.id}>
            <span>{SOURCE_TYPE_LABELS[src.source_type] || src.source_type}</span>
            <span className="mono">{src.source_id}</span>
            <strong>{qty(src.quantity)} {data.unit}</strong>
          </li>)}
        </ul>
      </section>}

      {reservations.length > 0 && <section className="planning-detail__section">
        <h3>相关预留</h3>
        <ul className="planning-detail__reservations">
          {reservations.slice(0, 5).map((r) => <li key={r.id}>
            <strong>{r.reservation_no}</strong>
            <span>{RESERVATION_TYPE_LABELS[r.reservation_type] || r.reservation_type}</span>
            <span>{qty(r.quantity)} {data.unit}</span>
            <StatusChip status={r.status}>{RESERVATION_STATUS_LABELS[r.status] || r.status}</StatusChip>
          </li>)}
        </ul>
        <p className="planning-detail__hint"><AppLink page="planning-reservations" className="secondary">查看全部预留</AppLink></p>
      </section>}

      <section className="planning-detail__section">
        <h3>操作</h3>
        <div className="planning-detail__actions">
          {canEditMeta && <button type="button" className="secondary" onClick={() => onSheet('split', { id: data.id })}>拆分</button>}
          {canEditMeta && <button type="button" className="secondary" onClick={() => onSheet('target', { id: data.id })}>变更供给类型</button>}
          {canConfirm && <button type="button" className="secondary" disabled={busy} onClick={() => onAction('confirm')}>确认</button>}
          {canReleaseAction && <button type="button" className="primary" disabled={busy} onClick={() => onAction('release')}>释放供给</button>}
          {canEditMeta && <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmClose(true)}>关闭</button>}
          {canEditMeta && data.status === 'DRAFT' && Number(data.released_quantity) === 0 && <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmCancel(true)}>取消</button>}
          {!canEditMeta && !canConfirm && !canReleaseAction && <InlineAlert tone="info">当前状态下没有可执行的操作。</InlineAlert>}
        </div>
      </section>
    </>}

    {confirmClose && <ConfirmSheet title="关闭计划订单" message={`确定关闭 ${data?.order_no}？关闭后不再纳入运算。`} onClose={() => setConfirmClose(false)} onConfirm={async () => { setConfirmClose(false); await onAction('close'); await onChanged(); }}/>}
    {confirmCancel && <DangerSheet title="取消计划订单" message={`确定取消 ${data?.order_no}？取消后不可恢复。`} onClose={() => setConfirmCancel(false)} onConfirm={async () => { setConfirmCancel(false); await onAction('cancel'); await onChanged(); }}/>}
  </Sheet>;
}

// ------------------- split sheet -------------------

function PlannedOrderSplitSheet({ order, onClose, notify, onDone }) {
  const remaining = Math.max(0, Number(order.quantity) - Number(order.released_quantity));
  const max = remaining;
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const childQuantity = Number(quantity || 0);
  const newParentQuantity = Math.max(0, remaining - childQuantity);
  const total = newParentQuantity + childQuantity;
  const valid = Number.isFinite(childQuantity) && childQuantity > 0 && childQuantity < max - 1e-9;

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/planning/planned-orders/${order.id}/split`, { method: 'POST', body: { quantity: childQuantity } });
      notify(`已生成拆分订单，原单剩余 ${qty(newParentQuantity)}`, 'success');
      await onDone();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };

  return <Sheet title={`拆分 ${order.order_no}`} onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <p className="planning-form__hint">从原订单可继续拆分的剩余量中切出一部分作为新订单。拆分后两单总和不超原单剩余量。</p>
      <dl className="planning-form__facts">
        <div><dt>当前计划数量</dt><dd>{qty(order.quantity)} {order.unit}</dd></div>
        <div><dt>已释放</dt><dd>{qty(order.released_quantity)} {order.unit}</dd></div>
        <div><dt>可拆分剩余</dt><dd><strong>{qty(remaining)} {order.unit}</strong></dd></div>
      </dl>
    </section>
    <section className="planning-form__section">
      <label className="form-row"><span className="field-label">拆分数量</span>
        <input type="number" inputMode="decimal" min="0" max={max} step="0.0001" value={quantity} onChange={(event) => setQuantity(event.target.value)} autoFocus/>
      </label>
      <small className="planning-form__hint">必须大于 0 且小于可拆分剩余 {qty(remaining)}。</small>
    </section>
    <section className="planning-form__section planning-form__preview">
      <h3>预览</h3>
      <dl className="planning-form__facts">
        <div><dt>新订单数量</dt><dd><strong>{qty(childQuantity)} {order.unit}</strong></dd></div>
        <div><dt>原单剩余</dt><dd>{qty(newParentQuantity)} {order.unit}</dd></div>
        <div><dt>合计</dt><dd>{qty(total)} {order.unit}</dd></div>
      </dl>
      {valid
        ? <InlineAlert tone="success">数量守恒：原 {qty(remaining)} = 新订单 {qty(childQuantity)} + 原单保留 {qty(newParentQuantity)}。</InlineAlert>
        : <InlineAlert tone="danger">拆分数量无效。</InlineAlert>}
    </section>
    <div className="bottom-action-bar">
      <button type="button" className="secondary" onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={!valid || busy} onClick={submit}>确认拆分</button>
    </div>
  </Sheet>;
}

// ------------------- target change sheet -------------------

function PlannedOrderTargetSheet({ order, onClose, notify, onDone }) {
  const [target, setTarget] = useState(order.supply_type);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = ['MAKE', 'BUY', 'OUTSOURCE'].includes(target) && target !== order.supply_type && reason.trim().length >= 3;

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/planning/planned-orders/${order.id}/target`, { method: 'POST', body: { supplyType: target, reason: reason.trim() } });
      notify('供给类型已变更。', 'success');
      await onDone();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };

  return <Sheet title={`变更供给类型 ${order.order_no}`} onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <p className="planning-form__hint">仅 DRAFT / CONFIRMED 且未释放的计划订单可以变更供给类型，必须填写变更原因。</p>
      <dl className="planning-form__facts">
        <div><dt>当前供给类型</dt><dd>{SUPPLY_TYPE_LABELS[order.supply_type]}</dd></div>
        <div><dt>当前状态</dt><dd>{ORDER_STATUS_LABELS[order.status]}</dd></div>
      </dl>
    </section>
    <section className="planning-form__section">
      <label className="form-row"><span className="field-label">新供给类型</span>
        <select value={target} onChange={(event) => setTarget(event.target.value)}>
          {['MAKE', 'BUY', 'OUTSOURCE'].map((value) => <option key={value} value={value}>{SUPPLY_TYPE_LABELS[value]}</option>)}
        </select>
      </label>
      <label className="form-row"><span className="field-label">变更原因</span>
        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="如：原 BOM 不再维护，转采购" maxLength={300}/>
      </label>
    </section>
    <div className="bottom-action-bar">
      <button type="button" className="secondary" onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={!valid || busy} onClick={submit}>确认变更</button>
    </div>
  </Sheet>;
}

// ------------------- merge sheet -------------------

function MergeSheet({ ids, rows, onClose, notify, onDone }) {
  const selected = ids.map((id) => rows.find((row) => row.id === id)).filter(Boolean);
  const blockers = useMemo(() => findMergeBlockers(selected), [selected]);
  const compatible = blockers.length === 0 && selected.length >= 2;
  const total = selected.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const target = selected[0];
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/planning/planned-orders/merge', { method: 'POST', body: { ids } });
      notify(`已合并 ${selected.length} 条计划订单到 ${target?.order_no}，合计 ${qty(total)}。`, 'success');
      await onDone();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };

  return <Sheet title={`合并计划订单（${selected.length} 条）`} onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <p className="planning-form__hint">合并必须满足：相同产品、相同供给类型、相同需求日期、未释放、相同状态。</p>
      <ul className="planning-form__list">
        {selected.map((row) => <li key={row.id}>
          <span className="mono">{row.order_no}</span>
          <span>{row.product_code}</span>
          <span>{SUPPLY_TYPE_LABELS[row.supply_type]}</span>
          <span>{dateLabel(row.need_date)}</span>
          <span>{qty(row.quantity)}</span>
          <StatusChip status={row.status}>{ORDER_STATUS_LABELS[row.status]}</StatusChip>
        </li>)}
      </ul>
    </section>
    {blockers.length > 0 && <section className="planning-form__section">
      <h3>不兼容项</h3>
      <ul className="planning-form__blockers">
        {blockers.map((line, idx) => <li key={idx}>{line}</li>)}
      </ul>
    </section>}
    <section className="planning-form__section planning-form__preview">
      <h3>合并预览</h3>
      <dl className="planning-form__facts">
        <div><dt>目标订单</dt><dd className="mono">{target?.order_no}</dd></div>
        <div><dt>合计数量</dt><dd><strong>{qty(total)}</strong></dd></div>
        <div><dt>合并后</dt><dd>{target?.product_code} · {SUPPLY_TYPE_LABELS[target?.supply_type]} · {dateLabel(target?.need_date)}</dd></div>
      </dl>
      {compatible
        ? <InlineAlert tone="success">兼容可合并。</InlineAlert>
        : <InlineAlert tone="danger">所选计划订单不兼容，请调整后重试。</InlineAlert>}
    </section>
    <div className="bottom-action-bar">
      <button type="button" className="secondary" onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={!compatible || busy} onClick={submit}>确认合并</button>
    </div>
  </Sheet>;
}

function findMergeBlockers(rows) {
  const lines = [];
  if (rows.length < 2) lines.push('至少选择两条计划订单');
  if (rows.length >= 2) {
    const first = rows[0];
    rows.forEach((row, idx) => {
      if (idx === 0) return;
      if (row.product_id !== first.product_id) lines.push(`${row.order_no} 与 ${first.order_no} 产品不同`);
      if (row.supply_type !== first.supply_type) lines.push(`${row.order_no} 与 ${first.order_no} 供给类型不同`);
      if (row.need_date !== first.need_date) lines.push(`${row.order_no} 与 ${first.order_no} 需求日期不同`);
      if (row.status !== first.status) lines.push(`${row.order_no} 与 ${first.order_no} 状态不同`);
      if (Number(row.released_quantity) > 0) lines.push(`${row.order_no} 已有释放数量，不能合并`);
    });
    if (rows.some((row) => isClosed(row))) lines.push('已关闭 / 已取消的计划订单不能合并');
  }
  return lines;
}

// ------------------- create sheet -------------------

function PlannedOrderCreateSheet({ onClose, notify, onDone }) {
  const [form, setForm] = useState({ productId: '', quantity: '', supplyType: 'BUY', needDate: new Date().toISOString().slice(0, 10), plannedSupplyDate: '', notes: '' });
  const [products, setProducts] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/products?limit=500').then((res) => setProducts(res.products || [])).catch(() => setProducts([]));
  }, []);

  const valid = form.productId && Number(form.quantity) > 0 && form.needDate;

  const submit = async () => {
    setBusy(true);
    try {
      const body = { productId: form.productId, quantity: Number(form.quantity), supplyType: form.supplyType, needDate: form.needDate };
      if (form.plannedSupplyDate) body.plannedSupplyDate = form.plannedSupplyDate;
      if (form.notes) body.notes = form.notes;
      const result = await api('/api/planning/planned-orders', { method: 'POST', body });
      notify(`已创建计划订单 ${result.orderNo}`, 'success');
      await onDone(result.id);
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };

  return <Sheet title="新建计划订单" onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <label className="form-row"><span className="field-label">产品 *</span>
        <select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
          <option value="">请选择产品</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select>
      </label>
      <label className="form-row"><span className="field-label">计划数量 *</span>
        <input type="number" inputMode="decimal" min="0" step="0.0001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })}/>
      </label>
      <label className="form-row"><span className="field-label">供给类型</span>
        <select value={form.supplyType} onChange={(event) => setForm({ ...form, supplyType: event.target.value })}>
          {['MAKE', 'BUY', 'OUTSOURCE'].map((value) => <option key={value} value={value}>{SUPPLY_TYPE_LABELS[value]}</option>)}
        </select>
      </label>
      <label className="form-row"><span className="field-label">需求日期 *</span>
        <input type="date" value={form.needDate} onChange={(event) => setForm({ ...form, needDate: event.target.value })}/>
      </label>
      <label className="form-row"><span className="field-label">计划供应日期</span>
        <input type="date" value={form.plannedSupplyDate} onChange={(event) => setForm({ ...form, plannedSupplyDate: event.target.value })}/>
      </label>
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

// ------------------- planner workbench (exceptions + actions) -------------------

function PlannerWorkbench({ user, notify }) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('LOADING');
  const [exception, setException] = useState('ALL');
  const load = async () => { setState('LOADING'); try { setData(await api('/api/planning/workbench')); setState('READY'); } catch (error) { setState('ERROR'); notify(error.message, 'error'); } };
  useEffect(() => { void load(); }, []);
  const rows = (data?.workbench?.rows || []).filter((row) => exception === 'ALL' || row.exception === exception);
  const shortages = (data?.workbench?.rows || []).filter((row) => row.exception === 'SHORTAGE').length;
  const excess = (data?.workbench?.rows || []).filter((row) => row.exception === 'EXCESS').length;

  return <BusinessPageShell className="planning-closure" width="rail">
    <header className="planning-hero"><div><span>PLANNER WORKBENCH</span><h2>计划员工作台</h2></div><p>先看例外，再追踪需求、确定供给与计划余额。</p></header>
    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="工作台加载失败" action={<button className="secondary" onClick={() => void load()}>重新加载</button>}/>}
    {state === 'READY' && <>
      <section className="planning-pulse">
        <div><span>物料</span><strong>{data?.workbench?.rows?.length || 0}</strong></div>
        <div className={shortages ? 'is-danger' : ''}><span>短缺</span><strong>{shortages}</strong></div>
        <div className={excess ? 'is-warn' : ''}><span>超储</span><strong>{excess}</strong></div>
        <div><span>计划窗口</span><strong>{data?.workbench?.from} → {data?.workbench?.to}</strong></div>
      </section>
      <SegmentedControl label="例外筛选" value={exception} onChange={setException} options={[{value:'ALL',label:'全部'},{value:'SHORTAGE',label:'短缺'},{value:'EXCESS',label:'超储'}]}/>
      {!rows.length && <InlineAlert tone="success">当前筛选没有计划例外。</InlineAlert>}
      <div className="planning-balance-list">{rows.map((row) => <WorkbenchCard key={row.id} row={row}/>)}</div>
    </>}
  </BusinessPageShell>;
}

function WorkbenchCard({ row }) {
  return <article className={`planning-balance ${row.exception ? `is-${row.exception.toLowerCase()}` : ''}`}>
    <div><strong className="mono">{row.code}</strong><h3>{row.name}</h3></div>
    <StatusChip status={row.exception || 'NORMAL'}>{row.exception === 'SHORTAGE' ? '短缺' : row.exception === 'EXCESS' ? '超储' : '正常'}</StatusChip>
    <dl>
      <div><dt>现存量</dt><dd>{qty(row.onHand)}</dd></div>
      <div><dt>需求</dt><dd>{qty(row.demand)}</dd></div>
      <div><dt>确定供给</dt><dd>{qty(row.firmSupply)}</dd></div>
      <div><dt>计划供给</dt><dd>{qty(row.plannedSupply)}</dd></div>
      <div><dt>预计余额</dt><dd>{qty(row.projectedBalance)}</dd></div>
      <div><dt>强预留</dt><dd>{qty(row.strongReserved)}</dd></div>
    </dl>
    <div className="planning-balance__actions">
      <AppLink page="planned-orders" className="secondary">查看计划订单</AppLink>
      <AppLink page="planning-reservations" className="secondary">查看预留</AppLink>
    </div>
  </article>;
}