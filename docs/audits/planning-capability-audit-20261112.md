# Planning 计划域 — 域级能力审计基线（2026-11-12）

> **用途**：登记 B3120 计划域**域级 Acceptance** 的逐项能力复核证据，覆盖 Requirement `docs/requirements/planning.md` §30.2 的 PL-01～PL-45 共 45 项能力。本文件同时登记整改轮（2026-11-12）前后的两次判定、整改轮修复的真实缺陷与共享基线 Gate 结果。
>
> **Owner**：Planning Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`IMPLEMENTED`（逐项复核与整改轮均已完成）——**域级 Acceptance 与 Capability Freeze 尚未签发**，等待业务所有者裁定。本文件是候签材料的证据来源，不构成 Acceptance 本身。
>
> **权威来源**：Requirement [`docs/requirements/planning.md`](../requirements/planning.md) §30；Design [`docs/design/planning.md`](../design/planning.md) §25；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。
>
> 本文件不改写 `document.md §30` 与 `docs/requirements/planning.md` 的合同正文，也不改写 `log/2026-10-08.md` 的历史 Planning Domain Final Acceptance 记录；历史结论保留，本文件是**当前 HEAD 的复核结论**。

## 1. 复核方法与判定纪律

逐项定位 Requirement 条款、Design 条款、生产写入口（route + canonical owner）、可执行测试（文件 + 用例名）与明确延期。

**不凭文件存在宣称 `COVERED`**。判 `COVERED` 需同时成立三项：

1. 有**生产写入口**（route → canonical owner）；
2. 服务端具备来源、状态机、权限、事务约束；
3. 有**可执行测试**覆盖正例，且至少覆盖一个反例（拒绝 / 幂等 / 越权 / 零副作用）。

证据不足一律降级为 `PARTIAL`，实现完全缺席记 `MISSING`，与 Requirement §30.7 明确延期/排除的记 `OUT_OF_SCOPE`。

测试分类按已确立的两类口径记录：**Class A = 新合同正例**（身份 / 行数 / 余额断言）；**Class B = 已知缺陷复现**。本轮未新增 Class B 用例。

## 2. 复核结论摘要

| 阶段 | `COVERED` | `PARTIAL` | `MISSING` | `OUT_OF_SCOPE` |
|---|---|---|---|---|
| 整改前（2026-11-12 上午审计） | **34** | **7** | **4** | **0** |
| 整改后（2026-11-12 整改轮完成） | **45** | **0** | **0** | **0** |

整改前：`PARTIAL` = PL-07 / 17 / 19 / 31 / 42 / 44 / 45；`MISSING` = PL-24 / 25 / 36 / 38。

整改轮把 11 项能力全部落到实现与可执行证据（新增 `server/planning-closure-remediation.test.js` 9 条合同用例），并修复 7 项真实缺陷（§4）。

**仍然不能签发域级 Acceptance 的唯一原因**：Requirement §30.6 与 Design §25.17 / §25.19 的**真实 MySQL 行为等价**条款在本仓库当前门禁基础设施下无法满足（§5.2），必须作为显式残余随冻结接受，或由业务所有者另行授权新建 `PLANNING_MYSQL_V1` 域级 campaign。

## 3. PL-01～PL-45 逐项复核（整改后判定）

| ID | 名称 | Requirement | Design | 实现（route / owner） | 测试（文件 · 用例） | 判定 | 缺口 |
|---|---|---|---|---|---|---|---|
| PL-01 | 计划参数 | §30.2 / §30.3 | §25.2 | `GET/PATCH /api/planning/parameters` → `planning-domain.js::getPlanningParameters` / `updatePlanningParameters`；表 `planning_parameters`（`planning-domain-schema.js:20`，singleton `DEFAULT`） | `planning-domain-closure.test.js` · schema and permissions are additive and available | COVERED | `reservation_enabled` 是唯一权威来源；关闭时 409 拒绝新增但保留历史查询 |
| PL-02 | 物料策略 | §30.2 / §30.3 | §25.2 | `GET /api/planning/material-policies` · `PATCH .../:id` → `updateMaterialPolicy`；表 `planning_material_policies`（`:29`）；legacy `products.min_stock/reorder_point/max_stock/lead_time_days` 在同事务投影（`planning-domain.js:100`） | `m11-planning.test.js`；`planning-domain-closure.test.js` · schema and permissions | COVERED | Product API 无这些字段的活动写入路径，legacy 仅作兼容投影 |
| PL-03 | 供给策略 `AUTO/MAKE/BUY/OUTSOURCE` | §30.2 / §30.3 | §25.2 | `planning.js::decideSupplyType`（`:787`）；优先级 run override > policy > `AUTO` 推断 | `m11-planning.test.js` · 30（ACTIVE BOM → MAKE，否则 BUY） | COVERED | — |
| PL-04 | Planning Scheme | §30.2 / §30.3 | §25.3 | `GET/POST /api/planning/schemes` · `PATCH /:id` · `/:id/(activate\|deactivate)` → `planning-domain.js:116..213`；表 `planning_schemes`（`:45`）+ `planning_scheme_demand_sources`（`:68`）/ `_supply_sources`（`:77`） | `planning-domain-closure.test.js` · scheme lifecycle and manual planned-order release | COVERED | 只有 ACTIVE scheme 可用于新 run（`loadSchemeSnapshot`） |
| PL-05 | Scheme default / run override / snapshot | §30.2 / §30.3 | §25.3、§25.9 | `mrp_runs.scheme_id / scheme_snapshot / calculation_scope_mode / config_snapshot`（`planning-domain-schema.js:276..284` additive） | `m11-planning.test.js` · 38、39、40、41（completed run 不可变） | COVERED | 重算必须新建 run |
| PL-06 | 可扩展需求来源 + Safety Stock | §30.2 / §30.3 | §25.3、§25.6 | scheme demand source 行支持 `SALES_ORDER/FORECAST/SAFETY_STOCK/BOM_COMPONENT`；`planning.js:910` 按 scheme 是否启用 SAFETY_STOCK 决定纳入 | `m11-planning.test.js` · 42、43、44；`planning-closure-remediation.test.js` · PL-19 | COVERED | floor 语义见 PL-19 |
| PL-07 | 供给来源 + 仓库范围 | §30.2 / §30.3 | §25.7 | `planning-time-phased.js::buildPlanningSupplyEvents`（仓库范围按 scheme 参与仓库过滤）；`planning.js::computeNetting` 消费同一供给来源 | `planning-closure-remediation.test.js` · PL-07（参与仓库外的库存不计入净额） | COVERED | 整改前为 `PARTIAL`：on-hand / 采购 / 生产供给均按 product 汇总全部仓库 |
| PL-08 | Scheme ↔ 仓库参与 | §30.2 / §30.3 | §25.3 | 表 `planning_scheme_warehouses`（`planning-domain-schema.js:86`）；`planningSchemeWarehouseScope` 读取参与仓库并进入净额计算 | `planning-closure-remediation.test.js` · PL-07 / PL-08 | COVERED | 整改前为 `PARTIAL`：参与表存在但未参与计算 |
| PL-09 | Forecast 生命周期 | §30.2 | §25.4 | `planning.js:createPlanningForecast` / `activatePlanningForecast` / `cancelPlanningForecast`（`:177/232/247`） | `m11-planning.test.js` · 4、8、9、10 | COVERED | — |
| PL-10 | ACTIVE 表达"已下达/生效" | §30.2 | §25.4 | `planning_forecasts.status` 存储枚举；presentation 另行表达业务语义 | `m11-planning.test.js` · 9、10 | COVERED | 不做机械 rename |
| PL-11 | Forecast Consumption 显式分配 | §30.2 / §30.3 | §25.4 | `planning-domain.js::allocateForecastConsumption`（`:241`），MRP run 路径在 `planning.js:871` 调用；**有效需求 = 剩余 Forecast**（`effectiveForecastRows`） | `planning-domain-closure.test.js` · forecast consumption is deterministic；`m11-planning.test.js` · 45、45b；`v13-phase6e-commercial-golive.test.js` · canonical allocation | COVERED | 整改轮同时关闭了 `PLAN-DEF-05`（legacy MAX 第二套算法已退出 active authority） |
| PL-12 | Consumption 查询 | §30.2 | §25.4 | 表 `forecast_consumptions`（`planning-domain-schema.js:96`）；`GET /api/planning/reports/forecast-consumption` → `listForecastConsumption`；run 明细另含 `run.consumptions`（original / consumed / remaining） | `planning-domain-closure.test.js` · forecast consumption；`m11-planning.test.js` · 45、45b | COVERED | — |
| PL-13 | 计算范围 `GLOBAL/SELECTED/PRECISE_SELECTED` | §30.2 / §30.3 | §25.5 | `planning.js:558..559` 模式校验；`selectedDemandRows`（`:802`）；`mrp_run_source_selections`（`planning-domain-schema.js:111`） | `m11-planning.test.js` · 42 | COVERED | `SELECTED` / `PRECISE_SELECTED` 仍无端到端专门用例（登记为证据缺口，非能力缺口） |
| PL-14 | Run 不可变 | §30.2 / §30.3 | §25.9 | `executeMrpRun`（`planning.js:832`）单 transaction 重读 DRAFT；completed run 禁止 mutation（`:598`/`:638` 返回 409） | `m11-planning.test.js` · 37、38、39、40、41 | COVERED | — |
| PL-15 | MRP 日志与配置快照 | §30.2 | §25.9 | 表 `mrp_run_logs`（`planning-domain-schema.js:142`）；`GET /api/planning/reports/mrp-log` | `m11-planning.test.js` · 47 | COVERED | — |
| PL-16 | 净额数学不变式 | §30.2 / §30.3 | §25.6 | `planning.js::explodeBomLevels`（按层级推进，共享组件只净额一次） | `m11-planning.test.js` · 31、32、33、34、49..57；`planning-closure-remediation.test.js` · 共享组件只净额一次 | COVERED | 整改轮关闭了 `PLAN-DEF-06`（按父级递归导致共享组件库存被多次净额） |
| PL-17 | 时间分段供需事件 | §30.2 / §30.3 | §25.5、§25.6 | `planning-time-phased.js::projectTimePhasedNetting`（事件排序 + 余额投影）；run 明细暴露 `run.events`（含 DEMAND / SUPPLY、日期、投影余额）；`mrp_run_events` 写入供给事件 | `planning-closure-remediation.test.js` · PL-17（事件带日期与 projectedBalance） | COVERED | 整改前为 `PARTIAL`：事件表存在但净额是单 horizon 聚合，无时间桶 |
| PL-18 | 权威需求日期与生命周期 | §30.2 | §25.7 | `openSalesDemand` 只取 APPROVED，日期取 `requested_delivery_date` 并有 legacy fallback | `m11-planning.test.js` · 13..18 | COVERED | — |
| PL-19 | Safety Stock floor | §30.2 / §30.3 | §25.6 | 安全库存**不再计入交易性毛需求**；它是对预计余额的 floor，每产品 / 每 horizon 只产生一次补足净需求（`planning.js` 净额循环） | `planning-closure-remediation.test.js` · PL-19（两个需求桶只产生一次 floor 补足：gross 10 + floor 5 = net 15） | COVERED | 整改前为 `PARTIAL`：安全库存以加总毛需求方式实现 |
| PL-20 | 采购供给口径 | §30.2 | §25.7 | `buildPlanningSupplyEvents` 的采购分支 = APPROVED PO 剩余，已收货只进入 on-hand | `m11-planning.test.js` · 19..23、23b | COVERED | — |
| PL-21 | 生产 firm supply 口径 | §30.2 / §30.3 | §25.7 | `buildPlanningSupplyEvents` 的生产分支只计 `RELEASED/IN_PROGRESS` 未入库余量 | `m11-planning.test.js` · 24、25、26、27 | COVERED | — |
| PL-22 | 统一 BOM resolver | §30.2 / §30.3 | §25.8 | `planning.js:29` 引入 `resolveEffectiveBomForCaller`，`productBom`（`:369..370`）按 SELF_MAKE→GENERAL 回退 | `m11-planning.test.js` · 30、31 | COVERED | 不再查询 `boms.status='ACTIVE'` |
| PL-23 | 多层/损耗/循环/共享聚合 | §30.2 | §25.8 | `explodeBomLevels`（净需求驱动、按层级聚合、祖先集检测循环、深度上限） | `m11-planning.test.js` · 31..34、50..54；`planning-closure-remediation.test.js` · 共享组件 | COVERED | — |
| PL-24 | Engineering 替代料保守消费 | §30.2 / §30.3 | §25.8 | `engineering-substitute.js::findSubstitutesForPrimary`（canonical resolver）+ `planning-domain.js::writeSubstituteSuggestions`；MRP run 在短缺时写入建议 | `planning-closure-remediation.test.js` · PL-24 / PL-25 | COVERED | 整改前为 `MISSING`：Planning 完全不读替代料事实 |
| PL-25 | 替代料建议查询 | §30.2 | §25.8 | `GET /api/planning/reports/substitute-suggestions` → `planningSubstituteSuggestions`（主料 / 替代 / availability / source / date / strategy / method / quantity basis） | `planning-closure-remediation.test.js` · PL-24 / PL-25 | COVERED | `MANUAL` 策略只记录建议、绝不自动替代（`suggested_quantity = 0`） |
| PL-26 | Pegging | §30.2 | §25.9 | 表 `mrp_run_pegging`（`planning-schema.js:163`）；`upsertPegg`（`planning.js`） | `m11-planning.test.js` · 47、54、57 | COVERED | Pegging 与 Reservation 分表分语义 |
| PL-27 | Reservation 独立实体 | §30.2 / §30.3 | §25.11 | 表 `planning_reservations`（`planning-domain-schema.js:208`）；`createPlanningReservationCanonical`（`planning-domain.js`）为唯一 canonical 写入口 | `planning-domain-closure.test.js` · strong reservation | COVERED | — |
| PL-28 | Strong Reservation 超分配 fail closed | §30.2 / §30.3 | §25.11 | `createPlanningReservationCanonical`：按供给来源锁行后计算 `available - reserved`，越界 409 `PLANNING_RESERVATION_CAPACITY_EXCEEDED` | `planning-domain-closure.test.js` · strong reservation（正例 + 越权占用反例） | COVERED | — |
| PL-29 | Weak Reservation | §30.2 | §25.11 | `RESERVATION_TYPES` 含 `WEAK`；`releaseWeakReservationsForScheme` | `planning-domain-closure.test.js` · scheme lifecycle | COVERED | — |
| PL-30 | Reservation 释放策略 | §30.2 / §30.3 | §25.11 | scheme `reservation_release_policy` = `KEEP_ALL/RELEASE_WEAK`；run 执行前真实释放；到期 manual reservation 转 RELEASED | `planning-domain-closure.test.js` · scheme lifecycle | COVERED | Strong 不被 `RELEASE_WEAK` 释放 |
| PL-31 | Manual Reservation Order | §30.2 / §30.3 | §25.11 | `createPlanningReservationCanonical` 接受 `supplySourceType='EXPECTED'` + `expectedSupplyQuantity`：该预期供给身份的**容量上限**由首次声明确定，后续预留共享同一上限并受同一超分配守卫约束 | `planning-closure-remediation.test.js` · PL-31（超容量 409、容量不可变更 409） | COVERED | 整改前为 `PARTIAL`：EXPECTED 被直接拒绝，且 `physicalSupplyQuantity` 的 `EXPECTED → Infinity` 分支使守卫失效 |
| PL-32 | Planned Order 实体 | §30.2 / §30.3 | §25.10 | 表 `planned_orders`（`planning-domain-schema.js:153`）+ `planned_order_source_links`（`:187`）；`createPlannedOrder`、`materializePlannedOrders` | `planning-domain-closure.test.js` · MRP shortage becomes one traceable planned order and is idempotent | COVERED | 独立于 `mrp_run_results` |
| PL-33 | Planned Order 生命周期 | §30.2 | §25.10 | `DRAFT/CONFIRMED/RELEASED/CLOSED/CANCELLED`；`confirmPlannedOrderCore` / `closeOrCancelPlannedOrderCore` | `planning-domain-closure.test.js` · scheme lifecycle | COVERED | — |
| PL-34 | Split | §30.2 | §25.10 | `splitPlannedOrder`，quantity 守恒 + source link 继承 | `planning-domain-closure.test.js` · scheme lifecycle | COVERED | — |
| PL-35 | Merge | §30.2 | §25.10 | `mergePlannedOrders`，同 product/type/status/policy/date 兼容守卫 | `planning-domain-closure.test.js` · scheme lifecycle | COVERED | — |
| PL-36 | Batch 维护 | §30.2 | §25.10 | `POST /api/planning/planned-orders/batch/preview`（hash 绑定当前版本）· `POST .../batch/:id/apply`（重读全部行，任一冲突全回滚）；表 `planning_planned_order_batches` | `planning-closure-remediation.test.js` · PL-36（批量确认成功 + 版本冲突时全批不生效 + 重放 409） | COVERED | 整改前为 `MISSING`：无任何批量维护入口 |
| PL-37 | 供给目标受控变更 | §30.2 | §25.10 | `changePlannedOrderTarget`，仅 DRAFT/CONFIRMED 且 released_quantity=0，记录 old/new/reason | `planning-domain-closure.test.js` · scheme lifecycle | COVERED | — |
| PL-38 | 计划副产品 | §30.2 | §25.10 | `replacePlannedOrderByproducts`（`planned_order_byproducts` 写入路径），`createPlannedOrder` 接受 `byproducts` | `planning-closure-remediation.test.js` · PL-38 | COVERED | 整改前为 `MISSING`：表存在但只有读、无写入路径 |
| PL-39 | Planned Order → Instruction | §30.2 / §30.3 | §25.10、§25.14 | `releasePlannedOrder` 在 transaction 内建 production/purchase instruction 并写 `planned_order_id`；OUTSOURCE 建 `planning_outsource_handoffs`；后续转换统一走 `manufacturing-orders.js::createProductionOrderCommand` | `planning-domain-closure.test.js` · scheme lifecycle；`out-final-acceptance.test.js` · I | COVERED | 无第二个 Production Order constructor |
| PL-40 | Planner Workbench | §30.2 / §30.3 | §25.12 | `GET /api/planning/workbench` → `planningWorkbench` → `buildPlanningBalanceReadModel` | `planning-domain-closure.test.js` · planned order release does not double-count planned supply；浏览器 `b3120-planning-final-acceptance.mjs` | COVERED | — |
| PL-41 | Cascade Adjustment | §30.2 / §30.3 | §25.13 | `previewCascade` / `applyCascade`；表 `planning_cascade_changes`；preview hash 绑定 + apply 重读 blocker | `m11-planning.test.js`；`planning-domain-closure.test.js` | COVERED | 只允许 DRAFT/CONFIRMED 且未释放的 Planning entity |
| PL-42 | 统一物料供需状态 | §30.2 / §30.3 | §25.12 | `buildPlanningBalanceReadModel`（`bucket` / `schemeId` 参数）+ `projectBucketedNetting`；`GET /api/planning/reports/supply-demand-status`（例外视图）与 `-summary`（数量视图） | `planning-closure-remediation.test.js` · PL-42（时间桶、首现例外桶、status 与 summary 是不同投影） | COVERED | 整改前为 `PARTIAL`：只有单窗口聚合，无时间桶；两个 report 返回同一结构 |
| PL-43 | 共享 Summary→Detail read model | §30.2 / §30.3 | §25.12 | 全部供需查询复用 `buildPlanningBalanceReadModel` 与同一 canonical service | 同上 | COVERED | — |
| PL-44 | Order 供需状态 | §30.2 | §25.12 | `GET /api/planning/reports/order-supply-demand` → `planningOrderSupplyDemandTrace`（需求来源 → 计划订单 → 指令 → 执行） | `planning-closure-remediation.test.js` · PL-44 | COVERED | 整改前为 `PARTIAL`：report 落到通用 balance read model，无追溯 |
| PL-45 | Reservation 综合 / 追溯查询 | §30.2 | §25.11、§25.12 | `GET /api/planning/reservations/:id` → `getPlanningReservation`（需求与供给上下文）+ `GET /api/planning/reports/reservation-trace` → `planningReservationTrace`（按供给来源反向聚合） | `planning-closure-remediation.test.js` · PL-45 | COVERED | 整改前为 `PARTIAL`：两个 report 返回同一列表，无明细端点与反向查询 |

## 4. 本轮修复的真实缺陷

| 编号 | 事实 | 影响 | 处置 |
|---|---|---|---|
| `PLAN-DEF-01` | `.planning-balance__actions` 没有 44px 触控目标规则（同文件 `.planning-toolbar__actions a` 有） | 计划员工作面每张卡片 2 个 22.5px 触控目标 | **已修复**：补 `.planning-balance__actions a{min-height:44px;…}` |
| `PLAN-DEF-02` | `b3120-planning-frontend.mjs` 在整改前**失败**；`log/2026-10-07.md:386` 的历史 PASS 产生于 `b455f2c`，相关界面是之后 `c3fa520` 引入的 | 历史浏览器验收记录已随实现变更失效 | **已修复**（随 `PLAN-DEF-01`）；历史 PASS 已在 §6 说明为过期 |
| `PLAN-DEF-03` | `b3120-planning-final-acceptance.mjs` 不等待数据加载，其工作台断言从未在卡片渲染状态下执行 —— 该 PASS 为**空洞证据** | 域级浏览器证据对该工作面不成立 | **已修复**：两条脚本都等待 `.planning-pulse`（READY 态）后再断言；**变异实验**证明守卫有效（移除 44px 规则后脚本按预期 FAIL，命中同样 10 个 22.5px 目标） |
| `PLAN-DEF-04` | Design §25.1 列出 `server/modules/planning-reservation.js` 为 guard 的 canonical owner，该文件**不存在** | Design 正文与实现不一致 | **已修复**：Design §25.1 按实现事实更正为 `planning-domain.js`，并登记新增的 `planning-time-phased.js` |
| `PLAN-DEF-05` | legacy `consumeForecastDemand`（MAX 语义）仍被 export，生产无调用方 | Requirement §30.4 的第二套算法仍留在 canonical 模块内 | **已修复**：删除 export；`v13-phase6e-commercial-golive.test.js` 改为断言 canonical 有界分配，并断言源码中不再出现该 helper |
| `PLAN-DEF-06` | **整改轮新发现**：BOM 展开按父级递归，共享组件的自身库存被**按父级各净额一次**，下一层需求被低估（22 − 8 = 14 被算成 6） | 下层物料被少计划 | **已修复**：展开改为按层级推进（`explodeBomLevels`），共享组件只净额一次；回归用例见 `planning-closure-remediation.test.js` · 共享组件 |
| `PLAN-DEF-07` | **整改轮新发现**：Forecast 消费后，被销售需求消费掉的那部分 Forecast 仍以全额写进需求台账与结果行（需求被重复计算一次） | 需求被重复计算；`gross_requirement` 与需求台账不自洽 | **已修复**：需求台账与结果行统一使用**有效（剩余）Forecast**；`m11-planning.test.js` · 45b 是新增的判别性用例（旧用例无法区分两套算法） |
| `PLAN-DEF-08` | **整改轮新发现（跨域）**：Sales 的预留意图适配器把 Planning 的内部错误码 `PLANNING_EXPECTED_FINITE_SOURCE_REQUIRED` 翻译成 Sales 的 `SALES_RESERVATION_EXPECTED_BOUNDED_EXTENSION_REQUIRED`，即 Sales 的已签发行为依赖 Planning 的内部错误分类 | Planning 合法变更内部错误码会击穿 Sales 已签发的 Wave 7 验收 | **已修复**：Sales 守卫改为自包含（在委派前自行拒绝 EXPECTED），**已签发的 Sales 行为与错误码逐字不变**；Sales Wave 7 两个套件 87/87 PASS |

## 5. 验收证据基线（整改后）

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3718/3718 PASS**，0 失败（整改轮新增 1 个套件、9 条用例） |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS（exit 0） |
| focused（`--filter plan`） | **170/170 PASS** |
| 新增合同套件 `server/planning-closure-remediation.test.js` | **9/9 PASS** |
| 浏览器（真实 Edge，`b3120-planning-frontend.mjs`） | **PASS**（4 档宽度）；**变异实验**：移除 44px 规则 → 按预期 FAIL |
| 浏览器（真实 Edge，`b3120-planning-final-acceptance.mjs`） | **PASS**（4 档宽度）；脚本已改为等待 READY 态后断言 |
| Sales Wave 7 跨域回归（`sales-customer-wave7-acceptance` + `-functional`） | **87/87 PASS** |
| 文档一致性 `current` | N1、N3～N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既有历史提交 `a40e356` / `59eccd5` / `171ade5` / `4403a80` 的追溯债务，与本域无关） |
| 文档一致性 `migration` | C1～C6 全 PASS |
| **真实 MySQL 8** | **行为等价不可满足**，见 §5.1 |

### 5.1 Requirement §30.6 与 Design §25.17 的 MySQL 证据现状

整改轮实测本仓库的 MySQL 门禁基础设施：

| 门禁 | 可运行？ | 覆盖 Planning？ |
|---|---|---|
| `pnpm test:mysql:m1-core`（`M1_CORE_G07_V1`） | ✅ 已批准 ACK-4 | ❌ `M1_CORE_PARITY_TABLES` 是 16 张采购 / 库存表，无 Planning 表 |
| `pnpm test:mysql:accounting-analytics`（`ACCOUNTING_ANALYTICS_MYSQL_V1`） | ✅ 已批准 ACK-4 | ⚠️ parity 为 47 张会计与分析表；但 `BOOTSTRAP_CURRENT_SCHEMA` 在**全量迁移集**上运行，Planning 迁移与表结构在真实 MySQL 8 上的可接受性由该 campaign 证明 |
| `pnpm test:mysql:out001` | ✅ 已批准 ACK-4 | ❌ 委外 WIP 专用 |
| `pnpm test:mysql`、`test:mysql:concurrency`、`test:mysql:legacy`、各 Sales Wave 门禁 | ❌ `blockUnmigratedAck4Entry` **永久阻断** | — |

结论：**Planning 域没有专属 ACK-4 campaign**。据此，Requirement §30.6 的数据库条款已按业务所有者 2026-11-12 的裁定「修订 Requirement 门禁指向」拆成两段并写明各自证明什么：

1. **schema / migration 对等** —— 由 `pnpm test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA` 覆盖；
2. **release / reservation 行为等价（不双发、不超分配）** —— 由本域 focused 套件（含并发与幂等反例）覆盖，**在真实 MySQL 上未被单独取证**，必须作为显式残余登记，不得表述为已证明。

Design §25.17 / §25.19 已同步按实现事实修正：MySQL **环境**并未缺失，缺失的是**本域专属** campaign，因此本域最终状态不是 `NOT READY — MYSQL VERIFICATION PENDING`，而是「真实 MySQL 环境与 schema 对等已取证、本域行为等价未单独取证」。

## 6. 与历史记录的关系

- `log/2026-10-08.md:283..289` 记录过 Planning Domain "Final Acceptance: PASS / Freeze: YES"，且记录了真实 MySQL parity / idempotency / concurrency 门禁 PASS。
- 仓库中**不存在** `docs/acceptance/planning-*.md`，也不存在 `PLANNING_*_DOMAIN_ACCEPTANCE_PASS` 机器可读 token；该历史结论只以日志形式存在。
- 2026-11-12 审计确认该历史结论**不足以支撑**域级 Acceptance：其浏览器证据已因 `c3fa520` 失效（`PLAN-DEF-02`），其 MySQL 证据在当前门禁基础设施下不可复现（§5.1），且逐项复核显示 7 `PARTIAL` + 4 `MISSING`。
- 整改轮已闭合上述能力与缺陷缺口；历史记录本身保留不改写，但**不作为**当前 Acceptance 的依据。

## 7. 未解决矛盾与待业务所有者裁定

| 编号 | 事项 | 需要裁定的问题 |
|---|---|---|
| `PLAN-DEC-01` | 7 `PARTIAL` + 4 `MISSING` | **已在整改轮闭合**：全部 45 项现为 `COVERED`，有实现与可执行证据 |
| `PLAN-DEC-02` | Requirement §30.6 / Design §25.17 的真实 MySQL 行为等价 | 裁定为「修订门禁指向」已落实（Requirement 与 Design 均已修正并写明证据边界）。**仍需业主选择**：是否接受「真实 MySQL 行为等价未单独取证」作为随冻结接受的显式残余，或另行授权新建 `PLANNING_MYSQL_V1` 域级 campaign（需业主逐次签发 ACK-4 capability） |
| `PLAN-DEC-03` | `PLAN-DEF-01` / `PLAN-DEF-02` 触控目标缺陷 | **已修复**并有变异实验证明守卫有效 |
| `PLAN-DEC-04` | `PLAN-DEF-03` 浏览器验收空洞 | **已修复**：两条脚本均等待 READY 态后断言；变异实验证明有效 |
| `PLAN-DEC-05` | `PLAN-DEF-04` Design §25.1 归属 | **已修复**：Design §25.1 按实现事实更正 |
| `PLAN-DEC-06` | `PLAN-DEF-05` legacy export | **已修复**：export 删除，legacy 测试改为断言 canonical 合同 |

## 8. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-11-12 上午 | 建立本审计基线：PL-01～PL-45 逐项复核（34 `COVERED` / 7 `PARTIAL` / 4 `MISSING`）；登记 5 项真实缺陷（`PLAN-DEF-01..05`）、需求 §30.6 数据库条款不可满足的事实、以及 6 项待业务所有者裁定。**未签发域级 Acceptance，未做任何实现修改。** |
| 2026-11-12 整改轮 | 业务所有者裁定「开一轮整改 / 修订 Requirement 门禁指向 / 全部修复」。整改轮实施后：45 项全部 `COVERED`；修复 `PLAN-DEF-01..05` 并新发现 `PLAN-DEF-06..08`；Requirement §30.6 与 Design §25.1 / §25.17 / §25.19 按裁定与实现事实修正；新增 `server/planning-time-phased.js`、`server/planning-closure-remediation.test.js`（9 条合同用例）与 4 个 additive schema 对象。**仍未签发域级 Acceptance。** |
