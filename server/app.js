import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { id, hashPassword, PERMISSIONS, transaction, verifyPassword } from './db.js';

const SESSION_HOURS = 12;
const STATUS_LABELS = { DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已审核', REJECTED: '已驳回' };

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

  const actor = authenticate(db, req);
  if (req.method === 'POST' && pathname === '/api/auth/logout') return logout(db, req, res);
  if (req.method === 'GET' && pathname === '/api/auth/me') return send(res, 200, { user: actor });
  if (req.method === 'GET' && pathname === '/api/dashboard') return dashboard(db, res, actor);

  if (pathname === '/api/roles' && req.method === 'GET') return listRoles(db, res, actor);
  if (pathname === '/api/roles' && req.method === 'POST') return createRole(db, req, res, actor);
  const roleMatch = pathname.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && req.method === 'PATCH') return updateRole(db, req, res, actor, roleMatch[1]);

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
  if (pathname === '/api/fixed-assets' && req.method === 'GET') return listFixedAssets(db, res, actor);
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

  // Purchase Receipts
  if (pathname === "/api/purchase-receipts" && req.method === "GET") return listPurchaseReceipts(db, res, actor, url);
  if (pathname === "/api/purchase-receipts" && req.method === "POST") return createPurchaseReceipt(db, req, res, actor);
  const prMatch = pathname.match(/^\/api\/purchase-receipts\/([^\/]+)$/);
  if (prMatch && req.method === "GET") return getPurchaseReceipt(db, res, actor, prMatch[1]);
  if (prMatch && req.method === "POST") return confirmPurchaseReceipt(db, req, res, actor, prMatch[1]);

  // Sales Deliveries
  if (pathname === "/api/sales-deliveries" && req.method === "GET") return listSalesDeliveries(db, res, actor, url);
  if (pathname === "/api/sales-deliveries" && req.method === "POST") return createSalesDelivery(db, req, res, actor);
  const sdMatch = pathname.match(/^\/api\/sales-deliveries\/([^\/]+)$/);
  if (sdMatch && req.method === "GET") return getSalesDelivery(db, res, actor, sdMatch[1]);
  if (sdMatch && req.method === "POST") return confirmSalesDelivery(db, req, res, actor, sdMatch[1]);

  // Sales Returns
  if (pathname === "/api/sales-returns" && req.method === "GET") return listSalesReturns(db, res, actor, url);
  if (pathname === "/api/sales-returns" && req.method === "POST") return createSalesReturn(db, req, res, actor);
  const srMatch = pathname.match(/^\/api\/sales-returns\/([^\/]+)$/);
  if (srMatch && req.method === "GET") return getSalesReturn(db, res, actor, srMatch[1]);
  if (srMatch && req.method === "POST") return confirmSalesReturn(db, req, res, actor, srMatch[1]);

  // Purchase Returns
  if (pathname === "/api/purchase-returns" && req.method === "GET") return listPurchaseReturns(db, res, actor, url);
  if (pathname === "/api/purchase-returns" && req.method === "POST") return createPurchaseReturn(db, req, res, actor);
  const purMatch = pathname.match(/^\/api\/purchase-returns\/([^\/]+)$/);
  if (purMatch && req.method === "GET") return getPurchaseReturn(db, res, actor, purMatch[1]);
  if (purMatch && req.method === "POST") return confirmPurchaseReturn(db, req, res, actor, purMatch[1]);

  // Inventory Transactions
  if (pathname === "/api/inventory-transactions" && req.method === "GET") return listInventoryTransactions(db, res, actor, url);

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

  // ============ Production Outputs ============
  if (pathname === "/api/production-outputs" && req.method === "POST") return createProductionOutput(db, req, res, actor);



  throw new HttpError(404, '接口不存在');
}

async function login(db, req, res) {
  const body = await readJson(req);
  const username = requiredText(body.username, '用户名', 50);
  const password = requiredText(body.password, '密码', 100);
  const row = db.prepare(`
    SELECT u.*, r.name role_name, r.code role_code FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.username=? COLLATE NOCASE
  `).get(username);
  if (!row || !row.active || !verifyPassword(password, row.password_salt, row.password_hash)) {
    audit(db, row?.id, 'LOGIN_FAILED', 'AUTH', null, username);
    throw new HttpError(401, '用户名或密码错误');
  }
  const token = randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(tokenHash, row.id, expires.toISOString(), now.toISOString());
  audit(db, row.id, 'LOGIN', 'AUTH', null, '登录成功');
  return send(res, 200, { token, user: actorFromRow(db, row) });
}

function logout(db, req, res) {
  const token = bearer(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
  return send(res, 204, null);
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


function generateVoucher(db, sourceType, sourceId, entries, actor) {
  const voucherId = id();
  const now = new Date().toISOString();
  const voucherNo = makeVoucherNo();
  db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(voucherId, voucherNo, sourceType, sourceId, now.slice(0, 10), '', actor.id, now);
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
      // Generate accounting voucher for sales order
      const customer = db.prepare('SELECT name FROM customers WHERE id=?').get(order.customer_id);
      const entries = [
        { subjectId: 'subject-003', direction: 'DEBIT', amountCents: order.total_cents, summary: `应收 ${customer?.name || ''} ${order.order_no}` },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: order.total_cents, summary: `主营业务收入 ${order.order_no}` }
      ];
      generateVoucher(db, 'SALES_ORDER', orderId, entries, actor);
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

function audit(db, userId, action, entityType, entityId, detail) {
  db.prepare('INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id(), userId ?? null, action, entityType, entityId ?? null, detail ?? '', new Date().toISOString());
}

function allow(actor, permission) {
  if (!actor.permissions.includes(permission)) throw new HttpError(403, '没有执行此操作的权限');
}

function allowAny(actor, permissions) {
  if (!permissions.some((permission) => actor.permissions.includes(permission))) throw new HttpError(403, '没有查看此功能的权限');
}

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, '请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, '请求不是有效的 JSON'); }
}

function requiredText(value, label, maxLength) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(400, `${label}不能为空`);
  if (text.length > maxLength) throw new HttpError(400, `${label}不能超过 ${maxLength} 个字符`);
  return text;
}

function optionalText(value, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw new HttpError(400, `内容不能超过 ${maxLength} 个字符`);
  return text;
}

function requiredCode(value, label) {
  const text = requiredText(value, label, 50);
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new HttpError(400, `${label}只能包含字母、数字、下划线和短横线`);
  return text.toUpperCase();
}

function bearer(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function makeVoucherNo() { const now = new Date(); return `VCH-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random()*90+10)}`; }

function makeInventoryTransferNo() { const now = new Date(); return `IT-${now.toISOString().slice(0,10).replaceAll('-','')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random()*90+10)}`; }

function makePurchaseOrderNo() { const now = new Date(); return `PO-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`; }

function makeOrderNo() { const now = new Date(); return `SO-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${String(now.getTime()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`; }

function send(res, status, body) {
  res.statusCode = status;
  if (body === null) return res.end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
}

function serveStatic(res, pathname, distDir) {
  if (!distDir || !existsSync(distDir)) throw new HttpError(404, '前端尚未构建，请先运行 pnpm build');
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  let file = normalize(join(distDir, requested));
  if (!file.startsWith(normalize(distDir)) || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, 'index.html');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  res.statusCode = 200; res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file));
}

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

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
    const boms = db.prepare("SELECT b.*, p.code, p.name, p.unit FROM bom_items b JOIN products p ON p.id = b.product_id WHERE b.bom_id IN (SELECT id FROM boms WHERE product_id=? AND status='APPROVED')").all(productId);
    
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
    
    const bom = db.prepare("SELECT * FROM boms WHERE product_id=? AND status='APPROVED' LIMIT 1").get(productId);
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
        const subBom = db.prepare("SELECT id FROM boms WHERE product_id=? AND status='APPROVED' LIMIT 1").get(item.product_id);
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
  if (!warehouseId) throw new HttpError(400, '请选择仓库');
  if (!productId) throw new HttpError(400, '请选择货品');
  if (actualQuantity === undefined || actualQuantity === null) throw new HttpError(400, '请填写实际盘点数量');
  const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id=? AND product_id=?').get(warehouseId, productId);
  if (!inv) throw new HttpError(400, '该仓库没有此货品的库存记录');
  const systemQuantity = inv.quantity;
  const difference = Number(actualQuantity) - systemQuantity;
  const checkId = id(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO inventory_checks(id,warehouse_id,product_id,system_quantity,actual_quantity,difference,reason,status,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,\'PENDING\',?,?)`).run(checkId, warehouseId, productId, systemQuantity, Number(actualQuantity), difference, optionalText(reason, 200), actor.id, now);
  audit(db, actor.id, 'CREATE', 'INVENTORY_CHECK', checkId, `盘点差异: ${difference}`);
  return send(res, 201, { id: checkId });
}

async function approveInventoryCheck(db, req, res, actor, checkId) {
  allow(actor, 'INVENTORY_CHECK_APPROVE');
  const check = db.prepare('SELECT * FROM inventory_checks WHERE id=?').get(checkId);
  if (!check) throw new HttpError(404, '盘点单不存在');
  if (check.status !== 'PENDING') throw new HttpError(409, '该盘点单已处理');
  const body = await readJson(req);
  const action = body.action; // 'APPROVE' or 'REJECT'
  const now = new Date().toISOString();
  if (action === 'APPROVE') {
    transaction(db, () => {
      db.prepare("UPDATE inventory_checks SET status='APPROVED',reviewer_id=?,reviewed_at=? WHERE id=?").run(actor.id, now, checkId);
      db.prepare('UPDATE inventory SET quantity=?,updated_at=? WHERE warehouse_id=? AND product_id=?').run(check.actual_quantity, now, check.warehouse_id, check.product_id);
      audit(db, actor.id, 'APPROVE', 'INVENTORY_CHECK', checkId, `审核通过，库存调整为 ${check.actual_quantity}`);
    });
  } else {
    db.prepare("UPDATE inventory_checks SET status='REJECTED',reviewer_id=?,reviewed_at=? WHERE id=?").run(actor.id, now, checkId);
    audit(db, actor.id, 'REJECT', 'INVENTORY_CHECK', checkId, '驳回盘点单');
  }
  return send(res, 200, { ok: true });
}

// ============ Inventory Transfers ============

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

async function createInventoryTransfer(db, req, res, actor) {
  allow(actor, 'INVENTORY_TRANSFER_CREATE');
  const body = await readJson(req);
  const { fromWarehouseId, toWarehouseId, remark, items } = body;
  if (!fromWarehouseId) throw new HttpError(400, '请选择源仓库');
  if (!toWarehouseId) throw new HttpError(400, '请选择目标仓库');
  if (fromWarehouseId === toWarehouseId) throw new HttpError(400, '源仓库和目标仓库不能相同');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加调拨货品');
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
        db.prepare('UPDATE inventory SET quantity=quantity-?,updated_at=? WHERE warehouse_id=? AND product_id=?').run(item.quantity, now, transfer.from_warehouse_id, item.product_id);
        db.prepare('UPDATE inventory SET quantity=quantity+?,updated_at=? WHERE warehouse_id=? AND product_id=?').run(item.quantity, now, transfer.to_warehouse_id, item.product_id);
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
  }
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

async function createAccountingVoucher(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { voucherDate, remark, entries } = body;
  
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
  
  transaction(db, () => {
    db.prepare(`INSERT INTO accounting_vouchers(id,voucher_no,source_type,source_id,voucher_date,remark,creator_id,created_at) 
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(voucherId, voucherNo, 'MANUAL', voucherId, voucherDate || now.slice(0, 10), remark || '', actor.id, now);
    
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
  
  transaction(db, () => {
    db.prepare('UPDATE accounting_vouchers SET voucher_date = ?, remark = ? WHERE id = ?')
      .run(voucherDate || voucher.voucher_date, remark || '', voucherId);
    
    db.prepare('DELETE FROM accounting_entries WHERE voucher_id = ?').run(voucherId);
    
    const stmt = db.prepare('INSERT INTO accounting_entries(id,voucher_id,subject_id,direction,amount_cents,summary) VALUES(?,?,?,?,?,?)');
    entries.forEach(e => {
      stmt.run(id(), voucherId, e.subjectId, e.direction, Number(e.amountCents), e.summary || '');
    });
    
    audit(db, actor.id, 'UPDATE', 'ACCOUNTING_VOUCHER', voucherId, '修改凭证 ' + voucher.voucher_no);
  });
  
  return send(res, 200, { success: true });
}

async function deleteAccountingVoucher(db, req, res, actor, voucherId) {
  allow(actor, 'ACCOUNTING_VIEW');
  const voucher = db.prepare('SELECT * FROM accounting_vouchers WHERE id = ?').get(voucherId);
  if (!voucher) throw new HttpError(404, '凭证不存在');
  
  if (voucher.source_type !== 'MANUAL') {
    throw new HttpError(400, '只能删除手工凭证');
  }
  
  transaction(db, () => {
    db.prepare('DELETE FROM accounting_entries WHERE voucher_id = ?').run(voucherId);
    db.prepare('DELETE FROM accounting_vouchers WHERE id = ?').run(voucherId);
    audit(db, actor.id, 'DELETE', 'ACCOUNTING_VOUCHER', voucherId, '删除凭证 ' + voucher.voucher_no);
  });
  
  return send(res, 200, { success: true });
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
      WHERE ae.subject_id = ? AND av.voucher_date < ?`)
      .get(subject.id, startDate);
    
    // 本期借方发生
    const periodDebit = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND ae.direction = 'DEBIT' 
      AND av.voucher_date >= ? AND av.voucher_date <= ?`)
      .get(subject.id, startDate, endDate);
    
    // 本期贷方发生
    const periodCredit = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND ae.direction = 'CREDIT' 
      AND av.voucher_date >= ? AND av.voucher_date <= ?`)
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

function getTrialBalance(db, res, actor, url) {
  allow(actor, 'ACCOUNTING_VIEW');
  const period = url.searchParams.get('period');
  
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
  
  // 获取所有末级科目
  const subjects = db.prepare(`SELECT id, code, name, type FROM accounting_subjects 
    WHERE active = 1 AND parent_id IS NOT NULL ORDER BY code`).all();
  
  const trialBalance = subjects.map(subject => {
    const opening = db.prepare(`SELECT 
      COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0) as balance
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND av.voucher_date < ?`)
      .get(subject.id, startDate);
    
    const periodDebit = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND ae.direction = 'DEBIT' 
      AND av.voucher_date >= ? AND av.voucher_date <= ?`)
      .get(subject.id, startDate, endDate);
    
    const periodCredit = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) as total
      FROM accounting_entries ae 
      JOIN accounting_vouchers av ON av.id = ae.voucher_id 
      WHERE ae.subject_id = ? AND ae.direction = 'CREDIT' 
      AND av.voucher_date >= ? AND av.voucher_date <= ?`)
      .get(subject.id, startDate, endDate);
    
    const openingBalance = Number(opening.balance);
    const debit = Number(periodDebit.total);
    const credit = Number(periodCredit.total);
    
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
  });
  
  return send(res, 200, { trialBalance, period: { startDate, endDate } });
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
  
  const sql = `SELECT fa.*, u.display_name creatorName,
    (SELECT SUM(depreciation_amount_cents) FROM asset_depreciations WHERE asset_id = fa.id) as total_depreciation
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
  const asset = db.prepare(`SELECT fa.*, u.display_name creatorName FROM fixed_assets fa JOIN users u ON u.id = fa.creator_id WHERE fa.id = ?`).get(assetId);
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

function listProductCosts(db, res, actor, url) {
  allowAny(actor, ['ACCOUNTING_VIEW', 'PRODUCTS_VIEW']);
  const productId = url.searchParams.get('product_id');
  
  let sql = `SELECT pc.*, p.code productCode, p.name productName, u.display_name creatorName
    FROM product_costs pc
    JOIN products p ON p.id = pc.product_id
    JOIN users u ON u.id = pc.creator_id
    WHERE pc.status = 'ACTIVE'`;
  const params = [];
  
  if (productId) { sql += ' AND pc.product_id = ?'; params.push(productId); }
  
  sql += ' ORDER BY pc.effective_date DESC LIMIT 100';
  
  const costs = db.prepare(sql).all(...params);
  return send(res, 200, { costs });
}

async function createProductCost(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { product_id, standard_cost, material_cost, labor_cost, overhead_cost, effective_date, remark } = body;
  
  if (!product_id) throw new HttpError(400, '请选择产品');
  
  // 将旧标准成本设为历史
  db.prepare("UPDATE product_costs SET status = 'HISTORICAL', updated_at = ? WHERE product_id = ? AND status = 'ACTIVE'")
    .run(new Date().toISOString(), product_id);
  
  const costId = id();
  const now = new Date().toISOString();
  const totalCents = Math.round((standard_cost || 0) * 100) + Math.round((material_cost || 0) * 100) + Math.round((labor_cost || 0) * 100) + Math.round((overhead_cost || 0) * 100);
  
  db.prepare(`INSERT INTO product_costs(id, product_id, standard_cost_cents, material_cost_cents, labor_cost_cents, overhead_cost_cents, effective_date, status, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`)
    .run(costId, product_id, Math.round((standard_cost || 0) * 100), Math.round((material_cost || 0) * 100), Math.round((labor_cost || 0) * 100), Math.round((overhead_cost || 0) * 100), effective_date || now.slice(0, 10), remark || '', actor.id, now, now);
  
  // 更新产品的标准成本
  db.prepare('UPDATE products SET price_cents = ? WHERE id = ?').run(totalCents, product_id);
  
  return send(res, 201, { id: costId });
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
  allow(actor, 'ACCOUNTING_VIEW');
  const rates = db.prepare('SELECT * FROM cost_rates ORDER BY rate_type, effective_date DESC').all();
  return send(res, 200, { rates });
}

async function createCostRate(db, req, res, actor) {
  allow(actor, 'ACCOUNTING_VIEW');
  const body = await readJson(req);
  const { rate_type, rate_value, unit, effective_date, remark } = body;
  
  if (!rate_type || rate_value === undefined) throw new HttpError(400, '请填写完整的费率信息');
  
  const rateId = id();
  const now = new Date().toISOString();
  
  db.prepare(`INSERT INTO cost_rates(id, rate_type, rate_value, unit, effective_date, remark, creator_id, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(rateId, rate_type, rate_value, unit || '元/小时', effective_date || now.slice(0, 10), remark || '', actor.id, now, now);
  
  return send(res, 201, { id: rateId });
}


// ============ Purchase Receipts ============

function listPurchaseReceipts(db, res, actor, url) {
  allowAny(actor, ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE']);
  const search = '%' + (url.searchParams.get('search') || '') + '%';
  const status = url.searchParams.get('status');
  let where = '(pr.receipt_no LIKE ? OR s.name LIKE ?)';
  const params = [search, search];
  if (status && ['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(status)) { where += ' AND pr.status = ?'; params.push(status); }
  const sql = `SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, (SELECT count(*) FROM purchase_receipt_items WHERE receipt_id = pr.id) itemCount FROM purchase_receipts pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.handler_id WHERE ${where} ORDER BY pr.created_at DESC LIMIT 100`;  const receipts = db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: RECEIPT_STATUS[row.status] || row.status }));
  return send(res, 200, { purchaseReceipts: receipts });
}

async function createPurchaseReceipt(db, req, res, actor) {
  allow(actor, 'PURCHASE_RECEIPTS_MANAGE');
  const body = await readJson(req);
  const { purchaseOrderId, supplierId, warehouseId, remark, items } = body;
  if (!supplierId) throw new HttpError(400, '请选择供应商');
  if (!warehouseId) throw new HttpError(400, '请选择仓库');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加入库明细');
  const receiptId = id();
  const now = new Date().toISOString();
  const receiptNo = 'PR' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO purchase_receipts(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,\'DRAFT\',0,?,?,?,?)').run(receiptId, receiptNo, purchaseOrderId || null, supplierId, warehouseId, remark || '', actor.id, now, now);
    let total = 0;
    const stmt = db.prepare('INSERT INTO purchase_receipt_items(id,receipt_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)');
    items.forEach((item, i) => { const amount = Math.round(Number(item.quantity) * Number(item.unitPriceCents || 0)); total += amount; stmt.run(id(), receiptId, item.productId, Number(item.quantity), Number(item.unitPriceCents || 0), amount, i + 1); });
    db.prepare('UPDATE purchase_receipts SET total_cents=? WHERE id=?').run(total, receiptId);
    audit(db, actor.id, 'CREATE', 'PURCHASE_RECEIPT', receiptId, '创建采购入库单 ' + receiptNo);
  });
  return send(res, 201, { id: receiptId, receiptNo });
}

function getPurchaseReceipt(db, res, actor, receiptId) {
  allowAny(actor, ['PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE']);
  const receipt = db.prepare('SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, po.order_no poNo FROM purchase_receipts pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.confirmed_by LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id WHERE pr.id = ?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  receipt.items = db.prepare('SELECT pri.*, p.code productCode, p.name productName, p.unit FROM purchase_receipt_items pri JOIN products p ON p.id = pri.product_id WHERE pri.receipt_id = ?').all(receiptId);
  receipt.statusLabel = RECEIPT_STATUS[receipt.status] || receipt.status;
  return send(res, 200, { purchaseReceipt: receipt });
}

async function confirmPurchaseReceipt(db, req, res, actor, receiptId) {
  allow(actor, 'PURCHASE_RECEIPTS_MANAGE');
  const receipt = db.prepare('SELECT * FROM purchase_receipts WHERE id = ?').get(receiptId);
  if (!receipt) throw new HttpError(404, '采购入库单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    if (receipt.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
    const items = db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id = ?').all(receiptId);
    transaction(db, () => {
      for (const item of items) {
        db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = ? WHERE warehouse_id = ? AND product_id = ?').run(item.quantity, now, receipt.warehouse_id, item.product_id);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'IN\',\'PURCHASE_RECEIPT\',?,?,?,?,?)').run(id(), receipt.warehouse_id, item.product_id, item.quantity, receiptId, receipt.receipt_no, '采购入库', actor.id, now);
      }
      db.prepare('UPDATE purchase_receipts SET status=\'CONFIRMED\',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?').run(now, actor.id, now, receiptId);
      audit(db, actor.id, 'CONFIRM', 'PURCHASE_RECEIPT', receiptId, '确认采购入库 ' + receipt.receipt_no);
      const totalAmt = items.reduce((s, i) => s + i.amount_cents, 0);
      const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(receipt.supplier_id)?.name || '';
      generateVoucher(db, 'PURCHASE_RECEIPT', receiptId, [
        { subjectId: 'subject-004', direction: 'DEBIT', amountCents: totalAmt, summary: '采购入库 ' + receipt.receipt_no + ' ' + supplierName },
        { subjectId: 'subject-005', direction: 'CREDIT', amountCents: totalAmt, summary: '采购入库 ' + receipt.receipt_no + ' ' + supplierName }
      ], actor);
    });
  } else {
    if (receipt.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE purchase_receipts SET status=\'CANCELLED\',updated_at=? WHERE id=?').run(now, receiptId);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_RECEIPT', receiptId, '取消采购入库 ' + receipt.receipt_no);
  }
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
  const sql = 'SELECT sd.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, (SELECT count(*) FROM sales_delivery_items WHERE delivery_id = sd.id) itemCount FROM sales_deliveries sd JOIN customers c ON c.id = sd.customer_id JOIN warehouses w ON w.id = sd.warehouse_id JOIN users creator ON creator.id = sd.creator_id LEFT JOIN users confirmed ON confirmed.id = sd.handler_id WHERE ' + where + ' ORDER BY sd.created_at DESC LIMIT 100';
  const deliveries = db.prepare(sql).all(...params).map(row => ({ ...row, statusLabel: DELIVERY_STATUS[row.status] || row.status }));
  return send(res, 200, { salesDeliveries: deliveries });
}

async function createSalesDelivery(db, req, res, actor) {
  allow(actor, 'SALES_DELIVERIES_MANAGE');
  const body = await readJson(req);
  const { salesOrderId, customerId, warehouseId, remark, items } = body;
  if (!customerId) throw new HttpError(400, '请选择客户');
  if (!warehouseId) throw new HttpError(400, '请选择仓库');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加出库明细');
  for (const item of items) {
    const inv = db.prepare('SELECT quantity FROM inventory WHERE warehouse_id = ? AND product_id = ?').get(warehouseId, item.productId);
    if (!inv || inv.quantity < Number(item.quantity)) { const product = db.prepare('SELECT code FROM products WHERE id = ?').get(item.productId); throw new HttpError(400, (product?.code || item.productId) + ' 库存不足'); }
  }
  const deliveryId = id();
  const now = new Date().toISOString();
  const deliveryNo = 'SD' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO sales_deliveries(id,delivery_no,sales_order_id,customer_id,warehouse_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,\'DRAFT\',0,?,?,?,?)').run(deliveryId, deliveryNo, salesOrderId || null, customerId, warehouseId, remark || '', actor.id, now, now);
    let total = 0;
    const stmt = db.prepare('INSERT INTO sales_delivery_items(id,delivery_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)');
    items.forEach((item, i) => { const amount = Math.round(Number(item.quantity) * Number(item.unitPriceCents || 0)); total += amount; stmt.run(id(), deliveryId, item.productId, Number(item.quantity), Number(item.unitPriceCents || 0), amount, i + 1); });
    db.prepare('UPDATE sales_deliveries SET total_cents=? WHERE id=?').run(total, deliveryId);
    audit(db, actor.id, 'CREATE', 'SALES_DELIVERY', deliveryId, '创建销售出库单 ' + deliveryNo);
  });
  return send(res, 201, { id: deliveryId, deliveryNo });
}

function getSalesDelivery(db, res, actor, deliveryId) {
  allowAny(actor, ['SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE']);
  const delivery = db.prepare('SELECT sd.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, so.order_no soNo FROM sales_deliveries sd JOIN customers c ON c.id = sd.customer_id JOIN warehouses w ON w.id = sd.warehouse_id JOIN users creator ON creator.id = sd.creator_id LEFT JOIN users confirmed ON confirmed.id = sd.confirmed_by LEFT JOIN sales_orders so ON so.id = sd.sales_order_id WHERE sd.id = ?').get(deliveryId);
  if (!delivery) throw new HttpError(404, '销售出库单不存在');
  delivery.items = db.prepare('SELECT sdi.*, p.code productCode, p.name productName, p.unit FROM sales_delivery_items sdi JOIN products p ON p.id = sdi.product_id WHERE sdi.delivery_id = ?').all(deliveryId);
  delivery.statusLabel = DELIVERY_STATUS[delivery.status] || delivery.status;
  return send(res, 200, { salesDelivery: delivery });
}

async function confirmSalesDelivery(db, req, res, actor, deliveryId) {
  allow(actor, 'SALES_DELIVERIES_MANAGE');
  const delivery = db.prepare('SELECT * FROM sales_deliveries WHERE id = ?').get(deliveryId);
  if (!delivery) throw new HttpError(404, '销售出库单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    if (delivery.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
    const items = db.prepare('SELECT * FROM sales_delivery_items WHERE delivery_id = ?').all(deliveryId);
    transaction(db, () => {
      for (const item of items) {
        db.prepare('UPDATE inventory SET quantity = quantity - ?, updated_at = ? WHERE warehouse_id = ? AND product_id = ?').run(item.quantity, now, delivery.warehouse_id, item.product_id);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'OUT\',\'SALES_DELIVERY\',?,?,?,?,?)').run(id(), delivery.warehouse_id, item.product_id, item.quantity, deliveryId, delivery.delivery_no, '销售出库', actor.id, now);
      }
      db.prepare('UPDATE sales_deliveries SET status=\'CONFIRMED\',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?').run(now, actor.id, now, deliveryId);
      audit(db, actor.id, 'CONFIRM', 'SALES_DELIVERY', deliveryId, '确认销售出库 ' + delivery.delivery_no);
      const totalAmt = items.reduce((s, i) => s + i.amount_cents, 0);
      const customerName = db.prepare('SELECT name FROM customers WHERE id = ?').get(delivery.customer_id)?.name || '';
      generateVoucher(db, 'SALES_DELIVERY', deliveryId, [
        { subjectId: 'subject-003', direction: 'DEBIT', amountCents: totalAmt, summary: '销售出库 ' + delivery.delivery_no + ' ' + customerName },
        { subjectId: 'subject-006', direction: 'CREDIT', amountCents: totalAmt, summary: '销售出库 ' + delivery.delivery_no + ' 确认收入' }
      ], actor);
    });
  } else {
    if (delivery.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE sales_deliveries SET status=\'CANCELLED\',updated_at=? WHERE id=?').run(now, deliveryId);
    audit(db, actor.id, 'CANCEL', 'SALES_DELIVERY', deliveryId, '取消销售出库 ' + delivery.delivery_no);
  }
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
  if (!customerId) throw new HttpError(400, '请选择客户');
  if (!warehouseId) throw new HttpError(400, '请选择仓库');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加退货明细');
  const returnId = id();
  const now = new Date().toISOString();
  const returnNo = 'SRET' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO return_orders(id,return_no,delivery_id,customer_id,warehouse_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,\'DRAFT\',0,?,?,?,?)').run(returnId, returnNo, deliveryId || null, customerId, warehouseId, remark || '', actor.id, now, now);
    let total = 0;
    const stmt = db.prepare('INSERT INTO return_order_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)');
    items.forEach((item, i) => { const amount = Math.round(Number(item.quantity) * Number(item.unitPriceCents || 0)); total += amount; stmt.run(id(), returnId, item.productId, Number(item.quantity), Number(item.unitPriceCents || 0), amount, i + 1); });
    db.prepare('UPDATE return_orders SET total_cents=? WHERE id=?').run(total, returnId);
    audit(db, actor.id, 'CREATE', 'SALES_RETURN', returnId, '创建销售退货单 ' + returnNo);
  });
  return send(res, 201, { id: returnId, returnNo });
}

function getSalesReturn(db, res, actor, returnId) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const ret = db.prepare('SELECT sr.*, c.code customerCode, c.name customerName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, sd.delivery_no deliveryNo FROM return_orders sr JOIN customers c ON c.id = sr.customer_id JOIN warehouses w ON w.id = sr.warehouse_id JOIN users creator ON creator.id = sr.creator_id LEFT JOIN users confirmed ON confirmed.id = sr.confirmed_by LEFT JOIN sales_deliveries sd ON sd.id = sr.delivery_id WHERE sr.id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '销售退货单不存在');
  ret.items = db.prepare('SELECT sri.*, p.code productCode, p.name productName, p.unit FROM return_order_items sri JOIN products p ON p.id = sri.product_id WHERE sri.return_id = ?').all(returnId);
  ret.statusLabel = RETURN_STATUS[ret.status] || ret.status;
  return send(res, 200, { salesReturn: ret });
}

async function confirmSalesReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const ret = db.prepare('SELECT * FROM return_orders WHERE id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '销售退货单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    if (ret.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
    const items = db.prepare('SELECT * FROM return_order_items WHERE return_id = ?').all(returnId);
    transaction(db, () => {
      for (const item of items) {
        db.prepare('UPDATE inventory SET quantity = quantity + ?, updated_at = ? WHERE warehouse_id = ? AND product_id = ?').run(item.quantity, now, ret.warehouse_id, item.product_id);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'IN\',\'SALES_RETURN\',?,?,?,?,?)').run(id(), ret.warehouse_id, item.product_id, item.quantity, returnId, ret.return_no, '销售退货', actor.id, now);
      }
      db.prepare('UPDATE return_orders SET status=\'CONFIRMED\',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?').run(now, actor.id, now, returnId);
      audit(db, actor.id, 'CONFIRM', 'SALES_RETURN', returnId, '确认销售退货 ' + ret.return_no);
      const totalAmt = items.reduce((s, i) => s + i.amount_cents, 0);
      const customerName = db.prepare('SELECT name FROM customers WHERE id = ?').get(ret.customer_id)?.name || '';
      generateVoucher(db, 'SALES_RETURN', returnId, [
        { subjectId: 'subject-007', direction: 'DEBIT', amountCents: totalAmt, summary: '销售退货 ' + ret.return_no + ' 成本冲减' },
        { subjectId: 'subject-004', direction: 'CREDIT', amountCents: totalAmt, summary: '销售退货 ' + ret.return_no + ' ' + customerName }
      ], actor);
    });
  } else {
    if (ret.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE return_orders SET status=\'CANCELLED\',updated_at=? WHERE id=?').run(now, returnId);
    audit(db, actor.id, 'CANCEL', 'SALES_RETURN', returnId, '取消销售退货 ' + ret.return_no);
  }
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
  if (!supplierId) throw new HttpError(400, '请选择供应商');
  if (!warehouseId) throw new HttpError(400, '请选择仓库');
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, '请添加退货明细');
  const returnId = id();
  const now = new Date().toISOString();
  const returnNo = 'PRET' + Date.now().toString().slice(-10);
  transaction(db, () => {
    db.prepare('INSERT INTO purchase_returns(id,return_no,receipt_id,supplier_id,warehouse_id,status,total_cents,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,\'DRAFT\',0,?,?,?,?)').run(returnId, returnNo, receiptId || null, supplierId, warehouseId, remark || '', actor.id, now, now);
    let total = 0;
    const stmt = db.prepare('INSERT INTO purchase_return_items(id,return_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)');
    items.forEach((item, i) => { const amount = Math.round(Number(item.quantity) * Number(item.unitPriceCents || 0)); total += amount; stmt.run(id(), returnId, item.productId, Number(item.quantity), Number(item.unitPriceCents || 0), amount, i + 1); });
    db.prepare('UPDATE purchase_returns SET total_cents=? WHERE id=?').run(total, returnId);
    audit(db, actor.id, 'CREATE', 'PURCHASE_RETURN', returnId, '创建采购退货单 ' + returnNo);
  });
  return send(res, 201, { id: returnId, returnNo });
}

function getPurchaseReturn(db, res, actor, returnId) {
  allowAny(actor, ['RETURNS_VIEW', 'RETURNS_MANAGE']);
  const ret = db.prepare('SELECT pr.*, s.code supplierCode, s.name supplierName, w.code warehouseCode, w.name warehouseName, creator.display_name creatorName, confirmed.display_name confirmedByName, prc.receipt_no receiptNo FROM purchase_returns pr JOIN suppliers s ON s.id = pr.supplier_id JOIN warehouses w ON w.id = pr.warehouse_id JOIN users creator ON creator.id = pr.creator_id LEFT JOIN users confirmed ON confirmed.id = pr.confirmed_by LEFT JOIN purchase_receipts prc ON prc.id = pr.receipt_id WHERE pr.id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '采购退货单不存在');
  ret.items = db.prepare('SELECT pri.*, p.code productCode, p.name productName, p.unit FROM purchase_return_items pri JOIN products p ON p.id = pri.product_id WHERE pri.return_id = ?').all(returnId);
  ret.statusLabel = RETURN_STATUS[ret.status] || ret.status;
  return send(res, 200, { purchaseReturn: ret });
}

async function confirmPurchaseReturn(db, req, res, actor, returnId) {
  allow(actor, 'RETURNS_MANAGE');
  const ret = db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(returnId);
  if (!ret) throw new HttpError(404, '采购退货单不存在');
  const body = await readJson(req);
  const action = body.action;
  const now = new Date().toISOString();
  if (action === 'confirm') {
    if (ret.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以确认');
    const items = db.prepare('SELECT * FROM purchase_return_items WHERE return_id = ?').all(returnId);
    transaction(db, () => {
      for (const item of items) {
        db.prepare('UPDATE inventory SET quantity = quantity - ?, updated_at = ? WHERE warehouse_id = ? AND product_id = ?').run(item.quantity, now, ret.warehouse_id, item.product_id);
        db.prepare('INSERT INTO inventory_transactions(id,warehouse_id,product_id,quantity_change,direction,source_type,source_id,source_no,remark,creator_id,created_at) VALUES(?,?,?,?,\'OUT\',\'PURCHASE_RETURN\',?,?,?,?,?)').run(id(), ret.warehouse_id, item.product_id, item.quantity, returnId, ret.return_no, '采购退货', actor.id, now);
      }
      db.prepare('UPDATE purchase_returns SET status=\'CONFIRMED\',confirmed_at=?,confirmed_by=?,updated_at=? WHERE id=?').run(now, actor.id, now, returnId);
      audit(db, actor.id, 'CONFIRM', 'PURCHASE_RETURN', returnId, '确认采购退货 ' + ret.return_no);
      const totalAmt = items.reduce((s, i) => s + i.amount_cents, 0);
      const supplierName = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(ret.supplier_id)?.name || '';
      generateVoucher(db, 'PURCHASE_RETURN', returnId, [
        { subjectId: 'subject-005', direction: 'DEBIT', amountCents: totalAmt, summary: '采购退货 ' + ret.return_no + ' ' + supplierName },
        { subjectId: 'subject-004', direction: 'CREDIT', amountCents: totalAmt, summary: '采购退货 ' + ret.return_no }
      ], actor);
    });
  } else {
    if (ret.status !== 'DRAFT') throw new HttpError(409, '只有草稿状态可以取消');
    db.prepare('UPDATE purchase_returns SET status=\'CANCELLED\',updated_at=? WHERE id=?').run(now, returnId);
    audit(db, actor.id, 'CANCEL', 'PURCHASE_RETURN', returnId, '取消采购退货 ' + ret.return_no);
  }
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
  const sql = 'SELECT t.*, w.code warehouseCode, w.name warehouseName, p.code productCode, p.name productName, p.unit FROM inventory_transactions t JOIN warehouses w ON w.id = t.warehouse_id JOIN products p ON p.id = t.product_id ' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY t.created_at DESC LIMIT 200';
  return send(res, 200, { transactions: db.prepare(sql).all(...params) });
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
  const pcId = id();
  const pcNo = 'PC-' + Date.now().toString(36).toUpperCase();
  db.prepare('INSERT INTO payment_collections(id,collection_no,customer_id,amount_cents,payment_method,bank_account,collection_date,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(pcId, pcNo, customerId, amountCents, paymentMethod || 'BANK', bankAccount || '', collectionDate || now.slice(0,10), remark || '', actor.id, now);
  let totalApplied = 0;
  const itemStmt = db.prepare('INSERT INTO payment_collection_items(id,collection_id,receivable_id,amount_cents) VALUES(?,?,?,?)');
  for (const item of (items || [])) {
    itemStmt.run(id(), pcId, item.receivableId, item.amountCents);
    totalApplied += item.amountCents;
    // Update AR paid amount and status
    const ar = db.prepare('SELECT * FROM account_receivables WHERE id=?').get(item.receivableId);
    if (ar) {
      const newPaid = ar.paid_cents + item.amountCents;
      const newStatus = newPaid >= ar.amount_cents ? 'CLOSED' : (newPaid > 0 ? 'PARTIAL' : 'OPEN');
      db.prepare('UPDATE account_receivables SET paid_cents=?,status=?,updated_at=? WHERE id=?').run(newPaid, newStatus, now, item.receivableId);
    }
  }
  // Generate voucher: DR Cash/Bank, CR Accounts Receivable
  const subjectDr = paymentMethod === 'CASH' ? 'subject-001' : 'subject-002';
  generateVoucher(db, 'PAYMENT_COLLECTION', pcId, [
    { subjectId: subjectDr, direction: 'DEBIT', amountCents: amountCents, summary: '收款 ' + pcNo },
    { subjectId: 'subject-003', direction: 'CREDIT', amountCents: amountCents, summary: '收款 ' + pcNo + ' 应收结清' }
  ], actor);
  audit(db, actor.id, 'CREATE', 'PAYMENT_COLLECTION', pcId, '创建收款单 ' + pcNo + ' 金额' + amountCents / 100 + '元');
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
  const pdId = id();
  const pdNo = 'PD-' + Date.now().toString(36).toUpperCase();
  db.prepare('INSERT INTO payment_disbursements(id,disbursement_no,supplier_id,amount_cents,payment_method,bank_account,disbursement_date,remark,creator_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(pdId, pdNo, supplierId, amountCents, paymentMethod || 'BANK', bankAccount || '', disbursementDate || now.slice(0,10), remark || '', actor.id, now);
  const itemStmt = db.prepare('INSERT INTO payment_disbursement_items(id,disbursement_id,payable_id,amount_cents) VALUES(?,?,?,?)');
  for (const item of (items || [])) {
    itemStmt.run(id(), pdId, item.payableId, item.amountCents);
    // Update AP paid amount and status
    const ap = db.prepare('SELECT * FROM account_payables WHERE id=?').get(item.payableId);
    if (ap) {
      const newPaid = ap.paid_cents + item.amountCents;
      const newStatus = newPaid >= ap.amount_cents ? 'CLOSED' : (newPaid > 0 ? 'PARTIAL' : 'OPEN');
      db.prepare('UPDATE account_payables SET paid_cents=?,status=?,updated_at=? WHERE id=?').run(newPaid, newStatus, now, item.payableId);
    }
  }
  // Generate voucher: DR Accounts Payable, CR Cash/Bank
  const subjectCr = paymentMethod === 'CASH' ? 'subject-001' : 'subject-002';
  generateVoucher(db, 'PAYMENT_DISBURSEMENT', pdId, [
    { subjectId: 'subject-005', direction: 'DEBIT', amountCents: amountCents, summary: '付款 ' + pdNo },
    { subjectId: subjectCr, direction: 'CREDIT', amountCents: amountCents, summary: '付款 ' + pdNo + ' 应付结清' }
  ], actor);
  audit(db, actor.id, 'CREATE', 'PAYMENT_DISBURSEMENT', pdId, '创建付款单 ' + pdNo + ' 金额' + amountCents / 100 + '元');
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

async function createBom(db, req, res, actor) {
  allow(actor, 'PRODUCTION_ORDERS_CREATE');
  const body = await readJson(req);
  const { productId, version, remark, items } = body;
  const now = new Date().toISOString();
  const bomId = id();
  // Deactivate existing active BOM for this product
  db.prepare("UPDATE boms SET status='DISCONTINUED',updated_at=? WHERE product_id=? AND status='ACTIVE'").run(now, productId);
  db.prepare('INSERT INTO boms(id,product_id,version,status,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(bomId, productId, version || '1.0', 'ACTIVE', remark || '', actor.id, now, now);
  const itemStmt = db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
  let lineNo = 1;
  for (const item of (items || [])) {
    itemStmt.run(id(), bomId, item.productId, item.quantity || 1, item.scrapRate || 0, lineNo++);
  }
  audit(db, actor.id, 'CREATE', 'BOM', bomId, '创建物料清单 BOM-' + version);
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
  const { action, remark, items } = body;
  const now = new Date().toISOString();
  if (action === 'deactivate') {
    db.prepare("UPDATE boms SET status='DISCONTINUED',updated_at=? WHERE id=?").run(now, bomId);
    audit(db, actor.id, 'UPDATE', 'BOM', bomId, '停用BOM');
    return send(res, 200, { ok: true });
  }
  // Update items
  if (items) {
    db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(bomId);
    const itemStmt = db.prepare('INSERT INTO bom_items(id,bom_id,product_id,quantity,scrap_rate,line_no) VALUES(?,?,?,?,?,?)');
    let lineNo = 1;
    for (const item of items) {
      itemStmt.run(id(), bomId, item.productId, item.quantity || 1, item.scrapRate || 0, lineNo++);
    }
  }
  if (remark !== undefined) {
    db.prepare('UPDATE boms SET remark=?,updated_at=? WHERE id=?').run(remark, now, bomId);
  }
  audit(db, actor.id, 'UPDATE', 'BOM', bomId, '更新BOM');
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
  const now = new Date().toISOString();
  const poId = id();
  const poNo = 'MO-' + Date.now().toString(36).toUpperCase();
  db.prepare('INSERT INTO production_orders(id,order_no,product_id,bom_id,quantity,status,planned_start,planned_finish,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(poId, poNo, productId, bomId || null, quantity, 'PENDING', plannedStart || null, plannedFinish || null, remark || '', actor.id, now, now);
  // Auto-populate items from BOM if bomId provided
  if (bomId) {
    const bomItems = db.prepare('SELECT * FROM bom_items WHERE bom_id=?').all(bomId);
    const itemStmt = db.prepare('INSERT INTO production_order_items(id,order_id,product_id,quantity,consumed_quantity,line_no) VALUES(?,?,?,?,0,?)');
    let lineNo = 1;
    for (const item of bomItems) {
      const requiredQty = item.quantity * quantity * (1 + item.scrap_rate);
      itemStmt.run(id(), poId, item.product_id, requiredQty, lineNo++);
    }
  }
  audit(db, actor.id, 'CREATE', 'PRODUCTION_ORDER', poId, '创建生产工单 ' + poNo);
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
    db.prepare("UPDATE production_orders SET status='CANCELLED',updated_at=? WHERE id=?").run(now, poId);
    audit(db, actor.id, 'CANCEL', 'PRODUCTION_ORDER', poId, '取消生产工单 ' + order.order_no);
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



const INVENTORY_CHECK_STATUS = { DRAFT: "待审核", SUBMITTED: "已提交", APPROVED: "已审核" };
const AR_STATUS = { OPEN: '未收', PARTIAL: '部分收款', CLOSED: '已结清' };
const AP_STATUS = { OPEN: '未付', PARTIAL: '部分付款', CLOSED: '已结清' };



const RECEIPT_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const DELIVERY_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };
const RETURN_STATUS = { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' };

// ============ Cash Journals ============

async function listCashJournals(db, res, actor, url) {
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

async function createCashJournal(db, req, res, actor) {
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

async function listBankAccounts(db, res, actor) {
  allowAny(actor, ['BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE']);
  const accounts = db.prepare('SELECT * FROM bank_accounts ORDER BY created_at DESC').all();
  return send(res, 200, { accounts });
}

async function createBankAccount(db, req, res, actor) {
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

async function updateBankAccount(db, req, res, actor, accountId) {
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

async function listBills(db, res, actor, url) {
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

async function createBill(db, req, res, actor) {
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

async function updateBill(db, req, res, actor, billId) {
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

async function listFixedAssets(db, res, actor) {
  allowAny(actor, ['FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE']);
  const assets = db.prepare(`SELECT fa.*, u.name creatorName,
    (SELECT SUM(depreciation_cents) FROM asset_depreciations WHERE asset_id=fa.id) totalDepreciatedCents
    FROM fixed_assets fa
    LEFT JOIN users u ON u.id=fa.creator_id
    ORDER BY fa.purchase_date DESC`).all();
  return send(res, 200, { assets });
}

async function createFixedAsset(db, req, res, actor) {
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

async function updateFixedAsset(db, req, res, actor, assetId) {
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

async function calculateDepreciation(db, req, res, actor) {
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

async function listProductCosts(db, res, actor, url) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const productId = url.searchParams.get('productId') || '';
  let sql = `SELECT pc.*, p.code productCode, p.name productName, u.name creatorName 
    FROM product_costs pc JOIN products p ON p.id=pc.product_id LEFT JOIN users u ON u.id=pc.creator_id WHERE pc.status='ACTIVE'`;
  const params = [];
  if (productId) { sql += ` AND pc.product_id=?`; params.push(productId); }
  sql += ` ORDER BY pc.effective_date DESC`;
  const costs = db.prepare(sql).all(...params);
  return send(res, 200, { costs });
}

async function createProductCost(db, req, res, actor) {
  allow(actor, 'COST_MANAGE');
  const body = await readJson(req);
  const { product_id, standard_cost_cents, material_cost_cents, labor_cost_cents, overhead_cost_cents, effective_date, remark } = body;
  const now = new Date().toISOString();
  const costId = id();
  
  // Mark existing as historical
  db.prepare(`UPDATE product_costs SET status='HISTORICAL',updated_at=? WHERE product_id=? AND status='ACTIVE'`).run(now, product_id);
  
  db.prepare(`INSERT INTO product_costs(id,product_id,standard_cost_cents,material_cost_cents,labor_cost_cents,overhead_cost_cents,effective_date,status,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    costId, product_id, standard_cost_cents, material_cost_cents, labor_cost_cents, overhead_cost_cents, effective_date, 'ACTIVE', remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'PRODUCT_COST', costId, `设置产品标准成本`);
  return send(res, 200, { id: costId });
}

async function listCostRates(db, res, actor) {
  allowAny(actor, ['COST_VIEW', 'COST_MANAGE']);
  const rates = db.prepare('SELECT cr.*, u.name creatorName FROM cost_rates cr LEFT JOIN users u ON u.id=cr.creator_id ORDER BY cr.category, cr.code').all();
  return send(res, 200, { rates });
}

async function createCostRate(db, req, res, actor) {
  allow(actor, 'COST_MANAGE');
  const body = await readJson(req);
  const { code, name, category, rate_cents_per_hour, unit, remark } = body;
  const now = new Date().toISOString();
  const rateId = id();
  
  db.prepare('INSERT INTO cost_rates(id,code,name,category,rate_cents_per_hour,unit,active,remark,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?)').run(
    rateId, code, name, category, rate_cents_per_hour, unit || '小时', remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'COST_RATE', rateId, `新增费用项目 ${name}`);
  return send(res, 200, { id: rateId });
}

async function updateCostRate(db, req, res, actor, rateId) {
  allow(actor, 'COST_MANAGE');
  const body = await readJson(req);
  const { name, category, rate_cents_per_hour, unit, active, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE cost_rates SET name=?,category=?,rate_cents_per_hour=?,unit=?,active=?,remark=?,updated_at=? WHERE id=?').run(
    name, category, rate_cents_per_hour, unit, active ? 1 : 0, remark || '', now, rateId
  );
  
  audit(db, actor.id, 'UPDATE', 'COST_RATE', rateId, `更新费用项目 ${name}`);
  return send(res, 200, { ok: true });
}

async function calculateProductionCost(db, req, res, actor) {
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
// ============ IQC Inspections ============

async function listIQCs(db, res, actor, url) {
  allowAny(actor, ['QC_VIEW', 'QC_MANAGE']);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT i.*, s.name supplierName, u.name inspectorName, creator.name creatorName
    FROM iqc_inspections i
    LEFT JOIN suppliers s ON s.id=i.supplier_id
    LEFT JOIN users u ON u.id=i.inspector_id
    LEFT JOIN users creator ON creator.id=i.creator_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND i.status=?`; params.push(status); }
  sql += ` ORDER BY i.inspection_date DESC, i.created_at DESC`;
  const inspections = db.prepare(sql).all(...params);
  return send(res, 200, { inspections });
}

async function createIQC(db, req, res, actor) {
  allow(actor, 'QC_MANAGE');
  const body = await readJson(req);
  const { source_type, source_id, supplier_id, inspector_id, inspection_date, items, remark } = body;
  const now = new Date().toISOString();
  const iqcId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM iqc_inspections WHERE inspection_date LIKE ?').get(inspection_date.slice(0, 7) + '%').cnt + 1).padStart(4, '0');
  const inspectionNo = `IQC-${inspection_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO iqc_inspections(id,inspection_no,source_type,source_id,supplier_id,inspector_id,inspection_date,status,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(iqcId, inspectionNo, source_type, source_id, supplier_id, inspector_id, inspection_date, 'PENDING', remark || '', actor.id, now, now);
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemId = id();
    db.prepare('INSERT INTO iqc_inspection_items(id,inspection_id,product_id,quantity,sampled_quantity,qualified_quantity,defective_quantity,defect_rate,inspection_result,remark) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      itemId, iqcId, item.product_id, item.quantity, item.sampled_quantity || 0, item.qualified_quantity || 0, item.defective_quantity || 0, item.defect_rate || 0, item.inspection_result || 'PASS', item.remark || ''
    );
  }
  
  audit(db, actor.id, 'CREATE', 'IQC_INSPECTION', iqcId, `新建来料检验单 ${inspectionNo}`);
  return send(res, 200, { id: iqcId, inspection_no: inspectionNo });
}

async function updateIQC(db, req, res, actor, iqcId) {
  allow(actor, 'QC_MANAGE');
  const body = await readJson(req);
  const { status, items } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE iqc_inspections SET status=?,updated_at=? WHERE id=?').run(status, now, iqcId);
  
  if (items) {
    db.prepare('DELETE FROM iqc_inspection_items WHERE inspection_id=?').run(iqcId);
    for (const item of items) {
      const itemId = id();
      db.prepare('INSERT INTO iqc_inspection_items(id,inspection_id,product_id,quantity,sampled_quantity,qualified_quantity,defective_quantity,defect_rate,inspection_result,remark) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
        itemId, iqcId, item.product_id, item.quantity, item.sampled_quantity || 0, item.qualified_quantity || 0, item.defective_quantity || 0, item.defect_rate || 0, item.inspection_result || 'PASS', item.remark || ''
      );
    }
  }
  
  audit(db, actor.id, 'UPDATE', 'IQC_INSPECTION', iqcId, `更新来料检验单状态为 ${status}`);
  return send(res, 200, { ok: true });
}

async function getIQCDetail(db, res, actor, iqcId) {
  allowAny(actor, ['QC_VIEW', 'QC_MANAGE']);
  const inspection = db.prepare('SELECT i.*, s.name supplierName, u.name inspectorName FROM iqc_inspections i LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN users u ON u.id=i.inspector_id WHERE i.id=?').get(iqcId);
  if (!inspection) throw new HttpError(404, '检验单不存在');
  inspection.items = db.prepare(`SELECT ii.*, p.code productCode, p.name productName FROM iqc_inspection_items ii JOIN products p ON p.id=ii.product_id WHERE ii.inspection_id=?`).all(iqcId);
  return send(res, 200, { inspection });
}

// ============ OQC Inspections ============

async function listOQCs(db, res, actor, url) {
  allowAny(actor, ['QC_VIEW', 'QC_MANAGE']);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT o.*, c.name customerName, u.name inspectorName, creator.name creatorName
    FROM oqc_inspections o
    LEFT JOIN customers c ON c.id=o.customer_id
    LEFT JOIN users u ON u.id=o.inspector_id
    LEFT JOIN users creator ON creator.id=o.creator_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND o.status=?`; params.push(status); }
  sql += ` ORDER BY o.inspection_date DESC, o.created_at DESC`;
  const inspections = db.prepare(sql).all(...params);
  return send(res, 200, { inspections });
}

async function createOQC(db, req, res, actor) {
  allow(actor, 'QC_MANAGE');
  const body = await readJson(req);
  const { source_type, source_id, customer_id, inspector_id, inspection_date, items, remark } = body;
  const now = new Date().toISOString();
  const oqcId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM oqc_inspections WHERE inspection_date LIKE ?').get(inspection_date.slice(0, 7) + '%').cnt + 1).padStart(4, '0');
  const inspectionNo = `OQC-${inspection_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO oqc_inspections(id,inspection_no,source_type,source_id,customer_id,inspector_id,inspection_date,status,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(oqcId, inspectionNo, source_type, source_id, customer_id, inspector_id, inspection_date, 'PENDING', remark || '', actor.id, now, now);
  
  for (const item of items) {
    const itemId = id();
    db.prepare('INSERT INTO oqc_inspection_items(id,inspection_id,product_id,quantity,sampled_quantity,qualified_quantity,defective_quantity,inspection_result,remark) VALUES(?,?,?,?,?,?,?,?,?)').run(
      itemId, oqcId, item.product_id, item.quantity, item.sampled_quantity || 0, item.qualified_quantity || 0, item.defective_quantity || 0, item.inspection_result || 'PASS', item.remark || ''
    );
  }
  
  audit(db, actor.id, 'CREATE', 'OQC_INSPECTION', oqcId, `新建出货检验单 ${inspectionNo}`);
  return send(res, 200, { id: oqcId, inspection_no: inspectionNo });
}

async function updateOQC(db, req, res, actor, oqcId) {
  allow(actor, 'QC_MANAGE');
  const body = await readJson(req);
  const { status, items } = body;
  const now = new Date().toISOString();
  
  db.prepare('UPDATE oqc_inspections SET status=?,updated_at=? WHERE id=?').run(status, now, oqcId);
  
  if (items) {
    db.prepare('DELETE FROM oqc_inspection_items WHERE inspection_id=?').run(oqcId);
    for (const item of items) {
      const itemId = id();
      db.prepare('INSERT INTO oqc_inspection_items(id,inspection_id,product_id,quantity,sampled_quantity,qualified_quantity,defective_quantity,inspection_result,remark) VALUES(?,?,?,?,?,?,?,?,?)').run(
        itemId, oqcId, item.product_id, item.quantity, item.sampled_quantity || 0, item.qualified_quantity || 0, item.defective_quantity || 0, item.inspection_result || 'PASS', item.remark || ''
      );
    }
  }
  
  audit(db, actor.id, 'UPDATE', 'OQC_INSPECTION', oqcId, `更新出货检验单状态为 ${status}`);
  return send(res, 200, { ok: true });
}

async function getOQCDetail(db, res, actor, oqcId) {
  allowAny(actor, ['QC_VIEW', 'QC_MANAGE']);
  const inspection = db.prepare('SELECT o.*, c.name customerName, u.name inspectorName FROM oqc_inspections o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.inspector_id WHERE o.id=?').get(oqcId);
  if (!inspection) throw new HttpError(404, '检验单不存在');
  inspection.items = db.prepare(`SELECT oi.*, p.code productCode, p.name productName FROM oqc_inspection_items oi JOIN products p ON p.id=oi.product_id WHERE oi.inspection_id=?`).all(oqcId);
  return send(res, 200, { inspection });
}
// ============ Contacts ============

async function listContacts(db, res, actor, url) {
  allowAny(actor, ['CRM_VIEW', 'CRM_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE']);
  const customerId = url.searchParams.get('customerId') || '';
  const supplierId = url.searchParams.get('supplierId') || '';
  let sql = `SELECT c.*, cu.name customerName, s.name supplierName, u.name creatorName
    FROM contacts c
    LEFT JOIN customers cu ON cu.id=c.customer_id
    LEFT JOIN suppliers s ON s.id=c.supplier_id
    LEFT JOIN users u ON u.id=c.creator_id
    WHERE 1=1`;
  const params = [];
  if (customerId) { sql += ` AND c.customer_id=?`; params.push(customerId); }
  if (supplierId) { sql += ` AND c.supplier_id=?`; params.push(supplierId); }
  sql += ` ORDER BY c.created_at DESC`;
  const contacts = db.prepare(sql).all(...params);
  return send(res, 200, { contacts });
}

async function createContact(db, req, res, actor) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { customer_id, supplier_id, name, gender, position, phone, mobile, email, wechat, birthday, remark, is_primary } = body;
  const now = new Date().toISOString();
  const contactId = id();
  
  db.prepare(`INSERT INTO contacts(id,customer_id,supplier_id,name,gender,position,phone,mobile,email,wechat,birthday,remark,is_primary,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    contactId, customer_id || null, supplier_id || null, name, gender || null, position || '', phone || '', mobile || '', email || '', wechat || '', birthday || '', remark || '', is_primary ? 1 : 0, actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'CONTACT', contactId, `新增联系人 ${name}`);
  return send(res, 200, { id: contactId });
}

async function updateContact(db, req, res, actor, contactId) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { name, gender, position, phone, mobile, email, wechat, birthday, remark, is_primary } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE contacts SET name=?,gender=?,position=?,phone=?,mobile=?,email=?,wechat=?,birthday=?,remark=?,is_primary=?,updated_at=? WHERE id=?`).run(
    name, gender, position, phone, mobile, email, wechat, birthday, remark, is_primary ? 1 : 0, now, contactId
  );
  
  audit(db, actor.id, 'UPDATE', 'CONTACT', contactId, `更新联系人 ${name}`);
  return send(res, 200, { ok: true });
}

async function deleteContact(db, req, res, actor, contactId) {
  allow(actor, 'CRM_MANAGE');
  const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(contactId);
  if (!contact) throw new HttpError(404, '联系人不存在');
  db.prepare('DELETE FROM contacts WHERE id=?').run(contactId);
  audit(db, actor.id, 'DELETE', 'CONTACT', contactId, `删除联系人 ${contact.name}`);
  return send(res, 200, { ok: true });
}

// ============ Customer Followups ============

async function listFollowups(db, res, actor, url) {
  allowAny(actor, ['CRM_VIEW', 'CRM_MANAGE']);
  const customerId = url.searchParams.get('customerId') || '';
  let sql = `SELECT f.*, cu.name customerName, u.name handlerName, creator.name creatorName
    FROM customer_followups f
    LEFT JOIN customers cu ON cu.id=f.customer_id
    LEFT JOIN users u ON u.id=f.handler_id
    LEFT JOIN users creator ON creator.id=f.creator_id
    WHERE 1=1`;
  const params = [];
  if (customerId) { sql += ` AND f.customer_id=?`; params.push(customerId); }
  sql += ` ORDER BY f.followup_date DESC, f.created_at DESC`;
  const followups = db.prepare(sql).all(...params);
  return send(res, 200, { followups });
}

async function createFollowup(db, req, res, actor) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { customer_id, followup_type, followup_date, content, next_plan, next_date, handler_id } = body;
  const now = new Date().toISOString();
  const followupId = id();
  
  db.prepare(`INSERT INTO customer_followups(id,customer_id,followup_type,followup_date,content,next_plan,next_date,handler_id,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    followupId, customer_id, followup_type, followup_date, content, next_plan || '', next_date || '', handler_id || actor.id, actor.id, now
  );
  
  audit(db, actor.id, 'CREATE', 'CUSTOMER_FOLLOWUP', followupId, `新增客户跟进 ${content.slice(0, 20)}`);
  return send(res, 200, { id: followupId });
}

// ============ Sales Activities ============

async function listSalesActivities(db, res, actor, url) {
  allowAny(actor, ['CRM_VIEW', 'CRM_MANAGE']);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT sa.*, u.name creatorName FROM sales_activities sa LEFT JOIN users u ON u.id=sa.creator_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND sa.status=?`; params.push(status); }
  sql += ` ORDER BY sa.start_date DESC`;
  const activities = db.prepare(sql).all(...params);
  return send(res, 200, { activities });
}

async function createSalesActivity(db, req, res, actor) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { activity_type, title, content, start_date, end_date, location, budget_cents, participants, status, result } = body;
  const now = new Date().toISOString();
  const activityId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM sales_activities WHERE start_date LIKE ?').get(start_date.slice(0, 7) + '%').cnt + 1).padStart(4, '0');
  const activityNo = `SA-${start_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO sales_activities(id,activity_no,activity_type,title,content,start_date,end_date,location,budget_cents,actual_cost_cents,participants,status,result,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`).run(
    activityId, activityNo, activity_type, title, content, start_date, end_date || '', location || '', budget_cents || 0, participants || '', status || 'PLANNING', result || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'SALES_ACTIVITY', activityId, `新建销售活动 ${title}`);
  return send(res, 200, { id: activityId, activity_no: activityNo });
}

async function updateSalesActivity(db, req, res, actor, activityId) {
  allow(actor, 'CRM_MANAGE');
  const body = await readJson(req);
  const { title, content, start_date, end_date, location, budget_cents, actual_cost_cents, participants, status, result } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE sales_activities SET title=?,content=?,start_date=?,end_date=?,location=?,budget_cents=?,actual_cost_cents=?,participants=?,status=?,result=?,updated_at=? WHERE id=?`).run(
    title, content, start_date, end_date || '', location || '', budget_cents || 0, actual_cost_cents || 0, participants || '', status, result || '', now, activityId
  );
  
  audit(db, actor.id, 'UPDATE', 'SALES_ACTIVITY', activityId, `更新销售活动 ${title}`);
  return send(res, 200, { ok: true });
}

async function deleteSalesActivity(db, req, res, actor, activityId) {
  allow(actor, 'CRM_MANAGE');
  const activity = db.prepare('SELECT * FROM sales_activities WHERE id=?').get(activityId);
  if (!activity) throw new HttpError(404, '活动不存在');
  db.prepare('DELETE FROM sales_activities WHERE id=?').run(activityId);
  audit(db, actor.id, 'DELETE', 'SALES_ACTIVITY', activityId, `删除销售活动 ${activity.title}`);
  return send(res, 200, { ok: true });
}
// ============ Projects ============

async function listProjects(db, res, actor, url) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const status = url.searchParams.get('status') || '';
  let sql = `SELECT p.*, c.name customerName, u.name managerName, creator.name creatorName
    FROM projects p
    LEFT JOIN customers c ON c.id=p.customer_id
    LEFT JOIN users u ON u.id=p.manager_id
    LEFT JOIN users creator ON creator.id=p.creator_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ` AND p.status=?`; params.push(status); }
  sql += ` ORDER BY p.created_at DESC`;
  const projects = db.prepare(sql).all(...params);
  return send(res, 200, { projects });
}

async function createProject(db, req, res, actor) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { project_no, name, description, project_type, customer_id, start_date, end_date, budget_cents, manager_id, remark } = body;
  const now = new Date().toISOString();
  const projectId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM projects WHERE start_date LIKE ?').get(start_date.slice(0, 7) + '%').cnt + 1).padStart(4, '0');
  const projectNo = project_no || `PRJ-${start_date.replace(/-/g,'')}-${seq}`;
  
  db.prepare(`INSERT INTO projects(id,project_no,name,description,project_type,customer_id,start_date,end_date,status,budget_cents,manager_id,remark,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    projectId, projectNo, name, description, project_type, customer_id || null, start_date, end_date || null, 'PLANNING', budget_cents || 0, manager_id, remark || '', actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'PROJECT', projectId, `新建项目 ${name}`);
  return send(res, 200, { id: projectId, project_no: projectNo });
}

async function updateProject(db, req, res, actor, projectId) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { name, description, project_type, customer_id, start_date, end_date, status, budget_cents, manager_id, remark } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE projects SET name=?,description=?,project_type=?,customer_id=?,start_date=?,end_date=?,status=?,budget_cents=?,manager_id=?,remark=?,updated_at=? WHERE id=?`).run(
    name, description, project_type, customer_id || null, start_date, end_date || null, status, budget_cents || 0, manager_id, remark || '', now, projectId
  );
  
  audit(db, actor.id, 'UPDATE', 'PROJECT', projectId, `更新项目 ${name}`);
  return send(res, 200, { ok: true });
}

async function getProjectDetail(db, res, actor, projectId) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const project = db.prepare(`SELECT p.*, c.name customerName, u.name managerName FROM projects p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN users u ON u.id=p.manager_id WHERE p.id=?`).get(projectId);
  if (!project) throw new HttpError(404, '项目不存在');
  project.tasks = db.prepare(`SELECT t.*, u.name assigneeName FROM project_tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.project_id=? ORDER BY t.created_at`).all(projectId);
  project.timesheets = db.prepare(`SELECT ts.*, u.name userName FROM project_timesheets ts LEFT JOIN users u ON u.id=ts.user_id WHERE ts.project_id=? ORDER BY ts.work_date DESC LIMIT 100`).all(projectId);
  return send(res, 200, { project });
}

// ============ Project Tasks ============

async function listProjectTasks(db, res, actor, url) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const projectId = url.searchParams.get('projectId') || '';
  let sql = `SELECT t.*, p.name projectName, u.name assigneeName
    FROM project_tasks t
    LEFT JOIN projects p ON p.id=t.project_id
    LEFT JOIN users u ON u.id=t.assignee_id
    WHERE 1=1`;
  const params = [];
  if (projectId) { sql += ` AND t.project_id=?`; params.push(projectId); }
  sql += ` ORDER BY t.priority DESC, t.created_at`;
  const tasks = db.prepare(sql).all(...params);
  return send(res, 200, { tasks });
}

async function createProjectTask(db, req, res, actor) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { project_id, parent_id, name, description, priority, planned_start, planned_end, assignee_id, estimated_hours } = body;
  const now = new Date().toISOString();
  const taskId = id();
  const seq = String(db.prepare('SELECT COUNT(*) cnt FROM project_tasks WHERE project_id=?').get(project_id).cnt + 1).padStart(3, '0');
  const taskNo = `TASK-${seq}`;
  
  db.prepare(`INSERT INTO project_tasks(id,project_id,parent_id,task_no,name,description,priority,status,planned_start,planned_end,assignee_id,estimated_hours,creator_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    taskId, project_id, parent_id || null, taskNo, name, description, priority || 'MEDIUM', 'PENDING', planned_start || null, planned_end || null, assignee_id || null, estimated_hours || 0, actor.id, now, now
  );
  
  audit(db, actor.id, 'CREATE', 'PROJECT_TASK', taskId, `新建任务 ${name}`);
  return send(res, 200, { id: taskId, task_no: taskNo });
}

async function updateProjectTask(db, req, res, actor, taskId) {
  allow(actor, 'PROJECT_MANAGE');
  const body = await readJson(req);
  const { name, description, priority, status, planned_start, planned_end, actual_start, actual_end, progress, assignee_id, estimated_hours } = body;
  const now = new Date().toISOString();
  
  db.prepare(`UPDATE project_tasks SET name=?,description=?,priority=?,status=?,planned_start=?,planned_end=?,actual_start=?,actual_end=?,progress=?,assignee_id=?,estimated_hours=?,updated_at=? WHERE id=?`).run(
    name, description, priority, status, planned_start || null, planned_end || null, actual_start || null, actual_end || null, progress || 0, assignee_id || null, estimated_hours || 0, now, taskId
  );
  
  audit(db, actor.id, 'UPDATE', 'PROJECT_TASK', taskId, `更新任务 ${name}`);
  return send(res, 200, { ok: true });
}

// ============ Project Timesheets ============

async function listTimesheets(db, res, actor, url) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const projectId = url.searchParams.get('projectId') || '';
  const userId = url.searchParams.get('userId') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';
  
  let sql = `SELECT ts.*, p.name projectName, t.name taskName, u.name userName
    FROM project_timesheets ts
    LEFT JOIN projects p ON p.id=ts.project_id
    LEFT JOIN project_tasks t ON t.id=ts.task_id
    LEFT JOIN users u ON u.id=ts.user_id
    WHERE 1=1`;
  const params = [];
  if (projectId) { sql += ` AND ts.project_id=?`; params.push(projectId); }
  if (userId) { sql += ` AND ts.user_id=?`; params.push(userId); }
  if (startDate) { sql += ` AND ts.work_date>=?`; params.push(startDate); }
  if (endDate) { sql += ` AND ts.work_date<=?`; params.push(endDate); }
  sql += ` ORDER BY ts.work_date DESC, ts.created_at DESC`;
  
  const timesheets = db.prepare(sql).all(...params);
  return send(res, 200, { timesheets });
}

async function createTimesheet(db, req, res, actor) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const body = await readJson(req);
  const { project_id, task_id, user_id, work_date, hours, description, billable } = body;
  const now = new Date().toISOString();
  const tsId = id();
  
  db.prepare(`INSERT INTO project_timesheets(id,project_id,task_id,user_id,work_date,hours,description,billable,creator_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    tsId, project_id, task_id || null, user_id || actor.id, work_date, hours, description || '', billable ? 1 : 0, actor.id, now
  );
  
  audit(db, actor.id, 'CREATE', 'TIMESHEET', tsId, `记录工时 ${hours}h`);
  return send(res, 200, { id: tsId });
}

async function deleteTimesheet(db, req, res, actor, tsId) {
  allowAny(actor, ['PROJECT_VIEW', 'PROJECT_MANAGE']);
  const ts = db.prepare('SELECT * FROM project_timesheets WHERE id=?').get(tsId);
  if (!ts) throw new HttpError(404, '工时记录不存在');
  db.prepare('DELETE FROM project_timesheets WHERE id=?').run(tsId);
  audit(db, actor.id, 'DELETE', 'TIMESHEET', tsId, `删除工时记录`);
  return send(res, 200, { ok: true });
}
// ============ Notifications ============

async function listNotifications(db, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(actor.id);
  const unreadCount = db.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').get(actor.id).cnt;
  return send(res, 200, { notifications, unreadCount });
}

async function markNotificationRead(db, req, res, actor) {
  allow(actor, 'DASHBOARD_VIEW');
  const body = await readJson(req);
  const { notificationId } = body;
  if (notificationId) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(notificationId, actor.id);
  } else {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(actor.id);
  }
  return send(res, 200, { ok: true });
}

function createNotification(db, userId, title, content, type = 'INFO', sourceType = null, sourceId = null) {
  const now = new Date().toISOString();
  const nid = id();
  db.prepare('INSERT INTO notifications(id,user_id,title,content,type,source_type,source_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(nid, userId, title, content, type, sourceType, sourceId, now);
}

// ============ Approval Workflows ============

async function listWorkflows(db, res, actor) {
  allowAny(actor, ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE']);
  const workflows = db.prepare('SELECT w.*, u.name creatorName FROM approval_workflows w LEFT JOIN users u ON u.id=w.creator_id ORDER BY w.created_at DESC').all();
  return send(res, 200, { workflows });
}

async function createWorkflow(db, req, res, actor) {
  allow(actor, 'WORKFLOW_MANAGE');
  const body = await readJson(req);
  const { name, entity_type, steps } = body;
  const now = new Date().toISOString();
  const wfId = id();
  
  db.prepare('INSERT INTO approval_workflows(id,name,entity_type,steps,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(wfId, name, entity_type, JSON.stringify(steps || []), actor.id, now, now);
  
  audit(db, actor.id, 'CREATE', 'WORKFLOW', wfId, `创建审批流程 ${name}`);
  return send(res, 200, { id: wfId });
}

async function listApprovalRecords(db, res, actor, url) {
  allowAny(actor, ['WORKFLOW_VIEW', 'WORKFLOW_MANAGE']);
  const entityType = url.searchParams.get('entityType') || '';
  const entityId = url.searchParams.get('entityId') || '';
  
  let sql = `SELECT ar.*, u.name approverName FROM approval_records ar LEFT JOIN users u ON u.id=ar.approver_id WHERE 1=1`;
  const params = [];
  if (entityType) { sql += ` AND ar.entity_type=?`; params.push(entityType); }
  if (entityId) { sql += ` AND ar.entity_id=?`; params.push(entityId); }
  sql += ` ORDER BY ar.created_at DESC`;
  
  const records = db.prepare(sql).all(...params);
  return send(res, 200, { records });
}