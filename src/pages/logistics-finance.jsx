import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Active, Empty, FormActions, Loading, Modal, OrderTable, Panel, Status, Toolbar, can, dateTime, money, quantity, YuanField } from '../components/ui.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';
import TrackingAllocationEditor from '../components/TrackingAllocationEditor.jsx';
import { copySourceAllocations } from '../lib/tracking.js';
import { presentBusinessValue, presentStatus } from '../lib/presentation.js';
import { ActionMenu, BusinessAction, BusinessAuditSection, BusinessContentSection, BusinessDangerZone, BusinessPageHeader, BusinessPageShell, BusinessRelationSection, BusinessState, CompactRecord, CompactRecordList, DangerSheet, EmptyState, FilterButton, FilterSheet, HelpDisclosure, SearchField, SegmentedControl, StatusChip } from '../components/design-system.jsx';

const PURCHASE_RECEIPT_STATUS_PRESENTATION = {
  DRAFT: { label: '草稿', tone: 'draft' },
  CONFIRMED: { label: '已确认', tone: 'confirmed' },
  CANCELLED: { label: '已取消', tone: 'cancelled' },
};
function purchaseReceiptStatusPresentation(status) {
  return PURCHASE_RECEIPT_STATUS_PRESENTATION[status] || { label: '—', tone: 'draft' };
}

const PURCHASE_RECEIPT_QUALITY_LABEL = {
  WAIVED: '免检',
  NOT_INSPECTED: '未检验',
  INSPECTION_DRAFT: '检验中',
  PASS: '检验合格',
  FAIL: '检验不合格',
  STALE: '需复检',
};
function purchaseReceiptQualityLabel(quality) {
  if (!quality || !quality.code) return '无需检验';
  return PURCHASE_RECEIPT_QUALITY_LABEL[quality.code] || quality.label || '无需检验';
}

function purchaseReceiptListQualityLabel(quality) {
  const label = purchaseReceiptQualityLabel(quality);
  return label === '无需检验' ? '' : `IQC ${label.replace(/^IQC\s*/i, '')}`;
}

const SALES_DELIVERY_STATUS_PRESENTATION = {
  DRAFT: { label: '草稿', tone: 'draft' },
  CONFIRMED: { label: '已确认', tone: 'confirmed' },
  CANCELLED: { label: '已取消', tone: 'cancelled' },
};
function salesDeliveryStatusPresentation(status) {
  return SALES_DELIVERY_STATUS_PRESENTATION[status] || { label: '—', tone: 'draft' };
}

const SALES_DELIVERY_QUALITY_LABEL = {
  WAIVED: '免检',
  NOT_INSPECTED: '未检验',
  INSPECTION_DRAFT: '检验中',
  PASS: '检验合格',
  FAIL: '检验不合格',
  STALE: '需复检',
};
function salesDeliveryQualityLabel(quality) {
  if (!quality || !quality.code) return '无需检验';
  return SALES_DELIVERY_QUALITY_LABEL[quality.code] || quality.label || '无需检验';
}
function salesDeliveryListQualityLabel(quality) {
  const label = salesDeliveryQualityLabel(quality);
  return label === '无需检验' ? '' : `OQC ${label.replace(/^OQC\s*/i, '')}`;
}

function compactBusinessDate(value) {
  if (!value) return '—';
  const match = String(value).match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}` : value;
}

const BILLING_MODE_LABEL = {
  SEPARATE: '独立建账',
  AUTO_BILL: '自动建账',
  LEGACY_DIRECT: '历史直接结算',
};
function billingModeLabel(raw) {
  if (!raw) return '—';
  return BILLING_MODE_LABEL[raw] || raw;
}

function purchaseReceiptRowQuantity(item) {
  const received = Number(item.billedQuantity || 0) + Number(item.remainingBillQuantity || 0);
  if (received > 0 && item.unit) return `${received} ${item.unit}`;
  const itemCount = Number(item.itemCount || 0);
  if (itemCount > 0) return `${itemCount} 项`;
  return '—';
}

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
    {relation.finance && <section className="finance-trace"><h4>财务影响</h4>{relation.finance.type === 'FINANCIAL_RECORD' ? <p>已产生财务记录</p> : <div className="detail-grid"><div><span>凭证号</span><strong className="mono">{relation.finance.documentNo}</strong></div><div><span>状态</span><strong>{presentStatus(relation.finance.status).label}</strong></div><div><span>金额</span><strong>{money(relation.finance.amountCents)}</strong></div></div>}</section>}
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
  const navigation = useAppNavigation();
  const setHeaderBackAction = navigation?.setHeaderBackAction;
  const { target } = navigation || {};
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(
    target?.page === 'purchase-receipts' && target.documentId ? target.documentId : null,
  );
  const [editor, setEditor] = useState(null);
  const [listState, setListState] = useState('LOADING');

  async function load(nextSearch = search, nextStatus = status, nextArchived = includeArchived) {
    setListState('LOADING');
    try {
      const params = new URLSearchParams({
        search: nextSearch,
        status: nextStatus,
        includeArchived: String(nextArchived),
      });
      const response = await api('/api/purchase-receipts?' + params.toString());
      const list = response.purchaseReceipts || [];
      setItems(list);
      if (list.length) setListState('READY');
      else if (nextSearch || nextStatus || nextArchived) setListState('NO_RESULTS');
      else setListState('EMPTY');
    } catch (error) {
      setListState('ERROR');
      notify(error.message, 'error');
    }
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setIncludeArchived(false);
    void load('', '', false);
  }

  function returnToList() {
    setEditor(null);
    setSelectedId(null);
    void load();
  }

  function closeEditorOnly() {
    setEditor(null);
  }

  // P3.1: surface exactly one MobileShell header back affordance.
  useEffect(() => {
    const handler = editor
      ? (selectedId ? closeEditorOnly : returnToList)
      : (selectedId ? returnToList : null);
    if (setHeaderBackAction) setHeaderBackAction(handler);
    return () => { if (setHeaderBackAction) setHeaderBackAction(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selectedId]);

  useEffect(() => {
    void load(search, status, includeArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, includeArchived]);

  if (editor) {
    const fromDetail = Boolean(selectedId);
    return (
      <BusinessPageShell className="purchase-receipt-editor-v16 v16-purchase-receipts" width="rail">
        <PurchaseReceiptEditorV16
          order={editor}
          user={user}
          notify={notify}
          onClose={() => {
            setEditor(null);
            if (fromDetail) {
              // keep detail mounted; it reloads via its own effect.
            }
          }}
          onSaved={(created) => {
            setEditor(null);
            if (fromDetail) {
              return;
            } else if (created && created.id) {
              setSelectedId(created.id);
              void load();
            } else {
              setSelectedId(null);
              void load();
            }
          }}
        />
      </BusinessPageShell>
    );
  }

  if (selectedId) {
    return (
      <PurchaseReceiptDetailV16
        id={selectedId}
        user={user}
        notify={notify}
        navigation={navigation}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
        onEdit={(value) => setEditor(value)}
        onChanged={() => { setSelectedId(null); void load(); }}
      />
    );
  }

  const canCreate = can(user, 'PURCHASE_RECEIPTS_MANAGE');

  return (
    <BusinessPageShell className="purchase-receipts-v16 v16-purchase-receipts" width="rail">
      <section className="v16-purchase-receipts__command" aria-label="采购入库操作">
        <SearchField value={search} onChange={setSearch} onSubmit={() => load(search, status, includeArchived)} placeholder="搜索单号或供应商" />
        {canCreate && (
          <button
            type="button"
            className="v16-purchase-receipt-new"
            onClick={() => setEditor({})}
            aria-label="新增采购入库"
            data-testid="purchase-receipt-new"
          >
            新建
          </button>
        )}
      </section>

      <section className="v16-purchase-receipts__segments" aria-label="状态筛选">
        <SegmentedControl
          label="单据状态"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: '全部' },
            { value: 'DRAFT', label: '草稿' },
            { value: 'CONFIRMED', label: '已确认' },
            { value: 'CANCELLED', label: '已取消' },
          ]}
        />
      </section>

      <section className="v16-purchase-receipts__archive-toggle" aria-label="归档切换">
        <button
          type="button"
          aria-pressed={includeArchived ? 'true' : 'false'}
          onClick={() => setIncludeArchived((value) => !value)}
          data-testid="purchase-receipt-archive-toggle"
        >
          归档记录
        </button>
      </section>

      {listState === 'LOADING' && (
        <div className="v16-purchase-receipts__list-state" role="status" aria-live="polite">
          <span className="v16-purchase-receipts__list-state-title">加载中</span>
        </div>
      )}

      {listState === 'ERROR' && (
        <div className="v16-purchase-receipts__list-state" role="alert">
          <span className="v16-purchase-receipts__list-state-title">加载失败</span>
          <button
            type="button"
            className="v16-purchase-receipts__list-state-action"
            onClick={() => load(search, status, includeArchived)}
          >
            重试
          </button>
        </div>
      )}

      {listState === 'EMPTY' && (
        <div className="v16-purchase-receipts__list-state">
          <span className="v16-purchase-receipts__list-state-title">暂无采购入库</span>
          {canCreate && (
            <button
              type="button"
              className="v16-purchase-receipts__list-state-action v16-purchase-receipts__list-state-action--primary"
              onClick={() => setEditor({})}
            >
              新建采购入库
            </button>
          )}
        </div>
      )}

      {listState === 'NO_RESULTS' && (
        <div className="v16-purchase-receipts__list-state">
          <span className="v16-purchase-receipts__list-state-title">没有匹配结果</span>
          <button
            type="button"
            className="v16-purchase-receipts__list-state-action"
            onClick={clearFilters}
          >
            清除筛选
          </button>
        </div>
      )}

      {listState === 'READY' && (
        <ul className="v16-purchase-receipt-list" role="list">
          {items.map((item) => (
            <PurchaseReceiptListRowV16
              key={item.id}
              item={item}
              user={user}
              onOpen={() => setSelectedId(item.id)}
              onEdit={(value) => setEditor(value)}
            />
          ))}
        </ul>
      )}
    </BusinessPageShell>
  );
}

function PurchaseReceiptListRowV16({ item, user, onOpen, onEdit }) {
  const presentation = purchaseReceiptStatusPresentation(item.status);
  const archived = Boolean(item.archiveState?.archived);
  const quality = purchaseReceiptListQualityLabel(item.qualityState);
  const canCreate = can(user, 'PURCHASE_RECEIPTS_MANAGE');
  return (
    <li className="v16-purchase-receipt-row" data-testid={"purchase-receipt-row-" + item.id}>
      <button
        type="button"
        className="v16-purchase-receipt-row__open"
        onClick={() => onOpen(item)}
        aria-label={"查看采购入库 " + item.receipt_no}
      >
        <span className="v16-purchase-receipt-row__primary">
          <span className="v16-purchase-receipt-row__number">{item.receipt_no}</span>
          <span
            className={"v16-purchase-receipt-status v16-purchase-receipt-status--" + presentation.tone}
            data-status={item.status}
          >
            {presentation.label}
          </span>
        </span>
        <span className="v16-purchase-receipt-row__secondary">{item.supplierName || '—'}</span>
        <span className="v16-purchase-receipt-row__meta">
          {item.warehouseName || '—'} · {compactBusinessDate(item.receipt_date)} · {money(item.total_cents)}
        </span>
        <span className="v16-purchase-receipt-row__context">
          {purchaseReceiptRowQuantity(item)}
          {quality ? ' · ' + quality : ''}
        </span>
        {archived && (
          <span className="v16-purchase-receipt-row__archive">已归档</span>
        )}
      </button>
      <div className="v16-purchase-receipt-row__overflow">
        <ActionMenu label={"采购入库 " + item.receipt_no + ' 的更多操作'}>
          <button type="button" onClick={() => onOpen(item)}>查看详情</button>
          {canCreate && item.status === 'DRAFT' && (
            <button type="button" onClick={() => onEdit({ id: item.id })}>编辑草稿</button>
          )}
        </ActionMenu>
      </div>
    </li>
  );
}

function PurchaseReceiptDetail({ id, user, notify, onBack, onEdit, onChanged }) {
  // V1.6 P4: legacy detail wrapper kept as a no-op stub. Active
  // purchase-receipt detail flows route through PurchaseReceiptDetailV16
  // mounted by PurchaseReceipts.
  void id; void user; void onBack; void onEdit; void onChanged; void notify;
  return null;
}

function PurchaseReceiptModal({ user, value, onClose, notify, api }) {
  // V1.6 P4: legacy modal wrapper kept as a no-op stub. Sales
  // editor and detail flows use PurchaseReceiptEditorV16 / SalesOrderDetailV16;
  // purchase editor uses PurchaseReceiptEditorV16 mounted by PurchaseReceipts.
  void user; void value; void onClose; void notify; void api;
  return null;
}

function PurchaseReceiptDetailV16({ id, user, notify, navigation, onBack, onEdit, onChanged }) {
  void navigation;
  const [detail, setDetail] = useState(null);
  const [loadState, setLoadState] = useState('LOADING');
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [archiveReason, setArchiveReason] = useState('已取消单据不再参与日常业务处理');

  async function reload() {
    setLoadState('LOADING');
    try {
      const response = await api('/api/purchase-receipts/' + id);
      setDetail(response.purchaseReceipt);
      setLoadState('READY');
    } catch (error) {
      setLoadState('ERROR');
      notify(error.message, 'error');
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);

  async function act(action) {
    setBusy(true);
    try {
      await api('/api/purchase-receipts/' + id, { method: 'POST', body: { action } });
      notify(action === 'confirm' ? '入库单已确认' : '入库单已取消');
      setConfirm(null);
      setReloadKey((v) => v + 1);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function prepareArchive() {
    try {
      const response = await api('/api/lifecycle/analyze?entityType=PURCHASE_RECEIPT&entityId=' + encodeURIComponent(id));
      const eligibility = response.archiveEligibility;
      setDetail((current) => ({ ...current, archiveEligibility: eligibility }));
      if (!eligibility.allowed) {
        return notify(eligibility.blockers?.[0]?.message || '当前单据不能移除', 'error');
      }
      setConfirm('archive');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function archive() {
    try {
      await api('/api/lifecycle/archive', {
        method: 'POST',
        body: { entityType: 'PURCHASE_RECEIPT', entityId: id, reason: archiveReason },
      });
      notify('已归档');
      setConfirm(null);
      await reload();
      await onChanged?.();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function restore() {
    try {
      await api('/api/lifecycle/restore', {
        method: 'POST',
        body: { entityType: 'PURCHASE_RECEIPT', entityId: id, reason: '恢复正常列表可见性' },
      });
      notify('已恢复到业务列表，单据仍为已取消');
      setConfirm(null);
      await reload();
      await onChanged?.();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function createQuality() {
    try {
      await api('/api/iqc', { method: 'POST', body: { purchase_receipt_id: id } });
      notify('IQC 检验草稿已创建');
      setReloadKey((v) => v + 1);
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function goIqc() {
    const inspectionId = detail?.qualityState?.inspectionId;
    if (navigation?.navigateToPage) navigation.navigateToPage('iqc', inspectionId ? {
      documentId: inspectionId,
      documentType: 'IQC_INSPECTION',
      sourcePage: 'purchase-receipts',
      sourceDocumentId: id,
    } : undefined);
  }

  if (loadState === 'ERROR') {
    return (
      <div className="v16-mobile-enterprise v16-purchase-receipt-detail">
        <div className="v16-purchase-receipt-detail__error" role="alert">
          <span className="v16-purchase-receipt-detail__error-title">加载失败</span>
          <div className="v16-purchase-receipt-detail__error-actions">
            <button type="button" onClick={() => setReloadKey((v) => v + 1)}>重试</button>
            <button type="button" onClick={onBack}>返回列表</button>
          </div>
        </div>
      </div>
    );
  }

  if (loadState !== 'READY' || !detail) {
    return (
      <div className="v16-mobile-enterprise v16-purchase-receipt-detail">
        <div className="v16-purchase-receipt-detail__loading" role="status" aria-live="polite">
          <span className="v16-purchase-receipt-detail__loading-title">加载中</span>
        </div>
      </div>
    );
  }

  const presentation = purchaseReceiptStatusPresentation(detail.status);
  const archived = Boolean(detail.archiveState?.archived);
  const canManage = can(user, 'PURCHASE_RECEIPTS_MANAGE');
  const canRestore = can(user, 'USERS_MANAGE');
  const upstream = detail.relationships?.upstream || [];
  const downstream = detail.relationships?.downstream || [];
  const supplierBills = downstream.filter((item) => item.type === 'SUPPLIER_BILL');
  const purchaseReturns = downstream.filter((item) => item.type === 'PURCHASE_RETURN');
  const quality = detail.qualityState || { code: null, label: null };
  const code = quality.code;
  const editable = canManage && detail.status === 'DRAFT';
  const submittable = code === 'PASS' || code === 'WAIVED';
  const notInspected = code === 'NOT_INSPECTED';
  const inspectionDraft = code === 'INSPECTION_DRAFT';
  const needsRetest = code === 'FAIL' || code === 'STALE';

  let primary = null;
  let secondary = null;
  if (detail.status === 'DRAFT') {
    if (submittable) {
      primary = { kind: 'confirm', label: '确认入库' };
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    } else if (notInspected) {
      primary = { kind: 'iqc-create', label: '创建 IQC' };
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    } else if (inspectionDraft) {
      primary = { kind: 'iqc-go', label: '前往 IQC' };
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    } else if (needsRetest) {
      primary = { kind: 'iqc-create', label: '创建 IQC 复检' };
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    }
  }

  function handlePrimary() {
    if (!primary) return;
    if (primary.kind === 'edit') return onEdit(detail);
    if (primary.kind === 'confirm') return setConfirm('confirm');
    if (primary.kind === 'iqc-create') return void createQuality();
    if (primary.kind === 'iqc-go') return goIqc();
  }

  function handleSecondary() {
    if (secondary?.kind === 'edit') onEdit(detail);
  }

  const billingStatus = detail.billingSummary?.status || null;
  const billingMode = detail.billing_mode || null;
  const billingModeText = billingModeLabel(billingMode);
  const billingFilled = Boolean(billingModeText && billingModeText !== '—');

  return (
    <div className="v16-mobile-enterprise v16-purchase-receipt-detail">
      <section className="v16-purchase-receipt-detail__identity" aria-label="采购入库身份">
        <div className="v16-purchase-receipt-detail__identity-row">
          <span className="v16-purchase-receipt-detail__number">{detail.receipt_no}</span>
          <span
            className={"v16-purchase-receipt-status v16-purchase-receipt-status--" + presentation.tone}
            data-status={detail.status}
          >
            {presentation.label}
          </span>
          {archived && (
            <span className="v16-purchase-receipt-detail__archive">已归档</span>
          )}
        </div>
        <span className="v16-purchase-receipt-detail__supplier">{detail.supplierName}</span>
        <span className="v16-purchase-receipt-detail__amount">{money(detail.total_cents)}</span>
      </section>

      <section className="v16-purchase-receipt-detail__sections" aria-label="采购入库章节">
        <details className="v16-purchase-receipt-detail__disclosure" open>
          <summary>概要</summary>
          <div className="v16-purchase-receipt-detail__disclosure-body">
            <dl className="v16-purchase-receipt-detail__kv">
              <div>
                <dt>收货仓库</dt>
                <dd>{detail.warehouseName || '—'}</dd>
              </div>
              <div>
                <dt>收货日期</dt>
                <dd>{detail.receipt_date || '—'}</dd>
              </div>
              <div>
                <dt>计费方式</dt>
                <dd>
                  {billingModeText}
                  {billingFilled && billingMode === 'AUTO_BILL' && (
                    <small>当前设置会自动生成供应商账单</small>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </details>

        <details className="v16-purchase-receipt-detail__disclosure">
          <summary>来源采购订单</summary>
          <div className="v16-purchase-receipt-detail__disclosure-body">
            {upstream.length > 0 ? (
              upstream.map((item) => (
                <div key={item.id} className="v16-purchase-receipt-detail__source-row">
                  <span className="v16-purchase-receipt-detail__source-row-key">采购订单</span>
                  {navigation?.canNavigate?.('purchase-orders') ? (
                    <AppLink
                      page="purchase-orders"
                      documentId={item.id}
                      documentType={item.type}
                      className="v16-purchase-receipt-detail__source-row-value"
                    >
                      {item.documentNo}
                    </AppLink>
                  ) : (
                    <span className="v16-purchase-receipt-detail__source-row-value">{item.documentNo}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="v16-purchase-receipt-detail__source-row">
                <span className="v16-purchase-receipt-detail__source-row-key">采购订单</span>
                <span className="v16-purchase-receipt-detail__source-row-value v16-purchase-receipt-detail__source-row-value--neutral">
                  来源信息不完整
                </span>
              </div>
            )}
          </div>
        </details>

        <details className="v16-purchase-receipt-detail__disclosure" open>
          <summary>
            <span>入库明细</span>
            <span className="v16-purchase-receipt-detail__summary-hint">
              {(detail.items || []).length} 行
            </span>
          </summary>
          <div className="v16-purchase-receipt-detail__disclosure-body">
            <ul className="v16-purchase-receipt-detail__lines">
              {(detail.items || []).map((item) => {
                const ordered = Number(item.orderedQuantity || 0);
                const received = Number(item.receivedQuantity || 0);
                const showSourceLine = ordered > 0;
                const remaining = ordered - received;
                return (
                  <li className="v16-purchase-receipt-detail__line" key={item.id || item.productId}>
                    <div className="v16-purchase-receipt-detail__line-head">
                      <span className="v16-purchase-receipt-detail__line-name">{item.productName || '—'}</span>
                      <span className="v16-purchase-receipt-detail__line-code">{item.productCode || ''}</span>
                    </div>
                    {showSourceLine && (
                      <small className="v16-purchase-receipt-detail__line-source">
                        采购 {quantity(ordered)} · 已收 {quantity(received)} · 剩余 {quantity(remaining)}
                      </small>
                    )}
                    <div className="v16-purchase-receipt-detail__line-meta">
                      <span>{quantity(item.quantity)} {item.unit || ''} × {money(item.unitPriceCents)}</span>
                      <span className="v16-purchase-receipt-detail__line-meta-amount">
                        {money(item.amountCents)}
                      </span>
                    </div>
                    {(item.trackingAllocations || []).length > 0 && (
                      <details className="v16-purchase-receipt-detail__tracking">
                        <summary>批次 / 序列号 {(item.trackingAllocations || []).length} 条</summary>
                        <ul>
                          {item.trackingAllocations.map((allocation, allocationIndex) => (
                            <li key={allocation.id || allocation.lotId || allocation.serialId || allocationIndex}>
                              <span>{allocation.lotCode || allocation.serialNumber || '跟踪信息'}</span>
                              <strong>{quantity(allocation.quantity || 1)}</strong>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="v16-purchase-receipt-detail__total">
              <span>单据合计</span>
              <strong>{money(detail.total_cents)}</strong>
            </div>
          </div>
        </details>

        <details className="v16-purchase-receipt-detail__disclosure">
          <summary>质量</summary>
          <div className="v16-purchase-receipt-detail__disclosure-body">
            <div className="v16-purchase-receipt-detail__quality">
              <strong>IQC</strong>
              <span
                className={"v16-purchase-receipt-quality v16-purchase-receipt-quality--" + (code || '').toLowerCase()}
                data-quality={code || ''}
              >
                {purchaseReceiptQualityLabel(quality)}
              </span>
            </div>
          </div>
        </details>

        <details className="v16-purchase-receipt-detail__disclosure">
          <summary>结算与关联</summary>
          <div className="v16-purchase-receipt-detail__disclosure-body">
            <div className="v16-purchase-receipt-detail__relations">
              <div className="v16-purchase-receipt-detail__relation">
                <span>计费状态</span>
                <strong>{billingStatusLabel(billingStatus) || '—'}</strong>
              </div>
              {supplierBills.length > 0 && (
                <div className="v16-purchase-receipt-detail__relation">
                  <span>供应商账单</span>
                  <strong>{supplierBills.length} 张</strong>
                </div>
              )}
              {purchaseReturns.length > 0 && (
                <div className="v16-purchase-receipt-detail__relation">
                  <span>采购退货</span>
                  <strong>{purchaseReturns.length} 张</strong>
                </div>
              )}
              {detail.relationships?.subledger && (
                <div className="v16-purchase-receipt-detail__relation">
                  <span>应付记录</span>
                  <strong className="mono">{detail.relationships.subledger.documentNo}</strong>
                </div>
              )}
            </div>
          </div>
        </details>

        <details className="v16-purchase-receipt-detail__disclosure">
          <summary>
            <span>操作记录</span>
            <span className="v16-purchase-receipt-detail__summary-hint">
              {(detail.creatorName ? 1 : 0) + (detail.confirmedByName ? 1 : 0) + (archived ? 1 : 0)} 条
            </span>
          </summary>
          <div className="v16-purchase-receipt-detail__disclosure-body">
            <div className="v16-purchase-receipt-detail__history">
              {detail.creatorName && (
                <div className="v16-purchase-receipt-detail__relation">
                  <span>制单人</span>
                  <strong>{detail.creatorName}</strong>
                </div>
              )}
              {detail.confirmedByName && (
                <div className="v16-purchase-receipt-detail__relation">
                  <span>确认人</span>
                  <strong>{detail.confirmedByName}</strong>
                </div>
              )}
              {archived && (
                <>
                  <div className="v16-purchase-receipt-detail__relation">
                    <span>归档时间</span>
                    <strong>{dateTime(detail.archiveState?.archivedAt) || '—'}</strong>
                  </div>
                  {detail.archiveState?.reason && (
                    <div className="v16-purchase-receipt-detail__relation">
                      <span>归档原因</span>
                      <strong>{detail.archiveState.reason}</strong>
                    </div>
                  )}
                </>
              )}
              {!detail.creatorName && !detail.confirmedByName && !archived && (
                <p className="v16-purchase-receipt-detail__history-empty">暂无操作记录</p>
              )}
            </div>
          </div>
        </details>

        {((detail.status === 'DRAFT' && canManage) ||
          (detail.status === 'CANCELLED' && !archived && canManage) ||
          (archived && canRestore)) && (
          <details className="v16-purchase-receipt-detail__disclosure">
            <summary>管理</summary>
            <div className="v16-purchase-receipt-detail__disclosure-body">
              <div className="v16-purchase-receipt-detail__management">
                {detail.status === 'DRAFT' && canManage && (
                  <div className="v16-purchase-receipt-detail__management-row">
                    <span>取消这张单据</span>
                    <button
                      type="button"
                      className="v16-purchase-receipt-detail__management-button v16-purchase-receipt-detail__management-button--danger"
                      onClick={() => setConfirm('cancel')}
                    >
                      取消
                    </button>
                  </div>
                )}
                {detail.status === 'CANCELLED' && !archived && canManage && (
                  <div className="v16-purchase-receipt-detail__management-row">
                    <span>从业务列表移除</span>
                    <button
                      type="button"
                      className="v16-purchase-receipt-detail__management-button v16-purchase-receipt-detail__management-button--danger"
                      onClick={prepareArchive}
                    >
                      从列表移除
                    </button>
                  </div>
                )}
                {archived && canRestore && (
                  <div className="v16-purchase-receipt-detail__management-row">
                    <span>恢复到业务列表</span>
                    <button
                      type="button"
                      className="v16-purchase-receipt-detail__management-button"
                      onClick={() => setConfirm('restore')}
                    >
                      恢复
                    </button>
                  </div>
                )}
              </div>
            </div>
          </details>
        )}
      </section>

      {(primary || secondary) && (
        <div className="v16-purchase-receipt-detail__action-bar" role="group" aria-label="采购入库操作">
          {secondary && (
            <button type="button" className="secondary" onClick={handleSecondary} data-testid="purchase-receipt-action-secondary">
              {secondary.label}
            </button>
          )}
          {primary && (
            <button
              type="button"
              className="primary"
              onClick={handlePrimary}
              disabled={busy}
              data-testid="purchase-receipt-action-primary"
            >
              {primary.label}
            </button>
          )}
        </div>
      )}

      {confirm === 'confirm' && (
        <DangerSheet
          title="确认采购入库？"
          confirmLabel="确认入库"
          onClose={() => setConfirm(null)}
          onConfirm={() => act('confirm')}
        >
          <p>
            确认后将按本单数量增加库存，入库日期和来源采购订单将作为业务依据。
            {billingMode === 'AUTO_BILL' && (
              <span><br />当前设置会自动生成供应商账单。</span>
            )}
          </p>
        </DangerSheet>
      )}

      {confirm === 'cancel' && (
        <DangerSheet
          title="取消这张采购入库单？"
          confirmLabel="确认取消"
          onClose={() => setConfirm(null)}
          onConfirm={() => act('cancel')}
        >
          <p>取消后该单据将不能继续编辑或确认，也不会增加库存。</p>
        </DangerSheet>
      )}

      {confirm === 'archive' && (
        <DangerSheet
          title="从业务列表移除？"
          confirmLabel="从列表移除"
          onClose={() => setConfirm(null)}
          onConfirm={archive}
        >
          <p>该采购入库单将从正常业务列表中移除，并保留在归档记录中。<br />原单据、明细和审计记录不会被删除，有权限的管理员可以恢复。</p>
          <label>归档原因<textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength="500" required /></label>
        </DangerSheet>
      )}

      {confirm === 'restore' && (
        <DangerSheet
          title="恢复到业务列表？"
          confirmLabel="确认恢复"
          onClose={() => setConfirm(null)}
          onConfirm={restore}
        >
          <p>恢复后该单据会重新出现在业务列表中，但仍保持“已取消”，不会恢复库存或财务效果。</p>
        </DangerSheet>
      )}
    </div>
  );
}

function PurchaseReceiptEditorV16({ order, user, notify, onClose, onSaved }) {
  void user;
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [loading, setLoading] = useState(Boolean(order.id));
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    purchaseOrderId: '',
    supplierId: '',
    warehouseId: '',
    receiptDate: today,
    billingMode: 'SEPARATE',
    remark: '',
    items: [],
  });

  useEffect(() => {
    setLoadError('');
    if (order.id) setLoading(true);
    Promise.all([
      api('/api/lookup/suppliers').catch((e) => notify(e.message, 'error')),
      api('/api/warehouses').catch((e) => notify(e.message, 'error')),
      api('/api/products').catch((e) => notify(e.message, 'error')),
      api('/api/lookup/purchase-orders-source').catch((e) => notify('来源采购订单加载失败，请重试。', 'error')),
      order.id ? api('/api/purchase-receipts/' + order.id).catch((e) => {
        setLoadError(e.message || '采购入库单加载失败，请重试。');
        notify(e.message || '采购入库单加载失败，请重试。', 'error');
        return null;
      }) : Promise.resolve(null),
    ]).then(([suppliersRes, warehousesRes, productsRes, posRes, detailRes]) => {
      if (suppliersRes) setSuppliers(suppliersRes.suppliers || []);
      if (warehousesRes) setWarehouses(warehousesRes.warehouses || []);
      if (productsRes) setProducts(productsRes.products || []);
      if (posRes) setPurchaseOrders(posRes.purchaseOrders || []);
      if (detailRes && detailRes.purchaseReceipt) {
        const d = detailRes.purchaseReceipt;
        setForm({
          purchaseOrderId: d.purchase_order_id || '',
          supplierId: d.supplier_id || '',
          warehouseId: d.warehouse_id || '',
          receiptDate: d.receipt_date || today,
          billingMode: d.billing_mode || 'SEPARATE',
          remark: d.remark || '',
          items: (d.items || []).map((item) => ({
            ...item,
            sourceAllocations: copySourceAllocations(item.trackingAllocations),
          })),
        });
      }
    }).finally(() => setLoading(false));
  }, [retryKey]);

  function setItems(items) {
    setForm((f) => ({ ...f, items }));
  }

  function choosePurchaseOrder(purchaseOrderId) {
    if (!purchaseOrderId) return setForm((current) => ({ ...current, purchaseOrderId: '' }));
    const orderMatch = purchaseOrders.find((o) => o.id === purchaseOrderId);
    if (!orderMatch) return;
    setForm((current) => ({
      ...current,
      purchaseOrderId,
      supplierId: orderMatch.supplierId,
      items: (orderMatch.items || []).filter((item) => item.quantity > 0).map((item) => ({
        purchaseOrderItemId: item.purchaseOrderItemId,
        productId: item.productId,
        quantity: item.quantity,
        orderedQuantity: item.orderedQuantity,
        receivedQuantity: item.receivedQuantity,
        unitPriceCents: item.unitPriceCents,
        trackingAllocations: copySourceAllocations(item.trackingAllocations),
      })),
    }));
  }

  function updateItem(index, patch) {
    setItems(form.items.map((item, idx) => {
      if (idx !== index) return item;
      const next = { ...item, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'quantity')) {
        next.trackingAllocations = [];
      }
      return next;
    }));
  }

  const totalCents = form.items.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitPriceCents || 0)), 0);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = {
        purchaseOrderId: form.purchaseOrderId,
        supplierId: form.supplierId,
        warehouseId: form.warehouseId,
        receiptDate: form.receiptDate,
        billingMode: form.billingMode,
        remark: form.remark,
        items: form.items.map((item) => ({
          purchaseOrderItemId: item.purchaseOrderItemId,
          productId: item.productId,
          quantity: Number(item.quantity),
          unitPriceCents: Number(item.unitPriceCents),
          trackingAllocations: item.trackingAllocations || [],
        })),
      };
      if (order.id) {
        await api('/api/purchase-receipts/' + order.id, { method: 'PATCH', body });
        notify('采购入库草稿已保存');
        onSaved?.();
      } else {
        const response = await api('/api/purchase-receipts', { method: 'POST', body });
        const createdId = response?.purchaseReceipt?.id || response?.id;
        notify('采购入库草稿已保存');
        onSaved?.(createdId ? { id: createdId } : null);
      }
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="v16-mobile-enterprise v16-purchase-receipt-editor">
        <div className="v16-purchase-receipt-detail__loading" role="status" aria-live="polite">
          <span className="v16-purchase-receipt-detail__loading-title">加载中</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="v16-mobile-enterprise v16-purchase-receipt-editor">
        <div className="v16-purchase-receipt-detail__error" role="alert">
          <strong className="v16-purchase-receipt-detail__error-title">采购入库单加载失败</strong>
          <span>{loadError}</span>
          <div className="v16-purchase-receipt-detail__error-actions">
            <button type="button" className="secondary" onClick={onClose}>返回</button>
            <button type="button" className="primary" onClick={() => setRetryKey((value) => value + 1)}>重试</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="v16-mobile-enterprise v16-purchase-receipt-editor">
      <section className="v16-purchase-receipt-editor__title">
        <small>{order.id ? '编辑采购入库' : '新建采购入库'}</small>
        <strong>{order.receipt_no || ' '}</strong>
      </section>

      <form onSubmit={save}>
        <section className="v16-purchase-receipt-editor__section" aria-label="来源采购订单">
          <h2>来源采购订单</h2>
          <label>
            来源采购订单
            <select
              value={form.purchaseOrderId}
              onChange={(e) => choosePurchaseOrder(e.target.value)}
              required
              disabled={Boolean(order.id)}
            >
              <option value="">选择已审批采购订单</option>
              {purchaseOrders.map((o) => (
                <option key={o.id} value={o.id}>{o.orderNo} · {o.supplierName}</option>
              ))}
            </select>
          </label>
          <label>
            供应商
            <select value={form.supplierId} disabled required>
              <option value="">由采购订单带入</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="v16-purchase-receipt-editor__section" aria-label="收货信息">
          <h2>收货信息</h2>
          <label>
            收货仓库
            <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
              <option value="">选择仓库</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
              ))}
            </select>
          </label>
          <label>
            收货日期
            <input type="date" value={form.receiptDate} onChange={(e) => setForm({ ...form, receiptDate: e.target.value })} required />
          </label>
        </section>

        <section className="v16-purchase-receipt-editor__section" aria-label="入库明细">
          <h2>入库明细</h2>
          <ul className="v16-purchase-receipt-editor__lines">
            {form.items.map((item, index) => {
              const product = products.find((p) => p.id === item.productId);
              const remaining = Math.max(0, (Number(item.orderedQuantity || 0)) - (Number(item.receivedQuantity || 0)));
              return (
                <li className="v16-purchase-receipt-editor__line" key={item.purchaseOrderItemId || index}>
                  <div className="v16-purchase-receipt-editor__line-head">
                    <span>明细 {index + 1}</span>
                    <span>{product?.code || item.productId}</span>
                  </div>
                  <label>
                    产品
                    <select value={item.productId} disabled required>
                      <option value="">选择货品</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.code} - {p.name}</option>
                      ))}
                    </select>
                  </label>
                  <small className="v16-purchase-receipt-editor__line-source">
                    采购 {quantity(item.orderedQuantity || 0)} · 已收 {quantity(item.receivedQuantity || 0)} · 剩余 {quantity(remaining)}
                  </small>
                  <label>
                    本次入库
                    <input
                      type="number"
                      min="1"
                      max={remaining || undefined}
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                      required
                    />
                  </label>
                  <div className="v16-purchase-receipt-editor__line-foot">
                    <span>采购单价 {money(item.unitPriceCents)}</span>
                    <strong>{money(Number(item.quantity || 0) * Number(item.unitPriceCents || 0))}</strong>
                  </div>
                  {product && (
                    <TrackingAllocationEditor
                      product={product}
                      warehouseId={form.warehouseId}
                      quantity={Number(item.quantity || 0)}
                      businessDate={form.receiptDate}
                      direction="IN"
                      value={item.trackingAllocations || []}
                      onChange={(trackingAllocations) => updateItem(index, { trackingAllocations })}
                      notify={notify}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <details className="v16-purchase-receipt-editor__disclosure">
          <summary>计费与备注</summary>
          <div className="v16-purchase-receipt-editor__disclosure-body">
            <label>
              计费模式
              <select value={form.billingMode} onChange={(e) => setForm({ ...form, billingMode: e.target.value })}>
                <option value="SEPARATE">独立建账</option>
                <option value="AUTO_BILL">自动建账</option>
                {form.billingMode === 'LEGACY_DIRECT' && (
                  <option value="LEGACY_DIRECT">历史直接结算</option>
                )}
              </select>
            </label>
            <label>
              备注
              <textarea
                value={form.remark}
                onChange={(e) => setForm({ ...form, remark: e.target.value })}
                placeholder="选填"
              />
            </label>
          </div>
        </details>

        <section className="v16-purchase-receipt-editor__section" aria-label="单据合计">
          <div className="v16-purchase-receipt-editor__total">
            <span>单据合计</span>
            <strong>{money(totalCents)}</strong>
          </div>
        </section>

        <div className="v16-purchase-receipt-editor__action-bar" role="group" aria-label="编辑器操作">
          <button type="button" className="secondary" onClick={onClose}>取消</button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? '保存中…' : '保存草稿'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SalesDeliveries({ user, notify }) {
  const navigation = useAppNavigation();
  const setHeaderBackAction = navigation?.setHeaderBackAction;
  const { target } = navigation || {};
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(
    target?.page === 'sales-deliveries' && target.documentId ? target.documentId : null,
  );
  const [editor, setEditor] = useState(null);
  const [listState, setListState] = useState('LOADING');

  async function load(nextSearch = search, nextStatus = status, nextArchived = includeArchived) {
    setListState('LOADING');
    try {
      const params = new URLSearchParams({ search: nextSearch, status: nextStatus, includeArchived: String(nextArchived) });
      const response = await api('/api/sales-deliveries?' + params.toString());
      const list = response.salesDeliveries || [];
      setItems(list);
      if (list.length) setListState('READY');
      else if (nextSearch || nextStatus || nextArchived) setListState('NO_RESULTS');
      else setListState('EMPTY');
    } catch (error) {
      setListState('ERROR');
      notify(error.message, 'error');
    }
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setIncludeArchived(false);
    void load('', '', false);
  }

  function returnToList() {
    setEditor(null);
    setSelectedId(null);
    void load();
  }

  function closeEditorOnly() {
    setEditor(null);
  }

  useEffect(() => {
    const handler = editor
      ? (selectedId ? closeEditorOnly : returnToList)
      : (selectedId ? returnToList : null);
    if (setHeaderBackAction) setHeaderBackAction(handler);
    return () => { if (setHeaderBackAction) setHeaderBackAction(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selectedId]);

  useEffect(() => {
    void load(search, status, includeArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, includeArchived]);

  if (editor) {
    return (
      <BusinessPageShell className="sales-delivery-editor-v16 v16-sales-deliveries" width="rail">
        <SalesDeliveryModal
          user={user}
          value={editor}
          notify={notify}
          api={api}
          onClose={() => { setEditor(null); }}
        />
      </BusinessPageShell>
    );
  }

  if (selectedId) {
    return (
      <SalesDeliveryDetailV16
        id={selectedId}
        user={user}
        notify={notify}
        navigation={navigation}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
        onEdit={(value) => setEditor(value)}
        onChanged={() => { setSelectedId(null); void load(); }}
      />
    );
  }

  const canCreate = can(user, 'SALES_DELIVERIES_MANAGE');

  return (
    <BusinessPageShell className="sales-deliveries-v16 v16-sales-deliveries" width="rail">
      <section className="v16-sales-deliveries__command" aria-label="销售出库操作">
        <SearchField value={search} onChange={setSearch} onSubmit={() => load(search, status, includeArchived)} placeholder="搜索单号或客户" />
        {canCreate && (
          <button
            type="button"
            className="v16-sales-delivery-new"
            onClick={() => setEditor({})}
            aria-label="新增销售出库"
            data-testid="sales-delivery-new"
          >
            新建
          </button>
        )}
      </section>

      <section className="v16-sales-deliveries__segments" aria-label="状态筛选">
        <SegmentedControl
          label="单据状态"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: '全部' },
            { value: 'DRAFT', label: '草稿' },
            { value: 'CONFIRMED', label: '已确认' },
            { value: 'CANCELLED', label: '已取消' },
          ]}
        />
      </section>

      <section className="v16-sales-deliveries__archive-toggle" aria-label="归档切换">
        <button
          type="button"
          aria-pressed={includeArchived ? 'true' : 'false'}
          onClick={() => setIncludeArchived((value) => !value)}
          data-testid="sales-delivery-archive-toggle"
        >
          归档记录
        </button>
      </section>

      {listState === 'LOADING' && (
        <div className="v16-sales-deliveries__list-state" role="status" aria-live="polite">
          <span className="v16-sales-deliveries__list-state-title">加载中</span>
        </div>
      )}

      {listState === 'ERROR' && (
        <div className="v16-sales-deliveries__list-state" role="alert">
          <span className="v16-sales-deliveries__list-state-title">加载失败</span>
          <button
            type="button"
            className="v16-sales-deliveries__list-state-action"
            onClick={() => load(search, status, includeArchived)}
          >
            重试
          </button>
        </div>
      )}

      {listState === 'EMPTY' && (
        <div className="v16-sales-deliveries__list-state">
          <span className="v16-sales-deliveries__list-state-title">暂无销售出库</span>
          {canCreate && (
            <button
              type="button"
              className="v16-sales-deliveries__list-state-action v16-sales-deliveries__list-state-action--primary"
              onClick={() => setEditor({})}
            >
              新建销售出库
            </button>
          )}
        </div>
      )}

      {listState === 'NO_RESULTS' && (
        <div className="v16-sales-deliveries__list-state">
          <span className="v16-sales-deliveries__list-state-title">没有匹配结果</span>
          <button
            type="button"
            className="v16-sales-deliveries__list-state-action"
            onClick={clearFilters}
          >
            清除筛选
          </button>
        </div>
      )}

      {listState === 'READY' && (
        <ul className="v16-sales-delivery-list" role="list">
          {items.map((item) => (
            <SalesDeliveryListRowV16
              key={item.id}
              item={item}
              user={user}
              onOpen={() => setSelectedId(item.id)}
              onEdit={(value) => setEditor(value)}
            />
          ))}
        </ul>
      )}
    </BusinessPageShell>
  );
}

function SalesDeliveryListRowV16({ item, user, onOpen, onEdit }) {
  const presentation = salesDeliveryStatusPresentation(item.status);
  const archived = Boolean(item.archiveState?.archived);
  const quality = salesDeliveryListQualityLabel(item.qualityState);
  const canManage = can(user, 'SALES_DELIVERIES_MANAGE');
  return (
    <li className="v16-sales-delivery-row" data-testid={"sales-delivery-row-" + item.id}>
      <button
        type="button"
        className="v16-sales-delivery-row__open"
        onClick={() => onOpen(item)}
        aria-label={"查看销售出库 " + item.delivery_no}
      >
        <span className="v16-sales-delivery-row__primary">
          <span className="v16-sales-delivery-row__number">{item.delivery_no}</span>
          <span
            className={"v16-sales-delivery-status v16-sales-delivery-status--" + presentation.tone}
            data-status={item.status}
          >
            {presentation.label}
          </span>
        </span>
        <span className="v16-sales-delivery-row__secondary">{item.customerName}</span>
        <span className="v16-sales-delivery-row__meta">
          {item.warehouseName} · {item.delivery_date} · {money(item.total_cents)}
        </span>
        <span className="v16-sales-delivery-row__context">
          {quality ? quality + ' · ' : ''}
          {item.itemCount ? `${item.itemCount} 项` : ''}
        </span>
        {archived && (
          <span className="v16-sales-delivery-row__archive">已归档</span>
        )}
      </button>
      <div className="v16-sales-delivery-row__overflow">
        <ActionMenu label={"销售出库 " + item.delivery_no + " 的更多操作"}>
          <button type="button" onClick={() => onOpen(item)}>查看详情</button>
          {canManage && item.status === 'DRAFT' && (
            <button type="button" onClick={() => onEdit(item)}>编辑草稿</button>
          )}
        </ActionMenu>
      </div>
    </li>
  );
}

function SalesDeliveryDetailV16({ id, user, notify, navigation, onBack, onEdit, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [loadState, setLoadState] = useState('LOADING');
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [archiveReason, setArchiveReason] = useState('已取消单据不再参与日常业务处理');

  async function reload() {
    setLoadState('LOADING');
    try {
      const response = await api('/api/sales-deliveries/' + id);
      setDetail(response.salesDelivery);
      setLoadState('READY');
    } catch (error) {
      setLoadState('ERROR');
      notify(error.message, 'error');
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);

  async function act(action) {
    setBusy(true);
    try {
      await api('/api/sales-deliveries/' + id, { method: 'POST', body: { action } });
      notify(action === 'confirm' ? '出库单已确认' : '出库单已取消');
      setConfirm(null);
      setReloadKey((v) => v + 1);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function prepareArchive() {
    try {
      const response = await api('/api/lifecycle/analyze?entityType=SALES_DELIVERY&entityId=' + encodeURIComponent(id));
      const eligibility = response.archiveEligibility;
      setDetail((current) => ({ ...current, archiveEligibility: eligibility }));
      if (!eligibility.allowed) {
        return notify(eligibility.blockers?.[0]?.message || '当前单据不能移除', 'error');
      }
      setConfirm('archive');
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function archive() {
    try {
      await api('/api/lifecycle/archive', {
        method: 'POST',
        body: { entityType: 'SALES_DELIVERY', entityId: id, reason: archiveReason },
      });
      notify('已归档');
      setConfirm(null);
      await reload();
      await onChanged?.();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function restore() {
    try {
      await api('/api/lifecycle/restore', {
        method: 'POST',
        body: { entityType: 'SALES_DELIVERY', entityId: id, reason: '恢复正常列表可见性' },
      });
      notify('已恢复到业务列表，单据仍为已取消');
      setConfirm(null);
      await reload();
      await onChanged?.();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function createQuality() {
    try {
      const created = await api('/api/oqc', { method: 'POST', body: { sales_delivery_id: id } });
      notify('OQC 检验草稿已创建');
      const inspectionId = created?.id;
      if (inspectionId && navigation?.navigateToPage) {
        navigation.navigateToPage('oqc', {
          documentId: inspectionId,
          documentType: 'OQC_INSPECTION',
          sourcePage: 'sales-deliveries',
          sourceDocumentId: id,
        });
      } else {
        setReloadKey((v) => v + 1);
      }
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function goOqc() {
    const inspectionId = detail?.qualityState?.inspectionId;
    if (inspectionId && navigation?.navigateToPage) {
      navigation.navigateToPage('oqc', {
        documentId: inspectionId,
        documentType: 'OQC_INSPECTION',
        sourcePage: 'sales-deliveries',
        sourceDocumentId: id,
      });
    } else if (navigation?.navigateToPage) {
      navigation.navigateToPage('oqc');
    }
  }

  if (loadState === 'ERROR') {
    return (
      <div className="v16-mobile-enterprise v16-sales-delivery-detail">
        <div className="v16-sales-delivery-detail__error" role="alert">
          <span className="v16-sales-delivery-detail__error-title">加载失败</span>
          <div className="v16-sales-delivery-detail__error-actions">
            <button type="button" onClick={() => setReloadKey((v) => v + 1)}>重试</button>
            <button type="button" onClick={onBack}>返回列表</button>
          </div>
        </div>
      </div>
    );
  }

  if (loadState !== 'READY' || !detail) {
    return (
      <div className="v16-mobile-enterprise v16-sales-delivery-detail">
        <div className="v16-sales-delivery-detail__loading" role="status" aria-live="polite">
          <span className="v16-sales-delivery-detail__loading-title">加载中</span>
        </div>
      </div>
    );
  }

  const presentation = salesDeliveryStatusPresentation(detail.status);
  const archived = Boolean(detail.archiveState?.archived);
  const canManage = can(user, 'SALES_DELIVERIES_MANAGE');
  const canRestore = can(user, 'USERS_MANAGE');
  const canManageOqc = can(user, 'OQC_MANAGE');
  const canViewOqc = can(user, 'OQC_VIEW') || canManageOqc;
  const upstream = detail.relationships?.upstream || [];
  const downstream = detail.relationships?.downstream || [];
  const salesInvoices = downstream.filter((item) => item.type === 'SALES_INVOICE');
  const salesReturns = downstream.filter((item) => item.type === 'SALES_RETURN');
  const quality = detail.qualityState || { code: null, label: null };
  const code = quality.code;
  const editable = canManage && detail.status === 'DRAFT';
  const submittable = code === 'PASS' || code === 'WAIVED';
  const notInspected = code === 'NOT_INSPECTED';
  const inspectionDraft = code === 'INSPECTION_DRAFT';
  const needsRetest = code === 'FAIL' || code === 'STALE';

  let primary = null;
  let secondary = null;
  if (detail.status === 'DRAFT') {
    if (submittable) {
      primary = { kind: 'confirm', label: '确认出库' };
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    } else if (notInspected) {
      primary = canManageOqc ? { kind: 'oqc-create', label: '创建 OQC' } : null;
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    } else if (inspectionDraft) {
      primary = canViewOqc ? { kind: 'oqc-go', label: '前往 OQC' } : null;
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    } else if (needsRetest) {
      primary = canManageOqc ? { kind: 'oqc-create', label: '创建 OQC 复检' } : null;
      secondary = editable ? { kind: 'edit', label: '编辑' } : null;
    }
  }

  function handlePrimary() {
    if (!primary) return;
    if (primary.kind === 'edit') return onEdit(detail);
    if (primary.kind === 'confirm') return setConfirm('confirm');
    if (primary.kind === 'oqc-create') return void createQuality();
    if (primary.kind === 'oqc-go') return goOqc();
  }

  function handleSecondary() {
    if (secondary?.kind === 'edit') onEdit(detail);
  }

  const billingStatus = detail.billingSummary?.status || null;
  const billingMode = detail.billing_mode || null;
  const billingModeText = billingModeLabel(billingMode);
  const billingFilled = Boolean(billingModeText && billingModeText !== '—');

  return (
    <div className="v16-mobile-enterprise v16-sales-delivery-detail">
      <section className="v16-sales-delivery-detail__identity" aria-label="销售出库身份">
        <div className="v16-sales-delivery-detail__identity-row">
          <span className="v16-sales-delivery-detail__number">{detail.delivery_no}</span>
          <span
            className={"v16-sales-delivery-status v16-sales-delivery-status--" + presentation.tone}
            data-status={detail.status}
          >
            {presentation.label}
          </span>
          {archived && (
            <span className="v16-sales-delivery-detail__archive">已归档</span>
          )}
        </div>
        <span className="v16-sales-delivery-detail__customer">{detail.customerName}</span>
        <span className="v16-sales-delivery-detail__amount">{money(detail.total_cents)}</span>
      </section>

      <section className="v16-sales-delivery-detail__sections" aria-label="销售出库章节">
        <details className="v16-sales-delivery-detail__disclosure" open>
          <summary>概要</summary>
          <div className="v16-sales-delivery-detail__disclosure-body">
            <dl className="v16-sales-delivery-detail__kv">
              <div>
                <dt>出库仓库</dt>
                <dd>{detail.warehouseName || '—'}</dd>
              </div>
              <div>
                <dt>发货日期</dt>
                <dd>{detail.delivery_date || '—'}</dd>
              </div>
              <div>
                <dt>计费方式</dt>
                <dd>
                  {billingModeText}
                  {billingFilled && billingMode === 'DIRECT_BILL' && (
                    <small>当前设置会自动生成销售发票</small>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </details>

        <details className="v16-sales-delivery-detail__disclosure">
          <summary>来源销售订单</summary>
          <div className="v16-sales-delivery-detail__disclosure-body">
            {upstream.length > 0 ? (
              upstream.map((item) => (
                <div key={item.id} className="v16-sales-delivery-detail__source-row">
                  <span className="v16-sales-delivery-detail__source-row-key">销售订单</span>
                  {navigation?.canNavigate?.('orders') ? (
                    <AppLink
                      page="orders"
                      documentId={item.id}
                      documentType={item.type}
                      className="v16-sales-delivery-detail__source-row-value"
                    >
                      {item.documentNo}
                    </AppLink>
                  ) : (
                    <span className="v16-sales-delivery-detail__source-row-value">{item.documentNo}</span>
                  )}
                </div>
              ))
            ) : (
              <div className="v16-sales-delivery-detail__source-row">
                <span className="v16-sales-delivery-detail__source-row-key">销售订单</span>
                <span className="v16-sales-delivery-detail__source-row-value v16-sales-delivery-detail__source-row-value--neutral">
                  来源信息不完整
                </span>
              </div>
            )}
          </div>
        </details>

        <details className="v16-sales-delivery-detail__disclosure" open>
          <summary>
            <span>出库明细</span>
            <span className="v16-sales-delivery-detail__summary-hint">
              {(detail.items || []).length} 行
            </span>
          </summary>
          <div className="v16-sales-delivery-detail__disclosure-body">
            <ul className="v16-sales-delivery-detail__lines">
              {(detail.items || []).map((item) => {
                const ordered = Number(item.orderedQuantity || 0);
                const delivered = Number(item.deliveredQuantity || 0);
                const showSourceLine = ordered > 0;
                const remaining = Math.max(0, ordered - delivered);
                return (
                  <li className="v16-sales-delivery-detail__line" key={item.id || item.productId}>
                    <div className="v16-sales-delivery-detail__line-head">
                      <span className="v16-sales-delivery-detail__line-name">{item.productName || '—'}</span>
                      <span className="v16-sales-delivery-detail__line-code">{item.productCode || ''}</span>
                    </div>
                    {showSourceLine && (
                      <small className="v16-sales-delivery-detail__line-source">
                        订购 {quantity(ordered)} · 已发 {quantity(delivered)} · 剩余 {quantity(remaining)}
                      </small>
                    )}
                    <div className="v16-sales-delivery-detail__line-meta">
                      <span>{quantity(item.quantity)} {item.unit || ''} × {money(item.unitPriceCents)}</span>
                      <span className="v16-sales-delivery-detail__line-meta-amount">
                        {money(item.amountCents)}
                      </span>
                    </div>
                    {(item.trackingAllocations || []).length > 0 && (
                      <details className="v16-sales-delivery-detail__tracking">
                        <summary>批次 / 序列号 {(item.trackingAllocations || []).length} 条</summary>
                        <ul>
                          {item.trackingAllocations.map((allocation, allocationIndex) => (
                            <li key={allocation.id || allocation.lotId || allocation.serialId || allocationIndex}>
                              <span>{allocation.lotCode || allocation.serialNumber || '跟踪信息'}</span>
                              <strong>{quantity(allocation.quantity || 1)}</strong>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="v16-sales-delivery-detail__total">
              <span>单据合计</span>
              <strong>{money(detail.total_cents)}</strong>
            </div>
          </div>
        </details>

        <details className="v16-sales-delivery-detail__disclosure">
          <summary>质量</summary>
          <div className="v16-sales-delivery-detail__disclosure-body">
            <div className="v16-sales-delivery-detail__quality">
              <strong>OQC</strong>
              <span
                className={"v16-sales-delivery-quality v16-sales-delivery-quality--" + (code || '').toLowerCase()}
                data-quality={code || ''}
              >
                {salesDeliveryQualityLabel(quality)}
              </span>
            </div>
          </div>
        </details>

        <details className="v16-sales-delivery-detail__disclosure">
          <summary>结算与关联</summary>
          <div className="v16-sales-delivery-detail__disclosure-body">
            <div className="v16-sales-delivery-detail__relations">
              <div className="v16-sales-delivery-detail__relation">
                <span>计费状态</span>
                <strong>{billingStatusLabel(billingStatus) || '—'}</strong>
              </div>
              {salesInvoices.length > 0 && (
                <div className="v16-sales-delivery-detail__relation">
                  <span>销售发票</span>
                  <strong>{salesInvoices.length} 张</strong>
                </div>
              )}
              {salesReturns.length > 0 && (
                <div className="v16-sales-delivery-detail__relation">
                  <span>销售退货</span>
                  <strong>{salesReturns.length} 张</strong>
                </div>
              )}
              {detail.relationships?.subledger && (
                <div className="v16-sales-delivery-detail__relation">
                  <span>应收记录</span>
                  <strong className="mono">{detail.relationships.subledger.documentNo}</strong>
                </div>
              )}
            </div>
          </div>
        </details>

        <details className="v16-sales-delivery-detail__disclosure">
          <summary>
            <span>操作记录</span>
            <span className="v16-sales-delivery-detail__summary-hint">
              {(detail.creatorName ? 1 : 0) + (detail.confirmedByName ? 1 : 0) + (archived ? 1 : 0)} 条
            </span>
          </summary>
          <div className="v16-sales-delivery-detail__disclosure-body">
            <div className="v16-sales-delivery-detail__history">
              {detail.creatorName && (
                <div className="v16-sales-delivery-detail__relation">
                  <span>制单人</span>
                  <strong>{detail.creatorName}</strong>
                </div>
              )}
              {detail.confirmedByName && (
                <div className="v16-sales-delivery-detail__relation">
                  <span>确认人</span>
                  <strong>{detail.confirmedByName}</strong>
                </div>
              )}
              {archived && (
                <>
                  <div className="v16-sales-delivery-detail__relation">
                    <span>归档时间</span>
                    <strong>{dateTime(detail.archiveState?.archivedAt) || '—'}</strong>
                  </div>
                  {detail.archiveState?.reason && (
                    <div className="v16-sales-delivery-detail__relation">
                      <span>归档原因</span>
                      <strong>{detail.archiveState.reason}</strong>
                    </div>
                  )}
                </>
              )}
              {!detail.creatorName && !detail.confirmedByName && !archived && (
                <p className="v16-sales-delivery-detail__history-empty">暂无操作记录</p>
              )}
            </div>
          </div>
        </details>

        {((detail.status === 'DRAFT' && canManage) ||
          (detail.status === 'CANCELLED' && !archived && canManage) ||
          (archived && canRestore)) && (
          <details className="v16-sales-delivery-detail__disclosure">
            <summary>管理</summary>
            <div className="v16-sales-delivery-detail__disclosure-body">
              <div className="v16-sales-delivery-detail__management">
                {detail.status === 'DRAFT' && canManage && (
                  <div className="v16-sales-delivery-detail__management-row">
                    <span>取消这张单据</span>
                    <button
                      type="button"
                      className="v16-sales-delivery-detail__management-button v16-sales-delivery-detail__management-button--danger"
                      onClick={() => setConfirm('cancel')}
                    >
                      取消
                    </button>
                  </div>
                )}
                {detail.status === 'CANCELLED' && !archived && canManage && (
                  <div className="v16-sales-delivery-detail__management-row">
                    <span>从业务列表移除</span>
                    <button
                      type="button"
                      className="v16-sales-delivery-detail__management-button v16-sales-delivery-detail__management-button--danger"
                      onClick={prepareArchive}
                    >
                      从列表移除
                    </button>
                  </div>
                )}
                {archived && canRestore && (
                  <div className="v16-sales-delivery-detail__management-row">
                    <span>恢复到业务列表</span>
                    <button
                      type="button"
                      className="v16-sales-delivery-detail__management-button"
                      onClick={() => setConfirm('restore')}
                    >
                      恢复
                    </button>
                  </div>
                )}
              </div>
            </div>
          </details>
        )}
      </section>

      {(primary || secondary) && (
        <div className="v16-sales-delivery-detail__action-bar" role="group" aria-label="销售出库操作">
          {secondary && (
            <button type="button" className="secondary" onClick={handleSecondary} data-testid="sales-delivery-action-secondary">
              {secondary.label}
            </button>
          )}
          {primary && (
            <button
              type="button"
              className="primary"
              onClick={handlePrimary}
              disabled={busy}
              data-testid="sales-delivery-action-primary"
            >
              {primary.label}
            </button>
          )}
        </div>
      )}

      {confirm === 'confirm' && (
        <DangerSheet
          title="确认销售出库？"
          confirmLabel="确认出库"
          onClose={() => setConfirm(null)}
          onConfirm={() => act('confirm')}
        >
          <p>
            确认后将按本单数量减少库存，发货日期和来源销售订单将作为业务依据。
            {billingMode === 'DIRECT_BILL' && (
              <span><br />当前设置会自动生成销售发票。</span>
            )}
          </p>
        </DangerSheet>
      )}

      {confirm === 'cancel' && (
        <DangerSheet
          title="取消这张销售出库单？"
          confirmLabel="确认取消"
          onClose={() => setConfirm(null)}
          onConfirm={() => act('cancel')}
        >
          <p>取消后该单据将不能继续编辑或确认，也不会减少库存。</p>
        </DangerSheet>
      )}

      {confirm === 'archive' && (
        <DangerSheet
          title="从业务列表移除？"
          confirmLabel="从列表移除"
          onClose={() => setConfirm(null)}
          onConfirm={archive}
        >
          <p>该销售出库单将从正常业务列表中移除，并保留在归档记录中。<br />原单据、明细和审计记录不会被删除，有权限的管理员可以恢复。</p>
          <label>归档原因<textarea value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength="500" required /></label>
        </DangerSheet>
      )}

      {confirm === 'restore' && (
        <DangerSheet
          title="恢复到业务列表？"
          confirmLabel="确认恢复"
          onClose={() => setConfirm(null)}
          onConfirm={restore}
        >
          <p>恢复后该单据会重新出现在业务列表中，但仍保持“已取消”，不会恢复库存或财务效果。</p>
        </DangerSheet>
      )}
    </div>
  );
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
  const navigation = useAppNavigation();
  const createQuality = async () => {
    try {
      const created = await api('/api/oqc', { method: 'POST', body: { sales_delivery_id: value.id } });
      notify('OQC 检验草稿已创建');
      const response = await api('/api/sales-deliveries/' + value.id);
      setDetail(response.salesDelivery);
      const inspectionId = created?.id || response?.salesDelivery?.qualityState?.inspectionId;
      if (inspectionId && navigation?.navigateToPage) {
        navigation.navigateToPage('oqc', { documentId: inspectionId, documentType: 'OQC_INSPECTION', sourcePage: 'sales-deliveries', sourceDocumentId: value.id });
      }
    } catch (e) { notify(e.message, 'error'); }
  };
  const goOqc = () => {
    const inspectionId = detail?.qualityState?.inspectionId;
    if (inspectionId && navigation?.navigateToPage) navigation.navigateToPage('oqc', { documentId: inspectionId, documentType: 'OQC_INSPECTION', sourcePage: 'sales-deliveries', sourceDocumentId: value.id });
    else if (navigation?.navigateToPage) navigation.navigateToPage('oqc');
  };
  const qualityStateCode = detail?.qualityState?.code;
  const oqcAction = qualityStateCode === 'INSPECTION_DRAFT'
    ? (can(user, 'OQC_VIEW') || can(user, 'OQC_MANAGE') ? goOqc : null)
    : (can(user, 'OQC_MANAGE') ? createQuality : null);
  const oqcLabel = qualityStateCode === 'FAIL' || qualityStateCode === 'STALE' ? '创建 OQC 复检' : qualityStateCode === 'INSPECTION_DRAFT' ? '前往 OQC' : '创建 OQC';
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
    <LogisticsActions existing={Boolean(value.id)} onClose={onClose} onAction={changeState} qualityAction={value.id ? oqcAction : null} qualityLabel={oqcLabel} qualityState={detail?.qualityState}/>
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
  return <BusinessPageShell className="returns-v15" width="rail">
    <BusinessPageHeader title="退货管理" context={tab === 'sales' ? '销售退货' : '采购退货'} primaryAction={can(user, "RETURNS_MANAGE") && <BusinessAction hierarchy="primary" onClick={() => setView({ tab })}>新建{tab === 'sales' ? '销售' : '采购'}退货</BusinessAction>} help={<HelpDisclosure summary="业务说明"><p>销售退货引用已确认销售出货；采购退货引用已确认采购入库。两类退货保持各自来源和库存方向。</p></HelpDisclosure>}/>
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
  </BusinessPageShell>;
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
  const [items, setItems] = useState([]); const [search, setSearch] = useState(''); const [warehouses, setWarehouses] = useState([]); const [products, setProducts] = useState([]); const [filterOpen, setFilterOpen] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const emptyFilters = { type: '', warehouse: '', product: '', direction: '', startDate: '', endDate: '' };
  const [filters, setFilters] = useState(emptyFilters); const [draft, setDraft] = useState(filters);
  const load = () => { setLoading(true); setError(''); const params = new URLSearchParams({ search, ...filters }); return api('/api/inventory-transactions?' + params).then((r) => setItems(r.inventoryTransactions || [])).catch((e) => { setError(e.message); notify(e.message, 'error'); }).finally(() => setLoading(false)); };
  useEffect(() => { Promise.all([api('/api/warehouses'), api('/api/products')]).then(([w, p]) => { setWarehouses(w.warehouses || []); setProducts(p.products || []); }).catch((e) => notify(e.message, 'error')); }, []);
  useEffect(() => { void load(); }, [filters.type, filters.warehouse, filters.product, filters.direction, filters.startDate, filters.endDate]);
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
  const activeCount = Object.values(filters).filter(Boolean).length;
  return <BusinessPageShell className="v16-inventory-shell v16-inventory-transactions" width="rail"><div className="v16-inventory-tools"><SearchField value={search} onChange={setSearch} onSubmit={load} placeholder="搜索来源单号或货品"/><FilterButton activeCount={activeCount} onClick={() => { setDraft(filters); setFilterOpen(true); }}>筛选</FilterButton></div>{loading ? <Loading/> : error ? <EmptyState title="加载失败" description={error} action={<button className="secondary" onClick={load}>重试</button>}/> : items.length ? <div className="v16-inventory-list">{items.map((item) => <article className="v16-inventory-transaction" key={item.id}><header><div><b>{item.business_date || '业务日期缺失'}</b><StatusChip status={item.direction}>{presentBusinessValue('inventoryDirection', item.direction).label}</StatusChip></div><strong className={item.direction === 'IN' ? 'positive' : 'negative'}>{item.direction === 'IN' ? '+' : '−'}{quantity(item.quantity_change)}</strong></header><div className="v16-inventory-transaction__source"><span>{typeMap[item.tx_type] || '库存异动'}</span><b className="mono">{sourcePage(item.tx_type) && item.source_id ? <AppLink page={sourcePage(item.tx_type)} documentId={item.source_id} documentType={item.tx_type}>{item.ref_no}</AppLink> : (item.ref_no || '—')}</b></div><strong>{item.productName}</strong><small className="mono">{item.productCode}</small><small>{item.warehouseName} · 变动后 {quantity(item.balance)}</small><small className="mono">{item.trackingPolicy === 'NONE' ? '—' : (item.trackingIdentities || '历史记录未采集')}</small></article>)}</div> : <EmptyState title="没有库存异动记录"/>}{filterOpen && <FilterSheet title="筛选库存异动" onClose={() => setFilterOpen(false)} onReset={() => setDraft(emptyFilters)} onApply={() => { setFilters(draft); setFilterOpen(false); }}><label>来源类型<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}><option value="">全部来源</option>{Object.entries(typeMap).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>货品<select value={draft.product} onChange={(e) => setDraft({ ...draft, product: e.target.value })}><option value="">全部货品</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label><label>仓库<select value={draft.warehouse} onChange={(e) => setDraft({ ...draft, warehouse: e.target.value })}><option value="">全部仓库</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></label><label>方向<select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value })}><option value="">全部方向</option><option value="IN">入库</option><option value="OUT">出库</option></select></label><label>记录日期从<input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}/></label><label>记录日期至<input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}/></label></FilterSheet>}</BusinessPageShell>;
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
