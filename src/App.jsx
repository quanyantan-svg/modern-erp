import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { Login, Dashboard, Suppliers, Customers, Products, Orders, UsersRoles, PurchaseOrders, Warehouses, Inventory } from './pages/master-data.jsx';
import { Accounting } from './pages/accounting.jsx';
import DecisionReports, { canViewDecisionReport } from './pages/decision-reports.jsx';
import { PurchaseReceipts, SalesDeliveries, Returns, InventoryTransactions } from './pages/logistics-finance.jsx';
import { Collections, Payables, Payments, Receivables } from './pages/settlement.jsx';
import { Boms, ManufacturingAnalytics, ProductionOrders, MaterialIssues, ProductionReceipts } from './pages/manufacturing.jsx';
import { Projects, ProjectTasks, Timesheets, Notifications, Workflows } from './pages/projects-workflow.jsx';
import { CashJournals, BankAccounts, Bills, FixedAssets, ProductCosts, CostRates } from './pages/treasury-cost.jsx';
import { IQCInspections, OQCInspections, QualityControlPoints } from './pages/quality.jsx';
import Traceability from './pages/traceability.jsx';
import { SalesInvoices, SupplierBills } from './pages/commercial-go-live.jsx';
import { Contacts, Followups, SalesActivities } from './pages/crm.jsx';
import BusinessOverview from './pages/business-overview.jsx';
import ProductRoutings from './pages/product-routing.jsx';
import DataCleanup from './pages/data-cleanup.jsx';
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
import { buildMobileApplicationGroups } from './navigation/applicationMetadata.js';
import { AppNavigationProvider } from './navigation/AppNavigationContext.jsx';
import { Icon as ProductIcon } from './components/icons.jsx';
import { roleDisplayName } from './lib/copy.js';
const can = (user, permission) => user?.permissions?.includes(permission);

// Canonical product tabs share one validated navigation contract.
const MOBILE_TAB_KEYS = new Set(MOBILE_TABS.filter((t) => t.enabled).map((t) => t.key));

const launcherIconNames = [
  'overview', 'dashboard', 'orders', 'approvals', 'purchaseOrders', 'suppliers',
  'customers', 'products', 'warehouses', 'inventory', 'purchaseReceipts',
  'salesDeliveries', 'returns', 'inventoryTransactions', 'reports',
  'accountsReceivable', 'accountsPayable', 'paymentCollections',
  'paymentDisbursements', 'accounting', 'cashJournals', 'bankAccounts', 'bills',
  'fixedAssets', 'costAccounting', 'iqc', 'oqc', 'contacts', 'followups',
  'activities', 'projects', 'tasks', 'timesheets', 'notifications', 'boms',
  'routings', 'forecasts', 'mrpRuns', 'materialPlan', 'mrp', 'planningDocuments',
  'productionOrders', 'inventoryScrap', 'inventoryPeriod', 'salesDiscount',
  'purchaseDiscount', 'users', 'cleanup', 'traceability',
];
const ic = Object.fromEntries(launcherIconNames.map((name) => [name, <ProductIcon key={name} name={name} size={24}/>]));

// Navigation groups
export const navGroups = [
  { label: '概览', items: [
    { key: 'business-overview', label: '业务总览', icon: ic.overview, permission: 'DASHBOARD_VIEW' },
    { key: 'dashboard', label: '工作台', icon: ic.dashboard, permission: 'DASHBOARD_VIEW' },
  ]},
  { label: '销售与采购', items: [
    { key: 'orders', label: '销售订单', icon: ic.orders, any: ['ORDERS_VIEW', 'ORDERS_CREATE'] },
    { key: 'approvals', label: '业务审批', icon: ic.approvals, permission: 'ORDERS_APPROVE' },
    { key: 'purchase-orders', label: '采购订单', icon: ic.purchaseOrders, any: ['PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE'] },
  ]},
  { label: '基础资料', items: [
    { key: 'suppliers', label: '供应商资料', icon: ic.suppliers, any: ['SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE'] },
    { key: 'customers', label: '客户资料', icon: ic.customers, any: ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE'] },
    { key: 'products', label: '货品资料', icon: ic.products, any: ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE'] },
    { key: 'warehouses', label: '仓库资料', icon: ic.warehouses, any: ['WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE'] },
  ]},
  { label: '仓储物流', items: [
    { key: 'inventory', label: '库存作业', icon: ic.inventory, any: ['INVENTORY_VIEW'] },
    { key: 'purchase-receipts', label: '采购入库', icon: ic.purchaseReceipts, any: ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE'] },
    { key: 'sales-deliveries', label: '销售出货', icon: ic.salesDeliveries, any: ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE'] },
    { key: 'returns', label: '退货管理', icon: ic.returns, any: ['RETURNS_VIEW', 'RETURNS_MANAGE'] },
    { key: 'inventory-transactions', label: '库存异动明细', icon: ic.inventoryTransactions, any: ['INVENTORY_VIEW'] },
    { key: 'traceability', label: '批次与序列号追溯', icon: ic.traceability, any: ['INVENTORY_VIEW', 'PURCHASE_RECEIPTS_VIEW', 'SALES_DELIVERIES_VIEW'] },
    { key: 'inventory-scraps', label: '存货报废', icon: ic.inventoryScrap, any: ['INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE'] },
    { key: 'inventory-month-end', label: '存货月结', icon: ic.inventoryPeriod, any: ['INVENTORY_PERIOD_CLOSE_VIEW', 'INVENTORY_PERIOD_CLOSE_MANAGE'] },
    { key: 'sales-discounts', label: '销售折让', icon: ic.salesDiscount, any: ['SALES_DISCOUNT_MANAGE'] },
    { key: 'purchase-discounts', label: '采购折让', icon: ic.purchaseDiscount, any: ['PURCHASE_DISCOUNT_MANAGE'] },
  ]},
  { label: '财务资金', items: [
    { key: 'sales-invoices', label: '销售发票', icon: ic.accounting, any: ['AR_VIEW', 'ACCOUNTING_VIEW'] },
    { key: 'accounts-receivable', label: '应收账款', icon: ic.accounting, any: ['AR_VIEW', 'COLLECTION_MANAGE'] },
    { key: 'payment-collections', label: '收款单', icon: ic.cashJournals, any: ['AR_VIEW', 'COLLECTION_MANAGE'] },
    { key: 'accounts-payable', label: '应付账款', icon: ic.accounting, any: ['AP_VIEW', 'PAYMENT_MANAGE'] },
    { key: 'supplier-bills', label: '供应商账单', icon: ic.accounting, any: ['AP_VIEW', 'ACCOUNTING_VIEW'] },
    { key: 'payment-disbursements', label: '付款单', icon: ic.bankAccounts, any: ['AP_VIEW', 'PAYMENT_MANAGE'] },
    { key: 'accounting', label: '会计凭证', icon: ic.accounting, any: ['ACCOUNTING_VIEW'] },
    { key: 'cash-journals', label: '现金日记账', icon: ic.cashJournals, any: ['CASH_JOURNALS_VIEW', 'CASH_JOURNALS_MANAGE'], enabled: false },
    { key: 'bank-accounts', label: '银行账户', icon: ic.bankAccounts, any: ['BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE'] },
    { key: 'bills', label: '票据管理', icon: ic.bills, any: ['BILLS_VIEW', 'BILLS_MANAGE'], enabled: false },
    { key: 'fixed-assets', label: '固定资产', icon: ic.fixedAssets, any: ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE'], enabled: false },
  ]},
  { label: '经营分析', items: [
    { key: 'decision-reports', label: '经营分析', icon: ic.reports, any: ['REPORT_VIEW'] },
  ]},
  { label: '生产制造', items: [
    { key: 'boms', label: 'BOM 清单', icon: ic.boms, any: ['PRODUCTION_ORDERS_CREATE'] },
    { key: 'product-routings', label: '制品工序标准', icon: ic.routings, any: ['ROUTING_VIEW', 'ROUTING_MANAGE'] },
    { key: 'production-orders', label: '制令单', icon: ic.productionOrders, any: ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_ORDERS_CREATE'] },
    { key: 'material-issues', label: '用料出库', icon: ic.salesDeliveries, any: ['PRODUCTION_MATERIAL_ISSUE_MANAGE'] },
    { key: 'production-receipts', label: '生产入库', icon: ic.purchaseReceipts, any: ['PRODUCTION_RECEIPT_MANAGE'] },
    { key: 'manufacturing-analytics', label: '生产执行分析', icon: ic.reports, any: ['PRODUCTION_ORDERS_VIEW', 'PRODUCTION_COSTS_VIEW'] },
  ]},
  { label: '计划与生产', items: [
    { key: 'forecasts', label: '计划预测', icon: ic.forecasts, any: ['MRP_VIEW', 'MRP_MANAGE'] },
    { key: 'mrp-runs', label: 'MRP', icon: ic.mrpRuns, any: ['MRP_VIEW', 'MRP_MANAGE'] },
    { key: 'material-requirements-plan', label: 'MRP · 物料建议', icon: ic.materialPlan, any: ['MRP_VIEW', 'MRP_MANAGE'] },
    { key: 'production-instructions', label: '生产指令', icon: ic.planningDocuments, any: ['PRODUCTION_INSTRUCTION_VIEW'] },
    { key: 'purchase-instructions', label: '采购指令', icon: ic.planningDocuments, any: ['PURCHASE_INSTRUCTION_VIEW'] },
    { key: 'purchase-requisitions', label: '请购单', icon: ic.planningDocuments, any: ['PURCHASE_REQUISITION_VIEW'] },
  ]},
  { label: '成本与质量', items: [
    { key: 'product-costs', label: '标准成本', icon: ic.costAccounting, any: ['COST_VIEW', 'COST_MANAGE'] },
    { key: 'cost-rates', label: '成本费率', icon: ic.costAccounting, any: ['COST_VIEW', 'COST_MANAGE'] },
    { key: 'iqc', label: 'IQC来料检验', icon: ic.iqc, any: ['IQC_VIEW', 'IQC_MANAGE'] },
    { key: 'oqc', label: 'OQC出货检验', icon: ic.oqc, any: ['OQC_VIEW', 'OQC_MANAGE'] },
    { key: 'quality-control-points', label: '质量规则', icon: ic.iqc, any: ['USERS_MANAGE'] },
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
    { key: 'workflows', label: '审批流', icon: ic.approvals, any: ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE'], enabled: false },
    { key: 'users', label: '用户与角色', icon: ic.users, any: ['USERS_MANAGE', 'ROLES_MANAGE'] },
    { key: 'data-cleanup', label: '数据整理', icon: ic.cleanup, permission: 'USERS_MANAGE', enabled: false },
  ]},
];

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [page, setPage] = useState(location.hash.slice(1) || 'dashboard');
  const [toast, setToast] = useState(null);
  const [mobileTab, setMobileTab] = useState('apps');
  const [mobileApplication, setMobileApplication] = useState(null);
  const [navigationTarget, setNavigationTarget] = useState(null);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const visibleNav = user ? navGroups.flatMap((g) => g?.items || []).filter((item) => item.enabled !== false && (item.permission ? can(user, item.permission) : item.any.some((p) => can(user, p)))) : [];

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
    setMobileApplication((current) => current?.page === authorizedPage.key && !target?.documentId
      ? current
      : { page: authorizedPage.key, label: authorizedPage.label });
    setMobileTab('apps');
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
  }, [user]);
  useEffect(() => {
    if (user && visibleNav.length && !canNavigate(page)) navigateToPage(visibleNav[0].key, null, { notifyDenied: false });
  }, [user, page]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user) { setPendingApprovalCount(0); return; }
    let current = true;
    api('/api/approvals?tab=pending&limit=1')
      .then((data) => { if (current) setPendingApprovalCount(data.counts?.pending || 0); })
      .catch(() => { if (current) setPendingApprovalCount(0); });
    return () => { current = false; };
  }, [user]);

  const notify = (message, type = 'success') => setToast({ message, type });
  if (checking) return <div className="boot"><div className="spinner"/><p>正在载入Modern ERP…</p></div>;
  if (!user) return <Login onLogin={setUser} notify={notify}/>;

  const pages = {
    'business-overview': <BusinessOverview/>,
    dashboard: <Dashboard user={user} notify={notify}/>,
    orders: <Orders user={user} notify={notify}/>,
    approvals: <MobileApprovalCenter notify={notify} onPendingCountChange={setPendingApprovalCount} standaloneTitle/>,
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
    'quality-control-points': <QualityControlPoints user={user} notify={notify}/>,
    contacts: <Contacts user={user} notify={notify}/>,
    followups: <Followups user={user} notify={notify}/>,
    activities: <SalesActivities user={user} notify={notify}/>,
    projects: <Projects user={user} notify={notify}/>,
    tasks: <ProjectTasks user={user} notify={notify}/>,
    timesheets: <Timesheets user={user} notify={notify}/>,
    notifications: <Notifications user={user} notify={notify}/>,
    workflows: <Workflows user={user} notify={notify}/>,
    accounting: <Accounting user={user} notify={notify}/>,
    'sales-invoices': <SalesInvoices user={user} notify={notify}/>,
    'supplier-bills': <SupplierBills user={user} notify={notify}/>,
    'accounts-receivable': <Receivables user={user} notify={notify}/>,
    'payment-collections': <Collections user={user} notify={notify}/>,
    'accounts-payable': <Payables user={user} notify={notify}/>,
    'payment-disbursements': <Payments user={user} notify={notify}/>,
    'decision-reports': <DecisionReports user={user} notify={notify}/>,
    'purchase-receipts': <PurchaseReceipts user={user} notify={notify}/>,
    'sales-deliveries': <SalesDeliveries user={user} notify={notify}/>,
    returns: <Returns user={user} notify={notify}/>,
    'inventory-transactions': <InventoryTransactions user={user} notify={notify}/>,
    traceability: <Traceability user={user} notify={notify}/>,
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
    'manufacturing-analytics': <ManufacturingAnalytics user={user} notify={notify}/>,
    users: <UsersRoles user={user} notify={notify}/>,
    'data-cleanup': <DataCleanup user={user} notify={notify}/>
  };
  const mobileApplicationGroups = buildMobileApplicationGroups(visibleNav, {
    isItemVisible: (item) => !item.reportKey || canViewDecisionReport(user, item.reportKey),
  });

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* local logout still succeeds */ }
    setToken(''); setUser(null);
  }

  function handleMobileTabChange(key) {
    if (MOBILE_TAB_KEYS.has(key)) {
      setMobileApplication(null);
      setMobileTab(key);
    }
  }

  function handleMobileApplicationSelect(item) {
    if (item.reportKey) {
      navigateToPage(item.page, { reportKey: item.reportKey });
    } else if (item.target) {
      navigateToPage(item.page, item.target);
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
      return pages.notifications;
    }
    if (mobileTab === 'approvals') {
      return <MobileApprovalCenter notify={notify} onPendingCountChange={setPendingApprovalCount} />;
    }
    if (mobileTab === 'workspace') {
      return <Dashboard user={user} notify={notify} mobileWorkspace />;
    }
    if (mobileTab === 'profile') {
      return (
        <MobilePage
          title="我的"
          subtitle={`${user.displayName} · ${roleDisplayName(user)}`}
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
              <span className="mobile-card__row-value">{roleDisplayName(user)}</span>
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
      const applicationPage = mobileApplication.page === 'contacts'
        ? <MobileCrmApplication user={user} notify={notify} />
        : (mobileApplication.page === 'dashboard'
          ? <Dashboard user={user} notify={notify} mobileWorkspace />
          : pages[mobileApplication.page]);
      return (
        <section
          className="mobile-application-view"
          data-testid={`mobile-application-view-${mobileApplication.page}`}
          aria-label={mobileApplication.label}
        >
          {applicationPage}
        </section>
      );
    }
    // The launcher consumes the permission-filtered canonical navigation.
    // Product metadata adds grouping and display terminology only.
    return (
      <MobileLauncher
        groups={mobileApplicationGroups}
        visibleNav={visibleNav}
        icons={ic}
        onItemSelect={handleMobileApplicationSelect}
      />
    );
  }

  const tabLabel = MOBILE_TABS.find((tab) => tab.key === mobileTab)?.label || 'Modern ERP';
  const workspaceTitle = mobileApplication?.label || (mobileTab === 'apps' ? '应用' : tabLabel);
  return (
    <AppNavigationProvider value={{ currentPage: page, target: navigationTarget, canNavigate, navigateToPage }}>
      <MobileShell
        brand="Modern ERP"
        pageTitle={workspaceTitle}
        activeTab={mobileTab}
        onTabChange={handleMobileTabChange}
        backAction={mobileApplication ? returnToMobileApplications : null}
        tabBadges={{ approvals: pendingApprovalCount }}
      >
        {renderMobileContent()}
        {toast && <div className={`toast ${toast.type}`} role="status" data-testid="mobile-toast"><ProductIcon name={toast.type === 'success' ? 'check' : 'error'} size={18}/><span>{toast.message}</span></div>}
      </MobileShell>
    </AppNavigationProvider>
  );
}
