import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { ConfirmDelete, Empty, FormActions, Loading, Modal, Panel, Status, Toolbar, can, dateTime } from '../components/ui.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import { BusinessPageHeader, BusinessPageShell, HelpDisclosure, RecordCard, RecordList } from '../components/design-system.jsx';

const STATUS_LABELS = { ACTIVE: '启用', INACTIVE: '停用' };

function emptyOperation(sequenceNo = 10) {
  return {
    sequenceNo,
    operationCode: `OP-${sequenceNo}`,
    operationName: '',
    workCenter: '',
    setupMinutes: 0,
    runMinutesPerUnit: 0,
    notes: '',
  };
}

function toForm(routing) {
  return {
    productId: routing.product_id || '',
    routingCode: routing.routing_code || '',
    routingName: routing.routing_name || '',
    version: routing.version || 'V1',
    status: routing.status || 'INACTIVE',
    notes: routing.notes || '',
    operations: (routing.operations || []).map((operation) => ({
      id: operation.id,
      sequenceNo: operation.sequence_no,
      operationCode: operation.operation_code,
      operationName: operation.operation_name,
      workCenter: operation.work_center || '',
      setupMinutes: operation.setup_minutes,
      runMinutesPerUnit: operation.run_minutes_per_unit,
      notes: operation.notes || '',
    })),
  };
}

export default function ProductRoutings({ user, notify }) {
  const { target } = useAppNavigation();
  const [routings, setRoutings] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const canManage = can(user, 'ROUTING_MANAGE');

  const load = () => api(`/api/product-routings?search=${encodeURIComponent(search)}&product_id=${encodeURIComponent(productId)}&status=${status}`)
    .then((result) => setRoutings(result.routings || []))
    .catch((error) => notify(error.message, 'error'));

  useEffect(() => {
    api('/api/products').then((result) => setProducts(result.products || [])).catch((error) => notify(error.message, 'error'));
    void load();
  }, [productId, status]);

  useEffect(() => {
    if (target?.page !== 'product-routings') return;
    if (target.documentId) setSelected({ id: target.documentId });
    if (target.productId) setProductId(target.productId);
  }, [target]);

  const filters = <div className="routing-filters">
    <select aria-label="产品筛选" value={productId} onChange={(event) => setProductId(event.target.value)}>
      <option value="">全部产品</option>
      {products.map((product) => <option key={product.id} value={product.id}>{product.code} - {product.name}</option>)}
    </select>
    <select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>
      <option value="">全部状态</option>
      <option value="ACTIVE">启用</option>
      <option value="INACTIVE">停用</option>
    </select>
  </div>;

  return <BusinessPageShell className="product-routings-v15" width="rail">
    <BusinessPageHeader title="制品工序标准" primaryAction={canManage && <button className="primary" onClick={() => setSelected({ create: true, productId })}>新建路线</button>} help={<HelpDisclosure summary="配置说明"><p>定义制品工序顺序与计划标准工时；启用路线供计划与生产快照引用，不改变库存、会计或审批状态。</p></HelpDisclosure>}/>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索产品、路线编码或名称" extra={filters}/>
    <RecordList>
      {routings.map((routing) => <RecordCard
        key={routing.id}
        title={routing.product_name}
        subtitle={`${routing.product_code} · ${routing.routing_name}`}
        status={<Status status={routing.status === 'ACTIVE' ? 'approved' : 'draft'} label={STATUS_LABELS[routing.status]}/>}
        facts={[
          { label: '路线编码', value: routing.routing_code },
          { label: '版本', value: routing.version },
          { label: '工序', value: `${routing.operation_count} 道` },
          { label: '更新时间', value: dateTime(routing.updated_at) },
        ]}
        onClick={() => setSelected({ id: routing.id })}
      />)}
      {!routings.length && <Empty text="没有符合条件的制品工序标准"/>}
    </RecordList>
    {selected && <ProductRoutingModal
      user={user}
      value={selected}
      products={products}
      notify={notify}
      onClose={() => setSelected(null)}
      onSaved={() => { setSelected(null); void load(); }}
    />}
  </BusinessPageShell>;
}

function ProductRoutingModal({ user, value, products, notify, onClose, onSaved }) {
  const canManage = can(user, 'ROUTING_MANAGE');
  const [detail, setDetail] = useState(value.create ? {} : null);
  const [form, setForm] = useState({
    productId: value.productId || '', routingCode: '', routingName: '', version: 'V1',
    status: 'INACTIVE', notes: '', operations: [emptyOperation(10)],
  });
  const [editing, setEditing] = useState(Boolean(value.create));
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    if (!value.id) return;
    api('/api/product-routings/' + value.id)
      .then((result) => { setDetail(result.routing); setForm(toForm(result.routing)); })
      .catch((error) => notify(error.message, 'error'));
  };
  useEffect(() => { refresh(); }, []);

  const sortedOperations = useMemo(() => [...(detail?.operations || [])].sort((a, b) => a.sequence_no - b.sequence_no), [detail]);
  const updateOperation = (index, field, valueToSet) => setForm((current) => ({
    ...current,
    operations: current.operations.map((operation, operationIndex) => operationIndex === index ? { ...operation, [field]: valueToSet } : operation),
  }));
  const addOperation = () => setForm((current) => {
    const maxSequence = Math.max(0, ...current.operations.map((operation) => Number(operation.sequenceNo) || 0));
    const nextSequence = (Math.floor(maxSequence / 10) + 1) * 10;
    return { ...current, operations: [...current.operations, emptyOperation(nextSequence || 10)] };
  });
  const removeOperation = (index) => setForm((current) => ({ ...current, operations: current.operations.filter((_, operationIndex) => operationIndex !== index) }));

  const save = async () => {
    setBusy(true);
    try {
      if (value.id) await api('/api/product-routings/' + value.id, { method: 'PATCH', body: form });
      else await api('/api/product-routings', { method: 'POST', body: form });
      notify(value.id ? '制品工序标准已更新' : '制品工序标准已创建');
      onSaved();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };
  const changeStatus = async (action) => {
    setBusy(true);
    try {
      await api(`/api/product-routings/${value.id}/${action}`, { method: 'POST' });
      notify(action === 'activate' ? '路线已启用' : '路线已停用');
      refresh();
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api(`/api/product-routings/${value.id}`, { method: 'DELETE' }); notify('制品工序标准已删除'); onSaved(); }
    catch (error) { notify(error.message, 'error'); throw error; } finally { setBusy(false); }
  };

  if (!detail) return <Modal title="制品工序标准" onClose={onClose} wide><Loading/></Modal>;
  const title = value.create ? '新建制品工序标准' : editing ? '编辑制品工序标准' : '制品工序标准详情';
  return <Modal title={title} onClose={onClose} wide>
    {editing ? <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>产品<select value={form.productId} onChange={(event) => setForm({ ...form, productId: event.target.value })} required disabled={Boolean(value.id)}>
        <option value="">选择产品</option>{products.map((item) => <option key={item.id} value={item.id}>{item.code} - {item.name}</option>)}
      </select></label>
      <label>路线编码<input value={form.routingCode} onChange={(event) => setForm({ ...form, routingCode: event.target.value })} placeholder="例如 ROUTE-FG-001" required/></label>
      <label>路线名称<input value={form.routingName} onChange={(event) => setForm({ ...form, routingName: event.target.value })} required/></label>
      <label>版本<input value={form.version} onChange={(event) => setForm({ ...form, version: event.target.value })} required/></label>
      <label>状态<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="INACTIVE">停用</option><option value="ACTIVE">启用</option></select></label>
      <label className="full">备注<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/></label>
      <div className="full routing-editor">
        <div className="form-section-head"><span>工序顺序</span><button type="button" className="secondary" onClick={addOperation}>＋ 添加工序</button></div>
        {form.operations.map((operation, index) => <article className="routing-operation-editor" key={operation.id || index}>
          <div className="routing-operation-editor__sequence">{operation.sequenceNo || '—'}</div>
          <div className="routing-operation-editor__fields">
            <label>顺序号<input type="number" min="1" step="1" value={operation.sequenceNo} onChange={(event) => updateOperation(index, 'sequenceNo', Number(event.target.value))} required/></label>
            <label>工序编码<input value={operation.operationCode} onChange={(event) => updateOperation(index, 'operationCode', event.target.value)} required/></label>
            <label>工序名称<input value={operation.operationName} onChange={(event) => updateOperation(index, 'operationName', event.target.value)} required/></label>
            <label>工作中心 / 工作站<input value={operation.workCenter} onChange={(event) => updateOperation(index, 'workCenter', event.target.value)} placeholder="可填写简单文本"/></label>
            <label>准备时间（分钟）<input type="number" min="0" step="0.01" value={operation.setupMinutes} onChange={(event) => updateOperation(index, 'setupMinutes', Number(event.target.value))}/></label>
            <label>单位运行时间（分钟）<input type="number" min="0" step="0.01" value={operation.runMinutesPerUnit} onChange={(event) => updateOperation(index, 'runMinutesPerUnit', Number(event.target.value))}/></label>
            <label className="full">工序备注<input value={operation.notes} onChange={(event) => updateOperation(index, 'notes', event.target.value)}/></label>
          </div>
          <button type="button" className="danger-text" onClick={() => removeOperation(index)} aria-label={`删除工序 ${operation.sequenceNo}`}>删除</button>
        </article>)}
        {!form.operations.length && <Empty text="尚未添加工序；路线可先保存，之后再维护"/>}
      </div>
      <FormActions onClose={onClose} saveText={busy ? '保存中…' : '保存'}/>
    </form> : <>
      <div className="form-grid routing-detail-summary">
        <label>产品<span>{detail.product_code} - {detail.product_name}</span></label>
        <label>状态<span><Status status={detail.status === 'ACTIVE' ? 'approved' : 'draft'} label={STATUS_LABELS[detail.status]}/></span></label>
        <label>路线编码<span className="mono">{detail.routing_code}</span></label>
        <label>路线名称<span>{detail.routing_name}</span></label>
        <label>版本<span>{detail.version}</span></label>
        <label>更新时间<span>{dateTime(detail.updated_at)}</span></label>
        <label className="full">备注<span>{detail.notes || '—'}</span></label>
      </div>
      <div className="form-section-head routing-detail-heading">工序顺序</div>
      <div className="routing-operation-flow">
        {sortedOperations.map((operation, index) => <div key={operation.id} className="routing-operation-step">
          <article className="routing-operation-card">
            <div className="routing-operation-card__sequence">{operation.sequence_no}</div>
            <div><strong>{operation.operation_name}</strong><small className="mono">{operation.operation_code}</small></div>
            <dl><div><dt>工作中心</dt><dd>{operation.work_center || '—'}</dd></div><div><dt>准备时间</dt><dd>{operation.setup_minutes} 分钟</dd></div><div><dt>单位工时</dt><dd>{operation.run_minutes_per_unit} 分钟</dd></div></dl>
            {operation.notes && <p>{operation.notes}</p>}
          </article>
          {index < sortedOperations.length - 1 && <span className="routing-operation-arrow" aria-hidden="true">↓</span>}
        </div>)}
        {!sortedOperations.length && <Empty text="该路线尚未维护工序"/>}
      </div>
      <div className="form-actions">
        {canManage && detail.status === 'INACTIVE' && <button type="button" className="primary" disabled={busy} onClick={() => void changeStatus('activate')}>启用</button>}
        {canManage && detail.status === 'INACTIVE' && (<ConfirmDelete label="制品工序标准" message="确定删除这条已停用且未被生产业务引用的工艺路线吗？" onConfirm={remove}/>) }
        {canManage && detail.status === 'ACTIVE' && <button type="button" className="danger-button" disabled={busy} onClick={() => void changeStatus('deactivate')}>停用</button>}
        {canManage && <button type="button" className="secondary" onClick={() => setEditing(true)}>编辑</button>}
        <button type="button" className="secondary" onClick={onClose}>关闭</button>
      </div>
    </>}
  </Modal>;
}
