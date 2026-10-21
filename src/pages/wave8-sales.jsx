import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Loading } from '../components/ui.jsx';
import { BusinessPageShell, EmptyState, InlineAlert, StatusChip } from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import '../styles/wave8-sales.css';

const day = () => new Date().toISOString().slice(0, 10);
const key = (prefix) => `${prefix}:${crypto.randomUUID()}`;
const microsLabel = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(Number(value || 0) / 1_000_000);
const centsLabel = (value) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(value || 0) / 100);

function ErrorPanel({ error, retry }) {
  return <EmptyState title="加载失败" description={error || '请稍后重试'} action={<button type="button" className="secondary" onClick={retry}>重新加载</button>}/>;
}

// Business refusals are not failures: 409 is a capacity/version conflict the user must
// resolve, 403 is a permission refusal. Both need to be visible and distinguishable.
function classify(reason) {
  const status = Number(reason?.status || reason?.response?.status || 0);
  if (status === 403) return { tone: 'permission', title: '没有权限执行该操作', message: reason.message };
  if (status === 409) return { tone: 'conflict', title: '业务冲突', message: reason.message };
  if (status === 422 || status === 400) return { tone: 'invalid', title: '输入不合法', message: reason.message };
  return { tone: 'error', title: '操作失败', message: reason?.message || '请稍后重试' };
}

function Field({ label, children, hint }) {
  return <label className="wave8-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Select({ value, onChange, disabled, required, children, placeholder }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>
    <option value="">{placeholder || '请选择'}</option>
    {children}
  </select>;
}

export function ServiceFulfillments({ user, notify }) {
  const navigation = useAppNavigation();
  const salesOrderId = navigation.target?.salesOrderId || '';
  const manageable = can(user, 'SERVICE_SALES_MANAGE') && can(user, 'SALES_MANAGE');
  const [rows, setRows] = useState([]);
  const [orders, setOrders] = useState([]);
  const [lines, setLines] = useState([]);
  const [state, setState] = useState('LOADING');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ orderId: salesOrderId, salesOrderItemId: '', quantity: '', businessDate: day() });

  const reload = useCallback(async () => {
    setState('LOADING'); setError('');
    try {
      const [list, orderList] = await Promise.all([
        api(`/api/service-fulfillments${salesOrderId ? `?salesOrderId=${encodeURIComponent(salesOrderId)}` : ''}`),
        api('/api/sales-orders'),
      ]);
      setRows(list.fulfillments || []);
      setOrders(orderList.orders || orderList.salesOrders || []);
      setState('READY');
    } catch (reason) {
      const classified = classify(reason);
      if (classified.tone === 'permission') { setNotice(classified); setRows([]); setState('READY'); return; }
      setError(classified.message); setState('ERROR');
    }
  }, [salesOrderId]);

  const loadLines = useCallback(async (orderId) => {
    setForm((current) => ({ ...current, orderId, salesOrderItemId: '' }));
    if (!orderId) { setLines([]); return; }
    try {
      const detail = await api(`/api/sales-orders/${encodeURIComponent(orderId)}/fulfillment`);
      setLines(detail.lines || []);
    } catch (reason) {
      setLines([]); setNotice(classify(reason));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (salesOrderId) void loadLines(salesOrderId); }, [salesOrderId, loadLines]);

  const mutate = async (path, body, prefix, successText) => {
    setBusy(true); setError(''); setNotice(null);
    try {
      await api(path, { method: 'POST', headers: { 'Idempotency-Key': key(prefix) }, body });
      notify(successText, 'success'); setNotice({ tone: 'success', title: successText, message: '' });
      await reload();
      if (prefix === 'service-confirm' || prefix === 'service-create') await loadLines(form.orderId);
      return true;
    } catch (reason) {
      const classified = classify(reason);
      setNotice(classified); notify(classified.message, 'error');
      return false;
    } finally { setBusy(false); }
  };

  const selectedLine = lines.find((line) => line.id === form.salesOrderItemId);

  return <BusinessPageShell className="wave8-page" width="rail">
    <header className="wave8-hero"><div><span>SERVICE FULFILLMENT</span><h2>服务履约</h2></div><p>服务确认与实物出库分离；确认后形成不可编辑的履约与财务证据。</p></header>
    {salesOrderId && <InlineAlert tone="info">当前销售订单上下文：<span className="mono">{salesOrderId}</span></InlineAlert>}
    {notice && <InlineAlert tone={notice.tone === 'permission' ? 'warning' : notice.tone === 'conflict' ? 'warning' : 'info'}>
      <strong>{notice.title}</strong>{notice.message ? `：${notice.message}` : ''}
    </InlineAlert>}
    {error && state !== 'ERROR' && <InlineAlert tone="warning">{error}</InlineAlert>}

    {manageable ? <form className="wave8-editor" onSubmit={(event) => { event.preventDefault(); void mutate('/api/service-fulfillments', {
      salesOrderItemId: form.salesOrderItemId,
      confirmationQtyMicros: Math.round(Number(form.quantity) * 1_000_000),
      businessDate: form.businessDate,
    }, 'service-create', '待确认履约已创建'); }}>
      <h3>新建待确认履约</h3>
      <Field label="销售订单">
        <Select value={form.orderId} onChange={(value) => void loadLines(value)} placeholder="选择已审批销售订单">
          {orders.map((order) => <option key={order.id} value={order.id}>{order.order_no} · {order.customerName || order.customer_id}</option>)}
        </Select>
      </Field>
      <Field label="订单行" hint={selectedLine ? `剩余可履约 ${microsLabel((Number(selectedLine.quantityMicros || selectedLine.quantity || 0)) - Number(selectedLine.confirmedMicros || 0))}` : '先选择订单'}>
        <Select value={form.salesOrderItemId} onChange={(value) => setForm({ ...form, salesOrderItemId: value })} placeholder="选择订单行" disabled={!form.orderId}>
          {lines.map((line) => <option key={line.id} value={line.id}>{line.productCode || line.productId || line.product_id} · 行 {line.lineNo || line.line_no}</option>)}
        </Select>
      </Field>
      <Field label="履约数量（基本单位）"><input type="number" min="0.000001" step="0.000001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} required/></Field>
      <Field label="业务日期"><input type="date" value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })} required/></Field>
      <button className="primary" disabled={busy || !form.salesOrderItemId}>新建待确认履约</button>
    </form> : <InlineAlert tone="info">当前角色没有服务履约编辑权限，以下为只读视图。</InlineAlert>}

    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <ErrorPanel error={error} retry={() => void reload()}/>}
    {state === 'READY' && rows.length === 0 && <EmptyState title="暂无服务履约" description="从销售订单上下文新建第一条履约。"/>}
    {state === 'READY' && <div className="wave8-grid">{rows.map((row) => <article className="wave8-card" key={row.id}>
      <div className="wave8-card__head"><strong>{row.fulfillmentNo}</strong><StatusChip status={row.state} domain="lifecycle">{row.state}</StatusChip></div>
      <dl>
        <div><dt>订单行</dt><dd className="mono">{row.salesOrderItemId}</dd></div>
        <div><dt>数量</dt><dd>{microsLabel(row.confirmationQtyMicros)}</dd></div>
        <div><dt>确认金额</dt><dd>{centsLabel(row.recognitionAmountCents)}</dd></div>
        <div><dt>业务日期</dt><dd>{row.businessDate}</dd></div>
        <div><dt>财务确认模式</dt><dd>{row.financeRecognitionMode || '—'}</dd></div>
        <div><dt>确认时间</dt><dd>{row.confirmedAt || '—'}</dd></div>
      </dl>
      {manageable && row.state === 'PENDING' && <div className="wave8-actions">
        <button className="primary" disabled={busy} onClick={() => void mutate(`/api/service-fulfillments/${row.id}/confirm`, { expectedVersion: row.version }, 'service-confirm', '履约已确认')}>确认</button>
        <button className="secondary" disabled={busy} onClick={() => void mutate(`/api/service-fulfillments/${row.id}/cancel`, { expectedVersion: row.version }, 'service-cancel', '履约已取消')}>取消</button>
      </div>}
    </article>)}</div>}
  </BusinessPageShell>;
}

export function ConsignmentCommercial({ user, notify }) {
  const manageable = can(user, 'CONSIGNMENT_MANAGE') && can(user, 'SALES_MANAGE');
  const [documents, setDocuments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [report, setReport] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [state, setState] = useState('LOADING');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState({ locationCode: '', customerId: '', name: '', physicalWarehouseId: '', physicalBinId: '', effectiveFrom: day() });
  const [draft, setDraft] = useState({ customerId: '', sourceWarehouseId: '', businessDate: day(), productId: '', locationId: '', quantity: '', unitPriceCents: '' });
  const [handoff, setHandoff] = useState({});
  const [handoffReference, setHandoffReference] = useState(null);
  const [referenceState, setReferenceState] = useState('IDLE');
  const [lineAction, setLineAction] = useState(null);

  const reload = async () => {
    setState('LOADING'); setError('');
    try {
      const [docs, sites, trace, customers, products] = await Promise.all([
        api('/api/consignment-commercial-documents'), api('/api/consignment-commodity-locations'),
        api('/api/consignment-commercial-report'), api('/api/customers'), api('/api/products'),
      ]);
      setDocuments(docs.documents || []); setLocations(sites.locations || []);
      setReport(trace.rows || []);
      setCustomers(customers.customers || []); setProducts(products.products || []);
      setState('READY');
    } catch (reason) {
      const classified = classify(reason);
      if (classified.tone === 'permission') { setNotice(classified); setDocuments([]); setState('READY'); return; }
      setError(classified.message); setState('ERROR');
    }
  };

  // Reference data is loaded independently: a role that may read consignment but not
  // the warehouse master must still get the page, with only the affected select empty.
  const loadReferences = async () => {
    const mayReadWarehouseMaster = can(user, 'WAREHOUSES_VIEW') || can(user, 'WAREHOUSES_MANAGE');
    const settled = await Promise.allSettled([
      mayReadWarehouseMaster ? api('/api/warehouses') : Promise.resolve({ warehouses: [] }),
      api('/api/customers'), api('/api/products'), api('/api/consignment-commodity-locations'),
    ]);
    const [wh, customers, products, sites] = settled;
    const denied = [];
    if (wh.status === 'fulfilled') setWarehouses(wh.value.warehouses || []);
    else denied.push('仓库');
    if (customers.status === 'fulfilled') setCustomers(customers.value.customers || []);
    if (products.status === 'fulfilled') setProducts(products.value.products || []);
    if (sites.status === 'fulfilled') setLocations(sites.value.locations || []);
    if (denied.length) {
      setNotice({ tone: 'permission', title: '缺少参考数据权限', message: `${denied.join('、')}主数据不可读，相关选择器为空` });
    }
  };
  useEffect(() => { void reload(); void loadReferences(); }, []);

  const post = async (path, body, prefix, successText) => {
    setBusy(true); setError(''); setNotice(null);
    try {
      const value = await api(path, { method: 'POST', headers: { 'Idempotency-Key': key(prefix) }, body });
      notify(successText, 'success'); setNotice({ tone: 'success', title: successText, message: '' });
      await reload();
      return value;
    } catch (reason) {
      const classified = classify(reason);
      setNotice(classified); notify(classified.message, 'error');
      return null;
    } finally { setBusy(false); }
  };

  const openDocument = async (id) => {
    setNotice(null); setHandoffReference(null); setReferenceState('LOADING');
    try {
      const data = await api(`/api/consignment-commercial-documents/${id}`);
      setSelected(data.document); setLineAction(null);
      if (manageable && data.document.status === 'DRAFT') {
        const reference = await api(`/api/consignment-commercial-documents/${id}/handoff-position-references`);
        setHandoffReference(reference);
        setHandoff(Object.fromEntries((data.document.lines || []).map((line) => [line.id, {
          warehouseId: reference.warehouse.id, binId: '', quantity: '',
        }])));
      }
      setReferenceState('READY');
    }
    catch (reason) { setReferenceState('ERROR'); setNotice(classify(reason)); }
  };

  const openLineAction = async (line, action) => {
    if (action === 'settle') { setLineAction({ line, action, quantity: '' }); return; }
    setReferenceState('LOADING'); setNotice(null); setLineAction(null);
    try {
      const references = await api(`/api/consignment-commercial-documents/${selected.id}/lines/${line.id}/return-position-references`);
      setLineAction({ line, action, quantity: '', destinationWarehouseId: '', destinationBinId: '', references });
      setReferenceState('READY');
    } catch (reason) {
      setReferenceState('ERROR'); setNotice(classify(reason));
    }
  };

  const submitHandoff = async (document_) => {
    const allocations = document_.lines.map((line) => ({
      lineId: line.id,
      quantityMicros: Math.round(Number(handoff[line.id]?.quantity || 0) * 1_000_000),
      fromPosition: {
        productId: line.product_id, warehouseId: handoff[line.id]?.warehouseId || '',
        binId: handoff[line.id]?.binId || null, ownerType: 'ENTERPRISE', ownerId: null,
        stockStatus: 'AVAILABLE', lotId: line.lot_code_key || null, serialId: handoff[line.id]?.serialId || null,
      },
    }));
    if (allocations.some((row) => row.quantityMicros <= 0 || !row.fromPosition.warehouseId
      || (handoffReference?.warehouse?.binEnabled && !row.fromPosition.binId))) {
      setNotice({ tone: 'invalid', title: '请为每一行选择来源仓库并填写数量', message: '' }); return;
    }
    const value = await post(`/api/consignment-commercial-documents/${document_.id}/instruct`,
      { expectedVersion: Number(document_.version), businessDate: day(), allocations }, 'consignment-handoff', 'Handoff 已执行');
    if (value) await openDocument(document_.id);
  };

  const submitLineAction = async () => {
    if (!lineAction) return;
    const { line, action } = lineAction;
    const body = { quantityMicros: Math.round(Number(lineAction.quantity || 0) * 1_000_000), expectedVersion: Number(line.version), businessDate: day() };
    if (action === 'return') { body.destinationWarehouseId = lineAction.destinationWarehouseId || ''; body.destinationBinId = lineAction.destinationBinId || null; }
    const value = await post(`/api/consignment-commercial-lines/${line.id}/${action}`, body, `consignment-${action}`, action === 'settle' ? '结算已完成' : '退回已完成');
    setLineAction(null); setReferenceState('IDLE');
    if (value && selected) await openDocument(selected.id);
  };

  return <BusinessPageShell className="wave8-page" width="rail">
    <header className="wave8-hero"><div><span>CONSIGNMENT</span><h2>寄售业务</h2></div><p>商业地点、企业所有库存与结算事实三层分离；执行只采用 Handoff 历史证据。</p></header>
    {notice && <InlineAlert tone={['permission', 'conflict', 'invalid'].includes(notice.tone) ? 'warning' : 'info'}>
      <strong>{notice.title}</strong>{notice.message ? `：${notice.message}` : ''}
    </InlineAlert>}
    {error && state !== 'ERROR' && <InlineAlert tone="warning">{error}</InlineAlert>}

    {manageable ? <details className="wave8-compose"><summary>新建寄售地点或指令</summary><div className="wave8-compose__grid">
      <form className="wave8-editor" onSubmit={(event) => { event.preventDefault(); void post('/api/consignment-commodity-locations',
        { ...location, physicalBinId: location.physicalBinId || null }, 'consignment-location', '地点已创建').then((value) => { if (value) setLocation({ ...location, locationCode: '', name: '' }); }); }}>
        <h3>寄售地点</h3>
        <Field label="地点编码"><input value={location.locationCode} onChange={(event) => setLocation({ ...location, locationCode: event.target.value })} required/></Field>
        <Field label="客户"><Select value={location.customerId} onChange={(value) => setLocation({ ...location, customerId: value })}>
          {customers.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
        </Select></Field>
        <Field label="名称"><input value={location.name} onChange={(event) => setLocation({ ...location, name: event.target.value })} required/></Field>
        <Field label="映射仓库"><Select value={location.physicalWarehouseId} onChange={(value) => setLocation({ ...location, physicalWarehouseId: value })}>
          {warehouses.filter((row) => row.active !== 0).map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
        </Select></Field>
        <Field label="映射仓位 ID" hint="未启用仓位的仓库可留空"><input value={location.physicalBinId} onChange={(event) => setLocation({ ...location, physicalBinId: event.target.value })}/></Field>
        <Field label="生效日期"><input type="date" value={location.effectiveFrom} onChange={(event) => setLocation({ ...location, effectiveFrom: event.target.value })}/></Field>
        <button className="primary" disabled={busy}>创建地点</button>
      </form>
      <form className="wave8-editor" onSubmit={(event) => { event.preventDefault(); void post('/api/consignment-commercial-documents', {
        customerId: draft.customerId, sourceWarehouseId: draft.sourceWarehouseId, businessDate: draft.businessDate, currencyCode: 'CNY',
        lines: [{ productId: draft.productId, consignmentCommodityLocationId: draft.locationId,
          consignedQtyMicros: Math.round(Number(draft.quantity || 0) * 1_000_000), unitPriceCents: Number(draft.unitPriceCents || 0) }],
      }, 'consignment-create', '寄售指令草稿已创建').then((value) => { if (value) void openDocument(value.id); }); }}>
        <h3>寄售指令</h3>
        <Field label="客户"><Select value={draft.customerId} onChange={(value) => setDraft({ ...draft, customerId: value })}>
          {customers.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
        </Select></Field>
        <Field label="来源仓库"><Select value={draft.sourceWarehouseId} onChange={(value) => setDraft({ ...draft, sourceWarehouseId: value })}>
          {warehouses.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
        </Select></Field>
        <Field label="商业地点"><Select value={draft.locationId} onChange={(value) => setDraft({ ...draft, locationId: value })} placeholder="选择寄售地点">
          {locations.filter((row) => !draft.customerId || row.customer_id === draft.customerId).map((row) => <option key={row.id} value={row.id}>{row.location_code} · {row.name}</option>)}
        </Select></Field>
        <Field label="产品"><Select value={draft.productId} onChange={(value) => setDraft({ ...draft, productId: value })}>
          {products.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
        </Select></Field>
        <Field label="寄售数量（基本单位）"><input type="number" min="0.000001" step="0.000001" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} required/></Field>
        <Field label="单价（分）"><input type="number" min="0" step="1" value={draft.unitPriceCents} onChange={(event) => setDraft({ ...draft, unitPriceCents: event.target.value })} required/></Field>
        <Field label="业务日期"><input type="date" value={draft.businessDate} onChange={(event) => setDraft({ ...draft, businessDate: event.target.value })} required/></Field>
        <button className="primary" disabled={busy || !draft.locationId || !draft.productId}>创建草稿</button>
      </form>
    </div></details> : <InlineAlert tone="info">当前角色没有寄售编辑权限，以下为只读视图。</InlineAlert>}

    {state === 'LOADING' && <Loading/>}
    {state === 'ERROR' && <ErrorPanel error={error} retry={() => void reload()}/>}
    {state === 'READY' && documents.length === 0 && <EmptyState title="暂无寄售指令"/>}
    {state === 'READY' && <div className="wave8-grid">{documents.map((row) => <button type="button" className="wave8-card wave8-card--button" key={row.id} onClick={() => void openDocument(row.id)}>
      <div className="wave8-card__head"><strong>{row.document_no}</strong><StatusChip status={row.status} domain="lifecycle">{row.status}</StatusChip></div>
      <span>{row.business_date}</span><span className="mono">{row.customer_id}</span>
    </button>)}</div>}

    {selected && <section className="wave8-detail">
      <div className="wave8-card__head"><h3>{selected.document_no}</h3><div className="wave8-actions">
        {manageable && selected.status === 'DRAFT' && <>
          <button className="primary" disabled={busy} onClick={() => void submitHandoff(selected)}>执行 Handoff</button>
          <button className="secondary" disabled={busy} onClick={async () => { const value = await post(`/api/consignment-commercial-documents/${selected.id}/cancel`, { expectedVersion: Number(selected.version) }, 'consignment-cancel', '草稿已取消'); if (value) setSelected(null); }}>取消草稿</button>
        </>}
        <button className="secondary" onClick={() => setSelected(null)}>关闭</button>
      </div></div>
      {manageable && selected.status === 'DRAFT' && referenceState === 'LOADING' && <Loading/>}
      {manageable && selected.status === 'DRAFT' && handoffReference && <div className="wave8-handoff">
        <h4>Handoff 来源分配</h4>
        {selected.lines?.map((line) => <div className="wave8-handoff__row" key={line.id}>
          <strong className="mono">{line.product_id}</strong>
          <span>{handoffReference.warehouse.code} · {handoffReference.warehouse.name}</span>
          {handoffReference.warehouse.binEnabled
            ? <Select required value={handoff[line.id]?.binId || ''} placeholder="选择来源仓位" onChange={(value) => setHandoff({ ...handoff, [line.id]: { ...handoff[line.id], binId: value } })}>
              {handoffReference.bins.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </Select>
            : <span>该仓库未启用仓位</span>}
          <input type="number" min="0" step="0.000001" placeholder={`数量（${microsLabel(line.consigned_qty_micros)}）`} value={handoff[line.id]?.quantity || ''} onChange={(event) => setHandoff({ ...handoff, [line.id]: { ...handoff[line.id], quantity: event.target.value } })}/>
        </div>)}
      </div>}
      {selected.lines?.map((line) => <article key={line.id} className="wave8-line">
        <strong className="mono">{line.product_id}</strong>
        <span>寄售 {microsLabel(line.consigned_qty_micros)}</span>
        <span>结算 {microsLabel(line.settled_qty_micros)}</span>
        <span>退回 {microsLabel(line.returned_qty_micros)}</span>
        <span>单价 {centsLabel(line.unit_price_cents)}</span>
        <span>历史分区 {line.partitions?.length || 0}</span>
        {line.partitions?.map((partition) => <span className="mono" key={partition.positionKey}>
          {partition.position.warehouseId}{partition.position.binId ? ` / ${partition.position.binId}` : ''} · 剩余 {microsLabel(partition.remainingMicros)}
        </span>)}
        {manageable && line.handoff_movement_group_id && <div className="wave8-actions">
          <button className="primary" onClick={() => void openLineAction(line, 'settle')}>结算</button>
          <button className="secondary" onClick={() => void openLineAction(line, 'return')}>退回</button>
        </div>}
      </article>)}
      {lineAction && <form className="wave8-editor" onSubmit={(event) => { event.preventDefault(); void submitLineAction(); }}>
        <h4>{lineAction.action === 'settle' ? '结算' : '退回'} · <span className="mono">{lineAction.line.product_id}</span></h4>
        <Field label="数量（基本单位）" hint={`剩余 ${microsLabel(Number(lineAction.line.consigned_qty_micros) - Number(lineAction.line.settled_qty_micros) - Number(lineAction.line.returned_qty_micros))}`}>
          <input type="number" min="0.000001" step="0.000001" value={lineAction.quantity} onChange={(event) => setLineAction({ ...lineAction, quantity: event.target.value })} required/>
        </Field>
        {lineAction.action === 'return' && <>
          <Field label="退回目标仓库"><Select required value={lineAction.destinationWarehouseId} onChange={(value) => setLineAction({ ...lineAction, destinationWarehouseId: value, destinationBinId: '' })}>
            {(lineAction.references?.warehouses || []).map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
          </Select></Field>
          {(() => {
            const warehouse = lineAction.references?.warehouses?.find((row) => row.id === lineAction.destinationWarehouseId);
            return warehouse?.binEnabled
              ? <Field label="退回目标仓位"><Select required value={lineAction.destinationBinId} onChange={(value) => setLineAction({ ...lineAction, destinationBinId: value })}>
                {warehouse.bins.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
              </Select></Field>
              : warehouse ? <Field label="退回目标仓位"><span>该仓库未启用仓位</span></Field> : null;
          })()}
        </>}
        <div className="wave8-actions">
          <button className="primary" disabled={busy || !Number(lineAction.quantity) || (lineAction.action === 'return' && (!lineAction.destinationWarehouseId || (lineAction.references?.warehouses?.find((row) => row.id === lineAction.destinationWarehouseId)?.binEnabled && !lineAction.destinationBinId)))}>确认{lineAction.action === 'settle' ? '结算' : '退回'}</button>
          <button type="button" className="secondary" onClick={() => setLineAction(null)}>取消</button>
        </div>
      </form>}
    </section>}

    <section className="wave8-report"><h3>三层追溯</h3>
      {report.length === 0 && <EmptyState title="暂无追溯记录"/>}
      {report.map((row) => <article key={row.lineId}>
        <span>{row.documentNo}</span><strong>{row.ownership}</strong>
        <span>商业剩余 {microsLabel(row.commercialRemainingMicros)}</span>
        <span>分区剩余 {microsLabel(row.partitionEntitlementMicros)}</span>
        <span>物理证据 {row.physicalEvidenceState}{row.physicalEvidenceDiscrepancy ? ` · ${row.physicalEvidenceDiscrepancy}` : ''}</span>
        <span>财务 {row.financeReferenceId || '尚未结算'}</span>
      </article>)}
    </section>
  </BusinessPageShell>;
}
