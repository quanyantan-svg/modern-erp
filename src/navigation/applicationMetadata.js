import { presentationForRoute } from './presentationMetadata.js';

// V1.5 D2 application launcher hierarchy. Authorization still comes only
// from App.jsx visibleNav; this file controls labels and disclosure.
export const MOBILE_APPLICATION_GROUPS = Object.freeze([
  { key: 'master-data', label: '基础资料', kind: 'domain', items: [
    ['products', '货品资料', 'products', 'primary'], ['customers', '客户资料', 'customers', 'primary'],
    ['suppliers', '供应商资料', 'suppliers', 'primary'], ['warehouses', '仓库资料', 'warehouses', 'primary'],
  ] },
  { key: 'sales', label: '销售', kind: 'domain', items: [
    ['orders', '销售订单', 'orders', 'primary'], ['sales-deliveries', '销售出货', 'salesDeliveries', 'primary'],
    ['accounts-receivable', '应收结算', 'accounting', 'primary'], ['returns', '销售退货', 'returns', 'secondary', { documentType: 'SALES_RETURN' }, 'returns:sales'],
    ['sales-invoices', '销售发票', 'accounting', 'secondary'], ['payment-collections', '收款 / 核销', 'cashJournals', 'secondary'],
    ['sales-discounts', '销售折让', 'salesDiscount', 'secondary'], ['oqc', 'OQC 出货检验', 'oqc', 'contextual'],
  ] },
  { key: 'planning', label: '计划 / MRP', kind: 'domain', items: [
    ['forecasts', '计划预测', 'forecasts', 'primary'], ['mrp-runs', 'MRP', 'mrpRuns', 'primary'],
    ['production-instructions', '生产指令', 'planningDocuments', 'primary'], ['purchase-instructions', '采购指令', 'planningDocuments', 'primary'],
    ['material-requirements-plan', '物料建议', 'materialPlan', 'secondary'],
  ] },
  { key: 'production', label: '生产', kind: 'domain', items: [
    ['production-orders', '制令单', 'productionOrders', 'primary'], ['material-issues', '用料出库', 'salesDeliveries', 'primary'],
    ['production-receipts', '生产入库', 'purchaseReceipts', 'primary'], ['boms', 'BOM', 'boms', 'secondary'],
    ['product-routings', '制品工序标准', 'routings', 'secondary'],
    ['product-costs', '标准成本', 'costAccounting', 'advanced'], ['cost-rates', '成本费率', 'costAccounting', 'advanced'],
  ] },
  { key: 'purchasing', label: '采购', kind: 'domain', items: [
    ['purchase-requisitions', '请购单', 'planningDocuments', 'primary'], ['purchase-orders', '采购订单', 'purchaseOrders', 'primary'],
    ['purchase-receipts', '采购入库', 'purchaseReceipts', 'primary'], ['accounts-payable', '应付结算', 'accounting', 'primary'],
    ['returns', '采购退货', 'returns', 'secondary', { documentType: 'PURCHASE_RETURN' }, 'returns:purchase'],
    ['supplier-bills', '供应商账单', 'accounting', 'secondary'], ['payment-disbursements', '付款 / 核销', 'bankAccounts', 'secondary'],
    ['purchase-discounts', '采购折让', 'purchaseDiscount', 'secondary'], ['iqc', 'IQC 来料检验', 'iqc', 'contextual'],
  ] },
  { key: 'inventory', label: '库存', kind: 'domain', items: [
    ['inventory', '库存作业', 'inventory', 'primary'], ['inventory-scraps', '存货报废', 'inventoryScrap', 'primary'],
    ['inventory-month-end', '存货月结', 'inventoryPeriod', 'primary'], ['inventory-transactions', '库存异动明细', 'inventoryTransactions', 'primary'],
    ['traceability', '批次 / 序列号追溯', 'traceability', 'secondary'],
  ] },
  { key: 'analytics', label: '经营分析', kind: 'domain', items: [
    ['decision-reports', '销售统计分析', 'reports', 'primary', null, null, 'sales-summary'],
    ['decision-reports', '采购统计分析', 'reports', 'primary', null, null, 'purchase-summary'],
    ['decision-reports', '库存异动明细', 'reports', 'primary', null, null, 'inventory-movements'],
    ['decision-reports', '销售未出货', 'reports', 'secondary', null, null, 'sales-outstanding'],
    ['decision-reports', '采购未交货', 'reports', 'secondary', null, null, 'purchase-outstanding'],
  ] },
  { key: 'workspace', label: '工作区', kind: 'utility', items: [
    ['business-overview', '业务总览', 'overview', 'shortcut'], ['accounting', '会计凭证 / 财务报表', 'accounting', 'finance'],
    ['cash-journals', '现金日记账', 'cashJournals', 'finance'], ['bank-accounts', '银行账户', 'bankAccounts', 'finance'],
    ['bills', '票据管理', 'bills', 'finance'], ['fixed-assets', '固定资产', 'fixedAssets', 'finance'],
  ] },
  { key: 'advanced', label: '高级设置', kind: 'utility', items: [
    ['quality-control-points', '质量规则', 'iqc', 'advanced'],
  ] },
  { key: 'extension', label: '更多业务', kind: 'utility', items: [
    ['projects', '项目立项', 'projects', 'extension'], ['tasks', '任务管理', 'tasks', 'extension'],
    ['timesheets', '工时记录', 'timesheets', 'extension'], ['contacts', '客户关系', 'contacts', 'extension'],
  ] },
  { key: 'system', label: '系统设置', kind: 'utility', items: [
    ['workflows', '审批流定义', 'approvals', 'system'], ['users', '用户与权限', 'users', 'system'],
    ['data-cleanup', '数据整理', 'cleanup', 'system'], ['notifications', '通知中心', 'notifications', 'system'],
  ] },
].map((group) => Object.freeze({ ...group, items: Object.freeze(group.items.map(([page, mobileLabel, iconKey, tier, target = null, key = null, reportKey = null]) => Object.freeze({ page, mobileLabel, iconKey, tier, target, key, reportKey }))) })));

export const DEFERRED_MOBILE_APPLICATIONS = Object.freeze([]);

export function buildMobileApplicationGroups(visibleNav = [], options = {}) {
  const authorizedByPage = new Map(visibleNav.map((item) => [item.key, item]));
  const isItemVisible = options.isItemVisible || (() => true);
  return MOBILE_APPLICATION_GROUPS.map((group) => ({
    key: group.key, label: group.label, kind: group.kind,
    items: group.items.flatMap((metadata) => {
      const navigationItem = authorizedByPage.get(metadata.page);
      if (!navigationItem || !isItemVisible(metadata)) return [];
      return [{ ...navigationItem,
        presentation: presentationForRoute(metadata.page), page: navigationItem.key,
        label: metadata.mobileLabel || navigationItem.label, iconKey: metadata.iconKey, tier: metadata.tier,
        key: metadata.key || (metadata.reportKey ? `${navigationItem.key}:${metadata.reportKey}` : navigationItem.key),
        reportKey: metadata.reportKey || null, target: metadata.target || null,
      }];
    }),
  })).filter((group) => group.items.length > 0);
}
