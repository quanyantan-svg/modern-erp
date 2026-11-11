# B3101–B3122 能力覆盖矩阵

> 状态：`ACTIVE`
> Owner：Platform
> 权威来源：**手册要求基线**是 [`document.md`](../../document.md) §22（2026-10-06 已批准基线）。
> 本表只登记「当前 Coverage 应从哪里读」与「当前验收状态」，**不重新计数、不覆盖 §22 的手册要求基线**。
> 逐 Capability 的后验收覆盖统计本次**未逐条核验**，因此保持 `UNVERIFIED`。
> Domain 级进度见 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §35.3。

## 状态词表

| 状态 | 含义 |
|---|---|
| `VERIFIED` | 有当前代码 + 逐项证据 + 验收记录支撑 |
| `HISTORICAL_EVIDENCE` | 有历史验收证据，但未在当前 HEAD 上重新验证 |
| `UNVERIFIED` | 缺少逐 Capability 证据，**不得**据此宣称覆盖 |
| `BLOCKED` | 已知阻塞项未解 |
| `NOT_STARTED` | 尚未实施 |
| `NOT_APPLICABLE` | 明确不在范围内 |

> 审计台账（[`docs/audits/`](../audits/)）中的 **Issue 级**状态
> （`DOCUMENTED` / `NEEDS_REVALIDATION` / `AUTHORIZED` / `IMPLEMENTING` / `CODE_COMPLETE` /
> `TESTED` / `VERIFIED` / `ACCEPTED` / `BLOCKED` / `DEFERRED_NOT_AUTHORIZED`）
> **不是**本表 `状态` 列的取值；两者**不得**互相替代，也**不得**由 Issue 状态反推 Capability 状态。

## 矩阵

| Manual | 模块 | Domain | 当前 Requirement | 当前 Design | 实现 / 验收证据 | 状态 |
|---|---|---|---|---|---|---|
| B3101 | 采购管理 | Procurement & Outsourcing | [`procurement-outsourcing.md` §31.3.1、§31.16、§31.17、§31.18、§31.19、§31.20](../requirements/procurement-outsourcing.md) · PRC-01..26 | [`procurement-outsourcing.md` §26、§26.36、§26.37、§26.38、§26.39、§26.40](../design/procurement-outsourcing.md) + [`procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)（M1-Core 首期） | **域级 Acceptance 已签发**（`PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`PROCUREMENT_OUTSOURCING_CAPABILITY_FREEZE`，50 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/procurement-outsourcing-domain-acceptance-20261111.md)；**域级 54 项逐项复核** [`b3121-domain-acceptance-audit-20261110.md`](../audits/b3121-domain-acceptance-audit-20261110.md)（50 `COVERED` / 0 `PARTIAL` / 0 `MISSING` / 3 项已批准延期或移出范围）；真实 MySQL G07 Gate **PASS**（run `b9023437-4030-46f2-b469-0a08396bd7f6`，`state=FINISHED`、清理已证明）；浏览器 UAT **36/36 PASS**；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3102 | 销售管理 | Sales & Customer | [`sales-customer/01-domain-closure.md` §34.8](../requirements/sales-customer/01-domain-closure.md) · CAP-1..27 | [`sales-customer/01-domain-technical-design.md` §29](../design/sales-customer/01-domain-technical-design.md) | Wave 6/7/8/9 + Gate A 已冻结；**整域未冻结**，Waves 1–2 无验收记录 | `HISTORICAL_EVIDENCE` |
| B3103 | 信用管理 | Sales & Customer | [`sales-customer/01-domain-closure.md` §34.8](../requirements/sales-customer/01-domain-closure.md) + [`03-wave-9-amendments.md`](../requirements/sales-customer/03-wave-9-amendments.md)（SC82–SC107）· CAP-28..36 | [`sales-customer/04-wave-9-credit-baseline.md` §36](../design/sales-customer/04-wave-9-credit-baseline.md) + [`05-wave-11-stage-c.md` §37.54](../design/sales-customer/05-wave-11-stage-c.md) | Wave 9 / Gate A / Wave 10 已冻结；W11-SEC-01 与 W11-A U1/U2/U3 单元级已冻结；**W11-A 整包未签发** | `HISTORICAL_EVIDENCE` |
| B3104 | 库存管理 | Inventory & Warehouse | [`inventory-warehouse.md` §32.3](../requirements/inventory-warehouse.md) · INV-01..38 | [`inventory-warehouse.md` §27](../design/inventory-warehouse.md) | 实现 Partial；**未见独立 Domain-Level Acceptance** | `HISTORICAL_EVIDENCE` |
| B3105 | 条码管理 | Inventory & Warehouse / Manufacturing & Quality | [`inventory-warehouse.md` §32.3](../requirements/inventory-warehouse.md) · INV-39..44 | [`inventory-warehouse.md` §27](../design/inventory-warehouse.md) | 解析/校验/规则与绑定 CRUD 已有；生成、标签打印与 PDA 执行层 `NOT_STARTED` | `PARTIAL / UNVERIFIED` |
| B3106 | 存货核算 | Accounting & Analytics | 仅在 [`finance-operations.md` §33.1.3](../requirements/finance-operations.md) 确认归属 | **无 Accounting & Analytics Design** | 缺能力矩阵 | `UNVERIFIED` |
| B3107 | 固定资产 | Accounting & Analytics | 仅在 [`finance-operations.md` §33.1.3](../requirements/finance-operations.md) 确认归属 | **无 Accounting & Analytics Design** | 缺能力矩阵 | `UNVERIFIED` |
| B3108 | 应付款-业务应付 | Finance Operations | [`finance-operations.md` §33.5 + §33.2](../requirements/finance-operations.md) · FO01..FO58 | [`finance-operations.md` §28](../design/finance-operations.md) | 实现完成；**未见独立 Domain-Level Acceptance** | `HISTORICAL_EVIDENCE` |
| B3109 | 应付款-暂估应付 | Finance Operations | 同上 | 同上 | 同上 | `HISTORICAL_EVIDENCE` |
| B3110 | 应收款-业务应收 | Finance Operations | 同上 | 同上 | 同上 | `HISTORICAL_EVIDENCE` |
| B3111 | 应收款-暂估应收 | Finance Operations | 同上 | 同上 | 同上 | `HISTORICAL_EVIDENCE` |
| B3112 | 发票管理 | Finance Operations | 同上 | 同上 | 同上 | `HISTORICAL_EVIDENCE` |
| B3113 | 出纳管理 | Finance Operations | 同上 | 同上 | 同上 | `HISTORICAL_EVIDENCE` |
| B3114 | 智能会计平台 | Accounting & Analytics | **无 Domain Closure Requirement** | **无 Design** | 缺能力矩阵 | `UNVERIFIED` |
| B3115 | 总账 | Accounting & Analytics | **无 Domain Closure Requirement** | **无 Design** | 缺能力矩阵 | `UNVERIFIED` |
| B3116 | 报表 | Accounting & Analytics | **无 Domain Closure Requirement** | **无 Design** | 缺能力矩阵 | `UNVERIFIED` |
| B3117 | 经营会计 | Accounting & Analytics | **无 Domain Closure Requirement** | **无 Design** | 缺能力矩阵 | `UNVERIFIED` |
| B3118 | 工程数据 | Master & Engineering | [`master-engineering.md` §28.3](../requirements/master-engineering.md) · ME-01..31 | [`master-engineering.md` §23](../design/master-engineering.md) | 实现完成；**未见独立 Domain-Level Acceptance** | `HISTORICAL_EVIDENCE` |
| B3119 | 生产管理 | Manufacturing & Quality | [`manufacturing-quality.md` §29.3](../requirements/manufacturing-quality.md) · MQ-01..43 | [`manufacturing-quality.md` §24](../design/manufacturing-quality.md) | 实现完成；**未见独立 Domain-Level Acceptance** | `HISTORICAL_EVIDENCE` |
| B3120 | 计划管理 | Planning | [`planning.md` §30.2](../requirements/planning.md) · PL-01..45 | [`planning.md` §25](../design/planning.md) | `Final Acceptance: PASS`；**有明确用户 Freeze** | `VERIFIED` |
| B3121 | 委外管理 | Procurement & Outsourcing | [`procurement-outsourcing.md` §31.3.3、§31.15、§31.16、§31.17、§31.18、§31.19、§31.20](../requirements/procurement-outsourcing.md) · OUT-01..23 / VMI-01..05 / OUT-WB-REQ-01..08 | [`procurement-outsourcing.md` §26、§26.35、§26.36、§26.37、§26.38、§26.39、§26.40](../design/procurement-outsourcing.md) + [`procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)（M1-Core 首期） | **域级 Acceptance 已签发**（`PROCUREMENT_OUTSOURCING_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`PROCUREMENT_OUTSOURCING_CAPABILITY_FREEZE`，50 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/procurement-outsourcing-domain-acceptance-20261111.md)；委外核心执行工作面 [`OUTSOURCING_WORKBENCH_ACCEPTANCE_PASS_FROZEN`](../acceptance/outsourcing-workbench-acceptance-20261110.md)；**域级 54 项逐项复核** [`b3121-domain-acceptance-audit-20261110.md`](../audits/b3121-domain-acceptance-audit-20261110.md)（50 `COVERED` / 0 `PARTIAL` / 0 `MISSING` / 3 项已批准延期或移出范围）；真实 MySQL G07 Gate **PASS**（run `b9023437-4030-46f2-b469-0a08396bd7f6`）；浏览器 UAT **36/36 PASS**；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3122 | 工作流设计与配置 | Platform | [`document.md` §22.22](../../document.md)（仅手册基线） | **无 Platform Design** | 仍然开放（正确） | `NOT_STARTED` |

## B3101 / B3121 审计基线登记（2026-11-07）

| 项 | 值 |
|---|---|
| 审计基线正文 | [`docs/audits/b3101-b3121-code-audit-20261107.md`](../audits/b3101-b3121-code-audit-20261107.md) |
| 审计索引 | [`docs/audits/README.md`](../audits/README.md) |
| 审计版本 / 审计状态 | `v0.2` / `PRELIMINARY_STATIC_REVIEW`（初步静态代码审查；v0.2 增加产品范围裁剪原则，保留 v0.1 审计事实） |
| 审计基准 SHA | `9b9cb09799aa05ccac43d02ac1718083921c6d04`（`master`） |
| 覆盖 Capability | PRC-01..PRC-26、VMI-01..VMI-05、OUT-01..OUT-23 |
| 对应 Domain | Procurement & Outsourcing |
| 产品范围建议 | [`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md) —— `PENDING`，**待业务所有者批准**；54 项当前 `Product Scope` 一律 `SCOPE_REVIEW_PENDING` |
| 项目状态登记 | [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §38（审计基线）与 §39（产品范围重定基线建议） |

### 六个验收轴的当前取值（**互不替代**）

| 手册 | Requirement 完成 | Design 完成 | Code 实现 | Test 通过 | Capability Verified | Formal Acceptance |
|---|---|---|---|---|---|---|
| **B3101** 采购管理 | **是** —— §31.3.1，PRC-01..26 | **是** —— §26 + M1-Core Active Design | **部分** —— 审计台账登记的 9 个 PRC / VMI Issue 未整改 | **否** —— 本轮未运行任何测试套件，未取得当前 HEAD 的测试证据 | **否** | **否** —— Capability Freeze 未签发；Domain Acceptance 未签发 |
| **B3121** 委外管理 | **是** —— §31.3.3，OUT-01..23 + VMI-01..05 | **是** —— §26 + M1-Core Active Design | **部分** —— 审计台账登记的 OUT / VMI Issue 未整改 | **否** —— 同上 | **否** | **否** —— 同上 |

### 状态判定纪律

1. **本轮只建立 Audit Baseline。** 审计基线的存在**不**使任何 Capability 变为 `VERIFIED` 或 `PASS`；
   B3101 / B3121 的矩阵状态**保持 `BLOCKED`**。
2. `BLOCKED` 的依据**保持不变**：[`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §35.8 的 G-1..G-5、
   §31.11 的 `NOT READY`，以及 §37.55 明确「仍未授予」的 Capability Freeze / Domain Acceptance /
   Manual Closure / Release Readiness。本节**不**改变这些历史结论。
3. 审计台账 §3 的「Requirement 初始覆盖判断」是 Requirement 字段，审计台账 §3 的「本轮代码审计状态」
   是代码审查判断；**两者都不是 Acceptance**，也**不得**互相替代或据以反推覆盖率。
4. 审计台账 17 个 Issue 的当前状态：`DOCUMENTED` 14、`NEEDS_REVALIDATION` 2、
   `DEFERRED_NOT_AUTHORIZED` 1；**无**任何 Issue 处于 `AUTHORIZED` 及以后阶段。
   Issue 明细见台账 §9，**不在本表复制**。
5. M1-Core 首期包级 Acceptance（`M1_CORE_ACCEPTANCE_PASS`，2026-11-07）覆盖范围**仅**其七 Gate，
   **不**覆盖本表的 Capability 粒度，**不**授予 Capability Freeze / Domain Acceptance，
   **不**使 R-01～R-20 变为已证明或已消除。
6. B3121 的 VMI-01..VMI-05 与 OUT-22 / OUT-23 涉及延期与政策边界能力，其**当前正确状态是延期未授权**；
   **不得**因代码存在或审计记录存在而视为可实施。
7. 审计台账登记的问题**不得**被描述为已修复或已验收；整改必须先经 Requirement / Design / 授权门禁
   （`AGENTS.md §4`），并按台账 §0.3 / §11 的状态迁移链推进。

### 产品范围建议（**待业务所有者裁定；本表状态不受影响**）

| 项 | 内容 |
|---|---|
| 建议文档 | [`docs/decisions/product-scope-rebaseline-proposal-20261107.md`](../decisions/product-scope-rebaseline-proposal-20261107.md) —— `PENDING` |
| 建议覆盖 | PRC-01..PRC-26、VMI-01..VMI-05、OUT-01..OUT-23 共 54 项，逐项给出 `Product Scope` 建议值 |
| 建议分布 | `CORE_REQUIRED` 26；`SIMPLIFIED` 14；`OPTIONAL` 3；`DEFERRED` 9；`OUT_OF_SCOPE` 2 |
| **当前生效值** | 全部 54 项 `Product Scope` = **`SCOPE_REVIEW_PENDING`**（默认） |
| Scope Change Proposal | `SCP-01`～`SCP-15`，**全部待业务所有者批准** |
| 范围审查结论 | 现行 Requirement §31.3 / §31.4 / §31.8 / §31.10 与 Design §26.27 / §26.31 **确实把金蝶手册的几乎全部功能无条件列为必须实现**（54 项全部 `COVERED` 目标、49 项必须闭环、明文禁止 defer VMI-03 / VMI-05） |

**纪律**：

1. 产品范围建议**不改变**本表 `状态` 列的任何取值；B3101 / B3121 仍为 `BLOCKED`；
2. `Product Scope` 与本表 `状态` 是**两条不同的轴**，**不得**互相替代，也**不得**由范围建议反推覆盖状态；
3. 未经业务所有者批准，`SCP-01`～`SCP-15` **一律不生效**；已批准 Requirement / Design / Acceptance /
   延期政策全部维持原状；
4. **不得**把金蝶原版的菜单数量、表单数量或操作步骤数量作为开发完成标准；
5. 范围裁剪**不得**放宽库存、金额、权限、来源、事务、幂等与审计等核心正确性约束。

## 覆盖缺口说明

1. **Accounting & Analytics（B3106、B3107、B3114–B3117）** 是当前最大的矩阵空洞 ——
   既无 Domain Closure Requirement，也无 Domain Technical Design，因此全部记 `UNVERIFIED`。
   这是**如实登记**，不是遗漏；补齐需要先走 Requirement 阶段。
2. **Platform（B3122）** 同理，只有手册基线，`NOT_STARTED`。
3. **Inventory & Warehouse / Manufacturing & Quality / Finance Operations / Master & Engineering**
   实现完成但缺**独立 Domain-Level Acceptance token**，故记 `HISTORICAL_EVIDENCE` 而非 `VERIFIED`。
4. **B3101 / B3121** 的 `BLOCKED` 来自 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §35.8 的 G-1..G-5
   与 §31.11 的 `NOT READY`，不是覆盖率本身为零。2026-11-07 登记的静态代码审计基线
   （见上节）**不改变**该状态，只补充 Issue 级台账。
5. **B3101 / B3121** 已于 2026-11-07 建立**静态代码审计基线**（17 个 Issue），但该基线
   **不产生** Capability Verified、Formal Acceptance、Capability Freeze 或 Domain Acceptance；
   逐 Capability 的运行时结论仍需后续轮次审计补齐（台账 §8）。

## 追溯规则

- 手册要求基线变更 → 先改 `document.md` §22，再回写本表；
- Capability 覆盖变更 → 先走 Requirement / Design，再回写本表；
- 验收证据新增 → 证据写入 `docs/acceptance/`，本表只更新状态与指针；
- **不得**因为存在同名页面/API 或历史文件就判定 `COVERED`（`document.md` §15）。
