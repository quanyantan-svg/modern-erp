# Manufacturing & Quality — Requirement

> 状态：`ACTIVE`
> Owner：Manufacturing & Quality
> 权威来源：`document.md` §29
> 来源：`document.md` §29（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 29. Manufacturing & Quality Domain Closure Requirement

> 本节固化 Manufacturing & Quality Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自 Prompt §0–§43；本节 Coverage 以真实仓库审计 + 本 Domain 实施 + Verification 结果为准。
> Design 见 `solution.md §24`；实施 Waves A–H 见 `solution.md §24.13`。

### 29.1 范围与边界

本 Domain Closure 的范围是：

- Production Order 全生命周期（Draft → Submit → Approve → Release → Start → Complete / Cancel）；
- Production Material List lifecycle 与受控编辑；
- Production Material Issue / Supplement / Return（含合并领料、批拣）；
- Operation Plan lifecycle + Engineering Snapshot；
- Forward / Backward Scheduling（Calendar / Shift / Work Center Capacity）；
- Shop-floor Execution（Operation Report / Reversal / Internal Handoff / Topology / Outsourced 边界）；
- Manufacturing Quality Master（Inspection Item / Detection Value / Instrument / Inspection Plan）；
- Operation Inspection / Product Inspection / Production Receipt Quality Gate；
- Nonconforming Receipt 边界（LOT/SERIAL HOLD）；
- Production Scan Execution（Material + Operation）；
- Production Execution / Material Issue Analytics。

**不在本 Domain 范围：**

- 库存 inventory / LOT/SERIAL mutation（Inventory & Warehouse Domain 拥有）；
- 成本计算（Finance Operations Domain）；
- 库存状态转换（untracked nonconforming 隔离 = Inventory & Warehouse Domain dependency）；
- 完整 Outsourcing Order / Issue / Receipt / AP（Procurement & Outsourcing Domain）；
- MRP / 需求计划（Planning Domain）；
- 完整 APS / MES / HMI；
- Multi-Organization / Cross-org Operation Transfer（OUT_OF_SCOPE）；
- B3105 完整 Barcode / PDA 平台（Inventory & Warehouse Domain）；
- B3106 存货核算 / Cost Engine rewrite（Finance Operations Domain）。

### 29.2 Manual Evidence Baseline（摘要）

完整 43 项 MQ-01 ~ MQ-43 evidence 在会话上下文；本节列出关键 contract：

| 关键 contract | 含义 |
|---|---|
| 生产订单生命周期 | B3119：`保存 → 提交 → 审核 → 下达 → 开工 → 执行 → 完工`；本系统：`DRAFT / PENDING / SUBMITTED / APPROVED / RELEASED / IN_PROGRESS / COMPLETED / CANCELLED` |
| Approval | Production Order Approval 不等于实际允许车间执行；Release 是允许生成/下达正式执行任务的业务节点 |
| BOM Resolver | 不再长期依赖 `status='ACTIVE' ORDER BY ... LIMIT 1`；必须经 Engineering Resolver |
| Engineering Snapshot | 释放后 `BOM / Routing / Control Code / Work Center / standard time` 冻结 |
| Material List | 由 frozen BOM 形成；执行后不得任意修改；额外需求必须走 Supplement |
| Combined Picking | 多 Production Order 合并领料；per-order 分配与 WIP 归属保留 |
| Supplement | 临时增加非原 BOM material line；走与 Issue 相同 inventory / tracking / voucher / WIP / period / audit / idempotency 链路 |
| Return Reason | 来料不良 / 良料退回 / 制程不良；reason 必须支持 audit / statistics |
| Production Report | 与 `production_operation_reports` 唯一权威合并 |
| Byproduct | 副产品数量维护；成本分配留 Finance |
| Operation Plan | 自动/手工生成；GENERATED → SUBMITTED → APPROVED → RELEASED → EXECUTABLE |
| Scheduling | Forward / Backward；按 planned_start / planned_finish + Calendar + Work Center 容量 |
| Topology | LINEAR / NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE；当前 LINEAR 完整；NETWORK 必须 fail closed |
| Control Code | 是否参与排程 / 加工方法 / 汇报方法 / 检验方法 |
| Internal Handoff | 同组织普通工序自动流转 |
| Outsourced 边界 | 内部不自动完成；OUTSOURCING_HANDOFF_REQUIRED |
| Inspection Item / Detection Value / Instrument | master + lifecycle |
| Inspection Plan | 引用 Inspection Items + criteria / unit / instrument；与 QCP 形成 when / what |
| Sampling | 复用现有 FULL / FIXED_QUANTITY / PERCENTAGE |
| Operation Inspection | Report → Inspection → PASS / FAIL → Released quantity |
| Product Inspection | Receipt Confirm 按 policy gate；REQUIRED 时等待 PASS / WAIVED |
| Nonconforming | LOT/SERIAL HOLD 隔离；untracked status = Inventory dependency |
| Scan Execution | scanner wedge input；document no / operation code / LOT/SERIAL identity token |

### 29.3 Capability Audit Matrix（已审计）

完整 43 项 Coverage/Gap/Implementation Decision 见本节上表 `§22.19`。关键 deferred 类别按合法 reason 标注：

- `OUT_OF_SCOPE — CURRENT PRODUCT BASELINE`：Multi-Org Distribution、Cross-Org Operation Transfer；
- `CROSS_DOMAIN_DEPENDENCY`：Byproduct Cost Allocation（Finance）、完整 Outsourcing Order / Issue / Receipt / AP（Procurement）、untracked Nonconforming Stock Status（Inventory）；
- `DEFER_SOURCE_DETAIL`：Mold / Mold Combination / Complex Auxiliary Attributes；
- `SEMANTIC_MISMATCH`：原 `DRAFT / PENDING / IN_PROGRESS / COMPLETED` 状态模型 → 本轮补 Submit / Approve / Release 业务节点；BOM Resolver 在生产路径由 `status='ACTIVE' LIMIT 1` 收敛为 canonical Engineering Resolver。

### 29.4 目标 Capability Closure 要求

| Domain Capability | 落地后 Coverage 目标 | 关键 Acceptance |
|---|---|---|
| Production Order Lifecycle | `COVERED` | Draft / Submit / Approve / Reject / Release / Start / Complete / Cancel；状态机不允许跳跃 |
| Production Order Approval | `COVERED` | 接入 Platform Approval family `PRODUCTION_ORDER`；Audit + idempotency |
| Engineering Resolver 消费 | `COVERED` | `resolveEffectiveBomForCaller` 在生产订单 create / instruction 释放路径被调用 |
| Material List lifecycle | `COVERED` | generated / controlled edit / approved / released |
| Material Issue | `COVERED` | 复用现有 `production_material_issues`；不重写 |
| Material Supplement | `COVERED` | 新建 `production_material_supplements`；走同一库存 / voucher / WIP / period / audit / idempotency 链路 |
| Material Return | `COVERED` | reason 扩展；走现有 handler |
| Batch Picking / Combined Issue | `COVERED` | `production_batch_issues` 头 + 行；atomic failure；per-order 归属保留 |
| Byproduct | `PARTIAL — CROSS_DOMAIN_DEPENDENCY` | 表 + API + UI + Receipt 接入；cost allocation = Finance |
| Operation Plan lifecycle | `COVERED` | GENERATED / SUBMITTED / APPROVED / RELEASED / EXECUTABLE；snapshot |
| Forward Scheduling | `COVERED` | planned_start + Work Calendar + Shift + operation duration；non-working skip |
| Backward Scheduling | `COVERED` | planned_finish - work backward |
| Calendar Consumption | `COVERED` | `engineering_work_calendars` / `engineering_shifts` 真实读 |
| Capacity Warning | `COVERED` | Work Center overload |
| Control Code Snapshot | `COVERED` | `production_order_operations` 包含 snapshot fields |
| Topology | `COVERED` (LINEAR) + `PARTIAL` (NETWORK) | NETWORK 必须 fail closed |
| Operation Report | `COVERED` | 复用现有 verification |
| Internal Handoff | `COVERED` | `availableInput()` 自动流转 |
| Operation Transfer Scan | `COVERED` | PDA：source / destination operation + qty → 工序转移；内部自动流转仍走 `availableInput()` |
| Outsourced Boundary | `COVERED` | snapshot + OUTSOURCING_HANDOFF_REQUIRED |
| Inspection Item / Detection Value / Instrument Master | `COVERED` | CRUD + lifecycle |
| Inspection Plan | `COVERED` | 与 QCP 形成 when / what |
| Sampling 复用 | `COVERED` | 复用 `calculateSampleQuantity` |
| Operation Inspection | `COVERED` | `released_quantity` 与 `reported_quantity` 区分 |
| Product Inspection | `COVERED` | 按 policy gate；检验类型词表受控并由服务端校验 |
| Production Receipt Quality Gate | `COVERED` | `assertProductionReceiptQualityGate` + `quality_state` 字段；REQUIRED 等待 PASS，WAIVED 放行并留审计 |
| Nonconforming | `COVERED`（本轮） | LOT/SERIAL HOLD 隔离 + `nonconforming` 标记 + 处置入口；untracked status 仍为 Inventory 依赖 |
| Production Scan | `COVERED` | Material + Operation + Transfer 三个动作；scanner wedge input |
| Analytics | `COVERED` | Execution Summary + Material Issue Summary；保留 WIP / Yield / Capacity / Cost |

### 29.5 Permission 约束

新增 / 既有 permission family（与实现一致）：

- 既有：`PRODUCTION_ORDERS_VIEW` / `PRODUCTION_ORDERS_CREATE` / `PRODUCTION_ORDERS_START` / `PRODUCTION_ORDERS_COMPLETE` / `PRODUCTION_MATERIAL_ISSUE_MANAGE` / `PRODUCTION_RECEIPT_MANAGE` / `PRODUCTION_COSTS_VIEW`；
- 既有：`IQC_VIEW` / `IQC_MANAGE` / `OQC_VIEW` / `OQC_MANAGE`；
- 新增：`PRODUCTION_PLAN_VIEW` / `PRODUCTION_PLAN_MANAGE`（Operation Plan）；
- 新增：`PRODUCTION_SUPPLEMENT_MANAGE`（Production Material Supplement）；
- 新增：`PRODUCTION_RETURN_MANAGE`（Production Material Return，含 reason）；
- 新增：`PRODUCTION_BATCH_ISSUE_MANAGE`（Batch Picking）；
- 新增：`PRODUCTION_INSPECTION_VIEW` / `PRODUCTION_INSPECTION_MANAGE`（Operation + Product Inspection）；
- 新增：`PRODUCTION_QUALITY_CONFIG_VIEW` / `PRODUCTION_QUALITY_CONFIG_MANAGE`（Inspection Item / Detection Value / Instrument / Plan master）；
- 新增：`PRODUCTION_BYPART_MANAGE`（Byproduct Receipt）；
- 新增：`PRODUCTION_SCAN_EXECUTE`（Production Scan 工作面）；
- Approval：family `PRODUCTION_ORDER` 接入 Platform Approval；admin 继承；
- 兼容：旧 `PRODUCTION_OUTPUT` permission 保留不引入。

兼容：5 个 role seed（admin / sales / warehouse / reviewer / accounting）继续按现有能力访问。

### 29.6 Compatibility / 不变性约束

- 不删除或重命名原有 route key；本轮新增 `production-quality` / `production-scan` / `quality-configuration` 三条 Manufacturing canonical route。
  **（2026-11-12 整改轮按实现事实更正）**：本条原记「50 enabled + 5 disabled → 53 enabled + 5 disabled」，
  但当前 `src/navigation/applicationRegistry.js` 的实际登记为 **79 enabled + 4 disabled**；
  数量口径以 registry 实况为准，本条不再复述易过期的具体数字。
- Production Order 状态机：`DRAFT → SUBMITTED → APPROVED → RELEASED → IN_PROGRESS → COMPLETED`；每个转移需要同时检查权限、来源、累计执行量、业务不变量；不支持从 SUBMITTED 直接跳到 IN_PROGRESS 等；
- Production Order `bom_id / bom_version_snapshot / routing_id_snapshot / production_order_items.*` 不可写回修改；
- 既有 IQC / OQC / QCP 不破坏；
- 既有 `production_material_issues / production_material_returns / production_receipts / production_receipt_reversals / production_operation_reports / production_operation_report_reversals` 表与 handler 不破坏；
- legacy `production_outputs` 表保留；dead handler `createProductionOutput` 移除；2 处 active read（`listProductionOrders` / `getProductionOrder`）替换为 `production_receipts.netReceived` 来源；
- 不 DROP historical table；
- SQLite + MySQL 8 schema parity；migration idempotent。

### 29.7 Out of Scope（本 Domain Closure 不实施）

- Multi-Org Distribution / Cross-Org Operation Transfer；
- 完整 Outsourcing Order / Issue / Receipt / AP（Procurement & Outsourcing Domain）；
- 完整 MRP substitute 消费；
- 完整 APS / MES / HMI；
- Mold / Mold Combination / Complex Auxiliary Attributes（DEFER_SOURCE_DETAIL）；
- Inventory Status Conversion / 完整 Stock Status；
- Generic Workflow / Smart Accounting / Management Accounting；
- Finance Costing rewrite / destructive cleanup / DROP historical table / database reset；
- 完整 B3105 Barcode / PDA 平台（Inventory & Warehouse Domain）；
- B3106 存货核算完整 lifecycle（Finance Operations Domain）；
- Byproduct Cost Allocation。

### 29.8 Acceptance Criteria

#### A. Functional

- Production Order 全 lifecycle 转移 + Approval family `PRODUCTION_ORDER` 接入；
- Material List lifecycle + controlled edit + approved / released；
- Material Issue / Supplement / Return / Batch Issue 走相同 inventory / voucher / WIP / period / audit / idempotency 链路；
- Operation Plan lifecycle + Engineering Snapshot + Forward / Backward Scheduling；
- Work Calendar / Shift / Capacity 真实消费；
- Topology：LINEAR 完整；NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE fail closed；
- Internal Handoff + Outsourced Boundary fail closed；
- Inspection Item / Detection Value / Instrument Master CRUD + lifecycle；
- Inspection Plan + 与 QCP 的 when / what 关系；
- Operation Inspection + Product Inspection + Production Receipt Quality Gate；
- Nonconforming Receipt LOT/SERIAL HOLD 隔离；
- Production Scan 工作面 Material + Operation；
- Analytics Execution Summary + Material Issue Summary + 既有 WIP / Yield / Capacity / Cost。

#### A.1 强制执行点（2026-11-12 整改轮补入）

本节把上列能力中**「服务端必须在哪里拒绝」**写死，避免能力只在某个写入口被声明而未被执行：

- **拓扑与委外边界的 fail closed 必须在三个写入口同时成立**：`报工草稿创建`、`报工确认`、`工序完工`。
  只在草稿创建时拒绝是不够的 —— 工序在草稿创建之后被改为委外或非 LINEAR 拓扑时，
  报工确认与工序完工同样必须拒绝（`409`）。
- **委外工序不得内部自动完成**：委外工序的完工必须经 `OUTSOURCING_HANDOFF_REQUIRED` 交接，
  不得由普通工序完工路径直接置为 `COMPLETED`。
- **检验类型词表由服务端校验**：客户端提交的 `inspection_type` / `source_type` 必须落在受控词表内，
  越界返回 `400`，不得以自由文本入库。
- **收货质量门禁的 WAIVED 分支**：质量策略为 `REQUIRED` 时等待 `PASS`；`WAIVED` 放行必须
  记录放行原因与放行人并写审计，且不掩盖 `FAIL`。
- **不合格收货**：不合格品以 LOT/SERIAL `HOLD` 隔离并写 `nonconforming` 标记；
  未跟踪库存状态仍是 Inventory 域依赖。
- **工序转移扫码**：source / destination operation + 数量 → 工序转移；转移数量不得超过源工序已释放良品。

#### A.2 前端工作面覆盖（2026-11-12 整改轮补入）

下列能力**必须有真实移动工作面**（list → detail → editor/workflow），不得只有 API：

补料 / 退料（含业务原因）/ 合并领料（批拣）/ 用料清单受控编辑与审核 / Operation Plan
提交·审核·下达 / 正排·倒排 / 工序派工 / 生产执行分析（Execution Summary 与
Material Issue Summary）/ 副产品维护 / 检验方案与检验项目明细编辑 / 检测值维护。

工作面判定标准（缺一即不得判 `COVERED`）：

1. 列表面必须显示**真实数据**；不得以裸 ID 文本框作为唯一录入入口，来源对象必须可选；
2. 触控目标不小于 **44px**；
3. 在 320 / 390 / 430 / 680 四档宽度下无横向溢出、无 runtime error；
4. 浏览器验收脚本必须断言**真实数据已渲染**与**触控目标尺寸**；仅断言「元素存在」或
   「body 文本非空」视为空洞证据，不计入验收。

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；
- Production Order 状态机字段 additive；既有数据兼容（`DRAFT / PENDING / IN_PROGRESS / COMPLETED / CANCELLED` 仍合法）；
- legacy `production_outputs` 表保留；dead handler 移除；
- SQLite / MySQL 8 schema parity；migration idempotent。

#### C. Security

- 所有 Manufacturing mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- Audit 写入关键 Production / Quality / Inspection mutation；
- Approval family `PRODUCTION_ORDER` 与现有五审批族不冲突。

#### D. Test

- Wave A focused：production order state machine / approval / engineering resolver / material list lifecycle / legacy production_outputs convergence；
- Wave B focused：material supplement / return reason / batch picking / atomic failure；
- Wave C focused：operation plan lifecycle / forward-backward / calendar skip / capacity；
- Wave D focused：control code snapshot / topology / internal handoff / outsource boundary；
- Wave E focused：inspection item / detection value / instrument / plan / QCP relation；
- Wave F focused：operation inspection / product inspection / receipt quality gate / nonconforming boundary；
- Wave G focused：production scan material + operation；
- Wave H focused：execution summary / material issue summary；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。
- **真实 MySQL 域级证据（2026-11-12 整改轮补入）**：本域并发与状态机合同必须在受保护的 ACK-4
  campaign `MANUFACTURING_QUALITY_MYSQL_V1` 上于真实 MySQL 8 实证 —— schema 对等由该 campaign 的
  `BOOTSTRAP_CURRENT_SCHEMA` 证明，并发行为等价由该 campaign 的竞态套件证明。
  **仅 SQLite 证据不计入本条**；入口为 `pnpm test:mysql:manufacturing-quality`。
- **浏览器证据（2026-11-12 整改轮补入）**：§29.8 A.2 列出的每个工作面必须有浏览器验收断言，
  且断言必须覆盖**真实数据渲染**与**触控目标尺寸**；脚本必须接入 `package.json` 的 canonical 入口。

#### E. UI / Mobile

- Production Order Detail 成为真正 execution hub（Header → Source & Plan → Material → Operations → Quality → Receipt → Completion）；
- Material Execution / Operation Execution / Production Receipt 按数据要求 mobile-friendly；
- Production Scan 工作面按扫描器主流入口；
- Quality Master 与 Quality Execution 分离；
- 320 / 390 / 430 / 680 CSS px 验证；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- **（2026-11-12 整改轮补入）** §29.8 A.2 列出的每个工作面都必须可达、可操作、且有非空洞的浏览器证据。

#### F. Documentation / Log

- `document.md §22.19` 与 §29 同步更新；
- `solution.md §24` 同步更新（Design）；
- `log/2026-10-07.md` 追加本 Domain Closure 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试同步更新；
- `APPLY_GUIDE.md` 不动。

### 29.9 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization 需求出现；
2. 需要重写完整 MRP / 完整 APS / 完整 Outsourcing；
3. 需要 DROP historical table；
4. destructive data rewrite；
5. source semantics 不足；
6. MySQL migration 无法保证 parity；
7. 既有 Inventory / AR / AP / WIP / GL 原子合同必须破坏；
8. legacy `production_outputs` 表有真实活动调用方（非本仓库代码）。

### 29.10 最终接受状态

本节 Requirement 包含 43 项 Capability / 8 个 Wave / 16 个新增 permission。本节为 Approved Requirement，下游 Design 见 `solution.md §24`。

---

**MANUFACTURING & QUALITY DOMAIN CLOSURE REQUIREMENT — READY FOR DESIGN & IMPLEMENTATION**

---

### 29.11 route exposure 与页面自身 API 权限一致性有界增补（`PENDING_APPROVAL`，2026-11-15）

#### 29.11.1 身份、授权与生效边界

| 项 | 内容 |
|---|---|
| 用途 | 消除 `manufacturing-analytics` route 的 **exposure 权限集合未覆盖该页面自身依赖的 API 权限集合**所造成的「预期外 403」：同一后端主体被前端判定为可进入该 route，又被后端判定为无权调用该 route 加载时必调的 API |
| Owner | Manufacturing & Quality（`manufacturing-analytics` 工作面与生产报表的 owner） |
| 状态 | `PENDING_APPROVAL`；业务所有者于 2026-11-15 授权本节 Requirement 与 Design 连续撰写，**Design 完成后 HARD STOP**。Implementation、解冻、数据库操作、发布与部署**均未授权** |
| 权威来源 | `document.md` §29；本文件 §29.5 Permission 约束、§29.6 Compatibility / 不变性约束、§29.9 Hard Stop Conditions；`docs/status/PROJECT_STATUS.md` §66.2（覆盖分类裁定）；`docs/status/CAPABILITY_MATRIX.md` B3119（冻结后有界发现） |
| 前置条件 | 本域整域已冻结（`MANUFACTURING_QUALITY_DOMAIN_ACCEPTANCE_PASS` / `MANUFACTURING_QUALITY_CAPABILITY_FREEZE`，2026-11-12，37 项能力）。本节触碰**权限与 route exposure 合同**，因此实施前必须由业务所有者**显式解冻**并单独授权 Implementation |
| Supersession | 本节只**增补** §29.5 与 §29.6，**不改写** §29 已冻结结论，也**不改写** 2026-11-12 的冻结记录；本节记录的是**冻结之后**发现的有界缺陷 |

本节只覆盖 `manufacturing-analytics` 一条 canonical route。`document.md` §29 的其它 route、页签、状态机、
权限码与能力集合**均不变**。

#### 29.11.2 事实基线（2026-11-15 在 HEAD `acb187d` 上实测）

`manufacturing-analytics` 的 6 个页签与其 API 依赖（`src/pages/manufacturing.jsx:953`–`:980`）：

| 页签 | API | 后端要求的权限 | 事实来源 |
|---|---|---|---|
| `wip`（**当前固定默认页签**） | `GET /api/manufacturing/reports/wip` | `PRODUCTION_ORDERS_VIEW` | `server/modules/manufacturing-execution.js:338` |
| `yield` | `GET /api/manufacturing/reports/yield` | `PRODUCTION_ORDERS_VIEW` | 同上 `:355` |
| `capacity` | `GET /api/manufacturing/reports/capacity` | `PRODUCTION_ORDERS_VIEW` | 同上 `:343` |
| `execution` | `GET /api/manufacturing-analytics/execution-summary` | `PRODUCTION_ORDERS_VIEW` | 同上 `:574` |
| `materialIssue` | `GET /api/manufacturing-analytics/material-issue-summary` | `PRODUCTION_ORDERS_VIEW` | 同上 `:604` |
| `cost` | `GET /api/manufacturing/reports/cost` | `PRODUCTION_COSTS_VIEW` | 同上 `:360` |

route 声明的 exposure 为 `any:['PRODUCTION_ORDERS_VIEW','PRODUCTION_COSTS_VIEW']`
（`src/navigation/applicationRegistry.js:72`），**等于**上表权限的并集 —— 因此 **exposure 的语义本身正确，
不需要改动**。不一致只发生在**页面层**：当前实现无条件渲染 5 个无权页签，并固定以 `wip` 为默认页签。

触发事实：`role-accounting` 持有 `PRODUCTION_COSTS_VIEW`（`server/migrations/v13-phase6c-manufacturing-execution.js:138`）
但**不持有** `PRODUCTION_ORDERS_VIEW`（`server/db.js:2037` 的 role 种子）→ 该角色可进入 route，却在其
**默认页签**上被后端拒绝。`role-warehouse` 持有 `PRODUCTION_ORDERS_VIEW`、不持有 `PRODUCTION_COSTS_VIEW`，
可正常使用全部 5 个执行类页签，但会看到 1 个无权页签并在其上被拒绝。

#### 29.11.3 合同项 `MQ-EXPOSURE-01..05`

- **`MQ-EXPOSURE-01`（页签与 API 依赖必须登记）**：本 route 的每一个页签与其所依赖的 API、该 API 要求的权限，
  必须在代码中以**单一事实来源**登记；页面不得发出未登记的 API 请求。登记口径以 §29.11.2 的表为准。
- **`MQ-EXPOSURE-02`（可见页签必须是 actor 权限的子集）**：页面渲染的页签集合必须**只包含 actor 持有相应权限的页签**；
  无权页签**不得渲染**。现状的无条件渲染 5 个页签不符合本条。
- **`MQ-EXPOSURE-03`（默认页签必须是有权页签）**：默认页签必须是 actor **有权访问**的页签；只持有
  `PRODUCTION_COSTS_VIEW` 的角色其默认页签必须是 `cost`。固定以 `wip` 为默认页签不符合本条。
- **`MQ-EXPOSURE-04`（后端语义与权限目录不变）**：后端 API 守卫语义**不变**
  （`PRODUCTION_ORDERS_VIEW` / `PRODUCTION_COSTS_VIEW` 各自的要求不变）；**不得**新增权限码、
  **不得**修改 `role_permissions`、**不得**放宽任何 API 守卫、**不得**改动任何角色的权限集合。
  前端隐藏**不构成**授权：后端必须继续 fail closed。
- **`MQ-EXPOSURE-05`（无权时必须 fail closed，不得渲染后报错）**：当 actor 对该 route 的全部页签均无权限时，
  必须呈现**权限拒绝态**，不得先渲染页面再以错误提示暴露「无权访问」。本条与 §29.9 的 fail closed 原则一致。

#### 29.11.4 验收、兼容与禁止事项

**验收门禁**：

1. canonical 浏览器门禁 `node scripts/acceptance/release-browser-readiness.mjs` 在 5 类 canonical 角色 × 4 档宽度下，
   `manufacturing-analytics` 的「无预期外 4xx/5xx」判定**必须为 0**；该门禁的其余判定（渲染、横向滚动、
   触控目标 ≥44px、refresh / Back / Forward）**不得回退**。
2. focused 测试：对每个 canonical 角色，断言该 route 首屏发出的 API 请求集合 ⊆ 该角色权限集合；
   断言默认页签对应请求的 API 在该角色权限内。
3. 变异实验（证明断言承重、非空洞）：① 把默认页签改回固定 `wip` → 必须转红；
   ② 取消页签权限过滤 → 必须转红；③ 移除 `cost` 页签的 `PRODUCTION_COSTS_VIEW` 判断 → 必须转红。
4. `pnpm test:fast`、`pnpm build`、`git diff --check`、两种文档一致性模式。

**兼容要求**：不改变任何角色的权限集合与 `role_permissions`；不改变 route 数量与 route key；不改变任何 API
的请求/响应合同与权限判定；不改变页签**集合**（只改变**可见性**与**默认选择**）；不改变生产报表的数据口径、
状态机、金额与估值语义；不改变既有 release tag。

**禁止事项**：不得通过 allowlist / 白名单方式把 403 放进 canonical 门禁的豁免项；不得放宽后端 API 守卫；
不得新增权限码或修改 role 种子；不得删除 `cost` 页签或以「删页签」回避 §29.11.2 的不一致；
不得把前端隐藏当作授权实现（后端必须继续 fail closed）；不得在本节顺带改动其它 route、页签或权限；
不得把尚未取得的真实浏览器证据写成已通过。

**Requirement 状态：`PENDING_APPROVAL`（2026-11-15）。Design 已获授权并连续执行；Implementation、解冻、
数据库操作、发布与部署均未授权。**
