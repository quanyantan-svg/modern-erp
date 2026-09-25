// M11 — Forecast & MRP canonical planning schema.
//
// All new tables are append-only and idempotent. Pre-M11 mrp_plans /
// mrp_plan_items remain untouched as legacy compatibility for the
// existing /api/mrp-plans endpoints. M11 introduces a clean, immutable
// planning snapshot under /api/planning/* without mutating the legacy
// tables, routes, or calculators. Forecaster is planning master data;
// MRP is a planning engine that produces suggestions only — neither
// touches inventory, accounting, approval center, production orders,
// or purchase orders.

import { randomBytes } from 'node:crypto';

const newId = () => `id-${randomBytes(8).toString('hex')}`;

function nowIso() {
  return new Date().toISOString();
}

export function migratePlanningSchema(db) {
  // ---------- planning_forecasts ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_forecasts (
      id TEXT PRIMARY KEY,
      forecast_code TEXT NOT NULL UNIQUE,
      forecast_name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','ACTIVE','CANCELLED')),
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_forecast_items (
      id TEXT PRIMARY KEY,
      forecast_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      need_date TEXT NOT NULL,
      quantity REAL NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (forecast_id) REFERENCES planning_forecasts(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Deterministic dedup: a forecast can have at most one row per
  // (product, need_date). Backend rejects duplicates on insert so this
  // index is only a safety net.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_forecast_items_dedup
      ON planning_forecast_items(forecast_id, product_id, need_date);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_planning_forecasts_status
      ON planning_forecasts(status);
  `);

  // ---------- mrp_runs ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS mrp_runs (
      id TEXT PRIMARY KEY,
      run_code TEXT NOT NULL UNIQUE,
      run_name TEXT NOT NULL,
      horizon_start TEXT NOT NULL,
      horizon_end TEXT NOT NULL,
      demand_source_mode TEXT NOT NULL
        CHECK(demand_source_mode IN ('SALES_ORDERS','FORECAST','SALES_PLUS_FORECAST')),
      forecast_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK(status IN ('DRAFT','COMPLETED','CANCELLED')),
      summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      FOREIGN KEY (forecast_id) REFERENCES planning_forecasts(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mrp_run_demands (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      need_date TEXT NOT NULL,
      source_type TEXT NOT NULL
        CHECK(source_type IN ('SALES_ORDER','FORECAST')),
      source_id TEXT,
      source_label TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL,
      FOREIGN KEY (run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mrp_run_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      gross_sales_demand REAL NOT NULL DEFAULT 0,
      gross_forecast_demand REAL NOT NULL DEFAULT 0,
      gross_component_demand REAL NOT NULL DEFAULT 0,
      gross_requirement REAL NOT NULL DEFAULT 0,
      on_hand REAL NOT NULL DEFAULT 0,
      open_purchase_supply REAL NOT NULL DEFAULT 0,
      open_production_supply REAL NOT NULL DEFAULT 0,
      net_requirement REAL NOT NULL DEFAULT 0,
      suggestion_type TEXT NOT NULL DEFAULT ''
        CHECK(suggestion_type IN ('','MAKE','BUY')),
      suggested_quantity REAL NOT NULL DEFAULT 0,
      need_by_date TEXT,
      bom_level INTEGER NOT NULL DEFAULT 0,
      warning TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // One result row per (run, product). A product may participate in a
  // run as both an end-item demand and as a component demand (when
  // exploded); the engine upserts with the largest gross contribution
  // and records the BOM path via the pegging table.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mrp_run_results_dedup
      ON mrp_run_results(run_id, product_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mrp_run_demands_run
      ON mrp_run_demands(run_id);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mrp_runs_status
      ON mrp_runs(status);
  `);

  // ---------- traceability ----------
  db.exec(`
    CREATE TABLE IF NOT EXISTS mrp_run_components (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      parent_product_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      gross_required REAL NOT NULL,
      bom_path TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mrp_run_components_run
      ON mrp_run_components(run_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mrp_run_pegging (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      result_product_id TEXT NOT NULL,
      source_type TEXT NOT NULL
        CHECK(source_type IN ('SALES_ORDER','FORECAST','BOM_EXPLOSION')),
      source_id TEXT,
      source_label TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL,
      quantity_contribution REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (run_id) REFERENCES mrp_runs(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mrp_run_pegging_run
      ON mrp_run_pegging(run_id);
  `);
}

// Exposed for tests and the planning module.
export function makePlanningId() {
  return newId();
}

export { nowIso };
