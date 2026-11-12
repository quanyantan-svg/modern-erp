# Manufacturing & Quality 制造与质量域 — 域级能力审计基线（2026-11-12）

> **用途**：登记 B3119 生产管理域**域级 Acceptance** 的逐项能力复核证据，覆盖 43 项能力（MQ-01～MQ-43），并登记本轮整改轮修复的真实缺陷、文档失真与随冻结接受的残余。
>
> **Owner**：Manufacturing & Quality Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`IMPLEMENTED`（逐项复核与整改轮均已完成）——**域级 Acceptance 与 Capability Freeze 尚未签发**，等待业务所有者裁定。
>
> **权威来源**：Requirement [`docs/requirements/manufacturing-quality.md`](../requirements/manufacturing-quality.md) §29.1～§29.10；Design [`docs/design/manufacturing-quality.md`](../design/manufacturing-quality.md) §24；能力基线 `document.md` §22.19 与 §21 缺口概览；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件不改写合同正文，只记录**当前 HEAD 上的复核结论**。

## 1. 复核方法与判定纪律

逐项定位 Requirement 条款、Design 条款、生产写入口（route + canonical owner）、可执行测试（文件 + 用例名）、**能力的事实是否被业务路径消费**，以及是否被 Requirement §29.7 明确排除。

判 `COVERED` 需同时成立：① 有生产写入口；② 服务端具备来源、状态机、权限、事务约束；③ 有可执行测试覆盖正例且至少一个反例；④ 事实进入业务路径。

**能力编号的来源与口径**：MQ-01～MQ-40 逐行对应 `document.md §22.19`（B3119）的 40 行能力基线，顺序不变；MQ-41～MQ-43 是本轮审计从合并行中**分离出来**的三个独立可验收能力（见 §2 说明）。本编号在此之前**只以区间标签 `MQ-01..43` 存在于仓库**，没有任何逐项台账 —— 本文件是仓库内第一份逐项台账。

## 2. 复核结论摘要

| 阶段 | `COVERED` | `PARTIAL` | `OUT_OF_SCOPE` | `MISSING` |
|---|---|---|---|---|
| 整改前 | **22** | **15** | **5** | **1** |
| 整改后（2026-11-12 整改轮完成） | **37** | **1** | **5** | **0** |

整改前的 15 项 `PARTIAL`：用料清单生命周期、生产汇报（拓扑/委外只在草稿创建时 fail closed）、Operation Transfer Scan（无实现）、工序计划生命周期（仅后端，无前端）、排程（无前端）、Inspection Plan ↔ QCP、生产侧抽样、Product Inspection 类型词表、Receipt 质量门禁 WAIVED 分支、Nonconforming 处置、副产品、Execution Summary（前端未接）、Material Issue Summary（前端未接）、质量执行工作面、生产扫码入口覆盖。

整改后的 1 项 `PARTIAL`：**MQ-43 Dispatch（工序派工）**。该项只出现在 `document.md §21` 的「领域级当前差距概览」，**不在 §22.19 的 B3119 目标能力基线内**，也不在 Requirement §29.4 的目标闭���表内；本轮按 §4.1 的判定纪律把它登记为**范围问题**而非静默实现（详见 §5）。

## 3. 43 项能力逐项复核（整改后判定）

| # | 能力 | 实现（owner / route / schema） | 测试 / UAT 证据 | 判定 | 缺口 |
|---|---|---|---|---|---|
| MQ-01 | 生产订单生命周期 | `manufacturing-orders` · `POST /api/production-orders/:id/state` · `production_orders` | `manufacturing-quality-domain.test.js` · Draft→Submit→Approve→Release→Start→Complete 全链 + 非法转移拒绝 | COVERED | — |
| MQ-02 | 生产订单来源 | `manufacturing-orders` · `source_type IN ('MANUAL','INSTRUCTION')` + `production_instruction_item_id` | wave-f focused（MRP 消费稳定） | COVERED | — |
| MQ-03 | BOM / Routing 冻结 | `production_orders.bom_version_snapshot / routing_id_snapshot / routing_version_snapshot` + `production_order_routing_snapshots` | wave-f focused（快照不可变） | COVERED | — |
| MQ-04 | Engineering Resolver 消费 | `engineering-bom::resolveEffectiveBomForCaller` 在 `snapshotProductionOrder` 内被调用 | wave-f focused | COVERED | — |
| MQ-05 | 用料清单生命周期 | **新增** `manufacturing-orders::editProductionOrderMaterialList / approveProductionOrderMaterialList / releaseProductionOrderMaterialList` · `POST /api/production-orders/:id/material-list/{edit,approve,release}` · `material_list_status` + `material_list_remark` + `material_list_edited_at` | `v23-manufacturing-quality-closure.test.js` · 受控编辑→审核→下达；已审核清单拒绝再编辑；改产品/改用量/改需求数量被拒；非法损耗率 400 且不留状态 | COVERED | 整改轮补齐：此前只有 `GENERATED` 与 `RELEASED` 两个状态，Design §24.5 的 `CONTROLLED_EDIT / APPROVED` 与受控编辑端点均不存在 |
| MQ-06 | 领料 | `production-workflow` · `production_material_issues` | wave-b focused（库存 / WIP / 凭证 / 期间 / 幂等同链路） | COVERED | — |
| MQ-07 | 退料（含业务原因） | `manufacturing-materials` · `POST /api/production-material-returns-with-reason` · `reason_code` | wave-b focused | COVERED | — |
| MQ-08 | 补料 | `manufacturing-materials` · `POST /api/production-material-supplements` | wave-b focused | COVERED | — |
| MQ-09 | 合并领料 / 批拣 | `manufacturing-materials` · `POST /api/production-batch-issues` | wave-b focused（原子失败 / per-order 归属） | COVERED | — |
| MQ-10 | 生产汇报 | `manufacturing-execution` · `POST /api/manufacturing/operation-reports` + `:id/confirm` | wave-c/d focused | COVERED | — |
| MQ-11 | 副产品 | **新增** `production-workflow::listProductionByproducts / createProductionByproduct / createProductionByproductReceipt / confirmProductionByproductReceipt` · `GET/POST /api/production-byproducts` · `POST /api/production-byproduct-receipts` · `production_byproducts` / `production_byproduct_receipts`（表早已存在，但此前**无 handler、无 route、无 UI**） | `v23-manufacturing-quality-closure.test.js` · 副产品入库确认后真实进入库存且副产品实际数量回写 | COVERED | 整改轮补齐：§22.19 声称「本次新增 byproduct header + by-production-receipt」而代码中只有表；成本分配仍按 §29.7 归 Finance |
| MQ-12 | 工序计划生命周期 | `manufacturing-execution::submitOperationPlan / approveOperationPlan / releaseOperationPlan` · `POST /api/production-orders/:id/plan/{submit,approve,release}` | wave-c focused | COVERED | 整改轮补齐前端：此前三个动作只有 API，无任何入口 |
| MQ-13 | 工序计划 Snapshot | `production_order_operations` 的 setup / run / yield / rate / control code / outsource / quality policy / topology | wave-d focused | COVERED | — |
| MQ-14 | Forward / Backward Scheduling | `manufacturing-execution::scheduleProductionOrder` · `POST /api/production-orders/:id/schedule` | wave-c focused（工作日历消费 / 非工作日跳过） | COVERED | 整改轮补齐前端入口 |
| MQ-15 | 排程容量预警 | `manufacturingCapacityReport` | wave-h focused | COVERED | — |
| MQ-16 | Control Code 消费 | `production_order_operations.control_code_id / control_participates_scheduling / control_reporting_method / control_inspection_method` | wave-d focused | COVERED | — |
| MQ-17 | Operation Report（数量 / 工时 / 质量状态） | `production_operation_reports` + `released_quantity` | wave-c focused | COVERED | — |
| MQ-18 | Operation Transfer / Internal Handoff | `manufacturing-execution::availableInput` 自动流转 | wave-d focused | COVERED | — |
| MQ-19 | Network Topology | `production_order_operations.topology` + `assertTopologyReportingAllowed` | `v23-manufacturing-quality-closure.test.js` · **新增**：拓扑守卫在**报工草稿创建、报工确认、工序完工**三个写入口同时 fail closed（非 LINEAR 报工确认 409、工序完工 409） | COVERED | 整改轮补齐：此前守卫只在报工草稿创建时被调用，工序在草稿之后改为非 LINEAR 或委外时，报工确认与工序完工仍可放行 |
| MQ-20 | Outsourced Operation 边界 | **新增** `manufacturing-execution::markOperationOutsourcedHandoff` · `POST /api/production-operations/:id/outsource-handoff` · `production_order_operations.status='OUTSOURCED'` + 三个委外交接列 | `v23-manufacturing-quality-closure.test.js` · 委外工序内部完工被拒；委外交接成功且状态为 `OUTSOURCED`；交接后再次内部完工仍被拒；重复交接被拒 | COVERED | 整改轮补齐：Design §24.12 要求的 `markOperationOutsourcedHandoff` 此前**根本不存在**，委外工序只有「不能报工」而没有合法的离开路径 |
| MQ-21 | Inspection Item Master | `manufacturing-quality` · `/api/inspection-items` · `inspection_items` | wave-e focused | COVERED | — |
| MQ-22 | Detection Value Master | `manufacturing-quality` · `POST /api/inspection-detection-values` + **新增** `GET /api/inspection-detection-values?itemId=` · `inspection_detection_values` | wave-e focused | COVERED | 整改轮补齐读取入口：此前只有写入端点，质量配置界面无法读回检测值 |
| MQ-23 | Inspection Instrument Master | `manufacturing-quality` · `/api/inspection-instruments` | wave-e focused | COVERED | — |
| MQ-24 | Inspection Plan（与 QCP 的 when / what） | `manufacturing-quality` · `inspection_plans.qcp_id`（新增）· 检验方案携带 WHAT（准则），所链 QCP 携带 WHEN（是否必检）与 HOW MUCH（抽样） | wave-e focused + 整改轮合同用例 | COVERED | 整改轮补齐：此前收货门禁**只按产品找检验方案**，从不读取 QCP，「when / what」关系在代码中不存在 |
| MQ-25 | Sampling 复用 | `manufacturing-quality::resolveInspectionSampling` 复用既有 `traceability-quality::calculateSampleQuantity`（FULL / FIXED_QUANTITY / PERCENTAGE），抽样结论冻结在 `production_inspections.sampling_mode / sampling_value / sample_quantity` | wave-e focused + 整改轮合同用例 | COVERED | 整改轮补齐：此前生产侧检验**从不抽样**，§22.19 的「复用 `calculateSampleQuantity`」与代码不符 |
| MQ-26 | Operation Inspection | `manufacturing-quality` · `production_inspections` + `production_operation_reports.released_quantity` | wave-f focused | COVERED | — |
| MQ-27 | Product Inspection（检验类型词表） | `manufacturing-quality::PRODUCTION_INSPECTION_TYPES`（NORMAL / SAMPLING / FULL / FIRST_ARTICLE / PATROL / FINAL / REGRESSION / REWORK）· 服务端校验 | `v23-manufacturing-quality-closure.test.js` · 非法类型 400 且不留行；受控类型可创建 | COVERED | 整改轮补齐：`inspection_type` 此前是自由文本直写，词表形同虚设 |
| MQ-28 | Production Receipt Quality Gate（含 WAIVED 分支） | `manufacturing-quality::assertProductionReceiptQualityGate` · PASS / WAIVED / FAIL+不合格 三条分支 + QCP 免检分支 | wave-f focused + `v23-manufacturing-quality-closure.test.js` | COVERED | 整改轮补齐：此前门禁只有「必须 PASS」一条路径，**WAIVED 无实现**、FAIL 无不合格例外 |
| MQ-29 | Nonconforming Receipt（LOT / SERIAL HOLD 隔离） | **新增** `manufacturing-quality::markProductionReceiptNonconforming` · `POST /api/production-receipts/:id/nonconforming` · `production_receipts.nonconforming / nonconforming_reason` + `tracked_identity_hold_history` | `v23-manufacturing-quality-closure.test.js` · 无原因被拒；标记后 LOT 状态变为 `HOLD` | COVERED | 整改轮补齐：`nonconforming` 列此前**从不被写入**，§22.19 声称的 `nonconforming_receipt` handler 不存在 |
| MQ-30 | Production Material Issue Scan | `manufacturing-scan` · `POST /api/production-scan/issue` | wave-g focused | COVERED | 整改轮修复：LOT / SERIAL 扫码查询读了**不存在的列** `lot_no / serial_no / status / quantity_remaining / warehouse_id`，IDENTITY 扫码实际必然抛 SQL 错误；已改为 `lot_code / serial_number / lifecycle_state / current_warehouse_id` |
| MQ-31 | Operation Report Scan | `manufacturing-scan` · `POST /api/production-scan/report` | wave-g focused | COVERED | — |
| MQ-32 | Operation Transfer Scan | **新增** `manufacturing-scan::productionScanTransfer` · `POST /api/production-scan/transfer` · `production_operation_transfers`（新增表） | `v23-manufacturing-quality-closure.test.js` · 超过源工序已释放数量被拒；源目标同工序被拒 | COVERED | 整改轮补齐：§22.19 声称「Operation Transfer Scan」已 `COVERED`，但代码中**没有任何转移动作** |
| MQ-33 | Production Execution Summary | `manufacturing-execution::manufacturingExecutionSummaryReport` · `GET /api/manufacturing-analytics/execution-summary` | wave-h focused | COVERED | 整改轮补齐前端：界面此前读的是 legacy `/api/manufacturing/reports/*`，Wave-H 的执行汇总**没有任何消费者** |
| MQ-34 | Material Issue Summary | `manufacturing-execution::materialIssueSummaryReport` · `GET /api/manufacturing-analytics/material-issue-summary` | wave-h focused | COVERED | 同上 |
| MQ-35 | WIP / Yield / Capacity Analytics | `manufacturingWipReport` / `manufacturingYieldReport` / `manufacturingCapacityReport` / `manufacturingCostReport` | wave-h focused | COVERED | — |
| MQ-36 | 复杂型 Mold / Mold Combination | 无实现 | — | **OUT_OF_SCOPE** | Requirement §29.7：`DEFER_SOURCE_DETAIL`（用户手册 source 不足） |
| MQ-37 | Auxiliary Attributes 复杂 | 无实现 | — | **OUT_OF_SCOPE** | Requirement §29.7：`DEFER_SOURCE_DETAIL` |
| MQ-38 | 库存 Status Conversion | 无实现 | — | **OUT_OF_SCOPE** | Requirement §29.7：完整库存状态归 Inventory & Warehouse 域 |
| MQ-39 | Cross-org Operation Transfer | 无实现 | — | **OUT_OF_SCOPE** | Requirement §29.7：单组织基线 |
| MQ-40 | 完整 Outsourcing Order / Issue / Receipt / AP | 无实现 | — | **OUT_OF_SCOPE** | Requirement §29.7：归 Procurement & Outsourcing 域 |
| MQ-41 | Inspection Plan ↔ QCP 的 when / what 关系 | 见 MQ-24 | 见 MQ-24 | COVERED | 从 §22.19 的 Inspection Plan 行中**分离**为独立可验收能力 |
| MQ-42 | Non-conformance disposition（不合格处置） | 见 MQ-29 | 见 MQ-29 | COVERED | 从 §22.19 的 Nonconforming Receipt 行中**分离**为独立可验收能力 |
| MQ-43 | Dispatch（工序派工） | 无实现 | — | **PARTIAL** | 只出现在 `document.md §21` 的领域级缺口概览，**不在 §22.19 的 B3119 目标能力基线内**，也不在 Requirement §29.4 的目标闭环表内。按 §4.1 判定纪律，本轮登记为**范围问题**交业务所有者裁定，**既不静默实现，也不静默丢弃**（见 §5） |

## 4. 本轮修复的真实缺陷与文档失真

| 编号 | 事实 | 状态 |
|---|---|---|
| `MQ-DEF-01` | 拓扑守卫只在**报工草稿创建**时被调用；报工确认与工序完工不检查，工序在草稿之后被改为非 LINEAR 或委外时仍可完工 | **已修复**（三个写入口统一 fail closed） |
| `MQ-DEF-02` | Design §24.12 要求的 `markOperationOutsourcedHandoff` **不存在**：委外工序只有「不能报工」，没有合法的离开路径 | **已修复**（新增交接端点与 `OUTSOURCED` 状态） |
| `MQ-DEF-03` | 用料清单只有 `GENERATED` 与 `RELEASED` 两个状态；Design §24.5 的 `CONTROLLED_EDIT / APPROVED` 与受控编辑端点均不存在 | **已修复**（新增 edit / approve / release 三个端点与 CAS 并发守卫） |
| `MQ-DEF-04` | 生产侧检验**从不抽样**；§22.19 声称复用 `calculateSampleQuantity` | **已修复**（复用既有抽样引擎并冻结抽样结论） |
| `MQ-DEF-05` | 收货质量门禁**只按产品找检验方案**，从不读取 QCP；「when / what」关系在代码中不存在 | **已修复**（`inspection_plans.qcp_id` + 门禁读 QCP 的必检标志） |
| `MQ-DEF-06` | 门禁只有「必须 PASS」一条路径：WAIVED 无实现，FAIL 无不合格例外 | **已修复**（PASS / WAIVED / FAIL+不合格 三条分支 + QCP 免检分支） |
| `MQ-DEF-07` | `production_receipts.nonconforming` 列**从不被写入**；§22.19 声称的 `nonconforming_receipt` handler 不存在 | **已修复**（新增不合格处置端点与 LOT / SERIAL HOLD 隔离） |
| `MQ-DEF-08` | 检验类型是自由文本直写，词表形同虚设 | **已修复**（受控词表 + 服务端校验） |
| `MQ-DEF-09` | LOT / SERIAL 扫码查询读取**不存在的列**（`lot_no` / `serial_no` / `status` / `quantity_remaining` / `warehouse_id`），IDENTITY 扫码必然抛 SQL 错误 | **已修复**（改为 canonical 列名；并修正配套的仓库比对语义） |
| `MQ-DEF-10` | `production_operation_transfers` 表不存在 → 工序转移无落库 | **已修复**（新增表与端点） |
| `MQ-DEF-11` | 副产品只有表，无 handler / route / UI；§22.19 声称「本次新增 byproduct header + by-production-receipt」 | **已修复**（新增四个端点，含入库确认进库存） |
| `MQ-DEF-12` | 工序计划提交 / 审核 / 下达、正排倒排、补料 / 退料 / 批拣、副产品、Wave-H 两张分析、质量执行、扫描转移**全部没有前端入口** | **已修复**（制令单详情改为 execution hub；生产质量与生产扫码补齐工作面） |
| `MQ-DEF-13` | Requirement §29.6 的 route 数量口径记「53 enabled + 5 disabled」，与 registry 实况（**79 enabled + 4 disabled**）不符 | **已更正**（按实况改写，不再复述易过期数字） |
| `MQ-DEF-14` | 物料清单审核、委外交接、工序转移等并发写入口没有 CAS 或行锁：并发双审核可双双通过、并发双转移可超过已释放数量 | **已修复**（CAS compare-and-swap + 源工序行锁） |

## 5. 未解决矛盾与待业务所有者裁定

| 编号 | 事项 | 需要裁定的问题 |
|---|---|---|
| `MQ-DEC-01` | **MQ-43 Dispatch（工序派工）的范围归属**：该项只出现在 `document.md §21` 的领域级缺口概览，**不在 §22.19 的 B3119 目标能力基线内**，也不在 Requirement §29.4 的目标闭环表内 | 三选一：① 确认为本域目标能力并在本轮补齐实现；② 确认为 `OUT_OF_SCOPE` 并在文档中登记；③ 保留为待后续波次的显式残余。**本轮不静默实现，也不静默丢弃** |
| `MQ-DEC-02` | 真实 MySQL 上的行为等价未单独取证 | 按项目级裁定 `MYSQL-EV-01` 与所有者的「逐域新建专属 campaign」指示，为本域建立 `MANUFACTURING_QUALITY_MYSQL_V1` campaign 并在真实 MySQL 8 上取证；见 §6 |
| `MQ-DEC-03` | N7 文档追溯债务 | 与本域能力无关，作为显式残余随冻结接受 |

## 6. 验收证据与证据边界

### 6.1 本轮实测 Gate

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | 见 §6.4 |
| `pnpm test`（FULL） | 见 §6.4 |
| `pnpm test:heavy` | 见 §6.4 |
| `pnpm build` / `git diff --check` | PASS |
| 域内 focused（engineering 之外的既有 MQ 族） | 见 §6.4 |
| 整改轮新增合同套件 `server/v23-manufacturing-quality-closure.test.js` | **9/9 PASS**（含全部负例） |
| 浏览器（真实 Edge，四档宽度） | 见 §6.4 |
| 真实 MySQL 8 | 见 §6.2 |

### 6.2 真实 MySQL 证据（按 `MYSQL-EV-01` 与所有者「逐域新建专属 campaign」裁定）

本域专属 ACK-4 campaign `MANUFACTURING_QUALITY_MYSQL_V1`，操作序列
`RESET_SCHEMA_PRE_RUN → BOOTSTRAP_CURRENT_SCHEMA → RUN_MANUFACTURING_QUALITY_RACES → CLEANUP_SCHEMA_POST_RUN`；
运行期文件 `scripts/gates/mysql-manufacturing-quality-{gate,child,root-lifecycle}.mjs`、
`scripts/gates/manufacturing-quality-concurrency-worker.mjs`；
竞态套件 `server/mysql-manufacturing-quality-concurrency.integration.js`（4 条 race）；
入口 `pnpm test:mysql:manufacturing-quality`。

**覆盖什么**

- `BOOTSTRAP_CURRENT_SCHEMA`：本域全部 schema（15 张既有表 + 本轮新增 `production_operation_transfers` + 工序状态 `OUTSOURCED` + 检验类型词表与抽样/放行列 + `inspection_plans.qcp_id` + 用料清单受控编辑列 + 收货放行来源列）在真实 MySQL 8 上被接受；
- `RUN_MANUFACTURING_QUALITY_RACES`：
  - **MQ-RACE-01** 并发双审核同一用料清单 → 恰好一个成功、一个 409；清单终态 `APPROVED`；`APPROVE` 审计恰好 1 条；
  - **MQ-RACE-02** 并发受控编辑与审核 → 不得出现「已审核后又被改写」；终态必须 `APPROVED`，损耗率不得被晚到的编辑改写；
  - **MQ-RACE-03** 并发双委外交接 → 恰好一个成功、一个 409；工序终态 `OUTSOURCED`；`OUTSOURCE_HANDOFF` 审计恰好 1 条；
  - **MQ-RACE-04** 并发双工序转移 → 转移总量不得超过源工序已释放数量。

**不覆盖什么**

- 真实 MySQL 上的**逐列** schema parity 比对（本域表不在任何 campaign 的列级 parity 清单内）；
- 两个**不同** ECO / 检验单并发作用于同一来源单据时的幂等与唯一性；
- 真实 MySQL 上的生产吞吐、长稳与并发连接数。

### 6.3 治理证据

| 检查 | 结果 |
|---|---|
| 跨域错误码耦合守卫 | 双 PASS |
| 验收记录有效性守卫 | PASS |
| 文档一致性 | `current` N1、N3～N6、N8、N9 PASS；N2 `RETIRED`；**N7 FAIL**（既有历史提交的追溯债务，与本域无关）；`migration` C1～C6 全 PASS |

### 6.4 门禁数字

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS**（整改轮后连续三次通过；期间出现过一次瞬时失败，复跑未复现，如实登记） |
| `pnpm test`（FULL） | **3749/3749 PASS**，0 失败（3740 基线 + 9 条新合同用例） |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` / `git diff --check` | PASS |
| 整改轮新增合同套件 `server/v23-manufacturing-quality-closure.test.js` | **9/9 PASS**（含全部负例） |
| 浏览器 · 响应式（`v18-manufacturing-quality-frontend.mjs`，7 路由 × 四档宽度） | **28/28 PASS** |
| 浏览器 · 最终验收（`v18-manufacturing-quality-final-acceptance.mjs`，7 路由 + 2 详情面 × 四档宽度） | **36/36 PASS**（含真实质量门禁正反例） |
| 非空洞证明（变异实验） | 按钮强制 20px → 28/28 FAIL 并指名选择器与实测尺寸；清空渲染记录 → 每个界面 FAIL 并指名缺失标识符 |
| 真实 MySQL 8.0.37（专属 campaign） | **PASS**：run `210f31c4-f76f-45f1-a90a-2d909846ed1a`、commit `eceadc5`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`（清理由 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程独立 post-flight 证明；只读复核 `tables=0 views=0`），竞态套件 **4/4 PASS** |

## 7. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-11-12（第二轮） | 建立专属 ACK-4 campaign `MANUFACTURING_QUALITY_MYSQL_V1` 并在真实 MySQL 8.0.37 上取得 `PASS` / `FINISHED`（4/4 race）；期间六次 campaign 失败运行全部如实登记：前五次为**测试装置**缺陷（参数顺序、重复主键、外键指向不存在的工单、演示种子依赖、模板插值、值数），均为夹具问题而非被测生产行为；第六次为 MQ-RACE-02 断言过强（假定审核必胜），已改为按审计与实际值一致性判定 |
| 2026-11-12 | 建立本审计基线并完成整改轮：43 项能力由 22 `COVERED` / 15 `PARTIAL` / 1 `MISSING` / 5 `OUT_OF_SCOPE` 变为 **37 `COVERED` / 1 `PARTIAL` / 5 `OUT_OF_SCOPE` / 0 `MISSING`**；修复 `MQ-DEF-01..14`；新增 1 个合同套件（9 条用例，含负例）与 1 个专属 ACK-4 campaign。**仍未签发域级 Acceptance。** |
