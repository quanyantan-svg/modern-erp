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
