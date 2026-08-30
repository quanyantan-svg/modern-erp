import { useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const money = (cents = 0) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
const dateTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const can = (user, permission) => user?.permissions?.includes(permission);

// Lucide-style inline SVG icon component
const Icon = ({ d, size = 17, strokeWidth = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    <path d={d}/>
  </svg>
);

// Icon library
const ic = {
  dashboard: <Icon d="M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5zm-10 10a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-6z"/>,
  orders: <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 14l2 2 4-4"/>,
  approvals: <Icon d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>,
  purchaseOrders: <Icon d="M3 3h18v4H3zM3 10h18v4H3zM3 15h12v4H3z"/>,
  suppliers: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0a4 4 0 0 0 4-4v-2M9 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2"/>,
  customers: <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>,
  products: <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>,
  warehouses: <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10"/>,
  inventory: <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>,
  purchaseReceipts: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6"/>,
  salesDeliveries: <Icon d="M5 18H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2M9 18h6v4H9z"/>,
  returns: <Icon d="M9 14L4 9l5-5M4 9h11a4 4 0 0 1 0 8h-1"/>,
  inventoryTransactions: <Icon d="M12 2v20M2 12h20M7 7l5 5-5 5M17 7l-5 5 5 5"/>,
  accountsReceivable: <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 5v5l3 3"/>,
  accountsPayable: <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 5v5l3 3"/>,
  paymentCollections: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  paymentDisbursements: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  accounting: <Icon d="M2 17l10-5 10 5M2 12l10-5 10 5M2 7l10-5 10 5M12 22V12M7 7l5-2 5 2"/>,
  cashJournals: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  bankAccounts: <Icon d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11"/>,
  bills: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6"/>,
  fixedAssets: <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>,
  boms: <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>,
  productionOrders: <Icon d="M14.7 6.3a1 1 0 0 0 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.4L10 12.2l7.3-7.3a1 1 0 0 0-1.4-1.4z"/>,
  users: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0a4 4 0 0 0 4-4v-2M9 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2"/>,
};

// Navigation groups
const navGroups = [
  { key: 'dashboard', label: '工作台', icon: ic.dashboard, permission: 'DASHBOARD_VIEW' },
  null,
  { label: '销售与采购', items: [
    { key: 'orders', label: '销售订单', icon: ic.orders, any: ['ORDERS_VIEW', 'ORDERS_CREATE'] },
    { key: 'approvals', label: '订单审核', icon: ic.approvals, permission: 'ORDERS_APPROVE' },
    { key: 'purchase-orders', label: '采购订单', icon: ic.purchaseOrders, any: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE'] },
  ]},
  null,
  { label: '基础资料', items: [
    { key: 'suppliers', label: '供应商', icon: ic.suppliers, any: ['SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE'] },
    { key: 'customers', label: '客户', icon: ic.customers, any: ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE'] },
    { key: 'products', label: '货品', icon: ic.products, any: ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE'] },
    { key: 'warehouses', label: '仓库', icon: ic.warehouses, any: ['WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE'] },
  ]},
  null,
  { label: '仓储物流', items: [
    { key: 'inventory', label: '库存查询', icon: ic.inventory, any: ['INVENTORY_VIEW'] },
    { key: 'purchase-receipts', label: '采购入库', icon: ic.purchaseReceipts, any: ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
    { key: 'sales-deliveries', label: '销售出库', icon: ic.salesDeliveries, any: ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
    { key: 'returns', label: '退货管理', icon: ic.returns, any: ['RETURNS_VIEW', 'RETURNS_MANAGE'] },
    { key: 'inventory-transactions', label: '库存流水', icon: ic.inventoryTransactions, any: ['INVENTORY_VIEW'] },
  ]},
  null,
  { label: '财务资金', items: [
    { key: 'accounts-receivable', label: '应收账款', icon: ic.accountsReceivable, any: ['AR_VIEW', 'AR_MANAGE', 'ACCOUNTING_VIEW'] },
    { key: 'accounts-payable', label: '应付账款', icon: ic.accountsPayable, any: ['AP_VIEW', 'AP_MANAGE', 'ACCOUNTING_VIEW'] },
    { key: 'payment-collections', label: '收款记录', icon: ic.paymentCollections, any: ['AR_MANAGE', 'ACCOUNTING_VIEW'] },
    { key: 'payment-disbursements', label: '付款记录', icon: ic.paymentDisbursements, any: ['AP_MANAGE', 'ACCOUNTING_VIEW'] },
    { key: 'accounting', label: '会计凭证', icon: ic.accounting, any: ['ACCOUNTING_VIEW'] },
  ]},
  null,
  { label: '生产制造', items: [
    { key: 'boms', label: 'BOM 清单', icon: ic.boms, any: ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_ORDERS_CREATE'] },
    { key: 'production-orders', label: '生产工单', icon: ic.productionOrders, any: ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_ORDERS_CREATE'] },
  ]},
  null,
  { key: 'users', label: '用户与角色', icon: ic.users, any: ['USERS_MANAGE', 'ROLES_MANAGE'] },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [page, setPage] = useState(location.hash.slice(1) || 'dashboard');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!getToken()) return setChecking(false);
    api('/api/auth/me').then(({ user }) => setUser(user)).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const unauthorized = () => setUser(null);
    const hash = () => setPage(location.hash.slice(1) || 'dashboard');
    addEventListener('erp:unauthorized', unauthorized); addEventListener('hashchange', hash);
    return () => { removeEventListener('erp:unauthorized', unauthorized); removeEventListener('hashchange', hash); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = (message, type = 'success') => setToast({ message, type });
  if (checking) return <div className="boot"><div className="spinner"/><p>正在载入Modern ERP…</p></div>;
  if (!user) return <Login onLogin={setUser} notify={notify}/>;

  const visibleNav = navGroups.flatMap((g) => g?.items || []).filter((item) => item.permission ? can(user, item.permission) : item.any.some((p) => can(user, p)));
  if (!visibleNav.some((item) => item.key === page)) setTimeout(() => location.hash = visibleNav[0]?.key || '', 0);

  const pages = {
    dashboard: <Dashboard notify={notify}/>,
    orders: <Orders user={user} notify={notify}/>,
    approvals: <Approvals notify={notify}/>,
    customers: <Customers user={user} notify={notify}/>,
    suppliers: <Suppliers user={user} notify={notify}/>,
    purchaseOrders: <PurchaseOrders user={user} notify={notify}/>,
    products: <Products user={user} notify={notify}/>,
    warehouses: <Warehouses user={user} notify={notify}/>,
    inventory: <Inventory user={user} notify={notify}/>,
    cashJournals: <CashJournals user={user} notify={notify}/>,
      bankAccounts: <BankAccounts user={user} notify={notify}/>,
      bills: <Bills user={user} notify={notify}/>,
      fixedAssets: <FixedAssets user={user} notify={notify}/>,
      accounting: <Accounting user={user} notify={notify}/>,
    purchaseReceipts: <PurchaseReceipts user={user} notify={notify}/>,
    salesDeliveries: <SalesDeliveries user={user} notify={notify}/>,
    returns: <Returns user={user} notify={notify}/>,
    inventoryTransactions: <InventoryTransactions user={user} notify={notify}/>,
    accountsReceivable: <AccountsReceivable user={user} notify={notify}/>,
    accountsPayable: <AccountsPayable user={user} notify={notify}/>,
    paymentCollections: <PaymentCollections user={user} notify={notify}/>,
    paymentDisbursements: <PaymentDisbursements user={user} notify={notify}/>,
    boms: <Boms user={user} notify={notify}/>,
    productionOrders: <ProductionOrders user={user} notify={notify}/>,
    users: <UsersRoles user={user} notify={notify}/>
  };
  const current = visibleNav.find((item) => item.key === page) || visibleNav[0];

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* local logout still succeeds */ }
    setToken(''); setUser(null);
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">M</div><div><strong>Modern ERP</strong><span>现代化练习版</span></div></div>
      <nav>{navGroups.map((group, gi) => group === null
        ? <div key={'div-' + gi} className="sidebar-divider"/>
        : <div key={gi} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {group.items?.map((item) => visibleNav.some((v) => v.key === item.key) &&
              <a key={item.key} href={`#${item.key}`} className={page === item.key ? 'active' : ''}>
                <span className="nav-icon">{item.icon}</span>{item.label}
                {item.key === 'approvals' && <span className="nav-dot"/>}
              </a>
            )}
          </div>
      )}</nav>
      <div className="sidebar-note"><span>演示环境</span><p>数据保存在本地 SQLite，不连接原 ERP。</p></div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div><p className="topbar-eyebrow">销售业务中心</p><h1>{current?.label}</h1></div>
        <div className="user-area"><div className="avatar">{user.displayName.slice(0, 1)}</div><div><strong>{user.displayName}</strong><span>{user.roleName}</span></div><button className="text-button" onClick={logout}>退出</button></div>
      </header>
      <section className="page-content">{pages[page] || pages.dashboard}</section>
    </main>
    {toast && <div className={`toast ${toast.type}`}>{toast.type === 'success' ? '✓' : '!'} {toast.message}</div>}
  </div>;
}

function Login({ onLogin, notify }) {
  const [form, setForm] = useState({ username: 'sales', password: 'sales123' });
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    try { const result = await api('/api/auth/login', { method: 'POST', body: form }); setToken(result.token); onLogin(result.user); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  }
  const demos = [
    ['sales', 'sales123', '销售专员', '创建并提交订单'],
    ['reviewer', 'review123', '销售主管', '审核或驳回订单'],
    ['admin', 'admin123', '系统管理员', '管理用户、角色和资料']
  ];
  return <div className="login-page">
    <section className="login-story">
      <div className="login-badge">MODERN ERP</div>
      <h1>让每一张订单<br/><em>有迹可循。</em></h1>
      <p>从客户与货品资料，到销售制单、提交审批和订单追踪，一条清晰、可解释的最小业务链。</p>
      <div className="flow-strip"><span>基础资料</span><i>→</i><span>销售订单</span><i>→</i><span>提交审批</span><i>→</i><span>业务追踪</span></div>
    </section>
    <section className="login-panel">
      <div className="login-card">
        <div className="mini-brand"><div className="brand-mark">M</div><strong>Modern ERP</strong></div>
        <h2>欢迎回来</h2><p className="muted">使用演示账号进入销售业务中心</p>
        <form onSubmit={submit}>
          <label>登录账号<input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}/></label>
          <label>密码<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}/></label>
          <button className="primary wide" disabled={busy}>{busy ? '正在验证…' : '登录系统'}</button>
        </form>
        <div className="demo-title">快速选择演示角色</div>
        <div className="demo-accounts">{demos.map(([username, password, role, tip]) => <button key={username} onClick={() => setForm({ username, password })}>
          <span><strong>{role}</strong><small>{tip}</small></span><b>选择</b>
        </button>)}</div>
        <p className="security-hint">仅供本地练习，请勿将演示密码用于真实系统。</p>
      </div>
    </section>
  </div>;
}

function Dashboard({ notify }) {
  const [data, setData] = useState(null);
  useEffect(() => { 
    Promise.all([
      api('/api/dashboard'),
      api('/api/inventory/alerts')
    ]).then(([d, a]) => {
      setData({...d, alerts: a});
    }).catch((e) => notify(e.message, 'error')); 
  }, []);
  if (!data) return <Loading/>;
  const cards = [
    ['客户总数', data.customerCount, '家', 'teal'], ['在售货品', data.productCount, '项', 'blue'],
    ['销售订单', data.orderCount, '张', 'orange'], ['待我审核', data.pendingCount, '张', 'purple']
  ];
  return <>
    <div className="hero-card"><div><span className="pill">今日业务概览</span><h2>从一张清晰的订单开始</h2><p>订单经过保存、提交和审核，每一步都会留下操作记录。销售订单审核后只确认交易，不直接扣减库存。</p></div><div className="hero-amount"><span>已审核订单金额</span><strong>{money(data.approvedAmountCents)}</strong></div></div>
    <div className="stats-grid">{cards.map(([label, value, unit, color]) => <div className={`stat-card ${color}`} key={label}><span>{label}</span><strong>{value}<small>{unit}</small></strong><i/></div>)}</div>
    <Panel title="最近订单" subtitle="按创建时间显示最新五张销售订单" action={<a className="link-button" href="#orders">查看全部 →</a>}>
      <OrderTable orders={data.recentOrders} compact/>
    </Panel>
  </>;
}

function Suppliers({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/suppliers?search=${encodeURIComponent(search)}`).then((r) => setItems(r.suppliers)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <Panel title="供应商资料" subtitle="采购模块的基础档案，对应旧系统 SYS_SupplierA">
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索供应商编码、名称或联系人" action={can(user, 'SUPPLIERS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增供应商</button>}
    />
    <div className="table-wrap"><table><thead><tr><th>供应商编码</th><th>供应商名称</th><th>联系人</th><th>联系电话</th><th>地址</th><th>邮箱</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.contact || '—'}</td><td>{item.phone || '—'}</td><td className="dim">{item.address || '—'}</td><td>{item.email || '—'}</td><td><Active active={item.active}/></td><td>{can(user, 'SUPPLIERS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有找到供应商资料"/>}</div>
    {editing && <SupplierModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('供应商资料已保存'); }} notify={notify}/>} 
  </Panel>;
}

function SupplierModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', contact: '', phone: '', address: '', email: '', active: true, ...value });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/suppliers/${value.id}` : '/api/suppliers', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑供应商' : '新增供应商'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>供应商编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 SUP-003" required/></label>
    <label>供应商名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
    <label>联系人<input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}/></label>
    <label>联系电话<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></label>
    <label className="full">联系地址<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}/></label>
    <label className="full">电子邮箱<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.cn"/></label>
    {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该供应商</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

function Customers({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/customers?search=${encodeURIComponent(search)}`).then((r) => setItems(r.customers)).catch((e) => notify(e.message, 'error'));
  // Effect 回调只能返回清理函数，不能直接返回 load() 产生的 Promise。
  useEffect(() => { void load(); }, []);
  return <Panel title="客户资料" subtitle="销售订单引用的客户档案，类似旧系统 SYS_CusA">
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索客户编码、名称或联系人" action={can(user, 'CUSTOMERS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增客户</button>}/>
    <div className="table-wrap"><table><thead><tr><th>客户编码</th><th>客户名称</th><th>联系人</th><th>联系电话</th><th>地址</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.contact || '—'}</td><td>{item.phone || '—'}</td><td className="dim">{item.address || '—'}</td><td><Active active={item.active}/></td><td>{can(user, 'CUSTOMERS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有找到客户资料"/>}</div>
    {editing && <CustomerModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('客户资料已保存'); }} notify={notify}/>} 
  </Panel>;
}

function CustomerModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', contact: '', phone: '', address: '', active: true, ...value });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/customers/${value.id}` : '/api/customers', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑客户' : '新增客户'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>客户编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 CUS-003" required/></label>
    <label>客户名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
    <label>联系人<input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })}/></label>
    <label>联系电话<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}/></label>
    <label className="full">联系地址<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}/></label>
    {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该客户</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

function Products({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/products?search=${encodeURIComponent(search)}`).then((r) => setItems(r.products)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <Panel title="货品资料" subtitle="订单明细引用的标准商品档案，类似旧系统 SYS_GoodInA">
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索货品编码或名称" action={can(user, 'PRODUCTS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增货品</button>}/>
    <div className="table-wrap"><table><thead><tr><th>货品编码</th><th>货品名称</th><th>单位</th><th className="number">参考售价</th><th className="number">演示库存</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td>{item.unit}</td><td className="number">{money(item.priceCents)}</td><td className="number">{item.stockQuantity}</td><td><Active active={item.active}/></td><td>{can(user, 'PRODUCTS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有找到货品资料"/>}</div>
    {editing && <ProductModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('货品资料已保存'); }} notify={notify}/>} 
  </Panel>;
}

function ProductModal({ value, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', unit: '个', stockQuantity: 0, active: true, ...value, price: value.priceCents === undefined ? '' : value.priceCents / 100 });
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/products/${value.id}` : '/api/products', { method: value.id ? 'PATCH' : 'POST', body: { ...form, priceCents: Math.round(Number(form.price) * 100) } }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑货品' : '新增货品'} onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>货品编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="例如 MAT-004" required/></label>
    <label>货品名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
    <label>计量单位<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required/></label>
    <label>参考售价（元）<input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required/></label>
    <label>演示库存<input type="number" min="0" step="0.01" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} required/></label>
    {value.id && <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该货品</label>}
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

function Orders({ user, notify }) {
  const [orders, setOrders] = useState([]); const [search, setSearch] = useState(''); const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null); const [viewing, setViewing] = useState(null);
  const load = () => api(`/api/orders?search=${encodeURIComponent(search)}&status=${status}`).then((r) => setOrders(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  async function submitOrder(id) { if (!confirm('提交后订单将进入主管审核，确定继续吗？')) return; try { await api(`/api/orders/${id}/submit`, { method: 'POST' }); notify('订单已提交审核'); load(); } catch (e) { notify(e.message, 'error'); } }
  return <Panel title="销售订单" subtitle="从客户需求到审批确认的核心业务单据" action={can(user, 'ORDERS_CREATE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建销售订单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索订单号或客户名称" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="SUBMITTED">待审核</option><option value="APPROVED">已审核</option><option value="REJECTED">已驳回</option></select>}/>
    <OrderTable orders={orders} onView={setViewing} actions={(order) => <>
      {can(user, 'ORDERS_CREATE') && ['DRAFT','REJECTED'].includes(order.status) && <button className="row-action" onClick={() => setEditing(order)}>编辑</button>}
      {can(user, 'ORDERS_SUBMIT') && ['DRAFT','REJECTED'].includes(order.status) && <button className="row-action strong" onClick={() => submitOrder(order.id)}>提交</button>}
    </>}/>
    {editing && <OrderEditor order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('销售订单草稿已保存'); }} notify={notify}/>} 
    {viewing && <OrderDetail id={viewing.id} onClose={() => setViewing(null)} notify={notify}/>} 
  </Panel>;
}

function OrderEditor({ order, onClose, onSaved, notify }) {
  const [customers, setCustomers] = useState([]); const [products, setProducts] = useState([]); const [loading, setLoading] = useState(Boolean(order.id));
  const [form, setForm] = useState({ customerId: '', remark: '', items: [{ productId: '', quantity: 1, price: '' }] });
  useEffect(() => {
    Promise.all([api('/api/customers'), api('/api/products'), order.id ? api(`/api/orders/${order.id}`) : null]).then(([c, p, detail]) => {
      setCustomers(c.customers.filter((x) => x.active)); setProducts(p.products.filter((x) => x.active));
      if (detail) setForm({ customerId: detail.order.customerId, remark: detail.order.remark, items: detail.order.items.map((x) => ({ productId: x.productId, quantity: x.quantity, price: x.unitPriceCents / 100 })) });
    }).catch((e) => notify(e.message, 'error')).finally(() => setLoading(false));
  }, []);
  const total = useMemo(() => form.items.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0), [form]);
  function updateLine(index, patch) { setForm({ ...form, items: form.items.map((line, i) => i === index ? { ...line, ...patch } : line) }); }
  function chooseProduct(index, productId) { const product = products.find((p) => p.id === productId); updateLine(index, { productId, price: product ? product.priceCents / 100 : '' }); }
  async function save(e) { e.preventDefault(); try { await api(order.id ? `/api/orders/${order.id}` : '/api/orders', { method: order.id ? 'PUT' : 'POST', body: { ...form, items: form.items.map((x) => ({ productId: x.productId, quantity: Number(x.quantity), unitPriceCents: Math.round(Number(x.price) * 100) })) } }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={order.id ? `编辑订单 ${order.orderNo}` : '新建销售订单'} onClose={onClose} wide>
    {loading ? <Loading/> : <form onSubmit={save}>
      <div className="form-grid order-head"><label>客户<select value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} required><option value="">请选择客户</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></label><label>订单备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="可填写交期或特殊说明"/></label></div>
      <div className="line-title"><div><strong>订单明细</strong><span>选择货品并填写数量、成交单价</span></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1, price: '' }] })}>＋ 添加一行</button></div>
      <div className="line-table"><div className="line-row line-header"><span>#</span><span>货品</span><span>数量</span><span>单位</span><span>单价</span><span>金额</span><span/></div>
        {form.items.map((line, index) => { const product = products.find((p) => p.id === line.productId); return <div className="line-row" key={index}><span>{index + 1}</span><select value={line.productId} onChange={(e) => chooseProduct(index, e.target.value)} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} required/><span>{product?.unit || '—'}</span><input type="number" min="0" step="0.01" value={line.price} onChange={(e) => updateLine(index, { price: e.target.value })} required/><strong>{money(Math.round((Number(line.quantity)||0)*(Number(line.price)||0)*100))}</strong><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>×</button></div>; })}
      </div>
      <div className="order-total"><span>订单合计</span><strong>{money(Math.round(total * 100))}</strong></div><FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

function Approvals({ notify }) {
  const [orders, setOrders] = useState([]); const [viewing, setViewing] = useState(null); const [rejecting, setRejecting] = useState(null); const [reason, setReason] = useState('');
  const load = () => api('/api/orders?status=SUBMITTED').then((r) => setOrders(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  async function approve(order) { if (!confirm(`确定审核通过订单 ${order.orderNo} 吗？`)) return; try { await api(`/api/orders/${order.id}/approve`, { method: 'POST' }); notify('订单已审核通过'); load(); } catch (e) { notify(e.message, 'error'); } }
  async function reject(e) { e.preventDefault(); try { await api(`/api/orders/${rejecting.id}/reject`, { method: 'POST', body: { reason } }); notify('订单已驳回'); setRejecting(null); setReason(''); load(); } catch (error) { notify(error.message, 'error'); } }
  return <>
    <div className="approval-banner"><div className="approval-icon">✓</div><div><h2>待审核订单</h2><p>审核是业务确认，不等于出货。审核通过后订单仍需在后续流程生成出货单。</p></div><strong>{orders.length}<small>张待处理</small></strong></div>
    <Panel title="审核队列" subtitle="制单人与审核人必须是不同用户"><OrderTable orders={orders} onView={setViewing} actions={(order) => <><button className="row-action danger" onClick={() => setRejecting(order)}>驳回</button><button className="approve-button" onClick={() => approve(order)}>通过</button></>}/></Panel>
    {viewing && <OrderDetail id={viewing.id} onClose={() => setViewing(null)} notify={notify}/>} 
    {rejecting && <Modal title={`驳回 ${rejecting.orderNo}`} onClose={() => setRejecting(null)}><form onSubmit={reject}><label>驳回原因<textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请说明需要销售人员修改的内容" required/></label><FormActions onClose={() => setRejecting(null)} saveText="确认驳回" danger/></form></Modal>}
  </>;
}

function OrderDetail({ id, onClose, notify }) {
  const [order, setOrder] = useState(null);
  useEffect(() => { api(`/api/orders/${id}`).then((r) => setOrder(r.order)).catch((e) => notify(e.message, 'error')); }, [id]);
  return <Modal title="销售订单详情" onClose={onClose} wide>{!order ? <Loading/> : <>
    <div className="detail-head"><div><span className="mono">{order.orderNo}</span><h3>{order.customerName}</h3><p>{order.customerCode} · 制单人：{order.creatorName}</p></div><Status status={order.status} label={order.statusLabel}/></div>
    {order.rejectionReason && <div className="reject-note"><strong>驳回原因</strong>{order.rejectionReason}</div>}
    <div className="detail-grid"><div><span>创建时间</span><strong>{dateTime(order.createdAt)}</strong></div><div><span>提交时间</span><strong>{dateTime(order.submittedAt)}</strong></div><div><span>审核人</span><strong>{order.reviewerName || '—'}</strong></div><div><span>审核时间</span><strong>{dateTime(order.reviewedAt)}</strong></div></div>
    <div className="table-wrap inset"><table><thead><tr><th>#</th><th>货品</th><th className="number">数量</th><th>单位</th><th className="number">单价</th><th className="number">金额</th></tr></thead><tbody>{order.items.map((item) => <tr key={item.id}><td>{item.lineNo}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td className="number">{item.quantity}</td><td>{item.unit}</td><td className="number">{money(item.unitPriceCents)}</td><td className="number"><strong>{money(item.amountCents)}</strong></td></tr>)}</tbody></table></div>
    <div className="detail-total"><span>订单合计</span><strong>{money(order.totalCents)}</strong></div>
    {order.remark && <p className="remark"><b>备注：</b>{order.remark}</p>}
    <div className="timeline"><h4>操作记录</h4>{order.history.map((item, index) => <div key={index}><i/><span>{dateTime(item.createdAt)}</span><strong>{item.userName || '系统'}</strong><p>{item.detail}</p></div>)}</div>
  </>}</Modal>;
}

function UsersRoles({ user, notify }) {
  const defaultTab = can(user, 'USERS_MANAGE') ? 'users' : 'roles';
  const [tab, setTab] = useState(defaultTab); const [users, setUsers] = useState([]); const [roles, setRoles] = useState([]); const [permissions, setPermissions] = useState([]); const [editingUser, setEditingUser] = useState(null); const [editingRole, setEditingRole] = useState(null);
  const load = () => Promise.all([can(user, 'USERS_MANAGE') ? api('/api/users') : null, api('/api/roles')]).then(([u, r]) => { setUsers(u?.users || []); setRoles(r.roles); setPermissions(r.permissions); }).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <Panel title="用户与角色" subtitle="角色是一组权限模板，用户通过角色获得功能权限" action={tab === 'users' ? can(user, 'USERS_MANAGE') && <button className="primary" onClick={() => setEditingUser({})}>＋ 新增用户</button> : can(user, 'ROLES_MANAGE') && <button className="primary" onClick={() => setEditingRole({ permissions: [] })}>＋ 新增角色</button>}>
    <div className="tabs">{can(user, 'USERS_MANAGE') && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>用户管理</button>}<button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>角色权限</button></div>
    {tab === 'users' ? <div className="user-cards">{users.map((item) => <div className="user-card" key={item.id}><div className="avatar large">{item.displayName.slice(0,1)}</div><div><strong>{item.displayName}</strong><span className="mono">{item.username}</span></div><span className="role-chip">{item.roleName}</span><Active active={item.active}/><button className="row-action" onClick={() => setEditingUser(item)}>编辑</button></div>)}</div> : <div className="role-grid">{roles.map((role) => <div className="role-card" key={role.id}><div><span className="mono">{role.code}</span><h3>{role.name}</h3><p>{role.description}</p></div><div className="role-meta"><span>{role.user_count} 位用户</span><span>{role.permissions.length} 项权限</span></div>{can(user, 'ROLES_MANAGE') && <button className="secondary" onClick={() => setEditingRole(role)}>配置权限</button>}</div>)}</div>}
    {editingUser && <UserModal value={editingUser} roles={roles} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); load(); notify('用户资料已保存'); }} notify={notify}/>} 
    {editingRole && <RoleModal value={editingRole} permissions={permissions} onClose={() => setEditingRole(null)} onSaved={() => { setEditingRole(null); load(); notify('角色权限已保存'); }} notify={notify}/>} 
  </Panel>;
}

function UserModal({ value, roles, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', roleId: roles[0]?.id || '', active: true, ...value });
  async function save(e) { e.preventDefault(); try { const body = { ...form }; if (value.id && !body.password) delete body.password; await api(value.id ? `/api/users/${value.id}` : '/api/users', { method: value.id ? 'PATCH' : 'POST', body }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? '编辑用户' : '新增用户'} onClose={onClose}><form className="form-grid" onSubmit={save}><label>登录账号<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={Boolean(value.id)} required/></label><label>用户姓名<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required/></label><label>{value.id ? '重置密码（留空不修改）' : '初始密码'}<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!value.id}/></label><label>所属角色<select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> 启用该用户</label>}<FormActions onClose={onClose}/></form></Modal>;
}

function RoleModal({ value, permissions, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ code: '', name: '', description: '', permissions: [], ...value });
  function toggle(code) { setForm({ ...form, permissions: form.permissions.includes(code) ? form.permissions.filter((x) => x !== code) : [...form.permissions, code] }); }
  async function save(e) { e.preventDefault(); try { await api(value.id ? `/api/roles/${value.id}` : '/api/roles', { method: value.id ? 'PATCH' : 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={value.id ? `配置角色：${value.name}` : '新增角色'} onClose={onClose}><form onSubmit={save}><div className="form-grid"><label>角色编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={Boolean(value.id)} required/></label><label>角色名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label><label className="full">角色说明<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label></div><div className="permission-list"><strong>功能权限</strong>{permissions.map((p) => <label key={p.code}><input type="checkbox" checked={form.permissions.includes(p.code)} onChange={() => toggle(p.code)}/><span>{p.name}<small className="mono">{p.code}</small></span></label>)}</div><FormActions onClose={onClose}/></form></Modal>;
}


function PurchaseOrders({ user, notify }) {
  const [orders, setOrders] = useState([]); const [search, setSearch] = useState(''); const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null); const [viewing, setViewing] = useState(null);
  const load = () => api(`/api/purchase-orders?search=${encodeURIComponent(search)}&status=${status}`).then((r) => setOrders(r.purchaseOrders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  async function submitOrder(id) { if (!confirm('提交后订单将进入主管审核，确定继续吗？')) return; try { await api(`/api/purchase-orders/${id}/submit`, { method: 'POST' }); notify('订单已提交审核'); load(); } catch (e) { notify(e.message, 'error'); } }
  return <Panel title="采购订单" subtitle="向供应商采购货品的业务单据" action={can(user, 'PURCHASE_ORDERS_CREATE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建采购订单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索订单号或供应商名称" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="SUBMITTED">待审核</option><option value="APPROVED">已审核</option><option value="REJECTED">已驳回</option></select>}/>
    <PurchaseOrderTable orders={orders} onView={setViewing} actions={(order) => <>
      {can(user, 'PURCHASE_ORDERS_CREATE') && ['DRAFT','REJECTED'].includes(order.status) && <button className="row-action" onClick={() => setEditing(order)}>编辑</button>}
      {can(user, 'PURCHASE_ORDERS_SUBMIT') && ['DRAFT','REJECTED'].includes(order.status) && <button className="row-action strong" onClick={() => submitOrder(order.id)}>提交</button>}
    </>}/>
    {editing && <PurchaseOrderEditor order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('采购订单草稿已保存'); }} notify={notify}/>} 
    {viewing && <PurchaseOrderDetail id={viewing.id} onClose={() => setViewing(null)} notify={notify}/>} 
  </Panel>;
}

function PurchaseOrderEditor({ order, onClose, onSaved, notify }) {
  const [suppliers, setSuppliers] = useState([]); const [products, setProducts] = useState([]); const [loading, setLoading] = useState(Boolean(order.id));
  const [form, setForm] = useState({ supplierId: '', remark: '', items: [{ productId: '', quantity: 1, price: '' }] });
  useEffect(() => {
    Promise.all([api('/api/suppliers'), api('/api/products'), order.id ? api(`/api/purchase-orders/${order.id}`) : null]).then(([s, p, detail]) => {
      setSuppliers(s.suppliers.filter((x) => x.active)); setProducts(p.products.filter((x) => x.active));
      if (detail) setForm({ supplierId: detail.order.supplierId, remark: detail.order.remark, items: detail.order.items.map((x) => ({ productId: x.productId, quantity: x.quantity, price: x.unitPriceCents / 100 })) });
    }).catch((e) => notify(e.message, 'error')).finally(() => setLoading(false));
  }, []);
  const total = useMemo(() => form.items.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0), [form]);
  function updateLine(index, patch) { setForm({ ...form, items: form.items.map((line, i) => i === index ? { ...line, ...patch } : line) }); }
  function chooseProduct(index, productId) { const product = products.find((p) => p.id === productId); updateLine(index, { productId, price: product ? product.priceCents / 100 : '' }); }
  async function save(e) { e.preventDefault(); try { await api(order.id ? `/api/purchase-orders/${order.id}` : '/api/purchase-orders', { method: order.id ? 'PUT' : 'POST', body: { ...form, items: form.items.map((x) => ({ productId: x.productId, quantity: Number(x.quantity), unitPriceCents: Math.round(Number(x.price) * 100) })) } }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title={order.id ? `编辑订单 ${order.orderNo}` : '新建采购订单'} onClose={onClose} wide>
    {loading ? <Loading/> : <form onSubmit={save}>
      <div className="form-grid order-head"><label>供应商<select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} required><option value="">请选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></label><label>订单备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="可填写交期或特殊说明"/></label></div>
      <div className="line-title"><div><strong>订单明细</strong><span>选择货品并填写数量、成交单价</span></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1, price: '' }] })}>＋ 添加一行</button></div>
      <div className="line-table"><div className="line-row line-header"><span>#</span><span>货品</span><span>数量</span><span>单位</span><span>单价</span><span>金额</span><span/></div>
        {form.items.map((line, index) => { const product = products.find((p) => p.id === line.productId); return <div className="line-row" key={index}><span>{index + 1}</span><select value={line.productId} onChange={(e) => chooseProduct(index, e.target.value)} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} required/><span>{product?.unit || '—'}</span><input type="number" min="0" step="0.01" value={line.price} onChange={(e) => updateLine(index, { price: e.target.value })} required/><strong>{money(Math.round((Number(line.quantity)||0)*(Number(line.price)||0)*100))}</strong><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>×</button></div>; })}
      </div>
      <div className="order-total"><span>订单合计</span><strong>{money(Math.round(total * 100))}</strong></div><FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

function PurchaseOrderDetail({ id, onClose, notify }) {
  const [order, setOrder] = useState(null);
  useEffect(() => { api(`/api/purchase-orders/${id}`).then((r) => setOrder(r.order)).catch((e) => notify(e.message, 'error')); }, [id]);
  return <Modal title="采购订单详情" onClose={onClose} wide>{!order ? <Loading/> : <>
    <div className="detail-head"><div><span className="mono">{order.orderNo}</span><h3>{order.supplierName}</h3><p>{order.supplierCode} · 制单人：{order.creatorName}</p></div><Status status={order.status} label={order.statusLabel}/></div>
    {order.rejectionReason && <div className="reject-note"><strong>驳回原因</strong>{order.rejectionReason}</div>}
    <div className="detail-grid"><div><span>创建时间</span><strong>{dateTime(order.createdAt)}</strong></div><div><span>提交时间</span><strong>{dateTime(order.submittedAt)}</strong></div><div><span>审核人</span><strong>{order.reviewerName || '—'}</strong></div><div><span>审核时间</span><strong>{dateTime(order.reviewedAt)}</strong></div></div>
    <div className="table-wrap inset"><table><thead><tr><th>#</th><th>货品</th><th className="number">数量</th><th>单位</th><th className="number">单价</th><th className="number">金额</th></tr></thead><tbody>{order.items.map((item) => <tr key={item.id}><td>{item.lineNo}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td className="number">{item.quantity}</td><td>{item.unit}</td><td className="number">{money(item.unitPriceCents)}</td><td className="number"><strong>{money(item.amountCents)}</strong></td></tr>)}</tbody></table></div>
    <div className="detail-total"><span>订单合计</span><strong>{money(order.totalCents)}</strong></div>
    {order.remark && <p className="remark"><b>备注：</b>{order.remark}</p>}
    <div className="timeline"><h4>操作记录</h4>{order.history.map((item, index) => <div key={index}><i/><span>{dateTime(item.createdAt)}</span><strong>{item.userName || '系统'}</strong><p>{item.detail}</p></div>)}</div>
  </>}</Modal>;
}

function PurchaseOrderTable({ orders = [], onView, actions, compact }) {
  return <div className="table-wrap"><table><thead><tr><th>订单号</th><th>供应商</th><th>状态</th><th className="number">金额</th><th>制单人</th><th>创建时间</th>{!compact && <th/>}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={onView ? 'clickable' : ''} onClick={() => onView?.(order)}><td className="mono strong-text">{order.orderNo}</td><td><strong>{order.supplierName}</strong><small className="block">{order.itemCount} 项明细</small></td><td><Status status={order.status} label={order.statusLabel}/></td><td className="number"><strong>{money(order.totalCents)}</strong></td><td>{order.creatorName}</td><td className="dim">{dateTime(order.createdAt)}</td>{!compact && <td className="actions" onClick={(e) => e.stopPropagation()}><button className="row-action" onClick={() => onView?.(order)}>查看</button>{actions?.(order)}</td>}</tr>)}</tbody></table>{!orders.length && <Empty text="当前没有符合条件的采购订单"/>}</div>;
}


function Warehouses({ user, notify }) {
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [editing, setEditing] = useState(null);
  const load = () => api(`/api/warehouses?search=${encodeURIComponent(search)}`).then((r) => setItems(r.warehouses)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <Panel title="仓库资料" subtitle="管理企业仓库档案">
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索仓库编码或名称" action={can(user, 'WAREHOUSES_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增仓库</button>}/>
    <div className="table-wrap"><table><thead><tr><th>仓库编码</th><th>仓库名称</th><th>地址</th><th>管理员</th><th>状态</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td className="mono">{item.code}</td><td><strong>{item.name}</strong></td><td className="dim">{item.address || '—'}</td><td>{item.manager || '—'}</td><td><Active active={item.active}/></td><td>{can(user, 'WAREHOUSES_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有找到仓库资料"/>}</div>
    {editing && <WarehouseModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('仓库资料已保存'); }} notify={notify}/>}
  </Panel>;
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

function Inventory({ user, notify }) {
  const [warehouses, setWarehouses] = useState([]); const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]); const [searchWh, setSearchWh] = useState(''); const [searchPd, setSearchPd] = useState('');
  const [tab, setTab] = useState('query');
  useEffect(() => { Promise.all([api('/api/warehouses'), api('/api/products')]).then(([w, p]) => { setWarehouses(w.warehouses.filter((x) => x.active)); setProducts(p.products.filter((x) => x.active)); }).catch((e) => notify(e.message, 'error')); }, []);
  const loadInventory = () => { let url = '/api/inventory'; const params = []; if (searchWh) params.push(`warehouse=${searchWh}`); if (searchPd) params.push(`product=${searchPd}`); if (params.length) url += '?' + params.join('&'); api(url).then((r) => setInventory(r.inventory)).catch((e) => notify(e.message, 'error')); };
  useEffect(() => { void loadInventory(); }, [searchWh, searchPd]);
  return <Panel title="库存管理" subtitle="查询、盘点、调拨企业库存">
    <div className="tabs"><button className={tab === 'query' ? 'active' : ''} onClick={() => setTab('query')}>库存查询</button><button className={tab === 'check' ? 'active' : ''} onClick={() => setTab('check')}>库存盘点</button><button className={tab === 'transfer' ? 'active' : ''} onClick={() => setTab('transfer')}>库存调拨</button></div>
    {tab === 'query' && <><Toolbar search={searchPd} setSearch={setSearchPd} onSearch={loadInventory} placeholder="搜索货品编码或名称" extra={<select value={searchWh} onChange={(e) => setSearchWh(e.target.value)}><option value="">全部仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select>}/>
      <div className="table-wrap"><table><thead><tr><th>仓库</th><th>货品编码</th><th>货品名称</th><th>单位</th><th className="number">库存数量</th></tr></thead><tbody>{inventory.map((row) => <tr key={row.warehouse_id + '-' + row.product_id}><td>{row.warehouseName}</td><td className="mono">{row.productCode}</td><td><strong>{row.productName}</strong></td><td>{row.unit}</td><td className="number"><strong>{row.quantity}</strong></td></tr>)}</tbody></table>{!inventory.length && <Empty text="没有找到库存记录"/>}</div></>}
    {tab === 'check' && <InventoryChecks user={user} notify={notify} warehouses={warehouses} products={products}/>}
    {tab === 'transfer' && <InventoryTransfers user={user} notify={notify} warehouses={warehouses} products={products}/>}
  </Panel>;
}

function InventoryChecks({ user, notify, warehouses, products }) {
  const [checks, setChecks] = useState([]); const [editing, setEditing] = useState(null);
  const load = () => api('/api/inventory-checks').then((r) => setChecks(r.inventoryChecks)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  function approve(check, action) { api(`/api/inventory-checks/${check.id}`, { method: 'PATCH', body: { action } }).then(() => { notify(action === 'APPROVE' ? '盘点已审核通过' : '盘点已驳回'); load(); }).catch((e) => notify(e.message, 'error')); }
  return <><Toolbar search={() => {}} placeholder="" action={can(user, 'INVENTORY_CHECK_CREATE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建盘点单</button>}/>
    <div className="table-wrap"><table><thead><tr><th>仓库</th><th>货品</th><th>系统库存</th><th>实际盘点</th><th>差异</th><th>状态</th><th>制单人</th><th>时间</th><th/></tr></thead><tbody>{checks.map((c) => <tr key={c.id}><td>{c.warehouseName}</td><td>{c.productCode} {c.productName}</td><td className="number">{c.system_quantity}</td><td className="number">{c.actual_quantity}</td><td className={`number ${c.difference > 0 ? 'positive' : c.difference < 0 ? 'negative' : ''}`}>{c.difference > 0 ? '+' : ''}{c.difference}</td><td><Status status={c.status} label={c.statusLabel}/></td><td>{c.creatorName}</td><td className="dim">{dateTime(c.createdAt)}</td><td>{can(user, 'INVENTORY_CHECK_APPROVE') && c.status === 'PENDING' && <><button className="row-action" onClick={() => approve(c, 'REJECT')}>驳回</button><button className="approve-button" onClick={() => approve(c, 'APPROVE')}>通过</button></>}</td></tr>)}</tbody></table>{!checks.length && <Empty text="没有盘点记录"/>}</div>
    {editing && <InventoryCheckModal value={editing} warehouses={warehouses} products={products} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('盘点单已保存'); }} notify={notify}/>}
  </>;
}

function InventoryCheckModal({ value, warehouses, products, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ warehouseId: '', productId: '', actualQuantity: '', reason: '' });
  async function save(e) { e.preventDefault(); try { await api('/api/inventory-checks', { method: 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title="新建盘点单" onClose={onClose}><form className="form-grid" onSubmit={save}>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required><option value="">请选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label>
    <label>货品<select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>
    <label>实际盘点数量<input type="number" min="0" step="0.01" value={form.actualQuantity} onChange={(e) => setForm({ ...form, actualQuantity: e.target.value })} required/></label>
    <label className="full">盘点原因<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="如：年度盘点、发现异常等"/></label>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

function InventoryTransfers({ user, notify, warehouses, products }) {
  const [transfers, setTransfers] = useState([]); const [editing, setEditing] = useState(null); const [viewing, setViewing] = useState(null);
  const load = () => api('/api/inventory-transfers').then((r) => setTransfers(r.inventoryTransfers)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  function changeState(id, action) { api(`/api/inventory-transfers/${id}/${action}`, { method: 'POST' }).then(() => { notify(action === 'transfer' ? '调拨已确认' : '调拨已取消'); load(); }).catch((e) => notify(e.message, 'error')); }
  return <><Toolbar search={() => {}} placeholder="" action={can(user, 'INVENTORY_TRANSFER_CREATE') && <button className="primary" onClick={() => setEditing({})}>＋ 新建调拨单</button>}/>
    <div className="table-wrap"><table><thead><tr><th>调拨单号</th><th>源仓库</th><th>目标仓库</th><th>状态</th><th>制单人</th><th>时间</th><th/></tr></thead><tbody>{transfers.map((t) => <tr key={t.id} className={viewing ? 'clickable' : ''} onClick={() => setViewing(t)}><td className="mono">{t.transfer_no}</td><td>{t.fromWarehouseName}</td><td>{t.toWarehouseName}</td><td><Status status={t.status} label={t.statusLabel}/></td><td>{t.creatorName}</td><td className="dim">{dateTime(t.createdAt)}</td><td onClick={(e) => e.stopPropagation()}>{can(user, 'INVENTORY_TRANSFER_APPROVE') && t.status === 'DRAFT' && <><button className="row-action danger" onClick={() => changeState(t.id, 'cancel')}>取消</button><button className="approve-button" onClick={() => changeState(t.id, 'transfer')}>确认调拨</button></>}</td></tr>)}</tbody></table>{!transfers.length && <Empty text="没有调拨记录"/>}</div>
    {editing && <InventoryTransferModal value={editing} warehouses={warehouses} products={products} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('调拨单已保存'); }} notify={notify}/>}
    {viewing && <InventoryTransferDetail value={viewing} onClose={() => setViewing(null)}/>}
  </>;
}

function InventoryTransferModal({ value, warehouses, products, onClose, onSaved, notify }) {
  const [form, setForm] = useState({ fromWarehouseId: '', toWarehouseId: '', remark: '', items: [{ productId: '', quantity: 1 }] });
  const total = useMemo(() => form.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0), [form]);
  function updateLine(idx, patch) { setForm({ ...form, items: form.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }); }
  async function save(e) { e.preventDefault(); if (form.fromWarehouseId === form.toWarehouseId) { notify('源仓库和目标仓库不能相同', 'error'); return; } if (!form.items.length) { notify('请添加调拨货品', 'error'); return; } try { await api('/api/inventory-transfers', { method: 'POST', body: form }); onSaved(); } catch (error) { notify(error.message, 'error'); } }
  return <Modal title="新建调拨单" onClose={onClose} wide><form onSubmit={save}>
    <div className="form-grid order-head"><label>源仓库<select value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })} required><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>目标仓库<select value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })} required><option value="">请选择</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label className="full">备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="调拨说明"/></label></div>
    <div className="line-title"><div><strong>调拨明细</strong></div><button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', quantity: 1 }] })}>＋ 添加一行</button></div>
    <div className="line-table"><div className="line-row line-header"><span>#</span><span>货品</span><span>数量</span><span/></div>
      {form.items.map((line, idx) => <div className="line-row" key={idx}><span>{idx + 1}</span><select value={line.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })} required><option value="">请选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} required/><button type="button" className="remove" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}>×</button></div>)}
    </div>
    <div className="order-total"><span>合计</span><strong>{total}</strong></div><FormActions onClose={onClose} saveText="保存草稿"/>
  </form></Modal>;
}

function InventoryTransferDetail({ value, onClose }) {
  return <Modal title="调拨单详情" onClose={onClose} wide>{value ? <>
    <div className="detail-head"><div><span className="mono">{value.transfer_no}</span><h3>{value.fromWarehouseName} → {value.toWarehouseName}</h3><p>制单人：{value.creatorName}</p></div><Status status={value.status} label={value.statusLabel}/></div>
    <div className="detail-grid"><div><span>创建时间</span><strong>{dateTime(value.createdAt)}</strong></div><div><span>审核人</span><strong>{value.reviewerName || '—'}</strong></div></div>
    <div className="table-wrap inset"><table><thead><tr><th>#</th><th>货品</th><th>单位</th><th className="number">调拨数量</th></tr></thead><tbody>{value.items?.map((item) => <tr key={item.id}><td>{item.line_no || item.id}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td>{item.unit}</td><td className="number"><strong>{item.quantity}</strong></td></tr>)}</tbody></table></div>
    {value.remark && <p className="remark"><b>备注：</b>{value.remark}</p>}
  </> : <Loading/> }</Modal>;
}


function Accounting({ user, notify }) {
  const [subjects, setSubjects] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [viewing, setViewing] = useState(null);
  const [tab, setTab] = useState('vouchers');
  useEffect(() => {
    Promise.all([api('/api/accounting-subjects'), api('/api/accounting-vouchers')]).then(([s, v]) => {
      setSubjects(s.subjects || []);
      setVouchers(v.vouchers || []);
    }).catch((e) => notify(e.message, 'error'));
  }, []);
  function formatMoney(c) { return money(c); }
  return <Panel title="财务凭证" subtitle="总账与业务单据的桥接">
    <div className="tabs"><button className={tab === 'subjects' ? 'active' : ''} onClick={() => setTab('subjects')}>会计科目</button><button className={tab === 'vouchers' ? 'active' : ''} onClick={() => setTab('vouchers')}>凭证列表</button></div>
    {tab === 'subjects' && <div className="table-wrap"><table><thead><tr><th>科目编码</th><th>科目名称</th><th>类型</th><th>余额方向</th></tr></thead><tbody>{subjects.map((s) => <tr key={s.id}><td className="mono">{s.code}</td><td><strong>{s.name}</strong></td><td>{s.type === 'ASSET' ? '资产' : s.type === 'LIABILITY' ? '负债' : s.type === 'EQUITY' ? '所有者权益' : s.type === 'REVENUE' ? '收入' : '成本'}</td><td>{s.direction === 'DEBIT' ? '借方' : '贷方'}</td></tr>)}</tbody></table></div>}
    {tab === 'vouchers' && <><Toolbar search={() => {}} placeholder="搜索凭证号"/><div className="table-wrap"><table><thead><tr><th>凭证号</th><th>来源</th><th>凭证日期</th><th>制单人</th><th>创建时间</th><th/></tr></thead><tbody>{vouchers.map((v) => <tr key={v.id}><td className="mono">{v.voucher_no}</td><td>{v.source_type === 'SALES_ORDER' ? '销售订单' : v.source_type === 'PURCHASE_ORDER' ? '采购订单' : '库存调拨'}</td><td>{v.voucher_date}</td><td>{v.creatorName}</td><td className="dim">{dateTime(v.created_at)}</td><td><button className="row-action" onClick={() => { api(`/api/accounting-vouchers/${v.id}`).then((r) => setViewing(r.voucher)).catch((e) => notify(e.message, 'error')); }}>查看</button></td></tr>)}</tbody></table>{!vouchers.length && <Empty text="没有凭证记录"/>}</div></>}
    {viewing && <VoucherDetail value={viewing} onClose={() => setViewing(null)} formatMoney={formatMoney}/>}
  </Panel>;
}



function CashManagement({ user, notify }) {
  const [tab, setTab] = useState('journals');
  const [journals, setJournals] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bills, setBills] = useState([]);
  const [filters, setFilters] = useState({});
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  
  useEffect(() => {
    Promise.all([
      api('/api/cash-journals'),
      api('/api/bank-accounts'),
      api('/api/bills')
    ]).then(([j, b, bi]) => {
      setJournals(j.journals || []);
      setBankAccounts(b.bankAccounts || []);
      setBills(bi.bills || []);
    }).catch(e => notify(e.message, 'error'));
  }, []);
  
  function refresh() {
    let url = '/api/cash-journals';
    const params = [];
    if (filters.account_type) params.push('account_type=' + filters.account_type);
    if (filters.start_date) params.push('start_date=' + filters.start_date);
    if (filters.end_date) params.push('end_date=' + filters.end_date);
    if (params.length) url += '?' + params.join('&');
    api(url).then(r => setJournals(r.journals || [])).catch(e => notify(e.message, 'error'));
  }
  
  const accountTypeMap = { CASH: '现金', BANK: '银行存款' };
  const journalTypeMap = { RECEIPT: '收款', PAYMENT: '付款', TRANSFER: '转账' };
  const billTypeMap = { DRAFT: '银行承兑', ACCEPTANCE: '商业承兑', LC: '信用证' };
  const billStatusMap = { PENDING: '待处理', ENDORSED: '已背书', DISCOUNTED: '已贴现', PAID: '已到期', CANCELLED: '已作废' };
  
  return <Panel title="出纳管理" subtitle="现金日记账、银行日记账与票据管理">
    <div className="tabs" style={{marginBottom: '16px', display: 'flex', gap: '4px', borderBottom: '1px solid var(--border-default)', paddingBottom: '12px'}}>
      <button className={tab === 'journals' ? 'primary' : 'secondary'} onClick={() => setTab('journals')}>日记账</button>
      <button className={tab === 'accounts' ? 'primary' : 'secondary'} onClick={() => setTab('accounts')}>银行账户</button>
      <button className={tab === 'bills' ? 'primary' : 'secondary'} onClick={() => setTab('bills')}>票据管理</button>
    </div>
    
    {tab === 'journals' && <>
      <div className="search-bar">
        <select value={filters.account_type || ''} onChange={e => setFilters({...filters, account_type: e.target.value})} style={{width: '120px'}}>
          <option value="">全部账户</option>
          <option value="CASH">现金</option>
          <option value="BANK">银行存款</option>
        </select>
        <input type="date" value={filters.start_date || ''} onChange={e => setFilters({...filters, start_date: e.target.value})} style={{width: '140px'}}/>
        <input type="date" value={filters.end_date || ''} onChange={e => setFilters({...filters, end_date: e.target.value})} style={{width: '140px'}}/>
        <button className="secondary" onClick={refresh}>查询</button>
        <button className="primary" onClick={() => setCreating({account_type: 'BANK'})}>+ 录入日记账</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>单据号</th><th>日期</th><th>账户</th><th>方向</th><th>金额</th><th>摘要</th><th>操作人</th><th></th></tr></thead>
          <tbody>
            {journals.map(j => <tr key={j.id}>
              <td className="mono">{j.journal_no}</td>
              <td>{j.journal_date}</td>
              <td>{j.account_type === 'BANK' ? j.bank_name + ' ' + j.bankAccountNo : '现金'}</td>
              <td><span className={j.direction === 'IN' ? 'status submitted' : 'status rejected'}>{j.direction === 'IN' ? '收入' : '支出'}</span></td>
              <td className="number"><strong className={j.direction === 'IN' ? 'positive' : 'negative'}>{money(j.amount_cents)}</strong></td>
              <td>{j.summary}</td>
              <td>{j.operatorName}</td>
              <td><button className="secondary small" onClick={() => setViewing(j)}>详情</button></td>
            </tr>)}
          </tbody>
        </table>
        {!journals.length && <div className="empty-state"><p>暂无日记账记录</p></div>}
      </div>
    </>}
    
    {tab === 'accounts' && <>
      <div className="action-bar">
        <button className="primary" onClick={() => setCreating({type: 'account'})}>+ 添加银行账户</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>银行名称</th><th>账号</th><th>户名</th><th className="number">余额</th></tr></thead>
          <tbody>
            {bankAccounts.map(a => <tr key={a.id}>
              <td><strong>{a.bank_name}</strong></td>
              <td className="mono">{a.account_no}</td>
              <td>{a.account_name}</td>
              <td className="number"><strong>{money(a.balance_cents)}</strong></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </>}
    
    {tab === 'bills' && <>
      <div className="action-bar">
        <button className="primary" onClick={() => setCreating({type: 'bill'})}>+ 新增票据</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>票号</th><th>类型</th><th>方向</th><th className="number">票面金额</th><th>到期日期</th><th>状态</th></tr></thead>
          <tbody>
            {bills.map(b => <tr key={b.id}>
              <td className="mono">{b.bill_no}</td>
              <td>{billTypeMap[b.bill_type] || b.bill_type}</td>
              <td>{b.direction === 'RECEIVABLE' ? '应收票据' : '应付票据'}</td>
              <td className="number"><strong>{money(b.face_amount_cents)}</strong></td>
              <td>{b.due_date}</td>
              <td>{billStatusMap[b.status] || b.status}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </>}
    
    {creating && <CashJournalForm bankAccounts={bankAccounts} value={creating} onClose={() => setCreating(null)} onSave={() => { setCreating(null); refresh(); }} notify={notify}/>}
    {viewing && <CashJournalDetail value={viewing} onClose={() => setViewing(null)}/>}
  </Panel>;
}

function CashJournalForm({ bankAccounts, value, onClose, onSave, notify }) {
  const [form, setForm] = useState({
    account_type: value.account_type || 'BANK',
    bank_id: '',
    direction: 'IN',
    amount_cents: '',
    summary: '',
    journal_date: new Date().toISOString().slice(0, 10),
    counterparty_name: '',
    remark: ''
  });
  
  async function save() {
    if (!form.amount_cents) { notify('请输入金额', 'error'); return; }
    try {
      await api('/api/cash-journals', { method: 'POST', body: form });
      notify('保存成功');
      onSave();
    } catch (e) { notify(e.message, 'error'); }
  }
  
  return <Modal title="录入日记账" onClose={onClose}>
    <div className="modal-body">
      <div className="form-grid">
        <label className="full">
          账户类型
          <select value={form.account_type} onChange={e => setForm({...form, account_type: e.target.value})}>
            <option value="CASH">现金</option>
            <option value="BANK">银行存款</option>
          </select>
        </label>
        {form.account_type === 'BANK' && <label className="full">
          银行账户
          <select value={form.bank_id} onChange={e => setForm({...form, bank_id: e.target.value})}>
            <option value="">选择账户</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} {a.account_no}</option>)}
          </select>
        </label>}
        <label>
          收支方向
          <select value={form.direction} onChange={e => setForm({...form, direction: e.target.value})}>
            <option value="IN">收款</option>
            <option value="OUT">付款</option>
          </select>
        </label>
        <label>
          日期
          <input type="date" value={form.journal_date} onChange={e => setForm({...form, journal_date: e.target.value})}/>
        </label>
        <label className="full">
          金额（元）
          <input type="number" value={form.amount_cents} onChange={e => setForm({...form, amount_cents: e.target.value})} placeholder="请输入金额"/>
        </label>
        <label className="full">
          对方单位
          <input value={form.counterparty_name} onChange={e => setForm({...form, counterparty_name: e.target.value})}/>
        </label>
        <label className="full">
          摘要
          <input value={form.summary} onChange={e => setForm({...form, summary: e.target.value})}/>
        </label>
      </div>
    </div>
    <div className="modal-footer">
      <button className="secondary" onClick={onClose}>取消</button>
      <button className="primary" onClick={save}>保存</button>
    </div>
  </Modal>;
}

function CashJournalDetail({ value, onClose }) {
  return <Modal title={"日记账详情 " + value.journal_no} onClose={onClose}>
    <div className="modal-body">
      <div className="form-grid">
        <label>单据号<span className="mono">{value.journal_no}</span></label>
        <label>日期<span>{value.journal_date}</span></label>
        <label>账户<span>{value.account_type === 'BANK' ? value.bank_name : '现金'}</span></label>
        <label>方向<span className={value.direction === 'IN' ? 'positive' : 'negative'}>{value.direction === 'IN' ? '收入' : '支出'}</span></label>
        <label className="full">金额<span className="mono"><strong>{money(value.amount_cents)}</strong></span></label>
        <label className="full">摘要<span>{value.summary}</span></label>
        <label className="full">操作人<span>{value.operatorName}</span></label>
      </div>
    </div>
    <div className="modal-footer">
      <button className="secondary" onClick={onClose}>关闭</button>
    </div>
  </Modal>;
}


function VoucherDetail({ value, onClose, formatMoney }) {
  if (!value) return null;
  return <Modal title={`凭证 ${value.voucher_no}`} onClose={onClose} wide>
    <div className="detail-head"><div><span className="mono">{value.voucher_no}</span><h3>{value.source_type === 'SALES_ORDER' ? '销售订单' : value.source_type === 'PURCHASE_ORDER' ? '采购订单' : '库存调拨'}</h3><p>凭证日期：{value.voucher_date} · 制单人：{value.creatorName}</p></div></div>
    <div className="table-wrap"><table><thead><tr><th>方向</th><th>科目</th><th>金额</th><th>摘要</th></tr></thead><tbody>
      {value.entries?.map((e) => <tr key={e.id}><td className={e.direction === 'DEBIT' ? 'positive' : 'negative'}>{e.direction === 'DEBIT' ? '借' : '贷'}</td><td>{e.subjectCode} {e.subjectName}</td><td className="number"><strong>{money(e.amount_cents)}</strong></td><td>{e.summary}</td></tr>)}
    </tbody><tfoot><tr><td colspan="2"/><td className="number"><strong>借方合计：{money(value.debitTotal)}</strong></td><td className="number"><strong>贷方合计：{money(value.creditTotal)}</strong></td></tr></tfoot></table></div>
  </Modal>;
}

function OrderTable({ orders = [], onView, actions, compact }) {
  return <div className="table-wrap"><table><thead><tr><th>订单号</th><th>客户</th><th>状态</th><th className="number">金额</th><th>制单人</th><th>创建时间</th>{!compact && <th/>}</tr></thead><tbody>{orders.map((order) => <tr key={order.id} className={onView ? 'clickable' : ''} onClick={() => onView?.(order)}><td className="mono strong-text">{order.orderNo}</td><td><strong>{order.customerName}</strong><small className="block">{order.itemCount} 项明细</small></td><td><Status status={order.status} label={order.statusLabel}/></td><td className="number"><strong>{money(order.totalCents)}</strong></td><td>{order.creatorName}</td><td className="dim">{dateTime(order.createdAt)}</td>{!compact && <td className="actions" onClick={(e) => e.stopPropagation()}><button className="row-action" onClick={() => onView?.(order)}>查看</button>{actions?.(order)}</td>}</tr>)}</tbody></table>{!orders.length && <Empty text="当前没有符合条件的销售订单"/>}</div>;
}

function Panel({ title, subtitle, action, children }) { return <section className="panel"><div className="panel-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
function Toolbar({ search, setSearch, onSearch, placeholder, action, extra }) { return <div className="toolbar"><form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder}/><button>查询</button></form>{extra}<div className="toolbar-spacer"/>{action}</div>; }
function Modal({ title, onClose, children, wide }) { return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className={`modal ${wide ? 'wide' : ''}`}><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div><div className="modal-body">{children}</div></div></div>; }
function FormActions({ onClose, saveText = '保存', danger }) { return <div className="form-actions full"><button type="button" className="secondary" onClick={onClose}>取消</button><button className={danger ? 'danger-button' : 'primary'}>{saveText}</button></div>; }
function Status({ status, label }) { return <span className={`status status-${status?.toLowerCase()}`}>{label}</span>; }
function Active({ active }) { return <span className={`active-state ${active ? 'yes' : 'no'}`}><i/>{active ? '启用' : '停用'}</span>; }
function Empty({ text }) { return <div className="empty"><span>◇</span><p>{text}</p></div>; }

// PurchaseReceipts
function PurchaseReceipts({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null);
  const load = () => api("/api/purchase-receipts?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(r.purchaseReceipts)).catch((e) => notify(e.message, "error"));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="采购入库单" subtitle="采购到货入仓记录，与采购订单联动" action={can(user, "PURCHASE_RECEIPTS_MANAGE") && <button className="primary" onClick={() => setView({})}>＋ 新增进货单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或供应商" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>单号</th><th>供应商</th><th>仓库</th><th>收货日期</th><th className="number">金额</th><th>状态</th><th>制单人</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:"pointer"}}><td className="mono">{item.receipt_no}</td><td>{item.supplierName}</td><td>{item.warehouseName}</td><td>{item.receipt_date}</td><td className="number">{money(item.total_cents)}</td><td><Status status={item.status} label={item.statusLabel}/></td><td>{item.creatorName}</td><td onClick={(e) => e.stopPropagation()}>{can(user, "PURCHASE_RECEIPTS_MANAGE") && item.status === "DRAFT" && <button className="row-action" onClick={() => setView({ id: item.id })}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有采购入库记录"/>}</div>
    {view && <PurchaseReceiptModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function PurchaseReceiptModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ supplierId: "", warehouseId: "", receiptDate: new Date().toISOString().slice(0,10), remark: "", items: [] });
  useEffect(() => {
    Promise.all([
      api("/api/suppliers").then((r) => setSuppliers(r.suppliers)),
      api("/api/warehouses").then((r) => setWarehouses(r.warehouses)),
      api("/api/products").then((r) => setProducts(r.products))
    ]).catch((e) => notify(e.message, "error"));
    if (value.id) api("/api/purchase-receipts/" + value.id).then((r) => setDetail(r.purchaseReceipt)).catch((e) => notify(e.message, "error"));
  }, []);
  if (detail && !form.supplierId) setForm({ supplierId: detail.supplier_id || "", warehouseId: detail.warehouse_id || "", receiptDate: detail.receipt_date || "", remark: detail.remark || "", items: detail.items || [] });
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api("/api/purchase-receipts/" + value.id, { method: "POST", body: { action: "update", ...form } });
        notify("保存成功");
      } else {
        await api("/api/purchase-receipts", { method: "POST", body: form });
        notify("创建成功");
      }
      onClose();
    } catch (e) { notify(e.message, "error"); }
  };
  const addItem = () => setItems([...form.items, { productId: "", quantity: 1, unitPriceCents: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const totalCents = form.items.reduce((s, i) => s + (i.quantity * i.unitPriceCents), 0);
  return <Modal title={value.id ? "编辑采购入库单" : "新增采购入库单"} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>供应商<select value={form.supplierId} onChange={(e) => setForm({...form, supplierId: e.target.value})} required><option value="">选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}</select></label>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({...form, warehouseId: e.target.value})} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></label>
    <label>收货日期<input type="date" value={form.receiptDate} onChange={(e) => setForm({...form, receiptDate: e.target.value})} required/></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>明细行</span><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>货品</th><th className="number">数量</th><th className="number">单价</th><th className="number">金额</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} onChange={(e) => updateItem(i, "productId", e.target.value)} required><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="1" onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} required/></td>
          <td><input type="number" value={item.unitPriceCents} min="0" onChange={(e) => updateItem(i, "unitPriceCents", Number(e.target.value))} required/></td>
          <td className="number">{money(item.quantity * item.unitPriceCents)}</td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>×</button></td>
        </tr>)}
      </tbody></table>
      <div className="line-total">合计：<strong>{money(totalCents)}</strong></div>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}
// SalesDeliveries
function SalesDeliveries({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null);
  const load = () => api("/api/sales-deliveries?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(r.salesDeliveries)).catch((e) => notify(e.message, "error"));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="销售出库单" subtitle="发货给客户的出库记录，与销售订单联动" action={can(user, "SALES_DELIVERIES_MANAGE") && <button className="primary" onClick={() => setView({})}>＋ 新增出库单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或客户" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>单号</th><th>客户</th><th>仓库</th><th>发货日期</th><th className="number">金额</th><th>状态</th><th>制单人</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:"pointer"}}><td className="mono">{item.delivery_no}</td><td>{item.customerName}</td><td>{item.warehouseName}</td><td>{item.delivery_date}</td><td className="number">{money(item.total_cents)}</td><td><Status status={item.status} label={item.statusLabel}/></td><td>{item.creatorName}</td><td onClick={(e) => e.stopPropagation()}>{can(user, "SALES_DELIVERIES_MANAGE") && item.status === "DRAFT" && <button className="row-action" onClick={() => setView({ id: item.id })}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有销售出库记录"/>}</div>
    {view && <SalesDeliveryModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function SalesDeliveryModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [customers, setCustomers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ customerId: "", warehouseId: "", deliveryDate: new Date().toISOString().slice(0,10), remark: "", items: [] });
  useEffect(() => {
    Promise.all([
      api("/api/customers").then((r) => setCustomers(r.customers)),
      api("/api/warehouses").then((r) => setWarehouses(r.warehouses)),
      api("/api/products").then((r) => setProducts(r.products))
    ]).catch((e) => notify(e.message, "error"));
    if (value.id) api("/api/sales-deliveries/" + value.id).then((r) => setDetail(r.salesDelivery)).catch((e) => notify(e.message, "error"));
  }, []);
  if (detail && !form.customerId) setForm({ customerId: detail.customer_id || "", warehouseId: detail.warehouse_id || "", deliveryDate: detail.delivery_date || "", remark: detail.remark || "", items: detail.items || [] });
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api("/api/sales-deliveries/" + value.id, { method: "POST", body: { action: "update", ...form } });
        notify("保存成功");
      } else {
        await api("/api/sales-deliveries", { method: "POST", body: form });
        notify("创建成功");
      }
      onClose();
    } catch (e) { notify(e.message, "error"); }
  };
  const addItem = () => setItems([...form.items, { productId: "", quantity: 1, unitPriceCents: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const totalCents = form.items.reduce((s, i) => s + (i.quantity * i.unitPriceCents), 0);
  return <Modal title={value.id ? "编辑销售出库单" : "新增销售出库单"} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>客户<select value={form.customerId} onChange={(e) => setForm({...form, customerId: e.target.value})} required><option value="">选择客户</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select></label>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({...form, warehouseId: e.target.value})} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></label>
    <label>发货日期<input type="date" value={form.deliveryDate} onChange={(e) => setForm({...form, deliveryDate: e.target.value})} required/></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>明细行</span><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>货品</th><th className="number">数量</th><th className="number">单价</th><th className="number">金额</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} onChange={(e) => updateItem(i, "productId", e.target.value)} required><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="1" onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} required/></td>
          <td><input type="number" value={item.unitPriceCents} min="0" onChange={(e) => updateItem(i, "unitPriceCents", Number(e.target.value))} required/></td>
          <td className="number">{money(item.quantity * item.unitPriceCents)}</td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>×</button></td>
        </tr>)}
      </tbody></table>
      <div className="line-total">合计：<strong>{money(totalCents)}</strong></div>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}
// Returns
function Returns({ user, notify }) {
  const [tab, setTab] = useState("sales");
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null);
  const load = () => {
    const apiPath = tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns";
    api(apiPath + "?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(tab === "sales" ? r.salesReturns : r.purchaseReturns)).catch((e) => notify(e.message, "error"));
  };
  useEffect(() => { void load(); }, [tab, status]);
  const cols = ["单号", tab === "sales" ? "客户" : "供应商", "仓库", "金额", "状态", "制单人", ""];
  return <Panel title="退货管理" subtitle="销售退货与采购退货的统一入口" action={can(user, "RETURNS_MANAGE") && <button className="primary" onClick={() => setView({ tab })}>＋ 新增退货单</button>}>
    <div className="segment-wrap"><div className="segment"><button className={tab === "sales" ? "active" : ""} onClick={() => setTab("sales")}>销售退货</button><button className={tab === "purchase" ? "active" : ""} onClick={() => setTab("purchase")}>采购退货</button></div></div>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr>{cols.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id, tab })} style={{cursor:"pointer"}}>
        <td className="mono">{item.return_no}</td>
        <td>{tab === "sales" ? item.customerName : item.supplierName}</td>
        <td>{item.warehouseName}</td>
        <td className="number">{money(item.total_cents)}</td>
        <td><Status status={item.status} label={item.statusLabel}/></td>
        <td>{item.creatorName}</td>
        <td onClick={(e) => e.stopPropagation()}>{can(user, "RETURNS_MANAGE") && item.status === "DRAFT" && <button className="row-action" onClick={() => setView({ id: item.id, tab })}>编辑</button>}</td>
      </tr>)}
    </tbody></table>{!items.length && <Empty text="没有退货记录"/>}</div>
    {view && <ReturnModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function ReturnModal({ user, value, onClose, notify, api }) {
  const tab = value.tab;
  const [detail, setDetail] = useState(value.id ? null : value);
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ partyId: "", warehouseId: "", remark: "", items: [] });
  useEffect(() => {
    Promise.all([
      api("/api/suppliers").then((r) => setSuppliers(r.suppliers)),
      api("/api/customers").then((r) => setCustomers(r.customers)),
      api("/api/warehouses").then((r) => setWarehouses(r.warehouses)),
      api("/api/products").then((r) => setProducts(r.products))
    ]).catch((e) => notify(e.message, "error"));
    if (value.id) {
      const apiPath = tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns";
      api(apiPath + "/" + value.id).then((r) => setDetail(tab === "sales" ? r.salesReturn : r.purchaseReturn)).catch((e) => notify(e.message, "error"));
    }
  }, []);
  if (detail && !form.partyId) setForm({ partyId: (tab === "sales" ? detail.customer_id : detail.supplier_id) || "", warehouseId: detail.warehouse_id || "", remark: detail.remark || "", items: detail.items || [] });
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      const body = tab === "sales" ? { customerId: form.partyId, warehouseId: form.warehouseId, remark: form.remark, items: form.items } : { supplierId: form.partyId, warehouseId: form.warehouseId, remark: form.remark, items: form.items };
      if (value.id) {
        await api((tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns") + "/" + value.id, { method: "POST", body: { action: "update", ...body } });
        notify("保存成功");
      } else {
        await api(tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns", { method: "POST", body });
        notify("创建成功");
      }
      onClose();
    } catch (e) { notify(e.message, "error"); }
  };
  const addItem = () => setItems([...form.items, { productId: "", quantity: 1, unitPriceCents: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const totalCents = form.items.reduce((s, i) => s + (i.quantity * i.unitPriceCents), 0);
  const partyOptions = tab === "sales" ? customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>) : suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>);
  return <Modal title={(value.id ? "编辑" : "新增") + (tab === "sales" ? "销售退货单" : "采购退货单")} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>{tab === "sales" ? "客户" : "供应商"}<select value={form.partyId} onChange={(e) => setForm({...form, partyId: e.target.value})} required><option value="">选择{tab === "sales" ? "客户" : "供应商"}</option>{partyOptions}</select></label>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({...form, warehouseId: e.target.value})} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>明细行</span><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>货品</th><th className="number">数量</th><th className="number">单价</th><th className="number">金额</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} onChange={(e) => updateItem(i, "productId", e.target.value)} required><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="1" onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} required/></td>
          <td><input type="number" value={item.unitPriceCents} min="0" onChange={(e) => updateItem(i, "unitPriceCents", Number(e.target.value))} required/></td>
          <td className="number">{money(item.quantity * item.unitPriceCents)}</td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>×</button></td>
        </tr>)}
      </tbody></table>
      <div className="line-total">合计：<strong>{money(totalCents)}</strong></div>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}
// InventoryTransactions
function InventoryTransactions({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const load = () => api("/api/inventory-transactions?search=" + encodeURIComponent(search) + "&type=" + type).then((r) => setItems(r.inventoryTransactions)).catch((e) => notify(e.message, "error"));
  useEffect(() => { void load(); }, [type]);
  const typeMap = { 
    PURCHASE_RECEIPT: "采购入库", 
    SALES_DELIVERY: "销售出库", 
    SALES_RETURN: "销售退货", 
    PURCHASE_RETURN: "采购退货", 
    INVENTORY_CHECK: "库存盘点", 
    INVENTORY_TRANSFER: "库存调拨", 
    PRODUCTION_OUTPUT: "生产完工入库",
    PRODUCTION_ORDER: "生产领料"
  };
  return <Panel title="库存流水" subtitle="所有库存变动的明细记录">
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或货品" extra={<select value={type} onChange={(e) => setType(e.target.value)}><option value="">全部类型</option>{Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}/>
    <div className="table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>单号</th><th>仓库</th><th>货品</th><th className="number">数量</th><th className="number">结存</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td>{item.created_at?.slice(0,10)}</td><td><Status status={item.tx_type?.toLowerCase()} label={typeMap[item.tx_type] || item.tx_type}/></td><td className="mono">{item.ref_no}</td><td>{item.warehouseName}</td><td>{item.productName}</td><td className={"number " + (item.quantity > 0 ? "positive" : "negative")}>{item.quantity > 0 ? "+" : ""}{item.quantity}</td><td className="number">{item.balance}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有库存流水记录"/>}</div>
  </Panel>;
}


// ============ Accounts Receivable ============
function AccountsReceivable({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/accounts-receivable?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.receivables)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="应收账款" subtitle="客户欠款，跟踪回款情况" action={can(user, 'AR_MANAGE') && <button className="primary" onClick={() => setView({})}>＋ 手工应收</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或客户" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="OPEN">未收</option><option value="PARTIAL">部分收款</option><option value="CLOSED">已结清</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>来源单号</th><th>客户</th><th className="number">应收金额</th><th className="number">已收金额</th><th className="number">未收金额</th><th>状态</th><th>到期日</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.source_type === 'SALES_ORDER' ? '销售订单' : '销售出库'}</td><td>{item.customerName}</td><td className="number">{money(item.amount_cents)}</td><td className="number">{money(item.paid_cents)}</td><td className="number positive">{money(item.unpaidCents)}</td><td><Status status={item.status?.toLowerCase()} label={item.statusLabel}/></td><td>{item.due_date || '-'}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有应收账款记录"/>}</div>
    {view && <ARModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function ARModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customerId: '', sourceType: 'SALES_ORDER', sourceId: '', amountCents: 0, dueDate: '' });
  useEffect(() => {
    api('/api/customers').then((r) => setCustomers(r.customers)).catch((e) => notify(e.message, 'error'));
    if (value.id) api('/api/accounts-receivable/' + value.id).then((r) => setDetail(r.receivable)).catch((e) => notify(e.message, 'error'));
  }, []);
  if (detail && !form.customerId) setForm({ customerId: detail.customer_id || '', sourceType: detail.source_type || 'SALES_ORDER', sourceId: detail.source_id || '', amountCents: detail.amount_cents || 0, dueDate: detail.due_date || '' });
  const save = async () => {
    try {
      if (value.id) { notify('编辑功能开发中'); onClose(); return; }
      await api('/api/accounts-receivable', { method: 'POST', body: form });
      notify('创建成功');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <Modal title={value.id ? '应收账款详情' : '手工创建应收'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>客户<select value={form.customerId} onChange={(e) => setForm({...form, customerId: e.target.value})} required><option value="">选择客户</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select></label>
    <label>应收金额<input type="number" value={form.amountCents} min="0" onChange={(e) => setForm({...form, amountCents: Number(e.target.value)})} required/></label>
    <label>到期日<input type="date" value={form.dueDate} onChange={(e) => setForm({...form, dueDate: e.target.value})}/></label>
    <FormActions onClose={onClose} saveText={value.id ? '保存' : '创建'}/>
  </form></Modal>;
}

// ============ Accounts Payable ============
function AccountsPayable({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/accounts-payable?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.payables)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="应付账款" subtitle="对供应商的欠款，跟踪付款情况" action={can(user, 'AP_MANAGE') && <button className="primary" onClick={() => setView({})}>＋ 手工应付</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或供应商" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="OPEN">未付</option><option value="PARTIAL">部分付款</option><option value="CLOSED">已结清</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>来源单号</th><th>供应商</th><th className="number">应付金额</th><th className="number">已付金额</th><th className="number">未付金额</th><th>状态</th><th>到期日</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.source_type === 'PURCHASE_ORDER' ? '采购订单' : '采购入库'}</td><td>{item.supplierName}</td><td className="number">{money(item.amount_cents)}</td><td className="number">{money(item.paid_cents)}</td><td className="number negative">{money(item.unpaidCents)}</td><td><Status status={item.status?.toLowerCase()} label={item.statusLabel}/></td><td>{item.due_date || '-'}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有应付账款记录"/>}</div>
    {view && <APModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function APModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ supplierId: '', sourceType: 'PURCHASE_ORDER', sourceId: '', amountCents: 0, dueDate: '' });
  useEffect(() => {
    api('/api/suppliers').then((r) => setSuppliers(r.suppliers)).catch((e) => notify(e.message, 'error'));
    if (value.id) api('/api/accounts-payable/' + value.id).then((r) => setDetail(r.payable)).catch((e) => notify(e.message, 'error'));
  }, []);
  if (detail && !form.supplierId) setForm({ supplierId: detail.supplier_id || '', sourceType: detail.source_type || 'PURCHASE_ORDER', sourceId: detail.source_id || '', amountCents: detail.amount_cents || 0, dueDate: detail.due_date || '' });
  const save = async () => {
    try {
      if (value.id) { notify('编辑功能开发中'); onClose(); return; }
      await api('/api/accounts-payable', { method: 'POST', body: form });
      notify('创建成功');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <Modal title={value.id ? '应付账款详情' : '手工创建应付'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>供应商<select value={form.supplierId} onChange={(e) => setForm({...form, supplierId: e.target.value})} required><option value="">选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}</select></label>
    <label>应付金额<input type="number" value={form.amountCents} min="0" onChange={(e) => setForm({...form, amountCents: Number(e.target.value)})} required/></label>
    <label>到期日<input type="date" value={form.dueDate} onChange={(e) => setForm({...form, dueDate: e.target.value})}/></label>
    <FormActions onClose={onClose} saveText={value.id ? '保存' : '创建'}/>
  </form></Modal>;
}

// ============ Payment Collections ============
function PaymentCollections({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/payment-collections?search=' + encodeURIComponent(search)).then((r) => setItems(r.collections)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <Panel title="收款单" subtitle="记录客户回款，核销应收账款" action={can(user, 'AR_MANAGE') && <button className="primary" onClick={() => setView({})}>＋ 新增收款</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或客户"/>
    <div className="table-wrap"><table><thead><tr><th>收款单号</th><th>客户</th><th className="number">收款金额</th><th>收款方式</th><th>收款日期</th><th>制单人</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.collection_no}</td><td>{item.customerName}</td><td className="number positive">{money(item.amount_cents)}</td><td>{item.payment_method === 'CASH' ? '现金' : item.payment_method === 'BANK' ? '银行转账' : '其他'}</td><td>{item.collection_date}</td><td>{item.creatorName}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有收款记录"/>}</div>
    {view && <PCModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function PCModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [customers, setCustomers] = useState([]);
  const [receivables, setReceivables] = useState([]);
  const [form, setForm] = useState({ customerId: '', amountCents: 0, paymentMethod: 'BANK', bankAccount: '', collectionDate: new Date().toISOString().slice(0,10), remark: '', items: [] });
  useEffect(() => {
    api('/api/customers').then((r) => setCustomers(r.customers)).catch((e) => notify(e.message, 'error'));
    if (value.id) api('/api/payment-collections/' + value.id).then((r) => setDetail(r.collection)).catch((e) => notify(e.message, 'error'));
  }, []);
  useEffect(() => {
    if (form.customerId) api('/api/accounts-receivable?customer=' + form.customerId + '&status=OPEN').then((r) => setReceivables(r.receivables.filter((ar) => ar.unpaidCents > 0))).catch(() => {});
    else setReceivables([]);
  }, [form.customerId]);
  if (detail && !form.customerId) setForm({ customerId: detail.customer_id || '', amountCents: detail.amount_cents || 0, paymentMethod: detail.payment_method || 'BANK', bankAccount: detail.bank_account || '', collectionDate: detail.collection_date || '', remark: detail.remark || '', items: detail.items || [] });
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const totalApplied = form.items.reduce((s, i) => s + (i.amountCents || 0), 0);
  const save = async () => {
    try {
      if (value.id) { notify('编辑功能开发中'); onClose(); return; }
      await api('/api/payment-collections', { method: 'POST', body: form });
      notify('创建成功');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const addItem = () => setItems([...form.items, { receivableId: '', amountCents: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  return <Modal title={value.id ? '收款详情' : '新增收款单'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>客户<select value={form.customerId} onChange={(e) => setForm({...form, customerId: e.target.value})} required><option value="">选择客户</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select></label>
    <label>收款方式<select value={form.paymentMethod} onChange={(e) => setForm({...form, paymentMethod: e.target.value})}><option value="BANK">银行转账</option><option value="CASH">现金</option></select></label>
    <label>收款日期<input type="date" value={form.collectionDate} onChange={(e) => setForm({...form, collectionDate: e.target.value})} required/></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>核销应收</span><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>应收单</th><th className="number">未收金额</th><th className="number">本次收款</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.receivableId} onChange={(e) => updateItem(i, 'receivableId', e.target.value)} required><option value="">选择应收单</option>{receivables.map((ar) => <option key={ar.id} value={ar.id}>{(ar.source_type === 'SALES_ORDER' ? '订单' : '出库') + ' ' + money(ar.unpaidCents)}</option>)}</select></td>
          <td className="number">{item.receivableId ? (receivables.find((r) => r.id === item.receivableId)?.unpaidCents || 0) : 0}</td>
          <td><input type="number" value={item.amountCents} min="0" onChange={(e) => updateItem(i, 'amountCents', Number(e.target.value))} required/></td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>x</button></td>
        </tr>)}
      </tbody></table>
      <div className="line-total">合计：<strong>{money(totalApplied)}</strong></div>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

// ============ Payment Disbursements ============
function PaymentDisbursements({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/payment-disbursements?search=' + encodeURIComponent(search)).then((r) => setItems(r.disbursements)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, []);
  return <Panel title="付款单" subtitle="记录对供应商的付款，核销应付账款" action={can(user, 'AP_MANAGE') && <button className="primary" onClick={() => setView({})}>＋ 新增付款</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或供应商"/>
    <div className="table-wrap"><table><thead><tr><th>付款单号</th><th>供应商</th><th className="number">付款金额</th><th>付款方式</th><th>付款日期</th><th>制单人</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.disbursement_no}</td><td>{item.supplierName}</td><td className="number negative">{money(item.amount_cents)}</td><td>{item.payment_method === 'CASH' ? '现金' : item.payment_method === 'BANK' ? '银行转账' : '其他'}</td><td>{item.disbursement_date}</td><td>{item.creatorName}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有付款记录"/>}</div>
    {view && <PDModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function PDModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [suppliers, setSuppliers] = useState([]);
  const [payables, setPayables] = useState([]);
  const [form, setForm] = useState({ supplierId: '', amountCents: 0, paymentMethod: 'BANK', bankAccount: '', disbursementDate: new Date().toISOString().slice(0,10), remark: '', items: [] });
  useEffect(() => {
    api('/api/suppliers').then((r) => setSuppliers(r.suppliers)).catch((e) => notify(e.message, 'error'));
    if (value.id) api('/api/payment-disbursements/' + value.id).then((r) => setDetail(r.disbursement)).catch((e) => notify(e.message, 'error'));
  }, []);
  useEffect(() => {
    if (form.supplierId) api('/api/accounts-payable?supplier=' + form.supplierId + '&status=OPEN').then((r) => setPayables(r.payables.filter((ap) => ap.unpaidCents > 0))).catch(() => {});
    else setPayables([]);
  }, [form.supplierId]);
  if (detail && !form.supplierId) setForm({ supplierId: detail.supplier_id || '', amountCents: detail.amount_cents || 0, paymentMethod: detail.payment_method || 'BANK', bankAccount: detail.bank_account || '', disbursementDate: detail.disbursement_date || '', remark: detail.remark || '', items: detail.items || [] });
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const totalApplied = form.items.reduce((s, i) => s + (i.amountCents || 0), 0);
  const save = async () => {
    try {
      if (value.id) { notify('编辑功能开发中'); onClose(); return; }
      await api('/api/payment-disbursements', { method: 'POST', body: form });
      notify('创建成功');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const addItem = () => setItems([...form.items, { payableId: '', amountCents: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  return <Modal title={value.id ? '付款详情' : '新增付款单'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>供应商<select value={form.supplierId} onChange={(e) => setForm({...form, supplierId: e.target.value})} required><option value="">选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}</select></label>
    <label>付款方式<select value={form.paymentMethod} onChange={(e) => setForm({...form, paymentMethod: e.target.value})}><option value="BANK">银行转账</option><option value="CASH">现金</option></select></label>
    <label>付款日期<input type="date" value={form.disbursementDate} onChange={(e) => setForm({...form, disbursementDate: e.target.value})} required/></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>核销应付</span><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>应付单</th><th className="number">未付金额</th><th className="number">本次付款</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.payableId} onChange={(e) => updateItem(i, 'payableId', e.target.value)} required><option value="">选择应付单</option>{payables.map((ap) => <option key={ap.id} value={ap.id}>{(ap.source_type === 'PURCHASE_ORDER' ? '订单' : '入库') + ' ' + money(ap.unpaidCents)}</option>)}</select></td>
          <td className="number">{item.payableId ? (payables.find((p) => p.id === item.payableId)?.unpaidCents || 0) : 0}</td>
          <td><input type="number" value={item.amountCents} min="0" onChange={(e) => updateItem(i, 'amountCents', Number(e.target.value))} required/></td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>x</button></td>
        </tr>)}
      </tbody></table>
      <div className="line-total">合计：<strong>{money(totalApplied)}</strong></div>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}




// ============ BOM ============
function Boms({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const [products, setProducts] = useState([]);
  const [filterProduct, setFilterProduct] = useState('');
  const load = () => api('/api/boms?product=' + filterProduct).then((r) => setItems(r.boms)).catch((e) => notify(e.message, 'error'));
  useEffect(() => {
    api('/api/products').then((r) => setProducts(r.products)).catch((e) => notify(e.message, 'error'));
    void load();
  }, [filterProduct]);
  return <Panel title="BOM清单" subtitle="物料清单，定义产品组成" action={can(user, 'BOM_MANAGE') && <button className="primary" onClick={() => setView({})}>＋ 新建BOM</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索BOM" extra={<select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}><option value="">全部产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select>}/>
    <div className="table-wrap"><table><thead><tr><th>BOM版本</th><th>产品</th><th>状态</th><th>物料项</th><th>备注</th><th>创建人</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.productCode}-v{item.version}</td><td>{item.productName}</td><td><Status status={item.status?.toLowerCase()} label={item.status === 'ACTIVE' ? '启用' : item.status === 'DISCONTINUED' ? '停用' : '草稿'}/></td><td className="number">{item.itemCount}</td><td>{item.remark || '-'}</td><td>{item.creatorName}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有BOM记录"/>}</div>
    {view && <BomModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api} products={products}/>}
  </Panel>;
}

function BomModal({ user, value, onClose, notify, api, products }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [form, setForm] = useState({ productId: '', version: '1.0', remark: '', items: [] });
  useEffect(() => {
    if (value.id) api('/api/boms/' + value.id).then((r) => setDetail(r.bom)).catch((e) => notify(e.message, 'error'));
  }, []);
  if (detail && !form.productId) setForm({ productId: detail.product_id || '', version: detail.version || '1.0', remark: detail.remark || '', items: detail.items || [] });
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api('/api/boms/' + value.id, { method: 'POST', body: { remark: form.remark, items: form.items } });
        notify('更新成功');
      } else {
        await api('/api/boms', { method: 'POST', body: form });
        notify('创建成功');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const addItem = () => setItems([...form.items, { productId: '', quantity: 1, scrapRate: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const usedProducts = products.filter((p) => p.id !== form.productId);
  return <Modal title={value.id ? 'BOM详情' : '新建BOM'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {!value.id && <><label>产品<select value={form.productId} onChange={(e) => setForm({...form, productId: e.target.value})} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></label>
    <label>版本号<input value={form.version} onChange={(e) => setForm({...form, version: e.target.value})} required/></label></>}
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>物料组成</span><button type="button" className="secondary" onClick={addItem}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">用量</th><th className="number">损耗率</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} onChange={(e) => updateItem(i, 'productId', e.target.value)} required><option value="">选择物料</option>{usedProducts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="0.001" step="0.001" onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))} required/></td>
          <td><input type="number" value={item.scrapRate} min="0" max="1" step="0.01" onChange={(e) => updateItem(i, 'scrapRate', Number(e.target.value))}/></td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>x</button></td>
        </tr>)}
      </tbody></table>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}

// ============ Production Orders ============


function MRPCalculator({ products, onClose, notify }) {
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  async function calculate() {
    if (!productId || !quantity) {
      notify('请选择产品和输入数量');
      return;
    }
    setLoading(true);
    try {
      const data = await api('/api/mrp/calculate', {
        method: 'POST',
        body: { type: 'product', productId, quantity: Number(quantity) }
      });
      setResult(data);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }
  
  const selectedProduct = products.find(p => p.id === productId);
  
  return <Modal title="MRP 物料需求运算" onClose={onClose} wide>
    <div className="modal-body">
      <div className="form-grid" style={{marginBottom: '20px'}}>
        <label className="full">
          选择产品
          <select value={productId} onChange={e => { setProductId(e.target.value); setResult(null); }}>
            <option value="">-- 选择产品 --</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
          </select>
        </label>
        <label>
          需求数量
          <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} min="1"/>
        </label>
        <label style={{display: 'flex', alignItems: 'flex-end'}}>
          <button className="primary" onClick={calculate} disabled={loading}>
            {loading ? '计算中...' : '计算 MRP'}
          </button>
        </label>
      </div>
      
      {result && <>
        <div className="form-section-head">运算结果</div>
        
        <div className="stats-grid" style={{marginBottom: '16px'}}>
          <div className="stat-card">
            <span>需求物料数</span>
            <strong>{result.materialsCount}</strong>
          </div>
          <div className="stat-card">
            <span>紧急采购</span>
            <strong style={{color: result.summary.urgentCount > 0 ? 'var(--danger)' : 'inherit'}}>{result.summary.urgentCount}</strong>
          </div>
          <div className="stat-card">
            <span>优先采购</span>
            <strong style={{color: result.summary.highCount > 0 ? 'var(--warning)' : 'inherit'}}>{result.summary.highCount}</strong>
          </div>
          <div className="stat-card">
            <span>预估成本</span>
            <strong>{money(result.summary.totalEstimatedCost)}</strong>
          </div>
        </div>
        
        <div style={{marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <strong>采购建议清单</strong>
          <button className="secondary small" onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? '收起详情' : '显示详情'}
          </button>
        </div>
        
        <div className="table-wrap">
          <table>
            <thead><tr><th>物料编码</th><th>物料名称</th><th>需求数量</th><th>当前库存</th><th>采购数量</th><th>单位</th><th>预估成本</th><th>紧急程度</th></tr></thead>
            <tbody>
              {result.suggestions.map(s => <tr key={s.productId}>
                <td className="mono">{s.code}</td>
                <td><strong>{s.name}</strong></td>
                <td className="number">{s.requiredQty.toFixed(3)}</td>
                <td className="number">{s.currentStock.toFixed(3)}</td>
                <td className="number positive"><strong>{s.quantity.toFixed(3)}</strong></td>
                <td>{s.unit}</td>
                <td className="number">{money(s.estimatedCost)}</td>
                <td>
                  {s.urgency === 'urgent' && <span className="status rejected">缺货</span>}
                  {s.urgency === 'high' && <span className="status pending">紧急</span>}
                  {s.urgency === 'normal' && <span className="status submitted">普通</span>}
                </td>
              </tr>)}
            </tbody>
            {showDetails && <tfoot style={{background: 'var(--bg-tertiary)'}}>
              <tr><td colSpan="8"><em>明细：</em></td></tr>
              {result.suggestions.map(s => <tr key={'detail-' + s.productId}>
                <td colSpan="2" className="mono">{s.code}</td>
                <td colSpan="6">需求：{s.requiredQty.toFixed(3)} - 库存：{s.currentStock.toFixed(3)} = 采购：{s.quantity.toFixed(3)} {s.unit}</td>
              </tr>)}
            </tfoot>}
          </table>
        </div>
        
        <div style={{marginTop: '16px', padding: '12px', background: 'var(--accent-primary-subtle)', borderRadius: 'var(--radius-md)'}}>
          <strong style={{color: 'var(--accent-primary)'}}>💡 说明</strong>
          <p style={{fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px'}}>
            以上采购建议基于已审核的 BOM 清单计算。实际采购时还需考虑供应商交期、最小起订量等因素。
          </p>
        </div>
      </>}
    </div>
    <div className="modal-footer">
      <button className="secondary" onClick={onClose}>关闭</button>
    </div>
  </Modal>;
}

function ProductionOrders({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/production-orders?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="生产工单" subtitle="生产任务排程与跟踪" action={can(user, 'PRODUCTION_CREATE') && <button className="primary" onClick={() => setView({})}>＋ 新建工单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索工单号或产品" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="PENDING">待生产</option><option value="IN_PROGRESS">生产中</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>工单号</th><th>产品</th><th className="number">数量</th><th>计划开始</th><th>状态</th><th>完工</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.order_no}</td><td>{item.productName}</td><td className="number">{item.quantity}</td><td>{item.planned_start || '-'}</td><td><Status status={item.status?.toLowerCase()} label={item.statusLabel}/></td><td className="number">{item.totalOutput || 0}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有生产工单"/>}</div>
    {view && <ProductionOrderModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function ProductionOrderModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [products, setProducts] = useState([]);
  const [boms, setBoms] = useState([]);
  const [form, setForm] = useState({ productId: '', bomId: '', quantity: 1, plannedStart: '', plannedFinish: '', remark: '' });
  useEffect(() => {
    api('/api/products').then((r) => setProducts(r.products)).catch((e) => notify(e.message, 'error'));
    if (value.id) api('/api/production-orders/' + value.id).then((r) => setDetail(r.order)).catch((e) => notify(e.message, 'error'));
  }, []);
  useEffect(() => {
    if (form.productId) api('/api/boms?product=' + form.productId).then((r) => setBoms(r.boms.filter((b) => b.status === 'ACTIVE'))).catch(() => setBoms([]));
    else setBoms([]);
  }, [form.productId]);
  if (detail && !form.productId) setForm({ productId: detail.product_id || '', bomId: detail.bom_id || '', quantity: detail.quantity || 1, plannedStart: detail.planned_start || '', plannedFinish: detail.planned_finish || '', remark: detail.remark || '' });
  const save = async () => {
    try {
      if (value.id) { notify('编辑功能开发中'); onClose(); return; }
      await api('/api/production-orders', { method: 'POST', body: form });
      notify('创建成功');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const startOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'start' } });
      notify('已开工');
      api('/api/production-orders/' + value.id).then((r) => setDetail(r.order)).catch((e) => notify(e.message, 'error'));
    } catch (e) { notify(e.message, 'error'); }
  };
  const completeOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'complete' } });
      notify('已完工');
      api('/api/production-orders/' + value.id).then((r) => setDetail(r.order)).catch((e) => notify(e.message, 'error'));
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'cancel' } });
      notify('已取消');
      api('/api/production-orders/' + value.id).then((r) => setDetail(r.order)).catch((e) => notify(e.message, 'error'));
    } catch (e) { notify(e.message, 'error'); }
  };
  return <Modal title={value.id ? '生产工单详情' : '新建生产工单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>工单号<span className="mono">{detail.order_no}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={detail.statusLabel}/></label>
        <label>产品<span>{detail.productName}</span></label>
        <label>数量<span>{detail.quantity}</span></label>
        <label>计划开始<span>{detail.planned_start || '-'}</span></label>
        <label>实际开工<span>{detail.actual_start || '-'}</span></label>
      </div>
      <div className="form-section-head" style={{marginTop:'1rem'}}>物料消耗</div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">需求数量</th><th className="number">已消耗</th></tr></thead><tbody>
        {(detail.items || []).map((item) => <tr key={item.id}><td>{item.productName}</td><td className="number">{item.quantity.toFixed(3)}</td><td className="number">{item.consumed_quantity.toFixed(3)}</td></tr>)}
      </tbody>
      {!detail.items?.length && <tbody><tr><td colspan="3" style={{textAlign:'center',color:'#999'}}>无配料记录</td></tr></tbody>}
      </table>
      <div className="form-actions" style={{marginTop:'1rem'}}>
        {detail.status === 'PENDING' && can(user, 'PRODUCTION_START') && <button className="primary" onClick={startOrder}>开工</button>}
        {detail.status === 'IN_PROGRESS' && can(user, 'PRODUCTION_COMPLETE') && <button className="primary" onClick={completeOrder}>完工</button>}
        {detail.status !== 'COMPLETED' && can(user, 'PRODUCTION_CANCEL') && <button className="danger-button" onClick={cancelOrder}>取消</button>}
        <button className="secondary" onClick={onClose}>关闭</button>
      </div>
    </> : <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>产品<select value={form.productId} onChange={(e) => setForm({...form, productId: e.target.value})} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></label>
      <label>BOM版本<select value={form.bomId} onChange={(e) => setForm({...form, bomId: e.target.value})}><option value="">不使用BOM</option>{boms.map((b) => <option key={b.id} value={b.id}>v{b.version}</option>)}</select></label>
      <label>生产数量<input type="number" value={form.quantity} min="1" onChange={(e) => setForm({...form, quantity: Number(e.target.value)})} required/></label>
      <label>计划开始<input type="date" value={form.plannedStart} onChange={(e) => setForm({...form, plannedStart: e.target.value})}/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
      <FormActions onClose={onClose}/>
    </form>}
  </Modal>;
}


function Loading() { return <div className="loading"><div className="spinner"/>载入中…</div>; }



// ============ Cash Journals ============

function CashJournals({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [accountType, setAccountType] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ search, startDate, endDate, accountType });
    api(`/api/cash-journals?${params}`).then((r) => setItems(r.journals)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  return (
    <Panel title="现金日记账" subtitle="记录现金和银行存款收付款业务">
      <Toolbar
        search={search} setSearch={setSearch} onSearch={load}
        placeholder="搜索单号、摘要或对方单位"
        action={can(user, 'CASH_JOURNALS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增记录</button>}
      />
      <div className="filters">
        <label>开始日期<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}/></label>
        <label>结束日期<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}/></label>
        <label>账户类型<select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
          <option value="">全部</option>
          <option value="CASH">现金</option>
          <option value="BANK">银行</option>
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>单据号</th><th>日期</th><th>类型</th><th>账户</th><th>方向</th><th className="number">金额</th><th>摘要</th><th>操作员</th></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.journal_no}</td>
                <td>{item.journal_date}</td>
                <td><Badge>{item.journal_type === 'RECEIPT' ? '收款' : item.journal_type === 'PAYMENT' ? '付款' : '转账'}</Badge></td>
                <td>{item.account_type === 'CASH' ? '现金' : '银行'}{item.bankName ? ` - ${item.bankName}` : ''}</td>
                <td><Badge type={item.direction === 'IN' ? 'success' : 'danger'}>{item.direction === 'IN' ? '收入' : '支出'}</Badge></td>
                <td className="number">{money(item.amount_cents)}</td>
                <td>{item.summary}</td>
                <td>{item.operatorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无日记账记录"/>}
      </div>
      {editing && <CashJournalModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('日记账已保存'); }} />}
    </Panel>
  );
}

function CashJournalModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    journal_type: 'RECEIPT', account_type: 'CASH', bank_account: '',
    amount_cents: 0, direction: 'IN', counterparty_type: '', counterparty_id: '',
    counterparty_name: '', subject_id: '', summary: '', journal_date: new Date().toISOString().slice(0, 10), remark: ''
  });

  async function save(e) {
    e.preventDefault();
    try {
      await api('/api/cash-journals', { method: 'POST', body: form });
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title="新增日记账" onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>业务类型<select value={form.journal_type} onChange={(e) => setForm({...form, journal_type: e.target.value})}>
          <option value="RECEIPT">收款</option>
          <option value="PAYMENT">付款</option>
          <option value="TRANSFER">转账</option>
        </select></label>
        <label>账户类型<select value={form.account_type} onChange={(e) => setForm({...form, account_type: e.target.value})}>
          <option value="CASH">现金</option>
          <option value="BANK">银行</option>
        </select></label>
        <label>日期<input type="date" value={form.journal_date} onChange={(e) => setForm({...form, journal_date: e.target.value})} required/></label>
        <label>收支方向<select value={form.direction} onChange={(e) => setForm({...form, direction: e.target.value})}>
          <option value="IN">收入</option>
          <option value="OUT">支出</option>
        </select></label>
        <label className="full">金额(元)<input type="number" value={form.amount_cents / 100} step="0.01" min="0" onChange={(e) => setForm({...form, amount_cents: Math.round(e.target.value * 100)})} required/></label>
        <label className="full">对方单位<input value={form.counterparty_name} onChange={(e) => setForm({...form, counterparty_name: e.target.value})}/></label>
        <label className="full">摘要<input value={form.summary} onChange={(e) => setForm({...form, summary: e.target.value})} required/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Bank Accounts ============

function BankAccounts({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api('/api/bank-accounts').then((r) => setItems(r.accounts)).catch((e) => notify(e.message, 'error'));

  useEffect(() => { void load(); }, []);

  return (
    <Panel title="银行账户" subtitle="管理企业银行账户信息">
      <Toolbar action={can(user, 'BANK_ACCOUNTS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增账户</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>开户银行</th><th>账号</th><th>户名</th><th className="number">余额</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.bank_name}</td>
                <td className="mono">{item.account_no}</td>
                <td><strong>{item.account_name}</strong></td>
                <td className="number">{money(item.balance_cents)}</td>
                <td><Active active={item.active}/></td>
                <td>{can(user, 'BANK_ACCOUNTS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无银行账户"/>}
      </div>
      {editing && <BankAccountModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('银行账户已保存'); }} />}
    </Panel>
  );
}

function BankAccountModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({ bank_name: '', account_no: '', account_name: '', initial_balance_cents: 0, remark: '', active: true, ...value });

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/bank-accounts/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/bank-accounts', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑账户' : '新增账户'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>开户银行<input value={form.bank_name} onChange={(e) => setForm({...form, bank_name: e.target.value})} required/></label>
        <label>账号<input value={form.account_no} onChange={(e) => setForm({...form, account_no: e.target.value})} required/></label>
        <label>户名<input value={form.account_name} onChange={(e) => setForm({...form, account_name: e.target.value})} required/></label>
        <label>期初余额(元)<input type="number" value={form.initial_balance_cents / 100} step="0.01" onChange={(e) => setForm({...form, initial_balance_cents: Math.round(e.target.value * 100)})}/></label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        {value.id && <label className="check full"><input type="checkbox" checked={form.active} onChange={(e) => setForm({...form, active: e.target.checked})}/> 启用该账户</label>}
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Bills ============

function Bills({ user, notify }) {
  const [items, setItems] = useState([]);
  const [billType, setBillType] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);

  const load = () => {
    const params = new URLSearchParams({ billType, status });
    api(`/api/bills?${params}`).then((r) => setItems(r.bills)).catch((e) => notify(e.message, 'error'));
  };

  useEffect(() => { void load(); }, []);

  return (
    <Panel title="票据管理" subtitle="管理应收/应付票据">
      <Toolbar action={can(user, 'BILLS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增票据</button>}/>
      <div className="filters">
        <label>票据类型<select value={billType} onChange={(e) => setBillType(e.target.value)}>
          <option value="">全部</option>
          <option value="RECEivable">应收票据</option>
          <option value="PAYable">应付票据</option>
        </select></label>
        <label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部</option>
          <option value="PENDING">待承兑</option>
          <option value="ACCEPTED">已承兑</option>
          <option value="DISCOUNTED">已贴现</option>
          <option value="PAID">已到期</option>
        </select></label>
        <button onClick={load}>查询</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>票据号</th><th>类型</th><th>出票日期</th><th>到期日期</th><th>对方单位</th><th className="number">票面金额</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.bill_no}</td>
                <td><Badge>{item.bill_type === 'RECEivable' ? '应收' : '应付'}</Badge></td>
                <td>{item.issue_date}</td>
                <td>{item.due_date}</td>
                <td>{item.counterpartyName}</td>
                <td className="number">{money(item.face_amount_cents)}</td>
                <td><Badge type={item.status === 'PAID' ? 'success' : item.status === 'PENDING' ? 'warning' : ''}>{item.status}</Badge></td>
                <td>{can(user, 'BILLS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无票据"/>}
      </div>
      {editing && <BillModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('票据已保存'); }} />}
    </Panel>
  );
}

function BillModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    bill_type: 'RECEivable', bill_no: '', counterparty_type: 'CUSTOMER', counterparty_id: '',
    face_amount_cents: 0, issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    status: 'PENDING', remark: '', ...value
  });
  const [counterparties, setCounterparties] = useState([]);

  useEffect(() => {
    if (form.bill_type === 'RECEivable') {
      api('/api/customers').then((r) => setCounterparties(r.customers || []));
    } else {
      api('/api/suppliers').then((r) => setCounterparties(r.suppliers || []));
    }
  }, [form.bill_type]);

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/bills/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/bills', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑票据' : '新增票据'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>票据类型<select value={form.bill_type} onChange={(e) => setForm({...form, bill_type: e.target.value, counterparty_id: ''})}>
          <option value="RECEivable">应收票据</option>
          <option value="PAYable">应付票据</option>
        </select></label>
        <label>票据号<input value={form.bill_no} onChange={(e) => setForm({...form, bill_no: e.target.value})} placeholder="系统自动生成"/></label>
        <label>对方单位<select value={form.counterparty_id} onChange={(e) => setForm({...form, counterparty_id: e.target.value})} required>
          <option value="">选择单位</option>
          {counterparties.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
        </select></label>
        <label>票面金额(元)<input type="number" value={form.face_amount_cents / 100} step="0.01" onChange={(e) => setForm({...form, face_amount_cents: Math.round(e.target.value * 100)})} required/></label>
        <label>出票日期<input type="date" value={form.issue_date} onChange={(e) => setForm({...form, issue_date: e.target.value})} required/></label>
        <label>到期日期<input type="date" value={form.due_date} onChange={(e) => setForm({...form, due_date: e.target.value})} required/></label>
        <label>状态<select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
          <option value="PENDING">待承兑</option>
          <option value="ACCEPTED">已承兑</option>
          <option value="DISCOUNTED">已贴现</option>
          <option value="PAID">已到期</option>
          <option value="CANCELLED">已作废</option>
        </select></label>
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

// ============ Fixed Assets ============

function FixedAssets({ user, notify }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [viewDep, setViewDep] = useState(null);
  const [depreciations, setDepreciations] = useState([]);

  const load = () => api('/api/fixed-assets').then((r) => setItems(r.assets)).catch((e) => notify(e.message, 'error'));

  useEffect(() => { void load(); }, []);

  function viewDepreciations(asset) {
    setViewDep(asset);
    api(`/api/fixed-assets/${asset.id}/depreciations`).then((r) => setDepreciations(r.depreciations)).catch((e) => notify(e.message, 'error'));
  }

  async function calculateDep(assetId) {
    if (!confirm('确认计提本月折旧?')) return;
    try {
      await api('/api/fixed-assets/depreciation', { method: 'POST', body: { assetId, depreciationDate: new Date().toISOString().slice(0, 10) } });
      notify('折旧已计提');
      load();
      viewDepreciations({ id: assetId });
    } catch (e) { notify(e.message, 'error'); }
  }

  return (
    <Panel title="固定资产" subtitle="管理企业固定资产及折旧">
      <Toolbar action={can(user, 'FIXED_ASSETS_MANAGE') && <button className="primary" onClick={() => setEditing({})}>＋ 新增资产</button>}/>
      <div className="table-wrap">
        <table>
          <thead><tr><th>资产编号</th><th>资产名称</th><th>类别</th><th>购置日期</th><th className="number">原值</th><th className="number">累计折旧</th><th className="number">净值</th><th>状态</th><th/></tr></thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.asset_code}</td>
                <td><strong>{item.asset_name}</strong></td>
                <td>{item.category}</td>
                <td>{item.purchase_date}</td>
                <td className="number">{money(item.purchase_amount_cents)}</td>
                <td className="number">{money(item.totalDepreciatedCents || 0)}</td>
                <td className="number"><strong>{money(item.net_value_cents)}</strong></td>
                <td><Badge type={item.status === 'IN_USE' ? 'success' : ''}>{item.status}</Badge></td>
                <td>
                  <button className="row-action" onClick={() => viewDepreciations(item)}>折旧记录</button>
                  {can(user, 'FIXED_ASSETS_MANAGE') && <button className="row-action" onClick={() => calculateDep(item.id)}>计提折旧</button>}
                  {can(user, 'FIXED_ASSETS_MANAGE') && <button className="row-action" onClick={() => setEditing(item)}>编辑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <Empty text="暂无固定资产"/>}
      </div>
      {editing && <FixedAssetModal value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); notify('固定资产已保存'); }} />}
      {viewDep && <DepreciationModal asset={viewDep} depreciations={depreciations} onClose={() => setViewDep(null)}/>}
    </Panel>
  );
}

function FixedAssetModal({ value, onClose, onSaved }) {
  const [form, setForm] = useState({
    asset_code: '', asset_name: '', category: '电子设备', purchase_date: new Date().toISOString().slice(0, 10),
    purchase_amount_cents: 0, useful_life_months: 60, salvage_value_cents: 0, depreciation_method: 'STRAIGHT_LINE', remark: '', status: 'IN_USE', ...value
  });

  async function save(e) {
    e.preventDefault();
    try {
      if (value.id) {
        await api(`/api/fixed-assets/${value.id}`, { method: 'PATCH', body: form });
      } else {
        await api('/api/fixed-assets', { method: 'POST', body: form });
      }
      onSaved();
    } catch (error) { notify(error.message, 'error'); }
  }

  return (
    <Modal title={value.id ? '编辑资产' : '新增资产'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>资产编号<input value={form.asset_code} onChange={(e) => setForm({...form, asset_code: e.target.value})} required/></label>
        <label>资产名称<input value={form.asset_name} onChange={(e) => setForm({...form, asset_name: e.target.value})} required/></label>
        <label>资产类别<select value={form.category} onChange={(e) => setForm({...form, category: e.target.value})}>
          <option value="电子设备">电子设备</option>
          <option value="办公设备">办公设备</option>
          <option value="运输设备">运输设备</option>
          <option value="建筑物">建筑物</option>
          <option value="机器设备">机器设备</option>
          <option value="其他">其他</option>
        </select></label>
        <label>购置日期<input type="date" value={form.purchase_date} onChange={(e) => setForm({...form, purchase_date: e.target.value})} required/></label>
        <label>原值(元)<input type="number" value={form.purchase_amount_cents / 100} step="0.01" onChange={(e) => setForm({...form, purchase_amount_cents: Math.round(e.target.value * 100)})} required/></label>
        <label>使用月数<input type="number" value={form.useful_life_months} min="1" onChange={(e) => setForm({...form, useful_life_months: Number(e.target.value)})} required/></label>
        <label>残值(元)<input type="number" value={form.salvage_value_cents / 100} step="0.01" onChange={(e) => setForm({...form, salvage_value_cents: Math.round(e.target.value * 100)})}/></label>
        <label>折旧方法<select value={form.depreciation_method} onChange={(e) => setForm({...form, depreciation_method: e.target.value})}>
          <option value="STRAIGHT_LINE">直线法</option>
          <option value="NONE">不提折旧</option>
        </select></label>
        {value.id && <label>状态<select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})}>
          <option value="IN_USE">使用中</option>
          <option value="MAINTENANCE">维修中</option>
          <option value="SCRAPPED">已报废</option>
          <option value="SOLD">已出售</option>
        </select></label>}
        <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
        <FormActions onClose={onClose}/>
      </form>
    </Modal>
  );
}

function DepreciationModal({ asset, depreciations, onClose }) {
  return (
    <Modal title={`${asset.asset_name} - 折旧记录`} onClose={onClose}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>计提日期</th><th className="number">折旧金额</th><th>操作员</th></tr></thead>
          <tbody>
            {depreciations.map((d) => (
              <tr key={d.id}>
                <td>{d.depreciation_date}</td>
                <td className="number">{money(d.depreciation_cents)}</td>
                <td>{d.creatorName}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!depreciations.length && <Empty text="暂无折旧记录"/>}
      </div>
      <FormActions onClose={onClose}/>
    </Modal>
  );
}