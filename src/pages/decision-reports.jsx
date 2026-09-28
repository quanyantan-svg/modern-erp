// V1.4-E5 — decision reports with canonical business-date semantics
// and BusinessEntitySelector-backed customer / supplier / product /
// warehouse filters.
//
// C01 — period-activity semantics: each metric uses its own
// authoritative business date: order_date, delivery_date, receipt_date
// and return_date. Audit timestamps never substitute for these fields.
//
// C02 — single-select BusinessEntitySelector replaces the legacy
// "请输入客户/供应商/产品/仓库编码" text inputs. Front-end transmits
// canonical internal ids; the report API never accepts raw text and
// returns a typed `filters` envelope echoing resolved code/name so
// exports can show the business-readable label rather than the UUID.

import { useEffect, useState } from 'react';
import { api, download } from '../api.js';
import { can, money } from '../components/ui.jsx';
import { BusinessState, FilterButton, FilterSheet, FormRow, InlineAlert, RecordCard, RecordList, ResponsiveBusinessList } from '../components/design-system.jsx';
import { BusinessEntitySelector } from '../components/business-entity-selector.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const REPORT_TABS = [
  { key: 'sales-summary', label: '销售统计', usage: 'REPORT_SALES', domainPermissions: ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
  { key: 'sales-outstanding', label: '销售未交', usage: 'REPORT_SALES', domainPermissions: ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
  { key: 'purchase-summary', label: '采购统计', usage: 'REPORT_PURCHASE', domainPermissions: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
  { key: 'purchase-outstanding', label: '采购未交', usage: 'REPORT_PURCHASE', domainPermissions: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
  { key: 'inventory-movements', label: '库存异动明细', usage: 'REPORT_INVENTORY', domainPermissions: ['INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_TRANSFER_CONFIRM', 'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE'] },
];

// Per-tab user-facing explanation of which business date each metric
// uses. Shown as a "口径" hint in the filter sheet so the user can
// audit which date drives each KPI without grepping the SQL.
const REPORT_DATE_BASIS = {
  'sales-summary': '本报表按期间业务活动统计：订单按订单日期，出货按出货日期，退货按退货日期；缺权威日期的记录明确标注，不回退创建时间。',
  'sales-outstanding': '本报表以要求交期作为日期筛选与到期口径；缺失要求交期的 legacy 订单明确标注，不回退订单日期。',
  'purchase-summary': '本报表按期间业务活动统计：订单按订单日期，入库按入库日期，退货按退货日期；缺权威日期的记录明确标注，不回退创建时间。',
  'purchase-outstanding': '本报表以预计到货日作为日期筛选与到期口径；缺失预计到货日的 legacy 订单明确标注，不回退订单日期。',
  'inventory-movements': '本报表按库存交易台账业务日期统计流水；缺业务日期的 legacy 记录明确标注，不回退创建时间。',
};

export function canViewDecisionReport(user, reportKey) {
  const report = REPORT_TABS.find((tab) => tab.key === reportKey);
  if (!user || !report || !can(user, 'REPORT_VIEW')) return false;
  return report.domainPermissions.some((permission) => can(user, permission));
}

function KpiCard({ label, value, sublabel }) {
  return (
    <div className="mobile-kpi-card" data-testid={`kpi-${label}`}>
      <div className="mobile-kpi-card__label">{label}</div>
      <div className="mobile-kpi-card__value">{value}</div>
      {sublabel ? <div className="mobile-kpi-card__sublabel">{sublabel}</div> : null}
    </div>
  );
}

// Export button — uses the same on-screen filter set; the export
// endpoint re-applies authoritative business-date semantics and
// echoes the resolved entity label in the file header.
function ExportButton({ endpoint, applied }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  async function handle() {
    const params = new URLSearchParams();
    Object.entries(applied || {}).forEach(([key, value]) => {
      if (value != null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    const url = endpoint + '/export' + (query ? '?' + query : '');
    setStatus('loading');
    setError('');
    try {
      const result = await download(url);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus('idle');
    } catch (reason) {
      setStatus('error');
      setError(reason?.message || '导出失败');
    }
  }
  return (
    <span className="report-export-control">
      <button type="button" className="report-export-button" onClick={handle} disabled={status === 'loading'} data-testid={`${endpoint}-export`}>
        {status === 'loading' ? '正在导出...' : '导出 CSV'}
      </button>
      {error ? <span className="report-export-error" role="alert">{error}</span> : null}
    </span>
  );
}

function ReportFilters({ fields, values, onChange, onApply, onReset, dateBasis, exportEndpoint, applied }) {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(values).filter(Boolean).length;
  return (
    <div className="report-filter-trigger" data-testid="report-filters">
      {exportEndpoint && <ExportButton endpoint={exportEndpoint} applied={applied} />}
      <FilterButton activeCount={activeCount} onClick={() => setOpen(true)}>筛选报表</FilterButton>
      {open && <FilterSheet
        onClose={() => setOpen(false)}
        onReset={() => { onReset(); setOpen(false); }}
        onApply={() => { onApply(); setOpen(false); }}
      >
        <p className="report-filter__date-basis" data-testid="report-filter-date-basis">{dateBasis}</p>
        {fields.map((field) => <FormRow key={field.name} label={field.label}>
          {field.kind === 'entity' ? (
            <BusinessEntitySelector
              entityType={field.entityType}
              usage={field.usage}
              value={values[field.name] || ''}
              onChange={(next) => onChange(field.name, next)}
              placeholder={field.placeholder || '搜索编码或名称'}
              testId={`report-filter-${field.name}`}
              disabled={field.disabled}
            />
          ) : field.kind === 'checkbox' ? (
            <label className="report-checkbox">
              <input type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => onChange(field.name, event.target.checked ? 'true' : '')} data-testid={`report-filter-${field.name}`}/>
              <span>{field.checkboxLabel || field.label}</span>
            </label>
          ) : field.options ? (
            <select value={values[field.name] || ''} onChange={(event) => onChange(field.name, event.target.value)} data-testid={`report-filter-${field.name}`}>
              <option value="">全部</option>
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <input type={field.type || 'text'} value={values[field.name] || ''} onChange={(event) => onChange(field.name, event.target.value)} placeholder={field.placeholder || ''} data-testid={`report-filter-${field.name}`}/>
          )}
        </FormRow>)}
      </FilterSheet>}
    </div>
  );
}

function useReport(endpoint, appliedFilters) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, error: null });
    const params = new URLSearchParams();
    Object.entries(appliedFilters || {}).forEach(([key, value]) => {
      if (value != null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    api(endpoint + (query ? '?' + query : ''))
      .then((data) => { if (active) setState({ status: 'success', data, error: null }); })
      .catch((error) => { if (active) setState({ status: 'error', data: null, error }); });
    return () => { active = false; };
  }, [endpoint, JSON.stringify(appliedFilters)]);
  return state;
}

// ---------- 1. Sales Summary ----------

function ReportBody({ state, render }) {
  if (state.status === 'loading') return <BusinessState kind="LOADING" title="正在加载决策报表" description="正在按业务日期口径汇总，请稍候。" />;
  if (state.status === 'error') return <BusinessState kind="ERROR" title="决策报表加载失败" description={[state.error?.message || '暂时无法获取数据。', state.error?.resolution].filter(Boolean).join(' ')} requestId={state.error?.requestId} details={state.error?.details} />;
  if (!state.data) return <BusinessState kind="EMPTY" title="暂无报表数据" description="当前业务范围内还没有可汇总的数据。" />;
  return render(state.data);
}

export default function DecisionReports({ user, notify }) {
  const [activeTab, setActiveTab] = useState('sales-summary');
  const nav = useAppNavigation();

  // Resolve initial tab from canonical SPA navigation target.
  useEffect(() => {
    if (nav?.target?.reportKey && REPORT_TABS.some((tab) => tab.key === nav.target.reportKey)) {
      setActiveTab(nav.target.reportKey);
    }
  }, [nav?.target]);

  const visibleTabs = REPORT_TABS.filter((tab) => canViewDecisionReport(user, tab.key));

  if (!visibleTabs.length) {
    return <BusinessState kind="PERMISSION_DENIED" title="当前角色无法查看决策报表" description="请联系管理员分配对应业务报表权限。" />;
  }

  const currentTab = visibleTabs.find((tab) => tab.key === activeTab) || visibleTabs[0];

  return (
    <section className="decision-reports" data-testid="decision-reports">
      <div className="decision-reports__tabs" role="tablist" data-testid="decision-reports-tabs">
        {visibleTabs.map((tab) => (
          <button
            type="button"
            key={tab.key}
            role="tab"
            aria-selected={currentTab.key === tab.key}
            className={'decision-reports__tab' + (currentTab.key === tab.key ? ' decision-reports__tab--active' : '')}
            onClick={() => setActiveTab(tab.key)}
            data-testid={'decision-report-tab-' + tab.key}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="decision-reports__panel" data-testid={'decision-report-panel-' + currentTab.key}>
        {currentTab.key === 'sales-summary' && <SalesSummaryPanel />}
        {currentTab.key === 'sales-outstanding' && <SalesOutstandingPanel />}
        {currentTab.key === 'purchase-summary' && <PurchaseSummaryPanel />}
        {currentTab.key === 'purchase-outstanding' && <PurchaseOutstandingPanel />}
        {currentTab.key === 'inventory-movements' && <InventoryMovementsPanel />}
      </div>
    </section>
  );
}

// ---- Sales Summary Panel ----

function SalesSummaryPanel() {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', customerId: '', status: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/sales-summary', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '期间开始' },
          { name: 'dateTo', type: 'date', label: '期间结束' },
          { name: 'customerId', kind: 'entity', entityType: 'CUSTOMER', usage: 'REPORT_SALES', label: '客户', placeholder: '搜索客户编码或名称' },
          { name: 'status', label: '订单状态', options: [
            { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
            { value: 'APPROVED', label: '已审批' }, { value: 'REJECTED', label: '已驳回' },
          ] },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', customerId: '', status: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['sales-summary']}
        exportEndpoint="/api/reports/decision/sales-summary"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <div className="decision-report__body" data-testid="sales-summary-body">
          <div className="mobile-kpi-grid">
            <KpiCard label="订单数" value={data.summary.orderCount} />
            <KpiCard label="订单金额" value={money(data.summary.orderCents)} />
            <KpiCard label="已审批订单数" value={data.summary.approvedOrderCount} />
            <KpiCard label="出货单数" value={data.summary.deliveryCount} />
            <KpiCard label="实际出货金额" value={money(data.summary.deliveryCents)} />
            <KpiCard label="销售退货金额" value={money(data.summary.returnCents)} />
            <KpiCard label="净出货金额" value={money(data.summary.netShipmentCents)} />
          </div>
          <CustomerGroupingTable rows={data.byCustomer || []} />
          <p className="decision-report__notes" data-testid="sales-summary-notes">{data.notes}</p>
        </div>
      )} />
    </>
  );
}

function CustomerGroupingTable({ rows }) {
  if (!rows.length) return <BusinessState kind="NO_RESULTS" title="没有客户分组数据" description="请调整期间、客户或状态筛选条件。" />;
  return (
    <RecordList className="decision-report__cards" data-testid="sales-summary-by-customer">
      {rows.map((row) => <RecordCard
        key={row.customerId}
        data-testid={`sales-summary-customer-${row.customerId}`}
        title={row.customerName}
        subtitle={row.customerCode}
        facts={[
          { label: '订单数', value: row.orderCount },
          { label: '订单金额', value: money(row.orderCents) },
          { label: '出货金额', value: money(row.deliveryCents) },
        ]}
      />)}
    </RecordList>
  );
}

// ---- Sales Outstanding Panel ----

function SalesOutstandingPanel() {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', customerId: '', includeFulfilled: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/sales-outstanding', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '要求交期起' },
          { name: 'dateTo', type: 'date', label: '要求交期止' },
          { name: 'customerId', kind: 'entity', entityType: 'CUSTOMER', usage: 'REPORT_SALES', label: '客户', placeholder: '搜索客户编码或名称' },
          { name: 'includeFulfilled', kind: 'checkbox', label: '已履行行', checkboxLabel: '显示已履行' },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', customerId: '', includeFulfilled: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['sales-outstanding']}
        exportEndpoint="/api/reports/decision/sales-outstanding"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <FulfillmentReportBody data={data} reportKey="sales-outstanding" applied={applied} />
      )} />
    </>
  );
}

const FULFILLMENT_LABELS = {
  UNFULFILLED: '未履行', PARTIAL: '部分履行', FULFILLED: '已履行', OVER_FULFILLED: '超量履行异常',
};

function FulfillmentReportBody({ data, reportKey, applied }) {
  const isSales = reportKey === 'sales-outstanding';
  const filtered = Object.entries(applied || {}).some(([key, value]) => key !== 'includeFulfilled' && Boolean(value));
  let emptyState = null;
  if (!data.rows.length) {
    if (data.population?.hiddenFulfilledLines > 0) {
      emptyState = <BusinessState kind="EMPTY" title="匹配行均已履行" description="已履行行默认隐藏；可在筛选中开启“显示已履行”。" />;
    } else if (filtered) {
      emptyState = <BusinessState kind="NO_RESULTS" title="当前条件无匹配" description="请调整要求交期/预计到货日或业务对象筛选。" />;
    } else {
      emptyState = <BusinessState kind="EMPTY" title={isSales ? '没有待出货订单行' : '没有待收货订单行'} description="当前已审批订单行均无剩余履约数量，或尚无已审批订单行。" />;
    }
  }
  return (
    <div className="decision-report__body" data-testid={`${reportKey}-body`}>
      <div className="decision-report__fulfillment-summary">
        <span>逐行口径</span><strong>截至 {data.asOfDate}</strong>
        <span>当前显示</span><strong>{data.rows.length} 行</strong>
      </div>
      {data.accuracyNotice ? <InlineAlert tone="warning">{data.accuracyNotice}</InlineAlert> : null}
      {data.rows.length ? <div className="fulfillment-row fulfillment-row--header" aria-hidden="true">
        <span>{isSales ? '销售订单' : '采购订单'}</span><span>{isSales ? '客户' : '供应商'}</span><span>产品</span>
        <span>订货</span><span>{isSales ? '已出货' : '已收货'}</span><span>剩余</span>
        <span>{isSales ? '要求交期' : '预计到货'}</span><span>履行状态</span><span>逾期</span><span>明细</span>
      </div> : null}
      <ResponsiveBusinessList
        items={data.rows}
        state={emptyState}
        keyOf={(row) => row.orderItemId}
        className="fulfillment-list"
        renderDesktopRow={(row) => <FulfillmentDesktopRow row={row} reportKey={reportKey} />}
        renderMobileCard={(row) => <FulfillmentMobileCard row={row} reportKey={reportKey} />}
      />
    </div>
  );
}

function FulfillmentDesktopRow({ row, reportKey }) {
  const isSales = reportKey === 'sales-outstanding';
  const party = isSales ? row.customer : row.supplier;
  const executed = isSales ? row.fulfilledQuantity : row.receivedQuantity;
  return (
    <div className={`fulfillment-row${row.overdue ? ' fulfillment-row--overdue' : ''}`} data-testid={`${reportKey}-row-${row.orderItemId}`}>
      <span className="mono"><AppLink page={isSales ? 'orders' : 'purchase-orders'} documentId={row.orderId} documentType={isSales ? 'SALES_ORDER' : 'PURCHASE_ORDER'}>{row.orderNumber} / {row.lineNumber}</AppLink></span>
      <span>{party.code} · {party.name}</span>
      <span>{row.product.code} · {row.product.name}</span>
      <span>{row.orderedQuantity}</span><span>{executed}</span><strong>{row.remainingQuantity}</strong>
      <span>{row.commitmentDate || '未设置交期'}</span>
      <span className={`fulfillment-status fulfillment-status--${row.fulfillmentStatus.toLowerCase()}`}>{FULFILLMENT_LABELS[row.fulfillmentStatus]}</span>
      <span className={row.overdue ? 'fulfillment-overdue' : 'dim'}>{row.overdue ? `逾期 ${row.overdueDays} 天` : '未逾期'}</span>
      <ContributionDisclosure row={row} reportKey={reportKey} />
    </div>
  );
}

function FulfillmentMobileCard({ row, reportKey }) {
  const isSales = reportKey === 'sales-outstanding';
  const party = isSales ? row.customer : row.supplier;
  const executed = isSales ? row.fulfilledQuantity : row.receivedQuantity;
  return (
    <article className={`mobile-card decision-report-card fulfillment-card${row.overdue ? ' fulfillment-card--overdue' : ''}`} data-testid={`${reportKey}-card-${row.orderItemId}`}>
      <header><AppLink page={isSales ? 'orders' : 'purchase-orders'} documentId={row.orderId} documentType={isSales ? 'SALES_ORDER' : 'PURCHASE_ORDER'}>{row.orderNumber} / 行 {row.lineNumber}</AppLink><span className={`fulfillment-status fulfillment-status--${row.fulfillmentStatus.toLowerCase()}`}>{FULFILLMENT_LABELS[row.fulfillmentStatus]}</span></header>
      <strong>{row.product.code} · {row.product.name}</strong>
      <span>{party.code} · {party.name}</span>
      <div className="fulfillment-card__primary"><span>剩余数量</span><strong>{row.remainingQuantity}</strong></div>
      <div className="fulfillment-card__facts"><span>订货 {row.orderedQuantity}</span><span>{isSales ? '已出货' : '已收货'} {executed}</span></div>
      <div className="fulfillment-card__facts"><span>{isSales ? '要求交期' : '预计到货'}：{row.commitmentDate || '未设置交期'}</span><span className={row.overdue ? 'fulfillment-overdue' : 'dim'}>{row.overdue ? `逾期 ${row.overdueDays} 天` : '未逾期'}</span></div>
      {row.legacyAccuracyLimited ? <InlineAlert tone="warning">历史数据 / 来源信息不完整，履行数量可能不完整</InlineAlert> : null}
      {row.fulfillmentStatus === 'OVER_FULFILLED' ? <InlineAlert tone="danger">检测到超量履行 {row.overFulfilledQuantity}，请核查历史数据</InlineAlert> : null}
      <ContributionDisclosure row={row} reportKey={reportKey} />
    </article>
  );
}

function ContributionDisclosure({ row, reportKey }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (state.status !== 'idle') return;
    setState({ status: 'loading', data: null, error: '' });
    try {
      const data = await api(`/api/reports/${reportKey}/lines/${encodeURIComponent(row.orderItemId)}/contributions`);
      setState({ status: 'success', data, error: '' });
    } catch (error) {
      setState({ status: 'error', data: null, error: error?.message || '履约明细加载失败' });
    }
  }
  return (
    <div className="fulfillment-contributions">
      <button type="button" className="link-button" onClick={toggle}>{open ? '收起履约明细' : `查看履约明细（${row.contributionCount}）`}</button>
      {open && state.status === 'loading' ? <small>正在加载履约明细…</small> : null}
      {open && state.status === 'error' ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {open && state.data ? <div className="fulfillment-contributions__list">
        {state.data.contributions.map((item) => <div key={item.sourceLineId}><strong>{item.sourceDocumentNumber}</strong><span>{item.businessDate || '业务日期缺失'} · 数量 {item.quantity}{item.warehouse ? ` · ${item.warehouse.code}` : ''}</span></div>)}
        {!state.data.contributions.length ? <small>没有可证明的履约贡献</small> : null}
        {state.data.informationalItems.map((item) => <InlineAlert key={item.code} tone="warning">{item.message}</InlineAlert>)}
      </div> : null}
    </div>
  );
}

// ---- Purchase Summary Panel ----

function PurchaseSummaryPanel() {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', supplierId: '', status: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/purchase-summary', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '期间开始' },
          { name: 'dateTo', type: 'date', label: '期间结束' },
          { name: 'supplierId', kind: 'entity', entityType: 'SUPPLIER', usage: 'REPORT_PURCHASE', label: '供应商', placeholder: '搜索供应商编码或名称' },
          { name: 'status', label: '订单状态', options: [
            { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
            { value: 'APPROVED', label: '已审批' }, { value: 'REJECTED', label: '已驳回' },
          ] },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', supplierId: '', status: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['purchase-summary']}
        exportEndpoint="/api/reports/decision/purchase-summary"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <div className="decision-report__body" data-testid="purchase-summary-body">
          <div className="mobile-kpi-grid">
            <KpiCard label="采购订单数" value={data.summary.orderCount} />
            <KpiCard label="采购订单金额" value={money(data.summary.orderCents)} />
            <KpiCard label="已审批订单数" value={data.summary.approvedOrderCount} />
            <KpiCard label="入库单数" value={data.summary.receiptCount} />
            <KpiCard label="实际入库金额" value={money(data.summary.receiptCents)} />
            <KpiCard label="采购退货金额" value={money(data.summary.returnCents)} />
            <KpiCard label="净入库金额" value={money(data.summary.netReceiptCents)} />
          </div>
          <SupplierGroupingTable rows={data.bySupplier || []} />
          <p className="decision-report__notes" data-testid="purchase-summary-notes">{data.notes}</p>
        </div>
      )} />
    </>
  );
}

function SupplierGroupingTable({ rows }) {
  if (!rows.length) return <BusinessState kind="NO_RESULTS" title="没有供应商分组数据" description="请调整期间、供应商或状态筛选条件。" />;
  return (
    <RecordList className="decision-report__cards" data-testid="purchase-summary-by-supplier">
      {rows.map((row) => <RecordCard
        key={row.supplierId}
        data-testid={`purchase-summary-supplier-${row.supplierId}`}
        title={row.supplierName}
        subtitle={row.supplierCode}
        facts={[
          { label: '订单数', value: row.orderCount },
          { label: '订单金额', value: money(row.orderCents) },
          { label: '入库金额', value: money(row.receiptCents) },
        ]}
      />)}
    </RecordList>
  );
}

// ---- Purchase Outstanding Panel ----

function PurchaseOutstandingPanel() {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', supplierId: '', includeFulfilled: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/purchase-outstanding', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '预计到货日起' },
          { name: 'dateTo', type: 'date', label: '预计到货日止' },
          { name: 'supplierId', kind: 'entity', entityType: 'SUPPLIER', usage: 'REPORT_PURCHASE', label: '供应商', placeholder: '搜索供应商编码或名称' },
          { name: 'includeFulfilled', kind: 'checkbox', label: '已履行行', checkboxLabel: '显示已履行' },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', supplierId: '', includeFulfilled: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['purchase-outstanding']}
        exportEndpoint="/api/reports/decision/purchase-outstanding"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <FulfillmentReportBody data={data} reportKey="purchase-outstanding" applied={applied} />
      )} />
    </>
  );
}

// ---- Inventory Movements Panel ----

function InventoryMovementsPanel() {
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', productId: '', warehouseId: '', direction: '', sourceType: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/inventory-movements', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '业务日期起' },
          { name: 'dateTo', type: 'date', label: '业务日期止' },
          { name: 'productId', kind: 'entity', entityType: 'PRODUCT', usage: 'REPORT_INVENTORY', label: '产品', placeholder: '搜索产品编码或名称' },
          { name: 'warehouseId', kind: 'entity', entityType: 'WAREHOUSE', usage: 'REPORT_INVENTORY', label: '仓库', placeholder: '搜索仓库编码或名称' },
          { name: 'direction', label: '方向', options: [{ value: 'IN', label: '入库' }, { value: 'OUT', label: '出库' }] },
          { name: 'sourceType', label: '来源类型', options: [
            { value: 'PURCHASE_RECEIPT', label: '采购入库' }, { value: 'SALES_DELIVERY', label: '销售出货' },
            { value: 'SALES_RETURN', label: '销售退货' }, { value: 'PURCHASE_RETURN', label: '采购退货' },
            { value: 'INVENTORY_TRANSFER', label: '库存调拨' }, { value: 'INVENTORY_CHECK', label: '库存盘点' },
            { value: 'INVENTORY_ADJUSTMENT', label: '库存调整' }, { value: 'INVENTORY_SCRAP', label: '库存报废' }, { value: 'PRODUCTION_MATERIAL_ISSUE', label: '用料出库' },
            { value: 'PRODUCTION_MATERIAL_RETURN', label: '生产退料' }, { value: 'PRODUCTION_RECEIPT', label: '生产入库' },
            { value: 'PRODUCTION_RECEIPT_REVERSAL', label: '生产入库冲销' },
          ] },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', productId: '', warehouseId: '', direction: '', sourceType: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['inventory-movements']}
        exportEndpoint="/api/reports/decision/inventory-movements"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <div className="decision-report__body" data-testid="inventory-movements-body">
          {data.reconciliation && (
            <div className="decision-report__reconciliation" data-testid="inventory-reconciliation">
              <div><span>当前库存</span><strong>{data.reconciliation.currentQuantity}</strong></div>
              <div><span>最新流水余额</span><strong>{data.reconciliation.latestMovementBalance ?? '—'}</strong></div>
              <p>{data.reconciliation.reconcilesToCurrent == null ? '历史不足，无法核对' : data.reconciliation.reconcilesToCurrent ? '流水与当前库存一致' : '流水与当前库存不一致，请核查'}</p>
              <small>{data.reconciliation.note}</small>
            </div>
          )}
          {data.rows.length ? (
            <RecordList className="decision-report__cards" data-testid="inventory-movements-list">
              {data.rows.map((row) => <RecordCard
                key={row.id}
                data-testid={`inventory-movement-row-${row.id}`}
                title={row.productName}
                subtitle={`${row.productCode} · ${row.source_no || '无来源单号'}`}
                facts={[
                  { label: '业务日期', value: row.businessDate || '业务日期缺失' },
                  { label: '仓库', value: row.warehouseName },
                  { label: '来源', value: <span data-testid={`inventory-movement-source-${row.id}`}>{row.source_type_label}</span> },
                  { label: '变动', value: `${row.direction_label} ${Math.abs(row.quantity_change)}` },
                  { label: '结存', value: row.balance_after ?? '—' },
                ]}
              />)}
            </RecordList>
          ) : (
            <BusinessState kind="NO_RESULTS" title="没有库存异动记录" description="请调整业务日期、产品、仓库或方向筛选条件。" />
          )}
        </div>
      )} />
    </>
  );
}
