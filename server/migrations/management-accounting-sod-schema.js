// R-02 — 经营关账的职责分离归属字段（docs/design/accounting-analytics.md §31.16.4）。
//
// 经营关账的职责分离要求回答两个问题：
//   * 谁**创建**了该期所用的分摊规则（`allocation_rules`）？
//   * 谁**执行**了该期的分摊（`allocation_results`）？
//
// 既有表都没有这两个归属字段，因此本次是**加列**（additive）扩展：
//   * `allocation_rules.created_by` —— 规则创建人；
//   * `allocation_results.created_by` —— 分摊执行人。
//
// 历史行的归属只从**审计证据**回填一次（规则创建人来自 `CREATE / ALLOCATION_RULE` 的审计行；
// 分摊执行人来自该结果所属归集计划的 `ALLOCATE / MANAGEMENT_ALLOCATION` 审计行）。
// 回填不到的行**留空**：关账时按 fail closed 拒绝，不得臆测一个创建人。
//
// 幂等：列的存在由 PRAGMA 探测决定；回填只填空值；重复执行不改变已归属的行。

export function migrateManagementAccountingSodSchema(db) {
  addNullableTextColumn(db, 'allocation_rules', 'created_by');
  addNullableTextColumn(db, 'allocation_results', 'created_by');

  // 索引：MySQL 不接受 `CREATE INDEX IF NOT EXISTS`，而由快照派生的 schema 已经
  // 建过同名索引，因此这里用「重复即忽略」的可移植写法。
  ensureIndex(db, 'idx_allocation_rules_created_by', 'allocation_rules(created_by)');
  ensureIndex(db, 'idx_allocation_results_created_by', 'allocation_results(created_by)');

  // 分摊规则创建人：审计动作 CREATE / 实体类型 ALLOCATION_RULE。
  db.prepare(`UPDATE allocation_rules SET created_by = (
      SELECT a.user_id FROM audit_logs a
       WHERE a.entity_type = 'ALLOCATION_RULE' AND a.entity_id = allocation_rules.id AND a.action = 'CREATE'
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1)
    WHERE created_by IS NULL`).run();

  // 分摊执行人：审计动作 ALLOCATE / 实体类型 MANAGEMENT_ALLOCATION，实体 id = 归集计划 id。
  db.prepare(`UPDATE allocation_results SET created_by = (
      SELECT a.user_id FROM audit_logs a
       WHERE a.entity_type = 'MANAGEMENT_ALLOCATION' AND a.entity_id = allocation_results.plan_id AND a.action = 'ALLOCATE'
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1)
    WHERE created_by IS NULL`).run();
}

function ensureIndex(db, name, definition) {
  try {
    db.exec(`CREATE INDEX ${name} ON ${definition}`);
  } catch (error) {
    const message = String(error?.message || error);
    if (!/duplicate key name|already exists/i.test(message)) throw error;
  }
}

function addNullableTextColumn(db, table, column) {
  const probe = db.prepare(`PRAGMA table_info(${table})`).all();
  if (probe.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
}
