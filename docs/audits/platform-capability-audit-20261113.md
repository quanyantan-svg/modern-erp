# Platform 平台层域 — 域级能力审计基线（2026-11-13）

> **用途**：登记 B3122《工作流设计与配置》与 Platform 平台层**域级闭合**所需的逐项能力复核证据，覆盖 `document.md` §17 的 13 项平台长期能力（PL-01～PL-13）与 §22.22 的 8 项 B3122 手册能力（WF-01～WF-08），并登记本轮查出的真实缺陷、结构缺口与待业务所有者裁定事项。
>
> **Owner**：Platform Domain Owner（Acceptance 与 Freeze 的唯一签字人）；QA（证据维护）。
>
> **状态**：`AUDIT_COMPLETE / COVERAGE_REVIEWED` —— 逐项复核已完成，**域级 Acceptance 与 Capability Freeze 尚未签发**。
>
> **权威来源**：手册要求基线 [`document.md` §17、§22.22](../../document.md)；平台目标形态 [`solution.md` §20.6、§20.7](../../solution.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。
>
> 本文件不改写合同正文，只记录**当前工作树上的复核结论**。审计发现**不构成** Capability Verified、Capability Freeze、Domain Acceptance、Manual Closure 或 Release Readiness，也**不构成任何 Implementation 授权**。

**审计基准 SHA**：`63bb7c5f705be42c7c256a404476c2049dcd6139`（`master`，2026-11-13）。

## 1. 复核方法与判定纪律

逐项定位：Requirement / 手册条款 → 生产写入口（route + canonical owner）→ handler → schema / table / index / FK → 状态机 → RBAC / SOD → transaction / idempotency → audit → 可执行测试（文件 + 是否在 `scripts/testing/test-suites.js` 注册）→ 前端入口与可达性 → 跨域影响。

判 `COVERED` 需同时成立：

1. 有生产写入口或读入口，且服务端具备来源、状态机、权限、事务约束；
2. 有**已注册**的可执行测试覆盖正例且至少一个反例；
3. 该能力有 operator 可达的前端入口（LIST → DETAIL → EDITOR / WORKFLOW），或该能力本身是纯只读读模型；
4. 事实进入业务路径。

判 `PARTIAL` 的三种形态：**能力事实被持久化但无生产消费方**；**能力只由部分实现，未覆盖合同声明的完整枚举**；**后端能力齐备但无 operator 前端入口**。

判 `MISSING` 的形态：**该能力族在生产代码、路由、schema、前端与测试中全部不存在**（或仅存"空壳"：schema 存在但写路径为零）。

判 `SEMANTIC_MISMATCH` 的形态：**能力存在但语义与手册基线或合同声明不一致**（例如实现了另一件事）。

判 `OUT_OF_SCOPE` 需**业务所有者显式裁定**，本台账不自行裁剪范围。

**能力编号来源**：PL-01～PL-13 逐行对应 `document.md §17` 的 Platform 长期能力（原文 12 项，其中「Identity / RBAC / SOD」拆为 PL-01 Identity/RBAC 与 PL-02 SOD，因为二者实现状态差异极大）；WF-01～WF-08 逐行对应 `document.md §22.22` 的 B3122 手册能力表。

## 2. 复核结论摘要

| 能力组 | `COVERED` | `PARTIAL` | `MISSING` | `SEMANTIC_MISMATCH` | `OUT_OF_SCOPE` | 小计 |
|---|---|---|---|---|---|---|
| PL-01～PL-13（平台长期能力） | 3 | 4 | 6 | 0 | 0 | 13 |
| WF-01～WF-08（B3122 手册能力） | 0 | 3 | 5 | 0 | 0 | 8 |
| **合计** | **3** | **7** | **11** | **0** | **0** | **21** |

**3 项 `COVERED`**：PL-01（Identity / RBAC）、PL-05（Approval）、PL-12（Audit）。

**7 项 `PARTIAL`**：PL-06（Document Lifecycle）、PL-09（Numbering）、PL-11（Notification）、PL-13（Period Control）、WF-01（流程定义）、WF-04（流程实例）、WF-05（节点任务）。

**11 项 `MISSING`**：PL-02（SOD）、PL-03（Organization Scope）、PL-04（Generic Workflow 引擎）、PL-07（Document Relation）、PL-08（Document Conversion）、PL-10（Attachment）、WF-02（版本与发布）、WF-03（业务模板绑定）、WF-06（业务动作）、WF-07（监控）、WF-08（暂停 / 终止 / 恢复）。

**平台当前不具备任何 Domain Closure Requirement 与 Design**，本台账是建立二者的证据输入。

## 3. PL-01～PL-13 逐项复核（平台长期能力）

### PL-01 Identity / RBAC —— `COVERED`

| 项 | 事实 |
|---|---|
| Schema | `users` / `roles` / `permissions` / `role_permissions` / `sessions`（`server/db.js:1027`、`:1036`、`:1041`、`:1047`）；权限目录 `export const PERMISSIONS`（`server/db.js:60`，247 项，形如 `['CODE','中文名']`） |
| 路由 | `POST /api/auth/login` / `logout` / `GET /api/auth/me`（`server/app.js:3931-3936`）；`/api/users`（`app.js:1488-1494`）、`/api/roles`（`app.js:1470-1476`） |
| Canonical owner | `server/modules/users.js`、`server/modules/roles.js`（`roles.js:22` 导入 `PERMISSIONS`，`listRoles :35` / `createRole :45` / `updateRole :61`；`:68` 强制 ADMIN 保留全部权限） |
| 权限判定 | `allow(actor, permission)`（`server/lib/http.js:54-60`）→ 403 + `deniedPermissions`；`allowAny`（`:62-67`）。**fail closed**（抛错而非返回 false） |
| 角色 | **7 个** system role：`ADMIN` / `SALES` / `REVIEWER` / `WAREHOUSE` / `ACCOUNTING` / `OUTSOURCING` / `OUTSOURCING_RECEIVING`（`server/db.js:1810-1816`） |
| 测试 | `server/v2-wave3d-roles-ownership.test.js`、`server/v2-wave3e-users-ownership.test.js`（均已在 `scripts/testing/test-suites.js` 注册） |
| 前端 | `src/navigation/applicationRegistry.js:100` route `users`（enabled）；`src/pages/` 有对应工作面 |
| 事实进入业务路径 | 是。`allow()` 是全系统唯一权限闸门，被 100 处内联调用 + 各域模块自持检查 |

**残余**：`server/lib/route-table.js:45-56` 明确**拒绝** `permissions` / `permissionPolicy` 描述符字段，路由表不携带权限元数据 → **无自动的 route → permission 覆盖断言**（`server/app.js` 267 条路由条件 vs 100 处内联 `allow`，其余委托给模块自持检查）。权限覆盖只能靠逐域测试证明。

### PL-02 SOD（职责分离）—— `MISSING`

**无通用 SOD 概念**：无规则表、无配置、无引擎。全部为各域决策点硬编码比较：

| 检查 | 位置 |
|---|---|
| 出纳复核人 ≠ 制单人 ≠ 审核人 | `server/modules/accounting-posting.js:211-238`（`VOUCHER_CASHIER_REVIEW_SOD_VIOLATION`） |
| 会计事件修复人 ≠ 原业务复核人（跨 7 张表探测 reviewer 列） | `server/modules/accounting-events.js:189-198`、`:200+` |
| 信用特批：申请人 ≠ 审批人 | `server/modules/credit-special-approval.js:17`、`:255-261`（`CREDIT_SPECIAL_APPROVAL_SOD`，**唯一有命名错误码的 SOD**） |
| 销售自分配 / 自我默认升级 | `server/modules/sales-foundation.js:90`、`:161` |
| 销售单自审批防护 | `server/modules/sales-orders.js:773`、`:838`、`:893`；`server/app.js:4971`、`:5244`、`:5249` |
| 采购申请自审批防护 | `server/modules/planning-documents.js:830`、`:846` |
| 盘点自审批防护 | `server/modules/inventory-stocktake.js:301` |
| 凭证自审批防护 | `server/app.js:5978-5981` |

**缺陷 PL-DEF-01**：**生产订单审批无任何自审批防护**（`server/modules/manufacturing-orders.js:164-169`）—— 六族审批中唯一缺口。

**缺陷 PL-DEF-02**：`server/modules/credit-scope.js:2` 从 `server/modules/sales-scope.js` 导入 `actorHas`，形成销售域 → 信用域的**跨域原语耦合**；`server/lib/http.js:54` 的 `allow` / `allowAny` 才是 canonical 原语对。

### PL-03 Organization Scope —— `MISSING`

**不存在组织主数据**：全仓库无 `organizations` / `companies` / `entities` / `tenants` / `business_units` 表，无任何 `org_id` 列（`server/db.js:403` 仅新增 `accounting_entries.department_id`）。

现有三个 scope 机制是**三条互不相干的域内轴**，都不是组织轴：

| 轴 | 模块 | 实际语义 |
|---|---|---|
| 销售组 | `server/modules/sales-scope.js`（44 行） | `assertGroupScope :16-34` 校验**销售组**成员（`salesperson_group_memberships` + `sales_groups`），受 `SALES_CROSS_GROUP` 权限与 `salesGroupDataScopeEnabled` 开关控制；ADMIN 经 `actorHas :4-6` 绕过 |
| 业务员 | `server/modules/credit-scope.js`（178 行） | `resolveCreditReadMode :74-94` 产出 ALL / DENY / CROSS_GROUP / AGGREGATE_ONLY / AGGREGATE_PLUS_SELF 五种读模式，基于 `cp.salesperson_scope_key` |
| 库存货主 | `server/modules/owner-dimension.js`（51 行） | 按 `(owner_type, owner_id)` 聚合，`owner ∈ {ENTERPRISE, SUPPLIER, CUSTOMER}`（`:40-42`）；**纯描述性，无鉴权过滤**；`owner_id IS NULL` 即企业单例（`:41`） |

相关但非组织轴的表：`accounting_scopes`（`server/migrations/inventory-costing-schema.js:26-35`，`org_scope` / `owner_scope` 为**自由文本标签**，校验 `COSTING_SCOPE_OWNERS` 于 `server/modules/accounting-inventory-cost.js:98-100`，**非 FK**）、`departments`（`server/migrations/extended-schema.js:3-6`，扁平树，**零查询使用**，仅 `server/modules/extended.js:110`、`:119` 读取）、`sales_sellable_scope_rules`（`server/migrations/sales-customer-wave1-foundation.js:126`）。

**多组织现实**：单组织。`org_scope` 无任何查询过滤；无种子组织行。

**结构缺口 PL-GAP-01**：**`docs/requirements/master-engineering.md:27` 明确 Multi-Organization 为 `OUT_OF_SCOPE — CURRENT PRODUCT BASELINE`；`:194` 将「Multi-Organization 需求出现」列为 Master & Engineering 的 Hard Stop Condition。** 而 `document.md:126`、`:392` 把 Organization 归属判给「Master & Engineering + Platform」。**Platform 建立组织模型会触发 M&E 域的 Hard Stop 条件**，须业务所有者显式裁定。

### PL-04 Generic Workflow 引擎 —— `MISSING`

**现有 `approval_workflows` 表**（`server/db.js:1746-1755`）：`id` / `name` / `entity_type` / `steps TEXT NOT NULL DEFAULT '[]'` / `creator_id` / `created_at` / `updated_at`。**无索引、无 `active` 列、无版本列、无实例列**。

**`steps` JSON 无任何生产消费方**：全仓库 `approval_workflows` 仅出现于 `server/db.js:1746`（DDL）、`server/modules/platform-workflows.js:7`、`:16`（写入与读取返回）。前端 `.steps` 命中仅表单自身 state（`src/pages/platform-workflows.jsx:38-42`）。**该列是纯死数据。**

**模块仅 19 行**：`server/modules/platform-workflows.js` 只有 `listWorkflows :5-9` 与 `createWorkflow :11-19`。路由 `GET /api/workflows`（`server/app.js:2672-2677`）、`POST /api/workflows`（`:2678-2683`）。**无 update / delete / publish / instance / node / task / action 任何入口。**

**前端是失效的**（`src/pages/platform-workflows.jsx`）：
- `:21` 读取 `item.active` —— **该列在表中不存在**，每行都渲染为未激活；
- `:56` `entity_type` 选项（`ORDER|PURCHASE_ORDER|PRODUCTION_ORDER`）与审批族键（`SALES_ORDER…`）**不匹配**；
- `:51` 弹窗标题硬编码「新建审批流程」，编辑态同样如此；**无 update 路由**，编辑按钮实际永远 INSERT 新行；
- 路由 `workflows` 在 `src/navigation/applicationRegistry.js:106` 的 `DISABLED_ROUTE_DEFINITIONS` 中（`enabled:false`），屏幕映射在 `:204` 但**用户不可达**（由 `server/v17-domain-alignment.test.js:67` 断言）。

**审批基座的形状（通用引擎必须遵守）**：6 个适配器 + 1 个信用特批。适配器是**只读投影描述符**（每族 SQL + 权限 + 状态 / 复核人 / 经办人列名），`server/modules/approvals.js:5-137`；**域模块拥有状态机**（状态迁移、权限、自审批防护、审计、事务、副作用）。

| 族 | 表 / 目标状态 | 路由 | Handler | 域模块 |
|---|---|---|---|---|
| `SALES_ORDER` | `sales_orders` → APPROVED | `POST /api/orders/{id}/approve`（`app.js:3970`）；`POST /api/sales-orders/{id}/approve`（`app.js:812`） | `salesOrderAction`（`server/modules/sales-orders.js:878`）→ `approveSalesOrder :800` | `sales-orders`（含信用闸门 + 幂等） |
| `PURCHASE_ORDER` | `purchase_orders` → APPROVED | `POST /api/purchase-orders/{id}/approve`（`app.js:3982`） | `changePurchaseOrderState`（`app.js:5205`，approve 分支 `:5242-5246`） | 内联于 `app.js` |
| `PURCHASE_REQUISITION` | `purchase_requisitions` → APPROVED | `POST /api/purchase-requisitions/{id}/approve`（`app.js:4185`） | `approvePurchaseRequisition`（`server/modules/planning-documents.js:823`，reject `:840`） | `planning-documents` |
| `INVENTORY_CHECK` | `inventory_checks` → APPROVED（`supportsReject:false` `:53`） | `POST /api/inventory-stocktakes/{id}/approve`（`app.js:3427`） | `approveStocktake`（`server/modules/inventory-stocktake.js:292`，UPDATE `:415`） | `inventory-stocktake` |
| `ACCOUNTING_VOUCHER` | `accounting_vouchers` → **POSTED**（`:78`） | `POST /api/accounting-vouchers/{id}/approve`（`app.js:4249`） | `approveAccountingVoucher`（`app.js:5960`，reject `:5994`） | 内联于 `app.js` |
| `PRODUCTION_ORDER` | `production_orders` → APPROVED | `POST /api/production-orders/{id}/state`（`app.js:3121`） | `changeProductionOrderState`（`server/modules/manufacturing-orders.js:265`）→ `transitionOrder :156` | `manufacturing-orders` |
| `CREDIT_SPECIAL_APPROVAL`（不在 `DOCUMENTS[]`） | `credit_special_approval` | `POST /api/credit/special-approvals`（`app.js:714`）；`POST /api/credit/special-approvals/{id}/decide`（`app.js:717`） | `requestCreditSpecialApproval`（`server/modules/credit-special-approval.js:152`）；`decideCreditSpecialApproval :230` | `credit-special-approval` |

**无任务 / 分配 / 实例 / 步骤执行表**（全仓库无 `workflow_instance` / `approval_task` / `todo` 表）。`GET /api/approvals`（`app.js:3945` → `server/modules/approvals.js:225 listApprovals`）**按需实时计算**：每族 4 个 tab 各 1 个计数查询 + 1 个列表查询（`:233-250`），`normalizeRow :162` 归一化，`:252` 合并排序，`:253` 切片，`addLinePreviews :208` 追加行预览。Tab：pending / approved / rejected / created（`:3`）。

**第 7 个平行基座**：`approval_requests`（`server/db.js:1161-1175`）仅被 `server/modules/sales-order-changes.js:296`、`:486`、`:541`、`:546` 使用，不进入聚合。

**缺陷 PL-DEF-03**：`server/mobile-approval-center.test.js:166` 断言 `/api/approvals/…` 下**不得**存在任何 POST / PATCH / DELETE。通用引擎的变更入口**必须使用新的路径前缀**。

### PL-05 Approval —— `COVERED`

见 PL-04 的族表。补充证据：

- **审计与事务**：`audit(db, userId, action, entityType, entityId, detail)`（`server/lib/audit.js:4-6`，写入 `audit_logs`，`server/db.js:1584-1592`）；`auditBusinessRejection(db, actor, context, error, {onlyCodes})`（`server/lib/audit.js:19-32`，**必须在事务外调用**，仅对 HttpError 409 触发）；canonical 事务 `transaction(db, work)`（`server/db.js:2448`，SQLite `BEGIN IMMEDIATE`；MySQL 加全局闸门行 `mysql_transaction_gates` + 重试 + 不确定提交隔离）、只读 `readTransaction`（`:2529`）。
- **测试**：`server/mobile-approval-center.test.js`（describe `M3R approval aggregation API` `:139`、`M3R existing workflow dispatch contracts` `:169`；78 个用例）—— 覆盖 tab / limit / 计数、逐族可见性、排序、行预览、逐族 dispatch 路径，并断言无新增族（`:157`）。**已注册**（`scripts/testing/test-suites.js:630` FULL、`:933` FAST）。
- **前端**：route `approvals` → `src/components/MobileApprovalCenter.jsx`（`applicationRegistry.js:190`，桌面与移动**同一屏**；`mobileExposure:'approval-tab'`，`:37`），徽标在 `src/App.jsx:50`、`:186` 接 `pendingApprovalCount`。**无独立 `src/pages/platform-approvals.jsx`**。路由权限仅 `ORDERS_APPROVE`（`:37`）。

**残余**：第 5 个 tab「抄送我」在移动端被禁用（`src/components/MobileApprovalCenter.jsx:10`）。

### PL-06 Document Lifecycle —— `PARTIAL`

`server/modules/lifecycle-engine.js`（969 行）：

- **实体注册表是数据驱动的**：`LIFECYCLE_ENTITIES`（`:17-47`）冻结注册 **25 个实体**，每项 `{table, number, status, date, label}`（仅 `PURCHASE_RECEIPT` 额外有 `archivePhase` / `archivePermissionAny` / `viewPermissionAny`，`:25-29`）。
- **关系图是硬编码的**：`graphBuilder`（`:319-456`）以 BFS 队列遍历，对每个实体类型写死 SQL —— `:357-453` 有 **30+ 个 `if (node.entityType === 'X')` 硬编码分支**（如 `:379` `SELECT id FROM purchase_receipts WHERE purchase_order_id=?`）。**没有关系表，也没有关系注册表。**
- 其余硬编码集合：`ARCHIVE_STATUSES :57`、`ARCHIVE_ONLY_TYPES :58`、`REVERSIBLE_EFFECT_TYPES :59-65`、`EFFECTIVE_STATUS_BY_TYPE :67-76`、`SOURCE_ENTITY_TYPES :78-86`、`ENTITY_ALIASES :49-55`。
- 分类：`classifyGraph :458-489` → SAFE_DELETE / SAFE_CHAIN_DELETE / SAFE_REVERSAL_CLEANUP / ARCHIVE_ONLY / BLOCKED（`LIFECYCLE_CLASSIFICATIONS :6-12`）。
- 归档：`lifecycle_archives` 表；**仅 `PURCHASE_RECEIPT` 可归档**（`analyzeArchiveEligibility :210-237`，`:213` 对其余类型抛错）。
- 路由 6 条（`server/app.js:3949-3954`）：`GET /api/lifecycle/analyze`、`POST /api/lifecycle/archive`、`POST /api/lifecycle/restore`、`POST /api/lifecycle/cleanup`、`GET /api/lifecycle/records`、`GET /api/lifecycle/cleanup-events`。

**判 `PARTIAL` 的原因**：实体注册表已数据驱动，**但关系图仍是 30+ 处硬编码**，且 **25 个实体中只有 1 个可归档**。

**缺陷 PL-DEF-04**：生命周期 / 归档复用 `USERS_MANAGE` 权限（`lifecycle-engine.js:520`、`:535`、`:559`、`:609`、`:664`、`:930`）—— **管理员权限被当作文档生命周期能力使用**。`PURCHASE_RECEIPT` 归档是唯一有专属权限者（`:162`，`PURCHASE_RECEIPTS_MANAGE`）。

### PL-07 Document Relation —— `MISSING`

**不存在任何通用关系表**。全仓库无 `document_relations` / `links` / `references` / `source_links` 通用表。全部为域内表：

| 表 | 形状 | 通用？ | 位置 |
|---|---|---|---|
| `planned_order_source_links` | planned_order_id, source_type, source_id, source_line_id, quantity | 域内（planning） | `server/migrations/planning-domain-schema.js:187-197` |
| `finance_invoice_source_links` | invoice_id, invoice_side, source_type, source_id, source_line_id, invoiced_quantity, invoiced_amount_cents | 域内（finance） | `server/migrations/v22-finance-wave-c-invoice.js:24-35` |
| `receipt_notice_item_sources` | notice_item_id, purchase_order_item_id, delivery_schedule_id, allocated_quantity, converted_quantity, source_trace_json | 域内（procurement） | `server/migrations/procurement-outsourcing-schema.js:737-754` |
| `pr_conversion_allocations` | requisition(_item)_id, purchase_order(_item)_id, allocated num/den, conversion_id | 域内（procurement） | `server/migrations/procurement-sourcing-schema.js:73-101` |
| `sales_quotation_conversions` | quotation(_line), sales_order(_item), converted_qty_micros, price_cents, amount_cents | 域内（sales） | `server/migrations/sales-customer-wave3-quotation.js:45-57` |
| `inventory_form_conversions` | product_id, warehouse_id, quantity, from_form, to_form | 域内（inventory） | `server/migrations/v24-inventory-warehouse-closure.js:98` |
| `product_routing_operation_links` | routing ops | 域内（engineering） | `server/migrations/engineering-routing-schema.js:46` |
| `product_uom_conversions` | conversion_numerator / denominator | UOM，非单据 | `server/migrations/v13-phase6e-commercial-golive.js:50` |

**与合同基线的差距**：`solution.md:1215` 要求通用关系表达 `source / target / line / qty / reversal / remaining / lineage` **七项属性**。**没有任何一张表具备 `reversal` / `remaining` / `lineage`**（`source_trace_json` 是 JSON blob，不构成可查询列）。

### PL-08 Document Conversion —— `MISSING`

**零共享抽象**。每条转换线都是独立模块、独立表、独立数量表示、独立状态机、独立容量逻辑、独立错误码：

| 转换 | 模块 | 特征 |
|---|---|---|
| 收货通知 → 采购收货 | `server/modules/procurement-notice-conversion.js:87-243` | 经 canonical `createPurchaseReceiptCore`（导入 `:22`）；自有 `receipt_notice_item_sources` 容量 / `converted_quantity` 记账；`CONVERT_OPERATION='RECEIPT_NOTICE_CONVERT'`（`:30`） |
| 库存形态转换 | `server/modules/inventory-form-conversion.js` | **在 handler 内 `ensureTable()`（`:16-35`，运行时 DDL）**；`from_form`→`to_form`；单号 `FC-${Date.now()...}`（`:46`）；`applyInventoryMutation`（`:10`） |
| 采购申请 → 采购订单 | `server/modules/procurement-sourcing.js` | 分数数量 num/den；`conversion_id` |
| 报价 → 销售订单 | `server/modules/sales-quotations.js` | `converted_qty_micros` + 单价 + 金额；`idempotency_key` |
| 暂估收货转换 | `server/modules/accounting-inventory-cost.js:232` | `scope_id`、`estimate_cents`、`basis` |

唯一共享的是两个幂等辅助：`server/modules/financial-controls.js` 的 `idempotencyReplay` / `requestFingerprint` / `saveIdempotency`。**没有共享的 Source / Rule / Target 类型、没有转换注册表、没有转换审计合同。**

**缺陷 PL-DEF-05**：`server/modules/inventory-form-conversion.js:16-35` **在 handler 内执行运行时 DDL**（`ensureTable()`）—— 违反 schema 变更必须走 migration 的治理约束，且在 MySQL 上 DDL 隐式提交。

### PL-09 Numbering —— `PARTIAL`

**Schema**：

| 表 | 位置 | 定义 |
|---|---|---|
| `document_sequences` | `server/migrations/v13-phase6e-commercial-golive.js:63-66` | `document_type TEXT NOT NULL, period_key TEXT NOT NULL, next_value INTEGER NOT NULL CHECK(next_value>0), PRIMARY KEY(document_type, period_key)`。**无二级索引** |
| `document_number_allocations` | 同文件 `:67-69` | `idempotency_key TEXT PRIMARY KEY, document_type TEXT NOT NULL, document_no TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL` |
| `voucher_sequences` | `server/migrations/extended-schema.js:44-48` | `id, voucher_word_id, year, month, current_no DEFAULT 0, UNIQUE(voucher_word_id,year,month)` —— **死表** |
| `voucher_words` | `server/migrations/extended-schema.js:22-26` | `code, name, prefix, current_no DEFAULT 0, active` —— **死表**（`server/modules/accounting-config.js:38` 写入 `current_no=0` 后再未递增；凭证号由 `makeVoucherNo`（`server/app.js:5075`）生成） |

**分配器** `allocateDocumentNumber`（`server/modules/commercial-golive.js:41-50`）：

- 格式 `{TYPE}-{YYYYMM}-{00000}`；`period = String(businessDate).slice(0,7).replace('-','')` → **按月**，**无组织维度**，**无年度复位**。
- 前缀是**调用点的字面量**，无规则表；相关配置 `procurement_parameters.numbering TEXT DEFAULT 'PERIOD_SEQ'`（`server/migrations/procurement-outsourcing-schema.js:31`）只校验**单值**枚举 `new Set(['PERIOD_SEQ'])`（`server/modules/procurement-parameters.js:9`），是开关不是规则集。
- **并发**：`INSERT ... ON CONFLICT(document_type,period_key) DO UPDATE SET next_value=next_value+1 RETURNING next_value-1`（原子 upsert，种子 `next_value=2` 使首个值为 `00001`）。**绝无 `MAX+1`**（由 `server/v13-phase6e-commercial-golive.test.js:90` 断言）。唯一性后备是 `document_number_allocations.document_no UNIQUE`。
- **幂等竞态**：SELECT（`:42`）→ INSERT（`:48`）**非原子**；并发同键命中 PK 被映射为 **409**（`server/app.js:3908-3910`），**不是重放**。
- **事务**：分配器**自身不具事务性**，继承调用方。多数调用方包在 `atomic()`（`commercial-golive.js:52`）内 —— 发票 `:119`、账单 `:278`、红字 `:383`、期初 `:668`。**例外**：`makePurchaseOrderNo`（`server/app.js:5082-5084`）在 `app.js:5127` 被调用，而事务在 `:5134` 才开启 → **分配提交在单据事务之外，产生孤儿号且不回滚**。
- **MySQL 是另一套实现**：`server/database/mysql-adapter.js:78-80` 拦截该 SQLite SQL 并派发 `allocateSequence` action；`server/database/mysql-worker.js:138-151` 执行 `INSERT ... ON DUPLICATE KEY UPDATE next_value=next_value+1` 后在**同一 worker 连接上另发一条 SELECT**（`mysql-worker.js:116-129`）。**事务外时 INSERT 自动提交、SELECT 是另一快照 → 存在竞态窗口。**

**已覆盖 6 种单据**：`SI` 销售发票（`commercial-golive.js:122`）、`PB` 供应商账单（`:282`）、`SCN`/`PCN` 红字（`:389`）、`OB` 期初批次（`:671`）、`PO` 采购订单（`server/modules/planning-documents.js:1042`、`app.js:5083`）。

**未覆盖的 13+ 种单据各自造号**：

| 单据 | 造号方式 | 位置 |
|---|---|---|
| 销售订单 | `makeNo('SO')` → `SO-${Date.now()}-${rand4}` | `server/modules/sales-orders.js:141`（用于 `:459`） |
| 生产订单 | `'MO-' + Date.now().toString(36)` | `server/modules/manufacturing-orders.js:143`、`app.js:7763` |
| 采购申请 | `makeCode` → `PREQ-${YYYYMMDD}-${COUNT(*)+1}` —— **删除后必冲突** | `server/modules/planning-documents.js:85-92` |
| 销售报价 | `makeNo('QT')` | `server/modules/sales-quotations.js:62` |
| 会计凭证 | `makeVoucherNo` | `server/app.js:5075` |
| 库存调整 / 调拨 / 报废 | 各自 `Date.now()` | `app.js:5079`；`server/modules/inventory-transfer.js:28`；`server/modules/inventory-extensions.js:51` |
| 组装 / 拆卸 | `Date.now()` | `server/modules/inventory-assembly-disassembly.js:79` |
| 生产检验 | `Date.now()` | `server/modules/manufacturing-quality.js:207` |
| 预测 / MRP | `COUNT(*)+1` | `server/modules/planning.js:73`、`:78` |
| WIP 转移 | `Date.now()` | `server/modules/outsourcing-finance.js:953` |

**无 API、无 UI**：无 `/api/sequences` / `/api/numbering` / `/api/document-numbers` 路由；`src/pages/` 46 个文件中无编号页；`applicationRegistry.js` 的 platform 路由为 approvals `:37`、notifications `:99`、users `:100`、workflows `:106`（disabled）、data-cleanup `:107`（disabled），**无编号**。

**设计侧已登记**：`docs/design/sales-customer/01-domain-technical-design.md:140-141` 已把两张表登记为 Platform 资产（`EXISTING_CONVERGE`）→ 新服务必须**采纳**而非替换。

### PL-10 Attachment —— `MISSING`

**整个子系统不存在。** 全仓库附件相关命中穷举：

| 命中 | 位置 | 性质 |
|---|---|---|
| `attachment_count` 列 | `server/db.js:399`（ALTER）、`:471`（重建定义）、`:482`（拷贝） | **孤儿计数器 —— 无后端表、无任何代码写入或读取**（`server/*.js` 中仅 3 处 schema 行） |
| CSV 下载头 | `server/modules/decision-reports.js:162` `'Content-Disposition: attachment; filename=…'` | HTTP **下载**，非上传 |
| Blob 下载 | `src/api.js:99-100`、`src/pages/decision-reports.jsx:203` | 客户端下载 |
| 历史缺口登记 | `docs/archive/audits/system-audit.md:78`（P1）、`docs/archive/project-status-history.md:435`、`docs/archive/v1.3/audits/V1.3-PRE-RELEASE-FUNCTIONAL-GAP-AUDIT.md:507` | 历史文档 |

**无**附件 / 文件 / blob 表，**无** `file_id` / `mime` / `storage` 列，**无**上传目录（`data/` 仅 `.db`；`public/` 仅 `favicon.ico`），**无** multipart 解析，**无**二进制写路径，`src/` 中**无** `FormData`。

**HTTP 层的决定性约束**（`server/lib/http.js:96-117`）：全系统唯一请求体读取器 `readJson(req)` —— 内容类型**仅** `application/json`（`:108-109` 否则 415），大小上限 **1 MB**（`HTTP_JSON_LIMIT_BYTES`，合法区间 1 KB–10 MB，`:99-101`，超限 413）。**没有原始体读取器、没有 multipart 解析、没有二进制响应写出器**。上传必须新增 HTTP 层代码；base64 塞进 JSON 可复用现有上限，multipart 不行。

**可挂载点**：`accounting_vouchers`（`server/db.js:1495-1506`）、`purchase_orders`（`:1132-1147`）、`sales_orders`（`:1103-1120`）、`production_orders`（`:1449-1464`）、`production_inspections`（`server/migrations/manufacturing-quality-schema.js:253-277`）、`purchase_requisitions`（`server/migrations/planning-documents-schema.js:100-120`）、`sales_quotations`（`server/migrations/sales-customer-wave3-quotation.js:17-31`）。**不合格 / NC 单据无表**（全仓库无 CREATE TABLE）。所有单据表均以 `xxx_no TEXT NOT NULL UNIQUE` 为业务键（`db.js:1105`、`:1134`、`:1451`、`:1497`）。

### PL-11 Notification —— `PARTIAL`

**Schema**（`server/db.js:1733-1744`，**唯一**定义处，在 base-schema `db.exec` 块内，无独立迁移文件）：`id TEXT PK` / `user_id TEXT NOT NULL FK→users(id) ON DELETE CASCADE` / `title TEXT NOT NULL` / `content TEXT NOT NULL DEFAULT ''` / `type TEXT NOT NULL DEFAULT 'INFO'` / `source_type TEXT` / `source_id TEXT` / `is_read INTEGER NOT NULL DEFAULT 0` / `created_at TEXT NOT NULL`。**无任何索引**（`user_id` / `is_read` / `created_at` 均无）。`type` **无 CHECK 约束**，而前端假定 INFO / WARNING / SUCCESS / ERROR（`src/pages/platform-notifications.jsx:27-28`）。

**无** `notification_preferences` / `user_preferences` / `messages` / `inbox` / `todo` 表。

**模块仅 16 行**（`server/modules/platform-notifications.js`）：

- `listNotifications :3-8` —— 权限 `DASHBOARD_VIEW`；`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`；`unreadCount` 为全表未读计数；返回 `{notifications, unreadCount}`（**原始 snake_case 行**）。
- `markNotificationRead :10-16` —— 权限 `DASHBOARD_VIEW`；按 `actor.id` 限定 `is_read=1`；返回 `{ok:true}`。

**路由**：`GET /api/notifications`、`POST /api/notifications/read`（`server/app.js:2660-2671`）。

**判定 `PARTIAL` 的核心事实 —— 生产者数量为零**：全仓库（`server/`、`src/`、`scripts/`，全部 `.js` / `.mjs` / `.jsx` / `.ts` / `.sql`）对 `INSERT INTO notifications` / `INSERT OR REPLACE INTO notifications` / `INSERT IGNORE INTO notifications` / `REPLACE INTO notifications` 以及更宽松的 `INTO notifications` 的检索**全部零命中**。`server/db.js` 仅在 `:1733` 提及该表，**无种子行**。`server/lib/` 中**不存在** notifier 辅助（`audit.js`、`formula-evaluator.js`、`http.js`、`inventory-*.js`、`logger.js`、`payment-terms.js`、`route-table.js`、`search-fold.js`、`stock.js`）；`notifyUser` / `pushNotification` / `createNotification` / `sendNotification` / `notif(` 全域零命中。**写路径完全不存在 —— 既非"定义了未使用"，也非"使用了未定义"，而是根本没有。**

→ 该表运行时**永远为空**，`unreadCount` **结构上恒为 0**，通知中心是空壳。

**前端**：`src/pages/platform-notifications.jsx`（53 行）—— 类型 / 标题 / 内容 / 时间 / 状态表格；「全部标为已读」按钮（`:19-25`，POST `{body:{}}` → 全量置已读）；空态 `{!items.length && <Empty text="暂无通知"/>}`（`:49`）→ **永久空态**。路由 `notifications` **enabled**（`applicationRegistry.js:99`，`mobileExposure:'messages-tab'`），`src/App.jsx:156` 将 `mobileTab==='messages'` 指向同一屏，`src/components/MobileShell.jsx:40` 定义 messages tab。**无徽标**：`src/App.jsx:186` 的 `tabBadges` 只有 `approvals`，messages tab 即使接口返回计数也不显示。

**候选生产源（现有"待办"机制，目前都不写通知）**：审批中心（`server/modules/approvals.js::listApprovals`，`app.js:3945`）、移动审批中心（`src/components/MobileApprovalCenter.jsx`，徽标已接 `src/App.jsx:50`、`:186`）、库存月结阻塞项（`server/modules/inventory-period-close.js:254 runInventoryCloseChecks` 的 BLOCKING / WARNING 项、`:95-119`）、`systemHealth`（`server/modules/financial-inventory.js:328`）、待生成会计事件（`src/pages/accounting-analytics.jsx:147`）、信用特批（`server/modules/credit-special-approval.js`，`app.js:714-717`）。

**测试**：涉及通知的测试文件均已注册（`scripts/testing/test-suites.js` 行 424、612、629、631-633、735、783、808-809、816），覆盖文件含 `server/app.test.js:321`、`server/teacher-acceptance-matrix.test.js:285`、`:771`、`server/ui-source.test.js:109`、`:174`、`server/v17-domain-alignment.test.js:64`、`:79-88`、`server/mobile-shell.test.js:385` 等。**但全部只断言结构（路由存在、页面存在、导入契约），无任何生产者行为、未读计数或持久化断言** —— 这正是零生产者缺陷长期不可见的原因。

### PL-12 Audit —— `COVERED`

| 项 | 事实 |
|---|---|
| Schema | `audit_logs`（`server/db.js:1584-1592`），`id` / `user_id` / `action` / `entity_type` / `entity_id` / `detail` / `created_at` |
| 写入 | `audit(db, userId, action, entityType, entityId, detail)`（`server/lib/audit.js:4-6`），`id` 由 `id()`（`server/db.js:2569`，`randomUUID`）生成 |
| 业务拒绝审计 | `auditBusinessRejection(db, actor, context, error, {onlyCodes})`（`server/lib/audit.js:19-32`）—— **必须在事务外调用**，仅对 HttpError 409 触发 |
| 读 | `GET /api/audit-logs`（`server/app.js:4261` → handler `app.js:6025`） |
| 使用范围 | 全部 8 个业务域的关键 mutation 均调用 |
| 测试 | `server/business-integrity-stabilization.test.js:266`、`:274` 断言 `audit_logs` 的 `entity_type='INVENTORY_CHECK'` 计数在失败路径**不增长**（反例）；另有 `server/accounting-analytics-w1-w2.test.js`、`server/accounting-analytics-w3.test.js`、`server/accounting-analytics-w7.test.js`、`server/buyers.test.js`、`server/m1c-outsourcing-gl-policy-guard.test.js` 等含 `audit_logs` 断言 |

**残余**：

**缺陷 PL-DEF-06**：`auditBusinessRejection`（业务拒绝审计路径）**没有任何测试文件引用**（全仓库 `server/*.test.js` 中 `auditBusinessRejection` / `BUSINESS_REJECTION` 零命中）—— 正例与反例均未覆盖。

**缺陷 PL-DEF-07**：`audit_logs` **无 `business_date` / `request_id` / before-after 结构化字段**，`created_at` **无索引**。该项已作为 `M1-F-12` 登记在 `docs/decisions/OPEN-BUSINESS-DECISIONS.md:88`，当前约束为「**Platform / Finance 域独立授权**；本轮不修改审计 schema」，状态「跨域阻塞」。

### PL-13 Period Control —— `PARTIAL`

**五套平行存储**：

| 体系 | 表 | CREATE TABLE | 模块 / 路由 |
|---|---|---|---|
| 会计（legacy 通用） | `period_closures` | `server/migrations/extended-schema.js:36-43`（`period UNIQUE` / `period_year` / `period_month` / `closure_type` / `status` / `closed_by` / `closed_at` / `checklist_passed` / `created_at`；FK `closed_by→users`） | `server/modules/extended.js:148`、`:155`、`:206`、`:236`、`:266`；`server/app.js:4115-4126` |
| 库存月结 | `inventory_period_closures`、`inventory_period_snapshots` | `server/migrations/inventory-extensions-schema.js:105-119`（`period_key` / `status CHECK CLOSED\|REOPENED` / `closed_by` / `closed_at` / `reopened_by` / `reopened_at` / `notes`；`period_key` UNIQUE `:120-122`）、`:128-141` | `server/modules/inventory-period-close.js:390`、`:399`、`:404`、`:410`、`:416`、`:422`；`app.js:4357-4364` |
| 会计期末 | `period_end_definitions`、`period_end_runs`、`profit_transfer_runs` | `server/migrations/accounting-period-end-schema.js:60-74`、`:78-89`、`:93-104` | `server/modules/accounting-period-end.js:53`、`:210`、`:235`、`:361`、`:372`、`:385`、`:438`、`:458`；`app.js:1981-2031` |
| 重开历史 | `period_reopen_history` | `server/migrations/v13-phase6a-financial-controls.js:152-156` | **无专属写入方**（仅 `extended.js` 的 `unclosePeriod` 经 `audit_logs` 记录） |
| 管理 / 经营 | `operating_period_closures` | `server/migrations/management-accounting-schema.js:131-142`（`management_book_id` / `period` / `status` / `closed_by` / `closed_at` / `reopen_reason` / `reopened_by` / `reopened_at`；UNIQUE(`management_book_id`,`period`)） | `server/modules/management-accounting.js:484`、`:497`、`:534`；`app.js:2243-2257` |
| 财务业务关账（相邻轴） | `finance_business_closures` | `server/migrations/v22-finance-wave-a-foundation.js:202-216`（`close_type AR/AP/TREASURY`） | `server/modules/finance-business-close.js` |

**共同的 close/reopen 逻辑被复制 5 份**，但键列名（`period` vs `period_key`）、范围列（无 / `management_book_id` / `close_type`）、状态词表（`OPEN|CLOSED` vs `CLOSED|REOPENED`）、重开历史处理（仅库存表有 `reopened_by`；仅通用表有独立 `period_reopen_history`）**均不一致**。`period_closures` 已被 `docs/design/finance-operations.md:193`、`:284` 显式重分类为 COMPATIBILITY，但**仍持有会计关账路由**。

**canonical 期间断言**：`assertFinancialPeriodsOpen`（`server/modules/financial-inventory.js:24-46`，已导出）—— **只查两张表**：

1. `inventory_period_closures WHERE status='CLOSED'`（`:27`），截止期由 `closedThrough`（`:13-22`，连续期间链）计算；除非 `allowClosedInventoryPeriod===true`（`:33-38`）否则 409 `INVENTORY_PERIOD_CLOSED`；
2. `period_closures WHERE status='CLOSED'`（`:39`）→ 409 `FINANCIAL_PERIOD_CLOSED`。

**它不查** `operating_period_closures`、`period_end_runs`、`period_end_definitions`、`finance_business_closures`、`period_reopen_history`。

**调用方**：`server/app.js:5569`、`:5657`、`:5676`、`:6881`、`:7123`、`:7240`、`:7834`；`server/lib/inventory-mutation.js:511`；`server/modules/commercial-golive.js:121`、`:237`、`:280`、`:310`、`:384`、`:520`、`:521`、`:587`；`server/modules/financial-inventory.js:103`、`:124`、`:138`、`:148`、`:158`、`:204`、`:222`、`:271`；`server/modules/inventory-assembly-disassembly.js:338`；`server/modules/inventory-extensions.js:242`；`server/modules/manufacturing-execution.js:226`、`:263`；`server/modules/manufacturing-materials.js:141`、`:292`；`server/modules/manufacturing-orders.js:18`。

**缺陷 PL-DEF-08**：**存在三个期间闸门**。除 canonical 的 `assertFinancialPeriodsOpen` 外，另有 `assertInventoryPeriodOpen`（`server/lib/inventory-mutation.js:271-286`，**只查 `inventory_period_closures`**，截止期算法不同、错误码不同），被 `inventory-mutation.js:510` 与 `server/modules/outsourcing-finance.js:1115` 调用；以及 `checkPeriodNotClosedForVoucher`（`server/app.js:5778-5783`，直接读 `period_closures`，绕过 canonical）。

**缺陷 PL-DEF-09**：`operating_period_closures` 与 `finance_business_closures` **对所有 canonical mutation 闸门不可见**；`server/modules/finance-business-close.js:54` 显式把库存闸门委托给重复实现 `assertInventoryPeriodOpen`。

**前端**：`src/pages/accounting.jsx:186 PeriodManagement`（调用 `/api/period-closures` `:206`、`/closure-checklist` `:231`、创建 `:246`、关闭 `:260`）；`src/pages/inventory-extensions.jsx:44-63`（完整月结工作面：list / status / precheck / close / reopen `:45-63`）。**管理会计期间与会计期末定义无前端工作面**；`src/navigation/applicationRegistry.js` 中 period / closure 路由数为 **0**。

## 4. WF-01～WF-08 逐项复核（B3122 手册能力）

**手册要求基线**：`document.md §22.22`（B3122《工作流设计与配置》，目标 Domain = Platform）。

### WF-01 流程定义 —— `PARTIAL`

手册基线要求「图形化 / 结构化定义节点、连接、条件、参与人和动作」。现状：定义 **CRUD 的外壳存在**（`approval_workflows` 表 + `listWorkflows` / `createWorkflow` + `GET/POST /api/workflows`），但

- **`steps` 是无消费者的死列**，无节点 / 连接 / 条件 / 参与人 / 动作的模型；
- **无 update / delete 路由**，`src/pages/platform-workflows.jsx` 的编辑永远 INSERT；
- **前端路由 `enabled:false`**（`applicationRegistry.js:106`），operator **不可达**；
- 前端读取不存在的 `item.active` 列（`:21`），`entity_type` 选项与族键不匹配（`:56`）。

手册基线表记该行 `PARTIAL`（"当前仅固定审批族 / 基础 workflow data"）—— 本次复核**维持 `PARTIAL`**，但把该判定精确化为：**CRUD 外壳存在 + 数据模型缺失 + operator 不可达**。

### WF-02 版本与发布 —— `MISSING`

无 version 表、无 draft / published 状态、无模板启用 / 停用、无测试运行、无发布记录。手册基线记 `MISSING` —— **维持**。

### WF-03 业务模板绑定 —— `MISSING`

无任何"按组织 / 单据 / 条件绑定流程模板"的表或路由。`procurement_parameters.numbering` 之类参数表与流程模板无关。手册基线记 `MISSING` —— **维持**。

### WF-04 流程实例 —— `PARTIAL`

**无实例表**。6 个审批族各自以业务表的 `status` + `reviewer_id` / `approved_by` / `approver_id` 列充当**族内特化的实例状态**（见 PL-04 族表）。`GET /api/approvals` 按需实时计算待办，无实例物化、无历史路径、无实例查询。

手册基线记 `PARTIAL`（"当前五类 approval 是固定适配器"）—— **维持 `PARTIAL`**，并精确化为：**族内特化实例存在，通用实例模型不存在**。

**缺陷 PL-DEF-10**：**合同称"五审批族"，代码实际为 6 族 + 1 个信用特批**（`server/modules/approvals.js:5-137` 的 6 项 + `server/modules/credit-special-approval.js`；`src/navigation/applicationRegistry.js:7` 的 `APPROVAL_FAMILIES` 亦为 6 项）。`document.md:158`、`:573` 与 `solution.md:1238` 仍写"五审批族"—— 属**合同表述漂移**，须在 Platform Requirement 中一并校正。

### WF-05 节点任务 —— `PARTIAL`

审批中心**实时计算**待办（`server/modules/approvals.js:233-250`），无 task 表、无 assignee、无 task 状态、无完成时间。`server/modules/approvals.js` 的 `normalizeRow :162` 把 6 族的异构行归一成统一 tab 视图。**有 operator 工作面**（`src/components/MobileApprovalCenter.jsx`，含徽标）。

手册基线记 `PARTIAL`（"Approval Center 有固定任务"）—— **维持**。

### WF-06 业务动作 —— `MISSING`

**无 generic business callback 合同**。工作流节点无法执行表单操作 / 通知 / 下推。现有 6 族的"动作"是域模块内写死的状态迁移副作用（`approveSalesOrder` → 信用闸门 + 预留 + 通知外部模块），不是可声明的业务回调。手册基线记 `MISSING` —— **维持**。

### WF-07 监控 —— `MISSING`

**无流程监控**：无实例列表、无节点路径、无状态看板。`/api/lifecycle/records`（`app.js:3953`）是生命周期归档记录，不是工作流实例监控。手册基线记 `MISSING` —— **维持**。

### WF-08 暂停 / 终止 / 恢复 —— `MISSING`

无暂停 / 终止 / 恢复的实例级控制，也无流程定义级控制。6 族的"拒绝"只是状态机的终态之一，不等于"终止流程"。手册基线记 `MISSING` —— **维持**。

## 5. 结构缺口登记

| ID | 缺口 | 依据 |
|---|---|---|
| `PL-GAP-01` | **Platform 建组织模型会触发 Master & Engineering 域的 Hard Stop** —— `docs/requirements/master-engineering.md:27` 判 Multi-Organization 为 `OUT_OF_SCOPE — CURRENT PRODUCT BASELINE`，`:194` 将「Multi-Organization 需求出现」列为 M&E 的 Hard Stop Condition；而 `document.md:126`、`:392` 把 Organization 归属判给 M&E + Platform | `document.md:126`、`:392`、`:637`；`docs/requirements/master-engineering.md:27`、`:194` |
| `PL-GAP-02` | **无通用工作流引擎底座**：无 definition 节点 / 边 / 条件 / 参与人模型、无 version / publish、无 binding、无 instance / node / task / action / transition 表、无业务回调合同、无监控、无实例级暂停 / 终止 / 恢复 | §4 WF-01～WF-08；`server/db.js:1746-1755` |
| `PL-GAP-03` | **无通用附件能力**：无表、无上传、无 multipart 解析、无二进制写出、无附件工作面 | §3 PL-10；`server/lib/http.js:96-117` |
| `PL-GAP-04` | **无通用编号服务**：无规则表、无 API、无 UI、13+ 种单据各自造号、采购申请号存在删除后必冲突 | §3 PL-09 |
| `PL-GAP-05` | **通知零生产者**：写路径完全不存在 | §3 PL-11 |
| `PL-GAP-06` | **无通用单据关系表**：`solution.md:1215` 要求的 `reversal` / `remaining` / `lineage` 属性在所有表中均缺失 | §3 PL-07 |
| `PL-GAP-07` | **无通用转换抽象**：5 条转换线 100% 域内手写 | §3 PL-08 |
| `PL-GAP-08` | **生命周期关系图硬编码**：30+ 处实体专属 SQL 分支，25 个实体中仅 1 个可归档 | §3 PL-06 |
| `PL-GAP-09` | **期间控制 5 套平行存储 + 3 个闸门**，canonical 断言只覆盖 2 张表 | §3 PL-13；`server/modules/financial-inventory.js:24-46` |
| `PL-GAP-10` | **无通用 SOD 引擎**，6 族审批的自审批防护各自硬编码，生产订单族缺失 | §3 PL-02 |
| `PL-GAP-11` | **平台权限码缺失**：`AUDIT_*` / `NOTIFICATION_*` / `NUMBERING_*` / `ATTACHMENT_*` / `ORGANIZATION_*` / `LIFECYCLE_*` / `DOCUMENT_RELATION_*` / `DOCUMENT_CONVERSION_*` 均不存在；生命周期暂借 `USERS_MANAGE` | §3 PL-06、PL-11；`server/db.js:60-335` |
| `PL-GAP-12` | **无路由权限覆盖断言**：`server/lib/route-table.js:45-56` 禁止描述符携带权限元数据，权限覆盖只能靠逐域测试证明 | §3 PL-01 |

## 6. 真实缺陷登记

| ID | 缺陷 | 位置 | 严重度 |
|---|---|---|---|
| `PL-DEF-01` | 生产订单审批**无自审批防护**（6 族中唯一缺口） | `server/modules/manufacturing-orders.js:164-169` | 高 |
| `PL-DEF-02` | 信用域从销售域导入 `actorHas`，形成跨域原语耦合 | `server/modules/credit-scope.js:2` | 中 |
| `PL-DEF-03` | `/api/approvals/…` 下禁止任何变更方法（测试锁定），通用引擎须换前缀 | `server/mobile-approval-center.test.js:166` | 约束（须遵守） |
| `PL-DEF-04` | 生命周期 / 归档借用管理员权限 `USERS_MANAGE` | `server/modules/lifecycle-engine.js:520`、`:535`、`:559`、`:609`、`:664`、`:930` | 中 |
| `PL-DEF-05` | 库存形态转换在 handler 内执行**运行时 DDL** | `server/modules/inventory-form-conversion.js:16-35` | 中 |
| `PL-DEF-06` | `auditBusinessRejection` 业务拒绝审计路径**零测试覆盖** | `server/lib/audit.js:19-32` | 中 |
| `PL-DEF-07` | `audit_logs` 缺 `business_date` / `request_id` / before-after 结构化字段，`created_at` 无索引（已登记 `M1-F-12`，跨域阻塞） | `server/db.js:1584-1592`；`docs/decisions/OPEN-BUSINESS-DECISIONS.md:88` | 中（需裁定） |
| `PL-DEF-08` | 三个期间闸门并存且语义不一致 | `server/modules/financial-inventory.js:24-46`；`server/lib/inventory-mutation.js:271-286`；`server/app.js:5778-5783` | 高 |
| `PL-DEF-09` | `operating_period_closures` / `finance_business_closures` 对所有 canonical 闸门不可见 | `server/modules/financial-inventory.js:24-46`；`server/modules/finance-business-close.js:54` | 高 |
| `PL-DEF-10` | 合同称"五审批族"，代码为 6 族 + 1 信用特批 | `document.md:158`、`:573`；`solution.md:1238`；`server/modules/approvals.js:5-137` | 低（表述漂移） |
| `PL-DEF-11` | 编号分配在采购订单路径中发生在单据事务之外 → 孤儿号且不回滚 | `server/app.js:5127`（分配）vs `:5134`（事务开启） | 中 |
| `PL-DEF-12` | 编号分配器幂等 SELECT→INSERT 非原子，并发同键返回 409 而非重放 | `server/modules/commercial-golive.js:42`、`:48`；`server/app.js:3908-3910` | 中 |
| `PL-DEF-13` | 采购申请号 `PREQ-${YYYYMMDD}-${COUNT(*)+1}` 删除后必冲突 | `server/modules/planning-documents.js:85-92` | 中 |
| `PL-DEF-14` | `voucher_sequences` / `voucher_words` 为死表 | `server/migrations/extended-schema.js:22-26`、`:44-48`；`server/modules/accounting-config.js:38` | 低 |
| `PL-DEF-15` | 通知中心前端永久空态；messages tab 无徽标 | `src/pages/platform-notifications.jsx:49`；`src/App.jsx:186` | 中 |
| `PL-DEF-16` | 工作流前端读取不存在的 `item.active` 列；`entity_type` 选项与族键不匹配；编辑永远 INSERT | `src/pages/platform-workflows.jsx:21`、`:51`、`:56` | 中 |

## 7. 与既有基线的差异

- **`document.md §22.22` 的 8 项覆盖初判全部维持**：3 `PARTIAL`（流程定义 / 流程实例 / 节点任务）+ 5 `MISSING`（版本与发布 / 业务模板绑定 / 业务动作 / 监控 / 暂停终止恢复）。本台账**未推翻任何一项**，只把每项的 `PARTIAL` / `MISSING` 精确到具体代码事实。
- **`document.md:637` 判 Platform 的 "Organization Scope / Document Relation/Conversion / Numbering" 为 `PARTIAL`**：本台账按"通用能力是否存在"判定，三者（PL-03 / PL-07 / PL-08）与 Notification（PL-11）判为 `MISSING` 或 `PARTIAL`，附件（PL-10）判 `MISSING`。差异源于判定粒度：`document.md` 的 `PARTIAL` 承认域内存在相关事实，本台账追问**是否已有平台级可复用能力**。本台账是**更细的粒度**，不与 `document.md` 冲突。
- **8 个业务域已签发的 Acceptance 与 Freeze 不受本台账影响**：本台账只覆盖 Platform，不重述任何其他域的结论。
- **`docs/status/CAPABILITY_MATRIX.md` 的 B3122 行 `NOT_STARTED` 维持**：审计完成不等于实施开始。

## 8. 未解决事项与暂停点

### 8.1 需业务所有者裁定（阻塞 Requirement 起草）

| ID | 待裁定 | 为什么阻塞 |
|---|---|---|
| `PL-DEC-01` | **Platform 域闭合范围**：本台账识别 21 项能力（13 平台长期 + 8 B3122）。业务所有者 2026-11-13 指示列举了 5 个子系统（Generic Workflow 引擎 / Attachment / Org Scope / Notification 生产者 / Numbering 服务），但未提及 PL-02（SOD）、PL-07（Document Relation）、PL-08（Document Conversion）、PL-06（生命周期关系图去硬编码）、PL-13（期间控制收敛）。**这些能力若不显式裁定为 `OUT_OF_SCOPE` 或延期，Platform 域无法达到"全部 `COVERED`"**，也就无法签发域级 Acceptance | 决定 Requirement 的范围枚举与 `OUT_OF_SCOPE` 清单 |
| `PL-DEC-02` | **`PL-GAP-01`：Platform 建立组织模型是否触发 Master & Engineering 域的 Hard Stop 条件**，以及 M&E 的 Multi-Organization `OUT_OF_SCOPE` 判定是否随之修订 | 决定 Org Scope 的归属边界（AGENTS.md §4.4 跨域影响必须回到 Requirement 层裁定） |
| `PL-DEC-03` | **`PL-DEF-07`（`audit_logs` 结构化字段）** 是否纳入 Platform 范围（现登记为 `M1-F-12`，需 Platform / Finance 双 Owner 授权） | 决定审计 schema 是否变更 |

### 8.2 不需裁定、但须在 Requirement 中明确写死的约束

- 通用工作流引擎**必须委托域模块**，不得重写 6 族的状态机、信用闸门、幂等与副作用（PL-04）。
- 通用引擎的变更入口**必须使用新路径前缀**（PL-DEF-03）。
- 6 个既有审批族在 Generic Workflow 完成前**保持 canonical**（`document.md:158`、`:573`；`solution.md:1238`）。
- 编号服务必须**采纳**现有 `document_sequences` / `document_number_allocations`（设计侧已登记为 Platform 资产，`docs/design/sales-customer/01-domain-technical-design.md:140-141`），并保持 `server/v13-phase6e-commercial-golive.test.js:90` 的原子性断言为绿。
- MySQL 与 SQLite **双 DDL** 必须同批交付；`resolveMySqlColumnType`（`server/database/mysql-schema.js:183`）是唯一物理类型来源；DDL 必须在 `transaction()` 之外执行（MySQL 隐式提交）。
- 新增 `server/*.test.js` **必须**登记进 `scripts/testing/test-suites.js` 的 FAST / FULL / HEAVY（`validate() :1001` 对未分类文件直接失败）；测试发现根只有 `server` 与 `src/lib`（`:965-981`）。
- 新增平台权限码必须登记在 `server/db.js:60` 的 `PERMISSIONS` 目录（`roles.js:68` 保证 ADMIN 自动获得全部新码）。
- 附件上传若走 multipart，**必须**新增 HTTP 层代码；`readJson`（`server/lib/http.js:96-117`）只接受 `application/json` 且上限 1 MB。

### 8.3 暂停点

- 本台账**不构成** Capability Verified、Capability Freeze、Domain Acceptance、Manual Closure 或 Release Readiness，**也不构成任何 Implementation 授权**。
- 下一阶段（Requirement）待 `PL-DEC-01`～`PL-DEC-03` 裁定后开始。
- 本轮**未**修改 `server/`、`src/`、`scripts/` 任何代码；**未**执行真实环境 migration、业务数据库写入、真实 MySQL Gate、push / merge / tag / 发布 / 部署；**未**代替业务所有者签发任何 Acceptance 或 Freeze 标识。
