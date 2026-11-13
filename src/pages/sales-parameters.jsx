// Sales & Customer — SC01 Sales Parameters + SC06/SC07/SC08/SC19 operator work surfaces.
//
// Contract:
//   document.md §34.3.1 (SC01 Sales Parameters, SC06 Sales Group, SC07
//   Customer-Material Xref + Sellable Scope, SC08 Commercial Defaults)
//   document.md §34.3.3 (SC19 Manual Price Override — separate authority)
//   solution.md  §29.4.5 (A-65 sales_parameters), §29.4.2 (A-63/A-64/A-66)
//   solution.md  §29.4.3 (A-69 sales_sellable_scope_rules), §29.18 (A-61
//   product_commercial_classification), §29.7 (SC19 price override).
//
// Audit defect SC-DEF-08 (Sales & Customer capability audit 2026-11-13):
//   `/api/sales/parameters`, `/api/sales/memberships`,
//   `/api/sales/sellable-scope-rules` and
//   `/api/sales/product-classifications` had a backend but NO operator work
//   surface, so the four configuration families could only be changed by
//   editing the database or calling the API by hand. SC19 likewise had a
//   `POST /api/sales-price-overrides/authorize` backend entry with no way for
//   an operator to obtain an authorisation.
//
// This module closes that defect. It adds NO new API: every screen reads and
// writes the existing, already-shipped endpoints. Business semantics, API
// shapes, permissions, state machines and approval semantics are unchanged —
// the UI only surfaces what the backend already decides.
//
// House style follows `src/pages/sales-batch-a.jsx` (LIST → DETAIL → EDITOR),
// `src/pages/wave8-sales.jsx` (real empty states, classified failures) and
// `src/pages/inventory-work.jsx` (mobile-first work surfaces). The canonical
// design-system components in `src/components/design-system.jsx` are used
// instead of new primitives.
//
// Mobile-first: 390 CSS px is the primary baseline; the surfaces are also
// verified at 320 / 430 / 680. No horizontal page scrolling for the core
// task — the grids collapse to a single column below 680px and every
// tappable target is at least 44px tall.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { can } from '../components/ui.jsx';
import {
  BottomActionBar,
  BusinessContentSection,
  BusinessPageHeader,
  BusinessPageShell,
  BusinessState,
  DateField,
  DetailSection,
  FormRow,
  PrimaryButton,
  RecordCard,
  RecordList,
  SecondaryButton,
  SelectField,
  Sheet,
  StatusChip,
  TextArea,
  TextField,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Bounded vocabularies — mirrored from the backend validators so the operator
// never submits a value the server will reject. The backend remains the
// authority: these lists only constrain the UI pickers.
// ---------------------------------------------------------------------------

const DOCUMENT_TYPES = ['SALES_ORDER', 'SALES_QUOTATION', 'DELIVERY_NOTICE'];
const ORDER_CHANGE_MODES = [
  { value: 'DISABLED', label: 'DISABLED — 两条 APPROVED 订单变更路径均拒绝' },
  { value: 'CONTROLLED_DIRECT', label: 'CONTROLLED_DIRECT — 仅受控直接入口' },
  { value: 'CONTROLLED_DOCUMENT', label: 'CONTROLLED_DOCUMENT — 仅正式变更单入口' },
  { value: 'BOTH', label: 'BOTH — 两条入口均开放（各自权限与审批合同不变）' },
];
const RESERVATION_BEHAVIORS = [
  { value: 'DISABLED', label: 'DISABLED — 不发起预留' },
  { value: 'INVENTORY_LOCK', label: 'INVENTORY_LOCK — 库存锁定' },
  { value: 'MANUAL_RESERVATION', label: 'MANUAL_RESERVATION — 手工预留' },
  { value: 'ON_HAND_RESERVATION', label: 'ON_HAND_RESERVATION — 在库量预留' },
  { value: 'EXPECTED_SUPPLY_RESERVATION', label: 'EXPECTED_SUPPLY_RESERVATION — 预计供给预留' },
];
const SCOPE_DIMENSIONS = [
  { value: 'CUSTOMER_PRODUCT', label: '客户 — 物料' },
  { value: 'SALESPERSON_PRODUCT', label: '销售员 — 物料' },
  { value: 'SALESPERSON_CUSTOMER', label: '销售员 — 客户' },
];
const SERVICE_KINDS = ['NON_SERVICE', 'INSTALLED', 'WARRANTY', 'SUBSCRIPTION', 'MAINTENANCE', 'OTHER'];

const SCOPE_LABELS = { SYSTEM: '系统级', DOCUMENT_TYPE: '单据类型级' };
const BOOL_LABELS = { true: '启用', false: '停用' };

function scopeLabel(parameter) {
  if (parameter.scopeType === 'SYSTEM') return '系统级（全部单据类型）';
  return `单据类型级 · ${parameter.documentType}`;
}

function scopeKeyLabel(parameter) {
  return parameter.scopeType === 'SYSTEM' ? 'SYSTEM' : `DOCUMENT_TYPE:${parameter.documentType}`;
}

function ErrorState({ error, retry }) {
  return <BusinessState kind="ERROR" description={error?.message} retry={retry} requestId={error?.requestId} />;
}

// A small hook for the "list + load + reload" shape every surface below
// shares. Errors are surfaced as real messages — never silently swallowed.
//
// The `pick` selector is held in a ref. A selector is an inline arrow
// function at every call site, so it must NOT take part in the identity of
// `load`: if it did, `load` would be a new function on every render, the
// effect below would re-fire on every render, and the surface would issue an
// unbounded stream of requests (the browser eventually refuses them with
// ERR_INSUFFICIENT_RESOURCES and the screen never settles).
function useResource(path, pick, { notify, enabled = true } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const load = useCallback(async () => {
    if (!enabled) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await api(path);
      const selector = pickRef.current;
      const next = selector ? selector(data) : data;
      setRows(Array.isArray(next) ? next : []);
      setError(null);
    } catch (cause) {
      setError(cause);
      setRows([]);
      notifyRef.current?.(cause.message || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [path, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, load, setRows };
}

// ---------------------------------------------------------------------------
// SC01 — Sales Parameters (SYSTEM / DOCUMENT_TYPE scopes)
// ---------------------------------------------------------------------------

const EMPTY_PARAMETER = {
  scopeType: 'SYSTEM',
  documentType: 'SALES_ORDER',
  sellableControlEnabled: true,
  customerMaterialXrefEnabled: true,
  salesGroupDataScopeEnabled: false,
  deliveryScheduleEnabled: true,
  deliveryQuantityControlEnabled: true,
  orderChangeMode: 'DISABLED',
  reservationBehavior: 'DISABLED',
  active: true,
};

function parameterToForm(parameter) {
  return {
    scopeType: parameter.scopeType,
    documentType: parameter.documentType || 'SALES_ORDER',
    sellableControlEnabled: parameter.sellableControlEnabled,
    customerMaterialXrefEnabled: parameter.customerMaterialXrefEnabled,
    salesGroupDataScopeEnabled: parameter.salesGroupDataScopeEnabled,
    deliveryScheduleEnabled: parameter.deliveryScheduleEnabled,
    deliveryQuantityControlEnabled: parameter.deliveryQuantityControlEnabled,
    orderChangeMode: parameter.orderChangeMode,
    reservationBehavior: parameter.reservationBehavior,
    active: parameter.active,
  };
}

function ParameterEditor({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => (value?.scopeKey ? parameterToForm(value) : { ...EMPTY_PARAMETER }));
  const [saving, setSaving] = useState(false);
  const editing = Boolean(value?.scopeKey);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        scopeType: form.scopeType,
        ...(form.scopeType === 'DOCUMENT_TYPE' ? { documentType: form.documentType } : {}),
        sellableControlEnabled: form.sellableControlEnabled,
        customerMaterialXrefEnabled: form.customerMaterialXrefEnabled,
        salesGroupDataScopeEnabled: form.salesGroupDataScopeEnabled,
        deliveryScheduleEnabled: form.deliveryScheduleEnabled,
        deliveryQuantityControlEnabled: form.deliveryQuantityControlEnabled,
        orderChangeMode: form.orderChangeMode,
        reservationBehavior: form.reservationBehavior,
        active: form.active,
      };
      const result = await api('/api/sales/parameters', { method: 'PUT', body });
      notify(editing ? '销售参数已更新' : '销售参数已保存');
      onSaved(result.parameter);
    } catch (cause) {
      notify(cause.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  const toggle = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.checked }));

  return (
    <Sheet title={editing ? `编辑销售参数 · ${scopeKeyLabel(value)}` : '新建销售参数'} onClose={onClose} className="sales-parameters-editor">
      <form className="sales-parameters-form" onSubmit={submit}>
        <div className="form-grid">
          <FormRow label="参数范围" required>
            <SelectField
              required
              value={form.scopeType}
              disabled={editing}
              onChange={(event) => setForm({ ...form, scopeType: event.target.value })}
            >
              <option value="SYSTEM">系统级（SYSTEM）</option>
              <option value="DOCUMENT_TYPE">单据类型级（DOCUMENT_TYPE）</option>
            </SelectField>
          </FormRow>
          {form.scopeType === 'DOCUMENT_TYPE' && (
            <FormRow label="单据类型" required hint="单据类型级行整体覆盖系统级行">
              <SelectField
                required
                value={form.documentType}
                disabled={editing}
                onChange={(event) => setForm({ ...form, documentType: event.target.value })}
              >
                {DOCUMENT_TYPES.map((code) => <option key={code} value={code}>{code}</option>)}
              </SelectField>
            </FormRow>
          )}
          <FormRow label="可售控制" hint="关闭后不再执行可销范围规则族；不影响 A-61 sales_enabled">
            <SelectField value={form.sellableControlEnabled ? 'true' : 'false'} onChange={(event) => setForm({ ...form, sellableControlEnabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
          <FormRow label="客户物料对应启用" hint="关闭后客户物料编码翻译不可用">
            <SelectField value={form.customerMaterialXrefEnabled ? 'true' : 'false'} onChange={(event) => setForm({ ...form, customerMaterialXrefEnabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
          <FormRow label="销售组数据范围" hint="TRUE 按登录→销售员→业务日期隔离；FALSE 不解释为全员可见">
            <SelectField value={form.salesGroupDataScopeEnabled ? 'true' : 'false'} onChange={(event) => setForm({ ...form, salesGroupDataScopeEnabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
          <FormRow label="交货计划控制" hint="关闭后携带计划交货日期的订单与交货通知被拒绝">
            <SelectField value={form.deliveryScheduleEnabled ? 'true' : 'false'} onChange={(event) => setForm({ ...form, deliveryScheduleEnabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
          <FormRow label="交货数量控制" hint="关闭后不再执行超交 / 欠交容差上限校验">
            <SelectField value={form.deliveryQuantityControlEnabled ? 'true' : 'false'} onChange={(event) => setForm({ ...form, deliveryQuantityControlEnabled: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
          <FormRow label="订单变更模式" required>
            <SelectField required value={form.orderChangeMode} onChange={(event) => setForm({ ...form, orderChangeMode: event.target.value })}>
              {ORDER_CHANGE_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
            </SelectField>
          </FormRow>
          <FormRow label="预留行为" required hint="DISABLED 时订单行不得发起预留">
            <SelectField required value={form.reservationBehavior} onChange={(event) => setForm({ ...form, reservationBehavior: event.target.value })}>
              {RESERVATION_BEHAVIORS.map((behavior) => <option key={behavior.value} value={behavior.value}>{behavior.label}</option>)}
            </SelectField>
          </FormRow>
          <FormRow label="参数行状态" required>
            <SelectField required value={form.active ? 'true' : 'false'} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
        </div>
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton disabled={saving}>{saving ? '保存中…' : '保存参数'}</PrimaryButton>
        </BottomActionBar>
      </form>
    </Sheet>
  );
}

function ParameterDetail({ parameter, user, notify, onBack, onEdit }) {
  const facts = [
    { label: '可售控制', value: BOOL_LABELS[String(parameter.sellableControlEnabled)] },
    { label: '客户物料对应', value: BOOL_LABELS[String(parameter.customerMaterialXrefEnabled)] },
    { label: '销售组数据范围', value: BOOL_LABELS[String(parameter.salesGroupDataScopeEnabled)] },
    { label: '交货计划控制', value: BOOL_LABELS[String(parameter.deliveryScheduleEnabled)] },
    { label: '交货数量控制', value: BOOL_LABELS[String(parameter.deliveryQuantityControlEnabled)] },
    { label: '订单变更模式', value: parameter.orderChangeMode },
    { label: '预留行为', value: parameter.reservationBehavior },
  ];
  return (
    <BusinessPageShell className="sales-parameters-detail" data-testid="sales-parameters-detail" width="rail">
      <BusinessPageHeader
        title={scopeKeyLabel(parameter)}
        context={scopeLabel(parameter)}
        status={parameter.active ? 'ACTIVE' : 'INACTIVE'}
        back={<button type="button" className="ghost" onClick={onBack}>返回参数列表</button>}
      />
      <DetailSection title="控制语义">
        <div className="detail-grid">
          {facts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}
        </div>
      </DetailSection>
      <DetailSection title="生效规则">
        <p className="muted">
          先读取精确生效的单据类型级行；存在时该行整体覆盖系统级行，否则使用唯一系统级行。
          缺少系统级行或单据类型非法时后端 fail closed。
        </p>
      </DetailSection>
      {can(user, 'SALES_PARAMETERS_MANAGE') && (
        <BottomActionBar>
          <PrimaryButton type="button" onClick={() => onEdit(parameter)}>编辑参数</PrimaryButton>
        </BottomActionBar>
      )}
      {!can(user, 'SALES_PARAMETERS_MANAGE') && (
        <p className="muted">当前账号没有 SALES_PARAMETERS_MANAGE 权限，只能查看参数。</p>
      )}
    </BusinessPageShell>
  );
}

export function SalesParameters({ user, notify }) {
  const navigation = useAppNavigation();
  const [selectedKey, setSelectedKey] = useState(null);
  const [editor, setEditor] = useState(null);
  const parameters = useResource('/api/sales/parameters', (data) => data.parameters, { notify });

  const selected = useMemo(
    () => parameters.rows.find((row) => row.scopeKey === selectedKey) || null,
    [parameters.rows, selectedKey],
  );

  useEffect(() => {
    if (!selectedKey && parameters.rows.length === 1) setSelectedKey(parameters.rows[0].scopeKey);
  }, [parameters.rows, selectedKey]);

  function select(key) {
    setSelectedKey(key);
    navigation.navigateToPage('sales-parameters', key ? { documentId: key } : null, { replace: !key });
  }

  if (selectedKey && selected) {
    return (
      <>
        <ParameterDetail
          parameter={selected}
          user={user}
          notify={notify}
          onBack={() => select(null)}
          onEdit={setEditor}
        />
        {editor && (
          <ParameterEditor
            value={editor}
            notify={notify}
            onClose={() => setEditor(null)}
            onSaved={(saved) => { setEditor(null); setSelectedKey(saved.scopeKey); void parameters.load(); }}
          />
        )}
      </>
    );
  }

  return (
    <BusinessPageShell className="sales-parameters-list" data-testid="sales-parameters-page" width="rail">
      <BusinessPageHeader
        title="销售参数"
        context="SC01 · 系统级与单据类型级控制语义"
        primaryAction={can(user, 'SALES_PARAMETERS_MANAGE')
          ? <PrimaryButton type="button" onClick={() => setEditor({})}>新建参数行</PrimaryButton>
          : null}
      />
      {parameters.error
        ? <ErrorState error={parameters.error} retry={parameters.load} />
        : parameters.loading
          ? <BusinessState kind="LOADING" />
          : !parameters.rows.length
            ? <BusinessState kind="EMPTY" title="暂无销售参数" description="系统级参数缺失时后端 fail closed，请先新建系统级参数行。" />
            : (
              <RecordList>
                {parameters.rows.map((row) => (
                  <RecordCard
                    key={row.scopeKey}
                    title={scopeKeyLabel(row)}
                    subtitle={scopeLabel(row)}
                    status={<StatusChip status={row.active ? 'ACTIVE' : 'INACTIVE'}>{row.active ? '启用' : '停用'}</StatusChip>}
                    facts={[
                      { label: '交货计划控制', value: BOOL_LABELS[String(row.deliveryScheduleEnabled)] },
                      { label: '交货数量控制', value: BOOL_LABELS[String(row.deliveryQuantityControlEnabled)] },
                      { label: '预留行为', value: row.reservationBehavior },
                      { label: '订单变更模式', value: row.orderChangeMode },
                    ]}
                    onClick={() => select(row.scopeKey)}
                  />
                ))}
              </RecordList>
            )}
      {editor && (
        <ParameterEditor
          value={editor}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={(saved) => { setEditor(null); setSelectedKey(saved.scopeKey); void parameters.load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

// ---------------------------------------------------------------------------
// SC06 — Sales Group memberships (exactly one effective default per person)
// ---------------------------------------------------------------------------

function MembershipEditor({ value, people, groups, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    salespersonId: value?.salespersonId || '',
    salesGroupId: value?.salesGroupId || '',
    isDefault: value?.isDefault ?? true,
    active: value?.active ?? true,
    effectiveFrom: value?.effectiveFrom || today(),
    effectiveTo: value?.effectiveTo || '',
    replaceDefault: false,
  }));
  const [saving, setSaving] = useState(false);
  const editing = Boolean(value?.id);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        salespersonId: form.salespersonId,
        salesGroupId: form.salesGroupId,
        isDefault: form.isDefault,
        active: form.active,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
      };
      if (form.isDefault) body.replaceDefault = true;
      const path = editing ? `/api/sales/memberships/${value.id}` : '/api/sales/memberships';
      const result = await api(path, { method: editing ? 'PATCH' : 'POST', body });
      notify(editing ? '成员关系已更新' : '成员关系已创建');
      onSaved(result.membership);
    } catch (cause) {
      notify(cause.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={editing ? '编辑销售组成员关系' : '新建销售组成员关系'} onClose={onClose} className="sales-memberships-editor">
      <form className="sales-parameters-form" onSubmit={submit}>
        <div className="form-grid">
          <FormRow label="销售员" required>
            <SelectField required value={form.salespersonId} disabled={editing} onChange={(event) => setForm({ ...form, salespersonId: event.target.value })}>
              <option value="">请选择销售员</option>
              {people.map((person) => <option key={person.id} value={person.id}>{person.salesperson_code} · {person.name}</option>)}
            </SelectField>
          </FormRow>
          <FormRow label="销售组" required>
            <SelectField required value={form.salesGroupId} disabled={editing} onChange={(event) => setForm({ ...form, salesGroupId: event.target.value })}>
              <option value="">请选择销售组</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.group_code} · {group.name}</option>)}
            </SelectField>
          </FormRow>
          <FormRow label="生效日期" required>
            <DateField required value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} />
          </FormRow>
          <FormRow label="失效日期" hint="留空表示长期有效">
            <DateField value={form.effectiveTo || ''} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} />
          </FormRow>
          <FormRow label="是否默认组" required hint="同一销售员在同一生效日必须恰有一个默认组">
            <SelectField required value={form.isDefault ? 'true' : 'false'} onChange={(event) => setForm({ ...form, isDefault: event.target.value === 'true' })}>
              <option value="true">默认组</option>
              <option value="false">非默认组</option>
            </SelectField>
          </FormRow>
          <FormRow label="成员关系状态" required>
            <SelectField required value={form.active ? 'true' : 'false'} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
        </div>
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton disabled={saving}>{saving ? '保存中…' : '保存成员关系'}</PrimaryButton>
        </BottomActionBar>
      </form>
    </Sheet>
  );
}

export function SalesGroupMemberships({ user, notify }) {
  const [salespersonId, setSalespersonId] = useState('');
  const [people, setPeople] = useState([]);
  const [groups, setGroups] = useState([]);
  const [editor, setEditor] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    Promise.all([api('/api/sales/salespersons'), api('/api/sales/groups')])
      .then(([peopleResult, groupResult]) => {
        setPeople(peopleResult.salespersons || []);
        setGroups(groupResult.salesGroups || []);
      })
      .catch((cause) => notify(cause.message || '加载销售员与销售组失败', 'error'));
  }, [notify]);

  const memberships = useResource(
    salespersonId ? `/api/sales/memberships?salespersonId=${encodeURIComponent(salespersonId)}` : null,
    (data) => data.memberships,
    { notify, enabled: Boolean(salespersonId) },
  );

  useEffect(() => { void memberships.load(); }, [reloadToken, memberships.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = memberships.rows.filter((row) => row.active).length;
  const defaultCount = memberships.rows.filter((row) => row.active && row.isDefault).length;

  return (
    <BusinessPageShell className="sales-memberships-list" data-testid="sales-group-memberships-page" width="rail">
      <BusinessPageHeader
        title="销售组成员关系"
        context="SC06 · 多组归属与唯一默认组"
        primaryAction={can(user, 'SALES_FOUNDATION_MANAGE') && salespersonId
          ? <PrimaryButton type="button" onClick={() => setEditor({})}>新建成员关系</PrimaryButton>
          : null}
      />
      <BusinessContentSection title="选择销售员" description="成员关系按销售员查询；先选择销售员再维护归属。">
        <FormRow label="销售员" required>
          <SelectField required value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)}>
            <option value="">请选择销售员</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.salesperson_code} · {person.name}</option>)}
          </SelectField>
        </FormRow>
      </BusinessContentSection>
      {!salespersonId ? (
        <BusinessState kind="EMPTY" title="请先选择销售员" description="成员关系以销售员为锚点，需先选择一名销售员。" />
      ) : memberships.error ? (
        <ErrorState error={memberships.error} retry={memberships.load} />
      ) : memberships.loading ? (
        <BusinessState kind="LOADING" />
      ) : !memberships.rows.length ? (
        <BusinessState kind="EMPTY" title="该销售员暂无成员关系" description="没有有效成员关系时不得创建或处理组范围新单据。" />
      ) : (
        <>
          <BusinessContentSection title="默认组合同" description="恰有一个有效成员关系时该成员关系必须为默认；多个有效成员关系时必须恰有一个默认。">
            <div className="detail-grid">
              <div><span>有效成员关系</span><strong>{activeCount}</strong></div>
              <div><span>其中默认组</span><strong>{defaultCount}</strong></div>
              <div><span>合同结论</span><strong>{activeCount === 0 ? '零默认（不得建组范围单据）' : defaultCount === 1 ? '满足唯一默认' : '违反唯一默认'}</strong></div>
            </div>
          </BusinessContentSection>
          <RecordList>
            {memberships.rows.map((row) => (
              <RecordCard
                key={row.id}
                title={row.salesGroupName || row.salesGroupId}
                subtitle={`${row.salespersonName || row.salespersonId} · ${row.effectiveFrom || '起'} → ${row.effectiveTo || '∞'}`}
                status={<StatusChip status={row.active ? 'ACTIVE' : 'INACTIVE'}>{row.active ? '有效' : '停用'}</StatusChip>}
                facts={[
                  { label: '默认组', value: row.isDefault ? '是' : '否' },
                  { label: '销售组 ID', value: row.salesGroupId },
                ]}
              >
                {can(user, 'SALES_FOUNDATION_MANAGE') && (
                  <BottomActionBar>
                    <SecondaryButton type="button" onClick={() => setEditor(row)}>编辑成员关系</SecondaryButton>
                  </BottomActionBar>
                )}
              </RecordCard>
            ))}
          </RecordList>
        </>
      )}
      {editor && (
        <MembershipEditor
          value={editor}
          people={people}
          groups={groups}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); setReloadToken((token) => token + 1); }}
        />
      )}
    </BusinessPageShell>
  );
}

// ---------------------------------------------------------------------------
// SC07 — Sellable scope rules
// ---------------------------------------------------------------------------

function SellableRuleEditor({ value, onClose, onSaved, notify, references }) {
  const [form, setForm] = useState(() => ({
    scopeDimension: value?.scopeDimension || 'CUSTOMER_PRODUCT',
    customerId: value?.customerId || '',
    salespersonId: value?.salespersonId || '',
    productId: value?.productId || '',
    effect: value?.effect || 'ALLOW',
    effectiveFrom: value?.effectiveFrom || today(),
    effectiveTo: value?.effectiveTo || '',
    active: value?.active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const editing = Boolean(value?.id);

  const needsCustomer = form.scopeDimension === 'CUSTOMER_PRODUCT' || form.scopeDimension === 'SALESPERSON_CUSTOMER';
  const needsSalesperson = form.scopeDimension === 'SALESPERSON_PRODUCT' || form.scopeDimension === 'SALESPERSON_CUSTOMER';
  const needsProduct = form.scopeDimension === 'CUSTOMER_PRODUCT' || form.scopeDimension === 'SALESPERSON_PRODUCT';

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        scopeDimension: form.scopeDimension,
        customerId: needsCustomer ? form.customerId : null,
        salespersonId: needsSalesperson ? form.salespersonId : null,
        productId: needsProduct ? form.productId : null,
        effect: form.effect,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        active: form.active,
      };
      const path = editing ? `/api/sales/sellable-scope-rules/${value.id}` : '/api/sales/sellable-scope-rules';
      const result = await api(path, { method: editing ? 'PATCH' : 'POST', body });
      notify(editing ? '可销范围规则已更新' : '可销范围规则已创建');
      onSaved(result.rule);
    } catch (cause) {
      notify(cause.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={editing ? '编辑可销范围规则' : '新建可销范围规则'} onClose={onClose} className="sales-sellable-editor">
      <form className="sales-parameters-form" onSubmit={submit}>
        <div className="form-grid">
          <FormRow label="规则维度" required>
            <SelectField required value={form.scopeDimension} disabled={editing} onChange={(event) => setForm({ ...form, scopeDimension: event.target.value })}>
              {SCOPE_DIMENSIONS.map((dimension) => <option key={dimension.value} value={dimension.value}>{dimension.label}</option>)}
            </SelectField>
          </FormRow>
          <FormRow label="效果" required hint="DENY 优先于 ALLOW；参数关闭只停用对应规则族">
            <SelectField required value={form.effect} onChange={(event) => setForm({ ...form, effect: event.target.value })}>
              <option value="ALLOW">ALLOW — 允许</option>
              <option value="DENY">DENY — 拒绝</option>
            </SelectField>
          </FormRow>
          {needsCustomer && (
            <FormRow label="客户" required>
              <SelectField required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
                <option value="">请选择客户</option>
                {references.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}
              </SelectField>
            </FormRow>
          )}
          {needsSalesperson && (
            <FormRow label="销售员" required>
              <SelectField required value={form.salespersonId} onChange={(event) => setForm({ ...form, salespersonId: event.target.value })}>
                <option value="">请选择销售员</option>
                {references.salespersons.map((person) => <option key={person.id} value={person.id}>{person.salesperson_code} · {person.name}</option>)}
              </SelectField>
            </FormRow>
          )}
          {needsProduct && (
            <FormRow label="物料" required>
              <SelectField required value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
                <option value="">请选择物料</option>
                {references.products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}
              </SelectField>
            </FormRow>
          )}
          <FormRow label="生效日期" required>
            <DateField required value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} />
          </FormRow>
          <FormRow label="失效日期" hint="留空表示长期有效；同维度同效果的有效期不得重叠">
            <DateField value={form.effectiveTo || ''} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value })} />
          </FormRow>
          <FormRow label="规则状态" required>
            <SelectField required value={form.active ? 'true' : 'false'} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
        </div>
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton disabled={saving}>{saving ? '保存中…' : '保存规则'}</PrimaryButton>
        </BottomActionBar>
      </form>
    </Sheet>
  );
}

function ruleSubject(rule) {
  if (rule.scopeDimension === 'CUSTOMER_PRODUCT') return `客户 ${rule.customerId || '—'} × 物料 ${rule.productId || '—'}`;
  if (rule.scopeDimension === 'SALESPERSON_PRODUCT') return `销售员 ${rule.salespersonId || '—'} × 物料 ${rule.productId || '—'}`;
  return `销售员 ${rule.salespersonId || '—'} × 客户 ${rule.customerId || '—'}`;
}

export function SellableScopeRules({ user, notify }) {
  const [references, setReferences] = useState({ customers: [], salespersons: [], products: [] });
  const [editor, setEditor] = useState(null);
  const rules = useResource('/api/sales/sellable-scope-rules', (data) => data.rules, { notify });

  useEffect(() => {
    Promise.all([api('/api/customers'), api('/api/sales/salespersons'), api('/api/products')])
      .then(([customers, salespersons, products]) => setReferences({
        customers: customers.customers || [],
        salespersons: salespersons.salespersons || [],
        products: products.products || [],
      }))
      .catch((cause) => notify(cause.message || '加载可销范围参照数据失败', 'error'));
  }, [notify]);

  return (
    <BusinessPageShell className="sales-sellable-list" data-testid="sellable-scope-rules-page" width="rail">
      <BusinessPageHeader
        title="可销范围规则"
        context="SC07 · 客户 / 销售员 / 物料三个维度的 ALLOW / DENY"
        primaryAction={can(user, 'SALES_COMMERCIAL_MANAGE')
          ? <PrimaryButton type="button" onClick={() => setEditor({})}>新建规则</PrimaryButton>
          : null}
      />
      {rules.error
        ? <ErrorState error={rules.error} retry={rules.load} />
        : rules.loading
          ? <BusinessState kind="LOADING" />
          : !rules.rows.length
            ? <BusinessState kind="EMPTY" title="暂无可销范围规则" description="未配置规则时由客户的 sellable_scope_mode 决定是否执行范围控制。" />
            : (
              <RecordList>
                {rules.rows.map((rule) => (
                  <RecordCard
                    key={rule.id}
                    title={ruleSubject(rule)}
                    subtitle={`${rule.scopeDimension} · ${rule.effectiveFrom || '起'} → ${rule.effectiveTo || '∞'}`}
                    status={<StatusChip status={rule.active ? 'ACTIVE' : 'INACTIVE'}>{rule.effect === 'DENY' ? '拒绝' : '允许'}</StatusChip>}
                    facts={[
                      { label: '维度', value: rule.scopeDimension },
                      { label: '效果', value: rule.effect },
                      { label: '客户', value: rule.customerId || '—' },
                      { label: '销售员', value: rule.salespersonId || '—' },
                      { label: '物料', value: rule.productId || '—' },
                      { label: '生效区间', value: `${rule.effectiveFrom || '起'} → ${rule.effectiveTo || '∞'}` },
                    ]}
                  >
                    {can(user, 'SALES_COMMERCIAL_MANAGE') && (
                      <BottomActionBar>
                        <SecondaryButton type="button" onClick={() => setEditor(rule)}>编辑规则</SecondaryButton>
                      </BottomActionBar>
                    )}
                  </RecordCard>
                ))}
              </RecordList>
            )}
      {editor && (
        <SellableRuleEditor
          value={editor}
          references={references}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void rules.load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

// ---------------------------------------------------------------------------
// SC08 / A-61 — Product commercial classification
// ---------------------------------------------------------------------------

function ClassificationEditor({ value, products, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({
    productId: value?.productId || '',
    salesEnabled: value?.salesEnabled ?? true,
    salesUomCode: value?.salesUomCode || '',
    pricingUomCode: value?.pricingUomCode || '',
    defaultUpperDeliveryToleranceBps: String(value?.defaultUpperDeliveryToleranceBps ?? 0),
    defaultLowerDeliveryToleranceBps: String(value?.defaultLowerDeliveryToleranceBps ?? 0),
    serviceClassification: value?.serviceClassification ?? false,
    serviceKind: value?.serviceKind || '',
    active: value?.active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const editing = Boolean(value?.id);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        productId: form.productId,
        salesEnabled: form.salesEnabled,
        salesUomCode: form.salesUomCode || null,
        pricingUomCode: form.pricingUomCode || null,
        defaultUpperDeliveryToleranceBps: Number(form.defaultUpperDeliveryToleranceBps || 0),
        defaultLowerDeliveryToleranceBps: Number(form.defaultLowerDeliveryToleranceBps || 0),
        serviceClassification: form.serviceClassification,
        serviceKind: form.serviceClassification ? (form.serviceKind || 'NON_SERVICE') : null,
        active: form.active,
      };
      const result = await api('/api/sales/product-classifications', { method: 'PUT', body });
      notify(editing ? '产品商业分类已更新' : '产品商业分类已保存');
      onSaved(result.classification);
    } catch (cause) {
      notify(cause.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title={editing ? '编辑产品商业分类' : '新建产品商业分类'} onClose={onClose} className="sales-classification-editor">
      <form className="sales-parameters-form" onSubmit={submit}>
        <div className="form-grid">
          <FormRow label="物料" required hint="分类是当前快照；缺失分类不得隐式等同于可售">
            <SelectField required value={form.productId} disabled={editing} onChange={(event) => setForm({ ...form, productId: event.target.value })}>
              <option value="">请选择物料</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}
            </SelectField>
          </FormRow>
          <FormRow label="可售" required hint="关闭后任何新报价 / 订单 / 价格 / 预留 / 交付写入均被拒绝">
            <SelectField required value={form.salesEnabled ? 'true' : 'false'} onChange={(event) => setForm({ ...form, salesEnabled: event.target.value === 'true' })}>
              <option value="true">可售</option>
              <option value="false">禁售</option>
            </SelectField>
          </FormRow>
          <FormRow label="销售单位" hint="留空表示沿用 Master canonical 基本单位">
            <TextField value={form.salesUomCode} onChange={(event) => setForm({ ...form, salesUomCode: event.target.value.toUpperCase() })} />
          </FormRow>
          <FormRow label="计价单位" hint="缺少 canonical conversion 时后端拒绝">
            <TextField value={form.pricingUomCode} onChange={(event) => setForm({ ...form, pricingUomCode: event.target.value.toUpperCase() })} />
          </FormRow>
          <FormRow label="超交容差（基点）" required hint="10000 基点 = 100%">
            <TextField required inputMode="numeric" value={form.defaultUpperDeliveryToleranceBps} onChange={(event) => setForm({ ...form, defaultUpperDeliveryToleranceBps: event.target.value })} />
          </FormRow>
          <FormRow label="欠交容差（基点）" required hint="0 – 10000 整数基点">
            <TextField required inputMode="numeric" value={form.defaultLowerDeliveryToleranceBps} onChange={(event) => setForm({ ...form, defaultLowerDeliveryToleranceBps: event.target.value })} />
          </FormRow>
          <FormRow label="服务分类" required>
            <SelectField required value={form.serviceClassification ? 'true' : 'false'} onChange={(event) => setForm({ ...form, serviceClassification: event.target.value === 'true' })}>
              <option value="false">非服务物料</option>
              <option value="true">服务物料</option>
            </SelectField>
          </FormRow>
          {form.serviceClassification && (
            <FormRow label="服务类型" required>
              <SelectField required value={form.serviceKind || 'NON_SERVICE'} onChange={(event) => setForm({ ...form, serviceKind: event.target.value })}>
                {SERVICE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </SelectField>
            </FormRow>
          )}
          <FormRow label="分类状态" required>
            <SelectField required value={form.active ? 'true' : 'false'} onChange={(event) => setForm({ ...form, active: event.target.value === 'true' })}>
              <option value="true">启用</option>
              <option value="false">停用</option>
            </SelectField>
          </FormRow>
        </div>
        <BottomActionBar>
          <SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton>
          <PrimaryButton disabled={saving}>{saving ? '保存中…' : '保存分类'}</PrimaryButton>
        </BottomActionBar>
      </form>
    </Sheet>
  );
}

export function ProductClassifications({ user, notify }) {
  const [products, setProducts] = useState([]);
  const [editor, setEditor] = useState(null);
  const classifications = useResource('/api/sales/product-classifications', (data) => data.classifications, { notify });

  useEffect(() => {
    api('/api/products')
      .then((result) => setProducts(result.products || []))
      .catch((cause) => notify(cause.message || '加载物料失败', 'error'));
  }, [notify]);

  return (
    <BusinessPageShell className="sales-classification-list" data-testid="product-classifications-page" width="rail">
      <BusinessPageHeader
        title="产品商业分类"
        context="SC08 · 可售 / 服务 / 销售与计价单位 / 交货容差默认值"
        primaryAction={can(user, 'SALES_COMMERCIAL_MANAGE')
          ? <PrimaryButton type="button" onClick={() => setEditor({})}>新建分类</PrimaryButton>
          : null}
      />
      {classifications.error
        ? <ErrorState error={classifications.error} retry={classifications.load} />
        : classifications.loading
          ? <BusinessState kind="LOADING" />
          : !classifications.rows.length
            ? <BusinessState kind="EMPTY" title="暂无产品商业分类" description="未分类物料在新的报价 / 订单写入时 fail closed，历史只读显示为未分类。" />
            : (
              <RecordList>
                {classifications.rows.map((row) => (
                  <RecordCard
                    key={row.id}
                    title={row.productCode || row.productId}
                    subtitle={row.productName || '—'}
                    status={<StatusChip status={row.active ? 'ACTIVE' : 'INACTIVE'}>{row.salesEnabled ? '可售' : '禁售'}</StatusChip>}
                    facts={[
                      { label: '销售单位', value: row.salesUomCode || '—' },
                      { label: '计价单位', value: row.pricingUomCode || '—' },
                      { label: '超交容差', value: `${row.defaultUpperDeliveryToleranceBps ?? 0} 基点` },
                      { label: '欠交容差', value: `${row.defaultLowerDeliveryToleranceBps ?? 0} 基点` },
                      { label: '服务分类', value: row.serviceClassification ? (row.serviceKind || '—') : '非服务物料' },
                      { label: '分类状态', value: row.active ? '启用' : '停用' },
                    ]}
                  >
                    {can(user, 'SALES_COMMERCIAL_MANAGE') && (
                      <BottomActionBar>
                        <SecondaryButton type="button" onClick={() => setEditor(row)}>编辑分类</SecondaryButton>
                      </BottomActionBar>
                    )}
                  </RecordCard>
                ))}
              </RecordList>
            )}
      {editor && (
        <ClassificationEditor
          value={editor}
          products={products}
          notify={notify}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void classifications.load(); }}
        />
      )}
    </BusinessPageShell>
  );
}

// ---------------------------------------------------------------------------
// SC19 — Manual price override authorisation
//
// The backend `POST /api/sales-price-overrides/authorize` issues a one-shot
// authorisation id that a sales order line may then reference through
// `priceOverrideAuthorizationId`. Before this surface the authorisation was
// unobtainable from the UI, which made SC19's "separate authority" contract
// unusable in practice (audit defect SC-DEF-07).
// ---------------------------------------------------------------------------

export function PriceOverrideAuthorizations({ user, notify }) {
  const [references, setReferences] = useState({ customers: [], products: [] });
  const [form, setForm] = useState({
    customerId: '',
    productId: '',
    uomCode: '',
    quantityDecimal: '1',
    manualPriceCents: '',
    overrideReason: '',
    businessDate: today(),
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api('/api/customers'), api('/api/products')])
      .then(([customers, products]) => setReferences({
        customers: customers.customers || [],
        products: products.products || [],
      }))
      .catch((cause) => notify(cause.message || '加载参照数据失败', 'error'));
  }, [notify]);

  const canAuthorize = can(user, 'SALES_PRICING_OVERRIDE');

  async function submit(event) {
    event.preventDefault();
    if (!form.customerId || !form.productId || !form.manualPriceCents || !form.overrideReason.trim()) {
      notify('请填写客户、物料、手工单价与覆盖原因', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = await api('/api/sales-price-overrides/authorize', {
        method: 'POST',
        body: {
          customerId: form.customerId,
          productId: form.productId,
          uomCode: form.uomCode || undefined,
          quantityDecimal: Number(form.quantityDecimal || 0),
          manualPriceCents: Number(form.manualPriceCents),
          overrideReason: form.overrideReason.trim(),
          businessDate: form.businessDate,
        },
      });
      setResult(payload);
      notify('价格覆盖授权已签发');
    } catch (cause) {
      notify(cause.message || '签发失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BusinessPageShell className="sales-price-override" data-testid="sales-price-override-authorizations-page" width="rail">
      <BusinessPageHeader
        title="价格覆盖授权"
        context="SC19 · 手工价格覆盖的独立授权"
        primaryAction={canAuthorize
          ? <PrimaryButton type="button" disabled={busy} onClick={submit}>签发授权</PrimaryButton>
          : null}
      />
      {!canAuthorize && (
        <BusinessContentSection title="权限">
          <p className="muted">当前账号没有 SALES_PRICING_OVERRIDE 权限，无法签发价格覆盖授权。</p>
        </BusinessContentSection>
      )}
      <BusinessContentSection title="授权申请" description="授权是一次性的；签发后在销售订单行上使用授权 ID 提交手工价格。">
        <form className="sales-parameters-form" onSubmit={submit}>
          <div className="form-grid">
            <FormRow label="客户" required>
              <SelectField required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}>
                <option value="">请选择客户</option>
                {references.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}
              </SelectField>
            </FormRow>
            <FormRow label="物料" required>
              <SelectField
                required
                value={form.productId}
                onChange={(event) => {
                  const product = references.products.find((item) => item.id === event.target.value);
                  setForm({ ...form, productId: event.target.value, uomCode: product?.baseUomCode || product?.base_uom_code || form.uomCode });
                }}
              >
                <option value="">请选择物料</option>
                {references.products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}
              </SelectField>
            </FormRow>
            <FormRow label="单位" hint="留空使用物料 canonical 基本单位">
              <TextField value={form.uomCode} onChange={(event) => setForm({ ...form, uomCode: event.target.value.toUpperCase() })} />
            </FormRow>
            <FormRow label="数量" required>
              <TextField required inputMode="decimal" value={form.quantityDecimal} onChange={(event) => setForm({ ...form, quantityDecimal: event.target.value })} />
            </FormRow>
            <FormRow label="手工单价（分）" required hint="以安全整数分提交">
              <TextField required inputMode="numeric" value={form.manualPriceCents} onChange={(event) => setForm({ ...form, manualPriceCents: event.target.value })} />
            </FormRow>
            <FormRow label="覆盖原因" required>
              <TextArea required value={form.overrideReason} onChange={(event) => setForm({ ...form, overrideReason: event.target.value })} />
            </FormRow>
            <FormRow label="业务日期" required>
              <DateField required value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} />
            </FormRow>
          </div>
          {canAuthorize && (
            <BottomActionBar>
              <PrimaryButton type="submit" disabled={busy}>{busy ? '签发中…' : '签发价格覆盖授权'}</PrimaryButton>
            </BottomActionBar>
          )}
        </form>
      </BusinessContentSection>
      {result && (
        <DetailSection title="已签发授权">
          <div className="detail-grid">
            <div><span>授权 ID</span><strong><code>{result.authorizationId}</code></strong></div>
            <div><span>物料</span><strong>{result.materialId}</strong></div>
            <div><span>单位</span><strong>{result.uomCode || '—'}</strong></div>
            <div><span>业务日期</span><strong>{result.businessDate}</strong></div>
            <div><span>手工单价（分）</span><strong>{result.manualPriceCents ?? '—'}</strong></div>
          </div>
          <p className="muted">在销售订单行提交时使用上面的授权 ID 即可引用该覆盖授权。</p>
        </DetailSection>
      )}
    </BusinessPageShell>
  );
}

export default { SalesParameters, SalesGroupMemberships, SellableScopeRules, ProductClassifications, PriceOverrideAuthorizations };
