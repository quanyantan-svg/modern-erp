export const money = (cents = 0) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
export const quantity = (value = 0) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value) || 0);
export const dateTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const can = (user, permission) => user?.permissions?.includes(permission);

export function OrderTable({ orders = [], onView, actions, compact }) {
  const approvalLabel = (order) => order.status === 'SUBMITTED' ? '待审批' : order.status === 'APPROVED' ? '已审批' : order.statusLabel;
  return <div className="table-wrap"><table><thead><tr><th>订单号</th><th>客户</th><th>状态</th><th className="number">金额</th><th>制单人</th><th>创建时间</th>{!compact && <th/>}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={onView ? 'clickable' : ''} onClick={() => onView?.(order)}><td className="mono strong-text">{order.orderNo}<small className="block workflow-next">{order.status === 'DRAFT' ? '待提交' : order.status === 'SUBMITTED' ? '待审批' : order.status === 'REJECTED' ? '已驳回' : order.deliveryCount ? `已关联 ${order.deliveryCount} 张出货单` : '已审批 · 待出货'}</small></td><td><strong>{order.customerName}</strong><small className="block">{order.itemCount} 项明细</small></td><td><Status status={order.status} label={approvalLabel(order)}/></td><td className="number"><strong>{money(order.totalCents)}</strong></td><td>{order.creatorName}</td><td className="dim">{dateTime(order.createdAt)}</td>{!compact && <td className="actions" onClick={(e) => e.stopPropagation()}><button className="row-action" onClick={() => onView?.(order)}>查看</button>{actions?.(order)}</td>}</tr>)}</tbody></table>{!orders.length && <Empty text="当前没有符合条件的销售订单"/>}</div>;
}

export function Panel({ title, subtitle, action, children }) { return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
export function Toolbar({ search, setSearch, onSearch, placeholder, action, extra }) { return <div className="toolbar"><form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="search" role="search"><SearchIcon size={18}/><input aria-label={placeholder || '搜索'} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder}/>{search && <button type="button" className="search__clear" aria-label="清除搜索" onClick={() => setSearch('')}><CloseIcon size={16}/></button>}<button type="submit">查询</button></form>{extra}<div className="toolbar-spacer"/>{action}</div>; }
export function Modal({ title, onClose, children, wide }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button type="button" className="modal-close" aria-label="关闭" onClick={onClose}><CloseIcon size={18}/></button></div><div className="modal-body">{children}</div></section></div>; }
export function ConfirmDelete({ label, onConfirm, buttonLabel = '删除', message }) {
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  async function confirmDelete() { setBusy(true); try { await onConfirm(); setOpen(false); } catch { /* caller reports the user-safe API error */ } finally { setBusy(false); } }
  return <><button type="button" className="row-action danger" onClick={() => setOpen(true)}>{buttonLabel}</button>{open && <Modal title={`删除${label}？`} onClose={() => !busy && setOpen(false)}><div className="confirm-delete"><p>{message || `删除后无法恢复。确定删除这个${label}吗？`}</p><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setOpen(false)}>取消</button><button type="button" className="danger-button" disabled={busy} onClick={() => void confirmDelete()}>{busy ? '删除中…' : '删除'}</button></div></div></Modal>}</>;
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
export function ErrorState({ message = '暂时无法载入内容', onRetry }) { return <div className="error-state" role="alert"><ErrorIcon size={28}/><strong>加载失败</strong><p>{message}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>重试</button>}</div>; }
import { useState } from 'react';
import { CloseIcon, EmptyIcon, ErrorIcon, MoreIcon, SearchIcon } from './icons.jsx';
