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

### 36.3 M1 设计状态（已迁入待审区，未获批准）

- M1 的 **Design** 正文（`solution.md` §26.33，含 R4 / R4-5 / R4-6 / R4-6-R1 / R4-6-R2 修订）
  原始版本**只**存在于独立分支 `work/m1-r4-6-design-correction-20261101`
  （HEAD `912fd76700ff6f3ad1509eec4c9e2241c1830265`）；该分支**保持原样、未被改写**。
- **文档结构适配分支** `work/m1-design-g0-adaptation-20261101` 已把该正文**逐字**迁入
  **待审区** [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)
  （4199 行，源行范围 3960–8158）。该文件**不构成 Current Active Contract**；
  Active 的 Procurement & Outsourcing Design 仍**只有**
  [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26。
- 其当前状态为 **`PENDING_REVIEW`**：`Design PASS` **未签发**，`Implementation` **未授权**，
  13 个 Gate 的 `execution_status` **13/13 `NOT_RUN`**、`readiness_status` 为 **9 `NOT_RUN` + 4 `BLOCKED`**
  （`M1-GB03` / `M1-GC02` / `M1-GD01` / `M1-GD02`）。
- §26.33 内部的 R1 / R2 / R3 / R4 / R4-5 / R4-6 / R4-6-R1 / R4-6-R2 修订轮次
  **只是该设计自身的内部纠错**，**不等于**业务所有者已批准整个 Design。
- 本节**不复制**该设计正文；正文位置、来源 SHA 与位置说明见该待审文件抬头。
- `master` 侧的 M1 权威内容**仍只有 Requirement**：
  [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.12
  （业务所有者已于 2026-10-31 验收，标识 `M1_REQUIREMENT_ACCEPTANCE_PASS`）。
- **Active Design Promotion 未执行**：Design PASS 之后仍需**单独**执行把正文移入 `docs/design/` 的动作。

### 36.4 G0 交付状态

```text
G0_ACCEPTANCE_PASS
```

| 项 | 值 |
|---|---|
| 工作分支 | `work/g0-governance-refactor-20261101`（已快进合入本地 `master`） |
| 基线 | `master` @ `4cb8c477aa00988bbfebef905764565cdfe62b71` |
| 交付提交 | `8186e8165fbec60f60432011a118fa8eb20a76b8`（`docs(erp): 完成 G0 开发治理体系重构`） |
| 验收锚点 | `1aa753d6e72fdfb37968601d26cfdd422b794948`（`docs(erp): 登记 G0-R1 交付提交锚点`）—— 该提交**未被移动、删除或改写** |
| 变更范围 | 仅治理与文档（`AGENTS.md`、`CLAUDE.md`、`README.md`、`document.md`、`solution.md`、`docs/**`、`log/**`）；**未修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试** |
| 迁移映射 | [`docs/status/MIGRATION-MAP.md`](./MIGRATION-MAP.md) —— 143 条逐章节映射（`document.md` 58 条 + `solution.md` 85 条） |
| 完整性校验 | 83/83 与 105/105 个 H2 章节正文**逐字保留**且**各出现一次**；逐行守恒校验 0 行丢失 |
| G0 Acceptance | **已签发 `G0_ACCEPTANCE_PASS`**（2026-11-01，业务所有者）—— 记录见 [`docs/acceptance/g0-governance-acceptance-20261101.md`](../acceptance/g0-governance-acceptance-20261101.md) |

**边界**：G0 Acceptance 是**治理层**验收，**不代表**任何业务 Domain Acceptance，
**不批准** M1 Design，**不代表** ERP Release Ready，**不签发**任何 Freeze。
未运行的 FULL / HEAVY / MySQL / 浏览器验证**不得**据此声称通过。

### 36.5 G0 之后仍然开放的事项

G0 是**治理层**工作包，**不关闭任何业务 Gap**。以下全部保持 §35 记录的原状态：

- G-1…G-5（`PROJECT_STATUS.md` §35.8）；
- D-2…D-5 开放设计决策（见 [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md)）；
- M1 的 **12 项开放业务政策**：`A-P02`、`B-P01`、`B-P02`、`C-P01`、`C-P02`、`C-P03`、
  `C-P04`、`D-P01`、`D-P02`、`M1-P-02`、`M1-P-03`、`M1-P-04`；
- `A-P01` 单独处于 `OWNER_RATIFICATION_PENDING`，**不计入**上述 12 项开放业务政策；
- `M1-P-01` 的主歧义已按批准的 OUT-09 / OUT-08 规则闭合，**不得**重新列入待决项；
- `W11_A_ACCEPTANCE_PASS` 未签发；
- Procurement & Outsourcing `NOT READY`；
- 全部 Release Blockers 与 Release Readiness 未就绪；
- Accounting & Analytics 与 Platform 无 Domain Closure Requirement / Design。

### 36.6 下一步建议

1. ~~**用户审查 G0 并签发或拒绝 Acceptance**~~ —— **已完成（2026-11-01）**：
   业务所有者签发 `G0_ACCEPTANCE_PASS`（§36.4）。
2. **恢复 M1 设计审查**所需的确切条件：G0 Acceptance 通过（**已满足**）→ 用户单独授权 M1 Design 复核 →
   在受保护的独立工作区对 `work/m1-r4-6-design-correction-20261101` 做 Design 复核 →
   业务所有者裁定 §26.33.14.1 / §26.33.14.2 登记的 **12 项开放业务政策**，并单独完成
   `A-P01` 的 Owner 追认 → 才可能满足整体 Design 审批条件。各工作包的 Implementation 阻塞范围
   仍以 §26.33.15 为准；某一工作包仍 `BLOCKED` 不等于整个 Design 已获 `APPROVED`，
   Design PASS 后的 Implementation 仍须单独授权。
   **当前进度**：仅完成**文档结构适配**（把 M1 Requirement / Design 正文迁入 G0 文档结构），
   这**不是** Design 复核，**不是** Design PASS，**不是** Implementation 授权。
3. 在 M1 Design 未获批前，**不得**启动委外 / VMI 的 GL、结算、Cost Implementation。
4. 任何 `master` 推送、M1 合入 `master`、Active Design Promotion、Implementation、数据库操作、
   发布与部署，**均需单独授权**。

### 36.7 M1 文档适配分支状态（2026-11-01）

```text
M1_G0_DOCUMENT_ADAPTATION_READY_FOR_REVIEW
```

| 项 | 值 |
|---|---|
| 分支 | `work/m1-design-g0-adaptation-20261101` |
| 基线 | 本地 `master` @ `f5838eb1d13e6ae701202b5c69c90d1cf208b269`（已含 G0 四个提交 + G0 Acceptance 登记） |
| 独立工作区 | `D:/Project/VSCode/ERP系统/modern-erp-m1-adaptation` |
| 来源分支（**未改写**） | `work/m1-r4-6-design-correction-20261101` @ `912fd76700ff6f3ad1509eec4c9e2241c1830265` |

**本分支做了什么（仅文档结构）**：

1. 把 M1 `document.md §31.12` 的 Requirement 增量（6 增 / 3 删）**逐字**迁入
   [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.12 ——
   迁移后的该节与 M1 源节**逐字一致**（159 行，159 行）；
2. 把 M1 `solution.md §26.33` 的候选设计正文（4199 行）**逐字**迁入**待审区**
   [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md)；
3. 恢复 M1 的 `log/2026-10-31.md` 增量（482 行，**严格追加**）与 `log/2026-11-01.md`（790 行，全量）；
4. 更新导航与决策登记（`docs/README.md`、`docs/reviews/README.md`、`docs/design/README.md`、
   `docs/requirements/README.md`、`docs/decisions/OPEN-BUSINESS-DECISIONS.md`、根 `solution.md`）；
5. 把 `scripts/docs/check-doc-consistency.mjs` 拆成 `--mode migration` / `--mode current` 双模式。

**本分支明确**没有**做什么**：

- **没有**签发 `Design PASS`；**没有**授权 Implementation；**没有**执行任何 Gate；
- **没有**把 §26.33 提升为 Active Design（`docs/design/` 中该 Domain 的 Active 正文**仍只有** §26）；
- **没有**修改 M1 的 Requirement 业务合同、Gap 映射、Capability 归属与 13 个 Gate 定义；
- **没有**把「文档已迁移」记作「业务能力已实现」；13 个 Gate 的
  `execution_status` 仍为 **13/13 `NOT_RUN`**，`readiness_status` 仍为 **9 `NOT_RUN` + 4 `BLOCKED`**；
- **没有**批准 §26.33.14.1 / §26.33.14.2 登记的 12 项开放业务政策；`A-P01` 仍独立待追认，
  `M1-P-01` 仍保持已闭合；**没有**关闭 G-1…G-5；
- Procurement & Outsourcing 的 Domain Acceptance 仍为 **`NOT READY`**
  （`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`）；**没有任何** Domain 因此升级为 Release Ready；
- **没有**修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试；
- **远端同步事实（本次 M1-A1 修复前）**：GitHub / Gitee 的 `master` 均为
  `f5838eb1d13e6ae701202b5c69c90d1cf208b269`；GitHub / Gitee 的本 M1 适配分支均已同步至
  `9e939c3e43cf851ac834b7072b1c6b07b0306299`。
- **本次 M1-A1 修复提交尚未推送**；修复后的本地 HEAD 将领先上述远端分支 SHA。
  本 M1 适配分支仍**未合入** `master`。

### 36.8 M1-A2 验收阻断项修复状态（2026-11-01）

```text
M1_A2_ACCEPTANCE_FIX_READY
```

| 项 | 值 |
|---|---|
| 分支 | `work/m1-design-g0-adaptation-20261101` |
| 基线 | `11c28a5f9f8fa02ede371f8519fc06a8e69625eb`（M1-A2） |
| 修复范围 | 仅文档治理检查器、其正式测试、索引 helper、`AGENTS.md` N2/N7 语义与当日日志 |

本轮修复三项独立审计确认的**检查器**缺陷，**不涉及**任何业务合同、Design 或 Implementation 语义：

1. **N2 零覆盖虚假 PASS（P1）** —— 权威章节解析无法处理反引号包裹的 `` `document.md` §31 ``，
   32 个 Active 合同文件实际解析成功 0 个，且解析失败被静默跳过。修复后按
   **根全局合同 2 / README 导航 4 / 分段合同 4 / 领域合同正文 22** 显式分类判定；
   分段合同必须被 Domain 索引 README 逐字登记（数据驱动规则，非目录豁免）；
   PASS 输出必须显示实际检查文件数、解析成功数、合法例外数与重复 ID 数，**禁止零覆盖 PASS**。
2. **N7 历史临时合同漏检（P1）** —— 受治理路径集合此前只覆盖 `docs/reviews/`。
   修复后取自 anchor..target 的**真实 Git 历史**，覆盖 `docs/requirements/`、`docs/design/`、
   `docs/reviews/`；区间内创建后删除的正文同样进入审查；Rename/Move 以显式
   `--no-renames` 语义一律 Fail Closed。
3. **正式测试环境依赖（P1）** —— 测试在当前 HEAD 直接执行会因「安装 commit」为空而中止。
   修复后仅在暂存区确有 Diff 时才提交安装 commit，否则直接以 clone HEAD 为基线；
   安装按 LF 归一并固定 clone 换行，**结果与全局 `core.autocrlf` 无关**。
   测试证据的 `actual` 列改为从子进程输出与退出码解析得出。

**本轮明确没有做**：未签发 `Design PASS`、未授权 `Implementation`、未执行 Domain Acceptance、
未把 §26.33 提升为 Active Design、未关闭 G-1…G-5、未修改候选设计 4199 行正文
（SHA-256 `6234d6b0d93e527aa750061f59468f309d8fe9a1369b1f8375f46c9fc2b36fe2` 复核一致）、
未 Push / Merge / Rebase / Tag / Deploy。FULL / HEAVY / MySQL / Browser Gate 未运行，不声称通过。

### 36.9 N2 主动退役与 Linked Worktree 测试修复（2026-11-01）

```text
M1_A2_N2_RETIRED_AND_WORKTREE_FIX_READY
```

| 项 | 值 |
|---|---|
| 分支 | `work/m1-design-g0-adaptation-20261101` |
| 基线 | `30abe00b761f58555f670b84f6defec24a4bf751`（M1-A2 验收阻断项修复） |
| 决定来源 | **项目负责人决定**：正式退役 N2 的自动章节编号解析与唯一性校验 |

**N2 退役（RETIRED）**

- N2 是**经项目负责人决定主动退役**，**不是修复成功**，也**不得被标记为 PASS**。
  工具输出中以 `[RETIRED] N2 …` 呈现，既不是 PASS 也不是 FAIL。
- 退役范围：Markdown 元数据中的章节编号自动解析（单节 / 区间 / 多项声明）、
  权威章节唯一性校验、分段合同的索引登记推断。对应 helper
  `parseAuthoritySections()` / `authorityIndexRef()` / `registersFile()`
  经**零调用者检查**后删除；仅服务 N2 的 T32–T37 反向测试一并删除。
- **章节权威关系改由人工 Review 确认。**
- N2 编号**保留为历史标识**，不重新编号，避免历史记录混乱。
- **N1、N3–N9 继续有效**；`migration` 模式的 **C1–C6 完整保留**。
- 退役未以降低其他检查条件或隐藏失败的方式实现。

**Linked Worktree 测试兼容性修复**

- `server/mobile-shell.test.js` 原先硬编码 `<repoRoot>/.git/info/exclude`；
  在 linked worktree 下 `.git` 是**文件**，该路径不存在，断言以 `ENOENT` 失败。
- 改为通过 `git rev-parse --git-common-dir` 解析 **common Git directory**，
  再定位 `info/exclude`：普通 clone 指向 `<repo>/.git/info/exclude`，
  linked worktree 指向主仓库的 `.git/info/exclude`。
- 断言同步改为验证**有效忽略行为**（仓库 `.gitignore` 或 common-dir `info/exclude`
  任一处声明 `example/`，且 `git check-ignore` 必须实际判定为 ignored），
  因为 `info/exclude` 是本机配置、**不会被 clone 继承**，只有受版本控制的
  `.gitignore` 才是所有拓扑下都存在的持久机制。
- **未跳过测试、未修改全局 Git 配置、未改变测试分组、未删除 `example/` 忽略规则**；
  主仓库 `.git/info/exclude` 中的 `example/` 规则原样保留。

**本轮明确没有做**：未修改任何 Requirement / Design / 业务合同正文，
未修改 M1 候选设计 4199 行正文，未签发 `Design PASS`、未授权 `Implementation`、
未执行 Domain Acceptance、未关闭 G-1…G-5、未 Push / Merge / Rebase / Tag / Deploy、
未做任何数据库操作。FULL / HEAVY / MySQL / Browser Gate 未运行，不声称通过。

---

## 37. M1-Core 范围重定基线状态（2026-11-02）

```text
M1_CORE_REBASELINE_READY_FOR_INDEPENDENT_REVIEW
```

### 37.1 本节定位与边界

本节是 `M1-SRD-01` 范围重定基线在**项目状态表**中的**唯一增量登记**。

- 本节**不修改、不删除** §35 / §36 的任何历史结论；凡与 §35、§36 冲突，按**日期化 supersession** 处理。
- 本节**不是** Acceptance，也**不签发**任何 Acceptance / Freeze 标识。
- 本节**不关闭** §35.8 的 G-1…G-5、§35.9 的全部 Release Blockers、§36.5 列出的开放事项，
  **不**升级任何 Domain 的冻结层级，**不**改变 `PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`。
- 规范正文不在本节：本节的 Requirement / Design / Gate / 政策条目**只**给指针与状态。

### 37.2 已批准的范围决定（`APPROVED_SCOPE_DECISION`）

| ID | 内容 | 授权来源 | 日期 | 登记位置 |
|---|---|---|---|---|
| `SRD-01` | M1-Core 首期范围：采购通知/来源转换/IQC/采购入库；委外订单/BOM 用料/发退补料/Supplier WIP；委外完工通知/正式收货明细/质量门禁/合法增量倒冲/成品入库；必要的 canonical Inventory/Tracking/Valuation、数量守恒、来源追溯、事务、幂等、权限与审计。**延期**：高级跨订单/跨期 WIP、复杂倒冲差异审批、VMI 结算、委外 AP/GL 自动过账、历史会计补偿 | 业务所有者 | 2026-11-02 | [`docs/decisions/m1-core-scope-rebaseline-20261102.md`](../decisions/m1-core-scope-rebaseline-20261102.md) §2 |
| `SRD-02` | 移动端阶段划分：首期只修现有工作面的 API 调用、基本交互错误、权限与错误展示，维持 `U-REQ-01` 的有限目标；完整现场移动工作流另立工作包；不重做 MobileShell / 导航 / 视觉体系 | 业务所有者 | 2026-11-02 | 同上 §3 |
| `SRD-03` | 历史数据证据策略：只用真实可证明的历史来源、数量、身份与成本事实；不可证明数据不得推算、自动补记或默认归零；保留历史证据，只读 / 隔离 / fail closed；大规模治理与会计补偿延期 | 业务所有者 | 2026-11-02 | 同上 §4 |

**三项范围决定已批准，不等于任何业务政策已批准，也不等于 Implementation 许可。**

### 37.3 Requirement 与 Design 的当前状态

| 对象 | 位置 | 状态 | 说明 |
|---|---|---|---|
| M1 全范围 Requirement | [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.12 | **历史批准合同，保留不变** | 2026-10-31 的 `M1_REQUIREMENT_ACCEPTANCE_PASS` 仍是历史事实；首期当前效力由 §31.13 取代 |
| **M1-Core 首期 Requirement** | 同文件 **§31.13** | **`PENDING_APPROVAL`**（待业务所有者批准） | 覆盖 `MC-REQ-01..15`；含 12 条继承不变量；新批准**不自动**继承旧 `M1_REQUIREMENT_ACCEPTANCE_PASS` |
| M1 全范围候选 Design | [`docs/reviews/m1/procurement-outsourcing-critical-chain-design.md`](../reviews/m1/procurement-outsourcing-critical-chain-design.md) | `PENDING_APPROVAL` / `PENDING_REVIEW` | **保持原样、未被改写**；C / D 组延期部分与历史结论的载体 |
| **M1-Core 首期候选 Design** | [`docs/reviews/m1/procurement-outsourcing-m1-core-design.md`](../reviews/m1/procurement-outsourcing-m1-core-design.md) | `PENDING_APPROVAL` / `PENDING_REVIEW`；`Design PASS` = `NOT_ISSUED`；`Implementation` = `NOT_AUTHORIZED` | 有界后继设计：`M1C-WP-0..WP-7`、首期最小 migration 集、API 矩阵、RBAC/SoD、错误与零副作用、历史 fail-closed、SQLite/MySQL 相容 |
| Active Procurement & Outsourcing Design | [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26 | `ACTIVE` | **仍是唯一 Active Design 正文**；**Active Design Promotion 未执行** |

**两个 M1 候选并列有效、职责不同**；M1-Core 获批后才需要单独执行 Active Design Promotion。

### 37.4 M1-Core Gate（7 个）与旧 13 Gate 的处置

新 Gate：`M1C-G01` … `M1C-G07`，`execution_status` **7/7 `NOT_RUN`**，**无任何 PASS**。
逐项处置映射（旧 13 Gate → 新 Gate / `DEFERRED` / `SUPERSEDED`）见
[`docs/reviews/m1/procurement-outsourcing-m1-core-design.md`](../reviews/m1/procurement-outsourcing-m1-core-design.md) §13.2。

| 旧 Gate | 处置摘要 |
|---|---|
| `M1-GA01` / `M1-GA03` | 吸收 → `M1C-G02`（委外收货明细 + 两段式生效 + IQC） |
| `M1-GA02` | 吸收 → `M1C-G01`（采购通知 + 多 PO + 容量 + 直接入库） |
| `M1-GB01` | 吸收 → `M1C-G03`（发退补料真实库存 / 跟踪 / 估值） |
| `M1-GB02` | 吸收 → `M1C-G04`（增量倒冲 + 真实材料成本 + 成品入库） |
| `M1-GU01` | 吸收 → `M1C-G05`（移动端有限修复） |
| `M1-GB03` / `M1-GC01` / `M1-GC02` / `M1-GD01` / `M1-GD02` | **DEFERRED** → 其"危险写入必须安全拒绝且零副作用"部分由 `M1C-G06` 承接 |
| `M1-GT01` | **SUPERSEDED（缩减）** → `M1C-G07` 的 `CR-01..CR-08`（按首期实际 mutation 选取真实 Handler；核心链的真实库存 / 事务 / 幂等 / 并发验证**未被删除**） |
| `M1-GT02` | **拆分** → UAT-14 oracle 纠正（§31.12.6 D-REQ-03 的**已批准义务**）由 `M1C-G07` 承接；`OWNER_CHANGE` 独立 Handler Gate 与 UAT-20 随 VMI 结算 **DEFERRED** |

**旧 13 Gate 的状态不变**：`execution_status` 13/13 `NOT_RUN`、`readiness_status` 9 `NOT_RUN` + 4 `BLOCKED`；
**无任何旧 Gate 被伪造 PASS**。旧 13 Gate 继续作为 **M1 全域 Closure** 的验收合同；
**M1-Core 包级 Acceptance ≠ M1 全域 Closure Acceptance ≠ Domain Acceptance**。

### 37.5 政策状态

| 类别 | 条目 | 状态 |
|---|---|---|
| 已批准的范围决定 | `SRD-01` / `SRD-02` / `SRD-03` | `APPROVED_SCOPE_DECISION` |
| **Design 技术接受**（非业务政策，无需另行追认） | `A-P01` | `DESIGN_TECHNICAL_ACCEPTED` |
| Core 限定规则（**收紧方向可直接实施**；签字只在**放宽**时需要） | `A-P02`、`M1-P-02`、`M1-P-03`、`T-11`、交期上界 | `CORE_LIMITED_PENDING_OWNER` |
| 延期（待政策裁定） | `B-P01`、`B-P02`、`C-P01..C-P04`、`D-P01`、`D-P02`、`M1-P-04` | `DEFERRED_PENDING_POLICY` |

登记与逐项影响见
[`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §1.4。

**首期需业务所有者签字的具体裁定由 5 处收敛为 2 处**：
`M1-P-03`（角色**授予矩阵**）与 `M1-P-02`（**仅在希望放宽支持范围时**）。

- `A-P01`（通知物理模型）已由候选 Design **技术接受** —— §31.12.3 `A-REQ-06` 与 `A-P01` 行
  均把该项定性为**物理模型设计冲突**、裁定权属 Procurement Design；业务所有者在 §31.13
  Requirement 验收时**一次性确认**即可，**不另设独立签字项**。
- `A-P02`（复杂拒收重开与自动再转换）、`T-11`（**通知转换后取消的来源容量语义**）与
  **交期上界**（零有效交期 / 多交期不明 / 历史不可证）均按**受限行为** fail closed 实施，
  **不阻塞** `M1C-WP-1` / `M1C-G01`，也**不阻塞**任何首期工作包的代码实施。
  `T-11` **不是**"零交期政策"，两者已在政策登记中**拆分**。
- `M1-P-03` **不阻塞**代码实施，但**直接决定** `M1C-G02` 的**正向**收货生效断言能否取得证据：
  收货生效的最低安全授权是既有的 `OUTSOURCING_RECEIVING_MANAGE`，当前**无任何角色**持有
  （仅 `admin` 经 all-permissions 继承）⇒ 未决前 `M1C-G02` 只能取得拒绝路径证据，
  `execution_status` 必须保持 `NOT_RUN`。

### 37.6 本轮明确未发生的事项

- **未**修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试；
- **未**连接、重置、迁移或修改任何数据库；**未**运行任何 MySQL / 浏览器 / 业务测试 / build；
- **未**签发 Requirement 验收、Design PASS、Domain Acceptance、Capability Freeze、Release Readiness；
- **未**执行 Active Design Promotion；`docs/design/procurement-outsourcing.md` §26 仍是唯一 Active Design；
- **未**关闭 G-1…G-5、`M1-N01/N03/N04/N11` 或任何 Release Blocker；
- **未**把任何延期能力、任何旧 Gate、任何历史缺陷写成已修复或已通过；
- **未** Push / Merge / Tag / Release / Deploy；**未**改写 Git 历史；
- **未**移动、删除或重建任何 release tag。

### 37.7 下一步建议

1. **业务所有者独立审查** M1-Core Requirement（§31.13）与候选 Design
   （`docs/reviews/m1/procurement-outsourcing-m1-core-design.md`），并裁定 §37.5 的 **2 处**签字项
   （`M1-P-03` 授予矩阵、`M1-P-02` 仅在放宽时）。
2. 审查通过后**单独**执行 **Active Design Promotion**（把 M1-Core 正文移入 `docs/design/`），
   并把旧候选设计标注为**已取代**或移入 `docs/archive/`。
3. **下一个 Implementation 工作包建议**：`M1C-WP-0`（基础设施：**最小 migration 集**
   `M-01..M-07 / M-15 / M-17` + parity 断言 + `SOURCE_TYPES` 注册 +
   `SUPPLIER_BILL_MANAGE` 权限注册 + 锁序与事务守卫）——
   它是其余工作包的共同前置，且**不被**任何待签政策阻塞。
   其后按依赖并行推进 `M1C-WP-1`（采购通知转换，**不再被** `A-P01` / `A-P02` / `T-11` 阻塞）、
   `M1C-WP-2`（委外收货明细）、`M1C-WP-3`（发退补料权威 Writer）、
   `M1C-WP-4`（增量倒冲与成品入库）、`M1C-WP-5`（拒绝边界与权限分离）、`M1C-WP-6`（移动端有限修复）。
4. Implementation 的启动仍**必须**取得业务所有者的**单独**明确授权（`AGENTS.md §4.4`）；
   MySQL destructive Gate 另需**独立 disposable 数据库**与**逐次**明确授权。
5. `M1-Core` 的验收以 7 个 `M1C-Gxx` Gate 为准；`M1C-G07` 需要真实 MySQL 8 证据，
   在取得授权前**不得**声称通过；`M1C-G02` 的**正向**收货生效断言在 `M1-P-03` 裁定前
   **不得**标记通过。

### 37.8 交付锚点

| 项 | 值 |
|---|---|
| 工作分支 | `work/m1-core-rebaseline-20261102`（自 `master` @ `759d7216c7546ffa00a147f603c4e8852aada991` 新建） |
| 交付提交 | `12a6281ba408510d2fc0b15822b6b71bc3940f95`（`docs(erp): M1-Core 范围重定基线、政策处置与有界 Requirement/Design 修订`） |
| 变更范围 | 仅治理与文档（`document.md`、`solution.md`、`docs/**`、`log/2026-11-02.md`）；**未修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试** |
| 交付规模 | 12 个文件，+1302 / −4 行（新增 3 个文件：`docs/decisions/m1-core-scope-rebaseline-20261102.md`、`docs/reviews/m1/procurement-outsourcing-m1-core-design.md`、`log/2026-11-02.md`） |
| 完整性校验 | `check-doc-consistency.mjs --mode current`：**N1 / N3–N9 PASS，N2 `RETIRED`（未记为 PASS）**；`--mode migration`：**C1–C6 全部 PASS**；`git diff --check`：exit 0 |
| 远端状态 | **未** Push / Merge / Tag / Release / Deploy；GitHub `github` 与 Gitee `origin` 两端 `master` **仍为** `759d7216c7546ffa00a147f603c4e8852aada991`，本分支**未**推送 |

**边界**：本地交付提交**不等于** M1-Core Requirement 验收、**不等于** Design PASS、
**不等于** Domain Acceptance / Freeze / Release Readiness，也**不授权**任何 Implementation。
本轮**未运行**任何 FULL / HEAVY / MySQL / 浏览器 Gate，**不声称**通过。

### 37.9 M1-Core 独立审查问题定点修正（`M1C-IR2-FIX`，2026-11-02）

```text
M1C_IR2_FIX_READY_FOR_REVIEW
```

本节是 §37 的**日期化增量登记**，只记录本轮定点修正的**范围与状态**；
规范正文在 §31.13 与候选 Design，本节**不复制**正文。
本节**不**签发任何 Acceptance / Freeze / `Design PASS`，**不**授权 Implementation。

**修正的 8 项问题**（逐项差异见本轮交付报告）：

| # | 问题 | 修正落点 |
|---|---|---|
| 1 | 采购通知转换的容量合同未按业务类型分域 | §31.13 `MC-REQ-02`；候选 Design §5.1 / §5.2 / §9.1 `QTY-2` / §13.1 `M1C-G01` |
| 2 | 延期财务的防绕过未落到来源级、未覆盖共享入口 | §31.13 `MC-REQ-15`；候选 Design §9.4 / §14 `RISK-4` / §13.1 `M1C-G06` |
| 3 | `M1C-WP-1` 阻塞划分不当；`T-11` 原始含义被改写 | §31.13.3 / §31.13.4；候选 Design §2.2 / §2.3 / §15.1；本节 §37.5 |
| 4 | 加工费草稿创建与正式 POST 的边界自相矛盾 | §31.13 `MC-REQ-15`；候选 Design §7 / §9.4 |
| 5 | 未核对既有权限；未区分"可实施"与"可取证" | §31.13 `MC-REQ-10`；候选 Design §8.1 / §14 `RISK-7` / §15.2 |
| 6 | `M1C-WP-0` 纳入非首期必要的历史迁移与高风险历史修复 | 候选 Design §4.1 / §4.2 / §4.4 / §10 / §13.1 |
| 7 | `RISK-3` 现状事实错误（误称已使用 `receiveValue(value_cents=0)`） | 候选 Design §14 `RISK-3`（区分 CURRENT / TARGET） |
| 8 | Gate 的"审计全零"与 `MC-REQ-11` 的拒绝审计义务矛盾 | §31.13 `MC-REQ-11` / §31.13.5；候选 Design §9.2 / §9.3 / §13.3 |

**Gate 状态**：7 个 `M1C-Gxx` 仍**全部 `NOT_RUN`**（7/7），**无任何 PASS**；
旧 13 Gate 仍 13/13 `NOT_RUN`；`G-1..G-5`、Release Blockers、
`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 状态**均未改变**。

**本轮明确未发生**：未修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限实现
或业务测试；未连接 / 重置 / 修改任何数据库；未运行任何 MySQL / 浏览器 / 业务测试 / build；
未签发 Requirement 验收 / Design PASS / Acceptance / Freeze / Release Readiness；
未执行 Active Design Promotion；未 Push / Merge / Tag / Release / Deploy。

**交付锚点**：

| 项 | 值 |
|---|---|
| 工作分支 | `work/m1-core-rebaseline-20261102`（自 `master` @ `759d7216c7546ffa00a147f603c4e8852aada991` 新建） |
| 交付提交 | `6150daddb4c739b1a77b4a1faa2e5632d19c4f80`（`docs(erp): M1-Core 独立审查问题定点修正（容量分域、来源级防绕过、阻塞划分、权限与迁移收敛）`） |
| 变更范围 | 6 个文件，+504 / −148 行（`docs/requirements/procurement-outsourcing.md`、`docs/reviews/m1/procurement-outsourcing-m1-core-design.md`、`docs/decisions/OPEN-BUSINESS-DECISIONS.md`、`docs/decisions/README.md`、`docs/status/PROJECT_STATUS.md`、`log/2026-11-02.md`）；**未修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限实现或业务测试** |
| 完整性校验 | `check-doc-consistency.mjs --mode current`：**N1 / N3–N9 PASS，N2 `RETIRED`（未记为 PASS）**；`--mode migration`：**C1–C6 全部 PASS**；`git diff --check`：exit 0 |
| 远端状态 | **未** Push / Merge / Tag / Release / Deploy；本分支**未**推送 |

**边界**：该本地交付提交**不等于** M1-Core Requirement 验收、**不等于** Design PASS、
**不等于** Domain Acceptance / Freeze / Release Readiness，也**不授权**任何 Implementation。
本轮**未运行**任何 FULL / HEAVY / MySQL / 浏览器 Gate，**不声称**通过。

### 37.10 三项技术合同收尾修正（`M1C-TC1`，2026-11-02）

**授权与范围**：依据 `M1C-IR2-FIX` 独立审查结论，仅完成三项文档合同收尾；未修改生产代码、
schema、migration、权限种子、业务测试或 UI，未连接数据库，未运行 Gate。

| 项 | 文档修正结论 | 实施 / Gate 状态 |
|---|---|---|
| `TC-01` | “首期零历史回填”精确限定为零历史业务事实重建、零不可证明补记；`M-15` 仅可在未来取得独立 Migration 授权后，对已有明确一致身份字段做确定性技术规范化，不改变数量、归属、库存、估值、来源或状态 | **仅合同修正**；`M-15` 未执行，PRE 未运行 |
| `TC-02` | 数据库默认继续为 `converted_quantity NULL = 未证明`；权威生产 Writer 首次创建且同事务验证的新来源行显式写 0，重试不得重置非零累计量，历史 NULL 不得改写 | **仅合同修正**；`M1C-G01` 仍 `NOT_RUN` |
| `TC-03` | 普通角色未获授予不等于管理员无权限；管理员可经 all-permissions 持有权限，但 RBAC 之后仍受独立来源级 Business Policy Guard 约束，委外来源账单返回 409，未授权主体保持 403 | **仅合同修正**；`M1C-G06` 仍 `NOT_RUN` |

**保持不变**：三项 `SRD-01/02/03`、15 项 Requirement 结构、`M1C-WP-0..7`、
`M1C-G01..G07`（7/7 `NOT_RUN`）、旧 13 Gate（13/13 `NOT_RUN`）、历史 Requirement PASS、
`M1-P-02` 严格支持范围、`M1-P-03` 待业务所有者裁定、`A-P01` 技术接受边界、当前 Active Design、
全部 Domain Acceptance / Freeze / Release 状态及 `PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`。

**Review 结论（文档层）**：TC-01/02/03 的 Requirement ↔ 候选 Design ↔ Gate 表述已收敛；
没有把修正描述为已实施、已测试或 Gate PASS。是否通过最终审查仍由业务所有者决定，
且本节不签发 `M1_CORE_REQUIREMENT_ACCEPTANCE_PASS`、`M1_CORE_DESIGN_PASS` 或
`IMPLEMENTATION_AUTHORIZED`。

### 37.11 最终技术合同修正与交付审查（`M1C-TC1-RV1`，2026-11-02）

**授权与范围**：业务所有者授权对 TC-01/02/03 做最后一轮文档定点修正，并确认
`APPLY_GUIDE.md` 已过时、批准永久删除。该删除已包含在基线提交 `b8f3c6e` 中，本轮不恢复、
不重复删除、不重写历史；README 的有效操作指引已按事实收口。

| 项 | RV1 收敛结论 | 实施 / Gate 状态 |
|---|---|---|
| `TC-01` | `M-15` 只认真实 `products.tracking_policy` 与历史身份字段的严格映射；旧候选 Design 的无条件 `ELSE 'NONE'` 和“两身份为空即 NONE”对 M1-Core 明确失效；PRE-B 必须联合验证产品策略、历史身份和生成键 | 文档合同修正；未执行 M-15，未获 Migration 授权；`M1C-G03/G04/G07` 仍 `NOT_RUN` |
| `TC-02` | `createReceiptNotice()`（或其同事务私有 helper）是标准采购来源行唯一生产 Writer；多 PO `sourceAllocations` 明确标为 `NEW_DESIGN_TARGET`，与现有单 PO合同兼容；转换模块只消费来源行并累计转换量；OUTSOURCE 不复用标准采购来源表 | 文档合同修正；未修改 API/代码/schema；`M1C-G01` 仍 `NOT_RUN` |
| `TC-03` | HTTP 固定 RBAC 403 → 来源级 Policy 409；内部服务必须调用同一 Guard，但保持既有异常传播合同，不伪装 HTTP 状态；专用/共享 POST、共享 MATCH、自动开票内部链均受保护，普通采购保持合法 | 文档合同修正；未运行 Gate；`M1C-G06` 仍 `NOT_RUN` |

**状态边界**：`M1C-G01..G07` 仍 7/7 `NOT_RUN`，旧 13 Gate 状态不变；`M1-P-03`、
`M1-P-02`、`A-P01`、Active Design、Domain Acceptance、Freeze、Release Readiness 均不变。
本轮未修改生产代码、schema、migration、权限种子或业务测试；未连接数据库，未运行 MySQL、FULL、
HEAVY、浏览器 Gate 或 build；未签发 Requirement/Design PASS 或 Implementation 授权；未 Push、Merge、
Tag、Release、Deploy。交付仍等待业务所有者独立审查。

### 37.12 M1-Core Requirement / Design Acceptance 与 Active Design Promotion（2026-11-02）

**业务所有者决定**：正式签发 `M1_CORE_REQUIREMENT_ACCEPTANCE_PASS` 与
`M1_CORE_DESIGN_PASS`；确认 `A-P01` 唯一通知模型，批准 `M1-P-03` 最小角色矩阵。
Promotion 锚点为 `95aca4d60b3a168bea2355e12829bb67af18f500`；正式证据见
[`docs/acceptance/m1-core-requirement-design-acceptance-20261102.md`](../acceptance/m1-core-requirement-design-acceptance-20261102.md)。

| 对象 | 当前状态 |
|---|---|
| M1-Core Requirement | `APPROVED` / `M1_CORE_REQUIREMENT_ACCEPTANCE_PASS` |
| M1-Core Design | `ACTIVE` / `M1_CORE_DESIGN_PASS`；路径 `docs/design/procurement-outsourcing-m1-core.md` |
| `A-P01` | `DESIGN_TECHNICAL_ACCEPTED`；业务所有者已在 Requirement Acceptance 中确认 |
| `M1-P-03` | `APPROVED`；角色与权限种子尚未实施 |
| `M1-P-02` | 严格支持范围继续 fail closed；仅放宽时待裁定 |
| `A-P02` / `T-11` | 继续受限行为 |
| B/C/D 延期政策 | `DEFERRED_PENDING_POLICY` |
| `M1C-G01..M1C-G07` | 7/7 `NOT_RUN`，无 PASS |
| M1 全范围旧 13 Gate | 保持原状态（13/13 `NOT_RUN`） |
| Procurement Domain Acceptance | **未通过**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |
| Implementation | `NOT_AUTHORIZED`；不得自动启动 `M1C-WP-0` |

**边界**：M1-Core 文档合同验收不等于 Implementation、Capability Freeze、Manual Closure、
Procurement Domain Acceptance 或 Release Readiness。原 Domain Design §26 继续保留；旧 M1 全范围候选
继续承担 C/D 延期与历史追溯，未整体获批。本轮未修改生产代码、schema、migration、权限种子或测试，
未连接数据库，未运行 MySQL/FULL/HEAVY/浏览器/业务 Gate，未 Push/Merge/Tag/Release/Deploy。

> **后续状态**：`M1C-WP-0` 已于同日获独立 Implementation 授权并交付实施，见 §37.13。
> 本节表格记录的是本节事件当时的快照。

---

### 37.13 M1-Core `M1C-WP-0` 实施交付（2026-11-02）

**业务所有者决定**：正式批准 M1-Core 进入 Implementation，本次授权**仅限 `M1C-WP-0`**；
`M-15` 历史身份规范化、Migration 执行、数据库连接及修改、MySQL Gate 与
Push / Merge / Tag / Release / Deploy 均未授权。实施依据 Active Design
[`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP-0` | `IMPLEMENTED`；最小 migration 集、`SOURCE_TYPES` 注册、`SUPPLIER_BILL_MANAGE` 注册与 `M1-P-03` 角色种子均已落地 |
| `M1-P-03` 角色与权限种子 | 已实施（`role-outsourcing` / `role-outsourcing-receiving`；`SUPPLIER_BILL_MANAGE` 只授予 `role-accounting`）；**两个委外角色当前无任何用户绑定** |
| `M-15` 历史身份规范化 | 未执行；仍需独立 Migration 授权 |
| Migration 实测 / MySQL | 未执行；本次 DDL 只在测试临时库中随既有建库链路跑通 |
| `M1C-G01..M1C-G07` | 7/7 `NOT_RUN` |
| M1-Core Requirement / Design | 保持 `APPROVED` / `ACTIVE`，本次未修改 |
| Procurement Domain Acceptance | **未通过**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |

**门禁证据**：`pnpm test:fast` 506/506、`pnpm test`（FULL）3110/3110、`pnpm build`、
`git diff --check`、`node scripts/docs/check-doc-consistency.mjs`（current 模式）全部通过。

**边界**：WP-0 交付后 Implementation HARD STOP，等待下一工作包授权。本次未修改已批准的
Requirement / Design，未连接或修改项目数据库，未运行 MySQL / HEAVY / 浏览器 / 业务 Gate，
未 Push / Merge / Tag / Release / Deploy。

**未解决矛盾**：委外角色种子的工作包归属，以及 `OUTSOURCING_MANAGE` 过宽带来的暂时性 SoD 敞口，
须由业务所有者裁定；详见当天 `log/2026-11-02.md` 的 `M1C-WP0-IMPL-20261102` 节。

---

### 37.14 M1C-WP0-R1 安全修复与静态合同补齐（2026-11-02）

**业务所有者决定**：批准 `M1C-WP0-R1` 作为 M1C-WP-0 独立验收前的限定修复，依据
`WP0_INDEPENDENT_READ_ONLY_REVIEW_COMPLETE`。不改变已批准的 Requirement / Active Design /
`M1-P-03`，不代表 WP-1～WP-7 获得实施许可。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP0-R1` | `IMPLEMENTED`，等待独立验收；7 个 Gate 仍 `NOT_RUN` |
| 委外加工费来源级 Guard | 已实施（`MC-REQ-15` / §9.4）：委外来源账单的正式过账与匹配一律 409 `OUTSOURCING_GL_POLICY_NOT_APPROVED`，管理员无豁免，零 AP/凭证/成本证据写入，拒绝审计恰好一条 |
| 加工费正式过账 RBAC | 只认 `SUPPLIER_BILL_MANAGE`；草稿创建保留原定权限语义 |
| 收货生效权限 | 只认 `OUTSOURCING_RECEIVING_MANAGE`（`OUTSOURCING_MANAGE` 回退已移除）；收货录入与材料执行未受影响 |
| 委外角色种子 | 已按 §2.3 / §8.1.3 移出 WP-0；角色注册表回到规范 5 角色，待 WP-2 授权后实施 |
| WP-0 Schema parity | 已补齐离线双端成员集合断言（列/类型族/NULL/default/PK/UNIQUE/索引/FK/CHECK + 增量路径）；真实 MySQL 接受性仍 `NOT_RUN` |
| `M-15` / Migration 实测 / MySQL Gate | 未执行 |
| `M1C-G01..M1C-G07` | 7/7 `NOT_RUN` |
| Procurement Domain Acceptance | **未通过**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |

**门禁证据**：`pnpm test:fast` 510/510、`pnpm test`（FULL）3138/3138、`pnpm build`、
`git diff --check`、文档一致性 current 模式全部通过。

**遗留**：MC-REQ-11 要求的 **403 拒绝审计**在全应用范围仍未实现（`server/lib/http.js` 的
`allow()` / `allowAny()` 不写审计），补齐需独立授权。

**边界**：本轮未修改已批准的 Requirement / Design，未连接或修改项目数据库，未运行 MySQL /
HEAVY / 浏览器 / 业务 Gate，未 Push / Merge / Tag / Release / Deploy。详见当天
`log/2026-11-02.md` 的 `M1C-WP0-R1-IMPL-20261102` 节。

---

### 37.15 M1C-WP-0 / WP0-R1 Implementation 验收登记（2026-11-02）

**业务所有者决定**：将已通过独立审查的 `M1C-WP-0` Implementation 正式登记为 PASS；
本次验收锚点 `e032fa01ad35379c33726a038ef05c55267f216e`，验收范围**仅限 `M1C-WP-0` 与
`M1C-WP0-R1`**。同一次决定正式授权 `M1C-WP-1` 进入 Implementation。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP-0` | `IMPLEMENTED` + **Implementation PASS**（锚点 `e032fa01ad35379c33726a038ef05c55267f216e`） |
| `M1C-WP0-R1` | `IMPLEMENTED` + **Implementation PASS**（同上锚点） |
| 验收覆盖范围 | **仅**：最小 migration 集、`SOURCE_TYPES` 注册、`SUPPLIER_BILL_MANAGE` 注册与 `M1-P-03` 角色种子收口、委外加工费**来源级**拒绝守卫、收货生效权限隔离、双端 Schema parity **静态**断言 |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；本次验收**不**签发任何 Gate PASS |
| `M-15` 历史身份规范化 | **DEFERRED**；仍需独立 Migration 授权，本轮未执行，PRE 未运行 |
| MySQL Gate | **NOT_RUN**；真实 MySQL 接受性未取得，WP-0 parity 断言仍为离线静态断言 |
| Migration 实测 | **NOT_RUN**；本次 DDL 只在测试临时库中随既有建库链路跑通 |
| Procurement Domain Acceptance | **NOT_ISSUED**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |
| Release / Deploy | **NOT_AUTHORIZED**；未 Push / Merge / Tag / Release / Deploy |
| Capability Freeze / Manual Closure | 未签发；§31.12.9 的旧 13 Gate 仍 **13/13 `NOT_RUN`** |

**明确边界**：本条 PASS **不是**整个 M1-Core 的 PASS，也不是 `M1C-G01`～`M1C-G07` 中任何一个
Gate 的 PASS。M1-Core 包级 Acceptance 仍以 7 个 `M1C-Gxx` Gate 为准；M1 全范围 Closure 仍以
§31.12.9 的 13 个 Gate 为准。

**遗留**：MC-REQ-11 的 **403 拒绝审计**在全应用范围仍未实现（`server/lib/http.js` 的
`allow()` / `allowAny()` 不写审计），补齐由 `M1C-WP-5` 统一处理；在取得完整证据前，
不得声明相关正式 Gate 已满足全部拒绝审计合同。

---

### 37.16 M1-Core `M1C-WP-1` 实施交付（2026-11-02）

**业务所有者决定**：正式授权 `M1C-WP-1` 进入 Implementation，授权范围**仅限** Active Design
§2.3 / §5.1 / §5.2 / §6 / §7 / §9 / §13.1 的 WP-1 内容；`M1C-WP-2..WP-7` 未获授权。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP-1` | `IMPLEMENTED`，**等待独立审查**；对应 Gate `M1C-G01` 的 `execution_status` 仍 `NOT_RUN` |
| 行级来源 Writer | `createReceiptNotice()` 是标准采购来源行的**唯一**生产 Writer：同一事务写表头 / 明细 / 已验证来源行，新来源行**显式** `converted_quantity=0` |
| 多 PO 输入 | `items[].sourceAllocations[]`（`purchaseOrderItemId` + 可选 `deliveryScheduleId` + `allocatedQuantity`）；兼容单 PO 输入归一化为同一权威来源模型；与旧字段表达冲突事实时拒绝 |
| 分域容量解析 | `STANDARD_PURCHASE` = 通知行 × 供料 PO 行 × 交期与容差；`OUTSOURCE` = 通知行 × 委外订单剩余可收量；`confirmReceiptNotice()` 与转换流程**共用**同一实现，两类不得互相套用 |
| E-06 修复 | 委外通知确认的容量口径已修复：本次待确认数量计入**一次且仅一次**（原实现以仅汇总 `CONFIRMED` 的值减去仍是 `DRAFT` 的本通知数量，导致本次数量完全未进入上限比较） |
| 转换模块 | `server/modules/procurement-notice-conversion.js`（唯一 owner）+ `POST /api/receipt-notices/:id/convert`；只读既有来源行、复用既有采购入库引擎、来源累计量与转换成功同处一个权威事务 |
| 交期消费台账 | `schedule_consumption_effects` 是交期容量的**唯一**权威来源；正向消费与负向冲销分离；旧累计字段 `received_quantity` 在首期不写入，避免双重扣减 |
| 直接 PO → 采购入库 | 保持合法；其 IQC / 跟踪 / 估值 / AP / 凭证副作用无回归；草稿入库单的容量仍在确认时封顶 |
| 拒绝审计 | WP-1 自有的 409 业务门禁拒绝**恰好 1 条**且在业务事务之外提交；400 格式错误不写审计 |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；本轮**未**执行任何 Gate，`M1C-G01` 仅达到 READY_FOR_GATE |
| `M-15` / Migration 实测 / MySQL Gate | `DEFERRED` / `NOT_RUN` / `NOT_RUN` |
| Procurement Domain Acceptance | **NOT_ISSUED**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |
| Release / Deploy | **NOT_AUTHORIZED** |

**门禁证据**：`pnpm test:fast` 510/510、`pnpm test`（FULL）3163/3163、`pnpm build`、
`git diff --check`、文档一致性 current 模式（N1 / N3–N9 全部 PASS，N2 已退役）全部通过。
新增 focused 套件 `server/m1c-wp1-procurement-notice-conversion.test.js`（25 例，登记入 FULL）。

**首期范围内的关键实现决定**（详见当天 `log/2026-11-02.md` 的 `M1C-WP1-IMPL-20261102` 节）：
交期台账为交期容量唯一权威来源；交期消费 effect 在入库单创建时登记、取消草稿时以负向
effect 冲销；转换产生**草稿**采购入库单（默认来料检验规则要求入库单先存在并完成 IQC 判定，
库存 / 估值 / 财务效力仍在既有确认环节产生）；由收料通知转换的入库单禁止 `PATCH`；
转换要求显式 `Idempotency-Key`；标准采购通知必须携带可证明的交期（`MC-REQ-02` 的明确后果）。

**遗留 / 未解决矛盾**：
- MC-REQ-11 的 **403 拒绝审计**在全应用范围仍未实现（由 `M1C-WP-5` 处理）；在取得完整证据前，
  不得声明相关正式 Gate 已满足全部拒绝审计合同。
- `M1C-G01` 的正向证据要求生产 API 造数、SQLite / MySQL 对等与并发 Handler 证据，
  本轮**未**运行，也**未**取得真实 MySQL 证据。
- 采购入库单的 `PATCH`（草稿改单）仍沿用既有的宽松剩余量口径，仅对**由收料通知转换而来**
  的入库单整体拒绝；该路径的收紧不在 WP-1 授权范围内。

**边界**：本轮未修改已批准的 Requirement / Active Design，未连接或修改项目数据库，
未执行 Migration，未运行 MySQL / HEAVY / 浏览器 / 业务 Gate，未 Push / Merge / Tag /
Release / Deploy。**WP-1 完成后 HARD STOP**，等待独立审查与下一工作包授权。

---

### 37.17 M1-Core `M1C-WP1-R1` 交期台账与采购入库草稿 PATCH 一致性修复（2026-11-02）

**业务所有者决定**：独立代码审查发现 P1 缺陷（WP-1 新交期台账与既有直接采购入库 PATCH
路径之间的一致性缺陷，当前状态 `M1C_WP1_INDEPENDENT_REVIEW_HOLD_P1_SCHEDULE_PATCH`），
批准一次**严格限定范围**的 `M1C-WP1-R1` 修复。修复范围**仅限**该一致性缺陷。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP1-R1` | `IMPLEMENTED`，**等待独立审查**；`M1C-WP-1` 的 Implementation PASS **未**签发 |
| 原 P1 缺陷 | PATCH 重建明细（明细身份改变）后，既不冲销旧正向 Effect、也不登记新 Effect → 台账与单据数量、明细身份脱节，且取消可能冲销失败 |
| 修复方式 | 事务内**原子重新绑定**：重读旧明细与未冲销 Effect → canonical 容量解析器复核 → 旧 Effect 写入不可变负向冲销 → 唯一 Writer 重建明细与质量 / 跟踪快照 → 新明细登记新的正向 Effect → 校验按交期分组的台账净额等于重建数量；任一失败整体回滚 |
| 冲销幂等 | `recordScheduleConsumptionReversal()` 按**原始 Effect** 幂等：已冲销的 Effect 不会被二次释放 |
| 取消释放范围 | `cancelPurchaseReceiptCore()` 释放该入库单**全部**尚未冲销的正向 Effect，PATCH 之后取消也能完整释放容量 |
| 确认容量复核 | `confirmPurchaseReceiptCore()` 补齐**交期容量**复核，聚合消费不得越过交期上限 |
| 直接 PO 草稿编辑能力 | **保留**：既有 `PATCH /api/purchase-receipts/:id` 仍然可用（响应合同不变），仅改为原子重新绑定 |
| 由收料通知转换的入库单 | 仍**禁止** PATCH（来源行与交期预留为不可变事实） |
| 拒绝审计 | PATCH 的业务门禁拒绝**恰好 1 条**且在业务事务之外提交；400 格式错误不写审计 |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；本轮**未**执行任何 Gate |
| `M-15` / Migration 实测 / MySQL Gate | `DEFERRED` / `NOT_RUN` / `NOT_RUN` |
| Procurement Domain Acceptance | **NOT_ISSUED**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |
| Release / Deploy | **NOT_AUTHORIZED**；本轮**未** Push（该批提交已在 `M1C-WP1-R1-PUSH-20261102` 轮次推送） |

**缺陷复现**：新增 `server/m1c-wp1-r1-schedule-patch.test.js`（A–G 共 7 例，登记入 FULL）。
**修复前 7 例中 6 例失败**：PATCH 改数量后净交期消费仍为旧值；PATCH 后取消只产生 1 条
负向 Effect；数量不变的 PATCH 仍留下孤立正向占用；PATCH 完全未被容量拒绝（可用陈旧台账
突破交期上限）。

**独立发现（仅报告，本轮未修）**：`resolveOutsourcingOrderCapacity()` 把「存在 IQC 记录」
当作委外历史收货的效力证据，未区分「存在质检记录」与「已完成有效质量判定」；尚未完成的
检验记录也会让历史收货被判定为「已生效已确认」，而非 Active Design §10 / `MC-REQ-12`
要求的「历史未证实 → fail closed」。建议后续收紧为「已完成且结果有效（PASS / WAIVED）的
质量判定」。另：采购**退货**路径不参与交期台账（退货不释放交期预留），影响方向为保守
（可用容量偏小），属既有能力、不在 WP-1 / R1 范围。

**门禁证据**：`pnpm test:fast` 510/510、`pnpm test`（FULL）3170/3170、`pnpm build`、
`git diff --check`、文档一致性 current 模式（N1 / N3–N9 全部 PASS，N2 已退役）全部通过。
新增 focused 套件 `server/m1c-wp1-r1-schedule-patch.test.js`（A–G 共 7 例，登记入 FULL）。

**边界**：本轮未修改已批准的 Requirement / Active Design，未连接或修改项目数据库，
未执行 Migration，未运行 MySQL / HEAVY / 浏览器 / 业务 Gate，未 Push / Merge / Tag /
Release / Deploy。**R1 完成后 HARD STOP**，等待独立审查与下一工作包授权。

---

### 37.18 M1-Core `M1C-WP1-R2` 委外历史收货效力证据 Fail-Closed 修复（2026-11-02）

**业务所有者决定**：WP-1 独立审查确认一个剩余合同问题 —— `resolveOutsourcingOrderCapacity()`
把**任意存在**的 `iqc_inspections` 记录都当作委外历史收货已生效的证明，未区分「存在质检
记录」与「已完成有效质量判定」。业务所有者批准一次**严格限定范围**的 `M1C-WP1-R2` 修复，
修复范围**仅限**该效力判定及其必要测试。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP1-R2` | `IMPLEMENTED`，**等待独立审查**；`M1C-WP-1` 的 Implementation PASS **未**签发 |
| 修复提交 | `c013b8dbe7d59a725194ce2396eb786d13622891`（`fix(erp): 收紧委外历史收货效力证据为已完成且有效的质量判定`） |
| 原缺陷 | `iqc_inspections.status` 默认 `PENDING`、`result` 完成前为 NULL，一张**未完成**的检验记录也让历史收货被判为「已生效已确认」，而非 Active Design §10 / `MC-REQ-12` 要求的「历史未证实 → fail closed」 |
| 修复方式 | 质量判定证据收紧为「**已完成**（`status='COMPLETED'`）且**结果有效**（`result IN ('PASS','WAIVED')`），并满足 canonical 有效质量门禁语义（`deriveQualityState` 为 `PASS` / `WAIVED`）」；`DRAFT` / `PENDING` / `CANCELLED` / 已完成 `FAIL` / 失效判定一律不成立 |
| 未改动的证据分支 | 库存流水 / 估值流水 / 成本证据三类分支**未改动** → 已存在真实权威库存或估值证据的合法历史收货**不被误伤** |
| 拒绝合同 | 不可证明的历史收货 → 创建与确认 OUTSOURCE 通知均精确 409 `RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN`；业务事实零变化，拒绝审计**恰好 1 条**（事务之外提交） |
| 历史数据 | 未改写任何历史数据，未虚构历史来源明细 |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；本轮**未**执行任何 Gate |
| `M-15` / Migration 实测 / MySQL Gate | `DEFERRED` / `NOT_RUN` / `NOT_RUN` |
| Procurement Domain Acceptance | **NOT_ISSUED**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |
| Release / Deploy | **NOT_AUTHORIZED**；本轮**未** Push（该批 2 个提交已于 §37.20 双远端推送） |

**缺陷复现**：新增 `server/m1c-wp1-r2-outsourcing-receipt-effect-evidence.test.js`
（A–I 共 10 例，登记入 FULL）。**修复前 10 例中 6 例失败**（`PENDING` / `DRAFT` /
`CANCELLED` / 已完成 `FAIL` 四类检验记录均让通知创建错误返回 201；历史变为不可证后确认
通知错误返回 200；零副作用与拒绝审计断言不成立）。

**门禁证据**：R2 focused **10/10**、WP-1 focused **25/25**、R1 focused **7/7**、
委外相关回归 **44/44**、`pnpm test:fast` **510/510**、`pnpm test`（FULL）**3180/3180**
（基线 3170 + 新增 10 例）、`pnpm build`、`git diff --check`、文档一致性 current 模式
（N1 / N3–N9 全部 PASS，N2 已退役）全部通过。

**遗留 / 未解决矛盾**：
- **质量判定不等于库存效力**：本轮按 Active Design §10 的证据清单保留「已完成且有效的质量
  判定」为独立证据类型，因此**仅有**一条已完成 `PASS` / `WAIVED` 检验记录、而没有任何
  库存 / 估值 / 成本流水的历史收货，仍被判为「已生效已确认」。现有质量记录结构本身无法
  独立证明库存效力 —— 该**残余边界**如实登记，未自行推导。生产链路下真正生效的收货同时
  具备库存流水与成本证据，故该边界只影响「生效动作未落库存」的历史数据。若要求进一步
  收紧（质量判定只作必要条件、不得单独成立），属合同变更，须走 Requirement / Design。
- **旧列 `receipt_id` 的检验记录未被采信**：canonical 判别列是
  `iqc_inspections.outsourcing_receipt_id`；经旧版路径建立、只写 `receipt_id` 的历史检验
  记录不构成质量判定证据，此类收货只能由库存 / 估值 / 成本证据证明。方向为 fail closed。
- **观察（本轮未修，不在 R2 授权范围）**：OUTSOURCE 通知**创建**路径的容量越界抛普通
  `HttpError(409)`（序列化后 `code='BUSINESS_RULE_BLOCKED'`），**确认**路径使用精确
  `RECEIPT_NOTICE_CAPACITY_EXCEEDED`；两处错误码不一致，留待下一工作包裁定。
- MC-REQ-11 的 **403 拒绝审计**在全应用范围仍未实现（由 `M1C-WP-5` 处理）。

**边界**：本轮未修改已批准的 Requirement / Active Design，未连接或修改项目数据库，
未执行 Migration，未运行 MySQL / HEAVY / 浏览器 / 业务 Gate，未 Push / Merge / Tag /
Release / Deploy。**R2 完成后 HARD STOP**，等待独立审查与下一工作包授权。

---

### 37.19 M1-Core `M1C-WP1-FINAL-CLOSEOUT` OUTSOURCE 通知容量拒绝错误码收口（2026-11-02）

**业务所有者决定**：WP-1 范围内最后一项明确的错误码合同偏差 —— OUTSOURCE 通知**创建**时
容量越界抛普通 `HttpError(409)`，错误码不是 Active Design §9.3 规定的
`RECEIPT_NOTICE_CAPACITY_EXCEEDED`。业务所有者批准一次**最小**修复（仅错误码收口 +
回归测试，不含功能扩展）。

| 对象 | 当前状态 |
|---|---|
| `M1C-WP1-FINAL-CLOSEOUT` | `IMPLEMENTED`，**等待审查**；`M1C-WP-1` 的 Implementation PASS **未**签发 |
| 修复提交 | `99f0bc7b9e74c99293ca78ba51145c6b880f479b`（`fix(erp): 收口 OUTSOURCE 通知创建容量越界的精确错误码`） |
| 缺陷 | `server/modules/procurement-receiving.js::createReceiptNotice()` 的 OUTSOURCE 容量越界分支抛普通 `HttpError(409)`，序列化后 `code='BUSINESS_RULE_BLOCKED'` |
| 修复 | 改为项目既有标准业务错误构造 `noticeBusinessError(NOTICE_ERROR_CODES.CAPACITY_EXCEEDED, ...)`；数量计算、事务边界、历史 fail-closed 行为与错误消息语义**全部不变** |
| 两类拒绝不混淆 | `RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN`（历史效力不可证明）与 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`（容量越界）仍是两个互不混淆的拒绝类别 |
| 已有测试覆盖 | 创建路径的精确码此前**无覆盖**（WP-1 B2 只断言 409）→ 在既有 WP-1 文件补充精确码 + 逐表零副作用 + 审计条数与 detail 断言；R2 文件的 `notEqual` 收紧为精确 `equal`；STANDARD_PURCHASE 的容量 / 交期错误码断言未改动 |
| 缺陷复现 | 先补断言后修复：以 `git stash` 只回退实现，WP-1 focused **25 例中 1 例失败**（`expected 'RECEIPT_NOTICE_CAPACITY_EXCEEDED'` / `actual 'BUSINESS_RULE_BLOCKED'`） |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；本轮**未**执行任何 Gate |
| `M-15` / Migration 实测 / MySQL Gate | `DEFERRED` / `NOT_RUN` / `NOT_RUN` |
| Procurement Domain Acceptance | **NOT_ISSUED**；`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY` 不变 |
| Release / Deploy / Push | **NOT_AUTHORIZED**；本轮**未** Push / Merge / Rebase / Reset / Amend / Tag / Release / Deploy（该批 2 个提交已于 §37.20 双远端推送） |

**门禁证据**：WP-1 focused **25/25**、R2 focused **10/10**、R1 focused **7/7**、委外相关回归
**44/44**、`pnpm test:fast` **510/510**、`pnpm test`（FULL）**3180/3180**、`pnpm build`、
`git diff --check`、文档一致性 current 模式（N1 / N3–N9 全部 PASS，N2 已退役）全部通过。

**遗留 / 未解决矛盾**：
- **R2 的残余边界不变**：质量判定不等于库存效力（仅有已完成 `PASS` / `WAIVED` 检验记录、
  无库存 / 估值 / 成本流水的历史收货仍被判为已生效）；旧列 `receipt_id` 的检验记录未被采信。
  本轮**未**触碰 R2 的历史质量证据策略。
- MC-REQ-11 的 **403 拒绝审计**在全应用范围仍未实现（由 `M1C-WP-5` 处理）。
- 两端远端分支 HEAD 在本轮结束时仍为 `173c8fc23a22d852bed2aa21270638604c005868`，本地新增提交当轮**未 Push**（该批提交已于 §37.20 双远端推送）。

**边界**：本轮未修改已批准的 Requirement / Active Design，未连接或修改项目数据库，
未执行 Migration，未运行 MySQL / HEAVY / 浏览器 / 业务 Gate，未 Push / Merge / Tag /
Release / Deploy，未进入 WP-2～WP-6。**完成后 HARD STOP**，等待审查与下一工作包授权。

---

### 37.20 M1-Core `M1C-WP1-R2` 与 `FINAL-CLOSEOUT` 双远端推送（2026-11-02）

**业务所有者决定**：本轮指令「将这两次的更改都提交到两个远端」构成 AGENTS.md §11.5 的
**显式 Push 授权**。授权范围**仅限**当前工作分支的正常快进推送，覆盖本轮两次交付
（`M1C-WP1-R2`、`M1C-WP1-FINAL-CLOSEOUT`）共 4 个提交。

| 对象 | 当前状态 |
|---|---|
| 推送范围 | 仅分支 `work/m1-core-rebaseline-20261102`，快进 `173c8fc..793a875`，**两端一致** |
| 两端分支 HEAD | `github` 与 `origin` 均为 `793a8753744e3f46770df70cf096f8693962f9b5`；`--left-right --count` 两端均 `0 0` |
| 推送内容 | `c013b8d` R2 修复 · `a7fbe45` R2 交付登记 · `99f0bc7` 错误码收口修复 · `793a875` 错误码收口交付登记 |
| Tag 保护 | 使用**显式 refspec + `--no-tags`**，只写分支 ref；推送后复核两端 tag 集合**未变**（GitHub 仍 3 个、Gitee 仍 29 个），**未新增 / 移动 / 删除任何 tag** |
| 两端 `master` | 均保持 `759d7216c7546ffa00a147f603c4e8852aada991` **未变**；**未 Merge** |
| Git 历史 | 纯快进，**未 Force Push / Rebase / Reset / Amend / 改写历史** |
| `package.json` version | `1.6.2` **未变** |
| Release / Deploy / Migration | **NOT_AUTHORIZED**；本轮**未**执行 |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；本轮**未**执行任何 Gate |

**门禁证据**：WP-1 focused **25/25**、R2 focused **10/10**、R1 focused **7/7**、委外相关回归
**44/44**、`pnpm test:fast` **510/510**、`pnpm test`（FULL）**3180/3180**、`pnpm build`、
`git diff --check`、文档一致性 current 模式（N1 / N3–N9 全部 PASS，N2 已退役）全部通过。

**遗留 / 未解决矛盾**：
- **两端 release tag 集合仍不一致（既有差异，本轮未处理）**：GitHub 3 个
  （`v1.6.0` / `v1.6.1` / `v1.6.2`），Gitee 29 个。补齐属 **Tag 写操作**，需单独授权。
- **R2 的残余边界不变**：质量判定不等于库存效力；旧列 `receipt_id` 的检验记录未被采信。
- MC-REQ-11 的 **403 拒绝审计**在全应用范围仍未实现（由 `M1C-WP-5` 处理）。
- **未签发** WP-1 Implementation PASS；未签发 Domain Acceptance、Capability Freeze、
  Manual Closure 或 Release Readiness。

**边界**：本轮只做 Git 交付与交付登记，未修改已批准的 Requirement / Active Design，
未连接或修改项目数据库，未执行 Migration，未运行 MySQL / HEAVY / 浏览器 / 业务 Gate，
未 Merge / Tag / Release / Deploy，未进入 WP-2～WP-6。**HARD STOP**，等待独立审查与下一
工作包授权。

---

### 37.21 M1-Core `M1C-WP-1` Implementation 验收登记（2026-11-02）

业务所有者于 2026-11-02 在本轮指令中正式签发 `M1C_WP1_IMPLEMENTATION_PASS`。验收证据见
[`docs/acceptance/m1-core-wp1-implementation-acceptance-20261102.md`](../acceptance/m1-core-wp1-implementation-acceptance-20261102.md)。

| 项 | 当前状态 |
|---|---|
| 验收范围 | 仅 `M1C-WP-1` Implementation |
| 功能收口锚点 | `793a8753744e3f46770df70cf096f8693962f9b5` |
| 登记前实际分支锚点 | `a5847fbdb23a26199ab2854221559e8b68907fcb` |
| 远端分支 | GitHub / Gitee 的 `work/m1-core-rebaseline-20261102` 均为 `a5847fbdb23a26199ab2854221559e8b68907fcb` |
| 已有证据 | WP1 25/25、R2 10/10、R1 7/7、委外相关 44/44、FAST 510/510、FULL 3180/3180、Build / diff-check / 文档一致性通过 |
| `M1C-G01` | `NOT_RUN`；本登记**不**签发 Gate PASS |
| 更高层验收 | 未签发 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness |
| 未执行 | MySQL / HEAVY / 浏览器 Gate、数据库连接或修改、Migration、Push / Merge / Tag / Release / Deploy |

`M-15` 保持 `DEFERRED`。本登记只确认既有 WP1 Implementation 交付，不改写 Requirement / Active Design，
不改变 R2 残余边界，也不替代后续独立 Gate 验收。

### 37.22 加工费 PO R1 Active Design Promotion（`M1C-D-PO01`，2026-11-03）

业务所有者在本轮指令中明确批准 `M1C-PO-P01`、`M1C-PO-P02`、最小来源 UNIQUE
索引及 R1 其余技术合同。候审来源为
`docs/reviews/m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md`
@ `627559c6032d9ec0adb2740a38e41a16b168dd59`；批准内容已精确融合至唯一 Active Design
`docs/design/procurement-outsourcing-m1-core.md`。

| 项 | 当前状态 |
|---|---|
| Design Promotion | `APPROVED / PROMOTED` |
| `M1C-PO-P01` | `APPROVED`：有界非创建人商业修改/提交；独立审批与来源不可变保持 |
| `M1C-PO-P02` | `APPROVED`：同源终身唯一；CANCEL、重建、Change ADD/MODIFY 拒绝 |
| UNIQUE 方案 | `APPROVED_DESIGN`：`purchase_orders(source_outsourcing_order_id)`；实施前历史冲突预检 |
| Implementation | `NOT_AUTHORIZED / NOT_STARTED_BY_THIS_PROMOTION` |
| Gate | `M1C-G01..G07` 全部保持 `NOT_RUN`；未签发任何 PASS |
| 数据库 | 未连接、未执行 migration、未运行 MySQL Gate |

**N7 继承性证据**：Promotion 前现场执行
`node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD --only N7` 返回 FAIL：

- `171ade577bad` 未引用 `docs/status/PROJECT_STATUS.md §37.21` 或完整路径；
- `4403a80d2543` 修改 `docs/reviews/README.md` 元数据/文件头但提交信息缺完整路径；
- `4403a80d2543` 新增候审 Design，但提交信息缺该完整路径。

该 FAIL 来自已推送历史提交，未改写历史、未修改 checker、未降低标准，也未记为 PASS。
它不指向本次 Promotion 的语义冲突或文件缺失，因此登记为继承性治理债务；本次提交必须在
提交信息中列明全部受治理路径，且最终报告继续保留该 FAIL。Design Promotion 完成后
**HARD STOP**，等待单独 Implementation 授权。

### 37.23 M1C-WP2–WP6 Implementation 交付（`M1C-IMPL-20261103`，2026-11-03）

**授权与范围**：业务所有者通过本轮 Session Handoff 明确授权恢复并完成 `M1C-WP-2..WP-6`
Implementation、既有套件合同适配、全量门禁、本地提交与状态登记。起始分支为
`work/m1-core-rebaseline-20261102`，起始 HEAD `a059d96e13f6e7c0a8c2ebb1b1ce092c92ce2b7c`；
既有工作树全部保留并续做，未 reset / clean / stash / rebase 或覆盖。

| 项 | 当前状态 |
|---|---|
| Implementation | `IMPLEMENTED / AWAITING_INDEPENDENT_REVIEW`；**未签发 Implementation PASS** |
| M1-P-03 角色与拒绝审计 | `eb4ff58180402ce254d0bfb171eebfba08671cf9` |
| 加工费 PO 正式生产路径 | `3566aae60d2d77669e00e8bd8449bd30dd663f43` |
| WP2–WP5 委外收货、材料、倒冲与延期拒绝 | `09afd37bee0373f4b3a7932612de57daa7439c6e` |
| WP6 前端 API 与响应式验收脚本 | `a059d96e13f6e7c0a8c2ebb1b1ce092c92ce2b7c` |
| 既有套件迁移与容量口径修正 | `f5abbe31664e93ee3a49598a9efc5f3f5e6eb774` |
| `M1C-G01..M1C-G07` | **7/7 `NOT_RUN`**；未签发任何 Gate PASS |
| 数据库 / Migration / MySQL | 未连接项目数据库；未执行项目 migration 或 `M-15`；未运行 MySQL Gate |
| 外部交付 | 未 Push / Merge / Tag / Release / Deploy；WP7 未执行 |

**实施证据**：加工费 PO 已通过生产 API 完成“创建草稿 → 提交 → 独立审批 → OUTSOURCE
完工通知 → CONFIRMED → 表头与正式明细原子收货”链；同一委外订单的 PO 终身唯一由
`purchase_orders(source_outsourcing_order_id)` UNIQUE 方案和 canonical Writer 双层约束。
委外收货两段式生效、已批准 OUTSOURCE BOM 快照、材料 canonical 库存/估值 Writer、增量倒冲、
成品入库、职责分离、延期危险写入 409 拒绝与 403/409 拒绝审计均已落地。委外通知容量依据
Active Design §5.2.2 与 `MC-REQ-02/09` 净除已由通知行收货的数量，避免同一批量重复扣减；
标准采购口径未改变。

**验证结果**：

- focused：`server/m1c-processing-po.test.js` 13/13、`server/m1c-wp2-wp5-outsourcing.test.js`
  13/13、响应式浏览器 UAT 16/16；本轮续跑 `server/procurement-execution-suite.test.js` 与
  `server/m1c-outsourcing-gl-policy-guard.test.js` 合计 15/15；
- UNIQUE 一次性临时 SQLite 证据：索引存在、重复非空来源被拒绝、多个 NULL 合法、历史冲突
  fail closed；未对项目数据库执行 migration；
- `pnpm test:fast`：511/511 PASS；
- `pnpm test`：3205 项，3203 PASS / 2 FAIL；两项均为下述 N7 继承性失败，**无新增业务测试失败**；
- `pnpm build`：PASS；`git diff --check`：PASS；
- `current` 文档检查：N1、N3–N6、N8、N9 PASS，N2 `RETIRED`，N7 FAIL；
  `migration` 模式 C1–C6 全部 PASS。

**N7 精确状态**：历史失败仍为 §37.22 已登记的三条证据：`171ade577bad` 缺
`docs/status/PROJECT_STATUS.md §37.21` 或完整路径引用；`4403a80d2543` 缺
`docs/reviews/README.md` 与
`docs/reviews/m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md` 完整路径。
本轮新增 N7 失败为 **0**；受影响 Gate 仅为 current 文档完整性及其纳入 FULL 的两项测试，
不把该结果豁免或记为 PASS。

**暂停点**：实现已交付并等待独立审查；业务所有者尚未签发 `M1C-WP2..WP6`
Implementation PASS、任何 `M1C-Gxx` PASS、Acceptance、Freeze、Domain Closure 或 Release Readiness。
当前项目状态仍只以本文件为唯一登记。

### 37.24 N7 历史提交追溯修复（`N7-HISTORY-REPAIR-20261103`，2026-11-03）

**授权与目的**：业务所有者明确授权修复 §37.22 / §37.23 登记的历史 N7 失败，包括创建本地
备份分支、重写受影响分支历史、更新 SHA 映射、重跑门禁，以及对 Gitee / GitHub 同名分支执行
`--force-with-lease`。本次只补齐两条历史提交消息中的受治理完整路径，不修改任何提交的文件树、
业务语义、Requirement、Design 正文、实现代码、schema、migration 或 release tag。

**安全锚点与范围**：重写基点保持
`a5847fbdb23a26199ab2854221559e8b68907fcb` 不变；重写前 HEAD
`cfcaf46db309f5fa42b62aac67b0a43089837c2c` 已由本地分支
`backup/n7-pre-rewrite-20261103-cfcaf46` 保留。新旧 HEAD 文件树执行 `git diff --exit-code` 为 0。
原 `171ade577bad` 提交消息补入 `docs/status/PROJECT_STATUS.md`；原 `4403a80d2543`
提交消息补入 `docs/reviews/README.md` 与
`docs/reviews/m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md`。

| 原 SHA | 重写后 SHA | 主题 |
|---|---|---|
| `171ade577bad46093ede64e081d6cf55132693cd` | `2f2235b22c98ed5eaad368df14f90da29c5dc8ae` | 登记 M1C-WP1 实施验收 |
| `4403a80d254350ce9ebe4a8c746fbb1006dd67c4` | `71c0f198ca3ba52b5448ddb6900033252e837e2a` | 起草委外加工费 PO 正式可达设计修订 |
| `627559c6032d9ec0adb2740a38e41a16b168dd59` | `8aa4f0b16f425d0b84c3c255d9fe2b41dd7c39ef` | 修订加工费 PO 候选设计 R1 |
| `f5ae5fe390ff1622070d71687342db828f95eb4a` | `357939305fc7cbe50963aa66202966a34bc243ef` | 提升加工费 PO R1 为 Active Design |
| `eb4ff58180402ce254d0bfb171eebfba08671cf9` | `40e121e921fd221c6689eb28b8e4dd8cc82bb91f` | M1-P-03 角色矩阵与拒绝审计 |
| `3566aae60d2d77669e00e8bd8449bd30dd663f43` | `760e0ee0ce58b8ed5489f5332627262b3fc1f73c` | 加工费 PO 正式生产路径 |
| `09afd37bee0373f4b3a7932612de57daa7439c6e` | `c2cb3844f56055a11d15dddd2979bc84a46eb0a4` | 委外收货、材料与延期拒绝 |
| `a059d96e13f6e7c0a8c2ebb1b1ce092c92ce2b7c` | `6e20c8159a0d7af1b57943151e209630c07628a1` | 前端 API 与响应式验收脚本 |
| `f5abbe31664e93ee3a49598a9efc5f3f5e6eb774` | `465b65228381c8b25bdc79542ce32587cb443138` | 既有套件迁移与容量口径修正 |
| `cfcaf46db309f5fa42b62aac67b0a43089837c2c` | `b15d26204853e1c35e69112c8e42136f3750394a` | M1C-WP2–WP6 实施交付状态登记 |

**状态取代关系**：§37.22 / §37.23 对 N7 FAIL 的描述是修复前真实历史证据，保留不删；本节是
当前状态的后继登记。聚焦 `current --target HEAD --only N7` 在重写后已返回 PASS；最终状态登记提交、
FULL、Build、`git diff --check`、完整 current / migration 及两个远端 lease 推送结果以本节后续验证为准。
`M1C-G01..M1C-G07`、Implementation Acceptance、Freeze 与 Release Readiness 状态均不因此改变。

### 37.25 N7 历史修复门禁与远端同步完成（2026-11-03）

**验证结论**：在 §37.24 的 SHA 映射提交 `f5dae1c4791b11e306737ca4e0f03c0c13e99750`
上，文档 `current` 模式 N1、N3–N9 全部 PASS（N2 按治理决定为 RETIRED），其中 N7 已恢复 PASS；
`migration` 模式 C1–C6 全部 PASS；FULL 为 3205/3205 PASS、0 FAIL、0 SKIP；Build PASS；
`git diff --check` PASS。上述验证未连接数据库，也未运行 MySQL Gate。

**远端结果**：推送前再次 fetch，Gitee 与 GitHub 同名分支均仍精确位于
`627559c6032d9ec0adb2740a38e41a16b168dd59`。随后以该 SHA 作为显式 lease，两个远端均成功执行
`627559c...f5dae1c` forced update；未覆盖任何并发远端提交。最终证据登记提交在其后通过普通快进同步。
`master`、`package.json` version `1.6.2` 及既有 release tag 均未改变；本地恢复分支
`backup/n7-pre-rewrite-20261103-cfcaf46` 继续保留。

**当前状态**：历史 N7 阻塞已解决。该结论只关闭 N7 文档追溯缺陷，不签发
`M1C-G01..M1C-G07`、Implementation Acceptance、Freeze、Release 或 Deploy。

### 37.26 M1C-WP2–WP6-R1 独立审查阻塞修复（2026-11-03）

**授权与范围**：业务所有者授权对已交付的 M1C-WP2–WP6 Implementation 做**有界阻塞修复**，
只修复独立代码复核提出的两项 P0 缺陷与一项金额校验风险；**不重做 WP2–WP6、不进入 WP7**。
授权不包含 Push / Merge / Tag / Release / Deploy、项目数据库 Migration、`M-15` 或 MySQL Gate。

**基线**：修复前 fetch 两个远端并以 `ls-remote` 直接核对，本地 / Gitee / GitHub 的
`work/m1-core-rebaseline-20261102` 同名分支均精确位于
`3c3a8ce5edf6f465cad0ea699e430df265fad30f`，工作树干净。

#### P0-01 完工通知行剩余容量（`server/modules/outsourcing.js::createOutsourcingReceipt`）

- **原因**：原文只比较「本次明细行数量 ≤ 通知行数量」，**从未**扣减该通知行已被历史收货
  占用的容量；因此同一完工通知行可被反复收货，只要委外订单总量尚有余量。
- **修复**：在权威事务内按**真实通知行 ID** 逐行重读并累计历史有效收货占用
  （`outsourcing_receipt_items.source_notice_item_source_id` → 通知行，
  `outsourcing_receipts.business_status <> 'CANCELLED'`，**待检与已生效都仍占用**），
  校验「历史占用 + 本次拟收货 ≤ 通知行数量」；越界 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED`。
  历史收货**无法证明**通知行来源（`source_notice_item_source_id` 为 NULL 或悬空）⇒
  409 `RECEIPT_NOTICE_OUTSOURCING_CAPACITY_UNPROVEN`（fail closed）。
  加工费 PO 行与交期**不**作为收货容量上界；`STANDARD_PURCHASE` 来源模型不受影响。
- **反例证据**：`server/m1c-wp2-wp6-r1-notice-line-capacity.test.js` —— 委外订单 10、通知 A 数量 4、
  通知 B 数量 4；第一次从 A 收货 4 → 201；第二次从 A 收货 4（换 Idempotency-Key，订单仍有 6 余量）
  → 409 `RECEIPT_NOTICE_CAPACITY_EXCEEDED` 且收货表头/明细/库存/估值/通知逐表零变化、
  拒绝审计恰好 1 条；另一合法通知 B 仍可独立收货 4 → 201。
  该套件在修复前（`git show HEAD:` 版本）为 **12 FAIL / 3 PASS**，修复后 15/15 PASS。

#### P0-02 收货生效重复确认与审计（`server/modules/outsourcing-finance.js::confirmOutsourcingReceipt`）

- **原因**：权威事务内存在 `if (lockedReceipt.business_status === 'EFFECTED') return;`，
  该分支**静默返回**并由外层报告 HTTP 200 成功，使没有合法幂等重放证据的并发第二请求
  被记为成功；且事务前的状态检查 409 **未写**拒绝审计。
- **修复**：静默 `return` 改为 409 `OUTSOURCING_RECEIPT_ALREADY_EFFECTED`；
  同键异内容改为 409 `OUTSOURCING_RECEIPT_IDEMPOTENCY_CONFLICT`；**全部** 409 业务门禁拒绝
  （含事务前状态检查）统一写**恰好 1 条** Domain 拒绝审计（含业务单据标识与精确 error code）；
  403 授权拒绝仍由 dispatch 层写且**不含**业务单据标识；400 输入失败不写 Domain 审计。
  事务前拒绝同时释放 MySQL 幂等命名锁，避免同一 Key 的后续请求被 `GET_LOCK` 阻塞退化为 503。
- **并发证据**：`server/m1c-wp2-wp6-r1-receipt-effect-idempotency.test.js` 覆盖顺序重复确认、
  同 Key 精确重放（返回已记录的真实结果）、同 Key 异内容、换 Key 重复确认、
  两个不同 Key 的并发竞争（至多一个生效，另一请求明确 409）、
  「第二个请求进入事务时状态已改变」的确定性复现、拒绝方业务状态逐字段不变、
  拒绝审计恰好 1 条、403 不泄露单据标识、400 不写 Domain 审计。
  该套件在修复前为 **4 FAIL / 4 PASS**，修复后 8/8 PASS。

#### P1 加工费金额输入

- **修复**：`createOutsourcingReceipt()` 的表头 `processingFeeCents` 与明细 `unitPriceCents`
  统一经「安全整数分 + 非负」校验：拒绝负数、非整数、非安全整数、溢出与**非法字符串**
  （`'abc'`、`'NaN'`、`'Infinity'`、`'1e3'`、`'12.5'`、布尔、对象等），
  400 `OUTSOURCING_RECEIPT_AMOUNT_INVALID`，且**不留下任何业务事实**；
  生效路径另加成品成本金额溢出守卫（409 `OUTSOURCING_RECEIPT_AMOUNT_OVERFLOW`），
  不受控金额不得进入成品库存估值。
- **未自定合同**：既有合同**未**确定委外收货的加工费是否**必须**提供。本轮**保留既有缺省**
  （未提供按 0 处理），**不**自行扩展 Requirement，也**不**发明加工费价格或分摊政策。
  该问题作为**开放合同项**交回业务所有者裁定（见「新增业务合同阻塞」）。

#### 合同登记与 Gate

- Active Design `docs/design/procurement-outsourcing-m1-core.md` §5.2.2 登记
  `OUTSOURCE` 通知行可转换剩余的权威口径（按真实通知行 ID 逐行累计、待检与已生效都占用、
  历史来源不可证明即 fail closed）；§9.3 登记本轮 4 个精确 error code
  （`OUTSOURCING_RECEIPT_ALREADY_EFFECTED`、`OUTSOURCING_RECEIPT_IDEMPOTENCY_CONFLICT`、
  `OUTSOURCING_RECEIPT_AMOUNT_INVALID`、`OUTSOURCING_RECEIPT_AMOUNT_OVERFLOW`）。
- 新增两个套件登记进 `scripts/testing/test-suites.js` 的 **FULL**（不进 FAST：各自持有一次性临时 SQLite）。
- 门禁：Focused（新增 23 项 + WP2–WP5 / WP1-R2 / GL 守卫 / 加工费 PO / 既有委外套件）全 PASS；
  `pnpm test:fast` **511/511 PASS**；`pnpm test` **3228/3228 PASS、0 FAIL、0 SKIP**
  （基线 3205 + 本轮新增 23）；`pnpm build` PASS；文档 `current` 模式 N1、N3–N9 全部 PASS
  （N2 按治理决定为 `RETIRED`），其中 N7 经本轮提交后复跑确认为 PASS；
  文档 `migration` 模式 C1–C6 全部 PASS；`git diff --check` PASS。
  全程未连接项目数据库，未运行 MySQL Gate。

**未发生事项**：未 Push / Merge / Tag / Release / Deploy；未运行项目数据库 Migration、`M-15` 或
MySQL Gate；未修改 `master`、`package.json` version `1.6.2` 与既有 release tag；
未签发 Implementation Acceptance、`M1C-G01..M1C-G07` PASS、Freeze 或 Acceptance；
未进入 WP7。

**新增业务合同阻塞（开放项，待业务所有者裁定）**：
委外收货表头 `processingFeeCents` 与明细 `unitPriceCents` 是否**必须**提供。
本轮只收紧**取值合法性**，保留既有缺省 0；该缺省会让 `INV-4`（委外成本证据 = 材料实耗价值 + 加工费）
在缺省时低估成品成本，属**会计政策**范畴，按 §31.13.4 与 `C-P01` 边界需业务所有者裁定，
**不得**由 Implementation 自行决定。

**WP7 启动前的剩余风险**：
① 加工费是否必填的会计政策未裁定（见上）；
② 本轮并发证据只在一次性 SQLite 上完成，MySQL 下的命名锁与全局事务闸门语义**未**复跑，
须在获得受保护的可丢弃 MySQL 环境后单独执行 MySQL Gate；
③ `OUTSOURCE` 通知行的历史来源不可证明即 fail closed，可能使部分历史委外订单**不可继续收货**
（§15.2 第 4 条已登记该历史隔离规模未实测）。

```text
M1C_WP2_TO_WP6_R1_READY_FOR_INDEPENDENT_REVIEW
```

---

### 37.27 M1-Core `M1C-WP7-A` 非破坏性验收执行（2026-11-03）

**授权与范围**：业务所有者授权执行 M1-Core 首期 **WP7-A 非破坏性验收** ——
建立正式、可复现的 G01–G06 验收证据，并准备 G07 的 MySQL 执行方案。
授权**不包含**真实 MySQL Gate、项目数据库 Migration、`M-15`、Push / Merge / Tag /
Release / Deploy，也**不包含**签发任何 Gate PASS。

**基线**：起点 HEAD `2fe1dd841b6c73deb53b09d87da77e0c34533ae4`；`git ls-remote` 核对
`github` 与 `origin`（Gitee）的 `work/m1-core-rebaseline-20261102` **两端与本地精确一致**；
起点工作树干净。

**执行证据**：`docs/acceptance/m1-core-wp7a-gate-acceptance-20261103.md`（完整逐 Gate
证据矩阵、反向断言、命令、结果、剩余风险）。

| Gate | 执行状态 | 结论 |
|---|---|---|
| `M1C-G01` 采购通知与转换 | 已执行 | `PASS_WITH_RESIDUAL` |
| `M1C-G02` 委外收货与质量 | 已执行 | `PASS_WITH_RESIDUAL` |
| `M1C-G03` 物料库存与 WIP | 已执行 | `PASS_WITH_RESIDUAL` |
| `M1C-G04` 倒冲与成品 | 已执行 | `PASS_WITH_RESIDUAL` |
| `M1C-G05` 移动工作面 | 已执行 | **`FAIL`** |
| `M1C-G06` 延期政策与财务守卫 | 已执行 | `PASS_WITH_RESIDUAL` |
| `M1C-G07` MySQL 并发与对等 | **NOT_RUN** | `NOT_RUN` |

`PASS_WITH_RESIDIAL` 的含义：本地 SQLite 上、正向来源全部经**生产 HTTP API** 的正向与
反向断言全部成立且可复跑；但 **MySQL 8 真实后端的对等与并发结论未取得**，
按 Active Design §13.1 的 Gate 定义**不得**据此签发 PASS。

**本轮补齐的断言位**：新增 `server/m1c-wp7a-gate-acceptance.test.js`（登记进 FULL），
补上 Active Design §13.1 中此前**没有断言位**的项目 ——
G03 的 LOT / SERIAL / NONE 三类身份各自成键、缺仓 / 库存不足 / UOM 不符 / 身份异常
四类拒绝分支、幂等重放与同键异内容；G04 的多批次部分完工、成品估值 **Movement + Balance**
双写、材料成本按 **canonical 位置口径**（非全局平均价）、加工费 **provisional** 证据；
G06 的拒绝后 **AP / 凭证 / 库存 / 估值 / 成本 / 单据逐字段零变化**。
材料成本断言以**临时负向对照**证明非空洞（把分摊改成全局平均后该例报「实际 82」而非 15），
该临时改动已 `git checkout --` 完整回退，核心实现 diff 为空。

**G05 缺陷登记（阻塞 G05，需独立工作包，本轮不修）**

- **G05-A（P0）**：两个工作面在构建产物中**无法打开**。
  `src/navigation/applicationRegistry.js:104-144` 的 `loadScreenModule` 缺少
  `../pages/outsourcing.jsx` 与 `../pages/sourcing-pricing.jsx` 两个 `case`，
  而 `:80-81` 的路由表已用 `defaultScreen(...)` 注册了这两条路由，
  打开时落进 `default:` 分支抛 `Unknown route screen module`；
  全新 `pnpm build` 的 `dist/assets/` 中亦无对应 chunk。
  现有 `server/v17-p0-frontend-application-architecture.test.js:129` 只断言 loader 的**形状**，
  不校验每条已注册路由的 screen module 可加载。
- **G05-B（P1）**：`src/pages/outsourcing.jsx:85/201/206` 以**单参数数组**调用
  `can([...])`，而契约为 `can(user, permission)`（`src/components/ui.jsx:10`），
  三处动作门禁恒为假 ⇒「新建委外订单」「确认计划 / 下达 / 标记完工」「取消」
  **永不渲染**；即使 G05-A 修复，委外页面仍是只读，
  §13.1 要求的「入口 → 列表 → 详情 → **提交** → 错误展示」仍走不通。
- **对既有 G05 证据的追溯修正**：此前 `scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs`
  报告的 `PASS=16/16` **不是**有效证据 —— 该脚本注入 token 后**未 reload**，
  SPA 从未离开登录页，被测对象是登录页；且其断言在工作面打不开时依然成立。
  本轮已加固该脚本（reload + 断言工作面确实渲染 + 逐工作面探测服务端 RBAC 状态 +
  新增无权主体），加固后如实报告 **`PASS=16 / FAIL=8 / TOTAL=24`**。
- 服务端来源级 RBAC 本身**正确**：admin 200 / 200、委外业务员 200 / 403、
  销售专员 403 / 403；无权主体走页面级处理，不崩溃、无 TypeError、无横向溢出。

**G07（`NOT_RUN`）**：已完成执行准备 —— CR-01..CR-09 全部映射到**真实生产 Handler**；
审查 SQLite/MySQL schema parity 入口（`server/m1c-wp0-schema-parity.test.js`，
离线录制型 mock adapter，**不连接** MySQL，且 `receipt_notice_items` 与
`outsourcing_receipts` / `outsourcing_receipt_items` 的**表体**未进入逐表对等循环）；
UNIQUE / 锁 / 事务 / 幂等 / 审计验证方案；四重 disposable MySQL ACK 设计
（ACK-1/2/3 已实现于 `server/test-utils/mysql-disposable-target.js`，
**ACK-4 为 `NOT_IMPLEMENTED`**）；目标数据库身份
`mysql://modern_erp_test@127.0.0.1:3306/modern_erp_domain_test`、run ID、commit SHA
绑定要求与清理边界。本轮**未**连接 MySQL、**未**运行 destructive Gate、
**未**执行 Migration 与 `M-15`、**未**在 MySQL 中创建或删除数据库。

**新增 / 修改文件**：`server/m1c-wp7a-gate-acceptance.test.js`（新增）、
`scripts/testing/test-suites.js`（登记）、`scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs`
（加固既有浏览器验收工具）、`docs/acceptance/m1-core-wp7a-gate-acceptance-20261103.md`
（新增）、`docs/acceptance/README.md`（索引登记）、本节、`log/2026-11-03.md`（追加）。
**未修改**任何核心实现文件。

**门禁**：`--filter m1c` **124/124 PASS**；`--filter wp7a` **8/8 PASS**；
浏览器验收 **PASS=16 / FAIL=8 / TOTAL=24**（G05）；
`pnpm test:fast` **511/511 PASS**；`pnpm test`（FULL）**3236/3236 PASS、0 FAIL、0 SKIP**
（基线 3228 + 本轮新增 8，耗时 1151.7 s）；`pnpm build` PASS；
文档 `migration` 模式 **C1–C6 全部 PASS**；文档 `current` 模式 N1、N3、N4、N6、N8、N9
**PASS**、N2 按治理决定为 `RETIRED`（不参与判定）、N5 在补登记 `docs/acceptance/README.md`
后 PASS、N7 在本轮提交后复跑确认 PASS；`git diff --check` PASS。
全部测试经 `scripts/testing/run-tests.js` 运行并由 `scripts/testing/test-env.js` 净化环境
（`ERP_DB_BACKEND=sqlite`），**未接触**任何 MySQL 或项目数据库。

**未发生事项**：未 Push / Merge / Tag / Release / Deploy；未修改 `master`、
`package.json` version `1.6.2` 与既有 release tag；未修改 Requirement §31.13、
Active Design 正文与任何既有历史验收事实；未签发 `M1C-G01..M1C-G07` PASS、
M1-Core Acceptance、Domain Closure、Freeze 或 Release Readiness；
未把 G05 的两个前端缺陷纳入本轮修复。

**未解决矛盾**：

1. 加工费 `processingFeeCents` / `unitPriceCents` 是否必填**仍未裁定**
   （沿用 §37.26 的开放合同项）；本轮报告中的一切加工费金额均为 **provisional**。
2. G01–G06 的 MySQL 对等与并发结论**缺失**（G07 `NOT_RUN`）。
3. `INVENTORY_MUTATION_UNEXPECTED_REPLAY` 在委外 HTTP 端点**不可达**
   （canonical 变更键含每次请求的新 `eventId`）；端点上的等价合同是
   「同一幂等键不能用于不同请求内容」（409）。
4. `OUTSOURCE` 历史来源隔离规模仍未实测。
5. G05 的两个前端缺陷需**独立工作包**与用户授权后修复。

```text
M1C_WP7A_READY_FOR_INDEPENDENT_REVIEW
```

---

### 37.28 M1-Core `M1C-WP7A-G05-R1` 移动工作面阻塞修复（2026-11-03）

**授权与范围**：业务所有者授权对 §37.27 已登记的 G05-A / G05-B 执行有界
Implementation 缺陷修复；不修改 Requirement §31.13 或 Active Design §12 / §13.1，
不重做其他 Gate，不签发 `M1C-G05` PASS、WP7-A Acceptance、M1-Core Acceptance、
Domain Closure、Freeze 或 Release Readiness。起始 HEAD 为
`a04b7a5cecd088b923fc809b0b9778fc32d7567c`，原 WP7-A 报告、修复前
`PASS=16 / FAIL=8 / TOTAL=24` 与 G01–G04/G06 证据均原样保留。

**G05-A 根因与修复**：`SCREEN_DEFINITIONS` 已登记 `sourcing-pricing` / `outsourcing`，
但 `loadScreenModule()` 的静态 `switch` 缺少两条 import，运行时落入
`Unknown route screen module`。现已只在既有 switch 补齐两条静态 import；未引入变量路径、
第二 Registry 或路由身份/分组/可见性变更。正式 `pnpm build` 产物已生成独立
`page-sourcing-pricing-*.js` 与 `page-outsourcing-*.js` chunk。

**G05-B 权限与可执行页面修复**：`OutsourcingPage` 从 `RouteScreen` 既有 props 取得 `user`，
并传给详情；三处错误 `can([...])` 已按后端真实矩阵改为：新建仅
`OUTSOURCING_MANAGE`，推进为 `OUTSOURCING_RELEASE OR OUTSOURCING_MANAGE`，取消为
`OUTSOURCING_MANAGE` 且状态限 `DRAFT / PLAN_CONFIRMED`。同时把两页仍使用的旧版
Design System `actions / filters / items` 与 action-bar children 调用对齐到现行
`primaryAction / secondaryActions / children / primary / destructive` 合同；否则权限修复后
按钮与真实列表仍会被组件静默忽略。未修改 `can()` 签名、角色授予、后端 Handler、状态机或
全局 Design System。`sourcing-pricing.jsx` 未发现同类权限误用，未扩大权限策略。

**修复后 G05 浏览器证据**：正式构建产物 + 临时 SQLite + Edge/Playwright，
3 个真实主体 × 4 宽度 × 2 工作面 = **`PASS=24 / FAIL=0 / TOTAL=24`**：

| 主体 | 委外加工 | 寻源与定价 |
|---|---|---|
| admin | 320/390/430/680：4/4 | 320/390/430/680：4/4 |
| 委外业务员 | 320/390/430/680：4/4 | 页面级拒绝 + 服务端 403：4/4 |
| 销售专员 | 页面级拒绝 + 服务端 403：4/4 | 页面级拒绝 + 服务端 403：4/4 |

授权页面逐项证明目标标题与真实列表 DOM 已渲染、页面自身 GET 为 200、无
`Unknown route screen module`、无 `api.get/api.post is not a function`、无未捕获异常、
无横向溢出；320px 额外执行委外非法供应商 409 错误展示并原位纠正、合法创建 201、
订单推进 200，以及寻源分配 POST 200。其余宽度证明动作可见且可用。无权主体不渲染目标
工作面或动作，并对两类直接 POST 均返回后端 403，前端门禁未替代后端 RBAC。

**回归**：G05 Browser **24/24 PASS**；`pnpm test:fast` **511/511 PASS**；
`pnpm test` **3236/3236 PASS**、0 fail / 0 skipped / 0 cancelled；`pnpm build` PASS；
文档 `current` / `migration` 与提交后 N7 结果见本逻辑单元最终门禁记录；
`git diff --check` PASS。全部常规测试继续由隔离器固定 SQLite；未运行 MySQL Gate。

**未发生事项与剩余阻塞**：未修改 Requirement、Active Design、后端状态机、库存/估值/财务
Writer、schema/migration、权限矩阵、G01–G04/G06 断言或 WP7-A 原报告；未运行 M-15、项目
数据库 Migration、MySQL Gate；未 Push / Merge / Tag / Release / Deploy。G07 仍 `NOT_RUN`，
G01–G06 的 MySQL 对等/并发证据仍缺失，加工费必填政策与既有 WP7-A residual 仍开放。
本节只登记修复与复跑证据，**不自行签发** `M1C-G05` PASS。

```text
M1C_WP7A_G05_R1_READY_FOR_INDEPENDENT_REVIEW
```

### 37.29 M1-Core `M1C-WP7-B0` G05 收口与 G07 安全准备（2026-11-03）

- 基线：`work/m1-core-rebaseline-20261102` @ `8559c03f78898b0b059330f096a4e1bde694f277`；本轮开始时本地、
  GitHub、Gitee 同名分支完整 SHA 一致，工作树干净。
- G05：`M1C_G05_INDEPENDENT_REVIEW_PASS`，见
  `docs/acceptance/m1-core-g05-independent-review-20261103.md`。原 16/8 FAIL 历史完整保留；修复后 24/24、
  FAST 511/511、FULL 3236/3236、Build、N7 的既有记录已核对。本轮未重跑浏览器。Owner 未签发正式
  Acceptance，故 `M1C-G05 PASS` 未签发。
- G03：合法 HTTP 不能控制内部 `eventId`，无法触发 `INVENTORY_MUTATION_UNEXPECTED_REPLAY`；内部 Writer
  对同 Mutation Key 异指纹明确 409 并事务回滚，未见静默丢腿。已提出 L1 外部幂等 + L2 primitive 的证据
  分层候选，等待 Owner 裁定。
- G07：ACK-4 仍为 `NOT_IMPLEMENTED`。现有环境变量授权可被直接 Node Gate 重用，concurrency runner 另有
  自有 DROP 路径。候选定义 run ID、完整 SHA、精确 target/operations、15 分钟有效期、原子一次性消费、
  批准事实、secret 隔离和 Node primitive 强制检查。
- CR-01～CR-09 已映射真实 Handler 和至少两个独立 session；`race_probe_generic` 不得用于 G07。
  CR-02/04/05 的稳定 error code 与 CR-07 唯一 oracle 为实施前待批准缺口。
- 候审 Design：`docs/reviews/m1/m1-core-wp7b0-g03-g07-safety-design-amendment.md`，状态
  `PENDING_APPROVAL / PENDING_REVIEW / NOT_AUTHORIZED_FOR_IMPLEMENTATION`；Active Design §13 未修改。
- 未连接、创建、删除或重置 MySQL；未执行 MySQL Gate、M-15、Migration；未修改业务代码、schema、
  Requirement 或 Active Design；未 Push / Merge / Tag / Release / Deploy；未签发其他 Gate 或 Acceptance。

```text
M1C_WP7B0_READY_FOR_INDEPENDENT_REVIEW
```

### 37.30 M1-Core `M1C-WP7-B0-R1` G07 Safety Design Final Corrections（2026-11-03）

- 基线：`work/m1-core-rebaseline-20261102` @
  `1d67ce8ea34d604c245d95dd42435b4beadf0c26`；开始时本地、GitHub、Gitee 同名分支完整 SHA 一致，工作树干净。
- R1-01：候审 Design §2 / §4 已区分治理批准事实与机器凭据；Gate/launcher 不得签发批准，普通 JSON/环境变量
  不构成批准；明确同一 OS 用户不是对抗性防篡改边界，并登记现有 Gate、diagnostic、shared reset、Migration
  等 destructive 入口的保护或拒绝方案。
- R1-02：候审 Design §3 固定 `ISSUED → CONSUMED → FINISHED / FAILED / CLEANUP_UNVERIFIED`，定义原子消费、
  进程树/child lease、15 分钟启动窗口、单次 cleanup、崩溃隔离与单独 recovery 授权；不存在凭据消费后启动第二次
  Gate 的路径。
- R1-03：候审 Design §6 否决 CR-01 原“确认通知 vs 转换通知”容量竞争，替换为两个真实通知创建竞争同一 PO Item/
  delivery schedule 的 10 容量、6 vs 6；固定 CR-07 为两张不同合法待检委外收货竞争同一材料行 WIP=6、4 vs 4；
  CR-02/04/05 的新增稳定 code 与最小触发位置保持 `NOT_AUTHORIZED`。
- R1-04：候审 Design §8 区分全新 disposable current-schema 初始化和历史数据库 M-15/PRE-A/B/C。当前 M-15 未实现，
  涉及 `tracked_inventory_movements.identity_key` 的 G07 parity 保持 BLOCKED；空库 0 行检查不构成历史 Migration PASS。
- G05 独立技术审查、WP7-A 原始 16/8 FAIL 与修复后 24/24 证据均完整保留；G03 L1/L2 技术结论未降级。
- 本轮只修改候审 Design、候审索引、唯一项目状态登记和当日日志；未修改 Requirement、Active Design、业务源码、
  MySQL 执行器、Migration 或测试合同。
- 只读门禁：文档 `migration` C1～C6 PASS；`current` N1、N3～N9 PASS，N2 `RETIRED`；`git diff --check`
  PASS。提交后仍须以最终 HEAD 复跑 N7。
- 未连接、创建、删除或重置 MySQL；未执行 MySQL Gate、M-15、Migration；未签发 Gate PASS / Acceptance；
  未 Push / Merge / Tag / Release / Deploy。
- 后续仍需 Domain Owner 与 Platform / Database Safety Owner 对候选分别批准，再单独授权 Implementation、M-15
  Implementation/历史 Migration，以及最终精确 run ID/SHA/target/operations 的一次性 MySQL Gate。

```text
M1C_WP7B0_R1_READY_FOR_INDEPENDENT_DESIGN_REVIEW
```

### 37.31 M1-Core `M1C-WP7-B0-DESIGN-PROMOTION`（2026-11-03）

- 授权：独立结论 `M1C_WP7B0_R1_INDEPENDENT_DESIGN_REVIEW_PASS` 后，用户明确提供 Domain Owner 对 G03/CR/error
  code 的批准、Platform / Database Safety Owner 对 ACK-4 的批准，以及本次 Active Design Promotion 授权。
- 基线：`work/m1-core-rebaseline-20261102` @ `70edc23aefdca9ee95c45be1b5933fd9cdb7f9e1`；起始工作树干净。
- Active Promotion：G03 L1/L2、CR-01～CR-09、CR-02/04/05 error code、M-15 条件边界已融合至
  `docs/design/procurement-outsourcing-m1-core.md §6 / §9.3 / §13–§17`；跨 Domain ACK-4 权威合同融合至
  `solution.md §15.1`。候选原文不改写，由 `docs/reviews/README.md` 登记为 `SUPERSEDED` 来源快照。
- ACK-4 当前状态：`APPROVED / NOT_IMPLEMENTED`；固定批准事实/机器凭据分离、一次性状态机、child lease、
  cleanup/quarantine/recovery、全 destructive 入口 fail closed 与 M1 四项 operation manifest。
- CR-01 已固定为两次通知创建以 6 vs 6 竞争同一容量 10 的 PO Item/交期；CR-07 固定为两张合法待检收货
  各 4 竞争 WIP 6。`notice_no` 同毫秒碰撞登记为 Active Design §14 `RISK-9`，本轮未改业务编号逻辑。
- G05 未取得本次之外的 Owner 正式 Acceptance；继续保持 `M1C_G05_INDEPENDENT_REVIEW_PASS`，未签发
  `M1C-G05 PASS`。
- 本轮只修改 Design、批准/索引/状态文档与当日日志；未修改 Requirement、业务源码、MySQL 执行器、Migration
  或测试合同；未连接 MySQL，未执行 ACK-4、MySQL Gate、M-15、Migration 或 destructive operation。
- 后续 Implementation 清单：ACK-4 issuer/root/child/cleanup/quarantine、全入口迁移；M1 root runner 与真实 Handler
  race；CR-02/04/05 code；schema parity；`notice_no` 风险处置；M-15 Implementation。每项仍需独立授权。

```text
M1C_WP7B0_DESIGN_PROMOTION_READY_FOR_INDEPENDENT_REVIEW
```

### 37.32 M1-Core `M1C-WP7-COMBINED` Implementation（2026-11-04）

- 授权：用户明确、独立授权 ACK-4、CR-02/04/05、批准范围内 `notice_no` 风险修复、G07 专用
  Runner/测试/Schema Parity，以及 M-15 **离线 Implementation**；未授权任何真实 MySQL、数据库
  create/drop/reset、destructive Gate、历史 Migration、Push/Merge/Tag/Release/Deploy。
- 起点：`work/m1-core-rebaseline-20261102` @ `6088a501480aaa004b836979aacb805deabeba21`；双远端同分支基线一致。
- Implementation 提交：`84bca44`（错误码与通知编号）、`c8145c2`（ACK-4）、`cb8538a`（M-15 离线实现）、
  `b49afed`（G07 Oracle / Schema Parity / Child Lease）。`package.json` 版本仍为 `1.6.2`，release tag 未变。
- ACK-4：治理批准与运行凭据分离；独立 DPAPI issuer；精确 run/SHA/target/operation；15 分钟原子一次性消费；
  Root/Child Lease、PID/父进程绑定、cleanup/quarantine/recovery；旧 destructive runner、upgrade/conversion、
  shared `temp-db`/reset 的直接 Node 路径 fail closed。既有 ACK-1～3 保留。
- 并发业务修复：CR-02 精确 `PURCHASE_RECEIPT_ALREADY_CONFIRMED`；仅委外 ISSUE/SUPPLEMENT 使用
  `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT`；通知号保持既有 `RN[OS-]<10 digits>` 语义并在事务内探测分配，
  不把唯一键异常伪装成容量拒绝。
- M-15：current SQLite/MySQL schema 定义纳入 `identity_key` 与委外部分唯一索引；显式历史迁移函数实现
  PRE-A/B/C、LOT/SERIAL/NONE 严格映射、SQLite 回滚、MySQL DDL 部分完成识别与幂等重试。它未被 startup
  自动调用；历史库未运行 M-15 时委外严格跟踪继续 fail closed。
- G07：CR-01～CR-09 的生产 HTTP、双 session 同步、精确 status/code、拒绝审计、零败方副作用、逐表全字段
  快照 Oracle 和真实 `information_schema` parity 比较器已实现；真实 integration 文件保持普通 FAST/FULL 之外。
  root runner 在 capability **消费前**明确 BLOCKED，直至生产 HTTP fixture builder 与 root-managed child cleanup
  编排完成独立安全审查，故 `M1C-G07` 仍为 `NOT_RUN / BLOCKED`，没有虚构 PASS。
- 离线回归：focused PASS；FAST `528/528`；FULL `3255/3255`（398 suites）；Build PASS；实施代码提交后的
  current N1/N3～N9 PASS、N2 RETIRED，migration C1～C6 PASS，`git diff --check` PASS。最终证据提交
  `59eccd5` 的消息未引用 `§37.32` 或完整路径，故最终 HEAD 重跑 current 时 N1/N3～N6/N8/N9 PASS、N2 RETIRED，
  **N7 FAIL**。修复需要改写该本地提交消息；本工作包未授权 Git 历史重写，因此如实保留为 blocker。测试运行器
  固定 SQLite，明确移除 `ERP_MYSQL_TEST_ALLOW_RESET`；未运行 HEAVY/MySQL/Migration。
- G01～G06 的 WP7-A 与 G05 独立审查既有证据未覆盖、未降级、未重新签发；本条只登记 Implementation，
  不构成任何 Gate PASS、Core Acceptance、Domain Closure、Freeze 或 Release。
- 剩余阻塞：最终 HEAD 的 N7 提交追溯（需新增历史重写授权）；真实 MySQL parity/CR-01～CR-09 执行；G07
  production HTTP fixture builder/root cleanup 安全审查与激活；历史数据库 M-15 Migration 的独立批准、preflight、执行与证据。详见
  [`docs/acceptance/m1-core-wp7-combined-implementation-20261104.md`](../acceptance/m1-core-wp7-combined-implementation-20261104.md)。

```text
M1C_WP7_COMBINED_IMPLEMENTATION_READY_FOR_INDEPENDENT_REVIEW
```

### 37.33 M1-Core `M1C-WP7-R1` 收口与历史修正（2026-11-04）

- 授权：用户对 §37.32 遗留的最终 HEAD N7 blocker 授权**仅限消息级本地历史修正**（重建 `59eccd5`、
  `59dec19e` 两条 commit message），以及 G07 Root Runner/子租约生命周期收口、N7 提交追溯前置治理与
  N7 回归耗时优化；未授权真实 MySQL、Migration、Push、Merge、Tag、Release、Deploy。
- 基线：`work/m1-core-rebaseline-20261102`；起始工作树干净；`core.hooksPath` 已本地激活为 `.githooks`。
- N7 根因与永久修复：§37.32 最终证据提交 `59eccd5` 的消息未引用 `docs/status/PROJECT_STATUS.md §37.32` 或
  完整路径，最终 HEAD current N7 fail closed。永久修复为「提交追溯前置治理」（`a16b021`）：
  `prepare-commit-msg` 自动为受治理路径追加 `Docs-Trace:` 追溯行，`commit-msg` 校验，另有独立入口
  `scripts/git/check-commit-traceability.mjs check-commit HEAD` 与正式 N7
  （`check-doc-consistency.mjs --mode current --only N7`）。`--no-verify` 只能跳过 `commit-msg`；
  `prepare-commit-msg`、独立检查与正式 N7 仍是防线。
- 六提交历史修正 SHA 映射（前四提交不变）：`84bca44`→`84bca44`、`c8145c2`→`c8145c2`、`cb8538a`→`cb8538a`、
  `b49afed`→`b49afed`、`59eccd54`→`f3d67edc`、`59dec19e`→`1a59b410`。旧/新 Combined 最终 Tree 一致：
  `132fe40c96547e3c43223c5e85370112f6aeead2`；备份分支 `backup/m1c-wp7-combined-pre-r1-59dec19` 保留旧历史。
- G07（`9c20e60`）：Root Runner、生产 HTTP fixture builder、Root/Child/Cleanup/Quarantine/Recovery 离线生命周期
  已收口；Child Lease 由 HMAC 改为 Ed25519 —— 根持私钥、子进程仅持公钥，子进程不能自行签发扩权 lease；
  target/SHA/operation/PID/父进程持续校验；子进程未确认退出时禁止 cleanup。CR-01～CR-09 仍 `NOT_RUN`；
  真实 MySQL parity 仍 `READY_TO_EXECUTE / NOT_RUN`。
- N7 回归耗时优化（`4f20900`）：改用最小临时仓库与临时 `n7-test-anchor`，隔离临时子进程 Git 配置
  （`GIT_CONFIG_GLOBAL=NUL` / `GIT_CONFIG_NOSYSTEM=1`），不读取用户全局配置；T01～T31 断言、受治理范围与
  正式 anchor 均未改。耗时由约 1555s 降至约 63s。
- 门禁：Build PASS；current（HEAD）N1/N3～N9 PASS、N2 RETIRED；current N7-only PASS；migration C1～C6 PASS；
  `check-commit-traceability.mjs check-commit HEAD` PASS；`git diff --check` PASS；N7 回归 + 提交追溯测试 4/4 PASS。
  FAST 534/534 PASS（本轮未重跑）；FULL 本轮被用户要求中止，登记 `NOT_RERUN / ABORTED_AT_USER_REQUEST`，
  不写 PASS。真实 MySQL parity 仍 `READY_TO_EXECUTE / NOT_RUN`。
- 未发生：MySQL 连接/初始化/create/drop/reset、Migration、Push、Merge、Tag、Release、Deploy。
- 本条只登记 R1 收口；不签发 G07 PASS、M1-Core Acceptance、Domain Closure、Freeze 或 Release。详见
  [`docs/acceptance/m1-core-wp7-r1-closure-20261104.md`](../acceptance/m1-core-wp7-r1-closure-20261104.md)。

```text
M1C_WP7_R1_READY_FOR_INDEPENDENT_REVIEW
```

### 37.34 M1-Core `M1C-WP7-G07-R2` 真实 MySQL Gate 执行准备收口（2026-11-04）

- 授权：用户以已推送 GitHub SHA `6a13b1f8a251d9fbd61d17d80e69a08c566406a0` 为基线，授权集中修复
  独立代码复核发现的 G07 执行准备缺口；本轮**只执行离线实施与验证**。未授权连接 MySQL、签发/消费真实
  ACK-4 capability、执行 Gate、M-15 历史 Migration 或 destructive SQL，亦未授权 Push/Merge/Tag/Release/Deploy。
- P0-A 固定内嵌 Fixture：新建 `server/test-support/m1-core-g07-fixtures.js`，以 versioned 源码模块取代任意外部
  `--fixture-plan`。每项 CR 固定 handler/method/route/双授权主体/共享资源/具体数量（取自 §13.1.3）；
  `computeM1CoreG07FixtureDigest` + 固定 `M1_CORE_G07_FIXED_FIXTURE_DIGEST` 摘要静态校验；技术性 L2 前置
  （disposable target、`mysql_transaction_gates`、RBAC 角色种子、M-15 `identity_key`）逐项枚举不冒充 L1；
  `assertFixedFixtureManifest` 在消费 ACK-4 前 fail closed。root 与 launcher 已移除 `--fixture-plan`/`-FixturePlan`。
- P0-B 独立 Oracle：`m1-core-g07-contract.js` 增 `assertG07Result`（恰一成功/恰一指定失败 + 拒绝审计恰 1 +
  胜者幂等恰 1 + 败方零副作用），接入 `assertSafeIntegerCents` / PO Item 稳定 / 通用 PO 注入拒绝 / PO Change
  拒绝 / UAT-14 VMI / G03 分层等补充合同**实际断言**；负向控制证明双成功、错误 code、额外幂等、重复审计、
  败方副作用均使 oracle FAIL。integration 不再依赖 plan 自供快照作为唯一 Oracle。
- P0-C 独立 postflight：`m1-core-g07-child.mjs` 新增只读 `postflight` 模式，用 `wave10ObjectInventory` 统计
  tables/views/triggers/routines/events 五类对象；root 在 cleanup 后派发独立 postflight 子进程，五类零对象证明
  通过后才允许 `finalizeAck4Run` 进入 `FINISHED`，否则 `CLEANUP_UNVERIFIED` + Quarantine。launcher 最终报告改为
  读取 root 输出的 ACK-4 `state`，不允许 launcher FAIL 而 root 已 `FINISHED`。
- P1 子进程/并发：`waitForExit`/`hasExited` 抽到 `m1-core-g07-child-lifecycle.mjs`，处理正常/非零/SIGTERM/
  exit-before-wait 三态；`mysql-m1-core-g07.integration.js` 的锁等待观测改用 `performance_schema.data_lock_waits`
  证明真实争用同一事务门，观测不到即 FAIL，不以 `sleep` 猜竞争。
- 离线回归（本轮实际重跑）：FAST `543/543`、FULL `3270/3270`（399 suites）、Build PASS、`git diff --check` PASS；
  新增 `scripts/gates/m1-core-g07-child-lifecycle.test.js` 纯多进程测试（不连 MySQL）。
- 真实 MySQL 仍 `NOT_RUN`：CR-01～CR-09 真实执行、真实 `information_schema` parity、真实 lock-wait 竞争观测、
  真实 postflight 零对象证明、M-15 历史 Migration、MySQL 连接/create/drop/reset、ACK-4 capability 签发/消费、
  Gate 执行、Push/Merge/Tag/Release/Deploy 均未发生。
- 本条只登记 R2 执行准备收口；不签发 G07 PASS、M1-Core Acceptance、Domain Closure、Freeze 或 Release。详见
  [`docs/acceptance/m1-core-wp7-g07-r2-readiness-20261104.md`](../acceptance/m1-core-wp7-g07-r2-readiness-20261104.md)。

```text
M1C_WP7_G07_R2_READY_FOR_INDEPENDENT_REVIEW
```

### 37.35 M1C-G07-EXECUTION-READINESS-FINAL 最终集成闭环（2026-11-04）

- 当前状态：`IMPLEMENTED / READY_FOR_INDEPENDENT_REVIEW`；`M1C-G07` 继续为 `NOT_RUN`，未签发 Gate PASS、
  M1-Core Acceptance、Domain Closure、Freeze 或 Release Readiness。
- 基线/分支：`58a1c2bb587bd51ce918db9821ea347bae9df680` / `work/m1-core-rebaseline-20261102`。
- 本轮提交：`efb5e52`（同源 Fixture + 九项 SQLite HTTP Setup）、`ad14cbd`（权威全快照 Oracle）、
  `346444c`（ACK-4 静态预检和 Root/Child/Launcher 边界）。`package.json` 仍为 `1.6.2`，release tag 未变。
- 九项 Setup：CR-01～CR-09 均为 `FIXED_FIXTURE_SQLITE_HTTP_SETUP_PASS`；仅证明正式 HTTP Setup 可达，
  不证明 MySQL 并发。
- Oracle：败方零业务效果由权威业务表差分证明，不再从幂等记录数推导；六类篡改负控（库存腿、WIP、成本、
  PO Item、拒绝审计、业务来源）均 fail-closed；真实 Suite 注册 Schema Parity、PO Stable/Injection/Change、
  UAT-14、G03 L1/L2、Safe Integer。
- ACK-4：固定 digest/九 CR/route+body/env+subjects+L2/operation manifest/target binding 全部在消费前静态校验；
  App/Suite 不初始化 schema；Root 仅在进程退出、测试通过、独立五类零对象 cleanup 证明及 exit 0 全部成立时进入
  `FINISHED` 并允许 Launcher 返回 0。
- 权限治理：委外业务、委外收货、IQC 存在非 admin 主体；`RECEIPT_NOTICE_MANAGE`、`PO_CHANGE_MANAGE`、
  `PROCUREMENT_CONFIG_MANAGE`、`ENGINEERING_BOM_MANAGE` 仍为 admin-only 差距。本轮未扩大角色，admin 行为不作为 SOD 证据。
- 本轮离线门禁：focused 30/30、FAST 546/546、FULL 3282/3282（400 suites）、Build 1968 modules，全部 PASS。
- 未发生：MySQL 连接、ACK-4 签发/消费、Migration、数据库 reset/create/drop、Push、Merge、Tag、Release、Deploy。
- 仍需真实 MySQL：CR-01～CR-09 并发、A/B lock waiter、information_schema parity、补充 Oracle、独立 postflight
  五类零对象及最终 Root `FINISHED`；在独立授权前均保持 `NOT_RUN`。

详细证据：`docs/acceptance/m1-core-wp7-g07-r2-readiness-20261104.md §9`。

### 37.36 M1C-G07 一次性真实 MySQL 执行与 M1-Core Acceptance 候审（2026-11-05）

- 授权与基线：项目所有者授权仅对 `work/m1-core-rebaseline-20261102` @
  `9bcbedab078d5cc707e2af0f928452042c74e6f3` 执行一次 G07；Run ID
  `1197f81a-4a9c-4587-944c-64f11cbad47c`，目标仅为 `modern_erp_domain_test`，四项操作 manifest 不变。
- Preflight：本地/GitHub/Gitee SHA 一致，工作树干净；MySQL 8.0.37、八字段身份、最小权限、
  五类空对象、`log_bin_trust_function_creators=1`、`performance_schema.data_lock_waits` 可读、无 quarantine、
  端口空闲、固定 digest/9 CR/四操作均 PASS。两个 mysqld 与启动配置缺失风险保持 `OPEN`。
- ACK-4：新 Capability 在 10 分钟窗口内签发并原子消费，未复用旧 Run/Capability；5 个 child lease 均已消费。
- 真实结果：Fixture Setup 在 `CR-08.issue` 的
  `POST /api/procurement/outsourcing/orders/{orderId}/issues` 返回 HTTP 500 / `ER_DATA_TOO_LONG`；Suite 未启动，
  CR-01～CR-07 与 CR-09 的并发/lock-wait/parity/oracle 均不得记 PASS。Root = `FAILED`，
  `testsPassed=false`、`childrenExited=true`、`cleanupProven=true`，cleanup 1 次、无 quarantine。
- 事后只读 postflight：tables/views/triggers/routines/events 再次为 `0/0/0/0/0`；HTTP 端口已释放；
  Capability 已消费，严禁同 Run 重跑。
- Acceptance 候审：G01～G04/G06 = `INCONCLUSIVE`，G05 = `INCONCLUSIVE`（独立技术审查 PASS，
  Owner Acceptance 待定），G07 = `FAIL`；本轮结论为 `M1_CORE_ACCEPTANCE_BLOCKED`，未签发任何
  Gate PASS、M1-Core Acceptance、Domain Closure、Freeze 或 Release Readiness。

详细脱敏证据与七项 Gate 矩阵：
[`docs/acceptance/m1-core-g07-execution-and-acceptance-review-20261105.md`](../acceptance/m1-core-g07-execution-and-acceptance-review-20261105.md)。

### 37.37 M1C-G07 CR-08 MySQL 幂等键长度离线修复候审（2026-11-05）

- 基线与证据边界：真实失败仍锚定 `9bcbedab078d5cc707e2af0f928452042c74e6f3`；该次运行只证明
  `CR-08.issue` 返回 HTTP 500 / `ER_DATA_TOO_LONG`，未动态证明具体超长列。
- 离线根因核查：`outsourcing-inventory.js` 生成的 CR-08 LOT 发料 mutation key 为 137 字符；现行委外
  UUIDv4 模板最长为 SERIAL 补料 145 字符。该完整键原样写入
  `inventory_mutation_log.idempotency_key`，而 SQLite `TEXT NOT NULL UNIQUE` 经既有 MySQL 通用规则生成
  `VARCHAR(128)`，形成与失败完全一致的确定性 Schema 缺陷链。同一路径的 WIP effect key 最长 128 字符、
  request fingerprint 固定 67 字符；现有真实错误未返回列名，具体运行时列仍待新授权的真实 MySQL 验证。
- 最小修复：仅将 `inventory_mutation_log.idempotency_key` 的 MySQL 物理类型限定为 `VARCHAR(191)`；
  完整键与 `UNIQUE` 保持不变，SQLite 逻辑 Schema、其他表同名列及通用类型规则均未改变。
- 离线验证：M1C Schema parity 15/15 PASS；既有 MySQL Schema、inventory mutation、委外核心及 G07
  SQLite smoke focused 测试合计 77/77 PASS；`git diff --check` PASS。
- 状态：`M1C_G07_CR08_MYSQL_LENGTH_FIX_READY_FOR_REVIEW`。真实 MySQL Gate 未重跑，G07 仍为 `FAIL`，
  M1-Core Acceptance 仍为 `BLOCKED`；后续真实验证必须使用新 SHA、新 Run ID 与独立 ACK-4 授权。

### 37.38 M1C-G07 新 SHA 单次真实 MySQL 重跑（2026-11-05）

- 授权基线：`2ed357123a4ef5501575eeca266ec9a20d4341e9`；Run
  `a4c97802-cc79-42e0-9c1b-c2e2a7e019df`；GitHub/Gitee/本地 SHA 一致，执行前工作树 clean。
- Preflight：固定身份、最小权限、五类空对象、`trust=1`、performance_schema 锁观测、端口、quarantine、
  Fixture digest / 9 CR / 6 主体 / 5 L2 / 四操作合同全部 PASS；既知双 mysqld 与配置缺失风险保持 OPEN。
- 真实执行：ACK-4 已签发并消费；Reset、Bootstrap、App 启动、六主体登录与 Fixture builder 已越过上次
  `CR-08.issue` Setup 阻断并创建 Suite。Suite child 退出 `1`，Root=`FAILED`，Launcher exit=`5`。
- 证据限制：Root 仅持久化 child stderr，逐项 TAP/stdout 丢失，故 CR-01～CR-09、lock-wait、Parity 与
  Oracle 不得记 PASS，逐项均为 `INCONCLUSIVE`；G07 聚合为 `FAIL`。
- 安全终态：`cleanupProven=true`、`childrenExited=true`、cleanup 1 次、6 个 lease 全消费；独立 postflight
  `0/0/0/0/0`，端口释放，无 quarantine，未重试。
- 候审结论：`M1_CORE_ACCEPTANCE_BLOCKED`。G05 Owner Acceptance 及 G01～G04/G06 完整证据/裁定仍开放；
  未签发 Gate PASS、M1-Core Acceptance、Freeze、Domain Closure、Release 或 Deploy。

详细脱敏证据与 Gate 矩阵：
[`docs/acceptance/m1-core-g07-rerun-a4c97802-20261105.md`](../acceptance/m1-core-g07-rerun-a4c97802-20261105.md)。

### 37.39 M1C-G07 最终诊断与 G01～G06 Acceptance 集中候审（2026-11-05）

- 基线：保留已推送 `2ed357123a4ef5501575eeca266ec9a20d4341e9` 与失败证据提交
  `ccb3aa1b4cffffb15013e7273db43e4a74441e5c`；G07 诊断实现提交为
  `c9e63f268055fbdd64b3daf07e0bf4ad8e65bc93`，未重写历史。
- 诊断收口：Suite 非零退出会在 stdout/stderr drain 后解析全部 node:test TAP 失败，向 Root/Launcher 输出
  完整标记摘要；完整脱敏证据写入当前用户受限本地文件。FAILED exit 5、Cleanup、Quarantine、ACK-4
  生命周期及 Suite PASS/FAIL 判定不变。
- 离线验证：G07/ACK-4/lifecycle 35/35、suite governance 20/20、PowerShell 5.1 parser PASS；未连接
  MySQL、未签发 ACK-4、未执行 Gate/Reset/Bootstrap/Cleanup/Migration，未运行 FULL/Build。
- G01～G06 集中审查：G02/G05/G06 技术证据已归并为 `OWNER_DECISION_ONLY`；G05 已有
  `M1C_G05_INDEPENDENT_REVIEW_PASS` 与 Browser 24/24。真正技术缺口收敛为 G01 MySQL、G03 MySQL
  current-schema/parity、G04 真实并发，以及 G07 可恢复的 CR/lock-wait/Oracle 结果。
- 边界：延期 WIP/VMI/GL 政策不无条件成为首期阻塞，G06 的首期 fail-closed 合同仍有效且已有证据；
  空库 current-schema 不冒充历史 M-15 Migration Acceptance。两个 mysqld 与启动配置缺失风险保持 OPEN。
- 候审结论仍为 `M1_CORE_ACCEPTANCE_BLOCKED`；未签发任何 Gate PASS、包级 Acceptance、Freeze 或
  Domain Closure，下一次真实 Gate 仍须新 SHA、新 Run ID 与独立 ACK-4 授权。

集中候审记录：
[`docs/acceptance/m1-core-g01-g06-consolidated-review-20261105.md`](../acceptance/m1-core-g01-g06-consolidated-review-20261105.md)。

### 37.40 M1-Core G05 Owner Acceptance 与 M1C-G07 最终执行（2026-11-05）

- **授权与范围**：项目所有者明确批准 G05 Owner Acceptance（签发 `M1C-G05 PASS`），并基于固定 SHA
  `02f0cce70a73134b31f36a16067a633384e1c175`、Run `94e2e0c7-dba8-4aa4-95de-9767712cf5d5` 与唯一 disposable
  MySQL 目标 `modern_erp_domain_test` 最后执行一次 M1C-G07；G02/G06 继续候审；不自动重试 G07、不追加诊断
  修复循环。
- **Preflight**：本地/GitHub/Gitee SHA 一致、工作树 clean；MySQL `8.0.37`、八字段身份、最小权限、五类空对象、
  `log_bin_trust_function_creators=1`、`performance_schema.data_lock_waits` 可读、无 quarantine、端口空闲、
  固定 digest/9 CR/6 主体/5 L2/四操作均 PASS。两个 `mysqld` 进程与启动配置缺失风险保持 OPEN。
- **ACK-4**：新 Capability 在 14 分钟窗口内签发并原子消费，未复用旧 Run/Capability；6 个 child lease 全消费。
- **G07 真实执行**：Reset / Bootstrap / App-A / App-B / 六主体登录 / Fixture builder 已越过上次 `CR-08.issue`
  阻断并创建 Suite；Suite child exit `1`，Root `FAILED`、Launcher exit `5`。stdout 空、仅两行无害警告、逐项
  TAP 不可恢复，故 CR-01～CR-09、lock-wait、Parity、Oracle 均 `INCONCLUSIVE`，G07=`FAIL`。
- **根因候选（离线复现确认）**：`scripts/gates/m1-core-g07-child.mjs::suiteProcess()` 用
  `stream.pipe(process.stdout)` 捕获输出，但 `node:test` 的 `run({ isolation:'none' })` 流**不产出 TAP 文本**、
  只产出结构化事件（`test:pass` / `test:fail` / `test:diagnostic`）。离线复现证明：通过、断言失败、`before()`
  抛异常三种场景均得到「exit 1 + stdout 空」。故 §37.39 基于「解析 stdout 的 node:test TAP」的诊断链看不到
  失败测试名称与断言；该缺口与前次 Run `a4c97802` 的「stdout 丢失」同源、未闭合。具体业务失败点被该诊断
  缺口掩蔽，未放宽任何 CR / Oracle。
- **G05 Owner Acceptance**：`M1C-G05 PASS` 已签发（依据 `M1C_G05_INDEPENDENT_REVIEW_PASS`、修复后 Browser
  `24/24`、320/390/430/680 四宽度与两工作面、服务端来源级 RBAC、本轮 Owner 明确批准）；原始 `16/24` 失败历史
  完整保留；本次登记不等于重新执行 Browser；仅批准 G05、不依赖 G07 MySQL。
- **七 Gate 矩阵**：G05=`PASS`；G02/G06=`PENDING_OWNER_DECISION`；G01/G03/G04=`INCONCLUSIVE`（真实 MySQL
  逐项证据缺失）；G07=`FAIL`。
- **候审结论**：`M1_CORE_ACCEPTANCE_BLOCKED`。未签发 M1-Core 包级 PASS、Domain Closure、Freeze、Release 或
  Deploy；不提出第五次自动执行计划；G07 诊断链修复与 G01/G03/G04 真实 MySQL 验证各自需独立授权与新 Run ID。

正式证据：
[`docs/acceptance/m1-core-g05-owner-acceptance-20261105.md`](../acceptance/m1-core-g05-owner-acceptance-20261105.md)、
[`docs/acceptance/m1-core-g07-final-execution-and-acceptance-20261105.md`](../acceptance/m1-core-g07-final-execution-and-acceptance-20261105.md)。

### 37.41 M1C-G07 Runner Diagnostic Fix（2026-11-05）

- **授权与范围**：仅在 `master` @ `16a8b35270392cfa879dc2886604dcd9655f3d7e` 本地实施
  `M1C-G07-RUNNER-DIAGNOSTIC-FIX` 与完全离线验证；未连接数据库、未执行真实 G07、Reset、Bootstrap、
  Migration 或部署，未修改 CR-01～CR-09、Suite 成败标准、ACK-4、Cleanup、Quarantine 或生产业务逻辑。
- **根因与修复**：`node:test run({ isolation:'none' })` 返回结构化事件流，原 `stream.pipe(process.stdout)`
  未把事件转换为 TAP，导致 Root 的既有脱敏 TAP 解析链收到空 stdout。Suite child 现先经 Node 内置 `tap`
  reporter 将事件转换为 TAP，再交 Root 捕获；`test:fail` 仍独立控制非零退出，Root / Launcher 生命周期未改。
- **离线证据**：临时合成测试覆盖全通过、普通断言失败、`before` hook 失败、多个失败；失败名称、断言值与
  operator、hook 原因、必要 stack 均可恢复，Bearer/password 合成秘密在 Root 诊断层被替换为 `[REDACTED]`。
  G07 diagnostics / child lifecycle / infrastructure focused tests `33/33 PASS`；相关 Node 静态检查 PASS。
- **状态边界**：本修复为 `READY_FOR_INDEPENDENT_REVIEW`，不签发新的 Gate PASS。历史 G07 仍为 `FAIL`，
  G01/G03/G04 仍为 `INCONCLUSIVE`，M1-Core Acceptance 仍为 `BLOCKED`；真实 MySQL 是否暴露新的业务失败点
  未验证，任何真实复验仍须新 SHA、新 Run ID 与独立 ACK-4 授权。

### 37.42 M1C-G02 / M1C-G06 Owner Acceptance（2026-11-05）

- **Owner 决定**：业务所有者在本轮明确签发 `M1C-G02 PASS` 与 `M1C-G06 PASS`。正式记录：
  [`docs/acceptance/m1-core-g02-g06-owner-acceptance-20261105.md`](../acceptance/m1-core-g02-g06-owner-acceptance-20261105.md)。
- **证据边界**：决定基于正式 Requirement、Active Design、WP7-A 历史 HTTP/SQLite 证据、原始实施 SHA 与独立复核；
  本轮未重跑历史业务测试。Owner 接受 G02/G06 无单独真实 MySQL 验证的残余风险，但不豁免 G01/G03/G04/G07
  的真实 MySQL 与并发要求。
- **七 Gate 状态**：G02/G05/G06=`PASS`；G01/G03/G04=`INCONCLUSIVE`；G07=`FAIL`。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` 保持；未签发 M1-Core 包级 PASS、Domain Closure、Freeze、Release
  或 Deploy。
- **未发生**：Requirement/Design/业务代码/Gate 结论修改，MySQL 连接，真实 G07，ACK-4 签发或消费，
  Reset/Bootstrap/Cleanup/Migration，以及任何远端写入。

### 37.43 M1C-G07 SQL 兼容性与事务安全修复（2026-11-05）

- **历史执行保持**：`master` @ `ef973f6dc12235bf98c2fe2db62f24a94d50b9e3`、Run
  `c5ce2158-b165-4a7a-93bb-9fd649379fa5` 的真实 G07 为 `0/11 FAIL`；Root/Launcher 已证明 Cleanup，独立
  Postflight 五类对象均为 0、无 Quarantine。该失败记录不覆盖、不改写，G07 继续为 `FAIL`。
- **根因**：Schema Parity 的外键 JOIN 选择了未限定的 `CONSTRAINT_NAME`；G07 锁观测错误引用
  `performance_schema.data_locks.TABLE_NAME`；`executeRace()` 在锁观测/等待异常时存在持锁事务与 pending HTTP
  Promise 未可靠收束的风险。CR-09 supplemental failure 是前序 CR-09 未执行成功后的连带结果，未登记为独立业务缺陷。
- **修复边界**：外键列分别明确绑定 `KEY_COLUMN_USAGE k` 与 `REFERENTIAL_CONSTRAINTS r`；锁观测改为
  `OBJECT_SCHEMA=DATABASE()` + `OBJECT_NAME='mysql_transaction_gates'`，并绑定 requesting lock 的 ENGINE、
  lock/transaction/thread identity、`WAITING` 与 `PRIMARY`；成功路径只在观察到两个不同等待者后 COMMIT，异常路径
  ROLLBACK 并收束已启动请求，且清理异常不覆盖原始错误。未改生产 Handler、Fixture/digest、CR/Oracle、Root、
  Launcher、ACK-4、Cleanup 或 Quarantine 合同。
- **离线证据**：G07 infrastructure / diagnostics / child lifecycle `37/37 PASS`；同源 SQLite HTTP Fixture
  `9/9 PASS`；FAST `552/552 PASS`；生产 Build PASS；相关 Node `--check` PASS。所有结果均为离线证据，
  不冒充真实 MySQL 验证。
- **状态边界**：`READY_FOR_INDEPENDENT_REVIEW`。G02/G05/G06=`PASS`；G01/G03/G04=`INCONCLUSIVE`；
  G07=`FAIL`；`M1_CORE_ACCEPTANCE_BLOCKED` 保持。任何真实复验仍须新 SHA、新 Run ID、双远端同步与独立 ACK-4 授权。
- **未发生**：MySQL 连接、真实 G07、Reset/Bootstrap/Cleanup/Migration、旧 Run ID/ACK-4 复用、Push/Merge/Tag/
  Release/Deploy 或历史重写。

### 37.44 M1C-G07 异常路径 HTTP 收束安全修复（2026-11-05）

- **复核输入**：独立复核对 `fc7bdfe79a8c4f2cd238889a6538f1ca2208e798` 给出 `CHANGES_REQUIRED`；唯一阻塞为
  `runG07GateRace()` 在异常路径无界等待 pending HTTP。37.43 已通过的 Schema Parity、锁查询、双等待者证明及正常
  COMMIT/ROLLBACK 路径未重构。
- **修复边界**：真实 G07 的两个 `fetch` 请求接入独立 `AbortSignal` 和请求超时；锁观测、HTTP 拒绝或其他异常发生时先请求
  取消，再尝试 ROLLBACK，并仅在明确上界内等待请求收束。若请求不响应取消，主错误保持不变，同时追加
  `M1_G07_HTTP_SETTLEMENT_UNVERIFIED`，并固定记录 `businessEffectsProven=false`、`cleanupProven=false`；ROLLBACK
  失败另附 `M1_G07_GATE_RELEASE_FAILED`，不得冒充安全清理或 PASS。
- **成功合同保持**：仍须观察两个不同的真实等待者后才 COMMIT；随后仍按原 HTTP 结果和既有 Oracle 判定。未改生产 Handler、
  Fixture/digest、CR-01～CR-09、Root、Launcher、ACK-4、全局 Cleanup 或 Quarantine。
- **离线证据**：G07 infrastructure / diagnostics / child lifecycle `39/39 PASS`；同源 SQLite HTTP Fixture `9/9 PASS`；
  FAST `554/554 PASS`；生产 Build PASS；相关 Node `--check` PASS。沙箱内既有 Windows ACL 用例因权限限制失败，获准在
  沙箱外完全离线复跑后通过；不属于本次代码回归。
- **状态边界**：`READY_FOR_INDEPENDENT_REVIEW`。历史 G07 继续为 `FAIL`，`M1_CORE_ACCEPTANCE_BLOCKED` 保持；本轮证据不
  构成真实 MySQL 验证或 Cleanup 证明。
- **未发生**：MySQL 连接、真实 G07、ACK-4、Reset/Bootstrap/Cleanup/Migration、Push/Merge/Tag/Release/Deploy
  或历史重写。

### 37.45 M1C-G07 超时请求迟到成功拒绝（2026-11-05）

- **复核输入**：独立复核对 `93646ff1e2881790f3fec2179b5ba8a14bce4834` 指出唯一剩余阻塞：请求触发超时取消后，
  若底层 Promise 忽略 signal 并迟到 fulfilled，旧 tracker 仍可能把该响应作为成功结果。
- **修复边界**：request tracker 将首次超时/取消及其原因固化为不可逆状态；底层随后 fulfilled 或 rejected 均不能覆盖该状态。
  Race 正常返回前再次确认全部请求均未超时、未取消。HTTP JSON 解析仅对普通非 JSON 响应保留 `{}` 兼容，signal 已取消或
  `AbortError` 必须继续抛出。未改 SQL、锁身份、事务释放、Fixture、CR/Oracle、Root、ACK-4 或 Quarantine 合同。
- **离线证据**：迟到成功负控实际观察到 abort 后返回 `201`，Race 仍以 `M1_G07_HTTP_REQUEST_TIMEOUT` FAIL；G07
  infrastructure / diagnostics / child lifecycle `40/40 PASS`；FAST `555/555 PASS`；生产 Build 与相关 Node `--check` PASS。
- **状态边界**：`READY_FOR_INDEPENDENT_REVIEW`。历史 G07=`FAIL`、`M1_CORE_ACCEPTANCE_BLOCKED` 均保持；未连接 MySQL，
  未执行真实 G07、ACK-4、Reset/Bootstrap/Cleanup/Migration 或任何远端写入。

### 37.46 M1C-G07-FINAL-FIX 两项真实阻塞闭合候审（2026-11-06）

- **代码候选提交**：`6d88db8d7a686f2dd283ef58373f02a6fb53b3ec`（本地，未推送）。
- **输入与历史边界**：仅读复核历史 Run `dcfbf040-240c-4630-b2cb-31e2e8eaa062` 的已有脱敏失败
  日志；该 Run 仍为 `9 PASS / 2 FAIL`，Cleanup `PROVEN`，G07=`FAIL`。本轮未重跑真实 Gate。
- **CR-02**：根因是 convert 产生的 DRAFT 采购入库单尚未完成 IQC，两个确认均被生产质量门禁
  409 拒绝。已编制只在 convert 后以 `warehouse` 主体调用 `/api/iqc` 创建与 PASS 完成的未启用
  候选；新 digest `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`。当前 builder /
  static preflight / ACK-4 仍只可消费旧 digest `2202e6c2…c808c`；等待 Owner 批准前不得启用。
- **Schema Parity**：14 张失败表逐项核对为 default 字面量/DECIMAL 零值表示、SQLite autoindex
  与 MySQL 约束索引名、CHECK 字符集 introducer，以及已批准 digest 生成列/物理索引差异；
  未发现真实缺列、缺 UNIQUE、缺 CHECK 或错误 default，未修改 Schema / Migration / DDL。比较器仅对
  上述已验证表示做语义等价处理，并保留真实缺列、缺唯一约束、缺 CHECK、错误 default 的 FAIL 负控。
- **离线验证**：focused `77/77 PASS`；FAST `558/558 PASS`；Build PASS；相关 Node `--check` PASS；
  docs current / migration 与 `git diff --check` 见本逻辑单元最终交付记录。
- **状态边界**：Parity 修复为 `READY_FOR_INDEPENDENT_REVIEW`；CR-02 Fixture 为 `PENDING_APPROVAL / INACTIVE`。
  G07 继续 `FAIL`，`M1_CORE_ACCEPTANCE_BLOCKED` 保持；未执行 MySQL Gate、ACK-4、Migration、Reset /
  Bootstrap / Cleanup，未 Push / Merge / Tag / Release / Deploy。

详细 14 表差异、候选 digest 与审批边界见
[`docs/acceptance/m1-core-g07-final-fix-review-20261106.md`](../acceptance/m1-core-g07-final-fix-review-20261106.md)。

### 37.47 M1C-G07 CR-02 Fixture Owner 批准与激活（2026-11-06）

- **批准来源与范围**：Modern ERP 项目 Owner 明确批准 digest
  `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`，仅批准在 CR-02
  `convert` 后由 `warehouse` 主体创建采购入库 IQC 并完成 PASS。
- **唯一运行时版本**：上述两步已并入 `M1_CORE_G07_FIXED_SCENARIOS`，该 digest 已成为唯一批准固定值；
  独立候选导出已移除。旧 digest `2202e6c2…c808c` 仅保留为历史追溯，不再由 Builder、Static Preflight
  或测试消费。ACK-4 定义会引用同一固定版本，但本轮没有签发或消费 ACK-4。
- **离线验证**：同源 disposable SQLite Fixture 通过真实生产 HTTP 得到 IQC 创建 `201`、PASS 完成
  `200`、质量状态 `PASS`、采购入库确认 `200`；9 个 CR fixture 全量通过。focused `78/78 PASS`；
  FAST `559/559 PASS`；Build PASS；相关 Node `--check` 与 digest 一致性校验 PASS。
- **状态边界**：本节只记录已批准 Fixture 的激活实施，不重写历史 Run
  `dcfbf040-240c-4630-b2cb-31e2e8eaa062` 的 `9 PASS / 2 FAIL` 与 Cleanup `PROVEN`。
  G07 继续 `FAIL`，`M1_CORE_ACCEPTANCE_BLOCKED` 保持；未执行真实 MySQL G07、ACK-4、Reset、Bootstrap、
  Cleanup、Migration、自动重试或任何远端写入。

### 37.48 M1C-G07 正式 Owner Acceptance（2026-11-07）

- **Owner 决定**：业务所有者在本轮明确签发 `M1C-G07 PASS`。正式记录：
  [`docs/acceptance/m1-core-g07-owner-acceptance-20261107.md`](../acceptance/m1-core-g07-owner-acceptance-20261107.md)。
- **执行锚点**：Commit SHA `054ebb67eb7ea5b1a82b0d51a70d54e76aaceb68`；Run ID
  `b29c3f1f-8175-42ed-9e9c-2f0faff16798`；Manifest `M1_CORE_G07_V1`；Fixture digest
  `9816affb…d71091`；目标 `modern_erp_domain_test`（`modern_erp_test@127.0.0.1:3306`）；
  ACK-4 已消费且不可复用（签发 `16:17:55.905Z`，消费 `16:18:06.940Z`，14 分钟窗口内）。
- **验收证据**：注册套件 11/11 PASS、Suite child exit 0；Schema Parity 16 张表全部 MATCHED；
  CR-01～CR-09 全部通过真实生产 Handler 与 MySQL 并发 Oracle；Supplemental Oracle PASS；Root
  `FINISHED`（`testsPassed=true`、`cleanupProven=true`、`childrenExited=true`），四操作严格按序、
  6 个 child lease 全部消费；Cleanup 一次完成、Postflight PROVEN；五类 Schema 对象归零
  `0/0/0/0/0`；Quarantine NONE；端口 33101 / 33102 已释放。
- **证据边界**：逐项 TAP PASS 原文未持久化（11/11 结论由已注册套件与完整执行链的成功机器状态支持）；
  最小权限下 `information_schema.INNODB_TRX` 不可直接读取，「无残留活动事务」由
  `data_lock_waits=0` / `data_locks=0` / `PROCESSLIST=1` 间接证明，风险保留；历史失败 Run
  `94e2e0c7` / `a4c97802` / `c5ce2158` / `dcfbf040` / `df0202b6` / `a78b0d3e` 的原始结果与脱敏
  证据完整保留，不覆盖、不改写。
- **七 Gate 状态**：G02/G05/G06/G07=`PASS`；G01/G03/G04=`INCONCLUSIVE`。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` 保持。本决定**仅**签发 `M1C-G07 PASS`，
  不签发 M1-Core 包级 Acceptance、Capability Freeze、Domain Acceptance 或 Release Readiness。
- **未发生**：本轮未执行 Requirement/Design/业务代码/Fixture/DDL/Oracle 修改，未重启 MySQL、
  未改变数据库权限、未修改目标身份、未签发第二份 ACK-4、未复用历史 Run ID、未自动重跑、
  未执行额外 Migration。

### 37.49 M1C-G03 Owner Acceptance 与 G04 D-2 Design 裁定（2026-11-07）

- **G03 Owner 决定**：Procurement & Outsourcing Domain Owner 明确接受真实 MySQL 四事件 Mutation
  Log/Key/身份完整重演尚未证明、G07 16 表 Schema Parity 不含 `inventory_mutation_log` 等有界残余风险，
  正式签发 `M1C-G03 PASS`。正式记录：
  [`docs/acceptance/m1-core-g03-owner-acceptance-20261107.md`](../acceptance/m1-core-g03-owner-acceptance-20261107.md)。
- **G04 D-2 Design 裁定**：批准 `M1C-G04-D2 DESIGN_AMENDMENT_APPROVED`，仅修订 Active Design
  §13.1 的可达性与证据层级表述：合法 L1 净供应不足与 L3 历史异常负增量防御分层，保留原 409 守卫、
  严格支持范围、事务、业务事实零变化及拒绝审计恰一。修订记录：
  [`docs/acceptance/m1-core-g04-d2-design-amendment-20261107.md`](../acceptance/m1-core-g04-d2-design-amendment-20261107.md)。
- **七 Gate 当前状态**：G02/G03/G05/G06/G07=`PASS`；G01/G04=`INCONCLUSIVE`。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` 保持；不签发 Capability Freeze、Domain Acceptance、
  Manual Closure、Release Readiness 或 Release。
- **未发生**：未修改生产代码、Requirement、DDL、Fixture、G07 Oracle 或已签发 Owner Acceptance；
  未执行真实 MySQL、ACK-4、Migration、Push、Merge、Tag、Release 或 Deploy。

### 37.50 M1C-G04 正式 Owner Acceptance（2026-11-07）

- **Owner 决定**：Procurement & Outsourcing Domain Owner 选择 `ACCEPT_BOUNDED_RESIDUAL_RISK`，
  明确接受正式记录 §4 的六项有界残余风险并签发 `M1C-G04 PASS`。正式记录：
  [`docs/acceptance/m1-core-g04-owner-acceptance-20261107.md`](../acceptance/m1-core-g04-owner-acceptance-20261107.md)。
- **证据范围**：SQLite 生产 HTTP 覆盖受支持基数的增量倒冲、位置成本、成品唯一 Writer、重放、
  合法净供应不足及有标记的 L3 历史异常负增量防御；历史 G07 Run `b29c3f1f` 的 CR-03/07/08
  仅作为真实 MySQL 竞争子集，不外推为败方既有业务行全字段零变化或全部 G04 腿的完整 MySQL 重演。
- **残余风险保持显式**：MySQL 败方完整零副作用未充分证明、并发覆盖有限、负增量仅防御性证明、
  历史库与浮点边界未穷尽、暂估成本不等于 AP/GL 完结、G07 WP-K 证明偏差未由本决定追认。
- **七 Gate 当前状态**：G01=`INCONCLUSIVE`；G02/G03/G04/G05/G06/G07=`PASS`。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` 保持；本决定不签发 Capability Freeze、Domain Acceptance、
  Manual Closure、Release Readiness 或 Release。
- **未发生**：未修改 Active Requirement/Design、生产 Handler、测试、Fixture、DDL 或 G07 Oracle；
  未执行真实 MySQL、G07、ACK-4、Migration、Push、Merge、Tag、Release 或 Deploy。

### 37.51 M1-Core G07 WP-K 证据边界与包级验收风险裁定（2026-11-07）

- **Owner 决定**：Procurement & Outsourcing Domain Owner 批准追加式证据边界裁定，正式标识
  `M1C_G07_WPK_EVIDENCE_BOUNDARY_ACCEPTED_FOR_PACKAGE_REVIEW`。正式记录：
  [`docs/acceptance/m1-core-g07-wpk-owner-adjudication-20261107.md`](../acceptance/m1-core-g07-wpk-owner-adjudication-20261107.md)。
- **裁定内容**：采纳候审草案 §3 的追加式证据边界说明；**有条件接受**「竞争败方既有业务行逐字段
  零变化尚未证明」这一残余证据偏差，允许其**仅**在 M1-Core 内部首期包级验收评估中作为明确例外
  引用；`M1C-G07 PASS` **保持不变**，不得将未充分证明的断言描述为已证明。
- **例外范围限定**：仅处理 Oracle **测量强度**差距；不豁免真实业务数据丢失、库存估值破坏、
  未授权写入或未来观测到的生产缺陷，也不授权正式发布。
- **WP-J 处置**：本轮**暂不授权**执行，标记 `DEFERRED_NOT_AUTHORIZED`；未来若要求以实证关闭该风险，
  须取得独立授权、新 Oracle、独立新 Run ID 与新 ACK-4，历史 Run `b29c3f1f` 不可追认。
  WP-D 的 D-1 / D-2 已在 G04 后续独立流程办理，不再作为 WP-K 的开放裁定事项。
- **历史不可改写**：已签发 `M1C-G07 PASS`（§37.48）、候审草案 §1.3 恒真项与其余失败 Run 记录保持原样。
- **七 Gate 状态（本节后不变）**：G02/G03/G04/G05/G06/G07=`PASS`；G01=`INCONCLUSIVE`。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` 保持；本裁定不签发 M1-Core 包级 Acceptance、
  Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness 或 Release。
- **未发生**：未修改 Active Requirement/Design、生产 Handler、DDL、Fixture、G07 Oracle、CR 集或
  ACK-4 合同；未连接真实 MySQL、未运行 G07、未签发或消费 ACK-4、未执行 Reset/Bootstrap/Cleanup/
  Migration、未 Push、Merge、Tag、Release 或 Deploy。

### 37.52 M1C-G01 正式 Owner Acceptance（2026-11-07）

- **Owner 决定**：Procurement & Outsourcing Domain Owner 选择 `ACCEPT_BOUNDED_RESIDUAL_RISK`，
  明确接受正式记录 §4 的五项有界残余风险并签发 `M1C-G01 PASS`
  （`M1C_G01_OWNER_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL`）。正式记录：
  [`docs/acceptance/m1-core-g01-owner-acceptance-20261107.md`](../acceptance/m1-core-g01-owner-acceptance-20261107.md)。
- **证据范围**：SQLite L1 生产 HTTP `server/m1c-wp1-procurement-notice-conversion.test.js` 26/26
  （WP7-A 原始 25 例 + 后补 D0，来源提交 `84bca44`；26/26 基线运行在来源文档中以「本轮基线实测」
  登记，**不携带独立 Run ID 或专属 HEAD SHA 锚点**）；真实 MySQL 仅 G07 Run `b29c3f1f` 的
  CR-01（容量 10 / 请求各 6，恰一 `201` 与恰一 `409 RECEIPT_NOTICE_CAPACITY_EXCEEDED`）与
  CR-02（恰一 `200` 与恰一 `409 PURCHASE_RECEIPT_ALREADY_CONFIRMED`）并发子集；16 张指定表
  Schema Parity 全 MATCHED。
- **明确不主张**：**不主张** WP-I 已执行或 G01 全部流程已在真实 MySQL 验证；**不主张** G07 Oracle 的
  「竞争败方既有业务行逐字段零变化」缺口已消除；**不主张** G01 已完成跨引擎行为对等证明。
- **残余风险保持显式**：跨引擎等价未证明、真实 MySQL 拒绝路径全字段零业务变化未充分证明、
  事务交错覆盖有限、历史存量来源与交期未作现场核验、Schema Parity ≠ 行为 Parity。
- **WP-I 处置**：保持 `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED`，作为**公开残余风险**继续登记，
  不因本 Gate PASS 标记为 DONE；历史 G07 ACK-4 不可复用。
- **七 Gate 当前状态**：**7 / 7 `PASS`**（附有界残余风险）。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` **保持**。七 Gate 全 PASS **不自动**签发 M1-Core 包级
  Acceptance；须另行审查并正式接受全部跨 Gate 残余风险。本决定不签发 Capability Freeze、
  Domain Acceptance、Manual Closure、Release Readiness 或 Release。
- **未发生**：未修改 Active Requirement/Design、生产 Handler、测试、Fixture、DDL 或 G07 Oracle；
  未执行真实 MySQL、G07、ACK-4、Migration、Reset/Bootstrap/Cleanup、Push、Merge、Tag、Release
  或 Deploy。

### 37.53 M1C-PACKAGE-R1：WP-K-R1 证据边界裁定与 B-2 Active Design 状态指针修订（2026-11-07）

- **授权与范围**：项目 Owner 在当前对话中**总体授权** ChatGPT 主导 M1-Core 剩余验收推进，并**明确批准**
  ①「WP-K-R1 按有界残余风险接受方案正式落地」、②「B-2 Active Design 的三处纯状态指针修订」、
  ③本轮必要的本地文件修改、非破坏性校验与**本地 Git commit**；**不要求**重新执行 WP-I、WP-J、M-15
  或真实 MySQL G07；**本轮不运行 HEAVY**（若发现新的硬性验收条件要求 HEAVY，必须明确报告，不得擅自执行
  可能具有数据库破坏性的测试）。明确禁止 Push、Merge、Tag、Release、Deploy。
- **WP-K-R1 裁定**：正式标识 `M1C_G07_WPK_R1_EVIDENCE_BOUNDARY_ACCEPTED_WITH_BOUNDED_RESIDUAL`。
  记录：[`docs/acceptance/m1-core-g07-wpk-r1-owner-adjudication-20261107.md`](../acceptance/m1-core-g07-wpk-r1-owner-adjudication-20261107.md)。
  - 机器可复跑口径：断言槽位 **54**（9 CR × 6 effects）＝ **36** 固定期望槽位（9 × 4）＋ **18** 胜败业务行
    槽位（9 × 2）；**从未重算合计 29** ＝ 原 WP-K 已披露 **25**（18 胜败 ＋ 7 个 `identityDelta`）
    ＋ 本次新增披露 **4**（`CR-01.amountDeltaCents`、`CR-02/CR-03/CR-07.documentDelta`）；真实重算 **25**。
  - **35 个 (CR, 表) 组合**在对应真实 MySQL G07 Oracle 中**缺少业务不变量校验**；**完全没有任何测试覆盖的
    组合为 0 个** —— 涉及的全部 9 张表在 SQLite 层均存在补偿证据。
  - **口径纪律**：已有 SQLite 测试**仅**作**不同层级**的补偿证据，**不能**证明这些真实 MySQL 场景逐字段
    无异常，**不**构成跨引擎等价证明。
  - **继续保留的真实有效断言**：G07 11/11 注册套件、16/16 Schema Parity MATCHED、CR-01～CR-09 的胜败与
    精确错误码、拒绝审计关联、幂等、来源匹配、Cleanup / Postflight、五类 Schema 对象归零 —— 均**继续具
    证明力**，不因本裁定被削弱或撤销。
  - **风险接受边界**：仅处置 Oracle **测量强度**差距的扩大披露；**仅**用于 M1-Core 内部**首期包级验收评估**；
    **不豁免**真实业务数据丢失、库存估值破坏、未授权写入或未来观测到的生产缺陷；**不授权**正式发布、
    部署或任何数据库写操作。
  - **状态保持**：WP-J 继续 `DEFERRED_NOT_AUTHORIZED`；WP-I 继续 `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED`；
    M-15 不在范围；已签发的 `M1C-G07 PASS` 与原 WP-K 裁定**原样保留**，六个历史失败 Run 记录**未改写**。
- **B-2 Design 修订**：正式标识 `M1C-DESIGN-STATUS-POINTER`。记录：
  [`docs/acceptance/m1-core-design-status-pointer-amendment-20261107.md`](../acceptance/m1-core-design-status-pointer-amendment-20261107.md)。
  - 仅修改 `docs/design/procurement-outsourcing-m1-core.md` 三处：§13.1 标题、§13.1 标题后的指针注记、
    §13.3 首条 —— 明确 `execution_status` 为 **Design 获批时的历史快照**，当前执行状态以本表为**唯一权威**。
  - **未**把当前 `PASS` 复制进 Design；**未**修改 §13.1 Gate 表任何一格（七个 Gate 的业务合同与
    `execution_status` 列取值**原样保留**）；**未**追改文件头部历史日期化注记；**未**扩大 Design 范围；
    **未**新增第二份状态登记。
- **回归适用性说明（SHA 差异）**：
  - 基线 HEAD `83e13e008c851f5a235cb95e6dfa2f08afa0a32b` 上**本轮实测**：FULL `3344/3344 PASS`
    （405 suites，0 fail / skipped / todo，369.6s，exit 0）、FAST `576/576 PASS`、Build `PASS`
    （`✓ built in 8.03s`，exit 0）、Docs current `ALL CHECKS PASSED`、Docs migration C1～C6
    `ALL CHECKS PASSED`、`git diff --check` `PASS`。
  - 本工作包为**纯文档变更**：`server/`、`src/`、`scripts/` **零改动**，`git diff --name-only` 仅涉
    `docs/**` 与 `log/**`。因此上述 FULL / FAST / Build 结果**继续适用**，**无需**为纯文档改动重复执行完整
    FULL；其真实执行 SHA 即 `83e13e00`，本工作包的提交 SHA 与之的差异**仅为文档与日志**。
  - 执行隔离：FULL / FAST 均在剥离 `ERP_MYSQL_TEST_ALLOW_RESET` 等 12 个 MySQL 指向变量的子进程中运行，
    `ERP_DB_BACKEND=sqlite`、`ERP_DB_PATH` 缺席；执行身份 `DESKTOP-OVOCP1N\Administrator`（High Integrity），
    与历史 `3344/3344` 记录令牌一致。
- **七 Gate 状态**：**7 / 7 `PASS`**（附有界残余风险）——**不变**。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` **保持**。本轮**不**签发 M1-Core 包级 Acceptance、
  Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Tag、Release 或 Deploy。
- **旧 13 Gate 边界**：**未**恢复为当前验收条件或实施任务；旧 13 Gate 继续作为 **M1 全域 Closure** 的验收
  合同（Active Design §13.2），未来延期能力必须重新评估产品需要并独立授权。
- **未发生**：未修改生产代码、DDL、Fixture、G07 Oracle、G07 合同、CR 集、测试或任何已签发 Owner Acceptance；
  未连接真实 MySQL、未运行 G07、未签发或消费 ACK-4、未执行 Migration、Reset / Bootstrap / Cleanup、
  未运行 HEAVY、未 Push / Merge / Tag / Release / Deploy；未虚构 WP-I、WP-J 或 M-15 的完成状态。

### 37.54 M1-Core 首期包级 Acceptance 候签记录与独立只读复核结论（2026-11-07）

- **候签记录**：新增
  [`docs/acceptance/m1-core-package-acceptance-candidate-20261107.md`](../acceptance/m1-core-package-acceptance-candidate-20261107.md)。
  建议决定 **`ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`**，范围**仅** M1-Core 首期七 Gate
  （`M1C-G01`～`M1C-G07`）所界定的 Procurement & Outsourcing 首期能力。
- **候签记录内容**：P1–P12 已证明项（含 G07 11/11 与 16/16 Parity 等真实有效断言、G01/G03/G04 的 SQLite L1
  业务事实断言、G05 浏览器非空洞性、当前 HEAD 回归）；R-01～R-17 已由各 Gate Owner Acceptance 逐项接受的
  残余风险；R-18 已由 WP-K 接受；R-19/R-20 本轮由 WP-K-R1 接受；D-01～D-04 明确**延期未授权**
  （WP-I、WP-J、M-15、旧 13 Gate 的 6 项 `DEFERRED` 与 9 项 RACE）。
- **独立只读复核结论**：`READY_FOR_OWNER_PACKAGE_ACCEPTANCE`。复核在提交 `dadca3d` 之后**实际执行**，
  逐项核查：B-1/B-2 **已实际落地**（Active Design 的过时现在时陈述已消除、三处指针修订已在位，
  两份正式裁定与修订记录已入库）；七 Gate PASS 记录**未被改动**；G07 Oracle 新增风险**已完整且准确地接受
  与披露**（槽位口径 54＝36＋18、未重算 29＝25＋4、35 个 (CR, 表) 组合，已在提交后源码上**重新复跑复现**）；
  FULL / Build / Docs 证据可追溯至实测 SHA `83e13e00`；**未发现**新的业务缺陷或安全阻断；
  WP-I / WP-J / M-15 **未**被虚构为已完成；旧 M1 13 Gate **未**恢复为当前验收条件；
  **未**出现未授权的发布、部署、冻结或历史数据库修改。
- **状态保持**：七 Gate **7 / 7 `PASS`** **不变**；`M1_CORE_ACCEPTANCE_BLOCKED` **保持**。
  本节**不**签发包级 Acceptance、Capability Freeze、Domain Acceptance、Manual Closure、
  Release Readiness、Tag、Release 或 Deploy —— **包级 PASS 须由业务所有者按 AGENTS.md §4.5 亲自确认**，
  不得由实施代理自评替代。
- **剩余动作**：① 业务所有者对候签记录作最终确认；② 确认后由平台按治理流程把包级结论登记为本表新的
  日期化条目（**不得**改写 §37.48–§37.53）；③ 本地提交同步到 `github/master`（Push）**本轮未授权**；
  ④ Capability Freeze / Domain Acceptance / Manual Closure / Release Readiness 需另行裁定，不在本包内。
- **未发生**：未修改生产代码、DDL、Fixture、G07 Oracle、G07 合同、测试或任何已签发 Owner Acceptance；
  未连接真实 MySQL、未运行 G07、未签发或消费 ACK-4、未执行 Migration、Reset / Bootstrap / Cleanup、
  未运行 HEAVY、未 Push / Merge / Tag / Release / Deploy；未虚构 WP-I、WP-J 或 M-15 的完成状态。

### 37.55 M1-Core 首期包级 Acceptance 正式签发（2026-11-07）

- **Owner 决定**：业务所有者于 2026-11-07 在当前对话中**明确选择选项 A**，按 AGENTS.md §4.5 正式批准
  M1-Core 首期包级 Acceptance，决定 **`ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`**。正式标识：
  `M1_CORE_ACCEPTANCE_PASS` / `M1_CORE_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL_RISK`。正式记录：
  [`docs/acceptance/m1-core-package-acceptance-20261107.md`](../acceptance/m1-core-package-acceptance-20261107.md)。
  该来源为对话中的 Owner 决策记录；**不存在**虚构的手写签名、电子签章或外部审批单。
- **批准范围（逐条承接）**：① 正式接受 `M1C-G01`～`M1C-G07` 七项 Gate 的包级验收结果，七 Gate 原有
  `PASS` 状态**保持有效**；② 正式接受候签记录 §3 的 **R-01～R-20** 全部跨 Gate 有界残余风险，明确其
  属于**尚未充分证明或已知限制**，**不得**在后续文档中描述为已证明或已消除；③ **D-01～D-04 继续保持
  延期、未授权**，不视为本次验收已交付能力；④ 库存、跟踪、估值、财务及历史数据安全约束**继续全部执行**，
  发现实际业务数据不一致、库存错误、成本错误、越权或数据损坏时**必须停止受影响业务路径并整改**，
  **不得**以本次风险接受记录豁免真实缺陷；⑤ **不授予** Capability Freeze、Domain Acceptance、
  Manual Closure、Release Readiness、Release 或 Deploy 权限；⑥ 旧 M1 13 Gate 全范围 Design **不恢复**为
  当前实施和验收要求，后续延期能力按实际产品需求**独立评估和授权**。
- **验收范围**：**仅** M1-Core 首期七 Gate（Procurement & Outsourcing）。**M1-Core 首期包级 Acceptance 已
  签发，但不得被扩大解释为整个 Procurement & Outsourcing Domain 已完成、已验收或已冻结。**
- **残余风险引用纪律**：R-01～R-20 在任何后续文档、状态登记、能力矩阵、Capability Freeze 材料或发布
  说明中**不得**被描述为已证明或已消除，也**不得**据此反推任何单条残余风险已被关闭。
- **历史不可改写**：七 Gate 正式 Owner Acceptance、WP-K 裁定、WP-K-R1 裁定、§37.48～§37.54 及全部历史
  测试与失败 Run 记录**一律原样保留，不覆盖、不改写**。候签记录的 `PENDING_APPROVAL` 状态是对其撰写
  时点的真实记录，**保留不删**；其「当前状态」含义被本节取代。
- **七 Gate 状态**：**7 / 7 `PASS`** —— **不变**。
- **包级状态**：`M1_CORE_ACCEPTANCE_BLOCKED` → **`M1_CORE_ACCEPTANCE_PASS`**
  （`M1_CORE_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL_RISK`）。WP-J 维持 `DEFERRED_NOT_AUTHORIZED`；
  WP-I 维持 `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED`；M-15 不在范围。
- **仍未授予**：Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Release、
  Deploy；新增 Run ID、ACK-4、数据库写操作、Reset / Bootstrap / Cleanup / Migration 授权。
- **剩余动作**：① 本地提交同步到 `github/master`（Push）—— **本轮未授权**；② Capability Freeze /
  Domain Acceptance / Manual Closure / Release Readiness 需**另行裁定**，不在本包内；③ 旧 13 Gate 的
  M1 全域 Closure 合同继续独立存在，未来延期能力按实际产品需求重新评估并独立授权。
- **未发生**：未修改 Active Requirement / Design、生产代码、DDL、Fixture、G07 Oracle、G07 合同、测试或
  任何已签发 Owner Acceptance；未连接真实 MySQL、未运行 G07、未签发或消费 ACK-4、未执行 Migration、
  Reset / Bootstrap / Cleanup、未运行 HEAVY、未 Push / Merge / Tag / Release / Deploy；未虚构 WP-I、
  WP-J 或 M-15 的完成状态。

## 38. B3101 / B3121 静态代码审计基线登记（2026-11-07）

```text
B3101_B3121_AUDIT_BASELINE_REGISTERED
```

### 38.1 本节定位与边界

本节是 B3101 / B3121 采购与委外**静态代码审计基线**在**项目状态表**中的**唯一增量登记**。

- 本节**不修改、不删除、不重排** §35 / §36 / §37 的任何历史结论；凡与 §35～§37 冲突，
  按**日期化 supersession** 处理（历史陈述在其自身日期为真，其「当前状态」含义被本节取代）。
- 本节**不是** Acceptance，**不签发**任何 Acceptance / Freeze / `Design PASS` 标识。
- 本节**不**把任何 Capability 标记为 `PASS` / `VERIFIED`；**不**授予 Capability Freeze、
  Domain Acceptance、Manual Closure、Release Readiness、Release 或 Deploy。
- 本轮**仅**登记审计基线：未实施任何代码整改，`server/`、`src/`、`scripts/` 零改动。
- 本节编号为 **§38**，按既有「H2 = 日期化顶层章节」规则**追加**在 §37.55 之后；历史编号未重排。

### 38.2 审计基线登记

| 项 | 值 |
|---|---|
| 审计基线正文（准确路径） | [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) |
| 审计索引 | [`docs/audits/README.md`](../audits/README.md) |
| 审计版本 | `v0.2`（增加产品范围裁剪原则；保留 v0.1 审计事实） |
| 审计基准 SHA | `9b9cb09799aa05ccac43d02ac1718083921c6d04`（`master`，2026-11-07） |
| 审计状态 | `PRELIMINARY_STATIC_REVIEW`（初步静态代码审查） |
| 覆盖手册 | B3101《采购管理操作手册 V1.0》、B3121《委外管理操作手册 V1.0》 |
| 覆盖 Capability | PRC-01..PRC-26、VMI-01..VMI-05、OUT-01..OUT-23（登记于台账 §3） |
| 对应 Domain | Procurement & Outsourcing |
| 审计方法 | 远端静态代码审查；**未**运行任何测试套件，**未**连接真实 MySQL，**未**执行 Migration / Reset / Bootstrap / Cleanup |
| Issue 总数 | 17 |
| 版本沿革 | `v0.1` → **`v0.2`**（2026-11-07 补充「参考金蝶、按需建设、非 1:1 复刻」的产品范围原则，台账 §0.5～§0.7）；文件由 `b3101-b3121-code-audit-baseline-20261107.md` 更名为 `b3101-b3121-code-audit-20261107.md`。**v0.1 的 17 个 Issue 审计事实、状态统计与审计基准 SHA 全部不变**；产品范围建议另见 §39 |

### 38.3 M1-Core 首期包级 Acceptance 的当前状态（引用，不重复签发）

- M1-Core 首期包级 Acceptance 已于 **2026-11-07** 正式签发：`M1_CORE_ACCEPTANCE_PASS` /
  `M1_CORE_ACCEPTANCE_PASS_WITH_BOUNDED_RESIDUAL_RISK`，决定 `ACCEPT_WITH_BOUNDED_RESIDUAL_RISK`。
  正式记录：[`docs/acceptance/m1-core-package-acceptance-20261107.md`](../acceptance/m1-core-package-acceptance-20261107.md)；
  登记见 §37.55 —— **本节不改变该结论，也不重复签发**。
- 七 Gate **7 / 7 `PASS`** **保持**；R-01～R-20 仍是已正式接受的**有界残余风险**，
  **不得**在后续文档中描述为已证明或已消除。
- **D-01～D-04 继续保持延期、未授权**；WP-I 维持 `NOT_PROVEN / DEFERRED_NOT_AUTHORIZED`；
  WP-J 维持 `DEFERRED_NOT_AUTHORIZED`；M-15 不在范围。
- 旧 M1 13 Gate **不**恢复为当前实施和验收要求，继续作为 M1 全域 Closure 的验收合同。
- Capability Freeze / Domain Acceptance / Manual Closure / Release Readiness **仍未授予**；
  Procurement & Outsourcing 的 Domain Acceptance **仍未签发**
  （`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`）。

### 38.4 17 个审计 Issue 的当前状态统计

| 状态 | 数量 | Issue ID |
|---|---|---|
| `DOCUMENTED` | 14 | AUD-PRC-001 / 002 / 003 / 004 / 005 / 006 / 007 / 009；AUD-VMI-001 / 002；AUD-OUT-002；AUD-FE-001 / 002 / 003 |
| `NEEDS_REVALIDATION` | 2 | AUD-PRC-008、AUD-VMI-003 |
| `DEFERRED_NOT_AUTHORIZED` | 1 | AUD-OUT-001 |
| **合计** | **17** | — |

严重度分布：`P0` 5（AUD-PRC-001 / 004 / 005 / 006、AUD-FE-001）、`P1` 11、`P0*` 1
（AUD-OUT-001 —— 条件性 P0，其**当前正确状态是延期未授权**，不得转成普通 P0 开发任务）。

**当前没有任何 Issue 处于** `AUTHORIZED`、`IMPLEMENTING`、`CODE_COMPLETE`、`TESTED`、`VERIFIED`
或 `ACCEPTED`。全部 17 项**均未**实施整改。

### 38.5 后续工作必须基于审计 Issue 推进

- 后续所有 B3101 / B3121 开发任务，必须以
  [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md)
  作为**详细 Issue 台账**；本表与 [`docs/audits/README.md`](../audits/README.md) 只维护摘要与链接，
  **不复制** Issue 清单。
- 状态迁移链固定为
  `IDENTIFIED → DOCUMENTED → AUTHORIZED → IMPLEMENTING → CODE_COMPLETE → TESTED → VERIFIED → ACCEPTED`，
  允许进入 `BLOCKED` 或 `DEFERRED_NOT_AUTHORIZED`（台账另设 `NEEDS_REVALIDATION` 与 `REJECTED`）；
  **不得跳过必要状态**。
- `CODE_COMPLETE` ≠ `TESTED`；`TESTED` ≠ `VERIFIED`；`VERIFIED` ≠ `ACCEPTED`；
  `ACCEPTED` **只能**由正式责任人签发，实施代理自评**不**构成 Acceptance。
- 一个 Issue 完成**不代表**整个 Capability 或 Domain 完成；延期能力（`DEFERRED_NOT_AUTHORIZED`）
  **不得**自动转为已授权实施。
- 每次处理一个 Issue 时的必做项（更新 Status、记录开发 Commit SHA、记录测试命令 / Run ID / 结果、
  记录业务不变量与回归证据、更新 Last Updated 与 Change History、同步本表、同步 `log/`、
  仅在达到 Capability 级正式验证条件时更新 `CAPABILITY_MATRIX.md`）见
  [`docs/audits/README.md`](../audits/README.md)「持续状态更新机制」。
- 台账 §7 的 Package A～D 只是**建议**，**不是**实施授权；任何整改仍须先经 Requirement / Design /
  授权门禁（`AGENTS.md §4`）。

### 38.6 本轮明确未发生的事项

- **未**实施任何代码整改；**未**修改 `server/`、`src/`、`scripts/` 下的任何文件；
- **未**修改数据库 Schema 或 Migration；**未**执行任何数据库写操作、Reset、Bootstrap、Cleanup；
- **未**修改 M1-Core 已签发的七 Gate Acceptance、WP-K / WP-K-R1 裁定，或 §37.48～§37.55 的任何历史记录；
- **未**改变 D-01～D-04 的延期状态；**未**开放 WP-I、WP-J 或 M-15；**未**恢复旧 M1 13 Gate
  为当前实施要求；
- **未**擅自改变 VMI、WIP、委外财务政策；
- **未**取得全量 Capability 验证、Domain Acceptance、Capability Freeze、Manual Closure、
  Release Readiness；**未**签发任何新 Acceptance；
- **未**执行 Release 或 Deploy；**未** Push / Merge / Tag；本轮只做本地 Git 提交。

### 38.7 交付与校验锚点

| 项 | 值 |
|---|---|
| 审计基准（父提交） | `9b9cb09799aa05ccac43d02ac1718083921c6d04` |
| 主体交付提交 | `a4389711f474790af50f0bc3d46b6acaec6e30fd`（`登记 B3101 / B3121 静态代码审计基线到项目治理`；8 个文件，+1035 / −7） |
| 变更范围 | 仅治理与文档（`docs/audits/**`、`docs/status/**`、`docs/requirements/README.md`、`docs/design/README.md`、`docs/README.md`、`log/2026-11-07.md`）；**未**修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试 |
| 审计基线正文处理 | 主体交付提交**原样登记**审计基线正文；随后仅对其抬头 8 行做**行尾空白规范化**（删除 Markdown 硬换行的两个尾随空格），使其与仓库既有 `docs/**` 无行尾空白的约定一致并通过 `git diff --check`——**正文内容与全部结论未改写** |
| 校验 | `node scripts/docs/check-doc-consistency.mjs`（current 模式）：N1 / N3–N9 `PASS`，N2 `RETIRED`；`node scripts/docs/check-doc-consistency.mjs --mode migration`：C1–C6 `ALL CHECKS PASSED`；`git diff --check`：exit 0 |
| 远端状态 | **未** Push / Merge / Tag / Release / Deploy；`github/master` 仍为 `9b9cb09799aa05ccac43d02ac1718083921c6d04`（本地 `master` 领先 1），`origin/master` 仍为 `1de469217ce0ebf83b8c5a2df69c2d6df63a1718`（本地领先 11） |

**边界**：本节登记的是**审计基线**。它**不**使任何 Capability 变为 `VERIFIED` 或 `PASS`，
**不**授予 Capability Freeze / Domain Acceptance，**不**授权任何 Implementation，
也**不**恢复旧 M1 13 Gate 为当前实施要求。

---

## 39. 产品范围重定基线建议登记（2026-11-07）

```text
B3101_B3121_PRODUCT_SCOPE_REVIEW_PROPOSED
```

### 39.1 本节定位与边界

本节是 B3101 / B3121 **产品范围重定基线建议**在**项目状态表**中的**唯一增量登记**。

- 本节**不修改、不删除、不重排** §35 / §36 / §37 / §38 的任何历史结论。
- 本节**不是** Acceptance，**不签发**任何 Acceptance / Freeze / `Design PASS` 标识。
- 本节登记的是**建议**：`SCP-01`～`SCP-16` **全部 `PENDING`**，**未获业务所有者批准**。
  在批准前，已批准 Requirement / Design / Acceptance / 延期政策**全部原样有效**。
- 本节**未**实施任何代码整改；`server/`、`src/`、`scripts/` 零改动。
- 本节编号为 **§39**，按既有「H2 = 日期化顶层章节」规则**追加**在 §38 之后；历史编号未重排。

### 39.2 建议文档与依据

| 项 | 值 |
|---|---|
| 建议文档 | [`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md) —— 状态 `PENDING` |
| 决策登记 | [`docs/decisions/OPEN-BUSINESS-DECISIONS.md`](../decisions/OPEN-BUSINESS-DECISIONS.md) §4（`SCP-01`～`SCP-16`） |
| 审计依据 | [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) §0.5～§0.7（v0.2 新增产品范围裁剪原则） |
| 能力矩阵登记 | [`docs/status/CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md)「产品范围建议（待业务所有者裁定）」 |
| 覆盖能力 | PRC-01..PRC-26、VMI-01..VMI-05、OUT-01..OUT-23 共 **54 项** |
| 授权来源 | 用户于 2026-11-07 在当前对话中补充「Product Scope Rebaseline」要求：**只提出建议**，不擅自改变已批准的 Requirement / Design / Acceptance / 延期政策 |

### 39.3 范围审查结论：现行合同确实无条件要求实现全部手册功能

| 层级 | 证据 | 性质 |
|---|---|---|
| Requirement §31.3.1～§31.3.3 | 54 项逐条给出 `Implementation Decision`（`NEW` / `ENHANCE` / `KEEP` / `CONVERGE`） | 逐项无条件实现决策 |
| Requirement §31.4 | 每一项的落地后 Coverage 目标写死为 `COVERED`；OUT 行写明「**23 capability 全部落地**」 | 无条件全覆盖目标 |
| Requirement §31.8 A | 「**所有 49 项必须达到 Requirement 定义的目标闭环**」；「**VMI-01~05 全部归本 Domain 完成**……**不得**将 VMI-03 / VMI-05 整个 capability defer」 | 强制闭环 + 显式禁止 VMI 延期 |
| Requirement §31.10 | 「本节 Requirement 包含 26 + 5 + 23 = 54 项 Capability / 10 个 Wave」 | 以手册能力条数为验收单位 |
| Design §26.2～§26.20 / §26.27 / §26.31 | 逐能力设计 + Wave A–J 全覆盖 + 「54-capability trace preserved」列入设计验收项 | 逐项无条件实施计划 |

**结论**：现行口径的验收单位是**手册能力条数**，而不是**业务闭环价值**；任何裁剪都会被自动判定为不合格。
这与项目既定产品目标（最小完整业务闭环，而非 1:1 复刻）**不一致**，
也与已生效的 `M1-SRD-01`（2026-11-02）所采用的「有界首期 + 显式延期」方法**不自洽**。

### 39.4 产品范围建议矩阵（**建议值，未批准**）

| 建议 Product Scope | 数量 | 占比 |
|---|---|---|
| `CORE_REQUIRED` | **26** | 48.1% |
| `SIMPLIFIED` | **14** | 25.9% |
| `OPTIONAL` | **3** | 5.6% |
| `DEFERRED` | **9** | 16.7% |
| `OUT_OF_SCOPE` | **2** | 3.7% |
| **合计** | **54** | 100% |
| **`SCOPE_REVIEW_PENDING`（当前生效值）** | **54** | 100% |

逐能力的建议值、理由、裁剪边界与关联 SCP 见建议文档 §3；
**本表不复制该矩阵**。

### 39.5 Scope Change Proposal（**全部待业务所有者批准**）

| ID | 范围变更 | 涉及能力 | 与现行合同的冲突 |
|---|---|---|---|
| `SCP-01` | 验收单位由「54 项全覆盖」改为「已裁剪集合全覆盖」；删除以手册能力条数为验收项 | 全部 54 项 | 与 §31.4 / §31.8 A / §31.10 / §26.27 / §26.31 冲突 |
| `SCP-02` | 自动配额暂缓；货源与寻源简化为手工分配 | PRC-04 / 05 / 06 | 与 §31.3.1、§31.4 冲突 |
| `SCP-03` | 采购员 / 采购组简化为单据级归属 | PRC-03 | 同上 |
| `SCP-04` | 独立调价实体并入价格版本；折扣只保留单级 | PRC-07 / 08 / 09 / 10 | 同上 |
| `SCP-05` | 请购来源收敛为「手工 + 计划」；拆并简化 | PRC-11 / 12 | 同上 |
| `SCP-06` | 赠品与扫码归入可选 | PRC-15 / 26 | 同上 |
| `SCP-07` | 预付款需求暂缓 | PRC-17 | 同上 |
| `SCP-08` | 采购订单变更限定为 `MODIFY` + `CANCEL` | PRC-18 | 同上 |
| `SCP-09` | canonical 采购执行口径**不裁剪**，把 P0 修复义务显式化 | PRC-19 | 无冲突（仅确认修复义务） |
| `SCP-10` | 退货申请单级化 | PRC-24 | 与 §31.3.1、§31.4 冲突 |
| `SCP-11` | **VMI 五项全部暂缓** | VMI-01 ~ VMI-05 | **直接冲突**：§31.8 A.1 明文禁止 defer VMI-03 / VMI-05 —— 须显式突破该条款 |
| `SCP-12` | 委外侧全部复用 canonical 供应商 / 货源 / 价格 / 采购单据；计划交接归入可选 | OUT-01 / 02 / 03 / 05 / 07 / 10 | 与 §31.3.3、§31.4 冲突 |
| `SCP-13` | 倒冲与成本证据限定为 M1-Core 已批准的有界实现 | OUT-16 / 21 | 与 §31.3.3 冲突；**不新增**延期，与 D-01 一致 |
| `SCP-14` | 委外 AP/GL 过账与成品退货维持延期 | OUT-20 / 22 | 与 §31.3.3 冲突；与已生效延期一致 |
| `SCP-15` | 委外期初 / 期末与报表限定为少量关键报表 | OUT-23 | 与 §31.3.3 冲突 |
| `SCP-16` | 17 个审计 Issue 对应的**危险写入路径处置类别**（`FIX` / `FIX_OR_CLOSE` / `SAFE_CLOSE` / `REPORT_ONLY`） | 见建议文档 §5 | 不改变已批准合同，但决定活跃写入口的安全处置 |

**范围裁剪与 M1-Core 已交付范围无冲突**：26 项 `CORE_REQUIRED` 中 16 项直接落在 M1-Core 首期
已批准范围内，10 项属 §31 Domain Closure 已批准范围且已有实现；本建议**未缩小**任何已交付或
已批准能力，裁剪只发生在未交付部分。

### 39.6 危险写入路径的处置原则（不得以「暂时不需要」容忍不安全写入）

- 审计台账中**活跃**的高风险写入口必须**修复**或**安全封锁**（服务端 fail closed / 停用 / 只读），
  **不得**因产品裁剪而无限期保持风险暴露；
- 裁剪若使某能力不再需要，其现有写入口的正确处置是**安全关闭**（明确 status + error code、
  零业务副作用、留拒绝审计），**不是**保留一个能写错的接口；
- 处置类别的逐项建议见建议文档 §5；**本节不复制**该清单，也**不**改变任何 Issue 的证据状态。

### 39.7 交付标准与复用约束（建议）

- **禁止**把金蝶原版的**菜单数量、表单数量、操作步骤数量**作为开发完成标准；
  交付单位是**业务闭环**（端到端可追溯且账务正确），不是能力条目数；
- 范围裁剪**不得**放宽库存数量与物权、金额与估值、权限 fail closed、来源可追溯、事务、
  幂等、审计等核心正确性约束（继承 §31.13.1 `INV-1`~`INV-12`）；
- **不得**为匹配手册而新建第二套库存、质量、财务、审批、计划、UOM、BOM 引擎，
  也**不得**新建第二套供应商 / 货源 / 价格 / 采购单据 / 仓库主数据（详见建议文档 §6）。

### 39.8 本轮明确未发生的事项

- **未**修改任何已批准的 Requirement / Design 正文、Acceptance、Gate 状态或延期政策；
- **未**实施任何代码整改；**未**修改 `server/`、`src/`、`scripts/` 下的任何文件；
- **未**修改数据库 Schema 或 Migration；**未**执行任何数据库写操作、Reset、Bootstrap、Cleanup；
- **未**把任何能力的 `Product Scope` 写成已裁剪；全部 54 项仍为 `SCOPE_REVIEW_PENDING`；
- **未**签发任何 Acceptance / Freeze / `Design PASS`；**未**授权任何 Implementation；
- **未**改变 D-01～D-04 的延期状态；**未**开放 WP-I、WP-J 或 M-15；**未**恢复旧 M1 13 Gate；
- **未**执行 Release 或 Deploy；**未** Push / Merge / Tag。

**边界**：本节登记的是**建议**。它**不**改变任何已批准合同、验收状态或延期政策，
**不**使任何 Capability 变为 `VERIFIED` 或 `PASS`，**不**授权任何 Implementation。

### 39.9 交付与校验锚点

| 项 | 值 |
|---|---|
| 主体交付提交 | `de0619eedb51587344255e7a033f9576754a2eda`（`登记 B3101 / B3121 产品范围重定基线建议与 Scope Change Proposal`；10 个文件，+899 / −26；含审计基线文件更名 `…-code-audit-baseline-20261107.md` → `…-code-audit-20261107.md`） |
| 变更范围 | 仅治理与文档（`docs/audits/**`、`docs/decisions/**`、`docs/status/**`、`docs/requirements/README.md`、`docs/design/README.md`、`log/2026-11-07.md`）；**未**修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试 |
| 交付规模 | 新增 1 个文件（`docs/decisions/product-scope-rebaseline-proposal-20261107.md`）；修改 8 个文件；审计基线正文按用户侧 v0.2 更名入库 |
| 审计基线正文处理 | 内容**未改写**（用户侧提供的 v0.2 全文原样入库）；仅对其抬头 8 行做**行尾空白规范化**（删除 Markdown 硬换行用的两个尾随空格），与仓库既有 `docs/**` 无行尾空白的约定一致 |
| 校验 | `node scripts/docs/check-doc-consistency.mjs`（current 模式）：N1 / N3–N9 `PASS`，N2 `RETIRED`；`node scripts/docs/check-doc-consistency.mjs --mode migration`：C1–C6 `ALL CHECKS PASSED`；`git diff --check`：exit 0 |
| 远端状态 | **未** Push / Merge / Tag / Release / Deploy；`github/master` 仍为 `9b9cb09799aa05ccac43d02ac1718083921c6d04`，`origin/master` 仍为 `1de469217ce0ebf83b8c5a2df69c2d6df63a1718`；本地 `master` 领先 |
| `package.json` / release tag | **未**变化 |

## 40. Package A 采购与委外正确性整改增量（2026-11-07）

本节是本次任务的**当前状态增量**；详细逐项证据与授权边界只在 [`B3101/B3121 审计台账 §11`](../audits/b3101-b3121-code-audit-20261107.md) 维护。§38 的 17 项统计是其日期化审计基线，不再代表本轮工作树状态。

| 项 | 当前状态 |
|---|---|
| 已实施且 focused 测试通过 | `AUD-PRC-003`（采购/委外资格及业务日期）；`AUD-OUT-002`（委外报表仅计生效收货，待检单列）。二项均为 `TESTED`，**未**签发 Acceptance |
| 待裁定或复验 | Package A 其余 Issue 的完整矩阵与 `AUD-PRC-006` Dependency Change Request 见审计台账 §11；`AUD-OUT-001` 保持 `DEFERRED_NOT_AUTHORIZED` |
| 高风险入口 | `AUD-FE-001` 与 `AUD-PRC-001` 的演示/伪来源正式写入口仍待 `SCP-16` 处置；本轮未将其宣称安全或关闭 |
| 验收边界 | M1-Core 七 Gate 原有 7/7 PASS 与 R-01～R-20 风险记录保持其既有范围；本轮未重新签发受影响 Gate，Procurement & Outsourcing Domain Acceptance 仍 `NOT READY` |
| 产品范围 | `SCP-01`～`SCP-16` 全部 `PENDING`；B3101/B3121 未获 Capability Freeze 或 Manual Closure |

17 项当前状态汇总：`TESTED` 2、`BLOCKED` 9、`NEEDS_REVALIDATION` 3、`DEFERRED_NOT_AUTHORIZED` 1、`DOCUMENTED` 2；明细以审计台账 §9/§11 为准。

本轮不涉及 schema/migration、真实数据库写入、MySQL Gate、发布或远端 Git 写操作。测试与本地提交锚点见台账 §11 交付记录和 `log/2026-11-07.md`；未运行的 Gate 不记为 PASS。

## 41. Package A1 决策、Requirement 与 Design 状态（2026-11-07）

本节是当前项目级状态增量；§40 的 Package A 表述是先前时点记录，逐项证据与原始审计问题见 [`审计台账 §12`](../audits/b3101-b3121-code-audit-20261107.md)。Owner 已批准 `AUD-FE-001/AUD-PRC-001` `SAFE_CLOSE`，`AUD-OUT-001` 为需协调 M1-Core 的有界 `SAFE_CLOSE` 意图；VMI-01～03 最小闭环与 VMI-04 只读数量汇总保留，VMI-05 物权转移/账单交接暂缓。`SCP-11` 全量延期原提案被部分取代；其余 `SCP` 提案不因本轮自动生效。`D-P01/D-P02` 及 VMI 供应商资格规则仍待 Owner 决策。

| 项 | 当前状态 / 唯一详证 |
|---|---|
| Requirement | `document.md` §0 导航与 `docs/requirements/procurement-outsourcing.md` §31.14 已起草，`PENDING_APPROVAL`；旧 §31.12/§31.13 历史批准不改 |
| Design | `solution.md` §0 导航与 `docs/design/procurement-outsourcing.md` §26.34 已起草，`PENDING_REVIEW`；M1-Core Active Design 与七 Gate Acceptance 不改 |
| FE-001 / PRC-001 | Owner 决定已记录，危险入口仍在；`BLOCKED`、未实施、未测试，详见审计台账 §12 |
| OUT-001 | 原「无物理 movement」单独判据不成立；具体身份/历史/并发/数量守卫风险待复验，`DEFERRED_NOT_AUTHORIZED` 标签保留；M1C-G03/G06 原 PASS 不扩张，Gate 影响待 Owner 判断 |
| VMI | Agreement Binding、业务幂等、Consumption 容量和汇总口径待实施/验证；Supplier Eligibility `OWNER_DECISION_PENDING`；VMI-05 继续 409 `VMI_SETTLEMENT_POLICY_PENDING` |
| 交付边界 | B3101/B3121 `BLOCKED`；无 Capability `COVERED`、Freeze、Domain Acceptance；Implementation、Migration、数据库/远端 Git 操作均未授权 |

本轮在 Design 完成后 **HARD STOP**，等待业务所有者审阅 Requirement/Design 并明确批准下一轮 Implementation。`R-01..R-20`、M1-GD01/02、B-P01/02、C-P01..04、M-15 均维持先前记录。

## 42. WP-A1-01 / WP-A1-02 当前状态（2026-11-07）

业务所有者已分别批准 `AUD-FE-001` 与 `AUD-PRC-001` 的有界 Implementation；详证见 [`审计台账 §13`](../audits/b3101-b3121-code-audit-20261107.md)。两项当前为 `TESTED`、**待最终 Acceptance**，不构成 PRC-06 Capability Closure。FE-001 演示写入按钮与固定参数已移除；PRC-001 正式决策写入口对有权普通用户和管理员均返回 409 `SOURCING_DECISION_WRITE_CLOSED`，无业务表变化，合法 Source List/Quota 查询继续可用。两个独立提交为 `6cb514a`、`8fa20a4`。

focused 5/5、FAST 576/576、构建与响应式浏览器回归 24/24 通过；`git diff --check` 通过。旧功能 UAT 仅 UAT-04 的新合同检查通过，全套 15/28，不能记为 PASS；FULL 回归未完成，停止前遇到既有 G07 诊断测试权限失败。`AUD-PRC-002`、`AUD-OUT-001`、VMI、M1-Core 七 Gate 与 R-01～R-20 均不因本轮变化；B3101/B3121 仍 `BLOCKED`，Capability Matrix 未更新。无 Migration、真实数据库或远端 Git 写入。

## 43. Package A1 Design 小修与两项独立 Acceptance 候签（2026-11-08）

```text
A1_DESIGN_AMENDMENT_AND_ACCEPTANCE_CANDIDATES_READY_FOR_OWNER_REVIEW
```

### 43.1 本节定位与边界

本节是 Package A1 本轮（2026-11-08）的**唯一增量登记**。

- 本节**不修改、不删除、不重排** §35～§42 的任何历史结论；凡与其冲突，按**日期化 supersession** 处理。
- 本节**不是** Acceptance，**不签发**任何 Acceptance / Freeze / `DESIGN_PASS` 标识，**不授权**任何 Implementation、Schema / Migration、数据库操作或真实 MySQL Gate。
- 本轮**零生产代码变更**：`server/`、`src/`、`scripts/` 零改动；**未**修改数据库 Schema / Migration，**未**执行 Migration、Reset、Bootstrap、Cleanup 或数据库写入，**未**连接真实 MySQL。
- 本节编号为 **§43**，按既有「H2 = 日期化顶层章节」规则**追加**在 §42 之后；历史编号未重排。

### 43.2 Design 小修（`docs/design/procurement-outsourcing.md` §26.34.8～§26.34.12）

| 小修 | 落点 | 合同要点 |
|---|---|---|
| WIP 幂等合同 | §26.34.8 | 幂等键唯一来源为 `body.idempotencyKey`；固定 `operationType='OUTSOURCING_WIP_TRANSFER'`、`documentId=sourceOrderId`；复用 `requestFingerprint()` / `idempotencyReplay()` / `saveIdempotency()`；固定响应：首次 201 `{id,transferNo}`、同 Key 同内容 201 `{id,transferNo,replayed:true}`、同 Key 异内容 409 `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT`、缺键 400 `IDEMPOTENCY_KEY_REQUIRED`；指纹覆盖源/目标订单、源物料行、规范化数量、UOM、业务日期与身份选择字段；幂等记录、转移事实、数量效力、身份效力与成功审计**同一事务**提交；精确重放不新增业务事实或成功审计 |
| MySQL 命名锁释放 | §26.34.9 | **只核对不修改** `server/db.js`：未命中即持锁、`transaction()` 正常 COMMIT/ROLLBACK 后释放、BEGIN 启动失败由 `settleFailedTransactionStart()` 默认释放、`assertMySqlTransactionAdmission()` 位于 `transaction()` 内部 `try` 之前故调用方必须提供外层 `try/finally` 释放保障、复用 `releaseMySqlIdempotencyLocks(db)`、禁止直接执行 `RELEASE_LOCK()` 绕过公共合同、未确认释放遵循既有连接隔离机制、不确定 COMMIT 不得自动重试写操作、业务拒绝必须在事务回滚后由单一边界审计 |
| VMI 幂等合同 | §26.34.10 | 三个独立 `operationType`：`VMI_RECEIPT_CREATE`（作用域 `create-request:${idempotencyKey}`）、`VMI_RECEIPT_CONFIRM`（`receiptId`）、`VMI_CONSUMPTION_CREATE`（`receiptId`）；统一 `body.idempotencyKey`；三条规范化指纹字段集已固定；固定响应：Receipt Create 201 / 精确重放 201 + `replayed:true`、Receipt Confirm 200 `{ok:true}` / 精确重放 200 `{ok:true,replayed:true}`、Consumption Create 201 `{id,consumptionNo}` / 精确重放原结果 + `replayed:true`、同 Key 异载荷 409 `VMI_IDEMPOTENCY_KEY_PAYLOAD_CONFLICT`、缺键 400 `IDEMPOTENCY_KEY_REQUIRED`；成功事实、库存 mutation 与幂等记录同事务提交；精确重放不新增库存变化与成功审计 |
| VMI 旧字段兼容 | §26.34.11 | 保留 `vmi_receipts.idempotency_key` 与既有 UNIQUE 约束，新 Receipt 继续写入该列；通用 `idempotency_records` 为新请求的**权威重放记录**；通用记录未命中时必须核对旧字段，重建可证明的规范化指纹：完全匹配返回原 Receipt、不重复创建；内容不一致 409；无法证明历史载荷 409 `VMI_RECEIPT_IDEMPOTENCY_LEGACY_UNVERIFIED`；不自动回填、不修改历史业务行、NULL 历史键保持 NULL；不删除旧表/字段/约束；**不**为幂等问题新增 Schema，`agreement_id` 仍是独立 Migration 候选；**不**开放 VMI-05 |

§26.34.7 的四个 Owner Review Gate 状态**全部保持不变**（`A1-D-RV-01`～`A1-D-RV-03` = `PENDING_OWNER_REVIEW`，`A1-D-RV-04` = `BLOCKED_ON_OWNER_DECISION`）。§26.34 的 `PENDING_REVIEW` 与 `DESIGN_PASS` 未签发状态不变；**A1-I1 / I2 的 Acceptance 不等同于 Design PASS**。

### 43.3 两项独立 Acceptance 候签

| 工作包 | Issue | 候签记录 | 当前状态 | Owner 决定 |
|---|---|---|---|---|
| `WP-A1-01` | `AUD-FE-001` | [`docs/acceptance/wp-a1-01-owner-acceptance-20261108.md`](../acceptance/wp-a1-01-owner-acceptance-20261108.md) | `TESTED` / `PENDING_OWNER_APPROVAL` | **未作出**（`ACCEPT_WITH_BOUNDED_RESIDUALS` / `RETURN_FOR_REWORK`） |
| `WP-A1-02` | `AUD-PRC-001` | [`docs/acceptance/wp-a1-02-owner-acceptance-20261108.md`](../acceptance/wp-a1-02-owner-acceptance-20261108.md) | `TESTED` / `PENDING_OWNER_APPROVAL` | **未作出**（`ACCEPT_WITH_BOUNDED_RESIDUALS` / `RETURN_FOR_REWORK`） |

两份是**两个独立**的验收对象，不互相代表、不合并决定。实施提交分别为 `6cb514a66ebf6587fc5899bf0a7a4cbe1dd4c66e` 与 `8fa20a4374418ea24150fc5234ccd577389802dd`。审计台账 §13.1 与 §9 状态列已同步登记。

### 43.4 本轮实测结果（2026-11-08）

| 命令 | 实测结果 | 退出码 |
|---|---|---|
| `pnpm.cmd build` | `✓ built in 3.82s` | 0 |
| `node --test server/procurement-sourcing-pricing.test.js` | 5 / 5 PASS | 0 |
| `node scripts/testing/run-tests.js fast` | 576 / 576 PASS | 0 |
| `node scripts/acceptance/m1c-wp6-outsourcing-responsive-uat.mjs` | `PASS=24 FAIL=0 TOTAL=24` | 0 |
| `node scripts/testing/run-tests.js fast --filter procurement-sourcing-pricing` | `[run-tests] suite=fast files=0` → 无文件参数的 `node --test` 回退为默认全仓发现：3441 tests / 429 suites，3437 pass，**4 fail** | **1** |
| `node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD` | 见 §43.6 交付锚点 | — |
| `node scripts/docs/check-doc-consistency.mjs --mode migration` | 见 §43.6 交付锚点 | — |
| `git diff --check` | 见 §43.6 交付锚点 | — |

**最后一行命令的登记事实（不得省略）**：`server/procurement-sourcing-pricing.test.js` 登记在 **FULL**（FAST=29 / FULL=222 / HEAVY=7），不在 FAST；该过滤条件选出 **0** 个文件，runner 以无文件参数启动 `node --test`，Node 回退为默认全仓发现，因而把未登记在任何套件清单中的 `server/production-safety.test.js` 纳入。4 项失败全部在该文件：① 陈旧断言（Demo Seed 现创建 7 个用户，测试仍断言 5，源自 2026-11-02 M1-Core WP-0 的 M1-P-03 角色种子）；②③ Windows `EBUSY` 临时库 `unlink` 级联（由 ① 断言失败后未执行 `db.close()` 引起）；④ 文件级汇总。该失败与本轮变更无关（本轮只改 Markdown 与日志），**不记为 PASS**，也**不**归因于 `AUD-FE-001` / `AUD-PRC-001`。

### 43.5 必须随验收披露的限制

1. **旧功能 UAT 为 15 / 28，不是 PASS**：全套 28 项中仅 15 项通过，其中**只有 UAT-04 按新合同通过**（配额 GET 200 + 决策 POST 409）；其余失败集中在收货与委外既有链路。
2. **FULL 回归未完成，不记为 PASS**：曾启动但因耗时停止，**停止前**仍出现既有 `m1-core-g07-diagnostics.test.js` 临时证据文件 `SetAccessControl` 权限拒绝。
3. **没有本轮真实 MySQL Gate 证据**：未连接任何真实 MySQL，未执行任何 disposable MySQL Gate，MySQL 与 SQLite 双端等价**未被证明**。

三项限制已在两份候签记录中逐条披露，**不得**被隐藏或改写成 PASS。

### 43.6 交付锚点与校验

| 项 | 值 |
|---|---|
| 基线 | `master` @ `a39beac7a334ab4cf32fd5bc6b33ef978d6a6d65` |
| 变更范围 | 仅治理与文档（`docs/design/procurement-outsourcing.md`、`docs/acceptance/**`、`docs/audits/b3101-b3121-code-audit-20261107.md`、`docs/status/PROJECT_STATUS.md`、`log/2026-11-08.md`）；**未**修改任何 `src/` / `server/` 生产代码、schema、migration、API、权限、状态机或业务测试 |
| 文档一致性（current） | `node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD`：N1 / N3–N9 PASS，N2 `RETIRED`（**不记为 PASS**） |
| 文档一致性（migration） | `node scripts/docs/check-doc-consistency.mjs --mode migration`（固定 G0 锚点，不带 `--target`）：C1–C6 全部 PASS |
| 空白检查 | `git diff --check`：exit 0 |
| 远端状态 | **未** Push / Merge / Tag / Release / Deploy；`package.json` version 与 release tag 未变化 |

### 43.7 本轮明确未发生的事项

- **未**修改 `server/`、`src/`、`scripts/` 下任何文件；**未**修改数据库 Schema / Migration；**未**执行任何数据库写入、Reset、Bootstrap、Cleanup；
- **未**连接、重置或修改任何真实 MySQL；**未**运行 `test:mysql` / `test:mysql:concurrency` / 任何 disposable MySQL Gate；
- **未**修改 `docs/requirements/`、`document.md`、`solution.md`、`docs/status/CAPABILITY_MATRIX.md`；
- **未**签发任何 Acceptance / Freeze / `DESIGN_PASS`；**未**把两项状态改写为 `ACCEPTED`；
- **未**改变 `AUD-OUT-001`（仍 `DEFERRED_NOT_AUTHORIZED`）、`AUD-PRC-002` Hash、VMI 全部 Issue、M1-Core 七 Gate 7/7 `PASS`、`R-01`～`R-20`、`D-01`～`D-04`、`WP-I` / `WP-J`、`M-15`、`SCP-01`～`SCP-16` 的原状态；
- **未**把 `PRC-06` 变为 `COVERED`；B3101 / B3121 仍 `BLOCKED`；Procurement & Outsourcing Domain Acceptance 仍 `NOT READY`；
- **未** Push / Merge / Tag / Release / Deploy；**未**改写 Git 历史。

### 43.8 待业务所有者确认的两个独立决定

| # | 对象 | 可选决定 | 当前 |
|---|---|---|---|
| 1 | `WP-A1-01` / `AUD-FE-001` | `ACCEPT_WITH_BOUNDED_RESIDUALS` 或 `RETURN_FOR_REWORK` | **未作出** |
| 2 | `WP-A1-02` / `AUD-PRC-001` | `ACCEPT_WITH_BOUNDED_RESIDUALS` 或 `RETURN_FOR_REWORK` | **未作出** |

在业务所有者**分别**作出决定之前，两项保持 `TESTED` / `PENDING_OWNER_APPROVAL`。

## 44. A1 两项 Owner Acceptance 正式登记与 OUT-001 实施前置（2026-11-08）

```text
A1_I1_I2_ACCEPTED_WITH_BOUNDED_RESIDUALS
```

### 44.1 本节定位与边界

本节是 Package A1 两项验收**正式登记**与 OUT-001 实施前置收口的**唯一增量登记**。

- 本节**不修改、不删除、不重排** §35～§43 的任何历史结论；凡与其冲突，按**日期化 supersession** 处理（§43.8 的「未作出」在 2026-11-08 当日续记时为真，其当前含义被本节取代）。
- 本节**不**签发 Requirement 验收、Design PASS、Capability Freeze、Domain Acceptance、Manual Closure 或 Release Readiness。
- 本节**不**授权任何 Implementation、Schema / Migration、数据库操作或真实 MySQL Gate；本轮**零生产代码变更**。
- 本节编号为 **§44**，按既有「H2 = 日期化顶层章节」规则**追加**在 §43 之后；历史编号未重排。

### 44.2 两项独立 Owner Acceptance 决定

业务所有者于 **2026-11-08** 在本轮对话中作出**两个相互独立**的有界验收决定：

| 工作包 | Issue | 决定 | 签发标识 | 验收日期 | 正式记录 |
|---|---|---|---|---|---|
| `WP-A1-01` | `AUD-FE-001` | `ACCEPT_WITH_BOUNDED_RESIDUALS` | `WP_A1_01_ACCEPTED_WITH_BOUNDED_RESIDUALS` | 2026-11-08 | [`docs/acceptance/wp-a1-01-owner-acceptance-20261108.md`](../acceptance/wp-a1-01-owner-acceptance-20261108.md) |
| `WP-A1-02` | `AUD-PRC-001` | `ACCEPT_WITH_BOUNDED_RESIDUALS` | `WP_A1_02_ACCEPTED_WITH_BOUNDED_RESIDUALS` | 2026-11-08 | [`docs/acceptance/wp-a1-02-owner-acceptance-20261108.md`](../acceptance/wp-a1-02-owner-acceptance-20261108.md) |

**决定来源的边界（不得虚构）**：来源是**业务所有者在当前对话中的明确授权**，及业务所有者对远端代码与候签材料的独立技术复核。仓库侧可核验的复核对象为 `github/master` @ `6ee0ad3c98612f03107aa39ead0eae6c5e2c8f64` 的代码与两份正式记录正文。**不存在虚构的手写签名、电子签章或外部审批单**；本轮 Review 的执行人、评审编号与逐项发现未在本仓库记录，本节**不代为杜撰**。

**实施授权与合同状态的区别**：`WP-A1-01` / `WP-A1-02` 的实施授权来自**先前独立的有界 Implementation 授权**（审计台账 §13 与 `log/2026-11-07.md`），**不是**来自 §31.14 或 §26.34 的获批。§31.14 仍为 `PENDING_APPROVAL`，§26.34 仍为 `PENDING_REVIEW`，`DESIGN_PASS` **未签发**；**两项 Acceptance 不是 Requirement 验收，也不是 Design PASS**。

### 44.3 状态迁移

```text
Before : AUD-FE-001 / WP-A1-01 = TESTED / PENDING_OWNER_APPROVAL
         AUD-PRC-001 / WP-A1-02 = TESTED / PENDING_OWNER_APPROVAL
After  : AUD-FE-001 / WP-A1-01 = ACCEPTED（附有界残余风险）
         AUD-PRC-001 / WP-A1-02 = ACCEPTED（附有界残余风险）
```

### 44.4 保留的原始证据（不得改写）

| 类别 | 证据 | 状态 |
|---|---|---|
| 已通过 | FAST **576/576** | PASS |
| 已通过 | focused `server/procurement-sourcing-pricing.test.js` **5/5** | PASS |
| 已通过 | 浏览器响应式回归 **24/24**（整体套件 = 2 工作面 × 4 视口 × 3 主体；寻源子集 12/12） | PASS |
| 已通过 | `pnpm.cmd build` | PASS |
| **FAILED** | 旧功能 UAT `procurement-outsourcing-functional-uat.mjs` **15 / 28**（**只有 UAT-04** 按新合同通过） | **仍为 FAIL** |
| **NOT_RUN** | FULL 回归 | **未完成**（停止前遇既有 `m1-core-g07-diagnostics.test.js` `SetAccessControl` 权限拒绝） |
| **NOT_RUN** | 真实 MySQL Gate（`test:mysql` / `test:mysql:concurrency` / 任何 disposable MySQL Gate） | **未运行** |
| **FAILED** | `pnpm.cmd test:fast --filter procurement-sourcing-pricing` | **退出码 1，4 项失败**（`server/production-safety.test.js`：陈旧断言 7≠5 及其 Windows `EBUSY` 级联；定向文件登记在 FULL，过滤为 0 个文件后 `node --test` 回退默认全仓发现） |

上表随 §44.2 的决定**一并被接受为已知限制与已知残余风险**，但**没有任何一项被消除**。原始 FAILED / NOT_RUN 记录**原样保留**，**不得**改写为 PASS。

### 44.5 远端同步前后差异

| 项 | 同步前 | 同步后 |
|---|---|---|
| `github/master` | `a39beac7a334ab4cf32fd5bc6b33ef978d6a6d65` | `6ee0ad3c98612f03107aa39ead0eae6c5e2c8f64`（Owner 本轮独立核验） |
| 已推送提交 | —— | `4e3fe11f7803fe99a36b9971cd57586cc8fab427`（A1 Design 小修）、`6ee0ad3c98612f03107aa39ead0eae6c5e2c8f64`（两项 Acceptance 候签与状态索引） |
| 本地 `master` | 与远端一致（`a39beac`） | 与远端一致（`6ee0ad3`），工作树干净 |
| Gitee `origin/master` | 未在本轮核验 | 本轮**未**推送、**未**核验（远端 TLS 握手不可达，且本轮不授权任何远端写操作） |

### 44.6 明确不因本节改变的事项

- `PRC-06` **不**变为 `COVERED`；`docs/status/CAPABILITY_MATRIX.md` 不更新；B3101 / B3121 继续 `BLOCKED`；Procurement & Outsourcing Domain Acceptance 继续 `NOT READY`（`PROCUREMENT_OUTSOURCING_DOMAIN_NOT_READY`）。
- `AUD-PRC-002`（Hash）、`AUD-OUT-001`（仍 `DEFERRED_NOT_AUTHORIZED`）、`AUD-FE-002` / `AUD-FE-003`、`AUD-PRC-003`～`AUD-PRC-009`、`AUD-VMI-001`～`AUD-VMI-003`、`AUD-OUT-002` 的状态**全部不变**。
- M1-Core 七 Gate 7/7 `PASS` 及其既有范围、`R-01`～`R-20`、`D-01`～`D-04`、`WP-I` / `WP-J`、`M-15`、`SCP-01`～`SCP-16` 原状态不变。
- §31.14 仍 `PENDING_APPROVAL`；§26.34 仍 `PENDING_REVIEW`；`A1-D-RV-01`～`A1-D-RV-04` 四个 Owner Review Gate 状态不变。
- 本轮**未**修改 `server/`、`src/`、`scripts/`、`docs/requirements/`、`document.md`、`solution.md`；**未**修改数据库 Schema / Migration；**未**执行数据库写入、Migration、Reset / Bootstrap / Cleanup；**未**连接真实 MySQL；**未** Push / Merge / Tag / Release / Deploy。

### 44.7 下一阶段：OUT-001 实施前置

OUT-001（`AUD-OUT-001`）的实现前置以 [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.34.13 的 **I3a / I3b 两批划分**为候审修订基础：

- **I3a**：不修改 Schema 的安全加固（请求合同与格式校验、事务内权威重读、幂等合同落地、数量守恒与并发守卫、拒绝审计单一边界、不安全路径继续 fail closed、`transferNo` 稳定生成、零副作用回归）；
- **I3b**：来源追溯与身份效力，**需单独申请** `source_material_list_id` 的 additive Migration 授权。

该修订**只是 Design 候审修订**，**不**签发 Requirement 验收或 `DESIGN_PASS`，**不**授权任何 Implementation、Schema / Migration、数据库操作或真实 MySQL Gate。**Design 完成后 HARD STOP。**

## 45. OUT-001 有界实施授权与两批范围登记（2026-11-08）

### 45.1 本节定位与边界

本节是 `AUD-OUT-001`（OUT-001）**实施授权**与其**两批范围**的唯一增量登记；§44 与更早章节的历史结论**原样保留**，未被改写。

- 本节**不**签发 Requirement 验收、Design PASS、Capability Freeze、Domain Acceptance、Manual Closure 或 Release Readiness。
- 本节**不**授权任何 Schema / Migration、数据库写入、真实 MySQL Gate 或远端 Git 操作。
- 本节编号为 **§45**，按既有「H2 = 日期化顶层章节」规则**追加**在 §44 之后；历史编号未重排。

### 45.2 Owner 有界批准决定

业务所有者于 **2026-11-08** 在本轮任务说明中作出以下**有界**批准：

| 项 | 决定 | 记录位置 |
|---|---|---|
| Requirement | §31.14.2 按「现有数量归属守恒 + 历史不可证明 fail closed + 成本携带延期」三项原则，**批准为 OUT-001 本工作包的适用合同** | [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.34.15.1 |
| Design | §26.34 中 **OUT-001 相关范围**（§26.34.2、§26.34.4.2～§26.34.4.3、§26.34.5、§26.34.8、§26.34.9、§26.34.13、§26.34.14）**有界批准**用于 Implementation；身份链引用按 §26.34.15.2 修正 | 同上 §26.34.15.1 / §26.34.15.2 |
| **未**批准 | §31.14 / §26.34 **全域闭合**；VMI（VMI-01..05、`D-P01` / `D-P02`）；`PRC-06`；`B-P01` / `B-P02` —— **原状态一律不变** | 同上 §26.34.15.1 |
| **未**批准 | 任何新增 Schema / Migration（含可选便利项 `source_material_list_id`）；连接真实 MySQL 或生产数据库；Push / Merge / Tag / Release / Deploy | 同上 §26.34.15.1 / §26.34.15.4 |

**决定来源的边界（不得虚构）**：来源是**业务所有者在当前对话中的明确授权**；仓库侧可核验的复核对象为 `master` @ `cc184dbd709fc5906d85c1c21506c867ca15eb1f` 的代码、§26.34 的 Design 正文与本节登记。**不存在虚构的手写签名、电子签章或外部审批单**；本节**不代为杜撰**评审编号与逐项发现。

### 45.3 状态迁移

```text
Before : AUD-OUT-001 = DEFERRED_NOT_AUTHORIZED
After  : AUD-OUT-001 = IMPLEMENTATION_AUTHORIZED（有界；§26.34.15.1 / §26.34.15.3）
         → 两批实施完成后迁移为 TESTED / PENDING_OWNER_APPROVAL（§45.8；未签发 Acceptance）
```

该迁移**只**表示本工作包获得了实施授权，**不**表示缺陷已修复或已验收。`AUD-OUT-001` 的状态**不得**在两批实施与本地验证完成前推进到 `ACCEPTED`；完成后最多推进到 `TESTED` / `PENDING_OWNER_APPROVAL`，仍需 Owner 技术复核与真实 MySQL Gate。

### 45.4 两批实施范围

| 批次 | 范围 | 依赖 | 可观测结果 |
|---|---|---|---|
| **I3a-S** | §26.34.13.2 的 I3a-S-1 ～ I3a-S-11 | 无 | **不含任何正向 201**；固定 400 / 403 / 404 / 409 + 固定 code + 零业务副作用 + 单次拒绝审计 |
| **I3a-P + I3b** | §26.34.13.2b 的 I3a-P-1 ～ I3a-P-5 与 §26.34.13.3 的 I3b-1 ～ I3b-6；身份链按 §26.34.15.2 | 两项**同批** | 合法 NONE 路径**固定 201**；同 Key 精确重放 201 `replayed:true`；同 Key 异载荷 409；身份链与数量账守恒；物理库存零新增移动 |

I3a-S 先实施并独立提交；I3a-S 的验收断言**只能是**固定拒绝结果，**不得**声称正向 201、成功幂等精确重放或身份链已验证。I3a-S 通过后连续实施 I3a-P + I3b，两批各自形成**独立**的本地逻辑 commit。

### 45.5 明确不因本节改变的事项

- §31.14 整节仍**非** `APPROVED`（仅 §31.14.2 获批为 OUT-001 本工作包的适用合同）；§26.34 仍**非**整体 `DESIGN_PASS`；`A1-D-RV-01` ～ `A1-D-RV-04` 四个 Owner Review Gate 状态不变。
- `AUD-PRC-002`（Hash）、`AUD-FE-002` / `AUD-FE-003`、`AUD-PRC-003` ～ `AUD-PRC-009`、`AUD-VMI-001` ～ `AUD-VMI-003`、`AUD-OUT-002` 的状态**全部不变**。
- `M1C-G03` / `M1C-G06` 既有 7/7 `PASS` 及其范围、`R-01` ～ `R-20`、`D-01` ～ `D-04`、`WP-I` / `WP-J`、`M-15`、`SCP-01` ～ `SCP-16` 原状态不变。
- `PRC-06` **不**变为 `COVERED`；`docs/status/CAPABILITY_MATRIX.md` 不更新；B3101 / B3121 继续 `BLOCKED`；Procurement & Outsourcing Domain Acceptance 继续 `NOT READY`。
- `VMI-01` ～ `VMI-05`、`D-P01` / `D-P02`、`B-P01` / `B-P02`、`M1-F-07` / `M1-F-11` 原状态不变；VMI-05 继续 409 `VMI_SETTLEMENT_POLICY_PENDING`。

### 45.6 本节的验证限制声明

- **真实 MySQL 8 Gate 未获授权**：不得运行、不得声称 PASS；`FULL` 回归若未完成须记录 `NOT_RUN`。
- 旧功能 UAT 的既有失败**不得**改写为 PASS。
- 本节**未**运行任何测试；两批实施后的实测证据另见本节后续增量或当天 `log/`。

### 45.7 Phase B（I3a-S 安全加固）实施与验证增量（2026-11-08）

| 项 | 内容 |
|---|---|
| 实施文件 | `server/modules/outsourcing-finance.js`（`createWipTransfer` 重写）、`server/lib/inventory-mutation.js`（把既有 `assertInventoryPeriodOpen` 提到模块作用域并导出，供不改动物理库存的写路径复用同一实现）、`server/outsourcing-wip-transfer.test.js`（新增）、`server/outsourcing-finance.test.js`（修正宽松断言）、`scripts/testing/test-suites.js`（新测试文件登记 FULL） |
| 修复的既有缺陷 | 数量 0 / 负数 / `NaN` / `Infinity` / 非法精度曾被接受并可能返回错误的 201；请求体 `idempotencyKey` 曾被 400 `VALIDATION` 拒绝；余额与身份在事务外读取；目标行唯一性未证明；`transferNo` 用毫秒时间戳；409 拒绝审计边界不唯一；无幂等合同、无并发守卫、无历史可证明性守卫 |
| 固定业务 code | `IDEMPOTENCY_KEY_REQUIRED`、`IDEMPOTENCY_KEY_INVALID`、`OUTSOURCING_WIP_TRANSFER_INVALID_QUANTITY`、`OUTSOURCING_WIP_TRANSFER_INVALID_DATE`、`OUTSOURCING_WIP_TRANSFER_INVALID_INPUT`、`OUTSOURCING_WIP_TRANSFER_SAME_ORDER`、`OUTSOURCING_WIP_TRANSFER_ORDER_STATE_INVALID`、`OUTSOURCING_WIP_TRANSFER_TARGET_NOT_UNIQUE`、`OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH`、`OUTSOURCING_WIP_TRANSFER_SUPPLIER_MISMATCH`、`OUTSOURCING_WIP_TRANSFER_WAREHOUSE_MISMATCH`、`OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED`、`OUTSOURCING_WIP_TRANSFER_OVERDRAW`、`OUTSOURCING_WIP_TRANSFER_IDENTITY_UNSUPPORTED`、`OUTSOURCING_WIP_TRANSFER_CONCURRENT_CONFLICT`、`OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT`、`OUTSOURCING_WIP_TRANSFER_NO_CONFLICT` |
| 实测证据 | focused `server/outsourcing-wip-transfer.test.js` **12/12 PASS**（退出码 0）；focused `server/outsourcing-finance.test.js` **7/7 PASS**（退出码 0）；FAST **576/576 PASS**（退出码 0）；FULL **3358/3358 PASS**（退出码 0）；`pnpm build` PASS（退出码 0）；`git diff --check` PASS（退出码 0） |
| I3a-S 的正确定性 | **不含任何正向 201**：本批次**未**产生任何 WIP 转移成功记录，也未产生任何转移成功审计（focused 断言逐项固定）。身份链（`TRANSFER_OUT` / `TRANSFER_IN` / `TRANSFER_ORIGIN`）在本批次**未**实现、**未**验证；正向 201 属 Phase C（I3a-P + I3b） |
| 幂等三态 | 缺键 → 400 `IDEMPOTENCY_KEY_REQUIRED`；同键异载荷 → 409 `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT` + 恰好一条拒绝审计；精确重放分支以**预置历史幂等记录**验证（返回已持久化的 `{id, transferNo, replayed:true}`，零新增转移事实、零新增成功审计）——本批次**自身**未产生任何可供重放的成功记录 |
| 状态 | `AUD-OUT-001` 仍为 `IMPLEMENTATION_AUTHORIZED`；Phase C（I3a-P + I3b）**未**开始。**未**签发任何 Acceptance |

**本增量明确不改变的**：`AUD-OUT-001` 的 `IMPLEMENTATION_AUTHORIZED` 标签（Phase B 不构成验收）；M1C-G03 / G06 既有 7/7 `PASS`；`B-P01` / `B-P02`、`D-P01` / `D-P02`、`VMI-01`～`VMI-05`、`PRC-06`、B3101 / B3121、Domain Acceptance；§31.14 / §26.34 的整体状态。本批次**未**新增 Schema / Migration、**未**连接真实 MySQL、**未**运行任何 MySQL Gate、**未** Push / Merge / Tag / Release / Deploy。

### 45.8 Phase C（I3a-P + I3b 正向转移）实施与验证增量（2026-11-08）

| 项 | 内容 |
|---|---|
| 实施文件 | `server/modules/outsourcing-inventory.js`（新增唯一规范身份写入 `recordWipTransferIdentity()`；`recordSupply` 增补 `sourceEffectId`、`recordConsumption` 增补 `allocationKind` 两个有界参数，既有调用点行为不变）、`server/modules/outsourcing-finance.js`（身份链落地、数量账与身份账对账、目标行身份证据状态）、`server/outsourcing-wip-transfer.test.js`（新增 I3a-P + I3b 断言） |
| 身份链（§26.34.15.2） | `TRANSFER_OUT` = 源行 `CONSUME`（`signed_quantity < 0`）→ `TRANSFER_ORIGIN` 分配指向合法**原始 SUPPLY effect** → `TRANSFER_IN` = 目标行 `SUPPLY`（`signed_quantity > 0`，经 `source_effect_id` 关联 `TRANSFER_OUT`）；两侧 `business_event_id` 关联同一 WIP Transfer ID；`TRANSFER_OUT` **不得**成为任何 `source_supply_effect_id` |
| 守恒 | `Σ transfer_out = Σ transfer_in = requested quantity`；源 `available_quantity` 减、目标增；`available_quantity = supplied − consumed` 恒成立；物料行数量账与身份账逐项对账，不一致即 fail closed |
| 物理与成本不变量 | 物理库存 `inventory` / `inventory_transactions` / `tracked_inventory_movements` / `inventory_mutation_log` / `inventory_valuation_movements` / `inventory_valuation_balances` 与 `supplier_bills` / `account_payables` / `accounting_vouchers` / `accounting_entries` **逐字段零变化**；企业所有权不变；成本零携带（`B-P01` 继续延期） |
| 幂等 | 首次 201 `{id, transferNo}`；精确重放 201 `{id, transferNo, replayed:true}` 且零新增转移事实 / 身份 effect / 数量变化 / 成功审计；同 Key 异载荷 409 `OUTSOURCING_WIP_TRANSFER_IDEMPOTENCY_CONFLICT` + 恰好一条拒绝审计；幂等记录、身份 effect、转移事实、数量更新与成功审计**同一事务**提交 |
| 实测证据 | focused `server/outsourcing-wip-transfer.test.js` **19/19 PASS** + `server/outsourcing-finance.test.js` **7/7 PASS**（合计 26/26，退出码 0）；FAST **576/576 PASS**（退出码 0）；FULL **3365/3365 PASS**（退出码 0）；`pnpm build` PASS（退出码 0）；`git diff --check` PASS（退出码 0） |
| 非空洞性证明 | 三次 mutation 实验均被 focused 断言捕获：①`TRANSFER_IN.source_effect_id` 置空 → 身份链断言失败；②`TRANSFER_ORIGIN` 改为 `CONSUMPTION` → 身份链断言失败；③源减改为源增 → 守恒断言与并发断言失败 |
| 状态迁移 | `AUD-OUT-001`：`IMPLEMENTATION_AUTHORIZED` → **`TESTED` / `PENDING_OWNER_APPROVAL`**。**未**签发 `AUD-OUT-001` 的 Acceptance，仍待 Owner 技术复核与真实 MySQL Gate |

**本增量明确不改变的**：§31.14 / §26.34 的整体状态（未签发 Requirement 验收或 `DESIGN_PASS`）；`A1-D-RV-01`～`A1-D-RV-04`；M1C-G03 / G06 既有 7/7 `PASS` 及其范围；`B-P01` / `B-P02`、`D-P01` / `D-P02`、`VMI-01`～`VMI-05`、`M1-F-07` / `M1-F-11`、`PRC-06`、B3101 / B3121、Domain Acceptance、`docs/status/CAPABILITY_MATRIX.md`。本批次**未**新增 Schema / Migration、**未**连接真实 MySQL 或生产数据库、**未**运行任何 MySQL Gate、**未** Push / Merge / Tag / Release / Deploy。

### 45.10 Acceptance 前定向修补增量（2026-11-08）

本节登记独立 Review 发现的两项边界修补与一处合同一致性更正。**未**重新设计 OUT-001，**未**新增 Schema / Migration，**未**建立第二套 WIP ledger，**未**改变已批准的物理库存 / 成本边界。

| 项 | 内容 |
|---|---|
| 修补一：目标 UOM | `createWipTransfer()` 在**事务内**核验 `targetMaterial.unit`、`sourceMaterial.unit` 与产品基础 UOM **三者一致**；任一不一致固定 409 `OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH`，零业务副作用、单次拒绝审计。跨 UOM 的数量归属不是同一物料的数量转移 |
| 修补二：`TRANSFER_ORIGIN` 供给来源封闭性 | §26.34.15.2 C2 的供给来源按 `event_type ∈ {ISSUE, SUPPLEMENT}` 封闭：`TRANSFER_IN` 本身也是 `effect_direction='SUPPLY'`，**不得**被当作原始供给。源行没有可覆盖本次转移数量的原始供给时，固定 409 `OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED`、零业务副作用、单次拒绝审计。**本轮未新增多级递归来源功能** |
| 合同一致性 | §26.34.5.2 表格把「同源同目标」由 409 行更正为 **400 输入校验行**；§26.34.13.2 I3a-S-1 明确其固定 code 为 `OUTSOURCING_WIP_TRANSFER_SAME_ORDER`。**对外行为未改变**：既有实现本就返回 400，本次只更正 Design 表述 |
| 实施文件 | `server/modules/outsourcing-finance.js`（UOM 三方一致门禁）、`server/modules/outsourcing-inventory.js`（`recordConsumption` 增补可选 `supplyEventTypes` 限定供给来源类型，既有物理腿调用点行为不变；`recordWipTransferIdentity` 传入原始供给类型并把供给不可证明映射为固定 code）、`server/outsourcing-wip-transfer.test.js`（新增 2 项定向断言）、`docs/design/procurement-outsourcing.md`（§26.34.4.2、§26.34.5.2、§26.34.13.2、§26.34.15.2 的必要表述） |
| 新增测试 | ①**目标 UOM 负向**：源 `PCS` / 目标 `BOX` → 409 `OUTSOURCING_WIP_TRANSFER_UOM_MISMATCH`；再以源 `EA`（合法）/ 目标 `BOX` **隔离**验证目标行门禁本身生效；两次均逐字段零副作用（转移事实 / 身份 effect / 物料数量 / 幂等成功记录 / 库存与财务事实）+ 拒绝审计恰好一次；恢复一致单位后同一源行可正常 201。②**多级转移定向**：A 原始 `ISSUE` SUPPLY → A→B 合法 201（`TRANSFER_ORIGIN` 指向 A 的 `ISSUE` effect，`TRANSFER_IN` 不冒充原始供给）→ B→C 固定 409 `OUTSOURCING_WIP_TRANSFER_SOURCE_UNVERIFIED` 且零副作用、拒绝审计恰好一次、以 `TRANSFER_IN` 为 `source_supply_effect_id` 的分配行数为 0；A→B 的 201 与全部事实不受影响 |
| 非空洞性证明 | 两次 mutation 均被 focused 断言捕获：①移除目标 UOM 门禁 → UOM 定向断言失败；②取消 `TRANSFER_ORIGIN` 的供给类型限定 → 多级转移断言由期望 409 变为实际 **201**（即原实现确实会把 `TRANSFER_IN` 冒充原始供给）。实验后实现已完整还原并复测通过 |
| 状态 | `AUD-OUT-001` 仍为 `TESTED` / `PENDING_OWNER_APPROVAL`；**未**签发 `AUD-OUT-001` Acceptance |

**本增量明确不改变的**：§31.14 / §26.34 的整体状态；`A1-D-RV-01`～`A1-D-RV-04`；M1C-G03 / G06 既有 7/7 `PASS`；`B-P01` / `B-P02`、`D-P01` / `D-P02`、`VMI-01`～`VMI-05`、`PRC-06`、B3101 / B3121、Domain Acceptance、`docs/status/CAPABILITY_MATRIX.md`。本轮**未**触碰 VMI、PRC-005、PRC-006 或任何其它审计 Issue；**未**新增 Schema / Migration、**未**建立第二套 WIP ledger、**未**改变物理库存 / 成本边界；**未**连接真实 MySQL 或生产数据库、**未**运行任何 MySQL Gate、**未** Push / Merge / Tag / Release / Deploy。

### 45.11 仍需真实 MySQL 8 验证的清单（**未获授权，未运行**）

沿用 §45.9，并补充本轮定向修补相关项：

| # | 待验项 | 说明 |
|---|---|---|
| M1 | **命名锁** | `idempotencyReplay()` 的 MySQL 命名锁在「未命中即持锁 → 事务提交 / 回滚 → `releaseMySqlIdempotencyLocks()` 确认释放」全链路上不产生 `LOCK_ABSENT` / 未确认释放 / 连接隔离 |
| M2 | **不同 Key 并发** | 不同幂等键的同源并发转移的败方 code。**2026-11-08 源码复核更正**：真实 MySQL 与 SQLite 的败方**同为** `OUTSOURCING_WIP_TRANSFER_OVERDRAW` —— `server/db.js` 的 `transaction()` 在 MySQL 下先取得 `mysql_transaction_gates` 全局行锁（`SELECT gate_id FROM mysql_transaction_gates WHERE gate_id=1 FOR UPDATE`）并持有到 COMMIT/ROLLBACK，因此两个不同 Key 的转移**根本不会交错**：败方在事务内重读到已被扣减的余额，按超额拒绝。`OUTSOURCING_WIP_TRANSFER_CONCURRENT_CONFLICT`（CAS 受影响行数守卫）在当前全局门禁下**不可达**，只作为纵深防御存在。待验项据此收敛为：败方固定 409 `OUTSOURCING_WIP_TRANSFER_OVERDRAW`、最终可用量不为负、无双写、无重复 effect |
| M3 | **COMMIT 不确定** | `transaction()` 的不确定 COMMIT 路径（`mysqlRequestTimeout` / `sessionLost`）不自动重试写操作、不产生第二笔转移事实；§26.34.14.3 的 R1～R5 恢复条件在真实会话终止 / epoch 变化证据下可判定 |
| M4 | **CHECK / UNIQUE / FK** | `outsourcing_wip_identity_effects` / `..._effect_allocations` / `..._identity_balances` 在 MySQL 8 下的 CHECK（`available_quantity = supplied − consumed`、`available_quantity >= 0`）、UNIQUE（`event_type, business_event_id, business_event_item_id, identity_key`；`effect_id, source_supply_effect_id, allocation_kind`；`transfer_no`）与 FK 语义与 SQLite 等价 |
| M5 | **编号碰撞** | `transferNo`（`WIP-XFER-<业务日期>-<12 位十六进制>`，48 位熵）在 MySQL 并发下的 `UNIQUE` 冲突路径确实映射为 409 `OUTSOURCING_WIP_TRANSFER_NO_CONFLICT`，而不是 500 |

### 45.12 OUT-001 受保护真实 MySQL 8 Gate 范围登记（2026-11-08）

本节登记 Gate 的**范围与状态**。权威 Design 见 [`docs/design/procurement-outsourcing.md`](../design/procurement-outsourcing.md) §26.34.16。**本轮未执行真实 MySQL Gate。**

| 项 | 内容 |
|---|---|
| ACK-4 Manifest | 独立 Manifest **`OUT_001_MYSQL_V1`**，操作范围 `RESET_SCHEMA_PRE_RUN` → `BOOTSTRAP_CURRENT_SCHEMA` → `RUN_OUT001_HTTP_FIXTURES` → `CLEANUP_SCHEMA_POST_RUN`。`M1_CORE_MANIFEST` **未被修改**、未被复用；不复用被 `blockUnmigratedAck4Entry` 阻断的旧入口 |
| Gate 文件 | `scripts/gates/mysql-out001-gate.mjs`（Root）、`scripts/gates/mysql-out001-child.mjs`（Child）、`scripts/gates/mysql-out001-root-lifecycle.mjs`（Root 生命周期）、`scripts/gates/mysql-out001-static-preflight.mjs`（静态前置）、`scripts/gates/run-out001-mysql-gate.ps1`（launcher）、`package.json` 的 `test:mysql:out001` |
| 复用 | `scripts/gates/ack4/ack4-runtime.mjs`（ACK-4 运行时）、`scripts/gates/mysql-local-target-contract.mjs`（固定目标合同）、`server/test-utils/mysql-wave10-campaign-target.js`（身份 / 授权 / 对象清单）、`server/test-utils/mysql-disposable-target.js`（一次性目标守卫）、`server/test-utils/m1-core-g07-lock-wait.js`（确定性门禁屏障）、`server/test-utils/m1-core-schema-parity.js`（双端 Parity 比较器） |
| 目标绑定 | 固定一次性 MySQL 8 目标；核对 `server UUID`、`CURRENT_USER()`、有效授权 SHA-256 指纹、MySQL 8 版本；初始对象必须为空；DPAPI 口令不落盘；独占命名 Mutex；ACK-4 单次消费 + 精确 SHA / Manifest / Target；Child 只执行被签名 Lease 授权的操作；清理失败 → quarantine；收尾由独立只读 postflight 核验五类对象为零；launcher **不接受**任何脚本参数 |
| 清理权责 | Schema 清理只属于 Root 的 `CLEANUP_SCHEMA_POST_RUN` 子进程。测试进程只关闭自己的连接：`deferMySqlCleanup()`（`server/test-utils/mysql-disposable-target.js`）把来自测试进程的清理请求变成「已延期」；`server/test-support/procurement-http-fixture.js` 新增 MySQL 分支，只打开**已 bootstrap** 的会话（不调用 `createDatabase()`，不执行 DDL） |
| M1–M5 | 见 §26.34.16.3。M2 的败方 code 已按 §45.11 更正为 `OUTSOURCING_WIP_TRANSFER_OVERDRAW`；M3 的**真实**不确定 COMMIT 在一次性 least-privilege 账户下不可达（缺 `CONNECTION_ADMIN`），该子项在 Gate 中显式标注 `NOT_PROVEN_ON_REAL_MYSQL` |
| 28 项 focused 的 MySQL 版本 | `server/mysql-out001.integration.js` 直接复用 `server/outsourcing-wip-transfer.test.js`（21 项）与 `server/outsourcing-finance.test.js`（7 项）；两个文件按后端选择夹具，因此 MySQL 跑的是**同一批断言** |
| 本地离线验证 | `server/mysql-out001-gate-infrastructure.test.js` + `mysql-disposable-target-guard.test.js` 新增用例：11/11 PASS；OUT-001 focused SQLite：28/28 PASS；专属集成入口在非 MySQL 环境：28 PASS + M1～M5 六项显式 SKIP；FAST：581/581 PASS；FULL：3371/3372，唯一失败为既有 Windows ACL `SetAccessControl` 沙箱拒绝，故 FULL **FAIL**、不得记为 PASS；Build PASS；Docs migration C1～C6 PASS；提交 `fbf3ceb` 后 Docs current N1/N3～N9 PASS、N2 RETIRED；`git diff --check` PASS。真实 MySQL Gate 仍为 `NOT_RUN` |

**Gate 状态词汇（严格区分，不得混用）**：

| 状态 | 含义 | 当前 |
|---|---|---|
| `GATE_IMPLEMENTED` | Gate 代码、Manifest、子进程与测试已入仓 | **达成** |
| `GATE_READY` | 代码与合同就绪，可被授权执行 | **未达成**（待 Owner 技术复核） |
| `GATE_AUTHORIZED` | Owner 已就这一次目标签发 ACK-4 能力 | **未达成** |
| `GATE_EXECUTED` | 对真实 MySQL 实际跑过一次并留下终态 | **未达成**（本轮 `NOT_RUN`） |
| `GATE_ACCEPTED` | Owner 依据执行证据接受该 Gate 结论 | **未达成** |

**本节明确不改变的**：`AUD-OUT-001` 仍为 `TESTED` / `PENDING_OWNER_APPROVAL`；**未**签发 OUT-001 Acceptance、Domain Acceptance、Capability Freeze 或 Release；§31.14 / §26.34 的整体状态不变；`A1-D-RV-01`～`A1-D-RV-04` 不变；M1-Core 七 Gate、`B-P01`/`B-P02`、`D-P01`/`D-P02`、VMI、`PRC-06`、B3101 / B3121 原状态不变。本轮**未**执行真实 MySQL Gate、**未**手动设置破坏性环境变量、**未**执行 Migration / DDL、**未**连接生产数据库、**未**创建 ACK-4 Capability、**未**触碰 VMI / PRC-005 / PRC-006 或任何其它审计 Issue、**未** Merge / Tag / Release / Deploy。

### 45.13 OUT-001 MySQL Gate Owner 复核后最小安全修补（2026-11-08）

本节登记 Owner 对 §45.12 Gate 的技术复核修补；它只修改 Gate 基础设施、真实 MySQL 测试代码与离线证据，**不执行**真实 MySQL Gate，不改变 OUT-001 业务实现、Schema、Migration、`M1_CORE_MANIFEST` 或数据库权限。

| 复核项 | 修补与当前证据 |
|---|---|
| Global Mutex | 删除普通 Session Mutex 降级；`Global\...` 创建或获取失败直接 `BLOCKED`，ACK-4 消费与破坏性操作不可达；异常路径显式释放句柄。包含空格的 repo / capability / proof / child 路径按 Windows PowerShell 5.1 native argument 规则显式引用 |
| EMPTY_ONLY / RESET | `RESET_SCHEMA_PRE_RUN` Child 重新验证目标与 `SELECT DATABASE()`，统计 BASE TABLE / VIEW / TRIGGER / ROUTINE / EVENT；任一非零即拒绝。空库 RESET 为零 DROP 的已证明 no-op，避免检查后再删除并发出现的未知对象。Root 只在 Child 退出成功且 JSON、`dropped=0`、五类计数全零后设置 `resetCompleted=true`；RESET 失败或结果不确定时 Cleanup 次数固定为 0，现场进入 quarantine |
| Child / Postflight | 操作超时：RESET 2 分钟、Bootstrap 10 分钟、HTTP Fixtures 30 分钟、Cleanup 5 分钟、Postflight 2 分钟；Windows 使用 `taskkill /T /F` 终止进程树并等待退出确认。无法确认退出时禁止 Cleanup。Postflight 等待进程、stdout、stderr 全部结束后解析完整 JSON，缺失、截断、异常退出或超时一律未验证 |
| M2 | 测试代码改为两个独立 Node.js 应用进程；每个进程独占 HTTP Server 与 MySQL Adapter，继续使用确定性事务门禁屏障；本轮只完成代码与非 MySQL 加载验证，真实 MySQL `NOT_RUN` |
| M3 | 测试代码改为通过真实 `releaseMySqlIdempotencyLocks()` 构造 `RELEASE_LOCK=0`，验证 quarantine、`TERMINATION_CONFIRMED`、observer 重获同名锁、victim 从 PROCESSLIST 消失且无新业务会话。真实不确定 COMMIT 仍明确为 `NOT_PROVEN_ON_REAL_MYSQL` |
| M4 | 增加 identity effect 业务键、effect allocation 业务键与幂等业务键的独立真实 MySQL 重复键行为断言；要求 `ER_DUP_ENTRY` / errno 1062，并由生产分类器识别。未修改 Schema |

本地实测：Gate/guard/专属非 MySQL 合并运行 **54 项**（48 PASS + 6 个真实 MySQL 合同 SKIP，退出码 0）；OUT-001 focused SQLite **28/28 PASS**；FAST **590/590 PASS**；Build PASS；Docs current N1/N3～N9 PASS、N2 `RETIRED`；Docs migration C1～C6 PASS；PowerShell AST parse PASS；FULL **3380/3381**，唯一失败仍是既有 Windows ACL `SetAccessControl` 沙箱拒绝，因此 FULL 保持 **FAIL**；`git diff --check` PASS。首次直接调用 `pnpm` 被本机 execution policy 拒绝（退出码 1），改用仓库既有 Windows 入口 `pnpm.cmd` 后得到上述真实结果。

Gate 状态保持：`GATE_IMPLEMENTED` **达成**；`GATE_READY` **未达成（待 Owner 技术复核）**；`GATE_AUTHORIZED` **未达成**；`GATE_EXECUTED = NOT_RUN`；`GATE_ACCEPTED` **未达成**。`AUD-OUT-001` 仍为 `TESTED` / `PENDING_OWNER_APPROVAL`，`NOT_PROVEN_ON_REAL_MYSQL` 保留。

### 45.14 OUT-001 MySQL Gate Final Focused Review 修补（2026-11-08）

本节只登记 Owner 最终 focused review 指定的四项 Gate 修补及离线证据；不重建 Gate，不改变业务代码、Schema、Migration、`M1_CORE_MANIFEST` 或数据库权限。

| 复核项 | 最终修补与离线证据 |
|---|---|
| Windows Process Tree | `taskkill /T /F` 的 callback error 与真实 exit code 均须成功；执行前通过 `Win32_Process` 固化父进程及全部已知后代 PID，执行后同时确认 Node 父进程退出与全部已知 PID 从进程表消失，任一查询、终止或确认失败均返回 `false`，不再使用仅终止父进程的 fallback。真实离线父进程 + 孙进程用例逐项确认二者均退出 |
| PowerShell 5.1 native argv | 外层双引号由 `[char]34` 明确生成，内部双引号及尾部反斜杠继续按 Windows native argv 规则转义；独立含空格临时目录下用 Windows PowerShell 5.1 `Start-Process` 调用 Node argv 回显程序，repository、Capability、target proof、child script 四类路径及内嵌双引号值全部逐项原值相等 |
| M3 因果关系 | victim 真实持有且本地登记不包含 `sentinelLock`；本地集合只登记未持有的 `unownedLock`。真实 `releaseMySqlIdempotencyLocks()` 对后者得到 `NOT_OWNER` 并 quarantine；只有 victim 到达 `TERMINATION_CONFIRMED` 后 observer 才观察到 sentinel 释放、重新取得该锁并确认 victim 已从 PROCESSLIST 消失。不存在提前手动释放 sentinel 的语句；真实不确定 COMMIT 仍为 `NOT_PROVEN_ON_REAL_MYSQL` |
| Root Children 状态 | `childrenExited` 只在 `stopChildren() === true` 且全部登记项 `exited === true` 时成立；`markChildExited` 异常不再吞掉。离线用例证明「stop 成功但登记未完成」与「退出登记抛错」均 `childrenExited=false`、cleanup 0 次并进入 quarantine |

本地验证（均未连接真实 MySQL）：Gate infrastructure **14/14 PASS**；disposable target guard **10/10 PASS**；OUT-001 SQLite focused **28/28 PASS**；FAST **594/594 PASS**；Build PASS；Docs current N1/N3～N9 PASS、N2 `RETIRED`；Docs migration C1～C6 PASS；`git diff --check` PASS。首次在受限沙箱内执行进程树 focused 因 `Get-CimInstance` / `taskkill` 被拒绝而退出 1；按 Windows 进程测试所需权限在沙箱外原命令重跑后 14/14、退出 0，父/孙 PID 均消失。FULL 本轮未重跑；上一轮 **3380/3381**、唯一既有 Windows ACL `SetAccessControl` 失败的事实保持不变。

Gate 状态不推进：`GATE_IMPLEMENTED` 已达成；`GATE_READY` 仍待 Owner 最终技术复核；`GATE_AUTHORIZED` / `GATE_ACCEPTED` 未达成；`GATE_EXECUTED = NOT_RUN`。`AUD-OUT-001` 仍为 `TESTED` / `PENDING_OWNER_APPROVAL`，未生成 ACK-4 Capability，未签发 Acceptance，真实 MySQL 与 RESET / BOOTSTRAP / CLEANUP 始终 `NOT_RUN`。

### 45.15 OUT-001 MySQL Gate 最终两项精确修复（2026-11-09）

本节只登记 Owner 最终复核指定的两项精确修复与离线证据；不改变 OUT-001 业务实现、PowerShell Launcher、Schema、Migration、`M1_CORE_MANIFEST` 或数据库权限。

| 复核项 | 修复与证据 |
|---|---|
| Suite 后代退出证明 | `RUN_OUT001_HTTP_FIXTURES` 的两个 M2 App 在 ACK-4 children 目录下的受控 JSONL registry 持久登记 `runId + purpose + PID + process creation time`；Suite 的正常完成与 Root `stopChildren()` 统一调用同一退出核验。缺失、损坏、RunId 不符、进程查询失败或任一相同创建时间的 PID 仍存活都 fail closed。离线 A/B/C 用例分别证明「Suite 与两个登记后代均退出才允许 Cleanup」「Suite 父进程已退出但后代仍存活时 Cleanup 0 次并 quarantine」「缺失/损坏/错误 RunId 证据时 Cleanup 0 次并 quarantine」 |
| M3 NOT_OWNER 因果 | observer 先真实取得 `unownedLock` 并以 `IS_USED_LOCK()` 确认 owner 为 observer connection id；victim 的本地集合只登记该锁，真实 `releaseMySqlIdempotencyLocks()` 因此得到 `NOT_OWNER` 并进入 quarantine。observer 在 `finally` 中只释放自己仍持有的 `unownedLock`；`sentinelLock` 继续由 victim 持有直至会话终止，未增加提前释放路径。真实 COMMIT 不确定性继续为 `NOT_PROVEN_ON_REAL_MYSQL` |

本地验证（均未连接真实 MySQL）：Gate infrastructure **17/17 PASS**（退出码 0）；disposable target guard **10/10 PASS**（退出码 0）；OUT-001 SQLite focused **28/28 PASS**（退出码 0）；`server/mysql-out001.integration.js` 语法检查 PASS（退出码 0）；FAST **597/597 PASS**（退出码 0）；Build PASS（退出码 0）；Docs current N1/N3～N9 PASS、N2 `RETIRED`（退出码 0）；Docs migration C1～C6 PASS（退出码 0）；`git diff --check` PASS（退出码 0）。开发中的前两次 infrastructure 运行各退出 1：第一次暴露登记时序竞争，第二次暴露测试后代未 detached；修正离线夹具后最终 17/17。FULL 本轮不重跑；上一轮 **3380/3381**、唯一既有 Windows ACL `SetAccessControl` 失败的事实保持不变。

Gate 状态不推进：`GATE_READY`、`GATE_AUTHORIZED`、`GATE_ACCEPTED` 均未签发；`GATE_EXECUTED = NOT_RUN`。`AUD-OUT-001` 仍为 `TESTED` / `PENDING_OWNER_APPROVAL`，未生成 ACK-4 Capability，未签发 Acceptance，真实 MySQL、MySQL integration 与 RESET / BOOTSTRAP / CLEANUP 始终 `NOT_RUN`。

### 45.16 OUT-001 候选基线冻结与真实 MySQL Gate 执行状态（2026-11-09）

本节登记 OUT-001 本轮候选基线与 Gate 执行边界。候选基线只冻结代码与证据，不等于 Gate Acceptance、Domain Acceptance 或 Release Readiness。

| 项 | 冻结值 / 状态 |
|---|---|
| Candidate baseline SHA | `a5fffd10835336fc5137ff2768290f5c34def4ea` |
| Candidate reference branch | `candidate/out001-a5fffd1`（创建时精确指向上述 SHA；不得前移或复用） |
| master at freeze | `a5fffd10835336fc5137ff2768290f5c34def4ea`；状态台账后续提交不改变 Candidate reference |
| Commit | `修正 OUT-001 M2 转移事实计数断言` |
| Tree | `98d9c6402f902900d788cf9c23bbbdd819b2adf4` |
| 唯一代码变更 | `server/mysql-out001.integration.js`，新增 18 行、删除 1 行 |
| 版本 / Release tags | `1.6.2`；既有 Release tag 不变 |
| 工作树 | Owner 提交报告为 clean；本登记不声称远端可验证本地工作树 |

本轮代码修正将 M2 的转移事实断言从全表绝对数量改为并发前后净新增数量，并限定本次 source / target order pair 恰好形成一笔转移事实；其余 M2 断言保持不变。该修正不触及业务实现、Schema、Migration、ACK-4 Manifest、Gate Launcher 或版本文件。

**候选基线已有离线证据（Owner 本轮提交报告）：**

- OUT-001 离线入口：28 PASS；6 个真实 MySQL 用例 SKIP；退出码 0。
- FAST：597/597 PASS；Build：PASS；Docs current：N1、N3–N9 PASS，N2 `RETIRED`；Docs migration：C1–C6 PASS；`git diff --check`：PASS。
- 首次受限权限 FAST 因 Windows 进程树夹具无法清理而退出 1；核实并清理遗留测试树后，以所需权限按原命令重跑通过。
- FULL 本轮未重跑；既有 3380/3381 与唯一 Windows ACL `SetAccessControl` 失败事实继续保留。
- 以上均不构成真实 MySQL 证据；真实 MySQL、RESET、BOOTSTRAP、CLEANUP 仍为 `NOT_RUN`。

**远端基线检查（2026-11-09）：** 冻结时 GitHub `master` HEAD 与 Candidate SHA 完全一致；该 SHA 未返回 GitHub commit status 或 workflow run。检查时 `master` branch protection 未启用。候选分支仅作为 SHA 锚点，不代表 GitHub branch protection；不得将无 CI 状态解释为 CI PASS。

**ACK-4 与 Gate 状态：**

| 状态项 | 当前登记 |
|---|---|
| `GATE_IMPLEMENTED` | COMPLETE |
| Candidate baseline | FROZEN（固定 SHA 与候选分支） |
| Owner 本轮执行意图 | 已明确提出受保护真实 MySQL 验证 |
| `GATE_READY` | PENDING：实际 Windows DPAPI / ACL issuer 检查与只读 MySQL target preflight 尚未提供本轮证据 |
| ACK-4 Capability | NOT_ISSUED；必须绑定 Candidate SHA、固定目标身份、RunId 与完整 `OUT_001_MYSQL_V1` Manifest |
| `GATE_EXECUTED` | NOT_RUN |
| `GATE_ACCEPTED` | NOT_ACCEPTED |

执行目标固定为 `127.0.0.1:3306 / modern_erp_domain_test / modern_erp_test`，仅允许受保护 Launcher 在只读 preflight 确认 MySQL 8、固定 server UUID / CURRENT_USER / grants fingerprint、精确最小权限及五类对象初始均为空后继续。ACK-4 只允许 `RESET_SCHEMA_PRE_RUN → BOOTSTRAP_CURRENT_SCHEMA → RUN_OUT001_HTTP_FIXTURES → CLEANUP_SCHEMA_POST_RUN`；Root 随后必须通过独立只读 Postflight 证明 tables / views / triggers / routines / events 全为零。不得对生产库或含有任何初始对象的库运行；不得跳过 ACL、身份、空库、互斥锁或子进程退出证明。

M3 不确定 COMMIT 在真实 MySQL 下仍为 `NOT_PROVEN_ON_REAL_MYSQL`，不得随 OUT-001 其他用例通过而自动关闭。只有真实 MySQL 套件通过、所有子进程退出得到证明、Cleanup 与独立 Postflight 通过，才能登记 Gate 执行完成；Owner Acceptance 另行签发。

### 45.17 OUT-001 一次性收尾修复：M1b / M3 / TAP 持久化 / N7 追溯（2026-11-09）

本节登记本轮一次性收尾修复的**范围、证据与仍未关闭的事项**。本轮只修复 Gate 基础设施、测试层断言与文档追溯，**不改变** OUT-001 业务实现、Schema、Migration、ACK-4 Manifest、数据库权限、版本号与既有 release tag。

| 项 | 本轮结果 |
|---|---|
| M1b 结构 | 改为「独立 HTTP 应用子进程 + 屏障会话」：父进程持有全局事务门禁，独立应用进程先取得自己的幂等命名锁、再阻塞在门禁上；观察到门禁等待者后证明命名锁在请求期间确实被持有；解除屏障后请求返回固定 409 `OUTSOURCING_WIP_TRANSFER_OVERDRAW`；ROLLBACK 后命名锁可被第三方会话重新取得；拒绝审计恰好一条；WIP / 身份 / 数量 / 幂等记录逐字段零变化；物理库存、估值与财务逐字段零变化；子进程正常退出（退出码 0 且无信号终止） |
| M1b 异常与清理路径 | 清理钩子在任何可能抛错的步骤**之前**注册：屏障回滚、两个独立会话关闭与子进程回收在断言失败时同样执行；优雅退出超时先 `SIGKILL` 再报错，绝不把存活的子进程留给下一次 Gate；M2 的两个应用改为逐个关闭，一个关闭失败不阻断另一个的回收 |
| 后代登记计数 | 独立 HTTP 应用进程由 2 个增至 3 个（M1b 1 个 + M2 2 个）；受控 registry 的条数校验同步收紧，少登记即 fail closed |
| M3 会话状态 | `FRESH → ACTIVE → IDLE_TRUSTED` 的 COMMIT 路径与 ROLLBACK 路径各自独立断言；ROLLBACK 路径额外断言原始异常对象原样透出 |
| M3 quarantine → 终止确认 | 锁释放未确认 → `NOT_OWNER` → `quarantine` → `TERMINATION_PENDING` → `TERMINATION_CONFIRMED` → `sessionState === 'TERMINATED'` 全链断言。**终止未确认时**与**终止已确认后**两次断言该连接不得再启动业务体（`MYSQL_TRANSACTION_ADMISSION_REFUSED` / `ADAPTER_QUARANTINED`）；核验连接必须可信且与原会话不同（R3） |
| M3 不确定 COMMIT | recovery worker 夹具补齐与真实 Worker 一致的 `sessionLost` 标记；业务体注入连接丢失使 COMMIT 结果未知，并使随后的 ROLLBACK 同样无法被证明，因此适配器进入隔离而不是回到可信空闲状态；断言业务体只执行一次、原始错误原样透出且携带 `sessionLost` |
| TAP 持久化 | 每个子进程（RESET / BOOTSTRAP / Suite / CLEANUP / Postflight）的 stdout 与 stderr **完整**写入 `%LOCALAPPDATA%\ModernERP\mysql-gate\evidence\<RunId>\suites\<label>\` 下的 `stdout.tap` / `stderr.log` / `result.json`；落盘路径绑定 RunId；成功、非零退出、超时与流异常路径都留下证据；TAP 不再只在内存中收集；必须等 Child 退出、两路输出流结束且文件 fd 关闭之后才计算字节数与 SHA-256 |
| TAP 判定 | `result.json` 记录 suite 名、退出码、stdout/stderr 字节数与 SHA-256、替换次数与 TAP 汇总。TAP 解析要求 `tests/pass/fail/skipped` 齐全且 `pass+fail+cancelled+skipped+todo === tests`，否则判为解析失败；**TAP 解析失败、有失败项、有取消项或退出码非零时 `testsPassed` 一律不得为 true** |
| 证据密钥 | 数据库密码、DPAPI 解密内容、Capability 明文与 approval 明文不落盘：输出在字节层被替换为 `[REDACTED]` 并记录替换次数；替换边界保证跨 chunk 与被 chunk 边界切开的密钥都不会先落盘再被替换 |
| N7 追溯修复 | `a40e356` 新增 `docs/status/PROJECT_STATUS.md` §45.16，却未在提交消息中引用该章节编号或该文件完整路径，N7 因此 FAIL。修复方式为**只改提交消息**的有界本地历史重写：文件树、作者、提交者与时间戳逐项保持不变，新旧 HEAD 的 `git diff --exit-code` 为 0；原始历史由本地备份分支 `backup/n7-pre-rewrite-20261109-97eea5a5` 与既有候选分支 `candidate/out001-97eea5a` 继续保留 |
| 摘要 | Gate 的最终 JSON summary 与 PowerShell Launcher 输出都逐条列出每个 suite 的证据文件路径、字节数与 SHA-256 |

**本轮实际验证结果**（全部未连接真实 MySQL、未执行任何数据库写操作）：

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 语法检查 | `node --check`（11 个受影响的 js/mjs 文件） | 0 | 11/11 OK |
| OUT-001 focused SQLite | `node --test server/mysql-out001.integration.js` | 0 | 34 tests：28 PASS / 6 SKIP（6 个真实 MySQL 用例）/ 0 FAIL |
| disposable target guard | `node --test server/mysql-disposable-target-guard.test.js` | 0 | 10/10 PASS |
| Gate infrastructure | `node --test server/mysql-out001-gate-infrastructure.test.js` | 0 | 27/27 PASS（其中 10 项为本轮新增的证据持久化用例） |
| FAST | `pnpm test:fast` | 0 | 607/607 PASS / 0 FAIL / 0 SKIP |
| FULL | `pnpm test` | 0 | 3398/3398 PASS / 0 FAIL / 0 SKIP |
| Build | `pnpm build` | 0 | PASS |
| Docs current | `node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD` | 0 | N1、N3–N9 PASS，N2 `RETIRED` |
| Docs migration | `node scripts/docs/check-doc-consistency.mjs --mode migration` | 0 | C1–C6 PASS |
| `git diff --check` | `git diff --check` | 0 | PASS |

**本轮明确未发生**：真实 MySQL Gate 未重新运行；未连接真实 MySQL；未执行 RESET / BOOTSTRAP / CLEANUP / Migration / DDL；未重新签发或消费 ACK-4（上一轮 ACK-4 的 RunId 已消费，不可复用）；未修改生产业务合同、Schema、Migration、命名锁合同、全局事务门禁与超时配置；未修改 `AUD-OUT-001` 的 `TESTED` / `PENDING_OWNER_APPROVAL` 状态；未把 `PRC-06` 改为 `COVERED`；未改变 M1-Core 七 Gate 的既有结果；未修改 `package.json` 版本与既有 release tag；未 Push / Merge / Tag / Release / Deploy。

**仍未关闭的事项**：M3 的**真实**不确定 COMMIT 仍为 `NOT_PROVEN_ON_REAL_MYSQL`（真实库需要 `CONNECTION_ADMIN` 在提交中途 `KILL CONNECTION`，一次性 least-privilege 账户刻意没有该权限）；`GATE_READY` / `GATE_AUTHORIZED` / `GATE_EXECUTED` / `GATE_ACCEPTED` 仍未签发；`AUD-OUT-001` 仍为 `TESTED` / `PENDING_OWNER_APPROVAL`。

**关于既有 Windows ACL 失败**：§45.16 记录的「既有 3380/3381、唯一 Windows ACL `SetAccessControl` 失败」在本轮 FULL 中**未复现**——本轮 FULL 为 3398/3398、0 FAIL，对应用例 `production evidence writer creates a readable sanitized file with platform restriction applied` 本轮 PASS。本轮**未修改**该用例、该 ACL 代码或任何权限配置，因此只登记「本轮未复现」这一事实，不把它记作已修复。

**历史重写的边界与后续**：N7 修复只重写了本地工作分支 `fix/out001-mysql-test-fixtures`；`master` 与 `github/master` 仍指向旧历史，因此其 N7 仍为 FAIL，直到 Owner 批准把重写后的历史推送 / 合并为止。旧候选分支 `candidate/out001-97eea5a` 与本地备份分支均未被覆盖或删除。

### 45.18 OUT-001 第二次受保护真实 MySQL 8 Gate 执行与 Launcher 报告链阻塞（2026-11-09）

本节登记 Owner 对冻结候选 `candidate/out001-075e0f6` @ `075e0f6e61108a423c4ae0b194199edec2bc9465`
的一次性真实 MySQL 8 Gate 授权、实际执行结果与执行后最小离线修补。它只登记本次执行事实，**不签发**
`AUD-OUT-001` Acceptance、Domain Acceptance、Capability Freeze、Release 或 Deploy。

| 项 | 实际结果 |
|---|---|
| Preflight | Windows PowerShell `5.1.26100.9711`；DPAPI CurrentUser PASS；MySQL `8.0.37`；`DATABASE()`、`CURRENT_USER()`、server UUID、grants SHA-256 与固定八字段身份完全一致；least privilege PASS；tables/views/triggers/routines/events=`0/0/0/0/0`；无 ACK-4 quarantine；Issuer 的显式 `System.Security` 与 SID-only ACL 合同 PASS |
| ACK-4 | RunId `0adfecb6-7db9-4015-9c41-cc36ad42ec48`；Issuer exit `0`；10 分钟窗口；明文 approval 已删除；DPAPI Capability 仅当前 SID；Capability 已原子移动到 `ack4/consumed`，不得复用 |
| RESET | exit `0`；初始 dropped=`0`；五类对象均为 `0` |
| BOOTSTRAP | exit `0`；`bootstrapped=true` |
| RUN | `server/mysql-out001.integration.js` exit `0`；真实 TAP `34 tests / 34 PASS / 0 FAIL / 0 SKIP / 0 CANCELLED`；M1、M1b、M2、M3、M4、M5 全部 PASS |
| CLEANUP | exit `0`；dropped=`331`；inventory=`[]` |
| Root Postflight | exit `0`；tables/views/triggers/routines/events=`0/0/0/0/0` |
| 独立事后 Postflight | 同一固定身份与 least privilege 再次 PASS；五类对象仍为 `0/0/0/0/0`；无 quarantine |
| 进程退出 | 4 个 ACK-4 child、3 个登记的 `OUT001_HTTP_APP` 后代与 Root PID 均已退出；没有残留应用子进程 |
| Evidence | `%LOCALAPPDATA%\ModernERP\mysql-gate\evidence\0adfecb6-7db9-4015-9c41-cc36ad42ec48\`；5 组 `stdout.tap` / `stderr.log` / `result.json` 的实际字节数与 SHA-256 全部匹配；RunId 全部一致；密码、approval 明文与明文 Capability 文件均未出现 |
| Root 终态 | 根据 `runOut001MySqlLifecycle()` 的唯一状态机与已持久化的 `testsPassed=true`、全部登记进程退出、Cleanup/Postflight 成功、无 quarantine，Root 已进入 `FINISHED`；但冻结 Launcher 未持久化最终 Root JSON，该 JSON 在下述报告阶段异常后丢失，故**完整 Root JSON 证据要求未满足** |
| Launcher | exit `8`。数据库 Gate 已结束后，证据摘要读取不存在的 `tap.pass` / `tap.fail`，而持久化合同实际为 `tap.passed` / `tap.failed`；PowerShell StrictMode 抛出属性不存在异常。该失败不回滚已完成的 Gate，也不得被包装成 Launcher PASS |

状态严格登记为：

| 状态 | 本轮结论 |
|---|---|
| `GATE_READY` | 达成（本轮真实 DPAPI / ACL / target preflight 证据） |
| `GATE_AUTHORIZED` | 达成且已消费（仅 RunId `0adfecb6-...`） |
| `GATE_EXECUTED` | **EXECUTED**（真实 MySQL 套件与 Root cleanup/postflight 均实际运行） |
| Gate 技术 PASS 登记 | **BLOCKED**：Launcher exit `8` 且最终 Root JSON 未持久化；不得登记完整 Gate PASS |
| `GATE_ACCEPTED` | **NOT_ACCEPTED**；未签发 `AUD-OUT-001` Acceptance |
| M3 真实不确定 COMMIT | 继续为 `NOT_PROVEN_ON_REAL_MYSQL`；本次 M3 PASS 不改变该残余边界 |

执行后自动失败诊断确认唯一新增缺陷位于测试证据报告层。按 Owner 已授权的失败处置边界，从冻结候选创建
本地分支 `fix/out001-launcher-tap-summary-0adfecb6`，仅将 Launcher 汇总字段修正为 `tap.passed` /
`tap.failed`，并在 `server/mysql-out001-gate-infrastructure.test.js` 增加静态合同断言。离线 focused
`27/27 PASS`；FAST 首次在受限沙箱复现已知 CIM/taskkill 权限失败并被终止，随后在所需权限下原命令
`607/607 PASS`。**未**签发第二张 ACK-4、未再次运行数据库 Gate、未修改业务合同、Schema、Migration、
数据库权限或版本号；未 Push / Merge / Tag / Release / Deploy。

### 45.19 OUT-001 Root Evidence 持久化与历史 RunId 离线对账（2026-11-09）

本节在 §45.18 的执行事实之上登记最终离线收尾；不改写 §45.18，也不把重建件冒充执行当时不存在的原始 Root JSON。Owner 已授权本轮代码、证据、测试、状态和本地 Git 收尾；未授权且本轮未发生任何 MySQL 连接、RESET / BOOTSTRAP / CLEANUP、ACK-4 签发或消费、数据库/Schema/Migration/权限变更、远端 Git 写入或发布动作。

| 项目 | 本轮结论 |
|---|---|
| Root Evidence 合同 | 新增 `root-report.json` + `root-manifest.json`：绑定 UUIDv4 RunId、完整 Commit SHA、Manifest、Root 终态、测试/清理/进程退出布尔值、清理次数、子进程身份/退出码、Suite 与完整 evidence；报告按字节脱敏，临时文件原子 rename，既有目标拒绝覆盖，manifest 绑定报告文件名、字节数、SHA-256 与 evidence 数量。成功和已进入 Root 生命周期的失败路径均先持久化再输出；持久化失败不得 PASS。 |
| Launcher 权威 | Launcher 不再信任 stdout 尾部 JSON；只接受经独立校验器复核 RunId、Commit SHA、Manifest、文件名、字节数、SHA-256、evidence 数量及必填字段后的 Root Artifact。只有 Node exit 0 且 Root=`FINISHED`、`testsPassed/cleanupProven/childrenExited=true` 才 exit 0；缺失、损坏、漂移或 launcher-result 持久化失败一律 `BLOCKED`。Gate 临时输出在删除前记录字节数与完整 SHA-256，`passed/failed` 字段合同继续保留。 |
| 历史 RunId 对账 | 对 `0adfecb6-7db9-4015-9c41-cc36ad42ec48` 仅执行离线读取。五组 RESET / BOOTSTRAP / Suite / CLEANUP / Postflight 的 result、stdout、stderr 字节数与 SHA-256 全部自洽；exit 均为 0、无 stream error/failure；RESET dropped=0 且五类为零，BOOTSTRAP=true，TAP=34/34/0/0/0 且 M1/M1b/M2/M3/M4/M5 有实际 PASS 行，CLEANUP dropped=331，Postflight 五类为零。4 个 consumed child lease 与 3 个 descendant 的 RunId/PID/创建时间/operation 结构匹配。 |
| Launcher 历史文件 | `launcher.stdout.log` 完整 SHA-256=`8580c507442214523f3e8910b1a4d4880d25ce13cab4ad6f4dd35beb27993a35`；历史 `launcher-result.json` 完整 SHA-256=`81c7b5c9d02ab7209f989a7bec76e4aa18c632dedc0cde1e1deb49e4a805e813`，均与既有记录匹配。 |
| 重建件边界 | `%LOCALAPPDATA%\ModernERP\mysql-gate\evidence\0adfecb6-7db9-4015-9c41-cc36ad42ec48\root\root-reconciliation.json`，状态固定为 `RECONSTRUCTED_NOT_ORIGINAL`，`originalRootReportPresent=false`，文件 12380 bytes，SHA-256=`07577f303d85b2c86fc2cbf72fbb84ef194c35f5de581b0e714936771100e644`。它推断 Root 状态为 `FINISHED`，但历史进程退出只能登记 `REPORTED_NOT_REVERIFIED`：当前 PID 查询不得跨创建时间证明历史退出，避免 PID reuse 误判。该文件不能替代原始 Root report，也不能改写 Launcher exit 8。 |
| 状态 | `GATE_EXECUTED=EXECUTED` 保持；完整技术 PASS 仍因执行时原始 Root JSON 缺失与 Launcher exit 8 而不登记；`GATE_ACCEPTED=NOT_ACCEPTED`；`AUD-OUT-001=TESTED / PENDING_OWNER_APPROVAL`；M3 真实不确定 COMMIT 继续为 `NOT_PROVEN_ON_REAL_MYSQL`。 |

离线验证：focused `44/44 PASS`（其中新增 Root/对账行为用例 `17/17 PASS`）；FAST `624/624 PASS`；FULL `3415/3415 PASS`；Build PASS；全部修改的 Node 文件语法检查与 PowerShell AST 解析 PASS。文档 current/migration 与最终 `git diff --check` 结果登记于同日日志；本节不构成 Acceptance / Freeze。

### 45.20 OUT-001 离线收尾关闭与下一阶段交接（2026-11-09）

Owner 已确认正式关闭 **OUT-001 最终离线收尾修复**。本节只登记阶段关闭与后续工作包边界，不改写 §45.18 的历史执行事实或 §45.19 的 Root Evidence / 历史 RunId 对账事实。

| 项目 | 正式处理 |
|---|---|
| OUT-001 最终离线收尾修复 | **CLOSED**。本轮 Root Evidence 持久化、Launcher 权威校验、历史 RunId 离线对账、行为测试、文档与提交工作均结束；不再围绕历史 Launcher exit 8 或缺失的原始 Root JSON 反复修补。 |
| 历史记录 | §45.18 与 §45.19 均作为 append-only 历史记录保留，不回写、不重述为新的执行事实。历史 Launcher exit 8、原始 Root JSON 缺失、重建件 `RECONSTRUCTED_NOT_ORIGINAL`、历史进程退出 `REPORTED_NOT_REVERIFIED` 均保持原状。 |
| Git 边界 | 不更新或合并 `master`；不移动、重建或删除任何 candidate；不创建或移动 release tag；不执行 Merge / Release / Deploy。当前工作分支与提交锚点按本次阶段关闭时的实际远端状态记录。 |
| 下一阶段名称 | **OUT-001 Final Real MySQL Verification & Owner Acceptance**。该名称仅作为下一阶段工作包标识，不表示已经启动、授权、执行或验收。 |
| 下一阶段启动条件 | 必须先冻结并核验新的候选 Commit SHA；由 Owner 明确授权唯一 disposable MySQL 目标与操作范围；签发全新的 RunId / ACK-4 Capability；按受保护流程执行真实 MySQL Gate，并取得执行当时原始 Root Artifact、Launcher 结果、完整证据与独立 Postflight。既有已消费 ACK-4 不得复用。 |
| Acceptance 边界 | 本次阶段关闭不签发 `GATE_READY`、`GATE_AUTHORIZED`、新的 `GATE_EXECUTED`、技术 PASS、`GATE_ACCEPTED` 或 `AUD-OUT-001` Acceptance。既有 `GATE_EXECUTED=EXECUTED` 保持历史事实；`GATE_ACCEPTED=NOT_ACCEPTED`、`AUD-OUT-001=TESTED / PENDING_OWNER_APPROVAL` 与 M3 `NOT_PROVEN_ON_REAL_MYSQL` 均不变。 |

**当前阶段终态**：`OUT-001_FINAL_OFFLINE_CLOSURE=CLOSED`。下一阶段 `OUT-001 Final Real MySQL Verification & Owner Acceptance` 为 **NOT_STARTED / NOT_AUTHORIZED**；本次未连接 MySQL、未执行数据库操作、未签发或消费 ACK-4、未变更数据库 / Schema / Migration / 权限、未更新 master / candidate / tag，亦未发布或部署。

### 45.21 OUT-001 M3 不确定 COMMIT 最终专项修复：生产事务代码 + 真实故障注入装置（2026-11-09）

本节登记本轮 **M3 最终专项修复** 的实现与离线验证事实。它**不**改写 §45.18、§45.19、§45.20 的历史记录，**不**签发 `GATE_READY` / `GATE_AUTHORIZED` / 新的 `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` / `AUD-OUT-001` Acceptance / Capability Freeze / Release / Deploy。本轮**未连接真实 MySQL**、未执行 RESET / BOOTSTRAP / CLEANUP、未签发或消费 ACK-4。

#### 45.21.1 已修复的生产代码

| 文件 | 修复 |
|---|---|
| `server/db.js` | `transaction()` 的不确定 COMMIT 分支**前移到任何收尾动作之前**。判定条件为「COMMIT 已发出但未被确认」（`commitAttempted` 且 `mysqlRequestTimeout` / `sessionLost`）。该分支：保留原始 COMMIT 错误及其 `classification` / `sessionLost` / 原始错误码；立即隔离原适配器（原因 `uncertain_commit`）并由适配器终止其 Worker；**不在原适配器上发出 ROLLBACK**；**不在替代会话上代替原会话收尾**；**不重跑事务工作体**；**不把适配器恢复成可信空闲状态**；把不确定 COMMIT 标记传给上层调用者；命名锁登记**只在**终止确认为 `TERMINATION_CONFIRMED` 之后按「随会话销毁由服务器回收」清理，`TERMINATION_FAILED` 时保持隔离且不冒充 `SESSION_DESTROYED`。`commitAttempted` 在 COMMIT 被确认后立即复位，使之后的任何错误都不会被误判为不确定 COMMIT。普通业务错误、明确 ROLLBACK 与可证明安全的重试路径保持既有行为 |
| `server/modules/outsourcing-finance.js` | `createWipTransfer()` 的 catch/finally：**不确定 COMMIT 不是已确认的业务拒绝**，因此不调用 `rejectWipTransfer()` 写普通拒绝审计、不在已被隔离的适配器上继续写入、保留原始异常、不产生第二笔业务事实；`finally` 的锁释放在隔离会话上不发出任何 SQL。正常 201、精确重放 201 与异载荷 409 的既有合同不变 |
| `server/database/mysql-worker.js` + 新增 `server/database/mysql-worker-policy.js` | 把恢复策略的三个纯函数（`isRecoverableConnectionError` / `isReadOnlySql` / `classifyExecStatement`）抽到无副作用的独立模块，原模块的公开导出不变。**原因**：夹具 Worker 此前 `import` 生产 Worker 会连带注册其 `parentPort` 处理器，在夹具 Worker 内启动第二个真实 MySQL 客户端（并与夹具竞争同一响应缓冲）。这是 M3 离线夹具必须 hermetic 的直接阻断项 |

#### 45.21.2 新增的真实故障注入装置与测试

| 文件 | 用途 |
|---|---|
| `server/database/test-fixtures/mysql-commit-withholding-proxy.js` | 仅测试用的本地 TCP 代理：`node:net`、只绑定 `127.0.0.1`、只连已授权的 MySQL host/port、解析 MySQL packet framing（正确处理分包与粘包）、只识别 `COM_QUERY` 且语句恰为 `COMMIT` 的报文、原样转发给真实服务端、暂存服务端 OK 报文并上报 `COMMIT_RESPONSE_WITHHELD`、非 COMMIT 流量原样透传、服务端不确认时超时 fail closed、异常关闭不残留 socket。**不记录**认证包 / 口令 / SQL 参数 / 原始报文；**不新增** npm 依赖；**不修改** TLS 配置（目标启用 TLS 时调用方必须 fail closed） |
| `server/database/test-fixtures/out001-m3-uncertain-commit-worker.js` | 仅测试用的夹具 Worker：与生产 Worker 共享同一恢复策略，并上报「会话计数」与「语句分类」，使离线用例可以证明不确定 COMMIT **未建立新的 Worker 会话**且**未发出 ROLLBACK** |
| `server/mysql-out001-m3-uncertain-commit.test.js` | 确定性离线回归 11 项：packet parser 分包/粘包、只识别 COM_QUERY COMMIT、非 COMMIT 透传、COMMIT OK 暂存、代理超时 fail closed、无 socket 泄漏、不确定 COMMIT 不进入 `settleTransactionRollback()`、不建立新的 Worker 会话、终止确认后才清理锁登记、终止失败保持隔离、handler 不把不确定 COMMIT 记为普通拒绝、业务体只执行一次。已登记入 `FULL` 套件（`scripts/testing/test-suites.js`） |
| `server/mysql-out001.integration.js` | M3 的**真实**故障注入替换原「以 recovery worker 夹具冒充真实证据」的部分：victim 经代理提交**真实** WIP Transfer；代理暂存真实 COMMIT OK；observer 以**同一 MySQL 账户**核验身份后执行 `KILL CONNECTION <verified_victim_id>`；随后逐条判定 R1～R5 |
| `scripts/gates/mysql-out001-http-app-child.mjs` | 独立应用进程新增两个 IPC 探针：`CONNECTION_ID`（真实 connection id 与会话 epoch）与 `TRANSFER`（真实 WIP Transfer POST 及适配器自身的隔离 / 终止 / 异常分类结论） |
| `server/test-utils/mysql-out001-target.js` | 新增可选的 loopback 代理绑定（`ERP_OUT_001_MYSQL_PROXY_BINDING`）。绑定**不改变**目标身份：disposable 目标守卫仍按上游身份判定，代理上游必须与 target proof 完全一致，database / user 仍逐一比对，连接身份（server UUID、grants 摘要、版本、CURRENT_USER、DATABASE）仍必须与 target proof 逐项相符 |

#### 45.21.3 本轮离线验证结果（真实退出码）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | M3 相关文件 `node --check`（11 个文件） | `0` | 全部通过 |
| 2 | `node --test server/mysql-out001-m3-uncertain-commit.test.js` | `0` | `11/11 PASS`（0 FAIL / 0 SKIP / 0 CANCELLED） |
| 3 | `node --test server/outsourcing-wip-transfer.test.js server/outsourcing-finance.test.js` | `0` | `28/28 PASS`（OUT-001 SQLite focused） |
| 4 | `node --test server/mysql-out001-gate-infrastructure.test.js` | `0` | `44/44 PASS` |
| 5 | `node --test server/mysql-disposable-target-guard.test.js` | `0` | `10/10 PASS` |
| 6 | `pnpm test:fast` | `0` | `624/624 PASS` |
| 7 | `pnpm test`（FULL） | `0` | `3426/3426 PASS`（较上一轮 3415 增加本轮新增的 11 项） |
| 8 | `pnpm build` | `0` | 构建通过 |
| 9 | `node scripts/docs/check-doc-consistency.mjs --mode migration` | `0` | `ALL CHECKS PASSED`（C1～C6 全 PASS） |
| 10 | `node scripts/docs/check-doc-consistency.mjs`（current） | 提交前 `1` | 仅 **N7** 失败：N7 按设计拒绝「WORKTREE 含未提交或未跟踪的受治理文件变化」（本轮尚未提交的 `docs/design/procurement-outsourcing.md` 与 `docs/status/PROJECT_STATUS.md`）；N1、N3～N6、N8、N9 全 PASS，N2 为 `RETIRED`。提交后的复跑退出码登记在本轮交付报告 |
| 11 | `git diff --check` | `0` | 无空白错误 |

#### 45.21.4 真实 MySQL 尚未运行、M3 R1～R5 尚待 Gate 实证的项目

本轮**全部** M3 真实证据仍为 `NOT_PROVEN_ON_REAL_MYSQL`。以下项目只能在受保护的 disposable MySQL Gate 中产生，不得以离线结果冒充：

| 项 | 状态 |
|---|---|
| 代理在**真实** MySQL 上拦截真实 COMMIT OK | `NOT_PROVEN_ON_REAL_MYSQL`（离线仅证明 framing、识别、暂存与 fail-closed 行为） |
| 观察者以同一账户 `KILL CONNECTION` 终止 victim 的真实权限路径 | `NOT_PROVEN_ON_REAL_MYSQL`（离线无真实权限判定） |
| R1 原会话终止已确认（`TERMINATION_CONFIRMED`） | `NOT_PROVEN_ON_REAL_MYSQL` |
| R2 命名锁已由服务器随会话释放 | `NOT_PROVEN_ON_REAL_MYSQL` |
| R3 核验连接可信且 connection id 与会话 epoch 均不同 | `NOT_PROVEN_ON_REAL_MYSQL` |
| R4 服务端 COMMIT 成功时恰好一笔转移事实、恰好一条幂等记录 | `NOT_PROVEN_ON_REAL_MYSQL` |
| R5 相同幂等键重放返回原 id / 原 transferNo 且零新增事实 | `NOT_PROVEN_ON_REAL_MYSQL` |
| 客户端在真实连接丢失下的原异常 classification / `sessionLost` 透出 | `NOT_PROVEN_ON_REAL_MYSQL` |

#### 45.21.5 本轮状态与边界

| 状态 | 本轮结论 |
|---|---|
| 生产事务代码 | **已修复并离线验证**：不确定 COMMIT 的处置顺序、标记透传、锁登记清理时机与 handler 处置均已按 §26.34.14.3 收敛 |
| M3 真实故障注入装置 | **已实现，未执行**：`GATE_IMPLEMENTED`（装置与证据链已就位，等待 Owner 授权的受保护 Gate） |
| M3 真实不确定 COMMIT | 继续为 `NOT_PROVEN_ON_REAL_MYSQL` |
| `GATE_READY` / `GATE_AUTHORIZED` / 新的 `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` | **未签发** |
| `AUD-OUT-001` | 仍为 `TESTED` / `PENDING_OWNER_APPROVAL` |
| `GATE_EXECUTED=EXECUTED`（§45.18 历史事实） | 保持不变 |
| Schema / Migration / 数据库权限 / `package.json` version / release tag / master / candidate | **全部未变** |

**HARD STOP**：本轮实现与离线回归全部通过，等待 Owner Review。**不得**自行签发 `GATE_READY`、ACK-4 或任何 Acceptance。

### 45.22 OUT-001 M3 Gate 最终技术复核修正：账户身份比较与 R3 合同（2026-11-09）

本节是对 §45.21 的**技术复核修正**，只追加、不改写 §45.18、§45.19、§45.20、§45.21 的任何结论。Owner 在复核 §45.21 的实现时指出两处**身份验证缺陷**：真实 Gate 的 M3 用 `PROCESSLIST.USER` 与 `CURRENT_USER()` 直接比较，且用两个独立 Worker 的原始 `sessionEpoch` 数字互相比较来证明「会话不同」。本节登记这两处的修正与离线验证结果。本轮**未连接真实 MySQL**、未执行 RESET / BOOTSTRAP / CLEANUP、未签发或消费 ACK-4、未签发任何 Gate 状态或 Acceptance。

#### 45.22.1 两处缺陷与修正

| # | 缺陷 | 修正 |
|---|---|---|
| 1 | **账户身份比较口径错误**：`CURRENT_USER()` 返回实际用于认证的 `user@host`，`PROCESSLIST.USER` 只返回裸用户名；原实现把两者直接比较，语义不成立，且对「观察者与 victim 是否同一账户」的判定不可靠 | `CONNECTION_ID` IPC 探针改为 `SELECT CONNECTION_ID() id, CURRENT_USER() currentUser, DATABASE() databaseName`，一并返回 `connectionId`、`currentUser`、`database`、`sessionEpoch`、`sessionState`；observer 侧同样取回 `CURRENT_USER()` 与 `DATABASE()`。身份核验固定为五条独立断言：`victimCurrentUser === observerCurrentUser`、`victimRow.user === targetConfig.user`、`victimRow.db === targetConfig.database`、`observerDatabase === targetConfig.database`、`victimConnectionId !== observerConnectionId`。**禁止** `PROCESSLIST.USER` 与 `CURRENT_USER()` 直接比较。**未增加** `PROCESS` / `CONNECTION_ADMIN` / `SUPER` 或任何其它数据库权限 |
| 2 | **R3 的 epoch 合同无效**：`sessionEpoch` 是每个 `MySqlSyncAdapter` Worker **内部**的局部计数器，两个独立 Adapter 的原始数字互不可比；原实现用 `observer.sessionEpoch !== victimEpoch` 证明会话不同，该比较恒等于「两个无关计数器是否碰巧不等」，没有技术意义 | R3 改由三项共同证明：observer 是**独立创建的 Adapter**、它是**可信会话**（`mysqlSessionState()` ∈ `{IDLE_TRUSTED, FRESH}`）、它的 **connection id** 与 victim 不同。**不再**读取或比较 observer 的 epoch。victim 自身的 epoch `1 → 2` 保留为 **victim 自己**的会话被替换的独立证据（epoch 递增 + MySQL 分配新 connection id 同时成立），并明确**不**与 observer 的 epoch 交叉比较。代理的 `dropSession` 步骤据此重新定义为「触发 victim 自身的 session replacement」 |

#### 45.22.2 判定逻辑的单一来源

新增 `server/test-utils/out001-m3-identity.js`，把三项判定集中为**纯函数**并返回稳定的问题码，真实 Gate 与离线回归共用同一实现：

| 函数 | 判定 |
|---|---|
| `out001M3AccountIdentityProblems()` | 账户身份五条断言；问题码含 `CURRENT_USER_MISMATCH`、`PROCESSLIST_USER_MISMATCH`、`PROCESSLIST_DB_MISMATCH`、`VICTIM_DATABASE_MISMATCH`、`OBSERVER_DATABASE_MISMATCH`、`SAME_CONNECTION_ID`、`INVALID_*_CONNECTION_ID`、`*_CURRENT_USER_MISSING` |
| `out001M3R3Problems()` | R3 三项断言；**签名中没有任何 epoch 参数**，问题码含 `OBSERVER_SESSION_NOT_TRUSTED`、`OBSERVER_NOT_INDEPENDENT_ADAPTER`、`SAME_CONNECTION_ID`、`INVALID_*_CONNECTION_ID` |
| `out001M3VictimSessionReplacementProblems()` | victim 自身会话替换；问题码含 `VICTIM_EPOCH_NOT_INCREMENTED`、`VICTIM_CONNECTION_ID_NOT_REPLACED` |

#### 45.22.3 离线验证结果（真实退出码）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | M3 相关文件 `node --check` | `0` | 全部通过 |
| 2 | `node --test server/mysql-out001-m3-uncertain-commit.test.js` | `0` | `21/21 PASS`（较 §45.21 的 11 项新增 10 项：账户身份五条断言各自的失败口径、`PROCESSLIST.USER` 与 `CURRENT_USER()` 不可直接比较、R3 三项断言、R3 判定不含 epoch 且对 epoch 取值不敏感、victim 自身会话替换判定、真实 Gate 必须使用共享判定的源码合同） |
| 3 | `node --test server/outsourcing-wip-transfer.test.js server/outsourcing-finance.test.js` | `0` | `28/28 PASS` |
| 4 | `node --test server/mysql-out001-gate-infrastructure.test.js` | `0` | `44/44 PASS` |
| 5 | `node --test server/mysql-disposable-target-guard.test.js` | `0` | `10/10 PASS` |
| 6 | `pnpm test:fast` | `0` | `624/624 PASS` |
| 7 | `pnpm test`（FULL） | `0` | `3436/3436 PASS`（较 §45.21 的 3426 增加本轮新增的 10 项） |
| 8 | `pnpm build` | `0` | 构建通过 |
| 9 | `node scripts/docs/check-doc-consistency.mjs --mode migration` | `0` | `ALL CHECKS PASSED`（C1～C6 全 PASS） |
| 10 | `node scripts/docs/check-doc-consistency.mjs`（current） | 提交后 `0` | `ALL CHECKS PASSED`（N1、N3～N9 全 PASS，N2 `RETIRED`） |
| 11 | `git diff --check` | `0` | 无空白错误 |

#### 45.22.4 真实 MySQL 尚未运行的项目

本轮**没有**产生任何新的真实 MySQL 证据。§45.21.4 登记的全部项目继续为 `NOT_PROVEN_ON_REAL_MYSQL`，包括：真实 COMMIT OK 拦截、同账户 `KILL CONNECTION` 的真实权限路径、R1 终止已确认、R2 命名锁由服务器释放、R3 核验连接可信且 connection id 不同、R4 恰好一笔转移事实与一条幂等记录、R5 重放返回原 id / 原 transferNo、客户端真实连接丢失下的原异常 classification 透出。**本轮修正的是判定口径本身**，它必须由受保护的 disposable MySQL Gate 才能实证。

#### 45.22.5 本轮状态与边界

| 状态 | 本轮结论 |
|---|---|
| 账户身份比较与 R3 合同 | **已修正并离线验证**；判定逻辑集中为单一来源的纯函数，真实 Gate 与离线回归共用 |
| M3 真实故障注入装置 | 仍为 `GATE_IMPLEMENTED`（**未执行**） |
| M3 真实不确定 COMMIT | 继续为 `NOT_PROVEN_ON_REAL_MYSQL` |
| `GATE_READY` / `GATE_AUTHORIZED` / 新的 `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` | **未签发** |
| `AUD-OUT-001` | 仍为 `TESTED` / `PENDING_OWNER_APPROVAL` |
| Schema / Migration / 数据库权限（含 `PROCESS` / `CONNECTION_ADMIN` / `SUPER`）/ `package.json` version / release tag / master / candidate | **全部未变** |

**HARD STOP**：本轮实现与离线回归全部通过，等待 Owner Review。**不得**自行签发 `GATE_READY`、ACK-4 或任何 Acceptance。

### 45.23 OUT-001 M3 R3 合同一致性最小修正（2026-11-09）

本节是对 §45.22 的**一致性收尾**，只追加、不改写 §45.18、§45.19、§45.20、§45.21、§45.22 的任何结论。Owner 复核指出：§45.22 已在代码与 §26.34.16.3.1 修正了 R3 合同，但**基础合同正文 §26.34.14.3 仍保留旧的 epoch 措辞**，代理的 `dropSession` 旧 JSDoc 也仍在声称跨会话比较 epoch。本节登记该最小修正及其离线验证。本轮**未连接真实 MySQL**、未执行 RESET / BOOTSTRAP / CLEANUP、未签发或消费 ACK-4、未签发任何 Gate 状态或 Acceptance、未 Push。

#### 45.23.1 修正内容

| # | 位置 | 修正 |
|---|---|---|
| 1 | `docs/design/procurement-outsourcing.md` §26.34.14.3 的 **R3 基础合同行** | 与 §26.34.16.3.1 同步为三项：核验连接由**独立创建的 Adapter** 提供；它是**可信会话**（`mysqlSessionState()` ∈ `{IDLE_TRUSTED, FRESH}`）；其 **connection id** 与原会话不同。显式写明**禁止跨 Adapter 比较会话 epoch**（epoch 是每个 Worker 内部的局部计数器，两个独立 Adapter 的原始数字互不可比），且 **epoch 只用于证明同一 Worker 自身的 session replacement**。判定依据补引 `server/test-utils/out001-m3-identity.js` |
| 2 | `docs/design/procurement-outsourcing.md` §26.34.14.3 的**审计义务** | 旧的「终止状态、epoch 变化」措辞会持续暗示跨 Worker 的 epoch 比较。改为「终止状态、原会话自身的会话替换证据」，并显式规定：审计记录会话标识时只允许使用**原会话自身**可证明的标识（其 connection id，以及其 Worker 自身 epoch 的递增），**禁止**把核验连接的 epoch 与原会话的 epoch 互相比较 |
| 3 | `server/database/test-fixtures/mysql-commit-withholding-proxy.js` 的 `dropSession` JSDoc | 旧说明称它「使 victim 的 session epoch 与核验连接的 epoch 可证明地不同」，属于跨会话比较的旧语义。改为：它只触发**持有该会话的客户端自身**的一次 session replacement（victim 自己的 MySQL Worker 重连、开启新 MySQL 会话、获得新 connection id），这是它**唯一**证明的事情，且只关于 victim；它对任何其它适配器不作任何断言。会话 epoch 是 per-Worker 计数器，**从不跨 Adapter 比较**，因此该夹具刻意完全不建模 epoch。默认 reason 同步改为 `M3_VICTIM_SESSION_REPLACED` |
| 4 | `server/mysql-out001-m3-uncertain-commit.test.js` | 新增两项防回归断言（`M3-O16`、`M3-O17`）并强化 `M3-O15`：`M3-O16` 定位 Design §26.34.14.3，禁止旧措辞（`epoch 与原会话不同` / `epoch 与核验连接不同` / `epoch 不同`）、要求 R3 行含「独立创建」「IDLE_TRUSTED」「connection id」「同一 Worker 自身」、要求审计义务不再使用裸的「epoch 变化」并显式禁止跨 Worker 比较；`M3-O17` 要求代理源码不含 `sessionEpoch` 标识符、`dropSession` 的说明必须点明 victim 与 session replacement、不得再出现「核验连接 epoch」措辞；`M3-O15` 增加标识符级的双向防线（`victimEpoch` 与 `observer` 不得相邻比较） |

#### 45.23.2 修正范围与边界

本轮**只**修正文档措辞、测试夹具注释与离线断言：**未修改**生产事务逻辑（`server/db.js`、`server/modules/outsourcing-finance.js`）、**未修改** Schema / Migration / 数据库权限（含 `PROCESS` / `CONNECTION_ADMIN` / `SUPER`）、**未修改** ACK-4 Manifest、**未修改**其它任何业务合同；master、candidate、release tag、`package.json` version 全部未变。§26.34.16.3 与 §26.34.16.3.1 在 §45.22 中已与新合同一致，本轮**无需**再改。

#### 45.23.3 离线验证结果（真实退出码）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | M3 相关修改文件 `node --check` | `0` | 通过 |
| 2 | `node --test server/mysql-out001-m3-uncertain-commit.test.js` | `0` | `23/23 PASS`（较 §45.22 的 21 项新增 `M3-O16`、`M3-O17` 两项防回归断言） |
| 3 | `node scripts/docs/check-doc-consistency.mjs --mode migration` | `0` | `ALL CHECKS PASSED`（C1～C6 全 PASS） |
| 4 | `node scripts/docs/check-doc-consistency.mjs`（current） | 提交后 `0` | `ALL CHECKS PASSED`（N1、N3～N9 全 PASS，N2 `RETIRED`） |
| 5 | `git diff --check` | `0` | 无空白错误 |

本轮**未**重复运行完整 FULL 套件：本轮不修改任何生产代码，改动仅限一份设计文档、一处测试夹具注释与一份离线测试文件；受影响的 M3 focused 套件已全量重跑并全绿。

**防回归断言的有效性（非空洞证明）**：把 §26.34.14.3 的 R3 行改回旧措辞后，`M3-O16` 立即失败；把代理 `dropSession` 的 JSDoc 改回旧措辞后，`M3-O17` 立即失败。两条断言各自承载实际重量，改动随即恢复。

#### 45.23.4 本轮状态与边界

| 状态 | 本轮结论 |
|---|---|
| R3 合同一致性 | **已修正并离线验证**：基础合同正文、验证方法、代理注释与离线断言四处口径一致 |
| M3 真实故障注入装置 | 仍为 `GATE_IMPLEMENTED`（**未执行**） |
| M3 真实不确定 COMMIT | 继续为 `NOT_PROVEN_ON_REAL_MYSQL`（§45.22.4 清单不变） |
| `GATE_READY` / `GATE_AUTHORIZED` / 新的 `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` | **未签发** |
| `AUD-OUT-001` | 仍为 `TESTED` / `PENDING_OWNER_APPROVAL` |
| Schema / Migration / 数据库权限 / ACK-4 Manifest / 生产事务逻辑 / `package.json` version / release tag / master / candidate / 远端 | **全部未变**；本轮**未 Push** |

**HARD STOP**：本轮修正与离线验证完成，等待 Owner Review。**不得**自行签发 `GATE_READY`、ACK-4 或任何 Acceptance。

### 45.24 OUT-001 M3 远端同步记录（2026-11-09）

本节只登记 M3 最终提交在 **GitHub** 上的远端同步事实与前置核验结果。它**不**改写 §45.18、§45.19、§45.20、§45.21、§45.22、§45.23 的任何结论；**不**创建 Candidate Freeze；**不**签发 `GATE_READY` / `GATE_AUTHORIZED` / `GATE_ACCEPTED` 或任何 Acceptance。本工作包**未**发生 Merge、Tag、Release、Deploy、任何数据库操作，也**未**签发或消费 ACK-4。

#### 45.24.1 前置核验（实际值）

| 项 | 实际核验结果 |
|---|---|
| 工作分支 | `fix/out001-launcher-tap-summary-0adfecb6` |
| 本地 HEAD | `7fda3e990aaa5d62340b1c489922c43b4e6a9295` |
| 该提交的父提交 | `dc58771ba91ea41b1876b4de3e14cb78848b32ce` |
| 该提交的标题 | 同步 OUT-001 M3 的 R3 合同并消除旧 epoch 语义 |
| GitHub 工作分支 HEAD（核验时点） | `7fda3e990aaa5d62340b1c489922c43b4e6a9295`，与本地一致 |
| 工作树 | clean（无未提交、无未跟踪文件） |
| `master`（本地 = GitHub） | `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b`（未变） |
| `candidate/out001-075e0f6`（GitHub） | `075e0f6e61108a423c4ae0b194199edec2bc9465`（未变） |
| `candidate/out001-97eea5a`（GitHub） | `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b`（未变） |
| `candidate/out001-a5fffd1`（GitHub） | `a5fffd10835336fc5137ff2768290f5c34def4ea`（未变） |
| `fix/out001-mysql-test-fixtures`（GitHub） | `075e0f6e61108a423c4ae0b194199edec2bc9465`（保持不变） |
| `package.json` version | `1.6.2`（未变） |
| release tags | 本地 `29` 个；GitHub `3` 个（`v1.6.0`、`v1.6.1`、`v1.6.2`）；Gitee `29` 个 —— 数量与构成均**未变** |

**核验发现的本地/远端 ref 差异（如实登记）**：本地还存在一条**仅本地**的分支 `candidate/out001-163e43c`（`163e43cdb7b52e2f90f711539573284db3b4c123`，"修复门禁：为 ACK-4 签发器加载 DPAPI 程序集"，是 `master` 的祖先）。它在 **GitHub 上没有对应 ref**，也不属于上述三条旧 candidate，因此**不在**本次同步范围内，且本工作包**未**推送它。

#### 45.24.2 远端同步事实

- M3 最终提交 `7fda3e990aaa5d62340b1c489922c43b4e6a9295`（父提交 `dc58771ba91ea41b1876b4de3e14cb78848b32ce`）**已同步至 GitHub** 的 `fix/out001-launcher-tap-summary-0adfecb6`。该状态在本工作包开始时即已成立（由 `git ls-remote` 核验），并非本次推送的结果。
- 本次 §45.24 记录提交按授权**仅**推送到 GitHub 的同一工作分支 `fix/out001-launcher-tap-summary-0adfecb6`。推送后本地 HEAD 与 GitHub 远端 HEAD 将同为该记录的提交 SHA，工作树保持 clean；提交后的最终 SHA、`git ls-remote` 输出与 `git status` 实际结果登记在本轮交付报告。
- **未**推送 Gitee、**未**推送 `master`、**未**推送任何 candidate、**未**推送 `fix/out001-mysql-test-fixtures`；**未**执行 Merge / Tag / Release / Deploy。

#### 45.24.3 Gitee 同步状态（如实登记）

**本次是 GitHub 单远端同步，不是双远端同步。** 实际核验结果：

| Gitee（`origin`）上的 ref | 实际状态 |
|---|---|
| `fix/out001-launcher-tap-summary-0adfecb6` | **不存在** —— OUT-001 的工作分支从未同步到 Gitee |
| `candidate/out001-075e0f6` | **不存在** |
| `candidate/out001-97eea5a` | **不存在** |
| `candidate/out001-a5fffd1` | **不存在** |
| `fix/out001-mysql-test-fixtures` | **不存在** |
| `master` | `a17ef2bb45b658d1c23136406f560e83634f0bbf`，与 GitHub 的 `master`（`97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b`）**不同** |

因此：GitHub 上的 M3 分支与三条 candidate **仅**存在于 GitHub；Gitee 上既没有这些分支，其 `master` 也处于另一个提交。任何把本次同步表述为「双远端同步」的描述都不成立。

#### 45.24.4 本轮状态与边界

| 状态 | 本轮结论 |
|---|---|
| M3 最终提交 `7fda3e9` 的 GitHub 同步 | **已达成并核验**（`git ls-remote` 匹配本地 HEAD） |
| 本次 §45.24 记录提交的推送 | 仅推送到 GitHub 的原工作分支；推送后核验结果登记在本轮交付报告 |
| Candidate Freeze | **未创建** |
| `GATE_READY` / `GATE_AUTHORIZED` / 新的 `GATE_EXECUTED` / 技术 PASS / `GATE_ACCEPTED` | **未签发** |
| `AUD-OUT-001` | 仍为 `TESTED` / `PENDING_OWNER_APPROVAL` |
| M3 真实不确定 COMMIT | 继续为 `NOT_PROVEN_ON_REAL_MYSQL`（§45.22.4 清单不变） |
| Merge / Tag / Release / Deploy / 数据库操作 / ACK-4 | **全部未发生** |
| `master` / 三条 candidate / `fix/out001-mysql-test-fixtures` / `package.json` version / release tags | **全部未变** |

**HARD STOP**：本工作包完成，等待 Owner Review。**不得**自行签发 `GATE_READY`、ACK-4、Candidate Freeze 或任何 Acceptance。

### 45.25 OUT-001 Candidate Freeze（技术候选基线冻结）（2026-11-09）

本节登记 OUT-001 的**技术候选基线冻结**。它**不**改写 §45.18、§45.19、§45.20、§45.21、§45.22、§45.23、§45.24 的任何结论；**不**签发 `GATE_READY` / `GATE_AUTHORIZED` / `GATE_ACCEPTED` / 任何 Acceptance；**不**构成业务 Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness。本工作包**未** Push、未 Merge、未 Tag、未 Release / Deploy、未连接 MySQL、未执行 RESET / BOOTSTRAP / CLEANUP、未签发或消费 ACK-4。完整冻结证据见 [`docs/acceptance/out001-candidate-freeze-20261109.md`](../acceptance/out001-candidate-freeze-20261109.md)。

#### 45.25.1 冻结对象

| 项 | 值 |
|---|---|
| Candidate 名称 | `candidate/out001-d4c97a8`（**本地分支**，本轮**未 Push**） |
| 冻结 SHA（完整） | `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec` |
| Source branch / Source SHA | `fix/out001-launcher-tap-summary-0adfecb6` / `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`（与冻结 SHA **精确相等**） |
| Candidate HEAD 与冻结 SHA | **完全一致**（两个 `git rev-parse` 实测同一 SHA） |
| Candidate 分支新增提交 | **0 条**；冻结后仍精确指向 `d4c97a8` |
| 前置核验 | 工作树 clean；本地与 GitHub source HEAD 均为 `d4c97a8`；`candidate/out001-d4c97a8` 本地与 GitHub **均不存在**（未覆盖任何既有候选）；`master` = `97eea5a58bad774b36fbe0e94d60a1e35c2c3a3b`；三条旧 candidate 与 `fix/out001-mysql-test-fixtures` 全部保留未变；`package.json` version `1.6.2`；release tags 本地 `29` / GitHub `3` / Gitee `29` 均未变 |

#### 45.25.2 候选上的离线回归（真实退出码，全为 0）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| 1 | `node --test server/mysql-out001-m3-uncertain-commit.test.js` | `0` | `23/23 PASS` |
| 2 | `node --test server/mysql-out001-gate-infrastructure.test.js` | `0` | `44/44 PASS` |
| 3 | `node --test server/mysql-disposable-target-guard.test.js` | `0` | `10/10 PASS` |
| 4 | `node --test server/outsourcing-wip-transfer.test.js` | `0` | `21/21 PASS` |
| 5 | `node --test server/outsourcing-finance.test.js` | `0` | `7/7 PASS` |
| 6 | `node --test server/outsourcing.test.js` | `0` | `5/5 PASS` |
| 7 | `pnpm test:fast` | `0` | `624/624 PASS` |
| 8 | `pnpm test`（FULL） | `0` | `3438/3438 PASS` |
| 9 | `pnpm build` | `0` | 构建通过 |
| 10 | Docs migration | `0` | `ALL CHECKS PASSED`（C1～C6） |
| 11 | Docs current | `0` | `ALL CHECKS PASSED`（N1、N3～N9 含 N7；N2 `RETIRED`） |
| 12 | `git diff --check` | `0` | 无空白错误 |

#### 45.25.3 已证明 / 未证明边界

| 项 | 结论 |
|---|---|
| 离线已证明 | M1～M5 的**代码路径**与离线夹具在本候选上全部通过；M3 的不确定 COMMIT 处置顺序、账户身份核验口径与 R3 合同有确定性离线证据（含两条变异实验证明防回归断言非空洞） |
| 真实 MySQL 未证明 | **M1～M5 的真实执行未在本候选上重跑**。§45.18 的真实 Gate 34/34 PASS 是**旧候选 `075e0f6`** 的历史事实；本候选相对它改动了 `server/db.js` 与 `server/modules/outsourcing-finance.js`，二者都在 M1/M2/M4/M5 的执行路径上。**旧候选的 PASS 不得被描述为本候选的 PASS** |
| M3 真实不确定 COMMIT | 继续为 **`NOT_PROVEN_ON_REAL_MYSQL`** —— 从未在任何候选上被真实证明 |
| `GATE_READY` | **尚未签发** |
| `AUD-OUT-001` | 仍为 `TESTED` / `PENDING_OWNER_APPROVAL` |
| 不包含 | 真实 MySQL Acceptance、ACK-4、Capability Freeze、Domain Acceptance、Manual Closure、Release Readiness、Release、Deploy —— **全部不包含** |

#### 45.25.4 本轮状态与边界

| 状态 | 本轮结论 |
|---|---|
| Candidate Freeze | **达成**：`candidate/out001-d4c97a8` = `d4c97a8f8be5da56e43fc8346fc5b916f8c6a7ec`，本地，12 项离线回归全绿 |
| 旧 candidate | **全部保留**：`candidate/out001-075e0f6`、`candidate/out001-97eea5a`、`candidate/out001-a5fffd1` 的 ref 与 SHA 均未改动；本地仅本地分支 `candidate/out001-163e43c` 未在同步范围内、未被改动 |
| 远端 | 本候选与本冻结记录**均未 Push**；`master`、三条 candidate、`fix/out001-mysql-test-fixtures`、release tags、`package.json` version 全部未变；Gitee 未触碰 |
| 后续授权边界 | 远端 Push 该 candidate、真实 MySQL Gate 的授权与执行、`GATE_READY` 签发、任何 Acceptance 签发，均需**单独**的 Owner 授权；真实 Gate 若获授权必须使用**全新** RunId / ACK-4，既有已消费的 ACK-4 不得复用，候选必须仍是本节登记的 SHA |

**HARD STOP**：本工作包完成，等待 Owner Review 与远端 Push 的单独授权。**不得**自行 Push、Merge、Tag、Release / Deploy 或签发 `GATE_READY` / ACK-4 / 任何 Acceptance。

### 45.9 仍需真实 MySQL 8 验证的清单（**未获授权，未运行**）

以下结论在 SQLite 本地路径已成立，但**没有**任何真实 MySQL 8 实证，必须在获得授权的受保护 disposable MySQL Gate 中验证后才能进入 Acceptance：

1. `idempotencyReplay()` 的 **MySQL 命名锁**在「未命中即持锁 → 事务提交/回滚 → `releaseMySqlIdempotencyLocks()` 确认释放」全链路上不产生 `LOCK_ABSENT` / 未确认释放 / 连接隔离。
2. `transaction()` 的 **COMMIT 不确定**路径（`mysqlRequestTimeout` / `sessionLost`）下不自动重试写操作，且不产生第二笔转移事实；§26.34.14.3 的 R1～R5 恢复条件在真实会话终止 / epoch 变化证据下可判定。
3. **CAS 并发**：不同幂等键的同源并发转移在 MySQL 下同样被 `mysql_transaction_gates` 全局行锁串行化，败方与 SQLite 一致走 `OUTSOURCING_WIP_TRANSFER_OVERDRAW`（**2026-11-08 源码复核更正**，此前登记的 `..._CONCURRENT_CONFLICT` 预期不成立——该 CAS 守卫在全局门禁下不可达），最终可用量不为负、无双写、无重复 effect。
4. `outsourcing_wip_identity_effects` / `..._effect_allocations` / `..._identity_balances` 在 **MySQL 8** 下的 CHECK / UNIQUE / FK 语义与 SQLite 等价（含 `available_quantity = supplied − consumed`、`available_quantity >= 0`、`UNIQUE(event_type, business_event_id, business_event_item_id, identity_key)`、`UNIQUE(effect_id, source_supply_effect_id, allocation_kind)`）。
5. `transfer_no` 的 **UNIQUE 冲突**在 MySQL 下映射为 `OUTSOURCING_WIP_TRANSFER_NO_CONFLICT`（而非 500）。
6. MySQL 与 SQLite 的 **Schema parity**（本次未新增 DDL，故只验证既有表的列 / 约束 / 索引一致性）。

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
