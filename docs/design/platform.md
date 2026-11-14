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

- `src/components/AttachmentPanel.jsx`（Design §32.1.2）**尚未落地**：附件的 7 个挂载点
  全部位于已冻结域的单据详情页（会计凭证 / 采购订单 / 销售订单 / 生产订单 / 生产检验单 /
  采购申请 / 销售报价），嵌入它们意味着触碰 6 个已冻结域的前端详情面，须在域级 Acceptance
  轮按 AGENTS.md §4.6 复核登记。本轮先交付后端附件能力（PL-10）与挂载点合同，
  前端挂载作为显式残余随下一轮立项。
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
  │    MIN_APPROVERS         : 已通过人数 < N → 不违规（要求第二人复核 → OUT_OF_SCOPE）
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
- §32.4.2 的 `MIN_APPROVERS` 判定式（"已通过人数 < N → 不违规"）与
  `server/modules/platform-sod.js` 的实现（`approvedCount < required` → 违规）方向相反；
  该分支在当前接线点不可达（无人传 `approvedCount`），本轮以"创建时拒绝"回避，
  方向待后续轮次在 Requirement 层裁定。

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
