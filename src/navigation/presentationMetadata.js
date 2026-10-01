// V1.5 D0 — presentation-only route registry.
// Business rules and backend authorization deliberately do not live here.

export const PRIMARY_DOMAINS = Object.freeze([
  { key: 'master-data', label: '基础资料' },
  { key: 'sales', label: '销售' },
  { key: 'planning', label: '计划 / MRP' },
  { key: 'production', label: '生产' },
  { key: 'purchasing', label: '采购' },
  { key: 'inventory', label: '库存' },
  { key: 'analytics', label: '经营分析' },
]);

export const APPROVAL_FAMILIES = Object.freeze([
  'SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER',
]);

const route = (route, title, domain, semanticLevel, template, level, navGroup, iconKey, access, extra = {}) => Object.freeze({
  route, title, domain, semanticLevel, template, level, navGroup, iconKey, ...access, ...extra,
});

export const ROUTE_PRESENTATIONS = Object.freeze([
  route('business-overview','业务总览','cross-domain','FLOW_SUPPORTING','WORKFLOW','primary','概览','overview',{permission:'DASHBOARD_VIEW'},{mobileExposure:'launcher',desktopExposure:'global'}),
  route('dashboard','工作台','cross-domain','FLOW_SUPPORTING','WORKFLOW','secondary','概览','dashboard',{permission:'DASHBOARD_VIEW'},{mobileExposure:'role-workspace',desktopExposure:'role-workspace'}),
  route('orders','销售订单','sales','FLOW_PRIMARY','LIST','primary','销售与采购','orders',{any:['ORDERS_VIEW','ORDERS_CREATE']}),
  route('approvals','业务审批','cross-domain','FLOW_SUPPORTING','WORKFLOW','primary','销售与采购','approvals',{permission:'ORDERS_APPROVE'},{mobileExposure:'approval-tab',desktopExposure:'global',approvalFamilies:APPROVAL_FAMILIES}),
  route('purchase-orders','采购订单','purchasing','FLOW_PRIMARY','LIST','primary','销售与采购','purchaseOrders',{any:['PURCHASE_ORDERS_VIEW','PURCHASE_ORDERS_CREATE']}),
  route('suppliers','供应商资料','master-data','FLOW_PRIMARY','LIST','primary','基础资料','suppliers',{any:['SUPPLIERS_VIEW','SUPPLIERS_MANAGE']}),
  route('customers','客户资料','master-data','FLOW_PRIMARY','LIST','primary','基础资料','customers',{any:['CUSTOMERS_VIEW','CUSTOMERS_MANAGE']}),
  route('products','货品资料','master-data','FLOW_PRIMARY','LIST','primary','基础资料','products',{any:['PRODUCTS_VIEW','PRODUCTS_MANAGE']}),
  route('warehouses','仓库资料','master-data','FLOW_PRIMARY','LIST','primary','基础资料','warehouses',{any:['WAREHOUSES_VIEW','WAREHOUSES_MANAGE']}),
  route('inventory','库存作业','inventory','FLOW_PRIMARY','WORKFLOW','primary','仓储物流','inventory',{any:['INVENTORY_VIEW']}),
  route('purchase-receipts','采购入库','purchasing','FLOW_PRIMARY','LIST','primary','仓储物流','purchaseReceipts',{any:['PURCHASE_RECEIPTS_VIEW','PURCHASE_RECEIPTS_MANAGE']},{contextHint:'仓库验收'}),
  route('sales-deliveries','销售出货','sales','FLOW_PRIMARY','LIST','primary','仓储物流','salesDeliveries',{any:['SALES_DELIVERIES_VIEW','SALES_DELIVERIES_MANAGE']}),
  route('returns','退货管理','sales-purchasing','FLOW_SUPPORTING','LIST','secondary','仓储物流','returns',{any:['RETURNS_VIEW','RETURNS_MANAGE']}),
  route('inventory-transactions','库存异动明细','analytics','REPORT','REPORT','contextual','仓储物流','inventoryTransactions',{any:['INVENTORY_VIEW']}),
  route('traceability','批次 / 序列号追溯','inventory','FLOW_SUPPORTING','REPORT','secondary','仓储物流','traceability',{any:['INVENTORY_VIEW','PURCHASE_RECEIPTS_VIEW','SALES_DELIVERIES_VIEW']}),
  route('inventory-scraps','存货报废','inventory','FLOW_PRIMARY','LIST','primary','仓储物流','inventoryScrap',{any:['INVENTORY_SCRAP_VIEW','INVENTORY_SCRAP_MANAGE']}),
  route('inventory-month-end','存货月结','inventory','FLOW_PRIMARY','WORKFLOW','primary','仓储物流','inventoryPeriod',{any:['INVENTORY_PERIOD_CLOSE_VIEW','INVENTORY_PERIOD_CLOSE_MANAGE']}),
  route('sales-discounts','销售折让','sales','FLOW_INTERNAL_STEP','LIST','contextual','仓储物流','salesDiscount',{any:['SALES_DISCOUNT_MANAGE']},{parentRoute:'accounts-receivable'}),
  route('purchase-discounts','采购折让','purchasing','FLOW_INTERNAL_STEP','LIST','contextual','仓储物流','purchaseDiscount',{any:['PURCHASE_DISCOUNT_MANAGE']},{parentRoute:'accounts-payable'}),
  route('sales-invoices','销售发票','sales','FLOW_INTERNAL_STEP','LIST','secondary','财务资金','accounting',{any:['AR_VIEW','ACCOUNTING_VIEW']},{parentRoute:'accounts-receivable'}),
  route('accounts-receivable','应收结算','sales','FLOW_PRIMARY','WORKFLOW','primary','财务资金','accounting',{any:['AR_VIEW','COLLECTION_MANAGE']}),
  route('payment-collections','收款 / 核销','sales','FLOW_INTERNAL_STEP','LIST','contextual','财务资金','cashJournals',{any:['AR_VIEW','COLLECTION_MANAGE']},{parentRoute:'accounts-receivable'}),
  route('accounts-payable','应付结算','purchasing','FLOW_PRIMARY','WORKFLOW','secondary','财务资金','accounting',{any:['AP_VIEW','PAYMENT_MANAGE']}),
  route('supplier-bills','供应商账单','purchasing','FLOW_INTERNAL_STEP','LIST','secondary','财务资金','accounting',{any:['AP_VIEW','ACCOUNTING_VIEW']},{parentRoute:'accounts-payable'}),
  route('payment-disbursements','付款 / 核销','purchasing','FLOW_INTERNAL_STEP','LIST','contextual','财务资金','bankAccounts',{any:['AP_VIEW','PAYMENT_MANAGE']},{parentRoute:'accounts-payable'}),
  route('accounting','会计凭证','analytics','FLOW_SUPPORTING','LIST','secondary','财务资金','accounting',{any:['ACCOUNTING_VIEW']},{desktopExposure:'role-workspace',mobileExposure:'role-workspace'}),
  route('bank-accounts','银行账户','master-data','ADVANCED_CONFIGURATION','CONFIG','contextual','财务资金','bankAccounts',{any:['BANK_ACCOUNTS_VIEW','BANK_ACCOUNTS_MANAGE']},{desktopExposure:'role-workspace',mobileExposure:'role-workspace'}),
  route('decision-reports','经营分析','analytics','REPORT','REPORT','primary','决策报表','reports',{any:['REPORT_VIEW']}),
  route('boms','BOM','production','ADVANCED_CONFIGURATION','CONFIG','secondary','生产制造','boms',{any:['PRODUCTION_ORDERS_CREATE']}),
  route('product-routings','制品工序标准','production','ADVANCED_CONFIGURATION','CONFIG','secondary','生产制造','routings',{any:['ROUTING_VIEW','ROUTING_MANAGE']}),
  route('production-orders','制令单','production','FLOW_PRIMARY','LIST','primary','生产制造','productionOrders',{any:['PRODUCTION_ORDERS_VIEW','PRODUCTION_ORDERS_CREATE']}),
  route('material-issues','用料出库','production','FLOW_PRIMARY','LIST','primary','生产制造','salesDeliveries',{any:['PRODUCTION_MATERIAL_ISSUE_MANAGE']}),
  route('production-receipts','生产入库','production','FLOW_PRIMARY','LIST','primary','生产制造','purchaseReceipts',{any:['PRODUCTION_RECEIPT_MANAGE']}),
  route('manufacturing-analytics','生产执行分析','analytics','REPORT','REPORT','secondary','生产制造','reports',{any:['PRODUCTION_ORDERS_VIEW','PRODUCTION_COSTS_VIEW']},{mobileExposure:'contextual'}),
  route('forecasts','计划预测','planning','FLOW_PRIMARY','LIST','primary','计划与生产','forecasts',{any:['MRP_VIEW','MRP_MANAGE']}),
  route('mrp-runs','MRP','planning','FLOW_PRIMARY','WORKFLOW','primary','计划与生产','mrpRuns',{any:['MRP_VIEW','MRP_MANAGE']},{presentationConcept:'MRP'}),
  route('material-requirements-plan','物料需求计划','planning','FLOW_INTERNAL_STEP','REPORT','contextual','计划与生产','materialPlan',{any:['MRP_VIEW','MRP_MANAGE']},{parentRoute:'mrp-runs',presentationConcept:'MRP'}),
  route('production-instructions','生产指令','planning-production','FLOW_PRIMARY','LIST','primary','计划与生产','planningDocuments',{any:['PRODUCTION_INSTRUCTION_VIEW']}),
  route('purchase-instructions','采购指令','planning-purchasing','FLOW_PRIMARY','LIST','primary','计划与生产','planningDocuments',{any:['PURCHASE_INSTRUCTION_VIEW']}),
  route('purchase-requisitions','请购单','purchasing','FLOW_PRIMARY','LIST','primary','计划与生产','planningDocuments',{any:['PURCHASE_REQUISITION_VIEW']}),
  route('product-costs','标准成本','production','ADVANCED_CONFIGURATION','CONFIG','contextual','成本与质量','costAccounting',{any:['COST_VIEW','COST_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('cost-rates','成本费率','production','ADVANCED_CONFIGURATION','CONFIG','contextual','成本与质量','costAccounting',{any:['COST_VIEW','COST_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('iqc','IQC 来料检验','purchasing','FLOW_INTERNAL_STEP','WORKFLOW','contextual','成本与质量','iqc',{any:['IQC_VIEW','IQC_MANAGE']},{parentRoute:'purchase-receipts'}),
  route('oqc','OQC 出货检验','sales','FLOW_INTERNAL_STEP','WORKFLOW','contextual','成本与质量','oqc',{any:['OQC_VIEW','OQC_MANAGE']},{parentRoute:'sales-deliveries'}),
  route('quality-control-points','质量规则','cross-domain','ADVANCED_CONFIGURATION','CONFIG','contextual','成本与质量','iqc',{any:['USERS_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('projects','项目立项','extension','EXTENSION_BUSINESS','LIST','secondary','项目管理','projects',{any:['PROJECT_VIEW','PROJECT_MANAGE']},{desktopExposure:'extension',mobileExposure:'extension'}),
  route('tasks','任务管理','extension','EXTENSION_BUSINESS','LIST','secondary','项目管理','tasks',{any:['PROJECT_VIEW','PROJECT_MANAGE']},{desktopExposure:'extension',mobileExposure:'extension',parentRoute:'projects'}),
  route('timesheets','工时记录','extension','EXTENSION_BUSINESS','LIST','secondary','项目管理','timesheets',{any:['PROJECT_VIEW','PROJECT_MANAGE']},{desktopExposure:'extension',mobileExposure:'extension',parentRoute:'projects'}),
  route('contacts','联系人','extension','EXTENSION_BUSINESS','LIST','secondary','CRM客户关系','contacts',{any:['CRM_VIEW','CRM_MANAGE']},{desktopExposure:'extension',mobileExposure:'extension'}),
  route('followups','客户跟进','extension','EXTENSION_BUSINESS','LIST','secondary','CRM客户关系','followups',{any:['CRM_VIEW','CRM_MANAGE']},{desktopExposure:'extension',mobileExposure:'nested-crm'}),
  route('activities','销售活动','extension','EXTENSION_BUSINESS','LIST','secondary','CRM客户关系','activities',{any:['CRM_VIEW','CRM_MANAGE']},{desktopExposure:'extension',mobileExposure:'nested-crm'}),
  route('notifications','通知中心','system','SYSTEM_SUPPORT','LIST','contextual','系统设置','notifications',{any:['DASHBOARD_VIEW']},{desktopExposure:'global',mobileExposure:'messages-tab'}),
  route('users','用户与权限','system','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','users',{any:['USERS_MANAGE','ROLES_MANAGE']},{desktopExposure:'system-settings',mobileExposure:'system-settings'}),
]);

export const DISABLED_ROUTE_PRESENTATIONS = Object.freeze([
  route('cash-journals','现金日记账','role-workspace','SYSTEM_SUPPORT','LIST','contextual','财务资金','cashJournals',{any:['CASH_JOURNALS_VIEW','CASH_JOURNALS_MANAGE']},{enabled:false}),
  route('bills','票据管理','role-workspace','SYSTEM_SUPPORT','LIST','contextual','财务资金','bills',{any:['BILLS_VIEW','BILLS_MANAGE']},{enabled:false}),
  route('fixed-assets','固定资产','role-workspace','SYSTEM_SUPPORT','LIST','contextual','财务资金','fixedAssets',{any:['FIXED_ASSETS_VIEW','FIXED_ASSETS_MANAGE']},{enabled:false}),
  route('workflows','审批流','system','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','approvals',{any:['WORKFLOW_VIEW','WORKFLOW_MANAGE']},{enabled:false}),
  route('data-cleanup','数据整理','system','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','cleanup',{permission:'USERS_MANAGE'},{enabled:false}),
]);

export const TECHNICAL_ROUTE_ALIASES = Object.freeze({ mrp: 'material-requirements-plan' });
export const presentationForRoute = (routeKey) => ROUTE_PRESENTATIONS.find((item) => item.route === routeKey) || null;

const GROUP_ORDER = Object.freeze(['概览','销售与采购','基础资料','仓储物流','财务资金','决策报表','生产制造','计划与生产','成本与质量','项目管理','CRM客户关系','系统设置']);

export function buildNavigationGroups(icons = {}) {
  const all = [...ROUTE_PRESENTATIONS, ...DISABLED_ROUTE_PRESENTATIONS];
  return GROUP_ORDER.map((label) => ({
    label,
    items: all.filter((item) => item.navGroup === label).map((item) => ({
      key: item.route,
      label: item.title,
      icon: icons[item.iconKey],
      ...(item.permission ? { permission: item.permission } : { any: item.any }),
      ...(item.enabled === false ? { enabled: false } : {}),
      presentation: item,
    })),
  }));
}
