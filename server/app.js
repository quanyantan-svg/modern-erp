import { createHash, randomBytes } from 'node:crypto';
import { id, hashPassword, PERMISSIONS, transaction, verifyPassword } from './db.js';
import { audit } from './lib/audit.js';
import {
  createContact, createFollowup, createProject, createProjectTask, createSalesActivity,
  createTimesheet, createWorkflow, deleteContact, deleteSalesActivity, deleteTimesheet,
  getProjectDetail, listContacts, listFollowups, listNotifications, listProjectTasks,
  listProjects, listSalesActivities, listTimesheets, listWorkflows, markNotificationRead,
  updateContact, updateFollowup, updateProject, updateProjectTask, updateSalesActivity,
} from './modules/business.js';
import {
  createAlertRule, createAuxProject, createBankReconciliation, createBankStatement,
  createDepartment, createExpenseClaim, createIqcInspection, createLaborRecord,
  createLeaveRequest, createMrpPlan, createOqcInspection, createPeriodClosure,
  createRoutingOperation, createSupplierEvaluation, createVoucherWord, createWorkCenter,
  generateMrp, getBalanceSheet, getFinancialSummary, getIncomeStatement, getIqcInspection,
  getInventoryStatus, getOqcInspection, getSalesAnalysis, getTrialBalance,
  completeIqcInspection, completeOqcInspection, updateIqcInspection, updateOqcInspection,
  listAlertRecords, listAlertRules, listAuxProjects, listBankReconciliations,
  listBankStatements, listCurrencies, listDepartments, listExpenseClaims,
  listIqcInspections, listLaborRecords, listLeaveRequests, listMrpPlans,
  listOqcInspections, listPeriodClosures, listRoutingOperations,
  closePeriod, getClosureChecklist, listSupplierEvaluations, listVoucherTemplates, listVoucherWords, listWorkCenters, unclosePeriod,
  processExpenseClaim, processLeaveRequest, resolveAlert, updateAlertRule,
} from './modules/extended.js';
import { listApprovals } from './modules/approvals.js';
import {
  HttpError,
  allow,
  allowAny,
  bearer,
  optionalText,
  readJson,
  requiredCode,
  requiredText,
  send,
  serveStatic,
  setSecurityHeaders,
} from './lib/http.js';

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const TOKEN_LENGTH = Number(process.env.TOKEN_LENGTH || 32);
const STATUS_LABELS = { DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已审核', REJECTED: '已驳回' };
const PURCHASE_STATUS_LABELS = STATUS_LABELS;

export function createApp(db, options = {}) {
  const distDir = options.distDir;

  return async function app(req, res) {
    setSecurityHeaders(res);
    if (req.method === 'OPTIONS') return send(res, 204, null);

    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(db, req, res, url);
      }
      return serveStatic(res, url.pathname, distDir);
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message, details: error.details });
      if (String(error.message).includes('UNIQUE constraint failed')) return send(res, 409, { error: '编号或账号已存在，请更换后重试' });
      console.error(error);
      return send(res, 500, { error: '服务器内部错误' });
    }
  };
}

async function handleApi(db, req, res, url) {
  const { pathname } = url;
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { status: 'ok', service: 'modern-erp-api' });
  if (req.method === 'POST' && pathname === '/api/auth/login') return login(db, req, res);

  if (req.method === 'POST' && pathname === '/api/auth/logout') return logout(db, req, res);
  const actor = authenticate(db, req);
  if (req.method === 'GET' && pathname === '/api/auth/me') return send(res, 200, { user: actor });
  if (req.method === 'GET' && pathname === '/api/dashboard') return dashboard(db, res, actor);
  if (req.method === 'GET' && pathname === '/api/approvals') return listApprovals(db, res, actor, url);

  if (pathname === '/api/roles' && req.method === 'GET') return listRoles(db, res, actor);
  if (pathname === '/api/roles' && req.method === 'POST') return createRole(db, req, res, actor);
  const roleMatch = pathname.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && req.method === 'PATCH') return updateRole(db, req, res, actor, roleMatch[1]);

  if (pathname === '/api/users/lookup' && req.method === 'GET') return listProjectManagerCandidates(db, res, actor);
  if (pathname === '/api/users' && req.method === 'GET') return listUsers(db, res, actor);
  if (pathname === '/api/users' && req.method === 'POST') return createUser(db, req, res, actor);
  const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === 'PATCH') return updateUser(db, req, res, actor, userMatch[1]);

  if (pathname === '/api/customers' && req.method === 'GET') return listCustomers(db, res, actor, url);
  if (pathname === '/api/customers' && req.method === 'POST') return createCustomer(db, req, res, actor);
  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customerMatch && req.method === 'PATCH') return updateCustomer(db, req, res, actor, customerMatch[1]);

  if (pathname === '/api/suppliers' && req.method === 'GET') return listSuppliers(db, res, actor, url);
  if (pathname === '/api/suppliers' && req.method === 'POST') return createSupplier(db, req, res, actor);
  const supplierMatch = pathname.match(/^\/api\/suppliers\/([^/]+)$/);
  if (supplierMatch && req.method === 'PATCH') return updateSupplier(db, req, res, actor, supplierMatch[1]);

  if (pathname === '/api/products' && req.method === 'GET') return listProducts(db, res, actor, url);
  if (pathname === '/api/products' && req.method === 'POST') return createProduct(db, req, res, actor);
  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && req.method === 'PATCH') return updateProduct(db, req, res, actor, productMatch[1]);

  if (pathname === '/api/orders' && req.method === 'GET') return listOrders(db, res, actor, url);
  if (pathname === '/api/orders' && req.method === 'POST') return createOrder(db, req, res, actor);
  const orderActionMatch = pathname.match(/^\/api\/orders\/([^/]+)\/(submit|approve|reject)$/);
  if (orderActionMatch && req.method === 'POST') return changeOrderState(db, req, res, actor, orderActionMatch[1], orderActionMatch[2]);
  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === 'GET') return getOrder(db, res, actor, orderMatch[1]);
  if (orderMatch && req.method === 'PUT') return updateOrder(db, req, res, actor, orderMatch[1]);

    // Purchase Orders
  if (pathname === '/api/purchase-orders' && req.method === 'GET') return listPurchaseOrders(db, res, actor, url);
  if (pathname === '/api/purchase-orders' && req.method === 'POST') return createPurchaseOrder(db, req, res, actor);
  const poActionMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)\/(submit|approve|reject)$/);
  if (poActionMatch && req.method === 'POST') return changePurchaseOrderState(db, req, res, actor, poActionMatch[1], poActionMatch[2]);
  const poMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)$/);
  if (poMatch && req.method === 'GET') return getPurchaseOrder(db, res, actor, poMatch[1]);

  // Cash Journals
  if (pathname === '/api/cash-journals' && req.method === 'GET') return listCashJournals(db, res, actor, url);
  if (pathname === '/api/cash-journals' && req.method === 'POST') return createCashJournal(db, req, res, actor);

  // Bank Accounts
  if (pathname === '/api/bank-accounts' && req.method === 'GET') return listBankAccounts(db, res, actor);
  if (pathname === '/api/bank-accounts' && req.method === 'POST') return createBankAccount(db, req, res, actor);
  const bankAccountMatch = pathname.match(/^\/api\/bank-accounts\/([^/]+)$/);
  if (bankAccountMatch && req.method === 'PATCH') return updateBankAccount(db, req, res, actor, bankAccountMatch[1]);

  // Bills
  if (pathname === '/api/bills' && req.method === 'GET') return listBills(db, res, actor, url);
  if (pathname === '/api/bills' && req.method === 'POST') return createBill(db, req, res, actor);
  const billMatch = pathname.match(/^\/api\/bills\/([^/]+)$/);
  if (billMatch && req.method === 'PATCH') return updateBill(db, req, res, actor, billMatch[1]);

  // Fixed Assets
  if (pathname === '/api/fixed-assets' && req.method === 'GET') return listFixedAssets(db, res, actor, url);
  if (pathname === '/api/fixed-assets' && req.method === 'POST') return createFixedAsset(db, req, res, actor);
  const assetMatch = pathname.match(/^\/api\/fixed-assets\/([^/]+)$/);
  if (assetMatch && req.method === 'PATCH') return updateFixedAsset(db, req, res, actor, assetMatch[1]);
  if (pathname === '/api/fixed-assets/depreciation' && req.method === 'POST') return calculateDepreciation(db, req, res, actor);
  const assetDepMatch = pathname.match(/^\/api\/fixed-assets\/([^/]+)\/depreciations$/);
  if (assetDepMatch && req.method === 'GET') return getFixedAssetDepreciations(db, res, actor, assetDepMatch[1]);
  if (poMatch && req.method === 'PUT') return updatePurchaseOrder(db, req, res, actor, poMatch[1]);

  // Warehouses
  if (pathname === '/api/warehouses' && req.method === 'GET') return listWarehouses(db, res, actor, url);
  if (pathname === '/api/warehouses' && req.method === 'POST') return createWarehouse(db, req, res, actor);
  const whMatch = pathname.match(/^\/api\/warehouses\/([^/]+)$/);
  if (whMatch && req.method === 'PATCH') return updateWarehouse(db, req, res, actor, whMatch[1]);

  // Inventory
  if (pathname === '/api/inventory' && req.method === 'GET') return listInventory(db, res, actor, url);
  if (pathname === '/api/inventory/alerts' && req.method === 'GET') return getInventoryAlerts(db, res, actor);
  if (pathname === '/api/inventory/reorder' && req.method === 'GET') return getReorderList(db, res, actor);
  if (pathname === '/api/mrp/calculate' && req.method === 'POST') return calculateMRP(db, req, res, actor);
  if (pathname === '/api/mrp/bom-explode' && req.method === 'POST') return explodeBOM(db, req, res, actor);
  if (pathname === '/api/inventory-checks' && req.method === 'GET') return listInventoryChecks(db, res, actor, url);
  if (pathname === '/api/inventory-checks' && req.method === 'POST') return createInventoryCheck(db, req, res, actor);
  const icMatch = pathname.match(/^\/api\/inventory-checks\/([^/]+)$/);
  if (icMatch && req.method === 'PATCH') return approveInventoryCheck(db, req, res, actor, icMatch[1]);
  if (pathname === '/api/inventory-transfers' && req.method === 'GET') return listInventoryTransfers(db, res, actor, url);
  if (pathname === '/api/inventory-transfers' && req.method === 'POST') return createInventoryTransfer(db, req, res, actor);
  const itMatch = pathname.match(/^\/api\/inventory-transfers\/([^/]+)$/);
  if (itMatch && req.method === 'GET') return getInventoryTransfer(db, res, actor, itMatch[1]);
  const itActionMatch = pathname.match(/^\/api\/inventory-transfers\/([^/]+)\/(transfer|cancel)$/);
  if (itActionMatch && req.method === 'POST') return changeInventoryTransferState(db, req, res, actor, itActionMatch[1], itActionMatch[2]);

  // Accounting
  if (pathname === '/api/accounting-subjects' && req.method === 'GET') return listAccountingSubjects(db, res, actor);
  if (pathname === '/api/accounting-vouchers' && req.method === 'GET') return listAccountingVouchers(db, res, actor, url);
  const avMatch = pathname.match(/^\/api\/accounting-vouchers\/([^/]+)$/);
  if (avMatch && req.method === 'GET') return getAccountingVoucher(db, res, actor, avMatch[1]);
  if (pathname === '/api/departments' && req.method === 'GET') return listDepartments(db, res, actor, url);
  if (pathname === '/api/departments' && req.method === 'POST') return createDepartment(db, req, res, actor);
  if (pathname === '/api/aux-projects' && req.method === 'GET') return listAuxProjects(db, res, actor, url);
  if (pathname === '/api/aux-projects' && req.method === 'POST') return createAuxProject(db, req, res, actor);
  if (pathname === '/api/currencies' && req.method === 'GET') return listCurrencies(db, res, actor);
  if (pathname === '/api/voucher-words' && req.method === 'GET') return listVoucherWords(db, res, actor);
  if (pathname === '/api/voucher-words' && req.method === 'POST') return createVoucherWord(db, req, res, actor);
  if (pathname === '/api/voucher-templates' && req.method === 'GET') return listVoucherTemplates(db, res, actor, url);
  if (pathname === '/api/period-closures' && req.method === 'GET') return listPeriodClosures(db, res, actor, url);
  if (pathname === '/api/period-closures' && req.method === 'POST') return createPeriodClosure(db, req, res, actor);
  // Period Closure Operations
  const periodClosureMatch = pathname.match(/^\/api\/period-closures\/([^/]+)\/(close|unclose)$/);
  if (periodClosureMatch && req.method === 'POST') {
    const closureId = periodClosureMatch[1];
    const action = periodClosureMatch[2];
    if (action === 'close') return closePeriod(db, req, res, actor, closureId);
    if (action === 'unclose') return unclosePeriod(db, req, res, actor, closureId);
  }
  // Closure Checklist
  if (pathname === '/api/period-closures/closure-checklist' && req.method === 'GET') return getClosureChecklist(db, res, actor, url);
  if (pathname === '/api/mrp-plans' && req.method === 'GET') return listMrpPlans(db, res, actor, url);
  if (pathname === '/api/mrp-plans' && req.method === 'POST') return createMrpPlan(db, req, res, actor);
  if (pathname === '/api/mrp-plans/generate' && req.method === 'POST') return generateMrp(db, req, res, actor);
  if (pathname === '/api/work-centers' && req.method === 'GET') return listWorkCenters(db, res, actor);
  if (pathname === '/api/work-centers' && req.method === 'POST') return createWorkCenter(db, req, res, actor);
  if (pathname === '/api/routing-operations' && req.method === 'GET') return listRoutingOperations(db, res, actor, url);
  if (pathname === '/api/routing-operations' && req.method === 'POST') return createRoutingOperation(db, req, res, actor);
  if (pathname === '/api/labor-records' && req.method === 'GET') return listLaborRecords(db, res, actor, url);
  if (pathname === '/api/labor-records' && req.method === 'POST') return createLaborRecord(db, req, res, actor);
  if (pathname === '/api/iqc' && req.method === 'GET') return listIqcInspections(db, res, actor, url);
  if (pathname === '/api/iqc' && req.method === 'POST') return createIqcInspection(db, req, res, actor);
  const iqcMatch = pathname.match(/^\/api\/iqc\/([^/]+)$/);
  if (iqcMatch && req.method === 'GET') return getIqcInspection(db, res, actor, iqcMatch[1]);
  if (iqcMatch && req.method === 'PATCH') return updateIqcInspection(db, req, res, actor, iqcMatch[1]);
  const iqcCompleteMatch = pathname.match(/^\/api\/iqc\/([^/]+)\/complete$/);
  if (iqcCompleteMatch && req.method === 'POST') return completeIqcInspection(db, req, res, actor, iqcCompleteMatch[1]);
  if (pathname === '/api/oqc' && req.method === 'GET') return listOqcInspections(db, res, actor, url);
  if (pathname === '/api/oqc' && req.method === 'POST') return createOqcInspection(db, req, res, actor);
  const oqcMatch = pathname.match(/^\/api\/oqc\/([^/]+)$/);
  if (oqcMatch && req.method === 'GET') return getOqcInspection(db, res, actor, oqcMatch[1]);
  if (oqcMatch && req.method === 'PATCH') return updateOqcInspection(db, req, res, actor, oqcMatch[1]);
  const oqcCompleteMatch = pathname.match(/^\/api\/oqc\/([^/]+)\/complete$/);
  if (oqcCompleteMatch && req.method === 'POST') return completeOqcInspection(db, req, res, actor, oqcCompleteMatch[1]);
  if (pathname === '/api/supplier-evaluations' && req.method === 'GET') return listSupplierEvaluations(db, res, actor, url);
  if (pathname === '/api/supplier-evaluations' && req.method === 'POST') return createSupplierEvaluation(db, req, res, actor);
  // OA Leave Requests
  if (pathname === '/api/leave-requests' && req.method === 'GET') return listLeaveRequests(db, res, actor, url);
  if (pathname === '/api/leave-requests' && req.method === 'POST') return createLeaveRequest(db, req, res, actor);
  const leaveMatch = pathname.match(/^\/api\/leave-requests\/([^/]+)\/(approve|reject)$/);
  if (leaveMatch && req.method === 'POST') return processLeaveRequest(db, req, res, actor, leaveMatch[1], leaveMatch[2]);
  // OA Expense Claims
  if (pathname === '/api/expense-claims' && req.method === 'GET') return listExpenseClaims(db, res, actor, url);
  if (pathname === '/api/expense-claims' && req.method === 'POST') return createExpenseClaim(db, req, res, actor);
  const expenseMatch = pathname.match(/^\/api\/expense-claims\/([^/]+)\/(approve|reject)$/);
  if (expenseMatch && req.method === 'POST') return processExpenseClaim(db, req, res, actor, expenseMatch[1], expenseMatch[2]);
  // Alert Rules
  if (pathname === '/api/alert-rules' && req.method === 'GET') return listAlertRules(db, res, actor);
  if (pathname === '/api/alert-rules' && req.method === 'POST') return createAlertRule(db, req, res, actor);
  const ruleMatch = pathname.match(/^\/api\/alert-rules\/([^/]+)$/);
  if (ruleMatch && req.method === 'PATCH') return updateAlertRule(db, req, res, actor, ruleMatch[1]);
  // Alert Records
  if (pathname === '/api/alerts' && req.method === 'GET') return listAlertRecords(db, res, actor, url);
  if (pathname === '/api/alerts/:id/resolve' && req.method === 'POST') return resolveAlert(db, req, res, actor);
  // Dashboard Reports
  if (pathname === '/api/reports/financial-summary' && req.method === 'GET') return getFinancialSummary(db, res, actor, url);
  if (pathname === '/api/reports/income-statement' && req.method === 'GET') return getIncomeStatement(db, res, actor, url);
  if (pathname === '/api/reports/balance-sheet' && req.method === 'GET') return getBalanceSheet(db, res, actor, url);
  if (pathname === '/api/reports/inventory-status' && req.method === 'GET') return getInventoryStatus(db, res, actor, url);
  if (pathname === '/api/reports/sales-analysis' && req.method === 'GET') return getSalesAnalysis(db, res, actor, url);
  if (pathname === '/api/bank-statements' && req.method === 'GET') return listBankStatements(db, res, actor, url);
  if (pathname === '/api/bank-statements' && req.method === 'POST') return createBankStatement(db, req, res, actor);
  if (pathname === '/api/bank-reconciliations' && req.method === 'GET') return listBankReconciliations(db, res, actor, url);
  if (pathname === '/api/bank-reconciliations' && req.method === 'POST') return createBankReconciliation(db, req, res, actor);
  if (pathname === '/api/reports/trial-balance' && req.method === 'GET') return getTrialBalance(db, res, actor, url);
  if (pathname === '/api/accounting-vouchers' && req.method === 'POST') return createAccountingVoucher(db, req, res, actor);
  // Accounting Voucher Workflow
  const voucherActionMatch = pathname.match(/^\/api\/accounting-vouchers\/([^/]+)\/(submit|approve|reject)$/);
  if (voucherActionMatch && req.method === 'POST') {
    const voucherId = voucherActionMatch[1];
    const action = voucherActionMatch[2];
    if (action === 'submit') return submitAccountingVoucher(db, req, res, actor, voucherId);
    if (action === 'approve') return approveAccountingVoucher(db, req, res, actor, voucherId);
    if (action === 'reject') return rejectAccountingVoucher(db, req, res, actor, voucherId);
  }
  const avPatchMatch = pathname.match(/^\/api\/accounting-vouchers\/([^/]+)$/);
  if (avPatchMatch && req.method === 'PATCH') return updateAccountingVoucher(db, req, res, actor, avPatchMatch[1]);
  if (avPatchMatch && req.method === 'DELETE') return deleteAccountingVoucher(db, req, res, actor, avPatchMatch[1]);
  // Audit Logs
  if (pathname === '/api/audit-logs' && req.method === 'GET') return listAuditLogs(db, res, actor, url);


  // Purchase Receipts
  if (pathname === "/api/purchase-receipts" && req.method === "GET") return listPurchaseReceipts(db, res, actor, url);
  if (pathname === "/api/purchase-receipts" && req.method === "POST") return createPurchaseReceipt(db, req, res, actor);
  const prMatch = pathname.match(/^\/api\/purchase-receipts\/([^\/]+)$/);
  if (prMatch && req.method === "GET") return getPurchaseReceipt(db, res, actor, prMatch[1]);
  if (prMatch && req.method === "PATCH") return updatePurchaseReceipt(db, req, res, actor, prMatch[1]);
  if (prMatch && req.method === "POST") return confirmPurchaseReceipt(db, req, res, actor, prMatch[1]);

  // Sales Deliveries
  if (pathname === "/api/sales-deliveries" && req.method === "GET") return listSalesDeliveries(db, res, actor, url);
  if (pathname === "/api/sales-deliveries" && req.method === "POST") return createSalesDelivery(db, req, res, actor);
  const sdMatch = pathname.match(/^\/api\/sales-deliveries\/([^\/]+)$/);
  if (sdMatch && req.method === "GET") return getSalesDelivery(db, res, actor, sdMatch[1]);
  if (sdMatch && req.method === "PATCH") return updateSalesDelivery(db, req, res, actor, sdMatch[1]);
  if (sdMatch && req.method === "POST") return confirmSalesDelivery(db, req, res, actor, sdMatch[1]);

  // Sales Returns
  if (pathname === "/api/sales-returns" && req.method === "GET") return listSalesReturns(db, res, actor, url);
  if (pathname === "/api/sales-returns" && req.method === "POST") return createSalesReturn(db, req, res, actor);
  const srMatch = pathname.match(/^\/api\/sales-returns\/([^\/]+)$/);
  if (srMatch && req.method === "GET") return getSalesReturn(db, res, actor, srMatch[1]);
  if (srMatch && req.method === "PATCH") return updateSalesReturn(db, req, res, actor, srMatch[1]);
  if (srMatch && req.method === "POST") return confirmSalesReturn(db, req, res, actor, srMatch[1]);

  // Purchase Returns
  if (pathname === "/api/purchase-returns" && req.method === "GET") return listPurchaseReturns(db, res, actor, url);
  if (pathname === "/api/purchase-returns" && req.method === "POST") return createPurchaseReturn(db, req, res, actor);
  const purMatch = pathname.match(/^\/api\/purchase-returns\/([^\/]+)$/);
  if (purMatch && req.method === "GET") return getPurchaseReturn(db, res, actor, purMatch[1]);
  if (purMatch && req.method === "PATCH") return updatePurchaseReturn(db, req, res, actor, purMatch[1]);
  if (purMatch && req.method === "POST") return confirmPurchaseReturn(db, req, res, actor, purMatch[1]);

  // Inventory Transactions
  if (pathname === "/api/inventory-transactions" && req.method === "GET") return listInventoryTransactions(db, res, actor, url);

  // Narrow lookups for warehouse-flavored pickers (gated by INVENTORY_VIEW).
  if (pathname === "/api/lookup/suppliers" && req.method === "GET") return listSupplierLookup(db, res, actor, url);
  if (pathname === "/api/lookup/customers" && req.method === "GET") return listCustomerLookup(db, res, actor, url);

  // ============ Accounts Receivable ============
  if (pathname === "/api/accounts-receivable" && req.method === "GET") return listAccountsReceivable(db, res, actor, url);
  if (pathname === "/api/accounts-receivable" && req.method === "POST") return createAccountReceivable(db, req, res, actor);
  const arMatch = pathname.match(/^\/api\/accounts-receivable\/(.+)$/);
  if (arMatch && req.method === "GET") return getAccountReceivable(db, res, actor, arMatch[1]);

  // ============ Accounts Payable ============
  if (pathname === "/api/accounts-payable" && req.method === "GET") return listAccountsPayable(db, res, actor, url);
  if (pathname === "/api/accounts-payable" && req.method === "POST") return createAccountPayable(db, req, res, actor);
  const apMatch = pathname.match(/^\/api\/accounts-payable\/(.+)$/);
  if (apMatch && req.method === "GET") return getAccountPayable(db, res, actor, apMatch[1]);

  // ============ Payment Collections ============
  if (pathname === "/api/payment-collections" && req.method === "GET") return listPaymentCollections(db, res, actor, url);
  if (pathname === "/api/payment-collections" && req.method === "POST") return createPaymentCollection(db, req, res, actor);
  const pcMatch = pathname.match(/^\/api\/payment-collections\/(.+)$/);
  if (pcMatch && req.method === "GET") return getPaymentCollection(db, res, actor, pcMatch[1]);

  // ============ Payment Disbursements ============
  if (pathname === "/api/payment-disbursements" && req.method === "GET") return listPaymentDisbursements(db, res, actor, url);
  if (pathname === "/api/payment-disbursements" && req.method === "POST") return createPaymentDisbursement(db, req, res, actor);
  const pdMatch = pathname.match(/^\/api\/payment-disbursements\/(.+)$/);
  if (pdMatch && req.method === "GET") return getPaymentDisbursement(db, res, actor, pdMatch[1]);



  // ============ BOM ============
  if (pathname === "/api/boms" && req.method === "GET") return listBoms(db, res, actor, url);
  if (pathname === "/api/boms" && req.method === "POST") return createBom(db, req, res, actor);
  const bomMatch = pathname.match(/^\/api\/boms\/(.+)$/);
  if (bomMatch && req.method === "GET") return getBom(db, res, actor, bomMatch[1]);
  if (bomMatch && req.method === "POST") return updateBom(db, req, res, actor, bomMatch[1]);

  // ============ Production Orders ============
  if (pathname === "/api/production-orders" && req.method === "GET") return listProductionOrders(db, res, actor, url);
  if (pathname === "/api/production-orders" && req.method === "POST") return createProductionOrder(db, req, res, actor);
  const mOatch = pathname.match(/^\/api\/production-orders\/(.+)$/);
  if (mOatch && req.method === "GET") return getProductionOrder(db, res, actor, mOatch[1]);
  if (mOatch && req.method === "POST") return changeProductionOrderState(db, req, res, actor, mOatch[1]);

  // ============ Cost Management ============
  if (pathname === '/api/product-costs/products' && req.method === 'GET') return listCostProducts(db, res, actor);
  if (pathname === '/api/product-costs' && req.method === 'GET') return listProductCosts(db, res, actor, url);
  if (pathname === '/api/product-costs' && req.method === 'POST') return createProductCost(db, req, res, actor);
  if (pathname === '/api/cost-rates' && req.method === 'GET') return listCostRates(db, res, actor);
  if (pathname === '/api/cost-rates' && req.method === 'POST') return createCostRate(db, req, res, actor);
  const costRateMatch = pathname.match(/^\/api\/cost-rates\/([^/]+)$/);
  if (costRateMatch && req.method === 'PATCH') return updateCostRate(db, req, res, actor, costRateMatch[1]);

  // ============ Project Management ============
  if (pathname === '/api/projects' && req.method === 'GET') return listProjects(db, res, actor, url);
  if (pathname === '/api/projects' && req.method === 'POST') return createProject(db, req, res, actor);
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && req.method === 'GET') return getProjectDetail(db, res, actor, projectMatch[1]);
  if (projectMatch && req.method === 'PATCH') return updateProject(db, req, res, actor, projectMatch[1]);
  if (pathname === '/api/project-tasks' && req.method === 'GET') return listProjectTasks(db, res, actor, url);
  if (pathname === '/api/project-tasks' && req.method === 'POST') return createProjectTask(db, req, res, actor);
  const projectTaskMatch = pathname.match(/^\/api\/project-tasks\/([^/]+)$/);
  if (projectTaskMatch && req.method === 'PATCH') return updateProjectTask(db, req, res, actor, projectTaskMatch[1]);
  if (pathname === '/api/timesheets' && req.method === 'GET') return listTimesheets(db, res, actor, url);
  if (pathname === '/api/timesheets' && req.method === 'POST') return createTimesheet(db, req, res, actor);
  const timesheetMatch = pathname.match(/^\/api\/timesheets\/([^/]+)$/);
  if (timesheetMatch && req.method === 'DELETE') return deleteTimesheet(db, req, res, actor, timesheetMatch[1]);

  // ============ Notifications and Workflows ============
  if (pathname === '/api/notifications' && req.method === 'GET') return listNotifications(db, res, actor);
  if (pathname === '/api/notifications/read' && req.method === 'POST') return markNotificationRead(db, req, res, actor);
  if (pathname === '/api/workflows' && req.method === 'GET') return listWorkflows(db, res, actor);
  if (pathname === '/api/workflows' && req.method === 'POST') return createWorkflow(db, req, res, actor);

  // ============ CRM ============
  if (pathname === '/api/contacts' && req.method === 'GET') return listContacts(db, res, actor, url);
  if (pathname === '/api/contacts' && req.method === 'POST') return createContact(db, req, res, actor);
  const contactMatch = pathname.match(/^\/api\/contacts\/([^/]+)$/);
  if (contactMatch && req.method === 'PATCH') return updateContact(db, req, res, actor, contactMatch[1]);
  if (contactMatch && req.method === 'DELETE') return deleteContact(db, req, res, actor, contactMatch[1]);
  if (pathname === '/api/customer-followups' && req.method === 'GET') return listFollowups(db, res, actor, url);
  if (pathname === '/api/customer-followups' && req.method === 'POST') return createFollowup(db, req, res, actor);
  const followupMatch = pathname.match(/^\/api\/customer-followups\/([^/]+)$/);
  if (followupMatch && req.method === 'PATCH') return updateFollowup(db, req, res, actor, followupMatch[1]);
  if (pathname === '/api/sales-activities' && req.method === 'GET') return listSalesActivities(db, res, actor, url);
  if (pathname === '/api/sales-activities' && req.method === 'POST') return createSalesActivity(db, req, res, actor);
  const salesActivityMatch = pathname.match(/^\/api\/sales-activities\/([^/]+)$/);
  if (salesActivityMatch && req.method === 'PATCH') return updateSalesActivity(db, req, res, actor, salesActivityMatch[1]);
  if (salesActivityMatch && req.method === 'DELETE') return deleteSalesActivity(db, req, res, actor, salesActivityMatch[1]);



  throw new HttpError(404, '接口不存在');
}

async function login(db, req, res) {
  const ip = getClientIp(req);
  const now = new Date();
  
  // Check if account is locked due to too many failed attempts
  const lockedAttempt = db.prepare(`
    SELECT * FROM login_attempts 
    WHERE username = ? AND success = 0 AND locked_until > ?
    ORDER BY updated_at DESC LIMIT 1
  `).get(req.body?.username || '', now.toISOString());
  
  if (lockedAttempt) {
    const remainingMinutes = Math.ceil((new Date(lockedAttempt.locked_until) - now) / 60000);
    return send(res, 429, { 
      error: '登录失败次数过多，请稍后再试',
      code: 'ACCOUNT_LOCKED',
      retryAfter: remainingMinutes
    });
  }
  
  const body = await readJson(req);
  const username = requiredText(body.username, '用户名', 50);
  const password = requiredText(body.password, '密码', 100);
  
  const row = db.prepare(`
    SELECT u.*, r.name role_name, r.code role_code FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.username=? COLLATE NOCASE
  `).get(username);
  
  if (!row || !row.active || !verifyPassword(password, row.password_salt, row.password_hash)) {
    // Record failed attempt
    const attemptId = id();
    const existingAttempt = db.prepare(`
      SELECT * FROM login_attempts 
      WHERE username = ? AND success = 0 AND locked_until IS NULL
      ORDER BY updated_at DESC LIMIT 1
    `).get(username);
    
    if (existingAttempt) {
      const newCount = existingAttempt.attempt_count + 1;
      if (newCount >= LOGIN_MAX_ATTEMPTS) {
        // Lock the account
        const lockUntil = new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000);
        db.prepare(`
          UPDATE login_attempts 
          SET attempt_count = ?, locked_until = ?, updated_at = ?
          WHERE id = ?
        `).run(newCount, lockUntil.toISOString(), now.toISOString(), existingAttempt.id);
        
        audit(db, null, 'LOGIN_LOCKED', 'AUTH', null, `账户 ${username} 因多次登录失败被锁定`);
        return send(res, 429, { 
          error: '登录失败次数过多，账户已锁定',
          code: 'ACCOUNT_LOCKED',
          retryAfter: LOGIN_LOCK_MINUTES * 60
        });
      }
      db.prepare(`
        UPDATE login_attempts 
        SET attempt_count = ?, ip_address = COALESCE(?, ip_address), updated_at = ?
        WHERE id = ?
      `).run(newCount, ip, now.toISOString(), existingAttempt.id);
    } else {
      db.prepare(`
        INSERT INTO login_attempts (id, username, ip_address, success, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, ?, ?)
      `).run(attemptId, username, ip, now.toISOString(), now.toISOString());
    }
    
    audit(db, row?.id, 'LOGIN_FAILED', 'AUTH', null, `用户 ${username} 登录失败 (IP: ${ip})`);
    return send(res, 401, { 
      error: '用户名或密码错误',
      code: 'INVALID_CREDENTIALS'
    });
  }
  
  // Record successful login
  const attemptId = id();
  db.prepare(`
    INSERT INTO login_attempts (id, username, ip_address, success, attempt_count, created_at, updated_at)
    VALUES (?, ?, ?, 1, 0, ?, ?)
  `).run(attemptId, username, ip, now.toISOString(), now.toISOString());
  
  // Generate token
  const token = randomBytes(TOKEN_LENGTH).toString('base64url');
  const tokenHash = sha256(token);
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  
  // Clean up expired sessions
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  
  // Create new session
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(tokenHash, row.id, expires.toISOString(), now.toISOString());
  
  audit(db, row.id, 'LOGIN', 'AUTH', null, `用户 ${username} 登录成功 (IP: ${ip})`);
  return send(res, 200, { 
    token, 
    user: actorFromRow(db, row),
    expiresAt: expires.toISOString(),
    sessionHours: SESSION_HOURS
  });
}

function logout(db, req, res) {
  const token = bearer(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
  return send(res, 204, null);
}


function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = req.headers['x-real-ip'];
  if (realIp) return realIp;
  return req.socket?.remoteAddress || '';
}
function authenticate(db, req) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, '请先登录');
  const row = db.prepare(`
    SELECT u.*, r.name role_name, r.code role_code
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1
  `).get(sha256(token), new Date().toISOString());
  if (!row) throw new HttpError(401, '登录已过期，请重新登录');
  return actorFromRow(db, row);
}

function actorFromRow(db, row) {
  const permissions = db.prepare('SELECT permission_code code FROM role_permissions WHERE role_id=? ORDER BY permission_code').all(row.role_id).map((item) => item.code);
  return { id: row.id, username: row.username, displayName: row.display_name, roleId: row.role_id, roleName: row.role_name, roleCode: row.role_code, permissions };
}

function dashboard(db, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const data = {
    customerCount: db.prepare('SELECT count(*) count FROM customers WHERE active=1').get().count,
    supplierCount: db.prepare('SELECT count(*) count FROM suppliers WHERE active=1').get().count,
    productCount: db.prepare('SELECT count(*) count FROM products WHERE active=1').get().count,
    orderCount: db.prepare('SELECT count(*) count FROM sales_orders').get().count,
    purchaseOrderCount: db.prepare('SELECT count(*) count FROM purchase_orders').get().count,
    pendingCount: db.prepare("SELECT count(*) count FROM sales_orders WHERE status='SUBMITTED'").get().count,
    pendingPurchaseCount: db.prepare("SELECT count(*) count FROM purchase_orders WHERE status='SUBMITTED'").get().count,
    approvedAmountCents: db.prepare("SELECT coalesce(sum(total_cents),0) total FROM sales_orders WHERE status='APPROVED'").get().total,
    recentOrders: orderRows(db, '', [], 'ORDER BY so.created_at DESC LIMIT 5'),
    recentPurchaseOrders: purchaseOrderRows(db, '', [], 'ORDER BY po.created_at DESC LIMIT 5')
  };
  return send(res, 200, data);
}

function listRoles(db, res, actor) {
  allowAny(actor, ['USERS_MANAGE', 'ROLES_MANAGE']);
  const roles = db.prepare(`
    SELECT r.*, count(DISTINCT u.id) user_count FROM roles r LEFT JOIN users u ON u.role_id=r.id
    GROUP BY r.id ORDER BY r.system_role DESC, r.name
  `).all().map((role) => ({ ...role, permissions: rolePermissions(db, role.id) }));
  return send(res, 200, { roles, permissions: PERMISSIONS.map(([code, name]) => ({ code, name })) });
}

async function createRole(db, req, res, actor) {
  allow(actor, 'ROLES_MANAGE');
  const body = await readJson(req);
  const role = {
    id: id(), code: requiredCode(body.code, '角色编码'), name: requiredText(body.name, '角色名称', 40),
    description: optionalText(body.description, 200), permissions: validPermissions(body.permissions)
  };
  transaction(db, () => {
    db.prepare('INSERT INTO roles(id,code,name,description,system_role,created_at) VALUES(?,?,?,?,0,?)')
      .run(role.id, role.code, role.name, role.description, new Date().toISOString());
    saveRolePermissions(db, role.id, role.permissions);
    audit(db, actor.id, 'CREATE', 'ROLE', role.id, role.name);
  });
  return send(res, 201, { id: role.id });
}

async function updateRole(db, req, res, actor, roleId) {
  allow(actor, 'ROLES_MANAGE');
  const current = db.prepare('SELECT * FROM roles WHERE id=?').get(roleId);
  if (!current) throw new HttpError(404, '角色不存在');
  const body = await readJson(req);
  const name = requiredText(body.name ?? current.name, '角色名称', 40);
  const description = optionalText(body.description ?? current.description, 200);
  const permissions = body.permissions ? validPermissions(body.permissions) : rolePermissions(db, roleId);
  if (current.code === 'ADMIN' && !PERMISSIONS.every(([code]) => permissions.includes(code))) throw new HttpError(400, '系统管理员必须保留全部权限');
  transaction(db, () => {
    db.prepare('UPDATE roles SET name=?,description=? WHERE id=?').run(name, description, roleId);
    saveRolePermissions(db, roleId, permissions);
    audit(db, actor.id, 'UPDATE', 'ROLE', roleId, name);
  });
  return send(res, 200, { ok: true });
}

function listUsers(db, res, actor) {
  allow(actor, 'USERS_MANAGE');
  const users = db.prepare(`
    SELECT u.id,u.username,u.display_name displayName,u.active,u.created_at createdAt,
           r.id roleId,r.name roleName,r.code roleCode
    FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.created_at
  `).all().map((user) => ({ ...user, active: Boolean(user.active) }));
  return send(res, 200, { users });
}

function listProjectManagerCandidates(db, res, actor) {
  allow(actor, 'PROJECT_MANAGE');
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name displayName, u.active
    FROM users u
    WHERE u.active = 1
    ORDER BY u.display_name, u.username
  `).all().map((user) => ({ ...user, active: Boolean(user.active) }));
  return send(res, 200, { users });
}

async function createUser(db, req, res, actor) {
  allow(actor, 'USERS_MANAGE');
  const body = await readJson(req);
  const username = requiredCode(body.username, '登录账号').toLowerCase();
  const displayName = requiredText(body.displayName, '用户姓名', 40);
  const passwordText = requiredText(body.password, '初始密码', 100);
  if (passwordText.length < 6) throw new HttpError(400, '密码至少需要 6 位');
  ensureRole(db, body.roleId);
  const password = hashPassword(passwordText);
  const userId = id();
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,password_salt,role_id,active,created_at) VALUES(?,?,?,?,?,?,1,?)`)
    .run(userId, username, displayName, password.hash, password.salt, body.roleId, new Date().toISOString());
  audit(db, actor.id, 'CREATE', 'USER', userId, username);
  return send(res, 201, { id: userId });
}

async function updateUser(db, req, res, actor, userId) {
  allow(actor, 'USERS_MANAGE');
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!current) throw new HttpError(404, '用户不存在');
  const body = await readJson(req);
  const displayName = requiredText(body.displayName ?? current.display_name, '用户姓名', 40);
  const roleId = body.roleId ?? current.role_id;
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  ensureRole(db, roleId);
  if (userId === actor.id && !active) throw new HttpError(400, '不能停用当前登录账号');
  transaction(db, () => {
    db.prepare('UPDATE users SET display_name=?,role_id=?,active=? WHERE id=?').run(displayName, roleId, active, userId);
    if (body.password) {
      if (String(body.password).length < 6) throw new HttpError(400, '密码至少需要 6 位');
      const password = hashPassword(String(body.password));
      db.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').run(password.hash, password.salt, userId);
      if (userId !== actor.id) db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    }
    audit(db, actor.id, 'UPDATE', 'USER', userId, displayName);
  });
  return send(res, 200, { ok: true });
}

function listSuppliers(db, res, actor, url) {
  allowAny(actor, ['SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const suppliers = db.prepare(`SELECT id,code,name,contact,phone,address,active,created_at createdAt,updated_at updatedAt
    FROM suppliers WHERE code LIKE ? OR name LIKE ? OR contact LIKE ? ORDER BY code`).all(search, search, search)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { suppliers });
}

async function createSupplier(db, req, res, actor) {
  allow(actor, 'SUPPLIERS_MANAGE');
  const body = await readJson(req);
  const supplier = supplierInput(body);
  const supplierId = id(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO suppliers(id,code,name,contact,phone,address,email,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)`)
    .run(supplierId, supplier.code, supplier.name, supplier.contact, supplier.phone, supplier.address, supplier.email, now, now);
  audit(db, actor.id, 'CREATE', 'SUPPLIER', supplierId, supplier.code);
  return send(res, 201, { id: supplierId });
}

async function updateSupplier(db, req, res, actor, supplierId) {
  allow(actor, 'SUPPLIERS_MANAGE');
  const current = db.prepare('SELECT * FROM suppliers WHERE id=?').get(supplierId);
  if (!current) throw new HttpError(404, '供应商不存在');
  const body = await readJson(req); const supplier = supplierInput({ ...current, ...body });
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  db.prepare('UPDATE suppliers SET code=?,name=?,contact=?,phone=?,address=?,email=?,active=?,updated_at=? WHERE id=?')
    .run(supplier.code, supplier.name, supplier.contact, supplier.phone, supplier.address, supplier.email, active, new Date().toISOString(), supplierId);
  audit(db, actor.id, 'UPDATE', 'SUPPLIER', supplierId, supplier.code);
  return send(res, 200, { ok: true });
}

function supplierInput(body) {
  return {
    code: requiredCode(body.code, '供应商编码'),
    name: requiredText(body.name, '供应商名称', 100),
    contact: optionalText(body.contact, 50),
    phone: optionalText(body.phone, 30),
    address: optionalText(body.address, 200),
    email: optionalText(body.email, 100)
  };
}

function listCustomers(db, res, actor, url) {
  allowAny(actor, ['CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const customers = db.prepare(`SELECT id,code,name,contact,phone,address,active,created_at createdAt,updated_at updatedAt
    FROM customers WHERE code LIKE ? OR name LIKE ? OR contact LIKE ? ORDER BY code`).all(search, search, search)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { customers });
}

async function createCustomer(db, req, res, actor) {
  allow(actor, 'CUSTOMERS_MANAGE');
  const body = await readJson(req);
  const customer = customerInput(body);
  const customerId = id(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO customers(id,code,name,contact,phone,address,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`)
    .run(customerId, customer.code, customer.name, customer.contact, customer.phone, customer.address, now, now);
  audit(db, actor.id, 'CREATE', 'CUSTOMER', customerId, customer.code);
  return send(res, 201, { id: customerId });
}

async function updateCustomer(db, req, res, actor, customerId) {
  allow(actor, 'CUSTOMERS_MANAGE');
  const current = db.prepare('SELECT * FROM customers WHERE id=?').get(customerId);
  if (!current) throw new HttpError(404, '客户不存在');
  const body = await readJson(req); const customer = customerInput({ ...current, ...body });
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  db.prepare('UPDATE customers SET code=?,name=?,contact=?,phone=?,address=?,active=?,updated_at=? WHERE id=?')
    .run(customer.code, customer.name, customer.contact, customer.phone, customer.address, active, new Date().toISOString(), customerId);
  audit(db, actor.id, 'UPDATE', 'CUSTOMER', customerId, customer.code);
  return send(res, 200, { ok: true });
}

function listProducts(db, res, actor, url) {
  allowAny(actor, ['PRODUCTS_VIEW', 'PRODUCTS_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const products = db.prepare(`SELECT id,code,name,unit,price_cents priceCents,stock_quantity stockQuantity,active,
    created_at createdAt,updated_at updatedAt FROM products WHERE code LIKE ? OR name LIKE ? ORDER BY code`).all(search, search)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { products });
}

async function createProduct(db, req, res, actor) {
  allow(actor, 'PRODUCTS_MANAGE');
  const body = await readJson(req); const product = productInput(body);
  const productId = id(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO products(id,code,name,unit,price_cents,stock_quantity,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`)
    .run(productId, product.code, product.name, product.unit, product.priceCents, product.stockQuantity, now, now);
  audit(db, actor.id, 'CREATE', 'PRODUCT', productId, product.code);
  return send(res, 201, { id: productId });
}

async function updateProduct(db, req, res, actor, productId) {
  allow(actor, 'PRODUCTS_MANAGE');
  const current = db.prepare('SELECT * FROM products WHERE id=?').get(productId);
  if (!current) throw new HttpError(404, '货品不存在');
  const body = await readJson(req);
  const product = productInput({ code: body.code ?? current.code, name: body.name ?? current.name, unit: body.unit ?? current.unit,
    priceCents: body.priceCents ?? current.price_cents, stockQuantity: body.stockQuantity ?? current.stock_quantity });
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  db.prepare('UPDATE products SET code=?,name=?,unit=?,price_cents=?,stock_quantity=?,active=?,updated_at=? WHERE id=?')
    .run(product.code, product.name, product.unit, product.priceCents, product.stockQuantity, active, new Date().toISOString(), productId);
  audit(db, actor.id, 'UPDATE', 'PRODUCT', productId, product.code);
  return send(res, 200, { ok: true });
}

function listOrders(db, res, actor, url) {
  allow(actor, 'ORDERS_VIEW');
  const where = []; const params = [];
  const status = url.searchParams.get('status');
  if (status && STATUS_LABELS[status]) { where.push('so.status=?'); params.push(status); }
  const search = url.searchParams.get('search')?.trim();
  if (search) { where.push('(so.order_no LIKE ? OR c.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  return send(res, 200, { orders: orderRows(db, where.length ? `WHERE ${where.join(' AND ')}` : '', params, 'ORDER BY so.created_at DESC') });
}

function getOrder(db, res, actor, orderId) {
  allow(actor, 'ORDERS_VIEW');
  const order = orderRows(db, 'WHERE so.id=?', [orderId], '')[0];
  if (!order) throw new HttpError(404, '销售订单不存在');
  order.items = db.prepare(`SELECT i.id,i.product_id productId,p.code productCode,p.name productName,p.unit,
    i.quantity,i.unit_price_cents unitPriceCents,i.amount_cents amountCents,i.line_no lineNo
    FROM sales_order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.line_no`).all(orderId);
  order.history = db.prepare(`SELECT l.action,l.detail,l.created_at createdAt,u.display_name userName
    FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.entity_type='SALES_ORDER' AND l.entity_id=? ORDER BY l.created_at`).all(orderId);
  return send(res, 200, { order });
}

async function createOrder(db, req, res, actor) {
  allow(actor, 'ORDERS_CREATE');
  const body = await readJson(req); const input = orderInput(db, body);
  const orderId = id(); const now = new Date().toISOString(); const orderNo = makeOrderNo();
  transaction(db, () => {
    db.prepare(`INSERT INTO sales_orders(id,order_no,customer_id,status,total_cents,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,'DRAFT',?,?,?,?,?)`).run(orderId, orderNo, input.customerId, input.totalCents, input.remark, actor.id, now, now);
    saveOrderItems(db, orderId, input.items);
    audit(db, actor.id, 'CREATE', 'SALES_ORDER', orderId, `创建订单 ${orderNo}`);
  });
  return send(res, 201, { id: orderId, orderNo });
}

async function updateOrder(db, req, res, actor, orderId) {
  allow(actor, 'ORDERS_CREATE');
  const current = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId);
  if (!current) throw new HttpError(404, '销售订单不存在');
  if (!['DRAFT', 'REJECTED'].includes(current.status)) throw new HttpError(409, '只有草稿或已驳回订单可以修改');
  if (current.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能修改自己创建的订单');
  const body = await readJson(req); const input = orderInput(db, body); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE sales_orders SET customer_id=?,total_cents=?,remark=?,status='DRAFT',rejection_reason='',updated_at=? WHERE id=?")
      .run(input.customerId, input.totalCents, input.remark, now, orderId);
    db.prepare('DELETE FROM sales_order_items WHERE order_id=?').run(orderId);
    saveOrderItems(db, orderId, input.items);
    audit(db, actor.id, 'UPDATE', 'SALES_ORDER', orderId, `修改订单 ${current.order_no}`);
  });
  return send(res, 200, { ok: true });
}


function generateVoucher(db, sourceType, sourceId, entries, actor, voucherDate = new Date().toISOString().slice(0, 10)) {
  checkPeriodNotClosedForVoucher(db, voucherDate, '生成业务');
  if (!Array.isArray(entries) || entries.length < 2) throw new HttpError(400, '凭证分录不完整');
  let debitTotal = 0;
  let creditTotal = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) throw new HttpError(400, '凭证金额必须大于 0');
    if (entry.direction === 'DEBIT') debitTotal += entry.amountCents;
    else if (entry.direction === 'CREDIT') creditTotal += entry.amountCents;
    else throw new HttpError(400, '凭证方向不正确');
  }
  if (!Number.isSafeInteger(debitTotal) || debitTotal !== creditTotal) throw new HttpError(400, '凭证借贷不平衡');
  const voucherId = id();
  const now = new Date().toISOString();
  const voucherNo = makeVoucherNo();
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(voucherId, voucherNo, sourceType, sourceId, voucherDate, '', actor.id, now);
  const stmt = db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)');
  for (const e of entries) stmt.run(id(), voucherId, e.subjectId, e.direction, e.amountCents, e.summary || '');
  return voucherId;
}

async function changeOrderState(db, req, res, actor, orderId, action) {
  const order = db.prepare('SELECT * FROM sales_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '销售订单不存在');
  const now = new Date().toISOString();
  if (action === 'submit') {
    allow(actor, 'ORDERS_SUBMIT');
    if (!['DRAFT', 'REJECTED'].includes(order.status)) throw new HttpError(409, '只有草稿或已驳回订单可以提交');
    if (order.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能提交自己创建的订单');
    db.prepare("UPDATE sales_orders SET status='SUBMITTED',submitted_at=?,rejection_reason='',updated_at=? WHERE id=?").run(now, now, orderId);
    audit(db, actor.id, 'SUBMIT', 'SALES_ORDER', orderId, `提交订单 ${order.order_no}`);
  } else {
    allow(actor, 'ORDERS_APPROVE');
    if (order.status !== 'SUBMITTED') throw new HttpError(409, '只有待审核订单可以处理');
    if (order.creator_id === actor.id) throw new HttpError(409, '创建人不能审核自己的订单');
    if (action === 'approve') {
      db.prepare("UPDATE sales_orders SET status='APPROVED',reviewer_id=?,reviewed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, orderId);
      audit(db, actor.id, 'APPROVE', 'SALES_ORDER', orderId, `审核通过 ${order.order_no}`);
      // Revenue is recognized once, when the related sales delivery is confirmed.
    } else {
      const body = await readJson(req); const reason = requiredText(body.reason, '驳回原因', 200);
      db.prepare("UPDATE sales_orders SET status='REJECTED',reviewer_id=?,reviewed_at=?,rejection_reason=?,updated_at=? WHERE id=?")
        .run(actor.id, now, reason, now, orderId);
      audit(db, actor.id, 'REJECT', 'SALES_ORDER', orderId, reason);
    }
  }
  return send(res, 200, { ok: true });
}

function orderRows(db, where, params, tail) {
  return db.prepare(`SELECT so.id,so.order_no orderNo,so.status,so.total_cents totalCents,so.remark,
      so.rejection_reason rejectionReason,so.created_at createdAt,so.updated_at updatedAt,so.submitted_at submittedAt,
      so.reviewed_at reviewedAt,c.id customerId,c.code customerCode,c.name customerName,
      creator.display_name creatorName,reviewer.display_name reviewerName,
      (SELECT count(*) FROM sales_order_items i WHERE i.order_id=so.id) itemCount
    FROM sales_orders so JOIN customers c ON c.id=so.customer_id
    JOIN users creator ON creator.id=so.creator_id LEFT JOIN users reviewer ON reviewer.id=so.reviewer_id
    ${where} ${tail}`).all(...params).map((row) => ({ ...row, statusLabel: STATUS_LABELS[row.status] }));
}

function orderInput(db, body) {
  const customerId = requiredText(body.customerId, '客户', 100);
  const customer = db.prepare('SELECT id FROM customers WHERE id=? AND active=1').get(customerId);
  if (!customer) throw new HttpError(400, '客户不存在或已停用');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '销售订单至少需要一条明细');
  const items = body.items.map((item, index) => {
    const product = db.prepare('SELECT id,price_cents FROM products WHERE id=? AND active=1').get(item.productId);
    if (!product) throw new HttpError(400, `第 ${index + 1} 行货品不存在或已停用`);
    const quantity = Number(item.quantity); const unitPriceCents = Number(item.unitPriceCents ?? product.price_cents);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, `第 ${index + 1} 行数量必须大于 0`);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new HttpError(400, `第 ${index + 1} 行单价不正确`);
    return { id: id(), productId: product.id, quantity, unitPriceCents, amountCents: Math.round(quantity * unitPriceCents), lineNo: index + 1 };
  });
  return { customerId, remark: optionalText(body.remark, 500), items, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0) };
}

function saveOrderItems(db, orderId, items) {
  const statement = db.prepare(`INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)`);
  for (const item of items) statement.run(item.id, orderId, item.productId, item.quantity, item.unitPriceCents, item.amountCents, item.lineNo);
}

function customerInput(body) {
  return { code: requiredCode(body.code, '客户编码'), name: requiredText(body.name, '客户名称', 100),
    contact: optionalText(body.contact, 50), phone: optionalText(body.phone, 30), address: optionalText(body.address, 200) };
}

function productInput(body) {
  const priceCents = Number(body.priceCents); const stockQuantity = Number(body.stockQuantity ?? 0);
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) throw new HttpError(400, '销售单价必须是非负金额');
  if (!Number.isFinite(stockQuantity) || stockQuantity < 0) throw new HttpError(400, '库存数量不能小于 0');
  return { code: requiredCode(body.code, '货品编码'), name: requiredText(body.name, '货品名称', 100),
    unit: requiredText(body.unit, '单位', 10), priceCents, stockQuantity };
}

function rolePermissions(db, roleId) {
  return db.prepare('SELECT permission_code code FROM role_permissions WHERE role_id=? ORDER BY permission_code').all(roleId).map((row) => row.code);
}

function saveRolePermissions(db, roleId, permissions) {
  db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId);
  const insert = db.prepare('INSERT INTO role_permissions(role_id, permission_code) VALUES(?,?)');
  for (const permission of permissions) insert.run(roleId, permission);
}

function validPermissions(value) {
  if (!Array.isArray(value)) throw new HttpError(400, '权限列表格式不正确');
  const valid = new Set(PERMISSIONS.map(([code]) => code));
  const result = [...new Set(value.map(String))];
  if (result.some((permission) => !valid.has(permission))) throw new HttpError(400, '包含未知权限');
  return result;
}

function ensureRole(db, roleId) {
  if (!db.prepare('SELECT id FROM roles WHERE id=?').get(roleId)) throw new HttpError(400, '角色不存在');
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function makeVoucherNo() { const now = new Date(); return `VCH-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random()*90+10)}`; }

function makeInventoryTransferNo() { const now = new Date(); return `IT-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random()*90+10)}`; }

function makeInventoryCheckNo() { const now = new Date(); return `IC-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random()*90+10)}`; }

function makePurchaseOrderNo() { const now = new Date(); return `PO-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`; }

function makeOrderNo() { const now = new Date(); return `SO-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`; }

// ============ Purchase Orders ============

function listPurchaseOrders(db, res, actor, url) {
  allow(actor, 'PURCHASE_ORDERS_VIEW');
  const where = []; const params = [];
  const status = url.searchParams.get('status');
  if (status && PURCHASE_STATUS_LABELS[status]) { where.push('po.status=?'); params.push(status); }
  const search = url.searchParams.get('search')?.trim();
  if (search) { where.push('(po.order_no LIKE ? OR s.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  return send(res, 200, { purchaseOrders: purchaseOrderRows(db, where.length ? `WHERE ${where.join(' AND ')}` : '', params, 'ORDER BY po.created_at DESC') });
}

function getPurchaseOrder(db, res, actor, orderId) {
  allow(actor, 'PURCHASE_ORDERS_VIEW');
  const order = purchaseOrderRows(db, 'WHERE po.id=?', [orderId], '')[0];
  if (!order) throw new HttpError(404, '采购订单不存在');
  order.items = db.prepare(`SELECT i.id,i.product_id productId,p.code productCode,p.name productName,p.unit,
    i.quantity,i.unit_price_cents unitPriceCents,i.amount_cents amountCents,i.line_no lineNo
    FROM purchase_order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.line_no`).all(orderId);
  order.history = db.prepare(`SELECT l.action,l.detail,l.created_at createdAt,u.display_name userName
    FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.entity_type='PURCHASE_ORDER' AND l.entity_id=? ORDER BY l.created_at`).all(orderId);
  return send(res, 200, { order });
}

async function createPurchaseOrder(db, req, res, actor) {
  allow(actor, 'PURCHASE_ORDERS_CREATE');
  const body = await readJson(req); const input = purchaseOrderInput(db, body);
  const orderId = id(); const now = new Date().toISOString(); const orderNo = makePurchaseOrderNo();
  transaction(db, () => {
    db.prepare(`INSERT INTO purchase_orders(id,order_no,supplier_id,status,total_cents,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,'DRAFT',?,?,?,?,?)`).run(orderId, orderNo, input.supplierId, input.totalCents, input.remark, actor.id, now, now);
    savePurchaseOrderItems(db, orderId, input.items);
    audit(db, actor.id, 'CREATE', 'PURCHASE_ORDER', orderId, `创建采购订单 ${orderNo}`);
  });
  return send(res, 201, { id: orderId, orderNo });
}

async function updatePurchaseOrder(db, req, res, actor, orderId) {
  allow(actor, 'PURCHASE_ORDERS_CREATE');
  const current = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!current) throw new HttpError(404, '采购订单不存在');
  if (!['DRAFT', 'REJECTED'].includes(current.status)) throw new HttpError(409, '只有草稿或已驳回订单可以修改');
  if (current.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能修改自己创建的订单');
  const body = await readJson(req); const input = purchaseOrderInput(db, body); const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("UPDATE purchase_orders SET supplier_id=?,total_cents=?,remark=?,status='DRAFT',rejection_reason='',updated_at=? WHERE id=?")
      .run(input.supplierId, input.totalCents, input.remark, now, orderId);
    db.prepare('DELETE FROM purchase_order_items WHERE order_id=?').run(orderId);
    savePurchaseOrderItems(db, orderId, input.items);
    audit(db, actor.id, 'UPDATE', 'PURCHASE_ORDER', orderId, `修改采购订单 ${current.order_no}`);
  });
  return send(res, 200, { ok: true });
}

async function changePurchaseOrderState(db, req, res, actor, orderId, action) {
  allow(actor, action === 'submit' ? 'PURCHASE_ORDERS_SUBMIT' : 'PURCHASE_ORDERS_APPROVE');
  const order = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '采购订单不存在');
  const now = new Date().toISOString();
  if (action === 'submit') {
    if (!['DRAFT', 'REJECTED'].includes(order.status)) throw new HttpError(409, '只有草稿或已驳回订单可以提交');
    if (order.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能提交自己创建的订单');
    db.prepare("UPDATE purchase_orders SET status='SUBMITTED',submitted_at=?,rejection_reason='',updated_at=? WHERE id=?").run(now, now, orderId);
    audit(db, actor.id, 'SUBMIT', 'PURCHASE_ORDER', orderId, `提交采购订单 ${order.order_no}`);
  } else if (action === 'approve') {
    if (order.status !== 'SUBMITTED') throw new HttpError(409, '只有待审核订单可以处理');
    if (order.creator_id === actor.id) throw new HttpError(409, '创建人不能审核自己的订单');
    db.prepare("UPDATE purchase_orders SET status='APPROVED',reviewer_id=?,reviewed_at=?,updated_at=? WHERE id=?").run(actor.id, now, now, orderId);
    audit(db, actor.id, 'APPROVE', 'PURCHASE_ORDER', orderId, `审核通过采购订单 ${order.order_no}`);
  } else {
    if (order.status !== 'SUBMITTED') throw new HttpError(409, '只有待审核订单可以处理');
    if (order.creator_id === actor.id) throw new HttpError(409, '创建人不能审核自己的订单');
    const body = await readJson(req); const reason = requiredText(body.reason, '驳回原因', 200);
    db.prepare("UPDATE purchase_orders SET status='REJECTED',reviewer_id=?,reviewed_at=?,rejection_reason=?,updated_at=? WHERE id=?")
      .run(actor.id, now, reason, now, orderId);
    audit(db, actor.id, 'REJECT', 'PURCHASE_ORDER', orderId, reason);
  }
  return send(res, 200, { ok: true });
}

function purchaseOrderRows(db, where, params, tail) {
  return db.prepare(`SELECT po.id,po.order_no orderNo,po.status,po.total_cents totalCents,po.remark,
      po.rejection_reason rejectionReason,po.created_at createdAt,po.updated_at updatedAt,po.submitted_at submittedAt,
      po.reviewed_at reviewedAt,s.id supplierId,s.code supplierCode,s.name supplierName,
      creator.display_name creatorName,reviewer.display_name reviewerName,
      (SELECT count(*) FROM purchase_order_items i WHERE i.order_id=po.id) itemCount
    FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id
    JOIN users creator ON creator.id=po.creator_id LEFT JOIN users reviewer ON reviewer.id=po.reviewer_id
    ${where} ${tail}`).all(...params).map((row) => ({ ...row, statusLabel: PURCHASE_STATUS_LABELS[row.status] }));
}

function purchaseOrderInput(db, body) {
  const supplierId = requiredText(body.supplierId, '供应商', 100);
  const supplier = db.prepare('SELECT id FROM suppliers WHERE id=? AND active=1').get(supplierId);
  if (!supplier) throw new HttpError(400, '供应商不存在或已停用');
  if (!Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, '采购订单至少需要一条明细');
  const items = body.items.map((item, index) => {
    const product = db.prepare('SELECT id,price_cents FROM products WHERE id=? AND active=1').get(item.productId);
    if (!product) throw new HttpError(400, `第 ${index + 1} 行货品不存在或已停用`);
    const quantity = Number(item.quantity); const unitPriceCents = Number(item.unitPriceCents ?? product.price_cents);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, `第 ${index + 1} 行数量必须大于 0`);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new HttpError(400, `第 ${index + 1} 行单价不正确`);
    return { id: id(), productId: product.id, quantity, unitPriceCents, amountCents: Math.round(quantity * unitPriceCents), lineNo: index + 1 };
  });
  return { supplierId, remark: optionalText(body.remark, 500), items, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0) };
}

function savePurchaseOrderItems(db, orderId, items) {
  const statement = db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)`);
  for (const item of items) statement.run(item.id, orderId, item.productId, item.quantity, item.unitPriceCents, item.amountCents, item.lineNo);
}

// ============ Warehouses ============

function listWarehouses(db, res, actor, url) {
  allowAny(actor, ['WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE']);
  const search = `%${url.searchParams.get('search')?.trim() ?? ''}%`;
  const warehouses = db.prepare(`SELECT id,code,name,address,manager,active,created_at createdAt,updated_at updatedAt FROM warehouses WHERE code LIKE ? OR name LIKE ? ORDER BY code`).all(search, search).map((row) => ({ ...row, active: Boolean(row.active) }));
  return send(res, 200, { warehouses });
}

async function createWarehouse(db, req, res, actor) {
  allow(actor, 'WAREHOUSES_MANAGE');
  const body = await readJson(req);
  const warehouse = { id: id(), code: requiredCode(body.code, '仓库编码'), name: requiredText(body.name, '仓库名称', 100), address: optionalText(body.address, 200), manager: optionalText(body.manager, 50) };
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO warehouses(id,code,name,address,manager,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)`).run(warehouse.id, warehouse.code, warehouse.name, warehouse.address, warehouse.manager, now, now);
  audit(db, actor.id, 'CREATE', 'WAREHOUSE', warehouse.id, warehouse.code);
  return send(res, 201, { id: warehouse.id });
}

async function updateWarehouse(db, req, res, actor, warehouseId) {
  allow(actor, 'WAREHOUSES_MANAGE');
  const current = db.prepare('SELECT * FROM warehouses WHERE id=?').get(warehouseId);
  if (!current) throw new HttpError(404, '仓库不存在');
  const body = await readJson(req);
  const name = requiredText(body.name ?? current.name, '仓库名称', 100);
  const address = optionalText(body.address ?? current.address, 200);
  const manager = optionalText(body.manager ?? current.manager, 50);
  const active = body.active === undefined ? current.active : Boolean(body.active) ? 1 : 0;
  db.prepare('UPDATE warehouses SET name=?,address=?,manager=?,active=?,updated_at=? WHERE id=?').run(name, address, manager, active, new Date().toISOString(), warehouseId);
  audit(db, actor.id, 'UPDATE', 'WAREHOUSE', warehouseId, name);
  return send(res, 200, { ok: true });
}

// ============ Inventory ============

function listInventory(db, res, actor, url) {
  allow(actor, 'INVENTORY_VIEW');
  const where = []; const params = [];
  const warehouseId = url.searchParams.get('warehouse');
  const productId = url.searchParams.get('product');
  if (warehouseId) { where.push('i.warehouse_id=?'); params.push(warehouseId); }
  if (productId) { where.push('i.product_id=?'); params.push(productId); }
  const sql = `SELECT i.warehouse_id,i.product_id,i.quantity,i.updated_at,w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit
    FROM inventory i JOIN warehouses w ON w.id=i.warehouse_id JOIN products p ON p.id=i.product_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY w.code,p.code`;
  return send(res, 200, { inventory: db.prepare(sql).all(...params) });
}



// ============ 库存预警 ============

function getInventoryAlerts(db, res, actor) {
  allowAny(actor, ['INVENTORY_VIEW', 'PRODUCTS_VIEW', 'WAREHOUSES_VIEW']);
  
  // 查询库存不足的货品（低于最低库存或再订货点）
  // 首先获取所有有预警配置的货品
  const productsWithAlerts = db.prepare(`SELECT p.id, p.code, p.name, p.unit, p.reorder_point, p.min_stock, p.max_stock, p.lead_time_days,
    (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE product_id = p.id) as total_stock
    FROM products p WHERE p.active = 1 AND (p.reorder_point > 0 OR p.min_stock > 0)`).all();
  
  const alerts = productsWithAlerts.filter(p => 
    (p.reorder_point > 0 && p.total_stock < p.reorder_point) || 
    (p.min_stock > 0 && p.total_stock < p.min_stock)
  );
  
  const productsWithLowStock = productsWithAlerts.filter(p => p.min_stock > 0 && p.total_stock < p.min_stock);
  const productsToReorder = productsWithAlerts.filter(p => p.reorder_point > 0 && p.total_stock < p.reorder_point);
  const lowStockCount = { cnt: productsWithLowStock.length };
  const reorderCount = { cnt: productsToReorder.length };
  
  return send(res, 200, {
    alerts,
    summary: {
      lowStockCount: lowStockCount?.cnt || 0,
      reorderCount: reorderCount?.cnt || 0,
      totalAlerts: alerts.length
    }
  });
}

function getReorderList(db, res, actor) {
  allowAny(actor, ['INVENTORY_VIEW', 'PRODUCTS_VIEW']);
  
  // 计算建议采购数量
  // 建议采购量 = 最大库存 - 当前库存
  // 获取需要补货的产品
  const productsNeedingReorder = db.prepare(`SELECT p.id, p.code, p.name, p.unit, p.reorder_point, p.max_stock, p.lead_time_days, p.price_cents,
    (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE product_id = p.id) as current_stock
    FROM products p WHERE p.active = 1 AND p.reorder_point > 0`).all().filter(p => p.current_stock < p.reorder_point);
  
  const reorderItems = productsNeedingReorder.sort((a, b) => {
    const ratioA = a.reorder_point > 0 ? a.current_stock / a.reorder_point : 1;
    const ratioB = b.reorder_point > 0 ? b.current_stock / b.reorder_point : 1;
    return ratioA - ratioB;
  });
  
  // 计算建议采购量和预估金额
  const reorderList = reorderItems.map(item => {
    const suggestedQty = Math.max(0, (item.max_stock || item.reorder_point * 2) - item.current_stock);
    const estimatedCost = Math.round(suggestedQty * (item.price_cents || 0));
    return {
      ...item,
      current_stock: item.current_stock,
      reorder_point: item.reorder_point,
      suggested_qty: suggestedQty,
      estimated_cost_cents: estimatedCost,
      urgency: item.current_stock === 0 ? 'urgent' : item.current_stock < item.reorder_point * 0.5 ? 'high' : 'normal'
    };
  });
  
  const totalEstimatedCost = reorderList.reduce((s, i) => s + i.estimated_cost_cents, 0);
  
  return send(res, 200, {
    reorderList,
    summary: {
      itemCount: reorderList.length,
      totalEstimatedCost
    }
  });
}

// ============ MRP (物料需求计划) ============

async function explodeBOM(db, req, res, actor) {
  allowAny(actor, ['PRODUCTS_VIEW', 'PRODUCTION_ORDERS_VIEW', 'ORDERS_VIEW']);
  const body = await readJson(req);
  const { productId, quantity } = body;
  
  if (!productId || !quantity) throw new HttpError(400, '请提供产品ID和数量');
  
  const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(404, '产品不存在');
  
  const materials = [];
  
  function expand(productId, qty, level) {
    const boms = db.prepare("SELECT b.*, p.code, p.name, p.unit FROM bom_items b JOIN products p ON p.id = b.product_id WHERE b.bom_id IN (SELECT id FROM boms WHERE product_id=? AND status='ACTIVE')").all(productId);
    
    if (boms.length === 0) {
      const prod = db.prepare('SELECT code, name, unit FROM products WHERE id=?').get(productId);
      materials.push({ productId, code: prod?.code || '', name: prod?.name || '', unit: prod?.unit || '', requiredQty: qty, level });
      return;
    }
    
    for (const bom of boms) {
      const requiredQty = qty * bom.quantity * (1 + (bom.scrap_rate || 0));
      expand(bom.product_id, requiredQty, level + 1);
    }
  }
  
  expand(productId, Number(quantity), 0);
  
  const materialSummary = {};
  for (const mat of materials) {
    if (!materialSummary[mat.productId]) {
      materialSummary[mat.productId] = { ...mat, totalQty: 0 };
    }
    materialSummary[mat.productId].totalQty += mat.requiredQty;
  }
  
  const result = Object.values(materialSummary).map(mat => {
    const stock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE product_id=?').get(mat.productId)?.total || 0;
    const netDemand = Math.max(0, mat.totalQty - stock);
    return { ...mat, currentStock: stock, netDemand, shortage: stock < mat.totalQty };
  });
  
  return send(res, 200, { product: { id: product.id, code: product.code, name: product.name }, quantity: Number(quantity), materials: result });
}

async function calculateMRP(db, req, res, actor) {
  allowAny(actor, ['PRODUCTS_VIEW', 'PRODUCTION_ORDERS_VIEW', 'ORDERS_VIEW']);
  const body = await readJson(req);
  const { type, productId, quantity } = body;
  
  if (type === 'product' && productId && quantity) {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId);
    if (!product) throw new HttpError(404, '产品不存在');
    
    const bom = db.prepare("SELECT * FROM boms WHERE product_id=? AND status='ACTIVE' LIMIT 1").get(productId);
    if (!bom) {
      const stock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE product_id=?').get(productId)?.total || 0;
      const netDemand = Math.max(0, Number(quantity) - stock);
      return send(res, 200, {
        demand: { productId, code: product.code, name: product.name, quantity: Number(quantity) },
        stock,
        netDemand,
        suggestions: [{ type: 'purchase', productId, code: product.code, name: product.name, quantity: netDemand, urgency: stock === 0 ? 'urgent' : 'normal' }]
      });
    }
    
    const materials = [];
    
    function expand(bomProductId, qty) {
      const items = db.prepare('SELECT bi.*, p.code, p.name, p.unit, p.price_cents FROM bom_items bi JOIN products p ON p.id=bi.product_id WHERE bi.bom_id=?').all(bomProductId);
      for (const item of items) {
        const requiredQty = qty * item.quantity * (1 + (item.scrap_rate || 0));
        const subBom = db.prepare("SELECT id FROM boms WHERE product_id=? AND status='ACTIVE' LIMIT 1").get(item.product_id);
        if (!subBom) {
          materials.push({ productId: item.product_id, code: item.code, name: item.name, unit: item.unit, requiredQty, priceCents: item.price_cents });
        } else {
          expand(item.product_id, requiredQty);
        }
      }
    }
    
    expand(productId, Number(quantity));
    
    const materialMap = {};
    for (const mat of materials) {
      if (!materialMap[mat.productId]) materialMap[mat.productId] = { ...mat, totalQty: 0 };
      materialMap[mat.productId].totalQty += mat.requiredQty;
    }
    
    const suggestions = [];
    for (const mat of Object.values(materialMap)) {
      const stock = db.prepare('SELECT COALESCE(SUM(quantity), 0) as total FROM inventory WHERE product_id=?').get(mat.productId)?.total || 0;
      const netDemand = Math.max(0, mat.totalQty - stock);
      if (netDemand > 0) {
        suggestions.push({
          type: 'purchase', productId: mat.productId, code: mat.code, name: mat.name,
          quantity: netDemand, unit: mat.unit, estimatedCost: Math.round(netDemand * (mat.priceCents || 0)),
          currentStock: stock, requiredQty: mat.totalQty,
          urgency: stock === 0 ? 'urgent' : stock < mat.totalQty * 0.3 ? 'high' : 'normal'
        });
      }
    }
    
    suggestions.sort((a, b) => {
      const priority = { urgent: 0, high: 1, normal: 2 };
      return priority[a.urgency] - priority[b.urgency];
    });
    
    const totalCost = suggestions.reduce((s, sg) => s + sg.estimatedCost, 0);
    
    return send(res, 200, {
      demand: { productId, code: product.code, name: product.name, quantity: Number(quantity) },
      materialsCount: suggestions.length, suggestions,
      summary: { totalItems: suggestions.length, urgentCount: suggestions.filter(s => s.urgency === 'urgent').length, highCount: suggestions.filter(s => s.urgency === 'high').length, totalEstimatedCost: totalCost }
    });
  }
  
  throw new HttpError(400, '不支持的请求类型');
}



// ============ Inventory Checks ============

function listInventoryChecks(db, res, actor, url) {
  allow(actor, 'INVENTORY_VIEW');
  const where = []; const params = [];
  const status = url.searchParams.get('status');
  if (status && INVENTORY_CHECK_STATUS[status]) { where.push('ic.status=?'); params.push(status); }
  const sql = `SELECT ic.*,w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit,
    creator.display_name creatorName,reviewer.display_name reviewerName
    FROM inventory_checks ic
    JOIN warehouses w ON w.id=ic.warehouse_id JOIN products p ON p.id=ic.product_id
    JOIN users creator ON creator.id=ic.creator_id LEFT JOIN users reviewer ON reviewer.id=ic.reviewer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ic.created_at DESC`;
  const checks = db.prepare(sql).all(...params).map((row) => ({ ...row, statusLabel: INVENTORY_CHECK_STATUS[row.status] }));
  return send(res, 200, { inventoryChecks: checks });
}

async function createInventoryCheck(db, req, res, actor) {
  allow(actor, 'INVENTORY_CHECK_CREATE');
  const body = await readJson(req);
  const { warehouseId, productId, actualQuantity, reason } = body;
  requireActiveReference(db, 'warehouses', warehouseId, '仓库');
  if (!productId || !db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(productId)) throw new HttpError(400, '请选择有效货品');
  if (actualQuantity === undefined || actualQuantity === null) throw new HttpError(400, '请填写实际盘点数量');
  const counted = Number(actualQuantity);
  if (!Number.isFinite(counted) || counted < 0) throw new HttpError(400, '实际盘点数量不正确');
  const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId);
  if (!inv) throw new HttpError(400, '该仓库没有此货品的库存记录');
  const systemQuantity = inv.quantity;
  const difference = counted - systemQuantity;
  const checkId = id(); const now = new Date().toISOString(); const checkNo = makeInventoryCheckNo();
  db.prepare(`INSERT INTO inventory_checks(id,check_no,warehouse_id,product_id,system_quantity,actual_quantity,difference,reason,status,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,\'DRAFT\',?,?)`).run(checkId, checkNo, warehouseId, productId, systemQuantity, counted, difference, optionalText(reason, 200), actor.id, now);
  audit(db, actor.id, 'CREATE', 'INVENTORY_CHECK', checkId, `盘点差异: ${difference}`);
  return send(res, 201, { id: checkId, checkNo, status: 'DRAFT' });
}

async function approveInventoryCheck(db, req, res, actor, checkId) {
  const check = db.prepare('SELECT * FROM inventory_checks WHERE id=?').get(checkId);
  if (!check) throw new HttpError(404, '盘点单不存在');
  const body = await readJson(req);
  const action = String(body.action || '').toUpperCase();
  const now = new Date().toISOString();
  if (action === 'UPDATE') {
    allow(actor, 'INVENTORY_CHECK_CREATE');
    if (check.status !== 'DRAFT') throw new HttpError(409, '只有草稿盘点单可以修改');
    if (check.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能修改自己创建的盘点单');
    requireActiveReference(db, 'warehouses', body.warehouseId, '仓库');
    if (!body.productId || !db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(body.productId)) throw new HttpError(400, '请选择有效货品');
    const actualQuantity = Number(body.actualQuantity);
    if (!Number.isFinite(actualQuantity) || actualQuantity < 0) throw new HttpError(400, '实际盘点数量不正确');
    const inventory = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(body.warehouseId, body.productId);
    if (!inventory) throw new HttpError(400, '该仓库没有此货品的库存记录');
    db.prepare('UPDATE inventory_checks SET warehouse_id=?,product_id=?,system_quantity=?,actual_quantity=?,difference=?,reason=? WHERE id=?')
      .run(body.warehouseId, body.productId, inventory.quantity, actualQuantity, actualQuantity - inventory.quantity, optionalText(body.reason, 200), checkId);
    audit(db, actor.id, 'UPDATE', 'INVENTORY_CHECK', checkId, '修改盘点单 ' + check.check_no);
  } else if (action === 'SUBMIT') {
    allow(actor, 'INVENTORY_CHECK_CREATE');
    if (check.status !== 'DRAFT') throw new HttpError(409, '只有草稿盘点单可以提交');
    if (check.creator_id !== actor.id && actor.roleCode !== 'ADMIN') throw new HttpError(403, '只能提交自己创建的盘点单');
    db.prepare("UPDATE inventory_checks SET status='SUBMITTED',checked_at=? WHERE id=?").run(now, checkId);
    audit(db, actor.id, 'SUBMIT', 'INVENTORY_CHECK', checkId, '提交盘点单 ' + check.check_no);
  } else if (action === 'APPROVE') {
    allow(actor, 'INVENTORY_CHECK_APPROVE');
    if (check.status !== 'SUBMITTED') throw new HttpError(409, '只有已提交盘点单可以审批');
    if (check.creator_id === actor.id) throw new HttpError(409, '盘点单创建人不能审批自己的单据');
    transaction(db, () => {
      const current = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(check.warehouse_id, check.product_id);
      if (!current) throw new HttpError(409, '库存记录不存在');
      if (current.quantity !== check.system_quantity) throw new HttpError(409, '库存已变化，请重新盘点');
      db.prepare("UPDATE inventory_checks SET status='APPROVED',reviewer_id=?,reviewed_at=? WHERE id=?").run(actor.id, now, checkId);
      db.prepare('UPDATE inventory SET quantity=?,updated_at=? WHERE warehouse_id=? AND product_id=?').run(check.actual_quantity, now, check.warehouse_id, check.product_id);
      if (check.difference !== 0) db.prepare("INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,'INVENTORY_CHECK',?,?,?,?,?)")
        .run(id(), check.warehouse_id, check.product_id, Math.abs(check.difference), check.difference > 0 ? 'IN' : 'OUT', check.actual_quantity, checkId, check.check_no, '盘点调整', actor.id, now);
      audit(db, actor.id, 'APPROVE', 'INVENTORY_CHECK', checkId, `审核通过，库存调整为 ${check.actual_quantity}`);
    });
  } else throw new HttpError(400, '无效操作');
  return send(res, 200, { ok: true });
}

// ============ Inventory Transfers ============

// Status labels for inventory transfers. Runtime accepts
// DRAFT / SUBMITTED / APPROVED (legacy CHECK) and
// TRANSFERRED / CANCELLED (post-fix CHECK after schema rebuild).
const INVENTORY_TRANSFER_STATUS = {
  DRAFT: '草稿',
  SUBMITTED: '待审核',
  APPROVED: '已审核',
  TRANSFERRED: '已调拨',
  CANCELLED: '已取消',
};

function listInventoryTransfers(db, res, actor, url) {
  allow(actor, 'INVENTORY_VIEW');
  const where = []; const params = [];
  const status = url.searchParams.get('status');
  if (status && INVENTORY_TRANSFER_STATUS[status]) { where.push('it.status=?'); params.push(status); }
  const sql = `SELECT it.*,fw.code fromWarehouseCode,fw.name fromWarehouseName,tw.code toWarehouseCode,tw.name toWarehouseName,
    creator.display_name creatorName,reviewer.display_name reviewerName,
    (SELECT count(*) FROM inventory_transfer_items WHERE transfer_id=it.id) itemCount
    FROM inventory_transfers it
    JOIN warehouses fw ON fw.id=it.from_warehouse_id JOIN warehouses tw ON tw.id=it.to_warehouse_id
    JOIN users creator ON creator.id=it.creator_id LEFT JOIN users reviewer ON reviewer.id=it.reviewer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY it.created_at DESC`;
  const transfers = db.prepare(sql).all(...params).map((row) => ({ ...row, statusLabel: INVENTORY_TRANSFER_STATUS[row.status] }));
  return send(res, 200, { inventoryTransfers: transfers });
}

function validateWarehouseItems(db, items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加明细');
  for (const item of items) {
    const quantity = Number(item?.quantity);
    if (!item?.productId || !db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(item.productId)) throw new HttpError(400, '请选择有效货品');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new HttpError(400, '数量必须大于 0');
  }
}

function normalizeWarehouseItems(db, items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加明细');
  let totalCents = 0;
  const normalized = items.map((item, index) => {
    const quantity = Number(item?.quantity);
    if (!item.productId || !db.prepare('SELECT 1 FROM products WHERE id=? AND active=1').get(item.productId)) {
      throw new HttpError(400, `第 ${index + 1} 行请选择有效货品`);
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new HttpError(400, `第 ${index + 1} 行数量必须为正整数`);
    if (item.unitPriceCents === undefined || item.unitPriceCents === null || item.unitPriceCents === '') throw new HttpError(400, `第 ${index + 1} 行请填写单价`);
    const unitPriceCents = Number(item.unitPriceCents);
    if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) throw new HttpError(400, `第 ${index + 1} 行单价必须为正整数分`);
    const amountCents = quantity * unitPriceCents;
    if (!Number.isSafeInteger(amountCents)) throw new HttpError(400, `第 ${index + 1} 行金额超出安全范围`);
    totalCents += amountCents;
    if (!Number.isSafeInteger(totalCents)) throw new HttpError(400, '单据金额超出安全范围');
    return { productId: item.productId, quantity, unitPriceCents, amountCents, lineNo: index + 1 };
  });
  return { items: normalized, totalCents };
}

function requireActiveReference(db, table, referenceId, label) {
  if (!referenceId || !db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND active=1`).get(referenceId)) throw new HttpError(400, `请选择有效${label}`);
}

function normalizeDocumentDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) throw new HttpError(400, `${label}不正确`);
  return value;
}

function replaceLogisticsItems(db, table, foreignKey, documentId, items) {
  db.prepare(`DELETE FROM ${table} WHERE ${foreignKey}=?`).run(documentId);
  const statement = db.prepare(`INSERT INTO ${table}(id,${foreignKey},product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)`);
  for (const item of items) statement.run(id(), documentId, item.productId, item.quantity, item.unitPriceCents, item.amountCents, item.lineNo);
}

function authoritativeLogisticsTotal(db, table, foreignKey, documentId) {
  const items = db.prepare(`SELECT * FROM ${table} WHERE ${foreignKey}=? ORDER BY line_no`).all(documentId);
  if (!items.length) throw new HttpError(409, '单据没有明细，无法确认');
  let totalCents = 0;
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPriceCents = Number(item.unit_price_cents);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) throw new HttpError(409, '单据明细数量或单价不正确');
    const amountCents = quantity * unitPriceCents;
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new HttpError(409, '单据明细金额不正确');
    if (item.amount_cents !== amountCents) db.prepare(`UPDATE ${table} SET amount_cents=? WHERE id=?`).run(amountCents, item.id);
    totalCents += amountCents;
    if (!Number.isSafeInteger(totalCents)) throw new HttpError(409, '单据金额超出安全范围');
  }
  return { items, totalCents };
}

function adjustInventory(db, warehouseId, productId, quantityChange, now) {
  db.prepare(`INSERT INTO inventory(id,warehouse_id,product_id,quantity,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(warehouse_id,product_id) DO UPDATE SET
      quantity=inventory.quantity+excluded.quantity,
      updated_at=excluded.updated_at`).run(id(), warehouseId, productId, quantityChange, now);
  return db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId).quantity;
}

async function createInventoryTransfer(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CREATE');
  const body = await readJson(req);
  const { fromWarehouseId, toWarehouseId, remark, items } = body;
  if (!fromWarehouseId) throw new HttpError(400, '请选择源仓库');
  if (!toWarehouseId) throw new HttpError(400, '请选择目标仓库');
  if (fromWarehouseId === toWarehouseId) throw new HttpError(400, '源仓库和目标仓库不能相同');
  validateWarehouseItems(db, items);
  // Validate stock
  for (const item of items) {
    const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(fromWarehouseId, item.productId);
    if (!inv || inv.quantity < Number(item.quantity)) {
      const product = db.prepare('SELECT code,name FROM products WHERE id=?').get(item.productId);
      throw new HttpError(400, `${product?.code ?? item.productId} 库存不足`);
    }
  }
  const transferId = id(); const now = new Date().toISOString(); const transferNo = makeInventoryTransferNo();
  transaction(db, () => {
    db.prepare(`INSERT INTO inventory_transfers(id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at)
      VALUES(?,?,?,?,'DRAFT',?,?,?,?)`).run(transferId, transferNo, fromWarehouseId, toWarehouseId, optionalText(remark, 200), actor.id, now, now);
    const stmt = db.prepare('INSERT INTO inventory_transfer_items(id,transfer_id,product_id,quantity) VALUES(?,?,?,?)');
    for (const item of items) stmt.run(id(), transferId, item.productId, Number(item.quantity));
    audit(db, actor.id, 'CREATE', 'INVENTORY_TRANSFER', transferId, `创建调拨单 ${transferNo}`);
  });
  return send(res, 201, { id: transferId, transferNo });
}

function getInventoryTransfer(db, res, actor, transferId) {
  allow(actor, 'INVENTORY_VIEW');
  const transfer = db.prepare(`SELECT it.*,fw.code fromWarehouseCode,fw.name fromWarehouseName,tw.code toWarehouseCode,tw.name toWarehouseName,
    creator.display_name creatorName,reviewer.display_name reviewerName
    FROM inventory_transfers it
    JOIN warehouses fw ON fw.id=it.from_warehouse_id JOIN warehouses tw ON tw.id=it.to_warehouse_id
    JOIN users creator ON creator.id=it.creator_id LEFT JOIN users reviewer ON reviewer.id=it.reviewer_id
    WHERE it.id=?`).get(transferId);
  if (!transfer) throw new HttpError(404, '调拨单不存在');
  transfer.items = db.prepare(`SELECT ti.*,p.code productCode,p.name productName,p.unit
    FROM inventory_transfer_items ti JOIN products p ON p.id=ti.product_id WHERE ti.transfer_id=?`).all(transferId);
  transfer.statusLabel = INVENTORY_TRANSFER_STATUS[transfer.status];
  return send(res, 200, { transfer });
}

async function changeInventoryTransferState(db, req, res, actor, transferId, action) {
  allow(actor, 'INVENTORY_TRANSFER_APPROVE');
  const transfer = db.prepare('SELECT * FROM inventory_transfers WHERE id=?').get(transferId);
  if (!transfer) throw new HttpError(404, '调拨单不存在');
  const now = new Date().toISOString();
  if (action === 'transfer') {
    if (transfer.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的调拨单可以确认');
    const items = db.prepare('SELECT * FROM inventory_transfer_items WHERE transfer_id=?').all(transferId);
    transaction(db, () => {
      for (const item of items) {
        const source = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(transfer.from_warehouse_id, item.product_id);
        if (!source || source.quantity < item.quantity) throw new HttpError(400, '源仓库库存不足');
        const sourceBalance = adjustInventory(db, transfer.from_warehouse_id, item.product_id, -item.quantity, now);
        const targetBalance = adjustInventory(db, transfer.to_warehouse_id, item.product_id, item.quantity, now);
        const insertTransaction = db.prepare(`INSERT INTO inventory_transactions
          (id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
        insertTransaction.run(id(), transfer.from_warehouse_id, item.product_id, item.quantity, 'OUT', sourceBalance, 'INVENTORY_TRANSFER', transferId, transfer.transfer_no, '库存调拨出库', actor.id, now);
        insertTransaction.run(id(), transfer.to_warehouse_id, item.product_id, item.quantity, 'IN', targetBalance, 'INVENTORY_TRANSFER', transferId, transfer.transfer_no, '库存调拨入库', actor.id, now);
      }
      db.prepare("UPDATE inventory_transfers SET status='TRANSFERRED',reviewer_id=?,updated_at=? WHERE id=?").run(actor.id, now, transferId);
      audit(db, actor.id, 'TRANSFER', 'INVENTORY_TRANSFER', transferId, `确认调拨 ${transfer.transfer_no}`);
      // Generate accounting voucher for inventory transfer
      const totalAmt = items.reduce((s, i) => { const inv = db.prepare('SELECT price_cents FROM products WHERE id=?').get(i.product_id); return s + Math.round(i.quantity * (inv?.price_cents || 0)); }, 0);
      const entries3 = [
        { subjectId: 'subject-004', direction: 'DEBIT', amountCents: totalAmt, summary: `调拨入库 ${transfer.transfer_no}` },
        { subjectId: 'subject-004', direction: 'CREDIT', amountCents: totalAmt, summary: `调拨出库 ${transfer.transfer_no}` }
      ];
      generateVoucher(db, 'INVENTORY_TRANSFER', transferId, entries3, actor);
    });
  } else if (action === 'cancel') {
    if (transfer.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态的调拨单可以取消');
    db.prepare("UPDATE inventory_transfers SET status='CANCELLED',reviewer_id=?,updated_at=? WHERE id=?").run(actor.id, now, transferId);
    audit(db, actor.id, 'CANCEL', 'INVENTORY_TRANSFER', transferId, `取消调拨 ${transfer.transfer_no}`);
  } else throw new HttpError(400, '无效操作');
  return send(res, 200, { ok: true });
}



// ============ Accounting ============

function listAccountingSubjects(db, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const subjects = db.prepare('SELECT id,code,name,type,direction,parent_id,active FROM accounting_subjects WHERE active=1 ORDER BY code').all();
  return send(res, 200, { subjects });
}

function listAccountingVouchers(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const where = []; const params = [];
  const sourceType = url.searchParams.get('source_type');
  if (sourceType) { where.push('av.source_type=?'); params.push(sourceType); }
  const sql = `SELECT av.*, u.display_name creatorName
    FROM accounting_vouchers av JOIN users u ON u.id=av.creator_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY av.created_at DESC LIMIT 100`;
  const vouchers = db.prepare(sql).all(...params);
  return send(res, 200, { vouchers });
}

function getAccountingVoucher(db, res, actor, voucherId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const voucher = db.prepare(`SELECT av.*, u.display_name creatorName FROM accounting_vouchers av JOIN users u ON u.id=av.creator_id WHERE av.id=?`).get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');
  voucher.entries = db.prepare(`SELECT ae.*, acs.code subjectCode, acs.name subjectName FROM accounting_entries ae JOIN accounting_subjects acs ON acs.id=ae.subject_id WHERE ae.voucher_id=? ORDER BY ae.direction DESC, ae.id`).all(voucherId);
  voucher.debitTotal = voucher.entries.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amount_cents, 0);
  voucher.creditTotal = voucher.entries.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amount_cents, 0);
  return send(res, 200, { voucher });
}





// ============ 手动凭证录入 ============

// 期间关闭保护辅助函数
function checkPeriodNotClosedForVoucher(db, voucherDate, operation) {
  const period = voucherDate.slice(0, 7);
  const closure = db.prepare('SELECT * FROM period_closures WHERE period=? AND status=?').get(period, 'CLOSED');
  if (closure) {
    throw new HttpError(409, `会计期间 ${period} 已结账，禁止 ${operation} 凭证`);
  }
}

async function createAccountingVoucher(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { voucherDate, remark, entries } = body;
  
  // 检查期间是否已关闭
  const effectiveDate = voucherDate || new Date().toISOString().slice(0, 10);
  checkPeriodNotClosedForVoucher(db, effectiveDate, '录入');
  
  if (!entries || !Array.isArray(entries) || entries.length < 2) {
    throw new HttpError(400, '凭证分录至少需要两条');
  }
  
  // 验证借贷平衡
  const debitTotal = entries.filter(e => e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amountCents), 0);
  const creditTotal = entries.filter(e => e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amountCents), 0);
  
  if (Math.abs(debitTotal - creditTotal) > 1) {
    throw new HttpError(400, '借贷不平衡，借方合计：' + debitTotal + '，贷方合计：' + creditTotal);
  }
  
  const voucherId = id();
  const now = new Date().toISOString();
  const voucherNo = makeVoucherNo();
  const effectiveVoucherDate = voucherDate || now.slice(0, 10);

  transaction(db, () => {
    db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at,status,period) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(voucherId, voucherNo, 'MANUAL', voucherId, effectiveVoucherDate, remark || '', actor.id, now, 'ENTERED', effectiveVoucherDate.slice(0, 7));
    
    const stmt = db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)');
    entries.forEach(e => {
      stmt.run(id(), voucherId, e.subjectId, e.direction, Number(e.amountCents), e.summary || '');
    });
    
    audit(db, actor.id, 'CREATE', 'ACCOUNTING_VOUCHER', voucherId, '录入凭证 ' + voucherNo);
  });
  
  return send(res, 201, { id: voucherId, voucherNo });
}
async function updateAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');

  // 只允许修改手工凭证
  if (voucher.source_type !== 'MANUAL') {
    throw new HttpError(400, '只能修改手工凭证');
  }

  // State protection - only ENTERED and REJECTED can be edited
  if (voucher.status === 'SUBMITTED') {
    throw new HttpError(409, '待审核凭证不能修改');
  }
  if (voucher.status === 'POSTED') {
    throw new HttpError(409, '已审核凭证不能修改');
  }

  // Check period status for ENTERED and REJECTED - closed period prohibits modification
  checkPeriodNotClosedForVoucher(db, voucher.voucher_date, '修改');

  const body = await readJson(req);
  const { voucherDate, remark, entries } = body;

  if (!entries || !Array.isArray(entries) || entries.length < 2) {
    throw new HttpError(400, '凭证分录至少需要两条');
  }

  const debitTotal = entries.filter(e => e.direction === 'DEBIT').reduce((s, e) => s + Number(e.amountCents), 0);
  const creditTotal = entries.filter(e => e.direction === 'CREDIT').reduce((s, e) => s + Number(e.amountCents), 0);

  if (Math.abs(debitTotal - creditTotal) > 1) {
    throw new HttpError(400, '借贷不平衡');
  }

  const now = new Date().toISOString();
  const newVoucherDate = voucherDate || voucher.voucher_date;

  transaction(db, () => {
    // If editing REJECTED voucher, reset to ENTERED
    const newStatus = voucher.status === 'REJECTED' ? 'ENTERED' : voucher.status;
    db.prepare('UPDATE accounting_vouchers SET voucher_date = ?, remark = ?, status = ?, rejection_reason = ?, updated_at = ?, period = ? WHERE id = ?')
      .run(newVoucherDate, remark || '', newStatus, '', now, newVoucherDate.slice(0, 7), voucherId);

    db.prepare('DELETE FROM accounting_entries WHERE voucher_id = ?').run(voucherId);

    const stmt = db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)');
    entries.forEach(e => {
      stmt.run(id(), voucherId, e.subjectId, e.direction, Number(e.amountCents), e.summary || '');
    });

    audit(db, actor.id, 'UPDATE', 'ACCOUNTING_VOUCHER', voucherId, '修改凭证 ' + voucher.voucher_no + (newStatus === 'ENTERED' ? ' (重新提交后生效)' : ''));
  });

  return send(res, 200, { success: true, status: voucher.status === 'REJECTED' ? 'ENTERED' : voucher.status });
}

async function deleteAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');

  // 只允许删除手工凭证
  if (voucher.source_type !== 'MANUAL') {
    throw new HttpError(400, '只能删除手工凭证');
  }

  // State protection - only ENTERED and REJECTED can be deleted
  if (voucher.status === 'SUBMITTED') {
    throw new HttpError(409, '待审核凭证不能删除');
  }
  if (voucher.status === 'POSTED') {
    throw new HttpError(409, '已审核凭证不能删除');
  }

  // Check period closure
  checkPeriodNotClosedForVoucher(db, voucher.voucher_date, '删除');

  transaction(db, () => {
    db.prepare('DELETE FROM accounting_entries WHERE voucher_id = ?').run(voucherId);
    db.prepare('DELETE FROM accounting_vouchers WHERE id = ?').run(voucherId);
    audit(db, actor.id, 'DELETE', 'ACCOUNTING_VOUCHER', voucherId, '删除凭证 ' + voucher.voucher_no);
  });

  return send(res, 200, { success: true });
}

async function submitAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, 'VOUCHER_SUBMIT');
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');

  // Check if period is closed FIRST
  checkPeriodNotClosedForVoucher(db, voucher.voucher_date, '提交');

  // Only ENTERED and REJECTED vouchers can be submitted
  if (!['ENTERED', 'REJECTED'].includes(voucher.status)) {
    throw new HttpError(409, '只有录入或已驳回的凭证可以提交');
  }

  const now = new Date().toISOString();

  db.prepare('UPDATE accounting_vouchers SET status = ?, submitted_at = ?, submitted_by = ?, rejection_reason = ?, updated_at = ? WHERE id = ?')
    .run('SUBMITTED', now, actor.id, '', now, voucherId);

  audit(db, actor.id, 'SUBMIT', 'ACCOUNTING_VOUCHER', voucherId, '提交凭证 ' + voucher.voucher_no);

  return send(res, 200, { success: true });
}

async function approveAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, 'VOUCHER_APPROVE');
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');

  // Check if period is closed FIRST
  checkPeriodNotClosedForVoucher(db, voucher.voucher_date, '审核');

  // Only SUBMITTED vouchers can be approved
  if (voucher.status !== 'SUBMITTED') {
    throw new HttpError(409, '只有待审核凭证可以审核');
  }

  // Cannot approve own voucher
  if (voucher.creator_id === actor.id) {
    throw new HttpError(403, '不能审核自己录入的凭证');
  }

  const now = new Date().toISOString();

  db.prepare('UPDATE accounting_vouchers SET status = ?, approver_id = ?, approved_at = ?, updated_at = ? WHERE id = ?')
    .run('POSTED', actor.id, now, now, voucherId);

  audit(db, actor.id, 'APPROVE', 'ACCOUNTING_VOUCHER', voucherId, '审核通过凭证 ' + voucher.voucher_no);

  return send(res, 200, { success: true });
}

async function rejectAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, 'VOUCHER_APPROVE');
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');

  // Check if period is closed FIRST
  checkPeriodNotClosedForVoucher(db, voucher.voucher_date, '驳回');

  // Only SUBMITTED vouchers can be rejected
  if (voucher.status !== 'SUBMITTED') {
    throw new HttpError(409, '只有待审核凭证可以驳回');
  }

  // Cannot reject own voucher
  if (voucher.creator_id === actor.id) {
    throw new HttpError(403, '不能驳回自己录入的凭证');
  }

  const body = await readJson(req);
  const rejectionReason = requiredText(body.rejectionReason, '驳回原因', 500);

  const now = new Date().toISOString();

  db.prepare('UPDATE accounting_vouchers SET status = ?, rejection_reason = ?, approver_id = ?, approved_at = ?, updated_at = ? WHERE id = ?')
    .run('REJECTED', rejectionReason, actor.id, now, now, voucherId);

  audit(db, actor.id, 'REJECT', 'ACCOUNTING_VOUCHER', voucherId, '驳回凭证 ' + voucher.voucher_no + ': ' + rejectionReason);

  return send(res, 200, { success: true });
}

function listAuditLogs(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  const userId = url.searchParams.get('user_id');
  const action = url.searchParams.get('action');
  const limit = Math.min(Number(url.searchParams.get('limit') || '100'), 500);
  const offset = Number(url.searchParams.get('offset') || '0');

  let sql = 'SELECT l.*, u.username, u.display_name FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id WHERE 1=1';
  const params = [];

  if (entityType) { sql += ' AND l.entity_type = ?'; params.push(entityType); }
  if (entityId) { sql += ' AND l.entity_id = ?'; params.push(entityId); }
  if (userId) { sql += ' AND l.user_id = ?'; params.push(userId); }
  if (action) { sql += ' AND l.action = ?'; params.push(action); }

  sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(sql).all(...params);
  const countSql = 'SELECT COUNT(*) cnt FROM audit_logs WHERE 1=1' + (entityType ? ' AND entity_type = ?' : '') + (entityId ? ' AND entity_id = ?' : '') + (userId ? ' AND user_id = ?' : '') + (action ? ' AND action = ?' : '');
  const countParams = params.slice(0, -2);
  const total = db.prepare(countSql).get(...countParams);

  return send(res, 200, { logs, total: total.cnt, limit, offset });
}

// ============ 账簿查询 ============

function getAccountingBalances(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const period = url.searchParams.get('period'); // 格式: YYYY-MM
  
  let startDate, endDate;
  if (period) {
    startDate = period + '-01';
    const [y, m] = period.split('-').map(Number);
    endDate = new Date(y, m, 0).toISOString().slice(0, 10);
  } else {
    // 默认当前月
    const now = new Date();
    startDate = now.toISOString().slice(0, 7) + '-01';
    endDate = now.toISOString().slice(0, 10);
  }
  
  // 获取所有末级科目
  const subjects = db.prepare(`SELECT id, code, name, type, direction FROM accounting_subjects 
    WHERE active = 1 AND parent_id IS NOT NULL ORDER BY code`).all();
  
  // 计算每个科目的期初余额、本期发生、期末余额
  const balances = subjects.map(subject => {
    // 期初余额（累计）
    const opening = db.prepare(`SELECT 
      COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0) as balance
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND av.voucher_date < ? AND av.status='POSTED'`)
      .get(subject.id, startDate);
    
    // 本期借方发生
    const periodDebit = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND ae.direction = 'DEBIT' 
      AND av.voucher_date >= ? AND av.voucher_date <= ? AND av.status='POSTED'`)
      .get(subject.id, startDate, endDate);
    
    // 本期贷方发生
    const periodCredit = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND ae.direction = 'CREDIT' 
      AND av.voucher_date >= ? AND av.voucher_date <= ? AND av.status='POSTED'`)
      .get(subject.id, startDate, endDate);
    
    const openingBalance = Number(opening.balance);
    const debit = Number(periodDebit.total);
    const credit = Number(periodCredit.total);
    
    // 资产类科目：期末 = 期初 + 借方 - 贷方
    // 负债/权益类科目：期末 = 期初 + 贷方 - 借方
    let closingBalance;
    if (subject.type === 'ASSET' || subject.type === 'EXPENSE') {
      closingBalance = openingBalance + debit - credit;
    } else {
      closingBalance = openingBalance + credit - debit;
    }
    
    return {
      ...subject,
      openingBalance,
      periodDebit: debit,
      periodCredit: credit,
      closingBalance
    };
  }).filter(b => b.openingBalance !== 0 || b.periodDebit !== 0 || b.periodCredit !== 0 || b.closingBalance !== 0);
  
  return send(res, 200, { balances, period: { startDate, endDate } });
}

function getAccountingLedger(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const subjectId = url.searchParams.get('subject_id');
  const period = url.searchParams.get('period');
  
  if (!subjectId) throw new HttpError(400, '请指定科目');
  
  const subject = db.prepare('SELECT * FROM accounting_subjects WHERE id = ?').get(subjectId);
  if (!subject) throw new HttpError(404, '科目不存在');
  
  let startDate, endDate;
  if (period) {
    startDate = period + '-01';
    const [y, m] = period.split('-').map(Number);
    endDate = new Date(y, m, 0).toISOString().slice(0, 10);
  } else {
    const now = new Date();
    startDate = now.toISOString().slice(0, 7) + '-01';
    endDate = now.toISOString().slice(0, 10);
  }
  
  // 期初余额
  const opening = db.prepare(`SELECT 
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0) as balance
    FROM accounting_entries ae 
    JOIN accounting_vouchers av ON av.id = ae.voucher_id 
    WHERE ae.subject_id = ? AND av.voucher_date < ?`)
    .get(subjectId, startDate);
  
  // 本期明细
  const entries = db.prepare(`SELECT ae.*, av.voucher_no, av.voucher_date, av.source_type,
    CASE WHEN ae.direction = 'DEBIT' THEN ae.amount_cents ELSE 0 END as debit,
    CASE WHEN ae.direction = 'CREDIT' THEN ae.amount_cents ELSE 0 END as credit
    FROM accounting_entries ae 
    JOIN accounting_vouchers av ON av.id = ae.voucher_id 
    WHERE ae.subject_id = ? AND av.voucher_date >= ? AND av.voucher_date <= ?
    ORDER BY av.voucher_date, av.id`)
    .all(subjectId, startDate, endDate);
  
  return send(res, 200, {
    subject,
    openingBalance: Number(opening.balance),
    entries,
    period: { startDate, endDate }
  });
}

// ============ 出纳管理 ============

function listCashJournals(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const where = [];
  const params = [];
  const accountType = url.searchParams.get('account_type');
  const journalType = url.searchParams.get('journal_type');
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');
  
  if (accountType) { where.push('c.account_type = ?'); params.push(accountType); }
  if (journalType) { where.push('c.journal_type = ?'); params.push(journalType); }
  if (startDate) { where.push('c.journal_date >= ?'); params.push(startDate); }
  if (endDate) { where.push('c.journal_date <= ?'); params.push(endDate); }
  
  const sql = `SELECT c.*, u.display_name operatorName, ba.bank_name, ba.account_no bankAccountNo
    FROM cash_journals c
    JOIN users u ON u.id = c.operator_id
    LEFT JOIN bank_accounts ba ON ba.id = c.bank_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.journal_date DESC, c.created_at DESC LIMIT 100`;
  
  const journals = db.prepare(sql).all(...params);
  
  // 计算余额
  const inTotal = journals.filter(j => j.direction === 'IN').reduce((s, j) => s + j.amount_cents, 0);
  const outTotal = journals.filter(j => j.direction === 'OUT').reduce((s, j) => s + j.amount_cents, 0);
  
  return send(res, 200, { journals, summary: { inTotal, outTotal, netTotal: inTotal - outTotal } });
}

async function createCashJournal(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { journal_type, account_type, bank_id, amount_cents, direction, counterparty_type, counterparty_id, counterparty_name, subject_id, summary, journal_date, remark } = body;
  
  if (!amount_cents || amount_cents <= 0) throw new HttpError(400, '请输入正确的金额');
  if (!journal_date) throw new HttpError(400, '请选择日期');
  
  const journalId = id();
  const now = new Date().toISOString();
  const journalNo = 'CJ-' + Date.now().toString().slice(-10);
  
  transaction(db, () => {
    db.prepare(`INSERT INTO cash_journals(id, journal_no, journal_type, account_type, bank_id, amount_cents, direction, counterparty_type, counterparty_id, counterparty_name, subject_id, summary, operator_id, journal_date, remark, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(journalId, journalNo, journal_type || 'RECEIPT', account_type || 'CASH', bank_id || null, Math.round(amount_cents * 100), direction || 'IN', counterparty_type || null, counterparty_id || null, counterparty_name || '', subject_id || null, summary || '', actor.id, journal_date, remark || '', now);
    
    // 更新银行账户余额
    if (bank_id && account_type === 'BANK') {
      const change = direction === 'IN' ? Math.round(amount_cents * 100) : -Math.round(amount_cents * 100);
      db.prepare('UPDATE bank_accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?').run(change, now, bank_id);
    }
    
    audit(db, actor.id, 'CREATE', 'CASH_JOURNAL', journalId, `${direction === 'IN' ? '收款' : '付款'} ${journalNo} ${amount_cents}元`);
  });
  
  return send(res, 201, { id: journalId, journalNo });
}

function getCashJournal(db, res, actor, journalId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const journal = db.prepare(`SELECT c.*, u.display_name operatorName, ba.bank_name, ba.account_no bankAccountNo
    FROM cash_journals c JOIN users u ON u.id = c.operator_id
    LEFT JOIN bank_accounts ba ON ba.id = c.bank_id WHERE c.id = ?`).get(journalId);
  
  if (!journal) throw new HttpError(404, '记录不存在');
  return send(res, 200, { journal });
}

function deleteCashJournal(db, req, res, actor, journalId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const journal = db.prepare('SELECT * FROM cash_journals WHERE id = ?').get(journalId);
  if (!journal) throw new HttpError(404, '记录不存在');
  
  const now = new Date().toISOString();
  transaction(db, () => {
    // 还原银行账户余额
    if (journal.bank_id) {
      const change = journal.direction === 'IN' ? -journal.amount_cents : journal.amount_cents;
      db.prepare('UPDATE bank_accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?').run(change, now, journal.bank_id);
    }
    db.prepare('DELETE FROM cash_journals WHERE id = ?').run(journalId);
    audit(db, actor.id, 'DELETE', 'CASH_JOURNAL', journalId, '删除出纳记录 ' + journal.journal_no);
  });
  
  return send(res, 200, { success: true });
}

// ============ 银行账户 ============

function listBankAccounts(db, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const accounts = db.prepare('SELECT * FROM bank_accounts WHERE active = 1 ORDER BY created_at DESC').all();
  return send(res, 200, { bankAccounts: accounts });
}

async function createBankAccount(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { bank_name, account_no, account_name, account_type, initial_balance } = body;
  
  if (!bank_name || !account_no || !account_name) throw new HttpError(400, '请填写完整的银行信息');
  
  const accountId = id();
  const now = new Date().toISOString();
  
  db.prepare(`INSERT INTO bank_accounts(id, bank_name, account_no, account_name, account_type, balance_cents, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(accountId, bank_name, account_no, account_name, account_type || 'CHECKING', Math.round((initial_balance || 0) * 100), now, now);
  
  return send(res, 201, { id: accountId });
}

function getBankAccount(db, res, actor, accountId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(accountId);
  if (!account) throw new HttpError(404, '账户不存在');
  
  // 获取最近10笔交易
  const transactions = db.prepare(`SELECT * FROM cash_journals WHERE bank_id = ? ORDER BY journal_date DESC, created_at DESC LIMIT 10`).all(accountId);
  
  return send(res, 200, { bankAccount: account, transactions });
}

async function updateBankAccount(db, req, res, actor, accountId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(accountId);
  if (!account) throw new HttpError(404, '账户不存在');
  
  const body = await readJson(req);
  const { bank_name, account_no, account_name, account_type, active } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE bank_accounts SET bank_name = ?, account_no = ?, account_name = ?, account_type = ?, active = ?, updated_at = ? WHERE id = ?')
    .run(bank_name || account.bank_name, account_no || account.account_no, account_name || account.account_name, account_type || account.account_type, active !== undefined ? (active ? 1 : 0) : account.active, now, accountId);
  
  return send(res, 200, { success: true });
}

// ============ 票据管理 ============

function listBills(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const where = [];
  const params = [];
  const direction = url.searchParams.get('direction');
  const status = url.searchParams.get('status');
  const billType = url.searchParams.get('bill_type');
  
  if (direction) { where.push('b.direction = ?'); params.push(direction); }
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (billType) { where.push('b.bill_type = ?'); params.push(billType); }
  
  const sql = `SELECT b.*, ba.bank_name, u.display_name holderName
    FROM bills b
    LEFT JOIN bank_accounts ba ON ba.id = b.bank_id
    LEFT JOIN users u ON u.id = b.holder_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY b.issue_date DESC, b.created_at DESC LIMIT 100`;
  
  const bills = db.prepare(sql).all(...params);
  return send(res, 200, { bills });
}

async function createBill(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { bill_no, bill_type, direction, face_amount, bank_id, drawer_name, drawer_bank, payee_name, issue_date, due_date, holder_id, remark } = body;
  
  if (!bill_no || !face_amount || !issue_date || !due_date) throw new HttpError(400, '请填写完整的票据信息');
  
  const billId = id();
  const now = new Date().toISOString();
  
  db.prepare(`INSERT INTO bills(id, bill_no, bill_type, direction, face_amount_cents, bank_id, drawer_name, drawer_bank, payee_name, holder, holder_id, issue_date, due_date, status, remark, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`)
    .run(billId, bill_no, bill_type || 'DRAFT', direction || 'RECEIVABLE', Math.round(face_amount * 100), bank_id || null, drawer_name || '', drawer_bank || '', payee_name || '', payee_name || '', holder_id || actor.id, issue_date, due_date, remark || '', now, now);
  
  return send(res, 201, { id: billId });
}

function getBill(db, res, actor, billId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const bill = db.prepare(`SELECT b.*, ba.bank_name, u.display_name holderName
    FROM bills b LEFT JOIN bank_accounts ba ON ba.id = b.bank_id
    LEFT JOIN users u ON u.id = b.holder_id WHERE b.id = ?`).get(billId);
  
  if (!bill) throw new HttpError(404, '票据不存在');
  return send(res, 200, { bill });
}

async function updateBill(db, req, res, actor, billId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) throw new HttpError(404, '票据不存在');
  
  const body = await readJson(req);
  const { status, holder_id, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE bills SET status = ?, holder_id = ?, holder = (SELECT display_name FROM users WHERE id = ?), remark = ?, updated_at = ? WHERE id = ?')
    .run(status || bill.status, holder_id || bill.holder_id, holder_id || bill.holder_id, remark || bill.remark, now, billId);
  
  audit(db, actor.id, 'UPDATE', 'BILL', billId, `更新票据 ${bill.bill_no} 状态为 ${status}`);
  
  return send(res, 200, { success: true });
}




// ============ 固定资产管理 ============

function listFixedAssets(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const where = [];
  const params = [];
  const status = url.searchParams.get('status');
  const assetType = url.searchParams.get('asset_type');
  
  if (status) { where.push('status = ?'); params.push(status); }
  if (assetType) { where.push('asset_type = ?'); params.push(assetType); }
  
  const sql = `SELECT fa.asset_code, fa.asset_name, fa.asset_type AS category, fa.purchase_date,
    fa.purchase_amount_cents, fa.status, fa.net_value_cents, fa.accumulated_depreciation_cents,
    fa.depreciation_method, fa.service_years, fa.residual_value_cents,
    u.display_name creatorName,
    COALESCE((SELECT SUM(depreciation_amount_cents) FROM asset_depreciations WHERE asset_id = fa.id), 0) AS totalDepreciatedCents
    FROM fixed_assets fa
    JOIN users u ON u.id = fa.creator_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY fa.created_at DESC LIMIT 100`;
  
  const assets = db.prepare(sql).all(...params);
  
  // 统计汇总
  const summary = {
    totalCount: assets.length,
    totalOriginal: assets.reduce((s, a) => s + a.purchase_amount_cents, 0),
    totalDepreciation: assets.reduce((s, a) => s + a.accumulated_depreciation_cents, 0),
    totalNetValue: assets.reduce((s, a) => s + a.net_value_cents, 0)
  };
  
  return send(res, 200, { assets, summary });
}

async function createFixedAsset(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { asset_code, asset_name, asset_type, spec, unit, purchase_date, purchase_amount, service_years, depreciation_method, residual_value, location, custodian, remark } = body;
  
  if (!asset_code || !asset_name || !asset_type) throw new HttpError(400, '请填写完整的资产信息');
  
  const assetId = id();
  const now = new Date().toISOString();
  const amountCents = Math.round((purchase_amount || 0) * 100);
  const residualCents = Math.round((residual_value || 0) * 100);
  
  db.prepare(`INSERT INTO fixed_assets(id, asset_code, asset_name, asset_type, spec, unit, purchase_date, purchase_amount_cents, service_years, depreciation_method, residual_value_cents, accumulated_depreciation_cents, net_value_cents, location, custodian, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`)
    .run(assetId, asset_code, asset_name, asset_type, spec || '', unit || '台', purchase_date || null, amountCents, service_years || 5, depreciation_method || 'STRAIGHT_LINE', residualCents, amountCents - residualCents, location || '', custodian || '', remark || '', actor.id, now, now);
  
  return send(res, 201, { id: assetId });
}

function getFixedAsset(db, res, actor, assetId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const asset = db.prepare(`SELECT fa.asset_code, fa.asset_name, fa.asset_type AS category, fa.purchase_date,
    fa.purchase_amount_cents, fa.status, fa.net_value_cents, fa.accumulated_depreciation_cents,
    fa.depreciation_method, fa.service_years, fa.residual_value_cents,
    u.display_name creatorName,
    COALESCE((SELECT SUM(depreciation_amount_cents) FROM asset_depreciations WHERE asset_id = fa.id), 0) AS totalDepreciatedCents
    FROM fixed_assets fa JOIN users u ON u.id = fa.creator_id WHERE fa.id = ?`).get(assetId);
  if (!asset) throw new HttpError(404, '资产不存在');
  
  // 获取折旧记录
  const depreciations = db.prepare('SELECT * FROM asset_depreciations WHERE asset_id = ? ORDER BY depreciation_date DESC').all(assetId);
  
  return send(res, 200, { asset, depreciations });
}

async function updateFixedAsset(db, req, res, actor, assetId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const asset = db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(assetId);
  if (!asset) throw new HttpError(404, '资产不存在');
  
  const body = await readJson(req);
  const { status, location, custodian, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE fixed_assets SET status = ?, location = ?, custodian = ?, remark = ?, updated_at = ? WHERE id = ?')
    .run(status || asset.status, location || asset.location, custodian || asset.custodian, remark || asset.remark, now, assetId);
  
  audit(db, actor.id, 'UPDATE', 'FIXED_ASSET', assetId, '更新固定资产 ' + asset.asset_code);
  
  return send(res, 200, { success: true });
}

async function calculateDepreciation(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { asset_id, depreciation_amount } = body;
  
  if (!asset_id) throw new HttpError(400, '请选择资产');
  
  const asset = db.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(asset_id);
  if (!asset) throw new HttpError(404, '资产不存在');
  
  const depId = id();
  const now = new Date().toISOString();
  const depCents = Math.round((depreciation_amount || 0) * 100);
  const newAccumulated = asset.accumulated_depreciation_cents + depCents;
  const newNetValue = asset.purchase_amount_cents - newAccumulated;
  
  transaction(db, () => {
    db.prepare(`INSERT INTO asset_depreciations(id, asset_id, depreciation_date, depreciation_amount_cents, accumulated_amount_cents, net_value_cents, creator_id, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(depId, asset_id, now.slice(0, 10), depCents, newAccumulated, newNetValue, actor.id, now);
    
    db.prepare('UPDATE fixed_assets SET accumulated_depreciation_cents = ?, net_value_cents = ?, updated_at = ? WHERE id = ?')
      .run(newAccumulated, newNetValue, now, asset_id);
    
    audit(db, actor.id, 'DEPRECIATE', 'FIXED_ASSET', asset_id, '计提折旧 ' + money(depCents));
  });
  
  return send(res, 200, { id: depId });
}

function listAssetDepreciations(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const assetId = url.searchParams.get('asset_id');
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');
  
  let where = [];
  let params = [];
  
  if (assetId) { where.push('ad.asset_id = ?'); params.push(assetId); }
  if (startDate) { where.push('ad.depreciation_date >= ?'); params.push(startDate); }
  if (endDate) { where.push('ad.depreciation_date <= ?'); params.push(endDate); }
  
  const sql = `SELECT ad.*, fa.asset_code, fa.asset_name, u.display_name creatorName
    FROM asset_depreciations ad
    JOIN fixed_assets fa ON fa.id = ad.asset_id
    JOIN users u ON u.id = ad.creator_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ad.depreciation_date DESC LIMIT 100`;
  
  const depreciations = db.prepare(sql).all(...params);
  
  return send(res, 200, { depreciations });
}




// ============ 成本管理 ============

const COST_RATE_TYPES = new Set(['MATERIAL_RATE', 'LABOR_RATE', 'OVERHEAD_RATE']);

function requiredNonNegativeCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpError(400, `${label}必须是非负整数分`);
  return value;
}

function requiredIsoDate(value, label = '生效日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${label}格式必须为 YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${label}不是有效日期`);
  return value;
}

function productCostDto(row) {
  return {
    id: row.id, productId: row.product_id, productCode: row.productCode, productName: row.productName,
    standardCostCents: row.standard_cost_cents, materialCostCents: row.material_cost_cents,
    laborCostCents: row.labor_cost_cents, overheadCostCents: row.overhead_cost_cents,
    effectiveDate: row.effective_date, status: row.status, remark: row.remark,
    creatorId: row.creator_id, creatorName: row.creatorName, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function costRateDto(row) {
  return {
    id: row.id, rateType: row.rate_type, rateValue: row.rate_value, unit: row.unit,
    effectiveDate: row.effective_date, remark: row.remark, creatorId: row.creator_id,
    creatorName: row.creatorName, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function requiredCostRateBody(body) {
  const rateType = requiredCode(body.rateType, '费率类型');
  if (!COST_RATE_TYPES.has(rateType)) throw new HttpError(400, '费率类型无效');
  if (typeof body.rateValue !== 'number' || !Number.isFinite(body.rateValue) || body.rateValue < 0) throw new HttpError(400, '费率值必须是非负数');
  return {
    rateType, rateValue: body.rateValue, unit: requiredText(body.unit, '单位', 30),
    effectiveDate: requiredIsoDate(body.effectiveDate), remark: optionalText(body.remark, 500),
  };
}

function listProductCosts(db, res, actor, url) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const productId = url.searchParams.get('productId');
  
  let sql = `SELECT pc.*, p.code productCode, p.name productName, u.display_name creatorName
    FROM product_costs pc
    JOIN products p ON p.id = pc.product_id
    JOIN users u ON u.id = pc.creator_id
    WHERE pc.status = 'ACTIVE'`;
  const params = [];
  
  if (productId) { sql += ' AND pc.product_id = ?'; params.push(productId); }
  
  sql += ' ORDER BY pc.effective_date DESC LIMIT 100';
  
  const costs = db.prepare(sql).all(...params).map(productCostDto);
  return send(res, 200, { costs });
}

async function createProductCost(db, req, res, actor) {
  allow(actor, 'COST_MANAGE');
  const body = await readJson(req);
  const costId = id();
  const now = new Date().toISOString();

  const cost = transaction(db, () => {
    const productId = requiredText(body.productId, '产品', 100);
    const materialCostCents = requiredNonNegativeCents(body.materialCostCents, '材料成本');
    const laborCostCents = requiredNonNegativeCents(body.laborCostCents, '人工成本');
    const overheadCostCents = requiredNonNegativeCents(body.overheadCostCents, '制造费用');
    const standardCostCents = requiredNonNegativeCents(body.standardCostCents, '标准成本');
    const componentTotal = materialCostCents + laborCostCents + overheadCostCents;
    if (!Number.isSafeInteger(componentTotal) || standardCostCents !== componentTotal) throw new HttpError(400, '标准成本必须等于材料、人工和制造费用之和');
    const effectiveDate = requiredIsoDate(body.effectiveDate);
    const remark = optionalText(body.remark, 500);
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(productId)) throw new HttpError(404, '产品不存在');
    db.prepare("UPDATE product_costs SET status = 'HISTORICAL', updated_at = ? WHERE product_id = ? AND status = 'ACTIVE'").run(now, productId);
    db.prepare(`INSERT INTO product_costs(id, product_id, standard_cost_cents, material_cost_cents, labor_cost_cents, overhead_cost_cents, effective_date, status, remark, creator_id, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`)
      .run(costId, productId, standardCostCents, materialCostCents, laborCostCents, overheadCostCents, effectiveDate, remark, actor.id, now, now);
    audit(db, actor.id, 'CREATE', 'PRODUCT_COST', costId, '设置产品标准成本');
    return productCostDto(db.prepare(`SELECT pc.*, p.code productCode, p.name productName, u.display_name creatorName
      FROM product_costs pc JOIN products p ON p.id = pc.product_id JOIN users u ON u.id = pc.creator_id WHERE pc.id = ?`).get(costId));
  });
  return send(res, 201, { cost });
}

function listProductionCosts(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'PRODUCTION_ORDERS_VIEW']);
  const orderId = url.searchParams.get('order_id');
  
  let sql = `SELECT pc.*, po.order_no, p.code productCode, p.name productName, u.display_name creatorName
    FROM production_costs pc
    JOIN production_orders po ON po.id = pc.order_id
    JOIN products p ON p.id = po.product_id
    JOIN users u ON u.id = pc.creator_id`;
  const params = [];
  
  if (orderId) { sql += ' WHERE pc.order_id = ?'; params.push(orderId); }
  sql += ' ORDER BY pc.calculated_at DESC LIMIT 100';
  
  const costs = db.prepare(sql).all(...params);
  return send(res, 200, { costs });
}

async function calculateProductionCost(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { order_id } = body;
  
  if (!order_id) throw new HttpError(400, '请选择工单');
  
  const order = db.prepare(`SELECT po.*, p.code productCode, p.name productName, pc.standard_cost_cents
    FROM production_orders po
    JOIN products p ON p.id = po.product_id
    LEFT JOIN product_costs pc ON pc.product_id = po.product_id AND pc.status = 'ACTIVE'
    WHERE po.id = ?`).get(order_id);
  
  if (!order) throw new HttpError(404, '工单不存在');
  
  // 获取物料消耗
  const items = db.prepare('SELECT * FROM production_order_items WHERE order_id = ?').all(order_id);
  
  // 获取成本要素费率
  const laborRate = db.prepare("SELECT rate_value FROM cost_rates WHERE rate_type = 'LABOR_RATE' AND effective_date <= date('now') ORDER BY effective_date DESC LIMIT 1").get();
  const overheadRate = db.prepare("SELECT rate_value FROM cost_rates WHERE rate_type = 'OVERHEAD_RATE' AND effective_date <= date('now') ORDER BY effective_date DESC LIMIT 1").get();
  
  // 计算物料成本
  let materialCost = 0;
  for (const item of items) {
    const itemCost = db.prepare("SELECT standard_cost_cents FROM product_costs WHERE product_id = ? AND status = 'ACTIVE' LIMIT 1").get(item.product_id);
    materialCost += (itemCost?.standard_cost_cents || 0) * item.consumed_quantity;
  }
  
  // 假设工时（简化计算：生产数量 / 10 小时）
  const laborHours = order.quantity / 10;
  const laborCost = Math.round(laborHours * (laborRate?.rate_value || 100) * 100); // 每小时100元
  const overheadCost = Math.round(laborCost * (overheadRate?.rate_value || 0.5)); // 50% 制造费用率
  
  const totalCost = materialCost + laborCost + overheadCost;
  const unitCost = order.quantity > 0 ? Math.round(totalCost / order.quantity) : 0;
  
  const costId = id();
  const now = new Date().toISOString();
  
  db.prepare(`INSERT INTO production_costs(id, order_id, material_cost_cents, labor_cost_cents, overhead_cost_cents, total_cost_cents, unit_cost_cents, calculated_at, creator_id, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(costId, order_id, materialCost, laborCost, overheadCost, totalCost, unitCost, now.slice(0, 10), actor.id, now);
  
  return send(res, 200, {
    cost: { id: costId, order_id, material_cost_cents: materialCost, labor_cost_cents: laborCost, overhead_cost_cents: overheadCost, total_cost_cents: totalCost, unit_cost_cents: unitCost },
    breakdown: { laborHours: laborHours.toFixed(2), laborRate: laborRate?.rate_value || 100, overheadRate: overheadRate?.rate_value || 0.5 }
  });
}

function listCostRates(db, res, actor) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const rates = db.prepare(`SELECT cr.*, u.display_name creatorName FROM cost_rates cr JOIN users u ON u.id = cr.creator_id
    ORDER BY cr.rate_type, cr.effective_date DESC`).all().map(costRateDto);
  return send(res, 200, { rates });
}

async function createCostRate(db, req, res, actor) {
  allow(actor, 'COST_MANAGE');
  const rate = requiredCostRateBody(await readJson(req));
  const rateId = id();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO cost_rates(id, rate_type, rate_value, unit, effective_date, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rateId, rate.rateType, rate.rateValue, rate.unit, rate.effectiveDate, rate.remark, actor.id, now, now);
  audit(db, actor.id, 'CREATE', 'COST_RATE', rateId, `新增费率 ${rate.rateType}`);
  const created = db.prepare(`SELECT cr.*, u.display_name creatorName FROM cost_rates cr JOIN users u ON u.id = cr.creator_id WHERE cr.id = ?`).get(rateId);
  return send(res, 201, { rate: costRateDto(created) });
}

function listCostProducts(db, res, actor) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const products = db.prepare('SELECT id, code, name FROM products WHERE active = 1 ORDER BY code').all();
  return send(res, 200, { products });
}


// ============ Purchase Receipts ============

function listPurchaseReceipts(db, res, actor, url) {
  allowAny(actor, ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  let where = '(pr.receipt_no LIKE ? OR s.name LIKE ?)';
  const params = [search, search];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { where += ' AND pr.status = ?'; params.push(status); }
  const sql = `SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, (SELECT count(*) FROM purchase_receipt_items WHERE receipt_id = pr.id) itemCount FROM purchase_receipts pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.confirmed_by WHERE ${where} ORDER BY pr.created_at DESC LIMIT 100`;  const receipts = db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: RECEIPT_STATUS[row.status] || row.status }));
  return send(res, 200, { purchaseReceipts: receipts });
}

async function createPurchaseReceipt(db, req, res, actor) {
  allow(actor, 'PURCHASE_RECEIPTS_MANAGE');
  const body = await readJson(req);
  const { purchaseOrderId, supplierId, warehouseId, remark, items } = body;
  const receiptDate = normalizeDocumentDate(body?.receiptDate || new Date().toISOString().slice(0, 10), '收货日期');
  requireActiveReference(db, 'suppliers', supplierId, '供应商');
  requireActiveReference(db, 'warehouses', warehouseId, '仓库');
  if (purchaseOrderId && !db.prepare('SELECT 1 FROM purchase_orders WHERE id=?').get(purchaseOrderId)) throw new HttpError(400, '采购订单不存在');
  const input = normalizeWarehouseItems(db, items);
  const receiptId = id();
  const now = new Date().toISOString();
  const receiptNo = 'PR' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,status,total_cents,receipt_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,\'DRAFT\',?,?,?,?,?,?)').run(receiptId, receiptNo, purchaseOrderId || null, supplierId, warehouseId, actor.id, input.totalCents, receiptDate, optionalText(remark, 500), actor.id, now, now);
    replaceLogisticsItems(db, 'purchase_receipt_items', 'receipt_id', receiptId, input.items);
    audit(db, actor.id, 'CREATE', 'PURCHASE_RECEIPT', receiptId, '创建采购入库单 ' + receiptNo);
  });
  return send(res, 201, { id: receiptId, receiptNo });
}

function getPurchaseReceipt(db, res, actor, receiptId) {
  allowAny(actor, ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE']);
  const receipt = db.prepare('SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, po.order_no poNo FROM purchase_receipts pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.confirmed_by LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id WHERE pr.id = ?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  receipt.items = db.prepare('SELECT pri.*,pri.product_id productId,pri.unit_price_cents unitPriceCents,pri.amount_cents amountCents,pri.line_no lineNo,p.code productCode,p.name productName,p.unit FROM purchase_receipt_items pri JOIN products p ON p.id = pri.product_id WHERE pri.receipt_id = ? ORDER BY pri.line_no').all(receiptId);
  receipt.statusLabel = RECEIPT_STATUS[receipt.status] || receipt.status;
  return send(res, 200, { purchaseReceipt: receipt });
}

async function updatePurchaseReceipt(db, req, res, actor, receiptId) {
  allow(actor, 'PURCHASE_RECEIPTS_MANAGE');
  const current = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
  if (!current) throw new HttpError(404, '采购入库单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以修改');
  const body = await readJson(req);
  requireActiveReference(db, 'suppliers', body.supplierId, '供应商');
  requireActiveReference(db, 'warehouses', body.warehouseId, '仓库');
  const input = normalizeWarehouseItems(db, body.items);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE purchase_receipts SET supplier_id=?,warehouse_id=?,receipt_date=?,remark=?,total_cents=?,updated_at=? WHERE id=?')
      .run(body.supplierId, body.warehouseId, normalizeDocumentDate(body.receiptDate || current.receipt_date, '收货日期'), optionalText(body.remark, 500), input.totalCents, now, receiptId);
    replaceLogisticsItems(db, 'purchase_receipt_items', 'receipt_id', receiptId, input.items);
    audit(db, actor.id, 'UPDATE', 'PURCHASE_RECEIPT', receiptId, '修改采购入库 ' + current.receipt_no);
  });
  return send(res, 200, { ok: true, id: receiptId, receiptNo: current.receipt_no, totalCents: input.totalCents });
}

async function confirmPurchaseReceipt(db, req, res, actor, receiptId) {
  allow(actor, 'PURCHASE_RECEIPTS_MANAGE');
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id = ?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    transaction(db, () => {
      const locked = db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId);
      if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
      checkPeriodNotClosedForVoucher(db, locked.receipt_date, '生成业务');
      const authoritative = authoritativeLogisticsTotal(db, 'purchase_receipt_items', 'receipt_id', receiptId);
      for (const item of authoritative.items) {
        const balance = adjustInventory(db, receipt.warehouse_id, item.product_id, item.quantity, now);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'IN\',?,\'PURCHASE_RECEIPT\',?,?,?,?,?)').run(id(), receipt.warehouse_id, item.product_id, item.quantity, balance, receiptId, receipt.receipt_no, '采购入库', actor.id, now);
      }
      db.prepare('UPDATE purchase_receipts SET total_cents=?,status=\'CONFIRMED\', confirmed_at=?, confirmed_by=?, updated_at=? WHERE id=?').run(authoritative.totalCents, now, actor.id, now, receiptId);
      const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(receipt.supplier_id)?.name || '';
      generateVoucher(db, 'PURCHASE_RECEIPT', receiptId, [
        { subjectId: 'subject-004', direction: 'DEBIT', amountCents: authoritative.totalCents, summary: '采购入库 ' + receipt.receipt_no + ' ' + supplierName },
        { subjectId: 'subject-005', direction: 'CREDIT', amountCents: authoritative.totalCents, summary: '采购入库 ' + receipt.receipt_no + ' ' + supplierName }
      ], actor, locked.receipt_date);
      audit(db, actor.id, 'CONFIRM', 'PURCHASE_RECEIPT', receiptId, '确认采购入库 ' + receipt.receipt_no);
    });
  } else if (action === 'cancel') {
    if (receipt.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE purchase_receipts SET status=\'CANCELLED\', updated_at=? WHERE id=?').run(now, receiptId);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_RECEIPT', receiptId, '取消采购入库 ' + receipt.receipt_no);
  } else throw new HttpError(400, '无效操作');
  return send(res, 200, { ok: true });
}

// ============ Sales Deliveries ============

function listSalesDeliveries(db, res, actor, url) {
  allowAny(actor, ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  let where = '(sd.delivery_no LIKE ? OR c.name LIKE ?)';
  const params = [search, search];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { where += ' AND sd.status = ?'; params.push(status); }
  const sql = 'SELECT sd.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, (SELECT count(*) FROM sales_delivery_items WHERE delivery_id = sd.id) itemCount FROM sales_deliveries sd JOIN customers c ON c.id = sd.customer_id JOIN warehouses w ON w.id = sd.warehouse_id JOIN users creator ON creator.id = sd.creator_id LEFT JOIN users confirmed ON confirmed.id = sd.confirmed_by WHERE ' + where + ' ORDER BY sd.created_at DESC LIMIT 100';
  const deliveries = db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: DELIVERY_STATUS[row.status] || row.status }));
  return send(res, 200, { salesDeliveries: deliveries });
}

async function createSalesDelivery(db, req, res, actor) {
  allow(actor, 'SALES_DELIVERIES_MANAGE');
  const body = await readJson(req);
  const { salesOrderId, customerId, warehouseId, remark, items } = body;
  const deliveryDate = normalizeDocumentDate(body?.deliveryDate || new Date().toISOString().slice(0, 10), '发货日期');
  requireActiveReference(db, 'customers', customerId, '客户');
  requireActiveReference(db, 'warehouses', warehouseId, '仓库');
  if (salesOrderId && !db.prepare('SELECT 1 FROM sales_orders WHERE id=?').get(salesOrderId)) throw new HttpError(400, '销售订单不存在');
  const input = normalizeWarehouseItems(db, items);
  for (const item of input.items) {
    const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?').get(warehouseId, item.productId);
    if (!inv || inv.quantity < Number(item.quantity)) { const product = db.prepare('SELECT code FROM products WHERE id = ?').get(item.productId); throw new HttpError(400, (product?.code || item.productId) + ' 库存不足'); }
  }
  const deliveryId = id();
  const now = new Date().toISOString();
  const deliveryNo = 'SD' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,status,total_cents,delivery_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,\'DRAFT\',?,?,?,?,?,?)').run(deliveryId, deliveryNo, salesOrderId || null, customerId, warehouseId, actor.id, input.totalCents, deliveryDate, optionalText(remark, 500), actor.id, now, now);
    replaceLogisticsItems(db, 'sales_delivery_items', 'delivery_id', deliveryId, input.items);
    audit(db, actor.id, 'CREATE', 'SALES_DELIVERY', deliveryId, '创建销售出库单 ' + deliveryNo);
  });
  return send(res, 201, { id: deliveryId, deliveryNo });
}

function getSalesDelivery(db, res, actor, deliveryId) {
  allowAny(actor, ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE']);
  const delivery = db.prepare('SELECT sd.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, so.order_no soNo FROM sales_deliveries sd JOIN customers c ON c.id = sd.customer_id JOIN warehouses w ON w.id = sd.warehouse_id JOIN users creator ON creator.id = sd.creator_id LEFT JOIN users confirmed ON confirmed.id = sd.confirmed_by LEFT JOIN sales_orders so ON so.id = sd.sales_order_id WHERE sd.id = ?').get(deliveryId);
  if (!delivery) throw new HttpError(404, '销售出库单不存在');
  delivery.items = db.prepare('SELECT sdi.*,sdi.product_id productId,sdi.unit_price_cents unitPriceCents,sdi.amount_cents amountCents,sdi.line_no lineNo,p.code productCode,p.name productName,p.unit FROM sales_delivery_items sdi JOIN products p ON p.id = sdi.product_id WHERE sdi.delivery_id = ? ORDER BY sdi.line_no').all(deliveryId);
  delivery.statusLabel = DELIVERY_STATUS[delivery.status] || delivery.status;
  return send(res, 200, { salesDelivery: delivery });
}

async function updateSalesDelivery(db, req, res, actor, deliveryId) {
  allow(actor, 'SALES_DELIVERIES_MANAGE');
  const current = db.prepare('SELECT * FROM sales_deliveries WHERE id=?').get(deliveryId);
  if (!current) throw new HttpError(404, '销售出库单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以修改');
  const body = await readJson(req);
  requireActiveReference(db, 'customers', body.customerId, '客户');
  requireActiveReference(db, 'warehouses', body.warehouseId, '仓库');
  const input = normalizeWarehouseItems(db, body.items);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE sales_deliveries SET customer_id=?,warehouse_id=?,delivery_date=?,remark=?,total_cents=?,updated_at=? WHERE id=?')
      .run(body.customerId, body.warehouseId, normalizeDocumentDate(body.deliveryDate || current.delivery_date, '发货日期'), optionalText(body.remark, 500), input.totalCents, now, deliveryId);
    replaceLogisticsItems(db, 'sales_delivery_items', 'delivery_id', deliveryId, input.items);
    audit(db, actor.id, 'UPDATE', 'SALES_DELIVERY', deliveryId, '修改销售出库 ' + current.delivery_no);
  });
  return send(res, 200, { ok: true, id: deliveryId, deliveryNo: current.delivery_no, totalCents: input.totalCents });
}

async function confirmSalesDelivery(db, req, res, actor, deliveryId) {
  allow(actor, 'SALES_DELIVERIES_MANAGE');
  const delivery = db.prepare('SELECT * FROM sales_deliveries WHERE id = ?').get(deliveryId);
  if (!delivery) throw new HttpError(404, '销售出库单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    transaction(db, () => {
      const locked = db.prepare('SELECT * FROM sales_deliveries WHERE id=?').get(deliveryId);
      if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
      checkPeriodNotClosedForVoucher(db, locked.delivery_date, '生成业务');
      const authoritative = authoritativeLogisticsTotal(db, 'sales_delivery_items', 'delivery_id', deliveryId);
      for (const item of authoritative.items) {
        const current = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(delivery.warehouse_id, item.product_id);
        if (!current || current.quantity < item.quantity) throw new HttpError(400, '库存不足');
        const balance = adjustInventory(db, delivery.warehouse_id, item.product_id, -item.quantity, now);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'OUT\',?,\'SALES_DELIVERY\',?,?,?,?,?)').run(id(), delivery.warehouse_id, item.product_id, item.quantity, balance, deliveryId, delivery.delivery_no, '销售出库', actor.id, now);
      }
      db.prepare('UPDATE sales_deliveries SET total_cents=?,status=\'CONFIRMED\', confirmed_at=?, confirmed_by=?, updated_at=? WHERE id=?').run(authoritative.totalCents, now, actor.id, now, deliveryId);
      const customerName = db.prepare('SELECT name FROM customers WHERE id = ?').get(delivery.customer_id)?.name || '';
      generateVoucher(db, 'SALES_DELIVERY', deliveryId, [
        { subjectId: 'subject-003', direction: 'DEBIT', amountCents: authoritative.totalCents, summary: '销售出库 ' + delivery.delivery_no + ' ' + customerName },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: authoritative.totalCents, summary: '销售出库 ' + delivery.delivery_no + ' 确认收入' }
      ], actor, locked.delivery_date);
      audit(db, actor.id, 'CONFIRM', 'SALES_DELIVERY', deliveryId, '确认销售出库 ' + delivery.delivery_no);
    });
  } else if (action === 'cancel') {
    if (delivery.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE sales_deliveries SET status=\'CANCELLED\', updated_at=? WHERE id=?').run(now, deliveryId);
    audit(db, actor.id, 'CANCEL', 'SALES_DELIVERY', deliveryId, '取消销售出库 ' + delivery.delivery_no);
  } else throw new HttpError(400, '无效操作');
  return send(res, 200, { ok: true });
}

// ============ Sales Returns ============

function listSalesReturns(db, res, actor, url) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  let where = '(sr.return_no LIKE ? OR c.name LIKE ?)';
  const params = [search, search];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { where += ' AND sr.status = ?'; params.push(status); }
  const sql = 'SELECT sr.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, (SELECT count(*) FROM return_order_items WHERE return_id = sr.id) itemCount FROM return_orders sr JOIN customers c ON c.id = sr.customer_id JOIN warehouses w ON w.id = sr.warehouse_id JOIN users creator ON creator.id = sr.creator_id LEFT JOIN users confirmed ON confirmed.id = sr.confirmed_by WHERE ' + where + ' ORDER BY sr.created_at DESC LIMIT 100';
  const returns = db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: RETURN_STATUS[row.status] || row.status }));
  return send(res, 200, { salesReturns: returns });
}

async function createSalesReturn(db, req, res, actor) {
  allow(actor, 'RETURNS_MANAGE');
  const body = await readJson(req);
  const { deliveryId, customerId, warehouseId, remark, items } = body;
  const returnDate = normalizeDocumentDate(body?.returnDate || new Date().toISOString().slice(0, 10), '退货日期');
  requireActiveReference(db, 'customers', customerId, '客户');
  requireActiveReference(db, 'warehouses', warehouseId, '仓库');
  if (deliveryId && !db.prepare('SELECT 1 FROM sales_deliveries WHERE id=?').get(deliveryId)) throw new HttpError(400, '销售出库单不存在');
  const input = normalizeWarehouseItems(db, items);
  const returnId = id();
  const now = new Date().toISOString();
  const returnNo = 'SRET' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO return_orders(id,return_no,source_type,source_id,delivery_id,customer_id,warehouse_id,status,total_cents,return_date,remark,creator_id,created_at,updated_at) VALUES(?,?,\'SALES\',?,?,?,?,\'DRAFT\',?,?,?,?,?,?)').run(returnId, returnNo, deliveryId || null, deliveryId || null, customerId, warehouseId, input.totalCents, returnDate, optionalText(remark, 500), actor.id, now, now);
    replaceLogisticsItems(db, 'return_order_items', 'return_id', returnId, input.items);
    audit(db, actor.id, 'CREATE', 'SALES_RETURN', returnId, '创建销售退货单 ' + returnNo);
  });
  return send(res, 201, { id: returnId, returnNo });
}

function getSalesReturn(db, res, actor, returnId) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const ret = db.prepare('SELECT sr.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, sd.delivery_no deliveryNo FROM return_orders sr JOIN customers c ON c.id = sr.customer_id JOIN warehouses w ON w.id = sr.warehouse_id JOIN users creator ON creator.id = sr.creator_id LEFT JOIN users confirmed ON confirmed.id = sr.confirmed_by LEFT JOIN sales_deliveries sd ON sd.id = sr.delivery_id WHERE sr.id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '销售退货单不存在');
  ret.items = db.prepare('SELECT sri.*,sri.product_id productId,sri.unit_price_cents unitPriceCents,sri.amount_cents amountCents,sri.line_no lineNo,p.code productCode,p.name productName,p.unit FROM return_order_items sri JOIN products p ON p.id = sri.product_id WHERE sri.return_id = ? ORDER BY sri.line_no').all(returnId);
  ret.statusLabel = RETURN_STATUS[ret.status] || ret.status;
  return send(res, 200, { salesReturn: ret });
}

async function updateSalesReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const current = db.prepare("SELECT * FROM return_orders WHERE id=? AND source_type='SALES'").get(returnId);
  if (!current) throw new HttpError(404, '销售退货单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以修改');
  const body = await readJson(req);
  requireActiveReference(db, 'customers', body.customerId, '客户');
  requireActiveReference(db, 'warehouses', body.warehouseId, '仓库');
  const input = normalizeWarehouseItems(db, body.items);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE return_orders SET customer_id=?,warehouse_id=?,return_date=?,remark=?,total_cents=?,updated_at=? WHERE id=?')
      .run(body.customerId, body.warehouseId, normalizeDocumentDate(body.returnDate || current.return_date, '退货日期'), optionalText(body.remark, 500), input.totalCents, now, returnId);
    replaceLogisticsItems(db, 'return_order_items', 'return_id', returnId, input.items);
    audit(db, actor.id, 'UPDATE', 'SALES_RETURN', returnId, '修改销售退货 ' + current.return_no);
  });
  return send(res, 200, { ok: true, id: returnId, returnNo: current.return_no, totalCents: input.totalCents });
}

async function confirmSalesReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const ret = db.prepare('SELECT * FROM return_orders WHERE id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '销售退货单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    transaction(db, () => {
      const locked = db.prepare("SELECT * FROM return_orders WHERE id=? AND source_type='SALES'").get(returnId);
      if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
      checkPeriodNotClosedForVoucher(db, locked.return_date, '生成业务');
      const authoritative = authoritativeLogisticsTotal(db, 'return_order_items', 'return_id', returnId);
      for (const item of authoritative.items) {
        const balance = adjustInventory(db, ret.warehouse_id, item.product_id, item.quantity, now);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'IN\',?,\'SALES_RETURN\',?,?,?,?,?)').run(id(), ret.warehouse_id, item.product_id, item.quantity, balance, returnId, ret.return_no, '销售退货', actor.id, now);
      }
      db.prepare('UPDATE return_orders SET total_cents=?,status=\'CONFIRMED\',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?').run(authoritative.totalCents, now, actor.id, now, returnId);
      const customerName = db.prepare('SELECT name FROM customers WHERE id = ?').get(ret.customer_id)?.name || '';
      generateVoucher(db, 'SALES_RETURN', returnId, [
        { subjectId: 'subject-006', direction: 'DEBIT', amountCents: authoritative.totalCents, summary: '销售退货 ' + ret.return_no + ' 收入冲减' },
        { subjectId: 'subject-003', direction: 'CREDIT', amountCents: authoritative.totalCents, summary: '销售退货 ' + ret.return_no + ' ' + customerName }
      ], actor, locked.return_date);
      audit(db, actor.id, 'CONFIRM', 'SALES_RETURN', returnId, '确认销售退货 ' + ret.return_no);
    });
  } else if (action === 'cancel') {
    if (ret.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE return_orders SET status=\'CANCELLED\',updated_at=? WHERE id=?').run(now, returnId);
    audit(db, actor.id, 'CANCEL', 'SALES_RETURN', returnId, '取消销售退货 ' + ret.return_no);
  } else throw new HttpError(400, '无效操作');
  return send(res, 200, { ok: true });
}

// ============ Purchase Returns ============

function listPurchaseReturns(db, res, actor, url) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  let where = '(pr.return_no LIKE ? OR s.name LIKE ?)';
  const params = [search, search];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { where += ' AND pr.status = ?'; params.push(status); }
  const sql = 'SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, (SELECT count(*) FROM purchase_return_items WHERE return_id = pr.id) itemCount FROM purchase_returns pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.confirmed_by WHERE ' + where + ' ORDER BY pr.created_at DESC LIMIT 100';
  const returns = db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: RETURN_STATUS[row.status] || row.status }));
  return send(res, 200, { purchaseReturns: returns });
}

async function createPurchaseReturn(db, req, res, actor) {
  allow(actor, 'RETURNS_MANAGE');
  const body = await readJson(req);
  const { receiptId, supplierId, warehouseId, remark, items } = body;
  const returnDate = normalizeDocumentDate(body?.returnDate || new Date().toISOString().slice(0, 10), '退货日期');
  requireActiveReference(db, 'suppliers', supplierId, '供应商');
  requireActiveReference(db, 'warehouses', warehouseId, '仓库');
  if (receiptId && !db.prepare('SELECT 1 FROM purchase_receipts WHERE id=?').get(receiptId)) throw new HttpError(400, '采购入库单不存在');
  const input = normalizeWarehouseItems(db, items);
  const returnId = id();
  const now = new Date().toISOString();
  const returnNo = 'PRET' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,status,total_cents,return_date,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,\'DRAFT\',?,?,?,?,?,?)').run(returnId, returnNo, receiptId || null, supplierId, warehouseId, input.totalCents, returnDate, optionalText(remark, 500), actor.id, now, now);
    replaceLogisticsItems(db, 'purchase_return_items', 'return_id', returnId, input.items);
    audit(db, actor.id, 'CREATE', 'PURCHASE_RETURN', returnId, '创建采购退货单 ' + returnNo);
  });
  return send(res, 201, { id: returnId, returnNo });
}

function getPurchaseReturn(db, res, actor, returnId) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const ret = db.prepare('SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, prc.receipt_no receiptNo FROM purchase_returns pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.confirmed_by LEFT JOIN purchase_receipts prc ON prc.id = pr.receipt_id WHERE pr.id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '采购退货单不存在');
  ret.items = db.prepare('SELECT pri.*,pri.product_id productId,pri.unit_price_cents unitPriceCents,pri.amount_cents amountCents,pri.line_no lineNo,p.code productCode,p.name productName,p.unit FROM purchase_return_items pri JOIN products p ON p.id = pri.product_id WHERE pri.return_id = ? ORDER BY pri.line_no').all(returnId);
  ret.statusLabel = RETURN_STATUS[ret.status] || ret.status;
  return send(res, 200, { purchaseReturn: ret });
}

async function updatePurchaseReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const current = db.prepare('SELECT * FROM purchase_returns WHERE id=?').get(returnId);
  if (!current) throw new HttpError(404, '采购退货单不存在');
  if (current.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以修改');
  const body = await readJson(req);
  requireActiveReference(db, 'suppliers', body.supplierId, '供应商');
  requireActiveReference(db, 'warehouses', body.warehouseId, '仓库');
  const input = normalizeWarehouseItems(db, body.items);
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE purchase_returns SET supplier_id=?,warehouse_id=?,return_date=?,remark=?,total_cents=?,updated_at=? WHERE id=?')
      .run(body.supplierId, body.warehouseId, normalizeDocumentDate(body.returnDate || current.return_date, '退货日期'), optionalText(body.remark, 500), input.totalCents, now, returnId);
    replaceLogisticsItems(db, 'purchase_return_items', 'return_id', returnId, input.items);
    audit(db, actor.id, 'UPDATE', 'PURCHASE_RETURN', returnId, '修改采购退货 ' + current.return_no);
  });
  return send(res, 200, { ok: true, id: returnId, returnNo: current.return_no, totalCents: input.totalCents });
}

async function confirmPurchaseReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '采购退货单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    transaction(db, () => {
      const locked = db.prepare('SELECT * FROM purchase_returns WHERE id=?').get(returnId);
      if (locked.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
      checkPeriodNotClosedForVoucher(db, locked.return_date, '生成业务');
      const authoritative = authoritativeLogisticsTotal(db, 'purchase_return_items', 'return_id', returnId);
      for (const item of authoritative.items) {
        const current = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(ret.warehouse_id, item.product_id);
        if (!current || current.quantity < item.quantity) throw new HttpError(400, '库存不足');
        const balance = adjustInventory(db, ret.warehouse_id, item.product_id, -item.quantity, now);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'OUT\',?,\'PURCHASE_RETURN\',?,?,?,?,?)').run(id(), ret.warehouse_id, item.product_id, item.quantity, balance, returnId, ret.return_no, '采购退货', actor.id, now);
      }
      db.prepare('UPDATE purchase_returns SET total_cents=?,status=\'CONFIRMED\',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?').run(authoritative.totalCents, now, actor.id, now, returnId);
      const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(ret.supplier_id)?.name || '';
      generateVoucher(db, 'PURCHASE_RETURN', returnId, [
        { subjectId: 'subject-005', direction: 'DEBIT', amountCents: authoritative.totalCents, summary: '采购退货 ' + ret.return_no + ' ' + supplierName },
        { subjectId: 'subject-004', direction: 'CREDIT', amountCents: authoritative.totalCents, summary: '采购退货 ' + ret.return_no }
      ], actor, locked.return_date);
      audit(db, actor.id, 'CONFIRM', 'PURCHASE_RETURN', returnId, '确认采购退货 ' + ret.return_no);
    });
  } else if (action === 'cancel') {
    if (ret.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE purchase_returns SET status=\'CANCELLED\',updated_at=? WHERE id=?').run(now, returnId);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_RETURN', returnId, '取消采购退货 ' + ret.return_no);
  } else throw new HttpError(400, '无效操作');
  return send(res, 200, { ok: true });
}

// ============ Inventory Transactions ============

function listInventoryTransactions(db, res, actor, url) {
  allow(actor, 'INVENTORY_VIEW');
  const warehouseId = url.searchParams.get('warehouse');
  const productId = url.searchParams.get('product');
  let where = []; let params = [];
  if (warehouseId) { where.push('t.warehouse_id = ?'); params.push(warehouseId); }
  if (productId) { where.push('t.product_id = ?'); params.push(productId); }
  const sql = "SELECT t.*,t.source_type tx_type,t.source_no ref_no,CASE WHEN t.direction='OUT' THEN -t.quantity_change ELSE t.quantity_change END quantity,t.balance_after balance,w.code warehouseCode,w.name warehouseName,p.code productCode,p.name productName,p.unit FROM inventory_transactions t JOIN warehouses w ON w.id = t.warehouse_id JOIN products p ON p.id = t.product_id " + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY t.created_at DESC LIMIT 200';
  const inventoryTransactions = db.prepare(sql).all(...params);
  return send(res, 200, { inventoryTransactions, transactions: inventoryTransactions });
}


// ============ Accounts Receivable ============

function listAccountsReceivable(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AR_VIEW', 'AR_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  const customerId = url.searchParams.get('customer');
  let where = '(ar.id LIKE ? OR c.name LIKE ?)';
  let params = [search, search];
  if (status) { where += ' AND ar.status = ?'; params.push(status); }
  if (customerId) { where += ' AND ar.customer_id = ?'; params.push(customerId); }
  const sql = 'SELECT ar.*, c.code customerCode, c.name customerName, (ar.amount_cents - ar.paid_cents) unpaidCents FROM account_receivables ar JOIN customers c ON c.id = ar.customer_id WHERE ' + where + ' ORDER BY ar.created_at DESC LIMIT 100';
  return send(res, 200, { receivables: db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: AR_STATUS[row.status] || row.status })) });
}

async function createAccountReceivable(db, req, res, actor) {
  allow(actor, 'AR_MANAGE');
  const body = await readJson(req);
  const { sourceType, sourceId, customerId, amountCents, dueDate } = body;
  const now = new Date().toISOString();
  const arId = id();
  db.prepare('INSERT INTO account_receivables(id,source_type,source_id,customer_id,amount_cents,paid_cents,status,due_date,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?,?)').run(arId, sourceType, sourceId, customerId, amountCents, 'OPEN', dueDate || null, now, now);
  audit(db, actor.id, 'CREATE', 'ACCOUNT_RECEIVABLE', arId, '创建应收账款 ' + amountCents / 100 + '元');
  return send(res, 200, { id: arId });
}

function getAccountReceivable(db, res, actor, arId) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AR_VIEW', 'AR_MANAGE']);
  const ar = db.prepare('SELECT ar.*, c.code customerCode, c.name customerName FROM account_receivables ar JOIN customers c ON c.id = ar.customer_id WHERE ar.id=?').get(arId);
  if (!ar) throw new HttpError(404, '应收账款不存在');
  ar.unpaidCents = ar.amount_cents - ar.paid_cents;
  ar.statusLabel = AR_STATUS[ar.status] || ar.status;
  // Get linked payment collections
  ar.payments = db.prepare('SELECT pci.*, pc.collection_no, pc.amount_cents collectionAmount, pc.collection_date FROM payment_collection_items pci JOIN payment_collections pc ON pc.id = pci.collection_id WHERE pci.receivable_id=?').all(arId);
  return send(res, 200, { receivable: ar });
}

// ============ Accounts Payable ============

// ============ Narrow Lookups (warehouse / logistics-flavored) ============
// Return minimal id+code+name projections so warehouse workflows (purchase
// receipts, sales deliveries, returns) can populate party pickers without
// granting full master-data *_MANAGE permissions. Gated by INVENTORY_VIEW
// which warehouse already holds. Safe for production: the response body
// contains no PII, no contact info, no balances.
//
// Pattern matches /api/users/lookup (project-manager candidates).
function listSupplierLookup(db, res, actor, url) {
  allowAny(actor, ['PURCHASE_RECEIPTS_MANAGE', 'RETURNS_MANAGE', 'CRM_VIEW', 'CRM_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const suppliers = db.prepare("SELECT id, code, name FROM suppliers WHERE active=1 AND (code LIKE ? OR name LIKE ?) ORDER BY code").all(search, search);
  return send(res, 200, { suppliers });
}

function listCustomerLookup(db, res, actor, url) {
  allowAny(actor, ['SALES_DELIVERIES_MANAGE', 'RETURNS_MANAGE', 'CRM_VIEW', 'CRM_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const customers = db.prepare("SELECT id, code, name FROM customers WHERE active=1 AND (code LIKE ? OR name LIKE ?) ORDER BY code").all(search, search);
  return send(res, 200, { customers });
}

function listAccountsPayable(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AP_VIEW', 'AP_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  const supplierId = url.searchParams.get('supplier');
  let where = '(ap.id LIKE ? OR s.name LIKE ?)';
  let params = [search, search];
  if (status) { where += ' AND ap.status = ?'; params.push(status); }
  if (supplierId) { where += ' AND ap.supplier_id = ?'; params.push(supplierId); }
  const sql = 'SELECT ap.*, s.code supplierCode, s.name supplierName, (ap.amount_cents - ap.paid_cents) unpaidCents FROM account_payables ap JOIN suppliers s ON s.id = ap.supplier_id WHERE ' + where + ' ORDER BY ap.created_at DESC LIMIT 100';
  return send(res, 200, { payables: db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: AP_STATUS[row.status] || row.status })) });
}

async function createAccountPayable(db, req, res, actor) {
  allow(actor, 'AP_MANAGE');
  const body = await readJson(req);
  const { sourceType, sourceId, supplierId, amountCents, dueDate } = body;
  const now = new Date().toISOString();
  const apId = id();
  db.prepare('INSERT INTO account_payables(id,source_type,source_id,supplier_id,amount_cents,paid_cents,status,due_date,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?,?)').run(apId, sourceType, sourceId, supplierId, amountCents, 'OPEN', dueDate || null, now, now);
  audit(db, actor.id, 'CREATE', 'ACCOUNT_PAYABLE', apId, '创建应付账款 ' + amountCents / 100 + '元');
  return send(res, 200, { id: apId });
}

function getAccountPayable(db, res, actor, apId) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AP_VIEW', 'AP_MANAGE']);
  const ap = db.prepare('SELECT ap.*, s.code supplierCode, s.name supplierName FROM account_payables ap JOIN suppliers s ON s.id = ap.supplier_id WHERE ap.id=?').get(apId);
  if (!ap) throw new HttpError(404, '应付账款不存在');
  ap.unpaidCents = ap.amount_cents - ap.paid_cents;
  ap.statusLabel = AP_STATUS[ap.status] || ap.status;
  ap.payments = db.prepare('SELECT pdi.*, pd.disbursement_no, pd.amount_cents disbursementAmount, pd.disbursement_date FROM payment_disbursement_items pdi JOIN payment_disbursements pd ON pd.id = pdi.disbursement_id WHERE pdi.payable_id=?').all(apId);
  return send(res, 200, { payable: ap });
}

// ============ Payment Collections ============

function listPaymentCollections(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AR_VIEW', 'AR_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const customerId = url.searchParams.get('customer');
  let where = '(pc.collection_no LIKE ? OR c.name LIKE ?)';
  let params = [search, search];
  if (customerId) { where += ' AND pc.customer_id = ?'; params.push(customerId); }
  const sql = 'SELECT pc.id, pc.collection_no collectionNo, pc.amount_cents amountCents, pc.payment_method paymentMethod, pc.collection_date collectionDate, pc.remark, c.code customerCode, c.name customerName FROM payment_collections pc JOIN customers c ON c.id = pc.customer_id WHERE ' + where + ' ORDER BY pc.created_at DESC LIMIT 100';
  return send(res, 200, { collections: db.prepare(sql).all(...params) });
}

async function createPaymentCollection(db, req, res, actor) {
  allow(actor, 'AR_MANAGE');
  const body = await readJson(req);
  const { customerId, amountCents, paymentMethod, bankAccount, collectionDate, remark, items } = body;
  const now = new Date().toISOString();
  const effectiveDate = collectionDate || now.slice(0,10);
  if (!Number.isSafeInteger(Number(amountCents)) || Number(amountCents) < 0) throw new HttpError(400, '收款金额不正确');
  checkPeriodNotClosedForVoucher(db, effectiveDate, '生成业务');
  const pcId = id();
  const pcNo = 'PC-' + Date.now().toString(36).toUpperCase();
  transaction(db, () => {
    db.prepare('INSERT INTO payment_collections(id,collection_no,customer_id,amount_cents,payment_method,bank_account,collection_date,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(pcId, pcNo, customerId, Number(amountCents), paymentMethod || 'BANK', bankAccount || '', effectiveDate, remark || '', actor.id, now);
    const itemStmt = db.prepare('INSERT INTO payment_collection_items(id,collection_id,receivable_id,amount_cents) VALUES(?,?,?,?)');
    for (const item of (items || [])) {
      itemStmt.run(id(), pcId, item.receivableId, item.amountCents);
      const ar = db.prepare('SELECT * FROM account_receivables WHERE id=?').get(item.receivableId);
      if (ar) {
        const newPaid = ar.paid_cents + item.amountCents;
        const newStatus = newPaid >= ar.amount_cents ? 'CLOSED' : (newPaid > 0 ? 'PARTIAL' : 'OPEN');
        db.prepare('UPDATE account_receivables SET paid_cents=?,status=?,updated_at=? WHERE id=?').run(newPaid, newStatus, now, item.receivableId);
      }
    }
    const subjectDr = paymentMethod === 'CASH' ? 'subject-001' : 'subject-002';
    generateVoucher(db, 'PAYMENT_COLLECTION', pcId, [
      { subjectId: subjectDr, direction: 'DEBIT', amountCents: Number(amountCents), summary: '收款 ' + pcNo },
      { subjectId: 'subject-003', direction: 'CREDIT', amountCents: Number(amountCents), summary: '收款 ' + pcNo + ' 应收结清' }
    ], actor, effectiveDate);
    audit(db, actor.id, 'CREATE', 'PAYMENT_COLLECTION', pcId, '创建收款单 ' + pcNo + ' 金额' + amountCents / 100 + '元');
  });
  return send(res, 200, { id: pcId, collectionNo: pcNo });
}

function getPaymentCollection(db, res, actor, pcId) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AR_VIEW', 'AR_MANAGE']);
  const pc = db.prepare('SELECT pc.*, c.code customerCode, c.name customerName, creator.display_name creatorName FROM payment_collections pc JOIN customers c ON c.id = pc.customer_id JOIN users creator ON creator.id = pc.creator_id WHERE pc.id=?').get(pcId);
  if (!pc) throw new HttpError(404, '收款单不存在');
  pc.items = db.prepare('SELECT pci.*, ar.source_type, ar.source_id FROM payment_collection_items pci JOIN account_receivables ar ON ar.id = pci.receivable_id WHERE pci.collection_id=?').all(pcId);
  return send(res, 200, { collection: pc });
}

// ============ Payment Disbursements ============

function listPaymentDisbursements(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AP_VIEW', 'AP_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const supplierId = url.searchParams.get('supplier');
  let where = '(pd.disbursement_no LIKE ? OR s.name LIKE ?)';
  let params = [search, search];
  if (supplierId) { where += ' AND pd.supplier_id = ?'; params.push(supplierId); }
  const sql = 'SELECT pd.*, s.code supplierCode, s.name supplierName, creator.display_name creatorName FROM payment_disbursements pd JOIN suppliers s ON s.id = pd.supplier_id JOIN users creator ON creator.id = pd.creator_id WHERE ' + where + ' ORDER BY pd.created_at DESC LIMIT 100';
  return send(res, 200, { disbursements: db.prepare(sql).all(...params) });
}

async function createPaymentDisbursement(db, req, res, actor) {
  allow(actor, 'AP_MANAGE');
  const body = await readJson(req);
  const { supplierId, amountCents, paymentMethod, bankAccount, disbursementDate, remark, items } = body;
  const now = new Date().toISOString();
  const effectiveDate = disbursementDate || now.slice(0,10);
  if (!Number.isSafeInteger(Number(amountCents)) || Number(amountCents) < 0) throw new HttpError(400, '付款金额不正确');
  checkPeriodNotClosedForVoucher(db, effectiveDate, '生成业务');
  const pdId = id();
  const pdNo = 'PD-' + Date.now().toString(36).toUpperCase();
  transaction(db, () => {
    db.prepare('INSERT INTO payment_disbursements(id,disbursement_no,supplier_id,amount_cents,payment_method,bank_account,disbursement_date,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(pdId, pdNo, supplierId, Number(amountCents), paymentMethod || 'BANK', bankAccount || '', effectiveDate, remark || '', actor.id, now);
    const itemStmt = db.prepare('INSERT INTO payment_disbursement_items(id,disbursement_id,payable_id,amount_cents) VALUES(?,?,?,?)');
    for (const item of (items || [])) {
      itemStmt.run(id(), pdId, item.payableId, item.amountCents);
      const ap = db.prepare('SELECT * FROM account_payables WHERE id=?').get(item.payableId);
      if (ap) {
        const newPaid = ap.paid_cents + item.amountCents;
        const newStatus = newPaid >= ap.amount_cents ? 'CLOSED' : (newPaid > 0 ? 'PARTIAL' : 'OPEN');
        db.prepare('UPDATE account_payables SET paid_cents=?,status=?,updated_at=? WHERE id=?').run(newPaid, newStatus, now, item.payableId);
      }
    }
    const subjectCr = paymentMethod === 'CASH' ? 'subject-001' : 'subject-002';
    generateVoucher(db, 'PAYMENT_DISBURSEMENT', pdId, [
      { subjectId: 'subject-005', direction: 'DEBIT', amountCents: Number(amountCents), summary: '付款 ' + pdNo },
      { subjectId: subjectCr, direction: 'CREDIT', amountCents: Number(amountCents), summary: '付款 ' + pdNo + ' 应付结清' }
    ], actor, effectiveDate);
    audit(db, actor.id, 'CREATE', 'PAYMENT_DISBURSEMENT', pdId, '创建付款单 ' + pdNo + ' 金额' + amountCents / 100 + '元');
  });
  return send(res, 200, { id: pdId, disbursementNo: pdNo });
}

function getPaymentDisbursement(db, res, actor, pdId) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'AP_VIEW', 'AP_MANAGE']);
  const pd = db.prepare('SELECT pd.*, s.code supplierCode, s.name supplierName, creator.display_name creatorName FROM payment_disbursements pd JOIN suppliers s ON s.id = pd.supplier_id JOIN users creator ON creator.id = pd.creator_id WHERE pd.id=?').get(pdId);
  if (!pd) throw new HttpError(404, '付款单不存在');
  pd.items = db.prepare('SELECT pdi.*, ap.source_type, ap.source_id FROM payment_disbursement_items pdi JOIN account_payables ap ON ap.id = pdi.payable_id WHERE pdi.disbursement_id=?').all(pdId);
  return send(res, 200, { disbursement: pd });
}


// ============ BOM ============

function listBoms(db, res, actor, url) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const productId = url.searchParams.get('product');
  let where = '1=1';
  let params = [];
  if (productId) { where += ' AND b.product_id = ?'; params.push(productId); }
  const sql = 'SELECT b.*, p.code productCode, p.name productName, creator.display_name creatorName, (SELECT count(*) FROM bom_items WHERE bom_id=b.id) itemCount FROM boms b JOIN products p ON p.id=b.product_id JOIN users creator ON creator.id=b.creator_id WHERE ' + where + ' ORDER BY b.created_at DESC LIMIT 100';
  return send(res, 200, { boms: db.prepare(sql).all(...params) });
}

function requirePositiveQuantity(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, label + '必须大于0');
  return n;
}

function requireScrapRate(value, label) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, label + '必须在0到1之间');
  return n;
}

function validateBomPayload(db, body, options = {}) {
  const productId = String(body.productId ?? body.product_id ?? '').trim();
  if (!options.existingProductId && !productId) throw new HttpError(400, '请选择父项产品');
  const parentProductId = options.existingProductId || productId;
  const parent = db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(parentProductId);
  if (!parent) throw new HttpError(400, '父项产品不存在或已停用');
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, 'BOM至少需要一条物料明细');

  const seen = new Set();
  const items = rawItems.map((item, index) => {
    const componentId = String(item?.productId ?? item?.product_id ?? '').trim();
    if (!componentId) throw new HttpError(400, `第${index + 1}行物料不能为空`);
    if (componentId === parentProductId) throw new HttpError(400, 'BOM物料不能引用父项产品本身');
    if (seen.has(componentId)) throw new HttpError(400, 'BOM物料不能重复');
    seen.add(componentId);
    const component = db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(componentId);
    if (!component) throw new HttpError(400, `第${index + 1}行物料不存在或已停用`);
    return {
      productId: componentId,
      quantity: requirePositiveQuantity(item.quantity, `第${index + 1}行用量`),
      scrapRate: requireScrapRate(item.scrapRate ?? item.scrap_rate, `第${index + 1}行损耗率`),
    };
  });

  return { productId: parentProductId, version: String(body.version ?? '1.0').trim() || '1.0', remark: optionalText(body.remark, 500), items };
}

async function createBom(db, req, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_CREATE');
  const body = await readJson(req);
  const bom = validateBomPayload(db, body);
  const now = new Date().toISOString();
  const bomId = id();
  transaction(db, () => {
    db.prepare("UPDATE boms SET status='DISCONTINUED',updated_at=? WHERE product_id=? AND status='ACTIVE'").run(now, bom.productId);
    db.prepare('INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(bomId, bom.productId, bom.version, 'ACTIVE', bom.remark, actor.id, now, now);
    const itemStmt = db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
    let lineNo = 1;
    for (const item of bom.items) {
      itemStmt.run(id(), bomId, item.productId, item.quantity, item.scrapRate, lineNo++);
    }
    audit(db, actor.id, 'CREATE', 'BOM', bomId, '创建物料清单 BOM-' + bom.version);
  });
  return send(res, 200, { id: bomId });
}

function getBom(db, res, actor, bomId) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const bom = db.prepare('SELECT b.*, p.code productCode, p.name productName, creator.display_name creatorName FROM boms b JOIN products p ON p.id=b.product_id JOIN users creator ON creator.id=b.creator_id WHERE b.id=?').get(bomId);
  if (!bom) throw new HttpError(404, 'BOM不存在');
  bom.items = db.prepare('SELECT bi.*, p.code productCode, p.name productName, p.unit FROM bom_items bi JOIN products p ON p.id=bi.product_id WHERE bi.bom_id=? ORDER BY bi.line_no').all(bomId);
  return send(res, 200, { bom });
}

async function updateBom(db, req, res, actor, bomId) {
  allow(actor, 'PRODUCTION_ORDERS_CREATE');
  const body = await readJson(req);
  const { action } = body;
  const now = new Date().toISOString();
  const current = db.prepare('SELECT * FROM boms WHERE id=?').get(bomId);
  if (!current) throw new HttpError(404, 'BOM不存在');
  if (action === 'deactivate') {
    if (current.status === 'DISCONTINUED') return send(res, 200, { ok: true });
    transaction(db, () => {
      db.prepare("UPDATE boms SET status='DISCONTINUED',updated_at=? WHERE id=?").run(now, bomId);
      audit(db, actor.id, 'UPDATE', 'BOM', bomId, '停用BOM');
    });
    return send(res, 200, { ok: true });
  }
  if (current.status === 'DISCONTINUED') throw new HttpError(409, '已停用的BOM不可修改');
  const bom = validateBomPayload(db, body, { existingProductId: current.product_id });
  transaction(db, () => {
    db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(bomId);
    const itemStmt = db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
    let lineNo = 1;
    for (const item of bom.items) {
      itemStmt.run(id(), bomId, item.productId, item.quantity, item.scrapRate, lineNo++);
    }
    db.prepare('UPDATE boms SET remark=?,updated_at=? WHERE id=?').run(bom.remark, now, bomId);
    audit(db, actor.id, 'UPDATE', 'BOM', bomId, '更新BOM');
  });
  return send(res, 200, { ok: true });
}

// ============ Production Orders ============

function listProductionOrders(db, res, actor, url) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  let where = '(po.order_no LIKE ? OR p.name LIKE ?)';
  let params = [search, search];
  if (status) { where += ' AND po.status = ?'; params.push(status); }
  const sql = 'SELECT po.*, p.code productCode, p.name productName, b.version bomVersion, creator.display_name creatorName, (SELECT sum(consumed_quantity) FROM production_order_items WHERE order_id=po.id) totalConsumed, (SELECT sum(quantity) FROM production_outputs WHERE order_id=po.id) totalOutput FROM production_orders po JOIN products p ON p.id=po.product_id LEFT JOIN boms b ON b.id=po.bom_id JOIN users creator ON creator.id=po.creator_id WHERE ' + where + ' ORDER BY po.created_at DESC LIMIT 100';
  return send(res, 200, { orders: db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: PO_STATUS[row.status] || row.status })) });
}

async function createProductionOrder(db, req, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_CREATE');
  const body = await readJson(req);
  const { productId, bomId, quantity, plannedStart, plannedFinish, remark } = body;
  if (!productId) throw new HttpError(400, '请选择产品');
  const product = db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId);
  if (!product) throw new HttpError(400, '产品不存在或已停用');
  const orderQuantity = requirePositiveQuantity(quantity, '生产数量');
  if (bomId) {
    const bom = db.prepare("SELECT id, product_id, status FROM boms WHERE id=?").get(bomId);
    if (!bom) throw new HttpError(400, 'BOM不存在');
    if (bom.status !== 'ACTIVE') throw new HttpError(400, '只能使用启用的BOM');
    if (bom.product_id !== productId) throw new HttpError(400, 'BOM与生产产品不匹配');
  }
  const now = new Date().toISOString();
  const poId = id();
  const poNo = 'MO-' + Date.now().toString(36).toUpperCase();
  transaction(db, () => {
    db.prepare('INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,planned_start,planned_finish,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(poId, poNo, productId, bomId || null, orderQuantity, 'PENDING', plannedStart || null, plannedFinish || null, optionalText(remark, 500), actor.id, now, now);
    if (bomId) {
      const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY line_no').all(bomId);
      const itemStmt = db.prepare('INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no) VALUES(?,?,?,?,0,?)');
      let lineNo = 1;
      for (const item of bomItems) {
        const requiredQty = item.quantity * orderQuantity * (1 + item.scrap_rate);
        itemStmt.run(id(), poId, item.product_id, requiredQty, lineNo++);
      }
    }
    audit(db, actor.id, 'CREATE', 'PRODUCTION_ORDER', poId, '创建生产工单 ' + poNo);
  });
  return send(res, 200, { id: poId, orderNo: poNo });
}

function getProductionOrder(db, res, actor, poId) {
  allow(actor, 'PRODUCTION_ORDERS_VIEW');
  const order = db.prepare('SELECT po.*, p.code productCode, p.name productName, b.version bomVersion, creator.display_name creatorName FROM production_orders po JOIN products p ON p.id=po.product_id LEFT JOIN boms b ON b.id=po.bom_id JOIN users creator ON creator.id=po.creator_id WHERE po.id=?').get(poId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  order.items = db.prepare('SELECT poi.*, p.code productCode, p.name productName, p.unit, p.stock_quantity availableStock FROM production_order_items poi JOIN products p ON p.id=poi.product_id WHERE poi.order_id=? ORDER BY poi.line_no').all(poId);
  order.outputs = db.prepare('SELECT * FROM production_outputs WHERE order_id=? ORDER BY created_at DESC').all(poId);
  order.statusLabel = PO_STATUS[order.status] || order.status;
  return send(res, 200, { order });
}

async function changeProductionOrderState(db, req, res, actor, poId) {
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(poId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  const body = await readJson(req);
  const { action } = body;
  const now = new Date().toISOString();
  if (action === 'start') {
    allow(actor, 'PRODUCTION_ORDERS_START');
    if (order.status !== 'PENDING') throw new HttpError(409, '只有待开工的工单可以开工');
    db.prepare("UPDATE production_orders SET status='IN_PROGRESS',actual_start=?,updated_at=? WHERE id=?").run(now, now, poId);
    audit(db, actor.id, 'START', 'PRODUCTION_ORDER', poId, '生产工单开工 ' + order.order_no);
  } else if (action === 'complete') {
    allow(actor, 'PRODUCTION_ORDERS_COMPLETE');
    if (order.status !== 'IN_PROGRESS') throw new HttpError(409, '只有生产中的工单可以完工');
    db.prepare("UPDATE production_orders SET status='COMPLETED',actual_finish=?,updated_at=? WHERE id=?").run(now, now, poId);
    audit(db, actor.id, 'COMPLETE', 'PRODUCTION_ORDER', poId, '生产工单完工 ' + order.order_no);
  } else if (action === 'cancel') {
    allowAny(actor, ['PRODUCTION_ORDERS_CREATE', 'PRODUCTION_ORDERS_START']);
    if (order.status === 'COMPLETED') throw new HttpError(409, '已完工的工单不能取消');
    if (order.status === 'CANCELLED') return send(res, 200, { ok: true, status: 'CANCELLED' });
    db.prepare("UPDATE production_orders SET status='CANCELLED',updated_at=? WHERE id=?").run(now, poId);
    audit(db, actor.id, 'CANCEL', 'PRODUCTION_ORDER', poId, '取消生产工单 ' + order.order_no);
  } else {
    throw new HttpError(400, '不支持的生产工单操作');
  }
  return send(res, 200, { ok: true });
}

// ============ Production Outputs ============

async function createProductionOutput(db, req, res, actor) {
  allow(actor, 'PRODUCTION_OUTPUT');
  const body = await readJson(req);
  const { orderId, quantity, qualifiedQuantity, outputDate, remark } = body;
  const now = new Date().toISOString();
  const outputId = id();
  db.prepare('INSERT INTO production_outputs(id,order_id,quantity,output_date,qualified_quantity,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(outputId, orderId, quantity, outputDate || now.slice(0,10), qualifiedQuantity || quantity, remark || '', actor.id, now);
  // Update inventory for the finished product
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(orderId);
  if (order) {
    // Add finished goods to inventory
    db.prepare('UPDATE inventory SET quantity=quantity+? WHERE product_id=? AND warehouse_id=(SELECT value FROM settings WHERE key=? AND active=1 LIMIT 1)').run(qualifiedQuantity || quantity, order.product_id);
    // Consume materials from BOM
    const items = db.prepare('SELECT * FROM production_order_items WHERE order_id=?').all(orderId);
    // Validate stock availability before consuming materials (prevent negative inventory)
    const warehouseId = db.prepare("SELECT value FROM settings WHERE key='?' AND active=1 LIMIT 1").get("default_warehouse")?.value;
    for (const item of items) {
      const inv = db.prepare("SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?").get(warehouseId, item.product_id);
      if (!inv || inv.quantity < item.consumed_quantity) {
        const product = db.prepare("SELECT code FROM products WHERE id=?").get(item.product_id);
        throw new HttpError(400, (product?.code || item.product_id) + " 库存不足，需要 " + item.consumed_quantity.toFixed(3) + "，实际 " + (inv?.quantity || 0).toFixed(3));
      }
    }
    // Now safe to consume materials
    for (const item of items) {
      db.prepare('UPDATE inventory SET quantity=quantity-? WHERE product_id=? AND warehouse_id=(SELECT value FROM settings WHERE key=? AND active=1 LIMIT 1)').run(item.consumed_quantity, item.product_id);
      db.prepare('UPDATE production_order_items SET consumed_quantity=? WHERE id=?').run(item.quantity, item.id);
      // Record inventory transactions
      db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,creator_id,created_at) VALUES(?,(SELECT value FROM settings WHERE key=? LIMIT 1),?,?,\'OUT\',0,?,?,?,?)').run(id(), 'default_warehouse', item.product_id, item.consumed_quantity, 'PRODUCTION_OUTPUT', outputId, actor.id, now);
    }
  }
  audit(db, actor.id, 'CREATE', 'PRODUCTION_OUTPUT', outputId, '生产完工入库 ' + quantity);
  return send(res, 200, { id: outputId });
}

const PO_STATUS = { PENDING: '待生产', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELLED: '已取消' };



const INVENTORY_CHECK_STATUS = { DRAFT: "草稿", SUBMITTED: "待审批", APPROVED: "已审批" };
const AR_STATUS = { OPEN: '未收', PARTIAL: '部分收款', CLOSED: '已结清' };
const AP_STATUS = { OPEN: '未付', PARTIAL: '部分付款', CLOSED: '已结清' };



const RECEIPT_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const DELIVERY_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const RETURN_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

// ============ Cash Journals ============

async function legacyListCashJournals(db, res, actor, url) {
  allowAny(actor, ['CASH_JOURNALS_VIEW', 'CASH_JOURNALS_MANAGE']);
  const search = url.searchParams.get('search') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  const accountType = url.searchParams.get('accountType') || '';
  
  let sql = `SELECT cj.*, u.name operatorName, ba.account_name bankName
    FROM cash_journals cj
    LEFT JOIN users u ON u.id=cj.operator_id
    LEFT JOIN bank_accounts ba ON ba.id=cj.bank_id
    WHERE 1=1`;
  const params = [];
  
  if (search) {
    sql += ` AND (cj.journal_no LIKE ? OR cj.summary LIKE ? OR cj.counterparty_name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (startDate) { sql += ` AND cj.journal_date >= ?`; params.push(startDate); }
  if (endDate) { sql += ` AND cj.journal_date <= ?`; params.push(endDate); }
  if (accountType) { sql += ` AND cj.account_type = ?`; params.push(accountType); }
  
  sql += ` ORDER BY cj.journal_date DESC, cj.created_at DESC`;
  
  const journals = db.prepare(sql).all(...params);
  return send(res, 200, { journals });
}

async function legacyCreateCashJournal(db, req, res, actor) {
  allow(actor, 'CASH_JOURNALS_MANAGE');
  const body = await readJson(req);
  const { journal_type, account_type, bank_account, amount_cents, direction, counterparty_type, counterparty_id, counterparty_name, subject_id, summary, journal_date, remark } = body;
  
  const now = new Date().toISOString();
  const journalId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM cash_journals WHERE journal_date LIKE ?').get(journal_date.slice(0,7) + '%').cnt + 1).padStart(4, '0');
  const journalNo = `CJ-${journal_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO cash_journals(id,journal_no,journal_type,account_type,bank_id,amount_cents,direction,counterparty_type,counterparty_id,counterparty_name,subject_id,summary,voucher_id,operator_id,journal_date,remark,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    journalId, journalNo, journal_type, account_type, bank_account || null, amount_cents, direction,
    counterparty_type || null, counterparty_id || null, counterparty_name || '', subject_id || null,
    summary, null, actor.id, journal_date, remark || '', now
  );
  
  audit(db, actor.id, 'CREATE', 'CASH_JOURNAL', journalId, `${direction === 'IN' ? '收款' : '付款'} ${money(amount_cents)} ${summary}`);
  return send(res, 200, { id: journalId, journal_no: journalNo });
}

// ============ Bank Accounts ============

async function legacyListBankAccounts(db, res, actor) {
  allowAny(actor, ['BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE']);
  const accounts = db.prepare('SELECT * FROM bank_accounts ORDER BY created_at DESC').all();
  return send(res, 200, { accounts });
}

async function legacyCreateBankAccount(db, req, res, actor) {
  allow(actor, 'BANK_ACCOUNTS_MANAGE');
  const body = await readJson(req);
  const { bank_name, account_no, account_name, initial_balance_cents, remark } = body;
  const now = new Date().toISOString();
  const accountId = id();
  
  db.prepare('INSERT INTO bank_accounts(id,bank_name,account_no,account_name,balance_cents,initial_balance_cents,active,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?)').run(
    accountId, bank_name, account_no, account_name, initial_balance_cents || 0, initial_balance_cents || 0, remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'BANK_ACCOUNT', accountId, `新建银行账户 ${account_name}`);
  return send(res, 200, { id: accountId });
}

async function legacyUpdateBankAccount(db, req, res, actor, accountId) {
  allow(actor, 'BANK_ACCOUNTS_MANAGE');
  const body = await readJson(req);
  const { bank_name, account_no, account_name, active, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE bank_accounts SET bank_name=?,account_no=?,account_name=?,active=?,remark=?,updated_at=? WHERE id=?').run(
    bank_name, account_no, account_name, active ? 1 : 0, remark || '', now, accountId
  );
  
  audit(db, actor.id, 'UPDATE', 'BANK_ACCOUNT', accountId, `更新银行账户 ${account_name}`);
  return send(res, 200, { ok: true });
}

// ============ Bills (Notes Payable/Receivable) ============

async function legacyListBills(db, res, actor, url) {
  allowAny(actor, ['BILLS_VIEW', 'BILLS_MANAGE']);
  const billType = url.searchParams.get('billType') || '';
  const status = url.searchParams.get('status') || '';
  
  let sql = `SELECT b.*, 
    CASE WHEN b.counterparty_type = 'CUSTOMER' THEN c.name ELSE s.name END counterpartyName,
    u.name creatorName
    FROM bills b
    LEFT JOIN customers c ON c.id=b.counterparty_id AND b.counterparty_type='CUSTOMER'
    LEFT JOIN suppliers s ON s.id=b.counterparty_id AND b.counterparty_type='SUPPLIER'
    LEFT JOIN users u ON u.id=b.creator_id
    WHERE 1=1`;
  const params = [];
  
  if (billType) { sql += ` AND b.bill_type = ?`; params.push(billType); }
  if (status) { sql += ` AND b.status = ?`; params.push(status); }
  
  sql += ` ORDER BY b.issue_date DESC, b.created_at DESC`;
  
  const bills = db.prepare(sql).all(...params);
  return send(res, 200, { bills });
}

async function legacyCreateBill(db, req, res, actor) {
  allow(actor, 'BILLS_MANAGE');
  const body = await readJson(req);
  const { bill_type, bill_no, counterparty_type, counterparty_id, face_amount_cents, issue_date, due_date, status, remark } = body;
  
  const now = new Date().toISOString();
  const billId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM bills WHERE bill_type=? AND issue_date LIKE ?').get(bill_type, issue_date.slice(0,7) + '%').cnt + 1).padStart(4, '0');
  const billNo = bill_no || `${bill_type === 'RECEivable' ? 'AR' : 'AP'}-${issue_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare('INSERT INTO bills(id,bill_type,bill_no,counterparty_type,counterparty_id,face_amount_cents,issue_date,due_date,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    billId, bill_type, billNo, counterparty_type, counterparty_id, face_amount_cents, issue_date, due_date, status || 'PENDING', remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'BILL', billId, `新建${bill_type === 'RECEivable' ? '应收' : '应付'}票据 ${billNo}`);
  return send(res, 200, { id: billId, bill_no: billNo });
}

async function legacyUpdateBill(db, req, res, actor, billId) {
  allow(actor, 'BILLS_MANAGE');
  const body = await readJson(req);
  const { bill_no, counterparty_id, face_amount_cents, issue_date, due_date, status, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE bills SET bill_no=?,counterparty_id=?,face_amount_cents=?,issue_date=?,due_date=?,status=?,remark=?,updated_at=? WHERE id=?').run(
    bill_no, counterparty_id, face_amount_cents, issue_date, due_date, status, remark || '', now, billId
  );
  
  audit(db, actor.id, 'UPDATE', 'BILL', billId, `更新票据 ${bill_no}`);
  return send(res, 200, { ok: true });
}

// ============ Fixed Assets ============

async function legacyListFixedAssets(db, res, actor) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const assets = db.prepare(`SELECT fa.*, u.name creatorName,
    (SELECT SUM(depreciation_cents) FROM asset_depreciations WHERE asset_id=fa.id) totalDepreciatedCents
    FROM fixed_assets fa
    LEFT JOIN users u ON u.id=fa.creator_id
    ORDER BY fa.purchase_date DESC`).all();
  return send(res, 200, { assets });
}

async function legacyCreateFixedAsset(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const { asset_code, asset_name, category, purchase_date, purchase_amount_cents, useful_life_months, salvage_value_cents, depreciation_method, remark } = body;
  
  const now = new Date().toISOString();
  const assetId = id();
  const monthlyDepreciation = depreciation_method === 'NONE' ? 0 : 
    Math.floor((purchase_amount_cents - (salvage_value_cents || 0)) / useful_life_months);
  
  db.prepare(`INSERT INTO fixed_assets(id,asset_code,asset_name,category,purchase_date,purchase_amount_cents,useful_life_months,salvage_value_cents,depreciation_method,monthly_depreciation_cents,net_value_cents,status,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    assetId, asset_code, asset_name, category, purchase_date, purchase_amount_cents,
    useful_life_months, salvage_value_cents || 0, depreciation_method, monthlyDepreciation,
    purchase_amount_cents, 'IN_USE', remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'FIXED_ASSET', assetId, `新增固定资产 ${asset_name}`);
  return send(res, 200, { id: assetId });
}

async function legacyUpdateFixedAsset(db, req, res, actor, assetId) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const { asset_name, category, purchase_date, purchase_amount_cents, useful_life_months, salvage_value_cents, depreciation_method, status, remark } = body;
  const now = new Date().toISOString();
  
  const monthlyDepreciation = depreciation_method === 'NONE' ? 0 : 
    Math.floor((purchase_amount_cents - (salvage_value_cents || 0)) / useful_life_months);
  
  db.prepare(`UPDATE fixed_assets SET asset_name=?,category=?,purchase_date=?,purchase_amount_cents=?,useful_life_months=?,salvage_value_cents=?,depreciation_method=?,monthly_depreciation_cents=?,status=?,remark=?,updated_at=? WHERE id=?`).run(
    asset_name, category, purchase_date, purchase_amount_cents, useful_life_months, salvage_value_cents || 0, depreciation_method, monthlyDepreciation, status, remark || '', now, assetId
  );
  
  audit(db, actor.id, 'UPDATE', 'FIXED_ASSET', assetId, `更新固定资产 ${asset_name}`);
  return send(res, 200, { ok: true });
}

async function legacyCalculateDepreciation(db, req, res, actor) {
  allow(actor, 'FIXED_ASSETS_MANAGE');
  const body = await readJson(req);
  const { assetId, depreciationDate } = body;
  
  const asset = db.prepare('SELECT * FROM fixed_assets WHERE id=?').get(assetId);
  if (!asset) throw new HttpError(404, '固定资产不存在');
  
  const now = new Date().toISOString();
  const depId = id();
  
  db.prepare('INSERT INTO asset_depreciations(id,asset_id,depreciation_date,depreciation_cents,creator_id,created_at) VALUES(?,?,?,?,?,?)').run(
    depId, assetId, depreciationDate, asset.monthly_depreciation_cents, actor.id, now
  );
  
  db.prepare('UPDATE fixed_assets SET net_value_cents=net_value_cents-?,updated_at=? WHERE id=?').run(
    asset.monthly_depreciation_cents, now, assetId
  );
  
  audit(db, actor.id, 'CREATE', 'ASSET_DEPRECIATION', depId, `计提折旧 ${money(asset.monthly_depreciation_cents)}`);
  return send(res, 200, { id: depId });
}

async function getFixedAssetDepreciations(db, res, actor, assetId) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const depreciations = db.prepare(`SELECT ad.*, u.name creatorName 
    FROM asset_depreciations ad LEFT JOIN users u ON u.id=ad.creator_id
    WHERE ad.asset_id=? ORDER BY ad.depreciation_date DESC`).all(assetId);
  return send(res, 200, { depreciations });
}

const BILL_TYPES = { RECEivable: '应收票据', PAYable: '应付票据' };
const BILL_STATUS = { PENDING: '待承兑', ACCEPTED: '已承兑', DISCOUNTED: '已贴现', ENDORSED: '已背书', PAID: '已到期', CANCELLED: '已作废' };
const ASSET_STATUS = { IN_USE: '使用中', MAINTENANCE: '维修中', SCRAPPED: '已报废', SOLD: '已出售' };
// ============ Cost Accounting ============

async function updateCostRate(db, req, res, actor, rateId) {
  allow(actor, 'COST_MANAGE');
  const rate = requiredCostRateBody(await readJson(req));
  if (!db.prepare('SELECT 1 FROM cost_rates WHERE id = ?').get(rateId)) throw new HttpError(404, '费率不存在');
  const now = new Date().toISOString();
  db.prepare('UPDATE cost_rates SET rate_type=?,rate_value=?,unit=?,effective_date=?,remark=?,updated_at=? WHERE id=?').run(
    rate.rateType, rate.rateValue, rate.unit, rate.effectiveDate, rate.remark, now, rateId
  );
  audit(db, actor.id, 'UPDATE', 'COST_RATE', rateId, `更新费率 ${rate.rateType}`);
  const updated = db.prepare(`SELECT cr.*, u.display_name creatorName FROM cost_rates cr JOIN users u ON u.id = cr.creator_id WHERE cr.id = ?`).get(rateId);
  return send(res, 200, { rate: costRateDto(updated) });
}

async function legacyCalculateProductionCost(db, req, res, actor) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const body = await readJson(req);
  const { orderId } = body;
  
  const order = db.prepare('SELECT * FROM production_orders WHERE id=?').get(orderId);
  if (!order) throw new HttpError(404, '生产工单不存在');
  
  // Get product standard cost
  const stdCost = db.prepare('SELECT * FROM product_costs WHERE product_id=? AND status=? ORDER BY effective_date DESC LIMIT 1').get(order.product_id, 'ACTIVE');
  
  // Get consumed materials from production order items
  const items = db.prepare('SELECT * FROM production_order_items WHERE order_id=?').all(orderId);
  let materialCost = 0;
  for (const item of items) {
    const itemCost = db.prepare('SELECT standard_cost_cents FROM product_costs WHERE product_id=? AND status=? ORDER BY effective_date DESC LIMIT 1').get(item.product_id, 'ACTIVE');
    materialCost += (itemCost?.standard_cost_cents || 0) * item.consumed_quantity;
  }
  
  // Get labor and overhead from cost rates
  const laborRate = db.prepare('SELECT rate_cents_per_hour FROM cost_rates WHERE category=? AND active=1 ORDER BY created_at LIMIT 1').get('LABOR');
  const overheadRate = db.prepare('SELECT rate_cents_per_hour FROM cost_rates WHERE category=? AND active=1 ORDER BY created_at LIMIT 1').get('OVERHEAD');
  
  const now = new Date().toISOString();
  const costId = id();
  
  // Calculate based on production quantity
  const laborCost = (laborRate?.rate_cents_per_hour || 0) * order.quantity;
  const overheadCost = (overheadRate?.rate_cents_per_hour || 0) * order.quantity;
  const totalCost = materialCost + laborCost + overheadCost;
  const unitCost = order.quantity > 0 ? Math.floor(totalCost / order.quantity) : 0;
  
  db.prepare('INSERT INTO production_costs(id,order_id,material_cost_cents,labor_cost_cents,overhead_cost_cents,total_cost_cents,unit_cost_cents,calculated_at,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    costId, orderId, materialCost, laborCost, overheadCost, totalCost, unitCost, now, actor.id, now
  );
  
  audit(db, actor.id, 'CREATE', 'PRODUCTION_COST', costId, `计算工单成本 ${money(totalCost)}`);
  return send(res, 200, { id: costId, materialCost, laborCost, overheadCost, totalCost, unitCost });
}

async function getProductionCost(db, res, actor, orderId) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const cost = db.prepare('SELECT * FROM production_costs WHERE order_id=? ORDER BY created_at DESC LIMIT 1').get(orderId);
  return send(res, 200, { cost });
}
// ============ IQC Inspections (canonical handlers live in server/modules/extended.js) ============
