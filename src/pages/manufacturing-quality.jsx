import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, FormActions, Modal, Status, can, quantity } from '../components/ui.jsx';
import { BusinessAction, BusinessPageHeader, BusinessPageShell, CompactRecordList, RecordCard } from '../components/design-system.jsx';

const today = () => new Date().toISOString().slice(0, 10);

// Controlled inspection-kind vocabulary (Requirement §29.8 A.1).
const INSPECTION_TYPES = [
  { value: 'NORMAL', label: '常规检验' },
  { value: 'SAMPLING', label: '抽样检验' },
  { value: 'FULL', label: '全检' },
  { value: 'FIRST_ARTICLE', label: '首件检验' },
  { value: 'PATROL', label: '巡检' },
  { value: 'FINAL', label: '终检' },
  { value: 'REGRESSION', label: '回归检验' },
  { value: 'REWORK', label: '返工检验' },
];

const INSPECTION_TYPE_LABELS = INSPECTION_TYPES.reduce((acc, entry) => ({ ...acc, [entry.value]: entry.label }), {});

const SOURCE_TYPE_OPTIONS = [
  { value: 'OPERATION_REPORT', label: '工序报工' },
  { value: 'PRODUCTION_RECEIPT', label: '生产入库' },
];

const SOURCE_TYPE_LABELS = { OPERATION_REPORT: '工序报工', PRODUCTION_RECEIPT: '生产入库' };

const INSPECTION_STATUS_LABELS = { DRAFT: '待判定', COMPLETED: '已判定', CANCELLED: '已取消' };

const RESULT_LABELS = { PASS: '合格', FAIL: '不合格', WAIVED: '已放行' };

export function ProductionQuality({ user, notify }) {
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [pending, setPending] = useState([]);
  const [orders, setOrders] = useState([]);
  const [plans, setPlans] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [waiving, setWaiving] = useState(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [form, setForm] = useState({ productionOrderId: '', sourceType: 'OPERATION_REPORT', sourceId: '', planId: '', inspectionType: 'NORMAL', businessDate: today() });
  const canManage = can(user, 'PRODUCTION_INSPECTION_MANAGE');
  const load = () => api('/api/production-inspections').then((r) => setItems(r.inspections || [])).catch((e) => notify(e.message, 'error'));
  const loadPending = () => api('/api/production-inspections/pending').then((r) => setPending(r.inspections || [])).catch(() => setPending([]));
  useEffect(() => { void load(); void loadPending(); }, []);
  useEffect(() => {
    api('/api/production-orders').then((r) => setOrders(r.orders || [])).catch(() => setOrders([]));
    api('/api/inspection-plans').then((r) => setPlans(r.plans || [])).catch(() => setPlans([]));
  }, []);
  const open = (id) => api(`/api/production-inspections/${id}`).then((r) => setSelected(r.inspection)).catch((e) => notify(e.message, 'error'));
  const create = async (event) => {
    event.preventDefault();
    try { const result = await api('/api/production-inspections', { method: 'POST', body: form }); setCreating(false); await open(result.id); await load(); await loadPending(); }
    catch (e) { notify(e.message, 'error'); }
  };
  const finish = async (result) => {
    try {
      const resultItems = (selected.items || []).map((item) => ({ id: item.id, ...(item.result_type === 'NUMERIC' ? { numericResult: item.min_value ?? item.max_value ?? 0 } : item.result_type === 'TEXT' ? { textResult: result === 'PASS' ? '合格' : '不合格' } : { passFailResult: result }) }));
      await api(`/api/production-inspections/${selected.id}/complete`, { method: 'POST', body: { result, items: resultItems } });
      notify(result === 'PASS' ? '检验已通过' : '检验已判定不合格'); setSelected(null); await load(); await loadPending();
    } catch (e) { notify(e.message, 'error'); }
  };
  const waive = async () => {
    if (!waiveReason.trim()) { notify('放行必须填写原因', 'error'); return; }
    try {
      await api(`/api/production-inspections/${waiving.id}/waive`, { method: 'POST', body: { reason: waiveReason.trim() } });
      notify('检验已放行'); setWaiving(null); setWaiveReason(''); setSelected(null); await load(); await loadPending();
    } catch (e) { notify(e.message, 'error'); }
  };
  // The source document list is derived from real server data, never a bare ID
  // text box (Requirement §29.8 A.2 judgement criterion 1). The list endpoints
  // do not filter by order, so the order filter is applied on the client.
  const [sourceOptions, setSourceOptions] = useState([]);
  useEffect(() => {
    if (!form.productionOrderId) { setSourceOptions([]); return; }
    const path = form.sourceType === 'PRODUCTION_RECEIPT' ? '/api/production-receipts?status=' : '/api/production-material-issues?status=';
    const reader = form.sourceType === 'PRODUCTION_RECEIPT'
      ? (r) => (r.productionReceipts || []).filter((receipt) => String(receipt.productionOrderId ?? receipt.production_order_id ?? '') === String(form.productionOrderId)).map((receipt) => ({ id: receipt.id, label: `${receipt.receiptNo} · ${quantity(receipt.quantity)}` }))
      : (r) => (r.materialIssues || []).filter((issue) => String(issue.productionOrderId ?? issue.production_order_id ?? '') === String(form.productionOrderId)).map((issue) => ({ id: issue.id, label: `${issue.issueNo} · ${issue.issueDate || issue.issue_date || ''}` }));
    api(path).then((r) => setSourceOptions(reader(r))).catch(() => setSourceOptions([]));
  }, [form.productionOrderId, form.sourceType]);
  const visibleItems = tab === 'pending' ? pending : items;
  return <BusinessPageShell className="mq-workspace" width="rail">
    <BusinessPageHeader title="生产质量" primaryAction={canManage && <BusinessAction hierarchy="primary" onClick={() => setCreating(true)}>新建检验</BusinessAction>}/>
    <div className="segmented-control" role="tablist">
      <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>检验单</button>
      <button type="button" className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>待检</button>
    </div>
    <CompactRecordList>{visibleItems.map((item) => <RecordCard key={item.id} title={item.code} subtitle={`${item.productionOrderNo || ''} · ${SOURCE_TYPE_LABELS[item.source_type] || item.source_type || ''}`} status={<Status status={(item.result || item.status || 'DRAFT').toLowerCase()} label={item.result ? RESULT_LABELS[item.result] || item.result : INSPECTION_STATUS_LABELS[item.status] || item.status}/>} facts={[{ label: '业务日期', value: item.business_date || item.businessDate }, { label: '检验类型', value: INSPECTION_TYPE_LABELS[item.inspection_type || item.inspectionType] || item.inspection_type || item.inspectionType || 'NORMAL' }, { label: '结果', value: item.result ? (RESULT_LABELS[item.result] || item.result) : '待检验' }]} onClick={() => open(item.id)}/>)}</CompactRecordList>
    {!visibleItems.length && <Empty text={tab === 'pending' ? '暂无待检任务' : '暂无生产检验任务'}/>}
    {creating && <Modal title="新建生产检验" onClose={() => setCreating(false)}><form className="form-grid" onSubmit={create}>
      <label>生产工单<select value={form.productionOrderId} onChange={(e) => setForm({ ...form, productionOrderId: e.target.value, sourceId: '' })} required><option value="">选择生产工单</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.order_no} · {order.productName || order.productCode || ''}</option>)}</select></label>
      <label>检验类型<select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value, sourceId: '' })}>{SOURCE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>来源单据<select value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })} required disabled={!form.productionOrderId}><option value="">选择来源单据</option>{sourceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label>检验方案<select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}><option value="">不使用检验方案</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.code} · {plan.name}</option>)}</select></label>
      <label>检验类别<select value={form.inspectionType} onChange={(e) => setForm({ ...form, inspectionType: e.target.value })}>{INSPECTION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} required/></label>
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setCreating(false)}>取消</button><button className="primary">创建检验</button></div>
    </form></Modal>}
    {selected && <Modal title={selected.code} onClose={() => setSelected(null)} wide><div className="mq-detail-head"><Status status={(selected.result || selected.status || 'DRAFT').toLowerCase()} label={selected.result ? RESULT_LABELS[selected.result] || selected.result : INSPECTION_STATUS_LABELS[selected.status] || selected.status}/><strong>{selected.productionOrderNo}</strong><span>{SOURCE_TYPE_LABELS[selected.source_type] || selected.source_type} · {INSPECTION_TYPE_LABELS[selected.inspection_type] || selected.inspection_type || 'NORMAL'}</span></div>
      <div className="mq-criteria">{(selected.items || []).map((item) => <div key={item.id}><strong>{item.criterion_name}</strong><span>{item.specification || '无额外规格'}</span><small>{item.result_type}</small></div>)}</div>
      {selected.status === 'DRAFT' && <div className="form-actions">
        {canManage && <button className="danger-button" onClick={() => finish('FAIL')}>判定不合格</button>}
        {canManage && <button className="primary" onClick={() => finish('PASS')}>检验通过</button>}
        {canManage && <button className="secondary" onClick={() => setWaiving(selected)}>放行</button>}
      </div>}
    </Modal>}
    {waiving && <Modal title="检验放行" onClose={() => { setWaiving(null); setWaiveReason(''); }}><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void waive(); }}>
      <label className="full">放行原因<textarea rows={3} value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} required placeholder="请填写放行原因"/></label>
      <FormActions onClose={() => { setWaiving(null); setWaiveReason(''); }} saveText="确认放行"/>
    </form></Modal>}
  </BusinessPageShell>;
}

export function QualityConfiguration({ user, notify }) {
  const [tab, setTab] = useState('items');
  const [data, setData] = useState({ items: [], instruments: [], plans: [], detectionValues: [] });
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', category: '', unit: '', specification: '', targetType: 'PRODUCT', productId: '', items: [] });
  const [detectionItemId, setDetectionItemId] = useState('');
  const [detectionForm, setDetectionForm] = useState({ itemId: '', label: '', value: '' });
  const canManage = can(user, 'PRODUCTION_QUALITY_CONFIG_MANAGE');
  const endpoints = { items: '/api/inspection-items', instruments: '/api/inspection-instruments', plans: '/api/inspection-plans' };
  const load = () => Promise.all(Object.entries(endpoints).map(([key, endpoint]) => api(endpoint).then((r) => [key, r[key] || []]))).then((entries) => setData((prev) => ({ ...prev, ...Object.fromEntries(entries) }))).catch((e) => notify(e.message, 'error'));
  useEffect(() => { void load(); api('/api/products').then((r) => setProducts(r.products || [])).catch(() => setProducts([])); }, []);
  useEffect(() => {
    if (!detectionItemId) { setData((prev) => ({ ...prev, detectionValues: [] })); return; }
    api(`/api/inspection-detection-values?itemId=${encodeURIComponent(detectionItemId)}`)
      .then((r) => setData((prev) => ({ ...prev, detectionValues: r.values || [] })))
      .catch(() => setData((prev) => ({ ...prev, detectionValues: [] })));
  }, [detectionItemId]);
  const setPlanItems = (items) => setForm((f) => ({ ...f, items }));
  const addPlanItem = () => setPlanItems([...form.items, { itemId: '', criterionName: '', specification: '', minValue: '', maxValue: '', unit: '', instrumentId: '' }]);
  const updatePlanItem = (index, field, value) => setPlanItems(form.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  const removePlanItem = (index) => setPlanItems(form.items.filter((_, i) => i !== index));
  const save = async (event) => {
    event.preventDefault();
    try {
      if (tab === 'plans') {
        const body = {
          code: form.code,
          name: form.name,
          targetType: form.targetType,
          targetId: form.targetId || null,
          productId: form.productId || null,
          items: form.items.map((item, index) => ({
            sequence: index + 1,
            itemId: item.itemId,
            criterionName: item.criterionName,
            specification: item.specification || '',
            minValue: item.minValue === '' || item.minValue === null ? null : Number(item.minValue),
            maxValue: item.maxValue === '' || item.maxValue === null ? null : Number(item.maxValue),
            unit: item.unit || '',
            instrumentId: item.instrumentId || null,
            required: true,
          })),
        };
        await api('/api/inspection-plans', { method: 'POST', body });
      } else {
        await api(endpoints[tab], { method: 'POST', body: form });
      }
      setEditing(false);
      setForm({ code: '', name: '', category: '', unit: '', specification: '', targetType: 'PRODUCT', productId: '', items: [] });
      await load();
    } catch (e) { notify(e.message, 'error'); }
  };
  const saveDetectionValue = async (event) => {
    event.preventDefault();
    try {
      await api('/api/inspection-detection-values', { method: 'POST', body: { itemId: detectionForm.itemId || detectionItemId, label: detectionForm.label, value: detectionForm.value } });
      notify('检测值已保存');
      setDetectionForm({ itemId: detectionItemId, label: '', value: '' });
      await load();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <BusinessPageShell className="mq-workspace" width="rail"><BusinessPageHeader title="质量配置" primaryAction={canManage && tab !== 'detection' && <BusinessAction hierarchy="primary" onClick={() => setEditing(true)}>新建</BusinessAction>}/>
    <div className="segmented-control" role="tablist">
      <button type="button" className={tab === 'items' ? 'active' : ''} onClick={() => setTab('items')}>检验项目</button>
      <button type="button" className={tab === 'instruments' ? 'active' : ''} onClick={() => setTab('instruments')}>检验仪器</button>
      <button type="button" className={tab === 'plans' ? 'active' : ''} onClick={() => setTab('plans')}>检验方案</button>
      <button type="button" className={tab === 'detection' ? 'active' : ''} onClick={() => setTab('detection')}>检测值</button>
    </div>
    {tab === 'detection' ? <div className="mq-detection">
      <label className="mq-detection__picker">检验项目<select value={detectionItemId} onChange={(e) => { setDetectionItemId(e.target.value); setDetectionForm((f) => ({ ...f, itemId: e.target.value })); }}><option value="">选择检验项目</option>{data.items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
      <CompactRecordList>{data.detectionValues.map((value) => <RecordCard key={value.id} title={value.label || value.name || '检测值'} subtitle={value.value == null ? '' : String(value.value)} facts={[{ label: '检验项目', value: value.itemCode || value.itemName || value.itemId || '—' }, { label: '检测值', value: value.value == null ? '—' : String(value.value) }]}/>)}</CompactRecordList>
      {!data.detectionValues.length && <Empty text="暂无检测值"/>}
      {canManage && <form className="form-grid" onSubmit={saveDetectionValue}>
        <label>检验项目<select value={detectionForm.itemId || detectionItemId} onChange={(e) => setDetectionForm({ ...detectionForm, itemId: e.target.value })} required><option value="">选择检验项目</option>{data.items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>检测值名称<input value={detectionForm.label} onChange={(e) => setDetectionForm({ ...detectionForm, label: e.target.value })} required/></label>
        <label>检测值<input value={detectionForm.value} onChange={(e) => setDetectionForm({ ...detectionForm, value: e.target.value })} required/></label>
        <div className="form-actions"><button className="primary">保存检测值</button></div>
      </form>}
    </div> : <>
      <CompactRecordList>{data[tab].map((item) => <RecordCard key={item.id} title={`${item.code} · ${item.name}`} subtitle={item.category || item.specification || item.target_type || '—'} status={<Status status={item.active ? 'ACTIVE' : 'INACTIVE'}/>}/>)}</CompactRecordList>
      {!data[tab].length && <Empty text="暂无配置"/>}
    </>}
    {editing && <Modal title={tab === 'plans' ? '新建检验方案' : '新建质量配置'} onClose={() => setEditing(false)} wide><form className="form-grid" onSubmit={save}>
      <label>编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required/></label>
      <label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>
      {tab === 'items' && <><label>分类<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}/></label><label>单位<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}/></label></>}
      {tab === 'instruments' && <label>规格<input value={form.specification} onChange={(e) => setForm({ ...form, specification: e.target.value })}/></label>}
      {tab === 'plans' && <>
        <label>目标类型<select value={form.targetType} onChange={(e) => setForm({ ...form, targetType: e.target.value })}><option value="PRODUCT">产品</option><option value="MATERIAL">物料</option></select></label>
        <label>关联产品<select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}><option value="">不关联产品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}</select></label>
        <div className="full"><div className="form-section-head"><span>检验项目明细</span><button type="button" className="secondary" onClick={addPlanItem}>＋ 增行</button></div>
          <div className="mq-line-editor">
            {form.items.map((item, index) => <div key={index} className="mq-line-editor__row mq-line-editor__row--block">
              <label>检验项目<select value={item.itemId} onChange={(e) => updatePlanItem(index, 'itemId', e.target.value)} required><option value="">选择检验项目</option>{data.items.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}</select></label>
              <label>检验准则<input value={item.criterionName} onChange={(e) => updatePlanItem(index, 'criterionName', e.target.value)} required/></label>
              <label>标准<input value={item.specification} onChange={(e) => updatePlanItem(index, 'specification', e.target.value)}/></label>
              <label>下限<input type="number" step="0.001" value={item.minValue} onChange={(e) => updatePlanItem(index, 'minValue', e.target.value)}/></label>
              <label>上限<input type="number" step="0.001" value={item.maxValue} onChange={(e) => updatePlanItem(index, 'maxValue', e.target.value)}/></label>
              <label>单位<input value={item.unit} onChange={(e) => updatePlanItem(index, 'unit', e.target.value)}/></label>
              <label>仪器<select value={item.instrumentId} onChange={(e) => updatePlanItem(index, 'instrumentId', e.target.value)}><option value="">不指定仪器</option>{data.instruments.map((option) => <option key={option.id} value={option.id}>{option.code} · {option.name}</option>)}</select></label>
              <button type="button" className="danger-text" onClick={() => removePlanItem(index)}>x</button>
            </div>)}
            {!form.items.length && <p className="hint">点击「＋ 增行」添加检验项目明细。</p>}
          </div>
        </div>
      </>}
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>取消</button><button className="primary">保存</button></div>
    </form></Modal>}
  </BusinessPageShell>;
}

export function ProductionScan({ notify }) {
  const [mode, setMode] = useState('material');
  const [orderToken, setOrderToken] = useState('');
  const [order, setOrder] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({ requirementLineId: '', warehouseId: '', identity: '', quantity: 1, operationToken: '', goodQuantity: 1, scrapQuantity: 0, laborSeconds: 0, machineSeconds: 0, sourceOperationToken: '', targetOperationToken: '', transferQuantity: 1 });
  useEffect(() => { api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch(() => setWarehouses([])); }, []);
  const lookup = async (event) => { event.preventDefault(); try { const found = await api('/api/production-scan/lookup', { method: 'POST', body: { kind: 'ORDER', token: orderToken } }); const detail = await api(`/api/production-orders/${found.order.id}`); setOrder(detail.order); } catch (e) { setOrder(null); notify(e.message, 'error'); } };
  const execute = async (event) => {
    event.preventDefault();
    try {
      if (mode === 'material') {
        const result = await api('/api/production-scan/issue', { method: 'POST', body: { orderToken, requirementLineId: form.requirementLineId, warehouseId: form.warehouseId, identity: form.identity, quantity: Number(form.quantity) } });
        notify(`${result.issueNo || result.reportNo} 已创建为草稿`);
        return;
      }
      if (mode === 'operation') {
        const result = await api('/api/production-scan/report', { method: 'POST', body: { orderToken, operationToken: form.operationToken, goodQuantity: Number(form.goodQuantity), scrapQuantity: Number(form.scrapQuantity), laborSeconds: Number(form.laborSeconds), machineSeconds: Number(form.machineSeconds) } });
        notify(`${result.issueNo || result.reportNo} 已创建为草稿`);
        return;
      }
      const result = await api('/api/production-scan/transfer', { method: 'POST', body: { orderToken, sourceOperationToken: form.sourceOperationToken, targetOperationToken: form.targetOperationToken, quantity: Number(form.transferQuantity) } });
      notify(`工序转移单 ${result.transferNo || ''} 已创建`);
    } catch (e) { notify(e.message, 'error'); }
  };
  const operations = order?.operationPlan || [];
  const operationOptions = useMemo(() => operations.map((op) => ({ id: op.id, token: op.operationCode || op.operation_code || op.id, label: `${op.sequence_no} · ${op.operationName || op.operation_name || op.operationCode || op.operation_code}` })), [operations]);
  return <BusinessPageShell className="mq-workspace production-scan" width="rail"><BusinessPageHeader title="生产扫码"/>
    <form className="scan-lookup" onSubmit={lookup}><label>生产工单号<input autoFocus inputMode="text" value={orderToken} onChange={(e) => setOrderToken(e.target.value)} placeholder="扫描或输入工单号" required/></label><button className="primary">识别工单</button></form>
    {order ? <><div className="scan-order"><strong>{order.order_no}</strong><Status status={order.status}/><span>{order.productCode} · {quantity(order.quantity)}</span></div>
      <div className="segmented-control">
        <button type="button" className={mode === 'material' ? 'active' : ''} onClick={() => setMode('material')}>物料</button>
        <button type="button" className={mode === 'operation' ? 'active' : ''} onClick={() => setMode('operation')}>工序</button>
        <button type="button" className={mode === 'transfer' ? 'active' : ''} onClick={() => setMode('transfer')}>转移</button>
      </div>
      <form className="form-grid scan-action" onSubmit={execute}>
      {mode === 'material' ? <><label>需求物料<select value={form.requirementLineId} onChange={(e) => setForm({ ...form, requirementLineId: e.target.value })} required><option value="">选择物料</option>{(order.items || []).map((item) => <option key={item.id} value={item.id}>{item.productCode} · 待领 {quantity(item.remainingQuantity)}</option>)}</select></label><label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>LOT / SERIAL<input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} placeholder="可选扫描"/></label><label>数量<input type="number" min="0.001" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required/></label></> : null}
      {mode === 'operation' ? <><label>工序<select value={form.operationToken} onChange={(e) => setForm({ ...form, operationToken: e.target.value })} required><option value="">选择工序</option>{operationOptions.map((op) => <option key={op.id} value={op.token}>{op.label}</option>)}</select></label><label>良品数量<input type="number" min="0" step="0.001" value={form.goodQuantity} onChange={(e) => setForm({ ...form, goodQuantity: e.target.value })}/></label><label>报废数量<input type="number" min="0" step="0.001" value={form.scrapQuantity} onChange={(e) => setForm({ ...form, scrapQuantity: e.target.value })}/></label><label>人工秒<input type="number" min="0" value={form.laborSeconds} onChange={(e) => setForm({ ...form, laborSeconds: e.target.value })}/></label><label>设备秒<input type="number" min="0" value={form.machineSeconds} onChange={(e) => setForm({ ...form, machineSeconds: e.target.value })}/></label></> : null}
      {mode === 'transfer' ? <><label>源工序<select value={form.sourceOperationToken} onChange={(e) => setForm({ ...form, sourceOperationToken: e.target.value })} required><option value="">选择源工序</option>{operationOptions.map((op) => <option key={op.id} value={op.token}>{op.label}</option>)}</select></label><label>目标工序<select value={form.targetOperationToken} onChange={(e) => setForm({ ...form, targetOperationToken: e.target.value })} required><option value="">选择目标工序</option>{operationOptions.map((op) => <option key={op.id} value={op.token}>{op.label}</option>)}</select></label><label>转移数量<input type="number" min="0.001" step="0.001" value={form.transferQuantity} onChange={(e) => setForm({ ...form, transferQuantity: e.target.value })} required/></label></> : null}
      <div className="form-actions"><button className="primary">创建{mode === 'material' ? '领料' : mode === 'operation' ? '报工' : '工序转移'}草稿</button></div>
    </form></> : <Empty text="先扫描生产工单"/>}
  </BusinessPageShell>;
}
