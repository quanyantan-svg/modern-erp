// R-02 — stable cross-domain coordination anchors.
// These rows are lock targets only. Domain period tables remain authoritative.

export function migratePeriodControlSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS period_guard_anchors (
      axis TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(axis, scope_key)
    );
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO period_guard_anchors(axis,scope_key,version,updated_at)
    VALUES('INVENTORY','GLOBAL',0,?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO period_guard_anchors(axis,scope_key,version,updated_at)
    VALUES('LEGAL_ACCOUNTING','GLOBAL',0,?)`).run(now);
}
