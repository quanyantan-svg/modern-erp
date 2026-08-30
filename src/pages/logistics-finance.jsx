import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

export function PurchaseReceipts({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null);
  const load = () => api("/api/purchase-receipts?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(r.purchaseReceipts || [])).catch((e) => notify(e.message, "error"));
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
export function SalesDeliveries({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(null);
  const load = () => api("/api/sales-deliveries?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(r.salesDeliveries || [])).catch((e) => notify(e.message, "error"));
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
export function Returns({ user, notify }) {
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
export function InventoryTransactions({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const load = () => api("/api/inventory-transactions?search=" + encodeURIComponent(search) + "&type=" + type).then((r) => setItems(r.inventoryTransactions || [])).catch((e) => notify(e.message, "error"));
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
export function AccountsReceivable({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/accounts-receivable?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.receivables || [])).catch((e) => notify(e.message, 'error'));
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
export function AccountsPayable({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/accounts-payable?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.payables || [])).catch((e) => notify(e.message, 'error'));
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
export function PaymentCollections({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/payment-collections?search=' + encodeURIComponent(search)).then((r) => setItems(r.collections || [])).catch((e) => notify(e.message, 'error'));
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
export function PaymentDisbursements({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/payment-disbursements?search=' + encodeURIComponent(search)).then((r) => setItems(r.disbursements || [])).catch((e) => notify(e.message, 'error'));
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
