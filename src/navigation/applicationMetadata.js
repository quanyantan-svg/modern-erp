import { presentationForRoute } from './presentationMetadata.js';

// V1.6 P1B — six flowchart-aligned core application groups.
//
// The launcher reads these definitions in `buildMobileApplicationGroups`.
// This metadata is intersected with the authorized visibleNav, then rendered
// resulting groups as direct application grids (no domain selector).
//
// Items in a `kind: 'domain'` group are the user-facing core tiles.
// Items in a `kind: 'utility'` group are revealed only via the
// collapsed utility disclosures at the bottom of the launcher.
//
// IQC, OQC and material-requirements-plan are intentionally NOT core
// tiles — they remain reachable only as routes / contextual flows.
export const MOBILE_APPLICATION_GROUPS = Object.freeze([
  {
    key: 'master-data',
    label: '基础资料',
    kind: 'domain',
    items: [
      ['products', '货品资料', 'products'],
      ['boms', 'BOM', 'boms'],
      ['customers', '客户资料', 'customers'],
      ['suppliers', '供应商资料', 'suppliers'],
      ['warehouses', '仓库资料', 'warehouses'],
      ['product-routings', '制品工序标准', 'routings'],
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    kind: 'domain',
    items: [
      ['orders', '销售订单', 'orders'],
      ['sales-deliveries', '销售出货', 'salesDeliveries'],
      ['returns', '销售退货', 'returns', 'returns:sales', { documentType: 'SALES_RETURN' }],
      ['accounts-receivable', '应收结算', 'accountsReceivable'],
      ['sales-discounts', '销售折让', 'salesDiscount'],
    ],
  },
  {
    key: 'production',
    label: '生产管理',
    kind: 'domain',
    items: [
      ['forecasts', '计划预测', 'forecasts'],
      ['mrp-runs', 'MRP', 'mrpRuns'],
      ['production-instructions', '生产指令', 'planningDocuments'],
      ['production-orders', '制令单', 'productionOrders'],
      ['material-issues', '用料出库', 'salesDeliveries'],
      ['production-receipts', '生产入库', 'purchaseReceipts'],
    ],
  },
  {
    key: 'purchasing',
    label: '采购管理',
    kind: 'domain',
    items: [
      ['purchase-instructions', '采购指令', 'planningDocuments'],
      ['purchase-requisitions', '请购单', 'planningDocuments'],
      ['purchase-orders', '采购订单', 'purchaseOrders'],
      ['purchase-receipts', '采购入库', 'purchaseReceipts'],
      ['returns', '采购退货', 'returns', 'returns:purchase', { documentType: 'PURCHASE_RETURN' }],
      ['accounts-payable', '应付结算', 'accountsPayable'],
      ['purchase-discounts', '采购折让', 'purchaseDiscount'],
    ],
  },
  {
    key: 'inventory',
    label: '库存管理',
    kind: 'domain',
    items: [
      ['inventory', '库存作业', 'inventory'],
      ['inventory-scraps', '存货报废', 'inventoryScrap'],
      ['inventory-month-end', '存货月结', 'inventoryPeriod'],
      ['inventory-transactions', '库存异动', 'inventoryTransactions'],
      ['traceability', '批次 / 序列号', 'traceability'],
    ],
  },
  {
    key: 'analytics',
    label: '决策报表',
    kind: 'domain',
    items: [
      ['decision-reports', '销售统计分析表', 'reports', null, null, 'sales-summary'],
      ['decision-reports', '销售未出货反应表', 'reports', null, null, 'sales-outstanding'],
      ['decision-reports', '采购统计分析表', 'reports', null, null, 'purchase-summary'],
      ['decision-reports', '采购未交货反应表', 'reports', null, null, 'purchase-outstanding'],
      ['decision-reports', '存货异动明细表', 'reports', null, null, 'inventory-movements'],
    ],
  },
  // Utility disclosures — collapsed at the bottom of the launcher.
  // All reachable active routes that are not core tiles must appear here
  // (or remain reachable through bottom tabs / contextual navigation).
  {
    key: 'utility-flows',
    label: '业务流程',
    kind: 'utility',
    items: [
      ['business-overview', '业务总览', 'overview'],
    ],
  },
  {
    key: 'utility-finance',
    label: '财务工具',
    kind: 'utility',
    items: [
      ['sales-invoices', '销售发票', 'accounting'],
      ['payment-collections', '收款 / 核销', 'paymentCollections'],
      ['supplier-bills', '供应商账单', 'accounting'],
      ['payment-disbursements', '付款 / 核销', 'paymentDisbursements'],
      ['accounting', '会计凭证', 'accounting'],
      ['bank-accounts', '银行账户', 'bankAccounts'],
    ],
  },
  {
    key: 'utility-extension',
    label: '更多业务',
    kind: 'utility',
    items: [
      ['projects', '项目立项', 'projects'],
      ['tasks', '任务管理', 'tasks'],
      ['timesheets', '工时记录', 'timesheets'],
      ['contacts', '联系人管理', 'contacts'],
      ['followups', '客户跟进', 'followups'],
      ['activities', '销售活动', 'activities'],
    ],
  },
  {
    key: 'utility-advanced',
    label: '高级设置',
    kind: 'utility',
    items: [
      ['quality-control-points', '质量规则', 'iqc'],
      ['product-costs', '标准成本', 'costAccounting'],
      ['cost-rates', '成本费率', 'costAccounting'],
    ],
  },
  {
    key: 'utility-system',
    label: '系统设置',
    kind: 'utility',
    items: [
      ['users', '用户与权限', 'users'],
    ],
  },
].map((group) => Object.freeze({
  ...group,
  items: Object.freeze(group.items.map(([page, mobileLabel, iconKey, key = null, target = null, reportKey = null]) => Object.freeze({
    page,
    mobileLabel,
    iconKey,
    key: key || (reportKey ? `${page}:${reportKey}` : page),
    target,
    reportKey,
  }))),
})));

export const DEFERRED_MOBILE_APPLICATIONS = Object.freeze([]);

// Priority order for the auto-built "常用" section. Only items the
// current user is authorized to see are considered; at most three are
// surfaced. The first matching item in this order wins.
export const MOBILE_COMMON_PRIORITY = Object.freeze([
  'orders',
  'purchase-orders',
  'purchase-receipts',
  'sales-deliveries',
  'inventory',
  'mrp-runs',
]);

export function buildMobileApplicationGroups(visibleNav = [], options = {}) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));
  const isItemVisible = options.isItemVisible || (() => true);
  return MOBILE_APPLICATION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    kind: group.kind,
    items: group.items.flatMap((metadata) => {
      const navigationItem = authorizedByPage.get(metadata.page);
      if (!navigationItem || !isItemVisible(metadata)) return [];
      return [{
        ...navigationItem,
        presentation: presentationForRoute(metadata.page),
        page: navigationItem.key,
        label: metadata.mobileLabel || navigationItem.label,
        iconKey: metadata.iconKey,
        key: metadata.key,
        reportKey: metadata.reportKey || null,
        target: metadata.target || null,
      }];
    }),
  })).filter((group) => group.items.length > 0);
}

export function buildMobileCommonItems(visibleNav = [], options = {}) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));
  const isItemVisible = options.isItemVisible || (() => true);
  const items = [];
  for (const page of MOBILE_COMMON_PRIORITY) {
    if (items.length >= 3) break;
    const navigationItem = authorizedByPage.get(page);
    if (!navigationItem) continue;
    const visible = isItemVisible({ page, reportKey: null, target: null });
    if (!visible) continue;
    items.push({
      ...navigationItem,
      page: navigationItem.key,
      label: navigationItem.label,
      iconKey: navigationItem.iconKey,
      key: navigationItem.key,
      reportKey: null,
      target: null,
    });
  }
  return items;
}
