// Mobile product information architecture.
//
// Permissions deliberately do not live here. Each item points at one existing
// desktop navigation page and buildMobileApplicationGroups() only accepts the
// already-authorized `visibleNav` produced from App.jsx navGroups. A permission
// change therefore has one source of truth.

export const MOBILE_APPLICATION_GROUPS = Object.freeze([
  {
    key: 'master-data',
    label: '基础资料',
    accent: 'slate',
    items: [
      { page: 'customers', mobileLabel: '客户', iconKey: 'customers' },
      { page: 'suppliers', mobileLabel: '供应商', iconKey: 'suppliers' },
      { page: 'products', mobileLabel: '货品', iconKey: 'products' },
      { page: 'warehouses', mobileLabel: '仓库', iconKey: 'warehouses' },
      { page: 'boms', mobileLabel: 'BOM', iconKey: 'boms' },
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    accent: 'blue',
    items: [
      { page: 'orders', mobileLabel: '销售订单', iconKey: 'orders' },
      { page: 'sales-deliveries', mobileLabel: '销售出货', iconKey: 'salesDeliveries' },
      { page: 'returns', mobileLabel: '销售 / 采购退货', iconKey: 'returns' },
      { page: 'contacts', mobileLabel: '客户关系', iconKey: 'contacts' },
    ],
  },
  {
    key: 'purchasing',
    label: '采购管理',
    accent: 'green',
    items: [
      { page: 'purchase-orders', mobileLabel: '采购订单', iconKey: 'purchaseOrders' },
      { page: 'purchase-receipts', mobileLabel: '采购入库', iconKey: 'purchaseReceipts' },
    ],
  },
  {
    key: 'inventory',
    label: '仓储库存',
    accent: 'amber',
    items: [
      { page: 'inventory', mobileLabel: '库存查询 / 调拨 / 盘点', iconKey: 'inventory' },
      { page: 'inventory-transactions', mobileLabel: '库存异动', iconKey: 'inventoryTransactions' },
    ],
  },
  {
    key: 'manufacturing',
    label: '生产管理',
    accent: 'blue',
    items: [
      { page: 'production-orders', mobileLabel: '制令单', iconKey: 'productionOrders' },
      { page: 'material-issues', mobileLabel: '用料出库', iconKey: 'salesDeliveries' },
      { page: 'production-receipts', mobileLabel: '生产入库', iconKey: 'purchaseReceipts' },
    ],
  },
  {
    key: 'quality',
    label: '质量管理',
    accent: 'green',
    items: [
      { page: 'iqc', mobileLabel: 'IQC 来料检验', iconKey: 'iqc' },
      { page: 'oqc', mobileLabel: 'OQC 出货检验', iconKey: 'oqc' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    accent: 'slate',
    items: [
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
    items: [],
  },
  {
    key: 'system',
    label: '系统管理',
    accent: 'slate',
    items: [
      { page: 'workflows', mobileLabel: '审批流定义', iconKey: 'approvals' },
      { page: 'users', mobileLabel: '用户与角色', iconKey: 'users' },
    ],
  },
]);

export const DEFERRED_MOBILE_APPLICATIONS = Object.freeze([
  '请购单', 'MRP', '生产指令',
  '库存调整', '库存报废', '库存月结', '应收', '应付', '收款', '付款',
  '采购统计', '采购未交货', '销售统计', '销售未出货',
]);

export function buildMobileApplicationGroups(visibleNav = []) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));

  return MOBILE_APPLICATION_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    accent: group.accent,
    items: group.items.flatMap((metadata) => {
      const navigationItem = authorizedByPage.get(metadata.page);
      if (!navigationItem) return [];
      return [{
        ...navigationItem,
        page: navigationItem.key,
        label: metadata.mobileLabel || navigationItem.label,
        iconKey: metadata.iconKey,
      }];
    }),
  })).filter((group) => group.items.length > 0);
}
