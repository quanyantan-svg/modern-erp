# 项目状态登记表（PROJECT_STATUS）

> 状态：`ACTIVE` —— 全仓库**唯一**当前项目级进度登记表
> Owner：Platform
> 权威来源：本文件；`README.md` 只链接并简述本表，不得形成第二份状态登记
> 来源：`document.md` §35 @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移，章节编号保持不变）

## 35. 当前项目状态快照（2026-10-31）

### 35.1 本节的定位与约束

本节是**当前项目状态的唯一入口**。它引用而不复制历史冻结证据。

- 本节**不覆盖、不删除、不改写**任何历史 Requirement、Design、Acceptance 或 Freeze 记录。
  全部历史结论继续保留在 §26–§34 与本节之后的 dated 章节中，其**历史含义不因本节而改变**。
- 凡与本节冲突的历史陈述，一律按 **dated supersession** 处理：历史陈述在其自身日期为真，
  其"当前状态"含义已被本节取代，而**不是被删除或伪造**。
- 本节**不得**把 §22 的 2026-10-06 初始 Coverage 矩阵覆盖为推断值。凡缺少逐条证据支持的
  Capability，一律保持 `UNVERIFIED`。
- 本节不是 Acceptance，也不是 Freeze。它不签发任何 Acceptance 标识。
  **（2026-10-31 限定说明）**：该约束适用于 §35.1–§35.10，即本节自身的审计快照部分。
  §35.11 登记的是业务所有者于 2026-10-31 显式作出的 `M0_BASELINE_ACCEPTANCE_PASS` 决定；
  该标识来自该决定本身，**不由本节自行签发**，也不改变本节其余部分“不是 Acceptance”的性质。

本节的形成依据是 2026-10-31 的《ERP Project-Wide Progress Baseline & Next Milestone Audit》
项目级审计，以及该审计的勘误（`solution.md §37.54.48`）。

### 35.2 审计勘误（对上一版项目级审计结论的更正）

| # | 上一版审计的结论 | 更正 | 依据 |
|---|---|---|---|
| E-1 | W11-A 包级 Acceptance 需等待 W11-B/C/D | **撤销**。W11-A 的唯一硬依赖是 W11-SEC；`W11-B`、`W11-D` 不依赖 W11-A，`W11-A` 不依赖 W11-B/C | `solution.md §37.54.15.1` 依赖 DAG 与 CORRECTION-5（2026-10-27） |
| E-2 | W11-D 必须等待 W11-B/W11-C | **撤销**。W11-D 只依赖 W11-SEC 的 Scope 合同 | 同上 |
| E-3 | 缺少某类机器 Token 即历史验收无效 | **撤销**。冻结层级是七种不同状态，缺一种不等于其余无效；且**不得补造历史用户授权** | `AGENTS.md §4.5`；`docs/operations/global-implementation-status-audit-2026-10-14.md:103` |
| E-4 | Planned Order → Production Order 追溯链 **BROKEN** | **撤销**。该链经 `production_instruction_items.planned_order_id` 与 `production_orders.production_instruction_item_id` **两跳 FK 完整可追溯**，且生产代码已在反向使用该关联 | `server/migrations/planning-domain-schema.js:287`；`server/migrations/manufacturing-quality-schema.js:52`；`server/migrations/v13-phase4-production-integrity.js:10,27`；`server/modules/planning-documents.js:231,348,365` |
| E-5 | 上一版审计列出的采购委外缺陷 | **保留**（有源码支持），登记为待治理缺陷／待确认风险，不擅自修改生产行为 | 见 §35.8 |

### 35.3 九个 Domain 当前进度

冻结层级严格区分七种状态，任何一种都不得替代另一种：
`Requirement Complete` → `Implementation Complete` → `Stage Acceptance` → `Capability Freeze`
→ `Domain-Level Acceptance` → `Manual Capability Closure` → `Release Readiness`。

| Domain | Requirement | Implementation | Stage Acceptance | Capability Freeze | Domain-Level Acceptance | Manual Capability Closure | Release Readiness |
|---|---|---|---|---|---|---|---|
| Master & Engineering | §28 Complete | Complete | — | — | 未见独立 token（下游日志记 `V17 §28` FROZEN） | 未见 | 未就绪 |
| Manufacturing & Quality | §29 Complete | Complete | — | — | 未见独立 token（下游日志记 `V18 §29` FROZEN） | 未见 | 未就绪 |
| Planning | §30 Complete | Complete | `Final Acceptance: PASS` | `Freeze: YES` | **有明确用户 Freeze** | §30 覆盖范围内 | 未就绪（整体） |
| Procurement & Outsourcing | §31 Complete | Complete | 28/28 browser + 11/11 MySQL race | 未冻结 | **§31.11 `NOT READY`，不得 Freeze** | 未见 | 未就绪 |
| Inventory & Warehouse | §32 Complete | Partial Complete | — | — | 未见独立 token | 未见 | 未就绪 |
| Finance Operations | §33 Complete | Complete | — | — | 未见独立 token | 未见 | 未就绪 |
| Sales & Customer | §34 FROZEN | Complete（Wave 0–10 + W11） | Wave 6/7/9 + Gate A PASS | Wave 6/7/9 + Gate A + Wave 10 | 部分：Wave 8 待提交、Waves 1–2 无验收记录、整域明确未冻结 | CAP-1..36 部分 | 未就绪 |
| Accounting & Analytics | **无 Domain Closure Requirement** | Partial | — | — | 未见 | **未闭合**（B3114–B3117） | 未就绪 |
| Platform | **无 Domain Closure Requirement** | Partial | — | — | 未见 | **未闭合**（B3122） | 未就绪 |

**没有任何 Domain 达到 Release Readiness。** 生产发布仍未获授权（`document.md:11187`）。

### 35.4 B3101–B3122 最新 Coverage 来源

§22 仍是**已批准的手册能力基线**；本节只指定"当前 Coverage 应从哪里读"，**不重新计数、不覆盖 §22**。
逐 Capability 的后验收覆盖统计本次**未逐条核验**，因此保持 `UNVERIFIED`。

| 手册 | 当前 Coverage 权威来源 | Capability 规模 | 状态 |
|---|---|---|---|
| B3101 采购 | §31.3.1 | PRC-01..26 | Requirement 完成；Acceptance `NOT READY` |
| B3102 销售 | §34.8 | CAP-1..27 | 已实现并部分冻结 |
| B3103 信用 | §34.8 + Stage B SC82–SC107 | CAP-28..36 | 已实现并冻结 |
| B3104 库存 / B3105 条码 | §32.3 | INV-01..44（Barcode = INV-39..44） | Requirement 完成；Domain Acceptance 未见 |
| B3106 存货核算 / B3107 固资 | §33.1.3 仅确认归属 | **无能力矩阵** | Coverage `UNVERIFIED` |
| B3108–B3113 | §33.5 + §33.2 三种识别模型 | FO01..FO58 | Requirement 完成；Domain Acceptance 未见 |
| B3114 智能会计 / B3115 总账 / B3116 报表 / B3117 经营会计 | **无能力矩阵** | — | Coverage `UNVERIFIED` |
| B3118 工程数据 | §28.3 | ME-01..31 | 已实现；Domain Acceptance 未见 |
| B3119 生产管理 | §29.3 | MQ-01..43 | 已实现；Domain Acceptance 未见 |
| B3120 计划 | §30.2 | PL-01..45 | 已实现并冻结 |
| B3121 委外 | §31.3.3 + VMI-01..05 | OUT-01..23 | Requirement 完成；Acceptance `NOT READY` |
| B3122 工作流 | §22.22 | — | 仍然开放（正确） |

### 35.5 已验收、待验收与未实施

**已验收并冻结**（各自的 Acceptance 标识与锚点见其冻结记录，本节不复制）：
Planning；Sales Wave 6 / 7 / 9、Gate A、Wave 10（**能力冻结，发布仍阻塞**）；Package B 测试隔离；
W11-SEC-01；W11-A U1、U2、OVERDUE Foundation、U3。

**已验收但不属于业务能力冻结**（文档层基线验收，详见 §35.11）：
M0 Project Baseline Reconciliation & Audit Errata（`M0_BASELINE_ACCEPTANCE_PASS`）。
它是**文档与基线层面的验收**，**不是**任何 Domain 的 Domain-Level Acceptance，
**不关闭**任何 G-1…G-5、D-2…D-5、历史库存完整性或 Release Blocker。

**实现完成但缺 Domain-Level Acceptance**：Master & Engineering、Manufacturing & Quality、
Inventory & Warehouse、Finance Operations。

**待验收**：Procurement & Outsourcing（`NOT READY`）。

**未实施**：W11-B Credit Evaluation Foundation、W11-C Multi-Scorer / Rating Application、
W11-D Reconciliation / Recalculation；Accounting & Analytics 的 Smart Accounting 规则平台、
Cash Flow、Report Designer、Management Accounting；Platform Generic Workflow 执行引擎。

### 35.6 W11 依赖 DAG 与 W11-A 包级 Acceptance 就绪度

以 `solution.md §37.54.15.1` 为唯一权威：

```text
硬依赖
  W11-A  -> W11-SEC   （Stage B §11）
  W11-C  -> W11-B    （SC106 评分表与 SC107 结果对象由 W11-B 提供）
  W11-D  -> W11-SEC  （W11-D 的对外读取必须满足 W11-SEC 的 Scope 合同）

非依赖（明确不构成阻塞）
  W11-B  !-> W11-A
  W11-D  !-> W11-A   （CORRECTION-5，2026-10-27 撤销）
  W11-A  !-> W11-B / W11-C
  W11-D  !-> W11-B / W11-C
```

`W11-D ↔ W11-A` 仅为**可选复用**：`W11-D` 可以复用 W11-A 的读取构造器，但**不因此被阻塞**，
也**不得**因此新增硬依赖。

**W11-A 包级 Acceptance 就绪度（重新评估）**：
`solution.md §37.54.15.3` 定义的 W11-A 契约范围为 3 个 GET 端点 + `credit-query.js` +
`credit-query.jsx` + W11-A U1/U2/U3 增量，其 Acceptance 标识为 `W11_A_ACCEPTANCE_PASS`，
其**依赖为"W11-SEC 必须先通过"**。

- 该硬依赖**已满足**（W11-SEC-01 于 2026-10-28 验收冻结）；
- 契约范围内的各单元**均已验收冻结**，并已有 Git 锚点与双远端推送；
- 因此 W11-A **满足其自身契约的包级验收条件**。

**但本节不签发 `W11_A_ACCEPTANCE_PASS`。** 该标识此前被明确保留给完整 W11-A 包
（`document.md:12401, 12506, 13216, 13380, 13394`；`solution.md:32565, 32844, 35103`），
签发是业务所有者的决定。另有两项**需要在包级冻结前处理**的记录事实：

1. W11-A OVERDUE Foundation 的冻结记录**本身未记载 Git SHA**，其验收工作树保持未暂存/未提交
   （`document.md:13708-13710`）。包级冻结若要引用完整锚点集，应先闭合该锚点；
2. W11-A 的所有单元冻结记录都明确把"W11-A Package"列入排除项，因此包级冻结需要一次**独立的**、
   覆盖整个包的 Acceptance 决定，而不是对既有单元冻结的自动汇总。

### 35.7 Frozen SHA 与 Git 状态

| 项 | 值 |
|---|---|
| Frozen Implementation（W11-A U3） | `ec618eb81684d645707c70a8b69ff9379682fbaa`（tree `908c10310cd92a509374ada2bd31b5882be580f2`） |
| Closure HEAD（W11-A U3 冻结日志） | `ebe3363fe88d64222a6aa619a932bfe9a4fa3578` |
| **M0 验收锚点提交** | `3e70c380eec7d34dd938a29d23dbf07227656ef1`（`docs(erp): 收口M0全局项目基线审计勘误与状态快照`；M0 已验收，见 §35.11） |
| WIP 父提交 / Recovery 基线 | `60f3fbd169d7b43bbae3824b10b538edef4aeec1` / `8c716f64dbeb8d650c3dd87a43661ed205fdcfdd` |
| 分支 | `review/w11a-u3-fast-blocked-20261030`，GitHub 与 Gitee 同名 Review Branch 均指向 M0 验收锚点 `3e70c380eec7d34dd938a29d23dbf07227656ef1` |
| `master`（两端） | `aee1e0c13d26dd840ae4b596340212eef03479c0`（未变） |
| Release tag | `v1.6.0` / `v1.6.1` / `v1.6.2`（未变） |
| 版本 | `1.6.2`（未变） |

### 35.8 五条端到端主链闭合情况与待治理缺陷

| 主链 | 步骤齐备 | 结构完整 | 主要断点 |
|---|---|---|---|
| Order-to-Cash | 10/10 | 是 | 识别模式分支（`LEGACY_DIRECT` 的 AR 来源是 Delivery 而非 Invoice）；AR aging 报告不保留 source 维度，无法回溯到发票或出库 |
| Procure-to-Pay | 12/12 | 否 | Receipt Notice → Purchase Receipt 转换未接线；`SEPARATE` 下 GRNI→Bill 为人工触发；bill 匹配只计算价差不标记 |
| Plan-to-Produce | 9/9 | 是 | Planned Order → Production Instruction → Production Order 经两跳 FK 完整可追溯；仅指令**表头**不直接携带 `planned_order_id`，属设计特征而非断链 |
| Plan-to-Outsource | 9 识别 / 4 不可达 | 否 | 见下方待治理缺陷 |
| Record-to-Report | 7/7 | 部分 | 无 Accounting Event 层（FO58 无实现）；TB/P&L/BS 不保留 source 维度；手工凭证以自身 id 为 source_id；报表与健康检查使用两套日期基准 |

**待治理缺陷 / 待确认风险（登记，不擅自修改生产行为）**：

| # | 缺陷 | 证据 | 性质 |
|---|---|---|---|
| G-1 | `outsourcing_receipt_items` **无生产写入路径**（`createOutsourcingReceipt` 只写表头，无 items 参数）；因此委外完工收货的 IQC、加工费 AP 与 FINAL 差异在 API 上不可达 | `server/modules/outsourcing.js:344-359`；`server/modules/quality-gates.js:162-163`；`server/modules/outsourcing-finance.js:166,178-179` | 源码支持的缺陷 |
| G-2 | processing-fee Supplier Bill 的 **AP/GL 与财务期间**：`postProcessingFeeBill` 写 AP 未写 GL 凭证，且未执行 `assertFinancialPeriodsOpen`；与 `postSupplierBill` 行为不一致 | `server/modules/outsourcing-finance.js:221-240`；对照 `server/modules/commercial-golive.js:306,315-320` | 源码支持的缺陷 |
| G-3 | **Receipt Notice → Receipt 执行转换**未接线：`assertNoticeCompatibleWithReceipt` 无生产调用点；委外收货表亦无 `receipt_notice_id` 外键 | `server/modules/procurement-receiving.js:61,228`；`server/migrations/procurement-outsourcing-schema.js:557-589` | 源码支持的缺陷（与 UAT-21 相关） |
| G-4 | **Outsourcing Material Issue/Return 与真实库存移动**：发料不写库存移动；退回路径以硬编码仓库串写 `from_warehouse_id`/`to_warehouse_id` | `server/modules/outsourcing.js:242-260`；`server/modules/outsourcing-finance.js:369-372`；`document.md:2242` | 源码支持的缺陷 + 已知 Requirement 风险 |
| G-5 | **UAT-14 旧 Test Oracle 与当前 V21 Contract 冲突**：验收 harness 仍硬编码 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE` 的 409 期望 | `scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-240`；`docs/operations/global-implementation-status-audit-2026-10-14.md:59` | **待确认风险**：修 test 还是修 contract 属业务决定，不得由本节自行决定 |

### 35.9 Release Blockers

| 标识 | 状态 | 阻塞范围 |
|---|---|---|
| `W10-INV-RISK-01` | `BLOCKS_RELEASE_ONLY` | 仅发布 |
| `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` | 冻结且发布阻塞 | 发布 |
| `LEGACY_DATA_EVIDENCE_PENDING` | 开放 | 非阻塞（外部证据依赖未解） |
| `CREDENTIAL_EXPOSURE_OPEN` | `USER_ACCEPTED / DEFERRED` | 非阻塞（**已被接受并延后，不等于风险消除**） |
| `R-U3-INV-09` | `ACCEPTED_RESIDUAL` | 非阻塞（限 Selector 精确身份过滤的已测 Collation 差异） |
| `R-U3-INV-10` | `DEFERRED_OUT_OF_SCOPE` | 阻塞受影响目标的部署/迁移 |
| `CURRENT ACCEPTANCE HARNESS DRIFT` | 开放 | Procurement 最终验收/冻结 |
| `D-2` / `D-3` / `D-4` / `D-5` | 开放设计决策 | W11-B、W11-C |
| `G-1`..`G-5` | 本节新登记 | 待治理缺陷，见 §35.8 |

**Fresh MySQL Inventory Demo Seed 门禁的 PASS 不关闭任何历史库存风险**（`document.md:15314-15315`）。

### 35.10 当前推荐的下一个工作包

**A — 项目 Git / 文档基线纠偏**（本节所属阶段，即 M0）。
**已于 2026-10-31 由业务所有者验收通过**：`M0_BASELINE_ACCEPTANCE_PASS`，验收锚点
`3e70c380eec7d34dd938a29d23dbf07227656ef1`，登记见 §35.11。

理由：canonical 文档此前陈述的是若干阶段之前的状态，任何后续业务包都会基于错误基线被规划与复核；
本包零回归风险、零 MySQL 依赖，且已把 §35.8 的源码级缺陷写入待治理清单。

候选对比与执行顺序见 `solution.md §37.54.48`。**M0 的验收只闭合 M0 本身**：
它既不构成对任何业务包的启动授权，也不构成对任何 Domain 的 Domain-Level Acceptance。
后续业务包的启动与授权仍须单独取得用户批准；§35.6 的 W11-A 包级验收、§35.8 的 G-1…G-5、
§35.9 的 D-2…D-5、历史库存完整性以及全部 Release Blockers 均保持开放。

### 35.11 M0 项目基线验收登记（2026-10-31）

#### 35.11.1 验收决定

业务所有者于 **2026-10-31** 正式确认：

```text
M0_BASELINE_ACCEPTANCE_PASS
```

| 项 | 值 |
|---|---|
| 验收对象 | M0 Project Baseline Reconciliation & Audit Errata（项目级文档基线纠偏与审计勘误） |
| Acceptance 标识 | `M0_BASELINE_ACCEPTANCE_PASS` |
| 验收锚点提交 | `3e70c380eec7d34dd938a29d23dbf07227656ef1` |
| 锚点提交主题 | `docs(erp): 收口M0全局项目基线审计勘误与状态快照` |
| 锚点提交变更路径 | `README.md`、`document.md`、`solution.md`、`log/2026-10-31.md`（4 条，纯文档） |
| 版本 | `1.6.2`，未变 |
| Release tag | `v1.6.0` / `v1.6.1` / `v1.6.2`，未变 |

#### 35.11.2 阶段状态迁移

```text
Before : ERP_PROJECT_BASELINE_RECONCILED_PENDING_ACCEPTANCE
         （M0 阶段结束时的状态，见 solution.md §37.54.48 结尾与 log/2026-10-31.md 的 M0 阶段记录）
After  : M0_BASELINE_ACCEPTANCE_PASS
         （业务所有者 2026-10-31 的显式决定）
```

迁移采用**日期化 supersession**：`solution.md §37.54.48` 结尾的
`ERP_PROJECT_BASELINE_RECONCILED_PENDING_ACCEPTANCE` 与 `log/2026-10-31.md` 中的同名标识
**均不删除、不改写**。它们对其各自阶段结束时的状态仍然为真，只是其"当前状态"含义已被本节取代。
历史 Requirement、Design、Acceptance、Freeze 记录全部保持原样。

#### 35.11.3 验收范围

被验收的是 **M0 阶段本身**，其范围严格限于：

- §35 状态快照的建立与 §35.2 的五项审计勘误（E-1…E-5）；
- `README.md` 的状态入口与失效陈述更正；
- `solution.md §37.54.48` 的设计层记录与技术设计状态索引；
- `log/2026-10-31.md` 的 append-only 阶段记录。

M0 **不改变任何生产行为、API、schema、migration、权限、状态机或业务语义**。

#### 35.11.4 明确不因 M0 PASS 而关闭的事项

以下全部**保持开放**，M0 PASS 对它们**没有任何关闭作用**：

| 事项 | 当前位置 | 状态 |
|---|---|---|
| **W11-A 整包验收** | §35.6 | **仍需独立决定**；`W11_A_ACCEPTANCE_PASS` 仍未签发，签发是业务所有者的独立决定 |
| **G-1**（`outsourcing_receipt_items` 无生产写入路径） | §35.8 | 开放，源码支持的缺陷 |
| **G-2**（processing-fee bill 的 AP/GL 与财务期间） | §35.8 | 开放，源码支持的缺陷 |
| **G-3**（Receipt Notice → Receipt 转换未接线） | §35.8 | 开放，源码支持的缺陷 |
| **G-4**（委外材料发/退与真实库存移动） | §35.8 | 开放，源码支持的缺陷 + 已知 Requirement 风险 |
| **G-5**（UAT-14 旧 Test Oracle 与 V21 Contract 冲突） | §35.8 | 开放，**待确认风险**；修 test 还是修 contract 仍是业务决定 |
| **D-2 / D-3 / D-4 / D-5** | §35.9 | 开放设计决策，阻塞 W11-B、W11-C |
| **历史库存完整性**（R-U3-INV-10） | §35.9 `R-U3-INV-10 = DEFERRED_OUT_OF_SCOPE` | 独立 Requirement，**未关闭**；新鲜库门禁 PASS 不关闭任何历史库存风险 |
| **现有 Release Blockers** | §35.9 全表 | 全部保持原状态；`CREDENTIAL_EXPOSURE_OPEN` 仍为 `USER_ACCEPTED / DEFERRED`，**不等于风险消除** |
| **Procurement & Outsourcing Domain Acceptance** | §35.3 / §35.5 | **仍为 `NOT READY`**；M0 PASS **不构成**该 Domain 的 Domain-Level Acceptance，**不得据此宣告采购委外 Domain 验收** |
| **Release Readiness** | §35.3 | 没有任何 Domain 达到 Release Readiness；生产发布仍未获授权 |

#### 35.11.5 验收之后的暂停点

- M0 已闭合。后续任何业务包、Domain Acceptance、W11-A 包级冻结、Release 或部署，
  都**仍需各自的显式授权**。
- M0 的验收登记本身是一次**纯文档变更**，其提交与双远端推送**尚未授权**，等待单独批准。

---

---

## 36. G0 开发治理重构状态（2026-11-01）

### 36.1 本节定位

本节是 G0（Development Governance Refactor）对项目状态表的**唯一增量登记**。

- 本节**不修改、不删除** §35 的任何历史结论；凡与 §35 冲突，按**日期化 supersession** 处理
  （历史陈述在其自身日期为真，其"当前状态"含义已被本节取代）。
- 本节**不是** Acceptance，也**不签发**任何 Acceptance / Freeze 标识。
- 本节**不关闭** §35.11.4 列出的任何开放事项：G-1…G-5、D-2…D-5、历史库存完整性、
  全部 Release Blockers、W11-A 整包验收、Procurement & Outsourcing 的 `NOT READY`
  与 Release Readiness 全部保持原状态。

### 36.2 对 §35 的勘误

| # | §35 中的陈述 | 当前事实 | 依据 |
|---|---|---|---|
| G0-E-1 | §35.7 记 `master`（两端）= `aee1e0c13d26dd840ae4b586340212eef03479c0` | G0 基线的 `master` 为 `4cb8c477aa00988bbfebef905764565cdfe62b71`（`docs(m1): approve procurement and outsourcing requirement`）。§35.7 的取值是 2026-10-31 的**日期化快照**，其"当前 master"含义已被本条取代 | `git rev-parse master` @ 2026-11-01 |
| G0-E-2 | §35.7 记 M0 验收锚点提交 `3e70c380…` 的"提交与双远端推送尚未授权" | 该锚点提交**已存在于 `master` 历史**（`git merge-base --is-ancestor` 校验通过），其后为 `498d501`、`4cb8c47`。§35.11 的验收结论本身不变 | `git log master` @ 2026-11-01 |
| G0-E-3 | §35.10 "当前推荐的下一个工作包 = A（M0）" | M0 已闭合（§35.11）。**本轮 G0 是文档治理工作包**，其自身状态见 §36.4；业务包的启动仍需单独授权 | 本节 |

### 36.3 M1 设计状态（未合并，单独授权）

- M1 的 **Design** 正文（`solution.md` §26.33，含 R4 / R4-5 / R4-6 / R4-6-R1 / R4-6-R2 修订）
  目前**只存在于独立分支** `work/m1-r4-6-design-correction-20261101`（HEAD `912fd76700ff6f3ad1509eec4c9e2241c1830265`）。
- 该设计**未合并到 `master`**，因此**不是** `master` 的当前实现，也**不得**被当作已批准或已实施。
- 其当前状态为 **`PENDING_REVIEW`**：`Design PASS` 未签发，`Implementation` 未授权，
  13 个 Gate 全部 `NOT_RUN`。
- 本节**不复制**该分支的任何设计正文。分支内容在获得单独授权后按 §4 的阶段控制处理。
- `master` 侧的 M1 权威内容只有 **Requirement**：`docs/requirements/procurement-outsourcing.md` §31.12。

### 36.4 G0 交付状态

```text
G0_IMPLEMENTATION_COMPLETE_PENDING_USER_ACCEPTANCE
```

| 项 | 值 |
|---|---|
| 工作分支 | `work/g0-governance-refactor-20261101` |
| 基线 | `master` @ `4cb8c477aa00988bbfebef905764565cdfe62b71` |
| 交付提交 | `8186e8165fbec60f60432011a118fa8eb20a76b8`（`docs(erp): 完成 G0 开发治理体系重构`） |
| 变更范围 | 仅治理与文档（`AGENTS.md`、`CLAUDE.md`、`README.md`、`document.md`、`solution.md`、`docs/**`、`log/**`）；**未修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试** |
| 迁移映射 | [`docs/status/MIGRATION-MAP.md`](./MIGRATION-MAP.md) —— 143 条逐章节映射（`document.md` 58 条 + `solution.md` 85 条） |
| 完整性校验 | 83/83 与 105/105 个 H2 章节正文**逐字保留**且**各出现一次**；逐行守恒校验 0 行丢失 |
| G0 Acceptance | **未签发** —— 等待用户审查 |

### 36.5 G0 之后仍然开放的事项

G0 是**治理层**工作包，**不关闭任何业务 Gap**。以下全部保持 §35 记录的原状态：

- G-1…G-5（`PROJECT_STATUS.md` §35.8）；
- D-2…D-5 开放设计决策（见 [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md)）；
- M1 的 A-P01 / A-P02 / B-P01 / B-P02 / C-P01…C-P04 / D-P01 / D-P02 集中业务决策；
- `W11_A_ACCEPTANCE_PASS` 未签发；
- Procurement & Outsourcing `NOT READY`；
- 全部 Release Blockers 与 Release Readiness 未就绪；
- Accounting & Analytics 与 Platform 无 Domain Closure Requirement / Design。

### 36.6 下一步建议

1. **用户审查 G0 并签发或拒绝 Acceptance**（本节 36.4 的状态标识）。
2. **恢复 M1 设计审查**所需的确切条件：G0 Acceptance 通过 → 用户单独授权 M1 Design 复核 →
   在受保护的独立工作区对 `work/m1-r4-6-design-correction-20261101` 做 Design 复核 →
   业务所有者裁定 §31.12.8 的 10 项集中业务决策 → 才可能签发 Design PASS 并授权 Implementation。
3. 在 M1 Design 未获批前，**不得**启动委外 / VMI 的 GL、结算、Cost Implementation。

---

## 附录 A. G0 迁移：README「当前项目状态快照（2026-10-31）」与「当前主要 Gap」

> 以下两节自 `README.md` 原样迁入（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`），以保持 README 的项目入口职责单一。
> README 现在只**链接**本表，不得形成第二份状态登记。

## 当前项目状态快照（2026-10-31）

本节是**当前状态的唯一入口**。它引用而不复制历史冻结证据；历史结论一律保留在
`document.md` / `solution.md` 的 dated 章节与 `log/` 中，**不得以本节覆盖历史**。
上一版项目级审计为《ERP Project-Wide Progress Baseline & Next Milestone Audit》（2026-10-31），
其勘误见 `solution.md §37.54.48`。

本节所属的 **M0 阶段（项目级文档基线纠偏与审计勘误）已由业务所有者于 2026-10-31 验收通过**：
`M0_BASELINE_ACCEPTANCE_PASS`，验收锚点 `3e70c380eec7d34dd938a29d23dbf07227656ef1`，
登记见 `document.md §35.11`。该验收**只闭合 M0 本身**：它**不构成任何 Domain 的
Domain-Level Acceptance**，**不签发** `W11_A_ACCEPTANCE_PASS`，也**不关闭**
G-1…G-5、D-2…D-5、历史库存完整性或任何 Release Blocker。

### 九个 Domain 当前进度

冻结层级严格区分七种状态，不得互相替代：
`Requirement Complete` → `Implementation Complete` → `Stage Acceptance` → `Capability Freeze`
→ `Domain-Level Acceptance` → `Manual Capability Closure` → `Release Readiness`。

| Domain | Requirement | Implementation | Stage Acceptance | Capability Freeze | Domain-Level Acceptance | Manual Capability Closure | Release Readiness |
|---|---|---|---|---|---|---|---|
| Master & Engineering | §28 Complete | Complete | — | — | 未见 token（下游日志记 `V17 §28` FROZEN） | 未见 | 未就绪 |
| Manufacturing & Quality | §29 Complete | Complete | — | — | 未见 token（下游日志记 `V18 §29` FROZEN） | 未见 | 未就绪 |
| Planning | §30 Complete | Complete | `Final Acceptance: PASS` | `Freeze: YES`（`log/2026-10-08.md:288`） | 有明确用户 Freeze | §30 覆盖范围内 | 未就绪（整体） |
| Procurement & Outsourcing | §31 Complete | Complete | 28/28 browser + 11/11 MySQL race | 未冻结 | **§31.11 `NOT READY`，不得 Freeze** | 未见 | 未就绪 |
| Inventory & Warehouse | §32 Complete | Partial Complete | — | — | 未见 token | 未见 | 未就绪 |
| Finance Operations | §33 Complete | Complete | — | — | 未见 token（`USER FREEZE NOT VERIFIED`） | 未见 | 未就绪 |
| Sales & Customer | §34 FROZEN | Complete（Wave 0–10 + W11） | Wave 6/7/9 + Gate A PASS | Wave 6/7/9 + Gate A + Wave 10 | 部分（Wave 8 待提交；Waves 1–2 无验收记录） | CAP-1..36 部分 | 未就绪 |
| Accounting & Analytics | **无 Domain Closure Requirement** | Partial | — | — | 未见 | **未闭合**（B3114–B3117） | 未就绪 |
| Platform | **无 Domain Closure Requirement** | Partial | — | — | 未见 | **未闭合**（B3122） | 未就绪 |

**没有任何 Domain 达到 Release Readiness。** 生产发布仍未获授权（`document.md:11187`）。

### B3101–B3122 最新 Coverage 来源

`document.md §22`（2026-10-06）仍是**已批准的手册能力基线**，其 Coverage 列是初判，**不得当作当前进度**。
当前权威 Coverage 来源如下；**未经逐条证据支持的 Capability 保持 `UNVERIFIED`**。

| 手册 | 权威 Coverage 来源 | 状态 |
|---|---|---|
| B3101 采购 / B3121 委外 | §31.3.1（PRC-01..26）、§31.3.3（OUT-01..23）、VMI-01..05 | Requirement 已完成；Acceptance `NOT READY` |
| B3102 销售 | §34.8（CAP-1..27） | 已实现并部分冻结 |
| B3103 信用 | §34.8（CAP-28..36）+ SC82–SC107 | 已实现并冻结（W11-SEC/U1/U2/OVERDUE/U3） |
| B3104 库存 / B3105 条码 | §32.3（INV-01..44） | Requirement 已完成；Domain Acceptance 未见 |
| B3106 存货核算 / B3107 固资 | §33.1.3 仅确认归属 | **无能力矩阵，Coverage `UNVERIFIED`** |
| B3108–B3113 | §33.5（FO01..FO58）+ §33.2 三种识别模型 | Requirement 已完成；Domain Acceptance 未见 |
| B3114–B3117 | 无 | **无能力矩阵，Coverage `UNVERIFIED`** |
| B3118 工程数据 | §28.3（ME-01..31） | 已实现；Domain Acceptance 未见 |
| B3119 生产管理 | §29.3（MQ-01..43） | 已实现；Domain Acceptance 未见 |
| B3120 计划 | §30.2（PL-01..45） | 已实现并冻结 |
| B3122 工作流 | §22.22 | 仍然开放（正确） |

### 已验收 / 待验收 / 未实施

- **已验收并冻结**：Planning；Sales Wave 6 / 7 / 9、Gate A、Wave 10（能力冻结，发布仍阻塞）；
  Package B 测试隔离；W11-SEC-01、W11-A U1、U2、OVERDUE、U3。
- **已验收（文档层基线验收，非能力冻结）**：M0 项目级文档基线纠偏与审计勘误
  （`M0_BASELINE_ACCEPTANCE_PASS`，锚点 `3e70c380eec7d34dd938a29d23dbf07227656ef1`）。
  它**不构成任何 Domain 的 Domain-Level Acceptance**，也不关闭任何待治理缺陷或 Release Blocker。
- **实现完成但缺 Domain-Level Acceptance**：Master & Engineering、Manufacturing & Quality、
  Inventory & Warehouse、Finance Operations。
- **待验收**：Procurement & Outsourcing（`NOT READY`）。
- **未实施**：W11-B（Evaluation Foundation）、W11-C（Multi-Scorer / Rating）、W11-D（Reconciliation）；
  Accounting & Analytics 的 Cash Flow、Report Designer、Management Accounting；
  Platform Generic Workflow 执行引擎。

### W11 依赖 DAG（`solution.md §37.54.15.1` 为准）

```text
[W11-SEC] ──> [W11-A] Credit Query / Exception History

[W11-B] Evaluation Foundation ──> [W11-C] Multi-Scorer / Rating Application

[W11-D] Reconciliation / Recalculation ──> 仅依赖 [W11-SEC] 的 Scope 合同
```

硬依赖只有三条：`W11-A → W11-SEC`、`W11-C → W11-B`、`W11-D → W11-SEC`。
`W11-B`、`W11-D` **不依赖** `W11-A`；`W11-A` **不依赖** `W11-B/C`；`W11-D` **不依赖** `W11-B/C`。
`W11-D ↔ W11-A` 仅为**可选复用**（`solution.md §37.54.15.1` CORRECTION-5，2026-10-27）。

**W11-A 包级 Acceptance**：其唯一硬依赖 W11-SEC 已通过；契约范围
（`§37.54.15.3`：3 个 GET 端点 + `credit-query.js` + `credit-query.jsx` + U1/U2/U3 增量）已全部
验收冻结。包级标识 `W11_A_ACCEPTANCE_PASS` **仍被保留、尚未签发**——签发是用户的决定，不由本次纠偏代签。
W11-A OVERDUE Foundation 的冻结记录本身**未记载 Git SHA**（其工作树保持未暂存/未提交），
在包级冻结引用完整锚点集之前应先闭合该锚点。

### Frozen SHA / Git 状态

| 项 | 值 |
|---|---|
| Frozen Implementation（W11-A U3） | `ec618eb81684d645707c70a8b69ff9379682fbaa`（tree `908c10310cd92a509374ada2bd31b5882be580f2`） |
| Closure HEAD | `ebe3363fe88d64222a6aa619a932bfe9a4fa3578` |
| WIP 父提交 / Recovery 基线 | `60f3fbd169d7b43bbae3824b10b538edef4aeec1` / `8c716f64dbeb8d650c3dd87a43661ed205fdcfdd` |
| 分支 | `review/w11a-u3-fast-blocked-20261030`（GitHub 与 Gitee 同名 Review Branch 均已指向 Closure HEAD） |
| `master`（两端） | `aee1e0c13d26dd840ae4b596340212eef03479c0`（未变） |
| Release tag | `v1.6.0` / `v1.6.1` / `v1.6.2`（未变） |
| 版本 | `1.6.2`（未变） |

### 五条端到端主链闭合情况

| 主链 | 步骤齐备 | 结构完整 | 主要断点 |
|---|---|---|---|
| Order-to-Cash | 10/10 | 是 | 识别模式分支（`LEGACY_DIRECT` 的 AR 来源是 Delivery 而非 Invoice）；AR aging 不带 source 维度 |
| Procure-to-Pay | 12/12 | 否 | **Receipt Notice → Purchase Receipt 转换未接线**（`assertNoticeCompatibleWithReceipt` 无生产调用点）；`SEPARATE` 下 GRNI→Bill 为人工 |
| Plan-to-Produce | 9/9 | 是 | Planned Order → Production Instruction → Production Order 经 `production_instruction_items.planned_order_id` 与 `production_orders.production_instruction_item_id` **两跳 FK 完整可追溯**；仅指令表头不直接携带 `planned_order_id` |
| Plan-to-Outsource | 9 识别 / 4 不可达 | 否 | `outsourcing_receipt_items` 无生产写入路径；processing-fee bill 无 GL 凭证；无 `receiptNoticeId` FK |
| Record-to-Report | 7/7 | 部分 | 无 Accounting Event 层（FO58 无实现）；TB/P&L/BS 不保留 source 维度，报告终点不可回溯业务单据 |

### 当前 Release Blockers

| 标识 | 状态 | 阻塞范围 |
|---|---|---|
| `W10-INV-RISK-01` | `BLOCKS_RELEASE_ONLY` | 仅发布 |
| `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` | 冻结且发布阻塞 | 发布 |
| `LEGACY_DATA_EVIDENCE_PENDING` | 开放 | 非阻塞（外部证据依赖未解） |
| `CREDENTIAL_EXPOSURE_OPEN` | `USER_ACCEPTED / DEFERRED` | 非阻塞（**已被接受并延后，不等于风险消除**） |
| `R-U3-INV-09` | `ACCEPTED_RESIDUAL` | 非阻塞（限 Selector 精确身份过滤的已测 Collation 差异） |
| `R-U3-INV-10` | `DEFERRED_OUT_OF_SCOPE` | 阻塞受影响目标的部署/迁移 |
| `CURRENT ACCEPTANCE HARNESS DRIFT` | 开放 | Procurement 最终验收/冻结 |
| `D-2` / `D-3` / `D-4` / `D-5` | 开放设计决策 | W11-B、W11-C |

### 当前推荐的下一个工作包

**A — 项目 Git / 文档基线纠偏**（即本节，即 M0）。**已于 2026-10-31 验收通过**：
`M0_BASELINE_ACCEPTANCE_PASS`，锚点 `3e70c380eec7d34dd938a29d23dbf07227656ef1`。
理由：当前 canonical 文档陈述的仍是若干阶段之前的
状态，任何后续业务包都会基于错误基线被规划与复核；本包零回归风险、零 MySQL 依赖，且已把
两项源码级缺陷（`outsourcing_receipt_items` 无生产写入路径、processing-fee bill 无 GL 凭证）
写入待治理清单。详见 `document.md §35` 与 `solution.md §37.54.48`。

M0 验收后，**后续业务包的启动仍需各自的显式授权**；W11-A 整包验收、G-1…G-5、D-2…D-5、
历史库存完整性与全部 Release Blocker 均保持开放，采购委外 Domain 仍为 `NOT READY`。

---

## 当前主要 Gap

> 本节仍以 `document.md §22` / §35 的权威 Coverage 来源为准；下列条目为**面向下一步的深化方向**，
> 不是能力缺失的最终判定。凡与 §35 冲突，以 §35 与对应 Domain Closure 为准。


### Master & Engineering 仍保留的跨域 / deferred Gap

- Organization / Organization Scope（Multi-Organization 基线外）
- Bin / 仓位（Inventory & Warehouse 所有）
- 完整 MRP substitute 消费与完整委外执行
- 完整 APS / MES / HMI
- Mold / Mold Combination 与复杂 Auxiliary Attributes（缺原手册细节证据）

### Sales & Customer

- Credit Profile / Credit Limit / Occupancy / Credit Check / Special Approval（Wave 9 基础与 Wave 10 运行时已实现并验收冻结）；
  Wave 11 的**信用查询 / 异常历史 / 选择器 / 搜索语义已验收冻结**（W11-SEC-01、U1、U2、OVERDUE、U3），
  **尚未实施**的是信用评估基础与多评分/评级应用（W11-B / W11-C）与信用对账重算（W11-D）
- 更完整的 replacement / replenishment obligation

### Planning

- 更细粒度的时界/批量/合并策略与 APS 深化
- 替代料自动消耗策略深化
- 完整委外执行（当前只提供 OUTSOURCE 计划释放交接，不替代委外子域）
- 跨组织计划（Multi-Organization 基线外）

### Procurement & Outsourcing

- 已实现 Sourcing、Supplier Allocation / Quota、采购价格与折扣、PO Change、Receipt Notice、采购退货四分支、Procurement Scan；
- VMI business layer 已实现；自 V21 起 Inventory owner dimension **已可用**，VMI 收货 / 消耗 / 所有权转移
  统一经 `applyInventoryMutation` 落物理库存（所有权转移使用 `OWNER_CHANGE` 移动类型，
  该移动类型由库存域按 owner 身份成对记账），legacy fail-closed helper 已移除并成为 no-op
  （`server/modules/procurement-vmi.js:14-20`；`server/lib/inventory-mutation.js:43,248`）。
  **仍然开放**的是旧验收 harness 的 UAT-14 oracle 仍硬编码 409 `INVENTORY_OWNER_DIMENSION_UNAVAILABLE`
  （`scripts/acceptance/procurement-outsourcing-functional-uat.mjs:235-240`），
  即 `document.md §35.8` 的 **G-5**：修 test 还是修 contract 仍属业务决定；
- Outsourcing Order、材料发/退/补、倒冲、收货、加工费 Supplier Bill/AP、成本证据、完工退货商业贷项、差异/WIP/报表已实现；
- **历史检查点（2026-10-09）**：functional browser UAT 25/28 PASS，缺口为 authoritative Planning handoff
  consumption、Completion Receipt Notice、`OUTSOURCING_RECEIPT` Inspection。**该检查点已被后续实现取代**：
  OUT-05 / OUT-17 / OUT-18 已在源码落地，11 个采购委外真实 handler race 已有 11/11 真实 MySQL 证据。
  当前 Domain 仍未冻结，原因是 `document.md §31.11` 仍记 `NOT READY`，且存在新的验收 harness 漂移；
  详见「当前项目状态快照」的 Release Blockers；
- responsive browser matrix 为 7 surfaces × 320/390/430/680 = 28/28 PASS；disposable MySQL 8 integration/concurrency/performance gates PASS。

### Manufacturing & Quality

- Dispatch
- Operation Transfer
- 更多检验类型
- Non-conformance disposition

### Inventory & Warehouse

> Bin、Stock Status、Form Conversion、库存锁定与预留、ABC 报表的**数据模型与权威写入已实现**
> （`warehouse-bin.js`、`stock-status.js`、`inventory-form-conversion.js`、`inventory-lock.js`、
> `inventory-availability.js`、`/api/inventory-abc`）；下列为仍待闭合的部分。

- Barcode **生成与标签打印**（当前只有解析/校验/规则与绑定 CRUD）
- PDA 执行层（扫描 → 生成业务单据）与盘点扫码入口、收发货扫码校验
- Assembly / Disassembly（库存组装/拆卸）
- Bin / Stock Status / Owner Dimension / Stocktake 的 **HTTP CRUD 路由尚未登记**
  （模块存在但未被 `server/app.js` 引入）
- Inventory Age / Obsolete 等深化

### Finance Operations

- 更深的票据背书/贴现会计联动与现金预测
- 批量发票、法定电子发票及税务硬件集成（法定电子发票与税务硬件集成为 **OUT_OF_SCOPE**）
- Purchase Expense Allocation
- 多币种

> 固定资产（B3107）已按 `document.md §33.1.3` 归属 **Accounting & Analytics**，不再列入 Finance Operations。
> 付款申请、现金盘点、银行对账、Treasury 关账、到期计划与账单生命周期均已实现；仍缺 GRNI 反冲
> （设计如此）与 FO13 暂估转正式的**反冲**一半。

### Accounting & Analytics

- Smart Accounting Rule Engine
- Accounting Event / Voucher Template 深化
- Business ↔ GL Reconciliation 产品化
- Cash Flow
- Report Designer / Formula Engine
- Management Accounting / Operating Ledger / Amoeba
- 完整 Fixed Asset 生命周期（B3107 归属本 Domain，见 `document.md §33.1.3`）

### Platform

- Generic Workflow
- Workflow Definition / Instance / Node / Action
- Document Relationship
- Document Conversion
- Numbering
- Organization Scope
