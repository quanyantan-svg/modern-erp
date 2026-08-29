import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

export const PERMISSIONS = [
  ['SUPPLIERS_VIEW', '查看供应商'],
  ['SUPPLIERS_MANAGE', '管理供应商'],

  ['DASHBOARD_VIEW', '查看工作台'],
  ['USERS_MANAGE', '管理用户'],
  ['ROLES_MANAGE', '管理角色'],
  ['CUSTOMERS_VIEW', '查看客户'],
  ['CUSTOMERS_MANAGE', '管理客户'],
  ['PRODUCTS_VIEW', '查看货品'],
  ['PRODUCTS_MANAGE', '管理货品'],
  ['ORDERS_VIEW', '查看销售订单'],
  ['ORDERS_CREATE', '创建/修改销售订单'],
  ['ORDERS_SUBMIT', '提交销售订单'],
  ['ORDERS_APPROVE', '审核销售订单']
];

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHex) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_role INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_code TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_code),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_code) REFERENCES permissions(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (role_id) REFERENCES roles(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      stock_quantity REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
      total_cents INTEGER NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      rejection_reason TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      reviewer_id TEXT,
      submitted_at TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
      amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      line_no INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(order_id, line_no)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON sales_orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON sales_orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
  `);
}

function seed(db) {
  const now = new Date().toISOString();
  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions(code, name) VALUES (?, ?)');
  for (const permission of PERMISSIONS) insertPermission.run(...permission);

  const roles = [
    ['role-admin', 'ADMIN', '系统管理员', '管理用户、角色和全部业务', 1],
    ['role-sales', 'SALES', '销售专员', '维护客户并创建、提交销售订单', 1],
    ['role-reviewer', 'REVIEWER', '销售主管', '查看并审核销售订单', 1]
  ];
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles(id, code, name, description, system_role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const role of roles) insertRole.run(...role, now);

  const all = PERMISSIONS.map(([code]) => code);
  const rolePermissions = {
    'role-admin': all,
    'role-sales': ['DASHBOARD_VIEW', 'SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'PRODUCTS_VIEW', 'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT'],
    'role-reviewer': ['DASHBOARD_VIEW', 'CUSTOMERS_VIEW', 'PRODUCTS_VIEW', 'ORDERS_VIEW', 'ORDERS_APPROVE']
  };
  const insertRolePermission = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)');
  for (const [roleId, permissions] of Object.entries(rolePermissions)) {
    for (const permission of permissions) insertRolePermission.run(roleId, permission);
  }

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const user of [
    ['user-admin', 'admin', '系统管理员', 'admin123', 'role-admin'],
    ['user-sales', 'sales', '销售专员', 'sales123', 'role-sales'],
    ['user-reviewer', 'reviewer', '销售主管', 'review123', 'role-reviewer']
  ]) {
    const password = hashPassword(user[3]);
    insertUser.run(user[0], user[1], user[2], password.hash, password.salt, user[4], now);
  }

  const insertCustomer = db.prepare(`
    INSERT OR IGNORE INTO customers(id, code, name, contact, phone, address, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insertSupplier = db.prepare(`
    INSERT OR IGNORE INTO suppliers(id, code, name, contact, phone, address, email, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertSupplier.run('supplier-001', 'SUP-001', '深圳市鹏程电子有限公司', '王经理', '13800002001', '广东省深圳市南山区', 'wang@pengcheng.cn', now, now);
  insertSupplier.run('supplier-002', 'SUP-002', '东莞市鑫源物料有限公司', '李工', '13800002002', '广东省东莞市长安镇', 'li@xinyuan.cn', now, now);

  insertCustomer.run('customer-001', 'CUS-001', '晨曦智能制造有限公司', '林经理', '13800001001', '福建省福州市', now, now);
  insertCustomer.run('customer-002', 'CUS-002', '远航精密科技有限公司', '陈工', '13800001002', '广东省深圳市', now, now);

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products(id, code, name, unit, price_cents, stock_quantity, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertProduct.run('product-001', 'MAT-001', '工业控制器', '台', 259900, 36, now, now);
  insertProduct.run('product-002', 'MAT-002', '智能传感器', '个', 32900, 180, now, now);
  insertProduct.run('product-003', 'MAT-003', '数据采集网关', '台', 128000, 52, now, now);

  db.prepare(`INSERT OR IGNORE INTO sales_orders
    (id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,created_at,updated_at)
    VALUES('order-demo-001','SO-DEMO-001','customer-001','SUBMITTED',684300,'首张演示订单，等待销售主管审核','user-sales',?,?,?)`)
    .run(now, now, now);
  const insertItem = db.prepare(`INSERT OR IGNORE INTO sales_order_items
    (id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES(?,?,?,?,?,?,?)`);
  insertItem.run('item-demo-001', 'order-demo-001', 'product-001', 2, 259900, 519800, 1);
  insertItem.run('item-demo-002', 'order-demo-001', 'product-002', 5, 32900, 164500, 2);
  db.prepare(`INSERT OR IGNORE INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at)
    VALUES('audit-demo-001','user-sales','CREATE','SALES_ORDER','order-demo-001','创建并提交演示订单 SO-DEMO-001',?)`).run(now);
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function id() {
  return randomUUID();
}
