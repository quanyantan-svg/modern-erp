// V17 Master & Engineering Domain Closure — Wave C:
// Substitute Scheme + Configurable BOM (Engineering side).
//
// New tables:
//     engineering_substitute_schemes
//     engineering_substitutes
//
// All migrations are idempotent. The boms / bom_items additive flags added
// by engineering-bom-schema.js already cover the configurable BOM
// capability; this migration only adds the substitute model.

function columnExists(db, table, column) {
  const pragma = db.prepare(`PRAGMA table_info(${table})`).all();
  return pragma.some((row) => row.name === column);
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function migrateEngineeringSubstituteSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS engineering_substitute_schemes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      strategy TEXT NOT NULL DEFAULT 'MIXED' CHECK(strategy IN ('MIXED','MANUAL','BATCH','BATCH_MIXED')),
      method TEXT NOT NULL DEFAULT 'REPLACE' CHECK(method IN ('REPLACE','SUPERSEDE','PROPORTION')),
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS engineering_substitutes (
      id TEXT PRIMARY KEY,
      scheme_id TEXT NOT NULL,
      primary_product_id TEXT NOT NULL,
      substitute_product_id TEXT NOT NULL,
      priority INTEGER NOT NULL CHECK(priority > 0),
      ratio REAL NOT NULL DEFAULT 1 CHECK(ratio > 0),
      effective_from TEXT,
      effective_to TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (scheme_id) REFERENCES engineering_substitute_schemes(id) ON DELETE CASCADE,
      FOREIGN KEY (primary_product_id) REFERENCES products(id),
      FOREIGN KEY (substitute_product_id) REFERENCES products(id),
      UNIQUE (scheme_id, priority)
    );

    CREATE INDEX IF NOT EXISTS idx_engineering_substitutes_primary
      ON engineering_substitutes(primary_product_id, active);
    CREATE INDEX IF NOT EXISTS idx_engineering_substitutes_scheme
      ON engineering_substitutes(scheme_id, active);
  `);
}