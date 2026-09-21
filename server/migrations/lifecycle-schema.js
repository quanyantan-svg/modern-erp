// V1.2 Lifecycle 2.0 metadata.
//
// Lifecycle state is intentionally centralized instead of adding an
// `archived` column to every business table. Cleanup events do not carry
// foreign keys to business records: their purpose is to survive after an
// erroneous business subgraph has been physically removed.
export function migrateLifecycleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lifecycle_archives (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      document_no TEXT NOT NULL DEFAULT '',
      archived_by TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      restored_by TEXT,
      restored_at TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      PRIMARY KEY(entity_type, entity_id),
      FOREIGN KEY (archived_by) REFERENCES users(id),
      FOREIGN KEY (restored_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_lifecycle_archives_active
      ON lifecycle_archives(entity_type, active, archived_at);

    CREATE TABLE IF NOT EXISTS cleanup_events (
      id TEXT PRIMARY KEY,
      root_entity_type TEXT NOT NULL,
      root_entity_id TEXT NOT NULL,
      root_document_no TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      classification TEXT NOT NULL,
      affected_entity_types TEXT NOT NULL,
      affected_entity_ids TEXT NOT NULL,
      affected_document_numbers TEXT NOT NULL,
      inventory_effects TEXT NOT NULL,
      finance_effects TEXT NOT NULL,
      voucher_effects TEXT NOT NULL,
      periods TEXT NOT NULL,
      success_state TEXT NOT NULL CHECK(success_state IN ('SUCCEEDED','FAILED')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cleanup_events_root
      ON cleanup_events(root_entity_type, root_entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_cleanup_events_actor
      ON cleanup_events(actor_id, created_at);

    CREATE TABLE IF NOT EXISTS cleanup_event_items (
      id TEXT PRIMARY KEY,
      cleanup_event_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      document_no TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      effective INTEGER NOT NULL DEFAULT 0 CHECK(effective IN (0,1)),
      inventory_effect TEXT NOT NULL DEFAULT '{}',
      finance_effect TEXT NOT NULL DEFAULT '{}',
      period TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (cleanup_event_id) REFERENCES cleanup_events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cleanup_event_items_event
      ON cleanup_event_items(cleanup_event_id);
    CREATE INDEX IF NOT EXISTS idx_cleanup_event_items_entity
      ON cleanup_event_items(entity_type, entity_id);
  `);
}
