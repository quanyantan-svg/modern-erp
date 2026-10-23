import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);
const idempotencyKey = (scope) => `${scope}:${Date.now()}:${crypto.randomUUID()}`;

// Visibility only. The backend is the authority for every Credit capability
// (document.md §14 AP1-AP4.1, §15 AP5); hiding a control here never grants one.
const can = (user, permission) => Boolean(user?.permissions?.includes(permission));
const canRead = (user) => can(user, 'CREDIT_VIEW');
const canManage = (user) => can(user, 'CREDIT_MANAGE') && can(user, 'SALES_CROSS_GROUP');

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

async function post(path, body, scope) {
  return api(path, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey(scope) }, body });
}

function Feedback({ value }) {
  if (!value) return null;
  return <div role="status" className={`flash flash-${value.type}`}>{value.message}</div>;
}

function ReadOnlyNotice() {
  return <p className="muted">当前账号只有查看权限。信用档案、信用参数与信用检查规则的版本维护需要集中管理权限。</p>;
}

function CreateForm({ children, onSave, saving, label }) {
  return <>
    <div className="form-row">{children}</div>
    <button type="button" className="primary" onClick={onSave} disabled={saving}>{label}</button>
  </>;
}

function Parameters({ user }) {
  const manageable = canManage(user);
  const data = useCollection('/api/credit/policy/parameters', 'parameters', canRead(user));
  const [form, setForm] = useState({ code: 'CREDIT_MANAGEMENT_ENABLED', valueBool: false, effectiveFrom: today(), status: 'ACTIVE' });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await post('/api/credit/policy/parameters', form, 'credit-parameter'); setFeedback({ type: 'ok', message: '信用参数版本已保存' }); await data.reload(); }
    catch (error) { setFeedback({ type: 'error', message: error.message || String(error) }); }
    finally { setSaving(false); }
  };
  return <section className="card" aria-label="credit-parameters">
    <h2>信用参数</h2><p className="muted">参数按业务日期保存版本；新版本不会覆盖历史值。布尔值 false 是显式停用，不等于缺失配置。</p>
    {manageable ? <CreateForm onSave={save} saving={saving} label="新增版本">
      <label><span>参数代码</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
      <label><span>布尔值</span><select value={String(form.valueBool)} onChange={(e) => setForm({ ...form, valueBool: e.target.value === 'true' })}><option value="false">否</option><option value="true">是</option></select></label>
      <label><span>生效日期</span><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
    </CreateForm> : <ReadOnlyNotice />}
    <Feedback value={feedback} />
    {data.error && <div className="flash flash-error">{data.error}</div>}{data.loading ? <p>加载中…</p> : <div className="detail-grid">{data.rows.map((row) => <article className="mini-card" key={row.id}><strong>{row.code}</strong><div>{row.valueBool == null ? (row.valueText ?? row.valueInt ?? row.valueDate) : (row.valueBool ? '是' : '否')}</div><small>{row.effectiveFrom} → {row.effectiveTo || '长期'} · {row.status}</small></article>)}</div>}
  </section>;
}

function Rules({ user }) {
  const manageable = canManage(user);
  const data = useCollection('/api/credit/policy/rules', 'rules', canRead(user));
  const [form, setForm] = useState({ ruleCode: '', businessStage: 'SO_SUBMIT', scenario: 'STANDARD', checkTiming: 'BEFORE_WRITE', controlStrength: 'BLOCK', creditItem: 'CREDIT_LIMIT', effectiveFrom: today(), status: 'ACTIVE', resultPayload: {} });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await post('/api/credit/policy/rules', form, 'credit-rule'); setFeedback({ type: 'ok', message: '信用规则版本已保存' }); await data.reload(); }
    catch (error) { setFeedback({ type: 'error', message: error.message || String(error) }); }
    finally { setSaving(false); }
  };
  return <section className="card" aria-label="credit-rules"><h2>信用检查规则</h2><p className="muted">Wave 9 仅配置规则，不会启用销售订单或出货信用阻断。</p>
    {manageable ? <CreateForm onSave={save} saving={saving} label="新增规则版本">
      <label><span>规则代码</span><input value={form.ruleCode} onChange={(e) => setForm({ ...form, ruleCode: e.target.value })} placeholder="STANDARD_BLOCK" /></label>
      <label><span>业务阶段</span><select value={form.businessStage} onChange={(e) => setForm({ ...form, businessStage: e.target.value })}><option>SO_SUBMIT</option><option>SO_APPROVE</option><option>SALES_DELIVERY_CONFIRM</option></select></label>
      <label><span>控制强度</span><select value={form.controlStrength} onChange={(e) => setForm({ ...form, controlStrength: e.target.value })}><option>BLOCK</option><option>WARNING</option></select></label>
      <label><span>生效日期</span><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
    </CreateForm> : <ReadOnlyNotice />}
    <Feedback value={feedback} />{data.error && <div className="flash flash-error">{data.error}</div>}
    <div className="detail-grid">{data.rows.map((row) => <article className="mini-card" key={row.id}><strong>{row.ruleCode}</strong><div>{row.businessStage} · {row.controlStrength}</div><small>{row.effectiveFrom} → {row.effectiveTo || '长期'} · {row.status}</small></article>)}</div>
  </section>;
}

function Profiles({ user }) {
  const manageable = canManage(user);
  const readable = canRead(user);
  const data = useCollection('/api/credit/profiles', 'profiles', readable);
  const [form, setForm] = useState({ customerId: '', salespersonId: '', creditObjectType: 'CUSTOMER', creditObjectId: '', creditLimitCents: '', initialState: 'NORMAL', status: 'ACTIVE', ratingGrade: 'A', overdueDayPolicy: '0', effectiveFrom: today() });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const body = { ...form, salespersonId: form.salespersonId || null, creditLimitCents: form.creditLimitCents === '' ? null : Number(form.creditLimitCents) };
    try { await post('/api/credit/profiles', body, 'credit-profile'); setFeedback({ type: 'ok', message: '信用档案版本与初始评级已保存' }); await data.reload(); }
    catch (error) { setFeedback({ type: 'error', message: error.message || String(error) }); }
    finally { setSaving(false); }
  };
  return <section className="card" aria-label="credit-profiles"><h2>信用档案</h2><p className="muted">销售员留空表示客户总额度；填写销售员表示该销售员子额度。两者同时适用时必须同时满足。销售员子额度只对本人可见。</p>
    {manageable ? <CreateForm onSave={save} saving={saving} label="新增档案版本">
      <label><span>客户 ID</span><input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} /></label>
      <label><span>销售员 ID（可选）</span><input value={form.salespersonId} onChange={(e) => setForm({ ...form, salespersonId: e.target.value })} /></label>
      <label><span>信用对象 ID</span><input value={form.creditObjectId} onChange={(e) => setForm({ ...form, creditObjectId: e.target.value })} /></label>
      <label><span>信用额度（分，留空不设上限）</span><input type="number" min="0" value={form.creditLimitCents} onChange={(e) => setForm({ ...form, creditLimitCents: e.target.value })} /></label>
      <label><span>初始评级</span><input value={form.ratingGrade} onChange={(e) => setForm({ ...form, ratingGrade: e.target.value })} /></label>
      <label><span>逾期天数策略</span><input value={form.overdueDayPolicy} onChange={(e) => setForm({ ...form, overdueDayPolicy: e.target.value })} /></label>
      <label><span>生效日期</span><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
    </CreateForm> : <ReadOnlyNotice />}
    <Feedback value={feedback} />
    {data.error && <div className="flash flash-error">{data.error}</div>}{data.loading ? <p>加载中…</p> : <div className="detail-grid">{data.rows.map((row) => <article className="mini-card" key={row.id}><strong>{row.scopeType === 'CUSTOMER_AGGREGATE' ? '客户总额度' : '销售员子额度'}</strong><div>{row.customerId}{row.salespersonId ? ` / ${row.salespersonId}` : ''}</div><div>{row.unlimited ? '不设上限' : `${row.creditLimitCents} 分`} · 评级 {row.ratingGrade}</div><small>{row.effectiveFrom} → {row.effectiveTo || '长期'} · {row.status}</small></article>)}</div>}
  </section>;
}

export default function CreditFoundation({ user }) {
  const [tab, setTab] = useState('profiles');
  const readable = canRead(user);
  return <main className="page-stack"><header className="page-header"><div><p className="eyebrow">Sales & Customer · Wave 9</p><h1>信用管理基础</h1><p>维护信用参数、检查规则与有效期信用档案。当前阶段不会对销售订单或出货执行信用拦截。</p></div></header>
    {readable ? <>
      <nav className="segmented" aria-label="信用管理基础导航">{[['profiles','信用档案'],['parameters','信用参数'],['rules','检查规则']].map(([key,label]) => <button type="button" key={key} onClick={() => setTab(key)} className={tab === key ? 'active' : ''}>{label}</button>)}</nav>
      {tab === 'profiles' && <Profiles user={user} />}{tab === 'parameters' && <Parameters user={user} />}{tab === 'rules' && <Rules user={user} />}
    </> : <section className="card" aria-label="credit-denied"><div className="flash flash-error" role="alert">当前账号没有查看信用管理的权限。</div></section>}
  </main>;
}