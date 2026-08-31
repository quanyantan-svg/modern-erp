export const money = (cents = 0) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
export const dateTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const can = (user, permission) => user?.permissions?.includes(permission);

export function OrderTable({ orders = [], onView, actions, compact }) {
  return <div className="table-wrap"><table><thead><tr><th>订单号</th><th>客户</th><th>状态</th><th className="number">金额</th><th>制单人</th><th>创建时间</th>{!compact && <th/>}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={onView ? 'clickable' : ''} onClick={() => onView?.(order)}><td className="mono strong-text">{order.orderNo}</td><td><strong>{order.customerName}</strong><small className="block">{order.itemCount} 项明细</small></td><td><Status status={order.status} label={order.statusLabel}/></td><td className="number"><strong>{money(order.totalCents)}</strong></td><td>{order.creatorName}</td><td className="dim">{dateTime(order.createdAt)}</td>{!compact && <td className="actions" onClick={(e) => e.stopPropagation()}><button className="row-action" onClick={() => onView?.(order)}>查看</button>{actions?.(order)}</td>}</tr>)}</tbody></table>{!orders.length && <Empty text="当前没有符合条件的销售订单"/>}</div>;
}

export function Panel({ title, subtitle, action, children }) { return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
export function Toolbar({ search, setSearch, onSearch, placeholder, action, extra }) { return <div className="toolbar"><form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder}/><button>查询</button></form>{extra}<div className="toolbar-spacer"/>{action}</div>; }
export function Modal({ title, onClose, children, wide }) { return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className={`modal ${wide ? 'wide' : ''}`}><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div><div className="modal-body">{children}</div></div></div>; }
export function FormActions({ onClose, saveText = '保存', danger }) { return <div className="form-actions full"><button type="button" className="secondary" onClick={onClose}>取消</button><button className={danger ? 'danger-button' : 'primary'}>{saveText}</button></div>; }
export function Status({ status, label }) { return <span className={`status status-${status?.toLowerCase()}`}>{label}</span>; }
export function Badge({ type, children }) {
  // Map semantic badge types to existing .status color classes so badges
  // reuse the same pill design as <Status> without adding new CSS.
  const typeMap = { info: 'submitted', success: 'approved', warning: 'pending', danger: 'rejected', error: 'rejected' };
  const status = typeMap[type] || 'draft';
  return <span className={`status status-${status}`}>{children}</span>;
}
export function Active({ active }) { return <span className={`active-state ${active ? 'yes' : 'no'}`}><i/>{active ? '启用' : '停用'}</span>; }
export function Empty({ text }) { return <div className="empty"><span>◇</span><p>{text}</p></div>; }

// PurchaseReceipts

export function Loading() { return <div className="loading"><div className="spinner"/>载入中…</div>; }
