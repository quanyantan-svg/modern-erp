import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { Login, Dashboard, Suppliers, Customers, Products, Orders, Approvals, UsersRoles, PurchaseOrders, Warehouses, Inventory } from './pages/master-data.jsx';
import { Accounting } from './pages/accounting.jsx';
import DecisionReports, { canViewDecisionReport } from './pages/decision-reports.jsx';
import { PurchaseReceipts, SalesDeliveries, Returns, InventoryTransactions } from './pages/logistics-finance.jsx';
import { Collections, Payables, Payments, Receivables } from './pages/settlement.jsx';
import { Boms, ProductionOrders, MaterialIssues, ProductionReceipts } from './pages/manufacturing.jsx';
import { Projects, ProjectTasks, Timesheets, Notifications, Workflows } from './pages/projects-workflow.jsx';
import { CashJournals, BankAccounts, Bills, FixedAssets, ProductCosts, CostRates } from './pages/treasury-cost.jsx';
import { IQCInspections, OQCInspections } from './pages/quality.jsx';
import { Contacts, Followups, SalesActivities } from './pages/crm.jsx';
import BusinessOverview from './pages/business-overview.jsx';
import ProductRoutings from './pages/product-routing.jsx';
import Forecasts from './pages/forecasts.jsx';
import MrpRuns from './pages/mrp-runs.jsx';
import MaterialRequirementsPlan from './pages/material-requirements-plan.jsx';
import PlanningDocumentsHub from './pages/planning-documents.jsx';
import { InventoryScraps, InventoryMonthEnd } from './pages/inventory-extensions.jsx';
import { SalesDiscounts, PurchaseDiscounts } from './pages/discounts.jsx';
import MobileShell, { MOBILE_TABS } from './components/MobileShell.jsx';
import MobilePage from './components/MobilePage.jsx';
import MobileLauncher from './components/MobileLauncher.jsx';
import MobileCrmApplication from './components/MobileCrmApplication.jsx';
import MobileApprovalCenter from './components/MobileApprovalCenter.jsx';
import { useMobile } from './hooks/useMediaQuery.js';
import { buildMobileApplicationGroups } from './navigation/applicationMetadata.js';
import { AppLink, AppNavigationProvider } from './navigation/AppNavigationContext.jsx';
const can = (user, permission) => user?.permissions?.includes(permission);

// Allowed mobile tab keys. `directory` is intentionally absent because
// the directory tab is rendered as a disabled button in MobileShell.
const MOBILE_TAB_KEYS = new Set(MOBILE_TABS.filter((t) => t.enabled).map((t) => t.key));

// Lucide-style inline SVG icon component
const Icon = ({ d, size = 17, strokeWidth = 1.8 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    <path d={d}/>
  </svg>
);

// Icon library
const ic = {
  overview: <Icon d="M3 5h18M5 9h6v10H5zM15 9h4v4h-4zM15 17h4v2h-4z"/>,
  dashboard: <Icon d="M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5zm-10 10a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-6z"/>,
  orders: <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 14l2 2 4-4"/>,
  approvals: <Icon d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>,
  purchaseOrders: <Icon d="M3 3h18v4H3zM3 10h18v4H3zM3 15h12v4H3z"/>,
  suppliers: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0a4 4 0 0 0 4-4v-2M9 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2"/>,
  customers: <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/>,
  products: <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>,
  warehouses: <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10"/>,
  inventory: <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>,
  purchaseReceipts: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6"/>,
  salesDeliveries: <Icon d="M5 18H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2M9 18h6v4H9z"/>,
  returns: <Icon d="M9 14L4 9l5-5M4 9h11a4 4 0 0 1 0 8h-1"/>,
  inventoryTransactions: <Icon d="M12 2v20M2 12h20M7 7l5 5-5 5M17 7l-5 5 5 5"/>,
  reports: <Icon d="M3 3v18h18M7 14l4-4 4 4 6-6"/>,
  accountsReceivable: <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 5v5l3 3"/>,
  accountsPayable: <Icon d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 5v5l3 3"/>,
  paymentCollections: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  paymentDisbursements: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  accounting: <Icon d="M2 17l10-5 10 5M2 12l10-5 10 5M2 7l10-5 10 5M12 22V12M7 7l5-2 5 2"/>,
  cashJournals: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  bankAccounts: <Icon d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11M8 10v11M12 10v11M16 10v11"/>,
  bills: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6"/>,
  fixedAssets: <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>,
  costAccounting: <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>,
  iqc: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>,
  oqc: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>,
  contacts: <Icon d="M17 20h5v-2a3 3 0 0 0-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 0 1 5.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 0 1 9.288 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>,
  followups: <Icon d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>,
  activities: <Icon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/>,
  projects: <Icon d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>,
  tasks: <Icon d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>,
  timesheets: <Icon d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>,
  notifications: <Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>,
  boms: <Icon d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>,
  routings: <Icon d="M5 4h5v5H5zM14 15h5v5h-5zM10 6h4a3 3 0 0 1 3 3v2M14 18h-4a3 3 0 0 1-3-3v-2"/>,
  forecasts: <Icon d="M3 17l6-6 4 4 8-8M14 7h7v7"/>,
  mrpRuns: <Icon d="M4 4h16v6H4zM4 14h10v6H4zM18 14h2v6h-2z"/>,
  materialPlan: <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 14l2 2 4-4"/>,
  mrp: <Icon d="M4 4h16v6H4zM4 14h10v6H4zM18 14h2v6h-2z"/>,
  planningDocuments: <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 14l2 2 4-4"/>,
  productionOrders: <Icon d="M14.7 6.3a1 1 0 0 0 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.4L10 12.2l7.3-7.3a1 1 0 0 0-1.4-1.4z"/>,
  inventoryScrap: <Icon d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>,
  inventoryPeriod: <Icon d="M3 4h18v4H3zM3 12h18v4H3zM3 20h18M7 8v2M11 8v2M15 8v2M7 16v2M11 16v2M15 16v2"/>,
  salesDiscount: <Icon d="M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9zM15 9l-6 6m0-6l6 6"/>,
  purchaseDiscount: <Icon d="M12 1v6m0 10v6m11-11h-6m-10 0H1m17.07-7.07l-4.24 4.24M7.17 16.83l-4.24 4.24m13.14 0l-4.24-4.24M7.17 7.17L2.93 2.93"/>,
  users: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm10 0a4 4 0 0 0 4-4v-2M9 21v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2"/>,
};

// Navigation groups
export const navGroups = [
  { label: '概览', items: [
    { key: 'business-overview', label: '业务总览', icon: ic.overview, permission: 'DASHBOARD_VIEW' },
    { key: 'dashboard', label: '工作台', icon: ic.dashboard, permission: 'DASHBOARD_VIEW' },
  ]},
  { label: '销售与采购', items: [
    { key: 'orders', label: '销售订单', icon: ic.orders, any: ['ORDERS_VIEW', 'ORDERS_CREATE'] },
    { key: 'approvals', label: '订单审批', icon: ic.approvals, permission: 'ORDERS_APPROVE' },
    { key: 'purchase-orders', label: '采购订单', icon: ic.purchaseOrders, any: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE'] },
  ]},
  { label: '基础资料', items: [
    { key: 'suppliers', label: '供应商', icon: ic.suppliers, any: ['SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE'] },
    { key: 'customers', label: '客户', icon: ic.customers, any: ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE'] },
    { key: 'products', label: '货品', icon: ic.products, any: ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE'] },
    { key: 'warehouses', label: '仓库', icon: ic.warehouses, any: ['WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE'] },
  ]},
  { label: '仓储物流', items: [
    { key: 'inventory', label: '库存查询', icon: ic.inventory, any: ['INVENTORY_VIEW'] },
    { key: 'purchase-receipts', label: '采购入库', icon: ic.purchaseReceipts, any: ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
    { key: 'sales-deliveries', label: '销售出货', icon: ic.salesDeliveries, any: ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
    { key: 'returns', label: '退货管理', icon: ic.returns, any: ['RETURNS_VIEW', 'RETURNS_MANAGE'] },
    { key: 'inventory-transactions', label: '库存异动', icon: ic.inventoryTransactions, any: ['INVENTORY_VIEW'] },
    { key: 'inventory-scraps', label: '库存报废', icon: ic.inventoryScrap, any: ['INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE'] },
    { key: 'inventory-month-end', label: '存货月结', icon: ic.inventoryPeriod, any: ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE'] },
    { key: 'sales-discounts', label: '销售折让', icon: ic.salesDiscount, any: ['SALES_DISCOUNT_MANAGE'] },
    { key: 'purchase-discounts', label: '采购折让', icon: ic.purchaseDiscount, any: ['PURCHASE_DISCOUNT_MANAGE'] },
  ]},
  { label: '财务资金', items: [
    { key: 'accounts-receivable', label: '应收账款', icon: ic.accounting, any: ['AR_VIEW', 'COLLECTION_MANAGE'] },
    { key: 'payment-collections', label: '收款单', icon: ic.cashJournals, any: ['AR_VIEW', 'COLLECTION_MANAGE'] },
    { key: 'accounts-payable', label: '应付账款', icon: ic.accounting, any: ['AP_VIEW', 'PAYMENT_MANAGE'] },
    { key: 'payment-disbursements', label: '付款单', icon: ic.bankAccounts, any: ['AP_VIEW', 'PAYMENT_MANAGE'] },
    { key: 'accounting', label: '会计凭证', icon: ic.accounting, any: ['ACCOUNTING_VIEW'] },
    { key: 'cash-journals', label: '现金日记账', icon: ic.cashJournals, any: ['CASH_JOURNALS_VIEW', 'CASH_JOURNALS_MANAGE'] },
    { key: 'bank-accounts', label: '银行账户', icon: ic.bankAccounts, any: ['BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE'] },
    { key: 'bills', label: '票据管理', icon: ic.bills, any: ['BILLS_VIEW', 'BILLS_MANAGE'] },
    { key: 'fixed-assets', label: '固定资产', icon: ic.fixedAssets, any: ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE'] },
  ]},
  { label: '决策报表', items: [
    { key: 'decision-reports', label: '决策报表', icon: ic.reports, any: ['REPORT_VIEW'] },
  ]},
  { label: '生产制造', items: [
    { key: 'boms', label: 'BOM 清单', icon: ic.boms, any: ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_ORDERS_CREATE'] },
    { key: 'product-routings', label: '制品工序标准', icon: ic.routings, any: ['ROUTING_VIEW', 'ROUTING_MANAGE'] },
    { key: 'production-orders', label: '制令单', icon: ic.productionOrders, any: ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_ORDERS_CREATE'] },
    { key: 'material-issues', label: '用料出库', icon: ic.salesDeliveries, any: ['PRODUCTION_MATERIAL_ISSUE_MANAGE'] },
    { key: 'production-receipts', label: '生产入库', icon: ic.purchaseReceipts, any: ['PRODUCTION_RECEIPT_MANAGE'] },
  ]},
  { label: '计划与生产', items: [
    { key: 'forecasts', label: '需求预测', icon: ic.forecasts, any: ['MRP_VIEW', 'MRP_MANAGE'] },
    { key: 'mrp-runs', label: 'MRP 运算', icon: ic.mrpRuns, any: ['MRP_VIEW', 'MRP_MANAGE'] },
    { key: 'material-requirements-plan', label: '物料需求计划', icon: ic.materialPlan, any: ['MRP_VIEW', 'MRP_MANAGE'] },
    { key: 'production-instructions', label: '生产指令', icon: ic.planningDocuments, any: ['PRODUCTION_INSTRUCTION_VIEW'] },
    { key: 'purchase-instructions', label: '采购指令', icon: ic.planningDocuments, any: ['PURCHASE_INSTRUCTION_VIEW'] },
    { key: 'purchase-requisitions', label: '请购单', icon: ic.planningDocuments, any: ['PURCHASE_REQUISITION_VIEW'] },
  ]},
  { label: '成本与质量', items: [
    { key: 'product-costs', label: '标准成本', icon: ic.costAccounting, any: ['COST_VIEW', 'COST_MANAGE'] },
    { key: 'cost-rates', label: '费用项目', icon: ic.costAccounting, any: ['COST_VIEW', 'COST_MANAGE'] },
    { key: 'iqc', label: 'IQC来料检验', icon: ic.iqc, any: ['IQC_VIEW', 'IQC_MANAGE'] },
    { key: 'oqc', label: 'OQC出货检验', icon: ic.oqc, any: ['OQC_VIEW', 'OQC_MANAGE'] },
  ]},
  { label: '项目管理', items: [
    { key: 'projects', label: '项目立项', icon: ic.projects, any: ['PROJECT_VIEW', 'PROJECT_MANAGE'] },
    { key: 'tasks', label: '任务管理', icon: ic.tasks, any: ['PROJECT_VIEW', 'PROJECT_MANAGE'] },
    { key: 'timesheets', label: '工时记录', icon: ic.timesheets, any: ['PROJECT_VIEW', 'PROJECT_MANAGE'] },
  ]},
  { label: 'CRM客户关系', items: [
    { key: 'contacts', label: '联系人管理', icon: ic.contacts, any: ['CRM_VIEW', 'CRM_MANAGE'] },
    { key: 'followups', label: '客户跟进', icon: ic.followups, any: ['CRM_VIEW', 'CRM_MANAGE'] },
    { key: 'activities', label: '销售活动', icon: ic.activities, any: ['CRM_VIEW', 'CRM_MANAGE'] },
  ]},
  { label: '系统设置', items: [
    { key: 'notifications', label: '通知中心', icon: ic.notifications, any: ['DASHBOARD_VIEW'] },
    { key: 'workflows', label: '审批流', icon: ic.approvals, any: ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE'] },
    { key: 'users', label: '用户与角色', icon: ic.users, any: ['USERS_MANAGE', 'ROLES_MANAGE'] },
  ]},
];

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [page, setPage] = useState(location.hash.slice(1) || 'dashboard');
  const [toast, setToast] = useState(null);
  // M1: mobile-only navigation tab. Persists across resize so that
  // moving the window between desktop and mobile does not lose state.
  const [mobileTab, setMobileTab] = useState('apps');
  const [mobileApplication, setMobileApplication] = useState(null);
  const [navigationTarget, setNavigationTarget] = useState(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const isMobile = useMobile();
  const visibleNav = user ? navGroups.flatMap((g) => g?.items || []).filter((item) => item.permission ? can(user, item.permission) : item.any.some((p) => can(user, p))) : [];

  function canNavigate(pageKey) {
    return visibleNav.some((item) => item.key === pageKey);
  }

  function navigateToPage(pageKey, target = null, options = {}) {
    const authorizedPage = visibleNav.find((item) => item.key === pageKey);
    if (!authorizedPage) {
      if (options.notifyDenied !== false) setToast({ message: '没有权限打开该应用', type: 'error' });
      return false;
    }
    setPage(authorizedPage.key);
    const nextTarget = target?.documentId
      ? { page: authorizedPage.key, ...target }
      : (target && typeof target === 'object' && Object.keys(target).length ? { page: authorizedPage.key, ...target } : null);
    setNavigationTarget(nextTarget);
    if (options.writeHash !== false && location.hash.slice(1) !== authorizedPage.key) location.hash = authorizedPage.key;
    if (isMobile === true) {
      setMobileApplication((current) => current?.page === authorizedPage.key && !target?.documentId
        ? current
        : { page: authorizedPage.key, label: authorizedPage.label });
      setMobileTab('apps');
    }
    return true;
  }

  useEffect(() => {
    if (!getToken()) return setChecking(false);
    api('/api/auth/me').then(({ user }) => setUser(user)).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const unauthorized = () => setUser(null);
    const hash = () => navigateToPage(location.hash.slice(1) || 'dashboard', null, { writeHash: false, notifyDenied: false });
    addEventListener('erp:unauthorized', unauthorized); addEventListener('hashchange', hash);
    if (user && location.hash.slice(1)) hash();
    return () => { removeEventListener('erp:unauthorized', unauthorized); removeEventListener('hashchange', hash); };
  }, [user, isMobile]);
  useEffect(() => {
    if (user && visibleNav.length && !canNavigate(page)) navigateToPage(visibleNav[0].key, null, { notifyDenied: false });
  }, [user, page, isMobile]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user || isMobile === false) { setPendingApprovalCount(0); return; }
    let current = true;
    api('/api/approvals?tab=pending&limit=1')
      .then((data) => { if (current) setPendingApprovalCount(data.counts?.pending || 0); })
      .catch(() => { if (current) setPendingApprovalCount(0); });
    return () => { current = false; };
  }, [user, isMobile]);

  const notify = (message, type = 'success') => setToast({ message, type });
  if (checking) return <div className="boot"><div className="spinner"/><p>正在载入Modern ERP…</p></div>;
  if (!user) return <Login onLogin={setUser} notify={notify}/>;

  const pages = {
    'business-overview': <BusinessOverview/>,
    dashboard: <Dashboard user={user} notify={notify}/>,
    orders: <Orders user={user} notify={notify}/>,
    approvals: <Approvals notify={notify}/>,
    customers: <Customers user={user} notify={notify}/>,
    suppliers: <Suppliers user={user} notify={notify}/>,
    'purchase-orders': <PurchaseOrders user={user} notify={notify}/>,
    products: <Products user={user} notify={notify}/>,
    warehouses: <Warehouses user={user} notify={notify}/>,
    inventory: <Inventory user={user} notify={notify}/>,
    'cash-journals': <CashJournals user={user} notify={notify}/>,
    'bank-accounts': <BankAccounts user={user} notify={notify}/>,
    bills: <Bills user={user} notify={notify}/>,
    'fixed-assets': <FixedAssets user={user} notify={notify}/>,
    'product-costs': <ProductCosts user={user} notify={notify}/>,
    'cost-rates': <CostRates user={user} notify={notify}/>,
    iqc: <IQCInspections user={user} notify={notify}/>,
    oqc: <OQCInspections user={user} notify={notify}/>,
    contacts: <Contacts user={user} notify={notify}/>,
    followups: <Followups user={user} notify={notify}/>,
    activities: <SalesActivities user={user} notify={notify}/>,
    projects: <Projects user={user} notify={notify}/>,
    tasks: <ProjectTasks user={user} notify={notify}/>,
    timesheets: <Timesheets user={user} notify={notify}/>,
    notifications: <Notifications user={user} notify={notify}/>,
    workflows: <Workflows user={user} notify={notify}/>,
    accounting: <Accounting user={user} notify={notify}/>,
    'accounts-receivable': <Receivables user={user} notify={notify}/>,
    'payment-collections': <Collections user={user} notify={notify}/>,
    'accounts-payable': <Payables user={user} notify={notify}/>,
    'payment-disbursements': <Payments user={user} notify={notify}/>,
    'decision-reports': <DecisionReports user={user} notify={notify}/>,
    'purchase-receipts': <PurchaseReceipts user={user} notify={notify}/>,
    'sales-deliveries': <SalesDeliveries user={user} notify={notify}/>,
    returns: <Returns user={user} notify={notify}/>,
    'inventory-transactions': <InventoryTransactions user={user} notify={notify}/>,
    'inventory-scraps': <InventoryScraps user={user} notify={notify}/>,
    'inventory-month-end': <InventoryMonthEnd user={user} notify={notify}/>,
    'sales-discounts': <SalesDiscounts user={user} notify={notify}/>,
    'purchase-discounts': <PurchaseDiscounts user={user} notify={notify}/>,
    boms: <Boms user={user} notify={notify}/>,
    'product-routings': <ProductRoutings user={user} notify={notify}/>,
    'forecasts': <Forecasts user={user} notify={notify}/>,
    'mrp-runs': <MrpRuns user={user} notify={notify}/>,
    'material-requirements-plan': <MaterialRequirementsPlan user={user} notify={notify}/>,
    // Backwards-compat alias: legacy hash links / BUSINESS_FLOWS continue to resolve.
    'mrp': <MaterialRequirementsPlan user={user} notify={notify}/>,
    'production-instructions': <PlanningDocumentsHub user={user} notify={notify}/>,
    'purchase-instructions': <PlanningDocumentsHub user={user} notify={notify}/>,
    'purchase-requisitions': <PlanningDocumentsHub user={user} notify={notify}/>,
    'production-orders': <ProductionOrders user={user} notify={notify}/>,
    'material-issues': <MaterialIssues user={user} notify={notify}/>,
    'production-receipts': <ProductionReceipts user={user} notify={notify}/>,
    users: <UsersRoles user={user} notify={notify}/>
  };
  const current = visibleNav.find((item) => item.key === page) || visibleNav[0];
  const mobileApplicationGroups = buildMobileApplicationGroups(visibleNav, {
    isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
  });

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* local logout still succeeds */ }
    setToken(''); setUser(null);
  }

  // M1 mobile handlers.
  // The mobile tab is independent of the desktop `page` state.
  // Tapping a launcher item moves the desktop page state, but the
  // mobile shell remains visible. The launcher item callback is a
  // foundation for M2 role-based grouping; M1 only wires `messages`
  // / `approvals` / `profile` placeholders.
  function handleMobileTabChange(key) {
    if (MOBILE_TAB_KEYS.has(key)) {
      setMobileApplication(null);
      setMobileTab(key);
    }
  }

  function handleMobileApplicationSelect(item) {
    if (item.reportKey) {
      navigateToPage(item.page, { reportKey: item.reportKey });
    } else {
      navigateToPage(item.page);
    }
  }

  function returnToMobileApplications() {
    setMobileApplication(null);
    setMobileTab('apps');
  }

  function renderMobileContent() {
    if (mobileTab === 'messages') {
      return (
        <MobilePage
          title="消息"
          subtitle="系统通知与业务提醒"
          bodyState="empty"
          emptyText="暂无新消息"
        />
      );
    }
    if (mobileTab === 'approvals') {
      return <MobileApprovalCenter notify={notify} onPendingCountChange={setPendingApprovalCount} />;
    }
    if (mobileTab === 'profile') {
      return (
        <MobilePage
          title="我的"
          subtitle={`${user.displayName} · ${user.roleName}`}
          actions={(
            <button
              type="button"
              className="text-button"
              data-testid="mobile-profile-logout"
              onClick={logout}
            >
              退出
            </button>
          )}
        >
          <div className="mobile-card" data-testid="mobile-profile-card">
            <div className="mobile-card__title">账户信息</div>
            <div className="mobile-card__row">
              <span className="mobile-card__row-label">姓名</span>
              <span className="mobile-card__row-value">{user.displayName}</span>
            </div>
            <div className="mobile-card__row">
              <span className="mobile-card__row-label">角色</span>
              <span className="mobile-card__row-value">{user.roleName}</span>
            </div>
            <div className="mobile-card__row">
              <span className="mobile-card__row-label">登录账号</span>
              <span className="mobile-card__row-value">{user.username || '—'}</span>
            </div>
          </div>
        </MobilePage>
      );
    }
    if (mobileApplication) {
      return (
        <section
          className="mobile-application-view"
          data-testid={`mobile-application-view-${mobileApplication.page}`}
          aria-label={mobileApplication.label}
        >
          {mobileApplication.page === 'contacts'
            ? <MobileCrmApplication user={user} notify={notify} />
            : pages[mobileApplication.page]}
        </section>
      );
    }
    // The launcher consumes the already permission-filtered desktop nav.
    // Mobile metadata adds product grouping and display terminology only.
    return (
      <MobilePage>
        <MobileLauncher
          groups={mobileApplicationGroups}
          icons={ic}
          onItemSelect={handleMobileApplicationSelect}
        />
      </MobilePage>
    );
  }

  // M1 responsive composition:
  // - Mobile  : render MobileShell only. Do NOT mount the desktop
  //             page tree (so business pages do not fetch on hidden
  //             mobile tabs).
  // - Desktop : render the existing app-shell with sidebar + topbar.
  // The user, page, and toast state are shared by both branches but
  // each branch is rendered conditionally so that page components
  // are not mounted twice.
  if (isMobile) {
    const tabLabel = MOBILE_TABS.find((t) => t.key === mobileTab)?.label || 'Modern ERP';
    const mobileTitle = mobileApplication?.label || (mobileTab === 'apps' ? '应用' : tabLabel);
    return (
      <AppNavigationProvider value={{ currentPage: page, target: navigationTarget, canNavigate, navigateToPage }}>
      <MobileShell
        brand="Modern ERP"
        pageTitle={mobileTitle}
        activeTab={mobileTab}
        onTabChange={handleMobileTabChange}
        backAction={mobileApplication ? returnToMobileApplications : null}
        tabBadges={{ approvals: pendingApprovalCount }}
      >
        {renderMobileContent()}
        {toast && <div className={`toast ${toast.type}`} data-testid="mobile-toast">{toast.type === 'success' ? '✓' : '!'} {toast.message}</div>}
      </MobileShell>
      </AppNavigationProvider>
    );
  }

  return <div className="app-shell"><AppNavigationProvider value={{ currentPage: page, target: navigationTarget, canNavigate, navigateToPage }}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">M</div><div><strong>Modern ERP</strong><span>企业资源计划</span></div></div>
      <nav>{navGroups.map((group, gi) => group === null
        ? <div key={'div-' + gi} className="sidebar-divider"/>
        : <div key={gi} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {group.items?.map((item) => visibleNav.some((v) => v.key === item.key) &&
              <AppLink key={item.key} page={item.key} className={page === item.key ? 'active' : ''}>
                <span className="nav-icon">{item.icon}</span>{item.label}
                {item.key === 'approvals' && <span className="nav-dot"/>}
              </AppLink>
            )}
          </div>
      )}</nav>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div><h1>{current?.label}</h1></div>
        <div className="user-area">
          <div className="user-info"><strong>{user.displayName}</strong><span>{user.roleName}</span></div>
          <div className="avatar">{user.displayName.slice(0, 1)}</div>
          <button className="text-button" onClick={logout}>退出</button>
        </div>
      </header>
      <section className="page-content">{pages[current?.key] || pages.dashboard}</section>
    </main>
    {toast && <div className={`toast ${toast.type}`}>{toast.type === 'success' ? '✓' : '!'} {toast.message}</div>}
  </AppNavigationProvider></div>;
}
