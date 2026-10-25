import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);
const idempotencyKey = (scope) => `${scope}:${Date.now()}:${crypto.randomUUID()}`;

// Visibility only. The backend is the authority for every Credit capability
// (document.md §14 AP1-AP4.1, §15 AP5); hiding a control here never grants one.
const can = (user, permission) => Boolean(user?.permissions?.includes(permission));
const canRead = (user) => can(user, 'CREDIT_VIEW');
const canEvaluate = (user) => can(user, 'CREDIT_EVALUATE');
const canRequestApproval = (user) => can(user, 'CREDIT_SPECIAL_APPROVE');
const canDecideApproval = (user) => can(user, 'CREDIT_MANAGE');

const DECISION_LABELS = {
  PASS: '通过',
  WARNING: '预警',
  BLOCK: '阻断',
  SPECIAL_APPROVAL_REQUIRED: '需要特别审批',
};
const SCOPE_LABELS = {
  CUSTOMER_AGGREGATE: '客户总额度',
  SALESPERSON_SUB_LIMIT: '销售员子额度',
};
const STAGE_LABELS = {
  SO_SUBMIT: '销售订单提交',
  SO_APPROVE: '销售订单审批',
  SALES_DELIVERY_CONFIRM: '销售出库确认',
};

function useCollection(path, field, enabled) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const reload = useCallback(async () => {
    if (!enabled) { setRows([]); setError(''); setLoading(false); return; }
    setLoading(true); setError('');
    // Drop the previous result first so a denied or failed reload can never
    // leave rows the actor is no longer authorized to see on screen.
    setRows([]);
    try { setRows((await api(path))[field] || []); } catch (value) { setError(value.message || String(value)); }
    finally { setLoading(false); }
  }, [enabled, field, path]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, error, loading, reload };
}

function Feedback({ value }) {
  if (!value) return null;
  return <div role="status" className={`flash flash-${value.type}`}>{value.message}</div>;
}

function ScopeCard({ result }) {
  const breakdown = result.componentBreakdown || {};
  return <article className="mini-card" aria-label={`credit-scope-${result.scopeType}`}>
    <strong>{SCOPE_LABELS[result.scopeType] || result.scopeType}</strong>
    <div>{DECISION_LABELS[result.decision] || result.decision}</div>
    <div>已用 {result.exposureCents} 分 · 可用 {result.availableCents == null ? '不设上限' : `${result.availableCents} 分`}</div>
    <div>本次合计 {result.proposedTotalCents} 分</div>
    <small>{(result.reasonCodes || []).join(' / ') || '无附加原因'}</small>
    {breakdown.consumedSpecialApprovalId ? <small>已使用特别审批 {breakdown.consumedSpecialApprovalId}</small> : null}
  </article>;
}

export function CreditCheck({ user }) {
  const readable = canRead(user);
  const evaluable = canEvaluate(user);
  const [form, setForm] = useState({
    customerId: '', salespersonId: '', stage: 'SO_SUBMIT', businessDate: today(),
    proposedDeltaCents: 0, salesOrderId: '', salesDeliveryId: '',
  });
  const [outcome, setOutcome] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const results = useCollection('/api/credit/check-results', 'results', readable);

  const evaluate = async () => {
    setBusy(true); setOutcome(null); setFeedback(null);
    const body = {
      customerId: form.customerId,
      salespersonId: form.salespersonId || null,
      stage: form.stage,
      businessDate: form.businessDate,
      proposedDeltaCents: Number(form.proposedDeltaCents || 0),
      salesOrderId: form.salesOrderId || null,
      salesDeliveryId: form.salesDeliveryId || null,
    };
    try {
      const result = await api('/api/credit/check', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey('credit-check') }, body });
      setOutcome(result);
      setFeedback({ type: 'ok', message: `信用检查完成：${DECISION_LABELS[result.decision] || result.decision}` });
      await results.reload();
    } catch (error) {
      setOutcome(error?.details ? { decision: error.details.decision, scopeResults: error.details.scopeResults || [], reasonCodes: error.details.reasonCodes || [] } : null);
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setBusy(false); }
  };

  return <main className="page-stack">
    <header className="page-header"><div>
      <p className="eyebrow">Sales & Customer · Wave 10</p>
      <h1>信用检查</h1>
      <p>按销售订单提交、审批与出货确认三个阶段执行信用检查。敞口由销售与财务的权威事实派生，不存在第二套信用余额。</p>
    </div></header>
    {!readable ? <section className="card" aria-label="credit-check-denied"><div className="flash flash-error" role="alert">当前账号没有查看信用检查的权限。</div></section> : <>
      <section className="card" aria-label="credit-check-evaluate">
        <h2>执行信用检查</h2>
        {evaluable ? <>
          <div className="form-row">
            <label><span>客户 ID</span><input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} /></label>
            <label><span>销售员 ID（可选）</span><input value={form.salespersonId} onChange={(e) => setForm({ ...form, salespersonId: e.target.value })} /></label>
            <label><span>业务阶段</span><select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}><option value="SO_SUBMIT">销售订单提交</option><option value="SO_APPROVE">销售订单审批</option><option value="SALES_DELIVERY_CONFIRM">销售出库确认</option></select></label>
            <label><span>业务日期</span><input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></label>
            <label><span>本次敞口增量（分）</span><input type="number" value={form.proposedDeltaCents} onChange={(e) => setForm({ ...form, proposedDeltaCents: e.target.value })} /></label>
            <label><span>销售订单 ID</span><input value={form.salesOrderId} onChange={(e) => setForm({ ...form, salesOrderId: e.target.value })} /></label>
            <label><span>销售出库 ID</span><input value={form.salesDeliveryId} onChange={(e) => setForm({ ...form, salesDeliveryId: e.target.value })} /></label>
          </div>
          <button type="button" className="primary" onClick={evaluate} disabled={busy || !form.customerId || (!form.salesOrderId && !form.salesDeliveryId)}>执行检查</button>
        </> : <p className="muted">当前账号只有查看权限。执行信用检查需要独立的信用评估权限。</p>}
        <Feedback value={feedback} />
        {outcome ? <div className="detail-grid">{(outcome.scopeResults || []).map((result) => <ScopeCard key={result.scopeType} result={result} />)}</div> : null}
      </section>
      <section className="card" aria-label="credit-check-history">
        <h2>检查结果</h2>
        {results.error && <div className="flash flash-error">{results.error}</div>}
        {results.loading ? <p>加载中…</p> : <div className="detail-grid">{results.rows.map((row) => <article className="mini-card" key={row.id}>
          <strong>{DECISION_LABELS[row.decision] || row.decision}</strong>
          <div>{SCOPE_LABELS[row.scopeType] || row.scopeType} · {STAGE_LABELS[row.stage] || row.stage}</div>
          <div>{row.businessDate} · 敞口 {row.componentBreakdown?.exposureCents ?? '—'} 分</div>
          <small>{(row.reasonCodes || []).join(' / ') || '无附加原因'}</small>
        </article>)}</div>}
      </section>
    </>}
  </main>;
}

export function CreditSpecialApprovals({ user }) {
  const readable = canRead(user);
  const requestable = canRequestApproval(user);
  const decidable = canDecideApproval(user);
  const [form, setForm] = useState({
    sourceCreditCheckResultId: '', reason: '', requestedOverrideCents: 0,
    requestedCeilingCents: 0, requestedExpiryBusinessDate: today(), scopeMode: 'ONE_TIME',
  });
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const approvals = useCollection('/api/credit/special-approvals', 'approvals', readable);

  const submitRequest = async () => {
    setBusy(true); setFeedback(null);
    const body = {
      sourceCreditCheckResultId: form.sourceCreditCheckResultId,
      reason: form.reason,
      requestedOverrideCents: Number(form.requestedOverrideCents || 0),
      requestedCeilingCents: Number(form.requestedCeilingCents || 0),
      requestedExpiryBusinessDate: form.requestedExpiryBusinessDate,
      scopeMode: form.scopeMode,
    };
    try {
      await api('/api/credit/special-approvals', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey('credit-special-approval') }, body });
      setFeedback({ type: 'ok', message: '特别审批申请已提交' });
      await approvals.reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setBusy(false); }
  };

  const decide = async (approval, decision) => {
    setFeedback(null);
    try {
      await api(`/api/credit/special-approvals/${approval.id}/decide`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey(`credit-special-approval-${approval.id}-${decision}`) },
        body: { decision },
      });
      setFeedback({ type: 'ok', message: decision === 'APPROVED' ? '已批准' : '已拒绝' });
      await approvals.reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    }
  };

  return <main className="page-stack">
    <header className="page-header"><div>
      <p className="eyebrow">Sales & Customer · Wave 10</p>
      <h1>信用特别审批</h1>
      <p>特别审批只对产生该结论的一个信用范围有效，并且受权限上限、失效业务日期与申请审批分离约束。</p>
    </div></header>
    {!readable ? <section className="card" aria-label="credit-special-approval-denied"><div className="flash flash-error" role="alert">当前账号没有查看信用特别审批的权限。</div></section> : <>
      <section className="card" aria-label="credit-special-approval-request">
        <h2>申请特别审批</h2>
        {requestable ? <>
          <div className="form-row">
            <label><span>信用检查结果 ID</span><input value={form.sourceCreditCheckResultId} onChange={(e) => setForm({ ...form, sourceCreditCheckResultId: e.target.value })} /></label>
            <label><span>申请原因</span><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            <label><span>申请覆盖金额（分）</span><input type="number" value={form.requestedOverrideCents} onChange={(e) => setForm({ ...form, requestedOverrideCents: e.target.value })} /></label>
            <label><span>申请额度上限（分）</span><input type="number" value={form.requestedCeilingCents} onChange={(e) => setForm({ ...form, requestedCeilingCents: e.target.value })} /></label>
            <label><span>申请失效业务日期</span><input type="date" value={form.requestedExpiryBusinessDate} onChange={(e) => setForm({ ...form, requestedExpiryBusinessDate: e.target.value })} /></label>
            <label><span>审批范围模式</span><select value={form.scopeMode} onChange={(e) => setForm({ ...form, scopeMode: e.target.value })}><option value="ONE_TIME">一次性</option><option value="TIME_BOUNDED">限期</option><option value="OBJECT_BOUNDED">限定单据</option></select></label>
          </div>
          <button type="button" className="primary" onClick={submitRequest} disabled={busy || !form.sourceCreditCheckResultId || !form.reason}>提交申请</button>
        </> : <p className="muted">当前账号只有查看权限。申请特别审批需要独立的信用特别审批权限。</p>}
        <Feedback value={feedback} />
      </section>
      <section className="card" aria-label="credit-special-approval-list">
        <h2>审批列表</h2>
        {approvals.error && <div className="flash flash-error">{approvals.error}</div>}
        {approvals.loading ? <p>加载中…</p> : <div className="detail-grid">{approvals.rows.map((row) => <article className="mini-card" key={row.id}>
          <strong>{SCOPE_LABELS[row.scopeType] || row.scopeType}</strong>
          <div>{row.decision === 'PENDING' ? '待审批' : row.decision === 'APPROVED' ? '已批准' : '已拒绝'} · {row.scopeMode}</div>
          <div>权限上限 {row.authorityCeilingCents} 分 · 申请上限 {row.requestedCeilingCents} 分</div>
          <small>失效业务日期 {row.requestedExpiryBusinessDate}</small>
          {row.decision === 'PENDING' && decidable ? <div className="form-row">
            <button type="button" className="primary" onClick={() => decide(row, 'APPROVED')}>批准</button>
            <button type="button" onClick={() => decide(row, 'REJECTED')}>拒绝</button>
          </div> : null}
        </article>)}</div>}
      </section>
    </>}
  </main>;
}

export default CreditCheck;
