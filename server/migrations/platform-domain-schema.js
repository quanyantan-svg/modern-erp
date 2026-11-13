// Platform 平台层域 — Domain Closure schema.
//
// Implements docs/design/platform.md §32.2 (Schema 与 Migration 计划):
//   - 17 new tables: generic workflow engine (9), SOD engine (2), organization
//     master and scope registry (3), attachments (1), notification
//     subscriptions (1), document number series (1);
//   - additive column extension of the two existing tables the domain owns:
//     `notifications` (producer fields) and `audit_logs` (structured evidence).
//
// Dialect notes (see docs/design/platform.md §32.0 rule 7):
//   - This file carries SQLite DDL only. The MySQL side is DERIVED from a live
//     SQLite snapshot: a fresh database through bootstrapMySql
//     (server/database/mysql-schema.js) and an existing database through
//     planMySqlAdditiveReconciliation + planMySqlIndexReconciliation. Both are
//     snapshot-driven, so the MySQL side lands in the same build without a
//     hand-maintained second copy of the DDL — a second copy is exactly how
//     the two paths drift apart.
//   - The snapshot derivation carries PRIMARY KEY (including composite primary
//     keys: SQLite's PRAGMA table_info reports pk=1,2,... ordinals for them),
//     inline UNIQUE constraints of up to four columns, foreign keys and CHECK
//     constraints. Physical column types come from resolveMySqlColumnType.
//
// Deliberate constraints:
//   - No expression index and no inline UNIQUE wider than four columns: the
//     MySQL index reconciliation refuses expression indexes and the snapshot
//     derivation throws on wide inline UNIQUE.
//   - `notifications` gains only PLAIN indexes. The index reconciliation skips
//     unique indexes (origin === 'u'), so a unique index added to an existing
//     table would exist on SQLite but not on an existing MySQL database.
//     Notification de-duplication is therefore enforced by the application
//     inside the notification's own transaction; writes are serialized by the
//     transaction gate, so the check-then-write is atomic.
//   - JSON payloads are TEXT, matching the repository convention
//     (server/migrations/fixed-assets-schema.js, accounting-period-end-schema.js).
//
// Every statement is idempotent, so the migration can be re-run against an
// existing database without changing its shape.

/** 可重复执行的列追加：重复列名不是错误。 */
function addColumn(db, sql) {
  try { db.exec(sql); }
  catch (error) {
    if (!/duplicate column name/i.test(String(error.message))) throw error;
  }
}

export const PLATFORM_DOMAIN_TABLES = Object.freeze([
  'workflow_templates',
  'workflow_template_versions',
  'workflow_bindings',
  'workflow_binding_history',
  'workflow_instances',
  'workflow_node_instances',
  'workflow_tasks',
  'workflow_action_logs',
  'workflow_events',
  'sod_rules',
  'sod_evaluations',
  'organizations',
  'organization_scopes',
  'organization_scope_bindings',
  'attachments',
  'notification_subscriptions',
  'document_number_series',
]);

/** 既有表上被本域扩展的列（既有表的唯一性不得依赖新增唯一索引）。 */
export const PLATFORM_DOMAIN_ALTERED_TABLES = Object.freeze([
  'notifications',
  'audit_logs',
]);

export function migratePlatformDomainSchema(db) {
  db.exec(`
    -- ============================================================
    -- Generic Workflow engine (PL-04 / WF-01..WF-08)
    -- ============================================================

    -- 流程模板：定义容器。版本本身在 workflow_template_versions。
    CREATE TABLE IF NOT EXISTS workflow_templates (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      document_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','RETIRED')),
      current_version INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_templates_document_type ON workflow_templates(document_type);

    -- 流程版本：PUBLISHED 之后不可变；实例绑定启动时刻的版本快照。
    CREATE TABLE IF NOT EXISTS workflow_template_versions (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT NOT NULL REFERENCES workflow_templates(id),
      version INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','RETIRED')),
      definition_json TEXT NOT NULL,
      change_note TEXT,
      published_by TEXT REFERENCES users(id),
      published_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(template_id, version)
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_template_versions_template ON workflow_template_versions(template_id);

    -- 模板绑定：组织 × 单据类型 唯一。org_id='' 表示全局组织。
    CREATE TABLE IF NOT EXISTS workflow_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      document_type TEXT NOT NULL,
      org_id TEXT NOT NULL DEFAULT '',
      condition_json TEXT,
      template_id TEXT NOT NULL REFERENCES workflow_templates(id),
      version_id TEXT NOT NULL REFERENCES workflow_template_versions(id),
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(document_type, org_id)
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_bindings_status ON workflow_bindings(status);

    -- 绑定历史：绑定换版时留痕，不覆盖旧版本指向。
    CREATE TABLE IF NOT EXISTS workflow_binding_history (
      id TEXT PRIMARY KEY NOT NULL,
      binding_id TEXT NOT NULL REFERENCES workflow_bindings(id),
      version_id TEXT NOT NULL REFERENCES workflow_template_versions(id),
      condition_json TEXT,
      activated_by TEXT NOT NULL REFERENCES users(id),
      activated_at TEXT NOT NULL,
      retired_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_binding_history_binding ON workflow_binding_history(binding_id);

    -- 流程实例：图快照 + 变量快照 + 幂等键。
    CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT NOT NULL REFERENCES workflow_templates(id),
      version_id TEXT NOT NULL REFERENCES workflow_template_versions(id),
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      org_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('RUNNING','SUSPENDED','COMPLETED','TERMINATED','CANCELLED')),
      definition_snapshot_json TEXT NOT NULL,
      variables_json TEXT,
      idempotency_key TEXT NOT NULL,
      started_by TEXT NOT NULL REFERENCES users(id),
      started_at TEXT NOT NULL,
      completed_at TEXT,
      suspended_at TEXT,
      terminated_at TEXT,
      cancel_reason TEXT,
      UNIQUE(idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_instances_document ON workflow_instances(document_type, document_id);
    CREATE INDEX IF NOT EXISTS ix_workflow_instances_status ON workflow_instances(status);

    -- 节点实例：参与人解析结果在物化时快照，避免角色变更导致归属漂移。
    CREATE TABLE IF NOT EXISTS workflow_node_instances (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL REFERENCES workflow_instances(id),
      node_key TEXT NOT NULL,
      node_type TEXT NOT NULL,
      sequence_no INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','COMPLETED','SKIPPED','CANCELLED')),
      assignee_id TEXT REFERENCES users(id),
      assignee_role TEXT,
      entered_at TEXT,
      completed_at TEXT,
      branch_taken TEXT,
      UNIQUE(instance_id, node_key)
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_node_instances_instance ON workflow_node_instances(instance_id);

    -- 任务：row_version 承担乐观锁，避免并发完成同一任务。
    CREATE TABLE IF NOT EXISTS workflow_tasks (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL REFERENCES workflow_instances(id),
      node_instance_id TEXT NOT NULL REFERENCES workflow_node_instances(id),
      assignee_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED','CANCELLED','TRANSFERRED')),
      action TEXT CHECK(action IS NULL OR action IN ('APPROVE','REJECT','RETURN','TRANSFER','ADD_SIGN','SKIP')),
      comment TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      completed_by TEXT REFERENCES users(id),
      row_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_tasks_assignee_status ON workflow_tasks(assignee_id, status);
    CREATE INDEX IF NOT EXISTS ix_workflow_tasks_instance ON workflow_tasks(instance_id);

    -- 动作日志：节点动作的执行证据（表单写回 / 通知 / 下推 / 业务回调）。
    CREATE TABLE IF NOT EXISTS workflow_action_logs (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL REFERENCES workflow_instances(id),
      node_instance_id TEXT NOT NULL REFERENCES workflow_node_instances(id),
      action_type TEXT NOT NULL CHECK(action_type IN ('FORM_WRITE','NOTIFY','PUSH','CALLBACK')),
      target TEXT,
      payload_json TEXT,
      status TEXT NOT NULL CHECK(status IN ('SUCCESS','FAILED')),
      error TEXT,
      executed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_action_logs_instance ON workflow_action_logs(instance_id);

    -- 事件流：实例状态迁移的时序事实，监控与排障的依据。
    CREATE TABLE IF NOT EXISTS workflow_events (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL REFERENCES workflow_instances(id),
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      actor_id TEXT NOT NULL REFERENCES users(id),
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_workflow_events_instance ON workflow_events(instance_id);

    -- ============================================================
    -- SOD engine (PL-02)
    -- ============================================================

    CREATE TABLE IF NOT EXISTS sod_rules (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      business_type TEXT NOT NULL,
      action TEXT NOT NULL,
      constraint_type TEXT NOT NULL CHECK(constraint_type IN ('SAME_PERSON_FORBIDDEN','SAME_ROLE_FORBIDDEN','SAME_DEPARTMENT_FORBIDDEN','MIN_APPROVERS')),
      resolution TEXT NOT NULL CHECK(resolution IN ('REJECT','ESCALATE')),
      escalate_to_role TEXT,
      min_approved_count INTEGER,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_sod_rules_scope ON sod_rules(business_type, action, status);

    CREATE TABLE IF NOT EXISTS sod_evaluations (
      id TEXT PRIMARY KEY NOT NULL,
      rule_id TEXT REFERENCES sod_rules(id),
      business_type TEXT NOT NULL,
      business_id TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL CHECK(decision IN ('PASS','VIOLATED','ESCALATED')),
      detail_json TEXT,
      evaluated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_sod_evaluations_business ON sod_evaluations(business_type, business_id);
    CREATE INDEX IF NOT EXISTS ix_sod_evaluations_actor ON sod_evaluations(actor_id);

    -- ============================================================
    -- Organization master and scope registry (PL-03)
    -- ============================================================

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY NOT NULL,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      org_type TEXT NOT NULL CHECK(org_type IN ('LEGAL_ENTITY','BUSINESS_UNIT')),
      parent_org_id TEXT REFERENCES organizations(id),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
      effective_from TEXT,
      effective_to TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_organizations_parent ON organizations(parent_org_id);
    CREATE INDEX IF NOT EXISTS ix_organizations_type_status ON organizations(org_type, status);

    CREATE TABLE IF NOT EXISTS organization_scopes (
      id TEXT PRIMARY KEY NOT NULL,
      scope_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      binding_mode TEXT NOT NULL CHECK(binding_mode IN ('SINGLE','MULTI')),
      created_at TEXT NOT NULL
    );

    -- 作用域 ↔ 组织 的显式映射。accounting_scopes.org_scope 是自由文本标签，
    -- 其校验语义不变；二者通过 scope_code ↔ accounting_scopes.code 关联。
    CREATE TABLE IF NOT EXISTS organization_scope_bindings (
      id TEXT PRIMARY KEY NOT NULL,
      scope_id TEXT NOT NULL REFERENCES organization_scopes(id),
      org_id TEXT NOT NULL REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      UNIQUE(scope_id, org_id)
    );
    CREATE INDEX IF NOT EXISTS ix_organization_scope_bindings_org ON organization_scope_bindings(org_id);

    -- ============================================================
    -- Attachments (PL-10)
    -- ============================================================

    -- storage_key 由内容寻址派生（sha256 前 2 / 2 / 全量），
    -- 因此同一内容可挂到多个单据，storage_key 不建唯一约束。
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_attachments_owner ON attachments(owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS ix_attachments_sha ON attachments(sha256);

    -- ============================================================
    -- Notification subscriptions (PL-11)
    -- ============================================================

    CREATE TABLE IF NOT EXISTS notification_subscriptions (
      user_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      event_type TEXT NOT NULL,
      channel TEXT NOT NULL CHECK(channel IN ('IN_APP')),
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, category, event_type, channel)
    );

    -- ============================================================
    -- Document number series (PL-09)
    -- ============================================================

    -- 编号规则表。既有 document_sequences / document_number_allocations 的
    -- 结构不变，服务层在其上发放；组织维度只体现在 period_key（ORG01:202611），
    -- 不编进单号文本，既有 6 种单号因此逐字符不变。
    CREATE TABLE IF NOT EXISTS document_number_series (
      id TEXT PRIMARY KEY NOT NULL,
      document_type TEXT NOT NULL,
      org_id TEXT NOT NULL DEFAULT '',
      prefix TEXT NOT NULL,
      suffix TEXT NOT NULL DEFAULT '',
      period_mode TEXT NOT NULL CHECK(period_mode IN ('NONE','MONTH','YEAR')),
      pad_length INTEGER NOT NULL DEFAULT 5,
      reset_rule TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(document_type, org_id)
    );
  `);

  // --------------------------------------------------------------------
  // 既有表的加列扩展。既有表不得新增唯一索引（见文件头说明）。
  // --------------------------------------------------------------------

  addColumn(db, "ALTER TABLE notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL'");
  addColumn(db, 'ALTER TABLE notifications ADD COLUMN category TEXT');
  addColumn(db, 'ALTER TABLE notifications ADD COLUMN action_url TEXT');
  addColumn(db, 'ALTER TABLE notifications ADD COLUMN expires_at TEXT');
  addColumn(db, 'ALTER TABLE notifications ADD COLUMN dedupe_key TEXT');
  // 事件类型：消费侧必须能区分「待办 / 结果 / 阻塞 / 知会」，不能靠解析标题。
  addColumn(db, 'ALTER TABLE notifications ADD COLUMN event_type TEXT');

  addColumn(db, 'ALTER TABLE audit_logs ADD COLUMN business_date TEXT');
  addColumn(db, 'ALTER TABLE audit_logs ADD COLUMN request_id TEXT');
  addColumn(db, 'ALTER TABLE audit_logs ADD COLUMN before_json TEXT');
  addColumn(db, 'ALTER TABLE audit_logs ADD COLUMN after_json TEXT');

  // 既有库补齐 sod_rules 的 MIN_APPROVERS 阈值列（新建库已含该列，重复添加会被忽略）。
  addColumn(db, 'ALTER TABLE sod_rules ADD COLUMN min_approved_count INTEGER');

  /*
   * sod_rules.created_by 允许为空：规则可以是**系统种子**的（没有人工创建者）。
   * 迁移时点 users 表还没有播种（用户的种子在演示数据阶段），因此系统种子规则不能
   * 引用一个尚不存在的用户。早期版本该列为 NOT NULL，需要重建该表。
   */
  const sodRuleCreator = db.prepare('PRAGMA table_info(sod_rules)').all()
    .find((column) => column.name === 'created_by');
  if (sodRuleCreator && sodRuleCreator.notnull === 1) {
    db.exec(`
      CREATE TABLE sod_rules_rebuilt (
        id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL UNIQUE,
        business_type TEXT NOT NULL,
        action TEXT NOT NULL,
        constraint_type TEXT NOT NULL CHECK(constraint_type IN ('SAME_PERSON_FORBIDDEN','SAME_ROLE_FORBIDDEN','SAME_DEPARTMENT_FORBIDDEN','MIN_APPROVERS')),
        resolution TEXT NOT NULL CHECK(resolution IN ('REJECT','ESCALATE')),
        escalate_to_role TEXT,
        min_approved_count INTEGER,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')),
        created_by TEXT REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO sod_rules_rebuilt(id, code, business_type, action, constraint_type, resolution,
        escalate_to_role, min_approved_count, status, created_by, created_at, updated_at)
        SELECT id, code, business_type, action, constraint_type, resolution,
          escalate_to_role, min_approved_count, status, created_by, created_at, updated_at FROM sod_rules;
      DROP TABLE sod_rules;
      ALTER TABLE sod_rules_rebuilt RENAME TO sod_rules;
    `);
  }

  /*
   * 种子规则：**只有生产工单族**。
   *
   * 其余 6 个族各自已有自审批防护（销售订单 / 采购订单 / 请购单 / 库存盘点 / 会计凭证 /
   * 信用特批），平台层不再重复设规则 —— 这样既不改变既有族的任何行为，也不为每次审批
   * 产生判定记录行。生产工单族此前**没有**自审批防护（PL-DEF-01），由平台层补齐。
   */
  db.prepare(
    "INSERT OR IGNORE INTO sod_rules(id, code, business_type, action, constraint_type, resolution,"
    + ' escalate_to_role, min_approved_count, status, created_by, created_at, updated_at)'
    + ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    'sod-production-order-same-person', 'SOD-PRODUCTION-ORDER-SAME-PERSON', 'PRODUCTION_ORDER', 'APPROVE',
    'SAME_PERSON_FORBIDDEN', 'REJECT', null, null, 'ACTIVE', null,
    new Date().toISOString(), new Date().toISOString(),
  );

  db.exec(`
    CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS ix_notifications_user_unread ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS ix_notifications_dedupe ON notifications(user_id, dedupe_key);

    CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS ix_audit_logs_entity ON audit_logs(entity_type, entity_id);
  `);
}
