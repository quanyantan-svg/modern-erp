import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import {
  EmptyState,
  FilterButton,
  FilterSheet,
  FormRow,
  InlineAlert,
  PrimaryButton,
  SecondaryButton,
  SegmentedControl,
  Skeleton,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const STAGES = Object.freeze([
  ['SO_SUBMIT', '销售订单提交'],
  ['SO_APPROVE', '销售订单审批'],
  ['SALES_DELIVERY_CONFIRM', '销售出货确认'],
]);
const CATEGORIES = Object.freeze([
  ['OVER_LIMIT', '超额度'],
  ['OVERDUE', '逾期'],
  ['WARNING', '警告'],
  ['BLOCK', '阻断'],
  ['SPECIAL_APPROVAL', '特别审批'],
]);
const DECISIONS = Object.freeze([
  ['PASS', '通过'],
  ['WARNING', '警告'],
  ['BLOCK', '阻断'],
  ['SPECIAL_APPROVAL_REQUIRED', '需要特别审批'],
]);
const SCOPE_TYPES = Object.freeze([
  ['CUSTOMER_AGGREGATE', '客户总额度'],
  ['SALESPERSON_SUB_LIMIT', '销售员子额度'],
]);
const PAGE_SIZE = 20;
const SELECTOR_PAGE_SIZE = 30;
const today = () => new Date().toISOString().slice(0, 10);
const labelOf = (entries, value) => entries.find(([key]) => key === value)?.[1] || value || '—';
const optionKey = (row) => `${row.customerId}\u001f${row.creditObjectType}\u001f${row.creditObjectId}`;

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
  }
  return params.toString();
}

function money(cents) {
  if (cents == null) return '不设上限';
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(cents) / 100);
}

function requestError(error, neutral404 = false) {
  if (error?.status === 403) return '当前账号没有查看该信用范围的权限。';
  if (error?.status === 404 && neutral404) return '记录不存在或无权查看。';
  if (error?.status === 409) return error.message || '信用档案或查询上下文存在冲突。';
  if (error?.status === 400) return error.message || '查询条件无效，请检查后重试。';
  if (error?.status === 0) return '网络连接失败，请检查连接后重试。';
  return error?.message || '查询失败，请稍后重试。';
}

function isAborted(error) {
  return error?.cause?.name === 'AbortError';
}

function AmountFacts({ scope }) {
  const components = scope.components || {};
  return <>
    <dl className="credit-query__amounts">
      <div><dt>额度上限</dt><dd>{scope.unlimited ? '不设上限' : money(scope.creditLimitCents)}</dd></div>
      <div><dt>已用额度</dt><dd>{money(scope.usedCents)}</dd></div>
      <div><dt>剩余额度</dt><dd>{scope.unlimited ? '不适用' : money(scope.remainingCents)}</dd></div>
      <div><dt>超额金额</dt><dd>{money(scope.overLimitCents)}</dd></div>
    </dl>
    <dl className="credit-query__facts">
      <div><dt>已审批订单承诺</dt><dd>{money(components.approvedSoCommitmentCents)}</dd></div>
      <div><dt>已出货未结算</dt><dd>{money(components.deliveredNotSettledCents)}</dd></div>
      <div><dt>应收未结</dt><dd>{money(components.arOpenCents)}</dd></div>
      <div><dt>可用预收</dt><dd>− {money(components.eligiblePrepaymentCents)}</dd></div>
      <div><dt>归属不明确</dt><dd>{money(components.ambiguousAttributionCents)}</dd></div>
      <div><dt>事实数量</dt><dd>{scope.factCounts?.orders || 0} 单 / {scope.factCounts?.deliveries || 0} 出货 / {scope.factCounts?.receivables || 0} 应收</dd></div>
    </dl>
    {scope.hasAmbiguousAttribution ? <InlineAlert tone="warning" title="存在归属不明确敞口">该金额保留在授权范围内展示，未自动归入销售员子额度。</InlineAlert> : null}
    <details className="credit-query__identity">
      <summary>计算策略身份</summary>
      <dl>
        <div><dt>合同版本</dt><dd>{scope.computedPolicyIdentity?.hashContractVersion}</dd></div>
        <div><dt>档案</dt><dd>{scope.creditProfileId}</dd></div>
        <div><dt>指纹</dt><dd>{scope.computedPolicyIdentity?.fingerprint}</dd></div>
        <div><dt>持久化快照</dt><dd>{scope.computedPolicyIdentity?.persisted ? scope.computedPolicyIdentity.creditPolicySnapshotId : '未持久化（本次只读计算）'}</dd></div>
      </dl>
    </details>
  </>;
}

function ExposureResult({ exposure, title = '当前额度查询' }) {
  if (!exposure) return null;
  return <section className="credit-query__result" aria-label={title}>
    <header><div><span>{title}</span><strong>{exposure.businessDate} · {labelOf(STAGES, exposure.stage)}</strong></div></header>
    {exposure.scopes.map((scope) => <article className="credit-query__scope" key={`${scope.scopeType}:${scope.creditProfileId}`}>
      <h3>{labelOf(SCOPE_TYPES, scope.scopeType)}</h3>
      <AmountFacts scope={scope} />
    </article>)}
  </section>;
}

function overduePresentation(evidence) {
  if (!evidence || evidence.status === 'UNKNOWN' || !evidence.evidenceVersion) return ['未知', '未取得完整历史证据，不能按正常状态处理。'];
  if (evidence.status === 'PROVEN_NOT_OVERDUE') return ['已证实未逾期', `完整性：${evidence.completeness || '—'}`];
  if (evidence.status === 'PROVEN_OVERDUE' && evidence.completeness === 'PARTIAL') return ['已证实逾期（证据不完整）', `${money(evidence.overdueOpenAmountCents)}，金额可能非全部`];
  if (evidence.status === 'PROVEN_OVERDUE') return ['已证实逾期', money(evidence.overdueOpenAmountCents)];
  return ['未知', '证据状态无法确认。'];
}

function ExceptionDetail({ detail, loading, error, profile, profileError, currentExposure, currentLoading, currentError, onClose, onQueryCurrent, onRetry }) {
  if (!loading && !detail && !error) return null;
  if (loading) return <section className="credit-query__detail"><Skeleton lines={8} /></section>;
  if (error) return <section className="credit-query__detail"><InlineAlert tone="danger" title="历史记录无法打开">{error}</InlineAlert><div className="credit-query__inline-actions"><SecondaryButton type="button" onClick={onClose}>返回列表</SecondaryButton><PrimaryButton type="button" onClick={onRetry}>重试</PrimaryButton></div></section>;
  const [overdueTitle, overdueText] = overduePresentation(detail.overdueEvidence);
  return <section className="credit-query__detail" aria-label="历史信用检查详情">
    <header className="credit-query__detail-header">
      <div><span>历史信用检查</span><h2>{labelOf(DECISIONS, detail.decision)}</h2><p>{detail.businessDate} · {labelOf(STAGES, detail.stage)}</p></div>
      <SecondaryButton type="button" onClick={onClose}>返回列表</SecondaryButton>
    </header>
    <dl className="credit-query__facts credit-query__facts--detail">
      <div><dt>检查结果 ID</dt><dd>{detail.checkResultId}</dd></div>
      <div><dt>检查组</dt><dd>{detail.checkGroupId}</dd></div>
      <div><dt>范围</dt><dd>{labelOf(SCOPE_TYPES, detail.scopeType)}</dd></div>
      <div><dt>档案</dt><dd>{detail.creditProfileId}</dd></div>
      <div><dt>原因代码</dt><dd>{detail.reasonCodes?.join('、') || '无'}</dd></div>
      <div><dt>评估时间</dt><dd>{detail.evaluatedAt || '—'}</dd></div>
    </dl>
    <InlineAlert tone={detail.overdueEvidence?.status === 'UNKNOWN' ? 'warning' : 'info'} title={overdueTitle}>{overdueText}</InlineAlert>
    <section className="credit-query__recorded" aria-label="历史记录载荷">
      <h3>历史记录载荷</h3>
      <dl className="credit-query__facts">
        {Object.entries(detail.recordedBreakdown || {}).filter(([key]) => key !== 'overdueEvidence').map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}
      </dl>
    </section>
    <section className="credit-query__approval" aria-label="特别审批关联">
      <h3>特别审批关联</h3>
      {detail.approval ? <dl className="credit-query__facts">
        <div><dt>审批 ID</dt><dd>{detail.approval.id}</dd></div>
        <div><dt>决策</dt><dd>{detail.approval.decision || '待决策'}</dd></div>
        <div><dt>申请覆盖金额</dt><dd>{money(detail.approval.requestedOverrideCents)}</dd></div>
        <div><dt>批准覆盖金额</dt><dd>{detail.approval.approvedOverrideCents == null ? '—' : money(detail.approval.approvedOverrideCents)}</dd></div>
      </dl> : <p className="credit-query__muted">该历史记录没有关联特别审批。</p>}
    </section>
    <section className="credit-query__current-context" aria-label="当前额度上下文">
      <header><div><span>当前额度查询</span><strong>与历史记录严格分离</strong></div></header>
      {profileError ? <InlineAlert tone="warning" title="当前上下文不可用">{profileError}</InlineAlert> : profile ? <>
        <p>{profile.customerId} · {profile.creditObjectType} / {profile.creditObjectId}</p>
        <PrimaryButton type="button" onClick={onQueryCurrent} disabled={currentLoading}>{currentLoading ? '正在查询…' : '按当前日期重新查询额度'}</PrimaryButton>
      </> : <Skeleton lines={2} />}
      {currentError ? <InlineAlert tone="danger" title="当前额度查询失败">{currentError}</InlineAlert> : null}
      <ExposureResult exposure={currentExposure} title="当前额度查询结果" />
    </section>
  </section>;
}

export default function CreditQuery({ user }) {
  const navigation = useAppNavigation();
  const detailId = navigation.target?.documentId || '';
  const [tab, setTab] = useState(detailId ? 'exceptions' : 'exposure');
  const [businessDate, setBusinessDate] = useState(today());
  const [stage, setStage] = useState('SO_SUBMIT');
  const [search, setSearch] = useState('');
  const [selectorOffset, setSelectorOffset] = useState(0);
  const [optionsState, setOptionsState] = useState({ rows: [], total: 0, loading: true, error: '' });
  const [selectedKey, setSelectedKey] = useState('');
  const [exposure, setExposure] = useState(null);
  const [exposureLoading, setExposureLoading] = useState(false);
  const [exposureError, setExposureError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const emptyFilters = useMemo(() => ({ category: '', decision: '', scopeType: '', stage: '', businessDateFrom: '', businessDateTo: '', hasApproval: '' }), []);
  const [filterDraft, setFilterDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [history, setHistory] = useState({ rows: [], total: 0, loading: false, error: '' });
  const [detailState, setDetailState] = useState({ row: null, loading: false, error: '' });
  const [historicalProfile, setHistoricalProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [currentExposure, setCurrentExposure] = useState(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState('');
  const controllers = useRef({});
  const sequence = useRef({ selector: 0, exposure: 0, history: 0, detail: 0, current: 0 });

  const selectedOption = optionsState.rows.find((row) => optionKey(row) === selectedKey) || null;
  const abort = useCallback((name) => { controllers.current[name]?.abort(); controllers.current[name] = null; }, []);
  const begin = useCallback((name) => {
    abort(name);
    const controller = new AbortController();
    controllers.current[name] = controller;
    sequence.current[name] += 1;
    return { controller, token: sequence.current[name] };
  }, [abort]);
  const current = useCallback((name, token) => sequence.current[name] === token, []);

  useEffect(() => () => Object.values(controllers.current).forEach((controller) => controller?.abort()), []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const request = begin('selector');
      setOptionsState((state) => ({ ...state, rows: [], loading: true, error: '' }));
      try {
        const data = await api(`/api/credit/query-options?${queryString({ businessDate, q: search, limit: SELECTOR_PAGE_SIZE, offset: selectorOffset })}`, { signal: request.controller.signal });
        if (!current('selector', request.token)) return;
        const rows = data.options || [];
        setOptionsState({ rows, total: data.total || 0, loading: false, error: '' });
        setSelectedKey((value) => rows.some((row) => optionKey(row) === value) ? value : '');
      } catch (error) {
        if (!current('selector', request.token) || isAborted(error)) return;
        setOptionsState({ rows: [], total: 0, loading: false, error: requestError(error) });
        setSelectedKey('');
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [begin, businessDate, current, search, selectorOffset]);

  const runExposure = useCallback(async (context = null) => {
    const identity = context || selectedOption;
    if (!identity) { setExposureError('请先选择授权范围内的客户与信用对象。'); return; }
    const request = begin('exposure');
    setExposure(null); setExposureError(''); setExposureLoading(true);
    try {
      const data = await api(`/api/credit/exposure?${queryString({
        customerId: identity.customerId,
        creditObjectType: identity.creditObjectType,
        creditObjectId: identity.creditObjectId,
        businessDate: context?.businessDate || businessDate,
        stage: context?.stage || stage,
      })}`, { signal: request.controller.signal });
      if (current('exposure', request.token)) setExposure(data.exposure || null);
    } catch (error) {
      if (current('exposure', request.token) && !isAborted(error)) setExposureError(requestError(error));
    } finally {
      if (current('exposure', request.token)) setExposureLoading(false);
    }
  }, [begin, businessDate, current, selectedOption, stage]);

  useEffect(() => {
    if (tab !== 'exceptions' || detailId) return undefined;
    const request = begin('history');
    setHistory((state) => ({ ...state, rows: [], loading: true, error: '' }));
    const selected = selectedOption;
    api(`/api/credit/exceptions?${queryString({ ...filters, customerId: selected?.customerId || '', limit: PAGE_SIZE, offset: historyOffset })}`, { signal: request.controller.signal })
      .then((data) => { if (current('history', request.token)) setHistory({ rows: data.exceptions || [], total: data.total || 0, loading: false, error: '' }); })
      .catch((error) => { if (current('history', request.token) && !isAborted(error)) setHistory({ rows: [], total: 0, loading: false, error: requestError(error) }); });
    return () => request.controller.abort();
  }, [begin, current, detailId, filters, historyOffset, selectedOption?.customerId, tab]);

  const loadDetail = useCallback(async (id) => {
    if (!id) return;
    const request = begin('detail');
    setTab('exceptions');
    setDetailState({ row: null, loading: true, error: '' });
    setHistoricalProfile(null); setProfileError(''); setCurrentExposure(null); setCurrentError('');
    try {
      const data = await api(`/api/credit/exceptions/${encodeURIComponent(id)}`, { signal: request.controller.signal });
      if (!current('detail', request.token)) return;
      const row = data.exception;
      setDetailState({ row, loading: false, error: '' });
      try {
        const profileData = await api(`/api/credit/profiles/${encodeURIComponent(row.creditProfileId)}`, { signal: request.controller.signal });
        if (current('detail', request.token)) setHistoricalProfile(profileData.profile || null);
      } catch (error) {
        if (current('detail', request.token) && !isAborted(error)) setProfileError(requestError(error, true));
      }
    } catch (error) {
      if (current('detail', request.token) && !isAborted(error)) setDetailState({ row: null, loading: false, error: requestError(error, true) });
    }
  }, [begin, current]);

  useEffect(() => { if (detailId) loadDetail(detailId); }, [detailId, loadDetail]);

  const queryCurrentFromDetail = useCallback(async () => {
    if (!historicalProfile || !detailState.row) return;
    const request = begin('current');
    setCurrentLoading(true); setCurrentError(''); setCurrentExposure(null);
    try {
      const data = await api(`/api/credit/exposure?${queryString({
        customerId: historicalProfile.customerId,
        creditObjectType: historicalProfile.creditObjectType,
        creditObjectId: historicalProfile.creditObjectId,
        businessDate: today(),
        stage: detailState.row.stage,
      })}`, { signal: request.controller.signal });
      if (current('current', request.token)) setCurrentExposure(data.exposure || null);
    } catch (error) {
      if (current('current', request.token) && !isAborted(error)) setCurrentError(requestError(error));
    } finally {
      if (current('current', request.token)) setCurrentLoading(false);
    }
  }, [begin, current, detailState.row, historicalProfile]);

  const switchContext = (changes) => {
    abort('exposure'); abort('current');
    setExposure(null); setExposureError(''); setCurrentExposure(null); setCurrentError('');
    changes();
  };
  const openDetail = (id) => navigation.navigate({ routeKey: 'credit-query', target: { documentId: id } });
  const closeDetail = () => navigation.navigate({ routeKey: 'credit-query' });
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (selectedOption ? 1 : 0);

  if (!user?.permissions?.includes('CREDIT_VIEW')) return <main className="credit-query"><InlineAlert tone="danger" title="无权访问">当前账号没有信用查询权限。</InlineAlert></main>;

  return <main className="credit-query" data-testid="credit-query-page">
    <header className="credit-query__header">
      <div><p>Sales &amp; Customer</p><h1>信用额度与例外查询</h1><span>只读查询；不会修改信用事实、审批或历史记录。</span></div>
    </header>
    <SegmentedControl label="信用查询视图" value={tab} onChange={(value) => { setTab(value); if (value === 'exposure' && detailId) closeDetail(); }} options={[{ value: 'exposure', label: '额度查询' }, { value: 'exceptions', label: '例外历史' }]} />

    {!detailId && <section className="credit-query__context" aria-label="授权查询上下文">
      <div className="credit-query__context-grid">
        <FormRow label="搜索授权客户 / 信用对象"><input value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setSelectorOffset(0); }} placeholder="客户代码、名称或信用对象" /></FormRow>
        <FormRow label="业务日期" required><input type="date" value={businessDate} onChange={(event) => switchContext(() => { setBusinessDate(event.target.value); setSelectorOffset(0); setSelectedKey(''); })} /></FormRow>
        <FormRow label="客户 / 信用对象" required>
          <select value={selectedKey} disabled={optionsState.loading} onChange={(event) => switchContext(() => { setSelectedKey(event.target.value); setHistoryOffset(0); })}>
            <option value="">请选择授权范围</option>
            {optionsState.rows.map((row) => <option key={optionKey(row)} value={optionKey(row)}>{row.customerCode} · {row.customerName} · {row.creditObjectType}/{row.creditObjectId}</option>)}
          </select>
        </FormRow>
        <FormRow label="信用检查阶段" required>
          <select value={stage} onChange={(event) => switchContext(() => setStage(event.target.value))}>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </FormRow>
      </div>
      {optionsState.loading ? <Skeleton lines={2} /> : optionsState.error ? <InlineAlert tone="danger" title="授权对象加载失败">{optionsState.error}</InlineAlert> : optionsState.total === 0 ? <EmptyState title="当前权限范围内没有可查询的信用对象" description="调整业务日期或搜索条件后重试。" /> : <div className="credit-query__selector-page"><span>第 {selectorOffset + 1}–{Math.min(selectorOffset + optionsState.rows.length, optionsState.total)} 项，共 {optionsState.total} 项</span><div><SecondaryButton type="button" disabled={selectorOffset === 0} onClick={() => setSelectorOffset(Math.max(0, selectorOffset - SELECTOR_PAGE_SIZE))}>上一页</SecondaryButton><SecondaryButton type="button" disabled={selectorOffset + SELECTOR_PAGE_SIZE >= optionsState.total} onClick={() => setSelectorOffset(selectorOffset + SELECTOR_PAGE_SIZE)}>下一页</SecondaryButton></div></div>}
    </section>}

    {tab === 'exposure' && !detailId ? <section className="credit-query__workspace" aria-label="SC101 信用额度查询">
      <div className="credit-query__primary-action"><PrimaryButton type="button" disabled={exposureLoading || !selectedOption} onClick={() => runExposure()}>{exposureLoading ? '正在查询…' : '查询额度'}</PrimaryButton></div>
      {exposureError ? <InlineAlert tone="danger" title="额度查询失败">{exposureError}<button type="button" className="credit-query__retry" onClick={() => runExposure()}>按相同条件重试</button></InlineAlert> : null}
      {!exposure && !exposureLoading && !exposureError ? <EmptyState title="请选择上下文并查询" description="结果将分别展示客户总额度与授权可见的销售员子额度。" /> : null}
      {exposureLoading ? <Skeleton lines={8} /> : <ExposureResult exposure={exposure} />}
    </section> : null}

    {tab === 'exceptions' && !detailId ? <section className="credit-query__workspace" aria-label="SC102 信用例外历史">
      <div className="credit-query__history-toolbar"><div><strong>例外历史</strong><span>服务端授权、筛选、计数与分页</span></div><FilterButton type="button" activeCount={activeFilterCount} onClick={() => { setFilterDraft(filters); setFiltersOpen(true); }}>筛选</FilterButton></div>
      {filtersOpen ? <FilterSheet title="信用例外筛选" onClose={() => setFiltersOpen(false)} onReset={() => setFilterDraft(emptyFilters)} onApply={() => { setFilters(filterDraft); setHistoryOffset(0); setFiltersOpen(false); }}>
        <FormRow label="例外分类"><select value={filterDraft.category} onChange={(event) => setFilterDraft({ ...filterDraft, category: event.target.value })}><option value="">全部分类</option>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormRow>
        <FormRow label="结论"><select value={filterDraft.decision} onChange={(event) => setFilterDraft({ ...filterDraft, decision: event.target.value })}><option value="">全部结论</option>{DECISIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormRow>
        <FormRow label="范围"><select value={filterDraft.scopeType} onChange={(event) => setFilterDraft({ ...filterDraft, scopeType: event.target.value })}><option value="">全部范围</option>{SCOPE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormRow>
        <FormRow label="阶段"><select value={filterDraft.stage} onChange={(event) => setFilterDraft({ ...filterDraft, stage: event.target.value })}><option value="">全部阶段</option>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormRow>
        <FormRow label="起始业务日期"><input type="date" value={filterDraft.businessDateFrom} onChange={(event) => setFilterDraft({ ...filterDraft, businessDateFrom: event.target.value })} /></FormRow>
        <FormRow label="结束业务日期"><input type="date" value={filterDraft.businessDateTo} onChange={(event) => setFilterDraft({ ...filterDraft, businessDateTo: event.target.value })} /></FormRow>
        <FormRow label="特别审批关联"><select value={filterDraft.hasApproval} onChange={(event) => setFilterDraft({ ...filterDraft, hasApproval: event.target.value })}><option value="">全部</option><option value="true">有关联</option><option value="false">无关联</option></select></FormRow>
      </FilterSheet> : null}
      {history.loading ? <Skeleton lines={8} /> : history.error ? <InlineAlert tone="danger" title="例外历史加载失败">{history.error}<button type="button" className="credit-query__retry" onClick={() => setFilters({ ...filters })}>按相同条件重试</button></InlineAlert> : history.rows.length === 0 ? <EmptyState title={historyOffset ? '当前页没有记录' : '当前条件无例外记录'} description="不会自动扩大授权范围或放宽筛选条件。" action={activeFilterCount ? <SecondaryButton type="button" onClick={() => { setFilters(emptyFilters); setHistoryOffset(0); }}>清除筛选</SecondaryButton> : null} /> : <>
        <ol className="credit-query__history-list">
          {history.rows.map((row) => <li key={row.checkResultId}><button type="button" onClick={() => openDetail(row.checkResultId)}><div className="credit-query__history-title"><strong>{labelOf(DECISIONS, row.decision)}</strong><span>{row.businessDate} · {labelOf(STAGES, row.stage)}</span></div><div className="credit-query__categories">{row.categories.map((category) => <span key={category}>{labelOf(CATEGORIES, category)}</span>)}</div><dl><div><dt>范围</dt><dd>{labelOf(SCOPE_TYPES, row.scopeType)}</dd></div><div><dt>特别审批</dt><dd>{row.hasApprovalAssociation ? '有关联' : '无关联'}</dd></div></dl></button></li>)}
        </ol>
        <div className="credit-query__pagination"><span>第 {historyOffset + 1}–{Math.min(historyOffset + history.rows.length, history.total)} 条，共 {history.total} 条</span><div><SecondaryButton type="button" disabled={historyOffset === 0} onClick={() => setHistoryOffset(Math.max(0, historyOffset - PAGE_SIZE))}>上一页</SecondaryButton><SecondaryButton type="button" disabled={historyOffset + PAGE_SIZE >= history.total} onClick={() => setHistoryOffset(historyOffset + PAGE_SIZE)}>下一页</SecondaryButton></div></div>
      </>}
    </section> : null}

    {detailId ? <ExceptionDetail detail={detailState.row} loading={detailState.loading} error={detailState.error} profile={historicalProfile} profileError={profileError} currentExposure={currentExposure} currentLoading={currentLoading} currentError={currentError} onClose={closeDetail} onQueryCurrent={queryCurrentFromDetail} onRetry={() => loadDetail(detailId)} /> : null}
  </main>;
}
