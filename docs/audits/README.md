# 审计基线索引

> 状态：`ACTIVE`（审计台账索引）
> Owner：Platform（本索引维护）；各审计基线正文的 Owner 由其文件抬头单独声明
> 权威来源：本目录**不是** Requirement、Design 或项目状态的权威来源。当前 Requirement 见
> [`docs/requirements/`](../requirements/)；当前 Design 见 [`docs/design/`](../design/)；
> **唯一**当前项目级进度登记表见 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)；
> Capability 层面的正式覆盖状态见 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。
>
> 本目录登记的是**审计基线**。审计发现**不构成** Capability Verified、Capability Freeze、
> Domain Acceptance、Manual Closure 或 Release Readiness；也不构成任何 Implementation 授权。

## 目录

| 审计基线 | 手册 | Domain | 审计版本 | 审计基准 SHA | 审计状态 | 详细台账 |
|---|---|---|---|---|---|---|
| B3101 / B3121 采购与委外代码审计基线（2026-11-07） | B3101 采购管理、B3121 委外管理 | Procurement & Outsourcing | `v0.2` | `9b9cb09799aa05ccac43d02ac1718083921c6d04` | `PRELIMINARY_STATIC_REVIEW` | [`b3101-b3121-code-audit-20261107.md`](./b3101-b3121-code-audit-20261107.md) |
| B3121 委外核心执行工作面审计（2026-11-10） | B3121 委外管理 | Procurement & Outsourcing | `v1.0` | `bbacab0` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（有界范围） | [`b3121-outsourcing-core-workbench-audit-20261110.md`](./b3121-outsourcing-core-workbench-audit-20261110.md) |
| B3121 域级验收逐项复核（2026-11-10） | B3121 委外管理 | Procurement & Outsourcing | `v1.0` | `1ad7eaf` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（PRC-01..26 / VMI-01..05 / OUT-01..23 共 54 项 + 14 条 Issue 处置） | [`b3121-domain-acceptance-audit-20261110.md`](./b3121-domain-acceptance-audit-20261110.md) |
| Accounting & Analytics 域级能力审计基线（2026-11-10） | B3106 存货核算、B3107 固定资产、B3114 智能会计平台、B3115 总账、B3116 报表、B3117 经营会计 | Accounting & Analytics | `v0.2` | `d9e7319` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（2026-11-11 实施后逐项复核：**42 COVERED / 1 PARTIAL（AA-07）/ 0 MISSING / 1 OUT_OF_SCOPE**；§2 实施前判定保留不变） | [`accounting-analytics-capability-audit-20261110.md`](./accounting-analytics-capability-audit-20261110.md) |
| Planning 计划域级能力审计基线（2026-11-12） | B3120 计划管理 | Planning | `v1.0` | `22ba875` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（PL-01～PL-45 共 45 项：**34 COVERED / 7 PARTIAL / 4 MISSING / 0 OUT_OF_SCOPE**；登记 5 项真实缺陷与 Requirement §30.6 真实 MySQL 条款不可满足的事实） | [`planning-capability-audit-20261112.md`](./planning-capability-audit-20261112.md) |
| Master & Engineering 工程主数据域级能力审计基线（2026-11-12） | B3118 工程数据 | Master & Engineering | `v1.0` | `22ba875` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（§22.18 共 21 项能力：整改前 13 `COVERED` / 5 `PARTIAL` / 3 `MISSING`；整改轮后 **17 `COVERED` / 1 `PARTIAL` / 3 `OUT_OF_SCOPE`**；登记 8 项真实缺陷与文档失真） | [`master-engineering-capability-audit-20261112.md`](./master-engineering-capability-audit-20261112.md) |
| Finance Operations 财务运营域级能力审计基线（2026-11-12） | B3108–B3113 财务运营 | Finance Operations | `v1.0` | `22ba875` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（FO01～FO58 共 58 项：**51 COVERED / 6 PARTIAL / 1 MISSING / 0 OUT_OF_SCOPE**；登记 7 项真实缺陷与 Requirement §33.39 的 15 个真实 MySQL race 因门禁被永久阻断而无法执行的事实） | [`finance-operations-capability-audit-20261112.md`](./finance-operations-capability-audit-20261112.md) |
| Inventory & Warehouse 库存与仓储域级能力审计基线（2026-11-12） | B3104 库存管理、B3105 条码管理 | Inventory & Warehouse | `v1.0` | `7b7c168` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（§32.3 共 44 项能力 INV-01～INV-44：整改后 **30 `COVERED` / 14 `PARTIAL` / 0 `MISSING` / 0 `OUT_OF_SCOPE`**；登记 16 项真实缺陷、2 处文档失真与 6 项残余） | [`inventory-warehouse-capability-audit-20261112.md`](./inventory-warehouse-capability-audit-20261112.md) |
| Manufacturing & Quality 制造与质量域级能力审计基线（2026-11-12） | B3119 生产管理 | Manufacturing & Quality | `v1.0` | `7b7c168` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（§22.19 共 43 项能力：整改前 22 `COVERED` / 15 `PARTIAL` / 5 `OUT_OF_SCOPE` / 1 `MISSING`；整改轮后 **37 `COVERED` / 1 `PARTIAL` / 5 `OUT_OF_SCOPE`**；登记 14 项真实缺陷与浏览器证据去空洞过程） | [`manufacturing-quality-capability-audit-20261112.md`](./manufacturing-quality-capability-audit-20261112.md) |
| Sales & Customer 销售与客户域级能力审计基线（2026-11-13） | B3102 销售管理、B3103 信用管理 | Sales & Customer | `v1.0` | `d70857e` | `FROZEN`（§34.13 共 36 项 Audit Capability CAP-1～CAP-36：整改前 31 `COVERED` / 3 `PARTIAL`（CAP-1、24、27）/ 2 `MISSING`（CAP-34、36）；整改轮后 **36 `COVERED` / 0 `PARTIAL` / 0 `MISSING`**；**域级 Acceptance 与 Capability Freeze 已签发**（`SALES_CUSTOMER_DOMAIN_ACCEPTANCE_PASS` / `SALES_CUSTOMER_CAPABILITY_FREEZE`）；登记 16 项真实缺陷、12 项显式 Supersession、5 项有界判断、9 项随冻结接受的残余与 D-2～D-5 所有者裁定） | [`sales-customer-capability-audit-20261113.md`](./sales-customer-capability-audit-20261113.md) |
| Platform 平台层域级能力审计基线（2026-11-13） | B3122 工作流设计与配置 | Platform | `v1.0` | `63bb7c5` | `AUDIT_COMPLETE / COVERAGE_REVIEWED`（`document.md §17` 平台长期能力 PL-01～PL-13 共 13 项 + `§22.22` B3122 手册能力 WF-01～WF-08 共 8 项，合计 21 项：**3 `COVERED`（PL-01 Identity/RBAC、PL-05 Approval、PL-12 Audit）/ 7 `PARTIAL`（PL-06、PL-09、PL-11、PL-13、WF-01、WF-04、WF-05）/ 11 `MISSING`（PL-02、PL-03、PL-04、PL-07、PL-08、PL-10、WF-02、WF-03、WF-06、WF-07、WF-08）**；登记 12 项结构缺口、16 项真实缺陷与 3 项待业务所有者裁定（`PL-DEC-01`～`PL-DEC-03`）；**域级 Acceptance 与 Capability Freeze 尚未签发**） | [`platform-capability-audit-20261113.md`](./platform-capability-audit-20261113.md) |

## 登记条目

### B3101 / B3121 采购与委外代码审计基线（2026-11-07）

| 项 | 值 |
|---|---|
| 详细台账 | [`b3101-b3121-code-audit-20261107.md`](./b3101-b3121-code-audit-20261107.md) |
| 覆盖手册 | B3101《采购管理操作手册 V1.0》、B3121《委外管理操作手册 V1.0》 |
| 覆盖 Capability | PRC-01..PRC-26、VMI-01..VMI-05、OUT-01..OUT-23（登记于台账 §3） |
| 对应 Domain | Procurement & Outsourcing |
| 审计版本 | `v0.2`（增加产品范围裁剪原则；保留 v0.1 审计事实） |
| 审计基准 SHA | `9b9cb09799aa05ccac43d02ac1718083921c6d04`（`master`，2026-11-07） |
| 审计状态 | `PRELIMINARY_STATIC_REVIEW`（初步静态代码审查） |
| 审计方法 | 远端静态代码审查；**未**运行任何测试套件，**未**连接真实 MySQL |
| Issue 总数 | 17 |
| Issue 状态统计 | `DOCUMENTED` 14；`NEEDS_REVALIDATION` 2；`DEFERRED_NOT_AUTHORIZED` 1 |
| 产品范围建议 | [`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md)（`PENDING`，**待业务所有者批准**） |
| 项目状态登记 | [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §38（审计基线登记）与 §39（产品范围重定基线建议） |
| 能力矩阵登记 | [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)「B3101 / B3121 审计基线登记」 |
| 本轮性质 | **仅登记审计基线**：未实施任何代码整改，未签发任何 Acceptance / Freeze |

**边界**：

- 台账记录的是基于上述基准 SHA 的**静态代码初审结果**，**不是** Domain Acceptance、Capability Freeze、
  Manual Closure、Release Readiness 或完整验收报告；
- 涉及运行时、数据库约束、并发、真实权限与端到端结果的结论，在对应 Issue 中保持 `NEEDS_REVALIDATION`，
  **不得**写成已通过或已失败的运行时结论；
- 台账 §7 的 Package A～D 只是**建议**，**不是**实施授权；
- **B3101 / B3121 手册仅是业务参考，不是逐项必须复刻的产品范围。** 台账 §0.5～§0.7 已确立
  「参考金蝶、按需建设、非 1:1 复刻」原则：台账列出的新增业务功能与 UI 缺口，其
  `Product Scope` 默认是 `SCOPE_REVIEW_PENDING`，**不得**直接升格为开发任务；
- M1-Core 首期包级 Acceptance（`M1_CORE_ACCEPTANCE_PASS`，2026-11-07）覆盖范围**仅**其七 Gate，
  **不**覆盖本台账的 Capability 粒度，**也不**授予 Capability Freeze / Domain Acceptance。

### Accounting & Analytics 域级能力审计基线（2026-11-10）

| 项 | 值 |
|---|---|
| 详细台账 | [ccounting-analytics-capability-audit-20261110.md](./accounting-analytics-capability-audit-20261110.md) |
| 覆盖手册 | B3106 存货核算、B3107 固定资产、B3114 智能会计平台、B3115 总账、B3116 报表、B3117 经营会计 |
| 覆盖 Capability | AA-01..AA-44（44 项，登记于台账 §2） |
| 对应 Domain | Accounting & Analytics |
| 审计版本 | 0.1（首次域级审计） |
| 审计基准 SHA | ee92c21751b9e6fa224125611750a4af4988591（master，2026-11-10） |
| 审计状态 | AUDIT_COMPLETE / COVERAGE_REVIEWED |
| 审计方法 | 静态代码审计（route / handler / schema / 状态机 / 权限 / 事务 / 审计 / 测试 / 前端 surface 逐项定位）；**未**运行测试套件，**未**连接真实 MySQL |
| Coverage 结论 | 44 项 = 4 COVERED / 21 PARTIAL / 18 MISSING / 1 OUT_OF_SCOPE |
| 领域级结构缺口 | 7 条（ACC-X-01..07，登记于台账 §3） |
| 建议范围包 | AA-W1..AA-W7（登记于台账 §4，**是建议不是授权**） |
| 本轮性质 | **仅登记审计基线**：未实施任何代码整改，未签发任何 Acceptance / Freeze / Scope Decision |

**边界**：

- 本台账是 Accounting & Analytics 域的**首次域级审计**，用于支撑该域建立 Domain Closure Requirement 与
  Domain Technical Design（当前 docs/requirements/README.md 与 docs/design/README.md 仍登记该域「尚无」）；
- 台账中的 COVERED 判定基于静态证据，**尚未**经测试套件与 MySQL gate 复跑，不得视为已验收；
- 台账 §4 的范围包与 §5 的 OUT_OF_SCOPE 建议**必须**由业务所有者逐项裁定后，才能进入 Requirement 阶段；
- 本台账**不改写** document.md §22.6 / §22.7 / §22.14–§22.17 的手册能力基线初判；
  正式 Capability 覆盖状态仍只在 docs/status/CAPABILITY_MATRIX.md 登记。
## 持续状态更新机制

后续所有 B3101 / B3121 开发任务，都必须以
[`b3101-b3121-code-audit-20261107.md`](./b3101-b3121-code-audit-20261107.md)
作为**详细 Issue 台账**。本索引与
[`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 只维护摘要与链接，**不复制** Issue 清单。

### 状态迁移链

```text
IDENTIFIED → DOCUMENTED → AUTHORIZED → IMPLEMENTING → CODE_COMPLETE → TESTED → VERIFIED → ACCEPTED
```

允许进入 `BLOCKED` 或 `DEFERRED_NOT_AUTHORIZED`；台账另设 `NEEDS_REVALIDATION`（需在当前 HEAD 或
真实测试环境重新核验）与 `REJECTED`（经裁定不纳入产品范围）。**不得跳过必要状态。**

### 每次处理一个 Issue 的必做项

1. 更新该 Issue 的 `Status`；
2. 记录对应开发 Commit SHA；
3. 记录测试命令、Run ID 和结果；
4. 记录业务不变量及回归验证证据；
5. 更新 `Last Updated` 与 `Change History`；
6. 同步 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 中的项目进展摘要；
7. 在 `log/YYYY-MM-DD.md` 记录本次状态变化；
8. **只有**达到 Capability 级别的正式验证条件时，才更新
   [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)。

这些文件**不会自动同步**；每次开发任务结束时必须显式执行状态同步。

### 四条轴不得互相替代

除 Issue 的证据状态链外，台账 v0.2 另设三条独立轴（台账 §0.6）：

| 轴 | 用途 | 本目录的处理 |
|---|---|---|
| `Evidence Status` | 代码问题证据状态（静态 / 实测必须区分） | 本索引的 `DOCUMENTED` / `NEEDS_REVALIDATION` 等即属此轴 |
| `Product Scope` | 该能力是不是本 ERP 未来要做的 | `SCOPE_REVIEW_PENDING`（默认）/ `CORE_REQUIRED` / `SIMPLIFIED` / `OPTIONAL` / `DEFERRED` / `OUT_OF_SCOPE`；后五项**须有可追溯 Owner / Scope Decision**，**不能**由开发者或 AI 宣告 |
| `Authorization` | 本次是否授权动手开发 | `NOT_AUTHORIZED`（默认）/ `AUTHORIZED` / `DEFERRED_NOT_AUTHORIZED`；**不因** `Product Scope = CORE_REQUIRED` 自动授权 |

范围裁剪建议与待批准的 Scope Change Proposal 见
[`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md)；
其状态为 `PENDING`，**未**获业务所有者批准前，已批准合同全部维持原状。

### 不可混用的状态

| 状态 | 不等于 |
|---|---|
| `CODE_COMPLETE` | `TESTED`（代码写完不代表测试通过） |
| `TESTED` | `VERIFIED`（测试通过不代表业务不变量与回归已核验） |
| `VERIFIED` | `ACCEPTED`（已核验不代表已获正式验收） |
| `ACCEPTED` | **只能**由正式责任人签发；实施代理自评**不**构成 Acceptance |

补充纪律：

- 一个 Issue 完成，**不代表**整个 Capability 或 Domain 完成；
- 延期能力（`DEFERRED_NOT_AUTHORIZED`）**不得**自动转为已授权实施；
- 不得把台账中的 `DOCUMENTED` 项目描述成已修复或已验收；
- 发现新问题时**新增** Issue ID，**不覆盖**历史 Issue；修复后保留原始发现、修复 commit、
  测试证据与验收证据。

## 规则

- 本目录新增任何审计文档前，必须先在本索引登记：名称、覆盖手册、Domain、审计版本、审计基准 SHA、
  审计状态与详细台账链接；
- 审计文档抬头必须声明：用途、Owner、状态、权威来源、审计基准 SHA、审计状态；
- 审计基准 SHA 之后 `master` 前进时，必须先比较当前 HEAD 与基准 SHA；**不得**把台账中的行号或代码结论
  未经复核直接套用到新 SHA；
- 不得在本目录登记当前项目状态（那是 `PROJECT_STATUS.md` 的唯一职责），也不得在本目录复制 Issue 清单
  （那是各审计台账正文的唯一职责）。
