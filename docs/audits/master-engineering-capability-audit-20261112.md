# Master & Engineering 工程主数据域 — 域级能力审计基线（2026-11-12）

> **用途**：登记 B3118 工程数据域**域级 Acceptance** 的逐项能力复核证据，覆盖 `document.md` §22.18 的 **21 项能力**（Requirement §28.3 的 ME-01～ME-31 evidence 集）。
>
> **Owner**：Master & Engineering Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`IMPLEMENTED`（逐项复核与整改轮均已完成）——**域级 Acceptance 与 Capability Freeze 尚未签发**，等待业务所有者裁定。
>
> **权威来源**：Requirement [`docs/requirements/master-engineering.md`](../requirements/master-engineering.md) §28.1～§28.10；Design [`docs/design/master-engineering.md`](../design/master-engineering.md) §23；能力基线 `document.md` §22.18；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件不改写合同正文，只记录**当前 HEAD 上的复核结论**。

## 1. 复核方法与判定纪律

逐项定位 Requirement 条款、Design 条款、生产写入口（route + canonical owner）、可执行测试（文件 + 用例名）、**能力的事实是否被业务路径消费**，以及是否被 Requirement §28.7 明确排除。

判 `COVERED` 需同时成立：① 有生产写入口；② 服务端具备来源、状态机、权限、事务约束；③ 有可执行测试覆盖正例且至少一个反例；④ 事实进入业务路径。

测试分类：**Class A = 新合同正例**；**Class B = 已知缺陷复现**。本轮未新增 Class B 用例。

## 2. 复核结论摘要

| 阶段 | `COVERED` | `PARTIAL` | `OUT_OF_SCOPE` | `MISSING` |
|---|---|---|---|---|
| 整改前（§22.18 基线） | **13** | **5** | — | **3**（其中 3 项已被 §28.7 排除） |
| 整改后（2026-11-12 整改轮完成） | **17** | **1** | **3** | **0** |

整改前的 5 项 `PARTIAL`：工作日历/班次、资源/设备、工序/作业、Routing Topology、Old Material Cleanup。

整改后的 1 项 `PARTIAL`：**Old Material Cleanup**。Requirement §28.4 自身把该项的目标定为 `PARTIAL — CROSS_DOMAIN_DEPENDENCY`（当前库存可参考；预计入供应类型依赖未来 Domain），因此本轮补齐了**在范围内**的「当前库存 cleanup candidate」查询，而**预计入供应**那一段按合同仍属跨域依赖。

整改后的 3 项 `OUT_OF_SCOPE`：多组织分发、Mold / Mold Combination、Engineering Auxiliary Attributes —— 三项均被 Requirement §28.7 明确排除（Multi-Org 为当前产品基线外；Mold / Mold Combination 与复杂辅助属性为 `DEFER_SOURCE_DETAIL`）。它们**不是**实现缺口。

## 3. 21 项能力逐项复核（整改后判定）

| # | 能力 | 实现（owner / route / schema） | 测试 / UAT 证据 | 判定 | 缺口 |
|---|---|---|---|---|---|
| 1 | 工作日历 / 班次 | `engineering-reference` · `/api/engineering/{shifts,shift-patterns,calendar-templates,work-calendars}` · `engineering_shifts` / `_shift_patterns` / `_calendar_templates` / `_work_calendars` | wave-a focused；`engineering-reference-lifecycle.test.js` · 十族生命周期逐族走查 + 引用守卫 409 | COVERED | 整改轮补齐 update / deactivate；班次、班制、日历模板、工作日历四族现均可改可停 |
| 2 | 车间公式 | `engineering-reference` · 受限 grammar（`server/lib/formula-evaluator.js`，无 `eval`/`Function`） · `engineering_workshop_formulas` | wave-a focused（公式安全）；`engineering-reference-lifecycle.test.js` · 不安全公式被更新路径拒绝 | COVERED | 整改轮修复界面缺陷：编辑既有公式原先走 POST，会**新建重复 master**，现改为 PATCH |
| 3 | 资源 / 设备 | `engineering-reference` · `/api/engineering/{resources,equipment}` · `engineering_resources` / `engineering_equipment` | `engineering-reference-lifecycle.test.js` · 更新持久化 + 停用幂等 + 非法值 400 不落库 | COVERED | 整改轮补齐 update / deactivate |
| 4 | 工序 / 作业 | `engineering-reference` · `/api/engineering/{operations,control-codes,basic-activities}` · `engineering_operations` / `_control_codes` / `_basic_activities` | 同上；引用守卫：被活动作业引用的基础活动拒绝停用（409） | COVERED | 整改轮补齐 update / deactivate + 引用守卫 |
| 5 | 工作中心 | `engineering-reference::updateWorkCenter` / `deactivateWorkCenter` · `work_centers` | wave-a focused（PATCH + deactivate + 引用守卫） | COVERED | — |
| 6 | BOM 生命周期 | `engineering-bom` · `/api/engineering/boms` · `boms`（purpose / effective / approval lifecycle） | wave-b focused | COVERED | — |
| 7 | BOM Purpose | 同上（`GENERAL` / `SELF_MAKE` / `OUTSOURCE`） | wave-b focused | COVERED | — |
| 8 | BOM 批量 / 树形维护 | `engineering-bom::previewBomBatch` / `applyBomBatch` / `expandBomTree` | wave-b focused（preview→apply atomic） | COVERED | — |
| 9 | BOM 工程分析 | `engineering-bom::whereUsed` / `consolidateBom` / `compareBoms` / `bomCostReference` | wave-b focused | COVERED | — |
| 10 | 多组织分发 | 无实现 | — | **OUT_OF_SCOPE** | Requirement §28.7：Multi-Org Distribution 明确不在本 Domain Closure 范围（当前产品基线外） |
| 11 | 配置 BOM | `engineering-configurable-bom::previewConfigurableBom` / `validateConfigurableBom` | wave-c focused | COVERED | — |
| 12 | 替代料 | `engineering-substitute` · `/api/engineering/substitute-{schemes,}` · `engineering_substitute_schemes` / `_substitutes` + `findSubstitutesForPrimary` | wave-c focused | COVERED | — |
| 13 | 工艺路线 | `product-routing`（canonical）+ `engineering-routing-enrichment` | wave-d focused（legacy 收敛） | COVERED | — |
| 14 | Routing Topology | `product_routings.topology_type` + `product_routing_operation_links.link_type` + **新增 `product_routing_operations.topology` / `topology_meta`** | `engineering-topology-cleanup.test.js` · 工序级拓扑可写可读、非法拓扑 400 不落库、删最后一条 link 回退 LINEAR | COVERED | 整改轮补齐：路由 master 上原本没有工序级拓扑；删除最后一条 link 后 `topology_type` 仍留在 NETWORK |
| 15 | Engineering Change | `engineering-change` · create/submit/approve/reject/preview/apply · `engineering_change_orders` / `_items` | wave-e focused（ECO 生命周期 + impact preview + atomic apply） | COVERED | — |
| 16 | Old Material Cleanup | **新增** `engineering-cleanup::listEngineeringCleanupCandidates` · `GET /api/engineering/cleanup-candidates` | `engineering-topology-cleanup.test.js` · 已退出 ACTIVE BOM 但仍有库存的组件被判为候选；仍在 ACTIVE BOM 的组件不判 | **PARTIAL** | 「当前库存可参考」一段已闭合；**预计入供应**一段按 Requirement §28.4 仍属 `CROSS_DOMAIN_DEPENDENCY`（Planning 计划供应 + Procurement 未清采购订单），本域不消费 |
| 17 | Mold / Mold Combination | 无实现 | — | **OUT_OF_SCOPE** | Requirement §28.7：`DEFER_SOURCE_DETAIL`（用户手册 source 不足） |
| 18 | Engineering Auxiliary Attributes | 无实现 | — | **OUT_OF_SCOPE** | Requirement §28.7：`DEFER_SOURCE_DETAIL` |
| 19 | BOM 权限独立族 | `ENGINEERING_BOM_VIEW` / `_MANAGE` / `_APPROVE`（共 12 个 `ENGINEERING_*` 权限，server/db.js） | wave-b focused（后端 fail closed；admin 继承，其余角色不越权） | COVERED | — |
| 20 | Routing Canonical Convergence | `product_routing_operations` 为 canonical；legacy `routing_operations` 表与 FK 保留但停止 active mutation | wave-d focused（legacy 收敛断言） | COVERED | — |
| 21 | Production Snapshot | `production_orders.bom_id` / `production_order_routing_snapshots` 不可写回 | wave-f focused（快照不可变） | COVERED | — |

## 4. 本轮修复的真实缺陷与文档失真

| 编号 | 事实 | 影响 | 状态 |
|---|---|---|---|
| `ME-DEF-01` | 9 个工程参考资料 master（班制 / 日历模板 / 工作日历 / 基础活动 / 车间公式 / 资源 / 设备 / 作业 / 控制码）**只有 create + list**，没有 update、没有 deactivate；Requirement §28.8 明确要求「CRUD 闭环」与「强制 lifecycle active/inactive」 | Requirement §28.4 的三条 `COVERED` 目标（工作日历班次、资源设备、工序作业）实际未达成 | **已修复**：规格驱动的 update / deactivate + 引用守卫 + 20 条路由 |
| `ME-DEF-02` | 参考资料的**前端工作面从不调用 PATCH**，编辑能力即使实现也不可达 | 生命周期能力此前只存在于 API 层 | **已修复**：工作面新增共享的编辑 / 停用动作，并补 44px 触控目标；浏览器验收新增「打开详情并断言动作存在且不小于 44px」 |
| `ME-DEF-03` | 界面编辑**既有**车间公式走 POST，会**新建重复 master** 而不是更新 | 公式 master 可被重复创建 | **已修复**：既有公式改走 PATCH |
| `ME-DEF-04` | `document.md` §22.18 声称「当前库存 cleanup candidate/log 已落地」，实际**只有日志行**，没有候选查询、没有任何库存读、前端无入口 | 能力矩阵高估了既有实现 | **已修复**：实现候选查询；§22.18 的表述同步更正 |
| `ME-DEF-05` | `document.md` §22.19 声称 `product_routing_operations.topology` 存在，该列实际在 `production_order_operations`（M&Q 的快照表）上，路由 master 上没有 | 文档指向错误的表 | **已修复**：在路由 master 上新增真实的工序级拓扑列，并更正文档 |
| `ME-DEF-06` | 删除最后一条拓扑 link 后 `product_routings.topology_type` 仍留在 `NETWORK` | 路由描述了一个已不存在的拓扑 | **已修复**：最后一条 link 删除时回退 `LINEAR` |
| `ME-DEF-07` | Design §23.1 列出的 `server/modules/engineering-work-center.js` **不存在**（工作中心代码在 `engineering-reference.js`） | Design 指向不存在的模块 | **已修复**：Design 归属按实现事实更正 |
| `ME-DEF-08` | Design §23.15 列出的测试族名与实际文件名不符（实际为 `*-integration.test.js`） | Design 的测试清单不可执行 | **已修复**：Design 清单按实现事实更正 |

## 5. 验收证据与证据边界

### 5.1 本轮实测 Gate

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3740/3740 PASS**，0 失败 |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 域内 focused（9 个既有工程套件） | **63/63 PASS** |
| 整改轮新增合同套件 `server/engineering-reference-lifecycle.test.js` | **7/7 PASS** |
| 整改轮新增合同套件 `server/engineering-topology-cleanup.test.js` | **5/5 PASS** |
| 浏览器（真实 Edge，`v17-engineering-frontend.mjs`，4 工作面 × 320/390/430/680） | **PASS**，含「打开参考资料详情 → 断言编辑/停用动作存在 → 断言触控目标不小于 44px」 |
| 非空洞证明 | 变异实验：把生命周期按钮强制为 20px 后，浏览器验收按预期 **FAIL** 并指出 `编辑`/`停用` 两个目标 |
| 真实 MySQL 8 | **PASS**：run `63805c9f-a1f9-4ae1-97a9-32329c7e9254`、commit `de9496b`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明）；目标 `modern_erp_domain_test` @ `127.0.0.1:3306`，server uuid `256c7a4e-d275-11f1-885b-b025aa71d167`，grants sha256 `bef61617d1b96913f479c7642176eca53f60410b003773707cd56355e4ce807e` |

### 5.2 真实 MySQL 证据（按 `MYSQL-EV-01`）

按项目级统一口径，本域的证据分两段：

| 段 | 覆盖 | 证据 |
|---|---|---|
| schema 对等 | 本域 15 张新表 + 28 个加法列 + 本轮新增的 2 个工序级拓扑列，在真实 MySQL 8 上被接受 | `test:mysql:accounting-analytics` campaign 的 `BOOTSTRAP_CURRENT_SCHEMA` 步骤在**全量当前迁移集**上运行（工程域迁移链在其中）；run `63805c9f-a1f9-4ae1-97a9-32329c7e9254`、commit `de9496b`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`，清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明 |
| 行为等价 | 生命周期守卫、BOM 周期拒绝、快照不可变、ECO 原子应用 | 本域 focused 合同套件（含负例） |

**残余**（随冻结显式登记）：本域 15 张表**没有**列入任何可运行 campaign 的**列级** parity 清单（`M1_CORE_PARITY_TABLES` 16 张采购/库存表、`AA_PARITY_TABLES` 47 张会计/分析表，均不含工程表），因此「真实 MySQL 上的列级 schema parity」未被单独取证；「真实 MySQL 上的工程域并发行为等价」同样未被单独取证。两者均按 `MYSQL-EV-01` 登记为残余，不得表述为已证明。

### 5.3 治理证据

| 检查 | 结果 |
|---|---|
| 跨域错误码耦合守卫 | 双 PASS |
| 验收记录有效性守卫 | PASS |
| 文档一致性 | `current` N1、N3～N6、N8、N9 PASS；N2 `RETIRED`；**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` C1～C6 全 PASS |

## 6. 未解决矛盾与待业务所有者裁定

| 编号 | 事项 | 需要裁定的问题 |
|---|---|---|
| `ME-DEC-01` | 真实 MySQL 的**列级 parity** 与**并发行为等价**未单独取证（§5.2） | 接受为随冻结的显式残余；或授权新建 `MASTER_ENGINEERING_MYSQL_V1` 域级 campaign（需要新 manifest、launcher 条目与业主逐次签发 ACK-4 capability） |
| `ME-DEC-02` | §5.2 的残余 | 业务所有者确认残余范围 |
| `ME-DEC-03` | 域级 Acceptance 与 Capability Freeze 的签发范围 | — |

## 7. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 建立本审计基线并完成整改轮：21 项能力由 13 `COVERED` / 5 `PARTIAL` / 3 `MISSING` 变为 **17 `COVERED` / 1 `PARTIAL` / 3 `OUT_OF_SCOPE`**；修复 `ME-DEF-01..08`；新增 2 个合同套件（12 条用例，含负例）与 1 个浏览器断言组。**仍未签发域级 Acceptance。** |
