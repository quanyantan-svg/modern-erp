// V1.7 P0 — canonical frontend application registry.
// Route, access, presentation, launcher and screen definitions live here only.

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

const ACTIVE_ROUTE_DEFINITIONS = Object.freeze([
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

const DISABLED_ROUTE_DEFINITIONS = Object.freeze([
  route('cash-journals','现金日记账','role-workspace','SYSTEM_SUPPORT','LIST','contextual','财务资金','cashJournals',{any:['CASH_JOURNALS_VIEW','CASH_JOURNALS_MANAGE']},{enabled:false}),
  route('bills','票据管理','role-workspace','SYSTEM_SUPPORT','LIST','contextual','财务资金','bills',{any:['BILLS_VIEW','BILLS_MANAGE']},{enabled:false}),
  route('fixed-assets','固定资产','role-workspace','SYSTEM_SUPPORT','LIST','contextual','财务资金','fixedAssets',{any:['FIXED_ASSETS_VIEW','FIXED_ASSETS_MANAGE']},{enabled:false}),
  route('workflows','审批流','system','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','approvals',{any:['WORKFLOW_VIEW','WORKFLOW_MANAGE']},{enabled:false}),
  route('data-cleanup','数据整理','system','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','cleanup',{permission:'USERS_MANAGE'},{enabled:false}),
]);

export const TECHNICAL_ROUTE_ALIASES = Object.freeze({ mrp: 'material-requirements-plan' });

export const DESKTOP_GROUP_ORDER = Object.freeze(['概览','销售与采购','基础资料','仓储物流','财务资金','决策报表','生产制造','计划与生产','成本与质量','项目管理','CRM客户关系','系统设置']);

export const RESPONSIVE_MODES = Object.freeze({ LEGACY_ADAPTER: 'LEGACY_ADAPTER', NATIVE_RESPONSIVE: 'NATIVE_RESPONSIVE' });
const loadScreenModule = (path) => {
  switch (path) {
    case '../pages/business-overview.jsx': return import('../pages/business-overview.jsx');
    case '../pages/master-data.jsx': return import('../pages/master-data.jsx');
    case '../components/MobileApprovalCenter.jsx': return import('../components/MobileApprovalCenter.jsx');
    case '../pages/treasury-cost.jsx': return import('../pages/treasury-cost.jsx');
    case '../pages/quality.jsx': return import('../pages/quality.jsx');
    case '../components/MobileCrmApplication.jsx': return import('../components/MobileCrmApplication.jsx');
    case '../pages/crm.jsx': return import('../pages/crm.jsx');
    case '../pages/projects-workflow.jsx': return import('../pages/projects-workflow.jsx');
    case '../pages/accounting.jsx': return import('../pages/accounting.jsx');
    case '../pages/commercial-go-live.jsx': return import('../pages/commercial-go-live.jsx');
    case '../pages/settlement.jsx': return import('../pages/settlement.jsx');
    case '../pages/decision-reports.jsx': return import('../pages/decision-reports.jsx');
    case '../pages/logistics-finance.jsx': return import('../pages/logistics-finance.jsx');
    case '../pages/traceability.jsx': return import('../pages/traceability.jsx');
    case '../pages/inventory-extensions.jsx': return import('../pages/inventory-extensions.jsx');
    case '../pages/discounts.jsx': return import('../pages/discounts.jsx');
    case '../pages/manufacturing.jsx': return import('../pages/manufacturing.jsx');
    case '../pages/product-routing.jsx': return import('../pages/product-routing.jsx');
    case '../pages/forecasts.jsx': return import('../pages/forecasts.jsx');
    case '../pages/mrp-runs.jsx': return import('../pages/mrp-runs.jsx');
    case '../pages/material-requirements-plan.jsx': return import('../pages/material-requirements-plan.jsx');
    case '../pages/planning-documents.jsx': return import('../pages/planning-documents.jsx');
    case '../pages/data-cleanup.jsx': return import('../pages/data-cleanup.jsx');
    default: return Promise.reject(new Error(`Unknown route screen module: ${path}`));
  }
};
const named = (modulePath, exportName) => Object.freeze({
  modulePath, exportName,
  loader: () => loadScreenModule(modulePath).then((module) => ({ default: module[exportName] })),
});
const defaultScreen = (modulePath) => Object.freeze({
  modulePath, exportName: 'default',
  loader: () => loadScreenModule(modulePath).then((module) => ({ default: module.default })),
});
const SCREEN_DEFINITIONS = Object.freeze({
  'business-overview': defaultScreen('../pages/business-overview.jsx'), dashboard: named('../pages/master-data.jsx','Dashboard'),
  orders: named('../pages/master-data.jsx','Orders'), approvals: defaultScreen('../components/MobileApprovalCenter.jsx'),
  customers: named('../pages/master-data.jsx','Customers'), suppliers: named('../pages/master-data.jsx','Suppliers'),
  'purchase-orders': named('../pages/master-data.jsx','PurchaseOrders'), products: named('../pages/master-data.jsx','Products'),
  warehouses: named('../pages/master-data.jsx','Warehouses'), inventory: named('../pages/master-data.jsx','Inventory'),
  users: named('../pages/master-data.jsx','UsersRoles'), 'cash-journals': named('../pages/treasury-cost.jsx','CashJournals'),
  'bank-accounts': named('../pages/treasury-cost.jsx','BankAccounts'), bills: named('../pages/treasury-cost.jsx','Bills'),
  'fixed-assets': named('../pages/treasury-cost.jsx','FixedAssets'), 'product-costs': named('../pages/treasury-cost.jsx','ProductCosts'),
  'cost-rates': named('../pages/treasury-cost.jsx','CostRates'), iqc: named('../pages/quality.jsx','IQCInspections'),
  oqc: named('../pages/quality.jsx','OQCInspections'), 'quality-control-points': named('../pages/quality.jsx','QualityControlPoints'),
  contacts: defaultScreen('../components/MobileCrmApplication.jsx'), followups: named('../pages/crm.jsx','Followups'),
  activities: named('../pages/crm.jsx','SalesActivities'), projects: named('../pages/projects-workflow.jsx','Projects'),
  tasks: named('../pages/projects-workflow.jsx','ProjectTasks'), timesheets: named('../pages/projects-workflow.jsx','Timesheets'),
  notifications: named('../pages/projects-workflow.jsx','Notifications'), workflows: named('../pages/projects-workflow.jsx','Workflows'),
  accounting: named('../pages/accounting.jsx','Accounting'), 'sales-invoices': named('../pages/commercial-go-live.jsx','SalesInvoices'),
  'supplier-bills': named('../pages/commercial-go-live.jsx','SupplierBills'), 'accounts-receivable': named('../pages/settlement.jsx','Receivables'),
  'payment-collections': named('../pages/settlement.jsx','Collections'), 'accounts-payable': named('../pages/settlement.jsx','Payables'),
  'payment-disbursements': named('../pages/settlement.jsx','Payments'), 'decision-reports': defaultScreen('../pages/decision-reports.jsx'),
  'purchase-receipts': named('../pages/logistics-finance.jsx','PurchaseReceipts'), 'sales-deliveries': named('../pages/logistics-finance.jsx','SalesDeliveries'),
  returns: named('../pages/logistics-finance.jsx','Returns'), 'inventory-transactions': named('../pages/logistics-finance.jsx','InventoryTransactions'),
  traceability: defaultScreen('../pages/traceability.jsx'), 'inventory-scraps': named('../pages/inventory-extensions.jsx','InventoryScraps'),
  'inventory-month-end': named('../pages/inventory-extensions.jsx','InventoryMonthEnd'), 'sales-discounts': named('../pages/discounts.jsx','SalesDiscounts'),
  'purchase-discounts': named('../pages/discounts.jsx','PurchaseDiscounts'), boms: named('../pages/manufacturing.jsx','Boms'),
  'production-orders': named('../pages/manufacturing.jsx','ProductionOrders'), 'material-issues': named('../pages/manufacturing.jsx','MaterialIssues'),
  'production-receipts': named('../pages/manufacturing.jsx','ProductionReceipts'), 'manufacturing-analytics': named('../pages/manufacturing.jsx','ManufacturingAnalytics'),
  'product-routings': defaultScreen('../pages/product-routing.jsx'), forecasts: defaultScreen('../pages/forecasts.jsx'),
  'mrp-runs': defaultScreen('../pages/mrp-runs.jsx'), 'material-requirements-plan': defaultScreen('../pages/material-requirements-plan.jsx'),
  'production-instructions': defaultScreen('../pages/planning-documents.jsx'), 'purchase-instructions': defaultScreen('../pages/planning-documents.jsx'),
  'purchase-requisitions': defaultScreen('../pages/planning-documents.jsx'), 'data-cleanup': defaultScreen('../pages/data-cleanup.jsx'),
});

const DETAIL_TARGET_ROUTES = new Set([
  'orders','purchase-orders','purchase-receipts','sales-deliveries','returns','sales-invoices','supplier-bills','accounting',
  'accounts-receivable','accounts-payable','payment-collections','payment-disbursements','forecasts','mrp-runs',
  'material-requirements-plan','production-orders','material-issues','production-receipts','product-routings','iqc','oqc',
  'production-instructions','purchase-instructions','purchase-requisitions',
]);
const ROUTE_QUERY_KEYS = Object.freeze({
  orders: ['documentType'], 'purchase-orders': ['documentType'], 'purchase-receipts': ['documentType'],
  'sales-deliveries': ['documentType'], returns: ['documentType'], 'sales-invoices': ['documentType'],
  'supplier-bills': ['documentType'], accounting: ['documentType'],
  'material-requirements-plan': ['originPage'], 'material-issues': ['documentType'],
  'production-receipts': ['documentType'], 'product-routings': ['documentType','productId'],
  iqc: ['documentType','sourcePage','sourceDocumentId'], oqc: ['documentType','sourcePage','sourceDocumentId'],
  'decision-reports': ['reportKey'],
});
const INTERNAL_ROUTES = new Set(['material-requirements-plan','manufacturing-analytics']);
const CONTEXTUAL_ROUTES = new Set([
  'dashboard','sales-discounts','purchase-discounts','sales-invoices','payment-collections','supplier-bills',
  'payment-disbursements','bank-accounts','product-costs','cost-rates','iqc','oqc','quality-control-points',
  'tasks','timesheets','notifications',
]);
const classificationFor = (routeKey) => INTERNAL_ROUTES.has(routeKey) ? 'INTERNAL' : (CONTEXTUAL_ROUTES.has(routeKey) ? 'CONTEXTUAL' : 'CORE');
const targetContractFor = (routeKey) => Object.freeze({
  pathParam: DETAIL_TARGET_ROUTES.has(routeKey) ? 'documentId' : null,
  queryKeys: Object.freeze(ROUTE_QUERY_KEYS[routeKey] || []),
});
const toApplicationRoute = (item) => Object.freeze({
  key: item.route, title: item.title, domain: item.domain, archetype: item.template,
  semanticLevel: item.semanticLevel, level: item.level,
  access: Object.freeze(item.permission ? { permission: item.permission } : { any: Object.freeze(item.any) }),
  enabled: item.enabled !== false, parentRoute: item.parentRoute || null,
  desktopNavigation: Object.freeze({ group: item.navGroup, exposure: item.desktopExposure || 'navigation', iconKey: item.iconKey }),
  mobileExposure: item.mobileExposure || 'launcher', launcherEntries: Object.freeze([]), applicationGroup: 'contextual',
  targetContract: targetContractFor(item.route),
  screen: Object.freeze({ identity: item.route, ...SCREEN_DEFINITIONS[item.route] }),
  classification: classificationFor(item.route),
  aliases: Object.freeze(Object.entries(TECHNICAL_ROUTE_ALIASES).filter(([, canonical]) => canonical === item.route).map(([alias]) => alias)),
  responsiveMode: RESPONSIVE_MODES.LEGACY_ADAPTER,
  presentation: item,
});

const BASE_APPLICATION_ROUTES = [...ACTIVE_ROUTE_DEFINITIONS, ...DISABLED_ROUTE_DEFINITIONS].map(toApplicationRoute);

const launcherGroup = (key, label, kind, module, items) => Object.freeze({
  key, label, kind, module,
  items: Object.freeze(items.map(([routeKey, itemLabel, iconKey, extra = {}], order) => Object.freeze({
    key: extra.key || (extra.reportKey ? `${routeKey}:${extra.reportKey}` : routeKey), routeKey, group: key,
    label: itemLabel, iconKey, order, target: extra.target || null, reportKey: extra.reportKey || null,
    formalLabel: extra.formalLabel || itemLabel,
  }))),
});

export const APPLICATION_LAUNCHER_GROUPS = Object.freeze([
  launcherGroup('master-data','基础资料','domain','master', [['products','货品资料','products'],['boms','BOM','boms'],['customers','客户资料','customers'],['suppliers','供应商资料','suppliers'],['warehouses','仓库资料','warehouses'],['product-routings','制品工序标准','routings']]),
  launcherGroup('sales','销售管理','domain','sales', [['orders','销售订单','orders'],['sales-deliveries','销售出货','salesDeliveries'],['returns','销售退货','returns',{key:'returns:sales',target:{documentType:'SALES_RETURN'}}],['accounts-receivable','应收结算','accountsReceivable'],['sales-discounts','销售折让','salesDiscount']]),
  launcherGroup('production','生产管理','domain','production', [['forecasts','计划预测','forecasts'],['mrp-runs','MRP','mrpRuns'],['production-instructions','生产指令','planningDocuments'],['production-orders','制令单','productionOrders'],['material-issues','用料出库','salesDeliveries'],['production-receipts','生产入库','purchaseReceipts']]),
  launcherGroup('purchasing','采购管理','domain','purchasing', [['purchase-instructions','采购指令','planningDocuments'],['purchase-requisitions','请购单','planningDocuments'],['purchase-orders','采购订单','purchaseOrders'],['purchase-receipts','采购入库','purchaseReceipts'],['returns','采购退货','returns',{key:'returns:purchase',target:{documentType:'PURCHASE_RETURN'}}],['accounts-payable','应付结算','accountsPayable'],['purchase-discounts','采购折让','purchaseDiscount']]),
  launcherGroup('inventory','库存管理','domain','inventory', [['inventory','库存作业','inventory'],['inventory-scraps','存货报废','inventoryScrap'],['inventory-month-end','存货月结','inventoryPeriod'],['inventory-transactions','库存异动','inventoryTransactions'],['traceability','批次 / 序列号','traceability']]),
  launcherGroup('analytics','决策报表','domain','analytics', [
    ['decision-reports','销售统计','reports',{reportKey:'sales-summary',formalLabel:'销售统计分析表'}],
    ['decision-reports','销售未出货','reports',{reportKey:'sales-outstanding',formalLabel:'销售未出货反应表'}],
    ['decision-reports','采购统计','reports',{reportKey:'purchase-summary',formalLabel:'采购统计分析表'}],
    ['decision-reports','采购未交货','reports',{reportKey:'purchase-outstanding',formalLabel:'采购未交货反应表'}],
    ['decision-reports','库存异动','reports',{reportKey:'inventory-movements',formalLabel:'存货异动明细表'}],
  ]),
  launcherGroup('utility-flows','业务流程','utility',null, [['business-overview','业务总览','overview']]),
  launcherGroup('utility-finance','财务工具','utility',null, [['sales-invoices','销售发票','accounting'],['payment-collections','收款 / 核销','paymentCollections'],['supplier-bills','供应商账单','accounting'],['payment-disbursements','付款 / 核销','paymentDisbursements'],['accounting','会计凭证','accounting'],['bank-accounts','银行账户','bankAccounts']]),
  launcherGroup('utility-extension','更多业务','utility',null, [['projects','项目立项','projects'],['tasks','任务管理','tasks'],['timesheets','工时记录','timesheets'],['contacts','联系人管理','contacts'],['followups','客户跟进','followups'],['activities','销售活动','activities']]),
  launcherGroup('utility-advanced','高级设置','utility',null, [['quality-control-points','质量规则','iqc'],['product-costs','标准成本','costAccounting'],['cost-rates','成本费率','costAccounting']]),
  launcherGroup('utility-system','系统设置','utility',null, [['users','用户与权限','users']]),
]);

const launcherEntriesByRoute = new Map();
for (const group of APPLICATION_LAUNCHER_GROUPS) for (const item of group.items) {
  const entries = launcherEntriesByRoute.get(item.routeKey) || [];
  entries.push(item); launcherEntriesByRoute.set(item.routeKey, entries);
}
export const APPLICATION_ROUTES = Object.freeze(BASE_APPLICATION_ROUTES.map((item) => Object.freeze({
  ...item,
  launcherEntries: Object.freeze(launcherEntriesByRoute.get(item.key) || []),
  applicationGroup: launcherEntriesByRoute.get(item.key)?.[0]?.group || 'contextual',
})));
export const ACTIVE_APPLICATION_ROUTES = Object.freeze(APPLICATION_ROUTES.filter((item) => item.enabled));
export const DISABLED_APPLICATION_ROUTES = Object.freeze(APPLICATION_ROUTES.filter((item) => !item.enabled));
const ROUTE_BY_KEY = new Map(APPLICATION_ROUTES.map((item) => [item.key, item]));
export const applicationRouteFor = (routeKey) => ROUTE_BY_KEY.get(routeKey) || null;
export const resolveApplicationRouteAlias = (routeKey) => TECHNICAL_ROUTE_ALIASES[routeKey] || routeKey;
export function userCanAccessRoute(user, routeItem) {
  if (!user || !routeItem?.enabled) return false;
  const permissions = new Set(user.permissions || []);
  return routeItem.access.permission ? permissions.has(routeItem.access.permission) : routeItem.access.any.some((permission) => permissions.has(permission));
}
const REPORT_DOMAIN_PERMISSIONS = Object.freeze({
  'sales-summary': ['ORDERS_VIEW','ORDERS_CREATE','ORDERS_SUBMIT','ORDERS_APPROVE','SALES_DELIVERIES_VIEW','SALES_DELIVERIES_MANAGE'],
  'sales-outstanding': ['ORDERS_VIEW','ORDERS_CREATE','ORDERS_SUBMIT','ORDERS_APPROVE','SALES_DELIVERIES_VIEW','SALES_DELIVERIES_MANAGE'],
  'purchase-summary': ['PURCHASE_ORDERS_VIEW','PURCHASE_ORDERS_CREATE','PURCHASE_ORDERS_SUBMIT','PURCHASE_ORDERS_APPROVE','PURCHASE_RECEIPTS_VIEW','PURCHASE_RECEIPTS_MANAGE'],
  'purchase-outstanding': ['PURCHASE_ORDERS_VIEW','PURCHASE_ORDERS_CREATE','PURCHASE_ORDERS_SUBMIT','PURCHASE_ORDERS_APPROVE','PURCHASE_RECEIPTS_VIEW','PURCHASE_RECEIPTS_MANAGE'],
  'inventory-movements': ['INVENTORY_VIEW','INVENTORY_CHECK_CREATE','INVENTORY_TRANSFER_CREATE','INVENTORY_TRANSFER_APPROVE','INVENTORY_TRANSFER_CONFIRM','INVENTORY_ADJUSTMENT_MANAGE','INVENTORY_SCRAP_VIEW','INVENTORY_SCRAP_MANAGE','PURCHASE_RECEIPTS_MANAGE','SALES_DELIVERIES_MANAGE','RETURNS_MANAGE'],
});
export function userCanAccessLauncherEntry(user, entry) {
  if (!entry?.reportKey) return true;
  const permissions = new Set(user?.permissions || []);
  return permissions.has('REPORT_VIEW') && (REPORT_DOMAIN_PERMISSIONS[entry.reportKey] || []).some((permission) => permissions.has(permission));
}

if (ROUTE_BY_KEY.size !== APPLICATION_ROUTES.length) throw new Error('Application Registry contains duplicate route keys');
for (const [alias, canonical] of Object.entries(TECHNICAL_ROUTE_ALIASES)) {
  if (ROUTE_BY_KEY.has(alias) || !ROUTE_BY_KEY.has(canonical)) throw new Error(`Application Registry contains conflicting alias ${alias}`);
}
const launcherKeys = new Set();
const launcherGroupKeys = new Set(APPLICATION_LAUNCHER_GROUPS.map((group) => group.key));
for (const item of APPLICATION_ROUTES) {
  if (item.enabled && typeof item.screen.loader !== 'function') throw new Error(`Active route ${item.key} has no screen loader`);
  if (item.parentRoute && !ROUTE_BY_KEY.has(item.parentRoute)) throw new Error(`Route ${item.key} has invalid parentRoute`);
}
for (const group of APPLICATION_LAUNCHER_GROUPS) for (const item of group.items) {
  if (!ROUTE_BY_KEY.get(item.routeKey)?.enabled) throw new Error(`Launcher entry ${item.key} targets an unavailable route`);
  if (!item.group || item.group !== group.key || !launcherGroupKeys.has(item.group)) throw new Error(`Launcher entry ${item.key} has invalid group`);
  if (launcherKeys.has(item.key)) throw new Error(`Application Registry contains duplicate launcher key ${item.key}`);
  launcherKeys.add(item.key);
}

export const MOBILE_COMMON_PRIORITY = Object.freeze(['orders','purchase-orders','purchase-receipts','sales-deliveries','inventory','mrp-runs']);
