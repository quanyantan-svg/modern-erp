import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Empty, Modal, Status, quantity } from '../components/ui.jsx';
import { BusinessAction, BusinessPageHeader, BusinessPageShell, CompactRecordList, RecordCard } from '../components/design-system.jsx';

const today = () => new Date().toISOString().slice(0, 10);

export function ProductionQuality({ notify }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ productionOrderId: '', sourceType: 'OPERATION_REPORT', sourceId: '', planId: '', businessDate: today() });
  const load = () => api('/api/production-inspections').then((r) => setItems(r.inspections || [])).catch((e) => notify(e.message, 'error'));
  useEffect(load, []);
  const open = (id) => api(`/api/production-inspections/${id}`).then((r) => setSelected(r.inspection)).catch((e) => notify(e.message, 'error'));
  const create = async (event) => {
    event.preventDefault();
    try { const result = await api('/api/production-inspections', { method: 'POST', body: form }); setCreating(false); await open(result.id); await load(); }
    catch (e) { notify(e.message, 'error'); }
  };
  const finish = async (result) => {
    try {
      const resultItems = (selected.items || []).map((item) => ({ id: item.id, ...(item.result_type === 'NUMERIC' ? { numericResult: item.min_value ?? item.max_value ?? 0 } : item.result_type === 'TEXT' ? { textResult: result === 'PASS' ? '合格' : '不合格' } : { passFailResult: result }) }));
      await api(`/api/production-inspections/${selected.id}/complete`, { method: 'POST', body: { result, items: resultItems } });
      notify(result === 'PASS' ? '检验已通过' : '检验已判定不合格'); setSelected(null); await load();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <BusinessPageShell className="mq-workspace" width="rail">
    <BusinessPageHeader title="生产质量" primaryAction={<BusinessAction hierarchy="primary" onClick={() => setCreating(true)}>新建检验</BusinessAction>}/>
    <CompactRecordList>{items.map((item) => <RecordCard key={item.id} title={item.code} subtitle={`${item.productionOrderNo} · ${item.source_type === 'OPERATION_REPORT' ? '工序检验' : '产品检验'}`} status={<Status status={item.result || item.status}/>} facts={[{ label: '业务日期', value: item.business_date }, { label: '结果', value: item.result || '待检验' }]} onClick={() => open(item.id)}/>)}</CompactRecordList>
    {!items.length && <Empty text="暂无生产检验任务"/>}
    {creating && <Modal title="新建生产检验" onClose={() => setCreating(false)}><form className="form-grid" onSubmit={create}>
      <label>生产工单 ID<input value={form.productionOrderId} onChange={(e) => setForm({ ...form, productionOrderId: e.target.value })} required/></label>
      <label>检验类型<select value={form.sourceType} onChange={(e) => setForm({ ...form, sourceType: e.target.value })}><option value="OPERATION_REPORT">工序报工</option><option value="PRODUCTION_RECEIPT">生产入库</option></select></label>
      <label>来源单据 ID<input value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })} required/></label>
      <label>检验方案 ID<input value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}/></label>
      <label>业务日期<input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} required/></label>
      <div className="form-actions"><button type="button" className="secondary" onClick={() => setCreating(false)}>取消</button><button className="primary">创建检验</button></div>
    </form></Modal>}
    {selected && <Modal title={selected.code} onClose={() => setSelected(null)} wide><div className="mq-detail-head"><Status status={selected.result || selected.status}/><strong>{selected.productionOrderNo}</strong><span>{selected.source_type}</span></div>
      <div className="mq-criteria">{(selected.items || []).map((item) => <div key={item.id}><strong>{item.criterion_name}</strong><span>{item.specification || '无额外规格'}</span><small>{item.result_type}</small></div>)}</div>
      {selected.status === 'DRAFT' && <div className="form-actions"><button className="danger-button" onClick={() => finish('FAIL')}>判定不合格</button><button className="primary" onClick={() => finish('PASS')}>检验通过</button></div>}
    </Modal>}
  </BusinessPageShell>;
}

export function QualityConfiguration({ notify }) {
  const [tab, setTab] = useState('items');
  const [data, setData] = useState({ items: [], instruments: [], plans: [] });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', category: '', unit: '', specification: '' });
  const endpoints = { items: '/api/inspection-items', instruments: '/api/inspection-instruments', plans: '/api/inspection-plans' };
  const load = () => Promise.all(Object.entries(endpoints).map(([key, endpoint]) => api(endpoint).then((r) => [key, r[key] || []]))).then((entries) => setData(Object.fromEntries(entries))).catch((e) => notify(e.message, 'error'));
  useEffect(load, []);
  const save = async (event) => { event.preventDefault(); try { await api(endpoints[tab], { method: 'POST', body: tab === 'plans' ? { ...form, targetType: 'PRODUCT', items: [] } : form }); setEditing(false); setForm({ code: '', name: '', category: '', unit: '', specification: '' }); await load(); } catch (e) { notify(e.message, 'error'); } };
  return <BusinessPageShell className="mq-workspace" width="rail"><BusinessPageHeader title="质量配置" primaryAction={<BusinessAction hierarchy="primary" onClick={() => setEditing(true)}>新建</BusinessAction>}/>
    <div className="segmented-control" role="tablist">{[['items','检验项目'],['instruments','检验仪器'],['plans','检验方案']].map(([key,label]) => <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
    <CompactRecordList>{data[tab].map((item) => <RecordCard key={item.id} title={`${item.code} · ${item.name}`} subtitle={item.category || item.specification || item.target_type || '—'} status={<Status status={item.active ? 'ACTIVE' : 'INACTIVE'}/>}/>)}</CompactRecordList>{!data[tab].length && <Empty text="暂无配置"/>}
    {editing && <Modal title="新建质量配置" onClose={() => setEditing(false)}><form className="form-grid" onSubmit={save}><label>编码<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required/></label><label>名称<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/></label>{tab === 'items' && <><label>分类<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}/></label><label>单位<input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}/></label></>}{tab === 'instruments' && <label>规格<input value={form.specification} onChange={(e) => setForm({ ...form, specification: e.target.value })}/></label>}<div className="form-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>取消</button><button className="primary">保存</button></div></form></Modal>}
  </BusinessPageShell>;
}

export function ProductionScan({ notify }) {
  const [mode, setMode] = useState('material');
  const [orderToken, setOrderToken] = useState('');
  const [order, setOrder] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [form, setForm] = useState({ requirementLineId: '', warehouseId: '', identity: '', quantity: 1, operationToken: '', goodQuantity: 1, scrapQuantity: 0, laborSeconds: 0, machineSeconds: 0 });
  useEffect(() => { api('/api/warehouses').then((r) => setWarehouses(r.warehouses || [])).catch(() => setWarehouses([])); }, []);
  const lookup = async (event) => { event.preventDefault(); try { const found = await api('/api/production-scan/lookup', { method: 'POST', body: { kind: 'ORDER', token: orderToken } }); const detail = await api(`/api/production-orders/${found.order.id}`); setOrder(detail.order); } catch (e) { setOrder(null); notify(e.message, 'error'); } };
  const execute = async (event) => { event.preventDefault(); try { const body = mode === 'material' ? { orderToken, requirementLineId: form.requirementLineId, warehouseId: form.warehouseId, identity: form.identity, quantity: Number(form.quantity) } : { orderToken, operationToken: form.operationToken, goodQuantity: Number(form.goodQuantity), scrapQuantity: Number(form.scrapQuantity), laborSeconds: Number(form.laborSeconds), machineSeconds: Number(form.machineSeconds) }; const result = await api(mode === 'material' ? '/api/production-scan/issue' : '/api/production-scan/report', { method: 'POST', body }); notify(`${result.issueNo || result.reportNo} 已创建为草稿`); } catch (e) { notify(e.message, 'error'); } };
  const operations = order?.operationPlan || [];
  return <BusinessPageShell className="mq-workspace production-scan" width="rail"><BusinessPageHeader title="生产扫码"/><form className="scan-lookup" onSubmit={lookup}><label>生产工单号<input autoFocus inputMode="text" value={orderToken} onChange={(e) => setOrderToken(e.target.value)} placeholder="扫描或输入工单号" required/></label><button className="primary">识别工单</button></form>
    {order ? <><div className="scan-order"><strong>{order.order_no}</strong><Status status={order.status}/><span>{order.productCode} · {quantity(order.quantity)}</span></div><div className="segmented-control"><button type="button" className={mode === 'material' ? 'active' : ''} onClick={() => setMode('material')}>物料</button><button type="button" className={mode === 'operation' ? 'active' : ''} onClick={() => setMode('operation')}>工序</button></div><form className="form-grid scan-action" onSubmit={execute}>
      {mode === 'material' ? <><label>需求物料<select value={form.requirementLineId} onChange={(e) => setForm({ ...form, requirementLineId: e.target.value })} required><option value="">选择物料</option>{(order.items || []).map((item) => <option key={item.id} value={item.id}>{item.productCode} · 待领 {quantity(item.remainingQuantity)}</option>)}</select></label><label>仓库<select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>LOT / SERIAL<input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} placeholder="可选扫描"/></label><label>数量<input type="number" min="0.001" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required/></label></> : <><label>工序<select value={form.operationToken} onChange={(e) => setForm({ ...form, operationToken: e.target.value })} required><option value="">选择工序</option>{operations.map((op) => <option key={op.id} value={op.id}>{op.sequence_no} · {op.operationCode}</option>)}</select></label><label>良品数量<input type="number" min="0" step="0.001" value={form.goodQuantity} onChange={(e) => setForm({ ...form, goodQuantity: e.target.value })}/></label><label>报废数量<input type="number" min="0" step="0.001" value={form.scrapQuantity} onChange={(e) => setForm({ ...form, scrapQuantity: e.target.value })}/></label><label>人工秒<input type="number" min="0" value={form.laborSeconds} onChange={(e) => setForm({ ...form, laborSeconds: e.target.value })}/></label><label>设备秒<input type="number" min="0" value={form.machineSeconds} onChange={(e) => setForm({ ...form, machineSeconds: e.target.value })}/></label></>}<div className="form-actions"><button className="primary">创建{mode === 'material' ? '领料' : '报工'}草稿</button></div>
    </form></> : <Empty text="先扫描生产工单"/>}
  </BusinessPageShell>;
}
