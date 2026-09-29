import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money, quantity, YuanField } from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import TrackingAllocationEditor from '../components/TrackingAllocationEditor.jsx';
import { copySourceAllocations } from '../lib/tracking.js';
import { presentBusinessValue } from '../lib/presentation.js';
import { ActionMenu, BusinessAction, BusinessAuditSection, BusinessContentSection, BusinessDangerZone, BusinessPageHeader, BusinessPageShell, BusinessRelationSection, BusinessState, CompactRecord, CompactRecordList, DangerSheet, HelpDisclosure, SearchField, SegmentedControl, StatusChip } from '../components/design-system.jsx';

function LogisticsActions({ existing, onClose, onAction, qualityAction, qualityLabel, qualityState }) {
  return <div className="form-actions full">
    <button type="button" className="secondary" onClick={onClose}>关闭</button>
    {existing && qualityAction && <button type="button" className="secondary" onClick={qualityAction}>{qualityLabel}</button>}
    {existing && qualityState && <span className="muted">质量状态：{qualityState.label}</span>}
    {existing && <button type="button" className="danger-button" onClick={() => onAction('cancel')}>取消单据</button>}
    {existing && <button type="button" className="approve-button" onClick={() => onAction('confirm')}>确认单据</button>}
    <button className="primary">{existing ? '保存修改' : '保存草稿'}</button>
  </div>;
}

const relationshipLabel = (type) => ({ SALES_ORDER: '销售订单', SALES_DELIVERY: '销售出货', SALES_RETURN: '销售退货', SALES_INVOICE: '销售发票', PURCHASE_ORDER: '采购订单', PURCHASE_RECEIPT: '采购入库', PURCHASE_RETURN: '采购退货', SUPPLIER_BILL: '供应商账单', ACCOUNTING_VOUCHER: '会计凭证' }[type] || '关联单据');

const BILLING_STATUS_LABELS = {
  UNBILLED: '未开账',
  PARTIALLY_BILLED: '部分开账',
  BILLED: '已开账',
  LEGACY: '历史账单状态',
};
function billingStatusLabel(raw) {
  if (!raw) return null;
  return BILLING_STATUS_LABELS[raw] || raw;
}
export const relationshipPage = (type) => ({ SALES_ORDER: 'orders', SALES_DELIVERY: 'sales-deliveries', SALES_RETURN: 'returns', SALES_INVOICE: 'sales-invoices', PURCHASE_ORDER: 'purchase-orders', PURCHASE_RECEIPT: 'purchase-receipts', PURCHASE_RETURN: 'returns', SUPPLIER_BILL: 'supplier-bills', ACCOUNTING_VOUCHER: 'accounting' }[type]);

export function RelationshipSections({ detail }) {
  const relation = detail.relationships || { upstream: [], downstream: [] };
  const directLabel = detail.delivery_no ? 'Legacy / Source unavailable（旧版出货）' : detail.receipt_no ? 'Legacy / Source unavailable（旧版入库）' : 'Legacy / Source unavailable（旧版退货）';
  return <>
    <section className="document-relations" data-testid="document-relations"><h4>关联单据</h4>
      {relation.upstream?.length ? <div><span>上游单据</span>{relation.upstream.map((item) => <AppLink key={item.id} page={relationshipPage(item.type)} documentId={item.id} documentType={item.type}>{relationshipLabel(item.type)} <b className="mono">{item.documentNo}</b></AppLink>)}</div> : relation.direct && <div className="direct-business"><span>上游单据</span><strong>{directLabel}</strong><small>仅兼容读取，不可重新过账</small></div>}
      {relation.downstream?.length > 0 && <div><span>下游单据</span>{relation.downstream.map((item) => <AppLink key={item.id} page={relationshipPage(item.type)} documentId={item.id} documentType={item.type}>{relationshipLabel(item.type)} <b className="mono">{item.documentNo}</b></AppLink>)}</div>}
    </section>
    {relation.finance && <section className="finance-trace"><h4>财务影响</h4>{relation.finance.type === 'FINANCIAL_RECORD' ? <p>已产生财务记录</p> : <div className="detail-grid"><div><span>凭证号</span><strong className="mono">{relation.finance.documentNo}</strong></div><div><span>状态</span><strong>{relation.finance.status}</strong></div><div><span>金额</span><strong>{money(relation.finance.amountCents)}</strong></div></div>}</section>}
    {relation.subledger && <section className="finance-trace"><h4>往来结算</h4><AppLink page={detail.customer_id ? 'accounts-receivable' : 'accounts-payable'} documentId={relation.subledger.id}><span>{detail.customer_id ? '应收记录' : '应付记录'}</span> <strong className="mono">{relation.subledger.documentNo}</strong></AppLink></section>}
  </>;
}

function ReadOnlyDocument({ detail, onClose, partyName }) {
  return <div>
    <div className="detail-grid"><div><span>往来单位</span><strong>{partyName}</strong></div><div><span>状态</span><strong>{detail.statusLabel || '状态待确认'}</strong></div><div><span>金额</span><strong>{money(detail.total_cents)}</strong></div></div>
    {detail.billingSummary && <div className="billing-strip"><div><span>计费状态</span><strong>{billingStatusLabel(detail.billingSummary.status) || '—'}</strong></div><div><span>已计费</span><strong>{quantity(detail.billingSummary.billedQuantity)}</strong></div><div><span>待计费</span><strong>{quantity(detail.billingSummary.remainingQuantity)}</strong></div>{detail.billingSummary.grniCents!==undefined&&<div><span>GRNI</span><strong>{money(detail.billingSummary.grniCents)}</strong></div>}</div>}
    <RelationshipSections detail={detail}/>
    <table className="line-table"><thead><tr><th>货品</th><th>数量</th><th>单价</th><th>金额</th></tr></thead><tbody>{(detail.items || []).map((item) => <tr key={item.id}><td>{item.productCode} - {item.productName}</td><td>{quantity(item.quantity)}</td><td>{money(item.unitPriceCents)}</td><td>{money(item.amountCents)}</td></tr>)}</tbody></table>
    <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>关闭</button></div>
  </div>;
}

export function PurchaseReceipts({ user, notify }) {
  const { target } = useAppNavigation();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(target?.page === 'purchase-receipts' ? target.documentId || null : null);
  const [editor, setEditor] = useState(null);
  const [state, setState] = useState('LOADING');
  const load = async () => {
    setState('LOADING');
    try {
      const params = new URLSearchParams({ search, status, includeArchived: String(includeArchived) });
      const response = await api('/api/purchase-receipts?' + params);
      setItems(response.purchaseReceipts || []);
      setState((response.purchaseReceipts || []).length ? 'READY' : 'EMPTY');
    } catch (error) { setState('ERROR'); notify(error.message, 'error'); }
  };
  useEffect(() => { void load(); }, [status, includeArchived]);
  if (selectedId) return <><PurchaseReceiptDetail id={selectedId} user={user} notify={notify} onBack={() => { setSelectedId(null); void load(); }} onEdit={() => setEditor({ id: selectedId })} onChanged={load}/>{editor && <PurchaseReceiptModal user={user} value={editor} onClose={() => { setEditor(null); void load(); }} notify={notify} api={api}/>}</>;
  return <BusinessPageShell className="purchase-receipts-prototype" width="rail">
    <BusinessPageHeader title="采购入库" primaryAction={can(user, 'PURCHASE_RECEIPTS_MANAGE') && <BusinessAction hierarchy="primary" onClick={() => setEditor({})}>新增采购入库</BusinessAction>} help={<HelpDisclosure summary="业务说明"><p>采购入库必须来自已审批采购订单，确认后才影响库存。已取消且无下游业务影响的记录可从正常业务列表归档保留。</p></HelpDisclosure>}/>
    <section className="receipt-list-toolbar" aria-label="采购入库筛选">
      <SearchField value={search} onChange={setSearch} onSubmit={load} placeholder="搜索单号或供应商"/>
      <SegmentedControl label="单据状态" value={status} onChange={setStatus} options={[{value:'',label:'全部'},{value:'DRAFT',label:'草稿'},{value:'CONFIRMED',label:'已确认'},{value:'CANCELLED',label:'已取消'}]}/>
      <label className="receipt-archive-filter"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)}/>显示已归档</label>
    </section>
    {state === 'LOADING' && <BusinessState kind="LOADING" title="正在加载采购入库"/>}
    {state === 'ERROR' && <BusinessState kind="ERROR" title="采购入库加载失败" description="请检查连接后重试。" retry={load}/>}
    {state === 'EMPTY' && <BusinessState kind="EMPTY" title="没有符合条件的采购入库" description={includeArchived ? '当前筛选中也没有已归档记录。' : '可以调整筛选，或新建一张采购入库单。'} action={can(user, 'PURCHASE_RECEIPTS_MANAGE') && <BusinessAction hierarchy="primary" onClick={() => setEditor({})}>新增采购入库</BusinessAction>}/>
    }
    {state === 'READY' && <CompactRecordList className="receipt-record-list">{items.map((item) => <CompactRecord key={item.id} className={`${item.status === 'CANCELLED' ? 'is-cancelled ' : ''}${item.archiveState?.archived ? 'is-archived' : ''}`} title={item.receipt_no} subtitle={item.supplierName} status={<StatusChip status={item.status}>{item.statusLabel}</StatusChip>} metadata={[{label:'仓库 / 收货日期',value:<>{item.warehouseName}<span> · {item.receipt_date}</span></>}]} metrics={[{label:'入库数量',value:quantity(Number(item.billedQuantity || 0) + Number(item.remainingBillQuantity || 0))},{label:'单据金额',value:money(item.total_cents)},{label:'IQC',value:item.qualityState?.label || '无需检验'}]} onOpen={() => setSelectedId(item.id)} action={<ActionMenu><button type="button" onClick={() => setSelectedId(item.id)}>查看详情</button>{can(user, 'PURCHASE_RECEIPTS_MANAGE') && item.status === 'DRAFT' && <button type="button" onClick={() => setEditor({ id: item.id })}>编辑草稿</button>}</ActionMenu>}>{item.archiveState?.archived && <p className="receipt-card__archive">已归档</p>}</CompactRecord>)}</CompactRecordList>}
    {editor && <PurchaseReceiptModal user={user} value={editor} onClose={() => { setEditor(null); void load(); }} notify={notify} api={api}/>
    }
  </BusinessPageShell>;
}

function PurchaseReceiptDetail({ id, user, notify, onBack, onEdit, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loadState, setLoadState] = useState('LOADING');
  const [confirm, setConfirm] = useState(null);
  const [archiveReason, setArchiveReason] = useState('已取消单据不再参与日常业务处理');
  const reload = async () => { try { setLoadState('LOADING'); const response = await api('/api/purchase-receipts/' + id); setDetail(response.purchaseReceipt); setLoadState('READY'); } catch (error) { setLoadState('ERROR'); notify(error.message, 'error'); } };
  useEffect(() => { void reload(); }, [id]);
  const act = async (action) => { try { await api('/api/purchase-receipts/' + id, { method: 'POST', body: { action } }); notify(action === 'confirm' ? '入库单已确认' : '入库单已取消'); setConfirm(null); await reload(); await onChanged?.(); } catch (error) { notify(error.message, 'error'); } };
  const prepareArchive = async () => { try { const response = await api(`/api/lifecycle/analyze?entityType=PURCHASE_RECEIPT&entityId=${encodeURIComponent(id)}`); const eligibility = response.archiveEligibility; setDetail((current) => ({ ...current, archiveEligibility: eligibility })); if (!eligibility.allowed) return notify(eligibility.blockers?.[0]?.message || '当前单据不能移除', 'error'); setConfirm('archive'); } catch (error) { notify(error.message, 'error'); } };
  const archive = async () => { try { await api('/api/lifecycle/archive', { method: 'POST', body: { entityType: 'PURCHASE_RECEIPT', entityId: id, reason: archiveReason } }); notify('已归档'); setConfirm(null); await reload(); await onChanged?.(); } catch (error) { notify(error.message, 'error'); } };
  const restore = async () => { try { await api('/api/lifecycle/restore', { method: 'POST', body: { entityType: 'PURCHASE_RECEIPT', entityId: id, reason: '恢复正常列表可见性' } }); notify('已恢复到业务列表，单据仍为已取消'); setConfirm(null); await reload(); await onChanged?.(); } catch (error) { notify(error.message, 'error'); } };
  if (loadState === 'LOADING') return <BusinessPageShell><BusinessState kind="LOADING" title="正在加载采购入库详情"/></BusinessPageShell>;
  if (loadState === 'ERROR' || !detail) return <BusinessPageShell><BusinessState kind="ERROR" title="采购入库详情加载失败" retry={reload} action={<button type="button" className="secondary" onClick={onBack}>返回列表</button>}/></BusinessPageShell>;
  const archived = detail.archiveState?.archived;
  const canManage = can(user, 'PURCHASE_RECEIPTS_MANAGE');
  const canRestore = can(user, 'USERS_MANAGE');
  const upstream = detail.relationships?.upstream || [];
  const commercialDetail = { ...detail, relationships: { ...(detail.relationships || {}), upstream: [], direct: false } };
  return <BusinessPageShell className={`purchase-receipt-detail${detail.status === 'CANCELLED' ? ' is-cancelled' : ''}${archived ? ' is-archived' : ''}`} width="rail">
    <BusinessPageHeader title={detail.receipt_no} breadcrumb={<button type="button" className="link-button" onClick={onBack}>采购入库 / 返回列表</button>} context={`${detail.supplierName} · ${detail.receipt_date}`} statusSlot={<div className="business-status-group" aria-label="业务状态"><span className="business-status-group__item"><small>单据</small><StatusChip status={detail.status}>{detail.statusLabel}</StatusChip></span><span className="business-status-group__item"><small>列表</small><StatusChip status={archived ? 'ARCHIVED' : 'ACTIVE'}>{archived ? '已归档' : '正常显示'}</StatusChip></span></div>} primaryAction={canManage && detail.status === 'DRAFT' && <BusinessAction hierarchy="primary" onClick={() => setConfirm('confirm')}>确认入库</BusinessAction>} secondaryActions={canManage && detail.status === 'DRAFT' ? <BusinessAction onClick={onEdit}>编辑草稿</BusinessAction> : null}/>
    {archived && <div className="receipt-archive-banner"><strong>已归档</strong><span>原单据、明细与审计记录保留，未被删除。</span>{canRestore && <BusinessAction onClick={() => setConfirm('restore')}>恢复列表可见性</BusinessAction>}</div>}
    <div className="receipt-document-flow">
      <BusinessContentSection title="业务摘要"><dl className="receipt-summary-list">
        <div className="receipt-summary-row receipt-summary-row--long"><dt>供应商</dt><dd>{detail.supplierName}</dd></div>
        <div className="receipt-summary-row receipt-summary-row--long"><dt>收货仓库</dt><dd>{detail.warehouseName}</dd></div>
        <div className="receipt-summary-row"><dt>收货日期</dt><dd>{detail.receipt_date}</dd></div>
        <div className="receipt-summary-row"><dt>单据金额</dt><dd>{money(detail.total_cents)}</dd></div>
      </dl></BusinessContentSection>
      <BusinessRelationSection title="来源采购订单">{upstream.length ? <div className="receipt-source-list">{upstream.map((item) => <AppLink key={item.id} page={relationshipPage(item.type)} documentId={item.id} documentType={item.type}><span>{relationshipLabel(item.type)}</span><strong className="mono">{item.documentNo}</strong></AppLink>)}</div> : <p className="muted">旧版来源信息不完整，仅兼容读取。</p>}</BusinessRelationSection>
      <BusinessContentSection title="入库明细" description={`${detail.items?.length || 0} 行货品`}><CompactRecordList className="receipt-line-records">{(detail.items || []).map((item) => <CompactRecord key={item.id} title={item.productName} subtitle={item.productCode} metadata={[{label:'数量',value:`${quantity(item.quantity)} ${item.unit || ''}`.trim()}]} metrics={[{label:'单价',value:money(item.unitPriceCents)},{label:'金额',value:money(item.amountCents)}]}/>)}</CompactRecordList></BusinessContentSection>
      <BusinessContentSection title="IQC"><dl className="receipt-summary-list"><div className="receipt-summary-row"><dt>质量状态</dt><dd>{detail.qualityState?.label || '无需检验'}</dd></div></dl></BusinessContentSection>
      <BusinessContentSection title="执行记录"><dl className="receipt-summary-list"><div className="receipt-summary-row"><dt>制单人</dt><dd>{detail.creatorName}</dd></div>{detail.confirmedByName && <div className="receipt-summary-row"><dt>确认人</dt><dd>{detail.confirmedByName}</dd></div>}</dl></BusinessContentSection>
      <BusinessRelationSection title="商业与财务关系"><RelationshipSections detail={commercialDetail}/></BusinessRelationSection>
      <BusinessAuditSection title="审计状态"><dl className="receipt-summary-list"><div className="receipt-summary-row"><dt>计费状态</dt><dd>{billingStatusLabel(detail.billingSummary?.status) || '—'}</dd></div><div className="receipt-summary-row"><dt>列表可见性</dt><dd>{archived ? '已归档' : '正常显示'}</dd></div>{archived && <div className="receipt-summary-row receipt-summary-row--long"><dt>归档原因</dt><dd>{detail.archiveState.reason || '—'}</dd></div>}</dl></BusinessAuditSection>
      {detail.status === 'CANCELLED' && !archived && <BusinessDangerZone title="管理" description="只有未产生下游、库存、追溯或财务影响的已取消单据，才能从日常业务列表归档。"><div className="receipt-archive-eligibility"><p>{detail.archiveEligibility?.allowed ? '服务端初步检查：可以归档。操作前会再次验证。' : (detail.archiveEligibility?.blockers?.[0]?.message || '需要重新检查归档资格。')}</p>{canManage && <BusinessAction hierarchy="danger" onClick={prepareArchive}>从业务列表移除</BusinessAction>}</div></BusinessDangerZone>}
      {detail.status === 'DRAFT' && <BusinessDangerZone title="管理" description="取消后不可继续编辑或确认。"><BusinessAction hierarchy="danger" onClick={() => setConfirm('cancel')}>取消这张单据</BusinessAction></BusinessDangerZone>}
    </div>
    {confirm === 'confirm' && <DangerSheet title="确认采购入库" confirmLabel="确认并影响库存" onClose={() => setConfirm(null)} onConfirm={() => act('confirm')} message="确认后将按单据明细增加库存，并执行既有质量与财务规则；该操作不能通过编辑撤回。"/>}
    {confirm === 'cancel' && <DangerSheet title="取消采购入库" confirmLabel="确认取消" onClose={() => setConfirm(null)} onConfirm={() => act('cancel')} message="取消后单据将只读，不会增加库存。"/>}
    {confirm === 'archive' && <DangerSheet title="从业务列表移除" confirmLabel="从列表移除" onClose={() => setConfirm(null)} onConfirm={archive}><p>该采购入库单将从正常业务列表中移除，并保留在归档记录中。<br/>原单据、明细和审计记录不会被删除，有权限的管理员可以恢复。</p><label className="receipt-archive-reason">归档原因<textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength="500" required/></label></DangerSheet>}
    {confirm === 'restore' && <DangerSheet title="恢复列表可见性" confirmLabel="确认恢复" onClose={() => setConfirm(null)} onConfirm={restore} message="恢复后单据会重新出现在正常业务列表中，但仍保持“已取消”，不会恢复库存或财务效果。"/>}
  </BusinessPageShell>;
}

function PurchaseReceiptModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [form, setForm] = useState({ purchaseOrderId: "", supplierId: "", warehouseId: "", receiptDate: new Date().toISOString().slice(0,10), billingMode: "SEPARATE", remark: "", items: [] });
  useEffect(() => {
    // Each fetch carries its own .catch so a single 403 (e.g. supplier
    // lookup unavailable for the role) does not cascade-reject the
    // Promise.all and silently disable warehouses / products selectors.
    api("/api/lookup/suppliers").then((r) => setSuppliers(r.suppliers || [])).catch((e) => notify(e.message, "error"));
    api("/api/warehouses").then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, "error"));
    api("/api/products").then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, "error"));
    api("/api/lookup/purchase-orders-source").then((r) => setPurchaseOrders(r.purchaseOrders || [])).catch((e) => notify("来源采购订单加载失败，请重试。", "error"));
    if (value.id) api("/api/purchase-receipts/" + value.id).then((r) => setDetail(r.purchaseReceipt)).catch((e) => notify(e.message, "error"));
  }, []);
  useEffect(() => {
    // Defer setForm to an effect (not render). Avoids React 19 / 18 race
    // when editing an existing receipt.
    if (detail && !form.supplierId) {
      setForm({
        purchaseOrderId: detail.purchase_order_id || "",
        supplierId: detail.supplier_id || "",
        warehouseId: detail.warehouse_id || "",
        receiptDate: detail.receipt_date || "",
        billingMode: detail.billing_mode || "SEPARATE",
        remark: detail.remark || "",
        items: (detail.items || []).map((item) => ({ ...item, sourceAllocations: copySourceAllocations(item.trackingAllocations) })),
      });
    }
    // intentional: only run when `detail` first arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api("/api/purchase-receipts/" + value.id, { method: "PATCH", body: form });
        notify("采购入库单更改已保存");
      } else {
        await api("/api/purchase-receipts", { method: "POST", body: form });
        notify("采购入库单已创建");
      }
      onClose();
    } catch (e) { notify(e.message, "error"); }
  };
  const addItem = () => setItems([...form.items, { productId: "", quantity: 1, unitPriceCents: 1 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val, ...(field === 'quantity' ? { trackingAllocations: [] } : {}) } : item));
  // V1.3 Phase 1: PR line unit price is entered in yuan. The form
  // stores integer cents (the API/DB contract) but the input is yuan.
  const updateItemPriceCents = (i, nextCents) => {
    const safeCents = Number.isFinite(nextCents) ? Math.max(0, Math.trunc(nextCents || 0)) : 0;
    setItems(form.items.map((item, idx) => idx === i ? { ...item, unitPriceCents: safeCents } : item));
  };
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const totalCents = form.items.reduce((s, i) => s + (i.quantity * i.unitPriceCents), 0);
  const choosePurchaseOrder = (purchaseOrderId) => {
    if (!purchaseOrderId) return setForm((current) => ({ ...current, purchaseOrderId: "" }));
    const order = purchaseOrders.find((o) => o.id === purchaseOrderId);
    if (!order) return;
    setForm((current) => ({ ...current, purchaseOrderId, supplierId: order.supplierId, items: order.items.filter((item) => item.quantity > 0).map((item) => ({ purchaseOrderItemId: item.purchaseOrderItemId, productId: item.productId, quantity: item.quantity, orderedQuantity: item.orderedQuantity, receivedQuantity: item.receivedQuantity, unitPriceCents: item.unitPriceCents })) }));
  };
  const changeState = async (action) => { try { await api("/api/purchase-receipts/" + value.id, { method: "POST", body: { action } }); notify(action === 'confirm' ? '入库单已确认' : '入库单已取消'); onClose(); } catch (e) { notify(e.message, 'error'); } };
  const createQuality = async () => { try { await api('/api/iqc', { method: 'POST', body: { purchase_receipt_id: value.id } }); notify('IQC 检验草稿已创建，请前往来料检验完成检验'); const response = await api('/api/purchase-receipts/' + value.id); setDetail(response.purchaseReceipt); } catch (e) { notify(e.message, 'error'); } };
  if (value.id && detail && detail.status !== 'DRAFT') return <Modal title="采购入库单详情" onClose={onClose} wide><ReadOnlyDocument detail={detail} partyName={detail.supplierName} onClose={onClose}/></Modal>;
  return <Modal title={value.id ? "编辑采购入库单" : "新增采购入库单"} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {value.id && detail && <div className="full"><RelationshipSections detail={detail}/></div>}
    {!value.id && <label className="full">来源采购订单（必选）<select value={form.purchaseOrderId} onChange={(e) => void choosePurchaseOrder(e.target.value)} required><option value="">选择已审批采购订单</option>{purchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.supplierName}</option>)}</select><small>独立库存更正请使用库存调整、调拨、报废或盘点单。</small></label>}
    <label>供应商<select value={form.supplierId} disabled required><option value="">由采购订单带入</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}</select></label>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({...form, warehouseId: e.target.value})} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></label>
    <label>收货日期<input type="date" value={form.receiptDate} onChange={(e) => setForm({...form, receiptDate: e.target.value})} required/></label>
    <label>计费模式<select value={form.billingMode} onChange={(e)=>setForm({...form,billingMode:e.target.value})}><option value="SEPARATE">收货后独立账单（GRNI）</option><option value="AUTO_BILL">收货后自动建账单</option></select></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>来源明细（产品与价格只读）</span></div>
      <table className="line-table"><thead><tr><th>货品</th><th className="number">数量</th><th className="number">单价（元）</th><th className="number">金额</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} disabled required><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select>{item.orderedQuantity !== undefined && <small>订购 {quantity(item.orderedQuantity)} · 已收 {quantity(item.receivedQuantity || 0)} · 剩余 {quantity(item.orderedQuantity-(item.receivedQuantity || 0))}</small>}</td>
          <td><input type="number" value={item.quantity} min="1" onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} required/></td>
          <td>{money(item.unitPriceCents)}</td>
          <td className="number">{money(item.quantity * item.unitPriceCents)}</td>
          <td/>
        </tr>)}
      </tbody></table>
      {form.items.map((item, i) => <TrackingAllocationEditor key={`receipt-tracking-${item.purchaseOrderItemId || i}`} product={products.find((product) => product.id === item.productId)} warehouseId={form.warehouseId} quantity={item.quantity} businessDate={form.receiptDate} direction="IN" value={item.trackingAllocations || []} onChange={(trackingAllocations) => updateItem(i, 'trackingAllocations', trackingAllocations)} notify={notify}/>)}
      <div className="line-total">合计：<strong>{money(totalCents)}</strong></div>
    </div>
    <LogisticsActions existing={Boolean(value.id)} onClose={onClose} onAction={changeState} qualityAction={value.id && detail?.qualityState?.code !== 'INSPECTION_DRAFT' ? createQuality : null} qualityLabel={detail?.qualityState?.code === 'FAIL' || detail?.qualityState?.code === 'STALE' ? '创建 IQC 复检' : '创建 IQC'} qualityState={detail?.qualityState}/>
  </form></Modal>;
}
// SalesDeliveries
export function SalesDeliveries({ user, notify }) {
  const { target } = useAppNavigation();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(target?.page === 'sales-deliveries' && target.documentId ? { id: target.documentId } : null);
  const load = () => api("/api/sales-deliveries?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(r.salesDeliveries || [])).catch((e) => notify(e.message, "error"));
  useEffect(() => { void load(); }, [status]);
  return <Panel title="销售出货单" action={can(user, "SALES_DELIVERIES_MANAGE") && <button className="primary" onClick={() => setView({})}>＋ 新增销售出货</button>}>
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或客户" extra={<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="CONFIRMED">已确认</option><option value="CANCELLED">已取消</option></select>}/>
    <div className="table-wrap"><table><thead><tr><th>单号</th><th>客户</th><th>仓库</th><th>发货日期</th><th className="number">金额</th><th>质量</th><th>状态</th><th>制单人</th><th/></tr></thead><tbody>
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:"pointer"}}><td className="mono">{item.delivery_no}</td><td>{item.customerName}</td><td>{item.warehouseName}</td><td>{item.delivery_date}</td><td className="number">{money(item.total_cents)}</td><td>{item.qualityState?.label}</td><td><Status status={item.status} label={item.statusLabel}/></td><td>{item.creatorName}</td><td onClick={(e) => e.stopPropagation()}>{can(user, "SALES_DELIVERIES_MANAGE") && item.status === "DRAFT" && <button className="row-action" onClick={() => setView({ id: item.id })}>编辑</button>}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有销售出货记录"/>}</div>
    {view && <SalesDeliveryModal user={user} value={view} onClose={() => { setView(null); void load(); }} notify={notify} api={api}/>}
  </Panel>;
}

function SalesDeliveryModal({ user, value, onClose, notify, api }) {
  const [detail, setDetail] = useState(value.id ? null : value);
  const [customers, setCustomers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [form, setForm] = useState({ salesOrderId: "", customerId: "", warehouseId: "", deliveryDate: new Date().toISOString().slice(0,10), billingMode: "SEPARATE", remark: "", items: [] });
  useEffect(() => {
    // Per-fetch .catch so a single 403 (e.g. customer lookup unavailable)
    // does not cascade-reject and silently disable the other selectors.
    api("/api/lookup/customers").then((r) => setCustomers(r.customers || [])).catch((e) => notify(e.message, "error"));
    api("/api/warehouses").then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, "error"));
    api("/api/products").then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, "error"));
    api("/api/lookup/sales-orders-source").then((r) => setSalesOrders(r.orders || [])).catch((e) => notify("来源销售订单加载失败，请重试。", "error"));
    if (value.id) api("/api/sales-deliveries/" + value.id).then((r) => setDetail(r.salesDelivery)).catch((e) => notify(e.message, "error"));
  }, []);
  useEffect(() => {
    if (detail && !form.customerId) {
      setForm({
        salesOrderId: detail.sales_order_id || "",
        customerId: detail.customer_id || "",
        warehouseId: detail.warehouse_id || "",
        deliveryDate: detail.delivery_date || detail.receipt_date || "",
        billingMode: detail.billing_mode || "SEPARATE",
        remark: detail.remark || "",
        items: detail.items || [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      if (value.id) {
        await api("/api/sales-deliveries/" + value.id, { method: "PATCH", body: form });
        notify("销售出货单更改已保存");
      } else {
        await api("/api/sales-deliveries", { method: "POST", body: form });
        notify("销售出货单已创建");
      }
      onClose();
    } catch (e) { notify(e.message, "error"); }
  };
  const addItem = () => setItems([...form.items, { productId: "", quantity: 1, unitPriceCents: 1 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val, ...(field === 'quantity' ? { trackingAllocations: [] } : {}) } : item));
  // V1.3 Phase 1: SD line unit price is entered in yuan.
  const updateItemPriceCents = (i, nextCents) => {
    const safeCents = Number.isFinite(nextCents) ? Math.max(0, Math.trunc(nextCents || 0)) : 0;
    setItems(form.items.map((item, idx) => idx === i ? { ...item, unitPriceCents: safeCents } : item));
  };
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const totalCents = form.items.reduce((s, i) => s + (i.quantity * i.unitPriceCents), 0);
  const chooseSalesOrder = (salesOrderId) => {
    if (!salesOrderId) return setForm((current) => ({ ...current, salesOrderId: "" }));
    const order = salesOrders.find((o) => o.id === salesOrderId);
    if (!order) return;
    setForm((current) => ({ ...current, salesOrderId, customerId: order.customerId, items: order.items.filter((item) => item.quantity > 0).map((item) => ({ salesOrderItemId: item.salesOrderItemId, productId: item.productId, quantity: item.quantity, orderedQuantity: item.orderedQuantity, deliveredQuantity: item.deliveredQuantity, unitPriceCents: item.unitPriceCents })) }));
  };
  const changeState = async (action) => { try { await api("/api/sales-deliveries/" + value.id, { method: "POST", body: { action } }); notify(action === 'confirm' ? '出库单已确认' : '出库单已取消'); onClose(); } catch (e) { notify(e.message, 'error'); } };
  const createQuality = async () => { try { await api('/api/oqc', { method: 'POST', body: { sales_delivery_id: value.id } }); notify('OQC 检验草稿已创建，请前往出货检验完成检验'); const response = await api('/api/sales-deliveries/' + value.id); setDetail(response.salesDelivery); } catch (e) { notify(e.message, 'error'); } };
  if (value.id && detail && detail.status !== 'DRAFT') return <Modal title="销售出货单详情" onClose={onClose} wide><ReadOnlyDocument detail={detail} partyName={detail.customerName} onClose={onClose}/></Modal>;
  return <Modal title={value.id ? "编辑销售出货单" : "新增销售出货单"} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {value.id && detail && <div className="full"><RelationshipSections detail={detail}/></div>}
    {!value.id && <label className="full">来源销售订单（必选）<select value={form.salesOrderId} onChange={(e) => void chooseSalesOrder(e.target.value)} required><option value="">选择已审批销售订单</option>{salesOrders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.customerName}</option>)}</select><small>独立库存更正请使用库存调整、调拨、报废或盘点单。</small></label>}
    <label>客户<select value={form.customerId} disabled required><option value="">由销售订单带入</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select></label>
    <label>仓库<select value={form.warehouseId} onChange={(e) => setForm({...form, warehouseId: e.target.value})} required><option value="">选择仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></label>
    <label>发货日期<input type="date" value={form.deliveryDate} onChange={(e) => setForm({...form, deliveryDate: e.target.value})} required/></label>
    <label>计费模式<select value={form.billingMode} onChange={(e)=>setForm({...form,billingMode:e.target.value})}><option value="SEPARATE">出货后独立开票</option><option value="DIRECT_BILL">出货后自动开票</option></select></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>来源明细（产品与价格只读）</span></div>
      <table className="line-table"><thead><tr><th>货品</th><th className="number">数量</th><th className="number">单价（元）</th><th className="number">金额</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} disabled required><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select>{item.orderedQuantity !== undefined && <small>订购 {quantity(item.orderedQuantity)} · 已发 {quantity(item.deliveredQuantity || 0)} · 剩余 {quantity(item.orderedQuantity-(item.deliveredQuantity || 0))}</small>}</td>
          <td><input type="number" value={item.quantity} min="1" onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} required/></td>
          <td>{money(item.unitPriceCents)}</td>
          <td className="number">{money(item.quantity * item.unitPriceCents)}</td>
          <td/>
        </tr>)}
      </tbody></table>
      {form.items.map((item, i) => <TrackingAllocationEditor key={`delivery-tracking-${item.salesOrderItemId || i}`} product={products.find((product) => product.id === item.productId)} warehouseId={form.warehouseId} quantity={item.quantity} businessDate={form.deliveryDate} direction="OUT" value={item.trackingAllocations || []} onChange={(trackingAllocations) => updateItem(i, 'trackingAllocations', trackingAllocations)} notify={notify}/>)}
      <div className="line-total">合计：<strong>{money(totalCents)}</strong></div>
    </div>
    <LogisticsActions existing={Boolean(value.id)} onClose={onClose} onAction={changeState} qualityAction={value.id && detail?.qualityState?.code !== 'INSPECTION_DRAFT' ? createQuality : null} qualityLabel={detail?.qualityState?.code === 'FAIL' || detail?.qualityState?.code === 'STALE' ? '创建 OQC 复检' : '创建 OQC'} qualityState={detail?.qualityState}/>
  </form></Modal>;
}
// Returns
export function Returns({ user, notify }) {
  const { target } = useAppNavigation();
  const targetTab = target?.documentType === 'PURCHASE_RETURN' ? 'purchase' : 'sales';
  const [tab, setTab] = useState(target?.page === 'returns' ? targetTab : "sales");
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState(target?.page === 'returns' && target.documentId ? { id: target.documentId, tab: targetTab } : null);
  const load = () => {
    const apiPath = tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns";
    api(apiPath + "?search=" + encodeURIComponent(search) + "&status=" + status).then((r) => setItems(tab === "sales" ? r.salesReturns : r.purchaseReturns)).catch((e) => notify(e.message, "error"));
  };
  useEffect(() => { void load(); }, [tab, status]);
  const cols = ["单号", tab === "sales" ? "客户" : "供应商", "仓库", "金额", "状态", "制单人", ""];
  return <Panel title={tab === 'sales' ? '销售退货' : '采购退货'} action={can(user, "RETURNS_MANAGE") && <button className="primary" onClick={() => setView({ tab })}>＋ 新增退货单</button>}>
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
  const [sources, setSources] = useState([]);
  const [form, setForm] = useState({ sourceId: "", partyId: "", warehouseId: "", returnDate: new Date().toISOString().slice(0,10), remark: "", items: [] });
  useEffect(() => {
    // Per-fetch .catch so a single 403 (e.g. supplier lookup unavailable)
    // does not cascade-reject and disable the other selectors.
    api("/api/lookup/suppliers").then((r) => setSuppliers(r.suppliers || [])).catch((e) => notify(e.message, "error"));
    api("/api/lookup/customers").then((r) => setCustomers(r.customers || [])).catch((e) => notify(e.message, "error"));
    api("/api/warehouses").then((r) => setWarehouses(r.warehouses || [])).catch((e) => notify(e.message, "error"));
    api("/api/products").then((r) => setProducts(r.products || [])).catch((e) => notify(e.message, "error"));
    api(tab === 'sales' ? '/api/sales-deliveries?status=CONFIRMED' : '/api/purchase-receipts?status=CONFIRMED').then((r) => setSources(tab === 'sales' ? (r.salesDeliveries || []) : (r.purchaseReceipts || []))).catch((e) => notify("来源单据加载失败，请重试。", "error"));
    if (value.id) {
      const apiPath = tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns";
      api(apiPath + "/" + value.id).then((r) => setDetail(tab === "sales" ? r.salesReturn : r.purchaseReturn)).catch((e) => notify(e.message, "error"));
    }
  }, []);
  useEffect(() => {
    if (detail && !form.partyId) {
      setForm({
        sourceId: (tab === 'sales' ? detail.delivery_id : detail.receipt_id) || "",
        partyId: (tab === "sales" ? detail.customer_id : detail.supplier_id) || "",
        warehouseId: detail.warehouse_id || "",
        returnDate: detail.return_date || "",
        remark: detail.remark || "",
        items: (detail.items || []).map((item) => ({ ...item, sourceAllocations: copySourceAllocations(item.trackingAllocations) })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);
  const setItems = (items) => setForm((f) => ({ ...f, items }));
  const save = async () => {
    try {
      const body = tab === "sales" ? { deliveryId: form.sourceId || null, customerId: form.partyId, warehouseId: form.warehouseId, returnDate: form.returnDate, remark: form.remark, items: form.items } : { receiptId: form.sourceId || null, supplierId: form.partyId, warehouseId: form.warehouseId, returnDate: form.returnDate, remark: form.remark, items: form.items };
      if (value.id) {
        await api((tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns") + "/" + value.id, { method: "PATCH", body });
        notify("退货单更改已保存");
      } else {
        await api(tab === "sales" ? "/api/sales-returns" : "/api/purchase-returns", { method: "POST", body });
        notify("退货单已创建");
      }
      onClose();
    } catch (e) { notify(e.message, "error"); }
  };
  const addItem = () => setItems([...form.items, { productId: "", quantity: 1, unitPriceCents: 1 }]);
  const updateItem = (i, field, val) => setItems(form.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  // V1.3 Phase 1: return line unit price is entered in yuan.
  const updateItemPriceCents = (i, nextCents) => {
    const safeCents = Number.isFinite(nextCents) ? Math.max(0, Math.trunc(nextCents || 0)) : 0;
    setItems(form.items.map((item, idx) => idx === i ? { ...item, unitPriceCents: safeCents } : item));
  };
  const removeItem = (i) => setItems(form.items.filter((_, idx) => idx !== i));
  const totalCents = form.items.reduce((s, i) => s + (i.quantity * i.unitPriceCents), 0);
  const partyOptions = tab === "sales" ? customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>) : suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>);
  const chooseReturnSource = async (sourceId) => {
    if (!sourceId) return setForm((current) => ({ ...current, sourceId: '' }));
    try { const response = await api((tab === 'sales' ? '/api/sales-deliveries/' : '/api/purchase-receipts/') + sourceId); const source = tab === 'sales' ? response.salesDelivery : response.purchaseReceipt; setForm((current) => ({ ...current, sourceId, partyId: tab === 'sales' ? source.customer_id : source.supplier_id, warehouseId: source.warehouse_id, items: source.items.map((item) => { const sourceAllocations = copySourceAllocations(item.trackingAllocations); return { [tab === 'sales' ? 'deliveryItemId' : 'receiptItemId']: item.id, productId: item.productId, quantity: item.quantity, unitPriceCents: item.unitPriceCents, sourceAllocations, trackingAllocations: sourceAllocations }; }) })); } catch (e) { notify(e.message, 'error'); }
  };
  const changeState = async (action) => { try { const path = tab === 'sales' ? '/api/sales-returns/' : '/api/purchase-returns/'; if (action === 'confirm') { const body = tab === 'sales' ? { customerId: form.partyId, warehouseId: form.warehouseId, returnDate: form.returnDate, remark: form.remark, items: form.items } : { supplierId: form.partyId, warehouseId: form.warehouseId, returnDate: form.returnDate, remark: form.remark, items: form.items }; await api(path + value.id, { method: 'PATCH', body }); } await api(path + value.id, { method: 'POST', body: { action } }); notify(action === 'confirm' ? '退货单已确认' : '退货单已取消'); onClose(); } catch (e) { notify(e.message, 'error'); } };
  if (value.id && detail && detail.status !== 'DRAFT') return <Modal title={(tab === 'sales' ? '销售' : '采购') + '退货单详情'} onClose={onClose} wide><ReadOnlyDocument detail={detail} partyName={tab === 'sales' ? detail.customerName : detail.supplierName} onClose={onClose}/></Modal>;
  return <Modal title={(value.id ? "编辑" : "新增") + (tab === "sales" ? "销售退货单" : "采购退货单")} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    {value.id && detail && <div className="full"><RelationshipSections detail={detail}/></div>}
    {!value.id && <label className="full">来源{tab === 'sales' ? '销售出货' : '采购入库'}（必选）<select value={form.sourceId} onChange={(e) => void chooseReturnSource(e.target.value)} required><option value="">选择已确认来源单</option>{sources.map((source) => <option key={source.id} value={source.id}>{tab === 'sales' ? source.delivery_no : source.receipt_no} · {tab === 'sales' ? source.customerName : source.supplierName}</option>)}</select></label>}
    <label>{tab === "sales" ? "客户" : "供应商"}<select value={form.partyId} disabled required><option value="">由来源单带入</option>{partyOptions}</select></label>
    <label>仓库<select value={form.warehouseId} disabled required><option value="">由来源单带入</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} - {w.name}</option>)}</select></label>
    <label>退货日期<input type="date" value={form.returnDate} onChange={(e) => setForm({...form, returnDate: e.target.value})} required/></label>
    <label className="full">备注<input value={form.remark} onChange={(e) => setForm({...form, remark: e.target.value})}/></label>
    <div className="full"><div className="form-section-head"><span>来源明细（产品与价格只读）</span></div>
      <table className="line-table"><thead><tr><th>货品</th><th className="number">数量</th><th className="number">单价（元）</th><th className="number">金额</th><th/></tr></thead><tbody>
        {form.items.map((item, i) => <tr key={i}>
          <td><select value={item.productId} disabled required><option value="">选择货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}</select></td>
          <td><input type="number" value={item.quantity} min="1" onChange={(e) => updateItem(i, "quantity", Number(e.target.value))} required/></td>
          <td>{money(item.unitPriceCents)}</td>
          <td className="number">{money(item.quantity * item.unitPriceCents)}</td>
          <td/>
        </tr>)}
      </tbody></table>
      {form.items.map((item, i) => <TrackingAllocationEditor key={`return-tracking-${item.deliveryItemId || item.receiptItemId || i}`} product={products.find((product) => product.id === item.productId)} warehouseId={form.warehouseId} quantity={item.quantity} businessDate={form.returnDate} direction={tab === 'sales' ? 'RETURN_IN' : 'OUT'} value={item.trackingAllocations || []} sourceAllocations={item.sourceAllocations || []} onChange={(trackingAllocations) => updateItem(i, 'trackingAllocations', trackingAllocations)} notify={notify}/>)}
      <div className="line-total">合计：<strong>{money(totalCents)}</strong></div>
    </div>
    <LogisticsActions existing={Boolean(value.id)} onClose={onClose} onAction={changeState}/>
  </form></Modal>;
}
// InventoryTransactions
export function InventoryTransactions({ user, notify }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [warehouses, setWarehouses] = useState([]); const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState({ warehouse: '', product: '', direction: '', startDate: '', endDate: '' });
  const load = () => { const params = new URLSearchParams({ search, type, ...filters }); return api('/api/inventory-transactions?' + params).then((r) => setItems(r.inventoryTransactions || [])).catch((e) => notify(e.message, 'error')); };
  useEffect(() => { Promise.all([api('/api/warehouses'), api('/api/products')]).then(([w, p]) => { setWarehouses(w.warehouses || []); setProducts(p.products || []); }).catch((e) => notify(e.message, 'error')); }, []);
  useEffect(() => { void load(); }, [type, filters.warehouse, filters.product, filters.direction, filters.startDate, filters.endDate]);
  const sourcePage = (sourceType) => ({ PRODUCTION_MATERIAL_ISSUE: 'material-issues', PRODUCTION_RECEIPT: 'production-receipts' }[sourceType] || null);
  const typeMap = {
    PURCHASE_RECEIPT: "采购入库",
    SALES_DELIVERY: "销售出货",
    SALES_RETURN: "销售退货",
    PURCHASE_RETURN: "采购退货",
    INVENTORY_CHECK: "库存盘点",
    INVENTORY_TRANSFER: "库存调拨",
    INVENTORY_ADJUSTMENT: "库存调整",
    PRODUCTION_OUTPUT: "生产完工入库",
    PRODUCTION_ORDER: "生产领料",
    PRODUCTION_MATERIAL_ISSUE: "用料出库",
    PRODUCTION_RECEIPT: "生产入库",
    PRODUCTION_MATERIAL_RETURN: "生产退料",
    PRODUCTION_RECEIPT_REVERSAL: "生产入库冲销"
  };
  return <Panel title="库存异动">
    <Toolbar search={search} setSearch={setSearch} onSearch={load} placeholder="搜索单号或货品" extra={<select value={type} onChange={(e) => setType(e.target.value)}><option value="">全部来源</option>{Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}/>
    <div className="toolbar movement-filters"><select value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}><option value="">全部货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select><select value={filters.warehouse} onChange={(e) => setFilters({ ...filters, warehouse: e.target.value })}><option value="">全部仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select><select value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value })}><option value="">全部方向</option><option value="IN">入库</option><option value="OUT">出库</option></select><input aria-label="开始日期" type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}/><input aria-label="结束日期" type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}/></div>
    <div className="table-wrap"><table><thead><tr><th>业务日期</th><th>来源类型</th><th>来源单号</th><th>仓库</th><th>货品</th><th>批次 / 序列号</th><th>方向</th><th className="number">数量</th><th className="number">变动后库存</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.id}><td>{item.business_date || '业务日期缺失'}</td><td><Status status={item.tx_type?.toLowerCase()} label={typeMap[item.tx_type] || '库存异动'}/></td><td className="mono">{sourcePage(item.tx_type) && item.source_id ? <AppLink page={sourcePage(item.tx_type)} documentId={item.source_id} documentType={item.tx_type}>{item.ref_no}</AppLink> : (item.ref_no || '—')}</td><td>{item.warehouseName}</td><td><strong>{item.productName}</strong><small className="block mono">{item.productCode}</small></td><td className="mono">{item.trackingPolicy === 'NONE' ? '—' : (item.trackingIdentities || '历史记录未采集')}</td><td>{presentBusinessValue('inventoryDirection', item.direction).label}</td><td className={"number " + (item.direction === 'IN' ? "positive" : "negative")}>{quantity(item.quantity_change)}</td><td className="number">{quantity(item.balance)}</td></tr>)}
    </tbody></table>{!items.length && <Empty text="没有库存异动记录"/>}</div>
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
      {items.map((item) => <tr key={item.id} onClick={() => setView({ id: item.id })} style={{cursor:'pointer'}}><td className="mono">{item.source_type === 'SALES_ORDER' ? '销售订单' : '销售出货'}</td><td>{item.customerName}</td><td className="number">{money(item.amount_cents)}</td><td className="number">{money(item.paid_cents)}</td><td className="number positive">{money(item.unpaidCents)}</td><td><Status status={item.status?.toLowerCase()} label={item.statusLabel}/></td><td>{item.due_date || '-'}</td></tr>)}
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
      notify('应收账款已创建');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <Modal title={value.id ? '应收账款详情' : '手工创建应收'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>客户<select value={form.customerId} onChange={(e) => setForm({...form, customerId: e.target.value})} required><option value="">选择客户</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}</select></label>
    <label>应收金额（元）<YuanField valueCents={form.amountCents} onChangeCents={(amountCents) => setForm({...form, amountCents})} min={0.01} required/></label>
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
      notify('应付账款已创建');
      onClose();
    } catch (e) { notify(e.message, 'error'); }
  };
  return <Modal title={value.id ? '应付账款详情' : '手工创建应付'} onClose={onClose} wide><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <label>供应商<select value={form.supplierId} onChange={(e) => setForm({...form, supplierId: e.target.value})} required><option value="">选择供应商</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}</select></label>
    <label>应付金额（元）<YuanField valueCents={form.amountCents} onChangeCents={(amountCents) => setForm({...form, amountCents})} min={0.01} required/></label>
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
      notify('收款单已创建');
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
          <td className="number">{money(item.receivableId ? (receivables.find((r) => r.id === item.receivableId)?.unpaidCents || 0) : 0)}</td>
          <td><YuanField ariaLabel="本次收款（元）" valueCents={item.amountCents} min={0.01} onChangeCents={(value) => updateItem(i, 'amountCents', value)} required/></td>
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
      notify('付款单已创建');
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
          <td className="number">{money(item.payableId ? (payables.find((p) => p.id === item.payableId)?.unpaidCents || 0) : 0)}</td>
          <td><YuanField ariaLabel="本次付款（元）" valueCents={item.amountCents} min={0.01} onChangeCents={(value) => updateItem(i, 'amountCents', value)} required/></td>
          <td><button type="button" className="danger-text" onClick={() => removeItem(i)}>x</button></td>
        </tr>)}
      </tbody></table>
      <div className="line-total">合计：<strong>{money(totalApplied)}</strong></div>
    </div>
    <FormActions onClose={onClose}/>
  </form></Modal>;
}




// ============ BOM ============
