import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { dateTime, money } from './ui.jsx';

export const APPROVAL_TABS = [
  { key: 'pending', label: '待审批' },
  { key: 'approved', label: '已审批' },
  { key: 'rejected', label: '已驳回' },
  { key: 'created', label: '我发起' },
  { key: 'copied', label: '抄送我', disabled: true },
];

export function approvalActionRequest(item, action, reason = '') {
  const id = encodeURIComponent(item.documentId);
  if (item.documentType === 'SALES_ORDER') {
    return { path: `/api/orders/${id}/${action}`, options: { method: 'POST', ...(action === 'reject' ? { body: { reason } } : {}) } };
  }
  if (item.documentType === 'PURCHASE_ORDER') {
    return { path: `/api/purchase-orders/${id}/${action}`, options: { method: 'POST', ...(action === 'reject' ? { body: { reason } } : {}) } };
  }
  if (item.documentType === 'PURCHASE_REQUISITION') {
    return { path: `/api/purchase-requisitions/${id}/${action}`, options: { method: 'POST', ...(action === 'reject' ? { body: { reason } } : {}) } };
  }
  if (item.documentType === 'INVENTORY_CHECK' && action === 'approve') {
    return { path: `/api/inventory-checks/${id}`, options: { method: 'PATCH', body: { action: 'APPROVE' } } };
  }
  if (item.documentType === 'ACCOUNTING_VOUCHER') {
    return { path: `/api/accounting-vouchers/${id}/${action}`, options: { method: 'POST', ...(action === 'reject' ? { body: { rejectionReason: reason } } : {}) } };
  }
  throw new Error('该单据不支持此审批操作');
}

function ApprovalTabs({ activeTab, counts, onChange }) {
  return (
    <div className="mobile-approval-tabs" role="tablist" aria-label="审批分类">
      {APPROVAL_TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className={`mobile-approval-tabs__item ${activeTab === tab.key ? 'is-active' : ''}`}
          aria-selected={activeTab === tab.key}
          aria-disabled={tab.disabled ? 'true' : undefined}
          disabled={tab.disabled}
          onClick={() => !tab.disabled && onChange(tab.key)}
        >
          {tab.label}
          {!tab.disabled && Number.isFinite(counts?.[tab.key]) ? <span>{counts[tab.key]}</span> : null}
          {tab.disabled ? <small>暂未开放</small> : null}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ item }) {
  return <span className={`mobile-approval-status mobile-approval-status--${item.status.toLowerCase()}`}>{item.statusLabel}</span>;
}

export function ApprovalCard({ item, onSelect }) {
  return (
    <article className="mobile-approval-card" data-testid={`approval-card-${item.key}`}>
      <button type="button" className="mobile-approval-card__content" onClick={() => onSelect(item)}>
        <span className="mobile-approval-card__top">
          <span className="mobile-approval-card__type">{item.documentTypeLabel}</span>
          <StatusPill item={item} />
        </span>
        <strong className="mobile-approval-card__number">{item.documentNo}</strong>
        <span className="mobile-approval-card__summary">{item.summary || '无摘要'}</span>
        <span className="mobile-approval-card__meta">
          <span>{item.initiatorName}</span>
          <span>{dateTime(item.submittedAt || item.createdAt)}</span>
          {item.amountCents != null ? <b>{money(item.amountCents)}</b> : null}
        </span>
      </button>
    </article>
  );
}

export function ApprovalListState({ loading, error, items, onRetry, onSelect }) {
  if (loading) return <div className="mobile-approval-state" data-testid="approval-loading"><span className="spinner" />正在加载审批…</div>;
  if (error) return <div className="mobile-approval-state mobile-approval-state--error" data-testid="approval-error"><p>{error}</p><button type="button" className="secondary" onClick={onRetry}>重试</button></div>;
  if (!items.length) return <div className="mobile-approval-state" data-testid="approval-empty">当前没有符合条件的单据</div>;
  return <div className="mobile-approval-list">{items.map((item) => <ApprovalCard key={item.key} item={item} onSelect={onSelect} />)}</div>;
}

function ApprovalDetail({ item, busy, onBack, onAction }) {
  return (
    <section className="mobile-approval-detail" data-testid="approval-detail">
      <button type="button" className="mobile-approval-detail__back" onClick={onBack}>‹ 返回审批列表</button>
      <div className="mobile-approval-detail__heading">
        <div><span>{item.documentTypeLabel}</span><h2>{item.documentNo}</h2></div>
        <StatusPill item={item} />
      </div>
      <dl className="mobile-approval-detail__facts">
        <div><dt>发起人</dt><dd>{item.initiatorName}</dd></div>
        <div><dt>发起时间</dt><dd>{dateTime(item.submittedAt || item.createdAt)}</dd></div>
        {item.handlerName ? <div><dt>处理人</dt><dd>{item.handlerName}</dd></div> : null}
        {item.handledAt ? <div><dt>处理时间</dt><dd>{dateTime(item.handledAt)}</dd></div> : null}
        {item.amountCents != null ? <div><dt>单据金额</dt><dd className="amount">{money(item.amountCents)}</dd></div> : null}
        <div><dt>摘要</dt><dd>{item.summary || '—'}</dd></div>
        {item.remark ? <div><dt>备注</dt><dd>{item.remark}</dd></div> : null}
        {item.rejectionReason ? <div className="rejection"><dt>驳回原因</dt><dd>{item.rejectionReason}</dd></div> : null}
      </dl>
      {item.lines?.length ? (
        <div className="mobile-approval-detail__lines">
          <h3>明细摘要 <small>{item.itemCount} 项</small></h3>
          {item.lines.map((line, index) => (
            <div className="mobile-approval-line" key={`${line.productName || line.subjectName}-${index}`}>
              <span>{line.productName || line.subjectName}</span>
              <small>{line.summary || (line.quantity != null ? `${line.quantity} ${line.unit}` : line.direction === 'DEBIT' ? '借方' : '贷方')}</small>
              {line.amountCents != null ? <b>{money(line.amountCents)}</b> : null}
            </div>
          ))}
          {item.itemCount > item.lines.length ? <small className="mobile-approval-detail__more">仅展示前 {item.lines.length} 项</small> : null}
        </div>
      ) : null}
      {(item.canApprove || item.canReject) ? (
        <div className="mobile-approval-detail__actions">
          {item.canReject ? <button type="button" className="secondary danger-text" disabled={busy} onClick={() => onAction(item, 'reject')}>驳回</button> : null}
          <button type="button" className="primary" disabled={busy} onClick={() => onAction(item, 'approve')}>{busy ? '处理中…' : '审批通过'}</button>
        </div>
      ) : null}
    </section>
  );
}

function ActionDialog({ action, busy, reason, setReason, onCancel, onConfirm }) {
  const rejecting = action === 'reject';
  return (
    <div className="mobile-approval-dialog-backdrop" role="presentation">
      <div className="mobile-approval-dialog" role="dialog" aria-modal="true" aria-label={rejecting ? '驳回审批' : '确认审批'}>
        <h3>{rejecting ? '驳回此单据？' : '确认审批通过？'}</h3>
        <p>{rejecting ? '请填写驳回原因，提交后将返回发起人。' : '该操作将使用单据现有审批流程。'}</p>
        {rejecting ? <textarea autoFocus maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="输入驳回原因" /> : null}
        <div><button type="button" className="secondary" disabled={busy} onClick={onCancel}>取消</button><button type="button" className={rejecting ? 'danger-button' : 'primary'} disabled={busy || (rejecting && !reason.trim())} onClick={onConfirm}>{busy ? '提交中…' : '确认'}</button></div>
      </div>
    </div>
  );
}

export default function MobileApprovalCenter({ notify, onPendingCountChange }) {
  const [activeTab, setActiveTab] = useState('pending');
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async (tab = activeTab) => {
    setLoading(true); setError('');
    try {
      const data = await api(`/api/approvals?tab=${tab}`);
      setItems(data.items || []); setCounts(data.counts || {});
      onPendingCountChange?.(data.counts?.pending || 0);
    } catch (requestError) {
      setError(requestError.message || '审批列表加载失败');
    } finally { setLoading(false); }
  }, [activeTab, onPendingCountChange]);

  useEffect(() => { load(activeTab); }, [activeTab, load]);

  function changeTab(tab) { setSelected(null); setActiveTab(tab); }
  function requestAction(item, action) { setSelected(item); setReason(''); setDialog({ item, action }); }

  async function confirmAction() {
    if (!dialog || busy) return;
    setBusy(true);
    try {
      const request = approvalActionRequest(dialog.item, dialog.action, reason.trim());
      await api(request.path, request.options);
      notify?.(dialog.action === 'approve' ? '审批已通过' : '单据已驳回');
      setDialog(null); setSelected(null); setReason('');
      await load(activeTab);
    } catch (requestError) {
      notify?.(requestError.message || '审批操作失败', 'error');
    } finally { setBusy(false); }
  }

  if (selected) return <><ApprovalDetail item={selected} busy={busy} onBack={() => setSelected(null)} onAction={requestAction} />{dialog ? <ActionDialog action={dialog.action} busy={busy} reason={reason} setReason={setReason} onCancel={() => !busy && setDialog(null)} onConfirm={confirmAction} /> : null}</>;

  return (
    <section className="mobile-approval-center" data-testid="mobile-approval-center">
      <ApprovalTabs activeTab={activeTab} counts={counts} onChange={changeTab} />
      <ApprovalListState loading={loading} error={error} items={items} onRetry={() => load(activeTab)} onSelect={setSelected} />
    </section>
  );
}

export { ApprovalDetail, ApprovalTabs };
