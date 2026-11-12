# Master & Engineering — Technical Design

> 状态：`ACTIVE`
> Owner：Master & Engineering
> 权威来源：`solution.md` §23
> 来源：`solution.md` §23（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 23. Master & Engineering Domain Technical Design

> 本节固化 Master & Engineering Domain Closure 的 Design 阶段成果。
> Requirement 见 `document.md §28`；Wave 实施策略见 §23.11。
> 本节明确工程数据如何作为 Planning / Manufacturing / Outsourcing 的 stable authoritative source。

### 23.1 Module Ownership

| Owner module | 主要 API family | 备注 |
|---|---|---|
| `server/modules/engineering-reference.js` | `/api/engineering/shifts*` `/api/engineering/shift-patterns*` `/api/engineering/calendar-templates*` `/api/engineering/work-calendars*` `/api/engineering/basic-activities*` `/api/engineering/workshop-formulas*` `/api/engineering/resources*` `/api/engineering/equipment*` `/api/engineering/operations*` `/api/engineering/control-codes*` | Wave A |
| `server/modules/engineering-work-center.js` | `/api/work-centers*`（additive update + deactivate + calendar linkage） | Wave A；保留现有 `manufacturing-reference` 的 GET/POST 不变 |
| `server/modules/engineering-bom.js` | `/api/boms*` `/api/bom-items*`（additive: purpose / effective lifecycle / tree / batch / analysis） | Wave B；保留既有 `listBoms/getBom/createBom/updateBom` request/response 关键字段 |
| `server/modules/engineering-substitute.js` | `/api/engineering/substitutes*` `/api/engineering/substitute-schemes*` | Wave C |
| `server/modules/engineering-configurable-bom.js` | `/api/engineering/configurable-boms*` | Wave C |
| `server/modules/engineering-change.js` | `/api/engineering/changes*` `/api/engineering/changes/:id/apply` `/api/engineering/changes/:id/impact-preview` | Wave E |
| `server/modules/engineering-routing-enrichment.js` | `/api/engineering/product-routings/:id/topology` `/api/engineering/product-routings/:id/enrichment` | Wave D |
| `server/modules/product-routing.js` | `/api/product-routings*`（canonical owner already） | 保持；WAVE D 加 enrichment 入口与 topology 字段 |
| `server/modules/manufacturing-reference.js` | `/api/work-centers*` GET/POST 已有 owner；`/api/routing-operations*` legacy owner | Wave A 增强；Wave D legacy convergence |

### 23.2 Engineering Reference Data Model

所有 Reference master 强制字段：

- `id` (TEXT PK)、`code` (唯一 CODE，匹配 `[A-Z0-9._-]{1,40}`)、`name` (≤ 100)、`active` (1/0)、`created_at` / `updated_at`、`notes` (≤ 500)；
- 部分字段：`calendar_id`（Shift Pattern / Work Center 引用）、`work_center_id`（Calendar / Resource / Equipment 关联）、`category`（Resource 类型 enum）；
- Reference master 必须有 lifecycle `active` 而非硬删除；
- 历史引用通过 `active=0` 软停用而非 DELETE。

#### Wave A 新增表

- `engineering_shifts`：班次（time-window-based；`start_time`/`end_time` 必须早于该 window 边界）；
- `engineering_shift_patterns`：班制（每日班次数 + shift 顺序）；
- `engineering_calendar_templates`：工作日规则（每周工作日）；
- `engineering_work_calendars`：实际工作日历（关联 calendar template + shift pattern + 适用日期范围）；
- `engineering_basic_activities`：基础活动（code/name/unit/default_qty）；
- `engineering_workshop_formulas`：车间公式（受限 grammar string + version）；
- `engineering_resources`：资源（type enum: MACHINE/TOOL/PERSON/MATERIAL；capacity_uom）；
- `engineering_equipment`：设备（model/serial/spec）；
- `engineering_operations`：作业 master（code/name/standard_minutes/activity_id）；
- `engineering_control_codes`：工序控制码（type enum: SCHEDULING/PROCESSING/REPORT/INSPECTION/OUTSOURCE；policy references）。

#### Work Center 增强字段（additive migration）

- `work_centers` 表 additive：增加 `calendar_id`（FK engineering_work_calendars）/ `default_efficiency_pct` / `is_outsource` / `notes` / `updated_at`；
- 既有字段保持：id/code/name/type/capacity_hours/efficiency/unit_cost_cents/active/created_at。

### 23.3 Workshop Formula Engine（受限 grammar）

**安全要求（强制）：**

- 禁止 `eval()` / `Function()` / `vm` / `exec` / `subprocess`；
- 实现方式：手写 recursive descent parser（变量/数字字面量/运算符 + - * / ^ / 括号）；
- 允许的 token：标识符（白名单前缀 `e_`）、数字字面量（IEEE 754 安全整数/有限 double）、运算符（+ - * / ^）、括号；
- 防御：禁止 `--` 语句；禁止 length > 256；禁止 parse depth > 32；除零返回明确 `DIVIDE_BY_ZERO`；未识别标识符返回 `UNKNOWN_IDENTIFIER`；
- 表达式编译结果仅作为简单 AST 求值器；不引入第三方表达式引擎；
- 公式可绑定变量（如 `qty`/`setup_time`/`run_time`），由调用方传值；解析阶段给出 `value × formula` 结果。

#### Schema（SQLite/MySQL）

`engineering_workshop_formulas(id, code UNIQUE, name, formula TEXT, version, active, created_at, updated_at)`。

### 23.4 BOM 生命周期 & Purpose

`boms` 表 additive 新字段：

- `purpose` TEXT default `'GENERAL'` CHECK IN (`GENERAL`,`SELF_MAKE`,`OUTSOURCE`)；
- `effective_from` TEXT nullable；
- `effective_to` TEXT nullable；
- `approval_status` TEXT default `'DRAFT'` CHECK IN (`DRAFT`,`PENDING`,`APPROVED`,`REJECTED`,`WITHDRAWN`)；
- `approved_by` TEXT nullable；`approved_at` TEXT nullable；
- `change_request_id` TEXT nullable（ECO 来源）；
- 既有 `version` TEXT 不变；既有 `status` (`ACTIVE`/`DISCONTINUED`) 不变；既有 `remark` 不变。

约束：

- `purpose=GENERAL/SELF_MAKE/OUTSOURCE` 与 `approval_status` 解耦；
- 仅 `status='ACTIVE' AND approval_status='APPROVED'` 进入生产/MRP/委外 resolver；
- 同一 `(product, purpose)` 下允许多 ACTIVE 版本（按 effective_from/effective_to 决定）；
- 既有 ACTIVE/DISCONTINUED 数据回填时 `purpose='GENERAL'`, `approval_status='APPROVED'`, `effective_from=created_at`。

#### Resolver contract（供下游使用）

```text
resolveEffectiveBom({ productId, businessDate, purpose })
  -> { id, version, approvalStatus, ... } | null
```

实现根据 `(product_id, purpose, status='ACTIVE', approval_status='APPROVED')` 选择：

1. 若仅一条命中 → 返回；
2. 若多条（effective range 重叠）→ 选择 `effective_from` 最近的；
4. 若无 ACTIVE/APPROVED → 返回 null（由调用方降级到旧单一 ACTIVE BOM）。

### 23.5 BOM Tree & Cycle

#### Tree 展开（forward multi-level）

```
expandBomTree(bomId, levels=∞)  →  { id, items: [{ id, childBom: expandBomTree(...) }] }
```

每次展开通过 `bom_items.product_id → boms.id`（purpose=GENERAL/SELF_MAKE active+approved）。

#### Cycle Detection

- direct self-ref：已在 `validateBomPayload` 检查；
- multi-level cycle：使用 DFS 着色 (`WHITE/GRAY/BLACK`) 在 `INSERT/UPDATE` 时拒绝形成环；返回 `BOM_CYCLE`。

#### Where-Used

```
whereUsedBy(componentProductId, levels=∞)  →  [{ parentProductId, parentProductCode, bomId, purpose, version, ... }]
```

按 `bom_items.product_id = componentProductId` 向上递归。

### 23.6 BOM Batch Maintenance

按 Capability ME-17：

- `POST /api/operations/boms/batch-add`（preview/apply mode）；
- `POST /api/operations/boms/batch-modify`（preview/apply mode）；
- `POST /api/operations/boms/batch-remove`（preview/apply mode）；
- `POST /api/operations/boms/batch-replace`（preview/apply mode）。

请求格式：

```json
{
  "mode": "preview",
  "filter": { "productIds": [...], "purpose": "GENERAL" },
  "changes": [{ "type": "add", "componentProductId": "...", "quantity": 1, "scrapRate": 0 }, ...]
}
```

`preview` 模式：

- 不写任何 mutation；
- 返回 `{ affectedBoms: [...], diff: [{ bomId, before, after }], conflicts: [...] }`。

`apply` 模式：

- atomic transaction；
- 任一 BOM 失败 → 全部回滚；
- 写 audit；
- 返回 `{ appliedCount, auditId }`。

### 23.7 BOM Engineering Analysis

API：

- `POST /api/analysis/boms/forward`（multi-level expand + qty × level）；
- `POST /api/analysis/boms/where-used`（reverse，component → parents）；
- `POST /api/analysis/boms/consolidated`（按 component 汇总 cross-level）；
- `POST /api/analysis/boms/compare`（两个 BOM 版本/对节点 → diff line items）；
- `POST /api/analysis/boms/cost`（按 BOM 层级 × 标准成本，**仅读** `product_costs`，不创建第二套成本事实）。

返回结构化 diff + numeric aggregation；不做第二套成本事实。

### 23.8 Substitute Scheme

Schema：

- `engineering_substitute_schemes(id, code UNIQUE, name, strategy CHECK IN ('MIXED','MANUAL','BATCH','BATCH_MIXED'), method CHECK IN ('REPLACE','SUPERSEDE','PROPORTION'), active, created_at, updated_at)`；
- `engineering_substitutes(id, scheme_id, primary_product_id, substitute_product_id, priority INTEGER, ratio NUMERIC, effective_from TEXT, effective_to TEXT, active, created_at, updated_at)`。

约束：

- primary != substitute；
- priority 唯一（同一 scheme 内）；
- effective_from < effective_to（如 both）；
- `strategy=PROPORTION` → 必须 ratio > 0；
- 周期内 deterministic resolver：`findSubstitutes({ primaryProductId, businessDate })` 按 priority 升序、active=1、effective range 命中。

### 23.9 Configurable BOM

Schema（在 `bom_items` 上 additive 标志）：

- `bom_items.is_selectable` (0/1)：可选料件；
- `bom_items.is_replaceable` (0/1)：可替换料件；
- `bom_items.is_modifiable` (0/1)：可调整料件；
- `bom_items.config_group` TEXT NULL：可选/替换组（同一 group 互斥或可互替）；
- `bom_items.config_constraint` （附加 JSON 字符串，可选）；

API：

- `POST /api/engineering/configurable-boms/preview`：根据一组 choices 预览最终 BOM；
- `POST /api/engineering/configurable-boms/validate`：校验所选 choices 是否满足所有 `is_required` / `is_mutually_exclusive` 规则；

不创建 `sales_order_bom` 或类似组件；订单侧配置留给 Sales & Customer Domain。

### 23.10 Routing Canonical Convergence & Enrichment

#### Legacy convergence

- `routing_operations` (legacy) 与 `production_labor_records.operation_id` FK 保持；
- `manufacturing-reference.js` 的 GET/POST 仍注册为 legacy API owner（**Wave A 不变**）；
- `product_routings` / `product_routing_operations` 是 canonical；
- 添加 server-side static assertion test 验证：**当前 active mutation path 不再新增 legacy `routing_operations`**；legacy 列表 GET 标注 `LEGACY_HISTORICAL` 标记，前端继续禁用新增 UI（已无 UI）。

#### Enrichment fields（additive migration）

- `product_routing_operations` 新增：`operation_id` (FK engineering_operations) / `control_code_id` (FK engineering_control_codes) / `activity_id` (FK engineering_basic_activities) / `resource_id` (FK engineering_resources) / `equipment_id` (FK engineering_equipment) / `is_outsource` (0/1) / `quality_policy` TEXT；
- `product_routings` 新增：`topology_type` (DEFAULT `LINEAR` CHECK IN (`LINEAR`,`NETWORK`))；
- `product_routing_operation_links`：拓扑关联（parent_operation_id, child_operation_id, type CHECK IN (`PARALLEL`,`SPLIT`,`MERGE`,`ALTERNATE`)，sequence_no）。

#### Topology metadata

允许为同一 Routing，路由配上 `LINEAR` 或 `NETWORK`：

- LINEAR：保持现状（sequence_no 单链）；
- NETWORK：通过 `product_routing_operation_links` 表达并行/分割/合并/替代；
- 不实现 APS 求解；只建立数据模型与可视化。

### 23.11 Implementation Waves

每个 Wave 必须 focused tests PASS；canonical gate 见 §23.16。

#### Wave A — Engineering Reference Foundation

- 新增 `engineering_shifts` 等 9 张表 + additive `work_centers` 字段；
- 新增 `server/modules/engineering-reference.js` + `server/modules/engineering-work-center.js`；
- 注册到 `ownedRouteTable`（owner = `server/modules/engineering-reference.js` 等）；
- mobile UI：单一 Engineering Reference 工作面（含 9 类 master 入口 + Work Center 增强入口）；加载 `erp-mobile-taste` Skill 仅用于此 UI。
- DB migration：SQLite + MySQL 8 parity；`idempotent`；
- 新 permission：12 个 `ENGINEERING_*`；
- 测试：`server/engineering-reference.test.js`。

#### Wave B — BOM Governance & Productivity

- 新增 BOM additive 字段（purpose/effective/approval/change_request_id）；
- 新增 `server/modules/engineering-bom.js`：保有现有 `listBoms/getBom/createBom/updateBom` 行为 + 新增：
  - purpose / effective / approval lifecycle；
  - tree expand + cycle detection；
  - batch maintenance preview/apply；
  - engineering analysis（forward/where-used/consolidated/compare/cost）。
- DB migration additive；
- resolver contract 文档化；
- mobile UI：BOM list → detail → modal 改造（list → detail → editor/workbench 风格）。
- 测试：`server/engineering-bom.test.js`。

#### Wave C — Substitute & Configurable BOM

- 新增 `engineering_substitute_schemes` / `engineering_substitutes` 表；
- 新增 `bom_items` additive config flags（is_selectable / is_replaceable / is_modifiable / config_group）；
- 新增 `server/modules/engineering-substitute.js` + `server/modules/engineering-configurable-bom.js`；
- deterministic resolver；
- mobile UI：substitute list / detail / schema editor；configurable BOM preview/validate。
- 测试：`server/engineering-substitute.test.js` + `server/engineering-configurable-bom.test.js`。

#### Wave D — Routing Consolidation & Enrichment

- 收敛 legacy `routing_operations` mutation path（保留 table + FK；不再 active mutate）；
- additive enrichment `product_routings` / `product_routing_operations` 字段 + `product_routing_operation_links` 表；
- 新增 `server/modules/engineering-routing-enrichment.js`：topology metadata + operation refs validation；
- mobile UI：Routing detail 视图加 topology 视图与 enrichment 字段。
- 测试：`server/engineering-routing.test.js`。

#### Wave E — Engineering Change

- 新增 `engineering_change_orders` 表（id/doc_no/change_type/effective_date/approval_status/created_by/created_at/notes）；
- 新增 `engineering_change_items` 表（id/change_order_id/op_type/...）；
- 新增 `server/modules/engineering-change.js`：impact preview / apply / atomic transaction / audit；
- Change Type 支持 `IMMEDIATE / EFFECTIVE_DATE / USE_UP_OLD`；
- Allowed operations 按 change type 受限：
  - IMMEDIATE：ADD / MODIFY / DELETE / INVALIDATE / MODIFY_HEADER；
  - EFFECTIVE_DATE：ADD / MODIFY / INVALIDATE / MODIFY_HEADER；
  - USE_UP_OLD：MODIFY / MODIFY_HEADER + old/new material substitution relation；
- atomic apply，失败回滚，写 audit，历史 snapshot 不可被反向污染。
- mobile UI：ECO list → detail → create。
- 测试：`server/engineering-change.test.js`。

#### Wave F — Downstream Contract Stabilization

- 验证 Production Order / BOM snapshot / Routing snapshot / Material Issue 仍正常；
- 验证现有 MRP explosion 仍能读取 canonical effective BOM；
- 验证 Outsourcing `purpose=OUTSOURCE` BOM resolver contract 提供稳定合同；
- 不实现完整 MRP substitute planning / 完整 Outsourcing；
- 测试：`server/engineering-downstream.test.js`。

### 23.12 Migration / Schema / MySQL parity

- 所有新表 / 新字段 additive；
- `addColumn` helper 复用既有 `v13-phase*.js` 模式；
- `server/database/mysql-schema.js` 从 canonical SQLite snapshot 生成 MySQL DDL，并对已存在 completion marker 的 MySQL schema 对比 `information_schema` 执行 additive table/column/ordinary-index reconciliation；
- migration idempotent：缺表才 `CREATE TABLE IF NOT EXISTS`，缺列才 `ALTER TABLE ... ADD COLUMN`，缺普通索引才 `CREATE INDEX`；不 DROP/不重写业务数据；
- 测试覆盖 SQLite + 具备 MySQL 受保护 disposable 测试库时 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

### 23.13 Permission / RBAC

新增最少 Engineering permission 12 个（§28.5 列表）；保留既有 5 个角色 seed 与 BOM 用 `PRODUCTION_ORDERS_*` 兼容。

### 23.14 Audit / Transaction / State machine

- 所有 BOM/Routing/ECO/Substitute mutation：`transaction(db, work)` + `audit(db, ...)`；
- 历史 snapshot（production_order_*_snapshots）**不可写回修改**；
- Reference master lifecycle：`active=0` 而非 DELETE；
- 关键 cycle：DB mutation → re-read → check state → if conflicted throw。

#### 23.14.1 并发权威复读合同（2026-11-12 整改轮补入）

问题（真实缺陷，非风格问题）：ECO 的 `submit` / `approve` / `reject` / `apply` 与工程参考资料
master 的 `update` / `deactivate` 都在**事务外**读取权威状态，事务内的 `UPDATE` 又不带先决状态
条件。两个并发请求可以同时通过同一闸门：

- 并发双 `apply` 同一 ECO：两侧都读到 `APPROVED`，各自生成一个新 BOM 版本；
- 并发 `approve` 与 `reject` 同一 ECO：两侧都读到 `PENDING`，都写入终态，审计出现两条终态记录；
- 并发双 `deactivate` 同一 master：两侧都读到 `active=1`，产生**两条** `DEACTIVATE` 审计行。

合同（Requirement §28.8 A / §28.2「ECO / 参考资料 master 并发合同」）：

1. **事务内复读**：状态与引用守卫一律在 `transaction(db, ...)` 的回调内读取；
2. **行锁**：MySQL 下对被改写的主行使用 `SELECT ... FOR UPDATE`（SQLite 无此语义，按方言条件追加），
   使后到者等待先到者提交，随后读到**最新已提交**值；
3. **compare-and-swap**：状态迁移的 `UPDATE` 附带先决状态条件，并校验受影响行数必须为 1，
   否则以 `409` + 稳定错误码拒绝；
4. **幂等**：master 的 `deactivate` 在事务内读到 `active=0` 即直接返回，**不写审计**；
5. **守卫同事务**：引用计数与写入在同一事务内求值，被引用的 master 一律 `409`。

实现落点：`server/modules/engineering-change.js`（`loadChangeOrder(db, id, { lock })` 与四个迁移
函数）、`server/modules/engineering-reference.js`（`readActive(db, table, id, label, { lock })` 与
`updateEngineeringReferenceMaster` / `deactivateEngineeringReferenceMaster` / `updateWorkCenter` /
`deactivateWorkCenter`）。

#### 23.14.2 域级 ACK-4 campaign（2026-11-12 整改轮补入）

- Manifest：`MASTER_ENGINEERING_MYSQL_V1`，操作序列
  `RESET_SCHEMA_PRE_RUN → BOOTSTRAP_CURRENT_SCHEMA → RUN_ENGINEERING_RACES → CLEANUP_SCHEMA_POST_RUN`；
- 运行期文件：`scripts/gates/mysql-master-engineering-gate.mjs`（root）、
  `scripts/gates/mysql-master-engineering-child.mjs`（子进程）、
  `scripts/gates/mysql-master-engineering-root-lifecycle.mjs`（root 生命周期）、
  `scripts/gates/master-engineering-concurrency-worker.mjs`（每 worker 一条 MySQL 连接）；
- 套件：`server/mysql-master-engineering-concurrency.integration.js`（4 条 race），
  入口 `pnpm test:mysql:master-engineering`，launcher 条目 `test:mysql:master-engineering`；
- 该 campaign 与 M1-Core G07 / OUT-001 / Accounting & Analytics / Finance Operations 的
  Manifest 与生命周期**互相独立、互不复用**，运行期证据可唯一归属本域 campaign；
- `BOOTSTRAP_CURRENT_SCHEMA` 在真实 MySQL 8 上运行**全量当前迁移集**，因此本域 schema 对等
  由该步骤证明；`RUN_ENGINEERING_RACES` 在真实 MySQL 8 上证明并发行为等价。

### 23.15 Test Strategy

| Wave | 测试族 | 关注合同 |
|---|---|---|
| A | `engineering-reference.test.js` `engineering-work-center.test.js` | reference CRUD、formula grammar、calendar validation、work center reference guard |
| B | `engineering-bom.test.js` | lifecycle / purpose / version / cycle / tree / batch / snapshot immutability / analysis |
| C | `engineering-substitute.test.js` `engineering-configurable-bom.test.js` | substitute validation / priority / date / ratio / resolver；configurable preview/validate |
| D | `engineering-routing.test.js` | canonical convergence / operation refs / topology metadata / snapshot preservation |
| E | `engineering-change.test.js` | transition / allowed operations by change type / impact preview / apply atomic / audit / rollback / use-up-old boundary |
| F | `engineering-downstream.test.js` | production consumer stability / MRP consumer stability / outsource resolver contract
| Frontend | `engineering-frontend-contract.test.js` + `scripts/acceptance/v17-engineering-frontend.mjs` | Registry/API contract；Edge 320/390/430/680 响应式与 runtime error |
| MySQL schema | `engineering-mysql-schema.test.js`、`mysql-v14-1-hotfix-upgrade-path.integration.js` | 15 张工程表、5 张既有表上的 28 个 additive 列、7 个显式普通索引、metadata alias、existing DB upgrade、数据保留与二次启动幂等性 |
| MySQL 并发（域级 campaign） | `server/mysql-master-engineering-concurrency.integration.js` | ME-RACE-01 并发双 apply 只产生一个新 BOM 版本且只落一条 APPLY 审计；ME-RACE-02 并发 approve/reject 只产生一个终态与一条终态审计；ME-RACE-03 并发双 deactivate 只落一条 DEACTIVATE 审计；ME-RACE-04 被引用 master 的并发停用一律 409 且不落审计 |

所有 focused tests 纳入 `scripts/testing/test-suites.js`。

#### MySQL parity blocker 实施证据（2026-10-07）

- Root cause：`information_schema.COLUMNS` / `STATISTICS` 查询没有显式 alias，mysql2 返回 driver-native `COLUMN_NAME` / `INDEX_NAME`，而 reconciliation 读取 `row.column_name` / `row.index_name`；existing-column Set 因而得到 `undefined`，将已存在的 `id` 误判为缺失并执行重复 `ALTER TABLE ADD COLUMN id`。
- Fix：`readMySqlColumnNames()` 使用 `COLUMN_NAME AS column_name` 并按 `ORDINAL_POSITION` 排序；`readMySqlIndexNames()` 使用 `INDEX_NAME AS index_name`。bootstrap 统一复用这两个 canonical inspection helper，不增加 `id` 特判、不吞掉 `ER_DUP_FIELDNAME`、不禁用 reconciliation。
- Upgrade path：真实 MySQL 测试先构造 pre-Engineering schema，移除 15 张新表及代表性 additive 列，再连续初始化两次；验证新表/列只补齐一次、既有 Work Center 行与 Engineering permission mapping 不变、table count 恢复且稳定。
- Fresh / second start：fresh bootstrap 的应用表集合与 canonical SQLite snapshot 精确相等，另仅有 2 张 MySQL infrastructure 表；第二次初始化无 duplicate table/column/index 且无数据变更。
- Schema count：当前 snapshot / migration 计算结果为 15 张新表、28 个 additive 列、7 个显式普通索引；不再沿用旧的 174/172 hard-coded table count，MySQL gate 改为与实时权威 snapshot/source 精确比对。

#### Expression-column UNIQUE bootstrap fix (2026-10-18)

- Trigger：在真实 MySQL gate 执行 `pnpm test:mysql` 时，Wave 0 套件的 fresh bootstrap 在 `bootstrapMySql`（`server/database/mysql-schema.js:271`）抛 `ER_KEY_COLUMN_DOES_NOT_EXITS: Key column 'null' doesn't exist in table`，所有 14 个真实 MySQL functional suite 都无法启动。
- 根因：`captureSqliteSnapshot` 使用 `PRAGMA index_info(<index>)` 读取索引列；SQLite 对表达式列返回 `{ seqno, cid: -2, name: null }`。Wave 7 唯一索引 `uq_sales_reservation_intent_order_line_mode` 在 SQLite 端定义为 `CREATE UNIQUE INDEX ... ON sales_reservation_intent(sales_order_id, COALESCE(sales_order_item_id, ''), reservation_mode)`，snapshot 的 `columns` 因此是 `['sales_order_id', null, 'reservation_mode']`。`bootstrapMySql` 旧决策 `useDigest = unique && (where || columns.length > 4)` 对 3 列表达式唯一索引返回 `false`，落到 `mysqlIndexColumnList` 路径，`quote(null)` 输出字面 `` `null` ``，MySQL 抛 errno 1072。
- Fix：
  - `hasExpressionColumns(index)`：在 snapshot 数组中检测任意 position 的 column 是非字符串、或 expressions[position] 与 column 不同。导出用于 bootstrap / reconciliation / tableDefinition 三处统一路由。
  - `mysqlIndexColumnList`：对每个 column 做严格校验，非法时抛出引用 table + index + position 的明确错误；不再默默把 `null` 渲染为 `` `null` ``。
  - `generatedPartialIndex`：已支持 null column + expression 替换路径；补充缺 column 且缺 expression 的失败校验；where 缺失时安全 fallback 为 `1=1`。
  - `bootstrapMySql` fresh 路径：`useDigest = hasExpressionColumns(index) || (unique && (where || columns.length > 4))`，把表达式唯一索引强制路由到 digest 路径，保留 unique/where/>4 列原有触发条件不变。
  - `planMySqlIndexReconciliation`：表达式列索引拒绝 reconciliation，明确要求其属于 canonical migration（与 Wave 7 `ensureMySqlReservationIntentUniqueness` 的角色一致）；不静默忽略、不放宽 fail-closed。
  - `tableDefinition`：inline UNIQUE 检测到表达式列时直接抛错并引用 table + index + 列数组，避免 inline 维度上悄悄产出 `` UNIQUE (...,`null`,...) ``。
- 兼容性：SQLite 路径、PRAGMA 读取逻辑、`MYSQL_INDEX_PREFIX_LENGTHS`（Wave 6 LOT frontier 前缀）均未改动。Wave 7 migration 的 `MYSQL_WAVE7_INDEXES` 不含表达式列，digest 行为对其透明。
- Focused tests：`server/database/mysql-schema-bug-fix.test.js` 25/25 PASS；`node --check` 通过；未运行 `pnpm test:mysql*` / `pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build`。

### 23.16 Canonical Gates

按 AGENTS.md §10：

- 跨域 / 架构 / canonical metadata 阶段：`pnpm test` + `pnpm build` + `git diff --check`；
- 触及 high-risk schema 时：`pnpm test:heavy`；
- 具备受保护 disposable MySQL 环境时：`pnpm test:mysql` + `pnpm test:mysql:concurrency`；
- 每个 Wave 必须先 focused tests PASS 才进入下一 Wave。

### 23.17 Rollback

按 AGENTS.md §13：

- 所有 migration additive；无 destructive rewrite；
- 任何新 permission 未应用时，旧 `PRODUCTION_ORDERS_*` 隐含路径仍工作；
- 历史 Production snapshot 永不修改；
- legacy `routing_operations` 表 + FK 保留，停止 active mutation 可立即回滚（重新开启 mutation path）。
- Out-of-Scope 标记（Multi-Org / Mold / Mold Combination / Auxiliary / full MRP substitute consumption / full Outsourcing / full APS）不通过本 Domain Closure 提交。

### 23.18 Frontend Information Architecture

- 既有 master-engineering Launcher 不爆炸；
- 8 Domain Launcher 保持当前 8 Domain；
- `master-engineering` Launcher 改造：现有 3 项（products / boms / product-routings）保持 + 新增：
  - `engineering-reference` 工作面（9 类 master 入口 + Work Center 增强入口）以 single page + sheet 实现；
- `engineering-substitute` 合并 Substitute + Configurable BOM 工作面，`engineering-change` 为 bounded ECO 工作面；两者均是 master-engineering Launcher 内的 canonical route，不创建第二套 executable screen。

---

**MASTER & ENGINEERING DOMAIN CLOSURE DESIGN — READY FOR AUTHORIZED IMPLEMENTATION**

---
