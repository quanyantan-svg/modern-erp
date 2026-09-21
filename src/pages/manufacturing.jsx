import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, ConfirmDelete, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money, quantity } from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const ISSUE_STATUS_LABELS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const RECEIPT_STATUS_LABELS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const PO_STATUS_LABELS = { PENDING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELLED: '已取消' };

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
  return <Panel title="BOM清单" action={can(user, 'PRODUCTION_ORDERS_CREATE') && <button className="primary" onClick={() => setView({})}>＋ 新建BOM</button>}>
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
  useEffect(() => {
    if (value.id && detail && !form.productId) {
      setForm({ productId: detail.product_id || '', version: detail.version || '1.0', remark: detail.remark || '', items: detail.items || [] });
    }
  }, [detail]);
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api('/api/boms/' + value.id, { method: 'POST', body: { remark: form.remark, items: form.items } });
        notify('BOM 更改已保存');
      } else {
        await api('/api/boms', { method: 'POST', body: form });
        notify('BOM 已创建');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const deactivate = async () => {
    try {
      await api('/api/boms/' + value.id, { method: 'POST', body: { action: 'deactivate' } });
      notify('已停用');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const remove = async () => {
    try { await api('/api/boms/' + value.id, { method: 'DELETE' }); notify('BOM已删除'); onClose(); }
    catch (e) { notify(e.message, 'error'); throw e; }
  };
  const addItem = () => setItems([...form.items, { productId: '', quantity: 1, scrapRate: 0 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const usedProducts = products.filter((p) => p.id !== form.productId);
  return <Modal title={value.id ? 'BOM详情' : '新建BOM'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {!value.id && <><label>产品<select value={form.productId} onChange={(e) => setForm({...form, productId: e.target.value})} required><option value="">选择产品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></label>
    <label>版本号<input value={form.version} onChange={(e) => setForm({...form, version: e.target.value})} required/></label></>}
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.remark})}/></label>
    <div className="full"><div className="form-section-head"><span>物料组成</span><button type="button" className="secondary" onClick={addItem} disabled={detail?.status === 'DISCONTINUED'}>＋ 增行</button></div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">用量</th><th className="number">损耗率</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId || item.product_id || ''} onChange={(e) => updateItem(i, 'productId', e.target.value)} required disabled={detail?.status === 'DISCONTINUED'}><option value="">选择物料</option>{usedProducts.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="0.001" step="0.001" onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))} required disabled={detail?.status === 'DISCONTINUED'}/></td>
          <td><input type="number" value={item.scrapRate ?? item.scrap_rate ?? 0} min="0" max="1" step="0.01" onChange={(e) => updateItem(i, 'scrapRate', Number(e.target.value))} disabled={detail?.status === 'DISCONTINUED'}/></td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)} disabled={detail?.status === 'DISCONTINUED'}>x</button></td>
        </tr>)}
      </tbody></table>
    </div>
    {value.id && detail?.status === 'DISCONTINUED'
      ? <div className="form-actions full"><button type="button" className="secondary" onClick={onClose}>关闭</button>{can(user, 'PRODUCTION_ORDERS_CREATE') && <ConfirmDelete label="BOM" message="确定删除这个已停用且未被业务引用的 BOM 吗？此操作不可撤销。" onConfirm={remove}/>}</div>
      : value.id && detail?.status === 'ACTIVE'
        ? <div className="form-actions full"><button type="button" className="secondary" onClick={onClose}>取消</button><button type="button" className="danger-button" onClick={deactivate}>停用</button><button className="primary">保存</button></div>
        : <FormActions onClose={onClose}/>}
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
            {showDetails && <tfoot style={{background: 'var(--bg-grouped)'}}>
              <tr><td colSpan="8"><em>明细：</em></td></tr>
              {result.suggestions.map(s => <tr key={'detail-' + s.productId}>
                <td colSpan="2" className="mono">{s.code}</td>
                <td colSpan="6">需求：{s.requiredQty.toFixed(3)} - 库存：{s.currentStock.toFixed(3)} = 采购：{s.quantity.toFixed(3)} {s.unit}</td>
              </tr>)}
            </tfoot>}
          </table>
        </div>

        <div style={{marginTop: '16px', padding: '12px', background: 'var(--accent-soft)', borderRadius: 'var(--radius-md)'}}>
          <strong style={{color: 'var(--accent)'}}>说明</strong>
          <p style={{fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px'}}>
            以上采购建议基于启用的 BOM 清单计算。实际采购时还需考虑供应商交期、最小起订量等因素。
          </p>
        </div>
      </>}
    </div>
    <div className="modal-footer">
      <button className="secondary" onClick={onClose}>关闭</button>
    </div>
  </Modal>;
}

// ============ M6 Workflow helpers ============

function ProductionWorkflowTrace({ detail, materialIssues, productionReceipts }) {
  // Material Issue / Receipt are derived purely from confirmed documents
  // (DRAFT / CANCELLED are not stock-affecting).
  const bomReady = Boolean(detail?.bomId);
  const orderCreated = Boolean(detail?.id);
  const orderStarted = ['IN_PROGRESS', 'COMPLETED'].includes(detail?.status);
  const orderCompleted = detail?.status === 'COMPLETED';
  const issuedCount = materialIssues.filter((mi) => mi.status === 'CONFIRMED').length;
  const receivedCount = productionReceipts.filter((pr) => pr.status === 'CONFIRMED').length;
  const stages = [
    { key: 'master', label: 'BOM / 制品工序标准', state: bomReady || detail?.activeRoutingId ? 'completed' : 'optional', hint: [bomReady ? `BOM v${detail.bomVersion}` : '', detail?.activeRoutingCode ? `工序 ${detail.activeRoutingCode}` : ''].filter(Boolean).join(' · ') || '均可独立维护', documentType: null },
    { key: 'order', label: '制令单', state: orderCreated ? 'completed' : 'pending', hint: detail?.order_no, documentType: null },
    { key: 'start', label: '已开工', state: orderStarted ? 'completed' : 'pending', hint: orderStarted ? (detail?.actual_start || '') : '待开工', documentType: null },
    { key: 'issue', label: '用料出库', state: issuedCount ? 'completed' : orderStarted ? 'current' : 'pending', hint: issuedCount ? `已出库 ${issuedCount} 单` : '待出库', documentType: 'materialIssue', pageKey: 'material-issues' },
    { key: 'receipt', label: '生产入库', state: receivedCount ? 'completed' : 'pending', hint: receivedCount ? `已入库 ${receivedCount} 单` : '待入库', documentType: 'productionReceipt', pageKey: 'production-receipts' },
    { key: 'complete', label: '已完工', state: orderCompleted ? 'completed' : 'pending', hint: orderCompleted ? (detail?.actual_finish || '') : '待完工', documentType: null },
  ];
  return <div className="workflow-trace" data-testid="production-workflow-trace">
    <ol>
      {stages.map((stage) => <li key={stage.key} className={`workflow-stage workflow-stage--${stage.state}`}>
        <span className="workflow-stage__dot" aria-hidden="true">{stage.state === 'completed' ? '✓' : stage.state === 'current' ? '●' : '○'}</span>
        <div className="workflow-stage__body">
          <strong>{stage.label}</strong>
          <small>{stage.hint || '—'}</small>
          {stage.documentType && stage.pageKey && (issuedCount || receivedCount) ? <small className="workflow-stage__link">
            {stage.key === 'issue' ? materialIssues.filter((mi) => mi.status === 'CONFIRMED').map((mi) => <AppLink key={mi.id} page={stage.pageKey} documentId={mi.id} documentType={stage.documentType} className="link-button">{mi.issueNo}</AppLink>)
              : productionReceipts.filter((pr) => pr.status === 'CONFIRMED').map((pr) => <AppLink key={pr.id} page={stage.pageKey} documentId={pr.id} documentType={stage.documentType} className="link-button">{pr.receiptNo}</AppLink>)}
          </small> : null}
        </div>
      </li>)}
    </ol>
  </div>;
}

function LinkedDocuments({ materialIssues, productionReceipts }) {
  const issued = materialIssues.filter((mi) => mi.status === 'CONFIRMED');
  const received = productionReceipts.filter((pr) => pr.status === 'CONFIRMED');
  if (!issued.length && !received.length) return null;
  return <div className="related-block" data-testid="production-related-documents">
    <div className="form-section-head">关联单据</div>
    <div className="related-grid">
      <div>
        <strong>用料出库（{issued.length}）</strong>
        {issued.map((mi) => <div key={mi.id} className="related-row">
          <AppLink page="material-issues" documentId={mi.id} documentType="materialIssue" className="link-button">{mi.issueNo}</AppLink>
          <span className="dim">{dateTime(mi.confirmedAt || mi.createdAt)}</span>
        </div>)}
      </div>
      <div>
        <strong>生产入库（{received.length}）</strong>
        {received.map((pr) => <div key={pr.id} className="related-row">
          <AppLink page="production-receipts" documentId={pr.id} documentType="productionReceipt" className="link-button">{pr.receiptNo}</AppLink>
          <span className="dim">{dateTime(pr.confirmedAt || pr.createdAt)}</span>
        </div>)}
      </div>
    </div>
  </div>;
}

// ============ Production Orders Page ============

export function ProductionOrders({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const { target } = useAppNavigation();
  const load = () => api('/api/production-orders?search=' + encodeURIComponent(search) + '&status=' + status).then((r) => setItems(r.orders)).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    if (target?.page === 'production-orders' && target.documentId) {
      setView({ id: target.documentId });
    }
  }, [target]);
  return <Panel title="制令单" action={can(user, 'PRODUCTION_ORDERS_CREATE') && <button className="primary" onClick={() => setView({})}>＋ 新建制令单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索工单号或产品" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="PENDING">待生产</option><option value="IN_PROGRESS">生产中</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>工单号</th><th>产品</th><th className="number">数量</th><th>计划开始</th><th>状态</th><th>完工</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.order_no}</td><td>{item.productName}</td><td className="number">{quantity(item.quantity)}</td><td>{item.planned_start || '-'}</td><td><Status status={item.status?.toLowerCase()} label={PO_STATUS_LABELS[item.status] || item.statusLabel}/></td><td className="number">{quantity(item.totalOutput)}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有制令单"/>}</div>
    {view && <ProductionOrderModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function ProductionOrderModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [products, setProducts] = useState([]);
  const [boms, setBoms] = useState([]);
  const [materialIssues, setMaterialIssues] = useState([]);
  const [productionReceipts, setProductionReceipts] = useState([]);
  const [form, setForm] = useState({ productId: '', bomId: '', quantity: 1, plannedStart: '', plannedFinish: '', remark: '' });
  const refreshDetail = () => {
    if (!value.id) return;
    api('/api/production-orders/' + value.id).then((r) => setDetail(r.order)).catch((e) => notify(e.message, 'error'));
    api(`/api/production-material-issues?status=&search=&page=1`).then((r) => setMaterialIssues((r.materialIssues || []).filter((mi) => mi.productionOrderId === value.id))).catch(() => setMaterialIssues([]));
    api(`/api/production-receipts?status=`).then((r) => setProductionReceipts((r.productionReceipts || []).filter((pr) => pr.productionOrderId === value.id))).catch(() => setProductionReceipts([]));
  };
  useEffect(() => {
    api('/api/products').then((r) => setProducts(r.products)).catch((e) => notify(e.message, 'error'));
    if (value.id) refreshDetail();
  }, []);
  useEffect(() => {
    if (form.productId) api('/api/boms?product=' + form.productId).then((r) => setBoms(r.boms.filter((b) => b.status === 'ACTIVE'))).catch(() => setBoms([]));
    else setBoms([]);
  }, [form.productId]);
  useEffect(() => {
    if (value.id && detail && !form.productId) {
      setForm({ productId: detail.product_id || '', bomId: detail.bom_id || '', quantity: detail.quantity || 1, plannedStart: detail.planned_start || '', plannedFinish: detail.planned_finish || '', remark: detail.remark || '' });
    }
  }, [detail]);
  const save = async () => {
    try {
      await api('/api/production-orders', { method: 'POST', body: form });
      notify('制令单已创建');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const startOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'start' } });
      notify('已开工');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const completeOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'complete' } });
      notify('已完工');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelOrder = async () => {
    try {
      await api('/api/production-orders/' + value.id, { method: 'POST', body: { action: 'cancel' } });
      notify('已取消');
      refreshDetail();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <Modal title={value.id ? '制令单详情' : '新建制令单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>工单号<span className="mono">{detail.order_no}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={PO_STATUS_LABELS[detail.status] || detail.statusLabel}/></label>
        <label>产品<span>{detail.productName}</span></label>
        <label>计划数量<span>{quantity(detail.quantity)}</span></label>
        <label>计划开始<span>{detail.planned_start || '-'}</span></label>
        <label>计划完工<span>{detail.planned_finish || '-'}</span></label>
        <label>实际开工<span>{detail.actual_start || '-'}</span></label>
        <label>实际完工<span>{detail.actual_finish || '-'}</span></label>
        <label>BOM<span>{detail.bom_id ? `v${detail.bomVersion || ''}` : '未关联'}</span></label>
        <label>工序标准<span>{detail.activeRoutingId ? <AppLink page="product-routings" documentId={detail.activeRoutingId} documentType="productRouting" className="link-button">{detail.activeRoutingCode} · {detail.activeRoutingName}</AppLink> : '无启用路线'}</span></label>
        <label>创建人<span>{detail.creatorName}</span></label>
      </div>
      <div className="form-section-head" style={{marginTop:'1rem'}}>生产流程</div>
      <ProductionWorkflowTrace detail={detail} materialIssues={materialIssues} productionReceipts={productionReceipts} />
      <LinkedDocuments materialIssues={materialIssues} productionReceipts={productionReceipts} />
      <div className="form-section-head" style={{marginTop:'1rem'}}>物料清单</div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">需求数量</th><th className="number">已消耗</th></tr></thead><tbody>
        {(detail.items || []).map((item) => <tr key={item.id}><td>{item.productName}</td><td className="number">{quantity(item.quantity)}</td><td className="number">{quantity(item.consumed_quantity)}</td></tr>)}
      </tbody>
      {!detail.items?.length && <tbody><tr><td colSpan="3" style={{textAlign:'center',color:'#999'}}>无配料记录</td></tr></tbody>}
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

// ============ Material Issues ============

export function MaterialIssues({ user, notify }) {
  const { target } = useAppNavigation();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/production-material-issues?status=' + status).then((r) => setItems(r.materialIssues || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    if (target?.page === 'material-issues' && target.documentId) {
      setView({ id: target.documentId });
    }
  }, [target]);
  const canManage = can(user, 'PRODUCTION_MATERIAL_ISSUE_MANAGE');
  const filtered = items.filter((item) => !search || item.issueNo.includes(search) || (item.productionOrderNo || '').includes(search));
  return <Panel title="用料出库" subtitle="生产领料登记，确认出库后扣减组件库存" action={canManage && <button className="primary" onClick={() => setView({ create: true })}>＋ 新建出库单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索出库单号或制令单号" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>出库单号</th><th>制令单号</th><th>仓库</th><th>日期</th><th>状态</th><th className="number">物料项</th><th>创建人</th></tr></thead><tbody>
      {filtered.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}>
        <td className="mono">{item.issueNo}</td>
        <td className="mono">{item.productionOrderNo}</td>
        <td>{item.warehouseName}</td>
        <td>{item.issueDate || '-'}</td>
        <td><Status status={item.status?.toLowerCase()} label={ISSUE_STATUS_LABELS[item.status] || item.statusLabel}/></td>
        <td className="number">{item.itemCount}</td>
        <td>{item.creatorName}</td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有用料出库单"/>}</div>
    {view && <MaterialIssueModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function MaterialIssueModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [warehouses, setWarehouses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [prefill, setPrefill] = useState(null);
  const [form, setForm] = useState({ productionOrderId: '', warehouseId: '', issueDate: new Date().toISOString().slice(0, 10), remark: '', items: [] });
  const refresh = () => {
    if (value.id) api('/api/production-material-issues/' + value.id).then((r) => setDetail(r.materialIssue)).catch((e) => notify(e.message, 'error'));
  };
  useEffect(() => {
    api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, 'error'));
    api('/api/production-orders').then((r) => setOrders(r.orders || [])).catch((e) => notify(e.message, 'error'));
    if (value.id) refresh();
  }, []);
  useEffect(() => {
    if (value.id && detail && !form.productionOrderId) {
      setForm({
        productionOrderId: detail.productionOrderId,
        warehouseId: detail.warehouseId,
        issueDate: detail.issueDate || new Date().toISOString().slice(0, 10),
        remark: detail.remark || '',
        items: (detail.items || []).map((it) => ({
          productId: it.productId,
          plannedQuantity: it.plannedQuantity,
          issueQuantity: it.issueQuantity,
        })),
      });
    }
  }, [detail]);
  useEffect(() => {
    if (!value.id && form.productionOrderId && !prefill) {
      api('/api/production-material-issues/prefill-from-bom?productionOrderId=' + form.productionOrderId)
        .then((r) => {
          if (r.hasBom) {
            setPrefill(r);
            setForm((f) => ({ ...f, items: r.items.map((it) => ({ productId: it.productId, plannedQuantity: it.plannedQuantity, issueQuantity: it.issueQuantity })) }));
          } else {
            setPrefill(r);
          }
        })
        .catch(() => setPrefill(null));
    }
  }, [form.productionOrderId]);
  const isCreate = !value.id;
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      const payload = { productionOrderId: form.productionOrderId, warehouseId: form.warehouseId, issueDate: form.issueDate, remark: form.remark, items: form.items };
      if (value.id) {
        await api('/api/production-material-issues/' + value.id, { method: 'PATCH', body: payload });
        notify('用料出库单更改已保存');
      } else {
        await api('/api/production-material-issues', { method: 'POST', body: payload });
        notify('用料出库单已创建');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const confirmIssue = async () => {
    try {
      await api('/api/production-material-issues/' + value.id + '/confirm', { method: 'POST' });
      notify('已确认出库');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelIssue = async () => {
    try {
      await api('/api/production-material-issues/' + value.id + '/cancel', { method: 'POST' });
      notify('已取消');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const orderOptions = orders.filter((o) => o.status === 'PENDING' || o.status === 'IN_PROGRESS');
  const status = detail?.status;
  const readOnly = !isCreate && status !== 'DRAFT';
  return <Modal title={value.id ? '用料出库单' : '新建用料出库单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>出库单号<span className="mono">{detail.issueNo}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={ISSUE_STATUS_LABELS[detail.status] || detail.statusLabel}/></label>
        <label>制令单<span className="mono">{detail.productionOrderNo}</span></label>
        <label>制品<span>{detail.productCode} - {detail.productName}</span></label>
        <label>仓库<span>{detail.warehouseName}</span></label>
        <label>日期<span>{detail.issueDate || '-'}</span></label>
        <label>创建人<span>{detail.creatorName}</span></label>
        <label>确认人<span>{detail.confirmedByName || '-'}</span></label>
        <label className="full">备注<span>{detail.remark || '-'}</span></label>
      </div>
      <div className="form-section-head" style={{marginTop:'1rem'}}>出库明细</div>
      <table className="line-table"><thead><tr><th>物料</th><th className="number">计划用量</th><th className="number">本次出库</th><th className="number">出库前库存</th><th className="number">出库后库存</th></tr></thead><tbody>
        {(detail.items || []).map((it) => <tr key={it.id}>
          <td>{it.productCode} - {it.productName}</td>
          <td className="number">{Number(it.plannedQuantity || 0).toFixed(3)}</td>
          <td className="number">{Number(it.issueQuantity).toFixed(3)} {it.unit}</td>
          <td className="number">{it.beforeQuantity == null ? '-' : Number(it.beforeQuantity).toFixed(3)}</td>
          <td className="number">{it.afterQuantity == null ? '-' : Number(it.afterQuantity).toFixed(3)}</td>
        </tr>)}
      </tbody></table>
      <div className="form-actions" style={{marginTop:'1rem'}}>
        {status === 'DRAFT' && <>
          <button className="primary" onClick={confirmIssue}>确认出库</button>
          <button className="danger-button" onClick={cancelIssue}>取消</button>
        </>}
        <button className="secondary" onClick={onClose}>关闭</button>
      </div>
    </> : <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>制令单<select value={form.productionOrderId} onChange={(e) => { setForm({ ...form, productionOrderId: e.target.value, items: [] }); setPrefill(null); }} required>
        <option value="">选择制令单</option>
        {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.order_no} · {o.productName} · {o.statusLabel || o.status}</option>)}
      </select></label>
      <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
        <option value="">选择仓库</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
      </select></label>
      <label>日期<input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })}/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}/></label>
      {prefill && !prefill.hasBom && <div className="full" style={{padding:'0.5rem', background:'var(--bg-grouped)', borderRadius:'4px'}}>未关联 BOM，需手工选择用料</div>}
      <div className="full"><div className="form-section-head"><span>出库物料</span><button type="button" className="secondary" onClick={() => setItems([...form.items, { productId: '', plannedQuantity: 0, issueQuantity: 1 }])}>＋ 增行</button></div>
        <table className="line-table"><thead><tr><th>物料</th><th className="number">计划用量</th><th className="number">本次出库量</th><th/></tr></thead><tbody>
          {form.items.map((item, i) => <tr key={i}>
            <td>
              <select value={item.productId || ''} onChange={(e) => setItems(form.items.map((it, idx) => idx === i ? { ...it, productId: e.target.value } : it))} required>
                <option value="">选择物料</option>
                {(prefill?.items || []).filter((it) => !form.items.some((other, idx) => idx !== i && other.productId === it.productId)).map((it) => <option key={it.productId} value={it.productId}>{it.productCode} - {it.productName}</option>)}
              </select>
            </td>
            <td><input type="number" value={item.plannedQuantity} min="0" step="0.001" onChange={(e) => setItems(form.items.map((it, idx) => idx === i ? { ...it, plannedQuantity: Number(e.target.value) } : it))}/></td>
            <td><input type="number" value={item.issueQuantity} min="0.001" step="0.001" onChange={(e) => setItems(form.items.map((it, idx) => idx === i ? { ...it, issueQuantity: Number(e.target.value) } : it))} required/></td>
            <td><button type="button" className="danger-text" onClick={() => setItems(form.items.filter((_, idx) => idx !== i))}>x</button></td>
          </tr>)}
        </tbody></table>
        {!form.items.length && <div style={{textAlign:'center', padding:'0.5rem', color:'#999'}}>{prefill?.hasBom ? '点击「＋ 增行」从 BOM 带出用料' : '选择制令单后手工添加出库物料'}</div>}
      </div>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

// ============ Production Receipts ============

export function ProductionReceipts({ user, notify }) {
  const { target } = useAppNavigation();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState(null);
  const load = () => api('/api/production-receipts?status=' + status).then((r) => setItems(r.productionReceipts || [])).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); }, [status]);
  useEffect(() => {
    if (target?.page === 'production-receipts' && target.documentId) {
      setView({ id: target.documentId });
    }
  }, [target]);
  const canManage = can(user, 'PRODUCTION_RECEIPT_MANAGE');
  const filtered = items.filter((item) => !search || item.receiptNo.includes(search) || (item.productionOrderNo || '').includes(search));
  return <Panel title="生产入库" subtitle="成品入库登记，确认后增加制品库存" action={canManage && <button className="primary" onClick={() => setView({ create: true })}>＋ 新建入库单</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索入库单号或制令单号" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>入库单号</th><th>制令单号</th><th>制品</th><th>仓库</th><th className="number">本次入库</th><th>日期</th><th>状态</th></tr></thead><tbody>
      {filtered.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}>
        <td className="mono">{item.receiptNo}</td>
        <td className="mono">{item.productionOrderNo}</td>
        <td>{item.productCode} - {item.productName}</td>
        <td>{item.warehouseName}</td>
        <td className="number">{quantity(item.quantity)}</td>
        <td>{item.receiptDate || '-'}</td>
        <td><Status status={item.status?.toLowerCase()} label={RECEIPT_STATUS_LABELS[item.status] || item.statusLabel}/></td>
      </tr>)}
    </tbody></table>{!filtered.length && <Empty text="没有生产入库单"/>}</div>
    {view && <ProductionReceiptModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function ProductionReceiptModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [warehouses, setWarehouses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ productionOrderId: '', warehouseId: '', quantity: 1, receiptDate: new Date().toISOString().slice(0, 10), remark: '' });
  const refresh = () => {
    if (value.id) api('/api/production-receipts/' + value.id).then((r) => setDetail(r.productionReceipt)).catch((e) => notify(e.message, 'error'));
  };
  useEffect(() => {
    api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, 'error'));
    api('/api/production-orders').then((r) => setOrders(r.orders || [])).catch((e) => notify(e.message, 'error'));
    if (value.id) refresh();
  }, []);
  useEffect(() => {
    if (value.id && detail && !form.productionOrderId) {
      setForm({
        productionOrderId: detail.productionOrderId,
        warehouseId: detail.warehouseId,
        quantity: detail.quantity,
        receiptDate: detail.receiptDate || new Date().toISOString().slice(0, 10),
        remark: detail.remark || '',
      });
    }
  }, [detail]);
  const save = async () => {
    try {
      const payload = { productionOrderId: form.productionOrderId, warehouseId: form.warehouseId, quantity: form.quantity, receiptDate: form.receiptDate, remark: form.remark };
      if (value.id) {
        await api('/api/production-receipts/' + value.id, { method: 'PATCH', body: payload });
        notify('生产入库单更改已保存');
      } else {
        await api('/api/production-receipts', { method: 'POST', body: payload });
        notify('生产入库单已创建');
      }
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  const confirmReceipt = async () => {
    try {
      await api('/api/production-receipts/' + value.id + '/confirm', { method: 'POST' });
      notify('已确认入库');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const cancelReceipt = async () => {
    try {
      await api('/api/production-receipts/' + value.id + '/cancel', { method: 'POST' });
      notify('已取消');
      refresh();
    } catch (e) { notify(e.message, 'error'); }
  };
  const orderOptions = orders.filter((o) => o.status === 'IN_PROGRESS' || o.status === 'COMPLETED' || o.status === 'PENDING');
  const status = detail?.status;
  return <Modal title={value.id ? '生产入库单' : '新建生产入库单'} onClose={onClose} wide>
    {value.id && detail ? <>
      <div className="form-grid">
        <label>入库单号<span className="mono">{detail.receiptNo}</span></label>
        <label>状态<Status status={detail.status?.toLowerCase()} label={RECEIPT_STATUS_LABELS[detail.status] || detail.statusLabel}/></label>
        <label>制令单<span className="mono">{detail.productionOrderNo}</span></label>
        <label>制品<span>{detail.productCode} - {detail.productName}</span></label>
        <label>计划数量<span>{Number(detail.plannedQuantity || 0).toFixed(3)}</span></label>
        <label>本次入库<span>{quantity(detail.quantity)}</span></label>
        <label>累计入库<span>{Number(detail.cumulativeReceived || 0).toFixed(3)}</span></label>
        <label>仓库<span>{detail.warehouseName}</span></label>
        <label>入库前库存<span>{detail.beforeQuantity == null ? '-' : Number(detail.beforeQuantity).toFixed(3)}</span></label>
        <label>入库后库存<span>{detail.afterQuantity == null ? '-' : Number(detail.afterQuantity).toFixed(3)}</span></label>
        <label>日期<span>{detail.receiptDate || '-'}</span></label>
        <label>创建人<span>{detail.creatorName}</span></label>
        <label>确认人<span>{detail.confirmedByName || '-'}</span></label>
        <label className="full">备注<span>{detail.remark || '-'}</span></label>
      </div>
      <div className="form-actions" style={{marginTop:'1rem'}}>
        {status === 'DRAFT' && <>
          <button className="primary" onClick={confirmReceipt}>确认入库</button>
          <button className="danger-button" onClick={cancelReceipt}>取消</button>
        </>}
        <button className="secondary" onClick={onClose}>关闭</button>
      </div>
    </> : <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label>制令单<select value={form.productionOrderId} onChange={(e) => setForm({ ...form, productionOrderId: e.target.value })} required>
        <option value="">选择制令单</option>
        {orderOptions.map((o) => <option key={o.id} value={o.id}>{o.order_no} · {o.productName} · {o.statusLabel || o.status}</option>)}
      </select></label>
      <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
        <option value="">选择仓库</option>
        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}
      </select></label>
      <label>本次入库数量<input type="number" value={form.quantity} min="0.001" step="0.001" onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} required/></label>
      <label>入库日期<input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}/></label>
      <label className="full">备注<input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })}/></label>
      <FormActions onClose={onClose} saveText="保存草稿"/>
    </form>}
  </Modal>;
}

// ============ Projects ============
