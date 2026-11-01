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

## 矩阵

| Manual | 模块 | Domain | 当前 Requirement | 当前 Design | 实现 / 验收证据 | 状态 |
|---|---|---|---|---|---|---|
| B3101 | 采购管理 | Procurement & Outsourcing | [`procurement-outsourcing.md` §31.3.1](../requirements/procurement-outsourcing.md) · PRC-01..26 | [`procurement-outsourcing.md` §26](../design/procurement-outsourcing.md) | Acceptance `NOT READY`（§31.11）；M1 13 个 Gate 全部 `NOT_RUN` | `BLOCKED` |
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
| B3121 | 委外管理 | Procurement & Outsourcing | [`procurement-outsourcing.md` §31.3.3 + VMI-01..05](../requirements/procurement-outsourcing.md) · OUT-01..23 | [`procurement-outsourcing.md` §26](../design/procurement-outsourcing.md) | Acceptance `NOT READY`；M1 设计在独立分支 `PENDING_REVIEW`，未合并到 `master` | `BLOCKED` |
| B3122 | 工作流设计与配置 | Platform | [`document.md` §22.22](../../document.md)（仅手册基线） | **无 Platform Design** | 仍然开放（正确） | `NOT_STARTED` |

## 覆盖缺口说明

1. **Accounting & Analytics（B3106、B3107、B3114–B3117）** 是当前最大的矩阵空洞 ——
   既无 Domain Closure Requirement，也无 Domain Technical Design，因此全部记 `UNVERIFIED`。
   这是**如实登记**，不是遗漏；补齐需要先走 Requirement 阶段。
2. **Platform（B3122）** 同理，只有手册基线，`NOT_STARTED`。
3. **Inventory & Warehouse / Manufacturing & Quality / Finance Operations / Master & Engineering**
   实现完成但缺**独立 Domain-Level Acceptance token**，故记 `HISTORICAL_EVIDENCE` 而非 `VERIFIED`。
4. **B3101 / B3121** 的 `BLOCKED` 来自 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §35.8 的 G-1..G-5
   与 §31.11 的 `NOT READY`，不是覆盖率本身为零。

## 追溯规则

- 手册要求基线变更 → 先改 `document.md` §22，再回写本表；
- Capability 覆盖变更 → 先走 Requirement / Design，再回写本表；
- 验收证据新增 → 证据写入 `docs/acceptance/`，本表只更新状态与指针；
- **不得**因为存在同名页面/API 或历史文件就判定 `COVERED`（`document.md` §15）。
