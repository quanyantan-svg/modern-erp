# Sales & Customer — Wave 11 Requirement Amendments

> 状态：`ACTIVE`
> Owner：Sales & Customer
> 权威来源：`docs/requirements/sales-customer/README.md`
> 来源：`document.md` Wave 11 修订节（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）

## Wave 11 — Sales & Customer Credit Evaluation / Reconciliation / Query — Stage B Requirement Closure (2026-10-27)

### 1. Authorization, scope and what this record is not

- Authorization: `WAVE11_STAGE_B_REQUIREMENT_ONLY`（AGENTS.md §4.2 REQUIREMENT）。
- 前置：Wave 11 Stage A Audit 结论 `WAVE11_STAGE_A_AUDIT_READY`（本日 `log/2026-10-27.md` Stage A 条目），已由用户确认 PASS。
- 本节**只**补充并收敛 Wave 11（SC99–SC107）的 Requirement，并固化已批准的 D1 / D2 / D3 三个业务决策。
- 本节**未**进入 Design，**未**进入 Implementation；**未**修改 `solution.md`、`README.md`、`AGENTS.md`、`APPLY_GUIDE.md`；**未**修改任何生产代码、测试、Schema、Migration 或测试 Runner；**未**执行任何测试门禁或 MySQL 连接；**未**执行任何 Git 写操作。
- 本节**未**修改 §34.3.24–§34.3.26 的 SC99–SC107 能力定义文本；**未**新增、删除或重编号任何 SC ID、UAT ID 或 Race ID；**未**改变冻结总数（SC 114 / Invariants 20 / UAT 44 / Races 24 / Audit CAP 36）。
- 本节引用的既有 canonical 对象名（`credit_profile`、`credit_profile_ratings`、`credit_check_results`、`credit_special_approval`、`credit_policy_snapshots`、`credit_lock_anchors`）是 §34 与 Wave 9 / Wave 10 已冻结的**事实**，不是本节的新设计。**新物理表结构、模块文件与 Migration DDL 属 Stage C Design 决定，本节不锁定。**

### 2. Baseline verification and metadata correction

| 项 | 值 | 核对方式 |
|---|---|---|
| Branch | `work/sales-waves6-13-recovery-20261025` | `git rev-parse --abbrev-ref HEAD` |
| 当前开发 HEAD | `510974a4f55995c51d276d6f0e6f9e042b84f276` | `git rev-parse HEAD` |
| `package.json` version | `1.6.2` | `package.json` |
| Git release tag | `v1.6.2` → `229169bb555ec122197604de64b3b1ebfee59ced` | `git rev-list -n1 v1.6.2` |
| 工作树（进入本阶段前） | 仅 `M log/2026-10-27.md`（Stage A append-only 记录，217 insertions / 0 deletions） | `git status --porcelain`、`git diff --stat` |
| Remotes | `github` → GitHub；`origin` → Gitee | `git remote -v` |
| Wave 10 | `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` | `document.md:11193`、`:11540` |
| Package B | `PACKAGE_B_TEST_ISOLATION_ACCEPTANCE_PASS` | `document.md:11556`；本日日志 Stage A / Package B 条目 |

**勘误 A — tag / version / HEAD 三者必须区分。**
`v1.6.2` **不指向**当前开发 HEAD。`git tag --points-at HEAD` 返回空；`v1.6.2` 指向 `229169b`，落后当前 HEAD **147 个 commit**。
本日 Stage A 日志条目中"release tag 位于 HEAD"的表述为**错误**，其来源是 `git describe --tags --abbrev=0` 的输出被误读为 tag-at-HEAD 结果。按本阶段授权要求，此处**只记录必要勘误，不修改已归档历史**；本节及此后所有 Wave 11 记录均**不得**声称 `v1.6.2` 指向当前开发 HEAD。

**勘误 B — Package B token。**
Canonical stored token = `PACKAGE_B_TEST_ISOLATION_ACCEPTANCE_PASS`；historical report shorthand = `PACKAGE_B_ACCEPTED_FROZEN_PUSHED`。两者描述**同一已验收归档成果**，仅后者无出处。**不得据此重新打开 Package B**，也不得改写已归档记录。

### 3. D1 — SC99 / SC100 Credit Reconciliation & Deterministic Recalculation（APPROVED）

**批准的业务决策**：保持现有 PURE_DERIVED Credit Exposure 模型；**不**新增持久化 mutable Credit Exposure cache；**不**建立第二套 Credit Occupancy Ledger。

**并同时批准**：SC99 与 SC100 **均**必须形成实际可执行的业务能力；**不得**以"当前没有 cache"充当 SC100 完成的替代证明。

#### 3.1 SC99 与 SC100 的业务边界

| | SC99 CHECK-only Reconciliation | SC100 Deterministic Recalculation |
|---|---|---|
| 回答的问题 | 当前信用敞口构成与业务一致性规则是否成立？不一致在哪里？ | 在指定 Credit Object / Scope / Business Date 上，权威事实推导出的派生敞口与额度结果是什么？ |
| 输出 | reconciliation result + discrepancy 标识 | 重算出的敞口与额度结果（确定性） |
| 是否写权威事实 | 否 | 否 |
| 是否写持久化敞口状态 | 否 | 否 |

两者**不得**合并为同一动作：SC99 产出的是**一致性核对结论**，SC100 产出的是**重算结果**。

#### 3.2 SC99 Requirement clauses

```text
R99-1  CANONICAL FACTS
       SC99 读取的信用敞口构成必须与 Credit Check 使用同一 canonical facts
       集合与同一 PURE_DERIVED 派生规则（§34.3.21 SC90..SC92 + S14）。
       SC99 不得建立、读取或依赖任何持久化 mutable Credit Exposure cache，
       也不得建立第二套 occupancy ledger。

R99-2  SCOPE
       SC99 必须以显式 Credit Object 与显式 Scope 为输入。
       双限额（Customer Aggregate / Salesperson Sub-Limit）下必须**分别**报告
       两个 scope 的结果；不得只报告 aggregate，也不得把两个 scope 合并成
       一个未归属数字。

R99-3  BUSINESS DATE
       必须以显式 business_date 为口径（S19）。created_at / confirmed_at 等
       audit timestamp 不得充当业务日期。

R99-4  CHECK-ONLY RESULT
       必须返回明确的 reconciliation result：每个 scope 的 limit / used /
       remaining / component breakdown，加上"一致 / 不一致"判定与可定位的
       discrepancy 标识。无法判定时必须显式标记为无法判定，不得静默省略。

R99-5  ZERO MUTATION
       SC99 必须只读。不得修改任何 Sales / Finance / Inventory / Accounting
       权威事实（S17）；不得静默修复历史数据；不得产生任何可改变后续
       Credit Check 结果的持久化状态。

R99-6  AUDIT EVIDENCE
       SC99 执行必须留下执行证据（执行者、business date、scope、参数化查询
       条件、结果摘要、耗时、发现的不一致计数）。该证据**不得**成为余额或
       敞口的权威数据源，也不得被任何 Credit Check 消费为敞口输入。
```

#### 3.3 SC100 Requirement clauses

```text
R100-1  RECALCULATION INPUT
       按指定 Credit Object、Scope、Business Date 重新读取权威事实，
       重新计算派生信用敞口及额度结果。

R100-2  DETERMINISM
       同一事实快照 + 同一 Scope + 同一 Business Date 必须得到确定性结果。
       重复执行必须得到相同结果；结果不得因执行次数、执行者身份或执行
       时刻而改变。

R100-3  NO OVERWRITE OF IN-FLIGHT DECISIONS
       不得覆盖或修改任何既有 Credit Check 决策记录；不得修改既有
       policy snapshot。SC100 不得成为第二个决策来源。

R100-4  NO HISTORICAL REWRITE
       不得重写 Finance / Sales / Inventory / Accounting 历史事实（S17）。

R100-5  NO PERSISTED MUTABLE EXPOSURE CACHE
       SC100 不得创建任何持久化 mutable Credit Exposure cache。
       第二套 Credit Occupancy Ledger 被禁止。

R100-6  RECALCULATION HISTORY IS AUDIT-ONLY
       若记录 recalculation history，只记录审计与执行证据（kind、触发者、
       触发时间、source snapshot window、scope filter、结果摘要、耗时、
       不一致计数、drift 标记）。
       该记录**不得**成为余额或敞口的权威数据源，**不得**被任何
       Credit Check 或 Query 消费为敞口输入。

R100-7  R-SAL-23 UNDER PURE_DERIVED
       R-SAL-23 保持其既有 CONDITIONAL 定义（§34.6 R-SAL-23 行、§34.6 计数
       行、§34.13 引用），不因本决策被改写为 REAL 或被删除。
       在 D1 的 PURE_DERIVED 基线下，SC100 的并发验收由**结构性 + 行为性**
       两类证明共同完成：
       (a) 结构性 —— 不存在持久化 mutable Credit Exposure cache，故不存在
             可被重算覆盖的在途敞口状态；
       (b) 行为性 —— 重算与并发 Credit Check 同时发生时，重算不修改任何
             canonical 行、不修改 check result、不产生第二个决策来源。
```

#### 3.4 与既有冻结 Design 的精确冲突记录（不擅自改写历史合同）

| # | 既有冻结文本 | 与 D1 的关系 | 处理 |
|---|---|---|---|
| C-1 | §34.3.24 SC100 文本是条件式："**若**重建派生 cache，必须先读 latest canonical snapshot，且 must never overwrite in-flight concurrent credit decision" | **不冲突**。D1 明确不建 cache，故该条件子句不触发；SC100 仍须可执行 | Stage C 按 R100-1..R100-7 落地 |
| C-2 | 既有 Design 将重算 kind 定义为 `('CHECK_ONLY','DETERMINISTIC_REBUILD')`，且明示 "deterministic rebuild NOT exercised against any materialized cache in this baseline" | **语义冲突**。D1 使 `DETERMINISTIC_REBUILD` 成为**无缓存的重算**，而既有 kind 词汇是按"缓存重建"语义定义的 | **本节不决定** kind 词汇。Stage C 必须在 Stage C Design 中显式处置（沿用并重定义该 kind，或另立一个表达"重算"的 kind），且必须保持 R100-6 的 audit-only 约束不变 |
| C-3 | §36.7.5 "DETERMINISTIC_REBUILD remains defined but unexercised" | **语义冲突**，同 C-2 | 同 C-2。本节不修改 `solution.md` |
| C-4 | §34.8 row 15 的 Read/Write 方向写作 "R: read-only from canonical + cache" | **不是冲突，但存在误读风险**。该行的 "R" 是**跨域方向**陈述（Credit 只读其它 Domain 的 canonical truth），不是"Credit 自身对象只读" | Stage C 必须按本节 §9 的方向表理解，不得据此把 SC103–SC107 误读为只读 |

**本节不修改 `solution.md`，不重写任何历史冻结 Requirement。** 上述 C-2 / C-3 作为 Stage C 前置输入移交。

### 4. D2 — Credit Read Scope（APPROVED）与 Security Remediation 追踪项

**批准的业务决策**：SC101 / SC102 采用**已经存在**的五级 `CREDIT_READ_MODE`（`ALL` / `DENY` / `CROSS_GROUP` / `AGGREGATE_PLUS_SELF` / `AGGREGATE_ONLY`）；列表与详情**必须**由后端执行数据范围过滤；不得因拥有 `CREDIT_VIEW` 就读取所有销售员子额度、信用检查结果或特别审批历史；Scope 解析必须复用现有 canonical Credit Read Scope 规则。

**并同时批准**：

```text
R-D2-1  当前有效授权判定
       读取资格必须依据**当前有效**授权判断。历史上曾属于某销售组，
       不得成为永久保留历史查看权限的理由。

R-D2-2  历史业务事实不改写
       历史业务事实本身仍按原 Business Date 保留。数据范围收敛**不得**
       修改、删除或改写任何历史证据。

R-D2-3  覆盖全部读取面
       必须覆盖：
         - Credit Exposure Query
         - Credit Exception History
         - Credit Check Result List / Detail
         - Credit Special Approval List / Detail
         - 关联 Credit Profile 及其 Scope
         - 查询过滤、分页、总数及关联数据

R-D2-4  禁止表层过滤
       禁止仅在 API 返回后做不安全的表层过滤。范围过滤必须下推到查询
       谓词层。

R-D2-5  禁止单点绕过
       禁止通过单一 Check Group、Source ID、Approval ID 或分页信息绕过
       Scope。越权目标的响应必须与"不存在"不可区分。

R-D2-6  不得改写冻结授权语义
       不得因本决策改写 §14 AP1–AP4.1、§15 AP5 或 §34.7 P1–P5。
       既有合同继续有效；本决策只把既有合同**适用**到新的读取面。
```

**与既有授权合同的关系（精确）**：§14 AP3 明确"Read restriction applies to **every** read surface, not only the list"，并逐项点名 collection queries、detail-by-ID、effective-dated profile versions、historical rating records、nested / expanded responses、任何会暴露受限子限额数据的 API projection。D2 与 AP3 **一致**，是把既有 Profile 读取面的合同**扩展适用**到 SC101 / SC102 的读取面，不新增权限码、不新增角色、不新增隐含权限蕴含（§14 AP4 "permission registry is flat"）。

#### 4.1 Security Remediation 追踪项 `W11-SEC-01`

| 项 | 内容 |
|---|---|
| ID | `W11-SEC-01` |
| 分类 | **既有数据权限缺陷**，由 Wave 11 Stage A Audit 发现 |
| 性质 | 涉及**已冻结的 Wave 10 读取路径** —— `listCreditCheckResults()`、`listCreditSpecialApprovals()`、`getCreditSpecialApproval()` 及其它实际受影响入口。这些入口当前仅判 `CREDIT_VIEW`，**未**施加 canonical Credit Read Scope 谓词，因而 `CREDIT_VIEW` 持有者可读取全部客户的检查结果与特别审批历史，包含其他销售员的子额度 scope 行 |
| Requirement 后果 | SC101 / SC102 的验收**不得**在该缺陷未闭合时判定通过；SC102 不得把这两张表直接作为例外历史来源 |
| 授权边界 | 未来 Implementation 须获得**独立、有界的跨冻结边界授权**，专门用于修补该读取路径；**不得**顺带改动 Wave 10 的检查、审批、敞口或业务行为 |
| 不重开 | **不得**重新打开 Wave 10 的全部业务验收；`WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED` 与既有 39/39 MySQL 验收证据保持不变 |
| 本阶段 | **不得**在本阶段修改任何现有接口代码（本阶段为 Requirement-only） |
| 交付顺序 | 必须**先于**开放新的历史查询入口完成（见 §11） |
| 验收 | 见 §8 A-D2-* |

### 5. D3 — Evaluation 与 Rating Application 的授权分离（APPROVED）

**批准的业务决策**：`CREDIT_EVALUATE` 授权信用评分与评估相关操作；`CREDIT_EVALUATE` **单独不得**授权把评分结果应用到生效 Credit Profile；正式 SC107 Rating Result Application 必须具备 `CREDIT_MANAGE` 对应的 **write-class authority**，并遵守现有后端信用管理 Scope 限制。

```text
R-D3-1  AUTHORITY SPLIT
       评分 / 评估动作（创建评分表、提交、终评）需要 CREDIT_EVALUATE。
       评分结果应用到生效 Credit Profile 需要 write-class authority：
       ADMIN，或 CREDIT_MANAGE 且满足现有后端信用管理 Scope 限制
       （§14 AP4.1 的既有语义，不新增、不放宽）。
       CREDIT_EVALUATE 单独**不足以**授权应用。

R-D3-2  DISTINGUISHABLE ACTIONS
       评分与评级应用必须是**可区分的业务动作**，具有**可区分的审计身份**
       与**可区分的幂等合同**。不得把评分与应用折叠为同一动作，也不得
       让应用动作借用评分动作的审计或幂等记录。

R-D3-3  IDENTITY SEPARATION
       Credit Evaluation Result 必须保持独立且可追溯：
         ≠ Credit Profile version
         ≠ Policy Snapshot
         ≠ Applied Rating History
       四者不得因实现便利被合并为单一物理身份
       （§14 Stage B B-4 五身份约束，见 `document.md:6843-6851`）。

R-D3-4  APPLY BOUNDARIES
       评级应用必须：
         - 绑定明确的 Credit Profile version（business_date 生效的那一个），
           不得绑定 anchor；
         - 不通过修改历史 Check / Approval Snapshot 实现；
         - 不覆盖无关客户或其他销售员的子额度；
         - 不产生第二个 Credit Profile 评级写者
           （profile 的评级内联投影必须由同一次评级应用事务派生）。

R-D3-5  TRANSACTION / CONCURRENCY / DUPLICATE ACCEPTANCE
       必须具备明确的重复应用拒绝、并发串行化与事务完整性验收
       （见 §6 SC107、§7 R-SAL-24）。
```

**现有 SOD 合同对本项的适用边界（记录，不新增规则）**：

```text
既有事实：Credit Special Approval 已冻结"申请审批分离"（requester ≠ approver，
          违反时 fail closed）。该规则**不覆盖**评分与评级应用。

既有事实：§34.7 P1–P5 的五项不可破坏原则中，P1 = VIEW ≠ WRITE、
          P2 = CREATE ≠ APPROVE、P4 = CREDIT SPECIAL APPROVAL 需要
          bounded authority。P2 的适用范围是"创建"与"审批"这一对动作。

本阶段决策边界：
  - 本 Requirement 批准的是**授权类别分离**（evaluate 类权限 vs write-class
    权限），**不是人员分离**。
  - **不**新增审批角色、**不**新增审批流程、**不**新增"评分人必须不同于
    应用人"的人员级规则。
  - 若业务后续要求人员级分离（评分人 ≠ 正式应用人），必须**返回 Requirement
    层重开**，不得由 Design 或 Implementation 静默引入。
```

### 6. SC99–SC107 Requirement 完成矩阵

#### 6.1 汇总

| SC | Requirement 状态 | 主要业务条款 | Acceptance | Race | 覆盖（实现层） |
|---|---|---|---|---|---|
| SC99 | **COMPLETE（本节收敛）** | R99-1..R99-6 | UAT-S-34 | — | `MISSING` |
| SC100 | **COMPLETE（本节收敛）** | R100-1..R100-7 | UAT-S-34 | R-SAL-23（CONDITIONAL，结构性 + 行为性证明） | `MISSING` |
| SC101 | **COMPLETE（本节收敛）** | R101-1..R101-7 | UAT-S-35 | — | `MISSING` |
| SC102 | **COMPLETE（本节收敛）** | R102-1..R102-5 | UAT-S-35 | — | `MISSING` |
| SC103 | **COMPLETE（本节收敛）** | R103-1..R103-3 | UAT-S-36 | — | `MISSING` |
| SC104 | **COMPLETE（本节收敛）** | R104-1..R104-3 | UAT-S-36 | — | `MISSING` |
| SC105 | **COMPLETE（本节收敛）** | R105-1..R105-7 | UAT-S-36 | — | `MISSING` |
| SC106 | **COMPLETE（本节收敛）** | R106-1..R106-5 | UAT-S-36 | W11-R2 | `MISSING` |
| SC107 | **COMPLETE（本节收敛）** | R107-1..R107-9 | UAT-S-36 | R-SAL-24 / W11-R1 | `MISSING` |

> **Requirement 完成 ≠ 已实现。** 九项 Capability 的实现层 Coverage 仍为 `MISSING`；Stage B 不产生任何实现。
> SC99–SC107 的能力定义文本（§34.3.24–§34.3.26）**未被本节改写**，仍为权威锚点；本节是其收敛与验收细化。

#### 6.2 SC101 — Credit Query clauses

```text
R101-1  LIMIT / USED / REMAINING
       必须返回该 scope 的 credit limit、used（已占用）与 remaining（可用），
       且口径必须与 Credit Check 使用的派生规则**同一**。不得与 SC99 / SC100
       形成两套计算口径。

R101-2  COMPONENT BREAKDOWN
       必须返回敞口构成分解：组件 + 金额 + 来源身份。来源身份必须可追溯到
       canonical 事实，且必须与 SC99 / SC100 的分解口径一致。

R101-3  SCOPE
       必须按 Customer Aggregate 与 Salesperson Sub-Limit 分别可查询。
       双限额下二者必须各自成立且不重复计数（S14）。

R101-4  BUSINESS DATE / EFFECTIVE DATE
       必须以显式 business_date 为口径；所用 Credit Profile 必须是该日期
       的生效版本（S19）。必须同时可返回该日期生效的 policy snapshot 身份。

R101-5  ZERO SIDE EFFECT
       查询必须严格无副作用：不得写入 check result、不得创建 policy
       snapshot、不得占用写锁、不得改变任何状态。
       **SC101 不得以执行 Credit Check 作为实现路径。**

R101-6  HISTORICAL SNAPSHOT LINKAGE
       返回结果必须能链接到作出该结论的 policy snapshot 指纹与 profile
       effective state 身份，使历史结论可被复现（§34.6.2 coherent snapshot；
       S05）。

R101-7  PERMISSION / DATA SCOPE
       后端必须执行五级 CREDIT_READ_MODE 过滤（R-D2-1..R-D2-6）。
```

#### 6.3 SC102 — Credit Exception History clauses

```text
R102-1  AUTHORITATIVE SOURCE
       例外历史必须由 credit_check_results（决定）、credit_special_approval
       （特别审批）与来源 SO / SD 关联**派生**。不得建立第二套例外事实表，
       不得复制历史决策。

R102-2  EXCEPTION CATEGORIES
       over-limit / overdue / warning / block / special approval 及 reason
       codes 必须可区分、可分别过滤。

R102-3  IMMUTABLE HISTORY
       不得改写任何历史 check / approval 记录（S05）。历史例外事实按其
       原 Business Date 与原决策上下文呈现。

R102-4  PERMISSION / DATA SCOPE
       同 R101-7；并且不得通过单一 Check Group、Source ID、Approval ID 或
       分页参数绕过 Scope。

R102-5  PAGINATION / ORDERING
       必须支持稳定排序与分页，并返回满足当前 Scope 的总数。
       不得以固定上限截断冒充分页。
```

#### 6.4 SC103 / SC104 / SC105 clauses

```text
R103-1  INDICATOR DEFINITION
       每个指标必须有唯一 code、名称、类型（QUALITATIVE / QUANTITATIVE）、
       业务含义、有效起止日期与状态。

R103-2  INPUTS AND MAXIMUM SCORE
       QUALITATIVE 指标的输入为人工评价值；QUANTITATIVE 指标的输入必须
       定义其来源与口径（可由 canonical 事实或登记事实确定）。
       每个指标必须声明其最大分值。

R103-3  INDICATOR IMMUTABILITY
       已被某个 model 引用的指标定义不得被就地改写；变更必须通过新版本
       生效，历史评分继续引用其当时生效的版本。

R104-1  SCHEME
       每个评级方案必须有唯一 code、名称、等级集合，以及每个等级的分值
       边界。边界必须无重叠、无空洞、无歧义。

R104-2  SCHEME / INDICATOR BINDING
       方案必须声明其适用的指标集合；权重由 model 决定，不由 scheme 决定。

R104-3  SCHEME EFFECTIVE DATING
       方案必须生效日期化。历史评分必须继续引用其当时生效的方案版本，
       不得被后续方案版本重新解释。

R105-1  MODEL
       model 必须绑定 scheme、声明适用期间、声明每个指标的权重。
       权重的语义（满分权重 / 相对权重）必须被显式声明。

R105-2  WEIGHT VALIDATION
       权重必须可校验；负值、超范围值与违反模型自身约束的权重组合必须
       被显式拒绝，不得静默归一。

R105-3  SCORING SHEET LIFECYCLE
       评分表生命周期必须为 DRAFT → SUBMITTED → FINALIZED，另有独立的
       "已应用"结果状态。状态转换必须由后端控制并留痕；不得存在跳过中间
       状态的路径。

R105-4  SHEET BINDING
       评分表必须绑定明确的评估对象与 Business Date（或明确的 Credit
       Profile version）。**不得**绑定 anchor。

R105-5  SHEET DATA
       逐指标评分必须记录：指标 code、输入类型、输入取值、得分。
       缺失指标不得被当作 0 分静默计入。

R105-6  INPUT VALIDATION
       定性 / 定量输入必须校验取值范围。越界输入必须显式拒绝并返回
       可定位错误，不得静默截断或夹取。

R105-7  VERSION BOUNDARIES
       indicator / scheme / model / sheet 四者的版本边界互相独立。
       评分结果必须记录其引用的 model 版本与 scheme 版本。
```

#### 6.5 SC106 / SC107 clauses

```text
R106-1  BOUNDED PARTICIPATION
       多评人参与范围**限于单个评分表**。不得建立企业级开放评人池，
       不得跨评分表聚合。

R106-2  PARTICIPANT SCOPE AND AUTHORITY
       评分人必须具备 evaluation authority；每个评分表必须限定可参与的
       评分人集合。

R106-3  SINGLE-SHEET AGGREGATION
       每个评分表聚合为**唯一** Credit Evaluation Result，并携带参与评分
       人数。合成规则必须确定性：相同输入得到相同聚合结果。

R106-4  FINALIZATION CONCURRENCY
       两个并发的终评不得产生两个聚合结果。

R106-5  NO CROSS-SCOPE EVALUATION
       评分人不得对其他客户或其他销售员的子额度评分。

R107-1  INDEPENDENT EVALUATION RESULT IDENTITY
       Credit Evaluation Result 保留独立且可追溯的身份，且不等于 Credit
       Profile version、不等于 Policy Snapshot、不等于 Applied Rating
       History（R-D3-3）。

R107-2  PROFILE VERSION BINDING
       应用必须绑定明确的、在 business_date 生效的 Credit Profile version；
       不得绑定 anchor。

R107-3  WRITE-CLASS AUTHORITY
       应用必须具备 write-class authority（ADMIN，或 CREDIT_MANAGE 且满足
       现有后端信用管理 Scope 限制）。CREDIT_EVALUATE 单独不足以授权应用
       （R-D3-1）。

R107-4  SOLE RATING WRITER
       不产生第二个 Credit Profile 评级写者。profile 的评级内联投影必须
       由同一次评级应用事务派生，不得被任何其他路径独立写入。

R107-5  NO HISTORY REWRITE / NO CROSS-SCOPE EFFECT
       不通过修改历史 Check / Approval Snapshot 实现；不覆盖无关客户或
       其他销售员的子额度。

R107-6  DUPLICATE APPLICATION REJECTED
       同一 evaluation result 对同一 profile version 的重复应用必须被拒绝，
       且不得产生第二次效果。

R107-7  CONCURRENCY WITH CREDIT CHECK
       评级应用与并发 Credit Check 必须串行化；一次 Credit Check 不得
       混合评级前后的状态（R-SAL-24 / §34.6.2）。

R107-8  DISTINGUISHABLE AUDIT IDENTITY
       评分与评级应用必须是可区分的业务动作，具有可区分的审计身份
       （§34.7 P5）。

R107-9  SOD BOUNDARY RECORDED
       本项不引入人员级分离规则；既有 SOD 合同的适用边界按 §5 记录
       （若需人员级分离，必须返回 Requirement 层重开）。
```

### 7. UAT-S-34 / 35 / 36 与 R-SAL-23 / R-SAL-24 追溯

**编号规则**：UAT-S-34 / 35 / 36 **保持原始编号**，不新增、不重编号任何顶层 UAT ID（冻结范围仍为 UAT-S-01..UAT-S-44）。下列子断言为**既有 UAT ID 之下的子断言标识**，不是新的 UAT ID。Race 侧引用既有 R-SAL-23 / R-SAL-24 与既有 Design 已定义的 `W11-R1`..`W11-R4` fixture，不新增 Race ID。

| UAT | 覆盖 SC | 子断言 | 验收要点 |
|---|---|---|---|
| UAT-S-34 | SC99–SC100 | `UAT-S-34-A1` | CHECK-only reconciliation 返回 per-scope limit / used / remaining / component breakdown 与一致性判定 |
| | | `UAT-S-34-A2` | 双限额下 aggregate 与 sub-limit 分别报告；不存在未归属的合并数字 |
| | | `UAT-S-34-A3` | 显式 business_date 生效；不以 audit timestamp 代替 |
| | | `UAT-S-34-A4` | 零写入：Sales / Finance / Inventory / Accounting canonical 行在执行前后逐字段一致 |
| | | `UAT-S-34-A5` | 确定性：同一事实快照 + 同一 scope + 同一 business_date 重复执行结果一致 |
| | | `UAT-S-34-A6` | 不覆盖在途 Credit Check 决策；既有 check result 与 policy snapshot 不变 |
| | | `UAT-S-34-A7` | 无持久化 mutable exposure cache（结构性断言）；recalculation history 不被任何查询消费为敞口输入 |
| | | `UAT-S-34-A8` | 审计证据存在且不可作为权威数据源 |
| UAT-S-35 | SC101–SC102 | `UAT-S-35-A1` | limit / used / remaining 与 Credit Check 口径一致 |
| | | `UAT-S-35-A2` | component breakdown 含组件 / 金额 / 来源身份，且可追溯 |
| | | `UAT-S-35-A3` | 例外历史覆盖 over-limit / overdue / warning / block / special approval 与 reason codes，可分别过滤 |
| | | `UAT-S-35-A4` | 查询零副作用：无写入、无新 snapshot、无写锁占用 |
| | | `UAT-S-35-A5` | 历史结论可链接到 policy snapshot 指纹与 profile effective state 身份 |
| | | `UAT-S-35-A6` | 稳定排序 + 分页 + Scope 内总数；不以固定上限冒充分页 |
| | | `UAT-S-35-A7` | 后端谓词级数据范围过滤（见 §8） |
| UAT-S-36 | SC103–SC107 | `UAT-S-36-A1` | 指标类型、有效期、最大分值可定义并被校验 |
| | | `UAT-S-36-A2` | 方案等级边界无重叠、无空洞 |
| | | `UAT-S-36-A3` | model 权重可校验；非法权重被显式拒绝 |
| | | `UAT-S-36-A4` | 评分表生命周期状态机受后端控制；缺失指标不按 0 分计入 |
| | | `UAT-S-36-A5` | 多评人限于单表；单表聚合为唯一结果并携带参与人数；合成确定性 |
| | | `UAT-S-36-A6` | 评级结果独立身份，且 ≠ profile version ≠ policy snapshot ≠ applied rating history |
| | | `UAT-S-36-A7` | 应用绑定 profile version；重复应用被拒绝且无第二次效果 |
| | | `UAT-S-36-A8` | write-class authority 强制；CREDIT_EVALUATE 单独不足以应用 |
| | | `UAT-S-36-A9` | 不产生第二个 profile 评级写者；历史 check / approval snapshot 未被改写 |

| Race | 状态（Requirement 层） | 验收义务 |
|---|---|---|
| R-SAL-23 | **保持 CONDITIONAL**（§34.6 / §34.6 计数行 / §34.13 引用均不变） | PURE_DERIVED 下由 `UAT-S-34-A7` 结构性断言 + `UAT-S-34-A6` 行为性断言共同证明；**不**被改写为 REAL，**不**被删除，**不**并入 R-SAL-12 |
| R-SAL-24 | **保持既有 DORMANT 定义**；Wave 11 使其可被实际激活用例覆盖 | `UAT-S-36-A7` + `W11-R1`：评级应用与并发 Credit Check 串行化，一次检查不混合评级前后状态；`W11-R1` fixture 属既有 Design 已定义的 fixture，不新增 Race ID |
| W11-R2 | 既有 Design fixture | 两次并发终评只产生一个聚合结果，参与人数正确 |
| W11-R3 | 既有 Design fixture | 重算与并发信用消费事务并发时，无 canonical Sales / Inventory / Finance / Accounting 行被修改（S17） |
| W11-R4 | 既有 Design fixture | 结构性断言：不存在持久化 exposure cache；断言成立 |

### 8. Data scope / RBAC / SOD 验收要求

```text
A-D2-1  SCOPE MODE RESOLUTION
       五个读取模式（ALL / DENY / CROSS_GROUP / AGGREGATE_PLUS_SELF /
       AGGREGATE_ONLY）必须复用现有 canonical Credit Read Scope 解析规则，
       不得在查询层另写一套。

A-D2-2  CURRENT-EFFECTIVE ELIGIBILITY
       读取资格按**当前有效**授权判定。历史销售组归属不构成永久读取权。

A-D2-3  PREDICATE-LEVEL FILTERING
       过滤必须下推到查询谓词。禁止"先取全量再在应用层过滤"。

A-D2-4  SINGLE-OBJECT BYPASS CLOSED
       通过 Check Group / Source ID / Approval ID / 分页参数 / 排序参数
       均不得取得 Scope 外的对象。

A-D2-5  INDISTINGUISHABLE DENIAL
       Scope 外对象的响应必须与"对象不存在"不可区分。

A-D2-6  EXISTING WAVE 10 READ PATHS REMEDIATED
       `listCreditCheckResults()`、`listCreditSpecialApprovals()`、
       `getCreditSpecialApproval()` 及其它实际受影响入口必须施加 canonical
       Scope 谓词。修正**只允许收紧可见范围**，不得改变任何 Wave 10
       检查 / 审批 / 敞口业务行为、不得改变既有响应契约中已冻结的字段
       语义。

A-D2-7  REMEDIATION SCOPE IS BOUNDED
       `W11-SEC-01` 的 Implementation 必须依据独立授权执行，且必须：
         - 只收紧数据可见范围；
         - 不新增权限码、不新增角色；
         - 不修改 Wave 10 业务行为；
         - 不重新打开 Wave 10 的全部业务验收。

A-D2-8  NO WRITE IMPLICIT
       读取路径不得隐含任何写入。查询、例外历史与详情读取必须零副作用。

A-D3-1  AUTHORITY SPLIT ENFORCED
       评分 / 评估动作要求 CREDIT_EVALUATE；评级应用要求 write-class
       authority。两者必须由后端分别强制，且必须存在"CREDIT_EVALUATE 单独
       不足以应用"的负向验收。

A-D3-2  WRITE-SCOPE LIMIT RESPECTED
       评级应用必须遵守既有后端信用管理 Scope 限制（§14 AP4.1），
       不得成为绕过该限制的路径。

A-D3-3  AUDIT IDENTITY DISTINCT
       评分与评级应用的审计记录必须可区分、可分别追溯（§34.7 P5）。

A-D3-4  SOD BOUNDARY NOT EXPANDED
       本阶段不引入人员级分离规则。验收**不得**假设"评分人 ≠ 应用人"
       为强制条件。若后续要求该规则，必须先返回 Requirement 层。

A-D3-5  NO NEW ROLE OR PERMISSION CODE
       本节不引入新角色、不引入新权限码，不发明权限蕴含（§14 AP4）。
```

### 9. Cross-domain boundaries（Wave 11 专用）

| 能力 | Credit 的方向 | 依赖 Domain | 禁止 |
|---|---|---|---|
| SC99 / SC100 | **只读** canonical facts；仅写 Credit 自有的执行/审计证据 | Finance Operations（AR / advance / unapplied / refund / write-off）、Sales（SO commitment / delivery） | 不得修改 Sales / Finance / Inventory / Accounting 历史事实（S17）；不得创建第二套 Credit Occupancy Ledger；不得建立持久化 mutable exposure cache |
| SC101 / SC102 | **只读** Credit 自有历史 + canonical facts | Finance Operations（canonical facts 只读消费）、Platform（存储与读 RBAC） | 不得建立第二套例外事实表；不得把查询变成写入；不得绕过 canonical Scope |
| SC103 / SC104 / SC105 | **R/W** Credit 自有评估对象（指标 / 方案 / 模型 / 评分表） | Master & Engineering（Customer identity 只读引用） | 不得写入 Inventory physical truth、Finance AR truth 或 Accounting 历史记录；不得改变既有 Credit Check / Special Approval 行为 |
| SC106 / SC107 | **R/W** Credit 自有评估与评级历史；SC107 写入 Credit Profile version | Finance Operations（canonical facts 只读）、Platform（授权 / 审计机制） | 不得产生第二个 Credit Profile 评级写者；不得覆盖无关客户或他人子额度；不得改写历史 Check / Approval Snapshot；不得由 Credit Evaluation 写入 Finance / Accounting 事实 |

**通用禁止（继承 §34.8 row 15）**：Credit Recalculation / Query / Evaluation 不得改写 Sales / Inventory / Finance 历史事实；不得制造 second Sales / Finance exposure ledger；不得 second Customer identity；不得把 Platform 变成 Credit 业务 owner。

### 10. 冻结合同继承声明

本节**继承且不得破坏**以下既有冻结合同：

| # | 冻结合同 | 位置 | 本节的关系 |
|---|---|---|---|
| F-1 | Wave 9 Credit Profile / Rule / Parameter | §34.3.18–§34.3.20 | 继承；SC105–SC107 只在 Credit 自有对象上扩展，不改写 Profile / Rule / Parameter 语义 |
| F-2 | Wave 10 Credit Exposure / Check / Special Approval | §34.3.21–§34.3.23 | 继承；SC99–SC102 只读消费既有 check result / approval 事实，不改写其产生逻辑 |
| F-3 | Dual-Limit Control（§13 P1–P13） | `document.md` 2026-10-22 Stage B §13 | 继承；R99-2 / R101-3 直接依赖双限额语义 |
| F-4 | PURE_DERIVED Exposure | `solution.md` §29.24.1 | 继承（D1 明确保持） |
| F-5 | S05 / S14 / S15 / S16 / S17 / S19 | §34.4 | 继承并被本节引用为强制约束 |
| F-6 | 五个 Credit 业务身份 | `document.md:6843-6851` | 继承；R-D3-3 显式重申不得塌缩 |
| F-7 | Finance canonical AR / Settlement | Finance Operations Domain Closure | 继承；Credit 只读消费，不写入 |
| F-8 | Credit Policy Snapshot 指纹 | Wave 9 冻结设计 | 继承；R101-6 要求历史结论可链接该指纹 |
| F-9 | Wave 10 MySQL 验收 39/39 PASS | 本日日志 Wave 10 Freeze | 继承为既有证据；本节不重跑、不重开 |

**明确禁止**：不得把 Wave 9 / Wave 10 已冻结的 Requirement 改写为 Wave 11 的新设计；不得把九项能力误报为已有实现；不得在 Requirement 层锁定表结构、模块文件或 Migration DDL。

### 11. Wave 11 交付包装（逻辑交付包）

本节只记录**逻辑**交付包与依赖顺序，**不**在本阶段启动任何 Package Implementation，**不**锁定物理结构。

```text
W11-SEC   Security Read Scope Remediation (W11-SEC-01)
          —— 独立、有界的工作边界
          —— 必须先于开放新的历史查询入口完成
          —— 需独立授权

W11-A     Credit Query / Exception History        SC101–SC102
          依赖：W11-SEC 完成
          Schema：不引入新的例外事实表；查询为 DERIVED

W11-B     Credit Evaluation Foundation            SC103–SC105
          依赖：无（与 W11-A 相互独立）
          Schema：需要新增评估对象；具体结构由 Stage C Design 决定

W11-C     Multi-Scorer & Rating Application       SC106–SC107
          依赖：W11-B
          Schema：依赖 W11-B 的评估对象；并需处理既有评级列与
                  评估结果之间的引用关系（结构由 Stage C Design 决定）

W11-D     Credit Reconciliation / Recalculation    SC99–SC100
          依赖：W11-SEC（读取面须先具备 canonical Scope）
          Schema：仅审计/执行证据；不建立持久化 mutable exposure cache
```

**顺序依据（证据）**：

1. `W11-SEC` 先行的依据：SC102 的例外历史权威来源是既有 check result / approval 表；`W11-SEC-01` 未闭合时开放新的历史读取面，等于把已存在的越权面复制到新的 Query / Exception History 入口（§4.1、§8 A-D2-6）。
2. `W11-B` 先于 `W11-C` 的依据：SC106 的多评人参与范围限于单个评分表，SC107 的应用对象是 Credit Evaluation Result —— 二者都依赖评分表与评分结果的存在（§6.5 R106-1 / R107-1）。
3. `W11-A` 与 `W11-B` 相互独立的依据：SC101 / SC102 消费既有 check result / approval / policy snapshot 事实，不需要评估对象；SC103–SC105 不读取例外历史（R101-7 与 R103..R105 无交叉）。
4. `W11-D` 置于末尾的依据：SC99 / SC100 的读侧必须先有 canonical Scope 能力（W11-SEC），且 D1 已排除持久化缓存，因此本包不引入任何"第二套台账"风险面；将其置于末位可在其它包已稳定后一次验证 S17 零写入。
5. **本节不建议把九项合并为单一不可验证提交，也不建议在 D1 / D2 / D3 未闭合前进入任何 Implementation。**

### 12. Compatibility 与禁止变更

- 本节**不改变**任何已冻结的 Capability 定义文本、UAT 编号、Race 编号、Invariant 文本、Permission 语义或既有 API 契约。
- 本节**不**授权任何 Schema、Migration、代码、测试或 Runner 变更。
- 本节**不**授权任何 MySQL 执行、发布、部署或 Git 写操作。
- 本节**不**解除 `W10-INV-RISK-01`（`BLOCKS_RELEASE_ONLY`）、`CREDENTIAL_EXPOSURE_OPEN`（`REQUIRES_OWNER_DECISION`）、`LEGACY_DATA_EVIDENCE_PENDING`，也**不**解除 `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED`。
- 本节**不**重开 Wave 10 的全部业务验收；既有 39/39 MySQL 验收证据保持不变。
- 兼容性要求：`W11-SEC-01` 的修正只允许**收紧**数据可见范围，不得改变 Wave 10 已冻结的业务行为或响应字段语义。

### 13. 剩余真实业务决策（本阶段未决、且不阻塞 Requirement 完成）

| ID | 事项 | 本阶段处置 | 边界 |
|---|---|---|---|
| L-1 | 评分人与正式应用人是否必须为不同人员 | **未新增规则**。§5 只批准**授权类别分离**（evaluate 类 vs write-class），**不**批准人员级分离。若业务后续要求人员级分离，**必须返回 Requirement 层重开**，不得由 Design 或 Implementation 静默引入 | 本阶段不得静默增加审批角色或流程（R-D3 / A-D3-4） |
| L-2 | Stage C 中重算 kind 的词汇处置（沿用并重定义 `DETERMINISTIC_REBUILD`，或另立表达"重算"的 kind） | 移交 Stage C Design | 本节只记录冲突 C-2 / C-3，不预先决定；R100-6 的 audit-only 约束在两种处置下均不变 |
| L-3 | `W11-SEC-01` 的 Implementation 授权 | 需**独立、有界的跨冻结边界授权** | 不得夹带进 W11-A / W11-B / W11-C / W11-D 的实施授权 |

L-1 与 L-2 **不阻塞** Requirement 完成，也**不阻塞** Stage C Design 启动；L-3 **阻塞** W11-SEC 的 Implementation，但不阻塞 Stage C Design。

### 14. Stage C Design 前置条件

进入 Stage C Design 前应满足：

1. 本节（Wave 11 Stage B Requirement Closure）已获用户确认。
2. §3 C-2 / C-3 的 kind 语义冲突作为 Stage C 输入已被接受（由 Stage C Design 处置，本节不预设结论）。
3. `W11-SEC-01` 的有界授权边界已明确（不夹带、不重开 Wave 10 验收）。
4. 交付包装顺序（§11）已被接受，或已给出基于证据的顺序调整理由。

**Stage C Design 不得**在本节之外自行扩展：不得引入第二套 Credit Exposure Ledger；不得引入持久化 mutable exposure cache；不得引入新角色或新权限码；不得改写 Wave 9 / Wave 10 冻结合同；不得在本阶段之外新增 SC / UAT / Race ID；不得改写历史 Check / Approval Snapshot；不得把查询实现为写入。

### 15. 本阶段明确不实施

```text
Design（表结构 / 模块划分 / Migration DDL / 锁序 / 具体 API 形态）
Implementation（任何代码、Schema、测试、Runner）
任何真实 MySQL 执行与 campaign
任何 Git 写操作（add / commit / push / merge / rebase / tag）
Release / Deploy
前端与移动端界面实现
Wave 10 验收重跑
```

### 16. 状态

**`WAVE11_STAGE_B_REQUIREMENT_READY`**

- `REQUIREMENT_ONLY_NO_DESIGN_NO_IMPLEMENTATION`;
- `D1_D2_D3_APPROVED_AND_RECORDED`;
- `SC99_SC107_REQUIREMENT_COMPLETE_IMPLEMENTATION_COVERAGE_STILL_MISSING`;
- `UAT_S_34_35_36_NUMBERING_PRESERVED_NO_NEW_TOP_LEVEL_UAT_ID`;
- `R_SAL_23_CONDITIONAL_PRESERVED`; `R_SAL_24_PRESERVED`;
- `W11_SEC_01_SECURITY_REMEDIATION_TRACKER_ESTABLISHED`;
- `NO_SOLUTION_MD_MODIFIED`; `NO_CODE_SCHEMA_MIGRATION_TEST_RUNNER_MODIFIED`;
- `NO_MYSQL_CONNECTED`; `NO_GIT_WRITE`; `NO_RELEASE`; `NO_DEPLOY`;
- `W10_INV_RISK_01_BLOCKS_RELEASE_ONLY_PRESERVED`;
- `CREDENTIAL_EXPOSURE_OPEN_REQUIRES_OWNER_DECISION_PRESERVED`;
- `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED_PRESERVED`;
- `HARD_STOP_AFTER_STAGE_B_REQUIREMENT`.

---

## W11-A U2 — Bounded Requirement Correction after Pre-E3 Semantic Parity Verification (2026-10-28)

### 1. Authorization, chronology and bounded scope

Authorization: the user accepted the Pre-E3 verdict
`W11_A_U2_PRE_E3_BOUNDED_CORRECTION_REQUIRED` and approved the consecutive
**Requirement → Design Correction** for exactly two business decisions:

- `D-U2-1` — Customer Aggregate `usedCents` includes canonical Finance eligible prepayment;
- `D-U2-2` — SC101 requires an explicit Credit Check stage and uses a per-scope computed policy identity.

This record is later than the U2-1 Implementation record. It does **not** rewrite that history. The
reported U2-1 results (29/29 SQLite, FAST 500/500, FULL 2983/2983 and Build PASS) remain true results
for the cases executed at that time, but they do not prove the newly exposed nonzero-prepayment or
multi-stage identity cases. U2 E3 remains blocked until a separately authorized implementation
correction and corrected E2 regression pass.

The six accepted findings are:

```text
G-A1  Aggregate eligible prepayment was omitted
G-B1  the Stage Requirement was undefined
G-B2  the fallback strategy was not approved
G-B3  the computed policy identity did not state its Stage
G-B4  the dynamic identity depended on viewer-visible Profiles
G-B5  dynamic and historical identities were not fully distinguished
```

This section changes only SC101 / SC102 Requirement details needed to close those findings. It does
not reopen all W11-A, does not change Wave 10 Credit Check, does not change U1, W11-SEC-01 or their
frozen fingerprints, and does not authorize Implementation, MySQL, U3 or Git writes.

### 2. D-U2-1 — final Credit used amount

#### 2.1 Canonical source and amount contract

SC101 must report the same final current occupancy used by the formal Wave 10 Credit Check:

```text
Customer Aggregate usedCents
  = approvedSoCommitmentCents
  + deliveredNotSettledCents
  + arOpenCents
  - eligiblePrepaymentCents

Salesperson Sub-Limit usedCents
  = approvedSoCommitmentCents
  + deliveredNotSettledCents
  + arOpenCents

Salesperson Sub-Limit eligiblePrepaymentCents = 0
```

- The raw Sales / Delivery / AR projection continues to come from the one canonical
  `computeCreditExposure()` implementation.
- Customer Aggregate eligible prepayment must come from the existing Finance adapter through its
  verified `lockMode='NONE'` read path. SC101 must not copy Finance balance selection, application,
  refund, reversal or remaining-eligible arithmetic.
- Eligible prepayment is aggregate-only because Finance advance money has no salesperson dimension.
- Money remains safe integer cents. The existing Wave 10 subtraction boundary and negative-result
  behaviour are preserved exactly. SC101 must not add `MAX(0)`, change rounding, cap a negative
  remaining amount or otherwise change the frozen Wave 10 algorithm.
- No second Credit Exposure calculator, ledger or mutable exposure cache may be created.

This clause supersedes any reading of R101-1 that treats the zero-filled initial
`eligiblePrepaymentCents` component returned by `computeCreditExposure()` as the final Credit Check
amount. R101-1 means the **final** amount after the same canonical Finance offset that the Credit
Check applies.

#### 2.2 Read-only and authorization boundary

Before reading business facts, SC101 must complete `CREDIT_VIEW` and canonical Credit Read Scope
authorization. It may derive data only for scopes admitted by that authorization.

The eligible-prepayment read must:

- use `lockMode='NONE'`;
- perform no row lock, no transaction, no insert/update/delete, no audit and no lock provisioning;
- not call the Credit Check writer, Snapshot writer or idempotency writer;
- not expose Finance source-balance identities or other unauthorized Finance detail in the SC101
  response;
- preserve the zero-business-write contract of all three W11-A GET endpoints.

If the existing adapter cannot satisfy those properties, Implementation must stop and report the
adapter as a blocker; the Finance adapter must not be changed under a W11-A correction authorization.

### 3. D-U2-2 — explicit Stage

`GET /api/credit/exposure` requires an explicit `stage` request parameter. The accepted values are
the existing `CREDIT_CHECK_STAGES` values only:

```text
SO_SUBMIT
SO_APPROVE
SALES_DELIVERY_CONFIRM
```

Missing, empty or invalid `stage` returns HTTP 400 with existing business code
`CREDIT_QUERY_INVALID_INPUT`. No new stage constant or implicit default is allowed.

The following fallback behaviours are prohibited:

- deriving the stage from a Profile-bound rule;
- `ORDER BY business_stage LIMIT 1`;
- choosing the lexicographically first effective stage;
- choosing the first element of `CREDIT_CHECK_STAGES`.

The explicit stage selects the rule context whose dynamic identity is being queried. It does not
claim that a real Credit Check is being executed, does not change current authorization and must
never be used as an authorization input. A future U3 caller must explicitly select the stage or
receive it from an exact business entry context; the UI must not guess it.

### 4. Per-Scope Computed Policy Identity

Every returned authorized business credit scope has its own **computed** policy identity. A shared
top-level fingerprint built from all Profiles visible to the current viewer is prohibited.

For one scope, the identity must bind at least:

```text
customerId
businessDate
stage
scopeType
creditProfileId (or the equivalent canonical Profile identity)
parameterSetHash
ruleSetHash for the explicit stage
profileEffectiveStateHash for this scope only
computedPolicyFingerprint
persisted
creditPolicySnapshotId (nullable; only when the exact computed identity already exists)
```

The existing `buildScopeHashes()` and frozen U1 `computePolicySnapshotFingerprint()` are the only
hash/fingerprint implementations. For each returned scope, the hash builder receives only that
authorized scope and the explicit stage. Other viewer-visible or hidden Profiles must not
participate.

Required invariants:

1. Same scope + stage + business date + effective Profile/Rule/Parameter state gives the same
   computed identity to every viewer authorized to see that scope.
2. A viewer cannot infer another scope through hashes, counts, ordering or any other identity field.
3. Different Profiles may have different identities.
4. The frozen `CSP1:` algorithm and input ordering are unchanged.
5. A fingerprint string alone is not a complete business identity: consumers must use it together
   with its explicit customer/date/stage/scope/Profile context.
6. A computed SC101 identity is not automatically a historical Wave 10 Credit Check Snapshot.

### 5. Historical Snapshot compatibility

SC102 continues to expose the immutable identity persisted by the original Credit Check:

- `credit_check_results.credit_policy_snapshot_id` and `policy_snapshot_fingerprint`;
- the referenced `credit_policy_snapshots` row;
- the original profile effective-state hash, stage, business date and decision identity.

SC101 computed identity must be named and nested as a dynamic per-scope identity. It must not replace,
regenerate, overwrite or masquerade as the SC102 historical Snapshot. No historical Snapshot is
rewritten or backfilled by this correction.

### 6. Corrected acceptance contract

The corrected SQLite E2 must retain all original 29 U2-1 tests and add at least:

- zero and nonzero eligible prepayment created through a production Writer;
- exact Aggregate and Sub-Limit used/remaining amounts;
- prepayment effective-date and historical-business-date boundaries;
- same-day SO_SUBMIT and SO_APPROVE rules with different rule sets;
- explicit stage determines `ruleSetHash`; missing/empty/invalid stage is rejected;
- no lexicographic, Profile-bound or default-stage fallback remains;
- every computed identity states its stage and belongs to one scope;
- ADMIN and Self receive the same identity for the same authorized Profile;
- different Profiles may differ and unauthorized Profiles leak no identity;
- computed identity does not impersonate a historical Snapshot;
- SC102 historical Snapshot linkage remains exact;
- every GET leaves a whole-database content digest unchanged.

Only after corrected SQLite E2, focused Wave 9/10/W11-SEC/U1 regression, FAST, FULL, Build and
`git diff --check` pass may U2 return to E3 readiness. Real MySQL E3 remains separately authorized
and must rerun the corrected amount, stage, viewer-independence, historical-link and zero-write
matrix on the protected disposable target.

### 7. Requirement status and freeze boundary

**Status: `W11_A_U2_BOUNDED_CORRECTION_REQUIREMENT_READY`.**

- `D_U2_1_D_U2_2_APPROVED_AND_RECORDED`;
- `AGGREGATE_PREPAYMENT_FINAL_USED_CONTRACT_FIXED`;
- `SUB_LIMIT_PREPAYMENT_ZERO_PRESERVED`;
- `EXPLICIT_STAGE_REQUIRED_NO_FALLBACK`;
- `PER_SCOPE_COMPUTED_IDENTITY_VIEWER_INDEPENDENT`;
- `HISTORICAL_SNAPSHOT_IDENTITY_PRESERVED`;
- `OLD_U2_1_RESULTS_PRESERVED_NOT_OVERCLAIMED`;
- `U2_E3_BLOCKED_PENDING_CORRECTED_IMPLEMENTATION_AND_E2`;
- `W11_SEC_01_ACCEPTANCE_PASS_FROZEN_GIT_JOURNAL_CLOSED_PRESERVED`;
- `W11_A_U1_ACCEPTANCE_PASS_FROZEN_GIT_JOURNAL_CLOSED_PRESERVED`;
- `WAVE10_CAPABILITY_FROZEN_RELEASE_BLOCKED_PRESERVED`;
- `NO_CODE_TEST_SCHEMA_MIGRATION_MYSQL_GIT_WRITE`.

---

## W11-A U2 E3 — Cross-Engine Credit Policy Hash Contract Requirement Correction (2026-10-29)

### 1. Authorization, finding and bounded scope

After the second real-MySQL E3 run returned 7/10 PASS, the user accepted the exact triage of M2,
M4 and M9 and authorized one consecutive **Requirement → Design Correction**. This Requirement
stage addresses the confirmed M4 production defect and records the already-confirmed test-only M2
and M9 corrections. It does not reopen all Wave 10 or W11-A.

The confirmed M4 fact is:

```text
SQLite TEXT  {"identity":"SO_APPROVE"}
MySQL JSON   {"identity": "SO_APPROVE"}
```

These values are the same JSON object, but V1 `buildScopeHashes()` hashes the physical
`result_payload_json` string. The resulting `ruleSetHash`, `CSP1:` fingerprint and downstream
identity therefore differ by database engine. Treating M4 as a comparison-only failure is
prohibited.

### 2. R-HASH-01 — supported Credit Rule payload domain

The supported business input is the value accepted by the production Credit Rule Writer:

- the top-level value MUST be a JSON object;
- nested objects, arrays, strings, finite numbers, booleans and JSON literal `null` are allowed;
- object member order and insignificant JSON whitespace carry no business meaning;
- array order carries business meaning and MUST be preserved;
- object keys and string values preserve their Unicode code points; escape spelling is not
  identity;
- numbers use the JSON/ECMAScript finite-number value model; `-0` and `0` have one canonical
  representation, non-finite values are invalid, and integer values outside the safe-integer range
  are rejected rather than rounded into another business value;
- an empty object is valid; an empty array is not an object and is invalid;
- SQL `NULL`, JSON literal `null`, malformed JSON and a valid non-object top-level JSON value are
  distinct invalid conditions and MUST fail closed before any Snapshot, Check Result, approval
  consumption or audit write.

Duplicate object keys are not a supported Credit Rule payload. The production HTTP Writer receives
an object, not raw JSON text, and therefore cannot create duplicate keys. SQLite `TEXT` has no JSON
constraint; MySQL `JSON` validates and may normalize a raw SQL value before it is read back. Raw SQL
insertion is not a supported business interface and MUST NOT be used to claim cross-engine parity
for duplicate-key input. A duplicate key that remains observable at the application boundary MUST
be rejected; it MUST NOT be silently resolved by first-key or last-key wins.

This correction does not authorize a general JSON framework, a rewrite of other JSON columns or a
new database-wide JSON policy.

### 3. R-HASH-02 — V2 semantic canonicalization and identity

For every supported payload, the new rule-set contract MUST parse the JSON value and hash its
semantic canonical form:

1. recursively sort object member names deterministically;
2. recursively canonicalize member values;
3. preserve array element order and multiplicity;
4. serialize primitives by the value rules in R-HASH-01;
5. include an explicit V2 domain/version marker in the rule-set digest input.

The same legal rule rows, effective date and stage MUST produce the same V2 `ruleSetHash` on SQLite
and MySQL. Different semantic payloads MUST remain distinguishable. The database dialect MUST NOT
select the algorithm.

The new Snapshot identity MUST be explicitly versioned as `CSP2:<64 lowercase hex>` and its digest
input MUST be domain-separated from CSP1. New Credit Check group identities MUST use the disjoint
`CCHK2:<64 lowercase hex>` namespace. A bare 64-character `ruleSetHash` is not a complete identity;
its owning contract version MUST be present in runtime/query context. SC101 MUST expose that version
per scope and MUST remain viewer-independent.

### 4. R-HASH-03 — V1 immutability and coexistence

All existing V1 artifacts remain immutable facts:

- `CSP1:` Snapshot rows and their three stored hashes;
- `CCHK1:` Check Results and check-group IDs;
- Check Result → Snapshot references;
- Special Approval → Check Result / Snapshot / fingerprint references;
- audit history and the original W11-SEC / U1 Golden Vectors and digests.

No backfill, UPDATE, identity rewrite, automatic approval migration or historical audit mutation is
permitted. V1 calculation remains available only for historical verification and exact legacy
replay. New policy calculation and new persisted decisions use V2. A V1 and V2 fingerprint MUST
never be compared as if the prefixes were cosmetic.

No Schema or Migration is required by this Requirement: `snapshot_fingerprint` and
`check_group_id` already carry versioned prefixes within their current lengths, and Snapshot
`notes_json` may carry a diagnostic contract label. The prefixes and the calculation path—not
`notes_json`—are authoritative.

### 5. R-HASH-04 — replay and Check Group safety

Before creating any V2 Snapshot or decision, a Credit Check MUST evaluate legacy replay safety:

- an exact, provable CCHK1 replay continues to resolve the original rows and original Snapshot
  references under V1 semantics;
- a new V2 decision uses CCHK2 and cannot collide with CCHK1;
- if an existing legacy result has the same source/stage/business-date context and appears to
  represent the same business facts, but exact replay cannot be proved (including representation or
  cross-engine-history ambiguity), the operation MUST fail closed with an explicit conflict and
  zero new Snapshot / Check Result / approval-consumption / audit writes;
- a materially changed rule, Profile, parameter, exposure, proposed delta or recognition context may
  produce a new V2 decision after the implementation proves that it is not an ambiguous legacy
  replay;
- Hash prefix equality or inequality alone is never sufficient replay evidence.

### 6. R-HASH-05 — Special Approval compatibility

An existing approval remains bound to its original Check Result, Snapshot ID, fingerprint, scope,
source-order condition and expiry rules. It may release only the exact V1 replay for which the
existing Wave 10 contract already permits consumption. It MUST NOT release a new CSP2/CCHK2 decision.
A V2 decision requiring an approval follows the existing request/decision authority, SOD, expiry,
scope and one-time rules but creates a new approval binding; no old approval is migrated, duplicated
or consumed merely because the version changed.

### 7. R-HASH-06 — SC101 and SC102

SC101 computes V2 per-scope identity and MUST return an explicit hash-contract version together with
the stage, Profile, three hashes and `CSP2:` fingerprint. Its read-only persisted lookup matches the
complete V2 identity only and creates nothing. `persisted=false` means no exact V2 Snapshot match;
it does not deny the possible existence of immutable V1 history.

SC102 continues to return each stored historical Snapshot ID, fingerprint, rule hash, profile hash,
Check Group and approval binding verbatim. It MUST NOT recompute, normalize or rewrite historical
identity. `CSP1:` / `CCHK1:` remain sufficient authoritative version markers for existing rows;
unknown or malformed persisted prefixes fail closed rather than being guessed.

### 8. R-HASH-07 — evidence, freeze and acceptance

The original W11-SEC 14-file digest record, U1 four incremental fingerprints, U1 CSP1 Golden
Vectors and historical Wave 10 behavior evidence remain permanently recorded. A future authorized
Implementation that changes a frozen file MUST establish a new bounded before/after digest link and
new V2 Golden Vectors without replacing the old values. U1 T5's historical-protection purpose MUST
remain; deleting, skipping or weakening it is prohibited.

Future E2/E3 must prove at least: whitespace/key-order equivalence; nested object/array behavior;
SQL NULL versus JSON null; malformed/non-object/duplicate-key rejection within the supported
boundary; V1 Golden preservation; independent V2 Golden Vectors; old/new Snapshot distinction;
legacy replay and ambiguity refusal; approval binding; per-scope viewer independence; SC102
immutability; zero-write GETs; and real SQLite/MySQL parity using the same production Writer.

M2 and M9 remain test-only corrections: M2 selects `cus-w11-self:sp-self` by retained Profile key
and separately proves `sp-other` is zero; M9 uses real `checkResultId` for within-engine pagination
uniqueness and a collision-free, uniqueness-checked business projection for cross-engine content.
No `Set` deduplication, expected-value weakening or M4 bypass is permitted.

### 9. Requirement status and stage boundary

**Status: `W11_A_U2_E3_HASH_CORRECTION_REQUIREMENT_READY`.**

- `SEMANTIC_JSON_V2_REQUIRED`;
- `CSP2_CCHK2_EXPLICIT_VERSIONING_REQUIRED`;
- `CSP1_CCHK1_HISTORY_IMMUTABLE`;
- `LEGACY_REPLAY_PROVE_OR_FAIL_CLOSED`;
- `SPECIAL_APPROVAL_EXACT_BINDING_PRESERVED`;
- `NO_SCHEMA_MIGRATION_OR_HISTORY_REWRITE`;
- `M2_M9_TEST_ONLY_CORRECTIONS_RECORDED`;
- `REQUIREMENT_STAGE_COMPLETE_DESIGN_STAGE_AUTHORIZED_CONSECUTIVELY`;
- `NO_CODE_TEST_MYSQL_GIT_WRITE_ACCEPTANCE_FREEZE_OR_U3`.

## W11-A U2 — ONE_TIME 特别审批消费与 Replay 语义更正 Requirement（2026-10-29）

### 1. 授权、事实认定与有界范围

本节是**有界 Requirement 更正**，只处理一个已确认的业务矛盾：ONE_TIME 信用特别审批在 Credit Check
的 replay 路径上可以被反复"消费"，且消费事实从不落盘。

授权来源：本轮指令显式授权对该矛盾进行 Requirement / Design 复核（AGENTS.md §4.2 / §4.3，并按 §4.0
连续阶段授权连续执行 Requirement 与 Design）。

基线：Branch `work/sales-waves6-13-recovery-20261025`；HEAD `d9e5d50a9103612a17070f806312b822281eb6c6`；
Version `1.6.2`。

**事实认定（代码与既有测试证据，非推测）**

| 编号 | 事实 | 证据位置 |
|---|---|---|
| F-1 | ONE_TIME 的"已消费"判定**只**依赖 `audit_logs` 中 `entity_type='CREDIT_SPECIAL_APPROVAL' AND action='CONSUME'` 的行 | `server/modules/credit-check.js` `findConsumableApproval()` |
| F-2 | 释放决定的翻转与 CONSUME 审计的写入被**两个不同的键**控制：翻转键是"审批是否已消费"，写审计键是"Check Group 是否 replay" | `credit-check.js` 消费段 `if (releasable && consumeApprovals) { ... if (!isReplay) { audit(... 'CONSUME' ...) } }` |
| F-3 | 因此在 replay 路径上决定翻转为 `PASS` 并返回 `consumedSpecialApprovalId`，但 **CONSUME 审计行数始终为 0** | 既有 Wave 10 golden 用例 `server/sales-customer-wave10-credit-check.test.js`（"V2 approval isolation — CSP1 approval releases only exact V1 replay and never a changed CCHK2"）断言 `replay.decision === 'PASS'` 且 `replay.consumedSpecialApprovalId === approval.id`，**且从不断言 CONSUME 审计行数**；该用例在当前基线下通过 |
| F-4 | `credit_special_approval` 表**没有**任何消费状态列；`credit_check_results` 表**没有** `special_approval_id` 列；审批与被释放范围的持久化关联只存在于 `component_breakdown_json.consumedSpecialApprovalId` | `server/migrations/sales-customer-wave10-credit-check.js` |
| F-5 | `audit_logs` **没有** `(entity_type, entity_id, action)` 唯一约束；只有 `idx_audit_entity(entity_type, entity_id)` 普通索引 | `server/db.js` |
| F-6 | 消费身份在既有证据中**已经**是 `(approval_id, check_group_id, scope_type)` —— CONSUME 审计的 detail 已持久化 `checkGroupId` 与 `scopeType` | `credit-check.js` CONSUME 审计 detail |
| F-7 | 消费作用域查找**不**按 Check Group 绑定，而是按 `(scope_type, source_credit_policy_snapshot_id, source_policy_snapshot_fingerprint, source_sales_order_id)` 绑定；`source_sales_order_id IS NULL` 时匹配任意同快照同范围的检查 | `credit-check.js` `findConsumableApproval()` |

**本节更正的四个业务矛盾**

| 编号 | 矛盾 | 业务后果 |
|---|---|---|
| **C-1** | **虚构消费**：replay 路径返回 `PASS` 并点名审批，但持久化事实（不可变 Check Result、审计轨迹）没有任何消费记录 | 审计与业务事实矛盾；`consumedSpecialApprovalId` 不再可信 |
| **C-2** | **跨动作重复消费**：因消费从未落盘，"已消费"永远为假，同一 ONE_TIME 审批可被**另一个业务动作**再次释放 | ONE_TIME 的"只消费一次"承诺失效 |
| **C-3** | **合法重放与持久化事实矛盾**（反向）：当首次消费发生在非 replay（新建 Group）路径时，落盘的 Result 行为 `PASS`；此后同一 Group 的合法幂等 replay 会重新执行"已消费"判定并把决定退回 `SPECIAL_APPROVAL_REQUIRED`（CCHK2 路径），或在 CCHK1 路径因决定比对失败而直接 409 `CREDIT_CHECK_LEGACY_REPLAY_AMBIGUOUS` | 已被业务接受的幂等重放被拒绝；重放结论与落盘结论互相矛盾 |
| **C-4** | **落盘明细串值**：`consumedSpecialApprovalId` 是 Scope 循环外的单一变量；某范围被释放而另一范围未被释放时，**未被释放**的那一行的 `component_breakdown_json.consumedSpecialApprovalId` 会残留前一范围的审批 ID | 落盘的"哪张审批释放了本范围"为假；SC102 历史读取给出错误关联 |

C-1/C-2 已在 `log/2026-10-29.md` §6 与 `solution.md` §37.54.20.21 末段登记为未决矛盾；C-3 与 C-4
为本轮复核新增认定，证据同上表。

**有界范围**

纳入本更正：

- ONE_TIME 审批的"消费"语义（何时成立、证据落在何处、如何被再次读取）；
- Credit Check replay 的**结论**必须与已持久化的业务事实一致；
- 消费证据的原子性、失败零副作用与并发单次消费；
- 消费作用域查找与 Check Group 绑定关系的正确性。

**明确不纳入**（不得因本更正被顺带改变）：

- 敞口计算、决策规则、金额口径、权限模型、角色与权限码；
- Finance → Credit 锁序、L1–L8 锁序、事务归属合同；
- V1（CCHK1/CSP1）与 V2（CCHK2/CSP2）的身份隔离规则与历史不可变规则；
- 审批的申请/决策权威、Authority Ceiling、SOD、有效期、Scope 绑定（R-HASH-05 已固定的 `SPECIAL_APPROVAL_EXACT_BINDING_PRESERVED` 不变）；
- SC101/SC102 的响应结构与只读零副作用合同；
- TIME_BOUNDED / OBJECT_BOUNDED 的**可重复消费**语义本身（其既有"可在有效期内/对象内重复使用"语义保持不变，仅其消费记录变得可证明）。

### 2. R-ONE-01 — ONE_TIME 的"只消费一次"必须是可证明的业务事实

- **R-ONE-01-a**：一个 ONE_TIME 审批在系统内**至多存在一次有效消费**。该事实必须可由持久化证据独立证明，不得由"本次调用是否 replay"推导。
- **R-ONE-01-b**：消费的存在性判定**不得**仅由 `audit_logs` 的行数推导。审计轨迹是面向人的证据；消费事实的权威必须是具备唯一性约束的结构化记录，使"至多一次"在数据库层可判定。
- **R-ONE-01-c**：消费的身份必须是 `(approval_id, check_group_id, scope_type)`。该身份**不得**由"相同 Snapshot"或"相同来源单据"推导——同一 Snapshot、同一来源可以对应多个不同的 Check Group（业务事实变化或授权上下文变化），这些是不同的业务动作。
- **R-ONE-01-d**：消费成立必须与它所释放的那次业务动作**同一事务**提交。业务动作被拒绝或事务回滚时，不得留下任何消费证据。
- **R-ONE-01-e**：`credit_special_approval` 与 `credit_check_results` 的既有历史行**不得**被迁移、重写或追加消费标记来"补齐"状态。历史消费由其既有的不可变 CONSUME 审计证据证明。

### 3. R-ONE-02 — 首次消费与合法幂等 Replay 必须可区分

Credit Check 的**检查组（Check Group）**与审批的**消费（Consumption）**是两个正交的事实：

- Check Group 回答"这一次业务动作的这次信用评估是什么结论"；
- Consumption 回答"这张审批是否已经被用掉、用在了哪一次业务动作上"。

因此必须区分以下三种状态，且三者必须产生**互不相同且可区分**的结果：

| 状态 | 含义 | 决定 | 消费写入 |
|---|---|---|---|
| `UNCONSUMED` | 该审批从未被消费 | 若满足释放条件则 `PASS` | **写入一次**消费记录与一次 CONSUME 审计 |
| `CONSUMED_BY_THIS_ACTION` | 已被消费，且消费身份正是当前 `(check_group_id, scope_type)` | `PASS`（**复用原消费结论**） | **不写入**任何消费记录或审计 |
| `CONSUMED_BY_OTHER_ACTION` | 已被消费，且消费身份属于另一个 Check Group 或另一个 Scope | **不得释放**；维持 `SPECIAL_APPROVAL_REQUIRED` | **不写入**任何消费记录或审计 |

- **R-ONE-02-a**：`CONSUMED_BY_THIS_ACTION` 的重放**必须**返回与首次消费一致的结论与同一 `consumedSpecialApprovalId`。合法业务幂等重放不得产生第二次库存、信用、资金或审批消费副作用。
- **R-ONE-02-b**：`UNCONSUMED` 状态下发生的消费，其消费证据必须被写入，**即使**该次评估落在既有 Check Group 上（replay）。Check Group 是否 replay 决定的是"要不要写 Check Result 行"，**不是**"要不要写消费证据"。
- **R-ONE-02-c**：`CONSUMED_BY_OTHER_ACTION` 的重放**不得**因为"采用了相同 Snapshot"或"采用了相同来源单据"而被放行。
- **R-ONE-02-d**：响应中的 `consumedSpecialApprovalId` **当且仅当**当前 `(check_group_id, scope_type)` 确实存在消费记录时非空。不得出现"返回了审批 ID 但无消费记录"的情形，也不得出现"已有消费记录却不返回审批 ID"的情形。
- **R-ONE-02-e**：当首次消费落在一个**已存在**的 Check Group 上时，其不可变 Result 行**保持原样**（例如仍为 `SPECIAL_APPROVAL_REQUIRED`），释放事实由消费记录与 CONSUME 审计证明；历史 Check Result **不得**被改写为 `PASS`。

### 4. R-ONE-03 — 跨业务动作复用必须拒绝

- **R-ONE-03-a**：已被其它业务动作消费的 ONE_TIME 审批，必须被拒绝用于任何**不符合原授权**的再次消费。原授权的边界由 Scope、Snapshot 身份、Authority Ceiling、Override 与有效期共同界定。
- **R-ONE-03-b**：拒绝必须是**显式**的：决定维持 `SPECIAL_APPROVAL_REQUIRED`，并携带可机器识别的 reason code（`SPECIAL_APPROVAL_ALREADY_CONSUMED`），不得静默降级、不得伪造 `PASS`、不得改写历史。
- **R-ONE-03-c**：拒绝路径**零写入**——不写消费记录、不写 CONSUME 审计、不改 Check Result、不改审批。
- **R-ONE-03-d**：业务事实变化导致的新 Check Group（含新的授权上下文）视为**新的业务动作**。已消费的 ONE_TIME 审批不得被它复用；如需继续放行，必须针对新的 Check Result 申请**新的**审批（原审批保持只读历史）。此规则与既有"事实变化产生新决定而不是重放陈旧结果"的合同一致。

### 5. R-ONE-04 — 消费证据与持久化业务事实必须一致

- **R-ONE-04-a**：任何被返回为 `PASS` 的释放，都必须存在对应的、可独立核验的消费证据。该证据必须能回答"哪张审批、在哪个 Check Group、释放了哪个 Scope、什么时刻、被谁消费"。
- **R-ONE-04-b**：落盘的 Check Result 明细必须与该行的决定一致。未被释放的 Scope 行**不得**携带其它 Scope 的 `consumedSpecialApprovalId`（更正 C-4）。
- **R-ONE-04-c**：Check Group 的重放比对**不得**因为"落盘决定是消费后的 `PASS`、而本次重算的释放前结论是 `SPECIAL_APPROVAL_REQUIRED`"而判定为身份不可重放。重放比对必须接受由该行自身携带的释放标记所证明的"落盘结论 = 释放后结论"。
- **R-ONE-04-d**：历史 CONSUME 审计证据是**既有事实**。当一张审批在更正生效前已被消费时，系统必须依据其既有 CONSUME 审计证据识别该消费，并按 R-ONE-02 的三态处理；不得因结构化消费记录为空而把该审批当作未消费。
- **R-ONE-04-e**：既有 CONSUME 审计证据若不足以证明消费身份（例如明细不可解析或缺少 Check Group / Scope），系统**必须 fail closed**：把该审批视为已被某个**未知**业务动作消费并拒绝释放，**不得猜测**其归属。

### 6. R-ONE-05 — 失败零副作用与并发单次消费

- **R-ONE-05-a**：消费记录与 CONSUME 审计必须与被保护的业务动作在**同一事务**内提交。业务动作被拒绝或事务回滚时，两者一并回滚，数据库中**不得**留下任何消费痕迹。
- **R-ONE-05-b**：两个相互独立、竞争同一 ONE_TIME 审批的请求，**至多一个**可以得到释放结论。不得双放行。
- **R-ONE-05-c**：单次消费的保证**不得**仅依赖"先查后写"的应用层判断。该保证必须由具备唯一性约束的结构化记录在数据库层判定，并辅以对审批行的串行化读取，使结论在并发下可证明。
- **R-ONE-05-d**：消费结论的读回必须能看见并发事务已提交的写入，不得因事务隔离级别而读到陈旧快照并误判为"未消费"。
- **R-ONE-05-e**：并发冲突必须以**显式冲突**结束（不得静默失败、不得两个赢家），且失败方**零写入**。

### 7. R-ONE-06 — V1/V2 身份隔离与历史不可变

- **R-ONE-06-a**：V1 审批（CSP1 绑定）永远不得释放 V2 决定（CCHK2）；V2 审批必须绑定 CSP2。此规则与 R-HASH-05 已固定的 `SPECIAL_APPROVAL_EXACT_BINDING_PRESERVED` 一致，本更正**不放松**它。
- **R-ONE-06-b**：不得修改任何旧 Snapshot、旧 Check Result、旧 Approval；不得迁移旧 Approval；不得重写 CCHK1/CSP1；不得把旧审批复制成新审批；不得引入第二套信用审批权威。
- **R-ONE-06-c**：消费记录是**追加**证据，不得原位改写既有消费行。
- **R-ONE-06-d**：SC101 / SC102 的历史读取**不得回归**：零写入 GET 合同、可见性谓词、分页与内容等价性、身份版本校验（CCHK1/CCHK2、CSP1/CSP2 前缀）全部保持。
- **R-ONE-06-e**：本更正不得改变 SQLite 与 MySQL 的行为一致性合同。两引擎的判定结果、唯一性保证与错误语义必须一致；跨引擎差异（例如 JSON 文本渲染差异）不得成为业务判定依据。

### 8. R-ONE-07 — 验收要求与阶段边界

更正必须由下列证据支撑，且**不得**删除或弱化任何既有 V1/V2 Golden、M2/M4/M9、U1、W11-SEC 与 Wave 10 回归：

1. ONE_TIME 首次合法消费：消费记录与 CONSUME 审计各恰好一条，决定为 `PASS`。
2. 同一动作合法幂等 Replay：返回 `PASS` 与同一 `consumedSpecialApprovalId`，消费记录与 CONSUME 审计**数量不变**。
3. 不同动作复用同一 ONE_TIME：被拒绝，决定维持 `SPECIAL_APPROVAL_REQUIRED` 并携带 `SPECIAL_APPROVAL_ALREADY_CONSUMED`，零写入。
4. 连续两次 Replay **不得**虚构两次消费。
5. 已消费与未消费审批严格区分：未消费的可被首次消费；已消费（他动作）的不可被释放。
6. 原历史 Result 不变：消费不修改任何既有 Check Result 行。
7. 首次消费与业务动作原子提交：业务动作回滚时消费记录与 CONSUME 审计一并消失。
8. 事务失败零消费审计。
9. 并发竞争仅有一个合法消费结果，且失败方零写入。
10. V1 Approval 不得释放 CCHK2；CSP2 Approval 必须绑定 CSP2。
11. SC101/SC102 历史读取不回归（含零写入 GET 与跨引擎内容等价）。
12. 真实 MySQL 下的一次性消费并发验收。

**阶段边界**：本节只产生 Requirement。它**不**授权实现、测试、Schema / Migration、Gate / Runner、
package.json、AGENTS.md、冻结历史记录的任何修改；**不**授权连接 MySQL、运行 MySQL Gate、任何 Git 写操作、
U2 Acceptance 签发或 U3 启动。设计见 `solution.md` §37.54.22。

### 9. Requirement 状态与阶段边界

**Status: `W11_A_U2_ONE_TIME_REPLAY_CORRECTION_REQUIREMENT_READY`.**

- `ONE_TIME_SINGLE_CONSUMPTION_PROVABLE`;
- `FIRST_CONSUMPTION_VS_EXACT_REPLAY_DISTINGUISHED`;
- `CROSS_ACTION_REUSE_REFUSED`;
- `CONSUMPTION_EVIDENCE_MATCHES_PERSISTED_FACTS`;
- `FAILED_TRANSACTION_ZERO_CONSUMPTION_EVIDENCE`;
- `CONCURRENT_SINGLE_CONSUMPTION_GUARANTEED`;
- `V1_V2_IDENTITY_ISOLATION_PRESERVED`;
- `HISTORY_IMMUTABLE_NO_APPROVAL_MIGRATION`;
- `LEGACY_CONSUME_EVIDENCE_FAIL_CLOSED`;
- `REQUIREMENT_STAGE_COMPLETE_DESIGN_STAGE_AUTHORIZED_CONSECUTIVELY`;
- `NO_CODE_TEST_SCHEMA_GATE_MYSQL_GIT_WRITE_ACCEPTANCE_FREEZE_OR_U3`.

---

## W11-A OVERDUE Evidence Foundation — Bounded Requirement Amendment (2026-10-29)

### 1. Authorization, ownership and frozen-history boundary

The user accepted the W11-A U3 Audit finding and retained the complete SC102 R102-2 five-category
requirement. This bounded amendment owns only the post-freeze gap:

`W11_A_U3_0_POST_FREEZE_SC102_CONTRACT_GAP`

Its independent contract identity is:

`W11_A_OVERDUE_EVIDENCE_FOUNDATION`

This record does not reopen or rewrite the W11-A U2 Freeze Record, Commit
`e281f458836ad5c6b4a2900063ffb90141e8c6c1`, CSP2/CCHK2, ONE_TIME consumption, historical Check
Results or Special Approvals. It does not claim that the frozen U2 implementation already satisfied
the OVERDUE category. The accurate status is that U2 remains frozen and this post-freeze coverage gap
requires a separately accepted forward-only amendment.

### 2. Audit conclusion and canonical Finance truth

The canonical AR entity is `account_receivables`. For Credit purposes an eligible AR fact is a row for
the same customer with `conversion_state='OPEN'` and `business_date <= requested businessDate`, read by
the existing canonical `computeCreditExposure()` projection. Its monetary unit is safe integer cents.

The currently confirmed outstanding amount is `open_amount_cents`. It is a cached projection of the
canonical Finance effects (settlement allocation, unapplied application, credit adjustment and
write-off, including their authorized reversals). Partial settlement therefore reduces the observed
open amount; a full settlement or other confirmed extinguishment produces zero. Refunds and reversals
affect overdue evidence only through their canonical Finance effect and the subsequently reconciled
open amount. Credit must never create or maintain a second AR balance.

`account_receivables.due_date` is the due-date fact used by the existing Finance and Credit read paths.
`finance_due_schedule_lines` is not an alternative authority for this amendment: it is replaceable,
its settled amount is not maintained by the canonical settlement projection, and it cannot establish
immutable historical as-of state. Multiple Finance sources must first converge on one canonical open
item; Credit counts each open-item identity at most once and retains the existing source-chain and
salesperson-attribution rules.

The current header plus effect rows cannot reliably reconstruct the open amount at an arbitrary prior
business date: cached balance is current, reversals can occur later, and existing projections do not
apply every effect and reversal by an as-of cutoff. Therefore current AR state must never be presented
as the historical balance at a prior Credit Check date.

The approved feasible path is prospective capture only: a future Credit Check records the exact AR
facts observed by its canonical exposure projection when that Check is evaluated. That immutable
evidence proves what the Check observed; it does not claim to reconstruct Finance state before this
amendment and it does not authorize historical backfill.

### 3. Future overdue evidence definition

For one Check Result scope, the evidence has two distinct dates:

- `classificationBusinessDate`: the Check's explicit `business_date`, used for due-date comparison;
- `capturedAt`: the Result evaluation timestamp, proving when the canonical current Finance projection
  was observed.

For a positive eligible AR open amount with a valid due date:

```text
calendarDaysPastDue = max(0, classificationBusinessDate - dueDate in UTC calendar days)
```

The due-date boundary is not overdue: `businessDate == dueDate` yields zero days past due.

- Customer Aggregate uses the contractual due date itself (`graceDays = 0`). No new aggregate grace
  default or arbitrary threshold is introduced.
- Salesperson Sub-Limit uses the existing effective `credit_profile.overdue_day_policy`, falling back
  to the existing effective `CREDIT_SUB_LIMIT_OVERDUE_DAYS` parameter. It is interpreted only as the
  number of calendar grace days for the factual classification. If neither supplies a valid
  non-negative safe integer, the Sub-Limit overdue evidence is `UNKNOWN`; the existing
  `OVERDUE_POLICY_UNDEFINED` fail-closed decision behavior remains unchanged and is never translated
  into a true OVERDUE fact.
- A source is overdue only when `observedOpenAmountCents > 0` and
  `calendarDaysPastDue > graceDays`.
- `overdueOpenAmountCents` is the sum of the observed open amounts belonging to overdue source facts in
  that scope. It is never added to Credit Exposure: overdue AR is a subset of `arOpenCents`.
- A zero or negative observed open amount contributes no overdue amount. An unsafe/negative canonical
  amount is not normalized into a fact; evidence becomes `UNKNOWN` and the Finance invariant breach is
  recorded for fail-closed follow-up.
- A positive open item without a valid due date is not assumed current or overdue; it makes negative
  classification incomplete and therefore `UNKNOWN` unless another source already proves a positive
  OVERDUE classification.

Customer Aggregate considers every eligible canonical customer AR once. Salesperson Sub-Limit uses
the existing authoritative Sales source-chain attribution. Provably attributable amounts belong to
their salesperson scope; fabricated, equal or proportional allocation is forbidden. When an open
amount cannot be attributed, the Aggregate can still classify it, while a Sub-Limit with no proven
overdue amount remains `UNKNOWN` rather than FALSE.

### 4. Evidence status and historical compatibility

Each new Result scope must persist a versioned overdue evidence object with one status:

- `PROVEN_OVERDUE`: at least one authoritative source proves overdue and
  `overdueOpenAmountCents > 0`;
- `PROVEN_NOT_OVERDUE`: all relevant positive open sources are provable and none is overdue;
- `UNKNOWN`: the evidence is absent, incomplete or cannot prove either conclusion.

Evidence also records `COMPLETE` or `PARTIAL` completeness, the applied grace policy identity, totals,
source counts and the minimum canonical Finance identities needed to audit each contributing overdue
or unknown source. A positive proof may coexist with partial completeness; it remains OVERDUE because
existence is proven, while the UI must not imply that the stored overdue amount is exhaustive.

All pre-amendment Result rows lack the evidence version and are `UNKNOWN`, never FALSE. They remain
queryable, pageable and openable. No migration may infer, backfill or rewrite them from today's AR
state. A later Finance settlement, reversal, due-date correction or source transition never changes a
previously stored Result or its captured evidence.

### 5. Decision and classification separation

Overdue evidence is historical classification only. Capturing it must not change:

- `PASS`, `WARNING`, `BLOCK` or `SPECIAL_APPROVAL_REQUIRED`;
- Special Approval eligibility, association or ONE_TIME consumption;
- Credit limits, exposure components or proposed delta;
- CSP1/CSP2, CCHK1/CCHK2 or policy/profile snapshot identity;
- the existing `OVERDUE_POLICY_UNDEFINED` decision branch.

The evidence must be derived from the same receivable rows and attribution result already used by the
canonical Credit exposure calculation. A second AR calculation, live historical-query recomputation or
new Exception fact ledger is forbidden. Capture and Result insertion succeed or roll back together;
there is no partial evidence write.

### 6. R102-2 five-category contract

One Result may belong to multiple categories. Categories are exact persisted-history predicates:

- `OVER_LIMIT`: persisted `reason_codes_json` has the exact array element `OVER_LIMIT`;
- `OVERDUE`: versioned evidence status is `PROVEN_OVERDUE` and its amount is positive;
- `WARNING`: persisted `decision='WARNING'`;
- `BLOCK`: persisted `decision='BLOCK'`;
- `SPECIAL_APPROVAL`: the Check originally required special approval
  (`decision='SPECIAL_APPROVAL_REQUIRED'`) or a persisted `credit_special_approval` is associated with
  the Result. The DTO must expose these two facts separately even when the filter matches their union.

Exact JSON element/path operations are required; substring/`LIKE` matching is forbidden. Category
filtering occurs in the same authorized SQL predicate as the existing SC102 filters, before COUNT and
LIMIT/OFFSET. COUNT and LIST must share identical conditions. Invalid category values return 400.
No-match returns `total=0` and an empty list without leaking inaccessible identities.

### 7. Security, authorization and read-only query requirements

The existing five-level Credit Read Mode and `credit_check_results` scope predicate remain the sole
authorization boundary. Evidence and Finance identities may be returned only for Result rows already
visible under that predicate. Category, total, Result id, source id or approval association must not
widen scope or distinguish an inaccessible record from an absent one. Detail keeps the existing
non-enumerable 404 contract.

SC102 query endpoints remain zero-write. They classify only stored evidence and never join live AR to
infer history. The new evidence capture exists only on a future Credit Check write path already inside
its protected business transaction.

### 8. SQLite/MySQL acceptance requirements

Future Acceptance must prove, on both SQLite and MySQL:

1. not due, due-date boundary, proven overdue, missing due date and undefined Sub-Limit grace policy;
2. zero, partial and fully settled open amounts; mixed multiple AR sources; confirmed reversal effects;
3. Aggregate versus provably attributed Sub-Limit and ambiguous attribution;
4. prospective evidence immutability and pre-amendment `UNKNOWN` behavior with no backfill;
5. classification independent from decision and legal multi-category overlap;
6. exact five-category server filtering, authorized COUNT and stable pagination;
7. five Credit Read Modes, same 404 non-enumeration and GET zero-write;
8. unchanged CSP2/CCHK2, Replay, Special Approval and ONE_TIME behavior;
9. atomic rollback: a failed Check persists neither Result nor overdue evidence;
10. real Backend evidence; a frontend mock cannot satisfy this contract.

### 9. Requirement-phase conclusion and boundary

The Audit confirms a reliable forward-only path without changing Finance economic writes and without
introducing a second AR or Exception ledger. A versioned extension of the existing immutable
`credit_check_results.component_breakdown_json` is permitted as the preferred minimum storage path;
whether a physical query column is necessary remains a Design decision and requires an additive
migration if chosen.

This Requirement phase modified only `document.md` and the append-only `log/2026-10-29.md`. It did not
modify code, tests, schema, migration, UI, frozen records or Git history and did not run any database
operation or test.

**Requirement status: `W11_A_OVERDUE_FOUNDATION_REQUIREMENT_CLOSED`.**

## W11-A U3-0 Credit Query Mobile UI — Bounded Requirement Amendment (2026-10-29)

### 1. Authorization, identity and frozen boundary

The user consecutively authorized a targeted Audit refresh, Coverage confirmation, bounded Requirement
and bounded Design for the W11-A U3 SC101/SC102 mobile query surface. This Requirement phase owns only:

`W11_A_U3_CREDIT_QUERY_UI_CONTRACT`

It does not reopen W11-A U1/U2, `W11_A_OVERDUE_EVIDENCE_FORWARD_ONLY_AMENDMENT`, CSP1/CSP2,
CCHK1/CCHK2, ONE_TIME consumption, Credit Decision, canonical exposure, the five-category SC102 SQL or
the five-level Credit Read Mode. The existing three Credit GET endpoints and their frozen response
semantics remain authoritative. No implementation, test, Schema, Migration, database or Git operation
is authorized by this record.

### 2. Confirmed gap identity and approved scope

The targeted repository audit confirms this exact status:

| Capability | Status | Requirement consequence |
|---|---|---|
| SC101/SC102 frozen backend GET contracts | `COVERED` | U3 consumes them; it does not duplicate or redefine Credit facts |
| Exception Detail → Current Exposure context | `PARTIAL` | existing authorized Profile Detail resolves historical business identity; U3 must add the UI flow and keep historical/current values separate |
| CREDIT_VIEW-only customer / Credit Object selector | `PARTIAL` | existing Profile List is scope-safe but is not a bounded selector projection |
| canonical `credit-query` route and SC101/SC102 screen | `MISSING` | add one read-only route/screen; no second shell or API client |
| mobile/browser/responsive acceptance | `MISSING` | add executable route, interaction, privacy and width coverage in U3 Acceptance |

This amendment closes only those U3 gaps. It does not create a new Credit capability and does not
promote backend completion into a false UI-completion claim.

### 3. R-U3-1 — Canonical route and independent reachability

`src/navigation/applicationRegistry.js` remains the sole route source. U3 shall add canonical route
`credit-query`, owned by one screen `src/pages/credit-query.jsx`, with access
`any: ['CREDIT_VIEW']`. ADMIN remains accessible through the repository's established ADMIN permission
projection; a non-ADMIN without `CREDIT_VIEW` is denied before the screen mounts.

The route shall be reachable by direct URL, browser refresh, Back/Forward and a Sales & Customer
launcher tile. This is a tile inside the existing domain, not a new top-level domain or a second mobile
navigation system. Reachability must not depend on `customers`, `CUSTOMERS_VIEW` or
`CREDIT_MANAGE`. Mobile and desktop use the same route identity, screen and backend contracts.

The route shall support a detail target for one `checkResultId`; unknown and unauthorized targets must
produce the same non-enumerating result. URL values never grant access.

### 4. R-U3-2 — CREDIT_VIEW-only selector projection

U3 requires one minimum read-only selector projection because `GET /api/credit/profiles` returns the
complete Profile DTO, lacks customer display names and has no selector-specific grouping/pagination
contract. The selector must be usable by an account that has `CREDIT_VIEW` but has neither
`CUSTOMERS_VIEW` nor `CREDIT_MANAGE`.

The projection shall return only the fields needed to choose an authorized Credit query context:

```text
customerId, customerCode, customerName, customerActive,
creditObjectType, creditObjectId, availableScopeTypes
```

It may join `customers` only for `code`, `name` and `active`; it must not expose contact, phone,
address, payment terms, creator, rule, rating, limit or other customer/Profile management data. It
must run the canonical Credit Read Scope predicate before grouping, search, count and pagination. It
must never fetch an unrestricted customer list and filter it in the browser.

The selector groups all visible Profile versions by the stable
`customerId + creditObjectType + creditObjectId` business key. A requested `businessDate` selects
effective Profile versions only; the authorization decision still uses the server's current date.
Default date is the server current business date. Historical/expired versions may appear only when
they are effective on the explicitly requested historical date and still visible under current
authorization. Duplicate versions for the same effective scope fail closed with the existing
`CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` semantic rather than being silently collapsed. Aggregate and own
Sub-Limit availability are reported as scope types, never as an authorization promise.

Search is bounded to customer code/name and Credit Object identity. Pagination has stable ordering,
authorized `total`, bounded `limit` and non-negative `offset`. Selected-value hydration, when supported,
must use the same authorization and date predicate; unknown and unauthorized identities are
indistinguishable. The endpoint is GET-only and zero-write on both SQLite and MySQL.

### 5. R-U3-3 — SC101 current exposure query

The screen shall require an authorized selector option, an explicit Credit Check `stage` and a query
`businessDate`; changing customer, Credit Object or business date resets stale exposure, selected
history detail and pagination. It calls the frozen `GET /api/credit/exposure` with exact
`customerId`, `creditObjectType`, `creditObjectId`, `businessDate`, `stage`, and an optional visible
`salespersonId` only when the user selects one.

The result shall display Customer Aggregate and authorized Salesperson Sub-Limit as separate scopes.
For each scope it shall show limit, used, remaining, unlimited/over-limit state, the four canonical
components, ambiguous attribution, fact counts and the complete per-scope computed policy identity.
Amounts are rendered from safe integer cents without changing arithmetic. Current exposure is labelled
as a live query at the selected date/stage; it is never labelled as the historical Check result.

Loading, empty, denied, network/error and retry states are distinct. `CREDIT_PROFILE_MISSING` means no
effective authorized Profile and must never be displayed as zero limit. A response that omits a hidden
Sub-Limit must not reveal that the hidden Profile exists.

### 6. R-U3-4 — SC102 exception history and detail

The same screen shall provide a dense history list and a separate detail surface. Server-side filters
cover all five exact categories, decision, scope type, stage, business-date range, customer and approval
association. Category overlap is legal. Pagination uses backend `total`, `limit` and `offset`; pages
must not overlap or expand the authorized set.

List/detail shall expose the stored historical Check identity, decision, reason codes, historical
breakdown, source identity, approval association, policy/profile hashes and overdue evidence. The UI
must distinguish:

- `PROVEN_OVERDUE` — proven overdue; partial evidence must be labelled non-exhaustive;
- `PROVEN_NOT_OVERDUE` — proven not overdue;
- `UNKNOWN` — evidence missing/incomplete and never rendered as normal or not overdue.

Out-of-scope and absent detail remain the same 404 presentation. The screen must not infer history from
live AR, recompute a historical decision or expose private overdue `sourceFacts`.

### 7. R-U3-5 — Exception Detail → Current Exposure context

For an authorized exception, U3 shall resolve the immutable historical context through its existing
`creditProfileId` and the existing scope-protected `GET /api/credit/profiles/:id`. That response already
provides `customerId`, `creditObjectType`, `creditObjectId`, `scopeType` and `salespersonId`; therefore
no extension to the frozen Exception DTO is required.

The detail surface shall display historical `businessDate`, `stage`, `checkGroupId` and `checkResultId`
in a section explicitly labelled historical. “Query current exposure” creates a new current-query
context from the authorized Profile business identity, uses a separately visible current/default query
date and an explicit stage chosen by the user, and then calls the frozen exposure endpoint. It never
copies historical amounts into the current result and never substitutes today's Profile identity for
the historical Check Profile.

Profile Detail keeps current authorization and 404 non-enumeration. A revoked membership may therefore
remove a historical Sub-Limit from view even when a URL contains its id. An expired historical Profile
may still explain the authorized historical identity, but if no effective Profile exists for the new
query date the current exposure call must show `CREDIT_PROFILE_MISSING`; it must not fabricate or fall
back to another Profile.

### 8. R-U3-6 — Mobile-first interaction and presentation

The primary design width is 390 CSS px and Acceptance must also cover 320, 430 and 680. The task flow
is `QUERY CONTEXT → EXPOSURE` and `HISTORY LIST → DETAIL → CURRENT EXPOSURE`; there is no editor or
mutation action. Mobile uses one column, compact object/status headers, continuous dense rows and
progressive disclosure instead of shrinking a desktop table or wrapping every field in a card.

Frequently used context controls remain visible; secondary history filters open in one bottom sheet or
full-width mobile filter surface, never stacked modals. Active filters are clearable. Primary touch
targets are approximately 44×44 CSS px. Long IDs wrap/copy without causing page-level horizontal
scroll; amounts use tabular alignment; dates and status include text, not color alone. Loading
skeletons resemble the final layout, empty states state the next useful action, and sticky/fixed UI
must not cover content or ignore safe-area insets.

At 680 px the same canonical screen may use two coordinated regions where useful, but it keeps the
existing 680 px application rail and does not introduce a second design system, layout shell, API
client or permission hook.

### 9. R-U3-7 — Negative, security and acceptance contract

Acceptance must execute, not merely mock, the following matrix:

1. CREDIT_VIEW-only, ADMIN, CROSS_GROUP, AGGREGATE_ONLY, AGGREGATE_PLUS_SELF and DENY;
2. unknown/unauthorized customer or Profile, missing current Profile and revoked self membership;
3. historical Check versus current exposure with visibly separate dates, stages, identities and amounts;
4. all five categories, legal overlap, OVERDUE UNKNOWN/PARTIAL/PROVEN, complete pagination and total;
5. detail absent/out-of-scope 404 equivalence and URL/query tampering with no frontend authorization bypass;
6. direct URL, launcher, deep link, Back/Forward and refresh state restoration;
7. loading, empty, network, validation, denied and server-error recovery;
8. 320/390/430/680 widths, keyboard/focus, accessible names, comfortable touch targets and no unintended
   page-level horizontal overflow;
9. all U3 GET paths remain zero-write and the frozen U2/OVERDUE suites remain green;
10. SQLite/MySQL parity for the new selector projection because it is a new backend contract.

Browser fixtures must come from the real backend contract; frontend-only hidden controls and mock data
cannot prove authorization. U3 must not change Credit Decision, Finance truth, CSP/CCHK, ONE_TIME,
OVERDUE evidence writers, Schema/Migration or release identity.

### 10. Requirement result and next boundary

The Requirement closes the route, selector, context-flow, responsive and negative/security decisions
without reopening frozen Credit semantics. The only necessary forward backend addition is the bounded
CREDIT_VIEW-only selector projection; Exception → Exposure needs no frozen DTO change.

**Requirement status: `W11_A_U3_CREDIT_QUERY_UI_REQUIREMENT_CLOSED`.**

Per the same consecutive authorization, the next phase is bounded Design. Requirement changed only
`document.md` and the append-only `log/2026-10-29.md`; it changed no implementation or test file and
performed no database, test or Git write.

---

## W11-A U3 Selector Protected MySQL Gate — Bounded Requirement Amendment (2026-10-30)

### 1. Authorization, baseline and reuse of the existing audit

The user authorized one consecutive sequence for this stage: review the existing U3-C2 readiness audit,
confirm or amend the Requirement, confirm or amend the Design, review implementation and execution
readiness, and then hard stop. Real MySQL, the MySQL gate implementation, any MySQL connection or reset, a
new integration suite or runner, a `package.json` or test-registry change, production code, the real MySQL
gate, any Git write, Final Acceptance/Freeze and Release/Deploy were explicitly not authorized and did
not happen.

The baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and the 26 existing U3
authorized worktree paths. The U3-A, U3-B and U3-C implementation and test evidence are preserved.

The gate design already exists in `solution.md` §37.54.35.7. This Requirement does not restate it and
does not create a parallel contract. It confirms that the audit is sufficient as the design basis and
adds only the business truth that the audit left open: the exact subject of the gate, the parity
strictness taxonomy, the protected-target business contract, the one undefined business semantic, and
the acceptance boundary.

### 2. R-U3-GATE-01 — The subject of the gate and the business matrix it must prove

The gate verifies exactly one surface:

```text
GET /api/credit/query-options
```

It must prove, on a real MySQL 8 target and against the same production fixture on SQLite:

1. the five-level Credit Read Mode projection — `ALL`, `CROSS_GROUP`, `AGGREGATE_PLUS_SELF`,
   `AGGREGATE_ONLY`, `DENY` — each with its own expected authorized option set;
2. that a `CREDIT_VIEW`-only account receives the selector projection without `CUSTOMERS_VIEW` and
   without `CREDIT_MANAGE`;
3. that no account without the Credit Read Scope receives any customer identity;
4. the authorized Customer projection, namely exactly
   `customerId, customerCode, customerName, customerActive, creditObjectType, creditObjectId,
   availableScopeTypes`, with no contact, phone, address, payment terms, creator, rule, rating or limit
   field;
5. multiple Credit Objects for one customer, each remaining a separate logical option;
6. the effective Profile date logic, namely that a requested business date selects effective Profile
   versions only while the authorization decision keeps using the server's current date;
7. that a revoked self membership is not restored by a historical business date;
8. the search boundary over customer code, customer name and Credit Object identity;
9. the grouping of all visible Profile versions by the stable
   `customerId + creditObjectType + creditObjectId` business key, with aggregate and own sub-limit
   availability reported as scope types;
10. that the logical `total` and the returned list describe the same authorized set, and that the
    pagination is stable and non-overlapping;
11. the stable ordering of the option list across repeated reads and across pages;
12. that duplicate effective versions of the same effective scope fail closed with the existing
    `CREDIT_PROFILE_EFFECTIVE_AMBIGUOUS` semantic instead of being silently collapsed;
13. the SQLite/MySQL parity of every one of the above;
14. that every measured GET is zero-write and repeatable.

The gate must not collapse these fourteen items into one unqualified smoke assertion. Each item must
carry its own expected business result, its own unauthorized result, its own count and list assertion
and its own zero-write assertion.

### 3. R-U3-GATE-02 — The protected target business contract

The real execution may only use the existing protected disposable MySQL environment. The following must
hold and must fail or block the gate when they do not:

- the target identity preflight proves the live server UUID, the current account and the grants
  fingerprint against the pinned baseline;
- the MySQL 8 version policy holds;
- the initial schema inventory is empty before the first suite;
- the protected reset authorization is present, and the destructive operation set is exactly the
  approved one;
- the machine-wide exclusive lock is held, so no second schema-clearing gate can run against the same
  target at the same time;
- the TAP transcript of every suite is validated strictly;
- the cleanup is deterministic and the five object categories are re-counted on a fresh session;
- the final object inventory is zero.

It is forbidden to bypass this contract by re-pinning the reset authorization fingerprint, by creating a
new test database, by changing the MySQL instance or by relaxing any of these checks. A drifted identity
is never re-authorized automatically.

### 4. R-U3-GATE-03 — The parity strictness taxonomy

Every compared value belongs to exactly one class, and the class determines how it may be compared:

| Class | Meaning | Comparison rule |
| --- | --- | --- |
| Real business expectation | authorized projection, grouping, logical count, pagination partition, effective-date selection, ambiguity decision, zero-write | strict equality between the engines and against the stated expectation |
| Test environment difference | a fact that one engine cannot represent at all, for example two business identities that differ only by case or accent under a case- and accent-insensitive unique key | the difference is recorded and excluded from the business assertion; it is never a business result |
| Random technical identity | generated Profile ids, anchors, request ids | only the stable business key is compared; the raw technical id is never compared |
| Acceptable database implementation difference | a documented collation or folding behaviour that the business contract does not define | measured on both engines and reported; it must never widen the authorized set |
| Unacceptable business semantics difference | any difference in the authorized set, the logical count, the grouping result, the pagination partition, the effective-date selection, the ambiguity decision or the zero-write guarantee | the gate fails |

Normalisation is allowed only after each engine has independently satisfied the complete contract. A
business identity, a permission outcome, an amount, a classification, a grouping result and a pagination
partition must never be normalised away.

### 5. R-U3-GATE-04 — Case and accent semantics are an open business decision

The business contract does not define whether customer codes, customer names and Credit Object identities
are matched case-insensitively only, or case- and accent-insensitively, and it does not define the
ordering rule for display values.

The current implementation matches with `LOWER(...) LIKE LOWER(...)`. On SQLite the `LOWER` function folds
ASCII only, while the target MySQL 8 stores and compares the same columns under a case- and
accent-insensitive collation. The two engines therefore answer differently for the same query when the
matched business text contains a non-ASCII accent or a non-ASCII case letter.

This is recorded as an open business decision, `待决`:

- the gate must not assert cross-engine equality on this undefined dimension, because that would freeze a
  business truth that no Requirement defines;
- the gate must not silently skip the dimension either. It must measure the divergence on both engines
  and report it as a typed finding, next to the invariant that holds on both engines: the returned option
  set never leaves the authorized set, and the count never exceeds the authorized count;
- the decision must be taken at Requirement level, with the business owner, before the U3 capability is
  frozen. The U3 Freeze stays blocked while this decision is open;
- the gate must not change the Selector DTO, the Selector business semantics or the collation of any
  column to remove the divergence.

The same open decision covers the ordering of the option list. The gate must assert a stable order on
the defined ASCII business identities, and must report the observed MySQL order for the undefined
dimension instead of asserting it.

### 6. R-U3-GATE-05 — Prohibitions and the escalation rule

The gate must not modify the Selector DTO, the existing Selector business semantics, SC101, SC102, the
Credit Check decision, the Credit Scope Resolver, the OVERDUE evidence, the CSP/CCHK identity, the
ONE_TIME approval semantics, the schema or any migration.

If the gate finds a contradiction between the production semantics and this Requirement, it records the
contradiction as a finding and returns it to Requirement and Design. It must not repair the production
code, and it must not weaken an assertion, add a skip or a todo, or lower a test classification to make
a run green.

### 7. R-U3-GATE-06 — The acceptance boundary of the gate

The gate produces cross-engine evidence for the Selector surface. It is not an acceptance of the U3
capability and it does not freeze anything.

The existing evidence stays exactly as it is: the U3-C browser acceptance PASS, the original B06 FAIL
with its preserved screenshot and failure JSON, the B06 fix evidence, the FAST 500/500 result, the FULL
3046/3046 result and the 1966-module build. None of those SQLite or browser results may be described as
a real MySQL pass, and a real MySQL pass of this gate may not be described as an acceptance of the U3
capability. The final acceptance and the Freeze remain a separate user decision.

### 8. Requirement result and boundary

Requirement for the W11-A U3 Selector Protected MySQL Gate is closed, with one explicitly registered
open business decision in §5 that the gate is designed to measure rather than to decide.

**Requirement status: `W11_A_U3_MYSQL_SELECTOR_GATE_REQUIREMENT_CLOSED`.**

## W11-A U3 Search Semantics Closure — Bounded Requirement Amendment (2026-10-30)

### 1. Authorization and boundary of this record

The user adjudicated the two open search semantics that blocked the U3 Final Freeze and authorized one
consecutive sequence: a targeted semantic audit, a bounded Requirement amendment, a bounded Design
amendment and an acceptance-impact and test plan. The Design ends the sequence with a hard stop.

Not authorized and not performed: a modification of production code, a modification of a test, a
fixture or a runner, a schema or migration change, a MySQL execution, a re-run of the protected gate,
a Git write, an Acceptance/Freeze, and a Release/Deploy.

The baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and exactly the 30
authorized U3 worktree paths. The U3 Implementation, the U3-C browser acceptance, the MySQL E3 10/10
execution and its raw evidence are preserved unchanged.

### 2. The adjudicated policies

**POLICY-01 — Customer Name Search.** The customer name search shall be case-insensitive,
accent-insensitive, Unicode-aware and shall return the same result set on SQLite and on MySQL.

**POLICY-02 — Literal Search.** The ordinary search box of the Credit Query Selector shall perform a
literal containment match. The user input `%`, `_` and `\` shall be treated as ordinary characters and
shall never act as a SQL wildcard or as an escape operator. This rule applies to the four search fields
the Selector supports today: the customer code, the customer name, the Credit Object type and the Credit
Object identity. It shall not be extended into a regular expression search, a fuzzy ranking or a full
text retrieval.

### 3. R-U3-SEARCH-01 — The customer name search semantics

The customer name search shall satisfy all of the following, on both engines, for the same stored
business fact:

1. **Case-insensitive.** A name written in any case is found by a query written in any case, including
   the Latin, the extended Latin and the Greek case mappings.
2. **Accent-insensitive.** A name written with diacritics is found by a query written without them, and
   the other way round.
3. **Unicode-aware.** The case mapping and the accent folding shall cover the full Unicode repertoire of
   the supported text, not only the ASCII range. The SQLite `LOWER` function folds ASCII only and the
   MySQL default comparison folds case and accents; neither may be relied upon.
4. **Engine-consistent.** The same query against the same stored fact shall select the same rows on
   SQLite and on MySQL. The result must not depend on the collation of the column, on the default
   collation of the connection or on the escape semantics of the engine.
5. **Non-Latin text stays queryable.** Chinese, Japanese, Korean and other non-Latin text shall remain
   searchable exactly as stored. The folding shall never remove or replace a non-Latin character, and
   the folding of a non-Latin name shall stay stable under the Unicode normalization forms.
6. **Multi-character and prefix queries.** A containment match over several characters shall behave
   identically to a single-character match. The existing prefix behaviour of the customer code and the
   containment behaviour of the customer name shall be preserved.

### 4. R-U3-SEARCH-02 — The literal search semantics

1. `%`, `_` and `\` in the user input shall match only themselves. A query containing `%` shall not
   select every row; a query containing `_` shall not select every row; a query containing `\` shall not
   escape the following character.
2. The rule applies to all four supported search fields and to both the prefix and the containment
   position of the pattern.
3. The escape character of the implementation is an implementation detail. It shall never appear
   unescaped inside a pattern, so that a user input can never act as an escape operator.
4. The literal rule shall not weaken the case, accent and Unicode rules of R-U3-SEARCH-01. A literal
   pattern still matches case-insensitively and accent-insensitively.

### 5. R-U3-SEARCH-03 — The search identity boundary

The search is a matching rule of the Customer Selector Projection. It is not a rule of the customer
master data identity and it shall not change any of the following:

1. the seven-field Selector DTO, its field set and its meaning;
2. the exact identity filter of the selector, which compares the customer, the Credit Object type and
   the Credit Object identity for equality and which shall stay an equality comparison;
3. the customer identity, the customer code uniqueness, the Credit Object identity and every other
   write-side constraint;
4. the canonical Credit Read Scope predicate, its modes, its effective date and its scope projection;
5. the grouping of the Profile versions into logical options;
6. the logical count, the ordering and the pagination contract.

A search shall never widen the authorized data range. A query that matches nothing authorized returns
the empty authorized page, exactly like today. The search key that the implementation may need is a
derived matching artifact and shall never become an identity, a uniqueness constraint or a source of
truth for any business value.

### 6. R-U3-SEARCH-04 — The acceptance contract of the changed search

1. The logical count and the returned list shall continue to describe the same authorized set, and the
   count shall equal the number of rows of the filtered set.
2. The complete pagination of the filtered set shall remain available and shall not overlap or omit a
   row.
3. The stable ordering shall remain stable. The existing ordering rule shall not be changed by this
   amendment.
4. The selected-value hydration of the exact identity filter shall keep its existing authorization and
   date predicate, and an unknown identity and an unauthorized identity shall stay indistinguishable.
5. Every measured search GET shall remain zero-write.
6. The refused-input contract shall remain: an over-long query text, an invalid pagination value, an
   invalid business date and an incomplete identity stay refused with the existing codes.

### 7. R-U3-SEARCH-05 — The supported range and the documented language boundaries

The folding is a technical definition, not a new business rule. Its supported range and its boundaries
shall be documented and shall not be presented as a linguistic guarantee:

1. The folding covers the Unicode repertoire of the text that the ERP stores. The exact repertoire
   depends on the Unicode version of the runtime, which is shared by both engines, so the two engines
   always agree.
2. The case mapping is locale-independent. The Turkish dotted and dotless I, the German sharp S and the
   Greek final sigma are folded consistently and identically on both engines.
3. The accent folding removes the non-spacing marks only. The spacing marks of the Indic and the Thai
   scripts are kept, because they carry the structure of those scripts rather than an accent.
4. Characters that exist only in a compatibility form, and characters outside the repertoire of the
   runtime, are folded as far as the runtime allows and are not guaranteed to be equivalent to their
   canonical form.
5. The two policies do not define, and this amendment does not define, any language-specific
   equivalence beyond the rules above. A business owner who needs one must state it explicitly.

### 8. R-U3-SEARCH-06 — The retest and evidence obligations

1. The S10 measurement of the Selector gate becomes an assertion once the two policies are implemented.
   The four measured divergences shall disappear, and the gate shall fail if any of them reappears.
2. The literal search cases shall be added to the gate and to the SQLite suite.
3. The protected MySQL gate shall be re-executed after the implementation, with its own campaign and
   its own evidence. The existing execution evidence is preserved and is never overwritten.
4. The browser acceptance of the selector search shall be re-run for the affected scenarios.
5. The evidence presentation defects found in the last execution shall be corrected in the same future
   implementation. The original TAP transcript and the original evidence JSON keep their SHA-256 and
   their content.

### 9. Requirement result

The Requirement for the W11-A U3 search semantics closure is closed. The two policies are formalized
above, the identity boundary and the acceptance contract are preserved, and the supported range of the
folding is documented.

The realization of the two policies inside the current code and schema boundary requires a bounded
schema and migration amendment. That amendment is declared, sized and justified in the Design and is
not implemented in this stage.

**Requirement status: `W11_A_U3_SEARCH_SEMANTICS_REQUIREMENT_CLOSED`.**

## W11-A U3 Search Semantics — Final Bounded Design Correction, Requirement Amendment (2026-10-30)

### 1. Authorization and boundary of this record

The user approved one final bounded correction of the search semantics design: the Search Ordering
Requirement amendment, the Unicode Folding Safety correction, the Search Key Migration and Writer
completeness closure, and the final implementation whitelist verification. The user additionally
approved the business policy that the U3 Selector adopts a logical ordering that is deterministic across
SQLite and MySQL, with the goal of a stable pagination and a repeatable identical result set.

Only the Requirement and the Design are authorized. No production code, schema, migration, test, MySQL
execution, Git write, Acceptance, Freeze, Release or Deploy is authorized and none happened. The whole
U3 audit was not redone. The existing R-U3-SEARCH-01 to R-U3-SEARCH-05 and the Search Semantics Design
are reused; no parallel requirement system is created.

The baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, version `1.6.2`, an empty index and exactly the 30
authorized U3 worktree paths.

### 2. R-U3-SEARCH-07 — The deterministic search ordering

The Selector shall order its logical options by a deterministic logical order that is identical on
SQLite and on MySQL for the same effective business facts.

1. The primary order key is the Search Fold Key of the customer code.
2. Options whose Search Fold Keys are equal are ordered by the byte-level comparison of the stable
   original identity. The original customer code bytes come first, then the original customer identity
   bytes, then the normalized Credit Object type, then the normalized Credit Object identity, and
   finally the original Credit Object identity bytes.
3. Several Credit Objects of one customer form a complete and stable order by the normalized type, the
   normalized identity and the original identity bytes.
4. Every order field shall be compared with an explicitly pinned byte-exact collation. The default
   collation of a column, of a connection or of an engine shall never decide the order.
5. The order shall never depend on a generated technical identity and never on an insertion order.
6. The resulting order shall be a total order over the logical options, so that the page boundaries
   are identical on both engines and a page slice is reproducible.
7. The following cases shall be handled explicitly: two customer codes whose Search Fold Keys collide,
   two customer codes that differ only in their original case, two customers that share a display name,
   one customer with several Credit Objects, and the page boundary between two pages.
8. This amendment changes the presentation order of the Selector only. The customer identity, the Credit
   Object identity, the authorization predicate, the logical grouping and the authorized result set are
   unchanged.

### 3. R-U3-SEARCH-08 — The Unicode folding safety correction

The folding shall keep the case-insensitive, the accent-insensitive for the explicitly supported accent
forms, the Unicode-aware and the engine-consistent properties of R-U3-SEARCH-01, and it shall keep the
Chinese and the other non-Latin text searchable, and it shall stay deterministic across the engines.

1. The folding shall not remove the Unicode non-spacing marks indiscriminately. A non-spacing mark shall
   be removed only when it is a diacritic of a Latin-script letter.
2. The supported accent forms are therefore the combining marks of the Latin script: the acute, grave,
   circumflex, diaeresis, tilde, macron, breve, caron, cedilla, ring, ogonek and the Latin letters that
   carry them, including the precomposed forms of the Latin-1 and the Latin Extended-A repertoire.
3. The marks that carry meaning in another script shall be preserved, and shall not be presented as a
   harmless loss. This covers the Devanagari virama and the other Devanagari marks, the Thai tone marks
   and the other Thai marks, the Hebrew niqqud, the Arabic harakat, the Greek tonos and the Cyrillic
   breve. Two names that differ only by one of those marks shall not be folded together.
4. The folding shall be locale independent. The Turkish dotted and dotless I, the German sharp S and
   the Greek final sigma shall be folded consistently and identically on both engines.
5. The folding shall be stable across the Unicode normalization forms, so that the composed and the
   decomposed form of the same text produce the same key.
6. A mixed string of Latin and non-Latin text shall fold each part under its own rule, so that the
   non-Latin part stays searchable and the Latin part stays accent-insensitive.
7. The folding shall carry an explicit algorithm version. A change of the algorithm or of the Unicode
   repertoire of the runtime shall invalidate the stored keys, and the recomputation of the stored keys
   shall be an explicit, repeatable and idempotent operation that the operator triggers.
8. The known loss of meaning shall be disclosed and not hidden. The folding merges the Latin-script
   words that differ only by an accent, and that includes the Vietnamese syllables that differ only by
   their tone, because the tone marks of the Vietnamese are the same combining marks as the European
   accents. The search key is a derived matching artifact and no business value, identity or stored text
   is changed by this merging.

### 4. R-U3-SEARCH-09 — The literal LIKE contract in concrete form

POLICY-02 continues to apply. The implementation shall make the following concrete:

1. `%` is a literal character in the user input.
2. `_` is a literal character in the user input.
3. `\` is a literal character in the user input.
4. The dedicated escape character, `!`, escapes itself, so a user input can never act as an escape
   operator.
5. The statement carries an explicit `ESCAPE '!'` clause.
6. The prefix position of the customer code and of the Credit Object type and the containment position of
   the customer name and of the Credit Object identity are unchanged.
7. The MySQL SQL mode shall never change the result of a business search. The explicit escape clause and
   the byte-exact comparison make the pattern interpretation independent of the mode, and the live
   retest shall prove it.
8. The exact identity filter stays an equality comparison and is not affected by the literal rule.

### 5. R-U3-SEARCH-10 — The search key lifecycle and the writer completeness

The search key is a derived matching artifact. It is never a new identity field.

1. The lifecycle shall be proven for all of the following: the fresh SQLite initialization, the additive
   SQLite migration, the fresh MySQL bootstrap, the live MySQL migration of an existing deployment, the
   demo seed, the API customer create and update, the customer CSV import, the Credit Profile creation
   and its versioning, the idempotency replay, an interrupted and retried migration, the detection of a
   missing or a stale search key, and the completeness of the backfill before the Selector search
   becomes available.
2. Every write entry point that creates or changes a searchable business value shall maintain the
   corresponding search key in the same operation. The audit shall be based on the actual statements and
   not on the file names.
3. A missing or a stale search key shall be detected and reported. It shall never be repaired by a
   write on a read path. The Selector search remains a strictly zero-write read.
4. A migration or a backfill failure shall not be swallowed. It shall fail loudly and leave the
   deployment in a state that the operator can see.
5. The backfill shall be batched, idempotent and restartable after an interruption.
6. The upgrade ordering shall guarantee that the columns exist and that the backfill has completed
   before the Selector search is reachable.
7. The version compatibility of the stored keys shall be tied to the folding algorithm version, and the
   recomputation strategy of §3.7 shall be documented for the operator.

### 6. R-U3-SEARCH-11 — The frozen contract impact

The design shall distinguish and state each of the following separately:

A. the schema change of the new derived search columns;
B. the frozen Credit Profile business fields and the permission behaviour;
C. the existing frozen W11-SEC, U2 and OVERDUE tests;
D. the MySQL bootstrap and migration impact;
E. the new business behaviour of the Selector itself.

The following shall not be modified: `server/modules/credit-scope.js`,
`server/modules/credit-check.js`, `server/modules/credit-query.js`,
`server/modules/credit-special-approval.js`, the protected MySQL launcher, the shared runner support,
the frozen U2 E3 suite, and the existing Credit Decision and Exposure DTOs. The search key shall never
change the authorization scope, the credit check or any historical evidence. If the compatibility cannot
be proven, the design is blocked.

### 7. R-U3-SEARCH-12 — The acceptance matrix

The future implementation and acceptance shall cover, at minimum: the fourteen SQLite search cases, the
S01 to S10 gate cases under the new semantics, the fresh and the upgraded SQLite database, the fresh and
the upgraded MySQL database, the Unicode and the literal search, the search key backfill, every writer
path, the search ordering, the exact pagination slices, the five Credit Read Modes, the exclusion of the
unauthorized customer, the zero-write invariant, the browser at 320, 390, 430 and 680, the existing
frozen regression, FAST, FULL and the build, and the protected MySQL cleanup.

The existing real MySQL E3 PASS evidence is preserved. The future retest shall use a new evidence
directory, the real protected launcher and its own independent execution authorization.

### 8. Requirement result

The Requirement of the final bounded correction is closed: the deterministic ordering, the folding
safety, the literal contract in concrete form, the search key lifecycle and the writer completeness, the
frozen contract impact and the acceptance matrix are all stated.

**Requirement status: `W11_A_U3_SEARCH_SEMANTICS_FINAL_REQUIREMENT_CLOSED`.**

## W11-A U3 / Wave 9 Exact Additive Schema Compatibility — Requirement Amendment (2026-10-30)

### 1. Authorization, baseline and scope

The user authorized two consecutive governance stages under AGENTS.md §4.0: this bounded Requirement
amendment and the following bounded Design amendment. The authorization preserves the implemented U3
Search Semantics worktree and permits changes only to `document.md`, `solution.md` and the real-date
append-only log. It does not authorize production/test code changes, migration execution, SQLite/MySQL
database changes, FAST/FULL/build, Git writes, Acceptance/Freeze, release or deployment.

The verified baseline is branch `work/sales-waves6-13-recovery-20261025`, HEAD
`8c716f64dbeb8d650c3dd87a43661ed205fdcfdd`, package version `1.6.2`, empty index and 38 worktree paths.
The current protected identities are:

- `server/migrations/sales-customer-wave9-credit-foundation.js`:
  `87d4a6628b68645cc7ce743aaa7bf5e4244b6c9c0a3a91df1f33796ec1de4f32`;
- `server/modules/credit-check.js`:
  `6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`;
- `server/modules/credit-query.js`:
  `24889d82a602cd2cd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`.

### 2. Audited failure identity and root cause

The five failed `scripts/sales-customer-wave11-a-primitives.test.js` identities are:

1. `T4 the snapshot writer persistence behaviour is unchanged`;
2. `T5 the versioned frozen evidence chain preserves V1 and one canonical owner`;
3. `T7 V2 Rule Hash and CSP2 have independent fixed Golden vectors`;
4. `T8 V2 Rule Hash ignores object whitespace/key order but preserves array order`;
5. `T10 the V2 identity chain is independent of the physical JSON rendering the engine stores`.

All five enter `withFixture()`, which first calls `createDatabase()` and therefore completes the U3
Search Key migration to V2, and then explicitly calls `migrateSalesCustomerDomain()` again. The sixth
failed identity is `fresh SQLite and existing SQLite reopen execute through Wave 9 idempotently` in
`server/sales-customer-wave0-migration-runner.test.js`. Its second `createDatabase()` replays Wave 9
against the already-V2 file. Wave 9 throws the same column conflict before the second handle can be
returned; the outer cleanup then encounters that still-open handle and reports `EBUSY`, masking but not
replacing the original Wave 9 failure.

The exact cause is the complete-array equality in both Wave 9 `assertSqlite()` and `assertMySql()`.
The original `credit_profile` contract contains nineteen ordered columns. U3 legally appends
`credit_object_type_search_key` and `credit_object_id_search_key`, so the valid forward schema has
twenty-one columns and is rejected as `credit_profile column identity/order drifted`. No Credit
business primitive, identity, writer, authorization rule or Search result caused these six failures.

### 3. R-U3-W9-COMPAT-01 — The frozen Wave 9 base contract

The Wave 9 base remains exactly six tables: `credit_lock_anchors`, `credit_parameters`,
`credit_check_rules`, `credit_profile`, `credit_policy_snapshots` and `credit_profile_ratings`.
The original nineteen ordered `credit_profile` columns remain:

`id`, `anchor_id`, `customer_id`, `salesperson_scope_key`, `salesperson_id`, `credit_object_type`,
`credit_object_id`, `credit_limit_cents`, `initial_state`, `status`, `rating_grade`,
`rating_effective_from`, `rating_effective_to`, `overdue_day_policy`, `rule_id`, `effective_from`,
`effective_to`, `created_at`, `created_by`.

Their identity, order, business types, nullability, PK, FK, CHECK and indexes remain unchanged. The
other five Wave 9 tables retain exact column-array equality. The original six-table identity, the
GLOBAL Policy Anchor, all original indexes and deterministic replay remain frozen. This amendment may
not weaken or replace any of those checks.

### 4. R-U3-W9-COMPAT-02 — The only approved additive suffix

Only `credit_profile` may carry an additive suffix, and only in this order after the original nineteen
columns:

1. `credit_object_type_search_key`;
2. `credit_object_id_search_key`.

No unknown column, arbitrary superset, missing or reordered original column, replacement column,
reversed suffix, second suffix column without the first, third suffix column, or schema drift on any
other Wave 9 table is compatible. The exception is exact and closed, not a general permission for
future additive columns.

### 5. R-U3-W9-COMPAT-03 — Recoverable schema states

Exactly three ordered column-identity states are recognized by the Wave 9 base validator:

- V0: the original nineteen columns;
- V1: V0 plus `credit_object_type_search_key`;
- V2: V0 plus both approved suffix columns in the approved order.

V1 exists only as an interrupted-migration recovery state. It is not a completed Search Key migration
and must never make Selector search externally available. Any other intermediate state fails closed.
Wave 9 PASS proves only that the frozen base plus the exact approved suffix identity is compatible; it
does not prove the new columns' physical definition, backfill or Search Fold correctness.

### 6. R-U3-W9-COMPAT-04 — U3 completion and service-readiness boundary

The U3 Search Key migration remains the sole owner of the two new columns' physical contract:

- SQLite: nullable `TEXT COLLATE BINARY`;
- MySQL: nullable `LONGTEXT COLLATE utf8mb4_0900_bin`;
- no Search Key index;
- the versioned Search Fold, batched backfill and missing/stale-key verification.

Application readiness requires V2, exact physical definitions, complete backfill and a successful
verification pass. Wave 9 base PASS, U3 migration PASS and permission to serve requests are three
separate conclusions. A caught/ignored schema conflict, V1 alone, V2 with an illegal type/collation, or
V2 with missing/stale values must block startup.

### 7. R-U3-W9-COMPAT-05 — Interrupted and non-transactional DDL recovery

SQLite and MySQL retries shall converge from V0, V1 or V2. MySQL DDL is not assumed to be fully
transactional: if the first `ALTER TABLE` commits and a later statement or backfill fails, the durable
V1 state must be accepted by the Wave 9 base validator and completed by the U3 migration on retry. If
both columns exist but backfill is incomplete, V2 base identity may pass while U3 verification still
blocks service. No migration error may be caught and ignored.

### 8. R-U3-W9-COMPAT-06 — `WAVE9_ADDITIVE_SCHEMA_COMPATIBILITY_EXCEPTION`

The forward exception is governed as follows:

A. The pre-exception Wave 9 migration SHA-256 is
`87d4a6628b68645cc7ce743aaa7bf5e4244b6c9c0a3a91df1f33796ec1de4f32`.

B. That identity rejects the legitimate U3 suffix because its SQLite and MySQL column-name guards
compare the complete arrays to the original nineteen-column array.

C. The only permitted future change is to accept the exact V0/V1/V2 `credit_profile` column-name
shapes defined above in both dialects. No DDL or business behavior belongs to the exception.

D. The original nineteen columns and every existing PK/FK/CHECK/index, physical-type, nullability,
six-table, GLOBAL Anchor and replay check remain unchanged. The other five tables remain exact.

E. The future Implementation whitelist shall be fixed by the approved Design before any code change.

F. The Implementation evidence shall record the new Wave 9 migration SHA-256 and re-verify the frozen
Credit Core SHAs. It shall not claim that the Wave 9 migration SHA stayed unchanged.

G. The old SHA remains the historical identity of the original Wave 9 acceptance evidence. The new SHA
is a forward compatibility revision; it does not rewrite, replace or relabel the old evidence.

H. Before schema deployment, reverting the compatibility code is safe. After a database reaches V1 or
V2, reverting only the validator would make legitimate forward schema unreadable; rollback then means
keeping the compatibility revision or separately authorizing a destructive schema/data rollback. The
preferred recovery is forward completion to V2.

### 9. R-U3-W9-COMPAT-07 — Verification and acceptance

Future Implementation must prove M01–M12: V0 PASS; V2 PASS; V1 accepted then completed; second-only,
reversed, unknown-suffix and original-column drift FAIL; PK/FK/CHECK/index drift FAIL; repeated SQLite
startup PASS; MySQL bootstrap/live replay PASS; interrupted backfill retry PASS; and illegal Search Key
physical definitions FAIL/BLOCKED. It must re-run the six exact failed identities without weakening
their assertions, the original Wave 9 suite, U3 Search SE-01…SE-14, U3-A Selector regression, FAST,
FULL, build, `git diff --check` and the frozen exception manifest. Real MySQL and browser execution
remain separately authorized operations.

### 10. Requirement result

The exact additive compatibility, interruption states, service boundary, frozen exception governance,
rollback boundary and acceptance obligations are closed without changing Credit business semantics or
authorizing code.

**Requirement status: `W11_A_U3_WAVE9_ADDITIVE_COMPAT_REQUIREMENT_CLOSED`.**

## W11-A U3 FAST Dual-Blocker Closure — Bounded Requirement Amendment (2026-10-30)

### 1. Authorization, baseline and scope

The user authorized four consecutive governance stages under AGENTS.md §4.0 for the independent GitHub
source review of the W11-A U3 work: a bounded root cause audit, this bounded Requirement amendment, a
bounded Design amendment and a complete implementation and regression plan, ending in a hard stop. The
authorization permits changes only to `document.md`, `solution.md` and the real-date append-only log. It
does not authorize production or test code changes, migration execution, SQLite or MySQL database
changes, a FAST or FULL rerun, a build, a Git write, Acceptance/Freeze, release or deployment. The real
MySQL verification remains separately authorized.

The verified baseline is branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, package version `1.6.2`, empty index and a clean working
tree. The GitHub review snapshot is WIP, NOT ACCEPTED and NOT FROZEN.

The two blockers under closure are:

1. the Demo Seed inventory regression that breaks the inventory-check approval assertion, and
2. the Vite middleware-server port contention that breaks the FAST gate.

The requirement identities established by this amendment are `R-U3-INV-01` through `R-U3-INV-08` for the
inventory subject and `R-U3-VITE-01` through `R-U3-VITE-05` for the Vite regression subject.

### 2. Audited failure identity and root cause

#### 2.1 The inventory failure

The exact failed assertion is `server/mobile-approval-center.test.js:195`, `inventory check approve
uses the transactional stock adjustment`, which expected `22` and observed `20`. The enclosing suite
`M3R actions reuse existing state machines` failed; the focused file run reproduces 77 pass and exactly
1 fail with `expected: 22, actual: 20`.

The root cause is an initialization-order regression introduced by W11-A U3. Before U3, the Demo Seed
ran inside `seed(db)`, which executes before the late-migration block, so the demo inventory rows
existed when `migrateInventoryPositionSchema(db)` performed its `position_key` backfill and received
their canonical keys. U3 moved `seedDemoData(db)` out of `seed(db)` to `server/db.js:551`, after
`migrateInventoryPositionSchema(db)` at `server/db.js:516`, so the demo inventory rows are now inserted
after the backfill has already run. The demo insert at `server/db.js:1849` writes only
`id, warehouse_id, product_id, quantity, updated_at` and never writes `position_key`, so the six demo
inventory rows are created with a NULL `position_key` and are never backfilled on the fresh
initialization path.

The measured physical consequence, reproduced on a disposable SQLite database, is:

- the fresh seeded database holds six active inventory rows and all six carry `position_key = NULL`;
- the canonical default identity for each of the six rows is computable and differs from the stored
  value in every case;
- the approval writer `setInventoryQuantity` resolves the canonical default position, finds no row
  carrying that `position_key`, and therefore inserts a second active inventory row for the same logical
  position instead of updating the seeded row;
- the `(warehouse_id, product_id)` read therefore observes the stale seeded quantity `20` while the
  newly inserted canonical row carries `22`, and one logical position now holds two active inventory
  facts.

The failure is therefore a genuine physical inventory defect and not a test-query ambiguity. The
existing Domain 5 inventory suites never observed it because
`server/phase-e-inventory-approve.test.js` and `server/phase-e-inventory-migration.test.js` deliberately
set `NODE_ENV=production` and therefore exclude the Demo Seed from their fixtures.

The reopen path does not repair the defect. A fresh database that is reopened without an approval does
receive the correct canonical keys, because the migration backfill re-runs and no canonical-key conflict
exists. A database that was already approved and therefore already holds a duplicate does not: the
backfill cannot assign the canonical key because the unique index already holds it, and its documented
fallback writes a synthetic non-canonical key of the form `<canonical key>:fallback<rowid>`. That
synthetic identity is not produced by the canonical primitive, is not the identity of any logical
position, and can never be matched by a canonical writer.

#### 2.2 The Vite failure

The FAST gate emits `WebSocket server error: Port 24678 is already in use`. In the installed Vite
7.3.6, `config.server.ws === false` is the only configuration that creates no WebSocket listener at
all. `hmr: false` alone does not prevent the listener: the middleware mode passes a null HTTP server
into the WebSocket factory, the factory's internal server selection therefore yields a falsy value, the
factory takes its fallback branch, creates a real HTTP server and listens on the fixed default HMR port
24678. Every middleware-mode Vite instance in the test graph that does not set `ws: false` is a port
binder, and independent test-file processes therefore compete for the same port.

### 3. R-U3-INV-01 — The canonical position identity of the Demo Seed

Every active inventory row created by the Demo Seed must carry a `position_key` that is produced by the
single canonical primitive `computePositionKey()` exported by `server/lib/inventory-position.js`. A
second position-key algorithm, a re-implementation of the tuple normalization, a hand-written hash or a
locally derived digest are all prohibited. The canonical primitive and the frozen Domain 5 contract are
not modified by this amendment.

### 4. R-U3-INV-02 — No active inventory row without a legal position identity

A fresh database initialization and a reopen of an existing database must both leave zero active
inventory rows whose `position_key` is NULL or empty. The Demo Seed is a permitted initialization
writer and may not create a row that the canonical position identity cannot express. The canonical
dimension tuple of a seeded row is the default identity: `owner_type = ENTERPRISE`, `owner_id = NULL`,
`stock_status = AVAILABLE`, `bin_id = NULL`, `lot_id = NULL`, `serial_id = NULL`, `active = 1`.

### 5. R-U3-INV-03 — Exactly one canonical active position per logical position

Two or more active inventory rows must never describe the same canonical position identity. This
applies to the seeded rows, to the rows produced by the approval writer and to the rows produced by a
repeated initialization. The Demo Seed may not create a second active row for a position that already
holds an active fact, and the approval writer must therefore find and update the seeded row instead of
inserting a parallel row.

### 6. R-U3-INV-04 — Repeated initialization never overwrites a real business quantity

The Demo Seed must be idempotent. Re-running the initialization against a database that already carries
the seeded rows, including after an approved inventory adjustment has changed their quantity, must not
overwrite, restore or reset that quantity, and must not create an additional row. The canonical key
uniqueness constraint is the authority that prevents a parallel row when the seeded identity already
exists under a different physical row identity.

### 7. R-U3-INV-05 — The approval, transaction, audit, movement and valuation contract is unchanged

The inventory-check approval must continue to run inside its transaction, must continue to re-read the
authoritative inventory state, must continue to write its audit record, its tracked movement, its
inventory transaction, its valuation movement and its system voucher, and must continue to fail closed
when the authoritative state has drifted. The correction is confined to the identity written by the
initialization path. The frozen inventory domain primitives, including `server/lib/stock.js`,
`server/lib/inventory-position.js`, `server/migrations/inventory-position-schema.js` and the approval
handler in `server/app.js`, are not modified.

### 8. R-U3-INV-06 — A read never repairs inventory

No read path, list endpoint, report or approval query may detect an abnormal inventory position and
then repair, merge, backfill or delete it. A read may observe and report, and never writes.

### 9. R-U3-INV-07 — Existing abnormal inventory is detected, never merged and never deleted

An existing database that already carries an abnormal inventory position must be detected and reported.
The detection must cover at least the three observable classes:

1. an active inventory row whose `position_key` is NULL or empty;
2. an active inventory row whose stored `position_key` differs from the canonical identity computed by
   the canonical primitive for its own dimensions, which includes the synthetic
   `<canonical key>:fallback<rowid>` identity produced by the migration fallback;
3. two or more active inventory rows that resolve to the same canonical position identity.

The detection is read-only. It must not merge the duplicates, must not delete a row, must not rewrite a
`position_key` and must not change any quantity. The detection must not be reachable from a read
endpoint and must not be executed as a repair during an initialization that is otherwise allowed to
succeed. An abnormal existing database therefore keeps its abnormal rows, and the operator learns about
them through the reported diagnostic.

### 10. R-U3-INV-08 — The inventory business identity is unchanged

The correction does not change the inventory business identity, the canonical position tuple, the
dimension semantics, the owner validation, the stock-status validation, the bin validation, the frozen
Domain 5 contract, the valuation semantics or the accounting semantics. No new business fact, no new
schema column, no new constraint and no new migration is introduced by this amendment. The existing
migration backfill remains the only writer of `position_key` for pre-existing rows.

### 11. R-U3-VITE-01 — No middleware-mode Vite instance in the test graph binds a TCP port

Every middleware-mode Vite server instance created by any test in the repository test graph must be
configured so that it creates no WebSocket listener and therefore binds no TCP port. In the installed
Vite 7.3.6 the only such configuration is `server.ws: false`, and it must be accompanied by
`server.hmr: false` so that the HMR client is not configured against a transport that does not exist.

### 12. R-U3-VITE-02 — The call-site audit is complete

Every Vite middleware server initialization point in the repository test graph must be enumerated and
classified, and every enumerated instance must be either already free of a port bind or brought to the
free state. An instance that is not registered in the FAST suite must not be exempt: the FULL gate runs
the same independent test-file processes, so a remaining port binder in a FULL-only file reproduces the
same collision there. The audit must record the file, the line, the suite membership and the before and
after configuration of every instance.

### 13. R-U3-VITE-03 — The correction is configuration-only

The correction is limited to the middleware server options of the enumerated instances. It must not
upgrade Vite, must not modify `vite.config.js`, must not change or reassign a port, must not reduce the
test concurrency, must not change an assertion, must not skip or downgrade a test and must not alter
any production source file.

### 14. R-U3-VITE-04 — The exact target configuration

Every enumerated instance that requires correction receives `server: { middlewareMode: true, hmr: false,
ws: false }`. The existing `appType` and `logLevel` options of each instance are preserved. An instance
that already satisfies the target is left untouched.

### 15. R-U3-VITE-05 — The inventory assertion expectation is not renegotiated

The failing inventory assertion keeps its expectation. The expected value `22` is the correct business
outcome of an approved inventory check on a seeded quantity of `20` with a difference of `2`. The
assertion may not be changed to `20`, may not be weakened, may not be skipped and may not be
downgraded. The production defect is corrected, not the expectation. A correction that only changed the
test read, for example by making the test select the canonical row explicitly, is prohibited while a
non-canonical inventory row remains in the database.

### 16. Boundary, prohibitions and the acceptance obligation

The following are prohibited in the future implementation of this amendment:

- modifying the frozen inventory domain primitives, the canonical position primitive, the inventory
  migration, the approval handler or any other production module outside the approved whitelist;
- introducing a second position-key algorithm;
- performing the Demo Seed through an inventory mutation that accumulates a quantity, because the seed
  is not idempotent under accumulation;
- moving the Demo Seed back to its pre-U3 position and thereby breaking the additive Selector Search
  Key migration, whose own writer contract requires the demo customers to write their derived search
  keys in the insert;
- repairing, merging or deleting abnormal inventory during a read or during an initialization;
- changing the expectation of the failing inventory assertion;
- adding a new migration module, a new schema column, a new production endpoint or a new inventory
  business rule;
- an unapproved expansion of the implementation whitelist during the implementation itself.

The acceptance obligation is the seventeen-item matrix recorded in the following Design section, with
one item per letter from `A` to `Q`. The future implementation must produce the exact physical
inventory evidence, not a test-only approximation of it.

### 17. Open decisions

No business decision is left open by this amendment. The customer-name case and accent semantics, the
literal search escape semantics and the residual identity-domain collation difference recorded by the
earlier U3 stages remain exactly as they were and are not addressed, changed or resolved here. The
W11-A U3 Final Freeze stays blocked by those open decisions and by this closure being unaccepted.

## W11-A U3 FAST Dual-Blocker Closure — Implementation Evidence (2026-10-30)

### 1. Authorization and boundary

The user authorized one consecutive bounded Implementation under AGENTS.md §4.0: the Demo Inventory Seed
canonical position fix, the existing invalid inventory detection, the remaining Vite middleware
corrections, the new inventory seed regression suite, the FULL suite registry update, the focused
regression, FAST, FULL, the build, the Edge browser preliminary UAT and the documentation evidence,
ending in a hard stop. Real MySQL, a Git write, Acceptance/Freeze, Release and Deploy were not
authorized and did not happen.

The baseline was branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2` and an empty index. The WIP commit remains
the traceable parent baseline.

### 2. The exact fourteen-path implementation whitelist

The whitelist was extracted item by item from `solution.md` §37.54.43 §4 and executed exactly. The
changed-path set after the implementation is an exact match against the approved list:

| # | Path | Action | Result |
| --- | --- | --- | --- |
| 1 | `server/db.js` | modify | canonical demo position, independent seed verification, read-only detection |
| 2 | `server/spa-navigation-hotfix.test.js` | modify | `ws: false` added |
| 3 | `server/mobile-approval-center.test.js` | modify | `ws: false` added |
| 4 | `server/mobile-application-launcher.test.js` | modify | `ws: false` added |
| 5 | `server/cost-stabilization.test.js` | modify | `hmr: false` and `ws: false` added |
| 6 | `server/m9-final-polish.test.js` | modify | `ws: false` added |
| 7 | `server/v14-e7-two-level-business-overview.test.js` | modify | `ws: false` added |
| 8 | `server/v16-p1-mobile-enterprise-foundation.test.js` | modify | `ws: false` added |
| 9 | `server/v16-p11-mobile-enterprise-visual-refinement.test.js` | modify | `ws: false` added |
| 10 | `server/inventory-demo-seed-position-identity.test.js` | new | 16 cases, 4 suites, registered in FULL only |
| 11 | `scripts/testing/test-suites.js` | modify | one new FULL entry |
| 12 | `document.md` | append | this record |
| 13 | `solution.md` | append | §37.54.44 |
| 14 | `log/2026-10-30.md` | append | the append-only development record |

No fifteenth path was created or modified. The `server/decision-reports.test.js` finding recorded in
§6 is disclosed and deliberately left untouched.

### 3. The Demo Seed root cause and the physical before/after

The root cause was the W11-A U3 initialization reorder: `seedDemoData(db)` runs after
`migrateInventoryPositionSchema(db)`, and the demo inventory insert never wrote `position_key`, so the
six seeded rows could never be reached by the migration backfill.

The measured physical state before the correction, on a disposable SQLite database through the
production `createDatabase` entry point: six active inventory rows, all six with `position_key = NULL`;
the approval writer unable to find the seeded row by canonical position and therefore inserting a
second active row for the same logical position; the approval assertion observing the stale `20`
instead of `22`; one logical position holding two active inventory facts.

The measured physical state after the correction: six active inventory rows, all six carrying the
canonical `position_key` computed by the frozen primitive from their own dimensions, all six storing
exactly the canonical default dimension tuple; the approval updating the seeded row
`seed-inv-warehouse-001-001` in place from `20` to `22`; exactly one active row for the logical
position and no second physical fact; zero NULL position keys.

The correction writes the position key and the six dimension columns explicitly, so the row's stored
dimensions are the literal tuple that was hashed rather than a value inherited from a column default.
The key is produced by `computePositionKey()` from the single canonical primitive; no second identity
algorithm was introduced. The seed remains idempotent under `INSERT OR IGNORE` and was never performed
through an accumulating stock writer, so it writes no inventory mutation log, no inventory transaction
and no valuation movement.

### 4. Independent verification and fail-closed behavior

`INSERT OR IGNORE` suppresses every constraint violation, so the seed carries an independent
verification that reads the physical state after its own write and proves that every demo position is
materialised by a row whose own dimensions describe that position. When the seed cannot establish its
position, the initialization fails closed instead of reporting success, and the database handle is
released so the file is not left locked. A genuine SQL error still propagates and aborts the
initialization.

### 5. Existing abnormal inventory state

The read-only detection classifies three observable classes: an active row whose `position_key` is NULL
or empty; an active row whose stored key differs from the canonical identity computed for its own
dimensions, which is what detects the synthetic `<canonical>:fallback<rowid>` identity; and two or more
active rows that resolve to the same canonical identity. It issues `SELECT` statements only. It never
merges, never deletes, never rewrites a key and never changes a quantity.

The measured historical behavior:

- a legacy NULL position key with no canonical conflict is backfilled by the existing approved migration
  on reopen and produces exactly one physical inventory fact, never two;
- a legacy duplicated position is detected and reported, is never merged, never deleted, the two
  quantities are never summed and never overwritten, no stocktake, adjustment or canonical mutation
  flow is fabricated, and the stale fact keeps a non-canonical identity that no canonical writer can
  match;
- the abnormal rows are preserved as evidence and reported through a structured diagnostic.

### 6. The Vite middleware instances — a newly discovered twelfth instance

The approved Design enumerated eleven middleware-mode Vite instances in ten test files. The
implementation is required to statically re-check all of them, and that re-check found **twelve**
instances in **eleven** files.

The twelfth instance is `server/decision-reports.test.js:831`, which creates its server through a
dynamic `(await import('vite')).createServer({ root: repoRoot, server: { middlewareMode: true, hmr:
false }, appType: 'custom', logLevel: 'error' })` call. The Design's enumeration was built from the
static `createServer as createViteServer` alias and therefore did not match it.

The instance is registered in FULL only, so it never contributed to the recorded FAST failure. It was
**not modified**: it is outside the approved fourteen-path whitelist, the authorization forbids adding
a fifteenth path and forbids modifying unauthorized files, and it explicitly forbids repairing a
WebSocket problem in an unauthorized file.

The measured consequence of leaving it unchanged: with the other eleven corrected, this instance is the
sole holder of port 24678, so it produced no conflict. The concurrent eleven-file Vite run, the FAST
gate and the FULL gate each recorded **zero** port 24678 diagnostics, and the port was free before and
after the run.

The residual risk is real and is registered here: the instance remains a port binder, so any future
middleware-mode Vite test file that omits `ws: false` would collide with it. Closing it requires a
bounded Requirement and Design amendment that adds exactly one path to the whitelist. It is not a
product defect and it does not affect any business contract.

### 7. The previously failing FULL-only regression

The implementation audit found that `server/inventory-position-integration.test.js` was **already
failing** before this correction: its case `inventory additive columns present + position_key
backfilled` asserts that no inventory row carries a NULL or empty position key, and the demo seed
created six such rows. The file is registered in FULL only, which is why the FAST gate never surfaced
it and why the last completed FULL run predates the U3 reorder. The correction restores that frozen
Domain 5 contract and the case now passes.

### 8. The new regression suite and the suite registry

`server/inventory-demo-seed-position-identity.test.js` is registered in **FULL only**, because it
creates disposable SQLite databases and drives the real writers and the real approval HTTP surface,
and therefore does not meet the FAST criterion of a bounded, database-free regression. Its sixteen
cases cover the fresh seed, the canonical key equality, the canonical dimension tuple, the zero-NULL
rule, the 20 to 22 approval, the single canonical active position, the transaction, audit, valuation
and voucher consistency, the reopen and repeated bootstrap idempotency, the legacy NULL, duplicate and
synthetic fallback detection, the read-only guarantee of the detection and the fail-closed seed.

The approval case reads the canonical position by its position key and asserts the original business
expectation of `22`; it never manufactures the quantity, never changes the expectation to `20` and
never weakens an existing assertion.

### 9. Gate results

| Gate | Result |
| --- | --- |
| Focused F1 — inventory, 13 files | 223 tests, 25 suites, 223 pass, 0 fail, exit 0 |
| Focused F2 — all Vite files, 11 files, concurrent | 389 tests, 55 suites, 389 pass, 0 fail, exit 0, zero port 24678 diagnostics, port free before and after |
| Focused F3 — U3 preservation, 15 files | 322 tests, 322 pass, 0 fail, exit 0 |
| FAST | 500 tests, 37 suites, 500 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo, exit 0, zero port diagnostics |
| FULL | 3102 tests, 363 suites, 3102 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo, exit 0, zero port diagnostics, 200 files |
| Build | exit 0, Vite production build succeeded |
| `git diff --check` | pass, no whitespace error |
| Whitelist verification | exact match, 14 of 14 |
| Index | empty |
| Edge browser preliminary | exit 0, B01 through B09 all PASS, 32 responsive entries, 71 requests |

The FAST count of 500 is the original baseline count and was not reduced, reclassified or avoided.

### 10. The browser preliminary coverage boundary

The existing approved Edge browser harness was executed unmodified against the real Vite production
build, the real HTTP server, a disposable SQLite database and the real identities. Its B01 through B09
matrix, the pagination case, the deep link, detail, refresh, back and forward case, the stale-read
protection cases and the 320, 390, 430 and 680 responsive matrix all pass.

The Unicode customer-name search, the literal `%`, `_` and backslash search semantics and the
deterministic ordering are **not** covered by that harness. They belong to the search-semantics
browser plan recorded in `solution.md` §37.54.39 and §37.54.40, whose production implementation was
never completed, and the harness path is outside the authorized whitelist, so it was not modified to
add them. This is disclosed as an uncovered scope, not claimed as a pass.

### 11. Frozen protection and the remaining MySQL boundary

Every frozen identity is byte-identical: `server/modules/credit-check.js`
`6a7f322ae81f860b7066181244c786174bf5dfed5bfcf796db1f32483391c7c1`, `server/modules/credit-query.js`
`24889d82a602cd2cd11807dd11807bbfa163f584b7fb6c13f55f62cdb0d04133b`, `server/modules/credit-scope.js`
`f31033bd75520643c50202c18f640440aacbcde892595efad7d4e0ba2041a3bc`,
`server/modules/credit-special-approval.js`
`04594b3dc01240c5b3addddf50897fbeab54802daf9fbd7d49c5e36cccf289c4`,
`server/lib/inventory-position.js` `970a21e0deeedd2ecba447b15068ecf6392a7a2e097b1ca887954ab40fce0a37`,
`server/lib/stock.js` `9c35beae6e57ebba4e16961ec559e1cd0d113b6ed0684b05749cb6fce8e8d098` and
`server/migrations/inventory-position-schema.js`
`478520f8f3a327b526dc3687eccd0f0753831aa729a98ff7baee1eef588ee224`.

No real MySQL was contacted, no MySQL gate was executed and no MySQL schema was reset, modified or
cleaned. The six MySQL risk classes of the authorization remain open for a separately authorized
real-MySQL verification: the fresh snapshot and demo seed, the existing legacy NULL position, the
existing duplicate position, the synthetic fallback position, the U3 search key collation and
backfill, and the Wave 9 replay compatibility. A local SQLite pass is not a MySQL pass.

### 12. Open decisions

No business decision was taken in this implementation. The customer-name case and accent semantics, the
literal search escape semantics and the residual identity-domain collation difference remain open and
unchanged, so the W11-A U3 Final Freeze stays blocked by them.

## W11-A U3 Final Acceptance Readiness — Bounded Residual Risk Requirement Amendment (2026-10-30)

### 1. Authorization, baseline and boundary

The user authorized one continuous stage: a Final Acceptance Readiness Audit, a bounded Residual Risk
Requirement amendment for a real requirement gap only, and a bounded Design amendment for a confirmed
gap, ending in a hard stop. No Implementation, no real MySQL, no Git write and no Final Acceptance or
Freeze was authorized, and none occurred.

Baseline: branch `review/w11a-u3-fast-blocked-20261030`, HEAD
`60f3fbd169d7b43bbae3824b10b538edef4aeec1`, version `1.6.2`, empty index, the seventeen authorized
changed paths preserved. All completed gate evidence is preserved and is not re-opened, and none of it is
reclassified as failed: FAST 500 of 500, FULL 3102 of 3102, the build, the Edge browser B01 to B12, the
MySQL Selector S01 to S10 at 10 of 10, the S04 Unicode and literal search, the S10 full ordering and
pagination parity, the protected cleanup and the unchanged frozen SHA set. No completed gate result is
extended into an Inventory Domain MySQL acceptance.

The audit found **one real requirement gap**: no Requirement obliges the canonical Demo Inventory
position identity to be verified on the live MySQL target. R-U3-INV-01 to R-U3-INV-08 define that
obligation. The Exact Identity Collation risk was audited against the real production code and is
**already disposed of** by the approved Requirement taxonomy, so no second Requirement is created for it;
R-U3-INV-06 records that audit conclusion and its acceptance obligation.

### 2. R-U3-INV-01 — The Fresh MySQL Demo Inventory identity must be verified on the live target

The local SQLite proof establishes the Demo Seed canonical position contract, but the MySQL side is a
separate physical system with its own column types, its own collations and its own snapshot copy, and it
is unverified. The canonical position identity of the Demo Seed shall therefore be verified on the live
protected MySQL target, in the same disposable environment and under the same protected machinery as every
other MySQL acceptance.

### 3. R-U3-INV-02 — The verification is an independent protected gate

The verification shall be an independent protected gate with its own campaign identity, its own suite
identity, its own lease and its own evidence directory. It shall not be added to the closed Selector E3
suite S01 to S10, it shall not alter any of those test identities, and it shall not modify the protected
runner, the protected launcher, the credential store or the identity baseline. The machine-wide gate lock
shall continue to serialise it against every other gate on the same target.

### 4. R-U3-INV-03 — The eight acceptance cases

The verification shall assert exactly the following eight cases, and every case shall fail on any
difference:

| Case | Subject | Assertion |
| --- | --- | --- |
| M-INV-01 | the fresh MySQL Demo Inventory | exactly six demo inventory rows exist and each carries a canonical `position_key` |
| M-INV-02 | the key against the row's own dimensions | the key recomputed by the canonical primitive from the row's own database dimension tuple is byte-identical to the persisted key |
| M-INV-03 | the key hygiene | no active row carries a NULL, an empty or a synthetic `<canonical>:fallback<rowid>` key |
| M-INV-04 | the logical position uniqueness | no logical inventory position holds more than one active row |
| M-INV-05 | the approval effect | an approved inventory check moves the seeded canonical position from 20 to 22 and updates the original canonical row in place, creating no second row |
| M-INV-06 | the approval write set | the inventory transaction, the audit record, the valuation movement and the accounting voucher are written and mutually consistent |
| M-INV-07 | the idempotency | a reopen and a repeated initialization preserve the real quantity and add no row |
| M-INV-08 | the cleanup | the five object categories are zero after the campaign |

The fixture shall be created by the real production writers and the approval shall be driven through the
real HTTP surface and its real state machine. The comparison shall never be reduced to a subset, the
fixture shall never be shrunk to manufacture a pass and no difference shall be filtered away.

### 5. R-U3-INV-04 — The historical abnormal states are classified and never repaired

The verification covers the **fresh** bootstrap only. It shall never be read as a historical inventory
remediation result. The legacy NULL position, the duplicate canonical position, the synthetic fallback
position and the existing inventory movements and valuations remain registered risks.

Those historical states may only be safely identified and risk-classified. Automatic merging, automatic
deletion, automatic key rewriting, quantity overwriting, quantity summing and the fabrication of
stocktake or adjustment movements are prohibited. The read-only detection is the only permitted handling
of an existing abnormal row, and the frozen Inventory Position migration shall not be modified to
eliminate a symptom.

### 6. R-U3-INV-05 — The cleanup contract

The verification shall satisfy the same five-class zero-object cleanup contract as every other protected
campaign, and a non-zero category fails the gate. No manual cleanup may be used to turn a failed result
into a pass.

### 7. R-U3-INV-06 — The exact identity collation is an accepted residual

The exact identity filter of the Credit Selector compares the customer identity, the Credit Object type
and the Credit Object identity for equality under the collation of the identity columns, which is case-
and accent-insensitive on MySQL and byte-sensitive on SQLite. The audit established that:

1. the divergence is confined to the exact identity filter. The free-text search compares the derived,
   byte-exact search key columns with an explicit escape clause, and it is engine-consistent, which the
   S04 and S10 results prove with zero divergent probes;
2. the comparison that differs is the equality on the customer identity and the Credit Object identity
   under the identity column collation. The Credit Object type cannot differ, because the input is
   normalized to upper case by the production input contract;
3. no wrong business identity can be returned. On MySQL the customer identity primary key, the customer
   code unique key and the Credit lock anchor key unique key are all case-insensitive, so two business
   identities differing only by case cannot coexist, and the anchor shape guard compares the stored shape
   with byte equality, so a case-variant identity is refused on write with a conflict. On SQLite the
   primary key is byte-sensitive, so the comparison is correspondingly exact. Each engine therefore
   resolves inside an unambiguous identity space;
4. the authorization boundary is unaffected. The read scope predicate is conjoined in the same where
   clause and gates every candidate row, its bound value is derived from the server's own salesperson
   record and is written from that same value into the scope key, and the denied mode refuses before any
   query runs;
5. no unauthorized disclosure is possible, because the identity predicate can only narrow the already
   authorized relation. The neutral response for an unknown and for an unauthorized identity stays
   byte-identical on both engines;
6. the business Requirement defines the exact identity filter only as an equality comparison and does not
   define a case policy for it. The approved parity strictness taxonomy already classifies a collation
   behaviour that the business contract does not define as an acceptable database implementation
   difference, with the disposition that it is measured on both engines, reported, and never widens the
   authorized set. That disposition is satisfied.

The divergence is therefore an acceptable and documented residual limitation, and it is accepted as such
only with an explicit business risk acceptance. No engine shall be declared the business authority, the
approved Unicode Search Fold and the literal search contract shall not be modified, and the exact identity
filter shall remain an equality comparison.

### 8. R-U3-INV-07 — The prohibition on widening the acceptance

A pass of the Selector E3 gate or of the Demo Inventory verification shall never be interpreted as an
Inventory Domain MySQL acceptance, as a historical inventory remediation result, or as a W11-A MySQL
acceptance. The remaining MySQL inventory risks stay registered.

### 9. R-U3-INV-08 — The scope of this amendment

This amendment creates no new business fact, no new schema, no new migration, no new business rule and
no new production behaviour. It creates one acceptance obligation and one acceptance disposition, and it
defers the historical inventory remediation strategy to a separate Requirement of its own.
