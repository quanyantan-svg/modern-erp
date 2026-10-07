// Planning Configuration surface — parameters / material policy / schemes.
//
// CONTEXTUAL route under `planned-orders`. Only users with
// PLANNING_CONFIG_MANAGE can mutate. View-only display otherwise.

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import {
  BusinessPageShell, ConfirmSheet, EmptyState, InlineAlert,
  SegmentedControl, Sheet, StatusChip,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import '../styles/planning-workbench.css';

const SCOPE_MODE_LABELS = { GLOBAL: '全局', SELECTED: '已选来源', PRECISE_SELECTED: '精确已选' };
const RELEASE_POLICY_LABELS = { KEEP_ALL: '保留全部', RELEASE_WEAK: '释放弱预留' };
const SCHEME_STATUS_LABELS = { DRAFT: '草稿', ACTIVE: '已启用', INACTIVE: '已停用' };
const SCHEME_STATUS_TONE = { DRAFT: 'neutral', ACTIVE: 'success', INACTIVE: 'muted' };
const STRATEGY_LABELS = { AUTO: '自动', MAKE: '生产', BUY: '采购', OUTSOURCE: '委外' };

const CONFIG_TABS = [
  { value: 'parameters', label: '参数' },
  { value: 'schemes', label: '方案' },
  { value: 'policies', label: '物料策略' },
];

export default function PlanningConfiguration({ user, notify }) {
  const navigation = useAppNavigation();
  const canManage = can(user, 'PLANNING_CONFIG_MANAGE');
  const [tab, setTab] = useState('parameters');
  const [parameters, setParameters] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [open, setOpen] = useState(null);
  const [state, setState] = useState('LOADING');

  const reload = async () => {
    setState('LOADING');
    try {
      const [params, schemeList, policyList] = await Promise.all([
        api('/api/planning/parameters'),
        api('/api/planning/schemes'),
        api('/api/planning/material-policies?search='),
      ]);
      setParameters(params.parameters || null);
      setSchemes(schemeList.schemes || []);
      setPolicies(policyList.policies || []);
      setState('READY');
    } catch (error) { setState('ERROR'); notify(error.message, 'error'); }
  };
  useEffect(() => { void reload(); }, []);

  useEffect(() => {
    if (navigation.target?.page === 'planning-configuration' && navigation.target.documentId) {
      const scheme = schemes.find((row) => row.id === navigation.target.documentId);
      if (scheme) setOpen({ kind: 'scheme', id: scheme.id });
    }
  }, [navigation.target, schemes]);

  const toggleReservation = async (enabled) => {
    try {
      await api('/api/planning/parameters', { method: 'PATCH', body: { reservationEnabled: enabled } });
      notify(`预留功能已${enabled ? '启用' : '停用'}`, 'success');
      await reload();
    } catch (error) { notify(error.message, 'error'); }
  };

  return <BusinessPageShell className="planning-closure planning-configuration" width="rail">
    <header className="planning-hero">
      <div><span>PLANNING CONFIGURATION</span><h2>计划配置</h2></div>
      <p>维护计划参数、物料策略、计划方案；仅授权用户可修改。</p>
    </header>

    {!canManage && <InlineAlert tone="warning">当前账号为只读，需要 PLANNING_CONFIG_MANAGE 权限才能修改。</InlineAlert>}

    <SegmentedControl label="配置分类" options={CONFIG_TABS} value={tab} onChange={setTab}/>

    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <EmptyState title="配置加载失败" action={<button className="secondary" onClick={() => void reload()}>重新加载</button>}/>}

    {state === 'READY' && tab === 'parameters' && parameters && <ParametersPanel parameters={parameters} canManage={canManage} onToggleReservation={toggleReservation}/>}

    {state === 'READY' && tab === 'schemes' && <SchemesPanel schemes={schemes} canManage={canManage} notify={notify} onChanged={reload} onOpen={(row) => setOpen({ kind: 'scheme', id: row.id })}/>}

    {state === 'READY' && tab === 'policies' && <PoliciesPanel policies={policies} canManage={canManage} notify={notify} onChanged={reload} onOpen={(row) => setOpen({ kind: 'policy', id: row.product_id })}/>}

    {open?.kind === 'scheme' && <SchemeEditorSheet scheme={schemes.find((row) => row.id === open.id)} onClose={() => setOpen(null)} onChanged={reload} canManage={canManage} notify={notify}/>}
    {open?.kind === 'policy' && <MaterialPolicySheet policy={policies.find((row) => row.product_id === open.id)} onClose={() => setOpen(null)} onChanged={reload} canManage={canManage} notify={notify}/>}
  </BusinessPageShell>;
}

function ParametersPanel({ parameters, canManage, onToggleReservation }) {
  return <section className="planning-config-section">
    <h3>预留功能</h3>
    <div className="planning-config-row">
      <div>
        <strong>预留启用</strong>
        <p>停用后不能再新建预留，但保留历史预留查询。</p>
      </div>
      <button type="button" className={parameters.reservation_enabled ? 'primary' : 'secondary'} disabled={!canManage} onClick={() => onToggleReservation(!parameters.reservation_enabled)}>
        {parameters.reservation_enabled ? '已启用（点击停用）' : '已停用（点击启用）'}
      </button>
    </div>
    <p className="planning-config-meta">最后更新：{parameters.updated_at ? String(parameters.updated_at).slice(0, 16).replace('T', ' ') : '—'}</p>
  </section>;
}

function SchemesPanel({ schemes, canManage, notify, onChanged, onOpen }) {
  return <section className="planning-config-section">
    <div className="planning-config-toolbar">
      <strong>计划方案</strong>
      {canManage && <button type="button" className="primary" onClick={async () => {
        const code = `SCH-${Date.now().toString().slice(-6)}`;
        try { await api('/api/planning/schemes', { method: 'POST', body: { schemeCode: code, schemeName: '新建方案', horizonDays: 90 } }); notify('方案已创建', 'success'); onChanged(); }
        catch (error) { notify(error.message, 'error'); }
      }}>新建方案</button>}
    </div>
    {schemes.length === 0 && <EmptyState title="暂无方案" description="新建方案后才能开始 MRP 运算。"/>}
    <div className="planning-order-list">
      {schemes.map((row) => <article key={row.id} className="planning-order">
        <button type="button" className="planning-order__open" onClick={() => onOpen(row)}>
          <div className="planning-order__identity"><span className="mono">{row.scheme_code}</span><StatusChip status={row.status} domain="master">{SCHEME_STATUS_LABELS[row.status] || row.status}</StatusChip></div>
          <h3>{row.scheme_name}</h3>
          <dl>
            <div><dt>计划跨度</dt><dd>{row.horizon_days} 天</dd></div>
            <div><dt>计算范围</dt><dd>{SCOPE_MODE_LABELS[row.calculation_scope_mode] || row.calculation_scope_mode}</dd></div>
            <div><dt>预留释放</dt><dd>{RELEASE_POLICY_LABELS[row.reservation_release_policy] || row.reservation_release_policy}</dd></div>
            <div><dt>强制策略</dt><dd>{row.force_supply_strategy ? STRATEGY_LABELS[row.force_supply_strategy] || row.force_supply_strategy : '无'}</dd></div>
            <div><dt>需求来源</dt><dd>{row.demandSources?.filter((s) => s.enabled).length || 0} 项</dd></div>
            <div><dt>供应来源</dt><dd>{row.supplySources?.filter((s) => s.enabled).length || 0} 项</dd></div>
            <div><dt>仓库</dt><dd>{row.warehouses?.filter((w) => w.participates).length || 0} 个</dd></div>
          </dl>
        </button>
      </article>)}
    </div>
  </section>;
}

function PoliciesPanel({ policies, canManage, notify, onChanged, onOpen }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => policies.filter((row) => !search || (row.product_code || '').toLowerCase().includes(search.toLowerCase()) || (row.product_name || '').toLowerCase().includes(search.toLowerCase())), [policies, search]);
  return <section className="planning-config-section">
    <div className="planning-config-toolbar">
      <strong>物料策略</strong>
      <input type="search" placeholder="搜索物料" value={search} onChange={(event) => setSearch(event.target.value)} className="planning-search"/>
    </div>
    {filtered.length === 0 && <EmptyState title="没有匹配的物料策略"/>}
    <div className="planning-order-list">
      {filtered.slice(0, 80).map((row) => <article key={row.id} className="planning-order">
        <button type="button" className="planning-order__open" onClick={() => canManage && onOpen(row)}>
          <div className="planning-order__identity"><span className="mono">{row.product_code}</span><StatusChip status={row.supply_strategy} domain="master">{STRATEGY_LABELS[row.supply_strategy] || row.supply_strategy}</StatusChip></div>
          <h3>{row.product_name}</h3>
          <dl>
            <div><dt>安全库存</dt><dd>{Number(row.safety_stock || 0)}</dd></div>
            <div><dt>再订货点</dt><dd>{Number(row.reorder_point || 0)}</dd></div>
            <div><dt>最高库存</dt><dd>{Number(row.maximum_stock || 0)}</dd></div>
            <div><dt>EOQ</dt><dd>{Number(row.economic_order_quantity || 0)}</dd></div>
            <div><dt>提前期</dt><dd>{Number(row.lead_time_days || 0)} 天</dd></div>
          </dl>
        </button>
      </article>)}
    </div>
  </section>;
}

function SchemeEditorSheet({ scheme, onClose, onChanged, canManage, notify }) {
  const [form, setForm] = useState(() => scheme ? {
    schemeCode: scheme.scheme_code, schemeName: scheme.scheme_name, horizonDays: scheme.horizon_days,
    calculationScopeMode: scheme.calculation_scope_mode, reservationReleasePolicy: scheme.reservation_release_policy,
    forceSupplyStrategy: scheme.force_supply_strategy || '',
    demandSources: scheme.demandSources?.map((s) => s.source_type) || [],
    supplySources: scheme.supplySources?.map((s) => s.source_type) || [],
    warehouses: scheme.warehouses?.map((w) => w.warehouse_id) || [],
    notes: scheme.notes || '',
  } : null);
  const [warehouses, setWarehouses] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/api/warehouses?limit=500').then((res) => setWarehouses(res.warehouses || [])).catch(() => setWarehouses([])); }, []);
  if (!scheme || !form) return <Sheet title="编辑方案" onClose={onClose}><EmptyState title="方案不存在"/></Sheet>;

  const readOnly = scheme.status !== 'DRAFT' || !canManage;

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/planning/schemes/${scheme.id}`, { method: 'PATCH', body: form });
      notify('方案已保存', 'success');
      await onChanged();
      onClose();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };
  const activate = async () => {
    setBusy(true);
    try {
      await api(`/api/planning/schemes/${scheme.id}/activate`, { method: 'POST' });
      notify('方案已启用', 'success');
      await onChanged();
      onClose();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };

  const toggleDemand = (value) => setForm({ ...form, demandSources: form.demandSources.includes(value) ? form.demandSources.filter((v) => v !== value) : [...form.demandSources, value] });
  const toggleSupply = (value) => setForm({ ...form, supplySources: form.supplySources.includes(value) ? form.supplySources.filter((v) => v !== value) : [...form.supplySources, value] });
  const toggleWh = (value) => setForm({ ...form, warehouses: form.warehouses.includes(value) ? form.warehouses.filter((v) => v !== value) : [...form.warehouses, value] });

  return <Sheet title={`方案 ${scheme.scheme_code}`} onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <label className="form-row"><span className="field-label">方案编码 *</span>
        <input type="text" value={form.schemeCode} disabled={readOnly} onChange={(event) => setForm({ ...form, schemeCode: event.target.value.toUpperCase() })}/>
      </label>
      <label className="form-row"><span className="field-label">方案名称 *</span>
        <input type="text" value={form.schemeName} disabled={readOnly} onChange={(event) => setForm({ ...form, schemeName: event.target.value })}/>
      </label>
      <div className="planning-form__group">
        <label className="form-row"><span className="field-label">计划跨度 (天) *</span>
          <input type="number" min="1" max="3660" value={form.horizonDays} disabled={readOnly} onChange={(event) => setForm({ ...form, horizonDays: Number(event.target.value) })}/>
        </label>
        <label className="form-row"><span className="field-label">计算范围</span>
          <select value={form.calculationScopeMode} disabled={readOnly} onChange={(event) => setForm({ ...form, calculationScopeMode: event.target.value })}>
            {Object.entries(SCOPE_MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="form-row"><span className="field-label">预留释放</span>
          <select value={form.reservationReleasePolicy} disabled={readOnly} onChange={(event) => setForm({ ...form, reservationReleasePolicy: event.target.value })}>
            {Object.entries(RELEASE_POLICY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="form-row"><span className="field-label">强制策略</span>
          <select value={form.forceSupplyStrategy} disabled={readOnly} onChange={(event) => setForm({ ...form, forceSupplyStrategy: event.target.value })}>
            <option value="">不强制</option>
            {Object.entries(STRATEGY_LABELS).filter(([k]) => k !== 'AUTO').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="planning-form__chips">
        <legend>需求来源</legend>
        {['SALES_ORDER', 'FORECAST', 'SAFETY_STOCK', 'BOM_COMPONENT'].map((key) => <label key={key}><input type="checkbox" disabled={readOnly} checked={form.demandSources.includes(key)} onChange={() => toggleDemand(key)}/>{key}</label>)}
      </fieldset>
      <fieldset className="planning-form__chips">
        <legend>供应来源</legend>
        {['ON_HAND', 'PURCHASE_ORDER', 'PRODUCTION_ORDER', 'PLANNED_ORDER'].map((key) => <label key={key}><input type="checkbox" disabled={readOnly} checked={form.supplySources.includes(key)} onChange={() => toggleSupply(key)}/>{key}</label>)}
      </fieldset>
      <fieldset className="planning-form__chips">
        <legend>仓库参与</legend>
        {warehouses.map((w) => <label key={w.id}><input type="checkbox" disabled={readOnly} checked={form.warehouses.includes(w.id)} onChange={() => toggleWh(w.id)}/>{w.code}</label>)}
      </fieldset>
      <label className="form-row"><span className="field-label">备注</span>
        <textarea rows={3} value={form.notes} disabled={readOnly} onChange={(event) => setForm({ ...form, notes: event.target.value })}/>
      </label>
      {readOnly && <InlineAlert tone="info">只有草稿状态、且具备 PLANNING_CONFIG_MANAGE 权限时可编辑。</InlineAlert>}
    </section>
    <div className="bottom-action-bar">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      {canManage && scheme.status === 'DRAFT' && <button type="button" className="secondary" disabled={busy} onClick={save}>保存</button>}
      {canManage && scheme.status === 'DRAFT' && <button type="button" className="primary" disabled={busy} onClick={save + activate}>保存并启用</button>}
      {canManage && scheme.status === 'DRAFT' && <button type="button" className="primary" disabled={busy} onClick={activate}>启用</button>}
      {canManage && scheme.status === 'ACTIVE' && <button type="button" className="secondary" disabled={busy} onClick={async () => {
        try { await api(`/api/planning/schemes/${scheme.id}/deactivate`, { method: 'POST' }); notify('方案已停用', 'success'); await onChanged(); onClose(); }
        catch (error) { notify(error.message, 'error'); }
      }}>停用</button>}
    </div>
  </Sheet>;
}

function MaterialPolicySheet({ policy, onClose, onChanged, canManage, notify }) {
  const [form, setForm] = useState(policy ? {
    safetyStock: policy.safety_stock, reorderPoint: policy.reorder_point, maximumStock: policy.maximum_stock,
    economicOrderQuantity: policy.economic_order_quantity, leadTimeDays: policy.lead_time_days, supplyStrategy: policy.supply_strategy,
  } : null);
  const [busy, setBusy] = useState(false);
  if (!policy || !form) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/api/planning/material-policies/${policy.product_id}`, { method: 'PATCH', body: form });
      notify('物料策略已保存', 'success');
      await onChanged();
      onClose();
    } catch (error) { notify(error.message, 'error'); }
    finally { setBusy(false); }
  };
  return <Sheet title={`物料策略 ${policy.product_code}`} onClose={onClose} className="planning-form">
    <section className="planning-form__section">
      <p className="planning-form__hint">{policy.product_name} · {policy.product_code}</p>
      <div className="planning-form__group">
        <label className="form-row"><span className="field-label">安全库存</span>
          <input type="number" inputMode="decimal" min="0" step="0.0001" value={form.safetyStock} disabled={!canManage} onChange={(event) => setForm({ ...form, safetyStock: Number(event.target.value) })}/>
        </label>
        <label className="form-row"><span className="field-label">再订货点</span>
          <input type="number" inputMode="decimal" min="0" step="0.0001" value={form.reorderPoint} disabled={!canManage} onChange={(event) => setForm({ ...form, reorderPoint: Number(event.target.value) })}/>
        </label>
        <label className="form-row"><span className="field-label">最高库存</span>
          <input type="number" inputMode="decimal" min="0" step="0.0001" value={form.maximumStock} disabled={!canManage} onChange={(event) => setForm({ ...form, maximumStock: Number(event.target.value) })}/>
        </label>
        <label className="form-row"><span className="field-label">经济订货批量</span>
          <input type="number" inputMode="decimal" min="0" step="0.0001" value={form.economicOrderQuantity} disabled={!canManage} onChange={(event) => setForm({ ...form, economicOrderQuantity: Number(event.target.value) })}/>
        </label>
        <label className="form-row"><span className="field-label">提前期 (天)</span>
          <input type="number" inputMode="numeric" min="0" step="1" value={form.leadTimeDays} disabled={!canManage} onChange={(event) => setForm({ ...form, leadTimeDays: Number(event.target.value) })}/>
        </label>
        <label className="form-row"><span className="field-label">供应策略</span>
          <select value={form.supplyStrategy} disabled={!canManage} onChange={(event) => setForm({ ...form, supplyStrategy: event.target.value })}>
            {Object.entries(STRATEGY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
    </section>
    <div className="bottom-action-bar">
      <button type="button" className="secondary" onClick={onClose}>关闭</button>
      {canManage && <button type="button" className="primary" disabled={busy} onClick={submit}>保存</button>}
    </div>
  </Sheet>;
}