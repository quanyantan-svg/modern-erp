import { useEffect, useMemo, useState } from 'react';
import { api, setToken } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

export function Login({ onLogin, notify }) {
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

export function Dashboard({ notify }) {
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

export function Suppliers({ user, notify }) {
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

export function Customers({ user, notify }) {
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

export function Products({ user, notify }) {
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

export function Orders({ user, notify }) {
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

export function Approvals({ notify }) {
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

export function UsersRoles({ user, notify }) {
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


export function PurchaseOrders({ user, notify }) {
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


export function Warehouses({ user, notify }) {
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

export function Inventory({ user, notify }) {
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
