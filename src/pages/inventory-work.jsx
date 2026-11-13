// V24 — Inventory & Warehouse mobile work surfaces.
//
// Contract: docs/requirements/inventory-warehouse.md §32.3 (INV-01..INV-44)
//          docs/design/inventory-warehouse.md §27.47 (UI Information Architecture)
//          docs/requirements/manufacturing-quality.md §29.8 A.2 (touch target /
//          real-data judgement standard, applied identically here).
//
// Every surface below is LIST → DETAIL → EDITOR / WORKFLOW and is backed by a
// real API call. No surface accepts a bare identifier as its only input: the
// source object is always chosen from a real list (warehouse, product, bin,
// lot, container, rule, ...).
//
// The house style comes from src/components/ui.jsx + src/components/design-system.jsx;
// `can(user, 'PERMISSION')` gates every mutation and `notify(message, 'error')`
// reports every failure.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  Active, ConfirmDelete, Empty, FormActions, Loading, Modal, Panel, Toolbar, can, dateTime, quantity,
} from '../components/ui.jsx';
import {
  BottomActionBar,
  BusinessPageHeader,
  BusinessPageShell,
  CompactRecord,
  CompactRecordList,
  ConfirmSheet,
  DangerSheet,
  EmptyState,
  FilterButton,
  FilterSheet,
  InlineAlert,
  SearchField,
  SegmentedControl,
  StatusChip,
} from '../components/design-system.jsx';
import { Icon } from '../components/icons.jsx';
import TrackingAllocationEditor from '../components/TrackingAllocationEditor.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { withProductTracking } from '../lib/tracking.js';

const todayIso = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function useInventoryResource(path, { notify, pick, deps = [] } = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api(path)
      .then((data) => setRows(Array.isArray(pick ? pick(data) : data) ? (pick ? pick(data) : data) : []))
      .catch((e) => { setError(e.message || '加载失败'); notify?.(e.message || '加载失败', 'error'); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, notify, ...deps]);
  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, load, setRows };
}

function InventoryWorkState({ loading, error, empty, onRetry, children }) {
  if (loading) return <Loading />;
  if (error) return <EmptyState title="加载失败" description={error} action={<button type="button" className="secondary" onClick={onRetry}>重试</button>} />;
  if (empty) return <EmptyState title="暂无记录" description="当前筛选条件下没有可显示的数据。" />;
  return children;
}

// A work-surface tab body: title + toolbar + real list.
function InventoryWorkSection({ title, description, actions, children }) {
  return (
    <section className="inv-work-section">
      <header className="inv-work-section__head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function InventoryWorkRow({ code, title, status, lines = [], metric, onClick, onEdit }) {
  return (
    <article className="inv-work-row">
      <button type="button" className="inv-work-row__main" onClick={onClick}>
        <span className="inv-work-row__body">
          <span className="inv-work-row__top">
            <b className="mono">{code || '—'}</b>
            {status}
          </span>
          <strong>{title}</strong>
          {lines.filter(Boolean).map((line, index) => <small key={index}>{line}</small>)}
          {metric && <b className="inv-work-row__metric">{metric}</b>}
        </span>
      </button>
      {onEdit && <div className="inv-work-row__actions">{onEdit}</div>}
    </article>
  );
}

function InventoryWorkFacts({ facts }) {
  return <dl className="inv-work-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? '—'}</dd></div>)}</dl>;
}

function InventoryWorkEditorShell({ title, onSubmit, submitLabel = '保存', children }) {
  return (
    <BusinessPageShell className="inv-work inv-work--editor" width="rail">
      <BusinessPageHeader title={title} />
      <form onSubmit={onSubmit} className="inv-work-form">
        {children}
        <BottomActionBar>
          <button type="submit" className="primary">{submitLabel}</button>
        </BottomActionBar>
      </form>
    </BusinessPageShell>
  );
}

// Select control whose option list comes from a real API resource.
function InventoryWorkSelect({ label, value, onChange, options, placeholder = '请选择', required, disabled }) {
  return (
    <label className="inv-work-field">
      <span>{label}</span>
      <select required={required} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function InventoryWorkInput({ label, value, onChange, type = 'text', ...rest }) {
  return (
    <label className="inv-work-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </label>
  );
}

function InventoryWorkTextarea({ label, value, onChange, ...rest }) {
  return (
    <label className="inv-work-field">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} {...rest} />
    </label>
  );
}

function InventoryWorkCheckbox({ label, checked, onChange }) {
  return (
    <label className="inv-work-check">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Reference data shared by several surfaces (warehouses / products / bins /
// stock statuses). Loaded once by the hub and handed down so that every
// editor offers a real source object instead of a bare id text box.
// ---------------------------------------------------------------------------

function useInventoryReferences(notify) {
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [stockStatuses, setStockStatuses] = useState([]);
  const [bins, setBins] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    Promise.all([
      api('/api/warehouses').catch(() => ({ warehouses: [] })),
      api('/api/products').catch(() => ({ products: [] })),
      api('/api/inventory-stock-statuses').catch(() => ({ stockStatuses: [] })),
      api('/api/warehouse-bins').catch(() => ({ bins: [] })),
    ]).then(([w, p, s, b]) => {
      setWarehouses((w.warehouses || []).filter((x) => x.active !== false));
      setProducts((p.products || []).filter((x) => x.active !== false));
      setStockStatuses(s.stockStatuses || []);
      setBins(b.bins || []);
      setLoaded(true);
    }).catch((e) => notify?.(e.message || '基础数据加载失败', 'error'));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  return { warehouses, products, stockStatuses, bins, loaded, reloadReferences: load };
}

const warehouseOptions = (warehouses) => warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));
const productOptions = (products) => products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }));
const statusOptions = (stockStatuses) => stockStatuses.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }));

// ---------------------------------------------------------------------------
// INV-27 — 即时库存 (instant query)
// ---------------------------------------------------------------------------

const INSTANT_FILTER_KEYS = [
  ['warehouseId', '仓库'],
  ['productId', '货品'],
  ['binId', '仓位'],
  ['ownerType', '所有权'],
  ['ownerId', '所有权对象'],
  ['stockStatus', '库存状态'],
  ['lotId', '批号'],
  ['serialId', '序列号'],
];

const OWNER_TYPE_OPTIONS = [
  { value: 'ENTERPRISE', label: 'ENTERPRISE · 企业自有' },
  { value: 'SUPPLIER', label: 'SUPPLIER · 供应商（VMI）' },
  { value: 'CUSTOMER', label: 'CUSTOMER · 客户（受托料）' },
];

export function InventoryInstantQuery({ user, notify, references }) {
  const { warehouses, products, stockStatuses, bins } = references;
  const [filters, setFilters] = useState({ warehouseId: '', productId: '', binId: '', ownerType: '', ownerId: '', stockStatus: '', lotId: '', serialId: '' });
  const [draft, setDraft] = useState(filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [summary, setSummary] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }, [filters]);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api(`/api/inventory/instant-query${query ? `?${query}` : ''}`)
      .then((data) => {
        setSummary(Array.isArray(data.summary) ? data.summary : []);
        setPositions(Array.isArray(data.positions) ? data.positions : []);
      })
      .catch((e) => { setError(e.message || '即时库存查询失败'); notify(e.message || '即时库存查询失败', 'error'); })
      .finally(() => setLoading(false));
  }, [query, notify]);

  useEffect(() => { void load(); }, [load]);

  const activeCount = Object.values(filters).filter(Boolean).length;
  const warehouseName = (id) => warehouses.find((w) => w.id === id)?.name || id || '—';
  const productName = (id) => products.find((p) => p.id === id)?.name || id || '—';

  return (
    <>
      <InventoryWorkSection
        title="即时库存查询"
        description="按仓库 / 货品 / 仓位 / 所有权 / 库存状态 / 批号 / 序列号查询汇总与库存位置。"
        actions={(
          <div className="inv-work-tools">
            <SearchField value="" onChange={() => {}} placeholder="按汇总行筛选" />
            <FilterButton activeCount={activeCount} onClick={() => { setDraft(filters); setFilterOpen(true); }}>筛选</FilterButton>
          </div>
        )}
      >
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!summary.length && !positions.length}>
          {Boolean(summary.length) && (
            <div className="inv-work-subsection">
              <h4>库存汇总（按仓库 × 货品）</h4>
              <div className="inv-work-list">
                {summary.map((row) => (
                  <InventoryWorkRow
                    key={`${row.warehouseId}-${row.productId}`}
                    code={row.productId}
                    title={`${productName(row.productId)} · ${warehouseName(row.warehouseId)}`}
                    lines={[
                      `库存位置 ${row.positionCount} 个`,
                      `可用 ${quantity(row.availableQuantity)}`,
                      `企业自有 ${quantity(row.enterpriseOwnedQuantity)}`,
                      `供应商 ${quantity(row.supplierOwnedQuantity)}`,
                      `客户 ${quantity(row.customerOwnedQuantity)}`,
                    ]}
                    metric={`${quantity(row.totalQuantity)} 在库`}
                  />
                ))}
              </div>
            </div>
          )}
          {Boolean(positions.length) && (
            <div className="inv-work-subsection">
              <h4>库存位置明细</h4>
              <div className="inv-work-list">
                {positions.map((row) => (
                  <InventoryWorkRow
                    key={row.id || row.positionKey}
                    code={row.positionKey}
                    title={`${productName(row.productId)} · ${warehouseName(row.warehouseId)}`}
                    lines={[
                      `仓位 ${row.binId || '—'}`,
                      `所有权 ${row.ownerType}${row.ownerId ? ` / ${row.ownerId}` : ''}`,
                      `库存状态 ${row.stockStatus || '—'}`,
                      `批号 ${row.lotId || '—'} · 序列号 ${row.serialId || '—'}`,
                      `更新 ${dateTime(row.updatedAt)}`,
                    ]}
                    metric={`${quantity(row.quantity)}`}
                  />
                ))}
              </div>
            </div>
          )}
        </InventoryWorkState>
      </InventoryWorkSection>

      {filterOpen && (
        <FilterSheet
          title="筛选即时库存"
          onClose={() => setFilterOpen(false)}
          onReset={() => setDraft({ warehouseId: '', productId: '', binId: '', ownerType: '', ownerId: '', stockStatus: '', lotId: '', serialId: '' })}
          onApply={() => { setFilters(draft); setFilterOpen(false); }}
        >
          <InventoryWorkSelect label="仓库" value={draft.warehouseId} onChange={(value) => setDraft({ ...draft, warehouseId: value })} options={warehouseOptions(warehouses)} />
          <InventoryWorkSelect label="货品" value={draft.productId} onChange={(value) => setDraft({ ...draft, productId: value })} options={productOptions(products)} />
          <InventoryWorkSelect label="仓位" value={draft.binId} onChange={(value) => setDraft({ ...draft, binId: value })} options={bins.map((b) => ({ value: b.id, label: `${b.code} · ${b.name || b.code}` }))} />
          <InventoryWorkSelect label="所有权类型" value={draft.ownerType} onChange={(value) => setDraft({ ...draft, ownerType: value })} options={OWNER_TYPE_OPTIONS} />
          <InventoryWorkInput label="所有权对象 ID" value={draft.ownerId} onChange={(value) => setDraft({ ...draft, ownerId: value })} placeholder="供应商 / 客户 ID" />
          <InventoryWorkSelect label="库存状态" value={draft.stockStatus} onChange={(value) => setDraft({ ...draft, stockStatus: value })} options={statusOptions(stockStatuses)} />
          <InventoryWorkInput label="批号 ID" value={draft.lotId} onChange={(value) => setDraft({ ...draft, lotId: value })} />
          <InventoryWorkInput label="序列号 ID" value={draft.serialId} onChange={(value) => setDraft({ ...draft, serialId: value })} />
        </FilterSheet>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// INV-03 — 仓位 (warehouse bins)
// ---------------------------------------------------------------------------

function InventoryBinEditor({ value, warehouses, notify, onSaved, onClose }) {
  const [form, setForm] = useState({ warehouseId: value.warehouseId || '', code: value.code || '', name: value.name || '' });
  const save = async (event) => {
    event.preventDefault();
    try {
      await api(value.id ? `/api/warehouse-bins/${value.id}` : '/api/warehouse-bins', {
        method: value.id ? 'PATCH' : 'POST',
        body: value.id ? { name: form.name } : { warehouseId: form.warehouseId, code: form.code, name: form.name },
      });
      notify(value.id ? '仓位已更新' : '仓位已创建');
      onSaved();
    } catch (e) { notify(e.message || '仓位保存失败', 'error'); }
  };
  return (
    <Modal title={value.id ? '编辑仓位' : '新增仓位'} onClose={onClose}>
      <form className="inv-work-form" onSubmit={save}>
        {!value.id && <InventoryWorkSelect label="所属仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />}
        {!value.id && <InventoryWorkInput label="仓位编码" required value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="例如 A-01-01" />}
        <InventoryWorkInput label="仓位名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <FormActions onClose={onClose} saveText="保存仓位" />
      </form>
    </Modal>
  );
}

export function InventoryBins({ user, notify, references }) {
  const { warehouses, reloadReferences } = references;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState(null);
  const [deactivating, setDeactivating] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api(`/api/warehouse-bins${warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : ''}`)
      .then((data) => setRows(data.bins || []))
      .catch((e) => { setError(e.message || '仓位加载失败'); notify(e.message || '仓位加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [warehouseId, notify]);
  useEffect(() => { void load(); }, [load]);

  const deactivate = async () => {
    try {
      await api(`/api/warehouse-bins/${deactivating.id}/deactivate`, { method: 'POST' });
      notify('仓位已停用');
      setDeactivating(null);
      load();
      reloadReferences();
    } catch (e) { notify(e.message || '仓位停用失败', 'error'); }
  };

  const canManage = can(user, 'WAREHOUSE_BIN_MANAGE');

  return (
    <>
      <InventoryWorkSection
        title="仓位"
        description="仓库内的仓位 / 库位档案；仓位是库存身份的组成部分，不是库存余额。"
        actions={canManage ? <button type="button" className="primary" onClick={() => setEditing({})}>＋ 新增仓位</button> : null}
      >
        <div className="inv-work-tools">
          <InventoryWorkSelect label="按仓库筛选" value={warehouseId} onChange={setWarehouseId} options={warehouseOptions(warehouses)} placeholder="全部仓库" />
        </div>
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rows.length}>
          <div className="inv-work-list">
            {rows.map((row) => (
              <InventoryWorkRow
                key={row.id}
                code={row.code}
                title={row.name || row.code}
                status={<StatusChip status={row.active ? 'ACTIVE' : 'INACTIVE'}>{row.active ? '启用' : '停用'}</StatusChip>}
                lines={[`仓库 ${row.warehouseId}`, `更新 ${dateTime(row.updatedAt)}`]}
                onEdit={canManage && row.active ? (
                  <button type="button" className="secondary" onClick={() => setEditing(row)}>编辑</button>
                ) : null}
              />
            ))}
          </div>
        </InventoryWorkState>
        {canManage && rows.some((row) => row.active) && (
          <div className="inv-work-list">
            {rows.filter((row) => row.active).map((row) => (
              <div key={`deactivate-${row.id}`} className="inv-work-inline-action">
                <span>停用 {row.code}</span>
                <button type="button" className="danger-button" onClick={() => setDeactivating(row)}>停用仓位</button>
              </div>
            ))}
          </div>
        )}
      </InventoryWorkSection>
      {editing && <InventoryBinEditor value={editing} warehouses={warehouses} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); reloadReferences(); }} />}
      {deactivating && (
        <DangerSheet
          title="停用仓位？"
          message={`仓位 ${deactivating.code} 停用后将不再可用于库存、查询与扫描。仓位仍有在库量时服务端会拒绝停用。`}
          confirmLabel="确认停用"
          onClose={() => setDeactivating(null)}
          onConfirm={deactivate}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// INV-04 — 库存状态 (stock statuses)
// ---------------------------------------------------------------------------

export function InventoryStockStatuses({ user, notify, references }) {
  const { reloadReferences } = references;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory-stock-statuses')
      .then((data) => setRows(data.stockStatuses || []))
      .catch((e) => { setError(e.message || '库存状态加载失败'); notify(e.message || '库存状态加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const canManage = can(user, 'STOCK_STATUS_MANAGE');

  const save = async (event) => {
    event.preventDefault();
    const form = editing;
    try {
      await api(editing.code ? `/api/inventory-stock-statuses/${encodeURIComponent(editing.code)}` : '/api/inventory-stock-statuses', {
        method: editing.code ? 'PATCH' : 'POST',
        body: editing.code
          ? { name: form.name, active: form.active, reservable: form.reservable, issuable: form.issuable, shippable: form.shippable, transferable: form.transferable }
          : { code: form.code, name: form.name, reservable: form.reservable, issuable: form.issuable, shippable: form.shippable, transferable: form.transferable },
      });
      notify(editing.code ? '库存状态已更新' : '库存状态已创建');
      setEditing(null);
      setCreating(false);
      load();
      reloadReferences();
    } catch (e) { notify(e.message || '库存状态保存失败', 'error'); }
  };

  const newStatus = () => { setCreating(true); setEditing({ code: '', name: '', reservable: true, issuable: true, shippable: true, transferable: true, active: true }); };

  return (
    <>
      <InventoryWorkSection
        title="库存状态"
        description="库存状态是库存身份的一等维度，直接决定可预留 / 可发运 / 可出库 / 可调拨。"
        actions={canManage ? <button type="button" className="primary" onClick={newStatus}>＋ 新增状态</button> : null}
      >
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rows.length}>
          <div className="inv-work-list">
            {rows.map((row) => (
              <InventoryWorkRow
                key={row.code}
                code={row.code}
                title={row.name || row.code}
                status={<StatusChip status={row.active ? 'ACTIVE' : 'INACTIVE'}>{row.active ? '启用' : '停用'}</StatusChip>}
                lines={[
                  `可预留 ${row.reservable ? '是' : '否'} · 可出库 ${row.issuable ? '是' : '否'}`,
                  `可发运 ${row.shippable ? '是' : '否'} · 可调拨 ${row.transferable ? '是' : '否'}`,
                ]}
                onEdit={canManage ? <button type="button" className="secondary" onClick={() => { setCreating(false); setEditing({ ...row }); }}>编辑</button> : null}
              />
            ))}
          </div>
        </InventoryWorkState>
      </InventoryWorkSection>
      {editing && (
        <Modal title={editing.code ? `编辑库存状态 ${editing.code}` : '新增库存状态'} onClose={() => { setEditing(null); setCreating(false); }}>
          <form className="inv-work-form" onSubmit={save}>
            {!editing.code && <InventoryWorkInput label="状态编码" required value={editing.code} onChange={(v) => setEditing({ ...editing, code: v.toUpperCase() })} placeholder="例如 HOLD_SEMI" />}
            <InventoryWorkInput label="状态名称" required value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
            <InventoryWorkCheckbox label="可预留" checked={editing.reservable} onChange={(v) => setEditing({ ...editing, reservable: v })} />
            <InventoryWorkCheckbox label="可出库" checked={editing.issuable} onChange={(v) => setEditing({ ...editing, issuable: v })} />
            <InventoryWorkCheckbox label="可发运" checked={editing.shippable} onChange={(v) => setEditing({ ...editing, shippable: v })} />
            <InventoryWorkCheckbox label="可调拨" checked={editing.transferable} onChange={(v) => setEditing({ ...editing, transferable: v })} />
            {editing.code && <InventoryWorkCheckbox label="启用" checked={editing.active} onChange={(v) => setEditing({ ...editing, active: v })} />}
            <FormActions onClose={() => { setEditing(null); setCreating(false); }} saveText="保存状态" />
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// INV-05 — 所有权维度 (owner dimension)
// ---------------------------------------------------------------------------

export function InventoryOwnerDimension({ user, notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory-owner-dimensions')
      .then((data) => setRows(data.ownerDimensions || []))
      .catch((e) => { setError(e.message || '所有权维度加载失败'); notify(e.message || '所有权维度加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const ownerLabel = (type) => OWNER_TYPE_OPTIONS.find((o) => o.value === type)?.label || type || '—';

  return (
    <InventoryWorkSection title="所有权维度" description="位置 ≠ 所有权：同一仓位可以存放企业自有、供应商 VMI 与客户受托料。">
      <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rows.length}>
        <div className="inv-work-list">
          {rows.map((row) => (
            <InventoryWorkRow
              key={`${row.ownerType}-${row.ownerId || 'none'}`}
              code={row.ownerType}
              title={ownerLabel(row.ownerType)}
              lines={[
                `所有权对象 ${row.ownerId || '（企业自身）'}`,
                `仓库 ${row.warehouseCount} 个 · 货品 ${row.productCount} 种`,
                `库存位置 ${row.positionCount} 个`,
              ]}
              metric={`${quantity(row.quantity)}`}
            />
          ))}
        </div>
      </InventoryWorkState>
    </InventoryWorkSection>
  );
}

// ---------------------------------------------------------------------------
// INV-01 — 库存参数 (inventory parameters)
// ---------------------------------------------------------------------------

export function InventoryParameters({ user, notify }) {
  const [parameters, setParameters] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory-parameters')
      .then((data) => { setParameters(data.parameters || null); setDraft(data.parameters || null); })
      .catch((e) => { setError(e.message || '库存参数加载失败'); notify(e.message || '库存参数加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api('/api/inventory-parameters', {
        method: 'PUT',
        body: {
          negativeStockPolicy: draft.negativeStockPolicy,
          lotDefaultStatus: draft.lotDefaultStatus,
          serialDefaultStatus: draft.serialDefaultStatus,
          stocktakeWindowDays: Number(draft.stocktakeWindowDays),
        },
      });
      setParameters(result.parameters || null);
      setDraft(result.parameters || null);
      notify('库存参数已保存');
    } catch (e) { notify(e.message || '库存参数保存失败', 'error'); }
    finally { setSaving(false); }
  };

  const canManage = can(user, 'INVENTORY_PARAMETERS_MANAGE');
  const canView = can(user, 'INVENTORY_PARAMETERS_VIEW') || canManage;

  if (!canView) return <EmptyState title="暂无库存参数查看权限" />;

  return (
    <InventoryWorkSection title="库存参数" description="库存域自己的策略参数；不与计划域 / 财务域参数混用。">
      <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!draft}>
        {draft && (
          <form className="inv-work-form" onSubmit={save}>
            <InventoryWorkSelect
              label="负库存策略"
              value={draft.negativeStockPolicy}
              onChange={(v) => setDraft({ ...draft, negativeStockPolicy: v })}
              options={[{ value: 'BLOCK', label: 'BLOCK · 禁止负库存' }, { value: 'ALLOW', label: 'ALLOW · 允许负库存' }, { value: 'WARNING', label: 'WARNING · 仅告警' }]}
            />
            <InventoryWorkSelect
              label="批次默认状态"
              value={draft.lotDefaultStatus}
              onChange={(v) => setDraft({ ...draft, lotDefaultStatus: v })}
              options={[{ value: 'AVAILABLE', label: 'AVAILABLE' }, { value: 'INSPECTION', label: 'INSPECTION' }, { value: 'QUARANTINE', label: 'QUARANTINE' }, { value: 'HOLD', label: 'HOLD' }, { value: 'BLOCKED', label: 'BLOCKED' }]}
            />
            <InventoryWorkSelect
              label="序列号默认状态"
              value={draft.serialDefaultStatus}
              onChange={(v) => setDraft({ ...draft, serialDefaultStatus: v })}
              options={[{ value: 'AVAILABLE', label: 'AVAILABLE' }, { value: 'INSPECTION', label: 'INSPECTION' }, { value: 'QUARANTINE', label: 'QUARANTINE' }, { value: 'HOLD', label: 'HOLD' }, { value: 'BLOCKED', label: 'BLOCKED' }]}
            />
            <InventoryWorkInput label="盘点冲突窗口（天）" type="number" min="0" max="365" value={draft.stocktakeWindowDays} onChange={(v) => setDraft({ ...draft, stocktakeWindowDays: v })} />
            <InventoryWorkFacts facts={[
              { label: '库存启用时间', value: parameters?.enabledAt ? dateTime(parameters.enabledAt) : '尚未启用' },
              { label: '最近更新', value: parameters?.updatedAt ? dateTime(parameters.updatedAt) : '—' },
            ]} />
            {canManage && (
              <BottomActionBar>
                <button type="submit" className="primary" disabled={saving}>{saving ? '保存中…' : '保存库存参数'}</button>
              </BottomActionBar>
            )}
          </form>
        )}
      </InventoryWorkState>
    </InventoryWorkSection>
  );
}

// ---------------------------------------------------------------------------
// INV-29 / INV-30 / INV-31 — 盘点 (canonical stocktake)
// ---------------------------------------------------------------------------

// The counted difference of one stocktake: the sum of its counted lines, or
// the legacy projection of a single-line document.
function stocktakeDifferenceLabel(row) {
  const lines = Array.isArray(row.items) ? row.items : [];
  const difference = lines.length
    ? lines.reduce((sum, line) => sum + Number(line.diffQuantity || 0), 0)
    : Number(row.difference || 0);
  if (!difference) return undefined;
  return `${difference > 0 ? '+' : ''}${quantity(difference)}`;
}

export function InventoryStocktake({ user, notify, references }) {
  const { warehouses, products, stockStatuses, bins } = references;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState(null);
  const [scanning, setScanning] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory-stocktakes')
      .then((data) => setRows(data.stocktakes || []))
      .catch((e) => { setError(e.message || '盘点单加载失败'); notify(e.message || '盘点单加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const approve = async () => {
    try {
      await api(`/api/inventory-stocktakes/${approving.id}/approve`, { method: 'POST' });
      notify('盘点单已审核，差异已通过规范库存异动生效');
      setApproving(null);
      load();
    } catch (e) { notify(e.message || '盘点审核失败', 'error'); }
  };

  const canCreate = can(user, 'INVENTORY_CHECK_CREATE');
  const canApprove = can(user, 'INVENTORY_CHECK_APPROVE');

  const submit = async (row) => {
    try {
      await api(`/api/inventory-stocktakes/${row.id}/submit`, { method: 'POST' });
      notify('盘点单已提交审批');
      load();
    } catch (e) { notify(e.message || '盘点单提交失败', 'error'); }
  };

  return (
    <>
      <InventoryWorkSection
        title="盘点"
        description="规范盘点单：定期盘点与周期盘点共用同一张单据，盘盈 / 盘亏必须经审核后通过规范库存异动生效。"
        actions={canCreate ? <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 新建盘点</button> : null}
      >
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rows.length}>
          <div className="inv-work-list">
            {rows.map((row) => (
              <InventoryWorkRow
                key={row.id}
                code={row.check_no}
                title={row.productName ? `${row.productName}` : `盘点单 · ${row.itemCount || 0} 项`}
                status={<StatusChip status={row.status}>{row.status === 'SUBMITTED' ? '待审核' : row.status === 'APPROVED' ? '已审核' : row.status === 'DRAFT' ? '草稿' : row.status}</StatusChip>}
                lines={[`仓库 ${row.warehouseName || row.warehouse_id}`, `业务日期 ${row.business_date || '—'}`, `制单人 ${row.creatorName || '—'}`]}
                metric={stocktakeDifferenceLabel(row)}
                onEdit={(
                  <>
                    {canCreate && row.status === 'DRAFT' && (
                      <>
                        <button type="button" className="secondary" onClick={() => setScanning(row)}>扫码盘点</button>
                        <button type="button" className="approve-button" onClick={() => submit(row)}>提交审批</button>
                      </>
                    )}
                    {canApprove && row.status === 'SUBMITTED' && <button type="button" className="primary" onClick={() => setApproving(row)}>审核</button>}
                  </>
                )}
              />
            ))}
          </div>
        </InventoryWorkState>
        {canApprove && <div className="inv-work-inline-link"><AppLink page="approvals">前往审批中心</AppLink></div>}
      </InventoryWorkSection>
      {creating && (
        <InventoryStocktakeEditor
          warehouses={warehouses}
          products={products}
          stockStatuses={stockStatuses}
          bins={bins}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {scanning && (
        <InventoryStocktakeScanSheet
          check={scanning}
          notify={notify}
          onClose={() => setScanning(null)}
          onSaved={() => { setScanning(null); load(); }}
        />
      )}
      {approving && (
        <DangerSheet
          title="审核盘点单？"
          message={`盘点单 ${approving.check_no} 审核后将按实盘与账存差异执行规范库存异动（盘盈 / 盘亏），不可撤销。`}
          confirmLabel="确认审核"
          onClose={() => setApproving(null)}
          onConfirm={approve}
        />
      )}
    </>
  );
}

// INV-42 — the barcode scan counts one line of a draft stocktake. The counted
// line lands on the canonical position identity of the scanned product.
function InventoryStocktakeScanSheet({ check, notify, onClose, onSaved }) {
  const [code, setCode] = useState('');
  const [quantityValue, setQuantityValue] = useState('1');
  const save = async (event) => {
    event.preventDefault();
    if (!code.trim()) { notify('请输入条码', 'error'); return; }
    try {
      await api(`/api/inventory-stocktakes/${check.id}/scan`, {
        method: 'POST',
        body: { code: code.trim(), quantity: Number(quantityValue) || 0 },
      });
      notify('扫码盘点已记入盘点单');
      onSaved();
    } catch (e) { notify(e.message || '扫码盘点失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title={`扫码盘点 · ${check.check_no || ''}`} onSubmit={save} submitLabel="记入盘点单">
      <div className="inv-work-form-grid">
        <InventoryWorkInput label="条码" required value={code} onChange={setCode} placeholder="扫描或输入条码" />
        <InventoryWorkInput label="实盘数量" type="number" min="0" step="0.01" value={quantityValue} onChange={setQuantityValue} />
      </div>
    </InventoryWorkEditorShell>
  );
}

function InventoryStocktakeEditor({ warehouses, products, stockStatuses, bins, notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    warehouseId: '', checkKind: 'REGULAR', scopeStrategy: 'ALL', businessDate: todayIso(),
    abcClassification: '', cyclePeriodKey: '',
    items: [{ productId: '', physicalQuantity: '', binId: '', ownerType: 'ENTERPRISE', ownerId: '', stockStatus: 'AVAILABLE', lotId: '', serialId: '' }],
  });
  const update = (index, patch) => setForm({ ...form, items: form.items.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const addRow = () => setForm({ ...form, items: [...form.items, { productId: '', physicalQuantity: '', binId: '', ownerType: 'ENTERPRISE', ownerId: '', stockStatus: 'AVAILABLE', lotId: '', serialId: '' }] });
  const removeRow = (index) => setForm({ ...form, items: form.items.filter((_, i) => i !== index) });

  const save = async (event) => {
    event.preventDefault();
    const items = form.items
      .filter((row) => row.productId && row.physicalQuantity !== '')
      .map((row) => ({
        productId: row.productId,
        physicalQuantity: Number(row.physicalQuantity),
        ...(row.binId ? { binId: row.binId } : {}),
        ownerType: row.ownerType || 'ENTERPRISE',
        ...(row.ownerType && row.ownerType !== 'ENTERPRISE' && row.ownerId ? { ownerId: row.ownerId } : {}),
        ...(row.stockStatus ? { stockStatus: row.stockStatus } : {}),
        ...(row.lotId ? { lotId: row.lotId } : {}),
        ...(row.serialId ? { serialId: row.serialId } : {}),
      }));
    if (!items.length) { notify('请至少填写一行有效盘点明细', 'error'); return; }
    try {
      await api('/api/inventory-stocktakes', {
        method: 'POST',
        body: {
          warehouseId: form.warehouseId,
          checkKind: form.checkKind,
          scopeStrategy: form.scopeStrategy,
          businessDate: form.businessDate,
          ...(form.abcClassification ? { abcClassification: form.abcClassification } : {}),
          ...(form.cyclePeriodKey ? { cyclePeriodKey: form.cyclePeriodKey } : {}),
          items,
        },
      });
      // The document stays a draft: the counted lines may still be corrected
      // or counted by scan before they are frozen by the submission.
      notify('盘点单草稿已创建');
      onSaved();
    } catch (e) { notify(e.message || '盘点单创建失败', 'error'); }
  };

  return (
    <InventoryWorkEditorShell title="新建盘点" onSubmit={save} submitLabel="创建盘点单">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
        <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
        <InventoryWorkSelect label="盘点类型" value={form.checkKind} onChange={(v) => setForm({ ...form, checkKind: v })} options={[{ value: 'REGULAR', label: 'REGULAR · 定期盘点' }, { value: 'CYCLE', label: 'CYCLE · 周期盘点' }]} />
        <InventoryWorkSelect label="盘点范围策略" value={form.scopeStrategy} onChange={(v) => setForm({ ...form, scopeStrategy: v })} options={[{ value: 'ALL', label: 'ALL · 全量' }, { value: 'ABC', label: 'ABC · 按 ABC 分类' }, { value: 'CYCLE', label: 'CYCLE · 按周期策略' }]} />
        <InventoryWorkInput label="ABC 分类范围" value={form.abcClassification} onChange={(v) => setForm({ ...form, abcClassification: v })} placeholder="例如 A" />
        <InventoryWorkInput label="周期策略键" value={form.cyclePeriodKey} onChange={(v) => setForm({ ...form, cyclePeriodKey: v })} placeholder="例如 2026-11" />
      </div>
      <section className="inv-work-subsection">
        <header className="inv-work-section__head">
          <h4>盘点明细</h4>
          <button type="button" className="secondary" onClick={addRow}>添加一行</button>
        </header>
        {form.items.map((row, index) => (
          <article key={index} className="inv-work-line">
            <header><b>第 {index + 1} 行</b><button type="button" className="ghost" disabled={form.items.length === 1} onClick={() => removeRow(index)}>移除</button></header>
            <div className="inv-work-form-grid">
              <InventoryWorkSelect label="货品" required value={row.productId} onChange={(v) => update(index, { productId: v })} options={productOptions(products)} />
              <InventoryWorkInput label="实盘数量" type="number" min="0" step="0.01" required value={row.physicalQuantity} onChange={(v) => update(index, { physicalQuantity: v })} />
              <InventoryWorkSelect label="仓位" value={row.binId} onChange={(v) => update(index, { binId: v })} options={bins.map((b) => ({ value: b.id, label: `${b.code} · ${b.name || b.code}` }))} />
              <InventoryWorkSelect label="所有权" value={row.ownerType} onChange={(v) => update(index, { ownerType: v })} options={OWNER_TYPE_OPTIONS} />
              {row.ownerType !== 'ENTERPRISE' && <InventoryWorkInput label="所有权对象 ID" value={row.ownerId} onChange={(v) => update(index, { ownerId: v })} />}
              <InventoryWorkSelect label="库存状态" value={row.stockStatus} onChange={(v) => update(index, { stockStatus: v })} options={statusOptions(stockStatuses)} />
              <InventoryWorkInput label="批号 ID" value={row.lotId} onChange={(v) => update(index, { lotId: v })} />
              <InventoryWorkInput label="序列号 ID" value={row.serialId} onChange={(v) => update(index, { serialId: v })} />
            </div>
          </article>
        ))}
      </section>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-18 — 批号调整 (lot adjustment)
// ---------------------------------------------------------------------------

export function InventoryLotAdjustment({ user, notify, references }) {
  const { warehouses, products } = references;
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [documents, setDocuments] = useState([]);

  const confirmLot = async () => {
    try {
      await api(`/api/inventory-lot-adjustments/${confirming.id}/confirm`, { method: 'POST' });
      notify('批号调整已确认，数量守恒');
      setDocuments((rows) => rows.map((row) => (row.id === confirming.id ? { ...row, status: 'CONFIRMED' } : row)));
      setConfirming(null);
    } catch (e) { notify(e.message || '批号调整确认失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_LOT_ADJUSTMENT_MANAGE');

  return (
    <>
      <InventoryWorkSection
        title="批号调整"
        description="批号拆分 / 合并 / 重分类；数量必须守恒，不得借批号调整制造或销毁库存。"
        actions={canManage ? <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 新建批号调整</button> : null}
      >
        <InventoryWorkState loading={false} error="" empty={!documents.length}>
          <div className="inv-work-list">
            {documents.map((row) => (
              <InventoryWorkRow
                key={row.id}
                code={row.docNo}
                title={`${row.adjustmentType} · ${row.productName || row.productId}`}
                status={<StatusChip status={row.status}>{row.status === 'DRAFT' ? '草稿' : row.status === 'CONFIRMED' ? '已确认' : row.status}</StatusChip>}
                lines={[`仓库 ${row.warehouseName || row.warehouseId}`, `数量 ${quantity(row.quantity)}`, row.reason ? `原因 ${row.reason}` : null]}
                onEdit={canManage && row.status === 'DRAFT' ? <button type="button" className="primary" onClick={() => setConfirming(row)}>确认</button> : null}
              />
            ))}
          </div>
        </InventoryWorkState>
      </InventoryWorkSection>
      {creating && (
        <InventoryLotAdjustmentEditor
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={(created) => { setCreating(false); setDocuments((rows) => [created, ...rows]); }}
        />
      )}
      {confirming && (
        <DangerSheet
          title="确认批号调整？"
          message={`批号调整单 ${confirming.docNo} 确认后将执行批号身份变更，数量守恒。`}
          confirmLabel="确认调整"
          onClose={() => setConfirming(null)}
          onConfirm={confirmLot}
        />
      )}
    </>
  );
}

function InventoryLotAdjustmentEditor({ warehouses, products, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ adjustmentType: 'SPLIT', productId: '', warehouseId: '', sourceLotCode: '', targetLotCode: '', quantity: '', reason: '' });
  const save = async (event) => {
    event.preventDefault();
    try {
      const created = await api('/api/inventory-lot-adjustments', { method: 'POST', body: { ...form, quantity: Number(form.quantity) } });
      notify('批号调整草稿已创建');
      onSaved({
        id: created.id,
        docNo: created.docNo,
        adjustmentType: created.adjustmentType,
        status: created.status,
        productId: form.productId,
        productName: products.find((p) => p.id === form.productId)?.name,
        warehouseId: form.warehouseId,
        warehouseName: warehouses.find((w) => w.id === form.warehouseId)?.name,
        quantity: Number(form.quantity),
        reason: form.reason,
      });
    } catch (e) { notify(e.message || '批号调整创建失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title="新建批号调整" onSubmit={save} submitLabel="创建草稿">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="调整类型" value={form.adjustmentType} onChange={(v) => setForm({ ...form, adjustmentType: v })} options={[{ value: 'SPLIT', label: 'SPLIT · 拆分' }, { value: 'MERGE', label: 'MERGE · 合并' }, { value: 'RECLASS', label: 'RECLASS · 重分类' }]} />
        <InventoryWorkSelect label="货品" required value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={productOptions(products)} />
        <InventoryWorkSelect label="仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
        <InventoryWorkInput label="来源批号" required value={form.sourceLotCode} onChange={(v) => setForm({ ...form, sourceLotCode: v })} />
        <InventoryWorkInput label="目标批号" required value={form.targetLotCode} onChange={(v) => setForm({ ...form, targetLotCode: v })} />
        <InventoryWorkInput label="数量" type="number" min="0.0001" step="0.0001" required value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
        <InventoryWorkInput label="原因" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
      </div>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-20 — 形态转换 (form conversion)
// ---------------------------------------------------------------------------

export function InventoryFormConversion({ user, notify, references }) {
  const { warehouses, products } = references;
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [documents, setDocuments] = useState([]);

  const confirmConversion = async () => {
    try {
      await api(`/api/inventory-form-conversions/${confirming.id}/confirm`, { method: 'POST' });
      notify('形态转换已确认，数量守恒');
      setDocuments((rows) => rows.map((row) => (row.id === confirming.id ? { ...row, status: 'CONFIRMED' } : row)));
      setConfirming(null);
    } catch (e) { notify(e.message || '形态转换确认失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_FORM_CONVERSION_MANAGE');

  return (
    <>
      <InventoryWorkSection
        title="形态转换"
        description="库存形态 / 属性转换：源位置减少与目标位置增加成对发生，库存数量必须守恒。"
        actions={canManage ? <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 新建形态转换</button> : null}
      >
        <InventoryWorkState loading={false} error="" empty={!documents.length}>
          <div className="inv-work-list">
            {documents.map((row) => (
              <InventoryWorkRow
                key={row.id}
                code={row.docNo}
                title={`${row.fromForm} → ${row.toForm}`}
                status={<StatusChip status={row.status}>{row.status === 'DRAFT' ? '草稿' : row.status === 'CONFIRMED' ? '已确认' : row.status}</StatusChip>}
                lines={[`货品 ${row.productName || row.productId}`, `仓库 ${row.warehouseName || row.warehouseId}`, `数量 ${quantity(row.quantity)}`, `业务日期 ${row.businessDate}`]}
                onEdit={canManage && row.status === 'DRAFT' ? <button type="button" className="primary" onClick={() => setConfirming(row)}>确认</button> : null}
              />
            ))}
          </div>
        </InventoryWorkState>
      </InventoryWorkSection>
      {creating && (
        <InventoryFormConversionEditor
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={(created) => { setCreating(false); setDocuments((rows) => [created, ...rows]); }}
        />
      )}
      {confirming && (
        <DangerSheet
          title="确认形态转换？"
          message={`形态转换单 ${confirming.docNo} 确认后源形态减少、目标形态增加，数量守恒。`}
          confirmLabel="确认转换"
          onClose={() => setConfirming(null)}
          onConfirm={confirmConversion}
        />
      )}
    </>
  );
}

function InventoryFormConversionEditor({ warehouses, products, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ productId: '', warehouseId: '', quantity: '', fromForm: 'AVAILABLE', toForm: 'INSPECTION', reason: '', businessDate: todayIso() });
  const save = async (event) => {
    event.preventDefault();
    try {
      const created = await api('/api/inventory-form-conversions', { method: 'POST', body: { ...form, quantity: Number(form.quantity) } });
      notify('形态转换草稿已创建');
      onSaved({
        id: created.id,
        docNo: created.docNo,
        status: created.status,
        productId: form.productId,
        productName: products.find((p) => p.id === form.productId)?.name,
        warehouseId: form.warehouseId,
        warehouseName: warehouses.find((w) => w.id === form.warehouseId)?.name,
        quantity: Number(form.quantity),
        fromForm: form.fromForm,
        toForm: form.toForm,
        businessDate: form.businessDate,
      });
    } catch (e) { notify(e.message || '形态转换创建失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title="新建形态转换" onSubmit={save} submitLabel="创建草稿">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="货品" required value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={productOptions(products)} />
        <InventoryWorkSelect label="仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
        <InventoryWorkInput label="数量" type="number" min="0.0001" step="0.0001" required value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
        <InventoryWorkInput label="来源形态" required value={form.fromForm} onChange={(v) => setForm({ ...form, fromForm: v.toUpperCase() })} />
        <InventoryWorkInput label="目标形态" required value={form.toForm} onChange={(v) => setForm({ ...form, toForm: v.toUpperCase() })} />
        <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
        <InventoryWorkInput label="原因" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
      </div>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-17 — 组装 / 拆卸 (assembly / disassembly)
// ---------------------------------------------------------------------------

export function InventoryAssembly({ user, notify, references }) {
  const { warehouses, products } = references;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(null);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory/assembly-orders')
      .then((data) => setRows(data.assemblyOrders || []))
      .catch((e) => { setError(e.message || '组装拆卸单加载失败'); notify(e.message || '组装拆卸单加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const confirmOrder = async () => {
    const kind = confirming.orderType;
    try {
      await api(`/api/inventory/${kind === 'DISASSEMBLY' ? 'disassembly' : 'assembly'}-orders/${confirming.id}/confirm`, { method: 'POST' });
      notify(kind === 'DISASSEMBLY' ? '拆卸单已确认' : '组装单已确认');
      setConfirming(null);
      load();
    } catch (e) { notify(e.message || '确认失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_ASSEMBLY_MANAGE');

  return (
    <>
      <InventoryWorkSection
        title="组装 / 拆卸"
        description="BOM 结构来源在工程域；库存域只拥有物理消耗与产出。组装 / 拆卸单确认后不可重复执行。"
        actions={canManage ? (
          <div className="inv-work-tools">
            <button type="button" className="primary" onClick={() => setCreating('ASSEMBLY')}>＋ 新建组装</button>
            <button type="button" className="secondary" onClick={() => setCreating('DISASSEMBLY')}>＋ 新建拆卸</button>
          </div>
        ) : null}
      >
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rows.length}>
          <div className="inv-work-list">
            {rows.map((row) => (
              <InventoryWorkRow
                key={row.id}
                code={row.docNo}
                title={row.orderType === 'DISASSEMBLY' ? '拆卸单' : '组装单'}
                status={<StatusChip status={row.status}>{row.status === 'DRAFT' ? '草稿' : row.status === 'CONFIRMED' ? '已确认' : row.status}</StatusChip>}
                lines={[
                  `产品 ${row.productId}`,
                  `仓库 ${row.warehouseId}`,
                  `业务日期 ${row.businessDate}`,
                  `BOM ${row.bomVersion || row.bomId || '—'}`,
                  `组件行 ${row.items?.length || 0} 行`,
                ]}
                metric={`${quantity(row.quantity)}`}
                onEdit={canManage && row.status === 'DRAFT' ? <button type="button" className="primary" onClick={() => setConfirming(row)}>确认</button> : null}
              />
            ))}
          </div>
        </InventoryWorkState>
      </InventoryWorkSection>
      {creating && (
        <InventoryAssemblyEditor
          orderType={creating}
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load(); }}
        />
      )}
      {confirming && (
        <DangerSheet
          title={confirming.orderType === 'DISASSEMBLY' ? '确认拆卸单？' : '确认组装单？'}
          message={`单据 ${confirming.docNo} 确认后将执行物理消耗与产出，已确认的单据不会重复产生库存移动。`}
          confirmLabel="确认执行"
          onClose={() => setConfirming(null)}
          onConfirm={confirmOrder}
        />
      )}
    </>
  );
}

function InventoryAssemblyEditor({ orderType, warehouses, products, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ warehouseId: '', productId: '', quantity: '', businessDate: todayIso(), remark: '' });
  const save = async (event) => {
    event.preventDefault();
    const path = orderType === 'DISASSEMBLY' ? '/api/inventory/disassembly-orders' : '/api/inventory/assembly-orders';
    try {
      await api(path, { method: 'POST', body: { ...form, quantity: Number(form.quantity) } });
      notify(orderType === 'DISASSEMBLY' ? '拆卸单已创建' : '组装单已创建');
      onSaved();
    } catch (e) { notify(e.message || '创建失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title={orderType === 'DISASSEMBLY' ? '新建拆卸单' : '新建组装单'} onSubmit={save} submitLabel="创建草稿">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
        <InventoryWorkSelect label={orderType === 'DISASSEMBLY' ? '拆卸产品' : '组装产品'} required value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={productOptions(products)} />
        <InventoryWorkInput label="数量" type="number" min="0.0001" step="0.0001" required value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
        <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
        <InventoryWorkInput label="备注" value={form.remark} onChange={(v) => setForm({ ...form, remark: v })} />
      </div>
      <InlineAlert tone="info">组件结构由工程域的生效 BOM 决定；客户端提交的组件清单会被服务端忽略。</InlineAlert>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-26 / INV-38 — ABC 分类
// ---------------------------------------------------------------------------

export function InventoryAbc({ user, notify, references }) {
  const { warehouses, products } = references;
  const [classifications, setClassifications] = useState([]);
  const [analysis, setAnalysis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classifying, setClassifying] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api('/api/inventory/abc').catch(() => ({ abcClassifications: [] })),
      api('/api/inventory/abc/analysis').catch(() => ({ analysis: [] })),
    ]).then(([c, a]) => {
      setClassifications(c.abcClassifications || []);
      setAnalysis(a.analysis || []);
    }).catch((e) => { setError(e.message || 'ABC 分类加载失败'); notify(e.message || 'ABC 分类加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const canManage = can(user, 'INVENTORY_ABC_MANAGE');

  return (
    <>
      <InventoryWorkSection
        title="ABC 分类"
        description="物料 ABC 分类，并作为周期盘点策略的输入。金额基础只读取财务域签发的估值快照。"
        actions={canManage ? <button type="button" className="primary" onClick={() => setClassifying(true)}>执行分类</button> : null}
      >
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!classifications.length && !analysis.length}>
          {Boolean(analysis.length) && (
            <div className="inv-work-subsection">
              <h4>当前生效分类</h4>
              <div className="inv-work-list">
                {analysis.map((row) => (
                  <InventoryWorkRow
                    key={row.id}
                    code={row.productCode || row.productId}
                    title={row.productName || row.productId}
                    status={<StatusChip status={row.abcClass}>{row.abcClass} 类</StatusChip>}
                    lines={[`生效日期 ${row.effectiveFrom}`, `基础 ${row.basis}`, `估值快照 ${row.financeValuationSnapshotId || '—'}`]}
                    metric={`在库 ${quantity(row.onHandQuantity)}`}
                  />
                ))}
              </div>
            </div>
          )}
          {Boolean(classifications.length) && (
            <div className="inv-work-subsection">
              <h4>分类历史</h4>
              <div className="inv-work-list">
                {classifications.map((row) => (
                  <InventoryWorkRow
                    key={row.id}
                    code={row.productCode || row.productId}
                    title={`${row.productName || ''} · ${row.abcClass} 类`}
                    lines={[`生效 ${row.effectiveFrom} → ${row.effectiveTo || '至今'}`, `基础 ${row.basis}`]}
                  />
                ))}
              </div>
            </div>
          )}
        </InventoryWorkState>
      </InventoryWorkSection>
      {classifying && (
        <InventoryAbcClassifyEditor
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setClassifying(false)}
          onSaved={() => { setClassifying(false); load(); }}
        />
      )}
    </>
  );
}

function InventoryAbcClassifyEditor({ warehouses, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ basis: 'USAGE', effectiveFrom: todayIso(), warehouseId: '', financeValuationSnapshotId: '' });
  const save = async (event) => {
    event.preventDefault();
    try {
      await api('/api/inventory/abc/classify', {
        method: 'POST',
        body: {
          basis: form.basis,
          effectiveFrom: form.effectiveFrom,
          ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
          ...(form.financeValuationSnapshotId ? { financeValuationSnapshotId: form.financeValuationSnapshotId } : {}),
        },
      });
      notify('ABC 分类已完成');
      onSaved();
    } catch (e) { notify(e.message || 'ABC 分类失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title="执行 ABC 分类" onSubmit={save} submitLabel="开始分类">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="分类基础" value={form.basis} onChange={(v) => setForm({ ...form, basis: v })} options={[{ value: 'USAGE', label: 'USAGE · 按真实出库用量' }, { value: 'VALUE', label: 'VALUE · 按财务估值快照' }]} />
        <InventoryWorkInput label="生效日期" type="date" required value={form.effectiveFrom} onChange={(v) => setForm({ ...form, effectiveFrom: v })} />
        <InventoryWorkSelect label="仓库" value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} placeholder="全部仓库" />
        <InventoryWorkInput label="财务估值快照 ID" value={form.financeValuationSnapshotId} onChange={(v) => setForm({ ...form, financeValuationSnapshotId: v })} placeholder="basis=VALUE 时必填" />
      </div>
      <InlineAlert tone="info">basis=VALUE 必须引用财务域签发的估值快照；库存域不复制估值引擎。</InlineAlert>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-39 — 条码 (barcode rules / bindings / generation / label)
// ---------------------------------------------------------------------------

export function InventoryBarcode({ user, notify, references }) {
  const { products, warehouses } = references;
  const [rules, setRules] = useState([]);
  const [generated, setGenerated] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creatingRule, setCreatingRule] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [label, setLabel] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api('/api/inventory/barcode/rules').catch(() => ({ barcodeRules: [] })),
      api('/api/inventory/barcode/generated').catch(() => ({ barcodes: [] })),
    ]).then(([r, g]) => {
      setRules(r.barcodeRules || []);
      setGenerated(g.barcodes || []);
    }).catch((e) => { setError(e.message || '条码加载失败'); notify(e.message || '条码加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const canManage = can(user, 'INVENTORY_BARCODE_RULE_MANAGE');

  const renderLabel = async (barcode) => {
    try {
      const result = await api('/api/inventory/barcode/label', { method: 'POST', body: { barcode, template: 'LABEL' } });
      setLabel(result);
    } catch (e) { notify(e.message || '标签生成失败', 'error'); }
  };

  return (
    <>
      <InventoryWorkSection
        title="条码"
        description="条码规则主数据、对象绑定、条码生成与标签渲染。条码只解析对象身份，不复制业务单据。"
        actions={canManage ? (
          <div className="inv-work-tools">
            <button type="button" className="primary" onClick={() => setGenerating(true)}>生成条码</button>
            <button type="button" className="secondary" onClick={() => setCreatingRule(true)}>＋ 新增规则</button>
          </div>
        ) : null}
      >
        <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rules.length && !generated.length}>
          {Boolean(generated.length) && (
            <div className="inv-work-subsection">
              <h4>已绑定条码</h4>
              <div className="inv-work-list">
                {generated.map((row) => (
                  <InventoryWorkRow
                    key={row.id}
                    code={row.barcode}
                    title={`${row.entityType} · ${row.entityId}`}
                    lines={[`规则 ${row.ruleCode || row.ruleId}`]}
                    onEdit={<button type="button" className="secondary" onClick={() => renderLabel(row.barcode)}>生成标签</button>}
                  />
                ))}
              </div>
            </div>
          )}
          {Boolean(rules.length) && (
            <div className="inv-work-subsection">
              <h4>条码规则</h4>
              <div className="inv-work-list">
                {rules.map((row) => (
                  <InventoryWorkRow
                    key={row.id}
                    code={row.code}
                    title={row.pattern}
                    lines={[`字段 ${row.fields || '{}'}`, row.active === 0 ? '已停用' : '启用中']}
                  />
                ))}
              </div>
            </div>
          )}
        </InventoryWorkState>
      </InventoryWorkSection>
      {creatingRule && (
        <InventoryBarcodeRuleEditor notify={notify} onClose={() => setCreatingRule(false)} onSaved={() => { setCreatingRule(false); load(); }} />
      )}
      {generating && (
        <InventoryBarcodeGenerateEditor
          products={products}
          warehouses={warehouses}
          notify={notify}
          onClose={() => setGenerating(null)}
          onSaved={() => { setGenerating(null); load(); }}
        />
      )}
      {label && (
        <Modal title={`条码标签 ${label.barcode}`} onClose={() => setLabel(null)} wide>
          <div className="inv-work-label">
            <div className="inv-work-label__lines">
              {(label.lines || []).map((line) => (
                <div key={line.label}><span>{line.label}</span><b className="mono">{line.value}</b></div>
              ))}
            </div>
            <div className="inv-work-label__svg" dangerouslySetInnerHTML={{ __html: label.svg }} />
          </div>
        </Modal>
      )}
    </>
  );
}

function InventoryBarcodeRuleEditor({ notify, onClose, onSaved }) {
  const [form, setForm] = useState({ code: '', pattern: '', fields: '{"kind":"product"}' });
  const save = async (event) => {
    event.preventDefault();
    let fields;
    try { fields = JSON.parse(form.fields || '{}'); }
    catch { notify('字段定义必须是合法 JSON', 'error'); return; }
    try {
      await api('/api/inventory/barcode/rules', { method: 'POST', body: { code: form.code, pattern: form.pattern, fields } });
      notify('条码规则已创建');
      onSaved();
    } catch (e) { notify(e.message || '条码规则创建失败', 'error'); }
  };
  return (
    <Modal title="新增条码规则" onClose={onClose}>
      <form className="inv-work-form" onSubmit={save}>
        <InventoryWorkInput label="规则编码" required value={form.code} onChange={(v) => setForm({ ...form, code: v })} placeholder="例如 PRD-PRODUCT" />
        <InventoryWorkInput label="解析模式" required value={form.pattern} onChange={(v) => setForm({ ...form, pattern: v })} placeholder="例如 PRD-{code}" />
        <InventoryWorkTextarea label="字段定义（JSON）" value={form.fields} onChange={(v) => setForm({ ...form, fields: v })} />
        <FormActions onClose={onClose} saveText="创建规则" />
      </form>
    </Modal>
  );
}

function InventoryBarcodeGenerateEditor({ products, warehouses, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ entityType: 'product', entityId: '', barcode: '' });
  const options = form.entityType === 'product' ? productOptions(products)
    : form.entityType === 'warehouse' ? warehouseOptions(warehouses)
      : [];
  const save = async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/inventory/barcode/generate', {
        method: 'POST',
        body: { entityType: form.entityType, entityId: form.entityId, ...(form.barcode ? { barcode: form.barcode } : {}) },
      });
      notify(`条码 ${result.barcode} 已生成`);
      onSaved();
    } catch (e) { notify(e.message || '条码生成失败', 'error'); }
  };
  return (
    <Modal title="生成条码" onClose={onClose}>
      <form className="inv-work-form" onSubmit={save}>
        <InventoryWorkSelect
          label="对象类型"
          value={form.entityType}
          onChange={(v) => setForm({ ...form, entityType: v, entityId: '' })}
          options={[
            { value: 'product', label: 'product · 货品' },
            { value: 'warehouse', label: 'warehouse · 仓库' },
            { value: 'bin', label: 'bin · 仓位' },
            { value: 'lot', label: 'lot · 批号' },
            { value: 'serial', label: 'serial · 序列号' },
            { value: 'container', label: 'container · 包装容器' },
          ]}
        />
        {options.length > 0 ? (
          <InventoryWorkSelect label="对象" required value={form.entityId} onChange={(v) => setForm({ ...form, entityId: v })} options={options} />
        ) : (
          <InventoryWorkInput label="对象 ID" required value={form.entityId} onChange={(v) => setForm({ ...form, entityId: v })} />
        )}
        <InventoryWorkInput label="自定义条码（可留空）" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} />
        <FormActions onClose={onClose} saveText="生成条码" />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// INV-44 — 包装容器 (container)
// ---------------------------------------------------------------------------

export function InventoryContainers({ user, notify, references }) {
  const { warehouses, products } = references;
  const [creating, setCreating] = useState(false);
  const [containers, setContainers] = useState([]);
  const [packing, setPacking] = useState(null);
  const [contents, setContents] = useState(null);
  const [transferTarget, setTransferTarget] = useState(null);

  const loadContents = async (containerId) => {
    try {
      const result = await api(`/api/inventory-containers/${containerId}/inventory`);
      setContents({ id: containerId, items: result.items || [] });
    } catch (e) { notify(e.message || '容器内容加载失败', 'error'); }
  };

  // INV-44 — unpacking releases the packing relation. The physical balance
  // never left the warehouse, so the unpack creates no quantity.
  const unpack = async (row) => {
    try {
      await api(`/api/inventory-containers/${row.id}/unpack`, { method: 'POST' });
      notify('容器已拆包，库存数量不变');
      load();
    } catch (e) { notify(e.message || '拆包失败', 'error'); }
  };

  const transfer = async (toWarehouseId) => {
    if (!toWarehouseId) { notify('请选择目标仓库', 'error'); return; }
    try {
      await api(`/api/inventory-containers/${transferTarget.id}/transfer`, { method: 'POST', body: { toWarehouseId } });
      notify('容器已整体转移');
      setTransferTarget(null);
      setContents(null);
    } catch (e) { notify(e.message || '容器转移失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_CONTAINER_MANAGE');

  return (
    <>
      <InventoryWorkSection
        title="包装容器"
        description="容器只保存装箱关系，不是第二套库存余额；真实库存仍以规范库存身份为准。"
        actions={canManage ? <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 新建容器</button> : null}
      >
        <InventoryWorkState loading={false} error="" empty={!containers.length}>
          <div className="inv-work-list">
            {containers.map((row) => (
              <InventoryWorkRow
                key={row.id}
                code={row.containerNo}
                title={`${row.containerType} · ${row.warehouseName || row.warehouseId}`}
                status={<StatusChip status={row.status}>{row.status === 'OPEN' ? '可装箱' : row.status === 'SEALED' ? '已封箱' : row.status}</StatusChip>}
                lines={[`仓库 ${row.warehouseName || row.warehouseId}`]}
                onEdit={(
                  <div className="inv-work-row__buttons">
                    <button type="button" className="secondary" onClick={() => void loadContents(row.id)}>查看内容</button>
                    {canManage && row.status === 'OPEN' && <button type="button" className="primary" onClick={() => setPacking(row)}>装箱</button>}
                    {canManage && row.status === 'OPEN' && <button type="button" className="secondary" onClick={() => setTransferTarget(row)}>整体转移</button>}
                    {canManage && row.status === 'OPEN' && <button type="button" className="danger-button" onClick={() => void unpack(row)}>拆包</button>}
                  </div>
                )}
              />
            ))}
          </div>
        </InventoryWorkState>
        {contents && (
          <div className="inv-work-subsection">
            <h4>容器内容</h4>
            <div className="inv-work-list">
              {contents.items.length ? contents.items.map((item) => (
                <InventoryWorkRow
                  key={item.id}
                  code={item.productId}
                  title={`${products.find((p) => p.id === item.productId)?.name || item.productId}`}
                  lines={[`批号 ${item.lotId || '—'} · 序列号 ${item.serialId || '—'}`, `仓位 ${item.binId || '—'}`]}
                  metric={`${quantity(item.quantity)}`}
                />
              )) : <EmptyState title="该容器尚未装箱" />}
            </div>
            <button type="button" className="ghost" onClick={() => setContents(null)}>收起容器内容</button>
          </div>
        )}
      </InventoryWorkSection>
      {creating && (
        <InventoryContainerEditor warehouses={warehouses} notify={notify} onClose={() => setCreating(false)} onSaved={(created) => { setCreating(false); setContainers((rows) => [created, ...rows]); }} />
      )}
      {packing && (
        <InventoryContainerPackEditor
          container={packing}
          products={products}
          notify={notify}
          onClose={() => setPacking(null)}
          onSaved={(id) => { setPacking(null); void loadContents(id); }}
        />
      )}
      {transferTarget && (
        <Modal title="整体转移容器" onClose={() => setTransferTarget(null)}>
          <div className="inv-work-form">
            <InventoryWorkSelect label="目标仓库" required value="" onChange={() => {}} options={warehouseOptions(warehouses.filter((w) => w.id !== transferTarget.warehouseId))} />
            <p className="inv-work-hint">选择目标仓库后点击下方「确认转移」。</p>
            <FormActions onClose={() => setTransferTarget(null)} saveText="确认转移" danger />
          </div>
          <div className="inv-work-transfer">
            {warehouses.filter((w) => w.id !== transferTarget.warehouseId).map((w) => (
              <button key={w.id} type="button" className="secondary" onClick={() => transfer(w.id)}>转移到 {w.code} · {w.name}</button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function InventoryContainerEditor({ warehouses, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ containerNo: '', containerType: 'BOX', warehouseId: '' });
  const save = async (event) => {
    event.preventDefault();
    try {
      const created = await api('/api/inventory-containers', { method: 'POST', body: form });
      notify('容器已创建');
      onSaved({
        id: created.id,
        containerNo: form.containerNo,
        containerType: form.containerType,
        warehouseId: form.warehouseId,
        warehouseName: warehouses.find((w) => w.id === form.warehouseId)?.name,
        status: created.status || 'OPEN',
      });
    } catch (e) { notify(e.message || '容器创建失败', 'error'); }
  };
  return (
    <Modal title="新建包装容器" onClose={onClose}>
      <form className="inv-work-form" onSubmit={save}>
        <InventoryWorkInput label="容器编号" required value={form.containerNo} onChange={(v) => setForm({ ...form, containerNo: v })} placeholder="例如 CTR-0001" />
        <InventoryWorkSelect label="容器类型" value={form.containerType} onChange={(v) => setForm({ ...form, containerType: v })} options={[{ value: 'BOX', label: 'BOX · 箱' }, { value: 'PALLET', label: 'PALLET · 托盘' }, { value: 'CARTON', label: 'CARTON · 纸箱' }]} />
        <InventoryWorkSelect label="所属仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
        <FormActions onClose={onClose} saveText="创建容器" />
      </form>
    </Modal>
  );
}

function InventoryContainerPackEditor({ container, products, notify, onClose, onSaved }) {
  const [items, setItems] = useState([{ productId: '', quantity: '' }]);
  const update = (index, patch) => setItems(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const save = async (event) => {
    event.preventDefault();
    const payload = items.filter((row) => row.productId && row.quantity !== '').map((row) => ({ productId: row.productId, quantity: Number(row.quantity) }));
    if (!payload.length) { notify('请至少填写一行装箱明细', 'error'); return; }
    try {
      await api(`/api/inventory-containers/${container.id}/pack`, { method: 'POST', body: { items: payload } });
      notify('装箱完成');
      onSaved(container.id);
    } catch (e) { notify(e.message || '装箱失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title={`装箱 ${container.containerNo}`} onSubmit={save} submitLabel="确认装箱">
      <div className="inv-work-form-grid">
        {items.map((row, index) => (
          <div key={index} className="inv-work-line">
            <InventoryWorkSelect label={`第 ${index + 1} 行货品`} required value={row.productId} onChange={(v) => update(index, { productId: v })} options={productOptions(products)} />
            <InventoryWorkInput label="数量" type="number" min="0.0001" step="0.0001" required value={row.quantity} onChange={(v) => update(index, { quantity: v })} />
            {items.length > 1 && <button type="button" className="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>移除该行</button>}
          </div>
        ))}
      </div>
      <button type="button" className="secondary" onClick={() => setItems([...items, { productId: '', quantity: '' }])}>添加一行</button>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-40 / INV-41 / INV-43 — 扫码 (scan)
// ---------------------------------------------------------------------------

export function InventoryScan({ user, notify, references }) {
  const { warehouses, products, stockStatuses } = references;
  const [barcode, setBarcode] = useState('');
  const [source, setSource] = useState('SCAN');
  const [resolution, setResolution] = useState(null);
  const [validation, setValidation] = useState(null);
  const [duplicate, setDuplicate] = useState(null);
  const [positions, setPositions] = useState([]);
  const [filters, setFilters] = useState({ warehouseId: '', productId: '', binId: '', ownerType: '', ownerId: '', stockStatus: '', lotId: '', serialId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const resolveScan = async (event) => {
    event.preventDefault();
    if (!barcode.trim()) { notify('请输入或扫描条码', 'error'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/inventory/scan/resolve', { method: 'POST', body: { barcode: barcode.trim(), source } });
      setResolution(result.resolution || null);
      notify('条码已解析');
    } catch (e) { setResolution(null); setError(e.message || '条码解析失败'); notify(e.message || '条码解析失败', 'error'); }
    finally { setBusy(false); }
  };

  const validateScan = async () => {
    setBusy(true);
    try {
      const result = await api('/api/inventory/scan/validate', {
        method: 'POST',
        body: { barcode: barcode.trim(), position: { productId: filters.productId || undefined, warehouseId: filters.warehouseId || undefined } },
      });
      setValidation(result.validation || null);
      notify('扫描校验通过');
    } catch (e) { setValidation({ error: e.message || '扫描校验失败' }); notify(e.message || '扫描校验失败', 'error'); }
    finally { setBusy(false); }
  };

  const checkDuplicate = async () => {
    try {
      const result = await api(`/api/inventory/scan/duplicate?barcode=${encodeURIComponent(barcode.trim())}&source=${encodeURIComponent(source)}`);
      setDuplicate(result.duplicate);
      notify(result.duplicate ? '该条码在时间窗内重复扫描' : '未发现重复扫描');
    } catch (e) { notify(e.message || '重复扫描检查失败', 'error'); }
  };

  const queryScan = async () => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const result = await api(`/api/inventory/scan/query${params.toString() ? `?${params}` : ''}`);
      setPositions(result.positions || []);
    } catch (e) { notify(e.message || '扫码库存查询失败', 'error'); }
    finally { setBusy(false); }
  };

  const warehouseName = (id) => warehouses.find((w) => w.id === id)?.name || id || '—';
  const productName = (id) => products.find((p) => p.id === id)?.name || id || '—';

  return (
    <>
      <InventoryWorkSection title="扫码" description="条码解析、物理校验、重复扫描检测与扫码即时库存查询。">
        <form className="inv-work-lookup__form" onSubmit={resolveScan}>
          <label className="inv-work-field">
            <span>条码</span>
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="扫描或输入条码，例如 PRD-P-001" />
          </label>
          <InventoryWorkSelect label="扫描来源" value={source} onChange={setSource} options={[{ value: 'SCAN', label: 'SCAN · 通用扫描' }, { value: 'STOCKTAKE', label: 'STOCKTAKE · 盘点扫描' }, { value: 'INBOUND', label: 'INBOUND · 入库扫描' }, { value: 'OUTBOUND', label: 'OUTBOUND · 出库扫描' }]} />
          <button type="submit" className="primary" disabled={busy}>解析条码</button>
        </form>
        <div className="inv-work-tools">
          <button type="button" className="secondary" onClick={validateScan} disabled={busy || !barcode.trim()}>物理校验</button>
          <button type="button" className="secondary" onClick={checkDuplicate} disabled={!barcode.trim()}>重复检测</button>
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {resolution && (
          <div className="inv-work-subsection">
            <h4>解析结果</h4>
            <InventoryWorkFacts facts={[
              { label: '来源', value: resolution.source },
              { label: '对象类型', value: resolution.entityType || resolution.kind },
              { label: '对象 ID', value: resolution.entityId || '—' },
              { label: '规则', value: resolution.ruleCode || '—' },
            ]} />
          </div>
        )}
        {validation && (
          <div className="inv-work-subsection">
            <h4>校验结果</h4>
            {validation.error ? <InlineAlert tone="danger">{validation.error}</InlineAlert> : <InlineAlert tone="info">校验通过：{validation.parsed?.entityType} · {validation.parsed?.entityId}</InlineAlert>}
          </div>
        )}
        {duplicate !== null && (
          <div className="inv-work-subsection">
            <h4>重复扫描</h4>
            <InlineAlert tone={duplicate ? 'danger' : 'info'}>{duplicate ? '该条码在 5 分钟窗口内已扫描过。' : '未发现重复扫描。'}</InlineAlert>
          </div>
        )}
      </InventoryWorkSection>

      <InventoryWorkSection title="扫码即时库存查询" description="按库存身份过滤的扫码查询。">
        <div className="inv-work-form-grid">
          <InventoryWorkSelect label="仓库" value={filters.warehouseId} onChange={(v) => setFilters({ ...filters, warehouseId: v })} options={warehouseOptions(warehouses)} placeholder="全部仓库" />
          <InventoryWorkSelect label="货品" value={filters.productId} onChange={(v) => setFilters({ ...filters, productId: v })} options={productOptions(products)} placeholder="全部货品" />
          <InventoryWorkSelect label="所有权" value={filters.ownerType} onChange={(v) => setFilters({ ...filters, ownerType: v })} options={OWNER_TYPE_OPTIONS} placeholder="全部所有权" />
          <InventoryWorkSelect label="库存状态" value={filters.stockStatus} onChange={(v) => setFilters({ ...filters, stockStatus: v })} options={statusOptions(stockStatuses)} placeholder="全部状态" />
        </div>
        <button type="button" className="primary" onClick={queryScan} disabled={busy}>查询库存位置</button>
        {Boolean(positions.length) && (
          <div className="inv-work-list">
            {positions.map((row) => (
              <InventoryWorkRow
                key={row.id || row.positionKey}
                code={row.positionKey}
                title={`${productName(row.productId)} · ${warehouseName(row.warehouseId)}`}
                lines={[`仓位 ${row.binId || '—'}`, `所有权 ${row.ownerType}`, `状态 ${row.stockStatus || '—'}`, `批号 ${row.lotId || '—'} · 序列号 ${row.serialId || '—'}`]}
                metric={`${quantity(row.quantity)}`}
              />
            ))}
          </div>
        )}
      </InventoryWorkSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hub — the mobile work surface that hosts every capability above.
// ---------------------------------------------------------------------------

const WORK_TABS = [
  { key: 'instant', label: '即时库存' },
  { key: 'bins', label: '仓位' },
  { key: 'statuses', label: '库存状态' },
  { key: 'owners', label: '所有权' },
  { key: 'parameters', label: '库存参数' },
  { key: 'stocktake', label: '盘点' },
  { key: 'lot', label: '批号调整' },
  { key: 'form', label: '形态转换' },
  { key: 'assembly', label: '组装拆卸' },
  { key: 'abc', label: 'ABC' },
  { key: 'barcode', label: '条码' },
  { key: 'containers', label: '容器' },
  { key: 'scan', label: '扫码' },
  { key: 'transfer', label: '调拨' },
  { key: 'adjustment', label: '调整' },
  { key: 'initialization', label: '初始化与期初' },
  { key: 'native', label: '其他出入库' },
  { key: 'step', label: '分步调拨' },
  { key: 'status', label: '状态调整' },
  { key: 'locks', label: '锁库' },
  { key: 'reports', label: '库存报表' },
];

export function InventoryWork({ user, notify }) {
  const navigation = useAppNavigation();
  const [tab, setTab] = useState('instant');
  const [screen, setScreen] = useState(null);
  const references = useInventoryReferences(notify);
  const { warehouses, products } = references;
  // The detail and the editor replace the whole work surface, so the shell
  // has to carry the way back.
  useEffect(() => {
    const handler = screen ? () => setScreen(null) : null;
    navigation.setHeaderBackAction?.(handler);
    return () => navigation.setHeaderBackAction?.(null);
  }, [screen, navigation.setHeaderBackAction]);

  // The transfer and adjustment documents keep the LIST → DETAIL → EDITOR
  // chain of the rest of the domain: the detail and the editor replace the
  // work surface, exactly like every other inventory document here.
  if (screen?.kind === 'transfer') {
    return screen.mode === 'editor'
      ? <InventoryTransferEditorV16 warehouses={warehouses} products={products} notify={notify} onSaved={() => setScreen(null)} />
      : <InventoryTransferDetailV16 user={user} value={screen.value} notify={notify} onChanged={() => setScreen(null)} />;
  }
  if (screen?.kind === 'adjustment') {
    return screen.mode === 'editor'
      ? <InventoryAdjustmentEditorV16 value={screen.value} warehouses={warehouses} products={products} notify={notify} onSaved={() => setScreen(null)} />
      : <InventoryAdjustmentDetailV16 value={screen.value} notify={notify} onEdit={() => setScreen({ kind: 'adjustment', mode: 'editor', value: screen.value })} onChanged={() => setScreen(null)} />;
  }

  return (
    <BusinessPageShell className="v16-inventory-shell inv-work" width="rail">
      <nav className="inv-work-tabs" aria-label="库存控制">
        {WORK_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? 'is-active' : ''}
            aria-current={tab === item.key ? 'page' : undefined}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === 'instant' && <InventoryInstantQuery user={user} notify={notify} references={references} />}
      {tab === 'bins' && <InventoryBins user={user} notify={notify} references={references} />}
      {tab === 'statuses' && <InventoryStockStatuses user={user} notify={notify} references={references} />}
      {tab === 'owners' && <InventoryOwnerDimension user={user} notify={notify} />}
      {tab === 'parameters' && <InventoryParameters user={user} notify={notify} />}
      {tab === 'stocktake' && <InventoryStocktake user={user} notify={notify} references={references} />}
      {tab === 'lot' && <InventoryLotAdjustment user={user} notify={notify} references={references} />}
      {tab === 'form' && <InventoryFormConversion user={user} notify={notify} references={references} />}
      {tab === 'assembly' && <InventoryAssembly user={user} notify={notify} references={references} />}
      {tab === 'abc' && <InventoryAbc user={user} notify={notify} references={references} />}
      {tab === 'barcode' && <InventoryBarcode user={user} notify={notify} references={references} />}
      {tab === 'containers' && <InventoryContainers user={user} notify={notify} references={references} />}
      {tab === 'scan' && <InventoryScan user={user} notify={notify} references={references} />}
      {tab === 'transfer' && <InventoryTransferListV16 user={user} notify={notify} onOpen={(value) => setScreen({ kind: 'transfer', mode: 'detail', value })} onCreate={() => setScreen({ kind: 'transfer', mode: 'editor' })} />}
      {tab === 'adjustment' && <InventoryAdjustmentListV16 user={user} notify={notify} onOpen={(value) => setScreen({ kind: 'adjustment', mode: 'detail', value })} onCreate={() => setScreen({ kind: 'adjustment', mode: 'editor', value: null })} />}
      {tab === 'initialization' && <InventoryInitialization user={user} notify={notify} references={references} />}
      {tab === 'native' && <InventoryNativeDocuments user={user} notify={notify} references={references} />}
      {tab === 'step' && <InventoryStepTransfer user={user} notify={notify} references={references} />}
      {tab === 'status' && <InventoryStatusChange user={user} notify={notify} references={references} />}
      {tab === 'locks' && <InventoryLocks user={user} notify={notify} references={references} />}
      {tab === 'reports' && <InventoryReports user={user} notify={notify} />}
    </BusinessPageShell>
  );
}

export default InventoryWork;

// ---------------------------------------------------------------------------
// INV-15 direct transfer and INV-21 inventory adjustment surfaces.
//
// Moved here from master-data.jsx: the Inventory & Warehouse domain owns one
// work surface, so the transfer and adjustment documents live beside the
// other inventory documents instead of behind a second route.
// ---------------------------------------------------------------------------
const INVENTORY_STATUS = {
  DRAFT: '草稿', TRANSFERRED: '已调拨', CANCELLED: '已取消', SUBMITTED: '审批中', APPROVED: '已审核', CONFIRMED: '已确认',
};

const transferStatusLabel = (status) => status === 'SUBMITTED' ? '历史待审核' : status === 'APPROVED' ? '历史已审核' : INVENTORY_STATUS[status] || '未知状态';

const businessDate = (value) => value || '业务日期缺失';

const InventoryState = ({ loading, error, empty, filtered, onRetry, children }) => loading ? <Loading/> : error ? <EmptyState title="加载失败" description={error} action={<button className="secondary" onClick={onRetry}>重试</button>}/> : empty ? <EmptyState title={filtered ? '没有匹配结果' : '暂无记录'} description={filtered ? '请调整搜索或筛选条件。' : undefined}/> : children;

function InventoryRowV16({ code, title, status, lines, metric, onClick }) { return <button type="button" className="v16-inventory-row" onClick={onClick}><span className="v16-inventory-row__body"><span className="v16-inventory-row__top"><b className="mono">{code || '—'}</b>{status}</span><strong>{title}</strong>{lines.map((line, index) => <small key={index}>{line}</small>)}{metric && <b className="v16-inventory-row__metric">{metric}</b>}</span><Icon name="chevron" size={18}/></button>; }

function InventoryIdentityV16({ code, title, status, subtitle }) { return <header className="v16-inventory-identity"><div><span className="mono">{code}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{status}</header>; }

function InventoryFactsV16({ facts }) { return <dl className="v16-inventory-facts">{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value ?? '—'}</dd></div>)}</dl>; }

function useInventoryDocuments(endpoint, key, status, notify) {
  const [rows, setRows] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = () => { setLoading(true); setError(''); api(`${endpoint}${status ? `?status=${status}` : ''}`).then((r) => setRows(r[key] || [])).catch((e) => { setError(e.message); notify(e.message, 'error'); }).finally(() => setLoading(false)); };
  useEffect(() => { void load(); }, [status]); return { rows, loading, error, load };
}

function InventoryDocumentToolbarV16({ options, status, setStatus, canCreate, createLabel, onCreate }) { return <div className="v16-inventory-document-tools"><SegmentedControl options={options} value={status} onChange={setStatus}/>{canCreate && <button className="primary" onClick={onCreate} aria-label={createLabel}>新建</button>}</div>; }

function InventoryTransferListV16({ user, notify, onOpen, onCreate }) {
  const [status, setStatus] = useState(''); const state = useInventoryDocuments('/api/inventory-transfers', 'inventoryTransfers', status, notify);
  return <><InventoryDocumentToolbarV16 options={[['','全部'],['DRAFT','草稿'],['TRANSFERRED','已调拨'],['CANCELLED','已取消']].map(([value,label]) => ({ value, label }))} status={status} setStatus={setStatus} canCreate={can(user, 'INVENTORY_TRANSFER_CREATE')} createLabel="新建库存调拨" onCreate={onCreate}/><InventoryState {...state} empty={!state.rows.length} filtered={Boolean(status)} onRetry={state.load}><div className="v16-inventory-list">{state.rows.map((row) => <InventoryRowV16 key={row.id} code={row.transfer_no} title={`${row.fromWarehouseName} → ${row.toWarehouseName}`} status={<StatusChip status={row.status}>{transferStatusLabel(row.status)}</StatusChip>} lines={[businessDate(row.business_date), `${row.itemCount || 0} 项 · ${row.creatorName}`]} onClick={() => onOpen(row)}/>)}</div></InventoryState></>;
}

function InventoryTransferDetailV16({ user, value, notify, onChanged }) {
  const [detail, setDetail] = useState(null); const [confirm, setConfirm] = useState(null); const load = () => api(`/api/inventory-transfers/${value.id}`).then((r) => setDetail(r.transfer)).catch((e) => notify(e.message, 'error')); useEffect(() => { void load(); }, []);
  const canConfirmTransfer = can(user, 'INVENTORY_TRANSFER_CONFIRM') || can(user, 'INVENTORY_TRANSFER_APPROVE'); const canCancelTransfer = can(user, 'INVENTORY_TRANSFER_CREATE');
  const changeState = async (action) => { try { await api(`/api/inventory-transfers/${value.id}/${action}`, { method: 'POST' }); notify(action === 'transfer' ? '调拨已确认' : '调拨已取消'); onChanged(); } catch (e) { notify(e.message, 'error'); } };
  if (!detail) return <BusinessPageShell className="v16-inventory-shell" width="rail"><Loading/></BusinessPageShell>;
  const legacy = ['SUBMITTED','APPROVED'].includes(detail.status);
  return <BusinessPageShell className="v16-inventory-shell v16-inventory-detail" width="rail"><InventoryIdentityV16 code={detail.transfer_no} title={`${detail.fromWarehouseName} → ${detail.toWarehouseName}`} status={<StatusChip status={detail.status}>{transferStatusLabel(detail.status)}</StatusChip>}/><InventoryFactsV16 facts={[{ label: '业务日期', value: businessDate(detail.business_date) }, { label: '制单人', value: detail.creatorName }, { label: '执行人', value: detail.reviewerName || '—' }, { label: '备注', value: detail.remark || '—' }]}/><InventoryLineSectionV16 items={detail.items} quantityKey="quantity"/>{legacy && <InlineAlert tone="info">历史状态只读，不提供确认或取消动作。</InlineAlert>}{detail.status === 'DRAFT' && <BottomActionBar>{canCancelTransfer && <button className="danger-button" onClick={() => setConfirm('cancel')}>取消调拨</button>}{canConfirmTransfer && <button className="confirm-button" onClick={() => setConfirm('transfer')}>确认调拨</button>}</BottomActionBar>}{confirm === 'transfer' && <ConfirmSheet title="确认调拨？" message="确认后将按本单明细执行仓库间库存移动。" confirmLabel="确认调拨" onClose={() => setConfirm(null)} onConfirm={() => void changeState('transfer')}/>} {confirm === 'cancel' && <DangerSheet title="取消调拨？" message="取消后该草稿不再执行库存移动。" confirmLabel="取消调拨" onClose={() => setConfirm(null)} onConfirm={() => void changeState('cancel')}/>}</BusinessPageShell>;
}

function InventoryTransferEditorV16({ warehouses, products, notify, onSaved }) {
  const [form, setForm] = useState({ fromWarehouseId: '', toWarehouseId: '', businessDate: todayIso(), remark: '', items: [{ productId: '', quantity: 1, trackingAllocations: [] }] });
  const update = (i, patch) => setForm({ ...form, items: form.items.map((row, index) => index === i ? { ...row, ...patch } : row) });
  const save = async (event) => { event.preventDefault(); if (form.fromWarehouseId === form.toWarehouseId) return notify('调出仓库和调入仓库不能相同', 'error'); try { const result = await api('/api/inventory-transfers', { method: 'POST', body: form }); notify('调拨草稿已保存'); onSaved({ id: result.id }); } catch (e) { notify(e.message, 'error'); } };
  return <InventoryEditorShellV16 title="新建调拨" onSubmit={save}><div className="v16-inventory-form-grid"><label>业务日期<input type="date" required value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })}/></label><label>调出仓库<select required value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })}><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>调入仓库<select required value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })}><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}/></label></div><InventoryLinesEditorV16 items={form.items} products={products} onAdd={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1, trackingAllocations: [] }] })} onRemove={(i) => setForm({ ...form, items: form.items.filter((_, index) => index !== i) })} render={(row, i) => <><select required value={row.productId} onChange={(e) => update(i, withProductTracking(row, e.target.value))}><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input aria-label="调拨数量" type="number" min="0.01" step="0.01" required value={row.quantity} onChange={(e) => update(i, { quantity: e.target.value, trackingAllocations: [] })}/><TrackingAllocationEditor product={products.find((p) => p.id === row.productId)} warehouseId={form.fromWarehouseId} quantity={row.quantity} businessDate={form.businessDate} direction="OUT" value={row.trackingAllocations || []} onChange={(trackingAllocations) => update(i, { trackingAllocations })} notify={notify}/></>}/></InventoryEditorShellV16>;
}

function InventoryAdjustmentListV16({ user, notify, onOpen, onCreate }) { const [status, setStatus] = useState(''); const state = useInventoryDocuments('/api/inventory-adjustments', 'inventoryAdjustments', status, notify); if (!can(user, 'INVENTORY_ADJUSTMENT_MANAGE')) return <EmptyState title="暂无调整权限"/>; return <><InventoryDocumentToolbarV16 options={[['','全部'],['DRAFT','草稿'],['CONFIRMED','已确认'],['CANCELLED','已取消']].map(([value,label]) => ({ value, label }))} status={status} setStatus={setStatus} canCreate onCreate={onCreate} createLabel="新建库存调整"/><InventoryState {...state} empty={!state.rows.length} filtered={Boolean(status)} onRetry={state.load}><div className="v16-inventory-list">{state.rows.map((row) => <InventoryRowV16 key={row.id} code={row.adjustment_no} title={row.warehouseName} status={<StatusChip status={row.status}>{INVENTORY_STATUS[row.status]}</StatusChip>} lines={[businessDate(row.adjustment_date), `${row.itemCount} 项 · ${row.reason}`]} onClick={() => onOpen(row)}/>)}</div></InventoryState></>; }

function InventoryAdjustmentDetailV16({ value, notify, onEdit, onChanged }) { const [detail, setDetail] = useState(null); const [action, setAction] = useState(null); const load = () => api(`/api/inventory-adjustments/${value.id}`).then((r) => setDetail(r.inventoryAdjustment)).catch((e) => notify(e.message, 'error')); useEffect(() => { void load(); }, []); const change = async (name) => { try { await api(`/api/inventory-adjustments/${value.id}/${name}`, { method: 'POST' }); notify(name === 'confirm' ? '库存调整已确认' : '库存调整已取消'); onChanged(); } catch (e) { notify(e.message, 'error'); } }; if (!detail) return <BusinessPageShell className="v16-inventory-shell" width="rail"><Loading/></BusinessPageShell>; return <BusinessPageShell className="v16-inventory-shell v16-inventory-detail" width="rail"><InventoryIdentityV16 code={detail.adjustment_no} title={detail.warehouseName} status={<StatusChip status={detail.status}>{INVENTORY_STATUS[detail.status]}</StatusChip>}/><InventoryFactsV16 facts={[{ label: '调整日期', value: businessDate(detail.adjustment_date) }, { label: '调整原因', value: detail.reason }, { label: '制单人', value: detail.creatorName }, { label: '确认人', value: detail.confirmedByName || '—' }]}/><InventoryLineSectionV16 items={detail.items} quantityKey="quantityDelta" signed/>{detail.status === 'DRAFT' && <BottomActionBar><button className="secondary" onClick={onEdit}>编辑草稿</button><ConfirmDelete label="库存调整单" onConfirm={async () => { await api(`/api/inventory-adjustments/${detail.id}`, { method: 'DELETE' }); notify('库存调整草稿已删除'); onChanged(); }}/><button className="danger-button" onClick={() => setAction('cancel')}>取消调整</button><button className="confirm-button" onClick={() => setAction('confirm')}>确认调整</button></BottomActionBar>}{action === 'confirm' && <ConfirmSheet title="确认库存调整？" message="确认后将按有符号调整数量更新库存。" confirmLabel="确认调整" onClose={() => setAction(null)} onConfirm={() => void change('confirm')}/>} {action === 'cancel' && <DangerSheet title="取消库存调整？" message="取消后草稿不可再执行。" confirmLabel="取消调整" onClose={() => setAction(null)} onConfirm={() => void change('cancel')}/>}</BusinessPageShell>; }

function InventoryAdjustmentEditorV16({ value, warehouses, products, notify, onSaved }) { const initial = value.items?.map((item) => ({ productId: item.productId, quantityDelta: item.quantityDelta, trackingAllocations: item.trackingAllocations || [] })) || [{ productId: '', quantityDelta: '', trackingAllocations: [] }]; const [form, setForm] = useState({ warehouseId: value.warehouse_id || '', adjustmentDate: value.adjustment_date || todayIso(), reason: value.reason || '', items: initial }); const update = (i, patch) => setForm({ ...form, items: form.items.map((row, index) => index === i ? { ...row, ...patch } : row) }); const save = async (event) => { event.preventDefault(); try { await api(value.id ? `/api/inventory-adjustments/${value.id}` : '/api/inventory-adjustments', { method: value.id ? 'PATCH' : 'POST', body: form }); notify('库存调整草稿已保存'); onSaved(); } catch (e) { notify(e.message, 'error'); } }; return <InventoryEditorShellV16 title={value.id ? '编辑库存调整' : '新建库存调整'} onSubmit={save}><div className="v16-inventory-form-grid"><label>调整日期<input type="date" required value={form.adjustmentDate} onChange={(e) => setForm({ ...form, adjustmentDate: e.target.value })}/></label><label>仓库<select required value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>调整原因<input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}/></label></div><InventoryLinesEditorV16 items={form.items} products={products} onAdd={() => setForm({ ...form, items: [...form.items, { productId: '', quantityDelta: '', trackingAllocations: [] }] })} onRemove={(i) => setForm({ ...form, items: form.items.filter((_, index) => index !== i) })} render={(row, i) => <><select required value={row.productId} onChange={(e) => update(i, withProductTracking(row, e.target.value))}><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input aria-label="有符号调整数量" type="number" step="0.01" required value={row.quantityDelta} onChange={(e) => update(i, { quantityDelta: e.target.value, trackingAllocations: [] })}/><TrackingAllocationEditor product={products.find((p) => p.id === row.productId)} warehouseId={form.warehouseId} quantity={Math.abs(Number(row.quantityDelta) || 0)} businessDate={form.adjustmentDate} direction={Number(row.quantityDelta) >= 0 ? 'IN' : 'OUT'} value={row.trackingAllocations || []} onChange={(trackingAllocations) => update(i, { trackingAllocations })} notify={notify}/></>}/></InventoryEditorShellV16>; }

function InventoryEditorShellV16({ title, onSubmit, children }) { return <BusinessPageShell className="v16-inventory-shell v16-inventory-editor" width="rail"><form onSubmit={onSubmit}><h2>{title}</h2>{children}<BottomActionBar><button className="primary">保存草稿</button></BottomActionBar></form></BusinessPageShell>; }

function InventoryLinesEditorV16({ items, products, onAdd, onRemove, render }) { return <section className="v16-inventory-section"><header><h3>明细</h3><button type="button" className="secondary" onClick={onAdd}>添加一行</button></header><div className="v16-inventory-lines">{items.map((row, index) => <article key={index}><div className="v16-inventory-line-head"><b>第 {index + 1} 行</b><button type="button" className="ghost" disabled={items.length === 1} onClick={() => onRemove(index)}>移除</button></div>{render(row, index, products)}</article>)}</div></section>; }

function InventoryLineSectionV16({ items = [], quantityKey, signed = false }) { return <section className="v16-inventory-section"><h3>明细</h3><div className="v16-inventory-list">{items.map((item, index) => { const amount = Number(item[quantityKey] || 0); return <div className="v16-inventory-line" key={item.id || index}><div><b>{item.productName}</b><small className="mono">{item.productCode}</small></div><strong className={amount < 0 ? 'negative' : amount > 0 && signed ? 'positive' : ''}>{signed && amount > 0 ? '+' : ''}{quantity(amount)} {item.unit || ''}</strong></div>; })}</div></section>; }

// ---------------------------------------------------------------------------
// INV-09 / INV-10 / INV-11 — 库存初始化 · 期初 · 初始化关闭
//
// The initialization state is the authority for whether opening inventory may
// be recorded at all. The closing of the initialization is what forbids the
// ordinary rewrite of the opening balance afterwards.
// ---------------------------------------------------------------------------

export function InventoryInitialization({ user, notify, references }) {
  const { warehouses, products } = references;
  const [state, setState] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api('/api/inventory-initialization').catch(() => ({ initialization: null })),
      api('/api/inventory/opening-documents').catch(() => ({ openingDocuments: [] })),
    ]).then(([init, docs]) => {
      setState(init.initialization || null);
      setDocuments(docs.openingDocuments || []);
    }).catch((e) => { setError(e.message || '初始化状态加载失败'); notify(e.message || '初始化状态加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const act = async (action) => {
    try {
      const body = action === 'reopen' ? { reason } : {};
      const result = await api(`/api/inventory-initialization/${action}`, { method: 'POST', body });
      setState(result.initialization || null);
      notify(action === 'open' ? '库存初始化已开启' : action === 'close' ? '库存初始化已关闭' : '库存初始化已重新开启');
      load();
    } catch (e) { notify(e.message || '初始化操作失败', 'error'); }
  };

  const confirm = async () => {
    try {
      await api(`/api/inventory/opening-documents/${confirming.id}/confirm`, { method: 'POST' });
      notify('期初单据已确认，期初余额已生效');
      setConfirming(null);
      load();
    } catch (e) { notify(e.message || '期初单据确认失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_OPENING_MANAGE');
  return (
    <InventoryWorkSection
      title="库存初始化与期初"
      description="初始化状态决定期初是否可录；关闭后不得再以普通草稿改写期初余额。"
      actions={canManage && state?.status !== 'OPEN' ? <button type="button" className="primary" onClick={() => act('open')}>开启初始化</button> : null}
    >
      <InventoryWorkState loading={loading} error={error} onRetry={load} empty={false}>
        <div className="inv-work-list">
          <InventoryWorkRow
            code={state?.id || '—'}
            title={`初始化状态：${state?.status || '未知'}`}
            lines={[`启用日期 ${state?.enabled_at || '—'}`, `状态 ${state?.status || '—'}`]}
            onEdit={canManage ? (
              <div className="inv-work-row__buttons">
                {state?.status === 'OPEN' && <button type="button" className="secondary" onClick={() => act('close')}>关闭初始化</button>}
                {state?.status !== 'OPEN' && <button type="button" className="secondary" onClick={() => act('reopen')}>重新开启</button>}
                {state?.status === 'OPEN' && <button type="button" className="primary" onClick={() => setCreating(true)}>录入期初</button>}
              </div>
            ) : null}
          />
        </div>
        {canManage && state?.status !== 'OPEN' && (
          <div className="inv-work-form-grid">
            <InventoryWorkInput label="重新开启原因" value={reason} onChange={setReason} placeholder="必填：重新开启初始化的原因" />
          </div>
        )}
        <div className="inv-work-subsection">
          <h4>期初单据</h4>
          <div className="inv-work-list">
            {documents.length ? documents.map((doc) => (
              <InventoryWorkRow
                key={doc.id}
                code={doc.docNo}
                title={`期初单据 · ${doc.items.length} 项`}
                status={<StatusChip status={doc.status}>{doc.status === 'DRAFT' ? '草稿' : doc.status === 'CONFIRMED' ? '已确认' : doc.status}</StatusChip>}
                lines={[`业务日期 ${doc.businessDate || '—'}`, `制单人 ${doc.creatorName || '—'}`, `数量合计 ${quantity(doc.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}`]}
                onEdit={canManage && doc.status === 'DRAFT' ? <button type="button" className="primary" onClick={() => setConfirming(doc)}>确认</button> : null}
              />
            )) : <EmptyState title="暂无期初单据" />}
          </div>
        </div>
      </InventoryWorkState>
      {creating && (
        <InventoryOpeningEditor
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {confirming && (
        <DangerSheet
          title="确认期初单据？"
          message={`期初单据 ${confirming.docNo} 确认后将按规范库存异动写入期初余额。`}
          confirmLabel="确认期初"
          onClose={() => setConfirming(null)}
          onConfirm={confirm}
        />
      )}
    </InventoryWorkSection>
  );
}

function InventoryOpeningEditor({ warehouses, products, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ businessDate: todayIso(), notes: '', items: [{ productId: '', warehouseId: '', quantity: '' }] });
  const update = (index, patch) => setForm({ ...form, items: form.items.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const save = async (event) => {
    event.preventDefault();
    const items = form.items
      .filter((row) => row.productId && row.warehouseId && row.quantity !== '')
      .map((row) => ({ productId: row.productId, warehouseId: row.warehouseId, quantity: Number(row.quantity) }));
    if (!items.length) { notify('请至少填写一行有效期初明细', 'error'); return; }
    try {
      await api('/api/inventory/opening-documents', {
        method: 'POST',
        body: { businessDate: form.businessDate, notes: form.notes, items },
      });
      notify('期初单据已保存');
      onSaved();
    } catch (e) { notify(e.message || '期初单据保存失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title="录入期初库存" onSubmit={save} submitLabel="保存期初单据">
      <div className="inv-work-form-grid">
        <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
        <InventoryWorkInput label="备注" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
      </div>
      <section className="inv-work-subsection">
        <header className="inv-work-section__head">
          <h4>期初明细</h4>
          <button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', warehouseId: '', quantity: '' }] })}>添加一行</button>
        </header>
        {form.items.map((row, index) => (
          <article key={index} className="inv-work-line">
            <header><b>第 {index + 1} 行</b><button type="button" className="ghost" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>移除</button></header>
            <div className="inv-work-form-grid">
              <InventoryWorkSelect label="货品" required value={row.productId} onChange={(v) => update(index, { productId: v })} options={productOptions(products)} />
              <InventoryWorkSelect label="仓库" required value={row.warehouseId} onChange={(v) => update(index, { warehouseId: v })} options={warehouseOptions(warehouses)} />
              <InventoryWorkInput label="期初数量" type="number" min="0.01" step="0.01" required value={row.quantity} onChange={(v) => update(index, { quantity: v })} />
            </div>
          </article>
        ))}
      </section>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-12 / INV-13 / INV-14 — 其他入库 · 其他出库 · 受托料登记
//
// The owner dimension is part of the native document line, so an entrusted
// receipt (customer-owned at an enterprise warehouse) is recorded through the
// same document as an ordinary other receipt — never as enterprise stock.
// ---------------------------------------------------------------------------

export function InventoryNativeDocuments({ user, notify, references }) {
  const { warehouses, products } = references;
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory/native-documents')
      .then((data) => setDocuments(data.nativeDocuments || []))
      .catch((e) => { setError(e.message || '库存原生单据加载失败'); notify(e.message || '库存原生单据加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    try {
      await api(`/api/inventory/native-documents/${confirming.id}/confirm`, { method: 'POST' });
      notify('库存原生单据已确认，数量已生效');
      setConfirming(null);
      load();
    } catch (e) { notify(e.message || '库存原生单据确认失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_NATIVE_DOCUMENT_MANAGE');
  return (
    <InventoryWorkSection
      title="其他入库 / 其他出库 / 受托料"
      description="库存原生单据：不伪装成采购收货或销售出库；受托料以 CUSTOMER 所有权登记在企业仓库。"
      actions={canManage ? <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 新建库存单据</button> : null}
    >
      <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!documents.length}>
        <div className="inv-work-list">
          {documents.map((doc) => (
            <InventoryWorkRow
              key={doc.id}
              code={doc.docNo}
              title={`${doc.docKind === 'OTHER_RECEIPT' ? '其他入库' : '其他出库'} · ${doc.items.length} 项`}
              status={<StatusChip status={doc.status}>{doc.status === 'DRAFT' ? '草稿' : doc.status === 'CONFIRMED' ? '已确认' : doc.status}</StatusChip>}
              lines={[`业务日期 ${doc.businessDate || '—'}`, `制单人 ${doc.creatorName || '—'}`, doc.reason ? `原因 ${doc.reason}` : null]}
              metric={quantity(doc.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))}
              onEdit={canManage && doc.status === 'DRAFT' ? <button type="button" className="primary" onClick={() => setConfirming(doc)}>确认</button> : null}
            />
          ))}
        </div>
      </InventoryWorkState>
      {creating && (
        <InventoryNativeDocumentEditor
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {confirming && (
        <DangerSheet
          title="确认库存原生单据？"
          message={`单据 ${confirming.docNo} 确认后将按规范库存异动生效。`}
          confirmLabel="确认单据"
          onClose={() => setConfirming(null)}
          onConfirm={confirm}
        />
      )}
    </InventoryWorkSection>
  );
}

function InventoryNativeDocumentEditor({ warehouses, products, notify, onClose, onSaved }) {
  const [form, setForm] = useState({
    docKind: 'OTHER_RECEIPT', businessDate: todayIso(), reason: '', notes: '',
    items: [{ productId: '', warehouseId: '', quantity: '', ownerType: 'ENTERPRISE' }],
  });
  const update = (index, patch) => setForm({ ...form, items: form.items.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const save = async (event) => {
    event.preventDefault();
    const items = form.items
      .filter((row) => row.productId && row.warehouseId && row.quantity !== '')
      .map((row) => ({
        productId: row.productId, warehouseId: row.warehouseId, quantity: Number(row.quantity),
        ownerType: row.ownerType || 'ENTERPRISE',
      }));
    if (!items.length) { notify('请至少填写一行有效明细', 'error'); return; }
    try {
      await api('/api/inventory/native-documents', {
        method: 'POST',
        body: { docKind: form.docKind, businessDate: form.businessDate, reason: form.reason, notes: form.notes, items },
      });
      notify('库存原生单据已保存');
      onSaved();
    } catch (e) { notify(e.message || '库存原生单据保存失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title="新建库存原生单据" onSubmit={save} submitLabel="保存单据">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="单据类型" value={form.docKind} onChange={(v) => setForm({ ...form, docKind: v })} options={[{ value: 'OTHER_RECEIPT', label: 'OTHER_RECEIPT · 其他入库' }, { value: 'OTHER_ISSUE', label: 'OTHER_ISSUE · 其他出库' }]} />
        <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
        <InventoryWorkInput label="原因" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
      </div>
      <section className="inv-work-subsection">
        <header className="inv-work-section__head">
          <h4>明细</h4>
          <button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', warehouseId: '', quantity: '', ownerType: 'ENTERPRISE' }] })}>添加一行</button>
        </header>
        {form.items.map((row, index) => (
          <article key={index} className="inv-work-line">
            <header><b>第 {index + 1} 行</b><button type="button" className="ghost" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>移除</button></header>
            <div className="inv-work-form-grid">
              <InventoryWorkSelect label="货品" required value={row.productId} onChange={(v) => update(index, { productId: v })} options={productOptions(products)} />
              <InventoryWorkSelect label="仓库" required value={row.warehouseId} onChange={(v) => update(index, { warehouseId: v })} options={warehouseOptions(warehouses)} />
              <InventoryWorkInput label="数量" type="number" min="0.01" step="0.01" required value={row.quantity} onChange={(v) => update(index, { quantity: v })} />
              <InventoryWorkSelect label="所有权" value={row.ownerType} onChange={(v) => update(index, { ownerType: v })} options={OWNER_TYPE_OPTIONS} />
            </div>
          </article>
        ))}
      </section>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-16 — 分步调拨（在途）
//
// The step transfer issues the goods into the in-transit state first and
// receives them into the destination warehouse afterwards. The in-transit
// quantity is explicit.
// ---------------------------------------------------------------------------

export function InventoryStepTransfer({ user, notify, references }) {
  const { products } = references;
  const [transfers, setTransfers] = useState([]);
  const [rows, setRows] = useState([]);
  const [transferId, setTransferId] = useState('');
  const [form, setForm] = useState({ productId: '', quantity: '', businessDate: todayIso() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTransfers = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory-transfers?status=DRAFT')
      .then((data) => {
        const list = data.inventoryTransfers || [];
        setTransfers(list);
        setTransferId((current) => current || list[0]?.id || '');
      })
      .catch((e) => { setError(e.message || '调拨单加载失败'); notify(e.message || '调拨单加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void loadTransfers(); }, [loadTransfers]);

  const loadInTransit = useCallback(() => {
    if (!transferId) { setRows([]); return; }
    api(`/api/inventory-step-transfers/in-transit?stepTransferId=${encodeURIComponent(transferId)}`)
      .then((data) => setRows(data.stepTransfers || []))
      .catch(() => setRows([]));
  }, [transferId]);
  useEffect(() => { void loadInTransit(); }, [loadInTransit]);

  const chosen = transfers.find((item) => item.id === transferId);
  const issue = async () => {
    try {
      await api('/api/inventory-step-transfers/out', {
        method: 'POST',
        body: {
          sourceTransferId: transferId, productId: form.productId, quantity: Number(form.quantity),
          fromWarehouseId: chosen?.from_warehouse_id, toWarehouseId: chosen?.to_warehouse_id,
          businessDate: form.businessDate,
        },
      });
      notify('已发出调拨，货量进入在途');
      loadInTransit();
    } catch (e) { notify(e.message || '调拨发出失败', 'error'); }
  };
  const receive = async () => {
    try {
      await api('/api/inventory-step-transfers/in', {
        method: 'POST',
        body: {
          sourceTransferId: transferId, productId: form.productId, quantity: Number(form.quantity),
          fromWarehouseId: chosen?.from_warehouse_id, toWarehouseId: chosen?.to_warehouse_id,
          businessDate: form.businessDate,
        },
      });
      notify('在途货量已入目标仓');
      loadInTransit();
    } catch (e) { notify(e.message || '调拨接收失败', 'error'); }
  };

  const canExecute = can(user, 'INVENTORY_TRANSFER_CONFIRM');
  return (
    <InventoryWorkSection
      title="分步调拨（发出 → 在途 → 接收）"
      description="源仓与目标仓不能同时完成移动时，先发出进入在途，再由目标仓接收；在途量显式。"
    >
      <InventoryWorkState loading={loading} error={error} onRetry={loadTransfers} empty={!transfers.length}>
        <div className="inv-work-form-grid">
          <InventoryWorkSelect label="来源调拨单" value={transferId} onChange={setTransferId} options={transfers.map((item) => ({ value: item.id, label: `${item.transfer_no}` }))} />
          <InventoryWorkSelect label="货品" required value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={productOptions(products)} />
          <InventoryWorkInput label="数量" type="number" min="0.01" step="0.01" required value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
          <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
        </div>
        {canExecute && chosen && (
          <div className="inv-work-row__buttons">
            <button type="button" className="secondary" onClick={issue}>调出（进入在途）</button>
            <button type="button" className="primary" onClick={receive}>调入（离开在途）</button>
          </div>
        )}
        <div className="inv-work-subsection">
          <h4>在途量</h4>
          <div className="inv-work-list">
            {rows.length ? rows.map((row) => (
              <InventoryWorkRow
                key={`${row.sourceTransferId}-${row.productId}`}
                code={row.productId}
                title={`在途 ${row.warehouseIdSource} → ${row.warehouseIdDestination}`}
                status={<StatusChip status={row.status}>{row.status}</StatusChip>}
                lines={[`已发出 ${quantity(row.issuedQty)}`, `已接收 ${quantity(row.receivedQty)}`]}
                metric={`${quantity(row.inTransitQty)} 在途`}
              />
            )) : <EmptyState title="该调拨单当前没有在途量" />}
          </div>
        </div>
      </InventoryWorkState>
    </InventoryWorkSection>
  );
}

// ---------------------------------------------------------------------------
// INV-19 — 库存状态调整
//
// A status change moves the same quantity between two statuses at the same
// owner and location: the quantity, the owner and the location do not change.
// ---------------------------------------------------------------------------

export function InventoryStatusChange({ user, notify, references }) {
  const { warehouses, products, stockStatuses } = references;
  const [form, setForm] = useState({ warehouseId: '', productId: '', quantity: '', fromStatus: 'AVAILABLE', toStatus: '', businessDate: todayIso(), reason: '' });

  const submit = async (event) => {
    event.preventDefault();
    if (!form.warehouseId || !form.productId || !form.toStatus) { notify('请选择仓库、货品与目标状态', 'error'); return; }
    try {
      await api('/api/inventory-stock-status-changes', {
        method: 'POST',
        body: {
          warehouseId: form.warehouseId, productId: form.productId,
          quantity: Number(form.quantity || 0), fromStatus: form.fromStatus, toStatus: form.toStatus,
          businessDate: form.businessDate, reason: form.reason,
        },
      });
      notify('库存状态已调整');
      setForm({ ...form, quantity: '', reason: '' });
    } catch (e) { notify(e.message || '库存状态调整失败', 'error'); }
  };

  return (
    <InventoryWorkSection
      title="库存状态调整"
      description="同一物理库存在两个状态之间迁移：数量、所有权与仓位不变。"
    >
      <InventoryWorkEditorShell title="库存状态调整" onSubmit={submit} submitLabel="提交状态调整">
        <div className="inv-work-form-grid">
          <InventoryWorkSelect label="仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
          <InventoryWorkSelect label="货品" required value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={productOptions(products)} />
          <InventoryWorkSelect label="原状态" value={form.fromStatus} onChange={(v) => setForm({ ...form, fromStatus: v })} options={statusOptions(stockStatuses)} />
          <InventoryWorkSelect label="目标状态" required value={form.toStatus} onChange={(v) => setForm({ ...form, toStatus: v })} options={statusOptions(stockStatuses)} />
          <InventoryWorkInput label="数量" type="number" min="0" step="0.01" required value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
          <InventoryWorkInput label="业务日期" type="date" required value={form.businessDate} onChange={(v) => setForm({ ...form, businessDate: v })} />
          <InventoryWorkInput label="原因" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
        </div>
      </InventoryWorkEditorShell>
    </InventoryWorkSection>
  );
}

// ---------------------------------------------------------------------------
// INV-28 — 库存锁定 / 解锁
//
// The locked quantity never counts as available stock and the lock can never
// exceed what the position holds.
// ---------------------------------------------------------------------------

export function InventoryLocks({ user, notify, references }) {
  const { warehouses, products } = references;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api('/api/inventory-locks')
      .then((data) => setRows(data.locks || data.inventoryLocks || []))
      .catch((e) => { setError(e.message || '锁库记录加载失败'); notify(e.message || '锁库记录加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const release = async () => {
    try {
      await api(`/api/inventory-locks/${releasing.id}/release`, { method: 'POST' });
      notify('锁库已释放');
      setReleasing(null);
      load();
    } catch (e) { notify(e.message || '解锁失败', 'error'); }
  };

  const canManage = can(user, 'INVENTORY_LOCK_MANAGE');
  return (
    <InventoryWorkSection
      title="库存锁定 / 解锁"
      description="锁定的数量不进入可用库存；锁库量不得超过该库存位置的实际数量。"
      actions={canManage ? <button type="button" className="primary" onClick={() => setCreating(true)}>＋ 新建锁库</button> : null}
    >
      <InventoryWorkState loading={loading} error={error} onRetry={load} empty={!rows.length}>
        <div className="inv-work-list">
          {rows.map((row) => (
            <InventoryWorkRow
              key={row.id}
              code={row.productId}
              title={`${row.warehouseId || '—'} · ${row.reason || '锁库'}`}
              status={<StatusChip status={row.status}>{row.status === 'ACTIVE' ? '锁定中' : '已释放'}</StatusChip>}
              lines={[`锁定人 ${row.lockedBy || '—'}`, `锁定时间 ${row.lockedAt || '—'}`]}
              metric={`${quantity(row.quantity)}`}
              onEdit={canManage && row.status === 'ACTIVE' ? <button type="button" className="secondary" onClick={() => setReleasing(row)}>解锁</button> : null}
            />
          ))}
        </div>
      </InventoryWorkState>
      {creating && (
        <InventoryLockEditor
          warehouses={warehouses}
          products={products}
          notify={notify}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); }}
        />
      )}
      {releasing && (
        <DangerSheet
          title="释放锁库？"
          message={`锁库 ${releasing.id} 释放后该数量重新计入可用库存。`}
          confirmLabel="释放锁库"
          onClose={() => setReleasing(null)}
          onConfirm={release}
        />
      )}
    </InventoryWorkSection>
  );
}

function InventoryLockEditor({ warehouses, products, notify, onClose, onSaved }) {
  const [form, setForm] = useState({ productId: '', warehouseId: '', quantity: '', reason: '' });
  const save = async (event) => {
    event.preventDefault();
    if (!form.productId || !form.warehouseId || !form.quantity || !form.reason) {
      notify('请填写货品、仓库、数量与锁定原因', 'error');
      return;
    }
    try {
      await api('/api/inventory-locks', {
        method: 'POST',
        body: { productId: form.productId, warehouseId: form.warehouseId, quantity: Number(form.quantity), reason: form.reason },
      });
      notify('锁库已创建');
      onSaved();
    } catch (e) { notify(e.message || '锁库创建失败', 'error'); }
  };
  return (
    <InventoryWorkEditorShell title="新建锁库" onSubmit={save} submitLabel="创建锁库">
      <div className="inv-work-form-grid">
        <InventoryWorkSelect label="货品" required value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={productOptions(products)} />
        <InventoryWorkSelect label="仓库" required value={form.warehouseId} onChange={(v) => setForm({ ...form, warehouseId: v })} options={warehouseOptions(warehouses)} />
        <InventoryWorkInput label="锁定数量" type="number" min="0.01" step="0.01" required value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} />
        <InventoryWorkInput label="锁定原因" required value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
      </div>
    </InventoryWorkEditorShell>
  );
}

// ---------------------------------------------------------------------------
// INV-34 / INV-35 / INV-36 / INV-37 — 库存台账 · 库龄 · 呆滞 · 预警
//
// All four reports read the canonical inventory facts; none of them uses the
// stale `products.stock_quantity`.
// ---------------------------------------------------------------------------

export function InventoryReports({ user, notify }) {
  const [reports, setReports] = useState({ ledger: [], aging: [], slowMoving: [], alerts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api('/api/inventory-ledger').catch(() => ({ ledger: [] })),
      api('/api/inventory-aging').catch(() => ({ aging: [] })),
      api('/api/inventory-slow-moving').catch(() => ({ slowMoving: [] })),
      api('/api/inventory/alerts').catch(() => ({ alerts: [] })),
    ]).then(([ledger, aging, slowMoving, alerts]) => {
      setReports({
        ledger: ledger.ledger || [],
        aging: aging.aging || [],
        slowMoving: slowMoving.slowMoving || [],
        alerts: alerts.alerts || [],
      });
    }).catch((e) => { setError(e.message || '库存报表加载失败'); notify(e.message || '库存报表加载失败', 'error'); })
      .finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const section = (title, rows, describe) => (
    <div className="inv-work-subsection">
      <h4>{title}</h4>
      <div className="inv-work-list">
        {rows.length ? rows.map((row, index) => (
          <InventoryWorkRow
            key={row.id || row.productId || index}
            code={row.productCode || row.productId || row.warehouseCode || '—'}
            title={row.productName || row.warehouseName || row.type || title}
            status={<StatusChip status={row.status || row.severity || row.level || 'OK'}>{row.status || row.severity || row.level || ''}</StatusChip>}
            lines={describe(row)}
            metric={row.quantity !== undefined ? `${quantity(row.quantity)}` : undefined}
          />
        )) : <EmptyState title={`${title}暂无数据`} />}
      </div>
    </div>
  );

  return (
    <InventoryWorkSection
      title="库存报表"
      description="台账、库龄、呆滞与预警全部读取 canonical 库存事实。"
      actions={<button type="button" className="secondary" onClick={load}>刷新</button>}
    >
      <InventoryWorkState loading={loading} error={error} onRetry={load} empty={false}>
        {section('库存台账', reports.ledger, (row) => [`仓库 ${row.warehouseName || row.warehouse_id || '—'}`, `货品 ${row.productName || row.product_id || '—'}`, `业务日期 ${row.business_date || row.businessDate || '—'}`])}
        {section('库存库龄', reports.aging, (row) => [`仓库 ${row.warehouseName || row.warehouse_id || '—'}`, `货品 ${row.productName || row.product_id || '—'}`, `库龄 ${row.ageDays ?? row.age_days ?? '—'} 天`])}
        {section('呆滞库存', reports.slowMoving, (row) => [`仓库 ${row.warehouseName || row.warehouse_id || '—'}`, `货品 ${row.productName || row.product_id || '—'}`, `最后移动 ${row.lastMovementDate || row.last_movement_date || '—'}`])}
        {section('库存预警', reports.alerts, (row) => [`货品 ${row.productName || row.productId || '—'}`, `仓库 ${row.warehouseName || row.warehouseId || '—'}`, `数量 ${quantity(row.quantity ?? 0)}`])}
      </InventoryWorkState>
    </InventoryWorkSection>
  );
}
