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
  const rows = db.prepare(`
    SELECT rowid AS rid, warehouse_id, product_id, bin_id, owner_type, owner_id, stock_status, lot_id, serial_id
      FROM inventory
     WHERE position_key IS NULL OR position_key = ''
  `).all();
  if (rows.length) {
    const upd = db.prepare('UPDATE inventory SET position_key=? WHERE rowid=?');
    for (const r of rows) {
      const pk = computePositionKey({
        productId: r.product_id,
        warehouseId: r.warehouse_id,
        binId: r.bin_id,
        ownerType: r.owner_type,
        ownerId: r.owner_id,
        stockStatus: r.stock_status,
        lotId: r.lot_id,
        serialId: r.serial_id,
      });
      upd.run(pk, r.rid);
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
    db.exec(`INSERT INTO inventory_new(id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active) SELECT id,warehouse_id,product_id,quantity,updated_at,position_key,bin_id,owner_type,owner_id,stock_status,lot_id,serial_id,active FROM inventory`);
    db.exec('DROP TABLE inventory');
    db.exec('ALTER TABLE inventory_new RENAME TO inventory');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_position_key ON inventory(position_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_product_wh_status ON inventory(product_id, warehouse_id, stock_status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory(owner_type, owner_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_lot ON inventory(lot_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_serial ON inventory(serial_id)');
    db.exec('PRAGMA foreign_keys=ON');
  }

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