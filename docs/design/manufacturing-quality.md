# Manufacturing & Quality — Technical Design

> 状态：`ACTIVE`
> Owner：Manufacturing & Quality
> 权威来源：`solution.md` §24
> 来源：`solution.md` §24（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## 24. Manufacturing & Quality Domain Technical Design

> 本节固化 Manufacturing & Quality Domain Closure 的 Design 阶段成果。Requirement 见 `document.md §29`。Manual Evidence Baseline 来自 Prompt §0–§43；本节按 8 个 Implementation Wave (A–H) 展开。
> 不在本 Domain 范围 / 跨域 deferred 一律按 `document.md §29.1` 与 §29.7 处理。

### 24.1 Module Ownership

新增 / 既有 `server/modules/` owner modules：

- **`manufacturing-orders.js`**（NEW，Wave A） — `production_orders` canonical owner；Draft / Submit / Approve / Reject / Release / Start / Complete / Cancel / Source / Lifecycle；保留原 handler 在 `server/app.js` 直至 caller proof 完成逐步迁移。
- **`manufacturing-materials.js`**（NEW，Wave B） — Material Issue / Supplement / Return / Batch Picking canonical owner；保留原 handler 在 `production-workflow.js` 直至 caller proof 完成。
- **`manufacturing-quality.js`**（NEW，Wave E） — Inspection Item / Detection Value / Instrument / Inspection Plan；与现有 IQC/OQC engine 通过 `qualityConfig` + `freezeQualityPolicy` 形成 `when` 关系。
- **`manufacturing-execution.js`**（ENHANCE，Wave C / D） — Operation Plan lifecycle / Forward-Backward Scheduling / Topology / Control Code Snapshot / Internal Handoff；保持现有 quantity / WIP / value / reversal contract。
- **`manufacturing-scan.js`**（NEW，Wave G） — Production Scan 工作面：material / operation lookup + shortcut；不实现完整 B3105。
- **`manufacturing-analytics.js`**（NEW / ENHANCE，Wave H） — Execution Summary / Material Issue Summary；保留既有 WIP / Yield / Capacity / Cost。

保留既有：

- `production-workflow.js`：issue / return / receipt / receipt-reversal handler 保持原状；
- `manufacturing-execution.js`：operation report / reversal / WIP / cost 已有；
- `authoritative-quality.js` / `quality-gates.js` / `traceability-quality.js`：IQC / OQC / QCP / sampling 不破坏；
- `engineering-bom.js` / `engineering-routing-enrichment.js`：canonical BOM/Routing source；本 Domain 是 consumer。

### 24.2 Production Order State Machine

`production_orders.status` 增加 additive enum（不破坏既有数据）：

```text
DRAFT        — created editable, no source executed
PENDING      — submitted, awaiting approval (legacy semantic; == SUBMITTED in B3119 sense)
SUBMITTED    — submitted; awaiting approval
APPROVED     — approved; awaiting release
RELEASED     — released; ready to start
IN_PROGRESS  — started; active execution
COMPLETED    — completed
CANCELLED    — cancelled
REJECTED    — approval rejected (kept distinct from CANCELLED for audit semantics)
```

CHECK 约束扩展：`CHECK(status IN ('DRAFT','PENDING','SUBMITTED','APPROVED','RELEASED','IN_PROGRESS','COMPLETED','CANCELLED','REJECTED'))`。

Transition：

```text
DRAFT      -> SUBMITTED  (allow: PRODUCTION_ORDERS_CREATE)
DRAFT      -> CANCELLED  (allow: PRODUCTION_ORDERS_CREATE)
PENDING    -> SUBMITTED  (legacy path; treated as alias)
SUBMITTED  -> APPROVED   (allow: PRODUCTION_ORDERS_APPROVE; idempotency key; Approval family PRODUCTION_ORDER)
SUBMITTED  -> REJECTED   (allow: PRODUCTION_ORDERS_APPROVE)
APPROVED   -> RELEASED   (allow: PRODUCTION_ORDERS_RELEASE)
APPROVED   -> CANCELLED  (allow: PRODUCTION_ORDERS_APPROVE or CREATE)
RELEASED   -> IN_PROGRESS (allow: PRODUCTION_ORDERS_START; canonical Engineering snapshot taken)
RELEASED   -> CANCELLED  (allow: PRODUCTION_ORDERS_CREATE/START)
IN_PROGRESS -> COMPLETED (allow: PRODUCTION_ORDERS_COMPLETE)
IN_PROGRESS -> CANCELLED (allow: PRODUCTION_ORDERS_CREATE/START; only if zero net issued + zero confirmed report)
```

每个转移：

- 在 transaction 内重新读取权威状态 + 累计执行量；
- 状态检查 + 权限 + 业务不变量；
- audit 写 audit_logs；
- 释放时由 `snapshotProductionOrder` 写 BOM / Routing snapshot；后续 master edit 不得反向污染。

### 24.3 Approval / Release

`PRODUCTION_ORDER` 新 Approval family 在 `server/modules/approvals.js` 注册，沿用现有 Platform Approval 基础设施（applies to: `production_orders`）：

- Submit：创建一条 approval request (status='PENDING')；
- Approve：applies to state `SUBMITTED -> APPROVED`；reject `SUBMITTED -> REJECTED`；
- Release：独立 `RELEASED` 状态机（不同于 Approval），由 `PRODUCTION_ORDERS_RELEASE` 控制；
- 不实现 Generic Workflow / B3122。

`server/db.js` 增加：

```text
INSERT OR IGNORE INTO approval_families(code, label) VALUES ('PRODUCTION_ORDER','生产订单审批');
```

旧 `PENDING` 视为 `SUBMITTED` alias；新写入仍可用旧字符串兼容。

### 24.4 Engineering Resolver Integration

在 production order 创建 / start 路径，由 canonical Engineering resolver 提供 BOM：

- `engineering-bom.resolveEffectiveBomForCaller({ caller: 'PRODUCTION_ORDER_CREATE', productId, purpose: 'SELF_MAKE', atDate })`；
- 若 `bomId` 在 body 给出且通过 resolver 校验，则接受；否则由 resolver 自动选择；
- resolver 校验：purpose + effective_from/effective_to + approval_status = 'APPROVED'；
- 与生产手工 / Instruction 释放路径完全一致。

旧 `boms.status='ACTIVE' ORDER BY ... LIMIT 1` 在生产路径全部替换；Engineering Resolver 是 BOM 选择的唯一 authority。

### 24.5 Material List

`production_order_items` 仍是 canonical frozen BOM line；本次 additive：

- `material_list_status TEXT NOT NULL DEFAULT 'GENERATED'` （`GENERATED / UNDER_REVIEW | CONTROLLED_EDIT / APPROVED / RELEASED`）；
- `material_list_approved_by / approved_at`；
- `material_list_released_by / released_at`；
- 不破坏既有 quantity / quantity_per_unit / scrap_rate_snapshot / bom_item_id。

Material List lifecycle：

- 订单 APPROVED 后 Material List 自动 `GENERATED`（受控编辑 = `CONTROLLED_EDIT`）；
- RELEASED 之前允许 controlled edit（不允许修改 product_id / quantity_per_unit，只允许调整 scrap / remark / additional comment）；
- RELEASED 之后只允许 Supplement 追加。

### 24.6 Issue / Supplement / Return / Batch Picking

- **Issue**：复用 `production-workflow.js::createProductionMaterialIssue` 等。不重写。
- **Supplement**：新建 `server/modules/manufacturing-materials.js::createProductionMaterialSupplement / confirmProductionMaterialSupplement`：
  - 来源：`Production Order` / `Production Material Return`；
  - 必须 explicit 业务原因（`reason_code IN ('SHORTAGE', 'YIELD_LOSS', 'QUALITY_REPLACEMENT', 'OTHER')`）；
  - 走同一 `production_material_issue_items` 模式写入 `production_material_supplements` + `production_material_supplement_items`；
  - Confirm：复用 `adjustInventory` / `postLedger` / `issueSourceValue` / `postWipMovement` / `createSystemVoucher` / `audit` / `assertFinancialPeriodsOpen` / `idempotencyReplay`；
  - `production_material_supplements` 表（FROZEN_RECEIPT ↔ supplement_for_id 关联可选）。
- **Return Reason**：`production_material_returns` 增加 `reason_code`（`MATERIAL_DEFECT / GOOD_RETURN / PROCESS_DEFECT / OTHER`）；与 Inventory 同 taxonomy。
- **Batch Picking**：新建 `production_batch_issues` 头 + `production_batch_issue_orders` 关联 + `production_batch_issue_items` per-order 分配；Confirm 在 transaction 内 for-loop per order；partial failure 全 rollback；保留 per-order source line / WIP / value 归属。

### 24.7 Operation Plan Lifecycle

`production_order_operations` 升级为 Operation Plan execution row；status enum additive：

```text
NOT_STARTED   — generated; not submitted
SUBMITTED     — submitted for approval
APPROVED      — approved
RELEASED      — released for execution (canonical "executable")
IN_PROGRESS   — execution started
COMPLETED     — execution completed
SKIPPED      — skipped by topology rules
```

Operation Plan lifecycle 落地：

- `NOT_STARTED` 自动生成于 `RELEASED` 后（`snapshotManufacturingExecution` 中 `ensureOperationPlanSnapshot`）；
- `SUBMITTED` 由 `submitProductionOperationPlan(orderId)` 进入；
- `APPROVED` 由 `approveProductionOperationPlan(orderId)` 进入（Audit + idempotency）；
- `RELEASED` 由 `releaseProductionOperationPlan(orderId)` 进入；进入 IN_PROGRESS 前必须 RELEASED。

不创建第二套 operation rows。

### 24.8 Forward / Backward Scheduling

新建 `manufacturing-execution.js::scheduleProductionOrder(orderId, mode)`：

- mode ∈ { `FORWARD`, `BACKWARD` }；
- FORWARD：起点 = `planned_start`；依次遍历 operations；每 op 算 `setup_seconds + run_seconds_per_unit * planned_input_quantity`；按 Work Calendar / Shift 跳过非工作时间；写入 `planned_date`；
- BACKWARD：终点 = `planned_finish`；反向遍历；同上去掉非工作时间；
- Calendar 消费：`engineering_work_calendars` + `engineering_shifts` 跳过非工作时段；
- Capacity 警告：`manufacturingCapacityReport` 补 `scheduled_minutes` vs `daily_capacity_minutes`。

不实现完整 APS；只 deterministic 排程。

### 24.9 Calendar / Capacity Consumption

- `engineering_work_calendars.work_date IN ('MON',...,'SUN')`；
- `engineering_shifts.start_time / end_time`；
- `work_centers.daily_capacity_minutes`；
- Capacity overload warning：`manufacturingCapacityReport` 返回 `overloaded = true`。

### 24.10 Control Code Snapshot

`production_order_operations` snapshot fields additive：

- `control_code_id TEXT`（来自 `product_routing_operations.control_code_id`，但由 `engineering_routing_enrichment` 提供）；
- `control_participates_scheduling INTEGER NOT NULL DEFAULT 1`；
- `control_reporting_method TEXT`（`AUTO / MANUAL / BOTH`）；
- `control_inspection_method TEXT`（`NONE / AUTO / ON_REPORT`）；
- `is_outsource INTEGER NOT NULL DEFAULT 0`；
- `quality_policy TEXT`（`NONE / AUTO / ON_REPORT`）；
- `topology TEXT NOT NULL DEFAULT 'LINEAR'`（`LINEAR / NETWORK / PARALLEL / SPLIT / MERGE / ALTERNATE`）；
- `topology_meta TEXT`（JSON）。

master edit 不得修改已 `RELEASED` 的 snapshot（field-level guard）。

### 24.11 Topology Execution

`availableInput()` 对 topology：

- `LINEAR`：上一 op good → 当前 input（已有）；
- `PARALLEL` / `SPLIT` / `MERGE` / `ALTERNATE`：`NOT_STARTED` 时禁止 Confirm 报告；UI / API 提示 `TOPOLOGY_PRECONDITION_NOT_MET`；
- `NETWORK`：fail closed；要求 explicit `network_inputs`；当前实现仅允许 `LINEAR`；其它 metadata 完整保存但不触发。

### 24.12 Operation Report / Internal Handoff / Outsourced Boundary

- Operation Report：保持现有 contract；`confirmOperationReport` 增加 `internal` control code 校验（`is_outsource=1` → 拒绝 confirm + `OUTSOURCING_HANDOFF_REQUIRED`）；
- Internal Handoff：`availableInput()` 保持前工序 good → 当前；
- Outsourced Boundary：`is_outsource=1` operation 在 `completeOperation` 拒绝；只能由 `markOperationOutsourcedHandoff(operationId, supplierId)` 进入 `OUTSOURCED` 状态（deferred 到 Procurement Domain）；
- 跨组织 Operation Transfer：OUT_OF_SCOPE — 单组织基线。

### 24.13 Manufacturing Quality Master（Wave E）

新建表（migration）：

- `inspection_items(id, code, name, category, analysis_method, standard, unit, active)`；
- `inspection_detection_values(id, item_id, label, value, active)`；
- `inspection_instruments(id, code, name, specification, active)`；
- `inspection_plans(id, code, name, target_type, target_id, product_id, active)` （target_type ∈ { `PRODUCT`, `MATERIAL` }）；
- `inspection_plan_items(id, plan_id, sequence, item_id, criterion_name, specification, min_value, max_value, unit, instrument_id)`；

新建 `server/modules/manufacturing-quality.js`：

- CRUD + lifecycle；
- 与 `quality_control_points` 通过 `target_type/target_id` 形成 when / what 关系；
- 抽样规则仍由 `quality_control_points.sampling_mode / sampling_value` 决定，不重复。

### 24.14 Operation & Product Inspection (Wave F)

新建表：

- `production_inspections(id, code, production_order_id, production_operation_id | null, source_type, source_id, plan_id, status, result, business_date, inspector_id, created_at)`；
- `production_inspection_items(id, inspection_id, plan_item_id, criterion_name, specification, result_type, min_value, max_value, unit, instrument_id, numeric_result, text_result, pass_fail_result, passed)`；

`server/modules/manufacturing-quality.js` 新 handler：

- `createProductionInspection` / `completeProductionInspection` / `cancelProductionInspection`；
- `Operation Inspection`：`production_operation_reports.confirmed_report_id` 增加列 `released_quantity`（additive）；`confirmOperationReport` 增加 policy check；
- `Product Inspection`：`production_receipts.quality_state` / `quality_inspection_id` 列；`confirmProductionReceipt` 增加 `assertProductionReceiptQualityGate`；
- `Nonconforming`：`production_receipts.nonconforming` 列 + LOT/SERIAL HOLD 隔离逻辑。

### 24.15 Production Receipt Quality Gate

`production_receipts` 增加列（migration additive）：

- `quality_state TEXT NOT NULL DEFAULT 'NOT_REQUIRED'` （`NOT_REQUIRED / PASS / FAIL / WAIVED / STALE`）；
- `quality_inspection_id TEXT`；
- `quality_plan_id TEXT`；
- `nonconforming INTEGER NOT NULL DEFAULT 0`；
- `nonconforming_reason TEXT`。

`confirmProductionReceipt` 增加 gate：REQUIRED policy → 等待 `quality_state='PASS' / 'WAIVED'`；FAIL → reject（除非 `nonconforming=1` + LOT/SERIAL HOLD）。

### 24.16 Production Scan Execution (Wave G)

新建 `server/modules/manufacturing-scan.js`：

- `POST /api/production-scan/lookup` { token, kind } → returns order / material requirement / operation identity；
- `POST /api/production-scan/issue` { orderToken, requirementLineId, warehouseId, identity, quantity } → 创建 Material Issue 草稿，最终确认继续走 canonical Material Issue handler；
- `POST /api/production-scan/report` { orderToken, operationToken, goodQuantity, scrapQuantity, laborSeconds, machineSeconds } → 创建 Operation Report 草稿，最终确认继续走 canonical Operation Report handler；
- 扫描 shortcut 只负责识别和创建草稿，数量、身份与仓库先行校验；库存、WIP、质量门禁及累计量由 canonical confirm 链路执行；
- 严格 scanner wedge keyboard input 即可；
- 不实现相机 SDK / Barcode rule designer / label printing。

`src/pages/manufacturing-quality.jsx::ProductionScan` 提供单一 Material + Operation 工作面。

### 24.17 Analytics (Wave H)

由 `manufacturing-execution.js` 承载新增分析 handler：

- `GET /api/manufacturing-analytics/execution-summary?from&to`：
  - per order: planned / started / completed / reported good / reported scrap / received / progress / planned vs actual；
- `GET /api/manufacturing-analytics/material-issue-summary?from&to`：
  - per material requirement: required / issued / supplemented / returned / net / theoretical support。

既有：

- `manufacturingWipReport` / `manufacturingYieldReport` / `manufacturingCapacityReport` / `manufacturingCostReport` 保留；
- 新增 `scheduled_minutes` vs `actual_minutes`；
- 不重写。

### 24.18 WIP / Finance Boundary

- Manufacturing 拥有：数量 / 累计执行量 / labor seconds / machine seconds / scrap / yield / 工序级 WIP；
- 不创建新的 Cost Engine；
- Finance Operations 拥有：final valuation / COGS / GL；
- 既有 `production_wip_movements` / `accounting_vouchers` / `production_cost_summaries` 不破坏；
- 保留 `production_cost_baselines` 由 `ensureCostBaseline` 计算；
- `materialSourceValue` / `receiveSourceValue` / `restoreSourceValue` / `consumeOriginalInboundValue` 不破坏。

### 24.19 Migration / Schema

Additive migration：`server/migrations/manufacturing-quality-schema.js`

- 14 张新表（inspection_items / inspection_detection_values / inspection_instruments / inspection_plans / inspection_plan_items / production_inspections / production_inspection_items / production_material_supplements / production_material_supplement_items / production_batch_issues / production_batch_issue_orders / production_batch_issue_items / production_byproducts / production_byproduct_receipts）；
- 既有表 additive columns：
  - `production_orders`：`status` enum additive；`released_by / released_at / approved_by / approved_at / submitted_by / submitted_at / material_list_status / material_list_approved_by / material_list_approved_at / material_list_released_by / material_list_released_at`；
  - `production_order_items`：`material_list_status`（仅 additive）；
  - `production_order_operations`：`plan_status / control_code_id / control_participates_scheduling / control_reporting_method / control_inspection_method / is_outsource / quality_policy / topology / topology_meta / submitted_at / approved_at / released_at`；
  - `production_material_returns`：`reason_code`；
  - `production_receipts`：`quality_state / quality_inspection_id / quality_plan_id / nonconforming / nonconforming_reason`；
  - `production_operation_reports`：`released_quantity / inspection_id`（additive）；
- 6 个普通索引（按 capability target column）。

迁移必须 `try/catch 'duplicate column'` / `try/catch 'duplicate table'`；idempotent。

### 24.20 RBAC / Permission

`server/db.js::PERMISSIONS` 新增：

```text
PRODUCTION_PLAN_VIEW                  PRODUCTION_PLAN_MANAGE
PRODUCTION_SUPPLEMENT_MANAGE         PRODUCTION_RETURN_MANAGE
PRODUCTION_BATCH_ISSUE_MANAGE         PRODUCTION_INSPECTION_VIEW
PRODUCTION_INSPECTION_MANAGE         PRODUCTION_QUALITY_CONFIG_VIEW
PRODUCTION_QUALITY_CONFIG_MANAGE     PRODUCTION_BYPART_MANAGE
PRODUCTION_SCAN_EXECUTE              PRODUCTION_ORDERS_APPROVE
PRODUCTION_ORDERS_RELEASE
```

`role-admin` 继承；其他 5 个 role seed 视需要 extend；按现有 RBAC convention。

### 24.21 Audit / Transaction / State machine

- 所有 Manufacturing mutation 在 transaction 内重读权威状态 + 累计执行量 + 期间状态；
- 失败回滚 inventory / LOT/SERIAL / value / WIP / voucher / audit / idempotency；
- 关键 mutation 写 audit_logs（已存在）；增加：
  - `PRODUCTION_ORDER_SUBMIT / APPROVE / REJECT / RELEASE / COMPLETE / CANCEL`；
  - `PRODUCTION_MATERIAL_SUPPLEMENT_CONFIRM`；
  - `PRODUCTION_MATERIAL_RETURN_CONFIRM`；
  - `PRODUCTION_BATCH_ISSUE_CONFIRM`；
  - `PRODUCTION_OPERATION_PLAN_SUBMIT / APPROVE / RELEASE`；
  - `PRODUCTION_INSPECTION_CREATE / COMPLETE / CANCEL`；
  - `PRODUCTION_SCAN_LOOKUP / ISSUE / REPORT`。

### 24.22 Tests

新增 coherent Manufacturing & Quality acceptance family：

- `server/manufacturing-quality-domain.test.js` — coherent focused family，覆盖订单状态机、补料/退料/合并领料、Operation Plan/排程、质量主数据/检验门禁、扫码、分析与 legacy `production_outputs` 收敛；
- 既有 `manufacturing-stabilization.test.js`、`m6-production-workflow.test.js`、`v13-phase6c-manufacturing-execution.test.js` 保持兼容与回归证据。

集中登记到 `scripts/testing/test-suites.js`。

### 24.23 Canonical Gates

- `pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`。

### 24.24 Rollback

- additive migration：所有表 / 列 rollback 由 `try/catch 'duplicate column' / 'duplicate table'` 安全；
- state machine additive enum：DB 约束 CHECK 重建为包含旧 + 新值；旧字符串仍写；
- handler / module 新建文件，整文件删除即可 revert；
- production_outputs legacy 收敛：handler 移除；表保留；不影响历史数据。

### 24.25 Frontend Information Architecture

Launcher `manufacturing-quality` 升级：

```text
production-orders     — 制令单
material-issues       — 用料出库
production-receipts   — 生产入库
production-quality   — 生产质量（new route）
production-scan      — 生产扫码（new route）
quality-configuration — 质量配置（new route）
manufacturing-analytics — 生产执行分析
```

IQC / OQC / quality-control-points 保持当前 sub-stage（contextual）。

Mobile UX：

- Production Order Detail 成为 execution hub（Header → Source & Plan → Material → Operations → Quality → Receipt → Completion）；
- Material Requirement Card：Required / Issued / Supplemented / Returned / Net / Remaining / Stock / Tracking；
- Operation Card：sequence / operation / work center / planned window / state / input / reported good/scrap / downstream release / primary action；
- Quality Execution：Pending Inspection → inspect → enter criteria → PASS / FAIL → disposition；
- Production Scan：scanner wedge input + tabs Material / Operation。

`erp-mobile-taste` Skill 仅用于本次 UI 工作面；不改变 API / schema / permission / state machine。

### 24.26 Implementation Waves 摘要

```text
Wave A — Production Order & Material List Governance
        Draft / Submit / Approve / Reject / Release / Start / Complete / Cancel
        Material List lifecycle
        Engineering Resolver 消费
        legacy production_outputs 收敛

Wave B — Material Execution Closure
        Supplement + Return Reason + Batch Picking

Wave C — Operation Plan & Scheduling
        Operation Plan lifecycle + Forward / Backward + Calendar + Capacity

Wave D — Shop-floor Execution
        Control Code snapshot + Internal Handoff + Topology + Outsourced boundary

Wave E — Manufacturing Quality Master
        Inspection Item / Detection Value / Instrument / Plan

Wave F — Operation & Product Inspection
        Operation Inspection + Product Inspection + Receipt Quality Gate + Nonconforming

Wave G — Production Scan Execution
        Production Scan 工作面 (Material + Operation)

Wave H — Analytics & Integration
        Execution Summary + Material Issue Summary + 既有 Analytics
```

---

**MANUFACTURING & QUALITY DOMAIN CLOSURE DESIGN — READY FOR AUTHORIZED IMPLEMENTATION**

---
