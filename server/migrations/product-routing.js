function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export function migrateProductRoutingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_routings (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      routing_code TEXT NOT NULL UNIQUE,
      routing_name TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'INACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS product_routing_operations (
      id TEXT PRIMARY KEY,
      routing_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL CHECK(sequence_no > 0),
      operation_code TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      work_center TEXT NOT NULL DEFAULT '',
      setup_minutes REAL NOT NULL DEFAULT 0 CHECK(setup_minutes >= 0),
      run_minutes_per_unit REAL NOT NULL DEFAULT 0 CHECK(run_minutes_per_unit >= 0),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(routing_id, sequence_no),
      FOREIGN KEY (routing_id) REFERENCES product_routings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_product_routings_product ON product_routings(product_id);
    CREATE INDEX IF NOT EXISTS idx_product_routing_operations_routing ON product_routing_operations(routing_id, sequence_no);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_routings_one_active
      ON product_routings(product_id) WHERE status='ACTIVE';
  `);

  // M10 bridge: preserve the pre-v1.1 BOM-bound API-only operations as
  // inactive historical product routings. The old tables stay in place for
  // labor-record foreign keys and compatibility APIs; INSERT OR IGNORE makes
  // reopening an existing database idempotent.
  if (!tableExists(db, 'routing_operations') || !tableExists(db, 'boms')) return;
  const legacyGroups = db.prepare(`
    SELECT DISTINCT r.bom_id, b.product_id, b.version
    FROM routing_operations r
    JOIN boms b ON b.id = r.bom_id
    ORDER BY r.bom_id
  `).all();
  const insertRouting = db.prepare(`
    INSERT OR IGNORE INTO product_routings(
      id, product_id, routing_code, routing_name, version, status, notes, created_at, updated_at
    ) VALUES(?,?,?,?,?,'INACTIVE',?,?,?)
  `);
  const insertOperation = db.prepare(`
    INSERT OR IGNORE INTO product_routing_operations(
      id, routing_id, sequence_no, operation_code, operation_name, work_center,
      setup_minutes, run_minutes_per_unit, notes, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `);
  const now = new Date().toISOString();
  for (const group of legacyGroups) {
    const routingId = `legacy-routing-${group.bom_id}`;
    const routingCode = `LEGACY-${String(group.bom_id).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40)}`;
    insertRouting.run(
      routingId,
      group.product_id,
      routingCode,
      `历史 BOM 工序 ${group.version || ''}`.trim(),
      String(group.version || 'LEGACY'),
      '由 v1.0 BOM 工序兼容迁移生成；保持停用，不影响当前生产。',
      now,
      now,
    );
    const operations = db.prepare(`
      SELECT r.*, COALESCE(w.name, w.code, '') AS work_center_name
      FROM routing_operations r
      LEFT JOIN work_centers w ON w.id = r.work_center_id
      WHERE r.bom_id = ?
      ORDER BY r.operation_no, r.id
    `).all(group.bom_id);
    const used = new Set();
    for (const operation of operations) {
      let sequence = Number(operation.operation_no) || 10;
      while (used.has(sequence)) sequence += 1;
      used.add(sequence);
      insertOperation.run(
        `legacy-product-routing-operation-${operation.id}`,
        routingId,
        sequence,
        `OP-${sequence}`,
        `工序 ${sequence}`,
        operation.work_center_name || '',
        Math.max(0, Number(operation.setup_time_minutes) || 0),
        Math.max(0, Number(operation.work_time_minutes) || 0),
        operation.description || '',
        now,
        now,
      );
    }
  }
}
