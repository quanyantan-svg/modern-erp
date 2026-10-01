// V1.6 P7 — Mobile Enterprise Decision Reports.
//
// P7 retires the V1.5 desktop/tab/card wall (decision-reports-v15 +
// horizontal 5-tab rail + HelpDisclosure in the header + RecordCard +
// 7-card KPI wall + mobile-card decision-report-card) and replaces it with
// the V1.6 mobile-enterprise grammar. P7 is presentation layer only:
// REPORT_TABS, REPORT_DATE_BASIS and canViewDecisionReport remain exported
// for downstream consumers and tests. All report calculations, dates,
// fulfillment semantics, contribution evidence, reconciliation and CSV
// contracts continue to come from server/modules/decision-reports.js
// unchanged.
//
// Hard invariants (must not regress):
//   * one route: decision-reports
//   * five canonical reportKeys: sales-summary / sales-outstanding /
//     purchase-summary / purchase-outstanding / inventory-movements
//   * API endpoints: GET /api/reports/decision/{key} + /export,
//     GET /api/reports/:reportKey/lines/:orderItemId/contributions
//   * authoritative business dates are not replaced by created_at / updated_at
//   * REPORT_VIEW + domain permission contract preserved
//   * BusinessEntitySelector used for entity filters
//   * applied filters drive both report fetch and CSV export
//   * draft filters must never silently become applied on close

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api, download } from '../api.js';
import { can, money } from '../components/ui.jsx';
import {
  BusinessEntitySelector,
} from '../components/business-entity-selector.jsx';
import {
  BusinessState,
  FilterButton,
  FilterSheet,
  FormRow,
  InlineAlert,
  Sheet,
} from '../components/design-system.jsx';
import { AppLink, useAppNavigation } from '../navigation/AppNavigationContext.jsx';

export const REPORT_TABS = [
  { key: 'sales-summary', label: '销售统计分析', usage: 'REPORT_SALES', domainPermissions: ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
  { key: 'sales-outstanding', label: '销售未出货', usage: 'REPORT_SALES', domainPermissions: ['ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'ORDERS_APPROVE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
  { key: 'purchase-summary', label: '采购统计分析', usage: 'REPORT_PURCHASE', domainPermissions: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
  { key: 'purchase-outstanding', label: '采购未交货', usage: 'REPORT_PURCHASE', domainPermissions: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'PURCHASE_ORDERS_APPROVE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
  { key: 'inventory-movements', label: '库存异动明细', usage: 'REPORT_INVENTORY', domainPermissions: ['INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_TRANSFER_CONFIRM', 'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE'] },
];

export const REPORT_DATE_BASIS = {
  'sales-summary': '本报表按期间业务活动统计：订单按订单日期，出货按出货日期，退货按退货日期；缺权威业务日期的记录明确标注，不回退创建时间。',
  'sales-outstanding': '本报表以要求交期作为日期筛选与到期口径；缺失要求交期的 legacy 订单明确标注，不回退订单日期。',
  'purchase-summary': '本报表按期间业务活动统计：订单按订单日期，入库按入库日期，退货按退货日期；缺权威业务日期的记录明确标注，不回退创建时间。',
  'purchase-outstanding': '本报表以预计到货日作为日期筛选与到期口径；缺失预计到货日的 legacy 订单明确标注，不回退订单日期。',
  'inventory-movements': '本报表按库存交易台账业务日期统计流水；缺业务日期的 legacy 记录明确标注，不回退创建时间。',
};

// Frozen page title used by MobileShell / app router navigation group.
export const DECISION_REPORTS_PAGE_TITLE = '决策报表';

export function canViewDecisionReport(user, reportKey) {
  const report = REPORT_TABS.find((tab) => tab.key === reportKey);
  if (!user || !report || !can(user, 'REPORT_VIEW')) return false;
  return report.domainPermissions.some((permission) => can(user, permission));
}

const FULFILLMENT_LABELS = {
  UNFULFILLED: '未履行',
  PARTIAL: '部分履行',
  FULFILLED: '已履行',
  OVER_FULFILLED: '超量履行异常',
};

// ---- useReport: keeps the legacy JSON.stringify(appliedFilters) contract ----

function useReport(endpoint, appliedFilters) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const serialized = JSON.stringify(appliedFilters || {});
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
  }, [endpoint, serialized]);
  return state;
}

// ---- DecisionReportSwitcher: compact keyboard-accessible selector ----

function DecisionReportSwitcher({ currentKey, visibleTabs, onChange }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const current = visibleTabs.find((tab) => tab.key === currentKey) || visibleTabs[0];
  function pick(key) {
    if (key !== currentKey) onChange(key);
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }
  function onKeyDown(event) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }
  if (!current) return null;
  return (
    <div className="v16-decision-reports__switcher" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="v16-decision-reports__switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`切换决策报表，当前：${current.label}`}
        data-testid="decision-report-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="v16-decision-reports__switcher-label">报表</span>
        <strong className="v16-decision-reports__switcher-current">{current.label}</strong>
        <span className="v16-decision-reports__switcher-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="v16-decision-reports__switcher-sheet" role="dialog" aria-label="选择决策报表">
          <Sheet title="选择决策报表" onClose={() => { setOpen(false); buttonRef.current?.focus(); }}>
            <ul className="v16-decision-reports__switcher-list" role="listbox">
              {visibleTabs.map((tab) => (
                <li key={tab.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={tab.key === currentKey}
                    className={
                      'v16-decision-reports__switcher-option'
                      + (tab.key === currentKey ? ' v16-decision-reports__switcher-option--active' : '')
                    }
                    data-testid={`decision-report-switcher-option-${tab.key}`}
                    onClick={() => pick(tab.key)}
                  >
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>
        </div>
      )}
    </div>
  );
}

// ---- DecisionReportControls: filter trigger + CSV export ----

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
    <span className="v16-decision-reports__export">
      <button
        type="button"
        className="v16-decision-reports__export-button"
        onClick={handle}
        disabled={status === 'loading'}
        aria-label="导出当前报表为 CSV"
        data-testid="decision-report-export"
      >
        {status === 'loading' ? '正在导出…' : '导出 CSV'}
      </button>
      {error ? <span className="v16-decision-reports__export-error" role="alert">{error}</span> : null}
    </span>
  );
}

function DecisionReportControls({ activeCount, onOpenFilters, exportEndpoint, applied }) {
  return (
    <div className="v16-decision-reports__controls" data-testid="decision-report-controls">
      <FilterButton activeCount={activeCount} onClick={onOpenFilters}>筛选</FilterButton>
      {exportEndpoint ? <ExportButton endpoint={exportEndpoint} applied={applied} /> : null}
    </div>
  );
}

// ---- FilterSheet: draft values only ----

function DecisionReportFilterSheet({ open, onClose, fields, draftValues, onChangeDraft, onApply, onReset, dateBasis }) {
  if (!open) return null;
  return (
    <FilterSheet
      onClose={onClose}
      onReset={onReset}
      onApply={onApply}
      title="筛选报表"
    >
      <p className="v16-decision-reports__date-basis" data-testid="decision-report-date-basis">{dateBasis}</p>
      {fields.map((field) => (
        <FormRow key={field.name} label={field.label}>
          {field.kind === 'entity' ? (
            <BusinessEntitySelector
              entityType={field.entityType}
              usage={field.usage}
              value={draftValues[field.name] || ''}
              onChange={(next) => onChangeDraft(field.name, next)}
              placeholder={field.placeholder || '搜索编码或名称'}
              testId={`decision-report-filter-${field.name}`}
              disabled={field.disabled}
            />
          ) : field.kind === 'checkbox' ? (
            <label className="v16-decision-reports__checkbox">
              <input
                type="checkbox"
                checked={Boolean(draftValues[field.name])}
                onChange={(event) => onChangeDraft(field.name, event.target.checked ? 'true' : '')}
                data-testid={`decision-report-filter-${field.name}`}
              />
              <span>{field.checkboxLabel || field.label}</span>
            </label>
          ) : field.options ? (
            <select
              value={draftValues[field.name] || ''}
              onChange={(event) => onChangeDraft(field.name, event.target.value)}
              data-testid={`decision-report-filter-${field.name}`}
            >
              <option value="">全部</option>
              {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          ) : (
            <input
              type={field.type || 'text'}
              value={draftValues[field.name] || ''}
              onChange={(event) => onChangeDraft(field.name, event.target.value)}
              placeholder={field.placeholder || ''}
              data-testid={`decision-report-filter-${field.name}`}
            />
          )}
        </FormRow>
      ))}
    </FilterSheet>
  );
}

// ---- DecisionMetricGrid: flat 2-column density ----

function DecisionMetricGrid({ rows }) {
  return (
    <dl className="v16-decision-reports__metric-grid" data-testid="decision-report-metric-grid">
      {rows.map((row) => (
        <div className="v16-decision-reports__metric" key={row.label}>
          <dt className="v16-decision-reports__metric-label">{row.label}</dt>
          <dd className="v16-decision-reports__metric-value">{row.value}</dd>
          {row.subLabel ? <dd className="v16-decision-reports__metric-sub">{row.subLabel}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

// ---- DecisionBreakdownRow: customer / supplier enterprise row ----

function DecisionBreakdownRow({ title, subtitle, facts, testId }) {
  return (
    <li className="v16-decision-reports__breakdown-row" data-testid={testId}>
      <div className="v16-decision-reports__breakdown-primary">
        <strong className="v16-decision-reports__breakdown-title">{title}</strong>
        {subtitle ? <span className="v16-decision-reports__breakdown-subtitle">{subtitle}</span> : null}
      </div>
      <dl className="v16-decision-reports__breakdown-facts">
        {facts.map((fact) => (
          <div key={fact.label} className="v16-decision-reports__breakdown-fact">
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

// ---- ReportAuditNotice ----

function ReportAuditNotice({ kind = 'warning', title, summary, note, message }) {
  const tone = kind === 'neutral' ? 'info' : (kind === 'audit' ? 'info' : 'warning');
  return (
    <InlineAlert tone={tone} title={title}>
      {summary && summary.length ? (
        <dl className="v16-decision-reports__audit-summary">
          {summary.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {message ? <p className="v16-decision-reports__audit-message">{message}</p> : null}
      {note ? <p className="v16-decision-reports__audit-note">{note}</p> : null}
    </InlineAlert>
  );
}

// ---- FulfillmentContributionSheet ----

function FulfillmentContributionSheet({ open, onClose, reportKey, orderItemId, orderLine, expectedCount }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  useEffect(() => {
    if (!open || !orderItemId) return undefined;
    let active = true;
    setState({ status: 'loading', data: null, error: '' });
    api(`/api/reports/${reportKey}/lines/${encodeURIComponent(orderItemId)}/contributions`)
      .then((data) => { if (active) setState({ status: 'success', data, error: '' }); })
      .catch((error) => { if (active) setState({ status: 'error', data: null, error: error?.message || '履约明细加载失败' }); });
    return () => { active = false; };
  }, [open, reportKey, orderItemId]);
  if (!open) return null;
  return (
    <Sheet title="履约贡献明细" onClose={onClose}>
      {state.status === 'loading' ? (
        <p className="v16-decision-reports__contribution-status">正在加载履约明细…</p>
      ) : null}
      {state.status === 'error' ? (
        <InlineAlert tone="danger">{state.error}</InlineAlert>
      ) : null}
      {state.status === 'success' && state.data ? (
        <>
          <div className="v16-decision-reports__contribution-summary">
            {orderLine ? (
              <p className="v16-decision-reports__contribution-line">
                {orderLine.orderNumber} / 行 {orderLine.lineNumber} · 订货 {orderLine.orderedQuantity} · 已执行 {state.data.executedQuantity ?? 0}
              </p>
            ) : null}
            <p className="v16-decision-reports__contribution-counter">期望 {expectedCount} 条贡献记录</p>
          </div>
          {state.data.contributions.length === 0 ? (
            <p className="v16-decision-reports__contribution-empty">没有可证明的履约贡献</p>
          ) : (
            <ul className="v16-decision-reports__contribution-list" data-testid="decision-report-contribution-list">
              {state.data.contributions.map((item) => (
                <li key={item.sourceLineId} className="v16-decision-reports__contribution-item">
                  <strong className="v16-decision-reports__contribution-doc">{item.sourceDocumentNumber}</strong>
                  <span className="v16-decision-reports__contribution-meta">
                    {item.businessDate || '业务日期缺失'} · 数量 {item.quantity}{item.warehouse ? ` · ${item.warehouse.code}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {Array.isArray(state.data.informationalItems) && state.data.informationalItems.length > 0 ? (
            <div className="v16-decision-reports__contribution-warnings">
              {state.data.informationalItems.map((item) => (
                <InlineAlert key={item.code} tone="warning">{item.message}</InlineAlert>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

// ---- FulfillmentReportRowV16 ----

function FulfillmentReportRowV16({ row, reportKey, onOpenContributions }) {
  const isSales = reportKey === 'sales-outstanding';
  const party = isSales ? row.customer : row.supplier;
  const executed = isSales ? row.fulfilledQuantity : row.receivedQuantity;
  const partyPage = isSales ? 'orders' : 'purchase-orders';
  const partyDocumentType = isSales ? 'SALES_ORDER' : 'PURCHASE_ORDER';
  const commitmentLabel = isSales ? '要求交期' : '预计到货';
  const executedLabel = isSales ? '已出货' : '已收货';
  const overdueText = row.overdue ? `逾期 ${row.overdueDays} 天` : '未逾期';
  const overdueClass = row.overdue ? 'v16-decision-reports__fulfillment-overdue' : 'v16-decision-reports__fulfillment-muted';
  return (
    <li
      className={'v16-decision-reports__fulfillment-row' + (row.overdue ? ' v16-decision-reports__fulfillment-row--overdue' : '')}
      data-testid={`${reportKey}-row-${row.orderItemId}`}
    >
      <div className="v16-decision-reports__fulfillment-primary">
        <span className="v16-decision-reports__fulfillment-doc">
          <AppLink page={partyPage} documentId={row.orderId} documentType={partyDocumentType}>
            {row.orderNumber} / 行 {row.lineNumber}
          </AppLink>
        </span>
        <span className={`v16-decision-reports__fulfillment-status v16-decision-reports__fulfillment-status--${row.fulfillmentStatus.toLowerCase()}`}>
          {FULFILLMENT_LABELS[row.fulfillmentStatus]}
        </span>
      </div>
      <div className="v16-decision-reports__fulfillment-product">
        <strong>{row.product.code} · {row.product.name}</strong>
      </div>
      <div className="v16-decision-reports__fulfillment-party">
        {party.code} · {party.name}
      </div>
      <div className="v16-decision-reports__fulfillment-qty">
        <span className="v16-decision-reports__fulfillment-remaining-label">剩余数量</span>
        <strong className="v16-decision-reports__fulfillment-remaining">{row.remainingQuantity}</strong>
        <span className="v16-decision-reports__fulfillment-executed">订货 {row.orderedQuantity} · {executedLabel} {executed}</span>
      </div>
      <div className="v16-decision-reports__fulfillment-commitment">
        <span>{commitmentLabel}：{row.commitmentDate || '未设置交期'}</span>
        <span className={overdueClass}>{overdueText}</span>
      </div>
      {row.legacyAccuracyLimited ? (
        <InlineAlert tone="warning">历史数据 / 来源信息不完整，履行数量可能不完整</InlineAlert>
      ) : null}
      {row.fulfillmentStatus === 'OVER_FULFILLED' ? (
        <InlineAlert tone="danger">检测到超量履行 {row.overFulfilledQuantity}，请核查历史数据</InlineAlert>
      ) : null}
      <div className="v16-decision-reports__fulfillment-actions">
        <button
          type="button"
          className="v16-decision-reports__fulfillment-contributions"
          onClick={onOpenContributions}
          aria-label={`查看履约明细 共 ${row.contributionCount} 条`}
          data-testid={`${reportKey}-contributions-${row.orderItemId}`}
        >
          查看履约明细（{row.contributionCount}）
        </button>
      </div>
    </li>
  );
}

// ---- InventoryMovementReportRowV16 ----

function InventoryMovementReportRowV16({ row }) {
  const directionClass = row.direction === 'IN' ? 'v16-decision-reports__movement-in' : 'v16-decision-reports__movement-out';
  return (
    <li className="v16-decision-reports__movement-row" data-testid={`inventory-movement-row-${row.id}`}>
      <div className="v16-decision-reports__movement-primary">
        <span className="v16-decision-reports__movement-date">{row.businessDate || '业务日期缺失'}</span>
        <span className={`v16-decision-reports__movement-direction ${directionClass}`}>
          {row.direction_label} {Math.abs(row.quantity_change)}
        </span>
      </div>
      <div className="v16-decision-reports__movement-product">
        <strong>{row.productCode} · {row.productName}</strong>
      </div>
      <div className="v16-decision-reports__movement-meta">
        <span>仓库：{row.warehouseName}</span>
        <span>来源：<span data-testid={`inventory-movement-source-${row.id}`}>{row.source_type_label}</span></span>
        <span>单号：{row.source_no || '无来源单号'}</span>
      </div>
      <div className="v16-decision-reports__movement-balance">
        <span>变动后结存</span>
        <strong>{row.balance_after ?? '—'}</strong>
      </div>
    </li>
  );
}

// ---- legacy helper names kept for backward compatibility / frozen exports ----

// Per §30.3 these names remain as functions that delegate to V16 components.
// They are referenced by frozen regression tests for shape-level stability.
export function SalesSummaryPanel() {
  return <V16SalesSummaryPanel />;
}

export function SalesOutstandingPanel() {
  return <V16SalesOutstandingPanel />;
}

export function PurchaseSummaryPanel() {
  return <V16PurchaseSummaryPanel />;
}

export function PurchaseOutstandingPanel() {
  return <V16PurchaseOutstandingPanel />;
}

export function InventoryMovementsPanel() {
  return <V16InventoryMovementsPanel />;
}

// ---- Report filter definitions (per §29.7.2) ----

const SALES_SUMMARY_FIELDS = [
  { name: 'dateFrom', type: 'date', label: '期间开始' },
  { name: 'dateTo', type: 'date', label: '期间结束' },
  { name: 'customerId', kind: 'entity', entityType: 'CUSTOMER', usage: 'REPORT_SALES', label: '客户', placeholder: '搜索客户编码或名称' },
  { name: 'status', label: '订单状态', options: [
    { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
    { value: 'APPROVED', label: '已审批' }, { value: 'REJECTED', label: '已驳回' },
  ] },
];

const SALES_OUTSTANDING_FIELDS = [
  { name: 'dateFrom', type: 'date', label: '要求交期起' },
  { name: 'dateTo', type: 'date', label: '要求交期止' },
  { name: 'customerId', kind: 'entity', entityType: 'CUSTOMER', usage: 'REPORT_SALES', label: '客户', placeholder: '搜索客户编码或名称' },
  { name: 'includeFulfilled', kind: 'checkbox', label: '已履行行', checkboxLabel: '显示已履行' },
];

const PURCHASE_SUMMARY_FIELDS = [
  { name: 'dateFrom', type: 'date', label: '期间开始' },
  { name: 'dateTo', type: 'date', label: '期间结束' },
  { name: 'supplierId', kind: 'entity', entityType: 'SUPPLIER', usage: 'REPORT_PURCHASE', label: '供应商', placeholder: '搜索供应商编码或名称' },
  { name: 'status', label: '订单状态', options: [
    { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '待审批' },
    { value: 'APPROVED', label: '已审批' }, { value: 'REJECTED', label: '已驳回' },
  ] },
];

const PURCHASE_OUTSTANDING_FIELDS = [
  { name: 'dateFrom', type: 'date', label: '预计到货日起' },
  { name: 'dateTo', type: 'date', label: '预计到货日止' },
  { name: 'supplierId', kind: 'entity', entityType: 'SUPPLIER', usage: 'REPORT_PURCHASE', label: '供应商', placeholder: '搜索供应商编码或名称' },
  { name: 'includeFulfilled', kind: 'checkbox', label: '已履行行', checkboxLabel: '显示已履行' },
];

const INVENTORY_MOVEMENTS_FIELDS = [
  { name: 'dateFrom', type: 'date', label: '业务日期起' },
  { name: 'dateTo', type: 'date', label: '业务日期止' },
  { name: 'productId', kind: 'entity', entityType: 'PRODUCT', usage: 'REPORT_INVENTORY', label: '产品', placeholder: '搜索产品编码或名称' },
  { name: 'warehouseId', kind: 'entity', entityType: 'WAREHOUSE', usage: 'REPORT_INVENTORY', label: '仓库', placeholder: '搜索仓库编码或名称' },
  { name: 'direction', label: '方向', options: [{ value: 'IN', label: '入库' }, { value: 'OUT', label: '出库' }] },
  { name: 'sourceType', label: '来源类型', options: [
    { value: 'PURCHASE_RECEIPT', label: '采购入库' }, { value: 'SALES_DELIVERY', label: '销售出货' },
    { value: 'SALES_RETURN', label: '销售退货' }, { value: 'PURCHASE_RETURN', label: '采购退货' },
    { value: 'INVENTORY_TRANSFER', label: '库存调拨' }, { value: 'INVENTORY_CHECK', label: '库存盘点' },
    { value: 'INVENTORY_ADJUSTMENT', label: '库存调整' }, { value: 'INVENTORY_SCRAP', label: '库存报废' },
    { value: 'PRODUCTION_MATERIAL_ISSUE', label: '用料出库' }, { value: 'PRODUCTION_MATERIAL_RETURN', label: '生产退料' },
    { value: 'PRODUCTION_RECEIPT', label: '生产入库' }, { value: 'PRODUCTION_RECEIPT_REVERSAL', label: '生产入库冲销' },
  ] },
];

function initialFilters(fields) {
  return fields.reduce((acc, field) => ({ ...acc, [field.name]: '' }), {});
}

function activeFilterCount(values) {
  return Object.values(values || {}).filter((value) => Boolean(value)).length;
}

// ---- V16 panels ----

function V16SalesSummaryPanel() {
  return <ReportPanel reportKey="sales-summary" fields={SALES_SUMMARY_FIELDS} renderBody={renderSalesSummaryBody} />;
}

function V16SalesOutstandingPanel() {
  return <ReportPanel reportKey="sales-outstanding" fields={SALES_OUTSTANDING_FIELDS} renderBody={renderSalesOutstandingBody} />;
}

function V16PurchaseSummaryPanel() {
  return <ReportPanel reportKey="purchase-summary" fields={PURCHASE_SUMMARY_FIELDS} renderBody={renderPurchaseSummaryBody} />;
}

function V16PurchaseOutstandingPanel() {
  return <ReportPanel reportKey="purchase-outstanding" fields={PURCHASE_OUTSTANDING_FIELDS} renderBody={renderPurchaseOutstandingBody} />;
}

function V16InventoryMovementsPanel() {
  return <ReportPanel reportKey="inventory-movements" fields={INVENTORY_MOVEMENTS_FIELDS} renderBody={renderInventoryMovementsBody} />;
}

function ReportPanel({ reportKey, fields, renderBody }) {
  const [draftFilters, setDraftFilters] = useState(() => initialFilters(fields));
  const [appliedFilters, setAppliedFilters] = useState({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [contribution, setContribution] = useState({ open: false, reportKey: null, orderItemId: null, expectedCount: 0, orderLine: null });
  const state = useReport(`/api/reports/decision/${reportKey}`, appliedFilters);

  const panelId = useId();
  const headingId = `${panelId}-heading`;

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
    setFilterOpen(false);
  }
  function resetFilters() {
    const cleared = initialFilters(fields);
    setDraftFilters(cleared);
    setAppliedFilters({});
    setFilterOpen(false);
  }
  function closeFilters() {
    setFilterOpen(false);
  }
  function openContribution(row, reportKeyInner) {
    setContribution({
      open: true,
      reportKey: reportKeyInner,
      orderItemId: row.orderItemId,
      expectedCount: row.contributionCount,
      orderLine: { orderId: row.orderId, orderNumber: row.orderNumber, lineNumber: row.lineNumber, orderedQuantity: row.orderedQuantity },
    });
  }
  function closeContribution() {
    setContribution((current) => ({ ...current, open: false }));
  }
  function renderBodyWithContribution(data) {
    return renderBody(data, { appliedFilters, openContribution });
  }

  return (
    <section className="v16-decision-reports__panel" data-testid={`decision-report-panel-${reportKey}`} aria-labelledby={headingId}>
      <h3 id={headingId} className="v16-decision-reports__panel-heading">{REPORT_TABS.find((tab) => tab.key === reportKey)?.label}</h3>
      <DecisionReportControls
        activeCount={activeFilterCount(appliedFilters)}
        onOpenFilters={() => setFilterOpen(true)}
        exportEndpoint={`/api/reports/decision/${reportKey}`}
        applied={appliedFilters}
      />
      <DecisionReportFilterSheet
        open={filterOpen}
        onClose={closeFilters}
        fields={fields}
        draftValues={draftFilters}
        onChangeDraft={(name, value) => setDraftFilters((current) => ({ ...current, [name]: value }))}
        onApply={applyFilters}
        onReset={resetFilters}
        dateBasis={REPORT_DATE_BASIS[reportKey]}
      />
      <ReportBody state={state} data-testid={`${reportKey}-body`} render={renderBodyWithContribution} />
      {contribution.open ? (
        <FulfillmentContributionSheet
          open={contribution.open}
          onClose={closeContribution}
          reportKey={contribution.reportKey}
          orderItemId={contribution.orderItemId}
          orderLine={contribution.orderLine}
          expectedCount={contribution.expectedCount}
        />
      ) : null}
    </section>
  );
}

function ReportBody({ state, render, 'data-testid': testId }) {
  if (state.status === 'loading') {
    return (
      <div className="v16-decision-reports__body" data-testid={testId}>
        <BusinessState kind="LOADING" title="正在加载决策报表" description="正在按业务日期口径汇总，请稍候。" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="v16-decision-reports__body" data-testid={testId}>
        <BusinessState kind="ERROR" title="决策报表加载失败" description={[state.error?.message, state.error?.resolution].filter(Boolean).join(' ')} requestId={state.error?.requestId} details={state.error?.details} />
      </div>
    );
  }
  if (!state.data) {
    return (
      <div className="v16-decision-reports__body" data-testid={testId}>
        <BusinessState kind="EMPTY" title="暂无报表数据" description="当前业务范围内还没有可汇总的数据。" />
      </div>
    );
  }
  return <div className="v16-decision-reports__body" data-testid={testId}>{render(state.data)}</div>;
}

function renderSalesSummaryBody(data) {
  const rows = [
    { label: '订单数', value: data.summary.orderCount },
    { label: '订单金额', value: money(data.summary.orderCents) },
    { label: '已审批订单数', value: data.summary.approvedOrderCount },
    { label: '出货单数', value: data.summary.deliveryCount },
    { label: '实际出货金额', value: money(data.summary.deliveryCents) },
    { label: '销售退货金额', value: money(data.summary.returnCents) },
    { label: '净出货金额', value: money(data.summary.netShipmentCents) },
  ];
  const customers = data.byCustomer || [];
  return (
    <>
      <DecisionMetricGrid rows={rows} />
      {data.legacyMissing && data.legacyMissing.total ? (
        <ReportAuditNotice
          title="业务日期缺失"
          summary={[
            { label: '订单缺失', value: data.legacyMissing.orderWithoutDate || 0 },
            { label: '出货缺失', value: data.legacyMissing.deliveryWithoutDate || 0 },
            { label: '退货缺失', value: data.legacyMissing.returnWithoutDate || 0 },
            { label: '合计', value: data.legacyMissing.total },
          ]}
        />
      ) : null}
      <h4 className="v16-decision-reports__section-heading">客户分组</h4>
      {customers.length === 0 ? (
        <BusinessState kind="NO_RESULTS" title="没有客户分组数据" description="请调整期间、客户或状态筛选条件。" />
      ) : (
        <ul className="v16-decision-reports__breakdown" data-testid="sales-summary-by-customer">
          {customers.map((row) => (
            <DecisionBreakdownRow
              key={row.customerId}
              testId={`sales-summary-customer-${row.customerId}`}
              title={`${row.customerCode} · ${row.customerName}`}
              subtitle={null}
              facts={[
                { label: '订单数', value: row.orderCount },
                { label: '订单金额', value: money(row.orderCents) },
                { label: '出货金额', value: money(row.deliveryCents) },
              ]}
            />
          ))}
        </ul>
      )}
      {data.notes ? <ReportAuditNotice kind="neutral" title="报表说明" message={data.notes} /> : null}
    </>
  );
}

function renderSalesOutstandingBody(data, ctx) {
  return renderFulfillmentBody(data, ctx, 'sales-outstanding');
}

function renderPurchaseOutstandingBody(data, ctx) {
  return renderFulfillmentBody(data, ctx, 'purchase-outstanding');
}

function renderFulfillmentBody(data, ctx, reportKey) {
  const rows = data.rows || [];
  const isSales = reportKey === 'sales-outstanding';
  const hasOtherFilter = Object.entries(ctx.appliedFilters || {}).some(([key, value]) => key !== 'includeFulfilled' && Boolean(value));
  const hiddenFulfilled = data.population?.hiddenFulfilledLines > 0;
  let body;
  if (rows.length === 0) {
    if (hiddenFulfilled) {
      body = (
        <BusinessState kind="EMPTY" title="匹配行均已履行" description="已履行行默认隐藏；可在筛选中开启“显示已履行”。" />
      );
    } else if (hasOtherFilter) {
      body = <BusinessState kind="NO_RESULTS" title="当前条件无匹配" description="请调整要求交期 / 预计到货或业务对象筛选。" />;
    } else {
      body = (
        <BusinessState
          kind="EMPTY"
          title={isSales ? '没有待出货订单行' : '没有待收货订单行'}
          description="当前已审批订单行均无剩余履约数量，或尚无已审批订单行。"
        />
      );
    }
  } else {
    body = (
      <ul className="v16-decision-reports__fulfillment" data-testid={`${reportKey}-fulfillment`}>
        {rows.map((row) => (
          <FulfillmentReportRowV16
            key={row.orderItemId}
            row={row}
            reportKey={reportKey}
            onOpenContributions={() => ctx.openContribution(row, reportKey)}
          />
        ))}
      </ul>
    );
  }
  return (
    <>
      <div className="v16-decision-reports__fulfillment-summary">
        <span>逐行口径</span>
        <strong>截至 {data.asOfDate}</strong>
        <span>当前显示</span>
        <strong>{rows.length} 行</strong>
        {hiddenFulfilled ? <span>已隐藏履行行 {data.population.hiddenFulfilledLines}</span> : null}
      </div>
      {data.accuracyNotice ? <InlineAlert tone="warning">{data.accuracyNotice}</InlineAlert> : null}
      {body}
    </>
  );
}

function renderPurchaseSummaryBody(data) {
  const rows = [
    { label: '采购订单数', value: data.summary.orderCount },
    { label: '采购订单金额', value: money(data.summary.orderCents) },
    { label: '已审批订单数', value: data.summary.approvedOrderCount },
    { label: '入库单数', value: data.summary.receiptCount },
    { label: '实际入库金额', value: money(data.summary.receiptCents) },
    { label: '采购退货金额', value: money(data.summary.returnCents) },
    { label: '净入库金额', value: money(data.summary.netReceiptCents) },
  ];
  const suppliers = data.bySupplier || [];
  return (
    <>
      <DecisionMetricGrid rows={rows} />
      {data.legacyMissing && data.legacyMissing.total ? (
        <ReportAuditNotice
          title="业务日期缺失"
          summary={[
            { label: '订单缺失', value: data.legacyMissing.orderWithoutDate || 0 },
            { label: '入库缺失', value: data.legacyMissing.receiptWithoutDate || 0 },
            { label: '退货缺失', value: data.legacyMissing.returnWithoutDate || 0 },
            { label: '合计', value: data.legacyMissing.total },
          ]}
        />
      ) : null}
      <h4 className="v16-decision-reports__section-heading">供应商分组</h4>
      {suppliers.length === 0 ? (
        <BusinessState kind="NO_RESULTS" title="没有供应商分组数据" description="请调整期间、供应商或状态筛选条件。" />
      ) : (
        <ul className="v16-decision-reports__breakdown" data-testid="purchase-summary-by-supplier">
          {suppliers.map((row) => (
            <DecisionBreakdownRow
              key={row.supplierId}
              testId={`purchase-summary-supplier-${row.supplierId}`}
              title={`${row.supplierCode} · ${row.supplierName}`}
              subtitle={null}
              facts={[
                { label: '订单数', value: row.orderCount },
                { label: '订单金额', value: money(row.orderCents) },
                { label: '入库金额', value: money(row.receiptCents) },
              ]}
            />
          ))}
        </ul>
      )}
      {data.notes ? <ReportAuditNotice kind="neutral" title="报表说明" message={data.notes} /> : null}
    </>
  );
}

function renderInventoryMovementsBody(data) {
  const rows = data.rows || [];
  return (
    <>
      {data.reconciliation ? (
        <ReportAuditNotice
          kind="audit"
          title="库存对账"
          summary={[
            { label: '当前库存', value: data.reconciliation.currentQuantity },
            { label: '最新流水余额', value: data.reconciliation.latestMovementBalance ?? '—' },
            {
              label: '核对结果',
              value:
                data.reconciliation.reconcilesToCurrent == null
                  ? '历史不足，无法核对'
                  : data.reconciliation.reconcilesToCurrent
                    ? '流水与当前库存一致'
                    : '流水与当前库存不一致，请核查',
            },
          ]}
          note={data.reconciliation.note}
        />
      ) : null}
      {data.legacyMissing && data.legacyMissing.withoutBusinessDate ? (
        <ReportAuditNotice
          title="业务日期缺失"
          message={`共有 ${data.legacyMissing.withoutBusinessDate} 条记录缺少业务日期。`}
        />
      ) : null}
      <h4 className="v16-decision-reports__section-heading">异动流水</h4>
      {rows.length === 0 ? (
        <BusinessState kind="NO_RESULTS" title="没有库存异动记录" description="请调整业务日期、产品、仓库或方向筛选条件。" />
      ) : (
        <ul className="v16-decision-reports__movements" data-testid="inventory-movements-list">
          {rows.map((row) => <InventoryMovementReportRowV16 key={row.id} row={row} />)}
        </ul>
      )}
    </>
  );
}

// ---- top-level default export ----

export default function DecisionReports({ user, notify }) {
  const nav = useAppNavigation();
  const visibleTabs = useMemo(
    () => REPORT_TABS.filter((tab) => canViewDecisionReport(user, tab.key)),
    [user],
  );
  const targetKey = nav?.target?.reportKey;
  const fallbackKey = visibleTabs[0]?.key;
  const [currentReportKey, setCurrentReportKey] = useState(() => {
    if (targetKey && REPORT_TABS.some((tab) => tab.key === targetKey)) return targetKey;
    return fallbackKey;
  });

  // Re-resolve when navigation target changes (e.g. launcher tile).
  useEffect(() => {
    if (targetKey && REPORT_TABS.some((tab) => tab.key === targetKey) && canViewDecisionReport(user, targetKey)) {
      setCurrentReportKey(targetKey);
    }
  }, [targetKey, user]);

  if (!visibleTabs.length) {
    return (
      <BusinessState kind="PERMISSION_DENIED" title="当前角色无法查看决策报表" description="请联系管理员分配对应业务报表权限。" />
    );
  }

  const safeKey = visibleTabs.some((tab) => tab.key === currentReportKey) ? currentReportKey : visibleTabs[0].key;

  return (
    <main
      className="v16-mobile-enterprise v16-decision-reports"
      width="rail"
      data-testid="decision-reports"
      aria-label="决策报表"
    >
      <DecisionReportSwitcher
        currentKey={safeKey}
        visibleTabs={visibleTabs}
        onChange={setCurrentReportKey}
      />
      <div className="v16-decision-reports__content">
        {safeKey === 'sales-summary' ? <V16SalesSummaryPanel /> : null}
        {safeKey === 'sales-outstanding' ? <V16SalesOutstandingPanel /> : null}
        {safeKey === 'purchase-summary' ? <V16PurchaseSummaryPanel /> : null}
        {safeKey === 'purchase-outstanding' ? <V16PurchaseOutstandingPanel /> : null}
        {safeKey === 'inventory-movements' ? <V16InventoryMovementsPanel /> : null}
      </div>
    </main>
  );
}
