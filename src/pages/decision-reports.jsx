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
import { can, Empty, Loading, money } from '../components/ui.jsx';
import { FilterButton, FilterSheet, FormRow, RecordCard, RecordList } from '../components/design-system.jsx';
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
      .catch((error) => { if (active) setState({ status: 'error', data: null, error: error.message || '查询失败' }); });
    return () => { active = false; };
  }, [endpoint, JSON.stringify(appliedFilters)]);
  return state;
}

// ---------- 1. Sales Summary ----------

function ReportBody({ state, render }) {
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') return <Empty title="加载失败" text={state.error || '暂时无法获取数据，请稍后重试。'} />;
  if (!state.data) return <Empty text="暂无数据" />;
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
    return <Empty text="当前角色没有可查看的决策报表权限" />;
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
  if (!rows.length) return <Empty text="当前条件下没有客户分组数据" />;
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
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', customerId: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/sales-outstanding', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '要求交期起' },
          { name: 'dateTo', type: 'date', label: '要求交期止' },
          { name: 'customerId', kind: 'entity', entityType: 'CUSTOMER', usage: 'REPORT_SALES', label: '客户', placeholder: '搜索客户编码或名称' },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', customerId: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['sales-outstanding']}
        exportEndpoint="/api/reports/decision/sales-outstanding"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <div className="decision-report__body" data-testid="sales-outstanding-body">
          <p className="decision-report__accuracy" data-testid="sales-outstanding-accuracy">准确度：{data.accuracy}</p>
          <p className="decision-report__notes" data-testid="sales-outstanding-notes">{data.accuracyNotes}</p>
          {data.rows.length ? (
            <div className="decision-report__cards" data-testid="sales-outstanding-list">
              {data.rows.map((row) => <SalesOutstandingCard key={row.id} row={row} />)}
            </div>
          ) : (
            <Empty text="当前条件下没有未出货订单" />
          )}
        </div>
      )} />
    </>
  );
}

function SalesOutstandingCard({ row }) {
  return (
    <div className="mobile-card decision-report-card" data-testid={`sales-outstanding-card-${row.id}`}>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">订单号</span>
        <span className="mobile-card__row-value mono"><AppLink page="orders" documentId={row.id} documentType="SALES_ORDER">{row.order_no}</AppLink></span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">客户</span>
        <span className="mobile-card__row-value">{row.customerName}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">订单日期</span>
        <span className="mobile-card__row-value dim">{row.orderDate || '业务日期缺失'}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">要求交期</span>
        <span className="mobile-card__row-value dim">{row.commitmentDate || '业务日期缺失'}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">订单金额</span>
        <span className="mobile-card__row-value"><strong>{money(row.total_cents)}</strong></span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">关联出货单</span>
        <span className="mobile-card__row-value">{row.confirmedDeliveryCount} 张</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">最近出货日期</span>
        <span className="mobile-card__row-value dim">{row.latestDeliveryDate?.slice(0, 10) || '业务日期缺失'}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">履行情况</span>
        <span className={'mobile-card__row-value status-' + (row.fulfillmentState === 'DELIVERED' ? 'approved' : row.fulfillmentState === 'IN_PROGRESS' ? 'submitted' : 'draft')} data-testid={`sales-outstanding-state-${row.id}`}>{row.fulfillmentLabel}</span>
      </div>
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
  if (!rows.length) return <Empty text="当前条件下没有供应商分组数据" />;
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
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', supplierId: '' });
  const [applied, setApplied] = useState({});
  const state = useReport('/api/reports/decision/purchase-outstanding', applied);

  return (
    <>
      <ReportFilters
        fields={[
          { name: 'dateFrom', type: 'date', label: '预计到货日起' },
          { name: 'dateTo', type: 'date', label: '预计到货日止' },
          { name: 'supplierId', kind: 'entity', entityType: 'SUPPLIER', usage: 'REPORT_PURCHASE', label: '供应商', placeholder: '搜索供应商编码或名称' },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', supplierId: '' }); setApplied({}); }}
        dateBasis={REPORT_DATE_BASIS['purchase-outstanding']}
        exportEndpoint="/api/reports/decision/purchase-outstanding"
        applied={applied}
      />
      <ReportBody state={state} render={(data) => (
        <div className="decision-report__body" data-testid="purchase-outstanding-body">
          <p className="decision-report__accuracy" data-testid="purchase-outstanding-accuracy">准确度：{data.accuracy}</p>
          <p className="decision-report__notes" data-testid="purchase-outstanding-notes">{data.accuracyNotes}</p>
          {data.rows.length ? (
            <div className="decision-report__cards" data-testid="purchase-outstanding-list">
              {data.rows.map((row) => <PurchaseOutstandingCard key={row.id} row={row} />)}
            </div>
          ) : (
            <Empty text="当前条件下没有未入库订单" />
          )}
        </div>
      )} />
    </>
  );
}

function PurchaseOutstandingCard({ row }) {
  return (
    <div className="mobile-card decision-report-card" data-testid={`purchase-outstanding-card-${row.id}`}>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">订单号</span>
        <span className="mobile-card__row-value mono"><AppLink page="purchase-orders" documentId={row.id} documentType="PURCHASE_ORDER">{row.order_no}</AppLink></span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">供应商</span>
        <span className="mobile-card__row-value">{row.supplierName}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">订单日期</span>
        <span className="mobile-card__row-value dim">{row.orderDate || '业务日期缺失'}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">预计到货日</span>
        <span className="mobile-card__row-value dim">{row.commitmentDate || '业务日期缺失'}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">订单金额</span>
        <span className="mobile-card__row-value"><strong>{money(row.total_cents)}</strong></span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">关联入库单</span>
        <span className="mobile-card__row-value">{row.confirmedReceiptCount} 张</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">最近入库日期</span>
        <span className="mobile-card__row-value dim">{row.latestReceiptDate?.slice(0, 10) || '业务日期缺失'}</span>
      </div>
      <div className="mobile-card__row">
        <span className="mobile-card__row-label">履行情况</span>
        <span className={'mobile-card__row-value status-' + (row.fulfillmentState === 'RECEIVED' ? 'approved' : row.fulfillmentState === 'IN_PROGRESS' ? 'submitted' : 'draft')} data-testid={`purchase-outstanding-state-${row.id}`}>{row.fulfillmentLabel}</span>
      </div>
    </div>
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
            <Empty text="当前条件下没有库存异动记录" />
          )}
        </div>
      )} />
    </>
  );
}
