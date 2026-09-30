import { useEffect, useMemo, useState } from 'react';
import { api, setToken } from '../api.js';
import { ActionMenu, Active, ConfirmAction, ConfirmDelete, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money, quantity } from '../components/ui.jsx';
import MobileWorkflowProgress from '../components/MobileWorkflowProgress.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { roleDisplayName } from '../lib/copy.js';
import { yuanToNonNegativeCents } from '../lib/money.js';
import { Icon } from '../components/icons.jsx';
import TrackingAllocationEditor from '../components/TrackingAllocationEditor.jsx';
import { trackingPresentation, withProductTracking } from '../lib/tracking.js';
import {
  ActionMenu as CanonicalActionMenu,
  BusinessAction,
  BusinessAuditSection,
  BusinessContentSection,
  BusinessPageHeader,
  BusinessPageShell,
  BusinessRelationSection,
  BusinessState,
  CompactRecord,
  CompactRecordList,
  HelpDisclosure,
  InlineAlert,
  SearchField,
  SegmentedControl,
  StatusChip,
} from '../components/design-system.jsx';

export function Login({ onLogin, notify }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { const result = await api('/api/auth/login', { method: 'POST', body: form }); setToken(result.token); onLogin(result.user); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">M</div>
          <strong>Modern ERP</strong>
        </div>
        <h2>登录</h2>
        <p className="lead">企业运营管理平台</p>
        <form onSubmit={submit}>
          <label>账号<input autoFocus required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username"/></label>
          <label>密码<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="current-password"/></label>
          <button className="primary wide" disabled={busy}>{busy ? '正在验证…' : '登录'}</button>
        </form>
        <p className="footnote">请使用由系统管理员分配的账号登录。如需协助，请联系企业 IT 支持。</p>
      </div>
    </div>
  </div>;
}

export function Dashboard({ user, notify, mobileWorkspace = false }) {
  const navigation = useAppNavigation();
  const [data, setData] = useState(null);
  useEffect(() => {
    api('/api/dashboard')
      .then((d) => setData(d))
      .catch((e) => notify(e.message, 'error'));
  }, []);
  if (!data) return mobileWorkspace
    ? <div className="v16-mobile-enterprise" data-testid="dashboard-mobile"><div className="v16-page"><div className="v16-loading">加载中…</div></div></div>
    : <Loading/>;

  // V1.6 P1C: workspace uses capability-driven sections only.
  // Sections without reliable data are not rendered.
  const canSeeOrders = can(user, 'ORDERS_VIEW');
  const recentOrders = Array.isArray(data.recentOrders) ? data.recentOrders : [];
  const pendingCount = Number(data.pendingCount || 0);

  // Capability-driven quick actions. Order matters; we keep at most six.
  const quickActionCandidates = [
    { page: 'orders', label: '销售订单', icon: 'orders', module: 'sales', capabilities: ['ORDERS_VIEW', 'ORDERS_CREATE'] },
    { page: 'customers', label: '客户资料', icon: 'customers', module: 'master', capabilities: ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE'] },
    { page: 'sales-deliveries', label: '销售出货', icon: 'salesDeliveries', module: 'sales', capabilities: ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
    { page: 'approvals', label: '业务审批', icon: 'approvals', module: 'brand', capabilities: ['ORDERS_APPROVE', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_REQUISITION_APPROVE', 'INVENTORY_CHECK_APPROVE', 'VOUCHER_APPROVE'] },
    { page: 'business-overview', label: '业务流程', icon: 'overview', module: 'brand', capabilities: ['DASHBOARD_VIEW'] },
    { page: 'purchase-receipts', label: '采购入库', icon: 'purchaseReceipts', module: 'purchasing', capabilities: ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
    { page: 'inventory', label: '库存作业', icon: 'inventory', module: 'inventory', capabilities: ['INVENTORY_VIEW'] },
    { page: 'accounts-receivable', label: '应收结算', icon: 'accountsReceivable', module: 'sales', capabilities: ['AR_VIEW', 'COLLECTION_MANAGE'] },
    { page: 'accounts-payable', label: '应付结算', icon: 'accountsPayable', module: 'purchasing', capabilities: ['AP_VIEW', 'PAYMENT_MANAGE'] },
    { page: 'accounting', label: '会计凭证', icon: 'accounting', module: 'brand', capabilities: ['ACCOUNTING_VIEW'] },
    { page: 'payment-collections', label: '收款 / 核销', icon: 'paymentCollections', module: 'sales', capabilities: ['AR_VIEW', 'COLLECTION_MANAGE'] },
    { page: 'payment-disbursements', label: '付款 / 核销', icon: 'paymentDisbursements', module: 'purchasing', capabilities: ['AP_VIEW', 'PAYMENT_MANAGE'] },
    { page: 'users', label: '用户与权限', icon: 'users', module: 'master', capabilities: ['USERS_MANAGE', 'ROLES_MANAGE'] },
    { page: 'bank-accounts', label: '银行账户', icon: 'bankAccounts', module: 'brand', capabilities: ['BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE'] },
  ];
  const quickActions = quickActionCandidates
    .filter((action) => action.capabilities.some((code) => can(user, code)))
    .filter((action) => navigation.canNavigate(action.page))
    .slice(0, 6);

  const showPending = pendingCount > 0 && can(user, 'ORDERS_APPROVE') && navigation.canNavigate('approvals');
  const showRecent = canSeeOrders && recentOrders.length > 0;
  const showQuick = quickActions.length > 0;

  if (mobileWorkspace) {
    return (
      <div className="v16-mobile-enterprise" data-testid="dashboard-workspace">
        <div className="v16-page v16-workspace">
          {showPending && (
            <section className="v16-workspace__section" aria-label="待处理">
              <div className="v16-workspace__section-title">待处理</div>
              <button
                type="button"
                className="v16-task-row"
                data-testid="dashboard-task-pending"
                onClick={() => navigation.navigateToPage('approvals')}
                aria-label={`待我审批 ${pendingCount} 项`}
              >
                <span className="v16-task-row__title">待我审批</span>
                <span className="v16-task-row__aside">
                  <span className="v16-task-row__meta">{pendingCount} 项</span>
                  <span className="v16-task-row__chevron" aria-hidden="true">›</span>
                </span>
              </button>
            </section>
          )}

          {showRecent && (
            <section className="v16-workspace__section" aria-label="最近业务">
              <div className="v16-workspace__section-title">最近业务</div>
              <div className="v16-record-list">
                {recentOrders.slice(0, 4).map((order) => (
                  <button
                    type="button"
                    key={order.id}
                    className="v16-record"
                    data-testid={`dashboard-recent-${order.id}`}
                    onClick={() => navigation.navigateToPage('orders', { documentId: order.id })}
                    aria-label={`查看订单 ${order.orderNo || ''}`}
                  >
                    <span className="v16-record__content">
                      <span className="v16-record__primary">
                        <span>{order.orderNo || '—'}</span>
                        <span className="v16-status-pill">{order.statusLabel || order.status || '—'}</span>
                      </span>
                      <span className="v16-record__secondary">
                        <span>{order.customerName || '—'}</span>
                        <span className="v16-record__amount">{money(order.totalCents || 0)}</span>
                      </span>
                    </span>
                    <span className="v16-record__chevron" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showQuick && (
            <section className="v16-workspace__section" aria-label="常用操作">
              <div className="v16-workspace__section-title">常用操作</div>
              <div className="v16-quick-actions">
                {quickActions.map((action) => (
                  <button
                    type="button"
                    key={action.page}
                    className="v16-quick-action"
                    data-module={action.module}
                    data-testid={`dashboard-quick-${action.page}`}
                    aria-label={`打开${action.label}`}
                    onClick={() => navigation.navigateToPage(action.page)}
                  >
                    <span className="v16-quick-action__icon" aria-hidden="true">
                      <Icon name={action.icon} size={20}/>
                    </span>
                    <span className="v16-quick-action__label">{action.label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!showPending && !showRecent && !showQuick && (
            <section className="v16-workspace__section" aria-label="工作台">
              <div className="v16-empty">暂无待办</div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return <BusinessPageShell className="dashboard-v15" width="rail">
    <BusinessPageHeader title="工作台"/>
    {showPending && (
      <section className="dashboard-pending" aria-label="待我审批">
        <button
          type="button"
          className="dashboard-pending__row"
          onClick={() => navigation.navigateToPage('approvals')}
        >
          <span>待我审批</span>
          <span className="dashboard-pending__count">{pendingCount} 项</span>
          <span aria-hidden="true">›</span>
        </button>
      </section>
    )}
    {showQuick && (
      <Panel title="常用操作"><div className="dashboard-shortcuts">{quickActions.map((action) => <AppLink key={action.page} page={action.page}>{action.label}<span>→</span></AppLink>)}</div></Panel>
    )}
    {showRecent && <Panel title="最近业务" action={<AppLink className="link-button" page="orders">查看全部 →</AppLink>}>
      <OrderTable orders={recentOrders} compact/>
    </Panel>}
  </BusinessPageShell>;
}

function MasterActions({ item, label, endpoint, onEdit, onChanged, notify }) {
  async function setActive(active) {
    try {
      await api(`${endpoint}/${item.id}`, { method: 'PATCH', body: { active } });
      notify(`${label}已${active ? '启用' : '停用'}`); await onChanged();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <ActionMenu>
    <button type="button" className="row-action" onClick={() => onEdit(item)}>编辑</button>
    <button type="button" className="row-action" onClick={() => void setActive(!item.active)}>{item.active ? '停用' : '启用'}</button>
    <ConfirmDelete label={label} message={`确定删除“${item.code} · ${item.name}”吗？删除后无法恢复。如已有业务引用，系统将阻止删除并建议停用。`} onConfirm={async () => {
      try { await api(`${endpoint}/${item.id}`, { method: 'DELETE' }); notify(`${label}已删除`); await onChanged(); }
      catch (error) { notify(error.message, 'error'); throw error; }
    }}/>
  </ActionMenu>;
}

export function Suppliers({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/suppliers?search=${encodeURIComponent(search)}`).then((r) => setItems(r.suppliers)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <BusinessPageShell className="suppliers-v15" width="rail">
    <BusinessPageHeader title="供应商资料" help={<HelpDisclosure summary="主数据说明"><p>供应商编码、结算条款与联系方式供采购及应付业务引用；停用不删除历史引用。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索供应商编码、名称或联系人" action={can(user, 'SUPPLIERS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增供应商</button>}
    />
    <div className="table-wrap"><table><thead><tr><th>供应商编码</th><th>供应商名称</th><th>联系人</th><th>联系电话</th><th>地址</th><th>邮箱</th><th>账期</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.contact || '—'}</td><td>{item.phone || '—'}</td><td className="dim">{item.address || '—'}</td><td>{item.email || '—'}</td><td>{item.paymentTermsDays} 天</td><td><Active active={item.active}/></td><td>{can(user, 'SUPPLIERS_MANAGE') && <MasterActions item={item} label="供应商" endpoint="/api/suppliers" onEdit={setEditing} onChanged={load} notify={notify}/>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有找到供应商资料"/>}</div>
    {editing && <SupplierModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('供应商资料已保存'); }} notify={notify}/>} 
  </BusinessPageShell>;
}

function SupplierModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', contact: '', phone: '', address: '', email: '', paymentTermsDays: 0, active: true, ...value });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/suppliers/${value.id}` : '/api/suppliers', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑供应商' : '新增供应商'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>供应商编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 SUP-003" required/></label>
    <label>供应商名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
    <label>联系人<input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}/></label>
    <label>联系电话<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></label>
    <label className="full">联系地址<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}/></label>
    <label className="full">电子邮箱<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.cn"/></label>
    <label>付款条款天数<input type="number" min="0" step="1" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })}/></label>
    {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该供应商</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

export function Customers({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/customers?search=${encodeURIComponent(search)}`).then((r) => setItems(r.customers)).catch((e) => notify(e.message, 'error'));
  // Effect 回调只能返回清理函数，不能直接返回 load() 产生的 Promise。
  useEffect(() => { void load(); }, []);
  return <BusinessPageShell className="customers-v15" width="rail">
    <BusinessPageHeader title="客户资料" help={<HelpDisclosure summary="主数据说明"><p>客户编码、结算条款与联系方式供销售及应收业务引用；停用不删除历史引用。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索客户编码、名称或联系人" action={can(user, 'CUSTOMERS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增客户</button>}/>
    <div className="table-wrap"><table><thead><tr><th>客户编码</th><th>客户名称</th><th>联系人</th><th>联系电话</th><th>地址</th><th>账期</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.contact || '—'}</td><td>{item.phone || '—'}</td><td className="dim">{item.address || '—'}</td><td>{item.paymentTermsDays} 天</td><td><Active active={item.active}/></td><td>{can(user, 'CUSTOMERS_MANAGE') && <MasterActions item={item} label="客户" endpoint="/api/customers" onEdit={setEditing} onChanged={load} notify={notify}/>}</td></tr>)}
    </tbody></table>{!items.length && <Empty title="还没有客户" text="创建客户后，就可以建立销售订单。"/>}</div>
    {editing && <CustomerModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('客户资料已保存'); }} notify={notify}/>} 
  </BusinessPageShell>;
}

function CustomerModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', contact: '', phone: '', address: '', paymentTermsDays: 0, active: true, ...value });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/customers/${value.id}` : '/api/customers', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑客户' : '新增客户'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>客户编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 CUS-003" required/></label>
    <label>客户名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
    <label>联系人<input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}/></label>
    <label>联系电话<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></label>
    <label className="full">联系地址<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}/></label>
    <label>付款条款天数<input type="number" min="0" step="1" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })}/></label>
    {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该客户</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

export function Products({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const navigation = useAppNavigation();
  const load = () => api(`/api/products?search=${encodeURIComponent(search)}`).then((r) => setItems(r.products)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <BusinessPageShell className="products-v15" width="rail">
    <BusinessPageHeader title="货品资料" help={<HelpDisclosure summary="主数据说明"><p>货品资料承载计量、售价、制造成本与库存跟踪策略；库存数量由业务单据维护。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索产品名称或编码" action={can(user, 'PRODUCTS_MANAGE') && <button className="primary compact-create" aria-label="新增产品" onClick={() => setEditing({})}>新增</button>}/>
    <div className="table-wrap"><table><thead><tr><th>产品编码</th><th>产品名称</th><th>单位</th><th>库存跟踪方式</th><th className="number">参考售价</th><th className="number">当前库存</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.unit}</td><td><span className="tracking-badge">{trackingPresentation(item.trackingPolicy).label}</span></td><td className="number">{money(item.priceCents)}</td><td className="number">{item.stockQuantity}</td><td><Active active={item.active}/></td><td className="actions">{navigation.canNavigate('product-routings') && <button className="row-action" onClick={() => navigation.navigateToPage('product-routings', { productId: item.id })}>工序标准</button>}{can(user, 'PRODUCTS_MANAGE') && <MasterActions item={item} label="产品" endpoint="/api/products" onEdit={setEditing} onChanged={load} notify={notify}/>}</td></tr>)}
    </tbody></table>{!items.length && <Empty title="还没有产品" text="新建产品后，即可用于销售、采购和库存业务。"/>}</div>
    {editing && <ProductModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('产品资料已保存'); }} notify={notify}/>}
  </BusinessPageShell>;
}

function ProductModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', unit: '个', active: true, trackingPolicy: 'NONE', shelfLifeDays: '', trackingReason: '', ...value, price: value.priceCents === undefined ? '' : value.priceCents / 100, standardManufacturingCost: value.standardManufacturingCostCents === undefined ? '' : value.standardManufacturingCostCents / 100 });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/products/${value.id}` : '/api/products', { method: value.id ? 'PATCH' : 'POST', body: { ...form, priceCents: yuanToNonNegativeCents(form.price), standardManufacturingCostCents: yuanToNonNegativeCents(form.standardManufacturingCost || 0) } }); if (value.id && (form.trackingPolicy !== (value.trackingPolicy || 'NONE') || String(form.shelfLifeDays || '') !== String(value.shelfLifeDays || ''))) { await api(`/api/products/${value.id}/tracking-policy`, { method: 'PATCH', body: { policy: form.trackingPolicy, shelfLifeDays: form.shelfLifeDays || null, reason: form.trackingReason } }); } onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑产品' : '新建产品'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>产品编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 MAT-004" required/></label>
    <label>产品名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="请输入产品名称" required/></label>
    <label>计量单位<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required/></label>
    <label>参考售价（元）<input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required/></label>
    <label>标准制造成本（元）<input type="number" min="0" step="0.01" value={form.standardManufacturingCost} onChange={(e) => setForm({ ...form, standardManufacturingCost: e.target.value })} placeholder="管理成本基准"/></label>
    {value.id && <div className="notice full">库存数量由仓库业务单据维护，不在产品资料中编辑。当前库存请查阅库存工作台或库存报表。</div>}
    <fieldset className="tracking-policy-options"><legend>库存跟踪</legend>{['NONE', 'LOT', 'SERIAL'].map((policy) => { const copy = trackingPresentation(policy); return <label className="tracking-policy-option" key={policy}><input type="radio" name="trackingPolicy" checked={form.trackingPolicy === policy} onChange={() => setForm({ ...form, trackingPolicy: policy, trackingReason: '' })}/><span><strong>{copy.label}</strong><small>{copy.description}</small></span></label>; })}</fieldset>
    {form.trackingPolicy !== 'NONE' && <label>保质期（天）<input type="number" min="1" step="1" value={form.shelfLifeDays || ''} onChange={(e) => setForm({ ...form, shelfLifeDays: e.target.value })} placeholder="可选"/></label>}
    {value.id && (form.trackingPolicy !== (value.trackingPolicy || 'NONE') || String(form.shelfLifeDays || '') !== String(value.shelfLifeDays || '')) && <label className="full">变更原因<input value={form.trackingReason} onChange={(e) => setForm({ ...form, trackingReason: e.target.value })} placeholder="说明跟踪策略变更原因" required/></label>}
    {value.id && <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该产品</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

const ORDER_STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'DRAFT', label: '草稿' },
  { value: 'SUBMITTED', label: '待审批' },
  { value: 'APPROVED', label: '已审批' },
  { value: 'REJECTED', label: '已驳回' },
];

function orderStageText(order, kind) {
  const isSales = kind === 'sales';
  const fulfillmentCount = Number(
    isSales ? order.deliveryCount || 0 : order.receiptCount || 0,
  );

  if (order.status === 'DRAFT') return '待提交';
  if (order.status === 'SUBMITTED') return '等待业务审批';
  if (order.status === 'REJECTED') return '已驳回，可修改后重新提交';

  if (order.status === 'APPROVED') {
    if (fulfillmentCount > 0) {
      return isSales
        ? `已关联 ${fulfillmentCount} 张出货单`
        : `已关联 ${fulfillmentCount} 张入库单`;
    }

    return isSales
      ? '已审批，等待销售出货'
      : '已审批，等待采购入库';
  }

  return order.statusLabel || '状态待确认';
}

export function Orders({ user, notify }) {
  const { target } = useAppNavigation();

  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(
    target?.page === 'orders' && target.documentId
      ? { id: target.documentId }
      : null,
  );
  const [listState, setListState] = useState('LOADING');

  async function load() {
    setListState('LOADING');

    try {
      const result = await api(
        `/api/orders?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`,
      );

      const next = result.orders || [];
      setOrders(next);

      if (next.length) {
        setListState('READY');
      } else if (search || status) {
        setListState('NO_RESULTS');
      } else {
        setListState('EMPTY');
      }
    } catch (error) {
      setListState('ERROR');
      notify(error.message, 'error');
    }
  }

  useEffect(() => {
    void load();
    // status change intentionally reloads the current search scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function deleteOrder(order) {
    try {
      await api(`/api/orders/${order.id}`, { method: 'DELETE' });
      notify('销售订单草稿已删除');
      await load();
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    }
  }

  if (viewing) {
    return (
      <>
        <OrderDetail
          id={viewing.id}
          user={user}
          notify={notify}
          onBack={() => {
            setViewing(null);
            void load();
          }}
          onEdit={(order) => setEditing(order)}
        />

        {editing && (
          <OrderEditor
            order={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setViewing(null);
              void load();
              notify('销售订单草稿已保存');
            }}
            notify={notify}
          />
        )}
      </>
    );
  }

  return (
    <BusinessPageShell className="sales-orders-v15" width="rail">
      <BusinessPageHeader
        title="销售订单"
        primaryAction={
          can(user, 'ORDERS_CREATE') && (
            <BusinessAction
              hierarchy="primary"
              onClick={() => setEditing({})}
            >
              新建销售订单
            </BusinessAction>
          )
        }
        help={
          <HelpDisclosure summary="流程说明">
            <p>
              销售订单审批只代表业务授权，不等于已经出货。
              审批完成后，实际履约继续通过销售出货处理。
            </p>
          </HelpDisclosure>
        }
      />

      <section
        className="order-list-toolbar"
        aria-label="销售订单筛选"
      >
        <SearchField
          value={search}
          onChange={setSearch}
          onSubmit={load}
          placeholder="搜索订单号或客户"
        />

        <SegmentedControl
          label="订单状态"
          value={status}
          onChange={setStatus}
          options={ORDER_STATUS_OPTIONS}
        />
      </section>

      {listState === 'LOADING' && (
        <BusinessState
          kind="LOADING"
          title="正在加载销售订单"
        />
      )}

      {listState === 'ERROR' && (
        <BusinessState
          kind="ERROR"
          title="销售订单加载失败"
          description="请检查连接后重试。"
          retry={load}
        />
      )}

      {listState === 'EMPTY' && (
        <BusinessState
          kind="EMPTY"
          title="还没有销售订单"
          description="创建销售订单后，可以提交业务审批并安排后续出货。"
          action={
            can(user, 'ORDERS_CREATE') && (
              <BusinessAction
                hierarchy="primary"
                onClick={() => setEditing({})}
              >
                新建销售订单
              </BusinessAction>
            )
          }
        />
      )}

      {listState === 'NO_RESULTS' && (
        <BusinessState
          kind="NO_RESULTS"
          title="没有符合条件的销售订单"
          description="可以调整搜索内容或订单状态。"
        />
      )}

      {listState === 'READY' && (
        <CompactRecordList className="order-record-list">
          {orders.map((order) => (
            <CompactRecord
              key={order.id}
              title={order.orderNo}
              subtitle={order.customerName}
              status={
                <StatusChip status={order.status}>
                  {order.status === 'SUBMITTED'
                    ? '待审批'
                    : order.statusLabel}
                </StatusChip>
              }
              metadata={[
                {
                  label: '当前阶段',
                  value: orderStageText(order, 'sales'),
                },
                {
                  label: '制单信息',
                  value: (
                    <>
                      {order.creatorName || '—'}
                      <span> · {dateTime(order.createdAt)}</span>
                    </>
                  ),
                },
              ]}
              metrics={[
                {
                  label: '订单金额',
                  value: money(order.totalCents),
                },
                {
                  label: '货品明细',
                  value: `${order.itemCount || 0} 项`,
                },
                {
                  label: '销售出货',
                  value: order.deliveryCount
                    ? `${order.deliveryCount} 张`
                    : '尚未出货',
                },
              ]}
              onOpen={() => setViewing({ id: order.id })}
              action={
                <CanonicalActionMenu label={`销售订单 ${order.orderNo} 的更多操作`}>
                  <button
                    type="button"
                    onClick={() => setViewing({ id: order.id })}
                  >
                    查看详情
                  </button>

                  {can(user, 'ORDERS_CREATE') &&
                    ['DRAFT', 'REJECTED'].includes(order.status) && (
                      <button
                        type="button"
                        onClick={() => setEditing(order)}
                      >
                        编辑草稿
                      </button>
                    )}

                  {can(user, 'ORDERS_CREATE') &&
                    order.status === 'DRAFT' && (
                      <ConfirmDelete
                        label="销售订单"
                        buttonLabel="删除草稿"
                        message={`确定删除销售订单“${order.orderNo}”吗？未提交草稿删除后无法恢复。`}
                        onConfirm={() => deleteOrder(order)}
                      />
                    )}
                </CanonicalActionMenu>
              }
            />
          ))}
        </CompactRecordList>
      )}

      {editing && (
        <OrderEditor
          order={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            notify('销售订单草稿已保存');
          }}
          notify={notify}
        />
      )}
    </BusinessPageShell>
  );
}

function OrderEditor({ order, onClose, onSaved, notify }) {
  const [customers, setCustomers] = useState([]); const [products, setProducts] = useState([]); const [loading, setLoading] = useState(Boolean(order.id));
  // V1.3 Phase 1: SO commercial contract — order date, requested delivery
  // date, payment terms, ship-to contact/phone/address snapshot. The
  // customer master provides defaults for the snapshot fields.
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    customerId: '', orderDate: today, requestedDeliveryDate: '', paymentTerms: '', paymentTermsDays: 0,
    shipToContactName: '', shipToPhone: '', shipToAddress: '',
    remark: '', items: [{ productId: '', quantity: 1, price: '' }],
  });
  useEffect(() => {
    Promise.all([api('/api/customers'), api('/api/products'), order.id ? api(`/api/orders/${order.id}`) : null]).then(([c, p, detail]) => {
      setCustomers(c.customers.filter((x) => x.active)); setProducts(p.products.filter((x) => x.active));
      if (detail) {
        setForm({
          customerId: detail.order.customerId,
          orderDate: detail.order.orderDate || today,
          requestedDeliveryDate: detail.order.requestedDeliveryDate || '',
          paymentTerms: detail.order.paymentTerms || '',
          paymentTermsDays: detail.order.paymentTermsDays ?? 0,
          shipToContactName: detail.order.shipToContactName || '',
          shipToPhone: detail.order.shipToPhone || '',
          shipToAddress: detail.order.shipToAddress || '',
          remark: detail.order.remark,
          items: detail.order.items.map((x) => ({ productId: x.productId, quantity: x.quantity, price: x.unitPriceCents / 100 })),
        });
      }
    }).catch((e) => notify(e.message, 'error')).finally(() => setLoading(false));
  }, []);
  // When the customer changes, prefill the ship-to / payment snapshot
  // fields from the customer master if the user has not already typed
  // a different value. The document owns the snapshot after save.
  function applyCustomerSnapshot(customerId) {
    const customer = customers.find((c) => c.id === customerId);
    setForm((current) => ({
      ...current,
      customerId,
      shipToContactName: current.shipToContactName || customer?.contact || '',
      shipToPhone: current.shipToPhone || customer?.phone || '',
      shipToAddress: current.shipToAddress || customer?.address || '',
      paymentTermsDays: customer?.paymentTermsDays ?? 0,
    }));
  }
  const totalCents = useMemo(() => form.items.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (yuanToNonNegativeCents(line.price) || 0), 0), [form]);
  function updateLine(index, patch) { setForm({ ...form, items: form.items.map((line, i) => i === index ? { ...line, ...patch } : line) }); }
  function chooseProduct(index, productId) { const product = products.find((p) => p.id === productId); updateLine(index, { productId, price: product ? product.priceCents / 100 : '' }); }
  async function save(e) {
    e.preventDefault();
    try {
      await api(order.id ? `/api/orders/${order.id}` : '/api/orders', {
        method: order.id ? 'PUT' : 'POST',
        body: {
          ...form,
          items: form.items.map((x) => ({ productId: x.productId, quantity: Number(x.quantity), unitPriceCents: yuanToNonNegativeCents(x.price) })),
        },
      });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title={order.id ? `编辑订单 ${order.orderNo}` : '新建销售订单'} onClose={onClose} wide>
    {loading ? <Loading/> : <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>客户<select value={form.customerId} onChange={(e) => applyCustomerSnapshot(e.target.value)} required><option value="">请选择客户</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label>
        <label>订单日期<input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} required/></label>
        <label>要求交期<input type="date" value={form.requestedDeliveryDate} onChange={(e) => setForm({ ...form, requestedDeliveryDate: e.target.value })} required/></label>
        <label>付款条件<input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} maxLength={200} placeholder="如：月结 30 天"/></label>
        <label>账期天数<input type="number" min="0" step="1" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })} required/></label>
        <label>收货联系人<input value={form.shipToContactName} onChange={(e) => setForm({ ...form, shipToContactName: e.target.value })} maxLength={50}/></label>
        <label>收货电话<input value={form.shipToPhone} onChange={(e) => setForm({ ...form, shipToPhone: e.target.value })} maxLength={30}/></label>
        <label className="full">收货地址<input value={form.shipToAddress} onChange={(e) => setForm({ ...form, shipToAddress: e.target.value })} maxLength={200}/></label>
        <label className="full">订单备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="可填写交期或特殊说明"/></label>
      </div>
      <div className="line-title"><div><strong>订单明细</strong><span>选择货品并填写数量、成交单价</span></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1, price: '' }] })}>＋ 添加一行</button></div>
      <div className="line-table"><div className="line-row line-header"><span>#</span><span>货品</span><span>数量</span><span>单位</span><span>单价（元）</span><span>金额</span><span/></div>
        {form.items.map((line, index) => { const product = products.find((p) => p.id === line.productId); return <div className="line-row" key={index}><span>{index + 1}</span><select value={line.productId} onChange={(e) => chooseProduct(index, e.target.value)} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} required/><span>{product?.unit || '—'}</span><input type="number" min="0" step="0.01" value={line.price} onChange={(e) => updateLine(index, { price: e.target.value })} required/><strong>{money(Math.round((Number(line.quantity)||0)*(Number(line.price)||0)*100))}</strong><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>×</button></div>; })}
      </div>
      <div className="order-total"><span>订单合计</span><strong>{money(totalCents)}</strong></div><FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

export function Approvals({ notify }) {
  const [orders, setOrders] = useState([]); const [viewing, setViewing] = useState(null); const [rejecting, setRejecting] = useState(null); const [reason, setReason] = useState('');
  const load = () => api('/api/orders?status=SUBMITTED').then((r) => setOrders(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  async function approve(order) { try { await api(`/api/orders/${order.id}/approve`, { method: 'POST' }); notify('销售订单已审批'); load(); } catch (e) { notify(e.message, 'error'); throw e; } }
  async function reject(e) { e.preventDefault(); try { await api(`/api/orders/${rejecting.id}/reject`, { method: 'POST', body: { reason } }); notify('订单已驳回'); setRejecting(null); setReason(''); load(); } catch (error) { notify(error.message, 'error'); } }
  return <>
    <div className="approval-banner"><div className="approval-icon"><Icon name="approval" size={22}/></div><div><h2>待审批订单</h2><p>审批是业务授权，不等于出货。审批通过后订单仍需在后续流程生成出货单。</p></div><strong>{orders.length}<small>张待处理</small></strong></div>
    <Panel title="审批队列" subtitle="制单人与审批人必须是不同用户"><OrderTable orders={orders} onView={setViewing} actions={(order) => <><button className="row-action danger" onClick={() => setRejecting(order)}>驳回</button><ConfirmAction className="approve-button" buttonLabel="审批通过" title="通过这张销售订单？" message={`订单 ${order.orderNo} 审批通过后可进入销售出货流程。`} confirmLabel="审批通过" onConfirm={() => approve(order)}/></>}/></Panel>
    {viewing && <OrderDetail id={viewing.id} onClose={() => setViewing(null)} notify={notify}/>} 
    {rejecting && <Modal title={`驳回 ${rejecting.orderNo}`} onClose={() => setRejecting(null)}><form onSubmit={reject}><label>驳回原因<textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请说明需要销售人员修改的内容" required/></label><FormActions onClose={() => setRejecting(null)} saveText="确认驳回" danger/></form></Modal>}
  </>;
}

export function orderWorkflowStages(order, trace, kind) {
  const isSales = kind === 'sales';
  const logistics = trace?.downstream || [];
  const returns = logistics.flatMap((item) => item.returns || []);
  const voucher = [...logistics.map((item) => item.voucher), ...returns.map((item) => item.voucher)].find(Boolean);
  const submitted = ['SUBMITTED', 'APPROVED'].includes(order.status);
  const approved = order.status === 'APPROVED';
  return [
    { key: 'order', label: isSales ? '销售订单已创建' : '采购订单已创建', state: 'completed', documentNo: order.orderNo },
    { key: 'submit', label: '已提交', state: submitted ? 'completed' : order.status === 'REJECTED' ? 'current' : 'current', hint: submitted ? '' : order.status === 'REJECTED' ? '已驳回，修改后可重新提交' : '待提交' },
    { key: 'approve', label: '审批', state: approved ? 'completed' : submitted ? 'current' : 'pending', hint: submitted && !approved ? '等待审批' : '' },
    { key: 'quality', label: isSales ? 'OQC 质量门禁' : 'IQC 质量门禁', state: logistics.length ? 'current' : 'pending', pageKey: isSales ? 'oqc' : 'iqc', hint: `需要质检时，在${isSales ? '出货' : '入库'}确认前完成` },
    { key: 'logistics', label: isSales ? '销售出货' : '采购入库', state: logistics.length ? 'completed' : approved ? 'current' : 'pending', documentNo: logistics[0]?.documentNo, documentId: logistics[0]?.id, documentType: logistics[0]?.type, pageKey: isSales ? 'sales-deliveries' : 'purchase-receipts', hint: logistics.length ? `已关联 ${logistics.length} 张${isSales ? '出货单' : '入库单'}` : `必须引用已批准订单行生成${isSales ? '出货单' : '入库单'}` },
    { key: 'return', label: isSales ? '销售退货' : '采购退货', state: returns.length ? 'completed' : 'optional', documentNo: returns[0]?.documentNo, documentId: returns[0]?.id, documentType: returns[0]?.type, pageKey: returns.length ? 'returns' : null, hint: returns.length ? `已关联 ${returns.length} 张退货单` : '如发生' },
    { key: 'commercial', label: isSales ? '销售发票' : '供应商账单', state: 'pending', pageKey: isSales ? 'sales-invoices' : 'supplier-bills', hint: `商业单据独立于${isSales ? '出货' : '入库'}确认` },
    { key: 'subledger', label: isSales ? '应收账款' : '应付账款', state: 'pending', pageKey: isSales ? 'accounts-receivable' : 'accounts-payable', hint: `${isSales ? '发票' : '账单'}过账后形成，不等同于物流完成` },
    { key: 'settlement', label: isSales ? '收款 / 核销' : '付款 / 核销', state: 'pending', pageKey: isSales ? 'payment-collections' : 'payment-disbursements', hint: '结算状态与履约状态分别维护' },
    { key: 'voucher', label: '会计处理', state: voucher ? 'completed' : 'pending', documentNo: voucher?.documentNo, documentId: voucher?.id, documentType: voucher?.type, pageKey: 'accounting', hint: voucher?.type === 'FINANCIAL_RECORD' ? '已产生受保护的会计记录' : '各业务事件按独立来源形成凭证' },
  ];
}

function OrderDocumentDetail({
  kind,
  id,
  user,
  onBack,
  onEdit,
  notify,
}) {
  const isSales = kind === 'sales';

  const config = isSales
    ? {
        title: '销售订单',
        endpoint: '/api/orders',
        workflowEndpoint: '/api/workflow/sales-orders',
        partyNameField: 'customerName',
        partyCodeField: 'customerCode',
        partyLabel: '客户',
        orderDateField: 'orderDate',
        dueDateField: 'requestedDeliveryDate',
        dueDateLabel: '要求交期',
        contactNameField: 'shipToContactName',
        contactPhoneField: 'shipToPhone',
        addressField: 'shipToAddress',
        contactLabel: '收货联系人',
        phoneLabel: '收货电话',
        addressLabel: '收货地址',
        managePermission: 'ORDERS_CREATE',
        submitPermission: 'ORDERS_SUBMIT',
        approvePermission: 'ORDERS_APPROVE',
        approvalCopy: '销售订单审批只代表业务授权，销售出货负责后续实物履约。',
        submitSuccess: '销售订单已提交',
      }
    : {
        title: '采购订单',
        endpoint: '/api/purchase-orders',
        workflowEndpoint: '/api/workflow/purchase-orders',
        partyNameField: 'supplierName',
        partyCodeField: 'supplierCode',
        partyLabel: '供应商',
        orderDateField: 'orderDate',
        dueDateField: 'expectedDeliveryDate',
        dueDateLabel: '预计交期',
        contactNameField: 'supplierContactName',
        contactPhoneField: 'supplierContactPhone',
        addressField: 'supplierAddress',
        contactLabel: '供应商联系人',
        phoneLabel: '供应商电话',
        addressLabel: '供应商地址',
        managePermission: 'PURCHASE_ORDERS_CREATE',
        submitPermission: 'PURCHASE_ORDERS_SUBMIT',
        approvePermission: 'PURCHASE_ORDERS_APPROVE',
        approvalCopy: '采购订单审批只代表业务授权，采购入库和供应商账单继续独立处理。',
        submitSuccess: '采购订单已提交',
      };

  const [order, setOrder] = useState(null);
  const [trace, setTrace] = useState(null);
  const [loadState, setLoadState] = useState('LOADING');

  async function reload() {
    setLoadState('LOADING');

    try {
      const [detail, workflow] = await Promise.all([
        api(`${config.endpoint}/${id}`),
        api(`${config.workflowEndpoint}/${id}`),
      ]);

      setOrder(detail.order);
      setTrace(workflow);
      setLoadState('READY');
    } catch (error) {
      setLoadState('ERROR');
      notify(error.message, 'error');
    }
  }

  useEffect(() => {
    void reload();
    // endpoint is fixed by kind for the life of this detail view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  async function submitOrder() {
    try {
      await api(`${config.endpoint}/${id}/submit`, {
        method: 'POST',
      });

      notify(config.submitSuccess);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    }
  }

  if (loadState === 'LOADING') {
    return (
      <BusinessPageShell
        className="order-document-detail"
        width="rail"
      >
        <BusinessState
          kind="LOADING"
          title={`正在加载${config.title}详情`}
        />
      </BusinessPageShell>
    );
  }

  if (loadState === 'ERROR' || !order) {
    return (
      <BusinessPageShell
        className="order-document-detail"
        width="rail"
      >
        <BusinessState
          kind="ERROR"
          title={`${config.title}详情加载失败`}
          retry={reload}
          action={
            <BusinessAction onClick={onBack}>
              返回列表
            </BusinessAction>
          }
        />
      </BusinessPageShell>
    );
  }

  const partyName = order[config.partyNameField] || '—';
  const partyCode = order[config.partyCodeField] || '';
  const orderDate = order[config.orderDateField] || '—';
  const dueDate = order[config.dueDateField] || '—';

  const editable =
    can(user, config.managePermission) &&
    ['DRAFT', 'REJECTED'].includes(order.status);

  const submittable =
    can(user, config.submitPermission) &&
    ['DRAFT', 'REJECTED'].includes(order.status);

  const secondaryActions = [
    editable ? (
      <BusinessAction
        key="edit"
        onClick={() => onEdit(order)}
      >
        编辑草稿
      </BusinessAction>
    ) : null,

    order.status === 'SUBMITTED' &&
    can(user, config.approvePermission) ? (
      <AppLink
        key="approval"
        className="secondary"
        page="approvals"
      >
        前往业务审批
      </AppLink>
    ) : null,
  ].filter(Boolean);

  return (
    <BusinessPageShell
      className={`order-document-detail order-document-detail--${kind}`}
      width="rail"
    >
      <BusinessPageHeader
        title={order.orderNo}
        breadcrumb={
          <button
            type="button"
            className="link-button"
            onClick={onBack}
          >
            {config.title} / 返回列表
          </button>
        }
        context={`${partyName} · ${orderDate}`}
        statusSlot={
          <StatusChip status={order.status}>
            {order.status === 'SUBMITTED'
              ? '待审批'
              : order.statusLabel}
          </StatusChip>
        }
        primaryAction={
          submittable ? (
            <ConfirmAction
              className="primary"
              buttonLabel="提交审批"
              title={`提交这张${config.title}？`}
              message="提交后，单据进入业务审批；审批并不代表后续物流已经执行。"
              confirmLabel="确认提交"
              onConfirm={submitOrder}
            />
          ) : null
        }
        secondaryActions={secondaryActions}
        help={
          <HelpDisclosure summary="流程说明">
            <p>{config.approvalCopy}</p>
          </HelpDisclosure>
        }
      />

      {order.rejectionReason && (
        <InlineAlert
          tone="danger"
          title="驳回原因"
        >
          {order.rejectionReason}
        </InlineAlert>
      )}

      <div className="order-document-flow">
        <BusinessContentSection title="订单摘要">
          <dl className="order-summary-list">
            <div className="order-summary-row order-summary-row--long">
              <dt>{config.partyLabel}</dt>
              <dd>
                {partyName}
                {partyCode && (
                  <small className="mono">
                    {partyCode}
                  </small>
                )}
              </dd>
            </div>

            <div className="order-summary-row">
              <dt>订单日期</dt>
              <dd>{orderDate}</dd>
            </div>

            <div className="order-summary-row">
              <dt>{config.dueDateLabel}</dt>
              <dd>{dueDate}</dd>
            </div>

            <div className="order-summary-row order-summary-row--long">
              <dt>付款条件</dt>
              <dd>
                {order.paymentTerms || '—'}
                {Number(order.paymentTermsDays) > 0 && (
                  <small>
                    {order.paymentTermsDays} 天
                  </small>
                )}
              </dd>
            </div>

            <div className="order-summary-row">
              <dt>订单金额</dt>
              <dd>{money(order.totalCents)}</dd>
            </div>
          </dl>
        </BusinessContentSection>

        <BusinessContentSection title="交付信息">
          <dl className="order-summary-list">
            <div className="order-summary-row">
              <dt>{config.contactLabel}</dt>
              <dd>{order[config.contactNameField] || '—'}</dd>
            </div>

            <div className="order-summary-row">
              <dt>{config.phoneLabel}</dt>
              <dd>{order[config.contactPhoneField] || '—'}</dd>
            </div>

            <div className="order-summary-row order-summary-row--long">
              <dt>{config.addressLabel}</dt>
              <dd>{order[config.addressField] || '—'}</dd>
            </div>

            {order.remark && (
              <div className="order-summary-row order-summary-row--long">
                <dt>备注</dt>
                <dd>{order.remark}</dd>
              </div>
            )}
          </dl>
        </BusinessContentSection>

        <BusinessRelationSection
          title="业务进度"
          description={
            isSales
              ? '审批、出货、结算分别保持独立状态。'
              : '审批、入库、应付结算分别保持独立状态。'
          }
        >
          <MobileWorkflowProgress
            stages={orderWorkflowStages(order, trace, kind)}
          />
        </BusinessRelationSection>

        <BusinessContentSection
          title="订单明细"
          description={`${order.items?.length || 0} 行货品`}
        >
          <CompactRecordList className="order-line-records">
            {(order.items || []).map((item) => (
              <CompactRecord
                key={item.id}
                title={item.productName}
                subtitle={item.productCode}
                metadata={[
                  {
                    label: '数量',
                    value: `${quantity(item.quantity)} ${item.unit || ''}`.trim(),
                  },
                ]}
                metrics={[
                  {
                    label: '单价',
                    value: money(item.unitPriceCents),
                  },
                  {
                    label: '金额',
                    value: money(item.amountCents),
                  },
                ]}
              />
            ))}
          </CompactRecordList>

          <div className="order-detail-total">
            <span>订单合计</span>
            <strong>{money(order.totalCents)}</strong>
          </div>
        </BusinessContentSection>

        <BusinessAuditSection title="操作记录">
          <div className="order-audit-list">
            {(order.history || []).map((item, index) => (
              <div
                className="order-audit-row"
                key={`${item.createdAt}-${index}`}
              >
                <div>
                  <strong>{item.userName || '系统'}</strong>
                  <span>{dateTime(item.createdAt)}</span>
                </div>
                <p>{item.detail}</p>
              </div>
            ))}

            {!order.history?.length && (
              <p className="muted">
                暂无其他操作记录。
              </p>
            )}
          </div>
        </BusinessAuditSection>
      </div>
    </BusinessPageShell>
  );
}

function OrderDetail({
  id,
  user,
  onBack,
  onEdit,
  notify,
}) {
  return (
    <OrderDocumentDetail
      kind="sales"
      id={id}
      user={user}
      onBack={onBack}
      onEdit={onEdit}
      notify={notify}
    />
  );
}

export function UsersRoles({ user, notify }) {
  const defaultTab = can(user, 'USERS_MANAGE') ? 'users' : 'roles';
  const [tab, setTab] = useState(defaultTab); const [users, setUsers] = useState([]); const [roles, setRoles] = useState([]); const [permissions, setPermissions] = useState([]); const [editingUser, setEditingUser] = useState(null); const [editingRole, setEditingRole] = useState(null);
  const load = () => Promise.all([can(user, 'USERS_MANAGE') ? api('/api/users') : null, can(user, 'ROLES_MANAGE') ? api('/api/roles') : null]).then(([u, r]) => { setUsers(u?.users || []); if (r) { setRoles(r.roles); setPermissions(r.permissions); } }).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <BusinessPageShell className="users-roles-v15" width="rail">
    <BusinessPageHeader title="用户与权限" context={tab === 'users' ? '用户管理' : '角色权限'} primaryAction={tab === 'users' ? can(user, 'USERS_MANAGE') && <BusinessAction hierarchy="primary" onClick={() => setEditingUser({})}>新增用户</BusinessAction> : can(user, 'ROLES_MANAGE') && <BusinessAction hierarchy="primary" onClick={() => setEditingRole({ permissions: [] })}>新增角色</BusinessAction>} help={<HelpDisclosure summary="权限说明"><p>用户通过角色取得权限；停用用户不删除其历史业务与审计记录。</p></HelpDisclosure>}/>
    <div className="tabs">{can(user, 'USERS_MANAGE') && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>用户管理</button>}<button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>角色权限</button></div>
    {tab === 'users' ? <div className="user-cards">{users.map((item) => <div className="user-card" key={item.id}><div className="avatar large">{item.displayName.slice(0,1)}</div><div><strong>{item.displayName}</strong><span className="mono">{item.username}</span></div><span className="role-chip">{roleDisplayName(item)}</span><Active active={item.active}/><button className="row-action" onClick={() => setEditingUser(item)}>编辑</button></div>)}</div> : <div className="role-grid">{roles.map((role) => <div className="role-card" key={role.id}><div><span className="mono">{role.code}</span><h3>{roleDisplayName({ roleId: role.id, roleCode: role.code, roleName: role.name })}</h3><p>{role.description}</p></div><div className="role-meta"><span>{role.user_count} 位用户</span><span>{role.permissions.length} 项权限</span></div>{can(user, 'ROLES_MANAGE') && <button className="secondary" onClick={() => setEditingRole(role)}>配置权限</button>}</div>)}</div>}
    {editingUser && <UserModal value={editingUser} roles={roles} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); load(); notify('用户资料已保存'); }} notify={notify}/>} 
    {editingRole && <RoleModal value={editingRole} permissions={permissions} onClose={() => setEditingRole(null)} onSaved={() => { setEditingRole(null); load(); notify('角色权限已保存'); }} notify={notify}/>} 
  </BusinessPageShell>;
}

function UserModal({ value, roles, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', roleId: roles[0]?.id || '', active: true, ...value });
  async function save(e) {
    e.preventDefault();
    try {
      let body;
      if (value.id) {
        body = { displayName: form.displayName, roleId: form.roleId, active: form.active };
        if (form.password) body.password = form.password;
      } else {
        body = { username: form.username, displayName: form.displayName, password: form.password, roleId: form.roleId };
      }
      await api(value.id ? `/api/users/${value.id}` : '/api/users', { method: value.id ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title={value.id ? '编辑用户' : '新增用户'} onClose={onClose}><form className="form-grid" onSubmit={save}><label>登录账号<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={Boolean(value.id)} required/></label><label>用户姓名<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required/></label><label>{value.id ? '重置密码（留空不修改）' : '初始密码'}<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!value.id}/></label><label>所属角色<select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该用户</label>}<FormActions onClose={onClose}/></form></Modal>;
}

function RoleModal({ value, permissions, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', description: '', permissions: [], ...value });
  function toggle(code) { setForm({ ...form, permissions: form.permissions.includes(code) ? form.permissions.filter((x) => x !== code) : [...form.permissions, code] }); }
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/roles/${value.id}` : '/api/roles', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? `配置角色：${value.name}` : '新增角色'} onClose={onClose}><form onSubmit={save}><div className="form-grid"><label>角色编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(value.id)} required/></label><label>角色名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label><label className="full">角色说明<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label></div><div className="permission-list"><strong>功能权限</strong>{permissions.map((p) => <label key={p.code}><input type="checkbox" checked={form.permissions.includes(p.code)} onChange={() => toggle(p.code)}/><span>{p.name}<small className="mono">{p.code}</small></span></label>)}</div><FormActions onClose={onClose}/></form></Modal>;
}


export function PurchaseOrders({ user, notify }) {
  const { target } = useAppNavigation();

  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(
    target?.page === 'purchase-orders' && target.documentId
      ? { id: target.documentId }
      : null,
  );
  const [listState, setListState] = useState('LOADING');

  async function load() {
    setListState('LOADING');

    try {
      const result = await api(
        `/api/purchase-orders?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`,
      );

      const next = result.purchaseOrders || [];
      setOrders(next);

      if (next.length) {
        setListState('READY');
      } else if (search || status) {
        setListState('NO_RESULTS');
      } else {
        setListState('EMPTY');
      }
    } catch (error) {
      setListState('ERROR');
      notify(error.message, 'error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function deleteOrder(order) {
    try {
      await api(`/api/purchase-orders/${order.id}`, {
        method: 'DELETE',
      });

      notify('采购订单草稿已删除');
      await load();
    } catch (error) {
      notify(error.message, 'error');
      throw error;
    }
  }

  if (viewing) {
    return (
      <>
        <PurchaseOrderDetail
          id={viewing.id}
          user={user}
          notify={notify}
          onBack={() => {
            setViewing(null);
            void load();
          }}
          onEdit={(order) => setEditing(order)}
        />

        {editing && (
          <PurchaseOrderEditor
            order={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setViewing(null);
              void load();
              notify('采购订单草稿已保存');
            }}
            notify={notify}
          />
        )}
      </>
    );
  }

  return (
    <BusinessPageShell className="purchase-orders-v15" width="rail">
      <BusinessPageHeader
        title="采购订单"
        primaryAction={
          can(user, 'PURCHASE_ORDERS_CREATE') && (
            <BusinessAction
              hierarchy="primary"
              onClick={() => setEditing({})}
            >
              新建采购订单
            </BusinessAction>
          )
        }
        help={
          <HelpDisclosure summary="流程说明">
            <p>
              采购订单审批只代表采购授权，不等于已经收货，
              也不等于已经形成供应商应付。
              后续采购入库和供应商账单分别处理。
            </p>
          </HelpDisclosure>
        }
      />

      <section
        className="order-list-toolbar"
        aria-label="采购订单筛选"
      >
        <SearchField
          value={search}
          onChange={setSearch}
          onSubmit={load}
          placeholder="搜索订单号或供应商"
        />

        <SegmentedControl
          label="订单状态"
          value={status}
          onChange={setStatus}
          options={ORDER_STATUS_OPTIONS}
        />
      </section>

      {listState === 'LOADING' && (
        <BusinessState
          kind="LOADING"
          title="正在加载采购订单"
        />
      )}

      {listState === 'ERROR' && (
        <BusinessState
          kind="ERROR"
          title="采购订单加载失败"
          description="请检查连接后重试。"
          retry={load}
        />
      )}

      {listState === 'EMPTY' && (
        <BusinessState
          kind="EMPTY"
          title="还没有采购订单"
          description="创建采购订单后，可以提交业务审批并安排后续采购入库。"
          action={
            can(user, 'PURCHASE_ORDERS_CREATE') && (
              <BusinessAction
                hierarchy="primary"
                onClick={() => setEditing({})}
              >
                新建采购订单
              </BusinessAction>
            )
          }
        />
      )}

      {listState === 'NO_RESULTS' && (
        <BusinessState
          kind="NO_RESULTS"
          title="没有符合条件的采购订单"
          description="可以调整搜索内容或订单状态。"
        />
      )}

      {listState === 'READY' && (
        <CompactRecordList className="order-record-list">
          {orders.map((order) => (
            <CompactRecord
              key={order.id}
              title={order.orderNo}
              subtitle={order.supplierName}
              status={
                <StatusChip status={order.status}>
                  {order.status === 'SUBMITTED'
                    ? '待审批'
                    : order.statusLabel}
                </StatusChip>
              }
              metadata={[
                {
                  label: '当前阶段',
                  value: orderStageText(order, 'purchase'),
                },
                {
                  label: '制单信息',
                  value: (
                    <>
                      {order.creatorName || '—'}
                      <span> · {dateTime(order.createdAt)}</span>
                    </>
                  ),
                },
              ]}
              metrics={[
                {
                  label: '订单金额',
                  value: money(order.totalCents),
                },
                {
                  label: '货品明细',
                  value: `${order.itemCount || 0} 项`,
                },
                {
                  label: '采购入库',
                  value: order.receiptCount
                    ? `${order.receiptCount} 张`
                    : '尚未入库',
                },
              ]}
              onOpen={() => setViewing({ id: order.id })}
              action={
                <CanonicalActionMenu label={`采购订单 ${order.orderNo} 的更多操作`}>
                  <button
                    type="button"
                    onClick={() => setViewing({ id: order.id })}
                  >
                    查看详情
                  </button>

                  {can(user, 'PURCHASE_ORDERS_CREATE') &&
                    ['DRAFT', 'REJECTED'].includes(order.status) && (
                      <button
                        type="button"
                        onClick={() => setEditing(order)}
                      >
                        编辑草稿
                      </button>
                    )}

                  {can(user, 'PURCHASE_ORDERS_CREATE') &&
                    order.status === 'DRAFT' && (
                      <ConfirmDelete
                        label="采购订单"
                        buttonLabel="删除草稿"
                        message={`确定删除采购订单“${order.orderNo}”吗？未提交草稿删除后无法恢复。`}
                        onConfirm={() => deleteOrder(order)}
                      />
                    )}
                </CanonicalActionMenu>
              }
            />
          ))}
        </CompactRecordList>
      )}

      {editing && (
        <PurchaseOrderEditor
          order={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            notify('采购订单草稿已保存');
          }}
          notify={notify}
        />
      )}
    </BusinessPageShell>
  );
}

function PurchaseOrderEditor({ order, onClose, onSaved, notify }) {
  const [suppliers, setSuppliers] = useState([]); const [products, setProducts] = useState([]); const [loading, setLoading] = useState(Boolean(order.id));
  // V1.3 Phase 1: PO commercial contract — order date, expected delivery
  // date, payment terms, supplier contact/phone/address snapshot. The
  // supplier master provides defaults for the snapshot fields.
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    supplierId: '', orderDate: today, expectedDeliveryDate: '', paymentTerms: '', paymentTermsDays: 0,
    supplierContactName: '', supplierContactPhone: '', supplierAddress: '',
    remark: '', items: [{ productId: '', quantity: 1, price: '' }],
  });
  useEffect(() => {
    Promise.all([api('/api/suppliers'), api('/api/products'), order.id ? api(`/api/purchase-orders/${order.id}`) : null]).then(([s, p, detail]) => {
      setSuppliers(s.suppliers.filter((x) => x.active)); setProducts(p.products.filter((x) => x.active));
      if (detail) {
        setForm({
          supplierId: detail.order.supplierId,
          orderDate: detail.order.orderDate || today,
          expectedDeliveryDate: detail.order.expectedDeliveryDate || '',
          paymentTerms: detail.order.paymentTerms || '',
          paymentTermsDays: detail.order.paymentTermsDays ?? 0,
          supplierContactName: detail.order.supplierContactName || '',
          supplierContactPhone: detail.order.supplierContactPhone || '',
          supplierAddress: detail.order.supplierAddress || '',
          remark: detail.order.remark,
          // UAT R4 (UAT-FUNC-004): preserve canonical source-line
          // identity for source-derived POs so unchanged source lines
          // are not misclassified as a mutation by backend immutability
          // validation.
          items: detail.order.items.map((x) => ({
            productId: x.productId,
            quantity: x.quantity,
            price: x.unitPriceCents / 100,
            purchaseRequisitionItemId: x.purchaseRequisitionItemId || null,
          })),
        });
      }
    }).catch((e) => notify(e.message, 'error')).finally(() => setLoading(false));
  }, []);
  function applySupplierSnapshot(supplierId) {
    const supplier = suppliers.find((s) => s.id === supplierId);
    setForm((current) => ({
      ...current,
      supplierId,
      supplierContactName: current.supplierContactName || supplier?.contact || '',
      supplierContactPhone: current.supplierContactPhone || supplier?.phone || '',
      supplierAddress: current.supplierAddress || supplier?.address || '',
      paymentTermsDays: supplier?.paymentTermsDays ?? 0,
    }));
  }
  const totalCents = useMemo(() => form.items.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (yuanToNonNegativeCents(line.price) || 0), 0), [form]);
  function updateLine(index, patch) { setForm({ ...form, items: form.items.map((line, i) => i === index ? { ...line, ...patch } : line) }); }
  function chooseProduct(index, productId) { const product = products.find((p) => p.id === productId); updateLine(index, { productId, price: product ? product.priceCents / 100 : '' }); }
  async function save(e) {
    e.preventDefault();
    try {
      await api(order.id ? `/api/purchase-orders/${order.id}` : '/api/purchase-orders', {
        method: order.id ? 'PUT' : 'POST',
        body: {
          ...form,
          items: form.items.map((x) => ({
            productId: x.productId,
            quantity: Number(x.quantity),
            unitPriceCents: yuanToNonNegativeCents(x.price),
            // UAT R4 (UAT-FUNC-004): carry canonical source-line
            // identity through to PUT body. Backend sourceLineId
            // resolver accepts camel / snake / sourceItemId.
            purchaseRequisitionItemId: x.purchaseRequisitionItemId || null,
          })),
        },
      });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title={order.id ? `编辑订单 ${order.orderNo}` : '新建采购订单'} onClose={onClose} wide>
    {loading ? <Loading/> : <form onSubmit={save}>
      <div className="form-grid order-head">
        <label>供应商<select value={form.supplierId} onChange={(e) => applySupplierSnapshot(e.target.value)} required><option value="">请选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label>
        <label>订单日期<input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} required/></label>
        <label>预计交期<input type="date" value={form.expectedDeliveryDate} onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })} required/></label>
        <label>付款条件<input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} maxLength={200} placeholder="如：月结 30 天"/></label>
        <label>账期天数<input type="number" min="0" step="1" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: Number(e.target.value) })} required/></label>
        <label>供应商联系人<input value={form.supplierContactName} onChange={(e) => setForm({ ...form, supplierContactName: e.target.value })} maxLength={50}/></label>
        <label>供应商电话<input value={form.supplierContactPhone} onChange={(e) => setForm({ ...form, supplierContactPhone: e.target.value })} maxLength={30}/></label>
        <label className="full">供应商地址<input value={form.supplierAddress} onChange={(e) => setForm({ ...form, supplierAddress: e.target.value })} maxLength={200}/></label>
        <label className="full">订单备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="可填写交期或特殊说明"/></label>
      </div>
      <div className="line-title"><div><strong>订单明细</strong><span>选择货品并填写数量、成交单价</span></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1, price: '' }] })}>＋ 添加一行</button></div>
      <div className="line-table"><div className="line-row line-header"><span>#</span><span>货品</span><span>数量</span><span>单位</span><span>单价（元）</span><span>金额</span><span/></div>
        {form.items.map((line, index) => { const product = products.find((p) => p.id === line.productId); return <div className="line-row" key={index}><span>{index + 1}</span><select value={line.productId} onChange={(e) => chooseProduct(index, e.target.value)} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} required/><span>{product?.unit || '—'}</span><input type="number" min="0" step="0.01" value={line.price} onChange={(e) => updateLine(index, { price: e.target.value })} required/><strong>{money(Math.round((Number(line.quantity)||0)*(Number(line.price)||0)*100))}</strong><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>×</button></div>; })}
      </div>
      <div className="order-total"><span>订单合计</span><strong>{money(totalCents)}</strong></div><FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

function PurchaseOrderDetail({
  id,
  user,
  onBack,
  onEdit,
  notify,
}) {
  return (
    <OrderDocumentDetail
      kind="purchase"
      id={id}
      user={user}
      onBack={onBack}
      onEdit={onEdit}
      notify={notify}
    />
  );
}

export function Warehouses({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/warehouses?search=${encodeURIComponent(search)}`).then((r) => setItems(r.warehouses)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <BusinessPageShell className="warehouses-v15" width="rail">
    <BusinessPageHeader title="仓库资料" help={<HelpDisclosure summary="主数据说明"><p>维护可用于库存业务的仓库档案；停用仓库不会移除历史库存证据。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索仓库编码或名称" action={can(user, 'WAREHOUSES_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增仓库</button>}/>
    <div className="table-wrap"><table><thead><tr><th>仓库编码</th><th>仓库名称</th><th>地址</th><th>管理员</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td className="dim">{item.address || '—'}</td><td>{item.manager || '—'}</td><td><Active active={item.active}/></td><td>{can(user, 'WAREHOUSES_MANAGE') && <MasterActions item={item} label="仓库" endpoint="/api/warehouses" onEdit={setEditing} onChanged={load} notify={notify}/>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有找到仓库资料"/>}</div>
    {editing && <WarehouseModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('仓库资料已保存'); }} notify={notify}/>}
  </BusinessPageShell>;
}

function WarehouseModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', address: '', manager: '', active: true, ...value });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/warehouses/${value.id}` : '/api/warehouses', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑仓库' : '新增仓库'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>仓库编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 WH-003" required/></label>
    <label>仓库名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
    <label className="full">仓库地址<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}/></label>
    <label className="full">管理员<input value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })}/></label>
    {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该仓库</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

export function Inventory({ user, notify }) {
  const [warehouses, setWarehouses] = useState([]); const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]); const [searchWh, setSearchWh] = useState(''); const [searchPd, setSearchPd] = useState('');
  const [tab, setTab] = useState('query');
  const [stockDetail, setStockDetail] = useState(null);
  useEffect(() => { Promise.all([api('/api/warehouses'), api('/api/products')]).then(([w, p]) => { setWarehouses(w.warehouses.filter((x) => x.active)); setProducts(p.products.filter((x) => x.active)); }).catch((e) => notify(e.message, 'error')); }, []);
  const loadInventory = () => { let url = '/api/inventory'; const params = []; if (searchWh) params.push(`warehouse=${searchWh}`); if (searchPd) params.push(`product=${searchPd}`); if (params.length) url += '?' + params.join('&'); api(url).then((r) => setInventory(r.inventory)).catch((e) => notify(e.message, 'error')); };
  useEffect(() => { void loadInventory(); }, [searchWh, searchPd]);
  return <BusinessPageShell className="inventory-operations-v15" width="rail">
    <BusinessPageHeader title="库存作业" context={tab === 'query' ? '即时库存' : tab === 'transfer' ? '库存调拨' : tab === 'check' ? '库存盘点' : '库存调整'} help={<HelpDisclosure summary="作业说明"><p>库存查询、调拨、盘点与调整共享同一工作面；调拨与调整的确认是库存生效动作，不代表业务审批。</p></HelpDisclosure>}/>
    <div className="inventory-workbench" aria-label="库存功能"><button className={tab === 'query' ? 'active' : ''} onClick={() => setTab('query')}>查询</button><button className={tab === 'transfer' ? 'active' : ''} onClick={() => setTab('transfer')}>调拨</button><button className={tab === 'check' ? 'active' : ''} onClick={() => setTab('check')}>盘点</button>{can(user, 'INVENTORY_ADJUSTMENT_MANAGE') && <button className={tab === 'adjustment' ? 'active' : ''} onClick={() => setTab('adjustment')}>调整</button>}<AppLink page="inventory-transactions">异动</AppLink></div>
    {tab === 'query' && <><div className="toolbar inventory-filters"><select value={searchPd} onChange={(e) => setSearchPd(e.target.value)}><option value="">全部货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><select value={searchWh} onChange={(e) => setSearchWh(e.target.value)}><option value="">全部仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></div>
      <div className="inventory-records">{inventory.map((row) => <button type="button" className="inventory-record" onClick={() => setStockDetail(row)} key={row.warehouse_id + '-' + row.product_id}><span className="inventory-record__main"><strong>{row.productName}</strong><span className="mono">{row.productCode}</span></span><strong className="inventory-record__quantity">{quantity(row.quantity)} <small>{row.unit}</small></strong><span className="inventory-record__warehouse">{row.warehouseName}</span><Icon name="chevron" size={18}/></button>)}{!inventory.length && <Empty title="暂无库存记录" text="完成入库或调整后，将在这里显示。"/>}</div></>}
    {tab === 'check' && <InventoryChecks user={user} notify={notify} warehouses={warehouses} products={products}/>}
    {tab === 'transfer' && <InventoryTransfers user={user} notify={notify} warehouses={warehouses} products={products}/>}
    {tab === 'adjustment' && can(user, 'INVENTORY_ADJUSTMENT_MANAGE') && <InventoryAdjustments notify={notify} warehouses={warehouses} products={products} inventory={inventory}/>}
    {stockDetail && <InventoryStockDetail value={stockDetail} onClose={() => setStockDetail(null)} notify={notify}/>}
  </BusinessPageShell>;
}

function InventoryStockDetail({ value, onClose, notify }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => { api(`/api/inventory/${value.warehouse_id}/${value.product_id}`).then(setDetail).catch((e) => notify(e.message, 'error')); }, []);
  const labels = { PURCHASE_RECEIPT: '采购入库', SALES_DELIVERY: '销售出货', SALES_RETURN: '销售退货', PURCHASE_RETURN: '采购退货', INVENTORY_TRANSFER: '库存调拨', INVENTORY_CHECK: '库存盘点', INVENTORY_ADJUSTMENT: '库存调整' };
  return <Modal title="库存详情" onClose={onClose} wide>{!detail ? <Loading/> : <><div className="detail-head"><div><span className="mono">{detail.stock.productCode}</span><h3>{detail.stock.productName}</h3><p>{detail.stock.warehouseName}</p></div><strong>{detail.stock.quantity} {detail.stock.unit}</strong></div><h4>最近库存异动</h4><div className="table-wrap"><table><thead><tr><th>时间</th><th>来源</th><th>方向</th><th>数量</th><th>变动后</th></tr></thead><tbody>{detail.transactions.map((tx) => <tr key={tx.id}><td>{dateTime(tx.createdAt)}</td><td>{labels[tx.sourceType] || tx.sourceType}<small className="block mono">{tx.sourceNo || '—'}</small></td><td>{tx.direction}</td><td>{tx.quantityChange}</td><td>{tx.balanceAfter}</td></tr>)}</tbody></table>{!detail.transactions.length && <Empty text="暂无库存异动"/>}</div></>}</Modal>;
}

function InventoryAdjustments({ notify, warehouses, products, inventory }) {
  const [items, setItems] = useState([]); const [editing, setEditing] = useState(null); const [viewing, setViewing] = useState(null);
  const load = () => api('/api/inventory-adjustments').then((r) => setItems(r.inventoryAdjustments || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  async function openDetail(item) {
    try { const result = await api(`/api/inventory-adjustments/${item.id}`); setViewing(result.inventoryAdjustment); }
    catch (error) { notify(error.message, 'error'); }
  }
  async function changeState(item, action) {
    try {
      await api(`/api/inventory-adjustments/${item.id}/${action}`, { method: 'POST' });
      notify(action === 'confirm' ? '库存调整已确认' : '库存调整已取消'); setViewing(null); await load();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <><Toolbar search={() => {}} placeholder="" action={<button className="primary" onClick={() => setEditing({})}>＋ 新建调整单</button>}/>
    <p className="section-hint">用于人工修正、发现损坏、数据纠正或期初调整；正数增加库存，负数减少库存。</p>
    <div className="table-wrap"><table><thead><tr><th>调整单号</th><th>仓库</th><th>调整日期</th><th>状态</th><th>调整项</th><th>原因</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="clickable" onClick={() => void openDetail(item)}><td className="mono">{item.adjustment_no}</td><td>{item.warehouseName}</td><td>{item.adjustment_date}</td><td><Status status={item.status} label={item.statusLabel}/></td><td>{item.itemCount}</td><td>{item.reason}</td></tr>)}</tbody></table>{!items.length && <Empty text="没有库存调整记录"/>}</div>
    {editing && <InventoryAdjustmentModal value={editing} warehouses={warehouses} products={products} inventory={inventory} notify={notify} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); notify('库存调整单已保存'); }}/>}
    {viewing && <InventoryAdjustmentDetail value={viewing} notify={notify} onDeleted={() => { setViewing(null); void load(); }} onClose={() => setViewing(null)} onEdit={() => { setViewing(null); setEditing(viewing); }} onAction={changeState}/>}
  </>;
}

function InventoryAdjustmentModal({ value, warehouses, products, inventory, notify, onClose, onSaved }) {
  const initialItems = value.items?.map((item) => ({ productId: item.productId, quantityDelta: item.quantityDelta, trackingAllocations: item.trackingAllocations || [] })) || [{ productId: '', quantityDelta: '', trackingAllocations: [] }];
  const [form, setForm] = useState({ warehouseId: value.warehouse_id || '', adjustmentDate: value.adjustment_date || new Date().toISOString().slice(0, 10), reason: value.reason || '', items: initialItems });
  const [warehouseStock, setWarehouseStock] = useState(inventory);
  useEffect(() => { if (form.warehouseId) api(`/api/inventory?warehouse=${encodeURIComponent(form.warehouseId)}`).then((r) => setWarehouseStock(r.inventory || [])).catch((e) => notify(e.message, 'error')); else setWarehouseStock([]); }, [form.warehouseId]);
  function updateLine(index, patch) { setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, ...patch } : item) }); }
  function currentStock(productId) { return warehouseStock.find((row) => row.warehouse_id === form.warehouseId && row.product_id === productId)?.quantity; }
  async function save(event) {
    event.preventDefault();
    try { await api(value.id ? `/api/inventory-adjustments/${value.id}` : '/api/inventory-adjustments', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); }
    catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title={value.id ? '编辑库存调整单' : '新建库存调整单'} onClose={onClose} wide><form onSubmit={save}>
    <div className="form-grid order-head"><label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required><option value="">请选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>调整日期<input type="date" value={form.adjustmentDate} onChange={(e) => setForm({ ...form, adjustmentDate: e.target.value })} required/></label><label className="full">调整原因<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="必填，如：发现损坏、数据纠正、期初调整" required/></label></div>
    <div className="line-title"><div><strong>调整明细</strong><small className="block">输入变化量：正数增加库存，负数减少库存；系统在确认时计算调整前后数量。</small></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantityDelta: '' }] })}>＋ 添加一行</button></div>
    <div className="line-table adjustment-lines"><div className="line-row line-header"><span>#</span><span>货品</span><span>当前库存</span><span>调整数量 (+/-)</span><span/></div>{form.items.map((line, index) => <div className="tracking-line" key={index}><div className="line-row"><span>{index + 1}</span><select value={line.productId} onChange={(e) => updateLine(index, withProductTracking(line, e.target.value))} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><span className="number">{line.productId ? currentStock(line.productId) ?? 0 : '—'}</span><input type="number" step="0.01" value={line.quantityDelta} onChange={(e) => updateLine(index, { quantityDelta: e.target.value, trackingAllocations: [] })} placeholder="如 5 或 -3" required/><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>×</button></div><TrackingAllocationEditor product={products.find((p) => p.id === line.productId)} warehouseId={form.warehouseId} quantity={Math.abs(Number(line.quantityDelta) || 0)} businessDate={form.adjustmentDate} direction={Number(line.quantityDelta) > 0 ? 'IN' : 'OUT'} value={line.trackingAllocations || []} onChange={(trackingAllocations) => updateLine(index, { trackingAllocations })} notify={notify}/></div>)}</div>
    <FormActions onClose={onClose} saveText="保存草稿"/>
  </form></Modal>;
}

function InventoryAdjustmentDetail({ value, notify, onDeleted, onClose, onEdit, onAction }) {
  const stages = [{ key: 'DRAFT', label: '草稿' }, { key: 'CONFIRMED', label: '已确认' }];
  return <Modal title="库存调整单详情" onClose={onClose} wide><div className="detail-head"><div><span className="mono">{value.adjustment_no}</span><h3>{value.warehouseName}</h3><p>{value.reason}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    {value.status !== 'CANCELLED' && <MobileWorkflowProgress stages={stages} currentStatus={value.status} title="调整进度"/>}
    <div className="detail-grid"><div><span>调整日期</span><strong>{value.adjustment_date}</strong></div><div><span>创建人</span><strong>{value.creatorName}</strong></div><div><span>确认人</span><strong>{value.confirmedByName || '尚未确认'}</strong></div><div><span>确认时间</span><strong>{dateTime(value.confirmed_at)}</strong></div></div>
    <div className="table-wrap inset"><table><thead><tr><th>#</th><th>货品</th><th className="number">调整前</th><th className="number">调整数量</th><th className="number">调整后</th></tr></thead><tbody>{value.items.map((item) => <tr key={item.id}><td>{item.line_no}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td className="number">{item.beforeQuantity ?? '确认时计算'}</td><td className={`number ${item.quantityDelta > 0 ? 'positive' : 'negative'}`}>{item.quantityDelta > 0 ? '+' : ''}{item.quantityDelta}</td><td className="number">{item.afterQuantity ?? '—'}</td></tr>)}</tbody></table></div>
    {value.status === 'DRAFT' && <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>关闭</button><button type="button" className="row-action" onClick={onEdit}>编辑</button><ConfirmDelete label="库存调整单" onConfirm={async () => { try { await api(`/api/inventory-adjustments/${value.id}`, { method: 'DELETE' }); notify('库存调整单草稿已删除'); onDeleted(); } catch (error) { notify(error.message, 'error'); throw error; } }}/><button type="button" className="danger-button" onClick={() => onAction(value, 'cancel')}>取消调整</button><button type="button" className="approve-button" onClick={() => onAction(value, 'confirm')}>确认调整</button></div>}
    {value.status !== 'DRAFT' && <p className="section-hint">已确认或已取消的调整单只读；已确认差错请通过一张反向调整单纠正。</p>}
  </Modal>;
}

function InventoryChecks({ user, notify, warehouses, products }) {
  const [checks, setChecks] = useState([]); const [editing, setEditing] = useState(null);
  const load = () => api('/api/inventory-checks').then((r) => setChecks(r.inventoryChecks)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  function changeState(check, action) { api(`/api/inventory-checks/${check.id}`, { method: 'PATCH', body: { action } }).then(() => { notify('盘点已提交审批'); load(); }).catch((e) => notify(e.message, 'error')); }
  return <><Toolbar search={() => {}} placeholder="" action={can(user, 'INVENTORY_CHECK_CREATE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建盘点单</button>}/>
    <div className="table-wrap"><table><thead><tr><th>盘点单号</th><th>仓库</th><th>货品</th><th>账面数量</th><th>实盘数量</th><th>差异数量</th><th>状态</th><th>业务日期</th><th>制单人</th><th>时间</th><th/></tr></thead><tbody>{checks.map((c) => <tr key={c.id}><td className="mono">{c.check_no}</td><td>{c.warehouseName}</td><td>{c.productCode} {c.productName}</td><td className="number">{c.system_quantity}</td><td className="number">{c.actual_quantity}</td><td className={`number ${c.difference > 0 ? 'positive' : c.difference < 0 ? 'negative' : ''}`}>{c.difference > 0 ? '+' : ''}{c.difference}</td><td><Status status={c.status} label={c.statusLabel}/></td><td>{c.business_date || <span className="dim">业务日期缺失</span>}</td><td>{c.creatorName}</td><td className="dim">{dateTime(c.created_at)}</td><td>{c.status === 'DRAFT' && can(user, 'INVENTORY_CHECK_CREATE') && <><button className="row-action" onClick={() => setEditing(c)}>编辑</button><button className="approve-button" onClick={() => changeState(c, 'SUBMIT')}>提交审批</button></>}{c.status === 'SUBMITTED' && can(user, 'INVENTORY_CHECK_APPROVE') && <AppLink className="row-action strong" page="approvals">前往审批中心</AppLink>}{c.status === 'SUBMITTED' && !can(user, 'INVENTORY_CHECK_APPROVE') && <span className="dim">等待审批</span>}</td></tr>)}</tbody></table>{!checks.length && <Empty text="没有盘点记录"/>}</div>
    {editing && <InventoryCheckModal value={editing} warehouses={warehouses} products={products} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('盘点单已保存'); }} notify={notify}/>}
  </>;
}

function InventoryCheckModal({ value, warehouses, products, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    warehouseId: value.warehouse_id || '',
    productId: value.product_id || '',
    businessDate: value.business_date || value.businessDate || todayIso(),
    actualQuantity: value.actual_quantity ?? '',
    reason: value.reason || '',
    trackingAllocations: value.trackingAllocations || [],
  });
  const [systemQuantity, setSystemQuantity] = useState(Number(value.system_quantity || 0));
  useEffect(() => {
    if (!form.warehouseId || !form.productId) { setSystemQuantity(0); return; }
    api(`/api/inventory?warehouse=${encodeURIComponent(form.warehouseId)}&product=${encodeURIComponent(form.productId)}`).then((result) => setSystemQuantity(Number(result.inventory?.[0]?.quantity || 0))).catch((error) => notify(error.message, 'error'));
  }, [form.warehouseId, form.productId]);
  async function save(e) {
    e.preventDefault();
    if (!form.businessDate) { notify('请填写盘点业务日期', 'error'); return; }
    try {
      if (value.id) await api(`/api/inventory-checks/${value.id}`, { method: 'PATCH', body: { action: 'UPDATE', ...form, businessDate: form.businessDate } });
      else await api('/api/inventory-checks', { method: 'POST', body: { ...form, businessDate: form.businessDate } });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title={value.id ? '编辑盘点单' : '新建盘点单'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required><option value="">请选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
    <label>货品<select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value, trackingAllocations: [] })} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
    <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} required/></label>
    <label>实际盘点数量<input type="number" min="0" step="0.01" value={form.actualQuantity} onChange={(e) => setForm({ ...form, actualQuantity: e.target.value })} required/></label>
    <label className="full">盘点原因<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="如：年度盘点、发现异常等"/></label>
    <TrackingAllocationEditor product={products.find((p) => p.id === form.productId)} warehouseId={form.warehouseId} quantity={Math.abs((Number(form.actualQuantity) || 0) - systemQuantity)} businessDate={form.businessDate} direction={(Number(form.actualQuantity) || 0) >= systemQuantity ? 'IN' : 'OUT'} value={form.trackingAllocations || []} onChange={(trackingAllocations) => setForm({ ...form, trackingAllocations })} notify={notify}/>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

function InventoryTransfers({ user, notify, warehouses, products }) {
  const [transfers, setTransfers] = useState([]); const [editing, setEditing] = useState(null); const [viewing, setViewing] = useState(null);
  const load = () => api('/api/inventory-transfers').then((r) => setTransfers(r.inventoryTransfers)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  function openDetail(transfer) { api(`/api/inventory-transfers/${transfer.id}`).then((r) => setViewing(r.transfer)).catch((e) => notify(e.message, 'error')); }
  // V1.4-E2: capability check uses the canonical CONFIRM permission. Legacy
  // roles still holding only APPROVE keep working because the backend
  // accepts APPROVE as a deprecated alias; we map both on the frontend so
  // operators see the same button regardless of how their role was seeded.
  const canConfirmTransfer = can(user, 'INVENTORY_TRANSFER_CONFIRM') || can(user, 'INVENTORY_TRANSFER_APPROVE');
  const canCancelTransfer = can(user, 'INVENTORY_TRANSFER_CREATE');
  function changeState(id, action) { api(`/api/inventory-transfers/${id}/${action}`, { method: 'POST' }).then(() => { notify(action === 'transfer' ? '调拨已确认' : '调拨已取消'); load(); }).catch((e) => notify(e.message, 'error')); }
  return <><Toolbar search={() => {}} placeholder="" action={can(user, 'INVENTORY_TRANSFER_CREATE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建调拨单</button>}/>
    <div className="table-wrap"><table><thead><tr><th>调拨单号</th><th>调出仓库</th><th>调入仓库</th><th>状态</th><th>业务日期</th><th>创建人</th><th>创建时间</th><th/></tr></thead><tbody>{transfers.map((t) => <tr key={t.id} className="clickable" onClick={() => openDetail(t)}><td className="mono">{t.transfer_no}</td><td>{t.fromWarehouseName}</td><td>{t.toWarehouseName}</td><td><Status status={t.status} label={t.statusLabel}/></td><td>{t.business_date || (t.businessDateMissing ? <span className="dim">业务日期缺失</span> : <span className="dim">—</span>)}</td><td>{t.creatorName}</td><td className="dim">{dateTime(t.createdAt)}</td><td onClick={(e) => e.stopPropagation()}>{t.status === 'DRAFT' && <>{canCancelTransfer && <button className="row-action danger" onClick={() => changeState(t.id, 'cancel')}>取消</button>}{canConfirmTransfer && <button className="approve-button" onClick={() => changeState(t.id, 'transfer')}>确认调拨</button>}</>}</td></tr>)}</tbody></table>{!transfers.length && <Empty text="没有调拨记录"/>}</div>
    {editing && <InventoryTransferModal value={editing} warehouses={warehouses} products={products} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('调拨单已保存'); }} notify={notify}/>}
    {viewing && <InventoryTransferDetail value={viewing} onClose={() => setViewing(null)}/>}
  </>;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function InventoryTransferModal({ value, warehouses, products, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    fromWarehouseId: '',
    toWarehouseId: '',
    businessDate: value.business_date || value.businessDate || todayIso(),
    remark: '',
    items: [{ productId: '', quantity: 1 }],
  });
  const total = useMemo(() => form.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0), [form]);
  function updateLine(idx, patch) { setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }); }
  async function save(e) {
    e.preventDefault();
    if (form.fromWarehouseId === form.toWarehouseId) { notify('源仓库和目标仓库不能相同', 'error'); return; }
    if (!form.businessDate) { notify('请填写业务日期', 'error'); return; }
    if (!form.items.length) { notify('请添加调拨货品', 'error'); return; }
    try {
      await api('/api/inventory-transfers', { method: 'POST', body: { ...form, businessDate: form.businessDate } });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }
  return <Modal title="新建调拨单" onClose={onClose} wide><form onSubmit={save}>
    <div className="form-grid order-head">
      <label>源仓库<select value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })} required><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
      <label>目标仓库<select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })} required><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
      <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} required/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="调拨说明"/></label>
    </div>
    <div className="line-title"><div><strong>调拨明细</strong></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1 }] })}>＋ 添加一行</button></div>
    <div className="line-table"><div className="line-row line-header"><span>#</span><span>货品</span><span>数量</span><span/></div>
      {form.items.map((line, idx) => <div className="tracking-line" key={idx}><div className="line-row"><span>{idx + 1}</span><select value={line.productId} onChange={(e) => updateLine(idx, withProductTracking(line, e.target.value))} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value, trackingAllocations: [] })} required/><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}>×</button></div><TrackingAllocationEditor product={products.find((p) => p.id === line.productId)} warehouseId={form.fromWarehouseId} quantity={line.quantity} businessDate={form.businessDate} direction="OUT" value={line.trackingAllocations || []} onChange={(trackingAllocations) => updateLine(idx, { trackingAllocations })} notify={notify}/></div>)}
    </div>
    <div className="order-total"><span>合计</span><strong>{total}</strong></div><FormActions onClose={onClose} saveText="保存草稿"/>
  </form></Modal>;
}

function InventoryTransferDetail({ value, onClose }) {
  const isTransferred = value.status === 'TRANSFERRED';
  const isCancelled = value.status === 'CANCELLED';
  const businessDateLabel = value.business_date || (value.businessDateMissing ? '业务日期缺失' : '—');
  return <Modal title="调拨单详情" onClose={onClose} wide>{value ? <>
    <div className="detail-head"><div><span className="mono">{value.transfer_no}</span><h3>{value.fromWarehouseName} → {value.toWarehouseName}</h3><p>制单人：{value.creatorName}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    <div className="detail-grid">
      <div><span>业务日期</span><strong>{businessDateLabel}</strong></div>
      <div><span>创建时间</span><strong>{dateTime(value.createdAt)}</strong></div>
      {isTransferred && <div><span>确认人</span><strong>{value.confirmedByName || value.reviewerName || '尚未确认'}</strong></div>}
      {isTransferred && <div><span>确认时间</span><strong>{dateTime(value.confirmedAt || value.updated_at)}</strong></div>}
      {isCancelled && <div><span>作废人</span><strong>{value.cancelledByName || value.reviewerName || '尚未作废'}</strong></div>}
      {isCancelled && <div><span>作废时间</span><strong>{dateTime(value.cancelledAt || value.updated_at)}</strong></div>}
      {!isTransferred && !isCancelled && <div><span>执行人</span><strong>{value.reviewerName || '尚未执行'}</strong></div>}
    </div>
    <div className="table-wrap inset"><table><thead><tr><th>#</th><th>货品</th><th>单位</th><th className="number">调拨数量</th></tr></thead><tbody>{value.items?.map((item) => <tr key={item.id}><td>{item.line_no || item.id}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td>{item.unit}</td><td className="number"><strong>{item.quantity}</strong></td></tr>)}</tbody></table></div>
    {value.remark && <p className="remark"><b>备注：</b>{value.remark}</p>}
  </> : <Loading/> }</Modal>;
}
