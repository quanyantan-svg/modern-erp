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
| B3104 | 库存管理 | Inventory & Warehouse | [`inventory-warehouse.md` §32.3](../requirements/inventory-warehouse.md) · INV-01..38 | [`inventory-warehouse.md` §27](../design/inventory-warehouse.md) | **域级 Acceptance 已签发**（`INVENTORY_WAREHOUSE_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`INVENTORY_WAREHOUSE_CAPABILITY_FREEZE`，44 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/inventory-warehouse-domain-acceptance-20261113.md)；**域级 44 项逐项复核** [`inventory-warehouse-capability-audit-20261112.md`](../audits/inventory-warehouse-capability-audit-20261112.md)（整改前 29 `COVERED` / 15 `PARTIAL`；整改与收尾轮后 **44 `COVERED` / 0 `PARTIAL`**）；整改轮把调拨、盘点、容器三处双写入口收敛为 canonical 唯一写入口，前端收敛为单一 canonical 工作面并补齐 Requirement §32.9 F 的 11 个缺失 operator 工作面，修复 **23 项真实缺陷**（含 canonical 盘点缺 `transaction` 导入、即时库存查询每次调用 500、容器装箱 `ReferenceError`、锁库并发可超锁、浏览器脚本从未真正加载目标屏等）；**真实 MySQL 8.0.37 专属 campaign PASS**（`INVENTORY_WAREHOUSE_MYSQL_V1`，run `a52fe068-8508-483e-8c76-fd4ca8e88d16`、commit `3eece1b`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`、竞态套件 4/4 PASS）；FULL **3769/3769**、FAST **632/632**、HEAVY **67/67**、域级合同套件 **13/13**、域能力套件 **13/13**、功能 UAT **28/28**、浏览器 **108/108**（24 界面 + 84 页签逐页签走查，真实数据或显式空态 + 全部可点目标 ≥44px）；**残余**：库存冲销路径按元组重建补偿异动仍未进入 canonical 变更合同、逐列 schema parity 未取证、既有库存行的位置键回填、N7 文档追溯债务；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3105 | 条码管理 | Inventory & Warehouse / Manufacturing & Quality | [`inventory-warehouse.md` §32.3](../requirements/inventory-warehouse.md) · INV-39..44 | [`inventory-warehouse.md` §27](../design/inventory-warehouse.md) | **域级 Acceptance 已签发**（`INVENTORY_WAREHOUSE_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`INVENTORY_WAREHOUSE_CAPABILITY_FREEZE`，44 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/inventory-warehouse-domain-acceptance-20261113.md)；**域级 44 项逐项复核** [`inventory-warehouse-capability-audit-20261112.md`](../audits/inventory-warehouse-capability-audit-20261112.md)（整改前 29 `COVERED` / 15 `PARTIAL`；整改与收尾轮后 **44 `COVERED` / 0 `PARTIAL`**）；整改轮把调拨、盘点、容器三处双写入口收敛为 canonical 唯一写入口，前端收敛为单一 canonical 工作面并补齐 Requirement §32.9 F 的 11 个缺失 operator 工作面，修复 **23 项真实缺陷**（含 canonical 盘点缺 `transaction` 导入、即时库存查询每次调用 500、容器装箱 `ReferenceError`、锁库并发可超锁、浏览器脚本从未真正加载目标屏等）；**真实 MySQL 8.0.37 专属 campaign PASS**（`INVENTORY_WAREHOUSE_MYSQL_V1`，run `a52fe068-8508-483e-8c76-fd4ca8e88d16`、commit `3eece1b`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`、竞态套件 4/4 PASS）；FULL **3769/3769**、FAST **632/632**、HEAVY **67/67**、域级合同套件 **13/13**、域能力套件 **13/13**、功能 UAT **28/28**、浏览器 **108/108**（24 界面 + 84 页签逐页签走查，真实数据或显式空态 + 全部可点目标 ≥44px）；**残余**：库存冲销路径按元组重建补偿异动仍未进入 canonical 变更合同、逐列 schema parity 未取证、既有库存行的位置键回填、N7 文档追溯债务；Manual Closure 与 Release Readiness 仍未签发；本手册的 INV-39..44（条码规则 / 解析 / 绑定 / 生成 / 标签渲染）已在本域冻结范围内；Requirement §32.8 明确排除的完整标签打印平台、printer / device address 管理与通用扫描配置设计器仍不在范围内 | `FROZEN` |
| B3106 | 存货核算 | Accounting & Analytics | [`accounting-analytics.md` §35](../requirements/accounting-analytics.md) · AA-01..AA-09 | [`accounting-analytics.md` §31.6](../design/accounting-analytics.md) | AA-W6 已实施：`accounting_scopes` / `product_costing_profiles` / `provisional_receipts` / `purchase_expenses` / `cost_adjustments` / `production_cost_closings` + 核算关账异常清单；`AA-W6` 专项测试 **PASS**。**逐项复核 9 `COVERED` / 0 `PARTIAL`**；**域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，2026-11-12）——[签发记录](../acceptance/accounting-analytics-domain-acceptance-20261111.md)；43 项 `COVERED` 能力已冻结；Manual Closure 与 Release Readiness 仍未签发 —— AA-07 委外成本的口径由采购与委外域已冻结的 canonical 实现承担，本域按 §35.4.6 AA-W6.17～AA-W6.19 只做权威事实引用（业务所有者 2026-11-11 裁定选项 A，见[审计台账 §7.3](../audits/accounting-analytics-capability-audit-20261110.md)） | `FROZEN` |
| B3107 | 固定资产 | Accounting & Analytics | [`accounting-analytics.md` §35](../requirements/accounting-analytics.md) · AA-10..AA-17 | [`accounting-analytics.md` §31.5](../design/accounting-analytics.md) | AA-W5 已实施：资产类型 / 位置 / 折旧政策独立实体、资产卡片生命周期、采购转固、受控变更单、拆分合并、借用盘点、**按政策自动计提折旧并生成凭证**、受控处置；route `fixed-assets` 已 enabled 并进入 launcher；`AA-W5` 专项测试 **PASS**。**逐项复核 8 `COVERED` / 0 `PARTIAL`**；**域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，2026-11-12）——[签发记录](../acceptance/accounting-analytics-domain-acceptance-20261111.md)；43 项 `COVERED` 能力已冻结；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3108 | 应付款-业务应付 | Finance Operations | [`finance-operations.md` §33.5 + §33.2](../requirements/finance-operations.md) · FO01..FO58 | [`finance-operations.md` §28](../design/finance-operations.md) | **域级 Acceptance 已签发**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）——[签发记录](../acceptance/finance-operations-domain-acceptance-20261112.md)；**域级 58 项逐项复核** [`finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)（整改前 51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`；整改轮后 **58 `COVERED`**）；真实 MySQL 8.0.37 campaign **PASS**（run `74b21f14-0e82-42fa-a302-c0359f6cef4f`、commit `7a205e8`，`ACK-4 STATE = FINISHED`、清理独立 post-flight 证明，RACE-01..15 全部实证）；FULL **3728/3728**、FINANCE UAT **32/32** + 能力检查 58/58、响应式 UAT **24/24**；**残余**：N7 文档追溯债务（四个已推送历史提交，与本域能力无关）；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3109 | 应付款-暂估应付 | Finance Operations | 同上 | 同上 | **域级 Acceptance 已签发**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）——[签发记录](../acceptance/finance-operations-domain-acceptance-20261112.md)；**域级 58 项逐项复核** [`finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)（整改前 51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`；整改轮后 **58 `COVERED`**）；真实 MySQL 8.0.37 campaign **PASS**（run `74b21f14-0e82-42fa-a302-c0359f6cef4f`、commit `7a205e8`，`ACK-4 STATE = FINISHED`、清理独立 post-flight 证明，RACE-01..15 全部实证）；FULL **3728/3728**、FINANCE UAT **32/32** + 能力检查 58/58、响应式 UAT **24/24**；**残余**：N7 文档追溯债务（四个已推送历史提交，与本域能力无关）；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3110 | 应收款-业务应收 | Finance Operations | 同上 | 同上 | **域级 Acceptance 已签发**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）——[签发记录](../acceptance/finance-operations-domain-acceptance-20261112.md)；**域级 58 项逐项复核** [`finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)（整改前 51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`；整改轮后 **58 `COVERED`**）；真实 MySQL 8.0.37 campaign **PASS**（run `74b21f14-0e82-42fa-a302-c0359f6cef4f`、commit `7a205e8`，`ACK-4 STATE = FINISHED`、清理独立 post-flight 证明，RACE-01..15 全部实证）；FULL **3728/3728**、FINANCE UAT **32/32** + 能力检查 58/58、响应式 UAT **24/24**；**残余**：N7 文档追溯债务（四个已推送历史提交，与本域能力无关）；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3111 | 应收款-暂估应收 | Finance Operations | 同上 | 同上 | **域级 Acceptance 已签发**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）——[签发记录](../acceptance/finance-operations-domain-acceptance-20261112.md)；**域级 58 项逐项复核** [`finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)（整改前 51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`；整改轮后 **58 `COVERED`**）；真实 MySQL 8.0.37 campaign **PASS**（run `74b21f14-0e82-42fa-a302-c0359f6cef4f`、commit `7a205e8`，`ACK-4 STATE = FINISHED`、清理独立 post-flight 证明，RACE-01..15 全部实证）；FULL **3728/3728**、FINANCE UAT **32/32** + 能力检查 58/58、响应式 UAT **24/24**；**残余**：N7 文档追溯债务（四个已推送历史提交，与本域能力无关）；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3112 | 发票管理 | Finance Operations | 同上 | 同上 | **域级 Acceptance 已签发**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）——[签发记录](../acceptance/finance-operations-domain-acceptance-20261112.md)；**域级 58 项逐项复核** [`finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)（整改前 51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`；整改轮后 **58 `COVERED`**）；真实 MySQL 8.0.37 campaign **PASS**（run `74b21f14-0e82-42fa-a302-c0359f6cef4f`、commit `7a205e8`，`ACK-4 STATE = FINISHED`、清理独立 post-flight 证明，RACE-01..15 全部实证）；FULL **3728/3728**、FINANCE UAT **32/32** + 能力检查 58/58、响应式 UAT **24/24**；**残余**：N7 文档追溯债务（四个已推送历史提交，与本域能力无关）；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3113 | 出纳管理 | Finance Operations | 同上 | 同上 | **域级 Acceptance 已签发**（`FINANCE_OPERATIONS_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`FINANCE_OPERATIONS_CAPABILITY_FREEZE`，58 项 `COVERED` 能力）——[签发记录](../acceptance/finance-operations-domain-acceptance-20261112.md)；**域级 58 项逐项复核** [`finance-operations-capability-audit-20261112.md`](../audits/finance-operations-capability-audit-20261112.md)（整改前 51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`；整改轮后 **58 `COVERED`**）；真实 MySQL 8.0.37 campaign **PASS**（run `74b21f14-0e82-42fa-a302-c0359f6cef4f`、commit `7a205e8`，`ACK-4 STATE = FINISHED`、清理独立 post-flight 证明，RACE-01..15 全部实证）；FULL **3728/3728**、FINANCE UAT **32/32** + 能力检查 58/58、响应式 UAT **24/24**；**残余**：N7 文档追溯债务（四个已推送历史提交，与本域能力无关）；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3114 | 智能会计平台 | Accounting & Analytics | [`accounting-analytics.md` §35](../requirements/accounting-analytics.md) · AA-18..AA-24 | [`accounting-analytics.md` §31.1、§31.2](../design/accounting-analytics.md) | AA-W1 + AA-W2 已实施：会计事件台账（DB 级自然键唯一）、未生成与异常清单、受控修复（重试 / 跳过并说明原因 / 恢复，均写审计）、业务↔GL 对账工作台与不可变快照、统一期末关账检查、会计科目维护、凭证模板与规则平台（命中唯一、未命中显式失败）、批量生成逐条独立事务；`AA-W1/W2` 专项测试 **PASS**。**逐项复核 7 `COVERED` / 0 `PARTIAL`**；**域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，2026-11-12）——[签发记录](../acceptance/accounting-analytics-domain-acceptance-20261111.md)；43 项 `COVERED` 能力已冻结；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3115 | 总账 | Accounting & Analytics | [`accounting-analytics.md` §35](../requirements/accounting-analytics.md) · AA-25..AA-32 | [`accounting-analytics.md` §31.3](../design/accounting-analytics.md) | AA-W3 已实施：冲销与补记统一 canonical 路径（金额镜像）、出纳复核独立节点与权限（SOD 生效）、三段式现金流量表与资金子账对账、期末转账 / 摊销 / 计提、**真实损益结转**并移除虚拟权益行；`AA-W3` 专项测试 **PASS**。**逐项复核 7 `COVERED` + 1 `OUT_OF_SCOPE`**；**域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，2026-11-12）——[签发记录](../acceptance/accounting-analytics-domain-acceptance-20261111.md)；43 项 `COVERED` 能力已冻结；Manual Closure 与 Release Readiness 仍未签发（AA-31 汇兑损益 / 多币种，业务所有者 2026-11-10 裁定） | `FROZEN` |
| B3116 | 报表 | Accounting & Analytics | [`accounting-analytics.md` §35](../requirements/accounting-analytics.md) · AA-33..AA-38 | [`accounting-analytics.md` §31.4](../design/accounting-analytics.md) | AA-W4 已实施：报表模板 + 行项目 + 可见范围 + 版本、受限文法公式引擎（无 `eval` / `Function`，失败显式报错不静默取 0）、期间实例生命周期（实例化 → 重算 → 提交 → 审核，提交与审核分离并留痕）、自定义报表；既有 5 张固定执行报表口径不变；`AA-W4` 专项测试 **PASS**。**逐项复核 6 `COVERED` / 0 `PARTIAL`**；**域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，2026-11-12）——[签发记录](../acceptance/accounting-analytics-domain-acceptance-20261111.md)；43 项 `COVERED` 能力已冻结；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3117 | 经营会计 | Accounting & Analytics | [`accounting-analytics.md` §35](../requirements/accounting-analytics.md) · AA-39..AA-44 | [`accounting-analytics.md` §31.7](../design/accounting-analytics.md) | AA-W7 已实施：经营账簿 / 经营单元、经营台账（只取已过账事实、归集幂等）、内部结算价格、费用归集与分摊（可重算一致、基数缺失 fail closed）、经营损益与法定损益勾稽（差额显式三段）、经营期间关账与受控反结账；`AA-W7` 专项测试 **PASS**。**逐项复核 6 `COVERED` / 0 `PARTIAL`**；**域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` / `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`，2026-11-12）——[签发记录](../acceptance/accounting-analytics-domain-acceptance-20261111.md)；43 项 `COVERED` 能力已冻结；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3118 | 工程数据 | Master & Engineering | [`master-engineering.md` §28.3](../requirements/master-engineering.md) · ME-01..31 | [`master-engineering.md` §23](../design/master-engineering.md) | **域级 Acceptance 已签发**（`MASTER_ENGINEERING_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`MASTER_ENGINEERING_CAPABILITY_FREEZE`，17 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/master-engineering-domain-acceptance-20261112.md)；**域级 21 项逐项复核** [`master-engineering-capability-audit-20261112.md`](../audits/master-engineering-capability-audit-20261112.md)（整改前 13 `COVERED` / 5 `PARTIAL` / 3 `MISSING`；整改轮后 **17 `COVERED` / 1 `PARTIAL` / 3 `OUT_OF_SCOPE` / 0 `MISSING`**）；整改轮补齐参考资料 master 生命周期、工序级拓扑与 link 删除回退、当前库存 cleanup candidate；审计中查出并修复 ECO 状态机与参考资料 master 的**并发权威复读缺陷**（事务外读权威状态 + 无先决状态条件的 UPDATE），并发双 apply / approve vs reject / 双 deactivate 三类缺陷已在真实 MySQL 上证明关闭；**真实 MySQL 8.0.37 专属 campaign PASS**（`MASTER_ENGINEERING_MYSQL_V1`，run `cbc6b6a6-5ed2-4460-898c-9140ee1916d7`、commit `4584f22`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`、竞态套件 4/4 PASS）；FULL **3740/3740**、FAST **632/632**、HEAVY **67/67**、域内 focused **63/63**、新增合同套件 **12/12**、浏览器四档 PASS（变异实验证明非空洞）；**残余**：逐列 schema parity 未取证、跨 ECO 同 BOM 版本唯一性未取证、预计入供应仍跨域、N7 文档追溯债务；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3119 | 生产管理 | Manufacturing & Quality | [`manufacturing-quality.md` §29.3](../requirements/manufacturing-quality.md) · MQ-01..43 | [`manufacturing-quality.md` §24](../design/manufacturing-quality.md) | **域级 Acceptance 已签发**（`MANUFACTURING_QUALITY_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`MANUFACTURING_QUALITY_CAPABILITY_FREEZE`，37 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/manufacturing-quality-domain-acceptance-20261112.md)；**域级 43 项逐项复核** [`manufacturing-quality-capability-audit-20261112.md`](../audits/manufacturing-quality-capability-audit-20261112.md)（整改前 22 `COVERED` / 15 `PARTIAL` / 5 `OUT_OF_SCOPE` / 1 `MISSING`；整改轮后 **37 `COVERED` / 1 `PARTIAL` / 5 `OUT_OF_SCOPE` / 0 `MISSING`**）；整改轮补齐用料清单受控编辑·审核·下达、委外交接、工序转移扫码、副产品维护与入库、检验放行与不合格处置、检验类型词表、检验方案与 QCP 的 when/what、生产侧抽样；修复 **14 项真实缺陷**（含拓扑与委外边界只在草稿创建时 fail closed、委外交接端点不存在、生产侧从不抽样、门禁从不读 QCP、WAIVED 无实现、`nonconforming` 从不写入、检验类型自由文本、LOT/SERIAL 扫码读不存在的列、8 个能力无前端入口）；**真实 MySQL 8.0.37 专属 campaign PASS**（`MANUFACTURING_QUALITY_MYSQL_V1`，run `210f31c4-f76f-45f1-a90a-2d909846ed1a`、commit `eceadc5`，`RESULT = PASS`、`ACK-4 STATE = FINISHED`、竞态套件 4/4 PASS）；FULL **3749/3749**、FAST **632/632**、HEAVY **67/67**、新增合同套件 **9/9**、浏览器响应式 **28/28** + 最终验收 **36/36**（变异实验证明非空洞）；**残余**：逐列 schema parity 未取证、跨单据并发幂等未取证、MQ-43 Dispatch 范围未裁定、副产品成本归会计域、N7 文档追溯债务；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
| B3120 | 计划管理 | Planning | [`planning.md` §30.2](../requirements/planning.md) · PL-01..45 | [`planning.md` §25](../design/planning.md) | **域级 Acceptance 已签发**（`PLANNING_DOMAIN_ACCEPTANCE_PASS`）与 **Capability Freeze 已签发**（`PLANNING_CAPABILITY_FREEZE`，45 项 `COVERED` 能力）——[验收与冻结记录](../acceptance/planning-domain-acceptance-20261112.md)；**域级 45 项逐项复核** [`planning-capability-audit-20261112.md`](../audits/planning-capability-audit-20261112.md)（整改前 34 `COVERED` / 7 `PARTIAL` / 4 `MISSING`；整改轮后 **45 `COVERED` / 0 `PARTIAL` / 0 `MISSING`**）；整改轮补齐仓库范围净额、时间分段事件与安全库存 floor、替代料消费与建议、人工预留、批量维护、副产品、供需报表与追溯，并修复 8 项真实缺陷（含共享组件库存多次净额、已消费 Forecast 重复计入、跨域错误码耦合）；FULL **3718/3718**、FAST **632/632**、HEAVY **67/67**、域内 focused **170/170**、新增合同套件 **9/9**、浏览器四档 UAT **PASS**（含变异实验证明非空洞）、Sales Wave 7 跨域回归 **87/87**；**残余**：真实 MySQL 上的 release/reservation 行为等价**未单独取证**（本域无专属 ACK-4 campaign），业务所有者已裁定接受；Manual Closure 与 Release Readiness 仍未签发 | `FROZEN` |
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

1. **Accounting & Analytics（B3106、B3107、B3114–B3117）** 已于 2026-11-10 建立 Domain Closure
   Requirement（[`accounting-analytics.md` §35](../requirements/accounting-analytics.md)）与 Domain Technical
   Design（[`accounting-analytics.md` §31](../design/accounting-analytics.md)），并于 2026-11-11 完成
   AA-W1..AA-W7 全部七个范围包的实施与逐项复核：六本手册共 44 项 Capability，**43 `COVERED`**、
   **0 `PARTIAL`**、**1 `OUT_OF_SCOPE`（AA-31 汇兑损益 / 多币种）**。
   六本手册据此全部记 `VERIFIED`（AA-07 委外成本的口径由采购与委外域已冻结的 canonical 实现承担，
   本域按 §35.4.6 AA-W6.17～AA-W6.19 只做权威事实引用 —— 业务所有者 2026-11-11 裁定选项 A）。
   **真实 MySQL 8 Gate PASS**（受保护 disposable MySQL 8.0.37，最终 run `52ee28ff-377c-4558-a0d8-d4e7824a8c47`，commit `003fc8cd`，`ACK-4 STATE = FINISHED`，清理独立 post-flight 证明）：47 张表的目录对等、七个包的权威写入路径、三条并发 UNIQUE 边界与金额边界全部通过 —— 见[签发记录 §2 / §3](../acceptance/accounting-analytics-domain-acceptance-20261111.md)。
   2026-11-12 **域级 Acceptance 与 Capability Freeze 已签发**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS` /
   `ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`），六本手册据此全部记 `FROZEN`；详见
   [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §53 与
   [审计台账 §7](../audits/accounting-analytics-capability-audit-20261110.md)。
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
