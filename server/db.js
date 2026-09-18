import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { migrateExtendedSchema } from './migrations/extended-schema.js';
import { migrateProductRoutingSchema } from './migrations/product-routing.js';
import { migratePlanningSchema } from './migrations/planning-schema.js';
import { migratePlanningDocumentsSchema } from './migrations/planning-documents-schema.js';
import { migrateInventoryExtensionsSchema } from './migrations/inventory-extensions-schema.js';
import { migrateSettlementSchema, reconcileSettlementSubledgers } from './modules/settlement-core.js';

export const PERMISSIONS = [
  ['SUPPLIERS_VIEW', '查看供应商'],
  ['SUPPLIERS_MANAGE', '管理供应商资料'],
  ['DASHBOARD_VIEW', '查看仪表板'],
  ['USERS_MANAGE', '管理用户'],
  ['ROLES_MANAGE', '管理角色'],
  ['CUSTOMERS_VIEW', '查看客户'],
  ['CUSTOMERS_MANAGE', '管理客户资料'],
  ['PRODUCTS_VIEW', '查看产品'],
  ['PRODUCTS_MANAGE', '管理产品资料'],
  ['ORDERS_VIEW', '查看销售订单'],
  ['ORDERS_CREATE', '新建/修改销售订单'],
  ['ORDERS_SUBMIT', '提交销售订单'],
  ['ORDERS_APPROVE', '审核销售订单'],
  ['ORDERS_REJECT', '驳回销售订单'],
  ['PURCHASE_ORDERS_VIEW', '查看采购订单'],
  ['PURCHASE_ORDERS_CREATE', '新建/修改采购订单'],
  ['PURCHASE_ORDERS_SUBMIT', '提交采购订单'],
  ['PURCHASE_ORDERS_APPROVE', '审核采购订单'],
  ['WAREHOUSES_VIEW', '查看仓库'],
  ['WAREHOUSES_MANAGE', '管理仓库'],
  ['INVENTORY_VIEW', '查看库存'],
  ['INVENTORY_CHECK_CREATE', '新建库存盘点单'],
  ['INVENTORY_CHECK_APPROVE', '审批库存盘点单'],
  ['INVENTORY_TRANSFER_CREATE', '新建库存调拨单'],
  ['INVENTORY_TRANSFER_APPROVE', '审核库存调拨'],
  ['INVENTORY_ADJUSTMENT_MANAGE', '管理库存调整单'],
  ['PURCHASE_RECEIPTS_VIEW', '查看采购入库单'],
  ['PURCHASE_RECEIPTS_MANAGE', '管理采购入库单'],
  ['SALES_DELIVERIES_VIEW', '查看销售出库单'],
  ['SALES_DELIVERIES_MANAGE', '管理销售出库单'],
  ['RETURNS_VIEW', '查看退货单'],
  ['RETURNS_MANAGE', '管理退货单'],
  ['PRODUCTION_ORDERS_VIEW', '查看生产工单'],
  ['PRODUCTION_ORDERS_CREATE', '新建生产工单'],
  ['PRODUCTION_ORDERS_START', '开始生产'],
  ['PRODUCTION_ORDERS_COMPLETE', '完成生产'],
  ['ACCOUNTING_VIEW', '查看财务凭证'],
  ['AR_VIEW', '查看应收账款与客户对账单'],
  ['COLLECTION_MANAGE', '管理并确认收款单'],
  ['AP_VIEW', '查看应付账款与供应商对账单'],
  ['PAYMENT_MANAGE', '管理并确认付款单'],
  ['VOUCHER_SUBMIT', '提交凭证'],
  ['VOUCHER_APPROVE', '审核凭证'],
  ['CASH_JOURNALS_VIEW', '查看现金日记账'],
  ['CASH_JOURNALS_MANAGE', '管理现金日记账'],
  ['BANK_ACCOUNTS_VIEW', '查看银行账户'],
  ['BANK_ACCOUNTS_MANAGE', '管理银行账户'],
  ['BILLS_VIEW', '查看票据'],
  ['BILLS_MANAGE', '管理票据'],
  ['DEPARTMENTS_VIEW', '查看部门'],
  ['DEPARTMENTS_MANAGE', '管理部门'],
  ['PROJECTS_VIEW', '查看项目核算'],
  ['PROJECTS_MANAGE', '管理项目核算'],
  ['PERIOD_CLOSE_VIEW', '查看月结年结'],
  ['PERIOD_CLOSE_MANAGE', '执行月结年结'],
  ['BANK_RECONCILE_VIEW', '查看银行对账'],
  ['BANK_RECONCILE_MANAGE', '管理银行对账'],
  ['CURRENCY_VIEW', '查看币种'],
  ['CURRENCY_MANAGE', '管理币种'],
  ['VOUCHER_WORDS_VIEW', '查看凭证字'],
  ['VOUCHER_WORDS_MANAGE', '管理凭证字'],
  ['VOUCHER_TEMPLATES_VIEW', '查看凭证模板'],
  ['VOUCHER_TEMPLATES_MANAGE', '管理凭证模板'],
  ['OA_VIEW', '查看办公审批'],
  ['OA_MANAGE', '管理办公审批'],
  ['ALERT_VIEW', '查看预警'],
  ['ALERT_MANAGE', '管理预警'],
  ['REPORT_VIEW', '查看报表'],
  ['MRP_VIEW', '查看MRP计划'],
  ['MRP_MANAGE', '管理MRP计划'],
  ['WORK_CENTERS_VIEW', '查看工作中心'],
  ['WORK_CENTERS_MANAGE', '管理工作中心'],
  ['ROUTING_VIEW', '查看工序'],
  ['ROUTING_MANAGE', '管理工序'],
  ['PRODUCTION_COSTS_VIEW', '查看生产成本'],
  ['PRODUCTION_COSTS_MANAGE', '管理生产成本'],
  ['IQC_VIEW', '查看来料检验'],
  ['IQC_MANAGE', '管理来料检验'],
  ['OQC_VIEW', '查看出货检验'],
  ['OQC_MANAGE', '管理出货检验'],
  ['SUPPLIER_EVAL_VIEW', '查看供应商评估'],
  ['SUPPLIER_EVAL_MANAGE', '管理供应商评估'],
  ['OA_LEAVE_VIEW', '查看请假'],
  ['OA_LEAVE_MANAGE', '管理请假'],
  ['OA_EXPENSE_VIEW', '查看报销'],
  ['OA_EXPENSE_MANAGE', '管理报销'],
  ['ALERT_RULES_VIEW', '查看预警规则'],
  ['ALERT_RULES_MANAGE', '管理预警规则'],
  ['COST_VIEW', '查看成本管理'],
  ['COST_MANAGE', '管理成本数据'],
  ['CRM_VIEW', '查看客户关系管理'],
  ['CRM_MANAGE', '管理客户关系数据'],
  ['PROJECT_VIEW', '查看项目管理'],
  ['PROJECT_MANAGE', '管理项目数据'],
  ['WORKFLOW_VIEW', '查看审批流'],
  ['WORKFLOW_MANAGE', '管理审批流'],

  ['FIXED_ASSETS_VIEW', '查看固定资产'],
  ['FIXED_ASSETS_MANAGE', '管理固定资产'],

  ['PRODUCTION_MATERIAL_ISSUE_MANAGE', '管理用料出库'],
  ['PRODUCTION_RECEIPT_MANAGE', '管理生产入库'],

  // M12 — Planning documents (Production Instruction, Purchase Instruction, Purchase Requisition)
  ['PRODUCTION_INSTRUCTION_VIEW', '查看生产指令'],
  ['PRODUCTION_INSTRUCTION_MANAGE', '管理生产指令'],
  ['PURCHASE_INSTRUCTION_VIEW', '查看采购指令'],
  ['PURCHASE_INSTRUCTION_MANAGE', '管理采购指令'],
  ['PURCHASE_REQUISITION_VIEW', '查看请购单'],
  ['PURCHASE_REQUISITION_MANAGE', '管理请购单'],
  ['PURCHASE_REQUISITION_APPROVE', '审核请购单'],

  // M13 — Inventory extensions (Inventory Scrap + Inventory Month-End)
  ['INVENTORY_SCRAP_VIEW', '查看库存报废单'],
  ['INVENTORY_SCRAP_MANAGE', '管理与确认库存报废'],
  ['INVENTORY_PERIOD_CLOSE_VIEW', '查看存货月结'],
  ['INVENTORY_PERIOD_CLOSE_MANAGE', '执行与反结存货月结'],

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
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  migrateSettlementSchema(db);
  migrateExtendedSchema(db);
  migrateProductRoutingSchema(db);
  migratePlanningSchema(db);
  migratePlanningDocumentsSchema(db);
  migrateInventoryExtensionsSchema(db);
  normalizeCostRates(db);
  seed(db);
  // Add missing columns to existing tables
  const addColumn = (sql) => { try { db.exec(sql); } catch (e) { } };
  addColumn('ALTER TABLE return_orders ADD COLUMN confirmed_by TEXT');
  addColumn('ALTER TABLE return_orders ADD COLUMN confirmed_at TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN product_id TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN system_quantity REAL');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN actual_quantity REAL');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN difference REAL');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN reason TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN reviewer_id TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN reviewed_at TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN remark TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN check_no TEXT');
  addColumn('ALTER TABLE inventory_checks ADD COLUMN checked_at TEXT');
  db.exec("UPDATE inventory_checks SET check_no='IC-LEGACY-' || substr(replace(id,'-',''),1,12) WHERE check_no IS NULL OR check_no=''; UPDATE inventory_checks SET status='SUBMITTED' WHERE status='PENDING'; CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_checks_check_no ON inventory_checks(check_no)");
    addColumn('ALTER TABLE production_orders ADD COLUMN bom_id TEXT');
  addColumn('ALTER TABLE products ADD COLUMN reorder_point REAL DEFAULT 0');
  addColumn('ALTER TABLE cash_journals ADD COLUMN bank_id TEXT');
  addColumn('ALTER TABLE products ADD COLUMN min_stock REAL DEFAULT 0');
  addColumn('ALTER TABLE products ADD COLUMN max_stock REAL DEFAULT 0');
  addColumn('ALTER TABLE products ADD COLUMN lead_time_days INTEGER DEFAULT 7');
  addColumn('ALTER TABLE users ADD COLUMN name TEXT');
  addColumn('ALTER TABLE accounting_vouchers ADD COLUMN voucher_word_id TEXT');
  addColumn('ALTER TABLE accounting_vouchers ADD COLUMN period TEXT');
  addColumn("ALTER TABLE accounting_vouchers ADD COLUMN status TEXT DEFAULT 'POSTED'");
  addColumn('ALTER TABLE accounting_vouchers ADD COLUMN attachment_count INTEGER DEFAULT 0');
  addColumn('ALTER TABLE accounting_vouchers ADD COLUMN approver_id TEXT');
  addColumn('ALTER TABLE accounting_vouchers ADD COLUMN approved_at TEXT');
  addColumn('ALTER TABLE accounting_vouchers ADD COLUMN updated_at TEXT');
  addColumn('ALTER TABLE accounting_entries ADD COLUMN department_id TEXT');
  addColumn('ALTER TABLE accounting_entries ADD COLUMN project_id TEXT');
  addColumn('ALTER TABLE accounting_entries ADD COLUMN customer_id TEXT');
  addColumn('ALTER TABLE accounting_entries ADD COLUMN supplier_id TEXT');
  addColumn("ALTER TABLE suppliers ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  addColumn("ALTER TABLE accounting_entries ADD COLUMN currency_code TEXT DEFAULT 'CNY'");
  addColumn('ALTER TABLE accounting_entries ADD COLUMN exchange_rate REAL DEFAULT 1');
  addColumn('ALTER TABLE accounting_entries ADD COLUMN amount_foreign REAL DEFAULT 0');
  addColumn('ALTER TABLE accounting_entries ADD COLUMN line_no INTEGER DEFAULT 1');
  db.exec("UPDATE accounting_vouchers SET period=substr(voucher_date,1,7) WHERE period IS NULL; UPDATE accounting_vouchers SET updated_at=created_at WHERE updated_at IS NULL");
  db.exec('UPDATE users SET name=display_name WHERE name IS NULL');

  // Migration: Fix production_orders CHECK constraint to include PENDING status
  const migrateProductionOrdersCheck = () => {
    try {
      const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='production_orders'").get()?.sql || '';
      if (currentSql.includes('PENDING')) return;
      db.exec(`
        CREATE TABLE IF NOT EXISTS production_orders_new (
          id TEXT PRIMARY KEY,
          order_no TEXT NOT NULL UNIQUE,
          product_id TEXT NOT NULL,
          quantity REAL NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('DRAFT','PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
          planned_start TEXT,
          planned_finish TEXT,
          actual_start TEXT,
          actual_finish TEXT,
          remark TEXT NOT NULL DEFAULT '',
          creator_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          bom_id TEXT
        );
      `);
      db.exec('INSERT INTO production_orders_new SELECT * FROM production_orders');
      db.exec('DROP TABLE production_orders');
      db.exec('ALTER TABLE production_orders_new RENAME TO production_orders');
      db.exec('CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_production_orders_product ON production_orders(product_id)');
    } catch (e) { console.error('Migration production_orders CHECK failed:', e.message); }
  };
  migrateProductionOrdersCheck();
  // Migration: Voucher workflow - add new columns and update CHECK constraint
  const migrateVoucherWorkflow = () => {
    try {
      // Add new columns if they do not exist
      try { db.exec("ALTER TABLE accounting_vouchers ADD COLUMN rejection_reason TEXT"); } catch (e) { }
      try { db.exec("ALTER TABLE accounting_vouchers ADD COLUMN submitted_at TEXT"); } catch (e) { }
      try { db.exec("ALTER TABLE accounting_vouchers ADD COLUMN submitted_by TEXT"); } catch (e) { }
      
      // Check if CHECK constraint needs updating
      const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_vouchers'").get()?.sql || '';
      if (!currentSql.includes("'ENTERED'")) {
        // Need to rebuild table with new CHECK constraint
        db.exec(`
          CREATE TABLE IF NOT EXISTS accounting_vouchers_new (
            id TEXT PRIMARY KEY,
            voucher_no TEXT NOT NULL UNIQUE,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            voucher_date TEXT NOT NULL,
            remark TEXT NOT NULL DEFAULT '',
            creator_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            voucher_word_id TEXT,
            period TEXT,
            status TEXT NOT NULL DEFAULT 'ENTERED' CHECK(status IN ('ENTERED','SUBMITTED','POSTED','REJECTED')),
            attachment_count INTEGER DEFAULT 0,
            approver_id TEXT,
            approved_at TEXT,
            updated_at TEXT,
            rejection_reason TEXT,
            submitted_at TEXT,
            submitted_by TEXT,
            FOREIGN KEY (creator_id) REFERENCES users(id)
          );
        `);
        // Copy data preserving existing status values
        db.exec("INSERT INTO accounting_vouchers_new (id, voucher_no, source_type, source_id, voucher_date, remark, creator_id, created_at, voucher_word_id, period, status, attachment_count, approver_id, approved_at, updated_at, rejection_reason, submitted_at, submitted_by) SELECT id, voucher_no, source_type, source_id, voucher_date, remark, creator_id, created_at, voucher_word_id, period, COALESCE(status, 'POSTED'), attachment_count, approver_id, approved_at, updated_at, rejection_reason, submitted_at, submitted_by FROM accounting_vouchers");
        db.exec('DROP TABLE accounting_vouchers');
        db.exec('ALTER TABLE accounting_vouchers_new RENAME TO accounting_vouchers');
        db.exec('CREATE INDEX IF NOT EXISTS idx_vouchers_status ON accounting_vouchers(status)');
      }
    } catch (e) { console.error('Migration voucher workflow failed:', e.message); }
  };
  migrateVoucherWorkflow();

  // Migration: inventory_transfers runtime requires remark / updated_at / reviewer_id
  // columns that pre-fix production schema does not declare. Production journals
  // repeatedly report "no such column: it.reviewer_id" on GET /api/inventory-transfers
  // (server/app.js:1336) and a latent CHECK-constraint mismatch (runtime writes
  // TRANSFERRED / CANCELLED but pre-fix CHECK only allows DRAFT / SUBMITTED / APPROVED).
  //
  // Add columns idempotently first so the legacy rows are readable when the
  // table-rebuild SELECT runs. Then rebuild the CHECK constraint and copy.
  const migrateInventoryTransfers = () => {
    try {
      // 1. Add missing columns. ALTER TABLE ADD COLUMN throws when the column
      //    already exists; the existing addColumn pattern swallows that.
      try { db.exec("ALTER TABLE inventory_transfers ADD COLUMN remark TEXT NOT NULL DEFAULT ''"); } catch (e) {}
      try { db.exec("ALTER TABLE inventory_transfers ADD COLUMN updated_at TEXT"); } catch (e) {}
      try { db.exec("ALTER TABLE inventory_transfers ADD COLUMN reviewer_id TEXT"); } catch (e) {}
      // 2. Backfill updated_at from created_at for legacy rows so the
      //    runtime contract has a non-NULL value to read back.
      try { db.exec("UPDATE inventory_transfers SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''"); } catch (e) {}

      // 3. Rebuild the CHECK constraint to include TRANSFERRED / CANCELLED
      //    (runtime writes these statuses on action=transfer / cancel).
      const currentSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_transfers'").get()?.sql || '';
      if (currentSql.includes("'TRANSFERRED'") && currentSql.includes("'CANCELLED'")) return;
      db.exec(`
        CREATE TABLE IF NOT EXISTS inventory_transfers_new (
          id TEXT PRIMARY KEY,
          transfer_no TEXT NOT NULL UNIQUE,
          from_warehouse_id TEXT NOT NULL,
          to_warehouse_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','TRANSFERRED','CANCELLED')),
          remark TEXT NOT NULL DEFAULT '',
          creator_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT '',
          reviewer_id TEXT,
          FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
          FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
          FOREIGN KEY (creator_id) REFERENCES users(id)
        );
      `);
      db.exec(`INSERT INTO inventory_transfers_new(id,transfer_no,from_warehouse_id,to_warehouse_id,status,remark,creator_id,created_at,updated_at,reviewer_id)
        SELECT id,transfer_no,from_warehouse_id,to_warehouse_id,status,COALESCE(remark,''),creator_id,COALESCE(created_at,''),COALESCE(updated_at,created_at,''),reviewer_id
        FROM inventory_transfers`);
      db.exec('DROP TABLE inventory_transfers');
      db.exec('ALTER TABLE inventory_transfers_new RENAME TO inventory_transfers');
      db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_transfers_status ON inventory_transfers(status)');
    } catch (e) {
      console.error('Migration inventory_transfers failed:', e.message);
    }
  };
  migrateInventoryTransfers();
  migrateWarehouseLogistics(db);
  migrateProductionDocuments(db);
  reconcileSettlementSubledgers(db);

  return db;
}

// Idempotent migration for purchase_receipts / sales_deliveries /
// return_orders / purchase_returns. The canonical CREATE TABLE in migrate()
// missed columns the runtime writes (confirmed_by, confirmed_at, updated_at,
// receipt_date / delivery_date) and used overly-narrow CHECK constraints
// that would reject the CONFIRMED / CANCELLED writes from change handlers.
// This mirrors the production_orders / accounting_vouchers /
// inventory_transfers reconciliation pattern.
function migrateWarehouseLogistics(db) {
  try {
    // ---- purchase_receipts ----
    try { db.exec("ALTER TABLE purchase_receipts ADD COLUMN confirmed_by TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_receipts ADD COLUMN confirmed_at TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_receipts ADD COLUMN updated_at TEXT"); } catch (e) {}
    try { db.exec("UPDATE purchase_receipts SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_receipts ADD COLUMN receipt_date TEXT NOT NULL DEFAULT ''"); } catch (e) {}
    {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_receipts'").get()?.sql || '';
      if (!sql.includes("'CONFIRMED'") || !sql.includes("'CANCELLED'")) {
        db.exec('DROP TABLE IF EXISTS purchase_receipts_new');
        db.exec(`
          CREATE TABLE IF NOT EXISTS purchase_receipts_new (
            id TEXT PRIMARY KEY,
            receipt_no TEXT NOT NULL UNIQUE,
            purchase_order_id TEXT,
            supplier_id TEXT NOT NULL,
            warehouse_id TEXT NOT NULL,
            handler_id TEXT NOT NULL,
            total_cents INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
            receipt_date TEXT NOT NULL DEFAULT '',
            remark TEXT NOT NULL DEFAULT '',
            creator_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT '',
            confirmed_at TEXT,
            confirmed_by TEXT,
            FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
            FOREIGN KEY (handler_id) REFERENCES users(id),
            FOREIGN KEY (creator_id) REFERENCES users(id)
          );
        `);
        db.exec(`INSERT INTO purchase_receipts_new(id,receipt_no,purchase_order_id,supplier_id,warehouse_id,handler_id,total_cents,status,receipt_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
          SELECT id,receipt_no,purchase_order_id,supplier_id,warehouse_id,COALESCE(handler_id,creator_id),COALESCE(total_cents,0),CASE WHEN status IN ('CONFIRMED','CANCELLED') THEN status ELSE 'DRAFT' END,COALESCE(receipt_date,''),COALESCE(remark,''),creator_id,COALESCE(created_at,''),COALESCE(updated_at,created_at,''),confirmed_at,confirmed_by
          FROM purchase_receipts`);
        db.exec('DROP TABLE purchase_receipts');
        db.exec('ALTER TABLE purchase_receipts_new RENAME TO purchase_receipts');
      }
    }

    // ---- sales_deliveries ----
    try { db.exec("ALTER TABLE sales_deliveries ADD COLUMN confirmed_by TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE sales_deliveries ADD COLUMN confirmed_at TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE sales_deliveries ADD COLUMN updated_at TEXT"); } catch (e) {}
    try { db.exec("UPDATE sales_deliveries SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''"); } catch (e) {}
    try { db.exec("ALTER TABLE sales_deliveries ADD COLUMN delivery_date TEXT NOT NULL DEFAULT ''"); } catch (e) {}
    {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sales_deliveries'").get()?.sql || '';
      if (!sql.includes("'CONFIRMED'") || !sql.includes("'CANCELLED'")) {
        db.exec('DROP TABLE IF EXISTS sales_deliveries_new');
        db.exec(`
          CREATE TABLE IF NOT EXISTS sales_deliveries_new (
            id TEXT PRIMARY KEY,
            delivery_no TEXT NOT NULL UNIQUE,
            sales_order_id TEXT,
            customer_id TEXT NOT NULL,
            warehouse_id TEXT NOT NULL,
            handler_id TEXT NOT NULL,
            total_cents INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
            delivery_date TEXT NOT NULL DEFAULT '',
            remark TEXT NOT NULL DEFAULT '',
            creator_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT '',
            confirmed_at TEXT,
            confirmed_by TEXT,
            FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
            FOREIGN KEY (handler_id) REFERENCES users(id),
            FOREIGN KEY (creator_id) REFERENCES users(id)
          );
        `);
        db.exec(`INSERT INTO sales_deliveries_new(id,delivery_no,sales_order_id,customer_id,warehouse_id,handler_id,total_cents,status,delivery_date,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by)
          SELECT id,delivery_no,sales_order_id,customer_id,warehouse_id,COALESCE(handler_id,creator_id),COALESCE(total_cents,0),CASE WHEN status IN ('CONFIRMED','CANCELLED') THEN status ELSE 'DRAFT' END,COALESCE(delivery_date,''),COALESCE(remark,''),creator_id,COALESCE(created_at,''),COALESCE(updated_at,created_at,''),confirmed_at,confirmed_by
          FROM sales_deliveries`);
        db.exec('DROP TABLE sales_deliveries');
        db.exec('ALTER TABLE sales_deliveries_new RENAME TO sales_deliveries');
      }
    }

    // ---- return_orders (sales + purchase returns share this table per
    //      polymorphic source_type). Schema has source_type / source_id
    //      but runtime writes delivery_id / receipt_id. Migrate runtime
    //      to use source_id (sales → delivery, purchase → receipt) via
    //      two appended source columns. ----
    try { db.exec("ALTER TABLE return_orders ADD COLUMN delivery_id TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE return_orders ADD COLUMN receipt_id TEXT"); } catch (e) {}
    try { db.exec("UPDATE return_orders SET delivery_id = source_id WHERE source_type='SALES'"); } catch (e) {}
    try { db.exec("UPDATE return_orders SET receipt_id = source_id WHERE source_type='PURCHASE'"); } catch (e) {}
    try { db.exec("ALTER TABLE return_orders ADD COLUMN confirmed_by TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE return_orders ADD COLUMN confirmed_at TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE return_orders ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"); } catch (e) {}
    try { db.exec("UPDATE return_orders SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''"); } catch (e) {}
    try { db.exec("ALTER TABLE return_orders ADD COLUMN return_date TEXT NOT NULL DEFAULT ''"); } catch (e) {}
    {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='return_orders'").get()?.sql || '';
      if (!sql.includes("'CONFIRMED'") || !sql.includes("'CANCELLED'")) {
        db.exec('DROP TABLE IF EXISTS return_orders_new');
        db.exec(`
          CREATE TABLE IF NOT EXISTS return_orders_new (
            id TEXT PRIMARY KEY,
            return_no TEXT NOT NULL UNIQUE,
            source_type TEXT NOT NULL CHECK(source_type IN ('PURCHASE','SALES')),
            source_id TEXT,
            customer_id TEXT,
            supplier_id TEXT,
            warehouse_id TEXT NOT NULL,
            total_cents INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
            return_date TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            remark TEXT NOT NULL DEFAULT '',
            creator_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT '',
            confirmed_at TEXT,
            confirmed_by TEXT,
            delivery_id TEXT,
            receipt_id TEXT,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
            FOREIGN KEY (creator_id) REFERENCES users(id)
          );
        `);
        db.exec(`INSERT INTO return_orders_new(id,return_no,source_type,source_id,customer_id,supplier_id,warehouse_id,total_cents,status,return_date,reason,remark,creator_id,created_at,updated_at,confirmed_at,confirmed_by,delivery_id,receipt_id)
          SELECT id,return_no,source_type,source_id,customer_id,supplier_id,warehouse_id,COALESCE(total_cents,0),CASE WHEN status IN ('CONFIRMED','CANCELLED') THEN status ELSE 'DRAFT' END,COALESCE(return_date,''),COALESCE(reason,''),COALESCE(remark,''),creator_id,COALESCE(created_at,''),COALESCE(updated_at,created_at,''),confirmed_at,confirmed_by,delivery_id,receipt_id
          FROM return_orders`);
        db.exec('DROP TABLE return_orders');
        db.exec('ALTER TABLE return_orders_new RENAME TO return_orders');
      }
    }

    // ---- purchase_returns ----
    // Schema already declares all required columns. CHECK constraint is
    // implicit because canonical CREATE has no CHECK — but verify the
    // runtime writes (CONFIRMED, CANCELLED) are still permitted.
    try { db.exec("ALTER TABLE purchase_returns ADD COLUMN updated_at TEXT"); } catch (e) {}
    try { db.exec("UPDATE purchase_returns SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_returns ADD COLUMN return_date TEXT"); } catch (e) {}

    // ---- inventory_transactions ----
    // Legacy schema used type/quantity/balance_after, while the warehouse
    // handlers and UI use direction/quantity_change plus source metadata.
    // Rebuild once and preserve every legacy row.
    {
      const columns = db.prepare("PRAGMA table_info(inventory_transactions)").all().map((column) => column.name);
      if (!columns.includes('quantity_change') || !columns.includes('direction') || !columns.includes('source_no') || !columns.includes('creator_id')) {
        db.exec('DROP TABLE IF EXISTS inventory_transactions_new');
        db.exec(`
          CREATE TABLE inventory_transactions_new (
            id TEXT PRIMARY KEY,
            warehouse_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            quantity_change REAL NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
            balance_after REAL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_no TEXT NOT NULL DEFAULT '',
            remark TEXT NOT NULL DEFAULT '',
            creator_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (creator_id) REFERENCES users(id)
          )
        `);
        db.exec(`INSERT INTO inventory_transactions_new(id,warehouse_id,product_id,quantity_change,direction,balance_after,source_type,source_id,source_no,remark,creator_id,created_at)
          SELECT id,warehouse_id,product_id,quantity,
            CASE WHEN type='OUT' OR quantity < 0 THEN 'OUT' ELSE 'IN' END,
            balance_after,source_type,source_id,'','',NULL,created_at
          FROM inventory_transactions`);
        db.exec('DROP TABLE inventory_transactions');
        db.exec('ALTER TABLE inventory_transactions_new RENAME TO inventory_transactions');
      }
    }
  } catch (e) {
    console.error('Migration warehouse logistics failed:', e.message);
    throw e;
  }
}

function migrate(db) {
  db.exec(`
    -- 产品标准成本
    CREATE TABLE IF NOT EXISTS product_costs (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      standard_cost_cents INTEGER NOT NULL DEFAULT 0,
      material_cost_cents INTEGER NOT NULL DEFAULT 0,
      labor_cost_cents INTEGER NOT NULL DEFAULT 0,
      overhead_cost_cents INTEGER NOT NULL DEFAULT 0,
      effective_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'HISTORICAL')),
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    
    -- 工单成本记录
    CREATE TABLE IF NOT EXISTS production_costs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      material_cost_cents INTEGER NOT NULL DEFAULT 0,
      labor_cost_cents INTEGER NOT NULL DEFAULT 0,
      overhead_cost_cents INTEGER NOT NULL DEFAULT 0,
      total_cost_cents INTEGER NOT NULL DEFAULT 0,
      unit_cost_cents INTEGER NOT NULL DEFAULT 0,
      calculated_at TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES production_orders(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );
    
    -- 成本费用项目
    CREATE TABLE IF NOT EXISTS cost_rates (
      id TEXT PRIMARY KEY,
      rate_type TEXT NOT NULL,
      rate_value REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '小时',
      effective_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );


    -- 固定资产
    CREATE TABLE IF NOT EXISTS fixed_assets (
      id TEXT PRIMARY KEY,
      asset_code TEXT NOT NULL UNIQUE,
      asset_name TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      spec TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '台',
      purchase_date TEXT,
      purchase_amount_cents INTEGER NOT NULL DEFAULT 0,
      service_years INTEGER NOT NULL DEFAULT 5,
      depreciation_method TEXT NOT NULL DEFAULT 'STRAIGHT_LINE' CHECK(depreciation_method IN ('STRAIGHT_LINE', 'DOUBLE_DECLINING')),
      residual_value_cents INTEGER NOT NULL DEFAULT 0,
      accumulated_depreciation_cents INTEGER NOT NULL DEFAULT 0,
      net_value_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'IN_USE' CHECK(status IN ('IN_USE', 'IDLE', 'DISPOSED', 'SCRAPPED')),
      location TEXT NOT NULL DEFAULT '',
      custodian TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    -- 固定资产折旧记录
    CREATE TABLE IF NOT EXISTS asset_depreciations (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      depreciation_date TEXT NOT NULL,
      depreciation_amount_cents INTEGER NOT NULL,
      accumulated_amount_cents INTEGER NOT NULL,
      net_value_cents INTEGER NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES fixed_assets(id)
    );

    -- 出纳日记账
    CREATE TABLE IF NOT EXISTS cash_journals (
      id TEXT PRIMARY KEY,
      journal_no TEXT NOT NULL,
      journal_type TEXT NOT NULL CHECK(journal_type IN ('RECEIPT', 'PAYMENT', 'TRANSFER')),
      account_type TEXT NOT NULL CHECK(account_type IN ('CASH', 'BANK')),
      bank_account TEXT,
      amount_cents INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('IN', 'OUT')),
      counterparty_type TEXT,
      counterparty_id TEXT,
      counterparty_name TEXT,
      subject_id TEXT,
      summary TEXT NOT NULL DEFAULT '',
      voucher_id TEXT,
      operator_id TEXT NOT NULL,
      journal_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    
    -- 银行账户
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      bank_name TEXT NOT NULL,
      account_no TEXT NOT NULL UNIQUE,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'CHECKING',
      balance_cents INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    
    -- 票据管理
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      bill_no TEXT NOT NULL,
      bill_type TEXT NOT NULL CHECK(bill_type IN ('DRAFT', 'ACCEPTANCE', 'LC')),
      direction TEXT NOT NULL CHECK(direction IN ('RECEIVABLE', 'PAYABLE')),
      face_amount_cents INTEGER NOT NULL,
      bank_id TEXT,
      drawer_name TEXT,
      drawer_bank TEXT,
      payee_name TEXT,
      holder TEXT,
      issue_date TEXT NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ENDORSED', 'DISCOUNTED', 'PAID', 'CANCELLED')),
      source_type TEXT,
      source_id TEXT,
      remark TEXT NOT NULL DEFAULT '',
      holder_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

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
      PRIMARY KEY (role_id, permission_code)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      contact TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
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
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
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
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_no TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
      requester_id TEXT NOT NULL,
      reviewer_id TEXT,
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      rejection_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (requester_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      UNIQUE(warehouse_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS inventory_checks (
      id TEXT PRIMARY KEY,
      check_no TEXT NOT NULL UNIQUE,
      warehouse_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPROVED')),
      checked_at TEXT,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_check_items (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      book_quantity REAL NOT NULL,
      check_quantity REAL NOT NULL,
      diff_quantity REAL NOT NULL,
      remark TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id TEXT PRIMARY KEY,
      transfer_no TEXT NOT NULL UNIQUE,
      from_warehouse_id TEXT NOT NULL,
      to_warehouse_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','SUBMITTED','APPROVED','TRANSFERRED','CANCELLED')),
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reviewer_id TEXT,
      FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_transfer_items (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_adjustments (
      id TEXT PRIMARY KEY,
      adjustment_no TEXT NOT NULL UNIQUE,
      warehouse_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      reason TEXT NOT NULL,
      adjustment_date TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      confirmed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (confirmed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_adjustment_items (
      id TEXT PRIMARY KEY,
      adjustment_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity_delta REAL NOT NULL CHECK(quantity_delta <> 0),
      before_quantity REAL,
      after_quantity REAL,
      line_no INTEGER NOT NULL,
      FOREIGN KEY (adjustment_id) REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_receipts (
      id TEXT PRIMARY KEY,
      receipt_no TEXT NOT NULL UNIQUE,
      purchase_order_id TEXT,
      supplier_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      handler_id TEXT NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      receipt_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      confirmed_by TEXT,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (handler_id) REFERENCES users(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales_deliveries (
      id TEXT PRIMARY KEY,
      delivery_no TEXT NOT NULL UNIQUE,
      sales_order_id TEXT,
      customer_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      handler_id TEXT NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      delivery_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      confirmed_by TEXT,
      FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (handler_id) REFERENCES users(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales_delivery_items (
      id TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS return_orders (
      id TEXT PRIMARY KEY,
      return_no TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL CHECK(source_type IN ('PURCHASE','SALES')),
      source_id TEXT,
      customer_id TEXT,
      supplier_id TEXT,
      warehouse_id TEXT NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      return_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      confirmed_by TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS return_order_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT NOT NULL UNIQUE,
      receipt_id TEXT,
      supplier_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      return_date TEXT,
      reason TEXT,
      remark TEXT,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmed_at TEXT,
      confirmed_by TEXT,
      FOREIGN KEY (receipt_id) REFERENCES purchase_receipts(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      line_no INTEGER NOT NULL
    );


    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity_change REAL NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
      balance_after REAL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_no TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );


    CREATE TABLE IF NOT EXISTS boms (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0',
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISCONTINUED')),
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id TEXT PRIMARY KEY,
      bom_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      scrap_rate REAL NOT NULL DEFAULT 0,
      line_no INTEGER NOT NULL,
      FOREIGN KEY (bom_id) REFERENCES boms(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS production_orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
      planned_start TEXT,
      planned_finish TEXT,
      actual_start TEXT,
      actual_finish TEXT,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      consumed_quantity REAL NOT NULL DEFAULT 0,
      line_no INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_outputs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      output_date TEXT NOT NULL,
      qualified_quantity REAL NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounting_subjects (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
      parent_id TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS accounting_vouchers (
      id TEXT PRIMARY KEY,
      voucher_no TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS accounting_entries (
      id TEXT PRIMARY KEY,
      voucher_id TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
      amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      summary TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (voucher_id) REFERENCES accounting_vouchers(id) ON DELETE CASCADE,
      FOREIGN KEY (subject_id) REFERENCES accounting_subjects(id)
    );

    CREATE TABLE IF NOT EXISTS account_receivables (
      id TEXT PRIMARY KEY,
      voucher_no TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      paid_cents INTEGER NOT NULL DEFAULT 0,
      write_off_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('PENDING','PARTIAL','COMPLETED','WRITTEN_OFF')),
      due_date TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS account_payables (
      id TEXT PRIMARY KEY,
      voucher_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      paid_cents INTEGER NOT NULL DEFAULT 0,
      write_off_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('PENDING','PARTIAL','COMPLETED','WRITTEN_OFF')),
      due_date TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_collections (
      id TEXT PRIMARY KEY,
      collection_no TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL,
      receivable_id TEXT,
      amount_cents INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      collection_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (receivable_id) REFERENCES account_receivables(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_disbursements (
      id TEXT PRIMARY KEY,
      disbursement_no TEXT NOT NULL UNIQUE,
      supplier_id TEXT NOT NULL,
      payable_id TEXT,
      amount_cents INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      disbursement_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (payable_id) REFERENCES account_payables(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

      -- 登录尝试记录表
      CREATE TABLE IF NOT EXISTS login_attempts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        ip_address TEXT NOT NULL DEFAULT '',
        success INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON login_attempts(username);
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      supplier_id TEXT,
      name TEXT NOT NULL,
      gender TEXT,
      position TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      mobile TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      wechat TEXT NOT NULL DEFAULT '',
      birthday TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS customer_followups (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      followup_type TEXT NOT NULL,
      followup_date TEXT NOT NULL,
      content TEXT NOT NULL,
      next_plan TEXT NOT NULL DEFAULT '',
      next_date TEXT NOT NULL DEFAULT '',
      handler_id TEXT,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (handler_id) REFERENCES users(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales_activities (
      id TEXT PRIMARY KEY,
      activity_no TEXT NOT NULL UNIQUE,
      activity_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      budget_cents INTEGER NOT NULL DEFAULT 0,
      actual_cost_cents INTEGER NOT NULL DEFAULT 0,
      participants TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PLANNING',
      result TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      project_no TEXT UNIQUE,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      project_type TEXT NOT NULL DEFAULT '',
      customer_id TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNING',
      budget_cents INTEGER NOT NULL DEFAULT 0,
      manager_id TEXT,
      manager TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (manager_id) REFERENCES users(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS project_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      task_no TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'MEDIUM',
      status TEXT NOT NULL DEFAULT 'PENDING',
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      assignee_id TEXT,
      estimated_hours REAL NOT NULL DEFAULT 0,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES project_tasks(id),
      FOREIGN KEY (assignee_id) REFERENCES users(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS project_timesheets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      user_id TEXT NOT NULL,
      work_date TEXT NOT NULL,
      hours REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      billable INTEGER NOT NULL DEFAULT 0,
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES project_tasks(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'INFO',
      source_type TEXT,
      source_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_vouchers_source ON accounting_vouchers(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_entries_voucher ON accounting_entries(voucher_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_receivables_customer ON account_receivables(customer_id);
    CREATE INDEX IF NOT EXISTS idx_payables_supplier ON account_payables(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
    CREATE INDEX IF NOT EXISTS idx_production_orders_product ON production_orders(product_id);
    CREATE INDEX IF NOT EXISTS idx_production_items_order ON production_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_production_outputs_order ON production_outputs(order_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_status ON inventory_adjustments(status);
    CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_items_document ON inventory_adjustment_items(adjustment_id);
  `);
}

function normalizeCostRates(db) {
  const columns = db.prepare('PRAGMA table_info(cost_rates)').all().map((column) => column.name);
  if (columns.includes('rate_type')) return;

  db.exec(`
    ALTER TABLE cost_rates RENAME TO cost_rates_legacy;
    CREATE TABLE cost_rates (
      id TEXT PRIMARY KEY,
      rate_type TEXT NOT NULL,
      rate_value REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '小时',
      effective_date TEXT NOT NULL,
      remark TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );
    INSERT INTO cost_rates(id, rate_type, rate_value, unit, effective_date, remark, creator_id, created_at, updated_at)
    SELECT id,
      CASE category WHEN 'MATERIAL' THEN 'MATERIAL_RATE' WHEN 'LABOR' THEN 'LABOR_RATE' WHEN 'OVERHEAD' THEN 'OVERHEAD_RATE' ELSE category END,
      rate_cents_per_hour / 100.0,
      unit,
      substr(created_at, 1, 10),
      remark,
      creator_id,
      created_at,
      updated_at
    FROM cost_rates_legacy;
    DROP TABLE cost_rates_legacy;
  `);
}

function seedSchema(db) {
  const now = new Date().toISOString();
  const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions(code, name) VALUES (?, ?)');
  for (const permission of PERMISSIONS) insertPermission.run(...permission);

  const roles = [
    ['role-admin', 'ADMIN', '系统管理员', '管理用户、角色和全部业务', 1],
    ['role-sales', 'SALES', '销售专员', '维护客户并创建、提交销售订单和采购订单', 1],
    ['role-reviewer', 'REVIEWER', '销售主管', '查看并审核销售订单、采购订单和库存', 1],
    ['role-warehouse', 'WAREHOUSE', '仓库管理员', '管理仓库和库存', 1],
    ['role-accounting', 'ACCOUNTING', '财务专员', '查看财务凭证和业务单据', 1],
  ];
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles(id, code, name, description, system_role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const role of roles) insertRole.run(...role, now);

  const all = PERMISSIONS.map(([code]) => code);
  const rolePermissions = {
    'role-admin': all,
    'role-accounting': ['DASHBOARD_VIEW', 'ACCOUNTING_VIEW', 'VOUCHER_SUBMIT', 'REPORT_VIEW', 'ORDERS_VIEW', 'PURCHASE_ORDERS_VIEW', 'CASH_JOURNALS_VIEW', 'CASH_JOURNALS_MANAGE', 'BANK_ACCOUNTS_VIEW', 'BANK_ACCOUNTS_MANAGE', 'BILLS_VIEW', 'BILLS_MANAGE', 'FIXED_ASSETS_VIEW', 'FIXED_ASSETS_MANAGE', 'AR_VIEW', 'COLLECTION_MANAGE', 'AP_VIEW', 'PAYMENT_MANAGE'],
    'role-sales': ['DASHBOARD_VIEW', 'SUPPLIERS_VIEW', 'SUPPLIERS_MANAGE', 'CUSTOMERS_VIEW', 'CUSTOMERS_MANAGE', 'PRODUCTS_VIEW', 'ORDERS_VIEW', 'ORDERS_CREATE', 'ORDERS_SUBMIT', 'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_CREATE', 'PURCHASE_ORDERS_SUBMIT', 'WAREHOUSES_VIEW', 'INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE', 'RETURNS_VIEW', 'RETURNS_MANAGE', 'CRM_VIEW', 'CRM_MANAGE'],
    'role-reviewer': ['DASHBOARD_VIEW', 'CUSTOMERS_VIEW', 'PRODUCTS_VIEW', 'ORDERS_VIEW', 'ORDERS_APPROVE', 'PURCHASE_ORDERS_VIEW', 'PURCHASE_ORDERS_APPROVE', 'WAREHOUSES_VIEW', 'INVENTORY_VIEW', 'PURCHASE_RECEIPTS_VIEW', 'SALES_DELIVERIES_VIEW', 'RETURNS_VIEW', 'PURCHASE_REQUISITION_VIEW', 'PURCHASE_REQUISITION_APPROVE'],
    'role-warehouse': ['DASHBOARD_VIEW', 'PRODUCTS_VIEW', 'WAREHOUSES_VIEW', 'WAREHOUSES_MANAGE', 'INVENTORY_VIEW', 'INVENTORY_CHECK_CREATE', 'INVENTORY_TRANSFER_CREATE', 'INVENTORY_TRANSFER_APPROVE', 'INVENTORY_ADJUSTMENT_MANAGE', 'INVENTORY_SCRAP_VIEW', 'INVENTORY_SCRAP_MANAGE', 'PURCHASE_RECEIPTS_VIEW', 'PURCHASE_RECEIPTS_MANAGE', 'SALES_DELIVERIES_VIEW', 'SALES_DELIVERIES_MANAGE', 'RETURNS_VIEW', 'RETURNS_MANAGE', 'IQC_VIEW', 'IQC_MANAGE', 'OQC_VIEW', 'OQC_MANAGE'],
  };
  const insertRolePermission = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_code) VALUES (?, ?)');
  for (const [roleId, permissions] of Object.entries(rolePermissions)) {
    for (const permission of permissions) insertRolePermission.run(roleId, permission);
  }

  const insertSubject = db.prepare('INSERT OR IGNORE INTO accounting_subjects(id, code, name, type, direction, active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const s of [
    ['subject-001', '1001', '库存现金', 'ASSET', 'DEBIT'],
    ['subject-002', '1002', '银行存款', 'ASSET', 'DEBIT'],
    ['subject-003', '1122', '应收账款', 'ASSET', 'DEBIT'],
    ['subject-004', '1405', '库存商品', 'ASSET', 'DEBIT'],
    ['subject-005', '2202', '应付账款', 'LIABILITY', 'CREDIT'],
    ['subject-006', '6001', '主营业务收入', 'REVENUE', 'CREDIT'],
    ['subject-007', '6401', '主营业务成本', 'EXPENSE', 'DEBIT'],
  ]) insertSubject.run(...s);
}

function seedDemoData(db) {
  const now = new Date().toISOString();

  const insertUser = db.prepare('INSERT OR IGNORE INTO users(id, username, display_name, password_hash, password_salt, role_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  for (const user of [
    ['user-admin', 'admin', '系统管理员', 'admin123', 'role-admin'],
    ['user-sales', 'sales', '销售专员', 'sales123', 'role-sales'],
    ['user-reviewer', 'reviewer', '销售主管', 'review123', 'role-reviewer'],
    ['user-warehouse', 'warehouse', '仓库管理员', 'warehouse123', 'role-warehouse'],
    ['user-accounting', 'accounting', '财务专员', 'accounting123', 'role-accounting'],
  ]) {
    const password = hashPassword(user[3]);
    insertUser.run(user[0], user[1], user[2], password.hash, password.salt, user[4], now);
  }

  const insertCustomer = db.prepare('INSERT OR IGNORE INTO customers(id, code, name, contact, phone, address, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
  for (const c of [
    ['customer-001', 'C001', '深圳创想科技有限公司', '李经理', '13800138001', '广东省深圳市南山区科技园', now, now],
    ['customer-002', 'C002', '广州智联电子有限公司', '王总', '13900139002', '广东省广州市天河区珠江新城', now, now],
    ['customer-003', 'C003', '东莞制造业公司', '张总', '13700137003', '广东省东莞市长安镇', now, now],
  ]) insertCustomer.run(...c);

  const insertSupplier = db.prepare('INSERT OR IGNORE INTO suppliers(id, code, name, contact, phone, address, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)');
  for (const s of [
    ['supplier-001', 'S001', '深圳华强电子市场', '刘经理', '13500135001', '广东省深圳市福田区华强北路', now, now],
    ['supplier-002', 'S002', '东莞原料供应商', '陈总', '13600136002', '广东省东莞市厚街镇', now, now],
    ['supplier-003', 'S003', '广州五金批发中心', '赵经理', '13400134003', '广东省广州市白云区石井镇', now, now],
  ]) insertSupplier.run(...s);

  const insertProduct = db.prepare('INSERT OR IGNORE INTO products(id, code, name, category, unit, price_cents, stock_quantity, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)');
  for (const p of [
    ['product-001', 'P001', '高端笔记本电脑', '电子产品', '台', 259900, 20, now, now],
    ['product-002', 'P002', '无线鼠标', '电子产品', '个', 32900, 100, now, now],
    ['product-003', 'P003', '机械键盘', '电子产品', '个', 89900, 30, now, now],
    ['product-004', 'P004', '27寸显示器', '电子产品', '台', 189900, 15, now, now],
    ['product-005', 'P005', 'USB-C扩展坞', '电子产品', '个', 45900, 80, now, now],
  ]) insertProduct.run(...p);

  const insertWarehouse = db.prepare('INSERT OR IGNORE INTO warehouses(id, code, name, address, manager, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)');
  insertWarehouse.run('warehouse-001', 'WH-001', '深圳总仓', '广东省深圳市南山区', '张经理', now, now);
  insertWarehouse.run('warehouse-002', 'WH-002', '东莞分仓', '广东省东莞市长安镇', '李主管', now, now);

  const insertInventory = db.prepare('INSERT OR IGNORE INTO inventory(warehouse_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?)');
  for (const wh of ['warehouse-001', 'warehouse-002']) {
    insertInventory.run(wh, 'product-001', wh === 'warehouse-001' ? 20 : 16, now);
    insertInventory.run(wh, 'product-002', wh === 'warehouse-001' ? 100 : 80, now);
    insertInventory.run(wh, 'product-003', wh === 'warehouse-001' ? 30 : 22, now);
  }

  db.prepare("INSERT OR IGNORE INTO sales_orders (id,order_no,customer_id,status,total_cents,remark,creator_id,submitted_at,created_at,updated_at) VALUES ('order-demo-001','SO-DEMO-001','customer-001','SUBMITTED',684300,'首张演示订单，等待销售主管审核','user-sales',?,?,?)").run(now, now, now);
  db.prepare("INSERT OR IGNORE INTO sales_order_items (id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES ('item-demo-001','order-demo-001','product-001',2,259900,519800,1)").run();
  db.prepare("INSERT OR IGNORE INTO sales_order_items (id,order_id,product_id,quantity,unit_price_cents,amount_cents,line_no) VALUES ('item-demo-002','order-demo-001','product-002',5,32900,164500,2)").run();
  db.prepare("INSERT OR IGNORE INTO audit_logs(id,user_id,action,entity_type,entity_id,detail,created_at) VALUES ('audit-demo-001','user-sales','CREATE','SALES_ORDER','order-demo-001','创建并提交演示订单 SO-DEMO-001',?)").run(now);
}

// demo seed gating: production 默认禁止;开发/测试保持默认行为
// - ERP_SEED_DEMO=true  → 强制种子(任意环境)
// - NODE_ENV=production → 不种子(除非 ERP_SEED_DEMO=true)
// - 其他(开发/测试) → 种子(保留现有测试 / 本地体验)
export function shouldSeedDemoData() {
  if (process.env.ERP_SEED_DEMO === 'true') return true;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

function seed(db) {
  seedSchema(db);
  if (shouldSeedDemoData()) seedDemoData(db);
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

// M6 Production Workflow — explicit material issue & production receipt
// documents. Idempotent: every ALTER/INDEX statement is wrapped in
// CREATE IF NOT EXISTS or try/catch. Re-running createDatabase() on a
// pre-M6 production DB only adds the new tables and leaves BOM,
// production_orders, inventory, inventory_transactions untouched.
//
// Header/items follow the audit-friendly shape used by the existing
// logistics modules. Canonical source types in inventory_transactions
// are PRODUCTION_MATERIAL_ISSUE (OUT) and PRODUCTION_RECEIPT (IN).
function migrateProductionDocuments(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS production_material_issues (
        id TEXT PRIMARY KEY,
        issue_no TEXT NOT NULL UNIQUE,
        production_order_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
        issue_date TEXT NOT NULL DEFAULT '',
        remark TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_by TEXT,
        confirmed_at TEXT,
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pmi_status ON production_material_issues(status);
      CREATE INDEX IF NOT EXISTS idx_pmi_order ON production_material_issues(production_order_id);

      CREATE TABLE IF NOT EXISTS production_material_issue_items (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        planned_quantity REAL NOT NULL DEFAULT 0,
        issue_quantity REAL NOT NULL,
        before_quantity REAL,
        after_quantity REAL,
        line_no INTEGER NOT NULL,
        FOREIGN KEY (issue_id) REFERENCES production_material_issues(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pmi_items_issue ON production_material_issue_items(issue_id);

      CREATE TABLE IF NOT EXISTS production_receipts (
        id TEXT PRIMARY KEY,
        receipt_no TEXT NOT NULL UNIQUE,
        production_order_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
        receipt_date TEXT NOT NULL DEFAULT '',
        remark TEXT NOT NULL DEFAULT '',
        creator_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_by TEXT,
        confirmed_at TEXT,
        before_quantity REAL,
        after_quantity REAL,
        FOREIGN KEY (production_order_id) REFERENCES production_orders(id),
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (confirmed_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_pr_status ON production_receipts(status);
      CREATE INDEX IF NOT EXISTS idx_pr_order ON production_receipts(production_order_id);
    `);
  } catch (e) {
    console.error('Migration production documents failed:', e.message);
  }
}

