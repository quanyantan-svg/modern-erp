// Canonical frontend application registry.
// Route, access, presentation, launcher and screen definitions live here only.
import { BUSINESS_DOMAINS, DESKTOP_GROUP_ORDER } from './domainMetadata.js';

export const PRIMARY_DOMAINS = BUSINESS_DOMAINS;

export const APPROVAL_FAMILIES = Object.freeze([
  'SALES_ORDER', 'PURCHASE_ORDER', 'PURCHASE_REQUISITION', 'INVENTORY_CHECK', 'ACCOUNTING_VOUCHER', 'PRODUCTION_ORDER',
]);

const route = (route, title, domain, semanticLevel, template, level, navGroup, iconKey, access, extra = {}) => Object.freeze({
  route, title, domain, semanticLevel, template, level, navGroup, iconKey, ...access, ...extra,
});

const ACTIVE_ROUTE_DEFINITIONS = Object.freeze([
  route('business-overview','业务总览','accounting-analytics','FLOW_SUPPORTING','WORKFLOW','primary','会计与分析','overview',{permission:'DASHBOARD_VIEW'},{mobileExposure:'launcher',desktopExposure:'global'}),
  route('dashboard','工作台','accounting-analytics','FLOW_SUPPORTING','WORKFLOW','secondary','会计与分析','dashboard',{permission:'DASHBOARD_VIEW'},{mobileExposure:'role-workspace',desktopExposure:'role-workspace'}),
  route('orders','销售订单','sales-customer','FLOW_PRIMARY','LIST','primary','销售与客户','orders',{any:['ORDERS_VIEW','ORDERS_CREATE']}),
  route('approvals','业务审批','platform','FLOW_SUPPORTING','WORKFLOW','primary','系统设置','approvals',{permission:'ORDERS_APPROVE'},{mobileExposure:'approval-tab',desktopExposure:'global',approvalFamilies:APPROVAL_FAMILIES}),
  route('purchase-orders','采购订单','procurement-outsourcing','FLOW_PRIMARY','LIST','primary','采购与委外','purchaseOrders',{any:['PURCHASE_ORDERS_VIEW','PURCHASE_ORDERS_CREATE']}),
  route('suppliers','供应商资料','procurement-outsourcing','FLOW_PRIMARY','LIST','primary','采购与委外','suppliers',{any:['SUPPLIERS_VIEW','SUPPLIERS_MANAGE']}),
  route('customers','客户资料','sales-customer','FLOW_PRIMARY','LIST','primary','销售与客户','customers',{any:['CUSTOMERS_VIEW','CUSTOMERS_MANAGE']}),
  route('products','货品资料','master-engineering','FLOW_PRIMARY','LIST','primary','主数据与工程','products',{any:['PRODUCTS_VIEW','PRODUCTS_MANAGE']}),
  route('warehouses','仓库资料','inventory-warehouse','FLOW_PRIMARY','LIST','primary','库存与仓储','warehouses',{any:['WAREHOUSES_VIEW','WAREHOUSES_MANAGE']}),
  route('inventory','库存作业','inventory-warehouse','FLOW_PRIMARY','WORKFLOW','primary','库存与仓储','inventory',{any:['INVENTORY_VIEW']}),
  route('purchase-receipts','采购入库','procurement-outsourcing','FLOW_PRIMARY','LIST','primary','采购与委外','purchaseReceipts',{any:['PURCHASE_RECEIPTS_VIEW','PURCHASE_RECEIPTS_MANAGE']},{contextHint:'仓库验收'}),
  route('sales-deliveries','销售出货','sales-customer','FLOW_PRIMARY','LIST','primary','销售与客户','salesDeliveries',{any:['SALES_DELIVERIES_VIEW','SALES_DELIVERIES_MANAGE']}),
  route('returns','退货管理','sales-customer','FLOW_SUPPORTING','LIST','secondary','销售与客户','returns',{any:['RETURNS_VIEW','RETURNS_MANAGE']}),
  route('inventory-transactions','库存异动明细','inventory-warehouse','REPORT','REPORT','contextual','库存与仓储','inventoryTransactions',{any:['INVENTORY_VIEW']}),
  route('traceability','批次 / 序列号追溯','inventory-warehouse','FLOW_SUPPORTING','REPORT','secondary','库存与仓储','traceability',{any:['INVENTORY_VIEW','PURCHASE_RECEIPTS_VIEW','SALES_DELIVERIES_VIEW']}),
  route('inventory-scraps','存货报废','inventory-warehouse','FLOW_PRIMARY','LIST','primary','库存与仓储','inventoryScrap',{any:['INVENTORY_SCRAP_VIEW','INVENTORY_SCRAP_MANAGE']}),
  route('inventory-month-end','存货月结','inventory-warehouse','FLOW_PRIMARY','WORKFLOW','primary','库存与仓储','inventoryPeriod',{any:['INVENTORY_PERIOD_CLOSE_VIEW','INVENTORY_PERIOD_CLOSE_MANAGE']}),
  route('sales-discounts','销售折让','sales-customer','FLOW_INTERNAL_STEP','LIST','contextual','销售与客户','salesDiscount',{any:['SALES_DISCOUNT_MANAGE']},{parentRoute:'accounts-receivable'}),
  route('purchase-discounts','采购折让','procurement-outsourcing','FLOW_INTERNAL_STEP','LIST','contextual','采购与委外','purchaseDiscount',{any:['PURCHASE_DISCOUNT_MANAGE']},{parentRoute:'accounts-payable'}),
  route('sales-invoices','销售发票','finance-operations','FLOW_INTERNAL_STEP','LIST','secondary','财务运营','accounting',{any:['AR_VIEW','ACCOUNTING_VIEW']},{parentRoute:'accounts-receivable'}),
  route('accounts-receivable','应收结算','finance-operations','FLOW_PRIMARY','WORKFLOW','primary','财务运营','accounting',{any:['AR_VIEW','COLLECTION_MANAGE']}),
  route('payment-collections','收款 / 核销','finance-operations','FLOW_INTERNAL_STEP','LIST','contextual','财务运营','cashJournals',{any:['AR_VIEW','COLLECTION_MANAGE']},{parentRoute:'accounts-receivable'}),
  route('accounts-payable','应付结算','finance-operations','FLOW_PRIMARY','WORKFLOW','secondary','财务运营','accounting',{any:['AP_VIEW','PAYMENT_MANAGE']}),
  route('supplier-bills','供应商账单','finance-operations','FLOW_INTERNAL_STEP','LIST','secondary','财务运营','accounting',{any:['AP_VIEW','ACCOUNTING_VIEW']},{parentRoute:'accounts-payable'}),
  route('payment-disbursements','付款 / 核销','finance-operations','FLOW_INTERNAL_STEP','LIST','contextual','财务运营','bankAccounts',{any:['AP_VIEW','PAYMENT_MANAGE']},{parentRoute:'accounts-payable'}),
  route('accounting','会计凭证','accounting-analytics','FLOW_SUPPORTING','LIST','secondary','会计与分析','accounting',{any:['ACCOUNTING_VIEW']},{desktopExposure:'role-workspace',mobileExposure:'role-workspace'}),
  route('bank-accounts','银行账户','finance-operations','ADVANCED_CONFIGURATION','CONFIG','contextual','财务运营','bankAccounts',{any:['BANK_ACCOUNTS_VIEW','BANK_ACCOUNTS_MANAGE']},{desktopExposure:'role-workspace',mobileExposure:'role-workspace'}),
  route('decision-reports','经营分析','accounting-analytics','REPORT','REPORT','primary','会计与分析','reports',{any:['REPORT_VIEW']}),
  route('boms','BOM','master-engineering','ADVANCED_CONFIGURATION','CONFIG','secondary','主数据与工程','boms',{any:['ENGINEERING_BOM_VIEW','ENGINEERING_BOM_MANAGE','PRODUCTION_ORDERS_CREATE']}),
  route('product-routings','制品工序标准','master-engineering','ADVANCED_CONFIGURATION','CONFIG','secondary','主数据与工程','routings',{any:['ROUTING_VIEW','ROUTING_MANAGE']}),
  route('engineering-reference','工程基础资料','master-engineering','ADVANCED_CONFIGURATION','CONFIG','contextual','主数据与工程','engineeringReference',{any:['ENGINEERING_REFERENCE_VIEW','ENGINEERING_REFERENCE_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('engineering-substitute','替代料与可配置 BOM','master-engineering','ADVANCED_CONFIGURATION','CONFIG','contextual','主数据与工程','substitute',{any:['ENGINEERING_SUBSTITUTE_VIEW','ENGINEERING_SUBSTITUTE_MANAGE','ENGINEERING_CONFIGURABLE_VIEW','ENGINEERING_CONFIGURABLE_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('engineering-change','工程变更','master-engineering','ADVANCED_CONFIGURATION','CONFIG','contextual','主数据与工程','engineeringChange',{any:['ENGINEERING_CHANGE_VIEW','ENGINEERING_CHANGE_MANAGE','ENGINEERING_CHANGE_APPROVE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('production-orders','制令单','manufacturing-quality','FLOW_PRIMARY','LIST','primary','制造与质量','productionOrders',{any:['PRODUCTION_ORDERS_VIEW','PRODUCTION_ORDERS_CREATE']}),
  route('material-issues','用料出库','manufacturing-quality','FLOW_PRIMARY','LIST','primary','制造与质量','salesDeliveries',{any:['PRODUCTION_MATERIAL_ISSUE_MANAGE']}),
  route('production-receipts','生产入库','manufacturing-quality','FLOW_PRIMARY','LIST','primary','制造与质量','purchaseReceipts',{any:['PRODUCTION_RECEIPT_MANAGE']}),
  route('manufacturing-analytics','生产执行分析','manufacturing-quality','REPORT','REPORT','secondary','制造与质量','reports',{any:['PRODUCTION_ORDERS_VIEW','PRODUCTION_COSTS_VIEW']},{mobileExposure:'contextual'}),
  route('production-quality','生产质量','manufacturing-quality','FLOW_PRIMARY','WORKFLOW','primary','制造与质量','iqc',{any:['PRODUCTION_INSPECTION_VIEW','PRODUCTION_INSPECTION_MANAGE']}),
  route('production-scan','生产扫码','manufacturing-quality','FLOW_PRIMARY','WORKFLOW','primary','制造与质量','traceability',{permission:'PRODUCTION_SCAN_EXECUTE'}),
  route('quality-configuration','质量配置','manufacturing-quality','ADVANCED_CONFIGURATION','CONFIG','contextual','制造与质量','iqc',{any:['PRODUCTION_QUALITY_CONFIG_VIEW','PRODUCTION_QUALITY_CONFIG_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('forecasts','计划预测','planning','FLOW_PRIMARY','LIST','primary','计划','forecasts',{any:['MRP_VIEW','MRP_MANAGE']}),
  route('mrp-runs','MRP','planning','FLOW_PRIMARY','WORKFLOW','primary','计划','mrpRuns',{any:['MRP_VIEW','MRP_MANAGE']},{presentationConcept:'MRP'}),
  route('planned-orders','计划订单','planning','FLOW_PRIMARY','LIST','primary','计划','mrpRuns',{any:['MRP_VIEW','MRP_MANAGE']}),
  route('planning-reservations','计划预留','planning','FLOW_INTERNAL_STEP','WORKFLOW','contextual','计划','reservation',{any:['MRP_VIEW','MRP_MANAGE']},{parentRoute:'planned-orders'}),
  route('planning-configuration','计划配置','planning','ADVANCED_CONFIGURATION','CONFIG','contextual','计划','configuration',{any:['MRP_VIEW','MRP_MANAGE']},{parentRoute:'planned-orders'}),
  route('planner-workbench','计划员工作台','planning','FLOW_PRIMARY','WORKFLOW','primary','计划','dashboard',{any:['MRP_VIEW','MRP_MANAGE']}),
  route('material-requirements-plan','物料需求计划','planning','FLOW_INTERNAL_STEP','REPORT','contextual','计划','materialPlan',{any:['MRP_VIEW','MRP_MANAGE']},{parentRoute:'mrp-runs',presentationConcept:'MRP'}),
  route('production-instructions','生产指令','planning','FLOW_PRIMARY','LIST','primary','计划','planningDocuments',{any:['PRODUCTION_INSTRUCTION_VIEW']}),
  route('purchase-instructions','采购指令','planning','FLOW_PRIMARY','LIST','primary','计划','planningDocuments',{any:['PURCHASE_INSTRUCTION_VIEW']}),
  route('purchase-requisitions','请购单','procurement-outsourcing','FLOW_PRIMARY','LIST','primary','采购与委外','planningDocuments',{any:['PURCHASE_REQUISITION_VIEW']}),
  route('product-costs','标准成本','finance-operations','ADVANCED_CONFIGURATION','CONFIG','contextual','财务运营','costAccounting',{any:['COST_VIEW','COST_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('cost-rates','成本费率','finance-operations','ADVANCED_CONFIGURATION','CONFIG','contextual','财务运营','costAccounting',{any:['COST_VIEW','COST_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('iqc','IQC 来料检验','manufacturing-quality','FLOW_INTERNAL_STEP','WORKFLOW','contextual','制造与质量','iqc',{any:['IQC_VIEW','IQC_MANAGE']},{parentRoute:'purchase-receipts'}),
  route('oqc','OQC 出货检验','manufacturing-quality','FLOW_INTERNAL_STEP','WORKFLOW','contextual','制造与质量','oqc',{any:['OQC_VIEW','OQC_MANAGE']},{parentRoute:'sales-deliveries'}),
  route('quality-control-points','质量规则','manufacturing-quality','ADVANCED_CONFIGURATION','CONFIG','contextual','制造与质量','iqc',{any:['USERS_MANAGE']},{desktopExposure:'advanced-config',mobileExposure:'advanced-config'}),
  route('notifications','通知中心','platform','SYSTEM_SUPPORT','LIST','contextual','系统设置','notifications',{any:['DASHBOARD_VIEW']},{desktopExposure:'global',mobileExposure:'messages-tab'}),
  route('users','用户与权限','platform','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','users',{any:['USERS_MANAGE','ROLES_MANAGE']},{desktopExposure:'system-settings',mobileExposure:'system-settings'}),
]);

const DISABLED_ROUTE_DEFINITIONS = Object.freeze([
  route('cash-journals','现金日记账','finance-operations','SYSTEM_SUPPORT','LIST','contextual','财务运营','cashJournals',{any:['CASH_JOURNALS_VIEW','CASH_JOURNALS_MANAGE']},{enabled:false}),
  route('bills','票据管理','finance-operations','SYSTEM_SUPPORT','LIST','contextual','财务运营','bills',{any:['BILLS_VIEW','BILLS_MANAGE']},{enabled:false}),
  route('fixed-assets','固定资产','finance-operations','SYSTEM_SUPPORT','LIST','contextual','财务运营','fixedAssets',{any:['FIXED_ASSETS_VIEW','FIXED_ASSETS_MANAGE']},{enabled:false}),
  route('workflows','审批流','platform','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','approvals',{any:['WORKFLOW_VIEW','WORKFLOW_MANAGE']},{enabled:false}),
  route('data-cleanup','数据整理','platform','SYSTEM_SUPPORT','CONFIG','contextual','系统设置','cleanup',{permission:'USERS_MANAGE'},{enabled:false}),
]);

export const TECHNICAL_ROUTE_ALIASES = Object.freeze({ mrp: 'material-requirements-plan' });

export { DESKTOP_GROUP_ORDER };

export const RESPONSIVE_MODES = Object.freeze({ LEGACY_ADAPTER: 'LEGACY_ADAPTER', NATIVE_RESPONSIVE: 'NATIVE_RESPONSIVE' });
const loadScreenModule = (path) => {
  switch (path) {
    case '../pages/business-overview.jsx': return import('../pages/business-overview.jsx');
    case '../pages/master-data.jsx': return import('../pages/master-data.jsx');
    case '../components/MobileApprovalCenter.jsx': return import('../components/MobileApprovalCenter.jsx');
    case '../pages/treasury-cost.jsx': return import('../pages/treasury-cost.jsx');
    case '../pages/quality.jsx': return import('../pages/quality.jsx');
    case '../pages/platform-notifications.jsx': return import('../pages/platform-notifications.jsx');
    case '../pages/platform-workflows.jsx': return import('../pages/platform-workflows.jsx');
    case '../pages/accounting.jsx': return import('../pages/accounting.jsx');
    case '../pages/commercial-go-live.jsx': return import('../pages/commercial-go-live.jsx');
    case '../pages/settlement.jsx': return import('../pages/settlement.jsx');
    case '../pages/decision-reports.jsx': return import('../pages/decision-reports.jsx');
    case '../pages/logistics-finance.jsx': return import('../pages/logistics-finance.jsx');
    case '../pages/traceability.jsx': return import('../pages/traceability.jsx');
    case '../pages/inventory-extensions.jsx': return import('../pages/inventory-extensions.jsx');
    case '../pages/discounts.jsx': return import('../pages/discounts.jsx');
    case '../pages/manufacturing.jsx': return import('../pages/manufacturing.jsx');
    case '../pages/manufacturing-quality.jsx': return import('../pages/manufacturing-quality.jsx');
    case '../pages/product-routing.jsx': return import('../pages/product-routing.jsx');
    case '../pages/forecasts.jsx': return import('../pages/forecasts.jsx');
    case '../pages/mrp-runs.jsx': return import('../pages/mrp-runs.jsx');
    case '../pages/material-requirements-plan.jsx': return import('../pages/material-requirements-plan.jsx');
    case '../pages/planning-documents.jsx': return import('../pages/planning-documents.jsx');
    case '../pages/planning-workbench.jsx': return import('../pages/planning-workbench.jsx');
    case '../pages/planning-reservations.jsx': return import('../pages/planning-reservations.jsx');
    case '../pages/planning-configuration.jsx': return import('../pages/planning-configuration.jsx');
    case '../pages/data-cleanup.jsx': return import('../pages/data-cleanup.jsx');
    case '../pages/engineering-reference.jsx': return import('../pages/engineering-reference.jsx');
    case '../pages/engineering-substitute.jsx': return import('../pages/engineering-substitute.jsx');
    case '../pages/engineering-change.jsx': return import('../pages/engineering-change.jsx');
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
  notifications: named('../pages/platform-notifications.jsx','Notifications'), workflows: named('../pages/platform-workflows.jsx','Workflows'),
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
  'production-quality': named('../pages/manufacturing-quality.jsx','ProductionQuality'), 'production-scan': named('../pages/manufacturing-quality.jsx','ProductionScan'),
  'quality-configuration': named('../pages/manufacturing-quality.jsx','QualityConfiguration'),
  'product-routings': defaultScreen('../pages/product-routing.jsx'), forecasts: defaultScreen('../pages/forecasts.jsx'),
  'mrp-runs': defaultScreen('../pages/mrp-runs.jsx'), 'material-requirements-plan': defaultScreen('../pages/material-requirements-plan.jsx'),
  'planned-orders': defaultScreen('../pages/planning-workbench.jsx'), 'planner-workbench': defaultScreen('../pages/planning-workbench.jsx'),
  'planning-reservations': defaultScreen('../pages/planning-reservations.jsx'),
  'planning-configuration': defaultScreen('../pages/planning-configuration.jsx'),
  'production-instructions': defaultScreen('../pages/planning-documents.jsx'), 'purchase-instructions': defaultScreen('../pages/planning-documents.jsx'),
  'purchase-requisitions': defaultScreen('../pages/planning-documents.jsx'), 'data-cleanup': defaultScreen('../pages/data-cleanup.jsx'),
  'engineering-reference': defaultScreen('../pages/engineering-reference.jsx'),
  'engineering-substitute': defaultScreen('../pages/engineering-substitute.jsx'),
  'engineering-change': defaultScreen('../pages/engineering-change.jsx'),
});

const DETAIL_TARGET_ROUTES = new Set([
  'orders','purchase-orders','purchase-receipts','sales-deliveries','returns','sales-invoices','supplier-bills','accounting',
  'accounts-receivable','accounts-payable','payment-collections','payment-disbursements','forecasts','mrp-runs',
  'material-requirements-plan','production-orders','material-issues','production-receipts','product-routings','iqc','oqc',
  'production-instructions','purchase-instructions','purchase-requisitions',
  'planned-orders','planning-reservations','planning-configuration',
  'engineering-reference','engineering-substitute','engineering-change',
]);
const ROUTE_QUERY_KEYS = Object.freeze({
  orders: ['documentType'], 'purchase-orders': ['documentType'], 'purchase-receipts': ['documentType'],
  'sales-deliveries': ['documentType'], returns: ['documentType'], 'sales-invoices': ['documentType'],
  'supplier-bills': ['documentType'], accounting: ['documentType'],
  'material-requirements-plan': ['originPage'], 'material-issues': ['documentType'],
  'production-receipts': ['documentType'], 'product-routings': ['documentType','productId'],
  iqc: ['documentType','sourcePage','sourceDocumentId'], oqc: ['documentType','sourcePage','sourceDocumentId'],
  'decision-reports': ['reportKey'],
  'planned-orders': [], 'planning-reservations': [], 'planning-configuration': [],
});
const INTERNAL_ROUTES = new Set(['material-requirements-plan','manufacturing-analytics']);
const CONTEXTUAL_ROUTES = new Set([
  'dashboard','sales-discounts','purchase-discounts','sales-invoices','payment-collections','supplier-bills',
  'payment-disbursements','bank-accounts','product-costs','cost-rates','iqc','oqc','quality-control-points',
  'notifications','planning-reservations','planning-configuration',
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
  launcherGroup('master-engineering','Master & Engineering','domain','master', [['products','货品资料','products'],['engineering-reference','工程基础资料','engineeringReference'],['boms','BOM','boms'],['product-routings','制品工序标准','routings'],['engineering-substitute','替代料与可配置 BOM','substitute'],['engineering-change','工程变更','engineeringChange']]),
  launcherGroup('sales-customer','Sales & Customer','domain','sales', [['customers','客户资料','customers'],['orders','销售订单','orders'],['sales-deliveries','销售出货','salesDeliveries'],['returns','销售退货','returns',{key:'returns:sales',target:{documentType:'SALES_RETURN'}}],['sales-discounts','销售折让','salesDiscount']]),
  launcherGroup('planning','Planning','domain','planning', [['planner-workbench','计划员工作台','dashboard'],['forecasts','计划预测','forecasts'],['mrp-runs','MRP','mrpRuns'],['planned-orders','计划订单','mrpRuns'],['production-instructions','生产指令','planningDocuments'],['purchase-instructions','采购指令','planningDocuments']]),
  launcherGroup('procurement-outsourcing','Procurement & Outsourcing','domain','purchasing', [['suppliers','供应商资料','suppliers'],['purchase-requisitions','请购单','planningDocuments'],['purchase-orders','采购订单','purchaseOrders'],['purchase-receipts','采购入库','purchaseReceipts'],['returns','采购退货','returns',{key:'returns:purchase',target:{documentType:'PURCHASE_RETURN'}}],['purchase-discounts','采购折让','purchaseDiscount']]),
  launcherGroup('manufacturing-quality','Manufacturing & Quality','domain','production', [['production-orders','制令单','productionOrders'],['material-issues','用料出库','salesDeliveries'],['production-quality','生产质量','iqc'],['production-receipts','生产入库','purchaseReceipts'],['production-scan','生产扫码','traceability'],['quality-configuration','质量配置','iqc']]),
  launcherGroup('inventory-warehouse','Inventory & Warehouse','domain','inventory', [['warehouses','仓库资料','warehouses'],['inventory','库存作业','inventory'],['inventory-scraps','存货报废','inventoryScrap'],['inventory-month-end','存货月结','inventoryPeriod'],['inventory-transactions','库存异动','inventoryTransactions'],['traceability','批次 / 序列号','traceability']]),
  launcherGroup('finance-operations','Finance Operations','domain','finance', [['sales-invoices','销售发票','accounting'],['accounts-receivable','应收结算','accountsReceivable'],['payment-collections','收款 / 核销','paymentCollections'],['supplier-bills','供应商账单','accounting'],['accounts-payable','应付结算','accountsPayable'],['payment-disbursements','付款 / 核销','paymentDisbursements'],['bank-accounts','银行账户','bankAccounts'],['product-costs','标准成本','costAccounting'],['cost-rates','成本费率','costAccounting']]),
  launcherGroup('accounting-analytics','Accounting & Analytics','domain','analytics', [
    ['business-overview','业务总览','overview'],
    ['accounting','会计凭证','accounting'],
    ['decision-reports','销售统计','reports',{reportKey:'sales-summary',formalLabel:'销售统计分析表'}],
    ['decision-reports','销售未出货','reports',{reportKey:'sales-outstanding',formalLabel:'销售未出货反应表'}],
    ['decision-reports','采购统计','reports',{reportKey:'purchase-summary',formalLabel:'采购统计分析表'}],
    ['decision-reports','采购未交货','reports',{reportKey:'purchase-outstanding',formalLabel:'采购未交货反应表'}],
    ['decision-reports','库存异动','reports',{reportKey:'inventory-movements',formalLabel:'存货异动明细表'}],
  ]),
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
