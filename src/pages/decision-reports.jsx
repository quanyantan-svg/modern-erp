// M7 Decision Reports — read-only analytics over canonical documents.
//
// Five reports:
//   1. 销售统计        — sales order/delivery/return aggregates
//   2. 销售未交         — approved sales orders vs. confirmed deliveries (document-level)
//   3. 采购统计        — purchase order/receipt/return aggregates
//   4. 采购未交         — approved purchase orders vs. confirmed receipts (document-level)
//   5. 库存异动明细     — inventory_transactions ledger
//
// All money is integer cents on the wire; frontend formats via money().
// Outstanding reports deliberately do not claim exact residual quantity
// because the current schema does not link delivery/receipt items back
// to specific sales/purchase order items. See backend notes.

import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { can, Empty, Loading, money } from '../components/ui.jsx';
import { FilterButton, FilterSheet, FormRow, RecordCard, RecordList } from '../components/design-system.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

const REPORT_TABS = [
  { key: 'sales-summary', label: '销售统计', domainPermissions: ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
  { key: 'sales-outstanding', label: '销售未交', domainPermissions: ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
  { key: 'purchase-summary', label: '采购统计', domainPermissions: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
  { key: 'purchase-outstanding', label: '采购未交', domainPermissions: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
  { key: 'inventory-movements', label: '库存异动明细', domainPermissions: ['INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE'] },
];

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

function ReportFilters({ fields, values, onChange, onApply, onReset }) {
  const [open, setOpen] = useState(false);
  const activeCount = Object.values(values).filter(Boolean).length;
  return (
    <div className="report-filter-trigger" data-testid="report-filters">
      <FilterButton activeCount={activeCount} onClick={() => setOpen(true)}>筛选报表</FilterButton>
      {open && <FilterSheet
        onClose={() => setOpen(false)}
        onReset={() => { onReset(); setOpen(false); }}
        onApply={() => { onApply(); setOpen(false); }}
      >
        {fields.map((field) => <FormRow key={field.name} label={field.label}>
          {field.options ? (
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
          { name: 'dateFrom', type: 'date', label: '开始日期' },
          { name: 'dateTo', type: 'date', label: '结束日期' },
          { name: 'customerId', label: '客户编码', placeholder: '请输入客户编码' },
          { name: 'status', label: '订单状态', options: [
            { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
            { value: 'APPROVED', label: '已审批' }, { value: 'REJECTED', label: '已驳回' },
          ] },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', customerId: '', status: '' }); setApplied({}); }}
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
          { name: 'dateFrom', type: 'date', label: '开始日期' },
          { name: 'dateTo', type: 'date', label: '结束日期' },
          { name: 'customerId', label: '客户编码', placeholder: '请输入客户编码' },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', customerId: '' }); setApplied({}); }}
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
        <span className="mobile-card__row-value dim">{row.created_at?.slice(0, 10) || '—'}</span>
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
        <span className="mobile-card__row-value dim">{row.latestDeliveryDate?.slice(0, 10) || '—'}</span>
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
          { name: 'dateFrom', type: 'date', label: '开始日期' },
          { name: 'dateTo', type: 'date', label: '结束日期' },
          { name: 'supplierId', label: '供应商编码', placeholder: '请输入供应商编码' },
          { name: 'status', label: '订单状态', options: [
            { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
            { value: 'APPROVED', label: '已审批' }, { value: 'REJECTED', label: '已驳回' },
          ] },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', supplierId: '', status: '' }); setApplied({}); }}
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
          { name: 'dateFrom', type: 'date', label: '开始日期' },
          { name: 'dateTo', type: 'date', label: '结束日期' },
          { name: 'supplierId', label: '供应商编码', placeholder: '请输入供应商编码' },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', supplierId: '' }); setApplied({}); }}
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
        <span className="mobile-card__row-value dim">{row.created_at?.slice(0, 10) || '—'}</span>
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
        <span className="mobile-card__row-value dim">{row.latestReceiptDate?.slice(0, 10) || '—'}</span>
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
          { name: 'dateFrom', type: 'date', label: '开始日期' },
          { name: 'dateTo', type: 'date', label: '结束日期' },
          { name: 'productId', label: '产品编码', placeholder: '请输入产品编码' },
          { name: 'warehouseId', label: '仓库编码', placeholder: '请输入仓库编码' },
          { name: 'direction', label: '方向', options: [{ value: 'IN', label: '入库' }, { value: 'OUT', label: '出库' }] },
          { name: 'sourceType', label: '来源类型', options: [
            { value: 'PURCHASE_RECEIPT', label: '采购入库' }, { value: 'SALES_DELIVERY', label: '销售出货' },
            { value: 'SALES_RETURN', label: '销售退货' }, { value: 'PURCHASE_RETURN', label: '采购退货' },
            { value: 'INVENTORY_TRANSFER', label: '库存调拨' }, { value: 'INVENTORY_CHECK', label: '库存盘点' },
            { value: 'INVENTORY_ADJUSTMENT', label: '库存调整' }, { value: 'INVENTORY_SCRAP', label: '库存报废' }, { value: 'PRODUCTION_MATERIAL_ISSUE', label: '用料出库' },
            { value: 'PRODUCTION_RECEIPT', label: '生产入库' },
          ] },
        ]}
        values={filters}
        onChange={(name, value) => setFilters((current) => ({ ...current, [name]: value }))}
        onApply={() => setApplied({ ...filters })}
        onReset={() => { setFilters({ dateFrom: '', dateTo: '', productId: '', warehouseId: '', direction: '', sourceType: '' }); setApplied({}); }}
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
                  { label: '日期', value: row.created_at?.slice(0, 16).replace('T', ' ') || '—' },
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
