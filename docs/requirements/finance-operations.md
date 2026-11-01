# Finance Operations — Requirement

> 状态：`ACTIVE`
> Owner：Finance Operations
> 权威来源：`document.md` §33
> 来源：`document.md` §33（源 SHA `4cb8c477aa00988bbfebef905764565cdfe62b71`，正文逐字迁移，章节编号保持不变）
## 33. Finance Operations Domain Closure Requirement

> 本节固化 Finance Operations Domain Closure 的 Requirement 阶段成果。
> Manual Evidence Baseline 来自上游已批准的 B3108 / B3109 / B3110 / B3111 / B3112 / B3113 + 支撑手册 B3101 / B3102 / B3106（Accounting & Analytics）/ B3121 / B3114。
> 本节 Coverage 以 2026-10-10 Finance Operations Domain Audit PASS 为准。
> 已知 Audit Semantic Blocker（R.1 — R.11）已固化为本节 Requirement 目标。
>
> Design 见 `solution.md §28`（待用户 PASS 后展开）；本阶段不进入 Design / Implementation / Migration / API / UI / Test 任一阶段。
>
> 本节明确消除 B3108 / B3109 / B3110 / B3111 中的 LEGACY_DIRECT 双识别歧义，并通过冻结三种识别模型收尾 AR / AP 事实。

### 33.1 范围与 ownership

#### 33.1.1 Finance Operations 拥有

Finance Operations 是以下能力的唯一 canonical owner：

- AR / AP operational open-item truth（`account_receivables` / `account_payables` open-item 模型 + canonical equation + invariant F1）；
- Collections / Settlement / Allocation / Reconciliation（payment_collections / payment_disbursements / payment_*_items / financial_credit_adjustments / balance_applications）；
- Advance Receipt / Prepayment / Refund / Write-off / Bad-debt operational facts；
- Sales / Purchase operational invoice truth（`sales_invoices` / `supplier_bills` / `commercial_credit_notes` 内部发票事实）；
- Cash / Bank operational movement truth（`settlement_account_movements` 单一 canonical movement ledger + reconciliation）；
- Treasury operations（bank / cash / settlement account / treasury initialization）；
- Bank statement / Bank reconciliation（外部银行证据 + 匹配 evidence）；
- AR / AP / Treasury 业务关账（独立于会计期间关账）；
- Operational Finance Reports（AR / AP / Treasury 报表）。

#### 33.1.2 Finance Operations 不拥有

- customer / supplier 商业 lifecycle（Sales & Customer / Procurement & Outsourcing）；
- sales / purchase source documents（同上）；
- 实物库存 truth（Inventory & Warehouse — FROZEN）；
- 存货核算 / 估值 ledger authoritative（Accounting & Analytics — B3106 / B3107）；
- 固定资产 lifecycle / depreciation authoritative GL（Accounting & Analytics — B3107）；
- voucher engine / GL / 期间结账 / 财务报表 / 经营会计（Accounting & Analytics — B3114 / B3115 / B3116 / B3117）；
- Multi-Org / Multi-Currency / Hedging / Loan / Cash Pooling / SWIFT 集成（OUT_OF_SCOPE）；
- 法定电子发票 / 税务申报硬件集成（OUT_OF_SCOPE）。

#### 33.1.3 B3106 / B3107 Ownership Correction（normalization）

**Freeze B3106 存货核算 与 B3107 固定资产 归属 `Accounting & Analytics`，不再属于 Finance Operations。**

事实上的当前 route 注册（`product-costs / cost-rates / fixed-assets` 当前 `domain='finance-operations'`）保留为 architectural debt，**本 Requirement 阶段不得实施移动**。后续 Domain Alignment 阶段须在遵循 `document.md §27` 与 `AGENTS.md §27` 兼容性约束的前提下单独调整。

`document.md §14` Manual → Domain 主映射表已同步：
- B3106 → Accounting & Analytics
- B3107 → Accounting & Analytics

`document.md §22.6` / `§22.7` Capability Audit Matrix baseline Coverage 表已同步：`*主要目标 Domain：Accounting & Analytics*`。

### 33.2 Canonical Recognition Models

本 Requirement 冻结三种 AR / AP recognition model。Legacy LEGACY_DIRECT / SEPARATE / AUTO_BILL 实现命名须由 Design 阶段映射到下述三种 canonical model。

```text
DIRECT_BUSINESS_OPEN_ITEM
INVOICE_DRIVEN_OPEN_ITEM
PROVISIONAL_TO_FINANCIAL
```

#### 33.2.1 DIRECT_BUSINESS_OPEN_ITEM

语义：
- 已确认销售出库 → 最终 AR；
- 已确认采购收货 → 最终 AP；
- 后续发票 / 账单 = 关联既有最终 AR / AP（link 而非新建）；
- 不允许：同一经济事件产生两笔最终暴露。

Invariant：
```text
one economic event → one final exposure
```

#### 33.2.2 INVOICE_DRIVEN_OPEN_ITEM

语义：
- 销售出库 / 采购收货仅产生 operational evidence（无 AR / AP）；
- 过账销售发票 → 最终 AR；
- 过账采购发票 / 账单 → 最终 AP。

Invariant：
- delivery / receipt 保持 operational evidence 身份，不被当作 AR / AP 替代品。

#### 33.2.3 PROVISIONAL_TO_FINANCIAL

语义（以 AP 为例）：
- 采购收货 → Provisional AP；
- 供应商发票到达 → provisional item 反向 / 转换；
- 同时创建最终发票 → 最终 Financial AP。

AR 等价：
- 出库 / 配置源 → Provisional AR；
- 销售发票 → provisional 反向 + 转换；
- 最终 Financial AR 形成。

Invariant：
- provisional 暴露 + financial 暴露 **不得** double-count 同一经济义务；
- 普通 settlement eligibility 仅限 final / financial open item，除非未来 Requirement 显式放宽。

### 33.3 AR / AP Canonical Equation

```text
open amount
=
original amount
- return / credit effects
- discount effects
- other approved credit effects
- cash allocations
- unapplied-balance applications
- write-offs
+ valid reversals
```

不允许：第二套独立可写 AR / AP 余额。
cached columns 仅作为 derived / cache projection。
canonical facts 必须可重算 reconcile。

### 33.4 Final Capability Catalogue

```text
Total = 58
Domain-Owned       = 55
Integration-Backed = 3
```

```text
FO50 Treasury ↔ GL Reconciliation                 [INTEGRATION-BACKED]
FO57 Source Business Document Adapter             [INTEGRATION-BACKED]
FO58 Accounting Event / Voucher Adapter           [INTEGRATION-BACKED]
```

后续 Design / Implementation 不得新增 Finance Operations capability ID；如需新增，必须重开 Requirement。
Integration-Backed 不得升级为 Domain-Owned；Domain-Owned 不得降级为 Integration-Backed。

### 33.5 Capability IDs

#### 33.5.1 Foundation / Recognition

```text
FO01 Finance Operations Parameters
FO02 Recognition Mode Policy
FO03 Collection / Payment Terms
FO04 Multi-Due-Date Schedule
FO05 Settlement / Reconciliation Scheme

FO06 AR Initialization
FO07 AP Initialization
FO08 Treasury Initialization

FO09 Final AR Open Item
FO10 Final AP Open Item

FO11 Provisional AR
FO12 Provisional AP
FO13 Provisional → Financial Conversion / Reversal

FO14 Other / Manual AR & AP
FO15 AR / AP Counterparty Transfer
```

#### 33.5.2 Settlement

```text
FO16 Collection Document
FO17 Payment Document

FO18 Explicit Settlement Allocation
FO19 Automatic / Scheduled Reconciliation
FO20 Manual / Special Reconciliation
FO21 Settlement Records & Trace

FO22 Settlement Reversal

FO23 Advance Receipt / Prepayment
FO24 Unapplied Credit / Prepayment Balance
FO25 Unapplied Balance Application
FO26 Collection / Payment Refund
     (Unapplied Balance Refund)

FO27 Financial Write-off
FO28 Bad-Debt Provision
```

#### 33.5.3 Invoice Operations

```text
FO29 Sales Invoice
FO30 Purchase / Input Invoice

FO31 Invoice Source Cardinality / Partial / Split
FO32 Invoice ↔ AR/AP Reconciliation

FO33 Credit / Red Invoice
FO34 Invoice Void / Cancel
FO35 Input-Invoice Verification / Certification
FO36 Invoice Operational Reports
```

#### 33.5.4 Treasury

```text
FO37 Settlement Account Master
FO38 Settlement Method / Purpose Master

FO39 Canonical Treasury Movement

FO40 Cash Deposit / Withdrawal
FO41 Internal Bank Transfer

FO42 Notes Receivable
FO43 Notes Payable
FO44 Payment Request

FO45 Cash Count

FO46 Bank Statement Header + Lines
FO47 Bank Statement Import
FO48 Bank Reconciliation
FO49 Unmatched Bank Items
```

#### 33.5.5 Business Close / Reporting

```text
FO50 Treasury ↔ GL Reconciliation              [INTEGRATION-BACKED]

FO51 AR Business Close
FO52 AP Business Close
FO53 Treasury Business Close

FO54 AR Reports
FO55 AP Reports
FO56 Treasury Reports
```

#### 33.5.6 Cross-Domain Integration

```text
FO57 Source Business Document Adapter          [INTEGRATION-BACKED]
FO58 Accounting Event / Voucher Adapter        [INTEGRATION-BACKED]
```

### 33.6 FO01 — Finance Operations Parameters

至少包含 policy-level configuration：

```text
recognition model          (DIRECT_BUSINESS / INVOICE_DRIVEN / PROVISIONAL_TO_FINANCIAL)
business enable date
settlement tolerance
default collection / payment terms
refund / write-off controls
provisional mode controls
```

不允许包含 Accounting & Analytics 配置（如 GL voucher 架构、科目 mapping）。

### 33.7 FO03 / FO04 — Terms and Due Schedule

一个 payment / collection term 可生成 1..n schedule lines。每个 schedule line 概念上包含：

```text
due date
amount / ratio
remaining amount
status
```

Invariant：

```text
sum(schedule amounts) == open item contractual amount
```

不允许把 multi-due-date terms 退化为单一 `due_date` 列。

### 33.8 FO06–FO08 — Initialization

AR initialization：

```text
enable date
opening AR
opening other AR
opening collection / refund facts where applicable
end initialization
```

AP 等价。

Treasury initialization：

```text
enable date
opening cash account balances
opening bank balances
enterprise-side outstanding bank items
bank-side outstanding items
end initialization
```

Initialization 不得伪造正常日常交易历史。

### 33.9 FO09 / FO10 — Final Open Items

Final AR / AP 必须保留：

```text
party
source type / id / no
business date
currency scope if supported
original amount
due schedule
recognition mode
financial / provisional state
current open amount
status
trace
```

已确认历史 source identity 不得 casual 重写。

### 33.10 FO11–FO13 — Provisional Mode

Provisional items 是 first-class facts。**不得**仅以：

```text
ordinary SALES_DELIVERY AR
ordinary PURCHASE_RECEIPT AP
```

加 undocumented flag 表示。

Required relation：

```text
business source
→ provisional item
→ financial invoice
→ conversion / reversal evidence
→ financial open item
```

Conversion 必须保留 traceability。**不允许**硬删除。

### 33.11 FO14 — Other / Manual AR & AP

允许合法的非销售 / 非采购 operational receivable / payable 创建。要求：

```text
explicit reason
party
business date
amount
source / reference
audit
approval / confirmation state
```

不得成为绕过 source controls 的静默通道。

### 33.12 FO15 — AR / AP Transfer

Transfer 含义：

```text
remaining open amount
Party A
→ Party B
```

with explicit transfer document / evidence。必须保留：

```text
total exposure
source history
transfer chain
remaining amount
business date
actor
reason
```

不允许原地 mutate 原 counterparty。

### 33.13 FO16–FO22 — Settlement Truth

Collection / Payment lifecycle：

```text
DRAFT → CONFIRMED → optional PARTIAL / FULL REVERSAL
```

已 confirmed documents 不得硬删除。

Allocation 支持：

```text
one settlement → many open items
many settlements → one open item
partial amount
```

不允许 over-allocation。所有 confirm / reversal 操作要求 idempotency。

### 33.14 FO19 / FO20 — Reconciliation Schemes

支持业务语义等价于：

```text
direct
automatic / scheduled
manual / special
```

这些是 matching strategies。**不得**创建第二套 AR / AP 真相。

### 33.15 FO23–FO26 — Unapplied Money

Advance receipt / Prepayment **不是**普通 AR / AP settlement。

Canonical flow：

```text
cash received / paid → unapplied balance

then either:
apply to open item
or
refund
```

明确保持分离：

```text
Settlement Reversal
!= Unapplied-Balance Refund
```

两者保留独立 evidence。

### 33.16 FO27 / FO28 — Write-off / Bad Debt

Write-off：

```text
confirmed operational reduction of an open item
```

with：

```text
reason
amount
approval
reversal
accounting integration
```

Bad-debt provision 独立于 write-off。至少支持：

```text
aging-based provision
individual-assessment provision
provision reversal / reduction
```

**不允许**建设完整 IFRS / ECL engine。

### 33.17 FO29–FO36 — Invoice Truth

Operational invoice 独立于：

```text
AR / AP
cash settlement
voucher
```

Invoice 必须保留：

```text
counterparty
source document lines
quantity
price
tax snapshot
gross / net / tax
business / invoice date
status
source cardinality
AR / AP relation
credit / red relation
```

### 33.18 FO31 — Partial / Split / Multi-Source Invoice

支持：

```text
partial invoicing
multiple source lines
cumulative invoiced quantity / amount
remaining invoiceable quantity / amount
```

Invoice limits 禁止超过 source business facts。在 bounded 范围内允许一张 invoice 收集兼容 source lines。**不得**duplicate source quantity。

### 33.19 FO33 / FO34 — Credit / Red / Void

Confirmed / posting economic history 通常必须通过下列方式纠正：

```text
credit / red invoice
reversal
```

不允许 hard deletion。

Void / cancel 仅在 legal / business valid 且 downstream dependencies 允许时生效。被 cancel / void 的 invoice 不得遗留 orphan：

```text
AR / AP
settlement
voucher
tax
```

effects。

### 33.20 FO35 — Input Invoice Verification

仅内部 ERP state。

至少需要 bounded lifecycle 等价于：

```text
UNVERIFIED
VERIFIED
CERTIFIED
REJECTED / INVALID
```

精确 enum naming 属于 Design。外部 tax-authority 验证保持 OUT_OF_SCOPE。

### 33.21 FO37 — Settlement Account Master

收敛 operational cash / bank account semantics。必须支持：

```text
CASH
BANK
```

operational account identity 独立于 GL accounting subject。每个 settlement account 可映射到 downstream accounting role / subject。

**不得**让 cash account 仅作为 accounting subject `1001` 隐式存在。

### 33.22 FO39 — One Treasury Movement Truth

**Blocking invariant。**每个已确认 cash / bank-changing operation 必须产生 exactly one canonical treasury movement。概念上：

```text
account
direction
amount
business date
source type
source id
counterparty
external reference
reversal relation
```

Examples：

```text
collection
payment
refund
settlement reversal
cash deposit
cash withdrawal
bank transfer
notes settlement
```

All 使用 **同一** treasury movement contract。

### 33.23 Treasury Balance Invariant

Operational balance：

```text
opening balance
+ canonical IN movements
- canonical OUT movements
```

`bank_accounts.balance_cents` 可保留仅作为：

```text
derived / cache projection
```

并必须 reconcile 至 canonical movements。

Forbidden：

```text
cash_journals 直接 mutate balance
且
settlement_account_movements 单独 mutate balance
```

不允许 competing writers。

### 33.24 Legacy cash_journals 处置

当前 `cash_journals` 直接写入路径 **不是 canonical**。Requirement：

```text
converge 至 canonical Treasury Movement
或
retire 作为 write path
```

之后 `cash_journals` 可保留为：

```text
read model
compatibility projection
report
```

但不得作为独立 balance engine。

### 33.25 FO40 / FO41 — Cash and Bank Transfer

Cash deposit / withdrawal 与 internal bank transfer 必须是 paired movements。例：

```text
Bank A → Bank B
```

must conserve organization cash total：

```text
A -100
B +100
total change = 0
```

不允许 one-sided balance mutation。

### 33.26 FO42 / FO43 — Notes Receivable / Payable

支持 bounded operational note lifecycle：

```text
create / register
hold
transfer / endorse where applicable
discount where applicable
settle / mature
cancel / reverse where valid
```

必须显式 link cash / AR / AP consequences。**不得**建设完整 banking bill platform。

### 33.27 FO44 — Payment Request

Payment request = request / approval evidence，**不是** cash movement。仅 approved / executed payment 才产生 treasury movement。Platform Workflow 可提供 approval orchestration。Finance Operations owns financial request fact。

### 33.28 FO45 — Cash Count

Cash count 必须比较：

```text
book cash
vs
physical counted cash
```

Difference 要求 explicit handling / evidence。Cash count 本身不得静默 overwrite balance。

### 33.29 FO46–FO49 — Bank Statement / Reconciliation

Bank statement = 外部银行 evidence。Statement lines 必须是 first-class。

Import 必须创建 statement evidence，**不得**创造 book movement。

Bank reconciliation matches：

```text
canonical book treasury movement
↔
bank statement line
```

支持：

```text
automatic match
manual match
partial / multi-line matching where needed
unmatched book items
unmatched bank items
reconciliation result
```

Invariant：reconciliation **不得**创建原始 cash movement。

### 33.30 FO50 — Treasury ↔ GL Reconciliation

Integration-backed read / check capability。比较：

```text
Treasury operational balance / movements
↔
Accounting & Analytics GL cash / bank balances
```

Finance Operations 不得直接 repair GL。Mismatch 仅产生 reconciliation evidence。

### 33.31 FO51–FO53 — Operational Business Close

**独立于** Accounting period close。

分别维护：

```text
FO51  AR Business Close
FO52  AP Business Close
FO53  Treasury Business Close
```

每个 capability 必须独立实现并独立证明：

```text
pre-close inspection
close
closed-through business date
status
reopen
audit
```

Invariant：

```text
AR close  !=  AP close  !=  Treasury close
```

且：

```text
FO51 / FO52 / FO53
!=
Accounting & Analytics accounting-period close
```

一个 generic close flag 不被接受。

#### 33.31.1 FO51 AR Business Close

AR operational close：维护 closed-through business date；close 之后 affect 该业务日期的 AR documents 不得 create / modify / confirm / reverse / delete；Read / report 仍允许；reopen 通过受控 business-close lifecycle；audit 必须。

#### 33.31.2 FO52 AP Business Close

AP operational close：维护 closed-through business date；close 之后 affect 该业务日期的 AP documents 不得 create / modify / confirm / reverse / delete；Read / report 仍允许；reopen 通过受控 business-close lifecycle；audit 必须。

#### 33.31.3 FO53 Treasury Business Close

Treasury operational close：维护 closed-through business date；close 之后 affect 该业务日期的 Treasury documents（cash / bank / settlement / reconciliation / statement）不得 create / modify / confirm / reverse / delete；Read / report 仍允许；reopen 通过受控 business-close lifecycle；audit 必须。

#### 33.31.4 Shared Post-Close Rules (FO51 / FO52 / FO53)

close 之后，affect closed-through business date 的 documents 不得：

```text
create
modify
confirm
reverse
delete
```

除非通过受控 business-close lifecycle 重开。Read / report 仍允许。close 之后的修正须使用有效 open business date。

### 33.32 FO54 — AR Reports

至少：

```text
AR summary
AR detail
AR aging
due / overdue receivables
customer statement
AR tracking
uninvoiced AR
```

派生自 canonical Finance Operations facts。

### 33.33 FO55 — AP Reports

至少：

```text
AP summary
AP detail
AP aging
due / overdue payables
supplier statement
AP tracking
uninvoiced AP
```

### 33.34 FO56 — Treasury Reports

至少：

```text
cash journal
bank movement ledger
settlement account balance
bank statement report
reconciliation result
unmatched-item report
```

Reports 不得成为 second financial ledgers。

### 33.35 FO57 — Source Business Document Adapter

Integration-backed。

消费 frozen domains 的 economic facts：

```text
Sales & Customer
Procurement & Outsourcing
```

including：

```text
delivery
sales return
purchase receipt
purchase return
outsourcing payable source
discount source where applicable
```

Finance Operations 不得 rewrite frozen source document。

### 33.36 FO58 — Accounting Event / Voucher Adapter

Integration-backed。

Finance Operations 发出 authoritative operational accounting events。Accounting & Analytics owns：

```text
voucher generation architecture
posting
GL
financial statements
accounting period
```

Finance Operations 不得建立自身 voucher engine。可复用既有 canonical voucher adapter。

### 33.37 Discount Ownership Decision

Freeze 如下 boundary：

#### 33.37.1 Sales Discount

commercial authoring / navigation 可保持：

```text
Sales & Customer
```

但其 confirmed financial open-item effect 归：

```text
Finance Operations
```

通过 canonical credit-adjustment integration。

#### 33.37.2 Purchase Discount

当前 contextual operation 可保持：

```text
Finance Operations
```

AP financial effect 归 Finance Operations。

asymmetry 被接受为 role / workflow ownership。**不得**仅因视觉对称而 move routes。

### 33.38 Non-Negotiable Invariants

Freeze：

```text
F1   One AR/AP Open-Item Truth
F2   Recognition Mode Is Explicit
F3   Provisional != Financial
F4   Allocation Is Explicit
F5   Prepayment / Advance != Settlement
F6   Reversal != Delete
F7   Invoice != AR/AP != Settlement != Voucher
F8   One Treasury Movement Truth
F9   Bank Statement != Book Movement
F10  Reconciliation Does Not Mutate Cash Truth
F11  Business Close != Accounting Period Close
F12  Exact Money
F13  Source Documents Remain Owned By Source Domains
F14  GL Remains Downstream
```

Money truth 保持：

```text
integer cents
```

或等价 exact representation。不允许 floating-point money truth。

### 33.39 Finance-Specific Concurrency Requirement

Design 必须 later 实现并证明 exactly **15** MySQL race scenarios：

```text
RACE-01  Collection vs Collection on same AR
RACE-02  Payment vs Payment on same AP

RACE-03  Collection confirm vs settlement reversal
RACE-04  Payment confirm vs settlement reversal

RACE-05  Same prepayment / advance application twice
RACE-06  Refund vs balance application
RACE-07  Write-off vs settlement

RACE-08  AR transfer vs collection
RACE-09  AP transfer vs payment

RACE-10  Same invoice post twice
RACE-11  Supplier Bill Match / Post / Double-Post Concurrency

RACE-12  Provisional conversion vs ordinary settlement

RACE-13  Same treasury transfer execute twice
RACE-14  Same bank statement line reconcile twice

RACE-15  Business close vs dated financial transaction
```

Must execute on：

```text
real MySQL
```

SQLite-only evidence 不计入。

### 33.40 Frozen Functional UAT

Freeze exactly **32** functional UAT scenarios。

```text
UAT-01  AR initialization
UAT-02  AP initialization
UAT-03  Treasury initialization

UAT-04  DIRECT_BUSINESS AR
UAT-05  INVOICE_DRIVEN AR
UAT-06  PROVISIONAL_TO_FINANCIAL AR

UAT-07  DIRECT_BUSINESS AP
UAT-08  INVOICE_DRIVEN AP
UAT-09  PROVISIONAL_TO_FINANCIAL AP

UAT-10  Multi-due-date schedule

UAT-11  Partial collection
UAT-12  Partial payment
UAT-13  Multi-open-item allocation
UAT-14  Automatic / manual reconciliation

UAT-15  Advance receipt
UAT-16  Supplier prepayment
UAT-17  Unapplied balance application
UAT-18  Unapplied-Balance Refund
UAT-19  Settlement reversal

UAT-20  Write-off + reversal
UAT-21  Bad-debt provision

UAT-22  AR counterparty transfer
UAT-23  AP counterparty transfer

UAT-24  Sales invoice partial / source / credit / void
UAT-25  Purchase invoice matching / verification / credit

UAT-26  Cash / Bank settlement account
UAT-27  Cash deposit / withdrawal + internal transfer

UAT-28  Notes receivable / payable + payment request

UAT-29  Cash count

UAT-30  Bank statement import + reconciliation + unmatched items

UAT-31  AR / AP / Treasury close + reopen

UAT-32  AR / AP / Treasury reports + Treasury ↔ GL reconciliation
```

Final Acceptance 不得 defer 任何 UAT。

#### 33.40.1 UAT-18 — Unapplied-Balance Refund 双方向必证

UAT-18 必须独立证明两个方向：

```text
A. Customer-side
  customer advance receipt / unapplied credit
  → refund to customer
  → verifying:
     original unapplied balance
     refund amount
     remaining unapplied balance
     canonical treasury movement
     accounting adapter evidence
     repeat execution idempotent / rejected

B. Supplier-side
  supplier prepayment / unapplied credit
  → refund from / to supplier as appropriate
  → verifying:
     original unapplied balance
     refund amount
     remaining unapplied balance
     canonical treasury movement
     accounting adapter evidence
     repeat execution idempotent / rejected
```

UAT-19 (Settlement Reversal) 不得作为 UAT-18 的替代 evidence。

#### 33.40.2 UAT-31 — 三独立业务关账复合 UAT

UAT-31 是 composite UAT，须独立证明三个 operational close 状态：

```text
AR close
AP close
Treasury close
```

每个独立 close 都必须通过：

```text
pre-close check
→ close succeeds
→ closed-through business date persisted
→ affected dated transaction rejected
→ zero economic side effect
→ reopen succeeds
→ valid dated transaction succeeds again
```

明确证明：

```text
AR close  !=  AP close  !=  Treasury close
```

且：

```text
all three operational closes
!=
Accounting & Analytics accounting-period close
```

一个 generic close flag 不被接受。

### 33.41 Responsive Requirement

Finance Operations mobile acceptance 必须验证：

```text
320 / 390 / 430 / 680  CSS px
```

不允许 horizontal document overflow。Touch targets：

```text
>= 44px
```

不允许为每个 capability 都创建 launcher card。Target mobile launcher：

```text
<= 6 Finance Operations primary entries
```

Recommended information architecture for Design to evaluate：

```text
Receivables
Collections
Payables
Payments
Invoices
Treasury
```

Sub-functions should be contextual / hub navigation。**本阶段不得实施**。

### 33.42 Migration Rule

Future migration may be：

```text
additive
idempotent
transactional where possible
reconcilable
rollback / fail-closed aware
```

Migration 必须 detect：

```text
duplicate economic exposure
cash / bank balance mismatch
orphan allocations
invalid provisional / final pairs
```

**不得**silently reinterpret inconsistent historical finance data。

### 33.43 Existing Runtime Convergence Requirements

后续 Design 必须 converge 而非 duplicate：

```text
settlement-core.js
settlement.js
financial-controls.js
commercial-golive.js
discounts.js

legacy cash_journals
bank_accounts balance writer
bank_statements
bank_reconciliations
bills
```

**不得**创建：

```text
settlement-v2
treasury-v2
new_ar_ledger
new_ap_ledger
```

并立于既有真相。

### 33.44 Out of Scope

显式 OUT_OF_SCOPE for Finance Operations：

```text
Multi-org consolidation
full multi-currency FX accounting
hedging / derivatives
loan management
full corporate treasury
cash pooling
bank host-to-host
SWIFT integration

tax disk hardware drivers
航天 / 百望 device driver integration
vendor-specific invoice cloud SDK
electronic signature provider
SMS / email invoice delivery platform
government tax-network API

Smart Accounting
General Ledger
financial statements
Inventory Costing
Fixed Assets Accounting
Management Accounting
full IFRS / ECL expected-credit-loss engine
```

Internal operational invoice state 保持 IN scope。

### 33.45 Permission 约束

新增最少 Finance Operations permission family，back-end fail closed。具体名称由 Design bounded。

兼容策略：
- 保留既有 `AR_VIEW` / `COLLECTION_MANAGE` / `AP_VIEW` / `PAYMENT_MANAGE` / `SALES_DISCOUNT_MANAGE` / `PURCHASE_DISCOUNT_MANAGE` / `BANK_ACCOUNTS_*` / `BANK_RECONCILE_*` / `CASH_JOURNALS_*` / `BILLS_*` / `FIXED_ASSETS_*` / `ACCOUNTING_VIEW` / `VOUCHER_SUBMIT` / `REPORT_VIEW`；
- 5 个 role seed（admin / sales / warehouse / reviewer / accounting）继续按现有能力访问；
- 新 permission admin 继承；其它角色保持现状。

### 33.46 Compatibility / 不变性约束

- 不删除 / 重命名现有 59+ enabled + 5 disabled route key；本 Domain Closure additive 引入新 route 与 owner；
- 不修改既有 `cash_journals` / `bills` / `bank_statements` / `bank_reconciliations` 表 / 列；新字段以 additive 形式扩展；
- 不重写 `account_receivables` / `account_payables` canonical equation；新字段以 additive 形式扩展；
- 不重写 canonical voucher adapter；新事件通过 `additive` integration；
- 不 DROP historical table；
- 不重命名既有 release tag；
- SQLite + MySQL 8 schema parity；migration 即生效（idempotent）。

### 33.47 Out of Scope（本 Domain Closure 不实施）

- Multi-Org / Multi-Currency（OUT_OF_SCOPE_PRODUCT_BASELINE）；
- 法定电子发票 / 税务硬件集成（OUT_OF_SCOPE）；
- voucher engine rewrite；
- 第二套 AR / AP ledger；
- 第二套 Treasury movement engine；
- retroactive rewrite 历史已确认 AR / AP / Treasury 事实；
- 完整 IFRS / ECL expected-credit-loss engine；
- 完整 corporate treasury / SWIFT / cash pooling。

### 33.48 Acceptance Criteria

#### A. Functional

全部 FO01–FO58 = 58 capability 每一项都必须有 final capability disposition。本域 capability disposition **穷尽且仅**分为以下两类：

```text
DOMAIN-OWNED SOURCE-BACKED CAPABILITIES = 55
+
MUST INTEGRATE capabilities = 3
=
58 capabilities
```

Cross-domain dependency 是 acceptance dependency metadata，**不是** capability disposition。

1. **Finance Operations Domain 自有的 source-backed capability = 55 项**

   5 个 Domain-Owned Integration-Backed 不算入（它们是 FO50 / FO57 / FO58，归入第 2 类）。

2. **MUST INTEGRATE capability = 3 项**

   ```text
   FO50 Treasury ↔ GL Reconciliation    → consume canonical GL cash/bank balance from Accounting & Analytics
   FO57 Source Business Document Adapter → consume frozen Sales / Procurement / Outsourcing source documents
   FO58 Accounting Event / Voucher Adapter → emit canonical accounting events to Accounting & Analytics
   ```

3. **OUT_OF_SCOPE_PRODUCT_BASELINE**

   仅允许用户已批准的明确产品基线项目：
   ```text
   Multi-Organization
   Multi-Currency
   法定电子发票 / 税务硬件集成
   voucher engine rewrite
   第二套 AR / AP / Treasury ledger / movement engine
   retroactive rewrite 历史已确认 AR / AP / Treasury 事实
   完整 IFRS / ECL engine
   完整 corporate treasury / SWIFT / cash pooling
   ```

最终不得存在 `unexplained MISSING / PARTIAL / SEMANTIC_MISMATCH`。任何 unresolved disposition 必须以 Hard Stop Conditions 形式回退至 Requirement / Design 层重新审视，**不得**通过偷换 disposition 类别伪装覆盖。

#### A.1 三大 Recognition Model Hard Invariants

- **DIRECT_BUSINESS_OPEN_ITEM 模型下**：不允许 invoice / bill 形成 second AR / AP for same economic event；
- **INVOICE_DRIVEN_OPEN_ITEM 模型下**：delivery / receipt 不允许被当作 AR / AP 替代品；
- **PROVISIONAL_TO_FINANCIAL 模型下**：provisional 与 financial 暴露不得 double-count；payment 仅限 financial AP。

#### A.2 显式 Invariants

- **Treasury 双真相消除** `≠` `bank_accounts.balance_cents` 完全删除。`bank_accounts.balance_cents` 保留为 derived / cache projection；canonical truth = `settlement_account_movements`。
- **B3106 / B3107 ownership 已 normalizes** 至 Accounting & Analytics；本 Domain 不再承接 Inventory Costing / Fixed Assets authoritative。
- **Capability disposition 穷尽且分类清晰**：任何 capability 必须落到 `Domain-owned source-backed` 或 `MUST INTEGRATE` 之一；不得以 `CROSS_DOMAIN_DEPENDENCY` 代替 disposition。
- **Cross-domain dependency 仅记录 metadata**：用于 traceability 与 acceptance dependency 校验，不计入 capability 分类。

#### B. Data / Schema

- 新增表 / column 全部 additive；既有表 / 字段无破坏；
- `account_receivables` / `account_payables` canonical equation 不得被破坏；
- `cash_journals` / `bills` / `bank_statements` / `bank_reconciliations` 表保留；legacy 路径可保留为 read model / compatibility projection，**不得**作为 write path；
- SQLite / MySQL 8 schema parity；migration 即生效；
- Opening 期间 opening AR / AP / Treasury 标记 `OPENING`；不虚构历史 daily transactions；
- 历史 AR / AP / Treasury 表不破坏；不得 DROP historical finance table；不 retroactive rewrite 历史事实。

#### C. Security

- 所有 Finance Operations mutation 必须 backend fail closed；
- Frontend hidden 不等于 authorization；
- Audit 写入关键 AR / AP / Treasury mutation；
- `settlement_account_movements` 写入必须有 voucher + balance reconcile；
- Cash journal write path 必须迁移至 canonical Treasury Movement 或 retired。

#### D. Test

- Wave A focused：参数 + 初始化 + 识别模型 + Terms + Due Schedule；
- Wave B focused：Final Open Items（FO09 / FO10）+ Provisional + Conversion / Reversal（FO11 / FO12 / FO13）+ Transfer（FO15）；
- Wave C focused：Settlement Documents + Allocation + Reconciliation Schemes（FO16–FO22）；
- Wave D focused：Unapplied Money + Refund + Write-off + Bad-Debt Provision（FO23–FO28）；
- Wave E focused：Sales Invoice + Purchase Invoice + Cardinality + Reconciliation + Credit/Red + Void/Cancel + Verification + Reports（FO29–FO36）；
- Wave F focused：Settlement Account + Treasury Movement + Cash/Transfer + Notes + Payment Request + Cash Count（FO37–FO45）；
- Wave G focused：Bank Statement + Import + Reconciliation + Unmatched + Treasury Close（FO46–FO49 + FO53）+ Treasury ↔ GL Reconciliation（FO50）；
- Wave H focused：AR / AP / Treasury 业务关账 + Reports（FO51–FO56）+ Source / Voucher Adapter（FO57 / FO58）；
- 全部 focused tests 纳入 `scripts/testing/test-suites.js`；
- canonical gate：`pnpm test:fast` / `pnpm test` / `pnpm test:heavy` / `pnpm build` / `git diff --check` 全 PASS；
- 若变更触及 MySQL 敏感路径且具备受保护 disposable MySQL 环境，运行 `pnpm test:mysql` + `pnpm test:mysql:concurrency`（**15 races 必须真实 MySQL 实证**）；
- responsive browser matrix：320 / 390 / 430 / 680 CSS px 在 6 个 primary launcher entries 上无横向溢出；
- **32 UAT 必须真实 PASS**：不得 defer 至 Final Acceptance 之后。

#### E. Concurrency critical sections

以下区域必须为 critical section（Design 决定具体 SQL / lock strategy；本阶段不设计 SQL）：

- multi-collection / multi-payment on same AR / AP（RACE-01 / RACE-02）；
- collection / payment confirm vs settlement reversal（RACE-03 / RACE-04）；
- same prepayment / advance application twice（RACE-05）；
- refund vs balance application（RACE-06）；
- write-off vs settlement（RACE-07）；
- AR / AP transfer vs collection / payment（RACE-08 / RACE-09）；
- same invoice post twice（RACE-10）；
- supplier-bill match / post concurrent（RACE-11）；
- provisional conversion vs ordinary settlement（RACE-12）；
- same treasury transfer execute twice（RACE-13）；
- same bank statement line reconcile twice（RACE-14）；
- business close vs dated financial transaction（RACE-15）。

#### F. UI / Mobile

- 实际 operator workflow（user task；Design 决定 UI 结构）：
  - DIRECT_BUSINESS AR / AP / Provisional → Financial AR / AP 流程；
  - Multi-due-date Schedule → Allocation / Reconciliation；
  - Settlement Reversal 流程；
  - Refund / Write-off / Bad-Debt Provision 流程；
  - Invoice Partial / Split / Multi-Source / Credit / Void 流程；
  - Cash / Bank Settlement Account Master + Treasury Movement 流程；
  - Cash Count + Internal Bank Transfer 流程；
  - Notes R / P + Payment Request 流程；
  - Bank Statement Import + Reconciliation + Unmatched Items 流程；
  - AR / AP / Treasury 业务关账流程。
- Mobile-first：390 CSS px 为主；同时验证 320 / 430 / 680；
- Mobile launcher primary entries ≤ 6；
- Sub-functions 走 contextual / hub navigation；
- LIST → DETAIL → EDITOR / WORKFLOW；
- 仅 UI 任务显式加载 `.claude/skills/erp-mobile-taste/SKILL.md`；
- 不得修改业务术语、API、权限、状态机、Approval / Confirm / Post / Reverse、source / downstream、AR / AP / Treasury / 会计事实。

#### G. Documentation / Log

- `document.md §14` Manual → Domain 主映射 + `§22.6` / `§22.7` Capability Audit Matrix + `§21` Domain-level gaps + `§3` Product Architecture 已同步；
- `document.md §33` 已固化 Requirement（含 58 capability + 55 + 3 + F1–F14 + 32 UAT + 15 RACE + 3 recognition models + B3106 / B3107 ownership correction）；
- `log/2026-10-10.md` append-only 记录本 Domain Closure Requirement 阶段成果；
- `solution.md` **本阶段不修改**；Design 在 Requirement 通过后于 `solution.md §28` 展开；
- `APPLY_GUIDE.md` 不动。

### 33.49 Hard Stop Conditions

遇下列情况停止对应 sub-capability（不影响其它 sub-capability 推进）：

1. Multi-Organization / Multi-Currency 需求出现；
2. 需要重写 voucher engine；
3. 需要 DROP historical finance table 或 destructive schema rewrite；
4. 需要 retroactive rewrite 已确认 AR / AP / Treasury 事实；
5. 需要建立第二套 AR / AP / Treasury ledger / movement engine；
6. 需要把 cash_journals 保留为 balance write path（必须迁移至 canonical Treasury Movement 或 retired）；
7. 需要把 customer / supplier / sales / purchase / inventory / production / outsource / engineering / planning / accounting 业务事实重写；
8. 需要走 Generic Workflow 取代现有 5 审批族；
9. 需要把 B3106 / B3107 ownership 重映射回 Finance Operations；
10. 需要把 sales-discounts / purchase-discounts 仅因视觉对称 move routes；
11. 需要把 provision / financial 模型混淆为 undocumented flag；
12. MySQL migration 无法保证 parity；
13. Source semantics 不足导致 multi-due-date 算法 / 完整 reversal-on-financial-invoice 不得不猜测；
14. 既有的 AR / AP / Settlement / Invoice / Treasury canonical truth 必须被破坏；
15. 把 receipt / delivery 当作 AR / AP 替代品。

### 33.50 最终接受状态

本节 Requirement 包含 **58** 项 Capability / Owner accounting = **55 Domain-Owned + 3 Integration-Backed**（FO50 Treasury ↔ GL Reconciliation / FO57 Source Business Document Adapter / FO58 Accounting Event / Voucher Adapter）。

本节 Requirement 包含 **14** Non-Negotiable Invariants（F1–F14）/ **3** Canonical Recognition Models / **32** Frozen Functional UAT / **15** Finance-Specific MySQL Races。

本节 Requirement 完成；下游 Design 见 `solution.md §28`（本阶段未开始）。等待用户 PASS。

---

**FINANCE OPERATIONS DOMAIN CLOSURE REQUIREMENT — COMPLETE / READY FOR USER REVIEW**

---
