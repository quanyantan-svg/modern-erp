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
    productCount: db.prepare('SELECT count(*) count FROM products WHERE active=1').get().count,
    orderCount: db.prepare('SELECT count(*) count FROM sales_orders').get().count,
    pendingCount: db.prepare("SELECT count(*) count FROM sales_orders WHERE status='SUBMITTED'").get().count,
    approvedAmountCents: db.prepare("SELECT coalesce(sum(total_cents),0) total FROM sales_orders WHERE status='APPROVED'").get().total,
    recentOrders: orderRows(db, '', [], 'ORDER BY so.created_at DESC LIMIT 5')
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
  const suppliers = db.prepare(`SELECT id,code,name,contact,phone,address,email,active,created_at createdAt,updated_at updatedAt
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
