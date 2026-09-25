export const money = (cents = 0) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2 }).format((Number(cents) || 0) / 100);
export const quantity = (value = 0) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value) || 0);
export const dateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const part = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
};
export const can = (user, permission) => user?.permissions?.includes(permission);

export function OrderTable({ orders = [], onView, actions, compact }) {
  const approvalLabel = (order) => order.status === 'SUBMITTED' ? '待审批' : order.status === 'APPROVED' ? '已审批' : order.statusLabel;
  return <div className="table-wrap"><table><thead><tr><th>订单号</th><th>客户</th><th>状态</th><th className="number">金额</th><th>制单人</th><th>创建时间</th>{!compact && <th/>}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={onView ? 'clickable' : ''} onClick={() => onView?.(order)}><td className="mono strong-text">{order.orderNo}<small className="block workflow-next">{order.status === 'DRAFT' ? '待提交' : order.status === 'SUBMITTED' ? '待审批' : order.status === 'REJECTED' ? '已驳回' : order.deliveryCount ? `已关联 ${order.deliveryCount} 张出货单` : '已审批 · 待出货'}</small></td><td><strong>{order.customerName}</strong><small className="block">{order.itemCount} 项明细</small></td><td><Status status={order.status} label={approvalLabel(order)}/></td><td className="number"><strong>{money(order.totalCents)}</strong></td><td>{order.creatorName}</td><td className="dim">{dateTime(order.createdAt)}</td>{!compact && <td className="actions" onClick={(e) => e.stopPropagation()}><button className="row-action" onClick={() => onView?.(order)}>查看</button>{actions?.(order)}</td>}</tr>)}</tbody></table>{!orders.length && <Empty title="还没有销售订单" text="新建销售订单后，可以提交审批并安排出货。"/>}</div>;
}

export function Panel({ title, subtitle, action, children }) { return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
export function Toolbar({ search, setSearch, onSearch, placeholder, action, extra }) { return <div className={`toolbar${action && !extra ? ' toolbar--search-action' : ''}`}><form onSubmit={(e) => { e.preventDefault(); onSearch?.(); }} className="search" role="search"><SearchIcon size={18}/><input aria-label={placeholder || '搜索'} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder}/>{search && <button type="button" className="search__clear" aria-label="清除搜索" onClick={() => { setSearch(''); queueMicrotask(() => onSearch?.()); }}><CloseIcon size={16}/></button>}</form>{extra}<div className="toolbar-spacer"/>{action}</div>; }
export function Modal({ title, onClose, children, wide }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button type="button" className="modal-close" aria-label="关闭" onClick={onClose}><CloseIcon size={18}/></button></div><div className="modal-body">{children}</div></section></div>; }
export function ConfirmDelete({ label, onConfirm, buttonLabel = '删除', message }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  async function confirmDelete() { setBusy(true); try { await onConfirm(); setOpen(false); } catch { /* caller reports the user-safe API error */ } finally { setBusy(false); } }
  return <><button type="button" className="row-action danger" onClick={() => setOpen(true)}>{buttonLabel}</button>{open && <Modal title={`删除${label}？`} onClose={() => !busy && setOpen(false)}><div className="confirm-delete"><p>{message || `删除后无法恢复。确定删除这个${label}吗？`}</p><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="danger-button" disabled={busy} onClick={() => void confirmDelete()}>{busy ? '删除中…' : '删除'}</button></div></div></Modal>}</>;
}
export function ConfirmAction({ title, message, confirmLabel = '确认', buttonLabel = confirmLabel, destructive = false, onConfirm, className = '' }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  async function run() { setBusy(true); try { await onConfirm(); setOpen(false); } catch { /* caller presents the safe error */ } finally { setBusy(false); } }
  return <><button type="button" className={className || (destructive ? 'danger-button' : 'primary')} onClick={() => setOpen(true)}>{buttonLabel}</button>{open && <Modal title={title} onClose={() => !busy && setOpen(false)}><div className="confirm-delete"><p>{message}</p><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className={destructive ? 'danger-button' : 'primary'} disabled={busy} onClick={() => void run()}>{busy ? '正在处理…' : confirmLabel}</button></div></div></Modal>}</>;
}
export function ActionMenu({ children }) { return <details className="action-menu"><summary aria-label="更多操作"><MoreIcon size={18}/></summary><div className="action-menu__items">{children}</div></details>; }
export function FormActions({ onClose, saveText = '保存', danger }) { return <div className="form-actions full"><button type="button" className="secondary" onClick={onClose}>取消</button><button className={danger ? 'danger-button' : 'primary'}>{saveText}</button></div>; }
export function Status({ status, label }) { return <span className={`status ${status?.toLowerCase() || 'draft'}`}>{label}</span>; }
export function Badge({ type, children }) {
  // Map semantic badge types to existing .status color classes so badges
  // reuse the same pill design as <Status> without adding new CSS.
  const typeMap = { info: 'submitted', success: 'approved', warning: 'pending', danger: 'rejected', error: 'rejected' };
  const status = typeMap[type] || 'draft';
  return <span className={`status ${status}`}>{children}</span>;
}
export function Active({ active }) { return <span className={`active-state ${active ? 'yes' : 'no'}`}><i/>{active ? '启用' : '停用'}</span>; }
export function Empty({ text, title = '暂无相关数据', action }) { return <div className="empty"><EmptyIcon size={28}/><strong>{title}</strong><p>{text}</p>{action}</div>; }

// PurchaseReceipts

export function Loading() { return <div className="loading" role="status"><div className="spinner"/><span>正在载入…</span></div>; }
export function ErrorState({ message = '暂时无法获取数据，请稍后重试。', onRetry }) { return <div className="error-state" role="alert"><ErrorIcon size={28}/><strong>加载失败</strong><p>{message}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>重新加载</button>}</div>; }
import { useState } from 'react';
import { CloseIcon, EmptyIcon, ErrorIcon, MoreIcon, SearchIcon } from './icons.jsx';
import { centsToYuanInput, yuanToCents, yuanToNonNegativeCents } from '../lib/money.js';

// V1.3 Phase 1: YuanField is the canonical yuan-facing money input.
// The component stores integer cents in the parent form state
// (matching the API/DB contract) and renders yuan decimal in the
// <input>. The boundary is the only place where the two
// representations meet, so logs, transport, and storage stay
// integer-only.
export function YuanField({ valueCents, onChangeCents, min = 0, step = '0.01', disabled, required, ariaLabel, inputMode = 'decimal', className }) {
  const display = centsToYuanInput(valueCents);
  return (
    <input
      type="number"
      inputMode={inputMode}
      min={min}
      step={step}
      value={display}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      className={className}
      onChange={(event) => {
        const next = Number(min) <= 0
          ? yuanToNonNegativeCents(event.target.value)
          : yuanToCents(event.target.value);
        // Accept empty input as 0; reject malformed entries.
        if (event.target.value === '' || event.target.value === null) {
          onChangeCents?.(0);
          return;
        }
        if (next === null) {
          // Keep the displayed value but signal invalid via NaN-like
          // sentinel so the parent form can decide whether to gate
          // submit. We never persist NaN to the form state.
          onChangeCents?.(Number.NaN);
          return;
        }
        onChangeCents?.(next);
      }}
    />
  );
}
