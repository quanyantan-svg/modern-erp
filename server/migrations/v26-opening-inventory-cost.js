// F-02 · 期初库存计价与期初权益锚点。
//
// 期初库存单此前**没有成本字段**：确认只写数量不写估值，于是每一条期初移动都停在
// `inventory_transactions.valuation_status = 'LEGACY_UNVALUED'`，永久触发
// `LEGACY_UNVALUED_MOVEMENTS` 与 `INVENTORY_QUANTITY_VS_VALUATION` 两项 BLOCKING
// 检查，并且批次料从期初进来就没有身份级估值池，委外发料被 409
// `OUTSOURCING_VALUATION_UNVERIFIED` 挡住。
//
// 本迁移只做两件 additive 的事：
//
//   1. `opening_inventory_items.unit_cost_cents`：期初行成本单价（安全整数分）。
//      **既有行不回填**：没有可证明的成本不得凭空估价（Requirement §33.3
//      canonical facts 必须可重算）；缺成本的期初行在确认时固定拒绝。
//   2. 期初权益科目与角色映射：期初存货价值在总账上的对方科目。
//      平台此前没有权益科目，期初价值无处记账，`INVENTORY_VALUE_TO_GL`
//      会因为「有估值无总账」而失配。
//
// 所有语句幂等；SQLite 与 MySQL 双路径共用（列类型用两库通用的 INTEGER/TEXT）。

export function migrateV26OpeningInventoryCost(db) {
  addColumn(db, 'opening_inventory_items', 'unit_cost_cents', 'unit_cost_cents INTEGER NOT NULL DEFAULT 0');

  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO accounting_subjects(id,code,name,type,direction,active) VALUES('subject-4001','4001','实收资本','EQUITY','CREDIT',1)").run();
  db.prepare(`INSERT OR IGNORE INTO account_role_mappings(role_code,subject_id,updated_by,updated_at)
    SELECT 'OPENING_EQUITY', id, NULL, ? FROM accounting_subjects WHERE code='4001'`).run(now);
}

function addColumn(db, table, column, ddl) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((row) => String(row.name).toLowerCase() === column.toLowerCase())) return false;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  } catch {
    // 表不存在（尚未建表）或列已存在：保持幂等，不阻断启动。
    return false;
  }
}
