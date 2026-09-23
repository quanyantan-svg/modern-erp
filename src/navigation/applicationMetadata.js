// Mobile product information architecture.
//
// Permissions deliberately do not live here. Each item points at one existing
// application page and buildMobileApplicationGroups() only accepts the
// already-authorized `visibleNav` produced from App.jsx navGroups. A permission
// change therefore has one source of truth.

export const MOBILE_APPLICATION_GROUPS = Object.freeze([
  {
    key: 'overview',
    label: '概览',
    accent: 'blue',
    items: [
      { page: 'business-overview', mobileLabel: '业务总览', iconKey: 'overview' },
    ],
  },
  {
    key: 'master-data',
    label: '基础资料',
    accent: 'slate',
    items: [
      { page: 'customers', mobileLabel: '客户', iconKey: 'customers' },
      { page: 'suppliers', mobileLabel: '供应商', iconKey: 'suppliers' },
      { page: 'products', mobileLabel: '产品', iconKey: 'products' },
      { page: 'warehouses', mobileLabel: '仓库', iconKey: 'warehouses' },
    ],
  },
  {
    key: 'planning',
    label: '计划与生产',
    accent: 'blue',
    items: [
      { page: 'forecasts', mobileLabel: '需求预测', iconKey: 'forecasts' },
      { page: 'mrp-runs', mobileLabel: 'MRP 运算', iconKey: 'mrpRuns' },
      { page: 'material-requirements-plan', mobileLabel: '物料需求计划', iconKey: 'materialPlan' },
      { page: 'production-instructions', mobileLabel: '生产指令', iconKey: 'planningDocuments' },
      { page: 'purchase-instructions', mobileLabel: '采购指令', iconKey: 'planningDocuments' },
      { page: 'purchase-requisitions', mobileLabel: '请购单', iconKey: 'planningDocuments' },
      { page: 'production-orders', mobileLabel: '制令单', iconKey: 'productionOrders' },
      { page: 'material-issues', mobileLabel: '用料出库', iconKey: 'salesDeliveries' },
      { page: 'production-receipts', mobileLabel: '生产入库', iconKey: 'purchaseReceipts' },
      { page: 'boms', mobileLabel: 'BOM', iconKey: 'boms' },
      { page: 'product-routings', mobileLabel: '制品工序标准', iconKey: 'routings' },
    ],
  },
  {
    key: 'sales',
    label: '销售',
    accent: 'blue',
    items: [
      { page: 'orders', mobileLabel: '销售订单', iconKey: 'orders' },
      { page: 'sales-deliveries', mobileLabel: '销售出货', iconKey: 'salesDeliveries' },
      { page: 'returns', key: 'returns:sales', mobileLabel: '销售退货', iconKey: 'returns', target: { documentType: 'SALES_RETURN' } },
      { page: 'contacts', mobileLabel: '客户关系', iconKey: 'contacts' },
    ],
  },
  {
    key: 'purchasing',
    label: '采购',
    accent: 'green',
    items: [
      { page: 'purchase-orders', mobileLabel: '采购订单', iconKey: 'purchaseOrders' },
      { page: 'purchase-receipts', mobileLabel: '采购入库', iconKey: 'purchaseReceipts' },
      { page: 'returns', key: 'returns:purchase', mobileLabel: '采购退货', iconKey: 'returns', target: { documentType: 'PURCHASE_RETURN' } },
    ],
  },
  {
    key: 'inventory',
    label: '库存',
    accent: 'amber',
    items: [
      { page: 'inventory', mobileLabel: '库存查询 / 调拨 / 盘点', iconKey: 'inventory' },
      { page: 'inventory-scraps', mobileLabel: '库存报废', iconKey: 'inventoryScrap' },
      { page: 'inventory-month-end', mobileLabel: '存货月结', iconKey: 'inventoryPeriod' },
      { page: 'inventory-transactions', mobileLabel: '库存异动明细', iconKey: 'inventoryTransactions' },
      { page: 'traceability', mobileLabel: '批次 / 序列号追溯', iconKey: 'inventoryTransactions' },
    ],
  },
  {
    key: 'quality',
    label: '质量',
    accent: 'green',
    items: [
      { page: 'iqc', mobileLabel: 'IQC 来料检验', iconKey: 'iqc' },
      { page: 'oqc', mobileLabel: 'OQC 出货检验', iconKey: 'oqc' },
      { page: 'quality-control-points', mobileLabel: '质量控制点', iconKey: 'iqc' },
      { page: 'product-costs', mobileLabel: '标准成本', iconKey: 'costAccounting' },
      { page: 'cost-rates', mobileLabel: '费用项目', iconKey: 'costAccounting' },
    ],
  },
  {
    key: 'finance',
    label: '财务',
    accent: 'slate',
    items: [
      { page: 'accounts-receivable', mobileLabel: '应收账款', iconKey: 'accounting' },
      { page: 'payment-collections', mobileLabel: '收款单', iconKey: 'cashJournals' },
      { page: 'accounts-payable', mobileLabel: '应付账款', iconKey: 'accounting' },
      { page: 'payment-disbursements', mobileLabel: '付款单', iconKey: 'bankAccounts' },
      { page: 'sales-discounts', mobileLabel: '销售折让', iconKey: 'salesDiscount' },
      { page: 'purchase-discounts', mobileLabel: '采购折让', iconKey: 'purchaseDiscount' },
      { page: 'accounting', mobileLabel: '会计凭证 / 财务报表', iconKey: 'accounting' },
      { page: 'cash-journals', mobileLabel: '现金日记账', iconKey: 'cashJournals' },
      { page: 'bank-accounts', mobileLabel: '银行账户', iconKey: 'bankAccounts' },
      { page: 'bills', mobileLabel: '票据管理', iconKey: 'bills' },
      { page: 'fixed-assets', mobileLabel: '固定资产', iconKey: 'fixedAssets' },
    ],
  },
  {
    key: 'reports',
    label: '决策报表',
    accent: 'blue',
    items: [
      { page: 'decision-reports', mobileLabel: '销售统计', iconKey: 'reports', reportKey: 'sales-summary' },
      { page: 'decision-reports', mobileLabel: '销售未交', iconKey: 'reports', reportKey: 'sales-outstanding' },
      { page: 'decision-reports', mobileLabel: '采购统计', iconKey: 'reports', reportKey: 'purchase-summary' },
      { page: 'decision-reports', mobileLabel: '采购未交', iconKey: 'reports', reportKey: 'purchase-outstanding' },
      { page: 'decision-reports', mobileLabel: '库存异动明细', iconKey: 'reports', reportKey: 'inventory-movements' },
    ],
  },
  {
    key: 'projects',
    label: '项目',
    accent: 'slate',
    items: [
      { page: 'projects', mobileLabel: '项目立项', iconKey: 'projects' },
      { page: 'tasks', mobileLabel: '任务管理', iconKey: 'tasks' },
      { page: 'timesheets', mobileLabel: '工时记录', iconKey: 'timesheets' },
    ],
  },
  {
    key: 'system',
    label: '系统',
    accent: 'slate',
    items: [
      { page: 'workflows', mobileLabel: '审批流定义', iconKey: 'approvals' },
      { page: 'users', mobileLabel: '用户与角色', iconKey: 'users' },
      { page: 'data-cleanup', mobileLabel: '数据整理', iconKey: 'cleanup' },
      { page: 'notifications', mobileLabel: '通知中心', iconKey: 'notifications' },
    ],
  },
]);

export const DEFERRED_MOBILE_APPLICATIONS = Object.freeze([]);

export function buildMobileApplicationGroups(visibleNav = [], options = {}) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));
  const isItemVisible = options.isItemVisible || (() => true);

  return MOBILE_APPLICATION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    accent: group.accent,
    items: group.items.flatMap((metadata) => {
      const navigationItem = authorizedByPage.get(metadata.page);
      if (!navigationItem || !isItemVisible(metadata)) return [];
      return [{
        ...navigationItem,
        page: navigationItem.key,
        label: metadata.mobileLabel || navigationItem.label,
        iconKey: metadata.iconKey,
        key: metadata.key || (metadata.reportKey ? navigationItem.key + ':' + metadata.reportKey : navigationItem.key),
        reportKey: metadata.reportKey || null,
        target: metadata.target || null,
      }];
    }),
  })).filter((group) => group.items.length > 0);
}
