import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  BottomActionBar, DangerSheet, DependencyGraphSheet, EmptyState, FilterButton,
  FilterSheet, FormRow, InlineAlert, LifecycleBadge, PrimaryButton, RecordCard,
  RecordList, SearchField, SecondaryButton, Sheet, Skeleton, StatusChip,
  TertiaryButton,
} from '../components/design-system.jsx';
import { safeErrorMessage } from '../lib/copy.js';

const TABS = [{ key: 'records', label: '业务记录' }, { key: 'audit', label: '清理审计' }];
const CLASSIFICATION_COPY = {
  SAFE_DELETE: { title: '可直接删除', action: '删除记录' },
  SAFE_CHAIN_DELETE: { title: '可整链删除', action: '清理错误业务链' },
  SAFE_REVERSAL_CLEANUP: { title: '可冲销后清理', action: '冲销并清理' },
  ARCHIVE_ONLY: { title: '仅可归档', action: '' },
  BLOCKED: { title: '当前无法清理', action: '' },
};

function displayDate(value, withTime = false) {
  if (!value) return '—';
  const text = String(value).replace('T', ' ');
  return withTime ? text.slice(0, 19) : text.slice(0, 10);
}

function errorCopy(error) {
  return safeErrorMessage({ status: error?.status, code: error?.code, serverMessage: error?.message });
}

export default function DataCleanup({ user, notify }) {
  const isAdmin = user?.permissions?.includes('USERS_MANAGE');
  const [tab, setTab] = useState('records');
  const [records, setRecords] = useState(null);
  const [events, setEvents] = useState(null);
  const [entityTypes, setEntityTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [graph, setGraph] = useState(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [expandedScope, setExpandedScope] = useState(false);
  const [loadingGraph, setLoadingGraph] = useState(false);
  const [confirmAction, setConfirmAction] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const loadRecords = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const params = new URLSearchParams({ limit: '80' });
      if (search.trim()) params.set('search', search.trim());
      if (entityType) params.set('entityType', entityType);
      if (includeArchived) params.set('includeArchived', 'true');
      const data = await api(`/api/lifecycle/records?${params}`);
      setRecords(data.records || []);
      setEntityTypes(data.entityTypes || []);
      setLoadError('');
    } catch (error) {
      setRecords([]);
      setLoadError(errorCopy(error));
    }
  }, [entityType, includeArchived, isAdmin, search]);

  const loadEvents = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (entityType) params.set('entityType', entityType);
      const data = await api(`/api/lifecycle/cleanup-events?${params}`);
      setEvents(data.events || []);
      setLoadError('');
    } catch (error) {
      setEvents([]);
      setLoadError(errorCopy(error));
    }
  }, [entityType, isAdmin, search]);

  useEffect(() => { if (tab === 'records') void loadRecords(); else void loadEvents(); }, [tab, loadEvents, loadRecords]);

  const analyze = useCallback(async (record, includeExternal = false) => {
    setLoadingGraph(true);
    try {
      const params = new URLSearchParams({ entityType: record.entityType, entityId: record.entityId });
      if (includeExternal) params.set('includeExternal', 'true');
      const data = await api(`/api/lifecycle/analyze?${params}`);
      setGraph(data.graph);
    } catch (error) {
      setGraph(null);
      notify(errorCopy(error), 'error');
    } finally { setLoadingGraph(false); }
  }, [notify]);

  function openRecord(record) {
    setSelected(record);
    setGraph(null);
    setGraphOpen(false);
    setExpandedScope(false);
    void analyze(record, false);
  }

  async function toggleScope() {
    if (!selected) return;
    const next = !expandedScope;
    setExpandedScope(next);
    await analyze(selected, next);
  }

  async function performAction() {
    if (!selected || !confirmAction) return;
    const cleanReason = reason.trim();
    if ((confirmAction === 'cleanup' || confirmAction === 'archive') && !cleanReason) {
      notify(confirmAction === 'cleanup' ? '请填写清理原因' : '请填写归档原因', 'error');
      return;
    }
    setBusy(true);
    try {
      const identity = { entityType: selected.entityType, entityId: selected.entityId };
      if (confirmAction === 'archive') {
        await api('/api/lifecycle/archive', { method: 'POST', body: { ...identity, reason: cleanReason } });
        notify('记录已归档');
      } else if (confirmAction === 'restore') {
        await api('/api/lifecycle/restore', { method: 'POST', body: identity });
        notify('记录已恢复');
      } else {
        await api('/api/lifecycle/cleanup', { method: 'POST', body: {
          ...identity, reason: cleanReason, confirm: true, includeExternal: expandedScope,
        } });
        notify('错误业务已安全清理');
      }
      setConfirmAction(''); setReason(''); setSelected(null); setGraph(null); setGraphOpen(false);
      await loadRecords();
      if (confirmAction === 'cleanup') setEvents(null);
    } catch (error) { notify(errorCopy(error), 'error'); }
    finally { setBusy(false); }
  }

  const activeFilterCount = Number(Boolean(entityType)) + Number(includeArchived);
  const classification = graph ? CLASSIFICATION_COPY[graph.classification] : null;
  const hasExternalBlock = graph?.blockers?.some((blocker) => blocker.code === 'EXTERNAL_DEPENDENCY');
  const resultRows = tab === 'records' ? records : events;
  const searchPlaceholder = tab === 'records' ? '搜索单号或编号' : '搜索清理单号或原因';
  const typeOptions = useMemo(() => [{ key: '', label: '全部类型' }, ...entityTypes], [entityTypes]);

  if (!isAdmin) return <EmptyState title="没有权限" description="仅系统管理员可使用数据整理。"/>;

  return <section className="mobile-cleanup" aria-label="数据整理">
    <div className="segmented-control" role="tablist" aria-label="数据整理视图">
      {TABS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'is-selected' : ''} onClick={() => { setTab(item.key); setSearch(''); }}>{item.label}</button>)}
    </div>

    <div className="mobile-cleanup__toolbar">
      <SearchField value={search} onChange={setSearch} onSubmit={tab === 'records' ? loadRecords : loadEvents} placeholder={searchPlaceholder}/>
      <FilterButton activeCount={activeFilterCount} onClick={() => setFilterOpen(true)}>筛选</FilterButton>
    </div>
    {loadError && <InlineAlert tone="danger">{loadError}</InlineAlert>}
    {resultRows === null ? <Skeleton lines={5}/> : resultRows.length === 0 ? <EmptyState
      title={tab === 'records' ? '没有匹配的业务记录' : '尚无永久清理审计'}
      description={tab === 'records' && !includeArchived ? '归档记录默认隐藏，可在筛选中选择显示归档。' : '调整搜索或筛选条件后重试。'}
    /> : tab === 'records' ? <RecordList>
      {records.map((record) => <RecordCard
        key={`${record.entityType}:${record.entityId}`}
        title={record.documentNo} subtitle={record.label} onClick={() => openRecord(record)}
        status={<LifecycleBadge archived={record.archived}/>} facts={[
          { label: '状态', value: <StatusChip status={record.status}/> },
          { label: '业务日期', value: displayDate(record.businessDate) },
          ...(record.archived ? [{ label: '归档原因', value: record.archiveReason || '—' }] : []),
        ]}
      />)}
    </RecordList> : <RecordList>
      {events.map((event) => <RecordCard key={event.id} title={event.rootDocumentNo} subtitle={event.affectedEntityTypes.map((type) => entityTypes.find((item) => item.key === type)?.label || type).join('、')}
        status={<LifecycleBadge classification={event.classification}/>} facts={[
          { label: '执行人', value: event.actor?.displayName || '—' },
          { label: '原因', value: event.reason },
          { label: '影响记录', value: `${event.items.length} 条` },
          { label: '执行时间', value: displayDate(event.createdAt, true) },
        ]}>
        <details className="mobile-cleanup__audit-detail"><summary>查看永久审计快照</summary>
          {event.items.map((item) => <div key={item.id}><strong>{item.documentNo}</strong><span>{entityTypes.find((type) => type.key === item.entityType)?.label || item.entityType} · {item.status || '—'}</span></div>)}
        </details>
      </RecordCard>)}
    </RecordList>}

    {filterOpen && <FilterSheet title="筛选" onClose={() => setFilterOpen(false)} onReset={() => { setEntityType(''); setIncludeArchived(false); }} onApply={() => { setFilterOpen(false); tab === 'records' ? void loadRecords() : void loadEvents(); }}>
      <FormRow label="业务类型"><select value={entityType} onChange={(event) => setEntityType(event.target.value)}>{typeOptions.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></FormRow>
      {tab === 'records' && <label className="mobile-cleanup__check"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}/><span>显示归档记录</span></label>}
    </FilterSheet>}

    {selected && <Sheet title={`${selected.label} · ${selected.documentNo}`} onClose={() => { setSelected(null); setGraph(null); }}>
      <div className="mobile-cleanup__detail">
        <RecordCard title={selected.documentNo} subtitle={selected.label} status={<StatusChip status={selected.status}/>} facts={[
          { label: '业务日期', value: displayDate(selected.businessDate) },
          { label: '期间', value: selected.period || '—' },
          ...(selected.archived ? [{ label: '归档原因', value: selected.archiveReason || '—' }] : []),
        ]}/>
        {loadingGraph ? <Skeleton lines={3}/> : graph && <>
          <div className="mobile-cleanup__analysis">
            <LifecycleBadge classification={graph.classification}/><strong>{classification?.title}</strong>
            <span>{graph.summary.selectedRecords} 条记录 · {graph.summary.inventoryMovements} 条库存异动 · {graph.summary.receivableEffects + graph.summary.payableEffects} 条往来账 · {graph.summary.voucherEffects} 条凭证</span>
            <SecondaryButton type="button" onClick={() => setGraphOpen(true)}>查看关联业务</SecondaryButton>
          </div>
          {graph.blockers.map((blocker) => <InlineAlert key={blocker.code} tone="danger">{blocker.message}</InlineAlert>)}
          {hasExternalBlock && !expandedScope && <SecondaryButton type="button" onClick={toggleScope}>扩大清理范围并重新分析</SecondaryButton>}
        </>}
      </div>
      <BottomActionBar>
        {selected.archived ? <PrimaryButton type="button" onClick={() => setConfirmAction('restore')}>恢复</PrimaryButton> : <SecondaryButton type="button" onClick={() => setConfirmAction('archive')}>归档</SecondaryButton>}
        {classification?.action && <PrimaryButton type="button" onClick={() => setConfirmAction('cleanup')}>{classification.action}</PrimaryButton>}
      </BottomActionBar>
    </Sheet>}

    {graphOpen && graph && <DependencyGraphSheet graph={graph} onClose={() => setGraphOpen(false)} actions={<>
      {hasExternalBlock && <TertiaryButton type="button" onClick={toggleScope}>{expandedScope ? '恢复直接范围' : '扩大清理范围'}</TertiaryButton>}
      <PrimaryButton type="button" onClick={() => setGraphOpen(false)}>返回</PrimaryButton>
    </>}/>} 

    {confirmAction && <DangerSheet title={confirmAction === 'cleanup' ? '确认永久清理' : confirmAction === 'archive' ? '确认归档' : '确认恢复'}
      confirmLabel={busy ? '处理中…' : confirmAction === 'cleanup' ? classification?.action : confirmAction === 'archive' ? '归档' : '恢复'}
      onClose={() => { if (!busy) { setConfirmAction(''); setReason(''); } }} onConfirm={performAction}>
      {confirmAction === 'cleanup' && graph && <>
        <p>将处理 <strong>{graph.summary.selectedRecords}</strong> 条业务记录。库存、往来账和凭证影响会在同一事务中验证并清理，任一步失败都会全部回滚。</p>
        <InlineAlert tone="warning">库存异动 {graph.summary.inventoryMovements} 条；往来账 {graph.summary.receivableEffects + graph.summary.payableEffects} 条；凭证 {graph.summary.voucherEffects} 条。</InlineAlert>
      </>}
      {confirmAction !== 'cleanup' && <p>{confirmAction === 'archive' ? '归档只改变列表展示，不会改变库存、往来账、凭证或 MRP 运算。' : '恢复后记录将重新出现在正常业务列表中。'}</p>}
      {confirmAction !== 'restore' && <FormRow label={confirmAction === 'cleanup' ? '清理原因' : '归档原因'} required><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请说明错误数据或归档原因"/></FormRow>}
    </DangerSheet>}
  </section>;
}
