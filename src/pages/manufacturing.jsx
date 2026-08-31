import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money } from '../components/ui.jsx';

export function Boms({ user, notify }) {
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

export function ProductionOrders({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/production-orders?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="生产工单" subtitle="生产任务排程与跟踪" action={can(user, 'PRODUCTION_ORDERS_CREATE') && <button className="primary" onClick={() => setView({})}>＋ 新建工单</button>}>
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
        {detail.status === 'PENDING' && can(user, 'PRODUCTION_ORDERS_START') && <button className="primary" onClick={startOrder}>开工</button>}
        {detail.status === 'IN_PROGRESS' && can(user, 'PRODUCTION_ORDERS_COMPLETE') && <button className="primary" onClick={completeOrder}>完工</button>}
        {detail.status !== 'COMPLETED' && (can(user, 'PRODUCTION_ORDERS_CREATE') || can(user, 'PRODUCTION_ORDERS_START')) && <button className="danger-button" onClick={cancelOrder}>取消</button>}
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



// ============ Projects ============
