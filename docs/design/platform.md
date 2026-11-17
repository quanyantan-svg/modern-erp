# Platform — Design

> 状态：`ACTIVE`
> Owner：Platform
> 权威来源：`solution.md` §0.1 Domain Design 入口 + 本文件 `§32`
> 来源：新增正文（2026-11-13 建立 Platform 平台层域 Domain Technical Design）。
> **本文件已获业务所有者批准（`APPROVED`，2026-11-13）**；**Implementation 状态：`NOT_AUTHORIZED`**。
> 上游依据：[`docs/requirements/platform.md`](../requirements/platform.md) §36（Platform Domain Closure Requirement）；
> 审计台账 [`docs/audits/platform-capability-audit-20261113.md`](../audits/platform-capability-audit-20261113.md)；
> 裁定记录 [`docs/decisions/platform-domain-closure-decisions-20261113.md`](../decisions/platform-domain-closure-decisions-20261113.md)。
> 平台目标形态来自 [`solution.md` §20.6、§20.7](../../solution.md)。
> **Implementation 状态：`NOT_AUTHORIZED`** —— 按 AGENTS.md §4.3，Design 完成后 HARD STOP，须业务所有者明确批准方可开工。
> **2026-11-14 有界解冻**：业务所有者已批准 Requirement §36.15 与新增 §32.15（Design `APPROVED`），
> 并授权实施；§32.15 只覆盖 R-02 期间控制一致性，既有 §32.0–§32.14 结论不变。

## 32. Platform 平台层域 Domain Technical Design

### 32.0 设计纪律与实现边界

1. **单一 canonical owner**：每个能力有且只有一个 owner 模块；路由通过 `ownedRouteTable.register({method, path, handler, owner})` 注册（`server/lib/route-table.js`）。描述符**只允许** `method` / `path` / `handler` / `owner` 四个键 —— 权限、事务、审计策略**不得**进入描述符（`server/lib/route-table.js:36-58`），它们留在 handler 入口。
2. **权限 fail closed**：统一用 `allow(actor, permission)` / `allowAny(actor, [...])`（`server/lib/http.js:54-67`）。前端隐藏不等于授权。
3. **事务边界在 handler**：`transaction(db, work)`（`server/db.js:2448`，SQLite `BEGIN IMMEDIATE`；MySQL 先取全局闸门行 `mysql_transaction_gates` 再执行业务行）。只读用 `readTransaction`（`server/db.js:2529`）。
4. **审计在 handler**：`audit(db, userId, action, entityType, entityId, detail)`（`server/lib/audit.js:4-6`）**同事务**写入；业务拒绝审计 `auditBusinessRejection(db, actor, context, error, {onlyCodes})`（`server/lib/audit.js:19-32`）**必须在事务外**调用，仅对 HttpError 409 触发。
5. **DDL 不进事务**：MySQL DDL 隐式提交。所有建表 / 改表 / 建索引必须在 `transaction()` 之外执行。
6. **双 DDL 同批**：每个新表必须同时提供 SQLite 与 MySQL DDL；MySQL 物理类型经 `resolveMySqlColumnType`（`server/database/mysql-schema.js:183`）解析，与快照路径共用同一来源（`:168-181`）。MySQL 建表 / 改表经 `mysql-worker.js` 的 `'exec'` action（`:219` → `runExec :153`）。
7. **MySQL 方言由 SQLite 快照派生，不手写第二份 DDL**（2026-11-13 修正）：
   - 全新 MySQL 库经 `bootstrapMySql`（`server/database/mysql-schema.js:459`）从 SQLite 快照派生；
   - **既有** MySQL 库经 `planMySqlAdditiveReconciliation`（`:374`）补齐缺失的**表与列**、
     `planMySqlIndexReconciliation`（`:389`）补齐缺失的**普通列索引** —— **两者都是快照驱动**，
     因此迁移文件**只需写 SQLite DDL**，MySQL 侧自动同批落地；
   - `tableDefinition`（`:247-269`）负责携带 PK（**含复合主键** —— SQLite `PRAGMA table_info` 对复合主键
     返回 `pk=1,2,…` 序位，`:253` 按序位排序后正确生成 `PRIMARY KEY (a, b)`）、
     行内 UNIQUE（≤4 列）、外键与 **CHECK 约束**（`:268`）；列物理类型由 `resolveMySqlColumnType`（`:183`）
     从 SQLite 类型派生，**不得手写第二份类型表**（第二份正是两条路径漂移的来源）；
   - **必须由迁移显式处理的三种例外**：① 表达式索引（`planMySqlIndexReconciliation` 明确拒绝）；
     ② 行内 UNIQUE 超过 4 列（快照派生会抛错）；③ 需要 MySQL 专有类型或命名约束的表。
   - **本域 17 张新表全部避开上述三种例外** → 一律只写 SQLite DDL。
8. **测试必须登记**：测试发现根只有 `server` 与 `src/lib`（`scripts/testing/test-suites.js:965-981`）；`validate()`（`:1001`）对任何未分类的 `server/*.test.js` 直接失败。新增测试文件必须登记进 FAST / FULL / HEAVY。
9. **金额用安全整数分**（AGENTS.md §6）。
10. **既有表新增唯一索引不会被增量对账补齐**：`planMySqlIndexReconciliation`（`:389-405`）**跳过**
    `origin === 'u'` 的索引 → 对**已存在的**表（如 `notifications`）新增 UNIQUE 索引，在既有 MySQL 库上不会被创建，
    与 SQLite 快照产生 parity 差异。故：**既有表一律只加普通列与普通索引**；
    唯一性由**应用层在事务内**保证 —— 本仓库的写事务被序列化（SQLite `BEGIN IMMEDIATE`，
    MySQL 全局闸门行 `mysql_transaction_gates`），故事务内的「先查后写」是原子的。
11. **JSON 载荷列用 `TEXT`**（仓库既有约定：`server/migrations/fixed-assets-schema.js:85` 的
    `before_json TEXT NOT NULL`、`server/migrations/accounting-period-end-schema.js:51` 的
    `difference_json TEXT`），**不在** SQLite 侧声明 `JSON` 类型。
12. **平台能力不得成为第二写入口**：通用工作流的"下推"动作必须调用目标域的 canonical 创建入口；跨域调用必须走被调域的 canonical API。
13. **平台错误码自成命名空间**（`PLATFORM_*`），不得被业务域用作业务判断依据（AGENTS.md §6；`docs/decisions/cross-domain-error-code-policy-20261112.md`）。

### 32.1 模块与文件清单

#### 32.1.1 后端

| 文件 | 责任 |
|---|---|
| `server/modules/platform-workflow-engine.js` | 流程模板 / 版本 / 绑定 / 实例 / 节点实例 / 任务 / 动作 / 事件 / 监控 / 实例级控制的**唯一 owner**；引擎状态机与事务边界 |
| `server/modules/platform-workflow-conditions.js` | 条件表达式求值（白名单字段 + 白名单运算符）；参与人解析规则求值 |
| `server/modules/platform-sod.js` | SOD 规则 CRUD 与 `assertSodCompliance` 求值引擎；initiator resolver 注册表 |
| `server/modules/platform-organizations.js` | 组织主数据 / 层级 / 作用域登记的唯一 owner |
| `server/modules/platform-attachments.js` | 附件元数据 CRUD、内容寻址存储编排、下载授权 |
| `server/modules/platform-notifications.js` | **既有模块扩展**：列表 / 已读之外，新增生产者编排、订阅、路由展开、去重 |
| `server/modules/platform-numbering.js` | 编号服务：规则表 CRUD、号段分配（幂等、原子）、单号格式渲染 |
| `server/lib/audit.js` | `audit()` 增加**可选**参数（`businessDate` / `requestId` / `before` / `after`），默认行为不变 |
| `server/lib/http.js` | 新增 `readMultipart(req, {limitBytes, allowedTypes})`；`readJson` 行为**完全不变** |
| `server/modules/platform-workflows.js` | **退役**（既有 19 行 CRUD 与死列 `steps` 无生产消费方） |
| `server/migrations/platform-domain-schema.js` | 全部新表 + `notifications` / `audit_logs` 的 ALTER（SQLite + MySQL 双 DDL） |

#### 32.1.2 前端

| 文件 | 责任 |
|---|---|
| `src/pages/platform-workflow-designer.jsx` | 流程定义编辑 + 版本发布 + 测试运行（LIST → DETAIL → EDITOR） |
| `src/pages/platform-workflow-bindings.jsx` | 模板绑定（组织 × 单据类型 × 条件） |
| `src/pages/platform-workflow-tasks.jsx` | 我的工作流任务（同意 / 驳回 / 退回 / 转办 / 加签） |
| `src/pages/platform-workflow-monitor.jsx` | 实例监控 + 暂停 / 恢复 / 终止 / 重新部署 |
| `src/pages/platform-organizations.jsx` | 组织注册表 + 层级 + 作用域分配 |
| `src/pages/platform-numbering.jsx` | 编号规则维护 + 待迁移单据清单 |
| `src/pages/platform-sod-rules.jsx` | SOD 规则维护 + 求值记录 |
| `src/pages/platform-lifecycle.jsx` | 文档生命周期工作面（生命周期记录 / 归档 / 恢复 / 清理） |
| `src/components/AttachmentPanel.jsx` | 附件挂载组件（嵌入业务单据详情页） |
| `src/pages/platform-notifications.jsx` | **既有页面扩展**：分类 / 优先级 / 跳转 + 未读徽标 |

#### 32.1.3 路由（`src/navigation/applicationRegistry.js`）

**退役**：`workflows`（`applicationRegistry.js:106` 的 `DISABLED_ROUTE_DEFINITIONS` 条目 + `:204` 的 screen 映射）与 `src/pages/platform-workflows.jsx`。理由：该页面读取**表中不存在**的 `item.active` 列（`:21`）、`entity_type` 选项与族键不匹配（`:56`）、无 update 路由导致编辑永远 INSERT（`:22`、`:51`）。退役为 410（`server/app.js` 的既有退役惯例），`approval_workflows` 表**保留不删**（历史表不得在普通 cleanup 中直接 DROP，AGENTS.md §15），登记为非权威。

**新增**（全部 `enabled`）：

| route key | 标题 | 权限 | mobileExposure |
|---|---|---|---|
| `workflow-designer` | 流程设计 | `WORKFLOW_VIEW` / `WORKFLOW_MANAGE` | `advanced-config` |
| `workflow-bindings` | 流程绑定 | `WORKFLOW_VIEW` / `WORKFLOW_MANAGE` | `advanced-config` |
| `workflow-tasks` | 我的流程任务 | `WORKFLOW_TASK_VIEW` / `WORKFLOW_TASK_ACT` | `workflow-tasks-tab` |
| `workflow-monitor` | 流程监控 | `WORKFLOW_INSTANCE_VIEW` / `WORKFLOW_CONTROL` / `WORKFLOW_REDEPLOY` | `advanced-config` |
| `organizations` | 组织与作用域 | `ORGANIZATIONS_VIEW` / `ORGANIZATIONS_MANAGE` | `system-settings` |
| `numbering` | 编号规则 | `NUMBERING_VIEW` / `NUMBERING_MANAGE` | `advanced-config` |
| `sod-rules` | 职责分离规则 | `SOD_RULES_VIEW` / `SOD_RULES_MANAGE` | `advanced-config` |
| `lifecycle` | 生命周期与归档 | `LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE` | `system-settings` |

`workflow-tasks` 的徽标**独立于**审批中心徽标（`src/App.jsx:186` 的 `tabBadges` 增加 `workflowTasks` 键），**不得**并入 `pendingApprovalCount`（Requirement §36.3.9）。

#### 32.1.4 七个 operator 工作面的实施结果（2026-11-14）

七个工作面已落地，路由与权限按 §32.1.3 的表登记，屏根带 canonical `data-testid`
（浏览器 UAT 据此判定「屏真的渲染出来了」而不是「脚本跑完了」）。

| route key | 页面 | 屏根 data-testid | 工作面结构 |
|---|---|---|---|
| `workflow-designer` | `src/pages/platform-workflow-designer.jsx` | `platform-workflow-designer-page` | LIST 模板 → DETAIL 版本 → EDITOR 定义 JSON + 试运行 |
| `workflow-bindings` | `src/pages/platform-workflow-bindings.jsx` | `platform-workflow-bindings-page` | LIST 绑定 + EDITOR（模板 × 版本 × 组织 × 条件） |
| `workflow-tasks` | `src/pages/platform-workflow-tasks.jsx` | `platform-workflow-tasks-page` | LIST 我的任务 + Sheet 动作（同意 / 驳回 / 退回 / 转办 / 加签 / 跳过） |
| `workflow-monitor` | `src/pages/platform-workflow-monitor.jsx` | `platform-workflow-monitor-page` | LIST 实例 → DETAIL 节点 / 任务 / 事件轨迹 + 暂停 / 恢复 / 终止 |
| `organizations` | `src/pages/platform-organizations.jsx` | `platform-organizations-page` | LIST 组织树 + EDITOR + 作用域分配 |
| `numbering` | `src/pages/platform-numbering.jsx` | `platform-numbering-page` | LIST 编号规则 + 待迁移单据清单 |
| `sod-rules` | `src/pages/platform-sod-rules.jsx` | `platform-sod-rules-page` | 族覆盖登记 / 规则 / 升级待办 / 判定记录 四个分区 |

共用样式 `src/styles/platform-operations.css`（mobile-first：390 基线 + 320 / 430 / 680 断点）。
通知中心页（`src/pages/platform-notifications.jsx`）按 §32.1.2 扩展为分类 / 优先级 / 跳转 /
未读 / 订阅管理，屏根 `platform-notifications-page`。

**旧版审批流退役已落地**：`workflows` 路由从注册表移除（`applicationRouteFor('workflows')` 归 null），
`src/pages/platform-workflows.jsx` 与 `server/modules/platform-workflows.js` 删除，
`GET / POST /api/workflows` 按既有退役惯例返回 **410** 并指向 `/api/platform/workflow-templates`；
`approval_workflows` 表保留不删，登记为非权威。

**实施期合同修正（两处与既有冻结合同的冲突，按既有合同收敛）**：

1. **启动器合同排除 Platform**（`server/v17-domain-alignment.test.js` 的
   「Business Launcher is exactly eight non-empty canonical groups and excludes Platform」）。
   因此七个 Platform 工作面**不进**移动端启动器分组，只进桌面导航的「系统设置」分组；
   与既有 `users`（用户与权限）等 Platform 面一致。移动端可达性沿用既有先例。
2. **移动端 5 tab 合同冻结**（`server/mobile-shell.test.js` 断言恰好 5 个启用 tab）。
   §32.1.3 写的 `workflow-tasks` 徽标挂载点 `workflow-tasks-tab` 因此**没有**对应的移动端
   tab 可挂载。徽标改为两处承载，二者互不合并：
   - `src/App.jsx` 的 `tabBadges` 增加 `workflowTasks` 键（键位按 §32.1.3 保留，值由
     `GET /api/platform/workflow-tasks` 的 PENDING 计数得出）；
   - 通知中心（移动端「消息」tab 的内容）以**独立条目**呈现该计数并可跳转到
     「我的流程任务」工作面 —— 独立于 `pendingApprovalCount`，满足 Requirement §36.3.9。

**浏览器 UAT（非空洞证据）**：`scripts/acceptance/platform-workfaces-responsive-uat.mjs`
—— 8 屏 × 4 档宽度（320 / 390 / 430 / 680）共 32 次判定，全部 PASS：屏根 testid 已绘制、
画出真实数据行（或指名原因的显式空态）、无权限拒绝态 / 错误态、无横向溢出、
无低于 44 CSS px 的可点击目标、无控制台错误。夹具经**真实 API**建立
（组织 → 作用域 → 模板 → 版本 → 发布 → 绑定 → 启动实例），因此「我的流程任务」与
「流程监控」有真实数据行而不是空壳。

**残余**：

- （无 —— `src/components/AttachmentPanel.jsx` 已落地，见 §32.6.6）
- 通用工作流引擎**没有**对外的实例启动入口（§32.11 约束 #7：平台能力不得成为第二写入口），
  因此「流程监控」与「我的流程任务」在业务域接线之前恒为空态；浏览器 UAT 的夹具因此
  直接调用引擎的 canonical 启动函数 `startWorkflowInstance`。

### 32.2 Schema 与 Migration 计划

迁移文件：`server/migrations/platform-domain-schema.js`（新文件）。注册方式 = `server/db.js` 顶部 `import` + `createSqliteDatabase`（`server/db.js:353-607`）中**按序调用**。迁移必须**可重复执行**（`CREATE TABLE IF NOT EXISTS` / `addColumn` 存在性检查），且**不重写任何历史行**。

#### 32.2.1 通用工作流引擎

| 表 | 关键列 | 约束 |
|---|---|---|
| `workflow_templates` | `id` PK、`code` UNIQUE、`name`、`document_type`、`status` CHECK(DRAFT/PUBLISHED/RETIRED)、`current_version`、`created_by` FK users、`created_at`、`updated_at`、`retired_at` | `ix_workflow_templates_document_type` |
| `workflow_template_versions` | `id` PK、`template_id` FK、`version` INTEGER、`status` CHECK(DRAFT/PUBLISHED/RETIRED)、`definition_json`、`change_note`、`published_by` FK users、`published_at`、`created_at` | UNIQUE(`template_id`,`version`)；`ix_workflow_template_versions_template` |
| `workflow_bindings` | `id` PK、`document_type`、`org_id` NOT NULL DEFAULT `''`（`''` = 全局组织）、`condition_json`、`template_id` FK、`version_id` FK、`priority`、`status` CHECK(ACTIVE/INACTIVE)、`created_by`、`created_at`、`updated_at` | UNIQUE(`document_type`,`org_id`)；`ix_workflow_bindings_status` |
| `workflow_binding_history` | `id` PK、`binding_id` FK、`version_id` FK、`condition_json`、`activated_by` FK users、`activated_at`、`retired_at` | `ix_workflow_binding_history_binding` |
| `workflow_instances` | `id` PK、`template_id` FK、`version_id` FK、`document_type`、`document_id`、`org_id` NOT NULL DEFAULT `''`、`status` CHECK(RUNNING/SUSPENDED/COMPLETED/TERMINATED/CANCELLED)、`definition_snapshot_json`、`variables_json`、`idempotency_key`、`started_by` FK users、`started_at`、`completed_at`、`suspended_at`、`terminated_at`、`cancel_reason` | UNIQUE(`idempotency_key`)；`ix_workflow_instances_document`(`document_type`,`document_id`)；`ix_workflow_instances_status` |
| `workflow_node_instances` | `id` PK、`instance_id` FK、`node_key`、`node_type`、`sequence_no`、`status` CHECK(PENDING/ACTIVE/COMPLETED/SKIPPED/CANCELLED)、`assignee_id` FK users NULL、`assignee_role` NULL、`entered_at`、`completed_at`、`branch_taken` | UNIQUE(`instance_id`,`node_key`)；`ix_workflow_node_instances_instance` |
| `workflow_tasks` | `id` PK、`instance_id` FK、`node_instance_id` FK、`assignee_id` FK users、`status` CHECK(PENDING/COMPLETED/CANCELLED/TRANSFERRED)、`action` NULL CHECK(APPROVE/REJECT/RETURN/TRANSFER/ADD_SIGN/SKIP)、`comment`、`created_at`、`completed_at`、`completed_by` FK users NULL、`row_version` INTEGER NOT NULL DEFAULT 0 | `ix_workflow_tasks_assignee_status`(`assignee_id`,`status`)；`ix_workflow_tasks_instance` |
| `workflow_action_logs` | `id` PK、`instance_id` FK、`node_instance_id` FK、`action_type` CHECK(FORM_WRITE/NOTIFY/PUSH/CALLBACK)、`target`、`payload_json`、`status` CHECK(SUCCESS/FAILED)、`error`、`executed_at` | `ix_workflow_action_logs_instance` |
| `workflow_events` | `id` PK、`instance_id` FK、`event_type`、`from_status`、`to_status`、`actor_id` FK users、`detail_json`、`created_at` | `ix_workflow_events_instance` |

`definition_json` 的**节点图结构**（写入前必须经 `platform-workflow-conditions.js` 的结构校验）：

```json
{
  "nodes": [
    { "key": "n1", "type": "APPROVAL", "name": "主管审批",
      "participants": [{ "type": "ROLE", "value": "REVIEWER" }],
      "onApprove": { "next": "n2" }, "onReject": { "next": "END" } },
    { "key": "n2", "type": "APPROVAL", "name": "条件分支",
      "participants": [{ "type": "USER", "value": "<user-id>" }],
      "condition": { "field": "amountCents", "op": ">", "value": 100000 },
      "onTrue": { "next": "n3" }, "onFalse": { "next": "END" } },
    { "key": "n3", "type": "NOTIFY", "name": "知会财务",
      "participants": [{ "type": "ROLE", "value": "ACCOUNTING" }],
      "action": { "type": "NOTIFY", "target": "ACCOUNTING" } }
  ],
  "entry": "n1"
}
```

节点类型白名单：`APPROVAL` / `PARALLEL_APPROVAL` / `CONDITION` / `NOTIFY` / `CC` / `END`。
参与人类型白名单：`ROLE` / `USER` / `INITIATOR` / `INITIATOR_MANAGER` / `FIELD_USER`。
条件运算符白名单：`=` `!=` `>` `>=` `<` `<=` `in` `contains`。**禁止任何脚本求值**。

#### 32.2.2 SOD 引擎

| 表 | 关键列 | 约束 |
|---|---|---|
| `sod_rules` | `id` PK、`code` UNIQUE、`business_type`、`action`、`constraint_type` CHECK(SAME_PERSON_FORBIDDEN/SAME_ROLE_FORBIDDEN/SAME_DEPARTMENT_FORBIDDEN/MIN_APPROVERS)、`resolution` CHECK(REJECT/ESCALATE)、`escalate_to_role` NULL、`status` CHECK(ACTIVE/INACTIVE)、`created_by`、`created_at`、`updated_at` | `ix_sod_rules_scope`(`business_type`,`action`,`status`) |
| `sod_evaluations` | `id` PK、`rule_id` FK、`business_type`、`business_id`、`actor_id` FK users、`decision` CHECK(PASS/VIOLATED/ESCALATED)、`detail_json`、`evaluated_at` | `ix_sod_evaluations_business`(`business_type`,`business_id`)；`ix_sod_evaluations_actor` |

#### 32.2.3 组织主数据与作用域

| 表 | 关键列 | 约束 |
|---|---|---|
| `organizations` | `id` PK、`code` UNIQUE、`name`、`org_type` CHECK(LEGAL_ENTITY/BUSINESS_UNIT)、`parent_org_id` FK organizations NULL、`status` CHECK(ACTIVE/INACTIVE)、`effective_from`、`effective_to` NULL、`created_by`、`created_at`、`updated_at` | `ix_organizations_parent`；`ix_organizations_type_status` |
| `organization_scopes` | `id` PK、`scope_code` UNIQUE、`name`、`binding_mode` CHECK(SINGLE/MULTI)、`created_at` | — |
| `organization_scope_bindings` | `id` PK、`scope_id` FK、`org_id` FK、`created_at` | UNIQUE(`scope_id`,`org_id`)；`ix_organization_scope_bindings_org` |

`organizations` 的 `parent_org_id` 自引用**必须**防环：写入前校验新父链不得回到自身（`PLATFORM_ORGANIZATION_CYCLE`）。

#### 32.2.4 附件

| 表 | 关键列 | 约束 |
|---|---|---|
| `attachments` | `id` PK、`owner_type`、`owner_id`、`file_name`、`content_type`、`byte_size` INTEGER、`sha256`、`storage_key` UNIQUE、`uploaded_by` FK users、`created_at`、`deleted_at` NULL | `ix_attachments_owner`(`owner_type`,`owner_id`)；`ix_attachments_sha` |

**内容寻址存储**：`storage_key = sha256[0:2] / sha256[2:4] / sha256`（十六进制）。同一内容重复上传共享同一物理文件，`attachments` 表的 `storage_key` UNIQUE 变为**非唯一索引 + 允许同键多行**（同一文件挂到多个单据）—— 因此 `storage_key` **不建 UNIQUE**，改由 `sha256` 索引 + 业务唯一性由 `(owner_type, owner_id, sha256, file_name)` 保证。

**`accounting_vouchers.attachment_count` 处置**：该列是孤儿列（`server/db.js:399`、`:471`、`:482`，无写方无读方）。迁移**不改**该列的结构（避免触碰 Accounting & Analytics 已冻结域的表定义），改为：
- 附件挂到凭证时，同事务 `UPDATE accounting_vouchers SET attachment_count = (SELECT COUNT(*) FROM attachments WHERE owner_type='ACCOUNTING_VOUCHER' AND owner_id=? AND deleted_at IS NULL)`；
- 附件删除时同事务重算；
- 即该列成为**派生值**，唯一写入口是附件模块。

#### 32.2.5 通知

`notifications` 表**扩展**（ALTER，不重建）：

| 变更 | 内容 |
|---|---|
| ADD COLUMN | `priority` TEXT NOT NULL DEFAULT 'NORMAL'、`category` TEXT、`action_url` TEXT、`expires_at` TEXT、`dedupe_key` TEXT |
| 索引 | `ix_notifications_user`(`user_id`)、`ix_notifications_user_unread`(`user_id`,`is_read`)、`ix_notifications_created_at`(`created_at`)、`ix_notifications_dedupe`(`user_id`,`dedupe_key`) —— **全部为普通索引**（既有表不得新增唯一索引，见 §32.0 第 10 条） |
| 唯一 | **不建唯一索引**（2026-11-13 修正）：`planMySqlIndexReconciliation`（`server/database/mysql-schema.js:389-405`）跳过 `origin === 'u'` 的索引 → 对**已存在的** `notifications` 表新增 UNIQUE 索引，在既有 MySQL 库上不会被创建，与 SQLite 快照产生 parity 差异。去重由**应用层在通知自己的事务内**保证（写事务被序列化 —— SQLite `BEGIN IMMEDIATE`、MySQL 全局闸门行 → 事务内「先查后写」原子）。既有行 `dedupe_key` 为 NULL，不影响读取 |
| `type` 收敛 | 由自由文本收敛为受约束枚举。**不**加 CHECK 约束（既有表 ALTER 加 CHECK 在 SQLite 需重建表，会触碰既有行）—— 改为**服务端校验 + 新增 `category` 承载扩展语义**，`type` 只接受 `INFO` / `WARNING` / `SUCCESS` / `ERROR` 四个值，非法值在写入前被拒绝 |

新增表 `notification_subscriptions`：

| 表 | 关键列 | 约束 |
|---|---|---|
| `notification_subscriptions` | `id` PK、`user_id` FK users、`category`、`event_type`、`channel` CHECK(IN_APP)、`created_at` | UNIQUE(`user_id`,`category`,`event_type`,`channel`) |

#### 32.2.6 编号服务

| 表 | 关键列 | 约束 |
|---|---|---|
| `document_number_series` | `id` PK、`document_type`、`org_id` NOT NULL DEFAULT `''`、`prefix`、`suffix` NOT NULL DEFAULT `''`、`period_mode` CHECK(NONE/MONTH/YEAR)、`pad_length` INTEGER NOT NULL DEFAULT 5、`reset_rule`、`active` INTEGER NOT NULL DEFAULT 1、`created_at`、`updated_at` | UNIQUE(`document_type`,`org_id`) |

**既有两张表结构保持不变**（`document_sequences`、`document_number_allocations`）。组织维度通过 `period_key` 编码承载：
- 无组织分段：`period_key = '202611'`（与现状**完全一致**，既有单号不变）；
- 有组织分段：`period_key = 'ORG01:202611'`。

`voucher_sequences` / `voucher_words` 为死表（`server/migrations/extended-schema.js:22-26`、`:44-48`；`current_no` 从不递增），本轮**不动**，在代码注释与 Requirement 中登记为非权威。

#### 32.2.7 审计 schema 升级

`audit_logs`（`server/db.js:1584-1592`）**扩展**（ADD COLUMN，不重建、不改写任何历史行）：

| 变更 | 内容 |
|---|---|
| ADD COLUMN | `business_date` TEXT、`request_id` TEXT、`before_json` TEXT、`after_json` TEXT |
| 索引 | `ix_audit_logs_created_at`(`created_at`)、`ix_audit_logs_entity`(`entity_type`,`entity_id`) |

`audit()` 的签名扩展为**向后兼容**的可选参数：

```js
audit(db, userId, action, entityType, entityId, detail, extra = null)
// extra = { businessDate, requestId, before, after }   ← 全部可选，缺省写 NULL
```

**既有 8 个已冻结域的调用点一律不修改**（`extra` 缺省即 NULL，新列为空）。本域自身的新增审计调用点必须传 `businessDate` 与 `requestId`。

### 32.3 通用工作流引擎设计

#### 32.3.1 调用与数据流

```text
[业务单据提交]
      │
      ▼
resolveBinding(db, documentType, orgId, variables)      ← 按 §36.3.3 选唯一生效绑定
      │  无绑定且未显式豁免 → 409 PLATFORM_WORKFLOW_BINDING_NOT_FOUND
      ▼
startInstance(db, {templateId, versionId, documentType, documentId, orgId, variables, idempotencyKey})
      │  transaction:
      │    ① 重读绑定状态（权威状态重读）
      │    ② 重读版本状态（必须 PUBLISHED）
      │    ③ INSERT workflow_instances（idempotency_key UNIQUE → 冲突即返回既有实例）
      │    ④ 物化节点实例（definition_snapshot_json 固化）
      │    ⑤ 物化首批任务（入口节点参与人解析结果快照）
      │    ⑥ audit + workflow_events
      ▼
[任务完成] POST /api/platform/workflow-tasks/:id/complete
      │
      ▼
completeTask(db, taskId, actor, {action, comment, payload})
      │  transaction:
      │    ① 重读实例状态（必须 RUNNING）
      │    ② 重读任务状态（PENDING）+ row_version 乐观锁
      │    ③ assertSodCompliance(db, {businessType, businessId, action, actorId})
      │    ④ 任务状态迁移 + 节点实例迁移
      │    ⑤ 执行节点动作（FORM_WRITE / PUSH / CALLBACK）—— 同一事务，失败即整体回滚
      │    ⑥ 计算后继节点（条件求值）→ 物化下一批任务
      │    ⑦ audit + workflow_events
      │    ⑧ 若实例无后继 → 实例置 COMPLETED
      ▼
[通知] 事务 COMMIT 之后，独立事务写通知（失败只记日志，不影响审批结果）
```

#### 32.3.2 状态机

**流程模板版本**：`DRAFT` → `PUBLISHED` → `RETIRED`。
- `DRAFT → PUBLISHED`：校验节点图结构合法（无孤立节点、入口存在、无环 —— 条件分支允许环但必须有终止路径）、至少一个入口节点。
- `PUBLISHED → RETIRED`：停用；不影响已启动实例；不可再启动新实例。
- `PUBLISHED → DRAFT`：**禁止**（已发布版本不可变）。

**流程实例**：

```text
            ┌────────── suspend ──────────┐
            ▼                              │
RUNNING ──────────────► COMPLETED          │
   │  │  │                                  │
   │  │  └──────────► TERMINATED           │
   │  └─────────────► CANCELLED            │
   │                                        │
   └──────────► SUSPENDED ──── resume ─────┘
```

- `SUSPENDED` 只允许 `→ RUNNING`（恢复）。
- `TERMINATED` / `CANCELLED` / `COMPLETED` 为终态，不可再迁移。
- 终止时所有 `PENDING` 任务置 `CANCELLED`（**不产生任何业务副作用**）。

**节点实例**：`PENDING` → `ACTIVE` → `COMPLETED` / `SKIPPED` / `CANCELLED`。

**任务**：`PENDING` → `COMPLETED` / `CANCELLED` / `TRANSFERRED`。

#### 32.3.3 事务与幂等

- 启动实例的幂等键 = `document_type + ':' + document_id + ':' + version_id`；冲突时**返回既有实例**（`replayed: true`），不是 409。
- 任务完成用 `row_version` 乐观锁：`UPDATE ... SET row_version = row_version + 1 WHERE id=? AND status='PENDING' AND row_version=?`；影响行数为 0 → 409 `PLATFORM_WORKFLOW_TASK_CONFLICT`。
- 所有状态迁移前的**权威状态重读**：`workflow_instances.status` 与 `workflow_tasks.status` 必须在同一事务内重读后再判定。
- 任务完成与节点动作**同事务**；动作失败 → 整体 ROLLBACK，任务保持 `PENDING`，副作用为零。

#### 32.3.4 错误行为

| 错误码 | HTTP | 触发 |
|---|---|---|
| `PLATFORM_WORKFLOW_TEMPLATE_NOT_FOUND` | 404 | 模板 id 不存在 |
| `PLATFORM_WORKFLOW_VERSION_NOT_PUBLISHED` | 409 | 版本不是 `PUBLISHED` |
| `PLATFORM_WORKFLOW_DEFINITION_INVALID` | 422 | 节点图结构校验失败 |
| `PLATFORM_WORKFLOW_CONDITION_INVALID` | 422 | 条件字段 / 运算符不在白名单 |
| `PLATFORM_WORKFLOW_BINDING_NOT_FOUND` | 409 | 无生效绑定且未显式豁免 |
| `PLATFORM_WORKFLOW_BINDING_AMBIGUOUS` | 409 | 同一 (document_type, org_id) 存在多条生效绑定 |
| `PLATFORM_WORKFLOW_INSTANCE_NOT_FOUND` | 404 | 实例 id 不存在 |
| `PLATFORM_WORKFLOW_INSTANCE_STATE_INVALID` | 409 | 实例状态不允许该迁移（如已 TERMINATED） |
| `PLATFORM_WORKFLOW_TASK_NOT_FOUND` | 404 | 任务 id 不存在 |
| `PLATFORM_WORKFLOW_TASK_ALREADY_COMPLETED` | 409 | 任务已完成 / 已取消 |
| `PLATFORM_WORKFLOW_TASK_CONFLICT` | 409 | 乐观锁冲突（并发完成） |
| `PLATFORM_WORKFLOW_NODE_UNREACHABLE` | 422 | 动作目标节点不在实例快照中 |
| `PLATFORM_WORKFLOW_ACTION_FAILED` | 409 | 节点动作执行失败（事务已回滚） |
| `PLATFORM_WORKFLOW_PARTICIPANT_UNRESOLVED` | 409 | 审批节点解析不到参与人（失败即拒绝，见 §32.3.7 第 2 条） |
| `PLATFORM_WORKFLOW_TASK_NOT_ASSIGNED` | 403 | 操作人不是该任务的被指派参与人（见 §32.3.7 第 3 条） |
| `PLATFORM_WORKFLOW_SOD_REJECTED` | 409 | 职责分离规则拒绝本次操作（判定记录与审计在事务外补写，见 §32.4.2）。**引擎用自己的对外错误码**，不引用 `platform-sod.js` 的 `PLATFORM_SOD_RULE_VIOLATION` —— 消费方不得用生产方的错误码做自己的业务判断（XDC-01）；引擎改用**结构化判定载荷**（`error.sodOutcome`）决定证据落点 |

#### 32.3.5 审计

每个状态迁移写一条 `audit_logs`：`action` ∈ `WORKFLOW_TEMPLATE_CREATE` / `WORKFLOW_VERSION_PUBLISH` / `WORKFLOW_VERSION_RETIRE` / `WORKFLOW_BIND_ACTIVATE` / `WORKFLOW_INSTANCE_START` / `WORKFLOW_TASK_COMPLETE` / `WORKFLOW_INSTANCE_SUSPEND` / `WORKFLOW_INSTANCE_RESUME` / `WORKFLOW_INSTANCE_TERMINATE` / `WORKFLOW_INSTANCE_REDEPLOY`；`entity_type` ∈ `WORKFLOW_TEMPLATE` / `WORKFLOW_INSTANCE` / `WORKFLOW_TASK`。实例类审计必须带 `businessDate` 与 `requestId`。

#### 32.3.6 RBAC

| 权限码 | 用途 | 登记于 |
|---|---|---|
| `WORKFLOW_VIEW`（既有，`server/db.js:201`） | 读定义 / 版本 / 绑定 | 沿用 |
| `WORKFLOW_MANAGE`（既有，`:202`） | 写定义 / 版本 / 绑定 | 沿用 |
| `WORKFLOW_TASK_VIEW` | 读自己的任务 | **新增** |
| `WORKFLOW_TASK_ACT` | 完成任务 | **新增** |
| `WORKFLOW_INSTANCE_VIEW` | 读实例监控 | **新增** |
| `WORKFLOW_CONTROL` | 暂停 / 恢复 / 终止 | **新增** |
| `WORKFLOW_REDEPLOY` | 重新部署 | **新增**（与 `WORKFLOW_CONTROL` 分离，Requirement §36.3.8） |

新码登记在 `server/db.js:60` 的 `PERMISSIONS` 目录。`roles.js:68` 强制 ADMIN 保留全部权限 → 新码自动流向 ADMIN；**其它角色不自动获得**（fail closed），由管理员显式授予。

#### 32.3.7 实现期合同修正（2026-11-13，通用工作流引擎单元）

以下六条在引擎实现期由**真实代码事实**确定，均为本 Design 的收敛而非合同变更（Requirement §36.3 的能力范围不变）。

| # | 修正 | 依据 |
|---|---|---|
| 1 | **参与人类型白名单收窄为 `ROLE` / `USER` / `INITIATOR` / `FIELD_USER`**。`INITIATOR_MANAGER` **不可用**：本仓库 `users` 表没有部门归属，`departments.manager` 是自由文本且从未被查询使用 —— 没有权威的上级来源，不得凭空发明（AGENTS.md §6）。需要「发起人的上级」时，先建立用户↔部门归属，再把该类型加回白名单 | `server/db.js:1052` 的 `users` 表定义；`server/migrations/extended-schema.js:3-6`；`server/modules/extended.js:110`、`:119` |
| 2 | **审批节点解析不到参与人时失败即拒绝**（409 `PLATFORM_WORKFLOW_PARTICIPANT_UNRESOLVED`）。静默跳过审批是正确性事故；知会节点（`NOTIFY` / `CC`）无参与人时跳过节点，不阻塞流程 | Requirement §36.3.1「参与人解析规则必须物化」；AGENTS.md §6 fail closed |
| 3 | **只有被指派的参与人可以处理任务**（403 `PLATFORM_WORKFLOW_TASK_NOT_ASSIGNED`）。权限码只说明「可以做这类事」，不代表可以做**别人**的事 | §32.3.6 的权限语义 |
| 4 | **`row_version` 乐观锁是纵深防御**：写事务被闸门串行化（SQLite `BEGIN IMMEDIATE`；MySQL 全局闸门行），因此并发方的**真实可达**结果是「任务已被处理」（409 `PLATFORM_WORKFLOW_TASK_ALREADY_COMPLETED`）；`PLATFORM_WORKFLOW_TASK_CONFLICT` 是绕过闸门的写者才会触发的分支 | §32.3.3；`server/db.js:2453` 的 `transaction()` |
| 5 | **SOD 判定原语与引擎同批落地**：`server/modules/platform-sod.js` 提供 `evaluateSodCompliance` / `assertApprovalSod` 与 initiator resolver 注册表。§32.3.1 第③步要求引擎调用它，而 AGENTS.md §6 禁止同一原语出现第二份实现 → 判定原语必须先于引擎存在。**规则的维护面（CRUD）仍不在本单元**；**既有 6 族的接线已在本单元落地**（§32.4.6）。引擎**不得引用**该模块的错误码：它调用判定原语、读取**结构化判定结果**，并以自己的对外码 `PLATFORM_WORKFLOW_SOD_REJECTED` 表达拒绝 | §32.3.1 第③步；AGENTS.md §6；`docs/decisions/cross-domain-error-code-policy-20261112.md` |
| 6 | **SOD 规则一旦产生过判定记录即不可删除**：`sod_evaluations.rule_id` 的外键为 NO ACTION，判定记录是历史证据 → 规则只能**停用**（`status='INACTIVE'`），不能物理删除。规则的维护面必须只暴露停用，不暴露删除 | `server/migrations/platform-domain-schema.js` 的 `sod_evaluations` 定义 |

**API 路径前缀**：`/api/platform/workflow-templates` / `-versions` / `-bindings` / `-instances` / `-tasks` / `-test-runs`。
既有 `/api/approvals/**`（6 族 canonical）与 `/api/workflows/**`（退役中的旧流程 CRUD）**均不得**被通用引擎占用
（`server/mobile-approval-center.test.js:166` 锁定前者）。

**HTTP 层与领域层同名**：领域函数（`createWorkflowTemplate(db, {...})`）与 HTTP handler（`handleCreateWorkflowTemplate(db, req, res, actor)`）
**必须使用不同名字**，HTTP 层一律加 `handle` 前缀 —— 同一模块内同名导出会导致 ESM 重复声明而使整个模块无法加载。

### 32.4 SOD 引擎设计

#### 32.4.1 initiator resolver

6 个既有族的发起人列**统一为 `creator_id`**（`server/modules/approvals.js:18`、`:39`、`:60`、`:83`、`:104`、`:128` 的 `creator_id initiatorId`）。信用特批**表中无请求人列**，请求人存于 `audit_logs`（`server/modules/credit-special-approval.js:255-261` 经 `audit_id` 查 `action='REQUEST'` 行）。

| business_type | 来源 | initiator |
|---|---|---|
| `SALES_ORDER` | `sales_orders` | `creator_id` |
| `PURCHASE_ORDER` | `purchase_orders` | `creator_id` |
| `PURCHASE_REQUISITION` | `purchase_requisitions` | `creator_id` |
| `INVENTORY_CHECK` | `inventory_checks` | `creator_id` |
| `ACCOUNTING_VOUCHER` | `accounting_vouchers` | `creator_id` |
| `PRODUCTION_ORDER` | `production_orders` | `creator_id` |
| `CREDIT_SPECIAL_APPROVAL` | `credit_special_approval` | `audit_logs.user_id`（`action='REQUEST'`） |

resolver 是**注册表**（数据驱动），不是散落的 if。求值时在事务内**重读权威状态**（不得依赖请求方传入的发起人标识）。

#### 32.4.2 求值流程

```text
assertSodCompliance(db, { businessType, businessId, action, actorId })
  │
  ├─ 读取 sod_rules WHERE business_type=? AND action=? AND status='ACTIVE'
  │    → 无规则 → 记 sod_evaluations(decision='PASS') 并 return（**不改变任何既有行为**）
  │
  ├─ 对每条规则：
  │    SAME_PERSON_FORBIDDEN : initiator === actorId → 违规
  │    SAME_ROLE_FORBIDDEN   : initiator 的角色 ∩ actor 的角色 ≠ ∅ → 违规
  │    SAME_DEPARTMENT_FORBIDDEN: 两者部门相同 → 违规
  │    MIN_APPROVERS         : 已通过人数 < N → 违规（约束语义，Requirement §36.4）
  │                           但本轮 7 个决策点均为单步、不提供「已通过人数」→ 不可求值
  │                           → 维护面在创建时 fail closed 拒绝（§32.4.7）
  │
  ├─ resolution='REJECT'   → 409 PLATFORM_SOD_RULE_VIOLATION（写 sod_evaluations + audit）
  └─ resolution='ESCALATE' → 任务改派 escalate_to_role 的成员（写 sod_evaluations + audit）
```

#### 32.4.3 接线点（跨域调用点）

SOD 求值必须在**审批决策点**被调用。既有 6 族的决策点分布在 4 个业务域的模块与 2 处 `server/app.js` 内联 handler：

| 族 | 决策点 | 归属域 |
|---|---|---|
| `SALES_ORDER` | `server/modules/sales-orders.js:800 approveSalesOrder` | Sales & Customer |
| `PURCHASE_ORDER` | `server/app.js:5242-5246`（`changePurchaseOrderState` approve 分支） | Procurement & Outsourcing（内联于 app.js） |
| `PURCHASE_REQUISITION` | `server/modules/planning-documents.js:823 approvePurchaseRequisition` | Planning |
| `INVENTORY_CHECK` | `server/modules/inventory-stocktake.js:292 approveStocktake` | Inventory & Warehouse |
| `ACCOUNTING_VOUCHER` | `server/app.js:5960 approveAccountingVoucher` | Accounting & Analytics（内联于 app.js） |
| `PRODUCTION_ORDER` | `server/modules/manufacturing-orders.js:156 transitionOrder` 的 `target === 'APPROVED'` 分支 | Manufacturing & Quality |
| `CREDIT_SPECIAL_APPROVAL` | `server/modules/credit-special-approval.js:230 decideCreditSpecialApproval` | Sales & Customer |

**这 7 处是 Platform 域发起的、对 6 个业务域的有界变更**，必须在本 Design 中显式登记。每个调用点为**一行插入**（`assertSodCompliance(db, {...})`）。

**接线位置（2026-11-13 修正）**：SOD 调用必须置于**既有自审批防护之后**，**不得**作为前置闸门。原因：既有 5 族的自审批防护**状态码与文案各不相同**——

| 族 | 既有防护位置 | 状态码 | 文案 |
|---|---|---|---|
| `SALES_ORDER` | `server/modules/sales-orders.js:773`、`:838`、`:893`；`server/app.js:4971` | **409** | 创建人不能审批自己的订单 |
| `PURCHASE_ORDER` | `server/app.js:5244`、`:5249` | **409** | 创建人不能审核自己的订单 |
| `PURCHASE_REQUISITION` | `server/modules/planning-documents.js:830`、`:846` | **409** | 创建人不能审核自己的请购单 |
| `INVENTORY_CHECK` | `server/modules/inventory-stocktake.js:301` | **409** | 盘点单创建人不能审批自己的单据 |
| `ACCOUNTING_VOUCHER` | `server/app.js:5978-5981` | **403** | 不能审核自己录入的凭证 |

若引擎前置，它会以统一的 `409 PLATFORM_SOD_RULE_VIOLATION` **抢先**触发，从而改变既有族的**状态码**（凭证族 403 → 409）与**文案**，违反 Requirement §36.4「不改变既有行为」与本文件 §32.11 约束 #1。

**因此接线规则为**：

- 既有 5 族：调用点插在**既有防护之后**（既有防护先抛错并返回，引擎不执行）→ 状态码、文案、副作用**完全不变**；引擎在该族实际不参与判定，仅作为规则登记与求值留痕的旁路。
- `PRODUCTION_ORDER`：**没有**既有防护（`server/modules/manufacturing-orders.js:164-169`）→ 引擎在此唯一生效，补齐 `PL-DEF-01`。这一处**行为发生变化**（新增 409 `PLATFORM_SOD_RULE_VIOLATION`），属 Requirement §36.4 明确授权的增量。
- `CREDIT_SPECIAL_APPROVAL`：既有 `CREDIT_SPECIAL_APPROVAL_SOD`（`server/modules/credit-special-approval.js:255-261`）→ 置于其后，既有检查保留、状态码不变。

**既有防护一律不得删除**（引擎无规则时既有检查仍然生效，行为不变）。

**种子的规则**：为 7 个 business_type 各种一条 `SAME_PERSON_FORBIDDEN` / `REJECT` 规则（`action='APPROVE'`）。这使 5 个既有族的既有行为**完全不变**（引擎判定与既有检查同结论），并为生产订单族补齐缺口。

#### 32.4.4 权限与审计

| 权限码 | 用途 |
|---|---|
| `SOD_RULES_VIEW` | 读规则与求值记录 |
| `SOD_RULES_MANAGE` | 写规则、启用 / 停用 |

规则变更写 `audit_logs`（`action` ∈ `SOD_RULE_CREATE` / `SOD_RULE_UPDATE` / `SOD_RULE_DISABLE`，`entity_type='SOD_RULE'`）。每次求值写 `sod_evaluations`（含 PASS 与违规）。

#### 32.4.6 SOD 接线实施结果（2026-11-14）

既有 6 族 + 信用特批共 **7 个审批决策点**已接入 SOD 判定原语。接线位置严格遵循 §32.4.3：**既有自审批防护之后**接入，
既有族的状态码与文案**逐字不变**；生产工单族没有既有防护，由平台层唯一把关。

| # | 族 | 决策点 | 既有防护 | 接入后 |
|---|---|---|---|---|
| 1 | `SALES_ORDER` | `server/modules/sales-orders.js:838`（事务内） | 409 创建人不能审批自己的订单 | 既有防护先抛错；SOD 为第二层 |
| 2 | `PURCHASE_ORDER` | `server/app.js:5359` | 409 创建人不能审核自己的订单 | 同上 |
| 3 | `PURCHASE_REQUISITION` | `server/modules/planning-documents.js` 事务内 | 409 创建人不能审核自己的请购单 | 同上 |
| 4 | `INVENTORY_CHECK` | `server/modules/inventory-stocktake.js:301`（事务内） | 409 盘点单创建人不能审批自己的单据 | 同上 |
| 5 | `ACCOUNTING_VOUCHER` | `server/app.js:6096` | **403** 不能审核自己录入的凭证 | 同上 |
| 6 | `PRODUCTION_ORDER` | `server/modules/manufacturing-orders.js` 的 `APPROVED` 分支（事务内） | **无** | **平台层是唯一闸门（PL-DEF-01 闭合）** |
| 7 | `CREDIT_SPECIAL_APPROVAL` | `server/modules/credit-special-approval.js` 事务内 | 409 申请人与审批人必须分离 | 同上 |

**发起人解析**（§32.4.1 的映射表）：6 族统一为 `<表>.creator_id`；信用特批的请求人存于 `audit_logs`
（`action='REQUEST'`），由该族自己写入。

**种子规则只有一条**：生产工单族 `SAME_PERSON_FORBIDDEN` / `REJECT`。
其余 6 族**不设规则** —— 它们各自已有自审批防护，平台层不重复设规则，
因此既有族的**行为与数据量都不变**（不会为每次审批多写一行判定记录）。
其余族若将来需要 `SAME_ROLE` / `MIN_APPROVERS` 约束，由规则的维护面创建（§32.4.4，本单元之外）。

**`SAME_PERSON_FORBIDDEN` 在发起人解析不出来时失败即拒绝** —— 静默放行等于没有职责分离。

**跨域影响（必须登记，AGENTS.md §4.6）**：闭合 `PL-DEF-01` 改变了 **Manufacturing & Quality** 域的
生产工单审批行为 —— 该族此前允许创建者审批自己提交的工单。既有 M&Q 证据中有 **7 个测试文件**
（`app.test.js`、`manufacturing-quality-domain.test.js`、`manufacturing-stabilization.test.js`、
`phase-d-hfix.test.js`、`v13-phase4-production-integrity.test.js`、`v13-phase6c-manufacturing-execution.test.js`、
`v23-manufacturing-quality-closure.test.js`）依赖了这个漏洞。它们已改为**由非创建者审批**
（测试库内为 WAREHOUSE 角色追加 `PRODUCTION_ORDERS_APPROVE`，**不改动产品的种子角色模型**）。
M&Q 域既有验收记录的当前有效性须在 Platform 域级 Acceptance 轮按 §4.6 复核登记。

**待业务所有者裁定（`PL-DEC-04`）** → **已裁定（2026-11-14）：授予 `role-warehouse`**。
种子角色模型里 `PRODUCTION_ORDERS_APPROVE` 原先只授予 `ADMIN`；关闭自审批缺口后
**建单人与审批人必须不同**，否则默认部署下"管理员建的工单无人可批"。
仓库管理员本就持有 `PRODUCTION_ORDERS_VIEW` 与全部生产物料执行权限
（领料 / 退料 / 完工入库、`INVENTORY_TRANSFER_APPROVE`、`INVENTORY_CHECK_APPROVE`），
是最贴近的第二审批身份。`role-warehouse` 因此新增 `PRODUCTION_ORDERS_APPROVE`。
**这改变了 M&Q 域的角色合同** —— 其既有验收记录所依据的证据（`server/manufacturing-stabilization.test.js`
的"只有管理员拿到生产控制项"断言）须在 Platform 域级 Acceptance 轮按 §4.6 复核登记。

#### 32.4.7 SOD 规则维护面实施结果（2026-11-14）

规则维护面（CRUD + 族覆盖登记 + 求值记录 + 升级待办）已落地在
`server/modules/platform-sod.js`，路由前缀 `/api/platform/sod/*`，**纯 Platform 内部**，
不触任何业务域文件。

| 路由 | 权限 | 责任 |
|---|---|---|
| `GET /api/platform/sod/rules` | `SOD_RULES_VIEW` | 规则列表（按族 / 状态 / 动作过滤） |
| `POST /api/platform/sod/rules` | `SOD_RULES_MANAGE` | 创建规则 |
| `GET /api/platform/sod/rules/{id}` | `SOD_RULES_VIEW` | 规则详情 + 最近 50 条判定记录 |
| `PATCH /api/platform/sod/rules/{id}` | `SOD_RULES_MANAGE` | 更新约束 / 处置 / 升级角色 |
| `POST /api/platform/sod/rules/{id}/status` | `SOD_RULES_MANAGE` | 启用 / 停用 |
| `GET /api/platform/sod/coverage` | `SOD_RULES_VIEW` | 7 族覆盖登记 + 可创建集合声明 |
| `GET /api/platform/sod/evaluations` | `SOD_RULES_VIEW` | 判定记录 |
| `GET /api/platform/sod/escalations` | `SOD_RULES_VIEW` | 升级待办 |

**族覆盖登记不留空白**（Requirement §36.4）：`SOD_FAMILY_REGISTRY` 是 Platform 域对
「哪些审批族受 SOD 管辖」的唯一权威声明，与 §32.4.1 的 initiator resolver 一一对应。
每族的覆盖结论只有三种：`RULE_COVERED` / `NATIVE_GUARD`（显式登记为"该族无平台 SOD
约束，由既有自审批防护负责"）/ `UNCOVERED`（缺口，不允许出现）。

**可创建集合是收敛的**（业务所有者 2026-11-14 裁定）：维护面**只允许**创建
`SAME_PERSON_FORBIDDEN` / `SAME_ROLE_FORBIDDEN` + `REJECT` / `ESCALATE` + `APPROVE`
+ 已登记族。两种不可求值的约束在创建时 fail closed 被拒：

- `SAME_DEPARTMENT_FORBIDDEN` —— 用户与单据都没有部门维度，引擎按「求值失败即拒绝」
  处理，会把该族全部审批都拒掉；
- `MIN_APPROVERS` —— 7 个审批决策点都是单步审批，接线点不提供「已通过人数」，
  该约束永远不触发。

未接入的动作（`REJECT` / `RETURN`）与未登记的业务类型（如 `WORKFLOW_TASK`）同样被拒 ——
后者若放行，发起人解析不出来会按 fail-closed 拒绝该族全部审批。

**升级至上级在平台层落地**（业务所有者 2026-11-14 裁定）：6 个既有族的待办是实时计算的
（`server/modules/approvals.js:150`），没有任务行可改派；因此升级的载体是平台侧的
「升级待办」视图 —— 违规 actor 的决策被拒（409 `PLATFORM_SOD_ESCALATED`），升级记录在
**事务外**落库，`escalate_to_role` 角色的成员随后走该族**原有**审批入口完成决策。
升级角色成员对 `SAME_ROLE_FORBIDDEN` 豁免（否则升级角色与发起人同角色时死锁）。
默认无 `ESCALATE` 规则，既有族行为逐字不变。

**拒绝证据补齐**：此前 `REJECT` 在事务内抛错，回滚使 `sod_evaluations` 记录与审计行
一并消失，"为什么被拒"永远查不到。现由 HTTP 生命周期的中央 catch（`server/app.js`）
在回滚之后调用 `recordSodRejectionEvidence` 补写。通用工作流引擎有**自己**的事务外
留证路径（`recordTaskFailureEvidence`），其拒绝错误不置 `sodEvidenceRequired`，
因此不会被重复补写。

**残余**：

- 通用工作流任务的 SOD 归因未登记：引擎已按 `businessType='WORKFLOW_TASK'` 接线，
  但 initiator resolver 只覆盖 7 个族 → 该业务类型不可配置规则（fail closed）。
  随通用工作流引擎的工作面轮次立项。

**已消解的合同矛盾（业务所有者 2026-11-14 裁定）**：§32.4.2 的 `MIN_APPROVERS` 判定式
原文写作「已通过人数 < N → **不违规**」，与 `server/modules/platform-sod.js` 的实现
（`approvedCount < required` → 违规）方向相反。裁定：**以实现方向为 canonical** ——
「最小通过人数」的约束语义是「已通过人数 < N 即违规」（不达最小人数的决策必须被挡住）；
本轮不可创建的原因是**求值点不存在**（7 个决策点均为单步、不提供「已通过人数」），
而不是约束本身无效。§32.4.2 的判定式与 Requirement §36.4 已按该口径修订，
代码不变；一旦出现多审批决策点（如通用工作流引擎的会签节点），该约束即按该语义生效。

### 32.5 Organization Scope 设计

- **唯一 owner**：`server/modules/platform-organizations.js`。**不得**在 Master & Engineering 建立第二个组织模型（PL-DEC-02）。
- **与 `accounting_scopes` 的关系**：`accounting_scopes.org_scope` 是自由文本标签，其 `COSTING_SCOPE_OWNERS` 校验（`server/modules/accounting-inventory-cost.js:98-100`）**完全不动**。二者通过**显式映射表** `organization_scope_bindings` 关联：`accounting_scopes.code` ↔ `organization_scopes.scope_code`。
- **组织树防环**：写入 `parent_org_id` 前遍历父链，命中自身则 409 `PLATFORM_ORGANIZATION_CYCLE`。
- **与工作流绑定的关系**：`workflow_bindings.org_id` 引用 `organizations.id`；`''` 表示全局组织。
- **不做**向业务表铺开 `org_id`（Requirement §36.5）。
- **权限**：`ORGANIZATIONS_VIEW` / `ORGANIZATIONS_MANAGE` / `ORGANIZATION_SCOPE_MANAGE`（新增）。
- **审计**：`ORGANIZATION_CREATE` / `ORGANIZATION_UPDATE` / `ORGANIZATION_DISABLE` / `SCOPE_BIND` / `SCOPE_UNBIND`。

### 32.6 Attachment 设计

#### 32.6.1 HTTP 层

`server/lib/http.js` 新增 `readMultipart(req, { limitBytes, allowedTypes })`：

- 解析 `multipart/form-data`；逐 part 读取字段名、文件名、content type、内容缓冲；
- 累计大小超过 `limitBytes` → 413 `PLATFORM_ATTACHMENT_TOO_LARGE`；
- content type 不在 `allowedTypes` → 415 `PLATFORM_ATTACHMENT_TYPE_REJECTED`；
- **不得**引入任何第三方 multipart 依赖（仓库当前零运行时依赖的边界必须保持）—— 手写解析，边界规则取自 `boundary` 参数，**必须**处理 `\r\n` 前缀与末尾 `--boundary--`；
- `readJson` **一行不改**（既有 1 MB 上限与 415 行为完全不变）。

附件专用上限：默认 10 MB，由独立环境变量 `HTTP_ATTACHMENT_LIMIT_BYTES` 控制（合法区间 1 MB–50 MB），**不复用** `HTTP_JSON_LIMIT_BYTES`。

#### 32.6.2 存储与事务

内容寻址 → 写入顺序：

```text
1. readMultipart → 得到 { fileName, contentType, bytes }
2. 净化 fileName（去路径分隔符与控制字符，截断 255 字节）
3. 双重校验：content type ∈ allowedTypes 且 扩展名 ∈ allowedExtensions
4. sha256 = hash(bytes)
5. storage_key = sha256[0:2]/sha256[2:4]/sha256
6. 若目标文件不存在 → 写临时文件 → rename 到目标（rename 幂等）
7. transaction(db):
     INSERT attachments(...)
     若 owner_type='ACCOUNTING_VOUCHER' → UPDATE accounting_vouchers SET attachment_count = (派生计数)
     audit(...)
8. COMMIT 失败 → 删除本次新建的临时 / 孤儿文件（补偿）；已存在的同内容文件不删
```

文件写入在 DB 事务**之外**（文件系统与数据库无法原子），因此用**内容寻址**保证幂等：重复上传同一内容命中同一 `storage_key`，重复 rename 无副作用；孤儿文件可由存储巡检回收。

#### 32.6.3 下载授权

`GET /api/platform/attachments/:id/content`：

- 读取附件 → 解析 `owner_type` → 映射到**该业务对象既有的查看权限**（如 `ACCOUNTING_VOUCHER` → `VOUCHER_VIEW`；`SALES_ORDER` → `ORDERS_VIEW`；`PURCHASE_ORDER` → `PURCHASE_ORDERS_VIEW`；`PRODUCTION_ORDER` → `PRODUCTION_ORDERS_VIEW`；`PRODUCTION_INSPECTION` → `IQC_VIEW`/`OQC_VIEW`；`PURCHASE_REQUISITION` → `PURCHASE_REQUISITION_VIEW`；`SALES_QUOTATION` → `QUOTATION_VIEW`）。映射表在附件模块内**注册**，不得硬编码散落。
- 鉴权通过后从存储读文件，响应固定 `Content-Type` + `Content-Disposition: attachment; filename="<净化名>"`，**不内联**执行。
- 存储目录**不在** `public/` 下，静态服务不得暴露。

#### 32.6.4 权限与错误

| 权限码 | 用途 |
|---|---|
| `ATTACHMENTS_VIEW` | **平台级**查看权：可查看任意归属对象的附件 |
| `ATTACHMENTS_UPLOAD` | 上传 |
| `ATTACHMENTS_DELETE` | 删除（软删：写 `deleted_at`） |

> **读取权限继承归属对象（2026-11-14 修正）**：下载与列举**不**单独要求 `ATTACHMENTS_VIEW` ——
> 附件是业务对象的**子文档**：看不见单据就看不见它的附件。因此判定顺序是：
> 持有 `ATTACHMENTS_VIEW` → 放行（平台级）；否则按 §32.6.3 的**归属对象既有查看权限**判定。
> 上传与删除仍需 `ATTACHMENTS_UPLOAD` / `ATTACHMENTS_DELETE` 平台级权限，并额外要求对归属对象可读。
> 若沿用"下载必须有 `ATTACHMENTS_VIEW`"的写法，新权限码只在 ADMIN 手上（其它角色不自动获得），
> 附件能力对普通用户等于不可用 —— 这与 PL-DEC-04 暴露的是同一类问题。

错误码：`PLATFORM_ATTACHMENT_NOT_FOUND`(404) / `PLATFORM_ATTACHMENT_TYPE_REJECTED`(415) / `PLATFORM_ATTACHMENT_TOO_LARGE`(413) / `PLATFORM_ATTACHMENT_NAME_INVALID`(422) / `PLATFORM_ATTACHMENT_STORAGE_FAILED`(500) / `PLATFORM_ATTACHMENT_OWNER_FORBIDDEN`(403) / `PLATFORM_ATTACHMENT_OWNER_UNSUPPORTED`(422) / `PLATFORM_ATTACHMENT_EMPTY`(400)。

#### 32.6.5 实现期确定的三项事实

1. **存储根目录**：`ERP_ATTACHMENT_DIR` 显式配置（多进程 / MySQL 部署**必须**设置）→ 数据库文件同目录的
   `attachments/`（SQLite 单机默认，测试自动落在临时目录里）→ 仓库 `data/attachments`（兜底）。
   库文件路径由 `createSqliteDatabase` 记录在 `db.__erpDatabaseFile` 上。
2. **`Content-Disposition` 必须按 RFC 5987 编码**：HTTP 头只允许 latin1 —— 中文文件名直接写进
   `filename="…"` 会让 Node 抛 `ERR_INVALID_CHAR`（表现为 500）。实现给出 ASCII 回退名 +
   `filename*=UTF-8''` 百分号编码两种形式。
3. **类型白名单只判定一次**：content type 与扩展名的**双重**校验由附件模块统一执行，
   `readMultipart` 不重复判定 —— 否则拒绝码会来自两个地方、失去唯一性。

#### 32.6.6 附件前端挂载的实施结果（2026-11-14）

`src/components/AttachmentPanel.jsx` 已落地并挂载到**全部 7 个**登记挂载点
（业务所有者 2026-11-14 裁定「现在就做」）。面板是**平台自有**组件，不改动任何业务域的
数据模型、状态机或权限判定；服务端仍按 `ATTACHMENT_OWNER_PERMISSIONS` 做归属可见性判定。

| 归属类型 | 挂载位置 | 宿主页面 |
|---|---|---|
| `SALES_ORDER` | 销售订单详情（身份区之后、章节区之前） | `src/pages/master-data.jsx`（`SalesOrderDetailV16`） |
| `PURCHASE_ORDER` | 采购订单详情（操作记录之前） | `src/pages/master-data.jsx`（`OrderDocumentDetail`，`kind="purchase"`） |
| `ACCOUNTING_VOUCHER` | 凭证详情（分录表之后） | `src/pages/accounting.jsx`（`VoucherDetail`） |
| `PRODUCTION_ORDER` | 制令单详情（基本信息之后） | `src/pages/manufacturing.jsx`（`ProductionOrderModal`） |
| `PRODUCTION_INSPECTION` | 检验单详情（检验项之后） | `src/pages/manufacturing-quality.jsx`（`ProductionQuality`） |
| `PURCHASE_REQUISITION` | 请购单详情（明细之前） | `src/pages/planning-documents.jsx`（`PurchaseRequisitionDetail`） |
| `SALES_QUOTATION` | 销售报价详情（明细之后） | `src/pages/sales-batch-a.jsx`（`QuotationDetail`） |

**下载走鉴权后的 API**：面板用 `src/api.js` 的 `download()` 取 blob 后以 object URL 触发浏览器
下载 —— 附件目录不在静态服务范围内，不存在可直接访问的直链。

**上传走 multipart**：`src/api.js` 的 `api()` 新增 FormData 直通分支（此前所有 body 都被
JSON 序列化，multipart 会被破坏）。浏览器自行写 multipart 边界，客户端**不得**设置
`Content-Type`。

**浏览器实证（`scripts/acceptance/platform-workfaces-responsive-uat.mjs`）**：销售订单详情页
在 320 / 390 / 430 / 680 四档宽度下各跑一遍**完整链路** —— 上传（`text/plain` + `.txt`，
在服务端类型 / 扩展名双重白名单内）→ 面板列出附件行 → 删除 → 面板回到指名原因的显式空态；
API 轨迹为 `POST 201 → GET 200 → POST delete 200 → GET 200`。

**实施期修正**：销售订单详情的附件面板最初挂在**文档末尾**（操作记录之前）。该页的操作栏是
`position: fixed`（贴底），文档最后一段内容会被它盖住 —— 移动端因此点不到附件的删除按钮
（浏览器实证抓到：按钮被固定操作栏拦截）。面板改挂在身份区之后，删除按钮即可滚动到视口正中。

**跨域影响（AGENTS.md §4.6 登记）**：本单元在 **6 个已冻结域前端文件**中各插入一个面板
（Sales & Customer ×2、Manufacturing & Quality、Accounting & Analytics、Planning、
Manufacturing & Quality、Procurement & Outsourcing）。插入是**纯附加**的渲染节点，
不改动任何既有结构、状态机、权限或 API —— 但这些域的验收证据当前有效性须在 Platform 域级
Acceptance 轮复核登记。

**页面级观察（不判定，属该业务域自己的 UAT）**：销售订单详情页的「查看业务流程 ›」可点击
目标高度为 36 CSS px，低于 44 px 的触控下限。这是该页**既有**的问题（不是本单元引入），
已在本 UAT 中打印留痕，由 Sales & Customer 域自己的 UAT 负责。

### 32.7 Notification 设计

#### 32.7.1 生产者编排

新增 `server/modules/platform-notification-producers.js`（或并入 `platform-notifications.js`，二者择一，见 §32.7.4）导出：

```js
notifyEvent(db, { eventType, category, recipients, title, content, priority, actionUrl, dedupeKey, businessDate, requestId })
```

- `recipients`：`{ type: 'USER' | 'ROLE' | 'SUBSCRIBERS', value }[]`；展开为用户 id 集合。
- **去重**：`dedupe_key` 与 `user_id` 组成唯一键；重复事件**不重复产生**（`INSERT ... ON CONFLICT DO NOTHING`）。
- **写入时机**：**在业务事务 COMMIT 之后**，由调用方显式触发，独立 `transaction()`。
- **失败处理**：捕获并记录（`logger`），**绝不**向上抛 —— 通知失败不得使审批失败（Requirement §36.7）。

#### 32.7.2 六类生产者与接线点

| # | 事件 | 触发点 | 接收人 |
|---|---|---|---|
| 1 | 通用工作流任务生成 | `platform-workflow-engine.js` 物化任务后（事务 COMMIT 后） | 任务参与人 |
| 2 | 通用工作流任务完成 / 驳回 / 退回 | 同上 | 发起人 + 抄送人 |
| 3 | 通用工作流实例终止 / 恢复 | 同上 | 发起人 + 参与人 |
| 4 | 既有 6 族审批待办 / 结果 | 6 个决策点（§32.4.3）事务 COMMIT 后 | 审批人 / 发起人 |
| 5 | 信用特批待决 / 裁定 | `credit-special-approval.js:152`、`:230` | 审批角色 / 申请人 |
| 6 | 库存月结阻塞项 | `server/modules/inventory-period-close.js:254 runInventoryCloseChecks` 产出 `BLOCKING` 项后 | 库存与财务角色 |

**第 4、5、6 类是跨域接线**（Sales / Planning / Inventory / Manufacturing / Accounting / Procurement + Inventory），每个接线点**一行调用**，且**在业务事务之外**。

#### 32.7.3 权限与徽标

- 新增 `NOTIFICATION_VIEW` / `NOTIFICATION_MANAGE`。
- **既有接口不再使用 `DASHBOARD_VIEW`**（Requirement §36.7）。兼容处置：迁移为**所有当前持有 `DASHBOARD_VIEW` 的角色**补授 `NOTIFICATION_VIEW`（幂等、数据驱动地读 `role_permissions` 补写），之后接口只认 `NOTIFICATION_VIEW`。
- `src/App.jsx:186` 的 `tabBadges` 增加 `workflowTasks` 与 `messages` 两个键；`messages` 的未读数来自 `GET /api/notifications` 的 `unreadCount`。
- 列表与计数**同源同条件**：`unreadCount` 与列表使用同一 WHERE（`user_id = actor.id`），列表**不做 `LIMIT 50` 截断**导致与计数不一致 —— 改为分页（`limit` + `offset`），未读数仍为全量未读计数，接口同时返回 `total`。

#### 32.7.4 归属

`platform-notifications.js` **既有 16 行扩展**为通知读取 + 已读 + 生产者编排（单一模块，避免两个模块各写一半通知职责）。§32.7.2 的六类生产者是**调用方**，不是通知模块的一部分。

#### 32.7.5 实现期确定的四项事实（2026-11-14）

1. **`notifications` 需要 `event_type` 列**：消费侧必须能区分「待办 / 结果 / 阻塞 / 知会」，
   不能靠解析标题（标题含单号，会变）。已由迁移补列，既有表**只加普通列**（不加唯一索引）。
2. **通知写入是自提交，不包在显式事务里**。两个理由：
   - 通知失败不得牵连业务结果；自带事务会在业务事务**之后**多开一次 `BEGIN`，
     干扰既有域对"业务事务开启次数"的既有断言（销售订单提交重试契约按 `BEGIN` 次数断言
     "第二次外层尝试只在重新发现之后开启"）；
   - 多接收人之间不具备原子性是可接受的 —— 收件人 B 失败不应抹掉收件人 A 已收到的通知。
   去重的并发风险由业务侧承担：产生同一通知的业务事件本身已被业务事务串行化。
3. **通知必须在业务事务提交之后产生**，且它读取的字段（`check` / `row` / `approvalId`）
   是**事务回调内的局部变量** —— 在事务外必须**重新读取**，否则会抛 `ReferenceError`。
4. **读接口权限从 `DASHBOARD_VIEW` 改为 `NOTIFICATION_VIEW`**
   （仪表盘可见 ≠ 通知可见）。前端路由登记表同步改为 `NOTIFICATION_VIEW`，
   否则会出现"页面可见但接口 403"。

### 32.8 Numbering 服务设计

#### 32.8.1 服务接口

```js
allocateDocumentNumber(db, {
  documentType,      // 'SI' / 'PB' / 'SCN' / 'PCN' / 'OB' / 'PO' / ...
  businessDate,      // ISO 日期；决定 period_key
  orgId,             // '' = 无组织分段
  idempotencyKey,    // 必填
  prefix,            // 可选；缺省取 document_number_series
  suffix, periodMode, padLength  // 可选覆盖
}) → { documentNo, replayed }
```

#### 32.8.2 分配算法（原子 + 幂等）

```text
transaction(db):
  ① 幂等重放：SELECT document_no FROM document_number_allocations WHERE idempotency_key=?
       → 命中 → 返回既有单号，replayed=true（**不返回 409**）
  ② 解析规则：document_number_series WHERE document_type=? AND org_id=? AND active=1
       → 无规则 → 409 PLATFORM_NUMBER_RULE_NOT_FOUND
  ③ 计算 period_key：NONE → 'X'；MONTH → 'YYYYMM'；YEAR → 'YYYY'
       有组织分段 → `${orgId}:${periodKey}`
  ④ 原子取号：
       INSERT INTO document_sequences(document_type, period_key, next_value) VALUES(?,?,2)
       ON CONFLICT(document_type, period_key) DO UPDATE SET next_value = next_value + 1
       RETURNING next_value - 1 AS allocated
  ⑤ 渲染单号：prefix + periodPart + padStart(padLength,'0') + suffix
       （无组织分段时 periodPart = 'YYYYMM'；有组织分段时 **不**把 orgId 编进单号文本，
         组织维度只体现在 period_key —— 避免改变既有单号文本）
  ⑥ INSERT INTO document_number_allocations(idempotency_key, document_type, document_no, created_at)
       → 单号 UNIQUE 冲突 → 409 PLATFORM_NUMBER_CONFLICT
  ⑦ RETURNING 单号
```

**幂等竞态修复（`PL-DEF-12`）**：步骤 ① 与 ⑥ 之间存在窗口。修复方式：把 ⑥ 放在**同一事务**内，并对 `idempotency_key` 的插入冲突做**重读返回**而非 409：

```text
  ⑥ try INSERT ... → 冲突（PK idempotency_key）
       → catch → SELECT document_no WHERE idempotency_key=? → 返回该号，replayed=true
```

同事务内 SQLite 的写锁保证不会看到未提交行；MySQL 侧由 `transaction()` 的全局闸门行保证跨表串行化。

**MySQL 等价实现**：`server/database/mysql-adapter.js:78-80` 已把该 SQL 拦截为 `allocateSequence` action，由 `server/database/mysql-worker.js:138-151` 执行 `INSERT ... ON DUPLICATE KEY UPDATE next_value = next_value + 1` 后**另发一条 SELECT**。**该分离 SELECT 是竞态窗口**（`PL-OPEN-04`）。修复：worker 侧改为**单语句**返回分配值（`INSERT ... ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1)` 后 `SELECT LAST_INSERT_ID()`，或直接用 `RETURNING` —— MySQL 8.0.37 支持 `INSERT ... RETURNING`? 不支持；用 `LAST_INSERT_ID` 技巧），保证两库**行为等价**。

#### 32.8.3 既有 6 种单据的迁移

`SI` / `PB` / `SCN` / `PCN` / `OB` / `PO` 改由服务发放，**单号格式不变**：

| documentType | 现状前缀 | 规则 | periodMode | padLength | 单号示例 |
|---|---|---|---|---|---|
| `SI` | `SI` | 销售发票 | MONTH | 5 | `SI-202611-00001` |
| `PB` | `PB` | 供应商账单 | MONTH | 5 | `PB-202611-00001` |
| `SCN` | `SCN` | 销售红字 | MONTH | 5 | `SCN-202611-00001` |
| `PCN` | `PCN` | 采购红字 | MONTH | 5 | `PCN-202611-00001` |
| `OB` | `OB` | 期初批次 | MONTH | 5 | `OB-202611-00001` |
| `PO` | `PO` | 采购订单 | MONTH | 5 | `PO-202611-00001` |

⚠ 现状格式为 `${documentType}-${period}-${padStart(5)}`，其中 `period = String(businessDate).slice(0,7).replace('-','')` = `YYYYMM`。服务渲染必须**逐字符一致**。

**事务内分配（`PL-DEF-11`）**：采购订单路径现状是 `server/app.js:5127` 分配、`:5134` 才开启事务 → 孤儿号。修复：把分配调用**移入** `transaction()` 内（与单据写入同一事务）。其余 5 种已在事务内（`commercial-glive.js:119`、`:278`、`:383`、`:668`）。

**采购申请号（`PL-DEF-13`）**：`server/modules/planning-documents.js:85-92` 的 `PREQ-${YYYYMMDD}-${COUNT(*)+1}` 改为服务发放，新增规则 `PRQ` / `MONTH` / 5 位（格式 `PRQ-202611-00001`）。**这会改变采购申请单号格式** —— 属 Requirement §36.8 明确授权的缺陷修复；需在 Planning 域的验收复核中登记。

**13 种以上未覆盖单据的迁移** → `OUT_OF_SCOPE`（Requirement §36.8），但编号规则工作面必须能**看到待迁移清单**（数据驱动：`document_number_series` 有规则 vs 各单据造号位置的映射清单）。

#### 32.8.4 权限与审计

`NUMBERING_VIEW` / `NUMBERING_MANAGE`（新增）。规则变更写 `audit_logs`（`NUMBERING_RULE_CREATE` / `NUMBERING_RULE_UPDATE` / `NUMBERING_RULE_DISABLE`）。取号本身**不写** `audit_logs`（高频路径，避免审计表膨胀），但**分配失败**（409）走 `auditBusinessRejection`。

#### 32.8.1 实现期确定的六项事实（2026-11-14）

1. **渲染形态必须逐字符复现既有实现**：既有形态是 `${TYPE}-${YYYYMM}-${00000}` ——
   期间段与补零段**之间有短横线**。第一版漏了它，产出了 `SI-20990100001`。
2. **`period_key` 在无组织维度时必须仍是 `YYYYMM`**（否则号段会断在旧数据上）；
   有组织维度时为 `ORG-9:YYYYMM`。组织维度**不编进单号文本**。
3. **分配在调用方事务内内联执行**（`db.isTransaction`），不另开事务 ——
   否则分配与单据写入不同生共死，单据事务回滚会留下孤儿号（`PL-DEF-11`）。
   通用采购订单接口的编号分配已移入其单据事务。
4. **幂等必须原子**（`PL-DEF-12`）：先查后写在同一事务内；插入冲突时**重读返回同一单号**，
   而不是 409。同号段由 `document_number_allocations` 的 UNIQUE 约束兜底。
5. **请购单号格式变更**：`PREQ-${YYYYMMDD}-${COUNT(*)+1}` → `PRQ-${YYYYMM}-${00001}`（`PL-DEF-13`）。
   已核实**无任何生产代码解析该格式**（其余命中均为字面量夹具），格式变更安全。
6. **同类缺陷的残余**：生产指令 `PI` 与采购指令 `PUI` 仍用 `makeCode` 的 `COUNT(*)+1`
   —— 与 `PL-DEF-13` 同缺陷类，但**不在本单元批准范围**（它们属 Planning 域的其它单据族），
   登记为待迁移清单项。

### 32.9 Audit schema 升级设计

- `server/lib/audit.js` 的 `audit()` 增加第 7 个**可选**参数 `extra`（§32.2.7）。既有调用点**一行不改**。
- `business_date` 由调用方传入；平台自身的新增审计调用点必须传。
- `request_id` 取自 HTTP 请求的 `x-request-id` 头或 `idempotency-key`；无则留空。
- `before_json` / `after_json`：由调用方提供**已存在的权威快照**，引擎不自动 diff（避免在事务内做无界读取）。**本轮只有平台自身的 mutation 提供 before/after**；其余 8 域留空（向后兼容）。
- 迁移：`ALTER TABLE audit_logs ADD COLUMN ...`（SQLite 与 MySQL 双分支），并 `CREATE INDEX`。**不改写任何历史行**。
- `auditBusinessRejection` 的测试覆盖（`PL-DEF-06`）：正例（409 → 写入拒绝审计）与反例（非 409 → 不写）。

**2026-11-13 补充 —— 对既有 parity 门禁与摘要机制的影响（`PL-OPEN-01` 预验证结论）**：

1. **列集合被比较**：schema parity 比较器 `compareTableParity`（`server/test-utils/m1-core-schema-parity.js:766-770`）比较 SQLite 快照与实时 MySQL 目录的**列集合、列序、可空性、默认值、索引与 CHECK**。`audit_logs` 在三个已批准 campaign 的表清单内（`server/test-utils/mysql-out001-target.js:34`、`server/test-utils/wave10-mysql-acceptance-fixture.js:672`）→ **新增的 4 列必须同时出现在 SQLite 与 MySQL 两侧**，否则三个 campaign 的 Schema Parity 会判 `COLUMN_MISSING` / `COLUMN_SEQUENCE`。
   - 全新 disposable MySQL：由 `bootstrapMySql`（`server/database/mysql-schema.js:459`）从 SQLite 快照派生 → 两侧同源，自动一致。
   - 既有 MySQL 库：必须走 `planMySqlAdditiveReconciliation`（`:374`）与 `planMySqlIndexReconciliation`（`:389`）的显式分支 → 迁移文件的 MySQL 分支不可省。
2. **既有测试不依赖列集合**：全仓库 `audit_logs` 断言一律为 `COUNT(*)` 或 `SELECT *` + 既有字段读取（`accounting-analytics-w1-w2.test.js:174`、`:175`；`accounting-analytics-w3.test.js:537`；`accounting-analytics-w7.test.js:256`；`business-integrity-stabilization.test.js:266`、`:274`；`buyers.test.js:25`；`m1c-outsourcing-gl-policy-guard.test.js:69`、`:192`；`m1c-processing-po.test.js:57`、`:63`、`:145`、`:156`、`:322`、`:326`、`:328`、`:343`；`inventory-demo-seed-position-identity.test.js:250`、`:462`）。**无一处断言列集合或列数** → 新增可空列不改变任何既有断言的结果。
3. **数据库摘要会改变，但既有断言不因此失效**：`databaseSnapshot`（`server/test-utils/wave11-a-credit-query-fixture.js:181-196`）枚举**全部**基表并对每表算摘要。→ ① `audit_logs` 的摘要会因新增列而改变；② **本域 17 张新表会进入每一个域的摘要**。但全部既有摘要断言都是**同一数据库实例内的 before/after 比较**（`sales-customer-wave11-a-credit-query.test.js:180-182`、`:388-401`；`sales-customer-wave11-a-overdue-evidence.test.js:168-178`；`sales-customer-wave11-a-search-semantics.test.js:381-385`、`:614-620`；`sales-customer-wave11-a-credit-query-ui.test.js:199-202`），两侧同 schema → 仍然相等。**已冻结的验收记录不钉死任何数据库摘要或表计数**（唯一出现的 `tables=0` 是 campaign 后 disposable 库清空证明，非 schema 固定值）→ 新增表与新增列**不使任何已签发结论失效**。
4. **受影响的只有测试计数**：各域已签发记录中的 `FULL 3881/3881`、`FAST 638/638` 等计数会因新增测试文件而变。这是**冻结时点的快照值**，不是能力结论；按 AGENTS.md §4.6，其结论有效性不受影响，只需在 Acceptance 轮登记计数变化。

**结论**：`PL-OPEN-01` 的真实风险不在 8 个已冻结域的断言，而在**三个 campaign 的 Schema Parity**。处置见 §32.2.7 第 1 项（双侧同批）与 §32.12.1 的 parity 门禁条目。

### 32.10 既有能力封顶的具体改动

| 能力 | 改动 | 文件 |
|---|---|---|
| PL-01 | `PERMISSIONS` 新增 §32.3.6 / §32.4.4 / §32.5 / §32.6.4 / §32.7.3 / §32.8.4 列出的权限码 | `server/db.js:60` |
| PL-05 | 无代码改动；新增工作流任务工作面与**独立**徽标；`applicationRegistry.js` 退役 `workflows` | `src/navigation/applicationRegistry.js` |
| PL-06 | 新增 operator 工作面（生命周期记录 / 归档 / 恢复 / 清理）；`PL-DEF-04` 的权限专化 → 新增 `LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE`，`USERS_MANAGE` 保留为兼容别名 | `server/modules/lifecycle-engine.js`、`src/pages/platform-lifecycle.jsx` |
| PL-12 | §32.2.7 的 ALTER + `audit()` 可选参数 | `server/lib/audit.js`、`server/migrations/platform-domain-schema.js` |
| PL-13 | 无代码改动；`PL-DEF-08` / `PL-DEF-09` 登记为显式残余 | — |

#### 32.10.1 PL-06 的实施结果（2026-11-14，域级 Acceptance 前补齐）

本节登记 PL-06 的落地事实 —— 它是本 Design §32.10 明确要求、但在本轮验收前
尚未实施的一项（域级审计把它判为 `PARTIAL`）。

| 项 | 内容 |
|---|---|
| 权限专化 | 新增 `LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE`（权限目录 264 → **266**）。`server/modules/lifecycle-engine.js` 的 **7 处**权限判定全部改为 `allowAny(actor, ['LIFECYCLE_VIEW', 'USERS_MANAGE'])` / `allowAny(actor, ['LIFECYCLE_MANAGE', 'USERS_MANAGE'])`；`USERS_MANAGE` 保留为**兼容别名**，既有管理员不受影响 |
| operator 工作面 | `src/pages/platform-lifecycle.jsx`（由原停用路由的 `src/pages/data-cleanup.jsx` 迁移而来）：生命周期记录 / 清理审计 / 依赖分析 / 归档 / 恢复 / 清理，屏根 `platform-lifecycle-page`；读写动作按 `canView` / `canManage` 分权 |
| 路由 | `lifecycle`（启用，权限 `LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE`，`mobileExposure: system-settings`）；停用路由 `data-cleanup` 退役（其页面已迁移） |
| 合同测试 | `server/platform-lifecycle.test.js`（8 例，已登记 FAST / FULL）：权限目录登记、引擎不再裸用 `USERS_MANAGE`、只读主体可读不可写、管理主体可写、无权主体 403、别名仍然有效、工作面可达 |
| 跨域影响 | 停用路由集合由 3 条变为 2 条，**13 个既有冻结域前端合同测试文件**的路由清单事实（85 → **93** 条启用路由、4 → **2** 条停用路由）随之同步；断言强度未降低，只更新事实数字与名单。`server/v12-lifecycle-product.test.js` 的「data-cleanup 路由以 USERS_MANAGE 挂载且不进启动器」一条改写为「lifecycle 路由以专用权限码挂载且不进启动器」 |

**PL-06 的残余（封顶，不阻塞本域冻结）**：关系图仍是 30+ 处硬编码分支、25 个实体中
只有 `PURCHASE_RECEIPT` 可归档 —— 通用关系注册表与全实体可归档已由 Requirement §36.13
判为 `OUT_OF_SCOPE`（延期理由与重启条件已登记）。

### 32.11 兼容性与回归约束

| # | 约束 | 验证方式 |
|---|---|---|
| 1 | 既有 6 族的审批结果、有序待办、计数、徽标**完全不变** | `server/mobile-approval-center.test.js`（78 用例）全绿；新增"引擎上线前后待办序列一致"断言 |
| 2 | `/api/approvals/…` 下**不得**新增变更方法 | `server/mobile-approval-center.test.js:166` 保持为绿 |
| 3 | 既有 6 种单据的单号格式**逐字符不变** | 新增断言：服务渲染结果 == 旧格式串 |
| 4 | `audit()` 既有调用点行为不变 | 8 个已冻结域的审计断言全绿 |
| 5 | `readJson` 行为不变（1 MB 上限、415） | 既有 HTTP 契约测试全绿 |
| 6 | `notifications` 既有行不被改写 | 迁移后既有行 `dedupe_key` 为 NULL、可读、计数不变 |
| 7 | `accounting_scopes` 的 `COSTING_SCOPE_OWNERS` 校验语义不变 | Accounting & Analytics 既有测试全绿 |
| 8 | `approval_workflows` 表**保留不删**；`/api/workflows` 退役为 410 | 新增断言；`server/teacher-acceptance-matrix.test.js:285`、`:873` 的 smoke 断言改为 410 |
| 9 | `voucher_sequences` / `voucher_words` 不动 | Accounting & Analytics 既有测试全绿 |
| 10 | `production_orders` / `sales_orders` 等 6 张既有表的**结构不变** | schema parity 断言 |
| 11 | **`audit_logs` 新增 4 列必须 SQLite 与 MySQL 双侧同批落地** —— `compareTableParity` 比较列集合与列序（`server/test-utils/m1-core-schema-parity.js:766-770`），且 `audit_logs` 在三个已批准 campaign 的表清单内 | 三个 campaign 的 Schema Parity 全部 PASS |
| 12 | **既有 6 族自审批防护的状态码与文案逐字不变**（4 族 409 + 凭证族 403 + 5 种不同文案）—— SOD 调用置于既有防护**之后** | 5 个族的自审批断言状态码与文案逐字比对 |
| 13 | 既有**数据库摘要**断言（before/after）保持相等 —— 新表与新列进入摘要但两侧同 schema | 各域 `databaseDigest` 断言全绿 |

### 32.12 测试计划

#### 32.12.1 新增测试文件（必须登记 `scripts/testing/test-suites.js`）

| 文件 | 归属套件 | 覆盖 |
|---|---|---|
| `server/platform-workflow-engine.test.js` | FAST + FULL | 定义 / 版本 / 绑定 / 实例 / 任务 / 动作 / 监控 / 暂停恢复终止重新部署；幂等启动；并发完成冲突；条件求值白名单 |
| `server/platform-sod.test.js` | FAST + FULL | 7 个 business_type 的 initiator resolver；生产订单自审批被拒；无规则命中行为不变；规则变更审计 |
| `server/platform-organizations.test.js` | FAST + FULL | 组织 CRUD / 防环 / 层级 / 作用域绑定 / `accounting_scopes` 映射 |
| `server/platform-attachments.test.js` | FAST + FULL | 上传 / 下载 / 删除 / 计数派生；类型与扩展名双重拒绝；超限 413；鉴权 403；multipart 边界解析 |
| `server/platform-notifications.test.js` | FAST + FULL | 六类生产者各一例；去重；未读计数与列表同源；通知失败不影响审批 |
| `server/platform-numbering.test.js` | FAST + FULL | 既有 6 种单号格式不变；并发同幂等键返回同号；事务内分配；PRQ 号删除后不冲突 |
| `server/platform-audit-upgrade.test.js` | FAST + FULL | 新列写入；既有调用点不传新参数仍为绿；`auditBusinessRejection` 正例 + 反例；历史行未改写 |
| `server/platform-domain-schema-parity.test.js` | HEAVY | SQLite / MySQL 表目录、列、索引、约束对等；**必须包含 `audit_logs` 的 4 个新列** |
| `server/platform-frozen-domain-regression.test.js` | FAST + FULL | **跨域回归专项**：① 5 个既有族的自审批拒绝**状态码与文案逐字比对**（409×4 + 403×1）；② 既有 `audit_logs` 断言全绿；③ 既有 `databaseDigest` before/after 断言全绿；④ 既有 6 族审批结果与待办序列不变 |

**MySQL 专属 campaign**：新增 `server/mysql-platform-domain.integration.js`，受保护 disposable MySQL 8.0.37 上跑：工作流实例并发启动、任务并发完成、编号并发取号、附件上传下载、SOD 并发求值。ACK-4 清单须新增本域 campaign（受保护入口限制见 `docs/decisions/mysql-evidence-policy-20261112.md`，本仓库只有三个已批准 ACK-4 campaign 可运行）。

#### 32.12.2 前端与浏览器

- 7 个新页面 + 通知页扩展 + 附件挂载组件。
- 移动优先：390 CSS px 基线，另验 320 / 430 / 680；核心任务不依赖永久横向滚动；可点目标 ≥ 44 px。
- **非空洞证据**：注入 token → reload → 断言目标屏真实渲染（`docs/audits/` 已记录的浏览器空洞教训）。
- **变异实验**：对关键断言做非空洞证明 —— 故意破坏一处实现，确认对应断言转红。

#### 32.12.3 门禁

`pnpm test:fast` → `pnpm test`（FULL）→ `pnpm test:heavy` → `pnpm build` → `git diff --check` → 真实 MySQL campaign → 浏览器 UAT。全部为绿方可进入 Acceptance。

#### 32.12.4 真实 MySQL campaign 的实施结果（2026-11-14）

Platform 域的专属 ACK-4 campaign 已建成。**Manifest 独立**（`PLATFORM_MYSQL_V1`，夹具操作名
`RUN_PLATFORM_RACES`），与既有七个域 campaign 互相独立、互不复用，运行期证据可唯一归属本域。

| 文件 | 责任 |
|---|---|
| `scripts/gates/ack4/ack4-runtime.mjs` | `PLATFORM_MYSQL_MANIFEST` 与 `PLATFORM_MYSQL_MANIFEST_NAME` |
| `scripts/gates/mysql-platform-gate.mjs` | root orchestrator：静态 preflight → 消费一次性 capability → 四个子进程 → 报告 |
| `scripts/gates/mysql-platform-child.mjs` | 子进程：`RESET_SCHEMA_PRE_RUN` / `BOOTSTRAP_CURRENT_SCHEMA` / `RUN_PLATFORM_RACES` / `CLEANUP_SCHEMA_POST_RUN` / 只读 postflight |
| `scripts/gates/mysql-platform-root-lifecycle.mjs` | root 生命周期（消费 → 重置 → 引导 → 夹具 → 清理 → 清理核验） |
| `scripts/gates/platform-domain-races-worker.mjs` | 竞态 worker：一个进程 = 一个独立 MySQL 会话 |
| `server/mysql-platform-domain-races.integration.js` | 四个场景 + 四个负控的实证套件 |

**四个场景（每个都带负控）**：

| # | 场景 | 负控 |
|---|---|---|
| S1 | 职责分离拒绝的**事务外证据**：发起人审批自己的生产工单被拒后，`sod_evaluations` 判定记录与 `audit_logs` 审计行**仍在**（事务回滚不得抹掉拒绝证据） | 另一个主体审批同一张工单**成功** —— 守卫不是无差别拒绝 |
| S2 | 编号服务幂等并发：同一幂等键并发取号返回**同一单号**，且只落一条分配记录（PL-DEF-12） | 不同幂等键拿到**不同**单号 —— 守卫不是永远返回同一个号 |
| S3 | 通知去重：同一去重键并发产生只落一条通知 | 不同去重键各落一条 —— 去重不是全部丢弃 |
| S4 | 平台 schema 形态：17 张平台新表 + `notifications` 6 个新列 + `audit_logs` 4 个新列在真实 MySQL 8 上存在 | （目录形态本身即断言） |

并发场景用**独立 worker 子进程** + **文件闸门**同时释放，两个竞争者在同一瞬间进入被争用的
代码路径 —— 竞态发生在真实 MySQL 8 服务器上，而不是同一事件循环里的同步调用交错。

**登记点**：`scripts/gates/run-mysql-local-gate.ps1` 的 `$ApprovedCampaigns` 增加
`'test:mysql:platform' = 'PLATFORM_MYSQL_V1'`；`package.json` 增加 `test:mysql:platform`；
`server/test-utils/temp-db.js` 的 `assertActivePortableChildOperation` 增加
`RUN_PLATFORM_RACES`（该名单按 campaign 绑定，不扩宽任何其它 campaign 的作用域）。

**实施期修正**：`run-mysql-local-gate.ps1` 原本**没有 UTF-8 BOM**，而文件含中文与 `§` ——
Windows PowerShell 5.1 会按 ANSI 读取它（`MissingEndParenthesisInFunctionParameterList` 一类
解析错误）。本次补上 BOM。

**离线校验**：`node --test server/mysql-platform-domain-races.integration.js` 在 SQLite 上
**8/8 PASS** —— 只证明夹具与断言自洽，**不是**真实 MySQL 证据；真实证据以 campaign 运行
结果为准。

**真实 MySQL 运行结果（2026-11-14）**：**PASS**。

| 项 | 值 |
|---|---|
| runId | `74b20bd2-b357-43cf-a62f-55ef721896f8` |
| commitSha | `a7def68b110a1c517c1270152417d8c79cdf5e47` |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL **8.0.37**，serverUuid `256c7a4e-d275-11f1-885b-b025aa71d167`，grants sha256 `bef61617…807e`） |
| 启动器结论 | `RESULT = PASS`；`ACK-4 STATE = FINISHED (cleanup independently post-flighted by the root)` |
| 已消费操作 | `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_PLATFORM_RACES` → `CLEANUP_SCHEMA_POST_RUN`（四项均在 manifest `PLATFORM_MYSQL_V1` 下原子消费） |
| 运行前目标状态 | 只读 preflight：`tables=0 views=0 triggers=0 routines=0 events=0`，身份与基线**无漂移** |
| 运行后目标状态 | 只读 preflight 复核：`tables=0 views=0 triggers=0 routines=0 events=0` —— 清理被独立 post-flight 证明 |
| 套件 | `server/mysql-platform-domain-races.integration.js`：4 个场景 + 4 个负控，全部在真实 MySQL 8 上通过 |

该运行证明：平台层 17 张新表与 `notifications` / `audit_logs` 的加列被真实 MySQL 8 接受；
职责分离拒绝的**事务外证据**在真实 MySQL 的事务回滚后仍然留痕；编号服务的幂等并发在真实
MySQL 上返回同一单号（PL-DEF-12）；通知去重在真实 MySQL 上只落一条。

### 32.13 回滚策略

| 变更 | 回滚 |
|---|---|
| 新增表（工作流 / SOD / 组织 / 附件 / 编号规则 / 通知订阅 / 历史） | 可整体 DROP（仅限本域新建表）。**不得** DROP `approval_workflows` 等历史表 |
| `notifications` ALTER ADD COLUMN | **不回滚**。新增列对既有行为无害，保留 |
| `audit_logs` ALTER ADD COLUMN + 索引 | **不回滚**。保留列与索引；历史行不改写 |
| `attachments` 文件与 `accounting_vouchers.attachment_count` | 保留。已上传文件不删；计数列保留派生语义 |
| 权限码新增 | 保留。新码不被任何角色持有即等同未启用（ADMIN 例外） |
| `organizations` 数据 | 保留。组织注册表为纯新增，无业务表依赖 |
| 编号服务切换 | 单号格式**逐字符一致** → 切回旧调用点后既有单号继续有效，无数据迁移 |
| 既有 6 族接入 SOD | 引擎规则可**停用**（`sod_rules.status='INACTIVE'`）→ 立即回到既有行为；生产订单族的自审批防护**独立保留**（属缺陷修复，不随规则停用而消失） |
| 既有 6 族接入通知生产者 | 通知失败不影响业务；可停用订阅行 → 立即无通知 |
| `applicationRegistry.js` 退役 `workflows` | 回滚 = 恢复路由条目与旧页面（该页面已知有缺陷，恢复不等于推荐） |

### 32.14 未解决事项与 HARD STOP

| ID | 事项 | 状态 |
|---|---|---|
| `PL-D-OPEN-01` | MySQL `allocateSequence` 的分离 SELECT 竞态窗口的最终修法（`LAST_INSERT_ID` 技巧 vs 单语句 upsert） | 待 Implementation 定稿（Requirement §36.8 已约束"两库行为等价"） |
| `PL-D-OPEN-02` | 6 个业务域的 SOD 与通知接线点属**跨域代码变更**。**2026-11-13 预验证**：① SOD 若前置会改变 5 个既有族的自审批状态码与文案（凭证族 403 → 409），已改为置于既有防护**之后**（§32.4.3）；② 通知接线**不写** `audit_logs`、且当前无任何测试统计 `notifications` 行数 → 既有断言不受影响。剩余范围：各域域级 Acceptance 证据按 AGENTS.md §4.6 的复核登记 | **行为影响已消解**；仅余 Acceptance 轮复核登记 |
| `PL-D-OPEN-03` | 采购申请单号格式变更（`PREQ-YYYYMMDD-N` → `PRQ-YYYYMM-00001`）。**2026-11-13 预验证已关闭**：全仓库**无任何生产代码解析 `requisition_no` 格式**（`grep` 命中为空）—— `makeCode`（`server/modules/planning-documents.js:85-92`）是唯一生成点；其余命中（`server/uat-r6-procurement-batching.test.js:51`、`server/v12-lifecycle-cleanup.test.js:62`、`server/v12-lifecycle-foundation.test.js:61`、`scripts/acceptance/v161-procurement-batching.mjs:23`）均为**字面量夹具**，不依赖格式 | **已由证据关闭**；实施时保持夹具不变 |
| `PL-D-OPEN-04` | 通用工作流"业务回调"的允许域集合与调用契约（Requirement `PL-OPEN-03`） | 本 Design 定为"仅允许调用被调域已存在的 canonical HTTP API，注册式白名单"，具体名单在 Implementation 逐域登记 |
| `PL-D-OPEN-05` | 本域专属 ACK-4 campaign 的清单需要业务所有者批准（受保护入口限制） | 待批准 |

**HARD STOP**：本 Design 完成后**不得自动进入 Implementation**（AGENTS.md §4.3 / §4.0）。Implementation 须业务所有者明确批准。

### 32.15 Canonical Period Guard 与跨域协调设计（R-02）

> 状态：`APPROVED`（业务所有者 2026-11-14 批准）；上游合同：Requirement §36.15；Implementation：已授权（2026-11-14 起实施）。
> 本节只统一「某动作在某业务日期必须通过哪些期间轴」的执行机制，不接管各 Domain 的关账业务语义，
> 不把四类期间表合并成一张业务表。

#### 32.15.1 单一责任与模块边界

| 组件 | 责任 | 禁止事项 |
|---|---|---|
| `server/modules/period-action-registry.js`（新增） | 冻结 `actionCode → requiredAxes` 注册表；声明显式例外动作 | 不读数据库，不接受调用方传入任意布尔绕过 |
| `server/modules/period-control.js`（新增） | 校验日期/作用域、按固定顺序取锁、读取各轴权威状态并统一拒绝 | 不实现 close/reopen，不复制 Domain 状态机 |
| Inventory / Finance / Accounting / Management canonical owner | 继续拥有各自 close/reopen、业务前置条件和状态迁移 | 不再维护第二套通用「期间是否开放」判定 |
| HTTP handler | 鉴权、开启事务、重读业务单据、调用具名 action、写业务与审计 | 不从前端参数决定 axes，不自行直读期间表绕行 |

注册表必须至少包含：库存数量/身份/价值 mutation、系统/手工凭证、AR/AP 确认与冲销、收付款与
结算分配、销售/采购折扣确认与冲销、经营归集/分摊/内部结算，以及纯 GL 期末转账/损益结转。
混合动作的 axes 是并集；纯 GL 期末动作只登记 `LEGAL_ACCOUNTING`，不得保留
`allowClosedInventoryPeriod` 一类通用布尔开关。未登记 action 一律 fail closed。

现有 `assertFinancialPeriodsOpen`、`assertInventoryPeriodOpen`、
`assertFinanceBusinessDateOpen` 在迁移窗口内只能作为**无业务逻辑的委托 wrapper**；调用方完成迁移并取得
zero-caller proof 后删除。`server/app.js::checkPeriodNotClosedForVoucher` 删除，手工凭证改走 canonical guard。

#### 32.15.2 调用与数据流

```text
permission check
  → transaction(db)
  → reread authoritative document/date/status
  → guardPeriodAction(db, { actionCode, businessDate, managementBookId? })
      → resolve immutable axes from registry
      → acquire stable locks in canonical order
      → reread authoritative period state under locks
      → allow or throw structured PeriodControlError
  → idempotency / domain invariants
  → economic writes + success audit
  → commit
catch period rejection
  → rollback all economic writes
  → auditBusinessRejection outside the failed transaction
  → return structured 409
```

guard 只能在写事务内运行；事务缺失、业务日期无效、scope 缺失、action 未登记或状态行异常均显式失败。
GET/CHECK 不创建或修复期间状态。关闭/重开 handler 采用相同锁协议，因而「检查后关闭」与「检查后写入」
不能穿越彼此的提交边界。

#### 32.15.3 Schema / migration 与权威状态

新增幂等、additive migration `server/migrations/period-control-schema.js`，在 SQLite 与 MySQL 创建：

```text
period_guard_anchors(
  axis, scope_key, version, updated_at,
  PRIMARY KEY(axis, scope_key)
)
```

只预置 `INVENTORY/GLOBAL` 与 `LEGAL_ACCOUNTING/GLOBAL` 两个稳定协调行。该表仅用于锁协调，**不是**
期间开放/关闭的事实来源。业务权威仍为：

| Axis | 权威状态 | 稳定锁对象 |
|---|---|---|
| `INVENTORY` | `inventory_period_closures` | `period_guard_anchors(INVENTORY, GLOBAL)` |
| `FINANCE_AR/AP/TREASURY` | `finance_business_close_state` + 历史 `finance_business_closures` | 各 axis 的 `finance_business_close_state` 行 |
| `LEGAL_ACCOUNTING` | `period_closures` | `period_guard_anchors(LEGAL_ACCOUNTING, GLOBAL)` |
| `OPERATING(bookId)` | `operating_period_closures` | 对应 `management_books` 行 |

既有表不合并、不 DROP、不改写历史。不存在/重复/断裂的必需状态由 guard 报
`PERIOD_STATE_INVALID`，不得在读路径静默补造。Operating 首次状态初始化只能由显式 migration/setup 或
受控写事务完成，不能由 GET/CHECK 触发。

#### 32.15.4 事务与全局锁顺序

所有多轴动作先解析完整 axes，再严格按下列 rank 一次取锁：

```text
10 INVENTORY
20 FINANCE_AR
30 FINANCE_AP
40 FINANCE_TREASURY
50 LEGAL_ACCOUNTING
60 OPERATING (managementBookId 按字典序)
```

MySQL 对上述稳定行 `SELECT ... FOR UPDATE`；SQLite 沿用 `transaction()` 的串行写事务语义。任何 Domain
不得逆序补锁。Legal close 依次锁 Inventory、三类 Finance、Legal 后重读前置状态；Legal reopen 锁 Legal，
再锁全部相关 management book（排序）并确认没有已关闭经营期间。Inventory / Finance reopen 先锁本轴及
Legal，法定期间已关闭时拒绝，从机制上落实「关账顺序正向、重开顺序反向」。

#### 32.15.5 错误、审计、权限与兼容

| 条件 | HTTP / code | 处理 |
|---|---|---|
| 日期或必要 scope 无效 | `400 BUSINESS_DATE_INVALID / PERIOD_SCOPE_REQUIRED` | 零业务写入；普通输入校验不记业务拒绝审计 |
| action 未登记或事务缺失 | `500 PERIOD_ACTION_UNREGISTERED / PERIOD_GUARD_TRANSACTION_REQUIRED` | fail closed，记录服务错误 |
| 权威状态缺失、重复或断裂 | `409 PERIOD_STATE_INVALID` | 零业务写入；事务外拒绝审计 |
| 轴已关闭 | 兼容 `INVENTORY_PERIOD_CLOSED` / `FINANCIAL_PERIOD_CLOSED`；新增 `FINANCE_PERIOD_CLOSED` / `OPERATING_PERIOD_CLOSED` | 返回 axis、businessDate、cutoff/period；事务外拒绝审计 |
| 顺序/依赖/最新期不满足 | `409 PERIOD_DEPENDENCY_NOT_CLOSED / PERIOD_SEQUENCE_INVALID / PERIOD_NOT_LATEST` | 状态不变；事务外拒绝审计 |

错误码只用于本 API 的结果表达，跨域消费者不得据生产方内部错误码推导自身业务。拒绝审计保持 exactly
once，至少含 action、entity、businessDate、axis、命中期间/截止日；成功 close/reopen 在同事务记录
before/after、reason、actor。权限继续使用各 Domain 已有 VIEW/MANAGE 权限，后端 fail closed；不新增隐式
ADMIN 绕过。所有 reopen 必须填写 reason。

兼容策略是保留路由、请求主体、业务表和既有库存/法定关闭错误码；有界 wrapper 只委托新 guard，不形成
第二实现。预期的兼容性变化只有：过去能穿越错误闸门的 mutation 现在被 409 拒绝。

#### 32.15.6 机器校验、测试与 MySQL 证据

新增 `scripts/qa/verify-period-guard-coverage.mjs`，验证：所有生产 mutation action 已登记；mutation owner
不直接读取期间表；旧 gate 无活跃调用；显式例外只有注册表中批准的纯 GL 动作。脚本纳入 canonical QA gate。

新增 `server/period-control-contract.test.js` 并登记测试分类；覆盖 action 矩阵、日期边界、缺失/断裂状态、
锁排序、零副作用、拒绝审计 exactly once、wrapper 等价和 SQLite/MySQL schema parity。真实 MySQL 必须使用
handler-vs-handler 独立连接覆盖：Inventory close vs inventory mutation、Legal close vs voucher/AR/AP mutation、
Operating close vs collect/allocation。两方都成功时，必须以锁顺序、提交时间和 close precheck snapshot 证明
mutation 先于 close 且已被 close 纳入；仅以 direct INSERT worker 制造的 RACE-12 不再可引用为充分证据。

本能力需要新的受保护 ACK-4 campaign；manifest、目标库和执行入口须另经业务所有者批准。在批准前不得运行，
也不得拿 SQLite 或历史 MySQL campaign 替代。

#### 32.15.7 实施顺序与回滚

1. additive migration + registry + guard + focused contract tests，暂不切调用方；
2. 四个 Domain close/reopen 接入稳定锁协议，旧 helper 改为纯委托；
3. 依次迁移 Inventory、voucher、Finance、Operating mutation；
4. zero-caller proof 后删除旧逻辑并启用覆盖校验；
5. 完成跨域 UI、回归、Heavy 与经批准的真实 MySQL 竞态证据。

回滚不 DROP 新协调表、不改写期间历史。上线前失败可回到上一应用版本，但 R-02 继续阻塞生产发布；切换后
禁止只回退某一 Domain 形成混合闸门，必须按同一逻辑单元整体回退并重新封闭生产发布。不设可在生产打开的
「跳过期间控制」feature flag。

#### 32.15.8 R-02 专属真实 MySQL campaign 的运行结果（2026-11-14）

| 项 | 值 |
|---|---|
| Manifest | `R02_PERIOD_CONTROL_MYSQL_V1`（夹具操作 `RUN_R02_PERIOD_RACES`） |
| 目标 | `modern_erp_domain_test` @ `127.0.0.1:3306`（MySQL 8.0.37，一次性可弃置） |
| 批准 | 业务所有者 2026-11-14 会话批准；ACK-4 capability 由 `scripts/gates/issue-mysql-ack4.ps1` 机械签发（签发器不构成批准） |
| 结论 | **`RESULT = PASS` / `ACK-4 STATE = FINISHED`**（清理由 root 独立 post-flight 复核） |
| 已消费操作 | `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_R02_PERIOD_RACES` → `CLEANUP_SCHEMA_POST_RUN` |
| 证据 | 四个子进程 lease 均已消费（manifest / commitSha `600bb39` / 目标身份逐项相符）；运行前与运行后 schema 均为 `tables=0 views=0 triggers=0 routines=0 events=0` |
| 场景 | S1 库存关账 vs 库存 mutation、S2 法定关账 vs 记账型 mutation（含系统凭证）、S3 经营关账 vs 经营归集、S4 canonical 协调锚点的 schema 形态与行锁可用性；每个场景带负控 |

首次运行在 `BOOTSTRAP_CURRENT_SCHEMA` 失败并**已消耗**当次 capability：SOD 迁移用了
`CREATE INDEX IF NOT EXISTS`，MySQL 不接受该语法。迁移改为「重复即忽略」的可移植建索引后重跑通过
（提交 `600bb39`）。

该证据证明的是：真实 MySQL 8 上，关账与同轴 mutation 由**同一批稳定锁**串行化，结果只能是「mutation
先完成并被关账快照纳入」或「关账先完成、mutation 被 409 拒绝」，**不存在** mutation 晚于关账提交的结果。
它**不**证明：R-02 的域级 Acceptance（Capability Freeze、Manual Closure）已签发。

#### 32.15.9 Design 状态与 HARD STOP

本节 Design：`APPROVED`（2026-11-14）；Requirement §36.15：`APPROVED`；Implementation：
已授权，并于 2026-11-14 起实施。未解决前置项只剩一项：Acceptance 前对专属 ACK-4 campaign 的
独立批准。

**HARD STOP**：专属 ACK-4 campaign（manifest、目标库、执行入口）仍须业务所有者单独批准；在批准前
不得运行，也不得以 SQLite 结果或历史 MySQL campaign 替代其并发证据。

### 32.16 Release Infrastructure 有界增补设计（`APPROVED`，2026-11-14）

#### 32.16.1 设计身份、授权与边界

| 项 | 内容 |
|---|---|
| 用途 | 实现 Requirement §36.16 的 `PL-RI-01..06`，闭合除 Manual Capability Closure / 九域 Release Readiness 签发之外的发布基础设施 P0 / P1 |
| Owner | Platform；Operations 负责 MySQL DR 与目标主机证据；各业务 Domain 不因本设计改变 owner |
| 状态 | `APPROVED`；Requirement §36.16 于 2026-11-14 批准，本节 Design 由业务所有者于 2026-11-14 以「根据 design 完成 Platform §36.16」明确批准并授权进入 Implementation；真实 MySQL / S3 / 目标主机写操作、发布与部署仍须逐次单独授权 |
| 权威来源 | `solution.md` §20、§32；Requirement §36.16；`docs/operations/deployment.md`；本节仅增补既有 Platform Design，不改写既有 Freeze 历史 |

设计坚持四个边界：仓库自动化与真实环境证据分开；SQLite 与 MySQL 运维入口分开；检查与修复分开；
本地 PASS 与生产可发布结论分开。任何真实 MySQL、对象存储、目标主机或防火墙操作仍须单独授权。

#### 32.16.2 模块与责任

| 责任 | 设计 owner / 目标文件 | 单一职责 |
|---|---|---|
| MySQL DR 公共原语 | `scripts/admin/lib/mysql-dr.mjs` | 配置校验、无 shell 子进程、流式 SHA-256、manifest、S3 读写、目标身份与保留策略；不决定生产恢复授权 |
| MySQL 备份 | `scripts/admin/mysql-backup.mjs` | 一致逻辑备份、非空校验、上传、回读校验、保留清理与机器可读结果 |
| MySQL 恢复 | `scripts/admin/mysql-restore.mjs` | 显式目标校验、下载/哈希、隔离恢复、完整性与应用健康验证；默认拒绝生产覆盖 |
| 定时运行 | `deploy/systemd/modern-erp-mysql-backup.service`、`.timer` | 以独立 service account 定时调用 MySQL 备份，不复用应用服务生命周期 |
| SQLite migration | `server/db.js` 内窄化 migration runner / schema inspection helper | 把预期幂等与未知错误分开，未知失败向上传播并阻止 ready |
| 依赖门禁 | `package.json`、`pnpm-lock.yaml`、`scripts/qa/verify-production-dependencies.mjs` | 固定 pnpm、区分 build/runtime graph、调用受支持 advisory 数据源并输出可复核摘要 |
| 浏览器门禁 | `scripts/acceptance/release-browser-readiness.mjs` | 从 `applicationRegistry.js` 生成角色/route 断言，统一验证四档 mobile-first 与五类角色 |
| 目标环境 preflight | `scripts/admin/release-preflight.mjs`、`scripts/admin/verify-release-target.mjs` | 前者只读采集本机配置；后者从客户端验证 HTTPS、health、静态资源和代理事实 |
| TLS / 服务模板 | `deploy/nginx/modern-erp-tls.conf.example`、既有 systemd 模板 | 给出显式替换项与 fail-closed TLS 形态；模板存在不构成环境 PASS |
| 历史引用纠错 | `docs/acceptance/document-reference-corrections.md` + current checker | 精确登记 append-only 历史断链，禁止 wildcard ignore |

`@aws-sdk/client-s3` 是备份运行时运维依赖；Vite 与 React build plugin 是 build-only 依赖。不得以调用外部
`aws` shell 或自行拼接 SigV4 形成第二套、不可测试的对象存储实现。

#### 32.16.3 `PL-RI-01` MySQL backup / restore 流程

备份状态机固定为：

`CONFIG_VALIDATED → SNAPSHOT_RUNNING → LOCAL_VERIFIED → UPLOADED → REMOTE_VERIFIED → RETENTION_APPLIED → COMPLETE`

任一步失败进入 `FAILED`，非零退出；未到 `REMOTE_VERIFIED` 不得执行清理，也不得报告可恢复。实现细则：

1. `mysql-dr.mjs` 只接受分别命名的环境变量，验证 backend 为 MySQL、数据库名为单一合法标识、S3 endpoint
   为 HTTPS（本地测试对象存储可由显式 test sentinel 例外）；日志只打印变量名与脱敏 endpoint。
2. 以 `spawn()` 参数数组直接调用固定路径的 `mysqldump`，禁止 `shell: true`；使用 consistent snapshot，
   包含 tables、views、triggers、routines 与 events，密码仅进入子进程环境，不进入 argv、manifest 或日志。
3. dump 先写入权限受限的临时文件；流式计算 SHA-256 与字节数。零字节、子进程非零、stderr 命中致命错误
   或 manifest 缺项立即删除临时文件并失败。
4. S3 object key 只由 UTC 时间、不可变 commit/tag 与随机 run id 构成；上传 dump 与 JSON manifest，并启用
   配置的 server-side encryption。随后必须 `GetObject` 流式回读并重算哈希，不能只信 ETag / HeadObject。
5. 仅当远端回读一致后，按“30 个 daily + 标记为 quarterly/release-preflight 的演练源保留”计算候选；删除前
   再验证候选 manifest 与对象身份，不跨 prefix，不接受 glob。
6. service 使用独立 `modern-erp-backup` 账号、只读数据库凭据与最小 S3 prefix 权限；systemd hardening、
   `UMask=0077`、非重叠锁和失败告警写入模板。应用 service 不取得对象删除权限。

恢复状态机为：

`SOURCE_VERIFIED → TARGET_AUTHORIZED → EMPTY_TARGET_VERIFIED → RESTORE_RUNNING → DATA_VERIFIED → APP_VERIFIED → COMPLETE`

- 默认只允许 `ERP_MYSQL_RESTORE_TARGET_CLASS=DISPOSABLE`，并复用现有 disposable target identity / destructive
  approval 机制；`APPROVED_PRODUCTION` 必须同时存在独立恢复窗口标识、审批标识与精确目标 identity，缺一拒绝。
- 恢复前对 endpoint/host/port/database 与 manifest 目标做逐项显示但不打印 secret；目标非空时默认拒绝。
  生产恢复不得自动 DROP 数据库，操作员必须在已批准窗口准备空目标。
- 下载后先复核 manifest、大小、SHA-256，再以无 shell `mysql` 客户端流式导入；失败停止，不继续 bootstrap、
  migration 或启动服务。
- 成功后校验 schema objects、按表行数摘要、关键约束/视图/trigger、`/api/health/live` 与 `/ready`，并记录
  从声明恢复到 ready 的单调时钟耗时。RTO/RPO 不达标即演练失败。
- 证据由独立 Acceptance 文档记录 run id、不可变 commit、脱敏目标、对象版本、哈希、开始/结束与检查摘要；
  不提交 dump、凭据、完整连接串或原始环境。

本设计不新增业务 schema。备份/恢复的 transaction 语义来自 `mysqldump --single-transaction` 与空目标导入；
若目标表不支持一致快照，备份必须拒绝而非降级。发布 migration 前置检查要求最新 `REMOTE_VERIFIED` 快照；
migration 失败停止启动，回滚走本恢复链，不设计反向破坏性 DDL。

#### 32.16.4 `PL-RI-02` SQLite migration fail-closed

`server/db.js` 建立内部 `runMigrationStep({ id, inspect, apply, verify })`：

1. `inspect` 通过 `sqlite_master` / `PRAGMA table_info|index_list|foreign_key_list` 判断已应用状态；只有验证为
   已满足目标形态才可记为 replay success。
2. `apply` 在一个 SQLite transaction/savepoint 中执行完整 migration；表重建以唯一临时表名完成 create →
   copy → verify → swap。任一步失败回滚并向上传播带 migration id 的安全错误。
3. `verify` 在提交前证明列、约束、索引与行数不变量；验证失败与 DDL 失败等价。
4. 现有 `production_orders` CHECK、voucher workflow 及其他用宽泛 catch 继续启动的升级段逐项迁入 runner；
   rollback cleanup 的 best-effort catch 只允许附加到原始失败，不得吞掉原始异常。
5. `createDatabase()` 只有在全部 migration + seed 成功后返回；`server/index.js` 只有取得已初始化连接后才
   listen，因此 migration 失败时 live/ready 均不会出现。

不改业务 schema 目标、不新增 migration。本单元只改变失败控制流与幂等识别。测试用故障注入覆盖 fresh、
upgrade、replay、未知 DDL、copy 中断、verify 失败与重启；每例验证后续 migration/seed/listen 未执行，且无
`_new` 残留或半复制数据。

#### 32.16.5 `PL-RI-03` 依赖与供应链门禁

- `package.json.packageManager` 固定执行时受支持的 pnpm 精确版本；部署仍用 Corepack +
  `pnpm install --frozen-lockfile`，lockfile 漂移直接失败。
- `vite`、`@vitejs/plugin-react` 移入 `devDependencies` 并升级 Vite 至执行时首个不受已知公告影响的兼容版本；
  `react`、`react-dom`、`mysql2`、图标库及 MySQL DR 的 S3 client 保持实际 runtime/operations dependency。
- `verify-production-dependencies.mjs` 同时检查 manifest 分类、`pnpm list --prod`、lockfile 中 Vite 与
  `source-map-js` 实际解析版本，并执行 `pnpm audit --prod`。audit 数据源不支持兼容 API、网络失败或返回不可
  解析结果均为 `INCONCLUSIVE` 且非零，不能记 PASS。
- high/critical 一律阻断；moderate/low 输出 package、advisory、production reachability 与处置登记。脚本不得
  自动写 override、ignore 或更新 lockfile。
- 升级后的门禁为 FULL + HEAVY + build + production install/start smoke；审计输出只归档摘要和 advisory id，
  不把大体量原始输出写进合同文档。

#### 32.16.6 `PL-RI-04` canonical browser gate

`release-browser-readiness.mjs` 直接导入 `applicationRegistry.js` 暴露的 route/access/presentation 投影；角色 fixture
只声明权限集合，不声明 must/deny route 第二清单。期望可见 route 由 registry access predicate 计算，direct URL
也由 `applicationRouteFor()` 生成。若 Node 导入边界需要轻量化，只允许从该文件导出纯数据投影，不得复制 registry。

每次运行创建隔离 SQLite、启动当前 `createApp()` 与当前构建产物，然后对 admin、sales、reviewer、warehouse、
accounting 五类角色逐一执行 320 / 390 / 430 / 680 CSS px：launcher 可见性、每个可见 route 的 direct URL、refresh、
Back/Forward、一个无权限 route 的 fail-closed、整页 overflow、44px 关键触控目标、未捕获异常/console error 与
意外 4xx/5xx。role 不具备 `NOTIFICATION_VIEW` / `WORKFLOW_TASK_VIEW` 时，App 在发起 badge fetch 前用同一权限
predicate 拦截；门禁不把这类 403 加入 allowlist。

Manufacturing fixture 使用两个账号：creator 仅创建/提交，reviewer 执行审批；不得为造数授予同人冲突权限或放宽
生产 SOD。报告把 `PRODUCT_FAILURE`、`FIXTURE_FAILURE`、`CONTRACT_DRIFT` 分开，但三者均非零。被中止、缺角色、
缺尺寸或未验证 direct URL 的运行一律 `INCOMPLETE`，不能生成 PASS 结论。

#### 32.16.7 `PL-RI-05` 目标环境、RBAC/SOD 与审计

`release-preflight.mjs` 是只读采集器，输出带 SHA-256 的 JSON：目标 commit/tag、Node/pnpm/MySQL/Nginx/systemd
版本、环境变量**名称**、持久目录、最新已验证备份 run id、service/nginx 文件哈希与 rollback artifact。它不修改
系统、不重启服务、不开放端口。`verify-release-target.mjs` 从独立客户端验证 HTTP→HTTPS、证书链/域名/有效期、
HSTS（启用后）、静态资源、live/ready、API、上传限制和代理后的客户端 IP 证据。

TLS 示例模板使用显式 `__SERVER_NAME__` / `__CERTIFICATE_PATH__` 占位；占位未替换时 `nginx -t` 必须失败。
80 端口仅 redirect，443 反向代理 `127.0.0.1:3001`；应用与 MySQL 不监听公网。目标环境 Acceptance 由具备
部署权限的 Operator 执行，应用管理员不能凭应用 RBAC 取得主机、DB 或 S3 权限；备份账号无恢复/删除权限，
恢复账号无日常定时执行权限，形成运维 SOD。

rollback rehearsal 的顺序固定为：确认发布前远端备份 → 切换上一不可变 release artifact → 在隔离恢复目标验证
数据库快照 → 维护窗口内切换服务 → live/ready 与关键 smoke → 记录恢复时间。既有 release tag 不移动、不重建。
主机命令及外部写入均需另行授权；仓库模板、本地脚本或 dry-run 不能替代 `nginx -t`、`systemd-analyze verify`、
防火墙/安全组与真实 restart 证据。

#### 32.16.8 `PL-RI-06` append-only 引用纠错

新增 `docs/acceptance/document-reference-corrections.md` 前必须按文档治理声明：用途为 append-only 历史断链的精确
纠错证据；Owner 为 Platform；状态为 `ACTIVE`；权威关系是 current checker 的输入证据，不是第二份项目状态表。
每行包括 correction id、source file、稳定行/内容哈希、原目标、正确目标、登记日期、Owner 与批准依据。

current checker 先按原文本报告 N1 断链，再仅对 source + content hash + old target 三元组完全相等的登记尝试
正确目标；目标可达才将该项记为 `CORRECTED_REFERENCE`。登记不匹配、目标仍断、重复登记或通配符全部失败。
本轮为 `log/2026-11-14.md:1387` 登记从 `../../docs/status/PROJECT_STATUS.md` 到
`../docs/status/PROJECT_STATUS.md` 的精确纠错，绝不改写原日志行。checker 测试同时覆盖命中、漂移、悬空和
wildcard 拒绝。

`PROJECT_STATUS.md` 的当前门禁结论只在现场结果与证据路径齐备时更新；历史 PASS 保留为历史，不覆盖当前失败。

#### 32.16.9 错误、审计、兼容与回滚

- 所有 CLI 采用稳定 error category + 安全人类信息 + 非零退出；不得输出 password、token、连接串、dump 内容或
  position/业务数据。外部服务失败不降级成本地成功。
- DR、preflight、browser/audit gate 输出 run id 与不可变 commit；关键状态转换进入独立证据文件，不能伪装成
  应用业务 audit。失败证据保留到足以定位类别，但 secret 必须在写盘前脱敏。
- API、权限、业务 schema、业务状态机和既有 tag 不变。新增 S3 SDK 或 Vite 升级若改变 Node 生产启动 graph，
  production smoke 必须失败并阻断合并。
- 回滚按逻辑单元：依赖/门禁脚本可整体回退；SQLite fail-closed 不得单独回退成吞错；DR 对象与 manifest 不删除；
  TLS 模板回退不等于目标主机回退。任何已经产生的正确备份/证据保持不可变。

#### 32.16.10 验证矩阵与实施顺序

| Requirement | focused evidence | release evidence |
|---|---|---|
| PL-RI-01 | config/secret redaction、dump failure、hash/readback、retention、target refusal 单测 | 经逐次批准的 disposable MySQL + S3 restore，RPO/RTO、app ready |
| PL-RI-02 | migration fresh/upgrade/replay/fault injection | FULL/HEAVY、production start refusal smoke、SQLite/MySQL 路径不串线 |
| PL-RI-03 | manifest/lock classification、audit parser 正负例 | 官方 advisory audit、frozen install、FULL/HEAVY/build/start |
| PL-RI-04 | registry projection、permission predicate、SOD fixture | Edge 五角色 × 四尺寸、direct/refresh/back/forward、HTTP/console clean |
| PL-RI-05 | preflight schema、TLS placeholder、脱敏单测 | 经授权目标主机 TLS/Nginx/systemd/firewall/rollback rehearsal |
| PL-RI-06 | correction exact-match 正负例 | current + migration docs checker，现场结果同步状态表 |

实施顺序：先 SQLite fail-closed 与纠错门禁，随后依赖分层/审计，再 canonical browser gate，再 MySQL DR 自动化，
最后目标环境模板与 preflight。每个逻辑单元 focused 测试通过后才进入下一单元；全部本地 gate 通过也只取得
`LOCAL_READY`，真实 MySQL/S3/目标主机证据齐备后才可进入 Acceptance。

#### 32.16.11 Design 状态与 HARD STOP

Requirement §36.16：`APPROVED`；本节 Design：`APPROVED`（业务所有者 2026-11-14 批准）；Implementation：`AUTHORIZED`
（仅限仓库内代码、测试、脚本与模板变更）。

**边界**：本次 Implementation 授权只覆盖仓库内代码、测试、脚本与模板变更。它**不**授权真实 MySQL 连接、
对象存储写入、目标主机写操作、发布、部署、push、tag 或 Git 历史重写；这些操作仍须逐次单独批准。
Acceptance / Freeze 仍须业务所有者最终签发。

### 32.17 Migration 风险工作包设计（`PENDING_APPROVAL`，2026-11-15；同日经业务所有者技术复核修订五项）

> **修订记录（2026-11-15，业务所有者技术复核）**：本节初稿提交于 `3ea41af`。业务所有者技术复核提出五项问题，
> 经在 HEAD 上逐项实测确认后修订。**实现范围与合同项 `PL-MG-01..04` 不变**，修订集中在实现归属与判定口径：
> ① 表重建原语**不再新建** `table-rebuild.js`，改为把 `server/db.js` 既有的两份局部 `uniqueTempTable`
> 与 7 处重建站点**上提**到 `migration-runner.js` 共用（消除第三份命名实现）；`runMigrationStep` 调用点计数
> 由 6 处更正为 **7 处**；
> ② 窄化 catch 的判定面写明为 `node:sqlite` 的 `errcode`（2067 / 1555）与 MySQL 的 `ER_DUP_ENTRY`，
> 并明确**不得**复制仓库既有 `isUniqueConstraintError` 的错误字段写法；
> ③ 遗留孤儿核对由固定名称清单改为**模式发现**（`sqlite_master` 模式查询 + 目标表推导）；
> ④ 守卫由三项扩为五项：G-2 改**逐站点**判定、G-3 覆盖 **fresh / upgrade 两条路径**、新增 G-4 命名原语唯一性与 G-5 孤儿残留；
> ⑤ 外键窗口补前置条件：重建单元必须运行在顶层事务，嵌套时 **fail closed**。
>
> **修订记录（2026-11-15，业务所有者退回后的第二轮对抗性复核）**：业务所有者**暂不批准**本节与 Requirement §36.17，
> 要求继续修订上述五项。第二轮复核逐条重放全部事实断言并修正五处（合同项与实现范围不变）：
> 1. **B 类取证方式**：逐文件核对 `runMigrationStep` 均为 0 次；`inventory-position-schema.js` 的 3 处 `BEGIN`
>    全部位于 `CREATE TRIGGER` 触发器体内，不是事务。
> 2. **G-1 的穷尽性**：全仓 `server/migrations/**` 无 `_tmp` / `_bak` / `_old` / `_copy` / `_backup` / `_staging`
>    等其它临时表命名模式，故 `CREATE TABLE …_new` 扫描当前是穷尽的；新增模式必须同步扩展 G-1。
> 3. **E-3 归属**：补 7 处 db.js 重建站点各自所属的 `runMigrationStep` step（`:511` → `:517`；`:553` → `:564`；
>    `:613` → `:635`；`:890` → `:904` / `:947` / `:998` / `:1050`）。
> 4. **顶层事务前置的可满足性**：迁移链是 `server/db.js` 的顶层 `migrate*(db)` 序列，不在任何事务内，
>    fail closed 规则不会打断既有链。
> 5. **G-3 的夹具来源**：仓库内无 legacy 数据库二进制夹具，upgrade 路径的「既有库」必须以脚本构造
>    （范式取自 `server/db-migration-fail-closed.test.js:224`），与判定同批提交并可独立重放。

#### 32.17.1 设计身份、授权与边界

| 项 | 内容 |
|---|---|
| 用途 | 实现 Requirement §36.17 的 `PL-MG-01..04`：消除 `server/migrations/**` 的吞错 catch、把固定 `_new` 表重建改为原子交换、保全重建表的索引、建立机器可验证守卫 |
| Owner | Platform。Inventory & Warehouse、Manufacturing & Quality、Procurement & Outsourcing、Sales & Customer 的既有 owner、schema 业务事实与能力矩阵状态不变 |
| 状态 | `PENDING_APPROVAL`；Requirement §36.17 于 2026-11-15 由业务所有者授权与本节 Design 连续执行，**Design 完成后 HARD STOP**；Implementation、数据库操作、发布与部署均未授权 |
| 权威来源 | `solution.md` §20、§32；Requirement §36.17；`docs/status/PROJECT_STATUS.md` §65；本节只增补既有 Platform Design，不改写 §32.16 已批准结论 |

设计坚持四个边界：幂等判定只靠 schema inspection，不靠错误文本；原子性只由**一个**执行器提供，不新建第二套；索引清单只由**一个**来源提供，不手写第二份；证据只由**一个**守卫产出，不在多处重复判定。

#### 32.17.2 模块与责任（单一 canonical owner）

| 责任 | 目标文件 | 单一职责 |
|---|---|---|
| 迁移原语 | `server/migrations/migration-runner.js`（**既有**，PL-RI-02） | `runMigrationStep` / `addColumnIfMissing` / `addColumnFromStatement` / `createIndexIfMissing` / `tableSql` / `indexExists`；原子边界、外键窗口与 fail-closed 的**唯一**实现 |
| 表重建原语 | `server/migrations/migration-runner.js`（**既有，扩充**，2026-11-15 技术复核修订） | 运行内唯一临时表名、create → copy → 行数核对 → drop → rename → 索引复原的原子交换、恢复态判定、遗留孤儿核对。**本节不新建 `table-rebuild.js`**：既有 `server/db.js` 的两份局部 `uniqueTempTable`（`:506`、`:858`）与其 7 处重建站点（`:517`、`:564`、`:635`、`:904`、`:947`、`:998`、`:1050`）必须**上提**到本文件，迁移层与启动层共用同一实现，不产生第三份命名 |
| 索引复原 | `server/migrations/index-manifest.js`（**新增**） | 重建前索引集合的捕获与复原清单；被重建表的权威索引声明 |
| 迁移文件 | `server/migrations/*.js` + `server/db.js` 的既有重建站点 | 只保留业务语义（目标 DDL 形态、行列映射）；幂等判定与原子性一律委托上述原语，不再自带 `safe*` helper |
| 吞错守卫 | `scripts/qa/verify-migration-fail-closed.mjs`（**既有，扩展**） | 扫描域从 PL-RI-02 授权清单扩展到 `server/migrations/**` 全域；输出逐条位置清单 |
| 原子性守卫 | `scripts/qa/verify-migration-atomicity.mjs`（**新增**） | 固定 `_new` 重建计数、**逐站点**非事务重建计数、**fresh 与 upgrade 两条路径**的索引集合差异、临时表命名原语唯一性、遗留孤儿残留；五项均须为 0 |

不得出现第二套 migration 执行器、第二套索引清单、第二份表重建实现或第二份「哪些站点算吞错」的人工名单。

`runMigrationStep` 已在 `server/db.js` 有 **7 处**在用调用点（`:486`、`:511`、`:553`、`:613`、`:782`、`:890`、`:2799`，PL-RI-02 实施成果）——本节初稿记「6 处」，计数有误，以本行为准。本节只把它扩展到 `server/migrations/**`，不改其语义；同时把 db.js 内既有的 7 处重建站点改为调用同一个重建原语（现状它们各自在文件内就地实现 `CREATE → copy → drop → rename`）。

`createIndexIfMissing` 要求调用方**显式**给出 `{ table, index }` 身份（既有 `safeCreateIndex` / `safeIndex` 只传 SQL，身份信息在调用点并不存在）。迁移文件必须把这些身份补齐为代码常量，并通过 `assertIdentifier` 的标识符白名单；不得为了少写一个参数而恢复成「靠捕获异常判断是否已存在」。

**临时表命名原语的收敛口径**：命名函数必须是**一份**，实现放在 `migration-runner.js` 并由 `server/db.js` 与 `server/migrations/**` 共同 import；`server/db.js:506` 与 `:858` 的两份局部定义必须删除（保留其一的上提版本）。命名形态收敛为 `<table>__rb_<id>_<run-unique>`（`run-unique` 只允许标识符安全字符：十六进制 / base36），整体必须通过 `assertIdentifier` 白名单。

**db.js 既有重建站点的归属（2026-11-15 第二轮复核补入）**：E-3 的 7 处重建站点逐站点归属如下 ——
`:517` 属 `:511` 的 step、`:564` 属 `:553`、`:635` 属 `:613`、`:904` / `:947` / `:998` / `:1050` 属 `:890`
（`tempTables` 映射）。这 7 处**已在事务边界内**，本节不改变其原子性，只把「就地实现的 create → copy →
drop → rename + 局部命名」替换为调用同一个重建原语，使迁移层与启动层共用一份实现。

**临时表命名模式的扫描口径**：全仓 `server/migrations/**` 当前**不存在** `_tmp` / `_bak` / `_old` / `_copy` /
`_backup` / `_staging` 等其它临时表命名模式，因此 G-1 的 `CREATE TABLE …_new` 扫描当前是穷尽的。
本节实施时若引入新的临时表命名模式，G-1 必须同步扩展，否则新模式会静默逃逸出守卫。

#### 32.17.3 调用与数据流

既有调用序列 `createSqliteDatabase` → `migrate*(db)` **保持不变**；变化只在每个迁移单元内部：

```
createSqliteDatabase(path)
  └─ migrate*(db)                              ← 调用序列不变
       └─ 迁移单元内部改为：
            runMigrationStep(db, {
              id: '<migration-id>',            ← 错误与临时表命名的唯一标识
              inspect: (db) => 目标形态已满足,
              apply:   (db) => 业务 DDL + rebuildTable(...),
              verify:  (db) => 索引集合 + 行数不变量,
              suspendForeignKeys: 需要时 true,
            })
```

`runMigrationStep` 已实现 inspect / apply / verify、事务或 SAVEPOINT 边界、失败整体回滚、未知错误带 migration 标识上抛，以及**事务外**的 SQLite 外键窗口。本节**复用**它，不新建第二套执行器。

`rebuildTable` 只在 `apply` 阶段被调用，不自行 `BEGIN` / `COMMIT`，也不自行操作 `PRAGMA foreign_keys`；外键窗口由 `runMigrationStep({suspendForeignKeys})` 唯一管理。

**外键窗口的前置条件（2026-11-15 技术复核补入）**：`runMigrationStep` 只在**自己拥有事务**时（`ownsTransaction === true`）才在 `BEGIN` 之前执行 `PRAGMA foreign_keys = OFF`；若重建单元被嵌套在外层事务内，SQLite 的 `PRAGMA foreign_keys` 在事务内不生效，外键窗口根本不会打开。因此：**表重建单元必须运行在顶层事务**。`runMigrationStep` 在检测到 `suspendForeignKeys === true` 且 `ownsTransaction === false` 时必须 **fail closed** 抛出（阶段 `apply`），不得在未关闭外键强制的情况下继续执行 `DROP <table>`。

（2026-11-15 第二轮复核：该前置条件在既有链路上**可满足** —— 迁移链是 `server/db.js` 中一串顶层 `migrate*(db)` 调用（`:701`–`:706` 等），不在任何事务内；`transaction()` 仅用于运行期（`:2659`）。因此新增的 fail closed 不会打断既有迁移链。）

#### 32.17.4 `PL-MG-01` 吞错 catch 的逐点收敛

| # | 位置 | 收敛方式 |
|---|---|---|
| A-1 | `inventory-position-schema.js:45` | 删除 `safeCreateIndex`；调用点改用 `createIndexIfMissing(db, sql, {table, index})` |
| A-2 | `inventory-position-schema.js:271` | 窄化为**唯一约束冲突**单一错误类；重试 key 的写入留在同一事务内；重试仍失败必须上抛 |
| A-3 | `procurement-outsourcing-opening-schema.js:62` | 删除 `safeIndex`；改用 `createIndexIfMissing` |
| A-4 | `sales-customer-wave6-returns.js:192` | 窄化为**约束不存在**单一错误类（MySQL 分支）；其余错误上抛 |
| A-5 | `v13-phase1-contracts.js:125` | 删除 `addColumn` helper；改用 `addColumnFromStatement` |
| A-6 | `v13-phase2-source-integrity.js:12` | 同上 |
| A-7 | `v13-phase3-quality-gates.js:10` | 同上 |
| A-8 | `v13-phase6b-traceability-quality.js:5` | 同上 |
| A-9 | `v14-out-procurement-final-acceptance.js:14` | 删除 `safeAddColumn`；改用 `addColumnIfMissing` |
| A-10 | `v14-out-procurement-final-acceptance.js:18` | 删除 `safeIndex`；改用 `createIndexIfMissing` |

`migration-runner.js` 内的两处 best-effort catch（回滚失败、连接失效时恢复 `foreign_keys`）属 §36.16.3 与 §32.16.4.4 已批准的窄化例外：它们不吞掉原始异常，必须原样保留，并在守卫中以**显式具名例外**登记，不得成为通配豁免。

窄化 catch 的判定规则：错误类别必须以**可枚举的诊断特征**判定（错误码 / 约束名 / 冲突类型），不得用「消息包含某关键词即认为可忽略」的方式吞掉整类未知错误。

**判定面的具体实现（2026-11-15 技术复核补入）**：判定必须落在**机器可读字段**上，而不是消息文本。

| 方言 | 判定字段 | 取值 |
|---|---|---|
| SQLite（`node:sqlite`） | `error.errcode` | `2067` = `SQLITE_CONSTRAINT_UNIQUE`、`1555` = `SQLITE_CONSTRAINT_PRIMARYKEY`、`1` = `SQLITE_ERROR`（duplicate column / table exists 等） |
| MySQL | `error.code` / `error.errno` | `ER_DUP_ENTRY` / `1062`（唯一冲突）、`ER_CANT_DROP_FIELD_OR_KEY`（约束或索引不存在） |

**不得复制仓库既有先例的字段判定**：`server/modules/sales-orders.js:27` 与 `server/modules/outsourcing-finance.js:958` 的 `isUniqueConstraintError` 先查 `error.code === 'SQLITE_CONSTRAINT_UNIQUE'` 与 `error.errno === 19` —— 实测 `node:sqlite` 的 `error.code` 恒为 `ERR_SQLITE_ERROR`、且**不提供** `errno`，这两个条件恒不命中，实际兜底全靠 message 正则。迁移层若照抄该写法，会把「禁止错误文本匹配」的合同条款在实现层绕过。本节必须使用上表的 `errcode` / `error.code` 判定。

**允许的文本用途**：在已判定为「唯一冲突」之后，从消息 `UNIQUE constraint failed: <table>.<column>` 中提取列名以区分**同一错误类别内部的变体**（例如 A-2 需要知道是哪一列冲突）。这属于 §36.17.3 允许的例外，不得用于判定「这一整类错误都可以忽略」。

#### 32.17.5 `PL-MG-02` 表重建原子化

`rebuildTable(db, { id, table, createSql, copySql, columnList, expectedRowCount, declaredIndexes, suspendForeignKeys })` 的内部序列，全部位于 `runMigrationStep` 的事务边界内：

1. **恢复态判定**：目标表缺失而临时表存在 → 进入完成交换路径（rename + 索引复原），**不得**丢弃承载数据的临时表。
2. **唯一临时表名**：由 `migration-runner.js` 内的**唯一命名原语**生成 `<table>__rb_<id>_<run-unique>`，其中后缀只允许标识符安全字符（十六进制 / base36），整体必须通过既有 `assertIdentifier` 白名单校验；不再使用固定 `_new` 名，也不得在调用点各自拼名。
3. **交换**：`CREATE TABLE <temp>` → `INSERT INTO <temp> SELECT … FROM <table>` → 行数核对 → `DROP TABLE <table>` → `ALTER TABLE <temp> RENAME TO <table>` → 复原索引集合。**行数核对的基准**：`expectedRowCount` 必须是**执行重建前的源表行数快照**（由原语在 copy 前捕获），与 copy 后的 `<temp>` 行数比对；调用方声明值缺失、或与原语捕获值不一致时必须 fail closed。事后按同一张表再数一次是恒等式，不构成不变量。
4. **失败**：事务整体回滚 → 旧表原样保留，临时表随事务消失，无残留、无半复制数据、旧表不被删除。

**遗留孤儿核对（2026-11-15 技术复核修订：由固定名单改为模式发现）**：核对必须**先于**任何迁移单元执行，并把判定结果写入启动日志。遗留临时表**不得**由人工维护的固定名称清单枚举 —— 该清单既无法覆盖运行内唯一命名的残留（如 db.js 的 `<table>_new_<uuid>`），本身也会成为第二份需要人工同步的迁移知识。发现方式固定为**从 `sqlite_master` 做模式查询**：

| 模式 | 匹配对象 | 目标表推导 |
|---|---|---|
| `name LIKE '%__rb_%'` | 新原语产生的运行内唯一临时表 | 取 `__rb_` 之前的表名 |
| `name LIKE '%_new'` | 旧代码遗留的固定名残留（`inventory_new`、`production_orders_new`、`production_order_operations_new`、`outsourcing_wip_identity_effects_new`、`credit_profile_ratings_new`、`sales_order_replacements_new`、`planning_outsource_handoffs_new`、`logistics_quality_policy_snapshots_new`、`production_order_operations_v23_new`、`production_inspections_v23_new`） | 去掉结尾 `_new` 后的表名（`production_order_operations_v23_new` → `production_order_operations`） |

推导出的目标表再按既有规则判定：

| 状态 | 处置 |
|---|---|
| 正式表存在且**行数 > 0** | 临时表是陈旧副本 → 安全删除（正式表是权威） |
| 正式表存在但**行数 = 0**，临时表**有行** | **不得删除临时表**：以临时表内容为准完成交换（这是 Requirement D 类「静默销毁型」的恢复路径；正式表是基础 `migrate()` 重建出的空壳） |
| 正式表缺失、临时表存在 | **完成交换**：rename 为正式表并复原索引，不得删除 |
| 两者都缺失 | fail closed：该表不可用，迁移失败并给出 migration 标识 |
| 两者都存在且临时表为空 | 视为陈旧副本，安全删除临时表 |
| 模式命中但**无法推导目标表**（命名不合法 / 前缀不在已知重建目标集合内） | fail closed：输出带表名的诊断并拒绝启动，**不得**静默删除一个身份不明的表 |

发现「正式表为空壳 + 临时表有数据」时必须以数据为准，不得按「正式表是权威」直接删除。

#### 32.17.6 `PL-MG-03` 索引复原

- `index-manifest.js` 记录**被重建表的权威索引声明**（名称、列、唯一性），来源为该表在仓库中的唯一 canonical DDL 声明；不维护第二份人工清单。
- `rebuildTable` 在 `DROP` 之前从 `sqlite_master` 捕获目标表的显式索引集合（名称 + 原始 `CREATE` 语句，排除 `sqlite_autoindex_*`），交换完成后逐条复原；`declaredIndexes` 与捕获集合取并集。
- `verify` 阶段断言：重建后索引集合 ⊇ 重建前索引集合 ∪ 声明集合；缺项即失败并回滚。
- **对 MySQL 的传导**：MySQL schema 由 SQLite 快照派生（`captureSqliteSnapshot` → `bootstrapMySql`），快照缺失的索引不会在 MySQL 侧被补齐。因此索引复原必须发生在**快照生成之前**——即 SQLite 迁移链修好后，全新 MySQL bootstrap 与既有 MySQL 的 `planMySqlIndexReconciliation` 才都能得到 `idx_po_instruction`、`idx_po_instruction_item`、`idx_production_inspections_operation`。真实 MySQL 侧证据仍须获授权的 ACK-4 campaign 取得。

#### 32.17.7 `PL-MG-04` 机器可验证守卫

`scripts/qa/verify-migration-atomicity.mjs` 的五项判定，**每一项都必须为 0**（2026-11-15 技术复核修订：由三项扩为五项）：

| # | 判定 | 依据 | 修订说明 |
|---|---|---|---|
| G-1 | 固定 `_new` 表重建站点计数 | 扫描 `server/migrations/**` 的 `CREATE TABLE …_new` | 保留 |
| G-2 | **逐站点**无原子边界的表重建计数 | 对**每一个**重建站点判定其是否位于 `runMigrationStep` 事务边界内（按调用点与语句区间判定），**不得**用「该文件是否使用过 `runMigrationStep`」的文件级推断代替 | 修订：文件级推断会在「同一文件内既有原语内站点、又有原语外站点」时产生假 PASS |
| G-3 | **fresh 与 upgrade 两条路径**各自的索引集合差异 | ① fresh 路径：全新初始化后的索引集合 vs 同一库第二次启动后的索引集合；② upgrade 路径：legacy 形态库升级后的索引集合 vs 同一库第二次启动后的索引集合 | 修订：原表述「用同一库建两次快照」只覆盖 upgrade 路径，**不能**证明「全新初始化缺索引、第二次启动才补齐」已消除 |
| G-4 | 临时表命名原语的**唯一性** | 仓库内临时表命名实现计数（当前为 **2**：`server/db.js:506`、`:858`） | 新增：对应 E 类归属缺口 |
| G-5 | 遗留孤儿临时表残留计数 | 按 §32.17.5 的模式发现在建库 / 启动链路上残留的临时表数 | 新增：对应恢复态残留 |

G-3 是本设计的核心 oracle：当前状态下它恰好报出 `idx_po_instruction`、`idx_po_instruction_item`、`idx_production_inspections_operation` 三个差异；修复后**两条路径**都必须为 0，且**不得**以「第二次启动会补齐」作为通过依据。

**G-3 的夹具来源（2026-11-15 第二轮复核补入）**：仓库内**不存在** legacy 数据库二进制夹具（无 `server/fixtures/` 目录、无提交的 `.db` 文件）。因此：

- **fresh 路径**：全新建库的快照，第二次启动后的快照与之比较；
- **upgrade 路径**：「既有库」必须**以脚本构造** —— 以既有 PL-RI-02 focused 测试
  `server/db-migration-fail-closed.test.js:224` 的 legacy 构造法为范式（直接 SQL 建出旧形态表 + 真实数据），
  按被重建表的全集扩展后升级，再与同一库第二次启动后的快照比较；
- 夹具脚本必须与判定**同批提交**，判定结果必须可由该脚本**独立重放**；
- 「只在 fresh 路径上比较」或「只比较同一库两次」都**不构成** G-3 通过。

**非空洞要求**：每一项判定都必须有**负控**（人为注入违规必须转红）与**变异实验**记录（§32.17.9）。没有负控的计数不得作为通过依据 —— 这与本仓库既有教训一致：判定若从未在真实违规上报红，就无法证明它在真实违规发生时仍会报红。

`verify-migration-fail-closed.mjs` 的扫描域扩展到 `server/migrations/**` 全域，「范围外待处理」计数必须归零；`migration-runner.js` 的两处窄化例外以具名条目登记。两个守卫都必须输出**逐条位置**清单，并登记进 `scripts/testing/test-suites.js`（FAST + FULL）。

#### 32.17.8 错误、审计、RBAC/SOD 与兼容

- **错误行为**：`MigrationError` 携带 `migrationId` 与阶段（inspect / apply / verify），消息经 `redactSecrets` 脱敏；未知错误一律上抛并阻止应用进入 ready；不得输出业务数据、连接串或密码。
- **审计**：本工作包只改 schema 形态，不产生业务状态迁移，因此**不写**应用业务 audit；证据写入守卫输出与验收记录，不得伪装成业务审计流。
- **RBAC / SOD**：不新增 route、不新增 permission、不改 `role_permissions`；迁移在启动期执行、没有用户主体；迁移**不得**成为绕过 SOD 的路径——它只改 schema，不写业务数据，也不改变任何单据状态机。
- **状态迁移**：只涉及「库 schema 形态」，不涉及任何业务单据状态机、期间闸门或估值语义。
- **兼容**：业务 schema 事实不变——不新增业务表、业务列、CHECK 约束，不做任何历史数据回填或改写；唯一允许的 schema 差异是**补回本应存在的索引**，索引不是业务事实。API 业务合同、权限结果、金额单位与既有 release tag 均不变。
- **回滚**：代码回滚按逻辑单元整体回退；**已原子化的迁移不得回退成吞错实现**；已存在的遗留孤儿临时表在回滚后仍必须能被识别为孤儿，不得被误当成正式表。

#### 32.17.9 验证矩阵、实施顺序与变异实验

| Requirement | focused evidence | release evidence |
|---|---|---|
| PL-MG-01 | 10 站点逐点用例（错误拒绝 / 正确重放 / 未知错误上抛）；窄化 catch 的 `errcode` / `ER_DUP_ENTRY` 判定面正例与反例 | `verify-migration-fail-closed.mjs` 归零 + FULL / HEAVY |
| PL-MG-02 | 崩溃注入：copy 中断、DROP 后中断、rename 前中断 → 断言旧表完好、无残留、可重试；嵌套事务下的 fail closed 断言 | 全新库 / 升级库 / 重放 + FULL / HEAVY |
| PL-MG-03 | **fresh 与 upgrade 两条路径**各自的「二次启动索引集合 == 一次启动索引集合」断言；两条路径的夹具脚本必须随断言同批提交并可独立重放 | 同上 + `verify-migration-atomicity.mjs` G-3 归零 |
| PL-MG-04 | 五项判定归零 + 逐项负控 | 两种文档一致性模式 + `git diff --check` |

实施顺序：① `PL-MG-04` 守卫先行（让现状报红，建立基线与防回归；G-2 逐站点、G-3 双路径、G-4 / G-5 随之上线）→ ② `PL-MG-01` 逐点收敛 → ③ 临时表命名原语**上提**到 `migration-runner.js` 并删除 `server/db.js:506` / `:858` 的两份局部定义，db.js 的 7 处既有重建改调同一原语（G-4 归零）→ ④ `PL-MG-03` 索引清单与复原 → ⑤ `PL-MG-02` 表重建原语落地与 10 个 `server/migrations/**` 站点迁移 → ⑥ 模式化遗留孤儿核对（G-5 归零）→ ⑦ 聚焦测试 + FULL / HEAVY / build / 两种文档一致性模式。

**变异实验（非空洞证明）**：① 移除 `runMigrationStep` 的 `verify` 调用 → PL-MG-02 / PL-MG-03 断言必须转红；② 把临时表名改回固定 `_new` → G-1 必须转红；③ 删除一次索引复原 → G-3 必须转红；④ 把一处窄化 catch 改回 catch-all → 吞错守卫必须转红；⑤ **把 G-2 改回文件级推断**（只看文件是否使用过 `runMigrationStep`）→ G-2 必须转红（否则文件级假 PASS 未被证明不存在）；⑥ **复制一份临时表命名原语**（恢复第二份实现）→ G-4 必须转红；⑦ **把孤儿核对改回固定名称清单** → G-5 必须在 db.js 的 `<table>_new_<uuid>` 残留用例上转红；⑧ **把窄化 catch 的判定改回 message 正则 / 错误字段写法** → PL-MG-01 断言必须转红；
⑨ **把 G-3 缩回单路径**（只比对同一库两次，不建 fresh 路径）→ G-3 断言必须转红；
⑩ **把 G-1 的扫描模式收窄**（只匹配 `inventory_new` 一个名字）→ G-1 断言必须转红。实验后必须逐字节恢复实现。

#### 32.17.10 Design 状态与 HARD STOP

Requirement §36.17：`PENDING_APPROVAL`（2026-11-15，含同日技术复核修订五项）；本节 Design：`PENDING_APPROVAL`（同上）；Implementation：`NOT_AUTHORIZED`。

**HARD STOP**：本节 Design 完成后**不得**进入 Implementation，等待业务所有者明确批准。本节不授权真实 MySQL 连接、对象存储写入、目标主机写操作、发布、部署、push、tag、Git 历史重写，也不授权 Acceptance / Freeze 签发。

### 32.18 Route 首屏 API 授权一致性通用设计（`APPROVED`，2026-11-15）

> 合同：Requirement [`docs/requirements/platform.md` §36.18](../requirements/platform.md)（`PL-EXPOSURE-01..07`）。
> 授权来源：业务所有者 2026-11-15 的一次性指令（AGENTS.md §4.0 连续阶段授权）。
> 本节只描述实现过程，不粘贴实现代码。

#### 32.18.1 边界与不变式

本设计**只**闭合「route 首屏请求 ⊆ actor 可读端点」这一条不变式。它**不**改变：

- 任何 API 的请求 / 响应合同与后端权限判定（后端继续 fail closed）；
- 任何角色的权限集合、`role_permissions`、权限码目录；
- 任何 route 的 exposure 语义、route 数量与 route key；
- 任何业务 schema、单据状态机、金额与估值语义；
- `PL-RI-04` canonical 浏览器门禁的判定面（门禁仍是发布门禁）。

**方向固定**：修法是「页面按 actor 权限自适应」，**不是**「收紧 route exposure」——
后者改变权限结果（可见入口减少），属业务所有者的独立裁定，沿用 `SC-EXPOSURE-05` 的 `DEFERRED` 口径。

#### 32.18.2 模块与文件清单

| 文件 | 性质 | 责任 |
|---|---|---|
| `src/lib/routeApiAuthority.js` | **新增**（Platform owner） | 通用原语：依赖登记归一化、按权限过滤、按权限加载、可读性判定。**不持有任何具体 route 的依赖数据** |
| `src/lib/inventoryWorkReferences.js` | **新增**（Inventory & Warehouse owner） | `inventory` route 的 4 个参照数据源登记与加载策略 |
| `src/pages/inventory-work.jsx` | 修改（Inventory & Warehouse owner） | hub 的参照加载改为按权限前置；无权参照的页签呈现明确无权态 |
| `server/route-exposure-semantic-parity.test.js` | 修改（Platform owner） | 平台级 focused 守卫：三个登记模块统一归一化后，逐条核对后端守卫并做逐角色包含性断言 |
| `scripts/qa/verify-route-api-authority.mjs` | **新增**（Platform owner） | 穷尽枚举：93 route × 5 canonical 角色，逐 (角色, route) 隔离 reload，输出 (角色, route, 端点, 状态) 四元组 |
| `src/lib/manufacturingAnalyticsTabs.js` | **不改**（Manufacturing & Quality owner） | 已冻结域合同 §29.11 的登记模块；本设计只要求它同时满足 `PL-EXPOSURE-02` / `PL-EXPOSURE-03` |
| `src/lib/salesPriceOverrideReferences.js` | **不改**（Sales & Customer owner） | 已冻结域合同 §34.16 的登记模块；同上 |

**为什么登记模块按 route 分域持有而不是集中在平台模块**：单一事实来源的口径是
「**一条 route 的依赖只有一个登记处**」，而不是「所有 route 的依赖放在同一个文件」。
集中放置会让平台模块反向依赖各域业务语义，并迫使改写两个已冻结域的合同（需再次解冻）。

#### 32.18.3 归一化口径：与后端守卫同形

后端守卫只有两种形态：`allow(actor, 'X')`（必须全部持有）与 `allowAny(actor, ['X','Y'])`（持有其一即可）。
前端登记因此归一化为同一形状：

| 登记写法 | 归一化结果 | 对应后端守卫 |
|---|---|---|
| `{ permission: 'X' }` | `{ kind: 'all', codes: ['X'] }` | `allow(actor, 'X')` |
| `{ permissions: ['X','Y'] }` | `{ kind: 'any', codes: ['X','Y'] }` | `allowAny(actor, ['X','Y'])` |

守卫从**服务端源码**解析（`server/app.js` 的路由登记 → owner 模块 → handler 函数体 → `allow` / `allowAny` 调用），
与前端登记逐项比对。**不手抄、不靠前端推断**：任一条不一致即判定失败。

#### 32.18.4 加载语义

1. **无权即不发**：只对 actor 有权读取的依赖发起请求；无权的数据源**一次请求都不发**。
2. **无权态 ≠ 空态**：无权读取时页面呈现明确的「无权限」状态；有权但无数据时呈现「暂无数据」。
   两者不得共用同一个空态组件。
3. **逐项失败不互相阻断**：单个依赖加载失败不影响其它依赖；失败被登记并提示，不得静默。
4. **全部无权即 fail closed**：一个依赖都无权时，页面呈现权限拒绝态，**不发任何请求**。
5. **前端隐藏不构成授权**：以上全部是前端行为；后端守卫一字不改，继续 fail closed。

#### 32.18.5 机器守卫

| 守卫 | 入口 | 判定内容 |
|---|---|---|
| 平台级 focused 合同测试 | `server/route-exposure-semantic-parity.test.js`（FULL） | ① 三个登记模块归一化后，与后端实际守卫**逐项相等**；② 逐 canonical 角色（取自**真实种子库**的 `role_permissions`）：角色可见该 route ⇒ 该 route 的首屏依赖全部可读；③ 无权时零请求；④ 无权态与空态可区分；⑤ 页面不得自带第二份端点清单 |
| 穷尽枚举 | `scripts/qa/verify-route-api-authority.mjs` | 93 route × 5 角色的首屏非预期 4xx/5xx 与浏览器控制台错误必须为 0 |

focused 测试的**角色权限取自真实种子库**，不是手抄名单 —— 迁移追加的权限
（例如 `role-accounting` 的 `PRODUCTION_COSTS_VIEW`）必须被看见。

穷尽枚举之所以单独存在：canonical 浏览器门禁用 hash 跳转 + Back/Forward 遍历 route，
其 FAIL 清单会随运行时序漂移（同一份代码两次跑的失败列表不同），
因此**单次门禁输出不能作为「缺陷已穷尽枚举」的证据**；穷尽枚举对每个 (角色, route) 做隔离 reload，
清单是确定的、可被第三方在同 HEAD 上重放的。两者都保留：门禁是发布门禁，枚举是取证工具。

#### 32.18.6 Inventory & Warehouse 的具体应用

`inventory` route 的 exposure 是 `any:['INVENTORY_VIEW']`（`src/navigation/applicationRegistry.js:43`）。
hub 的 `useInventoryReferences` 曾无条件加载 4 个参照端点，其中 2 个的守卫不是所有可见该 route 的角色都持有
（详见 Requirement §32.13.2）。改造后：

- 4 个参照的登记进入 `src/lib/inventoryWorkReferences.js`；
- `useInventoryReferences` 接收 `user`，按权限发起请求；无权参照**不发请求**；
- 页签自身的读取权限不足时，呈现明确无权态，而不是「可点击但必然 403」。

#### 32.18.7 兼容、事务、审计、错误行为与回滚

- **兼容**：不改变 API 合同、权限结果、route 集合、页签集合、业务语义。前端行为变化仅限「不再发出无权请求」与「无权态文案」。
- **事务 / 审计 / 金额**：本设计**不涉及**任何写路径，因此不新增事务边界、不新增审计事件、不改变金额与估值语义。
- **错误行为**：依赖加载失败按 §32.18.4 第 3 条登记并提示；无权**不是错误**，走无权态而非错误态。
- **回滚**：新增文件与页面改动可整体回退；回退后 `inventory` route 的 403 会重新出现，
  因此回退必须与本节的守卫改动同批，不得只回退其一。

#### 32.18.8 验证矩阵与变异实验

| Requirement | focused evidence | release evidence |
|---|---|---|
| `PL-EXPOSURE-01` | 登记模块存在且页面引用它；页面不得出现登记外的首屏端点字面量 | 穷尽枚举 + canonical 门禁 |
| `PL-EXPOSURE-02` | 登记归一化结果与后端守卫逐项相等（三个登记模块全部覆盖） | 同上 |
| `PL-EXPOSURE-03` | 逐 canonical 角色包含性断言（真实种子库） | 同上 |
| `PL-EXPOSURE-04` | 三条 route 的 exposure 未被改动（断言固化） | 同上 |
| `PL-EXPOSURE-05` | 无权态与空态可区分的用例 | 同上 |
| `PL-EXPOSURE-06` | 枚举脚本可复跑：同 HEAD 两次运行输出一致 | 枚举脚本归零 |
| `PL-EXPOSURE-07` | 门禁 allowlist 中不存在任何 403 豁免项 | canonical 门禁三类失败均为 0 |

**变异实验（非空洞证明）**：① 把 `inventory` 的参照加载改回无条件 → 包含性断言必须转红；
② 篡改登记中的 `STOCK_STATUS_VIEW` → 守卫一致性断言必须转红；
③ 把枚举脚本的隔离 reload 去掉、改为纯 hash 跳转 → 枚举必须复现出时序漂移（说明隔离 reload 是承重的）。

#### 32.18.9 Design 状态

Requirement §36.18：`APPROVED`（2026-11-15）；本节 Design：`APPROVED`（同日）；
Implementation：**已授权**（范围仅限 §32.18.2 所列仓库内文件与 §32.18.8 的门禁）。

**未授权**：真实 MySQL 连接、数据库破坏性操作、Acceptance / Freeze 签发、push / tag / merge / release / deploy。
### 32.19 导航分组完整性与界面语言一致性通用设计（`APPROVED`，2026-11-17）

> **授权来源**：业务所有者 2026-11-17 指令「admin 缺少了系统设置 → 用户与权限 → 用户管理 → 新增用户，
> 无法新增用户；前后端还存在中英文混用的情况，请做一次修整」。
> 该指令一次性授权 AUDIT → REQUIREMENT → DESIGN → IMPLEMENTATION 的连续执行（AGENTS.md §4.0）；
> **未**授权 push / tag / merge / release / deploy、数据库操作、真实 MySQL campaign 与任何
> Acceptance / Freeze / Release Readiness 签发。

#### 32.19.1 设计边界

| 项 | 内容 |
|---|---|
| 上游合同 | Requirement §36.19（`PL-NAVI-01..06`、`PL-LANG-01..07`） |
| Owner | Platform（`src/navigation/applicationRegistry.js` + 启动器 / 文案语言合同） |
| 本设计**不做** | 不改任何 route key、权限码、角色种子、API 合同、schema、单据状态机、金额语义；不改 `details.code`；不新增业务功能 |
| 本设计**做** | ① 启动器补齐 9 个域分组并把分组标题单源化为中文；② 补齐 11 条不可达 route 的入口；③ 前后端 303 条用户可见英文中文化；④ 两个可复跑守卫 |

#### 32.19.2 改动文件清单

| 文件 | 改动 |
|---|---|
| `src/navigation/applicationRegistry.js` | 启动器分组标签改为从 `domainMetadata.js` 的 `navigationLabel` 派生；新增 `platform` 分组（8 条）；恢复 `quality-control-points` / `product-costs` / `cost-rates` 三条被 `c77616b` 删掉的既有条目 |
| `src/components/icons.jsx` | 新增 7 个图标条目（`organizations` / `numbering` / `sodRules` / `workflowDesigner` / `workflowBindings` / `workflowMonitor` / `sourcingPricing`） |
| `src/App.jsx` | `launcherIconNames` 补齐新图标名 |
| `src/lib/copy.js` | `safeErrorMessage` 增加「非中文服务端消息」兜底分支 |
| `src/pages/**`（25 个文件） | 131 条用户可见英文中文化 |
| `server/**`（21 个文件） | 172 条用户可见英文错误消息中文化 |
| `scripts/qa/verify-navigation-reachability.mjs` | **新增**：导航可达性守卫入口 |
| `scripts/qa/verify-ui-language.mjs` | **新增**：界面语言守卫入口 |
| `server/navigation-reachability.test.js` | **新增**：导航守卫的 FULL 套件包装 |
| `server/ui-language.test.js` | **新增**：语言守卫的 FULL 套件包装 |
| `server/mobile-application-launcher.test.js` | **改写**两处被本节修订的历史断言（见 §32.19.6） |
| `docs/operations/deployment.md` | 新增腾讯云轻量服务器 + MySQL 8 部署执行清单 |
| `scripts/testing/test-suites.js` | 登记两个新 suite 到 FULL |

#### 32.19.3 启动器分组模型

**分组标签单源化。** `launcherGroup(key, label, kind, module, items)` 的 `label` 参数删除，
改为在 `APPLICATION_LAUNCHER_GROUPS` 构造后统一从 `DOMAIN_BY_KEY[group.key].navigationLabel` 派生：

```js
export const APPLICATION_LAUNCHER_GROUPS = Object.freeze([
  launcherGroup('master-engineering', 'domain', 'master', [...]),
  ...
]);
```

`DOMAIN_BY_KEY` 来自 `src/navigation/domainMetadata.js`，其 `navigationLabel` 已是中文
（`主数据与工程` / `销售与客户` / `计划` / `采购与委外` / `制造与质量` / `库存与仓储` /
`财务运营` / `会计与分析` / `系统设置`）。英文 `label` 字段保留在 `domainMetadata.js`
作为领域标识符（`BUSINESS_DOMAINS` / `PLATFORM_DOMAIN` 的 `label`），**不再进入用户界面**。

**九个分组的最终条目。**

| 分组 key | 标题 | 条目 |
|---|---|---|
| `master-engineering` | 主数据与工程 | 货品资料、工程基础资料、BOM、制品工序标准、替代料与可配置 BOM、工程变更 |
| `sales-customer` | 销售与客户 | 客户资料、销售报价、销售订单、销售出货、销售退货、信用额度与例外 |
| `planning` | 计划 | 计划员工作台、计划预测、MRP、计划订单、生产指令、采购指令 |
| `procurement-outsourcing` | 采购与委外 | 供应商资料、寻源与定价、请购单、采购订单、采购收货、采购退货、委外加工 |
| `manufacturing-quality` | 制造与质量 | 制令单、用料出库、生产质量、生产入库、生产扫码、质量配置、**质量规则**（恢复） |
| `inventory-warehouse` | 库存与仓储 | 仓库资料、库存作业与主数据、存货报废、存货月结、库存异动、批次 / 序列号 |
| `finance-operations` | 财务运营 | 应收、收款、应付、付款、发票、资金 |
| `accounting-analytics` | 会计与分析 | 业务总览、会计凭证、固定资产、会计事件台账、业务财务对账、报表平台、经营会计、存货核算、销售统计、销售未出货、采购统计、采购未交货、库存异动、**标准成本**（恢复）、**成本费率**（恢复） |
| `platform` | **系统设置**（新增） | **用户与权限**、组织与作用域、编号规则、职责分离规则、生命周期与归档、流程设计、流程绑定、流程监控 |

**Platform 分组的 8 条与「底部页签」的三条的关系。** Platform 域共 11 条 active route：
`approvals`（业务审批）、`notifications`（通知中心）、`workflow-tasks`（我的流程任务）
由底部页签承载，**不重复**进入启动器；其余 8 条进入「系统设置」分组。
因此 Platform 域 11 条 route **全部**有可达入口，且没有重复入口。

**权限可见性不变。** 分组条目只决定「入口出现在哪个分组」，**不改变** route 的 exposure 权限集合。
`buildMobileApplicationGroups` 继续以 `visibleNav`（按 exposure 过滤）∩ 分组条目求交集，
无权限的角色**看不到**这些 tile。`platform` 分组的 8 条所需的权限码
（`USERS_MANAGE` / `ROLES_MANAGE` / `ORGANIZATIONS_VIEW` / `ORGANIZATIONS_MANAGE` /
`NUMBERING_VIEW` / `NUMBERING_MANAGE` / `SOD_RULES_VIEW` / `SOD_RULES_MANAGE` /
`LIFECYCLE_VIEW` / `LIFECYCLE_MANAGE` / `WORKFLOW_VIEW` / `WORKFLOW_MANAGE` /
`WORKFLOW_INSTANCE_VIEW` / `WORKFLOW_CONTROL` / `WORKFLOW_REDEPLOY`）在真实种子库里
**只有 `role-admin` 持有**，因此该分组对 admin 可见、对其余四类 canonical 角色不可见 ——
这是既有权限事实，**本设计不改种子**。

**分组类型。** `platform` 分组的 `kind` 取 `'domain'`（与其他 8 组同级、可见展开），
**不取** `'utility'`：utility 分组在 `MobileLauncher` 里渲染为折叠的 `<details>`，
会把管理员最需要的「用户与权限」藏起来，与本次修整目标相反。

#### 32.19.4 导航可达性守卫

**入口。** `node scripts/qa/verify-navigation-reachability.mjs`，只读、不连数据库、不写仓库。

**模块形态。** 守卫同时导出 `collectNavigationReport()` / `navigationFailures()`，
回归测试**直接 import** 而不是在测试进程里 `execFileSync` 拉起子进程。
原因：FULL 门禁有 477+ 个套件并行执行，额外拉起的子进程会让 esbuild/Vite 那一批
前端套件以 `0xC0000102` 崩溃（单独跑却全绿 —— 典型的负载型假失败）。
`verify-ui-language.mjs` 同构，导出 `collectLanguageFindings()`。

**判定模型（四路径）**，对 93 条 active route 逐条计算：

| 路径 | 判定来源 |
|---|---|
| ① launcher | route key 出现在 `APPLICATION_LAUNCHER_GROUPS` 某个分组的条目里 |
| ② tab | route key 属于 `notifications` / `approvals` / `dashboard` / `workflow-tasks`（`MobileShell` 的 5 个页签中承载 route 的 4 个） |
| ③ parent | route 的 `parentRoute` 字段非空 |
| ④ link | `src/pages/**` 与 `src/components/**` 中的**导航构造**里出现该 route key 的精确字面量 |

路径 ④ 的导航构造判据（确定性、非宽匹配）：
`navigateToPage(` / `navigate(` / `hrefFor(` / `canNavigate(` / `page:` / `page=` /
`routeKey:` / `src/pages/business-overview.jsx` 的 `step()` 第三参数。
**刻意排除**「页面上出现过这个字符串」这类宽判据 —— 例如 `StatusChip domain="lifecycle"`
中的 `lifecycle` 是状态展示域、不是导航目标，必须被排除。

**输出三张零结果清单**（任一非空即退出码 1）：

1. `UNREACHABLE_ROUTES` —— 四路径全落空的 active route；
2. `MISSING_DOMAIN_GROUPS` —— `DOMAIN_DEFINITIONS` 中没有启动器分组的域；
3. `NON_CHINESE_GROUP_LABELS` —— 标题含 ASCII 字母的分组。

**「仅直达 URL」登记清单。** 守卫内置 `DIRECT_URL_ONLY_ROUTES` 数组，当前为**空**；
确需保留的 route 必须登记 `routeKey` + `reason`，且该 route 必须**同时**命中路径 ④
（登记一个没有真实链接来源的 route 即失败）。这条规则保证「不可达」永远不是沉默的。

**负控。** 守卫必须对下列三种变更转红：① 删除 `platform` 分组；
② 把某个分组标题改回英文；③ 把某个 route 的启动器条目删除使其四路径全落空。

#### 32.19.5 界面语言守卫

**入口。** `node scripts/qa/verify-ui-language.mjs`，只读。
与 §32.19.4 的导航守卫同构：导出 `collectLanguageFindings()`，测试直接 import。

**扫描对象与判据。**

| 目标 | 判据 |
|---|---|
| 前端 `src/**` | JSX 文本节点、`label` / `title` / `placeholder` / `aria-label` / `subtitle` / `description` / `summary` / `emptyText` / `help` 等**用户可见**属性、`notify()` 与 toast 的消息字面量 |
| 后端 `server/**` | `HttpError(status, '…')` 的消息、`send(res, 4xx|5xx, { error: '…' } / { message: '…' } / { details: { resolution: '…' } })` 的消息 |

命中「含 3 个及以上连续 ASCII 字母、且该串不是白名单条目」的候选即失败，输出
`file:line` + 原文 + 命中原因，供逐条修整。

**白名单（显式枚举，不使用通配）。** 领域专名与缩写（`MRP` / `BOM` / `WIP` / `IQC` / `OQC` /
`GRNI` / `LOT` / `SERIAL` / `UOM` / `ABC` / `GL` / `AR` / `AP` / `COGS` / `SKU` / `OEM` /
`FIFO` / `LIFO` / `JSON` / `CSV` / `PDF` / `HTML` / `SQL` / `API` / `ID` / `Code`）；
内部批次与条目编号（`Wave N` / `SC01` / `M&Q` / `PL` / `IW` / `PRC-xx` / `PL-xx`）；
产品名 `Modern ERP`；机器可读标识符（权限码、route key、枚举**取值**、表名列名、
`details.code` / `details.reason`、`data-testid`、CSS 类名、MIME 类型）。

**枚举取值的处理。** 提交值保持英文不变，**展示文本**改为中文（Requirement `PL-LANG-05`）。
例：`<option value="LINE">LINE</option>` 改为 `<option value="LINE">行</option>`；
`GRANT` / `CONSUME` / `RELEASE` 改为 `授予` / `消费` / `释放`。

**前端兜底（`PL-LANG-03`）。** `src/lib/copy.js` 的 `safeErrorMessage` 在既有分支之后追加一条：

```js
// 非中文的服务端消息不得原样透出（Requirement §36.19 PL-LANG-03）。
if (serverMessage && !/[㐀-鿿]/.test(serverMessage) && /[A-Za-z]/.test(serverMessage)) {
  return '操作未完成，请稍后重试';
}
```

判据是「消息**完全不含中文**」而不是「含有任意 ASCII 字母」：中文句子里的
`quantityMicros` / `LOT` 等领域标识符**允许保留**，只有整段英文才被拦下。
该分支**位于**既有 401 / 403 / 404 / 5xx / `BUSINESS_CONFLICT_COPY` / `TECHNICAL_ERROR`
分支**之后**，因此既有中文映射与错误码分类**完全不变**；纯中文消息原样返回。
`classifyApiError` 的 `resolution` 走同一判据。

**后端改写口径。** 只改**用户可见的消息文本**；`details.code` / `details.reason` /
`audit` 的 action / entity type / SQL 与字段名**一律不动**。
`scripts/qa/verify-error-code-coupling.mjs` 必须保持 PASS。
`Wave6 Option A:` / `Gate-B` / `Gate-C` 这类内部里程碑前缀在中文文案中**删除**。

**中文消息内的字段名标注。** 守卫对「中文句子里的散文型字段名」（`quantity`、`status`、
`direction` …）要求用中文书名号「」标注，以便与领域专名和枚举值区分：
`「quantity」必须为正数`。全大写枚举值（`NULL` / `AR` / `AP` / `PROVISIONAL`）
**不包裹** —— 它们是用户需要原样引用的机器值，包裹既难读又会破坏既有测试的正则断言。
里程碑代号整体包裹（`「Phase 6D」`），使既有断言 `/Phase 6D/` 仍然成立。

#### 32.19.6 被修订的历史断言

以下断言与本节冲突，必须**显式改写**并保留原意（**不得删除**）。它们锁定的正是
commit `c77616b`（2026-10-06）引入的历史状态：启动器只有 8 个业务域、标题是英文域名、
Platform 不得进入启动器。

| 文件 | 原断言 | 改写后 | 依据 |
|---|---|---|---|
| `server/mobile-application-launcher.test.js` | 「defines the eight canonical business domains」（8 个**英文** label） | 9 个分组的 key + **中文** label（`DOMAIN_BY_KEY[...].navigationLabel`） | `PL-NAVI-01` / `PL-NAVI-03` / `PL-NAVI-04` |
| `server/mobile-application-launcher.test.js` | 「does not expose Platform or legacy utility groups as business domains」 | 改为：不存在 `'utility'` **kind** 的分组；**存在** `platform` **kind = `'domain'`** 的分组，且其条目集合与 Platform 域 active route 集合一致（扣除底部页签承载的 3 条） | `PL-NAVI-01` |
| `server/v17-domain-alignment.test.js` | 「Business Launcher is exactly eight non-empty canonical groups and excludes Platform」 | 九个分组；Platform 分组条目 == Platform 域 active route 扣除底部页签 3 条 | `PL-NAVI-01` |
| `server/v17-p0-frontend-application-architecture.test.js` | `applicationRouteFor('users').applicationGroup === 'contextual'` | `=== 'platform'` | `PL-NAVI-01` |
| `server/p3-ui-design-system.test.js` | 「launcher has canonical eight-domain names」 | 断言 9 个中文 `navigationLabel` 存在于 `domainMetadata.js`，且 registry 从 `DOMAIN_BY_KEY` 派生 | `PL-NAVI-03` / `PL-NAVI-04` |
| `server/p1-material-plan.test.js` | `assertContains(launcherSource, "'planning','Planning'")` | 改为断言分组签名 `launcherGroup('planning','domain','planning'` | `PL-NAVI-03` |
| `server/v15-d2-four-prototypes.test.js` | 「D2 application workspace exposes the eight canonical business domains」 | 九个分组 + 中文 label（`PRIMARY_DOMAINS.length` 仍为 8，因为 `PRIMARY_DOMAINS` 不含 Platform） | `PL-NAVI-01` / `PL-NAVI-03` |
| `server/v16-p1-mobile-enterprise-foundation.test.js` | 「mobile metadata exposes exactly eight canonical business groups」；「Platform routes stay outside business launcher groups」 | 九个域分组 + 中文标题；Platform 入口按「底部页签承载 3 条 / 系统设置 8 条」拆分断言 | `PL-NAVI-01` / `PL-NAVI-03` |
| `server/v16-p8-flow-consistency.test.js` | 「P8 launcher: eight canonical business groups present in order」 | 九个域分组，顺序末尾追加 `platform` | `PL-NAVI-01` |
| `server/v16-sitewide-rollout.test.js` | 「eight canonical business groups remain in order」；「Platform stays outside the business launcher」 | 九个域分组；「no utility-kind launcher group exists」 | `PL-NAVI-01` |
| `server/v16-p2-sales-order-list.test.js` | 断言 registry 含 8 个**英文**分组名 | 断言 registry 含 9 个**中文**分组名 | `PL-NAVI-01` / `PL-NAVI-03` |
| `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | 「preserves the eight canonical domain groups and explicit module identities」 | 九个域分组 + 中文标题 | `PL-NAVI-01` / `PL-NAVI-03` |
| `server/v12-core-pages-ui.test.js` | 8 个**英文**分组名 | 9 个**中文**分组名 | `PL-NAVI-01` / `PL-NAVI-03` |
| `server/sales-customer-wave6-functional.test.js` | `assert.match(error, /Replacement Fulfillment/)` | `assert.match(error, /补货履行/)` —— 中文业务术语 | `PL-LANG-02` |

其余断言（角色 route 矩阵、禁用 route 不出现、`iqc` / `oqc` / `material-requirements-plan`
不作为主 tile、`quality-control-points` 非 admin 角色不可见、CRM 扩展项已移除）
**保持不变且必须继续通过**。

#### 32.19.7 测试计划与变异实验

| 层级 | 内容 |
|---|---|
| focused | `node --test server/navigation-reachability.test.js server/ui-language.test.js` |
| FAST | `pnpm test:fast`（两个新 suite 登记在 FULL，FAST ⊂ FULL 自动覆盖） |
| FULL | `pnpm test` |
| HEAVY | `pnpm test:heavy` |
| build | `pnpm build` |
| 浏览器 | `node scripts/acceptance/release-browser-readiness.mjs`（5 角色 × 4 档宽度 × 93 route） |
| 文档 | `node scripts/docs/check-doc-consistency.mjs`（current / migration 两模式） |

**变异实验（非空洞证明）**：至少三条 ——
① 从 `APPLICATION_LAUNCHER_GROUPS` 删除 `platform` 分组 → 导航守卫必须转红；
② 把 `master-engineering` 分组标题改回 `Master & Engineering` → 导航守卫必须转红；
③ 在任一用户可见文案（如 `src/pages/master-data.jsx` 的按钮文案）写入一句英文 →
语言守卫必须转红；④ 把某条后端 `HttpError` 的消息改回英文 → 语言守卫必须转红。

#### 32.19.8 兼容性与回滚

**兼容性**：不改变任何 route key、route 数量（93）、权限码、角色种子、API 合同、
schema、单据状态机、金额与估值语义、既有 release tag。启动器**新增**条目（不替换既有条目），
唯一被改动的是分组标题文案（英文 → 中文）与被恢复的 3 条既有条目。

**回滚**：本节改动集中在前端与守卫脚本，**不涉及数据库 schema、不涉及 migration**，
回滚即 `git revert` 对应 commit；回滚后「系统设置」分组与 3 条被恢复条目一并消失，
系统回到本节实施前的形态（其中「用户与权限」不可达的状态同时被恢复 —— 这是已知代价，
故回滚不得作为长期状态）。

#### 32.19.9 Design 状态

Requirement §36.19：`APPROVED`（2026-11-17）；本节 Design：`APPROVED`（同日）；
Implementation：**已授权**（范围仅限 §32.19.2 所列仓库内文件与 §32.19.7 的门禁）。

**未授权**：腾讯云部署与任何远程写操作、数据库操作、真实 MySQL campaign、
Acceptance / Freeze / Release Readiness 签发、push / tag / merge / release。


### 32.20 MySQL 8 方言兼容与追踪估值一致性设计（`APPROVED`，2026-11-17）

#### 32.20.1 改动清单

| 文件 | 改动 |
|---|---|
| `server/database/mysql-ddl.js`（新增） | `translateSqliteDdl()`：把运行时 `CREATE TABLE` 的 `TEXT` 按 canonical 规则译为 `VARCHAR(128)` / `LONGTEXT`，并把 `LONGTEXT` 的默认值写成 `DEFAULT ('…')` |
| `server/database/mysql-adapter.js` | `translateSqliteSql()` 接入 DDL 形状翻译；活体迁移路径调用估值对齐 |
| `server/lib/schema-ensure.js`（新增） | `ensureIndex()`：MySQL 先查 `information_schema` 再建索引；SQLite 走 `IF NOT EXISTS` |
| `server/lib/tracking-valuation.js`（新增） | `VALUATION_BY_TRACKING` 与 `canonicalValuationMethod()` —— 追踪策略与估值方法的**单一事实来源** |
| `server/migrations/v14-tracked-valuation-alignment.js`（新增） | 幂等对齐存量错配行（只动 `valuation_activated_at IS NULL` 的行） |
| `server/modules/products.js` | 产品创建按 canonical 映射写入 `valuation_method` |
| `server/modules/traceability-quality.js` | 追踪策略变更同步 `valuation_method` |
| `server/modules/financial-inventory.js` | 估值映射改为引用共享单一事实来源 |
| `server/modules/lifecycle-engine.js` | `rowid` → `(created_at, id)` 复合排序与行值比较；空图守卫 |
| `server/modules/outsourcing-finance.js` | `o.order_id` → `MAX(o.order_id)`，兼容 `ONLY_FULL_GROUP_BY` |
| `server/modules/inventory-assembly-disassembly.js`、`inventory-step-transfer.js`、`settlement-core.js` | `CREATE INDEX IF NOT EXISTS` → `ensureIndex()` |

#### 32.20.2 关键设计取舍

1. **为什么修翻译层而不是逐模块改 DDL**：§71.5 的 D1 根因是「快照 bootstrap 有 canonical
   列类型解析器、运行时 DDL 走另一条路」。逐模块改会遗漏同类写法 ——
   `server/modules/` 与 `server/lib/` 下共 17 个模块在运行时用 `db.exec` 自建表。
2. **索引幂等为什么必须显式检查**：MySQL 没有 `CREATE INDEX IF NOT EXISTS`，
   单条语句无法表达「不存在才创建」；翻译层只能改形状，不能改语义。
   因此索引幂等下沉为一个显式的方言感知原语 `ensureIndex()`。
3. **`rowid` 为什么不加成列**：加自增列需要两侧 schema 变更（SQLite 的 `AUTOINCREMENT`
   只能用于 `INTEGER PRIMARY KEY`，与既有 `TEXT PRIMARY KEY` 冲突）。
   改用 `(created_at, id)` 复合键：两种方言都支持，且是**确定性全序**，
   满足「来源溯源」所需的稳定顺序语义。
4. **估值对齐为什么不直接改 `changeValuationMethod`**：该函数在存在已过账估值移动时
   拒绝变更（正确）。存量对齐走独立迁移，且只动估值未激活的行 —— 已激活的货品保持冻结语义。

#### 32.20.3 Design 状态

Requirement §36.20：`APPROVED`（2026-11-17）；本节 Design：`APPROVED`（同日）。
Implementation：**已实施**（`PL-DDL-01`、`PL-DDL-02`、`PL-GROUP-01`、`PL-VALUATION-01`、
`PL-VALUATION-02`、`PL-EMPTY-01`）；**`PL-DDL-01` 之外的 §36.19 D4（批次 / 序列号 /
批号调整 / 容器 的列表端点）尚未实施**。
