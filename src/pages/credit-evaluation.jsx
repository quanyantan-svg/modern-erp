import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

const today = () => new Date().toISOString().slice(0, 10);
const idempotencyKey = (scope) => `${scope}:${Date.now()}:${crypto.randomUUID()}`;

// Visibility only. The backend is the authority for every Credit capability
// (document.md §14 AP1-AP4.1, §15 AP5); hiding a control here never grants one.
//
// Design §37.54.9.5 / §37.54.10.6:
//   - CREDIT_VIEW reads the configuration and the sheets;
//   - CREDIT_EVALUATE creates a sheet, scores it and finalises it;
//   - the rating application needs the WRITE-CLASS credit management
//     authority (CREDIT_MANAGE + SALES_CROSS_GROUP), so CREDIT_EVALUATE
//     alone is deliberately NOT enough to apply a rating.
const can = (user, permission) => Boolean(user?.permissions?.includes(permission));
const canRead = (user) => can(user, 'CREDIT_VIEW');
const canEvaluate = (user) => can(user, 'CREDIT_EVALUATE');
const canManage = (user) => can(user, 'CREDIT_MANAGE') && can(user, 'SALES_CROSS_GROUP');

const STATUS_LABELS = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  FINALIZED: '已终评',
  APPLIED: '已应用',
};
const KIND_LABELS = {
  QUALITATIVE: '定性',
  QUANTITATIVE: '定量',
};

// A milli-point is 1/1000 of a point. The whole scoring path is integer
// arithmetic, so the UI only ever displays integers too.
const milli = (value) => (value == null ? '—' : `${value}`);
const points = (value) => (value == null ? '—' : `${(value / 1000).toFixed(3)}`);

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

function EmptyState({ label, hint }) {
  return <div className="mini-card" aria-label={`empty-${label}`}>
    <strong>{label}</strong>
    <small>{hint}</small>
  </div>;
}

// ---------------------------------------------------------------------------
// The indicator catalogue — the model references indicators BY ROW ID, so the
// catalogue is what the operator picks from when a model version is created.
// ---------------------------------------------------------------------------
function Indicators({ user }) {
  const manageable = canManage(user);
  const data = useCollection('/api/credit/evaluation/indicators', 'indicators', canRead(user));
  const [form, setForm] = useState({
    code: '', name: '', indicatorKind: 'QUALITATIVE', description: '', maxScoreMilli: 100000,
    inputSpec: { kind: 'QUALITATIVE', options: [{ value: 'GOOD', scoreMilli: 100000 }] },
    effectiveFrom: today(),
  });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  const setKind = (kind) => setForm((previous) => ({
    ...previous,
    indicatorKind: kind,
    inputSpec: kind === 'QUALITATIVE'
      ? { kind: 'QUALITATIVE', options: previous.inputSpec?.options || [{ value: 'GOOD', scoreMilli: 100000 }] }
      : { kind: 'QUANTITATIVE', bands: previous.inputSpec?.bands || [{ min: 0, max: 100000, scoreMilli: 100000 }] },
  }));

  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await post('/api/credit/evaluation/indicators', form, 'credit-evaluation-indicator');
      setFeedback({ type: 'ok', message: '指标版本已保存' });
      await data.reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setSaving(false); }
  };

  return <section className="card" aria-label="credit-evaluation-indicators">
    <h2>评估指标</h2>
    <p className="muted">指标按生效日期保存版本。指标一旦被模型引用就不能就地改写，只能新增版本。</p>
    {manageable ? <>
      <div className="form-row">
        <label><span>指标代码</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="IND_A" /></label>
        <label><span>指标名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label><span>指标类型</span><select value={form.indicatorKind} onChange={(e) => setKind(e.target.value)}><option value="QUALITATIVE">定性</option><option value="QUANTITATIVE">定量</option></select></label>
        <label><span>最大分值（milli）</span><input type="number" value={form.maxScoreMilli} onChange={(e) => setForm({ ...form, maxScoreMilli: Number(e.target.value) })} /></label>
        <label><span>说明</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label><span>生效日期</span><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
      </div>
      <button type="button" className="primary" onClick={save} disabled={saving || !form.code || !form.name}>新增指标版本</button>
    </> : <p className="muted">当前账号只有查看权限。指标版本维护需要集中管理权限。</p>}
    <Feedback value={feedback} />
    {data.error && <div className="flash flash-error">{data.error}</div>}
    {data.loading ? <p>加载中…</p> : data.rows.length === 0
      ? <EmptyState label="暂无指标" hint="新增一个指标版本后，模型才能引用它。" />
      : <div className="detail-grid">{data.rows.map((row) => <article className="mini-card" key={row.id}>
        <strong>{row.name || row.code}</strong>
        <div>{row.code} · {KIND_LABELS[row.indicatorKind] || row.indicatorKind}</div>
        <div>满分 {milli(row.maxScoreMilli)} milli</div>
        <small>{row.effectiveFrom} → {row.effectiveTo || '长期'} · {row.status}</small>
      </article>)}</div>}
  </section>;
}

// ---------------------------------------------------------------------------
// The grade scheme — the bands must tile [0, maxTotalMilli] with no gap and
// no overlap. The tiling against the model's full score is proven by the
// backend when the model version is created.
// ---------------------------------------------------------------------------
function Schemes({ user }) {
  const manageable = canManage(user);
  const data = useCollection('/api/credit/evaluation/schemes', 'schemes', canRead(user));
  const [form, setForm] = useState({
    code: '', name: '', effectiveFrom: today(),
    gradeBoundaries: [{ grade: 'A', minScoreMilli: 0, maxScoreMilli: 40000 }],
  });
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  const setBand = (index, patch) => setForm((previous) => ({
    ...previous,
    gradeBoundaries: previous.gradeBoundaries.map((band, position) => (position === index ? { ...band, ...patch } : band)),
  }));

  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await post('/api/credit/evaluation/schemes', form, 'credit-evaluation-scheme');
      setFeedback({ type: 'ok', message: '等级方案版本已保存' });
      await data.reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setSaving(false); }
  };

  return <section className="card" aria-label="credit-evaluation-schemes">
    <h2>等级方案</h2>
    <p className="muted">等级区间必须连续覆盖且互不重叠；等级边界随版本不可变。</p>
    {manageable ? <>
      <div className="form-row">
        <label><span>方案代码</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SCHEME_ABC" /></label>
        <label><span>方案名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label><span>生效日期</span><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
      </div>
      {form.gradeBoundaries.map((band, index) => <div className="form-row" key={`band-${index}`}>
        <label><span>等级</span><input value={band.grade} onChange={(e) => setBand(index, { grade: e.target.value })} /></label>
        <label><span>区间下限（milli）</span><input type="number" value={band.minScoreMilli} onChange={(e) => setBand(index, { minScoreMilli: Number(e.target.value) })} /></label>
        <label><span>区间上限（milli）</span><input type="number" value={band.maxScoreMilli} onChange={(e) => setBand(index, { maxScoreMilli: Number(e.target.value) })} /></label>
      </div>)}
      <div className="form-row">
        <button type="button" onClick={() => setForm((previous) => ({
          ...previous,
          gradeBoundaries: [...previous.gradeBoundaries, {
            grade: '', minScoreMilli: 0, maxScoreMilli: 0,
          }],
        }))}>增加等级区间</button>
        <button type="button" className="primary" onClick={save} disabled={saving || !form.code || !form.name}>新增方案版本</button>
      </div>
    </> : <p className="muted">当前账号只有查看权限。等级方案版本维护需要集中管理权限。</p>}
    <Feedback value={feedback} />
    {data.error && <div className="flash flash-error">{data.error}</div>}
    {data.loading ? <p>加载中…</p> : data.rows.length === 0
      ? <EmptyState label="暂无等级方案" hint="新增一个方案版本后，模型才能绑定它。" />
      : <div className="detail-grid">{data.rows.map((row) => <article className="mini-card" key={row.id}>
        <strong>{row.name || row.code}</strong>
        <div>{(row.gradeBoundaries || []).map((band) => `${band.grade}: ${band.minScoreMilli}-${band.maxScoreMilli}`).join(' / ') || '未配置区间'}</div>
        <small>{row.effectiveFrom} → {row.effectiveTo || '长期'} · {row.status}</small>
      </article>)}</div>}
  </section>;
}

// ---------------------------------------------------------------------------
// The model — the weights are integer milli-weights that must sum to exactly
// 10000 (100 %). The model references indicators BY ROW ID.
// ---------------------------------------------------------------------------
function Models({ user }) {
  const manageable = canManage(user);
  const models = useCollection('/api/credit/evaluation/models', 'models', canRead(user));
  const indicators = useCollection('/api/credit/evaluation/indicators', 'indicators', canRead(user));
  const schemes = useCollection('/api/credit/evaluation/schemes', 'schemes', canRead(user));
  const [form, setForm] = useState({ code: '', name: '', schemeId: '', effectiveFrom: today() });
  const [weights, setWeights] = useState({});
  const [feedback, setFeedback] = useState(null);
  const [saving, setSaving] = useState(false);

  // The weight total is shown live so the operator can see the 10000 target
  // before the backend refuses the version.
  const weightTotal = useMemo(
    () => Object.values(weights).reduce((total, value) => total + (Number(value) || 0), 0),
    [weights],
  );

  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      await post('/api/credit/evaluation/models', {
        ...form,
        indicatorWeights: weights,
      }, 'credit-evaluation-model');
      setFeedback({ type: 'ok', message: '评分模型版本已保存' });
      await models.reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setSaving(false); }
  };

  return <section className="card" aria-label="credit-evaluation-models">
    <h2>评分模型</h2>
    <p className="muted">模型绑定一个等级方案并引用指标行。权重合计必须正好等于 10000（100%），不会自动归一。</p>
    {manageable ? <>
      <div className="form-row">
        <label><span>模型代码</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MODEL_1" /></label>
        <label><span>模型名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label><span>等级方案</span><select value={form.schemeId} onChange={(e) => setForm({ ...form, schemeId: e.target.value })}>
          <option value="">请选择</option>
          {schemes.rows.map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}
        </select></label>
        <label><span>生效日期</span><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></label>
      </div>
      {indicators.rows.map((indicator) => <div className="form-row" key={indicator.id}>
        <label><span>{indicator.name || indicator.code} 权重（milli）</span><input type="number" value={weights[indicator.id] ?? ''} onChange={(e) => setWeights({ ...weights, [indicator.id]: Number(e.target.value) })} /></label>
      </div>)}
      <p className="muted">权重合计 {weightTotal} / 10000</p>
      <button type="button" className="primary" onClick={save} disabled={saving || !form.code || !form.name || !form.schemeId}>新增模型版本</button>
    </> : <p className="muted">当前账号只有查看权限。模型版本维护需要集中管理权限。</p>}
    <Feedback value={feedback} />
    {models.error && <div className="flash flash-error">{models.error}</div>}
    {models.loading ? <p>加载中…</p> : models.rows.length === 0
      ? <EmptyState label="暂无评分模型" hint="新增一个模型版本后，评分表才能绑定它。" />
      : <div className="detail-grid">{models.rows.map((row) => <article className="mini-card" key={row.id}>
        <strong>{row.name || row.code}</strong>
        <div>权重 {Object.values(row.indicatorWeights || {}).reduce((total, value) => total + Number(value), 0)} / 10000</div>
        <small>{row.effectiveFrom} → {row.effectiveTo || '长期'} · {row.status}</small>
      </article>)}</div>}
  </section>;
}

// ---------------------------------------------------------------------------
// The sheet detail — the scoring editor.
//
// The scoring form carries NO target parameter: the target is bound on the
// sheet itself, so a scorer can never re-target another customer.
// ---------------------------------------------------------------------------
function SheetDetail({ user, sheetId, onChanged, onClose }) {
  const readable = canRead(user);
  const evaluable = canEvaluate(user);
  const manageable = canManage(user);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inputs, setInputs] = useState({});
  // The indicator catalogue is only used to label the scoring inputs. The
  // authoritative indicator resolution happens on the backend.
  const catalogue = useCollection('/api/credit/evaluation/indicators', 'indicators', readable);
  const indicatorCatalogue = useMemo(
    () => Object.fromEntries(catalogue.rows.map((row) => [row.id, row])),
    [catalogue.rows],
  );

  const reload = useCallback(async () => {
    if (!readable) return;
    setError('');
    try { setDetail(await api(`/api/credit/evaluation/sheets/${sheetId}`)); }
    catch (value) { setError(value.message || String(value)); setDetail(null); }
  }, [readable, sheetId]);

  useEffect(() => { reload(); }, [reload]);

  const sheet = detail?.sheet;
  const model = detail?.model;
  const result = detail?.result;

  // The indicator set of the sheet's model, resolved from the model weights.
  const indicators = useMemo(() => {
    const weights = model?.indicatorWeights || {};
    return Object.entries(weights).map(([indicatorId, weight]) => ({ indicatorId, weightMilli: Number(weight) }));
  }, [model]);

  const isAllowedScorer = Boolean(sheet?.allowedEvaluatorIds?.includes(user?.id));
  const alreadySubmitted = Boolean(sheet?.sheetData?.evaluators?.some((entry) => entry.evaluatorId === user?.id));
  const editable = evaluable && isAllowedScorer && sheet?.status === 'DRAFT' && !alreadySubmitted;

  const submitScore = async () => {
    setBusy(true); setFeedback(null);
    try {
      const entries = indicators
        .filter((entry) => inputs[entry.indicatorId] !== undefined && inputs[entry.indicatorId] !== '')
        .map((entry) => ({ indicatorId: entry.indicatorId, inputValue: inputs[entry.indicatorId] }));
      await post(`/api/credit/evaluation/sheets/${sheetId}/score`, { entries }, `credit-evaluation-score-${sheetId}`);
      setFeedback({ type: 'ok', message: '评分已提交' });
      setInputs({});
      await reload();
      onChanged?.();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    setBusy(true); setFeedback(null);
    try {
      await post(`/api/credit/evaluation/sheets/${sheetId}/finalize`, {}, `credit-evaluation-finalize-${sheetId}`);
      setFeedback({ type: 'ok', message: '评分表已终评并生成评估结果' });
      await reload();
      onChanged?.();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setBusy(false); }
  };

  const apply = async () => {
    setBusy(true); setFeedback(null);
    try {
      await post(`/api/credit/evaluation/results/${result.id}/apply`, {}, `credit-evaluation-apply-${result.id}`);
      setFeedback({ type: 'ok', message: '评估结果已应用到信用档案版本' });
      await reload();
      onChanged?.();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setBusy(false); }
  };

  if (!readable) return <section className="card" aria-label="credit-evaluation-sheet-denied">
    <div className="flash flash-error" role="alert">当前账号没有查看评分表的权限。</div>
  </section>;
  if (error) return <section className="card" aria-label="credit-evaluation-sheet-error">
    <div className="flash flash-error" role="alert">{error}</div>
    <button type="button" onClick={onClose}>返回列表</button>
  </section>;
  if (!sheet) return <section className="card" aria-label="credit-evaluation-sheet-loading"><p>加载中…</p></section>;

  const submittedCount = (sheet.sheetData?.evaluators || []).length;
  const allowedCount = (sheet.allowedEvaluatorIds || []).length;

  return <section className="card" aria-label="credit-evaluation-sheet-detail">
    <h2>评分表 {sheet.sheetNo}</h2>
    <p className="muted">目标 {sheet.creditObjectType} / {sheet.creditObjectId} · 客户 {sheet.customerId} · 范围 {sheet.profileScopeKey} · 业务日期 {sheet.businessDate}</p>
    <div className="detail-grid">
      <div><span>状态</span><strong>{STATUS_LABELS[sheet.status] || sheet.status}</strong></div>
      <div><span>评分人</span><strong>{submittedCount} / {allowedCount}</strong></div>
      <div><span>档案版本</span><strong>{sheet.creditProfileId}</strong></div>
      <div><span>模型</span><strong>{model?.code || sheet.modelId}</strong></div>
    </div>
    <Feedback value={feedback} />

    {result ? <div className="detail-grid" aria-label="credit-evaluation-result">
      <div><span>总分</span><strong>{milli(result.totalScoreMilli)} milli（{points(result.totalScoreMilli)} 分）</strong></div>
      <div><span>满分</span><strong>{milli(result.maxScoreMilli)} milli（{points(result.maxScoreMilli)} 分）</strong></div>
      <div><span>等级</span><strong>{result.ratingGrade}</strong></div>
      <div><span>已应用</span><strong>{result.appliedToProfileId ? '是' : '否'}</strong></div>
    </div> : null}

    <h3>逐指标评分</h3>
    {indicators.length === 0 ? <EmptyState label="该模型没有指标" hint="模型必须至少引用一个指标。" /> : indicators.map((entry) => {
      const indicator = indicatorCatalogue[entry.indicatorId];
      return <div className="form-row" key={entry.indicatorId}>
        <label>
          <span>{indicator ? `${indicator.name || indicator.code}` : `指标 ${entry.indicatorId}`}（权重 {entry.weightMilli} / 10000）</span>
          <input
            value={inputs[entry.indicatorId] ?? ''}
            disabled={!editable}
            onChange={(e) => setInputs({ ...inputs, [entry.indicatorId]: e.target.value })}
          />
        </label>
      </div>;
    })}
    {editable ? <button type="button" className="primary" onClick={submitScore} disabled={busy}>提交我的评分</button>
      : <p className="muted">{alreadySubmitted ? '你已提交本轮评分，不可重复提交。' : `当前状态 ${STATUS_LABELS[sheet.status] || sheet.status} 下评分只读。`}</p>}

    {evaluable && sheet.status === 'DRAFT' ? <div className="form-row">
      <button type="button" onClick={finalize} disabled={busy || submittedCount < allowedCount}>
        终评并生成结果
      </button>
    </div> : null}
    {sheet.status === 'DRAFT' && submittedCount < allowedCount
      ? <p className="muted">还有 {allowedCount - submittedCount} 名评分人未提交，未全部提交前不能终评。</p>
      : null}

    {result && !result.appliedToProfileId ? (manageable
      ? <button type="button" className="primary" onClick={apply} disabled={busy}>应用评级到信用档案</button>
      : <p className="muted">应用评级需要集中管理权限（信用管理 + 跨组权限），评分权限不足以应用。</p>)
      : null}
    <div className="form-row"><button type="button" onClick={onClose}>返回列表</button></div>
  </section>;
}

// ---------------------------------------------------------------------------
// The sheet list — the LIST leg of LIST -> DETAIL -> EDITOR.
// ---------------------------------------------------------------------------
function Sheets({ user, onOpen }) {
  const readable = canRead(user);
  const evaluable = canEvaluate(user);
  const sheets = useCollection('/api/credit/evaluation/sheets', 'sheets', readable);
  const models = useCollection('/api/credit/evaluation/models', 'models', readable);
  const [form, setForm] = useState({
    modelId: '', creditObjectType: 'SALES_ORDER', creditObjectId: '', customerId: '',
    salespersonId: '', businessDate: today(), allowedEvaluatorIds: '',
  });
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true); setFeedback(null);
    try {
      const created = await post('/api/credit/evaluation/sheets', {
        ...form,
        salespersonId: form.salespersonId || null,
        allowedEvaluatorIds: form.allowedEvaluatorIds.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean),
      }, 'credit-evaluation-sheet');
      setFeedback({ type: 'ok', message: `评分表 ${created?.sheet?.sheetNo || ''} 已创建` });
      await sheets.reload();
    } catch (error) {
      setFeedback({ type: 'error', message: error.message || String(error) });
    } finally { setBusy(false); }
  };

  return <section className="card" aria-label="credit-evaluation-sheets">
    <h2>评分表</h2>
    <p className="muted">评分表在创建时固定客户、范围、业务日期与生效的信用档案版本，之后不可改靶。</p>
    {evaluable ? <>
      <div className="form-row">
        <label><span>评分模型</span><select value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })}>
          <option value="">请选择</option>
          {models.rows.map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}
        </select></label>
        <label><span>信用对象类型</span><input value={form.creditObjectType} onChange={(e) => setForm({ ...form, creditObjectType: e.target.value })} /></label>
        <label><span>信用对象</span><input value={form.creditObjectId} onChange={(e) => setForm({ ...form, creditObjectId: e.target.value })} /></label>
        <label><span>客户 ID</span><input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} /></label>
        <label><span>销售员 ID（可选）</span><input value={form.salespersonId} onChange={(e) => setForm({ ...form, salespersonId: e.target.value })} /></label>
        <label><span>业务日期</span><input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></label>
        <label><span>评分人 ID（逗号分隔）</span><input value={form.allowedEvaluatorIds} onChange={(e) => setForm({ ...form, allowedEvaluatorIds: e.target.value })} /></label>
      </div>
      <button type="button" className="primary" onClick={create} disabled={busy || !form.modelId || !form.customerId || !form.creditObjectId || !form.allowedEvaluatorIds}>创建评分表</button>
    </> : <p className="muted">当前账号只有查看权限。创建评分表需要信用评估权限。</p>}
    <Feedback value={feedback} />
    {sheets.error && <div className="flash flash-error">{sheets.error}</div>}
    {sheets.loading ? <p>加载中…</p> : sheets.rows.length === 0
      ? <EmptyState label="暂无评分表" hint="创建一张评分表后，评分人才能提交评分。" />
      : <div className="detail-grid">{sheets.rows.map((row) => <article className="mini-card" key={row.id}>
        <strong>{row.sheetNo}</strong>
        <div>{STATUS_LABELS[row.status] || row.status} · 评分人 {row.evaluatorCount} / {(row.allowedEvaluatorIds || []).length}</div>
        <div>{row.customerId} · {row.businessDate}</div>
        <small>{row.creditObjectType} / {row.creditObjectId}</small>
        <button type="button" onClick={() => onOpen(row.id)}>打开评分表</button>
      </article>)}</div>}
  </section>;
}

export function CreditEvaluation({ user }) {
  const readable = canRead(user);
  const [openSheetId, setOpenSheetId] = useState(null);
  const [tab, setTab] = useState('sheets');

  if (!readable) return <main className="page-stack" data-testid="credit-evaluation-page">
    <header className="page-header"><div>
      <p className="eyebrow">Sales & Customer · Wave 11</p>
      <h1>信用评估</h1>
    </div></header>
    <section className="card" aria-label="credit-evaluation-denied">
      <div className="flash flash-error" role="alert">当前账号没有查看信用评估的权限。</div>
    </section>
  </main>;

  return <main className="page-stack" data-testid="credit-evaluation-page">
    <header className="page-header"><div>
      <p className="eyebrow">Sales & Customer · Wave 11</p>
      <h1>信用评估</h1>
      <p>指标、等级方案与评分模型按生效日期版本化。评分表在创建时固定目标，由有界评分人集合逐人提交，终评后生成唯一聚合结果。</p>
    </div></header>
    {openSheetId ? <SheetDetail user={user} sheetId={openSheetId} onClose={() => setOpenSheetId(null)} />
      : <>
        <div className="segmented-control" role="tablist" aria-label="credit-evaluation-tabs">
          <button type="button" role="tab" aria-selected={tab === 'sheets'} className={tab === 'sheets' ? 'is-selected' : ''} onClick={() => setTab('sheets')}>评分表</button>
          <button type="button" role="tab" aria-selected={tab === 'models'} className={tab === 'models' ? 'is-selected' : ''} onClick={() => setTab('models')}>评分模型</button>
          <button type="button" role="tab" aria-selected={tab === 'config'} className={tab === 'config' ? 'is-selected' : ''} onClick={() => setTab('config')}>评估配置</button>
        </div>
        {tab === 'sheets' ? <Sheets user={user} onOpen={setOpenSheetId} /> : null}
        {tab === 'models' ? <Models user={user} /> : null}
        {tab === 'config' ? <>
          <Indicators user={user} />
          <Schemes user={user} />
        </> : null}
      </>}
  </main>;
}

export default CreditEvaluation;
