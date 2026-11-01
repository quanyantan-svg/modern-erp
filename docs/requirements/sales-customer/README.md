# Sales & Customer — 当前权威 Requirement

> 状态：`ACTIVE` —— 本目录是 Sales & Customer Domain **唯一的当前有效 Requirement 正文**
> Owner：Sales & Customer
> 权威来源：本文件；全局合同见 [`document.md`](../../../document.md)，导航见 [`docs/requirements/README.md`](../README.md)
> 对应 Design：[`docs/design/sales-customer/`](../../design/sales-customer/)
> 验收与冻结证据：[`docs/acceptance/sales-customer/`](../../acceptance/sales-customer/)
> 当前进度与阻塞项：[`docs/status/PROJECT_STATUS.md`](../../status/PROJECT_STATUS.md) §35.3

## 1. 阅读顺序与优先级规则

本目录的正文是**累积式 Requirement**：基线 Domain Closure Requirement 在 `01-domain-closure.md`，
其后每个 Wave 的修订节按时间顺序追加。

冲突时的优先级规则（**本规则由 G0 引入，用于消除"多份 Active 正文"的歧义**）：

1. **同一主题**下，后出现的修订节**取代**先出现的修订节；
2. 不同主题的修订节**并存**，互不取代；
3. `document.md` §22 的**手册要求基线**列是目标，任何修订都不得静默改变它；
4. 若某节被取代，必须在本登记表中标为 `SUPERSEDED` 并把正文移入 `docs/archive/requirements/`；
5. 任何仍无法判定是否生效的合同，标为 `NEEDS_OWNER_REVIEW` 并**保留原文**，不得自行删除或改写。

> `§34` 基线本身声明 Capability 与 Decision ID 空间（CAP-1..36、SC 系列），Wave 修订沿用同一空间。

## 2. Requirement 修订登记

| # | 文件 | 原章节 | 日期 | 主题 | 处置 |
|---|---|---|---|---|---|
| 1 | `01-domain-closure.md` | §34 | 2026-10 | Domain Closure Requirement 基线（CAP-1..27 等） | `ACTIVE` |
| 2 | `02-wave-8-amendments.md` | Wave 8 Stage B — Bounded Business Decisions & Cross-Domain Contract Reopen | 2026-10 | 销售履约有界业务决策与跨域合同 | `ACTIVE` |
| 3 | `02-wave-8-amendments.md` | Wave 8 Stage B — V21 Historical Position Evidence Amendment | 2026-10 | V21 历史位置证据 | `ACTIVE` |
| 4 | `02-wave-8-amendments.md` | Wave 8 Residual Requirement Amendment — R1/R2/R3 | 2026-10-21 | 残余需求修订 | `ACTIVE` |
| 5 | `02-wave-8-amendments.md` | Wave 8 Final Closure — SALES Warehouse/Bin Reference Access Requirement Amendment | 2026-10-21 | SALES 仓库/仓位引用访问 | `ACTIVE` |
| 6 | `03-wave-9-amendments.md` | Stage B Requirement Applicability Closure — Sales Credit Waves 9–11 | 2026-10-22 | 信用 Wave 9–11 适用性闭合（SC 系列） | `ACTIVE` |
| 7 | `03-wave-9-amendments.md` | Stage B Requirement Amendment — Sales Credit Profile Authorization Policy (Wave 9) | 2026-10-22 | 信用档案授权策略 | `ACTIVE` |
| 8 | `03-wave-9-amendments.md` | Stage B Requirement Amendment — Global Credit Configuration Authority (Wave 9) | 2026-10-22 | 全局信用配置权威 | `ACTIVE` |
| 9 | `04-wave-10-amendments.md` | Wave 10 Precondition Requirement Reconciliation | 2026-10-24 | 前置条件对账 | `ACTIVE` |
| 10 | `04-wave-10-amendments.md` | Wave 10 B-9 / B-10 / S14 Bounded Requirement Amendment | 2026-10-24 | 有界修订 | `ACTIVE` |
| 11 | `04-wave-10-amendments.md` | Wave 10 MySQL Acceptance Infrastructure Remediation Requirement | 2026-10-25 | 真实 MySQL 验收基础设施 | `ACTIVE` |
| 12 | `04-wave-10-amendments.md` | Wave 10 MySQL least-privilege readiness and Finance View parity requirement | 2026-10-25 | 最小权限与 Finance View 对等 | `ACTIVE` |
| 13 | `04-wave-10-amendments.md` | Wave 10 Gate B OQC quality-policy fixture Requirement | 2026-10-26 | Gate B OQC fixture | `ACTIVE` |
| 14 | `04-wave-10-amendments.md` | Wave 10 M-R09 Credit capacity contract Requirement | 2026-10-26 | 信用容量合同 | `ACTIVE` |
| 15 | `04-wave-10-amendments.md` | Wave 10 CHECK clause parity normalization Requirement | 2026-10-26 | CHECK 子句对等归一 | `ACTIVE` |
| 16 | `04-wave-10-amendments.md` | Wave 10 Full Acceptance blocker Requirement | 2026-10-27 | 全验收阻塞项（W10-ACC-R09/R10） | `ACTIVE` |
| 17 | `04-wave-10-amendments.md` | Wave 10 Parity Oracle Requirement Addendum | 2026-10-27 | 对等 oracle 追加 | `ACTIVE` |
| 18 | `04-wave-10-amendments.md` | Wave 10 Inventory Fixture Requirement | 2026-10-27 | 库存 fixture | `ACTIVE` |
| 19 | `04-wave-10-amendments.md` | Package B — Local Test Backend Isolation Requirement | 2026-10-27 | 本地测试后端隔离 | `ACTIVE` |
| 20 | `05-wave-11-amendments.md` | Wave 11 — Sales & Customer Credit Evaluation / Reconciliation / Query — Stage B Requirement Closure | 2026-10-22 | Wave 11 信用评估/对账/查询需求闭合 | `ACTIVE` |
| 21 | `05-wave-11-amendments.md` | W11-A U2 — Bounded Requirement Correction after Pre-E3 Semantic Parity Verification | 2026-10-28 | U2 有界需求更正 | `ACTIVE` |
| 22 | `05-wave-11-amendments.md` | W11-A U2 E3 — Cross-Engine Credit Policy Hash Contract Requirement Correction | 2026-10-29 | 跨引擎信用策略哈希合同 | `ACTIVE` |
| 23 | `05-wave-11-amendments.md` | W11-A U2 — ONE_TIME 特别审批消费与 Replay 语义更正 Requirement | 2026-10-29 | 一次性审批消费与重放语义 | `ACTIVE` |
| 24 | `05-wave-11-amendments.md` | W11-A OVERDUE Evidence Foundation — Bounded Requirement Amendment | 2026-10-29 | 逾期证据基础 | `ACTIVE` |
| 25 | `05-wave-11-amendments.md` | W11-A U3-0 Credit Query Mobile UI — Bounded Requirement Amendment | 2026-10-29 | 信用查询移动工作面 | `ACTIVE` |
| 26 | `05-wave-11-amendments.md` | W11-A U3 Selector Protected MySQL Gate — Bounded Requirement Amendment | 2026-10-30 | 选择器受保护 MySQL 门禁 | `ACTIVE` |
| 27 | `05-wave-11-amendments.md` | W11-A U3 Search Semantics Closure — Bounded Requirement Amendment | 2026-10-30 | 搜索语义闭合 | `ACTIVE` |
| 28 | `05-wave-11-amendments.md` | W11-A U3 Search Semantics — Final Bounded Design Correction, Requirement Amendment | 2026-10-30 | 搜索语义最终更正（对上一条的最终形态） | `ACTIVE` |
| 29 | `05-wave-11-amendments.md` | W11-A U3 / Wave 9 Exact Additive Schema Compatibility — Requirement Amendment | 2026-10-30 | 精确可加 schema 兼容 | `ACTIVE` |
| 30 | `05-wave-11-amendments.md` | W11-A U3 FAST Dual-Blocker Closure — Bounded Requirement Amendment | 2026-10-30 | FAST 双阻塞闭合 | `ACTIVE` |
| 31 | `05-wave-11-amendments.md` | W11-A U3 Final Acceptance Readiness — Bounded Residual Risk Requirement Amendment | 2026-10-30 | 验收就绪与残余风险 | `ACTIVE` |

> 处置列只表示**文档效力**，不表示能力已验收。能力验收状态一律以
> [`docs/status/PROJECT_STATUS.md`](../../status/PROJECT_STATUS.md) §35.3 与
> [`docs/acceptance/sales-customer/`](../../acceptance/sales-customer/) 为准。

## 3. 尚未纳入本目录的 Sales 相关需求

- **W11-B**（信用评估基础）、**W11-C**（多评分/评级应用）、**W11-D**（信用对账与重算）
  **尚未形成 Requirement**，属 `NOT_STARTED`；见 `PROJECT_STATUS.md` §35.5。
- §35.4 记录 B3102 / B3103 的当前 Coverage 权威来源为 §34.8 + Stage B SC82–SC107。

## 4. 迁移说明

本目录正文自 `document.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71` **逐字迁移**，
原章节编号**原样保留**，因此 `document.md §34`、`§34.8`、`§34.15` 等深引用继续有效。
逐章节映射见 [`docs/status/MIGRATION-MAP.md`](../../status/MIGRATION-MAP.md)。
