// Inventory & Warehouse Domain — Wave A migration.
//
// Frozen by `solution.md §27.4 / §27.5 / §27.9 / §27.10 / §27.11 / §27.15`.
//
// Additive only. Idempotent. SQLite + MySQL parity.
//
// Tables (NEW):
//   inventory_parameters            (singleton, DEFAULT row)
//   inventory_stock_statuses        (canonical stock-status master)
//   warehouse_bins                  (per-warehouse bin / location)
//   inventory_locks                 (canonical lock truth — NOT inventory.is_locked)
//   inventory_mutation_log           (canonical idempotency evidence)
//   inventory_step_transfer_in_transit (derived step-transfer execution facts)
//
// Additive columns:
//   warehouses: bin_enabled / is_supplier_wip / negative_stock_policy
//               / mrp_participation / inventory_lock_enabled
//   inventory:  position_key / bin_id / owner_type / owner_id
//               / stock_status / lot_id / serial_id / active
//
// Indexes:
//   UNIQUE(position_key)            on inventory (portable)
//   INDEX(position_key) / (product_id, warehouse_id, stock_status) / (owner_type, owner_id)
//   UNIQUE(warehouse_id, code)      on warehouse_bins

import { computePositionKey } from '../lib/inventory-position.js';

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function columnExists(db, table, column) {
  if (!tableExists(db, table)) return false;
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => String(r.name).toLowerCase() === column.toLowerCase());
}

function safeAddColumn(db, table, column, ddl) {
  if (columnExists(db, table, column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  return true;
}

function safeCreateIndex(db, sql) {
  try { db.exec(sql); } catch (_) { /* idempotent */ }
}

function seedStockStatuses(db) {
  const seeds = [
    ['AVAILABLE',    1, 1, 1, 1],
    ['INSPECTION',   0, 0, 0, 0],
    ['QUARANTINE',   0, 0, 0, 0],
    ['HOLD',         0, 0, 0, 1],
    ['BLOCKED',      0, 0, 0, 0],
  ];
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO inventory_stock_statuses(code, name, reservable, issuable, shippable, transferable, active, created_at)
    VALUES(?, ?, ?, ?, ?, ?, 1, ?)
  `);
  for (const [code, reservable, issuable, shippable, transferable] of seeds) {
    insert.run(code, code, reservable, issuable, shippable, transferable, now);
  }
}

export function migrateInventoryPositionSchema(db) {
  // ---- inventory_parameters (singleton DEFAULT row) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_parameters (
      id TEXT PRIMARY KEY,
      negative_stock_policy   TEXT NOT NULL DEFAULT 'BLOCK' CHECK(negative_stock_policy IN ('BLOCK','ALLOW','WARNING')),
      lot_default_status      TEXT NOT NULL DEFAULT 'AVAILABLE',
      serial_default_status   TEXT NOT NULL DEFAULT 'AVAILABLE',
      stocktake_window_days   INTEGER NOT NULL DEFAULT 30,
      enabled_at              TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      CHECK(id='DEFAULT')
    );
  `);
  db.prepare(`INSERT OR IGNORE INTO inventory_parameters(id, updated_at) VALUES('DEFAULT', ?)`).run(new Date().toISOString());

  // ---- inventory_stock_statuses ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_stock_statuses (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      reservable     INTEGER NOT NULL DEFAULT 0,
      issuable       INTEGER NOT NULL DEFAULT 0,
      shippable      INTEGER NOT NULL DEFAULT 0,
      transferable   INTEGER NOT NULL DEFAULT 0,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL
    );
  `);
  seedStockStatuses(db);

  // ---- warehouse_bins ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouse_bins (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(warehouse_id, code)
    );
  `);
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_warehouse_bins_warehouse ON warehouse_bins(warehouse_id, active)');

  // ---- inventory_locks (canonical lock truth) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_locks (
      id TEXT PRIMARY KEY,
      product_id   TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      position_key TEXT,
      quantity     REAL NOT NULL CHECK(quantity > 0),
      reason       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED')),
      locked_by    TEXT NOT NULL REFERENCES users(id),
      locked_at    TEXT NOT NULL,
      released_by  TEXT REFERENCES users(id),
      released_at  TEXT,
      source_type  TEXT NOT NULL,
      source_id    TEXT NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );
  `);
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_locks_position ON inventory_locks(position_key, status)');
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_locks_product_wh ON inventory_locks(product_id, warehouse_id, status)');

  // ---- inventory_mutation_log (canonical idempotency evidence) ----
  // This table must exist before a physical mutation starts. Creating it from
  // inside applyInventoryMutation would implicitly commit an active MySQL
  // transaction and break atomicity on the first write.
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_mutation_log (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      movement_group_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      movement_kind TEXT NOT NULL,
      quantity REAL NOT NULL,
      business_date TEXT NOT NULL,
      actor_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_mutation_log_source ON inventory_mutation_log(source_type, source_id)');

  // ---- inventory_step_transfer_in_transit (derived execution facts) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_step_transfer_in_transit (
      id TEXT PRIMARY KEY,
      source_transfer_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      warehouse_id_source TEXT NOT NULL,
      warehouse_id_destination TEXT NOT NULL,
      issued_qty REAL NOT NULL,
      received_qty REAL NOT NULL DEFAULT 0,
      returned_qty REAL NOT NULL DEFAULT 0,
      cancelled_qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'IN_TRANSIT' CHECK(status IN ('IN_TRANSIT','CLOSED','CANCELLED')),
      created_at TEXT NOT NULL,
      closed_at TEXT,
      FOREIGN KEY (source_transfer_id) REFERENCES inventory_transfers(id),
      FOREIGN KEY (warehouse_id_source) REFERENCES warehouses(id),
      FOREIGN KEY (warehouse_id_destination) REFERENCES warehouses(id)
    );
  `);
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_step_transfer_source ON inventory_step_transfer_in_transit(source_transfer_id, product_id)');

  // ---- warehouses additive columns ----
  safeAddColumn(db, 'warehouses', 'bin_enabled',           'bin_enabled INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'warehouses', 'is_supplier_wip',       'is_supplier_wip INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'warehouses', 'negative_stock_policy', "negative_stock_policy TEXT NOT NULL DEFAULT 'BLOCK'");
  safeAddColumn(db, 'warehouses', 'mrp_participation',     'mrp_participation INTEGER NOT NULL DEFAULT 1');
  safeAddColumn(db, 'warehouses', 'inventory_lock_enabled', 'inventory_lock_enabled INTEGER NOT NULL DEFAULT 1');

  // ---- inventory additive columns ----
  safeAddColumn(db, 'inventory', 'position_key', 'position_key TEXT');
  safeAddColumn(db, 'inventory', 'bin_id',       'bin_id TEXT');
  safeAddColumn(db, 'inventory', 'owner_type',   `owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE'`);
  safeAddColumn(db, 'inventory', 'owner_id',     'owner_id TEXT');
  safeAddColumn(db, 'inventory', 'stock_status', `stock_status TEXT NOT NULL DEFAULT 'AVAILABLE'`);
  safeAddColumn(db, 'inventory', 'lot_id',       'lot_id TEXT');
  safeAddColumn(db, 'inventory', 'serial_id',    'serial_id TEXT');
  safeAddColumn(db, 'inventory', 'active',       'active INTEGER NOT NULL DEFAULT 1');

  // ---- backfill position_key for legacy rows ----
  // Backfill by rowid to handle legacy rows that may have NULL id (legacy
  // seed inserts that did not provide id). rowid is always present.
  // Use INSERT OR IGNORE so collisions on the UNIQUE constraint are silently
  // skipped — legacy rows that already happened to share a (warehouse, product)
  // tuple (before the legacy UNIQUE was dropped) get a deterministic suffix
  // derived from rowid to preserve uniqueness.
  const rows = db.prepare(`
    SELECT rowid AS rid, warehouse_id, product_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id
      FROM inventory
     WHERE position_key IS NULL OR position_key = ''
     ORDER BY rowid
  `).all();
  if (rows.length) {
    const seen = new Map();
    const upd = db.prepare('UPDATE inventory SET position_key=? WHERE rowid=?');
    for (const r of rows) {
      let pk = computePositionKey({
        productId: r.product_id,
        warehouseId: r.warehouse_id,
        binId: r.bin_id,
        ownerType: r.owner_type,
        ownerId: r.owner_id,
        stockStatus: r.stock_status,
        lotId: r.lot_id,
        serialId: r.serial_id,
      });
      // If we already saw this position_key for another rowid in this batch,
      // append a rowid-based suffix to keep uniqueness. This handles legacy
      // data that was inserted before the legacy UNIQUE(warehouse_id, product_id)
      // was dropped.
      const count = (seen.get(pk) || 0) + 1;
      seen.set(pk, count);
      if (count > 1) pk = `${pk}:rid${r.rid}`;
      try { upd.run(pk, r.rid); } catch (e) {
        // Tolerate duplicate position_key for legacy rows sharing canonical dimensions.
        upd.run(`${pk}:fallback${r.rid}`, r.rid);
      }
    }
  }

  // ---- index position_key (portable; MySQL equivalent uses CHAR(64) — see mysql-schema.js) ----
  safeCreateIndex(db, 'CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_position_key ON inventory(position_key)');
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_product_wh_status ON inventory(product_id, warehouse_id, stock_status)');
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory(owner_type, owner_id)');
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_lot ON inventory(lot_id)');
  safeCreateIndex(db, 'CREATE INDEX IF NOT EXISTS idx_inventory_serial ON inventory(serial_id)');

  // ---- drop legacy UNIQUE(warehouse_id, product_id) — incompatible with multidimensional position ----
  // SQLite has no DROP CONSTRAINT; rebuild inventory table without the legacy constraint.
  // Detection covers both auto-index (sqlite_autoindex_inventory_*) and explicit CREATE UNIQUE INDEX.
  const idxRows = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='inventory'`).all();
  const legacyConstraint = idxRows.some((r) => {
    const sql = (r.sql || '').toLowerCase();
    const name = (r.name || '').toLowerCase();
    return (sql.includes('unique(warehouse_id, product_id)') || sql.includes('unique("warehouse_id", "product_id")'))
        || (name.startsWith('sqlite_autoindex_inventory_') && sql === '' && idxRows.filter((x) => x.name.startsWith('sqlite_autoindex_inventory_')).length > 1);
  });
  if (legacyConstraint) {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`
      CREATE TABLE inventory_new (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        position_key TEXT,
        bin_id TEXT,
        owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE',
        owner_id TEXT,
        stock_status TEXT NOT NULL DEFAULT 'AVAILABLE',
        lot_id TEXT,
        serial_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    db.exec(`INSERT OR IGNORE INTO inventory_new(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active) SELECT id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active FROM inventory`);
    db.exec('DROP TABLE inventory');
    db.exec('ALTER TABLE inventory_new RENAME TO inventory');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_position_key ON inventory(position_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_product_wh_status ON inventory(product_id, warehouse_id, stock_status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory(owner_type, owner_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_lot ON inventory(lot_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_serial ON inventory(serial_id)');
    db.exec('PRAGMA foreign_keys=ON');
  }

  // ---- Wave C tables: initialization, opening, native documents, stocktake, lot adjustment, form conversion ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_initialization (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('NOT_STARTED','OPEN','CLOSED')),
      enabled_at TEXT,
      opened_by TEXT,
      opened_at TEXT,
      closed_by TEXT,
      closed_at TEXT,
      reopen_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (opened_by) REFERENCES users(id),
      FOREIGN KEY (closed_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS opening_inventory_documents (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      initialization_id TEXT NOT NULL REFERENCES inventory_initialization(id),
      business_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      creator_id TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      notes TEXT NOT NULL DEFAULT ''
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS opening_inventory_items (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES opening_inventory_documents(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      bin_id TEXT,
      owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE',
      owner_id TEXT,
      stock_status TEXT NOT NULL DEFAULT 'AVAILABLE',
      lot_id TEXT,
      serial_id TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      position_key TEXT NOT NULL,
      UNIQUE(document_id, product_id, position_key)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_native_documents (
      id TEXT PRIMARY KEY,
      doc_no TEXT NOT NULL UNIQUE,
      doc_kind TEXT NOT NULL CHECK(doc_kind IN ('OTHER_RECEIPT','OTHER_ISSUE')),
      business_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','CANCELLED')),
      reason TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL REFERENCES users(id),
      confirmed_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      notes TEXT NOT NULL DEFAULT ''
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_native_items (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES inventory_native_documents(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
      bin_id TEXT,
      owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE',
      owner_id TEXT,
      stock_status TEXT NOT NULL DEFAULT 'AVAILABLE',
      lot_id TEXT,
      serial_id TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      line_no INTEGER NOT NULL,
      UNIQUE(document_id, line_no)
    );
  `);

  // ---- Extend inventory_checks with stocktake scope ----
  safeAddColumn(db, 'inventory_checks', 'check_kind', `check_kind TEXT NOT NULL DEFAULT 'REGULAR' CHECK(check_kind IN ('REGULAR','CYCLE'))`);
  safeAddColumn(db, 'inventory_checks', 'scope_strategy', `scope_strategy TEXT NOT NULL DEFAULT 'ALL'`);
  safeAddColumn(db, 'inventory_checks', 'abc_classification', `abc_classification TEXT`);
  safeAddColumn(db, 'inventory_checks', 'cycle_period_key', `cycle_period_key TEXT`);
  safeAddColumn(db, 'inventory_checks', 'snapshot_at', `snapshot_at TEXT`);

  safeAddColumn(db, 'inventory_check_items', 'position_key', `position_key TEXT`);
  safeAddColumn(db, 'inventory_check_items', 'bin_id', `bin_id TEXT`);
  safeAddColumn(db, 'inventory_check_items', 'owner_type', `owner_type TEXT NOT NULL DEFAULT 'ENTERPRISE'`);
  safeAddColumn(db, 'inventory_check_items', 'owner_id', `owner_id TEXT`);
  safeAddColumn(db, 'inventory_check_items', 'stock_status', `stock_status TEXT NOT NULL DEFAULT 'AVAILABLE'`);
  safeAddColumn(db, 'inventory_check_items', 'lot_id', `lot_id TEXT`);
  safeAddColumn(db, 'inventory_check_items', 'serial_id', `serial_id TEXT`);
  safeAddColumn(db, 'inventory_check_items', 'snapshot_book_quantity', `snapshot_book_quantity REAL NOT NULL DEFAULT 0`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_abc_classifications (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id),
      abc_class TEXT NOT NULL CHECK(abc_class IN ('A','B','C')),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      basis TEXT NOT NULL DEFAULT 'VALUE',
      finance_valuation_snapshot_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE(product_id, effective_from)
    );
  `);


  // ---- §27.5 fail-closed reconciliation for LOT/SERIAL tracking products ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_reconciliation_results (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('LOT','SERIAL')),
      product_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      expected_quantity REAL NOT NULL,
      derived_quantity  REAL NOT NULL,
      difference        REAL NOT NULL,
      detected_at       TEXT NOT NULL,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );
  `);

  const trackedProducts = db.prepare(`SELECT id, tracking_policy FROM products WHERE tracking_policy IN ('LOT','SERIAL')`).all();
  const insertMismatch = db.prepare(`
    INSERT INTO inventory_reconciliation_results
      (id, kind, product_id, warehouse_id, expected_quantity, derived_quantity, difference, detected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const product of trackedProducts) {
    const invRows = db.prepare('SELECT warehouse_id, SUM(quantity) q FROM inventory WHERE product_id=? AND active=1 GROUP BY warehouse_id').all(product.id);
    for (const inv of invRows) {
      let derived = 0;
      if (product.tracking_policy === 'LOT') {
        derived = Number(db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory_lot_balances WHERE product_id=? AND warehouse_id=?').get(product.id, inv.warehouse_id)?.q || 0);
      } else {
        derived = Number(db.prepare(`SELECT COUNT(*) c FROM inventory_serials WHERE product_id=? AND current_warehouse_id=? AND lifecycle_state IN ('AVAILABLE','HOLD','CONSUMED','DELIVERED')`).get(product.id, inv.warehouse_id)?.c || 0);
      }
      const expected = Number(inv.q);
      const diff = derived - expected;
      if (Math.abs(diff) > 1e-6) {
        insertMismatch.run(genRandomId(), product.tracking_policy, product.id, inv.warehouse_id, expected, derived, diff, new Date().toISOString());
      }
    }
  }
}

function genRandomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
