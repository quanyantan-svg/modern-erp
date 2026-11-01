# Master & Engineering — Requirement

> 状态：`ACTIVE`
> Owner：Master & Engineering
> 权威来源：`document.md` §28
> 来源：`document.md` §28（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 28. Master & Engineering Domain Closure Requirement

> 本节固化 Master & Engineering Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自 Prompt §0–§11；Coverage 来自本章依据真实仓库证据的审计；Design 见 `solution.md §23`。
> 实施 Waves A–F 见 `solution.md §23.11`。

### 28.1 范围与边界

本 Domain Closure 的范围是：

- Master & Engineering 拥有的“如何制造”的工程事实；
- 为 Planning、Manufacturing & Quality、Procurement & Outsourcing、Finance Operations 提供稳定的 authoritative engineering source 与 resolver contract。

**不在本 Domain 范围：**

- 实际生产执行 / 报工 / WIP（Manufacturing & Quality）；
- MRP 详细 substitute 消费（Planning）；
- 委外订单执行 / AP 加工费（Procurement & Outsourcing）；
- 库存 mutation、计价、AR/AP、GL（Inventory / Finance / Accounting）；
- Multi-Organization（OUT_OF_SCOPE — CURRENT PRODUCT BASELINE）；
- 完整 APS 调度 / HMI / 完整 MES（OUT_OF_SCOPE）。

### 28.2 Manual Evidence Baseline（摘要）

完整 31 项 ME-01 ~ ME-31 evidence 在会话上下文；本节列出关键 contract：

| 关键 contract | 含义 |
|---|---|
| Workshop Formula 安全 | **严禁** `eval()` / `Function()`；只允许受限 grammar / parser |
| BOM 用途 | 必须能表达 `GENERAL / SELF_MAKE / OUTSOURCE`（命名由 Design 决定） |
| Routing Operation Control Code | 控制排程/加工/汇报/检验；execution 语义归 M&Q |
| Substitute 策略/方式 | 至少：混用/手工/整批/整批+混用；替代/取代/按比例 |
| ECO Change Type | 至少 `IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD` |
| BOM Reference 不得 | direct self-reference + multi-level cycle |
| Production Snapshot 不得被 master edit 反向污染 | `bom_version_snapshot` / `routing_id_snapshot` / `production_order_routing_snapshots` 不可写回修改 |
| Routing 双源收敛 | `product_routings` canonical；legacy `routing_operations` 保持 table+FK 但停止 active mutation |

### 28.3 Capability Audit Matrix（已审计）

完整 31 项 Coverage/Gap/Implementation Decision 见本节上表 `§22.18`。关键 non-source-backed 类别按合法 deferred reason 标注：

- `OUT_OF_SCOPE — CURRENT PRODUCT BASELINE`：Multi-Org Distribution；
- `CROSS_DOMAIN_DEPENDENCY`：完整 expected incoming supply（PO/计划供应）；BOM substitute 真正消费；委外加工费 AP；
- `DEFER_SOURCE_DETAIL`：Mold / Mold Combination / Complex Auxiliary Attributes；
- `SEMANTIC_MISMATCH`：BOM Purpose / Approval Lifecycle；BOM 权限族。

### 28.4 目标 Capability Closure 要求

| Domain Capability | 落地后 Coverage 目标 | 关键 Acceptance |
|---|---|---|
| Work Calendar / Shift / Pattern | `COVERED` | Shift/Pattern/Calendar + Time-window validation + Work Center 关联 |
| Workshop Formula | `COVERED` | 受限 grammar；不得出现 `eval`/`Function`；div/0 防御；长度与深度限制 |
| Resource / Equipment | `COVERED` | 类型枚举；quantity > 0；与 Work Center / Operation 关联 |
| Operation / Control Code / Activity | `COVERED` | 强制 lifecycle active/inactive；Code 唯一；历史引用不断裂 |
| Work Center | `COVERED`（增强） | UPDATE / Deactivate / Calendar 关联 / Operation 关联 / activity / ref guard |
| BOM Status 治理 | `COVERED` | purpose 维度；effective lifecycle；approval lifecycle；保持 ACTIVE/DISCONTINUED 兼容 |
| BOM Tree / Cycle | `COVERED` | direct self-ref + multi-level cycle 拒绝；tree expand；drill |
| BOM Batch Maintenance | `COVERED` | add / modify / remove / replace 全部 `preview → apply`；atomic transaction；audit |
| BOM Engineering Analysis | `COVERED` | forward / reverse-where-used / consolidated / compare / material-cost |
| Substitute Scheme | `COVERED` | strategy/method/priority/ratio/date/lifecycle + deterministic resolver |
| Configurable BOM | `COVERED` | selectable / replaceable / modifiable 组件属性；preview / validation |
| Routing Canonical | `COVERED` | legacy `routing_operations` 不再 active mutate；保留 table + FK |
| Routing Topology | `COVERED` | 数据模型表达 sequence / parallel / split / merge；不实现完整 APS |
| Routing Enrichment | `COVERED` | 关联 WorkCenter / Operation / ControlCode / Activity / Resource / Equipment；outsource indicator；quality indicator |
| ECO | `COVERED` | IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD；allowed operations 受限；impact preview；atomic apply；audit；不破坏 existing snapshot |
| Use-Up-Old | `PARTIAL — CROSS_DOMAIN_DEPENDENCY` | 当前库存可参考；预计入供应类型依赖未来 Domain |
| Mold / Mold Combination | `MISSING — DEFER_SOURCE_DETAIL` | 用户手册 source 不足 |
| Multi-Org Distribution | `OUT_OF_SCOPE` | 当前 product baseline |

### 28.5 Permission 约束

新增最少、独立 `engineering_perms` 族（共 12 个，与实现一致）：

- `ENGINEERING_REFERENCE_VIEW` / `ENGINEERING_REFERENCE_MANAGE`（覆盖 Work Calendar / Shift / Shift Pattern / Calendar Template / Basic Activity / Workshop Formula / Resource / Equipment / Operation / Control Code）；
- `ENGINEERING_BOM_VIEW` / `ENGINEERING_BOM_MANAGE` / `ENGINEERING_BOM_APPROVE`；
- `ENGINEERING_SUBSTITUTE_VIEW` / `ENGINEERING_SUBSTITUTE_MANAGE`；
- `ENGINEERING_CONFIGURABLE_VIEW` / `ENGINEERING_CONFIGURABLE_MANAGE`；
- `ENGINEERING_CHANGE_VIEW` / `ENGINEERING_CHANGE_MANAGE` / `ENGINEERING_CHANGE_APPROVE`。

（注：原设计提到 `ENGINEERING_ROUTING_*` 独立 alias；实施时保留既有 `ROUTING_VIEW` / `ROUTING_MANAGE` 而不重复，遵循现有 RBAC 与 routing BOM Contract。）

兼容策略：

- 旧 `PRODUCTION_ORDERS_VIEW` / `PRODUCTION_ORDERS_CREATE` 对 BOM 的隐含权限：**保留** 5 个角色 seed 不变，确保不破坏现有 BOM UI/API 可用性；
- 角色 admin 继承全部新权限；
- sales/warehouse/reviewer 等角色保持现状；
- 新 permission 与现有 RBAC family 兼容。

### 28.6 Compatibility / 不变性约束

- 不删除或重命名现有 47 enabled + 5 disabled route key；本阶段依批准 Requirement 新增 3 条 Engineering canonical route，当前为 50 enabled + 5 disabled；
- 不修改 BOM `/api/boms*` / Routing `/api/product-routings*` 既有 response/request 关键字段；新增字段以 **additive** 形式补齐；
- 不修改 BOM ACTIVE/DISCONTINUED enum；purpose 作为 **additive 新字段**，默认 `GENERAL`；
- 不修改 Work Center 既有字段（capacity_hours / efficiency / unit_cost_cents / active）；新字段以 additive migration 补齐；
- `production_orders.bom_id` / `production_order_items.bom_item_id` / `production_order_routing_snapshots` 全部 **不可重写**；
- legacy `routing_operations` 表 + `production_labor_records.operation_id` FK **保留**（兼容 source 数据），但停止 active mutation；
- 不 DROP historical table；
- 不重命名既有 release tag；
- SQLite + MySQL 8 schema parity。

### 28.7 Out of Scope（本 Domain Closure 不实施）

- Multi-Org Distribution；
- 完整 MRP substitute 消费；
- 完整 Outsource Order / Issue / Receipt / AP；
- 完整 Production Scheduling（仅 routing topology metadata）；
- 完整 MES / HMI；
- Mold / Mold Combination（DEFER_SOURCE_DETAIL）；
- 完整 Substitution/Category ；
- Generic Workflow / Smart Accounting / Management Accounting；
- 财务 rewrite / destructive cleanup / DROP historical table / database reset。

### 28.8 Acceptance Criteria

#### A. Functional

- Shift / Shift Pattern / Work Calendar / Template CRUD 闭环；Calendar 关联 Work Center；
- Workshop Formula 受限 grammar 通过 parser；不出现 eval/Function；解析失败返回明确错误；
- Resource / Equipment CRUD + 类型枚举校验 + quantity 校验；
- Operation / Control Code / Activity 独立 master；被 Work Center / Routing 引用时 lifecycle 校验；
- Work Center UPDATE / Deactivate / 关联 Calendar / 关联 Resource；
- BOM purpose 维度上线；verified by period & approval lifecycle；
- BOM Tree 展开、where-used、cycle 检测拒绝、multi-level 限制；
- BOM Batch Maintenance add/modify/remove/replace 全部 preview→apply atomic，失败不留半应用；
- BOM Forward / Reverse-where-used / Consolidated / Compare / Material-Cost 分析；
- Substitute Scheme + resolver contract（不写 MRP）；
- Configurable BOM：selectable / replaceable / modifiable 组件标志 + 配置预览；
- Routing canonical 收敛；legacy `routing_operations` 不再 active mutate；
- Routing enrichment：WorkCenter / Operation / ControlCode / Activity / Resource / Equipment 引用；
- Routing topology metadata：main / alternate / split / merge；
- ECO：IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD；allowed operations 受限；impact preview；atomic apply；audit；历史 snapshot 不被污染；
- Use-Up-Old：当前库存 cleanup candidate；预计入供应标记 PARTIAL CROSS_DOMAIN_DEPENDENCY；
- 工程分析（forward/reverse/where-used/consolidated/compare/cleanup-log）UI 与 API 可用。

#### B. Data / Schema

- 新增表与字段全部 additive；既有表/字段无破坏；
- `production_orders.bom_id` / `production_order_routing_snapshots` 不可写回修改；
- 历史 BOM/Routing 引用不可硬删除（active/inactive lifecycle）；
- SQLite / MySQL 8 schema parity；
- migration idempotent。

#### C. Security

- 所有 BOM/Routing/ECO/Substitute mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- 新 permission 5 个角色 seed 不越权；
- audit 写入关键 BOM/路由变更。

#### D. Test

- Wave A focused：reference + formula + calendar + work center reference；
- Wave B focused：BOM lifecycle / purpose / version / cycle / tree / batch / snapshot immutability；
- Wave C focused：substitute invalid self / priority conflict / date validation / ratio validation / deterministic query / configurable BOM；
- Wave D focused：routing canonical / legacy convergence / operation refs / snapshot preservation；
- Wave F focused：production consumer stability + MRP consumer stability；
- 所有 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

#### E. UI / Mobile

- 新增 Engineering Reference 工作面（统一 master-engineering / engineering 控制台），按 SPEC 选择 320 / 390 / 430 / 680 验证；
- BOM / Routing 现有 desktop table 必须改造为 list → detail → editor/workflow 偏好；
- 复杂对象不再依赖永久横向滚动；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`。

#### F. Documentation / Log

- `document.md` §22.18 与 §28 同步更新；
- `solution.md` §23 同步更新（Design）；
- `log/2026-10-06.md` 追加本 Domain Closure 完整记录；
- `README.md` 仓库地图与新增 page route / server module / 测试同步更新；
- `APPLY_GUIDE.md` 不动。

### 28.9 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization 需求出现；
2. 需要重写完整 MRP；
3. 需要实现完整 Production Scheduling / APS；
4. 需要实现完整 Outsourcing / 加工费 AP；
5. 需要 DROP historical table；
6. destructive data rewrite；
7. source semantics 不足；
8. MySQL migration 无法保证 parity；
9. 既有 Inventory/AR/AP/WIP/GL 原子合同必须破坏。

### 28.10 Final Coverage / Evidence Reconciliation（2026-10-07）

- 实施证据：Waves A–F backend/module/migration/focused integration 测试；Frontend 四个工作面及 Registry/Launcher 路由。
- 响应式证据：真实 Edge 在 320 / 390 / 430 / 680 CSS px 访问 Engineering Reference / BOM / Substitute & Configurable / ECO，无页面水平溢出与 browser error。
- Schema 计数证据（由当前 canonical SQLite snapshot 与 5 个 Engineering migration 计算）：
  - 15 张新表：`engineering_shifts`、`engineering_shift_patterns`、`engineering_calendar_templates`、`engineering_work_calendars`、`engineering_basic_activities`、`engineering_workshop_formulas`、`engineering_resources`、`engineering_equipment`、`engineering_operations`、`engineering_control_codes`、`engineering_substitute_schemes`、`engineering_substitutes`、`product_routing_operation_links`、`engineering_change_orders`、`engineering_change_items`；
  - 5 张既有表上的 28 个 additive 列：`boms` 8 个、`bom_items` 7 个、`work_centers` 5 个、`product_routings` 1 个、`product_routing_operations` 7 个；
  - 7 个显式普通索引：`idx_bom_items_product`、`idx_boms_product_purpose_status`、`idx_engineering_change_items_change`、`idx_engineering_change_orders_status`、`idx_engineering_substitutes_primary`、`idx_engineering_substitutes_scheme`、`idx_product_routing_operation_links_routing`。
- MySQL parity 证据：真实 disposable MySQL 8 上 fresh bootstrap、V1.3/V1.4-shaped existing database additive upgrade、连续第二次初始化、Engineering 表/列恢复、原始行与 permission mapping 保留均通过；`pnpm test:mysql` 与 `pnpm test:mysql:concurrency` 最终 PASS。
- BOM Permission Family：Original Gap `SEMANTIC_MISMATCH`；独立 `ENGINEERING_BOM_VIEW` / `ENGINEERING_BOM_MANAGE` / `ENGINEERING_BOM_APPROVE` 权限族及测试已落地，Final Coverage `COVERED`。
- 最终保留 Gap：非 Shift 参考资料 update/deactivate；完整 APS；预计入供参与 Use-Up-Old；完整 MRP substitute 消费；Multi-Org/Mold/Auxiliary 的合法 deferred 范围。

---

**MASTER & ENGINEERING DOMAIN CLOSURE REQUIREMENT — READY FOR DESIGN & IMPLEMENTATION**

---
