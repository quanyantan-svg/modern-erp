import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, money } from '../components/ui.jsx';
import {
  BottomActionBar, BusinessContentSection, BusinessPageHeader, BusinessPageShell,
  BusinessState, DateField, DetailSection, FormRow, PrimaryButton, QuantityField,
  RecordCard, RecordList, SecondaryButton, SelectField, Sheet, StatusChip, TextArea,
  TextField,
} from '../components/design-system.jsx';
import { useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const key = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const micros = (value) => Math.round(Number(value) * 1_000_000);
const decimal = (value) => Number(value || 0) / 1_000_000;

function useRouteSelection(routeKey) {
  const navigation = useAppNavigation();
  const initial = navigation.target?.page === routeKey ? navigation.target.documentId || null : null;
  const [selectedId, setSelectedId] = useState(initial);
  function select(id) {
    setSelectedId(id);
    navigation.navigateToPage(routeKey, id ? { documentId: id } : null, { replace: !id });
  }
  useEffect(() => {
    const handler = selectedId ? () => select(null) : null;
    navigation.setHeaderBackAction(handler);
    return () => navigation.setHeaderBackAction(null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  return [selectedId, select];
}

function status(value) {
  return <StatusChip status={value}>{value || '—'}</StatusChip>;
}

function ErrorState({ error, retry }) {
  return <BusinessState kind="ERROR" description={error?.message} retry={retry} requestId={error?.requestId}/>;
}

function QuotationEditor({ value, onClose, onSaved, notify }) {
  const [references, setReferences] = useState({ customers: [], products: [] });
  const [form, setForm] = useState({ customerId: value?.customer_id || '', validFrom: value?.valid_from || today(), validTo: value?.valid_to || today(), remark: value?.remark || '', items: value?.lines?.map((line) => ({ productId: line.material_id, uomCode: line.commercial_uom_code, quantityDecimal: String(decimal(line.quantity_micros)) })) || [{ productId: '', uomCode: '', quantityDecimal: '1' }] });
  const [saving, setSaving] = useState(false);
  useEffect(() => { Promise.all([api('/api/customers'), api('/api/products')]).then(([customers, products]) => setReferences({ customers: customers.customers || [], products: products.products || [] })).catch((error) => notify(error.message, 'error')); }, [notify]);
  function productChanged(index, productId) {
    const product = references.products.find((item) => item.id === productId);
    setForm((current) => ({ ...current, items: current.items.map((item, lineIndex) => lineIndex === index ? { ...item, productId, uomCode: product?.baseUomCode || product?.base_uom_code || '' } : item) }));
  }
  async function submit(event) {
    event.preventDefault(); setSaving(true);
    try {
      const path = value?.id ? `/api/sales-quotations/${value.id}` : '/api/sales-quotations';
      const response = await api(path, { method: value?.id ? 'PATCH' : 'POST', body: form });
      notify(value?.id ? '报价草稿已更新' : '报价草稿已创建'); onSaved(response.quotation);
    } catch (error) { notify(error.message, 'error'); } finally { setSaving(false); }
  }
  return <Sheet title={value?.id ? '编辑报价' : '新建报价'} onClose={onClose} className="sales-batch-editor"><form className="sales-batch-form" onSubmit={submit}>
    <div className="form-grid">
      <FormRow label="客户" required><SelectField required value={form.customerId} onChange={(event) => setForm({ ...form, customerId: event.target.value })}><option value="">请选择客户</option>{references.customers.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField></FormRow>
      <FormRow label="有效期起" required><DateField required value={form.validFrom} onChange={(event) => setForm({ ...form, validFrom: event.target.value })}/></FormRow>
      <FormRow label="有效期止" required><DateField required value={form.validTo} onChange={(event) => setForm({ ...form, validTo: event.target.value })}/></FormRow>
      <FormRow label="备注"><TextArea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })}/></FormRow>
    </div>
    <BusinessContentSection title="报价明细" description="价格与折扣由服务器按商业日期解析，客户端不提交快照。">
      <div className="sales-batch-lines">{form.items.map((line, index) => <div className="sales-batch-line" key={index}>
        <FormRow label={`物料 ${index + 1}`} required><SelectField required value={line.productId} onChange={(event) => productChanged(index, event.target.value)}><option value="">请选择物料</option>{references.products.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField></FormRow>
        <FormRow label="单位" required><TextField required value={line.uomCode} onChange={(event) => setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, uomCode: event.target.value } : item) })}/></FormRow>
        <FormRow label="数量" required><QuantityField required min="0.000001" step="0.000001" value={line.quantityDecimal} onChange={(event) => setForm({ ...form, items: form.items.map((item, i) => i === index ? { ...item, quantityDecimal: event.target.value } : item) })}/></FormRow>
        {form.items.length > 1 && <SecondaryButton type="button" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })}>移除</SecondaryButton>}
      </div>)}</div>
      <SecondaryButton type="button" onClick={() => setForm({ ...form, items: [...form.items, { productId: '', uomCode: '', quantityDecimal: '1' }] })}>增加明细</SecondaryButton>
    </BusinessContentSection>
    <BottomActionBar><SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton><PrimaryButton disabled={saving}>{saving ? '保存中…' : '保存草稿'}</PrimaryButton></BottomActionBar>
  </form></Sheet>;
}

function QuotationDetail({ id, notify, onBack, onEdit, onChanged, user }) {
  const [value, setValue] = useState(null); const [error, setError] = useState(null); const [converting, setConverting] = useState(false);
  const load = () => api(`/api/sales-quotations/${id}`).then((response) => { setValue(response.quotation); setError(null); }).catch(setError);
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(name, body = {}) {
    try { await api(`/api/sales-quotations/${id}/${name}`, { method: 'POST', body }); notify(name === 'effective-publish' ? '报价已生效' : '报价已关闭'); load(); onChanged(); } catch (cause) { notify(cause.message, 'error'); }
  }
  async function convert(event) {
    event.preventDefault(); setConverting(true);
    try {
      const lineSelections = value.lines.filter((line) => Number(line.remaining_qty_micros) > 0).map((line) => ({ quotationLineId: line.id, quantityMicros: Number(line.remaining_qty_micros) }));
      const result = await api(`/api/sales-quotations/${id}/convert-to-so`, { method: 'POST', headers: { 'Idempotency-Key': key('quotation-convert') }, body: { businessDate: today(), lineSelections } });
      notify(`已生成销售订单 ${result.salesOrderNo}`); load(); onChanged();
    } catch (cause) { notify(cause.message, 'error'); } finally { setConverting(false); }
  }
  if (error) return <ErrorState error={error} retry={load}/>; if (!value) return <BusinessState kind="LOADING"/>;
  return <BusinessPageShell className="sales-batch-detail" width="rail"><BusinessPageHeader title={value.quotation_no} context={`${value.customer_id} · ${value.valid_from} — ${value.valid_to}`} status={value.status} back={<button type="button" className="ghost" onClick={onBack}>返回报价列表</button>} primaryAction={value.status === 'EFFECTIVE' && Number(value.converted_total_cents) < Number(value.total_cents) ? <PrimaryButton type="button" disabled={converting} onClick={convert}>转换剩余数量为订单</PrimaryButton> : null}/>
    <DetailSection title="商业概要"><div className="detail-grid"><div><span>总额</span><strong>{money(value.total_cents)}</strong></div><div><span>已转换</span><strong>{money(value.converted_total_cents)}</strong></div><div><span>销售组</span><strong>{value.sales_group_id}</strong></div></div></DetailSection>
    <DetailSection title="报价明细"><RecordList>{value.lines.map((line) => <RecordCard key={line.id} title={`第 ${line.line_no} 行`} subtitle={line.material_id} facts={[{ label: '数量', value: decimal(line.quantity_micros) }, { label: '剩余', value: decimal(line.remaining_qty_micros) }, { label: '单价', value: money(line.unit_price_cents) }, { label: '金额', value: money(line.amount_cents) }]}/>)}</RecordList></DetailSection>
    <BottomActionBar>{value.status === 'DRAFT' && can(user, 'SALES_QUOTATION_MANAGE') && <><SecondaryButton type="button" onClick={() => onEdit(value)}>编辑</SecondaryButton><PrimaryButton type="button" onClick={() => action('effective-publish')}>生效发布</PrimaryButton></>}{['DRAFT','EFFECTIVE'].includes(value.status) && <SecondaryButton type="button" onClick={() => action('cancel', { reason: '用户关闭' })}>关闭报价</SecondaryButton>}</BottomActionBar>
  </BusinessPageShell>;
}

export function Quotations({ user, notify }) {
  const [selectedId, select] = useRouteSelection('quotations'); const [items, setItems] = useState([]); const [state, setState] = useState('LOADING'); const [error, setError] = useState(null); const [editor, setEditor] = useState(null);
  const load = () => { setState('LOADING'); api('/api/sales-quotations').then((response) => { setItems(response.quotations || []); setState(response.quotations?.length ? 'READY' : 'EMPTY'); setError(null); }).catch((cause) => { setError(cause); setState('ERROR'); }); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (selectedId) return <><QuotationDetail id={selectedId} user={user} notify={notify} onBack={() => select(null)} onEdit={setEditor} onChanged={load}/>{editor && <QuotationEditor value={editor} notify={notify} onClose={() => setEditor(null)} onSaved={(saved) => { setEditor(null); select(saved.id); }}/>}</>;
  return <BusinessPageShell className="sales-batch-list quotations" width="rail"><BusinessPageHeader title="销售报价" context="报价生效、剩余数量与订单转换证据" primaryAction={can(user, 'SALES_QUOTATION_MANAGE') ? <PrimaryButton type="button" onClick={() => setEditor({})}>新建报价</PrimaryButton> : null}/>{state === 'ERROR' ? <ErrorState error={error} retry={load}/> : state === 'LOADING' ? <BusinessState kind="LOADING"/> : state === 'EMPTY' ? <BusinessState kind="EMPTY" title="暂无销售报价"/> : <RecordList>{items.map((item) => <RecordCard key={item.id} title={item.quotation_no} subtitle={item.customer_name} status={status(item.status)} facts={[{ label: '有效期', value: `${item.valid_from} — ${item.valid_to}` }, { label: '报价金额', value: money(item.total_cents) }, { label: '已转换', value: money(item.converted_total_cents) }]} onClick={() => select(item.id)}/>)}</RecordList>}{editor && <QuotationEditor value={editor} notify={notify} onClose={() => setEditor(null)} onSaved={(saved) => { setEditor(null); load(); select(saved.id); }}/>}</BusinessPageShell>;
}

function DeliveryNoticeEditor({ onClose, onSaved, notify }) {
  const [refs, setRefs] = useState({ orders: [], warehouses: [] }); const [order, setOrder] = useState(null); const [form, setForm] = useState({ salesOrderId: '', warehouseId: '', businessDate: today(), plannedDeliveryDate: today(), quantities: {} }); const [saving, setSaving] = useState(false);
  useEffect(() => { Promise.all([api('/api/sales-orders?status=APPROVED'), api('/api/warehouses')]).then(([orders, warehouses]) => setRefs({ orders: orders.orders || [], warehouses: warehouses.warehouses || [] })).catch((error) => notify(error.message, 'error')); }, [notify]);
  async function chooseOrder(id) { setForm({ ...form, salesOrderId: id, quantities: {} }); if (!id) return setOrder(null); try { const result = await api(`/api/sales-orders/${id}`); setOrder(result.order); } catch (error) { notify(error.message, 'error'); } }
  async function submit(event) { event.preventDefault(); setSaving(true); try { const lines = order.items.map((line) => ({ salesOrderItemId: line.id, scheduledQtyMicros: micros(form.quantities[line.id] || 0) })).filter((line) => line.scheduledQtyMicros > 0); const result = await api('/api/delivery-notices', { method: 'POST', body: { ...form, lines } }); notify('交货通知草稿已创建'); onSaved(result.notice); } catch (error) { notify(error.message, 'error'); } finally { setSaving(false); } }
  return <Sheet title="新建交货通知" onClose={onClose} className="sales-batch-editor"><form className="sales-batch-form" onSubmit={submit}><div className="form-grid"><FormRow label="已批准销售订单" required><SelectField required value={form.salesOrderId} onChange={(event) => chooseOrder(event.target.value)}><option value="">请选择订单</option>{refs.orders.map((item) => <option key={item.id} value={item.id}>{item.order_no} · {item.customer_name}</option>)}</SelectField></FormRow><FormRow label="仓库" required><SelectField required value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}><option value="">请选择仓库</option>{refs.warehouses.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField></FormRow><FormRow label="业务日期"><DateField value={form.businessDate} onChange={(event) => setForm({ ...form, businessDate: event.target.value })}/></FormRow><FormRow label="计划交货日"><DateField value={form.plannedDeliveryDate} onChange={(event) => setForm({ ...form, plannedDeliveryDate: event.target.value })}/></FormRow></div>{order && <BusinessContentSection title="通知数量"><div className="sales-batch-lines">{order.items.map((line) => <FormRow key={line.id} label={`${line.product_id}（订单 ${line.quantity}）`}><QuantityField min="0" max={line.quantity} step="0.000001" value={form.quantities[line.id] || ''} onChange={(event) => setForm({ ...form, quantities: { ...form.quantities, [line.id]: event.target.value } })}/></FormRow>)}</div></BusinessContentSection>}<BottomActionBar><SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton><PrimaryButton disabled={saving || !order}>{saving ? '保存中…' : '保存草稿'}</PrimaryButton></BottomActionBar></form></Sheet>;
}

function DeliveryNoticeDetail({ id, notify, onBack, onChanged }) {
  const [value, setValue] = useState(null); const [error, setError] = useState(null); const load = () => api(`/api/delivery-notices/${id}`).then((response) => { setValue(response.notice); setError(null); }).catch(setError); useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(name) { try { await api(`/api/delivery-notices/${id}/${name}`, { method: 'POST', headers: name === 'confirm' ? { 'Idempotency-Key': key('dn-confirm') } : {}, body: name === 'cancel' ? { reason: '用户取消' } : {} }); notify(name === 'confirm' ? '交货通知已确认' : '交货通知已取消'); load(); onChanged(); } catch (cause) { notify(cause.message, 'error'); } }
  if (error) return <ErrorState error={error} retry={load}/>; if (!value) return <BusinessState kind="LOADING"/>;
  return <BusinessPageShell className="sales-batch-detail" width="rail"><BusinessPageHeader title={value.notice_no} context={`订单 ${value.sales_order_id} · ${value.planned_delivery_date}`} status={value.state} back={<button type="button" className="ghost" onClick={onBack}>返回通知列表</button>}/><DetailSection title="交付快照"><div className="detail-grid"><div><span>仓库</span><strong>{value.warehouse_id}</strong></div><div><span>客户</span><strong>{value.customerSnapshot?.name}</strong></div><div><span>收货地址</span><strong>{value.shipToSnapshot?.address || '—'}</strong></div></div></DetailSection><DetailSection title="通知明细"><RecordList>{value.lines.map((line) => <RecordCard key={line.id} title={`第 ${line.line_no} 行`} subtitle={line.product_id} facts={[{ label: '通知数量', value: decimal(line.scheduled_qty_micros) }, { label: '已用于出货', value: decimal(line.notified_qty_micros) }, { label: '可用余额', value: decimal(line.remaining_notified_qty_micros) }]}/>)}</RecordList></DetailSection>{value.state === 'DRAFT' && <BottomActionBar><SecondaryButton type="button" onClick={() => action('cancel')}>取消通知</SecondaryButton><PrimaryButton type="button" onClick={() => action('confirm')}>确认通知</PrimaryButton></BottomActionBar>}</BusinessPageShell>;
}

export function DeliveryNotices({ user, notify }) {
  const [selectedId, select] = useRouteSelection('delivery-notices'); const [items, setItems] = useState([]); const [editor, setEditor] = useState(false); const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const load = () => { setLoading(true); api('/api/delivery-notices').then((response) => { setItems(response.notices || []); setError(null); }).catch(setError).finally(() => setLoading(false)); }; useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (selectedId) return <DeliveryNoticeDetail id={selectedId} notify={notify} onBack={() => select(null)} onChanged={load}/>;
  return <BusinessPageShell className="sales-batch-list delivery-notices" width="rail"><BusinessPageHeader title="交货通知" context="确认仅冻结商业交付计划，不产生库存异动" primaryAction={can(user, 'SALES_MANAGE') ? <PrimaryButton type="button" onClick={() => setEditor(true)}>新建通知</PrimaryButton> : null}/>{error ? <ErrorState error={error} retry={load}/> : loading ? <BusinessState kind="LOADING"/> : !items.length ? <BusinessState kind="EMPTY" title="暂无交货通知"/> : <RecordList>{items.map((item) => <RecordCard key={item.id} title={item.notice_no} subtitle={`${item.order_no} · ${item.customer_name}`} status={status(item.state)} facts={[{ label: '计划交货', value: item.planned_delivery_date }, { label: '仓库', value: item.warehouse_id }]} onClick={() => select(item.id)}/>)}</RecordList>}{editor && <DeliveryNoticeEditor notify={notify} onClose={() => setEditor(false)} onSaved={(saved) => { setEditor(false); load(); select(saved.id); }}/>}</BusinessPageShell>;
}

function ChangeEditor({ onClose, onSaved, notify }) {
  const [refs, setRefs] = useState({ orders: [], products: [] }); const [order, setOrder] = useState(null); const [form, setForm] = useState({ salesOrderId: '', path: 'CONTROLLED_DOCUMENT', itemId: '', productId: '', uomCode: '', op: 'MODIFY', quantity: '', reason: '' });
  useEffect(() => { Promise.all([api('/api/sales-orders?status=APPROVED'), api('/api/products')]).then(([orders, products]) => setRefs({ orders: orders.orders || [], products: products.products || [] })).catch((error) => notify(error.message, 'error')); }, [notify]);
  async function chooseOrder(id) { setForm({ ...form, salesOrderId: id, itemId: '' }); if (!id) return setOrder(null); try { setOrder((await api(`/api/sales-orders/${id}`)).order); } catch (error) { notify(error.message, 'error'); } }
  async function submit(event) { event.preventDefault(); try { const existing = order.items.find((item) => item.id === form.itemId); const line = form.op === 'ADD' ? { op: 'ADD', productId: form.productId, uomCode: form.uomCode, quantityMicros: micros(form.quantity) } : { op: form.op, salesOrderItemId: form.itemId, quantityMicros: form.op === 'CANCEL' ? 0 : micros(form.quantity || existing.quantity) }; const body = { salesOrderId: form.salesOrderId, reasonCode: 'CUSTOMER_REQUEST', reason: form.reason, lines: [line] }; const direct = form.path === 'CONTROLLED_DIRECT'; const result = await api(direct ? `/api/sales-orders/${form.salesOrderId}/controlled-change` : '/api/sales-order-changes', { method: 'POST', headers: direct ? { 'Idempotency-Key': key('so-change-request') } : {}, body }); notify(direct ? '受控直接变更已提交审批' : '正式变更单草稿已创建'); onSaved(result); } catch (error) { notify(error.message, 'error'); } }
  return <Sheet title="新建销售订单变更" onClose={onClose} className="sales-batch-editor"><form className="sales-batch-form" onSubmit={submit}><div className="form-grid"><FormRow label="变更路径"><SelectField value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })}><option value="CONTROLLED_DOCUMENT">正式变更单</option><option value="CONTROLLED_DIRECT">受控直接申请</option></SelectField></FormRow><FormRow label="已批准订单" required><SelectField required value={form.salesOrderId} onChange={(event) => chooseOrder(event.target.value)}><option value="">请选择订单</option>{refs.orders.map((item) => <option key={item.id} value={item.id}>{item.order_no}</option>)}</SelectField></FormRow><FormRow label="操作"><SelectField value={form.op} onChange={(event) => setForm({ ...form, op: event.target.value, itemId: '', productId: '', uomCode: '', quantity: '' })}><option value="ADD">新增行</option><option value="MODIFY">修改数量/日期</option><option value="CANCEL">取消剩余义务</option></SelectField></FormRow>{form.op === 'ADD' ? <><FormRow label="新增物料" required><SelectField required value={form.productId} onChange={(event) => { const product = refs.products.find((item) => item.id === event.target.value); setForm({ ...form, productId: event.target.value, uomCode: product?.baseUomCode || product?.base_uom_code || '' }); }}><option value="">请选择物料</option>{refs.products.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField></FormRow><FormRow label="单位" required><TextField required value={form.uomCode} onChange={(event) => setForm({ ...form, uomCode: event.target.value })}/></FormRow></> : <FormRow label="订单明细" required><SelectField required value={form.itemId} onChange={(event) => { const line = order?.items.find((item) => item.id === event.target.value); setForm({ ...form, itemId: event.target.value, quantity: line ? String(line.quantity) : '' }); }}><option value="">请选择明细</option>{order?.items?.map((line) => <option key={line.id} value={line.id}>{line.product_id} · {line.quantity}</option>)}</SelectField></FormRow>}{form.op !== 'CANCEL' && <FormRow label={form.op === 'ADD' ? '新增数量' : '变更后数量'} required><QuantityField required min="0.000001" step="0.000001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })}/></FormRow>}<FormRow label="变更原因" required><TextArea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}/></FormRow></div><BottomActionBar><SecondaryButton type="button" onClick={onClose}>取消</SecondaryButton><PrimaryButton>保存</PrimaryButton></BottomActionBar></form></Sheet>;
}

function ChangeDetail({ id, user, notify, onBack, onChanged }) {
  const [value, setValue] = useState(null); const [error, setError] = useState(null); const load = () => api(`/api/sales-order-changes/${id}`).then((response) => { setValue(response.change); setError(null); }).catch(setError); useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(name) { try { await api(`/api/sales-order-changes/${id}/${name}`, { method: 'POST', headers: name === 'approve' ? { 'Idempotency-Key': key('so-change-apply') } : {}, body: name === 'reject' ? { reason: '审批驳回' } : {} }); notify(`变更单已${name === 'approve' ? '批准并应用' : name === 'submit' ? '提交' : '处理'}`); load(); onChanged(); } catch (cause) { notify(cause.message, 'error'); } }
  if (error) return <ErrorState error={error} retry={load}/>; if (!value) return <BusinessState kind="LOADING"/>;
  return <BusinessPageShell className="sales-batch-detail" width="rail"><BusinessPageHeader title={value.change_no} context={`订单 ${value.sales_order_id} · 基准版本 ${value.base_effective_version}`} status={value.state} back={<button type="button" className="ghost" onClick={onBack}>返回变更列表</button>}/><DetailSection title="变更原因"><p>{value.reason_text}</p></DetailSection><DetailSection title="不可变前后证据"><RecordList>{value.lines.map((line) => <RecordCard key={line.id} title={`第 ${line.line_no} 行 · ${line.op}`} subtitle={line.sales_order_item_id || '新增行'} facts={[{ label: '数量差异', value: decimal(line.qty_delta_micros) }, { label: '金额差异', value: money(line.amount_delta_cents) }, { label: '约束检查', value: line.constraint_check_result }]}/>)}</RecordList></DetailSection><BottomActionBar>{value.state === 'DRAFT' && <PrimaryButton type="button" onClick={() => action('submit')}>提交审批</PrimaryButton>}{value.state === 'SUBMITTED' && can(user, 'SALES_ORDER_CHANGE_APPROVE') && <><SecondaryButton type="button" onClick={() => action('reject')}>驳回</SecondaryButton><PrimaryButton type="button" onClick={() => action('approve')}>批准并应用</PrimaryButton></>}</BottomActionBar></BusinessPageShell>;
}

export function SalesOrderChanges({ user, notify }) {
  const [selectedId, select] = useRouteSelection('sales-order-changes'); const [items, setItems] = useState([]); const [editor, setEditor] = useState(false); const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const load = () => { setLoading(true); api('/api/sales-order-changes').then((response) => { setItems(response.changes || []); setError(null); }).catch(setError).finally(() => setLoading(false)); }; useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (selectedId) return <ChangeDetail id={selectedId} user={user} notify={notify} onBack={() => select(null)} onChanged={load}/>;
  const canCreate = can(user, 'SALES_ORDER_CHANGE_DOCUMENT_MANAGE') || can(user, 'SALES_ORDER_CHANGE_DIRECT_REQUEST');
  return <BusinessPageShell className="sales-batch-list sales-order-changes" width="rail"><BusinessPageHeader title="销售订单变更" context="批准后通过版本 CAS 原子应用，历史证据不可覆盖" primaryAction={canCreate ? <PrimaryButton type="button" onClick={() => setEditor(true)}>新建变更</PrimaryButton> : null}/>{error ? <ErrorState error={error} retry={load}/> : loading ? <BusinessState kind="LOADING"/> : !items.length ? <BusinessState kind="EMPTY" title="暂无订单变更"/> : <RecordList>{items.map((item) => <RecordCard key={item.id} title={item.change_no} subtitle={item.order_no} status={status(item.state)} facts={[{ label: '路径', value: item.change_path }, { label: '版本', value: `${item.base_effective_version} → ${item.target_effective_version}` }, { label: '原因', value: item.reason_text }]} onClick={() => select(item.id)}/>)}</RecordList>}{editor && <ChangeEditor notify={notify} onClose={() => setEditor(false)} onSaved={(saved) => { setEditor(false); load(); select(saved.id); }}/>}</BusinessPageShell>;
}
