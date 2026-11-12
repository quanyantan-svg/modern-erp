# Finance Operations 财务运营域 — 域级能力审计基线（2026-11-12）

> **用途**：登记 B3108–B3113 财务运营域**域级 Acceptance** 的逐项能力复核证据，覆盖 Requirement `docs/requirements/finance-operations.md` §33.5 的 FO01～FO58 共 58 项能力。
>
> **Owner**：Finance Operations Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`IMPLEMENTED`（逐项复核已完成）——**域级 Acceptance 与 Capability Freeze 尚未签发**，等待业务所有者裁定。
>
> **权威来源**：Requirement [`docs/requirements/finance-operations.md`](../requirements/finance-operations.md) §33.1～§33.50；Design [`docs/design/finance-operations.md`](../design/finance-operations.md) §28；能力矩阵 [`docs/operations/finance-operations-capability-matrix.md`](../operations/finance-operations-capability-matrix.md)；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
>
> 本文件不改写合同正文，也不改写既有矩阵；它记录**当前 HEAD 上的复核结论**。

## 1. 复核方法与判定纪律

逐项定位 Requirement 条款、Design 条款、生产写入口（route + canonical owner）、可执行测试（文件 + 用例名）、**该能力是否被生产路径真正消费**与明确延期。

判 `COVERED` 需同时成立：① 有生产写入口；② 服务端具备来源、状态机、权限、事务约束；③ 有可执行测试覆盖正例且至少一个反例；④ **能力的事实进入业务路径**（只存在于自己的 CRUD 里不算覆盖）。

测试分类：**Class A = 新合同正例**；**Class B = 已知缺陷复现**。本轮未新增 Class B 用例。

## 2. 复核结论摘要

| 分组 | `COVERED` | `PARTIAL` | `MISSING` | `OUT_OF_SCOPE` |
|---|---|---|---|---|
| FO01～FO58（58 项） | **51** | **6** | **1** | **0** |

`PARTIAL`：FO03、FO04、FO05、FO19、FO31、FO48。`MISSING`：FO36。

**本轮新登记的跨域事实**：本仓库只有三个已批准的 ACK-4 campaign 可运行，Finance 的并发门禁 `scripts/gates/mysql-finance-concurrency-gate.mjs` 被 `blockUnmigratedAck4Entry` **永久阻断**，因此 Requirement §33.39 要求的 **15 个真实 MySQL race** 当前**无法执行**。按项目级裁定 [`MYSQL-EV-01`](../decisions/mysql-evidence-policy-20261112.md) 处理（§5.2）。

## 3. FO01～FO58 逐项复核

> 能力名称取自 Requirement §33.5；`Primary service` 取自既有能力矩阵；`判定` 与 `缺口` 是本次复核结论。

| ID | 能力 | 实现（owner / route / schema） | 测试 / UAT 证据 | 判定 | 缺口 |
|---|---|---|---|---|---|
| FO01 | Finance Operations Parameters | `finance-parameters` · `/api/finance/parameters` · `finance_parameters` | wave-a / UAT-01 | COVERED | — |
| FO02 | Recognition Mode Policy | `finance-recognition-policy` · `/api/finance/recognition-policy` · `finance_recognition_policy` | recognition-production / UAT-04..09 | COVERED | 矩阵写的表名与路由是**复数**，实现是**单数**（矩阵笔误，见 §4.2）；管理面 list/upsert **无测试调用点** |
| FO03 | Collection / Payment Terms | `finance-terms` · `/api/finance/payment-terms` · `finance_payment_terms` | wave-a / UAT-01..02 | **PARTIAL** | 该 master **只被自己的 CRUD 读取**（`finance-terms.js`），结算路径不消费它 —— 付款条件**不驱动到期日**；`list/upsert` 无测试调用点 |
| FO04 | Multi-Due-Date Schedule | `finance-due-schedule` · `/api/finance/due-schedules` · `finance_due_schedule_lines` | wave-a / UAT-10 | **PARTIAL** | `upsertDueSchedules` 与 `assertOpenItemSide` **只有路由调用点、没有业务路径调用点** —— AR/AP 建立不产生到期计划，不变式在生产中不被强制；两者均无测试调用点 |
| FO05 | Settlement / Reconciliation Scheme | `finance-settlement-scheme` · `/api/finance/settlement-schemes` · `finance_settlement_schemes` | wave-a / UAT-14 | **PARTIAL** | 表与 CRUD 存在，但模块自述「Pure config; no economic effect」，且 **Design §28 把 FO19 自动对账的规则行指向它** —— Design 规定的下游效果**未实现**；无测试调用点 |
| FO06 | AR Initialization | `finance-ar-init` · AR opening action · `account_receivables` | wave-a / UAT-01 | COVERED | — |
| FO07 | AP Initialization | `finance-ap-init` · AP opening action · `account_payables` | wave-a / UAT-02 | COVERED | — |
| FO08 | Treasury Initialization | `finance-treasury-init` · settlement-account opening · `bank_accounts`, `finance_treasury_movements` | wave-d / UAT-03 | COVERED | — |
| FO09 | Final AR Open Item | `finance-recognition`（`recognizeFinanceExposure`）· delivery/invoice adapters · `account_receivables` | recognition-production / UAT-04..06 | COVERED | — |
| FO10 | Final AP Open Item | 同上 · receipt/bill adapters · `account_payables` | recognition-production / UAT-07..09 | COVERED | — |
| FO11 | Provisional AR | `finance-ar-open-item` · source adapter · `account_receivables` | wave-c / UAT-06 | COVERED | — |
| FO12 | Provisional AP | `finance-ap-open-item` · source adapter · `account_payables` | recognition-production / UAT-09 | COVERED | — |
| FO13 | Provisional → Financial Conversion / Reversal | `finance-provisional-conversion` · invoice/bill post | recognition-production / UAT-06,09 | COVERED | — |
| FO14 | Other / Manual AR & AP | **实际 owner** `finance-ar-open-item::createManualAccountReceivable` / `finance-ap-open-item::createManualAccountPayable` | wave-a / UAT-01..02 | COVERED | 矩阵把 primary service 指向 `finance-manual-ar-ap`，该模块是 **0 调用方的死代码**（见 §4.1） |
| FO15 | AR / AP Counterparty Transfer | `finance-counterparty-transfer` · `/api/finance/transfers` · `finance_counterparty_transfers` | wave-b / UAT-22..23 | COVERED | — |
| FO16 | Collection Document | `settlement` · `/api/payment-collections` · `payment_collections` | m8 / UAT-11 | COVERED | — |
| FO17 | Payment Document | `settlement` · `/api/payment-disbursements` · `payment_disbursements` | m8 / UAT-12 | COVERED | — |
| FO18 | Explicit Settlement Allocation | `settlement-core` · settlement item actions | m8 / UAT-13 | COVERED | — |
| FO19 | Automatic / Scheduled Reconciliation | `settlement-core` · reconciliation action | m8 / UAT-14 | **PARTIAL** | **Design §28 把自动对账的规则行指向 `finance_settlement_schemes`（FO05）**，而该表无任何生产消费者 —— 自动对账目前**不按方案规则运行** |
| FO20 | Manual / Special Reconciliation | `settlement` · collection/payment editor | m8 / UAT-14 | COVERED | — |
| FO21 | Settlement Records & Trace | `settlement-core` · AR/AP detail | phase6a / UAT-13,19 | COVERED | — |
| FO22 | Settlement Reversal | `finance-settlement-reversal` · reverse action · `settlement_reversals` | phase6a / UAT-19 | COVERED | — |
| FO23 | Advance Receipt / Prepayment | `finance-unapplied-balance` · collection/payment actions | wave-b / UAT-15..16 | COVERED | — |
| FO24 | Unapplied Credit / Prepayment Balance | `finance-unapplied-balance` · unapplied balance list | phase6a / UAT-15..17 | COVERED | — |
| FO25 | Unapplied Balance Application | `finance-unapplied-balance` · apply action · `balance_applications` | wave-b / UAT-17 | COVERED | — |
| FO26 | Collection / Payment Refund | `financial-controls` · `/api/financial-refunds` · `financial_refunds` | phase6a / UAT-18 | COVERED | — |
| FO27 | Financial Write-off | `financial-controls` · `/api/financial-write-offs` · `financial_write_offs` | phase6a / UAT-20 | COVERED | — |
| FO28 | Bad-Debt Provision | `finance-bad-debt-provision` · `/api/finance/bad-debt-provisions` | wave-b / UAT-21 | COVERED | — |
| FO29 | Sales Invoice | `commercial-golive` · `/api/sales-invoices` · `sales_invoices` | invoice-lifecycle / UAT-24 | COVERED | — |
| FO30 | Purchase / Input Invoice | `commercial-golive` · `/api/supplier-bills` · `supplier_bills` | commercial-golive / UAT-25 | COVERED | — |
| FO31 | Invoice Source Cardinality / Partial / Split | `finance-recognition`（生产写入口 `finance-recognition.js:222` 写 `finance_invoice_source_links`） | wave-c / UAT-24..25 | **PARTIAL** | 生产路径由 `finance-recognition` 写入，功能成立；但另有**第二个未路由的写入口** `finance-invoice-cardinality::upsertInvoiceSourceLink` 与之重复（潜在双写），且该服务无 HTTP 路由 |
| FO32 | Invoice ↔ AR/AP Reconciliation | `finance-recognition` · invoice/bill post | recognition-production / UAT-24..25 | COVERED | — |
| FO33 | Credit / Red Invoice | `commercial-golive` · `/api/commercial-credit-notes` | commercial-golive / UAT-24..25 | COVERED | — |
| FO34 | Invoice Void / Cancel | `commercial-golive` · invoice cancel/void actions | invoice-lifecycle / UAT-24 | COVERED | — |
| FO35 | Input-Invoice Verification / Certification | `commercial-golive` · bill verify/certify/reject | invoice-lifecycle / UAT-25 | COVERED | — |
| FO36 | Invoice Operational Reports | **无实现** —— `finance-reports` 只有 arSummary / apSummary / arAging / treasuryMovementLedger / settlementAccountBalance / treasuryGlReconcile，**没有任何发票报表函数** | wave-e / UAT-32（UAT-32 只覆盖 AR/AP/Treasury 报表） | **MISSING** | Design §28 把 FO36 定为 `finance-reports` 的「invoice operational reports (report projection)」，实现完全缺席 |
| FO37 | Settlement Account Master | `finance-treasury-movement` · `/api/finance/settlement-accounts` · `bank_accounts` | wave-d / UAT-26 | COVERED | — |
| FO38 | Settlement Method / Purpose Master | `finance-settlement-account` → `bank_accounts` 的加法列 `account_type` / `accounting_role` / `accounting_subject_id`（`v22-finance-wave-d-treasury.js:31..32`）；Design 明确「`finance_settlement_accounts` master NOT created」 | wave-d / UAT-26 | COVERED | 矩阵的 schema 写「canonical document fields」不准确；实际是结算账户主数据的加法列（按 Design §28.11.1） |
| FO39 | Canonical Treasury Movement | `finance-treasury-movement` · `/api/finance/treasury-movements` · `finance_treasury_movements` | wave-d / UAT-27 | COVERED | 矩阵的路由写 `/api/finance/treasury/movements`，实际是 `/api/finance/treasury-movements`（笔误） |
| FO40 | Cash Deposit / Withdrawal | `finance-treasury-operations` · Treasury cash action | wave-d / UAT-27 | COVERED | — |
| FO41 | Internal Bank Transfer | `finance-treasury-movement` · Treasury transfer action | wave-d / UAT-27 | COVERED | — |
| FO42 | Notes Receivable | `finance-treasury-operations` · `/api/finance/notes` · `finance_notes` | recovery-api / UAT-28 | COVERED | — |
| FO43 | Notes Payable | `finance-treasury-operations` · `/api/finance/notes` · `finance_notes` | recovery-api / UAT-28 | COVERED | — |
| FO44 | Payment Request | `finance-treasury-operations` · `/api/finance/payment-requests` | recovery-api / UAT-28 | COVERED | — |
| FO45 | Cash Count | `finance-treasury-operations` · `/api/finance/cash-counts` | recovery-api / UAT-29 | COVERED | — |
| FO46 | Bank Statement Header + Lines | `finance-treasury-operations` · bank statement APIs · `bank_statements` / `bank_statement_items` | recovery-api / UAT-30 | COVERED | — |
| FO47 | Bank Statement Import | `finance-treasury-operations` · `/api/finance/bank-statements/import` · `finance_bank_statement_imports` | recovery-api / UAT-30 | COVERED | — |
| FO48 | Bank Reconciliation | `finance-treasury-operations` · `/api/finance/bank-reconciliations` · `finance_bank_reconciliations` + matches | recovery-api / UAT-30 | **PARTIAL** | 存在**两套活的银行对账账本**：canonical `finance_bank_reconciliations`（按对账单行匹配）与 legacy `bank_reconciliations`（`extended.js:335` 仍在写入，路由 `/api/bank-reconciliations` 仍可写）。legacy 无任何 UI 消费者但 API 仍开放 —— 违反「同一业务原语只允许一个 active canonical implementation」 |
| FO49 | Unmatched Bank Items | `finance-treasury-operations` · reconciliation unmatched API | recovery-api / UAT-30 | COVERED | 其未匹配项口径绑定 canonical 对账表；legacy 对账表的未匹配项无对应实现，故本项本身成立 |
| FO50 | Treasury ↔ GL Reconciliation `[INTEGRATION-BACKED]` | `finance-reports` · GL reconciliation report | wave-e / UAT-32 | COVERED | Integration-Backed，不得升级为 Domain-Owned（Requirement §33.4） |
| FO51 | AR Business Close | `finance-business-close` · AR close/reopen | wave-a / UAT-31 | COVERED | — |
| FO52 | AP Business Close | 同上 | wave-a / UAT-31 | COVERED | — |
| FO53 | Treasury Business Close | 同上 | wave-a / UAT-31 | COVERED | — |
| FO54 | AR Reports | `finance-reports` · `/api/finance/reports/ar/*` | wave-e / UAT-32 | COVERED | — |
| FO55 | AP Reports | `finance-reports` · `/api/finance/reports/ap/*` | wave-e / UAT-32 | COVERED | — |
| FO56 | Treasury Reports | `finance-reports` · `/api/finance/reports/treasury/*` | wave-e / UAT-32 | COVERED | — |
| FO57 | Source Business Document Adapter `[INTEGRATION-BACKED]` | `finance-recognition` · delivery/receipt/invoice/bill adapters | recognition-production / UAT-04..09 | COVERED | — |
| FO58 | Accounting Event / Voucher Adapter `[INTEGRATION-BACKED]` | `accounting-posting` / `createSystemVoucher`（Accounting 域 owner） | commercial UAT / UAT-24..25,32 | COVERED | 矩阵把 primary service 写成 `financial-inventory`，那是**库存估值**模块，不是会计凭证适配器（笔误） |

## 4. 本轮登记的真实缺陷与证据问题

| 编号 | 事实 | 影响 | 状态 |
|---|---|---|---|
| `FIN-DEF-01` | `server/modules/finance-manual-ar-ap.js` 是 **0 调用方的死代码**（两个导出只是 `finance-ar-open-item` / `finance-ap-open-item` 的再导出）；既有矩阵 FO14 行把它写成 primary service | 矩阵指向一个不存在行为的模块 | 待处置 |
| `FIN-DEF-02` | `finance-invoice-cardinality::upsertInvoiceSourceLink` 与生产写入口 `finance-recognition.js:222` **重复写** `finance_invoice_source_links`，且前者**无 HTTP 路由** | 潜在双写 / 第二写入口 | 待处置 |
| `FIN-DEF-03` | 存在**两套活的银行对账账本**：canonical `finance_bank_reconciliations` 与 legacy `bank_reconciliations`（`extended.js:335` 仍在写，`/api/bank-reconciliations` 仍可写） | 违反单 canonical 原语；legacy 无 UI 消费者但 API 开放 | 待处置 |
| `FIN-DEF-04` | `scripts/acceptance/finance-operations-final-uat.mjs` 的 `FINANCE_OPERATIONS_CAPABILITIES 58/58 PASS` 只校验**矩阵形状**（58 行、顺序正确、状态词表合法），**不校验每项能力有证据**；32 项 UAT ≠ 58 项能力 | 绿色结论覆盖面被高估 | 待处置 |
| `FIN-DEF-05` | 既有能力矩阵 5 处事实错误：FO02 表名（复数→单数）、FO02 路由（复数→单数）、FO39 路由（`treasury/movements`→`treasury-movements`）、FO14 primary service（指向死代码）、FO58 primary service（`financial-inventory` 是库存估值而非凭证适配器） | 矩阵不能作为审计依据 | 待处置 |
| `FIN-DEF-06` | FO03 / FO04 / FO05 三个 master **只被自己的 CRUD 读取**，`upsertDueSchedules`、`assertOpenItemSide`、`upsertFinancePaymentTerm`、`upsertSettlementScheme` **没有业务路径调用点**，且各自 `list/upsert` **0 测试调用点** | 能力存在但事实不进入业务 | 见 §3 的 FO03/FO04/FO05 判定 |
| `FIN-DEF-07` | FO36 发票运营报表**完全无实现** | 能力缺失 | 见 §3 的 FO36 判定 |

## 5. 验收证据与证据边界

### 5.1 本轮实测 Gate

| Gate | 结果 |
|---|---|
| `scripts/acceptance/finance-operations-final-uat.mjs`（`pnpm test:finance:uat`） | **32/32 PASS**（FINANCE_OPERATIONS_UAT），矩阵形状检查 58/58 PASS |
| `scripts/acceptance/finance-operations-responsive-uat.mjs`（`pnpm test:finance:responsive`） | **24/24 PASS**（6 工作面 × 320/390/430/680，真实 Edge） |
| 共享基线（HEAD `22ba875`） | FAST **632/632**、FULL **3718/3718**、HEAVY **67/67**、build、`git diff --check` 全 PASS |
| 文档一致性 `current` / `migration` | N1、N3～N6、N8、N9 PASS；N2 `RETIRED`；**N7 FAIL**（既有 4 个历史提交的追溯债务，与本域无关）；C1～C6 全 PASS |

### 5.2 真实 MySQL 证据边界（按 `MYSQL-EV-01`）

| 段 | 覆盖 | 证据 |
|---|---|---|
| schema / migration 对等 | Finance 的迁移链与表结构在真实 MySQL 8 上被接受 | `test:mysql:accounting-analytics` 的 `BOOTSTRAP_CURRENT_SCHEMA`（全量迁移集） |
| **15 个 Finance race 的行为等价**（RACE-01..15） | 同一笔收付款并发、确认 vs 反冲、预付二次核销、退款 vs 核销、核销 vs 坏账、往来转移并发、发票重复过账、供应商发票匹配/过账、暂估转正式 vs 普通结算、资金调拨重复执行、对账单行二次对账、业务关账 vs 财务单据 | **在真实 MySQL 上未被单独取证**：唯一提供该证据的门禁 `scripts/gates/mysql-finance-concurrency-gate.mjs` 被 `blockUnmigratedAck4Entry` **永久阻断**。RACE-01..15 的实现存在于 `server/mysql-finance-operations-concurrency.integration.js`（16 个用例），但**未在真实 MySQL 上执行过** |

Requirement §33.39 原文要求「Must execute on: real MySQL」「SQLite-only evidence 不计入」。按 `MYSQL-EV-01`，该条款必须按项目级统一口径修正指向，并把「真实 MySQL 上的 race 行为等价未取证」登记为**显式残余**，不得表述为已证明。建立 `FINANCE_MYSQL_V1` 域级 campaign 是升级该残余的唯一路径（需新 manifest、launcher 条目与业主逐次签发 ACK-4 capability），本轮**不**授权该新建工作。

Requirement §33.49 的 Hard Stop 第 12 条是「MySQL migration 无法保证 parity」——**未触发**：迁移 parity 由上表第一段证明；缺的是 race **行为**证据，两者不得混为一谈。

## 6. 未解决矛盾与待业务所有者裁定

| 编号 | 事项 | 需要裁定的问题 |
|---|---|---|
| `FIN-DEC-01` | FO36 发票运营报表**无实现** | ① 进入 Implementation 补齐；② 按 §33.7 显式排除在本域范围外；③ 作为随冻结接受的残余 |
| `FIN-DEC-02` | FO03 / FO04 / FO05 三个 master 无业务消费者（FO19 的方案规则行缺失） | ① 进入 Implementation 接线（付款条件驱动到期日、AR/AP 建立产生到期计划、自动对账按方案规则运行）；② 按 Design §28 显式缩小范围；③ 作为残余接受 |
| `FIN-DEC-03` | FO31 的第二个写入口与 FO48 的 legacy 对账账本 | ① 删除重复写入口并退役 legacy 账本（需先做 zero-caller / 消费者证明）；② 保留并显式登记为已知双轨 |
| `FIN-DEC-04` | `FIN-DEF-04` UAT 的 58/58 是形状检查 | ① 增强 UAT 使其逐能力断言证据；② 在签发记录中显式声明 58/58 不代表能力覆盖 |
| `FIN-DEC-05` | 矩阵 5 处事实错误（`FIN-DEF-05`） | 矩阵是**受治理的运维文档**，修正它属文档变更；请确认按修正执行 |
| `FIN-DEC-06` | 真实 MySQL race 行为等价未取证 | ① 按 `MYSQL-EV-01` 接受为显式残余（§5.2 已写明边界）；② 授权新建 `FINANCE_MYSQL_V1` campaign |

## 7. 变更历史

| 日期 | 变更 |
|---|---|
| 2026-11-12 | 建立本审计基线：FO01～FO58 逐项复核（51 `COVERED` / 6 `PARTIAL` / 1 `MISSING`）；登记 7 项真实缺陷与证据问题（§4）；登记 Requirement §33.39 的 15 个真实 MySQL race 因门禁被永久阻断而无法执行的事实，并按 `MYSQL-EV-01` 写明证据边界（§5.2）。**未签发域级 Acceptance，未做任何实现修改。** |
